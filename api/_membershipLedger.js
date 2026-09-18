// DORMANT launch-v2 fulfillment primitives. No imports from live handlers,
// credentials, fetch, migration or automatic activation. The caller must supply
// an authenticated, Stripe-verified server envelope and a Redis command adapter.
// `paid: true` here is an invariant, NOT proof of payment or an HTTP auth gate.
import { createHash } from 'node:crypto';
import {
  MEMBERSHIP_VERSION, LAUNCH_PLANS, LAUNCH_WELCOME_CREDITS, quoteLaunchPack,
} from './_launchMembershipConfig.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const prefix = `membership:${MEMBERSHIP_VERSION}:`;
// New welcome allowances have explicit provenance. Existing mixed standing
// balances are preserved, never reclassified or split by inference.
export function membershipWelcomeKeys(owner) {
  if (!validOwner(owner)) reject();
  const base = `${prefix}welcome_balance:${digest(owner)}`;
  return Object.freeze({ id: `${base}:id`, grade: `${base}:grade` });
}
const own = (object, key) => Object.hasOwn(object, key);
const validOwner = value => typeof value === 'string' && value.length > 0
  && value.length <= 128 && !/[\u0000-\u0020\u007f]/.test(value);
const safeInt = value => Number.isSafeInteger(value) && value >= 0;
const stripeId = (value, kind) => typeof value === 'string'
  && new RegExp(`^${kind}_[A-Za-z0-9]{1,180}$`).test(value);

export class MembershipLedgerError extends Error {
  constructor(code, cause) {
    super(code, cause === undefined ? undefined : { cause });
    this.code = code;
  }
}
function reject(code = 'invalid_envelope') { throw new MembershipLedgerError(code); }
function fields(input, expected) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== expected.length
      || expected.some(key => !own(input, key))) reject();
  if (!validOwner(input.owner)) reject();
}
function paid(input) {
  if (input.paid !== true || input.currency !== 'usd'
      || !safeInt(input.amountCents) || input.amountCents <= 0) reject('unpaid_or_invalid_amount');
}

