import {harness} from './_assert.mjs';
const t = harness('scan-request-recovery');
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
const source = readFileSync('js/scan-request.js', 'utf8');
const records = new Map(); let requests = [], status = 200, offline = false, refreshes = 0, flaky = 0;
const make = (uid='owner-a', storage=true) => {
 const user={uid,getIdToken:async()=> 'synthetic-token'};
 const sandbox={ window:{_fbAuth:{currentUser:user},loadSettingsScanCredits:async()=>{refreshes++;}}, crypto:webcrypto, TextEncoder, Response, AbortController,
  setTimeout:(f,ms)=>setTimeout(f,ms>=45000?100:0),clearTimeout,setInterval,clearInterval,
  sessionStorage:{getItem:k=>records.get(k)??null,setItem:(k,v)=>{if(!storage)throw Error();records.set(k,v);},removeItem:k=>records.delete(k)},
  fetch:async(url,options)=>{requests.push(JSON.parse(options.body));if(offline)throw Error('offline');if(flaky>0){flaky--;throw Error('Load failed');}return Response.json({success:true},{status});}};
 vm.runInNewContext(source,sandbox);return sandbox.window;
};
const req=(w,body={imageBase64:'synthetic-front',mode:'identify'})=>w.cardResellScanRequest('/api/scan',{method:'POST',headers:{},body:JSON.stringify(body)});
let w=make();await Promise.all([req(w),req(w)]);
assert.equal(requests[0].operation_id,requests[1].operation_id);assert.match(requests[0].operation_id,/^[a-f0-9]{64}$/);
const first=requests[0].operation_id;
offline=true;await assert.rejects(()=>req(w),/Connection interrupted/);offline=false;
// A stale keep-alive connection fails once: one automatic retry, SAME operation id.
{const n=requests.length;flaky=1;const r=await req(w);assert.equal(r.status,200);assert.equal(requests.length,n+2);assert.equal(requests.at(-1).operation_id,requests.at(-2).operation_id);assert.equal(requests.at(-1).operation_id,first);}
// Two failures in a row: exactly one retry, then the recoverable message.
{const n=requests.length;offline=true;await assert.rejects(()=>req(w),/Connection interrupted/);assert.equal(requests.length,n+2);offline=false;}
w=make();await req(w);assert.equal(requests.at(-1).operation_id,first);
await req(w,{mode:'identify',imageBase64:'synthetic-front'});assert.equal(requests.at(-1).operation_id,first);
status=202;await assert.rejects(()=>req(w),/still processing/);assert.equal(requests.at(-1).operation_id,first);status=200;
await req(w,{mode:'grade',imageBase64:'synthetic-front',backBase64:'synthetic-back'});assert.notEqual(requests.at(-1).operation_id,first);
await req(make('owner-b'));assert.notEqual(requests.at(-1).operation_id,first);
const before=requests.length;await assert.rejects(()=>req(make('storage-failure',false)),/site storage/);assert.equal(requests.length,before);
const switched=make('switch');switched._fbAuth.currentUser.getIdToken=async()=>{switched._fbAuth.currentUser={uid:'different'};return 'synthetic';};
await assert.rejects(()=>req(switched),/Account changed/);assert.equal(requests.length,before);
assert.ok([...records.entries()].every(([k,v])=>!k.includes('synthetic-front')&&!v.includes('synthetic-token')));
const html=readFileSync('index.html','utf8');
const core=html.match(/\/js\/core\.[a-f0-9]{8}\.js/)[0],ui=html.match(/\/js\/ui\.[a-f0-9]{8}\.js/)[0];
assert.ok(html.indexOf('/js/scan-request.')<html.indexOf(core));
for(const path of [core,ui]){const s=readFileSync('.'+path,'utf8');assert.ok(!s.includes("fetch('/api/scan',"));assert.ok(s.includes("window.cardResellScanRequest('/api/scan',"));}
const refreshed=refreshes;await req(make('refresh-check'));assert.equal(refreshes,refreshed+1);
status=202;await assert.rejects(()=>req(make('pending-check')),/still processing/);assert.equal(refreshes,refreshed+1);status=200;
const refreshFails=make('refresh-fails');refreshFails.loadSettingsScanCredits=()=>{throw Error('offline');};assert.equal((await req(refreshFails)).status,200);
console.log('PASS scan recovery: concurrent/reloaded retries, pending/network failures, account isolation, storage failure and all shipped callers');

