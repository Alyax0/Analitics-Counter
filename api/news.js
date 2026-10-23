// Noticias de CS2: titulares de HLTV (RSS) y actualizaciones oficiales de
// Valve (API de noticias de Steam). Solo se devuelven título, resumen corto,
// fecha y enlace a la fuente original.
//
// Cada fuente es independiente: si una falla, se devuelve la otra.

const HLTV_RSS = 'https://www.hltv.org/rss/news';
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

async function hltv() {
  const xml = await fetchText(HLTV_RSS);
  const items = [];
  for (const [, body] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (name) => decode((body.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1] || '');
    const url = tag('link');
    const date = new Date(tag('pubDate'));
    if (!url.startsWith('https://www.hltv.org/') || isNaN(date)) continue;
    items.push({
      source: 'HLTV',
      kind: 'Noticia',
      title: tag('title'),
      summary: shorten(tag('description')),
      url,
      date: date.toISOString(),
    });
  }
  if (!items.length) throw new Error('RSS sin noticias');
  return items;
}

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  const [h, s] = await Promise.allSettled([hltv(), steam()]);
  const items = [...(h.status === 'fulfilled' ? h.value : []), ...(s.status === 'fulfilled' ? s.value : [])].sort(
    (a, b) => b.date.localeCompare(a.date),
  );
  const sources = {
    hltv: h.status === 'fulfilled' ? 'ok' : 'error',
    steam: s.status === 'fulfilled' ? 'ok' : 'error',
  };

  if (!items.length) return res.status(502).json({ error: 'No se pudieron cargar las noticias', sources });

  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
  return res.status(200).json({ items, sources });
}
