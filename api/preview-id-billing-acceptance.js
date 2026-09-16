// TEMPORARY Stage1 MODULE evidence only. Remove after the approved Preview run.
// Deployment prerequisite: Vercel protection ON, injected KV isolated to Preview.
// Neither env/branch checks nor this route can prove those platform settings.
// No auth handler, tier lookup, provider, Stripe, or customer data is exercised.
import { randomBytes, createHash } from 'node:crypto';
import { idBilling, offerIdConfirmation, candidateHash, canonicalPick, IdBillingError } from './_idBilling.js';

export const config = { maxDuration: 60 };
const PATH = '/api/preview-id-billing-acceptance';
const BRANCH = 'fix/listing-export-identity';
// Absolute deadlines also fence old immutable deployments. Recovery only has
// a separate bounded window; it cannot invoke billing or clear the run guard.
const RUN_END = Date.parse('2026-09-19T00:00:00Z');
const RECOVERY_END = Date.parse('2026-09-23T18:00:00Z');
// All previous controls/evidence stay untouched. This fixed repair-specific
// marker authorizes one new normal-module run with structural-copy repair.
const CONTROL = 'preview_id_billing_acceptance:1e4122d:stage1:v8_structural_copy';
const LEASE_MS = 60000;
const RUN_MS = 25000; // last billing call may take8s; reserve time for finally.
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const nonce = () => randomBytes(32).toString('hex');
const digest = v => createHash('sha256').update(v).digest('hex');
const CASES = [
  { name: 'MODULE free-first acceptance', free: 1, paid: 1, delta: [-1, 0], kind: 'free' },
  { name: 'MODULE confirmation then cancel', free: 1, paid: 0, delta: [0, 0], kind: 'cancel' },
  { name: 'MODULE paid acceptance', free: 0, paid: 1, delta: [0, -1], kind: 'paid' },
  { name: 'MODULE sequential replay', free: 0, paid: 1, delta: [0, -1], kind: 'replay' },
  { name: 'MODULE concurrent duplicates', free: 0, paid: 1, delta: [0, -1], kind: 'concurrent' },
  { name: 'MODULE discarded committed result then retry', free: 0, paid: 1, delta: [0, -1], kind: 'discard' },
];
const OTHER = ['MODULE execution', 'Synthetic cleanup', 'Recovery cleanup', 'Single-use guard'];
const STAGES = ['not_started', 'seed', 'start_balances', 'debit', 'offer', 'pending_balances',
  'accept', 'accept_replay', 'accept_concurrent', 'discarded_commit', 'end_balances',
  'journal', 'scan_records', 'assertions', 'complete', 'cleanup', 'control'];
const CATEGORIES = ['transport', 'upstream_status', 'upstream_error', 'response_json',
  'result_shape', 'result_json', 'billing_unavailable', 'billing_rejected',
  'deadline', 'assertion_mismatch', 'internal', 'not_executed', 'invalid_stored_state'];
class DiagnosticError extends Error {
  constructor(category) { super('diagnostic'); this.category = category; }
}
const categoryOf = error => error instanceof DiagnosticError && CATEGORIES.includes(error.category)
  ? error.category : error instanceof IdBillingError ? 'billing_unavailable' : 'internal';
const CANDIDATES = [{ name: 'Synthetic fixture A', number: '1', set: 'Synthetic set A' },
  { name: 'Synthetic fixture B', number: '2', set: 'Synthetic set B' }];
const JOURNAL_CHECKS = ['serverOuterJson', 'serverNestedJson', 'serverBinding',
  'serverState', 'serverResult', 'sameJournalBytes', 'serverWithinLimit',
  'restOuterJson', 'restNestedJson', 'restBinding', 'restResult'];
const JOURNAL_LIMIT = 32768;

