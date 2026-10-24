import assert from 'node:assert/strict';
import {createHandler,saveReviewScript} from '../api/ebay-listing-review.js';
import {buildSubmissionReview,copySku,reviewKey,selections,accountReviewsKey} from '../api/_ebaySubmission.js';
import {listingReference,reviewedPhotos} from '../api/_ebayReviewReference.js';
import {config,keys,hash,seal} from '../api/_ebaySeller.js';
import {draftKey,readStoredDraft} from '../api/_draftStore.js';
import {deleteSellerData} from '../api/_ebayDeletion.js';
import {redisCommand} from './_idRedis.mjs';
import {env,draft,read,makeDraft,reference,selected,photo,verifiedPhotos,photoHost} from './_ebayReviewFixture.mjs';
import {completionGuard} from './_complete.mjs';
const {finish}=completionGuard('ebay-listing-review');let checks=0;
const check=(v,m)=>{assert.ok(v,m);checks++;};
const kv=(...args)=>redisCommand(args),cfg=config(env),uid='review-owner',owner=hash(uid),k=keys('production',owner),dk=draftKey(uid,draft.draftId),rk=reviewKey('production',uid,draft.draftId);
const build=(options={})=>buildSubmissionReview({read,owner:uid,reference,selected,photos:verifiedPhotos,...options});
const clone=()=>structuredClone(reference);
let r=build();check(r.payloadReady,JSON.stringify(r.issues));
check(!r.publishingEnabled&&r.payload.offer.availableQuantity===1,'review cannot publish and quantity is one');
check(r.payload.inventoryItem.condition==='USED_VERY_GOOD'&&r.payload.inventoryItem.conditionDescriptors[0].values[0]==='400010','raw condition maps to documented enum and live ID string');
check(r.payload.offer.pricingSummary.price.value==='12.50'&&r.payload.offer.pricingSummary.price.currency==='USD','price is exact USD cents');
check(r.sku!==draft.sku&&r.sku===copySku('production',uid,draft.instanceId),'marketplace SKU is stable per physical copy, not printing');
check(r.sku!==copySku('production','other',draft.instanceId)&&r.sku!==copySku('sandbox',uid,draft.instanceId)&&r.sku!==copySku('production',uid,'another-copy'),'owner/environment/copy isolation');
check(r.payload.offer.includeCatalogProductDetails===false,'catalogue details cannot overwrite reviewed card');
check(!build({reference:null}).payload,'absent live metadata yields no submission payload');
check(build({reference:null,connected:true}).issues.some(i=>i.code==='REQUIREMENTS_PENDING')&&!build({reference:null,connected:true}).issues.some(i=>i.code==='CONNECTION'),'connected account needs requirements, not a second connection');
check(!build({selected:{...selected,detailsConfirmed:false}}).payload&&!build({selected:{...selected,copyAvailable:false}}).payload,'both explicit confirmations required');
check(!build({read:{...read,packetUsable:false}}).payload,'stale packet cannot submit');
check(!build({read:{...read,draft:{...draft,quantity:2}}}).payload,'multiple physical copies cannot share a direct offer');
check(!build({read:{...read,draft:{...draft,price:12.345}}}).payload,'fractional cents refused');
check(!build({selected:{...selected,descriptors:{'40001':['guessed-id']}}}).payload,'invented condition ID refused');
check(!build({photos:[]}).payload,'missing photos cannot become ready');
check(!build({selected:{...selected,photoIds:['ph_front','ph_back']}}).payload,'partial photo verification blocks all');
for(const field of ['fulfillmentPolicyId','paymentPolicyId','returnPolicyId','merchantLocationKey'])check(!build({selected:{...selected,[field]:'other-seller'}}).payload,'unowned setting blocked: '+field);
let ref=clone();ref.fulfillmentPolicies[0].shippingOptions[0].costType='CALCULATED';check(!build({reference:ref}).payload,'calculated shipping cannot invent package weight');
ref=clone();ref.locations[0].merchantLocationStatus='DISABLED';check(!build({reference:ref}).payload,'disabled location rejected');
ref=clone();ref.locations[0].location.address={country:'US'};check(!build({reference:ref}).payload,'incomplete location rejected');
ref=clone();ref.aspects[0].aspectValues=[];check(!build({reference:ref}).payload,'removed category value rejected');
ref=clone();ref.aspects[0].aspectConstraint.aspectFormat='YYYY';check(!build({reference:ref}).payload,'unsupported format fails closed');
ref=clone();ref.aspects[0].aspectValues[0].valueConstraints=[{applicableForLocalizedAspectName:'Language',applicableForLocalizedAspectValues:['Japanese']}];check(!build({reference:ref}).payload,'item-specific dependency honored');
ref=clone();ref.condition.conditionDescriptors[0].conditionDescriptorValues[0].conditionDescriptorValueConstraints=[{applicableToConditionDescriptorId:'27501',applicableToConditionDescriptorValueIds:['psa']}];check(!build({reference:ref}).payload,'grade/grader value dependency honored');
ref=clone();ref.condition.conditionDescriptors[0].conditionDescriptorConstraint.applicableToConditionDescriptorIds=['27501'];check(!build({reference:ref}).payload,'descriptor presence dependency honored');
assert.throws(()=>selections({aspects:JSON.parse('{"__proto__":["bad"]}')}));checks++;
assert.throws(()=>selections({sku:'client-sku'}));checks++;
assert.throws(()=>selections({descriptors:{a:['x'.repeat(201)]}}));checks++;
const graded=makeDraft({card:{...draft.card,grader:'PSA',grade:'10',cert:'1234'}}),gr=readStoredDraft(graded),gradedRef=clone();
gradedRef.condition={conditionId:'2750',conditionDescriptors:[
 {conditionDescriptorId:'27501',conditionDescriptorName:'Grader',conditionDescriptorConstraint:{mode:'SELECTION_ONLY',cardinality:'SINGLE',usage:'REQUIRED'},conditionDescriptorValues:[{conditionDescriptorValueId:'100',conditionDescriptorValueName:'PSA'}]},
 {conditionDescriptorId:'27502',conditionDescriptorName:'Grade',conditionDescriptorConstraint:{mode:'SELECTION_ONLY',cardinality:'SINGLE',usage:'REQUIRED'},conditionDescriptorValues:[{conditionDescriptorValueId:'110',conditionDescriptorValueName:'10',conditionDescriptorValueConstraints:[{applicableToConditionDescriptorId:'27501',applicableToConditionDescriptorValueIds:['100']}]}]},
 {conditionDescriptorId:'27503',conditionDescriptorName:'Certificate',conditionDescriptorConstraint:{mode:'FREE_TEXT',cardinality:'SINGLE',maxLength:30}}]};
