// Real shipped bulk UI; synthetic photo/provider boundary, no external services or credits.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,extname} from 'node:path';
import assert from 'node:assert/strict';
const root=new URL('..',import.meta.url).pathname;
let checks=0;
const check=(name,value,expected=true)=>{assert.deepEqual(value,expected,name);checks++;};
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp'};
const server=createServer((q,s)=>{const p=join(root,new URL(q.url,'http://x').pathname.replace(/^\/$/,'index.html'));if(!existsSync(p)){s.statusCode=404;return s.end();}s.setHeader('content-type',types[extname(p)]||'application/octet-stream');s.end(readFileSync(p));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM||undefined,args:['--no-sandbox']});
try {
for(const width of [320,390,1280]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[],requests=[];
 let releaseScan,holdScan=false,reply={card_name:'Fixture card',set_name:'Fixture set',card_number:'7',card_type:'pokemon',grounded_id:'fixture-7'};
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
 await page.route('**/*',async route=>{
   const url=route.request().url();
   if(url===origin+'/api/scan'){
     requests.push(route.request().postDataJSON());
     if(holdScan)await new Promise(r=>{releaseScan=r});
     return route.fulfill({json:reply});
   }
   if(url.startsWith(origin)&&!url.includes('/api/'))return route.continue();
   return route.fulfill({status:503,json:{error:'offline_fixture'}});
 });
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>typeof bulkChooseNewPhoto==='function');
 await page.evaluate(()=>{
   window._fbAuth={currentUser:{uid:'fixture-owner'}};
   window.googleUser={sub:'fixture-owner',email:'fixture@example.invalid'};
   window._testPrice=7.25;window._testQcError=null;window._revoked=[];
   const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{_revoked.push(url);revoke(url)};
   // Photo validation/compression are independently covered by photo-preflight.
   // Keep the actual HTTP scan, result mapping, finish defaults and row replacement.
   _bulkCheckPhoto=async()=>window._testQcError;
   compressImage=async()=>'c3ludGhldGlj';window.cardResellScanRequest=fetch;
   _bulkFetchPrice=async()=>({marketPrice:_testPrice,variant:'holofoil',prices:{holofoil:_testPrice},imageUrl:'',tcgplayerUrl:''});
   window.seedRecovery=()=>{
     if(document.getElementById('bulkScanOverlay').style.display!=='none')closeBulkScan();
     window._fbAuth.currentUser={uid:'fixture-owner'};
     window._bulkProcessing=false;window._bulkSaved=false;window._bulkDraftBusy=false;window._bulkDraftSel=[];
     const file=new File(['synthetic'],'original.jpg',{type:'image/jpeg'});
     const image='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
     window._bulkResults=Array.from({length:9},(_,i)=>({rowId:'bulk-row-'+i,scanUid:'physical-'+i,file,objectUrl:image,success:i<3,cardName:i<3?'Fixture '+i:'',setName:i<3?'Fixture set':'',cardNumber:i<3?String(i):'',cardType:'pokemon',marketPrice:i<3?30+i*10:null,condition:'',conditionChosen:false,error:i<3?'':'Could not identify card',definiteMiss:i>=3}));
     window._bulkQueue=_bulkResults.map(r=>({file:r.file,objectUrl:r.objectUrl,scanUid:r.scanUid}));
     document.getElementById('bulkScanOverlay').style.display='flex';_bulkShowSection('processing');_bulkResetBottomBarButtons();
     document.getElementById('bulkResultsList').innerHTML=_bulkResults.map(r=>`<div id="${r.rowId}" style="display:flex;align-items:center;gap:.75rem;padding:.6rem .75rem;background:#111;border-radius:10px;border:1px solid #1e1e1e"></div>`).join('');
     for(const r of _bulkResults)_bulkUpdateRow(r.rowId,r);
     _bulkFinishQueue(9);
   };
   seedRecovery();
 });
 const photo=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=840;const x=c.getContext('2d');x.fillStyle='#334155';x.fillRect(0,0,600,840);x.strokeStyle='#c4b5fd';x.lineWidth=12;x.strokeRect(20,20,560,800);x.fillStyle='#fff';x.font='48px sans-serif';x.fillText('TEST CARD',45,95);x.font='36px sans-serif';x.fillText('Fixture set · #7',45,780);return c.toDataURL('image/png').split(',')[1]}),'base64');
 const seed=()=>page.evaluate(()=>seedRecovery());
 const row=()=>page.locator('#bulk-row-3');
 const choose=async()=>{const chooser=page.waitForEvent('filechooser');await row().getByRole('button',{name:'Choose new photo',exact:true}).click();await(await chooser).setFiles({name:'closer.png',mimeType:'image/png',buffer:photo});await row().getByRole('button',{name:'Scan new photo · 1 credit',exact:true}).waitFor();};
 check(width+' partial subtotal label',await page.locator('#bulkPackTrackerTitle').textContent(),'Known card subtotal');
 check(width+' excludes six unknown values',await page.locator('#bulkPackTrackerAmt').textContent(),'$120.00');
 check(width+' discloses six unresolved cards',await page.locator('#bulkPackTrackerStatus').textContent(),'3 identified · 6 not identified');
 check(width+' header counts all rows',await page.locator('#bulkScanSubtitle').textContent(),'3/9 cards identified');
 check(width+' miss has no futile retry',await row().getByRole('button',{name:'Retry same photo'}).count(),0);
 check(width+' miss is not dimmed',await row().evaluate(e=>getComputedStyle(e).opacity),'1');
 const readable=await row().evaluate(e=>{const hint=e.querySelector('div[style*="line-height"]');const c=getComputedStyle(hint).color.match(/[\d.]+/g).slice(0,3).map(Number);const lum=a=>a.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);return(lum(c)+.05)/(lum([17,17,17])+.05)});
 check(width+' miss text meets 4.5:1 contrast',readable>=4.5);
 check(width+' usable touch button',(await row().getByRole('button',{name:'Choose new photo'}).boundingBox()).height>=44);
 await page.evaluate(()=>{_bulkDraftSel=['physical-0','physical-1','physical-2'];_bulkUpdatePackTracker()});
 check(width+' selected value stays scoped',await page.locator('#bulkPackTrackerTitle').textContent(),'Selected card value');
 check(width+' unresolved count survives selecting every known card',await page.locator('#bulkSelectedValue').isVisible());
 check(width+' selected context names misses',(await page.locator('#bulkSelectedValue').textContent()).includes('6 not identified'));
 await page.evaluate(()=>{_bulkDraftSel=[];_bulkResults[0].marketPrice=null;_bulkUpdatePackTracker()});
 check(width+' missing prices distinct from missing identities',await page.locator('#bulkPackTrackerStatus').textContent(),'3 identified · 6 not identified · 1 missing a price');
 await seed();
 await choose();
 check(width+' file selection makes no scan request',requests.length,0);
 check(width+' preview leaves original identity untouched',await page.evaluate(()=>_bulkResults[3].file.name),'original.jpg');
 check(width+' shows cost before scanning',(await row().innerText()).includes('Uses 1 ID credit'));
 check(width+' preview remains within viewport',await row().evaluate(e=>e.getBoundingClientRect().right<=innerWidth));
 const pendingUrl=await page.evaluate(()=>_bulkResults[3]._replacementPhoto.objectUrl);
 await row().getByRole('button',{name:'Cancel',exact:true}).click();
 check(width+' cancellation releases preview URL',await page.evaluate(u=>_revoked.includes(u),pendingUrl));
 check(width+' cancellation makes no scan request',requests.length,0);
 check(width+' cancellation keeps all nine rows',await page.evaluate(()=>_bulkResults.length),9);
 // Bad photos never become a billable confirmation.
 await page.evaluate(()=>_testQcError='Photo too small');
 const badChooser=page.waitForEvent('filechooser');await row().getByRole('button',{name:'Choose new photo',exact:true}).click();await(await badChooser).setFiles({name:'tiny.jpg',mimeType:'image/jpeg',buffer:Buffer.from('tiny')});
 await row().getByRole('button',{name:'Choose new photo',exact:true}).waitFor();
 check(width+' QC rejection has no confirmation',await row().getByRole('button',{name:'Scan new photo · 1 credit'}).count(),0);
 check(width+' QC rejection makes no scan request',requests.length,0);
 await page.evaluate(()=>_testQcError=null);
 await choose();
 if(process.env.CR_SHOT_DIR){mkdirSync(process.env.CR_SHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.CR_SHOT_DIR,`bulk-recovery-${width}.png`)});}
 // Repeated taps while the HTTP request is pending send only one request.
 holdScan=true;await page.evaluate(()=>{window._retryDone=Promise.all([bulkRetryRow('bulk-row-3',true),bulkRetryRow('bulk-row-3',true)]);});
 await page.waitForFunction(()=>_bulkResults[3]._rescanning===true);
 while(!releaseScan)await new Promise(r=>setTimeout(r,10));
 check(width+' double confirm sends one request',requests.length,1);
 check(width+' replacement never requests a free same-photo retry',Object.hasOwn(requests[0],'retry_of'),false);
 check(width+' saving is disabled during scan',await page.locator('#bulkAddAllBtn').isDisabled());
 releaseScan();holdScan=false;await page.evaluate(()=>_retryDone);
 const recovered=await page.evaluate(()=>({uid:_bulkResults[3].scanUid,name:_bulkResults[3].cardName,file:_bulkResults[3].file.name,success:_bulkResults[3].success,condition:_bulkResults[3].condition,other:_bulkResults.filter((r,i)=>i!==3).map(r=>[r.scanUid,r.marketPrice])}));
 check(width+' recovers just that physical card',recovered.uid,'physical-3');
 check(width+' replaces the photo',recovered.file,'closer.png');
 check(width+' uses returned catalogue identity',recovered.name,'Fixture card');
 check(width+' does not invent a condition',recovered.condition,'');
 check(width+' keeps the other eight rows',recovered.other,[['physical-0',30],['physical-1',40],['physical-2',50],['physical-4',null],['physical-5',null],['physical-6',null],['physical-7',null],['physical-8',null]]);
 check(width+' updates subtotal',await page.locator('#bulkPackTrackerAmt').textContent(),'$127.25');
 check(width+' updates header after retry',await page.locator('#bulkScanSubtitle').textContent(),'4/9 cards identified');
 check(width+' saving re-enabled',await page.locator('#bulkAddAllBtn').isEnabled());
 await page.evaluate(()=>bulkRemoveResult('bulk-row-4'));
 check(width+' removal updates count',await page.locator('#bulkScanSubtitle').textContent(),'4/8 cards identified');
 // A second provider miss remains an unresolved row, with no invented value.
 await seed();await choose();reply={};await row().getByRole('button',{name:'Scan new photo · 1 credit'}).click();
 await page.waitForFunction(()=>!_bulkProcessing);reply={card_name:'Fixture card',set_name:'Fixture set',card_number:'7',card_type:'pokemon'};
 check(width+' second miss is still unresolved',await page.evaluate(()=>_bulkResults[3].definiteMiss===true&&!_bulkResults[3].success));
 check(width+' second miss keeps subtotal',await page.locator('#bulkPackTrackerAmt').textContent(),'$120.00');
 // Failure text is escaped even when a service supplies markup-shaped content.
 await seed();await page.evaluate(()=>{window._savedHint=_bulkErrorHint;_bulkErrorHint=()=>'<img src=x onerror="window._unsafeHint=true">';const r=_bulkResults[3];r.definiteMiss=false;r.error='<svg onload="window._unsafeHint=true">';_bulkUpdateRow(r.rowId,r)});
 check(width+' error markup stays text',await row().locator('svg').count(),0);
 check(width+' hint markup stays text',(await row().innerText()).includes('<img src=x onerror='));
 check(width+' no hint script executes',await page.evaluate(()=>!!window._unsafeHint),false);
 // Existing same-photo retries retain their server entitlement and chosen condition.
 await page.evaluate(()=>{_bulkErrorHint=_savedHint;const r=_bulkResults[3];r.error='Network error';r.scanId='fixture-previous-scan';r.condition='LP';r.conditionChosen=true;_bulkUpdateRow(r.rowId,r)});
 await row().getByRole('button',{name:'Retry same photo',exact:true}).click();await page.waitForFunction(()=>!_bulkProcessing);
 check(width+' same-photo retry forwards its scan id',requests.at(-1).retry_of,'fixture-previous-scan');
 check(width+' retry preserves seller condition',await page.evaluate(()=>[_bulkResults[3].condition,_bulkResults[3].conditionChosen]),['LP',true]);
 // Switching accounts after preview cannot submit under the new owner.
 await seed();await choose();const beforeOwner=requests.length;
 await page.evaluate(()=>{_fbAuth.currentUser={uid:'other-owner'};return bulkRetryRow('bulk-row-3',true)});
 check(width+' account switch cancels prepared action',requests.length,beforeOwner);
 // Closing/reopening during the network response cannot replace the same DOM ID in the next batch.
 await seed();await choose();holdScan=true;releaseScan=null;
 await page.evaluate(()=>{window._staleRetry=bulkRetryRow('bulk-row-3',true)});
 while(!releaseScan)await new Promise(r=>setTimeout(r,10));
 await page.evaluate(()=>{seedRecovery();_bulkResults[3].scanUid='next-batch-card';_bulkProcessing=true;});
 releaseScan();holdScan=false;await page.evaluate(()=>_staleRetry);
 check(width+' late result cannot overwrite next batch',await page.evaluate(()=>_bulkResults[3].scanUid),'next-batch-card');
 check(width+' late finally cannot stop next batch',await page.evaluate(()=>_bulkProcessing),true);
 // Closing during the local check must also discard it before any confirmation exists.
 await seed();await page.evaluate(()=>{window._bulkCheckPhoto=()=>new Promise(r=>window._resolvePhoto=r);window._stalePhoto=_bulkPrepareReplacementPhoto(_bulkResults[3],new File(['synthetic'],'later.jpg',{type:'image/jpeg'}));seedRecovery();_resolvePhoto(null);});
 await page.evaluate(()=>_stalePhoto);
 check(width+' stale local check cannot attach a preview',await page.evaluate(()=>!!_bulkResults[3]._replacementPhoto),false);
 check(width+' no unexpected page errors',errors,[]);
 await page.close();
}
console.log(`bulk-recovery-browser: ${checks} passed, 0 failed -- SUITE COMPLETE, exit=0`);
}finally{await browser.close();server.close();}
