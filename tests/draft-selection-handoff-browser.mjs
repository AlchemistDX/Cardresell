// Shipped browser -> real draft handler -> stored draft -> review, all local.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import {ROOT} from './_assetRefs.mjs';
import {reset,EP,fakeReq,fakeRes} from './_draftHarness.mjs';

const server=createServer((req,res)=>{
  const path=resolve(ROOT,'.'+new URL(req.url,'http://local').pathname);
  if(!path.startsWith(ROOT+'/')||!existsSync(path)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(path)]||'application/octet-stream');res.end(readFileSync(path));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
let passed=0;const failures=[];
const check=(ok,message)=>{if(ok)passed++;else failures.push(message);};
try {
 for(const width of [390,1280]) {
  reset();
  const page=await browser.newPage({viewport:{width,height:1000}}),posts=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===origin&&url.pathname==='/api/drafts'){
      const method=req.method(),body=method==='GET'?undefined:req.postDataJSON();
      if(method==='POST')posts.push(body);
      const result=fakeRes();
      await EP.default(fakeReq({method,body,query:Object.fromEntries(url.searchParams),headers:{authorization:'Bearer '+'x'.repeat(40),'idempotency-key':req.headers()['idempotency-key']}}),result);
      return route.fulfill({status:result.statusCode,json:result.body});
    }
    if(url.origin===origin&&url.pathname==='/api/sell-eligibility')return route.fulfill({json:{stamps:[{eligible:true}]}});
    if(url.origin!==origin||url.pathname.startsWith('/api/'))return route.fulfill({status:204,body:''});
    return route.continue();
  });
  await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
  await page.goto(origin+'/index.html');await page.waitForFunction(()=>typeof loadCardUI==='function');await page.waitForTimeout(500);
  await page.evaluate(()=>{
    window.googleUser={uid:'1029384756',getIdToken:async()=> 'x'.repeat(40)};window._googleIdToken='x'.repeat(40);
    window._venuesEnabled=new Set(['ebay','tcgplayer']);
    window.handoffBase={id:'handoff',name:'Mew',setName:'Unbroken Bonds',setCode:'sm10',number:'76/214',game:'pokemon',source:'TCGPlayer',priceVariants:[{key:'holofoil',label:'Holofoil',market:10},{key:'reverseHolofoil',label:'Reverse Holofoil',market:20},{key:'psa_10',label:'PSA 10',market:200},{key:'psa_9',label:'PSA 9',market:100}]};
    window.loadHandoffCard=extra=>{switchView('lookup');const card={...handoffBase,...extra};setSelectedCard(card);loadCardUI(card);calc();};
    loadHandoffCard({});
  });
  const create=async()=>{
    await page.waitForFunction(()=>!!window._crSellApproved);
    await page.locator('#crSellBtn').click();
    await page.waitForFunction(()=>!!_reviewState.draft&&!_reviewState.loading&&!document.getElementById('crSellBtn').disabled);
    return page.evaluate(()=>({draft:_reviewState.draft,packet:_reviewState.packet,body:document.getElementById('review-card-step')?.textContent||''}));
  };
  await page.locator('#printingSelect').selectOption('reverseHolofoil');
  await page.locator('#condPills [data-cond="mp"]').click();
  await page.locator('#shipCharge').fill('4');await page.locator('#shipCost').fill('2.50');
  const raw=await create();
  check(raw.draft.price===13,'raw selected price reaches real storage at '+width);
  check(raw.draft.card.finish==='Reverse Holofoil','selected finish reaches real storage at '+width);
  check(/Reverse Holofoil/.test(raw.draft.title),'selected finish reaches generated listing title at '+width);
  check(raw.draft.card.pricingSelection?.condition==='mp','pricing condition is recorded separately at '+width);
  check(!raw.draft.card.condition,'pricing assumption does not invent physical condition at '+width);
  check(/Reverse Holofoil/.test(raw.body)&&/Moderately Played/.test(raw.body),'review displays saved printing and comparison condition at '+width);
  check(/pricing assumption/.test(raw.body),'review explains the condition still needs physical confirmation at '+width);
  check(raw.packet?.shipping?.buyerPays?.amount===4&&raw.packet?.shipping?.sellerCost?.amount===2.5,'shipping survives draft handoff at '+width);

  await page.evaluate(()=>loadHandoffCard(tplCardToNormalized({id:'catalog-reverse',name:'Mew',number:'76/214',set_name:'Unbroken Bonds',variant:'Reverse Holofoil',prices:{raw:{near_mint:{tcgplayer:{market:21}},lightly_played:{tcgplayer:{market:16}}}}},'pokemon')));
  await page.locator('#condPills [data-cond="lp"]').click();
  const catalogue=await create();
  check(catalogue.draft.card.finish==='Reverse Holofoil'&&/Reverse Holofoil/.test(catalogue.draft.title),'condition-based catalogue row keeps exact printing in the stored draft at '+width);
  check(catalogue.draft.price===16&&catalogue.draft.card.pricingSelection?.condition==='lp','catalogue condition and price reach review together at '+width);

  await page.evaluate(()=>loadHandoffCard({id:'slab',grader:'PSA',grade:'10',cert:'12345678'}));
  await page.locator('#printingSelect').selectOption('reverseHolofoil');
  await page.locator('#gradedPills [data-val="psa"]').click();
  await page.locator('#gradeSelect').selectOption('9');
  await page.locator('#shipCharge').fill('6');await page.locator('#shipCost').fill('3');
  await page.evaluate(()=>{window._crBasis=_crBindBasis({value:100,label:'PSA 9 quote',cacheAgeSec:60},selectedCard);});
  const slab=await create();
  check(slab.draft.card.grader==='PSA'&&String(slab.draft.card.grade)==='9','selected grader and grade reach real storage at '+width);
  check(slab.draft.price===100&&/PSA 9/.test(slab.draft.title),'grade and price agree in the saved draft at '+width);
  check(!slab.draft.card.cert&&!slab.draft.card.certNumber&&!slab.draft.card.cert_number,'a changed grade cannot reuse the old certificate at '+width);
  check(slab.packet?.priceBasis?.label==='PSA 9 quote','selected quote metadata survives grade snapshot at '+width);
  check(/PSA 9/.test(slab.body)&&/Reverse Holofoil/.test(slab.body),'review displays saved slab choice and printing at '+width);
  check(!slab.draft.card.pricingSelection?.condition,'raw condition does not follow a slab at '+width);
  const slabId=slab.draft.draftId;
  await page.evaluate(()=>loadHandoffCard({id:'other-card',name:'Pikachu',number:'1/214'}));
  await page.evaluate(id=>openDraftReview(id),slabId);
  await page.waitForFunction(id=>_reviewState.draft?.draftId===id&&!_reviewState.loading,slabId);
  check((await page.locator('#review-card-step').textContent()).includes('PSA 9'),'reopening uses saved choices after another card is viewed at '+width);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'review fits viewport at '+width);
  mkdirSync('/tmp/cardresell-draft-selection-shots',{recursive:true});
  if(await page.locator('[data-draft-card-selection]').count())await page.locator('[data-draft-card-selection]').screenshot({path:'/tmp/cardresell-draft-selection-shots/slab-'+width+'.png'});

  await page.evaluate(()=>loadHandoffCard({id:'same-slab',grader:'PSA',grade:'10',certNumber:'87654321'}));
  await page.locator('#gradedPills [data-val="psa"]').click();await page.locator('#gradeSelect').selectOption('10');
  const unchanged=await create();
  check(unchanged.draft.card.certNumber==='87654321','matching slab retains its certificate at '+width);
  await page.evaluate(()=>loadHandoffCard({id:'pristine',grader:'CGC',grade:'10p',cert:'11223344'}));
  await page.locator('#gradedPills [data-val="cgc"]').click();await page.locator('#gradeSelect').selectOption('10p');
  const pristine=await create();
  check(pristine.draft.card.grade==='10p'&&pristine.draft.card.cert==='11223344','matching nonnumeric grade retains its grade and certificate at '+width);
  await page.evaluate(()=>loadHandoffCard({id:'now-raw',grader:'PSA',grade:'10',cert:'12345678'}));
  const nowRaw=await create();
  check(nowRaw.draft.draftId!==unchanged.draft.draftId,'a separately loaded copy does not collapse into the previous draft at '+width);
  check(!nowRaw.draft.card.grader&&!nowRaw.draft.card.grade&&!nowRaw.draft.card.cert,'Raw selection removes slab details at '+width);
  check(!/PSA/.test(nowRaw.draft.title),'raw listing title cannot retain a slab claim at '+width);

  // No quote: neither cached raw value nor the previous grade may be reused.
  await page.evaluate(()=>{window.tplApiKey='';loadHandoffCard({id:'unpriced'});});
  await page.locator('#gradedPills [data-val="psa"]').click();await page.locator('#gradeSelect').selectOption('8');
  check(await page.evaluate(()=>getEffectivePrice())===0,'unavailable grade is unpriced at '+width);
  check((await page.locator('#gradedCompsNote').textContent()).includes('No matching'),'missing-grade state offers a useful next step at '+width);
  const unpriced=await create();
  check(unpriced.draft.price==null&&String(unpriced.draft.card.grade)==='8','unknown graded price stays unset in stored draft at '+width);
  await page.evaluate(()=>{window.tplApiKey='';loadHandoffCard({id:'magic',name:'Elite Interceptor',number:'9',setCode:'stx',setName:'Strixhaven',game:'mtg'});});
  await page.locator('#gradedPills [data-val="psa"]').click();await page.locator('#gradeSelect').selectOption('8');
  const magicLink=new URL(await page.locator('#gradedCompsLink').getAttribute('href'));
  check(/Elite Interceptor/.test(magicLink.searchParams.get('_nkw'))&&/Strixhaven/.test(magicLink.searchParams.get('_nkw'))&&/PSA 8/.test(magicLink.searchParams.get('_nkw'))&&!/pokemon/i.test(magicLink.searchParams.get('_nkw'))&&magicLink.searchParams.get('_sop')==='13','graded research uses Magic selection and recent-first sorting at '+width);

  // A delayed lookup must retract the old price immediately and must not
  // contaminate a different card selected before it returns.
  await page.evaluate(()=>{
    loadHandoffCard({id:'pending-grade',tplId:'local-card',tplGameSlug:'pokemon'});
    window.tplApiKey='local-provider-fixture';
    window.savedFetchGrade=fetchTPLCardById;
    fetchTPLCardById=()=>new Promise(r=>window.releaseGrade=r);
  });
  await page.locator('#gradedPills [data-val="psa"]').click();await page.locator('#gradeSelect').selectOption('8');
  await page.waitForFunction(()=>typeof window.releaseGrade==='function');
  check(await page.evaluate(()=>getEffectivePrice())===0,'pending grade lookup retracts previous quote immediately at '+width);
  const pending=await create();
  check(pending.draft.price==null&&String(pending.draft.card.grade)==='8','draft started during lookup has the correct grade and no guessed price at '+width);
  const race=await page.evaluate(async()=>{
    window.tplApiKey='';loadHandoffCard({id:'replacement',name:'Different card',number:'2/214'});
    const before={name:selectedCard.name,key:printSelect.value,price:getEffectivePrice()};
    releaseGrade({priceVariants:[{key:'psa_8',label:'PSA 8',market:999}]});
    await new Promise(r=>setTimeout(r,0));fetchTPLCardById=savedFetchGrade;
    return {before,after:{name:selectedCard.name,key:printSelect.value,price:getEffectivePrice()},foreignQuote:!!currentPrices.psa_8};
  });
  check(!race.foreignQuote&&race.before.price>0&&JSON.stringify(race.after)===JSON.stringify(race.before),'late grade data cannot overwrite another card at '+width+': '+JSON.stringify(race));
  check(errors.length===0,'no browser exceptions at '+width+': '+errors.join('; '));
  await page.close();
 }
} finally {await browser.close();await new Promise(r=>server.close(r));}
for(const f of failures)console.error('FAIL:',f);
console.log(`draft-selection-handoff-browser: ${passed} passed, ${failures.length} failed -- SUITE COMPLETE, exit=${failures.length?1:0}`);
assert.equal(failures.length,0,'selection handoff regressions');
