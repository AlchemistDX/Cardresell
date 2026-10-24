import {mint,ebayJson,hash} from './_ebaySeller.js';
import {fail} from './_ebaySubmission.js';
import {checkPhotoId} from './_photoAuth.js';
import {sellerSetupIssue} from './_ebaySetup.js';

const appTokens=new WeakMap();
async function applicationToken(cfg,fetcher) {
  let pool=appTokens.get(fetcher);if(!pool){pool=new Map();appTokens.set(fetcher,pool);}
  const key=hash(JSON.stringify([cfg.environment,cfg.appId,cfg.certId]));
  let entry=pool.get(key);
  if(entry&&entry.until>Date.now())return {token:await entry.token,clear:()=>pool.delete(key)};
  if(pool.size>=4)pool.clear();
  entry={until:Infinity};
  entry.token=mint(cfg,{grant_type:'client_credentials',scope:'https://api.ebay.com/oauth/api_scope'},fetcher).then(data=>{entry.until=Date.now()+Math.max(0,data.expires_in*1000-120000);return data.access_token;}).catch(error=>{pool.delete(key);throw error;});
  pool.set(key,entry);return {token:await entry.token,clear:()=>pool.delete(key)};
}

// Application credentials read public category rules; the seller token reads
// only that seller's policies and locations. Sandbox never uses Production.
export async function listingReference(cfg,token,categoryId,conditionId,fetcher=fetch) {
  if(!['183454','261328','183050'].includes(String(categoryId)))throw fail('This category is not supported.');
  const app=await applicationToken(cfg,fetcher);
  const get=async(path,t=token)=>{try{return await ebayJson(cfg,path,t,(url,opts)=>fetcher(url,{...opts,headers:{...opts.headers,'Accept-Language':'en-US'}}));}catch(error){if(t===app.token&&error.status===409){app.clear();throw fail('eBay category authorization could not be verified. Try the review again.',502);}throw error;}};
  const tree=await get('/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US',app.token);
  if(!/^\d+$/.test(String(tree.categoryTreeId))||!tree.categoryTreeVersion)throw fail('eBay category metadata is unavailable.',502);
  const paths=[
    ['/commerce/taxonomy/v1/category_tree/'+tree.categoryTreeId+'/get_item_aspects_for_category?category_id='+categoryId,app.token],
    ['/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies?filter='+encodeURIComponent('categoryIds:{'+categoryId+'}'),app.token],
    ['/sell/account/v1/privilege'],['/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US'],
    ['/sell/account/v1/payment_policy?marketplace_id=EBAY_US'],['/sell/account/v1/return_policy?marketplace_id=EBAY_US'],
    ['/sell/inventory/v1/location?limit=100'],
  ];
  const results=await Promise.allSettled(paths.map(([path,t])=>get(path,t)));
  const failed=results.findIndex(r=>r.status==='rejected');
  if(failed>=0) {
    const error=results[failed].reason;
    if(failed>=2)throw fail(sellerSetupIssue(['registration','fulfillment','payment','return','location'][failed-2],error).message,error.status||502);
    throw error;
  }
  const [aspects,conditions,privilege,fulfillment,payment,returns,location]=results.map(r=>r.value);
  const policies=conditions.itemConditionPolicies?.filter(p=>String(p.categoryId)===String(categoryId));
  if(policies?.length!==1||!Array.isArray(aspects.aspects))throw fail('eBay returned incomplete category requirements.',502);
  const condition=policies[0].itemConditions?.filter(c=>String(c.conditionId)===String(conditionId));
  if(condition?.length!==1)throw fail('eBay did not confirm this card’s condition category.',502);
  const cap=(v,max)=>{if(!Array.isArray(v)||v.length>max)throw fail('eBay returned incomplete seller requirements.',502);return v;};
  const locations=cap(location.locations,100);
  // A truncated list must not be presented as the seller's complete choices.
  if(location.next||Number(location.total)>locations.length)throw fail('This seller has more inventory locations than this review currently supports.',409);
  return {categoryId:String(categoryId),treeId:String(tree.categoryTreeId),treeVersion:String(tree.categoryTreeVersion),
    aspects:cap(aspects.aspects,200),condition:condition[0],sellerRegistered:privilege.sellerRegistrationCompleted===true,
    fulfillmentPolicies:cap(fulfillment.fulfillmentPolicies,500),paymentPolicies:cap(payment.paymentPolicies,500),returnPolicies:cap(returns.returnPolicies,500),locations};
}

// Only selected objects under the authenticated owner's existing photo host
// are checked. Never follow a URL or object key supplied by the browser.
export async function reviewedPhotos({owner,draftId,selected,photos,host,now=Date.now()}) {
  if(!selected.photoIds.length)return {photos:[],photoIssue:null};
  if(!host)return {photos:[],photoIssue:'Photo hosting is not configured. Your local card photos remain available for manual export.'};
  if(!Array.isArray(photos)||photos.length>12)throw fail('The photo selection is not valid.');
  const inputs=selected.photoIds.map(id=>{
    const rows=photos.filter(p=>p?.photoId===id),p=rows[0];
    if(rows.length!==1||!checkPhotoId(id)||!['image/jpeg','image/png'].includes(p.contentType)||!Number.isInteger(p.byteLength)||p.byteLength<=0||p.byteLength>20*1024*1024||!/^([a-f0-9]{64})$/.test(p.sha256))throw fail('A selected photo could not be verified. Prepare its hosted copy again.');
    const key=host.objectKey({ownerNs:host.ownerNamespace(owner),draftId,photoId:id,sha256:p.sha256,ext:p.contentType==='image/png'?'.png':'.jpg'});
    return {id,p,key};
  });
  const results=await Promise.allSettled(inputs.map(async({id,p,key})=>{
    const head=await host.head(key);
    if(!head.exists||head.byteLength!==p.byteLength||head.contentType?.split(';')[0]!==p.contentType)throw fail('A selected hosted photo is missing or changed. Prepare its hosted copy again.',409);
    // This is a current existence check, not a renewal or a promise that a
    // later publish can skip checking the photo again.
    const url=host.publicUrl(key),u=new URL(url);
    if(u.protocol!=='https:'||u.username||u.password||url.length>2048)throw fail('The photo host returned an unusable link.',502);
    return {photoId:id,url,sha256:p.sha256,checkedAt:now};
  }));
  const failure=results.find(r=>r.status==='rejected');
  if(failure)return {photos:[],photoIssue:failure.reason.status?failure.reason.message:'The photo host could not verify every selected photo. Try again.'};
  return {photos:results.map(r=>r.value),photoIssue:null};
}
