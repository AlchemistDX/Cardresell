// Private Redis only. Clock/encoder faults are explicitly injected into the
// exact exported script; no managed runtime or live-payment claim.
import { createHash } from 'node:crypto';
import { harness } from './_assert.mjs';
import { redisCommand as redis } from './_idRedis.mjs';
import { createMembershipConsumption, MEMBERSHIP_CONSUMPTION_SCRIPT,
  membershipEnrollmentKey, membershipReceiptKey } from '../api/_membershipConsumption.js';
import { grantMembership, membershipWelcomeKeys, membershipIncludedHistoryKey } from '../api/_membershipLedger.js';
import { ID_BILLING_SCRIPT, candidateHash, canonicalPick } from '../api/_idBilling.js';
import { guardLegacyCommand, MEMBERSHIP_LEGACY_FENCE, membershipRouteMode } from '../api/_membershipLegacyFence.js';

const t = harness('membership-consumption');
const sha = s => createHash('sha256').update(s).digest('hex');
const owner = 'localConsumer';
const read = async key => { const raw = await redis(['GET', key]); return raw === null ? null : JSON.parse(raw); };
const paid = mode => `scans:${owner}:${mode === 'grade' ? 'paid_left' : 'id_paid_left'}`;
const welcome = membershipWelcomeKeys(owner);
let serial = 0;
const ctx = (extra = {}) => ({ owner, receipt: (++serial).toString(16).padStart(64, '0'), scan: `scan_${serial.toString().padStart(8, '0')}`, ...extra });
const invoke = createMembershipConsumption({ execute: redis });
const snapshot = async () => {
  const keys = (await redis(['KEYS', '*'])).sort();
  return JSON.stringify(await Promise.all(keys.map(async key => [key, await redis(['GET', key]), await redis(['PTTL', key])])));
};
async function reset(plan = 'free') {
  await redis(['FLUSHDB']);
  await redis(['SET', MEMBERSHIP_LEGACY_FENCE, '1']);
  await redis(['SET', membershipEnrollmentKey(owner), JSON.stringify({ version: 'launch-v2', owner, verified: true,
    plan, ...(plan === 'free' ? { freeThrough: 0 } : { subscription: 'sub_localPeriod' }) })]);
}
async function rejected(name, fn) {
  let error; try { await fn(); } catch (e) { error = e; }
  t.check(name, !!error);
}
const clockExecutor = seconds => async args => {
  if (args[0] === 'TIME') return [String(seconds), '0'];
  if (args[0] === 'EVAL' && args[1] === MEMBERSHIP_CONSUMPTION_SCRIPT) {
    args = [...args]; args[1] = args[1].replace("local now=tonumber(redis.call('TIME')[1])", `local now=${seconds}`);
  }
  return redis(args);
};
const at = seconds => createMembershipConsumption({ execute: clockExecutor(seconds) });
const candidates = Array.from({ length: 7 }, (_, i) => {
  const card = { name: `Synthetic ${i}`, number: `${i}`, nested: { tags: ['synthetic', { value: i }], nullable: null } };
  return { hash: candidateHash(card), card: canonicalPick(card, 'pokemon') };
});
const offer = { candidates, candidate_set: candidateHash(candidates.map(c => c.hash)) };
const selection = { candidate_set: offer.candidate_set, candidate: candidates[5].hash };

