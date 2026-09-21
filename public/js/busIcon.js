// Icono del bus: imagen propia (generada por el usuario, fondo original eliminado -- ver
// public/icons/bus-green.png) de un autobús interurbano visto de lado, en verde.
//
// No es un dibujo cenital: con una vista lateral no tiene sentido rotar por un ángulo de
// rumbo calculado (se vería "tumbado" en ángulos intermedios). En su lugar se espeja según
// el SENTIDO real de la línea que da CRTM (direction 1 o 2, dato fiable -- a diferencia del
// rumbo, que CRTM no manda en ningún caso, ver README).
const BUS_IMAGE_URL = '/icons/bus-green.png';
const ICON_SIZE = [48, 16];
const ICON_ANCHOR = [24, 8];

// Orientación de reposo de la imagen: el morro mira a la derecha (direction 1). direction
// par (2) se espeja con scaleX(-1) para que mire a la izquierda. Sin direction (no debería
// pasar, CRTM siempre la da) se deja sin espejar.
export function createBusIcon(L, { direction, highlighted = false } = {}) {
  const mirror = Number(direction) === 2;
  return L.divIcon({
    className: `bus-marker${highlighted ? ' bus-marker--selected' : ''}`,
    html: `<div class="bus-marker__flip" style="transform: scaleX(${mirror ? -1 : 1})"><img src="${BUS_IMAGE_URL}" alt="" /></div>`,
    iconSize: ICON_SIZE,
    iconAnchor: ICON_ANCHOR,
  });
}
