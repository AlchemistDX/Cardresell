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
let captured;
const transport = createMembershipCustomerStripe({ apiKey: 'sk_test_synthetic', accountId, reader: stripe,
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
console.log(`membership-customer: ${passed} passed, 0 failed`);
process.exit(0);
