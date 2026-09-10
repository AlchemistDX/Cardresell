/* ═══════════════════════════════════════════════════════════
   D2.1 — readiness on every draft list row
   Contract: audit/DRAFT_LIST_API_CONTRACT.md §1.2, Part 4 cases 10, 12, 13
   ═══════════════════════════════════════════════════════════ */

import { completionGuard } from './_complete.mjs';
const { finish: _finish } = completionGuard('draft-readiness');

import { readinessOf } from '../api/_draftService.js';
import { validateDraftForSlot, SLOT_RULES, VIOLATION, PRICE_SOURCES } from '../api/_draftStore.js';
import { packetInputFingerprint } from '../api/_listingPacket.js';

let FAIL = 0, PASSCOUNT = 0;
const ok = (name, cond, detail) => {
  if (cond) { PASSCOUNT++; console.log(`  PASS  ${name}`); }
  else { console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); FAIL++; }
};

/* `packetInputs` is computed from the finished row with the production
 * fingerprint rather than written as a literal. A literal would be a second
 * implementation of the fingerprint format living in a test, and it would go
 * stale silently the first time a field joined PACKET_INPUT_FIELDS. The
 * fingerprint here is fixture construction -- it makes the row look like one a
 * writer actually produced -- not the thing under assertion. */
const base = (over = {}) => withFingerprint({
  draftId: 'd_test', sku: 'sku_test', instanceId: 'i_test',
  slot: 'ebay:fixed-price', status: 'draft', rev: 1,
  title: 'Charizard Base Set Holo', price: 250, quantity: 1,
  // 'comp' not 'consensus'. PRICE_SOURCES is {seller, comp, venue}
  // (api/_draftStore.js:159-164) and create REFUSES anything else
  // (:479-483), so a fixture priced from 'consensus' was describing a draft
  // the store would never persist. Nothing failed, because readinessOf and
  // validateDraftForSlot read the field without validating it -- so the
  // fixture could hold an unpersistable value indefinitely.
  priceSource: 'comp', packet: { packetSchemaVersion: 1, source: 'test' },
  createdAt: 1, updatedAt: 1, ...over,
});

/* Attach the input fingerprint a writer would have stored, AFTER overrides are
 * applied -- base({price: 999}) must fingerprint 999, or the fixture would
 * describe a packet that does not cover its own row. */
function withFingerprint(row) {
  if (!Object.prototype.hasOwnProperty.call(row, 'packet') || row.packet == null) return row;
  return { ...row, packetInputs: packetInputFingerprint(row) };
}

/* WHY THIS EXISTS
 *
 * The provenance gate is `!hasOwnProperty(draft, 'packet')`
 * (api/_draftStore.js:305). `base({ packet: undefined })` does NOT satisfy it:
 * the spread writes the key with an undefined value, so the key is still
 * PRESENT and the whole provenance branch is skipped.
 *
 * The fixture that used to be labelled 'no provenance' was built that way and
 * produced ZERO violations. It asserted nothing about provenance for as long
 * as it existed, and it could not go red, because the row it fed only had to
 * be a draft with a well-typed `readiness` -- which it was.
 *
 * Deleting the key is the only way to reach the state. Case 15 below is the
 * negative control that keeps this honest. */
const noPacket = (over = {}) => {
  const d = base(over);
  delete d.packet;
  return d;
};

