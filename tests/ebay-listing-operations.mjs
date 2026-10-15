import assert from 'node:assert/strict';
import {completionGuard} from './_complete.mjs';
import {fixture,kv,env,reference,photoHost} from './_ebayOperationFixture.mjs';
import {createHandler} from '../api/ebay-listing-operations.js';
import {listingIndex,listingKey,saveListingScript,parseListing,publicListing} from '../api/_ebayOperations.js';
import {parseFees,inventoryApi,fingerprint} from '../api/_ebayInventoryApi.js';
import {hash,seal} from '../api/_ebaySeller.js';
import {deleteSellerData} from '../api/_ebayDeletion.js';
const {finish}=completionGuard('ebay-listing-operations');let checks=0;
const check=(value,message)=>{assert.ok(value,message);checks++;};
const f=await fixture();const saved=async()=>JSON.parse(await kv('GET',f.key)||'null');
let r=await f.call('plan');check(r.code===200,JSON.stringify(r));
check(r.data.record.state==='planned'&&r.data.record.held,'plan reserves exactly one copy');
check(f.state.writes.length===0,'saving a plan sends no listing write');
check(Number(await kv('TTL',f.key))===-1,'reservation does not expire with a request, review or session');
check((await f.call('plan')).code===409,'second plan for the same physical copy refused');
check((await f.call('cancel',{expectedRev:999})).code===409,'stale cancellation cannot release a newer plan');
check((await f.call('cancel',{confirmed:false})).code===400,'explicit cancellation confirmation required');
r=await f.call('cancel');check(r.code===200&&r.data.record.state==='cancelled'&&!r.data.record.held,'unsent plan may release its reservation');
check((await f.call('plan')).code===200,'new reviewed plan can replace only cancelled work');
check((await f.call(null,{who:null})).code===401,'anonymous operation reads refused');
check((await f.call(null,{who:'another-owner'})).code===404,'another owner cannot access the draft or reservation');
check((await f.call('cancel',{origin:'https://wrong.example'})).code===403,'cross-origin mutations refused');
check((await f.call(null,{method:'DELETE'})).code===405,'no deletion endpoint can free a potentially live copy');
check((await f.call('publish',{handler:f.off})).code===503,'deployed handler cannot publish');
const flagHandler=createHandler({env:{...env,EBAY_SELLER_PUBLISH_ENABLED:'true',EBAY_LISTING_WRITES_ENABLED:'true'},verify:async uid=>({uid}),store:kv,fetcher:f.fetcher,photoHost,referenceLoader:async()=>reference});
check((await f.call('prepare',{handler:flagHandler})).code===503,'environment flags cannot enable unfinished live authorization');
check((await f.call(null)).data.executionEnabled===false,'GET never advertises live execution');

