// Offline only: exact Stage2 policy/handlers + real Firebase signature verifier
// with synthetic RSA/JWKS, and all Lua executed in private local Redis.
import { generateKeyPairSync, sign, webcrypto, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { harness } from './_assert.mjs';
import { redisStore, redisRest } from './_idRedis.mjs';
import * as stage from '../api/_previewIdStage2.js';
import route from '../api/preview-id-authenticated-acceptance.js';
import debit from '../api/scan-debit-id.js';
import { idBilling, idEntitlement } from '../api/_idBilling.js';
import { verifyTokenFlexible } from '../api/_verifyToken.js';
import { getUserTier } from '../api/_tier.js';
import { stage2PageCheck } from './_stage2PageCheck.mjs';
const { check, done } = harness('preview-id-authenticated-acceptance');
globalThis.crypto ||= webcrypto;
process.env.VERCEL_ENV = 'preview';
process.env.VERCEL_GIT_COMMIT_REF = stage.STAGE2_BRANCH;
process.env.VERCEL_URL = 'stage2-offline.vercel.app';
process.env.KV_REST_API_URL = 'https://stage2-offline.upstash.io';
process.env.KV_REST_API_TOKEN = 'synthetic-not-credential';
process.env.STRIPE_SECRET_KEY = 'synthetic-must-never-be-used';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'stage2-offline' };
const UID = 'stage2-offline-dedicated';
const EMAIL = 'stage2@example.test';
function token(uid = UID) {
  const enc = x => Buffer.from(JSON.stringify(x)).toString('base64url'), now = Math.floor(Date.now() / 1000);
  const data = enc({ alg: 'RS256', kid: jwk.kid }) + '.' + enc({ sub: uid, email: EMAIL,
    email_verified: true, firebase: { sign_in_provider: 'password' }, aud: 'cardresell-e0329', iss: 'https://securetoken.google.com/cardresell-e0329',
    iat: now, exp: now + 3600 });
  return data + '.' + sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url');
}
const auth = token();
let store = redisStore(), commands = [], blocked = [], faults = {};
let beforeCleanup = null, redirectFault = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(String(input?.url || input));
  if (u.origin === process.env.KV_REST_API_URL) {
    if (redirectFault) {
      check('Stage2 transport refuses redirects without forwarding credentials', init.redirect === 'error');
      throw new TypeError('synthetic redirect rejected');
    }
    const args = init.body ? JSON.parse(init.body) : [];
    if (args[0] === 'EVAL' && args[1] === stage.STAGE2_CLEANUP && beforeCleanup) {
      const hook = beforeCleanup; beforeCleanup = null; await hook();
    }
    return redisRest(input, init, commands, faults);
  }
  if (u.href === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
    return Response.json({ keys: [jwk] });
  blocked.push(u.hostname); throw new Error('offline-network-denied');
};
async function invoke(handler = route, body = { action: 'status' }, extra = {}) {
  // Baseline valid-account calls carry the same browser identity as the signed
  // fixture. Missing/mismatched identity bypasses have their own strict-auth suite.
  if (handler === route && body?.action === 'bind' && body.identity === undefined)
    body = { ...body, identity: { uid: UID, email: EMAIL, providers: ['password'] } };
  const req = { method: 'POST', url: stage.STAGE2_PATH, query: {}, body,
    headers: { host: process.env.VERCEL_URL, origin: `https://${process.env.VERCEL_URL}`,
      authorization: 'Bearer ' + auth, 'sec-fetch-site': 'same-origin' }, ...extra };
  const res = { statusCode: 200, headers: {}, payload: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; },
    json(d) { this.payload = d; return this; }, send(d) { this.payload = d; return this; },
    end() { return this; } };
  await handler(req, res); return res;
}
const fail = async fn => { try { await fn(); return false; } catch (_) { return true; } };
const requestFor = s => ({ confirmation_id: s.confirmation.confirmation_id,
  candidate_set: s.confirmation.candidate_set, scan_id: s.confirmation.scan_id,
  candidate: stage.stage2Candidates()[6], mode: 'identify' });
