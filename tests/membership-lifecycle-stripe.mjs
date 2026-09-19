// Synthetic HTTP only and process-private real Redis. No managed Stripe requests.
import assert from 'node:assert/strict';
import { redisCommand as redis } from './_idRedis.mjs';
import { createMembershipLifecycleStripe } from '../api/_membershipLifecycleStripe.js';
import { LAUNCH_PLANS } from '../api/_launchMembershipConfig.js';
let passed=0,failed=0;
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name)}catch(e){failed++;console.log('FAIL '+name+': '+e.message)}}
const copy=x=>structuredClone(x);
async function fixture(){
 await redis(['FLUSHDB']);
 const map={plans:{}},prices={};
 for(const [plan,c] of Object.entries(LAUNCH_PLANS)){if(plan==='free')continue;map.plans[plan]={priceId:'price_'+plan,productId:'prod_'+plan};prices['price_'+plan]={object:'price',id:'price_'+plan,product:'prod_'+plan,livemode:false,currency:'usd',unit_amount:c.monthlyPriceCents,type:'recurring',recurring:{interval:'month',interval_count:1}}}
 const f={calls:[],schedules:{},posts:[],prices,account:'acct_test',readerAccount:'acct_test',fault:null,afterUpdate:null};
 f.sub={object:'subscription',id:'sub_test',customer:'cus_test',livemode:false,status:'active',cancel_at_period_end:false,schedule:null,discounts:[],trial_end:null,default_tax_rates:[],automatic_tax:{enabled:false},items:{object:'list',has_more:false,data:[{id:'si_test',quantity:1,price:'price_casual',current_period_start:1700000000,current_period_end:1702592000}]}};
 f.command={owner:'owner',subscriptionId:'sub_test',operationId:'a'.repeat(64),kind:'plan_change',plan:'pro',effectiveAt:1702592000,phase:'requested',idempotencyKey:'membership-synthetic-command'};
 const reader={retrieveAccount:async()=>({object:'account',id:f.readerAccount}),retrieveSubscription:async()=>copy(f.sub),retrievePrice:async id=>copy(f.prices[id])};
 f.fetch=async(url,o)=>{
  const path=new URL(url).pathname.slice(4); f.calls.push({path,method:o.method,auth:o.headers.Authorization,redirect:o.redirect});
  if(path==='account')return Response.json({object:'account',id:f.account});
  if(o.method==='GET')return Response.json(copy(f.schedules[path.split('/')[1]]));
  const p=Object.fromEntries(new URLSearchParams(o.body));f.posts.push({path,p,key:o.headers['Idempotency-Key']});
  let value;
  if(path==='subscription_schedules'){
   value={object:'subscription_schedule',id:'sub_sched_test',subscription:'sub_test',customer:'cus_test',livemode:false,status:'active',end_behavior:'release',phases:[]};f.schedules[value.id]=value;f.sub.schedule=value.id;
  }else if(path==='subscriptions/sub_test'){
   f.sub.cancel_at_period_end=true;value=f.sub;
  }else{
   value=f.schedules[path.split('/')[1]];value.end_behavior=p.end_behavior;
   value.phases=[0,1].map(i=>({start_date:Number(p[`phases[${i}][start_date]`]),...(i===0?{end_date:Number(p['phases[0][end_date]'])}:{}),items:[{price:p[`phases[${i}][items][0][price]`],quantity:1}],proration_behavior:'none'}));
   f.afterUpdate?.(value);
  }
  if(f.fault===path){f.fault=null;throw Error('synthetic committed response loss')}
  return Response.json(copy(value));
 };
 f.api=createMembershipLifecycleStripe({execute:redis,reader,apiKey:'sk_test_synthetic',accountId:'acct_test',priceMap:map,fetchImpl:f.fetch,timeoutMs:100});
 f.map=map;f.reader=reader;return f;
}
await test('normal plan change writes create and update once then confirms canonical snapshot',async()=>{const f=await fixture();assert.equal((await f.api.executeCommand(f.command)).status,'confirmed');assert.equal(f.posts.length,2);assert.equal((await f.api.executeCommand(f.command)).status,'confirmed');assert.equal(f.posts.length,2);assert.ok(f.calls.every(x=>x.auth==='Bearer sk_test_synthetic'&&x.redirect==='error'));assert.equal(f.posts[1].p['phases[0][items][0][price]'],'price_casual');assert.equal(f.posts[1].p['phases[1][items][0][price]'],'price_pro');assert.equal(f.posts[1].p.proration_behavior,'none');assert.equal(f.posts[1].p.end_behavior,'release')});
await test('wrong account using actual key stops before POST',async()=>{const f=await fixture();f.account='acct_other';await assert.rejects(()=>f.api.executeCommand(f.command));assert.equal(f.posts.length,0)});
await test('lost schedule-create response never repeats or silently updates',async()=>{const f=await fixture();f.fault='subscription_schedules';await assert.rejects(()=>f.api.executeCommand(f.command));assert.equal((await f.api.executeCommand(f.command)).status,'pending');assert.equal(f.posts.length,1)});
await test('lost schedule-update response recovers canonically without a second POST',async()=>{const f=await fixture();f.fault='subscription_schedules/sub_sched_test';await assert.rejects(()=>f.api.executeCommand(f.command));assert.equal((await f.api.executeCommand(f.command)).status,'confirmed');assert.equal(f.posts.length,2)});
await test('same operation altered plan fails before a second POST',async()=>{const f=await fixture();await f.api.executeCommand(f.command);await assert.rejects(()=>f.api.executeCommand({...f.command,plan:'business'}));assert.equal(f.posts.length,2)});
await test('concurrent identical commands do not duplicate writes',async()=>{const f=await fixture();await Promise.all([f.api.executeCommand(f.command),f.api.executeCommand(f.command)]);assert.equal(f.posts.filter(x=>x.path==='subscription_schedules').length,1);assert.equal(f.posts.filter(x=>x.path==='subscription_schedules/sub_sched_test').length,1)});
await test('cancel mutates once and repeated request confirms canonical cancellation',async()=>{const f=await fixture();const c={...f.command,kind:'cancel',plan:null};await f.api.executeCommand(c);assert.equal((await f.api.executeCommand(c)).status,'confirmed');assert.equal(f.posts.length,1);assert.equal(f.posts[0].p.cancel_at_period_end,'true')});
await test('lost cancellation response reconciles without another cancellation POST',async()=>{const f=await fixture();f.fault='subscriptions/sub_test';const c={...f.command,kind:'cancel',plan:null};await assert.rejects(()=>f.api.executeCommand(c));assert.equal((await f.api.executeCommand(c)).status,'confirmed');assert.equal(f.posts.length,1)});
await test('existing schedule rejects cancellation without writes',async()=>{const f=await fixture();f.sub.schedule='sub_sched_external';await assert.rejects(()=>f.api.executeCommand({...f.command,kind:'cancel',plan:null}));assert.equal(f.posts.length,0)});
await test('invalid current customer rejects before write',async()=>{const f=await fixture();f.sub.customer='not-customer';await assert.rejects(()=>f.api.executeCommand(f.command));assert.equal(f.posts.length,0)});
await test('different target plan price amount rejects BEFORE any write',async()=>{const f=await fixture();f.prices.price_pro.unit_amount=999999;await assert.rejects(()=>f.api.executeCommand(f.command));assert.equal(f.posts.length,0)});
await test('target price product mismatch rejects BEFORE any write',async()=>{const f=await fixture();f.prices.price_pro.product='prod_unrelated';await assert.rejects(()=>f.api.executeCommand(f.command));assert.equal(f.posts.length,0)});
await test('canonical schedule end_behavior cancel cannot confirm recurring plan change',async()=>{const f=await fixture();f.afterUpdate=s=>{s.end_behavior='cancel'};await assert.rejects(()=>f.api.executeCommand(f.command))});
await test('canonical discounted future phase cannot confirm full-price change',async()=>{const f=await fixture();f.afterUpdate=s=>{s.phases[1].discounts=[{coupon:'coupon_unapproved'}]};await assert.rejects(()=>f.api.executeCommand(f.command))});
await test('future item tax rejects canonical confirmation',async()=>{const f=await fixture();f.afterUpdate=s=>{s.phases[1].items[0].tax_rates=['txr_unapproved']};await assert.rejects(()=>f.api.executeCommand(f.command))});
await test('future phase trial rejects canonical confirmation',async()=>{const f=await fixture();f.afterUpdate=s=>{s.phases[1].trial_end=1703000000};await assert.rejects(()=>f.api.executeCommand(f.command))});
await test('saved schedule detached on retry cannot receive update',async()=>{const f=await fixture();f.fault='subscription_schedules/sub_sched_test';await assert.rejects(()=>f.api.executeCommand(f.command));f.sub.schedule='sub_sched_unrelated';await assert.rejects(()=>f.api.executeCommand(f.command));assert.equal(f.posts.length,2)});
console.log(`membership-lifecycle-stripe: ${passed} passed, ${failed} failed`);process.exit(failed?1:0);
