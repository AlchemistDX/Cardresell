// Real handlers + exact production Lua in private local Redis. No live APIs.
import { harness } from './_assert.mjs';
import { billingHarness, ambiguous, exact, UID, PAID_KEY, freeKey } from './_scanBillingHarness.mjs';
import { redisCommand } from './_idRedis.mjs';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const { ID_BILLING_SCRIPT, idBilling, idEntitlement, newIdReceipt, offerIdConfirmation, claimIdRetry, canonicalPick, candidateHash } = await import('../api/_idBilling.js');
const { TIER_BENEFITS } = await import('./stubs/_tier.js');
const t = harness('id-confirmation-atomic');
const evidence = { script_sha256: createHash('sha256').update(ID_BILLING_SCRIPT).digest('hex'),
  runtime: await redisCommand(['EVAL', 'return _VERSION', 0]), cases: [] };
console.log('Exact production Lua SHA256:', evidence.script_sha256, evidence.runtime);
// This release retains Production's provider picker, not the separate resolver.
const candidate = payload => payload.candidates[6];
const recordKey = body => `id_billing:${body.confirmation_id}`;
const getRec = (h, body) => JSON.parse(h.store.get(recordKey(body)));
const total = h => Number(h.store.get(PAID_KEY)) + Number(h.store.get(freeKey()));

// Literal user balance table, separate from the tier-coverage table below.
// Verified free grant is5; used4 means exactly ONE free credit remaining.
// Cancel has no server endpoint: like leaving the picker without selection, it
// must issue no acceptance request. The browser suite separately clicks Cancel.
evidence.literalBalanceTable = [];
for (const row of [
  { free: 1, paid: 0, action: 'accept', endFree: 0, endPaid: 0, bucket: 'id_free' },
  { free: 1, paid: 4, action: 'accept', endFree: 0, endPaid: 4, bucket: 'id_free' },
  { free: 0, paid: 1, action: 'accept', endFree: 0, endPaid: 0, bucket: 'id_paid_left' },
  { free: 0, paid: 0, action: 'deny-selection', endFree: 0, endPaid: 0 },
  { free: 1, paid: 0, action: 'cancel', endFree: 1, endPaid: 0 },
  { free: 1, paid: 0, action: 'no-selection', endFree: 1, endPaid: 0 },
]) {
  const h = billingHarness({ bucket: 'free', balance: row.paid });
  try {
    h.store.set(`email_verified:${UID}`, '1');
    h.store.set(freeKey(), 5 - row.free);
    const fixture = kind => { const s = kind(); s.tier = 'free'; return s; };
    const balances = () => ({ free: 5 - Number(h.store.get(freeKey())), paid: Number(h.store.get(PAID_KEY)) });
    const label = `literal free${row.free}/paid${row.paid}/${row.action}`;
    let initialDenial;
    if (row.action === 'deny-selection') {
      const stub = fixture(ambiguous);
      initialDenial = await h.scan(stub);
      t.check(`${label}: initially empty scan returns402 before provider`,
        initialDenial.statusCode === 402 && !stub.ximilarCalls
        && !initialDenial.payload.confirmation_id && !initialDenial.payload.identified);
      // A valid receipt cannot be issued with an empty initial balance.
      // Give one remaining free credit only to obtain the pending offer, then
      // spend it via a second REAL scan before selection, not a mocked debit.
      h.store.set(freeKey(), 4);
    }
    const offered = await h.scan(fixture(ambiguous));
    const body = h.body(candidate(offered.payload));
    const offerBalance = balances();
    t.check(`${label}: real scan issues pending receipt without identity promotion`,
      offered.statusCode === 200 && !!body.confirmation_id
      && offered.payload.identified === false && getRec(h, body).state === 'pending');
    t.check(`${label}: offer leaves free and paid buckets untouched`,
      offerBalance.free === (row.action === 'deny-selection' ? 1 : row.free) && offerBalance.paid === row.paid);
    let selected;
    if (row.action === 'deny-selection') {
      const other = await h.scan(fixture(exact));
      t.check(`${label}: another actual scan spends the last free credit`,
        other.statusCode === 200 && other.payload.success === true && !other.payload.needsPicker
        && balances().free === 0 && balances().paid === 0);
      selected = await h.pick(body);
      t.check(`${label}: pending selection returns402 with no accepted identity`,
        selected.statusCode === 402 && !selected.payload.identified && !selected.payload.pickedCard
        && getRec(h, body).state === 'pending');
    } else if (row.action === 'accept') {
      selected = await h.pick(body);
      t.check(`${label}: actual acceptance returns correct bucket and printing`,
        selected.statusCode === 200 && selected.payload.bucket === row.bucket
        && selected.payload.pickedCard?.set_name === 'set6' && getRec(h, body).state === 'accepted');
      t.check(`${label}: response reports separate exact remaining values`,
        selected.payload.free_remaining === row.endFree && selected.payload.paid_remaining === row.endPaid);
    } else {
      // No selection request is made on cancel or abandoned/unselected offer.
      t.check(`${label}: zero acceptance calls and receipt remains unconsumed`,
        h.selections.length === 0 && !h.commands.some(c => c.action === 'accept')
        && getRec(h, body).state === 'pending');
    }
    const end = balances();
    t.check(`${label}: literal final balances are exact`,
      end.free === row.endFree && end.paid === row.endPaid);
    t.check(`${label}: no external requests`, h.outbound.length === 0);
    evidence.literalBalanceTable.push({ ...row, initialDenialStatus: initialDenial?.statusCode,
      offerBalance, selectionStatus: selected?.statusCode, selectionRequests: h.selections.length,
      end, receiptState: getRec(h, body).state });
  } finally { h.restore(); }
}

