// Permanent draft-capacity membership, separate from expiring discovery indexes.
// Admission and the authoritative record write commit in the same Lua command.
// No expiring reservations, fail-open admission or counter reset can oversubscribe.
const part = value => encodeURIComponent(String(value));
export const capacityKeys = owner => ({ set: `draftcapacity:${part(owner)}`, ready: `draftcapacityready:${part(owner)}`,
  prefix: `draft:${part(owner)}:` });
const fail = () => { throw Error('DRAFT_CAPACITY_UNAVAILABLE'); };
const LIVE = `
local function live(key)
 local raw=redis.call('GET',key)
 if not raw then return false end
 local ok,d=pcall(cjson.decode,raw)
 if not ok or type(d)~='table' or type(d.status)~='string' then error('draft unreadable') end
 return d.status~='deleted'
end
`;
export const CAPACITY_SEED_SCRIPT = LIVE + `
if redis.call('EXISTS',KEYS[2])==1 then return 1 end
local ids=cjson.decode(ARGV[2])
local valid={}
for _,id in ipairs(ids) do if live(ARGV[1]..id) then table.insert(valid,id) end end
redis.call('SCARD',KEYS[1])
for _,id in ipairs(valid) do redis.call('SADD',KEYS[1],id) end
redis.call('SET',KEYS[2],tostring(redis.call('SCARD',KEYS[1])))
return 1
`;
export async function ensureDraftCapacity(kv, owner) {
  const k = capacityKeys(owner);
  if (await kv('GET', k.ready) !== null) return;
  let cursor = '0', rounds = 0; const ids = new Set();
  do {
    const page = await kv('SCAN', cursor, 'MATCH', k.prefix + '*', 'COUNT', '500');
    if (!Array.isArray(page) || page.length !== 2 || !Array.isArray(page[1]) || !/^\d+$/.test(String(page[0]))) fail();
    for (const key of page[1]) {
      if (typeof key !== 'string' || !key.startsWith(k.prefix)) fail();
      const id = key.slice(k.prefix.length);
      if (!/^drf_[a-f0-9]{32}$/.test(id)) fail();
      ids.add(id);
    }
    cursor = String(page[0]);
    // A truncated scan is never accepted as a baseline.
    if (++rounds > 10000 || ids.size > 20000) fail();
  } while (cursor !== '0');
  if (Number(await kv('EVAL', CAPACITY_SEED_SCRIPT, '2', k.set, k.ready, k.prefix, JSON.stringify([...ids]))) !== 1) fail();
}
export const CAPACITY_WRITE_SCRIPT = `
local cur=redis.call('GET',KEYS[1])
if cur and tonumber(cur)>tonumber(ARGV[1]) then return -1 end
local expected=redis.call('GET',KEYS[4])
local ready=expected~=false
local cap=tonumber(ARGV[4])
if cap>0 and not ready then return -3 end
local count=redis.call('SCARD',KEYS[3])
if ready and tonumber(expected)~=count then return -3 end
local member=redis.call('SISMEMBER',KEYS[3],ARGV[3])
if cap>0 and ARGV[5]~='deleted' and member==0 and count>=cap then return -2 end
if cap>0 then redis.call('MSET',KEYS[2],ARGV[2],KEYS[5],ARGV[6])
else redis.call('SET',KEYS[2],ARGV[2]) end
if ready then
 if ARGV[5]=='deleted' then redis.call('SREM',KEYS[3],ARGV[3])
 else redis.call('SADD',KEYS[3],ARGV[3]) end
 redis.call('SET',KEYS[4],tostring(redis.call('SCARD',KEYS[3])))
end
return 1
`;
// Existing records remain editable/deletable above the limit. Only a new
// service create passes a positive cap; reads, exports and edits do not.
export async function capacityFencedWrite(kv, owner, fenceKey, recordKey, fence, draft, cap = 0, lifecycle = null) {
  const k = capacityKeys(owner);
  if (cap > 0 && !lifecycle) fail();
  return Number(await kv('EVAL', CAPACITY_WRITE_SCRIPT, '5', fenceKey, recordKey, k.set, k.ready, lifecycle?.key || fenceKey,
    String(fence), JSON.stringify(draft), draft.draftId, String(cap), draft.status, lifecycle ? JSON.stringify(lifecycle.record) : '')); 
}
const COUNT_SCRIPT = LIVE + `
local expected=redis.call('GET',KEYS[2])
if not expected or tonumber(expected)~=redis.call('SCARD',KEYS[1]) then return -1 end
local dead={}
for _,id in ipairs(redis.call('SMEMBERS',KEYS[1])) do
 if not live(ARGV[1]..id) then table.insert(dead,id) end
end
for _,id in ipairs(dead) do redis.call('SREM',KEYS[1],id) end
local count=redis.call('SCARD',KEYS[1])
redis.call('SET',KEYS[2],tostring(count))
return count
`;
export async function draftCapacityUsage(kv, owner, policy) {
  await ensureDraftCapacity(kv, owner);
  const k=capacityKeys(owner);
  const count=Number(await kv('EVAL', COUNT_SCRIPT, '2', k.set,k.ready,k.prefix));
  if (!Number.isSafeInteger(count) || count<0) fail();
  return { ...policy, active: count, remaining: Math.max(0, policy.activeLimit-count),
    overLimit: count>policy.activeLimit, activeResetsAt: null, activeFreedBy: ['delete'] };
}
