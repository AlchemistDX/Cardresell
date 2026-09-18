// DORMANT normal-checkout controller. No live route imports, credentials or HTTP.
// Auth/customer/eligibility and the fixed-account Stripe WRITE/recovery client
// are trusted server dependencies, NOT values supplied by a browser.
// A creation claim is permanent. Unknown outcome never authorizes another POST.
import { createHash, randomBytes } from 'node:crypto';
import { MEMBERSHIP_VERSION, LAUNCH_PLANS, LAUNCH_PACKS, quoteLaunchPack } from './_launchMembershipConfig.js';

const PREFIX = `membership:${MEMBERSHIP_VERSION}:checkout:`;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const uid = v => typeof v === 'string' && v.length > 0 && v.length <= 128 && !/[\u0000-\u0020\u007f]/.test(v);
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = (v, kind) => typeof v === 'string' && new RegExp(`^${kind}_[A-Za-z0-9_]{1,180}$`).test(v);
const ref = v => typeof v === 'string' ? v : object(v) ? v.id : null;
const canonical = v => JSON.stringify(v, (_, x) => object(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const hash = v => createHash('sha256').update(v).digest('hex');
export class MembershipCheckoutError extends Error {
  constructor(code, cause) { super(code, cause === undefined ? undefined : { cause }); this.code = code; }
}
const insist = (v, code) => { if (!v) throw new MembershipCheckoutError(code); };
const exact = (v, fields) => object(v) && Object.keys(v).length === fields.length
  && fields.every(k => Object.hasOwn(v, k));

// Values have already been serialized/validated in JS. Compare exact old bytes,
// then one final SET/MSET; no cjson encoding or fallible work after mutation.
// Subscription admission and the immutable operation are committed together.
export const MEMBERSHIP_CHECKOUT_SCRIPT = `
local raw=redis.call('GET',KEYS[1])
local sub=ARGV[4]=='subscription'
local gate=sub and redis.call('GET',KEYS[2]) or false
if ARGV[1]=='prepare' then
  if raw then
    if sub and gate~=KEYS[1] then error('corrupt admission') end
    return 0
  end
  if sub and gate then
    if gate==KEYS[1] then error('missing operation') end
    return 2
  end
  if sub then redis.call('MSET',KEYS[1],ARGV[3],KEYS[2],KEYS[1])
  else redis.call('SET',KEYS[1],ARGV[3]) end
  return 1
elseif ARGV[1]=='claim' then
  if raw~=ARGV[2] then return 0 end
  if sub and gate~=KEYS[1] then error('corrupt admission') end
  redis.call('SET',KEYS[1],ARGV[3])
  return 1
end
error('invalid action')
`;

export function createMembershipCheckoutController({
  execute, bindings, authenticate, resolveContext, stripe, accountId, livemode,
  now = Date.now, operationTimeoutMs = 15000,
}) {
  insist(id(accountId, 'acct') && typeof livemode === 'boolean'
    && typeof execute === 'function' && typeof authenticate === 'function'
    && typeof resolveContext === 'function' && typeof now === 'function'
    && Number.isInteger(operationTimeoutMs) && operationTimeoutMs >= 10 && operationTimeoutMs <= 30000
    && object(bindings) && ['createIntent', 'inspectIntent', 'bindSession', 'bindSettlement']
      .every(k => typeof bindings[k] === 'function')
    && object(stripe) && ['createCheckout', 'recoverCheckout', 'retrieveAccount',
      'retrieveCheckoutSession', 'listCheckoutLineItems', 'retrievePrice']
      .every(k => typeof stripe[k] === 'function'), 'checkout_configuration');
  const scope = canonical({ accountId, livemode });
  const operationKey = (owner, requestId) => `${PREFIX}operation:${hash(canonical({ scope, owner, requestId }))}`;
  const subscriptionKey = owner => `${PREFIX}subscription:${hash(canonical({ scope, owner }))}`;
  const clock = () => {
    const value = now();
    insist(Number.isSafeInteger(value) && value > 0, 'checkout_clock');
    return value;
  };
  const seal = data => canonical({ data, hash: hash(canonical(data)) });
  function readRecord(raw, owner, request) {
    try {
      insist(typeof raw === 'string' && Buffer.byteLength(raw) <= 8192, 'checkout_corrupt');
      const sealed = JSON.parse(raw), r = sealed.data;
      insist(exact(sealed, ['data', 'hash']) && object(r) && sealed.hash === hash(canonical(r))
        && exact(r, ['version', 'accountId', 'livemode', 'owner', 'requestId', 'kind',
          'selection', 'createdAt', 'claimedAt', 'state', 'input'])
        && r.version === MEMBERSHIP_VERSION && r.accountId === accountId && r.livemode === livemode
        && r.owner === owner && r.requestId === request.requestId
        && ['pack', 'subscription'].includes(r.kind)
        && Number.isSafeInteger(r.createdAt) && r.createdAt > 0
        && ['prepared', 'creation_claimed'].includes(r.state)
        && (r.state === 'prepared' ? r.claimedAt === null
          : Number.isSafeInteger(r.claimedAt) && r.claimedAt >= r.createdAt)
        && exact(r.input, ['intentId', 'kind', 'owner', 'customerId', 'plan', 'packId'])
        && hex(r.input.intentId) && r.input.owner === owner && id(r.input.customerId, 'cus')
        && r.input.kind === r.kind && Object.hasOwn(LAUNCH_PLANS, r.input.plan)
        && (r.kind === 'pack'
          ? Object.hasOwn(LAUNCH_PACKS, r.selection) && r.input.packId === r.selection
          : r.selection !== 'free' && r.input.plan === r.selection && r.input.packId === null),
      'checkout_corrupt');
      insist(r.kind === request.kind && r.selection === request.selection, 'request_conflict');
      return r;
    } catch (cause) {
      if (cause instanceof MembershipCheckoutError) throw cause;
      throw new MembershipCheckoutError('checkout_corrupt', cause);
    }
  }
  function encoded(r, owner, request) {
    const raw = seal(r);
    insist(canonical(readRecord(raw, owner, request)) === canonical(r), 'checkout_corrupt');
    return raw;
  }

  return Object.freeze({
    // token is sent ONLY to authenticate. request contains no authoritative UID,
    // eligible discount, customer, amount, price, provider URL, or return URL.
    async checkout({ token, request }) {
      insist(exact(request, ['requestId', 'kind', 'selection']) && hex(request.requestId)
        && typeof request.selection === 'string'
        && (request.kind === 'pack' ? Object.hasOwn(LAUNCH_PACKS, request.selection)
          : request.kind === 'subscription' && request.selection !== 'free'
            && Object.hasOwn(LAUNCH_PLANS, request.selection)), 'invalid_request');
      request = structuredClone(request);
      const abort = new AbortController();
      let rejectDeadline;
      const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
      const timer = setTimeout(() => {
        abort.abort();
        rejectDeadline(new MembershipCheckoutError('checkout_timeout'));
      }, operationTimeoutMs);
      const options = { signal: abort.signal };
      const step = async fn => {
        insist(!abort.signal.aborted, 'checkout_timeout');
        const result = await Promise.race([Promise.resolve().then(fn), deadline]);
        insist(!abort.signal.aborted, 'checkout_timeout');
        return result;
      };
      try {
        const auth = await step(() => authenticate(token, options));
        insist(object(auth) && auth.verified === true && uid(auth.uid), 'authentication_required');
        const owner = auth.uid, key = operationKey(owner, request.requestId), gateKey = subscriptionKey(owner);
        const read = () => step(() => execute(['GET', key]));
        let raw = await read(), r;
        if (raw === null) {
          const context = await step(() => resolveContext(owner, options));
          // resolveContext is a READ-ONLY server authority. Customer creation is
          // a separate recoverable workflow, never email-first lookup here.
          insist(object(context) && context.owner === owner && id(context.customerId, 'cus')
            && (request.kind === 'pack' ? Object.hasOwn(LAUNCH_PLANS, context.plan)
              : context.newSubscriptionAllowed === true), 'checkout_not_authorized');
          r = { version: MEMBERSHIP_VERSION, accountId, livemode, owner,
            ...request, createdAt: clock(), claimedAt: null, state: 'prepared',
            input: { intentId: randomBytes(32).toString('hex'), kind: request.kind, owner,
              customerId: context.customerId, plan: request.kind === 'pack' ? context.plan : request.selection,
              packId: request.kind === 'pack' ? request.selection : null } };
          const next = encoded(r, owner, request);
          const result = await step(() => execute(['EVAL', MEMBERSHIP_CHECKOUT_SCRIPT, 2,
            key, gateKey, 'prepare', '', next, request.kind]));
          insist([0, 1, 2].includes(result), 'checkout_unavailable');
          insist(result !== 2, 'subscription_in_progress');
          raw = await read();
        }
        r = readRecord(raw, owner, request);
        if (r.kind === 'subscription') {
          insist(await step(() => execute(['GET', gateKey])) === key, 'checkout_corrupt');
        }
        const pending = () => ({ status: 'recovery_pending', requestId: request.requestId, sessionId: null, url: null });
        // No reset/repricing when an unclaimed quote expires. A fresh, explicit
        // operation may be issued; a subscription admission needs reconciliation.
        insist(clock() >= r.createdAt, 'checkout_clock');
        if (r.state === 'prepared' && clock() - r.createdAt > 300000) {
          return { status: 'expired', requestId: request.requestId, sessionId: null, url: null };
        }
        const order = await step(() => bindings.createIntent(structuredClone(r.input)));
        insist(order.owner === owner && order.accountId === accountId && order.livemode === livemode
          && order.intentId === r.input.intentId, 'checkout_corrupt');
        let known = await step(() => bindings.inspectIntent(order.intentId));
        let sessionId = known.sessionId;
        const account = await step(() => stripe.retrieveAccount(options));
        insist(account?.object === 'account' && account.id === accountId, 'canonical_account_mismatch');
        if (r.state === 'prepared') {
          insist(known.state === 'intent_persisted', 'checkout_corrupt');
          if (clock() - r.createdAt > 300000) {
            return { status: 'expired', requestId: request.requestId, sessionId: null, url: null };
          }
          const claimed = { ...r, state: 'creation_claimed', claimedAt: clock() };
          const next = encoded(claimed, owner, request);
          const won = await step(() => execute(['EVAL', MEMBERSHIP_CHECKOUT_SCRIPT, 2,
            key, gateKey, 'claim', raw, next, request.kind]));
          insist(won === 0 || won === 1, 'checkout_unavailable');
          if (won === 1) {
            // The sole creation call receives the saved server order including
            // the stable Stripe idempotency key. Its returned object is NOT
            // trusted: only its reference is used for a canonical re-fetch.
            const created = await step(() => stripe.createCheckout(structuredClone(order), options));
            sessionId = ref(created);
            insist(id(sessionId, 'cs'), 'canonical_reference_invalid');
          } else {
            r = readRecord(await read(), owner, request);
            insist(r.state === 'creation_claimed', 'checkout_corrupt');
          }
        }
        if (!sessionId) {
          // Discovery may locate by server intent metadata/idempotency evidence,
          // but null/ambiguous/unknown is NEVER permission for a second POST.
          const found = await step(() => stripe.recoverCheckout(structuredClone(order), options));
          if (found === null) return pending();
          sessionId = ref(found);
          insist(id(sessionId, 'cs'), 'canonical_reference_invalid');
        }
        const session = await step(() => stripe.retrieveCheckoutSession(sessionId, options));
        insist(session?.object === 'checkout.session' && session.id === sessionId
          && session.livemode === livemode
          && session.client_reference_id === order.intentId
          && session.mode === (order.kind === 'pack' ? 'payment' : 'subscription')
          && ref(session.customer) === order.customerId
          && ['open', 'complete', 'expired'].includes(session.status)
          && ['paid', 'unpaid'].includes(session.payment_status), 'canonical_session_mismatch');
        const base = order.kind === 'pack' ? quoteLaunchPack(order.packId, order.planAtCheckout).basePriceCents
          : LAUNCH_PLANS[order.plan].monthlyPriceCents;
        insist(session.currency === 'usd' && session.amount_total === order.amountCents
          && session.amount_subtotal === base && session.total_details?.amount_tax === 0
          && session.total_details?.amount_shipping === 0
          && session.total_details?.amount_discount === base - order.amountCents, 'canonical_amount_mismatch');
        const lines = await step(() => stripe.listCheckoutLineItems(sessionId, options));
        insist(lines?.object === 'list' && lines.has_more === false
          && Array.isArray(lines.data) && lines.data.length === 1, 'canonical_lines_mismatch');
        const line = lines.data[0];
        insist(line?.quantity === 1 && line.currency === 'usd' && line.amount_subtotal === base
          && line.amount_total === order.amountCents && ref(line.price) === order.priceId, 'canonical_lines_mismatch');
        const price = await step(() => stripe.retrievePrice(order.priceId, options));
        insist(price?.object === 'price' && price.id === order.priceId && price.livemode === livemode
          && ref(price.product) === order.productId && price.currency === 'usd' && price.unit_amount === base
          && (order.kind === 'pack' ? price.type === 'one_time' && price.recurring == null
            : price.type === 'recurring' && price.recurring?.interval === 'month'
              && price.recurring.interval_count === 1), 'canonical_price_mismatch');
        const paymentId = ref(session.payment_intent), subscriptionId = ref(session.subscription);
        insist(order.kind === 'pack'
          ? session.subscription === null && (session.payment_intent === null || id(paymentId, 'pi'))
          : session.payment_intent === null && (session.subscription === null || id(subscriptionId, 'sub')),
        'canonical_reference_invalid');
        if (session.status === 'complete') {
          insist(order.kind === 'pack' ? id(paymentId, 'pi') : id(subscriptionId, 'sub'), 'canonical_reference_invalid');
        }
        let url = null;
        if (session.status === 'open') {
          try {
            const parsed = new URL(session.url);
            insist(typeof session.url === 'string' && parsed.protocol === 'https:'
              && parsed.hostname === 'checkout.stripe.com' && !parsed.port && !parsed.username && !parsed.password
              && /^\/c\/pay\/[A-Za-z0-9_-]+$/.test(parsed.pathname), 'canonical_url_invalid');
            url = session.url;
          } catch (cause) {
            if (cause instanceof MembershipCheckoutError) throw cause;
            throw new MembershipCheckoutError('canonical_url_invalid', cause);
          }
        }
        // Nothing authoritative has been bound until ALL canonical checks pass.
        await step(() => bindings.bindSession({ intentId: order.intentId, sessionId }));
        if ((order.kind === 'pack' && paymentId) || (order.kind === 'subscription' && subscriptionId)) {
          await step(() => bindings.bindSettlement({ intentId: order.intentId, sessionId,
            paymentId: order.kind === 'pack' ? paymentId : null,
            subscriptionId: order.kind === 'subscription' ? subscriptionId : null }));
        }
        known = await step(() => bindings.inspectIntent(order.intentId));
        // Bound is NOT paid/granted. Only the unchanged payment adapter verifies
        // a succeeded PI / paid invoice and calls the ledger. No term is invented.
        const status = session.status === 'expired' ? 'expired' : session.status === 'open' ? 'checkout_ready'
          : known.state === 'canonical_bound' ? (order.kind === 'pack' ? 'payment_bound' : 'subscription_bound')
            : 'recovery_pending';
        return { status, requestId: request.requestId, sessionId, url };
      } catch (cause) {
        if (cause instanceof MembershipCheckoutError) throw cause;
        throw new MembershipCheckoutError('checkout_unavailable', cause);
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
