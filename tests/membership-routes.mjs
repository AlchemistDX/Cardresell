// Real normal route handlers and both billing scripts on private local Redis.
// Auth/vision are explicit existing local stubs, not managed/authentication proof.
import { harness } from './_assert.mjs';
import { billingHarness, ambiguous, exact, UID } from './_scanBillingHarness.mjs';
import { redisCommand as redis, redisRest } from './_idRedis.mjs';
import { membershipEnrollmentKey, membershipReceiptKey, createMembershipConsumption } from '../api/_membershipConsumption.js';
import { MEMBERSHIP_LEGACY_FENCE, legacyCreditFetch } from '../api/_membershipLegacyFence.js';
import { grantMembership, membershipWelcomeKeys } from '../api/_membershipLedger.js';
const t = harness('membership-routes');
const credits = (await import('../api/scan-credits.js')).default;
const status = (await import('../api/pro-status.js')).default;
const confirm = (await import('../api/verify-confirm.js')).default;
const referral = (await import('../api/referral.js')).default;
const admin = (await import('../api/admin.js')).default;
const scanHandler = (await import('../api/scan.js')).default;
const consume = createMembershipConsumption({ execute: redis });
const ctx = (mode = 'identify') => ({ owner: UID, receipt: '0'.repeat(64), scan: 'readonly', mode });
const balance = mode => consume('snapshot', ctx(mode));
async function seed() {
  await redis(['SET', MEMBERSHIP_LEGACY_FENCE, '1']);
  await redis(['SET', membershipEnrollmentKey(UID), JSON.stringify({
    version: 'launch-v2', owner: UID, plan: 'free', verified: true, freeThrough: 0,
    capabilities: { bulkGrade: false },
  })]);
  process.env.MEMBERSHIP_BILLING_V2 = 'on';
}
const state = async () => {
  const keys = (await redis(['KEYS', '*'])).sort();
  return JSON.stringify(await Promise.all(keys.map(async key => [key, await redis(['GET', key])])));
};
async function call(handler, method = 'POST', body = {}, extra = {}) {
  const res = { statusCode: 200, payload: null, setHeader() {}, status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }, end() { return this; } };
  await handler({ method, headers: { authorization: 'Bearer ' + 'x'.repeat(40) }, body, query: {}, ...extra }, res);
  await new Promise(resolve => setImmediate(resolve));
  return res;
}
function finish(h) { delete process.env.MEMBERSHIP_BILLING_V2; delete process.env.OPENAI_API_KEY; h.restore(); }

await t.section('normal picker cancel, accepted selection, concurrent duplicate', async () => {
  const h = billingHarness({ balance: 4 });
  try {
    await seed();
    const offered = await h.scan(ambiguous());
    t.check('normal /scan returns pending confirmation', offered.statusCode === 200 && offered.payload.needsPicker && offered.payload.confirmation_id);
    t.check('cancel makes no accept request and costs zero', (await balance()).monthly === 5 && h.selections.length === 0
      && await redis(['GET', 'stats:searches:total']) === null);
    const body = h.body(offered.payload.candidates[6]);
    const replies = await Promise.all(Array.from({ length: 6 }, () => h.pick(body)));
    t.check('six normal accept handler replies all identical', replies.every(r => r.statusCode === 200
      && JSON.stringify(r.payload) === JSON.stringify(replies[0].payload)));
    t.check('seventh selected identity preserved', replies[0].payload.pickedCard.set_name === 'set6');
    t.check('one monthly debit; purchased unchanged', (await balance()).monthly === 4 && h.store.get(`scans:${UID}:id_paid_left`) === '4');
    t.check('one accepted journal and no successful scan log/stat for ambiguity', (await redis(['KEYS', 'membership:launch-v2:consumption:*'])).length === 1
      && (await redis(['KEYS', 'scan:*'])).length === 0 && await redis(['GET', 'stats:searches:total']) === null);
    t.check('no old financial journal', (await redis(['KEYS', 'id_billing:*'])).length === 0);
    t.check('no live outbound service', h.outbound.length === 0);
  } finally { finish(h); }
});

