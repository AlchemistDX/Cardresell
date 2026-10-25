// Real shipped core/auth helper -> eBay dialogs/export -> local handlers/Redis.
// Controlled SDK and provider boundaries; no customer data or marketplace writes.
import {completionGuard} from './_complete.mjs';
const {finish}=completionGuard('seller-auth-workflow-browser');
import {readFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import {ROOT} from './_assetRefs.mjs';
import {fixture,kv,env,reference,photoHost} from './_ebayOperationFixture.mjs';
import {createHandler as reviewHandler} from '../api/ebay-listing-review.js';
import {createHandler as operationsHandler} from '../api/ebay-listing-operations.js';
import {createHandler as availabilityHandler} from '../api/listing-availability.js';
import {readStoredDraft} from '../api/_draftStore.js';
const f=await fixture('seller-auth-browser');
const verify=async token=>{if(token!=='fresh-'+f.uid)throw Error('expired fixture token');return {uid:f.uid};};
const review=reviewHandler({env,verify,store:kv,photoHost,referenceLoader:async()=>reference});
const availability=availabilityHandler({verify,store:kv});
const operations=operationsHandler({env,verify,store:kv,fetcher:f.fetcher,photoHost,referenceLoader:async()=>reference});
const server=createServer((req,res)=>{
 const path=resolve(ROOT,'.'+new URL(req.url,'http://local').pathname);
 if(!path.startsWith(ROOT+'/')||!existsSync(path)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(readFileSync(path));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
let passed=0;const failures=[];
const check=(ok,label)=>{if(ok)passed++;else failures.push(label);};
try{
 for(const width of [390,1280]){
  await f.reset();const page=await browser.newPage({viewport:{width,height:1000}}),calls=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin!==origin)return route.fulfill({status:204,body:''});
   if(!url.pathname.startsWith('/api/'))return route.continue();
   const body=req.method()==='GET'?{}:req.postDataJSON();
   if(['/api/ebay-connect','/api/ebay-listing-review','/api/ebay-listing-operations','/api/listing-availability'].includes(url.pathname))calls.push({path:url.pathname,method:req.method(),body,auth:req.headers().authorization,action:url.searchParams.get('action')});
   if(url.pathname==='/api/ebay-connect')return route.fulfill({json:{available:true,connected:true,environment:'production',username:'Fixture seller',publishingEnabled:false}});
   if(url.pathname==='/api/drafts')return route.fulfill({json:readStoredDraft(await kv('GET',f.dk))});
   const handler=url.pathname==='/api/ebay-listing-review'?review:url.pathname==='/api/listing-availability'?availability:url.pathname==='/api/ebay-listing-operations'?operations:null;
   if(!handler)return route.fulfill({status:204,body:''});
   let status=200,data;
   await handler({method:req.method(),headers:{authorization:req.headers().authorization,origin:env.EBAY_SELLER_ORIGIN},query:Object.fromEntries(url.searchParams),body},{setHeader(){},status(n){status=n;return this},json(v){data=v;return this}});
   return route.fulfill({status,json:data});
  });
  await page.addInitScript(()=>{
   localStorage.setItem('cs_landing_seen','1');
   const original=setTimeout;window.setTimeout=(fn,ms,...args)=>original(fn,ms===15000&&!window.allowLongAuth?120:ms,...args);
  });
  await page.goto(origin+'/index.html');await page.waitForFunction(()=>typeof _crIdToken==='function');await page.waitForTimeout(500);
  await page.evaluate(({uid,draft})=>{
   window.googleUser={uid,sub:uid};delete window._fbAuth;window.tokenMode='ready';window.tokenWaiters=[];
   window._fbCurrentUser={uid,getIdToken:async()=>{
    if(tokenMode==='reject')throw Error('offline');
    if(tokenMode==='pending')return new Promise(r=>tokenWaiters.push(r));
    return 'fresh-'+uid;
   }};
   window._googleIdToken='expired-fixture-token';window.authDraft=draft;window.downloads=[];window.photoCalls=0;
   HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push(this.download);};
   window.ensureExportablePhotos=async()=>{photoCalls++;return {ok:true,reason:'NONE',urls:[],localCount:0};};
   _draftsState.rows=[{draftId:draft.draftId,summary:{title:draft.title,slot:'ebay:fixed-price',sku:draft.sku,rev:draft.rev}}];
   _draftsState.selected=new Set([draft.draftId]);_draftsState.signedIn=true;
  },{uid:f.uid,draft:f.draft});

  // Each initial read must escape the stalled SDK and leave a usable retry.
  const cases=[
   {module:'CardResellEbayConnect',selector:'#ebayConnectDialog',retry:'Retry',ready:'Check seller setup'},
   {module:'CardResellEbayListingReview',selector:'#ebayListingReview',retry:'Retry',ready:'Load current eBay requirements'},
   {module:'CardResellEbayListingOperations',selector:'#ebayListingOperations',retry:'Reload saved status',ready:'Reload saved status'}
  ];
  for(const item of cases){
   const before=calls.length;
   await page.evaluate(({module})=>{tokenMode='pending';window[module].open(module==='CardResellEbayListingReview'?authDraft.draftId:undefined);},item);
   const dialog=page.locator(item.selector);
   await dialog.getByRole('alert').filter({hasText:'Sign-in refresh could not finish'}).waitFor();
   check(calls.length===before,item.module+' timeout sends no request at '+width);
   check(!/^(Checking connection|Loading)/.test(await dialog.getByRole('status').innerText()),item.module+' retracts loading state at '+width);
   check(await dialog.getByRole('button',{name:item.retry,exact:true}).isEnabled(),item.module+' enables retry at '+width);
   await page.evaluate(()=>{tokenWaiters.splice(0).forEach(r=>r('late-token'));});await page.waitForTimeout(10);
   check(calls.length===before,item.module+' late token sends no request at '+width);
   check(await page.evaluate(()=>_googleIdToken!=='late-token'),item.module+' late token cannot poison cache at '+width);
   await page.evaluate(()=>{tokenMode='ready';});
   await dialog.getByRole('button',{name:item.retry,exact:true}).click();
   await dialog.getByRole('button',{name:item.ready,exact:true}).waitFor();
   if(item.module==='CardResellEbayListingOperations')await dialog.getByText(/No saved eBay listing operations\./).waitFor();
   check(calls.slice(before).every(r=>r.auth==='Bearer fresh-'+f.uid),item.module+' retry refreshes correct account at '+width);
   check(!(await dialog.getByRole('alert').allTextContents()).some(x=>x.includes('Sign-in refresh')),item.module+' retry clears error at '+width);
   await dialog.getByRole('button',{name:'Close',exact:true}).click();
  }

  // The actual export entry point cannot produce a file before auth/availability.
  const beforeExport=calls.length;
  await page.evaluate(()=>{tokenMode='pending';window.exportPromise=_draftDownloadGo(authDraft.draftId);});
  await page.waitForFunction(()=>!!_draftsState.dl?.error);
  check(await page.evaluate(()=>!downloads.length&&!photoCalls),'stalled export creates no file or photo upload at '+width);
  check(await page.evaluate(()=>!_draftsState.dl.busy&&/Sign.in|Sign-in refresh/.test(_draftsState.dl.error)),'export unlocks with actionable error at '+width);
  await page.evaluate(()=>{tokenWaiters.splice(0).forEach(r=>r('late-export-token'));});await page.waitForTimeout(10);
  check(calls.length===beforeExport,'late export refresh cannot start availability check at '+width);
  await page.evaluate(async()=>{tokenMode='ready';await _draftDownloadGo(authDraft.draftId);});
  check(await page.evaluate(()=>downloads.length===1&&photoCalls===1),'explicit export retry completes once at '+width);

  // Closing a connection dialog during refresh cancels the user's pending action.
  await page.evaluate(()=>{window.allowLongAuth=true;return CardResellEbayConnect.open();});const connection=page.locator('#ebayConnectDialog');
  await connection.getByRole('button',{name:'Reconnect eBay',exact:true}).waitFor();
  await page.evaluate(()=>{tokenMode='pending';});const beforeClose=calls.length;
  await connection.getByRole('button',{name:'Reconnect eBay',exact:true}).click();
  await page.waitForFunction(()=>tokenWaiters.length>0);
  await connection.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(()=>{tokenWaiters.splice(0).forEach(r=>r('fresh-'+googleUser.uid));});await page.waitForTimeout(20);
  check(!calls.slice(beforeClose).some(r=>r.action==='start'),'closed dialog cannot start OAuth after late refresh at '+width+': '+JSON.stringify(calls.slice(beforeClose).map(r=>({path:r.path,method:r.method,action:r.action}))));

  // A different account must never inherit the previous token or receive its reply.
  await page.evaluate(()=>{tokenMode='pending';CardResellEbayListingOperations.open();});
  await page.waitForFunction(()=>tokenWaiters.length>0);const beforeSwitch=calls.length;
  await page.evaluate(()=>{googleUser={uid:'other',sub:'other'};_fbCurrentUser={uid:'other',getIdToken:async()=> 'other-token'};_googleIdToken='other-token';tokenWaiters.splice(0).forEach(r=>r('previous-owner-token'));});
  await page.waitForFunction(()=>!document.querySelector('#ebayListingOperations'));
  check(calls.length===beforeSwitch&&await page.evaluate(()=>_googleIdToken==='other-token'),'account switch sends no request and preserves new cache at '+width);
  check(!calls.some(r=>['prepare','publish','price','end'].includes(r.body?.action)),'no live mutation intent at '+width);
  check(!errors.length,'no uncaught browser errors at '+width+': '+errors.join('; '));
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page overflow at '+width);
  await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
for(const failure of failures)console.error('FAIL:',failure);
finish(passed,failures.length);
