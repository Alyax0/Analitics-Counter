import { GAMES, DEFAULT_GAME } from './games.js';
import { psGet, clearLegacyCache } from './api.js';
import { normalizeMatch, buildTeamStats, recentRecord, predict, headToHead } from './model.js';
import {
  esc, safeUrl, ago, dayKey, dayLabel, formatTime, formatShortDate, whenLabel, timezoneLabel,
  teamLogo, formDots, probBar, matchCard, skeletonList, skeletonStats, emptyState, errorState,
} from './ui.js';

const game = GAMES[DEFAULT_GAME];
const REFRESH_EVERY = 2 * 60 * 1000;
const ROUTES = ['partidos', 'calendario', 'equipos'];
// Con ?demo se usan siempre los datos guardados en data/demo.json
const FORCE_DEMO = new URLSearchParams(location.search).has('demo');

const state = {
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
  query: '',
  loading: false,
};

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
async function loadDemo() {
  const res = await fetch('data/demo.json');
  if (!res.ok) throw new Error(`No se pudo cargar el modo demo (${res.status})`);
  const demo = await res.json();
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
      await loadDemo();
    } catch (e) {
      state.status = 'error';
      state.error = e.message;
    }
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

    setMatches(live, upcoming, [...recent, ...history]);
    state.demo = null;
    state.stale = results.some((r) => r.stale);
    state.error = results.find((r) => r.error)?.error || null;
    state.at = Math.min(...results.map((r) => r.at));
    state.status = 'ready';
  } catch (e) {
    state.error = e.message;
    if (state.status === 'ready') {
      // Si ya había datos en pantalla, los mantenemos y avisamos
      if (!state.demo) state.stale = true;
    } else {
      try {
        await loadDemo();
      } catch {
        state.status = 'error';
      }
    }
  } finally {
    state.loading = false;
    render();
  }
}

function maybeRefresh() {
  if (FORCE_DEMO || document.visibilityState !== 'visible' || state.loading) return;
  if (Date.now() - state.lastAttempt > REFRESH_EVERY) load();
}

// ===================== VISTAS =====================

function currentRoute() {
  const r = location.hash.replace(/^#\/?/, '');
  return ROUTES.includes(r) ? r : 'partidos';
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
    ${state.status === 'ready' && state.demo ? `
      <div class="notice demo" role="status">
        <strong>Modo demo:</strong> datos reales de PandaScore capturados el ${esc(captureLabel())}, no se actualizan.
        ${FORCE_DEMO
          ? '<a class="link-btn" href="./">Ver datos en vivo</a>'
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
                <td><div class="team-cell">${teamLogo(team, 'sm')}<span>${esc(team.name)}</span></div></td>
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

function render() {
  const route = currentRoute();
  document.querySelectorAll('.tab').forEach((t) => {
    const active = !state.query && t.dataset.route === route;
    t.classList.toggle('active', active);
    if (active) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });

  app.setAttribute('aria-busy', String(state.status === 'loading'));
  app.innerHTML = state.query
    ? viewSearch()
    : { partidos: viewPartidos, calendario: viewCalendario, equipos: viewEquipos }[route]();
}

// ===================== MODAL =====================

function findMatch(id) {
  return [...state.live, ...state.upcoming, ...state.past].find((m) => m.id === id);
}

function formList(team) {
  if (!team.id) return '<p class="muted small">Equipo por definir</p>';
  const rec = recentRecord(state.stats, team.id, 5);
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
      <div class="md-team">${teamLogo(m.teamA, 'lg')}<span>${esc(m.teamA.name)}</span></div>
      <div class="md-score">
        ${m.status === 'live' || m.status === 'finished' ? `<strong>${m.scoreA} – ${m.scoreB}</strong>` : '<strong class="muted">vs</strong>'}
        <span class="${m.status === 'live' ? 'live-text' : 'muted'}">${esc(statusText)}</span>
      </div>
      <div class="md-team">${teamLogo(m.teamB, 'lg')}<span>${esc(m.teamB.name)}</span></div>
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
    ${stream && m.status !== 'finished' ? `<a class="btn block" href="${esc(stream)}" target="_blank" rel="noopener noreferrer">Ver transmisión ↗</a>` : ''}`;

  modal.showModal();
}

// ===================== EVENTOS =====================

document.addEventListener('click', (e) => {
  const matchEl = e.target.closest('[data-match]');
  if (matchEl) return openMatch(Number(matchEl.dataset.match));

  const filterEl = e.target.closest('[data-filter]');
  if (filterEl) {
    state.filter = filterEl.dataset.filter;
    return render();
  }

  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'retry' || action === 'refresh') return load({ force: true });
  if (action === 'close-modal') return modal.close();

  if (e.target.closest('.tab, .logo') && state.query) {
    searchInput.value = '';
    state.query = '';
    render();
  }
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
  render();
});

document.addEventListener('visibilitychange', maybeRefresh);
setInterval(maybeRefresh, 30 * 1000);
setInterval(() => {
  const el = document.getElementById('updated-text');
  if (el && state.at) el.textContent = updatedText();
}, 30 * 1000);

// ===================== INICIO =====================

document.documentElement.style.setProperty('--accent', game.accent);
clearLegacyCache();
load();
