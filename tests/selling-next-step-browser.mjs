// The shipped workspace: goal -> recommendation -> exact selected draft review.
// Provider/auth/storage boundaries are fixtures. No seller writes or paid scans.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import {ROOT} from './_assetRefs.mjs';

let checks=0;
const check=(value,message)=>{assert.ok(value,message);checks++;};
const server=createServer((req,res)=>{
  const path=resolve(ROOT,'.'+new URL(req.url,'http://local').pathname);
  if(!path.startsWith(ROOT+'/')||!existsSync(path)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(path)]||'application/octet-stream');
  res.end(readFileSync(path));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
try {
  for(const width of [320,390,1280]) {
    const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],writes=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{
      const req=route.request(),url=req.url();
      if(url.includes('/api/')&&!url.includes('/api/events')&&req.method()!=='GET')writes.push(req.method()+' '+new URL(url).pathname);
      if(url.startsWith(origin+'/api/ebay-connect?action=status'))return route.fulfill({json:{available:true,connected:true,username:'fixture-seller',environment:'production'}});
      if(!url.startsWith(origin)||url.includes('/api/'))return route.fulfill({status:204,body:''});
      return route.continue();
    });
    await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
    await page.goto(origin+'/index.html');
    await page.waitForFunction(()=>window.CardResellAdvice&&window.CardResellDraftBatch&&window.CardResellEbayConnect);
    await page.evaluate(()=>{
      googleUser={sub:'selling-flow-fixture'};window._googleIdToken='fixture';
      _crIdToken=async()=> 'fixture';fetchSellStamps=async rows=>({ok:true,stamps:rows.map(()=>({eligible:true}))});
      window._venuesEnabled=new Set(['ebay','tcgplayer']);window._isPro=false;
      const card={id:'selling-flow-card',name:'Mew',number:'76/214',game:'pokemon',setName:'Unbroken Bonds',source:'TCGPlayer',priceVariants:[{key:'holofoil',label:'Holofoil',market:10},{key:'reverseHolofoil',label:'Reverse Holofoil',market:20}]};
      activeGame='pokemon';setSelectedCard(card);loadCardUI(card);
      window.draftIntents=[];_crCreateDraft=async intent=>{draftIntents.push(intent);};
      calc();
    });
    const advice=page.locator('#sellingAdvice'),priority=advice.getByRole('combobox',{name:'Selling priority'}),result=advice.locator('[data-advice-output]');
    check(!await page.locator('#sellingFeeComparison').evaluate(e=>e.open),'single-card fee comparison starts collapsed');
    const titles=[];
    for(const goal of ['balanced','money','quick','easy']) {
      await priority.selectOption(goal);
      titles.push(await result.locator('h3').first().textContent());
      check(await result.locator('[data-ebay-workflow]').isVisible(),'eBay workflow remains visible for '+goal);
    }
    check(new Set(titles).size===4,'all four priorities change the main recommendation');
    check(await result.getAttribute('data-route')==='ebay-draft','least work prioritizes the integrated preparation path');
    check((await result.textContent()).includes('Direct publishing and automatic sales sync are not enabled'),'connection is not misrepresented as live publication');
    await page.evaluate(()=>{window._venuesEnabled=new Set(['tcgplayer']);calc();});
    check(await result.getAttribute('data-route')==='ebay-draft'&&await result.locator('[data-prepare-ebay]').isVisible(),'disabled fee comparisons do not hide the supported eBay preparation path');
    check((await result.textContent()).includes('eBay payout estimate unavailable')&&await page.evaluate(()=>_crSellingAdviceInput.ebay===null),'a disabled venue never receives an invented payout quote');
    await page.evaluate(()=>{window._venuesEnabled=new Set(['ebay','tcgplayer']);calc();});
    if(process.env.CR_SHOT_DIR){mkdirSync(process.env.CR_SHOT_DIR,{recursive:true});await advice.screenshot({path:`${process.env.CR_SHOT_DIR}/single-next-step-${width}.png`});}
    await advice.getByRole('button',{name:'Check eBay connection'}).click();
    const connection=page.locator('#ebayConnectDialog');
    await connection.getByText('Connected to fixture-seller.',{exact:true}).waitFor();
    check((await connection.textContent()).includes('read-only'),'connection action uses authoritative existing status and limits');
    await connection.getByRole('button',{name:'Close',exact:true}).click();
    await page.locator('#sellingFeeComparison > summary').click();
    await page.evaluate(()=>calc());
    check(await page.locator('#sellingFeeComparison').evaluate(e=>e.open),'fee details stay open while recalculating the same selection');
    await page.locator('#printingSelect').selectOption('reverseHolofoil');
    check(!await page.locator('#sellingFeeComparison').evaluate(e=>e.open),'a different printing starts with the concise recommendation');
    await page.locator('#condPills [data-cond="mp"]').click();
    await page.locator('#priceOverride').fill('17.25');await page.locator('#priceOverride').dispatchEvent('input');
    await advice.getByRole('button',{name:'Review eBay draft',exact:true}).click();
    await page.waitForFunction(()=>draftIntents.length===1);
    const intent=await page.evaluate(()=>{const x=draftIntents[0];return {price:x.price,source:x.priceSource,finish:x.card.finish,condition:x.card.pricingSelection.condition,instanceId:x.instanceId};});
    check(intent.price===17.25&&intent.source==='seller'&&/reverse/i.test(intent.finish)&&intent.condition==='mp','draft receives the selected finish, condition and asking price');
    check(!!intent.instanceId,'single-card handoff retains physical-copy identity');
    // A delayed eligibility response must not prepare a newly selected finish.
    await page.evaluate(()=>{window._crSellApproved=null;window.releaseGate=null;fetchSellStamps=()=>new Promise(resolve=>window.releaseGate=()=>resolve({ok:true,stamps:[{eligible:true}]}));});
    await advice.getByRole('button',{name:'Review eBay draft',exact:true}).click();
    await page.waitForFunction(()=>!!releaseGate);
    check(await advice.getByRole('button',{name:'Review eBay draft',exact:true}).isDisabled(),'repeated clicks are blocked during preparation');
    await page.locator('#printingSelect').selectOption('holofoil');
    await page.evaluate(()=>releaseGate());
    await page.waitForTimeout(30);
    check(await page.evaluate(()=>draftIntents.length===1),'stale selection cannot create another draft');
    // And a new session for the SAME user must not inherit the old action.
    await page.evaluate(()=>{window._crSellApproved=null;window.releaseGate=null;calc();});
    await advice.getByRole('button',{name:'Review eBay draft',exact:true}).click();await page.waitForFunction(()=>!!releaseGate);
    await page.evaluate(()=>{googleUser={sub:'selling-flow-fixture'};releaseGate();});
    await advice.locator('[data-workflow-status]').getByText(/account changed/).waitFor();
    check(await page.evaluate(()=>draftIntents.length===1),'same-user new session blocks the old handoff');
    await page.evaluate(()=>{fetchSellStamps=async()=>({ok:true,stamps:[{eligible:false,message:'Confirm the printing first.'}]});window._crSellApproved=null;calc();});
    await advice.getByRole('button',{name:'Review eBay draft',exact:true}).click();
    await advice.locator('[data-workflow-status]').getByText('Confirm the printing first.',{exact:true}).waitFor();
    check(await page.evaluate(()=>draftIntents.length===1),'ineligible card shows an actionable reason without creating a draft');
    await advice.getByText('Your selling preferences',{exact:true}).click();
    await advice.getByRole('checkbox',{name:'I am willing to ship cards'}).uncheck();
    check(await advice.locator('[data-ebay-workflow]').count()===0,'no-shipping preference hides the mailed eBay workflow');
    check(await result.getAttribute('data-route')==='hold','both selling routes disabled gives a useful hold explanation');
    await advice.getByRole('checkbox',{name:'I can sell to buyers or shops locally'}).check();
    check((await result.textContent()).includes('local'),'no-shipping local route is respected');
    await advice.getByRole('checkbox',{name:'I am willing to ship cards'}).check();

    // Review real inventory copies without writing drafts until confirmation.
    await page.evaluate(()=>{
      window.inventoryFixture=[{id:'copy-a',card:'Mew',game:'pokemon',currentValue:10,buyPrice:2},{id:'copy-b',card:'Mew',game:'pokemon',currentValue:20,buyPrice:3},{id:'copy-c',card:'Unpriced card',game:'pokemon',currentValue:null}];
      loadPortData=()=>inventoryFixture;
      CardResellSellingPlan.openCollection(inventoryFixture);
    });
    const plan=page.locator('#sellingPlan'),batch=plan.locator('[data-batch-advice]');
    check(!await page.locator('#sellingPlanComparison').evaluate(e=>e.open),'batch fee tables start collapsed');
    check((await batch.textContent()).includes('1 card needs a value check'),'unpriced copies remain visible and reviewable');
    check((await batch.textContent()).includes('3 eBay drafts'),'quantity drives the easiest workflow recommendation');
    await plan.getByText('Review cards and adjust prices',{exact:true}).click();
    // Duplicate names must remain separate physical copies.
    await plan.getByRole('checkbox',{name:'Include Mew',exact:true}).first().uncheck();
    await plan.getByRole('checkbox',{name:'Include Unpriced card',exact:true}).uncheck();
    await plan.getByRole('spinbutton',{name:'Price per copy: Mew',exact:true}).nth(1).fill('99');
    check((await batch.textContent()).includes('1 eBay draft'),'deselection updates the recommendation immediately');
    await batch.getByRole('button',{name:'Review 1 card for eBay drafts',exact:true}).click();
    await page.locator('.draft-batch').waitFor();
    check(await page.locator('[data-batch-row]').count()===1&&await page.locator('[data-batch-row]').getAttribute('data-batch-row')==='copy-b','only the selected physical copy reaches batch review');
    check((await page.locator('[data-batch-row]').textContent()).includes('$20.00'),'estimate-only price edits never silently replace saved draft prices');
    check(writes.length===0,'opening batch review does not create drafts or publish: '+writes.join('; '));
    await page.getByRole('button',{name:'Close batch preparation'}).click();
    // Stale inventory and account changes fail visibly instead of dropping rows.
    await page.evaluate(()=>{CardResellSellingPlan.openCollection(inventoryFixture.slice(0,2));inventoryFixture[0].card='Changed card';});
    await batch.getByRole('button',{name:'Review 2 cards for eBay drafts',exact:true}).click();
    await batch.locator('[data-workflow-status]').getByText(/selected card changed/).waitFor();
    check(await page.locator('.draft-batch').count()===0,'changed inventory is not handed to an old review');
    await plan.getByRole('button',{name:'Close',exact:true}).click();
    await page.evaluate(()=>{CardResellSellingPlan.openCollection(inventoryFixture.slice(0,2));googleUser={sub:'different-user'};});
    await batch.getByRole('button',{name:'Review 2 cards for eBay drafts',exact:true}).click();
    await batch.locator('[data-workflow-status]').getByText(/account changed/).waitFor();
    check(await page.locator('.draft-batch').count()===0,'account change cannot carry old copies into a new account');
    await plan.getByRole('button',{name:'Close',exact:true}).click();

    await page.evaluate(()=>{
      googleUser={sub:'selling-flow-fixture'};
      CardResellSellingPlan.openCollection(inventoryFixture.slice(0,2));
    });
    const batchTitles=[];
    for(const goal of ['balanced','money','quick','easy']){
      await batch.getByRole('combobox',{name:'Selling priority'}).selectOption(goal);
      batchTitles.push(await batch.locator('[aria-live] h3').first().textContent());
    }
    check(new Set(batchTitles).size===4,'batch priority changes the prominent recommendation');
    await batch.getByRole('combobox',{name:'Selling priority'}).selectOption('money');
    const before=await batch.textContent();
    await plan.getByText('Adjust lot price, shipping and purchase cost',{exact:true}).click();
    await plan.getByRole('spinbutton',{name:'Target price for the whole lot ($)',exact:true}).fill('300');
    check(await batch.textContent()!==before&&(await batch.textContent()).includes('one lot on'),'money recommendation recomputes when assumptions change');
    await batch.getByRole('combobox',{name:'Selling priority'}).selectOption('easy');
    check((await batch.textContent()).includes('eBay drafts'),'easiest remains the eBay workflow when another modeled venue wins');
    check(await plan.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'planner has no horizontal overflow');
    for(const theme of ['light','dark']) {
      await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      await plan.evaluate(e=>e.scrollTop=0);
      if(process.env.CR_SHOT_DIR){mkdirSync(process.env.CR_SHOT_DIR,{recursive:true});await page.screenshot({path:`${process.env.CR_SHOT_DIR}/next-step-${width}-${theme}.png`});}
    }
    await plan.getByRole('button',{name:'Close',exact:true}).click();
    // Scan planning hands the exact chosen rows back for finish review. No write.
    await page.evaluate(()=>{
      _bulkResults=[{success:true,scanUid:'scan-a',rowId:'a',cardName:'Scan A',cardType:'pokemon',marketPrice:10,qty:2},{success:true,scanUid:'scan-b',rowId:'b',cardName:'Scan B',cardType:'pokemon',marketPrice:20}];
      _bulkDraftSel=[];_bulkProcessing=false;_bulkDraftBusy=false;
      CardResellBulkWorkflow.canWrite=()=>true;
      CardResellSellingPlan.openBulk();
    });
    await plan.getByText('Review cards and adjust prices',{exact:true}).click();
    await plan.getByRole('checkbox',{name:'Include Scan B',exact:true}).uncheck();
    await batch.getByRole('button',{name:'Review 2 cards for eBay drafts',exact:true}).click();
    await plan.waitFor({state:'detached'});
    check(await page.evaluate(()=>JSON.stringify(_bulkDraftSel)==='["scan-a"]'&&_bulkResults[0].qty===2),'scan handoff preserves exact row selection and all physical copies');
    check(writes.length===0,'workflow review performs no seller, listing or inventory mutations');
    check(!errors.length,'no browser errors: '+errors.join('; '));
    await page.close();
  }
} finally {await browser.close();await new Promise(r=>server.close(r));}
console.log(`Selling next step: ${checks} passed -- SUITE COMPLETE, exit=0`);
