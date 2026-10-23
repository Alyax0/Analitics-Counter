// Clientes de /api/ps y /api/news con caché en localStorage.
// Si la API falla y hay una copia guardada, se devuelve marcada como "stale".

const CACHE_PREFIX = 'ps2_';
const CACHE_TTL = 2 * 60 * 1000;
const NEWS_TTL = 10 * 60 * 1000;
const TEAMS_TTL = 60 * 60 * 1000;

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(key, entry) {
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // sin espacio o storage bloqueado: seguimos sin caché
  }
}

async function cachedJson(key, url, { ttl, force, validate }) {
  const cached = readCache(key);
  if (!force && cached && Date.now() - cached.at < ttl) {
    return { data: cached.data, at: cached.at, stale: false };
  }
  try {
    const res = await fetch(url);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body && body.error) || `Error ${res.status}`);
    if (!validate(body)) throw new Error('Respuesta inesperada de la API');
    const entry = { at: Date.now(), data: body };
    writeCache(key, entry);
    return { data: body, at: entry.at, stale: false };
  } catch (e) {
    if (cached) return { data: cached.data, at: cached.at, stale: true, error: e.message };
    throw e;
  }
}

export function psGet(game, path, params = {}, { force = false } = {}) {
  const query = new URLSearchParams({ game, path, ...params });
  const ttl = path === 'teams' ? TEAMS_TTL : CACHE_TTL;
  return cachedJson(`${CACHE_PREFIX}${query}`, `/api/ps?${query}`, { ttl, force, validate: Array.isArray });
}

export function newsGet(gameId, { force = false } = {}) {
  return cachedJson(`${CACHE_PREFIX}news_${gameId}`, `/api/news?game=${encodeURIComponent(gameId)}`, {
    ttl: NEWS_TTL,
    force,
    validate: (b) => b && Array.isArray(b.items),
  });
}

// Historial de predicciones: lo escribe el workflow de GitHub Actions en la
// rama "data" y se lee directo de GitHub (sin pasar por Vercel)
export const PREDICTIONS_REPO = 'https://github.com/Alyax0/Analitics-Counter';
const SUMMARY_URL = 'https://raw.githubusercontent.com/Alyax0/Analitics-Counter/data/predictions/summary.json';

export function summaryGet({ force = false } = {}) {
  return cachedJson(`${CACHE_PREFIX}predictions`, SUMMARY_URL, {
    ttl: 5 * 60 * 1000,
    force,
    validate: (b) => b && b.overall && b.games,
  });
}

// Limpia entradas del formato viejo (ps_cache_*) que guardaban errores
export function clearLegacyCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('ps_cache_'))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // nada que limpiar
  }
}
