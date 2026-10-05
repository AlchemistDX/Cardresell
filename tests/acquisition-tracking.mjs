import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('var campaignLabels'));
assert.ok(script);
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),values};};
function browser({query='',ref='',local=memory(),session=memory(),beacon=true}={}){
 const sent=[],fallback=[],va=[],timers=[];const window={va:(...args)=>va.push(args)};
 vm.runInNewContext(script,{window,location:{search:query},document:{referrer:ref},localStorage:local,sessionStorage:session,
 navigator:{sendBeacon:(url,blob)=>{sent.push({url,blob});return beacon;}},Blob,URL,URLSearchParams,Date,Math,JSON,
 fetch:(url,options)=>{fallback.push({url,...options});return Promise.resolve();},setTimeout:fn=>timers.push(fn)});
 return {window,sent,fallback,va,timers,local,session};
}
async function event(b){b.window.trackEvent('membership_checkout_attempt',{plan:'starter',campaign:'spoofed'});return JSON.parse(await b.sent.at(-1).blob.text());}
let passed=0;async function test(n,fn){await fn();passed++;console.log('PASS '+n);}
for(const [query,channel] of [['','direct'],['?cr_campaign=shop_qr','shop_qr'],['?utm_source=youtube&utm_campaign=launch','youtube'],['?utm_source=discord','discord'],['?utm_source=google&utm_medium=cpc','google_ads'],['?utm_source=google&utm_medium=organic','organic_search'],['?utm_source=instagram&utm_medium=paid_social','meta_ads'],['?utm_source=facebook&utm_medium=social','referral'],['?utm_source=__proto__','other_campaign'],['?cr_campaign=private@example.com','other_campaign']])
 await test('bounded attribution '+query,async()=>{assert.equal((await event(browser({query}))).props.campaign,channel);});
await test('sign-in/payment returns retain channel without extending its lifetime',async()=>{
 const local=memory();let b=browser({query:'?cr_campaign=discord',local});const original=local.getItem('cr_acquisition_v1');
 for(const ref of ['https://accounts.google.com/','https://checkout.stripe.com/pay/private','https://www.cardresell.org/signin']){
  b=browser({local,ref});assert.equal((await event(b)).props.campaign,'discord');assert.equal(local.getItem('cr_acquisition_v1'),original);
 }
});
await test('new tagged entry replaces prior channel',async()=>{const local=memory();browser({query:'?cr_campaign=shop_qr',local});assert.equal((await event(browser({query:'?cr_campaign=youtube',local}))).props.campaign,'youtube');});
await test('expired, future and invalid stored attribution discarded',async()=>{
 for(const saved of [{campaign:'shop_qr',at:Date.now()-31*86400000},{campaign:'shop_qr',at:Date.now()+86400000},{campaign:'private@example.com',at:Date.now()}]){
  const local=memory();local.setItem('cr_acquisition_v1',JSON.stringify(saved));assert.equal((await event(browser({local}))).props.campaign,'direct');
 }
});
await test('raw URL, email, referrer and ad identifiers never stored or sent as attribution',async()=>{
 const b=browser({query:'?utm_source=youtube&utm_campaign=private@example.com&gclid=secret-click',ref:'https://external.invalid/private-token'});const e=await event(b);
 const text=JSON.stringify([e,[...b.local.values.values()],b.va]);assert.ok(!/private@example|secret-click|external.invalid|private-token/.test(text));
});
await test('storage-disabled browsers still emit an entry event',async()=>{
 const blocked={getItem(){throw Error();},setItem(){throw Error();}};const b=browser({query:'?cr_campaign=shop_qr',local:blocked,session:blocked});assert.equal(b.timers.length,1);b.timers[0]();assert.equal(JSON.parse(await b.sent[0].blob.text()).props.campaign,'shop_qr');
});
await test('page entry deduplication is per tab/channel',async()=>{const session=memory();assert.equal(browser({query:'?cr_campaign=shop_qr',session}).timers.length,1);assert.equal(browser({query:'?cr_campaign=shop_qr',session}).timers.length,0);assert.equal(browser({query:'?cr_campaign=discord',session}).timers.length,1);});
await test('beacon refusal falls back to fetch',async()=>{const b=browser({beacon:false});await event(b);assert.equal(b.fallback.length,1);assert.equal(JSON.parse(b.fallback[0].body).props.campaign,'direct');});
await test('accepted beacon does not duplicate fetch',async()=>{const b=browser();await event(b);assert.equal(b.fallback.length,0);});
process.env.KV_REST_API_URL='https://event-store.invalid';process.env.KV_REST_API_TOKEN='test-only';process.env.ANALYTICS_ADMIN_KEY='test-admin';
const {default:handler}=await import('../api/events.js');
const counts=new Map(),names=new Set();let down=false,commands=[];
globalThis.fetch=async(url,options)=>{
 if(down)return {ok:false,json:async()=>({error:'unavailable'})};
 if(url.endsWith('/pipeline'))return {ok:true,json:async()=>JSON.parse(options.body).map(([,key])=>({result:counts.get(key)||null}))};
 const [command,...args]=new URL(url).pathname.slice(1).split('/').map(decodeURIComponent);commands.push([command,...args]);let result='OK';
 if(command==='sadd')names.add(args[1]);if(command==='smembers')result=[...names];
 if(command==='incr'){result=(counts.get(args[0])||0)+1;counts.set(args[0],result);}
 if(command==='get')result=counts.get(args[0])||null;
 return {ok:true,json:async()=>({result})};
};
async function request(method,body,query={}){const res={setHeader(){},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};await handler({method,body,query},res);return res;}
await test('server persists allowlisted campaign and reports recorded',async()=>{const r=await request('POST',{name:'membership_checkout_attempt',props:{campaign:'shop_qr',email:'private@example.com'}});assert.equal(r.body.recorded,true);assert.ok([...counts.keys()].some(k=>k.endsWith(':campaign=shop_qr')));assert.ok(!JSON.stringify(commands).includes('private@example'));});
await test('arbitrary campaign text creates only fixed fallback bucket',async()=>{await request('POST',{name:'page_view',props:{campaign:'private@example.com'}});assert.ok([...counts.keys()].some(k=>k.endsWith(':campaign=other_campaign')));assert.ok(!JSON.stringify(commands).includes('private@example'));});
await test('campaign report is admin protected',async()=>{const before=commands.length;assert.equal((await request('GET',null,{breakdown:'campaign'})).code,403);assert.equal(commands.length,before);});
await test('admin campaign counts reconcile with stored events',async()=>{const r=await request('GET',null,{admin:'test-admin',window:'1',breakdown:'campaign'});assert.equal(r.body.campaigns.shop_qr.membership_checkout_attempt,1);assert.equal(r.body.campaigns.other_campaign.page_view,1);assert.equal(r.body.campaigns.qa.membership_checkout_attempt,0);assert.match(r.body.measurement,/not_unique_customers_or_revenue/);});
await test('storage failure never claims recording or interrupts client',async()=>{down=true;const r=await request('POST',{name:'telemetry_check',props:{campaign:'qa'}});assert.equal(r.code,200);assert.equal(r.body.recorded,false);down=false;});
console.log(`${passed} passed, 0 failed`);
