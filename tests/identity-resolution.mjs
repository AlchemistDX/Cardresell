/* Tests for api/_identityResolution.js — work-order item 3.
 *
 * Each assertion names a behaviour and evidences a surface.
 * Run: node tests/identity-resolution.mjs
 */
import assert from 'node:assert/strict';
import * as R from '../api/_identityResolution.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
};

console.log('normalisation');
t('number normalisation strips set size and leading zeros', () => {
  assert.equal(R.normNumber('004/102'), '4');
  assert.equal(R.normNumber('4'), '4');
  assert.equal(R.normNumber('004'), '4');
});
t('number normalisation preserves alphabetic prefixes and suffixes', () => {
  assert.equal(R.normNumber('TG12/TG30'), 'TG12');
  assert.equal(R.normNumber('SV049'), 'SV49');
});
t('text normalisation is Unicode-preserving, not ASCII-folding', () => {
  // Japanese Pokémon names must survive; stripping them corrupts identity.
  assert.equal(R.normText('  リーフィア  '), 'リーフィア');
  assert.equal(R.normText('Pokémon'), 'pokémon');
  assert.notEqual(R.normText('Pokémon'), 'pokemon');
});

console.log('\nprinted-identifier consistency');
t('missing field is unknown, never an agreement', () => {
  assert.equal(R.compareField(null, '4', 'number'), 'unknown');
  assert.equal(R.compareField('4', null, 'number'), 'unknown');
});
t('conflicting number is a conflict', () => {
  assert.equal(R.compareField('4/102', '5/102', 'number'), 'conflict');
});

console.log('\nend states');
const obs = { name: 'Ivysaur', number: '2/102', setCode: 'base1' };

t('single consistent candidate yields EXACT_MATCH', () => {
  const r = R.resolveIdentity(obs, [{ name: 'Ivysaur', number: '002/102', setCode: 'base1' }]);
  assert.equal(r.endState, 'EXACT_MATCH');
  assert.equal(r.printing.name, 'Ivysaur');
});

t('two equally consistent candidates yield NEEDS_CONFIRMATION, not a guess', () => {
  const r = R.resolveIdentity(
    { number: '2/102' },
    [{ name: 'Ivysaur', number: '002/102' }, { name: 'Ivysaur', number: '002/102', setCode: 'base2' }]
  );
  assert.equal(r.endState, 'NEEDS_CONFIRMATION');
  assert.equal(r.printing, null, 'must not name a printing when ambiguous');
  assert.equal(r.candidates.length, 2);
});

t('REGRESSION: ambiguity no longer resolves to candidates[0]', () => {
  // This is the F-series defect: cards[0] / card_sets[0] / hits[0].
  const cands = [
    { name: 'Weedle', number: '69/102', setCode: 'base1' },
    { name: 'Weedle', number: '69/102', setCode: 'base4' },
    { name: 'Weedle', number: '69/102', setCode: 'base5' },
  ];
  const r = R.resolveIdentity({ name: 'Weedle', number: '69/102' }, cands);
  assert.equal(r.endState, 'NEEDS_CONFIRMATION');
  assert.notEqual(r.printing, cands[0]);
});

t('short list is three, but every unresolved candidate stays reachable', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ name: 'Pikachu', number: '58/102', setCode: `s${i}` }));
  const r = R.resolveIdentity({ name: 'Pikachu', number: '58/102' }, many);
  assert.equal(r.endState, 'NEEDS_CONFIRMATION');
  assert.equal(r.candidates.length, 3, 'top-3 is the benchmark view');
  assert.equal(r.evidence.moreAvailable, true);
  assert.equal(r.evidence.allCandidates.length, 8, 'no candidate is discarded by provider order');
  assert.equal(r.evidence.consistentCount, 8, 'true count is still reported');
});

t('the correct printing is not hidden by provider order', () => {
  // The right answer is last in the provider's list. slice(0,3) used to drop it
  // outright; it must remain reachable for refinement / "more matches".
  const cands = Array.from({ length: 6 }, (_, i) => ({ name: 'Pikachu', number: '58/102', setCode: `s${i}` }));
  cands.push({ name: 'Pikachu', number: '58/102', setCode: 'TARGET' });
  const r = R.resolveIdentity({ name: 'Pikachu', number: '58/102' }, cands);
  assert.equal(r.endState, 'NEEDS_CONFIRMATION');
  assert.ok(
    r.evidence.allCandidates.some((c) => c.setCode === 'TARGET'),
    'a candidate must not be unreachable merely because it was returned seventh'
  );
});

t('REGRESSION: incomplete competitor metadata does not create an EXACT_MATCH', () => {
  // Previously a "strictly dominant" branch accepted whichever candidate agreed
  // on the most fields. Agreement count tracks how completely the PROVIDER
  // documented the record, not evidence about the card in hand, so the
  // better-documented printing beat an equally plausible competitor whose set
  // code was simply absent. Both are plausible; this must be confirmed.
  const r = R.resolveIdentity(
    { name: 'Charizard', number: '4/102', setCode: 'base1' },
    [
      { name: 'Charizard', number: '004/102', setCode: 'base1' }, // agrees on 3
      { name: 'Charizard', number: '004/102' },                   // agrees on 2, conflicts on none
    ]
  );
  assert.equal(r.endState, 'NEEDS_CONFIRMATION');
  assert.equal(r.printing, null, 'no printing may be claimed');
  assert.equal(r.evidence.allCandidates.length, 2, 'the incomplete competitor survives');
});