await f.reset();await f.call('plan');
const noWrite={...f.connection,cipher:seal({accessToken:'READONLY',accessExpiresAt:Date.now()+3600000,refreshExpiresAt:Date.now()+86400000},f.cfg,hash(f.uid))};await kv('SET',f.k.connection,JSON.stringify(noWrite));
check((await f.call('prepare')).code===409&&f.state.writes.length===0,'read-only connection cannot become write-authorized');
await kv('SET',f.k.connection,JSON.stringify(f.connection));
check((await f.call('prepare',{confirmed:false})).code===400,'each provider mutation requires explicit action confirmation');
r=await f.call('prepare');check(r.code===200&&r.data.record.state==='inventory_saved',JSON.stringify(r.data));
check(f.state.writes.length===1&&f.state.writes[0].method==='PUT','first preparation writes only the physical inventory record');
check((await f.call('cancel')).code===409,'inventory write prevents unsent-plan cancellation');
r=await f.call('prepare');check(r.code===200&&r.data.record.state==='offer_saved','second preparation maps one unpublished offer');
check(r.data.record.offerId==='offer-fixture'&&!r.data.record.listingId,'offer and listing identities stay distinct');
check((await f.call('publish')).code===409,'publication without a fee estimate is refused');
r=await f.call('fees');check(r.code===200&&r.data.record.fees.rows[0].amount==='0.35','fees fetched for the exact mapped unpublished offer');
check(f.state.writes.length===2,'fee lookup does not publish');
let feeFingerprint=r.data.record.fees.fingerprint;f.state.fee='0.40';
check((await f.call('publish',{feeFingerprint})).code===409&&f.state.writes.length===2,'changed fees invalidate publication approval');
r=await f.call('fees');feeFingerprint=r.data.record.fees.fingerprint;
check((await f.call('publish',{feeFingerprint:'old'})).code===409,'different fee fingerprint refused');
r=await f.call('publish',{feeFingerprint});check(r.code===200&&r.data.record.state==='live'&&r.data.record.listingId==='listing-fixture','publication confirmed through provider read');
const liveRev=r.data.record.rev;r=await f.call('price',{newPrice:'17.25'});check(r.code===200&&r.data.record.price==='17.25','price edit confirms exact USD value');
const priceBody=f.state.writes.at(-1).body;check(!JSON.stringify(priceBody).includes('Quantity')&&Object.keys(priceBody.requests[0]).join(',')==='sku,offers','price-only update cannot replenish inventory');
check((await f.call('price',{newPrice:'18.00',expectedRev:liveRev})).code===409,'stale tab cannot reprice over a later price');
const before=f.state.writes.length;check((await f.call('price',{newPrice:'17.25'})).code===200&&f.state.writes.length===before,'same-price request is a safe no-op');
check((await f.call('price',{newPrice:'1.234'})).code===400,'fractional cents rejected');
f.state.offer.listing.soldQuantity=1;check((await f.call('price',{newPrice:'19.00'})).code===409,'a sold copy cannot be repriced or replenished');f.state.offer.listing.soldQuantity=0;
r=await f.call('end');check(r.code===200&&r.data.record.state==='ended'&&r.data.record.held,'withdraw confirms ended offer but does not mark copy available');
check(f.state.writes.at(-1).path.endsWith('/withdraw')&&!f.state.writes.some(w=>w.method==='DELETE'),'end uses withdraw, never deletes offer mapping');
check((await saved()).history.some(h=>h.kind==='price'&&h.approval?.price==='17.25')&&(await saved()).history.some(h=>h.kind==='publish'&&h.approval?.feeFingerprint===feeFingerprint),'completed operation retains the exact price/fee approval evidence');
check((await f.call('prepare')).code===409,'ended offer cannot silently relist');
check((await f.call('plan')).code===409,'ended physical copy cannot acquire a second plan');

// A response lost after the provider applies a mutation is recovered by reads.
for(const kind of ['inventory','offer','publish','price','end']) {
 await f.reset();await f.call('plan');
 if(kind!=='inventory')await f.call('prepare');
 if(!['inventory','offer'].includes(kind))await f.call('prepare');
 let fee;
 if(['publish','price','end'].includes(kind)){const q=await f.call('fees');fee=q.data.record.fees.fingerprint;}
 if(['price','end'].includes(kind))await f.call('publish',{feeFingerprint:fee});
 f.state.after=async()=>{throw Error('lost provider acknowledgement');};
 const action=['inventory','offer'].includes(kind)?'prepare':kind;
 r=await f.call(action,{feeFingerprint:fee,newPrice:'22.00'});check(r.code===502&&(await saved()).state==='pending',kind+' lost acknowledgement stays pending');
 const writes=f.state.writes.length;check((await f.call(action,{feeFingerprint:fee,newPrice:'22.00'})).code===409&&f.state.writes.length===writes,kind+' is never blindly resent');
 f.state.after=null;r=await f.call('recover');check(r.code===200&&r.data.record.state!=='pending'&&f.state.writes.length===writes,kind+' recovered without provider writes');
}

