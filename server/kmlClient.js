import JSZip from 'jszip';

const FETCH_TIMEOUT_MS = 10000;

async function fetchKmlText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`No se pudo descargar el KML (status ${res.status})`);

  const buffer = Buffer.from(await res.arrayBuffer());

  // La URL termina en .kmz (zip con un .kml dentro), pero por si algún itinerario diera
  // KML sin comprimir se detecta por la cabecera real del archivo ("PK", firma de zip) en
  // vez de fiarse de la extensión.
  const isZip = buffer.length > 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (!isZip) return buffer.toString('utf-8');

  const zip = await JSZip.loadAsync(buffer);
  const kmlEntry = Object.values(zip.files).find((f) => !f.dir && f.name.toLowerCase().endsWith('.kml'));
  if (!kmlEntry) throw new Error('El .kmz no contiene ningún archivo .kml');
  return kmlEntry.async('string');
}

// Extrae todos los bloques <coordinates> del KML -- puede haber varios tramos (ej. un
// MultiGeometry, o observaciones con parada opcional) -- y los convierte en tramos de
// [lat, lon] listos para Leaflet. KML da "lon,lat[,altura]" separado por espacios; aquí se
// invierte a [lat, lon].
export function parseKmlCoordinates(kmlText) {
  const blocks = [...kmlText.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)];

  return blocks
    .map(([, raw]) =>
      raw
        .trim()
        .split(/\s+/)
        .map((triplet) => {
          const [lon, lat] = triplet.split(',').map(Number);
          return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
        })
        .filter(Boolean)
    )
    .filter((segment) => segment.length > 1);
}

// Devuelve los tramos de la ruta real (siguiendo la carretera) de un itinerario, o []
// si algo falla -- el llamador debe tratarlo como "sin datos" y usar su propio respaldo
// (unir las paradas en línea recta), no como un error fatal: es un extra visual, no algo
// de lo que dependa el resto de la app.
export async function getKmlRoute(url) {
  const kmlText = await fetchKmlText(url);
  return parseKmlCoordinates(kmlText);
}
