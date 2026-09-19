// Dormant store only: real Lua on a private Redis Unix socket, no external calls.
// Stripe/auth/permission remain trusted server dependency boundaries.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { harness } from './_assert.mjs';
import { redisCommand as redis } from './_idRedis.mjs';
import { createMembershipBindingStore, newMembershipIntentId, MEMBERSHIP_BINDINGS_SCRIPT } from '../api/_membershipBindings.js';
import { LAUNCH_PLANS, LAUNCH_PACKS, quoteLaunchPack } from '../api/_launchMembershipConfig.js';
import { createMembershipPaymentAdapter } from '../api/_membershipPayments.js';
import { grantMembership } from '../api/_membershipLedger.js';

const t = harness('membership-bindings');
const sha = x => createHash('sha256').update(x).digest('hex');
const PREFIX = 'membership:launch-v2:bindings:';
const prices = { packs: {}, plans: {} };
for (const [group, catalog] of [['packs', LAUNCH_PACKS], ['plans', LAUNCH_PLANS]]) {
  for (const name of Object.keys(catalog)) {
    if (name === 'free') continue;
    prices[group][name] = { priceId: `price_${group}_${name}`, productId: `prod_${group}_${name}` };
  }
}
const factory = (extra = {}) => createMembershipBindingStore({
  execute: redis, accountId: 'acct_synthetic', livemode: false, priceMap: prices, ...extra,
});
const store = factory();
const input = (name = 'one', extra = {}) => ({
  intentId: sha(name), kind: 'pack', owner: 'syntheticOwner', customerId: 'cus_synthetic',
  plan: 'casual', packId: 'id_25', ...extra,
});
const raw = key => redis(['GET', key]);
const reset = () => redis(['FLUSHDB']); // only this process's isolated Redis
const keys = () => redis(['KEYS', '*']);
const snapshot = async () => JSON.stringify(await Promise.all((await keys()).sort()
  .map(async k => [k, await raw(k), await redis(['PTTL', k])])));
async function reject(label, fn, code) {
  try { await fn(); t.check(label, false, 'unexpected success'); }
  catch (e) { t.check(label, code ? e.code === code : typeof e.code === 'string', `actual ${e.code}`); }
}
async function noWrite(label, fn, code) {
  const before = await snapshot(); await reject(label, fn, code);
  t.check(`${label}: every stored byte and TTL unchanged`, await snapshot() === before);
}
async function pack(name = 'one', target = store) {
  const p = input(name); await target.createIntent(p);
  await target.bindSession({ intentId: p.intentId, sessionId: `cs_${name}` });
  await target.bindSettlement({ intentId: p.intentId, sessionId: `cs_${name}`, paymentId: `pi_${name}` });
  return p;
}
async function subscription(name = 'sub', target = store) {
  const p = input(name, { kind: 'subscription', packId: null });
  await target.createIntent(p); await target.bindSession({ intentId: p.intentId, sessionId: `cs_${name}` });
  await target.bindSettlement({ intentId: p.intentId, sessionId: `cs_${name}`, subscriptionId: `sub_${name}` });
  return p;
}
const term = (p, start = 1800000000, end = start + 2600000, plan = 'casual') => ({
  originIntentId: p.intentId, subscriptionId: 'sub_sub', plan,
  effectiveFrom: start, effectiveUntil: end, authorizationId: sha(`approved-synthetic-${start}-${plan}`),
});
const action = args => JSON.parse(args.at(-1)).action;

