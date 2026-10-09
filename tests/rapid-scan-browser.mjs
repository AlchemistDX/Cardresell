// Shipped Rapid Scan DOM and shared camera functions; synthetic MediaStreams.
import {chromium} from 'playwright';
import {parse} from 'acorn';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {referencedHashedAssets,ROOT} from './_assetRefs.mjs';
const html=readFileSync(join(ROOT,'index.html'),'utf8');
const ui=readFileSync(referencedHashedAssets().find(a=>a.base==='ui').path,'utf8');
const names=new Set(['_camZoomBind','_sharpnessScore','startBulkRapid','closeBulkRapid','bulkRapidSnap','bulkRapidDone','_bulkShowSection','closeBulkScan','_bulkNewScanUid']);
const code=parse(ui,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration' && (names.has(n.id.name)||n.id.name.startsWith('_bulkRapid')||n.id.name.startsWith('_liveCap'))).map(n=>ui.slice(n.start,n.end)).join('\n');
const guide=referencedHashedAssets().find(a=>a.base==='photo-guide').ref;
const fixture=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+`<script src="${guide}"></script><script>
window.googleUser={sub:'fixture'};window._bulkQueue=[];window._bulkResults=[];window._idScanCredits=20;
window.requests=[];window.streams=[];window.notices=[];function showToast(s){notices.push(s)}function _dialogClosed(){}
const _LIVECAP_SOFT_THRESHOLD=14;
navigator.mediaDevices.getUserMedia=opts=>new Promise((resolve,reject)=>requests.push({opts,resolve,reject}));
window.resolveCamera=i=>{const c=document.createElement('canvas');c.width=1200;c.height=1600;const ctx=c.getContext('2d');ctx.fillStyle='#555';ctx.fillRect(0,0,1200,1600);ctx.fillStyle='#bbb';ctx.fillRect(200,240,800,1120);ctx.fillStyle='#222';for(let y=300;y<1300;y+=24)ctx.fillRect(250,y,700,8);const stream=c.captureStream(5);streams.push(stream);requests[i].resolve(stream);return streams.length-1;};
${code}</script>`;
const server=createServer((req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(fixture)}else if(/^\/js\/[\w.-]+\.js$/.test(req.url)){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(join(ROOT,req.url)))}else res.writeHead(404).end();}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox','--disable-dev-shm-usage']});
let checks=0;const check=(value,message)=>{assert.ok(value,message);checks++};
try {for(const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:1280,height:800}]) {
 const page=await browser.newPage({viewport});const errors=[],paid=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{if(r.request().url().includes('/api/'))paid.push(r.request().url());return r.request().url().startsWith(origin)?r.continue():r.abort()});
 await page.goto(origin);
 const start=async()=>{await page.evaluate(()=>{document.getElementById('bulkScanOverlay').style.display='flex';window.opening=startBulkRapid()});const index=await page.evaluate(()=>requests.length-1);await page.evaluate(i=>resolveCamera(i),index);await page.evaluate(()=>opening);await page.waitForFunction(()=>document.getElementById('bulkRapidVideo').videoWidth>0);return index};
 await start();
 check(await page.evaluate(()=>requests[0].opts.video.width.ideal===3840),'same high-resolution camera request');
 check(!/looks good/i.test(await page.locator('#bulkRapidQAText').textContent()),'no unsupported green pass');
 check(await page.locator('#bulkRapidDoneBtn').isDisabled(),'empty queue cannot proceed');
 // Real toBlob handoff and image dimensions; a double tap must queue only once.
 await page.evaluate(()=>{bulkRapidSnap();bulkRapidSnap()});await page.waitForFunction(()=>_bulkQueue.length===1);
 check(await page.evaluate(()=>_bulkQueue.length===1),'rapid double tap captures once');
 check(await page.evaluate(async()=>{const expected=_liveCapVisibleRect(document.getElementById('bulkRapidVideo')),im=await createImageBitmap(_bulkQueue[0].file);return im.width===expected.sw&&im.height===expected.sh}),'capture matches visible geometry with margin');
 check(await page.evaluate(()=>!!_bulkQueue[0].scanUid),'stable per-card queue identity');
 const geometry=await page.evaluate(()=>{const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return {frame:rect('bulkRapidFrame'),hint:rect('bulkRapidQABar'),controls:rect('bulkRapidControls'),guide:rect('bulkRapidGuidance'),shutter:rect('bulkRapidShutter'),done:rect('bulkRapidDoneBtn'),cam:rect('bulkRapidCam')}});
 check(geometry.frame.width>70&&geometry.frame.height>98,`usable card guide ${viewport.width}`);
 check(geometry.frame.top>=geometry.guide.bottom-1,'card guide below instructions');
 check(geometry.frame.bottom<=geometry.controls.top+1||geometry.frame.right<=geometry.controls.left+1,'card guide clears controls');
 check(geometry.done.bottom<=geometry.cam.bottom&&geometry.done.right<=geometry.cam.right,'review button visible');
 check(geometry.shutter.bottom<=geometry.cam.bottom,'shutter visible');
 await page.waitForFunction(()=>Number(getComputedStyle(document.getElementById('bulkRapidFlash')).opacity)<.01);
 if(process.env.CR_SHOT_DIR)await page.screenshot({path:process.env.CR_SHOT_DIR+'/rapid-'+viewport.width+'.png'});
 const original=await page.evaluate(()=>_bulkQueue[0].scanUid);
 await page.locator('#bulkRapidDoneBtn').click();
 check(await page.locator('#bulkCreditConfirm').isVisible(),'review credits before scanning');
 check(await page.evaluate(()=>_bulkQueue[0].scanUid)===original,'handoff preserves operation identity');
 check(await page.evaluate(()=>streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),'review stops camera tracks');
 check(await page.evaluate(()=>!document.getElementById('bulkRapidVideo').srcObject&&!_bulkRapidQATimer),'review clears preview and guidance timer');
 check(paid.length===0,'capturing/reviewing makes no paid scan call');
 // Close the outer overlay while the OS permission promise is still pending.
 await page.evaluate(()=>{_bulkShowSection('modePicker');window.opening=startBulkRapid();closeBulkScan();resolveCamera(requests.length-1)});await page.evaluate(()=>opening);
 check(await page.evaluate(()=>streams.at(-1).getTracks().every(t=>t.readyState==='ended')),'late permission stream stops after outer close');
 check(await page.evaluate(()=>!_bulkRapidState),'close invalidates session');
 // Old permission rejection must not close a newer camera.
 await page.evaluate(()=>{document.getElementById('bulkScanOverlay').style.display='flex';window.old=startBulkRapid();window.fresh=startBulkRapid();requests[requests.length-2].reject(Error('old denial'));resolveCamera(requests.length-1)});
 await page.evaluate(async()=>{await old;await fresh});await page.waitForFunction(()=>document.getElementById('bulkRapidVideo').videoWidth>0);
 check(await page.evaluate(()=>_bulkRapidState.active),'old rejection cannot close new camera');
 // Encoding completed after cancellation must not append into the next queue.
 await page.evaluate(()=>{document.getElementById('bulkRapidCanvas').toBlob=cb=>{window.lateBlob=cb};bulkRapidSnap();bulkRapidDone();window.pendingStayedInCamera=document.getElementById('bulkRapidCam').style.display==='flex';closeBulkRapid();lateBlob(new Blob(['late'],{type:'image/jpeg'}))});
 check(await page.evaluate(()=>_bulkQueue.length===0),'cancelled encoding cannot append stale photo');
 check(await page.evaluate(()=>pendingStayedInCamera),'review waits for current photo encoding');
 check(errors.length===0,errors.join('\n'));
 await page.close();
 }
 console.log(`Rapid Scan browser: ${checks} checks passed across four viewports.`);
}finally{await browser.close();await new Promise(r=>server.close(r))}
