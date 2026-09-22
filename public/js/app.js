import { api } from './api.js';
import { initMap, drawItineraries, BusLayer } from './map.js';
import { findNextStop, distanceToStopAhead } from './geo.js';

const POLL_MS = 10000;
const DEFAULT_SPEED_MPS = 8.3; // ~30 km/h, solo como respaldo antes de tener una muestra real

const $ = (sel) => document.querySelector(sel);

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// setInterval dispara cada POLL_MS pase lo que pase, aunque la petición anterior siga en
// vuelo -- con un intervalo corto y una API externa de latencia variable eso puede
// solapar peticiones y desordenar qué respuesta "gana". Esto en cambio programa la
// siguiente vuelta solo cuando termina la actual (éxito o error), así nunca hay dos en
// vuelo a la vez. Devuelve una función para cancelar el bucle.
function startPollLoop(fn, ms) {
  let cancelled = false;
  let timeoutId = null;

  const tick = async () => {
    await fn();
    if (!cancelled) timeoutId = setTimeout(tick, ms);
  };
  tick();

  return () => {
    cancelled = true;
    if (timeoutId) clearTimeout(timeoutId);
  };
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
  $(id).classList.remove('hidden');
  // Un mapa de Leaflet que estaba oculto (display:none) no recalcula bien su tamaño en
  // píxeles hasta que se le avisa -- si no, al volver a una pantalla con mapa ya creado de
  // antes, el trazado/marcadores pueden salir mal posicionados o directamente no dibujarse
  // (el propio fitBounds calcula con un tamaño de contenedor obsoleto).
  if (id === '#screen-home') homeMapState.map?.invalidateSize();
  if (id === '#screen-map') mapState.map?.invalidateSize();
}

/* ---------- Pantalla inicial: mapa + geolocalización + tabs de búsqueda ---------- */

const homeMapState = { map: null, started: false };

function initHomeMap() {
  if (homeMapState.started) return;
  homeMapState.started = true;

  homeMapState.map = initMap('home-map');
  const status = $('#home-status');

  if (!('geolocation' in navigator)) {
    status.textContent = 'Este navegador no da tu ubicación -- usa el buscador de arriba.';
    return;
  }

  status.textContent = 'Buscando tu ubicación…';
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      const { latitude, longitude } = coords;
      homeMapState.map.setView([latitude, longitude], 15);
      L.circleMarker([latitude, longitude], {
        radius: 7,
        color: '#ffffff',
        weight: 2,
        fillColor: '#2563eb',
        fillOpacity: 1,
      }).addTo(homeMapState.map);

      try {
        const { stops } = await api.getNearbyStops(latitude, longitude);
        renderNearbyStops(stops);
        status.textContent = stops.length
          ? `${stops.length} parada(s) interurbanas cerca -- tócalas para ver sus próximos buses`
          : 'No hay paradas interurbanas cerca de ti';
      } catch (err) {
        status.textContent = `No se pudieron cargar las paradas cercanas: ${err.message}`;
      }
    },
    () => {
      status.textContent = 'Sin acceso a tu ubicación -- usa el buscador de arriba.';
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function renderNearbyStops(stops) {
  for (const stop of stops) {
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) continue;
    L.circleMarker([stop.lat, stop.lon], {
      radius: 6,
      color: '#1e3a8a',
      weight: 2,
      fillColor: '#ffffff',
      fillOpacity: 1,
    })
      .addTo(homeMapState.map)
      .bindTooltip(stop.name || '', { direction: 'top' })
      .on('click', () => openStop(stop));
  }
}

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
  selectedDirection: null,
  selectedStop: null,
  currentRouteLayer: null,
  pollCancel: null,
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
  $('#direction-row').innerHTML = '';
  $('#bus-chip-row').innerHTML = '';

  ensureMap();
  mapState.codLine = line.codLine;
  mapState.selectedStop = null;
  mapState.busLayer.clear();
  if (mapState.currentRouteLayer) mapState.currentRouteLayer.remove();

  try {
    const info = await api.getLineInfo(line.codLine);
    $('#map-line-desc').textContent = info.description || line.description || '';
    mapState.itinerariesByDirection = new Map(info.itineraries.map((it) => [String(it.direction), it]));
    mapState.selectedDirection = info.itineraries[0] ? String(info.itineraries[0].direction) : null;
    renderDirectionButtons();
    drawSelectedRoute();
    $('#map-status').textContent = '';
  } catch (err) {
    $('#map-status').textContent = `Error cargando la línea: ${err.message}`;
    return;
  }

  startLocationPolling();
}

