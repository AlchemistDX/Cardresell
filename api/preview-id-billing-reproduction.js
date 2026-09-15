// TEMPORARY v6 diagnostic, MODULE layer only. Protected Preview + truly isolated
// injected Redis are deployment prerequisites, not guarantees this route proves.
// No auth/tier/customer/Stripe calls. Unchanged billing module; one fixed sequence.
import { randomBytes, createHash } from 'node:crypto';
import { idBilling, offerIdConfirmation, candidateHash, canonicalPick, IdBillingError, ID_BILLING_SCRIPT } from './_idBilling.js';
export const config = { maxDuration: 60 };
const PATH = '/api/preview-id-billing-reproduction';
// v1-v5 controls/evidence are never addressed or reset.
const CONTROL = 'preview_id_billing_reproduction:1e4122d:v6';
const END = Date.parse('2026-09-16T18:00:00Z');
const RECOVERY_END = Date.parse('2026-09-23T18:00:00Z');
const LIMIT = 8192, ARTIFACT_LIMIT = 400000;
const PHASES = ['debit', 'offer', 'accept'];
const CANDIDATES = [{ name: 'Synthetic fixture A', number: '1', set: 'Synthetic set A' },
  { name: 'Synthetic fixture B', number: '2', set: 'Synthetic set B' }];
const nonce = () => randomBytes(32).toString('hex');
const hash = v => createHash('sha256').update(v).digest('hex');
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const CODES = ['transport', 'upstream_status', 'response_json', 'upstream_error', 'result_shape',
  'billing_unavailable', 'billing_rejected', 'deadline', 'capture_invalid', 'capture_withheld',
  'checkpoint_unavailable', 'in_progress', 'missing_run', 'internal',
  'lua_invalid_encoding', 'lua_invalid_journal', 'lua_invalid_counter', 'lua_invalid_write', 'lua_other'];
class Diagnostic extends Error { constructor(code) { super('diagnostic'); this.code = code; } }
const codeOf = e => e instanceof Diagnostic && CODES.includes(e.code) ? e.code
  : e instanceof IdBillingError ? 'billing_unavailable' : 'internal';

// No CJSON encoding of journal bytes. Fixed numeric vector:
// [typeCode(0 absent/1 string/2 other), byteLength, bounded(0/1), ...exactBytes].
// One already-tracked synthetic key only; no writes, scans, or arbitrary command.
const BYTES = `
local raw=redis.call('GET',KEYS[1])
if raw==false then return {0,0,1} end
if type(raw)~='string' then return {2,0,0} end
local n=#raw
if n>8192 then return {1,n,0} end
local out={1,n,1}
for i=1,n do out[#out+1]=string.byte(raw,i) end
return out
`;
const LUA_ERRORS = ['lua_other', 'lua_invalid_encoding', 'lua_invalid_journal',
  'lua_invalid_counter', 'lua_invalid_write'];
const TRACE_PHASES = ['payloadDecode', 'journalDecode', 'resultEncode', 'resultDecode',
  'journalEncode', 'journalRoundtripDecode'];
