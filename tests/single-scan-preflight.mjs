import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { referencedHashedAssets } from './_assetRefs.mjs';

const source = readFileSync(referencedHashedAssets().find(a => a.base === 'core').path, 'utf8');
const names = new Set(['processScanImage', 'cancelScan']);
const code = parse(source, { ecmaVersion: 'latest' }).body
  .filter(n => n.type === 'FunctionDeclaration' && names.has(n.id.name))
  .map(n => source.slice(n.start, n.end)).join('\n');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(r => setImmediate(r));
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
function fixture() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { style:{}, classList:{remove(){}}, textContent:'', innerHTML:'',
      cloneNode(){return this}, removeAttribute(){}, addEventListener(){}, parentNode:{replaceChild(){}} });
    return nodes.get(id);
  };
  let requests=0, compressed=0, renders=0;
  const revoked=[], readers=[], qcOptions=[];
  const response = {ok:true, status:200, json:async()=>({ needsPicker:true, candidates:[{name:'A'},{name:'B'}] })};
  const window = { googleUser:{sub:'owner'}, _fbAuth:{currentUser:{uid:'owner'}}, _googleIdToken:'fixture',
    CardResellPhotoQC:{check:async(file,options)=>{qcOptions.push(options); return {ok:true}}},
    CardResellFastPath:{scanFile:async()=>null},
    cardResellScanRequest:async()=>{requests++;return response} };
  const context = {window, document:{getElementById:node}, console:{warn(){},error(){},log(){}},
    URL:{createObjectURL:()=>`blob:${readers.length}`,revokeObjectURL:u=>revoked.push(u)},
    FileReader:class {constructor(){readers.push(this)} readAsDataURL(){}},
    _validateScanFile:()=>'', _clearScanAutoAdvance(){}, _dialogOpened(){}, _dialogClosed(){}, _setScanBtns(){},
    compressImage:async()=>{compressed++;return 'fixture-image'},
    _renderScanCandidatesPicker(candidates,status,result,url){renders++;window._pendingScanObjectUrl=url}, setTimeout,
  };
  vm.createContext(context); vm.runInContext(code,context);
  return {window,context,node,response,revoked,readers,qcOptions,
    run:()=>context.processScanImage({files:[{name:'card.jpg'}]}),
    cancel:()=>context.cancelScan(), requests:()=>requests, compressed:()=>compressed, renders:()=>renders};
}
for (const fault of ['missing', 'throws', 'rejects']) {
  const f=fixture();
  if(fault==='missing') delete f.window.CardResellPhotoQC;
  else f.window.CardResellPhotoQC.check=async()=>{if(fault==='throws')throw Error('decode');return {ok:false,reasons:['unreadable'],details:{}}};
  await f.run();
  check(f.requests()===0 && f.compressed()===0, fault+': no request or compression');
  check(/No credit was used/.test(f.node('scanResult').innerHTML),fault+': clear no-charge feedback');
  check(f.revoked.length>0,fault+': preview URL released');
}
for (const stage of ['quality', 'catalog', 'compression']) {
  for (const action of ['cancel', 'account', 'signout', 'replace']) {
    const f=fixture(), d=deferred();
    if(stage==='quality') f.window.CardResellPhotoQC.check=()=>d.promise;
    if(stage==='catalog') f.window.CardResellFastPath.scanFile=()=>d.promise;
    if(stage==='compression') f.context.compressImage=()=>d.promise;
    const pending=f.run(); await tick();
    if(action==='cancel') f.cancel();
    if(action==='account') f.window._fbAuth.currentUser={uid:'other'};
    if(action==='signout') f.window._fbAuth.currentUser=null;
    if(action==='replace') {
      f.window.CardResellPhotoQC.check=async()=>({ok:true});
      f.window.CardResellFastPath.scanFile=async()=>null;
      f.context.compressImage=async()=> 'new-image';
      await f.run();
    }
    const before=f.requests(), status=f.node('scanStatus').innerHTML;
    d.resolve(stage==='quality'?{ok:true}:stage==='catalog'?null:'old-image');
    await pending;
    check(f.requests()===before,stage+'/'+action+': abandoned photo cannot dispatch');
    check(f.node('scanStatus').innerHTML===status,stage+'/'+action+': abandoned work cannot repaint');
    f.readers[0].result='data:old-photo';f.readers[0].onload();
    check(f.window._lastScanImageDataUrl!=='data:old-photo',stage+'/'+action+': late reader cannot replace current photo');
    check(f.revoked.length>0,stage+'/'+action+': abandoned preview released');
  }
}
for (const stage of ['response', 'body']) {
  const f=fixture(), d=deferred();
  if(stage==='response') f.window.cardResellScanRequest=()=>d.promise;
  else f.response.json=()=>d.promise;
  const pending=f.run();await tick();f.cancel();
  d.resolve(stage==='response'?f.response:{needsPicker:true,candidates:[{},{}]});
  await pending;
  check(f.renders()===0,stage+': late paid response cannot populate closed scanner');
}
{
  const f=fixture(), d=deferred();f.context.compressImage=()=>d.promise;
  const pending=f.run();await tick();f.cancel();d.reject(Error('old compression failure'));await pending;
  check(f.node('scanStatus').innerHTML==='', 'late failure cannot overwrite closed scanner');
}
{
  const f=fixture();f.context.compressImage=async()=>{throw Error('Could not prepare photo')};await f.run();
  check(f.requests()===0 && /Could not prepare photo/.test(f.node('scanStatus').innerHTML), 'compression failure is visible without dispatch');
  check(f.revoked.length>0,'compression failure releases preview');
}
{
  const f=fixture();f.window._skipQCDupe=true;await f.run();await f.run();
  check(f.requests()===2 && f.renders()===2,'valid current photos retain normal request and picker flow');
  check(f.qcOptions[0].skipDupe===true && f.qcOptions[1].skipDupe===false,'duplicate override belongs to one photo');
  check(!f.revoked.includes('blob:1'),'current candidate picker keeps its preview');
  f.cancel();
  check(f.revoked.includes('blob:1') && f.window._pendingScanObjectUrl===null,'cancelling picker releases its preview');
}
console.log(`single-scan-preflight: ${checks} passed, 0 failed -- SUITE COMPLETE, exit=0`);
