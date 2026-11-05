// Pases de jugadores desde Liquipedia. Lo ejecuta .github/workflows/transfers.yml
// cada 6 horas sobre una copia de la rama "data" y guarda transfers/<juego>.json.
//
// Liquipedia pide identificarse con un User-Agent propio y no hacer más de una
// consulta de tipo "parse" cada 30 segundos: por eso esto corre en Actions y no
// en cada visita a la página.
//
// Uso: node scripts/transfers.mjs --data <carpeta>

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GAMES } from '../js/games.js';
import { parseTransfers, mergeTransfers } from './transfers-core.js';

const BASE = 'https://liquipedia.net';
const UA = 'Pickrate/1.0 (https://analitics-counter.vercel.app; github.com/Alyax0/Analitics-Counter)';
const WAIT_MS = 31 * 1000;
const dataDir = process.argv[process.argv.indexOf('--data') + 1];
if (!dataDir || dataDir.startsWith('--')) throw new Error('Falta --data <carpeta>');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPortal(wiki) {
  // redirects=1: en Overwatch, Portal:Transfers redirige a "Player Transfers"
  const params = new URLSearchParams({ action: 'parse', page: 'Portal:Transfers', redirects: '1', prop: 'text', format: 'json', formatversion: '2' });
  const res = await fetch(`${BASE}/${wiki}/api.php?${params}`, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' } });
  if (!res.ok) throw new Error(`Liquipedia ${res.status} en ${wiki}`);
  const body = await res.json();
  if (!body.parse || !body.parse.text) throw new Error(`Liquipedia sin contenido en ${wiki}`);
  return body.parse.text;
}

async function readSaved(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8')).items || [];
  } catch {
    return [];
  }
}

await mkdir(join(dataDir, 'transfers'), { recursive: true });
let failures = 0;
const games = Object.values(GAMES).filter((g) => g.liquipedia);
for (const [i, game] of games.entries()) {
  if (i > 0) await sleep(WAIT_MS);
  const file = join(dataDir, 'transfers', `${game.id}.json`);
  try {
    const fresh = parseTransfers(await fetchPortal(game.liquipedia), BASE);
    if (!fresh.length) throw new Error('la tabla vino vacía (¿cambió el formato?)');
    const saved = await readSaved(file);
    const items = mergeTransfers(fresh, saved);
    const out = {
      updatedAt: new Date().toISOString(),
      source: `${BASE}/${game.liquipedia}/Portal:Transfers`,
      license: 'CC BY-SA 3.0',
      items,
    };
    await writeFile(file, JSON.stringify(out) + '\n');
    console.log(`${game.id}: ${fresh.length} leídos, ${items.length} guardados`);
  } catch (e) {
    failures++;
    console.error(`${game.id}: ${e.message}`);
  }
}
// Si fallan todos, el workflow queda en rojo para que se note
if (failures === games.length) process.exit(1);