await t.section('trusted Bulk capability is atomic and independent of pricing', async () => {
  await reset();
  const context = ctx({ mode: 'grade', bulkGrade: true });
  let before = await snapshot();
  t.check('missing capability snapshot is explicitly unknown', (await invoke('snapshot', context)).bulk_grade === null);
  t.check('missing capability cannot debit', (await invoke('debit', context)).code === 'membership_capability_unavailable'
    && await snapshot() === before);
  const enrollmentKey = membershipEnrollmentKey(owner);
  const enrollment = await read(enrollmentKey);
  enrollment.capabilities = { bulkGrade: false };
  await redis(['SET', enrollmentKey, JSON.stringify(enrollment)]);
  before = await snapshot();
  t.check('false capability atomically denies debit without writes', (await invoke('debit', context)).code === 'membership_capability_denied'
    && await snapshot() === before);
  enrollment.capabilities.bulkGrade = true;
  await redis(['SET', enrollmentKey, JSON.stringify(enrollment)]);
  t.check('explicit true allows Free account Bulk independently of plan', (await invoke('snapshot', context)).bulk_grade === true
    && (await invoke('debit', context)).charged === 1);
  await invoke('publish', { ...context, scanRecord: {} });
  enrollment.capabilities.bulkGrade = false;
  // Preserve lazy initialization history when changing only a capability.
  const currentEnrollment = await read(enrollmentKey);
  await redis(['SET', enrollmentKey, JSON.stringify({ ...currentEnrollment, capabilities: enrollment.capabilities })]);
  const retry = ctx({ mode: 'grade' });
  before = await snapshot();
  t.check('capability revoked after snapshot cannot bypass atomic retry admission',
    (await invoke('claim_retry', { ...context, retry_receipt: retry.receipt, retry_scan: retry.scan })).code === 'membership_capability_denied'
    && await snapshot() === before);
  t.check('completed original debit still replays after capability revoked',
    (await invoke('debit', context)).charged === 1 && await snapshot() === before);
});

