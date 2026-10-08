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
try{
for(const theme of ['light','dark']) for(const viewport of [{width:320,height:740},{width:390,height:844},{width:844,height:390},{width:1280,height:900}]){
 const page=await browser.newPage({viewport,colorScheme:theme,reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const u=r.request().url();if(u.endsWith('/api/membership-catalogue'))return r.fulfill({json:{...publicMembershipCatalogue(),purchaseEnabled:false}});if(u.startsWith(origin)&&!u.includes('/api/'))return r.continue();return r.fulfill({status:503,contentType:'application/json',body:'{"error":"offline_fixture"}'})});
 await page.goto(origin);await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;window.googleUser={uid:'ui-fixture',displayName:'Review'};window._googleIdToken='fixture';document.getElementById('signInNudge').style.display='none';document.getElementById('googleSignInBtn').style.display='none';document.getElementById('googleUserBtn').style.display='flex';document.getElementById('googleName').textContent='Review';document.getElementById('dropList').style.display='none';},theme);
 for(const [tier,label] of Object.entries({free:'Subscriptions',starter:'Starter',casual:'Casual',pro:'Pro',business:'Business'})){
  await page.evaluate(t=>{window._userTier=t;updateTierUI(t);updateProUI()},tier);
  check('membership label '+tier,await page.locator('#headerMembershipLabel').textContent(),label);
  check('membership stays visible '+tier,await page.locator('#getProBtn').isVisible(),true);
 }
 await page.evaluate(()=>{window.googleUser=null;updateProUI()});
 check('signed-out membership resets',await page.locator('#headerMembershipLabel').textContent(),'Subscriptions');
 await page.evaluate(()=>{window.googleUser={sub:'fixture',emailVerified:true};updateProUI();document.getElementById('verifiedBadge').style.display='inline-flex'});
 check('verified badge belongs to avatar',await page.locator('.profile-avatar #verifiedBadge').count(),1);
 await page.locator('.profile-avatar').click();
 check('profile opens account settings',await page.locator('#settingsPanel').evaluate(e=>e.classList.contains('open')),true);
 check('theme is in settings',await page.locator('#settingsPanel [data-theme-toggle]').isVisible(),true);
 await page.locator('.settings-btn').click();
 check('settings button closes account panel',await page.locator('#settingsPanel').evaluate(e=>e.classList.contains('open')),false);
 await page.locator('#getProBtn').click();await page.waitForFunction(()=>!!document.querySelector('.membership-shop[open]'));
 check('membership opens subscriptions',await page.locator('.membership-shop[open] h2').textContent(),'Subscriptions');
 await page.keyboard.press('Escape');
 check('search precedes supporting banners',await page.evaluate(()=>{const search=document.getElementById('searchRow');return ['landingHero','howItWorksBar','scanGuaranteeBar'].every(id=>!!(search.compareDocumentPosition(document.getElementById(id))&Node.DOCUMENT_POSITION_FOLLOWING))}),true);
 check('repeated upgrade banner removed',await page.locator('#promoBanner').count(),0);
 check('search has an accessible label',await page.locator('#searchInput').getAttribute('aria-label'),'Search card name');
 check('brand loads',await page.locator('.hdr .brand-mark').evaluate(i=>i.complete&&i.naturalWidth>0),true);
 check('header has no overlap',await page.locator('.hdr').evaluate(h=>{const els=[h.querySelector('.logo'),...h.querySelector('.hdr-right').children].filter(e=>e.getBoundingClientRect().width>0);return els.every((a,i)=>els.slice(i+1).every(b=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return !(x.left<y.right&&x.right>y.left&&x.top<y.bottom&&x.bottom>y.top)}))}),true);
 check('header controls have 44px targets',await page.locator('.hdr .settings-btn,.hdr #shopBtn,.hdr .profile-avatar').evaluateAll(es=>es.every(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44})),true);
 const fit=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
 if(!(await fit())){console.log(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+1}).map(e=>({tag:e.tagName,id:e.id,class:e.className,width:e.getBoundingClientRect().width})).slice(0,20)));if(shots)await page.screenshot({path:shots+'/overflow.png'})}
 check('home fits viewport',await fit(),true);
 if(shots)await page.screenshot({path:`${shots}/home-${theme}-${viewport.width}.png`});
 const opener=await page.locator('#gradeBtn').isVisible()?'gradeBtn':'gradeScanSubBtn';
 await page.locator('#'+opener).evaluate(e=>e.disabled=false);await page.locator('#'+opener).focus();await page.evaluate(()=>openScanMenuOnTab('grade'));
 check('grade tab is selected',await page.locator('#scanMenuTabGrade').getAttribute('aria-selected'),'true');
 await page.locator('#scanMenuTabGrade').focus();await page.keyboard.press('ArrowLeft');
 check('keyboard switches to ID',await page.locator('#scanMenuTabId').getAttribute('aria-selected'),'true');
 await page.keyboard.press('End');check('keyboard switches to Grade',await page.locator('#scanMenuTabGrade').getAttribute('aria-selected'),'true');
 if(shots)await page.screenshot({path:`${shots}/scan-menu-${theme}-${viewport.width}.png`});
 await page.keyboard.press('Escape');check('Escape closes scan menu',await page.locator('#bulkModePickerOverlay').isVisible(),false);
 check('focus returns to opener',await page.evaluate(()=>document.activeElement.id),opener);
 await page.evaluate(()=>openPhotoTipsModal(null));await page.locator('.pt-rule img').first().waitFor({state:'visible'});
 check('photo tip text follows theme',await page.locator('.pt-sub').first().evaluate(e=>getComputedStyle(e).color),theme==='light'?'rgb(107, 105, 96)':'rgb(145, 143, 134)');
 if(shots)await page.screenshot({path:`${shots}/tips-${theme}-${viewport.width}.png`});
 await page.evaluate(()=>closePhotoTipsModal());
 for(const view of ['collection','drafts','flips','lookup']){await page.evaluate(v=>switchView(v),view);check(view+' fits viewport',await fit(),true)}
 await page.evaluate(()=>{switchView('collection');switchCollectionSection('cards')});
 check('Collection navigation is announced',await page.locator('.view-tab[data-view="collection"]').getAttribute('aria-pressed'),'true');
 check('Clear is tucked under More',await page.locator('#colClearBtn').isVisible(),false);
 await page.locator('.collection-more summary').click();check('More reveals Clear',await page.locator('#colClearBtn').isVisible(),true);
 check('More menu fits screen',await page.locator('.collection-more>div').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}),true);
 if(shots)await page.screenshot({path:`${shots}/collection-${theme}-${viewport.width}.png`});
 await page.locator('.collection-more summary').click();
 await page.locator('#collectionWrap .empty-primary').click();
 check('empty collection leads to search',await page.evaluate(()=>document.activeElement.id),'searchInput');
 check('Lookup navigation is announced',await page.locator('.view-tab[data-view="lookup"]').getAttribute('aria-pressed'),'true');
 await page.evaluate(()=>{switchView('collection');switchCollectionSection('cards')});
 await page.locator('#collectionWrap .empty-actions button').last().click();
 check('manual collection entry opens',await page.locator('#flipModal').isVisible(),true);
 await page.evaluate(()=>document.getElementById('flipModal').classList.remove('open'));
 await page.evaluate(()=>switchView('drafts'));
 await page.waitForFunction(()=>!_draftsState.loading);
 await page.evaluate(()=>{_draftsState.signedIn=false;_draftsState.error=null;_draftsState.loading=false;_draftsPaint()});
 check('signed-out drafts offer sign in',await page.locator('#draftsWrap a[href="/signin"]').isVisible(),true);
 await page.evaluate(()=>{_draftsState.signedIn=true;_draftsState.total=0;_draftsState.rows=[];_draftsPaint()});
 await page.locator('#draftsWrap .empty-primary').click();
 check('empty drafts lead to ID scanner menu',await page.locator('#scanMenuTabId').getAttribute('aria-selected'),'true');
 await page.keyboard.press('Escape');
 await page.evaluate(()=>_launchDeepGrade());await page.locator('#gradeUploadPhoto').click();
 check('deep grade has six upload slots',await page.locator('[data-grade-slot]').count(),6);
 check('deep upload fits viewport',await fit(),true);
 check('close does not cover upload title',await page.evaluate(()=>document.querySelector('#scanOverlay>button').getBoundingClientRect().bottom<=document.getElementById('scanStatus').getBoundingClientRect().top),true);
 if(shots)await page.screenshot({path:`${shots}/grade-upload-${theme}-${viewport.width}.png`});
 await page.evaluate(()=>cancelDeepGrade());
 await page.evaluate(()=>{openBulkScan();startBinderScan()});
 check('binder review fits viewport',await fit(),true);
 await page.evaluate(()=>closeBulkScan());
 await page.evaluate(()=>openShop('id','ui_test'));await page.waitForFunction(()=>!!document.querySelector('.membership-shop[open]'));
 check('shop fits viewport',await fit(),true);
 await page.keyboard.press('Escape');
 check('no uncaught UI errors',errors,[]);await page.close();
}
// All standalone pages retain readable navigation and use the same mark.
for(const path of ['about','accuracy','contact','pricing','privacy','terms','signin']){
 const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
 await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 await page.goto(origin+'/'+path);if(shots)await page.screenshot({path:shots+'/'+path+'.png'});check(path+' has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 check(path+' brand loads',await page.locator('.brand-mark').first().evaluate(i=>i.complete&&i.naturalWidth>0),true);
 if(shots)await page.screenshot({path:`${shots}/${path}.png`});await page.close();
}
console.log(`SUITE COMPLETE: brand-ui-browser: ${checks} passed, 0 failed`);
}finally{await browser.close();await new Promise(r=>server.close(r))}
