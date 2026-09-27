import { formatGameTime } from './time.js';
const $ = selector => document.querySelector(selector);
let data;
let selected = 'all';
let loading = false;
let refreshTimer;
const timeFormat = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' });

function element(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function teamNode(team, side) {
  const wrap = element('div', `team ${side}`);
  if (team.logo) {
    const logo = element('img', 'logo');
    if (/^https:\/\//.test(team.logo)) logo.src = team.logo;
    logo.alt = '';
    logo.width = 32;
    logo.height = 32;
    logo.addEventListener('error', () => { logo.style.visibility = 'hidden'; });
    wrap.append(logo);
  }
  wrap.append(element('span', 'team-name', team.name));
  return wrap;
}

function streakNode(team) {
  const known = team.streakType && team.streakLength != null;
  const token = element('span', `streak ${known ? team.streakType === 'W' ? 'win' : 'loss' : 'unknown'}`, known ? `${team.streakType}${team.streakLength}` : '—');
  const result = team.streakType === 'W' ? (team.streakLength === 1 ? 'win' : 'wins') : (team.streakLength === 1 ? 'loss' : 'losses');
  token.setAttribute('aria-label', known ? `${team.streakLength} ${result} in a row` : 'Streak unavailable');
  token.title = token.getAttribute('aria-label');
  return token;
}

function render() {
  if (!data) return;
  const games = data.games.filter(g => selected === 'all' || g.league === selected);
  const leagues = data.leagues.filter(l => selected === 'all' || l.id === selected);
  $('#date').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_', ' ');
  $('#count').textContent = `${games.length} ${games.length === 1 ? 'game' : 'games'}`;
  const notices = [];
  const failed = leagues.filter(l => l.state === 'error').map(l => l.id.toUpperCase());
  if (failed.length) notices.push(`${failed.join(', ')} games could not be loaded. Try refreshing.`);
  const empty = leagues.filter(l => l.state === 'empty').map(l => l.id.toUpperCase());
  if (empty.length && selected === 'all') notices.push(`No ${empty.join(' or ')} games in the next 24 hours.`);
  if (games.some(g => g.matchupScore === null)) notices.push('Some current streaks are unavailable from ESPN (—).');
  $('#notice').textContent = notices.join(' ');
  $('#notice').hidden = !notices.length;
  const list = element('ol', 'matchups');
  for (const game of games) {
    const row = element('li', 'matchup');
    const meta = element('div', 'game-meta');
    meta.append(element('span', 'league', game.league.toUpperCase()));
    if (game.preseason) meta.append(element('span', 'preseason', 'Preseason'));
    const pairing = element('div', 'pairing');
    pairing.append(teamNode(game.awayTeam, 'away'), streakNode(game.awayTeam), element('span', 'versus', '@'), streakNode(game.homeTeam), teamNode(game.homeTeam, 'home'));
    const timing = element('div', 'timing');
    const time = element('time', 'start-time', formatGameTime(game.startTime));
    time.dateTime = game.startTime;
    timing.append(time);
    if (game.status !== 'Scheduled') timing.append(element('span', game.status === 'Live' ? 'status live' : 'status', game.status));
    row.append(meta, pairing, timing);
    list.append(row);
  }
  $('#games').replaceChildren(games.length ? list : element('div', 'empty', failed.length ? 'Games are temporarily unavailable.' : `No ${selected === 'all' ? '' : selected.toUpperCase() + ' '}matchups available in the next 24 hours.`));
  $('#updated').textContent = `Updated ${timeFormat.format(new Date(data.updatedAt))}`;
}

async function refresh() {
  if (loading) return;
  loading = true;
  $('#refresh').disabled = true;
  $('#games').setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/games', { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error('Request failed');
    data = await response.json();
    render();
  } catch {
    data = null;
    $('#notice').hidden = false;
    $('#notice').textContent = 'Could not refresh current games. Trying again shortly.';
    if (!data) {
      $('#count').textContent = 'Games unavailable';
      $('#games').replaceChildren(element('div', 'empty', 'Matchups could not be loaded.'));
    }
  } finally {
    loading = false;
    $('#refresh').disabled = false;
    $('#games').setAttribute('aria-busy', 'false');
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, data?.refreshAfterMs ?? 20_000);
  }
}

$('#filters').addEventListener('click', event => {
  const button = event.target.closest('button[data-league]');
  if (!button) return;
  selected = button.dataset.league;
  document.querySelectorAll('[data-league]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  render();
});
$('#refresh').addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
refresh();
