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
 for(const width of [320,390,1280]) {
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
  let research={tcg:{},pc:{},ebay:{available:false,count:0,median:null}};
  let researchDelayMs=0;
  const researchRequests=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{
    const url=new URL(r.request().url());
    if(url.origin===origin){
      const kind={'/api/tcg-price':'tcg','/api/pricecharting':'pc','/api/ebay-sold':'ebay'}[url.pathname];
      if(kind){
        researchRequests.push({kind,url:url.href});
        const body=research[kind],delay=researchDelayMs;
        return (async()=>{if(delay)await new Promise(resolve=>setTimeout(resolve,delay));return r.fulfill({json:body});})();
      }
    }
    return url.origin!==origin||url.pathname.startsWith('/api/')?r.fulfill({status:204,body:''}):r.continue();
  });
  await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
  await page.goto(origin+'/index.html');await page.waitForFunction(()=>typeof loadCardUI==='function');
  for (const fails of [false,true]) {
    const result=await page.evaluate(async fails=>{
      const savedFetch=window.fetch;let release;
      window.fetch=url=>String(url).startsWith('/api/tcg-price?')
        ?new Promise((resolve,reject)=>{release=()=>fails?reject(Error('fixture outage')):resolve({ok:true,json:async()=>({market:999})});})
        :Promise.resolve({ok:false});
      try {
        const first={name:'Mew',setName:'Fixture set',number:'1',game:'pokemon',priceVariants:[]};
        setSelectedCard(first);loadCardUI(first);
        const next={...first,number:'2',priceVariants:[{key:'normal',label:'Normal',market:6}]};
        setSelectedCard(next);loadCardUI(next);
        release();await new Promise(resolve=>setTimeout(resolve,0));
        return {number:selectedCard.number,key:printSelect.value,price:getEffectivePrice()};
      } finally {window.fetch=savedFetch;}
    },fails);
    check(JSON.stringify(result)===JSON.stringify({number:'2',key:'normal',price:6}),'late '+(fails?'failed':'successful')+' fallback cannot change the next collector number at '+width);
  }
  await page.evaluate(()=>{
    const card={name:'Mew',setName:'Fixture set',number:'1',game:'pokemon',priceVariants:[{key:'tcgplayer_live',label:'TCGPlayer Live',market:5}]};
    setSelectedCard(card);loadCardUI(card);
  });
  check(!/TCGPlayer|Base-printing reference/i.test(new URL(await page.locator('#ebayListBtn').getAttribute('href')).searchParams.get('_nkw')),'price-source labels never enter card research queries at '+width);
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
  research={tcg:{market:12,low:1,high:999,url:'https://www.tcgplayer.com/product/123'},pc:{},ebay:{available:false,count:0,median:null}};
  await page.evaluate(()=>fetchAndApplySoldComps(true));
  const status=page.locator('#ebayCompsStatusText');
  check((await status.innerText()).includes('Base-printing reference')&&(await status.innerText()).includes('Condition and finish are not verified'),'broad quote does not claim the selected condition at '+width);
  check(!/range|\$300\.00|\$999\.00/.test(await status.innerText()),'broad or clamped high never becomes a measured endpoint at '+width);
  research={tcg:{},pc:{},ebay:{available:false,count:0,median:null}};
  researchDelayMs=500;
  await page.locator('#ebayCompsRefreshBtn').click();
  check(await page.locator('#ebayCompsRefreshBtn').isDisabled()&&await page.locator('#ebayCompsStatus').getAttribute('aria-busy')==='true','refresh indicates loading and prevents repeated clicks at '+width);
  await page.waitForFunction(()=>!document.getElementById('ebayCompsRefreshBtn').disabled&&document.getElementById('ebayCompsStatus').getAttribute('aria-busy')==='false');
  researchDelayMs=0;
  check(await status.isVisible()&&(await status.innerText()).includes('eBay sold prices unavailable'),'all-provider failure retains the availability explanation at '+width);
  let researchLink=new URL(await page.locator('[data-ebay-research]').getAttribute('href'));
  check(/Lightly Played/.test(researchLink.searchParams.get('_nkw'))&&/76\/214/.test(researchLink.searchParams.get('_nkw')),'empty-state research retains exact card and condition at '+width);
  const soldDate=new Date().toISOString().slice(0,10);
  research.ebay={available:true,count:1,median:12.34,low:12.34,high:12.34,matchReviewRequired:true,windowDays:30,shippingIncluded:false,items:[{title:'Mew 76/214 Lightly Played',price:12.34,soldDate,url:'https://www.ebay.com/itm/123',currency:'USD'}]};
  await page.evaluate(()=>fetchAndApplySoldComps(true));
  check((await status.innerText()).includes('One listing does not establish a price range')&&!/· median/.test(await status.innerText()),'one listing stays a data point without a range at '+width);
  await page.locator('[data-ebay-candidates] summary').click();
  check((await status.innerText()).includes('$12.34')&&(await status.innerText()).includes('Sold '+soldDate),'single recent listing exposes its price and actual sale date at '+width);
  check(await page.evaluate(()=>getEffectivePrice())===81,'unreviewed listing cannot replace the selected quote at '+width);
  const shots='/tmp/cardresell-research-price-context/shots';mkdirSync(shots,{recursive:true});
  for(const theme of ['light','dark']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    check(await page.locator('#ebayCompsRefreshBtn').evaluate(el=>el.getBoundingClientRect().height>=44),'refresh has a usable tap target at '+width+' '+theme);
    await page.locator('#ebayCompsStatus').screenshot({path:shots+'/single-candidate-'+width+'-'+theme+'.png'});
  }
  research.ebay={...research.ebay,median:22.56,items:[{...research.ebay.items[0],title:'Mew 76/214 Near Mint',price:22.56,url:'https://www.ebay.com/itm/456'}]};
  await page.locator('#condPills [data-cond="nm"]').click();
  check(!(await status.textContent()).includes('Mew 76/214 Lightly Played'),'condition change immediately retracts old comps at '+width);
  await page.waitForFunction(()=>document.querySelector('[data-ebay-candidates]')?.textContent.includes('Mew 76/214 Near Mint'));
  const latestQuery=new URL(researchRequests.filter(x=>x.kind==='ebay').at(-1).url).searchParams.get('q');
  check(/Near Mint/.test(latestQuery)&&!/Lightly Played/.test(latestQuery),'condition change automatically requests matching research at '+width);
  check(await page.evaluate(()=>getEffectivePrice())===100,'refreshed candidate leaves the selected condition quote intact at '+width);
  research={tcg:{market:999},pc:{source:'pricecharting',median:9999,productName:'Mew Base Printing',prices:{psa_10:9999},url:'https://www.pricecharting.com/game/pokemon/mew'},ebay:{available:false,count:0,median:null}};
  await page.evaluate(()=>{
    const card={id:'finish-fixture',name:'Mew',number:'76/214',game:'pokemon',setName:'Unbroken Bonds',source:'TCGPlayer',priceVariants:[{key:'normal',label:'Normal',market:10},{key:'reverseHolofoil',label:'Reverse Holofoil',market:null},{key:'psa_10',label:'PSA 10',market:null}]};
    setSelectedCard(card);loadCardUI(card);
  });
  await page.locator('#printingSelect').selectOption('reverseHolofoil');
  await page.evaluate(()=>fetchAndApplySoldComps(true));
  check(!/\$999|Base-printing reference|Guide value/.test(await status.innerText()),'unscoped provider quote is withheld for a specific finish at '+width);
  check(await page.evaluate(()=>getEffectivePrice())===0,'broad response cannot fill a missing finish price at '+width);
  check(await page.evaluate(()=>currentPrices.psa_10?.market==null),'broad response cannot seed that finish’s graded prices at '+width);
  await page.locator('#gradedPills [data-val="psa"]').click();
  await page.evaluate(()=>fetchAndApplySoldComps(true));
  check(await page.evaluate(()=>_crSellingSelection().finish)==='Reverse Holofoil','missing grade quote retains the raw finish at '+width);
  check(await page.evaluate(()=>getEffectivePrice())===0,'missing finish/grade cannot borrow a base-printing guide at '+width);
  researchLink=new URL(await page.locator('#gradedCompsLink').getAttribute('href'));
  check(/Reverse Holofoil/.test(researchLink.searchParams.get('_nkw'))&&/PSA/.test(researchLink.searchParams.get('_nkw')),'graded research retains the finish even without a quote at '+width);
  await page.locator('#priceOverride').fill('17.25');await page.locator('#priceOverride').dispatchEvent('input');
  await page.evaluate(()=>fetchAndApplySoldComps(true));
  check(await page.evaluate(()=>getEffectivePrice())===17.25,'manual price remains owned by the seller through scoped research refresh at '+width);
  research={tcg:{},pc:{},ebay:{available:true,count:3,median:500,confidence:'high',low:400,high:600}};
  await page.evaluate(()=>{
    const card={id:'unpriced-condition',name:'Mew',number:'76/214',game:'pokemon',setName:'Unbroken Bonds',priceVariants:[{key:'near_mint',label:'Near Mint',market:null}]};
    setSelectedCard(card);loadCardUI(card);
  });
  await page.evaluate(()=>fetchAndApplySoldComps(true));
  check(await page.evaluate(()=>getEffectivePrice())===0,'missing review metadata cannot auto-price an unpriced card at '+width);
  check((await status.innerText()).includes('Needs review'),'heuristic high confidence does not imply a matched comp at '+width);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'research panel does not overflow the page at '+width);
  check(errors.length===0,'no browser errors at '+width+': '+errors.join('; '));
  mkdirSync('/tmp/cardresell-selling-selection',{recursive:true});await page.locator('#resultsArea').screenshot({path:'/tmp/cardresell-selling-selection/selection-'+width+'.png'});
  await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
for(const f of failures)console.error('FAIL:',f);
console.log(`selling-selection-browser: ${passed} passed, ${failures.length} failed -- SUITE COMPLETE, exit=${failures.length?1:0}`);
assert.equal(failures.length,0,'selection workflow regressions');
