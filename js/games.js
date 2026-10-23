// Configuración por juego. Para sumar otro juego de PandaScore alcanza con
// agregar una entrada acá y su slug a la lista GAMES de api/ps.js.
export const GAMES = {
  cs2: {
    id: 'cs2',
    slug: 'csgo', // PandaScore mantiene el slug "csgo" para CS2
    label: 'CS2',
    name: 'Counter-Strike 2',
    accent: '#f97316',
  },
};

export const DEFAULT_GAME = 'cs2';
