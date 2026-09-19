import { MEMBERSHIP_STRIPE_API_VERSION } from './_membershipStripe.js';
const fail = () => { throw Object.assign(new Error('customer_transport_unavailable'), { code: 'customer_transport_unavailable' }); };
export function createMembershipCustomerStripe({ apiKey, accountId, reader, fetchImpl = globalThis.fetch }) {
  if (!/^sk_test_[A-Za-z0-9]+$/.test(apiKey) || !/^acct_[A-Za-z0-9]+$/.test(accountId)) fail();
  async function request(path, body, operationId) {
    if (path !== 'account') await request('account');
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5000);
    const url = 'https://api.stripe.com/v1/' + path;
    try {
      const response = await fetchImpl(url, { method: body ? 'POST' : 'GET', redirect: 'error',
        signal: abort.signal, headers: {
          Authorization: `Bearer ${apiKey}`, 'Stripe-Version': MEMBERSHIP_STRIPE_API_VERSION,
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(body ? { 'Idempotency-Key': `membership-customer-${operationId}` } : {}),
        }, ...(body ? { body: new URLSearchParams(body).toString() } : {}) });
      if (response.status !== 200 || response.redirected || (response.url && response.url !== url)
        || !/^application\/json\b/.test(response.headers.get('content-type') || '')) fail();
      const chunks = []; let length = 0;
      const stream = response.body.getReader();
      try {
        while (true) {
          const chunk = await stream.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > 1000000) fail();
          chunks.push(Buffer.from(chunk.value));
        }
      } finally { await stream.cancel().catch(() => {}); }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (path === 'account') {
        if (value?.object !== 'account' || value.id !== accountId) fail();
        return value;
      }
      if (value?.object !== 'customer' || value.livemode !== false || value.deleted
        || !/^cus_[A-Za-z0-9_]+$/.test(value.id)) fail();
      return value;
    } catch { fail(); } finally { clearTimeout(timer); }
  }
  return Object.freeze({
    retrieveAccount: () => request('account'),
    retrieveCustomer: id => {
      if (!/^cus_[A-Za-z0-9_]+$/.test(id)) fail();
      return request('customers/' + id);
    },
    createCustomer: ({ operationId }) => {
      if (!/^[a-f0-9]{64}$/.test(operationId)) fail();
      return request('customers', { 'metadata[membership_operation]': operationId }, operationId);
    },
  });
}
