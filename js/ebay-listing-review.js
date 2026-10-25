/* Read-only marketplace preparation. No listing write or automatic upload. */
(() => {
 'use strict';
 const owner=()=>window.googleUser?.sub||window.googleUser?.uid||null;
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
 const button=(name,fn)=>{const b=el('button',name);b.type='button';b.onclick=fn;return b;};
 let active=null;
 const prefix='cr_ebay_review_v1:';
 const termFields=['fulfillmentPolicyId','paymentPolicyId','returnPolicyId','merchantLocationKey'];
 const policyHelp='https://www.ebay.com/help/selling/business-policies/business-policies?id=4212';
 const locationHelp='https://developer.ebay.com/api-docs/sell/static/inventory/managing-inventory-locations.html';
 const link=(label,url)=>{const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
 const usableLocation=x=>{const a=x?.location?.address,p=v=>typeof v==='string'&&v.trim().length>0;return x?.merchantLocationStatus==='ENABLED'&&p(x.merchantLocationKey)&&p(a?.country)&&(p(a.postalCode)||(p(a.city)&&p(a.stateOrProvince)));};
 async function open(draftId) {
  if(active)active.dialog.close();
  const who=owner();if(!who){window.showToast?.('Sign in to review this draft.');return;}
  if(!document.getElementById('ebayListingReviewStyle')) {
   const s=el('style');s.id='ebayListingReviewStyle';s.textContent=`
.ebay-listing-review{margin:auto;width:min(720px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;box-sizing:border-box;border:1px solid var(--border,#555);border-radius:16px;padding:20px;background:var(--bg,#111);color:var(--text,#eee)}.ebay-listing-review::backdrop{background:rgba(0,0,0,.75)}.ebay-listing-review header,.ebay-review-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.ebay-listing-review h2{font-size:1.2rem;margin:0}.ebay-listing-review p,.ebay-listing-review li{font-size:.9rem;line-height:1.6;overflow-wrap:anywhere}.ebay-listing-review button{font:inherit;padding:10px 14px;min-height:44px;border:1px solid var(--border,#555);border-radius:8px;background:var(--surface-2,#222);color:var(--text,#eee);cursor:pointer}.ebay-listing-review button:disabled{opacity:.5;cursor:default}.ebay-listing-review button:focus-visible,.ebay-listing-review input:focus-visible,.ebay-listing-review select:focus-visible{outline:2px solid var(--gold,#d4af37);outline-offset:2px}.ebay-listing-review label{display:block;margin:14px 0;font-size:.9rem;line-height:1.5}.ebay-listing-review input:not([type=checkbox]),.ebay-listing-review select{display:block;width:100%;box-sizing:border-box;min-height:44px;padding:8px;margin-top:5px;background:var(--surface-2,#222);border:1px solid var(--border,#555);border-radius:6px;color:var(--text,#eee);font:inherit}.ebay-listing-review input[type=checkbox]{margin-right:10px;width:18px;height:18px;vertical-align:middle}.ebay-listing-review [role=alert]{color:var(--danger-text,#ff9999)}.ebay-listing-review fieldset{border:0;padding:0;margin:0}.ebay-listing-review legend{font-weight:700;margin-top:18px}.ebay-review-result{margin-top:18px;padding:14px;background:var(--surface-2,#222);border-radius:10px}.ebay-review-result ul{padding-left:20px}
 .ebay-listing-review [data-selling-defaults]{margin:18px 0;padding:14px;border:1px solid var(--border,#555);border-radius:10px}.ebay-listing-review [data-selling-defaults] button{margin:4px 8px 4px 0}.ebay-listing-review a{color:var(--text,#eee);text-decoration:underline}
`;document.head.append(s);
  }
  const dialog=el('dialog');dialog.className='ebay-listing-review';dialog.id='ebayListingReview';dialog.setAttribute('aria-labelledby','ebayListingReviewTitle');
  const state={dialog,who,closed:false,data:null,reference:null,selected:{aspects:{},descriptors:{},photoIds:[]},photos:[],busy:false,defaults:null,defaultsNote:'',autoDefaults:false};active=state;
  const key=prefix+encodeURIComponent(who)+':'+draftId;
  const defaultsKey='cr_ebay_terms_v1:'+encodeURIComponent(who);
  const valid=()=>!state.closed&&active===state&&owner()===who;
  const header=el('header'),heading=el('h2','eBay listing review');heading.id='ebayListingReviewTitle';header.append(heading,button('Close',()=>dialog.close()));dialog.append(header);
  dialog.append(el('p','Check what this physical card still needs before it can be listed on eBay. Direct publishing is not enabled.'));
  const status=el('p','Loading your draft…');status.setAttribute('role','status');const error=el('p');error.setAttribute('role','alert');
  const setup=el('div'),content=el('div'),actions=el('div'),result=el('div');actions.className='ebay-review-actions';dialog.append(status,error,setup,content,actions,result);document.body.append(dialog);dialog.showModal();
  const interval=setInterval(()=>{if(owner()!==who)dialog.close();},250);
  dialog.addEventListener('close',()=>{state.closed=true;clearInterval(interval);dialog.remove();if(active===state)active=null;document.querySelector('[data-ebay-review-open]')?.focus();},{once:true});
  async function request(body) {
   if(!valid())throw Error('Your account changed. Reopen the review.');
   const token=await _crIdToken();if(!valid()||!token)throw Error('Sign in again to continue.');
   const r=await fetch('/api/ebay-listing-review'+(body?'':'?id='+encodeURIComponent(draftId)),{method:body?'POST':'GET',credentials:'same-origin',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify({...body,draftId,expectedDraftRev:state.data.draftRev,expectedConnectionVersion:state.data.connectionVersion})}:{}),signal:AbortSignal.timeout(60000)});
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
  function sellingChoices(field) {
   const ref=state.reference;if(!ref)return [];
   if(field==='merchantLocationKey')return (ref.locations||[]).filter(usableLocation).map(x=>({value:x.merchantLocationKey,label:x.name||x.merchantLocationKey}));
   const type=field.replace('PolicyId','');
   return (ref[type+'Policies']||[]).filter(x=>typeof x?.[field]==='string'&&x[field].trim()&&x[field].length<=100&&!/[\x00-\x1f]/.test(x[field])&&x.marketplaceId==='EBAY_US'&&(type!=='fulfillment'||!x.shippingOptions?.some(s=>s.costType==='CALCULATED'))).map(x=>({value:x[field],label:x.name||x[field]}));
  }
  function termsValid(terms) {
   return termFields.every(field=>typeof terms?.[field]==='string'&&terms[field].length>0&&terms[field].length<=100&&!/[\x00-\x1f]/.test(terms[field])&&sellingChoices(field).filter(x=>x.value===terms[field]).length===1);
  }
  function readDefaults() {
   state.defaults=null;state.defaultsNote='';
   try {
    const raw=localStorage.getItem(defaultsKey);if(!raw)return;
    const saved=JSON.parse(raw),now=Date.now();
    if(saved.v===1&&saved.context===state.data.sellerContext&&/^[a-f\d]{64}$/.test(saved.context||'')&&saved.at>now-90*86400000&&saved.at<=now+60000&&termFields.every(f=>typeof saved.terms?.[f]==='string'))state.defaults=saved;
   }catch{state.defaultsNote='Saved selling defaults could not be read. Choose your settings below.';}
  }
  function useDefaults() {
   if(!valid()||!state.reference||!state.defaults)return false;
   if(!termsValid(state.defaults.terms)){state.defaultsNote='Some saved defaults are no longer available or supported. Choose current settings and save them again.';return false;}
   for(const f of termFields)state.selected[f]=state.defaults.terms[f];
   state.selected.detailsConfirmed=false;
   state.defaultsNote='Saved selling defaults filled in. Review the current eBay policies for this card.';
   saveLocal();return true;
  }
  function defaultsControls(terms) {
   if(!/^[a-f\d]{64}$/.test(state.data.sellerContext||''))return;
   const box=el('section');box.dataset.sellingDefaults='';box.append(el('strong','Reusable selling settings'),el('p','Reuse these four choices for this seller’s new drafts on this browser.'));
   const note=el('p',state.defaultsNote);note.setAttribute('aria-live','polite');box.append(note);
   const save=button('Save selling defaults',()=>run(async()=>{
    if(!termsValid(state.selected))throw Error('Choose a supported shipping, payment and return policy and an inventory location first.');
    const record={v:1,context:state.data.sellerContext,at:Date.now(),terms:Object.fromEntries(termFields.map(f=>[f,state.selected[f]]))};
    try{localStorage.setItem(defaultsKey,JSON.stringify(record));}catch{throw Error('This browser could not save selling defaults. Your current draft choices are still available.');}
    state.defaults=record;state.defaultsNote='Selling defaults saved for this browser. Each card still needs its own condition, photos and confirmation.';render();
   }));save.disabled=!termsValid(state.selected);const same=state.defaults&&termFields.every(f=>state.selected[f]===state.defaults.terms[f]);save.hidden=!!same;box.append(save);
   if(state.defaults) {
    if(!same)box.append(button('Use saved defaults',()=>run(async()=>{if(useDefaults())dirty();render();})));
    box.append(button('Forget saved defaults',()=>run(async()=>{
     try{localStorage.removeItem(defaultsKey);}catch{throw Error('This browser could not remove the defaults. Try again.');}
     state.defaults=null;state.defaultsNote='Saved defaults removed. This draft’s choices have been kept.';render();
    })));
   }
   terms.append(box);
  }
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
   setup.replaceChildren();content.replaceChildren();actions.replaceChildren();const data=state.data,ref=state.reference;
   status.textContent=data.baseline.summary.title+' · '+(data.baseline.summary.price==null?'Price missing':'$'+Number(data.baseline.summary.price).toFixed(2)+' USD')+' · One physical copy';
   if(data.connected) {
    setup.append(el('p',ref?'eBay requirements loaded. Review the fields below, then confirm and save your review.':'Your eBay account is connected. First, load its current category requirements and selling policies.'));
    setup.append(button('Load current eBay requirements',()=>run(async()=>{
     state.reference=null;state.requirementsFingerprint=null;state.selected.detailsConfirmed=false;render();
     status.textContent='Loading current eBay requirements…';
     result.replaceChildren(el('p','The previous check needs refreshing. Your choices are kept while current requirements load.'));
     const r=await request({action:'requirements'});
     if(!r.connected||!r.reference)throw Error('Your eBay connection is no longer available. Reopen the connection from Collection.');
     if(r.connectionVersion!==data.connectionVersion||r.sellerContext!==data.sellerContext)throw Error('Your eBay connection changed. Reload this review before continuing.');
     state.reference=r.reference;state.requirementsFingerprint=r.requirementsFingerprint;
     if(state.autoDefaults){state.autoDefaults=false;useDefaults();}
     render();
     status.textContent='Current eBay requirements loaded. Review your selections below.';
     if(!data.saved)result.replaceChildren(el('p','Review the current fields and photos, then check and save.'));
    })));
   }
   if(window.CardResellEbayConnect)setup.append(button(data.connected?'Check seller setup':'Connect eBay',()=>{if(valid()&&!state.busy)window.CardResellEbayConnect.open(null,{checkSetup:data.connected});}));
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
     const key=type+'PolicyId',label=type==='fulfillment'?'Shipping policy':type==='payment'?'Payment policy':'Return policy',choices=sellingChoices(key);
     field(terms,label,choices,[state.selected[key]||''],v=>{state.selected[key]=v[0]||'';state.selected.detailsConfirmed=false;render();});
     if(!choices.length){const hint=el('p','No supported US '+label.toLowerCase()+' is available. ');hint.append(link('Review eBay Business Policies',policyHelp));terms.append(hint);}
     else if(state.selected[key]&&!choices.some(x=>x.value===state.selected[key]))terms.append(el('p','The previously selected '+label.toLowerCase()+' is no longer available. Choose a current policy.'));
    }
    const locations=sellingChoices('merchantLocationKey');
    field(terms,'Inventory location',locations,[state.selected.merchantLocationKey||''],v=>{state.selected.merchantLocationKey=v[0]||'';render();});
    if(!locations.length){const hint=el('p','No enabled location with a dispatch address is available. CardResell’s current read-only connection cannot create one. ');hint.append(link('Inventory location setup guidance',locationHelp));terms.append(hint);}
    else if(state.selected.merchantLocationKey&&!locations.some(x=>x.value===state.selected.merchantLocationKey))terms.append(el('p','The previously selected location is no longer available. Choose a current location.'));
    defaultsControls(terms);content.append(terms);
    content.append(el('p','Choose policies you have reviewed in eBay. Their actual shipping charges, services and return terms apply. Calculated shipping is not supported here yet.'));
   }
   content.append(el('p',state.photos.length?`${state.photos.length} hosted seller photo(s) available on this device. Choose the photos to check.`:'No hosted seller photos are available on this device. Add your photos to the draft and prepare an export to host them before checking again.'));
   for(const p of state.photos)checkbox('Use '+(p.name||p.photoId),state.selected.photoIds.includes(p.photoId),checked=>{state.selected.photoIds=checked?[...state.selected.photoIds,p.photoId]:state.selected.photoIds.filter(id=>id!==p.photoId);});
   if(ref||!data.connected) {
    checkbox('I confirm this physical copy is still available to sell.',state.selected.copyAvailable,v=>state.selected.copyAvailable=v);
    checkbox('I reviewed the card identity, condition, photos and eBay selling terms.',state.selected.detailsConfirmed,v=>state.selected.detailsConfirmed=v,true);
   }
   const check=button('Check and save review',()=>run(async()=>{
    if(data.connected&&!state.reference)throw Error('Load the current eBay requirements before checking this draft.');
    saveLocal();const r=await request({action:'check',expectedReviewRev:data.reviewRev,requirementsFingerprint:state.requirementsFingerprint,selected:state.selected,photos:state.photos.map(({photoId,sha256,contentType,byteLength})=>({photoId,sha256,contentType,byteLength}))});
    data.reviewRev=r.record.rev;data.saved=r.record;showReport(r.report);status.textContent='Review saved. No eBay listing was created or changed.';
   }));check.dataset.saveReview='';actions.append(check);
   actions.append(button('Reload saved review',()=>run(load)));
   if(window.CardResellEbayListingOperations)actions.append(button('Listing plan and recovery',()=>{dialog.close();window.CardResellEbayListingOperations.open({draftId});}));
   updateButtons();
  }
  function updateButtons() {
   for(const b of [...setup.querySelectorAll('button'),...actions.querySelectorAll('button')])b.disabled=state.busy||('saveReview' in b.dataset&&state.data?.connected&&!state.reference);
  }
  async function run(fn) {
   if(state.busy||!valid())return;state.busy=true;error.textContent='';content.inert=true;updateButtons();
   try{await fn();}catch(e){if(valid()){error.textContent=e.message;if(!state.data)status.textContent='This draft could not be loaded. Retry to continue.';else if(state.data.connected&&!state.reference)status.textContent='Current requirements could not be loaded. Retry, or check seller setup. Your saved draft is unchanged.';}}finally{state.busy=false;if(valid()){content.inert=false;updateButtons();}}
  }
  async function load() {
   if(state.data){state.reference=null;state.requirementsFingerprint=null;state.selected.detailsConfirmed=false;render();}
   const data=await request();state.data=data;state.reference=null;
   state.selected=data.saved?.report?.draftRev===data.draftRev?structuredClone(data.saved.report.selected):{aspects:{},descriptors:{},photoIds:[]};
   state.autoDefaults=!data.saved;readDefaults();
   // Confirmation is tied to the actual draft and connection, not a printing.
   if(data.stale){state.selected.detailsConfirmed=false;state.selected.copyAvailable=false;}
   try {
    const raw=localStorage.getItem(key);if(raw){const local=JSON.parse(raw);if(local.v===1&&local.draftRev===data.draftRev&&local.connectionVersion===data.connectionVersion&&local.at>Date.now()-30*86400000&&local.selected?.aspects&&local.selected?.descriptors&&Array.isArray(local.selected.photoIds)){state.selected=local.selected;state.autoDefaults=false;}}
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
