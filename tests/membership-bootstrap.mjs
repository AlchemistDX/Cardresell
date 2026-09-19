import assert from 'node:assert/strict';
import { redisCommand as execute } from './_idRedis.mjs';
import { createMembershipBootstrap, membershipBootstrapAuditKey } from '../api/_membershipBootstrap.js';
import { membershipEnrollmentKey } from '../api/_membershipConsumption.js';
let n = 0;
const check = x => { assert.ok(x); n++; };
const reject = async fn => { await assert.rejects(fn); n++; };
const owner = 'syntheticBootstrap', accountId = 'acct_synthetic';
const auditKey = membershipBootstrapAuditKey(owner), key = membershipEnrollmentKey(owner);
const bootstrap = createMembershipBootstrap({ execute, accountId });
const audit = { version: 1, owner, accountId, livemode: false, evidenceId: 'a'.repeat(64),
  legacyWritersDrained: true, verified: true, freeThrough: 1800000000, bulkGrade: false };
await reject(() => bootstrap(owner));
await execute(['SET', auditKey, JSON.stringify(audit)]);
await reject(() => bootstrap(owner));
check(await execute(['GET', key]) === null);
await execute(['SET', 'membership:launch-v2:legacy_fence', '1']);
await execute(['SET', `scans:${owner}:id_paid_left`, '123']);
await execute(['SET', `signup_bonus:${owner}`, 'historical-marker']);
const outcomes = await Promise.all(Array.from({ length: 10 }, () => bootstrap(owner)));
check(outcomes.filter(x => x.status === 'enrolled').length === 1);
check(outcomes.filter(x => x.status === 'replayed').length === 9);
check(JSON.parse(await execute(['GET', key])).freeThrough === audit.freeThrough);
check(await execute(['GET', `scans:${owner}:id_paid_left`]) === '123');
check(await execute(['GET', `signup_bonus:${owner}`]) === 'historical-marker');
// A replay must preserve subsequent paid enrollment byte-for-byte.
const paid = JSON.stringify({ version: 'launch-v2', owner, verified: true, plan: 'paid',
  subscription: 'sub_preserved', preserved: { empty: [], number: 9007199254740990 } });
await execute(['SET', key, paid]);
check((await bootstrap(owner)).status === 'replayed');
check(await execute(['GET', key]) === paid);
await execute(['SET', key, '{"owner":"other"}']);
await reject(() => bootstrap(owner));
await execute(['SET', key, paid]);
await execute(['SET', auditKey, JSON.stringify({ ...audit, freeThrough: 0 })]);
await reject(() => bootstrap(owner));
check(await execute(['GET', key]) === paid);
await execute(['SET', auditKey, JSON.stringify(audit)]);
await execute(['DEL', key]);
await reject(() => bootstrap(owner));
check(await execute(['GET', key]) === null);
// Audit mutation between read and commit cannot enroll.
await execute(['DEL', auditKey + ':committed']);
const race = createMembershipBootstrap({ accountId, execute: async command => {
  if (command[0] === 'EVAL') await execute(['SET', auditKey, '{}']);
  return execute(command);
} });
await reject(() => race(owner));
check(await execute(['GET', key]) === null);
console.log(`membership-bootstrap: ${n} passed, 0 failed`);
process.exit(0);
