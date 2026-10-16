// Shared with the browser. Independent fields merge; divergent changes to the
// same field need an explicit choice. Client timestamps never decide a value.
export const inventoryFields=['buyPrice','location','sku','addedDate'];
// Editing an old copy is not an intentional re-add. Retain the existing legacy
// re-add policy, but a protected edit cannot outrank a retained deletion mark.
export function inventoryNotDeleted(rows,marks){return rows.filter(r=>!r?.inventoryEdits||!(Number(marks?.[String(r.id)])>0));}
const idOK=id=>typeof id==='string'&&/^ie_[a-f0-9-]{36}$/.test(id);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function fail(message='Inventory details differ between devices. Open Review inventory sync to compare both versions. Sync is paused to preserve your records.') {
 const error=Error(message);error.code='inventory_edit_conflict';error.status=409;throw error;
}
function state(row,key){return JSON.stringify([Object.hasOwn(row,key),row[key],...(key==='buyPrice'?[row.costMeta?.buyPrice??null]:[])]);}
function history(row){
 const h=row.inventoryEdits;if(h===undefined)return {};
 if(!h||h.version!==1||!h.fields||typeof h.fields!=='object'||Array.isArray(h.fields)||Object.keys(h.fields).some(k=>!inventoryFields.includes(k)))fail('This copy has an unsupported inventory history. Download a backup before editing or syncing it.');
 for(const r of Object.values(h.fields))if(!r||!idOK(r.id)||!Array.isArray(r.ancestors)||r.ancestors.length>100||r.ancestors.some(id=>!idOK(id))||new Set([r.id,...r.ancestors]).size!==r.ancestors.length+1||typeof r.base!=='string'||r.base.length>8192)fail('This copy has an unsupported inventory history. Download a backup before editing or syncing it.');
 return h.fields;
}
function assign(out,row,key){
 if(Object.hasOwn(row,key))out[key]=row[key];else delete out[key];
 if(key==='buyPrice'){
  const meta=out.costMeta&&typeof out.costMeta==='object'&&!Array.isArray(out.costMeta)?{...out.costMeta}:{};
  if(row.costMeta&&Object.hasOwn(row.costMeta,'buyPrice'))meta.buyPrice=row.costMeta.buyPrice;else delete meta.buyPrice;
  if(Object.keys(meta).length)out.costMeta=meta;else delete out.costMeta;
 }
}
function nextRevision(row,key,old,id){
 if(!idOK(id))fail('The inventory edit ID is invalid. Reopen the card.');
 if(old?.ancestors.length>=100)fail('This detail has reached its edit-history limit. Download a backup before making more changes.');
 return {id,ancestors:old?[...old.ancestors,old.id]:[],base:old?old.base:state(row,key)};
}
function chooseField(a,b,key,ar,br,preferIncoming){
 if(!ar&&!br)return preferIncoming?b:a;
 if(ar&&br){
  if(ar.base!==br.base)fail();
  if(ar.id===br.id){if(state(a,key)!==state(b,key)||!equal(ar.ancestors,br.ancestors))fail();return preferIncoming?b:a;}
  if(br.ancestors.includes(ar.id)){if(!equal(br.ancestors.slice(0,br.ancestors.indexOf(ar.id)),ar.ancestors))fail();return b;}
  if(ar.ancestors.includes(br.id)){if(!equal(ar.ancestors.slice(0,ar.ancestors.indexOf(br.id)),br.ancestors))fail();return a;}
  fail();
 }
 const protectedRow=ar?a:b,legacy=ar?b:a,r=ar||br;
 if(state(legacy,key)!==r.base&&state(legacy,key)!==state(protectedRow,key))fail();
 return protectedRow;
}
export function editInventory(previous,patch,id,now=Date.now()){
 const old=history(previous),fields={...old},next={...previous};let changed=false;
 if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!inventoryFields.includes(k)))fail('Choose supported inventory details to update.');
 for(const [key,value] of Object.entries(patch)){
  if(key==='buyPrice'){
   if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<0||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>0.0001))fail('Enter a valid purchase cost with no more than two decimal places.');
   next.buyPrice=value;next.costMeta={...(previous.costMeta&&typeof previous.costMeta==='object'&&!Array.isArray(previous.costMeta)?previous.costMeta:{}),buyPrice:value===null?'blank':value===0?'zero':'value'};
  }else{
   if(key==='addedDate'){
    if(value!==null&&(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))fail('Enter a valid acquisition date or leave it unknown.');
   }else if(typeof value!=='string'||value.length>(key==='location'?120:100)||/[\u0000-\u001f\u007f]/.test(value))fail('Location or source SKU is too long or contains unsupported characters.');
   next[key]=value;
  }
  if(state(previous,key)!==state(next,key)){fields[key]=nextRevision(previous,key,old[key],id);changed=true;}
 }
 if(!changed)return previous;
 next.inventoryEdits={version:1,fields};next.updatedAt=now;history(next);return next;
}
export function mergeInventoryEdit(a,b,preferIncoming=true){
 const ah=history(a),bh=history(b);
 if(!Object.keys(ah).length&&!Object.keys(bh).length)return preferIncoming?b:a;
 const out={...(preferIncoming?b:a)},fields={};
 for(const key of inventoryFields){const chosen=chooseField(a,b,key,ah[key],bh[key],preferIncoming);assign(out,chosen,key);const r=chosen===a?ah[key]:bh[key];if(r)fields[key]=r;}
 out.inventoryEdits={version:1,fields};return out;
}
export function mergeInventory(remote,local,preferIncoming=true){
 const map=new Map();for(const rows of [remote,local]){const seen=new Set();for(const row of rows){if(!row||row.id==null)continue;history(row);const key=String(row.id);if(seen.has(key))fail('Some inventory records share an ID. Download a backup before resolving duplicate IDs.');seen.add(key);map.set(key,map.has(key)?mergeInventoryEdit(map.get(key),row,preferIncoming):row);}}
 return [...map.values()];
}
export function inventoryConflicts(account,device){
 const ah=history(account),bh=history(device);
 return inventoryFields.filter(key=>{try{chooseField(account,device,key,ah[key],bh[key],true);return false;}catch(e){if(e.code!=='inventory_edit_conflict')throw e;return true;}});
}
export function resolveInventoryEdit(account,device,choice,id,now){
 if(!account||!device||account.id==null||device.id==null||String(account.id)!==String(device.id)||!['account','device'].includes(choice)||[account,device].some(r=>r.quantity!=null&&Number(r.quantity)!==1))fail('Review one physical copy and choose the details to keep.');
 const ah=history(account),bh=history(device),out={...account},fields={};let conflicts=0;
 for(const key of inventoryFields){
  let chosen,r;
  try{chosen=chooseField(account,device,key,ah[key],bh[key],true);r=chosen===account?ah[key]:bh[key];}
  catch(e){if(e.code!=='inventory_edit_conflict')throw e;conflicts++;chosen=choice==='account'?account:device;r=nextRevision(account,key,ah[key],id);}
  assign(out,chosen,key);if(r)fields[key]=r;
 }
 if(!conflicts)fail('These inventory versions no longer conflict. Refresh the review.');
 out.inventoryEdits={version:1,fields};out.updatedAt=now;history(out);return out;
}
