import { asArray } from './crtmClient.js';

// Formato real de GetLineLocation.php confirmado en vivo (ver README):
//
// { "vehiclesLocation": { "VehicleLocation": { ... } | [{ ... }, ...] } }
//
// donde cada VehicleLocation trae codVehicle (id estable, ej. "0129MKN"),
// coordinates:{latitude,longitude} y direction -- pero SIN ningún campo de
// rumbo/heading/bearing. Por eso el frontend siempre calcula el rumbo por el vector
// entre la posición anterior y la nueva (ver public/js/map.js), no es un plan B opcional.
export function extractVehicles(rawResponse) {
  const list = asArray(rawResponse?.vehiclesLocation?.VehicleLocation);

  return list
    .map((v) => ({
      id: v.codVehicle,
      lat: Number(v.coordinates?.latitude),
      lon: Number(v.coordinates?.longitude),
      heading: null,
    }))
    .filter((v) => v.id && Number.isFinite(v.lat) && Number.isFinite(v.lon));
}
