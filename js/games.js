// Configuración por juego. Para sumar otro juego de PandaScore alcanza con
// agregar una entrada acá, su slug a la lista GAMES de api/ps.js, sus
// fuentes de noticias en api/news.js, su wiki de Liquipedia (transfers) y
// sus textos en i18n/*.json (news.games.<id>).
export const GAMES = {
  cs2: {
    id: 'cs2',
    slug: 'csgo', // PandaScore mantiene el slug "csgo" para CS2
    brand: 'CS2',
    name: 'Counter-Strike 2',
    accent: '#f5c542',
    demoFile: 'data/demo.json',
    newsSources: ['HLTV', 'Steam'],
    liquipedia: 'counterstrike', // wiki de transfers (scripts/transfers.mjs)
    // Arte de la portada: imagen de la tienda de Steam (se carga desde su CDN)
    art: { src: 'https://cdn.cloudflare.steamstatic.com/steam/apps/730/library_hero.jpg', kind: 'cover', position: '70% 30%', credit: ['Steam', 'https://store.steampowered.com/app/730'] },
    newsLinks: { HLTV: 'https://www.hltv.org', Steam: 'https://store.steampowered.com/app/730' },
  },
  valorant: {
    id: 'valorant',
    slug: 'valorant',
    brand: 'VAL',
    name: 'Valorant',
    accent: '#ff4655',
    demoFile: 'data/demo-valorant.json',
    newsSources: ['VLR', 'Dexerto'],
    liquipedia: 'valorant',
    // Valorant no está en Steam: arte oficial de un agente vía valorant-api.com
    art: { src: 'https://media.valorant-api.com/agents/add6443a-41bd-e414-f6ad-e58d267f4e95/fullportrait.png', kind: 'portrait', credit: ['Riot Games / valorant-api.com', 'https://valorant-api.com'] },
    newsLinks: { VLR: 'https://www.vlr.gg', Dexerto: 'https://www.dexerto.com/valorant/' },
  },
  overwatch: {
    id: 'overwatch',
    slug: 'ow',
    brand: 'OW',
    name: 'Overwatch',
    accent: '#f99e1a',
    demoFile: 'data/demo-overwatch.json',
    newsSources: ['Steam', 'Dexerto'],
    liquipedia: 'overwatch',
    art: { src: 'https://cdn.cloudflare.steamstatic.com/steam/apps/2357570/library_hero.jpg', kind: 'cover', position: '60% 25%', credit: ['Steam', 'https://store.steampowered.com/app/2357570'] },
    newsLinks: { Steam: 'https://store.steampowered.com/app/2357570', Dexerto: 'https://www.dexerto.com/overwatch/' },
  },
};

export const DEFAULT_GAME = 'cs2';
