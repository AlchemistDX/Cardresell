import assert from 'node:assert/strict';
import * as W from '../shared/seller-workflow.mjs';
let passed=0;
const check=(name,fn)=>{fn();passed++;console.log('PASS '+name)};
const reject=(fn,code)=>assert.throws(fn,e=>e.message===code);
const seed=()=>W.createSession({id:'batch_1',ownerId:'seller_a',now:100,units:[1,2].map(i=>({
  copyId:'copy_'+i,collectionId:'entry_'+i,instanceId:'inst_scan_copy_'+i,
  card:{name:'Pikachu',game:'pokemon',setName:'Base Set',number:'58',variant:'Normal',language:'en',condition:'NM'},costCents:null}))});
const opts=(s,extra={})=>({ownerId:'seller_a',revision:s.revision,now:101+s.revision,...extra});
const review=(s,copyId='copy_1')=>W.reviewUnit(s,opts(s,{copyId,confirmed:true}));
const start=(s,kind='save',copyId='copy_1',operationId='save_1')=>W.beginOperation(s,opts(s,{kind,copyId,operationId}));
const settle=(s,outcome,receipt)=>W.settleOperation(s,opts(s,{kind:'save',copyId:'copy_1',operationId:'save_1',outcome,receipt}));

check('identical cards keep separate physical-copy identities',()=>{
  const s=seed();assert.equal(s.units.length,2);assert.notEqual(s.units[0].instanceId,s.units[1].instanceId);
});
check('new sessions require explicit review',()=>reject(()=>start(seed()),'WORKFLOW_REVIEW_REQUIRED'));
check('unknown cost stays unknown; explicit zero survives',()=>{
  const s=seed();assert.equal(s.units[0].costCents,null);
  const n=W.reviewUnit(s,opts(s,{copyId:'copy_1',patch:{costCents:0}}));assert.equal(n.units[0].costCents,0);assert.equal(s.units[0].costCents,null);
});
check('draft preparation waits for confirmed collection save',()=>reject(()=>start(review(seed()),'draft','copy_1','draft_1'),'WORKFLOW_SAVE_NOT_CONFIRMED'));
check('prepared operation is a stable, independent snapshot',()=>{
  const s=review(seed()),n=start(s);s.units[0].card.name='Changed';
  assert.equal(n.units[0].operations.save.payload.card.name,'Pikachu');assert.equal(n.revision,2);
  assert.deepEqual(start(n),n);
});
check('different operation ID cannot replace a pending operation',()=>reject(()=>start(start(review(seed())),'save','copy_1','other'),'WORKFLOW_OPERATION_CONFLICT'));
check('editing a submitted payload is refused',()=>{
  const s=start(review(seed()));reject(()=>W.reviewUnit(s,opts(s,{copyId:'copy_1',patch:{card:{name:'Other'}}})),'WORKFLOW_OPERATION_LOCKED');
});
check('lost save response preserves original ID and payload across reload',()=>{
  let s=start(review(seed())),before=structuredClone(s.units[0].operations.save);
  s=settle(s,'uncertain');s=W.restoreSession(W.serializeSession(s),'seller_a');
  s=W.resumeOperation(s,opts(s,{copyId:'copy_1',kind:'save',operationId:'save_1'}));
  assert.deepEqual(s.units[0].operations.save,before);
});
check('uncertain write stops new work on another copy',()=>{
  let s=review(review(seed()),'copy_2');s=settle(start(s),'uncertain');
  reject(()=>start(s,'save','copy_2','save_2'),'WORKFLOW_RECONCILE_REQUIRED');
});
check('save receipt must identify the assigned collection entry',()=>reject(()=>settle(start(review(seed())),'confirmed',{id:'wrong'}),'WORKFLOW_RECEIPT_MISMATCH'));
check('confirmed save unlocks draft with the same physical instance',()=>{
  let s=settle(start(review(seed())),'confirmed',{id:'entry_1'});
  s=start(s,'draft','copy_1','draft_1');const op=s.units[0].operations.draft;
  assert.equal(op.payload.instanceId,'inst_scan_copy_1');assert.equal(op.payload.collectionId,'entry_1');
  s=W.settleOperation(s,opts(s,{kind:'draft',copyId:'copy_1',operationId:'draft_1',outcome:'confirmed',receipt:{id:'drf_'+'a'.repeat(32)}}));
  assert.equal(s.units[0].operations.draft.state,'confirmed');
});
check('malformed successful draft response cannot mark a draft ready',()=>{
  let s=settle(start(review(seed())),'confirmed',{id:'entry_1'});s=start(s,'draft','copy_1','draft_1');
  reject(()=>W.settleOperation(s,opts(s,{kind:'draft',copyId:'copy_1',operationId:'draft_1',outcome:'confirmed',receipt:{id:'yes'}})),'WORKFLOW_RECEIPT_MISMATCH');
});
check('confirmed result replay is harmless; conflicting result is refused',()=>{
  const s=settle(start(review(seed())),'confirmed',{id:'entry_1'});assert.deepEqual(settle(s,'confirmed',{id:'entry_1'}),s);
  reject(()=>settle(s,'uncertain'),'WORKFLOW_TERMINAL_OPERATION');
});
check('definitive block cannot silently retry',()=>{
  const s=settle(start(review(seed())),'blocked');reject(()=>W.resumeOperation(s,opts(s,{kind:'save',copyId:'copy_1',operationId:'save_1'})),'WORKFLOW_TERMINAL_OPERATION');
});
check('account changes and stale revisions fail without mutation',()=>{
  const s=seed(),before=structuredClone(s);
  reject(()=>W.reviewUnit(s,opts(s,{ownerId:'seller_b',copyId:'copy_1'})),'WORKFLOW_ACCOUNT_CHANGED');
  reject(()=>W.reviewUnit(s,opts(s,{revision:1,copyId:'copy_1'})),'WORKFLOW_REVISION_CONFLICT');assert.deepEqual(s,before);
});
check('storage records are account scoped',()=>{
  assert.notEqual(W.sessionStorageKey('seller_a','batch_1'),W.sessionStorageKey('seller_b','batch_1'));
  reject(()=>W.restoreSession(W.serializeSession(seed()),'seller_b'),'WORKFLOW_ACCOUNT_CHANGED');
});
check('corrupt and future records are refused instead of reset',()=>{
  reject(()=>W.restoreSession('{','seller_a'),'WORKFLOW_CORRUPT_RECORD');
  const s=seed();s.version=2;reject(()=>W.restoreSession(JSON.stringify(s),'seller_a'),'WORKFLOW_UNSUPPORTED_VERSION');
});
check('photos, credentials and arbitrary fields cannot enter the journal',()=>{
  for(const key of ['photo','imageBase64','token','email']) {
    const s=seed();s.units[0][key]='private';reject(()=>W.serializeSession(s),'WORKFLOW_INVALID_FIELDS');
  }
  const s=seed();s.units[0].card.imageUrl='data:private';reject(()=>W.serializeSession(s),'WORKFLOW_INVALID_FIELDS');
});
check('duplicate copy, collection and instance IDs are refused',()=>{
  for(const key of ['copyId','collectionId','instanceId']) {const s=seed();s.units[1][key]=s.units[0][key];reject(()=>W.serializeSession(s),'WORKFLOW_DUPLICATE_ID')}
});
check('operation IDs cannot be reused for another copy',()=>{
  const s=start(review(review(seed()),'copy_2'));reject(()=>start(s,'save','copy_2','save_1'),'WORKFLOW_DUPLICATE_OPERATION');
});
check('changed recovery payload is refused',()=>{
  const s=start(review(seed()));s.units[0].operations.save.payload.card.number='99';reject(()=>W.serializeSession(s),'WORKFLOW_PAYLOAD_MISMATCH');
});
check('size, cost and clock limits are explicit',()=>{
  const s=seed();s.units=Array(501).fill(s.units[0]);reject(()=>W.serializeSession(s),'WORKFLOW_INVALID_SIZE');
  reject(()=>W.allocateCostCents(-1,2),'WORKFLOW_INVALID_COST');reject(()=>W.allocateCostCents(1.5,2),'WORKFLOW_INVALID_COST');
  reject(()=>W.reviewUnit(seed(),{ownerId:'seller_a',revision:0,now:99,copyId:'copy_1'}),'WORKFLOW_INVALID_TIME');
});
check('cost split conserves every cent across uneven quantities',()=>{
  for(const total of [0,1,2,100,10001,999999])for(const n of [1,2,3,7,500]){
    const parts=W.allocateCostCents(total,n);assert.equal(parts.reduce((a,b)=>a+b,0),total);
    assert.ok(parts.every(Number.isSafeInteger));assert.ok(Math.max(...parts)-Math.min(...parts)<=1);
  }
  assert.deepEqual(W.allocateCostCents(null,3),[null,null,null]);
});
console.log(`seller-workflow: ${passed} scenarios passed, 0 failed -- SUITE COMPLETE, exit=0`);
