/* Verifies the wired call sites behave with the REAL candidate shapes each
 * site constructs, using the measured F3/F2 collision cases. */
import assert from 'node:assert/strict';
import { resolveIdentity, END_STATES as E } from '../api/_identityResolution.js';
let pass=0,fail=0;
const t=(n,f)=>{try{f();console.log(`  ok   ${n}`);pass++;}catch(e){console.log(`  FAIL ${n}\n       ${e.message}`);fail++;}};

console.log('Pokemon rank site (F3) — real measured collision: weedle #1 in 8 sets');
t('weedle #1 across 8 sets with no readable set code -> NEEDS_CONFIRMATION, capped at 3',()=>{
  const sets=['base1','base3','base5','neo1','ex7','dp2','hgss1','bw1'];
  const r=resolveIdentity({name:'Weedle',number:'1',setCode:null},
    sets.map(s=>({name:'Weedle',number:'1',setCode:s,_raw:{id:`${s}-1`}})));
  assert.equal(r.endState,E.NEEDS_CONFIRMATION);
  assert.equal(r.candidates.length,3,'short list is exactly three');
  // `truncated` was replaced by the full candidate set: top-3 is what the
  // seller sees FIRST, not the limit of what they can reach. All eight stay
  // available so the correct printing cannot be hidden by provider order.
  assert.equal(r.evidence.moreAvailable,true,'more matches are offered');
  assert.equal(r.evidence.allCandidates.length,8,'every candidate stays reachable');
});
t('weedle #1 WITH a readable set code -> EXACT_MATCH on that set',()=>{
  const sets=['base1','base3','base5'];
  const r=resolveIdentity({name:'Weedle',number:'1',setCode:'base3'},
    sets.map(s=>({name:'Weedle',number:'1',setCode:s,_raw:{id:`${s}-1`}})));
  assert.equal(r.endState,E.EXACT_MATCH);
  assert.equal(r.printing._raw.id,'base3-1');
});
t('token ranking putting the WRONG set first no longer decides identity',()=>{
  // Old code: ranked[0] wins. Wrong set first => silent substitution.
  const r=resolveIdentity({name:'Weedle',number:'1',setCode:'base3'},
    [{name:'Weedle',number:'1',setCode:'base1',_raw:{id:'base1-1'}},
     {name:'Weedle',number:'1',setCode:'base3',_raw:{id:'base3-1'}}]);
  assert.equal(r.printing._raw.id,'base3-1','printed set code beats rank order');
});
t('a candidate list whose numbers all conflict -> UNKNOWN_CARD, not a guess',()=>{
  const r=resolveIdentity({name:'Weedle',number:'1',setCode:null},
    [{name:'Weedle',number:'44',setCode:'base1',_raw:{}},{name:'Weedle',number:'70',setCode:'neo1',_raw:{}}]);
  assert.equal(r.endState,E.UNKNOWN_CARD);
});

