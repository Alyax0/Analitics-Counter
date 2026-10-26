import { GAMES, DEFAULT_GAME } from './games.js';
import { psGet, newsGet, summaryGet, clearLegacyCache, PREDICTIONS_REPO } from './api.js';
import { normalizeMatch, normalizeRoster, buildTeamStats, recentRecord, predict, headToHead } from './model.js';
import {
  esc, safeUrl, ago, dayKey, dayLabel, formatTime, formatShortDate, whenLabel, timezoneLabel,
  teamLogo, formDots, probBar, matchCard, skeletonList, skeletonStats, emptyState, errorState,
  rosterGrid, newsCard,
} from './ui.js';
import { viewHome } from './home.js';
import { BRAND, BRAND_MARK } from './brand.js';
import { ICONS } from './icons.js';

const REFRESH_EVERY = 2 * 60 * 1000;
const ROUTES = ['inicio', 'partidos', 'calendario', 'equipos', 'noticias', 'aciertos'];
// Con ?demo se usan siempre los datos guardados (game.demoFile)
const FORCE_DEMO = new URLSearchParams(location.search).has('demo');

// Rutas: #/<juego>/<sección>; #/<juego> sola es la home del juego.
// Las viejas (#/partidos) siguen yendo a CS2.
function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const gameId = GAMES[parts[0]] ? parts.shift() : DEFAULT_GAME;
  return { gameId, route: ROUTES.includes(parts[0]) ? parts[0] : 'inicio' };
}

let game = GAMES[parseHash().gameId];
// Se incrementa al cambiar de juego para descartar respuestas del juego anterior
let loadGen = 0;

// Datos que dependen del juego; se reinician al cambiarlo
function gameState() {
  return {
    status: 'loading', // loading | ready | error
    error: null,
    stale: false,
    demo: null, // fecha de captura cuando se muestran datos de demo
    at: 0,
    lastAttempt: 0,
    live: [],
    upcoming: [],
    past: [],
    stats: new Map(),
    filter: 'all',
    loading: false,
    // Noticias: se cargan recién al entrar a la sección
    news: { status: 'idle', items: [], sources: {}, at: 0, stale: false, error: null, filter: 'all' },
    // Historial de predicciones: también se carga al entrar a la sección
    acc: { status: 'idle', data: null, error: null, loading: false },
    rosters: new Map(), // teamId → plantel normalizado o { error }
    homeNews: 0, // noticia visible en el carrusel de la home
  };
}

const state = { ...gameState(), query: '' };

const app = document.getElementById('app');
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modal-content');
const searchInput = document.getElementById('search-input');

// ===================== DATOS =====================

function setMatches(live, upcoming, past) {
  state.live = live;
  state.upcoming = upcoming;
  // Resultados recientes e historial de equipos se solapan: deduplicamos
  state.past = [...new Map(past.map((m) => [m.id, m])).values()]
    .filter((m) => m.status === 'finished')
    .sort((a, b) => (b.date || 0) - (a.date || 0));
  state.stats = buildTeamStats(state.past);
}

// Respaldo: datos reales capturados de PandaScore y guardados en el repo
async function loadDemo(gen) {
  const res = await fetch(game.demoFile);
  if (!res.ok) throw new Error(`No se pudo cargar el modo demo (${res.status})`);
  const demo = await res.json();
  if (gen !== loadGen) return;
  setMatches(demo.running.map(normalizeMatch), demo.upcoming.map(normalizeMatch), demo.past.map(normalizeMatch));
  state.demo = new Date(demo.capturedAt);
  state.at = state.demo.getTime();
  state.stale = false;
  state.status = 'ready';
}

// Los resultados recientes cubren pocos días, así que para predecir se pide
// aparte el historial de los equipos que juegan ahora o pronto. Si falla,
// se sigue solo con los resultados recientes.
async function loadTeamHistory(matches, force) {
  const ids = [...new Set(matches.flatMap((m) => [m.teamA.id, m.teamB.id]).filter(Boolean))].slice(0, 50);
  if (!ids.length) return [];
  const params = { per_page: 100, sort: '-scheduled_at', status: 'finished', opponents: ids.sort((a, b) => a - b).join(',') };
  try {
    const pages = await Promise.all([
      psGet(game.slug, 'matches/past', params, { force }),
      psGet(game.slug, 'matches/past', { ...params, page: 2 }, { force }),
    ]);
    return pages.flatMap((r) => r.data.map(normalizeMatch));
  } catch (e) {
    console.warn('No se pudo cargar el historial de equipos:', e.message);
    return [];
  }
}

