// Shipped browser UI → actual user-data handler → isolated Redis CAS. Auth is
// stubbed; no customer account, marketplace call or paid operation is used.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {completionGuard} from './_complete.mjs';
import {billingHarness,exact,UID} from './_scanBillingHarness.mjs';
import {redisCommand as redis} from './_idRedis.mjs';
import {correctSale} from '../api/_saleCorrections.js';
const handler=(await import('../api/user-data.js')).default;
const {finish}=completionGuard('sale-conflicts-browser'),h=billingHarness();globalThis.__STUB=exact();
const root=resolve(new URL('..',import.meta.url).pathname),key='userdata:'+UID;
let calls=0,drop=false,hold=false,release;
const server=createServer(async(req,res)=>{
 if(req.url==='/api/user-data'){
  let text='';for await(const chunk of req)text+=chunk;
  const body=text?JSON.parse(text):undefined,isChoice=body?.action==='resolve_sale';if(isChoice)calls++;
  let code=200,data;await handler({method:req.method,headers:req.headers,body},{setHeader(){},status(n){code=n;return this;},json(d){data=d;return this;},end(){}});
  if(isChoice&&hold){hold=false;await new Promise(r=>release=r);}
  if(isChoice&&drop){drop=false;res.destroy();return;}
  res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));return;
 }
 const path=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
 if(!path.startsWith(root+'/')){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html'})[extname(path)]||'application/octet-stream');res.end(readFileSync(path));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});let count=0;
const check=(v,m)=>{assert.ok(v,m);count++;};
const original={id:'sale-1',sourceCollectionId:'sold-copy',card:'Review card',date:'2026-10-01',sellPrice:100,buyPrice:40,fees:10,shippingCost:5,gradingCost:0,refundAmount:0,otherExpenses:0,costMeta:{buyPrice:'value',fees:'value',shippingCost:'value',gradingCost:'zero',refundAmount:'zero',otherExpenses:'zero'}};
const edit=(row,n)=>correctSale(row,{...row,refundAmount:n,costMeta:{...row.costMeta,refundAmount:n?'value':'zero'}},'sc_'+randomUUID());
const account=edit(original,5),device={...edit(original,20),expenseNote:'<img src=x onerror=alert(1)>'};
mkdirSync('/tmp/cardresell-conflict-shots',{recursive:true});
try{for(const width of [390,1280]){
 const ctx=await browser.newContext({viewport:{width,height:1100}});
 await ctx.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
 const page=await ctx.newPage();await page.goto(base,{waitUntil:'load'});
 const setup=async()=>page.evaluate(uid=>{window.googleUser={sub:uid};window._googleIdToken='x'.repeat(40);_cancelUserDataSync();document.querySelectorAll('.view').forEach(e=>e.style.display='none');document.getElementById('flipsView').style.display='block';window.originalWrite=window.originalWrite||_lsWrite;window._lsWrite=originalWrite;renderFlipsView();},UID);
 await setup();
 async function seed(){
  await page.evaluate(()=>{_cancelUserDataSync();document.getElementById('saleConflictDialog')?.close();window._lsWrite=originalWrite;});
  await redis(['SET',key,JSON.stringify({portfolio:[{id:'untouched'}],flips:[account],tombstones:{},serverUpdatedAt:Date.now()})]);
  await page.evaluate(device=>{localStorage.setItem(getUserKey('flips'),JSON.stringify([device,{id:'unrelated-sale',card:'Keep this',sellPrice:3}]));localStorage.setItem(getUserKey('portfolio'),JSON.stringify([{id:'local-copy'}]));localStorage.removeItem(getUserKey('sale_conflict_v1'));renderFlipsView();},device);
 }
 const open=async()=>{const tools=page.locator('#flipSyncTools');if(!await tools.evaluate(e=>e.open))await tools.locator('summary').click();await tools.getByRole('button',{name:'Review sale sync',exact:true}).click();await page.waitForFunction(()=>{const t=document.querySelector('#saleConflictDialog [role=status]')?.textContent;return t&&!t.includes('Reading saved account');});};
 const status=()=>page.locator('#saleConflictDialog [role=status]');
 const choose=async(which)=>{await page.getByRole('radio',{name:which==='device'?'Use this device':'Use saved account',exact:true}).check();await page.getByRole('button',{name:'Use selected version',exact:true}).click();};
 const done=async()=>page.waitForFunction(()=>document.querySelector('#saleConflictDialog [role=status]')?.textContent.includes('Sale choice saved.'));
 await seed();await open();
 check(await page.getByRole('button',{name:'Use selected version',exact:true}).isDisabled(),'no version is preselected');
 check(await page.getByRole('radio',{checked:true}).count()===0,'review requires an explicit choice');
 check((await status().textContent()).includes('1 sale conflict'),'conflict count displayed');
 check((await page.locator('.sale-conflict-version').first().textContent()).includes('$25.00')&&(await page.locator('.sale-conflict-version').last().textContent()).includes('$40.00'),'both profit outcomes shown');
 check(await page.locator('.sale-conflict-item img').count()===0,'stored note rendered as text, not executable markup');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery backup',exact:true}).click();const backup=JSON.parse(readFileSync(await(await download).path(),'utf8'));
 check(backup.local.flips[0].refundAmount===20&&backup.account.flips[0].refundAmount===5,'backup preserves both complete originals');
 check(!JSON.stringify(backup).includes('x'.repeat(40)),'backup excludes authentication token');
 const box=await page.locator('#saleConflictDialog').boundingBox();check(box.x>=0&&box.x+box.width<=width+1,'review fits mobile and desktop');
 await page.screenshot({path:'/tmp/cardresell-conflict-shots/review-'+width+'.png'});
 await choose(width===390?'device':'account');await done();
 const local=await page.evaluate(()=>loadFlipsDataRaw()),saved=JSON.parse(await redis(['GET',key]));
 check(local[0].refundAmount===(width===390?20:5)&&saved.flips[0].refundAmount===local[0].refundAmount,'chosen accounting values saved on device and account');
 check(local[0].sourceCollectionId==='sold-copy'&&local[1].id==='unrelated-sale','sale identity and unrelated local changes retained');
 check(saved.saleResolutions.length===1&&saved.copySales.entries[0].copyId==='sold-copy','account archive and sold identity retained');
 check(await page.evaluate(()=>!CardResellSaleConflicts.pending()),'successful choice clears journal');
 if(width===390){
  await seed();await open();const before=calls;await page.evaluate(()=>{window._lsWrite=(k,v)=>k===getUserKey('sale_conflict_v1')?false:originalWrite(k,v);});
  await choose('device');await page.waitForFunction(()=>document.querySelector('#saleConflictDialog [role=status]').textContent.includes('could not save'));
  check(calls===before&&await page.evaluate(()=>loadFlipsDataRaw()[0].refundAmount)===20,'failed initial journal prevents all network mutations');
  await seed();await open();let record=JSON.parse(await redis(['GET',key]));record.flips[0]=edit(account,11);await redis(['SET',key,JSON.stringify(record)]);
  await choose('device');await page.waitForFunction(()=>document.querySelector('#saleConflictDialog [role=status]').textContent.includes('changed after this review'));
  check((await status().textContent()).includes('changed after this review'),'server stale-review failure explained');
  check(JSON.parse(await redis(['GET',key])).flips[0].refundAmount===11&&await page.evaluate(()=>loadFlipsDataRaw()[0].refundAmount)===20,'stale choice leaves both amounts unchanged');
  await page.getByRole('button',{name:'Refresh review',exact:true}).click();await page.getByRole('radio',{name:'Use saved account',exact:true}).waitFor();await choose('account');await done();
  check(await page.evaluate(()=>loadFlipsDataRaw()[0].refundAmount)===11,'refreshed account version requires a new explicit choice');
  await seed();await open();const prior=calls;await page.evaluate(()=>{const f=loadFlipsDataRaw();f[0]=CardResellSaleCorrections.correctSale(f[0],{...f[0],refundAmount:21},'sc_'+crypto.randomUUID());localStorage.setItem(getUserKey('flips'),JSON.stringify(f));});
  await choose('account');await page.waitForFunction(()=>document.querySelector('#saleConflictDialog [role=status]').textContent.includes('device’s sale changed'));
  check(calls===prior&&await page.evaluate(()=>loadFlipsDataRaw()[0].refundAmount)===21,'changed local row refuses stale choice before POST');
  await seed();await open();await page.evaluate(()=>{const real=window.fetch;window.fetch=async(...args)=>{const response=await real(...args);if(args[1]?.body&&JSON.parse(args[1].body).action==='resolve_sale'){window.fetch=real;throw TypeError('Interrupted after the server response');}return response;};});await choose('account');await page.getByRole('button',{name:'Resume saved choice',exact:true}).waitFor();
  const interrupted=await page.evaluate(()=>JSON.parse(localStorage.getItem(getUserKey('sale_conflict_v1'))));
  check(interrupted.request.choice==='account'&&!interrupted.confirmed&&JSON.parse(await redis(['GET',key])).saleResolutions.length===1,'lost acknowledgement preserves durable request');
  const savedId=interrupted.request.resolutionId,afterDrop=calls;
  await page.evaluate(async()=>{await _pushUserData();await _pullUserData();});
  check(calls===afterDrop&&await page.evaluate(()=>loadFlipsDataRaw()[0].refundAmount)===20,'background sync pauses while choice is unresolved');
  await page.reload({waitUntil:'load'});await setup();await open();await page.getByRole('button',{name:'Resume saved choice',exact:true}).click();await done();
  record=JSON.parse(await redis(['GET',key]));check(record.saleResolutions.length===1&&record.saleResolutions[0].request.resolutionId===savedId,'reload/resume reuses original request without duplicate archive');
  check(await page.evaluate(()=>loadFlipsDataRaw()[0].refundAmount)===5,'resumed account choice reaches local record');
  await seed();await open();await page.evaluate(()=>{window._lsWrite=(k,v)=>k===getUserKey('flips')?false:originalWrite(k,v);});await choose('account');await page.getByRole('button',{name:'Resume saved choice',exact:true}).waitFor();
  check(await page.evaluate(()=>!!JSON.parse(localStorage.getItem(getUserKey('sale_conflict_v1'))).confirmed),'failed local save retains confirmed receipt');
  const confirmedCalls=calls;await page.evaluate(()=>{window._lsWrite=originalWrite;});await page.getByRole('button',{name:'Resume saved choice',exact:true}).click();await done();
  check(calls===confirmedCalls&&await page.evaluate(()=>loadFlipsDataRaw()[0].refundAmount)===5,'confirmed local recovery does not repeat server mutation');
  await seed();await open();hold=true;release=null;await choose('account');await page.waitForFunction(()=>CardResellSaleConflicts.pending());
  while(!release)await new Promise(r=>setImmediate(r));
  await page.evaluate(()=>{const f=loadFlipsDataRaw();f[0]=CardResellSaleCorrections.correctSale(f[0],{...f[0],refundAmount:22},'sc_'+crypto.randomUUID());localStorage.setItem(getUserKey('flips'),JSON.stringify(f));});release();
  await page.waitForFunction(()=>document.querySelector('#saleConflictDialog [role=status]').textContent.includes('device changed meanwhile'));
  check(await page.evaluate(()=>loadFlipsDataRaw()[0].refundAmount)===22&&JSON.parse(await redis(['GET',key])).flips[0].refundAmount===5,'late local edits are preserved after account commit');
  await seed();await open();hold=true;release=null;await choose('account');await page.waitForFunction(()=>CardResellSaleConflicts.pending());while(!release)await new Promise(r=>setImmediate(r));
  await page.evaluate(()=>{window.googleUser={sub:'another-account'};localStorage.setItem(getUserKey('flips'),JSON.stringify([{id:'other-owner',sellPrice:77}]));});release();
  await page.waitForFunction(()=>document.querySelector('#saleConflictDialog [role=status]').textContent.includes('Account changed'));
  check(await page.evaluate(()=>loadFlipsDataRaw()[0].id)==='other-owner','late response cannot write into another account');
  await setup();await page.evaluate(()=>document.getElementById('saleConflictDialog').close());await open();await page.getByRole('button',{name:'Resume saved choice',exact:true}).click();await done();
  check(await page.evaluate(()=>loadFlipsDataRaw()[0].refundAmount)===5,'original account can resume after switching back');
  await seed();await page.evaluate(()=>localStorage.setItem(getUserKey('sale_conflict_v1'),'{broken'));await open();
  check((await status().textContent()).includes('could not be read')&&await page.evaluate(()=>CardResellSaleConflicts.pending()),'corrupt recovery record is preserved and blocks sync');
  const rawDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery backup',exact:true}).click();const raw=JSON.parse(readFileSync(await(await rawDownload).path(),'utf8'));
  check(raw.local.sale_conflict_v1.unreadableRaw==='{broken','backup preserves unreadable recovery bytes');
 }
 await page.evaluate(()=>{_cancelUserDataSync();window._googleIdToken=null;});await ctx.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));h.restore();}
finish(count,0);
