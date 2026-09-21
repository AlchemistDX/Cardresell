// Preview-only provisioning called AFTER normal server authentication.
// It does not set the global writer fence, associate Stripe customers, grant
// credits, overwrite enrollment or import legacy subscriptions.
import { createHash } from 'node:crypto';
import { membershipEnrollmentKey } from './_membershipConsumption.js';
import { membershipIncludedHistoryKey } from './_membershipLedger.js';
import { membershipBootstrapAuditKey } from './_membershipBootstrap.js';
const hash = s => createHash('sha256').update(s).digest('hex');
const fail = () => { throw Object.assign(Error('enrollment_review_required'), { code: 'enrollment_review_required' }); };
const SCRIPT = `
if redis.call('GET',KEYS[1])~='1' then return 0 end
local p=cjson.decode(ARGV[1])
for i=2,#KEYS do
 local actual=redis.call('GET',KEYS[i])
 local expected=p.expected[i-1]
 if expected==cjson.null then
  if actual then return 0 end
 elseif actual~=expected then return 0 end
end
redis.call('SET',KEYS[2],p.audit)
return 1`;
export function createMembershipEnrollmentProvisioner({ execute, accountId, environment, allowedOwners }) {
  if (environment !== 'preview' || !/^acct_[A-Za-z0-9]+$/.test(accountId)
    || typeof execute !== 'function' || !Array.isArray(allowedOwners)) fail();
  const allowed = new Set(allowedOwners);
  return async owner => {
    if (!allowed.has(owner)) fail();
    const auditKey = membershipBootstrapAuditKey(owner);
    const keys = ['membership:launch-v2:legacy_fence', auditKey, membershipEnrollmentKey(owner),
      membershipIncludedHistoryKey(owner), 'membership:launch-v2:active:' + hash(owner),
      `pro:${owner}`, `scans:${owner}:id_paid_left`, `scans:${owner}:paid_left`, `signup_bonus:${owner}`];
    for (let attempt = 0; attempt < 4; attempt++) {
      const expected = await Promise.all(keys.slice(1).map(key => execute(['GET', key])));
      if (expected[0] !== null) {
        // Bootstrap performs the exact audit/journal validation. Never repair
        // or replace a malformed existing record here.
        return { status: 'existing_audit' };
      }
      if (expected.slice(1, 5).some(raw => raw !== null)) fail();
      const clock = await execute(['TIME']);
      const now = Number(clock?.[0]);
      if (!Number.isSafeInteger(now) || now <= 0) fail();
      const audit = { version: 1, owner, accountId, livemode: false,
        evidenceId: hash(JSON.stringify({ owner, accountId, expected, observedAt: now,
          policy: 'preview-new-enrollment-v1' })),
        legacyWritersDrained: true, verified: true, freeThrough: 0, bulkGrade: false };
      // Global fence is an independent prerequisite, not asserted by this
      // request. Historical standing balances and welcome markers are CAS
      // observations only and remain byte-identical.
      const ok = await execute(['EVAL', SCRIPT, keys.length, ...keys, JSON.stringify({
        expected, audit: JSON.stringify(audit),
      })]);
      if (ok === 1) return { status: 'audit_created' };
    }
    fail();
  };
}
