// Synthetic only: real current billing Lua and fixed byte-capture Lua execute
// on private Unix-socket Redis. No external requests or managed credentials.
import { harness } from './_assert.mjs';
import { redisRest, redisStore, redisCommand } from './_idRedis.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import handler from '../api/preview-id-billing-reproduction.js';
import { ID_BILLING_SCRIPT, idBilling } from '../api/_idBilling.js';
const t = harness('preview-id-billing-reproduction');
const PATH = '/api/preview-id-billing-reproduction', HOST = 'synthetic-reproduction.vercel.app';
const CONTROL = 'preview_id_billing_reproduction:1e4122d:v6';
const BILLING_GUARD_SHA256 = '8421956233263237dbb941e154b8a8ab315db49bd3ee16c089ccb6d894238a1a';
const OLD = [...[1, 2, 3, 5].map(v => `preview_id_billing_acceptance:1e4122d:stage1:v${v}`),
  'preview_id_billing_reproduction:1e4122d:v4'];
const CANARY = 'FOREIGN_SECRET_CANARY_NOT_SYNTHETIC';
const END = Date.parse('2026-09-16T18:00:00Z'), RECOVERY_END = Date.parse('2026-09-23T18:00:00Z');
const originalFetch = globalThis.fetch, originalNow = Date.now;
let store, commands, fault, now, savedRaw, checkpointBeforeNext, lastPhase, probes, equivalence;
function reset() {
  store = redisStore(); commands = []; fault = {}; savedRaw = new Map();
  checkpointBeforeNext = []; probes = [];
  lastPhase = null; equivalence = null; now = Date.parse('2026-09-15T18:00:00Z');
  process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_GIT_COMMIT_REF = 'fix/listing-export-identity';
  process.env.VERCEL_URL = HOST; process.env.KV_REST_API_URL = 'https://synthetic-reproduction.upstash.io';
  process.env.KV_REST_API_TOKEN = 'offline-placeholder-only';
}
Date.now = () => now;
globalThis.fetch = async (url, init) => {
  if (String(url) !== process.env.KV_REST_API_URL) throw new Error('forbidden external request');
  const a = JSON.parse(init.body), billing = a[0] === 'EVAL' && a[2] === 3;
  const probe = a[0] === 'EVAL' && a[2] === 1 && a[3].startsWith('id_billing:');
  if (fault.cleanup && a[0] === 'DEL') throw new Error(CANARY);
  if (fault.checkpoint && a[0] === 'EVAL' && a[4] === 'checkpoint') throw new Error(CANARY);
  if (fault.finish && a[0] === 'EVAL' && a[4] === 'finish') throw new Error(CANARY);
  if ((fault.probe || (fault.probeAccept && lastPhase === 'accept')) && probe) throw new Error(CANARY);
  if ((fault.rest || (fault.restAccept && lastPhase === 'accept'))
      && a[0] === 'GET' && a[1].startsWith('id_billing:')) throw new Error(CANARY);
  if (billing) {
    if (lastPhase) {
      const marker = JSON.parse(store.get(CONTROL));
      const evidence = JSON.parse(Buffer.from(marker.artifact, 'base64').toString());
      checkpointBeforeNext.push(evidence.captures.some(c => c.phase === lastPhase));
    }
    lastPhase = a[6];
  }
  let before;
  if (probe) before = { raw: await redisCommand(['GET', a[3]]), ttl: await redisCommand(['PTTL', a[3]]) };
  let prefix = '';
  if (billing && a[6] === 'accept') {
    if (fault.native) {
      const outer = fault.native.startsWith('outer');
      const condition = outer ? "type(v)=='table' and v.state=='accepted'"
        : "type(v)=='table' and v.ok==true and v.pickedCard";
      const outcome = fault.native.endsWith('nil') ? "return nil,'ignored secondary return'"
        : fault.native.endsWith('false') ? 'return false'
        : `error('${CANARY}')`;
      prefix = `local real=cjson;local cjson={decode=real.decode,encode=function(v)
        if ${condition} then ${outcome} end;return real.encode(v) end}\n`;
    }
    if (fault.decode) prefix = `local real=cjson;local count=0
      local cjson={encode=real.encode,decode=function(v)
      count=count+1;if count==${fault.decode} then return nil,'ignored secondary return' end
      return real.decode(v) end}\n`;
    if (fault.postWrite) prefix = `local originalRedis=redis;local redis={call=function(...)
      local result=originalRedis.call(...)
      if select(1,...)=='MSET' then error('${CANARY}') end;return result end}\n`;
    if (fault.rejected) {
      const payload = JSON.parse(a[7]); payload.candidate = '0'.repeat(64); a[7] = JSON.stringify(payload);
    }
    if (fault.equivalence) {
      // Ask the real JS helper to build its request (no second execution).
      // Capture only within this isolated test process; never live-route fetch.
      const restoreFetch = globalThis.fetch;
      let helperArgs;
      globalThis.fetch = async (_, request) => {
        helperArgs = JSON.parse(request.body);
        return Response.json({ result: JSON.stringify({ ok: false, code: 'test_request_only' }) });
      };
      try { await idBilling('accept', JSON.parse(a[7])); }
      finally { globalThis.fetch = restoreFetch; }
      const beforeValues = await redisCommand(['MGET', ...a.slice(3, 6)]);
      let originalResult, originalFailed = false;
      try { originalResult = await redisCommand(['EVAL', prefix + ID_BILLING_SCRIPT, ...a.slice(2)]); }
      catch (_) { originalFailed = true; }
      const originalAfter = await redisCommand(['MGET', ...a.slice(3, 6)]);
      await redisCommand(['MSET', ...a.slice(3, 6).flatMap((key, i) => [key, beforeValues[i]])]);
      equivalence = { originalResult, originalFailed, originalAfter,
        exactHelperKeysArgv: JSON.stringify(helperArgs.slice(2)) === JSON.stringify(a.slice(2)) };
    }
    a[1] = prefix + a[1];
  }
  const response = await redisRest(url, { ...init, body: JSON.stringify(a) }, commands);
  if (billing && a[6] === 'accept' && fault.equivalence) {
    equivalence.instrumented = (await response.clone().json()).result;
    equivalence.instrumentedAfter = await redisCommand(['MGET', ...a.slice(3, 6)]);
  }
  if (billing && a[6] === 'accept' && fault.corrupt) {
    const raw = await redisCommand(['GET', a[3]]);
    let altered = raw;
    if (fault.corrupt === 'outer') altered = raw.slice(0, -1);
    if (fault.corrupt === 'nested') {
      const value = JSON.parse(raw); value.result_json = value.result_json.slice(0, -1);
      altered = JSON.stringify(value);
    }
    if (fault.corrupt === 'foreign') altered = CANARY;
    if (fault.corrupt === 'oversized') altered = ' '.repeat(8193);
    if (fault.corrupt === 'utf8') {
      // Set binary inside Redis: the fixture command wrapper intentionally
      // stringifies ordinary arguments, which would otherwise replace0xff.
      await redisCommand(['EVAL', "local s=redis.call('GET',KEYS[1]);redis.call('SET',KEYS[1],string.sub(s,1,#s-1)..string.char(255),'KEEPTTL');return 1", 1, a[3]]);
    } else await redisCommand(['SET', a[3], altered, 'KEEPTTL']);
  }
  if (billing) {
    // Numeric vector preserves arbitrary bytes even node-redis GET text decoder
    // substitutes invalid UTF8; this is local ground truth, not managed evidence.
    const v = await redisCommand(['EVAL',
      "local s=redis.call('GET',KEYS[1]);local a={};for i=1,#s do a[i]=string.byte(s,i) end;return a", 1, a[3]]);
    savedRaw.set(a[6], Buffer.from(v));
    if (fault.advance) now += 26000;
    if (fault.lostAccept && a[6] === 'accept') throw new Error(CANARY);
  }
  if (probe) {
    const raw = await redisCommand(['GET', a[3]]), ttl = await redisCommand(['PTTL', a[3]]);
    probes.push(raw === before.raw && ttl > 0 && ttl <= before.ttl && before.ttl - ttl < 1000);
  }
  if (fault.claimAfter && a[0] === 'EVAL' && a[4] === 'claim') { fault.claimAfter = false; throw new Error(CANARY); }
  if (fault.alteredRest && a[0] === 'GET' && a[1].startsWith('id_billing:') && lastPhase === 'accept') {
    const data = await response.json(); data.result = data.result.slice(0, -1);
    return Response.json(data);
  }
  if (billing && a[6] === 'accept' && fault.snapshotUnavailable) {
    const data = await response.json(); data.result[3][0] = [3, 0, 0];
    return Response.json(data);
  }
  return response;
};
async function invoke(operation = 'run', over = {}) {
  const req = { method: 'POST', url: PATH, query: {}, body: { operation },
    headers: { host: HOST, origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    ...over };
  if (over.headers) req.headers = { host: HOST, origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin',
    'content-type': 'application/json', ...over.headers };
  const res = { statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; return this; }, status(n) { this.statusCode = n; return this; },
    json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; }, end() { return this; } };
  await handler(req, res);
  if (res.headers['Content-Disposition']) res.evidence = JSON.parse(res.body);
  return res;
}
const dataKeys = () => store.keys().filter(k => k !== CONTROL && !OLD.includes(k));
const billingCalls = () => commands.filter(c => c.cmd === 'eval' && c.args[2] === 3);
const safeOutput = r => ![CANARY, 'Authorization', 'Bearer', 'upstash.io', 'KV_REST', 'VERCEL_', 'headers', 'stack']
  .some(s => JSON.stringify(r).includes(s));