await t.section('normal rejected selection cannot return or persist accepted identity', async () => {
  const h = billingHarness({ balance: 0 });
  try {
    await seed();
    const offered = await h.scan();
    const body = h.body(offered.payload.candidates[4]);
    for (let i = 0; i < 5; i++) await h.scan(exact());
    const result = await h.pick(body);
    t.check('selection denied 402 after credits spent elsewhere', result.statusCode === 402 && !result.payload.pickedCard && !result.payload.success);
    t.check('receipt remains pending', JSON.parse(h.store.get(membershipReceiptKey(body.confirmation_id))).state === 'pending');
    t.check('only five confident scans counted and published', await redis(['GET', 'stats:searches:total']) === '5'
      && (await redis(['KEYS', 'scan:*'])).length === 5);
  } finally { finish(h); }
});

await t.section('normal confident scan publishes authority; manual refund is journal-bound', async () => {
  const h = billingHarness({ balance: 0 });
  try {
    await seed();
    const first = await h.scan(exact());
    const record = JSON.parse(h.store.get(`scan:${first.payload.scan_id}`));
    t.check('successful scan record persists explicit ID mode and receipt', record.mode === 'identify'
      && record.billing_version === 'launch-v2' && record.membership_receipt);
    const refund = await h.refund(first.payload.scan_id), again = await h.refund(first.payload.scan_id);
    t.check('normal manual refund exact replay restores one', refund.statusCode === 200 && refund.payload.credits_refunded === 1
      && JSON.stringify(refund.payload) === JSON.stringify(again.payload) && (await balance()).monthly === 5);
    t.check('refund never falls into old monthly or paid writes', !h.commands.some(c => c.cmd === 'set' && String(c.key).includes('id_free_used_')));
  } finally { finish(h); }
});

await t.section('normal retries bound to explicit kind and amount, one original claim', async () => {
  const h = billingHarness({ balance: 0 });
  try {
    await seed();
    const first = await h.scan(exact());
    const retry = await h.scan(ambiguous(), { retry_of: first.payload.scan_id });
    const accepted = await h.pick(h.body(retry.payload.candidates[3]));
    t.check('earned retry picker is zero cost', accepted.statusCode === 200 && accepted.payload.charged === 0 && (await balance()).monthly === 4);
    const refund = await h.refund(first.payload.scan_id);
    t.check('original cannot be refunded after retry consumed', refund.statusCode === 409 && (await balance()).monthly === 4);
    const next = await h.scan(exact(), { retry_of: first.payload.scan_id });
    t.check('second retry request charged normally', next.statusCode === 200 && (await balance()).monthly === 3);
    // Missing grade provider triggers exact Grade refund; ID receipt must never
    // earn free Grade (check that a Grade journal was actually debited/refunded).
    await h.scan(exact(), { mode: 'grade', backBase64: 'back', retry_of: first.payload.scan_id });
    const journals = await Promise.all((await redis(['KEYS', 'membership:launch-v2:consumption:*'])).map(async k => JSON.parse(await redis(['GET', k]))));
    t.check('ID retry cannot bypass Grade billing', journals.some(j => j.mode === 'grade' && j.state === 'refunded' && j.cost === 1));
  } finally { finish(h); }
});

