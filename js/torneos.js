// Sección Torneos: PandaScore devuelve cada fase (grupos, playoffs...) como un
// "tournament"; acá se agrupan por serie para mostrar un evento por fila.

import { esc, formatDateRange, formatShortDate, whenLabel, teamLogo, flag, skeletonList, emptyState, errorState } from './ui.js';
import { t, getLang } from './i18n.js';

const TIER_RANK = { s: 5, a: 4, b: 3, c: 2, d: 1 };
const DAY = 24 * 3600 * 1000;
const PAST_DAYS = 30; // terminados que se siguen mostrando

// Monedas tal como las escribe PandaScore → código ISO para Intl.NumberFormat
const CURRENCIES = {
  'United States Dollar': 'USD', Euro: 'EUR', 'Chinese Yuan': 'CNY', 'Philippine Peso': 'PHP',
  'Vietnamese Dong': 'VND', 'Brazilian Real': 'BRL', 'Polish Zloty': 'PLN', 'Russian Ruble': 'RUB',
  'Japanese Yen': 'JPY', 'South Korean Won': 'KRW', 'Korean Won': 'KRW', 'British Pound': 'GBP',
  'Pound Sterling': 'GBP', 'Australian Dollar': 'AUD', 'Canadian Dollar': 'CAD', 'Indian Rupee': 'INR',
  'Turkish Lira': 'TRY', 'Swedish Krona': 'SEK', 'Danish Krone': 'DKK', 'Norwegian Krone': 'NOK',
  'Ukrainian Hryvnia': 'UAH', 'Kazakhstani Tenge': 'KZT', 'Mexican Peso': 'MXN', 'Argentine Peso': 'ARS',
  'Chilean Peso': 'CLP', 'Saudi Riyal': 'SAR', 'Thai Baht': 'THB', 'Indonesian Rupiah': 'IDR',
  'Malaysian Ringgit': 'MYR', 'Singapore Dollar': 'SGD', 'Czech Koruna': 'CZK', 'Swiss Franc': 'CHF',
};

function parsePrize(raw) {
  const m = String(raw || '').match(/^([\d.,\s]+)\s+(.+)$/);
  if (!m) return null;
  const amount = Number(m[1].replace(/[^\d]/g, ''));
  return amount ? { amount, currency: CURRENCIES[m[2].trim()] || null, raw: String(raw) } : null;
}

export function formatPrize(prize) {
  if (!prize) return '';
  if (!prize.currency) return prize.raw;
  try {
    return new Intl.NumberFormat(getLang(), { style: 'currency', currency: prize.currency, maximumFractionDigits: 0 }).format(prize.amount);
  } catch {
    return prize.raw;
  }
}

const toTeam = (x) => ({ id: x.id, name: x.name || t('common.tbd'), acronym: x.acronym || (x.name || '?').slice(0, 3).toUpperCase(), logo: x.image_url || null });

// stages: [{ data, list }] con list = 'running' | 'upcoming' | 'past'
export function buildEvents(stages) {
  const bySerie = new Map();
  for (const { data: x, list } of stages) {
    const key = x.serie_id || `t${x.id}`;
    if (!bySerie.has(key)) bySerie.set(key, []);
    const group = bySerie.get(key);
    if (!group.some((s) => s.data.id === x.id)) group.push({ data: x, list });
  }

  const events = [];
  for (const [key, group] of bySerie) {
    const first = group[0].data;
    const begins = group.map((s) => s.data.begin_at && Date.parse(s.data.begin_at)).filter(Boolean);
    const ends = group.map((s) => s.data.end_at && Date.parse(s.data.end_at)).filter(Boolean);
    const tier = group.map((s) => s.data.tier).filter(Boolean).sort((a, b) => (TIER_RANK[b] || 0) - (TIER_RANK[a] || 0))[0] || null;
    const prizes = group.map((s) => parsePrize(s.data.prizepool)).filter(Boolean);
    const prize = prizes.sort((a, b) => b.amount - a.amount)[0] || null;
    const lists = new Set(group.map((s) => s.list));
    // En curso: alguna fase se está jugando, o ya terminaron fases y faltan otras
    const status = lists.has('running') || (lists.has('past') && lists.has('upcoming')) ? 'live' : lists.has('past') ? 'finished' : 'upcoming';
    const teams = new Map();
    for (const s of group) for (const tm of s.data.teams || []) if (tm && tm.id) teams.set(tm.id, toTeam(tm));
    const offline = group.find((s) => s.data.type && s.data.type !== 'online' && s.data.country);
    const stagesSorted = group
      .map((s) => ({
        id: s.data.id,
        name: s.data.name,
        begin: s.data.begin_at ? new Date(s.data.begin_at) : null,
        end: s.data.end_at ? new Date(s.data.end_at) : null,
        winnerId: s.data.winner_id,
        matches: (s.data.matches || [])
          .map((m) => ({ ...m, date: m.begin_at || m.scheduled_at ? new Date(m.begin_at || m.scheduled_at) : null }))
          .sort((a, b) => (a.date || 0) - (b.date || 0)),
      }))
      .sort((a, b) => (a.begin || 0) - (b.begin || 0));
    // Campeón: ganador de la última fase, cuando el evento terminó
    const lastWinner = status === 'finished' ? stagesSorted[stagesSorted.length - 1].winnerId : null;
    const league = (first.league && first.league.name) || '';
    const serie = (first.serie && (first.serie.full_name || first.serie.name)) || '';

    events.push({
      id: String(key),
      name: [league, serie].filter(Boolean).join(' ') || first.name,
      league,
      logo: (first.league && first.league.image_url) || null,
      tier,
      begin: begins.length ? new Date(Math.min(...begins)) : null,
      end: ends.length ? new Date(Math.max(...ends)) : null,
      status,
      online: !offline,
      country: offline ? offline.data.country : null,
      region: first.region || null,
      prize,
      teams: [...teams.values()],
      winner: lastWinner ? teams.get(lastWinner) || null : null,
      stages: stagesSorted,
    });
  }
  return events;
}