console.log('\nYGO printing site — real measured (passcode,set_code) collision resolved by rarity');
t('rarity from the SAME vocabulary resolves the collision (opt-in)',()=>{
  // FIXTURE CORRECTED. This previously observed only {setCode, rarity} with two
  // differently-NAMED candidates, which is not the collision it claims to model
  // and no longer reaches EXACT_MATCH — a YGO set_code is not a sufficient
  // locator on its own (3,879 set_codes are reused across DIFFERENT cards), so
  // the evidence gate now demands a name plus a locator. The real measured
  // collision is one card printed at two rarities under the same set_code.
  const r=resolveIdentity({name:'Blue-Eyes White Dragon',setCode:'RA04-EN087',rarity:'Secret Rare'},
    [{name:'Blue-Eyes White Dragon',setCode:'RA04-EN087',rarity:'Super Rare',_raw:{n:1}},
     {name:'Blue-Eyes White Dragon',setCode:'RA04-EN087',rarity:'Secret Rare',_raw:{n:2}}],
    {rarityComparable:true});
  assert.equal(r.endState,E.EXACT_MATCH);
  assert.equal(r.printing._raw.n,2);
});
t('REGRESSION: a YGO set_code alone is not sufficient evidence',()=>{
  // 3,879 set_codes are reused across different cards, so a set_code with no
  // name cannot authorise an automatic answer even with one candidate.
  const r=resolveIdentity({setCode:'RA04-EN087'},
    [{name:'Blue-Eyes White Dragon',setCode:'RA04-EN087',_raw:{n:1}}]);
  assert.equal(r.endState,E.NEEDS_CONFIRMATION);
  assert.equal(r.evidence.insufficientEvidence,true);
});
t('the SCANNER path does not set rarityComparable, so it confirms instead',()=>{
  // Observed rarity comes from the vision model; candidate rarity from
  // YGOProDeck. Different vocabularies -> comparison is not admissible.
  const r=resolveIdentity({setCode:'RA04-EN087',rarity:'Secret Rare'},
    [{setCode:'RA04-EN087',rarity:'Super Rare',name:'S1',_raw:{n:1}},
     {setCode:'RA04-EN087',rarity:'Secret Rare',name:'S2',_raw:{n:2}}]);
  assert.equal(r.endState,E.NEEDS_CONFIRMATION,
    'catalog-level uniqueness is not scan-time resolvability');
});
t('same set_code, rarity NOT readable -> confirmation, never card_sets[0]',()=>{
  const r=resolveIdentity({setCode:'RA04-EN087',rarity:null},
    [{setCode:'RA04-EN087',rarity:'Super Rare',name:'S1',_raw:{n:1}},
     {setCode:'RA04-EN087',rarity:'Secret Rare',name:'S2',_raw:{n:2}}]);
  assert.notEqual(r.endState,E.EXACT_MATCH,'must not silently pick the first printing');
  assert.equal(r.endState,E.NEEDS_CONFIRMATION);
});

console.log('\nLorcana site (F8) — was hits[0]');
t('a single consistent hit resolves',()=>{
  const r=resolveIdentity({name:'Ariel',number:'1',setCode:'TFC'},
    [{name:'Ariel',number:'1',setCode:'TFC',_raw:{Name:'Ariel'}}]);
  assert.equal(r.endState,E.EXACT_MATCH);
  assert.equal(r.printing._raw.Name,'Ariel');
});
t('a hit whose name conflicts is rejected rather than accepted as hits[0]',()=>{
  const r=resolveIdentity({name:'Ariel',number:'1',setCode:'TFC'},
    [{name:'Ursula',number:'1',setCode:'TFC',_raw:{Name:'Ursula'}}]);
  assert.equal(r.endState,E.UNKNOWN_CARD,'wrong card is not returned');
});

/* HEADING CORRECTED (reviewer item 7).
 *
 * This section was headed "source failure is not a refund", which was wrong on
 * two counts. It asserted only that two END STATES differ — it said nothing
 * about credits — and the claim it appeared to make is false: api/scan.js DOES
 * refund on a provider failure (`await refundCredits()` immediately before the
 * 503 IDENTIFY_PROVIDER_UNAVAILABLE return, api/scan.js:1131-1140).
 *
 * The distinction that actually matters: an outage and a genuine miss are
 * different END STATES the seller is told about differently, but BOTH must
 * leave the seller's credit intact. Credit behaviour is not observable from
 * this pure module; it is asserted against the real handler in
 * tests/scan-handler-integration.mjs.
 */
console.log('\nan outage is a distinct end state — and is still not billed');
t('SOURCE_UNAVAILABLE is distinct from UNKNOWN_CARD',()=>{
  const r=resolveIdentity({name:'Weedle'},[],{sourceFailed:true,sourceError:'503'});
  assert.equal(r.endState,E.SOURCE_UNAVAILABLE);
  assert.notEqual(r.endState,E.UNKNOWN_CARD);
});
t('an outage is never reported as a card the seller could accept',()=>{
  const r=resolveIdentity({name:'Weedle',number:'1',setCode:'base1'},
    [{name:'Weedle',number:'1',setCode:'base1'}],{sourceFailed:true,sourceError:'503'});
  assert.equal(r.endState,E.SOURCE_UNAVAILABLE,
    'a partial result during an outage must not be presented as an identification');
});
/* The push gate judges an .mjs suite on THREE things: zero reported
 * failures, exit 0, AND this completion marker. A suite that dies before
 * its last assertion can still print a clean-looking count and exit 0, and
 * without the marker the runner records it as a failure rather than a pass.
 * Registering a suite in tests/run-all.sh therefore requires emitting it. */
console.log(`\nidentity-wiring: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
