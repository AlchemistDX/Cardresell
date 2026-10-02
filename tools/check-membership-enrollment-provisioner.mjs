import assert from 'node:assert/strict';
import { redisCommand } from '../tests/_idRedis.mjs';
import { withManagedNullArrayLoss } from './_managedNullArrayTransport.mjs';
const execute = withManagedNullArrayLoss(redisCommand);
import { createMembershipEnrollmentProvisioner } from '../api/_membershipEnrollmentProvisioner.js';
import { createMembershipBootstrap, membershipBootstrapAuditKey } from '../api/_membershipBootstrap.js';
import { createMembershipFreeIssuance } from '../api/_membershipFreeIssuance.js';
import { membershipEnrollmentKey } from '../api/_membershipConsumption.js';
const accountId = 'acct_synthetic';
const provision = createMembershipEnrollmentProvisioner({ execute, accountId, environment: 'preview',
  allowedOwners: ['newOwner', 'legacyOwner', 'unfenced', 'orphan'] });
const bootstrap = createMembershipBootstrap({ execute, accountId });
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
await test('Production provisioning refused', async () => {
  assert.throws(() => createMembershipEnrollmentProvisioner({ execute, accountId, environment: 'production', allowedOwners: [] }));
});
await test('nonallowlisted owner refused', async () => assert.rejects(() => provision('other')));
await test('unfenced provisioning creates nothing', async () => {
  await assert.rejects(() => provision('unfenced'));
  assert.equal(await execute(['GET', membershipBootstrapAuditKey('unfenced')]), null);
});
await execute(['SET', 'membership:launch-v2:legacy_fence', '1']);
await test('legacy subscription requires separate migration', async () => {
  await execute(['SET', 'pro:legacyOwner', '{"subscriptionId":"sub_old"}']);
  await assert.rejects(() => provision('legacyOwner'));
  assert.equal(await execute(['GET', membershipBootstrapAuditKey('legacyOwner')]), null);
});
await test('concurrent provisioning creates one audit and preserves legacy balances', async () => {
  await execute(['SET', 'scans:newOwner:id_paid_left', '89']);
  await execute(['SET', 'signup_bonus:newOwner', 'historical']);
  const results = await Promise.all(Array.from({ length: 6 }, () => provision('newOwner')));
  assert.equal(results.filter(r => r.status === 'audit_created').length, 1);
  assert.equal(await execute(['GET', 'scans:newOwner:id_paid_left']), '89');
  assert.equal(await execute(['GET', 'signup_bonus:newOwner']), 'historical');
});
await test('audited new owner enrolls and receives one baseline allocation', async () => {
  assert.equal((await bootstrap('newOwner')).status, 'enrolled');
  const issue = createMembershipFreeIssuance({ execute });
  assert.equal((await issue('newOwner')).allocations, 1);
  assert.equal((await issue('newOwner')).allocations, 0);
});
await test('repeat enrollment preserves paid record bytes', async () => {
  const paid = '{"version":"launch-v2","owner":"newOwner","verified":true,"plan":"paid","subscription":"sub_test","preserved":[]}';
  await execute(['SET', membershipEnrollmentKey('newOwner'), paid]);
  await provision('newOwner');
  await bootstrap('newOwner');
  assert.equal(await execute(['GET', membershipEnrollmentKey('newOwner')]), paid);
});
await test('orphan enrollment cannot create a replacement audit', async () => {
  await execute(['SET', membershipEnrollmentKey('orphan'), '{}']);
  await assert.rejects(() => provision('orphan'));
});
await test('explicit public live provisioning binds a new audit to live mode', async () => {
  const publicProvision = createMembershipEnrollmentProvisioner({
    execute, accountId, environment: 'production', livemode: true,
    allowedOwners: [], allowNewOwners: true,
  });
  assert.equal((await publicProvision('publicOwner')).status, 'audit_created');
  const audit = JSON.parse(await execute(['GET', membershipBootstrapAuditKey('publicOwner')]));
  assert.equal(audit.owner, 'publicOwner');
  assert.equal(audit.accountId, accountId);
  assert.equal(audit.livemode, true);
  assert.equal((await publicProvision('publicOwner')).status, 'existing_audit');
  await assert.rejects(() => publicProvision('legacyOwner'));
  assert.equal(await execute(['GET', membershipBootstrapAuditKey('legacyOwner')]), null);
  assert.equal(await execute(['GET', 'pro:legacyOwner']), '{"subscriptionId":"sub_old"}');
});
console.log(`${passed} passed, 0 failed`);
process.exit(0);
