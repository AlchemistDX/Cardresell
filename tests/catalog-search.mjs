// Execute the shipped catalog paging/selection functions with synthetic HTTP.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { resolveCoreBundle } from './_assetRefs.mjs';
const source = readFileSync(resolveCoreBundle().path, 'utf8');
const functions = new Map();
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration') functions.set(node.id.name, source.slice(node.start,node.end));
  for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
}
walk(parse(source,{ecmaVersion:'latest'}));
const names = ['searchMTG','_searchMTGPrintings','_addMTGPrintingButton','deriveLargeUrl',
  '_scanSearchPrintingMatch','_clientPrintingMatches','_clientPrintingText','_clientPrintingNumber','_clientPrintingGame'];
let current = 1, requests = [], replies = [], selectedFactory, buttons = [], checks = 0;
const dropList = {set innerHTML(v){this.html=v;buttons=[]},get innerHTML(){return this.html},appendChild(b){buttons.push(b)}};
const context = {URL, console, dropList, esc:String,
  _snapSearchReq:()=>current,_searchReqStillCurrent:s=>s===current,
  searchWithTPL:async()=>({ok:true,cards:[]}),
  fallbackOutcome:()=>({ok:true}),tplOutcomeHtml:(_,html)=>html,
  attachDropHandlers:factory=>{selectedFactory=factory},
  fetchFallbackJson:async url=>{requests.push(url);const r=replies.shift();if(typeof r==='function')return r();return r},
  document:{createElement:()=>({style:{},addEventListener(event,cb){this[event]=cb}})}
};
context.window=context;
vm.createContext(context);
vm.runInContext(names.map(n=>{assert.ok(functions.has(n),n);return functions.get(n)}).join('\n'),context);
const card = i=>({id:String(i),name:'Same art',set_name:'Set '+i,collector_number:String(i),prices:{},image_uris:{}});
const response = (cards,next)=>({status:200,json:{data:cards,has_more:!!next,next_page:next}});
function check(label, f){f();checks++;console.log('✓ '+label)}
const page2='https://api.scryfall.com/cards/search?page=2';
replies=[response(Array.from({length:25},(_,i)=>card(i)),page2)];
await context.searchMTG('Same art');
check('all first-page printings remain selectable beyond row 20',()=>{assert.equal(Object.keys(context._searchCards).length,25);assert.equal(selectedFactory(24).number,'24')});
check('printing query includes physical editions and variations',()=>{const u=new URL(requests[0]);assert.equal(u.searchParams.get('unique'),'prints');assert.equal(u.searchParams.get('include_variations'),'true');assert.match(u.searchParams.get('q'),/game:paper/)});
check('collector number is visible in result rows',()=>assert.match(dropList.html,/#24/));
replies=[{status:503,json:{}}];
await buttons.at(-1).click();
check('page failure preserves existing results and offers retry',()=>{assert.equal(Object.keys(context._searchCards).length,25);assert.equal(buttons.at(-1).disabled,false);assert.match(buttons.at(-1).textContent,/retry/)});
replies=[response([card(24),card(25)])];
await buttons.at(-1).click();
check('next page appends unique printing IDs and retains exact selection',()=>{assert.equal(Object.keys(context._searchCards).length,26);assert.equal(selectedFactory(25).setName,'Set 25');assert.equal(buttons.length,0)});
replies=[response([card(0)],page2)];await context.searchMTG('Same art');
replies=[()=>{current++;dropList.innerHTML='new query';return response([card(1)])}];
await buttons.at(-1).click();
check('late page cannot replace newer search',()=>assert.equal(dropList.html,'new query'));
replies=[response([card(0)],'https://untrusted.invalid/cards/search')];await context.searchMTG('Same art');
const before=requests.length;await buttons.at(-1).click();
check('foreign pagination host is rejected without a request',()=>assert.equal(requests.length,before));
context.searchWithTPL=async()=>({ok:true,cards:[{name:'TPL result'}]});context._tplSetName=()=>'';
await context.searchMTG('Same art');
check('primary-provider results expose full-printing browsing',()=>assert.equal(buttons.at(-1).textContent,'Browse all Magic printings'));
replies=[response([card(77)])];await buttons.at(-1).click();
check('full-printing action reaches catalog and preserves chosen printing',()=>assert.equal(selectedFactory(0).number,'77'));
for(const url of ['https://images.pokemontcg.io/a/1.png','https://images.pokemontcg.io/a/1_hires.png']) {
  check('large image conversion is idempotent: '+url,()=>assert.equal(context.deriveLargeUrl(url),'https://images.pokemontcg.io/a/1_hires.png'));
}
const target={card_type:'mtg',card_name:'Same art',card_number:'007',set_name:'Real set',language:'en'};
const row={card:{name:'Same art',game:'mtg',number:'7',setName:'Real set'},raw:{id:'canonical',set:'abc'}};
check('scan search selects only an exact unambiguous printing',()=>assert.equal(context._scanSearchPrintingMatch(target,[row]),row));
for(const [label,change] of Object.entries({prefix:{card_number:'70'},otherSet:{set_name:'Other set'},noSet:{set_name:''},otherName:{card_name:'Other name'},otherGame:{card_type:'pokemon'},otherLanguage:{language:'ja'},conflictingSet:{set_code:'xyz'},wrongID:{grounded_id:'other'}})) {
  check('scan auto-selection refuses '+label,()=>assert.equal(context._scanSearchPrintingMatch({...target,...change},[row]),null));
}
check('same printing evidence on multiple rows needs user selection',()=>assert.equal(context._scanSearchPrintingMatch(target,[row,{...row,raw:{...row.raw,id:'second'}}]),null));
check('canonical ID agrees before automatic selection',()=>assert.equal(context._scanSearchPrintingMatch({...target,grounded_id:'canonical'},[row]),row));
check('legacy name-number breadcrumbs alone cannot auto-select',()=>assert.equal(context._scanSearchPrintingMatch(null,[row]),null));
const canonicalID='12345678-1234-1234-1234-123456789abc';
context._scanTargetPrinting={...target,grounded_id:canonicalID};
replies=[{status:200,json:{...card(7),id:canonicalID}}];
await context.searchMTG('Same art');
check('verified Magic ID loads its printing directly without a broad search',()=>{assert.equal(requests.at(-1),'https://api.scryfall.com/cards/'+canonicalID);assert.equal(context._searchCards[0]._raw.id,canonicalID)});
context._scanTargetPrinting=null;

// Optional real-DOM gate for this UI change; all network stays local/synthetic.
if (process.env.CR_CHROMIUM) {
  const {chromium} = await import('playwright');
  const {createServer} = await import('node:http');
  const html = readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const styles = [...html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map(m=>m[0]).join('');
  const boot = `const dropList=document.getElementById('dropList'),searchInput=document.getElementById('searchInput'),activeGame='mtg';
  window._searchReqId=1;const _snapSearchReq=()=>1,_searchReqStillCurrent=()=>true,esc=v=>String(v||'');
  const searchWithTPL=async()=>({ok:true,cards:[]}),fallbackOutcome=()=>({ok:true}),tplOutcomeHtml=(_,v)=>v;
  function setSelectedCard(c){window.selected=c} function loadCardUI(){}
  let calls=0;async function fetchFallbackJson(){return (++calls===1?${JSON.stringify(response(Array.from({length:25},(_,i)=>card(i)),page2))}:${JSON.stringify(response([card(25)]))})}
  `;
  const fixture = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<div style="margin:20px;position:relative"><input id="searchInput"><div id="dropList" class="drop-list open" role="listbox"></div></div><script>${boot}${[...names,'attachDropHandlers'].map(n=>functions.get(n)).join('\n')}</script>`;
  const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture)});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
  try {
    for (const viewport of [{width:390,height:844},{width:844,height:390}]) {
      const page=await browser.newPage({viewport});
      await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
      await page.goto(origin);
      await page.evaluate(()=>searchMTG('Same art'));
      assert.equal(await page.locator('.drop-item').count(),25);
      await page.getByRole('button',{name:'Load more printings',exact:true}).click();
      assert.equal(await page.locator('.drop-item').count(),26);
      await page.locator('.drop-item').last().click();
      assert.equal(await page.evaluate(()=>selected.number),'25');
      assert.equal(await page.locator('#dropList').evaluate(e=>e.classList.contains('open')),false);
      await page.evaluate(async()=>{
        calls=0;selected=null;dropList.classList.add('open');
        _scanTargetNumber='24';_scanTargetPrinting={card_type:'mtg',card_name:'Same art',card_number:'24',set_name:'Set 24',grounded_id:'24'};
        await searchMTG('Same art');
      });
      await page.waitForFunction(()=>selected?.number==='24');
      await page.evaluate(async()=>{
        calls=0;selected={name:'previous card'};dropList.classList.add('open');
        _scanTargetNumber='240';_scanTargetPrinting={card_type:'mtg',card_name:'Same art',card_number:'240',set_name:'Set 24'};
        await searchMTG('Same art');
      });
      assert.equal(await page.evaluate(()=>selected),null);
      assert.equal(await page.locator('#dropList').evaluate(e=>e.classList.contains('open')),true);
      console.log(`catalog-search browser ${viewport.width}x${viewport.height}: paging and exact-printing selection passed`);
      await page.close();
    }
  } finally {await browser.close();await new Promise(r=>server.close(r))}
}

console.log(`catalog-search: ${checks} passed, 0 failed -- SUITE COMPLETE, exit=0`);
