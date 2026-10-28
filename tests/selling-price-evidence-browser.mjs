// Full shipped selection -> asking price -> venue comparison -> draft request.
// Synthetic provider/auth boundaries only; no external sales or account writes.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import {ROOT} from './_assetRefs.mjs';

const server=createServer((req,res)=>{
  const path=resolve(ROOT,'.'+new URL(req.url,'http://local').pathname);
  if(!path.startsWith(ROOT+'/')||!existsSync(path)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(path)]||'application/octet-stream');
  res.end(readFileSync(path));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
let passed=0;const failures=[];
const check=(ok,message)=>{if(ok)passed++;else failures.push(message);};
try {
  for(const width of [320,390,1280]) {
    const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],posts=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>{
      const url=r.request().url();
      if(url.startsWith(origin+'/api/drafts')&&r.request().method()==='POST'){
        posts.push(r.request().postDataJSON());
        return r.fulfill({status:400,json:{code:'LOCAL_FIXTURE',message:'Local request recorded.'}});
      }
      if(url.startsWith(origin+'/api/sell-eligibility'))return r.fulfill({json:{stamps:[{eligible:true}]}});
      if(!url.startsWith(origin)||url.includes('/api/'))return r.fulfill({status:204,body:''});
      return r.continue();
    });
    await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
    await page.goto(origin+'/index.html');
    await page.waitForFunction(()=>typeof loadCardUI==='function');
    await page.waitForTimeout(500);
    await page.evaluate(()=>{
      window._googleIdToken='local-fixture-token';
      window.googleUser={uid:'local-evidence-fixture',getIdToken:async()=> 'local-fixture-token'};
      window._venuesEnabled=new Set(['ebay','tcgplayer']);
      const card=tplCardToNormalized({id:'range-fixture',name:'Mew',number:'76/214',set_name:'Unbroken Bonds',updated_at:new Date().toISOString(),prices:{raw:{
        near_mint:{tcgplayer:{market:100,low:90,high:130}},
        lightly_played:{tcgplayer:{market:60,low:55,high:75}},
        moderately_played:{tcgplayer:{market:40}}
      },graded:{psa:{10:{ebay:{avg_7d:300,avg_30d:500,avg_1d:200}}}}}},'pokemon');
      activeGame='pokemon';setSelectedCard(card);loadCardUI(card);calc();
    });
    await page.waitForFunction(()=>!!window._crSellApproved);
    check(await page.locator('#sellingFeeComparison .winner').isVisible(),'best payout is visible without expanding anything at '+width);
    check(await page.locator('#sellingFeeComparison').evaluate(e=>e.tagName==='SECTION'&&!e.closest('details')),'fee comparison has no dropdown gate at '+width);
    check(!await page.locator('#sellingAdvice').isVisible(),'selling questions stay out of the primary result at '+width);
    const amounts=()=>page.evaluate(()=>_qpTiers(_qpBasis()).map(t=>t.amt));
    const snapshot=async name=>{
      const dir='/tmp/cardresell-evidence-price-ranges/shots';mkdirSync(dir,{recursive:true});
      for(const theme of ['light','dark']){
        await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        check(await page.locator('#qpTiers button').evaluateAll(buttons=>buttons.every(b=>b.scrollWidth<=b.clientWidth+1&&b.getBoundingClientRect().height>=44)),name+' choices fit with usable tap targets at '+width+' '+theme);
        check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' has no page overflow at '+width+' '+theme);
        await page.locator('#quickPricing').screenshot({path:dir+'/'+name+'-'+width+'-'+theme+'.png'});
      }
    };
    check(JSON.stringify(await amounts())==='[90,100,130]','uses reported NM endpoints rather than fixed percentages at '+width);
    check(/TCGplayer asking range: \$90.00–\$130/.test(await page.locator('#priceRange').innerText()),'headline labels asking range at '+width);
    check((await page.locator('#qpGradedNote').innerText()).includes('not completed sales'),'range explains instrument at '+width);
    await page.locator('#qpTiers button').filter({hasText:'Listed high'}).click();
    check(await page.evaluate(()=>getEffectivePrice())===130,'selected upper ask updates payout input at '+width);
    await page.locator('#condPills [data-cond="lp"]').click();
    check(JSON.stringify(await amounts())==='[55,60,75]','LP uses its own range without an extra condition discount at '+width);
    check(await page.evaluate(()=>getEffectivePrice())===75,'chosen upper ask follows LP evidence at '+width);
    const summary=await page.locator('[data-comparison-selection]').textContent();
    check(summary.includes('Lightly Played')&&summary.includes('$75.00')&&summary.includes('$55.00'),'comparison shows the selected condition, asking price and evidence at '+width);
    const research=new URL(await page.locator('#ebayListBtn').getAttribute('href'));
    check(/Mew/.test(research.searchParams.get('_nkw'))&&/76\/214/.test(research.searchParams.get('_nkw'))&&/Lightly Played/i.test(research.searchParams.get('_nkw'))&&research.searchParams.get('_sop')==='13','recent eBay research retains exact selection at '+width);
    await page.locator('#crSellBtn').click();await page.waitForFunction(()=>!document.getElementById('crSellBtn').disabled);
    check(posts.at(-1)?.price===75&&posts.at(-1)?.priceSource==='seller','selected condition price reaches draft unchanged at '+width);
    check(JSON.stringify(posts.at(-1)).includes('lightly_played'),'draft preserves selected condition quote at '+width);
    await snapshot('asking-range');

    await page.locator('#condPills [data-cond="mp"]').click();
    check(await page.evaluate(()=>getEffectivePrice())===40,'unavailable observed strategy retracts prior condition ask at '+width);
    check(await page.evaluate(()=>!window._qpChosenTier),'unavailable strategy clears selected state at '+width);
    check((await page.locator('#priceRange').innerText()).includes('no measured range'),'single reference has no invented measured range at '+width);
    check(JSON.stringify(await amounts())==='[34,40,46]','missing endpoints still offer clearly estimated asking-price scenarios at '+width);
    check((await page.locator('#qpGradedNote').innerText()).includes('Price scenarios, not observed sales'),'estimated asks are distinguished from observed prices at '+width);
    check(!await page.locator('#qpBarWrap').isVisible(),'no invented position bar for one reference at '+width);
    check((await page.locator('#qpTiers').innerText()).includes('Est. low')&&(await page.locator('#qpTiers').innerText()).includes('Est. high'),'estimated endpoints are labeled on both buttons at '+width);
    await page.locator('#qpTiers button').filter({hasText:'Est. high'}).click();
    check(await page.evaluate(()=>getEffectivePrice())===46,'estimated high updates the fee calculation at '+width);
    await page.locator('#crSellBtn').click();await page.waitForFunction(()=>!document.getElementById('crSellBtn').disabled);
    check(posts.at(-1)?.price===46&&posts.at(-1)?.priceSource==='seller','chosen estimate reaches the draft as the seller asking price at '+width);
    await snapshot('reference-only');
    await page.locator('#priceOverride').fill('17.25');await page.locator('#priceOverride').dispatchEvent('input');
    await page.locator('#condPills [data-cond="nm"]').click();
    check(await page.evaluate(()=>getEffectivePrice())===17.25,'hand-entered price survives condition change at '+width);
    await page.evaluate(()=>{window._venuesEnabled=new Set(['ebay']);calc();});
    check(await page.evaluate(()=>getEffectivePrice())===17.25,'venue selection cannot rewrite the asking price at '+width);
    await page.locator('#crSellBtn').click();await page.waitForFunction(()=>!document.getElementById('crSellBtn').disabled);
    check(posts.at(-1)?.price===17.25,'hand-entered price reaches draft unchanged at '+width);

    for(const stamp of [null,new Date(Date.now()-9*86400000).toISOString()]){
      await page.evaluate(stamp=>{selectedCard.sourceUpdatedAt=stamp;Object.values(currentPrices).forEach(row=>{row.sourceUpdatedAt=stamp;});updatePriceFromPrinting();calc();},stamp);
      check(await page.evaluate(()=>!_qpTiers(_qpBasis()).some(t=>t.observedAsk)),'undated/old range cannot drive asking choices at '+width+' '+stamp);
      check((await page.locator('[data-price-evidence]').textContent()).includes(stamp?'over 7 days old':'update date'),'unusable freshness is explained at '+width+' '+stamp);
    }
    await page.evaluate(()=>{selectedCard.sourceUpdatedAt=new Date().toISOString();Object.values(currentPrices).forEach(row=>{row.sourceUpdatedAt=selectedCard.sourceUpdatedAt;});});
    await page.locator('#gradedPills [data-val="psa"]').click();
    await page.waitForFunction(()=>isGradedVariant());
    check(await page.evaluate(()=>currentPrices[printSelect.value].low===null&&currentPrices[printSelect.value].high===null),'graded averages never populate range endpoints at '+width);
    const graded=await page.locator('[data-comparison-selection]').textContent();
    check(graded.includes('eBay 7-day sold average: $300')&&graded.includes('No measured price range'),'graded average and lack of range are both visible at '+width);
    check(graded.includes('Sale count, individual sale dates and shipping are not provided'),'average limitations remain visible at '+width);
    check(JSON.stringify(await amounts())==='[255,300,345]','graded scenarios use only the selected grade value at '+width);
    check(!await page.locator('#qpBarWrap').isVisible(),'graded reference has no raw or invented range bar at '+width);
    check(!/Sell Now|Patient/.test(await page.locator('#qpTiers').innerText()),'reference does not promise sale timing at '+width);
    await snapshot('grade-reference');
    await page.evaluate(()=>{
      const card=tplCardToNormalized({id:'high-value',name:'Mew',number:'76/214',set_name:'Unbroken Bonds',updated_at:new Date().toISOString(),prices:{raw:{near_mint:{tcgplayer:{market:11000.17,low:10000.11,high:12000.12}}}}},'pokemon');
      setSelectedCard(card);loadCardUI(card);calc();
    });
    check((await page.locator('#qpTiers').innerText()).includes('$12,000.12'),'large prices preserve currency precision at '+width);
    await snapshot('high-value');
    // Values over $100 retain cents, and one-cent ranges cannot select two
    // buttons or allow a rounded reference to replace an actual endpoint.
    await page.evaluate(()=>{
      const card=tplCardToNormalized({id:'cents-fixture',name:'Mew',number:'76/214',set_name:'Unbroken Bonds',updated_at:new Date().toISOString(),prices:{raw:{near_mint:{tcgplayer:{market:100.119,low:100.11,high:100.12}}}}},'pokemon');
      setSelectedCard(card);loadCardUI(card);calc();
    });
    check(JSON.stringify(await amounts())==='[100.11,100.12]','cent rounding retains exactly the reported endpoints at '+width);
    check((await page.locator('#qpTiers').innerText()).includes('$100.11')&&(await page.locator('#qpTiers').innerText()).includes('$100.12'),'prices above $100 retain cents at '+width);
    await page.locator('#qpTiers button').filter({hasText:'Listed high'}).click();
    check(await page.locator('#qpTiers [aria-pressed="true"]').count()===1,'one-cent-separated endpoints have only one selected choice at '+width);
    check(await page.locator('#qpBarMarker').evaluate(el=>el.style.left)==='100%','reported high maps to the actual range endpoint at '+width);
    await page.locator('#qpTiers button').filter({hasText:'Listed low'}).click();
    check(await page.evaluate(()=>getEffectivePrice())===100.11,'selected cents flow into the selling calculation at '+width);
    check(await page.locator('#qpBarMarker').evaluate(el=>el.style.left)==='0%','reported low maps to the actual range endpoint at '+width);
    await snapshot('cents-range');
    check(await page.locator('#qpTiers button').evaluateAll(buttons=>buttons.every(b=>b.scrollWidth<=b.clientWidth+1&&b.getBoundingClientRect().height>=44)),'price choices fit with usable tap targets at '+width);
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page overflow at '+width);
    check(errors.length===0,'no uncaught browser errors at '+width+': '+errors.join('; '));
    await page.close();
  }
} finally {await browser.close();await new Promise(r=>server.close(r));}
for(const message of failures)console.error('FAIL:',message);
console.log(`selling-price-evidence-browser: ${passed} passed, ${failures.length} failed -- SUITE COMPLETE, exit=${failures.length?1:0}`);
assert.equal(failures.length,0,'selling price evidence workflow');
