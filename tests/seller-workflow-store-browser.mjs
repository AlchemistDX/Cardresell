// Actual Chromium IndexedDB, two pages, and a persisted browser profile.
// Scan helpers are extracted from the shipped assets, not reimplemented here.
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {parse} from 'acorn';
import {referencedHashedAssets, ROOT} from './_assetRefs.mjs';
const helpers=[];
for(const [base,names] of [['ui',['_bulkNewScanUid','_bulkCopyUids','_bulkDraftUnits','_catalogueArtworkUrl','_bulkScanRowToCard']],['core',['_crNewEntryId']]]){
  const source=readFileSync(referencedHashedAssets().find(a=>a.base===base).path,'utf8');
  const nodes=parse(source,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&names.includes(n.id.name));
  assert.equal(nodes.length,names.length);helpers.push(...nodes.map(n=>source.slice(n.start,n.end)));
}
const fixture=`<!doctype html><title>Isolated workflow storage acceptance</title><script>${helpers.join('\n')}</script>
<script type="module">
import * as W from '/shared/seller-workflow.mjs';
import * as D from '/shared/seller-workflow-store.mjs';
import * as S from '/shared/seller-workflow-scan.mjs';
Object.assign(window,{W,D,S,owner:'owner',minted:0});
window.openStore=(name='acceptance')=>D.openWorkflowStore({ownerId:owner,getOwnerId:()=>owner,databaseName:name});
window.rows=()=>[{success:true,qty:2,scanUid:'scan_a',copyUids:['scan_a','scan_b','parked'],cardName:'Pikachu',cardType:'pokemon',setName:'Base Set',cardNumber:'58',condition:'NM',conditionChosen:false,imageDataUrl:'data:image/secret',catalogImageUrl:'https://example.invalid/art.jpg'},
{success:true,qty:1,scanUid:'scan_c',copyUids:['scan_c'],cardName:'Pikachu',cardType:'pokemon',setName:'Base Set',cardNumber:'58',condition:'LP',conditionChosen:true}];
window.selection=()=>S.captureScanSelection({rows:rows(),copyUids:_bulkCopyUids,rowToCard:_bulkScanRowToCard});
window.prepare=(store,id='batch')=>S.prepareScanSession({store,sessionId:id,selection:selection(),now:100,newCollectionId:()=>{minted++;return _crNewEntryId()}});
window.raw=async(name,method,id,value)=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction('sessions',method==='get'?'readonly':'readwrite');const s=tx.objectStore('sessions');let result;const r=method==='get'?s.get(W.sessionStorageKey(owner,id)):s.put(value,W.sessionStorageKey(owner,id));r.onsuccess=()=>result=r.result;tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error)})}finally{db.close()}
};
window.ready=true;
</script>`;
const files=new Map(['seller-workflow','seller-workflow-store','seller-workflow-scan'].map(n=>['/shared/'+n+'.mjs',readFileSync(join(ROOT,'shared',n+'.mjs'))]));
let outbound=0;
const server=createServer((req,res)=>{const file=files.get(req.url);res.setHeader('Content-Type',file?'text/javascript':'text/html');res.end(file||fixture)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const profile=mkdtempSync(join(tmpdir(),'cr-workflow-browser-'));
const options={executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox'],viewport:{width:390,height:844}};
let context,passed=0;
const errors=[];
const launch=async()=>{
  context=await chromium.launchPersistentContext(profile,options);
  await context.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();outbound++;return route.abort()});
};
const page=async()=>{const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(origin);await p.waitForFunction(()=>window.ready);return p};
const test=async(name,run)=>{await run();passed++;console.log('PASS '+name)};
try{
 await launch();let a=await page(),b=await page();
 await test('real mapper preserves condition choice, photos stay outside journal',async()=>{
  const s=await a.evaluate(()=>selection());assert.equal(s.length,3);assert.equal(s[0].card.condition,'');assert.equal(s[2].card.condition,'LP');assert.equal(s[0].instanceId,'inst_scan_scan_a');assert.ok(!JSON.stringify(s).includes('secret'));assert.ok(!JSON.stringify(s).includes('art.jpg'));
 });
 await test('two tabs initialize one batch with one set of secure Collection IDs',async()=>{
  const values=await Promise.all([a,b].map(p=>p.evaluate(async()=>{window.store=await openStore();return prepare(store)})));
  assert.deepEqual(values[0],values[1]);assert.equal((await a.evaluate(()=>minted))+(await b.evaluate(()=>minted)),3);assert.equal(new Set(values[0].units.map(u=>u.collectionId)).size,3);
 });
 await test('same revision across two tabs permits only one transition',async()=>{
  const results=await Promise.all([a,b].map(p=>p.evaluate(async()=>{try{return await store.transition('batch',{action:'review',revision:0,now:101,copyId:'scan_a',confirmed:true})}catch(e){return e.message}})));
  assert.equal(results.filter(v=>v==='WORKFLOW_REVISION_CONFLICT').length,1);assert.equal(results.filter(v=>v.revision===1).length,1);
 });
 await test('pending operation is visible to another connection before any dispatch',async()=>{
  const s=await a.evaluate(()=>store.transition('batch',{action:'begin',revision:1,now:102,copyId:'scan_a',kind:'save',operationId:'save_a'}));
  const peer=await b.evaluate(()=>store.read('batch'));assert.deepEqual(s,peer);assert.equal(peer.units[0].operations.save.state,'pending');
 });
 await test('journal and original operation survive a full browser restart',async()=>{
  const before=await a.evaluate(()=>store.read('batch'));await context.close();await launch();a=await page();b=await page();
  const after=await a.evaluate(async()=>{window.store=await openStore();return store.read('batch')});await b.evaluate(async()=>{window.store=await openStore()});assert.deepEqual(after,before);
 });
 await test('uncertain response can resume with the original ID and immutable payload',async()=>{
  const result=await a.evaluate(async()=>{const initial=await store.read('batch');await store.transition('batch',{action:'settle',revision:2,now:103,copyId:'scan_a',kind:'save',operationId:'save_a',outcome:'uncertain'});const resumed=await store.transition('batch',{action:'resume',revision:3,now:104,copyId:'scan_a',kind:'save',operationId:'save_a'});return [initial.units[0].operations.save,resumed.units[0].operations.save]});assert.deepEqual(...result);
 });
 await test('stale revision cannot overwrite a recovered operation',async()=>{
  assert.equal(await b.evaluate(async()=>{try{await store.transition('batch',{action:'review',revision:1,now:105,copyId:'scan_b',confirmed:true})}catch(e){return e.message}}),'WORKFLOW_REVISION_CONFLICT');
 });
 await test('account switching rejects pending reads and blocks new writes',async()=>{
  const result=await a.evaluate(async()=>{const pending=store.read('batch');owner='other';let read;try{await pending}catch(e){read=e.message}let write;try{await prepare(store,'forbidden')}catch(e){write=e.message}owner='owner';return [read,write,await store.read('forbidden')]});assert.deepEqual(result,['WORKFLOW_ACCOUNT_CHANGED','WORKFLOW_ACCOUNT_CHANGED',null]);
 });
 await test('same session ID is isolated by verified owner',async()=>{
  const result=await b.evaluate(async()=>{owner='other';const other=await openStore();const missing=await other.read('batch');const newSession=await prepare(other);const list=await other.list();other.close();owner='owner';return {missing,newSession,list}});assert.equal(result.missing,null);assert.equal(result.newSession.ownerId,'other');assert.equal(result.list.sessions.length,1);
 });
 await test('corrupt records remain intact and list reports damage without hiding good work',async()=>{
  const result=await a.evaluate(async()=>{await raw('acceptance','put','broken','{');let code;try{await prepare(store,'broken')}catch(e){code=e.message}return {code,raw:await raw('acceptance','get','broken'),list:await store.list()}});assert.equal(result.code,'WORKFLOW_CORRUPT_RECORD');assert.equal(result.raw,'{');assert.equal(result.list.sessions.length,1);assert.deepEqual(result.list.damaged,[{id:'broken',code:'WORKFLOW_CORRUPT_RECORD'}]);
 });
 await test('future schema and key/payload mismatch are preserved, never reset',async()=>{
  const result=await a.evaluate(async()=>{const s=await store.read('batch');const outcomes=[];for(const [id,value] of [['future',JSON.stringify({...s,id:'future',version:99})],['wrongkey',JSON.stringify(s)]]){await raw('acceptance','put',id,value);try{await store.read(id)}catch(e){outcomes.push(e.message)}if(await raw('acceptance','get',id)!==value)throw Error('overwritten')}return outcomes});assert.deepEqual(result,['WORKFLOW_UNSUPPORTED_VERSION','WORKFLOW_STORAGE_KEY_MISMATCH']);
 });
 await test('changed scan selection cannot rebind a persisted batch',async()=>{
  const result=await a.evaluate(async()=>{const units=selection();units[1].card.number='99';try{await S.prepareScanSession({store,sessionId:'batch',selection:units,newCollectionId:_crNewEntryId,now:110})}catch(e){return e.message}});assert.equal(result,'WORKFLOW_SELECTION_CHANGED');
 });
 await test('new session names cannot give existing scan copies a second inventory identity',async()=>{
  const result=await a.evaluate(async()=>{let failure;try{await prepare(store,'duplicate')}catch(e){failure={code:e.message,sessionId:e.sessionId}}return {failure,record:await store.read('duplicate')}});assert.deepEqual(result,{failure:{code:'WORKFLOW_COPY_ALREADY_ASSIGNED',sessionId:'batch'},record:null});
 });
 await test('Collection identity collisions roll back all new copy reservations',async()=>{
  const result=await a.evaluate(async()=>{const existing=await store.read('batch');const incoming=selection().slice(0,1).map(u=>({...u,copyId:'new_copy',instanceId:'inst_scan_new_copy'}));let code;try{await S.prepareScanSession({store,sessionId:'collision',selection:incoming,newCollectionId:()=>existing.units[0].collectionId,now:111})}catch(e){code=e.message}const absent=await store.read('collision');const corrected=await S.prepareScanSession({store,sessionId:'collision',selection:incoming,newCollectionId:_crNewEntryId,now:112});return [code,absent,corrected.units[0].copyId]});assert.deepEqual(result,['WORKFLOW_IDENTITY_CONFLICT',null,'new_copy']);
 });
 await test('injected quota failure aborts initialization and preserves source rows',async()=>{
  const result=await a.evaluate(async()=>{const previous=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(){throw new DOMException('injected','QuotaExceededError')};let code;try{await prepare(store,'quota')}catch(e){code=e.message}finally{IDBObjectStore.prototype.add=previous}return {code,stored:await store.read('quota'),selection:selection()}});assert.equal(result.code,'WORKFLOW_STORAGE_FULL');assert.equal(result.stored,null);assert.equal(result.selection.length,3);
 });
 await test('success of a write request followed by abort is not reported as saved',async()=>{
  const result=await a.evaluate(async()=>{const isolated=await openStore('abort-db');const previous=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(...args){const req=previous.apply(this,args);req.addEventListener('success',()=>this.transaction.abort());return req};let code;try{await prepare(isolated,'abort')}catch(e){code=e.message}finally{IDBObjectStore.prototype.add=previous}const absent=await isolated.read('abort');const retry=await prepare(isolated,'abort');isolated.close();return [code,absent,retry.units.length]});assert.deepEqual(result,['WORKFLOW_STORAGE_FAILED',null,3]);
 });
 await test('async initialization is rejected and cannot leave a partial record',async()=>{
  const result=await a.evaluate(async()=>{let code;try{await store.initialize('async',async()=>{},()=>{})}catch(e){code=e.message}return [code,await store.read('async')]});assert.deepEqual(result,['WORKFLOW_ASYNC_TRANSACTION',null]);
 });
 await test('unsupported DB versions fail closed without deleting data',async()=>{
  assert.equal(await a.evaluate(async()=>{await new Promise((resolve,reject)=>{const r=indexedDB.open('future-db',2);r.onupgradeneeded=()=>r.result.createObjectStore('sessions');r.onsuccess=()=>{r.result.close();resolve()};r.onerror=()=>reject(r.error)});try{await openStore('future-db')}catch(e){return e.message}}),'WORKFLOW_STORAGE_VERSION');
 });
 await test('closed stores do not silently reopen or write',async()=>{
  assert.equal(await b.evaluate(async()=>{store.close();try{await store.read('batch')}catch(e){return e.message}}),'WORKFLOW_STORAGE_CLOSED');
 });
 await test('bounded session capacity refuses new work while existing sessions remain recoverable',async()=>{
  const result=await a.evaluate(async()=>{const cap=await openStore('capacity');const create=i=>S.prepareScanSession({store:cap,sessionId:'batch_'+i,selection:selection().map(u=>({...u,copyId:u.copyId+'_'+i,instanceId:u.instanceId+'_'+i})),now:100,newCollectionId:_crNewEntryId});for(let i=0;i<D.MAX_STORED_SESSIONS;i++)await create(i);let code;try{await create('overflow')}catch(e){code=e.message}const replay=await create(0);const size=(await cap.list()).sessions.length;cap.close();return [code,replay.id,size]});assert.deepEqual(result,['WORKFLOW_SESSION_CAPACITY','batch_0',25]);
 });
 await test('500-copy envelope persists without treating it as a plan allowance',async()=>{
  const result=await a.evaluate(async()=>{const large=await openStore('large');const r=rows()[0];r.qty=500;r.copyUids=Array.from({length:500},(_,i)=>'large_'+i);r.scanUid=r.copyUids[0];const s=await S.prepareScanSession({store:large,sessionId:'large',selection:S.captureScanSelection({rows:[r],copyUids:_bulkCopyUids,rowToCard:_bulkScanRowToCard}),now:100,newCollectionId:_crNewEntryId});const saved=await large.read('large');large.close();return {count:saved.units.length,ids:new Set(s.units.map(u=>u.collectionId)).size}});assert.deepEqual(result,{count:500,ids:500});
 });
 await test('no browser exceptions or outbound service requests',async()=>{assert.deepEqual(errors,[]);assert.equal(outbound,0)});
 console.log(`seller-workflow-store-browser: ${passed} scenarios passed -- SUITE COMPLETE, exit=0`);
}finally{await context?.close();await new Promise(r=>server.close(r));rmSync(profile,{recursive:true,force:true})}
