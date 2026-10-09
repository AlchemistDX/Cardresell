import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {redisCommand as redis,redisRest} from './_idRedis.mjs';
process.env.KV_REST_API_URL='https://draft-fixture.upstash.io';process.env.KV_REST_API_TOKEN='synthetic';
globalThis.fetch=redisRest;
const {createDraft,deleteDraftOp,updateDraft,readDraft,listDraftSummaries}=await import('../api/_draftService.js');
const {draftPlanPolicy}=await import('../api/_draftPlanPolicy.js');
const {capacityKeys,ensureDraftCapacity,draftCapacityUsage,capacityFencedWrite}=await import('../api/_draftCapacity.js');
const {prepareDraftBulk,validateDraftBulk}=await import('../api/_draftBulk.js');
const {buildDraft,draftKey}=await import('../api/_draftStore.js');
const kv=(...args)=>redis(args);let checks=0;
const check=(v,message)=>{assert.ok(v,message);checks++;};
const input=i=>({sku:'v2-XXX7473-592a391e7b472559',instanceId:'inst_'+i,slot:'ebay:fixed-price',title:'Card '+i,price:1});
const id=i=>'drf_'+i.toString(16).padStart(32,'0');
async function seed(owner,n){
 for(let i=0;i<n;i++)await kv('SET',draftKey(owner,id(i)),JSON.stringify(buildDraft({...input(i),draftId:id(i),rev:1})));
}
for(const [plan,limit] of Object.entries({free:5,starter:25,casual:100,pro:500,business:2000})){
 await kv('FLUSHDB');const policy=draftPlanPolicy(plan),owner='owner_'+plan;
 check(policy.activeLimit===limit,plan+' policy');await seed(owner,limit-1);
 const results=await Promise.allSettled(Array.from({length:20},(_,i)=>createDraft(kv,owner,input('race'+i),randomUUID(),{capacity:policy})));
 const wins=results.filter(r=>r.status==='fulfilled'&&r.value.result?.saved);
 check(wins.length===1,plan+' exactly one concurrent winner');
 check((await draftCapacityUsage(kv,owner,policy)).active===limit,plan+' exact cap');
 check(results.filter(r=>r.status==='rejected'&&r.reason.message==='DRAFT_CAP_REACHED').length===19,plan+' rest refused');
 const record=wins[0].value.result.draft;
 check((await readDraft(kv,owner,record.draftId)).ok,plan+' saved record readable');
}
// 2,000 records retain full pagination; no hardcoded 500 result ceiling.
const listed=await listDraftSummaries(kv,'owner_business',{limit:100,cursor:1900});
check(listed.total===2000 && listed.rows.length===100 && listed.nextCursor===null,'Business final page');
await kv('FLUSHDB');const owner='replay',policy=draftPlanPolicy('free'),key=randomUUID(),payload=input('original');
const first=await createDraft(kv,owner,payload,key,{capacity:policy});
for(let i=0;i<4;i++)await createDraft(kv,owner,input(i),randomUUID(),{capacity:policy});
const replay=await createDraft(kv,owner,payload,key,{capacity:()=>{throw Error('must not resolve authority on replay')}});
check(replay.result.draftId===first.result.draftId,'saved create replays at cap before admission');
// Simulate downgrade from a larger plan: keep all content and permit edit/delete.
const high=draftPlanPolicy('casual');await createDraft(kv,owner,input('six'),randomUUID(),{capacity:high});
check((await draftCapacityUsage(kv,owner,policy)).overLimit,'downgrade over-cap visible');
const edited=await updateDraft(kv,owner,first.result.draftId,{notes:'Keep my work'},1,randomUUID());
check(edited.ok&&edited.draft.notes==='Keep my work','over-cap edit works');
const gone=await deleteDraftOp(kv,owner,first.result.draftId,2,randomUUID());check(gone.ok,'over-cap delete works');
check((await draftCapacityUsage(kv,owner,policy)).active===5,'delete releases capacity');
const ids=await kv('SMEMBERS',capacityKeys(owner).set);const next=JSON.parse(await kv('GET',draftKey(owner,ids[0])));
await deleteDraftOp(kv,owner,next.draftId,next.rev,randomUUID());
check((await createDraft(kv,owner,input('replacement'),randomUUID(),{capacity:policy})).result.saved,'freed slot reusable');
// Lost write response: authoritative record and capacity both commit. Reuse key recovers.
await kv('FLUSHDB');let lost=false;const faultKv=async(...args)=>{const out=await kv(...args);
 if(!lost&&String(args[0]).toLowerCase()==='eval'&&String(args[1]).includes("local expected=redis.call('GET',KEYS[4])")){lost=true;throw Error('lost response');}return out;};
