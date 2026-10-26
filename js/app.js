import { GAMES, DEFAULT_GAME } from './games.js';
import { psGet, newsGet, summaryGet, clearLegacyCache, PREDICTIONS_REPO } from './api.js';
import { normalizeMatch, normalizeRoster, buildTeamStats, recentRecord, predict, headToHead, LABELS } from './model.js';
import {
  esc, safeUrl, ago, dayKey, dayLabel, formatTime, formatShortDate, whenLabel, timezoneLabel,
  teamLogo, formDots, probBar, matchCard, skeletonList, skeletonStats, emptyState, errorState,
  rosterGrid, newsCard, newsHero, confLevel,
} from './ui.js';
import { t, setLang, preferredLang, getLang } from './i18n.js';
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
  if (!res.ok) throw new Error(t('errors.demo', { status: res.status }));
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
  document.title = t('meta.title', { brand: BRAND.name, game: game.name });
}

// Cada idioma se nombra en su propio idioma
const LANG_NAMES = { es: 'Español', en: 'English' };

// Textos fijos de la página (barra, búsqueda, pie, modal) en el idioma actual
function applyStaticTexts() {
  document.querySelector('.brand').innerHTML = `
    <span class="brand-mark">${BRAND_MARK}</span>
    <span class="brand-name">${esc(BRAND.name)}</span>
    <span class="brand-tag">${esc(BRAND.tag)}</span>`;
  document.querySelectorAll('.tab').forEach((tab) => {
    const route = tab.dataset.route;
    tab.innerHTML = `<span class="tab-icon">${ICONS[route] || ''}</span>${esc(t(`nav.${route}`))}${
      route === 'noticias' ? '<span class="tab-dot" aria-hidden="true"></span>' : ''}`;
  });
  document.querySelector('.live-label').textContent = t('nav.live');
  document.querySelector('.game-switch').setAttribute('aria-label', t('nav.game'));
  document.querySelector('.tabs').setAttribute('aria-label', t('nav.sections'));
  const langSwitch = document.querySelector('.lang-switch');
  langSwitch.setAttribute('aria-label', t('nav.language'));
  langSwitch.querySelectorAll('[data-lang]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === getLang()));
    b.setAttribute('aria-label', LANG_NAMES[b.dataset.lang]);
    b.setAttribute('lang', b.dataset.lang);
  });
  const toggle = document.querySelector('.search-toggle');
  toggle.innerHTML = ICONS.buscar;
  toggle.setAttribute('aria-label', t('nav.search'));
  document.querySelector('.search-label').textContent = t('nav.search');
  searchInput.placeholder = t('nav.searchPlaceholder');
  modal.setAttribute('aria-label', t('nav.matchDetail'));
  document.querySelector('.modal-close').setAttribute('aria-label', t('nav.close'));
  document.getElementById('footer-text').innerHTML = t('footer.data', {
    link: '<a href="https://pandascore.co" target="_blank" rel="noopener noreferrer">PandaScore</a>',
  });
  // Textos que arma la normalización de partidos
  LABELS.tbd = t('common.tbd');
  LABELS.tournament = t('common.tournament');
  LABELS.maps = (n) => t('common.maps', { n });
}

async function switchLang(code) {
  if (code === getLang()) return;
  await setLang(code);
  applyStaticTexts();
  applyGame();
  if (modal.open) modal.close();
  render();
  // Vuelve a normalizar los partidos para que "Por definir" y similares cambien de idioma
  load();
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
      for (const id of missing) state.rosters.set(id, { id, error: true });
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
        ${t('notices.demo', { date: esc(captureLabel()) })}
        ${FORCE_DEMO
          ? `<a class="link-btn" href="./#/${game.id}/${currentRoute()}">${esc(t('notices.demoLive'))}</a>`
          : `${esc(t('notices.apiDown'))} <button type="button" class="link-btn" data-action="refresh">${esc(t('common.retry'))}</button>`}
      </div>` : ''}
    ${state.status === 'ready' && state.stale ? `
      <div class="notice" role="status">
        ${esc(t('notices.stale', { error: state.error || t('common.unknownError') }))}
        <button type="button" class="link-btn" data-action="refresh">${esc(t('common.retry'))}</button>
      </div>` : ''}`;
}

