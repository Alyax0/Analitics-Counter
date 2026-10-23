// Registro de predicciones. Lo ejecuta .github/workflows/predictions.yml cada
// 30 minutos sobre una copia de la rama "data".
//
// Uso: PANDASCORE_TOKEN=... node scripts/predictions.mjs --data <carpeta>

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GAMES } from '../js/games.js';
import { normalizeMatch, buildTeamStats } from '../js/model.js';
import { freeze, resolve, summarize, monthOf } from './predictions-core.js';

const API = 'https://api.pandascore.co';
const token = process.env.PANDASCORE_TOKEN;
const dataDir = process.argv[process.argv.indexOf('--data') + 1];

if (!token) throw new Error('Falta la variable PANDASCORE_TOKEN');
if (!dataDir || dataDir.startsWith('--')) throw new Error('Falta --data <carpeta>');

async function api(path, params) {
  const url = `${API}/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`PandaScore ${res.status} en ${path}`);
  return (await res.json()).map(normalizeMatch);
}

const finished = { 'filter[status]': 'finished', sort: '-scheduled_at', per_page: 100 };

// Mismos datos que usa la página para predecir (ver load() en js/app.js)
async function currentData(slug) {
  const [live, upcoming, recent] = await Promise.all([
    api(`${slug}/matches/running`, { per_page: 20 }),
    api(`${slug}/matches/upcoming`, { per_page: 50, sort: 'begin_at' }),
    api(`${slug}/matches/past`, finished),
  ]);
  const ids = [...new Set([...live, ...upcoming.slice(0, 20)].flatMap((m) => [m.teamA.id, m.teamB.id]).filter(Boolean))]
    .slice(0, 50)
    .sort((a, b) => a - b);
  let history = [];
  if (ids.length) {
    const params = { ...finished, 'filter[opponent_id]': ids.join(',') };
    const pages = await Promise.all([api(`${slug}/matches/past`, params), api(`${slug}/matches/past`, { ...params, page: 2 })]);
    history = pages.flat();
  }
  const past = [...new Map([...recent, ...history].map((m) => [m.id, m])).values()].filter((m) => m.status === 'finished');
  return { upcoming, stats: buildTeamStats(past) };
}

// Estado actual de partidos puntuales, de a 50 ids
async function matchesById(slug, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    for (const m of await api(`${slug}/matches`, { 'filter[id]': chunk.join(','), per_page: 100 })) out.set(m.id, m);
  }
  return out;
}

async function readRecords(gameId) {
  const dir = join(dataDir, 'predictions', gameId);
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter((f) => /^\d{4}-\d{2}\.json$/.test(f));
  const lists = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir, f), 'utf8'))));
  return lists.flat();
}

// Un registro por línea para que cada cambio se vea claro en el historial de git
async function writeRecords(gameId, records) {
  const byMonth = {};
  for (const r of records) (byMonth[monthOf(r)] ||= []).push(r);
  for (const [month, list] of Object.entries(byMonth)) {
    list.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id - b.id);
    const body = `[\n${list.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`;
    await writeFile(join(dataDir, 'predictions', gameId, `${month}.json`), body);
  }
}

const now = new Date();
const all = [];
const log = [];
let failures = 0;

for (const game of Object.values(GAMES)) {
  let records = await readRecords(game.id);
  try {
    const pendingIds = records.filter((r) => r.status === 'pending').map((r) => r.id);
    const [{ upcoming, stats }, current] = await Promise.all([currentData(game.slug), matchesById(game.slug, pendingIds)]);

    let resolved = 0;
    records = records.map((r) => {
      const next = resolve(r, current.get(r.id) || null, now);
      if (next !== r) resolved++;
      return next;
    });
    const created = freeze(game.id, records, upcoming, stats, now);
    records.push(...created);
    await writeRecords(game.id, records);
    log.push(`${game.id}: +${created.length} nuevas, ${resolved} cerradas`);
  } catch (e) {
    failures++;
    log.push(`${game.id}: error (${e.message}); se conservan los registros anteriores`);
  }
  all.push(...records);
}

await writeFile(join(dataDir, 'predictions', 'summary.json'), `${JSON.stringify(summarize(all))}\n`);
// La rama data no debe generar deploys en Vercel
await writeFile(join(dataDir, 'vercel.json'), `${JSON.stringify({ git: { deploymentEnabled: false } }, null, 2)}\n`);

console.log(log.join('\n'));
if (failures === Object.keys(GAMES).length) process.exit(1);
