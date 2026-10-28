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
  for(const kind of ['slab','promo','printing']){
   response={success:true,identified:false,card_name:'',identity_review:{kind,name:'<b>Fixture card</b>',game:kind==='promo'?'onepiece':kind==='printing'?'yugioh':'pokemon',message:'Review the exact printing. No ID credit was used.'}};
   await page.evaluate(()=>_testBulk());
   check(width+'/'+kind+': no price lookup',priceCalls,0);
   check(width+'/'+kind+': identity cannot save or draft',await page.evaluate(()=>!_bulkResults[0].success&&!_bulkResults[0].cardName&&_bulkResults[0].marketPrice===null&&_bulkDraftSelectable().length===0&&_bulkDraftUnits(_bulkResults[0]).length===0));
   check(width+'/'+kind+': cannot enter automatic text rescue',await page.evaluate(()=>!_bulkRescueEligible(_bulkResults[0])));
   check(width+'/'+kind+': review counted',/1 need match review/.test(await page.locator('#bulkPackTrackerStatus').innerText()));
   check(width+'/'+kind+': provider text is escaped',await page.locator('#bulk-row-0 b').count(),0);
   const button=page.getByRole('button',{name:'Review in Card Lookup · free',exact:true});
   check(width+'/'+kind+': button fits viewport',await button.evaluate(e=>e.getBoundingClientRect().right<=innerWidth&&e.getBoundingClientRect().height>=44));
   const before=scans;await button.click();
   check(width+'/'+kind+': free handoff makes no scan',scans,before);
   check(width+'/'+kind+': handoff uses real lookup input',await page.locator('#searchInput').inputValue(),'<b>Fixture card</b>');
   check(width+'/'+kind+': original stays unresolved',await page.evaluate(()=>!_bulkResults[0].success&&_bulkResults[0].file.name==='fixture.jpg'));
   await page.evaluate(()=>{document.getElementById('bulkScanOverlay').style.display='none';window._lastIdentifiedCard=null;window._pendingIdScanCard=null;return processScanImage({files:[new File(['synthetic'],'single.jpg',{type:'image/jpeg'})]})});
   check(width+'/'+kind+': single scan presents review',await page.getByRole('button',{name:'Review in Card Lookup · free',exact:true}).count(),1);
   check(width+'/'+kind+': single scan never accepts raw identity',await page.evaluate(()=>!window._lastIdentifiedCard&&!window._pendingIdScanCard));
   check(width+'/'+kind+': single review skips OCR',await page.evaluate(()=>ocrCalls),0);
   check(width+'/'+kind+': no auto view-card or grade offer',await page.locator('#scanViewCardBtn').isVisible(),false);
   await page.getByRole('button',{name:'Review in Card Lookup · free',exact:true}).click();
  }
  response={success:true,identified:false,card_name:'',ximilar_reason:'unsupported_card_type',retake_hint:'This card game is not supported by automatic identification. No ID credit was used.'};
  await page.evaluate(()=>_testBulk());
  check(width+': unsupported game is explicit',(await page.locator('#bulk-row-0').innerText()).includes('not supported'));
  check(width+': unsupported game cannot use Pokemon recovery',await page.evaluate(()=>_bulkResults[0].unsupportedGame&&!_bulkRescueEligible(_bulkResults[0])));
  await page.evaluate(()=>{document.getElementById('bulkScanOverlay').style.display='none';return processScanImage({files:[new File(['synthetic'],'unsupported.jpg',{type:'image/jpeg'})]})});
  check(width+': single unsupported game skips OCR',await page.evaluate(()=>ocrCalls),0);
  await page.evaluate(()=>cancelScan());
  check(width+': provider outage is not blamed on photo',await page.evaluate(()=>_bulkErrorHint('Card identification unavailable')), 'Our scanner is having trouble — retry shortly.');
  for(const [label,setName,cardNumber,expected] of [['exact','Chaos Origins','CORI-EN051',0.25],['wrong set','Another set','CORI-EN051',null],['passcode','Chaos Origins','101305051',null],['no provenance',null,null,null]]){
   priceResponse={market:0.25,variant:'normal',setName,cardNumber};
   const result=await page.evaluate(()=>_bulkFetchPriceYGO('Blitzclique - Breakaway','CORI-EN051','Chaos Origins'));
   check(width+': YGO '+label,result.marketPrice,expected);
  }
  check(width+': no inventory or draft writes',writes,[]);check(width+': no local inventory additions',await page.evaluate(()=>loadPortData().length),0);check(width+': no page errors',errors,[]);
  await context.close();
 }
 console.log(`scanner-identity-review-browser: ${checks} passed, 0 failed -- SUITE COMPLETE`);
}finally{await browser.close()}
