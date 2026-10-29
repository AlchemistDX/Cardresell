import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {printedCandidates,resolvePrintedEvidence,readPrintedEvidence,resolveSlabEvidence,printedText} from '../api/_scanPrintedEvidence.js';
let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name)};
const data=async game=>{const m=JSON.parse(await readFile(new URL('../data/catalog/current.json',import.meta.url)));return JSON.parse(await readFile(new URL('..'+m.games[game].url,import.meta.url)))};
const pokemon=await data('pokemon'),ygo=await data('yugioh'),op=await data('onepiece'),lor=await data('lorcana');
const visual={ok:true,needsPicker:true,cardInfo:{card_type:'pokemon',card_name:'Mimikyu',set_name:'Paldea Evolved'}};
const evidence={ok:true,text:'Mimikyu Safeguard PAF EN 037/091',labels:[]};
const resolve=(v,e,extras={})=>resolvePrintedEvidence(v,e,{loadIndex:async g=>({pokemon,yugioh:ygo,onepiece:op,lorcana:lor})[g],fetchFn:async()=>Response.json({id:'sv04.5',name:'Paldean Fates',cardCount:{official:91},abbreviation:{official:'PAF'}}),...extras});
await test('correct missing Mimikyu printing from independent printed set and number',async()=>{const r=await resolve(visual,evidence);assert.equal(r.grounded_id,'sv04.5-037');assert.equal(r.set_name,'Paldean Fates');});
for(const text of ['Mimikyu 037/091','Mimikyu PRE EN 037/091','Mimikyu PAF EN 037/092','Pikachu PAF EN 037/091','Mimikyu PAF EN 037','Mimikyu PAF EN 037/091 160/091']) await test('no guess from incomplete/conflicting print '+text,async()=>assert.equal(await resolve(visual,{...evidence,text}),null));
await test('catalogue metadata outage cannot promote an identity',async()=>assert.equal(await resolve(visual,evidence,{fetchFn:async()=>{throw Error('offline')}}),null));
await test('slab cannot enter raw recovery',async()=>assert.equal(await resolve({...visual,cardInfo:{...visual.cardInfo,_ximilar_graded:true}},evidence),null));
await test('printed YGO code recovers exact physical printing',async()=>{const r=await resolve({cardInfo:{card_type:'yugioh'}},{ok:true,text:'Blitzclique - Breakaway CORI-EN051 1st Edition',labels:[]});assert.equal(r.set_name,'Chaos Origins');assert.equal(r.card_number,'CORI-EN051');});
await test('YGO passcode does not establish a printing',async()=>assert.equal(printedCandidates(ygo,'yugioh','Blitzclique - Breakaway 64049762').length,0));
await test('exact anniversary stamp distinguishes reused promo code',async()=>{const r=await resolve({cardInfo:{card_type:'onepiece'}},{ok:true,text:'Monkey.D.Luffy P-043 2nd Anniversary ONE PIECE',labels:[]});assert.equal(r.grounded_id,'603076');assert.equal(r._printed_promo,true);});
for(const text of ['Monkey.D.Luffy P-043','Monkey.D.Luffy P-043 Dreamhack Dallas','Monkey.D.Luffy P-043 3rd Anniversary']) await test('unresolved event remains review '+text,async()=>assert.equal(printedCandidates(op,'onepiece',text).length,0));
await test('Lorcana collector fraction distinguishes reprint',async()=>{const r=await resolve({cardInfo:{card_type:'lorcana'}},{ok:true,text:'MAKE THE POTION 94/204 EN 4',labels:[]});assert.equal(r.set_name,"Ursula's Return");});
await test('conflicting Lorcana totals rejected',async()=>assert.equal(printedCandidates(lor,'lorcana','MAKE THE POTION 94/205').length,0));
const slabVisual={ok:true,cardInfo:{card_name:'Charizard',set_name:'Team Up',card_number:'14',year:'2019',card_type:'pokemon',_ximilar_graded:true}};
const slabEvidence={ok:true,labels:[{_tags:{Company:[{name:'PSA',prob:.99}]},_ocr:{full_text:'2019 POKEMON CHARIZARD TEAM UP #14 MINT 9 51044018'},_identification:{best_match:{grade:'9',certificate_number:'51044018'}}}]};
await test('slab label preserves grade and certification separately from raw condition',async()=>{const r=resolveSlabEvidence(slabVisual,slabEvidence);assert.equal(r.grader,'PSA');assert.equal(r.grade,'9');assert.equal(r.cert,'51044018');});
await test('PSA label without structured AI fields preserves printed grade and certificate',async()=>{const e=structuredClone(slabEvidence);delete e.labels[0]._identification;const r=resolveSlabEvidence(slabVisual,e);assert.equal(r.grade,'9');assert.equal(r.cert,'51044018');});
await test('multiple printed PSA certificates remain unresolved',async()=>{const e=structuredClone(slabEvidence);delete e.labels[0]._identification;e.labels[0]._ocr.full_text+=' 12345678';assert.equal(resolveSlabEvidence(slabVisual,e),null);});
await test('adjacent Pokemon set and language boxes remain exact',async()=>{const r=await resolve(visual,{...evidence,text:evidence.text.replace('PAF EN','PAFEN')});assert.equal(r.grounded_id,'sv04.5-037');});
await test('spaces around printed YGO separator do not change the code',async()=>{const r=await resolve({cardInfo:{card_type:'yugioh'}},{ok:true,text:'Blitzclique - Breakaway CORI - EN051 1st Edition',labels:[]});assert.equal(r.card_number,'CORI-EN051');});
for(const change of [{card_number:'15'},{set_name:'Base Set'},{year:'2020'},{card_name:'Blastoise'}]) await test('conflicting slab identity remains review '+JSON.stringify(change),async()=>assert.equal(resolveSlabEvidence({...slabVisual,cardInfo:{...slabVisual.cardInfo,...change}},slabEvidence),null));
await test('ambiguous same-label parallel does not auto select',async()=>assert.equal(resolveSlabEvidence({...slabVisual,candidates:[{...slabVisual.cardInfo,variant:'Reverse Holofoil'}]},slabEvidence),null));
await test('OCR request uses one bounded call without logging image',async()=>{
 let calls=0;const r=await readPrintedEvidence('test-image','test-key',{fetchFn:async(url,init)=>{calls++;assert.equal(url,'https://api.ximilar.com/collectibles/v2/card_ocr_id');assert.equal(init.redirect,'error');assert.deepEqual(JSON.parse(init.body),{records:[{_base64:'test-image'}]});return Response.json({records:[{_status:{code:200},_objects:[{name:'Card',_ocr:{full_text:'Mimikyu PAF EN 037/091'}}]}]})}});assert.equal(calls,1);assert.equal(r.ok,true);
});
for(const objects of [[],[{name:'Card'},{name:'Card'}],[{name:'Card',_ocr:{full_text:''}}]]) await test('invalid OCR cannot become evidence '+objects.length,async()=>{const r=await readPrintedEvidence('image','key',{fetchFn:async()=>Response.json({records:[{_status:{code:200},_objects:objects}]})});assert.equal(r.ok,false)});
await test('exact visual name set and number corroborate unreadable set box',async()=>{
 const v={ok:true,cardInfo:{card_type:'pokemon',card_name:'Mimikyu',set_name:'Paldean Fates',card_number:'37'}};
 const r=await resolve(v,{...evidence,text:'Mimikyu Safeguard 037/091'});assert.equal(r.grounded_id,'sv04.5-037');
 assert.equal(await resolve(v,{...evidence,text:'Mimikyu PRE EN 037/091'}),null);
 assert.equal(await resolve({...v,cardInfo:{...v.cardInfo,card_number:'160'}},{...evidence,text:'Mimikyu 037/091'}),null);
});
await test('symbol-era Pokemon does not require an unprinted provider abbreviation',async()=>{
 const v={ok:true,cardInfo:{card_type:'pokemon',card_name:'Dusclops',set_name:'Vivid Voltage',card_number:'070'}};
 const r=await resolve(v,{ok:true,text:'Dusclops 070/185',labels:[]},{fetchFn:async()=>Response.json({id:'swsh4',name:'Vivid Voltage',cardCount:{official:185},abbreviation:{official:'VIV'}})});
 assert.equal(r.grounded_id,'swsh4-70');
});
await test('dedicated slab reader accepts label-only response and never requests raw OCR',async()=>{
 let calls=0;const r=await readPrintedEvidence('image','key',{slab:true,fetchFn:async(url)=>{calls++;assert.equal(url,'https://api.ximilar.com/collectibles/v2/slab_id');return Response.json({records:[{_status:{code:200},_objects:slabEvidence.labels.map(l=>({...l,name:'Slab Label'}))}]})}});
 assert.equal(calls,1);assert.equal(r.ok,true);assert.equal(resolveSlabEvidence(slabVisual,r).cert,'51044018');
});
await test('two slab labels cannot be combined into a single certified identity',async()=>{
 const r=await readPrintedEvidence('image','key',{slab:true,fetchFn:async()=>Response.json({records:[{_status:{code:200},_objects:[{name:'Slab Label'},{name:'Slab Label'}]}]})});assert.equal(r.ok,false);
});
await test('region boundaries retain independently read collector code',async()=>{
 const text=printedText({full_text:'Blitzclique - Breakaway textCORI-EN051more',texts:[{text:'CORI-EN051',prob:.99}]});
 assert.equal(printedCandidates(ygo,'yugioh',text).length,1);
});
await test('Unicode collector separator preserves exact digits',async()=>{
 const text=printedText({full_text:'Applin SC EN',texts:[{text:'012／142',prob:.99}]});
 assert.ok(printedCandidates(pokemon,'pokemon',text).length>0);
 assert.equal(printedCandidates(pokemon,'pokemon',printedText({full_text:'Applin',texts:[{text:'012/142',prob:.6}]})).length,0);
});
await test('conflicting regions still reject automatic fraction selection',async()=>{
 const text=printedText({full_text:'Applin 012/142',texts:[{text:'009/131',prob:.99}]});
 assert.equal(printedCandidates(pokemon,'pokemon',text).length,0);
 assert.equal(printedText({full_text:'x'.repeat(12001)}),'');
});
console.log(`scan-printed-evidence: ${passed} passed, 0 failed -- SUITE COMPLETE`);