const gs={...selected,descriptors:{'27501':['100'],'27502':['110'],'27503':['1234']}};
r=build({read:gr,reference:gradedRef,selected:gs});check(r.payloadReady,JSON.stringify(r.issues));
check(r.payload.inventoryItem.condition==='LIKE_NEW'&&r.payload.inventoryItem.conditionDescriptors[2].additionalInfo==='1234','graded enum and certificate use correct Inventory API wire format');
check(!build({read:gr,reference:gradedRef,selected:{...gs,descriptors:{...gs.descriptors,'27503':['9999']}}}).payload,'certificate cannot drift from physical slab');
const wrongGrade=structuredClone(gradedRef);wrongGrade.condition.conditionDescriptors[1].conditionDescriptorValues[0].conditionDescriptorValueName='6';check(!build({read:gr,reference:wrongGrade,selected:gs}).payload,'valid eBay ID for a different grade cannot mislabel the slab');
const wrongGrader=structuredClone(gradedRef);wrongGrader.condition.conditionDescriptors[0].conditionDescriptorValues[0].conditionDescriptorValueName='CGC';check(!build({read:gr,reference:wrongGrader,selected:gs}).payload,'valid eBay ID for a different grader cannot mislabel the slab');
const hostile=structuredClone(read);hostile.packet.description.text='<img src=x onerror=bad()>\nCard';r=build({read:hostile});check(r.payload.inventoryItem.product.description==='&lt;img src=x onerror=bad()&gt;<br>Card','description preserves text without active HTML');

