// Server-owned HTTP intent journal. It is not a credit ledger and never grants,
// refunds or expires claims. An uncertain provider attempt remains pending until
// explicit reconciliation; elapsed time alone is not authority to run it again.
import { createHash, randomBytes } from 'node:crypto';

const hash = s => createHash('sha256').update(s).digest('hex');
const hex = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const ownerOK = s => typeof s === 'string' && s.length > 0 && s.length <= 128
  && !/[\s\x00-\x1f\x7f]/.test(s);
export class MembershipScanIntentError extends Error {
  constructor(code = 'scan_intent_unavailable') { super(code); this.code = code; }
}
const deny = code => { throw new MembershipScanIntentError(code); };

// All JSON request fields other than the operation token are bound, including
// mode, photos and grading options. Property order alone is not a changed scan.
export function scanIntentDigest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) deny('invalid_scan_intent');
  const seen = new Set();
  const canonical = (value, depth = 0) => {
    if (depth > 32) deny('invalid_scan_intent');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (!value || typeof value !== 'object' || seen.has(value)) deny('invalid_scan_intent');
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) deny('invalid_scan_intent');
    seen.add(value);
    const result = Array.isArray(value)
      ? '[' + value.map(v => canonical(v, depth + 1)).join(',') + ']'
      : '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k], depth + 1)).join(',') + '}';
    seen.delete(value);
    return result;
  };
  const content = Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'operation_id'));
  return hash(canonical(content));
}

export const MEMBERSHIP_SCAN_INTENT_SCRIPT = `
local function equal(a,b)
  if type(a)~=type(b) then return false end
  if type(a)~='table' then return a==b end
  for k,v in pairs(a) do if not equal(v,b[k]) then return false end end
  for k,_ in pairs(b) do if a[k]==nil then return false end end
  return true
end
local function encode(value)
  local ok,encoded=pcall(cjson.encode,value)
  if not ok or type(encoded)~='string' then error('scan_intent_serialization') end
  local decodedOK,decoded=pcall(cjson.decode,encoded)
  if not decodedOK or not equal(value,decoded) then error('scan_intent_serialization') end
  return encoded
end
local action=ARGV[1]
local p=cjson.decode(ARGV[2])
local raw=redis.call('GET',KEYS[1])
local rec=nil
if raw then
  local ok,v=pcall(cjson.decode,raw)
  if not ok or type(v)~='table' then error('corrupt_scan_intent') end
  rec=v
  if rec.version~='launch-v2' or rec.owner~=p.owner or rec.operation~=p.operation
    or rec.digest~=p.digest then return encode({state='conflict'}) end
  if rec.receipt~=p.receipt or rec.scan~=p.scan or type(rec.claim)~='string'
    or #rec.claim~=64 or (rec.state~='running' and rec.state~='complete') then error('corrupt_scan_intent') end
end
local function response()
  if rec.state=='running' then return encode({state='pending',receipt=rec.receipt,scan=rec.scan}) end
  if type(rec.status)~='number' or rec.status<200 or rec.status>599 or rec.status~=math.floor(rec.status)
    or type(rec.body)~='string' then error('corrupt_scan_intent') end
  local ok,body=pcall(cjson.decode,rec.body)
  if not ok or type(body)~='table' then error('corrupt_scan_intent') end
  return encode({state='complete',status=rec.status,body=rec.body,receipt=rec.receipt,scan=rec.scan})
end
if action=='begin' then
  if rec then return response() end
  local entry={version='launch-v2',owner=p.owner,operation=p.operation,digest=p.digest,
    receipt=p.receipt,scan=p.scan,claim=p.claim,state='running'}
  local encoded=encode(entry)
  local out=encode({state='claimed',receipt=p.receipt,scan=p.scan})
  redis.call('SET',KEYS[1],encoded)
  return out
elseif action=='complete' then
  if not rec or rec.claim~=p.claim then return encode({state='conflict'}) end
  if rec.state=='complete' then
    if rec.status~=p.status or rec.body~=p.body then return encode({state='conflict'}) end
    return response()
  end
  if type(p.status)~='number' or p.status<200 or p.status>599 or p.status~=math.floor(p.status)
    or type(p.body)~='string' then error('invalid_scan_result') end
  local ok,body=pcall(cjson.decode,p.body)
  if not ok or type(body)~='table' then error('invalid_scan_result') end
  rec.state='complete';rec.status=p.status;rec.body=p.body
  local encoded=encode(rec)
  local out=response()
  redis.call('SET',KEYS[1],encoded)
  return out
end
error('invalid_scan_action')
`;

export function createMembershipScanIntents({ execute }) {
  if (typeof execute !== 'function') deny();
  const prepare = ({ owner, operation, digest }) => {
    if (!ownerOK(owner) || !hex(operation) || !hex(digest)) deny('invalid_scan_intent');
    const identity = hash(JSON.stringify(['launch-v2-scan', owner, operation]));
    return { key: `membership:launch-v2:scan_intent:${identity}`, owner, operation, digest,
      receipt: hash('receipt:' + identity), scan: hash('scan:' + identity).slice(0, 32) };
  };
  async function invoke(action, p) {
    let raw;
    try { raw = await execute(['EVAL', MEMBERSHIP_SCAN_INTENT_SCRIPT, 1, p.key, action, JSON.stringify(p)]); }
    catch { deny(); }
    let result;
    try { result = JSON.parse(raw); } catch { deny(); }
    if (!result || !['claimed', 'pending', 'complete', 'conflict'].includes(result.state)) deny();
    if (result.state === 'conflict') deny('scan_intent_conflict');
    if (result.receipt !== p.receipt || result.scan !== p.scan) deny();
    if (result.state === 'complete') {
      if (!Number.isInteger(result.status) || result.status < 200 || result.status > 599
        || typeof result.body !== 'string') deny();
      try { result.body = JSON.parse(result.body); } catch { deny(); }
      if (!result.body || typeof result.body !== 'object' || Array.isArray(result.body)) deny();
    }
    return result;
  }
  return Object.freeze({
    async begin(input) {
      const p = { ...prepare(input), claim: randomBytes(32).toString('hex') };
      const result = await invoke('begin', p);
      // Only the acknowledged winner receives this private completion token.
      // A lost begin response never permits another process to take over.
      return result.state === 'claimed' ? { ...result, authority: p } : result;
    },
    async complete(authority, status, body) {
      const expected = prepare(authority || {});
      if (!hex(authority?.claim) || Object.entries(expected).some(([k, v]) => authority[k] !== v)
        || !Number.isInteger(status) || status < 200 || status > 599
        || !body || typeof body !== 'object' || Array.isArray(body)) deny('invalid_scan_result');
      let serialized;
      try { serialized = JSON.stringify(body); } catch { deny('invalid_scan_result'); }
      if (typeof serialized !== 'string') deny('invalid_scan_result');
      return invoke('complete', { ...expected, claim: authority.claim, status, body: serialized });
    },
  });
}
