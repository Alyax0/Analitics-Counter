// Home de cada juego: portada, partido destacado, equipos en forma, panel de
// partidos, tarjetas (predicciones, calendario, noticias, en vivo) y noticias.
// Recibe el estado ya cargado desde app.js y solo arma HTML.

import { predict, recentRecord } from './model.js';
import { esc, safeUrl, ago, dayKey, dayLabel, formatTime, formatShortDate, whenLabel, teamLogo, formDots, skeletonList, errorState } from './ui.js';
import { ICONS } from './icons.js';

const HOUR = 3600 * 1000;
const TIER = { s: 5, a: 4, b: 3, c: 2, d: 1 };
const tierOf = (m) => TIER[m.tier] || 0;
const bothTeams = (m) => m.teamA.id && m.teamB.id;
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const link = (game, route) => `#/${game.id}/${route}`;
const arrow = `<span class="arrow">${ICONS.flecha}</span>`;

// Partido para destacar: el en vivo de mayor nivel; si no hay, el próximo de
// mayor nivel en las próximas 48 h (o el más cercano con rivales definidos)
function pickFeatured(state, now) {
  const live = state.live.filter(bothTeams).sort((a, b) => tierOf(b) - tierOf(a));
  if (live.length) return live[0];
  const withTeams = state.upcoming.filter((m) => bothTeams(m) && m.date);
  const soon = withTeams.filter((m) => m.date - now < 48 * HOUR);
  return [...(soon.length ? soon : withTeams)].sort((a, b) => tierOf(b) - tierOf(a) || a.date - b.date)[0] || null;
}

// Logo grande para el fondo; si no hay imagen, las siglas
function artLogo(team, cls) {
  const src = team.logo && safeUrl(team.logo);
  return src
    ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
    : `<span class="${cls} art-initials">${esc((team.acronym || team.name).slice(0, 3))}</span>`;
}

function hero({ state, game }, featured, now) {
  const ready = state.status === 'ready';
  const today = state.upcoming.filter((m) => m.date && dayKey(m.date) === dayKey(new Date(now))).length;
  const acc = state.acc.status === 'ready' ? state.acc.data.games[game.id] : null;
  const facts = [
    `<a href="${link(game, 'partidos')}"><strong>${state.live.length}</strong> en vivo</a>`,
    `<a href="${link(game, 'calendario')}"><strong>${today}</strong> partido${today === 1 ? '' : 's'} hoy</a>`,
    acc && acc.accuracy != null ? `<a href="${link(game, 'aciertos')}"><strong>${pct(acc.accuracy)}</strong> de aciertos</a>` : '',
  ].filter(Boolean);

  return `
    <section class="hero">
      <div class="hero-art" aria-hidden="true">
        ${featured ? `${artLogo(featured.teamA, 'art-a')}${artLogo(featured.teamB, 'art-b')}` : ''}
      </div>
      <div class="wrap hero-inner">
        <div class="kicker"><span class="kicker-dot"></span>Esports · ${esc(game.name)}</div>
        <h1 class="hero-title">${esc(game.name)}</h1>
        <p class="hero-lead">Partidos en vivo, resultados y predicciones <br>con datos reales, todo en un lugar</p>
        <div class="hero-facts">
          ${ready ? facts.join('<span class="sep">/</span>') : '<span class="sk w40"></span>'}
        </div>
      </div>
    </section>`;
}

