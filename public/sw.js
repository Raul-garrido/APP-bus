// Service worker mínimo: cachea el "app shell" (assets estáticos) para que la PWA instale
// y, si no hay red, siga arrancando con la última versión vista. Los datos en tiempo real
// (/api/*) nunca se cachean aquí -- eso ya lo gestiona el backend (server/cache.js).
//
// Estrategia red-primero (no caché-primero): con la app en desarrollo activo, servir desde
// caché antes que la red hacía que un despliegue nuevo pudiera tardar en verse -- el propio
// sw.js no cambiaba entre despliegues, así que el navegador nunca detectaba que había una
// versión nueva del service worker que instalar. Red primero evita depender de acordarse de
// tocar este archivo en cada cambio; la caché queda solo como red de seguridad sin conexión.
const CACHE_NAME = 'app-bus-shell-v2';

const APP_SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/api.js',
  '/js/map.js',
  '/js/geo.js',
  '/js/busIcon.js',
  '/manifest.json',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/bus-green.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // nunca cachear tiempo real

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
