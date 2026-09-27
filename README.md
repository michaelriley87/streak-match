# Streak Match

Compact dark matchup list for **MLB, NBA and NHL**. Live games and next eligible games in a rolling 24-hour window, ranked only by home streak length × away streak length.

## Run

Node.js 22+; no dependencies or build step.

- `npm start`: http://localhost:3000 (localhost only; optional PORT).
- `npm run dev`: restart server on changes; reload browser for frontend edits.
- `npm run check`: syntax checks and deterministic tests.
- `npm run verify:live`: ESPN integration, UTC window, next-game checks, products, sorting and cache reuse.

## Window and schedule context

Use the actual UTC instant: start >= now and start < now + 24 hours, plus ESPN live games even with earlier starts. Finals never appear. Cancelled/postponed games are excluded. An overdue unresolved game blocks successors; cancelled/postponed games without a firm replacement schedule do not.

ESPN range requests returned HTTP 400 during inspection. Fetch separate bare scoreboard?dates=YYYYMMDD queries from UTC date minus seven days through UTC date plus two days, inclusive, per league. Leading context captures previous unresolved games and recent finals; trailing padding covers ESPN slate boundaries. No timezone parameter. Fetched context outside the visible window does not appear.

Cold start makes 30 scoreboard requests plus up to three standings requests; subsequent calls reuse endpoint caches. Merge identical league/competition IDs across slates; retain distinct IDs. Failure of any required date suppresses that league, avoiding decisions based on incomplete context.

The cold-start lookback is seven days, not the full season. Exceptionally old suspended games outside that range cannot be discovered. Once observed, unresolved games remain in memory and their dates keep being checked after leaving the context window. Disappeared events are never assumed final. No per-team schedules or persistence.

## Next game for both teams

Check all unresolved context games for either team. Earlier games (including overdue/live games) block the candidate. Equal-time distinct games involving a team are held back, not arbitrarily chosen by ID. Game 2 of a doubleheader waits for Game 1 to finish; earlier games against different opponents also block it.

Finals disappear on the next status refresh. Each successor must pass the standings freshness guard for both teams' latest preceding final in the same season and phase. Never borrow standings across seasons/phases. Missing ordinary streaks show an em dash and rank last; missing post-final evidence hides the successor.

## Standings propagation

Inspected ESPN responses include scoreboard overall total records (MLB/NBA), ytd records (NHL), and final winner flags. Standings include wins/losses, gamesPlayed where available, NHL overtimeLosses, and explicit W/L streaks. No reliable per-result standings watermark was exposed.

Treat final scoreboard overall records as ESPN's post-result records. Require standings counts to reach those records with matching season/phase. Cold start relies on the final record's post-result semantics, not an independent transactional guarantee. Missing records/winner information fail closed.

For an eligible game observed before final, retain its pregame record in memory. Require games played to advance by at least one and the appropriate win or loss/OT-loss increment. If its authoritative pregame streak was observed at that same record, validate the new streak against the result at the exact game count. This detects records updated before streaks. Expected streaks are validation only; never display a derived streak. Blocked future games receive no premature pregame baseline.

Standings clearly containing later results may satisfy the record lower bound. Otherwise stale, missing or inconsistent evidence hides the successor and triggers faster refreshes. Restarts discard baselines and revert to final-record checks. ESPN may still publish internally inconsistent information; freshness guarantees are limited by the source.

## Caches and refresh

All state is in memory; concurrent endpoint and feed requests coalesce.

- Quiet schedule dates: 5 minutes. ESPN scoreboards combine schedule/status, so no duplicate status endpoints.
- Dates with live, overdue unresolved, or starts within one hour: 20 seconds.
- Recent final dates while waiting for standings: 20 seconds.
- Standings: 5 minutes quiet, 20 seconds active/awaiting propagation. A newly observed final invalidates the relevant league's standings immediately.
- Browser: refresh every 20 seconds active/awaiting propagation, otherwise every 60 seconds; returning to the tab refreshes immediately. Every API call re-evaluates the current UTC window, even with cached sources.
- Failed refreshes do not preserve the stale visible list. Old endpoints/resolved evidence are pruned; observed unresolved blockers remain until resolved.

Removal latency is bounded by polling and ESPN's delay, not push updates. No work runs without an active viewer/API caller. No jobs, database or persistent historical storage.

## Presentation and verification

Browser-local times; starts on another local date include month/day. Viewer timezone never changes eligibility. The compact away-team / streak / @ / streak / home-team UI and direction-independent product ranking remain intact.

Tests cover window edges, live/final handling, both-team eligibility, doubleheaders, stale records/streaks, cold-start missing evidence, other opponents, UTC boundaries, viewer-local formatting, season guards, NHL OT records, failures and cache/coalescing. All W6/L6 combinations score 36. Live verification compares the feed with fetched schedule context.

Files: src/model.js (leagues/ranking/dates), src/parsing.js (ESPN normalization), src/eligibility.js (eligibility/freshness), src/espn.js (fetch/cache), server.js (HTTP), public/ (UI/local time), test/ and scripts/verify-live.js (verification).
