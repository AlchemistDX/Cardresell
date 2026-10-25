// Actual adapter with documented provider-shaped responses; no paid/network calls.
import assert from 'node:assert/strict';
import { identifyWithXimilar } from '../api/_ximilar.js';
const original = { fetch, log: console.log, warn: console.warn };
let passed = 0, failed = 0;
const card = (changes = {}) => ({ name: 'Card', _tags: { Subcategory: [{ name: 'Pokemon' }] },
  _identification: { best_match: { name: 'Pikachu', subcategory: 'Pokemon', set: 'Base Set', card_number: '58' },
    alternatives: [], distances: [0.1] }, ...changes });
const match = (changes = {}) => card({ _tags: {}, _identification: {
  best_match: { name: 'Lightning Bolt', subcategory: 'Magic The Gathering', set: 'Magic 2010', set_code: 'M10', card_number: '146', ...changes },
  alternatives: [], distances: [0.1],
} });
async function run(objects, { kind = 'tcg', status = 200 } = {}) {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, `https://api.ximilar.com/collectibles/v2/${kind}_id`);
    assert.deepEqual(JSON.parse(init.body), { records: [{ _base64: 'unchanged-fixture' }], ...(kind === 'tcg' ? { rotate: true } : {}) });
    return Response.json({ records: [{ _status: { code: status }, _objects: objects }] });
  };
  const result = await identifyWithXimilar('unchanged-fixture', 'image/jpeg', 'test-token', kind);
  assert.equal(calls, 1, 'no hidden retry or analyze_all charge');
  return result;
}
async function test(label, fn) {
  try { await fn(); passed++; } catch (e) { failed++; original.log(`FAIL ${label}: ${e.message}`); }
}
try {
  console.log = () => {}; console.warn = () => {};
  await test('Magic catalog category survives absent object tag', async () => {
    const r = await run([match()]); assert.equal(r.ok, true); assert.equal(r.cardInfo.card_type, 'mtg');
  });
  await test('catalog game wins over conflicting visual tag', async () => {
    const c = match(); c._tags = { Subcategory: [{ name: 'Pokemon' }] };
    assert.equal((await run([c])).cardInfo.card_type, 'mtg');
  });
  for (const game of [undefined, 'Dragon Ball Super']) await test(`unknown game ${game} is not Pokemon`, async () => {
    const c = match({ subcategory: game }); const r = await run([c]);
    assert.equal(r.ok, false); assert.equal(r.reason, 'unsupported_card_type');
  });
  for (const [game, expected] of [['Pokémon Japanese', 'pokemon'], ['MTG', 'mtg'], ['Yu-Gi-Oh!', 'yugioh'], ['Disney Lorcana', 'lorcana'], ['One Piece', 'onepiece']]) {
    await test(`game alias ${game}`, async () => assert.equal((await run([match({ subcategory: game })])).cardInfo.card_type, expected));
  }
  await test('object tag remains a supported fallback', async () => {
    const c = match({ subcategory: undefined }); c._tags = { Subcategory: [{ name: 'Magic The Gathering' }] };
    assert.equal((await run([c])).cardInfo.card_type, 'mtg');
  });
  await test('slab label first cannot impersonate card', async () => {
    const label = card({ name: 'Slab Label', _identification: { best_match: { name: 'LABEL ONLY' }, distances: [0] } });
    assert.equal((await run([label, match()])).cardInfo.card_name, 'Lightning Bolt');
    assert.equal((await run([label])).reason, 'no_card_detected');
  });
  await test('multiple identified cards require a single-card crop', async () => {
    const r = await run([match(), card()]); assert.equal(r.ok, false); assert.equal(r.reason, 'multiple_cards');
  });
  await test('one identified card plus an unrecognized card', async () => {
    assert.equal((await run([card({ _identification: {} }), match()])).cardInfo.card_type, 'mtg');
  });
  await test('record-level failure is a provider error', async () => {
    const r = await run([match()], { status: 503 }); assert.equal(r.ok, false); assert.equal(r.reason, 'record_error');
  });
  for (const bad of [-0.1, '0.1', null, undefined, NaN, Infinity]) await test(`invalid top distance ${String(bad)}`, async () => {
    const c = match(); c._identification.distances = [bad];
    const r = await run([c]); assert.equal(r.ok, false); assert.equal(r.reason, 'invalid_response');
  });
  for (const ds of [[0.1, -0.1], [0.2, 0.1], [0.1, '0.9'], [0.1]]) await test(`invalid alternative distances ${JSON.stringify(ds)}`, async () => {
    const c = match(); c._identification.alternatives = [{ ...c._identification.best_match, set: 'Other set' }]; c._identification.distances = ds;
    const r = await run([c]); assert.equal(r.ok, false); assert.equal(r.reason, 'invalid_response');
  });
  await test('candidate owns its distance; no uncalibrated percentage or photo-quality claim', async () => {
    const c = match(); c._identification.distances = [0.3, 0.4];
    c._identification.alternatives = [{ ...c._identification.best_match, set: 'Magic 2011' }];
    const r = await run([c]); assert.equal(r.needsPicker, true);
    assert.deepEqual(r.candidates.map(x => x._ximilar_dist), [0.3, 0.4]);
    assert.deepEqual(r.candidates.map(x => x.confidence), ['high', 'medium']);
    assert.ok(r.candidates.every(x => x.confidence_pct == null && x.image_quality === 'unknown'));
  });
  await test('sports documented fields are preserved', async () => {
    const c = match({ name: 'Jiri Prochazka', set: undefined, set_name: 'Chronicles', subcategory: 'MMA', company: 'Panini', year: 2021 });
    const r = await run([c], { kind: 'sport' });
    assert.equal(r.cardInfo.card_type, 'sports'); assert.equal(r.cardInfo.set_name, 'Chronicles');
    assert.equal(r.cardInfo.sport, 'MMA'); assert.equal(r.cardInfo.brand, 'Panini'); assert.equal(r.cardInfo.year, '2021');
  });
  for (const [d, expected] of [[0.349, 'high'], [0.35, 'medium'], [0.549, 'medium'], [0.55, 'low_confidence'], [0.9, 'low_confidence']]) await test(`unchanged threshold ${d}`, async () => {
    const c = match(); c._identification.distances = [d]; const r = await run([c]);
    assert.equal(r.ok ? r.cardInfo.confidence : r.reason, expected);
  });
} finally { globalThis.fetch = original.fetch; console.log = original.log; console.warn = original.warn; }
console.log(`ximilar-contract: ${passed} passed, ${failed} failed -- SUITE COMPLETE, exit=${failed ? 1 : 0}`);
process.exitCode = failed ? 1 : 0;