await t.section('Trusted immutable intent and recoverable checkout lifecycle', async () => {
  await reset();
  const fresh = newMembershipIntentId();
  t.check('Cryptographic intent shape', /^[a-f0-9]{64}$/.test(fresh));
  t.check('Separate random intent', fresh !== newMembershipIntentId());
  const p = input(), order = await store.createIntent(p), initial = await snapshot();
  t.check('Server quote and identifiers', order.amountCents === quoteLaunchPack('id_25', 'casual').amountCents
    && order.priceId === prices.packs.id_25.priceId && order.productId === prices.packs.id_25.productId);
  t.check('Stable provider idempotency key', order.stripeIdempotencyKey === `membership-launch-v2-${p.intentId}`);
  t.check('Intent saved before any session exists', (await store.inspectIntent(p.intentId)).state === 'intent_persisted');
  await store.createIntent(p);
  t.check('Create-once replay preserves bytes', await snapshot() === initial);
  for (const [field, value] of Object.entries({ owner: 'anotherOwner', customerId: 'cus_other', plan: 'pro', packId: 'id_100' })) {
    await noWrite(`Conflicting ${field}`, () => store.createIntent({ ...p, [field]: value }));
  }
  for (const [field, value] of Object.entries({ amountCents: 1, priceId: 'price_client', productId: 'prod_client', metadata: { tier: 'business' } })) {
    await noWrite(`Caller cannot supply ${field}`, () => store.createIntent({ ...p, [field]: value }), 'invalid_binding');
  }
  for (const override of [{ accountId: 'acct_other' }, { livemode: true }]) {
    await noWrite(`Conflict ${Object.keys(override)[0]}`, () => factory(override).createIntent(p), 'binding_conflict');
  }
  for (const field of ['priceId', 'productId']) {
    const changed = structuredClone(prices); changed.packs.id_25[field] += '_changed';
    await noWrite(`Trusted map ${field} conflict`, () => factory({ priceMap: changed }).createIntent(p), 'binding_conflict');
  }
  await noWrite('Customer cannot be rebound to another UID', () => store.createIntent(input('other', { owner: 'other' })), 'mapping_conflict');
  await store.bindSession({ intentId: p.intentId, sessionId: 'cs_one' });
  t.check('Recovery discovers recorded session', (await store.inspectIntent(p.intentId)).state === 'session_bound');
  await noWrite('Pending payment cannot reach adapter', () => store.getCheckoutOrder('cs_one'), 'settlement_pending');
  await store.bindSettlement({ intentId: p.intentId, sessionId: 'cs_one', paymentId: 'pi_one' });
  t.check('Recovery discovers canonical settlement', (await store.inspectIntent(p.intentId)).state === 'canonical_bound');
  const binding = await store.getCheckoutOrder('cs_one');
  for (const field of ['owner', 'accountId', 'livemode', 'customerId', 'packId', 'priceId', 'currency', 'amountCents']) {
    t.check(`Adapter order field ${field}`, binding[field] === order[field]);
  }
  t.check('Adapter session/payment pair', binding.sessionId === 'cs_one' && binding.paymentId === 'pi_one');
  t.check('Unknown session is absent', await store.getCheckoutOrder('cs_missing') === null);
});

await t.section('Canonical mapping uniqueness, replay and no repair', async () => {
  await reset(); const p = await pack(), before = await snapshot();
  await store.bindSession({ intentId: p.intentId, sessionId: 'cs_one' });
  await store.bindSettlement({ intentId: p.intentId, sessionId: 'cs_one', paymentId: 'pi_one' });
  t.check('Session and settlement exact replay preserve all bytes', await snapshot() === before);
  await noWrite('Different session same intent', () => store.bindSession({ intentId: p.intentId, sessionId: 'cs_other' }), 'binding_conflict');
  await noWrite('Different payment same intent', () => store.bindSettlement({ intentId: p.intentId, sessionId: 'cs_one', paymentId: 'pi_other' }), 'binding_conflict');
  const other = input('other'); await store.createIntent(other);
  await noWrite('Session mapped only once', () => store.bindSession({ intentId: other.intentId, sessionId: 'cs_one' }), 'mapping_conflict');
  await store.bindSession({ intentId: other.intentId, sessionId: 'cs_other' });
  await noWrite('Payment mapped only once', () => store.bindSettlement({ intentId: other.intentId, sessionId: 'cs_other', paymentId: 'pi_one' }), 'mapping_conflict');
  await noWrite('Pack cannot bind subscription', () => store.bindSettlement({ intentId: other.intentId, sessionId: 'cs_other', subscriptionId: 'sub_bad' }), 'invalid_binding');
  const s = await subscription(), s2 = input('sub2', { kind: 'subscription', packId: null });
  await store.createIntent(s2); await store.bindSession({ intentId: s2.intentId, sessionId: 'cs_sub2' });
  await noWrite('Subscription mapped only once', () => store.bindSettlement({ intentId: s2.intentId, sessionId: 'cs_sub2', subscriptionId: 'sub_sub' }), 'mapping_conflict');
  await noWrite('Subscription cannot bind pack payment', () => store.bindSettlement({ intentId: s.intentId, sessionId: 'cs_sub', paymentId: 'pi_bad' }), 'invalid_binding');
  const alias = (await keys()).find(k => k.includes(':payment_map:'));
  await redis(['DEL', alias]);
  await noWrite('Read refuses missing payment alias', () => store.getCheckoutOrder('cs_one'), 'corrupt_mapping');
  await noWrite('Recovery refuses missing payment alias', () => store.inspectIntent(p.intentId), 'corrupt_mapping');
  await noWrite('Replay does not silently repair alias', () => store.bindSettlement({ intentId: p.intentId, sessionId: 'cs_one', paymentId: 'pi_one' }), 'corrupt_mapping');
});

