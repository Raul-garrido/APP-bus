import { Router } from 'express';
import {
  getLines,
  getLineInformation,
  getStops,
  getStopsTimes,
  getLineLocationRaw,
  asArray,
  INTERURBAN_MODE,
  CrtmError,
} from './crtmClient.js';
import { extractVehicles } from './vehicleParser.js';
import { getKmlRoute } from './kmlClient.js';
import { withCache } from './cache.js';

const router = Router();

// Datos "estáticos" (cambian poco: líneas, paradas de una línea) -> caché larga.
const STATIC_TTL_MS = 60 * 60 * 1000; // 1h
// Tiempo real -> sin caché, cada cliente dispara su propio poll.
const NO_CACHE_TTL_MS = 0;

// Muchas líneas interurbanas tienen varias variantes de ramal por sentido (paradas
// "obs[...]" distintas para el mismo origen-destino, ej. la 824 trae 3 itinerarios para
// direction=1 y 3 para direction=2). GetLineLocation.php da la misma respuesta para
// cualquier itinerario de un mismo sentido -- así que para dibujar el mapa y pedir la
// posición de los buses basta con UN itinerario representativo por sentido (el primero
// que llegue), en vez de repetir trabajo por cada variante de ramal.
function itinerariesByDirection(info) {
  const seen = new Map();
  for (const it of asArray(info.itinerary?.Itinerary)) {
    const direction = String(it.direction);
    if (seen.has(direction)) continue;
    seen.set(direction, {
      codItinerary: it.codItinerary,
      name: it.name,
      direction: it.direction,
      kml: it.kml,
      stops: asArray(it.stops?.StopInformation).map((stop) => ({
        codStop: stop.codStop,
        shortCodStop: stop.shortCodStop,
        name: stop.name,
        lat: stop.coordinates?.latitude,
        lon: stop.coordinates?.longitude,
      })),
    });
  }
  return [...seen.values()];
}

function handleErrors(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const status = err instanceof CrtmError ? 502 : 500;
      console.error(`[${req.method} ${req.originalUrl}]`, err.message);
      res.status(status).json({ error: true, message: err.message });
    }
  };
}

// GET /api/lines -> todas las líneas interurbanas (mode=8), opcionalmente filtradas por
// número o texto en el propio servidor para no mandar el listado completo cada vez.
router.get(
  '/lines',
  handleErrors(async (req, res) => {
    const data = await withCache('lines:8', STATIC_TTL_MS, () => getLines(INTERURBAN_MODE));
    let lines = asArray(data?.lines?.Line);

    const q = (req.query.q || '').trim().toLowerCase();
    if (q) {
      lines = lines.filter(
        (line) =>
          line.shortDescription?.toLowerCase().includes(q) ||
          line.description?.toLowerCase().includes(q)
      );
    }

    res.set('Cache-Control', 'public, max-age=300');
    res.json({ lines });
  })
);

// GET /api/lines/:codLine -> itinerarios + paradas (con coordenadas) de una línea.
router.get(
  '/lines/:codLine',
  handleErrors(async (req, res) => {
    const { codLine } = req.params;
    const data = await withCache(`lineInfo:${codLine}`, STATIC_TTL_MS, () =>
      getLineInformation(codLine)
    );
    const info = data?.lines?.LineInformation;
    if (!info) return res.status(404).json({ error: true, message: 'Línea no encontrada' });

    const itineraries = await Promise.all(
      itinerariesByDirection(info).map(async ({ kml, ...it }) => {
        let routeSegments = [];
        if (kml) {
          try {
            routeSegments = await withCache(`kmlRoute:${it.codItinerary}`, STATIC_TTL_MS, () => getKmlRoute(kml));
          } catch (err) {
            // Ver kmlClient.js: si falla, el frontend cae de vuelta a unir las paradas en
            // línea recta -- no es un error del que dependa el resto de la respuesta.
            console.error(`No se pudo cargar el KML de ${it.codItinerary}:`, err.message);
          }
        }
        return { ...it, routeSegments };
      })
    );

    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      codLine: info.codLine,
      shortDescription: info.shortDescription,
      description: info.description,
      colorLine: info.colorLine,
      textColorLine: info.text_colorLine,
      itineraries,
    });
  })
);