// All serialization, validation and calculations precede ONE MSET. There are
// no TTLs on durable grant authority or standing balances. No event-level
// SETNX lock, INCR-then-marker or fallback read/modify/write path.
export const MEMBERSHIP_LEDGER_SCRIPT = `
local decoded,p=pcall(cjson.decode,ARGV[1])
if not decoded or type(p)~='table' then error('invalid envelope') end
local function same(a,b)
  if type(a)~=type(b) then return false end
  if type(a)~='table' then return a==b end
  for k,v in pairs(a) do if not same(v,b[k]) then return false end end
  for k,_ in pairs(b) do if a[k]==nil then return false end end
  return true
end
local function encode(value)
  local ok,raw=pcall(cjson.encode,value)
  if not ok or type(raw)~='string' then error('invalid encoding') end
  local valid,result=pcall(cjson.decode,raw)
  if not valid or not same(value,result) then error('invalid encoding') end
  return raw
end
local function read(key)
  local raw=redis.call('GET',key)
  if not raw then return nil end
  local ok,record=pcall(cjson.decode,raw)
  if not ok or type(record)~='table' or record.version~=p.version then
    error('invalid ledger')
  end
  return record
end
local function integer(value)
  return type(value)=='number' and value>=0 and value==math.floor(value)
    and value<=9007199254740990
end
local function counter(key)
  local value=redis.call('GET',key)
  if not value then return 0 end
  if not string.match(value,'^%d+$') then error('invalid balance') end
  local n=tonumber(value)
  if not integer(n) then error('invalid balance') end
  return n
end
local function fail(code) return encode({ok=false,code=code}) end
local writes={}
local function write(key,value)
  if type(key)~='string' or (type(value)~='string' and type(value)~='number') then
    error('invalid write')
  end
  if type(value)=='number' then
    if not integer(value) then error('invalid integer write') end
    -- Lua tostring rounds large integers and can emit scientific notation.
    -- Format exactly within the supported safe range, then validate BEFORE
    -- queuing any mutation. A provider formatting failure must fail closed.
    local ok,decimal=pcall(string.format,'%.0f',value)
    if not ok or type(decimal)~='string' or not string.match(decimal,'^%d+$')
      or tonumber(decimal)~=value then error('invalid integer formatting') end
    value=decimal
  end
  table.insert(writes,key); table.insert(writes,value)
end
local old=read(KEYS[1])
if old then
  if old.binding~=p.binding then return fail('operation_conflict') end
  if type(old.request_json)~='string' or not integer(old.applied_at) then error('invalid provenance') end
  local requestOK,request=pcall(cjson.decode,old.request_json)
  if not requestOK or not same(request,p) then error('invalid provenance') end
  if type(old.result_json)~='string' then error('invalid result') end
  local ok,result=pcall(cjson.decode,old.result_json)
  if not ok or type(result)~='table' or result.ok~=true
    or result.owner~=p.owner or result.kind~=p.kind then error('invalid result') end
  return old.result_json
end
local now=tonumber(redis.call('TIME')[1])
local result={ok=true,owner=p.owner,kind=p.kind,version=p.version}
if p.kind=='pack' or p.kind=='welcome' then
  local claimed=p.kind=='welcome'
    and (redis.call('EXISTS',KEYS[4])==1 or redis.call('EXISTS',KEYS[5])==1)
  result.granted=not claimed
  result.id_delta=claimed and 0 or p.idGrant
  result.grade_delta=claimed and 0 or p.gradeGrant
  if not integer(result.id_delta) or not integer(result.grade_delta) then error('invalid grant') end
  if not claimed then
    local id=counter(KEYS[2])+result.id_delta
    local grade=counter(KEYS[3])+result.grade_delta
    if not integer(id) or not integer(grade) then error('balance overflow') end
    -- Do not rewrite an unrelated bucket on a one-kind pack grant.
    if result.id_delta>0 then write(KEYS[2],id) end
    if result.grade_delta>0 then write(KEYS[3],grade) end
    if p.kind=='welcome' then write(KEYS[4],'1'); write(KEYS[5],'1') end
  end
elseif p.kind=='period' then
  if not integer(p.start) or not integer(p.finish) or p.finish<=p.start
    or not integer(p.idGrant) or not integer(p.gradeGrant) then error('invalid period') end
  -- A prepaid future invoice must retry at its period boundary. No activation
  -- scheduler is implemented in this dormant slice.
  if p.start>now then return fail('period_not_started') end
  local subscription=read(KEYS[6])
  if subscription and (subscription.owner~=p.owner or subscription.subscription~=p.subscription) then
    return fail('subscription_conflict')
  end
  local period=read(KEYS[4])
  local active=read(KEYS[5])
  if active and (active.owner~=p.owner or active.subscription~=p.subscription) then
    return fail('subscription_conflict')
  end
  if active and (not integer(active.start) or not integer(active.finish)
    or active.finish<=active.start or type(active.period_binding)~='string'
    or type(active.plan)~='string') then error('invalid active period') end
  if active and p.start==active.start then
    if active.period_binding~=p.periodBinding or active.finish~=p.finish or active.plan~=p.plan then
      return fail('period_conflict')
    end
    -- Missing allocation is corruption, not permission to refill used credits.
    if not period then error('missing active allocation') end
  end
  if period then
    if period.period_binding~=p.periodBinding or period.owner~=p.owner then
      return fail('period_conflict')
    end
    if period.subscription~=p.subscription or period.plan~=p.plan
      or period.start~=p.start or period.finish~=p.finish
      or period.id_grant~=p.idGrant or period.grade_grant~=p.gradeGrant then
      error('invalid period allocation')
    end
    if not integer(period.id_used) or not integer(period.grade_used)
      or period.id_used>p.idGrant or period.grade_used>p.gradeGrant then error('invalid period usage') end
    -- A distinct paid invoice for the same period records zero new allocation.
    -- Never reset period usage or return an old period to active.
    result.granted=false
  else
    if active and p.start~=active.start and p.start<active.finish and p.finish>active.start then
      return fail('period_overlap')
    end
    period={version=p.version,owner=p.owner,subscription=p.subscription,
      plan=p.plan,start=p.start,finish=p.finish,period_binding=p.periodBinding,
      id_grant=p.idGrant,grade_grant=p.gradeGrant,id_used=0,grade_used=0}
    write(KEYS[4],encode(period))
    result.granted=true
  end
  result.id_delta=result.granted and p.idGrant or 0
  result.grade_delta=result.granted and p.gradeGrant or 0
  result.period_start=p.start; result.period_end=p.finish
  result.active=(not active or p.start>=active.start) and now<p.finish
  if result.active and not active then
    write(KEYS[5],encode({version=p.version,owner=p.owner,subscription=p.subscription,
      plan=p.plan,start=p.start,finish=p.finish,period_binding=p.periodBinding}))
  elseif result.active and p.start>active.start then
    write(KEYS[5],encode({version=p.version,owner=p.owner,subscription=p.subscription,
      plan=p.plan,start=p.start,finish=p.finish,period_binding=p.periodBinding}))
  end
  if not subscription then
    write(KEYS[6],encode({version=p.version,owner=p.owner,subscription=p.subscription}))
  end
else return fail('invalid_kind') end
local response=encode(result)
local request=encode(p)
write(KEYS[1],encode({version=p.version,binding=p.binding,
  applied_at=now,request_json=request,result_json=response}))
redis.call('MSET',unpack(writes))
return response
`;

