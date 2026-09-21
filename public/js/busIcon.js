// SVG propio (no una imagen externa, para no depender de ningún banco de imágenes con
// derechos) de un autobús interurbano visto de lado, en el verde real de los interurbanos
// de la Comunidad de Madrid.
//
// A diferencia de un icono cenital, uno lateral no se puede rotar de forma continua por un
// rumbo GPS calculado sin que se vea raro en ángulos intermedios -- así que en vez de eso
// se espeja (izquierda/derecha) según el SENTIDO real de la línea que da CRTM (direction 1
// o 2, dato fiable, a diferencia del rumbo que CRTM no manda -- ver README), no según un
// ángulo calculado.
const COLOR_BODY = '#22a83f';
const COLOR_BODY_DARK = '#146024';
const COLOR_WINDOW = '#1e293b';
const COLOR_SELECTED_STROKE = '#f59e0b';

// Orientación de reposo: el morro (parte redondeada delantera) mira a la derecha.
export function busSvg({ highlighted = false } = {}) {
  const stroke = highlighted ? COLOR_SELECTED_STROKE : COLOR_BODY_DARK;
  const strokeWidth = highlighted ? 2 : 1.2;
  return `
    <svg viewBox="0 0 64 28" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="6" width="52" height="16" rx="6" fill="${COLOR_BODY}" stroke="${stroke}" stroke-width="${strokeWidth}" />
      <path d="M55 9 Q60 9 60 14 Q60 19 55 19 Z" fill="${COLOR_BODY}" stroke="${stroke}" stroke-width="${strokeWidth}" />
      <circle cx="58.5" cy="14" r="1.1" fill="#fef08a" />
      <rect x="1.5" y="12" width="2" height="4" rx="0.5" fill="#dc2626" />
      <rect x="7" y="9" width="7.5" height="7" rx="1.3" fill="${COLOR_WINDOW}" />
      <rect x="16.5" y="9" width="7.5" height="7" rx="1.3" fill="${COLOR_WINDOW}" />
      <rect x="26" y="9" width="7.5" height="7" rx="1.3" fill="${COLOR_WINDOW}" />
      <rect x="35.5" y="9" width="7.5" height="7" rx="1.3" fill="${COLOR_WINDOW}" />
      <rect x="45" y="9" width="7" height="7" rx="1.3" fill="${COLOR_WINDOW}" />
      <rect x="19.5" y="17" width="1.3" height="5" fill="${COLOR_BODY_DARK}" />
      <rect x="22.3" y="17" width="1.3" height="5" fill="${COLOR_BODY_DARK}" />
      <circle cx="15" cy="22" r="4" fill="#1e293b" />
      <circle cx="15" cy="22" r="1.5" fill="#94a3b8" />
      <circle cx="45" cy="22" r="4" fill="#1e293b" />
      <circle cx="45" cy="22" r="1.5" fill="#94a3b8" />
    </svg>
  `;
}

const ICON_SIZE = [40, 18];
const ICON_ANCHOR = [20, 9];

// direction impar (1) usa la orientación de reposo (morro a la derecha); direction par (2)
// se espeja con scaleX(-1) para que mire a la izquierda. Sin direction (no debería pasar,
// CRTM siempre la da) se deja sin espejar.
export function createBusIcon(L, { direction, highlighted = false } = {}) {
  const svg = busSvg({ highlighted });
  const mirror = Number(direction) === 2;
  return L.divIcon({
    className: `bus-marker${highlighted ? ' bus-marker--selected' : ''}`,
    html: `<div class="bus-marker__flip" style="transform: scaleX(${mirror ? -1 : 1})">${svg}</div>`,
    iconSize: ICON_SIZE,
    iconAnchor: ICON_ANCHOR,
  });
}
