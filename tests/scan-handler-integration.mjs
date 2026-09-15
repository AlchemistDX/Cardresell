/* Integration test for the REAL api/scan.js handler — work-order item 4.
 *
 * The earlier identity-wiring test called resolveIdentity() directly with
 * constructed candidates. It proved the module behaved; it did NOT prove
 * api/scan.js uses it, so the handler could have kept picking candidates[0]
 * and the suite would still have passed.
 *
 * This file imports the actual default export of api/scan.js and drives it with
 * a fake req/res. External services are stubbed via tests/loader-stubs.mjs
 * (token verification, Ximilar, tier). The identity resolver is NOT stubbed.
 * Legacy identity cases run in no-KV mode. The billing cases below configure a
 * structural in-memory REST KV and run BOTH real scan/debit handlers.
 *
 * Run: node tests/scan-handler-integration.mjs
 *      (node --import ./tests/register-stubs.mjs tests/scan-handler-integration.mjs
 *       also works; the loader is registered once either way.)
 *
 * SELF-REGISTERING ON PURPOSE. This suite used to require the --import flag,
 * which the push gate's `suite()` helper cannot supply — it appends arguments
 * AFTER the script path, and --import must precede it. The consequence was
 * that the suite could not be registered in tests/run-all.sh at all, so it
 * sat outside the gate and only ran when invoked by hand. Registering the
 * hook in-file, before the handler is dynamically imported, is what puts it
 * inside the gate.
 */
import assert from 'node:assert/strict';

/* The handler bails to 503 when XIMILAR_API_TOKEN is unset, which would make
 * every test below pass for the wrong reason. Set a placeholder: the Ximilar
 * client is stubbed, so the value is never used and no request leaves the box.
 * KV is deliberately left unconfigured so the credit path runs in no-KV mode. */
process.env.XIMILAR_API_TOKEN = 'test-placeholder-not-a-credential';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
};

/* The ESM hook must be installed BEFORE api/scan.js is resolved, which is why
 * the handler import below is dynamic rather than static. */
if (!globalThis.__crStubsRegistered) {
  globalThis.__crStubsRegistered = true;
  const { register } = await import('node:module');
  register(new URL('./loader-stubs.mjs', import.meta.url));
}

const handler = (await import('../api/scan.js')).default;

function mkRes() {
  const res = { statusCode: null, payload: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.payload = o; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  return res;
}
const IMG = Buffer.from('fake-jpeg-bytes').toString('base64');
function mkReq(body = {}, headers = {}) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer ' + 'x'.repeat(40), ...headers },
    body: { imageBase64: IMG, mimeType: 'image/jpeg', mode: 'identify', ...body },
  };
}
/* Catalogue HTTP boundary.
 *
 * Ximilar returns the vision read; the CANDIDATE list that identity resolution
 * actually runs against comes from the catalogue API over fetch. That was not
 * stubbed, so the "ambiguous" fixtures never reached the resolver at all and
 * the old conditional assertions silently passed on an undefined end state.
 *
 * `__STUB.catalog` is served as a pokemontcg.io card page. Every other host is
 * refused, so a test can never quietly depend on the network.
 */
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url && url.url ? url.url : url);
  const stub = globalThis.__STUB || {};
  if (u.includes('api.pokemontcg.io')) {
    if (stub.catalogError) {
      return { ok: false, status: stub.catalogError, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ data: stub.catalog || [] }) };
  }
  if (u.includes('db.ygoprodeck.com')) {
    return { ok: true, status: 200, json: async () => ({ data: stub.ygo || [] }) };
  }
  throw new Error('integration test blocked an outbound request to ' + u);
};

async function run(stub, body = {}, headers = {}) {
  globalThis.__STUB = stub;
  const res = mkRes();
  await handler(mkReq(body, headers), res);
  return res;
}

/* pokemontcg.io card shape, so the real projection (set.id -> `set`) applies. */
const pk = (name, number, setId, setName) => ({
  id: `${setId}-${number}`, name, number,
  set: { id: setId, name: setName || setId },
});

