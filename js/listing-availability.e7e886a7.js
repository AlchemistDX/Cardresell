/* Read-only checks; exports never clear a reservation or mark a card sold. */
(() => {
 'use strict';
 const account=()=>window.googleUser?.uid||window.googleUser?.sub||null;
 let owner=null,rows=new Map(),lastKey='',checkedAt=0,serial=0,pending=null;
 const announce=()=>window.dispatchEvent(new Event('cr:listing-availability'));
 function sync(){if(owner!==account()){owner=account();rows.clear();lastKey='';checkedAt=0;pending=null;serial++;}}
 async function request(body,who) {
  if(!who||account()!==who)throw Error('Sign in again to check listing availability.');
  const token=await _crIdToken();if(!token||account()!==who)throw Error('Your account changed. Refresh before exporting.');
  const response=await fetch('/api/listing-availability',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const data=await response.json();if(account()!==who)throw Error('Your account changed. Refresh before exporting.');
  if(!response.ok)throw Error(data.error||'Availability could not be checked. Retry before exporting.');
  const expected=body.copyIds||body.drafts.map(d=>d.draftId),field=body.copyIds?'copyId':'draftId';
  if(data.version!==1||data.environment!=='production'||!Number.isFinite(data.checkedAt)||!Array.isArray(data.records)||data.records.length!==expected.length||data.records.some((r,i)=>r?.[field]!==expected[i]||typeof r.instanceId!=='string'||!r.instanceId||typeof r.label!=='string'||typeof r.canExport!=='boolean'||!['clear','untracked','held','sold','not_synced','grouped','unknown'].includes(r.state)||(r.canExport!==['clear','untracked'].includes(r.state))||(body.drafts&&r.rev!==body.drafts[i].rev)))throw Error('Availability returned an incomplete result. Retry before exporting.');
  return data;
 }
 function peek(id){sync();return rows.get(String(id))||null;}
 async function refresh(ids,{force=false}={}) {
  sync();const who=owner;if(!who)return;
  ids=[...new Set(ids.map(String))];if(!ids.length)return;
  const key=JSON.stringify(ids);
  if(!force&&key===lastKey&&Date.now()-checkedAt<30000)return;
  if(pending?.key===key)return pending.promise;
  const n=++serial;lastKey=key;checkedAt=0;rows=new Map(ids.map(id=>[id,{state:'loading',label:'Checking saved listing status…'}]));announce();
  const promise=(async()=>{
   try{const data=await request({copyIds:ids},who);if(account()!==who||serial!==n)return;rows=new Map(data.records.map(r=>[r.copyId,r]));checkedAt=Date.now();}
   catch(error){if(account()!==who||serial!==n)return;rows=new Map(ids.map(id=>[id,{state:'unknown',label:'Listing status unavailable · retry check'}]));}
   finally{if(account()===who&&serial===n){pending=null;announce();}}
  })();pending={key,promise};await promise;
 }
 async function checkDrafts(drafts) {
  sync();const who=owner,instances=new Set();
  // A large combined download is one selection. No file is emitted until all
  // chunks pass; every chunk is checked again after its photos are prepared.
  for(let offset=0;offset<drafts.length;offset+=100){
   const data=await request({drafts:drafts.slice(offset,offset+100)},who);
   for(const row of data.records){if(instances.has(row.instanceId))throw Error('No listing file was created. Two selected drafts refer to the same physical copy. Choose one draft for that copy.');instances.add(row.instanceId);}
   const tracked=data.records.filter(r=>r.copyId!==null).map(r=>({id:r.copyId}));
   if(tracked.length&&window.CardResellSaleRecovery&&window.CardResellSaleRecovery.availableRowsStrict(tracked).length!==tracked.length)throw Error('No listing file was created. A selected copy has a sale saved on this device. Review it in Flips and sync your Collection.');
   const blocked=data.records.find(r=>!r.canExport);
   if(blocked)throw Error('No listing file was created. '+blocked.label+'. '+(blocked.operationId?'Open eBay listing operations to review this copy.':'Review this card in Collection and sync it before trying again.'));
  }
 }
 window.addEventListener('cr:listing-availability-changed',()=>{sync();checkedAt=0;lastKey='';rows.clear();serial++;pending=null;announce();});
 window.CardResellListingAvailability={peek,refresh,checkDrafts,checkedAt:()=>{sync();return checkedAt;}};
})();
