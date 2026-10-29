import {completionGuard} from './_complete.mjs';
const {finish}=completionGuard('scan-evidence-billing');
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {billingHarness,exact} from './_scanBillingHarness.mjs';
let checks=0;
for (const mode of ['matched','timeout','conflict']) {
 const h=billingHarness();
 try {
  const stub=exact();stub.ximilar={cardInfo:{card_type:'yugioh',card_name:'Blitzclique - Breakaway',card_number:'64049762',set_name:'UNKNOWN',_ximilar:true},candidates:[]};
  const previous=globalThis.fetch;let ocrCalls=0;
  globalThis.fetch=async (url,init)=>{
   if(String(url)==='https://www.cardresell.org/data/catalog/yugioh.88b8cbb13943.json') return new Response(await readFile(new URL('../data/catalog/yugioh.88b8cbb13943.json',import.meta.url),'utf8'),{headers:{'Content-Type':'application/json'}});
   if(String(url).includes('/card_ocr_id')) {
    ocrCalls++;
    if(mode==='timeout')throw new DOMException('fixture timeout','TimeoutError');
    return Response.json({records:[{_status:{code:200},_objects:[{name:'Card',_ocr:{full_text:mode==='matched'?'Blitzclique - Breakaway CORI-EN051 1st Edition':'Other card 64049762'}}]}]});
   }
   return previous(url,init);
  };
  const r=await h.scan(stub);
  assert.equal(r.statusCode,200);checks++;
  assert.equal(ocrCalls,1);checks++;
  assert.equal(h.net(),mode==='matched'?1:0);checks++;
  if(mode==='matched'){assert.equal(r.payload.card_number,'CORI-EN051');assert.equal(r.payload.set_name,'Chaos Origins');checks+=2;}
  else {assert.equal(r.payload.identified,false);assert.equal(r.payload.identity_review.kind,'printing');checks+=2;}
 }finally{h.restore()}
}
for(const mode of ['matched','missing-event']) {
 const h=billingHarness();
 try {
  const stub=exact();stub.ximilar={cardInfo:{card_type:'onepiece',card_name:'Monkey.D.Luffy',card_number:'P-043',set_name:'One Piece Promotion Cards',_ximilar:true},candidates:[],needsPicker:true};
  const previous=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,init)=>{
   if(String(url).includes('/data/catalog/onepiece.'))return new Response(await readFile(new URL('../data/catalog/onepiece.740c7853cd03.json',import.meta.url),'utf8'));
   if(String(url).includes('/card_ocr_id')){calls++;return Response.json({records:[{_status:{code:200},_objects:[{name:'Card',_ocr:{full_text:'Monkey.D.Luffy '+(mode==='matched'?'2nd Anniversary':'')}}]}]})}
   if(String(url).includes('/ocr/v2/read')){calls++;return Response.json({records:[{_status:{code:200},_ocr:{full_text:'P-043'}}]})}
   return previous(url,init);
  };
  const image=(await readFile(new URL('./fixtures/grade-check/front-sharp.jpg',import.meta.url))).toString('base64');
  const r=await h.scan(stub,{imageBase64:image});
  assert.equal(r.statusCode,200);checks++;
  assert.equal(h.net(),mode==='matched'?1:0);checks++;
  if(mode==='matched'){assert.equal(r.payload.grounded_id,'603076');checks++;}
  assert.equal(calls,2);checks++;
 } finally {h.restore()}
}
finish(checks,0);
