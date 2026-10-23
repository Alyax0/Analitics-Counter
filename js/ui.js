// Helpers de formato y componentes HTML reutilizables.

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

// ---------- Fechas (zona horaria del visitante) ----------

const timeFmt = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDateFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const tzName =
  new Intl.DateTimeFormat('es', { timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value || '';

export const formatTime = (d) => (d ? timeFmt.format(d) : 'Por confirmar');
export const formatShortDate = (d) => (d ? shortDateFmt.format(d) : '');
export const timezoneLabel = () => tzName;

export function dayKey(d) {
  return d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : 'tbd';
}

export function dayLabel(d) {
  if (!d) return 'Fecha por confirmar';
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (dayKey(d) === dayKey(today)) return 'Hoy';
  if (dayKey(d) === dayKey(tomorrow)) return 'Mañana';
  const s = dayFmt.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function whenLabel(d) {
  if (!d) return 'Por confirmar';
  const day = dayLabel(d);
  return `${day === 'Hoy' ? 'Hoy' : day === 'Mañana' ? 'Mañana' : formatShortDate(d)} · ${formatTime(d)}`;
}

export function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return 'hace unos segundos';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  return `hace ${h} h`;
}

// ---------- Componentes ----------

export function teamLogo(team, size = 'md') {
  const initials = esc((team.acronym || team.name || '?').slice(0, 3));
  const src = team.logo && safeUrl(team.logo);
  return `<span class="logo-badge ${size}" aria-hidden="true"><span>${initials}</span>${
    src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''
  }</span>`;
}

export function formDots(history, n = 5) {
  if (!history.length) return '<span class="muted small">Sin datos</span>';
  const label = { w: 'Victoria', l: 'Derrota', d: 'Empate' };
  return `<span class="form-dots">${history
    .slice(0, n)
    .map((r) => `<span class="fd ${r.result}" title="${label[r.result]} vs ${esc(r.opponent)} ${esc(r.score)}"></span>`)
    .join('')}</span>`;
}

export function probBar(pred, match) {
  return `
    <div class="prob" role="img" aria-label="Probabilidad estimada: ${esc(match.teamA.name)} ${pred.probA}%, ${esc(match.teamB.name)} ${pred.probB}%">
      <div class="prob-bar"><span class="pa" style="flex:${pred.probA}"></span><span class="pb" style="flex:${pred.probB}"></span></div>
      <div class="prob-labels"><span>${pred.probA}%</span><span>${pred.probB}%</span></div>
    </div>`;
}

function statusLine(m) {
  switch (m.status) {
    case 'live':
      return `<span class="m-status live"><span class="live-dot"></span>En vivo · Mapa ${Math.min(m.currentMap, m.bestOf)}/${m.bestOf}</span>`;
    case 'finished':
      return `<span class="m-status done">Finalizado · ${esc(formatShortDate(m.date))}</span>`;
    case 'canceled':
      return '<span class="m-status done">Cancelado</span>';
    case 'postponed':
      return '<span class="m-status done">Pospuesto</span>';
    default:
      return `<span class="m-status">${esc(whenLabel(m.date))}</span>`;
  }
}

function sideColumn(m, pred) {
  if (m.status === 'finished') {
    if (m.forfeit) return '<span class="muted small">Ganado por W.O.</span>';
    if (m.draw) return '<span class="result-tag">Empate</span>';
    const w = m.winner === 'A' ? m.teamA : m.winner === 'B' ? m.teamB : null;
    return w ? `<span class="result-tag">Ganó ${esc(w.name)}</span>` : '';
  }
  if (m.status === 'canceled' || m.status === 'postponed') return '';
  if (!pred) return '<span class="muted small">Rivales por definir</span>';
  if (pred.insufficient) return '<span class="muted small">Sin datos suficientes para predecir</span>';
  const fav = pred.favorite === 'A' ? m.teamA : pred.favorite === 'B' ? m.teamB : null;
  return `
    <div class="m-pred-label"><span>${fav ? `Favorito: <strong>${esc(fav.acronym)}</strong>` : 'Parejo'}</span><span class="conf conf-${pred.confidence}">Confianza ${pred.confidence}</span></div>
    ${probBar(pred, m)}`;
}

export function matchCard(m, pred) {
  const showScore = m.status === 'live' || m.status === 'finished';
  const dimA = m.status === 'finished' && m.winner === 'B';
  const dimB = m.status === 'finished' && m.winner === 'A';
  return `
    <button type="button" class="match ${m.status}" data-match="${m.id}" aria-label="${esc(m.teamA.name)} contra ${esc(m.teamB.name)}, ${esc(m.league)}. Ver detalle">
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

export function skeletonList(n = 5) {
  return `<div class="list" aria-hidden="true">${'<div class="skeleton-card"><span class="sk w30"></span><span class="sk w60"></span><span class="sk w40"></span></div>'.repeat(n)}</div>`;
}

export function skeletonStats() {
  return `<div class="stat-row" aria-hidden="true">${'<div class="stat-item"><span class="sk w40"></span><span class="sk big w30"></span></div>'.repeat(4)}</div>`;
}

export function emptyState(title, text) {
  return `<div class="state"><div class="state-title">${esc(title)}</div><p>${esc(text)}</p></div>`;
}

export function errorState(message) {
  return `
    <div class="state error" role="alert">
      <div class="state-title">No pudimos cargar los partidos</div>
      <p>${esc(message)}</p>
      <button type="button" class="btn" data-action="retry">Reintentar</button>
    </div>`;
}