// A negative read is not proof that an earlier write cannot still arrive.
await f.reset();await f.call('plan');let release=null;
f.state.before=async()=>new Promise(r=>release=r);
const delayed=f.call('prepare');for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,5));check(!!release,'write is paused after the durable journal');
check((await saved()).state==='pending','journal persisted before request');
r=await f.call('recover');check(r.code===200&&r.data.record.state==='pending','not found read keeps a late request held');
check((await f.call('prepare')).code===409&&(await f.call('cancel')).code===409,'late request blocks both duplicate sends and cancellation');
release();r=await delayed;check(r.code===200&&f.state.writes.length===1,'original delayed request remains the only writer');f.state.before=null;

await f.reset();await f.call('plan');f.state.before=async()=>{throw Error('failed before provider effect');};
await f.call('prepare');f.state.before=null;r=await f.call('recover');check(r.data.record.state==='pending','absence after a transport error is held, not replayed');
const oldRaw=await kv('GET',f.key);await kv('SET',f.dk,JSON.stringify({...f.draft,status:'deleted',rev:2}));
r=await f.call('recover',{id:hash(f.draft.instanceId)});check(r.code===200&&r.data.record.held&&await kv('GET',f.key)===oldRaw,'deleted draft cannot free copy; recovery works by permanent operation ID');

await f.reset();await f.call('plan');await f.call('prepare');f.state.after=async()=>{throw Error('lost');};await f.call('prepare');f.state.after=null;
f.state.extraOffers=[{...f.state.offer,offerId:'unexpected-second'}];r=await f.call('recover');check(r.data.record.state==='pending','multiple offers cannot be guessed into one mapping');f.state.extraOffers=[];
f.state.offer.pricingSummary.price.value='99.00';r=await f.call('recover');check(r.data.record.state==='pending','different offer payload is not adopted');f.state.offer.pricingSummary.price.value='12.50';
f.state.failRead=true;check((await f.call('recover')).code===503&&(await saved()).state==='pending','unavailable provider reads preserve reservation');f.state.failRead=false;
await kv('DEL',f.k.connection);check((await f.call('recover')).code===409&&(await saved()).state==='pending','expired or disconnected account cannot free a pending copy');
await kv('SET',f.k.connection,JSON.stringify({...f.connection,version:'reconnected'}));r=await f.call('recover');check(r.data.record.state==='offer_saved','same seller may recover after reconnecting');
await kv('SET',f.k.connection,JSON.stringify({...f.connection,accountHash:hash('different-seller')}));r=await f.call(null);check(r.data.records[0].state==='account_changed'&&!r.data.records[0].offerId&&!r.data.records[0].price,'replacement account cannot see or reuse former seller mapping');
check((await f.call('recover')).code===409,'replacement account cannot recover another seller offer');

// CAS guards: a save acknowledgement can be lost; a later GET is authoritative.
await f.reset();let loseSave=true;
const uncertainStore=async(...args)=>{const value=await kv(...args);if(loseSave&&args[0]==='EVAL'&&args[1]===saveListingScript){loseSave=false;throw Error('lost Redis acknowledgement');}return value;};
const uncertain=createHandler({env,verify:async uid=>({uid}),store:uncertainStore,fetcher:f.fetcher,photoHost,referenceLoader:async()=>reference,executionEnabled:true});
check((await f.call('plan',{handler:uncertain})).code===503&&(await saved()).state==='planned','lost plan save acknowledgement remains recoverable');
check((await f.call(null)).data.records[0].state==='planned','GET recovers saved plan');
loseSave=true;check((await f.call('prepare',{handler:uncertain})).code===503&&(await saved()).state==='pending'&&f.state.writes.length===0,'lost dispatch-save acknowledgement never sends provider request');

