// Reviewed, append-only recovery. A durable request is replayed only by Resume.
(() => {
 'use strict';
 const api=()=>CardResellInventoryRecoveryPolicy,owner=()=>getUserKey('inventory_restore_v1');
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),fail=message=>{throw Error(message);};
 const copies=n=>n===1?'copy':'copies';
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const button=(text,fn)=>{const b=el('button',text);b.type='button';b.className='fl-sub-btn';b.onclick=fn;return b;};
 const suffixes=['portfolio','flips','tombstones','copy_sales_v1','sale_recovery_v1','sale_conflict_v1','inventory_conflict_v1','inventory_restore_v1'];
 function read(suffix,fallback=null){const raw=localStorage.getItem(getUserKey(suffix));try{return raw===null?fallback:JSON.parse(raw);}catch{fail('Saved device records could not be read. Download a current backup before changing them.');}}
 function local(){return {portfolio:api().recoveryRows(read('portfolio',[]),'Device inventory'),flips:api().recoveryRows(read('flips',[]),'Device sales'),tombstones:read('tombstones',{}),copy_sales_v1:read('copy_sales_v1'),sale_recovery_v1:read('sale_recovery_v1')};}
 function snapshot(){return JSON.stringify(suffixes.filter(k=>k!=='inventory_restore_v1').map(k=>[k,localStorage.getItem(getUserKey(k))]));}
 function journal(){const j=read('inventory_restore_v1');if(j!==null){if(j.version!==1||j.owner!==owner()||!j.request)fail('This saved recovery needs review. Download a current backup; its data is unchanged.');api().normalizeRecoveryRequest(j.request);}return j;}
 function pending(){try{const r=localStorage.getItem(owner());return r!==null&&r!=='null';}catch{return true;}}
 const paused=()=>{if(!pending())return false;_collectionSyncNotice('An inventory recovery needs attention. Open Recover inventory and resume the saved recovery.');return true;};
 function write(key,value){if(!_lsWrite(key,JSON.stringify(value)))fail('This device could not save recovery progress. Your saved request can be resumed from Recover inventory.');}
 function idle(){if(read('sale_recovery_v1')!==null||window.CardResellSaleConflicts?.pending()||window.CardResellInventoryConflicts?.pending())fail('Finish the saved sale or sync choice before starting inventory recovery.');}
 async function request(value){
  const who=owner(),token=window._googleIdToken;if(!window.googleUser?.sub||!token)fail('Sign in to the account that should receive these missing copies.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{const r=await fetch('/api/user-data',{method:value?'POST':'GET',headers:{Authorization:'Bearer '+token,...(value?{'Content-Type':'application/json'}:{})},...(value?{body:JSON.stringify(value)}:{}),signal:controller.signal});const data=await r.json();if(owner()!==who)fail('Account changed. Return to the original account to resume.');if(!r.ok){const e=Error(data.message||'Account data could not be confirmed. Try again when connected.');e.status=r.status;e.code=data.error;throw e;}return data;}finally{clearTimeout(timer);}
 }
 async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');}
 function identity(r){return JSON.stringify(['card','set','number','game','cardType','grader','grade','condition','finish','cert'].map(k=>r[k]??null));}
 function apply(result,j){
  const state=local(),remotePort=api().recoveryRows(result.portfolio,'Account inventory'),remoteFlips=api().recoveryRows(result.flips,'Account sales');api().backupRetired(state,result);
  const marks=_mergeTombstones(state.tombstones,result.tombstones),available=rows=>CardResellSaleRecovery.availableRowsStrict(_applyTombstones(CardResellInventoryEdits.inventoryNotDeleted(rows,marks.portfolio),marks.portfolio),result.copySales,[...state.flips,...remoteFlips]);
  const localPort=available(state.portfolio),accountPort=available(remotePort),byLocal=new Map(localPort.map(r=>[String(r.id),r])),byAccount=new Map(accountPort.map(r=>[String(r.id),r]));
  for(const source of j.request.copies){const l=byLocal.get(String(source.id)),a=byAccount.get(String(source.id));if(l&&a&&identity(l)!==identity(source)&&identity(l)!==identity(a))fail('Recovery reached your account, but a different local card now uses a recovered copy ID. Both records were preserved. Download a current backup and review that copy in Collection before resuming.');}
  // Compute both merges before any writes; recoveries never replay file sales.
  const portfolio=CardResellInventoryEdits.mergeInventory(accountPort,localPort),flips=_applyTombstones(CardResellSaleCorrections.mergeSales(remoteFlips,state.flips),marks.flips);
  if(portfolio.length>2000)fail('Recovery reached your account, but the combined device inventory exceeds 2,000 copies. Review Collection before resuming.');
  CardResellSaleRecovery.acceptCloud(result);
  if(!_saveTombstones(marks)||!_lsWrite(getUserKey('portfolio'),JSON.stringify(portfolio))||!_lsWrite(getUserKey('flips'),JSON.stringify(flips)))fail('Recovery reached your account. This device could not save it yet; resume the saved recovery after freeing storage.');
 }
 async function run(input){
  const who=owner();if(!navigator.locks?.request)fail('Update your browser to recover inventory safely across tabs.');
  return navigator.locks.request('cardresell:'+getUserKey('sale_recovery_v1'),async()=>{
   if(owner()!==who)fail('Account changed. Reopen recovery.');let j=journal();
   if(!j){
    if(!input)fail('There is no saved recovery to resume.');idle();
    if(snapshot()!==input.snapshot)fail('Device inventory or sale history changed after preview. Review the backup again.');
    j={version:1,owner:who,request:api().normalizeRecoveryRequest(input.request)};write(who,j);_cancelUserDataSync();paused();
   }else if(input)fail('Resume the saved recovery before starting another one.');
   if(j.rejected)fail('This request was not applied. Start a fresh preview.');
   const expectedHash=await hash(j.request);if(owner()!==who||!same(journal(),j))fail('The saved recovery changed. Reopen it before continuing.');
   let result;
   try{result=await request(j.request);}catch(e){if(owner()===who&&same(journal(),j)&&[400,409,413].includes(e.status)&&['inventory_recovery_invalid','inventory_recovery_conflict','inventory_edit_conflict','copy_sale_conflict'].includes(e.code)&&!j.confirmed){j.rejected=e.message;write(who,j);}throw e;}
   if(owner()!==who||!same(journal(),j))fail('The saved recovery changed while waiting. Reopen it to resume.');
   const receipt=result.recovery;
   if(result.ok!==true||receipt?.version!==1||receipt.recoveryId!==j.request.recoveryId||receipt.requestHash!==expectedHash||!Number.isFinite(receipt.createdAt)||receipt.createdAt<=0||!same(receipt.copyIds,j.request.copies.map(r=>String(r.id)))||j.confirmed&&!same(j.confirmed,receipt))fail('The account response could not be confirmed. Resume the same saved recovery to check again.');
   // Keep the proof before touching device data. Resume fetches today's account
   // by replaying this same idempotent request, including any intervening sale.
   j.confirmed=receipt;write(who,j);cloud=result;apply(result,j);write(who,null);_scheduleUserDataSync();
   try{_maybeRerenderCollection(true);}catch{}
   return receipt.copyIds.length+' '+copies(receipt.copyIds.length)+' recovered to your account. The latest account inventory is synced to this device; later sales and deletions stay in effect.';
  });
 }
 let dialog,body,status,viewOwner='',cloud=null,backup=null,source='',plan=null,busy=false,epoch=0;
 const message=text=>{status.textContent=text;};
 function download(){
  if(viewOwner!==owner()){message('Account changed. Reopen recovery before downloading.');return;}
  const data={};for(const suffix of suffixes){const raw=localStorage.getItem(getUserKey(suffix));try{data[suffix]=raw===null?null:JSON.parse(raw);}catch{data[suffix]={unreadableRaw:raw};}}
  const blob={format:'cardresell-inventory-recovery',version:1,exportedAt:new Date().toISOString(),local:data,account:cloud},url=URL.createObjectURL(new Blob([JSON.stringify(blob,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download='cardresell-inventory-recovery.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function controls(){dialog.querySelectorAll('button,input,select').forEach(n=>n.disabled=busy);}
 async function act(input){
  if(busy)return;busy=true;controls();message('Recovering missing inventory…');const who=owner();let notice='';
  try{notice=await run(input);}catch(e){notice=e.name==='AbortError'?'Connection interrupted. Resume the saved recovery to check whether it was saved.':e.message;}
  finally{busy=false;if(owner()===who&&dialog.open){render();message(notice);}else if(dialog.open){body.replaceChildren();message('Account changed. Return to the original account to resume.');}dialog.querySelectorAll('[data-recovery-global]').forEach(n=>n.disabled=false);}
 }
 function render(){
  epoch++;body.replaceChildren();plan=null;const who=owner();viewOwner=who;
  try{
   const j=journal();
   if(j){
    body.append(el('p',j.rejected||((j.confirmed?'The account saved this recovery. ':'')+'A saved recovery is waiting to finish. Resume checks the same request and keeps later account changes.')));
    if(j.rejected)body.append(button('Start fresh preview',async()=>{if(busy||owner()!==who)return;try{await navigator.locks.request('cardresell:'+getUserKey('sale_recovery_v1'),()=>{if(owner()!==who||!same(journal(),j))fail('The saved request changed. Reopen recovery.');write(who,null);});backup=null;source='';render();message('Choose a backup and review the latest account inventory.');_collectionSyncNotice('Recovery was not applied. Review the latest inventory before trying again.');}catch(e){message(e.message);}}));
    else body.append(button('Resume saved recovery',()=>act()));
    return;
   }
   idle();
   const label=el('label','CardResell recovery backup (.json)'),file=el('input');file.type='file';file.accept='.json,application/json';label.append(file);body.append(label);
   const choices=el('div'),preview=el('div');body.append(choices,preview);
   const review=button('Review missing inventory',()=>reviewFile(preview));review.disabled=!backup||!source;body.append(review);
   const showSources=()=>{
    choices.replaceChildren();if(!backup)return;choices.append(el('p','Choose one saved snapshot. Both snapshots’ sale and deletion histories are checked.'));
    for(const [key,title] of [['local','Device inventory in backup'],['account','Account inventory in backup']]){
     const wrap=el('label'),radio=el('input');radio.type='radio';radio.name='recovery-source';radio.value=key;radio.checked=source===key;radio.disabled=!backup[key]||!Array.isArray(backup[key].portfolio);radio.onchange=()=>{source=key;epoch++;plan=null;preview.replaceChildren();message('');review.disabled=false;};wrap.className='inventory-recovery-check';wrap.append(radio,document.createTextNode(title));choices.append(wrap);
    }
   };
   showSources();
   file.onchange=async()=>{
    const turn=++epoch;backup=null;source='';plan=null;choices.replaceChildren();preview.replaceChildren();review.disabled=true;message('');const selected=file.files?.[0];if(!selected)return;
    try{if(selected.size>4000000)fail('Choose a CardResell JSON backup smaller than 4 MB.');const text=await selected.text();if(owner()!==who||turn!==epoch||!dialog.open)return;backup=api().readRecoveryBackup(text);showSources();message('Backup loaded. Choose a saved snapshot to review.');}catch(e){if(owner()===who&&turn===epoch)message(e.message);}
   };
  }catch(e){message(e.message);}
 }
 async function reviewFile(preview){
  if(!backup||!source||busy)return;const turn=++epoch,who=owner(),chosen=source,saved=backup;plan=null;preview.replaceChildren();message('Checking current account inventory…');
  try{
   idle();const before=snapshot(),state=local();api().backupRetired(state);const remote=await request();
   if(owner()!==who||turn!==epoch||!dialog.open)return;if(snapshot()!==before)fail('Device inventory or sale history changed during preview. Review again.');
   cloud=remote;const result=api().planRecovery(saved,chosen,state,remote);let input=null;
   if(result.adding.length)input={snapshot:before,request:api().normalizeRecoveryRequest({action:'recover_inventory',recoveryId:'ir_'+crypto.randomUUID(),copies:result.adding})};
   plan=input;message(result.adding.length+' missing '+copies(result.adding.length)+' can be recovered · '+result.skipped.length+' '+copies(result.skipped.length)+' skipped. Existing, sold and deleted copies stay unchanged.');
   const list=el('ul');list.className='inventory-recovery-copies';
   for(const row of result.adding){const cost=row.buyPrice==null||row.costMeta?.buyPrice==='blank'?'Unknown cost':'$'+row.buyPrice.toFixed(2);list.append(el('li',[row.card,row.set,row.number&&'#'+row.number,row.grader,row.grade,row.condition,'ID '+String(row.id),cost,row.location||'No location',row.sku&&'SKU '+row.sku].filter(Boolean).join(' · ')));}
   preview.append(list);
   if(result.skipped.length){const details=el('details'),skipped=el('ul');details.append(el('summary',result.skipped.length+' skipped copies'));skipped.className='inventory-recovery-copies';for(const {row,reason} of result.skipped)skipped.append(el('li',(row.card||'Unnamed')+' · '+String(row.id)+' · '+reason));details.append(skipped);preview.append(details);}
   if(input){
    const label=el('label'),confirm=el('input');confirm.type='checkbox';label.className='inventory-recovery-check';label.append(confirm,document.createTextNode('Add '+result.adding.length+' missing '+copies(result.adding.length)+' to '+(window.googleUser?.email||'my signed-in CardResell account')));
    const save=button('Recover '+result.adding.length+' '+copies(result.adding.length),()=>{if(plan===input&&confirm.checked&&owner()===who)act(input);});save.disabled=true;confirm.onchange=()=>save.disabled=!confirm.checked;preview.append(label,save);
   }
  }catch(e){if(owner()===who&&turn===epoch)message(e.message);}
 }
 function open(){
  if(!window.googleUser?.sub){window.triggerGoogleSignIn?.('collection');return;}
  if(!dialog){
   dialog=el('dialog');dialog.id='inventoryRecoveryDialog';dialog.setAttribute('aria-labelledby','inventoryRecoveryTitle');const title=el('h2','Recover missing inventory');title.id='inventoryRecoveryTitle';
   const close=button('Close recovery',()=>dialog.close()),downloadButton=button('Download current backup',download);close.dataset.recoveryGlobal='';downloadButton.dataset.recoveryGlobal='';status=el('p');status.setAttribute('role','status');body=el('div');body.className='inventory-recovery-body';
   dialog.append(title,el('p','Recover missing physical copies from a CardResell JSON backup. Review the cards before adding them. Existing copies keep their details. Sales, listings and unfinished operations from the file are not restored.'),el('p','Recovery requires a connection and supports up to 500 missing copies per request. Backup files contain private inventory and sales information.'),close,downloadButton,status,body);document.body.append(dialog);
   dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>{epoch++;backup=null;source='';plan=null;cloud=null;});
  }
  if(busy)return;if(!dialog.open)dialog.showModal();backup=null;source='';cloud=null;message('');render();paused();
 }
 window.CardResellInventoryRecovery={open,pending,paused};
 window.addEventListener('storage',()=>{if(dialog?.open&&!busy){epoch++;plan=null;render();message('Device records changed in another tab. Review again before recovering.');}paused();});
 setInterval(()=>{if(dialog?.open&&viewOwner!==owner()&&!busy){epoch++;backup=null;source='';cloud=null;plan=null;body.replaceChildren();message('Account changed. Close and reopen recovery.');}},1000);
 paused();
})();
