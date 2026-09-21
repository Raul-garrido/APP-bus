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

## Sobre `GetLineLocation.php`

Este endpoint no está documentado en ningún sitio público conocido (ni siquiera en
`citram-python-api`, que sí documenta con ejemplos el resto de la API CRTM), y el proyecto
`busya` -- otra app que consume esta misma API -- llegó a probarlo y lo quitó de producción
por no poder casarlo de forma fiable con una hora programada cuando hay varios vehículos en
la misma línea+sentido. Ese problema no nos afecta igual: no intentamos casar el vehículo con
`GetStopsTimes.php`, solo pintar su posición y calcular su próxima parada geométricamente
(ver "Decisiones de diseño" más abajo).

**Formato real, confirmado en vivo contra un despliegue con acceso normal a internet**
(la línea 824 en horario de servicio, vía `GET /api/debug/line-location`):

```json
{
  "vehiclesLocation": {
    "VehicleLocation": {
      "codVehicle": "0129MKN",
      "line": { "codLine": "8__824___", "shortDescription": "824", "...": "..." },
      "direction": 1,
      "coordinates": { "longitude": -3.3488597869873047, "latitude": 40.51198196411133 },
      "service": "6766"
    }
  }
}
```

(objeto suelto con un solo vehículo circulando, array de objetos con varios -- mismo patrón
que el resto de la API). Puntos importantes que confirma esta respuesta real:

- `codVehicle` es un identificador estable del vehículo físico (ej. `"0129MKN"`, matrícula o
  similar) -- se usa como `id` para que la animación entre polls sepa qué icono es cuál.
- **No hay ningún campo de rumbo/heading/bearing.** El cálculo del rumbo por el vector entre
  la posición anterior y la nueva (`public/js/map.js`) no es un plan B: es la única fuente
  de orientación del icono.
- `server/vehicleParser.js` ya no necesita heurísticas -- lee directamente
  `vehiclesLocation.VehicleLocation` con el mismo patrón objeto-suelto-o-array del resto de
  `crtmClient.js`.

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
- **ETA de una parada tocada en el mapa** (`public/js/geo.js`, `distanceToStopAhead`): misma
  idea que la próxima parada, pero al revés -- para cada bus activo en el sentido mostrado,
  se calcula la distancia restante hasta la parada tocada (no la más cercana al bus, la que
  elige el usuario) recorriendo la secuencia de paradas hacia delante desde donde está el
  bus ahora. Si el bus ya dejó atrás esa parada en su pasada actual, no se le da ETA para
  ella (`null`). Solo se muestra un panel a la vez: seleccionar un bus quita la parada
  seleccionada y viceversa.
- **Animación del icono**: interpolación manual con `requestAnimationFrame` entre la
  posición anterior y la nueva (no salto brusco), en vez de una transición CSS pura sobre
  el marcador de Leaflet — así no interfiere con el paneo/zoom del mapa, que también mueve
  los marcadores por CSS transform internamente.
- **Icono del bus**: `public/icons/bus-green.png`, generada por el usuario con Gemini (no
  un banco de imágenes de terceros) y con el fondo original eliminado aquí mismo (estaba en
  blanco sólido, no transparente de verdad, pese a que el PNG admitía canal alfa). Solo se
  usa esa única imagen: no rota por un rumbo GPS calculado -- CRTM no lo manda, y además con
  una vista lateral rotar por ángulos intermedios se vería mal (se "tumbaría"). En su lugar
  se espeja (izquierda/derecha) según el **sentido real de la línea** (`direction` 1 o 2,
  dato fiable de CRTM), el mismo que ya usa el selector de ida/vuelta -- así no hace falta
  una segunda imagen para el otro sentido. Si un vehículo físico pasa a cubrir el otro
  sentido entre un servicio y el siguiente, el icono se reespeja solo. El seleccionado se
  distingue con un halo ámbar (`public/js/busIcon.js`).
- **Sentido de circulación (ida/vuelta)**: una línea suele tener dos sentidos (`direction`
  1 y 2 en la API), y algunas además varias variantes de ramal por sentido (paradas "obs[...]"
  distintas para el mismo origen-destino -- la 824 real tiene 3 variantes por sentido). Se
  deduplica a un itinerario representativo por sentido (`itinerariesByDirection` en
  `server/routes.js`) y se muestra un selector cuando hay más de uno; solo se dibuja el
  trazado y se filtran los buses del sentido activo. De paso esto evita pedir la posición
  una vez por cada variante de ramal -- antes se pedía 6 veces para una línea con 3
  variantes por sentido, ahora 2 (una por sentido).
- **Frecuencia de actualización**: 10s. El bucle de polling (`startPollLoop` en `app.js`)
  programa la siguiente vuelta solo cuando termina la actual (éxito o error) en vez de usar
  `setInterval` a ciegas, para que un intervalo corto no acabe solapando peticiones si CRTM
  tarda más de lo normal en responder.
- **Service worker (`public/sw.js`)**: red primero, caché solo como red de seguridad sin
  conexión -- no caché primero. Con caché primero, un despliegue nuevo podía tardar en
  verse en un dispositivo que ya tuviera la PWA instalada: el propio `sw.js` no cambiaba de
  contenido entre despliegues (solo cambiaban los archivos que cacheaba), así que el
  navegador nunca detectaba que había una versión nueva del service worker que instalar, y
  se quedaba sirviendo el primer JS/CSS que vio. Si aun así una versión antigua se queda
  pegada en algún dispositivo, hay que borrar datos del sitio (o desinstalar y reinstalar la
  PWA) una vez -- después ya no debería volver a pasar.