await t.section('Concurrent creation and committed response loss', async () => {
  await reset(); const p = input();
  const results = await Promise.all(Array.from({ length: 20 }, () => store.createIntent(p)));
  t.check('20 concurrent creates return same immutable order', results.every(x => JSON.stringify(x) === JSON.stringify(results[0])));
  t.check('One order and one customer record', (await keys()).length === 2);
  await Promise.all(Array.from({ length: 20 }, () => store.bindSession({ intentId: p.intentId, sessionId: 'cs_one' })));
  t.check('One session record and one alias', (await keys()).length === 4);
  await Promise.all(Array.from({ length: 20 }, () => store.bindSettlement({ intentId: p.intentId, sessionId: 'cs_one', paymentId: 'pi_one' })));
  t.check('One settlement record and one alias', (await keys()).length === 6);
  for (const stage of ['intent', 'session', 'settlement', 'term']) {
    await reset(); let dropped = false;
    const lossy = factory({ execute: async args => {
      const response = await redis(args);
      if (action(args) === stage && !dropped) { dropped = true; throw new Error('synthetic lost response'); }
      return response;
    } });
    let invoke;
    if (stage === 'intent') invoke = () => lossy.createIntent(p);
    if (stage === 'session') {
      await store.createIntent(p); invoke = () => lossy.bindSession({ intentId: p.intentId, sessionId: 'cs_one' });
    }
    if (stage === 'settlement') {
      await store.createIntent(p); await store.bindSession({ intentId: p.intentId, sessionId: 'cs_one' });
      invoke = () => lossy.bindSettlement({ intentId: p.intentId, sessionId: 'cs_one', paymentId: 'pi_one' });
    }
    if (stage === 'term') { const s = await subscription(); invoke = () => lossy.createTerm(term(s)); }
    await reject(`${stage} response loss reported unknown`, invoke, 'store_unavailable');
    const committed = await snapshot(); await invoke();
    t.check(`${stage} retry returns existing durable result without extra writes`, committed === await snapshot());
  }
});

await t.section('Historical effective terms and ordered period lookup', async () => {
  await reset(); const s = await subscription();
  const early = term(s), later = term(s, early.effectiveUntil, early.effectiveUntil + 2600000, 'pro');
  await store.createTerm(later); const laterBytes = await raw((await keys()).find(k => k.includes(':term:')));
  await store.createTerm(early);
  const replayBytes = await snapshot(); await store.createTerm(early);
  t.check('Historical exact term replay no mutation', await snapshot() === replayBytes);
  t.check('Out-of-order earlier term leaves newer immutable bytes', (await Promise.all((await keys()).map(raw))).includes(laterBytes));
  for (const [when, expected] of [[early.effectiveFrom - 1, null], [early.effectiveFrom, 'casual'],
    [early.effectiveUntil - 1, 'casual'], [early.effectiveUntil, 'pro'], [later.effectiveUntil, null]]) {
    t.check(`Period boundary ${when}`, (await store.getSubscriptionTerm('sub_sub', when))?.plan === expected
      || expected === null && await store.getSubscriptionTerm('sub_sub', when) === null);
  }
  for (const field of ['plan', 'authorizationId']) {
    const changed = { ...early, [field]: field === 'plan' ? 'business' : sha('other-authorization') };
    await noWrite(`Historical ${field} immutable`, () => store.createTerm(changed), 'binding_conflict');
  }
  await noWrite('Overlapping range refused', () => store.createTerm(term(s, early.effectiveFrom + 1, early.effectiveUntil + 1)), 'term_overlap');
  await noWrite('No open-ended inferred renewal', () => store.createTerm({ ...early, effectiveUntil: null }), 'invalid_binding');
  await noWrite('Unknown client amount refused', () => store.createTerm({ ...early, amountCents: 1 }), 'invalid_binding');
  t.check('No automatic terms for unknown subscription', await store.getSubscriptionTerm('sub_unknown', early.effectiveFrom) === null);
  t.check('Terms and orders never expire', (await Promise.all((await keys()).map(k => redis(['TTL', k])))).every(x => x === -1));
});