// Diagnostic only: fixed read-only projection of this case's own synthetic
// journal. No bytes, identifiers, error text or customer keys leave the script.
// This is NOT a replacement for the original strict REST GET/JSON assertion.
const JOURNAL_SCRIPT = `
local out={-1,-1,-1,-1,-1,-1,0}
local raw=redis.call('GET',KEYS[1])
if type(raw)~='string' or #raw>32768 then return out end
out[7]=1
local p=cjson.decode(ARGV[1])
if type(p.rest_sha1)=='string' then out[6]=redis.sha1hex(raw)==p.rest_sha1 and 1 or 0 end
out[1]=0
local ok,r=pcall(cjson.decode,raw)
if not ok or type(r)~='table' then return out end
out[1]=1
local function same(a,b)
  if type(a)~=type(b) then return false end
  if type(a)~='table' then return a==b end
  for k,v in pairs(a) do if not same(v,b[k]) then return false end end
  for k,_ in pairs(b) do if a[k]==nil then return false end end
  return true
end
local binding=r.owner==p.owner and r.scan==p.scan and r.mode=='identify'
  and r.candidate_set==p.candidate_set and same(r.candidates,p.candidates)
if p.state=='accepted' then binding=binding and r.selected==p.candidate end
out[3]=binding and 1 or 0
out[4]=r.state==p.state and 1 or 0
if p.state=='accepted' then
  local nestedOK,nested=false,nil
  if type(r.result_json)=='string' then nestedOK,nested=pcall(cjson.decode,r.result_json) end
  nestedOK=nestedOK and type(nested)=='table'
  out[2]=nestedOK and 1 or 0
  out[5]=nestedOK and same(nested,r.result) and same(nested,p.result) and 1 or 0
end
return out
`;
function same(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object'
      || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length
    && keys.every(k => Object.hasOwn(b, k) && same(a[k], b[k]));
}

// A fixed control operation, never caller-supplied Lua/keys/values. Consumed is
// durable with NO expiry. Cleanup keeps namespace so later recovery can address
// the same24 possible synthetic data keys, without allowing a second billing run.
const CONTROL_SCRIPT = `
local raw=redis.call('GET',KEYS[1])
local now=tonumber(redis.call('TIME')[1])*1000
local action=ARGV[1]
local p=cjson.decode(ARGV[2])
if action=='claim' then
  if raw then return 0 end
  p.consumed=true;p.state='running';p.lease=now+60000
  redis.call('SET',KEYS[1],cjson.encode(p))
  return 1
end
if not raw then return 0 end
local r=cjson.decode(raw)
if action=='recover' then
  if (r.state=='running' or r.state=='recovering') and r.lease>now then return 0 end
  r.worker=p.worker;r.state='recovering';r.lease=now+60000
elseif action=='finish' then
  if r.worker~=p.worker then return 0 end
  r.state=p.state;r.results=p.results;r.lease=0
else return 0 end
redis.call('SET',KEYS[1],cjson.encode(r))
return 1
`;

