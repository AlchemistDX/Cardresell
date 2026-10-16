import {resolveInventoryEdit} from './_inventoryEdits.js';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=(message,status=409)=>{const e=Error(message);e.code='inventory_resolution_conflict';e.status=status;throw e;};
export function inventoryRequest(body){
 if(!body||body.action!=='resolve_inventory'||!/^ie_[a-f0-9-]{36}$/.test(body.resolutionId)||!['account','device'].includes(body.choice)||!body.expected||typeof body.expected!=='object'||Array.isArray(body.expected)||body.expected.id==null||!body.candidate||typeof body.candidate!=='object'||Array.isArray(body.candidate)||body.candidate.id==null||String(body.expected.id)!==String(body.candidate.id))fail('Review both inventory versions and choose which details to keep.',400);
 const request={action:'resolve_inventory',resolutionId:body.resolutionId,choice:body.choice,expected:body.expected,candidate:body.candidate};
 if(Buffer.byteLength(JSON.stringify(request))>300000)fail('These copy records exceed the recovery size limit. Download a backup first.',413);
 return request;
}
export function inventoryHistory(blob){
 const rows=blob?.inventoryResolutions??[];
 if(!Array.isArray(rows)||rows.length>100||rows.some(r=>!r||r.version!==1||!r.request?.resolutionId||!r.result||!Number.isFinite(r.createdAt))||new Set(rows.map(r=>r.request.resolutionId)).size!==rows.length)fail('Saved inventory choices need recovery. Nothing was discarded.');
 return rows;
}
export function prepareInventoryResolution(blob,request,visible){
 const history=inventoryHistory(blob),receipt=history.find(r=>r.request.resolutionId===request.resolutionId);
 if(receipt){if(!same(receipt.request,request))fail('This recovery ID was already used for another choice.');return{receipt,replay:true};}
 if(history.length>=100)fail('The saved-choice archive is full. Download a backup before making more choices.',413);
 const matches=visible.filter(r=>r&&r.id!=null&&String(r.id)===String(request.expected.id));
 if(matches.length!==1||!same(matches[0],request.expected))fail('The account copy changed, was sold or was deleted after review. Refresh and compare the latest records.');
 const createdAt=Date.now(),result=resolveInventoryEdit(matches[0],request.candidate,request.choice,request.resolutionId,createdAt);
 return{receipt:{version:1,request,result,createdAt},replay:false};
}
