// Proxy a PandaScore. El token vive en la variable de entorno PANDASCORE_TOKEN
// (Vercel → Settings → Environment Variables) y nunca llega al navegador.
//
// Uso: /api/ps?game=csgo&path=matches/upcoming&per_page=50&sort=begin_at
// Solo se aceptan los juegos, rutas y parámetros de las listas de abajo.
// Los filtros van con nombres planos (status, opponents, ids) y acá se traducen
// a la sintaxis filter[...] de PandaScore.

const GAMES = new Set(['csgo', 'valorant', 'ow']);

// ruta → segundos de caché en el CDN de Vercel
const PATHS = {
  'matches/running': 60,
  'matches/upcoming': 300,
  'matches/past': 300,
  teams: 3600, // planteles: cambian poco
};

const SORTS = new Set(['begin_at', '-begin_at', 'scheduled_at', '-scheduled_at']);

function buildParams(query) {
  const params = new URLSearchParams();
  const perPage = parseInt(query.per_page, 10);
  if (perPage) params.set('per_page', String(Math.min(Math.max(perPage, 1), 100)));
  const page = parseInt(query.page, 10);
  if (page) params.set('page', String(Math.min(Math.max(page, 1), 10)));
  if (query.sort) {
    if (!SORTS.has(query.sort)) return null;
    params.set('sort', query.sort);
  }
  if (query.status) {
    if (query.status !== 'finished') return null;
    params.set('filter[status]', 'finished');
  }
  if (query.opponents) {
    // Lista de ids de equipos separados por coma, hasta 50
    if (!/^\d+(,\d+){0,49}$/.test(query.opponents)) return null;
    params.set('filter[opponent_id]', query.opponents);
  }
  if (query.ids) {
    if (!/^\d+(,\d+){0,49}$/.test(query.ids)) return null;
    params.set('filter[id]', query.ids);
  }
  return params;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  const { game, path } = req.query;
  if (!GAMES.has(game) || !(path in PATHS)) {
    return res.status(400).json({ error: 'Juego o ruta no permitidos' });
  }
  const params = buildParams(req.query);
  if (!params) return res.status(400).json({ error: 'Parámetro no permitido' });

  const token = process.env.PANDASCORE_TOKEN;
  if (!token) return res.status(500).json({ error: 'Falta configurar PANDASCORE_TOKEN' });

  const url = `https://api.pandascore.co/${game}/${path}?${params}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const message = (data && (data.error || data.message)) || `PandaScore respondió ${response.status}`;
      // 401/403 son problemas de configuración nuestros, no del cliente
      const status = response.status === 401 || response.status === 403 ? 502 : response.status;
      return res.status(status).json({ error: message });
    }

    const ttl = PATHS[path];
    res.setHeader('Cache-Control', `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 4}`);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo contactar a PandaScore' });
  }
}
