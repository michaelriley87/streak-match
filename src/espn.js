import { LEAGUES, HOUR, DAY, scheduleDates, sortGames } from './model.js';
import { parseGames, parseStandings } from './parsing.js';
import { eligibleGames, observeGames, gameKey, inWindow } from './eligibility.js';

export async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('ESPN returned HTTP ' + response.status);
  return response.json();
}

export function createFeed({ request = fetchJson, clock = () => new Date() } = {}) {
  const cache = new Map(), evidence = new Map(), remembered = new Map(), finalSignatures = new Map();
  const waiting = new Set();
  let pending;
  async function cached(url, ttl, force = false) {
    const old = cache.get(url);
    if (old?.pending) return old.pending;
    if (!force && old?.value && +clock() - old.at < ttl) return old.value;
    const entry = { ...old };
    entry.pending = request(url).then(value => {
      cache.set(url, { value, at: +clock() });
      return value;
    }).catch(error => { cache.delete(url); throw error; });
    cache.set(url, entry);
    return entry.pending;
  }
  async function load() {
    const now = clock();
    const dates = scheduleDates(now);
    const results = await Promise.all(LEAGUES.map(async league => {
      const path = league.sport + '/' + league.id;
      try {
        const boards = await Promise.all(dates.map(async date => {
          const url = 'https://site.api.espn.com/apis/site/v2/sports/' + path + '/scoreboard?dates=' + date;
          const old = cache.get(url)?.value;
          const oldGames = old ? parseGames(old, new Map(), league.id) : [];
          const active = oldGames.some(g => !g.completed && !g.excluded
            && (g.state === 'in' || Date.parse(g.startTime) <= +now + HOUR));
          // Scoreboards combine schedule and status: refresh only active dates quickly.
          const propagation = waiting.has(league.id) && oldGames.some(g => g.completed && Date.parse(g.startTime) >= +now - 2*DAY);
          const ttl = active || propagation ? 20_000 : 300_000;
          const board = await cached(url, ttl);
          if (!Array.isArray(board.events)) throw new Error('Missing scoreboard events');
          return board;
        }));
        const raw = { events: boards.flatMap(b => b.events) };
        const parsed = parseGames(raw, new Map(), league.id);
        const unique = new Map(parsed.map(g => [gameKey(g), g]));
        // Carry unresolved observed games across the context boundary until resolved.
        for (const [key, old] of remembered) {
          if (old.league !== league.id || unique.has(key)) continue;
          if (!old.completed && !old.excluded) {
            const date = old.startTime.slice(0,10).replaceAll('-', '');
            const board = await cached('https://site.api.espn.com/apis/site/v2/sports/' + path + '/scoreboard?dates=' + date, 20_000);
            const refreshed = parseGames(board, new Map(), league.id).find(g => gameKey(g) === key);
            unique.set(key, refreshed ?? old); // Never assume a disappeared blocker is final.
          } else if (Date.parse(old.startTime) > +now - 8*DAY) unique.set(key, old);
        }
        for (const [key,g] of unique) remembered.set(key,g);
        const context = [...unique.values()];
        const signature = context.filter(g => g.completed).map(g => g.id).sort().join(',');
        const changed = signature !== finalSignatures.get(league.id);
        const active = context.some(g => !g.completed && !g.excluded && (g.state === 'in' || Date.parse(g.startTime) <= +now + HOUR));
        let standings = new Map(), standingsError = false;
        if (context.some(g => inWindow(g, now))) {
          try {
            standings = parseStandings(await cached('https://site.api.espn.com/apis/v2/sports/' + path + '/standings',
              active || waiting.has(league.id) ? 20_000 : 300_000, changed));
            finalSignatures.set(league.id, signature);
          } catch { standingsError = true; }
        }
        const normalized = parseGames(raw, standings, league.id);
        const all = new Map(context.map(g => [gameKey(g),g]));
        for (const g of normalized) all.set(gameKey(g),g);
        const games = [...all.values()];
        const selected = eligibleGames(games, now, evidence);
        // A later doubleheader game's current record is not its pregame record
        // until its predecessors have finished and standings have caught up.
        observeGames(selected.games, evidence);
        if (selected.awaitingStandings) waiting.add(league.id); else waiting.delete(league.id);
        return { id: league.id, games: selected.games, state: standingsError ? 'missing'
          : selected.games.some(g => g.matchupScore === null) ? 'missing' : selected.games.length ? 'ok' : 'empty',
          fast: active || selected.awaitingStandings };
      } catch (error) {
        console.error(league.id + ':', error.message);
        return { id: league.id, games: [], state: 'error', fast: true };
      }
    }));
    for (const [key,value] of cache) if (!value.pending && +now - value.at > 2*DAY) cache.delete(key);
    for (const [key,g] of remembered) if ((g.completed || g.excluded) && Date.parse(g.startTime) < +now - 8*DAY) {
      remembered.delete(key); evidence.delete(key);
    }
    return { windowStart: now.toISOString(), windowEnd: new Date(+now + DAY).toISOString(), updatedAt: clock().toISOString(),
      refreshAfterMs: results.some(r => r.fast) ? 20_000 : 60_000,
      leagues: results.map(({id,state,games}) => ({id,state,count:games.length})),
      games: sortGames(results.flatMap(r => r.games)) };
  }
  return () => {
    if (!pending) pending = load().finally(() => { pending = null; });
    return pending;
  };
}