console.log('\nCase 10 — readiness present and correctly typed on every row');
{
  // A publishable draft, and one of each blocking kind.
  const cases = [
    ['publishable', base()],
    ['unpriced', noPacket({ price: null, priceSource: undefined })],
    ['zero price', base({ price: 0 })],
    ['unknown slot', base({ slot: 'nosuch:slot' })],
    ['over-long title', base({ title: 'x'.repeat(400) })],
    ['no provenance (comp, no packet)', noPacket({ priceSource: 'comp' })],
    ['seller-priced (no packet)', noPacket({ priceSource: 'seller' })],
  ];
  for (const [label, d] of cases) {
    const r = readinessOf(d);
    ok(`${label}: readiness is an object`, r && typeof r === 'object');
    ok(`${label}: publishable is a boolean`, typeof r.publishable === 'boolean',
       `got ${typeof r.publishable}`);
    ok(`${label}: blockers is an array`, Array.isArray(r.blockers));
    for (const b of r.blockers) {
      // CHANGED IN D3 STEP 4: this asserted exactly 'code,message' and fired
      // when `field` was added. Kept as an EXACT key-set check rather than a
      // "has at least" check, because the point of the assertion is that the
      // wire shape is closed -- `severity`, `blocking` and `detail` must stay
      // off it, and a subset check would let all three back on silently.
      ok(`${label}: blocker has exactly {code,field,message}`,
         Object.keys(b).sort().join(',') === 'code,field,message',
         `got ${Object.keys(b).sort().join(',')}`);
      ok(`${label}: field is a non-empty string`,
         typeof b.field === 'string' && b.field.length > 0, `got ${JSON.stringify(b.field)}`);
      ok(`${label}: code is a non-empty string`,
         typeof b.code === 'string' && b.code.length > 0);
      ok(`${label}: message is a non-empty string`,
         typeof b.message === 'string' && b.message.length > 0);
    }
  }
}

console.log('\nCase 12 — derivation pin: readiness is derived, never recomputed');
{
  // Every slot, and a deliberately unpriced draft in each, so the comparison
  // covers publishable and blocked rows in both directions.
  const slots = [...Object.keys(SLOT_RULES), 'nosuch:slot'];
  for (const slot of slots) {
    for (const variant of [{}, { price: null, packet: undefined, priceSource: undefined },
                           { price: 0 }, { title: 'y'.repeat(500) }]) {
      const d = base({ slot, ...variant });
      const v = validateDraftForSlot(d);
      const r = readinessOf(d);
      ok(`${slot} ${JSON.stringify(variant).slice(0, 28)}: publishable === v.ok`,
         r.publishable === v.ok, `readiness ${r.publishable} vs validator ${v.ok}`);
      // THIS PIN CHANGED IN D3 STEP 4. It used to be
      //   ({ code: x.code, message: x.message })
      // and it fired, correctly, the moment `field` was added to the wire.
      //
      // Checked the adjacent question before touching it, per the standing
      // rule: is `readiness` still a pure projection of `v.blocking` with no
      // recomputation? Yes -- adding `field` makes it MORE of a projection,
      // because the field association now comes from the validator that
      // raised the finding instead of from a table the client would have had
      // to keep. The tripwire did its job by refusing to let the wire shape
      // change quietly; it is not being silenced.
      const expect = v.blocking.map((x) => ({ code: x.code, field: x.field, message: x.message }));
      ok(`${slot} ${JSON.stringify(variant).slice(0, 28)}: blockers === derivation`,
         JSON.stringify(r.blockers) === JSON.stringify(expect),
         `${JSON.stringify(r.blockers)} vs ${JSON.stringify(expect)}`);
    }
  }
}

console.log('\nCase 13 — source-text tripwire: copy stays server-owned');
{
  // If someone re-authors blocker copy anywhere but reasonMessage(), the
  // message on the wire stops matching the validator's message and this fails.
  // That is the whole point: the failure names the duplication.
  const d = base({ title: 'z'.repeat(120) });
  const v = validateDraftForSlot(d);
  const r = readinessOf(d);
  const vMsg = v.blocking.map((x) => x.message).join('|');
  const rMsg = r.blockers.map((x) => x.message).join('|');
  ok('message is passed through, not re-authored', vMsg === rMsg,
     `validator "${vMsg}" vs wire "${rMsg}"`);

  // TITLE_TOO_LONG's copy is computed. A client-side table cannot produce it,
  // which is the concrete reason the decision went the way it did.
  const titleBlocker = r.blockers.find((b) => b.code === VIOLATION.TITLE_TOO_LONG);
  ok('TITLE_TOO_LONG blocker is present', !!titleBlocker);
  if (titleBlocker) {
    ok('its message carries the computed length', /120/.test(titleBlocker.message),
       titleBlocker.message);
    ok('its message carries the slot maximum', /80/.test(titleBlocker.message),
       titleBlocker.message);
  }

  // The generic fallback must never reach a blocker row. It is correct copy for
  // an unclassified case and wrong copy for a known one.
  const generic = r.blockers.filter((b) => /This draft cannot be listed yet/.test(b.message));
  ok('no blocker falls through to the generic message', generic.length === 0,
     JSON.stringify(generic));
}

