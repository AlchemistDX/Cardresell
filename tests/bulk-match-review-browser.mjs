// Full shipped app; real scan/confirmation handlers and production Lua on a
// private Redis. Auth, provider and catalogue are local synthetic fixtures.
// No external services, paid scans, customer photos or customer records.
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { harness } from './_assert.mjs';
import { billingHarness, ambiguous, UID, PAID_KEY, freeKey, catalogue } from './_scanBillingHarness.mjs';
import { redisCommand as redis } from './_idRedis.mjs';
import { createMembershipConsumption, membershipEnrollmentKey, membershipReceiptKey } from '../api/_membershipConsumption.js';
import { MEMBERSHIP_LEGACY_FENCE } from '../api/_membershipLegacyFence.js';
const t = harness('bulk-match-review-browser');
const ROOT=resolve(new URL('..',import.meta.url).pathname), ORIGIN='https://bulk-review.test';
const shots=process.env.CR_SHOT_DIR || '/tmp/cardresell-bulk-match-review';mkdirSync(shots,{recursive:true});
const consume=createMembershipConsumption({execute:redis});
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
async function until(fn) { for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,10))}throw Error('request did not reach test boundary') }
try {
 for(const billing of ['legacy','membership']) {
  for(const mode of ['cancel','retake','success','lost-after-commit','lost-auth','expired','no-credits','account','batch','scan-account','token-account','token-timeout','invalid-offer','malformed','wrong-price','late-price','magic']) {
   const prefix=billing+'/'+mode;
   const h=billingHarness({bucket:'free',balance:4});
   if(billing==='membership') {
    await redis(['SET',MEMBERSHIP_LEGACY_FENCE,'1']);
    await redis(['SET',membershipEnrollmentKey(UID),JSON.stringify({version:'launch-v2',owner:UID,plan:'free',verified:true,freeThrough:0,capabilities:{bulkGrade:false}})]);
    process.env.MEMBERSHIP_BILLING_V2='on';
   }
   const balance=async()=>billing==='membership'?(await consume('snapshot',{owner:UID,receipt:'0'.repeat(64),scan:'read-only',mode:'identify'})).monthly:30-Number(h.store.get(freeKey()));
   const stub=ambiguous();
   stub.ximilar.candidates=stub.ximilar.candidates.map((c,i)=>({...c,variant:'Variant '+i,_ximilar_full_name:'Catalogue printing '+i}));
   if(mode==='magic') {
    stub.ximilar.cardInfo.card_type='mtg';stub.ximilar.cardInfo.card_name='Fixture Wizard';
    stub.ximilar.candidates=stub.ximilar.candidates.map(c=>({...c,card_type:'mtg',card_name:'Fixture Wizard'}));
    const fixtureFetch=globalThis.fetch;
    globalThis.fetch=async(input,init)=>new URL(String(input?.url||input)).hostname==='api.scryfall.com'
      ?Response.json({object:'error',code:'not_found'},{status:404}):fixtureFetch(input,init);
   }
   const offered=(await h.scan(stub)).payload, initial=await balance();
   const ctx=await browser.newContext({viewport:mode==='magic'?{width:844,height:390}:{width:390,height:844},serviceWorkers:'block'});
   // This is a returning signed-in seller flow. Do not race the unrelated
   // first-visit Charizard example against the pending-price assertions.
   await ctx.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
   let calls=[],writes=[],hold,priceHold,scanHold,drop=mode.startsWith('lost-'),malformed=mode==='malformed',priceRequests=0,scanCalls=0,priceUrls=[];
   await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());
    const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(['api.pokemontcg.io','api.scryfall.com'].includes(u.hostname)) {
     priceUrls.push(u.href);priceRequests++;if(mode==='late-price')await new Promise(r=>{priceHold=r});
     if(u.hostname==='api.scryfall.com')return json({data:[{name:'Fixture Wizard',set_name:'set6',set:'set6',collector_number:'58',finishes:['nonfoil','foil'],prices:{usd:'7',usd_foil:'9'}}]});
     const cards=mode==='wrong-price'?[catalogue[0]]:catalogue;
     return json({data:u.pathname.split('/').length>3?(mode==='wrong-price'?cards[0]:cards.find(c=>u.pathname.endsWith('/'+c.id))):cards});
    }
    if(u.origin!==ORIGIN)return route.abort('blockedbyclient');
    if(u.pathname==='/api/scan'){scanCalls++;if(mode==='scan-account')await new Promise(r=>{scanHold=r});return json(scanCalls>1?(await h.scan(stub)).payload:mode==='invalid-offer'?{...offered,confirmation_id:''}:offered)}
    if(u.pathname==='/api/scan-debit-id') {
     calls.push({body:req.postDataJSON(),raw:req.postData()});
     await new Promise(r=>{hold=r});
     if(mode==='lost-auth'&&calls.length===2)return json({ok:false,error:'Invalid session.'},401);
     const r=await h.pick(req.postDataJSON());
     if(drop){drop=false;return route.abort('failed')}
     if(malformed){malformed=false;return json({...r.payload,pickedCard:{...r.payload.pickedCard,set_name:'wrong'}})}
     return json(r.payload,r.statusCode);
    }
    if(u.pathname==='/api/pro-status')return json({tier:'pro',isPro:true,idFreeLeft:await balance(),idPaidLeft:4});
    if(u.pathname.startsWith('/api/')) {
     if(req.method()!=='GET'&&/drafts|user-data/.test(u.pathname))writes.push(u.pathname);
     return json({error:'offline'},503);
    }
    try {
     const p=resolve(ROOT,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!p.startsWith(ROOT+'/'))throw Error('path');
     return route.fulfill({contentType:p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html',body:readFileSync(p)});
    }catch{return route.fulfill({status:404,body:''})}
   });
   try {
    const page=await ctx.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
    await page.goto(ORIGIN);await page.waitForFunction(()=>window.CardResellBulkMatchReview);
    const setup=page.evaluate(async uid=>{
     window.googleUser={uid,sub:uid,email:'confirmation@example.test'};
     window._fbAuth={currentUser:{uid,getIdToken:async()=> 'x'.repeat(40)}};
     window._googleIdToken='x'.repeat(40);window._bulkProcessing=false;window._bulkSaved=false;window._bulkDraftBusy=false;
     _bulkCheckPhoto=async()=>null; // Photo boundary only: exercise the real scan and row writers.
     const canvas=document.createElement('canvas');canvas.width=700;canvas.height=1000;
     const x=canvas.getContext('2d');x.fillStyle='#6a4f85';x.fillRect(0,0,700,1000);x.fillStyle='#fff';x.font='40px sans-serif';x.fillText('Synthetic card',30,80);
     const file=new File([await new Promise(r=>canvas.toBlob(r,'image/jpeg'))],'fixture.jpg',{type:'image/jpeg'});
     const item={file,objectUrl:URL.createObjectURL(file),scanUid:crypto.randomUUID()};
     window._bulkQueue=[item];window._bulkResults=[];
     window.reviewRow=await _bulkScanOne(item,'bulk-row-0',false);
     if(reviewRow==='STOP')return;
     Object.assign(reviewRow,{condition:'LP',conditionChosen:true,acquisitionCost:1.25,location:'Box A',copyUids:[item.scanUid,crypto.randomUUID()],qty:2});
     window._bulkResults=[reviewRow];window.original={file,url:item.objectUrl,uid:item.scanUid,copies:[...reviewRow.copyUids]};
     document.getElementById('bulkScanOverlay').style.display='flex';_bulkShowSection('processing');
     document.getElementById('bulkResultsList').innerHTML='<div id="bulk-row-0" style="display:flex;gap:12px;padding:12px"></div>';
     _bulkUpdateRow(reviewRow.rowId,reviewRow);_bulkRefreshResultSummary();
    },UID);
    if(mode==='scan-account') {
     await until(()=>scanHold);await page.evaluate(()=>{_fbAuth.currentUser={uid:'another'};googleUser={uid:'another'}});scanHold();scanHold=null;
    }
    await setup;
    if(mode==='scan-account') {
     t.check(prefix+': late initial scan cannot stage another account’s choices',await page.evaluate(()=>reviewRow==='STOP'&&_bulkResults.length===0)&&calls.length===0&&await balance()===initial);
     continue;
    }
    t.check(prefix+': ambiguous top guess never becomes an identity',await page.evaluate(()=>!reviewRow.success&&!reviewRow.cardName&&reviewRow.providerNeedsReview&&_bulkDraftSelectable().length===0&&_bulkDraftUnits(reviewRow).length===0));
    t.check(prefix+': no price search for pending candidates',priceRequests===0,priceUrls.join(' | '));
    await page.evaluate(()=>bulkAddAllToCollection());
    t.check(prefix+': pending choices cannot save or close out recovery',await page.evaluate(()=>!_bulkSaved&&loadPortData().length===0&&_bulkResults[0]===reviewRow));
    t.check(prefix+': summary distinguishes review from misses',(await page.locator('#bulkSummaryLine').textContent()).includes('2 need match review'));
    if(mode==='invalid-offer') {
     t.check(prefix+': unusable receipt cannot accept guessed identity',await page.getByRole('button',{name:'Scan photo again · up to 1 credit'}).count()===1&&calls.length===0&&await balance()===initial);
     continue;
    }
    await page.getByRole('button',{name:'Review matches',exact:true}).click();
    t.check(prefix+': all nine choices accessible',await page.locator('.bulk-match-choices button').count()===9);
    t.check(prefix+': catalogue variant distinguishes similar names',/Variant 6.*Catalogue printing 6/.test(await page.locator('.bulk-match-choices button').nth(6).innerText()));
    t.check(prefix+': mobile dialog fits and targets are at least 44px',await page.locator('#bulkMatchDialog').evaluate(e=>e.scrollWidth<=e.clientWidth&&e.getBoundingClientRect().width<=innerWidth&&[...e.querySelectorAll('button')].every(b=>b.getBoundingClientRect().height>=44)));
    if(mode==='retake') {
     const photo=Buffer.from(await page.evaluate(async()=>Array.from(new Uint8Array(await reviewRow.file.arrayBuffer()))));
     const chooser=page.waitForEvent('filechooser');
     await page.getByRole('button',{name:'None of these match · choose new photo'}).click();
     await(await chooser).setFiles({name:'closer.jpg',mimeType:'image/jpeg',buffer:photo});
     await page.getByRole('button',{name:'Scan new photo · 1 credit',exact:true}).waitFor();
     t.check(prefix+': replacement preview does not scan or confirm',scanCalls===1&&calls.length===0&&await balance()===initial&&await page.evaluate(()=>reviewRow.file===original.file));
     await page.getByRole('button',{name:'Scan new photo · 1 credit',exact:true}).click();
     await page.waitForFunction(()=>_bulkResults[0]!==reviewRow&&!_bulkProcessing);
     t.check(prefix+': explicit new scan keeps physical identity and seller metadata',scanCalls===2&&calls.length===0&&await page.evaluate(()=>{
      const r=_bulkResults[0];return !r.success&&r.providerNeedsReview&&r.file.name==='closer.jpg'&&r.scanUid===original.uid&&JSON.stringify(r.copyUids)===JSON.stringify(original.copies)&&r.qty===2&&r.location==='Box A'&&r.acquisitionCost===1.25&&r.condition==='LP'&&r.conditionChosen;
     }));
     t.check(prefix+': new ambiguous scan remains zero net debit until confirmed',await balance()===initial);
     continue;
    }
    if(mode==='cancel') {
     await page.keyboard.press('Escape');
     t.check(prefix+': cancel has zero acceptance, debit or inventory',calls.length===0&&await balance()===initial&&await page.evaluate(()=>!reviewRow.success&&!document.getElementById('bulkMatchDialog')&&loadPortData().length===0));
     continue;
    }
    await page.locator('.bulk-match-choices button').nth(6).click();
    t.check(prefix+': choosing alone is still unaccepted',calls.length===0&&await page.evaluate(()=>!reviewRow.success));
    if(mode==='success')await page.screenshot({path:shots+'/'+billing+'-choose.png'});
    if(mode==='expired') {
     const key=billing==='membership'?membershipReceiptKey(offered.confirmation_id):'id_billing:'+offered.confirmation_id;
     const rec=JSON.parse(h.store.get(key));rec.expires=1;h.store.set(key,JSON.stringify(rec));
    }
    if(mode==='no-credits') {
     h.store.set(PAID_KEY,0);
     if(billing==='legacy'){h.store.set(freeKey(),30);h.store.set(PAID_KEY,0)}
     else {
      // Spend the available fixture allowance through the real authoritative
      // consumer before this pending receipt is accepted.
      for(let i=0;i<initial;i++)await consume('debit',{owner:UID,receipt:(i+1).toString(16).padStart(64,'0'),scan:'spent-'+i,mode:'identify',cost:1});
     }
    }
    if(mode==='token-account'||mode==='token-timeout') {
     if(mode==='token-timeout')await page.clock.install();
     await page.evaluate(()=>{_fbAuth.currentUser.getIdToken=()=>new Promise(r=>window.releaseToken=r)});
     await page.getByRole('button',{name:'Confirm this match',exact:true}).click();
     await page.waitForFunction(()=>window.releaseToken);
     if(mode==='token-timeout') {
      await page.clock.runFor(15001);
      await page.getByRole('button',{name:'Retry same confirmation',exact:true}).waitFor();
      await page.evaluate(()=>releaseToken('x'.repeat(40)));
      t.check(prefix+': late token after deadline cannot send a confirmation',calls.length===0&&await balance()===initial&&await page.evaluate(()=>!reviewRow.success));
      continue;
     }
     await page.evaluate(()=>{_fbAuth.currentUser={uid:'another'};googleUser={uid:'another'};releaseToken('x'.repeat(40))});
     await page.waitForFunction(()=>!document.getElementById('bulkMatchDialog'));
     t.check(prefix+': changing owner during token refresh sends no request',calls.length===0&&await balance()===initial&&await page.evaluate(()=>!reviewRow.success));
     continue;
    }
    const confirm=page.getByRole('button',{name:'Confirm this match',exact:true});
    const priceResponse=['wrong-price','late-price'].includes(mode)
      ?page.waitForResponse(r=>new URL(r.url()).hostname==='api.pokemontcg.io'):null;
    await confirm.click();await page.evaluate(()=>document.querySelector('#bulkMatchDialog button:disabled')?.click());
    await until(()=>hold);
    t.check(prefix+': double tap sends exactly one immutable seventh choice',calls.length===1&&calls[0].body.candidate.set_name==='set6'&&calls[0].body.confirmation_id===offered.confirmation_id);
    t.check(prefix+': pending acknowledgement cannot save/draft/rescan/remove',await page.evaluate(()=>{
     bulkAddAllToCollection();bulkRemoveResult(reviewRow.rowId);bulkRetryRow(reviewRow.rowId);bulkChooseNewPhoto(reviewRow.rowId);
     return !reviewRow.success&&!_bulkSaved&&_bulkResults[0]===reviewRow&&_bulkDraftSelectable().length===0&&!document.querySelector('.bulk-new-photo-input');
    })&&scanCalls===1);
    if(['account','batch'].includes(mode))await page.evaluate(kind=>{
     if(kind==='account'){_fbAuth.currentUser={uid:'another'};googleUser={uid:'another'}}else _bulkQueue=[];
    },mode);
    hold();hold=null;
    if(['account','batch'].includes(mode)) {
     await page.waitForFunction(()=>!document.getElementById('bulkMatchDialog'));
     t.check(prefix+': late response never updates a new owner/batch',await page.evaluate(()=>!reviewRow.success&&!reviewRow.cardName&&loadPortData().length===0));
     if(mode==='account')t.check(prefix+': another account can start its own clean batch',await page.evaluate(()=>{openBulkScan();return _bulkResults.length===0}));
     continue;
    }
    if(['lost-after-commit','lost-auth','malformed'].includes(mode)) {
     await page.getByRole('button',{name:'Retry same confirmation',exact:true}).waitFor();
     t.check(prefix+': committed response failure retains unaccepted UI',await balance()===initial-1&&await page.evaluate(()=>!reviewRow.success));
     t.check(prefix+': uncertain outcome cannot select a different candidate',await page.getByRole('button',{name:'Back to matches',exact:true}).count()===0);
     await page.keyboard.press('Escape');await page.evaluate(()=>closeBulkScan());
     t.check(prefix+': closing sheet retains recovery and batch cannot be discarded',await page.evaluate(()=>_bulkResults[0]===reviewRow&&document.getElementById('bulkScanOverlay').style.display!=='none'));
     await page.getByRole('button',{name:'Check confirmation',exact:true}).click();
     await page.getByRole('button',{name:'Retry same confirmation',exact:true}).click();await until(()=>hold);hold();hold=null;
     t.check(prefix+': retry body is byte-for-byte identical',calls[0].raw===calls[1].raw);
     if(mode==='lost-auth') {
      await page.getByRole('button',{name:'Retry same confirmation',exact:true}).waitFor();
      t.check(prefix+': login failure retains original uncertain choice',await page.getByRole('button',{name:'Back to matches',exact:true}).count()===0);
      await page.getByRole('button',{name:'Retry same confirmation',exact:true}).click();await until(()=>hold);hold();hold=null;
      t.check(prefix+': renewed session replays identical receipt',calls[0].raw===calls[2].raw);
     }
    }
    if(['expired','no-credits'].includes(mode)) {
     if(mode==='expired')await page.getByRole('button',{name:'Scan photo again · up to 1 credit'}).waitFor();
     else await page.getByRole('button',{name:'Retry same confirmation'}).waitFor();
     t.check(prefix+': rejected receipt never promotes identity',await page.evaluate(()=>!reviewRow.success&&!reviewRow.cardName&&_bulkDraftSelectable().length===0));
     if(mode==='expired')t.check(prefix+': expired offer has zero debit',await balance()===initial);
     continue;
    }
    await page.waitForFunction(()=>reviewRow.success===true);
    if(mode==='late-price') {
     await until(()=>priceHold);await page.evaluate(()=>{reviewRow.marketPrice=12;reviewRow.priceSource='seller'});
     priceHold();priceHold=null;
    }
    if(mode!=='wrong-price')await page.waitForFunction(()=>reviewRow.marketPrice!=null);
    else await until(()=>priceRequests>0);
    if(priceResponse) {
     await (await priceResponse).finished();
     // Let the shipped fetch/json continuation run before asserting that a
     // late price was rejected; observing its request alone is insufficient.
     await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    }
    const row=await page.evaluate(()=>({name:reviewRow.cardName,set:reviewRow.setName,number:reviewRow.cardNumber,type:reviewRow.cardType,
     photo:reviewRow.file===original.file&&reviewRow.objectUrl===original.url,uid:reviewRow.scanUid===original.uid,
     copies:JSON.stringify(reviewRow.copyUids)===JSON.stringify(original.copies),condition:reviewRow.condition,chosen:reviewRow.conditionChosen,
     cost:reviewRow.acquisitionCost,location:reviewRow.location,price:reviewRow.marketPrice,
     draft:_bulkScanRowToCard(reviewRow),units:_bulkDraftUnits(reviewRow).length,selectable:_bulkDraftSelectable().length,
     finish:reviewRow.finishConfirmed,confirmed:reviewRow.providerConfirmed}));
    t.check(prefix+': only server-confirmed seventh printing accepted',row.set==='set6'&&row.number==='58'&&row.confirmed===true);
    t.check(prefix+': physical copies, photo, condition and cost preserved',row.photo&&row.uid&&row.copies&&row.condition==='LP'&&row.chosen&&row.cost===1.25&&row.location==='Box A');
    t.check(prefix+': one debit despite retry and two physical copies',await balance()===initial-1&&h.store.get(PAID_KEY)==='4');
    t.check(prefix+': exact accepted identity reaches draft mapper',row.draft.card===row.name&&row.draft.set==='set6'&&row.draft.number==='58'&&row.units===2&&row.selectable===1);
    t.check(prefix+': confirmation never invents inspected finish',row.finish===false);
    t.check(prefix+': price follows exact printing or stays unknown',row.price===(mode==='wrong-price'?null:mode==='late-price'?12:7));
    t.check(prefix+': confirmation alone does not create inventory or drafts',writes.length===0&&await page.evaluate(()=>loadPortData().length===0),writes.join(','));
    if(mode==='success'||mode==='magic') {
     if(mode==='success') {
      const failedSave=await page.evaluate(()=>{
       const setItem=Storage.prototype.setItem,key=getUserKey('portfolio');
       Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('Synthetic quota failure','QuotaExceededError');return setItem.call(this,k,v)};
       try {bulkAddAllToCollection();return {saved:_bulkSaved,count:loadPortData().length,row:_bulkResults[0]===reviewRow,photo:reviewRow.file===original.file,bar:document.getElementById('bulkBottomBar').textContent}}finally{Storage.prototype.setItem=setItem;window._cancelUserDataSync?.()}
      });
      t.check(prefix+': failed storage leaves batch and photo recoverable',!failedSave.saved&&failedSave.count===0&&failedSave.row&&failedSave.photo&&!failedSave.bar.includes('added to your Collection'));
     }
     const saved=await page.evaluate(()=>{_bulkStartPackCost=2.5;bulkAddAllToCollection();return loadPortData().map(r=>({id:r.id,card:r.card,set:r.set,number:r.number,buyPrice:r.buyPrice,condition:r.condition}))});
     t.check(prefix+': explicit save creates two distinct exact copies with cost basis',saved.length===2&&saved[0].id!==saved[1].id&&saved.every(r=>r.set==='set6'&&r.number==='58'&&r.buyPrice===1.25&&r.condition==='LP'));
     await page.screenshot({path:shots+'/'+billing+'-'+mode+'-accepted.png'});
    }
    t.check(prefix+': no browser exceptions',errors.length===0,errors.join('\n'));
    t.check(prefix+': no provider/account network calls',h.outbound.length===0);
   } finally {
    if(hold)hold();if(priceHold)priceHold();if(scanHold)scanHold();await ctx.close();delete process.env.MEMBERSHIP_BILLING_V2;h.restore();
   }
  }
 }
} finally {await browser.close()}
t.done();
