import { api } from './api.js';
import { initMap, drawItineraries, BusLayer } from './map.js';
import { findNextStop } from './geo.js';

const POLL_MS = 17000; // dentro del rango 15-20s pedido
const DEFAULT_SPEED_MPS = 8.3; // ~30 km/h, solo como respaldo antes de tener una muestra real

const $ = (sel) => document.querySelector(sel);

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
  $(id).classList.remove('hidden');
}

/* ---------- Pantalla inicial: tabs + búsquedas ---------- */

function setupTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`#tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

function setupLineSearch() {
  const input = $('#line-search');
  const list = $('#line-results');

  const search = debounce(async (q) => {
    if (!q.trim()) {
      list.innerHTML = '';
      return;
    }
    try {
      const { lines } = await api.searchLines(q.trim());
      renderLineResults(lines);
    } catch (err) {
      list.innerHTML = `<li class="empty-hint">Error buscando líneas: ${err.message}</li>`;
    }
  }, 300);

  input.addEventListener('input', () => search(input.value));

  function renderLineResults(lines) {
    if (!lines.length) {
      list.innerHTML = '<li class="empty-hint">Sin resultados</li>';
      return;
    }
    list.innerHTML = '';
    for (const line of lines) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="result-badge">${line.shortDescription}</span>
        <span class="result-desc">${line.description}</span>
      `;
      li.addEventListener('click', () => openLine(line));
      list.appendChild(li);
    }
  }
}

