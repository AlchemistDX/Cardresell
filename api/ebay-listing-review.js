import {verifyTokenFlexible} from './_verifyToken.js';
import {kvFromEnv} from './_kv.js';
import {getDraft,draftKey,isDraftId,isSyntheticTestSub} from './_draftStore.js';
import {config,keys,hash,access,limited} from './_ebaySeller.js';
import {resolvePhotoProvider} from './_photoProvider.js';
import {buildSubmissionReview,selections,reviewKey,accountReviewsKey,REVIEW_TTL,fail} from './_ebaySubmission.js';
import {listingReference,reviewedPhotos} from './_ebayReviewReference.js';

export const saveReviewScript=`
if redis.call('GET',KEYS[1])~=ARGV[1] then return -1 end
if (redis.call('GET',KEYS[2]) or '')~=ARGV[2] then return -2 end
if ARGV[4]~='' then
 if redis.call('GET',KEYS[3])~=ARGV[4] or redis.call('EXISTS',KEYS[5])==1 then return -3 end
 local active=redis.call('SMEMBERS',KEYS[4]);for _,k in ipairs(active) do if redis.call('EXISTS',k)==0 then redis.call('SREM',KEYS[4],k) end end
 if redis.call('SISMEMBER',KEYS[4],KEYS[2])==0 and redis.call('SCARD',KEYS[4])>=500 then return -4 end
 redis.call('SADD',KEYS[4],KEYS[2]);redis.call('EXPIRE',KEYS[4],ARGV[5])
end
redis.call('SET',KEYS[2],ARGV[3],'EX',ARGV[5]);return 1`;

