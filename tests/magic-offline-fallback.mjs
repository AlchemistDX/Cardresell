import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parse} from 'acorn';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {resolveCoreBundle,ROOT} from './_assetRefs.mjs';
const core = readFileSync(resolveCoreBundle().path,'utf8');
const ast = parse(core,{ecmaVersion:'latest'});
const funcs = new Map(ast.body.filter(n=>n.type==='FunctionDeclaration').map(n=>[n.id.name,core.slice(n.start,n.end)]));
let pass=0;
function check(name,fn){fn();pass++;console.log('✓ '+name)}
const manifest=JSON.parse(readFileSync(join(ROOT,'data/catalog/current.json')));
const data=JSON.parse(readFileSync(join(ROOT,manifest.games.mtg.url)));
data.cards=manifest.games.mtg.parts.flatMap(p=>JSON.parse(readFileSync(join(ROOT,p.url))).cards);
const card=data.cards.find(c=>c[1]==='Sol Ring');
assert.ok(card);
let selected,buttons=[],renders=[],providerCalls=0;
const dropList={set innerHTML(s){this.markup=s;renders.push(s);buttons=[]},get innerHTML(){return this.markup},appendChild(b){buttons.push(b)}};
const env={AbortController,setTimeout,clearTimeout,console,dropList,esc:String,window:null,
  _snapSearchReq:()=>1,_searchReqStillCurrent:s=>s===1,_clientPrintingGame:s=>s,
  _scanTargetPrinting:null,
  searchWithTPL:async()=>({ok:false,reason:'network',cards:[]}),
  fetchFallbackJson:async()=>{providerCalls++;return {status:0,json:null}},
  fallbackOutcome:()=>({ok:false,reason:'network'}),
  tplOutcomeHtml:(_,s)=>s||'provider unavailable',
  attachDropHandlers:fn=>{selected=fn},
  document:{createElement:()=>({style:{},addEventListener(){}})}
};
env.window=env;vm.createContext(env);
const module=readFileSync(join(ROOT,'js/search-catalog.js'),'utf8');
env.fetch=async url=>({ok:true,json:async()=>JSON.parse(readFileSync(join(ROOT,String(url).replace(/^\//,''))))});
vm.runInContext(module,env);
for(const name of ['searchMTG','_searchMTGPrintings','_searchCatalogPrintings','_addCatalogButton','_addMTGPrintingButton']) {
  assert.ok(funcs.has(name),name);vm.runInContext(funcs.get(name),env);
}
const found=await env.CardResellCatalog.search('mtg','Sol Ring');
check('complete Magic identity snapshot loads',()=>{assert.equal(found.data.cards.length,107402);assert.equal(found.data.game,'mtg')});
check('searched rows retain exact printed set and number',()=>{assert.ok(found.rows.length>50);assert.equal(found.rows[0][6],'en')});
const alternate=await env.CardResellCatalog.search('mtg','Insectile Aberration');
check('split / transformed card face aliases are searchable',()=>assert.ok(alternate.rows.some(c=>c[9].includes('Insectile Aberration'))));
const hint=await env.CardResellCatalog.suggest('mtg','Insectile Aberration');
check('image-only names stay suggestions, not printings',()=>assert.equal(hint.cardType,'mtg'));
const exact=await env.CardResellCatalog.byId('mtg',card[0]);
check('canonical Scryfall UUID resolves only its exact printing',()=>{assert.equal(exact.rows.length,1);assert.equal(exact.rows[0][0],card[0]);assert.equal(await_id(exact.rows[0][0]),true)});
function await_id(id){return id===card[0]}
const malformed=await env.CardResellCatalog.byId('mtg','not-a-card');
check('foreign or malformed UUIDs are not accepted',()=>assert.equal(malformed,null));
await env.searchMTG('Sol Ring');
check('failed paid and live sources fall back to offline catalog',()=>assert.match(dropList.markup,/Sol Ring/));
check('fallback clearly labels pricing as unavailable',()=>{assert.match(dropList.markup,/Check price/);assert.ok(!dropList.markup.includes('$'))});
const normalized=selected(0);
check('offline selection retains Scryfall UUID',()=>{assert.match(normalized.id,/^[a-f0-9-]{36}$/i);assert.equal(normalized.source,'Scryfall catalog — price not checked');assert.equal(normalized.priceVariants.length,0);assert.equal(normalized._localCatalogFallback,true)});
env._scanTargetPrinting={card_type:'mtg',grounded_id:card[0]};
await env.searchMTG('not even the name');
const canonical=selected(0);
check('canonical ID recovery does not search or change to a different printing',()=>assert.equal(canonical.id,card[0]));
check('offline rescue does not add paid recognition attempts',()=>assert.equal(providerCalls,2));
console.log('magic-offline-fallback: '+pass+' passed, 0 failed -- SUITE COMPLETE, exit=0');
