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
  const context={window:{addEventListener(){},removeEventListener(){}},_liveCapLayout(){},navigator:{mediaDevices:{getUserMedia(){const d=deferred();requests.push(d);return d.promise;}}},document:{getElementById:node},console:{warn(){}},File:class {},setTimeout(){},showToast:m=>notices.push(m),_liveCapStopQA(){},_liveCapStartQA(){qa++;},_camZoomBind:()=>()=>{}};
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
const zoomCode = source.slice(source.indexOf('function _camZoomBind('), source.indexOf('function _liveCapLayout('));
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
  assert.match(node('liveCapQAText').textContent,/Keep all four edges/);assert.equal(node('liveCapFrame').style.borderColor,'rgba(255,255,255,.7)');
  c._liveCapRenderQA({icon:'?',text:'Cannot assess focus'});assert.equal(node('liveCapQAText').textContent,'Cannot assess focus');
  c._liveCapRenderQA(null);assert.equal(node('liveCapQAPill').style.color,'#fff');});
// Guide detector and ordered advice, with no provider calls or charges.
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const guide = require(referencedHashedAssets().find(a => a.base === 'photo-guide').path);
function pixels({box=null,background=180,edge=25,texture=false}={}) {
 const w=200,h=270,p=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
  let v=background+(texture?8*Math.sin(x/5)*Math.cos(y/11):0);
  if(box && x>=box[0] && x<box[2] && y>=box[1] && y<box[3])
   v=x<box[0]+5||x>=box[2]-5||y<box[1]+5||y>=box[3]-5?edge:100+50*Math.sin(x/8)*Math.cos(y/9);
  const i=(y*w+x)*4;p[i]=p[i+1]=p[i+2]=v;p[i+3]=255;
 }return p;
}
await test(async()=>{assert.equal(guide.outline(pixels(),200,270),null);assert.equal(guide.outline(pixels({texture:true}),200,270),null);});
await test(async()=>{for(const config of [{box:[40,45,160,213]},{box:[40,45,160,213],background:20,edge:210}]) {
 const b=guide.outline(pixels(config),200,270);assert.ok(b);assert.ok(Math.abs(b.x-.2)<.03);assert.ok(Math.abs(b.w-.6)<.03);
}});
await test(async()=>{assert.equal(guide.outline(pixels({box:[0,45,120,213]}),200,270),null);assert.equal(guide.outline(pixels({box:[40,70,160,170]}),200,270),null);});
const g={x:.1,y:.05,w:.8,h:.9},blur={id:'soft',text:'soft'};
await test(async()=>{assert.equal(guide.advice(null,g,blur,'face').id,'frame');assert.equal(guide.advice(null,g,blur,'edge').id,'edge');});
await test(async()=>{assert.equal(guide.advice({x:.3,y:.3,w:.2,h:.3},g,blur,'face').id,'small');
 assert.equal(guide.advice({x:.01,y:.05,w:.85,h:.9},g,blur,'face').id,'fit');
 assert.equal(guide.advice({x:.15,y:.1,w:.7,h:.8},g,blur,'face').id,'soft');
 assert.equal(guide.advice({x:.15,y:.1,w:.7,h:.8},g,null,'face').kind,'neutral');});
await test(async()=>{let s=guide.stable(null,{id:'soft'});assert.equal(s.show,false);s=guide.stable(s,{id:'soft'});assert.equal(s.show,false);
 s=guide.stable(s,{id:'soft'});assert.equal(s.show,true);s=guide.stable(s,{id:'frame'});assert.equal(s.show,false);});