async function kv(args) {
  // Internal injected configuration only. No values are returned or logged.
  let response, data;
  try {
    response = await fetch(process.env.KV_REST_API_URL, {
      method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(3000),
    });
  } catch (_) { throw new DiagnosticError('transport'); }
  if (!response.ok) throw new DiagnosticError('upstream_status');
  try { data = await response.json(); } catch (_) { throw new DiagnosticError('response_json'); }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new DiagnosticError('result_shape');
  if (data.error) throw new DiagnosticError('upstream_error');
  if (data.result === undefined) throw new DiagnosticError('result_shape');
  return data.result;
}
function validRecord(r) {
  return r && r.v === 1 && hex(r.namespace) && hex(r.worker) && r.consumed === true
    && /^\d{4}_(0[1-9]|1[0-2])$/.test(r.stamp) && Array.isArray(r.results)
    && ['running', 'recovering', 'complete', 'failed'].includes(r.state)
    && Number.isSafeInteger(r.lease);
}
async function record() {
  const raw = await kv(['GET', CONTROL]);
  if (raw === null) return null;
  let r;
  try { r = JSON.parse(raw); } catch (_) { throw new DiagnosticError('invalid_stored_state'); }
  if (!validRecord(r)) throw new DiagnosticError('invalid_stored_state');
  return r;
}
function context(r, i) {
  const owner = `preview-id-${r.namespace}-${i}`;
  const receipt = digest(`${r.namespace}:receipt:${i}`);
  return { owner, receipt, scan: `preview-${r.namespace.slice(0, 32)}-${i}`,
    stamp: r.stamp, grant: 1 };
}
function keysFor(r, i) {
  const c = context(r, i);
  return [`scans:${c.owner}:id_free_used_${r.stamp}`, `scans:${c.owner}:id_paid_left`,
    `id_billing:${c.receipt}`, `scan:${c.scan}`];
}
function manifest(r) { return CASES.flatMap((_, i) => keysFor(r, i)); }
const number = v => Number.isSafeInteger(v) && Math.abs(v) <= 100000 ? v : null;
function cleanRow(row) {
  // Allowlist projection even for stored results; never pass raw KV/error data.
  const names = [...CASES.map(c => c.name), ...OTHER];
  return {
    test: names.includes(row?.test) ? row.test : 'MODULE execution',
    start: { free: number(row?.start?.free), paid: number(row?.start?.paid) },
    end: { free: number(row?.end?.free), paid: number(row?.end?.paid) },
    expectedDelta: { free: number(row?.expectedDelta?.free), paid: number(row?.expectedDelta?.paid) },
    actualDelta: { free: number(row?.actualDelta?.free), paid: number(row?.actualDelta?.paid) },
    failedStage: STAGES.includes(row?.failedStage) ? row.failedStage : null,
    lastCompletedStage: STAGES.includes(row?.lastCompletedStage) ? row.lastCompletedStage : 'not_started',
    diagnosticCategory: CATEGORIES.includes(row?.diagnosticCategory) ? row.diagnosticCategory : null,
    journalDiagnosticCategory: CATEGORIES.includes(row?.journalDiagnosticCategory) ? row.journalDiagnosticCategory : null,
    journalChecks: Object.fromEntries(JOURNAL_CHECKS.map(k =>
      [k, typeof row?.journalChecks?.[k] === 'boolean' ? row.journalChecks[k] : null])),
    counts: { executed: number(row?.counts?.executed), attempts: number(row?.counts?.attempts),
      acceptedResponses: number(row?.counts?.acceptedResponses),
      acceptedJournals: number(row?.counts?.acceptedJournals),
      successfulScanRecords: number(row?.counts?.successfulScanRecords),
      deleted: number(row?.counts?.deleted), remaining: number(row?.counts?.remaining) },
    status: CASES.some(c => c.name === row?.test) && row?.counts?.executed === 0 ? 'UNRUN'
      : names.includes(row?.test) && row?.status === 'PASS' ? 'PASS' : 'FAIL',
  };
}
function envelope(rows) {
  const tests = rows.slice(0, 10).map(cleanRow);
  return { tests, counts: { total: tests.length, pass: tests.filter(r => r.status === 'PASS').length,
    fail: tests.filter(r => r.status === 'FAIL').length,
    unrun: tests.filter(r => r.status === 'UNRUN').length } };
}
const failRow = (test, error, stage = 'control') => cleanRow({ test, status: 'FAIL',
  failedStage: stage, diagnosticCategory: error ? categoryOf(error) : 'internal' });