// GET /api/lines/:codLine/location -> posición en vivo de todos los vehículos de la
// línea, en las dos direcciones. Se necesita conocer los itinerarios primero (por eso
// depende de /api/lines/:codLine, que ya está cacheado) porque GetLineLocation.php pide
// codItinerary + un codStop cualquiera de esa dirección + direction.
router.get(
  '/lines/:codLine/location',
  handleErrors(async (req, res) => {
    const { codLine } = req.params;
    const infoData = await withCache(`lineInfo:${codLine}`, STATIC_TTL_MS, () =>
      getLineInformation(codLine)
    );
    const info = infoData?.lines?.LineInformation;
    if (!info) return res.status(404).json({ error: true, message: 'Línea no encontrada' });

    const itineraries = itinerariesByDirection(info);

    const perDirection = await Promise.all(
      itineraries.map(async (it) => {
        const firstStop = it.stops[0];
        if (!firstStop) return { direction: it.direction, vehicles: [] };

        try {
          const raw = await getLineLocationRaw({
            codItinerary: it.codItinerary,
            codLine,
            codStop: firstStop.codStop,
            direction: it.direction,
          });
          const vehicles = extractVehicles(raw).map((v) => ({
            id: v.id,
            lat: v.lat,
            lon: v.lon,
            heading: v.heading,
          }));
          return { direction: it.direction, vehicles };
        } catch (err) {
          console.error(`GetLineLocation falló para ${codLine} dirección ${it.direction}:`, err.message);
          return { direction: it.direction, vehicles: [] };
        }
      })
    );

    const vehicles = perDirection.flatMap(({ direction, vehicles }) =>
      vehicles.map((v) => ({ ...v, direction }))
    );

    res.set('Cache-Control', 'no-store');
    res.json({ vehicles, updatedAt: new Date().toISOString() });
  })
);

// GET /api/stops?q=texto -> búsqueda de paradas por texto/código/municipio.
router.get(
  '/stops',
  handleErrors(async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ stops: [] });

    const data = await withCache(`stopsSearch:${q.toLowerCase()}`, 5 * 60 * 1000, () => getStops(q));
    const stops = asArray(data?.stops?.Stop).map((stop) => ({
      codStop: stop.codStop,
      shortCodStop: stop.shortCodStop,
      name: stop.name,
      address: stop.address,
      lat: stop.coordinates?.latitude,
      lon: stop.coordinates?.longitude,
      lines: asArray(stop.codLines?.Line).map((l) => (typeof l === 'string' ? l : l.shortDescription)),
    }));

    res.set('Cache-Control', 'public, max-age=120');
    res.json({ stops });
  })
);

// GET /api/stops/:codStop/times -> próximos pasos en tiempo real por esa parada.
router.get(
  '/stops/:codStop/times',
  handleErrors(async (req, res) => {
    const { codStop } = req.params;
    const data = await getStopsTimes(codStop);
    const stopTimes = data?.stopTimes;
    if (!stopTimes) return res.status(404).json({ error: true, message: 'Parada no encontrada' });

    const now = Number.isFinite(Date.parse(stopTimes.actualDate))
      ? Date.parse(stopTimes.actualDate)
      : Date.now();

    const arrivals = asArray(stopTimes.times?.Time).map((t) => {
      const parsed = Date.parse(t.time);
      const secondsToArrival = Number.isFinite(parsed) ? Math.max(0, Math.round((parsed - now) / 1000)) : null;
      return {
        line: t.line?.shortDescription ?? '',
        destination: t.destination ?? '',
        direction: t.direction,
        secondsToArrival,
      };
    });

    res.set('Cache-Control', 'no-store');
    res.json({
      stopName: stopTimes.stop?.name ?? null,
      arrivals,
    });
  })
);

// Passthrough sin normalizar, para poder inspeccionar en vivo el JSON real de
// GetLineLocation.php (formato no documentado -- ver README) y ajustar vehicleParser.js
// con datos reales en vez de suposiciones.
router.get(
  '/debug/line-location',
  handleErrors(async (req, res) => {
    const { codItinerary, codLine, codStop, direction } = req.query;
    if (!codItinerary || !codLine || !codStop || !direction) {
      return res.status(400).json({
        error: true,
        message: 'Parámetros requeridos: codItinerary, codLine, codStop, direction',
      });
    }
    const raw = await getLineLocationRaw({ codItinerary, codLine, codStop, direction });
    res.set('Cache-Control', 'no-store');
    res.json(raw);
  })
);

export default router;
