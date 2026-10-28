// Exercise the real input event, ranking, buy target, grading panel and draft
// fee renderer. Synthetic browser-only data; no accounts, scans or payments.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {join,extname,resolve} from 'node:path';
import {chromium} from 'playwright';
import {ROOT} from './_assetRefs.mjs';
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const server=createServer((req,res)=>{const f=resolve(ROOT,'.'+new URL(req.url,'http://x').pathname);if(!f.startsWith(ROOT+'/')||!existsSync(f)){res.statusCode=404;return res.end();}res.setHeader('content-type',types[extname(f)]||'application/octet-stream');res.end(readFileSync(f));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
try{for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>!r.request().url().startsWith(origin)||r.request().url().includes('/api/')?r.fulfill({status:204,body:''}):r.continue());
  await page.addInitScript(()=>{localStorage.setItem('cs_landing_seen','1');Date.now=()=>Date.parse('2026-10-14T12:00:00Z');});
  await page.goto(origin+'/index.html');
  await page.waitForFunction(()=>window.CardResellGradingPaths&&typeof window.calc==='function');
  await page.evaluate(()=>{
    selectedCard={name:'Pikachu',game:'pokemon'};activeGame='pokemon';
    window.getEffectivePrice=()=>100;window._isPro=false;window._venuesEnabled=new Set(['ebay']);
    document.getElementById('shipCharge').value='5';document.getElementById('shipCost').value='4';calc();
    if(!document.getElementById('advBody').classList.contains('open'))toggleAdv();
    const el=document.createElement('section');el.id='tax-grade-fixture';document.body.append(el);
    renderGradingUpside(el,{source:'pricecharting',prices:{raw:100,psa_10:300}},9,9,{analysis_id:'tax-fixture',card_name:'Example card'});
  });

  const input=page.getByRole('combobox',{name:'eBay buyer-tax assumption'});
  const ebay=page.locator('.plat-card').filter({has:page.locator('.plat-name').filter({hasText:'eBay'})}).first();
  const payout=()=>ebay.locator('.plat-payout').innerText();
  const buy=()=>page.locator('#maxBuyAmount').innerText();
  const grade=()=>page.locator('#tax-grade-fixture [data-grade="psa_10"] .gp-result').innerText();
  ok(await input.inputValue()==='','tax defaults to unknown');
  ok(await payout()==='$86.69','default fee estimate unchanged with shipping');
  ok(await buy()==='$61.68','default buy target uses real eBay net');
  ok((await grade()).includes('$199.86'),'modern grading panel starts from shared default fee');
  await input.selectOption('8');
  ok(await payout()==='$85.57','input event includes fees on $8.40 assumed tax');
  ok(await buy()==='$60.57','buy target follows changed net');
  ok((await grade()).includes('$196.68'),'tax input re-renders existing modern grading panel');
  ok((await page.locator('[data-selling-fee-assumption]').innerText()).includes('8% buyer tax'),'grading panel names the current assumption');
  const taxRow=ebay.locator('[data-tax-state="assumed"]');
  ok((await taxRow.textContent()).includes('$8.40')&&(await taxRow.textContent()).includes('8% assumption'),'ranking names amount and assumption');
  ok((await ebay.innerText()).includes('item + shipping + assumed tax')||(await ebay.textContent()).includes('item + shipping + assumed tax'),'ranking fee-base label includes tax');
  const draft=await page.evaluate(()=>{
    _reviewState.draft={price:100,slot:'ebay:fixed-price'};
    const el=document.createElement('section');el.id='tax-draft-fixture';el.innerHTML=_reviewFeesHtml();document.body.append(el);
    return {net:_reviewFeeCalc().net,text:el.textContent};
  });
  ok(Math.abs(draft.net-85.29)<1e-9,'draft uses same assumed rate and its disclosed item-only shipping scope');
  ok(draft.text.includes('8% assumption')&&draft.text.includes('$108.00')&&draft.text.includes('Tax is not seller income'),'rendered draft separates tax from revenue');
  const downloadWait=page.waitForEvent('download');
  await page.locator('#tax-grade-fixture [data-export]').click();
  const download=await downloadWait;
  const csv=readFileSync(await download.path(),'utf8');
  ok(csv.includes('8% buyer tax')&&csv.includes('Current-visit assumption'),'grading CSV retains the fee assumption');
  await input.selectOption('0');
  ok(await payout()==='$86.69','explicit 0% restores default amount');
  ok((await taxRow.textContent()).includes('$0.00')&&(await taxRow.textContent()).includes('0% assumption'),'explicit zero remains distinct from unknown');
  await input.selectOption('');
  ok((await ebay.locator('[data-tax-state="included"]').textContent()).includes('not estimated'),'clearing restores unknown disclosure');
  await input.selectOption('8');
  await page.evaluate(()=>{
    window._venuesEnabled=new Set(['ebay','tcgplayer']);calc();
  });
  const tcg=page.locator('.plat-card').filter({has:page.locator('.plat-name').filter({hasText:'TCGplayer'})}).first();
  ok(await tcg.locator('.plat-payout').innerText()==='$86.79','eBay tax assumption does not change TCGplayer');
  await page.evaluate(()=>{
    window._venuesEnabled=new Set(['ebay']);
    CardResellSellingPlan.openCollection([{card:'Tax example A',game:'pokemon',currentValue:100},{card:'Tax example B',game:'pokemon',currentValue:10}]);
  });
  const sellingPlan=page.locator('#sellingPlan');

  ok((await sellingPlan.textContent()).includes('8% buyer tax'),'bulk comparison discloses current tax assumption');
  ok((await sellingPlan.locator('table').nth(0).getByRole('row').filter({hasText:'eBay'}).innerText()).includes('$93.86'),'lot uses tax-inclusive eBay fees');
  ok((await sellingPlan.locator('table').nth(1).getByRole('row').filter({hasText:'eBay'}).innerText()).includes('$93.46'),'singles each include tax and their own order fee');
  await page.keyboard.press('Escape');await sellingPlan.waitFor({state:'detached'});
  for(const theme of ['light','dark']){
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    ok(await input.evaluate(el=>{const r=el.getBoundingClientRect();return r.width>40&&r.left>=0&&r.right<=innerWidth+1;}),'control fits '+width+' '+theme);
    if(process.env.CR_SHOT_DIR){mkdirSync(process.env.CR_SHOT_DIR,{recursive:true});await input.locator('..').screenshot({path:join(process.env.CR_SHOT_DIR,`buyer-tax-${width}-${theme}.png`)});}
  }
  await page.evaluate(()=>saveSellerProfile());
  ok(!JSON.parse(await page.evaluate(()=>localStorage.getItem('cr_seller_profile_v1'))).ebayBuyerTaxRate,'assumption is not saved in seller profile');
  await page.reload();await page.waitForFunction(()=>typeof window._crSellerProfile==='function');
  ok(await page.locator('#ebayBuyerTaxRate').inputValue()===''&&await page.evaluate(()=>_crSellerProfile().ebayBuyerTaxRate===null),'reload starts without an assumed buyer rate');
  ok(errors.length===0,errors.join('\n'));await page.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));}
console.log(`eBay buyer-tax browser: ${checks} passed -- SUITE COMPLETE, exit=0`);
