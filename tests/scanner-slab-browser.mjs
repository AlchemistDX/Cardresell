// Production UI with controlled HTTP responses. This verifies handling, not
// recognition accuracy. No customer photos, real credentials or external calls.
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(new URL('..',import.meta.url).pathname),origin='https://identity-review.test';
let checks=0;
const check=(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);checks++};
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
try{
 for(const width of [320,390,1280]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  let response={},priceResponse={},scans=0,priceCalls=0;const writes=[],errors=[];
  await context.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(u.origin!==origin)return json({error:'offline'},503);
   if(u.pathname==='/api/scan'){scans++;return json(response)}
   if(u.pathname==='/api/tcg-price'){priceCalls++;return json(priceResponse)}
   if(u.pathname.startsWith('/api/')){if(req.method()!=='GET'&&/drafts|user-data|scan-debit-id/.test(u.pathname))writes.push(u.pathname);return json({error:'offline'},503)}
   try{const p=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!p.startsWith(root+'/'))throw Error('path');return route.fulfill({body:readFileSync(p),contentType:p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html'})}
   catch{return route.fulfill({status:404,body:''})}
  });
  const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForFunction(()=>typeof bulkReviewIdentity==='function');
  await page.evaluate(()=>{
   window.googleUser={uid:'fixture',sub:'fixture',email:'fixture@example.test'};
   window._fbAuth={currentUser:{uid:'fixture',getIdToken:async()=> 'x'.repeat(40)}};
   window._googleIdToken='x'.repeat(40);window.checkProStatus=()=>{};
   window.cardResellScanRequest=fetch;window.compressImage=async()=> 'c3ludGhldGlj';
   window._bulkCheckPhoto=async()=>null;
   window.CardResellPhotoQC.check=async()=>({ok:true});window.CardResellFastPath.scanFile=async()=>({hit:false});
   window._tryOCRRescue=async()=>{window.ocrCalls++;return null};window.ocrCalls=0;
   window._testBulk=async()=>{
    window._bulkProcessing=false;window._bulkSaved=false;window._bulkDraftBusy=false;window._bulkDraftSel=[];
    const file=new File(['synthetic'],'fixture.jpg',{type:'image/jpeg'});
    const item={file,objectUrl:URL.createObjectURL(file),scanUid:crypto.randomUUID()};
    window._bulkQueue=[item];window._bulkResults=[];
    const result=await _bulkScanOne(item,'bulk-row-0',false);window._bulkResults=[result];
    document.getElementById('bulkScanOverlay').style.display='flex';_bulkShowSection('processing');
    document.getElementById('bulkResultsList').innerHTML='<div id="bulk-row-0" style="display:flex;gap:12px;padding:12px"></div>';
    _bulkUpdateRow(result.rowId,result);_bulkRefreshResultSummary();_bulkUpdatePackTracker();
   };
  });
  for (const game of ['pokemon','sports']) {
   response={success:true,card_name:game==='pokemon'?'Charizard':'LeBron James',card_number:game==='pokemon'?'14':'8',set_name:game==='pokemon'?'Team Up':'Mosaic',card_type:game,year:'2019',slab:{grader:'PSA',grade:'9',cert:'51044018'}};
   await page.evaluate(()=>_testBulk());
   check(width+'/'+game+': no raw price request',priceCalls,0);
   check(width+'/'+game+': grade preserved in row and draft',await page.evaluate(()=>{const r=_bulkResults[0],d=_bulkScanRowToCard(r);return [r.success,r.marketPrice,r.grader,r.grade,r.cert,d.grader,d.grade,d.cert,d.condition]}),[true,null,'PSA','9','51044018','PSA','9','51044018','']);
   check(width+'/'+game+': label visible',(await page.locator('#bulk-row-0').innerText()).includes('PSA 9 · Cert 51044018'));
   check(width+'/'+game+': no raw condition button',await page.getByRole('button',{name:'Set condition',exact:false}).count(),0);
   await page.evaluate(()=>bulkOpenCardInLookup('bulk-row-0'));
   check(width+'/'+game+': lookup grade selection',await page.evaluate(()=>[selectedCard.grader,selectedCard.grade,selectedCard.cert,document.querySelector('#gradedPills .pill.sel')?.dataset.val,document.getElementById('gradeSelect').value]),['PSA','9','51044018','psa','9']);
   await page.evaluate(()=>addCurrentCardToCollection());
   check(width+'/'+game+': collection form retains cert',await page.locator('#mCertNumber').inputValue(),'51044018');
   await page.evaluate(()=>closeFlipModal());
   check(width+'/'+game+': raw prices still not requested',priceCalls,0);
   check(width+'/'+game+': no invented grade price',await page.evaluate(()=>{const p=getEffectivePrice();return p==null||p===0}));
   await page.evaluate(()=>_prepareSingleScanDraft({name:'Charizard',setName:'Team Up',number:'14',cardType:'pokemon',grader:'PSA',grade:'9',cert:'51044018'}));
   check(width+'/'+game+': single draft retains cert',await page.evaluate(()=>_singleScanDraft.card.cert),'51044018');
  }
  check(width+': no writes',writes,[]);check(width+': no page errors',errors,[]);
  await context.close();
 }
 console.log(`scanner-slab-browser: ${checks} passed, 0 failed -- SUITE COMPLETE`);
}finally{await browser.close()}