await t.section('normal Grade and deep Grade use versioned debit, publication and exact compensation', async () => {
  const h = billingHarness({ balance: 0 });
  try {
    await seed();
    const noProvider = await h.scan(exact(), { mode: 'grade', backBase64: 'back' });
    t.check('missing Grade provider refunds exact receipt', noProvider.statusCode === 503 && (await balance('grade')).monthly === 1);
    process.env.OPENAI_API_KEY = 'local-placeholder-not-a-credential';
    const localFetch = globalThis.fetch;
    let providerCalls = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith('https://api.openai.com/')) {
        providerCalls++;
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          card_name: 'Synthetic Grade', centering: '55/45 L/R, 50/50 T/B', corners: 'Near Mint', edges: 'Mint',
          surface: 'Mint', psa_estimate: 9, grade_label: 'Mint', grade_notes: 'Synthetic', worth_grading: true,
          subgrades: { centering: 9, corners: 8.5, edges: 9.5, surface: 9.5 }, confidence: 'high',
        }) } }] });
      }
      return localFetch(input, init);
    };
    const quick = await h.scan(exact(), { mode: 'grade', backBase64: 'back' });
    t.check('normal Grade successful and one monthly credit charged', quick.statusCode === 200 && quick.payload.mode === 'grade'
      && quick.payload.creditsUsed === 1 && (await balance('grade')).monthly === 0);
    const gradeRecord = JSON.parse(await redis(['GET', `scan:${quick.payload.analysis_id}`]));
    t.check('Grade authority published with explicit mode', gradeRecord.mode === 'grade' && gradeRecord.consumed_amount === 1);
    await redis(['SET', `scans:${UID}:paid_left`, '2']);
    const photos = { imageBase64: 'A'.repeat(9000), backBase64: 'B'.repeat(9000), topEdgeBase64: 'C'.repeat(9000), bottomEdgeBase64: 'D'.repeat(9000) };
    const deep = await h.scan(exact(), { mode: 'grade', deepGrade: true, ...photos });
    t.check('normal deep Grade costs two purchased without monthly rollover', deep.statusCode === 200 && deep.payload.creditsUsed === 2
      && await redis(['GET', `scans:${UID}:paid_left`]) === '0');
    const callsBefore = providerCalls;
    const denied = await h.scan(exact(), { mode: 'grade', deepGrade: true, ...photos });
    t.check('insufficient deep Grade stops before paid provider', denied.statusCode === 402 && callsBefore === providerCalls);
    const bulk = await h.scan(exact(), { mode: 'grade', bulkGrade: true, backBase64: 'back', retry_of: quick.payload.analysis_id });
    t.check('bulk entitlement checked before free retry', bulk.statusCode === 403 && providerCalls === callsBefore);
    const enrollmentKey = membershipEnrollmentKey(UID);
    const enrollment = JSON.parse(await redis(['GET', enrollmentKey]));
    const quickJournal = await redis(['GET', membershipReceiptKey(gradeRecord.membership_receipt)]);
    delete enrollment.capabilities;
    await redis(['SET', enrollmentKey, JSON.stringify(enrollment)]);
    const missing = await h.scan(exact(), { mode: 'grade', bulkGrade: true, backBase64: 'back',
      retry_of: quick.payload.analysis_id, capabilities: { bulkGrade: true } });
    t.check('missing trusted capability unavailable despite client assertion', missing.statusCode === 503
      && missing.payload.code === 'membership_capability_unavailable' && providerCalls === callsBefore);
    t.check('denied and unavailable Bulk never consume earned retry', await redis(['GET',
      membershipReceiptKey(gradeRecord.membership_receipt)]) === quickJournal);
    enrollment.capabilities = { bulkGrade: 'true' };
    await redis(['SET', enrollmentKey, JSON.stringify(enrollment)]);
    const malformed = await h.scan(exact(), { mode: 'grade', bulkGrade: true, backBase64: 'back' });
    t.check('malformed trusted capability unavailable before provider', malformed.statusCode === 503
      && malformed.payload.code === 'membership_capability_unavailable' && providerCalls === callsBefore);
    enrollment.capabilities = { bulkGrade: true };
    await redis(['SET', enrollmentKey, JSON.stringify(enrollment)]);
    const exposed = await call(credits, 'GET');
    t.check('normal authenticated balances expose trusted capability, not tier inference',
      exposed.payload.capabilities.bulkGrade === true && exposed.payload.tier === 'free');
    const beforeRetryBalance = JSON.stringify(await balance('grade'));
    const quickRetry = await h.scan(exact(), { mode: 'grade', bulkGrade: true, backBase64: 'back',
      retry_of: quick.payload.analysis_id });
    t.check('explicit capability allows Bulk earned Quick retry with actual zero credits',
      quickRetry.statusCode === 200 && quickRetry.payload.creditsUsed === 0 && providerCalls > callsBefore);
    const deepRetry = await h.scan(exact(), { mode: 'grade', deepGrade: true, ...photos,
      retry_of: deep.payload.analysis_id });
    t.check('earned Deep retry reports actual zero rather than nominal two',
      deepRetry.statusCode === 200 && deepRetry.payload.creditsUsed === 0);
    t.check('Quick and Deep earned retry balances unchanged',
      JSON.stringify(await balance('grade')) === beforeRetryBalance);
    await redis(['SET', `scans:${UID}:paid_left`, '1']);
    const paidBulk = await h.scan(exact(), { mode: 'grade', bulkGrade: true, backBase64: 'back' });
    t.check('explicit capability allows paid Bulk with actual one credit',
      paidBulk.statusCode === 200 && paidBulk.payload.creditsUsed === 1
      && await redis(['GET', `scans:${UID}:paid_left`]) === '0');
  } finally { finish(h); }
});