const evidence = [];
try {
  for (const [name, change] of [
    ['production', () => { process.env.VERCEL_ENV = 'production'; }],
    ['missing env', () => { delete process.env.VERCEL_ENV; }],
    ['branch', () => { process.env.VERCEL_GIT_COMMIT_REF = 'main'; }],
    ['missing branch', () => { delete process.env.VERCEL_GIT_COMMIT_REF; }],
    ['missing host', () => { delete process.env.VERCEL_URL; }],
    ['missing KV', () => { delete process.env.KV_REST_API_TOKEN; }],
    ['insecure KV', () => { process.env.KV_REST_API_URL = 'http://synthetic.upstash.io'; }],
    ['foreign KV', () => { process.env.KV_REST_API_URL = 'https://example.invalid'; }],
    ['KV credential URL', () => { process.env.KV_REST_API_URL = 'https://user:fake@synthetic.upstash.io'; }],
    ['KV path', () => { process.env.KV_REST_API_URL += '/get'; }],
    ['KV query', () => { process.env.KV_REST_API_URL += '?x=1'; }],
    ['absolute expiry', () => { now = RECOVERY_END; }],
  ]) {
    reset(); change(); const r = await invoke();
    t.check(`${name}:404 before any request`, r.statusCode === 404 && commands.length === 0);
  }
  for (const [name, over] of [
    ['host', { headers: { host: 'wrong.vercel.app' } }],
    ['path', { url: PATH + '/arbitrary' }],
    ['query', { url: PATH + '?download=1' }],
    ['parsed query', { query: { command: 'GET' } }],
    ['origin', { headers: { origin: 'https://foreign.invalid' } }],
    ['missing origin', { headers: { origin: undefined } }],
    ['metadata', { headers: { 'sec-fetch-site': 'cross-site' } }],
    ['missing metadata', { headers: { 'sec-fetch-site': undefined } }],
    ['type', { headers: { 'content-type': 'text/plain' } }],
    ['arbitrary operation', { body: { operation: 'eval' } }],
    ['arbitrary key', { body: { operation: 'run', key: 'customer' } }],
    ['arbitrary value', { body: { operation: 'run', value: 1 } }],
    ['arbitrary command', { body: { operation: 'run', command: 'GET' } }],
    ['arbitrary identity', { body: { operation: 'run', owner: 'customer' } }],
    ['array', { body: ['run'] }], ['null', { body: null }], ['HEAD', { method: 'HEAD' }],
    ['GET body', { method: 'GET', body: { operation: 'run' } }],
  ]) {
    reset(); const r = await invoke('run', over);
    t.check(`${name}:refused before KV`, r.statusCode >= 400 && commands.length === 0);
  }
  reset();
  const page = await invoke(null, { method: 'GET', body: undefined });
  t.check('GET only reads fixed control and presents explicit POST', commands.length === 1
    && commands[0].key === CONTROL && commands[0].cmd === 'get'
    && page.body.includes('method="POST"') && !page.body.includes('<script') && dataKeys().length === 0);
  t.check('GET has no-store/CSP, no raw evidence inline', page.headers['Cache-Control'] === 'no-store'
    && page.headers['Content-Security-Policy'].includes("frame-ancestors 'none'") && !page.body.includes('base64'));
  reset(); now = END;
  t.check('run expiry410 without KV', (await invoke()).statusCode === 410 && commands.length === 0);
  reset();
  OLD.forEach((k, i) => store.set(k, `preserved-v${i + 1}`));
  const run = await invoke(), a = run.evidence;
  t.check('only fixed free-first debit/offer/accept sequence executes', a.status === 'CAPTURED'
    && a.acceptance === 'NOT_EVALUATED'
    && billingCalls().map(c => c.args[6]).join() === 'debit,offer,accept');
  t.check('exact fixture balance start1/1 end0/1 and cleanup3/0', a.start.free === 1 && a.start.paid === 1
    && a.end.free === 0 && a.end.paid === 1 && a.cleanup.deleted === 3 && a.cleanup.remaining === 0);
  t.check('download is attachment with fixed name and synthetic-only data', run.headers['Content-Disposition']
    === 'attachment; filename="cardresell-synthetic-journal-reproduction.json"' && safeOutput(a));
  t.check('captures after each transition before cleanup', a.captures.map(c => c.phase).join() === 'debit,offer,accept'
    && a.captures.every(c => c.sameBytes === true && c.rest.outer.valid && c.lua.outer.valid)
    && a.captures[2].rest.nested.valid && a.captures[2].lua.nested.valid);
  for (const c of a.captures) t.check(`${c.phase}:exact byte vector ground truth roundtrip`,
    Buffer.from(c.lua.base64, 'base64').equals(savedRaw.get(c.phase))
    && c.rest.rawString === savedRaw.get(c.phase).toString('utf8')
    && c.lua.byteLength === savedRaw.get(c.phase).length);
  t.check('every earlier capture checkpointed before next financial operation', checkpointBeforeNext.length === 2
    && checkpointBeforeNext.every(Boolean));
  t.check('byte probes read-only and TTL-preserving', probes.length === 3 && probes.every(Boolean));
  t.check('four possible synthetic data keys deleted, guard retained without TTL',
    commands.find(c => c.cmd === 'del').args.length === 5 && dataKeys().length === 0
    && await redisCommand(['TTL', CONTROL]) === -1 && JSON.parse(store.get(CONTROL)).consumed === true);
  t.check('v1/v2/v3 markers never addressed or changed', OLD.every((k, i) => store.get(k) === `preserved-v${i + 1}`)
    && commands.every(c => OLD.every(k => !c.args.includes(k))));
  const count = billingCalls().length;
  const download = await invoke('download'), replay = await invoke();
  t.check('download and one-shot replay reproduce artifact after cleanup without billing',
    download.body === run.body && replay.body === run.body && billingCalls().length === count);
  const marker = JSON.parse(store.get(CONTROL));
  t.check('evidence stored as JS JSON base64, not nested raw string in control',
    /^[A-Za-z0-9+/=]+$/.test(marker.artifact)
    && JSON.parse(Buffer.from(marker.artifact, 'base64').toString()).captures.length === 3);
  const recovery = await invoke('recover');
  t.check('recovery retains captures/consumed guard and only redoes cleanup', recovery.evidence.captures.length === 3
    && recovery.evidence.recoveryCleanup.deleted === 0 && billingCalls().length === count
    && JSON.parse(store.get(CONTROL)).consumed === true);
  evidence.push({ scenario: 'ordinary fixed sequence', artifact: a });
  for (const corrupt of ['outer', 'nested', 'foreign', 'utf8', 'oversized']) {
    reset(); fault.corrupt = corrupt;
    const r = await invoke(), e = r.evidence, c = e.captures[2];
    t.check(`${corrupt}:captured before cleanup, invalid never PASS`, e.status === 'FAIL'
      && e.captures.length === 3 && e.end.free === 0 && e.end.paid === 1
      && dataKeys().length === 0 && safeOutput(e));
    if (['outer', 'nested'].includes(corrupt)) {
      t.check(`${corrupt}:malformed bytes faithfully preserved and parse failure explicit`,
        Buffer.from(c.lua.base64, 'base64').equals(savedRaw.get('accept'))
        && c.rest.rawString === savedRaw.get('accept').toString('utf8')
        && c.sameBytes === true && (corrupt === 'outer' ? !c.rest.outer.valid : !c.rest.nested.valid));
      const again = await invoke('download');
      t.check(`${corrupt}:malformed evidence survives control roundtrip after cleanup`,
        again.body === r.body && again.evidence.captures[2].lua.base64 === c.lua.base64);
    }
    if (corrupt === 'foreign') t.check('unknown nonfixture content withheld from strings and base64',
      c.withheld && c.rest === null && c.lua === null
      && !JSON.stringify(e).includes(Buffer.from(CANARY).toString('base64')));
    if (corrupt === 'utf8') t.check('invalid UTF8 exact bytes retained; REST substitution detected at first difference',
      c.lua.utf8Valid === false && c.sameBytes === false && c.firstDifference
      && Buffer.from(c.lua.base64, 'base64').equals(savedRaw.get('accept')));
    if (corrupt === 'oversized') t.check('capture bound fails closed without exporting oversized payload',
      c.rest === null && c.lua === null);
    evidence.push({ scenario: `injected ${corrupt}`, artifact: e });
  }
  reset(); fault.alteredRest = true;
  const changed = await invoke(), changedCapture = changed.evidence.captures[2];
  t.check('changed REST representation has exact differing offset and independent valid Lua journal',
    changed.evidence.status === 'FAIL' && changedCapture.sameBytes === false
    && changedCapture.firstDifference.offset === changedCapture.rest.byteLength
    && changedCapture.firstDifference.restByte === null && changedCapture.lua.outer.valid
    && !changedCapture.rest.outer.valid);
  for (const mode of ['rest', 'probe', 'checkpoint', 'finish', 'cleanup', 'lostAccept', 'advance']) {
    reset(); fault[mode] = true;
    const r = await invoke(), e = r.evidence;
    t.check(`${mode}:fail closed without raw exception`, e && e.status === 'FAIL' && safeOutput(e)
      && JSON.parse(store.get(CONTROL)).consumed === true);
    if (mode === 'checkpoint') t.check('lost checkpoint stops before offer, immediate attachment preserves capture',
      billingCalls().length === 1 && e.captures.length === 1);
    if (mode === 'advance') t.check('deadline still captures attempted transition, never starts next',
      billingCalls().length === 1 && e.captures.length === 1);
    if (mode === 'lostAccept') t.check('lost committed module response captures accepted journal before cleanup',
      e.captures.length === 3 && e.captures[2].lua.nested.valid && e.error === 'transport'
      && e.acceptDiagnostic.mutationCommitted === null && e.acceptDiagnostic.trace.returned === false);
    fault = {};
    const before = billingCalls().length, m = JSON.parse(store.get(CONTROL)); m.lease = 0;
    store.set(CONTROL, JSON.stringify(m));
    const repair = await invoke('recover');
    t.check(`${mode}:fixed recovery removes only synthetic keys, never reruns`,
      repair.statusCode === 200 && dataKeys().length === 0 && billingCalls().length === before
      && JSON.parse(store.get(CONTROL)).consumed === true);
  }
  reset(); fault.claimAfter = true;
  t.check('lost claim fails closed before seed', (await invoke()).statusCode === 503
    && billingCalls().length === 0 && JSON.parse(store.get(CONTROL)).consumed === true);
  t.check('recovery refuses active lease', (await invoke('recover')).statusCode === 503
    && !commands.some(c => c.cmd === 'del'));
  reset();
  const concurrent = await Promise.all([invoke(), invoke(), invoke()]);
  t.check('concurrent control claims only one fixed sequence', billingCalls().length === 3
    && concurrent.some(r => r.evidence?.status === 'CAPTURED') && dataKeys().length === 0);
  const poisoned = JSON.parse(store.get(CONTROL));
  const poisonArtifact = JSON.parse(Buffer.from(poisoned.artifact, 'base64').toString());
  poisonArtifact.account = CANARY; poisonArtifact.scope = CANARY;
  poisonArtifact.captures[0].transportError = CANARY;
  poisoned.artifact = Buffer.from(JSON.stringify(poisonArtifact)).toString('base64');
  store.set(CONTROL, JSON.stringify(poisoned));
  t.check('stored artifact arbitrary metadata cannot escape download', safeOutput((await invoke('download')).body));
  poisonArtifact.captures[0].lua.base64 = Buffer.from(CANARY).toString('base64');
  poisoned.artifact = Buffer.from(JSON.stringify(poisonArtifact)).toString('base64');
  store.set(CONTROL, JSON.stringify(poisoned));
  t.check('stored artifact foreign bytes refused without content disclosure',
    (await invoke('download')).statusCode === 503);
  t.check('artifact poisoning cannot prevent fixed recovery cleanup',
    (await invoke('recover')).evidence.recoveryCleanup.status === 'PASS');
  const originalKeys = dataKeys().length;
  const bad = JSON.parse(store.get(CONTROL)); bad.namespace = 'foreign';
  store.set(CONTROL, JSON.stringify(bad));
  t.check('invalid manifest refused before arbitrary deletion',
    (await invoke('recover')).statusCode === 503 && dataKeys().length === originalKeys);
  const comparable = values => values.map((raw, i) => {
    if (i !== 0) return raw;
    const v = JSON.parse(raw); delete v.replay_expires; return JSON.stringify(v);
  });
  for (const scenario of ['normal', 'outer-nil', 'outer-false', 'outer-throw',
    'result-nil', 'result-false', 'result-throw', 'decode2', 'decode3', 'decode4', 'postWrite', 'rejected']) {
    reset(); fault.equivalence = true;
    if (scenario.includes('-')) fault.native = scenario;
    if (scenario.startsWith('decode')) fault.decode = Number(scenario.slice(-1));
    if (scenario === 'postWrite') fault.postWrite = true;
    if (scenario === 'rejected') fault.rejected = true;
    const response = await invoke(), e = response.evidence, d = e.acceptDiagnostic, trace = d.trace;
    const isSuccess = scenario === 'normal', rejected = scenario === 'rejected';
    t.check(`${scenario}:exact original versus instrumented result/error equivalence`,
      equivalence.originalFailed === (!isSuccess && !rejected)
      && equivalence.instrumented[0] === (equivalence.originalFailed ? 0 : 1)
      && (equivalence.originalFailed || equivalence.originalResult === equivalence.instrumented[5]));
    t.check(`${scenario}:all three original and instrumented final values equal`,
      JSON.stringify(comparable(equivalence.originalAfter)) === JSON.stringify(comparable(equivalence.instrumentedAfter)));
    const call = billingCalls().find(c => c.args[6] === 'accept');
    t.check(`${scenario}:one instrumented accept embeds exact billing bytes with original KEYS/ARGV`,
      billingCalls().filter(c => c.args[6] === 'accept').length === 1
      && call.args[1].includes(ID_BILLING_SCRIPT)
      && call.args[3].startsWith('id_billing:') && call.args[4].includes(':id_free_used_')
      && call.args[5].endsWith(':id_paid_left') && call.args[8] === 86400
      && Object.keys(JSON.parse(call.args[7])).join() === 'owner,scan,mode,receipt,stamp,grant,candidate_set,candidate'
      && equivalence.exactHelperKeysArgv);
    t.check(`${scenario}:bounded actual error categories, byte evidence and cleanup`,
      trace.returned === true && trace.before.journal.data.outer.valid
      && trace.after.journal.data.outer.valid && safeOutput(e) && e.cleanup.remaining === 0
      && e.acceptance === 'NOT_EVALUATED' && e.scope.includes('NOT normal JS'));
    if (isSuccess || scenario === 'postWrite') {
      t.check(`${scenario}:actual same-EVAL mutation committed including post-MSET throw`,
        d.mutationCommitted === true && d.beforeState === 'pending' && d.afterState === 'accepted'
        && e.end.free === 0 && e.end.paid === 1
        && (isSuccess ? e.status === 'CAPTURED' : e.status === 'FAIL' && e.error === 'lua_other'));
    } else {
      t.check(`${scenario}:error cannot charge or overwrite exact pending journal`,
        d.mutationCommitted === false && d.beforeState === 'pending' && d.afterState === 'pending'
        && d.journalBytesUnchanged && d.balancesUnchanged && e.end.free === 1 && e.end.paid === 1);
    }
    if (scenario.includes('-')) {
      const phase = scenario.startsWith('outer') ? 'journalEncode' : 'resultEncode';
      t.check(`${scenario}:actual native return/throw distinguished without message`,
        trace.phases[phase] === (scenario.endsWith('nil') ? 'nil' : scenario.endsWith('false') ? 'other' : 'throw')
        && trace.errorCategory === 'lua_invalid_encoding');
    }
    if (scenario.startsWith('decode')) {
      const phase = { 2: 'journalDecode', 3: 'resultDecode', 4: 'journalRoundtripDecode' }[fault.decode];
      t.check(`${scenario}:actual silent decoder nil classified at exact phase`, trace.phases[phase] === 'nil'
        && trace.errorCategory === (fault.decode === 2 ? 'lua_invalid_journal' : 'lua_invalid_encoding'));
    }
    const again = await invoke('download');
    t.check(`${scenario}:direct trace and snapshots survive durable base64 roundtrip`, again.body === response.body);
    evidence.push({ scenario: `instrumented equivalence ${scenario}`, artifact: e });
  }
  reset(); fault.native = 'outer-nil'; fault.probeAccept = true;
  const noExternal = (await invoke()).evidence;
  t.check('failed external byte probe cannot erase conclusive same-EVAL pending/no-charge evidence',
    noExternal.acceptDiagnostic.mutationCommitted === false && noExternal.end.free === 1
    && noExternal.cleanup.remaining === 0);
  reset(); fault.lostAccept = true; fault.restAccept = true; fault.probeAccept = true;
  const unknown = (await invoke()).evidence;
  t.check('lost transaction response and unavailable external bytes stay UNKNOWN, not false',
    unknown.acceptDiagnostic.mutationCommitted === null && unknown.acceptDiagnostic.trace.returned === false
    && unknown.captures.length === 3 && unknown.end.free === 0 && unknown.cleanup.remaining === 0);
  reset(); fault.native = 'outer-nil'; fault.snapshotUnavailable = true;
  const missingSnapshot = (await invoke()).evidence;
  t.check('returned wrapper with incomplete same-EVAL snapshot stays UNKNOWN despite later pending reads',
    missingSnapshot.acceptDiagnostic.trace.returned && missingSnapshot.acceptDiagnostic.mutationCommitted === null
    && missingSnapshot.captures[2].lua.outer.valid && missingSnapshot.end.free === 1);
  reset(); await invoke();
  const traceMarker = JSON.parse(store.get(CONTROL));
  const traceArtifact = JSON.parse(Buffer.from(traceMarker.artifact, 'base64').toString());
  for (const incomplete of [null, { ok: true, bucket: 'id_free',
    scan_id: JSON.parse(traceArtifact.acceptDiagnostic.trace.after.journal.data.utf8Text).scan,
    remaining: 0, free_remaining: 0, paid_remaining: 1 }]) {
    const changed = structuredClone(traceArtifact);
    const journal = JSON.parse(changed.acceptDiagnostic.trace.after.journal.data.utf8Text);
    journal.result_json = JSON.stringify(incomplete);
    const raw = JSON.stringify(journal);
    changed.acceptDiagnostic.trace.after.journal.data.base64 = Buffer.from(raw).toString('base64');
    changed.acceptDiagnostic.trace.after.journal.byteLength = Buffer.byteLength(raw);
    traceMarker.artifact = Buffer.from(JSON.stringify(changed)).toString('base64');
    store.set(CONTROL, JSON.stringify(traceMarker));
    const downloaded = await invoke('download');
    t.check(`synthetic nested ${incomplete === null ? 'null' : 'missing-card'} bytes retained without fabricating commit`,
      downloaded.statusCode === 200 && downloaded.evidence.acceptDiagnostic.mutationCommitted === null);
  }
  traceArtifact.acceptDiagnostic.trace.before.journal.data.base64 = Buffer.from(CANARY).toString('base64');
  traceArtifact.acceptDiagnostic.trace.before.journal.byteLength = Buffer.byteLength(CANARY);
  traceMarker.artifact = Buffer.from(JSON.stringify(traceArtifact)).toString('base64');
  store.set(CONTROL, JSON.stringify(traceMarker));
  const refusedTrace = await invoke('download');
  t.check('foreign same-EVAL snapshot content cannot escape download in strings or base64',
    refusedTrace.statusCode === 503 && safeOutput(refusedTrace.body)
    && !JSON.stringify(refusedTrace.body).includes(Buffer.from(CANARY).toString('base64')));
  for (const file of ['api/_idBilling.js', 'api/scan.js', 'api/scan-debit-id.js', 'api/scan-refund.js', 'api/_tier.js', 'api/_verifyToken.js']) {
    const bytes = readFileSync(new URL('../' + file, import.meta.url));
    t.check(`${file}:${file === 'api/_idBilling.js' ? 'pinned serialization guard' : 'unchanged1e4122d'}`,
      file === 'api/_idBilling.js' ? createHash('sha256').update(bytes).digest('hex') === BILLING_GUARD_SHA256
        : bytes.equals(execFileSync('git', ['show', `1e4122d:${file}`], { cwd: new URL('..', import.meta.url) })));
  }
  const source = readFileSync(new URL('../api/preview-id-billing-reproduction.js', import.meta.url), 'utf8');
  t.check('live route never patches fetch or imports auth handlers', !/globalThis\.fetch\s*=/.test(source)
    && !/from ['"].*(?:scan\.js|scan-debit-id|_verifyToken)/.test(source));
  t.check('separate reconstruction removed; tracing does not rewrite billing source',
    !source.includes('SERIALIZER_PROBE') && source.includes('` + ID_BILLING_SCRIPT + `')
    && !/ID_BILLING_SCRIPT\.replace/.test(source));
  writeFileSync('/home/user/workspace/structural_copy_v6_instrumentation_regression_20260916.json',
    JSON.stringify({ sourceSha256: createHash('sha256').update(source).digest('hex'),
      billingGuardSha256: BILLING_GUARD_SHA256,
      scope: 'Local synthetic injected faults; NOT managed data or root-cause proof', evidence }, null, 2));
} finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
t.done();
