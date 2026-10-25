// Full shipped app: selections, prices, recommendations and outbound research.
// Local fixtures only. No scans, seller records or marketplace mutations.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import {ROOT} from './_assetRefs.mjs';
const server=createServer((req,res)=>{
 const path=resolve(ROOT,'.'+new URL(req.url,'http://local').pathname);
 if(!path.startsWith(ROOT+'/')||!existsSync(path)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(path)]||'application/octet-stream');res.end(readFileSync(path));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
let passed=0;const failures=[];
const check=(ok,message)=>{if(ok)passed++;else failures.push(message);};
try {
 for(const width of [390,1280]) {
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>!r.request().url().startsWith(origin)||r.request().url().includes('/api/')?r.fulfill({status:204,body:''}):r.continue());
  await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
  await page.goto(origin+'/index.html');await page.waitForFunction(()=>typeof loadCardUI==='function');
  await page.evaluate(()=>{
   const card={id:'workflow-fixture',name:'Mew',number:'76/214',game:'pokemon',setName:'Unbroken Bonds',source:'TCGPlayer',priceVariants:[{key:'holofoil',label:'Holofoil',market:10},{key:'reverseHolofoil',label:'Reverse Holofoil',market:20},{key:'psa_10',label:'PSA 10',market:200}]};
   activeGame='pokemon';setSelectedCard(card);loadCardUI(card);window._venuesEnabled=new Set(['ebay','tcgplayer']);calc();
  });
  await page.waitForTimeout(500);
  await page.evaluate(()=>{window._crBasis=_crBindBasis({value:10,label:'Fixture market'});window._ovAutoFilled=true;priceOverride.value='10';updatePriceFromPrinting();});
  await page.locator('#printingSelect').selectOption('reverseHolofoil');
  check(await page.evaluate(()=>getEffectivePrice())===20,'printing selection replaces prior automatic basis at '+width);
  check((await page.locator('#priceMain').textContent()).includes('20.00'),'headline follows selected printing at '+width);
  await page.locator('#condPills [data-cond="mp"]').click();
  check(await page.evaluate(()=>getEffectivePrice())===13,'condition applies once to the selected printing at '+width);
  let link=new URL(await page.locator('#ebayListBtn').getAttribute('href'));
  check(/reverse/i.test(link.searchParams.get('_nkw'))&&/MP|moderately played/i.test(link.searchParams.get('_nkw')),'research link follows finish and condition at '+width);
  check(link.searchParams.get('_sop')==='13','research starts with recently ended sales at '+width);
  await page.locator('#gradedPills [data-val="psa"]').click();
  await page.waitForFunction(()=>isGradedVariant());
  link=new URL(await page.locator('#ebayListBtn').getAttribute('href'));
  check(/PSA 10/i.test(link.searchParams.get('_nkw'))&&!/moderately played|\bMP\b/i.test(link.searchParams.get('_nkw')),'graded research uses the selected grader and grade at '+width);
  check(/Mew/.test(link.searchParams.get('_nkw'))&&/76\/214/.test(link.searchParams.get('_nkw'))&&/reverse/i.test(link.searchParams.get('_nkw')),'graded research retains the exact card number and printing at '+width);
  for(const id of ['gradedCompsLink','gradedSellLink'])check(await page.locator('#'+id).getAttribute('href')===link.href,id+' matches the current research selection at '+width);
  await page.locator('#gradedPills [data-val="no"]').click();
  check(await page.locator('#printingSelect').inputValue()==='reverseHolofoil','Raw → Graded → Raw preserves finish at '+width);
  check(await page.evaluate(()=>getEffectivePrice())===13,'returning raw restores matching condition-adjusted value at '+width);
  await page.locator('#priceOverride').fill('17.25');await page.locator('#priceOverride').dispatchEvent('input');
  await page.locator('#condPills [data-cond="lp"]').click();
  check(await page.evaluate(()=>getEffectivePrice())===17.25,'hand-entered asking price is not condition-discounted at '+width);
  const summary=page.locator('[data-comparison-selection]');
  check(await summary.count()===1,'one visible comparison context at '+width);
  if(await summary.count())check((await summary.innerText()).includes('Reverse Holofoil')&&(await summary.innerText()).includes('17.25'),'comparison context reflects actual selections and price at '+width);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page overflow at '+width);
  // No payout recommendation is valid with negative costs or expired fee data.
  await page.locator('#shipCost').fill('-5');await page.locator('#shipCost').dispatchEvent('input');
  check((await page.locator('#resultsArea').innerText()).includes('must be zero or greater'),'negative costs block misleading payouts at '+width);
  check(await page.locator('#resultsArea .winner').count()===0,'invalid costs retract the recommendation at '+width);
  await page.locator('#shipCost').fill('0');await page.locator('#shipCost').dispatchEvent('input');
  await page.evaluate(()=>{window.fixtureFeeDates=Object.fromEntries(Object.entries(PLATFORMS).map(([k,p])=>[k,p.feeAuditedOn]));Object.values(PLATFORMS).forEach(p=>p.feeAuditedOn='2000-01-01');calc()});
  check(await page.locator('#resultsArea .winner').count()===0,'expired fee data cannot win a recommendation at '+width);
  await page.evaluate(()=>{Object.entries(fixtureFeeDates).forEach(([k,v])=>PLATFORMS[k].feeAuditedOn=v);calc()});
  // A delayed response for an earlier printing must not overwrite a newer choice.
  const race = await page.evaluate(async()=>{
    setPill(document.querySelector('#condPills [data-cond="nm"]'),'condPills');
    priceOverride.value='';window._ovAutoFilled=false;
    const saved=window.fetch, pending=[];
    window.fetch=()=>new Promise(r=>pending.push(r));
    const done=fetchAndApplySoldComps(true);
    printSelect.value='holofoil';_onPrintingChange();
    for(const resolve of pending)resolve({ok:true,json:async()=>({market:999,median:999,source:'pricecharting',count:12,prices:{raw:999}})});
    await done;window.fetch=saved;
    return {price:getEffectivePrice(),basis:window._crBasis};
  });
  check(race.price===10&&!race.basis,'late results cannot replace a newer printing at '+width);
  await page.locator('#priceOverride').fill('-1');await page.locator('#priceOverride').dispatchEvent('input');
  check((await page.locator('#resultsArea').innerText()).includes('greater than $0'),'invalid manual sale price retracts estimates at '+width);
  const manualAfterRefresh=await page.evaluate(async()=>{
    currentPrices[printSelect.value].market=null;priceOverride.value='17.25';window._ovAutoFilled=false;
    const saved=window.fetch;window.fetch=async()=>({ok:true,json:async()=>({market:999,median:999,source:'pricecharting',count:10})});
    await fetchAndApplySoldComps(true);window.fetch=saved;return getEffectivePrice();
  });
  check(manualAfterRefresh===17.25,'refresh cannot overwrite a hand-entered price at '+width);
  // TPL publishes condition-specific rows and an aggregate, not individual comps.
  const conditionResult = await page.evaluate(()=>{
    const card=tplCardToNormalized({id:'condition-fixture',name:'Mew',number:'76/214',set_name:'Unbroken Bonds',prices:{raw:{near_mint:{tcgplayer:{market:100},ebay:{avg_7d:98}},lightly_played:{tcgplayer:{market:81},ebay:{avg_7d:80}}}}},'pokemon');
    setSelectedCard(card);loadCardUI(card);
    setPill(document.querySelector('#condPills [data-cond="lp"]'),'condPills');updatePriceFromPrinting();calc();
    return {price:getEffectivePrice(),key:printSelect.value,context:document.querySelector('[data-comparison-selection]').textContent};
  });
  check(conditionResult.price===81&&conditionResult.key==='lightly_played','a condition-specific quote is not discounted twice at '+width);
  check(/7-day sold average: \$80.00/.test(conditionResult.context)&&/Sale count, individual sale dates/.test(conditionResult.context),'vendor average states its period and evidence limits at '+width);
  check(errors.length===0,'no browser errors at '+width+': '+errors.join('; '));
  mkdirSync('/tmp/cardresell-selling-selection',{recursive:true});await page.locator('#resultsArea').screenshot({path:'/tmp/cardresell-selling-selection/selection-'+width+'.png'});
  await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
for(const f of failures)console.error('FAIL:',f);
console.log(`selling-selection-browser: ${passed} passed, ${failures.length} failed -- SUITE COMPLETE, exit=${failures.length?1:0}`);
assert.equal(failures.length,0,'selection workflow regressions');
