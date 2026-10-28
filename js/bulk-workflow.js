/* Scan → review → save → drafts. Navigation retains the current browser batch;
   only an explicit new-batch decision discards it. No provider or storage writes. */
(() => {
 'use strict';
 const style=document.createElement('style');
 style.textContent='#bulkDraftSelectBar>button:nth-child(2){white-space:nowrap;min-height:44px}'+
  '@media(max-height:600px){#bulkProcessing{overflow-y:auto!important}#bulkResultsList{flex:none!important;overflow:visible!important}#bulkBottomBar{max-height:none!important;overflow:visible!important}}';
 document.head.append(style);
 let batchOwner=null, batchQueue=null;
 const account=()=>{
  const id=window.googleUser?.uid||window.googleUser?.sub||null;
  const auth=window._fbAuth?.currentUser;
  return auth && auth.uid!==id ? null : id;
 };
 const rows=()=>window._bulkResults||[];
 const copies=r=>Number.isSafeInteger(r?.qty)&&r.qty>1?r.qty:1;
 const count=list=>list.reduce((n,r)=>n+copies(r),0);
 const pending=()=>rows().filter(r=>r&&!r.success);
 const ready=()=>rows().filter(r=>r?.success&&!r.providerNeedsReview&&!r.collectionSaved);
 const saved=()=>count(rows().filter(r=>r?.collectionSaved));
 const busy=()=>!!window._bulkProcessing||!!window._bulkDraftBusy||rows().some(r=>r?._photoChecking);
 function bind(){batchOwner=account();batchQueue=window._bulkQueue;window._bulkPackUnitCost=undefined;}
 function clear(){batchOwner=null;batchQueue=null;window._bulkPackUnitCost=undefined;document.getElementById('bulkNewBatchDialog')?.close();}
 function current(){return !!batchOwner&&account()===batchOwner;}
 function canWrite(){return batchOwner===null||current();}
 function button(id,text,action){let b=document.getElementById(id);if(!b){b=document.createElement('button');b.id=id;b.type='button';b.style.cssText='min-height:44px;padding:10px 12px;border:1px solid #8065b7;border-radius:10px;background:#242032;color:#ede9fe;font:inherit;font-size:.8rem;font-weight:700;cursor:pointer';}b.textContent=text;b.onclick=action;return b;}
 function sync(){
  if(!rows().length)return;
  // Capture fixture/legacy entry paths too; a different signed-in account may
  // never adopt the previous account's queue by merely repainting its screen.
  if(batchQueue!==window._bulkQueue&&!batchOwner){batchOwner=account();batchQueue=window._bulkQueue;}
  const bar=document.getElementById('bulkBottomBar');if(!bar)return;
  const unresolved=pending(), toSave=count(ready()), already=saved(), working=busy()||!current();
  const summary=document.getElementById('bulkSummaryLine');
  if(summary){summary.classList.remove('sr-only');summary.style.cssText='font-size:.75rem;color:#cbd5e1;line-height:1.4;margin-bottom:8px';summary.textContent=[already?already+' saved to Collection':'',unresolved.length?count(unresolved)+' still need identification':toSave?'Check condition and finish before saving.':'All identified cards saved.'].filter(Boolean).join(' · ');}
  const add=document.getElementById('bulkAddAllBtn');
  if(add){add.parentElement.style.display=toSave||_bulkDraftSelectable().length?'flex':'none';add.textContent=toSave?'Save '+toSave+' identified card'+(toSave===1?'':'s'):already?'Identified cards saved':'No identified cards yet';add.disabled=working||!toSave;add.style.opacity=add.disabled?'.5':'1';}
  let next=document.getElementById('bulkReviewNextBtn');
  if(unresolved.length){
   const match=unresolved.find(r=>r.providerNeedsReview);
   const lookup=!match&&window.CardResellBulkLookup&&unresolved.find(r=>(r.definiteMiss||r.photoRejected)&&!r._rescanning&&!r._photoChecking&&!r._replacementPhoto);
   const r=match||lookup||unresolved[0];
   next=button('bulkReviewNextBtn',match?'Review next match':lookup?'Find next card by name · free':'Review an unfinished card',()=>{
    if(busy()||!current())return;
    const row=document.getElementById(r.rowId);row?.scrollIntoView({block:'center'});
    if(r.providerNeedsReview&&window.CardResellBulkMatchReview)window.CardResellBulkMatchReview.open(r.rowId);
    else if(lookup)window.CardResellBulkLookup?.open(r.rowId);
    if(!document.getElementById('bulkMatchDialog')&&!document.getElementById('bulkLookupDialog')){const action=row?.querySelector('button');action?.focus({preventScroll:true});}
   });
   next.style.width='100%';next.style.marginBottom='8px';next.disabled=working;
   if(!next.isConnected)bar.insertBefore(next,summary?.nextSibling||bar.firstChild);
  }else next?.remove();
  if(already){const view=button('bulkViewCollectionBtn','View saved cards',()=>navigate('collection'));view.style.width='100%';view.style.marginTop='8px';if(view.parentElement!==bar)bar.insertBefore(view,document.getElementById('bulkMoreActions'));}
  const more=document.getElementById('bulkScanMoreBtn');if(more)more.textContent='Start new batch';
  const hasDraft=Object.values(window._bulkDraftOutcomes||{}).some(o=>o?.draftId);
  if(hasDraft)showDrafts();
 }
 function showDrafts(){
  const bar=document.getElementById('bulkBottomBar');if(!bar)return;
  const b=button('bulkGoToDraftsBtn','Review drafts',()=>navigate('drafts'));
  b.style.width='100%';b.style.marginTop='8px';b.disabled=busy();
  if(b.parentElement!==bar)bar.insertBefore(b,document.getElementById('bulkMoreActions'));
 }
 function pause(){
  if(!current()){closeBulkScan();return false;}
  if(window._bulkDraftBusy||rows().some(r=>r?._photoChecking)){showToast('Let this card finish before leaving the batch.');return false;}
  if(window.CardResellBulkMatchReview?.guardClose())return false;
  window.CardResellBulkMatchReview?.close();window.CardResellBulkLookup?.close();
  if(typeof _bulkCancelTextRescue==='function')_bulkCancelTextRescue();
  _bulkRapidTeardown();
  const overlay=document.getElementById('bulkScanOverlay');overlay.style.display='none';_dialogClosed('bulkScanOverlay');
  window._bulkPaused=true;_showBackToBulkPill();
  return true;
 }
 function close(){if(rows().length||(window._bulkQueue||[]).length||window._bulkProcessing){pause();return;}closeBulkScan();}
 function navigate(view){if(!pause())return;switchView(view);if(view==='collection')switchCollectionSection('cards');}
 function resumeExisting(){
  if(!rows().length&&!(window._bulkQueue||[]).length)return false;
  if(!current()){closeBulkScan();return false;}
  resumeBulkScan();return true;
 }
 function startNew(){
  if(busy()){showToast('Let this card finish before starting another batch.');return;}
  if(window.CardResellBulkMatchReview?.guardClose())return;
  const discard=()=>{closeBulkScan();openBulkScan();};
  const queued=!rows().length?(window._bulkQueue||[]).length:0;
  if(!ready().length&&!pending().length&&!queued){discard();return;}
  if(document.getElementById('bulkNewBatchDialog'))return;
  const owner=account(),queue=window._bulkQueue;
  const d=document.createElement('dialog');d.id='bulkNewBatchDialog';d.setAttribute('aria-labelledby','bulkNewBatchTitle');
  d.style.cssText='box-sizing:border-box;width:min(440px,calc(100vw - 24px));max-height:85dvh;overflow:auto;padding:20px;border:1px solid #8065b7;border-radius:14px;background:#17131f;color:#fff';
  const title=document.createElement('h2');title.id='bulkNewBatchTitle';title.textContent='Start a new batch?';title.style.cssText='font-size:1.2rem;margin:0 0 12px';
  const note=document.createElement('p');note.textContent=(queued?queued+' photos have not been scanned':count(ready())+' identified cards have not been saved to Collection'+(pending().length?' and '+count(pending())+' cards still need identification':''))+'. Starting over discards these scan results and photos. Saved inventory and drafts stay saved.';note.style.cssText='line-height:1.5;font-size:.9rem';
  const keep=button('bulkKeepBatch','Keep this batch',()=>d.close());keep.autofocus=true;
  const reset=button('bulkDiscardBatch','Discard and start new batch',()=>{if(account()!==owner||window._bulkQueue!==queue){d.close();return;}d.close();discard();});
  const actions=document.createElement('div');actions.style.cssText='display:flex;flex-wrap:wrap;gap:10px';actions.append(keep,reset);d.append(title,note,actions);
  d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal();
 }
 function afterSave(){
  window._bulkSaved=!rows().some(r=>r&&(!r.success||!r.collectionSaved));
  _bulkResetBottomBarButtons();document.getElementById('bulkBottomBar').style.display='';
  rows().forEach(r=>{if(r)_bulkUpdateRow(r.rowId,r);});
  _bulkRefreshResultSummary();sync();return true;
 }
 function renderSaved(row,r){
  if(!r.collectionSaved)return false;
  row.replaceChildren();row.style.borderColor='#31523e';
  const body=document.createElement('div');body.style.cssText='min-width:0;flex:1';
  const title=document.createElement('strong');title.textContent=r.cardName+(copies(r)>1?' ×'+copies(r):'');
  const detail=document.createElement('div');detail.textContent=[r.setName,r.cardNumber?'#'+r.cardNumber:'',r.conditionChosen?r.condition:''].filter(Boolean).join(' · ');detail.style.cssText='font-size:.75rem;color:#cbd5e1;line-height:1.5';
  const status=document.createElement('div');status.textContent='Saved to Collection';status.style.cssText='font-size:.75rem;color:#86efac;margin-top:6px';
  const action=document.createElement('button');action.type='button';action.textContent='View saved cards';action.style.cssText='min-height:44px;padding:8px 0;background:none;border:0;color:#c4b5fd;text-decoration:underline;cursor:pointer';action.onclick=()=>navigate('collection');
  body.append(title,detail,status,action);
  const outcome=document.createElement('div');outcome.innerHTML=_bulkDraftOutcomeHtml(r);body.append(outcome);row.append(body);return true;
 }
 // Scan transport already refreshes the authoritative account balance after
 // every response. That read can finish after the last worker paints "Done".
 // Repaint the same batch when it settles; never add a scan, debit or request.
 const loadCredits=window.loadSettingsScanCredits;
 if(typeof loadCredits==='function')window.loadSettingsScanCredits=async function(...args){
  const owner=account(),facade=window.googleUser,auth=window._fbAuth?.currentUser,queue=window._bulkQueue;
  const result=await loadCredits.apply(this,args);
  if(!owner||!current()||account()!==owner||window.googleUser!==facade||window._fbAuth?.currentUser!==auth||window._bulkQueue!==queue||!rows().length)return result;
  const label=document.getElementById('bulkProgressCredits');
  const value=document.getElementById('idScanCount')?.textContent?.trim();
  // The account reader rejects superseded/invalid responses. Reuse its validated
  // total (already includes free + paid); a pending read is not a zero balance.
  if(label&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value)))label.textContent=value+' credit'+(Number(value)===1?'':'s')+' remaining';
  else if(label&&value==='Unavailable')label.textContent='Credit balance unavailable';
  return result;
 };
 window.CardResellBulkWorkflow={bind,clear,current,canWrite,sync,showDrafts,pause,close,navigate,resumeExisting,startNew,afterSave,renderSaved};
})();
