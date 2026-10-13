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
try {
const base={card:'Bulbasaur',set:'Fixture set',setCode:'fixture',number:'001',game:'pokemon',condition:'NM'};
const finished={...base,finish:'Reverse Holofoil'};
check('finish stays descriptive and preserves existing SKU',skuFor(finished),skuFor(base));
check('server wire preserves finish',projectIdentityForWire(finished).finish,'Reverse Holofoil');
check('draft title identifies confirmed finish',buildListingTitle(finished).title.includes('Reverse Holofoil'),true);
const packet=buildListingPacket(finished,{now:Date.now(),price:9,priceSource:'seller'});
check('draft item specifics identify finish',packet.aspects?.optional?.Finish,['Reverse Holofoil']);
for (const width of [390,1280]) {
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];let scans=0,priceCalls=0,drafts=0;
 page.on('pageerror',e=>{errors.push(e.message);console.log('APP ERROR',e.message)});
 await page.route('**/*',r=>{
   const u=r.request().url();
   if(u.endsWith('/api/membership-catalogue'))return r.fulfill({json:{...publicMembershipCatalogue(),purchaseEnabled:false}});
   if(u.includes('/api/scan')){scans++;return r.fulfill({json:{card_name:'Bulbasaur',set_name:'Fixture set',set_code:'fixture',card_number:'001',card_type:'pokemon',grounded_id:'fixture-1',foil_hint:'foil'}})}
   if(u.includes('api.pokemontcg.io/v2/cards/fixture-1')){priceCalls++;return r.fulfill({json:{data:catalogue}})}
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
 check(width+' scan keeps automatic holo estimate',initial.marketPrice,12);
 check(width+' finish review is optional',initial.finishReviewRequired,false);
 check(width+' dropdown defaults to estimate',await page.locator('#bulk-row-0 .scan-finish-chip').textContent(),'Holofoil ▾');
 check(width+' subtotal immediately includes price',await page.locator('#bulkScanOverlay').textContent().then(s=>s.includes('$12.00')),true);
 check(width+' scan billed once',scans,1);
 check(width+' estimate persists without confirmation',await page.evaluate(()=>_scanFinishFields(window._bulkResults[0]).finishKey),'holofoil');
 check(width+' generic Lookup estimate retained',await page.evaluate(()=>_scanPriceVariantsFromFeed({market:7,variant:'tcgplayer'})[0].market),7);
 await page.locator('#bulk-row-0 .scan-finish-chip').click();
 check(width+' guessed finish highlighted',await page.locator('[data-finish-key="holofoil"]').getAttribute('aria-pressed'),'true');
 await page.locator('[data-finish-cancel]').click();
 check(width+' cancel preserves automatic price',await page.evaluate(()=>window._bulkResults[0].marketPrice),12);
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
 check(width+' no page errors',errors,[]);
 await page.close();
}
console.log(`PASS ${checks} scan finish checks`);
} finally {await browser.close();await new Promise(r=>server.close(r));}