// Six additional entitlement variants. Every case drives /scan then /scan-debit-id.
const table = [
  { name: 'verified free monthly grant', tier: 'free', verified: true, used: 0, paid: 0, bucket: 'id_free' },
  { name: 'unverified free paid only', tier: 'free', verified: false, used: 0, paid: 3, bucket: 'id_paid_left' },
  { name: 'Pro monthly first with paid untouched', tier: 'pro', verified: false, used: 0, paid: 3, bucket: 'id_free' },
  { name: 'Pro Max monthly grant', tier: 'pro_max', verified: false, used: 0, paid: 0, bucket: 'id_free' },
  { name: 'Ultimate monthly grant', tier: 'ultimate', verified: false, used: 0, paid: 0, bucket: 'id_free' },
  { name: 'exhausted monthly falls back to paid', tier: 'free', verified: true, used: 5, paid: 3, bucket: 'id_paid_left' },
];
for (const row of table) {
  const h = billingHarness({ bucket: 'free', balance: row.paid });
  try {
    h.store.set(freeKey(), row.used);
    if (row.verified) h.store.set(`email_verified:${UID}`, '1');
    const stub = ambiguous(); stub.tier = row.tier;
    const initial = await h.scan(stub);
    t.check(`${row.name}: real scan offers receipt`, initial.statusCode === 200 && /^[a-f0-9]{64}$/.test(initial.payload.confirmation_id));
    t.check(`${row.name}: cancel is zero in BOTH buckets`, Number(h.store.get(freeKey())) === row.used && Number(h.store.get(PAID_KEY)) === row.paid);
    const body = h.body(candidate(initial.payload));
    const accepted = await h.pick(body);
    t.check(`${row.name}: accepted once from correct bucket`, accepted.statusCode === 200 && accepted.payload.bucket === row.bucket);
    t.check(`${row.name}: no merging, exactly one correct counter changes`,
      Number(h.store.get(freeKey())) === row.used + (row.bucket === 'id_free' ? 1 : 0)
      && Number(h.store.get(PAID_KEY)) === row.paid - (row.bucket === 'id_paid_left' ? 1 : 0));
    t.check(`${row.name}: seventh candidate authoritative`, accepted.payload.pickedCard?.set_name === 'set6');
    const replay = await h.pick(body);
    t.check(`${row.name}: sequential replay identical result`, JSON.stringify(replay.payload) === JSON.stringify(accepted.payload));
    t.check(`${row.name}: no live outbound calls`, h.outbound.length === 0);
    evidence.cases.push({ ...row, accepted: accepted.payload });
  } finally { h.restore(); }
}

