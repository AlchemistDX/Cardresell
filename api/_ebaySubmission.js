// A submission review is separate from the manual-export packet. Only current
// eBay metadata can resolve descriptor IDs and constrained item specifics.
import {hash} from './_ebaySeller.js';
import {validateDraftForSlot} from './_draftStore.js';
import {canonicalGrade,canonicalGrader} from './_cardIdentity.js';
import {usableInventoryLocation} from './_ebaySetup.js';

export const REVIEW_TTL = 30 * 86400;
export const REVIEW_FRESH_MS = 10 * 60 * 1000;
export const copySku = (environment, owner, instanceId) => 'cr1_' + hash(JSON.stringify([environment,owner,instanceId])).slice(0,46);
export const reviewKey = (environment, owner, draftId) => `ebayreview:v1:${environment}:${hash(owner)}:${draftId}`;
export const accountReviewsKey = (environment, account) => `ebayreview:v1:${environment}:account:${account}`;
const text = (v,max=200) => typeof v==='string' && v.length<=max && !/[\x00-\x1f]/.test(v) ? v.trim() : '';
export const fail = (message,status=400) => Object.assign(new Error(message),{status});
const object = v => v && typeof v==='object' && !Array.isArray(v);
export function selections(value={}) {
  if(!object(value)||Object.keys(value).some(k=>!['aspects','descriptors','fulfillmentPolicyId','paymentPolicyId','returnPolicyId','merchantLocationKey','detailsConfirmed','copyAvailable','photoIds'].includes(k)))throw fail('Review settings are not valid. Reload this draft.');
  const out={aspects:{},descriptors:{}};
  for(const field of ['fulfillmentPolicyId','paymentPolicyId','returnPolicyId','merchantLocationKey']) {
    out[field]=text(value[field]||'',100);if(value[field]&&!out[field])throw fail('A selling setting is not valid.');
  }
  for(const field of ['aspects','descriptors']) {
    const source=value[field]||{};
    if(!object(source)||Object.keys(source).length>80)throw fail('Too many listing fields.');
    for(const [key,raw] of Object.entries(source)) {
      if(!text(key,100)||['__proto__','constructor','prototype'].includes(key))throw fail('A listing field is not valid.');
      if(!Array.isArray(raw)||raw.length>30||raw.some(v=>typeof v!=='string'||v.length>200||/[\x00-\x1f]/.test(v)))throw fail('A listing value is not valid.');
      out[field][key]=[...new Set(raw.map(v=>v.trim()).filter(Boolean))];
    }
  }
  if(value.photoIds!==undefined && (!Array.isArray(value.photoIds)||value.photoIds.length>12||value.photoIds.some(v=>!text(v,100))))throw fail('Choose up to 12 listing photos.');
  out.photoIds=[...new Set(value.photoIds||[])];
  out.detailsConfirmed=value.detailsConfirmed===true;out.copyAvailable=value.copyAvailable===true;
  return out;
}

