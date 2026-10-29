// Execute the shipped helpers against HTTP-boundary fixtures, without paid calls.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {resolveCoreBundle} from './_assetRefs.mjs';
const source=readFileSync(resolveCoreBundle().path,'utf8');
const ast=parse(source,{ecmaVersion:'latest'});
const names=['_crTplGameForCard','fetchFallbackJson','searchWithTPL','fetchTPLCardById','fetchTPLGradedByNameNumber'];
const code=names.map(name=>{const n=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(n,name);return source.slice(n.start,n.end)}).join('\n');
let checks=0;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++};
function setup(game='mtg') {
 const calls=[];
 const c={window:{tplApiKey:true},selectedCard:{name:'Fixture',number:'7',setName:'Exact Set',game,images:{small:'owner.jpg'}},
  AbortController,console:{warn(){}},setTimeout,clearTimeout,
  _rankTplBySetHint:rows=>rows,
  tplCardToNormalized:(row,game,image)=>({game,image,priceVariants:row.priceVariants||[{key:'psa_9',market:12}]})};
 c.fetch=async(url,init)=>{calls.push({url,init});return Response.json({data:[]})};
 vm.createContext(c);vm.runInContext(code,c);return {c,calls};
}
for(const game of ['pokemon','mtg','yugioh','pokemonJP']) {
 const {c,calls}=setup(game);const slug=game==='pokemonJP'?'pokemon-jp':game;
 const rows=Array.from({length:30},(_,i)=>({id:'other'+i,name:'Fixture',number:String(i+100),set_name:'Wrong Set'}));
 rows.push({id:'exact',name:'Fixture',number:'007',set_name:'Exact Set'});
 c.fetch=async(url,init)=>{calls.push({url,init});return Response.json({data:rows})};
 const result=await c.fetchTPLGradedByNameNumber('Fixture','7','pokemon');
 check(new URL(calls[0].url,'https://example.test').searchParams.get('game'),slug,'selected game must override accidental Pokemon default');
 check(calls[0].url.includes('limit=100'),true,'find exact printing beyond first 20 candidates');
 check(result?.[0]?.market,12,'exact printing carries graded price');
 check(c.selectedCard.tplGameSlug,slug,'retain correct game for future enrichment');
 check(!!calls[0].init.signal,true,'request is bounded');
}
for(const data of [{data:{}},{error:'unavailable'},null]) {
 const {c}=setup();c.fetch=async()=>Response.json(data);
 check((await c.searchWithTPL('Fixture','mtg')).ok,false,'malformed response is unavailable, never empty catalogue');
 check(await c.fetchTPLGradedByNameNumber('Fixture','7','mtg'),null,'malformed graded search is unusable');
}
for(const id of ['exact','wrong',undefined]) {
 const {c}=setup();c.selectedCard.tplId='exact';
 c.fetch=async()=>Response.json({data:{id,name:'Fixture'}});
 const r=await c.fetchTPLCardById('exact','mtg');
 check(r?.game??null,id==='exact'?'mtg':null,'by-ID response must carry requested ID');
}
for(const change of ['replace','mutate']) {
 const {c}=setup();c.selectedCard.tplId='exact';let release;
 c.fetch=()=>new Promise(r=>release=r);
 const pending=c.fetchTPLCardById('exact','mtg');
 if(change==='replace')c.selectedCard={...c.selectedCard,name:'Another'};
 else c.selectedCard.number='8';
 release(Response.json({data:{id:'exact',name:'Fixture'}}));
 check(await pending,null,'late detail must not attach to another selection');
}
for(const providerSet of ['SM - Unbroken Bonds','Unbroken Bonds','Unbroken Bonds 2']) {
 const {c}=setup('pokemon');c.selectedCard.setName='Unbroken Bonds';
 c.fetch=async()=>Response.json({data:[{id:'exact',name:'Fixture',number:'7',set:{name:providerSet},game:{slug:'pokemon'}}]});
 check(!!(await c.fetchTPLGradedByNameNumber('Fixture','7','pokemon')),providerSet!=='Unbroken Bonds 2','known era prefix matches, meaningful set suffix remains distinct');
}
{
 const {c}=setup('mtg');c.selectedCard.tplId='exact';
 c.fetch=async()=>Response.json({data:{id:'exact',name:'Fixture',game:{slug:'pokemon'}}});
 check(await c.fetchTPLCardById('exact','mtg'),null,'foreign-game detail is rejected');
 c.fetch=async()=>Response.json({data:[{id:'exact',name:'Fixture',number:'7',set_name:'Exact Set',game:{slug:'pokemon'}},null]});
 check(await c.fetchTPLGradedByNameNumber('Fixture','7','mtg'),null,'foreign-game search cannot supply prices');
}
for(const kind of ['id','name']) for(const stall of ['headers','body']) {
 const {c}=setup();c.selectedCard.tplId='exact';let cleared=0;
 c.setTimeout=fn=>setTimeout(fn,15);c.clearTimeout=t=>{cleared++;clearTimeout(t)};
 c.fetch=async(url,{signal})=>{
  const pending=()=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('fixture','AbortError')),{once:true}));
  if(stall==='headers')return pending();
  return {ok:true,status:200,json:pending};
 };
 const start=Date.now();
 check(await (kind==='id'?c.fetchTPLCardById('exact','mtg'):c.fetchTPLGradedByNameNumber('Fixture','7','mtg')),null,'stalled '+kind+' '+stall+' releases fallback');
 check(Date.now()-start<1000,true,'bounded wait');check(cleared,1,'timer released');
}
console.log(`tpl-core-game-recovery: ${checks} passed, 0 failed -- SUITE COMPLETE`);