// Pure preparation is exported for review/testing. No caller-supplied key or
// command is accepted. Canonical payment ID MUST be the same verified Stripe
// PaymentIntent on webhook and return paths, not event ID/session ID aliases.
export function prepareMembershipGrant(kind, input) {
  const owner = input?.owner;
  let normalized, operation, extra = ['unused:4', 'unused:5', 'unused:6'];
  if (kind === 'pack') {
    fields(input, ['owner', 'paymentId', 'packId', 'plan', 'currency', 'amountCents', 'paid']);
    paid(input);
    if (!stripeId(input.paymentId, 'pi')) reject();
    let quote;
    try { quote = quoteLaunchPack(input.packId, input.plan); } catch { reject(); }
    if (quote.amountCents !== input.amountCents) reject('amount_mismatch');
    normalized = { version: MEMBERSHIP_VERSION, kind, owner, payment: input.paymentId,
      pack: input.packId, plan: input.plan, currency: input.currency, amount: input.amountCents,
      idGrant: quote.kind === 'id' ? quote.credits : 0,
      gradeGrant: quote.kind === 'grade' ? quote.credits : 0 };
    operation = `payment:${digest(input.paymentId)}`;
  } else if (kind === 'period') {
    fields(input, ['owner', 'invoiceId', 'subscriptionId', 'plan', 'periodStart',
      'periodEnd', 'currency', 'amountCents', 'paid']);
    paid(input);
    if (!stripeId(input.invoiceId, 'in') || !stripeId(input.subscriptionId, 'sub')
        || !own(LAUNCH_PLANS, input.plan) || input.plan === 'free'
        || !safeInt(input.periodStart) || !safeInt(input.periodEnd)
        || input.periodEnd <= input.periodStart) reject();
    const plan = LAUNCH_PLANS[input.plan];
    const period = { version: MEMBERSHIP_VERSION, kind, owner,
      subscription: input.subscriptionId, plan: input.plan,
      start: input.periodStart, finish: input.periodEnd,
      idGrant: plan.idCredits, gradeGrant: plan.gradeCredits };
    normalized = { ...period, invoice: input.invoiceId,
      currency: input.currency, amount: input.amountCents,
      periodBinding: digest(JSON.stringify(period)) };
    operation = `invoice:${digest(input.invoiceId)}`;
    extra = [
      `${prefix}period:${digest(`${input.subscriptionId}:${input.periodStart}`)}`,
      `${prefix}active:${digest(owner)}`,
      `${prefix}subscription:${digest(input.subscriptionId)}`,
    ];
  } else if (kind === 'welcome') {
    fields(input, ['owner', 'email', 'verified']);
    if (input.verified !== true || typeof input.email !== 'string') reject('unverified');
    const email = input.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) reject();
    normalized = { version: MEMBERSHIP_VERSION, kind, owner, emailHash: digest(email),
      idGrant: LAUNCH_WELCOME_CREDITS.idCredits, gradeGrant: LAUNCH_WELCOME_CREDITS.gradeCredits };
    operation = `welcome:${digest(owner)}`;
    extra = [`signup_bonus:${owner}`, `email_bonus_claimed:${email}`, 'unused:6'];
  } else reject('invalid_kind');
  const p = { ...normalized, binding: digest(JSON.stringify(normalized)) };
  const balanceKeys = kind === 'welcome' ? membershipWelcomeKeys(owner)
    : { id: `scans:${owner}:id_paid_left`, grade: `scans:${owner}:paid_left` };
  return { command: ['EVAL', MEMBERSHIP_LEDGER_SCRIPT, 6,
    `${prefix}${operation}`, balanceKeys.id, balanceKeys.grade,
    ...extra, JSON.stringify(p)], binding: p.binding, kind, owner };
}

export async function grantMembership(execute, kind, verifiedEnvelope) {
  if (typeof execute !== 'function') reject('ledger_unavailable');
  const prepared = prepareMembershipGrant(kind, verifiedEnvelope);
  let result;
  try {
    const raw = await execute(prepared.command);
    if (typeof raw !== 'string') throw new Error('invalid ledger response');
    result = JSON.parse(raw);
    if (!result || typeof result.ok !== 'boolean') throw new Error('invalid ledger response');
    if (result.ok && (result.owner !== prepared.owner || result.kind !== kind
        || result.version !== MEMBERSHIP_VERSION || typeof result.granted !== 'boolean'
        || !safeInt(result.id_delta) || !safeInt(result.grade_delta))) throw new Error('invalid ledger response');
    if (!result.ok && !['operation_conflict', 'subscription_conflict', 'period_conflict',
      'period_overlap', 'period_not_started', 'invalid_kind'].includes(result.code)) throw new Error('invalid ledger response');
  } catch (cause) { throw new MembershipLedgerError('ledger_unavailable', cause); }
  if (!result.ok) throw new MembershipLedgerError(result.code);
  return result;
}
