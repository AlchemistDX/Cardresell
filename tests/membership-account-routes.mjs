// Actual HTTP adapters with deterministic synthetic dependencies. Not Stripe
// Sandbox or real authentication acceptance.
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createMembershipAccountRoutes } from '../api/_membershipAccountRoutes.js';
import { createMembershipFulfillment } from '../api/_membershipFulfillment.js';
let passed = 0;
const check = value => { assert.ok(value); passed++; };
let state = { subscriptionId: 'sub_test', claim: null,
  snapshot: { status: 'active', periodEnd: 2000000000 }, command: null };
let refreshed = 0, reconciled = 0, executed = 0, associated = 0, rawSeen;
let bound = true, failWebhook = false, confirm = true;
const lifecycle = {
  get: async () => structuredClone(state),
  associate: async () => { associated++; },
  refresh: async () => { refreshed++; if (confirm && state.command) state.command.phase = 'confirmed'; return { status: 'refreshed' }; },
  reconcile: async input => { reconciled++; assert.equal(input.operationId, state.claim.operationId); state.claim = null; return { status: 'refreshed' }; },
  requestChange: async input => state.command = { ...input, kind: 'plan_change', phase: 'requested' },
  requestCancel: async input => state.command = { ...input, kind: 'cancel', phase: 'requested' },
};
const routes = createMembershipAccountRoutes({
  authenticate: async token => { if (token !== 'good') throw Object.assign(Error(), { code: 'authentication_required' }); return { uid: 'owner', verified: true }; },
  customers: { get: async () => bound ? { state: 'bound' } : null, ensure: async () => ({ state: 'bound', customerId: 'cus_test' }) },
  lifecycle, balances: async () => ({ included: { id: 50, grade: 15 } }),
  commands: { executeCommand: async () => { executed++; } },
  fulfillment: {
    checkoutReturn: async input => { assert.equal(input.owner, 'owner'); return { status: 'fulfilled' }; },
    webhook: async input => { rawSeen = input; if (failWebhook) throw Error(); return { status: 'fulfilled' }; },
  },
});
async function invoke(method, body, verb = 'POST', authorization = 'Bearer good') {
  const res = { code: 0, setHeader() {}, status(x) { this.code = x; return this; }, json(x) { this.body = x; return this; } };
  await routes[method]({ method: verb, body, headers: { authorization } }, res); return res;
}
check((await invoke('account', undefined, 'GET', '')).code === 401);
state.claim = { operationId: 'a'.repeat(64), token: 'private-authority' };
let response = await invoke('account', undefined, 'GET');
check(response.body.creditsExpire === false && response.body.state.recoveryPending);
check(!JSON.stringify(response.body).includes('private-authority'));
await invoke('account', { action: 'refresh', operationId: 'b'.repeat(64) });
check(reconciled === 1 && refreshed === 0);
await invoke('account', { action: 'refresh', operationId: 'c'.repeat(64) });
check(refreshed === 1);
response = await invoke('account', { action: 'change', operationId: 'd'.repeat(64), plan: 'casual' });
check(response.code === 200 && response.body.status === 'confirmed' && executed === 1);
confirm = false; state.command = null;
response = await invoke('account', { action: 'cancel', operationId: 'e'.repeat(64) });
check(response.code === 202 && response.body.status === 'pending');
check((await invoke('account', { action: 'cancel', operationId: 'e'.repeat(64), owner: 'attacker' })).code === 400);
check((await invoke('checkoutReturn', { sessionId: 'cs_test' })).body.status === 'fulfilled');
check((await invoke('checkoutReturn', { sessionId: 'cs_test', owner: 'attacker' })).code === 400);
bound = false; check((await invoke('account', undefined, 'GET')).body.state.status === 'not_associated');
await invoke('account', { action: 'associate' }); check(associated === 1);
async function webhook() {
  const req = Readable.from([Buffer.from('{"synthetic":true}')]);
  req.method = 'POST'; req.headers = { 'content-type': 'application/json', 'stripe-signature': 'exact-signature' };
  const res = { status(x) { this.code = x; return this; }, json(x) { this.body = x; return this; } };
  await routes.webhook(req, res); return res;
}
check((await webhook()).code === 200);
check(rawSeen.rawBody.toString() === '{"synthetic":true}' && rawSeen.signature === 'exact-signature');
failWebhook = true; check((await webhook()).code === 503);
// Shared coordinator verifies webhook bytes before delegating lifecycle events.
let verified = 0, delegated = 0;
const shared = createMembershipFulfillment({ accountId: 'acct_test', livemode: false, bindings: {}, payments: {},
  stripe: { verifyWebhook: async (raw, signature) => {
    assert.equal(raw.toString(), 'body'); assert.equal(signature, 'signature'); verified++;
    return { object: 'event', id: 'evt_test', livemode: false, type: 'invoice.paid' };
  } },
  lifecycle: { webhook: async input => { assert.equal(input.rawBody.toString(), 'body'); delegated++; return { status: 'fulfilled' }; } } });
await shared.webhook({ rawBody: Buffer.from('body'), signature: 'signature' });
check(verified === 1 && delegated === 1);
console.log(`membership-account-routes: ${passed} passed, 0 failed`);