async function accept(s) {
  return invoke(debit, requestFor(s), { url: '/api/scan-debit-id' });
}
const clean = () => { store = redisStore(); commands = []; faults = {}; };
const active = () => { process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_GIT_COMMIT_REF = stage.STAGE2_BRANCH; };
try {
  const baseline = execFileSync('git', ['show', 'facc465:api/_idBilling.js'], { encoding: 'utf8' });
  const current = readFileSync(new URL('../api/_idBilling.js', import.meta.url), 'utf8');
  const script = text => text.match(/export const ID_BILLING_SCRIPT = `([\s\S]*?)`;/)[1];
  check('production billing Lua remains byte-identical to accepted facc465', script(baseline) === script(current));
  console.log('Unchanged billing Lua SHA256:', createHash('sha256').update(script(current)).digest('hex'));
  for (const env of ['production', 'development']) {
    process.env.VERCEL_ENV = env;
    process.env.VERCEL_GIT_COMMIT_REF = env === 'production' ? stage.STAGE2_BRANCH : 'other';
    check(`${env}: policy is disabled outside designated Preview`, stage.stage2Scoped() === false);
    check(`${env}: ordinary tier resolution is unchanged`, await getUserTier(null, null, null, UID, EMAIL) === 'free');
  }
  process.env.VERCEL_ENV = 'production';
  process.env.VERCEL_GIT_COMMIT_REF = stage.STAGE2_BRANCH;
  check('Production normal verifier and UID mapping behavior remain unchanged', (await verifyTokenFlexible(auth)).uid === UID);
  await new Promise(r => setImmediate(r));
  check('Production path still writes its existing auth mapping', store.get(`uid_by_email:${EMAIL}`) === UID);
  clean();
  process.env.VERCEL_ENV = 'development';
  check('feature branch outside Preview does not enable test entitlement', !stage.stage2Scoped());
  process.env.VERCEL_ENV = 'preview';
  process.env.VERCEL_GIT_COMMIT_REF = 'unrelated-branch';
  check('known unrelated Preview branch retains ordinary tier path', !stage.stage2Scoped()
    && await getUserTier(null, null, null, UID, EMAIL) === 'free');
  delete process.env.VERCEL_GIT_COMMIT_REF;
  check('missing Preview branch metadata fails closed rather than exposing Stripe fallback', stage.stage2Scoped()
    && await fail(() => getUserTier('synthetic', null, null, UID, EMAIL)));
  active();
  const validURL = process.env.KV_REST_API_URL;
  for (const url of ['', 'https://arbitrary.invalid', 'https://upstash.io.evil.test',
    'https://user:secret@offline.upstash.io', 'https://offline.upstash.io:444', 'https://offline.upstash.io:443',
    'https://offline.upstash.io/path', 'https://offline.upstash.io/?query=secret',
    'https://offline.upstash.io/#secret', 'http://offline.upstash.io']) {
    process.env.KV_REST_API_URL = url;
    const count = commands.length;
    const denied = await invoke(route, { action: 'bind', attest: true });
    check('invalid KV configuration denied before auth/transport without disclosure',
      denied.payload.error === 'configuration' && commands.length === count
      && !JSON.stringify(denied.payload).includes('secret'));
    check('direct transport also rejects invalid configuration', await fail(() => stage.stage2KV('GET', 'fixed')));
  }
  process.env.KV_REST_API_URL = validURL;
  const validToken = process.env.KV_REST_API_TOKEN;
  delete process.env.KV_REST_API_TOKEN;
  check('missing KV token denied without transport', (await invoke(route, null, { method: 'GET' })).statusCode === 404);
  process.env.KV_REST_API_TOKEN = validToken;
  redirectFault = true;
  check('redirect transport fails closed with sanitized error', await fail(() => stage.stage2KV('GET', 'fixed')));
  redirectFault = false;
  const html = await invoke(route, null, { method: 'GET' });
  check('protected GET renders normal-signin instructions and real-app frame', html.statusCode === 200
    && html.payload.includes('/signin?next=') && html.payload.includes('_fbAuth?.currentUser')
    && html.payload.includes('getIdToken()'));
  check('GET never claims/reads Redis or seeds entitlements', commands.length === 0);
  check('page contains no fake identity/token assignment', !/googleUser\s*=|_googleIdToken\s*=/.test(html.payload));
  check('page does not perform loss simulation or replace picker', !/route\.abort|lost-after-commit|_pickScanCandidate\s*=/.test(html.payload));
  for (const [name, patch] of [
    ['foreign host', { headers: { host: 'foreign.vercel.app' } }],
    ['raw query', { url: stage.STAGE2_PATH + '?x=1' }],
    ['query object', { query: { x: '1' } }],
    ['wrong path', { url: '/api/arbitrary' }],
    ['wrong origin', { headers: { host: process.env.VERCEL_URL, origin: 'https://foreign.invalid' } }],
  ]) check(`${name} rejected before KV`, (await invoke(route, { action: 'bind', attest: true }, patch)).statusCode !== 200 && commands.length === 0);
  for (const body of [{ action: 'bind' }, { action: 'bind', attest: true, uid: UID },
    { action: 'status', key: 'arbitrary' }, { action: 'eval' }, ['status']])
    check('arbitrary/unauthorized input rejected before KV', (await invoke(route, body)).payload.error === 'input_guard' && commands.length === 0);
  check('pre-setup tier always fails closed without Stripe', await fail(() => getUserTier('synthetic', process.env.KV_REST_API_URL, 'synthetic', UID, EMAIL)));
  check('normal unrelated API auth refused before mapping write', await fail(() => verifyTokenFlexible(auth)));
  check('pre-setup confirmation auth fails closed', await fail(() => verifyTokenFlexible(auth, 'id-confirmation')));
  for (const file of ['scan', 'scan-credits', 'stripe-annual-checkout', 'stripe-grade-checkout',
    'stripe-id-checkout', 'stripe-subscription-checkout', 'stripe-checkout', 'stripe-portal',
    'verify-claim-firebase', 'verify-confirm', 'stripe-webhook']) {
    const handler = (await import(`../api/${file}.js`)).default;
    const before = commands.length;
    check(`${file}: guarded before authentication/provider/KV side effects`,
      (await invoke(handler)).statusCode === 503 && commands.length === before);
  }
  const pro = (await import('../api/pro-status.js')).default;
  check('pro-status missing state cannot reach Stripe', (await invoke(pro, null,
    { method: 'GET', url: '/api/pro-status' })).statusCode === 503);
  check('all guarded paths made zero external calls', blocked.length === 0);
  clean();
  store.set(`uid_by_email:${EMAIL}`, 'preexisting');
  const prior = store.get(`uid_by_email:${EMAIL}`);
  check('setup refuses existing auth side effect instead of overwriting', (await invoke(route,
    { action: 'bind', attest: true })).payload.error === 'account_not_empty');
  check('refused mapping baseline unchanged', store.get(`uid_by_email:${EMAIL}`) === prior
    && store.get(stage.STAGE2_CONTROL) === null);
  clean();
  const bindings = await Promise.all([invoke(route, { action: 'bind', attest: true }),
    invoke(route, { action: 'bind', attest: true })]);
  check('concurrent normal-verified binding consumes one durable control', bindings.filter(r => r.statusCode === 200).length === 1);
  let s = await stage.stage2State();
  check('binding registers every receipt before any fixture balance', s.fixtures.length === 4
    && stage.stage2Keys(s).every(k => store.get(k) === null));
  check('normal verification did not write UID mapping or email grant', store.get(`uid_by_email:${EMAIL}`) === null
    && store.get(`email_verified:${UID}`) === null);
  check('wrong normal signed owner denied setup state', (await invoke(route, { action: 'status' },
    { headers: { host: process.env.VERCEL_URL, origin: `https://${process.env.VERCEL_URL}`,
      authorization: 'Bearer ' + token('another-dedicated') } })).payload.error === 'owner_guard');
  check('first fixed phase prepared', (await invoke(route, { action: 'next' })).statusCode === 200);
  s = await stage.stage2State();
  const cancelContext = { ...s.fixtures[0], owner: UID, grant: 5, stamp: s.stamp };
  check('real explicit test entitlement bypasses subscription and verification reads',
    (await idEntitlement({ uid: UID, email: EMAIL })).grant === 5
    && !commands.some(c => c.cmd === 'get' && /^pro:/.test(c.key)));
  check('first offer restored free-first balance', (await stage.stage2Observation(s)).free === 1);
  check('advance from cancel is bounded and atomic', (await invoke(route, { action: 'next' })).statusCode === 200);
  check('late accepted cancel cannot debit next phase balance', !(await idBilling('accept', {
    ...cancelContext, candidate: 'wrong', candidate_set: 'wrong' })).ok);
  s = await stage.stage2State();
  let r = await accept(s);
  check('normal real handler accepts seventh synthetic identity', r.statusCode === 200 && r.payload.pickedCard.set_name === 'Synthetic Set 7');
  const duplicates = await Promise.all(Array.from({ length: 6 }, () => accept(s)));
  check('six managed-shaped normal-auth handler duplicates have one accepted journal/debit', duplicates.every(x => x.statusCode === 200)
    && (await stage.stage2Observation(s)).free === 0 && (await stage.stage2Observation(s)).paid === 1);
  check('unrelated ordinary auth remains blocked after setup', await fail(() => verifyTokenFlexible(auth)));
  check('third phase prepared without reusing earlier receipt', (await invoke(route, { action: 'next' })).statusCode === 200);
  s = await stage.stage2State(); await accept(s);
  check('fixed fourth phase prepared', (await invoke(route, { action: 'next' })).statusCode === 200);
  s = await stage.stage2State();
  check('final fixture can be depleted only while pending', (await invoke(route, { action: 'deplete' })).statusCode === 200);
  check('real handler rejects depleted explicit entitlement with 402', (await accept(s)).statusCode === 402);
  check('no fifth/refill phase exists', (await invoke(route, { action: 'next' })).statusCode !== 200);
  const raw = store.get(stage.STAGE2_CONTROL);
  for (const change of [
    { ...s, confirmation: { ...s.confirmation, confirmation_id: '0'.repeat(64) } },
    { ...s, observations: [{ secret: 'must-not-be-projected' }] },
    { ...s, extra: 'must-not-be-projected' },
  ]) {
    store.set(stage.STAGE2_CONTROL, JSON.stringify(change));
    const invalid = await invoke(route, { action: 'status' });
    check('corrupt confirmation/state projection fails closed with fixed code', invalid.payload.error === 'invalid_state'
      && !JSON.stringify(invalid.payload).includes('must-not-be-projected'));
  }
  store.set(stage.STAGE2_CONTROL, 'nil');
  check('corrupt state fails closed, never Stripe', (await invoke(pro, null,
    { method: 'GET', url: '/api/pro-status' })).statusCode === 503);
  store.set(stage.STAGE2_CONTROL, raw);
  const now = Date.now; Date.now = () => stage.STAGE2_END + 1000;
  check('expired fixture denies real handler', (await accept(s)).statusCode === 503);
  check('expiry never switches policy off', stage.stage2Scoped() && await fail(() => getUserTier('synthetic', null, null, UID, EMAIL)));
  Date.now = now;
  const cleanup = await invoke(route, { action: 'cleanup' });
  check('cleanup removes financial keys and retains terminal guards/control', cleanup.statusCode === 200
    && cleanup.payload.cleanup.financialKeysRemaining === 0
    && s.fixtures.every(f => JSON.parse(store.get(`id_billing:${f.receipt}`)).state === 'cancelled'));
  const closed = store.get(stage.STAGE2_CONTROL);
  check('cleanup is idempotent and does not reopen control', (await invoke(route, { action: 'cleanup' })).statusCode === 200
    && store.get(stage.STAGE2_CONTROL) === closed);
  check('late debit cannot resurrect cleared credits', !(await idBilling('debit', cancelContext)).ok
    && stage.stage2Keys(s).every(k => store.get(k) === null));
  check('consumed account cannot bind/reset even after cleanup', (await invoke(route, { action: 'bind', attest: true })).payload.error === 'already_consumed');
  check('all test executions had zero Stripe/provider calls', blocked.length === 0);
  check('no referral, auth mapping, stats or success scan writes occurred', !commands.some(c =>
    !['get', 'mget', 'exists'].includes(c.cmd) && /^(ref:|uid_by_email:|stats:|scan:)/.test(c.key)));
  for (const fault of ['before', 'after']) {
    clean();
    await invoke(route, { action: 'bind', attest: true });
    faults = { [fault]: true, action: 'debit' };
    const failed = await invoke(route, { action: 'next' });
    faults = {};
    const failedState = await stage.stage2State();
    check(`${fault} debit failure runs ordinary cleanup and closes the consumed run`,
      failed.payload.error === 'phase_failed_read_status_or_cleanup' && failedState.state === 'closed'
      && stage.stage2Keys(failedState).every(k => store.get(k) === null));
    check(`${fault} failure recovery remains idempotent and retains delayed-write fences`,
      (await invoke(route, { action: 'cleanup' })).statusCode === 200
      && failedState.fixtures.every(f => JSON.parse(store.get(`id_billing:${f.receipt}`)).state === 'cancelled'));
  }
  clean();
  await invoke(route, { action: 'bind', attest: true });
  const before = await stage.stage2State();
  const preparing = { ...before, phase: 0, step: 'preparing', observations: [] };
  await stage.stage2KV('EVAL', stage.STAGE2_BEGIN, 4, stage.STAGE2_CONTROL, ...stage.stage2Keys(before),
    `id_billing:${before.fixtures[0].receipt}`, JSON.stringify(before), JSON.stringify(preparing), '', '', '', '');
  check('interrupted preparation cannot be replayed to replenish credits', (await invoke(route,
    { action: 'next' })).payload.error === 'phase_guard');
  check('fixed recovery cleans interrupted pre-journal preparation from durable manifest',
    (await invoke(route, { action: 'cleanup' })).payload.cleanup.financialKeysRemaining === 0);
  clean();
  await invoke(route, { action: 'bind', attest: true });
  await invoke(route, { action: 'next' });
  s = await stage.stage2State();
  const controlBeforeRace = store.get(stage.STAGE2_CONTROL);
  let acceptedBytes;
  beforeCleanup = async () => {
    check('scheduled accept commits after cleanup snapshot before EVAL', (await accept(s)).statusCode === 200);
    acceptedBytes = store.get(`id_billing:${s.fixtures[0].receipt}`);
  };
  check('cleanup aborts exact acceptance interleave rather than destroying evidence',
    (await invoke(route, { action: 'cleanup' })).payload.error === 'state_conflict'
    && store.get(stage.STAGE2_CONTROL) === controlBeforeRace
    && store.get(`id_billing:${s.fixtures[0].receipt}`) === acceptedBytes
    && (await stage.stage2Observation(s)).free === 0);
  const refreshedCleanup = await invoke(route, { action: 'cleanup' });
  check('refreshed cleanup preserves actual committed acceptance and balance observation',
    refreshedCleanup.payload.observation.acceptedJournals === 1
    && refreshedCleanup.payload.observation.free === 0
    && refreshedCleanup.payload.cleanup.financialKeysRemaining === 0);
  for (const kind of ['missing_counter', 'missing_journal', 'scan_record']) {
    clean();
    await invoke(route, { action: 'bind', attest: true });
    s = await stage.stage2State();
    const key = kind === 'missing_counter' ? stage.stage2Keys(s)[0]
      : kind === 'missing_journal' ? `id_billing:${s.fixtures[3].receipt}` : `scan:${s.fixtures[3].scan}`;
    beforeCleanup = async () => store.set(key, 'synthetic-arrived-after-snapshot');
    check(`${kind}: null snapshot transition rejects cleanup without overwriting new bytes`,
      (await invoke(route, { action: 'cleanup' })).payload.error === 'state_conflict'
      && store.get(key) === 'synthetic-arrived-after-snapshot'
      && (await stage.stage2State()).state === 'active');
  }
  clean();
  await stage2PageCheck({ invoke, token: auth, uid: UID, email: EMAIL, check });
} finally { globalThis.fetch = originalFetch; }
done();
