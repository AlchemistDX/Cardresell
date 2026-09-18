// DORMANT transport/signature boundary. No environment reads or route activation.
// Supply only server-held credentials and one explicit account/mode/version.
// Version documented at https://docs.stripe.com/sdks/versioning and explicitly
// requested via Stripe-Version per https://docs.stripe.com/upgrades .
// Dahlia schema is documented; actual Sandbox validation remains a separate
// activation gate. This transport never normalizes canonical object shapes.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const MEMBERSHIP_STRIPE_API_VERSION = '2026-08-26.dahlia';
export const MEMBERSHIP_STRIPE_VERSION_STATUS = 'documented-pin-testmode-shape-validation-pending';
export const MEMBERSHIP_STRIPE_LIMITS = Object.freeze({
  bodyBytes: 1_000_000, responseBytes: 2_000_000, timeoutMs: 5000,
  signaturePastSeconds: 300, signatureFutureSeconds: 30, pages: 3, lineItems: 200,
});
export class MembershipStripeError extends Error {
  constructor(code) { super(code); this.name = 'MembershipStripeError'; this.code = code; }
}
const fail = code => { throw new MembershipStripeError(code); };
const insist = (condition, code) => { if (!condition) fail(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value, prefix) => typeof value === 'string' && value === value.trim()
  && new RegExp(`^${prefix}_[A-Za-z0-9_]{1,180}$`).test(value);
const jsonBytes = (bytes, code) => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return fail(code); }
};
const limits = MEMBERSHIP_STRIPE_LIMITS;

// Future handler MUST declare config = { api: { bodyParser: false } } itself.
// No parsed/string req.body reconstruction: HMAC requires original request bytes.
export async function readMembershipWebhookBody(req) {
  insist(req && req.body === undefined && typeof req[Symbol.asyncIterator] === 'function', 'body_invalid');
  const type = req.headers?.['content-type'], encoding = req.headers?.['content-encoding'];
  insist(typeof type === 'string' && /^application\/json(?:\s*;.*)?$/i.test(type)
    && (encoding === undefined || encoding === 'identity'), 'body_invalid');
  const length = req.headers?.['content-length'];
  if (length !== undefined) insist(typeof length === 'string' && /^\d+$/.test(length)
    && Number.isSafeInteger(Number(length)) && Number(length) <= limits.bodyBytes, 'body_limit');
  let timer, size = 0, timedOut = false;
  const reader = async () => {
    const chunks = [];
    for await (const chunk of req) {
      insist(!timedOut && !req.aborted && chunk instanceof Uint8Array, 'body_invalid');
      size += chunk.byteLength;
      insist(size <= limits.bodyBytes, 'body_limit');
      chunks.push(Buffer.from(chunk));
    }
    insist(!req.aborted && size > 0 && (length === undefined || size === Number(length)), 'body_invalid');
    return Buffer.concat(chunks);
  };
  try {
    return await Promise.race([reader(), new Promise((_, reject) => {
      timer = setTimeout(() => { timedOut = true; req.destroy?.(); reject(new MembershipStripeError('body_timeout')); }, limits.timeoutMs);
    })]);
  } catch (error) {
    req.destroy?.();
    if (error instanceof MembershipStripeError) throw error;
    return fail('body_invalid'); // Never expose request/provider error text.
  } finally { clearTimeout(timer); }
}

