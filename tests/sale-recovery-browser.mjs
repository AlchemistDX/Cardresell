import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {ROOT} from './_assetRefs.mjs';
import {completionGuard} from './_complete.mjs';
const {finish}=completionGuard('sale-recovery-browser');let checks=0;
const check=(v,m)=>{assert.ok(v,m);checks++;};
const server=createServer((req,res)=>{try{const path=resolve(ROOT,'.'+new URL(req.url,'http://x').pathname.replace(/^\/$/,'/index.html'));if(!path.startsWith(resolve(ROOT)+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(path)]||'application/octet-stream');res.end(readFileSync(path));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});mkdirSync('/tmp/cardresell-sale-recovery-shots',{recursive:true});
async function pageIn(ctx){const p=await ctx.newPage();await p.goto(origin,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.CardResellSaleRecovery&&window.openMarkSoldModal);return p;}
async function setup(p,clear=true){await p.evaluate(clear=>{if(clear)localStorage.clear();window.googleUser={sub:'sale-owner'};window._googleIdToken=null;window._isPro=true;window._saleToasts=[];window.showToast=(m)=>_saleToasts.push(m);if(clear){localStorage.setItem(getUserKey('portfolio'),JSON.stringify([{id:'copy-a',card:'Charizard',buyPrice:0,importKey:'csv1:fixture',location:'Box 2',sku:'SKU-A'},{id:'sibling',card:'Blastoise',buyPrice:7}]));localStorage.setItem(getUserKey('flips'),'[]');}document.getElementById('collectionView').style.display='block';document.getElementById('collectionContent').style.display='block';CardResellSaleRecovery.render();},clear);}
async function form(p){await p.evaluate(()=>{openMarkSoldModal('copy-a');for(const [id,value] of Object.entries({msSellPrice:'100',msBuyPrice:'0',msFees:'',msShipCost:'5',msGradingCost:'0'}))document.getElementById(id).value=value;});}
async function state(p){return p.evaluate(()=>({port:JSON.parse(localStorage.getItem(getUserKey('portfolio'))||'[]'),flips:JSON.parse(localStorage.getItem(getUserKey('flips'))||'[]'),receipts:JSON.parse(localStorage.getItem(getUserKey('copy_sales_v1'))||'null'),journal:JSON.parse(localStorage.getItem(getUserKey('sale_recovery_v1'))||'null'),modal:document.getElementById('markSoldModal').classList.contains('open'),toasts:_saleToasts,visible:loadPortData()}));}
try {
 const ctx=await browser.newContext({viewport:{width:390,height:900}});await ctx.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());const page=await pageIn(ctx);
 for(const fault of ['journal','flips','receipts','tombstones','portfolio','clear']) {
  await setup(page);await form(page);
  await page.evaluate(fault=>{window._realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){const suffix={journal:'sale_recovery_v1',flips:'flips',receipts:'copy_sales_v1',tombstones:'tombstones',portfolio:'portfolio',clear:'sale_recovery_v1'}[fault];if(k===getUserKey(suffix)&&(fault!=='clear'||v==='null'))throw new DOMException('test quota','QuotaExceededError');return _realSet.call(this,k,v);};},fault);
  await page.evaluate(()=>confirmMarkSold());let s=await state(page);
  check(s.modal,'failed '+fault+' save keeps modal open');
  check(!s.toasts.some(t=>t.startsWith('Sale recorded')),'failed '+fault+' save does not claim completion');
  if(fault==='journal')check(!s.journal&&!s.flips.length&&s.port.length===2,'journal failure changes no sale or stock');
  else {
   check(s.journal?.sale.sourceCollectionId==='copy-a','failed '+fault+' keeps recovery journal');
   const saleId=s.journal.sale.id;
   if(fault==='flips')check(!s.flips.length&&s.port.length===2,'failed sale write retains copy');
   else check(s.flips.length===1&&!s.visible.some(x=>x.id==='copy-a'),'persisted sale immediately prevents available stock');
   await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.CardResellSaleRecovery);await setup(page,false);
   const resume=page.getByRole('button',{name:'Resume saved sale',exact:true});await resume.waitFor({state:'visible'});
   if(fault==='portfolio'){await page.screenshot({path:'/tmp/cardresell-sale-recovery-shots/recovery-390.png'});check(await page.locator('#saleRecoveryNotice').evaluate(e=>e.getBoundingClientRect().right<=innerWidth+1),'recovery fits mobile width');}
   await resume.click();await page.waitForFunction(()=>localStorage.getItem(getUserKey('sale_recovery_v1'))==='null');s=await state(page);
   check(s.flips.length===1&&s.flips[0].id===saleId,'resume '+fault+' keeps exactly the original sale ID');
   check(s.port.length===1&&s.port[0].id==='sibling','resume '+fault+' removes only sold copy');
   check(s.receipts.entries[0].copyId==='copy-a'&&!s.journal,'resume '+fault+' keeps lasting sold identity');
   check(await page.evaluate(()=>JSON.parse(localStorage.getItem(getUserKey('tombstones'))).portfolio['copy-a']>0),'resume '+fault+' persists portfolio deletion marker');
  }
  await page.evaluate(()=>{if(window._realSet)Storage.prototype.setItem=_realSet;});
 }
 await setup(page);await page.evaluate(()=>openMarkSoldModal('copy-a'));
 check(await page.locator('#msBuyPrice').inputValue()==='0.00','explicit imported zero cost is preserved');
 await form(page);await page.evaluate(()=>confirmMarkSold());let s=await state(page);
 check(s.flips[0].buyPrice===0&&s.flips[0].costMeta.buyPrice==='zero'&&s.flips[0].costMeta.fees==='blank','known zero and unknown fees stay distinct');
 check(s.flips[0].location==='Box 2'&&s.flips[0].sku==='SKU-A'&&s.flips[0].importKey==='csv1:fixture','sale preserves copy provenance');
 check(s.toasts.some(t=>t.includes('Add missing costs')),'incomplete profit is not claimed as final');
 await page.evaluate(()=>{localStorage.setItem(getUserKey('flips'),'[]');localStorage.setItem(getUserKey('portfolio'),JSON.stringify([{id:'copy-a',card:'stale copy',updatedAt:Date.now()+100000}]));localStorage.setItem(getUserKey('tombstones'),'{}');});
 check(!(await state(page)).visible.length,'deleting sale report and expiring marks cannot restore local sold copy');
 await setup(page);await form(page);await page.evaluate(()=>{window._realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===getUserKey('portfolio'))throw new DOMException('full','QuotaExceededError');return _realSet.call(this,k,v);};});await page.evaluate(()=>confirmMarkSold());
 const oldJournal=(await state(page)).journal;
 await page.evaluate(()=>{Storage.prototype.setItem=_realSet;googleUser={sub:'other-owner'};CardResellSaleRecovery.render();});
 check(await page.locator('#saleRecoveryNotice').isHidden(),'another account cannot see saved sale');
 await page.evaluate(()=>CardResellSaleRecovery.commit());
 check(await page.evaluate(()=>localStorage.getItem('cardsell_sale-owner_sale_recovery_v1')!==null&&!localStorage.getItem('cardsell_other-owner_flips')),'account switch cannot finish another owner’s journal');
 await setup(page,false);await page.evaluate(()=>CardResellSaleRecovery.commit());check((await state(page)).flips[0].id===oldJournal.sale.id,'original owner can resume after switching back');

 // Hold the real Web Lock so both tabs prepare against the same snapshot.
 await setup(page);await form(page);const second=await pageIn(ctx);await setup(second,false);await form(second);
 await page.evaluate(()=>{window._held=navigator.locks.request('cardresell:'+getUserKey('sale_recovery_v1'),()=>new Promise(r=>window._releaseSale=r));});await page.waitForFunction(()=>!!window._releaseSale);
 await Promise.all([page.evaluate(()=>{window._saleRequest=confirmMarkSold();}),second.evaluate(()=>{window._saleRequest=confirmMarkSold();})]);
 await page.evaluate(()=>_releaseSale());await Promise.all([page.evaluate(()=>_saleRequest),second.evaluate(()=>_saleRequest)]);
 s=await state(page);check(s.flips.length===1&&s.port.length===1&&!s.journal,'two tabs serialize to one sale and one removal');
 await second.close();

 await setup(page);await form(page);await page.evaluate(()=>{window._releaseSale=null;window._held=navigator.locks.request('cardresell:'+getUserKey('sale_recovery_v1'),()=>new Promise(r=>window._releaseSale=r));});await page.waitForFunction(()=>!!window._releaseSale);
 await page.evaluate(()=>{window._saleRequest=confirmMarkSold();googleUser={sub:'changed-while-waiting'};_releaseSale();});await page.evaluate(()=>_saleRequest);
 check(await page.evaluate(()=>JSON.parse(localStorage.getItem('cardsell_sale-owner_flips')).length===0&&!localStorage.getItem('cardsell_changed-while-waiting_flips')),'owner switch while waiting for lock writes neither account');
 await setup(page);await page.evaluate(()=>localStorage.setItem(getUserKey('sale_recovery_v1'),'{broken'));await form(page);await page.evaluate(()=>confirmMarkSold());
 check(await page.evaluate(()=>localStorage.getItem(getUserKey('sale_recovery_v1'))==='{broken'&&JSON.parse(localStorage.getItem(getUserKey('flips'))).length===0),'corrupt journal is retained without changes');
 await page.setViewportSize({width:1280,height:900});await setup(page);await form(page);await page.evaluate(()=>{window._realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===getUserKey('portfolio'))throw Error('test');return _realSet.call(this,k,v);};});await page.evaluate(()=>confirmMarkSold());await page.evaluate(()=>{Storage.prototype.setItem=_realSet;document.getElementById('markSoldModal').classList.remove('open');});
 await page.screenshot({path:'/tmp/cardresell-sale-recovery-shots/recovery-1280.png'});
 check(await page.getByRole('button',{name:'Resume saved sale',exact:true}).isVisible(),'desktop recovery is reachable');
 // Exercise the real core sync callbacks with controlled HTTP responses.
 await setup(page);
 const cloudResult=await page.evaluate(async()=>{
  const nativeFetch=window.fetch;window._googleIdToken='test-token';
  const remote={ok:true,portfolio:[{id:'sibling',card:'Blastoise'}],flips:[{id:'cloud-sale',sourceCollectionId:'copy-a',sellPrice:100}],copySales:{version:1,entries:[{copyId:'copy-a',saleId:'cloud-sale',recordedAt:Date.now()}]},tombstones:{portfolio:{},flips:{}}};
  let reply;window.fetch=async()=>new Promise(r=>reply=()=>r(Response.json(remote)));
  const push=_pushUserData();
  const edited=JSON.parse(localStorage.getItem(getUserKey('portfolio')));edited.push({id:'new-during-sync',card:'New card'});localStorage.setItem(getUserKey('portfolio'),JSON.stringify(edited));reply();await push;
  const afterPush=JSON.parse(localStorage.getItem(getUserKey('portfolio')));
  window.fetch=async()=>Response.json(remote);await _pullUserData();window._cancelUserDataSync();window._googleIdToken=null;
  const afterPull=JSON.parse(localStorage.getItem(getUserKey('flips')));
  window.fetch=nativeFetch;return {afterPush,afterPull,receipts:JSON.parse(localStorage.getItem(getUserKey('copy_sales_v1')))};
 });
 check(!cloudResult.afterPush.some(r=>r.id==='copy-a'),'push response removes remotely sold copy from current local stock');
 check(cloudResult.afterPush.some(r=>r.id==='new-during-sync')&&cloudResult.afterPush.some(r=>r.id==='sibling'),'push response preserves unrelated edits made during request');
 check(cloudResult.afterPull.some(r=>r.id==='cloud-sale')&&cloudResult.receipts.entries.length===1,'pull imports sale and lasting receipt');
 await setup(page);
 const swapped=await page.evaluate(async()=>{const nativeFetch=fetch;_googleIdToken='test-token';let reply;window.fetch=()=>new Promise(r=>reply=()=>r(Response.json({ok:true,portfolio:[],flips:[],copySales:{version:1,entries:[{copyId:'copy-a',saleId:'late-sale',recordedAt:1}]}})));const push=_pushUserData();googleUser={sub:'other-owner'};reply();await push;_googleIdToken=null;window.fetch=nativeFetch;return !localStorage.getItem('cardsell_other-owner_copy_sales_v1')&&!localStorage.getItem('cardsell_sale-owner_copy_sales_v1');});
 check(swapped,'late sync response cannot change the replacement account');
 await ctx.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
finish(checks,0);
