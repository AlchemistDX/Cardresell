// Dormant server-only OAuth intent primitive. No route imports this module.
// This is NOT an authenticated route, token exchange, token vault or publisher.
// Future callers must verify Firebase identity and a server-issued browser
// session cookie, apply CSRF/rate-limit gates, then pass that trusted context.
import { createHash, randomBytes } from 'node:crypto';

const TTL_SECONDS = 600;
const INVENTORY_SCOPE = 'https://api.ebay.com/oauth/api_scope/sell.inventory';
const AUTHORIZE = Object.freeze({
  sandbox: 'https://auth.sandbox.ebay.com/oauth2/authorize',
  production: 'https://auth.ebay.com/oauth2/authorize',
});
const digest = value => createHash('sha256').update(value).digest('hex');
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const fail = code => Object.assign(new Error(code), { code });

// GET/compare/DELETE is one Redis operation. A wrong owner, browser session or
// configuration cannot burn another user's valid intent. Redis owns expiry;
// no browser clock or serverless process clock determines validity.
const CLAIM = `
local value = redis.call('GET', KEYS[1])
if not value or value ~= ARGV[1] then return 0 end
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 or ttl > tonumber(ARGV[2]) then return 0 end
redis.call('DEL', KEYS[1])
return 1
`;

function publicConfig(input) {
  if (!input || !Object.hasOwn(AUTHORIZE, input.environment)) throw fail('INVALID_CONFIG');
  // redirect_uri is an eBay-issued RuName, NOT a callback URL. No arbitrary
  // endpoint, scope, callback URL or return-to URL is accepted from a browser.
  for (const name of ['clientId', 'ruName']) {
    if (typeof input[name] !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(input[name])) {
      throw fail('INVALID_CONFIG');
    }
  }
  return Object.freeze({
    environment: input.environment, clientId: input.clientId, ruName: input.ruName,
    scopes: Object.freeze([INVENTORY_SCOPE]),
  });
}

function binding(context, config) {
  // uid is supplied only by a verified server auth boundary, never req.body.
  if (!context || typeof context.ownerId !== 'string' || !context.ownerId.length ||
      context.ownerId.length > 128 || /[\u0000-\u001f\u007f]/.test(context.ownerId) ||
      !opaque(context.sessionNonce)) throw fail('INVALID_CONTEXT');
  // Store no raw account ID, cookie nonce, OAuth state, code or access token.
  return JSON.stringify({ v: 1, binding: digest(JSON.stringify([
    context.ownerId, context.sessionNonce, config.environment,
    config.clientId, config.ruName, config.scopes,
  ])) });
}

/**
 * command(args) must be a trusted Redis adapter resolving the actual result,
 * not a REST response envelope. Redis errors/timeouts must reject. Never log
 * request query strings, consent URLs, raw command arguments or callback codes.
 */
export function createEbaySellerConsent({ command, config } = {}) {
  if (typeof command !== 'function') throw fail('INVALID_STORE');
  const settings = publicConfig(config);
  const keyFor = state => `ebay:seller:consent:v1:${digest(state)}`;
  async function run(args) {
    try { return await command(args); }
    catch { throw fail('CONSENT_STORE_UNAVAILABLE'); }
  }
  return Object.freeze({
    async begin(context) {
      const record = binding(context, settings);
      const state = randomBytes(32).toString('base64url');
      const saved = await run(['SET', keyFor(state), record, 'EX', TTL_SECONDS, 'NX']);
      // Ambiguous writes never produce a redirect. The unused record expires.
      if (saved !== 'OK') throw fail('CONSENT_STORE_UNAVAILABLE');
      const url = new URL(AUTHORIZE[settings.environment]);
      url.search = new URLSearchParams({
        client_id: settings.clientId, redirect_uri: settings.ruName,
        response_type: 'code', scope: settings.scopes.join(' '), state,
      }).toString();
      return { authorizationUrl: url.href, expiresInSeconds: TTL_SECONDS };
    },
    async consume(context, state) {
      const record = binding(context, settings);
      if (!opaque(state)) throw fail('INVALID_CONSENT_STATE');
      const claimed = await run(['EVAL', CLAIM, '1', keyFor(state), record, TTL_SECONDS * 1000]);
      if (claimed !== 1) throw fail('INVALID_CONSENT_STATE');
      // This only authorizes the callback to ATTEMPT exchange. It does not
      // attest that the code, eBay seller or resulting scopes are valid.
      // On an ambiguous consume/exchange response, start a new consent flow;
      // do not replay the old state or claim the connection succeeded.
      return settings;
    },
  });
}
