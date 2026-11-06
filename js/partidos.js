// Sección Partidos: encabezado grande, tarjeta del próximo partido con pestañas
// de región, partidos por día y resultados desplegables por día.

import { predict } from './model.js';
import { esc, safeUrl, dayKey, dayLabel, formatTime, whenLabel, timezoneLabel, teamLogo, probBar, emptyState, errorState, skeletonList, confLevel } from './ui.js';
import { pickFeatured } from './home.js';
import { t } from './i18n.js';

// Regiones de PandaScore agrupadas como las ve un fan (Europa del Este y Occidental juntas)
const REGION_GROUPS = { WEU: 'eu', EEU: 'eu', NA: 'na', SA: 'sa', ASIA: 'asia', OCE: 'oce', ME: 'me', AF: 'af' };
const REGION_ORDER = ['eu', 'na', 'sa', 'asia', 'oce', 'me', 'af'];
const RESULTS_SHORT = 15; // resultados sin "Mostrar todos"
const RESULTS_ALL = 150;
const OPEN_DAYS = 2; // días de resultados abiertos de entrada

export const regionOf = (m) => REGION_GROUPS[m.region] || null;
const inRegion = (region) => (m) => region === 'all' || regionOf(m) === region;

// "en 45 min", "en 3 h", "en 2 días"
function startsIn(d, now) {
  if (!d) return '';
  const min = Math.round((d - now) / 60000);
  if (min <= 0) return t('partidos.startsSoon');
  if (min < 60) return t('partidos.startsIn.min', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('partidos.startsIn.hours', { n: h });
  return t('partidos.startsIn.days', { n: Math.round(h / 24) });
}

function platform(url) {
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (host.includes('twitch')) return 'Twitch';
  if (host.includes('youtube') || host.includes('youtu.be')) return 'YouTube';
  if (host.includes('kick')) return 'Kick';
  return null;
}

function bigTeam(team, side) {
  return `
    <div class="pm-team ${side}">
      ${teamLogo(team, 'xl')}
      <span class="pm-team-name">${esc(team.name)}</span>
    </div>`;
}

function featuredCard(f, ctx, now) {
  if (!f) return `<div class="pm-empty">${esc(t('partidos.noFeatured'))}</div>`;
  const live = f.status === 'live';
  const p = predict(f, ctx.state.stats);
  const ok = p && !p.insufficient;
  const stream = f.stream && safeUrl(f.stream);
  const where = stream && platform(stream);
  const meta = [f.league, f.stage, f.format].filter(Boolean).join(' · ');
  return `
    <div class="pm-feature">
      <div class="pm-feature-top">
        <span class="badge ${live ? 'live' : 'light'}">${esc(t(live ? 'partidos.liveNow' : 'partidos.next'))}</span>
        <span class="pm-meta">${esc(meta)}</span>
      </div>
      <button type="button" class="pm-versus" data-match="${f.id}" aria-label="${esc(t('match.aria', { a: f.teamA.name, b: f.teamB.name, league: f.league }))}">
        ${bigTeam(f.teamA, 'a')}
        <span class="pm-vs">${live ? `${f.scoreA}<small>–</small>${f.scoreB}` : 'vs'}</span>
        ${bigTeam(f.teamB, 'b')}
      </button>
      ${ok ? `
        <div class="pm-pred">
          ${probBar(p, f)}
          <span class="pm-pred-note">${esc(t('partidos.predNote', { level: confLevel(p.confidence) }))}</span>
        </div>` : ''}
      <div class="pm-feature-foot">
        <div class="pm-when">
          ${live
            ? `<strong class="live-text"><span class="live-dot"></span>${esc(t('match.liveMap', { cur: Math.min(f.currentMap, f.bestOf), total: f.bestOf }))}</strong>`
            : `<strong>${esc(dayLabel(f.date))} · ${esc(formatTime(f.date))}</strong><span class="pm-countdown">${esc(startsIn(f.date, now))}</span>`}
        </div>
        ${stream ? `<a class="pm-watch" href="${esc(stream)}" target="_blank" rel="noopener noreferrer">${esc(where ? t('partidos.watchOn', { where }) : t('partidos.watch'))} →</a>` : ''}
      </div>
    </div>`;
}

function regionTabs(regions, active, counts) {
  const tab = (id) =>
    `<button type="button" class="pm-tab ${active === id ? 'active' : ''}" data-region="${id}" aria-pressed="${active === id}">${esc(t(`partidos.regions.${id}`))}${counts[id] ? ` <span>${counts[id]}</span>` : ''}</button>`;
  return `<div class="pm-tabs" role="group" aria-label="${esc(t('partidos.regionAria'))}">${['all', ...regions].map(tab).join('')}</div>`;
}

function dayGroups(matches, withPred) {
  const days = new Map();
  for (const m of matches) {
    const k = m.status === 'live' ? 'live' : dayKey(m.date);
    if (!days.has(k)) days.set(k, { label: m.status === 'live' ? t('calendario.liveNow') : dayLabel(m.date), items: [] });
    days.get(k).items.push(m);
  }
  return [...days.values()].map((d) => `
    <section class="pm-day">
      <h3 class="section-label">${esc(d.label)} <span>${d.items.length}</span></h3>
      <div class="list">${d.items.map(withPred).join('')}</div>
    </section>`).join('');
}

function results(matches, ctx) {
  const days = new Map();
  for (const m of matches) {
    const k = dayKey(m.date);
    if (!days.has(k)) days.set(k, { key: k, label: dayLabel(m.date), items: [] });
    days.get(k).items.push(m);
  }
  return [...days.values()].map((d, i) => {
    const saved = ctx.state.openDays.get(d.key);
    const open = saved ?? i < OPEN_DAYS;
    return `
      <details class="pm-results-day" data-day="${esc(d.key)}"${open ? ' open' : ''}>
        <summary><span class="pm-day-name">${esc(d.label)}</span><span class="pm-day-count">${esc(t('partidos.resultsCount', { n: d.items.length }))}</span></summary>
        <div class="list">${d.items.map(ctx.withPred).join('')}</div>
      </details>`;
  }).join('');
}

// ctx: { state, game, withPred, notices (html), viewSwitch (html) }
export function viewPartidos(ctx) {
  const { state, game } = ctx;
  const titleBlock = (eyebrow, facts, art) => `
    <section class="pm-head">
      ${art ? `<div class="pm-art" aria-hidden="true">${art}</div>` : ''}
      <div class="pm-head-text">
        <div class="kicker"><span class="kicker-dot"></span>${esc(eyebrow)}</div>
        <h1 class="pm-title">${esc(t('partidos.title'))}</h1>
        ${facts}
      </div>
    </section>
    ${ctx.viewSwitch}
    ${ctx.notices}`;

  if (state.status === 'loading') return titleBlock(game.name, '<div class="hero-facts"><span class="sk w40"></span></div>', '') + skeletonList(6);
  if (state.status === 'error') return titleBlock(game.name, '', '') + errorState(state.error);

  const now = state.demo ? state.demo.getTime() : Date.now();
  const present = REGION_ORDER.filter((r) => [...state.live, ...state.upcoming, ...state.past.slice(0, RESULTS_ALL)].some((m) => regionOf(m) === r));
  const region = present.includes(state.region) ? state.region : 'all';
  const pick = inRegion(region);

  const live = state.live.filter(pick);
  const upcoming = state.upcoming.filter(pick).slice(0, 20);
  const featured = pickFeatured({ live, upcoming }, now);
  const next24 = state.upcoming.filter((m) => m.date && m.date - now < 24 * 3600 * 1000);
  const leagues = new Set([...state.live, ...next24].map((m) => m.league));
  const predictable = state.upcoming.slice(0, 20).filter((m) => {
    const p = predict(m, state.stats);
    return p && !p.insufficient;
  }).length;

  // Datos sueltos bajo el título (antes eran cuatro tarjetas)
  const facts = `
    <div class="hero-facts">
      ${[
        t('partidos.facts.live', { n: state.live.length }),
        t('partidos.facts.next24', { n: next24.length }),
        t('partidos.facts.leagues', { n: leagues.size }),
        t('partidos.facts.withPred', { n: predictable, total: Math.min(state.upcoming.length, 20) }),
      ].map((f) => `<span>${f}</span>`).join('<span class="sep">/</span>')}
    </div>`;

  // Logo grande de fondo: el favorito del destacado, o el primer equipo
  const p = featured && predict(featured, state.stats);
  const star = featured && (p && !p.insufficient && p.favorite === 'B' ? featured.teamB : featured.teamA);
  const starLogo = star && star.logo && safeUrl(star.logo);
  const art = starLogo ? `<img src="${esc(starLogo)}" alt="" decoding="async" onerror="this.remove()">` : '';
  const eyebrow = [game.name, featured && featured.league, featured && featured.stage].filter(Boolean).join(' · ');

  const filter = ['all', 'live', 'upcoming'].includes(state.filter) ? state.filter : 'all';
  const lists = { all: [...live, ...upcoming], live, upcoming };
  const shown = lists[filter];
  const chip = (id) =>
    `<button type="button" class="chip ${filter === id ? 'active' : ''}" data-filter="${id}" aria-pressed="${filter === id}">${esc(t(`partidos.chips.${id}`))} <span>${lists[id].length}</span></button>`;

  const past = state.past.filter(pick).slice(0, state.allResults ? RESULTS_ALL : RESULTS_SHORT);
  const counts = Object.fromEntries(['all', ...present].map((r) => [r, [...state.live, ...state.upcoming].filter(inRegion(r)).length]));

  return `
    ${titleBlock(eyebrow, facts, art)}
    <div class="pm-card">
      ${present.length > 1 ? regionTabs(present, region, counts) : ''}
      ${featuredCard(featured, ctx, now)}
    </div>

    <div class="pm-section-head">
      <h2 class="pm-h2">${esc(t('partidos.listTitle'))}${region !== 'all' ? ` <span>${esc(t(`partidos.regions.${region}`))}</span>` : ''}</h2>
    </div>
    <p class="pm-tz">${esc(t('partidos.tz', { tz: Intl.DateTimeFormat().resolvedOptions().timeZone || timezoneLabel() }))}</p>
    <div class="chips" role="group" aria-label="${esc(t('partidos.filterAria'))}">${chip('all')}${chip('live')}${chip('upcoming')}</div>
    ${shown.length ? dayGroups(shown, ctx.withPred) : emptyState(t(`partidos.empty.${filter}.title`), t(`partidos.empty.${filter}.text`))}

    <div class="pm-section-head">
      <h2 class="pm-h2">${esc(t('partidos.resultsTitle'))}</h2>
      <label class="pm-check"><input type="checkbox" data-action="all-results"${state.allResults ? ' checked' : ''}> ${esc(t('partidos.showAll'))}</label>
    </div>
    ${past.length ? results(past, ctx) : emptyState(t('partidos.empty.finished.title'), t('partidos.empty.finished.text'))}
    <p class="footnote">${esc(t('partidos.footnote', { n: state.past.length }))}</p>`;
}