function featureMatch({ state, game }, f) {
  if (!f) return '';
  const p = predict(f, state.stats);
  const ok = p && !p.insufficient;
  const fav = ok && p.favorite ? (p.favorite === 'A' ? f.teamA : f.teamB) : null;
  const isLive = f.status === 'live';

  let desc;
  if (isLive) desc = `Se juega ahora: mapa ${Math.min(f.currentMap, f.bestOf)} de ${f.bestOf}, va ${f.scoreA}–${f.scoreB}.`;
  else desc = `${whenLabel(f.date)} · ${f.format}.`;
  if (fav) desc += ` El modelo da como favorito a ${fav.name} con ${Math.max(p.probA, p.probB)}%, según su forma reciente.`;
  else if (p && p.insufficient) desc += ' Todavía no hay partidos suficientes para estimar quién gana.';
  else if (ok) desc += ' El modelo lo ve parejo.';

  const row = (team, side) => {
    const rec = recentRecord(state.stats, team.id, 5);
    const prob = ok ? (side === 'A' ? p.probA : p.probB) : null;
    const chip = prob == null ? '<span class="chip-tag">sin datos</span>'
      : `<span class="chip-tag ${p.favorite === side ? 'good' : 'bad'}">${prob}%</span>`;
    return `
      <span class="ov-row">
        ${teamLogo(team)}
        <span class="ov-name">${esc(team.name)}</span>
        ${formDots(rec.history)}
        ${chip}
      </span>`;
  };

  return `
    <section class="feature">
      <div class="feature-text">
        <div class="feature-meta"><span class="badge ${isLive ? 'live' : ''}">${isLive ? 'En vivo' : 'Destacado'}</span>${esc(f.league)} · ${esc(f.format)}</div>
        <h2 class="feature-title">${esc(f.teamA.name)} <span>vs</span> ${esc(f.teamB.name)}</h2>
        <p class="feature-desc">${esc(desc)}</p>
        <button type="button" class="cta" data-match="${f.id}">Ver partido ${arrow}</button>
      </div>
      <button type="button" class="feature-visual" data-match="${f.id}" aria-label="Ver ${esc(f.teamA.name)} contra ${esc(f.teamB.name)}">
        <span class="fv-art" aria-hidden="true">${artLogo(f.teamA, 'fv-a')}${artLogo(f.teamB, 'fv-b')}</span>
        <span class="overlay">
          <span class="ov-head">${isLive ? 'En vivo' : esc(whenLabel(f.date))} · forma reciente</span>
          ${row(f.teamA, 'A')}
          ${row(f.teamB, 'B')}
          ${ok ? `<span class="ov-foot">Confianza <strong class="conf-${p.confidence}">${p.confidence}</strong></span>` : ''}
        </span>
      </button>
    </section>`;
}

function featureForm({ game }, teamRows) {
  const top = teamRows().slice(0, 3);
  if (!top.length) return '';
  return `
    <section class="feature reverse">
      <a class="feature-visual" href="${link(game, 'equipos')}" aria-label="Ver equipos en forma">
        <span class="fv-art" aria-hidden="true">${artLogo(top[0].team, 'fv-a')}</span>
        <span class="overlay">
          <span class="ov-head">Últimos 10 partidos · los que mejor llegan</span>
          ${top.map(({ team, rec }) => `
            <span class="ov-row">
              ${teamLogo(team)}
              <span class="ov-name">${esc(team.name)}</span>
              <strong class="ov-pct">${Math.round((rec.wins / rec.n) * 100)}%</strong>
              <span class="ov-delta">${rec.wins}–${rec.losses}</span>
            </span>`).join('')}
        </span>
      </a>
      <div class="feature-text">
        <div class="feature-meta"><span class="badge">Forma</span>Equipos en racha</div>
        <h2 class="feature-title">¿Quién llega mejor?</h2>
        <p class="feature-desc">Los equipos con mejor racha en sus últimos 10 partidos, calculado con resultados reales. No es un ranking oficial.</p>
        <a class="cta" href="${link(game, 'equipos')}">Ver equipos ${arrow}</a>
      </div>
    </section>`;
}

function miniRow(m, right) {
  return `
    <button type="button" class="mini-row" data-match="${m.id}">
      ${teamLogo(m.teamA, 'sm')}
      <span class="mini-teams">${esc(m.teamA.name)} <span class="muted">vs</span> ${esc(m.teamB.name)}<span class="mini-sub">${esc(m.league)}</span></span>
      <span class="mini-right">${right}</span>
    </button>`;
}

function panel({ state, game }) {
  const next = state.upcoming.filter(bothTeams).slice(0, 4);
  const results = state.past.slice(0, 4);
  const winner = (m) => (m.winner === 'A' ? m.teamA : m.winner === 'B' ? m.teamB : null);
  const col = (title, route, body) => `
    <div class="panel-col">
      <a class="panel-col-head" href="${link(game, route)}"><span>${title}</span>${arrow}</a>
      ${body}
    </div>`;

  const liveBody = state.live.length
    ? state.live.slice(0, 4).map((m) => miniRow(m, `<strong class="live-text">${m.scoreA}–${m.scoreB}</strong>`)).join('')
    : `<p class="panel-empty">No hay partidos en vivo.${next[0] ? ` El próximo: ${esc(whenLabel(next[0].date))}.` : ''}</p>`;

  return `
    <section class="panel">
      <div class="panel-head">
        <div class="eyebrow">Partidos</div>
        <h2 class="panel-title">La competencia al día</h2>
        <p class="panel-sub">Lo que se juega ahora, lo que viene y cómo terminaron los últimos partidos</p>
      </div>
      <div class="panel-cols">
        ${col('En vivo ahora', 'partidos', liveBody)}
        ${col('Próximos partidos', 'calendario', next.length ? next.map((m) => miniRow(m, esc(formatTime(m.date)))).join('') : '<p class="panel-empty">Sin partidos programados.</p>')}
        ${col('Resultados recientes', 'partidos', results.length ? results.map((m) => {
          const w = winner(m);
          return miniRow(m, `<span class="nowrap">${m.scoreA}–${m.scoreB}</span>${w ? `<span class="mini-sub">${esc(w.acronym)}</span>` : ''}`);
        }).join('') : '<p class="panel-empty">Sin resultados recientes.</p>')}
      </div>
    </section>`;
}

