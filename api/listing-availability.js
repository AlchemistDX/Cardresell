// Read-only, owner-scoped snapshot for Collection and manual listing exports.
// This is not a marketplace reservation or proof that a card has not sold elsewhere.
import {verifyTokenFlexible} from './_verifyToken.js';
import {kvFromEnv} from './_kv.js';
import {draftKey,isDraftId,isSyntheticTestSub,readStoredDraft} from './_draftStore.js';
import {listingKey,parseListing} from './_ebayOperations.js';
import {copySales} from './_copySales.js';
import {hash} from './_ebaySeller.js';

const fail=(message,status=503)=>Object.assign(Error(message),{status});
// GET inside one script reads a consistent snapshot and rejects wrong key types.
// MGET would silently treat a corrupt non-string reservation as a missing key.
export const availabilitySnapshot=`local out={};for i=1,#KEYS do out[i]=redis.call('GET',KEYS[i]) or false end;return out`;
const read=(kv,keys)=>kv('EVAL',availabilitySnapshot,keys.length,...keys);
const validCopy=id=>typeof id==='string'&&id.length>0&&id.length<=1024;

export function createHandler({verify=verifyTokenFlexible,env=process.env,store}={}) {
 return async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try {
   const token=String(req.headers?.authorization||'').match(/^Bearer (.+)$/)?.[1];let identity;
   try{if(!token)throw Error();identity=await verify(token);}catch{throw fail('Sign in again to check listing availability.',401);}
   const uid=identity?.uid;if(!uid)throw fail('Sign in again to check listing availability.',401);
   if(isSyntheticTestSub(uid))throw fail('Reserved account namespace',403);
   let body=req.body;
   if(typeof body==='string'){if(Buffer.byteLength(body)>100000)throw fail('Availability request is too large.',413);try{body=JSON.parse(body);}catch{throw fail('Invalid availability request.',400);}}
   if(!body||typeof body!=='object'||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>100000)throw fail('Invalid availability request.',400);
   const exporting=Array.isArray(body.drafts),copies=Array.isArray(body.copyIds);
   if(exporting===copies)throw fail('Choose drafts or Collection copies to check.',400);
   const inputs=exporting?body.drafts:body.copyIds;
   if(!inputs.length||inputs.length>(exporting?100:2000))throw fail('Choose up to 100 drafts or 2,000 Collection copies.',400);
   if(exporting?inputs.some(d=>!isDraftId(d?.draftId)||!Number.isInteger(d.rev)||d.rev<1):inputs.some(id=>!validCopy(id)))throw fail('A selected card or draft has an invalid identity or revision. Refresh it and try again.',400);
   if(new Set(inputs.map(d=>exporting?d.draftId:d)).size!==inputs.length)throw fail('A selected card or draft was repeated. Refresh your selection.',400);
   const kv=store||kvFromEnv(env);if(!kv)throw fail('Availability could not be checked. Your cards and drafts are unchanged.');
   const draftKeys=exporting?inputs.map(d=>draftKey(uid,d.draftId)):[];
   const rawDrafts=exporting?await read(kv,draftKeys):[];
   const drafts=rawDrafts.map((raw,i)=>{
    const result=readStoredDraft(raw),d=result.draft;
    if(!result.ok||d?.draftId!==inputs[i].draftId||d.rev!==inputs[i].rev||d.status!=='draft'||typeof d.instanceId!=='string'||!d.instanceId.length||d.instanceId.length>64)throw fail('A selected draft changed, was archived or was deleted. Refresh drafts before exporting. No file was created.',409);
    return d;
   });
   const instances=exporting?drafts.map(d=>d.instanceId):inputs.map(id=>'inst_col_'+id);
   if(exporting&&new Set(instances).size!==instances.length)throw fail('Two selected drafts refer to the same physical copy. Choose one draft for that copy before exporting.',409);
   // Manual files target real eBay inventory even if the current connection is
   // disabled, expired, disconnected or switched to Sandbox. Never read tokens.
   const operationKeys=instances.map(id=>listingKey('production',uid,id));
   const values=await read(kv,['userdata:'+uid,...operationKeys,...draftKeys]);
   if(!Array.isArray(values)||values.length!==1+operationKeys.length+draftKeys.length)throw fail('Availability could not be checked. Retry before exporting.');
   if(exporting&&rawDrafts.some((raw,i)=>raw!==values[1+instances.length+i]))throw fail('A selected draft changed during the check. Refresh drafts before exporting. No file was created.',409);
   let data=null;
   if(values[0]!=null){try{data=JSON.parse(values[0]);}catch{throw fail('Cloud inventory could not be read. Retry Collection sync before exporting.');}
    if(!data||!Array.isArray(data.portfolio)||!Array.isArray(data.flips))throw fail('Cloud inventory needs review. Retry Collection sync before exporting.');}
   const sold=new Set(copySales(data?.copySales,data?.flips||[]).entries.map(r=>r.copyId));
   const rows=new Map();for(const row of data?.portfolio||[]){if(row?.id==null)continue;const id=String(row.id);rows.set(id,rows.has(id)?null:row);}
   const records=instances.map((instanceId,i)=>{
    const copyId=instanceId.startsWith('inst_col_')?instanceId.slice(9):null,row=rows.get(copyId),isSold=copyId!==null&&sold.has(copyId);
    let operation;try{operation=parseListing(values[1+i],operationKeys[i]);}catch{return {copyId,instanceId,...(exporting?{draftId:inputs[i].draftId,rev:inputs[i].rev}:{}),state:'unknown',canExport:false,label:'eBay reservation needs recovery',operationId:hash(instanceId)};}
    const held=!!operation&&operation.state!=='cancelled';
    const deletedAt=Number(data?.tombstones?.portfolio?.[copyId])||0;
    const synced=!!row&&(!deletedAt||Number(row.updatedAt)>deletedAt);
    const individual=synced&&(row.quantity==null||Number(row.quantity)===1);
    let state,label;
    if(isSold){state='sold';label=held?'Sale recorded · eBay reservation still held':'Sale recorded · do not relist';}
    else if(held){state='held';label=operation.state==='planned'?'Reserved for eBay · plan not sent':operation.state==='pending'?'eBay result uncertain · copy held':'Reserved for eBay · review saved status';}
    else if(copyId===null){state='untracked';label='No saved eBay hold · copy not linked to Collection';}
    else if(!synced){state='not_synced';label='Sync this copy to Collection before listing';}
    else if(!individual){state='grouped';label='Separate individual copies before listing';}
    else{state='clear';label='No recorded sale or eBay hold';}
    return {copyId,instanceId,...(exporting?{draftId:inputs[i].draftId,rev:inputs[i].rev}:{}),state,label,canExport:state==='clear'||state==='untracked',...(held?{operationId:hash(instanceId)}:{})};
   });
   return res.status(200).json({version:1,environment:'production',checkedAt:Date.now(),records});
  } catch(error) {return res.status(error.status||503).json({error:error.status?error.message:'Availability could not be checked. Retry before exporting; your drafts are unchanged.'});}
 };
}
export default createHandler();
