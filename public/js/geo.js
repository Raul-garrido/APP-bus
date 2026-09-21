// Cálculos geométricos para: rotar el icono del bus (rumbo), y estimar la próxima parada
// del bus seleccionado cuando CRTM no permite casarlo de forma fiable con una hora
// programada (ver README: por qué no usamos GetStopsTimes para esto).

const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

export function distanceMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Rumbo (0-360, 0=norte) del vector a -> b. Se usa como respaldo cuando la API no manda
// rumbo del vehículo: se calcula entre la posición anterior y la nueva.
export function bearingDegrees(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Proyección plana equirrectangular, válida para distancias cortas (una línea de autobús
// dentro de la Comunidad de Madrid) sin necesitar trigonometría esférica completa aquí.
function project(p, origin) {
  const x = toRad(p.lon - origin.lon) * Math.cos(toRad(origin.lat)) * EARTH_RADIUS_M;
  const y = toRad(p.lat - origin.lat) * EARTH_RADIUS_M;
  return { x, y };
}

function closestPointOnSegment(p, a, b) {
  const origin = a;
  const P = project(p, origin);
  const A = { x: 0, y: 0 };
  const B = project(b, origin);

  const abx = B.x - A.x;
  const aby = B.y - A.y;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((P.x - A.x) * abx + (P.y - A.y) * aby) / lenSq));

  const closest = { x: A.x + t * abx, y: A.y + t * aby };
  const dist = Math.hypot(P.x - closest.x, P.y - closest.y);
  return { t, dist };
}

// Dado un bus y las paradas ordenadas de SU itinerario (ya vienen en el sentido de
// circulación), busca en qué tramo entre dos paradas consecutivas está el bus ahora mismo.
// Es la base tanto de "próxima parada" como de "cuándo llega a la parada X" -- ambas
// necesitan saber primero dónde está el bus dentro de la secuencia de paradas.
function locateOnRoute(busPos, stops) {
  if (!stops || stops.length < 2) return null;

  let best = null;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (!Number.isFinite(a.lat) || !Number.isFinite(b.lat)) continue;

    const { dist } = closestPointOnSegment(busPos, a, b);
    if (!best || dist < best.dist) best = { segmentIndex: i, dist };
  }
  return best;
}

// Próxima parada del bus (aproximación en línea recta parada-a-parada del tramo en el que
// está, no el trazado real de la calle -- ver README).
export function findNextStop(busPos, stops) {
  const loc = locateOnRoute(busPos, stops);
  if (!loc) return null;

  const nextStop = stops[loc.segmentIndex + 1];
  return { nextStop, distanceToNextStopMeters: distanceMeters(busPos, nextStop) };
}

// Distancia (metros) desde la posición actual del bus hasta la parada de índice
// targetIndex, recorriendo la secuencia de paradas hacia delante. Devuelve null si esa
// parada ya quedó atrás en esta pasada (el bus ya la dejó atrás, o es la parada en la que
// está parado ahora mismo) -- en ese caso no tiene sentido dar un ETA para ella.
export function distanceToStopAhead(busPos, stops, targetIndex) {
  const loc = locateOnRoute(busPos, stops);
  if (!loc || targetIndex <= loc.segmentIndex) return null;

  let total = distanceMeters(busPos, stops[loc.segmentIndex + 1]);
  for (let i = loc.segmentIndex + 1; i < targetIndex; i++) {
    total += distanceMeters(stops[i], stops[i + 1]);
  }
  return total;
}
