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
  assert.ok(r.evidence.truncated);
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
  const r=resolveIdentity({setCode:'RA04-EN087',rarity:'Secret Rare'},
    [{setCode:'RA04-EN087',rarity:'Super Rare',name:'S1',_raw:{n:1}},
     {setCode:'RA04-EN087',rarity:'Secret Rare',name:'S2',_raw:{n:2}}],
    {rarityComparable:true});
  assert.equal(r.endState,E.EXACT_MATCH);
  assert.equal(r.printing._raw.n,2);
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

console.log('\nsource failure is not a refund');
t('SOURCE_UNAVAILABLE is distinct from UNKNOWN_CARD',()=>{
  const r=resolveIdentity({name:'Weedle'},[],{sourceFailed:true,sourceError:'503'});
  assert.equal(r.endState,E.SOURCE_UNAVAILABLE);
  assert.notEqual(r.endState,E.UNKNOWN_CARD);
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
