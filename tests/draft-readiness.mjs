/* ═══════════════════════════════════════════════════════════
   D2.1 — readiness on every draft list row
   Contract: audit/DRAFT_LIST_API_CONTRACT.md §1.2, Part 4 cases 10, 12, 13
   ═══════════════════════════════════════════════════════════ */

import { readinessOf } from '../api/_draftService.js';
import { validateDraftForSlot, SLOT_RULES, VIOLATION } from '../api/_draftStore.js';

let FAIL = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log(`  PASS  ${name}`); }
  else { console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); FAIL = 1; }
};

const base = (over = {}) => ({
  draftId: 'd_test', sku: 'sku_test', instanceId: 'i_test',
  slot: 'ebay:fixed-price', status: 'draft', rev: 1,
  title: 'Charizard Base Set Holo', price: 250, quantity: 1,
  priceSource: 'consensus', packet: { source: 'test' },
  createdAt: 1, updatedAt: 1, ...over,
});

console.log('\nCase 10 — readiness present and correctly typed on every row');
{
  // A publishable draft, and one of each blocking kind.
  const cases = [
    ['publishable', base()],
    ['unpriced', base({ price: null, priceSource: undefined, packet: undefined })],
    ['zero price', base({ price: 0 })],
    ['unknown slot', base({ slot: 'nosuch:slot' })],
    ['over-long title', base({ title: 'x'.repeat(400) })],
    ['no provenance', base({ priceSource: 'unknown', packet: undefined })],
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

console.log(FAIL ? '\nRESULT: FAIL\n' : '\nRESULT: PASS\n');
process.exit(FAIL);
