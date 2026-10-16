// Shipped Collection UI -> real authenticated handler -> isolated Redis CAS.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {completionGuard} from './_complete.mjs';
import {billingHarness,exact,UID} from './_scanBillingHarness.mjs';
import {redisCommand as redis} from './_idRedis.mjs';
import {editInventory} from '../api/_inventoryEdits.js';
const handler=(await import('../api/user-data.js')).default;
const {finish}=completionGuard('inventory-details-browser'),h=billingHarness();globalThis.__STUB=exact();
const root=resolve(new URL('..',import.meta.url).pathname),key='userdata:'+UID;let calls=0,hold=false,release;
const server=createServer(async(req,res)=>{
 if(req.url==='/api/user-data'){
  let text='';for await(const c of req)text+=c;const body=text?JSON.parse(text):undefined,isChoice=body?.action==='resolve_inventory';if(isChoice)calls++;
  let code=200,data;await handler({method:req.method,headers:req.headers,body},{setHeader(){},status(n){code=n;return this;},json(d){data=d;return this;},end(){}});
  if(isChoice&&hold){hold=false;await new Promise(r=>release=r);}
  res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));return;
 }
 const path=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
 if(!path.startsWith(root+'/')){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html'})[extname(path)]||'application/octet-stream');res.end(readFileSync(path));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});let count=0;
const check=(v,m)=>{assert.ok(v,m);count++;};
const original={id:7,quantity:1,card:'Review card',set:'Test Set',number:'7',grader:'PSA',grade:'9',buyPrice:40,location:'Box A',sku:'Source A',addedDate:'Legacy date',currentValue:90,costMeta:{buyPrice:'value'}};
const edit=(row,patch)=>editInventory(row,patch,'ie_'+randomUUID());
const account=edit(original,{buyPrice:5}),device={...edit(original,{buyPrice:20,location:'<img src=x onerror=alert(1)>'}),id:'7'};
const other={...original,id:'copy-2',card:'Other copy',sku:'Keep SKU'};
mkdirSync('/tmp/cardresell-inventory-shots',{recursive:true});
try{for(const width of [390,1280]){
 const ctx=await browser.newContext({viewport:{width,height:1100}});await ctx.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base,{waitUntil:'load'});
 const setup=async(token=null)=>page.evaluate(({uid,token})=>{window.googleUser={sub:uid};window._googleIdToken=token;_cancelUserDataSync();document.querySelectorAll('.view').forEach(e=>e.style.display='none');document.getElementById('collectionView').style.display='block';window.originalWrite=window.originalWrite||_lsWrite;window._lsWrite=originalWrite;renderCollectionView();},{uid:UID,token});
 await setup();
 async function localSeed(port){await page.evaluate(port=>{_cancelUserDataSync();window._lsWrite=originalWrite;for(const suffix of ['portfolio','flips','tombstones','copy_sales_v1','sale_recovery_v1','inventory_conflict_v1','sale_conflict_v1'])localStorage.removeItem(getUserKey(suffix));localStorage.setItem(getUserKey('portfolio'),JSON.stringify(port));document.querySelectorAll('dialog[open]').forEach(n=>n.close());renderCollectionView();},port);}
 async function cloudSeed(port=[account]){await redis(['SET',key,JSON.stringify({portfolio:[...port,{id:'untouched',card:'Keep'}],flips:[],tombstones:{},serverUpdatedAt:Date.now()})]);}
 const editor=()=>page.locator('#inventoryDetailsDialog');
 const openDetails=async()=>page.locator('tr[data-entry-id="7"]').getByRole('button',{name:'Inventory details',exact:true}).click();
 const input=name=>editor().locator('input[name="'+name+'"]');
 const saveDetails=async()=>{await editor().getByRole('button',{name:'Save details',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('inventoryDetailsDialog').open);};
 await localSeed([original,other]);await openDetails();
 check(await editor().getByRole('button',{name:'Save details',exact:true}).isDisabled(),'opening editor does not create an edit');
 check(await input('addedDate').inputValue()==='Legacy date','legacy acquisition text preserved until explicitly edited');
 await input('buyPrice').fill('0');await input('location').fill('Shelf 2 · Slot 4');await saveDetails();
 let local=await page.evaluate(()=>loadPortDataRaw());
 check(local[0].buyPrice===0&&local[0].costMeta.buyPrice==='zero'&&local[0].location==='Shelf 2 · Slot 4','explicit zero and location saved through UI');
 check(local[0].addedDate==='Legacy date'&&local[0].id===7&&local[0].grader==='PSA','untouched legacy date and physical identity preserved');
 await openDetails();await input('buyPrice').fill('1.001');await editor().getByRole('button',{name:'Save details',exact:true}).click();
 check((await editor().getByRole('status').textContent()).includes('two decimal')&&await page.evaluate(()=>loadPortDataRaw()[0].buyPrice)===0,'invalid cost leaves record unchanged and form open');
 await input('buyPrice').fill('');await input('addedDate').fill('2026-10-05');await input('sku').fill('=source, "one"');await saveDetails();
 local=await page.evaluate(()=>loadPortDataRaw());check(local[0].buyPrice===null&&local[0].costMeta.buyPrice==='blank'&&local[0].addedDate==='2026-10-05','blank cost stays unknown while valid acquisition date saves');
 await page.reload({waitUntil:'load'});await setup();check(await page.evaluate(()=>loadPortDataRaw()[0].sku)==='=source, "one"','edited details survive actual reload');
 await page.getByRole('button',{name:'Select visible',exact:true}).click();await page.getByRole('searchbox',{name:'Search collection',exact:true}).fill('Review');
 check((await page.locator('[data-count]').textContent()).includes('1 selected outside this filter'),'selection discloses hidden copy');
 await page.getByRole('button',{name:'Set location',exact:true}).click();
 check((await editor().textContent()).includes('Other copy')&&await editor().getByRole('button',{name:'Save location',exact:true}).isDisabled(),'bulk review lists hidden selected copy and requires action');
 await input('location').fill('Box Z');check(await editor().getByRole('button',{name:'Save location',exact:true}).isDisabled(),'bulk move requires explicit confirmation');
 await editor().getByRole('checkbox').check();await page.screenshot({path:'/tmp/cardresell-inventory-shots/editor-'+width+'.png'});
 const box=await editor().boundingBox();check(box.x>=0&&box.x+box.width<=width+1,'editor fits mobile and desktop');
 await editor().getByRole('button',{name:'Save location',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('inventoryDetailsDialog').open);
 local=await page.evaluate(()=>loadPortDataRaw());check(local.every(r=>r.location==='Box Z')&&local[1].sku==='Keep SKU','bulk move updates all selected locations without changing other details');
 if(width===390){
  await page.getByRole('button',{name:'Set location',exact:true}).click();await input('location').fill('Stale move');await editor().getByRole('checkbox').check();
  await page.evaluate(()=>{const p=loadPortDataRaw();p[1].location='Changed elsewhere';localStorage.setItem(getUserKey('portfolio'),JSON.stringify(p));});
  await editor().getByRole('button',{name:'Save location',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#inventoryDetailsDialog [role=status]').textContent.includes('No details were changed'));check((await editor().getByRole('status').textContent()).includes('No details were changed'),'batch refuses any stale target');
  local=await page.evaluate(()=>loadPortDataRaw());check(local[0].location==='Box Z'&&local[1].location==='Changed elsewhere','stale batch is all-or-nothing');await editor().getByRole('button',{name:'Cancel',exact:true}).click();
  await openDetails();await input('location').fill('Keep entered value');await page.evaluate(()=>{window._lsWrite=(k,v)=>k===getUserKey('portfolio')?false:originalWrite(k,v);});
  await editor().getByRole('button',{name:'Save details',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#inventoryDetailsDialog [role=status]').textContent.includes('could not save'));check((await editor().getByRole('status').textContent()).includes('could not save')&&await input('location').inputValue()==='Keep entered value','storage failure retains entered changes');
  check(await page.evaluate(()=>loadPortDataRaw()[0].location)==='Box Z','failed write does not claim new location saved');await page.evaluate(()=>{window._lsWrite=originalWrite;});await saveDetails();
  await openDetails();await input('location').fill('Wrong owner');await page.evaluate(()=>{window.googleUser={sub:'another-owner'};localStorage.setItem(getUserKey('portfolio'),JSON.stringify([{id:'other-owner'}]));});
  await page.waitForFunction(()=>document.querySelector('#inventoryDetailsDialog [role=status]').textContent.includes('Account changed'));
  check(await page.evaluate(()=>loadPortDataRaw()[0].id)==='other-owner','account change cannot write into another inventory');await editor().getByRole('button',{name:'Cancel',exact:true}).click();await setup();
  await localSeed([edit(original,{buyPrice:0})]);await cloudSeed([edit(original,{location:'Cloud shelf'})]);await setup('x'.repeat(40));
  await page.evaluate(async()=>{await _pushUserData();_cancelUserDataSync();});local=await page.evaluate(()=>loadPortDataRaw());let cloud=JSON.parse(await redis(['GET',key]));
  check(local[0].buyPrice===0&&local[0].location==='Cloud shelf'&&cloud.portfolio[0].buyPrice===0,'push acknowledgement combines independent browser and account fields');
  await page.evaluate(row=>{localStorage.setItem(getUserKey('portfolio'),JSON.stringify([row]));},original);await page.evaluate(async()=>{await _pullUserData();_cancelUserDataSync();});
  check(await page.evaluate(()=>loadPortDataRaw()[0].buyPrice)===0,'real API pull preserves protected cost against legacy device baseline');
  await localSeed([{...edit(original,{location:'Late edit'}),updatedAt:Date.now()+5000}]);await redis(['SET',key,JSON.stringify({portfolio:[],flips:[],tombstones:{portfolio:{7:Date.now()}},serverUpdatedAt:Date.now()})]);await page.evaluate(async()=>{await _pushUserData();_cancelUserDataSync();});check(await page.evaluate(()=>loadPortDataRaw().length)===0&&JSON.parse(await redis(['GET',key])).portfolio.length===0,'late offline edit cannot restore a deleted copy through real push');
  await page.evaluate(()=>localStorage.setItem(getUserKey('portfolio'),'{broken'));await page.evaluate(async()=>{await _pullUserData();_cancelUserDataSync();});
  check(await page.evaluate(()=>localStorage.getItem(getUserKey('portfolio')))==='{broken','corrupt local inventory is not overwritten by pull');
 }
 async function seedConflict(){await localSeed([device,other]);await cloudSeed();await setup('x'.repeat(40));}
 const openReview=async()=>{await page.getByRole('button',{name:'Review inventory sync',exact:true}).filter({visible:true}).click();await page.waitForFunction(()=>{const t=document.querySelector('#inventoryConflictDialog [role=status]')?.textContent;return t&&!t.includes('Reading saved account');});};
 const status=()=>page.locator('#inventoryConflictDialog [role=status]');
 const choose=async(which)=>{await page.getByRole('radio',{name:which==='device'?'Use this device':'Use saved account',exact:true}).check();await page.getByRole('button',{name:'Use selected version',exact:true}).click();};
 const done=async()=>page.waitForFunction(()=>document.querySelector('#inventoryConflictDialog [role=status]')?.textContent.includes('Inventory choice saved.'));
 await seedConflict();const conflictNotice=await page.evaluate(async()=>{await _pushUserData();const notice=document.getElementById('collectionSyncStatus').textContent;_cancelUserDataSync();return notice;});check(conflictNotice.includes('Review inventory sync'),'conflicting push points seller to explicit review');
 await openReview();check(await page.getByRole('button',{name:'Use selected version',exact:true}).isDisabled()&&await page.getByRole('radio',{checked:true}).count()===0,'review never preselects a version');
 check((await status().textContent()).includes('1 inventory conflict'),'conflict count shown');
 check((await page.locator('.inventory-conflict-version').first().textContent()).includes('$20.00')&&(await page.locator('.inventory-conflict-version').last().textContent()).includes('$5.00'),'both purchase costs shown');
 check(await page.locator('.inventory-conflict-item img').count()===0,'saved location displayed as text, not executable markup');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery backup',exact:true}).click();const backup=JSON.parse(readFileSync(await(await download).path(),'utf8'));
 check(backup.local.portfolio[0].buyPrice===20&&backup.account.portfolio[0].buyPrice===5&&!JSON.stringify(backup).includes('x'.repeat(40)),'backup includes both originals without auth token');
 const reviewBox=await page.locator('#inventoryConflictDialog').boundingBox();check(reviewBox.x>=0&&reviewBox.x+reviewBox.width<=width+1,'conflict chooser fits mobile and desktop');await page.screenshot({path:'/tmp/cardresell-inventory-shots/review-'+width+'.png'});
 await choose(width===390?'device':'account');await done();local=await page.evaluate(()=>loadPortDataRaw());let saved=JSON.parse(await redis(['GET',key]));
 check(local[0].buyPrice===(width===390?20:5)&&saved.portfolio[0].buyPrice===local[0].buyPrice,'explicit choice reaches browser and real stored account');
 check(local[0].id===7&&local[0].location===device.location&&local[1].id==='copy-2','choice preserves canonical identity, independent edit and unrelated copy');
 check(saved.inventoryResolutions.length===1&&await page.evaluate(()=>!CardResellInventoryConflicts.pending()),'successful choice archives originals and clears journal');
 if(width===390){
  await seedConflict();await openReview();const before=calls;await page.evaluate(()=>{window._lsWrite=(k,v)=>k===getUserKey('inventory_conflict_v1')?false:originalWrite(k,v);});await choose('device');await page.waitForFunction(()=>document.querySelector('#inventoryConflictDialog [role=status]').textContent.includes('could not save'));
  check(calls===before&&await page.evaluate(()=>loadPortDataRaw()[0].buyPrice)===20,'failed journal prevents server mutation');
  await seedConflict();await openReview();let record=JSON.parse(await redis(['GET',key]));record.portfolio[0]=edit(account,{buyPrice:11});await redis(['SET',key,JSON.stringify(record)]);await choose('device');await page.waitForFunction(()=>document.querySelector('#inventoryConflictDialog [role=status]').textContent.includes('after review'));
  check(JSON.parse(await redis(['GET',key])).portfolio[0].buyPrice===11&&await page.evaluate(()=>loadPortDataRaw()[0].buyPrice)===20,'stale server review leaves both versions unchanged');
  await page.getByRole('button',{name:'Refresh review',exact:true}).click();await page.getByRole('radio',{name:'Use saved account',exact:true}).waitFor();await choose('account');await done();check(await page.evaluate(()=>loadPortDataRaw()[0].buyPrice)===11,'fresh review can explicitly accept newer account cost');
  await seedConflict();await openReview();const prior=calls;await page.evaluate(()=>{const p=loadPortDataRaw();p[0]=CardResellInventoryEdits.editInventory(p[0],{buyPrice:21},'ie_'+crypto.randomUUID());localStorage.setItem(getUserKey('portfolio'),JSON.stringify(p));});await choose('account');await page.waitForFunction(()=>document.querySelector('#inventoryConflictDialog [role=status]').textContent.includes('device’s inventory changed'));check(calls===prior,'stale local review refused before network write');
  await seedConflict();await openReview();await page.evaluate(()=>{const real=window.fetch;window.fetch=async(...args)=>{const response=await real(...args);if(args[1]?.body&&JSON.parse(args[1].body).action==='resolve_inventory'){window.fetch=real;throw TypeError('Interrupted after server response');}return response;};});await choose('account');await page.getByRole('button',{name:'Resume saved choice',exact:true}).waitFor();
  const interrupted=await page.evaluate(()=>JSON.parse(localStorage.getItem(getUserKey('inventory_conflict_v1'))));check(!interrupted.confirmed&&JSON.parse(await redis(['GET',key])).inventoryResolutions.length===1,'lost acknowledgement preserves durable request');
  const savedId=interrupted.request.resolutionId,afterDrop=calls;await page.evaluate(async()=>{await _pushUserData();await _pullUserData();});check(calls===afterDrop&&await page.evaluate(()=>loadPortDataRaw()[0].buyPrice)===20,'background sync pauses during unfinished choice');
  await page.reload({waitUntil:'load'});await setup('x'.repeat(40));await openReview();await page.getByRole('button',{name:'Resume saved choice',exact:true}).click();await done();record=JSON.parse(await redis(['GET',key]));check(record.inventoryResolutions.length===1&&record.inventoryResolutions[0].request.resolutionId===savedId&&await page.evaluate(()=>loadPortDataRaw()[0].buyPrice)===5,'reload and resume use same receipt without duplicate mutation');
  await seedConflict();await openReview();await page.evaluate(()=>{window._lsWrite=(k,v)=>k===getUserKey('portfolio')?false:originalWrite(k,v);});await choose('account');await page.getByRole('button',{name:'Resume saved choice',exact:true}).waitFor();check(await page.evaluate(()=>!!JSON.parse(localStorage.getItem(getUserKey('inventory_conflict_v1'))).confirmed),'failed local save retains confirmed receipt');
  const confirmedCalls=calls;await page.evaluate(()=>{window._lsWrite=originalWrite;});await page.getByRole('button',{name:'Resume saved choice',exact:true}).click();await done();check(calls===confirmedCalls&&await page.evaluate(()=>loadPortDataRaw()[0].buyPrice)===5,'confirmed local recovery does not repeat server mutation');
  await seedConflict();await openReview();hold=true;release=null;await choose('account');while(!release)await new Promise(r=>setImmediate(r));
  await page.evaluate(()=>{const p=loadPortDataRaw();p[0]=CardResellInventoryEdits.editInventory(p[0],{buyPrice:22},'ie_'+crypto.randomUUID());localStorage.setItem(getUserKey('portfolio'),JSON.stringify(p));});release();await page.waitForFunction(()=>document.querySelector('#inventoryConflictDialog [role=status]').textContent.includes('device changed meanwhile'));check(await page.evaluate(()=>loadPortDataRaw()[0].buyPrice)===22,'late local edits survive a confirmed account choice');
  await seedConflict();await openReview();hold=true;release=null;await choose('account');while(!release)await new Promise(r=>setImmediate(r));
  await page.evaluate(()=>localStorage.setItem(getUserKey('flips'),JSON.stringify([{id:'sold-7',sourceCollectionId:'7'}])));release();await page.waitForFunction(()=>document.querySelector('#inventoryConflictDialog [role=status]').textContent.includes('device changed meanwhile'));check(await page.evaluate(()=>loadPortData().every(r=>String(r.id)!=='7')),'late sale cannot be restored by inventory response');
  await page.evaluate(async()=>{await _pushUserData();_cancelUserDataSync();});record=JSON.parse(await redis(['GET',key]));check(record.portfolio.every(r=>String(r.id)!=='7')&&record.copySales.entries[0].copyId==='7','late sale reaches real API without inventory conflict or restocking');
  await seedConflict();await openReview();hold=true;release=null;await choose('account');while(!release)await new Promise(r=>setImmediate(r));
  await page.evaluate(()=>{window.googleUser={sub:'different-account'};localStorage.setItem(getUserKey('portfolio'),JSON.stringify([{id:'other-owner'}]));});release();await page.waitForFunction(()=>document.querySelector('#inventoryConflictDialog [role=status]').textContent.includes('Account changed'));check(await page.evaluate(()=>loadPortDataRaw()[0].id)==='other-owner','late account response stays isolated from new owner');
  await setup('x'.repeat(40));await page.evaluate(()=>document.getElementById('inventoryConflictDialog').close());await openReview();await page.getByRole('button',{name:'Resume saved choice',exact:true}).click();await done();check(await page.evaluate(()=>loadPortDataRaw()[0].buyPrice)===5,'original owner can resume saved choice');
  await seedConflict();await page.evaluate(()=>localStorage.setItem(getUserKey('inventory_conflict_v1'),'{broken'));await openReview();check((await status().textContent()).includes('could not be read')&&await page.evaluate(()=>CardResellInventoryConflicts.pending()),'corrupt journal preserved and blocks sync');
  const rawDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery backup',exact:true}).click();const raw=JSON.parse(readFileSync(await(await rawDownload).path(),'utf8'));check(raw.local.inventory_conflict_v1.unreadableRaw==='{broken','backup retains corrupt recovery bytes');
 }
 check(errors.length===0,'no uncaught browser errors: '+errors.join('; '));await page.evaluate(()=>{_cancelUserDataSync();window._googleIdToken=null;});await ctx.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));h.restore();}
finish(count,0);
