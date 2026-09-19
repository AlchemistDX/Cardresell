// Local transport adapter only; NEVER installs a global fetch override.
// This durable database latch is set by a reviewed cutover, not by a request,
// an environment flag, or this module. Removing the rollout flag cannot erase it.
export const MEMBERSHIP_LEGACY_FENCE = 'membership:launch-v2:legacy_fence';
export const membershipEnabled = () => process.env.MEMBERSHIP_BILLING_V2 === 'on';
const prefix = `if redis.call('EXISTS','${MEMBERSHIP_LEGACY_FENCE}')==1 then error('membership_legacy_fenced') end\n`;
const protectedKey = key => /^(scans:|id_billing:|scan_refund:|scan_refund_count:|signup_bonus:|email_bonus_claimed:|stripe_evt:|ref_claimed:|ref_count:|pro:)/.test(String(key));
const reads = new Set(['GET', 'MGET', 'EXISTS', 'TTL', 'PTTL', 'SCAN', 'TIME', 'KEYS']);
const writes = new Set(['SET', 'SETEX', 'PSETEX', 'MSET', 'INCR', 'INCRBY', 'DECR', 'DECRBY',
  'EXPIRE', 'PEXPIRE', 'PERSIST', 'DEL', 'UNLINK']);

export function guardLegacyCommand(args) {
  const command = String(args[0]).toUpperCase();
  if (reads.has(command)) return args;
  if (command === 'EVAL') return ['EVAL', prefix + args[1], ...args.slice(2)];
  if (!writes.has(command)) throw new Error('unsupported_legacy_command');
  const keys = command === 'MSET' ? args.filter((_, i) => i % 2 === 1)
    : ['DEL', 'UNLINK'].includes(command) ? args.slice(1) : [args[1]];
  if (!keys.some(protectedKey)) return args;
  return ['EVAL', prefix + "return redis.call(unpack(ARGV))", 0, ...args];
}

// Existing route-local Redis URL and body forms retain their response contract.
// Stripe/identity/provider requests are not rewritten.
export async function legacyCreditFetch(input, init = {}) {
  const base = process.env.KV_REST_API_URL;
  if (!base) return globalThis.fetch(input, init);
  const url = new URL(String(input));
  const configured = new URL(base);
  if (url.origin !== configured.origin) return globalThis.fetch(input, init);
  let args;
  if (init.body) {
    args = JSON.parse(init.body);
    if (!Array.isArray(args)) throw new Error('invalid_legacy_command');
  } else {
    if (url.pathname.startsWith('//')) throw new Error('invalid_legacy_path');
    args = url.pathname.slice(1).split('/').map(decodeURIComponent);
    for (const [key, value] of url.searchParams) {
      const option = key.toUpperCase();
      if (!['EX', 'PX', 'NX', 'XX'].includes(option)) throw new Error('invalid_legacy_option');
      args.push(option);
      if (option === 'EX' || option === 'PX') args.push(value);
    }
  }
  const guarded = guardLegacyCommand(args);
  if (guarded === args) return globalThis.fetch(input, init);
  const response = await globalThis.fetch(base, { ...init, method: 'POST',
    headers: { ...init.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(guarded), redirect: 'error' });
  if (!response.ok) throw new Error('legacy_write_unavailable');
  // Old helpers sometimes ignored a Redis error in a 200 response. Never let a
  // denied financial write be reported as a completed reward or payment.
  const data = await response.clone().json();
  if (data.error || data.result === undefined) throw new Error('legacy_write_unavailable');
  return response;
}

export async function membershipRedis(args) {
  const raw = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  let url;
  try { url = new URL(raw); } catch { throw new Error('billing_unavailable'); }
  if (!token || url.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]*\.upstash\.io$/.test(url.hostname)
    || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('billing_unavailable');
  const response = await globalThis.fetch(url.href, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args), redirect: 'error', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('billing_unavailable');
  const data = await response.json();
  if (data.error || data.result === undefined) throw new Error('billing_unavailable');
  return data.result;
}

export async function membershipRouteMode(execute = membershipRedis) {
  if (!process.env.KV_REST_API_URL && !membershipEnabled()) return false;
  const fence = await execute(['GET', MEMBERSHIP_LEGACY_FENCE]);
  if (fence !== null && fence !== '1') throw new Error('billing_unavailable');
  if (membershipEnabled()) {
    if (fence !== '1') throw new Error('membership_cutover_not_ready');
    return true;
  }
  if (fence !== null) throw new Error('membership_rollout_paused');
  return false;
}

// Before external legacy payment effects or processed markers. The atomic
// Redis guard remains mandatory because this preliminary read alone is racy.
export async function legacyRouteAllowed(res) {
  try {
    if (await membershipRouteMode()) {
      res.status(503).json({ error: 'membership_legacy_fenced' }); return false;
    }
    return true;
  } catch {
    res.status(503).json({ error: 'billing_unavailable' }); return false;
  }
}