async function cleanup(r, name) {
  // No KEYS/SCAN. Every possible data key is known before any setup write.
  // MSET in the unchanged billing Lua clears counter TTLs: explicitly DEL data,
  // then verify. Do NOT claim seed TTLs protect against process termination.
  const keys = manifest(r);
  try {
    const deleted = await kv(['DEL', ...keys]);
    const remaining = await kv(['EXISTS', ...keys]);
    return cleanRow({ test: name, counts: { deleted, remaining },
      status: Number.isSafeInteger(deleted) && remaining === 0 ? 'PASS' : 'FAIL' });
  } catch (error) { return failRow(name, error, 'cleanup'); }
}
async function balances(r, i) {
  const values = await kv(['MGET', ...keysFor(r, i).slice(0, 2)]);
  if (!Array.isArray(values) || values.length !== 2
      || values.some(v => typeof v !== 'string' || !/^\d+$/.test(v))) throw new DiagnosticError('result_shape');
  const used = Number(values[0]), paid = Number(values[1]);
  if (![used, paid].every(Number.isSafeInteger)) throw new DiagnosticError('result_shape');
  return { free: 1 - used, paid };
}
async function caseRun(r, i, deadline) {
  const spec = CASES[i], ctx = context(r, i), keys = keysFor(r, i);
  const row = { test: spec.name, expectedDelta: { free: spec.delta[0], paid: spec.delta[1] },
    counts: { executed: 1, attempts: 0, acceptedResponses: 0 },
    status: 'FAIL', lastCompletedStage: 'not_started' };
  let stage = 'not_started';
  const checkTime = () => {
    if (Date.now() >= deadline || Date.now() >= RUN_END) throw new DiagnosticError('deadline');
  };
  const step = async (name, operation) => {
    stage = name; checkTime();
    const result = await operation();
    row.lastCompletedStage = name;
    return result;
  };
  const call = async (action, extra = {}) => {
    checkTime();
    const result = await idBilling(action, { ...ctx, ...extra });
    if (!result.ok) throw new DiagnosticError('billing_rejected');
    return result;
  };
  try {
    // Do not normalize unknown provider response shapes; diagnose and fail closed.
    await step('seed', () => kv(['MSET', keys[0], String(1 - spec.free), keys[1], String(spec.paid)]));
    row.start = await step('start_balances', () => balances(r, i));
    await step('debit', () => call('debit'));
    const offered = await step('offer', () => offerIdConfirmation(ctx, CANDIDATES));
    const pending = await step('pending_balances', () => balances(r, i));
    const selection = { candidate_set: offered.candidate_set, candidate: candidateHash(CANDIDATES[1]) };
    const accept = async () => {
      row.counts.attempts++;
      const result = await call('accept', selection);
      row.counts.acceptedResponses++;
      return result;
    };
    let replies = [], committedWithoutResponse = false;
    if (spec.kind === 'concurrent') {
      replies = await step('accept_concurrent', async () => {
        const settled = await Promise.allSettled(Array.from({ length: 6 }, () => accept()));
        const failed = settled.find(s => s.status !== 'fulfilled');
        if (failed) throw failed.reason;
        return settled.map(s => s.value);
      });
    } else if (spec.kind === 'discard') {
      await step('discarded_commit', accept); // MODULE result, NOT HTTP interruption.
      committedWithoutResponse = true;
      replies = [await step('accept_replay', accept)];
    } else if (spec.kind !== 'cancel') {
      replies = [await step('accept', accept)];
      if (spec.kind === 'replay') replies.push(await step('accept_replay', accept));
    }
    row.end = await step('end_balances', () => balances(r, i));
    row.actualDelta = { free: row.end.free - row.start.free, paid: row.end.paid - row.start.paid };
    const journal = await step('journal', async () => {
      row.journalChecks = {};
      const expected = { owner: ctx.owner, scan: ctx.scan, ...selection,
        candidates: CANDIDATES.map(c => ({ hash: candidateHash(c), card: canonicalPick(c) })),
        state: spec.kind === 'cancel' ? 'pending' : 'accepted',
        // Independent fixed fixture expectation, not an echo of the module reply.
        result: { ok: true, bucket: spec.free ? 'id_free' : 'id_paid_left', remaining: 0,
          free_remaining: spec.free + spec.delta[0], paid_remaining: spec.paid + spec.delta[1],
          pickedCard: canonicalPick(CANDIDATES[1]), scan_id: ctx.scan } };
      let value, restError, serverError;
      try {
        const raw = await kv(['GET', keys[2]]);
        if (typeof raw !== 'string' || Buffer.byteLength(raw) > JOURNAL_LIMIT)
          throw new DiagnosticError('result_shape');
        expected.rest_sha1 = createHash('sha1').update(raw, 'utf8').digest('hex');
        try { value = JSON.parse(raw); row.journalChecks.restOuterJson = true; }
        catch (_) { row.journalChecks.restOuterJson = false; throw new DiagnosticError('result_json'); }
        if (!value || typeof value !== 'object') throw new DiagnosticError('result_shape');
        row.journalChecks.restBinding = value.owner === ctx.owner && value.scan === ctx.scan
          && value.mode === 'identify' && value.candidate_set === selection.candidate_set
          && Array.isArray(value.candidates) && same(value.candidates, expected.candidates)
          && (spec.kind === 'cancel' || value.selected === selection.candidate);
        if (spec.kind !== 'cancel') {
          if (typeof value.result_json !== 'string') throw new DiagnosticError('result_shape');
          let nested;
          try { nested = JSON.parse(value.result_json); row.journalChecks.restNestedJson = true; }
          catch (_) { row.journalChecks.restNestedJson = false; throw new DiagnosticError('result_json'); }
          row.journalChecks.restResult = same(nested, value.result) && same(nested, expected.result);
        }
        if (value.state !== expected.state || !row.journalChecks.restBinding
            || (spec.kind !== 'cancel' && !row.journalChecks.restResult))
          throw new DiagnosticError('assertion_mismatch');
      } catch (error) { restError = error; }
      // Run even after strict GET parsing fails, retaining that primary failure.
      // An inspector failure is separately sanitized, never promoted to PASS.
      try {
        checkTime();
        const projection = await kv(['EVAL', JOURNAL_SCRIPT, 1, keys[2], JSON.stringify(expected)]);
        if (!Array.isArray(projection) || projection.length !== 7
            || projection.some(v => ![-1, 0, 1].includes(v))) throw new DiagnosticError('result_shape');
        JOURNAL_CHECKS.slice(0, 7).forEach((k, j) => {
          row.journalChecks[k] = projection[j] === -1 ? null : projection[j] === 1;
        });
        const wanted = spec.kind === 'cancel' ? [1, -1, 1, 1, -1, 1, 1] : [1, 1, 1, 1, 1, 1, 1];
        if (!same(projection, wanted)) throw new DiagnosticError('assertion_mismatch');
      } catch (error) {
        serverError = error; row.journalDiagnosticCategory = categoryOf(error);
      }
      if (restError) throw restError;
      if (serverError) throw serverError;
      return value;
    });
    row.counts.acceptedJournals = journal.state === 'accepted' ? 1 : 0;
    row.counts.successfulScanRecords = await step('scan_records', () => kv(['EXISTS', keys[3]]));
    await step('assertions', async () => {
      const equal = replies.every(v => JSON.stringify(v) === JSON.stringify(replies[0]));
      const correct = replies.every(v => v.pickedCard?.card_name === CANDIDATES[1].name
        && v.bucket === (spec.free ? 'id_free' : 'id_paid_left'));
      if (!(row.start.free === spec.free && row.start.paid === spec.paid
          && pending.free === spec.free && pending.paid === spec.paid
          && row.actualDelta.free === spec.delta[0] && row.actualDelta.paid === spec.delta[1] && equal && correct
          && row.counts.acceptedJournals === (spec.kind === 'cancel' ? 0 : 1)
          && row.counts.successfulScanRecords === 0 && (spec.kind !== 'discard' || committedWithoutResponse)))
        throw new DiagnosticError('assertion_mismatch');
    });
    row.status = 'PASS'; row.lastCompletedStage = 'complete';
  } catch (error) {
    row.failedStage = stage;
    row.diagnosticCategory = categoryOf(error);
  }
  // Already observed values/counts survive errors; never fabricate missing data.
  return cleanRow(row);
}
async function finish(worker, rows) {
  const safe = envelope(rows).tests;
  return kv(['EVAL', CONTROL_SCRIPT, 1, CONTROL, 'finish',
    JSON.stringify({ worker, state: safe.every(r => r.status === 'PASS') ? 'complete' : 'failed', results: safe })]);
}
async function runOnce() {
  if (Date.now() >= RUN_END) return envelope([failRow('Single-use guard')]);
  const worker = nonce();
  const proposed = { v: 1, namespace: nonce(), worker,
    stamp: new Date().toISOString().slice(0, 7).replace('-', '_'),
    // Nonempty array survives Redis cjson round-tripping; pending is never PASS.
    results: [failRow('MODULE execution')] };
  const claimed = await kv(['EVAL', CONTROL_SCRIPT, 1, CONTROL, 'claim', JSON.stringify(proposed)]);
  if (claimed !== 1) {
    const old = await record();
    return envelope(old?.results.length ? old.results : [failRow('Single-use guard')]);
  }
  const r = { ...proposed, consumed: true, state: 'running', lease: Date.now() + LEASE_MS };
  const deadline = Date.now() + RUN_MS, rows = [];
  try {
    for (let i = 0; i < CASES.length; i++) {
      rows.push(await caseRun(r, i, deadline));
      if (rows[i].status !== 'PASS') {
        for (let j = i + 1; j < CASES.length; j++) rows.push(cleanRow({ test: CASES[j].name,
          status: 'UNRUN', expectedDelta: { free: CASES[j].delta[0], paid: CASES[j].delta[1] },
          diagnosticCategory: 'not_executed',
          counts: { executed: 0, attempts: 0, acceptedResponses: 0 } }));
        break;
      }
    }
  } finally {
    rows.push(await cleanup(r, 'Synthetic cleanup'));
    try { if (await finish(worker, rows) !== 1) rows.push(failRow('Single-use guard')); }
    catch (error) { rows.push(failRow('Single-use guard', error)); }
  }
  return envelope(rows);
}
async function recover() {
  const r = await record();
  if (!r) return envelope([failRow('Recovery cleanup')]);
  const worker = nonce();
  const claimed = await kv(['EVAL', CONTROL_SCRIPT, 1, CONTROL, 'recover', JSON.stringify({ worker })]);
  if (claimed !== 1) return envelope([failRow('Single-use guard')]);
  const rows = r.results.length ? r.results.filter(v => v.test !== 'Recovery cleanup') : [failRow('MODULE execution')];
  rows.push(await cleanup(r, 'Recovery cleanup'));
  try { if (await finish(worker, rows) !== 1) rows.push(failRow('Single-use guard')); }
  catch (error) { rows.push(failRow('Single-use guard', error)); }
  return envelope(rows);
}
function deniedReason(req) {
  if (process.env.VERCEL_ENV !== 'preview') return 'guard_preview_environment';
  if (process.env.VERCEL_GIT_COMMIT_REF !== BRANCH) return 'guard_feature_branch';
  if (Date.now() >= RECOVERY_END) return 'guard_recovery_deadline';
  const host = process.env.VERCEL_URL;
  if (!host || !/^[a-z0-9-]+\.vercel\.app$/.test(host)) return 'guard_host_configuration';
  if (req.headers.host !== host) return 'guard_host_mismatch';
  if (req.url !== PATH) return typeof req.url === 'string' && req.url.startsWith(PATH + '?')
    ? 'guard_request_query' : 'guard_request_path';
  if (Object.keys(req.query || {}).length) return 'guard_request_query';
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return 'guard_kv_missing';
  try {
    const u = new URL(process.env.KV_REST_API_URL);
    if (u.protocol !== 'https:' || !u.hostname.endsWith('.upstash.io')
        || u.username || u.password || u.port || u.search || u.hash || u.pathname !== '/') return 'guard_kv_url_shape';
  } catch (_) { return 'guard_kv_url_parse'; }
  return null;
}
const REASONS = ['guard_preview_environment', 'guard_feature_branch', 'guard_recovery_deadline',
  'guard_host_configuration', 'guard_host_mismatch', 'guard_request_query', 'guard_request_path',
  'guard_kv_missing', 'guard_kv_url_shape', 'guard_kv_url_parse', 'request_method', 'request_get_body',
  'request_origin', 'request_fetch_site', 'request_content_type', 'request_body_shape', 'request_operation',
  'run_deadline', 'state_read_failed', 'operation_failed'];