await t.section('source boundary and immutable original Lua', async () => {
  t.check('historical 7/7 ID Lua unchanged', sha(ID_BILLING_SCRIPT) === '7494e779bc0782a28d7546b7b3aaceb14e2153991c92793c0c1d6c425d075080');
  t.check('no expiry deletes receipt or purchased balance', !/redis\.call\('(EXPIRE|DEL|INCR|DECR|SET)'/.test(MEMBERSHIP_CONSUMPTION_SCRIPT));
  await reset();
  const before = await snapshot();
  const result = await invoke('snapshot', ctx());
  t.check('Free monthly 5 plus no implicit welcome', result.monthly === 5 && result.welcome === 0 && result.purchased === 0);
  t.check('snapshot completely read-only', before === await snapshot());
  await redis(['DEL', MEMBERSHIP_LEGACY_FENCE]);
  t.check('no migration/fence means no debit', (await invoke('debit', ctx())).code === 'membership_cutover_not_ready');
});

await t.section('separate welcome, monthly priority, purchased standing untouched', async () => {
  await reset();
  await redis(['MSET', paid('identify'), '47', paid('grade'), '13']);
  await grantMembership(redis, 'welcome', { owner, email: 'consumer@example.test', verified: true });
  const a = ctx(); const result = await invoke('debit', a);
  const record = await read(membershipReceiptKey(a.receipt));
  t.check('debit first uses monthly', record.sources.monthly === 1 && record.sources.welcome === 0 && record.sources.purchased === 0);
  t.check('welcome remains ten and standing 47 untouched', await redis(['GET', welcome.id]) === '10' && await redis(['GET', paid('identify')]) === '47');
  t.check('exact response replay', JSON.stringify(await invoke('debit', a)) === JSON.stringify(result));
  for (let i = 0; i < 4; i++) await invoke('debit', ctx());
  const b = ctx(); await invoke('debit', b);
  t.check('after monthly depleted welcome consumed before purchased', (await read(membershipReceiptKey(b.receipt))).sources.welcome === 1
    && await redis(['GET', paid('identify')]) === '47');
  for (let i = 0; i < 9; i++) await invoke('debit', ctx());
  const c = ctx(); await invoke('debit', c);
  t.check('only after both included sources depleted is purchased charged', (await read(membershipReceiptKey(c.receipt))).sources.purchased === 1
    && await redis(['GET', paid('identify')]) === '46');
  await invoke('refund', c);
  await invoke('refund', c);
  t.check('purchased refunded exactly once with no expiry', await redis(['GET', paid('identify')]) === '47' && await redis(['PTTL', paid('identify')]) === -1);
  await grantMembership(redis, 'welcome', { owner, email: 'consumer@example.test', verified: true });
  t.check('spent welcome not refilled by replay', await redis(['GET', welcome.id]) === '0');
});

await t.section('Grade 2 splits all sources atomically', async () => {
  await reset();
  await redis(['SET', paid('grade'), '1']);
  const a = ctx({ mode: 'grade', cost: 2 });
  const r = await invoke('debit', a);
  t.check('one monthly plus one purchased permits deep Grade', r.ok && r.charged === 2
    && (await read(membershipReceiptKey(a.receipt))).sources.monthly === 1
    && (await read(membershipReceiptKey(a.receipt))).sources.purchased === 1);
  const refunded = await invoke('refund', a);
  t.check('deep refund exact replay', JSON.stringify(await invoke('refund', a)) === JSON.stringify(refunded));
  t.check('both original buckets restored', (await invoke('snapshot', ctx({ mode: 'grade' }))).monthly === 1
    && await redis(['GET', paid('grade')]) === '1');
  await reset();
  const before = await snapshot();
  t.check('insufficient total rejected without partial monthly debit', (await invoke('debit', ctx({ mode: 'grade', cost: 2 }))).code === 'no_credits');
  t.check('insufficient total writes nothing including no allocation', await snapshot() === before);
  await grantMembership(redis, 'welcome', { owner, email: 'consumer@example.test', verified: true });
  const b = ctx({ mode: 'grade', cost: 2 }); await invoke('debit', b);
  const br = await read(membershipReceiptKey(b.receipt));
  t.check('deep Grade can use monthly1 welcome1', br.sources.monthly === 1 && br.sources.welcome === 1 && br.sources.purchased === 0);
  t.check('ID cannot masquerade as Grade2', !(await invoke('refund', { ...b, mode: 'identify', cost: 1 })).ok);
});

await t.section('concurrent admission and grant has no lost writes', async () => {
  await reset();
  const results = await Promise.all(Array.from({ length: 20 }, () => invoke('debit', ctx())));
  t.check('only five concurrent Free ID admissions', results.filter(x => x.ok).length === 5);
  const a = ctx({ mode: 'grade' });
  const duplicate = await Promise.all(Array.from({ length: 20 }, () => invoke('debit', a)));
  t.check('twenty duplicate receipts consume one Grade', duplicate.every(x => x.ok)
    && (await invoke('snapshot', ctx({ mode: 'grade' }))).monthly === 0);
  const p = { owner, paymentId: 'pi_concurrentSynthetic', packId: 'grade_10', plan: 'free', currency: 'usd', amountCents: 599, paid: true };
  await Promise.all([grantMembership(redis, 'pack', p),
    ...Array.from({ length: 15 }, () => invoke('debit', ctx({ mode: 'grade' })))]);
  const journals = await redis(['KEYS', 'membership:launch-v2:consumption:*']);
  const gradeCharges = (await Promise.all(journals.map(read))).filter(j => j.mode === 'grade' && j.sources?.purchased === 1).length;
  t.check('concurrent grant/debit conserves ten purchased credits', Number(await redis(['GET', paid('grade')])) + gradeCharges === 10);
});

await t.section('UTC month issuance, nonexpiring carryforward and exact source refund', async () => {
  await reset();
  const jan = Date.UTC(2028, 0, 31, 23, 59, 59) / 1000;
  const feb = jan + 1;
  const a = ctx(); await at(jan)('debit', a);
  const january = (await read(membershipReceiptKey(a.receipt))).sources.period;
  const b = ctx(); await at(feb)('debit', b);
  const february = `membership:launch-v2:free_period:${sha(owner)}:${feb}`;
  await at(feb)('refund', a);
  t.check('FIFO spends January carryforward; refund restores January only', january !== february
    && (await read(january)).id_used === 1 && (await read(february)).id_used === 0
    && (await read(membershipReceiptKey(b.receipt))).sources.period === january);
  const balance = await at(feb)('snapshot', ctx());
  t.check('leap February issuance retains all nine unused included credits', balance.monthly === 9 && balance.period_end === Date.UTC(2028, 2, 1) / 1000);
  await redis(['DEL', february]); const before = await snapshot();
  await rejected('missing initialized allocation cannot refill', () => at(feb)('debit', ctx()));
  t.check('missing allocation leaves bytes unchanged', before === await snapshot());
  await rejected('older month cannot replace newer authority', () => at(jan)('renew_free', ctx()));
  await reset();
  const replies = await Promise.all(Array.from({ length: 10 }, () => at(feb)('renew_free', ctx())));
  t.check('concurrent monthly issuance one allocation only', replies.every(x => x.monthly === 5)
    && (await redis(['KEYS', 'membership:launch-v2:free_period:*'])).length === 1);
});

await t.section('paid invoice authority, expiry, renewal and refund', async () => {
  await reset('paid');
  const now = Number((await redis(['TIME']))[0]);
  const first = { owner, invoiceId: 'in_first', subscriptionId: 'sub_localPeriod', plan: 'starter',
    periodStart: now - 1000, periodEnd: now - 500, currency: 'usd', amountCents: 499, paid: true };
  // Canonical synthetic paid invoice. Ledger clock is injected to its period;
  // production fulfillment still uses real Redis TIME.
  const grantAt = seconds => async args => redis(args[0] === 'EVAL'
    ? [args[0], args[1].replace("local now=tonumber(redis.call('TIME')[1])", `local now=${seconds}`), ...args.slice(2)] : args);
  await grantMembership(grantAt(now - 900), 'period', first);
  const a = ctx(); await at(now - 900)('debit', a);
  const oldKey = (await read(membershipReceiptKey(a.receipt))).sources.period;
  await redis(['SET', paid('identify'), '2']);
  const expired = await invoke('snapshot', ctx());
  t.check('paid-through expiry never expires included or purchased credits',
    expired.monthly === 24 && expired.purchased === 2 && expired.period_active === false);
  await grantMembership(redis, 'period', { ...first, invoiceId: 'in_second', periodStart: now - 100, periodEnd: now + 900, plan: 'casual', amountCents: 999 });
  const b = ctx(); await invoke('debit', b);
  const newKey = `membership:launch-v2:period:${sha(`sub_localPeriod:${now - 100}`)}`;
  await invoke('refund', a);
  t.check('old paid carryforward consumed FIFO and refunded at exact original source',
    (await read(oldKey)).id_used === 1 && (await read(newKey)).id_used === 0);
  await grantMembership(redis, 'period', { ...first, invoiceId: 'in_lateFirst' });
  t.check('late older invoice cannot refill, all unused included remains available', (await invoke('snapshot', ctx())).monthly === 74);
  await redis(['DEL', newKey]);
  await rejected('missing paid allocation fails closed', () => invoke('debit', ctx()));
});

await t.section('nonexpiring included lots, split refunds, old receipt compatibility and corruption', async () => {
  await reset();
  const jan = Date.UTC(2028, 0, 15) / 1000, feb = Date.UTC(2028, 1, 15) / 1000;
  const mar = Date.UTC(2028, 2, 15) / 1000;
  await at(jan)('renew_free', ctx());
  const historyKey = membershipIncludedHistoryKey(owner);
  const january = (await read(historyKey)).periods[0];
  const januaryBytes = await redis(['GET', january]);
  await Promise.all(Array.from({ length: 12 }, () => at(feb)('renew_free', ctx())));
  const history = await read(historyKey);
  t.check('duplicate February issuance keeps January bytes and exactly two grants',
    history.count === 2 && await redis(['GET', january]) === januaryBytes
    && (await at(feb)('snapshot', ctx())).monthly === 10
    && (await at(feb)('snapshot', ctx({ mode: 'grade' }))).monthly === 2);
  const deep = ctx({ mode: 'grade', cost: 2 });
  const results = await Promise.all(Array.from({ length: 5 }, () => at(feb)('debit', deep)));
  const deepJournal = await read(membershipReceiptKey(deep.receipt));
  t.check('Deep Grade atomically splits two nonexpiring included periods exactly once',
    results.every(x => x.charged === 2) && deepJournal.sources.included.length === 2
    && deepJournal.sources.included.every(x => x.amount === 1)
    && (await at(feb)('snapshot', ctx({ mode: 'grade' }))).monthly === 0);
  const damaged = structuredClone(deepJournal); delete damaged.sources.included;
  await redis(['SET', membershipReceiptKey(deep.receipt), JSON.stringify(damaged)]);
  const damagedBytes = await snapshot();
  await rejected('new split receipt missing vector never falls back to legacy single source',
    () => at(feb)('refund', deep));
  t.check('damaged source vector leaves all balances and journal bytes unchanged', await snapshot() === damagedBytes);
  await redis(['SET', membershipReceiptKey(deep.receipt), JSON.stringify(deepJournal)]);
  await at(mar)('renew_free', ctx());
  const march = (await read(historyKey)).periods[2], marchBytes = await redis(['GET', march]);
  await Promise.all(Array.from({ length: 8 }, () => at(mar)('refund', deep)));
  t.check('duplicate split refund restores exact two source lots and never edits March',
    (await at(mar)('snapshot', ctx({ mode: 'grade' }))).monthly === 3
    && await redis(['GET', march]) === marchBytes
    && (await read(january)).grade_used === 0);
  t.check('included balances and every provenance record have no TTL',
    (await Promise.all((await redis(['KEYS', '*'])).map(k => redis(['TTL', k])))).every(x => x === -1));
  const single = ctx(); await at(mar)('debit', single);
  const singleKey = membershipReceiptKey(single.receipt);
  const legacy = await read(singleKey);
  delete legacy.sources.included; delete legacy.sources.policy;
  await redis(['SET', singleKey, JSON.stringify(legacy)]);
  await at(mar)('refund', single);
  t.check('existing single-period source journal refunds without source reinterpretation',
    (await at(mar)('snapshot', ctx())).monthly === 15 && (await read(singleKey)).state === 'refunded');
  await redis(['DEL', historyKey]);
  const before = await snapshot();
  await rejected('lost initialized history never silently reconstructs or drops old included credits',
    () => at(mar)('debit', ctx()));
  await rejected('renewal cannot replace lost initialized history', () => at(mar)('renew_free', ctx()));
  t.check('history-loss refusals leave all old allocations and journals untouched', await snapshot() === before);
});

await t.section('paid renewal concurrency with carryforward consumption and response loss', async () => {
  await reset('paid');
  const now = Number((await redis(['TIME']))[0]);
  const earlier = { owner, invoiceId: 'in_nonexpireOld', subscriptionId: 'sub_localPeriod', plan: 'starter',
    periodStart: now - 1000, periodEnd: now - 100, currency: 'usd', amountCents: 499, paid: true };
  await grantMembership(redis, 'period', earlier);
  const original = await invoke('snapshot', ctx());
  t.check('first delivered past paid invoice remains fully spendable without live benefits',
    original.monthly === 25 && original.period_active === false);
  const next = { ...earlier, invoiceId: 'in_nonexpireNew', periodStart: now - 100, periodEnd: now + 1000 };
  const debits = Array.from({ length: 10 }, () => ctx());
  const concurrent = await Promise.allSettled([
    ...Array.from({ length: 10 }, () => grantMembership(redis, 'period', next)),
    ...debits.map(c => invoke('debit', c)),
  ]);
  t.check('concurrent renewal outcomes are committed or explicit unavailable, never a guessed success',
    concurrent.every(x => x.status === 'fulfilled' || x.reason.code === 'billing_unavailable'));
  // A changed active-pointer CAS may refuse before mutation. Explicit test
  // reconciliation reuses each identical receipt after renewal settles.
  await Promise.all(debits.map(c => invoke('debit', c)));
  t.check('concurrent renewal and debit conserve included50 minus ten, no lost writes',
    (await invoke('snapshot', ctx())).monthly === 40 && (await read(membershipIncludedHistoryKey(owner))).count === 2);
  const lost = ctx({ mode: 'grade', cost: 2 });
  let once = true;
  const lossy = createMembershipConsumption({ execute: async command => {
    const result = await redis(command);
    if (command[0] === 'EVAL' && once) { once = false; throw new Error('synthetic postcommit response loss'); }
    return result;
  } });
  await rejected('nonexpiring split debit response loss is unknown, not rollback', () => lossy('debit', lost));
  const before = await snapshot();
  t.check('same receipt after lost response returns original with no second consumption',
    (await invoke('debit', lost)).charged === 2 && await snapshot() === before);
});

await t.section('every paid plan allowance and authority corruption', async () => {
  const now = Number((await redis(['TIME']))[0]);
  for (const [plan, cents, id, grade] of [['starter', 499, 25, 5], ['casual', 999, 50, 15],
    ['pro', 1999, 250, 40], ['business', 4999, 1000, 100]]) {
    await reset('paid');
    await grantMembership(redis, 'period', { owner, invoiceId: `in_${plan}`, subscriptionId: 'sub_localPeriod',
      plan, periodStart: now - 100, periodEnd: now + 100, currency: 'usd', amountCents: cents, paid: true });
    t.check(`${plan} exact paid invoice allowances`, (await invoke('snapshot', ctx())).monthly === id
      && (await invoke('snapshot', ctx({ mode: 'grade' }))).monthly === grade);
    const a = ctx(); await invoke('debit', a);
    t.check(`${plan} one receipt debits one ID`, (await invoke('snapshot', ctx())).monthly === id - 1);
  }
  const activeKey = `membership:launch-v2:active:${sha(owner)}`;
  const active = await read(activeKey);
  await redis(['SET', activeKey, JSON.stringify({ ...active, owner: 'anotherOwner' })]);
  const before = await snapshot();
  await rejected('paid authority owner mismatch rejects', () => invoke('debit', ctx()));
  t.check('wrong owner leaves every counter and journal unchanged', await snapshot() === before);
  await reset();
  const a = ctx(); await invoke('debit', a);
  const journalKey = membershipReceiptKey(a.receipt), journal = await read(journalKey);
  await redis(['SET', journalKey, JSON.stringify({ ...journal, sources: { ...journal.sources, period_start: 0 } })]);
  const corrupted = await snapshot();
  await rejected('refund period binding corruption rejects', () => invoke('refund', a));
  t.check('corrupt refund never replenishes another period', corrupted === await snapshot());
});

await t.section('offer cancellation, selected identity, expired pending and durable replay', async () => {
  await reset();
  const a = ctx(); await invoke('debit', a); await invoke('offer', { ...a, ...offer });
  t.check('offer returns debit, net zero', (await invoke('snapshot', ctx())).monthly === 5);
  const r = await invoke('accept', { ...a, ...selection });
  t.check('accept picks sixth exact nested candidate, not shortlist', r.ok && r.pickedCard.card_name === 'Synthetic 5'
    && r.pickedCard.nested.tags[1].value === 5 && r.pickedCard.nested.nullable === null);
  const now = Number((await redis(['TIME']))[0]);
  t.check('completed replay remains exact after pending expiry', JSON.stringify(await at(now + 2000)('accept', { ...a, ...selection })) === JSON.stringify(r));
  await redis(['SET', membershipEnrollmentKey(owner), JSON.stringify({ version: 'launch-v2', owner, verified: true, plan: 'paid', subscription: 'sub_missing' })]);
  t.check('completed replay does not need new tier period', JSON.stringify(await invoke('accept', { ...a, ...selection })) === JSON.stringify(r));
  t.check('different chosen candidate cannot replay accepted receipt', (await invoke('accept', { ...a, ...selection, candidate: candidates[2].hash })).code === 'selection_mismatch');
  await reset();
  const b = ctx(); await invoke('debit', b); await invoke('offer', { ...b, ...offer });
  const before = await snapshot();
  t.check('expired pending rejects without debit', (await at(now + 2000)('accept', { ...b, ...selection })).code === 'expired_confirmation');
  t.check('expired pending leaves every byte unchanged', before === await snapshot());
  const c = ctx(); await invoke('refund', c);
  t.check('compensation tombstone fences delayed debit', (await invoke('debit', c)).code === 'already_reserved');
});

await t.section('publication and retry/refund exclusion use explicit mode and cost', async () => {
  await reset();
  const a = ctx(); await invoke('debit', a); await invoke('publish', { ...a, scanRecord: { card_name: 'Synthetic' } });
  const retry = ctx();
  const r = await Promise.all([
    invoke('claim_retry', { ...a, retry_receipt: retry.receipt, retry_scan: retry.scan }),
    invoke('manual_refund', a),
  ]);
  t.check('retry and refund cannot both win', !(r[0].claimed === true && r[1].ok === true));
  const record = await read(membershipReceiptKey(a.receipt));
  if (record.retry_used) {
    t.check('automatic refund also cannot double-dip retry', (await invoke('refund', a)).code === 'invalid_state');
    await invoke('offer', { ...retry, ...offer });
    t.check('retry offer acceptance is zero cost with durable binding', (await invoke('accept', { ...retry, ...selection })).charged === 0);
  } else t.check('refunded receipt cannot grant retry', (await invoke('claim_retry', { ...a, retry_receipt: retry.receipt, retry_scan: retry.scan })).claimed === false);
  t.check('ID never authorizes Grade retry', (await invoke('claim_retry', { ...a, mode: 'grade', retry_receipt: retry.receipt, retry_scan: retry.scan })).code === 'binding_mismatch');
  await reset();
  await redis(['SET', paid('grade'), '10']);
  const b = ctx({ mode: 'grade', cost: 2 }); await invoke('debit', b); await invoke('publish', { ...b, scanRecord: {} });
  t.check('Grade2 cannot be rebound to Grade1 retry', (await invoke('claim_retry', { ...b, cost: 1, retry_receipt: retry.receipt, retry_scan: retry.scan })).code === 'binding_mismatch');
  const success = await invoke('manual_refund', b);
  t.check('manual Grade2 refund and duplicate are exact', success.credits_refunded === 2 && JSON.stringify(await invoke('manual_refund', b)) === JSON.stringify(success));
});

await t.section('transport and serialization failure atomicity', async () => {
  await reset();
  const a = ctx(); let lost = false;
  const drop = createMembershipConsumption({ execute: async args => {
    const result = await redis(args);
    if (args[0] === 'EVAL' && !lost) { lost = true; throw new Error('local injected response loss'); }
    return result;
  } });
  await rejected('committed lost response unknown to caller', () => drop('debit', a));
  t.check('same receipt after commit consumes once', (await invoke('debit', a)).ok && (await invoke('snapshot', ctx())).monthly === 4);
  const b = ctx(); const before = await snapshot();
  const broken = createMembershipConsumption({ execute: args => {
    if (args[0] === 'EVAL') args = [args[0], `
local native=cjson
local cjson={decode=native.decode,encode=function(v)
  if type(v)=='table' and v.sources then return nil end
  return native.encode(v)
end}
` + args[1], ...args.slice(2)];
    return redis(args);
  } });
  await rejected('journal encoder nil refuses debit', () => broken('debit', b));
  t.check('nil serialization failure preserves all bytes', before === await snapshot());
  await redis(['SET', membershipReceiptKey(b.receipt), 'nil']);
  const corrupt = await snapshot();
  await rejected('existing literal nil not treated as absent', () => invoke('debit', b));
  t.check('corrupt receipt preserved', corrupt === await snapshot());
  await reset(); await redis(['SET', paid('grade'), '9007199254740991']);
  const overflow = await snapshot();
  await rejected('unsupported counter boundary fails before mutation', () => invoke('debit', ctx({ mode: 'grade', cost: 2 })));
  t.check('overflow bytes preserved', overflow === await snapshot());
  await reset(); await redis(['SET', paid('identify'), '100000000000025']);
  const precise = await snapshot();
  await rejected('runtime cannot round large response balances into a charge', () => invoke('debit', ctx()));
  t.check('unsupported JSON roundtrip precision leaves exact standing bytes', precise === await snapshot());
  await reset();
  const c = ctx(); await invoke('debit', c); await invoke('offer', { ...c, ...offer });
  const nilResult = createMembershipConsumption({ execute: args => {
    if (args[0] === 'EVAL') args = [args[0], `
local native=cjson
local cjson={decode=native.decode,encode=function(v)
  if type(v)=='table' and v.pickedCard then return nil end
  return native.encode(v)
end}
` + args[1], ...args.slice(2)];
    return redis(args);
  } });
  const pending = await snapshot();
  await rejected('accept result encoder nil rejects before any financial write', () => nilResult('accept', { ...c, ...selection }));
  t.check('accept nil preserves pending bytes and both balances', pending === await snapshot());
  const accepted = await invoke('accept', { ...c, ...selection });
  const acceptedKey = membershipReceiptKey(c.receipt), acceptedRecord = await read(acceptedKey);
  await redis(['SET', acceptedKey, JSON.stringify({ ...acceptedRecord, result_json: '{"ok":true}' })]);
  await rejected('corrupt accepted response cannot become successful identity', () => invoke('accept', { ...c, ...selection }));
  t.check('original valid acceptance charged once before corruption', accepted.charged === 1 && (await invoke('snapshot', ctx())).monthly === 4);
});

await t.section('rolling refund cap, expiry and safe publication retry', async () => {
  await reset();
  for (let i = 0; i < 4; i++) {
    const a = ctx(); await invoke('debit', a);
    const publication = await invoke('publish', { ...a, scanRecord: { card_name: 'Synthetic' } });
    const original = await redis(['GET', `scan:${a.scan}`]);
    await invoke('publish', { ...a, scanRecord: { card_name: 'MUST NOT REPLACE' } });
    t.check(`publication ${i} idempotent bytes`, publication.published && await redis(['GET', `scan:${a.scan}`]) === original);
    const result = await invoke('manual_refund', a);
    t.check(`manual refund ${i} obeys rolling cap`, i < 3 ? result.ok : result.code === 'refund_cap');
  }
  t.check('fourth debit remains charged after capped refund', (await invoke('snapshot', ctx())).monthly === 4);
  const now = Number((await redis(['TIME']))[0]);
  const b = ctx(); await invoke('debit', b); await invoke('publish', { ...b, scanRecord: {} });
  const before = await snapshot();
  t.check('logical scan refund expiry independent of cleanup', (await at(now + 3601)('manual_refund', b)).code === 'expired_confirmation');
  t.check('expired manual refund leaves receipt and sources unchanged', before === await snapshot());
});

await t.section('durable atomic legacy fencing and rollout rollback', async () => {
  await reset();
  const oldRead = 100;
  const commands = [
    ['SET', paid('identify'), oldRead], ['SET', paid('grade'), oldRead],
    ['INCRBY', paid('identify'), 25], ['SET', 'signup_bonus:legacyOtherOwner', '1'],
    ['SET', 'email_bonus_claimed:other@example.test', '1'], ['SET', 'ref_claimed:newOwner', '1'],
    ['SET', 'ref_count:referrerOtherOwner', '1'], ['SET', 'stripe_evt:evt_synthetic', '1', 'NX'],
  ];
  const before = await snapshot();
  for (const command of commands) await rejected(`atomic fence ${command[1]}`, () => redis(guardLegacyCommand(command)));
  t.check('delayed old write and both referral owner markers unchanged', before === await snapshot());
  const oldContext = ctx();
  await rejected('unchanged old ID Lua atomically fenced', () => redis(guardLegacyCommand([
    'EVAL', ID_BILLING_SCRIPT, 3, `id_billing:${oldContext.receipt}`, `scans:${owner}:id_free_used_2026_09`, paid('identify'),
    'debit', JSON.stringify({ ...oldContext, mode: 'identify', grant: 5 }), 86400,
  ])));
  process.env.KV_REST_API_URL = 'https://local-test.upstash.io';
  delete process.env.MEMBERSHIP_BILLING_V2;
  await rejected('turning flag OFF cannot bypass durable fence', () => membershipRouteMode(redis));
  process.env.MEMBERSHIP_BILLING_V2 = 'on';
  t.check('flag ON plus durable fence selects versioned route', await membershipRouteMode(redis));
  await redis(['DEL', MEMBERSHIP_LEGACY_FENCE]);
  await rejected('flag alone cannot activate', () => membershipRouteMode(redis));
  delete process.env.MEMBERSHIP_BILLING_V2;
  t.check('never activated OFF keeps legacy dispatch', await membershipRouteMode(redis) === false);
  await redis(guardLegacyCommand(['SET', paid('identify'), 7]));
  t.check('legacy write works without durable cutover', await redis(['GET', paid('identify')]) === '7');
});
t.done();
