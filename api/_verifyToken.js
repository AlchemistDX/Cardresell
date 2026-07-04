// /api/_verifyToken.js
// Shared Firebase ID token verifier for all API routes.
// Firebase tokens are JWTs signed by Google — we verify using Google's public keys.
// This is the lightweight approach that works in Vercel Edge/Serverless without the Admin SDK.

const FIREBASE_PROJECT_ID = 'cardresell-e0329';
const GOOGLE_OAUTH_CLIENT_ID = '971593505703-6feq3nn7p9580krori6r157rfm5tp88l.apps.googleusercontent.com';

// Cache Google public keys (they rotate every 6hrs, cache for 5hrs).
// We use the JWKS endpoint so we get raw JWKs — that lets crypto.subtle.importKey
// consume them directly with format 'jwk', avoiding X.509/SPKI parsing pitfalls.
let _cachedKeys = null;
let _cacheExpiry = 0;

async function getGooglePublicKeys() {
  if (_cachedKeys && Date.now() < _cacheExpiry) return _cachedKeys;
  const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!r.ok) throw new Error('Failed to fetch Google public keys');
  const body = await r.json();
  // Index the JWK array by kid for quick lookup.
  const byKid = {};
  for (const k of (body.keys || [])) {
    if (k && k.kid) byKid[k.kid] = k;
  }
  _cachedKeys = byKid;
  _cacheExpiry = Date.now() + 5 * 60 * 60 * 1000;
  return _cachedKeys;
}

function base64urlToBuffer(str) {
  // Restore standard base64 padding + charset from base64url before decoding.
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad === 2) b64 += '==';
  else if (pad === 3) b64 += '=';
  else if (pad !== 0) throw new Error('Invalid base64url length');
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function verifyFirebaseToken(idToken) {
  // Decode JWT header to get kid
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  const header  = JSON.parse(atob(parts[0].replace(/-/g,'+').replace(/_/g,'/')));
  const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));

  // Basic claims check
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('Token expired');
  if (payload.iat > now + 300) throw new Error('Token issued in the future');
  if (payload.aud !== FIREBASE_PROJECT_ID) throw new Error('Wrong audience');
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) throw new Error('Wrong issuer');
  if (!payload.sub || payload.sub.length === 0) throw new Error('Missing subject');

  // Verify signature using Google's public keys (JWK format).
  const keys = await getGooglePublicKeys();
  const jwk = keys[header.kid];
  if (!jwk) throw new Error('Unknown key ID');

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify']
  );
  const sigValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    base64urlToBuffer(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1])
  );
  if (!sigValid) throw new Error('Invalid signature');

  const provider = payload.firebase?.sign_in_provider || 'unknown';

  // Apple sign-in requires 2FA + phone/payment on file at Apple's login screen, and
  // Apple's private-relay email means users often can't easily check that inbox.
  // We trust Apple's OAuth handshake as sufficient identity proof and treat those
  // users as email-verified. Google is NOT auto-trusted here (fake Gmail signups are
  // easy) — Google users still verify via the emailed link.
  const identities = payload.firebase?.identities || {};
  const appleVerified = provider === 'apple.com' || !!identities['apple.com'];

  return {
    uid:   payload.sub,
    email: payload.email || '',
    name:  payload.name  || '',
    emailVerified: payload.email_verified === true || appleVerified,
    provider,
  };
}

// Also support old Google tokeninfo as fallback (for existing Google users mid-migration)
async function verifyTokenFlexible(idToken) {
  // Try Firebase first
  try {
    return await verifyFirebaseToken(idToken);
  } catch(fbErr) {
    // Fallback: Google tokeninfo (covers legacy Google-only tokens during migration)
    try {
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
      if (!r.ok) throw new Error('Google tokeninfo failed');
      const info = await r.json();
      if (info.aud !== GOOGLE_OAUTH_CLIENT_ID && info.aud !== FIREBASE_PROJECT_ID)
        throw new Error('Wrong audience');
      return {
        uid:   info.sub,
        email: info.email || '',
        name:  info.name  || '',
        // Google tokeninfo: email_verified is string 'true'/'false'
        emailVerified: info.email_verified === true || info.email_verified === 'true',
        provider: 'google.com',
      };
    } catch(gErr) {
      throw new Error(`Token verification failed: ${fbErr.message}`);
    }
  }
}

export { verifyFirebaseToken, verifyTokenFlexible };
