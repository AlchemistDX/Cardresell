// Versioned billing, not activated by this module. Inputs come from authenticated
// server routes; enrollment is a trusted migration/provisioning record, never a
// request field. Existing standing balances are NOT reclassified.
import { createHash } from 'node:crypto';
import { LAUNCH_PLANS, LAUNCH_WELCOME_CREDITS } from './_launchMembershipConfig.js';
import { membershipWelcomeKeys, membershipIncludedHistoryKey } from './_membershipLedger.js';

const hash = v => createHash('sha256').update(v).digest('hex');
const prefix = 'membership:launch-v2:';
const ownerOK = v => typeof v === 'string' && v.length > 0 && v.length <= 128 && !/[\s\x00-\x1f\x7f]/.test(v);
const receiptOK = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const membershipEnrollmentKey = owner => {
  if (!ownerOK(owner)) throw new Error('invalid_owner');
  return `${prefix}consumer:${hash(owner)}`;
};
export const membershipReceiptKey = receipt => {
  if (!receiptOK(receipt)) throw new Error('invalid_receipt');
  return `${prefix}consumption:${receipt}`;
};

export class MembershipConsumptionError extends Error {
  constructor(code = 'billing_unavailable', cause) {
    super(code, cause === undefined ? undefined : { cause }); this.code = code;
  }
}

