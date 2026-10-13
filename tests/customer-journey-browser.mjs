// UI integration review with local assets and synthetic account/catalogue data.
// No purchases, inference or external services. CR_CHROMIUM selects browser.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {extname,join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {publicMembershipCatalogue} from '../api/_membershipPurchaseRoutes.js';
const root=resolve(new URL('../',import.meta.url).pathname),shots=process.env.CR_SHOT_DIR;
if(shots)mkdirSync(shots,{recursive:true});
const server=createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);let path=join(root,pathname==='/'?'index.html':pathname);if(!existsSync(path)&&existsSync(path+'.html'))path+='.html';if(!existsSync(path))path=join(root,'public',pathname);if(!existsSync(path)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp'})[extname(path)]||'application/octet-stream');res.end(readFileSync(path))});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM||undefined,args:['--no-sandbox']});let checks=0;
const check=(label,a,b)=>{assert.deepEqual(a,b,label);checks++;console.log('✓ '+label)};
try {
for (const width of [390,1280]) {
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{
   const u=r.request().url();
   if(u.endsWith('/api/membership-catalogue'))return r.fulfill({json:{...publicMembershipCatalogue(),purchaseEnabled:false}});
   if(u.startsWith(origin)&&!u.includes('/api/'))return r.continue();
   return r.fulfill({status:503,contentType:'application/json',body:'{"error":"offline_fixture"}'});
 });
 await page.goto(origin);
 await page.waitForFunction(()=>typeof searchWithTPL==='function');
 await page.evaluate(()=>{
   window._catalogCalls=0;
   // Substitute only the remote catalogue boundary; retain the shipped UI,
   // request coordination, selection, price handling and local persistence.
   searchWithTPL=async()=>{window._catalogCalls++;return {cards:[{id:'fixture-pikachu',name:'Pikachu',number:'025',set:{name:'Fixture set',id:'fixture'},rarity:'Common',prices:{raw:{near_mint:{tcgplayer:{market:1}}}}}]}};
 });
 await page.getByRole('textbox',{name:'Search card name',exact:true}).fill('Pikachu');
 await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.locator('#searchModalGrid [data-idx="0"]').click();
 check(width+' search reaches the selected card',await page.evaluate(()=>selectedCard?.name),'Pikachu');
 check(width+' selected cheap card has useful advice',await page.locator('#sellingAdvice [data-advice-output]').getAttribute('data-route'),'hold-for-lot');
 await page.locator('#addCollectionBtn').click();
 check(width+' save form receives keyboard focus',await page.evaluate(()=>document.activeElement.id),'mCardName');
 await page.locator('#flipModal .modal-save').focus();
 await page.keyboard.press('Tab');
 check(width+' Tab stays inside save dialog',await page.evaluate(()=>document.activeElement.id),'mCardName');
 await page.keyboard.press('Escape');
 check(width+' Escape cancels without saving',await page.evaluate(()=>loadPortData().length),0);
 check(width+' Escape restores focus',await page.evaluate(()=>document.activeElement.id),'addCollectionBtn');
 await page.locator('#addCollectionBtn').click();
 check(width+' save form has the selected value',await page.locator('#mCurrentValue').inputValue(),'1.00');
 await page.locator('#mBuyPrice').fill('-2');
 await page.locator('#flipModal .modal-save').click();
 check(width+' invalid cost stays in the form',await page.locator('#flipModal').isVisible(),true);
 check(width+' invalid cost writes no card',await page.evaluate(()=>loadPortData().length),0);
 await page.locator('#mBuyPrice').fill('0');
 await page.locator('#mCurrentValue').fill('0');
 await page.locator('#flipModal .modal-save').click();
 check(width+' successful save closes form',await page.locator('#flipModal').isVisible(),false);
 check(width+' save restores keyboard focus',await page.evaluate(()=>document.activeElement.id),'addCollectionBtn');
 check(width+' zero survives persistence',await page.evaluate(()=>loadPortData()[0].currentValue),0);
 check(width+' edited value records seller provenance',await page.evaluate(()=>loadPortData()[0].valueSource),'seller');
 check(width+' signed-out save identifies device storage',(await page.locator('#collectionSaveLabel').textContent()).includes('on this device'),true);
 await page.getByRole('button',{name:'View Collection →',exact:true}).click();
 check(width+' confirmation goes to Cards instead of last Drafts section',await page.locator('#collectionView').isVisible(),true);
 check(width+' fresh local collection has no false sync error',await page.locator('#collectionSyncRetry').isVisible(),false);
 check(width+' collection renders saved identity',(await page.locator('#collectionWrap').textContent()).includes('Pikachu'),true);
 if(shots)await page.screenshot({path:`${shots}/journey-collection-${width}.png`});
 await page.getByRole('button',{name:'Select visible',exact:true}).click();
 await page.getByRole('button',{name:'Sign in to prepare drafts',exact:true}).click();
 await page.waitForURL('**/signin?next=collection');
 check(width+' draft preparation preserves collection destination',new URL(page.url()).search,'?next=collection');
 // Return visit: the anonymous card persists across the sign-in detour.
 await page.goto(origin);
 check(width+' saved card survives reload',await page.evaluate(()=>loadPortData().length),1);
 await page.evaluate(()=>switchView('drafts'));
 await page.waitForFunction(()=>!_draftsState.loading);
 check(width+' draft sign-in preserves the task',await page.locator('#draftsWrap .empty-primary').getAttribute('href'),'/signin?next=drafts');
 await page.locator('#draftsWrap .empty-primary').click();
 await page.waitForFunction(()=>typeof window._safeSignInDestination==='function');
 check(width+' safe sign-in accepts drafts',await page.evaluate(()=>_safeSignInDestination(new URLSearchParams(location.search).get('next'))),'/?next=drafts');
 for (const bad of ['//evil.test','https://evil.test','/api/account','/signin','javascript:alert(1)']) {
   check(width+' refuses redirect '+bad,await page.evaluate(v=>_safeSignInDestination(v),bad),'/');
 }
 for (const task of ['lookup','collection','drafts','flips','scan','grade']) {
   const destination=await page.evaluate(v=>_safeSignInDestination(v),task);
   check(width+' safe sign-in accepts '+task,destination,'/?next='+task);
 }
 await page.goto(origin+'/?next=drafts&cr_campaign=qa#kept');
 await page.evaluate(()=>{window.googleUser={sub:'journey-fixture'};_crResumeSignInTask()});
 check(width+' sign-in resumes drafts',await page.locator('#draftsView').isVisible(),true);
 check(width+' return consumes only next',new URL(page.url()).search+'#'+new URL(page.url()).hash.slice(1),'?cr_campaign=qa#kept');
 await page.evaluate(()=>{
   window._automaticOperations=[];
   navigator.mediaDevices.getUserMedia=async()=>{window._automaticOperations.push('camera');throw Error('not allowed')};
   _startSingleScanCapture=()=>window._automaticOperations.push('scan');
   startSingleGradeFlow=()=>window._automaticOperations.push('grade');
 });
 for (const task of ['scan','grade']) {
   await page.evaluate(task=>{history.replaceState(null,'','/?next='+task+'&cr_campaign=qa');_crResumeSignInTask()},task);
   check(width+' resumes '+task+' at the chooser',await page.locator(task==='grade'?'#scanMenuTabGrade':'#scanMenuTabId').getAttribute('aria-selected'),'true');
   check(width+' resume starts no camera or paid operation',await page.evaluate(()=>window._automaticOperations),[]);
   await page.keyboard.press('Escape');
 }
 // Exercise the real cloud-sync client against controlled service responses.
 await page.evaluate(()=>{window._googleIdToken='synthetic';switchView('collection');switchCollectionSection('cards')});
 await page.evaluate(()=>_pushUserData());
 check(width+' failed cloud sync offers recovery',await page.locator('#collectionSyncRetry').isVisible(),true);
 check(width+' failed cloud sync does not claim account save',(await page.locator('#collectionSyncStatus').textContent()).includes('on this device only'),true);
 let syncRequests=0;
 await page.route('**/api/user-data',r=>{syncRequests++;return r.fulfill({json:{ok:true}})});
 await page.locator('#collectionSyncRetry').click();
 await page.waitForFunction(()=>document.getElementById('collectionSyncStatus').textContent==='Saved to your account.');
 check(width+' retry makes one controlled sync request',syncRequests,1);
 check(width+' confirmed sync removes retry',await page.locator('#collectionSyncRetry').isVisible(),false);
 await page.unroute('**/api/user-data');
 // Real anonymous click gate, without initiating any authentication.
 await page.evaluate(()=>{window.googleUser=null;switchView('lookup')});
 await page.locator(await page.locator('#scanBtn').isVisible()?'#scanBtn':'#idScanSubBtn').click();
 await page.waitForURL('**/signin?next=scan');
 check(width+' ID entry keeps intent through navigation',new URL(page.url()).search,'?next=scan');
 await page.goto(origin);await page.evaluate(()=>{window.googleUser=null;openScanMenuOnTab('grade')});
 await page.waitForURL('**/signin?next=grade');
 check(width+' grade entry keeps intent through navigation',new URL(page.url()).search,'?next=grade');
 check(width+' no uncaught journey errors',errors,[]);
 if(shots)await page.screenshot({path:`${shots}/journey-signin-${width}.png`});
 await page.close();
}
// First-visit demo: exercise shipped request coordination and real tab clicks.
for (const width of [390,1280]) {
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
 await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
 await page.route('**/*',r=>{
   const u=r.request().url();
   if(u.endsWith('/api/membership-catalogue'))return r.fulfill({json:{...publicMembershipCatalogue(),purchaseEnabled:false}});
   if(u.startsWith(origin)&&!u.includes('/api/'))return r.continue();
   return r.fulfill({status:503,contentType:'application/json',body:'{"error":"offline_fixture"}'});
 });
 await page.goto(origin);
 await page.waitForFunction(()=>typeof searchWithTPL==='function');
 await page.evaluate(()=>{
   searchWithTPL=()=>new Promise(resolve=>{window._releaseDemoCatalogue=()=>resolve({cards:[{id:'fixture-charizard',name:'Charizard',number:'004',set:{name:'Fixture set',id:'fixture'},rarity:'Rare',prices:{raw:{near_mint:{tcgplayer:{market:20}}}}}]})});
   window._demoOutcome=null;
   autoRunExampleCard().then(result=>window._demoOutcome=result);
 });
 await page.waitForFunction(()=>typeof window._releaseDemoCatalogue==='function');
 await page.locator('.view-tab[data-view="collection"]').click();
 await page.waitForFunction(()=>window._demoOutcome!==null);
 check(width+' leaving Lookup abandons the pending demo',await page.evaluate(()=>window._demoOutcome),'abandoned');
 await page.evaluate(()=>window._releaseDemoCatalogue());
 await page.waitForTimeout(200);
 check(width+' late demo response does not select a card',await page.evaluate(()=>selectedCard),null);
 check(width+' Collection stays visible after late demo response',await page.locator('#collectionView').isVisible(),true);
 await page.locator('.view-tab[data-view="lookup"]').click();
 check(width+' returning to Lookup has no stale example text',await page.locator('#searchInput').inputValue(),'');
 check(width+' returning to Lookup has no stale demo rows',await page.locator('#dropList .drop-item').count(),0);
 await page.evaluate(()=>{window._demoOutcome=null;autoRunExampleCard().then(result=>window._demoOutcome=result)});
 await page.evaluate(()=>window._releaseDemoCatalogue());
 await page.waitForFunction(()=>window._demoOutcome!==null);
 check(width+' idle visitor still receives the example',await page.evaluate(()=>window._demoOutcome),true);
 check(width+' idle example selects the catalogue card',await page.evaluate(()=>selectedCard?.name),'Charizard');
 await page.close();
}
console.log(`SUITE COMPLETE: customer-journey-browser: ${checks} passed, 0 failed`);
}finally{await browser.close();await new Promise(r=>server.close(r))}