console.log('the real handler enforces authentication');
await t('no Authorization header is 401 and never reaches the identifier', async () => {
  const s = { ximilar: { cardInfo: { card_type: 'pokemon', card_name: 'Pikachu' } } };
  const res = await run(s, {}, { authorization: '' });
  assert.equal(res.statusCode, 401);
  assert.equal(s.ximilarCalls, undefined, 'no scan was performed');
});
await t('an invalid token is 401', async () => {
  const res = await run({ token: { throw: 'bad signature' },
                          ximilar: { cardInfo: { card_type: 'pokemon' } } });
  assert.equal(res.statusCode, 401);
});
await t('a missing image is 400 before any identification', async () => {
  const s = { ximilar: { cardInfo: { card_type: 'pokemon' } } };
  const res = await run(s, { imageBase64: undefined });
  assert.equal(res.statusCode, 400);
  assert.equal(s.ximilarCalls, undefined, 'no credit-consuming work ran');
});

console.log('\nthe real handler routes identity through the resolver (item 3 wiring)');
await t('an ambiguous Pokemon scan is UNCONDITIONALLY a confirmation, not an automatic identity', async () => {
  // Assertions here are deliberately unconditional. The earlier version was
  //   assert.ok(!auto || p.identity_resolution)
  // which permitted an automatic answer as long as provenance came with it, and
  // guarded the rest behind `if (end_state === 'NEEDS_CONFIRMATION')` so a
  // handler returning the WRONG state passed without asserting anything.
  const res = await run({
    ximilar: { cardInfo: { card_type: 'pokemon', card_name: 'Pikachu', card_number: '58' } },
    catalog: [pk('Pikachu', '58', 'base1', 'Base Set'), pk('Pikachu', '58', 'jungle', 'Jungle')],
  });
  assert.equal(res.statusCode, 200);
  const p = res.payload || {};
  assert.equal(p.identified, false, 'ambiguity must never be reported as identified');
  assert.equal(p.needs_confirmation, true, 'the seller must be asked');
  assert.equal(p.end_state, 'NEEDS_CONFIRMATION');
  assert.equal(p.printing, null, 'no printing may be claimed');
  assert.ok(p.identity_resolution, 'provenance must be present');
});
await t('the response carries resolver provenance, so identity is auditable', async () => {
  const res = await run({
    ximilar: { cardInfo: { card_type: 'pokemon', card_name: 'Ivysaur', card_number: '2/102', set_code: 'base1' },
               records: [{ name: 'Ivysaur', number: '2/102', set: 'Base Set' }] },
  });
  assert.equal(res.statusCode, 200);
  const blob = JSON.stringify(res.payload);
  assert.ok(/identity_resolution|end_state|endState/i.test(blob),
    'handler must record which resolution stage produced the identity');
});