const lostKey=randomUUID();await createDraft(faultKv,'lost',input('lost'),lostKey,{capacity:policy}).catch(()=>{});
const recovered=await createDraft(kv,'lost',input('lost'),lostKey,{capacity:policy});
check(recovered.result.saved && (await draftCapacityUsage(kv,'lost',policy)).active===1,'lost response recovers single stored draft');
// Storage failure does not create a record; no fail-open admission.
await kv('FLUSHDB');await assert.rejects(()=>createDraft(kv,'down',input('down'),randomUUID(),{capacity:async()=>{throw Error('DRAFT_MEMBERSHIP_UNAVAILABLE')}}));
check((await kv('KEYS','draft:down:*')).length===0,'authority outage saves nothing');
await assert.rejects(()=>ensureDraftCapacity(async(...args)=>String(args[0]).toUpperCase()==='SCAN'?['0','bad']:null,'bad'));
checks++;
await seed('evicted',1);await ensureDraftCapacity(kv,'evicted');await kv('DEL',capacityKeys('evicted').set);
await assert.rejects(()=>draftCapacityUsage(kv,'evicted',policy));checks++;
// Old deleted records do not consume capacity; incomplete/corrupt baseline refuses.
await kv('FLUSHDB');await seed('old',2);const old=JSON.parse(await kv('GET',draftKey('old',id(1))));old.status='deleted';await kv('SET',draftKey('old',id(1)),JSON.stringify(old));
check((await draftCapacityUsage(kv,'old',policy)).active===1,'bootstrap excludes deleted records');
await kv('SET',draftKey('corrupt',id(1)),'broken');await assert.rejects(()=>draftCapacityUsage(kv,'corrupt',policy));checks++;
// Bulk manifests bind the authenticated owner, selection and idempotency identities.
const rows=Array.from({length:10},(_,i)=>({instanceId:'inst_'+i,idemKey:randomUUID()}));const body={id:randomUUID(),rows};
await assert.rejects(()=>prepareDraftBulk(kv,'bulk',body,policy),/DRAFT_BATCH_LIMIT/);checks++;
check((await prepareDraftBulk(kv,'bulk',body,draftPlanPolicy('starter'))).count===10,'Starter batch accepted');
await validateDraftBulk(kv,'bulk',body.id,rows[0].instanceId,rows[0].idemKey,draftPlanPolicy('starter'));checks++;
await assert.rejects(()=>validateDraftBulk(kv,'other',body.id,rows[0].instanceId,rows[0].idemKey,draftPlanPolicy('starter')));checks++;
await assert.rejects(()=>prepareDraftBulk(kv,'bulk',{...body,rows:rows.slice(1)},draftPlanPolicy('starter')),/MISMATCH/);checks++;
await assert.rejects(()=>validateDraftBulk(kv,'bulk',body.id,rows[0].instanceId,rows[0].idemKey,policy),/LIMIT/);checks++;
for(const plan of ['starter','casual','pro','business']){
 const p=draftPlanPolicy(plan),r=Array.from({length:p.bulkLimit},(_,i)=>({instanceId:'sel_'+i,idemKey:randomUUID()}));
 check((await prepareDraftBulk(kv,plan,{id:randomUUID(),rows:r},p)).count===p.bulkLimit,plan+' maximum bulk');
 await assert.rejects(()=>prepareDraftBulk(kv,plan,{id:randomUUID(),rows:[...r,{instanceId:'extra',idemKey:randomUUID()}]},p));checks++;
}

