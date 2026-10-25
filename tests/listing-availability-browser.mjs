// Shipped browser -> actual read handler -> isolated Redis. No live services.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import {ROOT} from './_assetRefs.mjs';
import {completionGuard} from './_complete.mjs';
import {fixture,kv} from './_ebayOperationFixture.mjs';
import {makeDraft} from './_ebayReviewFixture.mjs';
import {draftKey,readStoredDraft} from '../api/_draftStore.js';
import {createHandler} from '../api/listing-availability.js';
const {finish}=completionGuard('listing-availability-browser');let checks=0;
const check=(v,m)=>{assert.ok(v,m);checks++;};
const f=await fixture('availability-browser'),second=makeDraft({instanceId:'inst_col_second'});
const handler=createHandler({verify:async uid=>({uid}),store:kv});
const server=createServer((req,res)=>{
 const file=resolve(ROOT,'.'+new URL(req.url,'http://local').pathname);
 if(!file.startsWith(ROOT+'/')||!existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
async function seed(){await f.reset();await kv('SET',draftKey(f.uid,second.draftId),JSON.stringify(second));await kv('SET','userdata:'+f.uid,JSON.stringify({portfolio:[{id:f.uid,card:'Charizard',quantity:1},{id:'second',card:'Second physical card',quantity:1}],flips:[]}));}
try {
 for(const width of [390,1280]) {
  await seed();const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let failCheck=false,malformed=false,delay=false,release=null,requests=0;
  await page.exposeFunction('changeDuringPhotos',async mode=>{
   if(mode==='plan')await f.call('plan');
   if(mode==='revision')await kv('SET',f.dk,JSON.stringify({...f.draft,rev:2}));
  });
  await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.origin===origin&&u.pathname==='/api/listing-availability'){
    requests++;if(delay)await new Promise(r=>release=r);
    if(malformed)return route.fulfill({json:{version:1,environment:'production',checkedAt:Date.now(),records:[]}});
    if(failCheck)return route.fulfill({status:503,json:{error:'Availability could not be checked. Retry before exporting.'}});
    let status=200,data;await handler({method:req.method(),headers:{authorization:req.headers().authorization},body:req.postDataJSON()},{setHeader(){},status(n){status=n;return this},json(d){data=d;return this}});
    return route.fulfill({status,json:data});
   }
   if(u.origin===origin&&u.pathname==='/api/drafts'&&req.method()==='GET'){
    const raw=await kv('GET',draftKey(f.uid,u.searchParams.get('id')));return route.fulfill({json:readStoredDraft(raw)});
   }
   if(u.origin===origin&&u.pathname==='/api/ebay-listing-operations'){
    let status=200,data;await f.off({method:req.method(),headers:{authorization:'Bearer '+f.uid,origin:f.cfg.origin},query:Object.fromEntries(u.searchParams),body:req.method()==='POST'?req.postDataJSON():{}},{setHeader(){},status(n){status=n;return this},json(d){data=d;return this}});return route.fulfill({status,json:data});
   }
   if(u.origin!==origin||u.pathname.startsWith('/api/'))return route.fulfill({status:204,body:''});
   return route.continue();
  });
  await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
  await page.goto(origin+'/index.html');await page.waitForFunction(()=>!!window.CardResellListingAvailability&&typeof renderCollectionView==='function');
  await page.evaluate(({uid,drafts})=>{
   window.googleUser={uid};window._crIdToken=async()=>window.googleUser?.uid||null;
   window.availabilityDrafts=drafts;window.downloads=[];window.photoMode='';window.photoCalls=0;
   HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push(this.download);};
   window.ensureExportablePhotos=async()=>{photoCalls++;if(photoMode)await changeDuringPhotos(photoMode);return {ok:true,reason:'NONE',urls:[],localCount:0};};
   window.resetExport=()=>{
    _draftsState.rows=availabilityDrafts.map(d=>({draftId:d.draftId,summary:{title:d.title,slot:'ebay:fixed-price',sku:d.sku,rev:d.rev}}));
    _draftsState.selected=new Set(availabilityDrafts.map(d=>d.draftId));_draftsState.signedIn=true;_draftsState.bulk=null;_draftsState.dl=null;downloads=[];photoMode='';photoCalls=0;
   };resetExport();
  },{uid:f.uid,drafts:[f.draft,second]});
  const single=()=>page.evaluate(id=>_draftDownloadGo(id),f.draft.draftId);
  await single();check(await page.evaluate(()=>downloads.length===1&&photoCalls===1),'clear copy downloads after check at '+width);
  check(requests===2,'single export checks before and after photo preparation at '+width);
  await page.evaluate(uid=>{resetExport();localStorage.setItem(getUserKey('copy_sales_v1'),JSON.stringify({version:1,entries:[{copyId:uid,saleId:'local-sale',recordedAt:1}]}));},f.uid);
  await single();check(await page.evaluate(()=>!downloads.length&&!photoCalls&&_draftsState.dl.error.includes('saved on this device')),'local permanent sale receipt blocks before cloud sync at '+width);
  await page.evaluate(()=>localStorage.removeItem(getUserKey('copy_sales_v1')));
  await f.call('plan');await page.evaluate(()=>resetExport());await single();
  check(await page.evaluate(()=>!downloads.length&&!photoCalls&&_draftsState.dl.error.includes('Reserved for eBay')),'held copy stops before photo upload at '+width);
  await page.evaluate(()=>resetExport());await page.evaluate(()=>_draftDownloadSelected());
  check(await page.evaluate(()=>!downloads.length&&!_draftsState.bulk.success&&_draftsState.selected.size===2),'one held copy stops entire file and keeps selection at '+width);
  await page.evaluate(({uid})=>{
   const cards=[{id:uid,card:'Charizard',set:'Base Set',number:'4',game:'pokemon',currentValue:32,buyPrice:10},{id:'second',card:'Second physical card',currentValue:2,buyPrice:1}];
   window.loadPortData=()=>cards;document.querySelectorAll('.view').forEach(n=>n.style.display='none');document.getElementById('collectionView').style.display='block';renderCollectionView();
  },{uid:f.uid});
  await page.waitForFunction(()=>document.querySelector('.collection-listing-status')?.textContent.includes('Reserved for eBay'));
  check((await page.locator('.collection-listing-status').first().textContent()).includes('plan not sent'),'Collection explains reservation without implying live listing at '+width);
  await page.getByRole('button',{name:'Select visible',exact:true}).click();
  await page.getByRole('button',{name:'Export selected',exact:true}).click();
  check(await page.evaluate(()=>downloads.some(n=>n==='cardsell_collection_selected.csv')),'inventory backup stays available for held copies at '+width);
  await page.getByRole('button',{name:'Review eBay plan',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('ebayListingOperations')?.textContent.includes('Plan saved · not sent'));
  const dialog=page.locator('#ebayListingOperations');check(await dialog.locator('section').count()===1,'card link opens just its saved operation at '+width);
  const bounds=await dialog.boundingBox();check(bounds.x>=0&&bounds.x+bounds.width<=width,'recovery dialog fits screen at '+width);
  mkdirSync('/tmp/cardresell-availability-shots',{recursive:true});await page.screenshot({path:'/tmp/cardresell-availability-shots/held-'+width+'.png'});
  await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Cancel unsent plan',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.collection-listing-status')?.textContent.includes('No recorded sale'));
  check(true,'explicit cancellation refreshes Collection status at '+width);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(()=>resetExport());await page.evaluate(()=>_draftDownloadSelected());
  check(await page.evaluate(()=>downloads.length===1&&_draftsState.bulk.success&&_draftsState.bulk.items.length===2),'released copies combine into one file at '+width+': '+await page.evaluate(()=>JSON.stringify({bulk:_draftsState.bulk,dl:_draftsState.dl,downloads}))); 
  await page.evaluate(()=>{resetExport();photoMode='plan'});await single();
  check(await page.evaluate(()=>!downloads.length&&photoCalls===1&&_draftsState.dl.error.includes('Reserved for eBay')),'hold saved while photos upload prevents download at '+width);
  await f.call('cancel');await page.evaluate(()=>{resetExport();photoMode='plan'});await page.evaluate(()=>_draftDownloadSelected());
  check(await page.evaluate(()=>!downloads.length&&!_draftsState.bulk.busy&&!_draftsState.dl.busy&&_draftsState.bulk.message.includes('Reserved for eBay')),'final batch check stops changed hold and leaves retry controls unlocked at '+width);
  await f.call('cancel');await page.evaluate(()=>{resetExport();photoMode='revision'});await single();
  check(await page.evaluate(()=>!downloads.length&&_draftsState.dl.error.includes('changed')),'draft revision changed during photos cannot download old bytes at '+width);
  await kv('SET',f.dk,JSON.stringify(f.draft));await page.evaluate(()=>resetExport());failCheck=true;await single();
  check(await page.evaluate(()=>!downloads.length&&!photoCalls&&_draftsState.dl.error.includes('Retry')),'check outage is recoverable and does not upload photos at '+width);
  await page.getByRole('button',{name:'Check listing status',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.collection-listing-status')?.textContent.includes('unavailable'));
  check(!(await page.locator('.collection-listing-status').first().textContent()).includes('No recorded'),'failed refresh retracts old clear status at '+width);
  failCheck=false;await page.getByRole('button',{name:'Check listing status',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.collection-listing-status')?.textContent.includes('No recorded'));
  malformed=true;await page.evaluate(()=>resetExport());await single();check(await page.evaluate(()=>!downloads.length&&!photoCalls&&_draftsState.dl.error.includes('incomplete result')),'malformed successful response cannot authorize download at '+width);malformed=false;
  await page.evaluate(()=>resetExport());delay=true;await page.evaluate(id=>{window.pendingExport=_draftDownloadGo(id);},f.draft.draftId);
  for(let n=0;n<100&&!release;n++)await new Promise(r=>setTimeout(r,10));check(!!release,'delayed request reached server at '+width);
  await page.evaluate(()=>googleUser={uid:'another-owner'});delay=false;release();await page.evaluate(()=>pendingExport);
  check(await page.evaluate(()=>!downloads.length&&!photoCalls),'account switch during check prevents old account download at '+width);
  check(errors.length===0,'no browser errors at '+width+': '+errors.join('; '));await page.close();
 }
} finally {await browser.close();await new Promise(r=>server.close(r));}
finish(checks,0);
