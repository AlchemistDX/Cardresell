// 2026-10-10: several binder pages in one batch (owner picked two; only one opened).
// Fixtures are synthetic binder pages built from real card art on dark, white
// and gray backings with sleeve glare, blur and plain Energy cards. No network.
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=createServer((q,r)=>{
 const url=decodeURIComponent(new URL(q.url,'http://local').pathname),path=join(root,url==='/'?'index.html':url);
 if(!path.startsWith(root)||!existsSync(path)){r.writeHead(404);r.end();return;}
 r.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');r.end(readFileSync(path));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const b=await chromium.launch({executablePath:process.env.CR_CHROMIUM||undefined,args:['--no-sandbox']});
const page=await b.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
let pass=0,fail=0;const check=(n,ok,d='')=>{ok?pass++:(fail++,console.log('  FAIL',n,d))};
const dir=new URL('fixtures/binder/',import.meta.url).pathname;
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const api=[];await page.route('**/*',r=>{
 const url=r.request().url();if(/\/api\/(?:scan|identify|grade|bulk)/.test(url))api.push(url);
 return url.startsWith(origin)&&!url.includes('/api/')?r.continue():r.fulfill({status:204,body:''});
});
await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
await page.goto(origin);await page.waitForFunction(()=>typeof startBinderScan==='function');
await page.evaluate(()=>{window._idScanCredits=20;window._freeIdLeft=0;});
const ready=()=>page.waitForFunction(()=>document.querySelectorAll('.binder-pocket').length>0&&!document.getElementById('binderControls').disabled,null,{timeout:60000});
const status=()=>page.locator('#binderStatus').textContent();
const btn=()=>page.locator('#binderContinue').textContent();
await page.evaluate(()=>{document.getElementById('bulkScanOverlay').style.display='flex';startBinderScan();});
check('the photo picker accepts several pages',await page.evaluate(()=>document.getElementById('binderInput').multiple));
check('start text invites several pages',(await status()).includes('up to 10'));
await page.selectOption('#binderLayout','3,3');
// Page 1: p1_black (7 cards ticked), page 2: p2_white (6), page 3: all empty.
await page.setInputFiles('#binderInput',[dir+'p1_black.jpg',dir+'p2_white.jpg',dir+'p5_allempty.jpg']);
await ready();
check('page 1 of 3 is labelled',(await status()).startsWith('Page 1 of 3.'),await status());
check('page 1 offers Next with its running count',(await btn())==='Next page (2 of 3) · 7 cards so far',await btn());
check('nothing queued yet',await page.evaluate(()=>!(window._bulkQueue||[]).length));
await page.click('#binderContinue');await ready();
check('page 2 of 3 is labelled',(await status()).startsWith('Page 2 of 3.'),await status());
check('page 2 has a fresh grid of 9',await page.locator('.binder-pocket').count()===9);
check('page 2 ticks are its own',JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('.binder-pocket input')].map(i=>i.checked)))===JSON.stringify([false,true,true,true,false,true,true,true,false]));
check('running count carries page 1',(await btn())==='Next page (3 of 3) · 13 cards so far',await btn());
// Untick one on page 2; it must not be sent.
await page.locator('.binder-pocket input').nth(1).uncheck();
check('unticking updates the running count',(await btn())==='Next page (3 of 3) · 12 cards so far',await btn());
await page.click('#binderContinue');await ready();
check('last page is labelled',(await status()).startsWith('Page 3 of 3.'));
check('an all-empty last page still quotes the earlier cards once',(await btn())==='Review 12 cards · 12 ID credits',await btn());
check('the quote button is enabled',!(await page.locator('#binderContinue').isDisabled()));
check('no network or credit use before confirmation',api.length===0,api.join(','));
await page.click('#binderContinue');
const queued=await page.evaluate(()=>(window._bulkQueue||[]).map(q=>q.file.name));
check('one queue holds every ticked pocket from both pages',queued.length===12,String(queued.length));
check('page 1 pockets keep page-tagged names',queued.filter(n=>n.startsWith('binder-page-1-')).length===7);
check('page 2 sends only what stayed ticked',JSON.stringify(queued.filter(n=>n.startsWith('binder-page-2-')))===JSON.stringify(['binder-page-2-row-1-col-3.jpg','binder-page-2-row-2-col-1.jpg','binder-page-2-row-2-col-3.jpg','binder-page-2-row-3-col-1.jpg','binder-page-2-row-3-col-2.jpg']),JSON.stringify(queued));
check('all names unique',new Set(queued).size===queued.length);
await page.evaluate(()=>cancelBulkConfirm());
// Cancel mid-way clears the carried pockets.
await page.evaluate(()=>{startBinderScan();});
await page.setInputFiles('#binderInput',[dir+'p1_black.jpg',dir+'p2_white.jpg']);await ready();
await page.click('#binderContinue');await ready();
await page.evaluate(()=>{startBinderScan();});
await page.setInputFiles('#binderInput',dir+'p2_white.jpg');await ready();
check('a new single page starts from zero',(await btn())==='Review 6 cards · 6 ID credits',await btn());
check('a single page has no page label',!(await status()).startsWith('Page '));
await page.click('#binderContinue');
check('single-page names unchanged',await page.evaluate(()=>_bulkQueue.every(q=>/^binder-row-\d-col-\d\.jpg$/.test(q.file.name))));
await page.evaluate(()=>cancelBulkConfirm());
// More than 10 pages: only 10 kept, and the user is told.
await page.evaluate(()=>{startBinderScan();});
await page.setInputFiles('#binderInput',Array.from({length:11},()=>dir+'p5_allempty.jpg'));await ready();
check('11 pages are capped at 10',(await status()).startsWith('Page 1 of 10.'),await status());
check('the cap is explained',(await status()).includes('Only the first 10 pages were added.'));