console.log('\nWire codes are the VIOLATION values, not the key names');
{
  // The keys and the values differ: VIOLATION.TITLE_TOO_LONG === 'SLOT_TITLE_TOO_LONG'.
  // A client matching on the key name silently matches nothing, and a row with a
  // real blocker renders as if it had none. Caught while writing this test, so
  // it is pinned here rather than trusted to memory.
  ok('TITLE_TOO_LONG value is prefixed',
     VIOLATION.TITLE_TOO_LONG === 'SLOT_TITLE_TOO_LONG', VIOLATION.TITLE_TOO_LONG);
  const wireValues = new Set(Object.values(VIOLATION));
  const samples = [
    base({ title: 'q'.repeat(300) }),
    base({ price: null, packet: undefined, priceSource: undefined }),
    base({ price: 0 }),
    base({ slot: 'nosuch:slot' }),
  ];
  for (const d of samples) {
    for (const b of readinessOf(d).blockers) {
      ok(`emitted code "${b.code}" is a declared VIOLATION value`,
         wireValues.has(b.code));
      ok(`emitted code "${b.code}" is not a bare key name`,
         !Object.keys(VIOLATION).includes(b.code));
    }
  }
}

console.log('\nOnly ERROR severity may block');
{
  const d = base({ price: null, packet: undefined, priceSource: undefined });
  const v = validateDraftForSlot(d);
  const r = readinessOf(d);
  ok('blocker count === validator error count', r.blockers.length === v.errors,
     `${r.blockers.length} vs ${v.errors}`);
  ok('publishable is false when errors exist', r.publishable === false);
}

console.log('\nCase 14 — the constancy argument, mechanised');
{
  /* WHY THIS CASE EXISTS
   *
   * Contract §1.2 excluded four keys from the blocker wire with one sentence:
   * they are "redundant on the wire, since every element of `v.blocking` is by
   * construction blocking and of error severity."
   *
   * That is a claim that a property is CONSTANT. And a constancy argument can
   * only license dropping keys that RECORD that property. `severity` and
   * `blocking` do. `field` varies per finding, so the sentence could not have
   * covered it -- and that is checkable without judgment, which is the point.
   * Four keys, one quantifier, two of them actually quantified over.
   *
   * So the reasoning is asserted rather than trusted. If `severity` or
   * `blocking` ever stops being constant over `v.blocking`, the justification
   * for omitting it is void and this fails. If `field` ever becomes constant,
   * that is worth knowing too -- it would mean the fixture set stopped
   * spanning the codes, so the case would be proving nothing.
   */
  const spanning = [
    base({ price: null, priceSource: undefined, packet: undefined }), // PRICE_REQUIRED
    base({ price: 0 }),                                              // ZERO_PRICE
    base({ slot: 'nosuch:slot' }),                                   // UNKNOWN_SLOT
    base({ title: 'x'.repeat(400) }),                                // TITLE_TOO_LONG
  ];
  const blocking = spanning.flatMap((d) => validateDraftForSlot(d, d.slot).blocking);
  const distinct = (k) => [...new Set(blocking.map((x) => JSON.stringify(x[k])))];

  ok('the fixture set spans all four blocking codes',
     distinct('code').length === 4, distinct('code').join(', '));

  // The two keys the sentence actually quantified over.
  ok('severity is constant over v.blocking, so omitting it is licensed',
     distinct('severity').length === 1, distinct('severity').join(', '));
  ok('blocking is constant over v.blocking, so omitting it is licensed',
     distinct('blocking').length === 1, distinct('blocking').join(', '));

  // The key the sentence was stretched over. This is the assertion that would
  // have refused the original edit.
  ok('field VARIES over v.blocking, so no constancy argument can omit it',
     distinct('field').length > 1, distinct('field').join(', '));

  // `detail` also varies, which is why its exclusion needed -- and has -- a
  // different stated reason: it is an internal diagnostic. Pinned so nobody
  // later re-files it under the constancy sentence by mistake.
  ok('detail also varies, so its exclusion rests on a different reason',
     distinct('detail').length > 1, distinct('detail').join(', '));
}

