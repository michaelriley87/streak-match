export const LEAGUES = [
  { id: 'mlb', name: 'MLB', sport: 'baseball' },
  { id: 'nba', name: 'NBA', sport: 'basketball' },
  { id: 'nhl', name: 'NHL', sport: 'hockey' },
];
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export function matchupScore(home, away) {
  const valid = t => ['W', 'L'].includes(t.streakType) && Number.isSafeInteger(t.streakLength) && t.streakLength > 0;
  return valid(home) && valid(away) ? home.streakLength * away.streakLength : null;
}
export function sortGames(games) {
  return [...games].sort((a,b) => (b.matchupScore ?? -1) - (a.matchupScore ?? -1)
    || a.startTime.localeCompare(b.startTime) || a.league.localeCompare(b.league) || a.id.localeCompare(b.id));
}
// ESPN slate boundaries differ from UTC. Pad both ends, plus a week of prior context.
export function scheduleDates(now) {
  return Array.from({length:10}, (_,i) => new Date(+now + (i-7)*DAY).toISOString().slice(0,10).replaceAll('-', ''));
}