{
  const h = billingHarness({ balance: 0 });
  const stub = ambiguous(); stub.tier = 'free';
  const result = await h.scan(stub);
  t.check('unverified without paid credits denied before vision', result.statusCode === 402 && !stub.ximilarCalls && h.net() === 0);
  h.restore();
}
{
  const h = billingHarness({ balance: 1 });
  const initial = await h.scan();
  const body = h.body(candidate(initial.payload));
  const replies = await Promise.all(Array.from({ length: 24 }, () => h.pick(body)));
  t.check('24 concurrent same-receipt accepts all replay success', replies.every(r => r.statusCode === 200));
  t.check('24 concurrent results are exactly identical', replies.every(r => JSON.stringify(r.payload) === JSON.stringify(replies[0].payload)));
  t.check('24 concurrent accepts debit last paid credit once', h.net() === 1 && h.store.get(PAID_KEY) === '0');
  const rec = getRec(h, body); rec.expires = 1;
  h.store.set(recordKey(body), JSON.stringify(rec));
  globalThis.__STUB.tier = 'invalid-tier';
  h.faults.before = 'transport'; h.faults.action = 'not-an-action';
  const replay = await h.pick(body);
  t.check('completed replay survives pending expiry and zero balance and changed tier', replay.statusCode === 200 && JSON.stringify(replay.payload) === JSON.stringify(replies[0].payload));
  const conflict = await h.pick({ ...body, candidate: initial.payload.candidates[0] });
  t.check('completed different-candidate replay conflicts and never debits', conflict.statusCode === 409 && h.net() === 1);
  evidence.concurrent = replies.map(r => r.payload);
  h.restore();
}
{
  const h = billingHarness();
  const initial = await h.scan(), body = h.body(candidate(initial.payload));
  h.faults.after = true; h.faults.action = 'accept';
  // First accept is a read-only preflight; lose only the mutating transaction.
  // Issue preflight now, then supply cached entitlement directly for a real EVAL
  // transport-loss test. HTTP response loss is separately driven in browser.
  h.faults.after = false;
  const realFetch = globalThis.fetch;
  let discarded = false;
  globalThis.fetch = async (url, init) => {
    const r = await realFetch(url, init);
    if (init?.body) {
      const a = JSON.parse(init.body);
      if (a[0] === 'EVAL' && a[6] === 'accept' && JSON.parse(a[7]).grant !== undefined && !discarded) {
        discarded = true; throw new Error('lost after mutation');
      }
    }
    return r;
  };
  const lost = await h.pick(body);
  t.check('commit then lost KV response returns 503, not fabricated success', discarded && lost.statusCode === 503);
  t.check('unknown outcome was committed exactly once', h.net() === 1 && getRec(h, body).state === 'accepted');
  const retry = await h.pick(body);
  t.check('same-receipt retry replays after lost commit response', retry.statusCode === 200 && h.net() === 1);
  globalThis.fetch = realFetch;
  h.restore();
}
{
  const h = billingHarness();
  const initial = await h.scan(), body = h.body(candidate(initial.payload));
  for (const [name, tamper] of [
    ['forged receipt', { confirmation_id: 'f'.repeat(64) }],
    ['missing receipt', { confirmation_id: undefined }],
    ['scan changed', { scan_id: 'different-scan' }],
    ['mode grade', { mode: 'grade' }],
    ['candidate set changed', { candidate_set: 'f'.repeat(64) }],
    ['candidate printing changed', { candidate: { ...body.candidate, set: 'forged' } }],
    ['candidate extra metadata', { candidate: { ...body.candidate, price: 999 } }],
    ['client canonical result injection', { pickedCard: { card_name: 'forged' } }],
  ]) {
    const r = await h.pick({ ...body, ...tamper });
    t.check(`${name}: fail closed and zero debit`, r.statusCode >= 400 && h.net() === 0 && getRec(h, body).state === 'pending');
  }
  globalThis.__STUB.token.uid = 'foreign-owner';
  const foreign = await h.pick(body);
  t.check('owner mismatch fail closed before debit', foreign.statusCode === 409 && h.net() === 0);
  globalThis.__STUB.token.uid = UID;
  const rec = getRec(h, body); rec.expires = 1;
  h.store.set(recordKey(body), JSON.stringify(rec));
  const expired = await h.pick(body);
  t.check('expired pending receipt denied with zero debit', expired.statusCode === 410 && h.net() === 0);
  h.store.delete(recordKey(body));
  const missing = await h.pick(body);
  t.check('expired/deleted receipt never reconstructed', missing.statusCode === 409 && h.net() === 0);
  h.restore();
}
for (const failure of ['transport', 'redis', 'malformed', 'missing', 'false-success']) {
  const h = billingHarness();
  const initial = await h.scan(), body = h.body(candidate(initial.payload));
  h.faults.before = failure; h.faults.action = 'accept';
  const failed = await h.pick(body);
  t.check(`${failure} atomic failure: 503 and no consumption`, failed.statusCode === 503 && h.net() === 0 && getRec(h, body).state === 'pending');
  delete h.faults.before;
  const recovered = await h.pick(body);
  t.check(`${failure} failure: retry succeeds exactly once`, recovered.statusCode === 200 && h.net() === 1);
  h.restore();
}
for (const corrupt of ['-1', '1.5', '[5]', 'nonsense']) {
  const h = billingHarness();
  const initial = await h.scan(), body = h.body(candidate(initial.payload));
  h.store.set(PAID_KEY, corrupt);
  const result = await h.pick(body);
  t.check(`corrupt counter ${corrupt} fails before any write`, result.statusCode === 503
    && h.store.get(PAID_KEY) === corrupt && h.store.get(freeKey()) === '0' && getRec(h, body).state === 'pending');
  h.restore();
}
{
  const h = billingHarness();
  const initial = await h.scan(), body = h.body(candidate(initial.payload));
  delete process.env.KV_REST_API_URL;
  const result = await h.pick(body);
  t.check('missing KV confirmation fails closed', result.statusCode === 503 && h.net() === 0);
  const scan = await h.scan();
  t.check('missing KV scan fails closed', scan.statusCode === 503 && h.net() === 0);
  process.env.KV_REST_API_URL = 'https://scan-billing.test.invalid';
  h.restore();
}
{
  const h = billingHarness({ bucket: 'free', balance: 4 });
  h.store.set(freeKey(), '29');
  const first = await h.scan(), b1 = h.body(candidate(first.payload));
  const second = await h.scan(), b2 = h.body(candidate(second.payload));
  const results = await Promise.all([h.pick(b1), h.pick(b2)]);
  t.check('different receipts race final free slot then paid', results.map(r => r.payload.bucket).sort().join(',') === 'id_free,id_paid_left');
  t.check('monthly grant never overdrawn, paid decremented once', h.store.get(freeKey()) === '30' && h.store.get(PAID_KEY) === '3');
  h.restore();
}
{
  const h = billingHarness({ bucket: 'free', balance: 0 });
  h.store.set(freeKey(), '29');
  const results = await Promise.all(Array.from({ length: 8 }, () => h.scan(exact())));
  t.check('eight exact scans contend for final free slot: one succeeds', results.filter(r => r.statusCode === 200).length === 1 && results.filter(r => r.statusCode === 402).length === 7);
  t.check('exact scan concurrency has no negative or excess balance', h.store.get(freeKey()) === '30' && h.store.get(PAID_KEY) === '0');
  h.restore();
}
{
  const h = billingHarness();
  const initial = await h.scan(), b1 = h.body(candidate(initial.payload));
  const b2 = { ...b1, candidate: initial.payload.candidates[0] };
  const results = await Promise.all([h.pick(b1), h.pick(b2)]);
  t.check('concurrent different choices: one accepted, one conflict', results.map(r => r.statusCode).sort().join(',') === '200,409' && h.net() === 1);
  h.restore();
}
for (const after of [false, true]) {
  const h = billingHarness();
  h.faults.action = 'offer';
  if (after) h.faults.after = true; else h.faults.before = 'transport';
  const result = await h.scan();
  t.check(`offer failure ${after ? 'after' : 'before'} commit never exposes candidates`, result.statusCode === 503 && !result.payload.confirmation_id);
  t.check(`offer failure ${after ? 'after' : 'before'} commit refunds exactly once`, h.net() === 0);
  const key = h.commands.find(c => c.action === 'debit').key;
  const rec = JSON.parse(h.store.get(key));
  const refund = await idBilling('refund', { receipt: key.split(':')[1], owner: UID, scan: rec.scan });
  t.check('duplicate compensating refund remains zero', refund.ok && h.net() === 0);
  h.restore();
}
{
  const h = billingHarness({ bucket: 'free' });
  const context = { receipt: newIdReceipt(), owner: UID, scan: 'month-rollover-test', grant: 30, stamp: '2026_08' };
  const r = await idBilling('debit', context);
  t.check('reservation records original month', r.bucket === 'id_free' && h.store.get(`scans:${UID}:id_free_used_2026_08`) === '1');
  const cs = [{ name: 'same', number: '58', set: 'set1', language: 'en' },
    { name: 'same', number: '58', set: 'set2', language: 'ja' }];
  const offer = await offerIdConfirmation(context, cs);
  t.check('offer restores ORIGINAL month, not current month', h.store.get(`scans:${UID}:id_free_used_2026_08`) === '0' && h.store.get(freeKey()) === '0');
  const duplicate = await offerIdConfirmation(context, cs);
  t.check('duplicate issuance is stable and refund not repeated', JSON.stringify(duplicate) === JSON.stringify(offer) && h.store.get(`scans:${UID}:id_free_used_2026_08`) === '0');
  globalThis.__STUB = ambiguous();
  const accepted = await h.pick({ ...offer, mode: 'identify', candidate: cs[1] });
  t.check('confirmation takes current month free grant and retains language', accepted.payload.bucket === 'id_free'
    && accepted.payload.pickedCard.language === 'ja' && h.store.get(freeKey()) === '1'
    && h.store.get(`scans:${UID}:id_free_used_2026_08`) === '0');
  const invalidRefund = await idBilling('refund', context);
  t.check('accepted receipt cannot be reset by auto-refund', !invalidRefund.ok && h.store.get(freeKey()) === '1');
  h.restore();
}
for (const tier of ['free', 'pro']) {
  const h = billingHarness();
  globalThis.__STUB = ambiguous(); globalThis.__STUB.tier = tier;
  const gradePaid = `scans:${UID}:paid_left`;
  const gradeFree = `scans:${UID}:free_used_${new Date().toISOString().slice(0, 7).replace('-', '_')}`;
  h.store.set(gradePaid, '7'); h.store.set(gradeFree, '0');
  h.store.set('scan:identify-retry-test', JSON.stringify({ uid: UID, consumed_from: 'id_paid_left' }));
  const result = await h.invokeScan({ mode: 'grade', bulkGrade: true, retry_of: 'identify-retry-test',
    imageBase64: 'front', backBase64: 'back' });
  t.check(`${tier}: identify retry cannot bypass bulk grade tier gate`, result.statusCode === 403 && result.payload.requiresTier === 'pro_max');
  t.check(`${tier}: grade misuse leaves identify retry unconsumed`, !JSON.parse(h.store.get('scan:identify-retry-test')).retry_used);
  t.check(`${tier}: rejected bulk grade leaves both grade and ID balances unchanged`,
    h.store.get(gradePaid) === '7' && h.store.get(gradeFree) === '0' && h.net() === 0);
  t.check(`${tier}: rejected bulk grade issues no financial mutation before403`,
    !h.commands.some(c => c.cmd === 'eval' || (['incr', 'incrby', 'decr', 'decrby', 'set', 'mset'].includes(c.cmd)
      && String(c.key).startsWith(`scans:${UID}:`))) && !globalThis.__STUB.ximilarCalls);
  h.restore();
}
// Actual idEntitlement -> actual getUserTier, not a stubbed tier result.
// These are valid persisted non-active statuses, not storage failures. Empty
// email deliberately disables active-subscription fallback, without credentials.
evidence.nonActiveStatuses = [];
for (const status of ['cancelled', 'canceled', 'inactive', 'past_due', 'unpaid',
  'paused', 'incomplete', 'incomplete_expired']) {
  for (const profile of [
    { name: 'verified-free', verified: true, paid: 3, grant: 5, bucket: 'id_free' },
    { name: 'purchased-only', verified: false, paid: 3, grant: 0, bucket: 'id_paid_left' },
    { name: 'no-credit', verified: false, paid: 0, grant: 0 },
  ]) {
    const h = billingHarness({ bucket: 'free', balance: profile.paid });
    try {
      h.store.set(`pro:${UID}`, JSON.stringify({ status, tier: 'pro' }));
      if (profile.verified) h.store.set(`email_verified:${UID}`, '1');
      const stub = ambiguous(); stub.useRealTier = true; stub.token.email = '';
      globalThis.__STUB = stub;
      const entitlement = await idEntitlement({ uid: UID, email: '' });
      const label = `${status}/${profile.name}`;
      t.check(`${label}: real entitlement never grants paid tier`, entitlement.grant === profile.grant);
      const initial = await h.scan(stub);
      if (!profile.bucket) {
        t.check(`${label}: healthy no-credit denial is402 not503`, initial.statusCode === 402 && !stub.ximilarCalls && h.net() === 0);
      } else {
        t.check(`${label}: real scan offers receipt with zero net debit`, initial.statusCode === 200
          && !!initial.payload.confirmation_id && h.net() === 0);
        const accepted = await h.pick(h.body(candidate(initial.payload)));
        t.check(`${label}: real pending acceptance uses correct bucket`, accepted.statusCode === 200
          && accepted.payload.bucket === profile.bucket);
        t.check(`${label}: remaining counters stay separate`, Number(h.store.get(freeKey())) === (profile.verified ? 1 : 0)
          && Number(h.store.get(PAID_KEY)) === profile.paid - (profile.verified ? 0 : 1)
          && accepted.payload.free_remaining === (profile.verified ? 4 : 0)
          && accepted.payload.paid_remaining === profile.paid - (profile.verified ? 0 : 1));
      }
      t.check(`${label}: no external service requests`, h.outbound.length === 0);
      evidence.nonActiveStatuses.push({ status, profile: profile.name, grant: entitlement.grant,
        initialStatus: initial.statusCode, freeUsed: Number(h.store.get(freeKey())),
        paidRemaining: Number(h.store.get(PAID_KEY)) });
    } finally { h.restore(); }
  }
}
{
  const h = billingHarness({ bucket: 'free' });
  try {
    const stub = ambiguous(); stub.useRealTier = true; stub.token.email = '';
    globalThis.__STUB = stub;
    h.store.set(`pro:${UID}`, JSON.stringify({ status: 'active', tier: 'pro' }));
    t.check('real active record retains paid-tier grant', (await idEntitlement({ uid: UID, email: '' })).grant === 30);
    h.store.set(`pro:${UID}`, JSON.stringify({ status: 'unknown-invalid-status', tier: 'pro' }));
    let rejected = false;
    try { await idEntitlement({ uid: UID, email: '' }); } catch (_) { rejected = true; }
    t.check('unknown persisted status remains fail-closed in real entitlement', rejected);
    const initial = await h.scan(stub);
    t.check('unknown persisted status denies initial debit before provider', initial.statusCode === 503 && !stub.ximilarCalls && h.net() === 0);
  } finally { h.restore(); }
}
// Strict entitlement failures must not downgrade a paid grant to free/paid.
for (const failure of ['http503', 'redis-error', 'malformed-pro']) {
  const h = billingHarness({ bucket: 'free' });
  const initial = await h.scan(), body = h.body(candidate(initial.payload));
  const transport = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/get/pro%3A')) {
      if (failure === 'http503') return Response.json({}, { status: 503 });
      if (failure === 'redis-error') return Response.json({ error: 'ERR' });
      return Response.json({ result: '{broken' });
    }
    return transport(url, init);
  };
  h.store.set(`email_verified:${UID}`, '1');
  globalThis.__STUB.useRealTier = true;
  const pending = await h.pick(body);
  t.check(`tier ${failure}: pending accept fails closed`, pending.statusCode === 503 && h.net() === 0);
  const stub = ambiguous(); stub.useRealTier = true;
  const scan = await h.scan(stub);
  t.check(`tier ${failure}: initial debit fails closed before provider`, scan.statusCode === 503 && !stub.ximilarCalls && h.net() === 0);
  h.restore();
}
{
  const h = billingHarness({ bucket: 'free' });
  const initial = await h.scan(), body = h.body(candidate(initial.payload));
  const accepted = await h.pick(body);
  const transport = globalThis.fetch;
  let tierCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/get/pro%3A')) { tierCalls++; throw new Error('tier outage'); }
    return transport(url, init);
  };
  globalThis.__STUB.useRealTier = true;
  const replay = await h.pick(body);
  t.check('completed replay does not even request unavailable entitlement', replay.statusCode === 200
    && tierCalls === 0 && JSON.stringify(accepted.payload) === JSON.stringify(replay.payload) && h.net() === 1);
  h.restore();
}
{
  const h = billingHarness();
  const transport = globalThis.fetch;
  let delayed;
  globalThis.fetch = async (url, init) => {
    const args = init?.body && JSON.parse(init.body);
    if (args?.[0] === 'EVAL' && args[6] === 'debit' && !delayed) {
      delayed = args;
      throw new Error('timeout before delayed debit executes');
    }
    return transport(url, init);
  };
  const result = await h.scan();
  t.check('initial timeout returns unavailable with unchanged balance', result.statusCode === 503 && h.net() === 0);
  const late = JSON.parse(await redisCommand(delayed));
  t.check('refund-first tombstone fences delayed initial debit', late.code === 'already_reserved'
    && h.net() === 0 && JSON.parse(h.store.get(delayed[3])).state === 'refunded');
  h.restore();
}
{
  const h = billingHarness();
  h.faults.action = 'debit'; h.faults.after = true;
  const result = await h.scan();
  t.check('initial debit commit response lost: journal compensation restores once', result.statusCode === 503 && h.net() === 0);
  h.restore();
}
{
  const h = billingHarness();
  h.faults.before = 'transport';
  const result = await h.scan();
  t.check('unconfirmed compensation reports reconciliation, never claims refund',
    result.statusCode === 503 && result.payload.error === 'billing_reconciliation_required'
    && /^[a-f0-9]{64}$/.test(result.payload.billing_reference) && h.net() === 0);
  h.restore();
}
for (const bucket of ['paid', 'free']) {
  const h = billingHarness({ bucket });
  h.faults.throwResponse = true;
  const failed = await h.scan(exact());
  const command = h.commands.find(c => c.cmd === 'set' && c.key.startsWith('scan:'));
  t.check(`${bucket}: post-record exception rolls back once`, failed.statusCode === 503 && h.net() === 0 && !!command);
  const replay = await h.refund(command.key.slice(5));
  t.check(`${bucket}: stale legacy record cannot double-refund journal`, replay.statusCode === 200 && replay.payload.credits_refunded === 0 && h.net() === 0);
  h.restore();
}
{
  const h = billingHarness({ bucket: 'free' });
  const scan = await h.scan(exact());
  const refunds = await Promise.all(Array.from({ length: 8 }, () => h.refund(scan.payload.scan_id)));
  t.check('new-format manual ID refunds restore correct free bucket once', refunds.every(r => r.statusCode === 200)
    && refunds.reduce((sum, r) => sum + r.payload.credits_refunded, 0) === 1 && h.net() === 0);
  t.check('manual ID refund rate counted once with TTL', h.store.get(`scan_refund_count:${UID}`) === '1'
    && await redisCommand(['TTL', `scan_refund_count:${UID}`]) > 0);
  h.restore();
}
{
  const h = billingHarness();
  const original = await h.scan(exact());
  const retryOf = original.payload.scan_id;
  // Exercise ambiguous provider output rather than an earlier exact fixture's
  // best-effort catalogue cache (identity-cache policy is outside billing).
  for (const key of h.store.keys()) if (key.startsWith('ptcg:')) h.store.delete(key);
  const scans = await Promise.all([h.scan(ambiguous(), { retry_of: retryOf }), h.scan(ambiguous(), { retry_of: retryOf })]);
  t.check('both concurrent retries reach actual confirmation handler', scans.every(r => r.statusCode === 200 && r.payload.confirmation_id), JSON.stringify(scans.map(r => r.payload)));
  const zeroCost = scans.map(r => JSON.parse(h.store.get(`id_billing:${r.payload.confirmation_id}`)).zero_cost);
  t.check('parallel same-original ID retry grants at most one zero-cost receipt', zeroCost.filter(Boolean).length === 1 && h.net() === 1);
  const picks = await Promise.all(scans.map(r => h.pick({ ...r.payload,
    mode: 'identify', candidate: candidate(r.payload) })));
  t.check('only claimed retry is free; other confirmation debits normally', picks.filter(r => r.payload.bucket === 'id_retry').length === 1 && h.net() === 2);
  h.restore();
}
for (const after of [false, true]) {
  const h = billingHarness();
  const original = await h.scan(exact());
  h.faults.action = 'claim_retry';
  if (after) h.faults.after = true; else h.faults.before = 'transport';
  const retry = await h.scan(ambiguous(), { retry_of: original.payload.scan_id });
  t.check(`retry marker failure ${after ? 'after' : 'before'} commit fails closed without new authority`,
    retry.statusCode === 503 && !retry.payload.confirmation_id && h.net() === 1);
  h.restore();
}
{
  const h = billingHarness();
  const original = await h.scan(exact());
  const rec = JSON.parse(h.store.get(`scan:${original.payload.scan_id}`));
  const context = { receipt: rec.id_receipt, owner: UID, scan: original.payload.scan_id };
  const [retry, refund] = await Promise.all([
    claimIdRetry({ owner: UID, receipt: newIdReceipt() }, original.payload.scan_id),
    idBilling('manual_refund', context),
  ]);
  t.check('manual refund and retry claim cannot both win', (retry && !refund.ok && h.net() === 1)
    || (!retry && refund.ok && h.net() === 0));
  h.restore();
}
{
  const h = billingHarness();
  const stub = ambiguous();
  stub.ximilar = { cardInfo: { card_type: 'sports', card_name: 'Player', card_number: '1' },
    needsPicker: true, candidates: [
      { card_name: 'Player', card_number: '1', card_type: 'sports', set_name: 'A', year: '2020' },
      { card_name: 'Player', card_number: '1', card_type: 'sports', set_name: 'B', year: '2021' },
    ] };
  const initial = await h.scan(stub);
  t.check('legacy Ximilar picker issues receipt without promoting top guess', initial.statusCode === 200
    && !!initial.payload.confirmation_id && initial.payload.needsPicker && initial.payload.identified === false && h.net() === 0);
  const accepted = await h.pick(h.body(initial.payload.candidates[1]));
  t.check('legacy picker accepts bound second candidate once', accepted.statusCode === 200
    && accepted.payload.pickedCard.set_name === 'B' && accepted.payload.pickedCard.card_type === 'sports' && h.net() === 1);
  h.restore();
}
{
  const h = billingHarness();
  const context = { owner: UID, scan: 'oversized-candidates', receipt: newIdReceipt(), grant: 0 };
  await idBilling('debit', context);
  let rejected = false;
  try { await offerIdConfirmation(context, Array.from({ length: 201 }, (_, i) => ({ id: i }))); }
  catch (_) { rejected = true; }
  await idBilling('refund', context);
  t.check('oversized offer is rejected whole, then original debit restored', rejected && h.net() === 0);
  h.restore();
}
// User-reported managed V7: both orders reject shared references with nil and
// accept independent equal-value structures. This local shim models that
// behavior; it is NOT another managed run or a downloaded provider artifact.
const beforeCopySource = execFileSync('git', ['show', '12d45c2:api/_idBilling.js'], { encoding: 'utf8' });
const beforeCopyScript = /export const ID_BILLING_SCRIPT = `([\s\S]*?)`;/m.exec(beforeCopySource)[1];
const referenceSensitive = `
local native=cjson
local function repeated(v,seen)
  if type(v)~='table' then return false end
  if seen[v] then return true end
  seen[v]=true
  for _,x in pairs(v) do if repeated(x,seen) then return true end end
  return false
end
local cjson={decode=native.decode,encode=function(v)
  if type(v)=='table' and v.state=='accepted' and repeated(v,{}) then
    return nil,'injected repeated-reference encoder limitation'
  end
  return native.encode(v)
end}
`;
const copyEvidence = [];
for (const bucket of ['free', 'paid']) for (const variant of ['original', 'shallow', 'recursive', 'native']) {
  const h = billingHarness({ bucket, balance: 4 });
  try {
    const context = { receipt: newIdReceipt(), owner: UID, scan: `synthetic-copy-${bucket}-${variant}`,
      grant: bucket === 'free' ? 1 : 0 };
    const cards = [
      { name: 'Other synthetic card', number: '1', set: 'Synthetic set' },
      { name: 'Selected synthetic card', number: '2', set: 'Synthetic set',
        metadata: { flags: [true, false, null], amount: 0, label: '',
          printing: { language: 'ja', versions: [{ finish: 'foil', count: 2 }, { finish: 'plain', count: 1 }] } },
        images: { large: 'synthetic-image', sizes: [10, 20] } },
    ];
    await idBilling('debit', context);
    const offer = await offerIdConfirmation(context, cards);
    const key = `id_billing:${context.receipt}`, pendingBytes = h.store.get(key);
    const pending = JSON.parse(pendingBytes), freeBefore = h.store.get(freeKey()), paidBefore = h.store.get(PAID_KEY);
    const savedFetch = globalThis.fetch;
    let acceptCalls = 0;
    globalThis.fetch = async (url, init = {}) => {
      if (String(url) === process.env.KV_REST_API_URL && init.body) {
        const args = JSON.parse(init.body);
        if (args[0] === 'EVAL' && args[2] === 3 && args[6] === 'accept') {
          acceptCalls++;
          const script = variant === 'original' ? beforeCopyScript
            : variant === 'shallow' ? ID_BILLING_SCRIPT.replace('out[k]=copy(x)', 'out[k]=x') : ID_BILLING_SCRIPT;
          args[1] = (variant === 'native' ? '' : referenceSensitive) + script;
          return savedFetch(url, { ...init, body: JSON.stringify(args) });
        }
      }
      return savedFetch(url, init);
    };
    const accept = () => idBilling('accept', { ...context, candidate_set: offer.candidate_set,
      candidate: candidateHash(cards[1]) });
    let result, error;
    try { result = await accept(); } catch (e) { error = e.code; }
    const rejected = ['original', 'shallow'].includes(variant);
    if (rejected) {
      t.check(`${bucket}/${variant}:reference-sensitive encoder fails actual acceptance before financial write`,
        error === 'billing_unavailable' && !result && h.store.get(key) === pendingBytes
        && h.store.get(freeKey()) === freeBefore && h.store.get(PAID_KEY) === paidBefore);
    } else {
      const completedBytes = h.store.get(key), journal = JSON.parse(completedBytes);
      t.check(`${bucket}/${variant}:recursive independent selected card preserves every nested value and type`,
        result?.ok === true && candidateHash(result.pickedCard) === candidateHash(canonicalPick(cards[1]))
        && candidateHash(journal.candidates) === candidateHash(pending.candidates)
        && journal.selected === candidateHash(cards[1]) && journal.candidate_set === pending.candidate_set
        && candidateHash(JSON.parse(journal.result_json)) === candidateHash(result));
      t.check(`${bucket}/${variant}:one correct bucket changes and valid accepted journal commits together`,
        journal.state === 'accepted' && result.bucket === (bucket === 'free' ? 'id_free' : 'id_paid_left')
        && Number(h.store.get(freeKey())) === Number(freeBefore) + (bucket === 'free' ? 1 : 0)
        && Number(h.store.get(PAID_KEY)) === Number(paidBefore) - (bucket === 'paid' ? 1 : 0));
      const replays = await Promise.all(Array.from({ length: 8 }, accept));
      t.check(`${bucket}/${variant}:concurrent replay returns recorded identity without rewriting or charging`,
        replays.every(r => candidateHash(r) === candidateHash(result)) && h.store.get(key) === completedBytes
        && acceptCalls === 9 && h.net() === 1);
    }
    copyEvidence.push({ bucket, variant, accepted: !!result?.ok, error: error || null,
      pendingPreservedOnFailure: rejected ? h.store.get(key) === pendingBytes : null });
  } finally { h.restore(); }
}
writeFileSync('/home/user/workspace/billing_release_structural_copy_regression_20260917.json',
  JSON.stringify({ scope: 'LOCAL actual production modules/Lua plus explicit reference-sensitive encoder fault injection',
    originalScriptSha256: createHash('sha256').update(beforeCopyScript).digest('hex'),
    repairedScriptSha256: evidence.script_sha256, cases: copyEvidence }, null, 2));

