// Derived caches only. Listing authority, counts and durable operations never
// depend on these writes. Pending repair intent is committed with the draft.
import { listingAccountPrefix } from './_listingEnrollment.js';
import { draftKey, isDraftId, readStoredDraft, ERR } from './_draftStore.js';
import { draftsKey, skuDraftKey, indexFreshKey, draftRecordPattern, draftIdFromRecordKey } from './_draftIndex.js';

export const listingIndexIntentKey = (owner, id) => `${listingAccountPrefix(owner)}:index:${id}`;
export const LISTING_INDEX_SCRIPT = `
local raw=redis.call('GET',KEYS[1])
local ok,d=pcall(cjson.decode,raw or '')
if not ok or type(d)~='table' or d.schemaVersion~=2 or type(d.listingUsage)~='table' or d.listingUsage.v~=2
 or d.listingUsage.owner~=ARGV[1] or d.draftId~=ARGV[2] or d.sku~=ARGV[3]
 or (d.status~='draft' and d.status~='archived' and d.status~='deleted') then return 'INVALID' end
local pending=redis.call('GET',KEYS[4])
if pending then
 local good,p=pcall(cjson.decode,pending)
 if not good or type(p)~='table' or p.v~=2 or p.owner~=ARGV[1]
  or p.draftId~=d.draftId or p.sku~=d.sku or p.rev~=d.rev then return 'INVALID' end
end
-- Read/check types before derived writes. A late operation always uses CURRENT
-- state. Compare and delete of the SKU pointer happen in this same script.
local kind=redis.call('TYPE',KEYS[2]).ok
if kind~='none' and kind~='set' then return 'INVALID' end
local pointer=redis.call('GET',KEYS[3])
if (pointer or '')~=ARGV[4] then return 'RETRY' end
local replace=not pointer or pointer==d.draftId
if not replace and d.status~='deleted' then
 local otherRaw=redis.call('GET',KEYS[6])
 if not otherRaw then replace=true
 else
  local good,other=pcall(cjson.decode,otherRaw)
  if not good or type(other)~='table' or other.draftId~=pointer or other.sku~=d.sku
   or other.schemaVersion~=2 or type(other.listingUsage)~='table'
   or other.listingUsage.owner~=ARGV[1] then return 'INVALID' end
  replace=other.status=='deleted'
 end
end
redis.call('DEL',KEYS[5])
if d.status=='deleted' then
 redis.call('SREM',KEYS[2],d.draftId)
 if pointer==d.draftId then redis.call('DEL',KEYS[3]) end
else
 redis.call('SADD',KEYS[2],d.draftId)
 redis.call('EXPIRE',KEYS[2],15552000)
 -- Several instances may share a SKU; this cache must not steal another
 -- instance's pointer when an old operation is replayed.
 if replace then
  redis.call('SET',KEYS[3],d.draftId,'EX',15552000)
 end
end
redis.call('DEL',KEYS[4])
return 'OK'
`;

export async function repairListingIndex(kv, owner, draft) {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const pointer = await kv('GET', skuDraftKey(owner, draft.sku));
      if (pointer !== null && !isDraftId(pointer)) throw new Error('invalid_pointer');
      const answer = await kv('EVAL', LISTING_INDEX_SCRIPT, 6, draftKey(owner, draft.draftId),
        draftsKey(owner), skuDraftKey(owner, draft.sku), listingIndexIntentKey(owner, draft.draftId),
        indexFreshKey(owner), draftKey(owner, pointer || draft.draftId),
        owner, draft.draftId, draft.sku, pointer || '');
      if (answer === 'RETRY') continue;
      if (answer !== 'OK') throw new Error('repair_incomplete');
      return { indexed: true, degraded: false, repairRequired: false };
    }
    throw new Error('pointer_changed');
  } catch {
    return { indexed: false, degraded: true, repairRequired: true, recovery: 'retryOperationOrList' };
  }
}