// Real layout helper: banner/footer stay outside the guide at portrait,
// compact and landscape sizes, including longer instructions.
await test(async()=>{for(const [w,h,bannerBottom,footerTop] of [[390,740,132,578],[320,568,146,390],[844,390,115,235]]) {
 const rects={liveCapOverlay:{top:0,bottom:h,width:w,height:h},liveCapHeader:{bottom:55},liveCapGuidance:{bottom:bannerBottom},liveCapControls:{top:footerTop}};
 const nodes={};for(const id of ['liveCapOverlay','liveCapFrameArea','liveCapFrame','liveCapHeader','liveCapGuidance','liveCapControls'])nodes[id]={style:{},getBoundingClientRect:()=>rects[id]};
 const c={document:{getElementById:id=>nodes[id]}};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function _liveCapLayout('),source.indexOf('async function openLiveCameraCapture(')),c);c._liveCapLayout();
 const top=parseFloat(nodes.liveCapFrameArea.style.top),bottom=h-parseFloat(nodes.liveCapFrameArea.style.bottom),fw=parseFloat(nodes.liveCapFrame.style.width);
 assert.ok(top>bannerBottom);assert.ok(bottom<footerTop);assert.ok(fw*3.5/2.5<=bottom-top+.01);
}});
// The actual QA loop must not compute card sharpness without an outline;
// framing has priority even when a quality check would warn about blur.
await test(async()=>{
 const rect={left:0,top:0,width:200,height:270},fr={left:20,top:13.5,width:160,height:243};
 let calls=0,rendered=null,box=null,frames=0,reflection=false;
 const nodes={liveCapVideo:{videoWidth:200,videoHeight:270,getBoundingClientRect:()=>rect},liveCapOverlay:{style:{display:'flex'}},
  liveCapFrameArea:{getBoundingClientRect:()=>rect},liveCapFrame:{getBoundingClientRect:()=>fr}};
 const window={_liveCapState:{role:'face'},_liveCapQACand:null,_liveCapQAStreak:0,_liveCapQAState:null,
  _liveCapQACanvas:{getContext:()=>({drawImage(){},getImageData:()=>({data:pixels()})})},
  CardResellPhotoGuide:{...guide,outline:()=>box,reflection:()=>reflection}};
 const c={window,document:{getElementById:id=>nodes[id]},_LIVECAP_SOFT_THRESHOLD:14,
  _liveCapCardSharpness(){calls++;return 1;},_liveCapRenderQA(h){rendered=h;},_liveCapLayout(){},_liveCapStopQA(){}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function _liveCapQATick('),source.indexOf('function _liveCapRenderQA(')),c);
 for(let i=0;i<3;i++)c._liveCapQATick();assert.equal(calls,0);assert.equal(rendered.id,'frame');
 box={x:.3,y:.3,w:.2,h:.3};for(let i=0;i<3;i++)c._liveCapQATick();assert.equal(rendered.id,'small');
 box={x:.15,y:.1,w:.7,h:.8};for(let i=0;i<3;i++)c._liveCapQATick();assert.equal(rendered.id,'soft');
 box=null;for(let i=0;i<3;i++)c._liveCapQATick();assert.equal(rendered.id,'frame');assert.equal(window._liveCapLastSharpness,null);
 reflection=true;for(let i=0;i<3;i++)c._liveCapQATick();assert.equal(rendered.id,'reflection');assert.equal(window._liveCapLastSharpness,null);
 window._liveCapState.role='edge';calls=0;for(let i=0;i<3;i++)c._liveCapQATick();assert.equal(calls,0);assert.equal(rendered.id,'edge');
});
// Small localized reflections must not be diluted by the whole image or
// suppressed by missing outlines. Uniform white stock / colored art are not
// sufficient evidence. These cases intentionally do not imply calibration.
function glarePixels({background=100,patch=null}={}) {
 const w=160,h=224,p=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
  const color=patch && x>=65 && x<80 && y>=45 && y<60?patch:[background,background,background];
  const i=(y*w+x)*4;p.set([...color,255],i);
 }return p;
}
await test(async()=>{assert.equal(guide.reflection(glarePixels({patch:[255,249,200]}),160,224),true);
 assert.equal(guide.reflection(glarePixels({background:245}),160,224),false);
 assert.equal(guide.reflection(glarePixels({background:235,patch:[255,255,255]}),160,224),false);
 for(const patch of [[255,50,0],[0,255,30],[0,40,255]])assert.equal(guide.reflection(glarePixels({patch}),160,224),false);
 assert.equal(guide.reflection(new Uint8Array(4),160,224),false);
});
await test(async()=>{assert.equal(guide.advice(null,g,guide.reflectionHint(),'face').id,'reflection');
 assert.equal(guide.advice({x:.3,y:.3,w:.2,h:.3},g,guide.reflectionHint(),'face').id,'reflection');
 assert.equal(guide.advice(null,g,guide.reflectionHint(),'edge').id,'edge');
});
console.log(`Photo capture lifecycle: ${cases} passed, 0 failed -- SUITE COMPLETE, exit=0`);