export const MEMBERSHIP_CONSUMPTION_SCRIPT = `
local p=cjson.decode(ARGV[1])
local now=tonumber(redis.call('TIME')[1])
local function same(a,b)
  if type(a)~=type(b) then return false end
  if type(a)~='table' then return a==b end
  for k,v in pairs(a) do if not same(v,b[k]) then return false end end
  for k,_ in pairs(b) do if a[k]==nil then return false end end
  return true
end
local function copy(a)
  if type(a)~='table' then return a end
  local b={}; for k,v in pairs(a) do b[k]=copy(v) end; return b
end
local function encode(v)
  local ok,s=pcall(cjson.encode,v)
  if not ok or type(s)~='string' then error('encoding_failed') end
  local good,x=pcall(cjson.decode,s)
  if not good or not same(v,x) then error('encoding_failed') end
  return s
end
local function read(k)
  local s=redis.call('GET',k)
  if not s then return nil end
  local ok,v=pcall(cjson.decode,s)
  if not ok or type(v)~='table' then error('corrupt_record') end
  return v
end
local function int(v) return type(v)=='number' and v>=0 and v<=9007199254740990 and v==math.floor(v) end
local function counter(k)
  local s=redis.call('GET',k)
  if not s then return 0 end
  if not string.match(s,'^%d+$') then error('corrupt_counter') end
  local n=tonumber(s); if not int(n) then error('corrupt_counter') end
  return n
end
local writes={}
local function write(k,v)
  if type(k)~='string' then error('invalid_write') end
  if type(v)=='number' then
    if not int(v) then error('counter_overflow') end
    v=string.format('%.0f',v)
  end
  if type(v)~='string' then error('invalid_write') end
  table.insert(writes,k); table.insert(writes,v)
end
local function fail(c) return encode({ok=false,code=c}) end
if redis.call('GET',KEYS[14])~='1' then return fail('membership_cutover_not_ready') end
local enrollment=read(KEYS[2])
if not enrollment or enrollment.version~='launch-v2' or enrollment.owner~=p.owner
  or enrollment.verified~=true or (enrollment.plan~='free' and enrollment.plan~='paid') then
  return fail('membership_not_ready')
end
local rec=read(KEYS[1])
if rec and (rec.version~='launch-v2' or rec.owner~=p.owner or rec.scan~=p.scan
  or rec.mode~=p.mode or rec.cost~=p.cost) then return fail('binding_mismatch') end
local bulkGrade=cjson.null
if type(enrollment.capabilities)=='table' and type(enrollment.capabilities.bulkGrade)=='boolean' then
  bulkGrade=enrollment.capabilities.bulkGrade
end
-- Server-owned capability, never inferred from the price/tier or request.
-- Recheck at atomic debit/retry admission, not only at an earlier status read.
if p.bulkGrade==true and ((p.action=='debit' and not rec) or p.action=='claim_retry') then
  if bulkGrade==cjson.null then return fail('membership_capability_unavailable') end
  if bulkGrade~=true then return fail('membership_capability_denied') end
end
local function replay()
  if type(rec.result_json)~='string' then error('corrupt_result') end
  local ok,v=pcall(cjson.decode,rec.result_json)
  if not ok or type(v)~='table' or v.ok~=true then error('corrupt_result') end
  return rec.result_json
end
local function validatePeriod(v)
  if not v or v.version~='launch-v2' or v.owner~=p.owner
    or not int(v.start) or not int(v.finish) or v.start>=v.finish
    or not int(v.id_grant) or not int(v.grade_grant)
    or not int(v.id_used) or not int(v.grade_used)
    or v.id_used>v.id_grant or v.grade_used>v.grade_grant then error('corrupt_period') end
end
local allocation=nil
local allocationKey=KEYS[4]
local allocationNew=false
local history=nil
local lots=nil
local function current()
  if allocation then return allocation end
  if enrollment.plan=='free' then
    -- Bounds are computed from Redis TIME by the server adapter, not the
    -- browser. Recheck them in the atomic operation (including month rollover).
    if now<p.monthStart or now>=p.monthEnd then error('period_changed') end
    if not int(enrollment.freeThrough) or enrollment.freeThrough>p.monthStart then error('corrupt_history') end
    allocation=read(KEYS[4])
    if allocation and enrollment.freeThrough~=p.monthStart then error('corrupt_history') end
    if not allocation then
      if enrollment.freeThrough==p.monthStart then error('missing_allocation') end
      allocation={version='launch-v2',owner=p.owner,plan='free',start=p.monthStart,
        finish=p.monthEnd,id_grant=p.plans.free.idCredits,grade_grant=p.plans.free.gradeCredits,
        id_used=0,grade_used=0}
      allocationNew=true
    end
    validatePeriod(allocation)
    if allocation.plan~='free' or allocation.start~=p.monthStart or allocation.finish~=p.monthEnd
      or allocation.id_grant~=p.plans.free.idCredits or allocation.grade_grant~=p.plans.free.gradeCredits then error('corrupt_period') end
  else
    local activeRaw=redis.call('GET',KEYS[3])
    if not activeRaw or activeRaw~=p.activeRaw then error('period_changed') end
    local active=read(KEYS[3]); allocation=read(KEYS[4])
    validatePeriod(allocation)
    local plan=p.plans[active.plan]
    local sub=read(KEYS[9])
    if not plan or active.plan=='free' or active.version~='launch-v2' or active.owner~=p.owner
      or active.subscription~=enrollment.subscription
      or not sub or sub.version~='launch-v2' or sub.owner~=p.owner or sub.subscription~=active.subscription
      or allocation.subscription~=active.subscription or allocation.plan~=active.plan
      or allocation.start~=active.start or allocation.finish~=active.finish
      or type(active.period_binding)~='string' or allocation.period_binding~=active.period_binding
      or allocation.id_grant~=plan.idCredits or allocation.grade_grant~=plan.gradeCredits
      or now<allocation.start then error('corrupt_authority') end
  end
  return allocation
end
local id=p.mode=='identify'
local usedField=id and 'id_used' or 'grade_used'
local grantField=id and 'id_grant' or 'grade_grant'
local welcomeKey=id and KEYS[5] or KEYS[6]
local paidKey=id and KEYS[7] or KEYS[8]
local function includedLots()
  if lots then return lots end
  current()
  history=read(KEYS[15])
  if not history then
    if not allocationNew or enrollment.freeThrough~=0 or p.activeRaw~=cjson.null then error('missing included history') end
    history={version='launch-v2',owner=p.owner,policy='nonexpiring-v1',count=0,periods={}}
  end
  if history.version~='launch-v2' or history.owner~=p.owner or history.policy~='nonexpiring-v1'
    or not int(history.count) or history.count>1200 or type(history.periods)~='table'
    or #history.periods~=history.count then error('corrupt_history') end
  lots={}; local seen={}; local entries=0
  for i,key in pairs(history.periods) do
    entries=entries+1
    if type(i)~='number' or i<1 or i>history.count or i~=math.floor(i)
      or type(key)~='string' or seen[key]
      or (not string.match(key,'^membership:launch%-v2:period:[a-f0-9]+$')
        and not string.match(key,'^membership:launch%-v2:free_period:[a-f0-9]+:%d+$')) then error('corrupt_history') end
    seen[key]=true
    local value=key==allocationKey and allocation or read(key)
    validatePeriod(value)
    if value.start>now then error('corrupt_history') end
    table.insert(lots,{key=key,value=value})
  end
  if entries~=history.count then error('corrupt_history') end
  if allocationNew then
    if seen[allocationKey] or history.count>=1200 then error('corrupt_history') end
    history.count=history.count+1; table.insert(history.periods,allocationKey)
    table.insert(lots,{key=allocationKey,value=allocation})
  elseif not seen[allocationKey] then error('missing included allocation') end
  table.sort(lots,function(a,b)
    if a.value.start==b.value.start then return a.key<b.key end
    return a.value.start<b.value.start
  end)
  return lots
end
local function balances()
  local monthly=0
  for _,lot in ipairs(includedLots()) do
    monthly=monthly+lot.value[grantField]-lot.value[usedField]
    if not int(monthly) then error('balance_overflow') end
  end
  local welcome=counter(welcomeKey)
  if welcome>(id and p.welcome.idCredits or p.welcome.gradeCredits) then error('corrupt_welcome') end
  return monthly,welcome,counter(paidKey)
end
local function storeAllocation()
  if allocationNew then
    write(allocationKey,encode(allocation))
    write(KEYS[15],encode(history))
    enrollment.freeThrough=p.monthStart; write(KEYS[2],encode(enrollment))
  end
end
local function charge()
  local m,w,b=balances()
  local remaining=p.cost
  local sm=math.min(m,remaining); remaining=remaining-sm
  local sw=math.min(w,remaining); remaining=remaining-sw
  local sp=remaining
  if sp>b then return nil end
  local split={}; local left=sm
  for _,lot in ipairs(includedLots()) do
    local used=math.min(left,lot.value[grantField]-lot.value[usedField])
    if used>0 then
      lot.value[usedField]=lot.value[usedField]+used; left=left-used
      write(lot.key,encode(lot.value))
      table.insert(split,{period=lot.key,amount=used,period_start=lot.value.start,
        period_end=lot.value.finish,period_binding=lot.value.period_binding or ''})
    end
  end
  if left~=0 then error('corrupt_sources') end
  if allocationNew then storeAllocation() end
  if sw>0 then write(welcomeKey,w-sw) end
  if sp>0 then write(paidKey,b-sp) end
  local first=split[1] or {period=allocationKey,period_start=allocation.start,
    period_end=allocation.finish,period_binding=allocation.period_binding or ''}
  rec.sources={monthly=sm,welcome=sw,purchased=sp,period=first.period,
    period_start=first.period_start,period_end=first.period_end,period_binding=first.period_binding,
    included=split,policy='nonexpiring-v1'}
  local bucket=id and (sp==p.cost and 'id_paid_left' or 'id_free')
    or (sp==p.cost and 'paid_left' or 'free')
  return {ok=true,bucket=bucket,charged=p.cost,remaining=m-sm+w-sw+b-sp,
    free_remaining=m-sm+w-sw,paid_remaining=b-sp,billing_version='launch-v2'}
end
local function restore()
  local s=rec.sources
  if type(s)~='table' or not int(s.monthly) or not int(s.welcome) or not int(s.purchased)
    or s.monthly+s.welcome+s.purchased~=rec.cost then error('corrupt_sources') end
  if s.monthly>0 then
    local split=s.included
    if split==nil then
      -- Existing single-period receipts retain their exact source authority.
      if s.policy~=nil then error('corrupt_sources') end
      split={{period=s.period,amount=s.monthly,period_start=s.period_start,
        period_end=s.period_end,period_binding=s.period_binding}}
    elseif s.policy~='nonexpiring-v1' or type(split)~='table' or #split<1 or #split>p.cost
      or split[1].period~=s.period or split[1].period_start~=s.period_start
      or split[1].period_end~=s.period_end or split[1].period_binding~=s.period_binding then error('corrupt_sources') end
    local total=0; local seen={}
    for _,part in ipairs(split) do
      if type(part.period)~='string' or seen[part.period] or not int(part.amount) or part.amount==0
        or (not string.match(part.period,'^membership:launch%-v2:free_period:[a-f0-9]+:%d+$')
          and not string.match(part.period,'^membership:launch%-v2:period:[a-f0-9]+$')) then error('corrupt_sources') end
      seen[part.period]=true; total=total+part.amount
      local old=read(part.period); validatePeriod(old)
      if old.start~=part.period_start or old.finish~=part.period_end
        or (old.period_binding or '')~=part.period_binding or old[usedField]<part.amount then error('corrupt_refund') end
      old[usedField]=old[usedField]-part.amount; write(part.period,encode(old))
    end
    if total~=s.monthly then error('corrupt_sources') end
  end
  if s.welcome>0 then
    local n=counter(welcomeKey)+s.welcome
    if n>(id and p.welcome.idCredits or p.welcome.gradeCredits) then error('corrupt_refund') end
    write(welcomeKey,n)
  end
  if s.purchased>0 then write(paidKey,counter(paidKey)+s.purchased) end
end
local function scanAuthority()
  local scan=read(KEYS[10])
  return scan and scan.uid==p.owner and scan.membership_receipt==p.receipt
    and scan.billing_version=='launch-v2' and scan.mode==p.mode and scan.consumed_amount==p.cost
    and int(scan.published_at) and now<scan.published_at+3600
end
local result
local refundRemaining=nil
if p.action=='snapshot' or p.action=='renew_free' then
  local m,w,b=balances()
  result={ok=true,monthly=m,welcome=w,purchased=b,remaining=m+w+b,
    period_start=allocation.start,period_end=allocation.finish,period_active=now<allocation.finish,
    plan=allocation.plan,bulk_grade=bulkGrade,billing_version='launch-v2'}
  if p.action=='snapshot' then return encode(result) end
  if enrollment.plan~='free' then return fail('invalid_action') end
  if allocationNew then storeAllocation() end
  local out=encode(result)
  if #writes>0 then redis.call('MSET',unpack(writes)) end
  return out
elseif p.action=='debit' then
  if rec and rec.state=='debited' then return replay() end
  if rec then return fail('already_reserved') end
  rec={version='launch-v2',owner=p.owner,scan=p.scan,mode=p.mode,cost=p.cost,state='debited'}
  result=charge(); if not result then return fail('no_credits') end
elseif p.action=='refund' or p.action=='manual_refund' then
  if rec and rec.state=='refunded' then return replay() end
  if rec and rec.retry_used then return fail('invalid_state') end
  if p.action=='manual_refund' then
    if not rec then return fail('missing_reservation') end
    if rec.state=='refunded' then return replay() end
    if rec.state~='debited' or rec.retry_used then return fail('invalid_state') end
    if not scanAuthority() then return fail('expired_confirmation') end
    local rate=read(KEYS[11]) or {start=now,count=0}
    if not int(rate.start) or not int(rate.count) or rate.start>now then error('corrupt_rate') end
    if now>=rate.start+86400 then rate={start=now,count=0} end
    if rate.count>=3 then return fail('refund_cap') end
    rate.count=rate.count+1; write(KEYS[11],encode(rate))
    refundRemaining=3-rate.count
    write(KEYS[12],encode({uid=p.owner,scan_id=p.scan,refunded_amount=p.cost,refunded_at=now}))
  end
  if not rec then rec={version='launch-v2',owner=p.owner,scan=p.scan,mode=p.mode,cost=p.cost,state='cancelled'} end
  if rec.state=='accepted' then return fail('invalid_state') end
  local charged=rec.state=='debited'
  if charged then restore(); rec.state='refunded' end
  result={ok=true,success=true,credits_refunded=charged and rec.cost or 0}
  if refundRemaining~=nil then result.remaining_refunds_today=refundRemaining end
elseif p.action=='offer' then
  if not id then return fail('invalid_action') end
  if rec and rec.state=='pending' then
    if rec.candidate_set~=p.candidate_set then return fail('candidate_mismatch') end
    if now>=rec.expires then return fail('expired_confirmation') end
    return encode({ok=true,expires=rec.expires})
  end
  if not rec or (rec.state~='debited' and rec.state~='retry') then return fail('invalid_state') end
  if rec.state=='debited' then restore() else rec.zero_cost=true end
  rec.state='pending'; rec.candidates=p.candidates; rec.candidate_set=p.candidate_set
  rec.sources=nil; rec.expires=now+900
  result={ok=true,expires=rec.expires}
elseif p.action=='accept' then
  if not id or not rec then return fail('missing_confirmation') end
  if rec.candidate_set~=p.candidate_set then return fail('candidate_mismatch') end
  local selected=nil
  if type(rec.candidates)~='table' then error('corrupt_candidates') end
  for _,c in ipairs(rec.candidates) do if c.hash==p.candidate then selected=c.card end end
  if type(selected)~='table' then return fail('candidate_mismatch') end
  if rec.state=='accepted' then
    if rec.selected~=p.candidate then return fail('selection_mismatch') end
    return replay()
  end
  if rec.state~='pending' then return fail('invalid_state') end
  if not int(rec.expires) or now>=rec.expires then return fail('expired_confirmation') end
  result=rec.zero_cost and {ok=true,bucket='id_retry',charged=0,billing_version='launch-v2'} or charge()
  if not result then return fail('no_credits') end
  result.pickedCard=copy(selected); result.scan_id=p.scan
  rec.state='accepted'; rec.selected=p.candidate
elseif p.action=='claim_retry' then
  if not rec or rec.state~='debited' or not scanAuthority() then return encode({ok=true,claimed=false}) end
  if rec.retry_used then return encode({ok=true,claimed=rec.retry_receipt==p.retry_receipt and rec.retry_scan==p.retry_scan}) end
  if redis.call('EXISTS',KEYS[12])==1 then return encode({ok=true,claimed=false}) end
  if redis.call('EXISTS',KEYS[13])==1 then return fail('binding_mismatch') end
  rec.retry_used=true; rec.retry_receipt=p.retry_receipt; rec.retry_scan=p.retry_scan
  write(KEYS[13],encode({version='launch-v2',owner=p.owner,scan=p.retry_scan,mode=p.mode,
    cost=p.cost,state='retry',origin=p.receipt}))
  result={ok=true,claimed=true}
  -- Keep the original debit response intact, not the retry response.
  local response=encode(result); write(KEYS[1],encode(rec))
  redis.call('MSET',unpack(writes)); return response
elseif p.action=='publish' then
  if not rec or rec.state~='debited' then return fail('invalid_state') end
  if rec.published then return encode({ok=true,published=true}) end
  local scan=copy(p.scanRecord)
  scan.uid=p.owner; scan.mode=p.mode; scan.consumed_amount=p.cost
  scan.membership_receipt=p.receipt; scan.billing_version='launch-v2'; scan.published_at=now
  write(KEYS[10],encode(scan)); rec.published=true
  local response=encode({ok=true,published=true}); write(KEYS[1],encode(rec))
  redis.call('MSET',unpack(writes)); return response
else return fail('invalid_action') end
local response=encode(result)
rec.result_json=response
write(KEYS[1],encode(rec))
redis.call('MSET',unpack(writes))
return response
`;

