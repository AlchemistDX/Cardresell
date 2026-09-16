// Private Unix-socket Redis only; exact fixed Lua, native local encoder and
// explicitly labeled fault-injection hypotheses. Never managed-provider proof.
import { harness } from './_assert.mjs';
import { redisRest, redisStore, redisCommand } from './_idRedis.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import handler from '../api/preview-id-serialization-comparison.js';
import { idBilling, offerIdConfirmation, candidateHash } from '../api/_idBilling.js';
const t = harness('preview-id-serialization-comparison');
const PATH = '/api/preview-id-serialization-comparison', HOST = 'synthetic-comparison.vercel.app';
const CONTROL = 'preview_id_encoder_comparison:1e4122d:v7';
const OLD = ['preview_id_billing_reproduction:1e4122d:v4', 'preview_id_billing_reproduction:1e4122d:v6',
  ...[1, 2, 3, 5].map(v => `preview_id_billing_acceptance:1e4122d:stage1:v${v}`)];
const CANARY = 'FOREIGN_SECRET_CANARY';
const originalFetch = globalThis.fetch, originalNow = Date.now;
let store, commands, fault, now;
function reset() {
  store = redisStore(); commands = []; fault = null; now = Date.parse('2026-09-16T00:00:00Z');
  process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_GIT_COMMIT_REF = 'fix/listing-export-identity';
  process.env.VERCEL_URL = HOST; process.env.KV_REST_API_URL = 'https://synthetic-comparison.upstash.io';
  process.env.KV_REST_API_TOKEN = 'offline-placeholder-only';
}
Date.now = () => now;
globalThis.fetch = async (url, init) => {
  if (String(url) !== process.env.KV_REST_API_URL) throw new Error('external request forbidden');
  const a = JSON.parse(init.body), comparison = a[0] === 'EVAL' && a[2] === 0;
  if (fault === 'control-read' && a[0] === 'GET' && a[1] === CONTROL) throw new Error(CANARY);
  if (fault === 'finish' && a[4] === 'finish') throw new Error(CANARY);
  if (fault === 'transport' && comparison) throw new Error(CANARY);
  if (comparison && ['shared-nil', 'shared-false', 'shared-throw', 'both-nil', 'result-nil', 'mutation',
    'malformed', 'roundtrip', 'order'].includes(fault)) {
    const selected = "type(v)=='table' and v.state=='accepted'";
    const shared = `${selected} and v.result.pickedCard==v.candidates[2].card`;
    const effect = {
      'shared-nil': `if ${shared} then return nil,'${CANARY}' end`,
      'shared-false': `if ${shared} then return false end`,
      'shared-throw': `if ${shared} then error('${CANARY}') end`,
      'both-nil': `if ${selected} then return nil end`,
      'result-nil': "if type(v)=='table' and v.ok==true and v.pickedCard then return nil end",
      mutation: `if ${shared} then v.result.pickedCard.number='3' end`,
      malformed: `if ${shared} then return 'nil' end`,
      roundtrip: `if ${shared} then return '{}' end`,
      order: `if ${selected} then calls=calls+1;if calls%2==1 then return nil end end`,
    }[fault];
    a[1] = `local native=cjson;local calls=0;local cjson={decode=native.decode,
      encode=function(v) ${effect};return native.encode(v) end}\n` + a[1];
  }
  const res = await redisRest(url, { ...init, body: JSON.stringify(a) }, commands);
  if (comparison && fault === 'lost') throw new Error(CANARY);
  if (comparison && fault === 'shape') return Response.json({ result: [CANARY] });
  if (comparison && fault === 'advance') now = Date.parse('2026-09-16T19:00:00Z');
  return res;
};
async function invoke(operation = 'run', overrides = {}) {
  const req = { method: 'POST', url: PATH, query: {}, body: { operation }, ...overrides,
    headers: { host: HOST, origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin',
      'content-type': 'application/json', ...overrides.headers } };
  const res = { statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; return this; }, status(n) { this.statusCode = n; return this; },
    json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; }, end() { return this; } };
  await handler(req, res);
  if (res.headers['Content-Disposition']?.startsWith('attachment')) res.evidence = JSON.parse(res.body);
  else if (typeof res.body === 'string') {
    const match = /<pre id="evidence"[^>]*>([\s\S]*?)<\/pre>/.exec(res.body);
    if (match) res.evidence = JSON.parse(match[1].replace(/&(?:amp|lt|gt|quot);/g,
      entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' })[entity]));
  }
  return res;
}
const comparisonCalls = () => commands.filter(c => c.cmd === 'eval' && c.args[2] === 0);
const safe = value => ![CANARY, 'Bearer', 'Authorization', 'upstash.io', 'KV_REST', 'VERCEL_',
  'preview-comparison-', 'preview_id_', 'scans:', 'owner', 'headers', 'stack'].some(v => JSON.stringify(value).includes(v));
const evidence = [];
try {
  for (const [name, change] of [
    ['production', () => { process.env.VERCEL_ENV = 'production'; }],
    ['missing env', () => { delete process.env.VERCEL_ENV; }],
    ['wrong branch', () => { process.env.VERCEL_GIT_COMMIT_REF = 'main'; }],
    ['missing branch', () => { delete process.env.VERCEL_GIT_COMMIT_REF; }],
    ['missing host', () => { delete process.env.VERCEL_URL; }],
    ['missing KV', () => { delete process.env.KV_REST_API_TOKEN; }],
    ['wrong KV domain', () => { process.env.KV_REST_API_URL = 'https://example.invalid'; }],
    ['insecure KV', () => { process.env.KV_REST_API_URL = 'http://synthetic.upstash.io'; }],
    ['credential URL', () => { process.env.KV_REST_API_URL = 'https://fake:fake@synthetic.upstash.io'; }],
    ['KV path', () => { process.env.KV_REST_API_URL += '/x'; }],
    ['KV query', () => { process.env.KV_REST_API_URL += '?x=1'; }],
    ['expired', () => { now = Date.parse('2026-09-23T18:00:00Z'); }],
  ]) {
    reset(); change(); const r = await invoke();
    t.check(`${name}:refused before any Redis request`, r.statusCode === 404 && commands.length === 0);
  }
  for (const [name, override] of [
    ['host', { headers: { host: 'wrong.vercel.app' } }],
    ['path', { url: PATH + '/x' }], ['query', { url: PATH + '?x=1' }],
    ['parsed query', { query: { command: 'GET' } }],
    ['origin', { headers: { origin: 'https://foreign.invalid' } }],
    ['missing origin', { headers: { origin: undefined } }],
    ['metadata', { headers: { 'sec-fetch-site': 'cross-site' } }],
    ['missing metadata', { headers: { 'sec-fetch-site': undefined } }],
    ['content type', { headers: { 'content-type': 'text/plain' } }],
    ['arbitrary operation', { body: { operation: 'eval' } }],
    ['arbitrary keys', { body: { operation: 'run', key: 'customer' } }],
    ['arbitrary fixture', { body: { operation: 'run', fixture: {} } }],
    ['array', { body: [] }], ['null', { body: null }], ['HEAD', { method: 'HEAD' }],
    ['GET body', { method: 'GET', body: { operation: 'run' } }],
  ]) {
    reset(); const r = await invoke('run', override);
    t.check(`${name}:refused without any Redis request`, r.statusCode >= 400 && commands.length === 0);
  }
  reset(); const page = await invoke(null, { method: 'GET', body: undefined });
  t.check('GET only reads fixed control; no run/recovery form or auto execution', commands.length === 1
    && commands[0].cmd === 'get' && commands[0].key === CONTROL && !page.body.includes('<form')
    && page.body.includes('NOT_CONSUMED') && page.body.includes('Stop here')
    && !page.body.includes('<script') && page.headers['Cache-Control'] === 'no-store'
    && page.headers['Content-Type'] === 'text/html; charset=utf-8'
    && page.headers['Content-Disposition'] === 'inline');
  reset(); now = Date.parse('2026-09-16T18:00:00Z');
  t.check('absolute run expiry blocks new action before Redis', (await invoke()).statusCode === 410 && commands.length === 0);
  for (const scenario of ['normal', 'shared-nil', 'shared-false', 'shared-throw', 'both-nil',
    'result-nil', 'mutation', 'malformed', 'roundtrip', 'order', 'transport', 'lost', 'shape', 'finish']) {
    reset(); fault = scenario; OLD.forEach(k => store.set(k, 'preserved'));
    const res = await invoke(), a = res.evidence;
    t.check(`${scenario}:only durable control remains; no fixture keys or billing writes`,
      store.keys().every(k => k === CONTROL || OLD.includes(k))
      && commands.every(c => c.cmd === 'get' ? c.key === CONTROL : c.cmd === 'eval'
        && (c.args[2] === 0 || c.args[2] === 1 && c.key === CONTROL)));
    t.check(`${scenario}:safe evidence and zero temporary-key cleanup; never billing acceptance`,
      safe(a) && a.temporaryRedisDataKeysCreated === 0 && a.cleanup.remaining === 0
      && a.cleanup.deleted === 0 && a.acceptance === 'NOT_EVALUATED');
    t.check(`${scenario}:old evidence untouched, durable one-shot guard no TTL`,
      OLD.every(k => store.get(k) === 'preserved') && await redisCommand(['TTL', CONTROL]) === -1
      && JSON.parse(store.get(CONTROL)).consumed === true);
    if (['normal', 'shared-nil', 'shared-false', 'shared-throw', 'both-nil', 'malformed', 'roundtrip', 'order'].includes(scenario)) {
      t.check(`${scenario}:opposite orders and exact single-alias content controls`,
        a.status === 'CAPTURED' && a.comparisons.length === 2
        && a.comparisons.map(p => p.name).join() === 'shared then independent,independent then shared'
        && a.comparisons.every(p => p.inputContentEquivalent && p.sharedReferences === 1 && p.independentReferences === 0
          && p.sharedSelectedIsCandidate && !p.independentSelectedIsCandidate
          && p.finalSharedReferences === 1 && p.finalIndependentReferences === 0
          && p.shared.inputUnchanged && p.independent.inputUnchanged));
      if (scenario === 'normal') t.check('native local encoder preserves both variants and decoded content',
        a.comparisons.every(p => p.shared.roundtripEquivalent && p.independent.roundtripEquivalent && p.decodedContentEquivalent));
      if (scenario.startsWith('shared-')) t.check(`${scenario}:hypothesis injected, not hidden or repaired`,
        a.comparisons.every(p => p.shared.encodeType === ({ 'shared-nil': 'nil', 'shared-false': 'other', 'shared-throw': 'throw' })[scenario]
          && p.shared.roundtripEquivalent === null && p.independent.roundtripEquivalent));
      if (scenario === 'both-nil') t.check('both failures do not imply alias explanation',
        a.comparisons.every(p => p.shared.encodeType === 'nil' && p.independent.encodeType === 'nil'));
      if (scenario === 'malformed') t.check('literal nil is still string output with decoder failure, never repaired',
        a.comparisons.every(p => p.shared.encodeType === 'string' && p.shared.encodedByteLength === 3
          && p.shared.decodeType === 'throw' && p.shared.roundtripEquivalent === null));
      if (scenario === 'roundtrip') t.check('valid JSON with missing content fails equivalence',
        a.comparisons.every(p => p.shared.decodeType === 'table' && p.shared.roundtripEquivalent === false));
      if (scenario === 'order') t.check('opposite ordering exposes call-state effect instead of alias-only explanation',
        a.comparisons[0].shared.encodeType === 'nil' && a.comparisons[0].independent.encodeType === 'string'
        && a.comparisons[1].shared.encodeType === 'string' && a.comparisons[1].independent.encodeType === 'nil');
    }
    if (scenario === 'result-nil') t.check('common result prerequisite failure is UNDETERMINED, no substitution or comparisons',
      a.status === 'UNDETERMINED' && a.setup === 'result_encoding' && a.resultEncoding.encodeType === 'nil' && !a.comparisons.length);
    if (scenario === 'mutation') t.check('native mutation invalidates comparison, not counted as hypothesis evidence',
      a.status === 'INVALID' && a.comparisons.some(p => !p.shared.inputUnchanged));
    if (['transport', 'lost', 'shape', 'finish'].includes(scenario)) t.check(`${scenario}:failure remains failure, raw errors discarded`,
      a.status === 'FAIL' && safe(a));
    const n = comparisonCalls().length;
    fault = null; const downloaded = await invoke('download'), replay = await invoke();
    if (scenario !== 'finish') t.check(`${scenario}:durable evidence replay with no new encoder experiment`,
      JSON.stringify(downloaded.evidence) === JSON.stringify(res.evidence)
      && JSON.stringify(replay.evidence) === JSON.stringify(res.evidence) && comparisonCalls().length === n);
    else t.check('lost finish cannot reopen run marker', replay.statusCode === 503 && comparisonCalls().length === n);
    const marker = JSON.parse(store.get(CONTROL)); marker.lease = 0; store.set(CONTROL, JSON.stringify(marker));
    const recovery = await invoke('recover');
    t.check(`${scenario}:recovery never erases consumed guard or runs comparison`,
      recovery.statusCode === 200 && recovery.evidence.recoveryCleanup.remaining === 0
      && comparisonCalls().length === n && JSON.parse(store.get(CONTROL)).consumed);
    evidence.push({ scenario: `LOCAL ${scenario}`, evidence: a });
  }
  reset(); const concurrent = await Promise.all([invoke(), invoke(), invoke()]);
  t.check('concurrent one-shot requests execute exactly one zero-key comparison EVAL',
    comparisonCalls().length === 1 && concurrent.some(r => r.evidence?.status === 'CAPTURED'));
  const marker = JSON.parse(store.get(CONTROL)), poisoned = JSON.parse(Buffer.from(marker.artifact, 'base64').toString());
  poisoned.secret = CANARY; poisoned.scope = CANARY;
  marker.artifact = Buffer.from(JSON.stringify(poisoned)).toString('base64'); store.set(CONTROL, JSON.stringify(marker));
  t.check('unknown stored fields never escape download', safe((await invoke('download')).body));
  poisoned.vector = [CANARY]; marker.artifact = Buffer.from(JSON.stringify(poisoned)).toString('base64');
  store.set(CONTROL, JSON.stringify(marker));
  t.check('malformed stored vector fails closed without disclosure', (await invoke('download')).statusCode === 503);
  t.check('poisoned evidence does not reopen comparison during recovery', (await invoke('recover')).statusCode === 200
    && comparisonCalls().length === 1);
  for (const file of ['api/_idBilling.js', 'api/scan.js', 'api/scan-debit-id.js', 'api/scan-refund.js', 'api/_tier.js', 'api/_verifyToken.js']) {
    t.check(`${file}:byte-identical product393b504`, readFileSync(new URL('../' + file, import.meta.url))
      .equals(execFileSync('git', ['show', `393b504:${file}`], { cwd: new URL('..', import.meta.url) })));
  }
  t.check('V6 route and evidence behavior preserved byte-identical5289043', readFileSync(new URL('../api/preview-id-billing-reproduction.js', import.meta.url))
    .equals(execFileSync('git', ['show', '5289043:api/preview-id-billing-reproduction.js'], { cwd: new URL('..', import.meta.url) })));
  const source = readFileSync(new URL('../api/preview-id-serialization-comparison.js', import.meta.url), 'utf8');
  const comparison = comparisonCalls()[0].args[1];
  const originalRoute = execFileSync('git', ['show', '0b72bd0:api/preview-id-serialization-comparison.js'],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  t.check('same v7 control, comparison Lua, fixture, one-shot logic, projection and guards remain byte-identical',
    source.split('const escapeHtml =')[0] === originalRoute.split('export default async function handler')[0]);
  t.check('comparison is in-memory only; no Redis commands, encoder config, JSON clone or global fetch patch',
    !/redis\.(call|pcall)|KEYS\[/.test(comparison) && !/encode_(?:sparse|invalid|keep|number|max)/.test(comparison)
    && source.includes('out[k]=copy(x)') && !/globalThis\.fetch\s*=/.test(source));
  // Local-only fixture-shape equivalence against unchanged actual billing.
  // This is NOT part of the deployed comparison: its EVAL still has zero keys.
  const base = JSON.parse(comparisonCalls()[0].args[3]);
  const receipt = createHash('sha256').update(base.owner).digest('hex');
  const ctx = { owner: base.owner, scan: base.scan, receipt, grant: 1, stamp: '2026_09' };
  const localKeys = [`id_billing:${receipt}`, base.free_key, `scans:${base.owner}:id_paid_left`];
  await redisCommand(['MSET', localKeys[1], '0', localKeys[2], '1']);
  await idBilling('debit', ctx);
  const rawCards = base.candidates.map(c => ({ name: c.card.name, number: c.card.number, set: c.card.set }));
  const offer = await offerIdConfirmation(ctx, rawCards);
  await idBilling('accept', { ...ctx, candidate_set: offer.candidate_set, candidate: base.selected });
  const actual = JSON.parse(await redisCommand(['GET', localKeys[0]]));
  t.check('fixed synthetic accepted shape matches actual unchanged module values except timestamps/serialized result order',
    candidateHash(JSON.parse(actual.result_json)) === candidateHash(base.result)
    && candidateHash({ ...actual, expires: base.expires, replay_expires: base.replay_expires, result_json: undefined })
      === candidateHash(base));
  await redisCommand(['DEL', ...localKeys]);
  // Retrieval-only UI: actual browser + actual handler + private Redis. Every
  // browser request is intercepted; no managed endpoint or live DNS is used.
  reset(); const seeded = (await invoke()).evidence;
  const consumedBytes = store.get(CONTROL); commands = [];
  const readable = await invoke(null, { method: 'GET', body: undefined });
  t.check('consumed GET renders exact sanitized saved JSON with no server action forms',
    JSON.stringify(readable.evidence) === JSON.stringify(seeded) && readable.body.includes('CONSUMED_SAVED')
    && readable.body.includes('copy-results') && readable.body.includes('download-results')
    && !readable.body.includes('<form') && readable.headers['Content-Disposition'] === 'inline'
    && store.get(CONTROL) === consumedBytes && comparisonCalls().length === 0
    && commands.every(c => c.cmd === 'get' && c.key === CONTROL));
  const unfinished = JSON.parse(consumedBytes); unfinished.artifact = '';
  store.set(CONTROL, JSON.stringify(unfinished)); const unfinishedBytes = store.get(CONTROL);
  const noResults = await invoke(null, { method: 'GET', body: undefined });
  t.check('consumed without results reports STOP and never offers run, recovery or empty download',
    noResults.body.includes('CONSUMED_NO_RESULTS') && noResults.body.includes('Stop here')
    && !noResults.body.includes('<button') && !noResults.body.includes('<form')
    && store.get(CONTROL) === unfinishedBytes && comparisonCalls().length === 0);
  store.set(CONTROL, consumedBytes);
  fault = 'control-read';
  const readFailure = await invoke(null, { method: 'GET', body: undefined });
  t.check('unavailable saved-state read remains UNKNOWN with no run/copy/download/cleanup action',
    readFailure.statusCode === 503 && readFailure.body.includes('UNAVAILABLE')
    && !readFailure.body.includes('<button') && !readFailure.body.includes('<form')
    && !readFailure.body.includes(CANARY) && store.get(CONTROL) === consumedBytes);
  fault = null;
  const malicious = JSON.parse(consumedBytes), polluted = JSON.parse(Buffer.from(malicious.artifact, 'base64').toString());
  polluted.scope = '</pre><script>window.INJECTED=true</script>';
  malicious.artifact = Buffer.from(JSON.stringify(polluted)).toString('base64'); store.set(CONTROL, JSON.stringify(malicious));
  const safePage = await invoke(null, { method: 'GET', body: undefined });
  t.check('HTML uses sanitized projection, never stored metadata or injected markup',
    !safePage.body.includes('window.INJECTED') && safePage.headers['Content-Security-Policy'].includes("script-src 'nonce-")
    && !safePage.headers['Content-Security-Policy'].includes("'unsafe-inline'"));
  store.set(CONTROL, consumedBytes);
  const { chromium, devices } = (await import('/home/user/node_modules/playwright/index.js')).default;
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `https://${HOST}` });
    const requests = [];
    await ctx.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      requests.push({ method: request.method(), path: url.pathname });
      if (url.origin !== `https://${HOST}` || url.pathname !== PATH) return route.abort();
      const response = await invoke(null, { method: request.method(), url: url.pathname,
        body: undefined, headers: request.headers() });
      await route.fulfill({ status: response.statusCode, headers: response.headers, body: response.body });
    });
    const browserPage = await ctx.newPage();
    const response = await browserPage.goto(`https://${HOST}${PATH}`);
    const displayed = await browserPage.locator('#evidence').textContent();
    t.check('mobile Chromium GET200 renders nonempty HTML inline without required download',
      response.status() === 200 && response.headers()['content-type'].startsWith('text/html')
      && response.headers()['content-disposition'] === 'inline'
      && JSON.stringify(JSON.parse(displayed)) === JSON.stringify(seeded));
    await browserPage.getByRole('button', { name: 'Copy results', exact: true }).click();
    const copied = await browserPage.evaluate(() => navigator.clipboard.readText());
    t.check('Copy uses displayed JSON locally with no POST or comparison', copied === displayed
      && comparisonCalls().length === 0 && requests.every(r => r.method === 'GET'));
    const downloadPromise = browserPage.waitForEvent('download');
    await browserPage.getByRole('button', { name: 'Optional: download displayed .json', exact: true }).click();
    const download = await downloadPromise;
    const downloadedPath = '/home/user/workspace/preview_v7_html_local_download_20260916.json';
    await download.saveAs(downloadedPath);
    t.check('optional local Blob download is nonzero complete JSON, never server POST',
      download.suggestedFilename() === 'cardresell-synthetic-encoder-comparison.json'
      && readFileSync(downloadedPath, 'utf8') === displayed && requests.every(r => r.method === 'GET')
      && comparisonCalls().length === 0 && store.get(CONTROL) === consumedBytes);
    await browserPage.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async () => { throw new Error('local denied'); } },
    }));
    await browserPage.getByRole('button', { name: 'Copy results', exact: true }).click();
    t.check('clipboard denial selects readable JSON and offers manual copy without network',
      (await browserPage.locator('#copy-status').textContent()).includes('manually')
      && await browserPage.evaluate(() => window.getSelection().toString()) === displayed
      && store.get(CONTROL) === consumedBytes);
    t.check('mobile results do not overflow viewport',
      await browserPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await browserPage.screenshot({ path: '/home/user/workspace/preview_v7_html_mobile_chromium_20260916.png', fullPage: true });
    await ctx.close();
  } finally { await browser.close(); }
  t.check('all retrieval actions preserve exact control bytes and only issue fixed GET reads',
    store.get(CONTROL) === consumedBytes && comparisonCalls().length === 0
    && commands.every(c => c.cmd === 'get' && c.key === CONTROL));
  process.env.VERCEL_GIT_COMMIT_REF = 'wrong';
  const count = commands.length, unavailable = await invoke(null, { method: 'GET', body: undefined });
  t.check('guard failures retain404 but now explicit nonempty HTML with no environment leak or Redis access',
    unavailable.statusCode === 404 && unavailable.headers['Content-Type'].startsWith('text/html')
    && unavailable.headers['Content-Disposition'] === 'inline' && unavailable.body.length > 0
    && unavailable.body.includes('UNAVAILABLE') && !unavailable.body.includes('wrong') && commands.length === count);
  writeFileSync('/home/user/workspace/preview_v7_html_retrieval_offline_evidence_20260916.json',
    JSON.stringify({ sourceSha256: createHash('sha256').update(source).digest('hex'),
      scope: 'LOCAL ONLY: native local Redis and injected hypotheses; no managed encoder result claimed', evidence }, null, 2));
} finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
t.done();
