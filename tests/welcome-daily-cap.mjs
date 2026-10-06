// Daily welcome circuit breaker on isolated local Redis with the unchanged ledger script.
import { readFileSync } from 'node:fs';
import { harness } from './_assert.mjs';
import { redisCommand as redis } from './_idRedis.mjs';
import { grantMembership, membershipWelcomeKeys, MEMBERSHIP_LEDGER_SCRIPT } from '../api/_membershipLedger.js';
import { membershipEnrollmentKey } from '../api/_membershipConsumption.js';
import { createMembershipEnrollmentFlow } from '../api/_membershipEnrollmentFlow.js';
import { withWelcomeDailyCap, welcomeDailyCap, welcomeDailyKey, welcomeDeferredKey,
  clearWelcomeDeferral, hasWelcomeDeferral, WELCOME_DAILY_CAP_DEFAULT } from '../api/_welcomeDailyCap.js';
const t = harness('welcome-daily-cap');
const uid = n => `capuser${String(n).padStart(20, '0')}`;
const env = n => ({ owner: uid(n), email: `cap${n}@example.test`, verified: true });
const award = async (n, cap) => {
  const r = await grantMembership(c => redis(withWelcomeDailyCap(c, { owner: uid(n), cap })), 'welcome', env(n));
  await clearWelcomeDeferral(redis, uid(n), r);
  return r;
};
const bal = async n => Number(await redis(['GET', membershipWelcomeKeys(uid(n)).id]) || 0);
const used = async () => Number(await redis(['GET', welcomeDailyKey()]) || 0);

await t.section('config parsing', async () => {
  t.check('default when unset', welcomeDailyCap(undefined) === WELCOME_DAILY_CAP_DEFAULT && WELCOME_DAILY_CAP_DEFAULT === 200);
  t.check('explicit value', welcomeDailyCap('50') === 50 && welcomeDailyCap(' 7 ') === 7);
  t.check('invalid/zero/negative/huge fall back to default (never unlimited, never zero)',
    ['0', '-5', 'abc', '1e3', '9999999', ''].every(v => welcomeDailyCap(v) === 200));
  t.check('daily key is UTC day', welcomeDailyKey(Date.UTC(2026, 9, 6, 3)) === 'membership:launch-v2:welcome_daily:20261006');
});

await t.section('cap of 2: two awards, third deferred without claim marker', async () => {
  await redis(['FLUSHALL']);
  const a = await award(1, 2), b = await award(2, 2), c = await award(3, 2);
  t.check('first two granted 10 ID each', a.granted && b.granted && await bal(1) === 10 && await bal(2) === 10);
  t.check('third deferred, no balance, no claim markers', c.granted === false && c.deferred === true && await bal(3) === 0
    && await redis(['EXISTS', `signup_bonus:${uid(3)}`]) === 0 && await redis(['EXISTS', 'email_bonus_claimed:cap3@example.test']) === 0);
  t.check('deferred marker set only for third', await hasWelcomeDeferral(redis, uid(3)) && !await hasWelcomeDeferral(redis, uid(1)));
  t.check('counter counts only new awards', await used() === 2);
  t.check('counter expires', Number(await redis(['TTL', welcomeDailyKey()])) > 0);
});

await t.section('replays and already-claimed accounts never consume the cap', async () => {
  const r1 = await award(1, 2), r2 = await award(1, 2);
  t.check('replay of granted account returns original grant, no new credit', r1.granted && r2.granted && await bal(1) === 10);
  t.check('counter unchanged by replays even at cap', await used() === 2);
  await redis(['SET', `signup_bonus:${uid(9)}`, '1']);
  const legacy = await award(9, 2);
  t.check('legacy-claimed account at cap is not deferred', legacy.granted === false && legacy.deferred !== true
    && !await hasWelcomeDeferral(redis, uid(9)) && await used() === 2);
});

