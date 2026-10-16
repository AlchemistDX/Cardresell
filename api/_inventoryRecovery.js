import {createHash} from 'node:crypto';
import {anchorInventory} from './_inventoryEdits.js';
import {backupRetired,recoveryRows,recoveryIdOK,recoveryError} from './_inventoryRecoveryPolicy.js';
const fail=message=>{throw recoveryError(message,409,'inventory_recovery_conflict');};
export function recoveryHistory(blob){
 const all=blob?.inventoryRecoveries??[];
 if(!Array.isArray(all)||all.length>100||all.some(r=>!r||r.version!==1||!recoveryIdOK(r.recoveryId)||!/^[a-f0-9]{64}$/.test(r.requestHash)||!Array.isArray(r.copyIds)||!r.copyIds.length||r.copyIds.length>500||r.copyIds.some(id=>typeof id!=='string'||!id)||new Set(r.copyIds).size!==r.copyIds.length||!Number.isFinite(r.createdAt)||r.createdAt<=0)||new Set(all.map(r=>r.recoveryId)).size!==all.length)fail('Saved backup recovery receipts need review. Nothing was discarded.');
 return all;
}
export function prepareInventoryRecovery(blob,request){
 const all=recoveryHistory(blob),hash=createHash('sha256').update(JSON.stringify(request)).digest('hex'),prior=all.find(r=>r.recoveryId===request.recoveryId);
 if(prior){if(prior.requestHash!==hash)fail('This recovery ID already refers to a different backup request.');return{receipt:prior,replay:true};}
 if(all.length>=100)throw recoveryError('The backup-recovery archive is full. Download a backup before making more recoveries.',413,'inventory_recovery_conflict');
 const portfolio=recoveryRows(blob.portfolio,'Account inventory'),existing=new Set(portfolio.map(r=>String(r.id))),retired=backupRetired(blob);
 if(request.copies.some(r=>existing.has(String(r.id))||retired.has(String(r.id))))fail('A reviewed copy now exists, was sold or was deleted in your account. Refresh the preview; no copies from this request were added.');
 if(portfolio.length+request.copies.length>2000)throw recoveryError('Account inventory would exceed 2,000 copies. No copies were added.',413,'inventory_recovery_conflict');
 const now=Date.now(),receipt={version:1,recoveryId:request.recoveryId,requestHash:hash,copyIds:request.copies.map(r=>String(r.id)),createdAt:now};
 const added=request.copies.map(row=>({...anchorInventory(row,'ie_'+request.recoveryId.slice(3)),recoveredAt:now}));
 return{receipt,replay:false,portfolio:portfolio.concat(added)};
}
