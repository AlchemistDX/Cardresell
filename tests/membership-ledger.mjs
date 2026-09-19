// Dormant module + exact Lua in private Unix-socket Redis. No network, env
// credentials, handlers or live Stripe. Payment envelopes are synthetic trusted
// server fixtures; these tests do NOT prove webhook authentication/normalization.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { harness } from './_assert.mjs';
import { redisCommand as redis } from './_idRedis.mjs';
import { MEMBERSHIP_LEDGER_SCRIPT, prepareMembershipGrant, grantMembership, membershipWelcomeKeys,
  membershipIncludedHistoryKey, membershipGrantHoldKey } from '../api/_membershipLedger.js';
import { LAUNCH_PLANS, LAUNCH_PACKS, quoteLaunchPack } from '../api/_launchMembershipConfig.js';
import { ID_BILLING_SCRIPT } from '../api/_idBilling.js';
import { createMembershipConsumption, membershipEnrollmentKey } from '../api/_membershipConsumption.js';

const t = harness('membership-ledger');
const sha = value => createHash('sha256').update(value).digest('hex');
const UID = 'syntheticLedgerOwner';
const idKey = `scans:${UID}:id_paid_left`, gradeKey = `scans:${UID}:paid_left`;
const welcomeKeys = membershipWelcomeKeys(UID);
const pack = (paymentId = 'pi_syntheticOne', more = {}) => ({
  owner: UID, paymentId, packId: 'id_25', plan: 'free',
  currency: 'usd', amountCents: 299, paid: true, ...more,
});
const now = Number((await redis(['TIME']))[0]);
const period = (invoiceId = 'in_syntheticOne', more = {}) => ({
  owner: UID, invoiceId, subscriptionId: 'sub_syntheticOne', plan: 'starter',
  periodStart: now - 100, periodEnd: now + 1000,
  currency: 'usd', amountCents: 499, paid: true, ...more,
});
const welcome = (more = {}) => ({ owner: UID, email: 'dedicated@example.test', verified: true, ...more });
const keys = (kind, input) => prepareMembershipGrant(kind, input).command.slice(3, 9);
const raw = key => redis(['GET', key]);
const get = async key => { const v = await raw(key); return v === null ? null : JSON.parse(v); };
const num = async key => Number(await raw(key));
const reset = () => redis(['FLUSHDB']); // this process's private fresh Redis ONLY
const invoke = (kind, input, execute = redis) => grantMembership(execute, kind, input);
const rejected = async (name, fn, code) => {
  try { await fn(); t.check(name, false, 'unexpected success'); }
  catch (error) { t.check(name, error.code === code, `actual ${error.code}`); }
};
const snapshot = async () => {
  const names = (await redis(['KEYS', '*'])).sort();
  return JSON.stringify(await Promise.all(names.map(async key => [key, await raw(key), await redis(['PTTL', key])])));
};
console.log('Ledger exact Lua SHA256:', sha(MEMBERSHIP_LEDGER_SCRIPT));
console.log('Unchanged production ID Lua SHA256:', sha(ID_BILLING_SCRIPT));
console.log('Lua runtime:', await redis(['EVAL', 'return _VERSION', 0]));

