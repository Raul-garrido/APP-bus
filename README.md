# Bus CRTM en vivo

PWA que muestra en un mapa la posición en tiempo real de los autobuses interurbanos de
la Comunidad de Madrid (CRTM), con un icono de autobús orientado según su rumbo real.

## Arrancar

```bash
npm install
npm start        # http://localhost:3000
```

Node 18+ (usa `fetch` nativo, sin dependencias de red adicionales en el backend aparte de
Express). No hace falta build ni bundler: el frontend es JS vanilla con módulos ES nativos
del navegador, y Leaflet está vendorizado como archivos estáticos en `public/vendor/leaflet`
(copiados de `node_modules/leaflet/dist`, no se cargan desde `node_modules` en tiempo de
ejecución) — así sirve igual en local y en Vercel, sin depender de un CDN externo.

## Desplegar en Vercel

El proyecto ya está preparado para desplegarse tal cual en Vercel, sin configuración
adicional más allá de conectar el repo:

- `api/[...path].js` expone la misma app de Express (`server/app.js`) como función
  serverless — Vercel enruta ahí cualquier petición bajo `/api/*`.
- `public/` se sirve automáticamente como estático (Vercel lo detecta por convención).
- `vercel.json` solo fija `maxDuration: 10` en las funciones, coherente con los timeouts
  de las llamadas a CRTM (8s) en `crtmClient.js`.

La caché en memoria (`server/cache.js`) pierde eficacia en serverless (cada invocación
puede ser una instancia distinta, sin memoria compartida) — no es un problema funcional,
solo hace más llamadas de las estrictamente necesarias a `GetLines.php`/`GetLinesInformation.php`.

## Estructura

```
api/
  [...path].js       Adaptador para Vercel: expone server/app.js como función serverless
server/
  app.js              Configura la app de Express (rutas + estáticos) -- la usan tanto
                      server/index.js (local) como api/[...path].js (Vercel)
  index.js            Arranque local: app.listen(PORT), usado por `npm start`
  routes.js           Endpoints propios (ver abajo)
  crtmClient.js        Llamadas a la API de CRTM (crtm.es/widgets/api)
  vehicleParser.js     Parseo defensivo de GetLineLocation.php (ver "Sobre GetLineLocation.php")
  cache.js              Caché en memoria con TTL, sin dependencias
public/
  index.html, css/, js/     Frontend: buscador, mapa Leaflet, iconos de bus, polling
  vendor/leaflet/            Leaflet vendorizado (JS+CSS+imágenes), sin CDN externo
  manifest.json, sw.js       PWA: instalable, cachea el app shell (nunca /api/*)
```

## Endpoints propios (proxy a CRTM)

| Endpoint | Caché | Qué hace |
|---|---|---|
| `GET /api/lines?q=` | 1h | Líneas interurbanas (mode=8), filtradas por texto |
| `GET /api/lines/:codLine` | 1h | Itinerarios y paradas (con coordenadas) de una línea |
| `GET /api/lines/:codLine/location` | sin caché | Posición en vivo de los buses de esa línea (ambos sentidos) |
| `GET /api/stops?q=` | 2 min | Búsqueda de paradas |
| `GET /api/stops/:codStop/times` | sin caché | Próximos pasos en tiempo real por esa parada |
| `GET /api/debug/line-location?codItinerary=&codLine=&codStop=&direction=` | sin caché | Passthrough del JSON crudo de `GetLineLocation.php`, sin normalizar |

## Sobre `GetLineLocation.php` (importante)

**Este endpoint no está documentado en ningún sitio público conocido**, ni siquiera en los
wrappers de terceros de esta misma API (se revisó `citram-python-api`, que documenta con
ejemplos reales el resto de endpoints pero no este). El proyecto `busya` (otra app que
consume esta misma API CRTM) llegó a probarlo y lo quitó: según su propio changelog, CRTM
"no da ninguna forma fiable de saber qué vehículo concreto corresponde a qué hora
programada" cuando hay varios vehículos en la misma línea+sentido.

Este proyecto **no pudo hacer una petición de prueba real** contra `crtm.es` durante el
desarrollo (el entorno donde se generó tenía el tráfico saliente a ese dominio bloqueado a
nivel de red). Por eso `server/vehicleParser.js` no asume un formato exacto: recorre
recursivamente la respuesta buscando objetos que "parezcan" un vehículo (un par de campos
de coordenadas dentro del rango geográfico de Madrid) y prueba varios nombres de campo
candidatos para latitud/longitud/rumbo/id de vehículo (`latitude`/`lat`, anidado bajo
`coordinates`, `bearing`/`heading`/`rumbo`, `codVehicle`/`id`...).

**Antes de dar esto por bueno en producción**, prueba en una máquina con acceso real a
internet:

```bash
curl "http://localhost:3000/api/debug/line-location?codItinerary=<codItinerary>&codLine=<codLine>&codStop=<codStop>&direction=1"
```

(los tres primeros valores salen de `GET /api/lines/<codLine>`, en `itineraries[].codItinerary`,
`itineraries[].direction` y el primer `itineraries[].stops[].codStop`). Si el JSON real no
encaja con lo que `vehicleParser.js` espera, ajústalo con los nombres de campo reales — la
lógica de detección por rango geográfico seguirá sirviendo como red de seguridad mientras
tanto, pero un ajuste con datos reales siempre será más fiable que la heurística.

## Decisiones de diseño

- **Trazado de la línea**: CRTM no da el recorrido como lista de puntos en JSON, solo como
  URL a un `.kmz` aparte por itinerario. Para no añadir un parser de KML a un proyecto
  pequeño, se dibuja una polyline uniendo las paradas en el orden del itinerario (ya viene
  en el sentido de circulación correcto). Es menos fiel a la calle real que el KML, pero
  no añade dependencias ni peticiones extra.
- **Próxima parada / ETA del bus seleccionado**: no se intenta casar el vehículo con una
  hora programada de `GetStopsTimes.php` (ver limitación de arriba). En su lugar se calcula
  geométricamente, a partir de la posición GPS en vivo del bus, cuál es la siguiente parada
  de su itinerario, y se estima el tiempo por distancia/velocidad — la velocidad se calcula
  con las dos últimas posiciones conocidas del propio bus (o un valor de respaldo de 30
  km/h hasta tener una segunda muestra). Se marca explícitamente en la UI como estimado.
- **Animación del icono**: interpolación manual con `requestAnimationFrame` entre la
  posición anterior y la nueva (no salto brusco), en vez de una transición CSS pura sobre
  el marcador de Leaflet — así no interfiere con el paneo/zoom del mapa, que también mueve
  los marcadores por CSS transform internamente.
- **Rumbo del icono**: usa el campo de rumbo de la API si `vehicleParser.js` lo encuentra;
  si no, lo calcula como el ángulo entre la posición anterior y la nueva (con un umbral de
  movimiento mínimo para no hacer temblar el icono cuando el bus está parado).
