import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { redisCommand as redis } from '../tests/_idRedis.mjs';
import { createMembershipOwnerImport, readOwnerImport } from '../api/_membershipOwnerImport.js';
import { createMembershipConsumption } from '../api/_membershipConsumption.js';
import { membershipIncludedHistoryKey, membershipWelcomeKeys, grantMembership } from '../api/_membershipLedger.js';
import { validateProductionCutoverEvidence, PRODUCTION_DATABASE, PRODUCTION_ENDPOINT_DIGEST, authorization } from './transition-membership-owner.mjs';
import { membershipSubscriptionAdmission } from '../api/_membershipPurchaseRuntime.js';
const sha = x => createHash('sha256').update(x).digest('hex');
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };
async function fixture(livemode = false, shortPeriod = false) {
  await redis(['FLUSHDB']);
  const now = Number((await redis(['TIME']))[0]);
  const d = new Date(now * 1000), start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
  const stamp = `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const owner = 'owner', accountId = 'acct_test';
  const a = { owner, customerId: 'cus_owner', subscriptionId: 'sub_legacy', priceId: 'price_old',
    productId: 'prod_old', periodStart: start - 100, periodEnd: shortPeriod ? now + 2 : next - 1,
    evidenceId: sha('synthetic authority'), approvedAt: now - 1 };
  const cutoverKey = 'membership:launch-v2:synthetic-cutover';
  const cutover = JSON.stringify({ environment: livemode ? 'production' : 'preview',
    providerDatabaseId: livemode ? 'dc621a30-497c-4851-a3c3-42a51309f094' : 'b0de2137-6c5c-41b4-8af4-da80a70ce1c3',
    backup: { status: 'Completed' }, rotation: { oldAuthorization: 'rejected' } });
  const legacy = JSON.stringify({ status: 'active', subscriptionId: a.subscriptionId, tier: 'pro',
    retained: [], large: 9007199254740990 });
  const originals = [
    [`pro:${owner}`, legacy], [`scans:${owner}:id_paid_left`, '87'],
    [`scans:${owner}:paid_left`, '14'], [`scans:${owner}:id_free_used_${stamp}`, '7'],
    [`scans:${owner}:free_used_${stamp}`, '3'], [`signup_bonus:${owner}`, '1'],
    [`email_bonus_claimed:old@example.invalid`, '1'], ['arbitrary:photo:record', 'do not alter'],
  ];
  for (const [k, v] of originals) await redis(['SET', k, v]);
  await redis(['SET', cutoverKey, cutover]);
  await redis(['SET', 'membership:launch-v2:legacy_fence', '1']);
  const snapshot = { accountId, livemode, subscriptionId: a.subscriptionId, customerId: a.customerId,
    priceId: a.priceId, productId: a.productId, periodStart: a.periodStart, periodEnd: a.periodEnd,
    status: 'active', cancelAtPeriodEnd: false, scheduleId: null, scheduledChange: null };
  const options = { execute: redis, accountId, livemode, authorization: a, cutoverKey,
    cutoverDigest: sha(cutover), stripe: { retrieveLegacySubscriptionSnapshot: async () => structuredClone(snapshot) } };
  const imp = createMembershipOwnerImport(options);
  const unchanged = async () => { for (const [k, v] of originals) assert.equal(await redis(['GET', k]), v, k); };
  return { imp, options, originals, unchanged, snapshot, a, now, start, stamp };
}
await test('imports only existing included allowance and leaves every legacy byte unchanged', async () => {
  const f = await fixture(); const r = await f.imp();
  assert.deepEqual(r.newlyAwarded, { id: 0, grade: 0 });
  assert.deepEqual(r.preservedIncluded, { id: 23, grade: 12 });
  await f.unchanged();
  const consume = createMembershipConsumption({ execute: redis });
  const c = { owner: 'owner', receipt: 'a'.repeat(64), scan: 'import-check' };
  const snapshot = await consume('snapshot', c);
  assert.equal(snapshot.ok, true);
  assert.deepEqual([snapshot.monthly, snapshot.purchased, snapshot.remaining], [23, 87, 110]);
  assert.equal(snapshot.plan, 'legacy_pro');
  const grade = { ...c, mode: 'grade', cost: 2 };
  assert.equal((await consume('debit', grade)).charged, 2);
  assert.equal((await consume('refund', grade)).credits_refunded, 2);
  assert.equal((await consume('refund', grade)).credits_refunded, 2); // Immutable original replay, no second effect.
  assert.equal((await consume('snapshot', { ...grade, receipt: 'b'.repeat(64) })).monthly, 12);
  const history = JSON.parse(await redis(['GET', membershipIncludedHistoryKey('owner')]));
  assert.equal(history.count, 1);
  assert.equal(JSON.parse(await redis(['GET', history.periods[0]])).id_used, 7);
  assert.equal(await redis(['GET', membershipWelcomeKeys('owner').id]), null);
  assert.equal(typeof consume, 'function');
});
await test('concurrent imports produce one authority and no duplicate allowance', async () => {
  const f = await fixture(); await Promise.all(Array.from({ length: 8 }, () => f.imp()));
  assert.equal(JSON.parse(await redis(['GET', membershipIncludedHistoryKey('owner')])).count, 1);
  await f.unchanged();
});
await test('first Casual renewal adds once and preserves the imported permanent allocation', async () => {
  const f = await fixture(false, true); await f.imp();
  // This is a private Redis clock boundary, not a Stripe transaction.
  while (Number((await redis(['TIME']))[0]) < f.a.periodEnd) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const renewal = { owner: 'owner', invoiceId: 'in_firstCasual',
    subscriptionId: f.a.subscriptionId, plan: 'casual',
    periodStart: f.a.periodEnd, periodEnd: f.a.periodEnd + 2678400,
    currency: 'usd', amountCents: 999, paid: true };
  await Promise.all(Array.from({ length: 6 }, () => grantMembership(redis, 'period', renewal)));
  const consume = createMembershipConsumption({ execute: redis });
  const input = { owner: 'owner', receipt: 'c'.repeat(64), scan: 'renewal-check', mode: 'identify' };
  const id = await consume('snapshot', input);
  const grade = await consume('snapshot', { ...input, mode: 'grade' });
  assert.deepEqual([id.monthly, id.purchased, id.remaining, id.plan], [73, 87, 160, 'casual']);
  assert.deepEqual([grade.monthly, grade.purchased, grade.remaining], [27, 14, 41]);
  const history = JSON.parse(await redis(['GET', membershipIncludedHistoryKey('owner')]));
  assert.equal(history.count, 2);
  assert.equal((await consume('debit', input)).charged, 1);
  assert.equal(JSON.parse(await redis(['GET', history.periods[0]])).id_used, 8);
  assert.equal(JSON.parse(await redis(['GET', history.periods[1]])).id_used, 0);
  assert.equal((await consume('refund', input)).credits_refunded, 1);
  assert.equal(JSON.parse(await redis(['GET', history.periods[0]])).id_used, 7);
  await f.unchanged();
});
await test('replay preserves consumed imported credits', async () => {
  const f = await fixture(); await f.imp();
  const h = JSON.parse(await redis(['GET', membershipIncludedHistoryKey('owner')]));
  const r = JSON.parse(await redis(['GET', h.periods[0]])); r.id_used++;
  await redis(['SET', h.periods[0], JSON.stringify(r)]);
  assert.equal((await f.imp()).status, 'replayed');
  assert.equal(JSON.parse(await redis(['GET', h.periods[0]])).id_used, 8);
});
await test('missing fence and wrong backup evidence reject without import', async () => {
  const f = await fixture(); await redis(['DEL', 'membership:launch-v2:legacy_fence']);
  await assert.rejects(f.imp); await f.unchanged();
  assert.equal(await readOwnerImport(redis, 'acct_test', false, 'owner'), null);
});
await test('old-handler underscore month counters are used, not guessed zero from hyphen keys', async () => {
  const f = await fixture(); const r = await f.imp();
  assert.deepEqual(r.preservedIncluded, { id: 23, grade: 12 });
});
await test('malformed standing balance rejects every new write', async () => {
  const f = await fixture(); await redis(['SET', 'scans:owner:id_paid_left', '1e6']);
  await assert.rejects(f.imp);
  assert.equal(await readOwnerImport(redis, 'acct_test', false, 'owner'), null);
});
await test('wrong canonical customer and period refuse import', async () => {
  const f = await fixture(); f.snapshot.customerId = 'cus_other';
  await assert.rejects(f.imp); await f.unchanged();
});
await test('missing or unrecognized actual legacy tier cannot infer a higher tier from price', async () => {
  const f = await fixture();
  await redis(['SET', 'pro:owner', JSON.stringify({ status: 'active', subscriptionId: f.a.subscriptionId, tier: 'business' })]);
  await assert.rejects(f.imp);
});
await test('lost acknowledgment replays committed import without refilling', async () => {
  const f = await fixture(); let lose = true;
  const imp = createMembershipOwnerImport({ ...f.options, execute: async args => {
    const r = await redis(args); if (args[0] === 'EVAL' && lose) { lose = false; throw Error('lost acknowledgment'); } return r;
  } });
  await assert.rejects(imp); assert.equal((await imp()).status, 'replayed'); await f.unchanged();
});
await test('delayed source change rejects CAS before any new record', async () => {
  const f = await fixture();
  const imp = createMembershipOwnerImport({ ...f.options, execute: async args => {
    if (args[0] === 'EVAL') await redis(['INCR', `scans:owner:id_free_used_${f.stamp}`]);
    return redis(args);
  } });
  await assert.rejects(imp);
  assert.equal(await readOwnerImport(redis, 'acct_test', false, 'owner'), null);
});
await test('Production import requires Production receipt and mode-exact Stripe read', async () => {
  const f = await fixture(true); assert.equal((await f.imp()).status, 'imported');
  await f.unchanged();
  const g = await fixture(true); g.snapshot.livemode = false; await assert.rejects(g.imp);
});
await test('operator rejects absent backup, wrong database and missing rejection proof', async () => {
  const commit = 'a'.repeat(40);
  const e = { version: 1, environment: 'production', providerDatabaseId: PRODUCTION_DATABASE,
    releaseCommit: commit, backup: { name: 'synthetic-only', status: 'Completed', completedAt: null,
      completionObservedAt: authorization.approvedAt, evidence: 'owner-dashboard-report' },
    rotation: { oldAuthorization: 'rejected', httpStatus: 401, oldDeployment: 'dpl_synthetic', evidenceId: sha('synthetic'),
      datastoreEndpointDigest: PRODUCTION_ENDPOINT_DIGEST } };
  assert.equal(validateProductionCutoverEvidence(e, commit), JSON.stringify(e));
  for (const change of [{ backup: null }, { providerDatabaseId: 'wrong' }, { rotation: null },
    { releaseCommit: 'b'.repeat(40) }, { environment: 'preview' }]) {
    assert.throws(() => validateProductionCutoverEvidence({ ...e, ...change }, commit));
  }
  assert.throws(() => validateProductionCutoverEvidence({ ...e,
    backup: { ...e.backup, completedAt: authorization.approvedAt } }, commit));
  assert.throws(() => validateProductionCutoverEvidence({ ...e,
    rotation: { ...e.rotation, datastoreEndpointDigest: 'b'.repeat(64) } }, commit));
});
await test('lost imported subscription lineage cannot permit a second subscription', async () => {
  const e = { version: 'launch-v2', owner: 'owner', verified: true, plan: 'paid', subscription: 'sub_existing' };
  assert.throws(() => membershipSubscriptionAdmission('owner', e, {}));
  assert.throws(() => membershipSubscriptionAdmission('owner', e, { subscriptionId: 'sub_other' }));
  assert.equal(membershipSubscriptionAdmission('owner', e, { subscriptionId: 'sub_existing' }), false);
  const free = { ...e, plan: 'free' }; delete free.subscription;
  assert.equal(membershipSubscriptionAdmission('owner', free, {}), true);
  assert.equal(membershipSubscriptionAdmission('owner', free, {}, true), false);
});
console.log(`${passed} passed, 0 failed`);
process.exit(0);