async function load({ force = false } = {}) {
  if (state.loading) return;
  const gen = loadGen;
  state.loading = true;
  state.lastAttempt = Date.now();
  if (state.status !== 'ready') {
    state.status = 'loading';
    render();
  } else {
    setRefreshing(true);
  }

  if (FORCE_DEMO) {
    try {
      await loadDemo(gen);
    } catch (e) {
      if (gen !== loadGen) return;
      state.status = 'error';
      state.error = e.message;
    }
    if (gen !== loadGen) return;
    state.loading = false;
    return render();
  }

  try {
    // Se ordena por scheduled_at: begin_at viene null en muchos partidos y
    // PandaScore los pone primero, tapando los resultados reales
    const results = await Promise.all([
      psGet(game.slug, 'matches/running', { per_page: 20 }, { force }),
      psGet(game.slug, 'matches/upcoming', { per_page: 50, sort: 'begin_at' }, { force }),
      psGet(game.slug, 'matches/past', { per_page: 100, sort: '-scheduled_at', status: 'finished' }, { force }),
    ]);
    const [live, upcoming, recent] = results.map((r) => r.data.map(normalizeMatch));
    const history = await loadTeamHistory([...live, ...upcoming.slice(0, 20)], force);
    if (gen !== loadGen) return;

    setMatches(live, upcoming, [...recent, ...history]);
    state.demo = null;
    state.stale = results.some((r) => r.stale);
    state.error = results.find((r) => r.error)?.error || null;
    state.at = Math.min(...results.map((r) => r.at));
    state.status = 'ready';
  } catch (e) {
    if (gen !== loadGen) return;
    state.error = e.message;
    if (state.status === 'ready') {
      // Si ya había datos en pantalla, los mantenemos y avisamos
      if (!state.demo) state.stale = true;
    } else {
      try {
        await loadDemo(gen);
      } catch {
        if (gen === loadGen) state.status = 'error';
      }
    }
  }
  // Si cambió el juego mientras cargaba, esta respuesta ya no importa
  if (gen !== loadGen) return;
  state.loading = false;
  render();
}

function switchGame(gameId) {
  loadGen++;
  game = GAMES[gameId];
  Object.assign(state, gameState());
  applyGame();
  if (modal.open) modal.close();
  load();
}

function applyGame() {
  document.documentElement.style.setProperty('--accent', game.accent);
  document.title = `${BRAND.name} · ${game.name}: partidos y predicciones`;
}

function applyBrand() {
  document.querySelector('.brand').innerHTML = `
    <span class="brand-mark">${BRAND_MARK}</span>
    <span class="brand-name">${esc(BRAND.name)}</span>
    <span class="brand-tag">${esc(BRAND.tag)}</span>`;
  document.querySelectorAll('.tab').forEach((t) => {
    t.querySelector('.tab-icon').innerHTML = ICONS[t.dataset.route] || '';
  });
  document.querySelector('.search-toggle').innerHTML = ICONS.buscar;
}

async function loadNews({ force = false } = {}) {
  const news = state.news;
  if (news.loading) return;
  news.loading = true;
  if (news.status !== 'ready') news.status = 'loading';
  try {
    const r = await newsGet(game.id, { force });
    if (news !== state.news) return; // cambió el juego
    Object.assign(news, {
      status: 'ready',
      items: r.data.items,
      sources: r.data.sources || {},
      at: r.at,
      stale: r.stale,
      error: r.error || null,
    });
  } catch (e) {
    if (news.status !== 'ready') news.status = 'error';
    news.error = e.message;
  }
  news.loading = false;
  if (['noticias', 'inicio'].includes(currentRoute()) && !state.query) render();
  else renderNav();
}

async function loadSummary({ force = false } = {}) {
  const acc = state.acc;
  if (acc.loading) return;
  acc.loading = true;
  if (acc.status !== 'ready') acc.status = 'loading';
  try {
    const r = await summaryGet({ force });
    Object.assign(acc, { status: 'ready', data: r.data, error: null });
  } catch (e) {
    if (acc.status !== 'ready') acc.status = 'error';
    acc.error = e.message;
  }
  acc.loading = false;
  if (acc === state.acc && ['aciertos', 'inicio'].includes(currentRoute()) && !state.query) render();
}

// Planteles de los equipos pedidos que todavía no están cargados
async function ensureRosters(ids) {
  const missing = ids.filter((id) => id && !state.rosters.has(id));
  if (missing.length) {
    try {
      const r = await psGet(game.slug, 'teams', { ids: missing.join(','), per_page: 50 });
      for (const t of r.data) state.rosters.set(t.id, normalizeRoster(t));
      for (const id of missing) if (!state.rosters.has(id)) state.rosters.set(id, { id, players: [] });
    } catch {
      for (const id of missing) state.rosters.set(id, { id, error: 'No se pudo cargar el plantel.' });
    }
  }
  // Reemplaza los huecos que haya en el modal abierto
  document.querySelectorAll('[data-roster]').forEach((el) => {
    const roster = state.rosters.get(Number(el.dataset.roster));
    if (roster) el.innerHTML = rosterGrid(roster);
  });
}

function maybeRefresh() {
  if (FORCE_DEMO || document.visibilityState !== 'visible' || state.loading) return;
  if (Date.now() - state.lastAttempt > REFRESH_EVERY) load();
}

// ===================== VISTAS =====================

function currentRoute() {
  return parseHash().route;
}

