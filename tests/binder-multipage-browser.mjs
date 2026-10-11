// 2026-10-10: several binder pages in one batch (owner picked two; only one opened).
// Fixtures are synthetic binder pages built from real card art on dark, white
// and gray backings with sleeve glare, blur and plain Energy cards. No network.
import { chromium } from 'playwright';
import { parse } from 'acorn';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
const root=new URL('../',import.meta.url),html=readFileSync(new URL('index.html',root),'utf8');
const asset=name=>readFileSync(new URL(html.match(new RegExp('src="/([^" ]*'+name+'\\.[a-f0-9]+\\.js)"'))[1],root),'utf8');
const names=new Set(['_bulkShowSection','processBulkUploadFiles','_bulkNewScanUid','cancelBulkConfirm','closeBulkScan','_partitionScanFiles','_validateScanFile','_bulkRapidTeardown','_bulkRapidLayout','_liveCapStopQA','_liveCapRenderQA']);
const extracted=['core','ui'].map(name=>{const src=asset(name);return parse(src,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&names.has(n.id.name)).map(n=>src.slice(n.start,n.end)).join('\n')}).join('\n');
const fixture=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+`<script>const SCAN_MAX_BYTES=15*1024*1024,SCAN_MIME_TYPES=new Set(['image/jpeg','image/png','image/webp']);window._idScanCredits=20;window._bulkQueue=[];function _dialogClosed(){}function showToast(m){}\n${extracted}\n${asset('binder')}</script>`;
const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(fixture)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const b=await chromium.launch({executablePath:process.env.CR_CHROMIUM||undefined,args:['--no-sandbox']});const page=await b.newPage({viewport:{width:390,height:844}});
await page.goto(`http://127.0.0.1:${server.address().port}`);
let pass=0,fail=0;const check=(n,ok,d='')=>{ok?pass++:(fail++,console.log('  FAIL',n,d))};
const dir=new URL('fixtures/binder/',import.meta.url).pathname;
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const api=[];await page.route('**/api/**',r=>{api.push(r.request().url());r.abort()});
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
check('no page errors',errors.length===0,errors.join(' | '));
await b.close();server.close();
console.log(`binder-multipage-browser: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail?1:0}`);
process.exit(fail?1:0);
