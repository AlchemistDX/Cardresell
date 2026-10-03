import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { recoverOwnerCheckout } from './recover-owner-checkout.mjs';
const canonical = value => JSON.stringify(value, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const hash = value => createHash('sha256').update(value).digest('hex');
const createdAt = 1790984766621;
const data = { version: 'launch-v2', owner: 'testOwner', accountId: 'acct_test', livemode: true,
  kind: 'pack', selection: 'id_25', state: 'creation_claimed', createdAt, claimedAt: createdAt + 50,
  input: { owner: 'testOwner', customerId: 'cus_test', intentId: 'a'.repeat(64), kind: 'pack', packId: 'id_25' } };
const seal = d => JSON.stringify({ data: d, hash: hash(canonical(d)) });
const order = { ...data, ...data.input, amountCents: 224, stripeIdempotencyKey: `membership-launch-v2-${data.input.intentId}` };
const session = { object: 'checkout.session', id: 'cs_test', livemode: true, customer: 'cus_test',
  client_reference_id: order.intentId, mode: 'payment', status: 'open', payment_status: 'unpaid',
  amount_total: 224, amount_subtotal: 299, currency: 'usd',
  total_details: { amount_discount: 75, amount_tax: 0, amount_shipping: 0 } };
let passed = 0;
const check = (name, ok) => { assert.ok(ok, name); console.log('PASS ' + name); passed++; };
function fixture() {
  const f = { posts: [], found: null, time: createdAt + 5000 };
  f.args = { raw: seal(data), owner: data.owner, accountId: data.accountId, expectedCreatedAt: createdAt,
    bindings: { getIntent: async () => structuredClone(order) }, now: async () => f.time,
    stripe: { recoverCheckout: async () => f.found,
      createCheckout: async o => { f.posts.push(o); f.found = 'cs_test'; return { id: f.found }; },
      retrieveCheckoutSession: async () => structuredClone(session) } };
  return f;
}
const f = fixture(), raw = f.args.raw;
check('saved operator recovery returns unpaid canonical session', (await recoverOwnerCheckout(f.args)).status === 'checkout_ready');
check('same durable key and order, no new identity', f.posts.length === 1 && canonical(f.posts[0]) === canonical(order));
check('original claim bytes preserved', f.args.raw === raw);
check('repeated operator run discovers rather than posts', (await recoverOwnerCheckout(f.args)).recoveredExisting && f.posts.length === 1);
for (const [name, change] of [
  ['wrong owner', a => { a.owner = 'other'; }],
  ['wrong account', a => { a.accountId = 'acct_other'; }],
  ['altered claim', a => { a.raw = seal({ ...data, state: 'prepared' }); }],
  ['wrong price selection', a => { a.raw = seal({ ...data, selection: 'id_100' }); }],
  ['wrong historic operation', a => { a.expectedCreatedAt++; }],
  ['corrupt digest', a => { a.raw = JSON.stringify({ data, hash: 'bad' }); }],
  ['wrong order amount', a => { a.bindings.getIntent = async () => ({ ...order, amountCents: 299 }); }],
  ['wrong customer', a => { a.bindings.getIntent = async () => ({ ...order, customerId: 'cus_other' }); }],
]) {
  const g = fixture(); change(g.args); await assert.rejects(() => recoverOwnerCheckout(g.args));
  check(name + ' fails before any POST', g.posts.length === 0);
}
for (const time of [createdAt - 1, createdAt + 23 * 60 * 60 * 1000]) {
  const g = fixture(); g.time = time; await assert.rejects(() => recoverOwnerCheckout(g.args));
  check('invalid/expired retry window does not POST', g.posts.length === 0);
}
const lost = fixture();
lost.args.stripe.createCheckout = async o => { lost.posts.push(o); lost.found = 'cs_test'; throw Error('lost_response'); };
await assert.rejects(() => recoverOwnerCheckout(lost.args));
check('unknown response never triggers internal retry', lost.posts.length === 1);
check('later read-only discovery recovers lost response', (await recoverOwnerCheckout(lost.args)).recoveredExisting && lost.posts.length === 1);
const conflict = fixture();
conflict.args.stripe.createCheckout = async o => { conflict.posts.push(o); throw Error('idempotency_conflict'); };
await assert.rejects(() => recoverOwnerCheckout(conflict.args));
check('provider conflict stops without key reset', conflict.posts.length === 1 && conflict.posts[0].stripeIdempotencyKey === order.stripeIdempotencyKey);
console.log(`${passed} passed, 0 failed`);