await t.section('normal welcome and authenticated read-only balances', async () => {
  const h = billingHarness({ balance: 12 });
  try {
    await seed(); globalThis.__STUB = exact();
    const email = 'confirmation@example.test';
    await redis(['SET', `verify_code:${UID}:${email}`, '123456']);
    const verified = await call(confirm, 'POST', { email, code: '123456' });
    t.check('normal verification grants separate welcome', verified.statusCode === 200 && verified.payload.bonusGranted === true
      && await redis(['GET', membershipWelcomeKeys(UID).id]) === '10' && h.store.get(`scans:${UID}:id_paid_left`) === '12');
    await redis(['SET', `verify_code:${UID}:${email}`, '123456']);
    const second = await call(confirm, 'POST', { email, code: '123456' });
    t.check('normal re-verification never claims a new welcome grant', second.payload.bonusGranted === false && second.payload.welcomeRecorded === true
      && await redis(['GET', membershipWelcomeKeys(UID).id]) === '10');
    const before = await state();
    const balanceResult = await call(credits, 'GET', {}, { query: { sub: 'attacker-ignored', email: 'other@example.test' } });
    t.check('normal balance derives owner from server auth, not query', balanceResult.statusCode === 200
      && balanceResult.payload.included.id === 5 && balanceResult.payload.welcome.id === 10 && balanceResult.payload.purchased.id === 12);
    const statusResult = await call(status, 'GET');
    t.check('normal status reflects same included/purchased balances', statusResult.statusCode === 200
      && statusResult.payload.totalScansLeft === balanceResult.payload.credits);
    t.check('balance GET and status GET do not issue grants or mutate state', await state() === before);
    globalThis.__STUB = { token: { throw: 'local invalid token' } };
    const invalid = await call(credits, 'GET');
    t.check('balance route rejects invalid authenticated token', invalid.statusCode === 401);
  } finally { finish(h); }
});

