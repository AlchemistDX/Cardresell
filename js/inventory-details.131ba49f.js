// Per-copy details and a single atomic portfolio write for bulk moves.
(() => {
 'use strict';
 const owner=()=>getUserKey('portfolio'),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const fail=message=>{throw Error(message);};
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const button=(text,fn)=>{const b=el('button',text);b.type='button';b.className='fl-sub-btn';b.onclick=fn;return b;};
 function read(suffix,fallback){const raw=localStorage.getItem(getUserKey(suffix));try{return raw===null?fallback:JSON.parse(raw);}catch{fail('Saved records could not be read. Open Review inventory sync and download a recovery backup.');}}
 function rows(){const all=read('portfolio',[]);if(!Array.isArray(all)||all.some(r=>!r||r.id==null)||new Set(all.map(r=>String(r.id))).size!==all.length)fail('Inventory has missing or duplicate IDs. Download a recovery backup before editing it.');return all;}
 function available(all){
  const marks=read('tombstones',{});
  if(!marks||typeof marks!=='object'||Array.isArray(marks)||marks.portfolio!=null&&(typeof marks.portfolio!=='object'||Array.isArray(marks.portfolio)||Object.values(marks.portfolio).some(v=>!Number.isFinite(Number(v)))))fail('Saved deletions need recovery. Download a backup before editing.');
  return CardResellSaleRecovery.availableRowsStrict(_applyTombstones(CardResellInventoryEdits.inventoryNotDeleted(all,marks.portfolio),marks.portfolio||{}));
 }
 function ready(){
  if(read('sale_recovery_v1',null)!==null)fail('Finish the saved sale in Collection before editing inventory details.');
  if(window.CardResellInventoryConflicts?.pending())fail('Open Review inventory sync and finish the saved choice before editing.');
  if(window.CardResellInventoryRecovery?.pending())fail('Open Recover inventory and finish the saved recovery before editing.');
 }
 let dialog,body,status,save,cancel,form,viewOwner,original=[],dirty,inputs,confirm,busy=false;
 const message=text=>{status.textContent=text;};
 function field(label,key,value,options={}){
  const wrap=el('label',label),input=el('input');input.name=key;input.value=value??'';input.type=options.type||'text';
  if(options.max)input.maxLength=options.max;if(key==='buyPrice')input.inputMode='decimal';
  input.addEventListener('input',()=>{dirty.add(key);paint();});wrap.append(input);
  if(options.help)wrap.append(el('small',options.help));body.append(wrap);inputs[key]=input;
 }
 function paint(){save.disabled=busy||!dirty.size||!!confirm&&!confirm.checked;}
 async function commit(){
  if(busy)return;busy=true;dialog.querySelectorAll('input,button').forEach(n=>n.disabled=true);message('Saving inventory details…');
  try{
   if(owner()!==viewOwner)fail('Account changed. Close and reopen these details.');
   if(!navigator.locks?.request)fail('Update your browser to safely edit inventory across tabs.');
   const patch={};
   for(const key of dirty){const raw=inputs[key].value.trim();
    if(key==='buyPrice'){if(raw!==''&&!/^(?:\d+)(?:\.\d{1,2})?$/.test(raw))fail('Enter a purchase cost with no more than two decimal places, or leave it unknown.');patch[key]=raw===''?null:Number(raw);}
    else patch[key]=key==='addedDate'?(raw||null):raw;
   }
   await navigator.locks.request('cardresell:'+getUserKey('sale_recovery_v1'),()=>{
    if(owner()!==viewOwner)fail('Account changed. Close and reopen these details.');ready();
    const all=rows(),current=new Map(available(all).map(r=>[String(r.id),r])),next=new Map();
    for(const row of original){const found=current.get(String(row.id));if(!found||!same(found,row))fail('A selected copy changed, was sold or was deleted. No details were changed. Close and reopen the editor to review it.');next.set(String(row.id),CardResellInventoryEdits.editInventory(found,patch,'ie_'+crypto.randomUUID()));}
    if(!savePortData(all.map(r=>next.get(String(r.id))||r)))fail('This device could not save your changes. Your entries are still here; free up storage and try again.');
   });
   dialog.close();try{_maybeRerenderCollection(true);}catch{}showToast(original.length===1?'Inventory details saved on this device.':'Location saved for '+original.length+' selected copies.','success');
  }catch(e){message(e.message);}finally{busy=false;dialog.querySelectorAll('input,button').forEach(n=>n.disabled=false);paint();}
 }
 function open(ids,{bulk=false}={}){
  if(busy)return;
  if(!dialog){
   dialog=el('dialog');dialog.id='inventoryDetailsDialog';dialog.setAttribute('aria-labelledby','inventoryDetailsTitle');
   const title=el('h2');title.id='inventoryDetailsTitle';form=el('form');form.noValidate=true;form.onsubmit=e=>{e.preventDefault();if(!save.disabled)commit();};
   body=el('div');body.className='inventory-details-fields';status=el('p');status.setAttribute('role','status');
   save=button('Save details',commit);save.type='submit';save.onclick=null;cancel=button('Cancel',()=>dialog.close());
   form.append(body,status,save,cancel);dialog.append(title,form);document.body.append(dialog);
   dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  }
  viewOwner=owner();original=[];dirty=new Set();inputs={};confirm=null;body.replaceChildren();message('');save.textContent=bulk?'Save location':'Save details';
  document.getElementById('inventoryDetailsTitle').textContent=bulk?'Set location for selected copies':'Inventory details';
  try{
   ready();if(!Array.isArray(ids)||!ids.length||(!bulk&&ids.length!==1)||ids.length>500||new Set(ids.map(String)).size!==ids.length)fail('Select between 1 and 500 individual copies.');
   const all=new Map(available(rows()).map(r=>[String(r.id),r]));original=ids.map(id=>all.get(String(id)));
   if(original.some(r=>!r||r.quantity!=null&&Number(r.quantity)!==1))fail('A selected copy is missing or represents a group. Select individual physical copies.');
   original.forEach(r=>CardResellInventoryEdits.mergeInventoryEdit(r,r));
   if(bulk){
    body.append(el('p',original.length+' selected copies will receive the same location, including selections hidden by your filters.'));
    const list=el('ul');list.className='inventory-details-copies';for(const r of original)list.append(el('li',(r.card||'Unnamed card')+' · '+String(r.id)+' · '+(r.location||'No location')));body.append(list);
    field('New location','location','',{max:120,help:'Leave empty only to clear every selected location.'});
    const clear=button('Clear selected locations',()=>{inputs.location.value='';dirty.add('location');paint();});body.append(clear);
    const label=el('label');label.className='inventory-details-confirm';confirm=el('input');confirm.type='checkbox';confirm.onchange=paint;label.append(confirm,document.createTextNode('Apply this location to all '+original.length+' selected copies'));body.append(label);
   }else{
    const r=original[0];body.append(el('p',[r.card,r.set,r.number,r.grader,r.grade,r.condition].filter(v=>v!=null&&v!=='').join(' · ')),el('p','Physical copy ID: '+String(r.id)));
    field('Purchase cost ($)','buyPrice',typeof r.buyPrice==='number'&&Number.isFinite(r.buyPrice)?String(r.buyPrice):'',{help:'Blank means unknown. Enter 0 only when this copy cost nothing.'});
    field('Location','location',r.location,{max:120,help:'For example: Shelf B · Box 4 · Slot 12'});
    field('Source SKU','sku',r.sku,{max:100,help:'Your reference from another system. Copies may share this SKU; each keeps its own physical copy ID.'});
    field('Acquired on','addedDate',r.addedDate,{max:10,help:'YYYY-MM-DD. Blank means unknown. Existing dates stay unchanged unless you edit this field.'});
    body.append(el('p','Saved on this device first; account sync status appears in Collection. Existing listing drafts keep their prepared details.'));
   }
  }catch(e){message(e.message);original=[];}
  paint();if(!dialog.open)dialog.showModal();
 }
 window.CardResellInventoryDetails={open,rows,available};
 setInterval(()=>{if(dialog?.open&&owner()!==viewOwner&&!busy){original=[];dirty.clear();body.replaceChildren();message('Account changed. Close and reopen these details.');paint();}},1000);
})();
