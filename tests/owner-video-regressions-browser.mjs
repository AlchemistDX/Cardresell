// Owner phone recording regressions. Real shipped UI, synthetic price/scan/draft
// boundaries. No account writes, paid scans, eBay uploads or external requests.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import assert from 'node:assert/strict';
const root=new URL('..',import.meta.url).pathname;
let checks=0;const check=(label,value,expected=true)=>{assert.deepEqual(value,expected,label);checks++};
const server=createServer((req,res)=>{const path=join(root,new URL(req.url,'http://fixture').pathname.replace(/^\/$/,'index.html'));if(!existsSync(path)){res.statusCode=404;return res.end()};res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(path)]||'application/octet-stream');res.end(readFileSync(path))});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM||undefined,args:['--no-sandbox']});
try{for(const width of [390,844]){
 const page=await browser.newPage({viewport:{width,height:width===390?844:390}});
 const writes=[];
 await page.route('**/*',route=>{const req=route.request(),url=req.url();if(req.method()!=='GET')writes.push(url);if(url.startsWith(origin)&&!url.includes('/api/'))return route.continue();return route.fulfill({status:503,json:{error:'offline_fixture'}})});
 await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));await page.goto(origin);
 await page.waitForFunction(()=>typeof createSingleScanDraft==='function'&&!!window.CardResellBulkLookup);
 await page.evaluate(()=>{
  window.googleUser={uid:'owner-fixture'};window._fbAuth={currentUser:{uid:'owner-fixture'}};window._googleIdToken='fixture';
  window.drafts=[];window.priceCalls=[];window.holdQuote=false;window.quote={marketPrice:20.43,variant:'holofoil',prices:{holofoil:{market:20.43,low:16.50,high:25.99}},imageUrl:'',tcgplayerUrl:'https://www.tcgplayer.com/product/fixture'};
  _bulkFetchPrice=async(...args)=>{priceCalls.push(args);if(holdQuote)await new Promise(r=>window.releaseQuote=r);return quote};
  _crCreateDraft=async payload=>{drafts.push(payload);return null};
  window.startSingle=(extra={})=>{_singleScanDraft=null;_pendingIdScanCard={name:'Machoke',number:'177',setName:'151',cardType:'pokemon',groundedId:'sv3pt5-177',...extra};_lastScanFrontBase64='cGhvdG8=';document.getElementById('scanOverlay').style.display='flex';_setScanBtns('success')};
 });
 await page.evaluate(()=>{startSingle();window.saving=createSingleScanDraft()});await page.evaluate(()=>saving);
 check('single scan asks for exact card pricing',await page.evaluate(()=>priceCalls.length),1);
 check('draft carries its quote, source, finish and seller photo',await page.evaluate(()=>{const d=drafts[0];return [d.price,d.priceSource,d.card.finish,d.card.condition,d.scanPhoto.dataUrl]}),[20.43,'comp','Holofoil','','data:image/jpeg;base64,cGhvdG8=']);
 check('quote is visible before draft',await page.locator('#scanPriceSummary').innerText().then(s=>s.includes('$20.43')));
 await page.evaluate(()=>{createSingleScanDraft();createSingleScanDraft()});await page.waitForFunction(()=>!_singleScanDraft.busy);
 check('double tap reuses same copy and quote',await page.evaluate(()=>[drafts.length,priceCalls.length,drafts[0].instanceId===drafts[1].instanceId]),[2,1,true]);
 await page.evaluate(()=>{document.getElementById('scanGradeCTA').classList.add('show');document.getElementById('scanSuccessBadge').style.display='flex';_setScanBtns('scanning')});
 check('new scan hides stale grading prompt',await page.locator('#scanGradeCTA').isVisible(),false);
 check('new scan hides stale success badge',await page.locator('#scanSuccessBadge').isVisible(),false);
 check('new scan hides old quote',await page.locator('#scanPriceSummary').isVisible(),false);
 await page.evaluate(()=>{quote=null;startSingle();window.saving=createSingleScanDraft()});await page.evaluate(()=>saving);
 check('unavailable quote remains empty',await page.evaluate(()=>[drafts.at(-1).price,drafts.at(-1).priceSource]),[null,null]);
 check('unavailable quote has a usable next step',await page.locator('#scanPriceSummary').innerText().then(s=>/unavailable/i.test(s)));
 const beforeSlab=await page.evaluate(()=>priceCalls.length);
 await page.evaluate(()=>{startSingle({grader:'PSA',grade:'9'});window.saving=createSingleScanDraft()});await page.evaluate(()=>saving);
 check('slab never inherits raw market price',await page.evaluate(()=>[priceCalls.length,drafts.at(-1).price]),[beforeSlab,null]);
 await page.evaluate(()=>{window.realTimeout=setTimeout;window.setTimeout=(f,ms,...args)=>realTimeout(f,ms===12000?40:ms,...args);holdQuote=true;startSingle();window.saving=createSingleScanDraft()});
 await page.evaluate(()=>saving);
 check('stalled pricing still permits an explicitly unpriced draft',await page.evaluate(()=>drafts.at(-1).price),null);
 await page.evaluate(()=>{window.setTimeout=realTimeout;holdQuote=false;releaseQuote();releaseQuote=null});
 check('late quote cannot rewrite the saved intent',await page.evaluate(()=>drafts.at(-1).price),null);
 let fallbackNumber='053/167';
 await page.route('**/api/tcg-price?**',route=>route.fulfill({json:{market:.30,variant:'holofoil',allVariants:{Holofoil:{market:.30},'Reverse Holofoil':{market:.43}},cardNumber:fallbackNumber,setName:'Twilight Masquerade',url:'https://www.tcgplayer.com/product/550097'}}));
 await page.evaluate(()=>{holdQuote=true;releaseQuote=null;startSingle({name:'Froslass',number:'053',setName:'Twilight Masquerade',groundedId:'tcgdex:sv06-053'});window.saving=createSingleScanDraft()});
 await page.evaluate(()=>saving);
 check('matching fallback can price a card while public catalogue stalls',await page.evaluate(()=>[drafts.at(-1).price,drafts.at(-1).card.finish]),[.30,'Holofoil']);
 await page.evaluate(()=>{holdQuote=false;releaseQuote();releaseQuote=null});
 fallbackNumber='007';
 await page.evaluate(()=>{quote=null;startSingle({name:'Froslass',number:'053',setName:'Twilight Masquerade'});window.saving=createSingleScanDraft()});await page.evaluate(()=>saving);
 check('fallback refuses another printing number',await page.evaluate(()=>drafts.at(-1).price),null);
 await page.unroute('**/api/tcg-price?**');
 // Account/photo replacement during pricing must not save or repaint stale state.
 for(const change of ['account','scan']){
  const count=await page.evaluate(()=>drafts.length);
  await page.evaluate(()=>{holdQuote=true;startSingle();window.saving=createSingleScanDraft()});await page.waitForFunction(()=>!!window.releaseQuote);
  await page.evaluate(change=>{if(change==='account')googleUser={uid:'different'};else{_pendingIdScanCard=null;_singleScanDraft=null}_setScanBtns('scanning');holdQuote=false;releaseQuote();releaseQuote=null},change);await page.evaluate(()=>saving);
  check(change+' change cannot create old draft',await page.evaluate(()=>drafts.length),count);
  await page.evaluate(()=>{googleUser={uid:'owner-fixture'}});
 }
 // The alternate View price & fees route must keep this physical copy's
 // photo without leaking it into an unrelated lookup or another account.
 await page.evaluate(()=>{
  quote={marketPrice:20.43,variant:'holofoil',prices:{holofoil:{market:20.43}}};
  window.originalFetchFallbackJson=fetchFallbackJson;
  fetchFallbackJson=async()=>({resOk:true,json:{data:{name:'Machoke',number:'177',set:{name:'151'},tcgplayer:{prices:{holofoil:{market:20.43}}}}}});
  startSingle();window.lookupCopyId=_singleScanDraft.instanceId;cancelScan();
 });
 await page.waitForFunction(()=>selectedCard?.name==='Machoke'&&document.getElementById('scanOverlay').style.display==='none');
 await page.evaluate(async()=>{_crSellApproved=selectedCard;await startListingDraft()});
 check('View price and fees retains scan photo and physical copy',await page.evaluate(()=>[drafts.at(-1).scanPhoto?.dataUrl,drafts.at(-1).instanceId===lookupCopyId]),['data:image/jpeg;base64,cGhvdG8=',true]);
 check('lookup card serialisation excludes private photo bytes',await page.evaluate(()=>!JSON.stringify(selectedCard).includes('cGhvdG8=')));
 for(const changed of [{number:'178'},{setName:'Base Set'}]){
  check('another printing cannot borrow scan photo',await page.evaluate(changed=>{
   const card=_scanMarkCard({...selectedCard,...changed},_singleScanDraft.pending);
   return _scanPhotoSnapshot(card,_crScanInstanceId(card));
  },changed),null);
 }
 await page.evaluate(()=>{window.lookupCardWithPhoto=selectedCard;setSelectedCard({...selectedCard});_crSellApproved=selectedCard});
 await page.evaluate(()=>startListingDraft());
 check('independent lookup cannot inherit prior scan photo',await page.evaluate(()=>drafts.at(-1).scanPhoto),null);
 await page.evaluate(()=>{googleUser={uid:'different'};setSelectedCard(lookupCardWithPhoto);_crSellApproved=selectedCard});
 await page.evaluate(()=>startListingDraft());
 check('account change cannot inherit prior scan photo',await page.evaluate(()=>drafts.at(-1).scanPhoto),null);
 await page.evaluate(()=>{googleUser={uid:'owner-fixture'};fetchFallbackJson=originalFetchFallbackJson});
 // OCR reads may suggest a catalogue name, but a wall of noise is not a name.
 await page.evaluate(()=>{
  window.readText='Ey af . pie roe C1 TEER SY Ther SI my ER Raa Q YT et Tey';
  Tesseract={createWorker:async()=>({setParameters:async()=>{},terminate:async()=>{},recognize:async()=>({data:{text:readText,confidence:20}})})};
  window.makeFile=async()=>{const c=document.createElement('canvas');c.width=500;c.height=700;return new File([await new Promise(r=>c.toBlob(r))],'test.png',{type:'image/png'})};
 });
 check('garbled OCR is not offered as a card name',await page.evaluate(async()=>CardResellScanTextRecovery.find(await makeFile(),{game:'pokemon',lookup:async()=>null})),null);
 check('sleeve letters recover Froslass through catalogue',await page.evaluate(async()=>_confirmCardByName('a Froslass i','pokemon')).then(r=>r?.name),'Froslass');
 // A saved-catalogue selection with no embedded prices still looks up its exact identity.
 await page.evaluate(()=>{
  document.getElementById('scanOverlay').style.display='none';quote={marketPrice:.17,variant:'holofoil',prices:{holofoil:.17}};
  window._bulkProcessing=false;window._bulkSaved=false;window._bulkDraftBusy=false;window._bulkQueue=[];
  window._bulkResults=[{rowId:'bulk-row-owner',file:new File(['fixture'],'f.jpg'),success:false,definiteMiss:true,scanGameHint:'pokemon',scanUid:'same-copy',copyUids:['same-copy'],condition:'LP',conditionChosen:true}];
  document.getElementById('bulkResultsList').innerHTML='<div id="bulk-row-owner"></div>';
  const data={game:'pokemon',provider:'TCGdex',sets:{sv06:'Twilight Masquerade'},asOf:'2026-10-30'};
  window.CardResellCatalog={...CardResellCatalog,search:async()=>({data,rows:[['sv06-053','Froslass','sv06','053','Rare','','en','',false]]})};
  CardResellBulkLookup.open('bulk-row-owner');
 });
 await page.locator('#bulkLookupDialog [name=name]').fill('Froslass');await page.getByRole('button',{name:'Search catalogue',exact:true}).click();
 await page.locator('#bulkLookupDialog .lookup-results button').first().click();await page.getByRole('button',{name:'Use this printing',exact:true}).click();
 await page.waitForFunction(()=>!document.getElementById('bulkLookupDialog'));
 check('manual recovery keeps physical copy and attaches its price',await page.evaluate(()=>{const r=_bulkResults[0];return [r.success,r.cardName,r.cardNumber,r.marketPrice,r.priceSource,r.copyUids[0],r.condition]}),[true,'Froslass','053',.17,'comp','same-copy','LP']);
 check('recovered price is visibly part of the batch',await page.locator('#bulk-row-owner').innerText().then(s=>s.includes('$0.17')));
 // Leaving a printing or account during its quote cannot accept a stale card.
 for(const change of ['back','close','account']){
  await page.evaluate(()=>{
   _fbAuth.currentUser={uid:'owner-fixture'};holdQuote=true;releaseQuote=null;
   _bulkResults=[{rowId:'bulk-row-owner',file:new File(['fixture'],'f.jpg'),success:false,definiteMiss:true,scanGameHint:'pokemon',scanUid:'same-copy',copyUids:['same-copy']}];
   CardResellBulkLookup.open('bulk-row-owner');
  });
  await page.locator('#bulkLookupDialog [name=name]').fill('Froslass');
  await page.getByRole('button',{name:'Search catalogue',exact:true}).click();
  await page.locator('#bulkLookupDialog .lookup-results button').first().click();
  await page.getByRole('button',{name:'Use this printing',exact:true}).click();
  await page.waitForFunction(()=>!!window.releaseQuote);
  if(change==='back')await page.getByRole('button',{name:'Back to results',exact:true}).click();
  else if(change==='close')await page.locator('#bulkLookupDialog').getByRole('button',{name:'Close',exact:true}).click();
  else await page.evaluate(()=>{_fbAuth.currentUser={uid:'different'}});
  await page.evaluate(()=>{holdQuote=false;releaseQuote();releaseQuote=null});
  await page.waitForTimeout(50);
  check('bulk '+change+' cancels stale printing acceptance',await page.evaluate(()=>[_bulkResults[0].success,_bulkResults[0].marketPrice??null]),[false,null]);
  if(change==='back')await page.locator('#bulkLookupDialog').getByRole('button',{name:'Close',exact:true}).click();
  // Account changes close the dialog themselves; racing that watcher with a
  // second click tests the harness timing, not the user's recovery behavior.
  await page.locator('#bulkLookupDialog').waitFor({state:'detached'});
 }
 // Guide coordinates are mapped to sensor pixels without dropping corners.
 const crop=await page.evaluate(()=>{
  const v={videoWidth:2880,videoHeight:3840,clientWidth:390,clientHeight:844,getBoundingClientRect:()=>({left:0,top:0,width:390,height:844})};
  const f={getBoundingClientRect:()=>({left:55,top:220,width:280,height:392})};
  return {guide:_liveCapGuideRect(v,f),full:_liveCapVisibleRect(v),missing:_liveCapGuideRect(v,null)};
 });
 check('guide crop removes excess background',crop.guide.sw*crop.guide.sh<crop.full.sw*crop.full.sh);
 check('guide crop contains every corner plus margin',crop.guide.sx<803&&crop.guide.sy<1001&&crop.guide.sx+crop.guide.sw>2078&&crop.guide.sy+crop.guide.sh>2784);
 check('unknown guide preserves visible image',crop.missing,crop.full);
 check('single ID explicitly uses guide capture',await page.evaluate(()=>{let options;openLiveCameraCapture=o=>{options=o};_startSingleScanCapture();return options.cropToGuide}));
 check('export help distinguishes collection backup and iPhone saving',await page.locator('#draftExportHelp').textContent().then(s=>s.includes('Save to Files')&&s.includes('Collection CSV')&&s.includes('ebay-draft')));
 check('no real mutation endpoints used',writes.filter(u=>/\/api\/(scan|drafts|user-data|scan-debit-id)/.test(u)),[]);
 await page.close();
}console.log(`owner-video-regressions-browser: ${checks} checks passed\nSUITE COMPLETE`)}finally{await browser.close();await new Promise(r=>server.close(r))}
