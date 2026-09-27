import assert from 'node:assert/strict';
import { createFeed, fetchJson } from '../src/espn.js';
import { LEAGUES, DAY, scheduleDates } from '../src/model.js';
import { inWindow } from '../src/eligibility.js';
import { parseGames } from '../src/parsing.js';
const now=new Date();const calls=[],context=[];
const feed=createFeed({clock:()=>now,request:async url=>{
 calls.push(url);const payload=await fetchJson(url);
 if(url.includes('/scoreboard')) context.push(...parseGames(payload,new Map(),new URL(url).pathname.split('/').at(-2)));
 return payload;
}});
const data=await feed();
assert.equal(Date.parse(data.windowEnd)-Date.parse(data.windowStart),DAY);
assert.deepEqual(data.leagues.map(l=>l.id),['mlb','nba','nhl']);
assert.ok(data.leagues.every(l=>l.state!=='error'),'All schedule context must load');
let previous=Infinity;
for(const g of data.games){
 assert.ok(inWindow(g,now));assert.ok(!g.completed);
 for(const team of [g.homeTeam,g.awayTeam]) assert.ok(!context.some(other=>other.league===g.league
   &&other.id!==g.id&&!other.completed&&!other.excluded
   &&[other.homeTeam.id,other.awayTeam.id].includes(team.id)
   &&(other.state==='in'||Date.parse(other.startTime)<=Date.parse(g.startTime))), 'Next unresolved game for both teams');
 assert.ok((g.matchupScore??-1)<=previous);previous=g.matchupScore??-1;
 if(g.matchupScore!==null)assert.equal(g.matchupScore,g.homeTeam.streakLength*g.awayTeam.streakLength);
 console.log(g.league,g.awayTeam.name,g.awayTeam.streakType,g.awayTeam.streakLength,'@',g.homeTeam.name,g.homeTeam.streakType,g.homeTeam.streakLength,g.status,g.startTime);
}
const count=calls.length;await feed();assert.equal(calls.length,count,'Cached immediate repeat');
assert.equal(calls.filter(u=>u.includes('/scoreboard')).length,LEAGUES.length*scheduleDates(now).length);
console.table(data.leagues);
console.log(data.windowStart,'to',data.windowEnd,count,'requests; next refresh',data.refreshAfterMs,'ms');
console.log('Rolling window, three-league routes, no finals, products, sorting and cache verified.');
