// 2026-10-10: binder pockets are pre-selected by a free, local detail check.
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
const truth=JSON.parse(readFileSync(dir+'truth.json','utf8'));
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const api=[];await page.route('**/api/**',r=>{api.push(r.request().url());r.abort()});
async function load(f,layout){
  await page.evaluate(()=>{document.getElementById('bulkScanOverlay').style.display='flex';startBinderScan();});
  await page.selectOption('#binderLayout',layout);
  await page.setInputFiles('#binderInput',dir+f);
  await page.waitForFunction(()=>document.querySelectorAll('.binder-pocket').length>0&&!document.getElementById('binderControls').disabled,null,{timeout:60000});
}
const ticks=()=>page.evaluate(()=>[...document.querySelectorAll('.binder-pocket input')].map(i=>i.checked));
for(const [f,t] of Object.entries(truth)){
  await load(f,f.includes('4x3')?'4,3':'3,3');
  const got=await ticks();
  check(f+': cards ticked, empty pockets left unticked',JSON.stringify(got)===JSON.stringify(t),JSON.stringify(got));
  const tags=await page.evaluate(()=>[...document.querySelectorAll('.binder-pocket')].map(l=>!!l.querySelector('.binder-empty-tag')));
  check(f+': "Looks empty" label only on skipped pockets',JSON.stringify(tags)===JSON.stringify(t.map(x=>!x)));
  const n=t.filter(Boolean).length;
  const btn=await page.locator('#binderContinue').textContent();
  check(f+': quote matches the pre-selection',n?btn===`Review ${n} card${n===1?'':'s'} · ${n} ID credit${n===1?'':'s'}`:btn==='Select the cards to scan',btn);
}
// Select all / Clear
await load('p1_black.jpg','3,3');
check('Select all and Clear are shown',await page.locator('#binderBulkPick').isVisible());
await page.click('#binderSelectAll');
check('Select all ticks every pocket',(await ticks()).every(Boolean));
check('Select all updates the quote',(await page.locator('#binderContinue').textContent())==='Review 9 cards · 9 ID credits');
await page.click('#binderSelectNone');
check('Clear unticks every pocket',(await ticks()).every(x=>!x));
check('Clear disables continue',await page.locator('#binderContinue').isDisabled());
// Hand-off sends exactly the pre-selected pockets
await load('p1_black.jpg','3,3');
await page.click('#binderContinue');
check('hand-off queues the 7 pre-selected cards',await page.evaluate(()=>_bulkQueue.map(q=>q.file.name).join(','))===
  ['1-1','1-2','2-1','2-2','2-3','3-2','3-3'].map(k=>'binder-row-'+k.replace('-','-col-')+'.jpg').join(','));
await page.evaluate(()=>cancelBulkConfirm());
// Layout is remembered
await page.evaluate(()=>{startBinderScan();});await page.selectOption('#binderLayout','4,3');
await page.evaluate(()=>{startBinderScan();});
check('last pocket layout is remembered',(await page.inputValue('#binderLayout'))==='4,3');
await page.evaluate(()=>localStorage.setItem('cr_binder_layout','9,9'));await page.evaluate(()=>{startBinderScan();});
check('an invalid saved layout falls back to 3 × 3',(await page.inputValue('#binderLayout'))==='3,3');
// iPhone canvas limit
const caps=await page.evaluate(()=>[[5712,4284],[8064,6048],[4032,3024],[3000,2000]].map(([w,h])=>{const k=CardResellBinder.sourceScale(w,h);return [Math.round(w*k),Math.round(h*k)]}));
check('24 and 48 MP photos stay under the iPhone canvas limit',caps.slice(0,2).every(([w,h])=>w*h<=12000000&&w*h>11500000),JSON.stringify(caps));
check('small photos are not upscaled',JSON.stringify(caps[3])==='[3000,2000]');
const big=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=5712;c.height=4284;const x=c.getContext('2d');x.fillStyle='#222';x.fillRect(0,0,c.width,c.height);for(let i=0;i<9;i++){x.fillStyle=`hsl(${i*40},70%,55%)`;const cx=(i%3)*1904+250,cy=Math.floor(i/3)*1428+150;x.fillRect(cx,cy,1400,1100);x.fillStyle='#fff';for(let k=0;k<40;k++)x.fillRect(cx+60,cy+60+k*24,1200*Math.random(),8);}
  const b=await new Promise(r=>c.toBlob(r,'image/jpeg',.85));c.width=c.height=1;return Array.from(new Uint8Array(await b.arrayBuffer()));});
await page.evaluate(()=>{startBinderScan();});await page.selectOption('#binderLayout','3,3');
await page.setInputFiles('#binderInput',{name:'iphone24.jpg',mimeType:'image/jpeg',buffer:Buffer.from(big)});
await page.waitForFunction(()=>document.querySelectorAll('.binder-pocket').length===9&&!document.getElementById('binderControls').disabled,null,{timeout:60000});
check('a 24 MP page produces 9 non-blank, pre-selected pockets',(await ticks()).every(Boolean));
check('no provider calls before confirmation',api.length===0,api.join(','));
check('no browser errors',errors.length===0,errors.join(' | '));
await b.close();server.close();
console.log(`binder-autoselect-browser: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail?1:0}`);
process.exit(fail?1:0);
