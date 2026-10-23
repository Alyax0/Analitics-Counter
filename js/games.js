// Configuración por juego. Para sumar otro juego de PandaScore alcanza con
// agregar una entrada acá, su slug a la lista GAMES de api/ps.js y sus
// fuentes de noticias en api/news.js.
export const GAMES = {
  cs2: {
    id: 'cs2',
    slug: 'csgo', // PandaScore mantiene el slug "csgo" para CS2
    brand: 'CS2',
    name: 'Counter-Strike 2',
    accent: '#f97316',
    demoFile: 'data/demo.json',
    news: {
      eyebrow: 'HLTV y Valve',
      sources: [
        { id: 'HLTV', label: 'HLTV' },
        { id: 'Steam', label: 'Actualizaciones de CS2' },
      ],
      footnote: 'Titulares de HLTV.org y anuncios oficiales de Valve en Steam.',
    },
  },
  valorant: {
    id: 'valorant',
    slug: 'valorant',
    brand: 'VAL',
    name: 'Valorant',
    accent: '#ff4655',
    demoFile: 'data/demo-valorant.json',
    news: {
      eyebrow: 'VLR.gg',
      sources: [{ id: 'VLR', label: 'VLR.gg' }],
      footnote: 'Titulares de VLR.gg.',
    },
  },
};

export const DEFAULT_GAME = 'cs2';
