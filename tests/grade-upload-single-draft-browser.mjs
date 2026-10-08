// Real shipped DOM/functions; synthetic files, camera, grading and draft services.
// No vendor calls or customer credits. Set CR_CHROMIUM to a local Chromium binary.
import { chromium } from 'playwright';
import { parse } from 'acorn';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { publicMembershipCatalogue } from '../api/_membershipPurchaseRoutes.js';
const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const core = readFileSync(new URL(html.match(/src="\/([^\"]*core\.[a-f0-9]+\.js)"/)[1], root),'utf8');
const ui = readFileSync(new URL(html.match(/src="\/([^\"]*ui\.[a-f0-9]+\.js)"/)[1], root),'utf8');
const names = new Set(['_chooseGradePhoto','_startGradeFrontCapture','_startGradeBackCapture','_startGradeEdgeCapture','_launchQuickGrade','_launchDeepGrade','processGradeImage','processGradeBack','processGradeEdge','showDeepGradeEdgeUI','showQuickGradeReview','_validateScanFile','_gradeCaptureSpec','compressImage','_prepareSingleScanDraft','createSingleScanDraft','_setScanBtns','_scheduleScanAutoAdvance','_clearScanAutoAdvance','_scanPhotoSnapshot','_bulkScanRowToCard']);
const extracted = [core,ui].map(source => parse(source,{ecmaVersion:'latest',sourceType:'script'}).body.filter(n=>n.type==='FunctionDeclaration'&&names.has(n.id.name)).map(n=>source.slice(n.start,n.end)).join('\n')).join('\n');
const boot = `const SCAN_MAX_BYTES=15*1024*1024; const SCAN_MIME_TYPES=new Set(['image/jpeg','image/png','image/webp']); window.googleUser={uid:'test'};window._googleIdToken='fixture';window.submissions=[];window.drafts=[];window.cameraCalls=[];
function _dialogOpened(){} function _dialogClosed(){} function showToast(m){window.toast=m} function detectCardBounds(){return null}
function _takeGradeFrontPhoto(){cameraCalls.push('front')}function _takeGradeBackPhoto(){cameraCalls.push('back')}function _takeGradeEdgePhoto(e){cameraCalls.push(e)}
async function submitGradeScan(deep){submissions.push({deep,front:window._gradeFrontBase64,back:window._gradeBackBase64})}
function _catalogueArtworkUrl(r){return r.imageUrl||null}function _crCreateIdemKey(a,b,c){return [a,b,c].join(':')}
async function _crCreateDraft(p){drafts.push(p);await new Promise(r=>setTimeout(r,80));return window.draftSucceeds?'draft-1':null}
`;
const fixture=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+`<script>${boot}${extracted}</script>`;
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM||undefined,args:['--no-sandbox']});
try {for(const size of [{width:390,height:844},{width:844,height:390}]) {
 const page=await browser.newPage({viewport:size});
 await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 await page.goto(origin);
 const jpeg=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=900;c.height=1200;const x=c.getContext('2d');x.fillStyle='#bbaaff';x.fillRect(0,0,900,1200);return c.toDataURL('image/jpeg').split(',')[1]});
 const file={name:'phone.jpg',mimeType:'image/jpeg',buffer:Buffer.from(jpeg,'base64')};
 const upload=async()=>{const chooserPromise=page.waitForEvent('filechooser');await page.locator('#gradeUploadPhoto').click();await (await chooserPromise).setFiles(file);await page.waitForFunction(()=>!document.getElementById('gradePhotoSource').open)};
 await page.evaluate(()=>_launchQuickGrade());assert.equal(await page.locator('#gradeLibraryInput').getAttribute('capture'),null);
 await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>submissions.length+cameraCalls.length),0);
 await page.evaluate(()=>_startGradeFrontCapture());await upload();await page.waitForFunction(()=>!!window._gradeFrontBase64);
 await page.getByRole('button',{name:'Add Back Photo'}).click();await upload();await page.getByRole('button',{name:'Submit Quick Grade — 1 credit'}).waitFor();
 assert.equal(await page.evaluate(()=>submissions.length),0);
 await page.getByRole('button',{name:'Replace back'}).click();await upload();await page.getByRole('button',{name:'Submit Quick Grade — 1 credit'}).click();
 assert.equal(await page.evaluate(()=>submissions.length),1);assert.equal(await page.evaluate(()=>cameraCalls.length),0);
 await page.evaluate(()=>_launchDeepGrade());await upload();await page.waitForFunction(()=>!!window._gradeFrontBase64);
 await page.evaluate(()=>_startGradeBackCapture());await upload();await page.waitForFunction(()=>!!window._gradeBackBase64);
 for(const edge of ['top','bottom','left','right']){await page.evaluate(e=>_startGradeEdgeCapture(e),edge);await upload();await page.waitForFunction(e=>!!window._gradeEdges[e],edge)}
 assert.equal(await page.evaluate(()=>Object.keys(_gradeEdges).length),4);assert.equal(await page.evaluate(()=>submissions.length),1);
 await page.evaluate(()=>_startGradeEdgeCapture('top'));await page.locator('#gradeTakePhoto').click();assert.deepEqual(await page.evaluate(()=>cameraCalls),['top']);
 await page.evaluate(()=>{_pendingIdScanCard={name:'Example',number:'1',setName:'Example set',cardType:'mtg'};_lastScanFrontBase64=_gradeFrontBase64;_setScanBtns('success');_scheduleScanAutoAdvance()});
 assert.equal(await page.evaluate(()=>window._scanAutoAdvanceTimer||null),null);
 await page.locator('#scanCreateDraftBtn').click();await page.waitForFunction(()=>!_singleScanDraft.busy);
 const first=await page.evaluate(()=>drafts[0]);assert.equal(first.card.card,'Example');assert.equal(first.card.condition,'');assert.ok(!first.price);assert.ok(first.scanPhoto.dataUrl.startsWith('data:image/jpeg;'));
 await page.evaluate(()=>{createSingleScanDraft();createSingleScanDraft()});await page.waitForFunction(()=>!_singleScanDraft.busy);
 assert.equal(await page.evaluate(()=>drafts.length),2);assert.equal(await page.evaluate(()=>drafts[1].idemKey),first.idemKey);
 await page.evaluate(()=>{_pendingIdScanCard={..._pendingIdScanCard};_setScanBtns('success');createSingleScanDraft()});await page.waitForFunction(()=>!_singleScanDraft.busy);
 assert.notEqual(await page.evaluate(()=>drafts[2].instanceId),first.instanceId);
 await page.evaluate(()=>{draftSucceeds=true;createSingleScanDraft()});await page.waitForFunction(()=>!_singleScanDraft.busy);
 assert.equal(await page.evaluate(()=>_pendingIdScanCard),null);assert.equal(await page.locator('#scanOverlay').evaluate(e=>e.style.display),'none');
 console.log(`${size.width}x${size.height}: uploads, cancellation, Quick review, six Deep slots, camera choice, stable retry/double-click, separate copies, draft navigation passed`);
 await page.route('**/api/membership-catalogue', r=>r.fulfill({json:publicMembershipCatalogue()}));
 await page.evaluate(()=>{window.googleUser=null});
 await page.addScriptTag({content:readFileSync(new URL(html.match(/src="\/([^\"]*membership-shop\.[a-f0-9]+\.js)"/)[1],root),'utf8')});
 await page.evaluate(()=>openMembershipShop('subscriptions'));
 assert.equal(await page.locator('.membership-plan').count(),5);
 assert.ok(await page.getByText('Same marketplace tools as Pro, with higher allowances and a larger pack discount.').isVisible());
 assert.equal(await page.locator('.membership-subscriptions').evaluate(e=>e.scrollWidth>e.clientWidth),false);
 if(process.env.CR_SHOT_DIR) await page.screenshot({path:process.env.CR_SHOT_DIR+'/subscriptions-'+size.width+'.png'});
 console.log('Subscription benefits render with live catalogue values, five plans and no horizontal overflow');
 await page.close();
}}finally{await browser.close();await new Promise(r=>server.close(r))}
