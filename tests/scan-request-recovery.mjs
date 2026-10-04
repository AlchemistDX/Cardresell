import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
const source = readFileSync('js/scan-request.js', 'utf8');
const records = new Map(); let requests = [], status = 200, offline = false;
const make = (uid='owner-a', storage=true) => {
 const user={uid,getIdToken:async()=> 'synthetic-token'};
 const sandbox={ window:{_fbAuth:{currentUser:user}}, crypto:webcrypto, TextEncoder,
  sessionStorage:{getItem:k=>records.get(k)??null,setItem:(k,v)=>{if(!storage)throw Error();records.set(k,v);}},
  fetch:async(url,options)=>{requests.push(JSON.parse(options.body));if(offline)throw Error('offline');return {status,ok:status<400};}};
 vm.runInNewContext(source,sandbox);return sandbox.window;
};
const req=(w,body={imageBase64:'synthetic-front',mode:'identify'})=>w.cardResellScanRequest('/api/scan',{method:'POST',headers:{},body:JSON.stringify(body)});
let w=make();await Promise.all([req(w),req(w)]);
assert.equal(requests[0].operation_id,requests[1].operation_id);assert.match(requests[0].operation_id,/^[a-f0-9]{64}$/);
const first=requests[0].operation_id;
offline=true;await assert.rejects(()=>req(w),/Connection interrupted/);offline=false;
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
console.log('PASS scan recovery: concurrent/reloaded retries, pending/network failures, account isolation, storage failure and all shipped callers');
