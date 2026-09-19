// A paid invoice changes benefit authority, not credit origin or balances.
// Enrollment must already have been established by the audited cutover. Never
// manufacture historical/free/welcome provenance for a previously unseen owner.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { membershipEnrollmentKey } from './_membershipConsumption.js';
const hash = x => createHash('sha256').update(x).digest('hex');
const SCRIPT = `
if redis.call('GET',KEYS[1])~='1' then return 0 end
if redis.call('GET',KEYS[2])~=ARGV[1] or redis.call('GET',KEYS[3])~=ARGV[2] then return 0 end
if ARGV[3]~=ARGV[1] then redis.call('SET',KEYS[2],ARGV[3]) end
return 1`;
export async function reconcilePaidEnrollment(execute, owner, subscriptionId, attempt = 0) {
  if (!/^sub_[A-Za-z0-9_]+$/.test(subscriptionId)) throw Error('invalid_subscription');
  const enrollmentKey = membershipEnrollmentKey(owner), activeKey = 'membership:launch-v2:active:' + hash(owner);
  const [raw, activeRaw] = await Promise.all([execute(['GET', enrollmentKey]), execute(['GET', activeKey])]);
  const e = JSON.parse(raw), a = JSON.parse(activeRaw);
  const safe = value => typeof value === 'number' ? Number.isSafeInteger(value)
    : value === null || typeof value !== 'object' || Object.values(value).every(safe);
  if (!e || !a || !safe(e) || e.version !== 'launch-v2' || e.owner !== owner || e.verified !== true
    || !['free', 'paid'].includes(e.plan) || a.version !== 'launch-v2' || a.owner !== owner
    || a.subscription !== subscriptionId || (e.plan === 'paid' && e.subscription !== subscriptionId)
    || ((e.plan === 'free' || Object.hasOwn(e, 'freeThrough'))
      && (!Number.isSafeInteger(e.freeThrough) || e.freeThrough < 0))) throw Error('enrollment_reconciliation_required');
  const desired = { ...e, plan: 'paid', subscription: subscriptionId };
  const next = e.plan === 'paid' ? raw : JSON.stringify(desired);
  if (typeof next !== 'string' || !isDeepStrictEqual(JSON.parse(next), desired)) {
    throw Error('enrollment_serialization_invalid');
  }
  // Lua compares exact prior bytes and writes the pre-serialized JS value. It
  // never encodes the preserved record (cjson rounds integers and loses []).
  const result = await execute(['EVAL', SCRIPT, 3, 'membership:launch-v2:legacy_fence',
    enrollmentKey, activeKey, raw, activeRaw, next]);
  if (result === 0 && attempt < 2) return reconcilePaidEnrollment(execute, owner, subscriptionId, attempt + 1);
  if (result !== 1) throw Object.assign(Error('enrollment_reconciliation_required'), {
    code: 'enrollment_reconciliation_required' });
}