export function buildSubmissionReview({read,owner,environment='production',connected=false,selected={},reference=null,photos=[],photoIssue=null,now=Date.now()}) {
  const d=read.draft,p=read.packet,chosen=selections(selected),issues=[];
  const add=(code,message,severity='error')=>issues.push({code,message,severity});
  const validation=validateDraftForSlot(d);
  if(!validation.ok)add('DRAFT_FIELDS','Fix the card and price issues in this draft first.');
  if(d.slot!=='ebay:fixed-price'||d.quantity!==1)add('SINGLE_COPY_ONLY','Direct preparation supports one physical card in a US fixed-price listing.');
  if(d.status!=='draft')add('DRAFT_STATE','This draft is not editable.');
  if(!read.packetUsable||!p)add('PACKET_STALE','Refresh the saved listing details before checking eBay requirements.');
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(d.instanceId||''))add('COPY_ID','This draft has no valid physical-copy identifier.');
  if(!['183454','261328','183050'].includes(String(p?.category?.id)))add('CATEGORY','This card category is not supported for direct preparation.');
  if(!Number.isFinite(d.price)||d.price<=0||d.price>999999.99||Math.abs(d.price*100-Math.round(d.price*100))>0.00001)add('PRICE','Set a positive USD asking price with no more than two decimal places.');
  if(!text(d.title,80))add('TITLE','Use a title of 1–80 characters.');
  if(typeof p?.description?.text!=='string'||!p.description.text.trim()||p.description.text.length>4000||/[\x00-\x08\x0b-\x1f]/.test(p.description.text))add('DESCRIPTION','Refresh this draft to produce its listing description.');
  if(p?.blocked)add('PACKET_BLOCKED','Resolve the blocking issues in the saved listing details first.');
  if(!chosen.detailsConfirmed)add('DETAILS_CONFIRMATION','Confirm the card identity, condition and selling terms after reviewing them.');
  if(!chosen.copyAvailable)add('COPY_CONFIRMATION','Confirm this physical copy is available to sell.');
  if(photoIssue)add('PHOTOS',photoIssue);
  if(!photos.length)add('PHOTOS_REQUIRED','Add your own card photos, prepare their hosted copies, and check again. Catalogue artwork is excluded.');
  if(photos.length!==chosen.photoIds.length)add('PHOTO_SELECTION','Every selected photo needs a verified hosted copy.');

  const base={...(p?.aspects?.required||{}),...(p?.aspects?.optional||{})},aspects={},descriptors=[];
  if(!reference)add(connected?'REQUIREMENTS_PENDING':'CONNECTION',connected?'Your eBay account is connected. Load current eBay requirements to review category rules and seller settings.':'Connect your eBay seller account to check current category rules and seller settings.');
  else {
    if(reference.sellerRegistered!==true)add('SELLER_SETUP','eBay has not confirmed that seller registration is complete.');
    if(String(reference.categoryId)!==String(p?.category?.id)||!Array.isArray(reference.aspects)||!reference.aspects.length)add('METADATA','Current eBay item-specific rules could not be confirmed.');
    const rules=reference.aspects||[],names=new Set(rules.map(a=>a.localizedAspectName));
    for(const key of Object.keys(chosen.aspects))if(!names.has(key))add('ASPECT_UNKNOWN','The item-specific field “'+key+'” is not in the current category rules.');
    for(const key of Object.keys(base))if(!names.has(key))add('ASPECT_OMITTED','The saved field “'+key+'” is not supported by this category and is omitted.','warning');
    const values={...base,...chosen.aspects};
    for(const a of rules) {
      const name=a.localizedAspectName,c=a.aspectConstraint||{},v=values[name]||[];
      if(!Array.isArray(v)||v.some(x=>typeof x!=='string')){add('ASPECT_INVALID','Review “'+name+'”.');continue;}
      if(c.aspectRequired&&!v.length)add('ASPECT_REQUIRED','Enter “'+name+'”.');
      if(!v.length)continue;
      if(!['FREE_TEXT','SELECTION_ONLY'].includes(c.aspectMode)||!['SINGLE','MULTI'].includes(c.itemToAspectCardinality)||c.aspectAdvancedDataType||c.aspectFormat||!['STRING',undefined].includes(c.aspectDataType))add('ASPECT_RULE_UNSUPPORTED','The current format rule for “'+name+'” needs additional support.');
      if(c.itemToAspectCardinality==='SINGLE'&&v.length!==1)add('ASPECT_CARDINALITY','Choose one value for “'+name+'”.');
      if(v.some(x=>!text(x,Math.min(c.aspectMaxLength||65,200))))add('ASPECT_LENGTH','Shorten “'+name+'” to the category limit.');
      for(const entry of v) {
        const options=(a.aspectValues||[]).filter(o=>o.localizedValue===entry);
        if(c.aspectMode==='SELECTION_ONLY'&&options.length!==1)add('ASPECT_VALUE','Choose an eBay-supported value for “'+name+'”.');
        if(options.length===1)for(const constraint of options[0].valueConstraints||[]) {
          const other=values[constraint.applicableForLocalizedAspectName];
          if(!Array.isArray(other)||!Array.isArray(constraint.applicableForLocalizedAspectValues)||!other.some(x=>constraint.applicableForLocalizedAspectValues.includes(x)))add('ASPECT_DEPENDENCY','“'+name+'” does not match its related item-specific selection.');
        }
      }
      aspects[name]=v;
    }
    const condition=reference.condition;
    if(!condition||String(condition.conditionId)!==String(p?.condition?.conditionId)||!Array.isArray(condition.conditionDescriptors)||!condition.conditionDescriptors.length)add('CONDITION_METADATA','Current eBay condition rules could not be confirmed.');
    const rulesD=condition?.conditionDescriptors||[],ids=new Set(rulesD.map(x=>String(x.conditionDescriptorId)));
    if(p?.condition?.cert&&!chosen.descriptors['27503']?.length)add('CERTIFICATE_REQUIRED','Keep the saved certificate number with this physical slab.');
    for(const key of Object.keys(chosen.descriptors))if(!ids.has(key))add('CONDITION_UNKNOWN','A selected condition descriptor no longer exists. Choose it again.');
    for(const r of rulesD) {
      const id=String(r.conditionDescriptorId),name=r.conditionDescriptorName,c=r.conditionDescriptorConstraint||{},v=chosen.descriptors[id]||[];
      if(c.usage==='REQUIRED'&&!v.length)add('CONDITION_REQUIRED','Choose “'+name+'”.');
      if(!v.length)continue;
      if(!/^\d+$/.test(id)||!['FREE_TEXT','SELECTION_ONLY'].includes(c.mode)||!['SINGLE','MULTI'].includes(c.cardinality))add('CONDITION_RULE_UNSUPPORTED','The current rule for “'+name+'” needs additional support.');
      if(c.cardinality==='SINGLE'&&v.length!==1)add('CONDITION_CARDINALITY','Choose one value for “'+name+'”.');
      for(const dep of c.applicableToConditionDescriptorIds||[])if(!chosen.descriptors[dep]?.length)add('CONDITION_DEPENDENCY','Choose the related descriptor for “'+name+'”.');
      if(c.mode==='FREE_TEXT') {
        if(id!=='27503'||v.length!==1||!text(v[0],Math.min(c.maxLength||30,30)))add('CERTIFICATE','Review the certificate number; it must fit eBay’s limit.');
        if(p?.condition?.cert && v[0]!==String(p.condition.cert))add('CERTIFICATE_MISMATCH','The certificate number must match the saved slab.');
        descriptors.push({name:id,additionalInfo:v[0]});
      } else {
        for(const value of v) {
          const matches=(r.conditionDescriptorValues||[]).filter(x=>String(x.conditionDescriptorValueId)===value);
          if(matches.length!==1){add('CONDITION_VALUE','Choose an eBay-supported value for “'+name+'”.');continue;}
          const label=matches[0].conditionDescriptorValueName;
          if(id==='27502'&&canonicalGrade({grade:label})!==p?.condition?.grade)add('GRADE_MISMATCH','The selected grade must match the saved slab; unfamiliar eBay labels require support before submission.');
          if(id==='27501'&&canonicalGrader({grader:label})!==p?.condition?.grader&&String(label).match(/\(([A-Z0-9]+)\)$/)?.[1]!==p?.condition?.grader)add('GRADER_MISMATCH','The selected grader must match the saved slab.');
          for(const dep of matches[0].conditionDescriptorValueConstraints||[])if(!Array.isArray(dep.applicableToConditionDescriptorValueIds)||!chosen.descriptors[dep.applicableToConditionDescriptorId]?.some(x=>dep.applicableToConditionDescriptorValueIds.includes(x)))add('CONDITION_VALUE_DEPENDENCY','The selected grade and grader must be a supported combination.');
        }
        descriptors.push({name:id,values:v});
      }
    }
    for(const type of ['fulfillment','payment','return']) {
      const field=type+'PolicyId',list=reference[type+'Policies']||[],matches=list.filter(x=>typeof x?.[field]==='string'&&x[field]===chosen[field]&&x.marketplaceId==='EBAY_US');
      if(!chosen[field]||matches.length!==1)add('POLICY_'+type.toUpperCase(),'Choose a current US '+type+' policy from your eBay account.');
      else if(type==='fulfillment'&&matches[0].shippingOptions?.some(x=>x.costType==='CALCULATED'))add('PACKAGE_REQUIRED','Calculated shipping needs package weight and dimensions, which this preparation flow does not support yet.');
    }
    const location=(reference.locations||[]).filter(x=>x.merchantLocationKey===chosen.merchantLocationKey&&usableInventoryLocation(x));
    if(!chosen.merchantLocationKey||location.length!==1)add('LOCATION','Choose an enabled inventory location with a complete address.');
  }
  const payloadReady=!issues.some(i=>i.severity==='error'),sku=copySku(environment,owner,d.instanceId);
  // eBay interprets descriptions as HTML. Card names and other saved strings
  // remain text even when they contain markup.
  const description=p?.description?.text?.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])).replace(/\n/g,'<br>');
  const payload=payloadReady?{
    sku,
    inventoryItem:{availability:{shipToLocationAvailability:{quantity:1}},condition:p.condition.graded?'LIKE_NEW':'USED_VERY_GOOD',conditionDescriptors:descriptors,
      product:{title:d.title,description,aspects,imageUrls:photos.map(p=>p.url)}},
    offer:{sku,marketplaceId:'EBAY_US',format:'FIXED_PRICE',availableQuantity:1,categoryId:String(p.category.id),listingDuration:'GTC',includeCatalogProductDetails:false,
      merchantLocationKey:chosen.merchantLocationKey,listingPolicies:Object.fromEntries(['fulfillmentPolicyId','paymentPolicyId','returnPolicyId'].map(k=>[k,chosen[k]])),pricingSummary:{price:{currency:'USD',value:d.price.toFixed(2)}},listingDescription:description},
  }:null;
  return {version:1,draftId:d.draftId,draftRev:d.rev,instanceId:d.instanceId,sku,marketplace:'EBAY_US',checkedAt:now,expiresAt:now+REVIEW_FRESH_MS,
    requirements:reference?{treeId:reference.treeId,treeVersion:reference.treeVersion,fingerprint:hash(JSON.stringify(reference))}:null,
    payloadReady,publishingEnabled:false,issues,payload,selected:chosen,
    summary:{title:d.title,price:d.price,condition:p?.condition?.conditionLabel||null,category:p?.category?.label||null,photoCount:photos.length},
    notice:'This review does not create, publish, revise or end an eBay listing. Publishing and sale synchronization are not enabled.'};
}
