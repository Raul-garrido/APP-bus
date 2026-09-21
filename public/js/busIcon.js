// SVG de un autobús visto desde arriba (cenital), pensado para rotar con CSS según el
// rumbo. El "morro" del bus apunta hacia arriba (norte, 0°) en su orientación de reposo,
// así que rotar `heading` grados en sentido horario lo orienta correctamente.
//
// Color deliberadamente distinto del azul de la ruta/paradas (#2563eb / #1e3a8a) para que
// se distinga a simple vista sobre el trazado. El seleccionado usa un color distinto (no
// solo un halo) para que se note incluso con varios buses juntos en pantalla.
const COLOR_NORMAL = '#f97316'; // naranja
const COLOR_SELECTED = '#dc2626'; // rojo

export function busSvg({ highlighted = false } = {}) {
  const color = highlighted ? COLOR_SELECTED : COLOR_NORMAL;
  const stroke = highlighted ? '#7f1d1d' : '#7c2d12';
  const strokeWidth = highlighted ? 2.5 : 1.5;
  return `
    <svg viewBox="0 0 24 40" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="2" width="16" height="34" rx="5" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}" />
      <rect x="6.5" y="6" width="11" height="6" rx="1.5" fill="#bfdbfe" />
      <rect x="6.5" y="14" width="4.5" height="4" rx="1" fill="#bfdbfe" />
      <rect x="13" y="14" width="4.5" height="4" rx="1" fill="#bfdbfe" />
      <rect x="6.5" y="20" width="4.5" height="4" rx="1" fill="#bfdbfe" />
      <rect x="13" y="20" width="4.5" height="4" rx="1" fill="#bfdbfe" />
      <rect x="6.5" y="26" width="11" height="5" rx="1" fill="#93c5fd" />
      <polygon points="12,0 16,6 8,6" fill="${stroke}" />
    </svg>
  `;
}

const ICON_SIZE = [24, 40];
const ICON_ANCHOR = [12, 20];

// L.divIcon con dos capas: una envolvente fija (la que Leaflet mueve/traslada al hacer
// setLatLng, con transición CSS para animar el desplazamiento) y una interna que solo
// rota (el rumbo no debe afectar a la traslación). Mezclar ambas transformaciones en el
// mismo nodo rompería la animación de Leaflet, de ahí la doble capa.
export function createBusIcon(L, { heading = 0, highlighted = false } = {}) {
  const svg = busSvg({ highlighted });
  return L.divIcon({
    className: `bus-marker${highlighted ? ' bus-marker--selected' : ''}`,
    html: `<div class="bus-marker__rotate" style="transform: rotate(${heading}deg)">${svg}</div>`,
    iconSize: ICON_SIZE,
    iconAnchor: ICON_ANCHOR,
  });
}

export function updateBusIconRotation(markerElement, heading) {
  const rotateEl = markerElement?.querySelector('.bus-marker__rotate');
  if (rotateEl) rotateEl.style.transform = `rotate(${heading}deg)`;
}