function header(eyebrow, title, accent) {
  return `
    <div class="page-head">
      <div>
        <div class="eyebrow">${esc(eyebrow)}</div>
        <h1 class="heading">${esc(title)} <span>${esc(accent)}</span></h1>
      </div>
      ${state.status === 'ready' ? updatedBadge() : ''}
    </div>
    ${notices()}`;
}

// Avisos de modo demo o de datos guardados (los usan las páginas y la home)
function notices() {
  return `
    ${state.status === 'ready' && state.demo ? `
      <div class="notice demo" role="status">
        <strong>Modo demo:</strong> datos reales de PandaScore capturados el ${esc(captureLabel())}, no se actualizan.
        ${FORCE_DEMO
          ? `<a class="link-btn" href="./#/${game.id}/${currentRoute()}">Ver datos en vivo</a>`
          : `La API no está disponible ahora. <button type="button" class="link-btn" data-action="refresh">Reintentar</button>`}
      </div>` : ''}
    ${state.status === 'ready' && state.stale ? `
      <div class="notice" role="status">
        Mostrando datos guardados: la API no respondió (${esc(state.error || 'error desconocido')}).
        <button type="button" class="link-btn" data-action="refresh">Reintentar</button>
      </div>` : ''}`;
}

function captureLabel() {
  return `${formatShortDate(state.demo)} ${state.demo.getFullYear()}, ${formatTime(state.demo)}`;
}

function updatedText() {
  return state.demo ? 'Datos de demo' : `Actualizado ${ago(state.at)}`;
}

function updatedBadge() {
  return `
    <div class="updated">
      <span id="updated-text">${updatedText()}</span>
      <button type="button" class="icon-btn ${state.loading ? 'spinning' : ''}" id="refresh-btn" data-action="refresh" aria-label="Actualizar datos" title="Actualizar">↻</button>
    </div>`;
}

function setRefreshing(on) {
  document.getElementById('refresh-btn')?.classList.toggle('spinning', on);
}

function withPred(m) {
  return matchCard(m, m.status === 'upcoming' || m.status === 'live' ? predict(m, state.stats) : null);
}

function list(matches) {
  return `<div class="list">${matches.map(withPred).join('')}</div>`;
}

function viewPartidos() {
  const head = header('● ' + game.name, 'Partidos', 'en vivo y próximos');
  if (state.status === 'loading') return head + skeletonStats() + skeletonList(6);
  if (state.status === 'error') return head + errorState(state.error);

  // En demo, "próximas 24 h" se cuenta desde el momento de la captura
  const now = state.demo ? state.demo.getTime() : Date.now();
  const next24 = state.upcoming.filter((m) => m.date && m.date - now < 24 * 3600 * 1000);
  const leagues = new Set([...state.live, ...next24].map((m) => m.league));
  const finished = state.past.slice(0, 15);
  const upcoming = state.upcoming.slice(0, 20);
  const predictable = upcoming.filter((m) => {
    const p = predict(m, state.stats);
    return p && !p.insufficient;
  }).length;

  const groups = {
    all: [...state.live, ...upcoming, ...finished],
    live: state.live,
    upcoming,
    finished,
  };
  const shown = groups[state.filter];
  const emptyText = {
    all: ['Sin partidos', 'PandaScore no devolvió partidos por ahora.'],
    live: ['No hay partidos en vivo', 'Mirá los próximos partidos o el calendario completo.'],
    upcoming: ['No hay partidos programados', 'Volvé a revisar más tarde.'],
    finished: ['Sin resultados recientes', 'No hay partidos terminados para mostrar.'],
  }[state.filter];

  const chip = (id, label, count) =>
    `<button type="button" class="chip ${state.filter === id ? 'active' : ''}" data-filter="${id}" aria-pressed="${state.filter === id}">${label} <span>${count}</span></button>`;

  return `
    ${head}
    <div class="stat-row">
      <div class="stat-item"><div class="s-label">En vivo</div><div class="s-val accent">${state.live.length}</div><div class="s-sub">partidos ahora</div></div>
      <div class="stat-item"><div class="s-label">Próximas 24 h</div><div class="s-val">${next24.length}</div><div class="s-sub">partidos programados</div></div>
      <div class="stat-item"><div class="s-label">Ligas activas</div><div class="s-val">${leagues.size}</div><div class="s-sub">en vivo o en 24 h</div></div>
      <div class="stat-item"><div class="s-label">Con predicción</div><div class="s-val">${predictable}<small>/${upcoming.length}</small></div><div class="s-sub">próximos con datos</div></div>
    </div>
    <div class="chips" role="group" aria-label="Filtrar partidos">
      ${chip('all', 'Todos', groups.all.length)}
      ${chip('live', 'En vivo', groups.live.length)}
      ${chip('upcoming', 'Próximos', groups.upcoming.length)}
      ${chip('finished', 'Finalizados', groups.finished.length)}
    </div>
    ${shown.length ? list(shown) : emptyState(...emptyText)}
    <p class="footnote">Predicción: tasa de victorias en los últimos 10 partidos de cada equipo (suavizado de Laplace), sobre ${state.past.length} resultados cargados (los más recientes y el historial de los equipos que juegan pronto). Es un modelo simple con fines demostrativos.</p>`;
}

