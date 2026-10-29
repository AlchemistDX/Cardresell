// Real scan/confirmation handlers and Redis; shipped UI; all services stubbed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { harness } from './_assert.mjs';
import { billingHarness, ambiguous, UID } from './_scanBillingHarness.mjs';
const t=harness('single-scan-review-browser');
const root=resolve(new URL('..',import.meta.url).pathname),origin='https://single-review.test';
const recoveryPhoto=readFileSync(resolve(root,'tests/fixtures/grade-check/front-sharp.jpg')).toString('base64');
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,10))}throw Error('request did not reach boundary')}
const modes=['magic','japanese','magic-japanese','wrong-result','wrong-scan','lost','lost-auth','pending-close','account','token-account','token-timeout','body-timeout','invalid-offer','qc-cancel','qc-error','fastpath-error','compress-error','compress-failure','direct-html','direct-error-html','scan-recovery','scan-recovery-service','scan-recovery-unreadable','scan-recovery-account','grade-recovery','grade-recovery-account','grade-cancel','grade-qc-cancel','grade-double-submit'];
try {
 for(const mode of modes){
  const h=billingHarness({bucket:'free',balance:4});let hold=null,first=true;
  const stub=ambiguous();
  const magic=mode.startsWith('magic');
  const raw=stub.ximilar.candidates.map((c,i)=>({...c,card_type:magic?'mtg':'pokemon',
    card_name:magic?'Fixture Wizard':c.card_name,is_japanese:mode.includes('japanese'),jp_name:mode.includes('japanese')?'日本語のカード':'',
    language:mode.includes('japanese')?'ja':'en',grounded_id:'verified-'+i,_grounded_id:'verified-'+i,
    variant:'Variant '+i,_ximilar_full_name:'Catalogue printing '+i}));
  stub.ximilar.candidates=raw;stub.ximilar.cardInfo={...raw[0]};
  if(magic){const f=globalThis.fetch;globalThis.fetch=async(u,o)=>new URL(String(u)).hostname==='api.scryfall.com'?Response.json({},{status:404}):f(u,o)}
  const offered=(await h.scan(stub)).payload;
  const context=await browser.newContext({viewport:{width:390,height:844}}),calls=[],auths=[],scans=[],writes=[],errors=[];
  await context.addInitScript(()=>{
    const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,ms===15000?250:ms,...args);
    localStorage.setItem('cs_landing_seen','1');
  });
  await context.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(u.origin!==origin)return route.fulfill({status:503,body:'offline'});
    if(u.pathname==='/api/scan-debit-id'){
      const body=req.postDataJSON();calls.push(body);auths.push(req.headers().authorization);await new Promise(r=>{hold=r});
      if(mode==='lost-auth'&&calls.length===2)return json({ok:false,error:'Invalid session.'},401);
      const result=await h.pick(body);
      if(mode.startsWith('lost')&&first){first=false;return route.abort('failed')}
      if(mode==='wrong-result'&&first){first=false;return json({...result.payload,pickedCard:{...result.payload.pickedCard,set_name:'Wrong printing'}})}
      if(mode==='wrong-scan'&&first){first=false;return json({...result.payload,scan_id:'other-scan'})}
      return json(result.payload,result.statusCode);
    }
    if(u.pathname==='/api/scan'){scans.push(req.postDataJSON());if(scans.length===1&&['scan-recovery-service','scan-recovery-unreadable'].includes(mode))return route.fulfill({status:mode==='scan-recovery-service'?503:200,contentType:'text/html',body:'<html>Service unavailable</html>'});if(mode==='direct-error-html')return json({error:'<b>Offline</b>'},503);return json(mode==='direct-html'?{success:true,identified:true,card_name:'<b>Fixture Wizard</b>',card_number:'<i>58</i>',set_name:'<u>set6</u>',card_type:'mtg',confidence:'high'}:{success:true,identified:false,card_name:''})}
    if(u.pathname==='/api/pro-status')return json({tier:'pro',isPro:true,idFreeLeft:29,idPaidLeft:4});
    if(u.pathname.startsWith('/api/')){if(req.method()!=='GET')writes.push(u.pathname);return json({error:'offline'},503)}
    try{const p=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!p.startsWith(root+'/'))throw Error('path');return route.fulfill({body:readFileSync(p),contentType:p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html'})}
    catch{return route.fulfill({status:404,body:''})}
  });
  try{
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(5000);await page.goto(origin);
    await page.waitForFunction(()=>typeof _renderScanCandidatesPicker==='function');
    await page.evaluate(({offered,uid,mode})=>{
      window.googleUser={uid,email:'confirmation@example.test'};
      window._fbAuth={currentUser:{uid,getIdToken:async()=> {tokenCalls++;return 'x'.repeat(40)}}};window._googleIdToken='stale-token-not-for-confirmation';
      window._scheduleScanAutoAdvance=()=>{};window.checkProStatus=()=>new Promise(()=>{});
      window._prepareSingleScanDraft=()=>{};window._persistLastIdentified=p=>{window._lastIdentifiedCard=structuredClone(p)};
      document.getElementById('scanOverlay').style.display='flex';
      const data=mode==='invalid-offer'?{...offered,confirmation_id:'broken'}:offered;
      _renderScanCandidatesPicker(data.candidates,document.getElementById('scanStatus'),document.getElementById('scanResult'),null,data);
      window.tokenCalls=0;
      if(mode.startsWith('token-'))window._fbAuth.currentUser.getIdToken=()=>{tokenCalls++;return new Promise(r=>window.releaseToken=r)};
      if(mode==='body-timeout'){
        const f=window.fetch;window.fetch=async(...args)=>{
          const r=await f(...args);if(String(args[0])==='/api/scan-debit-id'){const value=await r.json();r.json=()=>new Promise(resolve=>{window.releaseJson=()=>resolve(value)})}return r;
        };
      }
    },{offered,uid:UID,mode});
    if(mode==='magic')t.check('single choices show variant and full catalogue label',/Variant 6.*Catalogue printing 6/.test(await page.locator('#scanResult').innerText()));
    if(mode.startsWith('grade-')){
      await page.evaluate(mode=>{
        cancelScan();document.getElementById('scanOverlay').style.display='flex';
        window._gradeFrontBase64='grade-front';window._gradeBackBase64='grade-back';window.gradeChecks=0;
        window._gradePhotoCheckAll=async()=>{gradeChecks++;if(mode==='grade-qc-cancel')return new Promise(resolve=>{window.releaseGradeQC=()=>resolve(null)});return null};
        const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,ms===90000?150:ms,...args);
        const fetch=window.fetch;let first=true;
        window.fetch=async(...args)=>{
          const response=await fetch(...args);
          if(String(args[0])==='/api/scan'){
            const grade=Response.json({success:true,psa_estimate:8,grade_label:'Fixture estimate',card_name:'Fixture Wizard',card_type:'mtg',creditsUsed:1});
            if(first){first=false;grade.arrayBuffer=()=>new Promise(resolve=>{window.releaseGradeBody=()=>resolve(new TextEncoder().encode(JSON.stringify({success:true,psa_estimate:8,card_name:'Fixture Wizard',card_type:'mtg',creditsUsed:1})).buffer)})}
            return grade;
          }
          return response;
        };
        window.processing=submitGradeScan(false);
      },mode);
      if(mode==='grade-qc-cancel'){
        await page.waitForFunction(()=>!!window.releaseGradeQC);
        await page.evaluate(()=>{cancelScan();document.getElementById('scanStatus').textContent='Next screen';releaseGradeQC()});
        await page.evaluate(()=>window.processing);
        t.check('cancel during grade photo checks sends no scan',scans.length===0);
        t.check('late photo checks cannot overwrite the next screen',await page.locator('#scanStatus').textContent()==='Next screen');
        continue;
      }
      if(mode==='grade-double-submit'){
        await page.waitForFunction(()=>!!window.releaseGradeBody);
        await page.evaluate(()=>submitGradeScan(false));
        t.check('duplicate grade submission cannot send a second request',scans.length===1&&await page.evaluate(()=>gradeChecks===1));
        await page.evaluate(()=>releaseGradeBody());await page.evaluate(()=>window.processing);
        t.check('original grade completes after duplicate tap',await page.locator('#scanStatus .grade-headline').textContent()==='PSA 8');
        continue;
      }
      if(mode==='grade-cancel'){
        await page.waitForFunction(()=>!!window.releaseGradeBody);
        await page.evaluate(()=>{cancelScan();document.getElementById('scanStatus').textContent='Next screen';releaseGradeBody()});
        await page.evaluate(()=>window.processing);
        t.check('cancelled grade cannot replace the next screen',await page.locator('#scanStatus').textContent()==='Next screen');
        t.check('cancelled grade cannot replace grade identity',await page.evaluate(()=>!window._deepGradeIdent));
      }else{
        await page.evaluate(()=>window.processing);
        const button=page.getByRole('button',{name:'Retry same photos',exact:true});
        t.check(mode+': timeout replaces animation with a recovery action',await button.count()===1);
        if(process.env.CR_SHOT_DIR&&mode==='grade-recovery')await page.screenshot({path:resolve(process.env.CR_SHOT_DIR,'grade-recovery.png')});
        if(await button.count()){
          if(mode.endsWith('account'))await page.evaluate(()=>{_fbAuth.currentUser={uid:'other'};googleUser={uid:'other'}});
          else await page.evaluate(()=>{googleUser.email='changed-after-grade@example.test'});
          await button.click();await page.waitForTimeout(200);
          t.check(mode+': recovery reuses exact grade request for the same owner',mode.endsWith('account')?scans.length===1:scans.length===2&&JSON.stringify(scans[0])===JSON.stringify(scans[1]));
          t.check(mode+': recovery does not repeat photo checks',await page.evaluate(()=>gradeChecks===1));
          if(!mode.endsWith('account'))t.check('recovered grade is displayed',await page.locator('#scanStatus .grade-headline').textContent()==='PSA 8'&&await page.evaluate(()=>_deepGradeIdent?.name==='Fixture Wizard'));
          await page.evaluate(()=>releaseGradeBody());
        }
      }
      t.check(mode+': no confirmation, inventory or listing writes',calls.length===0&&!writes.some(x=>/draft|user-data|collection/.test(x)),writes.join(', '));
      continue;
    }
    if(mode.startsWith('scan-recovery')){
      await page.evaluate(({photo,mode})=>{
        cancelScan();window._lastIdentifiedCard=null;
        window.photoChecks=0;window.photoCompressions=0;window._tryOCRRescue=async()=>null;
        window.CardResellPhotoQC.check=async()=>{photoChecks++;return {ok:true}};
        window.CardResellFastPath.scanFile=async()=>({hit:false});
        window.compressImage=async()=>{photoCompressions++;return 'original-photo-bytes'};
        const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,ms===45000?150:ms,...args);
        const fetch=window.fetch;let first=true;
        window.fetch=async(...args)=>{
          const response=await fetch(...args);
          if(String(args[0])==='/api/scan'&&first&&!['scan-recovery-service','scan-recovery-unreadable'].includes(mode)){first=false;response.arrayBuffer=()=>new Promise(resolve=>{window.releaseScanBody=()=>resolve(new TextEncoder().encode('{}').buffer)})}
          return response;
        };
        window.processing=processScanImage({files:[new File([Uint8Array.from(atob(photo),c=>c.charCodeAt(0))],'card.jpg',{type:'image/jpeg'})]});
      },{photo:recoveryPhoto,mode});
      await page.evaluate(()=>window.processing);
      if(['scan-recovery-service','scan-recovery-unreadable'].includes(mode)){
        t.check(mode+': one request before explicit recovery',scans.length===1);
        t.check(mode+': service failure is not blamed on the photo',/unavailable|unreadable/.test(await page.locator('#scanStatus').innerText())&&!/clearer photo|retake/i.test(await page.locator('#scanStatus').innerText()));
      }
      t.check(mode+': generic new-photo retry does not compete with recovery',!await page.locator('#scanRetryBtn').isVisible());
      t.check(mode+': a stalled scan offers recovery in the result screen',await page.getByRole('button',{name:'Retry same photo',exact:true}).count()===1);
      if(process.env.CR_SHOT_DIR&&mode==='scan-recovery')await page.screenshot({path:resolve(process.env.CR_SHOT_DIR,'scan-recovery.png')});
      if(await page.getByRole('button',{name:'Retry same photo',exact:true}).count()){
        if(mode.endsWith('account'))await page.evaluate(()=>{_fbAuth.currentUser={uid:'other'};googleUser={uid:'other'}});
        else await page.evaluate(()=>{googleUser.email='changed-after-request@example.test'});
        await page.getByRole('button',{name:'Retry same photo',exact:true}).click();
        await page.waitForTimeout(200);
        t.check(mode+': original photo is neither recompressed nor rechecked',await page.evaluate(()=>photoChecks===1&&photoCompressions===1));
        t.check(mode+': replay is scoped to its owner and exact request',mode.endsWith('account')?scans.length===1:scans.length===2&&JSON.stringify(scans[0])===JSON.stringify(scans[1]));
        await page.evaluate(()=>window.releaseScanBody?.());
        t.check(mode+': no confirmation, draft or inventory writes',calls.length===0&&!writes.some(x=>/draft|user-data|collection/.test(x)),writes.join(', '));
      }
      continue;
    }
    if(mode==='magic'){
      const cancel=page.getByRole('button',{name:'None of these — cancel',exact:true});
      await cancel.scrollIntoViewIfNeeded();
      const box=await cancel.boundingBox();
      t.check('mobile review can scroll to the last option and cancel',box&&box.y>=0&&box.y+box.height<=844&&box.height>=44);
      t.check('match list has one bottom cancellation action',!await page.locator('#scanCancelBtn').isVisible());
      if(process.env.CR_SHOT_DIR)await page.screenshot({path:resolve(process.env.CR_SHOT_DIR,'single-review-bottom.png')});
      await page.evaluate(()=>document.getElementById('scanOverlay').scrollTop=0);
      if(process.env.CR_SHOT_DIR)await page.screenshot({path:resolve(process.env.CR_SHOT_DIR,'single-review-top.png')});
    }
    if(mode==='invalid-offer'){
      await page.evaluate(()=>{window.confirmation=_pickScanCandidate(0)});await page.waitForTimeout(100);
      t.check('invalid offer cannot request a debit',calls.length===0);
      t.check('invalid offer explains how to recover',/new photo|scan again/i.test(await page.locator('#scanStatus').textContent()));
      continue;
    }
    if(['qc-cancel','qc-error','fastpath-error','compress-error','compress-failure','direct-html','direct-error-html'].includes(mode)){
      await page.evaluate(mode=>{
        cancelScan();window._lastIdentifiedCard=null;
        window.CardResellPhotoQC.check=async()=>({ok:true});
        window.CardResellFastPath.scanFile=async()=>({hit:false});window.compressImage=async()=> 'ZmFrZS1qcGVn';
        const held=()=>new Promise((resolve,reject)=>{window.releasePreparation=()=>mode==='qc-cancel'?resolve({ok:true}):reject(Error('fixture decode error'))});
        if(mode.startsWith('qc-'))window.CardResellPhotoQC.check=held;
        else if(mode.startsWith('fastpath-'))window.CardResellFastPath.scanFile=held;
        else if(mode.startsWith('compress-'))window.compressImage=held;
        window._tryOCRRescue=async()=>null;
        window.processing=processScanImage({files:[new File(['fixture'],'card.jpg',{type:'image/jpeg'})]});
      },mode);
      if(mode.startsWith('direct-')){
        await page.evaluate(()=>window.processing);
        t.check(mode+': direct scan labels and errors are literal text',await page.locator('#scanStatus').textContent()===(mode==='direct-html'?'✓ <b>Fixture Wizard</b> #<i>58</i><u>set6</u>':'<b>Offline</b>')&&await page.locator('#scanStatus b, #scanStatus i, #scanStatus u').count()===0);
        continue;
      }
      await page.waitForFunction(()=>!!window.releasePreparation);
      await page.evaluate(mode=>{if(mode!=='compress-failure'){cancelScan();document.getElementById('scanStatus').textContent='Next scan'}releasePreparation()},mode);
      await page.evaluate(()=>window.processing);
      t.check(mode+': photo preparation sends no paid request',scans.length===0);
      if(mode==='compress-failure')t.check('compression failure has recoverable error',/could not prepare/.test(await page.locator('#scanStatus').textContent()));
      else t.check(mode+': late preparation cannot overwrite next scan',await page.locator('#scanStatus').textContent()==='Next scan');
      continue;
    }
    // Nonblocking invocation lets the fixture interrupt token/body promises.
    await page.evaluate(()=>{window.confirmation=_pickScanCandidate(6)});
    if(mode.startsWith('token-')){
      await page.waitForFunction(()=>!!window.releaseToken);
      if(mode==='token-timeout')await page.waitForTimeout(300);
      if(mode==='token-account')await page.evaluate(()=>{_fbAuth.currentUser={uid:'other',getIdToken:async()=> 'y'.repeat(40)};googleUser={uid:'other'}});
      await page.evaluate(()=>window.releaseToken?.('x'.repeat(40)));
      t.check(mode+': late token sends no debit',calls.length===0);
      t.check(mode+': no identity or charge',h.net()===0&&await page.evaluate(()=>!window._pendingIdScanCard&&!window._lastIdentifiedCard));
      continue;
    }
    await until(()=>hold);
    t.check(mode+': confirmation refreshes the signed-in token',auths[0]==='Bearer '+'x'.repeat(40)&&await page.evaluate(()=>tokenCalls>0));
    if(mode==='pending-close'){
      await page.evaluate(()=>{window.cameraOpens=0;window.openLiveCameraCapture=()=>cameraOpens++;cancelScan();_startSingleScanCapture()});
      t.check('pending debit keeps confirmation visible',await page.locator('#scanOverlay').isVisible());
      t.check('pending debit cannot open another capture',await page.evaluate(()=>cameraOpens===0));
    }
    if(mode==='account')await page.evaluate(()=>{_fbAuth.currentUser={uid:'other'};googleUser={uid:'other'}});
    hold();hold=null;
    await page.waitForTimeout(300);
    if(mode==='body-timeout'){
      t.check('stalled body offers exact confirmation retry',await page.getByTestId('identity-retry').count()===1);
      await page.evaluate(()=>window.releaseJson?.());await page.waitForTimeout(30);
      t.check('late body cannot promote identity after deadline',await page.evaluate(()=>!window._pendingIdScanCard&&!window._lastIdentifiedCard));
      continue;
    }
    if(mode==='account'){
      t.check('previous owner response cannot promote or persist identity',await page.evaluate(()=>!window._pendingIdScanCard&&!window._lastIdentifiedCard));
      continue;
    }
    if(['lost','lost-auth','wrong-result','wrong-scan'].includes(mode)){
      t.check(mode+': unknown acknowledgement leaves identity unconfirmed',await page.evaluate(()=>!window._pendingIdScanCard&&!window._lastIdentifiedCard));
      t.check(mode+': offers a safe retry',await page.getByTestId('identity-retry').count()===1);
      if(await page.getByTestId('identity-retry').count()){
        await page.getByTestId('identity-retry').click();await until(()=>hold);hold();hold=null;await page.waitForTimeout(300);
        t.check(mode+': identical receipt and selection on retry',JSON.stringify(calls[0])===JSON.stringify(calls[1]));
        if(mode==='lost-auth'){
          await page.evaluate(()=>cancelScan());
          t.check('login failure after a lost reply retains recovery',await page.locator('#scanOverlay').isVisible()&&await page.evaluate(()=>!_pendingIdScanCard&&_scanCandidateReview.uncertain));
          await page.getByTestId('identity-retry').click();await until(()=>hold);hold();hold=null;await page.waitForTimeout(300);
          t.check('re-authenticated retry uses same receipt',JSON.stringify(calls[0])===JSON.stringify(calls[2]));
        }
      }
    }
    t.check(mode+': confirmed result not blocked by credit refresh',await page.evaluate(()=>window._pendingIdScanCard?.setName==='set6'));
    t.check(mode+': one credit only',h.net()===1);
    if(magic||mode==='japanese'){
      const pending=await page.evaluate(()=>window._pendingIdScanCard);
      t.check(mode+': exact printing and language survive',pending?.setCode==='set6'&&pending?.groundedId==='verified-6'&&pending?.isJapanese===mode.includes('japanese')&&pending?.language===(mode.includes('japanese')?'ja':'en')&&pending?.jpName===(mode.includes('japanese')?'日本語のカード':''));
      await page.evaluate(()=>{window.routed='';window._loadScannedJPCard=()=>routed='jp';window._loadScannedNonPokemonCard=p=>{routed='other';window.loadedPrinting=p};window._loadScannedCardExact=()=>routed='pokemon';cancelScan()});
      t.check(mode+': correct game loader',await page.evaluate(()=>routed)===(magic?'other':'jp'));
      if(mode==='japanese')t.check('existing Japanese Pokemon game aliases retain their loader',await page.evaluate(pending=>{
        return ['pokemonJP','pokemonjp','pokemon_jp','pokemon-jp'].every(cardType=>{
          routed='';window._pendingIdScanCard={...pending,cardType};cancelScan();return routed==='jp';
        });
      },pending));
    }
    t.check(mode+': no draft or inventory writes',!writes.some(x=>/draft|user-data/.test(x)));
  }finally{if(hold)hold();t.check(mode+': no browser exceptions',errors.length===0,errors.join('; '));await context.close();h.restore()}
 }
}finally{await browser.close()}
t.done();