console.log('\noutage handling preserves the seller credit (item 7)');
await t('a provider outage returns 503 with a distinct code, not a refundable miss', async () => {
  const res = await run({ ximilar: { providerError: 'http_502' } });
  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.code, 'IDENTIFY_PROVIDER_UNAVAILABLE');
});
await t('an outage is NOT reported as an unidentified card', async () => {
  const res = await run({ ximilar: { providerError: 'network_timeout' } });
  assert.notEqual(res.statusCode, 200, 'a 200 unidentified body would bill as a recognition miss');
});
await t('a genuine miss is a clean unidentified 200, distinct from an outage', async () => {
  const res = await run({ ximilar: { miss: 'no_match' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.identified, false);
  assert.ok(!res.payload.code || res.payload.code !== 'IDENTIFY_PROVIDER_UNAVAILABLE');
});
await t('every non-success identify path refunds or never debits', async () => {
  // With no KV configured the handler cannot debit; assert it does not claim a
  // debit it cannot make, and that the outage path is not silently billed.
  for (const stub of [{ ximilar: { providerError: 'http_500' } },
                      { ximilar: { miss: 'no_card_detected' } }]) {
    const res = await run(stub);
    const blob = JSON.stringify(res.payload || {});
    assert.ok(!/credit_charged"\s*:\s*true/.test(blob),
      'a failed scan must not report a charged credit: ' + blob.slice(0, 160));
  }
});

console.log('\nseller confirmation flow reaches the client (items 2 and 4)');
await t('the SEVENTH candidate is reachable through the real handler', async () => {
  // The exact case the packet claimed and the code did not deliver: the target
  // sits in position 7, beyond the three-item short list. Asserted on the real
  // handler payload, unconditionally, and for that EXACT target.
  const catalog = Array.from({ length: 9 }, (_, i) => pk('Pikachu', '58', 'set' + i, 'Set ' + i));
  const TARGET_SET = 'set6';   // zero-indexed position 6 == the seventh candidate
  const res = await run({
    ximilar: { cardInfo: { card_type: 'pokemon', card_name: 'Pikachu', card_number: '58' } },
    catalog,
  });
  assert.equal(res.statusCode, 200);
  const p = res.payload;
  assert.equal(p.end_state, 'NEEDS_CONFIRMATION');
  assert.equal(p.identified, false);
  const ir = p.identity_resolution;
  assert.ok(ir, 'provenance must be present');
  assert.equal(ir.candidates.length, 3, 'the short list is exactly three');
  assert.equal(ir.candidate_count, 9, 'the complete candidate count is reported');
  assert.equal(ir.more_available, true);
  assert.equal(ir.all_candidates.length, 9, 'every candidate is serialized');
  const seventh = ir.all_candidates.find((c) => c.set === TARGET_SET);
  assert.ok(seventh, `the seventh candidate (${TARGET_SET}) must be reachable in all_candidates, got: `
    + JSON.stringify(ir.all_candidates.map((c) => c.set)));
  assert.ok(!ir.candidates.some((c) => c.set === TARGET_SET),
    'and it is genuinely beyond the short list, so this test would fail if only the short list were sent');
});
await t('the resolver end state on the wire is one of the six declared states', async () => {
  const SIX = new Set(['EXACT_MATCH','NEEDS_CONFIRMATION','UNKNOWN_CARD',
                       'UNSUPPORTED_CARD','UNREADABLE_IMAGE','SOURCE_UNAVAILABLE']);
  const res = await run({
    ximilar: { cardInfo: { card_type: 'pokemon', card_name: 'Ivysaur', card_number: '2/102', set_code: 'base1' } },
    catalog: [pk('Ivysaur', '2', 'base1', 'Base Set')],
  });
  assert.ok(res.payload.end_state, 'an end state must always be reported');
  assert.ok(SIX.has(res.payload.end_state), res.payload.end_state);
});
await t('REGRESSION: an absent candidate locator does not become an automatic identity', async () => {
  // Blocker 1 at the handler level: the observed set code is never agreed with.
  const res = await run({
    ximilar: { cardInfo: { card_type: 'pokemon', card_name: 'Charizard', set_code: 'base1' } },
    catalog: [{ id: 'x-4', name: 'Charizard' }],   // no set, no number: locator absent
  });
  assert.equal(res.statusCode, 200);
  assert.notEqual(res.payload.identified, true,
    'a candidate whose locator is merely absent must not produce an exact match');
});

console.log('\nstructural KV billing through real handlers (no no-KV escape hatch)');
const { billingHarness, ambiguous, exact, catalogue } = await import('./_scanBillingHarness.mjs');
for (const bucket of ['paid', 'free']) {
  await t(`${bucket}: confirmation refunds to net zero before success records or stats`, async () => {
    const h = billingHarness({ bucket });
    try {
      const r = await h.scan(ambiguous());
      assert.equal(r.statusCode, 200);
      assert.equal(r.payload.end_state, 'NEEDS_CONFIRMATION');
      assert.equal(r.payload.identified, false);
      assert.equal(r.payload.needs_confirmation, true);
      assert.equal(r.payload.grounded, false);
      assert.equal(r.payload.grounded_id, null);
      assert.equal(r.payload.printing, null);
      assert.equal(r.payload.scan_id, undefined, 'no claimable successful scan id');
      assert.equal(r.payload.identity_resolution.all_candidates.length, 9);
      assert.equal(h.net(), 0, 'the initial credit was actually restored');
      assert.ok(h.commands.some(c => c.cmd === (bucket === 'paid' ? 'decr' : 'incr')),
        'must exercise a real credit mutation, not no-KV mode');
      assert.ok(h.commands.some(c => c.cmd === 'set' && c.key.startsWith('scans:')),
        'refund must actually write the restored balance');
      assert.equal(h.commands.filter(c => c.key.startsWith('scan:')).length, 0);
      assert.equal(h.commands.filter(c => c.key.startsWith('stats:searches:')).length, 0);
      assert.equal(h.selections.length, 0);
      assert.deepEqual(h.outbound, []);
    } finally { h.restore(); }
  });
  await t(`${bucket}: cancel/abandon confirmation is net zero with no selection`, async () => {
    const h = billingHarness({ bucket });
    try {
      const r = await h.scan();
      assert.equal(r.payload.end_state, 'NEEDS_CONFIRMATION');
      // Cancel has no server endpoint: no pick request follows this response.
      assert.equal(h.net(), 0);
      assert.equal(h.selections.length, 0);
      assert.ok(![...h.store.keys()].some(k => /^(scan:|stats:searches:|draft)/.test(k)));
      assert.deepEqual(h.outbound, []);
    } finally { h.restore(); }
  });
  await t(`${bucket}: exact match costs one and writes one successful scan plus stats`, async () => {
    const h = billingHarness({ bucket });
    try {
      const r = await h.scan(exact());
      assert.equal(r.statusCode, 200);
      assert.equal(r.payload.end_state, 'EXACT_MATCH');
      assert.equal(r.payload.identified, true);
      assert.equal(r.payload.needs_confirmation, false);
      assert.equal(h.net(), 1);
      const records = h.commands.filter(c => c.cmd === 'set' && c.key.startsWith('scan:'));
      assert.equal(records.length, 1);
      assert.equal(records[0].key, `scan:${r.payload.scan_id}`);
      assert.equal(records[0].ex, '3600');
      const record = JSON.parse(records[0].value);
      assert.equal(record.consumed_amount, 1);
      assert.equal(record.consumed_from, bucket === 'paid' ? 'id_paid_left' : 'id_free');
      const stats = h.commands.filter(c => c.key.startsWith('stats:searches:'));
      assert.equal(stats.length, 2);
      assert.ok(stats.every(c => c.cmd === 'incr'));
      assert.deepEqual(h.outbound, []);
    } finally { h.restore(); }
  });
}
await t('confirmation then seventh-candidate selection costs ONE across both real handlers', async () => {
  const h = billingHarness();
  try {
    const r = await h.scan();
    assert.equal(r.payload.end_state, 'NEEDS_CONFIRMATION');
    assert.equal(h.net(), 0);
    const seventh = r.payload.identity_resolution.all_candidates[6];
    assert.equal(seventh.set, catalogue[6].set.id);
    const picked = await h.pick({ card_name: seventh.name, card_number: seventh.number, set_name: seventh.set });
    assert.equal(picked.statusCode, 200);
    assert.equal(picked.payload.ok, true);
    assert.equal(h.selections.length, 1);
    assert.equal(h.net(), 1, 'not double charged');
    assert.deepEqual(h.outbound, []);
  } finally { h.restore(); }
});
globalThis.fetch = realFetch;

/* The push gate judges an .mjs suite on THREE things: zero reported
 * failures, exit 0, AND this completion marker. A suite that dies before
 * its last assertion can still print a clean-looking count and exit 0, and
 * without the marker the runner records it as a failure rather than a pass.
 * Registering a suite in tests/run-all.sh therefore requires emitting it. */
console.log(`\nscan-handler-integration: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
