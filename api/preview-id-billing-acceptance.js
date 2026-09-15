// TEMPORARY Stage1 MODULE evidence only. Remove after the approved Preview run.
// Deployment prerequisite: Vercel protection ON, injected KV isolated to Preview.
// Neither env/branch checks nor this route can prove those platform settings.
// No auth handler, tier lookup, provider, Stripe, or customer data is exercised.
import { randomBytes, createHash } from 'node:crypto';
import { idBilling, offerIdConfirmation, candidateHash } from './_idBilling.js';

export const config = { maxDuration: 60 };
const PATH = '/api/preview-id-billing-acceptance';
const BRANCH = 'fix/listing-export-identity';
// Absolute deadlines also fence old immutable deployments. Recovery only has
// a separate bounded window; it cannot invoke billing or clear the run guard.
const RUN_END = Date.parse('2026-09-16T18:00:00Z');
const RECOVERY_END = Date.parse('2026-09-23T18:00:00Z');
const CONTROL = 'preview_id_billing_acceptance:1e4122d:stage1:v1';
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
const CANDIDATES = [{ name: 'Synthetic fixture A', number: '1', set: 'Synthetic set A' },
  { name: 'Synthetic fixture B', number: '2', set: 'Synthetic set B' }];

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
  const response = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error('unavailable');
  const data = await response.json();
  if (data.error || data.result === undefined) throw new Error('unavailable');
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
  const r = JSON.parse(raw);
  if (!validRecord(r)) throw new Error('unavailable');
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
    counts: { executed: number(row?.counts?.executed), attempts: number(row?.counts?.attempts),
      acceptedResponses: number(row?.counts?.acceptedResponses),
      acceptedJournals: number(row?.counts?.acceptedJournals),
      successfulScanRecords: number(row?.counts?.successfulScanRecords),
      deleted: number(row?.counts?.deleted), remaining: number(row?.counts?.remaining) },
    status: names.includes(row?.test) && row?.status === 'PASS' ? 'PASS' : 'FAIL',
  };
}
function envelope(rows) {
  const tests = rows.slice(0, 10).map(cleanRow);
  return { tests, counts: { total: tests.length, pass: tests.filter(r => r.status === 'PASS').length,
    fail: tests.filter(r => r.status === 'FAIL').length,
    unrun: tests.filter(r => r.counts.executed === 0).length } };
}
const failRow = test => cleanRow({ test, status: 'FAIL' });
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
  } catch (_) { return failRow(name); }
}
async function balances(r, i) {
  const values = await kv(['MGET', ...keysFor(r, i).slice(0, 2)]);
  if (!Array.isArray(values) || values.length !== 2
      || values.some(v => typeof v !== 'string' || !/^\d+$/.test(v))) throw new Error('unavailable');
  const used = Number(values[0]), paid = Number(values[1]);
  if (![used, paid].every(Number.isSafeInteger)) throw new Error('unavailable');
  return { free: 1 - used, paid };
}
async function caseRun(r, i, deadline) {
  const spec = CASES[i], ctx = context(r, i), keys = keysFor(r, i);
  const checkTime = () => { if (Date.now() >= deadline || Date.now() >= RUN_END) throw new Error('expired'); };
  let attempts = 0;
  const call = async (action, extra = {}) => {
    checkTime();
    const result = await idBilling(action, { ...ctx, ...extra });
    if (!result.ok) throw new Error('billing failed');
    return result;
  };
  checkTime();
  // These keys belong solely to this unpredictable namespace.
  await kv(['MSET', keys[0], String(1 - spec.free), keys[1], String(spec.paid)]);
  const start = await balances(r, i);
  await call('debit');
  checkTime();
  const offered = await offerIdConfirmation(ctx, CANDIDATES);
  const pending = await balances(r, i);
  const selection = { candidate_set: offered.candidate_set, candidate: candidateHash(CANDIDATES[1]) };
  const accept = async () => { attempts++; return call('accept', selection); };
  let replies = [], committedWithoutResponse = false;
  if (spec.kind === 'concurrent') {
    // Wait for every attempt before finally cleanup, including failed calls.
    const settled = await Promise.allSettled(Array.from({ length: 6 }, () => accept()));
    if (settled.some(s => s.status !== 'fulfilled')) throw new Error('billing failed');
    replies = settled.map(s => s.value);
  } else if (spec.kind === 'discard') {
    await accept(); // Real module commit; deliberately do not retain the result.
    committedWithoutResponse = true; // NOT an HTTP-response interruption test.
    replies = [await accept()];
  } else if (spec.kind !== 'cancel') {
    replies = [await accept()];
    if (spec.kind === 'replay') replies.push(await accept());
  }
  const end = await balances(r, i);
  const journal = JSON.parse(await kv(['GET', keys[2]]));
  const acceptedJournals = journal.state === 'accepted' ? 1 : 0;
  const successfulScanRecords = await kv(['EXISTS', keys[3]]);
  const delta = { free: end.free - start.free, paid: end.paid - start.paid };
  const equal = replies.every(v => JSON.stringify(v) === JSON.stringify(replies[0]));
  const correct = replies.every(v => v.pickedCard?.card_name === CANDIDATES[1].name
    && v.bucket === (spec.free ? 'id_free' : 'id_paid_left'));
  const pass = start.free === spec.free && start.paid === spec.paid
    && pending.free === spec.free && pending.paid === spec.paid
    && delta.free === spec.delta[0] && delta.paid === spec.delta[1] && equal && correct
    && acceptedJournals === (spec.kind === 'cancel' ? 0 : 1) && successfulScanRecords === 0
    && (spec.kind !== 'discard' || committedWithoutResponse);
  return cleanRow({ test: spec.name, start, end, expectedDelta: { free: spec.delta[0], paid: spec.delta[1] },
    actualDelta: delta, counts: { executed: 1, attempts,
      acceptedResponses: replies.length + (committedWithoutResponse ? 1 : 0),
      acceptedJournals, successfulScanRecords },
    status: pass ? 'PASS' : 'FAIL' });
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
      try { rows.push(await caseRun(r, i, deadline)); }
      catch (_) {
        rows.push(cleanRow({ test: CASES[i].name, status: 'FAIL', counts: { executed: 1 } }));
        // Output remains PASS/FAIL only, but explicitly count unexecuted cases.
        // Report these rows as UNRUN outside this deliberately narrow schema.
        for (let j = i + 1; j < CASES.length; j++) rows.push(cleanRow({ test: CASES[j].name,
          status: 'FAIL', counts: { executed: 0, attempts: 0, acceptedResponses: 0 } }));
        break;
      }
    }
  } finally {
    rows.push(await cleanup(r, 'Synthetic cleanup'));
    try { if (await finish(worker, rows) !== 1) rows.push(failRow('Single-use guard')); }
    catch (_) { rows.push(failRow('Single-use guard')); }
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
  catch (_) { rows.push(failRow('Single-use guard')); }
  return envelope(rows);
}
function permitted(req) {
  if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_GIT_COMMIT_REF !== BRANCH
      || Date.now() >= RECOVERY_END) return false;
  const host = process.env.VERCEL_URL;
  if (!host || !/^[a-z0-9-]+\.vercel\.app$/.test(host) || req.headers.host !== host
      || req.url !== PATH || Object.keys(req.query || {}).length) return false;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return false;
  try {
    const u = new URL(process.env.KV_REST_API_URL);
    if (u.protocol !== 'https:' || !u.hostname.endsWith('.upstash.io')
        || u.username || u.password || u.port || u.search || u.hash || u.pathname !== '/') return false;
  } catch (_) { return false; }
  return true;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  if (!permitted(req)) return res.status(404).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).end();
  try {
    if (req.method === 'GET') {
      if (req.body && (typeof req.body !== 'object' || Object.keys(req.body).length)) return res.status(400).end();
      const old = await record(); // strictly read-only; no cookie, claim or seed
      const data = envelope(old?.results || []);
      const button = !old && Date.now() < RUN_END
        ? '<form method="POST"><button name="operation" value="run">Run MODULE acceptance once</button></form>' : '';
      const recovery = old ? '<form method="POST"><button name="operation" value="recover">Recover synthetic cleanup</button></form>' : '';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send('<!doctype html><meta charset="utf-8"><title>Stage1 MODULE acceptance</title>'
        + '<h1>Stage1 MODULE acceptance</h1>' + button + recovery
        + '<pre>' + JSON.stringify(data, null, 2) + '</pre>');
    }
    const body = req.body;
    if (req.headers.origin !== `https://${process.env.VERCEL_URL}`
        || req.headers['sec-fetch-site'] !== 'same-origin'
        || !['application/x-www-form-urlencoded', 'application/json'].includes((req.headers['content-type'] || '').split(';')[0])
        || !body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).length !== 1 || !['run', 'recover'].includes(body.operation)) return res.status(400).end();
    if (body.operation === 'run' && Date.now() >= RUN_END) return res.status(410).json(envelope([failRow('Single-use guard')]));
    return res.status(200).json(body.operation === 'run' ? await runOnce() : await recover());
  } catch (_) {
    // Never print or return exception messages, upstream results or credentials.
    return res.status(503).json(envelope([failRow('MODULE execution')]));
  }
}