// Exercise real reference loading with official response shapes and token split.
let calls=[];
const fetcher=async(url,opts={})=>{
 calls.push({url:String(url),opts});const u=new URL(url),path=u.pathname;
 if(path==='/identity/v1/oauth2/token'){check(new URLSearchParams(opts.body).get('grant_type')==='client_credentials','category lookup uses app grant');return Response.json({access_token:'APP',expires_in:7200});}
 if(path.includes('/commerce/taxonomy/')||path.includes('/sell/metadata/'))check(opts.headers.Authorization==='Bearer APP','category metadata uses app token');
 else check(opts.headers.Authorization==='Bearer SELLER','private settings use seller token');
 if(path.endsWith('get_default_category_tree_id'))return Response.json({categoryTreeId:'0',categoryTreeVersion:'fixture-v1'});
 if(path.endsWith('get_item_aspects_for_category'))return Response.json({aspects:reference.aspects});
 if(path.endsWith('get_item_condition_policies')){check(u.searchParams.get('filter')==='categoryIds:{183454}','condition lookup bounded to one category');return Response.json({itemConditionPolicies:[{categoryId:'183454',itemConditions:[reference.condition]}]});}
 if(path.endsWith('/privilege'))return Response.json({sellerRegistrationCompleted:true});
 for(const type of ['fulfillment','payment','return'])if(path.endsWith('/'+type+'_policy'))return Response.json({[type+'Policies']:reference[type+'Policies']});
 if(path.endsWith('/location'))return Response.json({locations:reference.locations,total:1});
 throw Error('Unexpected external request');
};
const live=await listingReference(cfg,'SELLER','183454','4000',fetcher);check(live.condition.conditionId==='4000'&&live.aspects.length===5,'reference loader returns complete coherent metadata');
await listingReference(cfg,'SELLER','183454','4000',fetcher);check(calls.filter(c=>c.url.endsWith('/identity/v1/oauth2/token')).length===1,'warm checks reuse the app token while re-reading live rules');
const beforeSandbox=calls.length;await listingReference({...cfg,environment:'sandbox',api:'https://api.sandbox.ebay.com'},'SELLER','183454','4000',fetcher);check(calls.slice(beforeSandbox).every(c=>c.url.startsWith('https://api.sandbox.ebay.com/'))&&calls.filter(c=>c.url.endsWith('/identity/v1/oauth2/token')).length===2,'sandbox metadata and app-token cache cannot reuse Production');
check(calls.every(c=>!c.opts.method||c.url.endsWith('/identity/v1/oauth2/token')),'no listing mutations while checking metadata');
await assert.rejects(()=>listingReference(cfg,'SELLER','183454','4000',async(u,o)=>String(u).includes('/return_policy')?new Response('',{status:503}):fetcher(u,o)),e=>e.status===502&&e.message.includes('Business Policies'));checks++;
let lastKey='';r=await reviewedPhotos({owner:uid,draftId:draft.draftId,selected,photos:[{...photo,objectKey:'another-owner/key',publicUrl:'http://127.0.0.1/secret'}],host:{...photoHost,head:async key=>{lastKey=key;return {exists:true,byteLength:2000,contentType:'image/jpeg'};}}});
check(r.photos.length===1&&lastKey.startsWith('owner-'+uid+'/'+draft.draftId),'photo key recomputed from verified owner, never browser URL');
check((await reviewedPhotos({owner:uid,draftId:draft.draftId,selected,photos:[photo],host:null})).photos.length===0,'unconfigured hosting blocks direct photos');
check((await reviewedPhotos({owner:uid,draftId:draft.draftId,selected,photos:[photo],host:{...photoHost,head:async()=>({exists:false})}})).photos.length===0,'deleted hosted photo stays blocked');