console.log('\nCase 15 — the fixtures reach the states they are named for');
{
  /* A fixture whose name asserts a condition it does not create is worse than
   * a missing fixture: it reads as coverage. This is the negative control on
   * the builder above -- if `noPacket` ever stops removing the key, or the
   * provenance gate changes shape, these fail instead of quietly passing.
   *
   * Found by scanning for wire keys and findings whose value cannot vary
   * across production-reachable states. The first thing that scan turned up
   * was not a wire key at all; it was this. */
  const codesOf = (d) => validateDraftForSlot(d, d.slot).violations.map((v) => v.code);

  /* CHANGED, and the old wording is kept here because it names the bug.
   *
   * This used to assert: "base() carries a packet KEY, so it makes no
   * provenance finding" -- and that was literally true of the gate, which was
   * `!hasOwnProperty(draft, 'packet')`. Key presence alone silenced the
   * finding, which meant `packet: { source: 'test' }` -- not a packet, no
   * schema version, no relation to the price -- counted as provenance for a
   * $250 price.
   *
   * The gate now requires the packet to COVER the row: a recorded input
   * fingerprint that still matches the draft's current price and title. So the
   * assertion is no longer about a key existing; it is about the snapshot
   * actually describing this price. The fixture had to gain a fingerprint to
   * keep reaching the state its name claims. */
  ok('base() carries a packet that COVERS its price, so it makes no provenance finding',
     Object.prototype.hasOwnProperty.call(base(), 'packet')
     && base().packetInputs === packetInputFingerprint(base())
     && !codesOf(base()).some((c) => c === VIOLATION.NO_PROVENANCE || c === VIOLATION.SELLER_PRICED));

  /* The new negative control, and the reason the change was worth making: a
   * packet whose recorded inputs no longer match the draft is not provenance.
   * Reprice the row without rebuilding the packet and the finding returns. */
  ok('a repriced draft whose packet was NOT rebuilt raises NO_PROVENANCE again',
     codesOf({ ...base(), price: 999 }).includes(VIOLATION.NO_PROVENANCE),
     JSON.stringify(codesOf({ ...base(), price: 999 })));

  ok('and a packet key with NO recorded inputs is not provenance either',
     codesOf((() => { const r = { ...base() }; delete r.packetInputs; return r; })())
       .includes(VIOLATION.NO_PROVENANCE));

  ok('noPacket() genuinely removes the key',
     !Object.prototype.hasOwnProperty.call(noPacket(), 'packet'));

  // The bug this case exists to refuse, pinned as a fact about JS rather than
  // a comment: assigning undefined is not deleting.
  ok('base({packet: undefined}) still HAS the key -- the old fixture bug',
     Object.prototype.hasOwnProperty.call(base({ packet: undefined }), 'packet'));

  ok("a comp-priced draft with no packet raises NO_PROVENANCE",
     codesOf(noPacket({ priceSource: 'comp' })).includes(VIOLATION.NO_PROVENANCE),
     JSON.stringify(codesOf(noPacket({ priceSource: 'comp' }))));

  ok("a seller-priced draft with no packet raises SELLER_PRICED",
     codesOf(noPacket({ priceSource: 'seller' })).includes(VIOLATION.SELLER_PRICED),
     JSON.stringify(codesOf(noPacket({ priceSource: 'seller' }))));

  // Both are non-blocking, which is the whole reason they cannot reach the
  // client. Asserted here so the claim in
  // audit/OPEN_NONBLOCKING_NOT_ON_THE_WIRE.md is not just prose.
  const nb = validateDraftForSlot(noPacket({ priceSource: 'comp' }), 'ebay:fixed-price');
  ok('NO_PROVENANCE is not in v.blocking, so readinessOf cannot carry it',
     !nb.blocking.some((x) => x.code === VIOLATION.NO_PROVENANCE));

  ok('base() priceSource is one the store would actually accept',
     PRICE_SOURCES.includes(base().priceSource), base().priceSource);
}

console.log(FAIL ? '\nRESULT: FAIL\n' : '\nRESULT: PASS\n');
_finish(PASSCOUNT, FAIL);

_finish(PASSCOUNT, FAIL);
