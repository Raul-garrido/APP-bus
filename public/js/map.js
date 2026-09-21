import { createBusIcon, updateBusIconRotation } from './busIcon.js';
import { distanceMeters, bearingDegrees } from './geo.js';

const MADRID_CENTER = [40.4168, -3.7038];
const ANIMATION_MS = 1500;
// Movimiento mínimo (metros) para recalcular el rumbo por vector anterior->nuevo en vez
// de mantener el último rumbo conocido -- evita que el bus "tiemble" de orientación
// cuando está parado y el GPS solo tiene ruido de unos pocos metros.
const MIN_MOVEMENT_FOR_HEADING_M = 5;

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
// circulación de cada itinerario.
export function drawItineraries(map, itineraries) {
  const group = L.layerGroup().addTo(map);
  const stopMarkers = new Map();

  for (const it of itineraries) {
    const latlngs = it.stops.filter((s) => Number.isFinite(s.lat)).map((s) => [s.lat, s.lon]);
    if (latlngs.length > 1) {
      L.polyline(latlngs, { color: '#2563eb', weight: 3, opacity: 0.55 }).addTo(group);
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
// resaltado de un vehículo concreto.
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
    const heading = v.heading ?? 0;
    const marker = L.marker([v.lat, v.lon], {
      icon: createBusIcon(L, { heading, highlighted: v.id === this.selectedId }),
    }).addTo(this.map);
    marker.on('click', () => this.select(v.id));

    this.vehicles.set(v.id, {
      marker,
      lat: v.lat,
      lon: v.lon,
      heading,
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

    // Preferimos el rumbo que mande la propia API (heading/bearing real del vehículo) si
    // existe; si no, lo aproximamos por el vector entre la posición anterior y la nueva.
    let heading = newV.heading;
    if (heading === null || heading === undefined) {
      heading = movedM >= MIN_MOVEMENT_FOR_HEADING_M ? bearingDegrees(from, to) : state.heading;
    }

    if (state.raf) cancelAnimationFrame(state.raf);
    const startLat = state.lat;
    const startLon = state.lon;
    const startTime = performance.now();
    const finalHeading = heading;

    const step = (t) => {
      const progress = Math.min(1, (t - startTime) / ANIMATION_MS);
      const eased = 1 - (1 - progress) * (1 - progress);
      const lat = startLat + (to.lat - startLat) * eased;
      const lon = startLon + (to.lon - startLon) * eased;
      state.marker.setLatLng([lat, lon]);
      updateBusIconRotation(state.marker.getElement(), finalHeading);
      state.raf = progress < 1 ? requestAnimationFrame(step) : null;
    };
    state.raf = requestAnimationFrame(step);

    state.lat = newV.lat;
    state.lon = newV.lon;
    state.heading = heading;
    state.direction = newV.direction;
    state.lastUpdate = now;
    if (movedM >= MIN_MOVEMENT_FOR_HEADING_M) state.speedMps = speedMps;
  }

  select(id) {
    const prevSelected = this.selectedId;
    this.selectedId = this.selectedId === id ? null : id;

    for (const [vid, state] of this.vehicles) {
      if (vid !== id && vid !== prevSelected) continue;
      const highlighted = vid === this.selectedId;
      state.marker.setIcon(createBusIcon(L, { heading: state.heading, highlighted }));
    }

    if (this.selectedId) this.map.panTo([this.vehicles.get(id).lat, this.vehicles.get(id).lon]);
    if (this.onSelect) this.onSelect(this.selectedId, this.selectedId ? this.vehicles.get(this.selectedId) : null);
  }

  getState(id) {
    const s = this.vehicles.get(id);
    if (!s) return null;
    return { lat: s.lat, lon: s.lon, heading: s.heading, speedMps: s.speedMps, direction: s.direction };
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
