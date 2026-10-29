// Shipped UI -> draft request, with local services only. No customer records.
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
  for(const width of [390,1280]) {
    const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],posts=[];
    let draftStatus=400;
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async r=>{
      const url=r.request().url();
      if(url.startsWith(origin+'/api/drafts')&&r.request().method()==='POST') {
        posts.push(r.request().postDataJSON());
        return r.fulfill({status:draftStatus,json:{code:'LOCAL_FIXTURE',message:'Draft request recorded by the local test.'}});
      }
      if(url.startsWith(origin+'/api/sell-eligibility'))return r.fulfill({json:{stamps:[{eligible:true}]}});
      if(!url.startsWith(origin)||url.includes('/api/'))return r.fulfill({status:204,body:''});
      return r.continue();
    });
    await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
    await page.goto(origin+'/index.html');
    await page.waitForFunction(()=>typeof loadCardUI==='function');
    await page.waitForTimeout(500); // Allow the app's persisted-card restore to settle.
    await page.evaluate(()=>{
      window._googleIdToken='local-fixture-token';
      window.googleUser={uid:'local-draft-fixture',getIdToken:async()=> 'local-fixture-token'};
      window._venuesEnabled=new Set(['ebay','tcgplayer']);
      const card={id:'draft-price-fixture',name:'Mew',number:'76/214',game:'pokemon',setName:'Unbroken Bonds',source:'TCGPlayer',priceVariants:[{key:'holofoil',label:'Holofoil',market:10,low:8,mid:12},{key:'reverseHolofoil',label:'Reverse Holofoil',market:20,low:18,mid:22}]};
      activeGame='pokemon';setSelectedCard(card);loadCardUI(card);calc();
    });
    await page.waitForFunction(()=>!!window._crSellApproved);
    const refreshed=await page.evaluate(async()=>{
      window._googleIdToken='older-local-token';
      await applySellGate(selectedCard);
      return !!window._crSellApproved && !document.getElementById('crSellBtn').disabled;
    });
    check(refreshed,'same-account token refresh keeps the listing action available at '+width);
    await page.locator('#priceOverride').fill('0');await page.locator('#priceOverride').dispatchEvent('input');
    check((await page.locator('#resultsArea').innerText()).includes('greater than $0'),'zero price warning at '+width);
    check(await page.evaluate(()=>getEffectivePrice())===0,'zero never falls back to a market value at '+width);
    await page.locator('#crSellBtn').click();
    await page.waitForFunction(()=>document.getElementById('crSellBtn').disabled===false);
    check(posts.length===1&&!('price' in posts[0])&&!('priceSource' in posts[0]),'zero starts an unpriced draft, never a falsely priced one at '+width);
    await page.locator('#priceOverride').fill('17.25');await page.locator('#priceOverride').dispatchEvent('input');
    await page.locator('#crSellBtn').click();await page.waitForFunction(()=>!document.getElementById('crSellBtn').disabled);
    check(posts[1]?.price===17.25&&posts[1]?.priceSource==='seller','valid seller asking price reaches draft unchanged at '+width);

    // A deliberate pricing strategy follows the new basis; a hand-entered price stays put.
    await page.evaluate(()=>qpApply(12,'mid'));
    await page.locator('#printingSelect').selectOption('reverseHolofoil');
    check(await page.locator('#priceOverride').inputValue()===''&&await page.evaluate(()=>getEffectivePrice())===20,'changing printing clears a price derived from the old printing at '+width);
    await page.locator('#priceOverride').fill('17.25');await page.locator('#priceOverride').dispatchEvent('input');
    await page.locator('#printingSelect').selectOption('holofoil');
    check(await page.evaluate(()=>getEffectivePrice())===17.25,'printing change preserves a hand-entered asking price at '+width);

    // This provider has LP but no NM price. Missing conditions must recover.
    await page.evaluate(()=>{
      const card=tplCardToNormalized({id:'lp-only',name:'Mew',number:'76/214',set_name:'Unbroken Bonds',prices:{raw:{lightly_played:{tcgplayer:{market:81}}}}},'pokemon');
      setSelectedCard(card);loadCardUI(card);calc();
    });
    await page.waitForFunction(()=>!!window._crSellApproved);
    await page.locator('#condPills [data-cond="lp"]').click();
    check(await page.evaluate(()=>getEffectivePrice())===81,'available LP condition recovers after missing NM at '+width);
    await page.evaluate(()=>qpApply(81,'market'));
    await page.locator('#condPills [data-cond="mp"]').click();
    check(await page.evaluate(()=>getEffectivePrice())===0,'missing MP quote retracts prior LP strategy price at '+width);
    check((await page.locator('#priceRange').textContent()).includes('No quote for this condition'),'missing condition explains how pricing is unavailable at '+width);
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'condition recovery does not overflow at '+width);
    mkdirSync('/tmp/cardresell-draft-integrity-shots',{recursive:true});
    await page.locator('#priceMain').locator('..').screenshot({path:'/tmp/cardresell-draft-integrity-shots/unpriced-'+width+'.png'});
    await page.locator('#crSellBtn').click();await page.waitForFunction(()=>!document.getElementById('crSellBtn').disabled);
    check(!('price' in posts.at(-1)),'missing condition cannot leak the old price into a draft at '+width);
    await page.locator('#condPills [data-cond="lp"]').click();
    check(await page.evaluate(()=>getEffectivePrice())===81,'LP can be selected again after an unavailable condition at '+width);

    const source=await page.evaluate(()=>{
      const date=new Date().toISOString().slice(0,10);
      const card=tplCardToNormalized({id:'provenance',name:'Mew',number:'76/214',set_name:'Unbroken Bonds',prices:{raw:{near_mint:{tcgplayer:{market:1,low:0.5,high:2,last_price_update:date}}}}},'pokemon');
      document.querySelectorAll('#condPills .pill').forEach(p=>p.classList.toggle('sel',p.dataset.cond==='nm'));
      setSelectedCard(card);loadCardUI(card);calc();qpApply(2,'ask-high');
      return {own:_crPricingContext({card:selectedCard}),foreign:_crPricingContext({card:{...selectedCard,id:'other',name:'Pikachu',number:'99/214'}})};
    });
    check(source.own.basisMeta?.label.includes('Listed high')&&source.own.basisMeta?.label.includes('TCGplayer'),'chosen asking source survives draft handoff at '+width);
    check(source.own.basisMeta?.high===2&&!!source.own.basisMeta?.retrievedAt,'reported range and original source date survive at '+width);
    check(!source.foreign.basisMeta,'catalogue fallback never attributes current quote to another card at '+width);

    // Quotes keep their original retrieval time; null/empty ages do not become now.
    const ages=await page.evaluate(()=>{
      const now=Date.now,saved=window._crBasis,base=now();Date.now=()=>base;
      try {
        const unknown=[null,undefined,'',false,' ',Infinity,1e300].map(cacheAgeSec=>_crRetrievedAtFrom({cacheAgeSec}));
        const basis=_crBindBasis({value:81,label:'Fixture market',cacheAgeSec:30},selectedCard);
        window._crBasis=basis;
        const first=_crPricingContext({card:selectedCard}).basisMeta?.retrievedAt;
        Date.now=()=>base+3600000;
        const later=_crPricingContext({card:selectedCard}).basisMeta?.retrievedAt;
        return {unknown,first,later,expected:new Date(base-30000).toISOString(),zero:_crRetrievedAtFrom({cacheAgeSec:0}),explicitUnknown:_crRetrievedAtFrom({retrievedAt:null,cacheAgeSec:30})};
      } catch(e) {return {error:e.message};}
      finally{Date.now=now;window._crBasis=saved;}
    });
    check(!ages.error,'unusable quote ages do not throw at '+width+': '+(ages.error||''));
    check(ages.unknown?.every(x=>x===null),'unknown quote ages stay unknown at '+width);
    check(!!ages.expected&&ages.first===ages.expected&&ages.later===ages.expected,'an hour on the page does not refresh the quote timestamp at '+width);
    check(!!ages.zero&&ages.explicitUnknown===null,'real zero-age remains valid; explicit unknown stays unknown at '+width);

    // Pause token refresh after the button press, then edit inputs. The request
    // must carry the values the seller started with, including basis metadata.
    await page.locator('#priceOverride').fill('19.25');await page.locator('#priceOverride').dispatchEvent('input');
    await page.locator('#shipCharge').fill('7.25');await page.locator('#shipCost').fill('3.10');
    await page.evaluate(()=>{
      window._crBasis=_crBindBasis({value:81,label:'Original quote',cacheAgeSec:60},selectedCard);
      window.googleUser.getIdToken=()=>new Promise(r=>window.releaseDraftToken=r);
    });
    const before=posts.length;
    await page.locator('#crSellBtn').click();
    await page.waitForFunction(()=>typeof window.releaseDraftToken==='function');
    await page.locator('#shipCharge').fill('99');await page.locator('#shipCost').fill('88');
    await page.evaluate(()=>{window._crBasis=_crBindBasis({value:200,label:'Later quote',cacheAgeSec:0},selectedCard);releaseDraftToken('local-fixture-token');});
    await page.waitForFunction(()=>!document.getElementById('crSellBtn').disabled);
    const snapshot=posts[before];
    check(snapshot?.price===19.25,'draft keeps the asking price at button press at '+width);
    check(snapshot?.pricingContext?.shipping?.buyerPays==='7.25'&&snapshot?.pricingContext?.shipping?.sellerCost==='3.10','draft keeps shipping at button press through token refresh at '+width);
    check(snapshot?.pricingContext?.basisMeta?.label==='Original quote','draft keeps its original quote through token refresh at '+width);
    await page.evaluate(()=>{window.googleUser.getIdToken=async()=> 'local-fixture-token';});
    draftStatus=503;
    await page.locator('#crSellBtn').click();await page.waitForFunction(()=>!document.getElementById('crSellBtn').disabled);
    const pending=posts.at(-1);
    await page.locator('#priceOverride').fill('500');await page.locator('#priceOverride').dispatchEvent('input');
    await page.locator('#shipCharge').fill('12');
    draftStatus=400;
    await page.locator('#crSellBtn').click();await page.waitForFunction(()=>!document.getElementById('crSellBtn').disabled);
    check(JSON.stringify(posts.at(-1))===JSON.stringify(pending),'retry after uncertain save resends the original payload at '+width);
    const beforeAccountChange=posts.length;
    await page.evaluate(()=>{delete window.releaseDraftToken;window.googleUser.getIdToken=()=>new Promise(r=>window.releaseDraftToken=r);});
    await page.locator('#crSellBtn').click();
    await page.waitForFunction(()=>typeof window.releaseDraftToken==='function');
    await page.evaluate(()=>{window.googleUser={uid:'different-local-account',getIdToken:async()=> 'different-local-token'};releaseDraftToken('local-fixture-token');});
    await page.waitForFunction(()=>!document.getElementById('crSellBtn').disabled);
    check(posts.length===beforeAccountChange,'account switch during token refresh cannot submit the pending draft at '+width);
    const gateAfterAccountChange=await page.evaluate(async()=>{
      window.googleUser.getIdToken=()=>new Promise(r=>window.releaseGateToken=r);
      const request=applySellGate(selectedCard);
      // Refresh begins on the next microtask. Switch only after the old
      // session's SDK request is actually pending.
      await Promise.resolve();
      window.googleUser={uid:'third-local-account'};
      window.releaseGateToken('different-local-token');
      await request;
      return !window._crSellApproved;
    });
    check(gateAfterAccountChange,'eligibility for a previous account cannot enable listing at '+width);
    check(errors.length===0,'no uncaught browser errors at '+width+': '+errors.join('; '));
    await page.close();
  }
} finally {await browser.close();await new Promise(r=>server.close(r));}
for(const message of failures)console.error('FAIL:',message);
console.log(`draft-price-integrity-browser: ${passed} passed, ${failures.length} failed -- SUITE COMPLETE, exit=${failures.length?1:0}`);
assert.equal(failures.length,0,'draft pricing integrity');
