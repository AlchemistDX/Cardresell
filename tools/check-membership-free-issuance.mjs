import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { redisCommand as execute } from '../tests/_idRedis.mjs';
import { createMembershipFreeIssuance } from '../api/_membershipFreeIssuance.js';
import { membershipEnrollmentKey } from '../api/_membershipConsumption.js';
import { membershipIncludedHistoryKey } from '../api/_membershipLedger.js';
const hash = x => createHash('sha256').update(x).digest('hex');
const issue = createMembershipFreeIssuance({ execute });
const now = Number((await execute(['TIME']))[0]), d = new Date(now * 1000);
const current = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 1) / 1000;
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
async function seed(owner, more = {}) {
  await execute(['SET', 'membership:launch-v2:legacy_fence', '1']);
  await execute(['SET', membershipEnrollmentKey(owner), JSON.stringify({
    version: 'launch-v2', owner, verified: true, plan: 'free', freeThrough: 0,
    freeEligibleFrom: start, capabilities: { bulkGrade: false },
    preserved: { empty: [], number: 9007199254740990 }, ...more,
  })]);
}
await test('three inactive months issued exactly once', async () => {
  await seed('inactive');
  assert.equal((await issue('inactive')).allocations, 3);
  assert.equal((await issue('inactive')).allocations, 0);
  const h = JSON.parse(await execute(['GET', membershipIncludedHistoryKey('inactive')]));
  assert.equal(h.count, 3);
  const records = await Promise.all(h.periods.map(k => execute(['GET', k]).then(JSON.parse)));
  assert.equal(records.reduce((s, r) => s + r.id_grant, 0), 15);
  assert.equal(records.reduce((s, r) => s + r.grade_grant, 0), 3);
});
await test('preserved fields and legacy counters remain exact', async () => {
  await execute(['SET', 'scans:inactive:id_paid_left', '129']);
  await issue('inactive');
  assert.equal(await execute(['GET', 'scans:inactive:id_paid_left']), '129');
  const e = JSON.parse(await execute(['GET', membershipEnrollmentKey('inactive')]));
  assert.deepEqual(e.preserved, { empty: [], number: 9007199254740990 });
});
await test('competing issuers do not double grant', async () => {
  await seed('competing');
  const results = await Promise.all(Array.from({ length: 6 }, () => issue('competing')));
  assert.equal(results.reduce((s, r) => s + r.allocations, 0), 3);
});
await test('missing initialized history rejects', async () => {
  await execute(['DEL', membershipIncludedHistoryKey('inactive')]);
  await assert.rejects(() => issue('inactive'));
});
await test('missing issued allocation rejects without recreation', async () => {
  const key = `membership:launch-v2:free_period:${hash('competing')}:${start}`;
  await execute(['DEL', key]);
  await assert.rejects(() => issue('competing'));
  assert.equal(await execute(['GET', key]), null);
});
await test('absent baseline is not guessed', async () => {
  await seed('unknown', { freeEligibleFrom: undefined });
  assert.equal((await issue('unknown')).status, 'baseline_required');
  assert.equal(await execute(['GET', membershipIncludedHistoryKey('unknown')]), null);
});
await test('paid enrollment is never awarded Free catch-up', async () => {
  await seed('paid', { plan: 'paid', subscription: 'sub_synthetic' });
  assert.equal((await issue('paid')).status, 'paid');
  assert.equal(await execute(['GET', membershipIncludedHistoryKey('paid')]), null);
});
await test('future eligibility rejects', async () => {
  await seed('future', { freeEligibleFrom: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000 });
  await assert.rejects(() => issue('future'));
});
await test('missing fence denies all writes', async () => {
  await seed('fenced');
  await execute(['DEL', 'membership:launch-v2:legacy_fence']);
  await assert.rejects(() => issue('fenced'));
  assert.equal(await execute(['GET', membershipIncludedHistoryKey('fenced')]), null);
});
await test('new enrollment only gets baseline month', async () => {
  await seed('new', { freeEligibleFrom: current });
  assert.equal((await issue('new')).allocations, 1);
});
console.log(`${passed} passed, 0 failed`);
process.exit(0);
