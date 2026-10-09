// Normal UI → real scan/ledger handler → real private history, on isolated Redis.
// Only auth, vision and external catalog providers are synthetic. No live calls.
import assert from 'node:assert/strict';
import {billingHarness,exact,UID} from './_scanBillingHarness.mjs';
import {redisCommand as redis} from './_idRedis.mjs';
import {membershipEnrollmentKey,createMembershipConsumption} from '../api/_membershipConsumption.js';
import {MEMBERSHIP_LEGACY_FENCE} from '../api/_membershipLegacyFence.js';
import {grantMembership} from '../api/_membershipLedger.js';
import {createGradeHistoryHandler} from '../api/grade-history.js';
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import {chromium} from 'playwright';
const h=billingHarness({balance:0});let calls=0,requests=[],loseNext=false,deny=false,cv=true,checks=0;
const check=(label,a,b)=>{assert.deepEqual(a,b,label);checks++;console.log('✓ '+label)};
await redis(['SET',MEMBERSHIP_LEGACY_FENCE,'1']);
await redis(['SET',membershipEnrollmentKey(UID),JSON.stringify({version:'launch-v2',owner:UID,verified:true,plan:'paid',subscription:'sub_browser',capabilities:{bulkGrade:false}})]);
const now=Number((await redis(['TIME']))[0]);
await grantMembership(redis,'period',{owner:UID,invoiceId:'in_browser',subscriptionId:'sub_browser',plan:'pro',periodStart:now-10,periodEnd:now+3600,currency:'usd',amountCents:1999,paid:true});
process.env.MEMBERSHIP_BILLING_V2='on';process.env.OPENAI_API_KEY='local-placeholder';process.env.ENABLE_XIMILAR_GRADER='deep_only';
globalThis.__STUB=exact();
globalThis.__XIMILAR_GRADE=async()=>cv?{ok:true,grades:{centering:9,corners:9,edges:9,surface:9,final:9,condition:'Mint'},cv:{}}:{ok:false,error:'Synthetic provider unavailable'};
const localFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 if(String(input).startsWith('https://api.openai.com/')){calls++;return Response.json({choices:[{message:{content:JSON.stringify({card_name:'Synthetic Pikachu',centering:'55/45 L/R, 50/50 T/B',corners:'Near Mint',edges:'Mint',surface:'Mint',psa_estimate:9,grade_label:'Mint',grade_notes:'Synthetic corner wear',worth_grading:true,confidence:'high'})}}]})}
 return localFetch(input,init);
};
const history=createGradeHistoryHandler({verify:async()=>({uid:UID}),kv:async(...args)=>redis(args)});
const balance=async()=> (await createMembershipConsumption({execute:redis})('snapshot',{owner:UID,receipt:'0'.repeat(64),scan:'read',mode:'grade'})).remaining;
const root=resolve(new URL('../',import.meta.url).pathname);
const server=createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://local');
 if(['/api/scan','/api/grade-history'].includes(url.pathname)){
  let raw='';for await(const part of req)raw+=part;req.body=raw?JSON.parse(raw):{};req.query=Object.fromEntries(url.searchParams);
  if(url.pathname==='/api/scan'){
   requests.push(req.body);const r=deny?{statusCode:403,payload:{error:'Bulk Grade requires Pro or Business.'}}:await h.invokeScan(req.body);
   if(loseNext){loseNext=false;res.writeHead(202,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'scan_intent_pending'}));return}
   res.writeHead(r.statusCode,{'Content-Type':'application/json'});res.end(JSON.stringify(r.payload));return;
  }
  res.status=n=>{res.statusCode=n;return res};res.json=x=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(x))};return history(req,res);
 }
 if(url.pathname.startsWith('/api/')){res.writeHead(503);res.end('{}');return}
 let path=join(root,url.pathname==='/'?'index.html':url.pathname);if(!existsSync(path))path=join(root,'public',url.pathname);
 if(!existsSync(path)){res.writeHead(404);res.end();return}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(path)]||'application/octet-stream');res.end(readFileSync(path));
 }catch(error){res.writeHead(500);res.end(JSON.stringify({error:error.message}));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.fulfill({status:503,body:'{}'}));
 await page.goto(origin);
 await page.evaluate(uid=>{window.googleUser={sub:uid};window._googleIdToken='x'.repeat(40);window._fbAuth={currentUser:{uid,getIdToken:async()=>'x'.repeat(40)}};window._userTier='pro';window._scanCredits=40;window._membershipVenueAccess={owner:uid,plan:'pro',bulkGrade:true};window.loadSettingsScanCredits=async()=>{}},UID);
 const photos=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=520;c.height=720;const ctx=c.getContext('2d'),out=[];let seed=42;for(let n=0;n<8;n++){const image=ctx.createImageData(c.width,c.height);for(let i=0;i<image.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;image.data[i]=seed&255;image.data[i+1]=(seed>>>8)&255;image.data[i+2]=(seed>>>16)&255;image.data[i+3]=255}ctx.putImageData(image,0,0);out.push(c.toDataURL('image/jpeg',.92).split(',')[1])}return out});
 const files=photos.map((b,i)=>({name:`photo-${i}.jpg`,mimeType:'image/jpeg',buffer:Buffer.from(b,'base64')}));
 async function open(mode='quick'){
  await page.locator('#gradeScanSubBtn').click();await page.locator('#openBulkGradeBtn').click();
  await page.locator('#bulkGradeBatchPickerOverlay button').filter({hasText:mode==='quick'?'Quick':'Deep'}).click();
  await page.locator('#bulkGradeUploadBtn').waitFor({state:'visible'});
 }
 await open();
 await page.locator('#bulkGradeInput').setInputFiles(files.slice(0,3));
 check('incomplete group does not shift pairings',await page.evaluate(()=>window._bulkGradeQueue.length),0);
 await page.locator('#bulkGradeInput').setInputFiles(files.slice(0,4));
 check('batch uses an opaque surface',await page.locator('#bulkGradeOverlay').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(17, 17, 17)');
 check('ordered review shows four labeled photos',await page.locator('#bulkGradePhotoReview figure').count(),4);
 await page.locator('#bulkGradeStartBtn').click();
 await page.waitForFunction(()=>!window._bulkGradeProcessing&&window._bulkGradeResults.length===2);
 check('two real responses recognized',await page.evaluate(()=>window._bulkGradeResults.every(r=>r.success)),true);
 check('each request has stable token',requests.every(r=>/^[a-f0-9]{64}$/.test(r.operation_id)&&r.bulkGrade),true);
 check('completed results keep physical-card thumbnails',await page.locator('#bulkGradeResultsList img').count(),2);
 check('exactly two grade credits debited',await balance(),38);
 check('no obsolete subscore attribution',await page.locator('#bulkGradeOverlay').innerText().then(x=>x.includes('floor of the minimum')),false);
 await page.locator('#bulkGradeSaveAllBtn').click();await page.getByText('2 reports saved.',{exact:false}).waitFor();
 await page.locator('#bulkGradeSaveAllBtn').click();
 await page.evaluate(async()=>{const r=window._bulkGradeResults[0];await window.saveAiGradeReport(r.rawServer,crypto.randomUUID(),r.owner)});
 check('saving a recovered analysis is idempotent across new client IDs',Number(await redis(['HLEN',`ai_grades:{${UID}}:reports`])),2);
 await page.screenshot({animations:'disabled',path:'/tmp/cardresell-batch-quick.png'});
 await page.locator('#bulkGradeBottomBar button').filter({hasText:'Done'}).click();
 await open('deep');await page.locator('#bulkGradeInput').setInputFiles(files.slice(0,6));cv=false;
 await page.locator('#bulkGradeStartBtn').click();await page.waitForFunction(()=>!window._bulkGradeProcessing&&window._bulkGradeResults.length===1);
 check('real Deep fallback recognized',await page.evaluate(()=>window._bulkGradeResults[0].fallback),true);
 check('fallback billed one',await balance(),37);
 await page.getByRole('button',{name:'View grade report',exact:true}).click();
 await page.getByText('Deep analysis fell back to Quick Grade.',{exact:false}).waitFor();
 await page.screenshot({animations:'disabled',path:'/tmp/cardresell-batch-deep.png'});
 await page.getByRole('button',{name:'← Back to batch'}).click();await page.locator('#bulkGradeBottomBar button').filter({hasText:'Done'}).click();
 await open();await page.locator('#bulkGradeInput').setInputFiles(files.slice(6,8));loseNext=true;
 await page.locator('#bulkGradeStartBtn').click();await page.locator('#bulkGradeRetryBtn').waitFor({state:'visible'});
 const countBefore=calls,creditBefore=await balance(),lastOperation=requests.at(-1).operation_id;
 await page.locator('#bulkGradeRetryBtn').click();await page.waitForFunction(()=>!window._bulkGradeProcessing&&window._bulkGradeResults[0]?.success);
 check('recovery reuses operation',requests.at(-1).operation_id,lastOperation);
 check('lost-response recovery does not call provider twice',calls,countBefore);
 check('lost-response recovery does not charge twice',await balance(),creditBefore);
 await page.locator('#bulkGradeBottomBar button').filter({hasText:'Done'}).click();
 await open();await page.locator('#bulkGradeInput').setInputFiles(files.slice(0,4));deny=true;const before=requests.length;
 await page.locator('#bulkGradeStartBtn').click();await page.waitForFunction(()=>!window._bulkGradeProcessing&&window._bulkGradeResults.length===1);
 check('403 stops further cards',requests.length-before,1);
 check('403 is visible inline',await page.getByText('Bulk Grade requires Pro or Business.',{exact:true}).isVisible(),true);
 check('403 does not consume credits',await balance(),creditBefore);
 await page.locator('#bulkGradeBottomBar button').filter({hasText:'Done'}).click();
 await page.locator('#searchInput').fill('Mew');
 await page.getByText('Live catalog unavailable.',{exact:false}).waitFor();
 check('catalog outage keeps selectable local printings',await page.locator('#dropList .drop-item').count()>0,true);
 await page.locator('#dropList .drop-item').first().click();
 check('fallback selection has no invented market price',await page.evaluate(()=>selectedCard.priceVariants.length),0);
 check('fallback selection retains local source',await page.evaluate(()=>selectedCard.source.includes('Local catalog')),true);
 await page.evaluate(async()=>{
   const oldFetch=window.fetch;let finish;
   window.fetch=()=>new Promise(r=>{finish=r});
   const originalOwner=window.googleUser.sub;
   const pending=_pullUserData();
   window.googleUser={sub:'different-owner'};
   finish(new Response(JSON.stringify({portfolio:[{id:'foreign-row'}],flips:[]})));
   await pending;
   window._isolationRead=loadPortDataRaw().some(r=>r.id==='foreign-row');
   window.googleUser={sub:originalOwner};window.fetch=oldFetch;
 });
 check('late cloud read cannot cross account boundary',await page.evaluate(()=>window._isolationRead),false);
 await page.evaluate(async()=>{
   const oldFetch=window.fetch;window.fetch=async()=>new Response(JSON.stringify({error:'unavailable'}),{status:503});
   await _pushUserData();window.fetch=oldFetch;
 });
 check('failed cloud save is visible',await page.locator('#collectionSyncStatus').textContent().then(x=>x.includes('device only')),true);
 check('no browser exceptions',errors,[]);
 check('no live provider requests',h.outbound,[]);
 console.log(`SUITE COMPLETE: batch-grade-browser.mjs: ${checks} passed, 0 failed`);
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));h.restore()}
process.exit(0);
