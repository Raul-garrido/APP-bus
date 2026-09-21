// Cliente de la API pública de widgets de CRTM (https://www.crtm.es/widgets/api/).
// No requiere API key, pero no manda cabeceras CORS -- de ahí este proxy -- y varios
// endpoints devuelven un objeto suelto en vez de un array de un elemento cuando solo hay
// un resultado. `asArray` normaliza eso en un único sitio.

const CRTM_BASE = 'https://www.crtm.es/widgets/api';
const FETCH_TIMEOUT_MS = 8000;

export const INTERURBAN_MODE = '8';

class CrtmError extends Error {}

async function crtmRequest(path, params) {
  const url = new URL(`${CRTM_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new CrtmError(`CRTM respondió con status ${res.status} en ${path}`);

  const data = await res.json();
  if (data && data.error) {
    throw new CrtmError(data.message || `CRTM devolvió un error en ${path}`);
  }
  return data;
}

// Convierte el patrón "objeto suelto si hay uno solo, array si hay varios" en un array
// siempre, incluyendo el caso de que el campo ni siquiera exista.
export function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function getLines(mode = INTERURBAN_MODE) {
  return crtmRequest('GetLines.php', { mode });
}

export function getLineInformation(codLine) {
  return crtmRequest('GetLinesInformation.php', { codLine, activeItinerary: 1 });
}

export function getStops(customSearch) {
  return crtmRequest('GetStops.php', { customSearch });
}

// method=1 replica el uso ya probado en producción por otra app (busya) que consume esta
// misma API -- el significado real de "method" no está documentado. mode vacío devuelve
// todas las redes mezcladas (Metro/Cercanías/EMT/Interurbano), con una fila repetida por
// cada línea que pasa por cada parada; se filtra y deduplica en routes.js.
export function getNearestStops({ latitude, longitude, precisionMeters }) {
  return crtmRequest('GetNearestStopsByLocation.php', {
    latitude,
    longitude,
    mode: '',
    method: 1,
    precision: precisionMeters,
  });
}

export function getStopsTimes(codStop) {
  return crtmRequest('GetStopsTimes.php', {
    codStop,
    type: 0,
    orderBy: 2,
    stopTimesByIti: '',
  });
}

// codStop es solo una "formalidad" según la documentación no oficial de esta API: vale
// cualquier parada de ese itinerario, el resultado es el mismo (posición de todos los
// vehículos circulando en esa línea+sentido).
export function getLineLocationRaw({ mode = INTERURBAN_MODE, codItinerary, codLine, codStop, direction }) {
  return crtmRequest('GetLineLocation.php', { mode, codItinerary, codLine, codStop, direction });
}

export { CrtmError };