// Muchas líneas interurbanas solo tienen sentido de ida (un extremo del recorrido, sin
// vuelta por el mismo número de línea) -- en ese caso no tiene sentido mostrar un
// selector con una sola opción.
function renderDirectionButtons() {
  const row = $('#direction-row');
  row.innerHTML = '';
  const itineraries = [...mapState.itinerariesByDirection.values()];
  if (itineraries.length < 2) return;

  for (const it of itineraries) {
    const direction = String(it.direction);
    const btn = document.createElement('button');
    btn.className = 'direction-btn' + (direction === mapState.selectedDirection ? ' active' : '');
    btn.textContent = it.name || `Sentido ${direction}`;
    btn.addEventListener('click', () => selectDirection(direction));
    row.appendChild(btn);
  }
}

function selectDirection(direction) {
  if (direction === mapState.selectedDirection) return;
  mapState.selectedDirection = direction;
  mapState.selectedStop = null;
  renderDirectionButtons();
  drawSelectedRoute();
  mapState.busLayer.clear();
  $('#bus-chip-row').innerHTML = '';
  refreshInfoPanel();
  startLocationPolling(); // reinicia el poll ya mismo, no esperar al siguiente ciclo de 10s
}

function drawSelectedRoute() {
  if (mapState.currentRouteLayer) mapState.currentRouteLayer.remove();
  const itinerary = mapState.itinerariesByDirection.get(mapState.selectedDirection);
  if (!itinerary) return;
  const { group } = drawItineraries(mapState.map, [itinerary], { onStopClick });
  mapState.currentRouteLayer = group;
}

// Al tocar una parada en el mapa: para cada bus activo en el sentido mostrado, calcula
// cuánto le queda para llegar a ESA parada en concreto (no la más cercana al bus, la que
// se ha tocado), recorriendo la secuencia de paradas hacia delante desde donde está cada
// bus ahora mismo. Sustituye cualquier bus seleccionado -- solo se muestra un panel a la
// vez, o el de un bus o el de una parada.
function onStopClick(stop) {
  mapState.busLayer.clearSelection();
  mapState.selectedStop = stop;
  refreshInfoPanel();
}

function computeStopArrivals(stop) {
  const itinerary = mapState.itinerariesByDirection.get(mapState.selectedDirection);
  if (!itinerary) return [];

  const stopIndex = itinerary.stops.findIndex((s) => s.codStop === stop.codStop);
  if (stopIndex === -1) return [];

  const arrivals = [];
  for (const v of mapState.busLayer.getAllStates()) {
    const distance = distanceToStopAhead({ lat: v.lat, lon: v.lon }, itinerary.stops, stopIndex);
    if (distance === null) continue; // este bus ya dejó atrás esta parada en su pasada actual

    const speed = v.speedMps && v.speedMps > 0.3 ? v.speedMps : DEFAULT_SPEED_MPS;
    arrivals.push(Math.max(0, Math.round(distance / speed / 60)));
  }
  return arrivals.sort((a, b) => a - b);
}

function startLocationPolling() {
  stopLocationPolling();
  mapState.pollCancel = startPollLoop(async () => {
    try {
      const { vehicles: allVehicles, updatedAt } = await api.getLineLocation(mapState.codLine);
      const vehicles = allVehicles.filter((v) => String(v.direction) === mapState.selectedDirection);
      mapState.busLayer.update(vehicles);
      renderBusChips(vehicles);
      refreshInfoPanel();
      const time = new Date(updatedAt).toLocaleTimeString('es-ES');
      $('#map-status').textContent = vehicles.length
        ? `${vehicles.length} bus(es) en este sentido · actualizado ${time}`
        : `Sin vehículos en este sentido ahora mismo · actualizado ${time}`;
    } catch (err) {
      $('#map-status').textContent = `No se pudo actualizar la posición: ${err.message}`;
    }
  }, POLL_MS);
}

function stopLocationPolling() {
  if (mapState.pollCancel) mapState.pollCancel();
  mapState.pollCancel = null;
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
  if (id) mapState.selectedStop = null; // un bus y una parada no se muestran a la vez
  refreshInfoPanel();
}

// Un único panel abajo del mapa para dos cosas mutuamente excluyentes: el bus
// seleccionado (próxima parada) o la parada seleccionada (llegada de cada bus activo).
function refreshInfoPanel() {
  if (mapState.busLayer.selectedId) return renderBusInfo(mapState.busLayer.selectedId);
  if (mapState.selectedStop) return renderStopInfo(mapState.selectedStop);
  $('#bus-info-panel').classList.add('hidden');
}

function renderBusInfo(id) {
  const panel = $('#bus-info-panel');
  const content = $('#bus-info-content');
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
  const etaMin = Math.max(0, Math.round(next.distanceToNextStopMeters / speed / 60));

  content.innerHTML = `
    <strong>Próxima parada:</strong> ${next.nextStop.name || next.nextStop.codStop}<br/>
    <span class="result-sub">~${etaMin} min (estimado por posición y velocidad, no es una hora programada de CRTM)</span>
  `;
}