// Actual Redis CAS and handler, including lost acknowledgements and races.
await kv('SET',dk,JSON.stringify(draft));
const record={accountHash:hash('seller1'),version:'connection-v1',cipher:seal({accessToken:'SELLER',refreshToken:'SECRET',accessExpiresAt:Date.now()+3600000,refreshExpiresAt:Date.now()+86400000},cfg,owner)};
await kv('SET',k.connection,JSON.stringify(record));
const verify=async t=>({uid:t});let hook=null,storeAfter=false;
const store=async(...args)=>{const out=await kv(...args);if(storeAfter&&args[0]==='EVAL'&&args[1]===saveReviewScript){storeAfter=false;throw Error('lost storage acknowledgement');}return out;};
const h=createHandler({env,verify,store,photoHost,referenceLoader:async()=>{if(hook){const fn=hook;hook=null;await fn();}return reference;}});
async function call({method='GET',who=uid,body={},handler=h,origin=env.EBAY_SELLER_ORIGIN}={}) {
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.data=v;return this;}};
 await handler({method,headers:{...(who?{authorization:'Bearer '+who}:{}),origin},query:{id:draft.draftId},body:{draftId:draft.draftId,expectedDraftRev:1,expectedReviewRev:0,requirementsFingerprint:hash(JSON.stringify(reference)),selected,photos:[photo],...body}},res);return res;
}
check((await call({who:null})).code===401,'unsigned review refused');
r=await call();check(r.data.connected&&r.data.baseline.issues.some(i=>i.code==='REQUIREMENTS_PENDING')&&!r.data.baseline.issues.some(i=>i.code==='CONNECTION'),'connected GET baseline names the pending requirements step');
check((await call({who:'other-owner'})).code===404,'other owner cannot read draft review');
check((await call({method:'DELETE'})).code===405,'no destructive verb supported');
check((await call({method:'POST',origin:'https://other.example'})).code===403,'cross-origin checkpoint refused');
check((await call({method:'POST',body:{action:'publish'}})).code===400,'publication action rejected');
check((await call({method:'POST',body:{expectedDraftRev:9}})).code===409,'stale draft revision refused');
check((await call({method:'POST',body:{requirementsFingerprint:'old-metadata'}})).code===409,'changed metadata or policy details require a new seller review');
r=await call({method:'POST'});check(r.code===200&&r.data.report.payloadReady,'valid check saved in actual Redis');
check(Number(await kv('TTL',rk))>29*86400&&await kv('SISMEMBER',accountReviewsKey('production',record.accountHash),rk),'bounded retention and deletion index recorded atomically');
check(!JSON.stringify(r.data).includes('SECRET')&&!JSON.stringify(r.data).includes('SELLER'),'review response contains no authorization tokens');
r=await call();check(r.data.saved.rev===1&&!r.data.stale,'reload recovers exact saved review');
check((await call({method:'POST'})).code===409,'two tabs cannot overwrite the same review revision');
storeAfter=true;r=await call({method:'POST',body:{expectedReviewRev:1}});check(r.code===503,'lost checkpoint acknowledgement is uncertain');
r=await call();check(r.data.reviewRev===2&&r.data.saved.report.payloadReady,'reload recovers checkpoint committed before lost response');
const checkpoint=await kv('GET',rk);await kv('SET',rk,JSON.stringify({...JSON.parse(checkpoint),version:2}));check((await call({method:'POST',body:{expectedReviewRev:2}})).code===409,'future checkpoint schema is preserved and cannot be overwritten');await kv('SET',rk,checkpoint);
await kv('SET',rk,JSON.stringify({...JSON.parse(checkpoint),report:{...JSON.parse(checkpoint).report,expiresAt:1}}));check((await call()).data.stale,'expired report stays historical and requires a fresh check');await kv('SET',rk,checkpoint);
hook=()=>kv('SET',dk,JSON.stringify({...draft,rev:2,price:20}));r=await call({method:'POST',body:{expectedReviewRev:2}});check(r.code===409&&JSON.parse(await kv('GET',rk)).rev===2,'draft edit during provider lookup cannot save stale review');
r=await call();check(r.data.stale,'changed draft invalidates saved review on read');await kv('SET',dk,JSON.stringify(draft));
hook=()=>kv('DEL',k.connection);r=await call({method:'POST',body:{expectedReviewRev:2}});check(r.code===409,'disconnect during check wins');
r=await call();check(r.data.accountChanged&&!r.data.saved,'disconnected account cannot expose old seller settings');
await kv('SET',k.connection,JSON.stringify(record));
await deleteSellerData({metadata:{topic:'MARKETPLACE_ACCOUNT_DELETION'},notification:{data:{userId:'seller1'}}},kv);
check(!await kv('GET',rk),'signed-deletion handler erases associated review checkpoint');
const off=createHandler({env:{},verify,store:kv,photoHost:null});r=await call({method:'POST',handler:off});check(r.code===200&&!r.data.report.payloadReady&&!r.data.publishingEnabled,'unconfigured users can save an honest blocked review');
check((await call({handler:off})).data.saved.rev===1,'unconfigured preparation recovers without eBay credentials');
finish(checks,0);
