import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parse} from 'acorn';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {ROOT,referencedHashedAssets} from './_assetRefs.mjs';
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('✓ '+name)};
const manifest=JSON.parse(readFileSync(join(ROOT,'data/catalog/current.json')));
const build=JSON.parse(readFileSync(join(ROOT,'data/catalog/coverage.json')));
const module=readFileSync(join(ROOT,'js/search-catalog.js'),'utf8');
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const [game,meta] of Object.entries(manifest.games)){
 const raw=readFileSync(join(ROOT,meta.url)),d=JSON.parse(raw);
 if(game==='mtg' && Array.isArray(meta.parts)){
   assert.equal(d.cards.length,0);
   assert.deepEqual(d.parts,meta.parts);
   d.cards=meta.parts.flatMap(part=>{
     assert.match(part.url,/^\/data\/catalog\/mtg-part\.[a-f0-9]{12}\.json$/);
     const content=readFileSync(join(ROOT,part.url));
     assert.ok(part.url.includes(hash(content).slice(0,12)));
     const json=JSON.parse(content);assert.equal(json.schema,1);assert.equal(json.game,'mtg');assert.equal(json.cards.length,part.count);
     return json.cards;
   });
 }
 check(game+': optional native-language catalog has the declared count',()=>assert.equal((d.nativeCards||[]).length,meta.nativeCount||0));
 check(game+': all imported IDs are unique and manifest matches bytes',()=>{assert.equal(d.cards.length,meta.count);assert.equal(new Set(d.cards.map(c=>c[0])).size,meta.count);assert.equal(hash(raw),build.games[game].asset_sha256);assert.ok(meta.url.includes(hash(raw).slice(0,12)))});
 check(game+': every identity belongs to a known set and correct language',()=>assert.ok(d.cards.every(c=>typeof d.sets[c[2]]==='string'&&c[6]===(game==='pokemonjp'?'ja':'en'))));
 check(game+': prices are not stored in the catalog',()=>assert.ok(d.cards.every(c=>Array.isArray(c)&&(game==='mtg' ? c.length===10 && Array.isArray(c[9]) && c[9].every(x=>typeof x==='string') : c.length<=9))));
 if(game==='pokemon')check('Pocket sets cannot appear in physical-card lookup',()=>assert.ok(d.cards.every(c=>!build.games.pokemon.excluded_pocket_sets.includes(c[2]))));
 if(game==='yugioh')check('YGO card-wide artwork is never sold as an exact-printing image',()=>assert.ok(d.cards.every(c=>c[5]==='')));
}
// Real shipped loader under controlled HTTP: partial catalogs, retry and concurrent requests.
const fixture={schema:1,game:'pokemonjp',asOf:'2026-10-26',provider:'TCGCSV / TCGplayer',sets:{s:'Japanese set'},cards:[['42','Pikachu','s','001','Rare','','ja']]};
let hits=0,broken=true;
const ctx={AbortController,setTimeout,clearTimeout,fetch:async url=>{
 hits++;if(url.includes('manifest.'))return {ok:true,json:async()=>({schema:1,games:{pokemonjp:{url:'/data/catalog/pokemonjp.aaaaaaaaaaaa.json',count:1}}})};
 return {ok:true,json:async()=>broken?{...fixture,cards:[]}:structuredClone(fixture)};
}};vm.createContext(ctx);vm.runInContext(module,ctx);
await assert.rejects(ctx.CardResellCatalog.load('pokemonjp'));checks++;broken=false;
const [a,b]=await Promise.all([ctx.CardResellCatalog.search('pokemonjp','Pikachu'),ctx.CardResellCatalog.search('pokemonjp','001')]);
check('failed snapshot retries; concurrent readers share one successful fetch',()=>{assert.equal(hits,3);assert.equal(a.rows.length,1);assert.equal(b.rows.length,1)});
const n=ctx.CardResellCatalog.normalized(a.data,a.rows[0]);
check('Japanese selection keeps language, set and number with no English price',()=>{assert.equal(n.language,'ja');assert.equal(n.setName,'Japanese set');assert.equal(n.number,'001');assert.equal(n.priceVariants.length,0);assert.equal(n.id,'tcgplayer:42')});
await assert.rejects(ctx.CardResellCatalog.load('sports'));checks++;
check('new module is shipped once with immutable bytes',()=>{const assets=referencedHashedAssets().filter(x=>x.base==='search-catalog');assert.equal(assets.length,1);assert.equal(readFileSync(assets[0].path,'utf8'),module)});
// The paid lookup cannot indefinitely block the imported fallback. Both the
// headers and body stay within the shipped six-second abort budget.
const coreSource=readFileSync(referencedHashedAssets().find(x=>x.base==='core').path,'utf8');
const lookupNode=parse(coreSource,{ecmaVersion:'latest'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='searchWithTPL');
for(const phase of ['headers','body']) {
 const delays=[];
 const env={window:{tplApiKey:true},console:{warn(){}},AbortController,clearTimeout,
  setTimeout:(f,ms)=>{delays.push(ms);return setTimeout(f,40)},_rankTplBySetHint:x=>x,
  fetch:async(url,{signal})=>{
   const stalled=()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
   return phase==='headers'?stalled():{ok:true,json:stalled};
  }};
 vm.createContext(env);vm.runInContext(coreSource.slice(lookupNode.start,lookupNode.end),env);
 const result=await env.searchWithTPL('Pikachu','pokemon');
 check('paid lookup '+phase+' timeout releases fallback',()=>{assert.equal(result.ok,false);assert.equal(result.reason,'network');assert.deepEqual(delays,[6000])});
}
// Mobile + desktop real UI, real catalog data; API pricing/auth calls are synthetic.
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://local').pathname;
 try{const rel=path==='/'?'/index.html':path;const raw=readFileSync(join(ROOT,rel));res.setHeader('Content-Type',rel.endsWith('.js')?'application/javascript':rel.endsWith('.json')?'application/json':rel.endsWith('.css')?'text/css':'text/html');res.end(raw)}catch{res.writeHead(404).end()}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
try{
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('cr_landing_seen','1');localStorage.setItem('cs_landing_seen','1')});
  await page.route('**/*',r=>{const u=r.request().url();if(!u.startsWith(origin))return r.abort();if(u.includes('/api/'))return r.fulfill({status:200,contentType:'application/json',body:'{"data":[],"results":[]}'});return r.continue()});
  await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof searchPokemon==='function'&&!!window.CardResellCatalog);
  for(const [game,q] of [['pokemon','Pikachu'],['pokemonjp','Pikachu'],['pokemonjp','ピカチュウ'],['lorcana','Mickey'],['onepiece','Luffy'],['yugioh','Dark Magician'],['mtg','Sol Ring']]){
   await page.evaluate(async({game,q})=>{onGameSelectChange(game);searchInput.value=q;await openCatalog(q)}, {game,q});
   await page.locator('#searchModalGrid .cat-result').first().waitFor();
   const before=await page.locator('#searchModalGrid .cat-result').count();
   check(width+' '+game+': real catalog renders without paid lookup results',()=>assert.ok(before>0&&before<=50));
   const more=page.locator('#searchModalGrid').getByRole('button',{name:'Load more printings',exact:true});
   if(await more.count()){
    await more.click();const after=await page.locator('#searchModalGrid .cat-result').count();
    check(width+' '+game+': full-screen pagination reaches later printings',()=>assert.ok(after>before));
   }
   const expected=await page.evaluate(()=>{const rows=[...document.querySelectorAll('#searchModalGrid .cat-result')];const idx=rows.at(-1).dataset.idx;return window._searchCards[idx]._catalog});
   await page.locator('#searchModalGrid .cat-result').last().click();
   const actual=await page.evaluate(()=>({name:selectedCard.name,number:selectedCard.number,setName:selectedCard.setName,game:selectedCard.game,language:selectedCard.language}));
   check(width+' '+game+': selected printing reaches calculator unchanged',()=>assert.deepEqual(actual,{name:expected.name,number:expected.number,setName:expected.setName,game,language:expected.language}));
   const hidden=await page.locator('#searchResultsModal').isHidden();
   check(width+' '+game+': selection closes results',()=>assert.equal(hidden,true));
  }
  check(width+': no new catalog runtime errors',()=>assert.deepEqual(errors.filter(e=>/Catalog|catalog|_renderCatalogActions|ReferenceError/.test(e)),[]));
  await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
console.log(`catalog-completeness: ${checks} passed, 0 failed -- SUITE COMPLETE, exit=0`);
