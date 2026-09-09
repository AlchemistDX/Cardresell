// /api/_ebayAuth.js
// Shared eBay OAuth application-token helper.
//
//   import { getEbayAppToken, ebayHeaders } from './_ebayAuth.js';
//   const token = await getEbayAppToken();
//   const r = await fetch(url, { headers: ebayHeaders(token) });
//
// WHY THIS FILE EXISTS (2026-09-05)
// ---------------------------------
// Production OAuth was believed broken for 24 days (see EBAY_OAUTH_TICKET.md).
// A support ticket was drafted and a Cert ID was rotated. The real cause was
// two characters: every value in .env.production — and every eBay value stored
// in Vercel — carried a trailing newline. The Basic Auth header was therefore
// built from "FAKEUSER-...-deadbeef\n:PRD-...-3333\n", which eBay correctly
// rejected as invalid_client.
//
// The credential itself was never wrong. The transport was.
//
// So credential reads go through cleanCredential() and nowhere else. A future
// bad paste now degrades into a loud, specific error instead of a fortnight of
// debugging eBay's identity service.

const TOKEN_URL      = 'https://api.ebay.com/identity/v1/oauth2/token';
const DEFAULT_SCOPE  = 'https://api.ebay.com/oauth/api_scope';
const CACHE_KEY      = 'ebay:app_token';
// Refresh this many seconds before eBay's stated expiry so an in-flight
// request can't be holding a token that dies mid-call.
const SAFETY_WINDOW_SEC = 120;

// Per-instance memo. Serverless instances are reused across invocations, so
// this saves a Redis round-trip on warm calls. Redis remains the shared cache
// so a burst of cold starts doesn't each mint a new token — the app-level
// token endpoint is capped at 1,000/day.
let _memo = null; // { token: string, expiresAtMs: number }

// ── Credential hygiene ────────────────────────────────────────────────────

/**
 * Normalise a credential read from an environment variable.
 *
 * Handles, in order:
 *   - non-string / nullish input            → ''
 *   - surrounding single or double quotes   → peeled (only if balanced)
 *   - LITERAL escape sequences (\n \r \t)   → stripped from both ends
 *   - real whitespace incl. newlines/tabs   → trimmed
 *
 * The literal-escape case is the one that caused the outage: a value written
 * as EBAY_APP_ID="FAKEUSER-...\n" contains a backslash and an 'n' as two
 * separate characters, which .trim() does not touch.
 */
export function cleanCredential(raw) {
  if (raw == null) return '';
  let v = String(raw);

  // Peel balanced surrounding quotes, possibly with whitespace outside them.
  v = v.trim();
  while (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) {
    v = v.slice(1, -1).trim();
  }

  // Strip literal \n, \r, \t sequences and real whitespace from both ends.
  // Looped because a value can carry several ("...aade6\n\n").
  const edge = /^(?:\\[nrt]|\s)+|(?:\\[nrt]|\s)+$/g;
  let prev;
  do { prev = v; v = v.replace(edge, ''); } while (v !== prev);

  return v;
}

/**
 * Safe, loggable description of a credential — never returns the secret.
 * Use this in error paths so a malformed value is diagnosable from logs.
 */
export function describeCredential(name, raw) {
  const cleaned = cleanCredential(raw);
  const original = raw == null ? '' : String(raw);
  // A prefix is only safe for a value that is not itself a secret. App IDs are
  // public. Cert IDs, tokens and keys are not, and eight characters of a secret
  // in a Vercel log — or in an audit file pasted to a reviewer — is still eight
  // characters of a secret. Capping the length was not the same as withholding.
  // Withheld EXPLICITLY via prefixWithheld: a silently empty prefix would read
  // as "the value was empty", which is a different and misleading fact.
  const isSecret = /CERT|SECRET|TOKEN|PASSWORD|KEY/i.test(name);
  return {
    name,
    present: cleaned.length > 0,
    length: cleaned.length,
    wasDirty: original !== cleaned,
    prefix: isSecret ? '' : cleaned.slice(0, 8),
    prefixWithheld: isSecret,
  };
}

/**
 * Read + clean the eBay production credentials.
 * Throws with a diagnostic (never the secret) when either is missing.
 */
export function getEbayCredentials(env = process.env) {
  const appId  = cleanCredential(env.EBAY_APP_ID);
  const certId = cleanCredential(env.EBAY_CERT_ID);

  if (!appId || !certId) {
    const detail = [
      describeCredential('EBAY_APP_ID',  env.EBAY_APP_ID),
      describeCredential('EBAY_CERT_ID', env.EBAY_CERT_ID),
    ];
    const err = new Error('eBay credentials missing or empty');
    err.code = 'EBAY_CREDS_MISSING';
    err.detail = detail;
    throw err;
  }
  return { appId, certId };
}

