// Cliente del proxy /api/ps con caché en localStorage.
// Si la API falla y hay una copia guardada, se devuelve marcada como "stale".

const CACHE_PREFIX = 'ps2_';
const CACHE_TTL = 2 * 60 * 1000;

function cacheKey(game, path, params) {
  return `${CACHE_PREFIX}${game}/${path}?${new URLSearchParams(params)}`;
}

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

export async function psGet(game, path, params = {}, { force = false } = {}) {
  const key = cacheKey(game, path, params);
  const cached = readCache(key);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL) {
    return { data: cached.data, at: cached.at, stale: false };
  }

  const query = new URLSearchParams({ game, path, ...params });
  try {
    const res = await fetch(`/api/ps?${query}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body && body.error) || `Error ${res.status}`);
    if (!Array.isArray(body)) throw new Error('Respuesta inesperada de la API');
    const entry = { at: Date.now(), data: body };
    writeCache(key, entry);
    return { data: body, at: entry.at, stale: false };
  } catch (e) {
    if (cached) return { data: cached.data, at: cached.at, stale: true, error: e.message };
    throw e;
  }
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
