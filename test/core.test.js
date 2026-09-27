import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, HOUR, LEAGUES, matchupScore, scheduleDates, sortGames } from '../src/model.js';
import { parseGames, parseStandings, extractStreak, parseRecord } from '../src/parsing.js';
import { eligibleGames, observeGames, inWindow } from '../src/eligibility.js';
import { createFeed } from '../src/espn.js';
import { formatGameTime } from '../public/time.js';
const now = new Date('2026-09-25T23:30:00Z');
const rec = (wins, losses, extra=0) => ({wins,losses,extra,played:wins+losses+extra});
const team = (id, type='W', length=3, record=rec(10,5)) => ({id, name:id, streakType:type, streakLength:length, record, eventRecord:record});
function game(id='g', hours=1, a='A', b='B', overrides={}) {
  const homeTeam=team(b),awayTeam=team(a);
  return {id,league:'mlb',startTime:new Date(+now+hours*HOUR).toISOString(),homeTeam,awayTeam,
    matchupScore:9,state:'pre',completed:false,excluded:false,season:2026,seasonType:2,...overrides};
}
const visible = (games, evidence=new Map()) => eligibleGames(games,now,evidence).games.map(g=>g.id);

test('23h visible; 24h exclusive and >24h excluded',()=>{
 assert.equal(inWindow(game('now',0),now),true);
 assert.deepEqual(visible([game('23',23),game('24',24,'C','D'),game('25',25,'E','F')]),['23']);
});
test('final excluded, including completed flag regardless of state',()=>{
 assert.deepEqual(visible([game('final',-2,'A','B',{completed:true,state:'in'})]),[]);
});
test('live game remains visible even when its start is before the window',()=>{
 assert.deepEqual(visible([game('live',-30,'A','B',{state:'in'})]),['live']);
});
test('ordinary upcoming matchup is next for both teams',()=>assert.deepEqual(visible([game()]),['g']));
test('second doubleheader game stays hidden while first is unresolved',()=>{
 assert.deepEqual(visible([game('g1',1),game('g2',5)]),['g1']);
 assert.deepEqual(visible([game('g1',-1,'A','B',{state:'in'}),game('g2',5)]),['g1']);
});
function transition() {
 const first=game('g1',-2); const evidence=new Map(); observeGames([first],evidence);
 const final={...first,completed:true,state:'post',homeTeam:{...first.homeTeam,winner:true,eventRecord:rec(11,5)},
   awayTeam:{...first.awayTeam,winner:false,eventRecord:rec(10,6)}};
 const next=game('g2',1); next.homeTeam=team('B','W',4,rec(11,5)); next.awayTeam=team('A','L',1,rec(10,6));
 return {final,next,evidence};
}
test('successor promoted after record and streak incorporate final',()=>{
 const {final,next,evidence}=transition(); assert.deepEqual(visible([final,next],evidence),['g2']);
});
test('successor hidden with pre-result standings',()=>{
 const {final,evidence}=transition(); assert.deepEqual(visible([final,game('g2',1)],evidence),[]);
});
test('record advanced but streak still stale does not promote successor',()=>{
 const {final,next,evidence}=transition(); next.homeTeam.streakLength=3;
 assert.deepEqual(visible([final,next],evidence),[]);
});
test('unchanged scoreboard final record cannot bypass observed pregame baseline',()=>{
 const {final,evidence}=transition(); final.homeTeam.eventRecord=rec(10,5);final.awayTeam.eventRecord=rec(10,5);
 assert.deepEqual(visible([final,game('g2',1)],evidence),[]);
});
test('cold start uses final post-result records; missing evidence fails closed',()=>{
 const {final,next}=transition(); assert.deepEqual(visible([final,next]),['g2']);
 final.homeTeam.eventRecord=null; assert.deepEqual(visible([final,next]),[]);
});
test('either team earlier unresolved against other opponent blocks candidate',()=>{
 for(const [a,b] of [['A','C'],['C','B']]) assert.deepEqual(visible([game('early',1,a,b),game('later',3)]),['early']);
});
test('overdue unresolved games block successors, cancelled games do not',()=>{
 assert.deepEqual(visible([game('late',-1),game('next',2)]),[]);
 assert.deepEqual(visible([game('cancelled',-1,'A','B',{excluded:true}),game('next',2)]),['next']);
});
test('distinct IDs at equal times remain ambiguous rather than deduplicated',()=>{
 assert.deepEqual(visible([game('one',1),game('two',1)]),[]);
});
test('UTC midnight does not truncate rolling window; schedule dates pad it',()=>{
 assert.equal(inWindow(game('cross',2),now),true);
 assert.equal(inWindow(game('outside',25),now),false);
 const dates=scheduleDates(now);assert.equal(dates[0],'20260918');assert.equal(dates.at(-1),'20260927');
});
test('viewer timezone changes presentation, not eligibility',()=>{
 const g=game('local',2); const before=visible([g]);
 assert.notEqual(formatGameTime(g.startTime,now,'America/New_York'),formatGameTime(g.startTime,now,'Australia/Sydney'));
 assert.deepEqual(visible([g]),before);
 assert.match(formatGameTime(g.startTime,now,'UTC'),/26/);
});
test('direction-independent product and deterministic missing-last ranking',()=>{
 for(const a of ['W','L'])for(const b of ['W','L'])assert.equal(matchupScore(team('A',a,6),team('B',b,6)),36);
 for(const [a,b,n] of [[8,10,80],[7,7,49],[6,5,30],[10,1,10],[3,3,9]])assert.equal(matchupScore(team('A','L',a),team('B','W',b)),n);
 const games=[null,9,80,49].map((n,i)=>game(String(i),1,'A','B',{matchupScore:n}));
 assert.deepEqual(sortGames(games).map(g=>g.matchupScore),[80,49,9,null]);
});
test('streak and record parsing never invent values',()=>{
 assert.deepEqual(extractStreak([{name:'streak',displayValue:'L7'}]),{streakType:'L',streakLength:7});
 for(const s of ['-','T1','W0','W2.5'])assert.equal(extractStreak([{name:'streak',displayValue:s}]).streakLength,null);
 assert.deepEqual(parseRecord('2-1-3'),rec(2,1,3)); assert.equal(parseRecord('-'),null);
});
const stats = (wins=10,losses=5,streak='W3') => [
 {name:'wins',value:wins},{name:'losses',value:losses},{name:'gamesPlayed',value:wins+losses},{name:'streak',displayValue:streak}];
