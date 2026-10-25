import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {parse as parseJS} from 'acorn';
import {chromium} from 'playwright';
import {ROOT,resolveCoreBundle} from './_assetRefs.mjs';
import {completionGuard} from './_complete.mjs';
const {finish}=completionGuard('collection-import');
const source=readFileSync(ROOT+'/js/collection-import.js','utf8');
const html=readFileSync(ROOT+'/index.html','utf8');
const asset=name=>readFileSync(ROOT+'/'+html.match(new RegExp('src="/(js/'+name+'\\.[a-f0-9]{8}\\.js)"'))[1],'utf8');
const protections=asset('inventory-edits')+'\n'+asset('inventory-recovery-policy');
const scope={TextEncoder,crypto:webcrypto,Map,Set,Date,JSON};scope.window=scope;const ctx=vm.createContext(scope);
vm.runInContext(protections+'\n'+source,ctx);const I=ctx.window.CardResellCollectionImport;
let checks=0;const check=(value,message)=>{assert.ok(value,message);checks++;};
const throws=(fn,pattern)=>{assert.throws(fn,pattern);checks++;};
const plan=async(text,existing=[],options={})=>{const csv=I.parse(text);return I.plan(csv,I.autoMap(csv.headers),{game:'pokemon',mode:'skip',...options},existing);};
const quote=s=>'"'+String(s).replace(/"/g,'""')+'"';
const csv=I.parse('\uFEFFCard,Set,Quantity\r\n'+quote('Mr. Mime, "fun"')+','+quote('Line\nTwo')+',2\r\n');
check(csv.rows[0][0]==='Mr. Mime, "fun"' && csv.rows[0][1]==='Line\nTwo','BOM, commas, escaped quotes and multiline values');
for(const [text,pattern] of [['Card,Card\nX,Y',/distinct/],['Card,Set\nX',/number of columns/],['Card\n"X',/closing quote/],['Card\n"X"bad',/Unexpected/],['Card\nX"Y',/quoting/],['Card\n',/at least/],['Card\n'+'x'.repeat(4097),/too long/]])throws(()=>I.parse(text),pattern);
const sample='Card,Set,Quantity,Cost Basis,Current Value,Card Number,Set Code\nPikachu,Base,2,,5.50,58,base1\nPikachu,Base,2,,5.50,58,base1\nCharizard,Base,1,0,,4,base1';
let p=await plan(sample);check(p.errors.length===0 && p.copies===5 && p.missingCost===4 && p.missingValue===1,'physical copies and unknowns preserved');
check(p.rows.every(r=>r.record.setCode==='base1'),'set code is part of the reviewed identity');
check(new Set(p.rows.flatMap(r=>r.entries.map(e=>e.importKey))).size===5,'identical source rows represent different physical copies');
const saved=p.rows.flatMap(r=>r.entries).map((e,i)=>({...e,id:'copy'+i}));
let repeated=await plan(sample,saved);check(repeated.copies===0 && repeated.skipped===5,'repeat import skips every saved physical copy');
repeated=await plan(sample,saved,{mode:'new'});check(repeated.copies===5 && repeated.possible===5,'new purchase mode explicitly adds copies of matching printings');
for(const text of ['Card,Cost Basis\nX,-1','Card,Current Value\nX,=1+1','Card,Cost Basis\nX,"1,23"','Card,Cost Basis\nX,1.001','Card,Quantity\nX,0','Card,Quantity\nX,2.5','Card,Currency\nX,EUR','Card,Game\nX,not-a-game','Card,Condition\nX,pristine','Card,Grader\nX,PSA','Card,Grader,Grade,Certificate,Quantity\nX,PSA,10,123,2','Card,Collection ID,Quantity\nX,abc,2','Card,Collection ID\nX,same\nY,same','Card,Added Date\nX,2026-02-30']) {
 p=await plan(text);check(p.errors.length>0,'reject invalid input: '+text.split('\n')[0]);
}
p=await plan('Card,Collection ID\nPikachu,123',[{id:123,card:'changed'}]);check(p.copies===0&&p.skipped===1,'numeric/string identity protects an existing saved copy from changes');
p=await plan('Card,Game,Grader,Grade,Certificate\nPikachu,Pokémon,PSA,9,123');check(p.errors.length===0&&p.rows[0].record.grader==='psa','accented game and complete slab metadata');
p=await plan('Card,Quantity\nX,2000',[{id:1}]);check(p.errors.some(e=>e.includes('exceed')),'full collection capacity checked before any writes');
throws(()=>I.readRows('{'),/could not be read/);throws(()=>I.readRows('{}'),/needs attention/);throws(()=>I.readRows('[{"id":1},{"id":"1"}]'),/duplicate IDs/);
const imported=p.rows[0].record;check(imported.currentValue===null && imported.buyPrice===null && imported.condition===null,'no guessed price, cost or condition');
p=await plan('Card,Game,Storage Location,Source SKU\nPikachu,pokemon,Box A / 02,000123');
check(p.rows[0].record.location==='Box A / 02'&&p.rows[0].record.sku==='000123','location and text SKU survive import');
const historyCsv=I.parse('Card,Game\nPikachu,pokemon'),historyMap=I.autoMap(historyCsv.headers);
const originalImport=await I.plan(historyCsv,historyMap,{mode:'skip'},[]);
const historicEntry=originalImport.rows[0].entries[0],historicId='imp_'+historicEntry.importKey.slice(5).replace(/:/g,'_');
const history={flips:[{id:'sale-1',sourceCollectionId:historicId,importKey:historicEntry.importKey}],tombstones:{portfolio:{[historicId]:Date.now()}}};
for(const h of [history,{tombstones:history.tombstones},{flips:history.flips}]){
  const result=await I.plan(historyCsv,historyMap,{mode:'skip'},[],h);
  check(result.copies===0&&result.skipped===1,'recorded sold/deleted copy cannot be resurrected by repeat import');
}
check((await I.plan(historyCsv,historyMap,{mode:'new'},[],history)).copies===1,'explicit new purchase can replace a previously sold printing with a new physical copy');
const withId=I.parse('Card,Game,Collection ID\nPikachu,pokemon,'+historicId);
check((await I.plan(withId,I.autoMap(withId.headers),{mode:'skip'},[],history)).skipped===1,'old CardResell export cannot resurrect a sold identity');
const permanent={copy_sales_v1:{version:1,entries:[{copyId:historicId,saleId:'deleted-report',recordedAt:1}]}};
check((await I.plan(historyCsv,historyMap,{mode:'skip'},[],permanent)).skipped===1,'permanent sold-copy proof survives deleted reports and expired tombstones');
check((await I.plan(withId,I.autoMap(withId.headers),{mode:'skip'},[],permanent)).skipped===1,'explicit exported ID is protected by permanent history');
check((await I.plan(historyCsv,historyMap,{mode:'new'},[],permanent)).copies===1,'a deliberate new purchase may create a new identity for a previously sold printing');
for(const copy_sales_v1 of [{version:2,entries:[]},{version:1,entries:[{copyId:historicId,saleId:'s',recordedAt:0}]},{version:1,entries:[{copyId:historicId,saleId:'a',recordedAt:1},{copyId:historicId,saleId:'b',recordedAt:1}]}]){
 await assert.rejects(()=>I.plan(historyCsv,historyMap,{mode:'skip'},[],{copy_sales_v1}));checks++;
}
await assert.rejects(()=>I.plan(historyCsv,historyMap,{mode:'skip'},[],{tombstones:{portfolio:{bad:'not-a-date'}}}));checks++;
for(const bad of ['[{"id":{}}]','[{"id":[]}]','[{"id":"   "}]'])throws(()=>I.readRows(bad),/needs attention/);

// Exercise the shipped Collection DOM, renderer, import module and save path.
const core=readFileSync(resolveCoreBundle().path,'utf8');
const wanted=new Set(['renderCollectionView','getUserKey','loadPortData','savePortData']);
const coreFunctions=parseJS(core,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&wanted.has(n.id.name)).map(n=>core.slice(n.start,n.end)).join('\n');
const exporter=readFileSync(ROOT+'/js/collection-export.js','utf8');
const fixture=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+`<script>
window.googleUser={sub:'owner'};let writes=0,syncs=0,failWrite=false,toasts=[],signin=0,download='';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function _updateCollectionSignInWall(){}function _crBumpGen(){}function hydrateCollectionSellButtons(){}
function _lsWrite(key,value){if(failWrite)return false;localStorage.setItem(key,value);writes++;return true}
function _scheduleUserDataSync(){syncs++}function loadTombstones(){return {portfolio:{},flips:{}}}
function showToast(text){toasts.push(text)}function triggerGoogleSignIn(){signin++}
HTMLAnchorElement.prototype.click=function(){download=decodeURIComponent(this.href.split(',').slice(1).join(','))};
${coreFunctions}\n${exporter}\n${protections}\n${source}
function seed(rows){localStorage.setItem(getUserKey('portfolio'),JSON.stringify(rows));document.getElementById('collectionView').style.display='block';renderCollectionView()}
seed([]);
</script>`;
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(fixture);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
try {
 for(const width of [390,1280]) {
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1')?r.continue():r.abort());
  await page.goto('http://127.0.0.1:'+server.address().port);
  const open=async()=>{await page.locator('#collectionImportBtn').click();};
  const upload=async(text)=>{await page.locator('#collectionImportDialog input[type=file]').setInputFiles({name:'inventory.csv',mimeType:'text/csv',buffer:Buffer.from(text)});await page.waitForFunction(()=>document.querySelector('[data-import-review]')?.disabled===false);};
  const review=async()=>{await page.locator('[data-import-review]').click();await page.waitForFunction(()=>document.querySelector('[data-import-review]')?.disabled===false);};
  const commit=async()=>{await page.locator('#collectionImportConfirm').check();await page.locator('[data-import-commit]').click();await page.waitForFunction(()=>{const input=document.querySelector('#collectionImportDialog input[type=file]');return !input||!input.disabled;});};
  await open();await upload(sample);await page.getByLabel('Default game',{exact:true}).selectOption('pokemon');await review();
  check(await page.locator('[data-import-status]').textContent().then(s=>s.includes('5 new copies')),'preview shows quantity expansion');
  check((await page.locator('.collection-import-preview').textContent()).includes('Set code: base1'),'seller can review the mapped set code');
  check(await page.evaluate(()=>writes===0&&loadPortData().length===0),'preview has no writes');
  check(await page.locator('[data-import-commit]').isDisabled(),'review confirmation required');
  check(await page.evaluate(()=>{const d=document.querySelector('dialog');return d.scrollWidth<=d.clientWidth+1&&d.getBoundingClientRect().width<=innerWidth;}),'dialog fits '+width+'px');
  await commit();check(await page.evaluate(()=>loadPortData().length===5 && writes===1 && syncs===1),'single save and account sync scheduled');
  check(await page.evaluate(()=>loadPortData().every(p=>p.setCode==='base1')),'saved physical copies retain the reviewed set code');
  check(await page.locator('#colCostSub').textContent().then(s=>s.includes('4 missing')),'unknown cost counted');
  check(await page.locator('#colUnrealized').textContent()==='—','unknown costs or prices never count as profits');
  check((await page.locator('[data-label="Current value"]').allTextContents()).some(s=>s.includes('Price unknown')),'unknown price does not fall back to cost');
  check(await page.evaluate(()=>loadPortData().every(p=>p.valueSource==='import'&&p.id.startsWith('imp_'))),'imports retain estimate provenance and deterministic copy IDs');
  await open();await upload(sample);await page.getByLabel('Default game',{exact:true}).selectOption('pokemon');await review();
  check((await page.locator('[data-import-status]').textContent()).includes('5 existing copies skipped'),'repeat upload skips copies');
  check(await page.locator('[data-import-commit]').isDisabled(),'empty repeated import cannot save');
  await page.getByLabel('Previously imported rows',{exact:true}).selectOption('new');await review();await commit();
  check(await page.evaluate(()=>loadPortData().length===10&&new Set(loadPortData().map(p=>p.id)).size===10),'explicit new purchase batch creates distinct physical IDs');
  // Own exported IDs are round-tripped without multiplying inventory.
  const exported=await page.evaluate(()=>{exportCollection();return download;});
  await open();await upload(exported);await review();check((await page.locator('[data-import-status]').textContent()).includes('10 existing copies skipped'),'CardResell CSV export can be re-imported safely');
  await page.locator('#collectionImportDialog').getByRole('button',{name:'Cancel',exact:true}).click();
  await open();await upload('Card,Game,Quantity,Current Value\n'+quote('<img src=x onerror=alert(1)>')+',pokemon,1,9');await review();
  check(await page.locator('.collection-import-preview img').count()===0,'CSV text never becomes markup');
  // Concurrent change between review and commit requires a new review.
  await page.evaluate(()=>{const rows=loadPortData();rows.push({id:'other-tab',card:'Other'});localStorage.setItem(getUserKey('portfolio'),JSON.stringify(rows));});
  await commit();check((await page.locator('[role=alert]').last().textContent()).includes('history changed'),'stale snapshot cannot overwrite another tab');
  check(await page.evaluate(()=>loadPortData().length===11 && writes===2),'concurrent change survives');
  await review();await page.evaluate(()=>failWrite=true);await commit();check((await page.locator('#collectionImportDialog [role=alert]').textContent()).includes('could not be saved'),'storage failure stays actionable');
  check(await page.evaluate(()=>loadPortData().length===11 && writes===2),'storage failure leaves old inventory intact');
  await page.evaluate(()=>failWrite=false);await commit();check(await page.evaluate(()=>loadPortData().length===12&&writes===3),'failed local save can be retried');
  await open();await upload('Card,Game\nPending,pokemon');await review();
  await page.evaluate(()=>localStorage.setItem(getUserKey('flips'),JSON.stringify([{id:'sale-during-review'}])));await commit();
  check((await page.locator('#collectionImportDialog [role=alert]').textContent()).includes('history changed')&&await page.evaluate(()=>writes===3),'sales history changing after review requires a fresh preview');
  await page.locator('#collectionImportDialog').getByRole('button',{name:'Cancel',exact:true}).click();
  await open();await upload('Card,Game\nNew,pokemon');await review();await page.evaluate(()=>window.googleUser={sub:'different-owner'});await page.waitForFunction(()=>!document.querySelector('#collectionImportDialog'));
  check(await page.evaluate(()=>localStorage.getItem('cardsell_different-owner_portfolio')===null&&writes===3),'account change cancels import before any write');
  await page.evaluate(()=>{googleUser={sub:'owner'};localStorage.setItem(getUserKey('portfolio'),'{broken');});await open();await upload('Card,Game\nNew,pokemon');await review();
  check((await page.locator('#collectionImportDialog [role=alert]').textContent()).includes('could not be read'),'corrupt storage is not treated as an empty collection');
  await page.locator('#collectionImportDialog').getByRole('button',{name:'Cancel',exact:true}).click();await page.evaluate(()=>googleUser=null);await open();check(await page.evaluate(()=>signin===1&&!document.querySelector('#collectionImportDialog')),'signed out import requests sign-in');
  check(errors.length===0,'no uncaught browser errors: '+errors.join('; '));await page.close();
 }
} finally {await browser.close();await new Promise(r=>server.close(r));}
finish(checks,0);
