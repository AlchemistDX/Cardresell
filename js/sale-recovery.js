/* A single owner-scoped journal finishes the SAME sale after a partial local
   write. It is never replayed automatically and never sends marketplace writes. */
(() => {
 'use strict';
 const owner=()=>getUserKey('sale_recovery_v1');
 const fail=message=>{throw Error(message);};
 function read(key,fallback) {
  const raw=localStorage.getItem(key);
  try {return raw===null?fallback:JSON.parse(raw);} catch {fail('Saved records could not be read. Export a backup before changing this sale.');}
 }
 function rows(kind) {
  const data=read(getUserKey(kind),[]);
  if(!Array.isArray(data))fail('Saved '+kind+' records need review. Nothing was discarded.');
  const ids=new Set();
  for(const row of data) {
   if(!row||row.id==null||ids.has(String(row.id)))fail('Duplicate or incomplete records need review before this sale can be saved.');
   ids.add(String(row.id));
  }
  return data;
 }
 function receipts(extra,flips=rows('flips')) {
  const maps=new Map(),sales=new Map(),sources=[read(getUserKey('copy_sales_v1'),null),extra];
  function add(r) {
   if(!r||typeof r.copyId!=='string'||!r.copyId||typeof r.saleId!=='string'||!r.saleId||!Number.isFinite(r.recordedAt)||r.recordedAt<=0)fail('The saved sold-copy history needs review.');
   if(maps.has(r.copyId)&&maps.get(r.copyId).saleId!==r.saleId||sales.has(r.saleId)&&sales.get(r.saleId)!==r.copyId)fail('Conflicting sales refer to the same physical copy. Export a backup and review the sale records.');
   if(!maps.has(r.copyId))maps.set(r.copyId,r);
   sales.set(r.saleId,r.copyId);
  }
  for(const source of sources) {
   if(source==null)continue;
   if(source.version!==1||!Array.isArray(source.entries))fail('The saved sold-copy history needs a newer app or recovery.');
   source.entries.forEach(add);
  }
  for(const f of flips)if(f.sourceCollectionId!=null)add({copyId:String(f.sourceCollectionId),saleId:String(f.id),recordedAt:Date.now()});
  for(const f of flips)if(sales.has(String(f.id))&&sales.get(String(f.id))!==String(f.sourceCollectionId))fail('A recorded sale changed physical copies. Review it before saving.');
  if(maps.size>10000)fail('Sold-copy history is full. Existing records have been preserved.');
  return {version:1,entries:[...maps.values()]};
 }
 function journal() {
  const j=read(owner(),null);
  if(j!==null&&(j.version!==1||j.owner!==owner()||!j.copy||j.copy.id==null||!j.sale||!j.sale.id||j.sale.sourceCollectionId!==String(j.copy.id)))fail('The unfinished sale needs recovery. Its saved data has been preserved.');
  return j;
 }
 function write(key,value) {
  if(!_lsWrite(key,JSON.stringify(value)))fail(storageFailureMessage()+' The sale can be resumed from Collection.');
 }
 function availableRows(data,extra) {
  try {
   const sold=new Set(receipts(extra).entries.map(r=>r.copyId));
   return data.filter(r=>!sold.has(String(r?.id)));
  } catch { return data; } // Preserve visible records; commit refuses the conflict.
 }
 function acceptCloud(result) {
  const r=receipts(result.copySales,[...rows('flips'),...(result.flips||[])]);
  write(getUserKey('copy_sales_v1'),r);
  const current=rows('portfolio'),sold=new Set(r.entries.map(r=>r.copyId)),next=current.filter(r=>!sold.has(String(r.id)));
  if(next.length!==current.length)write(getUserKey('portfolio'),next);
  return r;
 }
 async function run(input) {
  const key=owner();
  if(!navigator.locks?.request)fail('This browser cannot safely save a sale across tabs. Update your browser before recording this sale.');
  return navigator.locks.request('cardresell:'+key,()=>{
   if(owner()!==key)fail('Your account changed. Return to the original account to finish this sale.');
   let j=journal(),flips=rows('flips');
   if(!j) {
    if(!input)fail('There is no unfinished sale on this device.');
    if(!window._isPro&&flips.length>=10)fail('The free plan’s sale limit was reached. Existing records are unchanged.');
    if(input.copy.quantity!=null&&Number(input.copy.quantity)!==1)fail('Separate this group into individual physical copies before recording a sale.');
    const matches=rows('portfolio').filter(r=>String(r.id)===String(input.copy.id));
    if(matches.length!==1||JSON.stringify(matches[0])!==JSON.stringify(input.copy))fail('This copy changed. Reload Collection before recording its sale.');
    if(receipts(null,flips).entries.some(r=>r.copyId===String(input.copy.id)))fail('This physical copy already has a recorded sale. Review it in Flips.');
    if(flips.some(r=>String(r.id)===String(input.sale.id)))fail('The new sale ID is already in use. Reload and retry.');
    j={version:1,owner:key,copy:input.copy,sale:input.sale};
    if(JSON.stringify(j).length>900000)fail('This sale is too large for its recovery record. Export a backup before reducing stored images.');
    write(key,j); // Before any business data changes.
   } else if(input&&String(input.copy.id)!==String(j.copy.id))fail('Finish the saved sale in Collection before recording another one.');
   const same=flips.find(r=>String(r.id)===String(j.sale.id));
   if(same&&same.sourceCollectionId!==j.sale.sourceCollectionId)fail('The saved sale ID now refers to another copy. Recovery has paused.');
   const next=same?flips:[...flips,j.sale],r=receipts(null,next);
   if(!same&&!saveFlipsData(next))fail(storageFailureMessage()+' Resume the saved sale from Collection.');
   write(getUserKey('copy_sales_v1'),r);
   if(!_addTombstones('portfolio',j.copy.id))fail(storageFailureMessage()+' Resume the saved sale from Collection.');
   const port=rows('portfolio');
   if(!savePortData(port.filter(p=>String(p.id)!==String(j.copy.id))))fail(storageFailureMessage()+' Resume the saved sale from Collection.');
   write(key,null); // A failed clear remains safely repeatable, with the same ID.
   return same||j.sale;
  });
 }
 function refresh() {
  try {_maybeRerenderCollection(true);}catch{}
  try {if(document.getElementById('flipsView')?.classList.contains('active'))renderFlipsView();}catch{}
  render();
 }
 async function commit(input) {
  const key=owner();
  try {const sale=await run(input);if(owner()!==key)return {ok:false};refresh();return {ok:true,sale};}
  catch(e){if(owner()===key){showToast(e.message,'error');render();}return {ok:false};}
 }
 let rendered='',busy=false;
 function render() {
  const node=document.getElementById('saleRecoveryNotice');if(!node)return;
  let j,error='';try{j=journal();receipts();}catch(e){error=e.message;}
  const stamp=owner()+JSON.stringify(j)+error+busy;if(stamp===rendered)return;rendered=stamp;
  node.replaceChildren();node.hidden=!j&&!error;if(node.hidden)return;
  const text=document.createElement('p');text.style.margin='0 0 .5rem';
  text.textContent=error||'Finish saving the '+(j.sale.card||'card')+' sale for $'+Number(j.sale.sellPrice).toFixed(2)+'. Its original sale and cost details are saved on this device. Resuming will finish that same record.';
  node.append(text);
  if(!error){const button=document.createElement('button');button.type='button';button.className='fl-sub-btn';button.textContent=busy?'Saving…':'Resume saved sale';button.disabled=busy;
   button.onclick=async()=>{busy=true;render();const result=await commit();busy=false;render();if(result.ok)showToast('Sale saved. Review its costs in Flips.','success');};node.append(button);}
 }
 window.CardResellSaleRecovery={commit,availableRows,acceptCloud,render};
 window.addEventListener('storage',render);setInterval(render,1000);render();
})();
