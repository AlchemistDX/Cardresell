// Real identify handler/credit ledger; synthetic provider and auth only.
import assert from 'node:assert/strict';
import {billingHarness,exact,UID} from './_scanBillingHarness.mjs';
import {redisCommand as redis} from './_idRedis.mjs';
import {createMembershipConsumption,membershipEnrollmentKey} from '../api/_membershipConsumption.js';
import {MEMBERSHIP_LEGACY_FENCE} from '../api/_membershipLegacyFence.js';
import {scanIdentityReview} from '../api/_scanIdentityReview.js';
let checks=0;
for(const bucket of ['free','paid']){
  const before=process.env.MEMBERSHIP_BILLING_V2;
  delete process.env.MEMBERSHIP_BILLING_V2;
  const h=billingHarness({bucket,balance:4});
  try{for(const reason of ['low_confidence','no_match','no_card_detected']){
    const stub={token:{uid:UID,email:'recovery@example.test'},tier:'pro',ximilar:{
      tcg:{miss:reason,gameHint:reason==='no_card_detected'?'':'mtg'},
      sport:{miss:'no_match',gameHint:'sports'}
    }};
    const result=await h.scan(stub);
    assert.equal(result.statusCode,200);assert.equal(result.payload.identified,false);
    assert.equal(result.payload.card_name,'');assert.equal(result.payload.card_type,'');
    assert.equal(result.payload.retry_allowed,true);assert.equal(result.payload.credits_charged,0);
    assert.equal(result.payload.grounded_id,null);assert.equal(result.payload.detected_game,reason==='no_card_detected'?'':'mtg');
    assert.equal(h.net(),0,'unidentified scan refunded exactly');
    assert.equal(stub.ximilarCalls,reason==='no_match'?2:1,'no extra paid vision attempts');checks++;
  }}finally{h.restore();if(before===undefined)delete process.env.MEMBERSHIP_BILLING_V2;else process.env.MEMBERSHIP_BILLING_V2=before;}
}
// The same real billing paths used in production must return every credit when
// a name is recognized but its printing/grade context is not established.
const consume=createMembershipConsumption({execute:redis});
for(const billing of ['free','paid','membership']){
  const before=process.env.MEMBERSHIP_BILLING_V2;
  delete process.env.MEMBERSHIP_BILLING_V2;
  const h=billingHarness({bucket:billing==='paid'?'paid':'free',balance:4});
  try{
    if(billing==='membership'){
      await redis(['SET',MEMBERSHIP_LEGACY_FENCE,'1']);
      await redis(['SET',membershipEnrollmentKey(UID),JSON.stringify({version:'launch-v2',owner:UID,plan:'free',verified:true,freeThrough:0,capabilities:{bulkGrade:false}})]);
      process.env.MEMBERSHIP_BILLING_V2='on';
    }
    const balance=async()=>billing==='membership'?(await consume('snapshot',{owner:UID,receipt:'0'.repeat(64),scan:'read-only',mode:'identify'})).monthly:h.net();
    const initial=await balance();
    for(const reason of ['invalid_response','timeout']){
      const stub=exact();stub.ximilar={tcg:{miss:reason}};
      const {statusCode,payload}=await h.scan(stub);
      assert.equal(statusCode,503);assert.equal(payload.code,'IDENTIFY_PROVIDER_UNAVAILABLE');
      assert.equal(payload.retry_allowed,true);assert.equal(payload.credits_charged,0);
      assert.equal(await balance(),initial,'fresh-attempt permission follows the completed refund');checks++;
    }
    for(const [kind,info] of [
      ['slab',{card_type:'pokemon',card_name:'Charizard',card_number:'14',set_code:'sm9',_ximilar_graded:true}],
      ['slab',{card_type:'sports',card_name:'LeBron James',card_number:'8',set_name:'Mosaic',_ximilar_graded:true}],
      ['promo',{card_type:'onepiece',card_name:'Monkey.D.Luffy',card_number:'043',set_code:'P',set_name:'Dreamhack Dallas 2024'}],
      ['promo',{card_type:'onepiece',card_name:'Monkey.D.Luffy',card_number:'043',_ximilar_card_id:'P-043'}],
      ['printing',{card_type:'yugioh',card_name:'Blitzclique - Breakaway',card_number:'101305051',set_code:'CORI',set_name:'Unknown set'}]
    ]){
      const stub=exact();stub.ximilar.cardInfo=info;stub.catalog=[];
      // A label must also gate an ambiguous picker before any offer is minted.
      if(info.card_type==='sports'){stub.ximilar.needsPicker=true;stub.ximilar.candidates=[info,{...info,variant:'Silver'}]}
      const {payload,statusCode}=await h.scan(stub);
      assert.equal(statusCode,200);assert.equal(payload.identified,false);
      assert.equal(payload.identity_review.kind,kind);assert.equal(payload.identity_review.name,info.card_name);
      assert.equal(payload.card_name,'');assert.equal(payload.grounded_id,null);
      assert.equal(payload.confirmation_id,undefined);assert.equal(payload.candidates,undefined);
      assert.equal(payload.retry_allowed,undefined,'manual identity reviews do not start repeat paid requests');
      assert.equal(stub.ximilarCalls,1,'review must not trigger another paid vision request');
      assert.equal(await balance(),initial,'review is refunded exactly, including membership credits');checks++;
    }
    const normal=await h.scan(exact());
    assert.equal(normal.payload.success,true);assert.equal(normal.payload.card_name,'Pikachu','ordinary exact identity remains accepted');assert.equal(normal.payload.grounded_id,'set6-58');
    assert.equal(await balance(),billing==='membership'?initial-1:initial+1);checks++;
    // A lost refund or durable-completion acknowledgment must never release
    // the browser operation for another paid attempt.
    const localFetch=globalThis.fetch;
    for(const fault of billing==='membership'?['refund','complete']:['refund']){
      let faultHits=0;
      globalThis.fetch=async(input,init={})=>{
        let args;try{args=JSON.parse(init.body||'null')}catch{}
        if(Array.isArray(args)&&args[0]==='EVAL'){
          const firstArg=args[3+Number(args[2])];
          let action=firstArg;try{action=JSON.parse(firstArg).action}catch{}
          if(action===fault){faultHits++;return Response.json({error:'ERR injected settlement unavailable'});}
        }
        return localFetch(input,init);
      };
      try{
        const stub=exact();stub.ximilar={tcg:{miss:'invalid_response'}};
        const {statusCode,payload}=await h.scan(stub);
        assert.ok(faultHits>0,`${billing} ${fault}: injected failure reached the ledger`);
        assert.equal(statusCode,503);assert.equal(payload.retry_allowed,undefined);
        assert.notEqual(payload.code,'IDENTIFY_PROVIDER_UNAVAILABLE','uncertain settlement cannot use the legacy confirmed-refund contract');checks++;
      }finally{globalThis.fetch=localFetch}
    }
  }finally{h.restore();if(before===undefined)delete process.env.MEMBERSHIP_BILLING_V2;else process.env.MEMBERSHIP_BILLING_V2=before;}
}
assert.equal(scanIdentityReview({card_type:'pokemon',card_name:'Mega Greninja ex',set_code:'MEP',card_number:'081'}),null);checks++;
assert.equal(scanIdentityReview({card_type:'yugioh',card_name:'Blitzclique - Breakaway',set_code:'CORI-EN051',set_name:'Chaos Origins'}),null);checks++;
assert.equal(scanIdentityReview({card_type:'yugioh',card_name:'Legacy card',set_code:'LOB-001',set_name:'Legend of Blue Eyes White Dragon'}),null);checks++;
console.log(`scan-recovery-routing: ${checks} passed, 0 failed -- SUITE COMPLETE`);
process.stdout.write('',()=>process.exit(0));