// Complete bounded enumeration. Partial scan is NOT a successful recovery.
export async function repairPendingListingIndexes(kv, owner) {
  const prefix = `${listingAccountPrefix(owner)}:index:`;
  const intents = new Set();
  let cursor = '0';
  try {
    for (let page = 0; page < 100; page++) {
      const out = await kv('SCAN', cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      if (!Array.isArray(out) || out.length !== 2 || !/^\d+$/.test(String(out[0]))
          || !Array.isArray(out[1]) || out[1].some(k => typeof k !== 'string' || !k.startsWith(prefix))) throw new Error();
      out[1].forEach(k => intents.add(k));
      if (intents.size > 10000) throw new Error();
      cursor = String(out[0]);
      if (cursor === '0') break;
    }
    if (cursor !== '0') throw new Error();
    let degraded = false;
    for (const key of intents) {
      const raw = await kv('GET', key);
      if (raw === null) continue; // another repair completed
      if (typeof raw !== 'string') throw new Error();
      const p = JSON.parse(raw);
      if (!p || p.v !== 2 || p.owner !== owner || typeof p.draftId !== 'string'
          || typeof p.sku !== 'string' || listingIndexIntentKey(owner, p.draftId) !== key) throw new Error();
      const out = await repairListingIndex(kv, owner, p);
      degraded ||= out.degraded;
    }
    return { degraded };
  } catch { return { degraded: true }; }
}

// Opt-in read path reconciles caches against primary storage. Complete bounded
// SCAN, union rather than replacement, and positive reads before omission.
// This deliberately favors correctness over a new fast-path freshness protocol.
export async function listListingIds(kv, owner) {
  const pending = await repairPendingListingIndexes(kv, owner);
  let degraded = pending.degraded, indexed = null, scanned = [];
  try {
    indexed = await kv('SMEMBERS', draftsKey(owner));
    if (!Array.isArray(indexed) || indexed.some(x => !isDraftId(x))) throw new Error();
  } catch { indexed = null; degraded = true; }
  try {
    let cursor = '0';
    const seen = new Set();
    for (let page = 0; page < 100; page++) {
      const out = await kv('SCAN', cursor, 'MATCH', draftRecordPattern(owner), 'COUNT', 200);
      if (!Array.isArray(out) || out.length !== 2 || !/^\d+$/.test(String(out[0])) || !Array.isArray(out[1])) throw new Error();
      for (const key of out[1]) {
        const id = draftIdFromRecordKey(owner, key);
        if (!isDraftId(id)) throw new Error();
        seen.add(id);
      }
      if (seen.size > 10000) throw new Error();
      cursor = String(out[0]);
      if (cursor === '0') break;
    }
    if (cursor !== '0') throw new Error();
    scanned = [...seen];
  } catch {
    if (indexed === null || indexed.length === 0) return { draftIds: [], unavailable: true, degraded: true };
    degraded = true;
  }
  const ids = [...new Set([...(indexed || []), ...scanned])];
  if (ids.length > 10000) return { draftIds: [], unavailable: true, degraded: true };
  const kept = [];
  for (let offset = 0; offset < ids.length; offset += 8) {
    await Promise.all(ids.slice(offset, offset + 8).map(async id => {
      try {
        const raw = await kv('GET', draftKey(owner, id));
        if (raw === null) return; // positive absence, not a SCAN omission
        let d;
        try { d = JSON.parse(raw); } catch { kept.push(id); degraded = true; return; }
        const ours = d?.schemaVersion === 2 && d.listingUsage?.owner === owner && d.draftId === id;
        if (ours && (d.status === 'deleted' || !(indexed || []).includes(id))) {
          const repair = await repairListingIndex(kv, owner, d);
          degraded ||= repair.degraded;
        }
        if (readStoredDraft(raw).error !== ERR.DELETED) kept.push(id);
      } catch { kept.push(id); degraded = true; }
    }));
  }
  return { draftIds: kept, unavailable: false, degraded, reconciled: true, source: 'reconciled' };
}
