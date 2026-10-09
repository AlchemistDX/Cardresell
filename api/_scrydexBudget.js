import { createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');

export function scrydexConfig(env, now) {
  if (env.SCRYDEX_ENABLED !== '1') return null;
  const positive = v => /^[1-9]\d{0,6}$/.test(v || '') ? Number(v) : 0;
  const start = Date.parse(env.SCRYDEX_WINDOW_START || ''), end = Date.parse(env.SCRYDEX_WINDOW_END || '');
  const cap = positive(env.SCRYDEX_REQUEST_CAP), userCap = positive(env.SCRYDEX_USER_DAILY_CAP);
  const scope = env.SCRYDEX_KV_SCOPE || '';
  const users = (env.SCRYDEX_PILOT_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!env.SCRYDEX_API_KEY || !env.SCRYDEX_TEAM_ID || !/^[a-z0-9_-]{3,60}$/.test(scope)
      || !cap || !userCap || !users.length || !Number.isFinite(start) || !Number.isFinite(end)
      || start > now || now >= end || end - start > 32 * 86400000) throw new Error('Scrydex configuration incomplete');
  const prefix = `scrydex:{${scope}:${hash(env.SCRYDEX_TEAM_ID).slice(0, 24)}}`;
  return { prefix, cap, userCap, start, end, users, apiKey: env.SCRYDEX_API_KEY, team: env.SCRYDEX_TEAM_ID,
    budgetKey: `${prefix}:budget:${start}`, prices: env.SCRYDEX_PRICES_ENABLED === '1' };
}

// All reservations are permanent charges to the local request allowance, even
// on transport failures. Never assume an uncertain call was free. Missing or
// corrupt global usage fails closed; an operator initializes it after checking
// provider usage. This prevents a deleted usage key from granting a fresh cap.
export const RESERVE = `
local cached = redis.call('GET', KEYS[1])
if cached then return {'cache', cached} end
if redis.call('EXISTS', KEYS[5]) == 1 then return {'cooldown'} end
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000
if now < tonumber(ARGV[4]) or now >= tonumber(ARGV[5]) then return {'window'} end
local raw = redis.call('GET', KEYS[3])
if not raw or not string.match(raw, '^%d+$') then return {'uninitialized'} end
local used = tonumber(raw)
if used >= tonumber(ARGV[2]) then return {'budget'} end
local userRaw = redis.call('GET', KEYS[4]) or '0'
if not string.match(userRaw, '^%d+$') then return {'uninitialized'} end
if tonumber(userRaw) >= tonumber(ARGV[3]) then return {'user'} end
if redis.call('EXISTS', KEYS[2]) == 1 then return {'busy'} end
redis.call('INCR', KEYS[3])
redis.call('INCR', KEYS[4])
redis.call('EXPIRE', KEYS[4], 172800)
redis.call('SET', KEYS[2], ARGV[1], 'PX', 30000)
return {'reserved'}
`;
// A late worker cannot overwrite another worker's cache or release its lock.
export const COMPLETE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[2] ~= '' then redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3]) end
redis.call('DEL', KEYS[1])
return 1
`;

export function scrydexKeys(config, request, uid, now) {
  const key = `${config.prefix}:v1:${hash(request.url)}`;
  return { cache: key + ':cache', lock: key + ':lock', budget: config.budgetKey,
    user: `${config.prefix}:user:${hash(uid)}:${Math.floor(now / 86400000)}`, cooldown: config.prefix + ':cooldown' };
}

// Dedicated credentials allow production and preview to use isolated stores.
// This deliberately does not fall back to the application's general KV store.
export function scrydexKv(env, fetchFn = fetch) {
  if (!env.SCRYDEX_KV_REST_API_URL || !env.SCRYDEX_KV_REST_API_TOKEN) return null;
  return async (...args) => {
    const response = await fetchFn(env.SCRYDEX_KV_REST_API_URL, {
      method: 'POST', headers: { Authorization: `Bearer ${env.SCRYDEX_KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(5000), redirect: 'error',
    });
    if (!response.ok) throw new Error('Scrydex storage unavailable');
    const body = await response.json();
    if (body.error || !Object.hasOwn(body, 'result')) throw new Error('Scrydex storage unavailable');
    return body.result;
  };
}