// Revisit pages after independent layout, rotation, crop and checkbox edits.
const settled=()=>page.waitForFunction(()=>!document.getElementById('binderControls').disabled);
const review=()=>page.evaluate(async()=>({
 layout:document.getElementById('binderLayout').value,zoom:document.getElementById('binderZoom').value,
 margins:['Left','Right','Top','Bottom'].map(k=>document.getElementById('binder'+k).value),
 selected:[...document.querySelectorAll('.binder-pocket input')].map(e=>e.checked),
 hashes:await Promise.all([...document.querySelectorAll('.binder-pocket img')].map(async e=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await (await fetch(e.src)).arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join(''))),
}));
const queue=()=>page.evaluate(async()=>Promise.all(_bulkQueue.map(async q=>({
 name:q.file.name,id:q.scanUid,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await q.file.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join(''),
}))));
await page.evaluate(()=>startBinderScan());await page.selectOption('#binderLayout','2,2');
await page.setInputFiles('#binderInput',[dir+'p1_black.jpg',dir+'p2_white.jpg',dir+'p5_allempty.jpg']);await ready();
await page.locator('#binderRotate').click();await ready();
await page.locator('summary').filter({hasText:'Adjust the grid edges'}).click();
for(const [id,value] of [['binderLeft','5'],['binderTop','4']]){await page.locator('#'+id).fill(value);await page.locator('#'+id).dispatchEvent('change');await ready();}
await page.locator('#binderZoom').fill('115');await page.locator('#binderZoom').dispatchEvent('change');await ready();
await page.locator('[data-binder-move="right"]').click();await ready();
await page.locator('#binderSelectNone').click();await page.locator('.binder-pocket input').first().check();await page.locator('.binder-pocket input').last().check();
const firstReview=await review();
await page.locator('#binderContinue').click();await ready();
await page.selectOption('#binderLayout','3,3');await ready();await page.locator('#binderSelectNone').click();
for(const i of [1,3,7])await page.locator('.binder-pocket input').nth(i).check();
const secondReview=await review();
check('progress counts selected cards from both pages',(await page.locator('#binderPageProgress').textContent())==='Page 2 of 3 · 5 cards selected across this batch');
await page.locator('#binderPrevious').click();await ready();
const restoredFirst=await review();
check('previous restores layout, zoom, edges, checks and exact rotated JPEGs',JSON.stringify(restoredFirst)===JSON.stringify(firstReview),JSON.stringify({before:firstReview,after:restoredFirst}));
check('first page has no previous action',await page.locator('#binderPrevious').isHidden());
await page.locator('.binder-pocket input').first().uncheck();
check('editing an earlier page includes later saved selections',(await btn())==='Next page (2 of 3) · 4 cards so far',await btn());
await page.locator('#binderContinue').click();await ready();
check('returning forward restores the other page independently',JSON.stringify(await review())===JSON.stringify(secondReview));
check('restored review describes manual selections accurately',(await status()).includes('3 pockets selected on this page.')&&!(await status()).includes('skipped 6'));
await page.locator('#binderContinue').click();await ready();
await page.locator('#binderPrevious').click();await ready();await page.locator('#binderContinue').click();await ready();
check('repeated navigation does not duplicate the credit quote',(await btn())==='Review 4 cards · 4 ID credits',await btn());
await page.locator('#binderContinue').click();const reviewedQueue=await queue();
check('reviewed cards keep page and pocket order',JSON.stringify(reviewedQueue.map(q=>q.name))===JSON.stringify(['binder-page-1-row-2-col-2.jpg','binder-page-2-row-1-col-2.jpg','binder-page-2-row-2-col-1.jpg','binder-page-2-row-3-col-2.jpg']));
check('confirmation gets the exact JPEGs reviewed after navigation',JSON.stringify(reviewedQueue.map(q=>q.hash))===JSON.stringify([firstReview.hashes[3],...secondReview.hashes.filter((_,i)=>[1,3,7].includes(i))]));
check('reviewed physical copies still have unique scan identities',new Set(reviewedQueue.map(q=>q.id)).size===4);
await page.evaluate(()=>cancelBulkConfirm());

