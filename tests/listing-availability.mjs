import assert from 'node:assert/strict';
import {completionGuard} from './_complete.mjs';
import {fixture,kv} from './_ebayOperationFixture.mjs';
import {listingKey} from '../api/_ebayOperations.js';
import {createHandler} from '../api/listing-availability.js';
import {createHandler as operationHandler} from '../api/ebay-listing-operations.js';
import {draftKey} from '../api/_draftStore.js';
const {finish}=completionGuard('listing-availability');let checks=0;
const check=(v,m)=>{assert.ok(v,m);checks++;};
const f=await fixture('availability-owner'),h=createHandler({verify:async uid=>({uid}),store:kv,env:{EBAY_SELLER_ENVIRONMENT:'sandbox'}});
const drafts=[{draftId:f.draft.draftId,rev:1}],copies={copyIds:[f.uid]};
async function call(body={drafts},{who=f.uid,handler=h,method='POST'}={}){let code=200,data;const headers={};await handler({method,headers:{...(who?{authorization:'Bearer '+who}:{})},body},{setHeader(k,v){headers[k]=v},status(n){code=n;return this},json(p){data=p;return this}});return {code,data,headers};}
const first=r=>r.data.records?.[0];
let r=await call();check(r.code===200&&first(r).canExport&&first(r).state==='clear','synced individual copy is clear');
check(r.headers['Cache-Control']==='private, no-store'&&r.data.environment==='production','private production snapshot, independent of sandbox connection setting');
check((await call({}, {who:null})).code===401,'requires authentication');
check((await call(copies,{method:'GET'})).code===405,'method boundary');
check((await call({drafts,copyIds:[f.uid]})).code===400,'ambiguous mode refused');
check((await call({drafts:[...drafts,...drafts]})).code===400,'duplicate drafts refused');
check((await call({drafts:[{...drafts[0],rev:0}]})).code===400,'invalid revision refused');
check((await call({copyIds:[]})).code===400,'empty check refused');
check((await call({copyIds:Array.from({length:2001},(_,i)=>String(i))})).code===400,'bounded inventory request');
check((await call({drafts}, {who:'another-owner'})).code===409,'foreign draft cannot be read');
check(first(await call(copies,{who:'another-owner'})).state==='not_synced','foreign copy does not expose owner data');
check((await call({drafts:[{...drafts[0],rev:2}]})).code===409,'stale export revision refused');
const duplicate={...f.draft,draftId:'drf_'+'d'.repeat(32)};await kv('SET',draftKey(f.uid,duplicate.draftId),JSON.stringify(duplicate));
check((await call({drafts:[...drafts,{draftId:duplicate.draftId,rev:1}]})).code===409,'two different drafts cannot export the same physical copy twice');
const userdata=await kv('GET','userdata:'+f.uid);
await kv('DEL','userdata:'+f.uid);check(first(await call()).state==='not_synced','unsynced tracked copy needs sync');await kv('SET','userdata:'+f.uid,userdata);
await f.call('plan');const planned=await kv('GET',f.key);
r=await call();check(first(r).state==='held'&&!first(r).canExport&&first(r).operationId,'unsent plan blocks competing file and offers recovery');
check(!JSON.stringify(r.data).includes('accountHash')&&!JSON.stringify(r.data).includes('SELLER'),'snapshot carries no connection tokens or seller identifiers');
for(const state of ['inventory_saved','offer_saved','live','ended','pending','account_deleted']){
 const saved={...JSON.parse(planned),state,...(state==='pending'?{operation:{kind:'publish',id:'op-test'}}:{})};await kv('SET',f.key,JSON.stringify(saved));
 check(first(await call()).state==='held'&&!first(await call()).canExport,state+' remains held');
}
await kv('SET',f.key,planned);await kv('DEL',f.k.connection);
check(first(await call()).state==='held','disconnect does not erase reservation');
await f.call('cancel');check(first(await call()).canExport,'explicit cancellation of unsent plan permits file again');
const cancelled=await kv('GET',f.key);
let data=JSON.parse(userdata);data.flips=[{id:'sale',sourceCollectionId:f.uid}];await kv('SET','userdata:'+f.uid,JSON.stringify(data));
check(first(await call()).state==='sold'&&!first(await call()).canExport,'recorded sale blocks export after cancellation');
await kv('SET',f.key,planned);check(first(await call()).label.includes('reservation still held'),'sale does not silently release eBay hold');
data.flips=[];data.copySales={version:1,entries:[{copyId:f.uid,saleId:'sale',recordedAt:1}]};await kv('SET','userdata:'+f.uid,JSON.stringify(data));
await kv('SET',f.key,cancelled);check(first(await call()).state==='sold','permanent receipt survives report deletion');
await kv('SET','userdata:'+f.uid,userdata);
for(const change of [d=>d.portfolio.push({...d.portfolio[0]}),d=>d.portfolio[0].quantity=2,d=>d.tombstones.portfolio[f.uid]=Date.now()]){
 data=JSON.parse(userdata);change(data);await kv('SET','userdata:'+f.uid,JSON.stringify(data));check(!first(await call()).canExport,'ambiguous, grouped or deleted copy does not export');
}
await kv('SET','userdata:'+f.uid,userdata);
await kv('SET',f.key,'broken');check(first(await call()).state==='unknown'&&!first(await call()).canExport,'corrupt reservation fails closed');
await kv('DEL',f.key);await kv('SADD',f.key,'wrong-type');check((await call()).code===503,'wrong-type key cannot masquerade as an absent reservation');await kv('DEL',f.key);
await kv('SET',f.dk,JSON.stringify({...f.draft,status:'deleted'}));check((await call()).code===409,'deleted draft stops export');
await kv('SET',f.dk,JSON.stringify({...f.draft,status:'archived'}));check((await call()).code===409,'archived draft stops export');
await kv('SET',f.dk,JSON.stringify({...f.draft,instanceId:'scan-copy'}));check(first(await call()).state==='untracked'&&first(await call()).canExport,'standalone scan retains manual draft workflow without claiming tracked stock');
await kv('SET',f.dk,JSON.stringify(f.draft));
const raced=createHandler({verify:async uid=>({uid}),store:async(...args)=>{if(args[0]==='EVAL'&&args[3]==='userdata:'+f.uid)await kv('SET',f.dk,JSON.stringify({...f.draft,rev:2}));return kv(...args);}});
check((await call({drafts},{handler:raced})).code===409,'change between draft read and stock snapshot stops stale download');
await kv('SET',f.dk,JSON.stringify(f.draft));
const sk=listingKey('sandbox',f.uid,f.draft.instanceId);await kv('SET',sk,planned);check(first(await call()).canExport,'sandbox-only plan does not reserve real production inventory');
await kv('SET',f.key,planned);check(first(await call()).state==='held','production hold wins even with a sandbox connection');
await kv('SET','userdata:'+f.uid,'corrupt');check((await call()).code===503,'unreadable sales history stops check');
await kv('SET','userdata:'+f.uid,userdata);
check(await kv('GET',f.key)===planned&&await kv('GET',f.dk)===JSON.stringify(f.draft)&&await kv('GET','userdata:'+f.uid)===userdata,'read checks preserve exact stock, draft and operation bytes');
check(f.state.writes.length===0,'no provider mutation in availability checks');
// Production holds remain reviewable if the deployment switches to Sandbox.
const sandboxOperations=operationHandler({env:{EBAY_SELLER_ENVIRONMENT:'sandbox'},verify:async uid=>({uid}),store:kv,fetcher:()=>{throw Error('No provider request permitted');}});
const id=first(await call()).operationId;
async function operation(method,environment,action,who=f.uid){let code=200,data;await sandboxOperations({method,headers:{authorization:'Bearer '+who,origin:'https://www.cardresell.org'},query:{environment,id},body:{environment,id,action,expectedRev:1,confirmed:true}},{setHeader(){},status(n){code=n;return this},json(p){data=p;return this}});return {code,data};}
r=await operation('GET','production');check(r.code===200&&r.data.environment==='production'&&r.data.records[0].held&&!r.data.connected,'explicit production recovery reads hold without using sandbox credentials');
check((await operation('GET','other')).code===400,'invalid environment refused');
check((await operation('GET','production',undefined,'another-owner')).data.records.length===0,'environment override cannot cross ownership');
check((await operation('POST','production','recover')).code===503,'provider recovery requires matching configured environment');
check((await operation('POST','production','cancel')).code===200,'unsent production plan can be explicitly cancelled without provider access');
check(first(await call()).canExport,'cancellation releases only the production hold');
finish(checks,0);
