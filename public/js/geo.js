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
// circulación), busca en qué tramo entre dos paradas consecutivas está el bus y devuelve
// la parada siguiente (la más adelantada del tramo) junto con la distancia restante hasta
// ella siguiendo la propia línea recta parada-a-parada del tramo (aproximación: no hay
// trazado real de calle, ver README).
export function findNextStop(busPos, stops) {
  if (!stops || stops.length < 2) return null;

  let best = null;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (!Number.isFinite(a.lat) || !Number.isFinite(b.lat)) continue;

    const { t, dist } = closestPointOnSegment(busPos, a, b);
    if (!best || dist < best.dist) {
      const distanceToNextStopMeters = distanceMeters(busPos, b);
      best = { dist, nextStop: b, distanceToNextStopMeters, segmentT: t };
    }
  }
  return best;
}