await f.reset();const race=createHandler({env,verify:async uid=>({uid}),store:kv,fetcher:f.fetcher,photoHost,referenceLoader:async()=>{await kv('SET',f.dk,JSON.stringify({...f.draft,rev:2}));return reference;}});
check((await f.call('plan',{handler:race})).code===409&&!await saved(),'draft revision race blocks reservation atomically');
await f.reset();await kv('SET',f.rk,JSON.stringify({...f.review,report:{...f.review.report,expiresAt:Date.now()-1}}));
check((await f.call('plan')).code===409&&!await saved(),'expired review cannot reserve a new plan');
await f.reset();const missingPhoto=createHandler({env,verify:async uid=>({uid}),store:kv,fetcher:f.fetcher,photoHost:{...photoHost,head:async()=>({exists:false})},referenceLoader:async()=>reference});
check((await f.call('plan',{handler:missingPhoto})).code===409&&!await saved(),'photos are checked again when the plan is saved');
await f.reset();await f.call('plan');await kv('SET',f.dk,JSON.stringify({...f.draft,rev:2}));
check((await f.call('prepare')).code===409&&!f.state.writes.length,'changed draft cannot send the previously reviewed payload');
await f.reset();await f.call('plan');f.state.item={sku:f.review.report.sku,product:{title:'Already in use'}};
check((await f.call('prepare')).code===409&&!f.state.writes.length,'existing inventory is never overwritten during first preparation');
await f.reset();await f.call('plan');const concurrent=await Promise.all([f.call('prepare'),f.call('prepare')]);
check(concurrent.filter(r=>r.code===200).length===1&&concurrent.filter(r=>r.code===409).length===1&&f.state.writes.length===1,'two concurrent tabs have one journal winner and one provider write');
await f.reset();await f.call('plan');await kv('DEL',f.k.connection);
check((await f.call(null)).data.records[0].canCancel===true,'disconnected account may still see unsent cancellation option');
check((await f.call('cancel')).code===200,'owner can cancel an unsent plan after disconnect');
await f.reset();await kv('SET',listingIndex('production',f.uid),'broken-index');
check((await f.call('plan')).code===409&&!await saved(),'damaged index cannot create an orphan reservation');
await f.reset();await f.call('plan');let record=await saved();await kv('SET',f.key,JSON.stringify({...record,version:9}));
check((await f.call('plan')).code===409&&(await saved()).version===9,'future journal schema preserved and held');
await kv('SET',f.key,JSON.stringify({...record,payload:{...record.payload,sku:'tampered'}}));check((await f.call('recover')).code===409,'payload hash mismatch fails closed');

await f.reset();await f.call('plan');await f.call('prepare');await f.call('prepare');
await deleteSellerData({metadata:{topic:'MARKETPLACE_ACCOUNT_DELETION'},notification:{data:{userId:'seller-'+f.uid}}},kv);
record=await saved();check(record.state==='account_deleted'&&record.instanceId===f.draft.instanceId,'account deletion retains only a physical-copy hold');
check(!record.accountHash&&!record.payload&&!record.offerId&&!record.photos&&!record.fees&&!record.history,'account deletion erases eBay payload, IDs, account, photos and history');
check(publicListing(parseListing(JSON.stringify(record)),{id:'x'}).held,'erased record remains visible for recovery');
check(listingKey('production',f.uid,'a')!==listingKey('sandbox',f.uid,'a')&&listingKey('production',f.uid,'a')!==listingKey('production','another','a'),'owner and environment have separate reservations');

for(const data of [{},{feeSummaries:[]},{feeSummaries:[{marketplaceId:'EBAY_US',fees:[]}]},{feeSummaries:[{marketplaceId:'EBAY_US',fees:[{feeType:'Fee',amount:{currency:'EUR',value:'1.00'}}]}]}]) {
 assert.throws(()=>parseFees(data));checks++;
}
check(parseFees({feeSummaries:[{marketplaceId:'EBAY_US',fees:[{feeType:'Fee',amount:{currency:'USD',value:'0.00'}}]}]}).rows[0].amount==='0.00','verified zero fee remains distinct from unknown fee');
const api=inventoryApi(f.cfg,'TOKEN',async()=>Response.json({responses:[{sku:'s',offerId:'o',statusCode:500,errors:[{errorId:1}]}]}));
await assert.rejects(()=>api.price('s','o','2.00'));checks++;
check(fingerprint({a:1,b:2})===fingerprint({b:2,a:1}),'payload and fee fingerprints ignore property ordering');
finish(checks,0);
