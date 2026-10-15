// A physical-copy reservation outlives drafts, sessions and request timeouts.
// There is no expiring worker lease and no automatic replay of a provider write.
import {hash,keys,random} from './_ebaySeller.js';
import {fail} from './_ebaySubmission.js';
import {fingerprint,sameInventory,sameOffer,validExternalId,usd,WRITE_SCOPE} from './_ebayInventoryApi.js';

export const listingPrefix=(environment,uid)=>`ebaylisting:v1:${environment}:${hash(uid)}:`;
export const listingKey=(environment,uid,instanceId)=>listingPrefix(environment,uid)+hash(instanceId);
export const listingIndex=(environment,uid)=>listingPrefix(environment,uid)+'index';
export const accountListingsKey=(environment,account)=>`ebaylisting:v1:${environment}:account:${account}`;
const states=new Set(['planned','inventory_saved','offer_saved','live','ended','pending','cancelled','account_deleted']);
export function parseListing(raw,key) {
 if(!raw)return null;
 let r;try{r=JSON.parse(raw);}catch{throw fail('The saved listing operation could not be read. Its reservation is still held.',409);}
 if(r?.version!==1||!Number.isInteger(r.rev)||r.rev<1||!states.has(r.state)||typeof r.instanceId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(r.instanceId)||key&&!key.endsWith(':'+hash(r.instanceId)))throw fail('This saved listing operation requires recovery or a newer app. Its reservation is still held.',409);
 if(r.state==='account_deleted')return r;
 if(!r.payload||r.payloadHash!==fingerprint(r.payload)||r.sku!==r.payload.sku||!r.accountHash||!r.draftId||!Array.isArray(r.history)||r.history.length>30)throw fail('This listing operation is incomplete. Its reservation is still held.',409);
 if(r.state==='pending'&&(!['inventory','offer','publish','price','end'].includes(r.operation?.kind)||!validExternalId(r.operation?.id)))throw fail('The pending listing request could not be read. Its reservation is still held.',409);
 return r;
}
// CAS compares every source used to authorize a transition. Type checks happen
// before the first write: a damaged index must not leave a half-indexed plan.
export const saveListingScript=`
for i=1,#KEYS do local t=redis.call('TYPE',KEYS[i]).ok;if i==2 or i==3 then if t~='none' and t~='set' then return -5 end else if t~='none' and t~='string' then return -5 end end end
if (redis.call('GET',KEYS[1]) or '')~=ARGV[1] then return -1 end
if ARGV[3]~='' and (redis.call('GET',KEYS[4])~=ARGV[3] or redis.call('EXISTS',KEYS[5])==1) then return -2 end
if ARGV[4]~='' and redis.call('GET',KEYS[6])~=ARGV[4] then return -3 end
if ARGV[5]~='' and redis.call('GET',KEYS[7])~=ARGV[5] then return -3 end
if ARGV[6]~='' and redis.call('GET',KEYS[8])~=ARGV[6] then return -3 end
if redis.call('SISMEMBER',KEYS[2],KEYS[1])==0 and redis.call('SCARD',KEYS[2])>=500 then return -4 end
if redis.call('SISMEMBER',KEYS[3],KEYS[1])==0 and redis.call('SCARD',KEYS[3])>=2000 then return -4 end
redis.call('SET',KEYS[1],ARGV[2]);redis.call('SADD',KEYS[2],KEYS[1]);redis.call('SADD',KEYS[3],KEYS[1]);return 1`;

