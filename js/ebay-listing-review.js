/* Read-only marketplace preparation. No listing write or automatic upload. */
(() => {
 'use strict';
 const owner=()=>window.googleUser?.sub||window.googleUser?.uid||null;
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
 const button=(name,fn)=>{const b=el('button',name);b.type='button';b.onclick=fn;return b;};
 let active=null;
 const prefix='cr_ebay_review_v1:';
 async function open(draftId) {
  if(active)active.dialog.close();
  const who=owner();if(!who){window.showToast?.('Sign in to review this draft.');return;}
  if(!document.getElementById('ebayListingReviewStyle')) {
   const s=el('style');s.id='ebayListingReviewStyle';s.textContent=`
.ebay-listing-review{margin:auto;width:min(720px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;box-sizing:border-box;border:1px solid var(--border,#555);border-radius:16px;padding:20px;background:var(--bg,#111);color:var(--text,#eee)}.ebay-listing-review::backdrop{background:rgba(0,0,0,.75)}.ebay-listing-review header,.ebay-review-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.ebay-listing-review h2{font-size:1.2rem;margin:0}.ebay-listing-review p,.ebay-listing-review li{font-size:.9rem;line-height:1.6;overflow-wrap:anywhere}.ebay-listing-review button{font:inherit;padding:10px 14px;min-height:44px;border:1px solid var(--border,#555);border-radius:8px;background:var(--surface-2,#222);color:var(--text,#eee);cursor:pointer}.ebay-listing-review button:disabled{opacity:.5;cursor:default}.ebay-listing-review button:focus-visible,.ebay-listing-review input:focus-visible,.ebay-listing-review select:focus-visible{outline:2px solid var(--gold,#d4af37);outline-offset:2px}.ebay-listing-review label{display:block;margin:14px 0;font-size:.9rem;line-height:1.5}.ebay-listing-review input:not([type=checkbox]),.ebay-listing-review select{display:block;width:100%;box-sizing:border-box;min-height:44px;padding:8px;margin-top:5px;background:var(--surface-2,#222);border:1px solid var(--border,#555);border-radius:6px;color:var(--text,#eee);font:inherit}.ebay-listing-review input[type=checkbox]{margin-right:10px;width:18px;height:18px;vertical-align:middle}.ebay-listing-review [role=alert]{color:var(--danger-text,#ff9999)}.ebay-listing-review fieldset{border:0;padding:0;margin:0}.ebay-listing-review legend{font-weight:700;margin-top:18px}.ebay-review-result{margin-top:18px;padding:14px;background:var(--surface-2,#222);border-radius:10px}.ebay-review-result ul{padding-left:20px}
`;document.head.append(s);
  }
  const dialog=el('dialog');dialog.className='ebay-listing-review';dialog.id='ebayListingReview';dialog.setAttribute('aria-labelledby','ebayListingReviewTitle');
  const state={dialog,who,closed:false,data:null,reference:null,selected:{aspects:{},descriptors:{},photoIds:[]},photos:[],busy:false};active=state;
  const key=prefix+encodeURIComponent(who)+':'+draftId;
  const valid=()=>!state.closed&&active===state&&owner()===who;
  const header=el('header'),heading=el('h2','eBay listing review');heading.id='ebayListingReviewTitle';header.append(heading,button('Close',()=>dialog.close()));dialog.append(header);
  dialog.append(el('p','Check what this physical card still needs before it can be listed on eBay. Direct publishing is not enabled.'));
  const status=el('p','Loading your draft…');status.setAttribute('role','status');const error=el('p');error.setAttribute('role','alert');
  const content=el('div'),actions=el('div'),result=el('div');actions.className='ebay-review-actions';dialog.append(status,error,content,actions,result);document.body.append(dialog);dialog.showModal();
  const interval=setInterval(()=>{if(owner()!==who)dialog.close();},250);
  dialog.addEventListener('close',()=>{state.closed=true;clearInterval(interval);dialog.remove();if(active===state)active=null;document.querySelector('[data-ebay-review-open]')?.focus();},{once:true});
  async function request(body) {
   if(!valid())throw Error('Your account changed. Reopen the review.');
   const token=await _crIdToken();if(!valid()||!token)throw Error('Sign in again to continue.');
   const r=await fetch('/api/ebay-listing-review'+(body?'':'?id='+encodeURIComponent(draftId)),{method:body?'POST':'GET',credentials:'same-origin',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify({...body,draftId,expectedDraftRev:state.data.draftRev})}:{}),signal:AbortSignal.timeout(60000)});
   const data=await r.json();if(!valid())throw Error('Your account changed. Reopen the review.');if(!r.ok)throw Error(data.error||'Could not check this draft. Try again.');return data;
  }
  function saveLocal() {
   if(!valid()||!state.data)return false;
   try {
    localStorage.setItem(key,JSON.stringify({v:1,draftRev:state.data.draftRev,connectionVersion:state.data.connectionVersion,selected:state.selected,at:Date.now()}));
    const owned=prefix+encodeURIComponent(who)+':',old=[];
    for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k!==key&&k?.startsWith(owned)){try{old.push({key:k,at:JSON.parse(localStorage.getItem(k)).at||0});}catch{}}}
    old.sort((a,b)=>b.at-a.at);old.forEach((row,i)=>{if(i>=49||row.at<Date.now()-30*86400000)localStorage.removeItem(row.key);});
    return true;
   }catch{error.textContent='This browser could not save your selections. Keep this review open and retry saving the check.';return false;}
  }
  function dirty(confirming=false){if(!confirming){state.selected.detailsConfirmed=false;const c=content.querySelector('[data-details-confirmation]');if(c)c.checked=false;}result.replaceChildren(el('p','Selections changed. Check again to update the saved result.'));saveLocal();}
  function checkbox(label,value,onChange,confirming=false) {
   const l=el('label'),i=el('input');i.type='checkbox';i.checked=!!value;if(confirming)i.dataset.detailsConfirmation='1';i.onchange=()=>{onChange(i.checked);dirty(confirming);};l.append(i,document.createTextNode(label));content.append(l);
  }
  function field(parent,label,options,values,set,{multiple=false,max=200}={}) {
   const l=el('label',label),input=el(options?'select':'input');if(options){input.multiple=multiple;if(!multiple){const o=el('option','Choose…');o.value='';input.append(o);}for(const option of options){const o=el('option',option.label);o.value=option.value;o.selected=values.includes(o.value);input.append(o);}}
   else {input.type='text';input.maxLength=max;input.value=values.join(' | ');}
   input.setAttribute('aria-label',label);
   input.onchange=()=>{set(options?Array.from(input.selectedOptions).map(x=>x.value).filter(Boolean):input.value.split(' | ').map(v=>v.trim()).filter(Boolean));dirty();};l.append(input);parent.append(l);
  }
  function showReport(report,stale=false) {
   result.className='ebay-review-result';result.replaceChildren();
   result.append(el('strong',stale?'Previous check needs refreshing':report.payloadReady?'Preparation checks passed; publishing is not enabled':'More information is needed'));
   result.append(el('p',`Checked ${new Date(report.checkedAt).toLocaleString()}. Checks expire after 10 minutes and after a draft or connection change.`));
   const ul=el('ul');for(const issue of report.issues||[])ul.append(el('li',issue.message));result.append(ul);
   result.append(el('p','Shipping and returns follow your selected eBay policies. Estimated draft postage and profit do not change those policies. No listing was created or changed.'));
  }
  function render() {
   content.replaceChildren();actions.replaceChildren();const data=state.data,ref=state.reference;
   status.textContent=data.baseline.summary.title+' · '+(data.baseline.summary.price==null?'Price missing':'$'+Number(data.baseline.summary.price).toFixed(2)+' USD')+' · One physical copy';
   if(!data.connected)content.append(el('p',data.available?'Connect your eBay seller account from Collection to check current category rules and selling policies.':'Direct eBay connection is awaiting setup. You can save this preparation check and continue using the existing listing export.'));
   if(data.conditionIntent?.length)content.append(el('p','Saved condition: '+data.conditionIntent.map(x=>x.name+': '+(x.intendedValue||'seller choice')).join('; ')+'. Check these against your card or slab.'));
   if(ref) {
    const a=el('fieldset');a.append(el('legend','Card details'));
    for(const r of ref.aspects||[]) {
     const n=r.localizedAspectName,c=r.aspectConstraint||{},values=state.selected.aspects[n]??data.suggestedAspects[n]??[];
     // Only render relevant optional fields; required fields always appear.
     if(!c.aspectRequired&&!values.length)continue;
     if(state.selected.aspects[n]===undefined)state.selected.aspects[n]=[...values];
     field(a,n+(c.aspectRequired?' (required)':''),c.aspectMode==='SELECTION_ONLY'?(r.aspectValues||[]).map(x=>({value:x.localizedValue,label:x.localizedValue})):null,values,v=>state.selected.aspects[n]=v,{multiple:c.itemToAspectCardinality==='MULTI',max:c.aspectMaxLength||65});
    }
    content.append(a);const c=el('fieldset');c.append(el('legend','Condition'));
    for(const r of ref.condition?.conditionDescriptors||[]) {
     const id=String(r.conditionDescriptorId),rule=r.conditionDescriptorConstraint||{};
     const savedIntent=data.conditionIntent?.find(x=>String(x.nameId)===id);
     if(id==='27503'&&state.selected.descriptors[id]===undefined&&savedIntent?.intendedValue)state.selected.descriptors[id]=[String(savedIntent.intendedValue)];
     field(c,r.conditionDescriptorName+(rule.usage==='REQUIRED'?' (required)':''),rule.mode==='FREE_TEXT'?null:(r.conditionDescriptorValues||[]).map(x=>({value:String(x.conditionDescriptorValueId),label:x.conditionDescriptorValueName})),state.selected.descriptors[id]||[],v=>state.selected.descriptors[id]=v,{multiple:rule.cardinality==='MULTI',max:rule.maxLength||30});
    }
    content.append(c);const terms=el('fieldset');terms.append(el('legend','Selling terms'));
    for(const type of ['fulfillment','payment','return']) {
     const key=type+'PolicyId';field(terms,type==='fulfillment'?'Shipping policy':type==='payment'?'Payment policy':'Return policy',(ref[type+'Policies']||[]).filter(x=>x.marketplaceId==='EBAY_US').map(x=>({value:String(x[key]),label:x.name||String(x[key])})),[state.selected[key]||''],v=>{state.selected[key]=v[0]||'';state.selected.detailsConfirmed=false;render();});
    }
    field(terms,'Inventory location',(ref.locations||[]).filter(x=>x.merchantLocationStatus==='ENABLED').map(x=>({value:x.merchantLocationKey,label:x.name||x.merchantLocationKey})),[state.selected.merchantLocationKey||''],v=>state.selected.merchantLocationKey=v[0]||'');content.append(terms);
    content.append(el('p','Choose policies you have reviewed in eBay. Their actual shipping charges, services and return terms apply. Calculated shipping is not supported here yet.'));
   }
   content.append(el('p',state.photos.length?`${state.photos.length} hosted seller photo(s) available on this device. Choose the photos to check.`:'No hosted seller photos are available on this device. Add your photos to the draft and prepare an export to host them before checking again.'));
   for(const p of state.photos)checkbox('Use '+(p.name||p.photoId),state.selected.photoIds.includes(p.photoId),checked=>{state.selected.photoIds=checked?[...state.selected.photoIds,p.photoId]:state.selected.photoIds.filter(id=>id!==p.photoId);});
   checkbox('I confirm this physical copy is still available to sell.',state.selected.copyAvailable,v=>state.selected.copyAvailable=v);
   checkbox('I reviewed the card identity, condition, photos and eBay selling terms.',state.selected.detailsConfirmed,v=>state.selected.detailsConfirmed=v,true);
   if(data.connected)actions.append(button('Load current eBay requirements',()=>run(async()=>{const r=await request({action:'requirements'});state.reference=r.reference;state.requirementsFingerprint=r.requirementsFingerprint;state.selected.detailsConfirmed=false;render();status.textContent='Current eBay requirements loaded. Review your selections below.';})));
   actions.append(button('Check and save review',()=>run(async()=>{
    if(data.connected&&!state.reference)throw Error('Load the current eBay requirements before checking this draft.');
    saveLocal();const r=await request({action:'check',expectedReviewRev:data.reviewRev,requirementsFingerprint:state.requirementsFingerprint,selected:state.selected,photos:state.photos.map(({photoId,sha256,contentType,byteLength})=>({photoId,sha256,contentType,byteLength}))});
    data.reviewRev=r.record.rev;data.saved=r.record;showReport(r.report);status.textContent='Review saved. No eBay listing was created or changed.';
   })));
   actions.append(button('Reload saved review',()=>run(load)));
   if(window.CardResellEbayListingOperations)actions.append(button('Listing plan and recovery',()=>{dialog.close();window.CardResellEbayListingOperations.open({draftId});}));
  }
  async function run(fn) {
   if(state.busy||!valid())return;state.busy=true;error.textContent='';content.inert=true;for(const b of actions.querySelectorAll('button'))b.disabled=true;
   try{await fn();}catch(e){if(valid())error.textContent=e.message;}finally{state.busy=false;if(valid()){content.inert=false;for(const b of actions.querySelectorAll('button'))b.disabled=false;}}
  }
  async function load() {
   const data=await request();state.data=data;state.reference=null;
   state.selected=data.saved?.report?.draftRev===data.draftRev?structuredClone(data.saved.report.selected):{aspects:{},descriptors:{},photoIds:[]};
   // Confirmation is tied to the actual draft and connection, not a printing.
   if(data.stale){state.selected.detailsConfirmed=false;state.selected.copyAvailable=false;}
   try {
    const raw=localStorage.getItem(key);if(raw){const local=JSON.parse(raw);if(local.v===1&&local.draftRev===data.draftRev&&local.connectionVersion===data.connectionVersion&&local.at>Date.now()-30*86400000&&local.selected?.aspects&&local.selected?.descriptors&&Array.isArray(local.selected.photoIds))state.selected=local.selected;}
   }catch{error.textContent='Saved browser selections could not be read. Review the fields again.';}
   state.selected.detailsConfirmed=false;state.selected.copyAvailable=false;
   try {
    const manifest=await photosList(draftId);if(!valid())return;
    state.photos=(manifest.photos||[]).filter(p=>!p.missing&&manifest.hosted?.[p.id]).map(p=>({...manifest.hosted[p.id],photoId:p.id,name:p.name}));
   }catch{state.photos=[];error.textContent='The local photo store could not be read. Your saved draft is unchanged.';}
   if(!valid())return;render();if(data.saved)showReport(data.saved.report,data.stale);else showReport(data.baseline);
  }
  await run(load);
  if(!state.data&&valid()){actions.replaceChildren(button('Retry',()=>run(load)));}
 }
 window.CardResellEbayListingReview={open};
 function mount() {
  const wrap=document.getElementById('reviewWrap');if(!wrap)return;
  const attach=()=>{
   if(typeof _reviewState==='undefined')return;
   const d=_reviewState.draft,host=wrap.querySelector('#review-ebay-step');
   if(!host||!d||d.slot!=='ebay:fixed-price'||_reviewState.loading||_reviewState.gone||host.querySelector('[data-ebay-review-open]'))return;
   const b=button('Check direct eBay readiness',()=>open(d.draftId));b.className='draft-more-btn';b.dataset.ebayReviewOpen='1';host.append(b);
  };
  new MutationObserver(attach).observe(wrap,{childList:true,subtree:true});attach();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
