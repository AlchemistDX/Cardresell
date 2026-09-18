// Dormant listing-only v2 boundary. No bootstrap, entitlement issuance, object
// deletion or automatic migration. Flag OFF by default; ready authority must
// be installed by a separately reviewed, write-fenced bootstrap.
import { createHash } from 'node:crypto';
import { LAUNCH_PLANS } from './_launchMembershipConfig.js';
import { buildDraft, applyEdit, attachPacket, draftKey, isDraftId, SLOT_RULES, validateDraftForSlot } from './_draftStore.js';
import { lifecycleKey, lifecycleFenceKey, lifecycleLockKey, withLifecycleLock } from './_draftLifecycle.js';
import { selectMutation, validIdempotencyKey } from './_idempotency.js';
import { listingAccountPrefix } from './_listingEnrollment.js';
import { listingIndexIntentKey, repairListingIndex } from './_listingIndex.js';
import { indexFreshKey } from './_draftIndex.js';

export const listingV2Enabled = () => process.env.LISTING_USAGE_V2 === 'enabled';
export class ListingUsageError extends Error {
  constructor(code, usage) { super(code); this.code = code; if (usage) this.usage = usage; }
}
const insist = (ok, code = 'LISTING_STATE_INVALID') => { if (!ok) throw new ListingUsageError(code); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = v => Number.isSafeInteger(v) && v >= 0 && v < Number.MAX_SAFE_INTEGER;
const token = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v) && v === v.trim();
const sha = s => createHash('sha256').update(s).digest('hex');
const canonical = v => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (object(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  insist(v !== undefined && (typeof v !== 'number' || Number.isFinite(v)), 'LISTING_INPUT_INVALID');
  return JSON.stringify(v);
};
export function listingUsageKeys(owner, periodId = '') {
  insist(token(owner), 'LISTING_OWNER_INVALID');
  const base = listingAccountPrefix(owner);
  return { account: `${base}:account`, bootstrap: `${base}:bootstrap`,
    period: `${base}:period:${sha(periodId)}`, base };
}
const parse = raw => {
  insist(typeof raw === 'string' && raw.length <= 1_000_000);
  let value; try { value = JSON.parse(raw); } catch { insist(false); }
  insist(object(value)); return value;
};
const encode = v => {
  const s = JSON.stringify(v); insist(typeof s === 'string' && Buffer.byteLength(s) <= 1_000_000, 'LISTING_RECORD_LIMIT');
  insist(object(JSON.parse(s))); return s;
};
async function read(kv, key) {
  try {
    const raw = await kv('GET', key);
    insist(raw === null || typeof raw === 'string');
    return raw;
  } catch (e) { if (e instanceof ListingUsageError) throw e; throw new ListingUsageError('LISTING_UNAVAILABLE'); }
}

// All JSON strings and response bytes are prepared BEFORE the one MSET.
// Lua does no cjson.encode, mutation-dependent Redis command or fallible work
// after MSET. KEYS are server-derived, never caller-supplied.
export const LISTING_COMMIT_SCRIPT = `
local function decode(s)
  local ok,v=pcall(cjson.decode,s)
  if not ok or type(v)~='table' then error('listing invalid json') end
  return v
end
local p=decode(ARGV[1])
local old=redis.call('GET',KEYS[8])
if old then
  local op=decode(old)
  if op.v~=2 or op.owner~=p.owner or op.fingerprint~=p.fingerprint then return 'MISMATCH' end
  return old
end
if redis.call('GET',KEYS[6])~=p.fence or redis.call('GET',KEYS[7])~=p.token then return 'FENCED' end
for i=1,5 do
  local current=redis.call('GET',KEYS[i])
  if current~=(p.expected[i] or false) then return 'CAS' end
end
if redis.call('GET',KEYS[9])~=(p.cleanupExpected or false) then return 'CAS' end
if redis.call('GET',KEYS[10])~=(p.rowExpected or false) then return 'CAS' end
if p.admission then
  local now=tonumber(redis.call('TIME')[1])
  if now<p.start or now>=p.finish then return 'PERIOD' end
end
local writes={}
for i=1,5 do
  if p.next[i] then
    if type(p.next[i])~='string' then error('listing invalid value') end
    decode(p.next[i])
    table.insert(writes,KEYS[i]); table.insert(writes,p.next[i])
  end
end
if p.cleanup then
  if type(p.cleanup)~='string' then error('listing invalid cleanup') end
  decode(p.cleanup); table.insert(writes,KEYS[9]); table.insert(writes,p.cleanup)
end
if p.row then
  if type(p.row)~='string' then error('listing invalid row') end
  decode(p.row); table.insert(writes,KEYS[10]); table.insert(writes,p.row)
end
if type(p.operation)~='string' then error('listing invalid operation') end
local op=decode(p.operation)
if op.v~=2 or op.owner~=p.owner or op.fingerprint~=p.fingerprint then error('listing invalid operation') end
table.insert(writes,KEYS[8]); table.insert(writes,p.operation)
if type(p.indexIntent)~='string' then error('listing invalid index intent') end
decode(p.indexIntent)
table.insert(writes,KEYS[11]); table.insert(writes,p.indexIntent)
table.insert(writes,KEYS[12]); table.insert(writes,'dirty')
redis.call('MSET',unpack(writes))
return p.operation
`;

function authority(account, bootstrap, period, owner) {
  insist(account.v === 2 && account.owner === owner && token(account.epoch)
    && account.ready === true && integer(account.revision) && integer(account.active), 'LISTING_BOOTSTRAP_REQUIRED');
  insist(bootstrap.v === 2 && bootstrap.owner === owner && bootstrap.epoch === account.epoch
    && bootstrap.state === 'complete' && bootstrap.writerFence === 'v2-only'
    && bootstrap.creationPolicy === 'prospective', 'LISTING_BOOTSTRAP_REQUIRED');
  const e = account.entitlement;
  insist(object(e) && token(e.version) && Object.hasOwn(LAUNCH_PLANS, e.plan)
    && token(e.periodId) && integer(e.start) && integer(e.end) && e.end > e.start);
  insist(period.v === 2 && period.owner === owner && period.epoch === account.epoch
    && period.periodId === e.periodId && period.start === e.start && period.end === e.end
    && integer(period.created), 'LISTING_PERIOD_UNAVAILABLE');
  if (e.plan === 'free') {
    const d = new Date(e.start * 1000);
    insist(d.getUTCDate() === 1 && d.getUTCHours() === 0 && d.getUTCMinutes() === 0
      && d.getUTCSeconds() === 0 && e.end === Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000);
  }
  return { entitlement: e, caps: LAUNCH_PLANS[e.plan] };
}
function row(raw) {
  if (raw === null) return { v: 1, gen: 0, fence: 0, lastDraftId: null, lastDraftGen: null, lastState: null, reservedAt: null };
  const r = parse(raw);
  insist(r.v === 1 && integer(r.gen) && integer(r.fence)
    && (r.lastDraftId === null || isDraftId(r.lastDraftId))
    && (r.lastDraftGen === null || integer(r.lastDraftGen))
    && [null, 'live', 'deleted'].includes(r.lastState)
    && r.reservedAt === null, 'LISTING_LIFECYCLE_UNRESOLVED');
  insist(r.lastState !== 'live' || (r.lastDraftId !== null && r.lastDraftGen === r.gen), 'LISTING_LIFECYCLE_UNRESOLVED');
  return r;
}
function ownedDraft(raw, owner, epoch) {
  const d = parse(raw), u = d.listingUsage;
  insist(d.schemaVersion === 2 && isDraftId(d.draftId) && integer(d.rev) && d.rev > 0
    && object(u) && u.v === 2 && u.owner === owner && u.epoch === epoch
    && typeof u.active === 'boolean' && ['draft', 'archived', 'deleted'].includes(d.status)
    && u.active === (d.status === 'draft'), 'LISTING_BOOTSTRAP_REQUIRED');
  return d;
}
function operationResult(raw, owner, fingerprint) {
  const op = parse(raw);
  insist(op.v === 2 && op.owner === owner && op.fingerprint === fingerprint, 'LISTING_OPERATION_MISMATCH');
  insist(object(op.result) && object(op.result.draft) && op.result.draft.listingUsage?.owner === owner);
  return op.result;
}

function usageOf(account, period, entitlement, caps) {
  return { active: account.active, created: period.created, periodId: entitlement.periodId,
    activeLimit: caps.activeListings, creationLimit: caps.newListings,
    periodStart: entitlement.start, periodEnd: entitlement.end, periodTimeUnit: 'unix_seconds',
    creationResetsAt: entitlement.end, activeResetsAt: null, activeFreedBy: ['archive', 'delete'] };
}

export async function readListingUsage(kv, owner) {
  const keys = listingUsageKeys(owner), a = parse(await read(kv, keys.account));
  const b = parse(await read(kv, keys.bootstrap));
  insist(object(a.entitlement) && token(a.entitlement.periodId));
  const p = parse(await read(kv, listingUsageKeys(owner, a.entitlement.periodId).period));
  const { entitlement, caps } = authority(a, b, p, owner);
  return usageOf(a, p, entitlement, caps);
}

// Trusted service receives normalized create input, NOT raw req.body. No tier,
// usage total, period, target ID or entitlement is accepted from HTTP input.
export async function mutateListing(kv, owner, action, request, idempotencyKey) {
  insist(listingV2Enabled(), 'LISTING_DISABLED');
  insist(['create', 'archive', 'restore', 'delete', 'edit'].includes(action), 'LISTING_ACTION_INVALID');
  insist(validIdempotencyKey(idempotencyKey), 'LISTING_OPERATION_REQUIRED');
  const keys = listingUsageKeys(owner);
  let normalized, instanceId, slot, target;
  if (action === 'create') {
    const input = request.input;
    insist(object(input) && token(input.instanceId) && Object.hasOwn(SLOT_RULES, input.slot), 'LISTING_INPUT_INVALID');
    const generation = request.generation ?? 0;
    insist(integer(generation), 'LISTING_INPUT_INVALID');
    normalized = { action, generation, mutation: selectMutation('draft-create', input) };
    instanceId = input.instanceId; slot = input.slot;
    target = `drf_${sha(`${owner}:${idempotencyKey}`).slice(0, 32)}`;
  } else {
    insist(isDraftId(request.draftId) && integer(request.expectedRev) && request.expectedRev > 0, 'LISTING_INPUT_INVALID');
    normalized = { action, draftId: request.draftId, expectedRev: request.expectedRev };
    if (action === 'edit') {
      insist(object(request.patch), 'LISTING_INPUT_INVALID');
      insist(Object.keys(request.patch).every(k => ['title', 'price', 'notes', 'quantity'].includes(k)), 'LISTING_INPUT_INVALID');
      normalized.patch = request.patch;
      normalized.rebuild = request.rebuildContext ?? null;
      insist(typeof request.rebuildPacket !== 'function' || object(request.rebuildContext), 'LISTING_INPUT_INVALID');
    }
    target = request.draftId;
  }
  const fingerprint = sha(canonical(normalized));
  const opKey = `${keys.base}:op:${sha(idempotencyKey)}`;
  const replay = await read(kv, opKey);
  if (replay !== null) return { result: operationResult(replay, owner, fingerprint), replayed: true };
  if (action !== 'create') {
    const preliminary = parse(await read(kv, draftKey(owner, target)));
    instanceId = preliminary.instanceId; slot = preliminary.slot;
    insist(token(instanceId) && Object.hasOwn(SLOT_RULES, slot), 'LISTING_INPUT_INVALID');
  }
  const outcome = await withLifecycleLock(kv, owner, instanceId, slot, async ({ fence, token: lockToken }) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const op = await read(kv, opKey);
      if (op !== null) return { result: operationResult(op, owner, fingerprint), replayed: true };
      const accountRaw = await read(kv, keys.account), bootstrapRaw = await read(kv, keys.bootstrap);
      insist(accountRaw !== null && bootstrapRaw !== null, 'LISTING_BOOTSTRAP_REQUIRED');
      const account = parse(accountRaw), bootstrap = parse(bootstrapRaw);
      insist(object(account.entitlement) && token(account.entitlement.periodId), 'LISTING_PERIOD_UNAVAILABLE');
      const periodKey = listingUsageKeys(owner, account.entitlement.periodId).period;
      const periodRaw = await read(kv, periodKey);
      insist(periodRaw !== null, 'LISTING_PERIOD_UNAVAILABLE');
      const period = parse(periodRaw), { entitlement, caps } = authority(account, bootstrap, period, owner);
      const lifeKey = lifecycleKey(owner, instanceId, slot);
      const lifeRaw = await read(kv, lifeKey), life = row(lifeRaw);
      const rowKey = `${keys.base}:row:${sha(canonical([instanceId, slot]))}`;
      const rowRaw = await read(kv, rowKey);
      const rowRecord = { v: 2, owner, epoch: account.epoch, instanceId, slot, initialized: true };
      if (rowRaw !== null) {
        insist(canonical(parse(rowRaw)) === canonical(rowRecord) && lifeRaw !== null,
          'LISTING_LIFECYCLE_UNRESOLVED');
      } else {
        insist(lifeRaw === null, 'LISTING_LIFECYCLE_UNRESOLVED');
      }
      if (action === 'create') {
        insist(life.gen === normalized.generation, 'LISTING_GENERATION_STALE');
        target = life.lastState === 'live' ? life.lastDraftId : `drf_${sha(`${owner}:${idempotencyKey}`).slice(0, 32)}`;
      }
      const draftRaw = await read(kv, draftKey(owner, target));
      const cleanupKey = `${keys.base}:cleanup:${target}`;
      const cleanupRaw = await read(kv, cleanupKey);
      let next, delta = 0, creation = 0, existing = false, cleanup = false;
      let nextLife = { ...life, fence };
      if (action === 'create' && life.lastState !== 'live') {
        insist(draftRaw === null && cleanupRaw === null, 'LISTING_STATE_INVALID');
        next = buildDraft({ ...request.input, draftId: target });
        next.schemaVersion = 2;
        next.listingUsage = { v: 2, owner, epoch: account.epoch, active: true,
          createdPeriod: entitlement.periodId, createOperation: sha(idempotencyKey) };
        delta = 1; creation = 1;
        nextLife = { v: 1, gen: life.gen, fence, lastDraftId: target, lastDraftGen: life.gen, lastState: 'live', reservedAt: null };
      } else {
        insist(draftRaw !== null, 'LISTING_STATE_INVALID');
        next = ownedDraft(draftRaw, owner, account.epoch);
        insist(next.draftId === target && next.instanceId === instanceId && next.slot === slot);
        if (action === 'create') {
          insist(next.status !== 'deleted' && next.sku === request.input.sku, 'LISTING_STATE_INVALID');
          existing = true;
        } else {
          insist(next.rev === request.expectedRev, 'LISTING_REVISION_CONFLICT');
          const deleted = next.status === 'deleted';
          insist(deleted ? action === 'delete' && life.lastState === 'deleted' && life.lastDraftId === target
            : life.lastState === 'live' && life.lastDraftId === target, 'LISTING_LIFECYCLE_UNRESOLVED');
          if (deleted) {
            insist(cleanupRaw !== null, 'LISTING_CLEANUP_UNRESOLVED');
            const pending = parse(cleanupRaw);
            insist(pending.v === 2 && pending.owner === owner && pending.epoch === account.epoch
              && pending.draftId === target && pending.state === 'awaiting_photo_ledger'
              && pending.physicalDeletionAuthorized === false, 'LISTING_CLEANUP_UNRESOLVED');
          }
          if (action === 'edit') {
            // Existing pure validation and packet attachment rules; edits do
            // not admit a new active listing or consume a creation.
            next = applyEdit(next, request.patch, { expectedRev: request.expectedRev });
            if (typeof request.rebuildPacket === 'function') next = attachPacket(next, request.rebuildPacket(next));
          }
          const wanted = action === 'edit' ? next.status : action === 'archive' ? 'archived' : action === 'restore' ? 'draft' : 'deleted';
          if (wanted !== next.status) {
            insist(!deleted, 'LISTING_DELETED');
            const active = wanted === 'draft';
            delta = Number(active) - Number(next.listingUsage.active);
            if (wanted === 'deleted') {
              insist(cleanupRaw === null);
              cleanup = encode({ v: 2, owner, epoch: account.epoch, draftId: target,
                state: 'awaiting_photo_ledger', physicalDeletionAuthorized: false,
                snapshot: next });
              nextLife = { ...nextLife, gen: life.gen + 1, lastState: 'deleted' };
            }
            next = { ...next, status: wanted, rev: next.rev + 1, updatedAt: Date.now(),
              listingUsage: { ...next.listingUsage, active } };
          }
        }
      }
      insist(integer(next.rev) && integer(nextLife.gen) && integer(nextLife.fence));
      insist(integer(account.active + delta) && integer(period.created + creation));
      const usage = usageOf(account, period, entitlement, caps);
      if (delta > 0 && account.active + delta > caps.activeListings) throw new ListingUsageError('LISTING_ACTIVE_CAP', usage);
      if (creation > 0 && period.created + creation > caps.newListings) throw new ListingUsageError('LISTING_CREATION_CAP', usage);
      const changed = !existing && (draftRaw === null || encode(next) !== draftRaw);
      const afterAccount = changed ? { ...account, active: account.active + delta, revision: account.revision + 1 } : account;
      insist(integer(afterAccount.revision));
      const result = { saved: true, draftId: target, draft: next, generation: nextLife.gen, existing,
        lifecycle: { recorded: true, generation: nextLife.gen }, validation: validateDraftForSlot(next),
        usage: { ...usage, active: afterAccount.active, created: period.created + creation },
        // Immutable result records the atomic authority, not later cache health.
        degraded: true, repairRequired: true };
      const operation = encode({ v: 2, owner, fingerprint, action, result });
      const payload = encode({ owner, fingerprint, fence: String(fence), token: lockToken,
        expected: [accountRaw, bootstrapRaw, periodRaw, draftRaw ?? false, lifeRaw ?? false],
        next: [changed ? encode(afterAccount) : false, false,
          creation ? encode({ ...period, created: period.created + creation }) : false,
          changed ? encode(next) : false, changed ? encode(nextLife) : false],
        cleanupExpected: cleanupRaw ?? false, cleanup, operation,
        indexIntent: encode({ v: 2, owner, draftId: target, sku: next.sku, rev: next.rev }),
        rowExpected: rowRaw ?? false, row: rowRaw === null ? encode(rowRecord) : false,
        admission: delta > 0, start: entitlement.start, finish: entitlement.end });
      let raw;
      try {
        raw = await kv('EVAL', LISTING_COMMIT_SCRIPT, 12, keys.account, keys.bootstrap, periodKey,
          draftKey(owner, target), lifeKey, lifecycleFenceKey(owner, instanceId, slot),
          lifecycleLockKey(owner, instanceId, slot), opKey, cleanupKey, rowKey,
          listingIndexIntentKey(owner, target), indexFreshKey(owner), payload);
      } catch { throw new ListingUsageError('LISTING_OUTCOME_UNKNOWN'); }
      if (raw === 'CAS') continue;
      insist(raw !== 'FENCED', 'LISTING_FENCED');
      insist(raw !== 'PERIOD', 'LISTING_PERIOD_EXPIRED');
      insist(raw !== 'MISMATCH', 'LISTING_OPERATION_MISMATCH');
      return { result: operationResult(raw, owner, fingerprint), replayed: false };
    }
    throw new ListingUsageError('LISTING_CONCURRENT_CHANGE');
  });
  insist(outcome && outcome.result, 'LISTING_BUSY');
  return outcome;
}

export async function mutateListingWithIndexes(kv, owner, action, request, idempotencyKey) {
  const out = await mutateListing(kv, owner, action, request, idempotencyKey);
  const index = await repairListingIndex(kv, owner, out.result.draft);
  return { ...out, result: { ...out.result, index, degraded: index.degraded, repairRequired: index.repairRequired } };
}

// Body-form Redis REST transport for the opt-in path: large draft+CAS payloads
// must not travel in a URL. No arbitrary HTTP endpoint is accepted from users.
export function makeListingKv(url, tokenValue) {
  return async (...args) => {
    const response = await fetch(url, { method: 'POST', redirect: 'error',
      signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${tokenValue}`,
        'Content-Type': 'application/json' }, body: JSON.stringify(args.map(String)) });
    insist(response.ok, 'LISTING_UNAVAILABLE');
    const value = await response.json();
    insist(object(value) && !Object.hasOwn(value, 'error') && Object.hasOwn(value, 'result'), 'LISTING_UNAVAILABLE');
    return value.result;
  };
}