const isTop = (ev) => ev.tier === 's' || ev.tier === 'a';

function regionName(code) {
  if (!code) return '';
  const key = `torneos.regions.${code}`;
  const label = t(key);
  return label === key ? code : label;
}

function countryName(code) {
  try {
    return new Intl.DisplayNames(getLang(), { type: 'region' }).of(code.toUpperCase()) || code;
  } catch {
    return code;
  }
}

function locationLabel(ev) {
  if (ev.country) return `${flag(ev.country)} ${countryName(ev.country)}`.trim();
  const region = regionName(ev.region);
  return region ? `${t('torneos.online')} · ${region}` : t('torneos.online');
}

function tierBadge(tier) {
  return tier ? `<span class="tier tier-${esc(tier)}">${esc(t('torneos.tier', { tier: tier.toUpperCase() }))}</span>` : '';
}

function leagueLogo(ev) {
  return teamLogo({ name: ev.league || ev.name, acronym: (ev.league || ev.name).replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase(), logo: ev.logo }, 'lg league');
}

function sideText(ev) {
  if (ev.status === 'finished') {
    return ev.winner ? t('torneos.champion', { team: ev.winner.name }) : t('torneos.ended', { date: formatShortDate(ev.end || ev.begin) });
  }
  if (ev.status === 'live') return ev.end ? t('torneos.endsOn', { date: formatShortDate(ev.end) }) : t('torneos.live');
  const days = ev.begin ? Math.ceil((ev.begin - Date.now()) / DAY) : null;
  return days == null ? t('common.dateToConfirm') : days <= 0 ? t('torneos.startsToday') : t('torneos.startsIn', { n: days });
}

function eventRow(ev) {
  const prize = formatPrize(ev.prize);
  const meta = [formatDateRange(ev.begin, ev.end), locationLabel(ev), ev.teams.length ? t('torneos.teams', { n: ev.teams.length }) : '']
    .filter(Boolean);
  return `
    <button type="button" class="event ${ev.status}" data-event="${esc(ev.id)}">
      ${leagueLogo(ev)}
      <span class="ev-main">
        <span class="ev-title">${tierBadge(ev.tier)}<span class="ev-name">${esc(ev.name)}</span></span>
        <span class="ev-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</span>
      </span>
      <span class="ev-side">
        ${prize ? `<strong class="ev-prize">${esc(prize)}</strong>` : `<span class="ev-prize none">${esc(t('torneos.noPrize'))}</span>`}
        <span class="ev-status">${ev.status === 'live' ? '<span class="live-dot"></span>' : ''}${esc(sideText(ev))}</span>
      </span>
    </button>`;
}

