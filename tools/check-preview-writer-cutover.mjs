import assert from 'node:assert/strict';
import { redisCommand as execute } from '../tests/_idRedis.mjs';
import { installPreviewWriterFence, CUTOVER_AUDIT, CUTOVER_TIME } from './install-preview-writer-fence.mjs';
import { MEMBERSHIP_LEGACY_FENCE, guardLegacyCommand } from '../api/_membershipLegacyFence.js';
const env = {
  MEMBERSHIP_PREVIEW_CUTOVER_COMMIT: 'a'.repeat(40), VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
  VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/launch-membership-v2',
  MEMBERSHIP_STRIPE_TEST_ACCOUNT: 'acct_1Tno55FW2YZoedIZ',
  MEMBERSHIP_STRIPE_TEST_RETURN_ORIGIN: 'https://cardresell-membership-v2-preview.vercel.app',
};
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
const clear = () => execute(['DEL', MEMBERSHIP_LEGACY_FENCE, CUTOVER_AUDIT, CUTOVER_TIME]);
await test('unarmed build makes no calls', async () => {
  assert.deepEqual(await installPreviewWriterFence({ env: {}, execute: () => assert.fail() }), { status: 'not_armed' });
});
for (const delta of [
  { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'development' },
  { VERCEL_GIT_COMMIT_REF: 'main' }, { VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40) },
  { MEMBERSHIP_PREVIEW_CUTOVER_COMMIT: 'invalid' }, { MEMBERSHIP_STRIPE_TEST_ACCOUNT: 'acct_other' },
  { MEMBERSHIP_STRIPE_TEST_RETURN_ORIGIN: 'https://www.cardresell.org' },
  { MEMBERSHIP_PURCHASE_TEST_MODE: 'enabled' }, { MEMBERSHIP_BILLING_V2: 'on' },
]) await test('wrong scope refuses before datastore access: ' + Object.keys(delta)[0], async () => {
  await assert.rejects(() => installPreviewWriterFence({ env: { ...env, ...delta }, execute: () => assert.fail() }));
});
await test('concurrent builders install exactly one fence and preserve financial bytes', async () => {
  await execute(['SET', 'scans:owner:id_paid_left', '9007199254740990']);
  await execute(['SET', 'pro:owner', '{"preserve":[]}']);
  const results = await Promise.all(Array.from({ length: 10 }, () => installPreviewWriterFence({ env, execute })));
  assert.equal(results.filter(r => r.status === 'installed').length, 1);
  assert.equal(results.filter(r => r.status === 'replayed').length, 9);
  assert.deepEqual(await execute(['MGET', 'scans:owner:id_paid_left', 'pro:owner']), ['9007199254740990', '{"preserve":[]}']);
  assert.equal(await execute(['TTL', MEMBERSHIP_LEGACY_FENCE]), -1);
});
await test('protected old writer is denied after cutover', async () => {
  await assert.rejects(() => execute(guardLegacyCommand(['INCR', 'scans:owner:id_paid_left'])));
  assert.equal(await execute(['GET', 'scans:owner:id_paid_left']), '9007199254740990');
});
await test('lost install acknowledgment replays exact audit without reset', async () => {
  await clear();
  let lost = false;
  await assert.rejects(() => installPreviewWriterFence({ env, execute: async args => {
    const result = await execute(args); if (!lost) { lost = true; throw Error('lost'); } return result;
  } }));
  const before = await execute(['MGET', MEMBERSHIP_LEGACY_FENCE, CUTOVER_AUDIT, CUTOVER_TIME]);
  assert.equal((await installPreviewWriterFence({ env, execute })).status, 'replayed');
  assert.deepEqual(await execute(['MGET', MEMBERSHIP_LEGACY_FENCE, CUTOVER_AUDIT, CUTOVER_TIME]), before);
});
for (const [key, value] of [[MEMBERSHIP_LEGACY_FENCE, '1'], [CUTOVER_AUDIT, '{}'], [CUTOVER_TIME, '1']]) {
  await test('partial/conflicting state is never repaired by guessing: ' + key, async () => {
    await clear(); await execute(['SET', key, value]);
    const before = await execute(['MGET', MEMBERSHIP_LEGACY_FENCE, CUTOVER_AUDIT, CUTOVER_TIME]);
    await assert.rejects(() => installPreviewWriterFence({ env, execute }));
    assert.deepEqual(await execute(['MGET', MEMBERSHIP_LEGACY_FENCE, CUTOVER_AUDIT, CUTOVER_TIME]), before);
  });
}
await test('expiring fence rejects exact replay', async () => {
  await clear(); await installPreviewWriterFence({ env, execute });
  await execute(['EXPIRE', MEMBERSHIP_LEGACY_FENCE, 600]);
  await assert.rejects(() => installPreviewWriterFence({ env, execute }));
});
console.log(`${passed} passed, 0 failed`);
process.exit(0);