// A damaged middle or last photo must not strand earlier reviewed cards.
const valid={name:'valid.jpg',mimeType:'image/jpeg',buffer:readFileSync(dir+'p1_black.jpg')};
const damaged={name:'damaged.jpg',mimeType:'image/jpeg',buffer:Buffer.from('broken JPEG')};
await page.evaluate(()=>startBinderScan());await page.selectOption('#binderLayout','3,3');
await page.setInputFiles('#binderInput',[valid,damaged,valid]);await ready();
await page.locator('#binderContinue').click();await settled();
check('failed middle page offers an explicit skip',!(await page.locator('#binderContinue').isDisabled())&&(await btn()).startsWith('Skip this page; next (3 of 3)'));
check('failed photo never displays the previous image',await page.locator('#binderPreview').isHidden()&&await page.locator('#binderAlignment').isHidden());
check('failed photo keeps the previous-page action',await page.locator('#binderPrevious').isEnabled());
await page.locator('#binderPrevious').click();await ready();
check('failed photo did not lose earlier selections',(await btn()).includes('7 cards so far'),await btn());
await page.locator('#binderContinue').click();await settled();await page.locator('#binderContinue').click();await ready();
check('skipping continues to the third photo',(await status()).startsWith('Page 3 of 3.'));
check('skip quote excludes the damaged page',(await btn())==='Review 14 cards · 14 ID credits',await btn());
await page.locator('#binderContinue').click();const skippedQueue=await queue();
check('skipped page creates no queue entries',skippedQueue.length===14&&skippedQueue.every(q=>!q.name.startsWith('binder-page-2-')));
await page.evaluate(()=>{cancelBulkConfirm();startBinderScan();});
await page.setInputFiles('#binderInput',[valid,damaged]);await ready();await page.locator('#binderContinue').click();await settled();
check('failed final page still permits earlier cards to be reviewed',(await btn())==='Review 7 cards · 7 ID credits'&&await page.locator('#binderContinue').isEnabled());
await page.locator('#binderContinue').click();check('failed final photo is absent from confirmation',(await queue()).length===7);
await page.evaluate(()=>{cancelBulkConfirm();startBinderScan();});
await page.setInputFiles('#binderInput',[damaged,damaged]);await settled();
check('failed first page can be skipped',await page.locator('#binderContinue').isEnabled());
await page.locator('#binderContinue').click();await settled();
check('an entirely failed batch cannot submit',await page.locator('#binderContinue').isDisabled());

// Some mobile pickers omit MIME metadata; still require real decodable pixels.
await page.evaluate(()=>startBinderScan());
await page.setInputFiles('#binderInput',{...valid,mimeType:''});await settled();
check('valid JPEG with omitted MIME type can be reviewed',await page.locator('.binder-pocket').count()===9);
await page.setInputFiles('#binderInput',{...damaged,mimeType:''});await settled();
check('a JPG filename never substitutes for a decodable image',await page.locator('.binder-pocket').count()===0&&await page.locator('#binderContinue').isDisabled());

