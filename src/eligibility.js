import { DAY } from './model.js';
export const teamsOf = g => [g.homeTeam, g.awayTeam];
export const gameKey = g => g.league + ':' + g.id;
const phase = g => g.season + ':' + g.seasonType;
export function inWindow(g, now) {
  return !g.completed && !g.excluded && (g.state === 'in'
    || (g.state === 'pre' && Date.parse(g.startTime) >= +now && Date.parse(g.startTime) < +now + DAY));
}

// Evidence survives cache refreshes, but never persists to disk.
export function observeGames(games, evidence) {
  for (const g of games) {
    const key = gameKey(g);
    if (!g.completed && !g.excluded) {
      const old = evidence.get(key);
      evidence.set(key, { seenAt: Date.parse(g.startTime), teams: Object.fromEntries(teamsOf(g).map(t => [t.id, old?.teams[t.id]?.streakType ? old.teams[t.id] : {
        record: t.eventRecord,
        streakType: sameRecord(t.record, t.eventRecord) ? t.streakType : null,
        streakLength: sameRecord(t.record, t.eventRecord) ? t.streakLength : null,
      }])) });
    }
  }
}

function sameRecord(a, b) {
  return a && b && a.wins === b.wins && a.losses === b.losses && a.extra === b.extra;
}

function caughtUp(team, final, evidence) {
  const priorTeam = teamsOf(final).find(t => t.id === team.id);
  const before = evidence.get(gameKey(final))?.teams[team.id];
  const record = team.record;
  const finalRecord = priorTeam.eventRecord;
  if (!record || !finalRecord || !team.streakType || typeof priorTeam.winner !== 'boolean') return false;
  // Final scoreboard overall records are post-result records. If we observed the
  // unresolved game, additionally require a game-count increment from that baseline.
  const requiredPlayed = Math.max(finalRecord.played, before?.record ? before.record.played + 1 : 0);
  if (record.played < requiredPlayed || record.wins < finalRecord.wins
    || record.losses < finalRecord.losses || record.extra < finalRecord.extra) return false;
  if (before?.record) {
    if (priorTeam.winner && record.wins < before.record.wins + 1) return false;
    if (!priorTeam.winner && record.losses + record.extra < before.record.losses + before.record.extra + 1) return false;
  }
  // At the exact completed-game record, the streak itself must also reflect it.
  if (record.played === requiredPlayed) {
    const direction = priorTeam.winner ? 'W' : 'L';
    if (team.streakType !== direction) return false;
    if (before?.record && before.streakType && before.streakLength != null) {
      const expected = before.streakType === direction ? before.streakLength + 1 : 1;
      if (team.streakLength !== expected) return false;
    }
  }
  return true;
}

export function eligibleGames(games, now, evidence = new Map()) {
  const unresolved = games.filter(g => !g.completed && !g.excluded);
  let awaitingStandings = false;
  const visible = games.filter(g => {
    if (!inWindow(g, now)) return false;
    for (const team of teamsOf(g)) {
      // Equal-time distinct games are ambiguous; neither is promoted by an ID tie-break.
      if (unresolved.some(other => gameKey(other) !== gameKey(g)
        && other.league === g.league && teamsOf(other).some(t => t.id === team.id)
        && (other.state === 'in' || Date.parse(other.startTime) <= Date.parse(g.startTime)))) return false;
      const latestFinal = games.filter(other => other.completed && other.league === g.league
        && phase(other) === phase(g) && teamsOf(other).some(t => t.id === team.id)
        && Date.parse(other.startTime) <= Date.parse(g.startTime))
        .sort((a,b) => Date.parse(b.startTime) - Date.parse(a.startTime))[0];
      if (latestFinal && !caughtUp(team, latestFinal, evidence)) {
        awaitingStandings = true;
        return false;
      }
    }
    return true;
  });
  return { games: visible, awaitingStandings };
}