export function viewTorneos({ state, game, header }) {
  const tor = state.tourneys;
  const head = header('● ' + game.name, t('torneos.title'), t('torneos.accent'));
  if (tor.status === 'idle' || tor.status === 'loading') return head + skeletonList(6);
  if (tor.status === 'error') return head + errorState(tor.error, t('errors.tourneys'), 'refresh-tourneys');

  const now = Date.now();
  const all = tor.events.filter((ev) => ev.status !== 'finished' || (ev.end || ev.begin) > now - PAST_DAYS * DAY);
  const top = all.filter(isTop);
  // Si no hay torneos S/A en curso o por venir (pasa en Overwatch), se muestran todos
  const filter = tor.filter || (top.some((ev) => ev.status !== 'finished') ? 'top' : 'all');
  const shown = filter === 'top' ? top : all;

  const live = shown.filter((ev) => ev.status === 'live').sort((a, b) => (a.end || 0) - (b.end || 0));
  const upcoming = shown.filter((ev) => ev.status === 'upcoming').sort((a, b) => (a.begin || 0) - (b.begin || 0));
  const finished = shown.filter((ev) => ev.status === 'finished').sort((a, b) => (b.end || 0) - (a.end || 0)).slice(0, 12);

  const chip = (id, n) =>
    `<button type="button" class="chip ${filter === id ? 'active' : ''}" data-tourney-filter="${id}" aria-pressed="${filter === id}">${esc(t(`torneos.chips.${id}`))} <span>${n}</span></button>`;
  const block = (key, items) => items.length ? `
    <section class="ev-block">
      <h2 class="section-label">${key === 'live' ? '<span class="live-dot"></span>' : ''}${esc(t(`torneos.blocks.${key}`))} <span>${items.length}</span></h2>
      <div class="list">${items.map(eventRow).join('')}</div>
    </section>` : '';

  return `
    ${head}
    ${tor.stale ? `<div class="notice" role="status">${esc(t('torneos.stale', { error: tor.error || t('common.unknownError') }))}</div>` : ''}
    <div class="chips" role="group" aria-label="${esc(t('torneos.filterAria'))}">
      ${chip('top', top.length)}
      ${chip('all', all.length)}
    </div>
    ${live.length || upcoming.length || finished.length
      ? block('live', live) + block('upcoming', upcoming) + block('finished', finished)
      : emptyState(t('torneos.emptyTitle'), t(`torneos.empty.${filter}`))}
    <p class="footnote">${esc(t('torneos.footnote'))}</p>`;
}

// Modal de un evento: equipos y fases con sus partidos.
// findMatch/findTeam dicen si el partido o equipo está cargado y se puede abrir.
export function eventModal(ev, { findMatch, findTeam }) {
  const prize = formatPrize(ev.prize);
  const sub = [formatDateRange(ev.begin, ev.end), locationLabel(ev), prize].filter(Boolean).join(' · ');
  const matchRow = (m) => {
    const known = findMatch(m.id);
    const right = m.status === 'running' ? `<span class="live-text">${esc(t('modal.live'))}</span>`
      : m.status === 'finished' ? `<span class="muted">${esc(formatShortDate(m.date))}</span>`
        : m.status === 'canceled' ? `<span class="muted">${esc(t('match.canceled'))}</span>`
          : `<span class="muted">${esc(whenLabel(m.date))}</span>`;
    const inner = `<span>${esc(m.name)}</span>${right}`;
    return `<li>${known ? `<button type="button" class="row-link" data-match="${m.id}">${inner}</button>` : `<span class="row-static">${inner}</span>`}</li>`;
  };
  return `
    <div class="team-head">
      ${leagueLogo(ev)}
      <div>
        <div class="eyebrow">${tierBadge(ev.tier)} ${esc(t(`torneos.blocks.${ev.status}`))}</div>
        <h2 class="team-title">${esc(ev.name)}</h2>
        <div class="md-sub">${esc(sub)}</div>
      </div>
    </div>
    ${ev.winner ? `<p class="small">${esc(t('torneos.champion', { team: ev.winner.name }))}</p>` : ''}
    ${ev.teams.length ? `
      <h3 class="section-label">${esc(t('torneos.teamsTitle', { n: ev.teams.length }))}</h3>
      <div class="ev-teams">${ev.teams.map((tm) => {
        const inner = `${teamLogo(tm)}<span>${esc(tm.name)}</span>`;
        return findTeam(tm.id) ? `<button type="button" class="ev-team team-link" data-team="${tm.id}">${inner}</button>` : `<span class="ev-team">${inner}</span>`;
      }).join('')}</div>` : ''}
    ${ev.stages.map((s) => `
      <h3 class="section-label">${esc(s.name)} <span class="muted">${esc(formatDateRange(s.begin, s.end))}</span></h3>
      ${s.matches.length ? `<ul class="h2h">${s.matches.map(matchRow).join('')}</ul>` : `<p class="muted small">${esc(t('torneos.noMatches'))}</p>`}`).join('')}`;
}
