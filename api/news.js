// Noticias por juego (?game=cs2|valorant):
// - CS2: titulares de HLTV (RSS) y notas de parche oficiales de Valve (Steam)
// - Valorant: titulares de VLR.gg (RSS)
// Solo se devuelven título, resumen corto, fecha y enlace a la fuente original.
//
// Cada fuente es independiente: si una falla, se devuelven las demás.

const HLTV_RSS = 'https://www.hltv.org/rss/news';
const VLR_RSS = 'https://www.vlr.gg/rss';
const STEAM_NEWS =
  'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=730&count=10&feeds=steam_community_announcements';
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

// RSS genérico: solo se aceptan enlaces del sitio de origen
async function rss(feedUrl, source, origin, limit = 10) {
  const xml = await fetchText(feedUrl);
  const items = [];
  for (const [, body] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (name) => decode((body.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1] || '');
    const url = tag('link');
    const date = new Date(tag('pubDate'));
    if (!url.startsWith(origin) || isNaN(date)) continue;
    items.push({
      source,
      kind: 'Noticia',
      title: tag('title'),
      summary: shorten(tag('description')),
      url,
      date: date.toISOString(),
    });
  }
  if (!items.length) throw new Error('RSS sin noticias');
  return items.slice(0, limit);
}

const hltv = () => rss(HLTV_RSS, 'HLTV', 'https://www.hltv.org/');
const vlr = () => rss(VLR_RSS, 'VLR', 'https://www.vlr.gg/', 20);

async function steam() {
  const data = JSON.parse(await fetchText(STEAM_NEWS));
  const list = (data.appnews && data.appnews.newsitems) || [];
  return list
    .filter((n) => n.feedname === 'steam_community_announcements' && n.gid)
    .map((n) => ({
      source: 'Steam',
      kind: 'Actualización',
      title: n.title,
      summary: steamSummary(n.contents),
      url: `https://store.steampowered.com/news/app/730/view/${n.gid}`,
      date: new Date(n.date * 1000).toISOString(),
    }));
}

// Fuentes por juego; la clave es el nombre que ve el usuario
const SOURCES = {
  cs2: { HLTV: hltv, Steam: steam },
  valorant: { VLR: vlr },
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
