// Full shipped UI with synthetic scan/catalogue responses. No real scan credits.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {extname,join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {publicMembershipCatalogue} from '../api/_membershipPurchaseRoutes.js';
import {buildListingTitle} from '../api/_listingTitle.js';
import {buildListingPacket} from '../api/_listingPacket.js';
import {skuFor,projectIdentityForWire} from '../api/_cardIdentity.js';
const root=resolve(new URL('../',import.meta.url).pathname),shots=process.env.CR_SHOT_DIR;
if(shots)mkdirSync(shots,{recursive:true});
const server=createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);let path=join(root,pathname==='/'?'index.html':pathname);if(!existsSync(path)&&existsSync(path+'.html'))path+='.html';if(!existsSync(path))path=join(root,'public',pathname);if(!existsSync(path)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp'})[extname(path)]||'application/octet-stream');res.end(readFileSync(path))});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM||undefined,args:['--no-sandbox']});let checks=0;
const check=(label,a,b)=>{assert.deepEqual(a,b,label);checks++;console.log('✓ '+label)};
const catalogue={id:'fixture-1',name:'Bulbasaur',number:'001',set:{id:'fixture',name:'Fixture set'},rarity:'Common',tcgplayer:{prices:{normal:{market:3},holofoil:{market:12},reverseHolofoil:{market:9},stamped:{market:null}}}};
// Owner's BW52 regression, with an explicitly synthetic price.
const reverseCatalogue={id:'bwp-BW52',name:'Lillipup',number:'BW52',set:{id:'bwp',name:'BW Black Star Promos'},rarity:'Promo',tcgplayer:{prices:{reverseHolofoil:{market:2.25}}}};
try {
const base={card:'Bulbasaur',set:'Fixture set',setCode:'fixture',number:'001',game:'pokemon',condition:'NM'};
const finished={...base,finish:'Reverse Holofoil'};
check('finish stays descriptive and preserves existing SKU',skuFor(finished),skuFor(base));
check('server wire preserves finish',projectIdentityForWire(finished).finish,'Reverse Holofoil');
check('draft title identifies confirmed finish',buildListingTitle(finished).title.includes('Reverse Holofoil'),true);
const packet=buildListingPacket(finished,{now:Date.now(),price:9,priceSource:'seller'});
check('draft item specifics identify finish',packet.aspects?.optional?.Finish,['Reverse Holofoil']);
for (const width of [320,390,1280]) {
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];let scans=0,priceCalls=0,drafts=0,scanCatalogue=catalogue;
 page.on('pageerror',e=>{errors.push(e.message);console.log('APP ERROR',e.message)});
 await page.route('**/*',r=>{
   const u=r.request().url();
   if(u.endsWith('/api/membership-catalogue'))return r.fulfill({json:{...publicMembershipCatalogue(),purchaseEnabled:false}});
   if(u.includes('/api/scan')){scans++;return r.fulfill({json:{card_name:scanCatalogue.name,set_name:scanCatalogue.set.name,set_code:scanCatalogue.set.id,card_number:scanCatalogue.number,card_type:'pokemon',grounded_id:scanCatalogue.id,foil_hint:'foil'}})}
   if(u.includes('api.pokemontcg.io/v2/cards/fixture-1')){priceCalls++;return r.fulfill({json:{data:catalogue}})}
   if(u.includes('api.pokemontcg.io/v2/cards/bwp-BW52')){priceCalls++;return r.fulfill({json:{data:reverseCatalogue}})}
   if(u.includes('api.scryfall.com/cards/search'))return r.fulfill({json:{data:[{name:'Lightning Bolt',set_name:'Fixture',collector_number:'1',finishes:['nonfoil','foil','etched'],prices:{usd:null,usd_foil:'4.50',usd_etched:'7.00'}}]}});
   if(u.includes('/api/drafts'))drafts++;
   if(u.startsWith(origin)&&!u.includes('/api/'))return r.continue();
   return r.fulfill({status:503,json:{error:'offline_fixture'}});
 });
 await page.goto(origin);await page.evaluate(w=>{document.documentElement.dataset.theme=w===1280?'dark':'light'},width);await page.waitForFunction(()=>typeof _scanApplyFinishReview==='function' && typeof _bulkScanOne==='function');
 await page.evaluate(async()=>{
   // Only substitute image QC/compression (covered by binder camera suite).
   // Keep actual scan HTTP, catalogue fetch, mapping and persistence functions.
   _bulkCheckPhoto=async()=>null;compressImage=async()=>'c3ludGhldGlj';window.cardResellScanRequest=fetch;
   const item={file:new File(['synthetic'],'card.jpg',{type:'image/jpeg'}),scanUid:'finish-fixture'};
   window._bulkQueue=[item];
   window._bulkResults=[await _bulkScanOne(item,'bulk-row-0',false)];
   document.getElementById('bulkScanOverlay').style.display='flex';
   _bulkShowSection('processing');
   document.getElementById('bulkResultsList').innerHTML='<div id="bulk-row-0" style="display:flex;align-items:center;gap:.75rem;padding:.6rem .75rem;background:#111;border-radius:10px;border:1px solid #1e1e1e"></div>';
   _bulkUpdateRow('bulk-row-0',window._bulkResults[0]);
 });
 const initial=await page.evaluate(()=>window._bulkResults[0]);
 check(width+' identifies card',initial.success,true);
 check(width+' automatic estimate is not seller confirmation',initial.finishConfirmed,false);
 check(width+' generic foil signal uses automatic base estimate',initial.marketPrice,3);
 check(width+' finish review is optional',initial.finishReviewRequired,false);
 check(width+' dropdown defaults to estimate',await page.locator('#bulk-row-0 .scan-finish-chip').textContent(),'Normal / non-foil ▾');
 check(width+' subtotal immediately includes price',await page.locator('#bulkPackTrackerAmt').textContent(),'$3.00');
 check(width+' scan billed once',scans,1);
 check(width+' automatic price is labeled as an estimate',await page.locator('#bulk-row-0 .scan-price-basis summary').textContent(),'Base-printing estimate');
 const basis=page.locator('#bulk-row-0 .scan-price-basis'),summary=basis.locator('summary');
 const beforeBasis=await page.evaluate(()=>JSON.stringify(window._bulkResults));
 await summary.focus();await page.keyboard.press('Enter');
 check(width+' price explanation opens by keyboard',await basis.getAttribute('open'),'');
 check(width+' explains guess without blocking price',(await basis.innerText()).includes('Foil is not confirmed'),true);
 check(width+' does not call estimate a verified sale',(await basis.innerText()).includes('not a verified sale'),true);
 check(width+' explains unchosen condition',(await basis.innerText()).includes('Condition has not been chosen'),true);
 check(width+' does not invent provider timestamp',(await basis.innerText()).includes('Provider update time is not available'),true);
 check(width+' explanation makes no new price request',priceCalls,1);
 check(width+' explanation leaves batch unchanged',await page.evaluate(()=>JSON.stringify(window._bulkResults)),beforeBasis);
 check(width+' expanded explanation fits viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(shots)await page.screenshot({path:`${shots}/price-basis-${width}.png`});
 await page.keyboard.press('Enter');
 check(width+' explanation collapses by keyboard',await basis.getAttribute('open'),null);

 check(width+' estimate persists without confirmation',await page.evaluate(()=>_scanFinishFields(window._bulkResults[0]).finishKey),'normal');
 const savedBase=await page.evaluate(()=>{
   _bulkSaveToCollection(window._bulkResults,{0:0});
   const saved=loadPortData()[0];savePortData([]);
   return {basis:saved.finishBasis,confirmed:saved.finishConfirmed,value:saved.currentValue};
 });
 check(width+' Collection preserves base assumption',savedBase.basis,'base_printing');
 check(width+' Collection does not turn base into confirmation',savedBase.confirmed,false);
 check(width+' Collection preserves base price',savedBase.value,3);
 check(width+' generic Lookup estimate retained',await page.evaluate(()=>_scanPriceVariantsFromFeed({market:7,variant:'tcgplayer'})[0].market),7);
 await page.locator('#bulk-row-0 .scan-finish-chip').click();
 check(width+' guessed finish highlighted',await page.locator('[data-finish-key="normal"]').getAttribute('aria-pressed'),'true');
 await page.locator('[data-finish-cancel]').click();
 check(width+' cancel preserves automatic price',await page.evaluate(()=>window._bulkResults[0].marketPrice),3);
 if(shots)await page.screenshot({path:join(shots,'bulk-finish-'+width+'.png')});
 await page.locator('#bulk-row-0 .scan-finish-chip').click();await page.locator('[data-finish-key="reverseHolofoil"]').click();
 check(width+' one tap closes finish menu',await page.locator('#scanFinishPicker').count(),0);
 check(width+' correction updates price',await page.evaluate(()=>window._bulkResults[0].marketPrice),9);
 check(width+' correction records seller choice',await page.evaluate(()=>window._bulkResults[0].finishConfirmed),true);
 check(width+' correction uses no scan credits',scans,1);
 await page.locator('#bulk-row-0 .scan-finish-chip').click();await page.locator('[data-finish-key="stamped"]').click();
 check(width+' missing finish price stays unknown',await page.evaluate(()=>window._bulkResults[0].marketPrice),null);
 await page.locator('#bulk-row-0 .scan-finish-chip').click();await page.locator('[data-finish-key="normal"]').click();
 check(width+' normal finish updates price',await page.evaluate(()=>window._bulkResults[0].marketPrice),3);
 check(width+' choosing finish still leaves price an estimate',await summary.textContent(),'Market estimate');
 await summary.click();
 check(width+' chosen finish is not independently verified',(await basis.innerText()).includes('chosen by you, not independently verified'),true);
 await summary.click();

 await page.evaluate(async()=>{const original=promptInline;try{promptInline=async()=> '8.50';await bulkEditPrice('bulk-row-0')}finally{promptInline=original}});
 check(width+' price edit immediately relabels evidence',await summary.textContent(),'Your price');
 check(width+' seller edit retains actual value',await page.evaluate(()=>window._bulkResults[0].marketPrice),8.5);
 await page.evaluate(()=>bulkSetFinish('bulk-row-0','normal'));
 check(width+' finish repricing returns to market evidence',await summary.textContent(),'Market estimate');
 await page.evaluate(()=>{_bulkSaveToCollection(window._bulkResults,{0:5});document.getElementById('bulkScanOverlay').style.display='none';switchView('collection');switchCollectionSection('cards')});
 check(width+' selected finish saves to Collection',await page.evaluate(()=>loadPortData()[0].finishKey),'normal');
 check(width+' selected value saves to Collection',await page.evaluate(()=>loadPortData()[0].currentValue),3);
 await page.reload();
 check(width+' finish survives reload',await page.evaluate(()=>loadPortData()[0].finishKey),'normal');
 check(width+' refresh uses matching finish price',await page.evaluate(()=>_fetchPriceForEntry(loadPortData()[0])),3);
 const guesses=await page.evaluate(()=>{
   const info={variant:'holofoil',marketPrice:12,prices:{normal:3,holofoil:12,reverseHolofoil:9}};
   const r={foilHint:'non_foil',marketPrice:12};_scanApplyFinishReview(r,info);
   const generic={marketPrice:7,priceVariant:'tcgplayer'};_scanApplyFinishReview(generic,{marketPrice:7,variant:'tcgplayer'});
   return {normal:r.marketPrice,generic:generic.marketPrice,finish:generic.finishKey};
 });
 check(width+' nonfoil hint selects normal',guesses.normal,3);
 check(width+' generic source price is retained',guesses.generic,7);
 check(width+' generic source is not invented finish',guesses.finish,'');
 const edges=await page.evaluate(()=>{
   const result=[];
   for(const prices of [{normal:{market:null},reverseHolofoil:{market:45.26}},{normal:{market:0},reverseHolofoil:{market:45.26}},{holofoil:{market:12}},{reverseHolofoil:{market:45.26}}]){
     const row={cardType:'pokemon',foilHint:'foil',success:true};_scanApplyFinishReview(row,{variant:Object.keys(prices).at(-1),prices});
     result.push({market:row.marketPrice,key:row.finishKey,basis:_scanPriceBasisHtml(row)});
   }
   return result;
 });
 check(width+' missing base does not acquire premium value',edges[0].market,null);
 check(width+' zero base price remains zero',edges[1].market,0);
 check(width+' holo-only printing still prices automatically',edges[2].market,12);
 check(width+' reverse-only feed prices automatically',edges[3].market,45.26);
 check(width+' sole finish default is explained',edges[3].basis.includes('only finish returned by the catalogue'),true);


 const evidence=await page.evaluate(()=>{
   const render=r=>{const d=document.createElement('div');d.innerHTML=_scanPriceBasisHtml({success:true,...r});return {label:d.querySelector('summary').textContent,text:d.textContent,images:d.querySelectorAll('img').length}};
   return {seller:render({marketPrice:0,priceSource:'seller',conditionChosen:true,condition:'LP'}),unknown:render({marketPrice:4}),missing:render({marketPrice:null,priceSource:'comp'}),invalid:render({marketPrice:NaN,priceSource:'comp'}),unsafe:render({marketPrice:1,priceSource:'comp',finishConfirmed:true,finish:'<img src=x onerror=alert(1)>',conditionChosen:true,condition:'<img src=x>'})};
 });
 check(width+' zero seller price stays seller supplied',evidence.seller.label,'Your price');
 check(width+' seller condition is not a pricing certification',evidence.seller.text.includes('does not certify condition-specific pricing'),true);
 check(width+' unknown source is not attributed to market',evidence.unknown.label,'Saved price');
 check(width+' missing price is not silently zero',evidence.missing.text.includes('not valued at $0'),true);
 check(width+' nonfinite price is unavailable',evidence.invalid.label,'Price details');
 check(width+' evidence text cannot create image markup',evidence.unsafe.images,0);

 scanCatalogue=reverseCatalogue;
 await page.evaluate(async()=>{
   _bulkCheckPhoto=async()=>null;compressImage=async()=>'c3ludGhldGlj';window.cardResellScanRequest=fetch;
   savePortData([]);
   const item={file:new File(['synthetic-reverse'],'reverse.jpg',{type:'image/jpeg'}),scanUid:'sole-finish-fixture'};
   window._bulkQueue=[item];window._bulkResults=[await _bulkScanOne(item,'bulk-row-0',false)];
   document.getElementById('bulkScanOverlay').style.display='flex';_bulkShowSection('processing');
   document.getElementById('bulkResultsList').innerHTML='<div id="bulk-row-0" style="display:flex;align-items:center;gap:.75rem;padding:.6rem .75rem;background:#111;border-radius:10px;border:1px solid #1e1e1e"></div>';
   _bulkUpdateRow('bulk-row-0',window._bulkResults[0]);
 });
 const reverse=await page.evaluate(()=>window._bulkResults[0]);
 check(width+' sole finish identifies Lillipup BW52',[reverse.success,reverse.cardName,reverse.cardNumber],[true,'Lillipup','BW52']);
 check(width+' sole reverse catalogue quote appears immediately',reverse.marketPrice,2.25);
 check(width+' sole reverse dropdown is already selected',await page.locator('#bulk-row-0 .scan-finish-chip').textContent(),'Reverse Holofoil ▾');
 check(width+' sole finish is an estimate without a confirmation gate',[reverse.finishEstimated,reverse.finishConfirmed,reverse.finishReviewRequired],[true,false,false]);
 check(width+' sole finish uses market estimate label',await summary.textContent(),'Market estimate');
 check(width+' sole finish no longer says choose before pricing',(await page.locator('#bulk-row-0').textContent()).includes('choose that finish if it matches'),false);
 check(width+' sole finish subtotal includes automatic quote',await page.locator('#bulkPackTrackerAmt').textContent(),'$2.25');
 check(width+' sole finish is counted as priced',await page.locator('#bulkPackTrackerStatus').textContent(),'1 card · Estimated market value');
 check(width+' sole finish uses one additional scan',scans,2);
 await summary.click();
 check(width+' sole default explains catalogue basis',(await basis.innerText()).includes('only finish returned by the catalogue'),true);
 check(width+' sole default fits viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(shots)await page.screenshot({path:join(shots,'sole-finish-'+width+'.png')});
 await summary.click();
 await page.locator('#bulk-row-0 .scan-finish-chip').click();
 check(width+' sole option is highlighted',await page.locator('[data-finish-key="reverseHolofoil"]').getAttribute('aria-pressed'),'true');
 await page.locator('[data-finish-cancel]').click();
 check(width+' opening menu does not confirm estimate',await page.evaluate(()=>window._bulkResults[0].finishConfirmed),false);
 await page.evaluate(()=>{_bulkSaveToCollection(window._bulkResults,{0:1});document.getElementById('bulkScanOverlay').style.display='none'});
 await page.reload();
 const savedReverse=await page.evaluate(()=>loadPortData()[0]);
 check(width+' sole finish survives Collection save and reload',[savedReverse.card,savedReverse.finishKey,savedReverse.finishBasis,savedReverse.finishConfirmed,savedReverse.currentValue],['Lillipup','reverseHolofoil','sole_available',false,2.25]);
 check(width+' Collection refresh matches automatic reverse finish',await page.evaluate(()=>_fetchPriceForEntry(loadPortData()[0])),2.25);
 await page.evaluate(()=>reviewCollectionFinish(loadPortData()[0].id));
 await page.locator('#scanFinishChoice').selectOption('__other');
 await page.locator('#scanFinishCustom').fill('Stamped promo');
 await page.locator('[data-finish-save]').click();
 const correctedReverse=await page.evaluate(()=>loadPortData()[0]);
 check(width+' sole default can still be corrected',[correctedReverse.finishKey,correctedReverse.finish,correctedReverse.finishConfirmed,correctedReverse.currentValue],['__other','Stamped promo',true,null]);
 check(width+' correction clears automatic basis',correctedReverse.finishBasis,'');
 check(width+' correction needs no new scan',scans,2);
 check(width+' no page errors',errors,[]);
 await page.close();
}
console.log(`PASS ${checks} scan finish checks`);
} finally {await browser.close();await new Promise(r=>server.close(r));}