// ── Redis (Upstash REST) — matches the pattern used across api/ ────────────

async function kvGet(key) {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(`${url}/get/${encodeURIComponent(key)}`,
      { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : null;
  } catch { return null; }
}

async function kvSetEx(key, value, ttlSec) {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token || ttlSec <= 0) return;
  try {
    await fetch(
      `${url}/setex/${encodeURIComponent(key)}/${ttlSec}/${encodeURIComponent(JSON.stringify(value))}`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
    );
  } catch { /* cache is best-effort; never fail a request over it */ }
}

// ── Token acquisition ─────────────────────────────────────────────────────

/**
 * Mint a fresh application access token. Prefer getEbayAppToken() — this
 * bypasses every cache and consumes daily quota.
 */
export async function fetchEbayAppToken({ scope = DEFAULT_SCOPE, env = process.env } = {}) {
  const { appId, certId } = getEbayCredentials(env);
  const basic = Buffer.from(`${appId}:${certId}`).toString('base64');

  const body = new URLSearchParams({ grant_type: 'client_credentials', scope }).toString();

  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      // eBay requires HTTP Basic. Passing client_id/client_secret in the body
      // returns 401 invalid_client — verified 2026-09-05.
      'Authorization': `Basic ${basic}`,
    },
    body,
  });

  const text = await r.text();
  if (!r.ok) {
    const err = new Error(`eBay token request failed: HTTP ${r.status}`);
    err.code = 'EBAY_TOKEN_HTTP';
    err.status = r.status;
    err.body = text.slice(0, 500);
    // invalid_client almost always means a malformed credential, so surface
    // the shape of what we read. This is the signal that was missing in August.
    if (text.includes('invalid_client')) {
      err.hint = 'invalid_client usually means a malformed credential (stray newline or quote), not a revoked key.';
      err.detail = [
        describeCredential('EBAY_APP_ID',  env.EBAY_APP_ID),
        describeCredential('EBAY_CERT_ID', env.EBAY_CERT_ID),
      ];
    }
    throw err;
  }

  let json;
  try { json = JSON.parse(text); }
  catch {
    const err = new Error('eBay token response was not JSON');
    err.code = 'EBAY_TOKEN_PARSE';
    err.body = text.slice(0, 300);
    throw err;
  }

  if (!json.access_token) {
    const err = new Error('eBay token response had no access_token');
    err.code = 'EBAY_TOKEN_EMPTY';
    throw err;
  }

  const expiresIn = Number(json.expires_in) || 7200;
  return { token: json.access_token, expiresIn };
}

/**
 * Get a cached application access token, minting one only when needed.
 * Cache order: per-instance memo → Redis → eBay.
 *
 * @param {object}  opts
 * @param {boolean} opts.forceRefresh  skip both caches
 * @returns {Promise<string>} access token
 */
export async function getEbayAppToken({ forceRefresh = false, scope = DEFAULT_SCOPE } = {}) {
  const now = Date.now();

  if (!forceRefresh) {
    if (_memo && _memo.expiresAtMs > now) return _memo.token;

    const cached = await kvGet(CACHE_KEY);
    if (cached && cached.token && cached.expiresAtMs > now) {
      _memo = cached;
      return cached.token;
    }
  }

  const { token, expiresIn } = await fetchEbayAppToken({ scope });
  const ttl = Math.max(60, expiresIn - SAFETY_WINDOW_SEC);
  const record = { token, expiresAtMs: now + ttl * 1000 };

  _memo = record;
  await kvSetEx(CACHE_KEY, record, ttl);
  return token;
}

/** Clear the per-instance memo. Tests only. */
export function _resetTokenMemo() { _memo = null; }

// ── Request helpers ───────────────────────────────────────────────────────

/**
 * Standard headers for eBay Buy/Commerce API calls.
 * Taxonomy ignores the marketplace header but accepts it harmlessly.
 */
export function ebayHeaders(token, { marketplaceId = 'EBAY_US', extra = {} } = {}) {
  return {
    'Authorization': `Bearer ${token}`,
    'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
    'Accept': 'application/json',
    ...extra,
  };
}

export const EBAY_TOKEN_URL = TOKEN_URL;
export const EBAY_DEFAULT_SCOPE = DEFAULT_SCOPE;