function viewCalendario() {
  const head = header('● Próximos partidos', 'Calendario', `(${timezoneLabel()})`);
  if (state.status === 'loading') return head + skeletonList(8);
  if (state.status === 'error') return head + errorState(state.error);

  const items = [...state.live, ...state.upcoming];
  if (!items.length) return head + emptyState('Calendario vacío', 'No hay partidos programados por ahora.');

  const days = new Map();
  for (const m of items) {
    const k = m.status === 'live' ? 'live' : dayKey(m.date);
    if (!days.has(k)) days.set(k, { label: m.status === 'live' ? 'En vivo ahora' : dayLabel(m.date), items: [] });
    days.get(k).items.push(m);
  }

  return `
    ${head}
    ${[...days.values()].map((d) => `
      <section class="cal-day">
        <h2 class="cal-day-label">${esc(d.label)} <span>${d.items.length}</span></h2>
        <div class="list">
          ${d.items.map((m) => `
            <button type="button" class="cal-item" data-match="${m.id}">
              <span class="cal-time ${m.status === 'live' ? 'live' : ''}">${m.status === 'live' ? `${m.scoreA}–${m.scoreB}` : esc(formatTime(m.date))}</span>
              <span class="cal-teams">${esc(m.teamA.name)} <span class="muted">vs</span> ${esc(m.teamB.name)}</span>
              <span class="cal-event">${esc(m.league)} · ${esc(m.format)}</span>
            </button>`).join('')}
        </div>
      </section>`).join('')}`;
}

function teamRows() {
  return [...state.stats.values()]
    .map(({ team }) => ({ team, rec: recentRecord(state.stats, team.id) }))
    .filter((t) => t.rec.n >= 5)
    .sort((a, b) => b.rec.wins / b.rec.n - a.rec.wins / a.rec.n || b.rec.n - a.rec.n || b.rec.wins - a.rec.wins);
}