function setupStopSearch() {
  const input = $('#stop-search');
  const list = $('#stop-results');

  const search = debounce(async (q) => {
    if (!q.trim()) {
      list.innerHTML = '';
      return;
    }
    try {
      const { stops } = await api.searchStops(q.trim());
      renderStopResults(stops);
    } catch (err) {
      list.innerHTML = `<li class="empty-hint">Error buscando paradas: ${err.message}</li>`;
    }
  }, 300);

  input.addEventListener('input', () => search(input.value));

  function renderStopResults(stops) {
    if (!stops.length) {
      list.innerHTML = '<li class="empty-hint">Sin resultados</li>';
      return;
    }
    list.innerHTML = '';
    for (const stop of stops) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="result-badge">🚏</span>
        <span>
          <div class="result-desc">${stop.name || stop.codStop}</div>
          <div class="result-sub">${(stop.lines || []).join(' · ')}</div>
        </span>
      `;
      li.addEventListener('click', () => openStop(stop));
      list.appendChild(li);
    }
  }
}

/* ---------- Pantalla de mapa (línea seleccionada) ---------- */

const mapState = {
  map: null,
  busLayer: null,
  itinerariesByDirection: new Map(),
  pollHandle: null,
  codLine: null,
};

function ensureMap() {
  if (mapState.map) return mapState.map;
  mapState.map = initMap('leaflet-map');
  mapState.busLayer = new BusLayer(mapState.map, { onSelect: onBusSelected });
  return mapState.map;
}

async function openLine(line) {
  showScreen('#screen-map');
  $('#map-line-code').textContent = line.shortDescription;
  $('#map-line-desc').textContent = line.description;
  $('#map-status').textContent = 'Cargando trazado…';

  const map = ensureMap();
  mapState.codLine = line.codLine;
  mapState.busLayer.clear();
  if (mapState.currentRouteLayer) mapState.currentRouteLayer.remove();

  try {
    const info = await api.getLineInfo(line.codLine);
    mapState.itinerariesByDirection = new Map(info.itineraries.map((it) => [String(it.direction), it]));
    const { group } = drawItineraries(map, info.itineraries);
    mapState.currentRouteLayer = group;
    $('#map-status').textContent = '';
  } catch (err) {
    $('#map-status').textContent = `Error cargando la línea: ${err.message}`;
    return;
  }

  startLocationPolling();
}

function startLocationPolling() {
  stopLocationPolling();
  const tick = async () => {
    try {
      const { vehicles, updatedAt } = await api.getLineLocation(mapState.codLine);
      mapState.busLayer.update(vehicles);
      renderBusChips(vehicles);
      refreshSelectedBusInfo();
      const time = new Date(updatedAt).toLocaleTimeString('es-ES');
      $('#map-status').textContent = vehicles.length
        ? `${vehicles.length} bus(es) en circulación · actualizado ${time}`
        : `Sin vehículos circulando ahora mismo · actualizado ${time}`;
    } catch (err) {
      $('#map-status').textContent = `No se pudo actualizar la posición: ${err.message}`;
    }
  };
  tick();
  mapState.pollHandle = setInterval(tick, POLL_MS);
}

function stopLocationPolling() {
  if (mapState.pollHandle) clearInterval(mapState.pollHandle);
  mapState.pollHandle = null;
}

function renderBusChips(vehicles) {
  const row = $('#bus-chip-row');
  row.innerHTML = '';
  vehicles.forEach((v, i) => {
    const chip = document.createElement('button');
    chip.className = 'bus-chip' + (v.id === mapState.busLayer.selectedId ? ' selected' : '');
    chip.textContent = `Bus ${i + 1}`;
    chip.dataset.vehicleId = v.id;
    chip.addEventListener('click', () => mapState.busLayer.select(v.id));
    row.appendChild(chip);
  });
}

function onBusSelected(id) {
  document.querySelectorAll('.bus-chip').forEach((chip) => {
    chip.classList.toggle('selected', chip.dataset.vehicleId === id);
  });
  refreshSelectedBusInfo();
}

function refreshSelectedBusInfo() {
  const panel = $('#bus-info-panel');
  const content = $('#bus-info-content');
  const id = mapState.busLayer.selectedId;

  if (!id) {
    panel.classList.add('hidden');
    return;
  }

  const state = mapState.busLayer.getState(id);
  if (!state) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');
  const itinerary = mapState.itinerariesByDirection.get(String(state.direction));
  const next = itinerary ? findNextStop({ lat: state.lat, lon: state.lon }, itinerary.stops) : null;

  if (!next) {
    content.innerHTML = `<strong>Bus seleccionado</strong><div class="result-sub">Sin datos de próxima parada</div>`;
    return;
  }

  const speed = state.speedMps && state.speedMps > 0.3 ? state.speedMps : DEFAULT_SPEED_MPS;
  const etaSeconds = next.distanceToNextStopMeters / speed;
  const etaMin = Math.max(0, Math.round(etaSeconds / 60));

  content.innerHTML = `
    <strong>Próxima parada:</strong> ${next.nextStop.name || next.nextStop.codStop}<br/>
    <span class="result-sub">~${etaMin} min (estimado por posición y velocidad, no es una hora programada de CRTM)</span>
  `;
}

$('#map-back').addEventListener('click', () => {
  stopLocationPolling();
  showScreen('#screen-home');
});

$('#map-refresh').addEventListener('click', () => startLocationPolling());

/* ---------- Pantalla de parada (búsqueda por parada) ---------- */

const stopState = { codStop: null, pollHandle: null };

async function openStop(stop) {
  showScreen('#screen-stop');
  $('#stop-name').textContent = stop.name || stop.codStop;
  stopState.codStop = stop.codStop;
  startStopPolling();
}

function startStopPolling() {
  stopStopPolling();
  const tick = async () => {
    try {
      const { arrivals } = await api.getStopTimes(stopState.codStop);
      renderArrivals(arrivals);
      $('#stop-status').textContent = `Actualizado ${new Date().toLocaleTimeString('es-ES')}`;
    } catch (err) {
      $('#stop-status').textContent = `No se pudo actualizar: ${err.message}`;
    }
  };
  tick();
  stopState.pollHandle = setInterval(tick, POLL_MS);
}

function stopStopPolling() {
  if (stopState.pollHandle) clearInterval(stopState.pollHandle);
  stopState.pollHandle = null;
}

function renderArrivals(arrivals) {
  const list = $('#stop-arrivals');
  if (!arrivals.length) {
    list.innerHTML = '<li class="empty-hint">Sin llegadas previstas</li>';
    return;
  }
  list.innerHTML = '';
  for (const a of arrivals) {
    const li = document.createElement('li');
    const etaText =
      a.secondsToArrival === null
        ? '—'
        : a.secondsToArrival < 60
          ? 'En parada'
          : `${Math.round(a.secondsToArrival / 60)} min`;
    li.innerHTML = `
      <span class="result-badge">${a.line}</span>
      <span class="result-desc">${a.destination}</span>
      <span class="arrival-eta">${etaText}</span>
    `;
    list.appendChild(li);
  }
}

$('#stop-back').addEventListener('click', () => {
  stopStopPolling();
  showScreen('#screen-home');
});

$('#stop-refresh').addEventListener('click', () => startStopPolling());

/* ---------- Arranque ---------- */

setupTabs();
setupLineSearch();
setupStopSearch();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('SW no registrado:', err));
  });
}