await t.section('dormant source and central catalog boundaries', async () => {
  const source = readFileSync(new URL('../api/_membershipLedger.js', import.meta.url), 'utf8');
  t.check('module has no fetch or environment reads', !/\bfetch\s*\(|process\.env/.test(source));
  t.check('production ID Lua matches managed historical script', sha(ID_BILLING_SCRIPT)
    === '7494e779bc0782a28d7546b7b3aaceb14e2153991c92793c0c1d6c425d075080');
  t.check('exact ledger has one financial MSET and no increment/SETNX/expiry fallback',
    (MEMBERSHIP_LEDGER_SCRIPT.match(/redis\.call\('MSET'/g) || []).length === 1
    && !/redis\.call\('(INCR|DECR|SETNX|EXPIRE|SET)'/.test(MEMBERSHIP_LEDGER_SCRIPT));
  for (const plan of Object.keys(LAUNCH_PLANS)) {
    for (const packId of Object.keys(LAUNCH_PACKS)) {
      await reset();
      const quote = quoteLaunchPack(packId, plan);
      const result = await invoke('pack', pack('pi_catalog', { packId, plan, amountCents: quote.amountCents }));
      t.check(`${plan}/${packId}: exact configured quantity and separate balance`,
        result.id_delta === (quote.kind === 'id' ? quote.credits : 0)
        && result.grade_delta === (quote.kind === 'grade' ? quote.credits : 0)
        && await num(idKey) === result.id_delta && await num(gradeKey) === result.grade_delta);
    }
  }
});

await t.section('business payment identity across webhook and return', async () => {
  await reset();
  const payload = pack();
  const webhookNormalized = () => invoke('pack', { ...payload });
  const returnNormalized = () => invoke('pack', { ...payload });
  const replies = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    i % 2 ? webhookNormalized() : returnNormalized()));
  t.check('twenty webhook/return responses replay one recorded result',
    replies.length === 20 && replies.every(r => JSON.stringify(r) === JSON.stringify(replies[0])));
  t.check('twenty requests credit one pack only', await num(idKey) === 25 && await num(gradeKey) === 0);
  t.check('one canonical payment journal only', (await redis(['KEYS', 'membership:launch-v2:payment:*'])).length === 1);
  const journal = await get(keys('pack', payload)[0]);
  const provenance = JSON.parse(journal.request_json);
  t.check('journal retains canonical business and catalog provenance',
    provenance.payment === payload.paymentId && provenance.pack === payload.packId
    && provenance.amount === payload.amountCents && provenance.version === 'launch-v2'
    && Number.isSafeInteger(journal.applied_at));
  t.check('sequential retry remains exact', JSON.stringify(await returnNormalized()) === JSON.stringify(replies[0]));
  const before = await snapshot();
  await rejected('owner mismatch on same payment fails', () => invoke('pack', pack(undefined, { owner: 'otherSynthetic' })), 'operation_conflict');
  await rejected('quantity conflict on same payment fails', () => invoke('pack', pack(undefined,
    { packId: 'id_100', amountCents: 999 })), 'operation_conflict');
  t.check('conflicting payment leaves every stored byte unchanged', await snapshot() === before);
  await invoke('pack', pack('pi_syntheticTwo'));
  t.check('distinct actual business payment grants separately', await num(idKey) === 50);
  await redis(['DECRBY', idKey, 50]);
  await returnNormalized();
  t.check('replay after all granted credits are spent cannot replenish them', await num(idKey) === 0);
});

await t.section('committed response loss, precommit error and postcommit error', async () => {
  await reset();
  let calls = 0;
  await rejected('lost response reported unavailable, not invented failure rollback', () => invoke('pack', pack(), async command => {
    calls++; await redis(command); throw new Error('synthetic response lost');
  }), 'ledger_unavailable');
  t.check('only one command issued on ambiguous outcome', calls === 1 && await num(idKey) === 25);
  const replay = await invoke('pack', pack());
  t.check('same business retry records original result without another credit', replay.id_delta === 25 && await num(idKey) === 25);
  await reset();
  await redis(['MSET', idKey, 7, gradeKey, 9]);
  const before = await snapshot();
  await rejected('write command error fails closed', () => invoke('pack', pack(), command => {
    const c = [...command]; c[1] = c[1].replace("redis.call('MSET',unpack(writes))", "error('synthetic before MSET')");
    return redis(c);
  }), 'ledger_unavailable');
  t.check('precommit error preserves balances and no marker', await snapshot() === before);
  await rejected('postwrite error remains ambiguous to caller', () => invoke('pack', pack(), command => {
    const c = [...command]; c[1] = c[1].replace("redis.call('MSET',unpack(writes))",
      "redis.call('MSET',unpack(writes)); error('synthetic after MSET')");
    return redis(c);
  }), 'ledger_unavailable');
  t.check('Redis script error after MSET does not roll back commit', await num(idKey) === 32);
  await invoke('pack', pack());
  t.check('retry after postwrite script error does not grant twice', await num(idKey) === 32);
});

await t.section('serialization failure before sole write', async () => {
  for (const failure of ['nil', 'throw', 'malformed', 'roundtrip']) {
    for (const kind of ['pack', 'welcome', 'period']) {
      await reset();
      await redis(['MSET', idKey, 11, gradeKey, 3]);
      const input = kind === 'pack' ? pack() : kind === 'welcome' ? welcome() : period();
      const before = await snapshot();
      const shim = `local native=cjson
local cjson={decode=native.decode,encode=function(v)
  if v.result_json then
    ${failure === 'nil' ? 'return nil' : failure === 'throw' ? "error('synthetic encoder failure')"
      : failure === 'malformed' ? "return 'nil'" : "return '{}'"}
  end
  return native.encode(v)
end}
`;
      await rejected(`${kind}/${failure}: journal encoding failure rejects`, () => invoke(kind, input, command => {
        const c = [...command]; c[1] = shim + c[1]; return redis(c);
      }), 'ledger_unavailable');
      t.check(`${kind}/${failure}: balances and all markers unchanged`, await snapshot() === before);
    }
  }
});

await t.section('welcome once per UID and normalized email with legacy markers', async () => {
  await reset();
  const replies = await Promise.all(Array.from({ length: 15 }, () => invoke('welcome', welcome())));
  t.check('fifteen welcome calls one separate 10 ID / 1 grade grant',
    await num(welcomeKeys.id) === 10 && await num(welcomeKeys.grade) === 1);
  t.check('new welcome does not create purchased balances', await raw(idKey) === null && await raw(gradeKey) === null);
  t.check('welcome recorded result replays exactly', replies.every(r => JSON.stringify(r) === JSON.stringify(replies[0])));
  const other = await invoke('welcome', welcome({ owner: 'anotherSynthetic', email: ' Dedicated@EXAMPLE.TEST ' }));
  t.check('same normalized email on another UID gets zero', !other.granted && other.id_delta === 0 && other.grade_delta === 0);
  await rejected('same UID changed email never regrants', () => invoke('welcome', welcome({ email: 'new@example.test' })), 'operation_conflict');
  t.check('email change did not increase welcome', await num(welcomeKeys.id) === 10);
  for (const marker of [`signup_bonus:${UID}`, 'email_bonus_claimed:dedicated@example.test']) {
    await reset();
    await redis(['SET', marker, '1']);
    await redis(['MSET', idKey, 81, gradeKey, 6]);
    const result = await invoke('welcome', welcome());
    t.check(`${marker.split(':')[0]} legacy marker suppresses grant`, !result.granted && result.id_delta === 0);
    t.check('standing balances retained, never migrated/reset', await num(idKey) === 81 && await num(gradeKey) === 6);
    t.check('legacy welcome marker never fabricates a new included allowance',
      await raw(welcomeKeys.id) === null && await raw(welcomeKeys.grade) === null);
  }
  await reset();
  const different = await Promise.all([
    invoke('welcome', welcome()), invoke('welcome', welcome({ owner: 'secondConcurrent' })),
  ]);
  t.check('two UIDs concurrently claiming same email yield one grant', different.filter(r => r.granted).length === 1);
  t.check('combined ID grant exactly ten across accounts',
    await num(welcomeKeys.id) + await num(membershipWelcomeKeys('secondConcurrent').id) === 10);
  await reset();
  await redis(['MSET', idKey, 81, gradeKey, 6]);
  let lost = true;
  await rejected('welcome response loss remains unknown', () => invoke('welcome', welcome(), async command => {
    const result = await redis(command);
    if (lost) { lost = false; throw new Error('synthetic lost response'); }
    return result;
  }), 'ledger_unavailable');
  await invoke('welcome', welcome());
  t.check('welcome lost-response replay preserves separate sources',
    await num(welcomeKeys.id) === 10 && await num(welcomeKeys.grade) === 1
    && await num(idKey) === 81 && await num(gradeKey) === 6);
  await redis(['MSET', welcomeKeys.id, 0, welcomeKeys.grade, 0]);
  await invoke('welcome', welcome());
  t.check('spent welcome is not restored by account or plan refresh',
    await num(welcomeKeys.id) === 0 && await num(welcomeKeys.grade) === 0);
  t.check('welcome marker and included balances have no expiry',
    (await redis(['TTL', welcomeKeys.id])) === -1 && (await redis(['TTL', welcomeKeys.grade])) === -1);
  await reset();
  const legacyCommand = [...prepareMembershipGrant('welcome', welcome()).command];
  legacyCommand[4] = idKey;
  legacyCommand[5] = gradeKey;
  const historical = JSON.parse(await redis(legacyCommand));
  const replay = await invoke('welcome', welcome());
  t.check('pre-separation journal replays without a new included grant',
    JSON.stringify(replay) === JSON.stringify(historical)
    && await raw(welcomeKeys.id) === null && await raw(welcomeKeys.grade) === null);
  t.check('pre-separation mixed standing balances are not moved or reduced',
    await num(idKey) === 10 && await num(gradeKey) === 1);
});

await t.section('invoice and paid-period uniqueness, usage and replay', async () => {
  await reset();
  await redis(['MSET', idKey, 17, gradeKey, 4]);
  const first = period();
  const invoices = await Promise.all(Array.from({ length: 12 }, (_, i) =>
    invoke('period', period(`in_concurrent${i}`))));
  t.check('different invoice IDs for same paid period allocate once', invoices.filter(r => r.granted).length === 1);
  t.check('same period has one allocation record', (await redis(['KEYS', 'membership:launch-v2:period:*'])).length === 1);
  const pk = keys('period', first)[3], activeKey = keys('period', first)[4];
  const record = await get(pk);
  t.check('Starter allowance matches central config', record.id_grant === 25 && record.grade_grant === 5);
  t.check('invoice allocations never merge into purchased balance', await num(idKey) === 17 && await num(gradeKey) === 4);
  // A persisted-use fixture isolates grant replay from the separately tested
  // consumption engine; no grant path may reset this historical usage.
  record.id_used = 7; record.grade_used = 2;
  await redis(['SET', pk, JSON.stringify(record)]);
  const spentBytes = await raw(pk);
  const again = await invoke('period', period('in_afterSpend'));
  t.check('another invoice does not refill spent allowance', !again.granted && await raw(pk) === spentBytes);
  const activeBytes = await raw(activeKey);
  const replay = await invoke('period', period('in_afterSpend'));
  t.check('same invoice result replays exactly', JSON.stringify(again) === JSON.stringify(replay));
  t.check('replay does not alter active paid-through state', await raw(activeKey) === activeBytes);
  await rejected('same invoice different owner denied', () => invoke('period', period('in_afterSpend', { owner: 'otherOwner' })), 'operation_conflict');
  await rejected('same invoice modified period denied', () => invoke('period', period('in_afterSpend', { periodEnd: now + 2000 })), 'operation_conflict');
  await rejected('different invoice conflicting plan for same period denied', () => invoke('period',
    period('in_differentPlan', { plan: 'casual', amountCents: 999 })), 'period_conflict');
  await rejected('subscription cannot bind to a second owner', () => invoke('period',
    period('in_otherOwner', { owner: 'otherOwner' })), 'subscription_conflict');
  t.check('denials do not reset use or balances', await raw(pk) === spentBytes && await num(idKey) === 17);
});

await t.section('all paid plans and immutable period allocation records', async () => {
  for (const [name, config] of Object.entries(LAUNCH_PLANS).filter(([name]) => name !== 'free')) {
    await reset();
    const input = period('in_plan', { plan: name, amountCents: config.monthlyPriceCents });
    const result = await invoke('period', input);
    t.check(`${name}: period grant uses central ID/grade allocation`,
      result.id_delta === config.idCredits && result.grade_delta === config.gradeCredits);
  }
  for (const field of ['plan', 'subscription', 'start', 'finish', 'id_grant', 'grade_grant', 'id_used', 'grade_used']) {
    await reset();
    await invoke('period', period());
    const pk = keys('period', period())[3];
    const corrupted = await get(pk);
    corrupted[field] = typeof corrupted[field] === 'number' ? -1 : 'corrupt';
    await redis(['SET', pk, JSON.stringify(corrupted)]);
    const before = await snapshot();
    await rejected(`corrupt period ${field} fails closed`, () => invoke('period',
      period('in_corruptRetry')), 'ledger_unavailable');
    t.check(`corrupt period ${field} is preserved, not repaired by grant`, await snapshot() === before);
  }
  await reset();
  await invoke('period', period());
  const pk = keys('period', period())[3];
  await redis(['DEL', pk]);
  const before = await snapshot();
  await rejected('lost active allocation is not a new period grant', () => invoke('period',
    period('in_missingAllocation')), 'ledger_unavailable');
  t.check('missing allocation never recreated to reset usage', await snapshot() === before);
});

await t.section('out-of-order, overlap, expiry and subscription transitions', async () => {
  await reset();
  const current = period('in_current', { periodStart: now - 50, periodEnd: now + 100 });
  const currentResult = await invoke('period', current);
  const activeKey = keys('period', current)[4], original = await raw(activeKey);
  const expired = period('in_old', { periodStart: now - 1000, periodEnd: now - 50 });
  const oldResult = await invoke('period', expired);
  t.check('older paid period may be journaled but never replaces newer state', oldResult.granted && !oldResult.active
    && await raw(activeKey) === original);
  t.check('current allocation remains current', currentResult.active && (await get(activeKey)).start === now - 50);
  const before = await snapshot();
  await rejected('overlapping period denied without double allowance', () => invoke('period',
    period('in_overlap', { periodStart: now - 75, periodEnd: now + 25 })), 'period_overlap');
  await rejected('future paid period is retriable, not activated early', () => invoke('period',
    period('in_future', { periodStart: now + 100, periodEnd: now + 200 })), 'period_not_started');
  await rejected('another subscription requires an explicit migration decision', () => invoke('period',
    period('in_differentSub', { subscriptionId: 'sub_other', periodStart: now - 50, periodEnd: now + 100 })), 'subscription_conflict');
  t.check('rejected transitions preserve every byte', await snapshot() === before);
  await reset();
  await redis(['MSET', idKey, 73, gradeKey, 19]);
  await invoke('period', expired);
  t.check('expired paid invoice retains latest-period pointer and issued credits',
    (await get(activeKey)).start === expired.periodStart
    && (await get(keys('period', expired)[3])).id_grant === 25);
  await invoke('period', current);
  t.check('newer paid period becomes current without overwriting historical allocation',
    (await get(activeKey)).start === current.periodStart
    && (await get(keys('period', current)[3])).id_used === 0
    && (await get(keys('period', current)[3])).id_grant === 25);
  t.check('period transition preserves purchased balances', await num(idKey) === 73 && await num(gradeKey) === 19);
  t.check('purchased balances and grant journals have no expiry',
    (await Promise.all((await redis(['KEYS', '*'])).map(key => redis(['TTL', key])))).every(ttl => ttl === -1));
});

await t.section('nonexpiring history atomic renewal, replay and missing-index refusal', async () => {
  await reset();
  const first = period('in_historyFirst', { periodStart: now - 1000, periodEnd: now - 100 });
  const second = period('in_historySecond', { periodStart: now - 100, periodEnd: now + 100 });
  await invoke('period', first);
  const firstKey = keys('period', first)[3], index = membershipIncludedHistoryKey(UID);
  const firstBytes = await raw(firstKey);
  const oldMarker = await raw(keys('period', first)[0]);
  const replies = await Promise.all(Array.from({ length: 12 }, () => invoke('period', second)));
  t.check('duplicate renewal stores exactly two indexed periods without rewriting first',
    replies.every(x => x.granted) && (await get(index)).count === 2 && await raw(firstKey) === firstBytes);
  t.check('older fulfillment result and journal remain exact on replay',
    (await invoke('period', first)).granted && await raw(keys('period', first)[0]) === oldMarker);
  await redis(['DEL', index]);
  const before = await snapshot();
  // Original completed invoice replay is still readable, but no new issuance
  // or balance reconstruction is allowed after provenance loss.
  t.check('completed fulfillment still replays despite missing new history', (await invoke('period', first)).granted);
  for (const candidate of [period('in_indexSame', { periodStart: now - 100, periodEnd: now + 100 }),
    period('in_indexNext', { periodStart: now - 1200, periodEnd: now - 1000 })]) {
    await rejected('new invoice cannot repair missing initialized history', () => invoke('period', candidate), 'ledger_unavailable');
  }
  t.check('missing history never overwrites original periods, markers or balances', await snapshot() === before);
  await reset();
  let lost = true;
  await rejected('paid renewal lost response preserves unknown outcome', () => invoke('period', first, async c => {
    const result = await redis(c); if (lost) { lost = false; throw new Error('synthetic response loss'); } return result;
  }), 'ledger_unavailable');
  const committed = await snapshot();
  t.check('paid renewal replay after response loss has no second history entry or grant',
    (await invoke('period', first)).granted && (await get(index)).count === 1 && await snapshot() === committed);
});

await t.section('NONEXPIRING-1 prior Free issuance cannot be erased by first paid grant', async () => {
  const consume = createMembershipConsumption({ execute: redis });
  const context = { owner: UID, receipt: 'a'.repeat(64), scan: 'history_control' };
  const enrollmentKey = membershipEnrollmentKey(UID);
  const historyKey = membershipIncludedHistoryKey(UID);
  const oldLua = MEMBERSHIP_LEDGER_SCRIPT.replace(
    /-- LATE_GRANT_HOLD:[\s\S]*?-- END_LATE_GRANT_HOLD\n/, '').replace(
    /    -- NONEXPIRING-1:[\s\S]*?    -- End NONEXPIRING-1 authority check\.\n/, '');
  t.check('negative control exactly matches reviewed failing nonexpiring Lua',
    sha(oldLua) === 'bcf5e94e2bf56fada0a7dfedfe656e2a88883b1d766df7264eed6b02ee06d269');
  async function seedFree() {
    await reset();
    await redis(['SET', 'membership:launch-v2:legacy_fence', '1']);
    await redis(['SET', enrollmentKey, JSON.stringify({ version: 'launch-v2',
      owner: UID, verified: true, plan: 'free', freeThrough: 0 })]);
    await consume('renew_free', context);
    const history = await get(historyKey), key = history.periods[0];
    return { key, bytes: await raw(key) };
  }
  const first = period('in_firstPaidAfterFree');
  let original = await seedFree();
  await redis(['DEL', historyKey]);
  await invoke('period', first, command => redis([command[0], oldLua, ...command.slice(2)]));
  await redis(['SET', enrollmentKey, JSON.stringify({ version: 'launch-v2', owner: UID,
    verified: true, plan: 'paid', subscription: first.subscriptionId })]);
  t.check('original reproduced: first paid replaces lost index and hides issued Free5',
    (await consume('snapshot', context)).monthly === 25
    && !(await get(historyKey)).periods.includes(original.key) && await raw(original.key) === original.bytes);
  original = await seedFree();
  await redis(['DEL', historyKey]);
  const before = await snapshot();
  await rejected('fixed first paid grant refuses lost initialized Free history',
    () => invoke('period', first), 'ledger_unavailable');
  t.check('refusal preserves every existing byte and creates no invoice, period or paid pointer',
    await snapshot() === before && await raw(original.key) === original.bytes
    && await raw(keys('period', first)[0]) === null && await raw(keys('period', first)[3]) === null
    && await raw(keys('period', first)[4]) === null && await raw(keys('period', first)[5]) === null);
  original = await seedFree();
  await invoke('period', first);
  const enrollment = await get(enrollmentKey);
  await redis(['SET', enrollmentKey, JSON.stringify({ ...enrollment, plan: 'paid', subscription: first.subscriptionId })]);
  t.check('intact-history transition retains all Free5 plus paid25, original Free bytes unchanged',
    (await consume('snapshot', context)).monthly === 30 && (await get(historyKey)).periods.includes(original.key)
    && await raw(original.key) === original.bytes);
  await reset();
  t.check('genuinely new paid owner still initializes paid25', (await invoke('period', first)).id_delta === 25
    && (await get(historyKey)).count === 1);
  await reset();
  await redis(['SET', enrollmentKey, JSON.stringify({ version: 'launch-v2', owner: UID,
    verified: true, plan: 'free', freeThrough: 0 })]);
  t.check('unissued Free enrollment can bootstrap first paid period without guessed prior credits',
    (await invoke('period', first)).id_delta === 25 && (await get(historyKey)).count === 1);
});

await t.section('concurrent real ID debit plus pack and welcome, no lost writes', async () => {
  await reset();
  await redis(['MSET', idKey, 100, gradeKey, 9]);
  const jobs = [];
  for (let i = 0; i < 20; i++) {
    const receipt = sha(`syntheticReceipt${i}`);
    jobs.push(redis(['EVAL', ID_BILLING_SCRIPT, 3, `id_billing:${receipt}`,
      `scans:${UID}:id_free_used_synthetic`, idKey, 'debit',
      JSON.stringify({ owner: UID, scan: `syntheticScan${i}`, mode: 'identify', receipt, grant: 0 }), 86400]));
    jobs.push(invoke('pack', pack(`pi_parallel${i}`)));
  }
  jobs.push(invoke('welcome', welcome()));
  await Promise.all(jobs);
  t.check('twenty original ID Lua debits and twenty packs preserve purchased accounting',
    await num(idKey) === 100 - 20 + 20 * 25);
  t.check('welcome independently grants included balances during purchased debits',
    await num(welcomeKeys.id) === 10 && await num(welcomeKeys.grade) === 1);
  t.check('purchased grade bucket unchanged by welcome', await num(gradeKey) === 9);
  t.check('twenty successful real ID reservations recorded',
    (await redis(['KEYS', 'id_billing:*'])).length === 20);
  t.check('twenty durable business payment journals recorded',
    (await redis(['KEYS', 'membership:launch-v2:payment:*'])).length === 20);
  // A distinct grading operation is outside this implementation. Native
  // atomic DECRBY here proves compatibility with atomic standing-grade spend,
  // NOT the safety of the current legacy grade handler's fallback GET/SET.
  await redis(['SET', gradeKey, 100]);
  await Promise.all(Array.from({ length: 10 }, (_, i) => [
    invoke('pack', pack(`pi_grade${i}`, { packId: 'grade_10', amountCents: 599 })),
    redis(['DECRBY', gradeKey, 2]),
  ]).flat());
  t.check('atomic grade spend and grade packs retain every delta', await num(gradeKey) === 100 + 100 - 20);
  t.check('grade grants do not touch purchased ID counter', await num(idKey) === 100 - 20 + 20 * 25);
});

await t.section('invalid envelopes never execute a command', async () => {
  const cases = [
    ['pack', pack(undefined, { paid: false }), 'unpaid_or_invalid_amount'],
    ['pack', pack(undefined, { amountCents: 1 }), 'amount_mismatch'],
    ['pack', pack(undefined, { amountCents: NaN }), 'unpaid_or_invalid_amount'],
    ['pack', pack(undefined, { currency: 'eur' }), 'unpaid_or_invalid_amount'],
    ['pack', pack(undefined, { plan: '__proto__' }), 'invalid_envelope'],
    ['pack', pack(undefined, { paymentId: 'evt_synthetic' }), 'invalid_envelope'],
    ['pack', pack(undefined, { paymentId: 'cs_synthetic' }), 'invalid_envelope'],
    ['pack', { ...pack(), redisKey: 'arbitrary' }, 'invalid_envelope'],
    ['pack', pack(undefined, { owner: 'bad\nowner' }), 'invalid_envelope'],
    ['period', period(undefined, { paid: false }), 'unpaid_or_invalid_amount'],
    ['period', period(undefined, { plan: 'free' }), 'invalid_envelope'],
    ['period', period(undefined, { periodEnd: now - 100 }), 'invalid_envelope'],
    ['welcome', welcome({ verified: false }), 'unverified'],
    ['welcome', welcome({ email: 'bad' }), 'invalid_envelope'],
  ];
  let calls = 0;
  for (const [kind, input, code] of cases) {
    await rejected(`${kind} invalid envelope ${calls}/${code}`, () =>
      invoke(kind, input, async () => { calls++; return '{}'; }), code);
  }
  t.check('all rejected before any Redis call', calls === 0);
  await rejected('missing adapter fails closed', () => grantMembership(null, 'pack', pack()), 'ledger_unavailable');
});

await t.section('exact decimal counter writes across representation boundaries', async () => {
  const max = 9007199254740990n; // declared Lua counter ceiling, not a new policy
  // Reconstruct and hash-pin the exact pre-fix exported script, not a simulated
  // JavaScript counter. It must reproduce the independent review's failure.
  const oldLua = MEMBERSHIP_LEDGER_SCRIPT.replace(
    /  if type\(value\)=='number' then[\s\S]*?  table\.insert\(writes,key\); table\.insert\(writes,value\)/,
    '  table.insert(writes,key); table.insert(writes,tostring(value))');
  t.check('current precision negative control restores unchecked tostring only',
    oldLua.includes('table.insert(writes,tostring(value))') && !oldLua.includes('invalid integer formatting'));
  await reset(); await redis(['SET', idKey, '100000000000000']);
  await invoke('pack', pack(), command => {
    const c = [...command]; c[1] = oldLua; return redis(c);
  });
  t.check('original Lua demonstrably stores rounded scientific notation',
    await raw(idKey) === '1.0000000000002e+14');
  await rejected('original output poisons the next distinct grant', () =>
    invoke('pack', pack('pi_originalSecond')), 'ledger_unavailable');
  for (const row of [
    { kind: 'ID', key: idKey, other: gradeKey, packId: 'id_25', amountCents: 299, quantity: 25n },
    { kind: 'Grade', key: gradeKey, other: idKey, packId: 'grade_10', amountCents: 599, quantity: 10n },
  ]) {
    for (const start of [99999999999999n, 100000000000000n, 1000000000000000n, max - 2n * row.quantity]) {
      await reset();
      await redis(['MSET', row.key, String(start), row.other, 7]);
      const fixture = id => pack(id, { packId: row.packId, amountCents: row.amountCents });
      const first = await invoke('pack', fixture('pi_boundaryFirst'));
      t.check(`${row.kind}/${start}: first grant writes exact decimal, never exponent`,
        await raw(row.key) === String(start + row.quantity));
      const second = await invoke('pack', fixture('pi_boundarySecond'));
      t.check(`${row.kind}/${start}: subsequent distinct grant succeeds exactly`,
        await raw(row.key) === String(start + 2n * row.quantity));
      const beforeReplay = await snapshot();
      const replay = await invoke('pack', fixture('pi_boundaryFirst'));
      t.check(`${row.kind}/${start}: replay does not refill or rewrite`,
        JSON.stringify(replay) === JSON.stringify(first) && await snapshot() === beforeReplay);
      t.check(`${row.kind}/${start}: unrelated bucket untouched and no TTL`,
        await raw(row.other) === '7' && await redis(['TTL', row.key]) === -1 && second.granted);
    }
    // Both current maximum and an unsupported value must reject before writing
    // a balance OR the new payment marker. BigInt makes expected bytes exact.
    for (const start of [max, max + 1n, max + 2n]) {
      await reset(); await redis(['MSET', row.key, String(start), row.other, 7]);
      const before = await snapshot();
      await rejected(`${row.kind}/${start}: overflow or unsupported range rejects`,
        () => invoke('pack', pack('pi_boundaryOverflow', { packId: row.packId, amountCents: row.amountCents })),
        'ledger_unavailable');
      t.check(`${row.kind}/${start}: every balance and marker unchanged`, await snapshot() === before);
    }
  }
  // Numeric formatting may itself differ/fail on a managed runtime. These
  // fixed fault shims verify failure is BEFORE the financial MSET, not a
  // speculative claim about the provider's implementation.
  for (const outcome of ["return nil", "return '1e+14'", "return '100000000000020'", "error('synthetic format failure')"]) {
    await reset(); await redis(['MSET', idKey, '100000000000000', gradeKey, 9]);
    const before = await snapshot();
    await rejected(`formatting fault ${outcome} fails closed`, () => invoke('pack', pack(), command => {
      const c = [...command];
      c[1] = `local nativeString=string; local string=setmetatable({format=function(...) ${outcome} end},{__index=nativeString})\n` + c[1];
      return redis(c);
    }), 'ledger_unavailable');
    t.check('formatting fault preserves all bytes and grant authority', await snapshot() === before);
  }
});

await t.section('corruption, overflow, result types and fail-closed storage', async () => {
  for (const value of ['-1', '1.5', '[]', 'nil', '9007199254740991']) {
    await reset(); await redis(['MSET', idKey, value, gradeKey, 9]);
    const before = await snapshot();
    await rejected(`counter ${value} rejected`, () => invoke('pack', pack()), 'ledger_unavailable');
    t.check(`counter ${value} preserves all data`, await snapshot() === before);
  }
  await reset(); await redis(['SET', idKey, '9007199254740990']);
  await rejected('overflow fails before marker or credit', () => invoke('pack', pack()), 'ledger_unavailable');
  t.check('overflow preserves starting integer', await raw(idKey) === '9007199254740990');
  for (const value of ['nil', '[]', '{"version":"other"}']) {
    await reset(); await redis(['SET', keys('pack', pack())[0], value]);
    const before = await snapshot();
    await rejected(`corrupt journal ${value} denied`, () => invoke('pack', pack()), 'ledger_unavailable');
    t.check('existing corruption not replaced with new fulfillment', await snapshot() === before);
  }
  await reset();
  await redis(['SET', keys('pack', pack())[0], 'nil']);
  const corruptBefore = await snapshot();
  await rejected('decoder returning nil cannot turn corrupt journal into missing grant', () =>
    invoke('pack', pack(), command => {
      const c = [...command];
      c[1] = "local native=cjson; local cjson={encode=native.encode,decode=function(v) if v=='nil' then return nil end return native.decode(v) end}\n" + c[1];
      return redis(c);
    }), 'ledger_unavailable');
  t.check('nil-decoder path preserves corrupt bytes with no grant', await snapshot() === corruptBefore);
  for (const response of [null, {}, 'null', '{}', '{"ok":true}', '{"ok":false,"code":"raw upstream error"}']) {
    await rejected('invalid adapter response fails closed', () => invoke('pack', pack(), async () => response), 'ledger_unavailable');
  }
  await reset();
  const command = keys('period', period());
  await redis(['SET', command[4], '{"version":"launch-v2","owner":"syntheticLedgerOwner","subscription":"sub_syntheticOne"}']);
  const before = await snapshot();
  await rejected('malformed active period fails closed', () => invoke('period', period()), 'ledger_unavailable');
  t.check('corrupt period does not grant or overwrite', await snapshot() === before);
});

await t.section('late-grant holds block only new exact payment or invoice issuance', async () => {
  for (const [kind, payload, businessId] of [['pack', pack(), pack().paymentId],
    ['period', period(), period().invoiceId]]) {
    await reset();
    const hold = membershipGrantHoldKey(kind, businessId);
    await redis(['SET', hold, 'nil']); // even malformed hold is fail-closed
    const before = await snapshot();
    await rejected(`${kind}: held grant rejected before mutation`, () => invoke(kind, payload), 'grant_held');
    t.check(`${kind}: hold blocks all grant marker/balance/period writes`, before === await snapshot());
    await reset();
    const original = await invoke(kind, payload);
    await redis(['SET', hold, '{"review_required":true}']);
    if (kind === 'pack') await redis(['SET', idKey, '7']); // simulate legitimate later spending
    const afterHold = await snapshot();
    t.check(`${kind}: existing journal replays exact result after hold`,
      JSON.stringify(await invoke(kind, payload)) === JSON.stringify(original));
    t.check(`${kind}: replay cannot recredit spent balances or erase originals`, afterHold === await snapshot());
    t.check(`${kind}: hold never expires`, await redis(['TTL', hold]) === -1);
  }
  await reset();
  await redis(['SET', membershipGrantHoldKey('pack', 'pi_held'), 'hold']);
  t.check('unrelated payment grants normally', (await invoke('pack', pack('pi_other'))).id_delta === 25);
  await redis(['SET', 'unused:9', 'hold']);
  t.check('welcome does not consult payment hold placeholder', (await invoke('welcome', welcome())).id_delta === 10);
  t.check('hold never debits unrelated balance', await num(idKey) === 25);
  await reset();
  const payload = pack('pi_race'), hold = membershipGrantHoldKey('pack', 'pi_race');
  const [outcome] = await Promise.allSettled([invoke('pack', payload), redis(['SET', hold, 'hold'])]);
  const current = await num(idKey);
  t.check('grant/hold race has only serialized allowed outcomes',
    (outcome.status === 'fulfilled' && current === 25)
    || (outcome.status === 'rejected' && outcome.reason.code === 'grant_held' && current === 0));
  const captured = await snapshot();
  if (outcome.status === 'fulfilled') await invoke('pack', payload);
  else await rejected('hold-first cannot later grant', () => invoke('pack', payload), 'grant_held');
  t.check('race retry leaves exact bytes unchanged', captured === await snapshot());
  const stripped = MEMBERSHIP_LEDGER_SCRIPT.replace(/-- LATE_GRANT_HOLD:[\s\S]*?-- END_LATE_GRANT_HOLD\n/, '');
  t.check('removing only additive hold guard recovers exact approved permanent-credit Lua',
    sha(stripped) === '950ce766d8b45dd90d84a1009ed8f49e00511b7142ca7594646dec056bb1019a');
});

t.done();