const table = () => ({children:[{standings:{season:2026,seasonType:2,entries:['A','B'].map(id=>({team:{id},stats:stats()}))}}]});
function event(id='g', hours=2, state='pre') {
 return {id,date:new Date(+now+hours*HOUR).toISOString(),season:{year:2026,type:2},status:{type:{state,completed:state==='post'}},competitions:[{
 id,competitors:[{homeAway:'home',team:{id:'B',displayName:'B'},records:[{type:'total',summary:'10-5'}]},
 {homeAway:'away',team:{id:'A',displayName:'A'},records:[{type:'total',summary:'10-5'}]}]}]};
}
test('nested standings IDs and season guard plus NHL overtime record',()=>{
 const t=table();const map=parseStandings(t);const [g]=parseGames({events:[event()]},map,'mlb');
 assert.equal(g.matchupScore,9);assert.equal(g.homeTeam.record.played,15);
 t.children[0].standings.seasonType=1;assert.equal(parseGames({events:[event()]},parseStandings(t),'mlb')[0].matchupScore,null);
 const root={standings:{season:2026,seasonType:2,entries:[{team:{id:'A'},stats:[...stats(2,1),{name:'overtimeLosses',value:1}].filter(s=>s.name!=='gamesPlayed')}]}};
 assert.equal(parseStandings(root).get('A').record.played,4);
});
test('only MLB/NBA/NHL fetched; cache coalesces and recomputes moving window',async()=>{
 let instant=new Date(now);const calls=[];
 const feed=createFeed({clock:()=>instant,request:async url=>{
 calls.push(url);if(url.includes('/standings'))return table();
 return {events:url.includes('/mlb/')&&url.endsWith('20260926')?[event('g',23.99)]:[]};
 }});
 const [first]=await Promise.all([feed(),feed(),feed()]);
 assert.deepEqual(LEAGUES.map(l=>l.id),['mlb','nba','nhl']);assert.equal(calls.length,31);
 assert.deepEqual(first.games.map(g=>g.id),['g']);await feed();assert.equal(calls.length,31);
 assert.ok(calls.every(u=>LEAGUES.some(l=>u.includes('/sports/'+l.sport+'/'+l.id+'/'))));
 instant=new Date(+now+6*60_000);await feed();assert.ok(calls.length>31);
});
test('final status invalidates standings and successor waits for propagation',async()=>{
 let instant=new Date(now),stage=0,standingCalls=0;
 const feed=createFeed({clock:()=>instant,request:async url=>{
 if(url.includes('/standings')){standingCalls++; const t=table();if(stage===2){t.children[0].standings.entries[0].stats=stats(10,6,'L1');t.children[0].standings.entries[1].stats=stats(11,5,'W4');}return t;}
 if(!url.includes('/mlb/')||!url.endsWith('20260925'))return {events:[]};
 const e=event('first',-1,stage?'post':'in');const [home,away]=e.competitions[0].competitors;
 if(stage){home.winner=true;away.winner=false;home.records[0].summary='11-5';away.records[0].summary='10-6';}
 return {events:[e,event('second',1)]};
 }});
 assert.deepEqual((await feed()).games.map(g=>g.id),['first']);
 stage=1;instant=new Date(+instant+21_000);assert.deepEqual((await feed()).games,[]);assert.equal(standingCalls,2);
 stage=2;instant=new Date(+instant+21_000);assert.deepEqual((await feed()).games.map(g=>g.id),['second']);
});
test('partial schedule failures suppress that league instead of proving incomplete eligibility',async()=>{
 const feed=createFeed({clock:()=>now,request:async url=>{if(url.includes('/mlb/'))throw Error('offline');return {events:[]};}});
 const data=await feed();assert.equal(data.leagues.find(l=>l.id==='mlb').state,'error');assert.deepEqual(data.games,[]);
});

