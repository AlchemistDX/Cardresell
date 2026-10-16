// Explicit accounting choices. A durable, owner-scoped journal survives a lost
// response; no request is replayed until the seller presses Resume.
(() => {
 'use strict';
 const api=()=>window.CardResellSaleCorrections;
 const owner=()=>getUserKey('sale_conflict_v1');
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const fail=message=>{throw Error(message);};
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const button=(text,fn)=>{const n=el('button',text);n.type='button';n.className='fl-sub-btn';n.onclick=fn;return n;};
 function read(key,fallback=null){const s=localStorage.getItem(key);if(s===null)return fallback;try{return JSON.parse(s);}catch{fail('Saved records could not be read. Download a recovery backup before changing them.');}}
 function rows(){const data=read(getUserKey('flips'),[]);if(!Array.isArray(data)||data.some(r=>!r||r.id==null)||new Set(data.map(r=>String(r.id))).size!==data.length)fail('Sales have missing or duplicate IDs. Download a recovery backup; nothing was discarded.');return data;}
 function journal(){const j=read(owner());if(j!==null&&(j.version!==1||j.owner!==owner()||j.request?.action!=='resolve_sale'||!/^sc_[a-f0-9-]{36}$/.test(j.request.resolutionId)||!j.request.expected||!j.request.candidate||!['account','device'].includes(j.request.choice)))fail('The unfinished sale choice needs recovery. Download a backup; its saved data is unchanged.');return j;}
 function pending(){try{return localStorage.getItem(owner())!==null&&localStorage.getItem(owner())!=='null';}catch{return true;}}
 function write(key,value){if(!_lsWrite(key,JSON.stringify(value)))fail('This device could not save the recovery record. Your sale choice can be resumed from Review sale sync.');}
 function confirmed(j,receipt){
  if(receipt?.version!==1||!same(receipt.request,j.request)||!Number.isFinite(receipt.createdAt)||!same(receipt.result,api().resolveSaleCorrection(j.request.expected,j.request.candidate,j.request.choice,j.request.resolutionId,receipt.createdAt)))fail('The account response could not be confirmed. Resume the saved choice to check again.');
 }
 const paused=()=>{if(!pending())return false;_collectionSyncNotice('A sale choice needs recovery. Open Review sale sync and resume the saved choice.');return true;};
 let dialog,body,status,viewOwner='',cloud=null,busy=false,generation=0;
 function message(text){if(status)status.textContent=text;}
 function backup(){
  if(viewOwner!==owner()){message('Account changed. Reopen this review before downloading.');return;}
  const local={};for(const suffix of ['portfolio','flips','tombstones','copy_sales_v1','sale_recovery_v1','sale_conflict_v1','inventory_conflict_v1','inventory_restore_v1']){
   const raw=localStorage.getItem(getUserKey(suffix));try{local[suffix]=raw===null?null:JSON.parse(raw);}catch{local[suffix]={unreadableRaw:raw};}
  }
  const data={format:'cardresell-sale-recovery',version:1,exportedAt:new Date().toISOString(),local,account:cloud};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download='cardresell-sale-recovery.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function request(bodyValue){
  const who=owner(),token=window._googleIdToken;
  if(!window.googleUser?.sub||!token)fail('Sign in to the original account to review or resume this choice.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
   const response=await fetch('/api/user-data',{method:bodyValue?'POST':'GET',headers:{Authorization:'Bearer '+token,...(bodyValue?{'Content-Type':'application/json'}:{})},...(bodyValue?{body:JSON.stringify(bodyValue)}:{}),signal:controller.signal});
   const data=await response.json();if(owner()!==who)fail('Account changed. Return to the original account to finish this review.');
   if(!response.ok){const error=Error(data.message||'Account data could not be confirmed. Try again when connected.');error.code=data.error;error.status=response.status;throw error;}return data;
  }finally{clearTimeout(timer);}
 }
 function showVersion(row,title,choice,name,onChoose){
  const card=el('section');card.className='sale-conflict-version';card.append(el('h4',title));
  let report;try{report=CardResellFlipReport.build([row]).rows[0];}catch{}
  const money=n=>n===null||n===undefined?'Unknown':'$'+(n/100).toFixed(2),list=el('dl');
  const values=[['Sale date',row.date||'Unknown'],['Original proceeds',money(report?.sale)],...['Purchase','Fees','Shipping','Grading','Refunds','Other expenses'].map((label,i)=>[label,money(report?.costs[i])]),['Profit after tracked costs',money(report?.net)],['Expense note',row.expenseNote||'None']];
  for(const [label,value] of values){list.append(el('dt',label),el('dd',value));}card.append(list);
  const label=el('label'),radio=el('input');radio.type='radio';radio.name=name;radio.value=choice;radio.addEventListener('change',()=>onChoose(choice));label.append(radio,document.createTextNode(' Use '+title.toLowerCase()));card.append(label);return card;
 }
 async function run(input){
  const who=owner();if(!navigator.locks?.request)fail('Update your browser to safely resolve a sale across tabs.');
  return navigator.locks.request('cardresell:'+getUserKey('sale_recovery_v1'),async()=>{
   if(owner()!==who)fail('Account changed. Reopen this review.');
   let j=journal();
   if(!j){
    if(!input)fail('There is no saved choice to resume. Refresh the review.');
    const matches=rows().filter(r=>String(r.id)===String(input.candidate.id));
    if(matches.length!==1||!same(matches[0],input.candidate))fail('This device’s sale changed after review. Refresh and compare the latest versions.');
    j={version:1,owner:who,request:input};if(JSON.stringify(j).length>300000)fail('These sale versions exceed the recovery limit. Download a backup first.');
    write(who,j);_cancelUserDataSync();paused();
   }else if(input)fail('Resume the saved choice before choosing another sale.');
   if(j.rejected)fail('This choice was not applied. Refresh the review to compare the latest versions.');
   if(!j.confirmed){
    let result;
    try{result=await request(j.request);}catch(error){
     if(owner()===who&&[400,409,413].includes(error.status)&&['sale_resolution_conflict','sale_correction_conflict','copy_sale_conflict','payload_too_large'].includes(error.code)){j.rejected=error.message;write(who,j);}
     throw error;
    }
    if(owner()!==who)fail('Account changed. Return to the original account to resume.');
    const receipt=result.resolution;
    if(result.ok!==true)fail('The account response could not be confirmed. Resume the saved choice to check again.');
    confirmed(j,receipt);
    j.confirmed=receipt;write(who,j); // Persist acknowledgement before local changes.
   }
   confirmed(j,j.confirmed);
   const all=rows(),matches=all.filter(r=>String(r.id)===String(j.request.candidate.id));
   // The server may have accepted a choice while a legacy tab edited/deleted
   // this row. Keep that new local state; both reviewed versions are archived.
   const changed=matches.length!==1||(!same(matches[0],j.request.candidate)&&!same(matches[0],j.confirmed.result));
   if(!changed&&!same(matches[0],j.confirmed.result))write(getUserKey('flips'),all.map(r=>r===matches[0]?j.confirmed.result:r));
   write(who,null);_scheduleUserDataSync();
   try{renderFlipsView();}catch{}
   return changed?'Choice saved to your account. This device changed meanwhile and was left unchanged; review it again.':'Sale choice saved. Both reviewed versions are kept in the recovery backup.';
  });
 }
 async function act(input){
  if(busy)return;busy=true;const who=owner();dialog?.querySelectorAll('button,input').forEach(n=>n.disabled=true);message('Saving your choice…');
  let text='';try{text=await run(input);}catch(e){text=e.name==='AbortError'?'Connection interrupted. Resume the saved choice to check whether it was saved.':e.message;}
  finally{busy=false;if(owner()===who&&dialog?.open){await review(text);}else if(dialog?.open){cloud=null;body.replaceChildren();message('Account changed. Close and reopen this review.');}dialog?.querySelectorAll('button').forEach(n=>{if(!n.dataset.needsChoice)n.disabled=false;});}
 }
 async function review(notice=''){
  const turn=++generation,who=owner();viewOwner=who;cloud=null;body.replaceChildren();message(notice||'Reading saved account sales…');
  try{
   const j=journal();
   if(j){
    body.append(el('p',j.rejected||'A saved sale choice is waiting to finish. Resuming checks the same request and cannot create a second sale.'));
    if(j.rejected)body.append(button('Refresh review',async()=>{
     if(busy||owner()!==who)return;busy=true;
     try{await navigator.locks.request('cardresell:'+getUserKey('sale_recovery_v1'),()=>{if(owner()!==who||!same(journal(),j))fail('The saved choice changed. Reopen the review.');write(who,null);});}catch(e){message(e.message);return;}finally{busy=false;}await review();
    }));else body.append(button('Resume saved choice',()=>act()));
    if(!notice)message('Cloud sync is paused until this choice is reviewed.');return;
   }
   const data=await request();if(turn!==generation||owner()!==who||!dialog.open)return;
   if(!Array.isArray(data.flips))fail('Account sales could not be read. Nothing was changed.');
   cloud=data;
   const local=rows();api().mergeSales([],data.flips);api().mergeSales([],local);
   const map=new Map(data.flips.filter(r=>r&&r.id!=null).map(r=>[String(r.id),r]));let count=0;
   for(const device of local){const account=map.get(String(device.id));if(!account)continue;let conflict=false;try{api().mergeSaleCorrection(account,device);}catch(e){if(e.code!=='sale_correction_conflict')throw e;conflict=true;}if(!conflict)continue;
    count++;const item=el('article');item.className='sale-conflict-item';item.append(el('h3',device.card||account.card||'Unnamed card'),el('p','Sale ID: '+String(device.id)));
    const grid=el('div');grid.className='sale-conflict-grid';let choice='';
    const save=button('Use selected version',()=>act({action:'resolve_sale',resolutionId:'sc_'+crypto.randomUUID(),choice,expected:account,candidate:device}));save.disabled=true;save.dataset.needsChoice='true';
    const selected=value=>{if(owner()!==who){message('Account changed. Reopen this review.');return;}choice=value;save.disabled=false;};
    grid.append(showVersion(device,'This device','device','sale-choice-'+count,selected),showVersion(account,'Saved account','account','sale-choice-'+count,selected));item.append(grid,save);body.append(item);
   }
   message((notice?notice+' ':'')+(count?count+' sale conflict'+(count===1?'':'s')+' to review. Choose the complete set of amounts to keep.':'No sale conflicts found in the current versions.'));
   if(!count)body.append(button('Retry cloud sync',()=>{if(owner()===who)_pushUserData();}));
   body.append(button('Refresh review',()=>review()));
  }catch(e){if(turn===generation&&owner()===who)message((notice?notice+' ':'')+e.message);}
 }
 async function open(){
  if(!dialog){
   dialog=el('dialog');dialog.id='saleConflictDialog';dialog.setAttribute('aria-labelledby','saleConflictTitle');
   const title=el('h2','Review sale sync');title.id='saleConflictTitle';
   const close=button('Close review',()=>dialog.close());
   const download=button('Download recovery backup',backup);
   status=el('p');status.setAttribute('role','status');body=el('div');body.className='sale-conflict-body';
   dialog.append(title,el('p','Choose the sale amounts to keep. Your sale ID and physical card stay the same. Both versions are saved for recovery. Other devices with different edits may need a separate review.'),el('p','The JSON backup includes private inventory, sale records and saved choices. Keep it somewhere safe.'),close,download,status,body);document.body.append(dialog);
   dialog.addEventListener('close',()=>{generation++;cloud=null;body.replaceChildren();});
  }
  if(busy){if(!dialog.open)dialog.showModal();return;}
  if(!dialog.open)dialog.showModal();await review();
 }
 window.CardResellSaleConflicts={open,pending,paused};
 window.addEventListener('storage',()=>{if(dialog?.open&&!busy){generation++;cloud=null;body.replaceChildren();message('Saved records changed in another tab. Refresh the review.');body.append(button('Refresh review',()=>review()));}paused();});
 setInterval(()=>{if(dialog?.open&&viewOwner!==owner()){generation++;cloud=null;body.replaceChildren();message('Account changed. Close and reopen this review.');}},1000);
 paused();
})();