function predictionsCard({ state, game }) {
  const acc = state.acc;
  let body;
  if (acc.status === 'idle' || acc.status === 'loading') body = '<span class="sk big w30"></span><span class="sk w60"></span><span class="sk w40"></span>';
  else if (acc.status === 'error') body = `<p class="card-text">${/404/.test(acc.error) ? 'El registro todavía no empezó.' : 'No se pudo cargar el historial.'}</p>`;
  else {
    const g = acc.data.games[game.id];
    if (!g) body = '<p class="card-text">Todavía no hay predicciones registradas de este juego.</p>';
    else {
      const levels = [['alta', 'Alta'], ['media', 'Media'], ['baja', 'Baja']].map(([k, label]) => {
        const l = g.byConfidence[k];
        return `
          <a class="level level-${k}" href="${link(game, 'aciertos')}">
            <span class="level-name">${label}</span>
            <span class="level-sub">${l.n} partido${l.n === 1 ? '' : 's'}</span>
            <strong class="level-pct">${l.n ? pct(l.correct / l.n) : '—'}</strong>
            ${arrow}
          </a>`;
      }).join('');
      body = `
        <div class="big-stat"><strong>${pct(g.accuracy)}</strong><span>de aciertos en ${g.decided} partidos resueltos · ${g.pending} pendientes</span></div>
        <div class="levels">${levels}</div>`;
    }
  }
  return `
    <div class="card card-big">
      <div class="eyebrow">Predicciones</div>
      <h2 class="card-title">¿Cuánto acierta <span>el modelo?</span></h2>
      ${body}
    </div>`;
}

function calendarCard({ state, game }, now) {
  const days = new Map();
  for (const m of state.upcoming) {
    if (!m.date) continue;
    const k = dayKey(m.date);
    if (!days.has(k)) days.set(k, { label: dayLabel(m.date), n: 0 });
    days.get(k).n++;
  }
  const list = [...days.values()].slice(0, 3);
  return `
    <a class="card card-link" href="${link(game, 'calendario')}">
      <div class="eyebrow">Calendario</div>
      <h3 class="card-title sm">Lo que se viene</h3>
      ${list.length ? `<ul class="day-list">${list.map((d) => `<li><span>${esc(d.label)}</span><strong>${d.n}</strong></li>`).join('')}</ul>` : '<p class="card-text">Sin partidos programados.</p>'}
      <span class="cta small">Ver calendario ${arrow}</span>
    </a>`;
}

function newsCardSmall({ state, game }) {
  const news = state.news;
  const first = news.status === 'ready' ? news.items[0] : null;
  return `
    <a class="card card-link" href="${link(game, 'noticias')}">
      <div class="eyebrow">Noticias</div>
      <h3 class="card-title sm">Lo último</h3>
      ${first ? `<p class="card-text clamp">${esc(first.title)}</p><span class="card-meta">${esc(first.source)} · ${esc(ago(Date.parse(first.date)))}</span>`
        : news.status === 'error' ? '<p class="card-text">No se pudieron cargar las noticias.</p>'
          : '<span class="sk w60"></span><span class="sk w40"></span>'}
      <span class="cta small">Ver noticias ${arrow}</span>
    </a>`;
}

function liveCard({ state, game }) {
  const n = state.live.length;
  return `
    <a class="card card-link card-live ${n ? 'on' : ''}" href="${link(game, 'partidos')}">
      <div class="eyebrow"><span class="live-dot"></span>${n ? `${n} en vivo` : 'Sin directo'}</div>
      <h3 class="card-title sm">En vivo</h3>
      <span class="pill-big">${n ? `${n} partido${n === 1 ? '' : 's'} ahora` : 'Nada en juego ahora'}</span>
      <span class="cta small">Ver partidos ${arrow}</span>
    </a>`;
}