const escapeHtml = text => String(text).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function html(res, { status = 200, data = null, state = 'UNAVAILABLE', reason = null, canRun = false, canRecover = false } = {}) {
  const token = nonce();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${token}'; style-src 'nonce-${token}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
  return res.status(status).send('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>Stage1 MODULE acceptance</title>'
    + `<style nonce="${token}">body{font:16px/1.5 system-ui;margin:24px;color:#192433}main{max-width:850px;margin:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f7f9;padding:16px}button{font:inherit;min-height:44px;margin:8px;padding:10px}form{display:inline-block}</style></head><body><main>`
    + '<h1>Stage1 MODULE acceptance</h1><p>Six normal billing-module cases only. Not authenticated-handler, actual HTTP-interruption or physical iPhone billing acceptance.</p>'
    + '<p>Execution deadline: September 18, 2026 at 8:00 PM EDT (UTC−04:00; September 19, 2026 00:00 UTC). Recovery deadline: September 23, 2026 at 2:00 PM EDT (UTC−04:00; 18:00 UTC). A consumed run is never reset.</p>'
    + `<p id="run-state">${['NOT_CONSUMED', 'CONSUMED', 'RESPONSE_ONLY'].includes(state) ? state : 'UNAVAILABLE'}</p>`
    + (REASONS.includes(reason) ? `<p id="denied-reason">Diagnostic: ${reason}. HTTP ${status}. Stop; do not retry the experiment.</p>` : '')
    + (canRun && state === 'NOT_CONSUMED' ? `<form method="POST" action="${PATH}"><button name="operation" value="run">Run MODULE acceptance once</button></form>` : '')
    + (canRecover ? `<form method="POST" action="${PATH}"><button name="operation" value="recover">Recover synthetic cleanup</button></form>` : '')
    + (state === 'RESPONSE_ONLY' ? `<p><a href="${PATH}">Open saved results (read-only)</a></p>` : '')
    + (data ? '<p>Results below are sanitized. Copy/download use only displayed text; neither executes tests.</p><button id="copy" type="button">Copy results</button><span id="copy-status" role="status"></span><button id="download" type="button">Optional: download displayed .json</button>'
      + `<pre id="evidence" tabindex="0">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`
      + `<script nonce="${token}">const output=document.getElementById('evidence');document.getElementById('copy').onclick=async()=>{try{await navigator.clipboard.writeText(output.textContent);document.getElementById('copy-status').textContent='Copied';}catch(_){const r=document.createRange();r.selectNodeContents(output);const s=window.getSelection();s.removeAllRanges();s.addRange(r);document.getElementById('copy-status').textContent='Select and copy manually';}};document.getElementById('download').onclick=()=>{const u=URL.createObjectURL(new Blob([output.textContent],{type:'application/json;charset=utf-8'})),a=document.createElement('a');a.href=u;a.download='cardresell-module-acceptance.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);};</script>` : '')
    + '</main></body></html>');
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  const denied = deniedReason(req);
  if (denied) return html(res, { status: 404, reason: denied });
  if (!['GET', 'POST'].includes(req.method)) return html(res, { status: 405, reason: 'request_method' });
  let failureStage = 'operation_failed';
  try {
    if (req.method === 'GET') {
      if (req.body && (typeof req.body !== 'object' || Object.keys(req.body).length))
        return html(res, { status: 400, reason: 'request_get_body' });
      failureStage = 'state_read_failed';
      const old = await record(); // strictly read-only; no cookie, claim or seed
      const data = envelope(old?.results || []);
      return html(res, { data: old ? data : null, state: old ? 'CONSUMED' : 'NOT_CONSUMED',
        canRun: !old && Date.now() < RUN_END, canRecover: !!old });
    }
    const body = req.body;
    if (req.headers.origin !== `https://${process.env.VERCEL_URL}`) return html(res, { status: 400, reason: 'request_origin' });
    if (req.headers['sec-fetch-site'] !== 'same-origin') return html(res, { status: 400, reason: 'request_fetch_site' });
    if (!['application/x-www-form-urlencoded', 'application/json'].includes((req.headers['content-type'] || '').split(';')[0]))
      return html(res, { status: 400, reason: 'request_content_type' });
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1)
      return html(res, { status: 400, reason: 'request_body_shape' });
    if (!['run', 'recover'].includes(body.operation)) return html(res, { status: 400, reason: 'request_operation' });
    if (body.operation === 'run' && Date.now() >= RUN_END) return html(res, { status: 410, reason: 'run_deadline', data: envelope([failRow('Single-use guard')]) });
    return html(res, { state: 'RESPONSE_ONLY', data: body.operation === 'run' ? await runOnce() : await recover() });
  } catch (error) {
    // Never print or return exception messages, upstream results or credentials.
    return html(res, { status: 503, reason: failureStage, data: envelope([failRow('MODULE execution', error)]) });
  }
}
