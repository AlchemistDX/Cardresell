// Real identify handler/credit ledger; synthetic provider and auth only.
import assert from 'node:assert/strict';
import {billingHarness,UID} from './_scanBillingHarness.mjs';
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
    assert.equal(result.payload.grounded_id,null);assert.equal(result.payload.detected_game,reason==='no_card_detected'?'':'mtg');
    assert.equal(h.net(),0,'unidentified scan refunded exactly');
    assert.equal(stub.ximilarCalls,reason==='no_match'?2:1,'no extra paid vision attempts');checks++;
  }}finally{h.restore();if(before===undefined)delete process.env.MEMBERSHIP_BILLING_V2;else process.env.MEMBERSHIP_BILLING_V2=before;}
}
console.log(`scan-recovery-routing: ${checks} passed, 0 failed -- SUITE COMPLETE`);
process.stdout.write('',()=>process.exit(0));
