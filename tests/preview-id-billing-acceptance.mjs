// Temporary Stage1 MODULE harness verification; all network is intercepted.
// Exact unchanged production billing Lua executes in isolated private Redis.
import { harness } from './_assert.mjs';
import { redisRest, redisStore, redisCommand } from './_idRedis.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import handler from '../api/preview-id-billing-acceptance.js';
const t = harness('preview-id-billing-acceptance');
const BASE = '1e4122d021a81670a6659aaae7eb828d6f5d1eca';
const PATH = '/api/preview-id-billing-acceptance';
const HOST = 'synthetic-preview-acceptance.vercel.app';
const CONTROL = 'preview_id_billing_acceptance:1e4122d:stage1:v3';
const V1_CONTROL = 'preview_id_billing_acceptance:1e4122d:stage1:v1';
const V2_CONTROL = 'preview_id_billing_acceptance:1e4122d:stage1:v2';
const END = Date.parse('2026-09-16T18:00:00Z');
const RECOVERY_END = Date.parse('2026-09-23T18:00:00Z');
const CANARY = 'SYNTHETIC_ONLY_CREDENTIAL_CANARY_DO_NOT_OUTPUT';
let store, commands, outside, fault, now, probeObservations, contractObservations;
const originalNow = Date.now, originalFetch = globalThis.fetch;
Date.now = () => now;
const defaults = () => {
  store = redisStore(); commands = []; outside = []; fault = {};
  probeObservations = []; contractObservations = [];
  now = Date.parse('2026-09-15T16:00:00Z');
  process.env.VERCEL_ENV = 'preview';
  process.env.VERCEL_GIT_COMMIT_REF = 'fix/listing-export-identity';
  process.env.VERCEL_URL = HOST;
  process.env.KV_REST_API_URL = 'https://synthetic-isolated.upstash.io';
  process.env.KV_REST_API_TOKEN = 'offline-placeholder-not-a-credential';
};
globalThis.fetch = async (url, init = {}) => {
  if (String(url) !== process.env.KV_REST_API_URL) {
    outside.push(String(url)); throw new Error(CANARY);
  }
  const args = JSON.parse(init.body);
  const isBilling = args[0] === 'EVAL' && args[2] === 3;
  const isProbe = args[0] === 'EVAL' && args[2] === 1 && args[3].startsWith('id_billing:');
  if (isProbe && fault.probe === 'unavailable') throw new Error(CANARY);
  if (isProbe && fault.probe === 'shape') return Response.json({ result: CANARY });
  if (args[0] === 'GET' && args[1].startsWith('id_billing:') && fault.storage) {
    let journal = JSON.parse(await redisCommand(args));
    switch (fault.storage) {
      case 'outer': journal = '{' + CANARY; break;
      case 'oversized': journal = ' '.repeat(32769); break;
      case 'non-json-number': journal = JSON.stringify(journal).replace(/"remaining":0/, '"remaining":NaN'); break;
      case 'nested': journal.result_json = '{' + CANARY; break;
      case 'owner': journal.owner = CANARY; break;
      case 'scan': journal.scan = CANARY; break;
      case 'mode': journal.mode = 'grade'; break;
      case 'state': journal.state = 'pending'; break;
      case 'candidate-set': journal.candidate_set = CANARY; break;
      case 'candidate': journal.selected = CANARY; break;
      case 'candidate-card': journal.candidates[0].card.card_name = CANARY; break;
      case 'bucket': journal.result.bucket = 'id_retry'; journal.result_json = JSON.stringify(journal.result); break;
      case 'numeric': journal.result.remaining = 99; journal.result_json = JSON.stringify(journal.result); break;
      case 'canonical': journal.result.pickedCard.card_name = CANARY; journal.result_json = JSON.stringify(journal.result); break;
    }
    await redisCommand(['SET', args[1], typeof journal === 'string' ? journal : JSON.stringify(journal), 'KEEPTTL']);
  }
  if (fault.setup && args[0] === 'MSET') throw new Error(CANARY);
  if (fault.cleanup && args[0] === 'DEL') throw new Error(CANARY);
  if (fault.finish && args[0] === 'EVAL' && args[4] === 'finish') throw new Error(CANARY);
  if (fault.billing && isBilling && args[6] === fault.billing) {
    if (fault.billingAfter) {
      await redisRest(url, init, commands);
      throw new Error(CANARY);
    }
    throw new Error(CANARY);
  }
  if (fault.advance && isBilling) now += 26000;
  let before;
  if (isProbe) {
    const p = JSON.parse(args[4]), marker = JSON.parse(store.get(CONTROL));
    const keys = [args[3], `scans:${p.owner}:id_free_used_${marker.stamp}`, `scans:${p.owner}:id_paid_left`];
    before = { keys, bytes: await redisCommand(['MGET', ...keys]), ttl: await redisCommand(['PTTL', args[3]]) };
  }
  const response = await redisRest(url, init, commands);
  if (isProbe) {
    const after = await redisCommand(['MGET', ...before.keys]), ttl = await redisCommand(['PTTL', args[3]]);
    probeObservations.push({ bytesAndBalancesUnchanged: JSON.stringify(after) === JSON.stringify(before.bytes),
      ttlNotRenewedOrRemoved: ttl > 0 && before.ttl >= ttl && before.ttl - ttl < 1000,
      readOnlyCommands: [...args[1].matchAll(/redis\.call\('([^']+)'/g)].every(m => m[1] === 'GET') });
  }
  if (args[0] === 'GET' && args[1].startsWith('id_billing:') && !fault.storage) {
    const outer = await response.clone().json(), stored = await redisCommand(args);
    const journal = JSON.parse(outer.result);
    contractObservations.push({ exactStoredStringPreserved: typeof outer.result === 'string' && stored === outer.result,
      nestedStringParses: journal.state !== 'accepted' || (typeof journal.result_json === 'string'
        && JSON.parse(journal.result_json).ok === true) });
  }
  if (fault.claimAfter && args[0] === 'EVAL' && args[4] === 'claim') {
    fault.claimAfter = false; throw new Error(CANARY);
  }
  if (fault.shape) {
    const data = await response.json();
    if (args[0] === 'MGET') {
      fault.mgets = (fault.mgets || 0) + 1;
      if (fault.shape === 'upstream-status') return Response.json({ error: CANARY }, { status: 503 });
      if (fault.shape === 'response-json') return new Response(CANARY);
      if (fault.shape === 'missing-result') return Response.json({});
      if (fault.shape === 'upstream-error') return Response.json({ error: CANARY });
      const nth = { 'initial-numbers': 1, 'pending-numbers': 2, 'end-numbers': 3 }[fault.shape];
      if (fault.mgets === nth) data.result = data.result.map(Number);
    }
    if (args[0] === 'GET' && args[1].startsWith('id_billing:')) {
      if (fault.shape === 'journal-object') data.result = JSON.parse(data.result);
      if (fault.shape === 'journal-json') data.result = '{' + CANARY;
    }
    if (fault.shape === 'module-result-object' && isBilling && args[6] === 'debit')
      data.result = JSON.parse(data.result);
    return Response.json(data);
  }
  return response;
};
async function invoke(method = 'POST', body = { operation: 'run' }, over = {}) {
  const req = { method, body: method === 'GET' ? undefined : body, url: PATH, query: {},
    headers: { host: HOST, origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin',
      'content-type': 'application/x-www-form-urlencoded' }, ...over };
  if (over.headers) req.headers = { host: HOST, origin: `https://${HOST}`,
    'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded', ...over.headers };
  const res = { statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(n) { this.statusCode = n; return this; },
    end() { return this; }, json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; } };
  await handler(req, res);
  return res;
}
const dataKeys = () => store.keys().filter(k => k !== CONTROL);
const billingCalls = () => commands.filter(c => c.cmd === 'eval' && c.args[2] === 3);
function safeOutput(value) {
  const str = JSON.stringify(value);
  return ![CANARY, 'Authorization', 'upstash.io', 'preview-id-', 'id_billing:',
    'namespace', 'receipt', 'worker', 'stack', 'pickedCard', 'rest_sha1'].some(s => str.includes(s))
    && !/[a-f0-9]{40}/.test(str);
}
function schema(body) {
  const rowKeys = ['test', 'start', 'end', 'expectedDelta', 'actualDelta', 'counts', 'status',
    'failedStage', 'lastCompletedStage', 'diagnosticCategory', 'journalDiagnosticCategory', 'journalChecks'].sort().join();
  return body && Object.keys(body).sort().join() === 'counts,tests'
    && body.tests.every(r => Object.keys(r).sort().join() === rowKeys
      && ['PASS', 'FAIL', 'UNRUN'].includes(r.status)
      && Object.values(r.journalChecks).every(v => v === null || typeof v === 'boolean')
      && ['start', 'end', 'expectedDelta', 'actualDelta'].every(k =>
        Object.keys(r[k]).sort().join() === 'free,paid'
        && Object.values(r[k]).every(v => v === null || Number.isSafeInteger(v))));
}

try {
  for (const [name, change] of [
    ['Production env', () => { process.env.VERCEL_ENV = 'production'; }],
    ['missing env', () => { delete process.env.VERCEL_ENV; }],
    ['wrong branch', () => { process.env.VERCEL_GIT_COMMIT_REF = 'main'; }],
    ['missing branch', () => { delete process.env.VERCEL_GIT_COMMIT_REF; }],
    ['missing host identity', () => { delete process.env.VERCEL_URL; }],
    ['missing KV', () => { delete process.env.KV_REST_API_TOKEN; }],
    ['unsafe KV scheme', () => { process.env.KV_REST_API_URL = 'http://synthetic-isolated.upstash.io'; }],
    ['arbitrary KV host', () => { process.env.KV_REST_API_URL = 'https://example.invalid'; }],
    ['KV URL embeds credentials', () => { process.env.KV_REST_API_URL = 'https://user:placeholder@synthetic-isolated.upstash.io'; }],
    ['KV URL path', () => { process.env.KV_REST_API_URL += '/get/customer'; }],
    ['absolute recovery expiry', () => { now = RECOVERY_END; }],
  ]) {
    defaults(); change();
    const r = await invoke();
    t.check(`${name}:404 before any request or write`, r.statusCode === 404 && commands.length === 0 && dataKeys().length === 0);
  }
  for (const [name, method, body, over] of [
    ['wrong host', 'POST', { operation: 'run' }, { headers: { host: 'foreign.vercel.app' } }],
    ['wrong path', 'POST', { operation: 'run' }, { url: PATH + '/arbitrary' }],
    ['query URL', 'POST', { operation: 'run' }, { url: PATH + '?key=customer' }],
    ['parsed query', 'POST', { operation: 'run' }, { query: { key: 'customer' } }],
    ['cross-site origin', 'POST', { operation: 'run' }, { headers: { origin: 'https://foreign.invalid' } }],
    ['missing origin', 'POST', { operation: 'run' }, { headers: { origin: undefined } }],
    ['cross-site metadata', 'POST', { operation: 'run' }, { headers: { 'sec-fetch-site': 'cross-site' } }],
    ['missing metadata', 'POST', { operation: 'run' }, { headers: { 'sec-fetch-site': undefined } }],
    ['invalid content type', 'POST', { operation: 'run' }, { headers: { 'content-type': 'text/plain' } }],
    ['arbitrary command', 'POST', { operation: 'run', command: 'GET' }, {}],
    ['arbitrary key', 'POST', { operation: 'run', key: 'customer' }, {}],
    ['arbitrary identity', 'POST', { operation: 'run', uid: 'customer' }, {}],
    ['arbitrary value', 'POST', { operation: 'run', value: 100 }, {}],
    ['arbitrary operation', 'POST', { operation: 'eval' }, {}],
    ['array body', 'POST', ['run'], {}],
    ['string body', 'POST', 'run', {}],
    ['HEAD', 'HEAD', undefined, {}],
    ['DELETE', 'DELETE', undefined, {}],
    ['GET with body', 'GET', undefined, { body: { operation: 'run' } }],
  ]) {
    defaults();
    const r = await invoke(method, body, over);
    t.check(`${name}: refuses before KV`, r.statusCode >= 400 && commands.length === 0);
  }
  defaults();
  const get = await invoke('GET');
  t.check('GET only reads the fixed control marker', get.statusCode === 200
    && commands.length === 1 && commands[0].cmd === 'get' && commands[0].key === CONTROL);
  t.check('GET presents explicit fixed POST button, not automatic execution',
    get.body.includes('method="POST"') && get.body.includes('value="run"')
    && !get.body.includes('<script') && dataKeys().length === 0 && store.get(CONTROL) === null);
  t.check('GET has no-store and restrictive CSP', get.headers['Cache-Control'] === 'no-store'
    && get.headers['Content-Security-Policy'].includes("frame-ancestors 'none'"));

  defaults(); now = END;
  const expired = await invoke();
  t.check('absolute run expiry rejects before any KV access', expired.statusCode === 410 && commands.length === 0);
  const expiredPage = await invoke('GET');
  t.check('expired GET cannot offer execution', !expiredPage.body.includes('value="run"') && billingCalls().length === 0);

  defaults();
  const run = await invoke();
  t.check('all six MODULE cases and ordinary cleanup PASS', run.statusCode === 200
    && run.body.tests.length === 7 && run.body.counts.pass === 7 && run.body.counts.fail === 0);
  t.check('actual Lua journal raw REST string and nested result_json contract roundtrip', contractObservations.length === 6
    && contractObservations.every(c => c.exactStoredStringPreserved && c.nestedStringParses));
  t.check('fixed server diagnostics preserve exact journal bytes, balances and TTL', probeObservations.length === 6
    && probeObservations.every(c => c.bytesAndBalancesUnchanged && c.ttlNotRenewedOrRemoved && c.readOnlyCommands));
  t.check('server and REST journal assertions both mandatory and passing', run.body.tests.slice(0, 6).every(r =>
    Object.entries(r.journalChecks).every(([k, v]) => v === true
      || (r.counts.attempts === 0 && ['serverNestedJson', 'serverResult', 'restNestedJson', 'restResult'].includes(k) && v === null))));
  const expected = [[1, 1, 0, 1], [1, 0, 1, 0], [0, 1, 0, 0],
    [0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0]];
  for (let i = 0; i < 6; i++) {
    const r = run.body.tests[i], e = expected[i];
    t.check(`MODULE case${i + 1}: exact synthetic start/end`, r.start.free === e[0] && r.start.paid === e[1]
      && r.end.free === e[2] && r.end.paid === e[3]);
  }
  t.check('concurrent module case makes six real accepts', run.body.tests[4].counts.attempts === 6
    && run.body.tests[4].counts.acceptedResponses === 6);
  t.check('response counts are not confused with accepted records', run.body.tests[4].counts.acceptedJournals === 1
    && run.body.tests.every(r => r.counts.successfulScanRecords === null || r.counts.successfulScanRecords === 0)
    && run.body.tests[1].counts.acceptedJournals === 0);
  t.check('discarded module-result case is accurately labelled, two real calls',
    run.body.tests[5].test.includes('MODULE discarded committed result') && run.body.tests[5].counts.attempts === 2);
  t.check('cleanup addresses exactly24 possible synthetic data keys including scan records', dataKeys().length === 0
    && commands.find(c => c.cmd === 'del').args.length === 25);
  const marker = JSON.parse(store.get(CONTROL));
  t.check('durable consumed guard retained with no TTL', marker.consumed === true && marker.state === 'complete'
    && await redisCommand(['TTL', CONTROL]) === -1);
  t.check('no actual user/tier/Stripe/provider requests', outside.length === 0
    && commands.every(c => c.key === CONTROL || String(c.key).startsWith('scans:preview-id-')
      || String(c.key).startsWith('id_billing:') || String(c.key).startsWith('scan:preview-')));
  t.check('output is allowlisted and redacted', schema(run.body) && safeOutput(run.body));
  const originalCount = billingCalls().length;
  const duplicate = await invoke();
  t.check('second POST replays sanitized results without rerunning', JSON.stringify(duplicate.body) === JSON.stringify(run.body)
    && billingCalls().length === originalCount);
  const again = await invoke('GET');
  t.check('completed GET is read-only and does not expose synthetic keys', !again.body.includes('value="run"')
    && again.body.includes('value="recover"') && safeOutput(again.body));
  const recovered = await invoke('POST', { operation: 'recover' });
  t.check('explicit cleanup recovery never invokes billing or erases run guard', recovered.body.counts.fail === 0
    && billingCalls().length === originalCount && JSON.parse(store.get(CONTROL)).consumed === true && dataKeys().length === 0);
  await invoke();
  t.check('cleanup cannot re-enable suite execution', billingCalls().length === originalCount);
  const successful = run.body;

  // Corrupted control/result data cannot become arbitrary cleanup keys or
  // leak upstream diagnostic strings into the protected HTML/JSON response.
  const poisoned = JSON.parse(store.get(CONTROL));
  poisoned.results = [{ test: CANARY, start: { free: CANARY }, namespace: CANARY,
    counts: { acceptedResponses: CANARY }, status: 'PASS', error: CANARY,
    failedStage: CANARY, lastCompletedStage: CANARY, diagnosticCategory: CANARY }];
  poisoned.results[0].journalChecks = { serverOuterJson: CANARY, sameJournalBytes: CANARY, arbitrary: CANARY };
  poisoned.results[0].journalDiagnosticCategory = CANARY;
  store.set(CONTROL, JSON.stringify(poisoned));
  const redacted = await invoke();
  t.check('stored-result canaries are projected away, unknown test cannot PASS',
    safeOutput(redacted.body) && schema(redacted.body) && redacted.body.tests[0].status === 'FAIL');
  const redactedPage = await invoke('GET');
  t.check('stored-result canaries cannot reach HTML', safeOutput(redactedPage.body));
  poisoned.namespace = 'customer-key';
  store.set(CONTROL, JSON.stringify(poisoned));
  const delBefore = commands.filter(c => c.cmd === 'del').length;
  const badManifest = await invoke('POST', { operation: 'recover' });
  t.check('invalid manifest fails closed without arbitrary cleanup', badManifest.statusCode === 503
    && commands.filter(c => c.cmd === 'del').length === delBefore && safeOutput(badManifest.body));
  const badRepeat = await invoke();
  t.check('invalid control cannot be replaced to rerun tests', badRepeat.statusCode === 503
    && billingCalls().length === originalCount);

  defaults();
  const concurrent = await Promise.all([invoke(), invoke(), invoke()]);
  t.check('concurrent POST claims at most once', commands.filter(c => c.cmd === 'mset').length === 6
    && concurrent.every(r => r.statusCode === 200) && dataKeys().length === 0);

  for (const mode of ['setup', 'debit-before', 'debit-after', 'offer-before', 'offer-after',
    'accept-before', 'accept-after', 'cleanup', 'finish', 'deadline']) {
    defaults();
    if (mode === 'setup') fault.setup = true;
    if (mode.startsWith('debit') || mode.startsWith('offer') || mode.startsWith('accept')) {
      fault.billing = mode.split('-')[0]; fault.billingAfter = mode.endsWith('after');
    }
    if (mode === 'cleanup') fault.cleanup = true;
    if (mode === 'finish') fault.finish = true;
    if (mode === 'deadline') fault.advance = true;
    const failed = await invoke();
    t.check(`${mode}: failure is reported without sensitive payload`, failed.body.counts.fail > 0
      && schema(failed.body) && safeOutput(failed.body));
    t.check(`${mode}: one-shot remains consumed`, JSON.parse(store.get(CONTROL)).consumed === true);
    if (!['cleanup', 'finish'].includes(mode)) t.check(`${mode}: all six case rows retained, unrun counted explicitly`,
      failed.body.tests.filter(r => r.test.startsWith('MODULE ') && r.test !== 'MODULE execution').length === 6
      && failed.body.counts.unrun === 5 && failed.body.tests[1].counts.executed === 0
      && failed.body.tests[1].counts.attempts === 0 && failed.body.tests[1].status === 'UNRUN'
      && failed.body.counts.fail === 1);
    if (!['cleanup', 'finish'].includes(mode)) {
      const first = failed.body.tests[0];
      const expectedStage = mode === 'setup' ? 'seed' : mode === 'deadline' ? 'offer' : mode.split('-')[0];
      const expectedCategory = mode === 'setup' ? 'transport' : mode === 'deadline' ? 'deadline' : 'billing_unavailable';
      t.check(`${mode}: allowlisted failing stage/category retained`,
        first.failedStage === expectedStage && first.diagnosticCategory === expectedCategory);
      t.check(`${mode}: expectations and observed start/attempts survive failure`,
        first.expectedDelta.free === -1 && first.expectedDelta.paid === 0
        && (mode === 'setup' ? first.start.free === null : first.start.free === 1 && first.start.paid === 1)
        && first.counts.attempts === (mode.startsWith('accept') ? 1 : 0));
    }
    if (mode !== 'cleanup') t.check(`${mode}: finally clears synthetic data`, dataKeys().length === 0);
    fault = {};
    // Model expired lease after interruption; fixture-only local Redis edit.
    const interrupted = JSON.parse(store.get(CONTROL)); interrupted.lease = 0;
    store.set(CONTROL, JSON.stringify(interrupted));
    const before = billingCalls().length;
    const repair = await invoke('POST', { operation: 'recover' });
    t.check(`${mode}: recovery clears only synthetic data and never reruns`, repair.statusCode === 200
      && dataKeys().length === 0 && billingCalls().length === before && JSON.parse(store.get(CONTROL)).consumed === true);
  }
  defaults(); fault.claimAfter = true;
  const uncertain = await invoke();
  t.check('lost claim response fails closed before setup', uncertain.statusCode === 503
    && dataKeys().length === 0 && JSON.parse(store.get(CONTROL)).consumed === true);
  const activeRecovery = await invoke('POST', { operation: 'recover' });
  t.check('recovery cannot race active lease', activeRecovery.body.tests[0].test === 'Single-use guard'
    && !commands.some(c => c.cmd === 'del'));
  const old = JSON.parse(store.get(CONTROL)); old.lease = 0;
  store.set(CONTROL, JSON.stringify(old)); now = END + 1;
  const afterWindow = await invoke('POST', { operation: 'recover' });
  t.check('expired execution still permits only bounded cleanup recovery', afterWindow.statusCode === 200
    && afterWindow.body.tests.some(r => r.test === 'Recovery cleanup' && r.status === 'PASS') && billingCalls().length === 0);
  const repeatExpired = await invoke();
  t.check('recovery after expiry cannot enable execution', repeatExpired.statusCode === 410 && billingCalls().length === 0);

  // TTL observation is deliberately separate from acceptance correctness:
  // production MSET discards counter TTLs. Recovery, not a claimed TTL guarantee,
  // is the cleanup path for an interrupted harness.
  defaults();
  const savedFetch = globalThis.fetch;
  let observedTTL = false;
  globalThis.fetch = async (url, init) => {
    const args = JSON.parse(init.body);
    if (args[0] === 'MSET') {
      const response = await savedFetch(url, init);
      await redisCommand(['EXPIRE', args[1], 300]);
      await redisCommand(['EXPIRE', args[3], 300]);
      return response;
    }
    const response = await savedFetch(url, init);
    if (args[0] === 'EVAL' && args[2] === 3 && args[6] === 'debit') {
      const result = JSON.parse((await response.clone().json()).result);
      const key = result.bucket === 'id_free' ? args[4] : args[5];
      observedTTL = observedTTL || (await redisCommand(['TTL', key])) === -1;
    }
    return response;
  };
  const ttlRun = await invoke();
  globalThis.fetch = savedFetch;
  t.check('MSET TTL reset observed separately, not disguised as billing failure', observedTTL && ttlRun.body.counts.fail === 0);
  t.check('explicit ordinary cleanup removes counters despite TTL reset', dataKeys().length === 0);

  const shapeEvidence = [];
  for (const [shape, stage, category, previous] of [
    ['initial-numbers', 'start_balances', 'result_shape', 'seed'],
    ['pending-numbers', 'pending_balances', 'result_shape', 'offer'],
    ['end-numbers', 'end_balances', 'result_shape', 'accept'],
    ['journal-object', 'journal', 'result_shape', 'end_balances'],
    ['journal-json', 'journal', 'result_json', 'end_balances'],
    ['module-result-object', 'debit', 'billing_unavailable', 'start_balances'],
    ['upstream-status', 'start_balances', 'upstream_status', 'seed'],
    ['response-json', 'start_balances', 'response_json', 'seed'],
    ['missing-result', 'start_balances', 'result_shape', 'seed'],
    ['upstream-error', 'start_balances', 'upstream_error', 'seed'],
  ]) {
    defaults(); fault.shape = shape;
    const r = await invoke(), first = r.body.tests[0];
    t.check(`${shape}: diagnoses without normalizing unknown responses`,
      first.status === 'FAIL' && first.failedStage === stage
      && first.diagnosticCategory === category && first.lastCompletedStage === previous);
    t.check(`${shape}: redaction, UNRUN and ordinary cleanup preserved`,
      safeOutput(r.body) && schema(r.body) && r.body.counts.unrun === 5
      && r.body.tests.slice(1, 6).every(row => row.status === 'UNRUN')
      && dataKeys().length === 0 && JSON.parse(store.get(CONTROL)).consumed === true);
    if (stage === 'journal') t.check(`${shape}: already observed end/delta/attempt counts retained`,
      first.start.free === 1 && first.start.paid === 1 && first.end.free === 0 && first.end.paid === 1
      && first.actualDelta.free === -1 && first.actualDelta.paid === 0
      && first.counts.attempts === 1 && first.counts.acceptedResponses === 1);
    if (shape === 'journal-json') t.check('altered REST representation: valid stored journal cannot override failed GET parse',
      first.journalChecks.restOuterJson === false && first.journalChecks.serverOuterJson === true
      && first.journalChecks.serverNestedJson === true && first.journalChecks.serverResult === true
      && first.journalChecks.sameJournalBytes === false && first.status === 'FAIL');
    shapeEvidence.push({ injectedOfflineHypothesis: shape, first, counts: r.body.counts });
  }
  defaults();
  const v1Evidence = JSON.stringify({ preservedOriginalEvidence: true, consumed: true });
  store.set(V1_CONTROL, v1Evidence);
  const v2Evidence = JSON.stringify({ preservedOriginalEvidence: true, consumed: true, version: 2 });
  store.set(V2_CONTROL, v2Evidence);
  const v3Run = await invoke();
  await invoke('POST', { operation: 'recover' });
  t.check('v3 uses new guard and fresh namespace, never addresses v1/v2 evidence',
    v3Run.body.counts.fail === 0 && JSON.parse(store.get(CONTROL)).consumed === true
    && /^[a-f0-9]{64}$/.test(JSON.parse(store.get(CONTROL)).namespace)
    && store.get(V1_CONTROL) === v1Evidence && store.get(V2_CONTROL) === v2Evidence
    && !commands.some(c => c.args.includes(V1_CONTROL) || c.args.includes(V2_CONTROL)));

  const journalEvidence = [];
  for (const storage of ['outer', 'nested', 'owner', 'scan', 'mode', 'state', 'candidate-set',
    'candidate', 'candidate-card', 'bucket', 'numeric', 'canonical', 'oversized', 'non-json-number']) {
    defaults(); fault.storage = storage;
    const r = await invoke(), first = r.body.tests[0], checks = first.journalChecks;
    t.check(`stored ${storage}: strict journal failure, observations and cleanup retained`,
      first.status === 'FAIL' && first.failedStage === 'journal' && first.end.free === 0 && first.end.paid === 1
      && first.actualDelta.free === -1 && first.counts.acceptedResponses === 1
      && r.body.counts.unrun === 5 && dataKeys().length === 0 && safeOutput(r.body));
    if (storage === 'outer') t.check('invalid stored outer JSON: both decoders reject identical bytes',
      checks.restOuterJson === false && checks.serverOuterJson === false && checks.sameJournalBytes === true);
    else if (storage === 'nested') t.check('invalid stored nested JSON: both decoders reject nested field',
      checks.restOuterJson === true && checks.serverOuterJson === true && checks.restNestedJson === false
      && checks.serverNestedJson === false && checks.sameJournalBytes === true);
    else if (storage === 'oversized') t.check('oversized journal: bounded diagnostics reject without decoding',
      checks.serverWithinLimit === false && checks.serverOuterJson === null && checks.sameJournalBytes === null);
    else if (storage === 'non-json-number') t.check('decoder disagreement is not transport proof when exact bytes agree',
      checks.restOuterJson === false && checks.serverOuterJson === true && checks.sameJournalBytes === true
      && checks.serverResult === false && first.status === 'FAIL');
    else t.check(`stored ${storage}: independent server fixture check rejects`,
      checks.sameJournalBytes === true && [checks.serverBinding, checks.serverState, checks.serverResult].includes(false));
    journalEvidence.push({ injectedOfflineStorageFault: storage, first });
  }
  for (const probe of ['unavailable', 'shape']) {
    defaults(); fault.probe = probe;
    const r = await invoke(), first = r.body.tests[0];
    t.check(`probe ${probe}: unknown not success, strict GET observations retained`,
      first.status === 'FAIL' && first.failedStage === 'journal' && first.journalChecks.restOuterJson === true
      && first.journalChecks.restNestedJson === true && first.journalChecks.serverOuterJson === null
      && first.journalChecks.sameJournalBytes === null
      && first.journalDiagnosticCategory === (probe === 'unavailable' ? 'transport' : 'result_shape')
      && dataKeys().length === 0 && safeOutput(r.body));
  }
  defaults(); fault.probe = 'unavailable'; fault.shape = 'journal-json';
  const bothFailed = await invoke(), bothFirst = bothFailed.body.tests[0];
  t.check('probe loss never erases primary GET parse failure or invents byte equality',
    bothFirst.failedStage === 'journal' && bothFirst.diagnosticCategory === 'result_json'
    && bothFirst.journalDiagnosticCategory === 'transport' && bothFirst.journalChecks.sameJournalBytes === null
    && bothFirst.journalChecks.serverOuterJson === null && bothFirst.journalChecks.restOuterJson === false
    && bothFirst.end.free === 0 && bothFirst.end.paid === 1 && dataKeys().length === 0);

  for (const file of ['api/_idBilling.js', 'api/scan.js', 'api/scan-debit-id.js', 'api/scan-refund.js', 'api/_tier.js', 'api/_verifyToken.js']) {
    const current = readFileSync(new URL('../' + file, import.meta.url));
    const baseline = execFileSync('git', ['show', `${BASE}:${file}`], { cwd: new URL('..', import.meta.url) });
    t.check(`${file}: byte-identical to1e4122d`, current.equals(baseline));
  }
  const source = readFileSync(new URL('../api/preview-id-billing-acceptance.js', import.meta.url), 'utf8');
  t.check('live harness never monkeypatches fetch or imports auth/scan handlers',
    !/(?:globalThis|global|window)\.fetch\s*=/.test(source) && !/from ['"].*(?:scan\.js|scan-debit-id|_verifyToken)/.test(source));
  writeFileSync('/home/user/workspace/preview_stage1_v3_module_offline_evidence_20260915.json',
    JSON.stringify({ stage: 'MODULE only; authenticated handlers and HTTP interruption UNRUN',
      sourceSha256: createHash('sha256').update(source).digest('hex'), successful,
      baseline: BASE, managedRedisRun: 'UNRUN', productionRequests: 0, shapeEvidence, journalEvidence,
      rootCauseOfV2ManagedFailure: 'UNDETERMINED; local raw REST/nested journal contract passes; injected faults are not observed provider behavior' }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
}
t.done();
