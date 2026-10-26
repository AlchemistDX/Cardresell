import {readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {join} from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {parse} from 'acorn';
import {chromium} from 'playwright';
import {referencedHashedAssets,ROOT} from './_assetRefs.mjs';
const assets=referencedHashedAssets();
const read=base=>readFileSync(assets.find(a=>a.base===base).path,'utf8');
const core=read('core'),ui=read('ui'),module=read('selling-plan');
const extract=(s,names)=>parse(s,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&names.includes(n.id.name)||n.type==='VariableDeclaration'&&n.declarations.some(d=>names.includes(d.id.name))).map(n=>s.slice(n.start,n.end)).join('\n');
const fees=extract(core,['feeEbay','feeTCGPlayer','feeMercari','TCG_LEVELS']);
const keyTrap=parse(core,{ecmaVersion:'latest'}).body.filter(n=>n.type==='ExpressionStatement'&&core.slice(n.start,n.end).startsWith("document.addEventListener('keydown'")&&core.slice(n.start,n.end).includes('_topOpenDialog')).map(n=>core.slice(n.start,n.end)).join('\n');
const bulk=extract(ui,['_bulkUpdatePackTracker','_bulkDraftIsSelected','bulkDraftToggleRow','bulkDraftSelectAll','_bulkDraftSelectable','_bulkCopyUids','_bulkNewScanUid','_bulkResetBottomBarButtons','_bulkFinishQueue','_bulkRefreshResultSummary','bulkAddAllToCollection','_bulkDupKey','_bulkDetectDuplicates','_bulkClearDupBanner']);
let checks=0;const check=(v,m)=>{assert.ok(v,m);checks++};
const c={window:{},Intl,Number,Set};vm.createContext(c);vm.runInContext(fees+'\n'+module,c);
const api=c.window.CardResellSellingPlan;
const feeFor=(pid,p,s)=>c[pid==='ebay'?'feeEbay':pid==='tcgplayer'?'feeTCGPlayer':'feeMercari'](p,s).reduce((n,f)=>n+f.a,0);
const options={venues:['ebay','tcgplayer'],singleShip:0,singlePostage:0,lotPrice:120,lotShip:0,lotPostage:0};
const rows=[{name:'A',price:10,qty:2,game:'pokemon'},{name:'B',price:100,qty:1,game:'pokemon'}];
let result=api.calculate(rows,options,feeFor);
check(result.summary.count===3&&result.summary.valueCents===12000,'every duplicate copy contributes to value');
check(result.singles.find(q=>q.pid==='ebay').net===10309,'singles charge fixed fees separately per copy');
check(result.lots.find(q=>q.pid==='ebay').net===10370,'lot incurs one fixed order fee');
check(result.singles[0].pid==='tcgplayer'&&result.singles[0].net===10319,'single-venue ranking by rounded net');
check(result.lots[0].net===10380,'TCG lot uses one Marketplace order');
result=api.calculate(rows,{...options,lotShip:4,lotPostage:5},feeFor);
check(result.lots.find(q=>q.pid==='tcgplayer').net===10227,'buyer shipping revenue, shipping fee basis, and postage counted once');
result=api.calculate([{price:100,game:'pokemon'},{price:10,game:'sports'}],options,feeFor);
check(result.singles.length===1&&result.lots.length===1,'partial-coverage venues never win whole selection');
check(result.split.net===9482&&result.split.assignments[0].pid==='tcgplayer','per-card split honors game coverage');
result=api.calculate([{price:100,game:'mtg'},{price:10,game:'pokemon'}],options,feeFor);
check(result.singles.length===2&&result.lots.length===1,'mixed-game TCG lot is excluded without discarding valid singles');
for(const row of [{price:1,game:'pokemonjp'},{price:1,game:'pokemon',japanese:true},{price:1,game:'pokemon',graded:true},{price:1,game:''}]){
 check(api.calculate([row],options,feeFor).singles.length===1,'unsupported TCG identity is excluded');
}
for(const price of [null,undefined,NaN,Infinity,-1,'10'])check(api.calculate([{price}],options,feeFor).summary.missing===1,'unknown/invalid value does not silently become zero');
check(api.calculate([{price:0}],options,feeFor).summary.missing===0,'explicit zero is a known value');
check(api.calculate([{price:.01}],{...options,singlePostage:5},feeFor).split.net===-529,'negative net is retained');
check(api.calculate(rows.map(r=>({...r,selected:false})),options,feeFor).split===null,'empty selection cannot produce a recommendation');
check(api.calculate(rows,{...options,venues:[]},feeFor).split===null,'no unlocked enabled venues means no winner');
for(const key of ['singleShip','singlePostage','lotShip','lotPostage'])for(const value of [null,undefined,NaN,Infinity,-1,'']){
 const incomplete=api.calculate(rows,{...options,[key]:value},feeFor);
 check(incomplete.split===null&&incomplete.singles.length===0&&incomplete.lots.length===0,'missing or invalid '+key+' cannot produce a payout ranking');
}
const caps=api.calculate([{price:4000,qty:2,game:'pokemon'}],{...options,lotPrice:8000},feeFor);
check(caps.singles.find(q=>q.pid==='tcgplayer').fees===35060,'TCG commission cap charged per physical single');
check(caps.lots.find(q=>q.pid==='tcgplayer').fees===27530,'lot commission cap applies once');
check(caps.lots.find(q=>q.pid==='ebay').fees===100590,'eBay high-value tier applies to lot order');

const html=readFileSync(join(ROOT,'index.html'),'utf8');
const collection=read('collection-drafts');
const fixture=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+`<script>
window.googleUser={sub:'fixture'};window._bulkResults=[];window._bulkDraftSel=[];window._bulkProcessing=false;window._bulkStartPackCost=0;
let data=[], enabled=['ebay','tcgplayer'];function loadPortData(){return data}function _crResolveEntry(a,id){return {row:a.find(p=>String(p.id)===String(id))}}function _venueTier(){return 'free'}function venueEligible(pid){return enabled.includes(pid)}function _crSellerProfile(){return {ebayStore:'none',ebayPromo:0,tcgLevel:'l14'}}function showToast(){}function switchView(){}function bulkMergeDuplicates(){}async function _bulkTextRescueMisses(){}function _bulkSaveToCollection(rows,costs){window.savedCosts=costs;window.savedRows=rows}function _bulkFindResult(id){return _bulkResults.find(r=>r.rowId===id)}function _bulkUpdateRow(){_bulkUpdatePackTracker()}function _bulkDraftSyncSelectionUI(){_bulkUpdatePackTracker()}
const _DIALOGS={bulkScanOverlay:()=>window.underlyingClosed=true};function _topOpenDialog(){return document.getElementById('bulkScanOverlay').style.display==='flex'?document.getElementById('bulkScanOverlay'):null}function _dialogFocusables(el){return [...el.querySelectorAll('button')]}
${keyTrap}\n${fees}\n${bulk}\n${module}\n${collection}
function seedBulk(){document.getElementById('bulkScanOverlay').style.display='flex';document.getElementById('bulkModePicker').style.display='none';document.getElementById('bulkProcessing').style.display='flex';document.getElementById('bulkBottomBar').style.display='block';_bulkResults=[{success:true,scanUid:'a',rowId:'a',cardName:'Pikachu',cardType:'pokemon',marketPrice:10,qty:2},{success:true,scanUid:'b',rowId:'b',cardName:'Charizard',cardType:'pokemon',marketPrice:100}];_bulkFinishQueue(3)}
function seedCollection(){document.getElementById('bulkScanOverlay').style.display='none';document.getElementById('collectionView').style.display='block';document.getElementById('collectionContent').style.display='block';data=[{id:1,card:'Pikachu',game:'pokemon',currentValue:10,buyPrice:2},{id:2,card:'Charizard',game:'pokemon',currentValue:100,buyPrice:30}];document.getElementById('collectionWrap').innerHTML='<table>'+data.map(p=>'<tr class="col-row" data-entry-id="'+p.id+'"><td data-label="Card"></td></tr>').join('')+'</table>';CardResellCollectionDrafts.mount(data)}
</script>`;
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(fixture)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
try{for(const width of [320,390,844,1280]){
 const page=await browser.newPage({viewport:{width,height:width===844?390:844}});const errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{if(r.request().url().includes('/api/'))requests.push(r.request().url());return r.request().url().startsWith('http://127.0.0.1')?r.continue():r.abort()});await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.evaluate(()=>seedBulk());check(await page.locator('#bulkPackTracker').isVisible(),'zero-cost bulk always shows total');check(await page.locator('#bulkPackTrackerAmt').textContent()==='$120.00','bulk sum includes quantity');
 await page.evaluate(()=>{window.keptResults=_bulkResults;_bulkResults=Array.from({length:18},(_,i)=>({success:true,scanUid:'match-'+i,cardName:'Card '+(i%9),cardNumber:String(i%9+1),setName:'Test set',cardType:'pokemon'}));_bulkDetectDuplicates()});
 check((await page.locator('#bulkDupBanner summary').textContent()).includes('9 matching card groups'),'two matching nine-card pages show all nine groups, not only the first pair');
 check(await page.locator('#bulkDupBanner li').count()===9,'review lists every matching identity');
 check(await page.evaluate(()=>_bulkResults.length===18),'matching review does not drop repeated scans or copies automatically');
 check(await page.evaluate(()=>{const r=_bulkResults[0];return _bulkDupKey(r)!==_bulkDupKey({...r,isJapanese:true})&&_bulkDupKey(r)!==_bulkDupKey({...r,priceVariant:'reverseHolofoil'})&&_bulkDupKey(r)!==_bulkDupKey({...r,conditionChosen:true,condition:'LP'})&&_bulkDupKey({...r,cardNumber:''})!==_bulkDupKey({...r,cardNumber:'',scanUid:'other'})}),'language, finish, condition and incomplete identities are not merged');
 await page.evaluate(()=>{_bulkResults=keptResults;_bulkClearDupBanner()});
 check(await page.locator('#bulkCreateDraftsBtn').isVisible(),'completion rebuild keeps listing drafts in the primary row');
 check(!await page.locator('#bulkCompareSellingBtn').isVisible(),'comparison is collapsed initially');
 await page.locator('#bulkMoreActions summary').click();check(await page.locator('#bulkCompareSellingBtn').isVisible(),'comparison available under More actions');await page.locator('#bulkMoreActions summary').click();
 await page.evaluate(()=>{_bulkStartPackCost=12;bulkAddAllToCollection()});check(await page.evaluate(()=>savedRows.length===2&&savedCosts[0]===4&&savedCosts[1]===4),'save reuses upfront cost per physical copy without cost sheet');
 await page.evaluate(()=>{_bulkStartPackCost=0;bulkAddAllToCollection()});check(await page.evaluate(()=>savedCosts[0]===0&&savedCosts[1]===0),'blank upfront cost saves as zero');
 await page.evaluate(()=>{_bulkProcessing=true;_bulkDraftSel=['a'];_bulkUpdatePackTracker()});check(await page.locator('#bulkPackTrackerAmt').textContent()==='$120.00','running total covers all cards even with a previous selection');check(!await page.locator('#bulkSelectedValue').isVisible(),'selection details hidden while scanning');
 await page.evaluate(()=>{_bulkResults.push({success:true,scanUid:'c',rowId:'c',marketPrice:5});_bulkUpdatePackTracker()});check(await page.locator('#bulkPackTrackerAmt').textContent()==='$125.00','running total increases as cards finish');
 await page.evaluate(()=>{_bulkResults.pop();_bulkProcessing=false;_bulkDraftSel=[];_bulkUpdatePackTracker();document.getElementById('bulkResultsList').innerHTML='<div style="flex-shrink:0;height:3000px">Test scan results</div>'});
 const before=await page.locator('#bulkPackTracker').boundingBox();await page.locator('#bulkResultsList').evaluate(el=>{el.scrollTop=1000});const after=await page.locator('#bulkPackTracker').boundingBox();check(before.y===after.y,'total remains fixed while results scroll');
 check(await page.locator('#bulkAddAllBtn').isVisible()&&await page.locator('#bulkCreateDraftsBtn').isVisible(),'collection and listing drafts stay available');
 if(process.env.CR_SHOT_DIR)await page.screenshot({path:process.env.CR_SHOT_DIR+'/bulk-results-'+width+'.png'});
 await page.evaluate(()=>{bulkDraftToggleRow('a')});check(await page.locator('#bulkPackTrackerAmt').textContent()==='$20.00','selected total is the main number');check((await page.locator('#bulkSelectedValue').textContent()).includes('$120.00'),'all-card value remains available for a partial selection');
 await page.locator('#bulkMoreActions summary').click();
 await page.locator('#bulkCompareSellingBtn').click();check((await page.locator('#sellingPlanSummary').textContent()).includes('2 selected cards'),'bulk comparison consumes selected rows');
 check((await page.locator('#sellingPlanResults').textContent()).includes('Best estimated venue for all singles'),'single venue recommendation visible');
 await page.keyboard.press('Tab');check(await page.evaluate(()=>!!document.activeElement.closest('#sellingPlan')),'Tab stays inside planner');
 const bounds=await page.locator('#sellingPlan').boundingBox();check(bounds.width<=width&&bounds.x>=0,'planner fits viewport');
 check(await page.evaluate(()=>{const d=document.getElementById('sellingPlan');return d.scrollWidth<=d.clientWidth+1}),'no horizontal modal overflow');
 await page.locator('#sellingPlan').getByRole('button',{name:'Close',exact:true}).click();await page.locator('#sellingPlan').waitFor({state:'detached'});check(await page.locator('#sellingPlan').count()===0,'close preserves bulk');
 await page.evaluate(()=>{bulkDraftToggleRow('a');_bulkResults[0].marketPrice=null;_bulkUpdatePackTracker()});check((await page.locator('#bulkPackTrackerStatus').textContent()).includes('2 missing'),'unknown quantity reported in subtotal');
 await page.locator('#bulkCompareSellingBtn').click();check((await page.locator('#sellingPlanResults').textContent()).includes('Add the missing prices'),'missing values block a misleading complete ranking');
 await page.locator('#sellingPlan').getByText('Review cards and adjust prices',{exact:true}).click();await page.getByRole('spinbutton',{name:'Price per copy: Pikachu',exact:true}).fill('10');
 check((await page.locator('#sellingPlanResults').textContent()).includes('Best estimated lot payout'),'manual price completes comparison');
 await page.locator('#sellingPlan').getByText('Adjust lot price, shipping and purchase cost',{exact:true}).click();await page.getByRole('spinbutton',{name:'Target price for the whole lot ($)',exact:true}).fill('90');
 check((await page.locator('#sellingPlanResults').textContent()).includes('at your $90.00 lot price'),'lot price override recalculates');
 await page.getByRole('checkbox',{name:'Include Pikachu',exact:true}).uncheck();check(await page.getByRole('spinbutton',{name:'Target price for the whole lot ($)',exact:true}).inputValue()==='90','manual lot target survives selection change');
 await page.getByRole('button',{name:'Use selected singles total as lot price',exact:true}).click();check(await page.getByRole('spinbutton',{name:'Target price for the whole lot ($)',exact:true}).inputValue()==='100.00','explicit reset uses selected total');
 await page.getByRole('spinbutton',{name:'Singles: postage + packing per card ($)',exact:true}).fill('-1');check((await page.locator('#sellingPlanResults').textContent()).includes('non-negative'),'negative shipping blocked');
 await page.getByRole('spinbutton',{name:'Singles: postage + packing per card ($)',exact:true}).fill('5');
 await page.keyboard.press('Escape');await page.locator('#sellingPlan').waitFor({state:'detached'});check(await page.locator('#sellingPlan').count()===0,'escape closes planner');check(await page.evaluate(()=>!window.underlyingClosed),'native modal key handling preserves underlying bulk dialog');
 await page.evaluate(()=>seedCollection());await page.getByRole('button',{name:'Compare entire collection',exact:true}).click();check((await page.locator('#sellingPlanSummary').textContent()).includes('$110.00'),'entire Collection entry point');
 await page.locator('#sellingPlan').getByText('Review cards and adjust prices',{exact:true}).click();await page.getByRole('checkbox',{name:'Include Charizard',exact:true}).uncheck();
 await page.locator('#sellingPlan').getByText('Adjust lot price, shipping and purchase cost',{exact:true}).click();check(await page.getByRole('spinbutton',{name:'Purchase cost of these cards ($)',exact:true}).inputValue()==='2.00','selection preserves actual individual collection purchase costs');
 check(await page.getByRole('spinbutton',{name:'Target price for the whole lot ($)',exact:true}).inputValue()==='10.00','default lot target follows selection');
 await page.keyboard.press('Escape');await page.locator('#sellingPlan').waitFor({state:'detached'});await page.locator('.collection-draft-check').nth(1).check();await page.getByRole('button',{name:'Compare 1 selected card',exact:true}).click();check((await page.locator('#sellingPlanSummary').textContent()).includes('$100.00'),'selected Collection entry point');
 if(process.env.CR_SHOT_DIR)await page.screenshot({path:process.env.CR_SHOT_DIR+'/selling-plan-'+width+'.png'});
 await page.keyboard.press('Escape');await page.locator('#sellingPlan').waitFor({state:'detached'});check(await page.evaluate(()=>data[1].currentValue===100&&data.length===2),'comparison never modifies saved collection');
 check(!requests.length,'no API, billing or publish requests');check(!errors.length,errors.join('\n'));await page.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));}
console.log('Selling plan: '+checks+' checks passed; no provider calls. -- SUITE COMPLETE, exit=0');