test('a blocked successor never captures a premature pregame streak',async()=>{
 let instant=new Date(now),stage=0;
 const feed=createFeed({clock:()=>instant,request:async url=>{
   if(url.includes('/standings')){
     const t=table();
     if(stage>=1){t.children[0].standings.entries[0].stats=stats(10,5+stage,'L'+stage);
       t.children[0].standings.entries[1].stats=stats(10+stage,5,'W'+(3+stage));}
     return t;
   }
   if(!url.includes('/mlb/')||!url.endsWith('20260925'))return {events:[]};
   const first=event('first',-1,'post'), second=event('second',0.5,stage===2?'post':'pre'), third=event('third',2);
   if(stage===0)first.status.type={state:'in',completed:false};
   for(const [e,n] of [[first,1],[second,2]]) {
     const [h,a]=e.competitions[0].competitors;
     const completed=e.status.type.completed;
     if(completed){h.winner=true;a.winner=false;}
     const count=completed?n:stage;
     h.records[0].summary=(10+count)+'-5';a.records[0].summary='10-'+(5+count);
   }
   return {events:[first,second,third]};
 }});
 assert.deepEqual((await feed()).games.map(g=>g.id),['first']);
 stage=1;instant=new Date(+instant+21_000);assert.deepEqual((await feed()).games.map(g=>g.id),['second']);
 stage=2;instant=new Date(+instant+21_000);assert.deepEqual((await feed()).games.map(g=>g.id),['third']);
});
