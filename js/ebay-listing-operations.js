/* Durable physical-copy plans and read-only recovery. No browser write queue. */
(() => {
 'use strict';
 const owner=()=>window.googleUser?.sub||window.googleUser?.uid||null;
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
 const button=(text,fn)=>{const b=el('button',text);b.type='button';b.onclick=fn;return b;};
 const labels={planned:'Plan saved · not sent',inventory_saved:'Inventory confirmed · offer not created',offer_saved:'Unpublished offer confirmed',pending:'Request outcome uncertain',live:'Last confirmed active',ended:'Offer ended · copy held',cancelled:'Unsent plan cancelled',account_changed:'Original seller connection required',account_deleted:'Account data erased · copy held'};
 let active=null;
 async function open({draftId,id,environment}={}) {
  const returnFocus=document.activeElement;
  if(active)active.dialog.close();
  const who=owner();if(!who){window.showToast?.('Sign in to recover your eBay listing operations.');return;}
  if(!document.getElementById('ebayOperationsStyle')) {
   const style=el('style');style.id='ebayOperationsStyle';style.textContent=`
.ebay-operations{margin:auto;width:min(700px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;box-sizing:border-box;padding:20px;border:1px solid var(--border,#555);border-radius:16px;background:var(--bg,#111);color:var(--text,#eee)}.ebay-operations::backdrop{background:rgba(0,0,0,.75)}.ebay-operations header,.ebay-operation-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.ebay-operations h2{font-size:1.2rem;margin:0}.ebay-operations h3{font-size:1rem;margin:0}.ebay-operations p,.ebay-operations label,.ebay-operations li{font-size:.9rem;line-height:1.6;overflow-wrap:anywhere}.ebay-operations section{margin:16px 0;padding:14px;background:var(--surface-2,#222);border:1px solid var(--border,#444);border-radius:10px}.ebay-operations button{font:inherit;min-height:44px;padding:10px 14px;border:1px solid var(--border,#555);border-radius:8px;background:var(--surface-2,#222);color:var(--text,#eee);cursor:pointer}.ebay-operations button:disabled{opacity:.5;cursor:default}.ebay-operations button:focus-visible,.ebay-operations input:focus-visible{outline:2px solid var(--gold,#d4af37);outline-offset:2px}.ebay-operations [role=alert]{color:var(--danger-text,#ff9999)}.ebay-operations label{display:flex;align-items:flex-start;gap:10px;margin:14px 0}.ebay-operations input[type=checkbox]{flex-shrink:0;width:20px;height:20px;margin-top:3px}.ebay-operations [hidden]{display:none!important}
`;document.head.append(style);
  }
  const dialog=el('dialog');dialog.id='ebayListingOperations';dialog.className='ebay-operations';dialog.setAttribute('aria-labelledby','ebayOperationsTitle');
  const state={dialog,who,closed:false,busy:false,data:null};active=state;
  const valid=()=>!state.closed&&active===state&&owner()===who;
  const header=el('header'),title=el('h2','eBay listing operations');title.id='ebayOperationsTitle';header.append(title,button('Close',()=>dialog.close()));
  const status=el('p','Loading saved operations…');status.setAttribute('role','status');const error=el('p');error.setAttribute('role','alert');const content=el('div'),actions=el('div');actions.className='ebay-operation-actions';
  dialog.append(header,status,error,content,actions);document.body.append(dialog);dialog.showModal();
  const timer=setInterval(()=>{if(owner()!==who)dialog.close();},250);
  dialog.addEventListener('close',()=>{state.closed=true;clearInterval(timer);dialog.remove();if(active===state)active=null;if(returnFocus?.isConnected&&returnFocus.offsetParent)returnFocus.focus();else document.getElementById('collectionDraftTools')?.querySelector('button')?.focus();},{once:true});
  async function request(path,body) {
   if(!valid())throw Error('Your account changed. Reopen listing operations.');
   const token=await _crIdToken();if(!valid()||!token)throw Error('Sign in again to continue.');
   const r=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
   const data=await r.json();if(!valid())throw Error('Your account changed. Reopen listing operations.');
   if(!r.ok)throw Error(data.error||'Could not load the saved operation. Use Reload saved status to recover.');return data;
  }
  async function run(fn) {
   if(state.busy||!valid())return;state.busy=true;error.textContent='';content.inert=true;actions.querySelectorAll('button').forEach(b=>b.disabled=true);
   try{await fn();}catch(e){if(valid()){error.textContent=e.message;status.textContent=state.data?'Showing the last loaded status. Reload to check for changes.':(draftId?'Saved status could not be loaded. Retry, or view all saved operations to find an existing plan.':'Saved operations could not be loaded. Use Reload saved status to try again.');}}finally{state.busy=false;if(valid()){content.inert=false;actions.querySelectorAll('button').forEach(b=>b.disabled=false);}}
  }
  function confirmation(host,text,label,fn) {
   const wrap=el('div'),row=el('label'),input=el('input');input.type='checkbox';row.append(input,el('span',text));
   const b=button(label,()=>run(async()=>{if(!input.checked)throw Error('Confirm this action first.');await fn();}));b.disabled=true;input.onchange=()=>b.disabled=!input.checked;wrap.append(row,b);host.append(wrap);
  }
  async function act(record,action) {
   await request('/api/ebay-listing-operations',{action,id:record.id,environment:state.data?.environment,expectedRev:record.rev,confirmed:true});window.dispatchEvent(new Event('cr:listing-availability-changed'));await load();
  }
  function navigation() {
   actions.replaceChildren(button('Reload saved status',()=>run(load)));
   if(draftId||id)actions.append(button('View all saved operations',()=>{
    if(state.busy||!valid())return;
    dialog.close();open({environment});
   }));
  }
  async function load() {
   const query=new URLSearchParams({...id?{id}:draftId?{draftId}:{},...environment?{environment}:{}});
   const data=await request('/api/ebay-listing-operations'+(query.size?'?'+query:''));state.data=data;
   content.replaceChildren();navigation();
   status.textContent=data.notice;
   if(!data.records.length)content.append(el('p',draftId?'No saved eBay listing plan for this copy.':'No saved eBay listing operations. Open a draft, check direct eBay readiness, then save its listing plan when the checks pass.'));
   for(const r of data.records) {
    const card=el('section');card.append(el('h3',r.title||'Physical copy '+r.instanceId),el('p',labels[r.state]||'Recovery required'));
    card.append(el('p',r.note),el('p','Copy: '+r.instanceId));
    if(r.updatedAt)card.append(el('p','Saved status: '+new Date(r.updatedAt).toLocaleString()));
    if(r.price)card.append(el('p','Saved eBay asking price: $'+r.price+' USD'));
    if(r.offerId)card.append(el('p','eBay offer: '+r.offerId));if(r.listingId)card.append(el('p','eBay listing: '+r.listingId));
    if(r.state==='pending')card.append(el('p','Recover status only reads eBay. Missing or uncertain results keep this copy reserved; they never trigger a repeated listing request.'));
    if(r.state==='planned'||r.canCancel)confirmation(card,'Cancel this unsent plan and release its reservation.','Cancel unsent plan',()=>act(r,'cancel'));
    if(r.state==='pending'&&data.connected)card.append(button('Recover status',()=>run(()=>act(r,'recover'))));
    if(r.state==='offer_saved'&&data.connected)card.append(button('Check current listing fees',()=>run(()=>act(r,'fees'))));
    if(r.fees){card.append(el('p',r.fees.notice));const fees=el('ul');r.fees.rows.forEach(f=>fees.append(el('li',f.type+': $'+f.amount+' USD'+(f.promotionalDiscount?' · promotional discount reported: $'+f.promotionalDiscount:''))));card.append(fees);}
    content.append(card);
   }
   if(draftId&&(!data.records.length||data.records.every(r=>r.state==='cancelled'))) {
    const review=await request('/api/ebay-listing-review?id='+encodeURIComponent(draftId));
    if(!valid())return;
    if(review.connected&&review.saved?.report?.payloadReady&&!review.stale) {
     const card=el('section');card.append(el('h3','Save this reviewed listing plan'),el('p','This reserves the physical copy in CardResell. It sends no listing request to eBay and does not approve publication. Live marketplace changes are still awaiting setup.'));
     confirmation(card,'Reserve this physical copy for the reviewed eBay listing.','Save listing plan',async()=>{
      const manifest=await photosList(draftId);if(!valid())return;
      const photos=review.saved.report.selected.photoIds.map(id=>({...manifest.hosted?.[id],photoId:id}));
      await request('/api/ebay-listing-operations',{action:'plan',environment:state.data?.environment,draftId,expectedReviewRev:review.reviewRev,confirmed:true,photos});window.dispatchEvent(new Event('cr:listing-availability-changed'));await load();
     });content.append(card);
    } else content.append(button('Review eBay requirements',()=>{dialog.close();window.CardResellEbayListingReview?.open(draftId);}));
   }
  }
  navigation();await run(load);
 }
 window.CardResellEbayListingOperations={open};
})();
