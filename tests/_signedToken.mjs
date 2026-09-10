// tests/_signedToken.mjs — one place that mints signed Firebase-shaped ID
// tokens for tests, and the JWKS response that makes the REAL verifier accept
// them.
//
// WHY THIS EXISTS, AND WHY IT IS SHARED.
//
// api/scan.js was hardened on 2026-08-25 so identity comes only from a
// cryptographically verified token. The scan suite kept handing it an unsigned
// JWT, so every one of its 29 cases was answered 401 at api/scan.js:664 before
// any scan logic ran: credit math, refunds and Deep Grade were untested while
// reporting green. The obvious repairs are both wrong. A test-only bypass in
// the endpoint weakens the thing under test. A real Google-issued token makes
// the suite depend on live credentials and network egress, so it stops being a
// local suite at all.
//
// The right answer already existed in this repo: tools/dev-draft-server.mjs
// mints its own RSA keypair, signs tokens with it, and serves the matching
// public key where the verifier looks for Google's. The verifier then performs
// a REAL RS256 signature check, a real issuer/audience/expiry check, and a
// real rejection of anything that fails them. Only the key authority is
// substituted; none of the validation is skipped.
//
// It lives here rather than being copied a second time because two divergent
// copies of a security-relevant helper is exactly the shape of the escaping
// defect fixed on 2026-09-10: three local escapers, two of them wrong.
//
// This mints tokens for TESTS. It is not imported by anything under api/, and
// nothing it exports reaches production code.

import { webcrypto as wc } from 'node:crypto';

export const PROJECT_ID = 'cardresell-e0329';
export const JWKS_HOST_MARK = 'securetoken@system.gserviceaccount.com';

const b64u = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Mint a signing authority: a fresh RSA keypair, the JWKS document that
 * publishes its public half, and a `mint()` that signs tokens with it.
 *
 * @param {object} [opts]
 * @param {string} [opts.kid]       key id published in the JWKS and the header
 * @param {string} [opts.projectId] issuer/audience project
 */
export async function makeSigner(opts = {}) {
  const kid = opts.kid || 'testkid';
  const projectId = opts.projectId || PROJECT_ID;

  const kp = await wc.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']);
  const pubJwk = await wc.subtle.exportKey('jwk', kp.publicKey);
  const jwks = { keys: [{ ...pubJwk, kid, alg: 'RS256', use: 'sig' }] };

  /**
   * Sign a token. Every claim has a working default; override any of them to
   * build a token that SHOULD be rejected — that is the point of the
   * overrides, and the rejection cases below depend on them.
   */
  async function mint(claims = {}) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid: claims.kid || kid };
    const sub = claims.sub || 'user123';
    const payload = {
      iss: `https://securetoken.google.com/${projectId}`,
      aud: projectId,
      sub, user_id: sub,
      auth_time: now, iat: now, exp: now + 3600,
      email: 'test@example.com', email_verified: true,
      firebase: { sign_in_provider: 'password' },
      ...claims,
    };
    delete payload.kid;
    const signing = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
    const sig = await wc.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, Buffer.from(signing));
    return `${signing}.${b64u(sig)}`;
  }

  /** A correctly signed token whose signature bytes have been altered. */
  async function mintTampered(claims = {}) {
    const t = await mint(claims);
    const [h, p, s] = t.split('.');
    const flipped = (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    return `${h}.${p}.${flipped}`;
  }

  /** The JWKS response body the verifier expects at Google's endpoint. */
  const jwksResponse = () => new Response(JSON.stringify(jwks), {
    status: 200, headers: { 'content-type': 'application/json' },
  });

  /** True when `url` is the endpoint the verifier fetches Google's keys from. */
  const isJwksUrl = (url) => String(url).includes(JWKS_HOST_MARK);

  return { kid, projectId, jwks, mint, mintTampered, jwksResponse, isJwksUrl };
}