// Fault injection at the serializer boundary, not a claim about the provider's
// underlying trigger. Real handlers execute real Lua on isolated Redis.
// A nil outer encoding previously reached tostring(nil), committed literal
// "nil" plus the charge, and still returned an accepted response.
evidence.encodingFaults = [];
for (const bucket of ['free', 'paid']) for (const fault of [
  'outer-nil', 'outer-false', 'outer-malformed', 'outer-wrong-record',
  'outer-throws', 'result-nil', 'result-false', 'result-malformed', 'result-wrong-record', 'result-throws',
  'decode-nil', 'decode-wrong-record',
]) {
  const h = billingHarness({ bucket, balance: 4 });
  try {
    const offered = await h.scan(ambiguous()), body = h.body(candidate(offered.payload));
    const beforeJournal = h.store.get(recordKey(body));
    const beforeFree = h.store.get(freeKey()), beforePaid = h.store.get(PAID_KEY);
    const savedFetch = globalThis.fetch;
    const target = fault.startsWith('outer') ? "v.state=='accepted'" : "v.ok==true and v.pickedCard~=nil";
    const value = fault.endsWith('nil') ? 'nil' : fault.endsWith('false') ? 'false'
      : fault.endsWith('malformed') ? "'nil'" : fault.endsWith('throws') ? "error('injected encoder exception')" : "'{}'";
    globalThis.fetch = async (url, init = {}) => {
      if (String(url) === process.env.KV_REST_API_URL && init.body) {
        const args = JSON.parse(init.body);
        if (args[0] === 'EVAL' && args[2] === 3 && args[6] === 'accept') {
          const injected = fault.startsWith('decode')
            ? `local real_cjson=cjson\nlocal cjson={encode=real_cjson.encode,decode=function(s)\n`
              + `local v=real_cjson.decode(s)\nif type(v)=='table' and v.state=='accepted' then return ${fault === 'decode-nil' ? 'nil' : '{}'} end\nreturn v end}\n`
            : `local real_cjson=cjson\nlocal cjson={decode=real_cjson.decode,encode=function(v)\n`
              + `if type(v)=='table' and (${target}) then return ${value},'injected encoding failure' end\n`
              + `return real_cjson.encode(v) end}\n`;
          args[1] = injected + args[1];
          return savedFetch(url, { ...init, body: JSON.stringify(args) });
        }
      }
      return savedFetch(url, init);
    };
    const attempts = fault === 'outer-nil' ? await Promise.all(Array.from({ length: 5 }, () => h.pick(body)))
      : [await h.pick(body)];
    const failed = attempts[0];
    globalThis.fetch = savedFetch;
    const unchanged = h.store.get(recordKey(body)) === beforeJournal
      && h.store.get(freeKey()) === beforeFree && h.store.get(PAID_KEY) === beforePaid;
    const storedJournalIsLiteralNil = h.store.get(recordKey(body)) === 'nil';
    t.check(`${bucket}/${fault}:encoding failure503, no accepted identity`,
      failed.statusCode === 503 && !failed.payload.pickedCard);
    t.check(`${bucket}/${fault}:pending bytes and both counters unchanged before MSET`, unchanged);
    if (fault === 'outer-nil') t.check(`${bucket}:concurrent encoder failures cannot charge or consume authority`,
      attempts.every(r => r.statusCode === 503) && unchanged);
    if (unchanged) {
      const retry = await h.pick(body), replay = await h.pick(body);
      t.check(`${bucket}/${fault}:retry after encoder recovery accepts once and replays`,
        retry.statusCode === 200 && replay.statusCode === 200
        && retry.payload.bucket === (bucket === 'free' ? 'id_free' : 'id_paid_left')
        && JSON.stringify(retry.payload) === JSON.stringify(replay.payload) && h.net() === 1);
    } else t.check(`${bucket}/${fault}:retry recovery requires intact pending authority`, false);
    evidence.encodingFaults.push({ bucket, fault, status: failed.statusCode,
      pendingAndBalancesUnchanged: unchanged, storedJournalIsLiteralNil });
  } finally { h.restore(); }
}
{
  const h = billingHarness();
  try {
    const offered = await h.scan(ambiguous()), body = h.body(candidate(offered.payload));
    h.store.set(recordKey(body), 'nil'); // historical corruption, not an empty receipt
    const free = h.store.get(freeKey()), paid = h.store.get(PAID_KEY);
    const refused = await h.pick(body);
    t.check('literal nil journal fails closed, never treated as empty/new debit authority',
      refused.statusCode === 503 && h.store.get(recordKey(body)) === 'nil'
      && h.store.get(freeKey()) === free && h.store.get(PAID_KEY) === paid);
  } finally { h.restore(); }
}
writeFileSync('/home/user/workspace/billing_release_atomic_test_evidence_20260917.json', JSON.stringify(evidence, null, 2));
for (const operation of ['debit', 'refund', 'accept', 'replay']) {
  const h = billingHarness();
  try {
    const offered = await h.scan(ambiguous()), body = h.body(candidate(offered.payload));
    if (operation === 'replay') await h.pick(body);
    h.store.set(recordKey(body), 'nil');
    const beforeFree = h.store.get(freeKey()), beforePaid = h.store.get(PAID_KEY);
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      if (String(url) === process.env.KV_REST_API_URL && init.body) {
        const args = JSON.parse(init.body);
        if (args[0] === 'EVAL' && args[2] === 3) {
          args[1] = "local original=cjson\nlocal cjson={encode=original.encode,decode=function(s) "
            + "if s=='nil' then return nil,'injected decoder failure' end return original.decode(s) end}\n" + args[1];
          return savedFetch(url, { ...init, body: JSON.stringify(args) });
        }
      }
      return savedFetch(url, init);
    };
    let rejected;
    if (operation === 'debit' || operation === 'refund') {
      try {
        await idBilling(operation, { receipt: body.confirmation_id, owner: UID, scan: body.scan_id, grant: 0 });
        rejected = false;
      } catch (e) { rejected = e.code === 'billing_unavailable'; }
    } else rejected = (await h.pick(body)).statusCode === 503;
    t.check(`silent decode nil/${operation}:existing raw journal never treated as absent`,
      rejected && h.store.get(recordKey(body)) === 'nil'
      && h.store.get(freeKey()) === beforeFree && h.store.get(PAID_KEY) === beforePaid);
  } finally { h.restore(); }
}
t.done();
