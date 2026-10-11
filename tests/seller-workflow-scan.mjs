import assert from 'node:assert/strict';
import {captureScanSelection, prepareScanSession, plannedScanActions} from '../shared/seller-workflow-scan.mjs';
import {reviewUnit, beginOperation} from '../shared/seller-workflow.mjs';
let passed=0;
const test=async(name,run)=>{await run();passed++;console.log('PASS '+name)};
const reject=(run,code)=>assert.throws(run,e=>e.message===code);
const row=()=>({success:true,qty:2,copyUids:['copy_a','copy_b','parked'],
  cardName:'Pikachu',game:'pokemon',set:'Base',number:'58',condition:'',
  imageDataUrl:'data:image/private',token:'never-store'});
const capture=(rows=[row()],extra={})=>captureScanSelection({rows,copyUids:r=>r.copyUids,
  rowToCard:r=>({card:r.cardName,game:r.game,set:r.set,number:r.number,condition:r.condition,
    img:r.imageDataUrl,token:r.token}),...extra});
let record=null,minted=0;
const store={ownerId:'owner',async initialize(id,build,verify){if(record)verify(record);else record=build();return structuredClone(record)}};
const prepare=(extra={})=>prepareScanSession({store,sessionId:'batch',selection:capture(),newCollectionId:()=> 'entry_'+(++minted),now:1,...extra});

await test('active physical copies preserve existing draft IDs; parked copies excluded',()=>{
  const s=capture();assert.equal(s.length,2);assert.equal(s[0].instanceId,'inst_scan_copy_a');assert.notEqual(s[0].copyId,s[1].copyId);
});
await test('unknown cost, condition, finish and language are not defaulted',()=>{
  const s=capture()[0];assert.equal(s.costCents,null);assert.equal(s.card.condition,'');assert.equal(s.card.variant,'');assert.equal(s.card.language,'');
});
await test('explicit zero and integer cents survive',()=>assert.deepEqual(capture(undefined,{costsByCopy:{copy_a:0,copy_b:117}}).map(u=>u.costCents),[0,117]));
await test('metadata excludes photos, URL, auth and arbitrary row fields',()=>{
  const s=JSON.stringify(capture());for(const term of ['private','token','data:image','img'])assert.ok(!s.includes(term));
});
await test('unresolved and failed rows cannot quietly disappear',()=>reject(()=>capture([{...row(),success:false}]),'WORKFLOW_SCAN_UNRESOLVED'));
await test('fractional, negative, zero and oversized quantities rejected',()=>{
  for(const qty of [0,-1,1.5,501,'2'])reject(()=>capture([{...row(),qty}]),'WORKFLOW_INVALID_SIZE');
});
await test('aggregate quantity envelope checked before invoking helpers',()=>{
  reject(()=>capture(Array(2).fill({...row(),qty:300}),{copyUids:()=>{throw Error('should not run')}}),'WORKFLOW_INVALID_SIZE');
});
await test('missing copy IDs cannot produce a partial batch',()=>reject(()=>capture([{...row(),qty:4}]),'WORKFLOW_MISSING_COPY_ID'));
await test('duplicate physical IDs are refused across rows',()=>reject(()=>capture([row(),row()]),'WORKFLOW_DUPLICATE_ID'));
await test('negative/fractional/unsafe costs refused',()=>{
  for(const value of [-1,0.1,Number.MAX_SAFE_INTEGER+1])reject(()=>capture(undefined,{costsByCopy:{copy_a:value}}),'WORKFLOW_INVALID_COST');
});
await test('cost for an unselected copy cannot silently go missing',()=>reject(()=>capture(undefined,{costsByCopy:{parked:100}}),'WORKFLOW_COST_COPY_MISMATCH'));
await test('review vocabulary preserves explicit language/finish',()=>{
  const s=capture(undefined,{rowToCard:r=>({card:r.cardName,game:r.game,language:'ja',variant:'reverse holo'})});assert.equal(s[0].card.language,'ja');assert.equal(s[0].card.variant,'reverse holo');
});
await test('scan price-source labels are not mistaken for card finishes',()=>assert.equal(capture([{...row(),variant:'tcgplayer_live'}])[0].card.variant,''));
await test('first preparation allocates each Collection identity once',async()=>{
  const s=await prepare();assert.equal(minted,2);assert.equal(s.units[0].collectionId,'entry_1');assert.equal(s.units[0].review,'pending');
});
await test('retry and reordered selection recover original mapping without minting',async()=>{
  const s=await prepare({selection:capture().reverse()});assert.equal(minted,2);assert.deepEqual(s,record);
});
await test('changed quantity, identity or cost requires explicit new review',async()=>{
  const different=[capture().slice(0,1),capture().map(u=>({...u,card:{...u.card,name:'Other'}})),capture().map(u=>({...u,costCents:9}))];
  for(const selection of different)await assert.rejects(()=>prepare({selection}),/WORKFLOW_SELECTION_CHANGED/);
  assert.equal(minted,2);
});
await test('preparation captures a snapshot before an async storage boundary',async()=>{
  const selection=capture();let resolve;
  const delayed={ownerId:'owner',initialize:(_,build)=>new Promise(r=>{resolve=()=>r(build())})};
  const pending=prepare({store:delayed,selection});selection[0].card.name='Changed';resolve();assert.equal((await pending).units[0].card.name,'Pikachu');
});
await test('preview reflects journal review and pending operation without mutations',()=>{
  let s=reviewUnit(record,{ownerId:'owner',revision:0,now:2,copyId:'copy_a',confirmed:true});
  s=beginOperation(s,{ownerId:'owner',revision:1,now:3,copyId:'copy_a',kind:'save',operationId:'save_a'});
  const before=structuredClone(s),preview=plannedScanActions(s);assert.equal(preview[0].requiresReview,false);assert.equal(preview[0].saveState,'pending');assert.equal(preview[1].requiresReview,true);assert.deepEqual(s,before);
});
await test('invalid recovered metadata cannot become a preview',()=>{
  reject(()=>plannedScanActions({...record,version:99}),'WORKFLOW_UNSUPPORTED_VERSION');
});
console.log(`seller-workflow-scan: ${passed} scenarios passed -- SUITE COMPLETE, exit=0`);