// Real membership resolution and HTTP boundary: the body cannot choose capacity.
const {resolveDraftPlan}=await import('../api/_draftPlanPolicy.js');
const {membershipEnrollmentKey}=await import('../api/_membershipConsumption.js');
const {grantMembership}=await import('../api/_membershipLedger.js');
const {MEMBERSHIP_LEGACY_FENCE}=await import('../api/_membershipLegacyFence.js');
const handler=(await import('../api/drafts.js')).default;
process.env.MEMBERSHIP_BILLING_V2='on';
const now=Number((await kv('TIME'))[0]);
for(const [plan,cents] of Object.entries({starter:499,casual:999,pro:1999,business:4999})){
 await kv('FLUSHDB');await kv('SET',MEMBERSHIP_LEGACY_FENCE,'1');
 await kv('SET',membershipEnrollmentKey('member'),JSON.stringify({version:'launch-v2',owner:'member',verified:true,plan:'paid',subscription:'sub_fixture'}));
 await grantMembership(redis,'period',{owner:'member',invoiceId:'in_'+plan,subscriptionId:'sub_fixture',plan,periodStart:now-100,periodEnd:now+1000,currency:'usd',amountCents:cents,paid:true});
 check((await resolveDraftPlan('member')).activeLimit===draftPlanPolicy(plan).activeLimit,plan+' paid ledger authority');
}
await kv('FLUSHDB');await kv('SET',MEMBERSHIP_LEGACY_FENCE,'1');
await kv('SET',membershipEnrollmentKey('member'),JSON.stringify({version:'launch-v2',owner:'member',verified:true,plan:'free',freeThrough:0,capabilities:{bulkGrade:false}}));
await kv('SET','uid_by_email:seller@example.com','member');
globalThis.fetch=async(url,opts)=>String(url).includes('oauth2.googleapis.com/tokeninfo')
 ? Response.json({aud:'971593505703-6feq3nn7p9580krori6r157rfm5tp88l.apps.googleusercontent.com',email:'seller@example.com',sub:'google-sub'})
 : String(url).includes('googleapis.com') ? new Response('',{status:500}) : redisRest(url,opts);
const call=async(method,body={},query={},key=randomUUID())=>{
 const res={code:0,setHeader(){},status(n){this.code=n;return this},json(body){this.body=body;return this}};
 await handler({method,body,query,headers:{authorization:'Bearer '+'x'.repeat(40),'idempotency-key':key}},res);return res;
};
const httpBody=i=>({card:{game:'pokemon',set_name:'Champions Path',card_number:'074/073',card_name:'Charizard VMAX',language:'en'},instanceId:'http_'+i,slot:'ebay:fixed-price',price:1,plan:'business',activeLimit:2000});
let saved,key0,body0;
for(let i=0;i<5;i++){const b=httpBody(i),k=randomUUID(),r=await call('POST',b,{},k);check(r.code===201,'HTTP Free creation '+i);if(!i){saved=r.body.draftId;key0=k;body0=b;}}
const deniedKey=randomUUID();
const blocked=await call('POST',httpBody(6),{},deniedKey);check(blocked.code===409&&blocked.body.cap===5,'HTTP ignores forged Business tier/cap');
const usage=await call('GET');check(usage.code===200&&usage.body.usage.active===5&&usage.body.cap===5,'HTTP usage is authoritative');
const deniedBulk=await call('POST',{id:randomUUID(),rows:[{instanceId:'http_new',idemKey:randomUUID()}]},{action:'batch'});check(deniedBulk.code===403,'HTTP Free bulk gated');

const delId=(await call('GET')).body.rows.find(r=>r.draftId!==saved).draftId;
const delRecord=(await call('GET',{}, {id:delId})).body.draft;
check((await call('DELETE',{expectedRev:delRecord.rev},{id:delId})).code===200,'HTTP delete frees slot');
check((await call('POST',httpBody(6),{},deniedKey)).code===201,'same refused operation succeeds after freeing capacity');

await kv('DEL',membershipEnrollmentKey('member'));
check((await call('GET',{}, {id:saved})).code===200,'billing outage preserves existing read');
check((await call('POST',body0,{},key0)).code===200,'HTTP completed retry survives authority outage');
check((await call('POST',httpBody(7))).code===503,'HTTP new creation fails closed during authority outage');

console.log(`draft-plan-capacity: ${checks} passed`);
process.exit(0);
