import assert from 'node:assert/strict';
import {billingHarness,exact,UID} from './_scanBillingHarness.mjs';
import {redisCommand as redis} from './_idRedis.mjs';
const handler=(await import('../api/user-data.js')).default;
const h=billingHarness();globalThis.__STUB=exact();let checks=0;
const check=(label,a,b)=>{assert.deepEqual(a,b,label);checks++;console.log('✓ '+label)};
const key=`userdata:${UID}`, originalFetch=globalThis.fetch;
let fault='';globalThis.fetch=async(input,init)=>{
 const u=String(input);
 if(u.includes('/get/')&&u.includes('userdata')){
  if(fault==='read-http')return new Response('{}',{status:503});
  if(fault==='read-redis')return Response.json({error:'ERR storage'});
  if(fault==='read-invalid')return Response.json({result:'{broken'});
  if(fault==='read-missing')return Response.json({});
 }
 if(init?.body&&u===process.env.KV_REST_API_URL&&JSON.parse(init.body)[0]==='EVAL'&&fault==='write')return Response.json({error:'ERR write'});
 return originalFetch(input,init);
};
async function call(method,body={}){let code=200,payload;await handler({method,headers:{authorization:'Bearer '+'x'.repeat(40)},body},{setHeader(){},status(n){code=n;return this},json(p){payload=p;return this}});return {code,...payload}}
const snapshot=(id,extra={})=>({portfolio:id?[{id,card:id,updatedAt:Date.now()}]:[],flips:[],clientUpdatedAt:Date.now(),...extra});
try{
 check('new account reads empty',(await call('GET')).portfolio,[]);
 check('first save confirmed',(await call('POST',snapshot('a'))).ok,true);
 const before=await redis(['GET',key]);
 for(const f of ['read-http','read-redis','read-invalid','read-missing']){
  fault=f;check(f+' read returns unavailable',(await call('GET')).code,503);
  check(f+' write fails safely',(await call('POST',snapshot('bad'))).code,503);
  check(f+' preserves stored bytes',await redis(['GET',key]),before);
 }
 fault='write';check('Redis write error is not success',(await call('POST',snapshot('bad'))).code,503);fault='';
 check('write failure preserved bytes',await redis(['GET',key]),before);
 const replies=await Promise.all(['b','c','d'].map(id=>call('POST',snapshot(id))));
 check('concurrent snapshots all committed',replies.every(r=>r.ok),true);
 check('distinct rows survive concurrent writers',(await call('GET')).portfolio.map(r=>r.id).sort(),['a','b','c','d']);
 const deletedAt=Date.now()+5;
 await call('POST',snapshot('',{tombstones:{portfolio:{a:deletedAt},flips:{}}}));
 await call('POST',snapshot('a',{portfolio:[{id:'a',updatedAt:deletedAt-100}],clientUpdatedAt:deletedAt-100}));
 check('stale device cannot resurrect deletion',(await call('GET')).portfolio.map(r=>r.id).sort(),['b','c','d']);
 const beforeDuplicate=await redis(['GET',key]);
 check('mixed-type duplicate IDs are refused',(await call('POST',{portfolio:[{id:123,card:'A'},{id:'123',card:'B'}],flips:[]})).code,409);
 check('duplicate refusal preserves cloud bytes',await redis(['GET',key]),beforeDuplicate);
 check('malformed snapshot rejected',(await call('POST',{portfolio:[]})).code,400);
 check('oversized count rejected without slicing',(await call('POST',{portfolio:Array.from({length:2001},(_,i)=>({id:i})),flips:[]})).code,413);
 const marks=Object.fromEntries(Array.from({length:2000},(_,i)=>['x'+i,Date.now()]));
 await call('POST',snapshot('',{tombstones:{portfolio:marks,flips:{}}}));
 check('deletion capacity covers maximum collection',Object.keys((await call('GET')).tombstones.portfolio).length,2000);
 console.log(`SUITE COMPLETE: collection-storage.mjs: ${checks} passed, 0 failed`);
}finally{h.restore()}
process.exit(0);