const TRACE_TYPES = ['nil', 'string', 'table', 'other', 'throw'];
// The exact exported product script below is embedded verbatim, once. Lexical
// CJSON delegation forwards every argument/return (including nil) and rethrows
// the native error unchanged. No global mutation, copying or serialization retry.
// pcall DOES NOT ROLLBACK: snapshots bracket the real script inside the same
// EVAL. Both success and post-write errors therefore retain actual byte evidence.
// Envelope/trace/snapshots are Redis numeric arrays, never CJSON-encoded.
const INSTRUMENTED_ACCEPT = `
local native_cjson=cjson
local trace={-1,-1,-1,-1,-1,-1,-1}
local decodes=0
local function pack(...) return {n=select('#',...),...} end
local function kind(v)
  if v==nil then return 0 end
  if type(v)=='string' then return 1 end
  if type(v)=='table' then return 2 end
  return 3
end
local function bytes(key)
  local ok,raw=pcall(redis.call,'GET',key)
  if not ok then return {3,0,0} end
  if raw==false then return {0,0,1} end
  if type(raw)~='string' then return {2,0,0} end
  if #raw>8192 then return {1,#raw,0} end
  local out={1,#raw,1}
  for i=1,#raw do out[#out+1]=string.byte(raw,i) end
  return out
end
local function snapshot() return {bytes(KEYS[1]),bytes(KEYS[2]),bytes(KEYS[3])} end
local cjson={}
cjson.encode=function(...)
  local v=select(1,...)
  local slot=3
  if type(v)=='table' and v.state=='accepted' then
    slot=5
    if type(v.result)=='table' and type(v.candidates)=='table'
      and type(v.candidates[2])=='table' then
      trace[7]=v.result.pickedCard==v.candidates[2].card and 1 or 0
    end
  end
  local returned=pack(pcall(native_cjson.encode,...))
  trace[slot]=returned[1] and kind(returned[2]) or 4
  if not returned[1] then error(returned[2],0) end
  return unpack(returned,2,returned.n)
end
cjson.decode=function(...)
  decodes=decodes+1
  local slots={1,2,4,6}
  local returned=pack(pcall(native_cjson.decode,...))
  if slots[decodes] then trace[slots[decodes]]=returned[1] and kind(returned[2]) or 4 end
  if not returned[1] then error(returned[2],0) end
  return unpack(returned,2,returned.n)
end
local before=snapshot()
local success,value=pcall(function()
` + ID_BILLING_SCRIPT + `
end)
local after=snapshot()
local category=0
if not success and type(value)=='string' then
  if string.find(value,'invalid ID encoding',1,true) then category=1
  elseif string.find(value,'invalid ID journal',1,true) then category=2
  elseif string.find(value,'invalid ID counter',1,true) then category=3
  elseif string.find(value,'invalid ID write',1,true) then category=4 end
end
return {success and 1 or 0,category,trace,before,after,success and value or ''}
`;
// Control contains only synthetic identifiers, fixed metadata, and base64 of a
// JS-generated evidence document. Nested malformed journal strings never pass
// through CJSON encode as strings; base64 keeps the capture encoding independent.
// Durable consumed guard has NO TTL, is never deleted, and survives cleanup.
const CONTROL_SCRIPT = `
local action=ARGV[1]
local p=cjson.decode(ARGV[2])
local raw=redis.call('GET',KEYS[1])
local now=tonumber(redis.call('TIME')[1])*1000
if action=='claim' then
  if raw then return 0 end
  p.consumed=true;p.state='running';p.lease=now+60000;p.artifact=''
  redis.call('SET',KEYS[1],cjson.encode(p));return 1
end
if not raw then return 0 end
local r=cjson.decode(raw)
if action=='recover' then
  if (r.state=='running' or r.state=='recovering') and r.lease>now then return 0 end
  r.worker=p.worker;r.state='recovering';r.lease=now+60000
elseif action=='checkpoint' or action=='finish' then
  if r.worker~=p.worker or (r.state~='running' and r.state~='recovering') then return 0 end
  r.artifact=ARGV[3]
  if action=='finish' then r.state='complete';r.lease=0 end
else return 0 end
redis.call('SET',KEYS[1],cjson.encode(r));return 1
`;
async function kv(args) {
  let response, data;
  try {
    response = await fetch(process.env.KV_REST_API_URL, { method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(3000) });
  } catch (_) { throw new Diagnostic('transport'); }
  if (!response.ok) throw new Diagnostic('upstream_status');
  try { data = await response.json(); } catch (_) { throw new Diagnostic('response_json'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Diagnostic('result_shape');
  if (data.error) throw new Diagnostic('upstream_error');
  if (data.result === undefined) throw new Diagnostic('result_shape');
  return data.result;
}
function context(r) {
  return { owner: `preview-repro-${r.namespace}`, scan: `preview-repro-${r.namespace.slice(0, 32)}`,
    receipt: hash(`${r.namespace}:receipt`), stamp: r.stamp, grant: 1 };
}
function keys(r) {
  const c = context(r);
  return [`scans:${c.owner}:id_free_used_${r.stamp}`, `scans:${c.owner}:id_paid_left`,
    `id_billing:${c.receipt}`, `scan:${c.scan}`];
}
function validRecord(r) {
  return r && r.v === 6 && r.consumed === true && hex(r.namespace) && hex(r.worker)
    && /^\d{4}_(0[1-9]|1[0-2])$/.test(r.stamp) && Number.isSafeInteger(r.lease)
    && ['running', 'recovering', 'complete'].includes(r.state)
    && typeof r.artifact === 'string' && r.artifact.length <= ARTIFACT_LIMIT * 2
    && /^[A-Za-z0-9+/=]*$/.test(r.artifact);
}
async function record() {
  const raw = await kv(['GET', CONTROL]);
  if (raw === null) return null;
  let r;
  try { r = JSON.parse(raw); } catch (_) { throw new Diagnostic('result_shape'); }
  if (!validRecord(r)) throw new Diagnostic('result_shape');
  return r;
}
// Output contains exact bytes ONLY from our deterministic synthetic journal.
// Defense in depth: unknown ASCII vocabulary is withheld, not printed/redacted
// into something falsely claimed byte-faithful. Fixed vocabulary allows broken
// punctuation/escaping and invalid UTF-8 to remain intact for diagnosis.
function safeBytes(bytes, r) {
  const ctx = context(r);
  const vocabulary = JSON.stringify({ ...ctx, keys: keys(r), CANDIDATES,
    canonical: CANDIDATES.map(c => canonicalPick(c)),
    hashes: CANDIDATES.map(candidateHash),
    candidate_set: candidateHash(CANDIDATES.map(candidateHash)),
    fields: 'owner scan mode identify state debited pending accepted free_key result result_json '
      + 'ok bucket id_free id_paid_left remaining free_remaining paid_remaining pickedCard scan_id '
      + 'candidates hash card candidate_set expires zero_cost selected replay_expires '
      + 'true false null table nil NaN Infinity inf nan' });
  const allowed = new Set(vocabulary.match(/[A-Za-z0-9_]+/g));
  return bytes.length <= LIMIT && (Buffer.from(bytes).toString('latin1').match(/[A-Za-z0-9_]+/g) || [])
    .every(word => allowed.has(word) || /^\d+$/.test(word) || /^0x[a-f0-9]{1,16}$/.test(word));
}
function parseInfo(text) {
  try {
    const value = JSON.parse(text);
    return { valid: true, type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
      error: null, errorPosition: null };
  } catch (e) {
    // Local SyntaxError category/position only. Never raw API/transport messages,
    // never engine snippets that can echo bytes outside the vetted capture.
    const position = /\bposition (\d+)\b/.exec(String(e.message));
    return { valid: false, type: null, error: 'SyntaxError',
      errorPosition: position ? Number(position[1]) : null };
  }
}
function inspectBytes(bytes) {
  const buffer = Buffer.from(bytes), text = buffer.toString('utf8');
  let utf8Valid = true;
  try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch (_) { utf8Valid = false; }
  const outer = parseInfo(text);
  let nested = null;
  if (outer.valid) {
    const value = JSON.parse(text);
    if (value && typeof value.result_json === 'string') nested = parseInfo(value.result_json);
  }
  return { byteLength: buffer.length, base64: buffer.toString('base64'), utf8Text: text,
    utf8Valid, outer, nested };
}
async function capture(r, phase) {
  const key = keys(r)[2];
  let raw, vector, restError = null, luaError = null;
  try { raw = await kv(['GET', key]); } catch (e) { restError = codeOf(e); }
  try { vector = await kv(['EVAL', BYTES, 1, key]); } catch (e) { luaError = codeOf(e); }
  const restType = restError ? 'unavailable' : raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw;
  let rest = null, lua = null, withheld = false, luaType = 'unavailable';
  if (typeof raw === 'string') {
    const bytes = Buffer.from(raw, 'utf8');
    if (safeBytes(bytes, r)) {
      rest = inspectBytes(bytes);
      rest.rawString = raw; // preserve even unpaired JS surrogates verbatim
      rest.outer = parseInfo(raw);
    }
    else { withheld = true; restError = 'capture_withheld'; }
  } else if (!restError) restError = 'result_shape';
  if (Array.isArray(vector) && vector.length >= 3 && [0, 1, 2].includes(vector[0])
      && Number.isSafeInteger(vector[1]) && vector[1] >= 0 && [0, 1].includes(vector[2])) {
    luaType = ['absent', 'string', 'other'][vector[0]];
    if (vector[0] === 1 && vector[2] === 1 && vector[1] <= LIMIT
        && vector.length === vector[1] + 3 && vector.slice(3).every(v => Number.isInteger(v) && v >= 0 && v <= 255)) {
      if (safeBytes(vector.slice(3), r)) lua = inspectBytes(vector.slice(3));
      else { withheld = true; luaError = 'capture_withheld'; }
    } else luaError = 'result_shape';
  } else if (!luaError) luaError = 'result_shape';
  let sameBytes = null, firstDifference = null;
  if (rest && lua) {
    const a = Buffer.from(rest.base64, 'base64'), b = Buffer.from(lua.base64, 'base64');
    sameBytes = a.equals(b);
    if (!sameBytes) {
      let i = 0; while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
      firstDifference = { offset: i, restByte: a[i] ?? null, luaByte: b[i] ?? null };
    }
  }
  return { phase, restType, luaType, restError, luaError, withheld, rest, lua, sameBytes, firstDifference,
    restByteLength: typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : null,
    luaByteLength: Array.isArray(vector) && Number.isSafeInteger(vector[1]) && vector[1] >= 0 ? vector[1] : null };
}
function freshArtifact() {
  return { version: 6, scope: 'Synthetic MODULE diagnostic: debit/offer normal JS modules; accept instrumented exact Lua, NOT normal JS acceptance wrapper, authenticated-handler, HTTP-loss or billing-acceptance evidence',
    acceptance: 'NOT_EVALUATED',
    expectedStart: { free: 1, paid: 1 }, expectedEnd: { free: 0, paid: 1 },
    captures: [], attemptedTransitions: [], start: null, end: null,
    status: 'INCOMPLETE', error: null, cleanup: null, recoveryCleanup: null,
    acceptDiagnostic: null };
}
function emptyTrace() {
  return { basis: 'INSTRUMENTED_EXACT_LUA_SAME_EVAL', returned: false,
    luaSucceeded: null, errorCategory: null, transportCategory: null,
    phases: Object.fromEntries(TRACE_PHASES.map(p => [p, 'unrun'])),
    sharedTableReference: null, before: null, after: null };
}
function snapshotVector(v, r) {
  if (!Array.isArray(v) || v.length !== 3) throw new Diagnostic('result_shape');
  return Object.fromEntries(['journal', 'freeUsed', 'paidLeft'].map((name, i) => {
    const a = v[i];
    if (!Array.isArray(a) || a.length < 3 || ![0, 1, 2, 3].includes(a[0])
        || !Number.isSafeInteger(a[1]) || a[1] < 0 || ![0, 1].includes(a[2]))
      throw new Diagnostic('result_shape');
    let data = null;
    if (a[0] === 1 && a[2] === 1 && a[1] <= LIMIT && a.length === a[1] + 3
        && a.slice(3).every(b => Number.isInteger(b) && b >= 0 && b <= 255)
        && safeBytes(a.slice(3), r)) data = inspectBytes(a.slice(3));
    return [name, { type: ['absent', 'string', 'other', 'unavailable'][a[0]], byteLength: a[1], data }];
  }));
}
async function instrumentedAccept(r, selection, trace) {
  const { receipt, owner, scan, ...params } = context(r), k = keys(r);
  let v;
  try {
    // Exact idBilling accept KEYS and ARGV, including property order and TTL.
    v = await kv(['EVAL', INSTRUMENTED_ACCEPT, 3, k[2], k[0], k[1], 'accept',
      JSON.stringify({ owner, scan, mode: 'identify', receipt, ...params,
        candidate_set: selection.candidate_set, candidate: candidateHash(CANDIDATES[1]) }), 86400]);
    if (!Array.isArray(v) || v.length !== 6 || ![0, 1].includes(v[0])
        || !Number.isInteger(v[1]) || !LUA_ERRORS[v[1]]
        || !Array.isArray(v[2]) || v[2].length !== 7
        || !v[2].slice(0, 6).every(n => Number.isInteger(n) && n >= -1 && n <= 4)
        || ![-1, 0, 1].includes(v[2][6])) throw new Diagnostic('result_shape');
    trace.before = snapshotVector(v[3], r); trace.after = snapshotVector(v[4], r);
    trace.returned = true; trace.luaSucceeded = v[0] === 1;
    trace.errorCategory = v[0] === 0 ? LUA_ERRORS[v[1]] : null;
    trace.phases = Object.fromEntries(TRACE_PHASES.map((p, i) => [p, TRACE_TYPES[v[2][i]] || 'unrun']));
    trace.sharedTableReference = v[2][6] === -1 ? null : v[2][6] === 1;
  } catch (e) { trace.transportCategory = codeOf(e); throw e; }
  if (!trace.luaSucceeded) throw new Diagnostic(trace.errorCategory);
  let result;
  try { result = JSON.parse(v[5]); } catch (_) { throw new Diagnostic('result_shape'); }
  if (!result || typeof result.ok !== 'boolean'
      || (!result.ok && typeof result.code !== 'string')
      || (result.ok && (!['id_free', 'id_paid_left', 'id_retry'].includes(result.bucket)
        || !result.pickedCard || typeof result.pickedCard !== 'object' || result.scan_id !== scan)))
    throw new Diagnostic('result_shape');
  if (!result.ok) throw new Diagnostic('billing_rejected');
}
function cleanTrace(value, r) {
  const clean = emptyTrace();
  if (!value) return clean;
  clean.returned = value.returned === true;
  clean.luaSucceeded = typeof value.luaSucceeded === 'boolean' ? value.luaSucceeded : null;
  clean.errorCategory = LUA_ERRORS.includes(value.errorCategory) ? value.errorCategory : null;
  clean.transportCategory = CODES.includes(value.transportCategory) ? value.transportCategory : null;
  clean.sharedTableReference = typeof value.sharedTableReference === 'boolean' ? value.sharedTableReference : null;
  for (const phase of TRACE_PHASES) clean.phases[phase] = TRACE_TYPES.includes(value.phases?.[phase])
    ? value.phases[phase] : 'unrun';
  for (const side of ['before', 'after']) if (value[side]) {
    clean[side] = Object.fromEntries(['journal', 'freeUsed', 'paidLeft'].map(name => {
      const item = value[side][name];
      if (!item || !['absent', 'string', 'other', 'unavailable'].includes(item.type)
          || !Number.isSafeInteger(item.byteLength) || item.byteLength < 0) throw new Diagnostic('result_shape');
      let data = null;
      if (item.data) {
        if (typeof item.data.base64 !== 'string' || item.data.base64.length > LIMIT * 2)
          throw new Diagnostic('result_shape');
        const bytes = Buffer.from(item.data.base64, 'base64');
        if (bytes.length !== item.byteLength || !safeBytes(bytes, r)) throw new Diagnostic('capture_withheld');
        data = inspectBytes(bytes);
      }
      return [name, { type: item.type, byteLength: item.byteLength, data }];
    }));
  }
  return clean;
}
function commitEvidence(r, actualError, trace) {
  const before = trace.before, after = trace.after;
  const read = s => s?.journal?.data?.outer.valid ? JSON.parse(s.journal.data.utf8Text) : null;
  const a = read(before), b = read(after), ctx = context(r);
  const bound = v => v && v.owner === ctx.owner && v.scan === ctx.scan && v.mode === 'identify'
    && v.candidate_set === candidateHash(CANDIDATES.map(candidateHash));
  const states = ['pending', 'accepted', 'debited'];
  const equal = name => before?.[name]?.data && after?.[name]?.data
    ? before[name].data.base64 === after[name].data.base64 : null;
  const equalBytes = equal('journal');
  const equalBalances = equal('freeUsed') !== null && equal('paidLeft') !== null
    ? equal('freeUsed') && equal('paidLeft') : null;
  const fixedStart = before?.freeUsed?.data?.utf8Text === '0' && before?.paidLeft?.data?.utf8Text === '1';
  let committed = null;
  if (trace.returned && fixedStart && bound(a) && bound(b) && a.state === 'pending' && b.state === 'pending'
      && equalBytes === true && equalBalances === true) committed = false;
  if (trace.returned && fixedStart && bound(a) && bound(b) && a.state === 'pending' && b.state === 'accepted'
      && after.freeUsed?.data?.utf8Text === '1' && after.paidLeft?.data?.utf8Text === '1'
      && b.selected === candidateHash(CANDIDATES[1]) && after.journal.data.nested?.valid) {
    const nested = JSON.parse(b.result_json);
    if (nested?.ok === true && nested.bucket === 'id_free' && nested.scan_id === ctx.scan
        && nested.free_remaining === 0 && nested.paid_remaining === 1 && nested.remaining === 0
        && nested.pickedCard && typeof nested.pickedCard === 'object'
        && candidateHash(nested.pickedCard) === candidateHash(canonicalPick(CANDIDATES[1]))) committed = true;
  }
  return { actualBillingError: CODES.includes(actualError) ? actualError : null,
    beforeState: states.includes(a?.state) ? a.state : null, afterState: states.includes(b?.state) ? b.state : null,
    journalBytesUnchanged: equalBytes, balancesUnchanged: equalBalances,
    mutationCommitted: committed, trace };
}
function artifact(r) {
  if (!r.artifact) return freshArtifact();
  let data;
  try { data = JSON.parse(Buffer.from(r.artifact, 'base64').toString('utf8')); }
  catch (_) { throw new Diagnostic('result_shape'); }
  // Exact structural round-trip prevents foreign fields from stored evidence
  // becoming an export channel. Captures are rederived from bounded vetted bytes.
  const safe = freshArtifact();
  if (data.version !== 6 || !Array.isArray(data.captures) || data.captures.length > 3
      || !Array.isArray(data.attemptedTransitions) || data.attemptedTransitions.length > 3)
    throw new Diagnostic('result_shape');
  safe.attemptedTransitions = data.attemptedTransitions.filter(p => PHASES.includes(p));
  safe.status = ['CAPTURED', 'FAIL', 'INCOMPLETE'].includes(data.status) ? data.status : 'INCOMPLETE';
  safe.error = CODES.includes(data.error) ? data.error : null;
  for (const k of ['start', 'end']) if (data[k] && [data[k].free, data[k].paid].every(v => Number.isSafeInteger(v) && v >= 0 && v <= 1))
    safe[k] = { free: data[k].free, paid: data[k].paid };
  for (const k of ['cleanup', 'recoveryCleanup']) if (data[k])
    safe[k] = { status: data[k].status === 'PASS' ? 'PASS' : 'FAIL',
      deleted: Number.isInteger(data[k].deleted) && data[k].deleted >= 0 && data[k].deleted <= 4 ? data[k].deleted : null,
      remaining: Number.isInteger(data[k].remaining) && data[k].remaining >= 0 && data[k].remaining <= 4 ? data[k].remaining : null };
  for (const c of data.captures) {
    if (!PHASES.includes(c.phase)) throw new Diagnostic('result_shape');
    const clean = { phase: c.phase, restType: ['unavailable', 'null', 'array', 'object', 'string', 'number', 'boolean'].includes(c.restType) ? c.restType : 'unavailable',
      luaType: ['unavailable', 'absent', 'string', 'other'].includes(c.luaType) ? c.luaType : 'unavailable',
      restError: CODES.includes(c.restError) ? c.restError : null, luaError: CODES.includes(c.luaError) ? c.luaError : null,
      withheld: c.withheld === true, rest: null, lua: null, sameBytes: null, firstDifference: null,
      restByteLength: Number.isSafeInteger(c.restByteLength) && c.restByteLength >= 0 ? c.restByteLength : null,
      luaByteLength: Number.isSafeInteger(c.luaByteLength) && c.luaByteLength >= 0 ? c.luaByteLength : null,
      observedBalances: null, balanceError: CODES.includes(c.balanceError) ? c.balanceError : null };
    if (c.observedBalances && [c.observedBalances.free, c.observedBalances.paid].every(v => Number.isSafeInteger(v) && v >= 0 && v <= 1))
      clean.observedBalances = { free: c.observedBalances.free, paid: c.observedBalances.paid };
    for (const kind of ['rest', 'lua']) if (c[kind]) {
      if (typeof c[kind].base64 !== 'string' || c[kind].base64.length > LIMIT * 2
          || !/^[A-Za-z0-9+/]*={0,2}$/.test(c[kind].base64)) throw new Diagnostic('result_shape');
      const bytes = Buffer.from(c[kind].base64, 'base64');
      if (!safeBytes(bytes, r)) throw new Diagnostic('capture_withheld');
      clean[kind] = inspectBytes(bytes);
      if (kind === 'rest') {
        if (typeof c[kind].rawString !== 'string' || c[kind].rawString.length > LIMIT
            || !Buffer.from(c[kind].rawString, 'utf8').equals(bytes)) throw new Diagnostic('result_shape');
        clean[kind].rawString = c[kind].rawString;
        clean[kind].outer = parseInfo(c[kind].rawString);
      }
    }
    if (clean.rest && clean.lua) {
      const a = Buffer.from(clean.rest.base64, 'base64'), b = Buffer.from(clean.lua.base64, 'base64');
      clean.sameBytes = a.equals(b);
      if (!clean.sameBytes) {
        let i = 0; while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
        clean.firstDifference = { offset: i, restByte: a[i] ?? null, luaByte: b[i] ?? null };
      }
    }
    safe.captures.push(clean);
  }
  if (data.acceptDiagnostic) {
    safe.acceptDiagnostic = commitEvidence(r, data.acceptDiagnostic.actualBillingError,
      cleanTrace(data.acceptDiagnostic.trace, r));
  }
  return safe;
}
async function save(r, evidence, action = 'checkpoint') {
  const text = JSON.stringify(evidence);
  if (Buffer.byteLength(text) > ARTIFACT_LIMIT) throw new Diagnostic('result_shape');
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  if (await kv(['EVAL', CONTROL_SCRIPT, 1, CONTROL, action, JSON.stringify({ worker: r.worker }), encoded]) !== 1)
    throw new Diagnostic('checkpoint_unavailable');
}
async function cleanup(r) {
  try {
    const deleted = await kv(['DEL', ...keys(r)]), remaining = await kv(['EXISTS', ...keys(r)]);
    return { status: Number.isInteger(deleted) && deleted >= 0 && deleted <= 4 && remaining === 0 ? 'PASS' : 'FAIL',
      deleted: Number.isInteger(deleted) && deleted >= 0 && deleted <= 4 ? deleted : null,
      remaining: Number.isInteger(remaining) && remaining >= 0 && remaining <= 4 ? remaining : null };
  } catch (_) { return { status: 'FAIL', deleted: null, remaining: null }; }
}
async function balances(r) {
  const values = await kv(['MGET', ...keys(r).slice(0, 2)]);
  if (!Array.isArray(values) || values.length !== 2 || values.some(v => !['0', '1'].includes(v)))
    throw new Diagnostic('result_shape');
  return { free: 1 - Number(values[0]), paid: Number(values[1]) };
}
async function run() {
  const r = { v: 6, namespace: nonce(), worker: nonce(),
    stamp: new Date().toISOString().slice(0, 7).replace('-', '_') };
  if (await kv(['EVAL', CONTROL_SCRIPT, 1, CONTROL, 'claim', JSON.stringify(r)]) !== 1) {
    const old = await record();
    if (!old) throw new Diagnostic('missing_run');
    if (!old.artifact) throw new Diagnostic('in_progress');
    return artifact(old);
  }
  const evidence = freshArtifact(), ctx = context(r), deadline = Date.now() + 20000;
  const check = () => { if (Date.now() >= deadline || Date.now() >= END) throw new Diagnostic('deadline'); };
  let selection;
  try {
    await kv(['MSET', keys(r)[0], '0', keys(r)[1], '1']);
    evidence.start = await balances(r);
    for (const phase of PHASES) {
      check();
      evidence.attemptedTransitions.push(phase);
      let failure;
      const trace = phase === 'accept' ? emptyTrace() : null;
      try {
        if (phase === 'offer') selection = await offerIdConfirmation(ctx, CANDIDATES);
        else if (phase === 'accept') await instrumentedAccept(r, selection, trace);
        else {
          const result = await idBilling(phase, ctx);
          if (!result.ok) throw new Diagnostic('billing_rejected');
        }
      } catch (e) { failure = e; }
      // Capture even after an uncertain module response; always before cleanup
      // or another financial transition. Invalid JSON is evidence, not a PASS.
      // Once a transition is attempted, reserve up to12s for both captures,
      // observed balances, and checkpoint even if it exhausted the run budget.
      // No next transition
      // starts after20s; last module8s + capture/checkpoint12s + cleanup/finish9s
      // reserve room for the initial claim and local processing within60s.
      const observed = await capture(r, phase);
      observed.observedBalances = null; observed.balanceError = null;
      // Bytes first, then balances: an invalid accepted journal must not erase
      // an independently observed successful debit. Preserve the primary error.
      try {
        observed.observedBalances = await balances(r);
        if (phase === 'accept') evidence.end = observed.observedBalances;
      } catch (e) { observed.balanceError = codeOf(e); }
      evidence.captures.push(observed);
      if (phase === 'accept') evidence.acceptDiagnostic = commitEvidence(r,
        failure ? codeOf(failure) : null, trace);
      await save(r, evidence); // durable checkpoint BEFORE next financial action
      if (failure) throw failure;
      if (!observed.rest || !observed.lua || observed.withheld || observed.sameBytes !== true
          || !observed.rest.outer.valid || !observed.lua.outer.valid
          || (phase === 'accept' && (!observed.rest.nested?.valid || !observed.lua.nested?.valid)))
        throw new Diagnostic('capture_invalid');
      if (observed.balanceError) throw new Diagnostic(observed.balanceError);
    }
    evidence.status = evidence.end.free === 0 && evidence.end.paid === 1 ? 'CAPTURED' : 'FAIL';
  } catch (e) { evidence.status = 'FAIL'; evidence.error = codeOf(e); }
  finally {
    evidence.cleanup = await cleanup(r);
    if (evidence.cleanup.status !== 'PASS') evidence.status = 'FAIL';
    try { await save(r, evidence, 'finish'); }
    catch (_) { evidence.status = 'FAIL'; evidence.error = 'checkpoint_unavailable'; }
  }
  // The immediate attachment is a second preservation path if control saving
  // failed. The control checkpoint remains available after ordinary cleanup.
  return evidence;
}
async function recover() {
  const r = await record();
  if (!r) throw new Diagnostic('missing_run');
  const worker = nonce();
  if (await kv(['EVAL', CONTROL_SCRIPT, 1, CONTROL, 'recover', JSON.stringify({ worker })]) !== 1)
    throw new Diagnostic('in_progress');
  let evidence;
  try { evidence = artifact(r); }
  catch (e) { evidence = freshArtifact(); evidence.status = 'FAIL'; evidence.error = codeOf(e); }
  evidence.recoveryCleanup = await cleanup(r);
  if (evidence.recoveryCleanup.status !== 'PASS') evidence.status = 'FAIL';
  await save({ ...r, worker }, evidence, 'finish');
  return evidence;
}
function permitted(req) {
  if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_GIT_COMMIT_REF !== 'fix/listing-export-identity'
      || Date.now() >= RECOVERY_END) return false;
  const host = process.env.VERCEL_URL;
  if (!host || !/^[a-z0-9-]+\.vercel\.app$/.test(host) || req.headers.host !== host
      || req.url !== PATH || Object.keys(req.query || {}).length) return false;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return false;
  try {
    const u = new URL(process.env.KV_REST_API_URL);
    return u.protocol === 'https:' && u.hostname.endsWith('.upstash.io') && !u.username && !u.password
      && !u.port && !u.search && !u.hash && u.pathname === '/';
  } catch (_) { return false; }
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  if (!permitted(req)) return res.status(404).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).end();
  try {
    if (req.method === 'GET') {
      if (req.body && (typeof req.body !== 'object' || Object.keys(req.body).length)) return res.status(400).end();
      const old = await record();
      const button = (operation, label) => `<form method="POST"><button name="operation" value="${operation}">${label}</button></form>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send('<!doctype html><meta charset="utf-8"><title>Synthetic journal reproduction</title>'
        + '<h1>Synthetic journal reproduction</h1><p>One fixed MODULE diagnostic. Debit/offer use normal modules; acceptance runs instrumented exact Lua, not the normal JavaScript wrapper. Downloads synthetic byte evidence. No billing acceptance, authenticated-handler or HTTP-loss proof.</p>'
        + (!old && Date.now() < END ? button('run', 'Run once and download evidence') : '')
        + (old?.artifact ? button('download', 'Download preserved evidence') : '')
        + (old ? button('recover', 'Recover synthetic cleanup and download evidence') : ''));
    }
    const body = req.body;
    if (req.headers.origin !== `https://${process.env.VERCEL_URL}` || req.headers['sec-fetch-site'] !== 'same-origin'
        || !['application/x-www-form-urlencoded', 'application/json'].includes((req.headers['content-type'] || '').split(';')[0])
        || !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
        || !['run', 'recover', 'download'].includes(body.operation)) return res.status(400).end();
    if (body.operation === 'run' && Date.now() >= END) return res.status(410).end();
    let evidence;
    if (body.operation === 'run') evidence = await run();
    else if (body.operation === 'recover') evidence = await recover();
    else {
      const old = await record();
      if (!old?.artifact) throw new Diagnostic('missing_run');
      evidence = artifact(old);
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cardresell-synthetic-journal-reproduction.json"');
    return res.status(200).send(JSON.stringify(evidence, null, 2));
  } catch (e) {
    return res.status(503).json({ status: 'FAIL', error: codeOf(e) });
  }
}
