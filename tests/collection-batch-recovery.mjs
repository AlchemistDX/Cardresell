// Real browser, renderer, reviewed batch and shared create client; isolated API replies.
// Real draft-handler persistence is also exercised by bulk-batch-draft.mjs.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {fixture} from './_collectionDraftFixture.mjs';
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(fixture)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
let checks=0;const check=(value,message)=>{assert.ok(value,message);checks++;};
const cards=[{id:1,card:'Pikachu',set:'Base',number:'58',currentValue:12.34,buyPrice:3,location:'Box A',sku:'PK-A'},{id:2,card:'Mew',set:'Promo',number:'8',currentValue:null,buyPrice:99}];
async function boot(width=390){const context=await browser.newContext({viewport:{width,height:900}});await context.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.evaluate(rows=>seed(rows),cards);return {context,page,errors};}
async function select(page){await page.getByRole('button',{name:'Select visible',exact:true}).click();await page.locator('[data-create]').click();}
async function confirm(page){await page.locator('[data-batch-confirm]').click();await idle(page);}
async function idle(page){await page.waitForFunction(()=>!window.CardResellDraftBatch.isBusy());}
async function close(page){const b=page.getByRole('button',{name:'Close batch preparation'});if(await b.count())await b.click();}
async function reload(page){await page.reload();await page.evaluate(()=>seed(data));}
const stored=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('cr_collection_draft_batch_v1:owner')));
try{
 for(const stage of ['capacity','eligibility','snapshot'])for(const action of ['Cancel','Close batch preparation','Escape']){
  const {context,page,errors}=await boot();await select(page);
  await page.evaluate(stage=>{
   if(stage==='capacity'){deferHead=true;window.releaseCheck=()=>finishHead();}
   if(stage==='eligibility'){const original=fetchSellStamps;fetchSellStamps=async(...args)=>{await new Promise(r=>window.releaseCheck=r);return original(...args);};}
   if(stage==='snapshot'){const original=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=async(...args)=>{await new Promise(r=>window.releaseCheck=r);crypto.subtle.digest=original;return original(...args);};}
  },stage);
  await page.locator('[data-batch-confirm]').click();
  await page.waitForFunction(stage=>stage==='capacity'?!!window.finishHead:!!window.releaseCheck,stage);
  if(action==='Escape')await page.keyboard.press('Escape');else await page.locator('.draft-batch').getByRole('button',{name:action,exact:true}).click();
  await page.evaluate(()=>releaseCheck());await idle(page);
  check(await page.evaluate(()=>calls.length===0&&manifests.length===0),`${action} during ${stage} prevents every draft write`);
  check(await stored(page)===null,`${action} during ${stage} does not create a recovery batch`);
  check(await page.locator('.draft-batch[open]').count()===0,'cancelled checks cannot reopen the dialog');
  check(await page.locator('.collection-draft-check:checked').count()===2,'cancelled preparation preserves the selected cards');
  if(stage==='capacity'&&action==='Cancel'){
   await page.evaluate(()=>deferHead=false);await page.locator('[data-create]').click();await confirm(page);
   check(await page.evaluate(()=>calls.length===2),'cancelled preflight releases its lock and permits a freshly approved batch');
  }
  check(errors.length===0,errors.join('\n'));await context.close();
 }
 for(const replacement of ['valid','unreadable']){
  const {context,page}=await boot();await page.evaluate(()=>mode='network');await select(page);await confirm(page);const saved=await stored(page);
  await page.evaluate(()=>localStorage.setItem('cr_collection_draft_batch_v1:owner','{"version":999}'));await reload(page);
  await page.getByRole('button',{name:'Review recovery',exact:true}).click();
  const other=await context.newPage();await other.goto(url);
  const updated=replacement==='valid'?JSON.stringify(saved):'{"version":1000}';
  page.once('dialog',async dialog=>{await other.evaluate(raw=>localStorage.setItem('cr_collection_draft_batch_v1:owner',raw),updated);await dialog.accept();});
  await page.getByRole('button',{name:'Clear unreadable recovery record',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.draft-batch[open]')||document.querySelector('.draft-batch')?.textContent.includes('changed'));
  check(await page.evaluate(()=>localStorage.getItem('cr_collection_draft_batch_v1:owner'))===updated,'stale confirmation preserves a newer '+replacement+' recovery record');
  check(await page.evaluate(()=>calls.length===0&&manifests.length===0),'clearing recovery cannot submit drafts');await context.close();
 }
 {
  const {context,page}=await boot();await page.evaluate(()=>mode='defer');await select(page);await page.locator('[data-batch-confirm]').click();await page.waitForFunction(()=>!!window.finishRequest);
  await close(page);await page.evaluate(()=>{mode='ok';finishRequest()});await idle(page);
  check(await page.evaluate(()=>calls.length===2),'closing saved progress does not abandon an already-started batch');
  check((await stored(page)).rows.every(r=>r.state==='done'),'already-started work remains recorded after closing progress');
  check(await page.locator('.draft-batch[open]').count()===0,'background completion does not reopen progress');await context.close();
 }
 {
  const {context,page}=await boot();await page.evaluate(()=>localStorage.setItem('cr_collection_draft_batch_v1:owner','{"version":999}'));await reload(page);
  await page.getByRole('button',{name:'Review recovery',exact:true}).click();page.once('dialog',d=>d.accept());
  await page.getByRole('button',{name:'Clear unreadable recovery record',exact:true}).click();await page.waitForFunction(()=>localStorage.getItem('cr_collection_draft_batch_v1:owner')===null);
  check(await stored(page)===null,'explicit clearing still works when the unreadable record is unchanged');await context.close();
 }
 for(const width of [390,1280]){
  const {context,page,errors}=await boot(width);await select(page);
  check(await page.evaluate(()=>calls.length===0&&manifests.length===0),'preview makes no draft writes');
  check((await page.locator('[data-batch-row="2"]').textContent()).includes('Needs a price'),'missing value never becomes acquisition-cost asking price');
  await page.locator('[name=priceMode]').selectOption('fixed');
  check(await page.locator('[data-batch-confirm]').isDisabled(),'fixed prices require an explicit positive amount');
  await page.locator('[name=fixedPrice]').fill('2.99');await page.locator('[name=buyerPays]').fill('0');
  check(await page.locator('[data-batch-confirm]').isDisabled(),'partial shipping assumptions require review');
  await page.locator('[name=sellerCost]').fill('1.25');
  const bounds=await page.locator('.draft-batch').boundingBox();check(bounds.x>=0&&bounds.x+bounds.width<=width+1,'batch review fits viewport');check(Math.abs(bounds.x-(width-bounds.width)/2)<2,'batch review is centered despite the page margin reset');
  if(process.env.CR_SHOT_DIR)await page.screenshot({path:process.env.CR_SHOT_DIR+'/batch-review-'+width+'.png'});
  await confirm(page);
  check(await page.evaluate(()=>calls.length===2&&calls.every(c=>c.body.price===2.99&&c.body.priceSource==='seller')),'shared asking price reaches each physical copy');
  check(await page.evaluate(()=>calls.every(c=>c.body.pricingContext.shipping.buyerPays==='0'&&c.body.pricingContext.shipping.sellerCost==='1.25')),'shared shipping preserves explicit zero and postage');
  check(await page.evaluate(()=>data[0].currentValue===12.34&&data[1].buyPrice===99),'batch defaults do not edit collection costs or values');
  check((await stored(page)).rows.every(r=>r.state==='done'),'confirmed outcomes survive a page close');
  check(!JSON.stringify(await stored(page)).includes('Bearer'),'journal never stores authorization credentials');
  check(errors.length===0,errors.join('\n'));await context.close();
 }
 {
  const {context,page}=await boot();await select(page);await page.locator('[name=priceMode]').selectOption('blank');await confirm(page);
  check(await page.evaluate(()=>calls.every(c=>c.body.price===undefined&&c.body.priceSource===undefined)),'blank-price setting omits price and provenance');
  check(await page.evaluate(()=>calls.every(c=>c.body.pricingContext.shipping===undefined)),'blank shipping omits unrelated ambient assumptions');await context.close();
 }
 {
  const {context,page}=await boot();await page.evaluate(()=>mode='network');await select(page);await confirm(page);
  const before=await page.evaluate(()=>calls[0]),journal=await stored(page);
  check(journal.rows[0].state==='uncertain'&&journal.rows[1].state==='queued','lost response stops the batch and preserves later copies');
  await reload(page);check(await page.evaluate(()=>calls.length===0&&manifests.length===0),'reload never automatically resumes writes');
  check(await page.getByRole('button',{name:'Resume saved batch',exact:true}).isVisible(),'reload offers explicit recovery');
  check(await page.locator('.collection-draft-check:checked').count()===2,'reload restores pending selection');
  await page.evaluate(()=>{data[0].currentValue=999;_crDraftState.inst_col_1={generation:5};mode='existing'});
  await page.getByRole('button',{name:'Resume saved batch',exact:true}).click();await page.locator('[data-batch-resume]').click();await idle(page);
  check(await page.evaluate(()=>JSON.stringify(calls[0]))===JSON.stringify(before),'reload retry keeps original generation, key, price and full wire body');
  check((await stored(page)).rows.every(r=>r.state==='done'),'resumed batch completes remaining copies');
  check(await page.evaluate(()=>manifests[0].id)===journal.id,'resume renews the original admission manifest');
  check(await page.evaluate(()=>calls[1].body.price===undefined),'unpriced remaining card never falls back to purchase cost');await context.close();
 }
 {
  const {context,page}=await boot();await page.evaluate(()=>mode='defer');await select(page);await page.locator('[data-batch-confirm]').click();await page.waitForFunction(()=>!!window.finishRequest);
  const sent=await page.evaluate(()=>calls[0]);check((await stored(page)).rows[0].state==='sending','write-ahead record exists before the response');
  await reload(page);await page.getByRole('button',{name:'Resume saved batch'}).click();await page.locator('[data-batch-resume]').click();await idle(page);
  check(await page.evaluate(()=>JSON.stringify(calls[0]))===JSON.stringify(sent),'closing during a request retains its exact recovery identity');await context.close();
 }
 {
  const {context,page}=await boot();await page.evaluate(()=>mode='defer');await select(page);await page.locator('[data-batch-confirm]').click();await page.waitForFunction(()=>!!window.finishRequest);
  await page.locator('[data-batch-pause]').click();await page.evaluate(()=>{mode='ok';finishRequest()});await idle(page);
  check(await page.evaluate(()=>calls.length===1),'pause completes the current request and stops before the next');
  check((await stored(page)).rows[1].state==='queued','pause leaves the remaining copy recoverable');
  await page.locator('[data-batch-resume]').click();await idle(page);check(await page.evaluate(()=>calls.length===2),'resume skips already-confirmed copies');await context.close();
 }
 {
  const {context,page}=await boot();await select(page);await page.evaluate(()=>data[0].currentValue=40);await confirm(page);
  check(await page.evaluate(()=>calls.length===0&&manifests.length===0),'changed preview is refused before writes');
  check((await page.locator('[data-status]').textContent()).includes('changed'),'changed preview has actionable feedback');await context.close();
 }
 {
  const {context,page}=await boot();await page.evaluate(()=>mode='network');await select(page);await confirm(page);await reload(page);
  await page.evaluate(()=>{data=data.filter(r=>r.id!==1);mode='existing'});await page.getByRole('button',{name:'Resume saved batch'}).click();await page.locator('[data-batch-resume]').click();await idle(page);
  check(await page.evaluate(()=>calls.every(c=>c.body.instanceId!=='inst_col_1')),'removed physical copy is never recreated by recovery');
  check((await stored(page)).rows[0].state==='blocked','removed copy retains an explicit review result');await context.close();
 }
 {
  const {context,page}=await boot();await page.evaluate(()=>mode='network');await select(page);await confirm(page);const original=await stored(page);await reload(page);
  await page.evaluate(()=>{mode='gone';_crDraftState.inst_col_1={generation:1}});await page.getByRole('button',{name:'Resume saved batch'}).click();await page.locator('[data-batch-resume]').click();await idle(page);
  check(await page.evaluate(()=>calls[0].body.generation)===original.rows[0].payload.generation,'deletion does not upgrade a retry into a new create');
  check((await stored(page)).rows[0].state==='blocked','deleted draft refusal is definitive, not automatically retried');await context.close();
 }
 {
  const {context,page}=await boot();await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('cr_collection_draft_batch_v1:'))throw new DOMException('full','QuotaExceededError');return set.call(this,k,v);};});await select(page);await confirm(page);
  check(await page.evaluate(()=>calls.length===0&&manifests.length===0),'failed initial journal write prevents all draft mutations');
  check((await page.locator('[data-status]').textContent()).includes('storage'),'storage failure is explained');await context.close();
 }
 {
  const {context,page}=await boot();await page.evaluate(()=>{let writes=0;const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('cr_collection_draft_batch_v1:')&&++writes===3)throw new DOMException('full','QuotaExceededError');return set.call(this,k,v);};});await select(page);await confirm(page);
  check(await page.evaluate(()=>calls.length===1),'failed outcome journal write stops later cards');
  check((await stored(page)).rows[0].state==='sending','prior write-ahead record survives failed outcome storage');
  const sent=await page.evaluate(()=>calls[0]);await reload(page);await page.evaluate(()=>mode='existing');await page.getByRole('button',{name:'Resume saved batch'}).click();await page.locator('[data-batch-resume]').click();await idle(page);
  check(await page.evaluate(()=>JSON.stringify(calls[0]))===JSON.stringify(sent),'outcome-write failure recovers with the original request');await context.close();
 }
 {
  const {context,page}=await boot();await page.evaluate(()=>mode='defer');await select(page);await page.locator('[data-batch-confirm]').click();await page.waitForFunction(()=>!!window.finishRequest);
  await page.evaluate(()=>{googleUser={sub:'other'};renderCollectionView();mode='ok';finishRequest()});await idle(page);
  check(await page.evaluate(()=>calls.length===1),'account switch stops subsequent writes');
  check(await page.locator('.collection-draft-result').allTextContents().then(a=>a.every(v=>!v)),'new account cannot see old batch outcomes');
  check(await page.evaluate(()=>localStorage.getItem('cr_collection_draft_batch_v1:other')===null),'old journal never written under the new account');
  check((await stored(page)).rows[0].state==='sending','original account retains recoverable uncertain work');await context.close();
 }
 {
  const {context,page}=await boot();await page.evaluate(()=>mode='defer');await select(page);await page.locator('[data-batch-confirm]').click();await page.waitForFunction(()=>!!window.finishRequest);
  const other=await context.newPage();await other.goto(url);await other.evaluate(()=>seed(data));await other.getByRole('button',{name:'Resume saved batch'}).click();await other.locator('[data-batch-resume]').click();await idle(other);
  check(await other.evaluate(()=>calls.length===0&&manifests.length===0),'another tab cannot run the same account batch concurrently');
  check((await other.locator('[data-batch-note]').textContent()).includes('another tab'),'concurrent-tab refusal is actionable');
  await page.evaluate(()=>{mode='ok';finishRequest()});await idle(page);await context.close();
 }
 {
  const {context,page}=await boot();await page.evaluate(()=>{localStorage.setItem('cr_collection_draft_batch_v1:owner','{"version":999}');});await reload(page);
  check(await page.getByRole('button',{name:'Review recovery'}).isVisible(),'unreadable journal is visible and retained');
  await select(page);check(await page.evaluate(()=>calls.length===0&&manifests.length===0),'unreadable recovery never silently replaced');
  check(await page.evaluate(()=>localStorage.getItem('cr_collection_draft_batch_v1:owner'))==='{"version":999}','unreadable record preserved until explicit clearing');await context.close();
 }
 {
  const {context,page}=await boot();
  await page.evaluate(async()=>{mode='network';await _crCreateDraft({card:data[0],instanceId:'inst_col_1',idemKey:'same-key',price:12,source:'collection',batch:true});googleUser={sub:'other'};mode='ok';await _crCreateDraft({card:{id:1,card:'Different account card'},instanceId:'inst_col_1',idemKey:'same-key',price:77,source:'collection',batch:true});});
  check(await page.evaluate(()=>calls[1].body.price===77&&calls[1].body.card.card==='Different account card'),'single-card retry cache is isolated between accounts too');await context.close();
 }
 {
  const {context,page}=await boot();await page.evaluate(async()=>{await startListingDraftForEntry(2);});
  check(await page.evaluate(()=>calls.length===1&&calls[0].body.price===undefined&&calls[0].body.priceSource===undefined),'individual-card drafts also leave missing values unpriced');await context.close();
 }
 {
  const {context,page}=await boot();await page.evaluate(()=>mode='cap');await select(page);await confirm(page);
  check((await stored(page)).rows[0].state==='queued','capacity refusal retains the current card for retry');
  await page.evaluate(()=>mode='existing');await page.locator('[data-batch-resume]').click();await idle(page);
  check(await page.evaluate(()=>calls.length===3&&calls[1].body.instanceId==='inst_col_1'),'retry after capacity recovers the refused card before the next');await context.close();
 }
 {
  const {context,page}=await boot();await page.evaluate(()=>mode='network');await select(page);await confirm(page);await close(page);await page.evaluate(()=>seed([]));
  check(await page.getByRole('button',{name:'Resume saved batch'}).isVisible(),'empty collection still exposes unfinished batch recovery');
  await page.getByRole('button',{name:'Resume saved batch'}).click();await page.locator('[data-batch-resume]').click();await idle(page);
  check((await stored(page)).rows.every(r=>r.state==='blocked'),'removed copies resolve to review without new drafts');await context.close();
 }
 {
  const {context,page}=await boot();
  await page.evaluate(()=>{_crIdToken=()=>new Promise(resolve=>window.finishToken=resolve);window.inFlight=_crCreateDraft({card:data[0],instanceId:'inst_col_1',idemKey:'delayed-token',price:12,batch:true});});
  await page.waitForFunction(()=>!!window.finishToken);await page.evaluate(async()=>{googleUser={sub:'other'};finishToken('fixture');await inFlight;});
  check(await page.evaluate(()=>calls.length===0),'account switch during token refresh blocks even an individual create');await context.close();
 }
 for(const changed of [false,true]){
  const {context,page}=await boot();await page.evaluate(()=>{data[0].imageDataUrl='data:image/png;base64,AAAA';seed(data);mode='network';});await select(page);await confirm(page);
  check(!JSON.stringify(await stored(page)).includes('data:image'),'recovery journal excludes local image bytes');
  await reload(page);await page.evaluate(change=>{mode='existing';if(change)data[0].imageDataUrl='data:image/png;base64,BBBB';},changed);
  await page.getByRole('button',{name:'Resume saved batch'}).click();await page.locator('[data-batch-resume]').click();await idle(page);
  if(changed){check(await page.evaluate(()=>attached.length===0),'replacement photo is never attached to the original request');check((await stored(page)).rows[0].message.includes('Photo needs review'),'missing original photo has an explicit review result');}
  else check(await page.evaluate(()=>attached.length===1&&attached[0].snapshot.dataUrl==='data:image/png;base64,AAAA'),'unchanged local photo is recovered after reload');
  await context.close();
 }
 console.log(`collection-batch-recovery: ${checks} passed, 0 failed -- SUITE COMPLETE, exit=0`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
