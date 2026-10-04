import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { referencedHashedAssets } from './_assetRefs.mjs';
const source = readFileSync(referencedHashedAssets().find(a => a.base === 'ui').path, 'utf8');
const code = source.slice(source.indexOf('async function openLiveCameraCapture('), source.indexOf('/* ── Live QA analyzer'));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function fixture() {
  const requests=[], blobs=[], captures=[], cancels=[], notices=[];
  let qa=0, stopped=0;
  const nodes=new Map();
  const node=id => {
    if (!nodes.has(id)) nodes.set(id,{style:{},textContent:'',addEventListener(){},videoWidth:800,videoHeight:1100,play:()=>Promise.resolve(),getContext:()=>({drawImage(){}}),toBlob(cb){blobs.push(cb);}});
    return nodes.get(id);
  };
  const context={window:{},navigator:{mediaDevices:{getUserMedia(){const d=deferred();requests.push(d);return d.promise;}}},document:{getElementById:node},console:{warn(){}},File:class {},setTimeout(){},showToast:m=>notices.push(m),_liveCapStopQA(){},_liveCapStartQA(){qa++;},_camZoomBind:()=>()=>{}};
  vm.createContext(context); vm.runInContext(code,context);
  return {context,requests,blobs,captures,cancels,notices,node,get qa(){return qa;},get stopped(){return stopped;},stream:()=>({getTracks:()=>[{stop(){stopped++;}}]}),open:()=>context.openLiveCameraCapture({guidance:'Readable front <not markup>',onCapture:f=>captures.push(f),onCancel:r=>cancels.push(r)})};
}
let cases=0;
async function test(fn){await fn();cases++;}
await test(async()=>{const f=fixture(),p=f.open();f.context._liveCapCancel();f.requests[0].resolve(f.stream());await p;assert.equal(f.stopped,1);assert.equal(f.qa,0);assert.equal(f.node('liveCapVideo').srcObject,null);assert.deepEqual(f.cancels,['user-cancel']);});
await test(async()=>{const f=fixture(),p=f.open(),q=f.open(),fresh=f.stream();f.requests[1].resolve(fresh);await q;f.requests[0].resolve(f.stream());await p;assert.equal(f.node('liveCapVideo').srcObject,fresh);assert.equal(f.stopped,1);assert.equal(f.qa,1);});
await test(async()=>{const f=fixture(),p=f.open(),q=f.open();f.requests[0].reject(Error('denied'));await p;assert.equal(f.context.window._liveCapState.active,true);assert.deepEqual(f.cancels,[]);f.requests[1].resolve(f.stream());await q;assert.equal(f.qa,1);});
await test(async()=>{const f=fixture(),play=deferred();f.node('liveCapVideo').play=()=>play.promise;const p=f.open();f.requests[0].resolve(f.stream());await Promise.resolve();f.context._liveCapCancel();play.resolve();await p;assert.equal(f.stopped,1);assert.equal(f.qa,0);});
await test(async()=>{const f=fixture(),p=f.open();f.requests[0].resolve(f.stream());await p;f.context._liveCapSnap();f.context._liveCapSnap();assert.equal(f.blobs.length,1);f.blobs[0]({});assert.equal(f.captures.length,1);assert.equal(f.stopped,1);assert.equal(f.node('liveCapVideo').srcObject,null);});
await test(async()=>{const f=fixture(),p=f.open();f.requests[0].resolve(f.stream());await p;f.context._liveCapSnap();f.context._liveCapCancel();f.blobs[0]({});assert.equal(f.captures.length,0);});
await test(async()=>{const f=fixture(),p=f.open();f.requests[0].resolve(f.stream());await p;f.context._liveCapSnap();const q=f.open();f.requests[1].resolve(f.stream());await q;f.blobs[0]({});assert.equal(f.captures.length,0);assert.equal(f.context.window._liveCapState.active,true);});
await test(async()=>{const f=fixture(),p=f.open();f.requests[0].resolve(f.stream());await p;f.context._liveCapSnap();f.blobs[0](null);f.context._liveCapSnap();assert.equal(f.blobs.length,2);f.blobs[1]({});assert.equal(f.captures.length,1);});
await test(async()=>{const f=fixture();delete f.context.navigator.mediaDevices;await f.open();assert.deepEqual(f.cancels,['unsupported']);});
await test(async()=>{const f=fixture(),p=f.open();f.requests[0].reject(Error('denied'));await p;assert.deepEqual(f.cancels,['permission-denied']);assert.equal(f.context.window._liveCapState.active,false);});
await test(async()=>{const f=fixture(),p=f.open();assert.equal(f.node('liveCapGuidance').textContent,'Readable front <not markup>');f.context._liveCapSnap();assert.equal(f.blobs.length,0);f.requests[0].resolve(f.stream());await p;});
console.log(`Photo capture lifecycle: ${cases} passed, 0 failed -- SUITE COMPLETE, exit=0`);