function captureLabel() {
  return `${formatShortDate(state.demo)} ${state.demo.getFullYear()}, ${formatTime(state.demo)}`;
}

function updatedText() {
  return state.demo ? t('common.demoData') : t('common.updated', { ago: ago(state.at) });
}

function updatedBadge() {
  return `
    <div class="updated">
      <span id="updated-text">${esc(updatedText())}</span>
      <button type="button" class="icon-btn ${state.loading ? 'spinning' : ''}" id="refresh-btn" data-action="refresh" aria-label="${esc(t('common.refreshData'))}" title="${esc(t('common.refresh'))}">↻</button>
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
  const head = header('● ' + game.name, t('partidos.title'), t('partidos.accent'));
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
  const chip = (id, count) =>
    `<button type="button" class="chip ${state.filter === id ? 'active' : ''}" data-filter="${id}" aria-pressed="${state.filter === id}">${esc(t(`partidos.chips.${id}`))} <span>${count}</span></button>`;
  const stat = (key, value, accent = false) => `
    <div class="stat-item"><div class="s-label">${esc(t(`partidos.stats.${key}`))}</div><div class="s-val ${accent ? 'accent' : ''}">${value}</div><div class="s-sub">${esc(t(`partidos.stats.${key}Sub`))}</div></div>`;

  return `
    ${head}
    <div class="stat-row">
      ${stat('live', state.live.length, true)}
      ${stat('next24', next24.length)}
      ${stat('leagues', leagues.size)}
      ${stat('withPred', `${predictable}<small>/${upcoming.length}</small>`)}
    </div>
    <div class="chips" role="group" aria-label="${esc(t('partidos.filterAria'))}">
      ${chip('all', groups.all.length)}
      ${chip('live', groups.live.length)}
      ${chip('upcoming', groups.upcoming.length)}
      ${chip('finished', groups.finished.length)}
    </div>
    ${shown.length ? list(shown) : emptyState(t(`partidos.empty.${state.filter}.title`), t(`partidos.empty.${state.filter}.text`))}
    <p class="footnote">${esc(t('partidos.footnote', { n: state.past.length }))}</p>`;
}

function viewCalendario() {
  const head = header('● ' + t('calendario.eyebrow'), t('calendario.title'), `(${timezoneLabel()})`);
  if (state.status === 'loading') return head + skeletonList(8);
  if (state.status === 'error') return head + errorState(state.error);

  const items = [...state.live, ...state.upcoming];
  if (!items.length) return head + emptyState(t('calendario.emptyTitle'), t('calendario.emptyText'));

  const days = new Map();
  for (const m of items) {
    const k = m.status === 'live' ? 'live' : dayKey(m.date);
    if (!days.has(k)) days.set(k, { label: m.status === 'live' ? t('calendario.liveNow') : dayLabel(m.date), items: [] });
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
        <thead><tr><th scope="col">#</th>${['team', 'wl', 'pct', 'form'].map((c) => `<th scope="col">${esc(t(`equipos.col.${c}`))}</th>`).join('')}</tr></thead>
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
  const head = header('● ' + t('equipos.eyebrow'), t('equipos.title'), t('equipos.accent'));
  if (state.status === 'loading') return head + skeletonList(8);
  if (state.status === 'error') return head + errorState(state.error);

  const rows = teamRows().slice(0, 25);
  if (!rows.length) return head + emptyState(t('equipos.emptyTitle'), t('equipos.emptyText'));
  return `
    ${head}
    <p class="lead">${esc(t('equipos.lead', { n: state.past.length }))}</p>
    ${teamTable(rows)}`;
}

function viewNoticias() {
  const news = state.news;
  const head = `
    <div class="page-head">
      <div>
        <div class="eyebrow">● ${esc(t(`news.games.${game.id}.eyebrow`))}</div>
        <h1 class="heading">${esc(t('news.title'))} <span>${esc(t('news.accent'))}</span></h1>
      </div>
      ${news.status === 'ready' ? `
        <div class="updated">
          <span>${esc(t('common.updated', { ago: ago(news.at) }))}</span>
          <button type="button" class="icon-btn ${news.loading ? 'spinning' : ''}" data-action="refresh-news" aria-label="${esc(t('news.refreshAria'))}" title="${esc(t('common.refresh'))}">↻</button>
        </div>` : ''}
    </div>`;
  if (news.status === 'idle' || news.status === 'loading') {
    return head + `<div class="news-grid" aria-hidden="true">${'<div class="skeleton-card"><span class="sk w30"></span><span class="sk w60"></span><span class="sk w40"></span></div>'.repeat(6)}</div>`;
  }
  if (news.status === 'error') return head + errorState(news.error, t('errors.news'), 'refresh-news');

  const sources = game.newsSources;
  const labelOf = (id) => t(`news.games.${game.id}.sources.${id}`);
  const failed = Object.entries(news.sources).filter(([, v]) => v !== 'ok').map(([k]) => labelOf(k));
  const shown = news.filter === 'all' ? news.items : news.items.filter((n) => n.source === news.filter);
  const count = (s) => news.items.filter((n) => n.source === s).length;
  const chip = (id, label, n) =>
    `<button type="button" class="chip ${news.filter === id ? 'active' : ''}" data-news-filter="${esc(id)}" aria-pressed="${news.filter === id}">${esc(label)} <span>${n}</span></button>`;

  return `
    ${head}
    ${news.stale ? `<div class="notice" role="status">${esc(t('news.stale', { error: news.error || t('common.unknownError') }))}</div>` : ''}
    ${failed.length && !news.stale ? `<div class="notice" role="status">${esc(t('news.failed', { sources: failed.join(', ') }))}</div>` : ''}
    ${sources.length > 1 ? `
      <div class="chips" role="group" aria-label="${esc(t('news.filterAria'))}">
        ${chip('all', t('news.all'), news.items.length)}
        ${sources.map((id) => chip(id, labelOf(id), count(id))).join('')}
      </div>` : ''}
    ${shown.length ? `${newsHero(shown[0])}${shown.length > 1 ? `<div class="news-grid">${shown.slice(1).map(newsCard).join('')}</div>` : ''}` : emptyState(t('news.emptyTitle'), t('news.emptyText'))}
    <p class="footnote">${esc(t(`news.games.${game.id}.footnote`))} ${esc(t('news.footnote'))}</p>`;
}

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

// Motivos de anulación tal como los guarda scripts/predictions-core.js
const VOID_REASONS = {
  cancelado: 'canceled',
  'guardada tarde': 'late',
  'W.O.': 'forfeit',
  empate: 'draw',
  'sin ganador': 'noWinner',
  'sin resultado': 'noResult',
};

function predRow(r) {
  const favProb = r.favorite === 'B' ? 100 - r.probA : r.probA;
  const name = (side) => {
    const team = side === 'A' ? r.teamA : r.teamB;
    return r.favorite === side ? `<strong>${esc(team.name)}</strong>` : esc(team.name);
  };
  let outcome;
  if (r.status === 'pending') outcome = `<span class="muted">${esc(whenLabel(new Date(r.scheduledAt)))}</span>`;
  else if (r.status === 'void') {
    // El motivo viene en español desde los datos; si no lo conocemos, se muestra tal cual
    const code = VOID_REASONS[r.reason];
    const reason = code ? t(`aciertos.reasons.${code}`) : r.reason;
    outcome = `<span class="muted">${esc(t('aciertos.row.void', { reason }))}</span>`;
  } else {
    const mark = r.correct === null ? `<span class="muted">${esc(t('aciertos.row.even'))}</span>`
      : r.correct ? `<span class="ok">${esc(t('aciertos.row.hit'))}</span>` : `<span class="ko">${esc(t('aciertos.row.miss'))}</span>`;
    outcome = `<span class="nowrap">${r.result.scoreA}–${r.result.scoreB}</span> ${mark}`;
  }
  return `
    <li class="pred-row">
      <span class="pred-date muted">${esc(formatShortDate(new Date(r.scheduledAt)))}</span>
      <span class="pred-match">${name('A')} <span class="muted">vs</span> ${name('B')}<span class="pred-league">${esc(t('aciertos.row.league', { league: r.league, level: confLevel(r.confidence) }))}</span></span>
      <span class="pred-prob">${r.favorite ? `${favProb}%` : '50%'}</span>
      <span class="pred-outcome">${outcome}</span>
    </li>`;
}

function viewAciertos() {
  const acc = state.acc;
  const head = `
    <div class="page-head">
      <div>
        <div class="eyebrow">● ${esc(t('aciertos.eyebrow'))}</div>
        <h1 class="heading">${esc(t('aciertos.title'))} <span>${esc(t('aciertos.accent'))}</span></h1>
      </div>
      ${acc.status === 'ready' && acc.data.updatedAt ? `<div class="updated"><span>${esc(t('aciertos.lastChange', { ago: ago(Date.parse(acc.data.updatedAt)) }))}</span></div>` : ''}
    </div>`;
  if (acc.status === 'idle' || acc.status === 'loading') return head + skeletonStats() + skeletonList(4);
  if (acc.status === 'error') {
    if (/404/.test(acc.error)) return head + emptyState(t('aciertos.notStartedTitle'), t('aciertos.notStartedText'));
    return head + errorState(acc.error, t('errors.history'), 'refresh-acc');
  }

  const g = acc.data.games[game.id];
  const footnote = `
    <p class="footnote">${t('aciertos.footnote', {
      model: `<code>${esc(acc.data.model)}</code>`,
      link: `<a href="${PREDICTIONS_REPO}/commits/data" target="_blank" rel="noopener noreferrer">${esc(t('aciertos.footnoteLink'))}</a>`,
    })}</p>`;
  if (!g) return head + emptyState(t('aciertos.noGameTitle', { game: game.name }), t('aciertos.noGameText')) + footnote;

  const levels = ['alta', 'media', 'baja'].map((level) => ({ level, ...g.byConfidence[level] }));
  const stat = (key, value, sub, accent = false) => `
    <div class="stat-item"><div class="s-label">${esc(t(`aciertos.stats.${key}`))}</div><div class="s-val ${accent ? 'accent' : ''}">${value}</div><div class="s-sub">${esc(sub)}</div></div>`;
  return `
    ${head}
    <div class="stat-row">
      ${stat('accuracy', pct(g.accuracy), t('aciertos.stats.accuracySub', { correct: g.correct, decided: g.decided }), true)}
      ${stat('resolved', g.resolved, t('aciertos.stats.resolvedSub', { date: formatShortDate(new Date(g.since)) }))}
      ${stat('brier', g.brier == null ? '—' : g.brier.toFixed(3), t('aciertos.stats.brierSub'))}
      ${stat('pending', g.pending, t('aciertos.stats.pendingSub'))}
    </div>
    ${!g.resolved ? `<div class="notice" role="status">${esc(t('aciertos.noneResolved'))}</div>` : ''}
    <h2 class="section-label">${esc(t('aciertos.byConfidence'))}</h2>
    <div class="table-wrap">
      <table class="teams compact">
        <thead><tr>${['confidence', 'matches', 'hits'].map((c) => `<th scope="col">${esc(t(`aciertos.col.${c}`))}</th>`).join('')}</tr></thead>
        <tbody>
          ${levels.map((l) => `
            <tr>
              <td><span class="conf conf-${l.level}">${esc(t(`conf.label.${l.level}`))}</span></td>
              <td>${l.n}</td>
              <td>${l.n ? `<div class="pct"><span class="pct-bar"><span style="width:${Math.round((l.correct / l.n) * 100)}%"></span></span><strong>${pct(l.correct / l.n)}</strong></div>` : '<span class="muted">—</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${g.pendingList.length ? `<h2 class="section-label">${esc(t('aciertos.pendingTitle'))}</h2><ul class="pred-list">${g.pendingList.map(predRow).join('')}</ul>` : ''}
    ${g.recent.length ? `<h2 class="section-label">${esc(t('aciertos.recentTitle'))}</h2><ul class="pred-list">${g.recent.map(predRow).join('')}</ul>` : ''}
    ${footnote}`;
}

function viewSearch() {
  const q = state.query.toLowerCase();
  const head = `<div class="page-head"><div><div class="eyebrow">● ${esc(t('search.eyebrow'))}</div><h1 class="heading">${esc(t('search.title'))} <span>“${esc(state.query)}”</span></h1></div></div>`;
  if (state.status !== 'ready') return head + skeletonList(3);

  const hit = (m) => m.teamA.name.toLowerCase().includes(q) || m.teamB.name.toLowerCase().includes(q) || m.league.toLowerCase().includes(q);
  const matches = [...state.live, ...state.upcoming, ...state.past.slice(0, 60)].filter(hit);
  const teams = teamRows().filter(({ team }) => team.name.toLowerCase().includes(q)).slice(0, 10);

  if (!matches.length && !teams.length) return head + emptyState(t('search.emptyTitle'), t('search.emptyText'));
  return `
    ${head}
    ${teams.length ? `<h2 class="section-label">${esc(t('search.teams'))}</h2>${teamTable(teams)}` : ''}
    ${matches.length ? `<h2 class="section-label">${esc(t('search.matches'))}</h2>${list(matches.slice(0, 30))}` : ''}`;
}

// Partes de la barra que dependen de los datos: EN VIVO y el punto de noticias
function renderNav() {
  const live = document.querySelector('.live-pill');
  const n = state.status === 'ready' ? state.live.length : 0;
  live.setAttribute('href', `#/${game.id}/partidos`);
  live.classList.toggle('on', n > 0);
  live.querySelector('.live-count').textContent = state.status === 'ready' ? n : '·';
  live.setAttribute('aria-label', n ? t('nav.liveAria', { n }) : t('nav.noLive'));
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
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.setAttribute('href', `#/${game.id}/${tab.dataset.route}`);
    const active = !state.query && tab.dataset.route === route;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
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
  if (!team.id) return `<p class="muted small">${esc(t('modal.tbdTeam'))}</p>`;
  const rec = recentRecord(state.stats, team.id, n);
  if (!rec.n) return `<p class="muted small">${esc(t('modal.noRecent'))}</p>`;
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
    live: t('modal.liveMap', { cur: Math.min(m.currentMap, m.bestOf), total: m.bestOf }),
    upcoming: whenLabel(m.date),
    finished: t('match.finished', { date: formatShortDate(m.date) }),
    canceled: t('match.canceled'),
    postponed: t('match.postponed'),
  }[m.status];

  let predHtml = '';
  if (pred && pred.insufficient) {
    predHtml = `<p class="muted small">${esc(t('modal.insufficient', { a: pred.a.n, b: pred.b.n }))}</p>`;
  } else if (pred) {
    predHtml = `
      ${probBar(pred, m)}
      <p class="small explain">
        ${esc(t('modal.explain', { a: m.teamA.name, wa: pred.a.wins, na: pred.a.n, b: m.teamB.name, wb: pred.b.wins, nb: pred.b.n }))}
        ${esc(t('modal.confidence'))} <strong class="conf-${pred.confidence}">${esc(confLevel(pred.confidence))}</strong>.
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
    ${predHtml ? `<h3 class="section-label">${esc(t('modal.predTitle'))}</h3>${predHtml}` : ''}
    <h3 class="section-label">${esc(t('modal.last5'))}</h3>
    <div class="md-forms">
      <div><div class="md-form-title">${esc(m.teamA.name)}</div>${formList(m.teamA)}</div>
      <div><div class="md-form-title">${esc(m.teamB.name)}</div>${formList(m.teamB)}</div>
    </div>
    ${h2h.length ? `
      <h3 class="section-label">${esc(t('modal.h2h'))}</h3>
      <ul class="h2h">${h2h.map((x) => {
        const w = x.draw ? t('match.draw') : x.winner === 'A' ? x.teamA.name : x.winner === 'B' ? x.teamB.name : '—';
        return `<li><span class="muted">${esc(formatShortDate(x.date))} · ${esc(x.league)}</span><span><strong>${esc(w)}</strong> ${x.scoreA}–${x.scoreB}</span></li>`;
      }).join('')}</ul>` : ''}
    ${m.teamA.id || m.teamB.id ? `
      <h3 class="section-label">${esc(t('modal.rosters'))}</h3>
      <div class="md-forms">
        ${[m.teamA, m.teamB].map((team) => `<div><div class="md-form-title">${esc(team.name)}</div>${rosterSlot(team)}</div>`).join('')}
      </div>` : ''}
    ${stream && m.status !== 'finished' ? `<a class="btn block" href="${esc(stream)}" target="_blank" rel="noopener noreferrer">${esc(t('modal.stream'))}</a>` : ''}`;

  showModal();
  ensureRosters([m.teamA.id, m.teamB.id]);
}

function mdTeam(team) {
  const inner = `${teamLogo(team, 'lg')}<span>${esc(team.name)}</span>`;
  return team.id
    ? `<button type="button" class="md-team team-link" data-team="${team.id}" aria-label="${esc(t('modal.viewTeam', { team: team.name }))}">${inner}</button>`
    : `<div class="md-team">${inner}</div>`;
}

function rosterSlot(team) {
  if (!team.id) return `<p class="muted small">${esc(t('modal.tbdTeam'))}</p>`;
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
        <div class="eyebrow">${esc(t('modal.team'))}</div>
        <h2 class="team-title">${esc(team.name)}</h2>
        <div class="md-sub">${esc(rec.n ? t('modal.record', {
          wl: `${rec.wins}–${rec.losses}${rec.draws ? `–${rec.draws}` : ''}`,
          n: rec.n,
          pct: Math.round((rec.wins / rec.n) * 100),
        }) : t('modal.noResults'))}</div>
      </div>
    </div>
    <h3 class="section-label">${esc(t('modal.roster'))}</h3>
    ${rosterSlot(team)}
    ${next.length ? `
      <h3 class="section-label">${esc(t('modal.next'))}</h3>
      <ul class="h2h">${next.map((m) => {
        const rival = m.teamA.id === id ? m.teamB : m.teamA;
        return `<li><button type="button" class="row-link" data-match="${m.id}"><span>vs <strong>${esc(rival.name)}</strong></span><span class="muted">${esc(m.status === 'live' ? t('modal.live') : whenLabel(m.date))}</span></button></li>`;
      }).join('')}</ul>` : ''}
    <h3 class="section-label">${esc(t('modal.lastResults'))}</h3>
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

  const langEl = e.target.closest('[data-lang]');
  if (langEl) return switchLang(langEl.dataset.lang);

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

// El idioma se carga antes de pintar nada para no mostrar textos mezclados
try {
  await setLang(preferredLang());
} catch {
  await setLang('es');
}
applyStaticTexts();
applyGame();
clearLegacyCache();
load();
