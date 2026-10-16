import {resolveSaleCorrection} from './_saleCorrections.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=(message,status=409)=>{const e=new Error(message);e.code='sale_resolution_conflict';e.status=status;throw e;};
export function resolutionRequest(body) {
  if(!body||body.action!=='resolve_sale'||!/^sc_[a-f0-9-]{36}$/.test(body.resolutionId)||!['account','device'].includes(body.choice)||
    !body.expected||Array.isArray(body.expected)||typeof body.expected!=='object'||body.expected.id==null||
    !body.candidate||Array.isArray(body.candidate)||typeof body.candidate!=='object'||body.candidate.id==null||
    String(body.expected.id)!==String(body.candidate.id))fail('Review both sale versions and choose which amounts to keep.',400);
  const request={action:'resolve_sale',resolutionId:body.resolutionId,choice:body.choice,expected:body.expected,candidate:body.candidate};
  if(Buffer.byteLength(JSON.stringify(request))>300000)fail('These sale versions exceed the recovery size limit. Download a backup first.',413);
  return request;
}
export function resolutionHistory(blob) {
  const rows=blob?.saleResolutions??[];
  if(!Array.isArray(rows)||rows.length>100||rows.some(r=>!r||r.version!==1||!r.request?.resolutionId||!r.result||!Number.isFinite(r.createdAt))||new Set(rows.map(r=>r.request.resolutionId)).size!==rows.length)
    fail('Saved sale choices need recovery. Nothing was discarded.');
  return rows;
}
export function prepareResolution(blob,request,visibleFlips) {
  const history=resolutionHistory(blob),receipt=history.find(r=>r.request.resolutionId===request.resolutionId);
  if(receipt){if(!same(receipt.request,request))fail('This recovery ID was already used for another choice.');return {receipt,replay:true};}
  if(history.length>=100)fail('The saved-choice archive is full. Download a backup before making more choices.',413);
  const matches=visibleFlips.filter(r=>r&&r.id!=null&&String(r.id)===String(request.expected.id));
  if(matches.length!==1||!same(matches[0],request.expected))fail('The account sale changed after this review. Refresh and compare the latest versions.');
  const createdAt=Date.now(),result=resolveSaleCorrection(matches[0],request.candidate,request.choice,request.resolutionId,createdAt);
  return {receipt:{version:1,request,result,createdAt},replay:false};
}
