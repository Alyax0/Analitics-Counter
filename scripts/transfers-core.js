// Lectura de la tabla de pases de Liquipedia (Portal:Transfers), sin DOM:
// funciona igual en Node (GitHub Actions) y en el navegador.
//
// Cada fila trae: fecha, jugadores (bandera + nombre), equipo anterior y nuevo
// (con rol entre paréntesis, "None" o "Retired") y el enlace a la fuente.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#160': ' ', '#39': "'" };

function text(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
      if (ENTITIES[e.toLowerCase()] != null) return ENTITIES[e.toLowerCase()];
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function cell(row, cls) {
  const m = row.match(new RegExp(`<div class="divCell ${cls}"[^>]*>([\\s\\S]*?)</div>(?=<div class="divCell|</div>\\s*$)`));
  return m ? m[1] : '';
}

// Las banderas son archivos con el código ISO: /Ro_hd.png → "ro"
function players(html, base) {
  const out = [];
  for (const [, block] of html.matchAll(/<div class="block-player"[^>]*>([\s\S]*?)<\/span><\/div>/g)) {
    const flagFile = block.match(/\/([A-Za-z]{2})_hd\.png/);
    const country = block.match(/<span class="flag"><img alt="([^"]*)"/);
    const link = block.match(/<span class="name"[^>]*>(?:<a href="([^"]+)"[^>]*>)?([\s\S]*?)(?:<\/a>)?$/);
    const name = text(link ? link[2] : block);
    if (!name) continue;
    // Los jugadores sin página propia traen un enlace de edición ("redlink"): se descarta
    const href = link && link[1] ? link[1].replace(/&amp;/g, '&') : null;
    out.push({
      name,
      country: flagFile ? flagFile[1].toLowerCase() : null,
      countryName: country ? text(country[1]) : null,
      url: href && href.startsWith('/') && !href.includes('redlink=1') ? base + href : null,
    });
  }
  return out;
}

// Un lado del pase: equipos (puede haber dos, "A / B" en préstamos) y rol
function side(html) {
  // Muchos equipos se muestran solo con el logo: el nombre está en el atributo, no en el texto
  const teams = [...new Set([...html.matchAll(/data-highlighting-class="([^"]+)"/g)].map((m) => text(m[1])))];
  const plain = text(html);
  const role = plain.match(/\(([^)]+)\)\s*$/);
  if (teams.length) return { teams, role: role ? role[1] : null, status: 'team' };
  if (plain === 'Retired') return { teams: [], role: null, status: 'retired' };
  return { teams: [], role: role ? role[1] : null, status: 'none' };
}

export function parseTransfers(html, base) {
  const items = [];
  const rows = String(html).split(/(?=<div class="divRow mainpage-transfer-)/).slice(1);
  for (const row of rows) {
    const date = text(cell(row, 'Date'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const who = players(cell(row, 'Name'), base);
    if (!who.length) continue;
    const ref = row.match(/<div class="divCell Ref">[\s\S]*?href="(https?:\/\/[^"]+)"/);
    // Overwatch marca el rol de cada jugador con un ícono (Tank, DPS, Support...)
    const roles = [...cell(row, 'Icon').matchAll(/alt="([^"]+)"/g)].map((m) => m[1]).filter(Boolean);
    items.push({
      date,
      players: who,
      from: side(cell(row, 'Team OldTeam')),
      to: side(cell(row, 'Team NewTeam')),
      roles: [...new Set(roles)],
      ref: ref ? ref[1].replace(/&amp;/g, '&') : null,
    });
  }
  return items;
}

// Clave para no repetir un pase al juntar lo nuevo con lo ya guardado
export const transferKey = (x) =>
  [x.date, x.players.map((p) => p.name).join('+'), x.from.teams.join('/') || x.from.status, x.to.teams.join('/') || x.to.status].join('|');

// Junta lo leído con lo guardado: sin repetidos, más nuevo primero, hasta `max` días atrás
export function mergeTransfers(fresh, saved, { now = Date.now(), maxDays = 120, maxItems = 600 } = {}) {
  const seen = new Map();
  for (const x of [...fresh, ...saved]) if (!seen.has(transferKey(x))) seen.set(transferKey(x), x);
  const cutoff = new Date(now - maxDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
  return [...seen.values()]
    .filter((x) => x.date >= cutoff)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, maxItems);
}
