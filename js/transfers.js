// Sección Transfers: pases de jugadores que guarda el workflow de Liquipedia
// (scripts/transfers.mjs) en la rama "data".

import { esc, safeUrl, dayLabel, teamLogo, flag, skeletonList, emptyState, errorState } from './ui.js';
import { t, getLang } from './i18n.js';
import { ICONS } from './icons.js';

const PAGE = 60; // pases por tanda ("Ver más" suma otra)

// Roles tal como los escribe Liquipedia → clave de i18n (transfers.roles.*)
const ROLES = {
  Coach: 'coach', 'Head Coach': 'headCoach', 'Assistant Coach': 'assistantCoach', 'Interim Coach': 'interimCoach',
  Inactive: 'inactive', Loan: 'loan', Substitute: 'substitute', 'Stand-in': 'standIn', Manager: 'manager',
  'Team Manager': 'manager', 'General Manager': 'generalManager', Analyst: 'analyst', 'Data Analyst': 'analyst',
  Streamer: 'streamer', Tank: 'tank', DPS: 'dps', Support: 'support', Flex: 'flex',
};

// "Loan/Inactive" → "Préstamo / Inactivo"; lo desconocido queda como viene
export function roleLabel(role) {
  return String(role || '').split('/').map((r) => r.trim()).filter(Boolean)
    .map((r) => (ROLES[r] ? t(`transfers.roles.${ROLES[r]}`) : r)).join(' / ');
}

// "2026-11-04" es una fecha sin hora: se arma en la zona local para que no cambie de día
const localDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

function countryName(code) {
  try {
    return new Intl.DisplayNames(getLang(), { type: 'region' }).of(code.toUpperCase()) || code;
  } catch {
    return code;
  }
}

function player(p) {
  const url = p.url && safeUrl(p.url);
  const name = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(p.name)}</a>` : esc(p.name);
  const fl = p.country ? `<span class="flag" title="${esc(countryName(p.country))}">${flag(p.country)}</span>` : '';
  return `<span class="tr-player">${fl}${name}</span>`;
}

// teamByName: logo de PandaScore si el equipo está entre los partidos cargados
function sideHtml(s, teamByName) {
  if (s.status !== 'team') {
    return `<span class="tr-team none">${esc(t(s.status === 'retired' ? 'transfers.retired' : 'transfers.noTeam'))}${s.role ? ` <span class="tr-role">${esc(roleLabel(s.role))}</span>` : ''}</span>`;
  }
  const teams = s.teams.map((name) => {
    const known = teamByName(name);
    const logo = teamLogo(known || { name, acronym: name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() }, 'sm');
    const label = `${logo}<span class="tr-team-name">${esc(name)}</span>`;
    return known ? `<button type="button" class="tr-team-link" data-team="${known.id}">${label}</button>` : `<span class="tr-team-link static">${label}</span>`;
  }).join('<span class="tr-sep">/</span>');
  return `<span class="tr-team">${teams}${s.role ? ` <span class="tr-role">${esc(roleLabel(s.role))}</span>` : ''}</span>`;
}

function row(x, teamByName) {
  const ref = x.ref && safeUrl(x.ref);
  return `
    <div class="tr-row">
      <div class="tr-players">
        ${x.players.map(player).join('')}
        ${x.roles.length ? `<span class="tr-roles">${x.roles.map((r) => `<span class="tr-role">${esc(roleLabel(r))}</span>`).join('')}</span>` : ''}
      </div>
      <div class="tr-move">
        ${sideHtml(x.from, teamByName)}
        <span class="tr-arrow" aria-hidden="true">${ICONS.flecha}</span><span class="visually-hidden">${esc(t('transfers.to'))}</span>
        ${sideHtml(x.to, teamByName)}
      </div>
      ${ref ? `<a class="icon-btn tr-ref" href="${esc(ref)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(t('transfers.refAria'))}" title="${esc(t('transfers.refAria'))}">↗</a>` : '<span class="tr-ref"></span>'}
    </div>`;
}

const isArrival = (x) => x.to.status === 'team';

export function viewTransfers({ state, game, header, teamByName }) {
  const tr = state.transfers;
  const head = header('● ' + game.name, t('transfers.title'), t('transfers.accent'));
  if (tr.status === 'idle' || tr.status === 'loading') return head + skeletonList(8);
  if (tr.status === 'error') {
    // 404: el workflow todavía no corrió nunca y no hay archivo
    return head + (/404/.test(tr.error)
      ? emptyState(t('transfers.missingTitle'), t('transfers.missingText'))
      : errorState(tr.error, t('errors.transfers'), 'refresh-transfers'));
  }

  const all = tr.data.items || [];
  const groups = { all, arrivals: all.filter(isArrival), departures: all.filter((x) => !isArrival(x)) };
  const items = groups[tr.filter] || all;
  const shown = items.slice(0, tr.limit);
  const days = new Map();
  for (const x of shown) {
    if (!days.has(x.date)) days.set(x.date, []);
    days.get(x.date).push(x);
  }
  const chip = (id) =>
    `<button type="button" class="chip ${tr.filter === id ? 'active' : ''}" data-transfer-filter="${id}" aria-pressed="${tr.filter === id}">${esc(t(`transfers.chips.${id}`))} <span>${groups[id].length}</span></button>`;
  const source = safeUrl(tr.data.source);

  return `
    ${head}
    ${tr.stale ? `<div class="notice" role="status">${esc(t('transfers.stale', { error: tr.error || t('common.unknownError') }))}</div>` : ''}
    <div class="chips" role="group" aria-label="${esc(t('transfers.filterAria'))}">${chip('all')}${chip('arrivals')}${chip('departures')}</div>
    ${shown.length ? [...days].map(([date, list]) => `
      <section class="tr-day">
        <h2 class="section-label">${esc(dayLabel(localDate(date)))} <span>${list.length}</span></h2>
        <div class="list">${list.map((x) => row(x, teamByName)).join('')}</div>
      </section>`).join('') : emptyState(t('transfers.emptyTitle'), t('transfers.emptyText'))}
    ${items.length > shown.length ? `<button type="button" class="btn block" data-action="more-transfers">${esc(t('transfers.more', { n: Math.min(PAGE, items.length - shown.length) }))}</button>` : ''}
    <p class="footnote">${t('transfers.footnote', {
      source: source ? `<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">Liquipedia</a>` : 'Liquipedia',
      license: '<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 3.0</a>',
    })}</p>`;
}

export const TRANSFERS_PAGE = PAGE;