await t.section('Concurrent term appends cannot lose index entries', async () => {
  await reset(); const s = await subscription(), a = term(s);
  await Promise.all(Array.from({ length: 12 }, () => store.createTerm(a)));
  t.check('Concurrent identical term exactly once', (await keys()).filter(k => k.includes(':term:')).length === 1);
  const b = term(s, a.effectiveUntil), c = term(s, b.effectiveUntil);
  const out = await Promise.allSettled([store.createTerm(b), store.createTerm(c)]);
  t.check('Concurrent different terms success or explicit retry conflict', out.every(r => r.status === 'fulfilled' || r.reason.code === 'index_changed'));
  for (let i = 0; i < out.length; i++) if (out[i].status === 'rejected') await store.createTerm([b, c][i]);
  t.check('All three terms retained', (await keys()).filter(k => k.includes(':term:')).length === 3);
  for (const x of [a, b, c]) t.check(`Retained lookup ${x.effectiveFrom}`, (await store.getSubscriptionTerm('sub_sub', x.effectiveFrom)).effectiveFrom === x.effectiveFrom);
});

await t.section('Mandatory initialized history never implicitly resets after loss', async () => {
  for (const withTerm of [false, true]) {
    for (const missing of [['term_index'], ['history_authority'], ['term_index', 'history_authority']]) {
      await reset(); const s = await subscription(), a = term(s, 1800000000, 1800002000);
      if (withTerm) await store.createTerm(a);
      const label = `${withTerm ? 'populated' : 'empty'} history missing ${missing.join('+')}`;
      for (const kind of missing) await redis(['DEL', ...(await keys()).filter(k => k.includes(`:${kind}:`))]);
      await noWrite(`${label}: lookup reports corruption`, () => store.getSubscriptionTerm('sub_sub', a.effectiveFrom), 'corrupt_mapping');
      await noWrite(`${label}: overlapping append refused`, () => store.createTerm(term(s, 1800001000, 1800003000)), 'corrupt_mapping');
      await noWrite(`${label}: nonoverlapping append refused`, () => store.createTerm(term(s, 1800003000, 1800004000)), 'corrupt_mapping');
      await noWrite(`${label}: settlement replay cannot reinitialize`, () => store.bindSettlement({
        intentId: s.intentId, sessionId: 'cs_sub', subscriptionId: 'sub_sub',
      }), 'corrupt_mapping');
      await noWrite(`${label}: recovery inspection fails closed`, () => store.inspectIntent(s.intentId), 'corrupt_mapping');
    }
  }
  await reset(); const s = await subscription();
  const initialIndex = (await keys()).find(k => k.includes(':term_index:'));
  const initialAuthority = (await keys()).find(k => k.includes(':history_authority:'));
  t.check('Subscription binding atomically initializes authority and empty index', Boolean(initialIndex && initialAuthority)
    && JSON.parse(await raw(initialIndex)).data.entries === false);
  t.check('Known intact empty history is legitimately absent entitlement', await store.getSubscriptionTerm('sub_sub', 1800000000) === null);
  const before = await snapshot();
  await store.bindSettlement({ intentId: s.intentId, sessionId: 'cs_sub', subscriptionId: 'sub_sub' });
  t.check('Empty-history settlement replay preserves all bytes', await snapshot() === before);
  await store.createTerm(term(s));
  t.check('First term replaces explicit empty index but never authority', (await raw(initialAuthority)) === JSON.parse(before)
    .find(([key]) => key === initialAuthority)[1]);
  for (const retained of [['history_authority'], ['term_index'], ['history_authority', 'term_index']]) {
    await reset(); const orphan = await subscription();
    const remove = (await keys()).filter(k => k.includes(':settlement:') || k.includes(':subscription_map:')
      || ['history_authority', 'term_index'].some(kind => !retained.includes(kind) && k.includes(`:${kind}:`)));
    await redis(['DEL', ...remove]);
    await noWrite(`Orphan ${retained.join('+')} cannot initialize a new subscription binding`, () => store.bindSettlement({
      intentId: orphan.intentId, sessionId: 'cs_sub', subscriptionId: 'sub_sub',
    }), 'corrupt_mapping');
    await noWrite(`Orphan ${retained.join('+')} cannot masquerade as unknown subscription`, () =>
      store.getSubscriptionTerm('sub_sub', 1800000000), 'corrupt_mapping');
  }
});