function teamTable(rows) {
  return `
    <div class="table-wrap">
      <table class="teams">
        <thead><tr><th scope="col">#</th><th scope="col">Equipo</th><th scope="col">V–D</th><th scope="col">% victorias</th><th scope="col">Forma</th></tr></thead>
        <tbody>
          ${rows.map(({ team, rec }, i) => {
            const pct = Math.round((rec.wins / rec.n) * 100);
            return `
              <tr>
                <td class="pos">${i + 1}</td>
                <td><button type="button" class="team-cell team-link" data-team="${team.id}">${teamLogo(team, 'sm')}<span>${esc(team.name)}</span></button></td>
                <td class="nowrap">${rec.wins}–${rec.losses}${rec.draws ? `–${rec.draws}` : ''}</td>
                <td><div class="pct"><span class="pct-bar"><span style="width:${pct}%"></span></span><strong>${pct}%</strong></div></td>
                <td>${formDots(rec.history)}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function viewEquipos() {
  const head = header('● Últimos resultados', 'Equipos', 'en forma');
  if (state.status === 'loading') return head + skeletonList(8);
  if (state.status === 'error') return head + errorState(state.error);

  const rows = teamRows().slice(0, 25);
  if (!rows.length) return head + emptyState('Sin datos', 'Todavía no hay suficientes resultados para armar la tabla.');
  return `
    ${head}
    <p class="lead">Equipos con al menos 5 partidos entre los ${state.past.length} resultados cargados (los más recientes y el historial de los equipos que juegan pronto), ordenados por % de victorias en sus últimos 10. No es un ranking oficial.</p>
    ${teamTable(rows)}`;
}

function viewNoticias() {
  const news = state.news;
  const head = `
    <div class="page-head">
      <div>
        <div class="eyebrow">● ${esc(game.news.eyebrow)}</div>
        <h1 class="heading">Noticias <span>&amp; actualizaciones</span></h1>
      </div>
      ${news.status === 'ready' ? `
        <div class="updated">
          <span>Actualizado ${ago(news.at)}</span>
          <button type="button" class="icon-btn ${news.loading ? 'spinning' : ''}" data-action="refresh-news" aria-label="Actualizar noticias" title="Actualizar">↻</button>
        </div>` : ''}
    </div>`;
  if (news.status === 'idle' || news.status === 'loading') {
    return head + `<div class="news-grid" aria-hidden="true">${'<div class="skeleton-card"><span class="sk w30"></span><span class="sk w60"></span><span class="sk w40"></span></div>'.repeat(6)}</div>`;
  }
  if (news.status === 'error') {
    return head + `
      <div class="state error" role="alert">
        <div class="state-title">No pudimos cargar las noticias</div>
        <p>${esc(news.error)}</p>
        <button type="button" class="btn" data-action="refresh-news">Reintentar</button>
      </div>`;
  }

  const sources = game.news.sources;
  const labelOf = (id) => sources.find((s) => s.id === id)?.label || id;
  const failed = Object.entries(news.sources).filter(([, v]) => v !== 'ok').map(([k]) => labelOf(k));
  const shown = news.filter === 'all' ? news.items : news.items.filter((n) => n.source === news.filter);
  const count = (s) => news.items.filter((n) => n.source === s).length;
  const chip = (id, label, n) =>
    `<button type="button" class="chip ${news.filter === id ? 'active' : ''}" data-news-filter="${esc(id)}" aria-pressed="${news.filter === id}">${esc(label)} <span>${n}</span></button>`;

  return `
    ${head}
    ${news.stale ? `<div class="notice" role="status">Mostrando noticias guardadas: no se pudieron actualizar (${esc(news.error || 'error')}).</div>` : ''}
    ${failed.length && !news.stale ? `<div class="notice" role="status">No se pudo cargar ${esc(failed.join(' ni '))} por ahora; se muestran las demás fuentes.</div>` : ''}
    ${sources.length > 1 ? `
      <div class="chips" role="group" aria-label="Filtrar noticias">
        ${chip('all', 'Todas', news.items.length)}
        ${sources.map((s) => chip(s.id, s.label, count(s.id))).join('')}
      </div>` : ''}
    ${shown.length ? `<div class="news-grid">${shown.map(newsCard).join('')}</div>` : emptyState('Sin noticias', 'Esta fuente no tiene novedades por ahora.')}
    <p class="footnote">${esc(game.news.footnote)} Cada nota abre en su fuente original.</p>`;
}

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

function predRow(r) {
  const favProb = r.favorite === 'B' ? 100 - r.probA : r.probA;
  const name = (side) => {
    const t = side === 'A' ? r.teamA : r.teamB;
    return r.favorite === side ? `<strong>${esc(t.name)}</strong>` : esc(t.name);
  };
  let outcome;
  if (r.status === 'pending') outcome = `<span class="muted">${esc(whenLabel(new Date(r.scheduledAt)))}</span>`;
  else if (r.status === 'void') outcome = `<span class="muted">No cuenta · ${esc(r.reason)}</span>`;
  else {
    const mark = r.correct === null ? '<span class="muted">Parejo</span>' : r.correct ? '<span class="ok">✓ Acertó</span>' : '<span class="ko">✗ Falló</span>';
    outcome = `<span class="nowrap">${r.result.scoreA}–${r.result.scoreB}</span> ${mark}`;
  }
  return `
    <li class="pred-row">
      <span class="pred-date muted">${esc(formatShortDate(new Date(r.scheduledAt)))}</span>
      <span class="pred-match">${name('A')} <span class="muted">vs</span> ${name('B')}<span class="pred-league">${esc(r.league)} · confianza ${esc(r.confidence)}</span></span>
      <span class="pred-prob">${r.favorite ? `${favProb}%` : '50%'}</span>
      <span class="pred-outcome">${outcome}</span>
    </li>`;
}

function viewAciertos() {
  const acc = state.acc;
  const head = `
    <div class="page-head">
      <div>
        <div class="eyebrow">● Historial verificable</div>
        <h1 class="heading">Aciertos <span>del modelo</span></h1>
      </div>
      ${acc.status === 'ready' && acc.data.updatedAt ? `<div class="updated"><span>Último cambio ${ago(Date.parse(acc.data.updatedAt))}</span></div>` : ''}
    </div>`;
  if (acc.status === 'idle' || acc.status === 'loading') return head + skeletonStats() + skeletonList(4);
  if (acc.status === 'error') {
    if (/404/.test(acc.error)) {
      return head + emptyState('El registro todavía no empezó', 'La primera ejecución automática crea el historial. Volvé a mirar en un rato.');
    }
    return head + `
      <div class="state error" role="alert">
        <div class="state-title">No pudimos cargar el historial</div>
        <p>${esc(acc.error)}</p>
        <button type="button" class="btn" data-action="refresh-acc">Reintentar</button>
      </div>`;
  }

  const g = acc.data.games[game.id];
  const footnote = `
    <p class="footnote">
      Cada predicción se guarda unas horas antes del partido y no se modifica después; si quedó guardada después del inicio, se anula.
      Cancelados, W.O. y empates no cuentan. Modelo <code>${esc(acc.data.model)}</code>.
      Todo el registro está en el <a href="${PREDICTIONS_REPO}/commits/data" target="_blank" rel="noopener noreferrer">historial de la rama data en GitHub ↗</a>.
    </p>`;
  if (!g) return head + emptyState(`Sin predicciones de ${game.name} todavía`, 'Se registran solas unas horas antes de cada partido.') + footnote;

  const levels = ['alta', 'media', 'baja'].map((level) => ({ level, ...g.byConfidence[level] }));
  return `
    ${head}
    <div class="stat-row">
      <div class="stat-item"><div class="s-label">Aciertos</div><div class="s-val accent">${pct(g.accuracy)}</div><div class="s-sub">${g.correct} de ${g.decided} con favorito</div></div>
      <div class="stat-item"><div class="s-label">Resueltas</div><div class="s-val">${g.resolved}</div><div class="s-sub">desde el ${esc(formatShortDate(new Date(g.since)))}</div></div>
      <div class="stat-item"><div class="s-label">Brier score</div><div class="s-val">${g.brier == null ? '—' : g.brier.toFixed(3)}</div><div class="s-sub">menor es mejor · azar: 0.250</div></div>
      <div class="stat-item"><div class="s-label">Pendientes</div><div class="s-val">${g.pending}</div><div class="s-sub">esperando resultado</div></div>
    </div>
    ${!g.resolved ? '<div class="notice" role="status">Todavía no terminó ningún partido con predicción. Los primeros resultados aparecen apenas terminen.</div>' : ''}
    <h2 class="section-label">Por nivel de confianza</h2>
    <div class="table-wrap">
      <table class="teams compact">
        <thead><tr><th scope="col">Confianza</th><th scope="col">Partidos</th><th scope="col">Aciertos</th></tr></thead>
        <tbody>
          ${levels.map((l) => `
            <tr>
              <td><span class="conf conf-${l.level}">${l.level[0].toUpperCase() + l.level.slice(1)}</span></td>
              <td>${l.n}</td>
              <td>${l.n ? `<div class="pct"><span class="pct-bar"><span style="width:${Math.round((l.correct / l.n) * 100)}%"></span></span><strong>${pct(l.correct / l.n)}</strong></div>` : '<span class="muted">—</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${g.pendingList.length ? `<h2 class="section-label">Próximas (ya guardadas)</h2><ul class="pred-list">${g.pendingList.map(predRow).join('')}</ul>` : ''}
    ${g.recent.length ? `<h2 class="section-label">Últimas resueltas</h2><ul class="pred-list">${g.recent.map(predRow).join('')}</ul>` : ''}
    ${footnote}`;
}

function viewSearch() {
  const q = state.query.toLowerCase();
  const head = `<div class="page-head"><div><div class="eyebrow">● Búsqueda</div><h1 class="heading">Resultados para <span>“${esc(state.query)}”</span></h1></div></div>`;
  if (state.status !== 'ready') return head + skeletonList(3);

  const hit = (m) => m.teamA.name.toLowerCase().includes(q) || m.teamB.name.toLowerCase().includes(q) || m.league.toLowerCase().includes(q);
  const matches = [...state.live, ...state.upcoming, ...state.past.slice(0, 60)].filter(hit);
  const teams = teamRows().filter(({ team }) => team.name.toLowerCase().includes(q)).slice(0, 10);

  if (!matches.length && !teams.length) return head + emptyState('Sin resultados', 'Probá con otro nombre de equipo o liga.');
  return `
    ${head}
    ${teams.length ? `<h2 class="section-label">Equipos</h2>${teamTable(teams)}` : ''}
    ${matches.length ? `<h2 class="section-label">Partidos</h2>${list(matches.slice(0, 30))}` : ''}`;
}

// Partes de la barra que dependen de los datos: EN VIVO y el punto de noticias
function renderNav() {
  const live = document.querySelector('.live-pill');
  const n = state.status === 'ready' ? state.live.length : 0;
  live.setAttribute('href', `#/${game.id}/partidos`);
  live.classList.toggle('on', n > 0);
  live.querySelector('.live-count').textContent = state.status === 'ready' ? n : '·';
  live.setAttribute('aria-label', n ? `${n} partidos en vivo` : 'Sin partidos en vivo');
  const fresh = state.news.items.some((i) => Date.now() - Date.parse(i.date) < 24 * 3600 * 1000);
  document.querySelector('.tab[data-route="noticias"]').classList.toggle('has-new', fresh);
}

function render() {
  const route = currentRoute();
  document.querySelector('.brand').setAttribute('href', `#/${game.id}`);
  renderNav();
  document.querySelectorAll('.game-opt').forEach((a) => {
    const active = a.dataset.game === game.id;
    a.setAttribute('href', `#/${a.dataset.game}/${route}`);
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  });
  document.querySelectorAll('.tab').forEach((t) => {
    t.setAttribute('href', `#/${game.id}/${t.dataset.route}`);
    const active = !state.query && t.dataset.route === route;
    t.classList.toggle('active', active);
    if (active) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });

  const home = route === 'inicio' && !state.query;
  if ((route === 'noticias' || home) && !state.query && state.news.status === 'idle') loadNews();
  if ((route === 'aciertos' || home) && !state.query && state.acc.status === 'idle') loadSummary();

  const busy =
    route === 'noticias' ? state.news.status === 'loading'
      : route === 'aciertos' ? state.acc.status === 'loading'
        : state.status === 'loading';
  app.setAttribute('aria-busy', String(busy));
  app.classList.toggle('is-home', home);
  app.innerHTML = state.query
    ? viewSearch()
    : {
      inicio: () => viewHome({ state, game, teamRows, notices: notices() }),
      partidos: viewPartidos,
      calendario: viewCalendario,
      equipos: viewEquipos,
      noticias: viewNoticias,
      aciertos: viewAciertos,
    }[route]();
}

// ===================== MODAL =====================

function findMatch(id) {
  return [...state.live, ...state.upcoming, ...state.past].find((m) => m.id === id);
}

function formList(team, n = 5) {
  if (!team.id) return '<p class="muted small">Equipo por definir</p>';
  const rec = recentRecord(state.stats, team.id, n);
  if (!rec.n) return '<p class="muted small">Sin partidos recientes en los datos</p>';
  return `<ul class="form-list">${rec.history.map((r) => `
    <li><span class="fd ${r.result}"></span><span class="fl-opp">vs ${esc(r.opponent)}</span><span class="fl-score">${esc(r.score)}</span></li>`).join('')}</ul>`;
}

function openMatch(id) {
  const m = findMatch(id);
  if (!m) return;
  const pred = m.status === 'upcoming' || m.status === 'live' ? predict(m, state.stats) : null;
  const h2h = m.teamA.id && m.teamB.id ? headToHead(state.past, m.teamA.id, m.teamB.id).slice(0, 5) : [];
  const stream = m.stream && safeUrl(m.stream);
  const statusText = {
    live: `En vivo · mapa ${Math.min(m.currentMap, m.bestOf)} de ${m.bestOf}`,
    upcoming: whenLabel(m.date),
    finished: `Finalizado · ${formatShortDate(m.date)}`,
    canceled: 'Cancelado',
    postponed: 'Pospuesto',
  }[m.status];

  let predHtml = '';
  if (pred && pred.insufficient) {
    predHtml = `<p class="muted small">No hay suficientes partidos recientes de ambos equipos para estimar (mínimo 3 cada uno; hay ${pred.a.n} y ${pred.b.n}).</p>`;
  } else if (pred) {
    predHtml = `
      ${probBar(pred, m)}
      <p class="small explain">
        ${esc(m.teamA.name)} ganó ${pred.a.wins} de sus últimos ${pred.a.n}; ${esc(m.teamB.name)} ganó ${pred.b.wins} de ${pred.b.n}.
        Confianza <strong class="conf-${pred.confidence}">${pred.confidence}</strong>.
      </p>`;
  }

  modalBody.innerHTML = `
    <div class="md-head">
      <div class="eyebrow">${esc(m.league)}</div>
      <div class="md-sub">${esc([m.serie, m.stage, m.format].filter(Boolean).join(' · '))}</div>
    </div>
    <div class="md-teams">
      ${mdTeam(m.teamA)}
      <div class="md-score">
        ${m.status === 'live' || m.status === 'finished' ? `<strong>${m.scoreA} – ${m.scoreB}</strong>` : '<strong class="muted">vs</strong>'}
        <span class="${m.status === 'live' ? 'live-text' : 'muted'}">${esc(statusText)}</span>
      </div>
      ${mdTeam(m.teamB)}
    </div>
    ${predHtml ? `<h3 class="section-label">Predicción por forma reciente</h3>${predHtml}` : ''}
    <h3 class="section-label">Últimos 5 partidos</h3>
    <div class="md-forms">
      <div><div class="md-form-title">${esc(m.teamA.name)}</div>${formList(m.teamA)}</div>
      <div><div class="md-form-title">${esc(m.teamB.name)}</div>${formList(m.teamB)}</div>
    </div>
    ${h2h.length ? `
      <h3 class="section-label">Cruces recientes</h3>
      <ul class="h2h">${h2h.map((x) => {
        const w = x.draw ? 'Empate' : x.winner === 'A' ? x.teamA.name : x.winner === 'B' ? x.teamB.name : '—';
        return `<li><span class="muted">${esc(formatShortDate(x.date))} · ${esc(x.league)}</span><span><strong>${esc(w)}</strong> ${x.scoreA}–${x.scoreB}</span></li>`;
      }).join('')}</ul>` : ''}
    ${m.teamA.id || m.teamB.id ? `
      <h3 class="section-label">Planteles</h3>
      <div class="md-forms">
        ${[m.teamA, m.teamB].map((t) => `<div><div class="md-form-title">${esc(t.name)}</div>${rosterSlot(t)}</div>`).join('')}
      </div>` : ''}
    ${stream && m.status !== 'finished' ? `<a class="btn block" href="${esc(stream)}" target="_blank" rel="noopener noreferrer">Ver transmisión ↗</a>` : ''}`;

  showModal();
  ensureRosters([m.teamA.id, m.teamB.id]);
}

function mdTeam(team) {
  const inner = `${teamLogo(team, 'lg')}<span>${esc(team.name)}</span>`;
  return team.id
    ? `<button type="button" class="md-team team-link" data-team="${team.id}" aria-label="Ver equipo ${esc(team.name)}">${inner}</button>`
    : `<div class="md-team">${inner}</div>`;
}

function rosterSlot(team) {
  if (!team.id) return '<p class="muted small">Equipo por definir</p>';
  return `<div data-roster="${team.id}">${rosterGrid(state.rosters.get(team.id))}</div>`;
}

function findTeam(id) {
  if (state.stats.has(id)) return state.stats.get(id).team;
  for (const m of [...state.live, ...state.upcoming, ...state.past]) {
    if (m.teamA.id === id) return m.teamA;
    if (m.teamB.id === id) return m.teamB;
  }
  return null;
}

function openTeam(id) {
  const team = findTeam(id);
  if (!team) return;
  const rec = recentRecord(state.stats, id);
  const next = [...state.live, ...state.upcoming].filter((m) => m.teamA.id === id || m.teamB.id === id).slice(0, 5);

  modalBody.innerHTML = `
    <div class="team-head">
      ${teamLogo(team, 'lg')}
      <div>
        <div class="eyebrow">Equipo</div>
        <h2 class="team-title">${esc(team.name)}</h2>
        <div class="md-sub">${rec.n ? `${rec.wins}–${rec.losses}${rec.draws ? `–${rec.draws}` : ''} en sus últimos ${rec.n} · ${Math.round((rec.wins / rec.n) * 100)}% de victorias` : 'Sin resultados recientes en los datos'}</div>
      </div>
    </div>
    <h3 class="section-label">Plantel</h3>
    ${rosterSlot(team)}
    ${next.length ? `
      <h3 class="section-label">Próximos partidos</h3>
      <ul class="h2h">${next.map((m) => {
        const rival = m.teamA.id === id ? m.teamB : m.teamA;
        return `<li><button type="button" class="row-link" data-match="${m.id}"><span>vs <strong>${esc(rival.name)}</strong></span><span class="muted">${m.status === 'live' ? 'En vivo' : esc(whenLabel(m.date))}</span></button></li>`;
      }).join('')}</ul>` : ''}
    <h3 class="section-label">Últimos resultados</h3>
    ${formList(team, 10)}`;

  showModal();
  ensureRosters([id]);
}

function showModal() {
  if (!modal.open) modal.showModal();
  modal.scrollTop = 0;
}

// ===================== EVENTOS =====================

document.addEventListener('click', (e) => {
  const matchEl = e.target.closest('[data-match]');
  if (matchEl) return openMatch(Number(matchEl.dataset.match));

  const teamEl = e.target.closest('[data-team]');
  if (teamEl) return openTeam(Number(teamEl.dataset.team));

  const filterEl = e.target.closest('[data-filter]');
  if (filterEl) {
    state.filter = filterEl.dataset.filter;
    return render();
  }

  const newsFilterEl = e.target.closest('[data-news-filter]');
  if (newsFilterEl) {
    state.news.filter = newsFilterEl.dataset.newsFilter;
    return render();
  }

  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'retry' || action === 'refresh') return load({ force: true });
  if (action === 'refresh-news') {
    loadNews({ force: true });
    return render();
  }
  if (action === 'refresh-acc') {
    loadSummary({ force: true });
    return render();
  }
  if (action === 'close-modal') return modal.close();

  // Carrusel de noticias de la home
  const count = Math.min(state.news.items.length, 5);
  if ((action === 'home-news-prev' || action === 'home-news-next') && count) {
    state.homeNews = (state.homeNews + (action === 'home-news-next' ? 1 : count - 1)) % count;
    return render();
  }
  const dotEl = e.target.closest('[data-home-news]');
  if (dotEl) {
    state.homeNews = Number(dotEl.dataset.homeNews);
    return render();
  }

  if (e.target.closest('.search-toggle')) return toggleSearch();

  if (e.target.closest('.tab, .brand') && state.query) {
    searchInput.value = '';
    state.query = '';
    toggleSearch(false);
    render();
  }
});

// La búsqueda vive en una fila que se despliega bajo la barra
function toggleSearch(open) {
  const row = document.getElementById('search-row');
  const btn = document.querySelector('.search-toggle');
  const show = open ?? row.hidden;
  row.hidden = !show;
  btn.setAttribute('aria-expanded', String(show));
  if (show) searchInput.focus();
}

searchInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  searchInput.value = '';
  state.query = '';
  toggleSearch(false);
  document.querySelector('.search-toggle').focus();
  render();
});

// Clic en el fondo del <dialog> lo cierra
modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.close();
});

searchInput.addEventListener('input', () => {
  state.query = searchInput.value.trim();
  render();
});

window.addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  const { gameId } = parseHash();
  if (gameId !== game.id) return switchGame(gameId);
  render();
});

document.addEventListener('visibilitychange', maybeRefresh);
setInterval(maybeRefresh, 30 * 1000);
setInterval(() => {
  const el = document.getElementById('updated-text');
  if (el && state.at) el.textContent = updatedText();
}, 30 * 1000);

// ===================== INICIO =====================

applyBrand();
applyGame();
clearLegacyCache();
load();
