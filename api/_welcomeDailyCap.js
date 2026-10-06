// Daily circuit breaker for NEW welcome awards (anti-farming backstop).
//
// Every verified account still gets exactly one welcome award; this only limits
// how many first-time awards are issued per UTC day across all accounts. When
// the day's limit is reached the award is DEFERRED, not denied: no claim marker
// is written, a deferred marker is set, and a later authenticated account read
// retries the same idempotent ledger operation once the day has room.
//
// The approved ledger Lua body is not modified. This wraps the prepared command:
// a guard runs first in the same atomic EVAL, then the unchanged script. Replays
// (journal present) and already-claimed accounts never touch the counter.
import { createHash } from 'node:crypto';

const PREFIX = 'membership:launch-v2:';
export const WELCOME_DAILY_CAP_DEFAULT = 200;
const MAX_CAP = 100000;

export function welcomeDailyCap(raw = process.env.WELCOME_DAILY_CAP) {
  const text = String(raw ?? '').trim();
  if (!/^\d{1,6}$/.test(text)) return WELCOME_DAILY_CAP_DEFAULT;
  const n = Number(text);
  return n >= 1 && n <= MAX_CAP ? n : WELCOME_DAILY_CAP_DEFAULT;
}
export function welcomeDailyKey(nowMs = Date.now()) {
  return `${PREFIX}welcome_daily:${new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, '')}`;
}
export function welcomeDeferredKey(owner) {
  if (typeof owner !== 'string' || !owner) throw new Error('invalid owner');
  return `${PREFIX}welcome_deferred:${createHash('sha256').update(owner).digest('hex')}`;
}

// Wrap a prepared welcome EVAL command (['EVAL', script, n, ...keys, ...args]).
// Ledger welcome keys: KEYS[1] journal, KEYS[4] signup_bonus, KEYS[5] email claim.
export function withWelcomeDailyCap(command, { owner, cap = welcomeDailyCap(), nowMs = Date.now() } = {}) {
  if (!Array.isArray(command) || command[0] !== 'EVAL' || !Number.isInteger(command[2])) throw new Error('invalid command');
  const count = command[2];
  const keys = command.slice(3, 3 + count), args = command.slice(3 + count);
  const daily = count + 1, deferred = count + 2, capArg = args.length + 1;
  const guard = `
local welcome_fresh=redis.call('EXISTS',KEYS[1])==0 and redis.call('EXISTS',KEYS[4])==0 and redis.call('EXISTS',KEYS[5])==0
if welcome_fresh then
  local welcome_cap=tonumber(ARGV[${capArg}])
  local welcome_used=tonumber(redis.call('GET',KEYS[${daily}]) or '0') or 0
  if not welcome_cap or welcome_used>=welcome_cap then
    local wp=cjson.decode(ARGV[1])
    redis.call('SET',KEYS[${deferred}],'1','EX',2592000)
    return cjson.encode({ok=true,owner=wp.owner,kind='welcome',version=wp.version,granted=false,id_delta=0,grade_delta=0,deferred=true})
  end
  redis.call('INCR',KEYS[${daily}])
  redis.call('EXPIRE',KEYS[${daily}],259200)
end
`;
  return ['EVAL', guard + command[1], count + 2, ...keys, welcomeDailyKey(nowMs), welcomeDeferredKey(owner),
    ...args, String(cap)];
}

// After a non-deferred welcome outcome (granted, replayed or already claimed),
// the deferral is resolved. Best-effort: a stale marker only causes one more
// idempotent retry.
export async function clearWelcomeDeferral(execute, owner, result) {
  if (result?.deferred === true) {
    console.warn('WELCOME_DAILY_CAP_REACHED', JSON.stringify({ day: welcomeDailyKey().slice(-8) }));
    return;
  }
  try { await execute(['DEL', welcomeDeferredKey(owner)]); } catch {}
}
export async function hasWelcomeDeferral(execute, owner) {
  try { return Number(await execute(['EXISTS', welcomeDeferredKey(owner)])) === 1; } catch { return false; }
}
