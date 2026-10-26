// Íconos de línea (16px, heredan el color del texto)
const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  inicio: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'),
  partidos: svg('<circle cx="12" cy="12" r="8"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
  calendario: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  equipos: svg('<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Z"/>'),
  noticias: svg('<rect x="3" y="4" width="14" height="16" rx="2"/><path d="M17 8h3v10a2 2 0 0 1-2 2H5"/><path d="M7 8h6M7 12h6M7 16h4"/>'),
  aciertos: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  buscar: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  flecha: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  izq: svg('<path d="m15 6-6 6 6 6"/>'),
  der: svg('<path d="m9 6 6 6-6 6"/>'),
};