const actions = new Set(['debit', 'refund', 'manual_refund', 'offer', 'accept', 'claim_retry', 'publish', 'snapshot', 'renew_free']);
export function createMembershipConsumption({ execute }) {
  if (typeof execute !== 'function') throw new MembershipConsumptionError();
  return async function consume(action, input) {
    const { owner, receipt, scan, mode = 'identify', cost = 1 } = input || {};
    if (!actions.has(action) || !ownerOK(owner) || !receiptOK(receipt)
      || typeof scan !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(scan)
      || !['identify', 'grade'].includes(mode) || ![1, 2].includes(cost)
      || (mode === 'identify' && cost !== 1)) throw new MembershipConsumptionError('invalid_confirmation');
    if (action === 'offer' && (!Array.isArray(input.candidates) || !input.candidates.length
      || input.candidates.length > 200 || Buffer.byteLength(JSON.stringify(input.candidates)) > 256000
      || !receiptOK(input.candidate_set)
      || input.candidates.some(c => !receiptOK(c.hash) || !c.card || typeof c.card !== 'object'))) {
      throw new MembershipConsumptionError('invalid_candidates');
    }
    if (action === 'accept' && (!receiptOK(input.candidate_set) || !receiptOK(input.candidate))) {
      throw new MembershipConsumptionError('invalid_confirmation');
    }
    if (action === 'claim_retry' && (!receiptOK(input.retry_receipt)
      || !/^[A-Za-z0-9_-]{1,64}$/.test(input.retry_scan))) throw new MembershipConsumptionError('invalid_confirmation');
    if (action === 'publish' && (!input.scanRecord || typeof input.scanRecord !== 'object'
      || Buffer.byteLength(JSON.stringify(input.scanRecord)) > 32000)) throw new MembershipConsumptionError('invalid_record');
    try {
      const enrollmentKey = membershipEnrollmentKey(owner);
      const [time, enrollmentRaw, activeRaw] = await Promise.all([
        execute(['TIME']), execute(['GET', enrollmentKey]), execute(['GET', `${prefix}active:${hash(owner)}`]),
      ]);
      const seconds = Number(time?.[0]);
      if (!Number.isSafeInteger(seconds)) throw new Error('invalid_clock');
      const date = new Date(seconds * 1000);
      const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
      const monthEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000;
      const enrollment = enrollmentRaw === null ? null : JSON.parse(enrollmentRaw);
      let allocationKey = `${prefix}free_period:${hash(owner)}:${monthStart}`;
      let subscriptionKey = `${prefix}unused_subscription`;
      if (enrollment?.plan === 'paid') {
        // Missing/corrupt current authority must not block a completed receipt
        // replay or exact-source refund. The charge path validates it in Lua.
        let active;
        try { active = JSON.parse(activeRaw); } catch {}
        if (active && /^sub_[A-Za-z0-9]{1,180}$/.test(active.subscription) && Number.isSafeInteger(active.start)) {
          allocationKey = `${prefix}period:${hash(`${active.subscription}:${active.start}`)}`;
          subscriptionKey = `${prefix}subscription:${hash(active.subscription)}`;
        }
      }
      const welcome = membershipWelcomeKeys(owner);
      const raw = await execute(['EVAL', MEMBERSHIP_CONSUMPTION_SCRIPT, 15,
        membershipReceiptKey(receipt), enrollmentKey, `${prefix}active:${hash(owner)}`, allocationKey,
        welcome.id, welcome.grade, `scans:${owner}:id_paid_left`, `scans:${owner}:paid_left`,
        subscriptionKey, `scan:${scan}`, `${prefix}refund_rate:${hash(owner)}`, `scan_refund:${scan}`,
        action === 'claim_retry' ? membershipReceiptKey(input.retry_receipt) : `${prefix}unused_retry`,
        `${prefix}legacy_fence`,
        membershipIncludedHistoryKey(owner),
        JSON.stringify({ action, owner, receipt, scan, mode, cost, monthStart, monthEnd,
          bulkGrade: mode === 'grade' && input.bulkGrade === true,
          activeRaw, plans: LAUNCH_PLANS, welcome: LAUNCH_WELCOME_CREDITS,
          ...(action === 'offer' ? { candidates: input.candidates, candidate_set: input.candidate_set } : {}),
          ...(action === 'accept' ? { candidate_set: input.candidate_set, candidate: input.candidate } : {}),
          ...(action === 'claim_retry' ? { retry_receipt: input.retry_receipt, retry_scan: input.retry_scan } : {}),
          ...(action === 'publish' ? { scanRecord: input.scanRecord } : {}) })]);
      if (typeof raw !== 'string') throw new Error('invalid_response');
      const result = JSON.parse(raw);
      if (!result || typeof result.ok !== 'boolean' || (!result.ok && typeof result.code !== 'string')) throw new Error('invalid_response');
      if (result.ok) {
        const integer = n => Number.isSafeInteger(n) && n >= 0;
        if (action === 'debit' && (!integer(result.remaining) || result.charged !== cost
          || !['id_free', 'id_paid_left', 'free', 'paid_left'].includes(result.bucket))) throw new Error('invalid_response');
        if (action === 'accept' && (!result.pickedCard || typeof result.pickedCard !== 'object'
          || Array.isArray(result.pickedCard) || result.scan_id !== scan || ![0, 1].includes(result.charged))) throw new Error('invalid_response');
        if (['snapshot', 'renew_free'].includes(action) && (!['monthly', 'welcome', 'purchased', 'remaining', 'period_start', 'period_end'].every(k => integer(result[k]))
          || typeof result.period_active !== 'boolean' || !Object.hasOwn(LAUNCH_PLANS, result.plan)
          || (result.bulk_grade !== null && typeof result.bulk_grade !== 'boolean'))) throw new Error('invalid_response');
        if (action === 'offer' && !integer(result.expires)) throw new Error('invalid_response');
        if (action === 'claim_retry' && typeof result.claimed !== 'boolean') throw new Error('invalid_response');
        if (action === 'publish' && result.published !== true) throw new Error('invalid_response');
        if (['refund', 'manual_refund'].includes(action) && (result.success !== true || !integer(result.credits_refunded)
          || result.credits_refunded > cost)) throw new Error('invalid_response');
      }
      return result;
    } catch (cause) { throw new MembershipConsumptionError('billing_unavailable', cause); }
  };
}
