// Build-only, read-only diagnostic. Every datastore command and HTTP method is
// explicitly constrained. Never expose credentials, request bodies or URLs.
import { createMembershipBindingStore } from '../api/_membershipBindings.js';
import { createMembershipCheckoutStripeTransport } from '../api/_membershipCheckoutStripe.js';
import { MEMBERSHIP_STRIPE_API_VERSION } from '../api/_membershipStripe.js';
export async function inspectMembershipCheckout({ execute, config, owner, fetchImpl = fetch }) {
  const read = command => {
    if (!['GET', 'SCAN'].includes(command[0])) throw Error('read_only_required');
    return execute(command);
  };
  const bindings = createMembershipBindingStore({ execute: read, ...config, livemode: true });
  const keys = new Set(); let cursor = '0';
  for (let page = 0; page < 20; page++) {
    const result = await read(['SCAN', cursor, 'MATCH', 'membership:launch-v2:checkout:operation:*', 'COUNT', 100]);
    if (!Array.isArray(result) || !Array.isArray(result[1])) throw Error('invalid_scan');
    cursor = String(result[0]); result[1].forEach(key => keys.add(key));
    if (cursor === '0') break;
  }
  if (cursor !== '0' || keys.size > 100) throw Error('inspection_incomplete');
  const rows = [];
  for (const key of keys) {
    const record = JSON.parse(await read(['GET', key]))?.data;
    if (record?.owner !== owner || record.accountId !== config.accountId || record.livemode !== true) continue;
    const order = await bindings.getIntent(record.input.intentId);
    const row = { selection: record.selection, state: record.state, createdAt: record.createdAt,
      amountCents: order.amountCents, stages: [], wouldPost: false, mutated: false };
    const transport = createMembershipCheckoutStripeTransport({ ...config, bindings, livemode: true,
      apiVersion: MEMBERSHIP_STRIPE_API_VERSION, fetchImpl: async (url, init) => {
        if (init.method === 'POST') {
          row.wouldPost = true;
          row.parameterNames = [...new URLSearchParams(init.body).keys()];
          throw Error('read_only_stop');
        }
        if (init.method !== 'GET' || new URL(url).origin !== 'https://api.stripe.com') throw Error('read_only_required');
        const response = await fetchImpl(url, init);
        row.stages.push({ resource: new URL(url).pathname.split('/')[2], status: response.status });
        return response;
      } });
    try { await transport.createCheckout(order); }
    catch (error) { row.result = row.wouldPost ? 'all_preconditions_passed' : error.code || 'inspection_failed'; }
    rows.push(row);
  }
  return { rows, mutated: false };
}
