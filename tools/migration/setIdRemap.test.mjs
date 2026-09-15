/* Tests for the set-identity migration dry run — work-order item 4.
 * Run: node tools/migration/setIdRemap.test.mjs */
import assert from 'node:assert/strict';
import * as M from './setIdRemap.mjs';

let pass=0, fail=0;
const t=(n,f)=>{try{f();console.log(`  ok   ${n}`);pass++;}catch(e){console.log(`  FAIL ${n}\n       ${e.message}`);fail++;}};

// Real measured rename pairs from the audit's id-remap-analysis.json.
const renameMap={ sv1:'sv01', sv3pt5:'sv03.5', base6:'lc', hsp:'hgssp', pgo:'swsh10.5' };
const absentSetIds=['deadset1'];
const knownTargetSetIds=new Set([...Object.values(renameMap),'base1','sv02']);
const cardIdToSetId=new Map([['sv1-25','sv01'],['orphan-7','sv02'],['conflict-9','sv02']]);
const opts={renameMap,absentSetIds,knownTargetSetIds,cardIdToSetId};

const rec=(o)=>({game:'pokemon',language:'en',quantity:1,...o});

console.log('mapping outcomes');
t('a renamed set is remapped via the explicit table',()=>{
  const p=M.planMigration([rec({instanceId:'i1',setId:'sv1',number:'25',cardId:'sv1-25'})],opts);
  assert.equal(p.rows[0].outcome,M.OUTCOME.REMAPPED);
  assert.equal(p.rows[0].after.setId,'sv01');
});
t('non-derivable renames work (base6->lc, pgo->swsh10.5)',()=>{
  const p=M.planMigration([rec({instanceId:'i2',setId:'base6',number:'1'}),rec({instanceId:'i3',setId:'pgo',number:'1'})],opts);
  assert.equal(p.rows[0].after.setId,'lc');
  assert.equal(p.rows[1].after.setId,'swsh10.5');
});
t('an already-current set id is left unchanged',()=>{
  const p=M.planMigration([rec({instanceId:'i4',setId:'base1',number:'4'})],opts);
  assert.equal(p.rows[0].outcome,M.OUTCOME.UNCHANGED);
});
t('an absent set is quarantined, not guessed',()=>{
  const p=M.planMigration([rec({instanceId:'i5',setId:'deadset1',number:'1'})],opts);
  assert.equal(p.rows[0].outcome,M.OUTCOME.QUARANTINED);
  assert.equal(p.rows[0].after,null);
});
t('an unmapped set with no evidence is quarantined',()=>{
  const p=M.planMigration([rec({instanceId:'i6',setId:'mystery',number:'1'})],opts);
  assert.equal(p.rows[0].outcome,M.OUTCOME.QUARANTINED);
});
t('a missing setId is quarantined',()=>{
  const p=M.planMigration([rec({instanceId:'i7',setId:null})],opts);
  assert.equal(p.rows[0].outcome,M.OUTCOME.QUARANTINED);
});

console.log('\nresolving ambiguity from stored evidence');
t('an unmapped set is resolved from the stored cardId',()=>{
  const p=M.planMigration([rec({instanceId:'i8',setId:'unknownset',cardId:'orphan-7',number:'3'})],opts);
  assert.equal(p.rows[0].outcome,M.OUTCOME.RESOLVED_BY_EVIDENCE);
  assert.equal(p.rows[0].after.setId,'sv02');
});
t('cardId evidence CONTRADICTING the table quarantines rather than picking one',()=>{
  const p=M.planMigration([rec({instanceId:'i9',setId:'sv1',cardId:'conflict-9',number:'5'})],opts);
  assert.equal(p.rows[0].outcome,M.OUTCOME.QUARANTINED);
  assert.match(p.rows[0].reason,/conflicting evidence/);
});
t('cardId evidence agreeing with the table is recorded as confirmation',()=>{
  const p=M.planMigration([rec({instanceId:'i10',setId:'sv1',cardId:'sv1-25',number:'25'})],opts);
  assert.equal(p.rows[0].outcome,M.OUTCOME.REMAPPED);
  assert.equal(p.rows[0].evidence.confirmedByCardId,'sv1-25');
});

console.log('\nno automatic quantity merging');
t('two records colliding after remap are flagged, never summed',()=>{
  const p=M.planMigration([
    rec({instanceId:'a',setId:'sv1',number:'25',quantity:2}),
    rec({instanceId:'b',setId:'sv01',number:'25',quantity:3}),
  ],opts);
  const coll=p.rows.filter(r=>r.outcome===M.OUTCOME.COLLISION);
  assert.equal(coll.length,2,'both sides of the collision are flagged');
  assert.deepEqual(coll[0].collision.quantities.sort(),[2,3]);
  assert.equal(p.summary.collisions,2);
});
t('collided records are NOT modified by the applier',()=>{
  const recs=[rec({instanceId:'a',setId:'sv1',number:'25',quantity:2}),
              rec({instanceId:'b',setId:'sv01',number:'25',quantity:3})];
  const p=M.planMigration(recs,opts);
  const {records:out,appliedCount}=M.applyPlan(recs,p);
  assert.equal(appliedCount,0);
  assert.equal(out.find(r=>r.instanceId==='a').setId,'sv1','untouched');
});

