// Build-only, read-only diagnostic. Every datastore command and HTTP method is
// explicitly constrained. Never expose credentials, request bodies or URLs.
import { createMembershipBindingStore, MEMBERSHIP_BINDINGS_SCRIPT } from '../api/_membershipBindings.js';
import { createMembershipCheckoutStripeTransport } from '../api/_membershipCheckoutStripe.js';
import { MEMBERSHIP_STRIPE_API_VERSION } from '../api/_membershipStripe.js';
import { createMembershipStripeTransport } from '../api/_membershipStripe.js';
import { recoverOwnerCheckout } from './recover-owner-checkout.mjs';
export async function inspectMembershipCheckout({ execute, config, owner, fetchImpl = fetch, recover = false }) {
  const read = command => {
    const bindingRead = command[0] === 'EVAL' && command[1] === MEMBERSHIP_BINDINGS_SCRIPT
      && ['read', 'read_bundle'].includes(JSON.parse(command.at(-1)).action);
    if (!['GET', 'SCAN', 'TIME'].includes(command[0]) && !bindingRead) throw Error('read_only_required');
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
    const raw = await read(['GET', key]);
    const record = JSON.parse(raw)?.data;
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
    if (recover && record.createdAt === 1790984766621) {
      const base = { ...config, bindings, livemode: true, apiVersion: MEMBERSHIP_STRIPE_API_VERSION, fetchImpl };
      row.recovery = await recoverOwnerCheckout({ raw, owner, accountId: config.accountId,
        expectedCreatedAt: 1790984766621, bindings,
        stripe: { ...createMembershipStripeTransport(base), ...createMembershipCheckoutStripeTransport(base) },
        now: async () => { const time = await read(['TIME']); return Number(time[0]) * 1000 + Math.floor(Number(time[1]) / 1000); } });
    }
    rows.push(row);
  }
  if (recover && rows.filter(row => row.recovery?.status === 'checkout_ready').length !== 1) {
    throw Error('owner_checkout_recovery_unconfirmed');
  }
  return { rows, datastoreMutated: false, stripeRecoveryRequested: recover };
}
