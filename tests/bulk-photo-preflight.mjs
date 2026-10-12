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
// Included monthly/welcome credits are spendable too. The local precheck must
// match the Settings total while leaving the server in charge of actual debits.
const balanceNames=new Set(['bulkRapidDone','processBulkUploadFiles','startBulkQueue']);
const ui=readFileSync(referencedHashedAssets().find(a=>a.base==='ui').path,'utf8');
const balanceCode=parse(ui,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&balanceNames.has(n.id.name)).map(n=>ui.slice(n.start,n.end)).join('\n');
const elements=new Map();let attempted=0,stop=false;
const balanceWindow={_bulkQueue:[],_bulkRapidState:{active:true,capturing:false},_idScanCredits:0,_freeIdLeft:15};
const b={window:balanceWindow,console,URL:{createObjectURL:()=> 'blob:test'},
 document:{getElementById:id=>{if(id==='bulkAddAnotherBtn')return null;if(!elements.has(id))elements.set(id,{style:{},insertAdjacentHTML(){},querySelector(){return null}});return elements.get(id)}},
 _partitionScanFiles:files=>({okFiles:files,rejected:[]}),_bulkNewScanUid:()=> 'test-id',
 _bulkShowSection(){},showToast(){},_bulkClearDupBanner(){},_bulkUpdatePackTracker(){},_bulkUpdateRow(){},_bulkFinishQueue(){},
 _bulkScanOne:async()=>{attempted++;if(stop)return 'STOP';balanceWindow._freeIdLeft--;return {success:false,error:'synthetic result'}}};
vm.createContext(b);vm.runInContext(balanceCode,b);
for(const [paid,included,total] of [[0,15,15],[3,4,7],[2,0,2],[0,0,0]]){
 balanceWindow._idScanCredits=paid;balanceWindow._freeIdLeft=included;
 b.processBulkUploadFiles({files:[file],value:'test'});
 check(elements.get('bulkCreditConfirmCredit').textContent===`Uses 1 credit · You have ${total} available`,'upload quote includes all spendable ID credits');
 b.bulkRapidDone();
 check(elements.get('bulkCreditConfirmCredit').textContent===`Uses 1 credit · You have ${total} available`,'rapid quote includes all spendable ID credits');
}
await b.startBulkQueue();check(attempted===0,'zero total credits cannot start the queue');
balanceWindow._freeIdLeft=15;await b.startBulkQueue();
check(attempted===1,'included-only balance can start the queue');
check(elements.get('bulkProgressCredits').textContent==='14 credits remaining','progress includes the remaining included balance');
stop=true;await b.startBulkQueue();check(attempted===2&&balanceWindow._bulkResults.length===0,'server STOP remains authoritative with a positive local balance');
console.log(`Bulk photo preflight: ${checks} checks passed; no provider calls. -- SUITE COMPLETE, exit=0`);