export function createHandler({env=process.env,verify=verifyTokenFlexible,store,fetcher=fetch,photoHost,referenceLoader=listingReference}={}) {
 return async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
  try {
   const token=String(req.headers?.authorization||'').match(/^Bearer (.+)$/)?.[1];
   let identity;try{if(!token)throw Error();identity=await verify(token);}catch{return res.status(401).json({error:'Sign in required'});}
   const uid=identity?.uid;if(!uid)return res.status(401).json({error:'Sign in required'});
   if(isSyntheticTestSub(uid))return res.status(403).json({error:'Reserved account namespace'});
   const cfg=config(env),environment=cfg?.environment||(env.EBAY_SELLER_ENVIRONMENT==='sandbox'?'sandbox':'production');
   if(req.method==='POST'&&req.headers?.origin!==(cfg?.origin||'https://www.cardresell.org'))return res.status(403).json({error:'Open this action on CardResell to continue.'});
   const kv=store||kvFromEnv(env);if(!kv)throw fail('Review storage is unavailable. Try again.',503);
   let body=req.body||{};if(typeof body==='string'){if(Buffer.byteLength(body)>40000)throw fail('Review request is too large.',413);try{body=JSON.parse(body);}catch{throw fail('Invalid review request.');}}
   if(!body||typeof body!=='object'||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>40000)throw fail('Review request is too large or invalid.',413);
   const id=req.method==='GET'?req.query?.id:body.draftId;if(!isDraftId(id))throw fail('A valid draft is required.');
   const read=await getDraft(kv,uid,id);if(!read.ok)throw fail(read.deleted?'This draft was deleted.':'This draft is unavailable.',read.deleted?410:read.retryable?503:404);
   const dk=draftKey(uid,id),draftRaw=await kv('GET',dk);
   // One atomic source read is used for the CAS. Never validate one revision
   // and bind the checkpoint to a newer revision read in the meantime.
   if(!draftRaw||JSON.stringify(JSON.parse(draftRaw))!==JSON.stringify(read.draft))throw fail('This draft changed. Reload it before checking.',409);
   const key=reviewKey(environment,uid,id),previous=await kv('GET',key),saved=previous?JSON.parse(previous):null;
   if(saved&&(saved.version!==1||!Number.isInteger(saved.rev)||saved.rev<1||saved.report?.version!==1||saved.report.draftId!==id))throw fail('This saved review needs a newer app or could not be read. Your draft is unchanged.',409);
   const k=keys(environment,hash(uid)),connectionRaw=await kv('GET',k.connection),connection=connectionRaw?JSON.parse(connectionRaw):null;
   const pilot=String(env.EBAY_SELLER_PILOT_UIDS||'').split(',').map(s=>s.trim()).filter(Boolean);
   const available=Boolean(cfg)&&(!pilot.length||pilot.includes(uid)),connected=available&&!!connection;
   const accountChanged=Boolean(saved?.accountHash && saved.accountHash!==connection?.accountHash);
   if(req.method==='GET')return res.status(200).json({draftId:id,draftRev:read.draft.rev,available,connected,connectionVersion:connection?.version||null,publishingEnabled:false,
     baseline:buildSubmissionReview({read,owner:uid,environment}),
     suggestedAspects:{...(read.packet?.aspects?.required||{}),...(read.packet?.aspects?.optional||{})},conditionIntent:read.packet?.condition?.descriptors||[],
     saved:accountChanged?null:saved,accountChanged,
     stale:!!saved&&(accountChanged||saved.connectionVersion!==(connection?.version||null)||saved.report.draftRev!==read.draft.rev||saved.report.expiresAt<=Date.now()),
     reviewRev:saved?.rev||0});
   const action=body.action||'check';if(!['check','requirements'].includes(action))throw fail('This endpoint only reviews listing requirements. Publishing is not enabled.');
   if(body.expectedDraftRev!==read.draft.rev)throw fail('This draft changed. Reload it before checking.',409);
   await limited(kv,'ebayreview:rate:'+hash(uid),30,3600);
   let reference=null,session=null;
   if(connected) {
    session=await access(kv,cfg,hash(uid),fetcher);
    reference=await referenceLoader(cfg,session.data.accessToken,read.packet?.category?.id,read.packet?.condition?.conditionId,fetcher);
    if(await kv('GET',k.connection)!==session.raw)throw fail('Your eBay connection changed. Reopen the review.',409);
   }
   if(action==='requirements') {
    if(await kv('GET',dk)!==draftRaw)throw fail('This draft changed. Reopen it before checking.',409);
    return res.status(200).json({available,connected,reference,requirementsFingerprint:reference?hash(JSON.stringify(reference)):null,publishingEnabled:false});
   }
   if(reference&&body.requirementsFingerprint!==hash(JSON.stringify(reference)))throw fail('Load the current eBay requirements and review the selections again before saving.',409);
   if(!Number.isInteger(body.expectedReviewRev)||body.expectedReviewRev!==(saved?.rev||0))throw fail('Another tab updated this review. Reopen it before saving.',409);
   const selected=selections(body.selected);
   const host=photoHost===undefined?resolvePhotoProvider(env,fetcher).host:photoHost;
   const photos=await reviewedPhotos({owner:uid,draftId:id,selected,photos:body.photos||[],host});
   const report=buildSubmissionReview({read,owner:uid,environment,selected,reference,...photos});
   const record={version:1,rev:(saved?.rev||0)+1,accountHash:session?.record.accountHash||null,connectionVersion:session?.record.version||null,report};
   // No marketplace write is performed. This durable checkpoint is an
   // expiring review, never an approved operation or a published listing.
   const account=record.accountHash||'none';
   const stored=await kv('EVAL',saveReviewScript,5,dk,key,k.connection,accountReviewsKey(environment,account),k.prefix+'deleted:'+account,
     draftRaw,previous||'',JSON.stringify(record),session?.raw||'',REVIEW_TTL);
   if(Number(stored)!==1)throw fail(Number(stored)===-4?'The saved review limit was reached.':'The draft, connection or review changed. Reopen this draft to recover the latest saved review.',409);
   return res.status(200).json({saved:true,record,report,publishingEnabled:false});
  } catch(error) {
   return res.status(error.status||503).json({error:error.status?error.message:'Could not complete the review. Your draft is unchanged; reopen this review to recover any saved result.'});
  }
 };
}
export default createHandler();