export async function saveListing({kv,environment,uid,key,previous,record,session=null,guards={}}) {
 const k=keys(environment,hash(uid)),account=record.accountHash;
 const result=await kv('EVAL',saveListingScript,8,key,listingIndex(environment,uid),accountListingsKey(environment,account),k.connection,k.prefix+'deleted:'+account,
  guards.draftKey||key,guards.reviewKey||key,guards.copyKey||key,previous||'',JSON.stringify(record),session?.raw||'',guards.draftRaw||'',guards.reviewRaw||'',guards.copyRaw||'');
 if(Number(result)!==1)throw fail(Number(result)===-4?'The saved listing operation limit was reached.':'The listing, draft or connection changed. Reload the saved operation to recover its current state.',409);
 return record;
}
export async function reserveListing(ctx,{review,reviewRaw,draftRaw,draftKey,reviewKey,copyKey,copyRaw,photos}) {
 const {kv,environment,uid,session}=ctx,report=review.report,key=listingKey(environment,uid,report.instanceId),previous=await kv('GET',key),old=parseListing(previous,key);
 if(old&&old.state!=='cancelled')throw fail('This physical copy already has a saved listing operation. Open it to continue or recover.',409);
 if(!report.payloadReady||!report.payload||report.expiresAt<=Date.now()||report.draftRev==null||review.accountHash!==session.record.accountHash||review.connectionVersion!==session.record.version)throw fail('Save a fresh, complete eBay review for this connected account first.',409);
 const now=Date.now(),record={version:1,rev:(old?.rev||0)+1,state:'planned',instanceId:report.instanceId,sku:report.sku,draftId:report.draftId,draftRev:report.draftRev,
  draftHash:hash(draftRaw),reviewRev:review.rev,accountHash:review.accountHash,connectionVersion:review.connectionVersion,payload:report.payload,payloadHash:fingerprint(report.payload),
  selected:report.selected,requirementsFingerprint:report.requirements.fingerprint,photos:photos.map(p=>({photoId:p.photoId,sha256:p.sha256,byteLength:p.byteLength,contentType:p.contentType})),
  price:report.payload.offer.pricingSummary.price.value,offerId:null,listingId:null,operation:null,fees:null,createdAt:now,updatedAt:now,history:[{state:'planned',at:now}],
  note:'Plan saved. No request has been sent to eBay. This copy is reserved for this plan.'};
 return saveListing({...ctx,key,previous,record,guards:{draftKey,draftRaw,reviewKey,reviewRaw,copyKey,copyRaw}});
}
export function publicListing(r,{id,accountHash}={}) {
 if(!r)return null;
 if(r.state==='account_deleted')return {id,version:1,rev:r.rev,state:r.state,instanceId:r.instanceId,held:true,note:'The eBay account data was erased. This copy remains held; deletion does not prove a listing ended.'};
 if(accountHash!==r.accountHash)return {id,version:1,rev:r.rev,state:'account_changed',instanceId:r.instanceId,held:r.state!=='cancelled',canCancel:r.state==='planned',note:'This copy is linked to another eBay connection. Connect the original seller account to recover it.'};
 return {id,version:1,rev:r.rev,state:r.state,instanceId:r.instanceId,draftId:r.draftId,sku:r.sku,title:r.payload.inventoryItem.product.title,price:r.price,offerId:r.offerId,listingId:r.listingId,
  payloadHash:r.payloadHash,held:r.state!=='cancelled',note:r.note,fees:r.fees,updatedAt:r.updatedAt,
  operation:r.operation?{kind:r.operation.kind,startedAt:r.operation.startedAt}:null,history:r.history};
}
export function listingEngine(ctx) {
 const {kv,key,session,api,environment,uid}=ctx;
 async function load(expectedRev) {
  const raw=await kv('GET',key),record=parseListing(raw,key);if(!record)throw fail('This listing plan was not found.',404);
  if(expectedRev!==undefined&&expectedRev!==record.rev)throw fail('Another tab updated this listing operation. Reload its saved status.',409);
  if(record.state==='account_deleted'||record.accountHash!==session?.record.accountHash)throw fail('Reconnect the original eBay seller account before continuing this operation.',409);
  return {raw,record};
 }
 async function save(current,changes,guards={}) {
  const now=Date.now(),record={...current.record,...changes,rev:current.record.rev+1,updatedAt:now};
  if(changes.state&&changes.state!==current.record.state) {
   const op=current.record.operation,completed=op&&changes.operation===null;
   record.history=[...record.history,{state:record.state,kind:changes.operation?.kind||op?.kind||null,at:now,
    ...(completed?{operationId:op.id,approval:{at:op.approvedAt,connectionVersion:op.connectionVersion,payloadHash:op.payloadHash,...(op.feeFingerprint?{feeFingerprint:op.feeFingerprint}:{}),...(op.price?{price:op.price}:{})}}:{})}].slice(-30);
  }
  await saveListing({...ctx,previous:current.raw,record,guards});return record;
 }
 async function ownedOffer(r) {
  if(!validExternalId(r.offerId))throw fail('The eBay offer identifier needs recovery.',409);
  const offers=await api.offers(r.sku);
  if(offers.length!==1||offers[0].offerId!==r.offerId)throw fail('eBay offer ownership is ambiguous. The copy remains reserved.',409);
  const offer=await api.offer(r.offerId);
  if(!offer||offer.offerId!==r.offerId||offer.sku!==r.sku||offer.marketplaceId!=='EBAY_US'||offer.format!=='FIXED_PRICE')throw fail('eBay could not confirm the mapped offer. The copy remains reserved.',409);
  return offer;
 }
 function active(offer,r) {
  return offer.status==='PUBLISHED'&&offer.listing?.listingId===r.listingId&&offer.listing.listingStatus==='ACTIVE'&&offer.listing.soldQuantity===0&&offer.listing.listingOnHold!==true&&offer.availableQuantity===1;
 }
 async function recover(expectedRev) {
  const current=await load(expectedRev),r=current.record;
  if(r.state!=='pending')return r;
  const op=r.operation;let changes=null;
  if(op.kind==='inventory') {
   const item=await api.inventory(r.sku);
   if(item&&sameInventory(item,r.payload))changes={state:'inventory_saved',note:'eBay confirmed the inventory record. This offer has not been published.'};
  } else if(op.kind==='offer') {
   const offers=await api.offers(r.sku);
   if(offers.length===1&&validExternalId(offers[0].offerId)) {
    const item=await api.inventory(r.sku),offer=await api.offer(offers[0].offerId);
    if(item&&sameInventory(item,r.payload)&&offer?.offerId===offers[0].offerId&&offer.status==='UNPUBLISHED'&&sameOffer(offer,r.payload))changes={state:'offer_saved',offerId:offer.offerId,note:'eBay confirmed one unpublished offer. Review current fees before approving publication.'};
   }
  } else {
   const offer=await ownedOffer(r);
   if(op.kind==='publish'&&offer.status==='PUBLISHED'&&validExternalId(offer.listing?.listingId)&&offer.listing.listingStatus==='ACTIVE'&&offer.listing.soldQuantity===0&&offer.listing.listingOnHold!==true&&sameOffer(offer,r.payload))changes={state:'live',listingId:offer.listing.listingId,note:'eBay confirmed the active listing. Sales and actual profit are not synchronized yet.'};
   if(op.kind==='price'&&active(offer,r)&&sameOffer(offer,r.payload,{price:op.price}))changes={state:'live',price:op.price,note:'eBay confirmed the new asking price. Inventory quantity was not changed.'};
   if(op.kind==='end'&&offer.status==='UNPUBLISHED'&&(!offer.listing?.listingId||offer.listing.listingId===r.listingId))changes={state:'ended',note:'eBay confirmed that the offer is unpublished. The copy stays held until sales and inventory can be reconciled.'};
  }
  if(!changes)return r; // Missing/contradictory evidence never releases or resends.
  return save(current,{...changes,operation:null,fees:null});
 }
 async function cancel(expectedRev) {
  // Owner-authenticated cancellation of an unsent plan needs no eBay token.
  const raw=await kv('GET',key),record=parseListing(raw,key),current={raw,record};
  if(!record||record.rev!==expectedRev)throw fail('Reload the saved plan before cancelling it.',409);
  if(current.record.state!=='planned')throw fail('Only a plan that has sent no eBay request can be cancelled. Recover or end an existing offer first.',409);
  const next={...record,rev:record.rev+1,state:'cancelled',updatedAt:Date.now(),note:'Unsent plan cancelled. No eBay request was made; its reservation is released.'};
  return saveListing({...ctx,session:null,previous:raw,record:next});
 }
 async function quote(expectedRev) {
  const current=await load(expectedRev),r=current.record;
  if(r.state!=='offer_saved')throw fail('Listing fees require a confirmed unpublished offer.',409);
  const offer=await ownedOffer(r);
  if(offer.status!=='UNPUBLISHED'||!sameOffer(offer,r.payload))throw fail('The unpublished offer changed. Review it before requesting fees.',409);
  return save(current,{fees:await api.fees(r.offerId),note:'Review this current eBay listing fee estimate before approving publication.'});
 }
 async function dispatch(action,{expectedRev,confirmed,feeFingerprint,newPrice}={}) {
  if(ctx.executionEnabled!==true)throw fail('Live eBay listing changes are not enabled. Your plan and reservation remain saved.',503);
  if(!session?.data?.grantedScopes?.includes(WRITE_SCOPE))throw fail('This eBay connection has no verified listing-write authorization. Reauthorization is required.',409);
  if(confirmed!==true)throw fail('Confirm this specific listing action before sending it.');
  const current=await load(expectedRev),r=current.record;let kind,guards={},price=null;
  if(r.state==='pending')throw fail('A request already has an uncertain outcome. Recover its status; it will not be replayed.',409);
  if(action==='prepare'&&['planned','inventory_saved'].includes(r.state)) {
   guards=await ctx.revalidate(r);
   const [item,offers]=await Promise.all([api.inventory(r.sku),api.offers(r.sku)]);
   if(offers.length||r.state==='planned'&&item||r.state==='inventory_saved'&&(!item||!sameInventory(item,r.payload)))throw fail('This eBay SKU is already in use or its inventory changed. The copy remains reserved.',409);
   kind=r.state==='planned'?'inventory':'offer';
  } else if(action==='publish'&&r.state==='offer_saved') {
   if(!r.fees||r.fees.expiresAt<=Date.now()||feeFingerprint!==r.fees.fingerprint)throw fail('Load and approve a fresh fee estimate before publishing.',409);
   guards=await ctx.revalidate(r);
   const offer=await ownedOffer(r),item=await api.inventory(r.sku),fees=await api.fees(r.offerId);
   if(offer.status!=='UNPUBLISHED'||!sameOffer(offer,r.payload)||!sameInventory(item,r.payload)||fees.fingerprint!==feeFingerprint)throw fail('The offer, inventory or fee estimate changed. Review again before publishing.',409);
   kind='publish';
  } else if(action==='price'&&r.state==='live') {
   price=usd(newPrice);if(price===r.price)return r;
   const offer=await ownedOffer(r);
   if(!active(offer,r)||!sameOffer(offer,r.payload,{price:r.price}))throw fail('This listing changed, sold, or is no longer active. Recover it before changing the price.',409);
   kind='price';
  } else if(action==='end'&&r.state==='live') {
   const offer=await ownedOffer(r);
   if(!active(offer,r))throw fail('This listing changed, sold, or is no longer active. Its copy remains held.',409);
   kind='end';
  } else throw fail('This action is not available in the saved listing state.',409);
  const operation={id:random(),kind,startedAt:Date.now(),approvedAt:Date.now(),connectionVersion:session.record.version,payloadHash:r.payloadHash,...(kind==='publish'?{feeFingerprint}:{}),...(price?{price}:{})};
  await save(current,{state:'pending',operation,fees:null,note:'An eBay request may have been sent. Recover its status before taking another action.'},guards);
  // If the durable save acknowledgement was lost, execution never reaches here.
  // A later caller performs reads only, even if the provider never saw a write.
  const k=keys(environment,hash(uid));
  if(await kv('GET',k.connection)!==session.raw)throw fail('Your connection changed. The saved operation remains held for recovery.',409);
  try {
   if(kind==='inventory')await api.saveInventory(r.payload);
   if(kind==='offer')await api.createOffer(r.payload);
   if(kind==='publish')await api.publish(r.offerId);
   if(kind==='price')await api.price(r.sku,r.offerId,price);
   if(kind==='end')await api.end(r.offerId);
  } catch {throw fail('The eBay result is uncertain. This copy remains reserved. Use Recover status; this request will not be sent again.',502);}
  return recover();
 }
 return {load,recover,cancel,quote,dispatch};
}
