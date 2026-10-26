// Helpers de formato y componentes HTML reutilizables.

import { t, getLang } from './i18n.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

// ---------- Fechas (zona horaria del visitante, idioma elegido) ----------

const formats = new Map();
function fmt(options) {
  const key = `${getLang()}|${JSON.stringify(options)}`;
  if (!formats.has(key)) formats.set(key, new Intl.DateTimeFormat(getLang(), options));
  return formats.get(key);
}

export const formatTime = (d) => (d ? fmt({ hour: '2-digit', minute: '2-digit' }).format(d) : t('common.toConfirm'));
export const formatShortDate = (d) => (d ? fmt({ day: 'numeric', month: 'short' }).format(d) : '');
export const timezoneLabel = () =>
  fmt({ timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || '';

export function dayKey(d) {
  return d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : 'tbd';
}

function relativeDay(d) {
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (dayKey(d) === dayKey(today)) return t('common.today');
  if (dayKey(d) === dayKey(tomorrow)) return t('common.tomorrow');
  return null;
}

export function dayLabel(d) {
  if (!d) return t('common.dateToConfirm');
  const rel = relativeDay(d);
  if (rel) return rel;
  const s = fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function whenLabel(d) {
  if (!d) return t('common.toConfirm');
  return `${relativeDay(d) || formatShortDate(d)} · ${formatTime(d)}`;
}

export function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return t('common.secondsAgo');
  const m = Math.round(s / 60);
  if (m < 60) return t('common.minutesAgo', { n: m });
  return t('common.hoursAgo', { n: Math.round(m / 60) });
}

// ---------- Textos que vienen en español desde los datos ----------

const NEWS_KINDS = { Noticia: 'news', 'Actualización': 'update' };
export const newsKind = (kind) => (NEWS_KINDS[kind] ? t(`news.kind.${NEWS_KINDS[kind]}`) : kind);
export const confLevel = (c) => t(`conf.${c}`);

// ---------- Componentes ----------

export function teamLogo(team, size = 'md') {
  const initials = esc((team.acronym || team.name || '?').slice(0, 3));
  const src = team.logo && safeUrl(team.logo);
  return `<span class="logo-badge ${size}" aria-hidden="true"><span>${initials}</span>${
    src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''
  }</span>`;
}

export function formDots(history, n = 5) {
  if (!history.length) return `<span class="muted small">${esc(t('common.noData'))}</span>`;
  const label = { w: t('match.win'), l: t('match.loss'), d: t('match.draw') };
  return `<span class="form-dots">${history
    .slice(0, n)
    .map((r) => `<span class="fd ${r.result}" title="${esc(label[r.result])} vs ${esc(r.opponent)} ${esc(r.score)}"></span>`)
    .join('')}</span>`;
}

export function probBar(pred, match) {
  const aria = t('match.probAria', { a: match.teamA.name, pa: pred.probA, b: match.teamB.name, pb: pred.probB });
  return `
    <div class="prob" role="img" aria-label="${esc(aria)}">
      <div class="prob-bar"><span class="pa" style="flex:${pred.probA}"></span><span class="pb" style="flex:${pred.probB}"></span></div>
      <div class="prob-labels"><span>${pred.probA}%</span><span>${pred.probB}%</span></div>
    </div>`;
}

function statusLine(m) {
  switch (m.status) {
    case 'live':
      return `<span class="m-status live"><span class="live-dot"></span>${esc(t('match.liveMap', { cur: Math.min(m.currentMap, m.bestOf), total: m.bestOf }))}</span>`;
    case 'finished':
      return `<span class="m-status done">${esc(t('match.finished', { date: formatShortDate(m.date) }))}</span>`;
    case 'canceled':
      return `<span class="m-status done">${esc(t('match.canceled'))}</span>`;
    case 'postponed':
      return `<span class="m-status done">${esc(t('match.postponed'))}</span>`;
    default:
      return `<span class="m-status">${esc(whenLabel(m.date))}</span>`;
  }
}

function sideColumn(m, pred) {
  if (m.status === 'finished') {
    if (m.forfeit) return `<span class="muted small">${esc(t('match.forfeit'))}</span>`;
    if (m.draw) return `<span class="result-tag">${esc(t('match.draw'))}</span>`;
    const w = m.winner === 'A' ? m.teamA : m.winner === 'B' ? m.teamB : null;
    return w ? `<span class="result-tag">${esc(t('match.won', { team: w.name }))}</span>` : '';
  }
  if (m.status === 'canceled' || m.status === 'postponed') return '';
  if (!pred) return `<span class="muted small">${esc(t('match.tbdTeams'))}</span>`;
  if (pred.insufficient) return `<span class="muted small">${esc(t('match.insufficient'))}</span>`;
  const fav = pred.favorite === 'A' ? m.teamA : pred.favorite === 'B' ? m.teamB : null;
  return `
    <div class="m-pred-label"><span>${fav ? t('match.favorite', { team: esc(fav.acronym) }) : esc(t('match.even'))}</span><span class="conf conf-${pred.confidence}">${esc(t('match.confidence', { level: confLevel(pred.confidence) }))}</span></div>
    ${probBar(pred, m)}`;
}

export function matchCard(m, pred) {
  const showScore = m.status === 'live' || m.status === 'finished';
  const dimA = m.status === 'finished' && m.winner === 'B';
  const dimB = m.status === 'finished' && m.winner === 'A';
  return `
    <button type="button" class="match ${m.status}" data-match="${m.id}" aria-label="${esc(t('match.aria', { a: m.teamA.name, b: m.teamB.name, league: m.league }))}">
      <div class="m-meta">
        ${statusLine(m)}
        <span class="m-event">${esc(m.league)}</span>
        <span class="m-sub">${esc([m.serie, m.format].filter(Boolean).join(' · '))}</span>
      </div>
      <div class="m-teams">
        <div class="m-team ${dimA ? 'dim' : ''}">${teamLogo(m.teamA)}<span class="m-name">${esc(m.teamA.name)}</span></div>
        <div class="m-score">${showScore ? `${m.scoreA}<span>–</span>${m.scoreB}` : '<span class="vs">vs</span>'}</div>
        <div class="m-team right ${dimB ? 'dim' : ''}"><span class="m-name">${esc(m.teamB.name)}</span>${teamLogo(m.teamB)}</div>
      </div>
      <div class="m-side">${sideColumn(m, pred)}</div>
    </button>`;
}

// Código ISO de 2 letras → bandera emoji (indicadores regionales)
export function flag(code) {
  if (!code || !/^[a-z]{2}$/i.test(code)) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function rosterGrid(roster) {
  if (!roster) return '<div class="roster" aria-hidden="true">' + '<div class="player"><span class="sk w60"></span></div>'.repeat(5) + '</div>';
  if (roster.error) return `<p class="muted small">${esc(t('errors.roster'))}</p>`;
  if (!roster.players.length) return `<p class="muted small">${esc(t('roster.none'))}</p>`;
  return `<ul class="roster">${roster.players.map((p) => {
    const photo = p.photo && safeUrl(p.photo);
    const meta = [p.fullName, p.age ? t('roster.age', { n: p.age }) : ''].filter(Boolean).join(' · ');
    return `
      <li class="player">
        <span class="player-photo" aria-hidden="true">${esc(p.name.slice(0, 2))}${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}</span>
        <span class="player-info">
          <span class="player-name">${p.nationality ? `<span class="flag" title="${esc(p.nationality)}">${flag(p.nationality)}</span>` : ''}${esc(p.name)}</span>
          ${meta ? `<span class="player-meta">${esc(meta)}</span>` : ''}
        </span>
      </li>`;
  }).join('')}</ul>`;
}

// "Nuevo": publicada hace menos de 48 h
export const isNewNews = (n) => Date.now() - Date.parse(n.date) < 48 * 3600 * 1000;

// Portada de una nota: la imagen de la fuente sobre un degradado con el nombre
// de la fuente, que queda a la vista si no hay imagen o no carga.
export function newsVisual(n, cls = 'news-visual') {
  const src = n.image && safeUrl(n.image);
  return `
    <span class="${cls}" aria-hidden="true">
      <span class="nv-source">${esc(n.source)}</span>
      <span class="nv-kind">${esc(newsKind(n.kind))}</span>
      ${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
    </span>`;
}

function newsMeta(n) {
  const d = new Date(n.date);
  return `
    <span class="news-top">
      ${isNewNews(n) ? `<span class="badge">${esc(t('news.new'))}</span>` : ''}
      <span class="news-tag ${n.source === 'Steam' ? 'steam' : ''}">${esc(n.source)} · ${esc(newsKind(n.kind))}</span>
      <time datetime="${esc(n.date)}">${esc(whenLabel(d))}</time>
    </span>`;
}

// Nota destacada: la más reciente del filtro elegido
export function newsHero(n) {
  const url = safeUrl(n.url);
  if (!url) return '';
  return `
    <a class="news-hero" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
      ${newsVisual(n, 'news-visual hero')}
      <span class="news-body">
        ${newsMeta(n)}
        <span class="news-title">${esc(n.title)}</span>
        ${n.summary ? `<span class="news-summary">${esc(n.summary)}</span>` : ''}
        <span class="news-link">${esc(t('news.readFull'))} →</span>
      </span>
    </a>`;
}

export function newsCard(n) {
  const url = safeUrl(n.url);
  if (!url) return '';
  return `
    <a class="news-card" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
      ${newsVisual(n)}
      <span class="news-body">
        ${newsMeta(n)}
        <span class="news-title">${esc(n.title)}</span>
        ${n.summary ? `<span class="news-summary">${esc(n.summary)}</span>` : ''}
        <span class="news-link">${esc(t('news.readFull'))} →</span>
      </span>
    </a>`;
}

export function skeletonList(n = 5) {
  return `<div class="list" aria-hidden="true">${'<div class="skeleton-card"><span class="sk w30"></span><span class="sk w60"></span><span class="sk w40"></span></div>'.repeat(n)}</div>`;
}

export function skeletonStats() {
  return `<div class="stat-row" aria-hidden="true">${'<div class="stat-item"><span class="sk w40"></span><span class="sk big w30"></span></div>'.repeat(4)}</div>`;
}

export function emptyState(title, text) {
  return `<div class="state"><div class="state-title">${esc(title)}</div><p>${esc(text)}</p></div>`;
}

// Estado de error con botón de reintento (title y action cambian por sección)
export function errorState(message, title = t('errors.matches'), action = 'retry') {
  return `
    <div class="state error" role="alert">
      <div class="state-title">${esc(title)}</div>
      <p>${esc(message)}</p>
      <button type="button" class="btn" data-action="${action}">${esc(t('common.retry'))}</button>
    </div>`;
}