t('a genuinely unique candidate still resolves automatically', () => {
  const r = R.resolveIdentity(
    { name: 'Charizard', number: '4/102', setCode: 'base1' },
    [{ name: 'Charizard', number: '004/102', setCode: 'base1' },
     { name: 'Blastoise', number: '2/102', setCode: 'base1' }]
  );
  assert.equal(r.endState, 'EXACT_MATCH');
  assert.equal(r.printing.name, 'Charizard');
});

/* --- evidence sufficiency (reviewer counterexample 1) -------------------- */

t('REGRESSION: no observed evidence + one candidate is NOT an EXACT_MATCH', () => {
  const r = R.resolveIdentity({}, [{ name: 'Charizard', setCode: 'base1', number: '4' }]);
  assert.equal(r.endState, 'NEEDS_CONFIRMATION');
  assert.equal(r.printing, null, 'absence of contradiction is not proof of identity');
  assert.equal(r.evidence.insufficientEvidence, true);
});

t('a number alone is insufficient — numbers repeat across sets', () => {
  // Measured: `weedle #1` and `caterpie #1` each occur in 8 different sets.
  const r = R.resolveIdentity({ number: '1' }, [{ name: 'Weedle', number: '1', setCode: 'base1' }]);
  assert.equal(r.endState, 'NEEDS_CONFIRMATION');
  assert.equal(r.evidence.insufficientEvidence, true);
});

t('a name alone is insufficient without any locator', () => {
  const r = R.resolveIdentity({ name: 'Pikachu' }, [{ name: 'Pikachu', number: '58', setCode: 'base1' }]);
  assert.equal(r.endState, 'NEEDS_CONFIRMATION');
  assert.equal(r.evidence.insufficientEvidence, true);
});

t('name plus one locator is sufficient evidence', () => {
  const r = R.resolveIdentity({ name: 'Pikachu', number: '58' }, [{ name: 'Pikachu', number: '58', setCode: 'base1' }]);
  assert.equal(r.endState, 'EXACT_MATCH');
  assert.equal(r.evidence.evidence.sufficientForExact, true);
});

t('all candidates conflicting yields UNKNOWN_CARD, not nearest neighbour', () => {
  const r = R.resolveIdentity(obs, [
    { name: 'Venusaur', number: '15/102', setCode: 'base1' },
    { name: 'Bulbasaur', number: '44/102', setCode: 'base1' },
  ]);
  assert.equal(r.endState, 'UNKNOWN_CARD');
  assert.equal(r.printing, null);
  assert.ok(r.evidence.rejected.length === 2, 'rejections are evidenced');
});

t('empty candidate list yields UNKNOWN_CARD', () => {
  assert.equal(R.resolveIdentity(obs, []).endState, 'UNKNOWN_CARD');
});

t('source failure is SOURCE_UNAVAILABLE, never UNKNOWN_CARD', () => {
  // Conflating these bills an infrastructure fault as a recognition miss.
  const r = R.resolveIdentity(obs, [], { sourceFailed: true, sourceError: 'HTTP 503' });
  assert.equal(r.endState, 'SOURCE_UNAVAILABLE');
  assert.match(r.reason, /503/);
});

t('unreadable image outranks candidate evaluation', () => {
  const r = R.resolveIdentity(obs, [{ name: 'Ivysaur', number: '2/102' }], { imageUnreadable: true });
  assert.equal(r.endState, 'UNREADABLE_IMAGE');
});

t('UNSUPPORTED_CARD is emitted for an out-of-catalogue game', () => {
  // §14 found this end state had no located emitter anywhere in the codebase.
  const r = R.resolveIdentity(obs, [], { gameSupported: false });
  assert.equal(r.endState, 'UNSUPPORTED_CARD');
});

t('all six declared end states are reachable from this module', () => {
  const seen = new Set([
    R.resolveIdentity(obs, [{ ...obs }]).endState,
    R.resolveIdentity({ number: '2/102' }, [{ number: '002/102' }, { number: '002/102', setCode: 'x' }]).endState,
    R.resolveIdentity(obs, []).endState,
    R.resolveIdentity(obs, [], { gameSupported: false }).endState,
    R.resolveIdentity(obs, [], { imageUnreadable: true }).endState,
    R.resolveIdentity(obs, [], { sourceFailed: true }).endState,
  ]);
  assert.equal(seen.size, 6, `reachable: ${[...seen].join(',')}`);
});

