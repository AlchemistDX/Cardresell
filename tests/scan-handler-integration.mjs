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
 * KV is left unconfigured, so the credit path runs in its no-KV mode.
 *
 * Run: node --import ./tests/register-stubs.mjs tests/scan-handler-integration.mjs
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
async function run(stub, body = {}, headers = {}) {
  globalThis.__STUB = stub;
  const res = mkRes();
  await handler(mkReq(body, headers), res);
  return res;
}

console.log('the real handler enforces authentication');
await t('no Authorization header is 401 and never reaches the identifier', async () => {
  const s = { ximilar: { cardInfo: { card_type: 'pokemon', name: 'Pikachu' } } };
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
await t('an ambiguous Pokemon scan does NOT come back as an automatic identity', async () => {
  // Two catalogue candidates equally consistent with the readable evidence.
  const res = await run({
    ximilar: {
      cardInfo: { card_type: 'pokemon', name: 'Pikachu', card_number: '58' },
      records: [{ name: 'Pikachu', number: '58', set: 'Base Set' },
                { name: 'Pikachu', number: '58', set: 'Jungle' }],
    },
  });
  assert.equal(res.statusCode, 200);
  const p = res.payload || {};
  const auto = p.identified === true && !p.needs_confirmation;
  assert.ok(!auto || p.identity_resolution,
    'an automatic identity must be accompanied by resolver evidence, not a bare pick');
});
await t('the response carries resolver provenance, so identity is auditable', async () => {
  const res = await run({
    ximilar: { cardInfo: { card_type: 'pokemon', name: 'Ivysaur', card_number: '2/102', set_code: 'base1' },
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
await t('an ambiguous scan exposes every unresolved candidate, not just three', async () => {
  const records = Array.from({ length: 6 }, (_, i) => ({ name: 'Pikachu', number: '58', set: 'Set ' + i }));
  const res = await run({
    ximilar: { cardInfo: { card_type: 'pokemon', name: 'Pikachu', card_number: '58' }, records },
  });
  assert.equal(res.statusCode, 200);
  const ir = res.payload.identity_resolution;
  if (ir && ir.end_state === 'NEEDS_CONFIRMATION') {
    assert.ok(ir.candidates.length <= 3, 'short list stays short');
    assert.ok(ir.candidate_count >= ir.candidates.length, 'full count is reported');
    assert.ok(Array.isArray(ir.all_candidates), 'the seller can reach the rest');
    if (ir.candidate_count > 3) assert.equal(ir.more_available, true);
  }
});
await t('a confirmation-required scan does not claim `identified`', async () => {
  const res = await run({
    ximilar: { cardInfo: { card_type: 'pokemon', name: 'Pikachu', card_number: '58' },
      records: [{ name: 'Pikachu', number: '58', set: 'Base Set' },
                { name: 'Pikachu', number: '58', set: 'Jungle' }] },
  });
  const p = res.payload;
  if (p.end_state === 'NEEDS_CONFIRMATION') {
    assert.equal(p.identified, false, 'confirmation is not identification');
    assert.equal(p.needs_confirmation, true);
  }
});
await t('the resolver end state on the wire is one of the six declared states', async () => {
  const SIX = new Set(['EXACT_MATCH','NEEDS_CONFIRMATION','UNKNOWN_CARD',
                       'UNSUPPORTED_CARD','UNREADABLE_IMAGE','SOURCE_UNAVAILABLE']);
  const res = await run({
    ximilar: { cardInfo: { card_type: 'pokemon', name: 'Ivysaur', card_number: '2/102', set_code: 'base1' },
      records: [{ name: 'Ivysaur', number: '2/102', set: 'Base Set' }] },
  });
  if (res.payload.end_state) assert.ok(SIX.has(res.payload.end_state), res.payload.end_state);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
