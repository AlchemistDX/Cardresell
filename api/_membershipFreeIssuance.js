// Server-only catch-up for audited Free enrollment. No inferred historical
// eligibility: freeEligibleFrom must have been recorded at enrollment.
import { createHash } from 'node:crypto';
import { membershipEnrollmentKey } from './_membershipConsumption.js';
import { membershipIncludedHistoryKey } from './_membershipLedger.js';
import { LAUNCH_PLANS } from './_launchMembershipConfig.js';
const hash = x => createHash('sha256').update(x).digest('hex');
const prefix = 'membership:launch-v2:';
const unavailable = () => { throw Object.assign(Error('free_issuance_unavailable'), { code: 'free_issuance_unavailable' }); };
const month = seconds => {
  const d = new Date(seconds * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
};
const nextMonth = seconds => {
  const d = new Date(seconds * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
};
const validTime = x => Number.isSafeInteger(x) && x > 0 && x === month(x);
const SCRIPT = `
if redis.call('GET',KEYS[1])~='1' then return 0 end
local p=cjson.decode(ARGV[1])
local now=tonumber(redis.call('TIME')[1])
if now<p.monthStart or now>=p.monthEnd then return 0 end
for i=2,#KEYS do
 local actual=redis.call('GET',KEYS[i])
 local expected=p.expected[i-1]
 if expected==cjson.null then
  if actual then return 0 end
 elseif actual~=expected then return 0 end
end
for i=2,#KEYS do
 local value=p.values[i-1]
 if value~=cjson.null then redis.call('SET',KEYS[i],value) end
end
return 1`;

export function createMembershipFreeIssuance({ execute }) {
  if (typeof execute !== 'function') unavailable();
  return async function issueFree(owner) {
    const enrollmentKey = membershipEnrollmentKey(owner);
    const historyKey = membershipIncludedHistoryKey(owner);
    const activeKey = prefix + 'active:' + hash(owner);
    for (let attempt = 0; attempt < 4; attempt++) {
      const [clock, enrollmentRaw, historyRaw, activeRaw] = await Promise.all([
        execute(['TIME']), execute(['GET', enrollmentKey]),
        execute(['GET', historyKey]), execute(['GET', activeKey]),
      ]);
      const now = Number(clock?.[0]);
      if (!Number.isSafeInteger(now) || now <= 0) unavailable();
      let enrollment, history;
      try { enrollment = JSON.parse(enrollmentRaw); history = historyRaw === null ? null : JSON.parse(historyRaw); }
      catch { unavailable(); }
      if (!enrollment || enrollment.version !== 'launch-v2' || enrollment.owner !== owner
        || enrollment.verified !== true || !['free', 'paid'].includes(enrollment.plan)) unavailable();
      // Paid periods require their invoice authority, never Free backfill.
      if (enrollment.plan === 'paid') return { status: 'paid', allocations: 0 };
      if (!Object.hasOwn(enrollment, 'freeEligibleFrom')) return { status: 'baseline_required', allocations: 0 };
      const current = month(now), start = enrollment.freeEligibleFrom, through = enrollment.freeThrough;
      if (!validTime(start) || start > current || !Number.isSafeInteger(through) || through < 0
        || (through !== 0 && (!validTime(through) || through < start || through > current))
        || activeRaw !== null) unavailable();
      if (!history) {
        if (through !== 0) unavailable();
        history = { version: 'launch-v2', owner, policy: 'nonexpiring-v1', count: 0, periods: [] };
      }
      if (history.version !== 'launch-v2' || history.owner !== owner || history.policy !== 'nonexpiring-v1'
        || !Array.isArray(history.periods) || history.count !== history.periods.length
        || history.count > 1200 || new Set(history.periods).size !== history.count
        || history.periods.some(k => typeof k !== 'string'
          || !/^membership:launch-v2:(period:[a-f0-9]{64}|free_period:[a-f0-9]{64}:\d+)$/.test(k))) unavailable();
      const keys = [prefix + 'legacy_fence', enrollmentKey, historyKey, activeKey];
      const expected = [enrollmentRaw, historyRaw, activeRaw];
      const values = [null, null, null];
      let allocations = 0;
      // Read/CAS every baseline period, including already-issued periods.
      // A missing old allocation must never be silently recreated.
      for (let at = start, count = 0; at <= current; at = nextMonth(at)) {
        if (++count > 1200) unavailable();
        const key = `${prefix}free_period:${hash(owner)}:${at}`;
        const raw = await execute(['GET', key]);
        keys.push(key); expected.push(raw); values.push(null);
        if (at <= through) {
          let record;
          try { record = JSON.parse(raw); } catch { unavailable(); }
          if (!record || !history.periods.includes(key) || record.version !== 'launch-v2'
            || record.owner !== owner || record.plan !== 'free' || record.start !== at
            || record.finish !== nextMonth(at) || record.id_grant !== LAUNCH_PLANS.free.idCredits
            || record.grade_grant !== LAUNCH_PLANS.free.gradeCredits
            || !Number.isSafeInteger(record.id_used) || record.id_used < 0 || record.id_used > record.id_grant
            || !Number.isSafeInteger(record.grade_used) || record.grade_used < 0 || record.grade_used > record.grade_grant) unavailable();
        } else {
          if (raw !== null || history.periods.includes(key) || history.count >= 1200) unavailable();
          history.periods.push(key); history.count++;
          values[values.length - 1] = JSON.stringify({
            version: 'launch-v2', owner, plan: 'free', start: at, finish: nextMonth(at),
            id_grant: LAUNCH_PLANS.free.idCredits, grade_grant: LAUNCH_PLANS.free.gradeCredits,
            id_used: 0, grade_used: 0,
          });
          allocations++;
        }
      }
      // Encode in JS; Lua compares and writes exact bytes without re-encoding.
      // Unrelated counters, historical records, journals and welcome stay intact.
      values[0] = JSON.stringify({ ...enrollment, freeThrough: current });
      values[1] = JSON.stringify(history);
      if (await execute(['EVAL', SCRIPT, keys.length, ...keys, JSON.stringify({
        monthStart: current, monthEnd: nextMonth(current), expected, values,
      })]) === 1) return { status: allocations ? 'issued' : 'replayed', allocations };
    }
    unavailable();
  };
}
