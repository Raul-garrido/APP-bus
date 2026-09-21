import { createBusIcon } from './busIcon.js';
import { distanceMeters } from './geo.js';

const MADRID_CENTER = [40.4168, -3.7038];
const ANIMATION_MS = 1500;
// Movimiento mínimo (metros) para actualizar la velocidad estimada del bus -- evita que
// el ruido normal del GPS cuando está parado (unos pocos metros) se lea como que va a
// varios km/h.
const MIN_MOVEMENT_FOR_SPEED_M = 5;

export function initMap(containerId) {
  const map = L.map(containerId, { zoomControl: true }).setView(MADRID_CENTER, 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  return map;
}

// Sin trazado real de calle (CRTM solo da un KML aparte por itinerario, ver README): se
// dibuja una polyline uniendo las paradas en orden, que ya viene en el sentido de
// circulación de cada itinerario. Si el backend pudo descargar y parsear el KML real de
// CRTM (routeSegments), se usa ese trazado fiel a la carretera; si no (falló la descarga,
// formato inesperado...), se cae de vuelta a unir las paradas en línea recta.
export function drawItineraries(map, itineraries, { onStopClick } = {}) {
  const group = L.layerGroup().addTo(map);
  const stopMarkers = new Map();

  for (const it of itineraries) {
    const segments =
      it.routeSegments && it.routeSegments.length
        ? it.routeSegments
        : [it.stops.filter((s) => Number.isFinite(s.lat)).map((s) => [s.lat, s.lon])];

    for (const segment of segments) {
      if (segment.length > 1) {
        L.polyline(segment, { color: '#2563eb', weight: 3, opacity: 0.55 }).addTo(group);
      }
    }
    for (const stop of it.stops) {
      if (!Number.isFinite(stop.lat) || stopMarkers.has(stop.codStop)) continue;
      const marker = L.circleMarker([stop.lat, stop.lon], {
        radius: 4,
        color: '#1e3a8a',
        weight: 2,
        fillColor: '#ffffff',
        fillOpacity: 1,
      })
        .addTo(group)
        .bindTooltip(stop.name || '', { direction: 'top' });
      if (onStopClick) marker.on('click', () => onStopClick(stop, it));
      stopMarkers.set(stop.codStop, marker);
    }
  }

  const layers = group.getLayers();
  if (layers.length) {
    const bounds = L.featureGroup(layers).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
  }

  return { group, stopMarkers };
}

// Gestiona los marcadores de autobús: altas/bajas según qué vehículos siguen circulando,
// animación de la posición anterior a la nueva (en vez de saltar de golpe) y selección /
// resaltado de un vehículo concreto. El icono mira a un lado u otro según el sentido real
// de la línea (direction 1/2, dato fiable de CRTM) -- ver busIcon.js.
export class BusLayer {
  constructor(map, { onSelect } = {}) {
    this.map = map;
    this.onSelect = onSelect;
    this.vehicles = new Map();
    this.selectedId = null;
  }

  update(vehicleList) {
    const seen = new Set();
    const now = Date.now();

    for (const v of vehicleList) {
      if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
      seen.add(v.id);
      const existing = this.vehicles.get(v.id);
      if (!existing) {
        this._create(v, now);
      } else {
        this._animateTo(existing, v, now);
      }
    }

    for (const [id, state] of this.vehicles) {
      if (seen.has(id)) continue;
      state.marker.remove();
      if (state.raf) cancelAnimationFrame(state.raf);
      this.vehicles.delete(id);
      if (this.selectedId === id) this.selectedId = null;
    }
  }

  _create(v, now) {
    const marker = L.marker([v.lat, v.lon], {
      icon: createBusIcon(L, { direction: v.direction, highlighted: v.id === this.selectedId }),
    }).addTo(this.map);
    marker.on('click', () => this.select(v.id));

    this.vehicles.set(v.id, {
      marker,
      lat: v.lat,
      lon: v.lon,
      direction: v.direction,
      lastUpdate: now,
      speedMps: null,
      raf: null,
    });
  }

  _animateTo(state, newV, now) {
    const from = { lat: state.lat, lon: state.lon };
    const to = { lat: newV.lat, lon: newV.lon };
    const elapsedS = Math.max(1, (now - state.lastUpdate) / 1000);
    const movedM = distanceMeters(from, to);
    const speedMps = movedM / elapsedS;

    // Un vehículo físico puede, entre un servicio y el siguiente, pasar a cubrir el otro
    // sentido de la línea -- si cambia, hay que espejar el icono.
    if (String(newV.direction) !== String(state.direction)) {
      state.marker.setIcon(createBusIcon(L, { direction: newV.direction, highlighted: newV.id === this.selectedId }));
    }

    if (state.raf) cancelAnimationFrame(state.raf);
    const startLat = state.lat;
    const startLon = state.lon;
    const startTime = performance.now();

    const step = (t) => {
      const progress = Math.min(1, (t - startTime) / ANIMATION_MS);
      const eased = 1 - (1 - progress) * (1 - progress);
      const lat = startLat + (to.lat - startLat) * eased;
      const lon = startLon + (to.lon - startLon) * eased;
      state.marker.setLatLng([lat, lon]);
      state.raf = progress < 1 ? requestAnimationFrame(step) : null;
    };
    state.raf = requestAnimationFrame(step);

    state.lat = newV.lat;
    state.lon = newV.lon;
    state.direction = newV.direction;
    state.lastUpdate = now;
    if (movedM >= MIN_MOVEMENT_FOR_SPEED_M) state.speedMps = speedMps;
  }

  select(id) {
    const prevSelected = this.selectedId;
    this.selectedId = this.selectedId === id ? null : id;

    for (const [vid, state] of this.vehicles) {
      if (vid !== id && vid !== prevSelected) continue;
      const highlighted = vid === this.selectedId;
      state.marker.setIcon(createBusIcon(L, { direction: state.direction, highlighted }));
    }

    if (this.selectedId) this.map.panTo([this.vehicles.get(id).lat, this.vehicles.get(id).lon]);
    if (this.onSelect) this.onSelect(this.selectedId, this.selectedId ? this.vehicles.get(this.selectedId) : null);
  }

  getState(id) {
    const s = this.vehicles.get(id);
    if (!s) return null;
    return { lat: s.lat, lon: s.lon, speedMps: s.speedMps, direction: s.direction };
  }

  getAllStates() {
    return [...this.vehicles.entries()].map(([id, s]) => ({
      id,
      lat: s.lat,
      lon: s.lon,
      speedMps: s.speedMps,
      direction: s.direction,
    }));
  }

  clearSelection() {
    if (!this.selectedId) return;
    const prevId = this.selectedId;
    this.selectedId = null;
    const state = this.vehicles.get(prevId);
    if (state) state.marker.setIcon(createBusIcon(L, { direction: state.direction, highlighted: false }));
    if (this.onSelect) this.onSelect(null, null);
  }

  clear() {
    for (const state of this.vehicles.values()) {
      state.marker.remove();
      if (state.raf) cancelAnimationFrame(state.raf);
    }
    this.vehicles.clear();
    this.selectedId = null;
  }
}
