import assert from 'node:assert/strict';
import { redisCommand as execute } from './_idRedis.mjs';
import { createMembershipCustomers } from '../api/_membershipCustomer.js';
import { createMembershipCustomerStripe } from '../api/_membershipCustomerStripe.js';
let passed = 0;
const check = (v) => { assert.ok(v); passed++; };
const reject = async fn => { await assert.rejects(fn); passed++; };
const accountId = 'acct_test';
let posts = 0;
const stripe = { retrieveAccount: async () => ({ object: 'account', id: accountId }),
  createCustomer: async () => ({ id: 'cus_' + (++posts) }),
  retrieveCustomer: async id => ({ object: 'customer', id, livemode: false }) };
const customers = createMembershipCustomers({ execute, stripe, accountId, livemode: false, allowCreate: async () => true });
await execute(['FLUSHDB']);
const outcomes = await Promise.all(Array.from({ length: 15 }, () => customers.ensure('ownerA')));
check(posts === 1);
check(outcomes.some(x => x?.state === 'bound'));
check((await customers.ensure('ownerA')).customerId === 'cus_1');
check(posts === 1);
await reject(() => customers.bindTrusted({ owner: 'ownerB', customerId: 'cus_1', operationId: 'a'.repeat(64) }));
const uncertain = createMembershipCustomers({ execute, accountId, livemode: false, allowCreate: async () => true,
  stripe: { ...stripe, createCustomer: async () => { posts++; throw Error('lost response'); } } });
await reject(() => uncertain.ensure('ownerLost'));
check((await uncertain.ensure('ownerLost')).state === 'claimed');
check(posts === 2);
const pending = await uncertain.get('ownerLost');
await uncertain.bindTrusted({ owner: 'ownerLost', customerId: 'cus_recovered', operationId: pending.operationId });
check((await uncertain.ensure('ownerLost')).customerId === 'cus_recovered');
const denied = createMembershipCustomers({ execute, stripe, accountId, livemode: false, allowCreate: async () => false });
await reject(() => denied.ensure('ownerDenied'));
await reject(() => denied.bindAuditedExisting('ownerLegacy'));
const authorized = createMembershipCustomers({ execute, stripe, accountId, livemode: false,
  allowCreate: async () => false, authorizeExisting: async owner => owner === 'ownerLegacy'
    ? { owner, accountId, livemode: false, customerId: 'cus_legacy', evidenceId: 'c'.repeat(64), approvedAt: 1 }
    : null });
await reject(() => authorized.bindAuditedExisting('ownerLegacy'));
await execute(['SET', 'membership:launch-v2:legacy_fence', '1']);
const imports = await Promise.all(Array.from({ length: 5 }, () => authorized.bindAuditedExisting('ownerLegacy')));
check(imports.every(x => x.customerId === 'cus_legacy'));
check(posts === 2);
check((await authorized.get('ownerLegacy')).customerId === 'cus_legacy');
await reject(() => authorized.bindAuditedExisting('ownerOther'));
const conflicting = createMembershipCustomers({ execute, stripe, accountId, livemode: false,
  allowCreate: async () => false, authorizeExisting: async owner => ({
    owner, accountId, livemode: false, customerId: 'cus_legacy', evidenceId: 'd'.repeat(64), approvedAt: 1 }) });
await reject(() => conflicting.bindAuditedExisting('ownerOther'));
check(await conflicting.get('ownerOther') === null);
let captured;
const transport = createMembershipCustomerStripe({ apiKey: 'rk_test_synthetic', accountId, reader: stripe,
  fetchImpl: async (url, options) => { captured = { url, options };
    return new Response(JSON.stringify(url.endsWith('/account') ? { object: 'account', id: accountId }
      : { object: 'customer', id: 'cus_transport', livemode: false }),
      { status: 200, headers: { 'content-type': 'application/json' } }); } });
await transport.createCustomer({ operationId: 'f'.repeat(64) });
check(captured.url === 'https://api.stripe.com/v1/customers');
check(captured.options.headers['Idempotency-Key'] === 'membership-customer-' + 'f'.repeat(64));
check(captured.options.redirect === 'error');
check(!captured.options.body.includes('email'));
const wrongMode = createMembershipCustomerStripe({ apiKey: 'sk_test_synthetic', accountId, reader: stripe,
  fetchImpl: async () => new Response(JSON.stringify({ object: 'customer', id: 'cus_live', livemode: true }),
    { headers: { 'content-type': 'application/json' } }) });
await reject(() => wrongMode.retrieveCustomer('cus_live'));
let mismatchedPosts = 0;
const mismatched = createMembershipCustomerStripe({ apiKey: 'sk_test_other', accountId, reader: stripe,
  fetchImpl: async (url, options) => {
    if (options.method === 'POST') mismatchedPosts++;
    return Response.json({ object: 'account', id: 'acct_other' });
  } });
await reject(() => mismatched.createCustomer({ operationId: 'e'.repeat(64) }));
check(mismatchedPosts === 0);
await reject(() => mismatched.retrieveAccount());
let portalPosts = 0, portalBody;
let overrides = {};
const portalTransport = createMembershipCustomerStripe({
  apiKey: 'sk_test_synthetic', accountId, portalConfiguration: 'bpc_safe',
  returnOrigin: 'https://cardresell-preview.example',
  fetchImpl: async (url, options) => {
    if (url.endsWith('/account')) return Response.json({ object: 'account', id: accountId });
    if (url.includes('/customers/')) return Response.json({ object: 'customer', id: 'cus_owned', livemode: false });
    if (url.includes('/configurations/')) return Response.json({
      object: 'billing_portal.configuration', id: 'bpc_safe', active: true, livemode: false,
      features: { subscription_update: { enabled: false },
        subscription_cancel: { enabled: true, mode: 'at_period_end' },
        payment_method_update: { enabled: true }, invoice_history: { enabled: true }, ...overrides },
    });
    portalPosts++;
    portalBody = new URLSearchParams(options.body);
    return Response.json({ object: 'billing_portal.session', customer: portalBody.get('customer'),
      configuration: 'bpc_safe', livemode: false, return_url: portalBody.get('return_url'),
      url: 'https://billing.stripe.com/p/session/synthetic' });
  },
});
const portalInput = { customerId: 'cus_owned', operationId: 'b'.repeat(64) };
check((await portalTransport.createPortal(portalInput)).url.startsWith('https://billing.stripe.com/'));
check(portalBody.get('customer') === 'cus_owned');
check(portalBody.get('return_url') === 'https://cardresell-preview.example/?shop=1');
overrides = { subscription_cancel: { enabled: true, mode: 'immediately' } };
await reject(() => portalTransport.createPortal(portalInput));
check(portalPosts === 1);
overrides = { subscription_update: { enabled: true } };
await reject(() => portalTransport.createPortal(portalInput));
check(portalPosts === 1);
await reject(() => portalTransport.createPortal({ ...portalInput, customerId: 'cus_other' }));
console.log(`membership-customer: ${passed} passed, 0 failed`);
process.exit(0);
