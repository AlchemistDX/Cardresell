// Shipped search controls/renderers; synthetic catalog only. No external calls.
import {chromium} from 'playwright';
import {parse} from 'acorn';
import {readFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {referencedHashedAssets,ROOT} from './_assetRefs.mjs';
const assets=referencedHashedAssets(),html=readFileSync(join(ROOT,'index.html'),'utf8');
const source=base=>readFileSync(assets.find(a=>a.base===base).path,'utf8');
function pick(src,names){return parse(src,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&names.includes(n.id.name)).map(n=>src.slice(n.start,n.end)).join('\n');}
const core=source('core'),ui=source('ui');
const funcs=pick(core,['_snapSearchReq','_searchReqStillCurrent','_invalidateCardSearch','doSearch','searchPokemon'])+'\n'+pick(ui,['openSearchModal','openCatalog','closeSearchModal','_renderCatalogFromDrop','_storeCatalogRows','_applyFilters','_makeCatalogGridCell','_makeCatalogRow']);
const inputHandlers=core.slice(core.indexOf("searchInput.addEventListener('input'"),core.indexOf("document.getElementById('searchBtn').addEventListener"));
const fixture=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+`<script>
let activeGame='pokemon',searchTimeout=null,calls=0,picked=null,mode='normal';
const searchInput=document.getElementById('searchInput'),dropList=document.getElementById('dropList');
window._searchReqId=0;window._searchJob=null;window._catalogOpenId=0;window._catViewMode='grid';window._catAllRows=[];window._catFilter={};window._catPriceDir=0;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function injectPokemonImages(){}function attachDropHandlers(factory){dropList.querySelectorAll('.drop-item').forEach(row=>row.onclick=()=>picked=window._searchCards[row.dataset.idx]._tpl.name)}
async function searchWithTPL(q){calls++;await new Promise(r=>window.finishLookup=r);if(mode==='offline')throw Error('offline');return {cards:[{name:q,number:'025',set:{name:'Test set'},rarity:'Common',prices:{raw:{near_mint:{tcgplayer:{market:2}}}}}]}}
${funcs}
function touchListingContext(){}
${inputHandlers}
</script>`;
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(fixture)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});let checks=0;
const check=(v,m)=>{assert.ok(v,m);checks++};
try{for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1')?r.continue():r.abort());await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('textbox',{name:'Search card name',exact:true}).fill('Pikachu');await page.evaluate(()=>{doSearch('Pikachu')});
 await page.getByRole('button',{name:'Search',exact:true}).click();check(await page.evaluate(()=>calls)===1,'Search button reuses autocomplete request');
 await page.evaluate(()=>finishLookup());await page.locator('#searchModalGrid [data-idx="0"]').waitFor();
 check(await page.locator('#searchModalCount').textContent()==='1 card','full catalog renders shared response');
 check((await page.locator('#searchModalGrid').textContent()).includes('Test set'),'set and price details survive handoff');
 await page.locator('#searchModalGrid [data-idx="0"]').click();check(await page.evaluate(()=>picked)==='Pikachu','cached catalog selects the correct underlying card');
 check(await page.locator('#searchResultsModal').isHidden(),'selection closes results');
 await page.getByRole('button',{name:'Search',exact:true}).click();await page.locator('#searchModalGrid [data-idx="0"]').waitFor();check(await page.evaluate(()=>calls)===1,'reopening completed result makes no duplicate request');
 const bounds=await page.locator('#searchModalGrid').boundingBox();check(bounds.x>=0&&bounds.x+bounds.width<=width+1,'search grid fits viewport');
 await page.evaluate(()=>{closeSearchModal();_invalidateCardSearch();mode='offline';});await page.getByRole('button',{name:'Search',exact:true}).click();await page.evaluate(()=>finishLookup());
 await page.getByRole('status').filter({hasText:'Search failed'}).waitFor();check(!(await page.locator('#searchModalGrid').textContent()).includes('No results'),'provider outage stays an error in the visible modal');
 await page.evaluate(()=>{closeSearchModal();_invalidateCardSearch();dropList.innerHTML='<div class="drop-empty">Live catalog unavailable. No live prices.</div><div class="drop-item" data-idx="0"><div class="drop-name">Local Pikachu</div></div>';window._searchCards={0:{}};document.getElementById('searchResultsModal').style.display='flex';_renderCatalogFromDrop('Pikachu',dropList.querySelectorAll('.drop-item'));_catFilter.number='no-match';_applyFilters();});
 check((await page.locator('#searchModalGrid').textContent()).includes('No live prices'),'fallback disclosure survives filtering');
 if(process.env.CR_SHOT_DIR){mkdirSync(process.env.CR_SHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.CR_SHOT_DIR,'search-'+width+'.png')});}
 await page.evaluate(()=>{closeSearchModal();_invalidateCardSearch();mode='normal';});
 const callsBeforeDismiss=await page.evaluate(()=>calls);
 await page.locator('#searchInput').fill('Cancelled query');
 await page.locator('#searchInput').press('Escape');await page.waitForTimeout(230);
 check(await page.evaluate(()=>calls)===callsBeforeDismiss,'Escape cancels the queued lookup before it contacts a provider');
 check(await page.locator('#dropList').evaluate(e=>!e.classList.contains('open')),'Escape prevents the delayed dropdown from reopening');
 await page.locator('#searchInput').fill('Eevee');
 await page.evaluate(()=>{doSearch('Eevee')});
 await page.locator('#searchInput').press('Escape');
 await page.evaluate(()=>finishLookup());await page.waitForTimeout(230);
 check(await page.locator('#dropList').evaluate(e=>!e.classList.contains('open')),'Escape keeps late autocomplete results dismissed');
 check(await page.locator('#searchInput').inputValue()==='Eevee','dismissal preserves typed query');
 await page.locator('#searchInput').press('Enter');await page.evaluate(()=>finishLookup());
 await page.locator('#searchModalGrid [data-idx="0"]').waitFor();
 check((await page.locator('#searchModalGrid').textContent()).includes('Eevee'),'explicit Enter can search again after dismissal');
 await page.evaluate(()=>closeSearchModal());
 await page.locator('#searchInput').fill('Bulbasaur');
 await page.locator('#searchInput').press('Enter');
 await page.getByRole('button',{name:'Close search results',exact:true}).click();await page.evaluate(()=>finishLookup());await page.waitForTimeout(230);
 check(await page.locator('#dropList').evaluate(e=>!e.classList.contains('open')),'closing full results keeps its late reply dismissed');
 check(await page.locator('#searchResultsModal').isHidden(),'late reply does not reopen full results');
 await page.evaluate(()=>{_invalidateCardSearch();searchInput.value='Pikachu';searchInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));});
 check(await page.locator('#searchResultsModal').isHidden(),'IME confirmation does not submit a search');
 check(errors.length===0,errors.join('\n'));await page.close();
}console.log(`search-workflow-browser: ${checks} passed, 0 failed -- SUITE COMPLETE, exit=0`);}finally{await browser.close();await new Promise(r=>server.close(r));}
