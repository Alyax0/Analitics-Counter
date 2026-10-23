// Normalización de partidos de PandaScore, forma de equipos y predicción.

const STATUS = {
  running: 'live',
  not_started: 'upcoming',
  finished: 'finished',
  canceled: 'canceled',
  postponed: 'postponed',
};

const FORM_WINDOW = 10; // partidos que se usan para la predicción
const MIN_SAMPLE = 3; // mínimo de partidos por equipo para predecir

function toTeam(opponent) {
  const t = opponent && opponent.opponent;
  if (!t) return { id: null, name: 'Por definir', acronym: 'TBD', logo: null, location: null };
  return {
    id: t.id,
    name: t.name,
    acronym: t.acronym || t.name.slice(0, 3).toUpperCase(),
    logo: t.image_url || null,
    location: t.location || null,
  };
}

function formatLabel(m) {
  const n = m.number_of_games || 1;
  if (m.match_type === 'best_of') return `BO${n}`;
  if (m.match_type === 'first_to') return `FT${n}`;
  return n === 1 ? '1 mapa' : `${n} mapas`;
}

function mainStream(m) {
  const list = m.streams_list || [];
  const s = list.find((x) => x.main && x.raw_url) || list.find((x) => x.official && x.raw_url);
  return s ? s.raw_url : null;
}

export function normalizeMatch(m) {
  const opp = m.opponents || [];
  const teamA = toTeam(opp[0]);
  const teamB = toTeam(opp[1]);
  const scoreOf = (team) => {
    const r = (m.results || []).find((x) => x.team_id === team.id);
    return r ? r.score : 0;
  };
  const winnerId = m.winner_id ?? (m.winner && m.winner.id) ?? null;
  const games = m.games || [];
  const date = m.begin_at || m.scheduled_at || null;

  return {
    id: m.id,
    status: STATUS[m.status] || 'upcoming',
    date: date ? new Date(date) : null,
    league: (m.league && m.league.name) || 'Torneo',
    serie: (m.serie && (m.serie.full_name || m.serie.name)) || '',
    stage: (m.tournament && m.tournament.name) || '',
    tier: (m.tournament && m.tournament.tier) || null,
    format: formatLabel(m),
    bestOf: m.number_of_games || 1,
    currentMap: games.filter((g) => g.status === 'finished').length + 1,
    teamA,
    teamB,
    scoreA: scoreOf(teamA),
    scoreB: scoreOf(teamB),
    winner: winnerId == null ? null : winnerId === teamA.id ? 'A' : winnerId === teamB.id ? 'B' : null,
    draw: !!m.draw,
    forfeit: !!m.forfeit,
    stream: mainStream(m),
  };
}

// Historial por equipo a partir de partidos terminados (más reciente primero).
export function buildTeamStats(finished) {
  const stats = new Map();
  const sorted = finished
    .filter((m) => m.status === 'finished' && !m.forfeit && m.teamA.id && m.teamB.id && (m.winner || m.draw))
    .sort((a, b) => (b.date || 0) - (a.date || 0));

  for (const m of sorted) {
    for (const side of ['A', 'B']) {
      const team = side === 'A' ? m.teamA : m.teamB;
      const opp = side === 'A' ? m.teamB : m.teamA;
      if (!stats.has(team.id)) stats.set(team.id, { team, history: [] });
      stats.get(team.id).history.push({
        matchId: m.id,
        date: m.date,
        opponent: opp.name,
        league: m.league,
        result: m.draw ? 'd' : m.winner === side ? 'w' : 'l',
        score: side === 'A' ? `${m.scoreA}-${m.scoreB}` : `${m.scoreB}-${m.scoreA}`,
      });
    }
  }
  return stats;
}

export function recentRecord(stats, teamId, n = FORM_WINDOW) {
  const history = (stats.get(teamId) || { history: [] }).history.slice(0, n);
  const wins = history.filter((r) => r.result === 'w').length;
  const draws = history.filter((r) => r.result === 'd').length;
  return { history, n: history.length, wins, losses: history.length - wins - draws, draws };
}

// Predicción simple y explicable: tasa de victorias reciente de cada equipo,
// suavizada con Laplace ((w+1)/(n+2)) y enfrentada como pA = sA / (sA + sB).
export function predict(match, stats) {
  if (!match.teamA.id || !match.teamB.id) return null;
  const a = recentRecord(stats, match.teamA.id);
  const b = recentRecord(stats, match.teamB.id);
  if (a.n < MIN_SAMPLE || b.n < MIN_SAMPLE) return { insufficient: true, a, b };

  const sA = (a.wins + a.draws / 2 + 1) / (a.n + 2);
  const sB = (b.wins + b.draws / 2 + 1) / (b.n + 2);
  const probA = Math.round((sA / (sA + sB)) * 100);
  const probB = 100 - probA;
  const margin = Math.abs(probA - 50);
  const minN = Math.min(a.n, b.n);
  const confidence = margin >= 15 && minN >= 8 ? 'alta' : margin >= 8 && minN >= 5 ? 'media' : 'baja';

  return {
    insufficient: false,
    probA,
    probB,
    favorite: probA === probB ? null : probA > probB ? 'A' : 'B',
    confidence,
    a,
    b,
  };
}

export function headToHead(finished, idA, idB) {
  return finished
    .filter(
      (m) =>
        m.status === 'finished' &&
        ((m.teamA.id === idA && m.teamB.id === idB) || (m.teamA.id === idB && m.teamB.id === idA)),
    )
    .sort((a, b) => (b.date || 0) - (a.date || 0));
}
