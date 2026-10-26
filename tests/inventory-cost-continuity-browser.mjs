// Real shipped UI, account-scoped storage, reload, exports and sale handoff.
// Synthetic post-scan rows only; all external and API requests are blocked.
import {chromium} from 'playwright';
import {readFileSync, mkdirSync} from 'node:fs';
import {resolve, extname} from 'node:path';
import assert from 'node:assert/strict';
import {completionGuard} from './_complete.mjs';
const {finish}=completionGuard('inventory-cost-continuity-browser');
const root=resolve(new URL('..',import.meta.url).pathname), origin='http://localhost:8460';
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
let checks=0;
const check=(v,m)=>{assert.ok(v,m);checks++;};
try {for(const width of [390,1280]) {
 const page=await browser.newPage({viewport:{width,height:844}}), errors=[], writes=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
 await page.route('**/*',route=>{
  const req=route.request(), u=new URL(req.url());
  if(req.method()!=='GET')writes.push(u.pathname);
  if(u.origin!==origin||u.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{error:'offline_fixture'}});
  try {const p=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!p.startsWith(root+'/'))throw Error('path');return route.fulfill({body:readFileSync(p),contentType:({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'}[extname(p)]||'application/octet-stream')});}
  catch{return route.fulfill({status:404,body:''});}
 });
 async function init() {
  await page.waitForFunction(()=>window.CardResellFlipReport&&window.CardResellBulkWorkflow);
  await page.evaluate(()=>{
   window.googleUser={sub:'cost-owner'};window._googleIdToken=null;window._isPro=true;
   window.costToasts=[];window.showToast=m=>costToasts.push(m);
   window.seedCosts=()=>{
    closeBulkScan();savePortData([]);saveFlipsData([]);openBulkScan();
    window._bulkResults=[{rowId:'cost-a',scanUid:'a',success:true,cardName:'Unknown cost',cardType:'pokemon',marketPrice:10,qty:2},{rowId:'cost-b',scanUid:'b',success:false,marketPrice:null}];
    _bulkShowSection('processing');
    document.getElementById('bulkResultsList').innerHTML=_bulkResults.map(r=>'<div id="'+r.rowId+'"></div>').join('');
   };
  });
 }
 await page.goto(origin);await init();
 await page.evaluate(()=>{seedCosts();bulkAddAllToCollection();});
 check(await page.evaluate(()=>loadPortData().length===2&&loadPortData().every(p=>p.buyPrice===null&&p.costMeta.buyPrice==='blank')),'blank scan cost persists unknown for each physical copy');
 check(await page.evaluate(()=>_bulkPackUnitCost===null),'successful unknown allocation freezes as unknown');
 await page.evaluate(()=>{_bulkStartPackCost=30;document.getElementById('bulkStartPackCost').value='30';Object.assign(_bulkResults[1],{success:true,cardName:'Recovered cost',marketPrice:5});bulkAddAllToCollection();bulkAddAllToCollection();});
 check(await page.evaluate(()=>loadPortData().length===3&&loadPortData().every(p=>p.buyPrice===null)),'recovering a card does not silently change an unknown allocation or duplicate copies');
 await page.evaluate(()=>CardResellSellingPlan.openBulk());
 await page.getByText('Adjust lot price, shipping and purchase cost',{exact:true}).click();
 check(await page.getByRole('spinbutton',{name:'Purchase cost of these cards ($)',exact:true}).inputValue()==='','planner respects a frozen unknown cost even after the upfront input changes');
 await page.locator('#sellingPlan').getByRole('button',{name:'Close',exact:true}).click();
 await page.reload();await init();
 check(await page.evaluate(()=>loadPortData().every(p=>p.buyPrice===null&&p.costMeta.buyPrice==='blank')),'unknown costs survive an actual reload');
 await page.evaluate(()=>{closeBulkScan();switchView('collection');renderCollectionView();openCollectionCardDetail(loadPortData()[0].id);});
 check((await page.locator('#ccmPnL').textContent()).includes('Cost unknown'),'card details disclose unknown cost');
 for(const theme of ['light','dark']) {
  await page.evaluate(theme=>{document.documentElement.setAttribute('data-theme',theme);document.body.setAttribute('data-theme',theme);},theme);
  check(await page.locator('#ccmPnL').evaluate(el=>getComputedStyle(el).color===getComputedStyle(document.getElementById('ccmName')).color),'cost explanation uses the readable card-title text color in '+theme+' mode');
 }
 if(process.env.CR_COST_SHOTS){mkdirSync(process.env.CR_COST_SHOTS,{recursive:true});await page.screenshot({path:process.env.CR_COST_SHOTS+'/unknown-cost-'+width+'.png'});}
 const download=page.waitForEvent('download');await page.evaluate(()=>exportCollection());
 const csv=readFileSync(await (await download).path(),'utf8');
 check(csv.includes('"Unknown cost","","","10.00","",""'),'Collection export leaves unknown cost and gain blank');
 await page.evaluate(()=>{document.getElementById('collectionCardModal').classList.remove('open');openMarkSoldModal(loadPortData()[0].id);});
 check(await page.locator('#msBuyPrice').inputValue()==='','sale form does not invent a cost for a scanned card');
 await page.evaluate(async()=>{for(const [id,value] of Object.entries({msSellPrice:'20',msFees:'0',msShipCost:'0',msGradingCost:'0',msRefundAmount:'0',msOtherExpenses:'0'}))document.getElementById(id).value=value;await confirmMarkSold();});
 check(await page.evaluate(()=>loadFlipsData().length===1&&loadFlipsData()[0].costMeta.buyPrice==='blank'&&loadPortData().length===2),'sale retains unknown cost and removes only the sold copy');
 check(await page.evaluate(()=>{const r=CardResellFlipReport.build(loadFlipsData()).rows[0];return !r.complete&&r.costs[0]===null&&r.net===null;}),'unknown purchase cost cannot become completed profit in the report');
 await page.evaluate(()=>{seedCosts();document.getElementById('bulkStartPackCost').value='0';document.getElementById('bulkStartPackCost').dispatchEvent(new Event('input'));bulkAddAllToCollection();closeBulkScan();openCollectionCardDetail(loadPortData()[0].id);});
 check(await page.evaluate(()=>loadPortData().every(p=>p.buyPrice===0&&p.costMeta.buyPrice==='zero')),'explicit zero scan cost is recorded as confirmed zero');
 check((await page.locator('#ccmPnL').textContent()).includes('+$10.00')&&!(await page.locator('#ccmPnL').textContent()).includes('%'),'zero basis shows gain without a fabricated return percentage');
 await page.evaluate(()=>{document.getElementById('collectionCardModal').classList.remove('open');openMarkSoldModal(loadPortData()[0].id);});
 check(await page.locator('#msBuyPrice').inputValue()==='0.00','confirmed scanned zero prefills the sale form');
 await page.evaluate(async()=>{for(const [id,value] of Object.entries({msSellPrice:'20',msFees:'0',msShipCost:'0',msGradingCost:'0',msRefundAmount:'0',msOtherExpenses:'0'}))document.getElementById(id).value=value;await confirmMarkSold();});
 check(await page.evaluate(()=>CardResellFlipReport.build(loadFlipsData()).rows[0].complete),'confirmed zero with all other costs entered produces a complete sale');
 await page.evaluate(()=>{seedCosts();document.getElementById('bulkStartPackCost').value='-1';document.getElementById('bulkStartPackCost').dispatchEvent(new Event('input'));bulkAddAllToCollection();});
 check(await page.evaluate(()=>!loadPortData().length&&!_bulkResults[0].collectionSaved&&_bulkPackUnitCost===undefined),'invalid upfront cost does not save or freeze the batch');
 await page.evaluate(()=>{document.getElementById('bulkStartPackCost').value='12';document.getElementById('bulkStartPackCost').dispatchEvent(new Event('input'));bulkAddAllToCollection();});
 check(await page.evaluate(()=>loadPortData().length===2&&loadPortData().every(p=>p.buyPrice===4)),'corrected pack cost reserves the unresolved copy share');
 await page.evaluate(()=>{seedCosts();openBulkCostSheet(_bulkResults.filter(r=>r.success));confirmBulkCostSave();});
 check(await page.evaluate(()=>loadPortData().every(p=>p.buyPrice===null)),'blank cost-sheet pack total stays unknown');
 await page.evaluate(()=>{seedCosts();openBulkCostSheet(_bulkResults.filter(r=>r.success));setBulkCostMode('per');document.getElementById('bulkCost_0').value='-5';confirmBulkCostSave();});
 check(await page.evaluate(()=>!loadPortData().length),'negative per-card cost cannot be saved');
 await page.evaluate(()=>{document.getElementById('bulkCost_0').value='';confirmBulkCostSave();});
 check(await page.evaluate(()=>loadPortData().every(p=>p.buyPrice===null)),'blank per-card cost stays unknown');
 await page.evaluate(()=>{seedCosts();bulkSkipPricingAndSave();});
 check(await page.evaluate(()=>loadPortData().every(p=>p.buyPrice===null)),'skip costs explicitly means unknown');
 await page.evaluate(()=>{seedCosts();_bulkSaveToCollection(_bulkResults.filter(r=>r.success),{0:NaN});});
 check(await page.evaluate(()=>!loadPortData().length),'save boundary refuses non-finite cost');
 await page.evaluate(()=>{seedCosts();window.realCostSave=savePortData;window.savePortData=()=>false;bulkAddAllToCollection();window.savePortData=realCostSave;});
 check(await page.evaluate(()=>!loadPortData().length&&!_bulkResults[0].collectionSaved&&_bulkPackUnitCost===undefined),'failed storage leaves cost and rows retryable');
 await page.evaluate(()=>bulkAddAllToCollection());
 check(await page.evaluate(()=>loadPortData().length===2&&loadPortData().every(p=>p.buyPrice===null)),'retry keeps unknown cost and saves once');
 await page.evaluate(()=>{closeBulkScan();savePortData([{id:'loss',card:'Loss',buyPrice:20,currentValue:10},{id:'no-value',card:'No value',buyPrice:5,currentValue:null},{id:'no-cost',card:'No cost',buyPrice:null,currentValue:100}]);renderCollectionView();openCollectionCardDetail('loss');});
 check((await page.locator('#ccmPnL').textContent()).includes('−$10.00'),'loss amount includes a minus sign');
 await page.evaluate(()=>openCollectionCardDetail('no-value'));
 check((await page.locator('#ccmPnL').textContent()).includes('Value unknown'),'missing value does not show a break-even gain');
 await page.evaluate(()=>{document.getElementById('collectionCardModal').classList.remove('open');renderFlipsView();});
 check((await page.locator('#pnlUnrealized').textContent()).includes('−$10.00'),'portfolio gain excludes unknown cost and value rows');
 check((await page.locator('#portfolioWrap').textContent()).includes('Unknown'),'legacy portfolio table does not invent zero costs');
 check(await page.evaluate(()=>document.getElementById('pnlUnrealized').title.includes('2')),'portfolio gain explains excluded incomplete copies');
 await page.evaluate(()=>{openAddFlip('hold');document.getElementById('mCardName').value='Known free card';document.getElementById('mBuyPrice').value='0';saveFlipEntry();openMarkSoldModal(loadPortData().find(p=>p.card==='Known free card').id);});
 check(await page.locator('#msBuyPrice').inputValue()==='0.00','manual Collection zero also survives the sale handoff');
 check(!writes.some(p=>/^\/api\/(scan|scan-debit-id|drafts|ebay-listing-operations)$/.test(p)),'no provider or marketplace write calls');
 assert.deepEqual(errors,[],'no browser exceptions');checks++;
 await page.close();
}} finally {await browser.close();}
finish(checks,0);
