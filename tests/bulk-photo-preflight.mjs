import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parse} from 'acorn';
import {readFileSync} from 'node:fs';
import {referencedHashedAssets} from './_assetRefs.mjs';
const names=new Set(['_bulkCheckPhoto','_bulkScanOne','_validateScanFile']);
const code=['core','ui'].map(base=>{const s=readFileSync(referencedHashedAssets().find(a=>a.base===base).path,'utf8');return parse(s,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&names.has(n.id.name)).map(n=>s.slice(n.start,n.end)).join('\n')}).join('\n');
let calls=0,compressed=0,checks=0,qcCalls=[];
let qcResult={ok:true},qcFailure=false,deferred=null;
const owner={uid:'owner'};
const window={_bulkQueue:[],_fbAuth:{currentUser:owner},googleUser:{sub:'owner'},
 CardResellPhotoQC:{check:async(file,options)=>{qcCalls.push(options);if(qcFailure)throw Error('decode');return deferred?deferred:qcResult}},
 cardResellScanRequest:async(url,options)=>{calls++;return {ok:true,status:200,json:async()=>({scan_id:'fixture-scan'})}}};
const c={window,document:{getElementById:()=>null},console,
 compressImage:async()=>{compressed++;return 'fixture-image'},_bulkNewScanUid:()=> 'new-id'};
vm.createContext(c);vm.runInContext("const SCAN_MAX_BYTES=15*1024*1024,SCAN_MIME_TYPES=new Set(['image/jpeg','image/png','image/webp']);"+code,c);
const file={name:'card.jpg',type:'image/jpeg',size:2048};
const run=(f=file)=>c._bulkScanOne({file:f,objectUrl:'blob:fixture',scanUid:'stable'},'row',false);
const check=(v,label)=>{assert.ok(v,label);checks++};
for(const reason of ['low_resolution','blurry','unreadable']){
 qcResult={ok:false,reasons:[reason]};const r=await run();
 check(r.photoRejected&&!r.success,reason+' rejected');check(calls===0&&compressed===0,'no provider or compression for rejected photo');
}
qcResult={ok:true};const invalid=await run({...file,type:'application/pdf',name:'bad.pdf'});
check(invalid.photoRejected&&calls===0,'unsupported file never reaches provider');
qcFailure=true;check((await run()).photoRejected&&calls===0,'QC exception fails closed');qcFailure=false;
const save=window.CardResellPhotoQC;delete window.CardResellPhotoQC;
check((await run()).photoRejected&&calls===0,'missing QC cannot spend');window.CardResellPhotoQC=save;
await run();await run();
check(calls===2,'separate copies can both reach identification');
check(qcCalls.every(o=>o.skipDupe===true),'duplicate heuristic skipped for physical copies');
let resolve;deferred=new Promise(r=>resolve=r);const pending=run();window._bulkQueue=[];resolve({ok:true});
check(await pending==='STOP'&&calls===2,'closing or replacing queue during QC prevents paid submission');deferred=null;
deferred=new Promise(r=>resolve=r);const switched=run();window._fbAuth.currentUser={uid:'other'};resolve({ok:true});
check(await switched==='STOP'&&calls===2,'account switch during QC prevents submission');deferred=null;
window._fbAuth.currentUser=owner;
let resume;c.compressImage=()=>new Promise(r=>{resume=r});const preparing=run();
await new Promise(r=>setImmediate(r));window._bulkQueue=[];c.compressImage=async()=> 'fixture';resume('fixture');
check(await preparing==='STOP'&&calls===2,'cancel during compression cannot start provider request');
console.log(`Bulk photo preflight: ${checks} checks passed; no provider calls.`);
