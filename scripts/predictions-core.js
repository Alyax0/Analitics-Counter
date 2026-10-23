// Lógica del registro de predicciones, sin dependencias de Node ni del DOM
// para poder probarla en cualquier entorno. La usa scripts/predictions.mjs.
//
// Reglas:
// - Una predicción se congela una sola vez, entre FREEZE_WINDOW_H horas antes
//   del horario programado y el inicio. Nunca se actualiza.
// - Al resolverse, si se guardó después del inicio real del partido, se anula.
// - No cuentan: cancelados, ganados por W.O., empates y partidos sin ganador.

import { predict } from '../js/model.js';

export const MODEL = 'winrate-v1';
export const FREEZE_WINDOW_H = 6;
export const STALE_DAYS = 14; // pendientes sin resultado después de esto se anulan

const team = (t) => ({ id: t.id, name: t.name });

// Predicciones nuevas para partidos que empiezan pronto y no estaban registrados
export function freeze(gameId, existing, upcoming, stats, now = new Date()) {
  const known = new Set(existing.map((r) => r.id));
  const created = [];
  for (const m of upcoming) {
    if (known.has(m.id) || m.status !== 'upcoming' || !m.date || m.startedAt) continue;
    const ms = m.date - now;
    if (ms <= 0 || ms > FREEZE_WINDOW_H * 3600 * 1000) continue;
    const p = predict(m, stats);
    if (!p || p.insufficient) continue;
    created.push({
      id: m.id,
      game: gameId,
      model: MODEL,
      league: m.league,
      tier: m.tier,
      format: m.format,
      teamA: team(m.teamA),
      teamB: team(m.teamB),
      scheduledAt: m.date.toISOString(),
      predictedAt: now.toISOString(),
      probA: p.probA,
      favorite: p.favorite,
      confidence: p.confidence,
      sample: { a: p.a.n, b: p.b.n },
      status: 'pending',
    });
  }
  return created;
}

// Actualiza una predicción pendiente con el partido normalizado (o null)
export function resolve(record, m, now = new Date()) {
  if (record.status !== 'pending') return record;
  const done = (fields) => ({ ...record, resolvedAt: now.toISOString(), ...fields });

  if (!m) {
    const age = now - new Date(record.scheduledAt);
    return age > STALE_DAYS * 86400 * 1000 ? done({ status: 'void', reason: 'sin resultado' }) : record;
  }
  if (m.status === 'canceled') return done({ status: 'void', reason: 'cancelado' });
  if (m.status !== 'finished') return record;
  if (m.startedAt && new Date(record.predictedAt) >= m.startedAt) return done({ status: 'void', reason: 'guardada tarde' });
  if (m.forfeit) return done({ status: 'void', reason: 'W.O.' });
  if (m.draw) return done({ status: 'void', reason: 'empate' });

  const winner = m.winnerId === record.teamA.id ? 'A' : m.winnerId === record.teamB.id ? 'B' : null;
  if (!winner) return done({ status: 'void', reason: 'sin ganador' });

  // El orden de rivales puede no coincidir con el registro: se mapea por id
  const same = m.teamA.id === record.teamA.id;
  return done({
    status: 'resolved',
    result: {
      winner,
      scoreA: same ? m.scoreA : m.scoreB,
      scoreB: same ? m.scoreB : m.scoreA,
      startedAt: m.startedAt ? m.startedAt.toISOString() : null,
    },
    correct: record.favorite ? record.favorite === winner : null,
  });
}

function aggregate(list) {
  const resolved = list.filter((r) => r.status === 'resolved');
  const decided = resolved.filter((r) => r.correct !== null);
  const correct = decided.filter((r) => r.correct).length;
  const brier = resolved.length
    ? resolved.reduce((s, r) => s + (r.probA / 100 - (r.result.winner === 'A' ? 1 : 0)) ** 2, 0) / resolved.length
    : null;
  const byConfidence = {};
  for (const level of ['alta', 'media', 'baja']) {
    const g = decided.filter((r) => r.confidence === level);
    byConfidence[level] = { n: g.length, correct: g.filter((r) => r.correct).length };
  }
  return {
    total: list.length,
    resolved: resolved.length,
    decided: decided.length,
    correct,
    accuracy: decided.length ? correct / decided.length : null,
    brier,
    byConfidence,
    pending: list.filter((r) => r.status === 'pending').length,
    void: list.filter((r) => r.status === 'void').length,
  };
}

// Resumen liviano que lee la página. updatedAt es el último cambio real, así
// el archivo no cambia (ni se commitea) en las ejecuciones sin novedades.
export function summarize(records) {
  const updatedAt = records.reduce((max, r) => {
    const t = r.resolvedAt && r.resolvedAt > r.predictedAt ? r.resolvedAt : r.predictedAt;
    return t > max ? t : max;
  }, '');
  const byGame = {};
  for (const r of records) (byGame[r.game] ||= []).push(r);
  const games = {};
  for (const [id, list] of Object.entries(byGame)) {
    const sorted = [...list].sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
    games[id] = {
      ...aggregate(list),
      since: list.reduce((min, r) => (r.predictedAt < min ? r.predictedAt : min), list[0].predictedAt),
      recent: sorted.filter((r) => r.status !== 'pending').slice(0, 30),
      pendingList: sorted.filter((r) => r.status === 'pending').reverse().slice(0, 10),
    };
  }
  return { updatedAt: updatedAt || null, model: MODEL, overall: aggregate(records), games };
}

// Agrupa por mes del horario programado: predictions/<juego>/<AAAA-MM>.json
export function monthOf(record) {
  return record.scheduledAt.slice(0, 7);
}
