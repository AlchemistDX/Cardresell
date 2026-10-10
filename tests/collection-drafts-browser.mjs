// Real Collection renderer, selection module and create client in Chromium.
// API replies are controlled here; server capacity/Lua coverage lives in draft-plan-capacity.
import {chromium} from 'playwright';
import {parse} from 'acorn';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {referencedHashedAssets,ROOT} from './_assetRefs.mjs';
const html=readFileSync(join(ROOT,'index.html'),'utf8');
const core=readFileSync(referencedHashedAssets().find(a=>a.base==='core').path,'utf8');
const names=new Set(['renderCollectionView','_crCreateDraft','_crResolveEntry','_crMatchesById','_crIdEq']);
const code=parse(core,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&names.has(n.id.name)).map(n=>core.slice(n.start,n.end)).join('\n');
const module=readFileSync(join(ROOT,'js/collection-drafts.js'),'utf8');
const fixture=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+`<script>
window.googleUser={sub:'owner'};let data=[],calls=[],manifests=[],opened=[],mode='ok',limit=10,deferHead;
const _crCreateAttempt={},_crScanPhotoAttempt={},_crDraftState={},CR_D1_SLOT='ebay:fixed-price';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function loadPortData(){return data}function _updateCollectionSignInWall(){}function _crBumpGen(){}function hydrateCollectionSellButtons(){}
function _crValueProvenance(p){return p.provenance}function _scanPhotoSnapshot(){return null}function _cardWithoutPhotoBytes(p){return p}function _crPricingContext(){return {}}
async function _crIdToken(){return 'fixture'}function _crCreateIdemKey(a,b,c){return a+'_'+b+'_'+(_crDraftState[c]?.generation||0)}function _crNoteRowState(i,s){_crDraftState[i]=s}function _crNoteRowGone(i,s){_crDraftState[i]=s}function _crGoneCopy(){return {text:'Draft deleted. Select again to create a new draft.'}}
function showToast(){}function openDraftReview(id){opened.push(id)}function switchView(v){opened.push(v)}
async function _bulkDraftHeadroom(){if(deferHead)await new Promise(r=>window.finishHead=r);return {known:true,cap:25,total:0,free:25,bulkLimit:limit}}
async function fetchSellStamps(cards){return {ok:true,stamps:cards.map(p=>({eligible:!p.ineligible,message:'Add a card number.'}))}}
window.fetch=async(url,opts)=>{const body=JSON.parse(opts.body);if(url.includes('action=batch')){manifests.push(body);return Response.json({count:body.rows.length})}calls.push({body,key:opts.headers['Idempotency-Key']});if(mode==='network')throw Error('lost response');if(mode==='malformed')return Response.json({});if(mode==='cap')return Response.json({code:'DRAFT_CAP_REACHED',error:'Draft capacity reached.'},{status:409});return Response.json({draftId:'drf_'+String(body.instanceId.replace('inst_col_','')).padStart(32,'0'),generation:0,existing:mode==='existing'},{status:mode==='existing'?200:201})};
${code}\n${module}
function seed(list){data=list;document.getElementById('collectionView').style.display='block';document.getElementById('collectionWrap').closest('[style*="display: none"]')?.style.removeProperty('display');renderCollectionView()}
</script>`;
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(fixture)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});let checks=0;
const check=(v,m)=>{assert.ok(v,m);checks++};
try{for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1')?r.continue():r.abort());await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.evaluate(()=>seed([{id:1,card:'Pikachu',set:'Base',buyPrice:1,currentValue:2,provenance:'comp'},{id:2,card:'Charizard',set:'Base',buyPrice:3},{id:3,card:'Pikachu Promo',buyPrice:0,ineligible:true}]));
 const select=()=>page.getByRole('button',{name:'Select visible',exact:true}).click();const prepare=()=>page.locator('[data-create]').click();const done=()=>page.waitForFunction(()=>!document.querySelector('[data-create]').textContent.includes('Preparing'));
 check(await page.locator('.collection-draft-check').count()===3,'every card selectable');
 if(process.env.CR_SHOT_DIR)await page.screenshot({path:process.env.CR_SHOT_DIR+'/collection-'+width+'.png',fullPage:true});
 await page.getByRole('searchbox',{name:'Search collection'}).fill('pikachu');await select();
 check(await page.locator('.collection-draft-check:checked').count()===2,'select visible matches search');
 await page.getByRole('searchbox').fill('');check(await page.locator('.collection-draft-check:checked').count()===2,'filter preserves explicit selection');
 await page.evaluate(()=>limit=1);await prepare();await done();check(await page.evaluate(()=>calls.length===0&&manifests.length===0),'Free refuses batch without writing');
 check((await page.locator('[data-status]').textContent()).includes('Starter'),'plan limit guidance');
 await page.evaluate(()=>limit=10);await prepare();await done();
 check(await page.evaluate(()=>calls.length===1&&calls[0].body.instanceId==='inst_col_1'&&calls[0].body.priceSource==='comp'),'eligible selection uses physical ID and comp provenance');
 check(await page.locator('.collection-draft-check:checked').count()===1,'successful cards deselect; incomplete card retained');
 check((await page.locator('.collection-draft-result').allTextContents()).some(s=>s.includes('Add a card number.')),'ineligible reason visible');
 await page.getByRole('button',{name:'Open draft',exact:true}).click();check(await page.evaluate(()=>opened.length===1),'open action does not trigger card row');
 await page.getByRole('button',{name:'Clear selection',exact:true}).click();await page.locator('.collection-draft-check').nth(1).check();
 await page.evaluate(()=>mode='network');await prepare();await done();check((await page.locator('.collection-draft-result').nth(1).textContent()).includes('could not be confirmed'),'lost response is uncertain');
 const original=await page.evaluate(()=>JSON.stringify(calls.at(-1)));
 await page.evaluate(()=>{data[1].currentValue=999;_crDraftState.inst_col_2={generation:4};mode='malformed'});await prepare();await done();
 check(await page.evaluate(()=>JSON.stringify(calls.at(-1)))===original,'retry preserves key generation and original price');
 check(await page.locator('.collection-draft-check:checked').count()===1,'malformed success remains selected');
 await page.evaluate(()=>mode='existing');await prepare();await done();check(await page.evaluate(()=>JSON.stringify(calls.at(-1)))===original,'malformed success preserves recovery payload');
 check((await page.locator('.collection-draft-result').nth(1).textContent()).includes('recovered'),'recovered draft distinguished from created');
 check(await page.evaluate(()=>data.length===3),'draft preparation preserves collection');
 await page.evaluate(()=>{data[2].ineligible=false;mode='cap'});await select();await prepare();await done();
 check((await page.locator('.collection-draft-result').allTextContents()).some(s=>s.includes('Not attempted')),'capacity stops later requests');
 await page.getByRole('button',{name:'Clear selection',exact:true}).click();await page.locator('.collection-draft-check').first().check();await page.evaluate(()=>deferHead=true);await prepare();await page.waitForFunction(()=>!!window.finishHead);
 const before=await page.evaluate(()=>calls.length);await page.evaluate(()=>{googleUser={sub:'new-owner'};finishHead()});await done();check(await page.evaluate(()=>calls.length)===before,'account change aborts before writes');check(await page.locator('.collection-draft-check:checked').count()===0,'selection scoped to account');
 await page.evaluate(()=>{deferHead=false;seed([{id:4,card:'Duplicate',buyPrice:1},{id:'4',card:'Other',buyPrice:1}])});check(await page.locator('.collection-draft-check:disabled').count()===2,'ambiguous identifiers refused');
 await page.evaluate(()=>seed([{id:'5" onmouseover="window.pwned=1',card:'Quote " card',buyPrice:1}]));check(await page.locator('#collectionWrap [onmouseover]').count()===0,'row ID cannot escape attributes');
 const bounds=await page.locator('#collectionDraftTools').boundingBox();check(bounds.x>=0&&bounds.x+bounds.width<=width+1,'toolbar fits viewport');
 check(errors.length===0,errors.join('\n'));await page.close();
}console.log(`Collection drafts browser: ${checks} checks passed. -- SUITE COMPLETE, exit=0`)}finally{await browser.close();await new Promise(r=>server.close(r))}