await t.section('deferred account is awarded once on a later day / higher cap', async () => {
  await redis(['DEL', welcomeDailyKey()]); // simulate a new UTC day
  const r = await award(3, 2);
  t.check('deferred account now granted exactly once', r.granted && await bal(3) === 10 && await used() === 1);
  t.check('deferral cleared', !await hasWelcomeDeferral(redis, uid(3)));
  const again = await award(3, 2);
  t.check('no second award', again.granted && await bal(3) === 10 && await used() === 1);
});

await t.section('concurrency: 20 simultaneous new accounts, cap 5', async () => {
  await redis(['FLUSHALL']);
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => award(100 + i, 5)));
  const granted = rs.filter(r => r.granted).length, deferred = rs.filter(r => r.deferred).length;
  t.check('exactly 5 granted, 15 deferred', granted === 5 && deferred === 15 && await used() === 5);
  let total = 0; for (let i = 0; i < 20; i++) total += await bal(100 + i);
  t.check('exactly 50 welcome ID credits issued', total === 50);
});

await t.section('enrollment flow path uses the same breaker', async () => {
  await redis(['FLUSHALL']);
  await redis(['SET', 'membership:launch-v2:legacy_fence', '1']);
  const flow = createMembershipEnrollmentFlow({ execute: redis, provision: async () => {}, bootstrap: async () => {},
    issueFree: async () => ({ status: 'issued' }) });
  process.env.WELCOME_DAILY_CAP = '1';
  try {
    for (const n of [201, 202]) await redis(['SET', membershipEnrollmentKey(uid(n)), JSON.stringify({
      version: 'launch-v2', owner: uid(n), plan: 'free', verified: true, freeThrough: 0, capabilities: { bulkGrade: false } })]);
    const a = await flow(uid(201), { uid: uid(201), verified: true, email: 'cap201@example.test' });
    const b = await flow(uid(202), { uid: uid(202), verified: true, email: 'cap202@example.test' });
    t.check('first enrollment welcomed', a.status === 'free_ready' && a.welcome === true && await bal(201) === 10);
    t.check('second enrollment ready but deferred', b.status === 'free_ready' && b.welcome === false && b.welcomeDeferred === true
      && await bal(202) === 0 && await hasWelcomeDeferral(redis, uid(202)));
    process.env.WELCOME_DAILY_CAP = '2';
    const c = await flow(uid(202), { uid: uid(202), verified: true, email: 'cap202@example.test' });
    t.check('retry after room awards once and clears', c.welcome === true && await bal(202) === 10 && !await hasWelcomeDeferral(redis, uid(202)));
    await redis(['DEL', membershipEnrollmentKey(uid(203))]);
    let notReady = false;
    try { await flow(uid(203), { uid: uid(203), verified: true, email: 'cap203@example.test' }); } catch { notReady = true; }
    t.check('unready enrollment fails before counting', notReady && await used() === 2);
  } finally { delete process.env.WELCOME_DAILY_CAP; }
});

await t.section('wiring', async () => {
  const src = f => readFileSync(new URL(`../api/${f}`, import.meta.url), 'utf8');
  t.check('ledger script unchanged by wrapper', !MEMBERSHIP_LEDGER_SCRIPT.includes('welcome_daily'));
  t.check('verification path wrapped + cleared', /withWelcomeDailyCap\(prepared/.test(src('_membershipRouteBilling.js'))
    && src('_membershipRouteBilling.js').includes('clearWelcomeDeferral(membershipRedis, owner, result)'));
  t.check('enrollment path wrapped + cleared', /withWelcomeDailyCap\(prepared/.test(src('_membershipEnrollmentFlow.js'))
    && src('_membershipEnrollmentFlow.js').includes('clearWelcomeDeferral(execute, owner, welcome)'));
  t.check('account read retries deferred welcome without failing', src('_membershipAccountRoutes.js').includes('try { await retryWelcome(uid, identity); } catch {}')
    && src('_membershipPurchaseRuntime.js').includes('hasWelcomeDeferral(membershipRedis, owner)'));
  t.check('verify routes report deferral', ['verify-confirm.js', 'verify-claim-firebase.js'].every(f => src(f).includes("'welcome-deferred'")));
  t.check('deferred key is hashed, never raw uid', !welcomeDeferredKey('abc').includes('abc'));
});
await t.done();
