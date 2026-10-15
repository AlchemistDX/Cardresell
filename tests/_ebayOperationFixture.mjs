import {createHandler} from '../api/ebay-listing-operations.js';
import {config,keys,hash,seal} from '../api/_ebaySeller.js';
import {draftKey,readStoredDraft} from '../api/_draftStore.js';
import {buildSubmissionReview,reviewKey} from '../api/_ebaySubmission.js';
import {reviewedPhotos} from '../api/_ebayReviewReference.js';
import {listingKey,listingIndex,accountListingsKey} from '../api/_ebayOperations.js';
import {WRITE_SCOPE} from '../api/_ebayInventoryApi.js';
import {redisCommand} from './_idRedis.mjs';
import {env,makeDraft,reference,selected,photo,photoHost} from './_ebayReviewFixture.mjs';
export {env,reference,selected,photo,photoHost};
export const kv=(...args)=>redisCommand(args);
export async function fixture(uid='operation-owner') {
 const cfg=config(env),draft=makeDraft({instanceId:'inst_col_'+uid}),read=readStoredDraft(draft),k=keys('production',hash(uid)),dk=draftKey(uid,draft.draftId),rk=reviewKey('production',uid,draft.draftId),key=listingKey('production',uid,draft.instanceId);
 const connection={accountHash:hash('seller-'+uid),version:'connection-'+uid,cipher:seal({accessToken:'SELLER',refreshToken:'PRIVATE',accessExpiresAt:Date.now()+3600000,refreshExpiresAt:Date.now()+86400000,grantedScopes:[WRITE_SCOPE]},cfg,hash(uid))};
 const verified=await reviewedPhotos({owner:uid,draftId:draft.draftId,selected,photos:[photo],host:photoHost});
 const report=buildSubmissionReview({read,owner:uid,reference,selected,...verified}),review={version:1,rev:1,accountHash:connection.accountHash,connectionVersion:connection.version,report};
 const state={item:null,offer:null,fee:'0.35',writes:[],calls:[],before:null,after:null,extraOffers:[],failRead:false};
 async function fetcher(url,options={}) {
  const u=new URL(url),path=u.pathname.replace('/sell/inventory/v1',''),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
  const write=method!=='GET'&&!path.endsWith('get_listing_fees');const call={path,method,body,url:String(url)};state.calls.push(call);
  if(write){state.writes.push(call);if(state.before)await state.before(call);}
  else if(state.failRead)throw Error('provider read unavailable');
  let data;
  if(path.startsWith('/inventory_item/')) {
   if(method==='GET'){if(!state.item)return new Response(null,{status:404});data=state.item;}
   else if(method==='PUT'){state.item={...structuredClone(body),sku:decodeURIComponent(path.split('/').at(-1))};data=null;}
  } else if(path==='/offer'&&method==='GET') {const offers=[...(state.offer?[state.offer]:[]),...state.extraOffers];data={total:offers.length,offers};}
  else if(path==='/offer'&&method==='POST'){state.offer={...structuredClone(body),offerId:'offer-fixture',status:'UNPUBLISHED'};data={offerId:state.offer.offerId};}
  else if(path==='/offer/get_listing_fees'){data={feeSummaries:[{marketplaceId:'EBAY_US',fees:[{feeType:'InsertionFee',amount:{currency:'USD',value:state.fee}}]}]};}
  else if(path==='/offer/offer-fixture'&&method==='GET'){if(!state.offer)return new Response(null,{status:404});data=state.offer;}
  else if(path.endsWith('/publish')){state.offer.status='PUBLISHED';state.offer.listing={listingId:'listing-fixture',listingStatus:'ACTIVE',soldQuantity:0};data={listingId:'listing-fixture'};}
  else if(path==='/bulk_update_price_quantity'){state.offer.pricingSummary.price=structuredClone(body.requests[0].offers[0].price);data={responses:[{sku:state.offer.sku,offerId:state.offer.offerId,statusCode:200}]};}
  else if(path.endsWith('/withdraw')){state.offer.status='UNPUBLISHED';state.offer.listing.listingStatus='ENDED';data={listingId:'listing-fixture'};}
  else throw Error('Unexpected provider call '+method+' '+path);
  if(write&&state.after)await state.after(call);
  return data===null?new Response(null,{status:204}):Response.json(structuredClone(data));
 }
 const h=createHandler({env,verify:async token=>({uid:token}),store:kv,fetcher,photoHost,referenceLoader:async()=>reference,executionEnabled:true});
 const off=createHandler({env,verify:async token=>({uid:token}),store:kv,fetcher,photoHost,referenceLoader:async()=>reference});
 async function reset() {
  await kv('DEL',key,listingIndex('production',uid),accountListingsKey('production',connection.accountHash),'ebaylisting:rate:production:'+hash(uid),k.prefix+'deleted:'+connection.accountHash);
  await kv('SET',dk,JSON.stringify(draft));await kv('SET',rk,JSON.stringify(review));await kv('SET',k.connection,JSON.stringify(connection));
  await kv('SET','userdata:'+uid,JSON.stringify({portfolio:[{id:uid,card:'Charizard',quantity:1}],flips:[],tombstones:{portfolio:{},flips:{}}}));
  Object.assign(state,{item:null,offer:null,fee:'0.35',writes:[],calls:[],before:null,after:null,extraOffers:[],failRead:false});
 }
 async function call(action,options={}) {
  const {handler=h,who=uid,method=action?'POST':'GET',origin=env.EBAY_SELLER_ORIGIN,...extra}=options;
  const current=JSON.parse(await kv('GET',key)||'null');
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(data){this.data=data;return this;}};
  await handler({method,headers:{...(who?{authorization:'Bearer '+who}:{}),origin},query:{draftId:draft.draftId},body:{action,draftId:draft.draftId,confirmed:true,expectedReviewRev:1,photos:[photo],expectedRev:current?.rev,...extra}},res);return res;
 }
 await reset();return {uid,cfg,draft,read,k,dk,rk,key,connection,review,state,fetcher,h,off,reset,call};
}
