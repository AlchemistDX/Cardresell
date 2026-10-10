// Shipped DOM, image crops and bulk handoff; synthetic images, no provider calls.
import { chromium } from 'playwright';
import { parse } from 'acorn';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),html=readFileSync(new URL('index.html',root),'utf8');
const asset=name=>readFileSync(new URL(html.match(new RegExp('src="/([^" ]*'+name+'\\.[a-f0-9]+\\.js)"'))[1],root),'utf8');
const names=new Set(['_bulkRapidTeardown','_bulkRapidLayout','_liveCapStopQA','_liveCapRenderQA','_bulkShowSection','processBulkUploadFiles','_bulkNewScanUid','cancelBulkConfirm','closeBulkScan','_partitionScanFiles','_validateScanFile']);
const extracted=['core','ui'].map(name=>{const src=asset(name);return parse(src,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&names.has(n.id.name)).map(n=>src.slice(n.start,n.end)).join('\n')}).join('\n');
const fixture=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+`<script>
const SCAN_MAX_BYTES=15*1024*1024,SCAN_MIME_TYPES=new Set(['image/jpeg','image/png','image/webp']);
window._idScanCredits=20;window._bulkQueue=[];window._bulkResults=[];function _dialogClosed(){}function showToast(m){window.toast=m}
${extracted}\n${asset('binder')}</script>`;
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(fixture)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM||undefined,args:['--no-sandbox']});
let checks=0;
function check(label,actual,expected){assert.deepEqual(actual,expected,label);checks++;console.log('✓ '+label)}
try {for(const viewport of [{width:390,height:844},{width:844,height:390}]) {
 const page=await browser.newPage({viewport}),errors=[],api=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{if(r.request().url().includes('/api/'))api.push(r.request().url());return r.request().url()===origin+'/'?r.continue():r.abort()});
 await page.goto(origin);
 const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=1000;const ctx=c.getContext('2d');['#ff0000','#00ff00','#0000ff','#ffff00'].forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect(i%2*500,Math.floor(i/2)*500,500,500)});return c.toDataURL('image/png').split(',')[1]});
 const file={name:'binder.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')};
 const ready=()=>page.waitForFunction(()=>!document.getElementById('binderControls').disabled);
 async function start(){await page.evaluate(()=>{document.getElementById('bulkScanOverlay').style.display='flex';startBinderScan()});await page.selectOption('#binderLayout','2,2');await page.setInputFiles('#binderInput',file);await ready()}
 const first=()=>page.locator('.binder-pocket input').first();
 const queue=()=>page.evaluate(async()=>Promise.all(_bulkQueue.map(async q=>{const i=await createImageBitmap(q.file),c=document.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawImage(i,0,0,1,1);return {name:q.file.name,pixel:[...c.getContext('2d').getImageData(0,0,1,1).data].slice(0,3).map(v=>v>128),w:i.width,h:i.height,uid:q.scanUid}})));
 await start();
 check('four pockets rendered',await page.locator('.binder-pocket').count(),4);
 check('flat test pockets read as empty, so nothing is pre-selected',await page.locator('#binderContinue').isDisabled(),true);
 check('review fits phone width',await page.locator('#bulkBinderReview').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
 await first().check();await page.locator('.binder-pocket input').nth(3).check();
 check('quote counts selected pockets',await page.locator('#binderContinue').textContent(),'Review 2 cards · 2 ID credits');
 await page.locator('#binderContinue').click();
 check('existing confirmation visible',await page.locator('#bulkCreditConfirm').isVisible(),true);
 check('existing credit quote correct',await page.locator('#bulkCreditConfirmCredit').textContent(),'Uses 2 credits · You have 20 available');
 const selected=await queue();
 check('selected row and column order',selected.map(q=>q.name),['binder-row-1-col-1.jpg','binder-row-2-col-2.jpg']);
 check('crop keeps resolution plus a 4% inner margin',selected.map(q=>[q.w,q.h]),[[520,520],[520,520]]);
 check('correct red and yellow pockets',selected.map(q=>q.pixel),[[true,false,false],[true,true,false]]);
 check('separate physical identities',new Set(selected.map(q=>q.uid)).size,2);
 await page.evaluate(()=>document.getElementById('binderContinue').click());
 check('repeat handoff does not duplicate',await page.evaluate(()=>_bulkQueue.length),2);
 await page.evaluate(()=>cancelBulkConfirm());check('cancel clears queue',await page.evaluate(()=>_bulkQueue.length),0);
 await start();await first().check();await page.locator('#binderRotate').click();await ready();
 check('rotation clears selection',await page.locator('#binderContinue').isDisabled(),true);
 await first().check();await page.locator('#binderContinue').click();
 check('rotation maps correct pocket',(await queue())[0].pixel,[false,false,true]);
 await page.evaluate(()=>cancelBulkConfirm());await start();
 await page.locator('summary').filter({hasText:'Adjust the grid edges'}).click();await page.locator('#binderLeft').fill('20');await page.locator('#binderLeft').dispatchEvent('change');await ready();
 await first().check();await page.locator('#binderContinue').click();
 check('margin adjustment changes bounds',(await queue()).map(q=>[q.w,q.h]),[[432,520]]);
 await page.evaluate(()=>cancelBulkConfirm());await start();
 if(process.env.CR_SHOT_DIR) await page.screenshot({path:process.env.CR_SHOT_DIR+'/binder-'+viewport.width+'.png'});
 const small=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=100;return c.toDataURL('image/png').split(',')[1]});
 await page.setInputFiles('#binderInput',{name:'tiny.png',mimeType:'image/png',buffer:Buffer.from(small,'base64')});await ready();
 check('undersized pockets cannot be submitted',await page.locator('#binderContinue').isDisabled(),true);
 check('undersized page gives a useful reason',(await page.locator('#binderStatus').textContent()).includes('higher-resolution'),true);
 await page.setInputFiles('#binderInput',{name:'bad.heic',mimeType:'image/heic',buffer:Buffer.from('bad')});
 check('unsupported replacement clears old pockets',await page.locator('.binder-pocket').count(),0);
 check('unsupported file cannot continue',await page.locator('#binderContinue').isDisabled(),true);
 await page.evaluate(()=>{window.realDecode=Image.prototype.decode;Image.prototype.decode=function(){return new Promise(resolve=>window.releaseDecode=()=>realDecode.call(this).then(resolve))}});
 await page.setInputFiles('#binderInput',file);await page.waitForFunction(()=>!!window.releaseDecode);
 await page.evaluate(async()=>{closeBulkScan();await releaseDecode();Image.prototype.decode=realDecode});
 check('cancelled decode stays closed',await page.locator('#bulkScanOverlay').isVisible(),false);
 check('cancelled decode leaves no crops',await page.locator('.binder-pocket').count(),0);
 check('no provider calls before confirmation',api,[]);check('no browser errors',errors,[]);
 await page.close();
}console.log(`SUITE COMPLETE: binder-scan-browser: ${checks} passed, 0 failed`);
}finally{await browser.close();await new Promise(r=>server.close(r))}
