import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {resolveCoreBundle} from './_assetRefs.mjs';
const source=readFileSync(resolveCoreBundle().path,'utf8');
const ast=parse(source,{ecmaVersion:'latest'}),fn=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='_searchLocalPokemon');
let factory,rows=[{id:'set-1',n:'Mew',s:'Exact set',si:'set',nu:'001a',g:'pokemon',i:'https://example.test/card.png'},{id:'other',n:'Mew',g:'mtg'}],current=true;
const c={window:{CardResellFastPath:{loadCardIndex:async game=>{assert.equal(game,'pokemon');return rows}}},dropList:{innerHTML:''},_searchReqStillCurrent:()=>current,esc:s=>String(s).replace(/</g,'&lt;'),attachDropHandlers:f=>{factory=f}};
vm.createContext(c);vm.runInContext(source.slice(fn.start,fn.end),c);let checks=0;
const check=(label,a,b)=>{assert.deepEqual(a,b,label);checks++;console.log('✓ '+label)};
check('outage has a usable identity fallback',await c._searchLocalPokemon('Mew',1),true);
check('fallback discloses limited coverage',c.dropList.innerHTML.includes('limited local catalog'),true);
check('only Pokemon records used',Object.keys(c.window._searchCards).length,1);
check('collector suffix retained',factory(0).number,'001a');
check('no invented prices',factory(0).priceVariants.length,0);
check('local source explicit',factory(0).source.includes('live prices unavailable'),true);
check('exact canonical id retained',factory(0).id,'set-1');
current=false;c.dropList.innerHTML='new search';await c._searchLocalPokemon('Mew',1);
check('late response cannot replace new query',c.dropList.innerHTML,'new search');
current=true;rows=[];check('local miss does not assert global absence',await c._searchLocalPokemon('unknown',1),false);
c.window.CardResellFastPath.loadCardIndex=async()=>{throw Error('offline')};check('failed optional index preserves provider error',await c._searchLocalPokemon('Mew',1),false);
c.window.CardResellFastPath.loadPokemonMetadata=async()=>[{id:'missing-image',g:'pokemon',n:'Mew',nu:'HGSS18',s:'Promos'}];
check('metadata-only identity survives image-index failure',await c._searchLocalPokemon('Mew',1),true);
check('metadata-only result remains unpriced',factory(0).priceVariants.length,0);


// Exercise actual HTTP header/body stalls, rather than a mock that times out
// before a response body starts. The body must remain inside the same budget.
const {createServer}=await import('node:http');
const helper=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='fetchFallbackJson');
const httpContext={fetch,AbortController,setTimeout,clearTimeout,console:{warn(){}}};
vm.createContext(httpContext);vm.runInContext(source.slice(helper.start,helper.end),httpContext);
const server=createServer((req,res)=>{
 if(req.url==='/headers')return;
 if(req.url==='/body'){res.writeHead(200,{'content-type':'application/json'});res.write('{"data":');return;}
 if(req.url==='/unavailable'){res.writeHead(503).end('{}');return;}
 if(req.url==='/missing'){res.writeHead(404).end('{}');return;}
 res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'base1-4'}]}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
try{
 let r=await httpContext.fetchFallbackJson(base+'/ok',undefined,2000);
 check('successful provider retains exact identity',r.json.data[0].id,'base1-4');
 r=await httpContext.fetchFallbackJson(base+'/unavailable',undefined,2000);
 check('HTTP outage is retained as provider failure',r.status,503);
 r=await httpContext.fetchFallbackJson(base+'/missing',undefined,2000);
 check('genuine missing status remains distinguishable',r.status,404);
 for(const route of ['/headers','/body']){
  const start=Date.now();r=await httpContext.fetchFallbackJson(base+route,undefined,80);
  check(route+' stall is unavailable, not empty',r.reached,false);
  check(route+' stall returns within bounded time',Date.now()-start<2000,true);
 }
 const caller=new AbortController();const pending=httpContext.fetchFallbackJson(base+'/headers',{signal:caller.signal},2000);caller.abort();
 check('caller cancellation is retained',(await pending).reached,false);
 caller.abort();r=await httpContext.fetchFallbackJson(base+'/ok',{signal:caller.signal},2000);
 check('already cancelled request cannot produce results',r.reached,false);
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
console.log(`SUITE COMPLETE: catalog-outage.mjs: ${checks} passed, 0 failed`);
