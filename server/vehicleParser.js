// GetLineLocation.php no está documentado en ningún sitio público que se haya podido
// encontrar (ni en los wrappers de terceros que sí documentan el resto de la API CRTM).
// En vez de asumir un formato exacto, esto recorre la respuesta buscando objetos que
// "parezcan" un vehículo (tienen un par de campos de coordenadas reconocibles) y los
// normaliza. Es deliberadamente tolerante: cuando se confirme el formato real con una
// respuesta de verdad (ver GET /api/debug/line-location), esto se puede simplificar a un
// acceso directo por clave.

const LAT_KEYS = ['latitude', 'Latitude', 'lat', 'Lat'];
const LON_KEYS = ['longitude', 'Longitude', 'lon', 'lng', 'Lon'];
const COORD_CONTAINER_KEYS = ['coordinates', 'coordinate', 'position', 'location'];
const HEADING_KEYS = ['bearing', 'Bearing', 'heading', 'Heading', 'rumbo', 'course', 'azimuth', 'angle'];
const HEADING_CONTAINER_KEYS = ['coordinates', 'coordinate', 'position', 'location'];
const ID_KEYS = ['codVehicle', 'codBus', 'vehicleCode', 'busId', 'codVehiculo', 'id', 'Id', 'ID'];
const MAX_DEPTH = 6;

function firstNumeric(obj, keys) {
  for (const key of keys) {
    const value = obj[key];
    if (value === undefined || value === null || value === '') continue;
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

function firstDefined(obj, keys) {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function extractLatLon(obj) {
  let lat = firstNumeric(obj, LAT_KEYS);
  let lon = firstNumeric(obj, LON_KEYS);

  if (lat === undefined || lon === undefined) {
    for (const containerKey of COORD_CONTAINER_KEYS) {
      const container = obj[containerKey];
      if (container && typeof container === 'object') {
        lat = lat ?? firstNumeric(container, LAT_KEYS);
        lon = lon ?? firstNumeric(container, LON_KEYS);
      }
    }
  }
  return { lat, lon };
}

function extractHeading(obj) {
  let heading = firstNumeric(obj, HEADING_KEYS);
  if (heading === undefined) {
    for (const containerKey of HEADING_CONTAINER_KEYS) {
      const container = obj[containerKey];
      if (container && typeof container === 'object') {
        heading = heading ?? firstNumeric(container, HEADING_KEYS);
      }
    }
  }
  return heading;
}

function looksLikeVehicle(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const { lat, lon } = extractLatLon(obj);
  // Coordenadas plausibles en la Comunidad de Madrid, para descartar falsos positivos de
  // otros pares de números que no sean una posición GPS.
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat > 39.5 &&
    lat < 41.5 &&
    lon > -5 &&
    lon < -2.5
  );
}

function walk(node, depth, found) {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return;

  if (looksLikeVehicle(node)) {
    found.push(node);
    return; // no seguir bajando dentro de un objeto ya identificado como vehículo
  }

  const children = Array.isArray(node) ? node : Object.values(node);
  for (const child of children) {
    if (child && typeof child === 'object') walk(child, depth + 1, found);
  }
}

// Devuelve [{ id, lat, lon, heading, raw }]. `id` es estable entre polls solo si CRTM
// manda algún campo identificador reconocible (ver ID_KEYS); si no, se deriva de la propia
// posición redondeada (~100m) como mejor esfuerzo -- el frontend lo trata igual, pero
// perderá la animación de movimiento continuo para ese vehículo si se mueve más que eso
// entre polls.
export function extractVehicles(rawResponse) {
  const found = [];
  walk(rawResponse, 0, found);

  return found.map((raw) => {
    const { lat, lon } = extractLatLon(raw);
    const heading = extractHeading(raw);
    const id = firstDefined(raw, ID_KEYS) ?? `pos-${lat.toFixed(3)}-${lon.toFixed(3)}`;
    return {
      id: String(id),
      lat,
      lon,
      heading: heading === undefined ? null : heading,
      raw,
    };
  });
}
