import { asArray } from './crtmClient.js';

// Formato real de GetLineLocation.php confirmado en vivo (ver README):
//
// { "vehiclesLocation": { "VehicleLocation": { ... } | [{ ... }, ...] } }
//
// donde cada VehicleLocation trae codVehicle (id estable, ej. "0129MKN") y
// coordinates:{latitude,longitude} -- pero SIN ningún campo de rumbo/heading/bearing. El
// icono del bus en el frontend no rota por rumbo GPS: se espeja según el sentido de la
// línea (direction, que sí es un dato fiable de CRTM -- ver README y public/js/busIcon.js).
export function extractVehicles(rawResponse) {
  const list = asArray(rawResponse?.vehiclesLocation?.VehicleLocation);

  return list
    .map((v) => ({
      id: v.codVehicle,
      lat: Number(v.coordinates?.latitude),
      lon: Number(v.coordinates?.longitude),
    }))
    .filter((v) => v.id && Number.isFinite(v.lat) && Number.isFinite(v.lon));
}
