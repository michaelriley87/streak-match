import { matchupScore } from './model.js';

const unknown = () => ({ streakType: null, streakLength: null });

export function parseRecord(value) {
  if (!/^\d+-\d+(?:-\d+)?$/.test(value ?? '')) return null;
  const [wins, losses, extra = 0] = value.split('-').map(Number);
  return { wins, losses, extra, played: wins + losses + extra };
}

export function extractStreak(stats) {
  const stat = stats?.find(s => s.name === 'streak' || s.type === 'streak');
  // Explicit W/L text avoids interpreting ties, blanks, or zero as a loss.
  const match = /^([WL])\s*([1-9]\d*)$/i.exec(stat?.displayValue?.trim() ?? '');
  if (!match || !Number.isSafeInteger(Number(match[2]))) return unknown();
  return { streakType: match[1].toUpperCase(), streakLength: Number(match[2]) };
}

export function parseStandings(payload) {
  const teams = new Map();
  function visit(node) {
    for (const entry of node.standings?.entries ?? []) {
      if (entry.team?.id == null) continue;
      teams.set(String(entry.team.id), {
        ...extractStreak(entry.stats),
        season: node.standings.season,
        seasonType: node.standings.seasonType,
        record: (() => {
          const get = name => entry.stats?.find(s => s.name === name)?.value;
          const wins = get('wins'), losses = get('losses');
          const extra = get('overtimeLosses') ?? get('ties') ?? 0;
          if (![wins, losses, extra].every(n => Number.isInteger(n) && n >= 0)) return null;
          const played = get('gamesPlayed') ?? wins + losses + extra;
          return played === wins + losses + extra ? { wins, losses, extra, played } : null;
        })(),
      });
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(payload);
  return teams;
}

export function parseGames(payload, standings, league) {
  const games = [];
  for (const event of payload.events ?? []) {
    for (const competition of event.competitions ?? []) {
      const startTime = competition.date ?? event.date;
      if (!startTime || Number.isNaN(Date.parse(startTime))) continue;
      const competitors = competition.competitors ?? [];
      const home = competitors.find(c => c.homeAway === 'home');
      const away = competitors.find(c => c.homeAway === 'away');
      if (!home?.team?.id || !away?.team?.id) continue;
      function team(competitor) {
        const source = competitor.team;
        const streak = standings.get(String(source.id));
        const matchesSeason = streak
          && Number(streak.season) === Number(event.season?.year)
          && Number(streak.seasonType) === Number(event.season?.type);
        return {
          id: String(source.id), name: source.displayName ?? source.name ?? source.abbreviation,
          abbreviation: source.abbreviation ?? source.displayName,
          logo: source.logo ?? source.logos?.[0]?.href ?? null,
          record: matchesSeason ? streak.record : null,
          eventRecord: parseRecord(competitor.records?.find(r => ['total', 'ytd'].includes(r.type) || r.name === 'overall')?.summary),
          winner: competitor.winner,
          ...(matchesSeason ? { streakType: streak.streakType, streakLength: streak.streakLength } : unknown()),
        };
      }
      const homeTeam = team(home);
      const awayTeam = team(away);
      const status = competition.status?.type ?? event.status?.type;
      games.push({
        id: String(competition.id ?? event.id), league, startTime, homeTeam, awayTeam,
        season: event.season?.year, seasonType: event.season?.type,
        completed: status?.completed === true || status?.name === 'STATUS_FINAL',
        state: status?.state,
        excluded: ['STATUS_CANCELED', 'STATUS_POSTPONED'].includes(status?.name),
        matchupScore: matchupScore(homeTeam, awayTeam),
        status: status?.state === 'in' ? 'Live' : status?.state === 'post' ? 'Final'
          : ['STATUS_POSTPONED', 'STATUS_CANCELED', 'STATUS_DELAYED'].includes(status?.name)
            ? status.description : 'Scheduled',
        preseason: event.season?.slug === 'preseason' || event.season?.slug === 'pre-season',
      });
    }
  }
  return games;
}