await t.section('legacy routes fence before marker/external writes and survive flag OFF', async () => {
  const h = billingHarness();
  try {
    await seed(); globalThis.__STUB = exact();
    const before = await state();
    const payment = await call(credits, 'POST', { action: 'verify_id_payment', sessionId: 'cs_synthetic' });
    const ref = await call(referral, 'POST', { action: 'claim', refCode: 'SYNTHETIC' });
    t.check('legacy return and both-owner referral denied', payment.statusCode === 503 && ref.statusCode === 503);
    t.check('denial preserves marker and balance bytes, no external call', before === await state() && h.outbound.length === 0);
    delete process.env.MEMBERSHIP_BILLING_V2;
    const paused = await h.scan(exact());
    const readPaused = await call(credits, 'GET');
    t.check('flag OFF after cutover cannot reenter legacy scan or display invented balances', paused.statusCode === 503 && readPaused.statusCode === 503);
    const response = await call(credits, 'POST', { action: 'verify_payment', sessionId: 'cs_synthetic' });
    t.check('flag OFF cannot resume legacy external credited marker', response.statusCode === 503 && h.outbound.length === 0);
    let blocked = false;
    try { await legacyCreditFetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(`scans:otherOwner:paid_left`)}/500`,
      { method: 'POST', headers: { Authorization: 'Bearer local-placeholder' } }); } catch { blocked = true; }
    t.check('stale write to different owner atomically blocked', blocked && await redis(['GET', 'scans:otherOwner:paid_left']) === null);
    t.check('all denial paths leave bytes unchanged', before === await state());
  } finally { finish(h); }
});

await t.section('publication failure returns failure and compensates without success stat', async () => {
  const h = billingHarness();
  try {
    await seed();
    const localFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (init?.body && String(input).startsWith(process.env.KV_REST_API_URL)) {
        const args = JSON.parse(init.body);
        if (args[0] === 'EVAL' && typeof args.at(-1) === 'string') {
          try {
            if (JSON.parse(args.at(-1)).action === 'publish') return Response.json({ error: 'synthetic publication refusal' });
          } catch {}
        }
      }
      return localFetch(input, init);
    };
    const result = await h.scan(exact());
    t.check('publication failure cannot return successful scan', result.statusCode === 503 && !result.payload.success);
    t.check('exact debit compensated with no record/stat', (await balance()).monthly === 5
      && (await redis(['KEYS', 'scan:*'])).length === 0 && await redis(['GET', 'stats:searches:total']) === null);
  } finally { finish(h); }
});

await t.section('rollout OFF untouched balance behavior before any durable fence', async () => {
  const h = billingHarness({ balance: 2 });
  try {
    const first = await h.scan();
    const result = await h.pick(h.body(first.payload.candidates[6]));
    t.check('legacy normal picker remains usable while OFF', result.statusCode === 200 && h.net() === 1);
    t.check('legacy does not create new period, enrollment, journal or fence', (await redis(['KEYS', 'membership:launch-v2:*'])).length === 0);
  } finally { finish(h); }
});
await t.section('normal scan HTTP intent replay and immutable content', async () => {
  const h = billingHarness({ balance: 2 });
  try {
    await seed();
    const token = 'e'.repeat(64);
    const first = await h.scan(exact(), { operation_id: token });
    const after = await balance();
    const replay = await h.scan(exact(), { operation_id: token });
    t.check('same HTTP operation returns exact stored response', first.statusCode === 200
      && JSON.stringify(first.payload) === JSON.stringify(replay.payload));
    t.check('HTTP replay does not debit again', JSON.stringify(after) === JSON.stringify(await balance()));
    t.check('HTTP replay creates one consumption receipt',
      (await redis(['KEYS', 'membership:launch-v2:consumption:*'])).length === 1);
    const changed = await h.scan(exact(), { operation_id: token, imageBase64: 'changed-photo' });
    t.check('changed request cannot reuse HTTP operation', changed.statusCode === 409);
    const missing = await h.scan(exact(), { operation_id: undefined });
    t.check('missing operation token fails before debit', missing.statusCode === 400
      && JSON.stringify(after) === JSON.stringify(await balance()));
    const parallelToken = 'f'.repeat(64);
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => h.scan(exact(), { operation_id: parallelToken })));
    t.check('concurrent operations only complete or remain pending', concurrent.every(r =>
      r.statusCode === 200 || (r.statusCode === 202 && r.payload.code === 'scan_intent_pending')));
    t.check('concurrent request causes one additional debit', (await balance()).monthly === after.monthly - 1
      && (await redis(['KEYS', 'membership:launch-v2:consumption:*'])).length === 2);
  } finally { finish(h); }
});
t.done();