console.log('\npreservation of instance data');
t('instance id, quantity, purchase history, photos and drafts are preserved',()=>{
  const r=rec({instanceId:'i11',setId:'sv1',number:'25',quantity:4,
    purchaseHistory:[{date:'2026-01-02',price:12.5}],photos:['p1.jpg','p2.jpg'],
    draftIds:['d1'],costBasis:12.5,acquiredAt:'2026-01-02'});
  const p=M.planMigration([r],opts);
  const row=p.rows[0];
  assert.equal(row.preserved.instanceId,'i11');
  assert.equal(row.preserved.quantity,4);
  assert.deepEqual(row.preserved.photos,['p1.jpg','p2.jpg']);
  assert.deepEqual(row.preserved.draftIds,['d1']);
  assert.deepEqual(row.preserved.purchaseHistory,[{date:'2026-01-02',price:12.5}]);
  const {records:out}=M.applyPlan([r],p);
  const after=out[0];
  assert.equal(after.quantity,4,'quantity untouched');
  assert.deepEqual(after.photos,['p1.jpg','p2.jpg'],'photos untouched');
  assert.deepEqual(after.draftIds,['d1'],'draft relationships untouched');
  assert.equal(after.setId,'sv01','only the set identity changed');
});
t('the dry run modifies nothing',()=>{
  const r=rec({instanceId:'i12',setId:'sv1',number:'25'});
  M.planMigration([r],opts);
  assert.equal(r.setId,'sv1','input record untouched by planning');
  assert.equal(r.sku,undefined);
});

console.log('\nrerun safety (idempotence)');
t('applying twice produces the same result as applying once',()=>{
  const recs=[rec({instanceId:'i13',setId:'sv1',number:'25'}),rec({instanceId:'i14',setId:'base6',number:'1'})];
  const p1=M.planMigration(recs,opts);
  const r1=M.applyPlan(recs,p1).records;
  const p2=M.planMigration(r1,opts);
  const r2=M.applyPlan(r1,p2).records;
  assert.deepEqual(r2,r1,'second run is a no-op');
  assert.equal(p2.summary.willModify,0,'nothing left to change');
});
t('a re-plan after apply reports every record as unchanged',()=>{
  const recs=[rec({instanceId:'i15',setId:'sv1',number:'25'})];
  const applied=M.applyPlan(recs,M.planMigration(recs,opts)).records;
  const p=M.planMigration(applied,opts);
  assert.equal(p.rows[0].outcome,M.OUTCOME.UNCHANGED);
});

console.log('\nrollback');
t('rollback restores the exact prior state',()=>{
  const recs=[rec({instanceId:'i16',setId:'sv1',number:'25',quantity:2,photos:['x.jpg']}),
              rec({instanceId:'i17',setId:'hsp',number:'2'})];
  const before=JSON.parse(JSON.stringify(recs));
  const plan=M.planMigration(recs,opts);
  const {records:after,inverse}=M.applyPlan(recs,plan);
  assert.notDeepEqual(after,before);
  const restored=M.rollback(after,inverse);
  const srt=a=>a.map(r=>({...r})).sort((x,y)=>x.instanceId<y.instanceId?-1:1);
  assert.deepEqual(srt(restored),srt(before),'byte-for-byte prior state, including absent fields');
  assert.equal('sku' in restored[0],false,'a record with no sku must not gain one');
});
t('rollback removes the migration stamp it added',()=>{
  const recs=[rec({instanceId:'i18',setId:'sv1',number:'25'})];
  const {records:after,inverse}=M.applyPlan(recs,M.planMigration(recs,opts));
  assert.equal(after[0].migrationVersion,M.MIGRATION_VERSION);
  assert.equal(M.rollback(after,inverse)[0].migrationVersion,undefined);
});
t('rollback is safe when a record has since disappeared',()=>{
  const recs=[rec({instanceId:'i19',setId:'sv1',number:'25'})];
  const {records:after,inverse}=M.applyPlan(recs,M.planMigration(recs,opts));
  assert.doesNotThrow(()=>M.rollback(after.filter(()=>false),inverse));
});

console.log('\nsummary reporting');
t('summary separates will-modify from quarantined and collided',()=>{
  const p=M.planMigration([
    rec({instanceId:'s1',setId:'sv1',number:'25'}),
    rec({instanceId:'s2',setId:'deadset1',number:'1'}),
    rec({instanceId:'s3',setId:'mystery',number:'1'}),
    rec({instanceId:'s4',setId:'base1',number:'4'}),
  ],opts);
  assert.equal(p.summary.willModify,1);
  assert.equal(p.summary.quarantined,2);
  assert.equal(p.summary.total,4);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
