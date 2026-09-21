// Wrappers finos sobre fetch al backend propio (nunca directo a crtm.es: no tiene CORS).
async function getJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.message || `Error en ${url}`);
  }
  return data;
}

export const api = {
  searchLines: (q) => getJson(`/api/lines?q=${encodeURIComponent(q)}`),
  getLineInfo: (codLine) => getJson(`/api/lines/${encodeURIComponent(codLine)}`),
  getLineLocation: (codLine) => getJson(`/api/lines/${encodeURIComponent(codLine)}/location`),
  searchStops: (q) => getJson(`/api/stops?q=${encodeURIComponent(q)}`),
  getStopTimes: (codStop) => getJson(`/api/stops/${encodeURIComponent(codStop)}/times`),
};
