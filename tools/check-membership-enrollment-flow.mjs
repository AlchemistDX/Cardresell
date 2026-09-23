import assert from 'node:assert/strict';
import { redisCommand as execute } from '../tests/_idRedis.mjs';
import { createMembershipEnrollmentProvisioner } from '../api/_membershipEnrollmentProvisioner.js';
import { createMembershipBootstrap } from '../api/_membershipBootstrap.js';
import { createMembershipFreeIssuance } from '../api/_membershipFreeIssuance.js';
import { createMembershipEnrollmentFlow } from '../api/_membershipEnrollmentFlow.js';
import { createMembershipConsumption, membershipEnrollmentKey } from '../api/_membershipConsumption.js';
import { membershipWelcomeKeys } from '../api/_membershipLedger.js';
const owners = ['fresh', 'historical', 'emailClaimed', 'lost', 'race', 'bad', 'paid'];
const accountId = 'acct_synthetic';
const provision = createMembershipEnrollmentProvisioner({ execute, accountId, environment: 'preview', allowedOwners: owners });
const bootstrap = createMembershipBootstrap({ execute, accountId });
const issueFree = createMembershipFreeIssuance({ execute });
const flow = createMembershipEnrollmentFlow({ execute, provision, bootstrap, issueFree });
const identity = uid => ({ uid, verified: true, email: uid + '@example.invalid' });
const balance = async (owner, mode = 'identify') => {
  const value = await createMembershipConsumption({ execute })('snapshot', {
    owner, mode, receipt: 'a'.repeat(64), scan: 'synthetic-read' });
  assert.equal(value.ok, true); return value;
};
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
await test('unverified or mismatched identity creates no audit or enrollment', async () => {
  await assert.rejects(() => flow('bad', { ...identity('bad'), verified: false }));
  await assert.rejects(() => flow('bad', identity('fresh')));
  assert.equal(await execute(['GET', membershipEnrollmentKey('bad')]), null);
});
await test('missing fence prevents enrollment and both awards', async () => {
  await assert.rejects(() => flow('fresh', identity('fresh')));
  assert.equal(await execute(['GET', membershipWelcomeKeys('fresh').id]), null);
});
await execute(['SET', 'membership:launch-v2:legacy_fence', '1']);
await test('new verified Free enrollment gets separate 5/1 monthly and 10/1 welcome', async () => {
  await flow('fresh', identity('fresh'));
  const id = await balance('fresh'), grade = await balance('fresh', 'grade');
  assert.deepEqual([id.monthly, id.welcome, grade.monthly, grade.welcome], [5, 10, 1, 1]);
});
await test('concurrent repeat enrollment never duplicates either allocation', async () => {
  await Promise.all(Array.from({ length: 4 }, () => flow('fresh', identity('fresh'))));
  assert.equal((await balance('fresh')).remaining, 15);
  assert.equal((await balance('fresh', 'grade')).remaining, 2);
});
await test('historical owner marker and mixed balances are preserved without reaward', async () => {
  await execute(['SET', 'signup_bonus:historical', 'legacy-claimed']);
  await execute(['SET', 'scans:historical:id_paid_left', '87']);
  await execute(['SET', 'scans:historical:paid_left', '14']);
  await flow('historical', identity('historical'));
  assert.equal(await execute(['GET', 'signup_bonus:historical']), 'legacy-claimed');
  assert.equal(await execute(['GET', 'scans:historical:id_paid_left']), '87');
  assert.equal(await execute(['GET', 'scans:historical:paid_left']), '14');
  assert.equal((await balance('historical')).welcome, 0);
});
await test('historical email marker suppresses award without binding identity by email', async () => {
  await execute(['SET', 'email_bonus_claimed:emailclaimed@example.invalid', 'prior']);
  await flow('emailClaimed', identity('emailClaimed'));
  assert.equal((await balance('emailClaimed')).welcome, 0);
});
await test('lost welcome acknowledgment recovers without second financial effect', async () => {
  let lost = false;
  const faulty = createMembershipEnrollmentFlow({ provision, bootstrap, issueFree,
    execute: async command => {
      const result = await execute(command);
      if (!lost && command[0] === 'EVAL') { lost = true; throw Error('synthetic response loss'); }
      return result;
    } });
  await assert.rejects(() => faulty('lost', identity('lost')));
  await flow('lost', identity('lost'));
  assert.equal((await balance('lost')).remaining, 15);
});
await test('concurrent paid authority blocks welcome at financial execution', async () => {
  const racing = createMembershipEnrollmentFlow({ execute, provision, bootstrap,
    issueFree: async owner => {
      const result = await issueFree(owner);
      const raw = JSON.parse(await execute(['GET', membershipEnrollmentKey(owner)]));
      await execute(['SET', membershipEnrollmentKey(owner), JSON.stringify({ ...raw, plan: 'paid', subscription: 'sub_race' })]);
      return result;
    } });
  await assert.rejects(() => racing('race', identity('race')));
  assert.equal(await execute(['GET', membershipWelcomeKeys('race').id]), null);
});
await test('paid enrollment remains byte-identical with no new welcome', async () => {
  await provision('paid'); await bootstrap('paid');
  const raw = JSON.parse(await execute(['GET', membershipEnrollmentKey('paid')]));
  const paid = JSON.stringify({ ...raw, plan: 'paid', subscription: 'sub_existing', preserved: [] });
  await execute(['SET', membershipEnrollmentKey('paid'), paid]);
  assert.equal((await flow('paid', identity('paid'))).status, 'paid_preserved');
  assert.equal(await execute(['GET', membershipEnrollmentKey('paid')]), paid);
  assert.equal(await execute(['GET', membershipWelcomeKeys('paid').id]), null);
});
console.log(`${passed} passed, 0 failed`);
process.exit(0);
