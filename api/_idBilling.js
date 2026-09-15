// Authoritative ID billing only. No signing secret: 256-bit opaque server-held
// receipt, bound to owner / scan / offered candidates / expiry / identify mode.
import { randomBytes, createHash } from 'node:crypto';
import { getUserTier, TIER_BENEFITS, isPaidTier } from './_tier.js';

export const CONFIRM_TTL_SECONDS = 900;
const RETENTION_SECONDS = 86400;
export const newIdReceipt = () => randomBytes(32).toString('hex');
const validId = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const stable = v => {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort()
    .filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
};
export const candidateHash = c => createHash('sha256').update(stable(c)).digest('hex');
export function canonicalPick(c, cardType) {
  return {
    ...c,
    card_name: c.card_name || c.name || '',
    card_number: c.card_number || c.number || c.id || '',
    set_name: c.set_name || c.set || c.setName || c.setCode || c.set_code || '',
    rarity: c.rarity || c.set_rarity || '', hp: c.hp || '',
    card_type: c.card_type || cardType || 'pokemon', sport: c.sport || '', year: c.year || '',
    is_japanese: c.is_japanese === true,
  };
}

// Lua does not roll back after a runtime error. Validate and encode everything
// BEFORE the sole financial write (MSET of counter + journal). No DECR followed
// by refund, lock gap, or read/write fallback. EXPIRE is housekeeping only;
// logical expires is independently checked even if TTL housekeeping fails.
export const ID_BILLING_SCRIPT = `
local action = ARGV[1]
local p = cjson.decode(ARGV[2])
-- Some encoders return nil/error instead of throwing. Never turn that into
-- tostring(nil), or commit a charge whose response/journal cannot be replayed.
local function same(a,b)
  if type(a)~=type(b) then return false end
  if type(a)~='table' then return a==b end
  for k,v in pairs(a) do if not same(v,b[k]) then return false end end
  for k,_ in pairs(b) do if a[k]==nil then return false end end
  return true
end
local function answer(v)
  local ok,encoded=pcall(cjson.encode,v)
  if not ok or type(encoded)~='string' then error('invalid ID encoding') end
  local decodedOK,decoded=pcall(cjson.decode,encoded)
  if not decodedOK or not same(v,decoded) then error('invalid ID encoding') end
  return encoded
end
local function fail(code) return answer({ok=false,code=code}) end
local raw = redis.call('GET', KEYS[1])
local rec = nil
if raw then
  local ok,decoded=pcall(cjson.decode,raw)
  if not ok or type(decoded)~='table' then error('invalid ID journal') end
  rec=decoded
end
local now = tonumber(redis.call('TIME')[1])
if rec and (rec.owner ~= p.owner or rec.scan ~= p.scan or rec.mode ~= 'identify') then
  return fail('binding_mismatch')
end
if p.mode ~= 'identify' then return fail('binding_mismatch') end
local writes = {}
local function counter(key)
  local v = redis.call('GET', key)
  if not v then return 0 end
  -- Reject legacy arrays/corruption: never reinterpret an unreadable balance.
  if not string.match(v, '^%d+$') then error('invalid ID counter') end
  local n = tonumber(v)
  if not n or n > 9007199254740990 then error('invalid ID counter') end
  return n
end
local function write(key, val)
  if type(key)~='string' or (type(val)~='string' and type(val)~='number') then
    error('invalid ID write')
  end
  table.insert(writes, key); table.insert(writes, tostring(val))
end
local function debit()
  local grant = tonumber(p.grant)
  if not grant or grant < 0 or grant ~= math.floor(grant) then error('invalid grant') end
  local used = counter(KEYS[2])
  local paid = counter(KEYS[3])
  if used < grant then
    write(KEYS[2], used + 1)
    return {ok=true, bucket='id_free', remaining=grant-used-1, free_remaining=grant-used-1, paid_remaining=paid}
  end
  if paid > 0 then
    write(KEYS[3], paid - 1)
    return {ok=true, bucket='id_paid_left', remaining=paid-1, free_remaining=0, paid_remaining=paid-1}
  end
  return {ok=false,code='no_credits'}
end
local function refund()
  if rec and rec.state == 'debited' then
    if rec.result.bucket == 'id_free' then
      local used = counter(rec.free_key)
      if used < 1 then error('invalid refund counter') end
      write(rec.free_key, used - 1)
    elseif rec.result.bucket == 'id_paid_left' then
      write(KEYS[3], counter(KEYS[3]) + 1)
    else error('invalid refund bucket') end
  end
end
local result
if action == 'debit' then
  if rec and rec.state == 'debited' then return answer(rec.result) end
  if rec then return fail('already_reserved') end
  result = debit()
  if not result.ok then return answer(result) end
  rec = {owner=p.owner,scan=p.scan,mode=p.mode,state='debited',free_key=KEYS[2],result=result}
elseif action == 'offer' then
  if rec and rec.state == 'pending' then
    if rec.candidate_set ~= p.candidate_set then return fail('candidate_mismatch') end
    if now >= rec.expires then return fail('expired_confirmation') end
    return answer({ok=true,expires=rec.expires})
  end
  if not rec and not p.uncharged then return fail('missing_reservation') end
  if rec and rec.state ~= 'debited' then return fail('invalid_state') end
  if type(p.candidates) ~= 'table' or #p.candidates < 1 then return fail('invalid_candidates') end
  refund()
  rec = {owner=p.owner,scan=p.scan,mode=p.mode,state='pending',
    candidates=p.candidates,candidate_set=p.candidate_set,expires=now+tonumber(p.ttl),
    zero_cost=p.uncharged == true}
  result = {ok=true,expires=rec.expires}
elseif action == 'refund' then
  -- A cancelled-before-execution reservation must fence a delayed debit.
  if not rec then rec = {owner=p.owner,scan=p.scan,mode=p.mode,state='cancelled'} end
  if rec.state == 'refunded' or rec.state == 'pending' then return answer({ok=true}) end
  if rec.state ~= 'debited' and rec.state ~= 'cancelled' then return fail('invalid_state') end
  refund()
  rec.state = 'refunded'
  result = {ok=true}
elseif action == 'claim_retry' then
  if not rec or rec.state ~= 'debited' then return answer({ok=true,claimed=false}) end
  local sr = redis.call('GET', 'scan:' .. p.scan)
  if not sr then return answer({ok=true,claimed=false}) end
  local scan = cjson.decode(sr)
  if scan.uid ~= p.owner or scan.id_receipt ~= p.receipt then return fail('binding_mismatch') end
  if rec.retry_used then return answer({ok=true,claimed=rec.retry_receipt == p.retry_receipt}) end
  if redis.call('EXISTS', 'scan_refund:' .. p.scan) == 1 then return answer({ok=true,claimed=false}) end
  rec.retry_used = true; rec.retry_receipt = p.retry_receipt
  -- The journal is authority. Do not reset the original scan record's 1h TTL.
  result = {ok=true,claimed=true}
elseif action == 'manual_refund' then
  if not rec then return fail('missing_reservation') end
  if rec.state == 'refunded' then return answer({ok=true,success=true,alreadyRefunded=true,credits_refunded=0}) end
  if rec.state ~= 'debited' or rec.retry_used then return fail('invalid_state') end
  local sr = redis.call('GET', 'scan:' .. p.scan)
  if not sr then return fail('expired_confirmation') end
  local scan = cjson.decode(sr)
  if scan.uid ~= p.owner or scan.id_receipt ~= p.receipt then return fail('binding_mismatch') end
  local rateKey = 'scan_refund_count:' .. p.owner
  local count = counter(rateKey)
  if count >= 3 then return fail('refund_cap') end
  refund()
  write(rateKey, count + 1)
  write('scan_refund:' .. p.scan, answer({uid=p.owner,scan_id=p.scan,
    consumed_from=rec.result.bucket,refunded_amount=1,refunded_at=now,reason=p.reason}))
  rec.state = 'refunded'
  result = {ok=true,success=true,credits_refunded=1,remaining_refunds_today=2-count}
elseif action == 'accept' then
  if not rec then return fail('missing_confirmation') end
  if rec.candidate_set ~= p.candidate_set then return fail('candidate_mismatch') end
  local selected = nil
  for _, c in ipairs(rec.candidates) do
    if c.hash == p.candidate then selected = c.card end
  end
  if not selected then return fail('candidate_mismatch') end
  if rec.state == 'accepted' then
    if rec.selected ~= p.candidate then return fail('selection_mismatch') end
    if now >= rec.replay_expires then return fail('expired_confirmation') end
    return rec.result_json
  end
  if rec.state ~= 'pending' then return fail('invalid_state') end
  if not rec.expires or now >= rec.expires then return fail('expired_confirmation') end
  if p.grant == nil and not rec.zero_cost then return fail('entitlement_required') end
  result = rec.zero_cost and {ok=true,bucket='id_retry',charged=0} or debit()
  if not result.ok then return answer(result) end
  result.pickedCard = selected
  result.scan_id = rec.scan
  rec.state = 'accepted'; rec.selected = p.candidate; rec.result = result
  rec.free_key = KEYS[2]; rec.replay_expires = now + tonumber(ARGV[3])
else return fail('invalid_action') end
local encoded = answer(result)
if action == 'accept' then rec.result_json = encoded end
write(KEYS[1], answer(rec))
redis.call('MSET', unpack(writes))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
if action == 'manual_refund' then
  redis.call('EXPIRE', 'scan_refund_count:' .. p.owner, 86400)
  redis.call('EXPIRE', 'scan_refund:' .. p.scan, 2592000)
end
return encoded
`;