// Retaking page 2 replaces it without throwing away page 1.
await page.evaluate(()=>startBinderScan());await page.setInputFiles('#binderInput',[dir+'p1_black.jpg',dir+'p2_white.jpg']);await ready();
const beforeRetake=await review();await page.locator('#binderContinue').click();await ready();
check('camera action clearly says it replaces this page',(await page.locator('#binderOpenCamera').textContent())==='Retake this page');
await page.evaluate(()=>{
 const c=document.createElement('canvas');c.width=1800;c.height=2500;const x=c.getContext('2d');x.fillStyle='#ccc';x.fillRect(0,0,c.width,c.height);
 window.retakeMedia=c.captureStream(1);Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>retakeMedia});
});
await page.locator('#binderOpenCamera').click();await page.waitForFunction(()=>!document.getElementById('binderCapture').disabled);
await page.locator('#binderCapture').click();await page.waitForFunction(()=>document.getElementById('binderCamera').hidden);await ready();
check('retake stays on page 2 of the existing batch',(await status()).startsWith('Page 2 of 2.'));
check('retake releases its camera track',await page.evaluate(()=>retakeMedia.getTracks().every(t=>t.readyState==='ended')));
await page.locator('#binderSelectAll').click();const retakenReview=await review();
check('retake quote includes preserved and replacement cards',(await btn())==='Review 16 cards · 16 ID credits',await btn());
if(process.env.CR_SHOT_DIR){
 mkdirSync(process.env.CR_SHOT_DIR,{recursive:true});
 await page.locator('#binderPageProgress').scrollIntoViewIfNeeded();await page.screenshot({path:join(process.env.CR_SHOT_DIR,'binder-pages-top.png')});
 await page.locator('#binderPrevious').scrollIntoViewIfNeeded();await page.screenshot({path:join(process.env.CR_SHOT_DIR,'binder-pages-navigation.png')});
}
await page.locator('#binderPrevious').click();await ready();check('retake preserved the first page exactly',JSON.stringify(await review())===JSON.stringify(beforeRetake));
await page.locator('#binderContinue').click();await ready();check('replacement page can also be revisited',JSON.stringify(await review())===JSON.stringify(retakenReview));
await page.locator('#binderContinue').click();const retakenQueue=await queue();
check('retake confirmation contains only the replacement page-2 JPEGs',JSON.stringify(retakenQueue.filter(q=>q.name.startsWith('binder-page-2-')).map(q=>q.hash))===JSON.stringify(retakenReview.hashes));
await page.evaluate(()=>{cancelBulkConfirm();startBinderScan();});
await page.setInputFiles('#binderInput',[dir+'p1_black.jpg',dir+'p2_white.jpg']);await ready();await page.locator('#binderContinue').click();await ready();
await page.evaluate(()=>{window.realPageDecode=Image.prototype.decode;Image.prototype.decode=function(){return new Promise(resolve=>window.releasePageDecode=()=>realPageDecode.call(this).then(resolve));};});
await page.locator('#binderPrevious').click();await page.waitForFunction(()=>!!window.releasePageDecode);
await page.evaluate(async()=>{closeBulkScan();await releasePageDecode();Image.prototype.decode=realPageDecode;});
check('cancelling a previous-page load leaves no stale previews',await page.locator('.binder-pocket').count()===0&&await page.locator('#binderPreview').isHidden());
await page.evaluate(()=>{document.getElementById('bulkScanOverlay').style.display='flex';startBinderScan();});
await page.setInputFiles('#binderInput',dir+'p2_white.jpg');await ready();
check('cancelled review history cannot leak into a new batch',(await btn())==='Review 6 cards · 6 ID credits'&&await page.locator('#binderPrevious').isHidden());
check('complete review flow never calls a paid provider',api.length===0,api.join(','));
check('no page errors',errors.length===0,errors.join(' | '));
await b.close();server.close();
console.log(`binder-multipage-browser: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail?1:0}`);
process.exit(fail?1:0);
