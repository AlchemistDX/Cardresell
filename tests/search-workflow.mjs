// Exercise the shipped async dispatcher and modal handoff with controlled
// provider completion order. No provider requests, accounts or scan credits.
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {referencedHashedAssets} from './_assetRefs.mjs';

const assets=referencedHashedAssets();
const core=readFileSync(assets.find(a=>a.base==='core').path,'utf8');
const ui=readFileSync(assets.find(a=>a.base==='ui').path,'utf8');
function functions(source,names) {
  const found=parse(source,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&names.includes(n.id.name));
  assert.equal(found.length,names.length,'all requested shipped functions found');
  return found.map(n=>source.slice(n.start,n.end)).join('\n');
}
const dispatcher=functions(core,['_snapSearchReq','_searchReqStillCurrent','_invalidateCardSearch','doSearch','searchPokemon']);
const modal=functions(ui,['openSearchModal','openCatalog','closeSearchModal','_closeCatalogChip']);
const inputStart=core.indexOf("searchInput.addEventListener('input'");
const inputEnd=core.indexOf("searchInput.addEventListener('keydown'",inputStart);
assert.ok(inputStart>0&&inputEnd>inputStart,'shipped input listener located');
const inputCode=core.slice(inputStart,inputEnd);
let checks=0;
const check=(condition,label)=>{assert.ok(condition,label);checks++;};
function setup() {
  class Element {
    constructor(){this.dataset={};this.style={};this.children=[];this.value='';this.textContent='';this.html='';this.events={};const classes=new Set();this.classList={add:s=>classes.add(s),remove:s=>classes.delete(s),contains:s=>classes.has(s)};}
    set innerHTML(s){this.html=s;this.children=[];}
    get innerHTML(){return this.html;}
    querySelectorAll(selector){return selector==='.drop-item'?[...this.html.matchAll(/class="drop-item"[\s\S]*?data-idx="(\d+)"/g)].map(m=>({dataset:{idx:m[1]},query:this.dataset.lastQuery})):[];}
    querySelector(selector){if(selector==='.drop-empty'){const m=this.html.match(/class="drop-empty"[^>]*>([\s\S]*?)<\/div>/);return m?{textContent:m[1].replace(/<[^>]*>/g,'')}:null;}return null;}
    setAttribute(k,v){this[k]=v;}
    replaceChildren(...children){this.html='';this.children=children;}
    prepend(child){this.children.unshift(child);}
    addEventListener(name,fn){this.events[name]=fn;}
  }
  const elements=new Map(['searchResultsModal','searchModalGrid','searchModalTitle','searchModalCount'].map(id=>[id,new Element()]));
  const queue=[],renders=[],timers=new Map();let clock=1000,timer=0;
  const ctx=vm.createContext({window:{_searchReqId:0,_searchJob:null,_catalogOpenId:0},activeGame:'pokemon',searchTimeout:null,
    searchInput:new Element(),dropList:new Element(),console:{error(){}},
    Date:{now:()=>clock},clearTimeout:id=>timers.delete(id),setTimeout:fn=>{timers.set(++timer,fn);return timer;},
    document:{getElementById:id=>elements.get(id),createElement:()=>new Element()},
    touchListingContext(){},esc:s=>String(s??''),attachDropHandlers(){},injectPokemonImages(){},
    searchWithTPL:q=>new Promise((resolve,reject)=>queue.push({q,resolve,reject})),
    _renderCatalogActions(){},_addCatalogButton(){},
    _renderCatalogFromDrop(q,items){renders.push({q,items:[...items]});elements.get('searchModalGrid').replaceChildren({textContent:q});},
  });
  vm.runInContext(dispatcher+'\n'+modal+'\n'+inputCode,ctx);
  for(const name of ['searchPokemonJP','searchMTG','searchYugioh','searchLorcana','searchOnePiece'])ctx[name]=ctx.searchPokemon;
  function finish(i,name='Pikachu'){queue[i].resolve({cards:[{name,number:'25',set:{name:'Base'},prices:{raw:{near_mint:{tcgplayer:{market:2}}}}}]});}
  function type(value){ctx.searchInput.value=value;ctx.searchInput.events.input();}
  return {ctx,queue,renders,elements,finish,type,advance:ms=>clock+=ms,timers};
}