function renderStopInfo(stop) {
  const panel = $('#bus-info-panel');
  const content = $('#bus-info-content');
  panel.classList.remove('hidden');

  const etas = computeStopArrivals(stop);
  if (!etas.length) {
    content.innerHTML = `
      <strong>${stop.name || stop.codStop}</strong>
      <div class="result-sub">Ningún bus de este sentido va hacia esta parada ahora mismo</div>
    `;
    return;
  }

  const rows = etas.map((min, i) => `<div>${i + 1}ª llegada: ~${min} min</div>`).join('');
  content.innerHTML = `
    <strong>${stop.name || stop.codStop}</strong>
    ${rows}
    <span class="result-sub">Estimado por posición y velocidad de cada bus, no es una hora programada de CRTM</span>
  `;
}

$('#map-back').addEventListener('click', () => {
  stopLocationPolling();
  showScreen('#screen-home');
});

$('#map-refresh').addEventListener('click', () => startLocationPolling());

/* ---------- Pantalla de parada (búsqueda por parada) ---------- */

const stopState = { codStop: null, pollCancel: null, arrivals: [] };

async function openStop(stop) {
  showScreen('#screen-stop');
  $('#stop-name').textContent = stop.name || stop.codStop;
  $('#stop-filter').value = '';
  stopState.codStop = stop.codStop;
  startStopPolling();
}

function startStopPolling() {
  stopStopPolling();
  stopState.pollCancel = startPollLoop(async () => {
    try {
      const { arrivals } = await api.getStopTimes(stopState.codStop);
      stopState.arrivals = arrivals;
      applyStopFilter();
      $('#stop-status').textContent = `Actualizado ${new Date().toLocaleTimeString('es-ES')}`;
    } catch (err) {
      $('#stop-status').textContent = `No se pudo actualizar: ${err.message}`;
    }
  }, POLL_MS);
}

function stopStopPolling() {
  if (stopState.pollCancel) stopState.pollCancel();
  stopState.pollCancel = null;
}

// Una parada de paso puede tener decenas de líneas; el filtro es solo del lado del
// cliente sobre lo último ya cargado (stopState.arrivals), sin volver a llamar a CRTM.
function applyStopFilter() {
  const q = $('#stop-filter').value.trim().toLowerCase();
  const filtered = q
    ? stopState.arrivals.filter((a) => a.line.toLowerCase().includes(q) || a.destination.toLowerCase().includes(q))
    : stopState.arrivals;
  renderArrivals(filtered);
}

// CRTM puede dar una llegada dentro de muchas horas (p.ej. el primer servicio de la
// mañana en una línea que ya no pasa esta noche) -- en minutos sueltos, un número grande
// parece un error en vez de "queda mucho". A partir de 1h se muestra en horas y minutos.
function formatEta(seconds) {
  if (seconds === null) return '—';
  if (seconds < 60) return '<1 min';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours} h ${mins} min` : `${hours} h`;
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
    const etaText = formatEta(a.secondsToArrival);
    li.innerHTML = `
      <span class="result-badge">${a.line}</span>
      <span class="result-desc">${a.destination}</span>
      <span class="arrival-eta">${etaText}</span>
    `;
    if (a.codLine) {
      li.classList.add('clickable');
      li.addEventListener('click', () => openArrivalOnMap(a));
    }
    list.appendChild(li);
  }
}

// Lleva al mapa de esa línea, con el sentido de esta llegada ya puesto (dato fiable, viene
// de la propia llegada). NO selecciona ningún bus automáticamente, ni siquiera si solo hay
// uno visible en ese sentido: reportado en vivo que la llegada prevista por CRTM a veces no
// se corresponde con ningún vehículo visible en una posición razonable (ninguno, uno que ya
// pasó la parada, o uno a mucha más distancia de la que cuadraría con esos minutos) -- son
// dos sistemas de CRTM independientes (predicción de horario vs. vehículos con seguimiento
// SAE activo ahora mismo) que no siempre casan entre sí. Dar por hecho "el único visible es
// el tuyo" sería una falsa seguridad; se deja elegir de la lista de chips, sabiendo que es
// una elección manual.
async function openArrivalOnMap(arrival) {
  stopStopPolling();
  await openLine({ codLine: arrival.codLine, shortDescription: arrival.line, description: '' });

  const direction = String(arrival.direction);
  if (mapState.itinerariesByDirection.has(direction)) selectDirection(direction);
}

$('#stop-filter').addEventListener('input', applyStopFilter);

$('#stop-back').addEventListener('click', () => {
  stopStopPolling();
  showScreen('#screen-home');
});

$('#stop-refresh').addEventListener('click', () => startStopPolling());

/* ---------- Arranque ---------- */

setupTabs();
setupLineSearch();
setupStopSearch();
initHomeMap();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('SW no registrado:', err));
  });
}
