// Shipped import UI -> real user-data handler -> isolated Redis. Synthetic auth
// and blocked external requests; no customer data or paid provider operations.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {completionGuard} from './_complete.mjs';
import {billingHarness,exact,UID} from './_scanBillingHarness.mjs';
import {redisCommand as redis} from './_idRedis.mjs';
const handler=(await import('../api/user-data.js')).default;
const {finish}=completionGuard('import-history-browser'),h=billingHarness();globalThis.__STUB=exact();
const root=resolve(new URL('..',import.meta.url).pathname),key='userdata:'+UID;let posts=0,checks=0;
const check=(v,m)=>{assert.ok(v,m);checks++;};
const server=createServer(async(req,res)=>{
 if(req.url==='/api/user-data'){
  let text='';for await(const c of req)text+=c;if(req.method==='POST')posts++;
  let code=200,data;await handler({method:req.method,headers:req.headers,body:text?JSON.parse(text):undefined},{setHeader(){},status(n){code=n;return this;},json(d){data=d;return this;},end(){}});
  res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));return;
 }
 const path=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!path.startsWith(root+'/')){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html'})[extname(path)]||'application/octet-stream');res.end(readFileSync(path));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
const empty=()=>({portfolio:[],flips:[],tombstones:{portfolio:{},flips:{}},copySales:{version:1,entries:[]}});
const file='Card,Game,Quantity,Cost Basis,Current Value,Condition,Storage Location,Source SKU\nPikachu,pokemon,2,0,,NM,Box A,0007';
const single='Card,Game\nPikachu,pokemon';
mkdirSync('/tmp/cardresell-import-history-shots',{recursive:true});
try{for(const width of [390,1280]){
 const ctx=await browser.newContext({viewport:{width,height:1000}});await ctx.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base,{waitUntil:'load'});
 async function setup(p=page){await p.evaluate(uid=>{window.googleUser={sub:uid,email:'import@example.test'};window._googleIdToken='x'.repeat(40);window._isPro=true;_cancelUserDataSync();document.querySelectorAll('.view').forEach(n=>n.style.display='none');document.getElementById('collectionView').style.display='block';renderCollectionView();},UID);}
 await setup();
 async function seed(state=empty()){
  await page.waitForFunction(()=>!_userDataSyncing);
  await page.evaluate(()=>{_cancelUserDataSync();document.querySelectorAll('dialog[open]').forEach(n=>n.close());for(const k of ['portfolio','flips','tombstones','copy_sales_v1','sale_recovery_v1','sale_conflict_v1','inventory_conflict_v1','inventory_restore_v1'])localStorage.removeItem(getUserKey(k));for(const [k,v] of Object.entries({portfolio:[],flips:[],tombstones:{portfolio:{},flips:{}},copy_sales_v1:{version:1,entries:[]}}))localStorage.setItem(getUserKey(k),JSON.stringify(v));renderCollectionView();});
  await redis(['SET',key,JSON.stringify(state)]);
 }
 const dlg=(p=page)=>p.locator('#collectionImportDialog'),alert=(p=page)=>dlg(p).getByRole('alert'),status=(p=page)=>dlg(p).getByRole('status');
 async function open(p=page){await p.locator('#collectionImportBtn').click();}
 async function upload(text=file,p=page){await dlg(p).locator('input[type=file]').setInputFiles({name:'inventory.csv',mimeType:'text/csv',buffer:Buffer.from(text)});await p.waitForFunction(()=>document.querySelector('[data-import-review]')?.disabled===false);}
 async function review(p=page){await dlg(p).getByRole('button',{name:'Review import',exact:true}).click();await p.waitForFunction(()=>document.querySelector('[data-import-review]')?.disabled===false);}
 async function prepare(text=file,p=page){await open(p);await upload(text,p);await review(p);}
 async function begin(p=page){await p.locator('#collectionImportConfirm').check();await p.locator('[data-import-commit]').click();}
 async function settled(p=page){await p.waitForFunction(()=>{const input=document.querySelector('#collectionImportDialog input[type=file]');return !input||!input.disabled;});}
 async function commit(p=page){await begin(p);await settled(p);}
 async function close(p=page){await dlg(p).getByRole('button',{name:'Close',exact:true}).click();}
 async function push(){await page.waitForFunction(()=>!_userDataSyncing);await page.evaluate(async()=>{_cancelUserDataSync();await _pushUserData();_cancelUserDataSync();});}
 async function pull(){await page.evaluate(async()=>{_cancelUserDataSync();await _pullUserData();_cancelUserDataSync();});}
 async function holdLock(){await page.evaluate(()=>{window.importLockHeld=false;window.importLock=navigator.locks.request('cardresell:'+getUserKey('sale_recovery_v1'),()=>new Promise(r=>{window.releaseImportLock=r;window.importLockHeld=true;}));});await page.waitForFunction(()=>window.importLockHeld);}
 async function releaseLock(){await page.evaluate(async()=>{window.releaseImportLock();await window.importLock;});}
 await seed();const start=await redis(['GET',key]);await prepare();
 check((await status().textContent()).includes('2 new copies')&&await page.evaluate(()=>loadPortDataRaw().length)===0&&await redis(['GET',key])===start,'review does not mutate device or account inventory');
 await commit();await push();let saved=await page.evaluate(()=>loadPortDataRaw()),stored=JSON.parse(await redis(['GET',key]));
 check(saved.length===2&&stored.portfolio.length===2&&saved.every(r=>r.buyPrice===0&&r.currentValue===null&&r.condition==='NM'&&r.location==='Box A'&&r.sku==='0007'),'reviewed import reaches account with individual IDs and original details');
 const soldId=String(saved[0].id);
 const sale=await page.evaluate(async()=>{const copy=loadPortDataRaw()[0];const result=await CardResellSaleRecovery.commit({copy,sale:{id:'deleted-sale-report',card:copy.card,buyPrice:copy.buyPrice,sellPrice:12,sourceCollectionId:String(copy.id)}});_cancelUserDataSync();return result;});
 check(sale.ok,'actual recoverable sale retires the imported physical copy');await push();
 await page.evaluate(()=>{deleteFlip('deleted-sale-report');_cancelUserDataSync();});await push();stored=JSON.parse(await redis(['GET',key]));
 check(stored.flips.length===0&&stored.copySales.entries.some(r=>r.copyId===soldId),'deleting the actual sale report retains permanent account proof');
 // Simulate old tombstones expiring; permanent sold-copy receipts remain.
 stored.tombstones={portfolio:{[soldId]:1},flips:{'deleted-sale-report':1}};await redis(['SET',key,JSON.stringify(stored)]);
 await page.evaluate(id=>localStorage.setItem(getUserKey('tombstones'),JSON.stringify({portfolio:{[id]:1},flips:{'deleted-sale-report':1}})),soldId);await pull();
 check(await page.evaluate(id=>!loadTombstones().portfolio[id]&&loadFlipsDataRaw().length===0&&JSON.parse(localStorage.getItem(getUserKey('copy_sales_v1'))).entries.some(r=>r.copyId===id),soldId),'cloud sync keeps sold proof after reports and deletion marks disappear');
 const before=posts;await prepare();
 check((await status().textContent()).includes('0 new copies')&&(await status().textContent()).includes('2 existing copies skipped')&&posts===before,'old CSV skips both the sold identity and the remaining saved copy without writes');
 check(await page.locator('[data-import-commit]').isDisabled()&&await page.evaluate(id=>!loadPortDataRaw().some(r=>String(r.id)===id),soldId),'sold copy never reappears locally during repeat import');
 const bounds=await dlg().boundingBox();check(bounds.x>=0&&bounds.x+bounds.width<=width+1,'protected import preview fits '+width+'px');await page.screenshot({path:'/tmp/cardresell-import-history-shots/skipped-'+width+'.png'});
 await upload('Card,Game,Collection ID\nPikachu,pokemon,'+soldId);await review();check((await status().textContent()).includes('0 new copies'),'an exported explicit Collection ID cannot bypass permanent sold proof');
 await upload(file);await page.getByLabel('Previously imported rows',{exact:true}).selectOption('new');await review();await commit();await push();
 stored=JSON.parse(await redis(['GET',key]));check(stored.portfolio.length===3&&!stored.portfolio.some(r=>String(r.id)===soldId)&&stored.copySales.entries.length===1,'explicit new purchases use new physical IDs while sold history stays intact');
 if(width===390){
  await seed();await prepare(single);const id=await page.evaluate(async text=>{const I=CardResellCollectionImport,csv=I.parse(text),p=await I.plan(csv,I.autoMap(csv.headers),{mode:'skip'},[]);return 'imp_'+p.rows[0].entries[0].importKey.slice(5).replace(/:/g,'_');},single);
  const old=await page.evaluate(()=>['portfolio','flips','tombstones','copy_sales_v1'].map(k=>localStorage.getItem(getUserKey(k))));
  await redis(['SET',key,JSON.stringify({...empty(),copySales:{version:1,entries:[{copyId:id,saleId:'remote-sold',recordedAt:Date.now()}]}})]);await pull();
  const current=await page.evaluate(()=>['portfolio','flips','tombstones','copy_sales_v1'].map(k=>localStorage.getItem(getUserKey(k))));
  check(old.slice(0,3).every((v,i)=>v===current[i])&&old[3]!==current[3],'actual account pull can change only sold-copy proof after preview');
  const prior=posts;await commit();check((await alert().textContent()).includes('history changed')&&await page.evaluate(()=>loadPortDataRaw().length)===0&&posts===prior,'new permanent proof invalidates stale preview before local or account writes');
  await review();check((await status().textContent()).includes('0 new copies'),'fresh preview observes the newly received sale');
  for(const [journal,place] of [['sale_recovery_v1','saved sale'],['sale_conflict_v1','Review sale sync'],['inventory_conflict_v1','Review inventory sync'],['inventory_restore_v1','Recover inventory']]){
   await seed();const value=JSON.stringify({version:1,marker:'keep original request'});await page.evaluate(([k,v])=>localStorage.setItem(getUserKey(k),v),[journal,value]);const before=posts;await prepare(single);
   check((await alert().textContent()).includes(place)&&await page.locator('[data-import-commit]').isDisabled()&&posts===before&&await page.evaluate(k=>localStorage.getItem(getUserKey(k)),journal)===value,'unfinished '+journal+' blocks import without altering saved work');
  }
  await seed();await prepare(single);await page.evaluate(()=>localStorage.setItem(getUserKey('inventory_restore_v1'),JSON.stringify({version:1,marker:'new saved recovery'})));await commit();
  check((await alert().textContent()).includes('history changed')&&await page.evaluate(()=>loadPortDataRaw().length)===0,'a recovery started after preview invalidates the import');await review();check((await alert().textContent()).includes('Recover inventory'),'fresh preview names the unfinished recovery');
  for(const [kind,value] of [['copy_sales_v1','{broken'],['copy_sales_v1',JSON.stringify({version:9,entries:[]})],['copy_sales_v1',JSON.stringify({version:1,entries:[{copyId:id,saleId:'a',recordedAt:1},{copyId:id,saleId:'b',recordedAt:1}]})],['inventory_restore_v1','{broken'],['tombstones','null'],['tombstones',JSON.stringify({portfolio:{x:'bad-date'}})]]){
   await seed();await page.evaluate(([k,v])=>localStorage.setItem(getUserKey(k),v),[kind,value]);await prepare(single);
   check((await alert().textContent()).length>0&&await page.locator('[data-import-commit]').isDisabled()&&await page.evaluate(k=>localStorage.getItem(getUserKey(k)),kind)===value&&await page.evaluate(()=>loadPortDataRaw().length)===0,'unreadable or conflicting '+kind+' is preserved and blocks import');
  }
  await seed();await prepare(single);await page.evaluate(()=>{window.realImportLocks=navigator.locks;Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});});await commit();
  check((await alert().textContent()).includes('Update your browser')&&await page.evaluate(()=>loadPortDataRaw().length)===0,'unsupported cross-tab locking fails before any import save');await page.evaluate(()=>Object.defineProperty(navigator,'locks',{value:window.realImportLocks,configurable:true}));
  const other=await ctx.newPage();other.on('pageerror',e=>errors.push(e.message));await other.goto(base,{waitUntil:'load'});await setup(other);
  await seed();await prepare('Card,Game\nFirst tab,pokemon');await prepare('Card,Game\nSecond tab,pokemon',other);await holdLock();await begin();await begin(other);
  check(await dlg().locator('input[type=file]').isDisabled()&&await dlg(other).locator('input[type=file]').isDisabled(),'both imports wait behind the shared sale/recovery lock');await page.keyboard.press('Escape');check(await dlg().isVisible(),'Escape cannot discard a commit while it waits for the lock');
  await releaseLock();await settled();await settled(other);
  check(await dlg().count()===0&&(await alert(other).textContent()).includes('history changed')&&await page.evaluate(()=>loadPortDataRaw().length===1&&loadPortDataRaw()[0].card==='First tab'),'first import wins; stale second tab cannot overwrite it');
  await review(other);await commit(other);check(await page.evaluate(()=>loadPortDataRaw().length===2&&new Set(loadPortDataRaw().map(r=>r.card)).size===2),'second tab can review again and preserve both imports');await other.evaluate(()=>_cancelUserDataSync());await push();
  check(JSON.parse(await redis(['GET',key])).portfolio.length===2,'both reviewed tab imports reach the actual account');
  await seed();await prepare(single);await holdLock();await begin();await other.evaluate(id=>localStorage.setItem(getUserKey('copy_sales_v1'),JSON.stringify({version:1,entries:[{copyId:id,saleId:'while-waiting',recordedAt:1}]})),id);await releaseLock();await settled();
  check((await alert().textContent()).includes('history changed')&&await page.evaluate(()=>loadPortDataRaw().length)===0,'sold proof arriving while a commit waits is checked inside the lock');
  await seed();await prepare(single);await holdLock();await begin();await page.evaluate(()=>{window.googleUser={sub:'another-owner'};localStorage.setItem(getUserKey('portfolio'),JSON.stringify([{id:'other-owner-copy',card:'Preserve me'}]));});await releaseLock();await page.waitForFunction(()=>!document.querySelector('#collectionImportDialog'));
  check(await page.evaluate(uid=>JSON.parse(localStorage.getItem('cardsell_'+uid+'_portfolio')).length===0&&loadPortDataRaw()[0].id==='other-owner-copy',UID),'owner change while queued cannot write to either account');await setup();await other.evaluate(()=>{_cancelUserDataSync();window._googleIdToken=null;});await other.close();
 }
 check(errors.length===0,'no uncaught browser errors: '+errors.join('; '));await page.evaluate(()=>{_cancelUserDataSync();window._googleIdToken=null;});await ctx.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));h.restore();}
finish(checks,0);