{
  const h=setup();h.ctx.searchInput.value='Pikachu';
  const dropdown=h.ctx.doSearch('Pikachu'), opened=h.ctx.openSearchModal();
  check(h.queue.length===1,'autocomplete and full results share one in-flight provider lookup');
  h.finish(0);await Promise.all([dropdown,opened]);
  check(h.renders.length===1&&h.renders[0].q==='Pikachu','shared response renders the requested catalog');
  h.ctx.closeSearchModal();await h.ctx.openCatalog(' pikachu ');
  check(h.queue.length===1&&h.renders.length===2,'same normalized query reuses fresh completed rows');
  h.advance(30001);const refresh=h.ctx.openCatalog('Pikachu');
  check(h.queue.length===2,'reuse expires instead of keeping stale results indefinitely');h.finish(1);await refresh;
}
{
  const h=setup();const old=h.ctx.openCatalog('Pikachu'),next=h.ctx.openCatalog('Mew');
  h.finish(1,'Mew');await next;h.finish(0);await old;
  check(h.renders.length===1&&h.renders[0].q==='Mew','late old search cannot paint or relabel the new catalog');
  check(h.ctx.dropList.dataset.lastQuery==='mew','drop state stays attached to the newer query');
}
{
  const h=setup();const old=h.ctx.openCatalog('Pikachu');
  h.ctx.activeGame='mtg';const next=h.ctx.openCatalog('Pikachu');h.finish(0);await old;h.finish(1);await next;
  check(h.queue.length===2&&h.renders.length===1,'same text in different games never shares a result');
  check(h.ctx.dropList.dataset.lastGame==='mtg','rows retain their requested game');
}
for(const value of ['', 'M']){
  const h=setup();h.ctx.searchInput.value='Pikachu';const pending=h.ctx.doSearch('Pikachu');h.type(value);h.finish(0);await pending;
  check(h.ctx.dropList.innerHTML===''&&!h.ctx.dropList.classList.contains('open'),'clearing or shortening input discards the pending result: '+JSON.stringify(value));
  check(h.timers.size===0,'short query schedules no provider work');
}
{
  const h=setup();const pending=h.ctx.openCatalog('Pikachu');h.ctx.closeSearchModal();h.finish(0);await pending;
  check(h.renders.length===0&&h.elements.get('searchResultsModal').style.display==='none','closing pending search cannot reopen or repaint it');
}
{
  const h=setup();const pending=h.ctx.openCatalog('Pikachu');h.queue[0].reject(Error('offline'));await pending;
  const text=h.elements.get('searchModalGrid').children.map(n=>n.textContent).join(' ');
  check(text.includes('Search failed')&&!text.includes('No results'),'network failure keeps a truthful error rather than claiming no cards exist');
  const retry=h.ctx.openCatalog('Pikachu');check(h.queue.length===2,'failed result is retryable immediately');h.finish(1);await retry;
  check(h.renders.length===1,'retry recovers the normal selection path');
}
{
  const h=setup();h.ctx.searchPokemon=async()=>{h.ctx.dropList.innerHTML='<div class="drop-empty">Provider temporarily unavailable. Please retry.</div>';};
  await h.ctx.openCatalog('Pikachu');
  check(h.elements.get('searchModalGrid').children[0].textContent.includes('Provider temporarily unavailable'),'provider explanation survives the dropdown-to-modal handoff');
  h.ctx.searchPokemon=async()=>{h.ctx.dropList.innerHTML='<div class="drop-empty">No Pokémon cards found. Try a different name.</div>';};
  await h.ctx.openCatalog('Pikachu');
  check(h.elements.get('searchModalGrid').children[0].textContent.includes('No Pokémon cards found'),'genuine empty results retain their useful next step');
}
{
  const h=setup();const old=h.ctx.openCatalog('Pikachu');h.type('Mew');h.finish(0);await old;
  check(h.renders.length===0,'query editing invalidates the modal before its debounce starts');
  check(h.timers.size===1,'new query schedules exactly one debounced search');
}
console.log(`search-workflow: ${checks} passed, 0 failed -- SUITE COMPLETE, exit=0`);