export class IdBillingError extends Error {
  constructor(code = 'billing_unavailable') { super(code); this.code = code; }
}
async function command(...args) {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new IdBillingError();
  // Body form avoids URL-size limits for scripts and the full candidate set.
  const response = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new IdBillingError();
  const data = await response.json();
  if (data.error || data.result === undefined) throw new IdBillingError();
  return data.result;
}
export async function idEntitlement({ uid, email }) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) throw new IdBillingError();
  const tier = await getUserTier(process.env.STRIPE_SECRET_KEY,
    process.env.KV_REST_API_URL, process.env.KV_REST_API_TOKEN, uid, email, { strict: true });
  const verified = tier === 'free' && uid ? !!(await command('GET', `email_verified:${uid}`)) : false;
  const grant = isPaidTier(tier) || verified ? TIER_BENEFITS[tier]?.idGrant : 0;
  if (!Number.isSafeInteger(grant) || grant < 0) throw new IdBillingError();
  return { grant, stamp: new Date().toISOString().slice(0, 7).replace('-', '_') };
}
export async function idBilling(action, { receipt, owner, scan, mode = 'identify', ...params }) {
  if (!validId(receipt) || !owner || !scan) throw new IdBillingError('invalid_confirmation');
  const stamp = params.stamp || new Date().toISOString().slice(0, 7).replace('-', '_');
  try {
    const result = JSON.parse(await command('EVAL', ID_BILLING_SCRIPT, 3,
      `id_billing:${receipt}`, `scans:${owner}:id_free_used_${stamp}`, `scans:${owner}:id_paid_left`,
      action, JSON.stringify({ owner, scan, mode, receipt, ...params }), RETENTION_SECONDS));
    if (!result || typeof result.ok !== 'boolean') throw new IdBillingError();
    if (!result.ok && typeof result.code !== 'string') throw new IdBillingError();
    if (result.ok) {
      const paidResult = ['id_free', 'id_paid_left'].includes(result.bucket);
      if (action === 'debit' && (!paidResult || !Number.isSafeInteger(result.remaining))) throw new IdBillingError();
      if (action === 'accept' && ((!paidResult && result.bucket !== 'id_retry')
          || !result.pickedCard || typeof result.pickedCard !== 'object'
          || result.scan_id !== scan)) throw new IdBillingError();
      if (action === 'offer' && !Number.isSafeInteger(result.expires)) throw new IdBillingError();
      if (action === 'claim_retry' && typeof result.claimed !== 'boolean') throw new IdBillingError();
      if (action === 'manual_refund' && (result.success !== true
          || ![0, 1].includes(result.credits_refunded))) throw new IdBillingError();
    }
    return result;
  } catch (error) {
    if (error instanceof IdBillingError) throw error;
    throw new IdBillingError();
  }
}
export async function offerIdConfirmation(context, candidates, uncharged = false) {
  // Reject the whole offer, never silently truncate the seller's candidate set.
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 200
      || Buffer.byteLength(JSON.stringify(candidates)) > 256000) throw new IdBillingError('invalid_candidates');
  const offered = candidates.map(c => ({ hash: candidateHash(c), card: canonicalPick(c, context.cardType) }));
  const candidate_set = candidateHash(offered.map(c => c.hash));
  const result = await idBilling('offer', { ...context, candidates: offered,
    candidate_set, ttl: CONFIRM_TTL_SECONDS, uncharged });
  if (!result.ok) throw new IdBillingError(result.code);
  return { confirmation_id: context.receipt, scan_id: context.scan, candidate_set,
    confirmation_expires_at: result.expires * 1000 };
}
export async function claimIdRetry(context, retryOf) {
  const raw = await command('GET', `scan:${retryOf}`);
  if (!raw) return false;
  const prior = JSON.parse(raw);
  if (prior.uid !== context.owner || !validId(prior.id_receipt)
      || !['id_free', 'id_paid_left'].includes(prior.consumed_from)) return false;
  const result = await idBilling('claim_retry', { receipt: prior.id_receipt,
    owner: context.owner, scan: retryOf, retry_receipt: context.receipt });
  if (!result.ok) throw new IdBillingError(result.code);
  return result.claimed === true;
}
export function idBillingFailure(res, error) {
  const code = error?.code || 'billing_unavailable';
  const status = code === 'refund_cap' ? 429 : code === 'no_credits' ? 402 : code === 'billing_unavailable' ? 503
    : code === 'expired_confirmation' ? 410 : 409;
  return res.status(status).json({ ok: false, error: code, ...(status === 402 ? { needsPayment: true } : {}) });
}
