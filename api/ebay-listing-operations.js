import {availableCopy} from './_copySales.js';
import {verifyTokenFlexible} from './_verifyToken.js';
import {kvFromEnv} from './_kv.js';
import {getDraft,draftKey,isDraftId,isSyntheticTestSub} from './_draftStore.js';
import {config,hash,keys,access,limited} from './_ebaySeller.js';
import {reviewKey,buildSubmissionReview,fail} from './_ebaySubmission.js';
import {listingReference,reviewedPhotos} from './_ebayReviewReference.js';
import {resolvePhotoProvider} from './_photoProvider.js';
import {inventoryApi,fingerprint} from './_ebayInventoryApi.js';
import {listingPrefix,listingKey,listingIndex,parseListing,publicListing,reserveListing,listingEngine} from './_ebayOperations.js';

// Deployment entry point never enables execution. Only isolated tests inject
// executionEnabled + a fake provider. Activation requires a separate release
// with verified write-scope OAuth and authoritative inventory/sale checks.
export function createHandler({env=process.env,verify=verifyTokenFlexible,store,fetcher=fetch,photoHost,referenceLoader=listingReference,executionEnabled=false}={}) {
 return async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
  try {
   const token=String(req.headers?.authorization||'').match(/^Bearer (.+)$/)?.[1];let identity;
   try{if(!token)throw Error();identity=await verify(token);}catch{return res.status(401).json({error:'Sign in required'});}
   const uid=identity?.uid;if(!uid)return res.status(401).json({error:'Sign in required'});
   if(isSyntheticTestSub(uid))return res.status(403).json({error:'Reserved account namespace'});
   const cfg=config(env),environment=cfg?.environment||(env.EBAY_SELLER_ENVIRONMENT==='sandbox'?'sandbox':'production'),kv=store||kvFromEnv(env);
   if(req.method==='POST'&&req.headers?.origin!==(cfg?.origin||'https://www.cardresell.org'))throw fail('Open this action on CardResell to continue.',403);
   if(!kv)throw fail('Listing operation storage is unavailable. Your reservations remain held.',503);
   let body=req.body||{};
   if(typeof body==='string'){if(Buffer.byteLength(body)>40000)throw fail('Listing request is too large.',413);try{body=JSON.parse(body);}catch{throw fail('Invalid listing request.');}}
   if(!body||typeof body!=='object'||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>40000)throw fail('Invalid or oversized listing request.',413);
   const k=keys(environment,hash(uid)),connectionRaw=await kv('GET',k.connection),connection=connectionRaw?JSON.parse(connectionRaw):null;
   const pilots=String(env.EBAY_SELLER_PILOT_UIDS||'').split(',').map(v=>v.trim()).filter(Boolean),available=!!cfg&&(!pilots.length||pilots.includes(uid));
   const project=r=>publicListing(r,{id:hash(r.instanceId),accountHash:connection?.accountHash});
   const input=req.method==='GET'?req.query||{}:body;
   let key=null;
   if(input.id!==undefined){if(typeof input.id!=='string'||!/^[a-f0-9]{64}$/.test(input.id))throw fail('A valid listing operation is required.');key=listingPrefix(environment,uid)+input.id;}
   else if(input.draftId!==undefined){
    if(!isDraftId(input.draftId))throw fail('A valid draft is required.');
    const read=await getDraft(kv,uid,input.draftId);if(!read.ok)throw fail('This draft is unavailable. Open saved listing operations to recover an existing reservation.',read.retryable?503:404);
    key=listingKey(environment,uid,read.draft.instanceId);
   }
   if(req.method==='GET') {
    let records=[];
    if(key){const record=parseListing(await kv('GET',key),key);if(record)records=[record];}
    else {
     const entries=await kv('SMEMBERS',listingIndex(environment,uid));
     if(!Array.isArray(entries)||entries.length>500||entries.some(v=>!v.startsWith(listingPrefix(environment,uid))||!/^[a-f0-9]{64}$/.test(v.slice(listingPrefix(environment,uid).length))))throw fail('The listing operation index needs recovery. Reservations remain held.',503);
     const results=await Promise.allSettled(entries.map(async entry=>{const raw=await kv('GET',entry);if(!raw)throw Error('missing_listing_reservation');return parseListing(raw,entry);}));
     if(results.some(r=>r.status==='rejected'))throw fail('Some listing reservations could not be read. Retry; no reservations were released.',503);
     records=results.map(r=>r.value).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    }
    return res.status(200).json({available,connected:available&&!!connection,executionEnabled:false,environment,records:records.map(project),notice:'Direct eBay publication is awaiting setup. Saved plans and any uncertain requests remain recoverable.'});
   }
   const action=body.action;
   if(!['plan','cancel','recover','fees','prepare','publish','price','end'].includes(action))throw fail('Unknown listing operation.');
   if(['prepare','publish','price','end'].includes(action)&&executionEnabled!==true)throw fail('Live eBay listing changes are not enabled. Your plan and reservation remain saved.',503);
   await limited(kv,'ebaylisting:rate:'+environment+':'+hash(uid),60,3600);
   if(!key)throw fail('Choose a draft or saved listing operation.');
   if(action==='cancel') {
    if(body.confirmed!==true)throw fail('Confirm cancellation of this unsent plan.');
    const record=await listingEngine({kv,key,environment,uid}).cancel(body.expectedRev);
    return res.status(200).json({record:project(record),executionEnabled:false});
   }
   if(!available)throw fail('Direct eBay connection is awaiting setup. Your saved drafts and listing plans are retained.',503);
   const session=await access(kv,cfg,hash(uid),fetcher),api=inventoryApi(cfg,session.data.accessToken,fetcher);
   const host=photoHost===undefined?resolvePhotoProvider(env,fetcher).host:photoHost;
   async function validateDraft(id,{selected,photos,payloadHash,requirementsFingerprint,draftHash}) {
    const read=await getDraft(kv,uid,id);if(!read.ok)throw fail('The draft was changed or deleted. This copy stays reserved.',409);
    const dk=draftKey(uid,id),raw=await kv('GET',dk);
    if(!raw||JSON.stringify(JSON.parse(raw))!==JSON.stringify(read.draft)||draftHash&&hash(raw)!==draftHash)throw fail('The draft changed. This copy stays reserved for recovery.',409);
    const copy=await availableCopy(kv,uid,read.draft.instanceId);
    const reference=await referenceLoader(cfg,session.data.accessToken,read.packet?.category?.id,read.packet?.condition?.conditionId,fetcher);
    const verified=await reviewedPhotos({owner:uid,draftId:id,selected,photos,host});
    const report=buildSubmissionReview({read,owner:uid,environment,selected,reference,...verified});
    if(!report.payloadReady||fingerprint(report.payload)!==payloadHash||report.requirements.fingerprint!==requirementsFingerprint)throw fail('Card details, photos or eBay requirements changed. Save a new review before preparing this listing.',409);
    return {draftKey:dk,draftRaw:raw,...copy};
   }
   if(action==='plan') {
    if(body.confirmed!==true||!isDraftId(body.draftId))throw fail('Confirm saving this physical copy’s listing plan.');
    const rk=reviewKey(environment,uid,body.draftId),raw=await kv('GET',rk);let review;try{review=raw?JSON.parse(raw):null;}catch{}
    if(!review||review.version!==1||review.rev!==body.expectedReviewRev||review.report?.version!==1||!review.report.payloadReady||review.report.draftId!==body.draftId)throw fail('Save and reload a complete eBay review first.',409);
    const photos=body.photos||[];
    if(!Array.isArray(photos)||photos.length>12)throw fail('Choose up to 12 verified card photos.');
    const guards=await validateDraft(body.draftId,{selected:review.report.selected,photos,payloadHash:fingerprint(review.report.payload),requirementsFingerprint:review.report.requirements.fingerprint});
    const record=await reserveListing({kv,environment,uid,session},{review,reviewRaw:raw,reviewKey:rk,...guards,photos});
    return res.status(200).json({record:project(record),executionEnabled:false});
   }
   if(!Number.isInteger(body.expectedRev)||body.expectedRev<1)throw fail('Reload the saved listing operation before continuing.',428);
   const engine=listingEngine({kv,key,environment,uid,session,api,executionEnabled,
    revalidate:r=>validateDraft(r.draftId,r)});
   const record=action==='recover'?await engine.recover(body.expectedRev):action==='fees'?await engine.quote(body.expectedRev):await engine.dispatch(action,body);
   return res.status(200).json({record:project(record),executionEnabled:false});
  } catch(error) {
   return res.status(error.status||503).json({error:error.status?error.message:'Could not complete the listing operation. Reload its saved status; existing reservations remain held.'});
  }
 };
}
export default createHandler();