function newsStrip({ state, game }, featured) {
  const news = state.news;
  let carousel;
  if (news.status === 'ready' && news.items.length) {
    const items = news.items.slice(0, 5);
    const i = Math.min(state.homeNews || 0, items.length - 1);
    const n = items[i];
    const url = safeUrl(n.url);
    const isNew = Date.now() - Date.parse(n.date) < 48 * HOUR;
    carousel = `
      <article class="news-feature">
        <a class="nf-visual" href="${esc(url || '#')}" target="_blank" rel="noopener noreferrer" aria-hidden="true" tabindex="-1">
          <span class="nf-source">${esc(n.source)}</span>
          <span class="nf-kind">${esc(n.kind)}</span>
        </a>
        <div class="nf-body">
          <div class="nf-meta">${isNew ? '<span class="badge light">Nuevo</span>' : ''}${esc(formatShortDate(new Date(n.date)))} · ${esc(n.source)}</div>
          <h3 class="nf-title"><a href="${esc(url || '#')}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a></h3>
          ${n.summary ? `<p class="nf-summary">${esc(n.summary)}</p>` : ''}
          <div class="nf-foot">
            <a class="cta small" href="${link(game, 'noticias')}">Ver todas ${arrow}</a>
            <div class="dots">
              <button type="button" class="round-btn" data-action="home-news-prev" aria-label="Noticia anterior">${ICONS.izq}</button>
              ${items.map((_, k) => `<button type="button" class="dot ${k === i ? 'on' : ''}" data-home-news="${k}" aria-label="Noticia ${k + 1}"${k === i ? ' aria-current="true"' : ''}></button>`).join('')}
              <button type="button" class="round-btn" data-action="home-news-next" aria-label="Noticia siguiente">${ICONS.der}</button>
            </div>
          </div>
        </div>
      </article>`;
  } else if (news.status === 'error') {
    carousel = `<div class="news-feature empty"><p class="card-text">No se pudieron cargar las noticias. <button type="button" class="link-btn" data-action="refresh-news">Reintentar</button></p></div>`;
  } else {
    carousel = '<div class="news-feature empty"><span class="sk w60"></span><span class="sk w40"></span></div>';
  }

  const side = state.upcoming.filter((m) => bothTeams(m) && m.id !== featured?.id).sort((a, b) => tierOf(b) - tierOf(a) || a.date - b.date)[0];
  const sideCard = side ? `
    <button type="button" class="side-match" data-match="${side.id}">
      <span class="eyebrow">Esports</span>
      <span class="side-league">${esc(side.league)}</span>
      <span class="side-sub">Próximo partido${side.stage ? ` · ${esc(side.stage)}` : ''}</span>
      <span class="side-teams">${teamLogo(side.teamA, 'lg')}<span class="vs">vs</span>${teamLogo(side.teamB, 'lg')}</span>
      <span class="side-names">${esc(side.teamA.name)} · ${esc(side.teamB.name)}</span>
      <strong class="side-when">${esc(whenLabel(side.date))}</strong>
      <span class="cta small">Ver detalle ${arrow}</span>
    </button>` : '';

  return `
    <section class="news-strip ${sideCard ? '' : 'solo'}">
      <div>
        <h2 class="strip-label"><span class="live-dot"></span>Últimas noticias</h2>
        ${carousel}
      </div>
      ${sideCard}
    </section>`;
}

export function viewHome(ctx) {
  const { state, game, notices, teamRows } = ctx;
  const now = state.demo ? state.demo.getTime() : Date.now();
  const featured = state.status === 'ready' ? pickFeatured(state, now) : null;

  if (state.status === 'loading') {
    return `${hero(ctx, null, now)}<div class="wrap home-body"><div class="feature skel">${skeletonList(2)}</div>${skeletonList(4)}</div>`;
  }
  if (state.status === 'error') {
    return `${hero(ctx, null, now)}<div class="wrap home-body">${errorState(state.error)}</div>`;
  }

  return `
    ${hero(ctx, featured, now)}
    <div class="wrap home-body">
      ${notices}
      ${featureMatch(ctx, featured)}
      ${featureForm(ctx, teamRows)}
      ${panel(ctx)}
      <section class="card-grid">
        ${predictionsCard(ctx)}
        ${calendarCard(ctx, now)}
        ${newsCardSmall(ctx)}
        ${liveCard(ctx)}
      </section>
      ${newsStrip(ctx, featured)}
    </div>`;
}
