// Noticias por juego (?game=cs2|valorant|overwatch):
// - CS2: titulares de HLTV (RSS) y notas de parche oficiales de Valve (Steam)
// - Valorant: titulares de VLR.gg y Dexerto (RSS)
// - Overwatch: anuncios oficiales de Blizzard (Steam) y titulares de Dexerto (RSS)
// Solo se devuelven título, resumen corto, fecha, imagen de portada (si hay) y
// enlace a la fuente original.
//
// Cada fuente es independiente: si una falla, se devuelven las demás.

const HLTV_RSS = 'https://www.hltv.org/rss/news';
const VLR_RSS = 'https://www.vlr.gg/rss';
const DEXERTO_OW_RSS = 'https://www.dexerto.com/feed/category/overwatch/';
const DEXERTO_VAL_RSS = 'https://www.dexerto.com/feed/category/valorant/';
// appid de cada juego en Steam (730 = CS2, 2357570 = Overwatch)
const steamNewsUrl = (appid) =>
  `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=10&feeds=steam_community_announcements`;
const TIMEOUT_MS = 6000;
const UA = 'Mozilla/5.0 (compatible; CS2STATS/1.0; +https://analitics-counter.vercel.app)';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

function decode(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}

function shorten(text, max = 180) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : clean;
}

// Las notas de parche vienen en BBCode: "[p]\[ UI ][/p][list][*][p]Ítem[/p]...".
// Se convierten a "UI: Ítem · Ítem" para el resumen.
function steamSummary(raw) {
  const parts = decode(String(raw || ''))
    .replace(/\\\[\s*([^\]]+?)\s*\]/g, '\u0001$1:\u0001')
    .replace(/\[[^\]]*\]|<[^>]*>/g, '\u0001')
    .split('\u0001')
    .map((s) => s.trim())
    .filter(Boolean);
  let out = '';
  for (const p of parts) out += out ? (out.endsWith(':') ? ' ' : ' · ') + p : p;
  return shorten(out);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

// Imagen de portada: solo https; si no hay, la página muestra un degradado
function httpsOrNull(url) {
  return /^https:\/\/[^\s"'<>]+$/.test(url || '') ? url : null;
}

// RSS genérico: solo se aceptan enlaces del sitio de origen
async function rss(feedUrl, source, origin, limit = 10) {
  const xml = await fetchText(feedUrl);
  const items = [];
  for (const [, body] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (name) => decode((body.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1] || '');
    const url = tag('link');
    const date = new Date(tag('pubDate'));
    if (!url.startsWith(origin) || isNaN(date)) continue;
    // HLTV usa <media:content>, Dexerto <enclosure> y <media:thumbnail>; VLR no trae imagen
    const media = body.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*\burl="([^"]+)"/);
    items.push({
      source,
      kind: 'Noticia',
      title: tag('title'),
      summary: shorten(tag('description')),
      url,
      image: httpsOrNull(media && decode(media[1])),
      date: date.toISOString(),
    });
  }
  if (!items.length) throw new Error('RSS sin noticias');
  return items.slice(0, limit);
}

const hltv = () => rss(HLTV_RSS, 'HLTV', 'https://www.hltv.org/');
const vlr = () => rss(VLR_RSS, 'VLR', 'https://www.vlr.gg/', 20);
const dexertoOw = () => rss(DEXERTO_OW_RSS, 'Dexerto', 'https://www.dexerto.com/');
const dexertoVal = () => rss(DEXERTO_VAL_RSS, 'Dexerto', 'https://www.dexerto.com/');

// Primera imagen del anuncio: [img src="{STEAM_CLAN_IMAGE}/..."] o la miniatura
// de un video [previewyoutube="id;full"]. Las notas de parche de CS2 no traen.
function steamImage(raw) {
  const text = String(raw || '');
  const img = text.match(/\[img(?: src=)?"?\]?\s*\{STEAM_CLAN_IMAGE\}(\/[^\s"\[\]]+)/);
  if (img) return httpsOrNull(`https://clan.akamai.steamstatic.com/images${img[1]}`);
  const yt = text.match(/previewyoutube="([\w-]{6,20})[;"]/);
  return yt ? `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg` : null;
}

async function steam(appid) {
  const data = JSON.parse(await fetchText(steamNewsUrl(appid)));
  const list = (data.appnews && data.appnews.newsitems) || [];
  return list
    .filter((n) => n.feedname === 'steam_community_announcements' && n.gid)
    .map((n) => ({
      source: 'Steam',
      kind: 'Actualización',
      title: n.title,
      summary: steamSummary(n.contents),
      url: `https://store.steampowered.com/news/app/${appid}/view/${n.gid}`,
      image: steamImage(n.contents),
      date: new Date(n.date * 1000).toISOString(),
    }));
}

// Fuentes por juego; la clave es el nombre que ve el usuario
const SOURCES = {
  cs2: { HLTV: hltv, Steam: () => steam(730) },
  valorant: { VLR: vlr, Dexerto: dexertoVal },
  overwatch: { Steam: () => steam(2357570), Dexerto: dexertoOw },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  const fetchers = SOURCES[req.query.game || 'cs2'];
  if (!fetchers) return res.status(400).json({ error: 'Juego no permitido' });

  const names = Object.keys(fetchers);
  const results = await Promise.allSettled(names.map((n) => fetchers[n]()));
  const items = results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .sort((a, b) => b.date.localeCompare(a.date));
  const sources = Object.fromEntries(names.map((n, i) => [n, results[i].status === 'fulfilled' ? 'ok' : 'error']));

  if (!items.length) return res.status(502).json({ error: 'No se pudieron cargar las noticias', sources });

  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
  return res.status(200).json({ items, sources });
}