console.log('\neditorial text must not discriminate at scan time');
t('unreadable editorial parenthetical does not create a false EXACT_MATCH', () => {
  // Measured: full product name collapses One Piece/Lorcana catalogue ambiguity
  // to zero, but only via text like "(Alternate Art)" that is not on the card.
  const r = R.resolveIdentity(
    { name: 'Monkey D. Luffy', number: 'P-001' },
    [
      { name: 'Monkey D. Luffy (Alternate Art)', number: 'P-001' },
      { name: 'Monkey D. Luffy (Store Championship Trophy Card)', number: 'P-001' },
    ]
  );
  assert.equal(r.endState, 'NEEDS_CONFIRMATION',
    'catalogue-unique is not the same as visually distinguishable');
});

console.log('\neditorial stripping (regression for the bug this suite caught)');
t('stripEditorial removes parentheticals and catalogue suffixes only', () => {
  assert.equal(R.stripEditorial('Monkey D. Luffy (Alternate Art)'), 'Monkey D. Luffy');
  assert.equal(R.stripEditorial('Pincurchin - 061/190 (Mirror Holofoil)'), 'Pincurchin');
  assert.equal(R.stripEditorial('Ivysaur'), 'Ivysaur');
});
t('stripping is not over-eager: a hyphenated card name survives', () => {
  assert.equal(R.stripEditorial('Ho-Oh'), 'Ho-Oh');
  assert.equal(R.stripEditorial('Flareon-GX'), 'Flareon-GX');
});
t('editorial-only difference does not refund a card that IS in the catalogue', () => {
  const r = R.resolveIdentity(
    { name: 'Pincurchin', number: '061/190' },
    [{ name: 'Pincurchin - 061/190', number: '061/190' },
     { name: 'Pincurchin - 061/190 (Mirror Holofoil)', number: '061/190' }]
  );
  assert.equal(r.endState, 'NEEDS_CONFIRMATION');
  assert.notEqual(r.endState, 'UNKNOWN_CARD', 'must not refund a catalogued card');
});

console.log('\nbounded retry and HTTP status handling');
const res = (status, headers) => ({ status, headers: { get: (k) => (headers || {})[k.toLowerCase()] ?? null } });

t('429 is retried and classified as rate limiting, never as not_found', () => {
  assert.equal(R.classifyStatus(429), 'rate_limited');
  assert.notEqual(R.classifyStatus(429), 'not_found');
});
t('401 and 403 classify as auth, separately from 404', () => {
  assert.equal(R.classifyStatus(401), 'auth');
  assert.equal(R.classifyStatus(403), 'auth');
  assert.equal(R.classifyStatus(404), 'not_found');
});

await (async () => {
  let calls = 0;
  const out = await R.withBoundedRetry(async () => { calls++; return calls < 3 ? res(503) : res(200); },
    { deadlineMs: 5000, maxAttempts: 4, sleep: async () => {} });
  t('transient 5xx is retried then succeeds', () => {
    assert.equal(out.ok, true); assert.equal(calls, 3);
  });

  calls = 0;
  const perm = await R.withBoundedRetry(async () => { calls++; return res(404); },
    { deadlineMs: 5000, maxAttempts: 4, sleep: async () => {} });
  t('permanent 404 returns immediately without burning retries', () => {
    assert.equal(perm.ok, false); assert.equal(perm.permanent, true);
    assert.equal(perm.class, 'not_found'); assert.equal(calls, 1);
  });

  calls = 0;
  const rl = await R.withBoundedRetry(async () => { calls++; return res(429, { 'retry-after': '1' }); },
    { deadlineMs: 5000, maxAttempts: 3, sleep: async () => {} });
  t('429 honours Retry-After and is NOT treated as permanent', () => {
    assert.equal(rl.ok, false); assert.equal(rl.permanent, false);
    assert.equal(calls, 3, 'rate limiting is retried within the budget');
    assert.ok(rl.attempts.every((a) => a.class !== 'not_found'));
  });

  let t0 = 0;
  const now = () => t0;
  const slow = await R.withBoundedRetry(async () => { t0 += 3000; return res(503); },
    { deadlineMs: 4000, maxAttempts: 9, now, sleep: async () => {} });
  t('retries never exceed the scan deadline', () => {
    assert.equal(slow.ok, false);
    assert.ok(slow.attempts.length <= 3, `attempts=${slow.attempts.length}`);
  });

  calls = 0;
  const auth = await R.withBoundedRetry(async () => { calls++; return res(403); },
    { deadlineMs: 5000, maxAttempts: 4, sleep: async () => {} });
  t('auth failure is permanent and reported separately', () => {
    assert.equal(auth.class, 'auth'); assert.equal(calls, 1);
  });
})();

console.log('\ncache versioning');
t('cache keys are namespaced by schema version', () => {
  assert.equal(R.versionedCacheKey('pkmn|base1|4'), 'idv2:pkmn|base1|4');
});
t('pre-correction cache entries cannot be served', () => {
  assert.equal(R.isCurrentCacheEntry({ name: 'Ivysaur' }), false, 'unversioned entry rejected');
  assert.equal(R.isCurrentCacheEntry({ schemaVersion: 1 }), false, 'older schema rejected');
  assert.equal(R.isCurrentCacheEntry(R.stampCacheEntry({ name: 'Ivysaur' })), true);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
