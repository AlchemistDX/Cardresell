// Inventory API transport. No retries, redirects or client-supplied URLs.
import {fail} from './_ebaySubmission.js';
import {hash} from './_ebaySeller.js';

export const WRITE_SCOPE='https://api.ebay.com/oauth/api_scope/sell.inventory';
export const canonical=value=>JSON.stringify(sort(value));
function sort(v) {
 if(Array.isArray(v))return v.map(sort);
 if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])]));
 return v;
}
export const fingerprint=value=>hash(canonical(value));
export const validExternalId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
export function usd(v,{zero=false}={}) {
 const s=typeof v==='number'?String(v):v;
 if(typeof s!=='string'||!/^\d{1,6}(?:\.\d{1,2})?$/.test(s)||Number(s)>(999999.99)||Number(s)<(zero?0:0.01))throw fail('Use a valid USD amount with at most two decimal places.');
 return Number(s).toFixed(2);
}
function contains(actual,expected) {
 if(Array.isArray(expected))return Array.isArray(actual)&&canonical(actual)===canonical(expected);
 if(expected&&typeof expected==='object')return actual&&typeof actual==='object'&&Object.entries(expected).every(([k,v])=>contains(actual[k],v));
 return actual===expected;
}
export function sameInventory(actual,payload) {
 return actual?.sku===payload.sku&&contains(actual,payload.inventoryItem);
}
export function sameOffer(actual,payload,{price=payload.offer.pricingSummary.price.value,quantity=true}={}) {
 const expected=structuredClone(payload.offer);expected.pricingSummary.price.value=price;
 if(!quantity)delete expected.availableQuantity;
 // Price representations may omit trailing zeroes in provider reads.
 let normalized;try{normalized=usd(actual?.pricingSummary?.price?.value);}catch{return false;}
 const copy={...actual,pricingSummary:{...actual.pricingSummary,price:{...actual.pricingSummary.price,value:normalized}}};
 if(['charity','regulatory','tax','extendedProducerResponsibility','listingStartDate','secondaryCategoryId','storeCategoryNames'].some(k=>actual[k]!=null))return false;
 if(actual.lotSize!=null&&actual.lotSize!==1)return false;
 return contains(copy,expected);
}
export function parseFees(data) {
 const summaries=data?.feeSummaries;
 if(!Array.isArray(summaries)||summaries.length!==1||summaries[0].marketplaceId!=='EBAY_US'||summaries[0].warnings?.length)throw fail('eBay did not return a complete US listing fee estimate.',502);
 const fees=summaries[0].fees;
 if(!Array.isArray(fees)||!fees.length||fees.length>50)throw fail('eBay listing fees are unknown. Publication remains blocked.',502);
 const rows=fees.map(f=>{
  if(typeof f.feeType!=='string'||!f.feeType||f.feeType.length>100||/[\x00-\x1f]/.test(f.feeType)||f.amount?.currency!=='USD')throw fail('The eBay fee estimate could not be verified.',502);
  const row={type:f.feeType,amount:usd(f.amount.value,{zero:true}),currency:'USD'};
  if(f.promotionalDiscount){if(f.promotionalDiscount.currency!=='USD')throw fail('The eBay fee discount could not be verified.',502);row.promotionalDiscount=usd(f.promotionalDiscount.value,{zero:true});}
  return row;
 }).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
 return {rows,fingerprint:fingerprint(rows),checkedAt:Date.now(),expiresAt:Date.now()+300000,
  notice:'Expected listing fees from eBay for this offer. Actual sale fees, shipping, taxes, refunds and profit are not confirmed.'};
}
export function inventoryApi(cfg,token,fetcher=fetch) {
 async function request(path,{method='GET',body,missing=false}={}) {
  const r=await fetcher(cfg.api+'/sell/inventory/v1'+path,{method,headers:{Authorization:'Bearer '+token,Accept:'application/json','Accept-Language':'en-US','Content-Language':'en-US',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(12000)});
  if(missing&&r.status===404)return null;
  if(!r.ok)throw fail(r.status===401?'eBay authorization expired. Reconnect before recovering this operation.':'eBay could not confirm the request. The copy remains reserved; check its status before trying anything else.',r.status===401?409:502);
  if(r.status===204)return null;
  const data=await r.json();if(!data||typeof data!=='object'||Array.isArray(data))throw fail('eBay returned an unreadable result. Check the saved operation.',502);
  return data;
 }
 return {
  inventory:sku=>request('/inventory_item/'+encodeURIComponent(sku),{missing:true}),
  async offers(sku) {
   // Query every marketplace/format for this physical SKU. A second offer,
   // pagination or incomplete result cannot be interpreted as an empty slot.
   const data=await request('/offer?'+new URLSearchParams({sku,limit:'10'}),{missing:true});if(data===null)return [];
   if(!Array.isArray(data.offers)||!Number.isInteger(data.total)||data.total!==data.offers.length||data.total>10||data.next||data.offers.some(o=>o.sku!==sku))throw fail('eBay returned an incomplete offer list. The copy remains reserved.',502);
   return data.offers;
  },
  offer:id=>request('/offer/'+encodeURIComponent(id),{missing:true}),
  fees:async id=>parseFees(await request('/offer/get_listing_fees',{method:'POST',body:{offers:[{offerId:id}]}})),
  saveInventory:p=>request('/inventory_item/'+encodeURIComponent(p.sku),{method:'PUT',body:p.inventoryItem}),
  createOffer:p=>request('/offer',{method:'POST',body:p.offer}),
  publish:id=>request('/offer/'+encodeURIComponent(id)+'/publish',{method:'POST'}),
  async price(sku,id,value) {
   // Never include quantity: a price change must not replenish a sold card.
   const data=await request('/bulk_update_price_quantity',{method:'POST',body:{requests:[{sku,offers:[{offerId:id,price:{currency:'USD',value}}]}]}});
   const rows=data.responses;
   if(!Array.isArray(rows)||rows.length!==1||rows[0].offerId!==id||rows[0].sku!==sku||rows[0].statusCode<200||rows[0].statusCode>=300||rows[0].errors?.length)throw fail('eBay did not confirm the price update. Recover its saved status.',502);
   return data;
  },
  end:id=>request('/offer/'+encodeURIComponent(id)+'/withdraw',{method:'POST'}),
 };
}
