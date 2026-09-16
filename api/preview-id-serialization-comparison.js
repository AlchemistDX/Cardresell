// TEMPORARY v7: encoder-only controlled experiment. NOT billing acceptance.
// Deployment requires existing Vercel protection and genuinely isolated Preview
// Redis. No product mutation, customer/auth/tier/Stripe calls or arbitrary input.
import { randomBytes } from 'node:crypto';
import { canonicalPick, candidateHash } from './_idBilling.js';
export const config = { maxDuration: 60 };
const PATH = '/api/preview-id-serialization-comparison';
const CONTROL = 'preview_id_encoder_comparison:1e4122d:v7';
const END = Date.parse('2026-09-16T18:00:00Z'), RECOVERY_END = Date.parse('2026-09-23T18:00:00Z');
const nonce = () => randomBytes(32).toString('hex');
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const CODES = ['transport', 'upstream_status', 'response_json', 'upstream_error', 'result_shape',
  'in_progress', 'missing_run', 'checkpoint_unavailable', 'deadline', 'internal'];
class Diagnostic extends Error { constructor(code) { super('diagnostic'); this.code = code; } }
const codeOf = e => e instanceof Diagnostic && CODES.includes(e.code) ? e.code : 'internal';
const TYPES = ['nil', 'string', 'table', 'other', 'throw'];
const SETUP = ['ready', 'fixture_input', 'fixture_decode', 'fixture_shape', 'result_encoding', 'comparison_controls', 'comparison_error'];
// Fixed server-constructed in-memory fixture. No Redis reads/writes in this
// comparison (EVAL has zero keys). Only the lifecycle control is persisted. Native
// encoder is never configured, proxied, normalized or retried for acceptance.
// Fresh equal-value pairs run shared/copied then copied/shared to expose order
// effects. Only the selected card's table identity differs inside each pair.
// All result metadata is a numeric Redis vector, independent of CJSON encoding.
const COMPARE = `
local function run()
  local blank={-1,-1,-1,-1,-1}
  local raw=ARGV[1]
  if type(raw)~='string' or #raw>8192 then return {1,blank,{}} end
  local decoded,base=pcall(cjson.decode,raw)
  if not decoded or type(base)~='table' then return {2,blank,{}} end
  if base.state~='accepted' or base.mode~='identify' or type(base.candidates)~='table'
    or #base.candidates~=2 or type(base.result)~='table'
    or type(base.candidates[2].card)~='table' or type(base.result.pickedCard)~='table'
    or base.result.bucket~='id_free' or base.result.free_remaining~=0
    or base.result.paid_remaining~=1 then return {3,blank,{}} end
  local function copy(v)
    if type(v)~='table' then return v end
    local out={};for k,x in pairs(v) do out[k]=copy(x) end;return out
  end
  local function same(a,b,depth)
    depth=depth or 0
    if depth>16 or type(a)~=type(b) then return false end
    if type(a)~='table' then return a==b end
    for k,v in pairs(a) do if not same(v,b[k],depth+1) then return false end end
    for k,_ in pairs(b) do if a[k]==nil then return false end end
    return true
  end
  local function aliases(v)
    local seen={};local count=0
    local function visit(x)
      if type(x)~='table' then return end
      if seen[x] then count=count+1;return end
      seen[x]=true;for _,y in pairs(x) do visit(y) end
    end
    visit(v);return count
  end
  local function kind(v)
    if v==nil then return 0 end
    if type(v)=='string' then return 1 end
    if type(v)=='table' then return 2 end
    return 3
  end
  local function check(v)
    local original=copy(v)
    local out={-1,-1,-1,-1,-1}
    local encodedOK,encoded=pcall(cjson.encode,v)
    out[1]=encodedOK and kind(encoded) or 4
    if encodedOK and type(encoded)=='string' then
      out[5]=#encoded
      local decodeOK,value=pcall(cjson.decode,encoded)
      out[2]=decodeOK and kind(value) or 4
      if decodeOK and type(value)=='table' then
        out[3]=same(original,value) and 1 or 0
        out[4]=same(original,v) and 1 or 0
        return out,encoded,value
      end
    end
    out[4]=same(original,v) and 1 or 0
    return out
  end
  local resultCheck,resultJSON=check(base.result)
  if resultCheck[3]~=1 or resultCheck[4]~=1 then return {4,resultCheck,{}} end
  base.result_json=resultJSON
  local pairsOut={}
  for order=1,2 do
    local shared=copy(base)
    shared.result.pickedCard=shared.candidates[2].card
    local independent=copy(base)
    independent.result.pickedCard=copy(independent.candidates[2].card)
    local equal=same(shared,independent) and 1 or 0
    local sharedCount,copyCount=aliases(shared),aliases(independent)
    local sharedIdentity=shared.result.pickedCard==shared.candidates[2].card and 1 or 0
    local independentIdentity=independent.result.pickedCard==independent.candidates[2].card and 1 or 0
    if equal~=1 or sharedCount~=1 or copyCount~=0 or sharedIdentity~=1 or independentIdentity~=0 then
      return {5,resultCheck,pairsOut}
    end
    local s,c,sd,cd,ignored
    if order==1 then
      s,ignored,sd=check(shared);c,ignored,cd=check(independent)
    else
      c,ignored,cd=check(independent);s,ignored,sd=check(shared)
    end
    local decodedEqual=-1
    if sd and cd then decodedEqual=same(sd,cd) and 1 or 0 end
    pairsOut[#pairsOut+1]={equal,sharedCount,copyCount,s,c,decodedEqual,same(shared,independent) and 1 or 0,
      sharedIdentity,independentIdentity,aliases(shared),aliases(independent)}
  end
  return {0,resultCheck,pairsOut}
end
local ok,result=pcall(run)
if not ok then return {6,{-1,-1,-1,-1,-1},{}} end
return result
`;
// Consumed marker/results are durable and NEVER included in cleanup. Store only
// base64 of JS-generated allowlisted evidence, not journal or upstream strings.
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
elseif action=='finish' then
  if r.worker~=p.worker or (r.state~='running' and r.state~='recovering') then return 0 end
  r.artifact=ARGV[3];r.state='complete';r.lease=0
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
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Diagnostic('result_shape');
  if (data.error) throw new Diagnostic('upstream_error');
  if (data.result === undefined) throw new Diagnostic('result_shape');
  return data.result;
}
function fixture(r) {
  const candidates = [{ name: 'Synthetic fixture A', number: '1', set: 'Synthetic set A' },
    { name: 'Synthetic fixture B', number: '2', set: 'Synthetic set B' }]
    .map(c => ({ hash: candidateHash(c), card: canonicalPick(c) }));
  const owner = `preview-comparison-${r.namespace}`, scan = `preview-comparison-${r.namespace.slice(0, 32)}`;
  return { owner, scan, mode: 'identify', state: 'accepted', candidates,
    candidate_set: candidateHash(candidates.map(c => c.hash)), expires: 1789581600, zero_cost: false,
    selected: candidates[1].hash, result: { ok: true, bucket: 'id_free', remaining: 0,
      free_remaining: 0, paid_remaining: 1, pickedCard: candidates[1].card, scan_id: scan },
    free_key: `scans:${owner}:id_free_used_2026_09`, replay_expires: 1789667100 };
}
function fresh() {
  return { version: 7, scope: 'CONTROLLED SYNTHETIC ENCODER COMPARISON ONLY; no billing transaction, authenticated-handler or HTTP-loss evidence',
    acceptance: 'NOT_EVALUATED', temporaryRedisDataKeysCreated: 0,
    cleanupBasis: 'Empty temporary-data manifest; durable control retained. Not a database-wide absence check.',
    status: 'UNRUN', error: null, setup: 'unrun',
    resultEncoding: null, comparisons: [], cleanup: null, recoveryCleanup: null };
}
function project(v) {
  if (!Array.isArray(v) || v.length !== 3 || !Number.isInteger(v[0]) || !SETUP[v[0]]
      || !Array.isArray(v[2]) || v[2].length > 2) throw new Diagnostic('result_shape');
  const flag = n => { if (![-1, 0, 1].includes(n)) throw new Diagnostic('result_shape'); return n === -1 ? null : n === 1; };
  const phase = a => {
    if (!Array.isArray(a) || a.length !== 5 || !a.slice(0, 2).every(n => Number.isInteger(n) && n >= -1 && n <= 4)
        || !Number.isSafeInteger(a[4]) || a[4] < -1 || a[4] > 1000000)
      throw new Diagnostic('result_shape');
    return { encodeType: TYPES[a[0]] || 'unrun', decodeType: TYPES[a[1]] || 'unrun',
      roundtripEquivalent: flag(a[2]), inputUnchanged: flag(a[3]), encodedByteLength: a[4] === -1 ? null : a[4] };
  };
  return { setup: SETUP[v[0]], resultEncoding: phase(v[1]), comparisons: v[2].map((p, i) => {
    if (!Array.isArray(p) || p.length !== 11 || p[1] !== 1 || p[2] !== 0 || p[7] !== 1 || p[8] !== 0
        || !p.slice(9).every(n => Number.isInteger(n) && n >= 0 && n <= 16))
      throw new Diagnostic('result_shape');
    return { name: i === 0 ? 'shared then independent' : 'independent then shared',
      inputContentEquivalent: flag(p[0]), sharedReferences: 1, independentReferences: 0,
      sharedSelectedIsCandidate: true, independentSelectedIsCandidate: false,
      shared: phase(p[3]), independent: phase(p[4]), decodedContentEquivalent: flag(p[5]),
      finalInputContentEquivalent: flag(p[6]), finalSharedReferences: p[9], finalIndependentReferences: p[10] };
  }) };
}
function validRecord(r) {
  return r?.v === 7 && r.consumed === true && hex(r.namespace) && hex(r.worker)
    && Number.isSafeInteger(r.lease) && ['running', 'recovering', 'complete'].includes(r.state)
    && typeof r.artifact === 'string' && r.artifact.length < 16000 && /^[A-Za-z0-9+/=]*$/.test(r.artifact);
}
async function record() {
  const raw = await kv(['GET', CONTROL]);
  if (raw === null) return null;
  let r; try { r = JSON.parse(raw); } catch (_) { throw new Diagnostic('result_shape'); }
  if (!validRecord(r)) throw new Diagnostic('result_shape'); return r;
}
function artifact(r) {
  if (!r.artifact) return fresh();
  let data; try { data = JSON.parse(Buffer.from(r.artifact, 'base64').toString()); }
  catch (_) { throw new Diagnostic('result_shape'); }
  const out = fresh();
  // Persist the numeric vector, then re-project all output on every download.
  if (data.vector) Object.assign(out, project(data.vector));
  out.status = ['CAPTURED', 'UNDETERMINED', 'INVALID', 'FAIL', 'UNRUN'].includes(data.status) ? data.status : 'FAIL';
  out.error = CODES.includes(data.error) ? data.error : null;
  for (const k of ['cleanup', 'recoveryCleanup']) if (data[k]) out[k] = {
    status: data[k].status === 'PASS' ? 'PASS' : 'FAIL',
    deleted: [0, 1].includes(data[k].deleted) ? data[k].deleted : null,
    remaining: [0, 1].includes(data[k].remaining) ? data[k].remaining : null };
  return out;
}
async function finish(r, evidence) {
  const encoded = Buffer.from(JSON.stringify(evidence)).toString('base64');
  if (encoded.length >= 16000) throw new Diagnostic('result_shape');
  if (await kv(['EVAL', CONTROL_SCRIPT, 1, CONTROL, 'finish', JSON.stringify({ worker: r.worker }), encoded]) !== 1)
    throw new Diagnostic('checkpoint_unavailable');
}
async function cleanup() {
  // Nothing is seeded in Redis: both graphs live only inside a bounded EVAL.
  // These counts refer to the empty temporary-data manifest, NOT a database
  // scan or deletion assertion. The sole lifecycle/results control is retained.
  return { status: 'PASS', deleted: 0, remaining: 0 };
}
async function run() {
  const r = { v: 7, namespace: nonce(), worker: nonce() }, deadline = Date.now() + 15000;
  if (await kv(['EVAL', CONTROL_SCRIPT, 1, CONTROL, 'claim', JSON.stringify(r)]) !== 1) {
    const old = await record();
    if (!old?.artifact) throw new Diagnostic('in_progress');
    return artifact(old);
  }
  const data = { status: 'UNRUN', vector: null, error: null, cleanup: null, recoveryCleanup: null };
  try {
    if (Date.now() >= deadline || Date.now() >= END) throw new Diagnostic('deadline');
    const vector = await kv(['EVAL', COMPARE, 0, JSON.stringify(fixture(r))]);
    const result = project(vector); data.vector = vector;
    data.status = result.setup === 'ready' && result.comparisons.length === 2 ? 'CAPTURED'
      : result.setup === 'comparison_controls' ? 'INVALID' : 'UNDETERMINED';
    if (data.status === 'CAPTURED' && result.comparisons.some(p => p.inputContentEquivalent !== true
        || p.shared.inputUnchanged !== true || p.independent.inputUnchanged !== true
        || p.finalInputContentEquivalent !== true || p.finalSharedReferences !== 1 || p.finalIndependentReferences !== 0))
      data.status = 'INVALID';
  } catch (e) { data.status = 'FAIL'; data.error = codeOf(e); }
  finally {
    data.cleanup = await cleanup(r);
    if (data.cleanup.status !== 'PASS') data.status = 'FAIL';
    try { await finish(r, data); }
    catch (_) { data.status = 'FAIL'; data.error = 'checkpoint_unavailable'; }
  }
  return artifact({ artifact: Buffer.from(JSON.stringify(data)).toString('base64') });
}
async function recover() {
  const r = await record(); if (!r) throw new Diagnostic('missing_run');
  const worker = nonce();
  if (await kv(['EVAL', CONTROL_SCRIPT, 1, CONTROL, 'recover', JSON.stringify({ worker })]) !== 1)
    throw new Diagnostic('in_progress');
  let data;
  try {
    artifact(r); // validate before retaining fixed numeric data; no raw export
    data = r.artifact ? JSON.parse(Buffer.from(r.artifact, 'base64').toString()) : { status: 'UNRUN', vector: null };
  } catch (_) { data = { status: 'FAIL', vector: null, error: 'result_shape' }; }
  data.recoveryCleanup = await cleanup(r);
  if (data.recoveryCleanup.status !== 'PASS') data.status = 'FAIL';
  await finish({ ...r, worker }, data);
  return artifact({ artifact: Buffer.from(JSON.stringify(data)).toString('base64') });
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
      return res.status(200).send('<!doctype html><meta charset="utf-8"><title>Synthetic encoder comparison</title>'
        + '<h1>Synthetic encoder comparison</h1><p>One fixed encoder-only experiment. Equal journal content; shared versus independent selected-card tables. No billing acceptance or authenticated-client proof.</p>'
        + (!old && Date.now() < END ? button('run', 'Run comparison once and download') : '')
        + (old?.artifact ? button('download', 'Download preserved comparison') : '')
        + (old ? button('recover', 'Recover synthetic cleanup') : ''));
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
    else { const old = await record(); if (!old?.artifact) throw new Diagnostic('missing_run'); evidence = artifact(old); }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cardresell-synthetic-encoder-comparison.json"');
    return res.status(200).send(JSON.stringify(evidence, null, 2));
  } catch (e) { return res.status(503).json({ status: 'FAIL', error: codeOf(e) }); }
}
