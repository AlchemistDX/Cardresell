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
// Exercise the real shared zoom helper: never reconfigure iOS hardware,
// serialize changes elsewhere, and contain failures and late settlements.
const zoomCode = source.slice(source.indexOf('function _camZoomBind('), source.indexOf('async function openLiveCameraCapture('));
function zoomFixture(nav = {}) {
  const calls = [], events = new Map(), timers = new Map(), notices = [];
  let timerId = 0, actual = 1;
  const element = () => ({style:{}, value:'1', textContent:'',
    addEventListener(n, fn){events.set(this === slider ? 'slider:'+n : n, fn);},
    removeEventListener(n){events.delete(this === slider ? 'slider:'+n : n);}});
  const slider=element(), video=element(), label=element(), wrap=element();
  const track={getCapabilities:()=>({zoom:{min:1,max:5,step:0.1}}),
    getSettings:()=>({zoom:actual}),getConstraints:()=>({width:{ideal:3840},facingMode:{ideal:'environment'}}),
    applyConstraints(c){const d=deferred();calls.push({c,...d});return d.promise.then(()=>{actual=c.advanced.at(-1).zoom;});}};
  const context={navigator:nav,setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},showToast:m=>notices.push(m)};
  vm.createContext(context);vm.runInContext(zoomCode,context);
  const stop=context._camZoomBind(video,{getVideoTracks:()=>[track]},slider,label,wrap);
  return {calls,events,timers,notices,slider,label,wrap,stop,input(z){slider.value=String(z);events.get('slider:input')?.();}};
}
const flush = async()=>{for(let i=0;i<8;i++) await Promise.resolve();};
await test(async()=>{for(const nav of [{userAgent:'Mozilla iPhone Safari'}, {userAgent:'Mozilla Macintosh',platform:'MacIntel',maxTouchPoints:5}]) {
  const f=zoomFixture(nav);f.input(3);assert.equal(f.calls.length,0);assert.equal(f.events.size,0);assert.equal(f.wrap.style.display,'none');f.stop();}});
await test(async()=>{const f=zoomFixture();f.input(2);f.input(3);f.input(4);assert.equal(f.calls.length,1);
  assert.equal(f.label.textContent,'1.0x');assert.equal(f.calls[0].c.width.ideal,3840);
  f.calls[0].resolve();await flush();assert.equal(f.calls.length,2);assert.equal(f.calls[1].c.advanced.at(-1).zoom,4);
  f.calls[1].resolve();await flush();assert.equal(f.label.textContent,'4.0x');assert.equal(f.timers.size,0);f.stop();});
await test(async()=>{const f=zoomFixture();f.input(2);f.input(4);f.calls[0].reject(Error('unsupported'));await flush();
  assert.equal(f.calls.length,1);assert.equal(f.wrap.style.display,'none');assert.equal(f.notices.length,1);assert.equal(f.timers.size,0);f.stop();});
await test(async()=>{const f=zoomFixture();f.input(2);f.input(4);f.stop();f.calls[0].resolve();await flush();
  assert.equal(f.calls.length,1);assert.equal(f.label.textContent,'1.0x');assert.equal(f.events.size,0);assert.equal(f.timers.size,0);});
await test(async()=>{const f=zoomFixture();f.input(2);f.input(4);[...f.timers.values()][0]();f.calls[0].resolve();await flush();
  assert.equal(f.calls.length,1);assert.equal(f.wrap.style.display,'none');assert.equal(f.label.textContent,'1.0x');assert.equal(f.notices.length,1);f.stop();});
await test(async()=>{const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},textContent:''});return nodes.get(id);};
  const c={document:{getElementById:node}};vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('function _liveCapRenderQA('),source.indexOf('// Public entry point used by the sub-row')),c);
  c._liveCapRenderQA(null);assert.equal(node('liveCapQABar').style.display,'flex');
  assert.match(node('liveCapQAText').textContent,/small text is clear/);assert.equal(node('liveCapFrame').style.borderColor,'rgba(255,255,255,.7)');
  c._liveCapRenderQA({icon:'?',text:'Cannot assess focus'});assert.equal(node('liveCapQAText').textContent,'Cannot assess focus');
  c._liveCapRenderQA(null);assert.equal(node('liveCapQAPill').style.color,'#fff');});
console.log(`Photo capture lifecycle: ${cases} passed, 0 failed -- SUITE COMPLETE, exit=0`);