t.check('existing idempotency, billing refresh and account isolation assertions',true);

// Exercise the real transport with held auth/network/body promises. The outer
// timeout belongs to the test: returning a response before its body is readable
// is not a successful scan, and leaving a pending promise is a failed check.
const delay = ms => new Promise(r=>setTimeout(r,ms));
const settle = p => Promise.race([p.then(value=>({value}),error=>({error})),delay(160).then(()=>({hung:true}))]);
function transport() {
 const state={calls:[],refreshes:0,stored:new Map(),timers:new Set(),intervals:new Set(),deadlines:[]};
 state.user={uid:'transport-owner',getIdToken:async()=> 'transport-token'};
 state.fetch=async()=>Response.json({success:true,card_name:'Fixture Wizard'},{headers:{'x-fixture':'preserved'}});
 const scope={window:{_fbAuth:{currentUser:state.user},loadSettingsScanCredits:()=>{state.refreshes++;}},
  crypto:webcrypto,TextEncoder,Response,AbortController,
  sessionStorage:{getItem:k=>state.stored.get(k)??null,setItem:(k,v)=>state.stored.set(k,v),removeItem:k=>state.stored.delete(k)},
  setTimeout:(fn,ms)=>{if(ms>=45000)state.deadlines.push(ms);const id=setTimeout(()=>{state.timers.delete(id);fn()},ms>=45000?45:1);state.timers.add(id);return id},
  clearTimeout:id=>{clearTimeout(id);state.timers.delete(id)},
  setInterval:fn=>{const id=setInterval(fn,2);state.intervals.add(id);return id},
  clearInterval:id=>{clearInterval(id);state.intervals.delete(id)},
  fetch:async(u,o)=>{state.calls.push(o);return state.fetch(u,o)}};
 vm.runInNewContext(source,scope);state.window=scope.window;
 state.request=(options={})=>scope.window.cardResellScanRequest('/api/scan',{method:'POST',body:JSON.stringify({mode:'identify',imageBase64:'same-photo'}),...options});
 state.clean=()=>{for(const id of state.timers)clearTimeout(id);for(const id of state.intervals)clearInterval(id)};
 return state;
}
for(const boundary of ['token','headers','body'])await t.section('stalled '+boundary,async()=>{
 const s=transport();let release;
 try {
  if(boundary==='token')s.user.getIdToken=()=>new Promise(r=>{release=r});
  if(boundary==='headers')s.fetch=()=>new Promise(r=>{release=r});
  if(boundary==='body')s.fetch=async()=>new Response(new ReadableStream({start(c){release=()=>{c.enqueue(new TextEncoder().encode('{"success":true}'));c.close()}}}));
  const result=await settle(s.request());
  t.check(boundary+': deadline returns a recoverable error',!!result.error&&/same photo|same request/i.test(result.error.message));
  t.check(boundary+': no premature credit refresh',s.refreshes===0);
  t.check(boundary+': transport does not automatically repeat uncertain work',s.calls.length===(boundary==='token'?0:1));
  if(s.calls[0])t.check(boundary+': timed-out request is aborted',s.calls[0].signal?.aborted===true);
  release?.(boundary==='token'?'late-token':Response.json({success:true}));await delay(8);
  t.check(boundary+': late continuation cannot send or complete a scan',s.refreshes===0&&s.calls.length===(boundary==='token'?0:1));
  s.user.getIdToken=async()=> 'transport-token';s.fetch=async()=>Response.json({success:true});
  const retry=await settle(s.request());
  t.check(boundary+': retry completes',retry.value?.status===200);
  if(boundary!=='token')t.check(boundary+': retry keeps original operation ID',JSON.parse(s.calls[0].body).operation_id===JSON.parse(s.calls.at(-1).body).operation_id);
  t.check(boundary+': timers and account watchers are released',s.timers.size===0&&s.intervals.size===0);
 }finally{s.clean()}
});
for(const boundary of ['before','token','body','retry'])await t.section('cancel '+boundary,async()=>{
 const s=transport(),controller=new AbortController();let release;
 try {
  if(boundary==='before')controller.abort();
  if(boundary==='token')s.user.getIdToken=()=>new Promise(r=>{release=r});
  if(boundary==='body')s.fetch=async()=>new Response(new ReadableStream({start(c){release=()=>{c.enqueue(new TextEncoder().encode('{}'));c.close()}}}));
  if(boundary==='retry')s.fetch=async()=>{controller.abort();throw Error('network interrupted')};
  const request=s.request({signal:controller.signal});
  if(boundary==='token'||boundary==='body'){await delay(8);controller.abort()}
  const result=await settle(request);
  t.check(boundary+': cancellation settles without a scan result',!!result.error&&!result.hung);
  release?.('late-token');await delay(8);
  t.check(boundary+': cancel never retries or sends a late request',s.calls.length===(['before','token'].includes(boundary)?0:1));
  t.check(boundary+': no success balance refresh',s.refreshes===0);
  t.check(boundary+': cancellation cleans timers',s.timers.size===0&&s.intervals.size===0);
 }finally{s.clean()}
});
await t.section('account changes while response body stalls',async()=>{
 const s=transport();let release;
 try {
  s.fetch=async()=>new Response(new ReadableStream({start(c){release=()=>{c.enqueue(new TextEncoder().encode('{"card_name":"Private result"}'));c.close()}}}));
  const request=s.request();await delay(8);s.window._fbAuth.currentUser={uid:'next-owner'};
  const result=await settle(request);
  t.check('account change rejects the previous seller response',/Account changed/.test(result.error?.message||''));
  release?.();await delay(8);
  t.check('late previous-owner response has no success side effects',s.calls.length===1&&s.refreshes===0);
  t.check('account change releases timers and watchers',s.timers.size===0&&s.intervals.size===0);
 }finally{s.clean()}
});
await t.section('complete responses and grade allowance',async()=>{
 const s=transport();try {
  const result=await s.request({body:JSON.stringify({mode:'grade',imageBase64:'front',backBase64:'back'})});
  t.check('complete response keeps status, headers and JSON',result.status===200&&result.headers.get('x-fixture')==='preserved'&&(await result.json()).card_name==='Fixture Wizard');
  t.check('grading receives a bounded longer deadline',s.deadlines[0]>45000&&s.deadlines[0]<=120000);
  t.check('one success refresh and no surviving timers',s.refreshes===1&&s.timers.size===0&&s.intervals.size===0);
 }finally{s.clean()}
});
for (const [label,status,payload] of [
 ['legacy provider failure',503,{code:'IDENTIFY_PROVIDER_UNAVAILABLE',provider_reason:'invalid_response'}],
 ['confirmed refunded miss',200,{success:true,mode:'identify',identified:false,card_name:'',retry_allowed:true,credits_charged:0}],
]) await t.section(label+' permits a fresh user attempt',async()=>{
 const s=transport();try {
  s.fetch=async()=>Response.json(payload,{status});
  await s.request();const first=JSON.parse(s.calls[0].body).operation_id;
  t.check('only one provider request per user attempt',s.calls.length===1);
  t.check('finished failure releases its recovery key',s.stored.size===0);
  s.fetch=async()=>Response.json({success:true,card_name:'Now identified'});
  await s.request();const second=JSON.parse(s.calls[1].body).operation_id;
  t.check('next explicit attempt gets a new operation',second!==first);
  await s.request();t.check('successful retry remains protected from another charge',JSON.parse(s.calls[2].body).operation_id===second);
 }finally{s.clean()}
});
for (const [label,status,payload] of [
 ['unexplained server error',503,{error:'try again'}],
 ['billing reconciliation',503,{code:'IDENTIFY_PROVIDER_UNAVAILABLE',billing_reference:'pending-receipt',retry_allowed:true,credits_charged:0,identified:false}],
 ['pending completion',503,{code:'scan_intent_pending',retry_allowed:true,credits_charged:0,identified:false}],
 ['charged result',200,{success:true,card_name:'Accepted',retry_allowed:true,credits_charged:1}],
 ['candidate review',200,{identified:false,needsPicker:true,retry_allowed:true,credits_charged:0}],
 ['printing review',200,{identified:false,identity_review:{kind:'slab'},retry_allowed:true,credits_charged:0}],
]) await t.section(label+' retains operation',async()=>{
 const s=transport();try {
  s.fetch=async()=>Response.json(payload,{status});await s.request();await s.request();
  t.check('same operation is retained',JSON.parse(s.calls[0].body).operation_id===JSON.parse(s.calls[1].body).operation_id);
 }finally{s.clean()}
});
await t.section('grading does not inherit identify retry permission',async()=>{
 const s=transport();try {
  s.fetch=async()=>Response.json({code:'IDENTIFY_PROVIDER_UNAVAILABLE'},{status:503});
  const opts={body:JSON.stringify({mode:'grade',imageBase64:'front',backBase64:'back'})};
  await s.request(opts);await s.request(opts);
  t.check('grade operation remains stable',JSON.parse(s.calls[0].body).operation_id===JSON.parse(s.calls[1].body).operation_id);
 }finally{s.clean()}
});
await t.section('late duplicate failure cannot erase a newer operation',async()=>{
 const s=transport();let release,releaseFirst,ready;try {
  const bothSent=new Promise(r=>{ready=r});
  let n=0;s.fetch=async()=>new Promise(r=>{if(++n===1)releaseFirst=r;else{release=r;ready()}});
  const a=s.request(),b=s.request();await bothSent;
  releaseFirst(Response.json({code:'IDENTIFY_PROVIDER_UNAVAILABLE'},{status:503}));await a;
  s.fetch=async()=>Response.json({success:true,card_name:'Accepted retry'});await s.request();
  const fresh=JSON.parse(s.calls.at(-1).body).operation_id;
  release(Response.json({code:'IDENTIFY_PROVIDER_UNAVAILABLE'},{status:503}));await b;
  await s.request();
  t.check('old completion leaves newer recovery intact',JSON.parse(s.calls.at(-1).body).operation_id===fresh);
 }finally{s.clean()}
});
for (const [status,text] of [[500,'FUNCTION_INVOCATION_FAILED'],[502,'<html>Bad gateway</html>'],[503,'unavailable'],[504,'timeout'],[429,'slow down'],[200,'<html>wrong route</html>'],[200,'null']]) await t.section('unreadable response '+status+' '+text,async()=>{
 const s=transport();try {
  s.fetch=async()=>new Response(text,{status});
  const r=await settle(s.request());
  t.check('service problem is recoverable, never blamed on photo',r.error?.code==='SCAN_RECOVERABLE' && !/clearer|retake|refund/i.test(r.error.message));
  t.check('no automatic resend or success refresh',s.calls.length===1 && s.refreshes===0);
  const first=JSON.parse(s.calls[0].body).operation_id;
  s.fetch=async()=>Response.json({success:true,card_name:'Recovered'});await s.request();
  t.check('explicit retry checks the existing operation',JSON.parse(s.calls[1].body).operation_id===first);
  t.check('timers released',s.timers.size===0 && s.intervals.size===0);
 }finally{s.clean()}
});
for(const status of [401,402]) await t.section('plain auth/credit '+status,async()=>{
 const s=transport();try {s.fetch=async()=>new Response('Unavailable',{status});t.check('caller retains sign-in or credit handling',(await s.request()).status===status);}finally{s.clean()}
});
t.done();
