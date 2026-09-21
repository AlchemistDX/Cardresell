// Server-owned cutover authorization only. This module never infers historical
// origin, creates a customer, enables the fence, or issues welcome/monthly credit.
import { createHash } from 'node:crypto';
import { membershipEnrollmentKey } from './_membershipConsumption.js';
const hash = value => createHash('sha256').update(value).digest('hex');
const validOwner = owner => typeof owner === 'string' && owner.length > 0
  && owner.length <= 128 && !/[\u0000-\u0020\u007f]/.test(owner);
const fail = () => { throw Object.assign(Error('bootstrap_audit_required'), { code: 'bootstrap_audit_required' }); };
export const membershipBootstrapAuditKey = owner => {
  if (!validOwner(owner)) fail();
  return 'membership:launch-v2:bootstrap-audit:' + hash(owner);
};
const SCRIPT = `
if redis.call('GET',KEYS[1])~='1' then return 0 end
if redis.call('GET',KEYS[2])~=ARGV[1] then return 0 end
local current=redis.call('GET',KEYS[3])
local journal=redis.call('GET',KEYS[4])
if journal then
 if journal~=ARGV[3] or not current then return 0 end
 local ok,record=pcall(cjson.decode,current)
 if not ok or type(record)~='table' or record.version~='launch-v2'
  or record.owner~=ARGV[4] or record.verified~=true
  or (record.plan~='free' and record.plan~='paid') then return 0 end
 return 2
end
if current then return 0 end
redis.call('MSET',KEYS[3],ARGV[2],KEYS[4],ARGV[3])
return 1`;
export function createMembershipBootstrap({ execute, accountId, livemode = false }) {
  if (typeof execute !== 'function' || !/^acct_[A-Za-z0-9]+$/.test(accountId) || livemode !== false) fail();
  return async function bootstrap(owner) {
    const auditKey = membershipBootstrapAuditKey(owner);
    const raw = await execute(['GET', auditKey]);
    let audit;
    try { audit = JSON.parse(raw); } catch { fail(); }
    const fields = ['version', 'owner', 'accountId', 'livemode', 'evidenceId',
      'legacyWritersDrained', 'verified', 'freeThrough', 'bulkGrade'];
    if (!audit || Object.keys(audit).length !== fields.length
      || !fields.every(k => Object.hasOwn(audit, k))
      || audit.version !== 1 || audit.owner !== owner || audit.accountId !== accountId
      || audit.livemode !== false || !/^[a-f0-9]{64}$/.test(audit.evidenceId)
      || audit.legacyWritersDrained !== true || audit.verified !== true
      || !Number.isSafeInteger(audit.freeThrough) || audit.freeThrough < 0
      || typeof audit.bulkGrade !== 'boolean') fail();
    const record = { version: 'launch-v2', owner, verified: true, plan: 'free',
      freeThrough: audit.freeThrough, capabilities: { bulkGrade: audit.bulkGrade } };
    if (audit.freeThrough === 0) {
      const clock = await execute(['TIME']);
      const seconds = Number(clock?.[0]);
      if (!Number.isSafeInteger(seconds) || seconds <= 0) fail();
      const at = new Date(seconds * 1000);
      // New audited enrollment starts now, not at an invented historical date.
      record.freeEligibleFrom = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1) / 1000;
    }
    const journal = JSON.stringify({ version: 1, owner, accountId, livemode: false,
      auditDigest: hash(raw), evidenceId: audit.evidenceId });
    const result = await execute(['EVAL', SCRIPT, 4, 'membership:launch-v2:legacy_fence',
      auditKey, membershipEnrollmentKey(owner), auditKey + ':committed',
      raw, JSON.stringify(record), journal, owner]);
    if (![1, 2].includes(result)) fail();
    return { status: result === 1 ? 'enrolled' : 'replayed' };
  };
}
