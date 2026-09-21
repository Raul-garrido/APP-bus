// Caché en memoria muy simple con TTL. Sin dependencias ni base de datos: el proceso
// solo necesita sobrevivir entre polls dentro de la misma instancia.
const store = new Map();

export function getCached(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCached(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// Envuelve una función asíncrona con caché por clave. Si hay una petición en vuelo para
// la misma clave, la reutiliza en vez de duplicar la llamada a CRTM (evita ráfagas
// simultáneas cuando varios clientes piden lo mismo a la vez).
const inFlight = new Map();

export async function withCache(key, ttlMs, fetcher) {
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  if (inFlight.has(key)) return inFlight.get(key);

  const promise = fetcher()
    .then((value) => {
      setCached(key, value, ttlMs);
      return value;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}