export function createMembershipStripeTransport({
  apiKey, webhookSecret, accountId, livemode, apiVersion,
  fetchImpl = globalThis.fetch, nowSeconds = () => Math.floor(Date.now() / 1000),
} = {}) {
  insist(typeof apiKey === 'string' && apiKey.length <= 512
    && apiKey === apiKey.trim()
    && new RegExp(`^(sk|rk)_${livemode === true ? 'live' : 'test'}_[A-Za-z0-9]+$`).test(apiKey)
    && typeof webhookSecret === 'string' && /^whsec_[A-Za-z0-9]{8,500}$/.test(webhookSecret)
    && webhookSecret === webhookSecret.trim()
    && identifier(accountId, 'acct') && typeof livemode === 'boolean'
    && apiVersion === MEMBERSHIP_STRIPE_API_VERSION
    && typeof fetchImpl === 'function' && typeof nowSeconds === 'function', 'transport_configuration');

  async function request(path, query = '') {
    // All path/query callers below are closed server-built operations.
    const url = `https://api.stripe.com/v1/${path}${query}`;
    const abort = new AbortController();
    let timer, expired = false;
    const work = async () => {
      const response = await fetchImpl(url, {
        method: 'GET', redirect: 'error', signal: abort.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Stripe-Version': apiVersion,
          Accept: 'application/json', 'Accept-Encoding': 'identity' },
      });
      insist(!expired && response && response.status === 200 && !response.redirected, 'transport_status');
      insist(!response.url || response.url === url, 'transport_response');
      const contentType = response.headers?.get('content-type');
      insist(typeof contentType === 'string' && /^application\/json(?:\s*;.*)?$/i.test(contentType), 'transport_response');
      const encoding = response.headers.get('content-encoding');
      insist(encoding === null || encoding === 'identity', 'transport_response');
      const length = response.headers.get('content-length');
      if (length !== null) insist(/^\d+$/.test(length) && Number.isSafeInteger(Number(length))
        && Number(length) <= limits.responseBytes, 'transport_limit');
      insist(response.body && typeof response.body.getReader === 'function', 'transport_response');
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      try {
        while (true) {
          const item = await reader.read();
          insist(!expired, 'transport_timeout');
          if (item.done) break;
          insist(item.value instanceof Uint8Array, 'transport_response');
          size += item.value.byteLength;
          insist(size <= limits.responseBytes, 'transport_limit');
          chunks.push(Buffer.from(item.value));
        }
      } finally { reader.cancel().catch(() => {}); }
      insist(size > 0 && (length === null || Number(length) === size), 'transport_response');
      const value = jsonBytes(Buffer.concat(chunks), 'transport_response');
      insist(object(value), 'transport_response');
      return value;
    };
    try {
      return await Promise.race([work(), new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true; abort.abort(); reject(new MembershipStripeError('transport_timeout'));
        }, limits.timeoutMs);
      })]);
    } catch (error) {
      abort.abort();
      if (error instanceof MembershipStripeError) throw error;
      return fail('transport_unavailable'); // No raw body, headers, URL or error.
    } finally { clearTimeout(timer); }
  }
  function canonical(value, type, id, checkMode = true) {
    insist(object(value) && value.object === type && value.id === id, 'transport_response');
    if (checkMode) insist(value.livemode === livemode, 'mode_mismatch');
    return value;
  }
  let accountPromise;
  async function retrieveAccount() {
    if (!accountPromise) {
      accountPromise = request('account').then(value => {
        insist(value.object === 'account' && value.id === accountId, 'account_mismatch');
        return value;
      }).catch(error => { accountPromise = undefined; throw error; });
    }
    return structuredClone(await accountPromise);
  }
  const get = (route, prefix, type) => async id => {
    insist(identifier(id, prefix), 'invalid_reference');
    await retrieveAccount();
    return canonical(await request(`${route}/${encodeURIComponent(id)}`), type, id);
  };
  async function lines(route, id, parentPrefix, linePrefix) {
    insist(identifier(id, parentPrefix), 'invalid_reference');
    await retrieveAccount();
    const data = [], seen = new Set(); let after;
    for (let page = 0; page < limits.pages; page++) {
      const query = `?limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ''}`;
      const list = await request(`${route}/${encodeURIComponent(id)}/${parentPrefix === 'cs' ? 'line_items' : 'lines'}`, query);
      insist(list.object === 'list' && typeof list.has_more === 'boolean'
        && Array.isArray(list.data) && list.data.length <= 100, 'transport_response');
      for (const line of list.data) {
        insist(object(line) && identifier(line.id, linePrefix) && !seen.has(line.id), 'transport_response');
        if (Object.hasOwn(line, 'livemode')) insist(line.livemode === livemode, 'mode_mismatch');
        seen.add(line.id); data.push(line);
      }
      insist(data.length <= limits.lineItems, 'transport_limit');
      if (!list.has_more) return { object: 'list', has_more: false, data };
      insist(list.data.length > 0, 'transport_response');
      after = list.data.at(-1).id; // Never follow upstream URLs or supplied cursors.
    }
    return fail('transport_limit'); // Never report a truncated list as complete.
  }
  function verifyWebhook(rawBody, signature) {
    insist(rawBody instanceof Uint8Array && rawBody.byteLength > 0
      && rawBody.byteLength <= limits.bodyBytes && typeof signature === 'string'
      && signature.length > 0 && signature.length <= 4096, 'invalid_signature');
    const parts = signature.split(',');
    insist(parts.length <= 32, 'invalid_signature');
    let timestamp; const signatures = [];
    for (const part of parts) {
      const match = /^([a-zA-Z0-9]+)=([a-zA-Z0-9]+)$/.exec(part.trim());
      insist(match, 'invalid_signature');
      if (match[1] === 't') {
        insist(timestamp === undefined && /^[1-9]\d{0,11}$/.test(match[2]), 'invalid_signature');
        timestamp = match[2];
      } else if (match[1] === 'v1') {
        insist(/^[a-fA-F0-9]{64}$/.test(match[2]), 'invalid_signature');
        signatures.push(Buffer.from(match[2], 'hex'));
      }
    }
    insist(timestamp !== undefined && signatures.length > 0 && signatures.length <= 8, 'invalid_signature');
    let now;
    try { now = nowSeconds(); } catch { return fail('invalid_signature'); }
    const time = Number(timestamp);
    insist(Number.isSafeInteger(now) && now > 0 && now - time <= limits.signaturePastSeconds
      && time - now <= limits.signatureFutureSeconds, 'invalid_signature');
    const expected = createHmac('sha256', webhookSecret).update(timestamp + '.', 'ascii').update(rawBody).digest();
    // Compare every valid-sized candidate; no equality string comparison.
    let matched = 0;
    for (const candidate of signatures) matched |= Number(timingSafeEqual(candidate, expected));
    insist(matched === 1, 'invalid_signature');
    const event = jsonBytes(rawBody, 'event_invalid');
    insist(object(event) && event.object === 'event' && identifier(event.id, 'evt'), 'event_invalid');
    insist(event.livemode === livemode, 'mode_mismatch');
    insist(event.account == null || event.account === accountId, 'account_mismatch');
    insist(event.api_version === apiVersion, 'version_mismatch');
    return event; // Event age/order is not grant authority; adapter refetches.
  }
  return Object.freeze({
    retrieveAccount,
    retrieveCheckoutSession: get('checkout/sessions', 'cs', 'checkout.session'),
    retrievePaymentIntent: get('payment_intents', 'pi', 'payment_intent'),
    // Dahlia excludes this dynamic settlement field from event payloads and
    // ordinary retrievals. Fixed server-owned expansion, never caller options.
    async retrieveInvoice(id) {
      insist(identifier(id, 'in'), 'invalid_reference');
      await retrieveAccount();
      return canonical(await request(`invoices/${encodeURIComponent(id)}`,
        '?expand%5B%5D=amount_paid_off_stripe'), 'invoice', id);
    },
    retrievePrice: get('prices', 'price', 'price'),
    retrieveSubscription: get('subscriptions', 'sub', 'subscription'),
    listCheckoutLineItems: id => lines('checkout/sessions', id, 'cs', 'li'),
    listInvoiceLines: id => lines('invoices', id, 'in', 'il'),
    verifyWebhook,
  });
}
