// Configuración por juego. Para sumar otro juego de PandaScore alcanza con
// agregar una entrada acá, su slug a la lista GAMES de api/ps.js, sus
// fuentes de noticias en api/news.js y sus textos en i18n/*.json
// (news.games.<id>).
export const GAMES = {
  cs2: {
    id: 'cs2',
    slug: 'csgo', // PandaScore mantiene el slug "csgo" para CS2
    brand: 'CS2',
    name: 'Counter-Strike 2',
    accent: '#f5c542',
    demoFile: 'data/demo.json',
    newsSources: ['HLTV', 'Steam'],
  },
  valorant: {
    id: 'valorant',
    slug: 'valorant',
    brand: 'VAL',
    name: 'Valorant',
    accent: '#ff4655',
    demoFile: 'data/demo-valorant.json',
    newsSources: ['VLR', 'Dexerto'],
  },
  overwatch: {
    id: 'overwatch',
    slug: 'ow',
    brand: 'OW',
    name: 'Overwatch',
    accent: '#f99e1a',
    demoFile: 'data/demo-overwatch.json',
    newsSources: ['Steam', 'Dexerto'],
  },
};

export const DEFAULT_GAME = 'cs2';