await t.section('History initialization concurrency and serialization are atomic', async () => {
  await reset(); const s = input('sub', { kind: 'subscription', packId: null });
  await store.createIntent(s); await store.bindSession({ intentId: s.intentId, sessionId: 'cs_sub' });
  const bind = target => target.bindSettlement({ intentId: s.intentId, sessionId: 'cs_sub', subscriptionId: 'sub_sub' });
  await Promise.all(Array.from({ length: 12 }, () => bind(store)));
  t.check('Concurrent initialization has exactly one authority and one index', (await keys()).length === 8
    && (await keys()).filter(k => k.includes(':history_authority:')).length === 1
    && (await keys()).filter(k => k.includes(':term_index:')).length === 1);
  const initialized = await snapshot();
  await Promise.all(Array.from({ length: 12 }, () => bind(store)));
  t.check('Concurrent initialization replay cannot reset index', initialized === await snapshot());

  await reset(); await store.createIntent(s); await store.bindSession({ intentId: s.intentId, sessionId: 'cs_sub' });
  let release, entered;
  const paused = new Promise(resolve => { entered = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  const gated = factory({ execute: async args => {
    if (action(args) === 'settlement') { entered(); await resume; }
    return redis(args);
  } });
  const pending = bind(gated); await paused;
  await noWrite('First term while initialization not committed cannot manufacture history', () => store.createTerm(term(s)), 'binding_missing');
  release(); await pending;
  await store.createTerm(term(s));
  t.check('Explicit retry after initialization creates first term', (await store.getSubscriptionTerm('sub_sub', 1800000000)).plan === 'casual');

  for (const kind of ['history_authority', 'term_index']) {
    await reset(); await store.createIntent(s); await store.bindSession({ intentId: s.intentId, sessionId: 'cs_sub' });
    const faulty = factory({ execute: args => action(args) !== 'settlement' ? redis(args) : redis([args[0],
      `local native=cjson\nlocal cjson={decode=native.decode,encode=function(v) if v.kind=='${kind}' then return nil end return native.encode(v) end}\n${args[1]}`,
      ...args.slice(2)]) });
    await noWrite(`Initialization ${kind} encoding failure preserves unbound state`, () => bind(faulty), 'store_unavailable');
  }
  await reset(); await store.createIntent(s); await store.bindSession({ intentId: s.intentId, sessionId: 'cs_sub' });
  let dropped = false;
  const lossy = factory({ execute: async args => {
    const result = await redis(args);
    if (action(args) === 'settlement' && !dropped) { dropped = true; throw new Error('synthetic response loss'); }
    return result;
  } });
  await reject('Lost initialization response reports unknown', () => bind(lossy), 'store_unavailable');
  const committed = await snapshot(); await bind(lossy);
  t.check('Lost initialization retry preserves one complete history', await snapshot() === committed
    && (await keys()).length === 8);
});

await t.section('Finite bounded history and server configuration', async () => {
  await reset(); const s = await subscription();
  for (let i = 0; i < 128; i++) await store.createTerm(term(s, 1800000000 + i * 1000, 1800001000 + i * 1000));
  t.check('128 immutable terms retained', (await keys()).filter(k => k.includes(':term:')).length === 128);
  await noWrite('129th history entry fails closed', () => store.createTerm(term(s, 1800128000, 1800129000)), 'term_limit');
  const before = await snapshot(); await store.createTerm(term(s, 1800000000, 1800001000));
  t.check('Existing term replays at capacity', await snapshot() === before);
  for (const bad of [
    { ...prices, packs: {} },
    { ...prices, packs: { ...prices.packs, id_25: { ...prices.packs.id_25, owner: 'injected' } } },
  ]) await reject('Malformed trusted map rejected', async () => factory({ priceMap: bad }), 'store_configuration');
  const mutable = structuredClone(prices), safe = factory({ priceMap: mutable });
  mutable.packs.id_25.priceId = 'price_changed';
  const order = await safe.createIntent(input('copy'));
  t.check('Configuration snapshotted independently', order.priceId === prices.packs.id_25.priceId);
});

await t.section('Malformed persistence and reference loss fail closed', async () => {
  for (const corruption of ['nil', '{}', '{"version":"launch-v2","kind":"order","data":{},"hash":"bad"}']) {
    await reset(); const p = input(); await store.createIntent(p);
    await redis(['SET', `${PREFIX}order:${p.intentId}`, corruption]);
    await noWrite(`Malformed order ${corruption.length} read`, () => store.getIntent(p.intentId));
    await noWrite(`Malformed order ${corruption.length} cannot become new intent`, () => store.createIntent(p));
    await noWrite(`Malformed order ${corruption.length} cannot create session`, () => store.bindSession({ intentId: p.intentId, sessionId: 'cs_one' }));
  }
  for (const damage of ['term', 'term_index', 'customer', 'session_map']) {
    await reset(); const s = await subscription(), a = term(s); await store.createTerm(a);
    const k = (await keys()).find(k => k.includes(`:${damage}:`));
    if (damage === 'term_index') await redis(['SET', k, 'nil']);
    else await redis(['DEL', k]);
    await noWrite(`Damaged ${damage} lookup`, () => store.getSubscriptionTerm('sub_sub', a.effectiveFrom));
    await noWrite(`Damaged ${damage} cannot append`, () => store.createTerm(term(s, a.effectiveUntil)));
  }
  await reset(); const s = await subscription(), a = term(s); await store.createTerm(a);
  let interfered = false;
  const race = factory({ execute: async args => {
    if (action(args) === 'term' && !interfered) {
      interfered = true;
      await redis(['SET', (await keys()).find(k => k.includes(':term:')), 'nil']);
    }
    return redis(args);
  } });
  await reject('Reference changed after JS validation rejected inside EVAL', () => race.createTerm(term(s, a.effectiveUntil)));
  t.check('Interleaving did not add term', (await keys()).filter(k => k.includes(':term:')).length === 1);
});

await t.section('Every encoding stage validated before any write', async () => {
  for (const stage of ['intent', 'session', 'settlement', 'term']) {
    for (const fault of ['nil', 'malformed', 'changed', 'throw']) {
      await reset(); const p = input(); let invoke;
      const faulty = factory({ execute: args => {
        if (action(args) !== stage) return redis(args);
        const bad = fault === 'nil' ? 'return nil' : fault === 'malformed' ? `return 'nil'`
          : fault === 'changed' ? `return '{}'` : `error('synthetic encoder failure')`;
        const prelude = `local native=cjson\nlocal cjson={decode=native.decode,encode=function(v) ${bad} end}\n`;
        return redis([args[0], prelude + args[1], ...args.slice(2)]);
      } });
      if (stage === 'intent') invoke = () => faulty.createIntent(p);
      if (stage === 'session') {
        await store.createIntent(p); invoke = () => faulty.bindSession({ intentId: p.intentId, sessionId: 'cs_one' });
      }
      if (stage === 'settlement') {
        await store.createIntent(p); await store.bindSession({ intentId: p.intentId, sessionId: 'cs_one' });
        invoke = () => faulty.bindSettlement({ intentId: p.intentId, sessionId: 'cs_one', paymentId: 'pi_one' });
      }
      if (stage === 'term') { const s = await subscription(); invoke = () => faulty.createTerm(term(s)); }
      await noWrite(`${stage} ${fault} encoding`, invoke, 'store_unavailable');
    }
  }
  await reset();
  const p = input();
  // Fault only the final response after both prospective values have encoded.
  const finalFault = factory({ execute: args => action(args) !== 'intent' ? redis(args) : redis([args[0],
    `local native=cjson\nlocal cjson={decode=native.decode,encode=function(v) if v.ok==true then return nil end return native.encode(v) end}\n${args[1]}`,
    ...args.slice(2)]) });
  await noWrite('Final response encode failure cannot commit queued records', () => finalFault.createIntent(p), 'store_unavailable');
  const secondFault = factory({ execute: args => action(args) !== 'intent' ? redis(args) : redis([args[0],
    `local native=cjson\nlocal cjson={decode=native.decode,encode=function(v) if v.kind=='customer' then return nil end return native.encode(v) end}\n${args[1]}`,
    ...args.slice(2)]) });
  await noWrite('Alias encoding failure cannot commit already serialized order', () => secondFault.createIntent(p), 'store_unavailable');
  const wrongType = factory({ execute: async () => ({ ok: true }) });
  await noWrite('Unexpected executor response type fails closed', () => wrongType.createIntent(p), 'store_unavailable');
});

await t.section('Real approved adapter and ledger use durable bindings', async () => {
  await reset(); const p = await pack(), s = await subscription();
  const now = Number((await redis(['TIME']))[0]);
  const authorized = term(s, now - 100, now + 1000); await store.createTerm(authorized);
  const quote = quoteLaunchPack('id_25', 'casual'), monthly = LAUNCH_PLANS.casual.monthlyPriceCents;
  const list = x => ({ object: 'list', has_more: false, data: [x] });
  let event;
  const stripe = {
    retrieveAccount: async () => ({ object: 'account', id: 'acct_synthetic' }),
    retrieveCheckoutSession: async id => ({
      object: 'checkout.session', id, livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid',
      customer: p.customerId, subscription: null, currency: 'usd', amount_total: quote.amountCents,
      amount_subtotal: quote.basePriceCents, payment_intent: 'pi_one',
      total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: quote.basePriceCents - quote.amountCents },
    }),
    listCheckoutLineItems: async () => list({ quantity: 1, currency: 'usd', amount_subtotal: quote.basePriceCents,
      amount_total: quote.amountCents, price: prices.packs.id_25.priceId }),
    retrievePaymentIntent: async id => ({ object: 'payment_intent', id, livemode: false, status: 'succeeded',
      currency: 'usd', amount: quote.amountCents, amount_received: quote.amountCents, customer: p.customerId }),
    retrievePrice: async id => {
      const pack = id === prices.packs.id_25.priceId;
      return { object: 'price', id, livemode: false, currency: 'usd',
        product: (pack ? prices.packs.id_25 : prices.plans.casual).productId,
        unit_amount: pack ? quote.basePriceCents : monthly, type: pack ? 'one_time' : 'recurring',
        recurring: pack ? null : { interval: 'month', interval_count: 1 } };
    },
    retrieveInvoice: async id => ({ object: 'invoice', id, livemode: false, status: 'paid',
      amount_paid_off_stripe: 0, amount_remaining: 0, status_transitions: { paid_at: now },
      amount_overpaid: 0, amount_shipping: 0, starting_balance: 0, ending_balance: 0,
      pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0,
      total_taxes: [], total_discount_amounts: [],
      billing_reason: 'subscription_cycle', parent: { type: 'subscription_details',
        subscription_details: { subscription: 'sub_sub' } }, customer: p.customerId, currency: 'usd',
      total: monthly, amount_due: monthly, amount_paid: monthly }),
    listInvoiceLines: async () => list({ object: 'line_item', livemode: false, quantity: 1, quantity_decimal: '1',
      parent: { type: 'subscription_item_details', subscription_item_details: {
        subscription: 'sub_sub', subscription_item: 'si_synthetic', proration: false } },
      currency: 'usd', amount: monthly, pricing: { type: 'price_details', unit_amount_decimal: String(monthly),
        price_details: { price: prices.plans.casual.priceId, product: prices.plans.casual.productId } },
      taxes: [], discount_amounts: [], pretax_credit_amounts: [],
      period: { start: authorized.effectiveFrom, end: authorized.effectiveUntil } }),
    retrieveSubscription: async id => ({ object: 'subscription', id, livemode: false, customer: p.customerId }),
    // Signature verification is a synthetic boundary, NOT a provider proof.
    verifyWebhook: async () => structuredClone(event),
  };
  const grants = [];
  const adapter = createMembershipPaymentAdapter({ stripe, bindings: store, accountId: 'acct_synthetic',
    livemode: false, priceMap: prices, fulfill: async (kind, data) => {
      grants.push({ kind, data }); return grantMembership(redis, kind, data);
    } });
  await adapter.checkoutReturn({ sessionId: 'cs_one', authenticatedOwner: p.owner });
  t.check('Real adapter plus ledger credits canonical pack', Number(await raw(`scans:${p.owner}:id_paid_left`)) === 25);
  const bindingBytes = await raw(`${PREFIX}order:${p.intentId}`);
  event = { object: 'event', id: 'evt_pack', livemode: false, type: 'checkout.session.completed',
    data: { object: { object: 'checkout.session', id: 'cs_one' } } };
  await adapter.webhook({ rawBody: Buffer.from('synthetic'), signature: 'synthetic' });
  t.check('Webhook and return canonical PI replay do not double grant', Number(await raw(`scans:${p.owner}:id_paid_left`)) === 25);
  t.check('Fulfillment never mutates order', await raw(`${PREFIX}order:${p.intentId}`) === bindingBytes);
  event = { object: 'event', id: 'evt_invoice', livemode: false, type: 'invoice.paid',
    data: { object: { object: 'invoice', id: 'in_synthetic' } } };
  await adapter.webhook({ rawBody: Buffer.from('synthetic'), signature: 'synthetic' });
  const once = await snapshot();
  event.id = 'evt_invoice_second_delivery';
  await adapter.webhook({ rawBody: Buffer.from('synthetic'), signature: 'synthetic' });
  t.check('Paid invoice-period replay preserves all bytes', await snapshot() === once);
  t.check('Historical term supplies Casual entitlement', grants.at(-1).data.plan === 'casual'
    && grants.at(-1).data.periodStart === authorized.effectiveFrom);
  t.check('Invoice preserves purchased pack', Number(await raw(`scans:${p.owner}:id_paid_left`)) === 25);
});

await t.section('Scope and frozen dependencies', async () => {
  await reset(); await pack(); const s = await subscription(); await store.createTerm(term(s));
  t.check('Only versioned binding keys created', (await keys()).every(k => k.startsWith(PREFIX)));
  t.check('Single write primitive, no expiry/debit/grant commands', (MEMBERSHIP_BINDINGS_SCRIPT.match(/redis\.call\('MSET'/g) || []).length === 1
    && !/redis\.call\('(SET|INCR|DECR|EXPIRE|DEL)'/.test(MEMBERSHIP_BINDINGS_SCRIPT));
  const expected = {
    '../api/_membershipLedger.js': 'e068c0013c06cfeb2084295f50c03a94f768ba2d93705dc6fe3d9df8dbc528cb',
    '../api/_membershipPayments.js': 'a3d820ec5b1738aec378a65163df86c5aadae10a0c853080446631d977d43848',
    '../api/_launchMembershipConfig.js': 'a5b4cd0ff0c59849b2d7192598f6d0f824f7e1ad0d81b0906df7a34efe80893b',
    '../api/_idBilling.js': '795235399c1ccef5175c172a3c8166622980f12afee37e714bb7e15a22fa77ad',
  };
  for (const [file, digest] of Object.entries(expected)) t.check(`Frozen ${file}`, sha(readFileSync(new URL(file, import.meta.url))) === digest);
  console.log(`BINDINGS_LUA_SHA256 ${sha(MEMBERSHIP_BINDINGS_SCRIPT)}`);
});
t.done();
