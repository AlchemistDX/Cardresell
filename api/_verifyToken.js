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

  // 2026-09-02 (CR-023): some accounts -- observed on a legacy Google signup --
  // carry no top-level `email` claim, even though the provider identity behind
  // them clearly has one. Firebase also publishes verified provider emails in
  // firebase.identities.email[], so recover from there before giving up.
  // Without this, a paying user was told "your Google account is missing an
  // email" and could not buy anything at all.
  let claimEmail = payload.email || '';
  if (!claimEmail) {
    const idEmails = Array.isArray(identities.email) ? identities.email : [];
    claimEmail = idEmails.find(e => typeof e === 'string' && e.includes('@')) || '';
  }

  return {
    uid:   payload.sub,
    email: claimEmail,
    name:  payload.name  || '',
    emailVerified: payload.email_verified === true || appleVerified,
    provider,
  };
}

// Also support old Google tokeninfo as fallback (for existing Google users mid-migration)
//
// 2026-08-18: CRITICAL FIX. The old fallback returned info.sub (Google's OAuth
// `sub`) as `uid`, which does NOT match the Firebase UID we store all user data
// against. That silently corrupted per-user KV lookups on any request where
// Firebase JWKS fetch had a transient failure — the same user would appear
// under two different UIDs (Firebase `fzU...` vs Google numeric `10490...`),
// causing tier and credit records to look "missing" on that request.
//
// New behavior:
//   1. Try Firebase JWKS verify normally (fast path, ~95% of traffic).
//   2. If that fails, try the Google tokeninfo fallback — but ONLY use it to
//      confirm the token is valid. Never return info.sub as uid.
//   3. Instead, look up the Firebase UID by email via KV mapping
//      (uid_by_email:{lowercase_email}). This mapping is written on every
//      successful Firebase verify below, so it's always populated for any
//      user who has ever signed in successfully.
//   4. If no UID mapping exists (brand-new user + Firebase completely down),
//      throw — don't silently fabricate a fake identity.
async function verifyTokenFlexible(idToken) {
  // Try Firebase first
  try {
    const result = await verifyFirebaseToken(idToken);
    // Best-effort: cache the email→uid mapping for the tokeninfo fallback.
    // 30-day TTL; refreshed on every request.
    if (result.email && result.uid) {
      const kvUrl   = process.env.KV_REST_API_URL;
      const kvToken = process.env.KV_REST_API_TOKEN;
      if (kvUrl && kvToken) {
        const emailLo = result.email.toLowerCase().trim();
        // Fire-and-forget — don't block the request on this write.
        fetch(`${kvUrl}/setex/${encodeURIComponent(`uid_by_email:${emailLo}`)}/2592000/${encodeURIComponent(result.uid)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${kvToken}` },
        }).catch(() => {});
      }
    }
    return result;
  } catch(fbErr) {
    // Fallback: Google tokeninfo (covers legacy Google-only tokens during migration
    // AND transient Firebase JWKS fetch failures).
    try {
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
      if (!r.ok) throw new Error('Google tokeninfo failed');
      const info = await r.json();
      if (info.aud !== GOOGLE_OAUTH_CLIENT_ID && info.aud !== FIREBASE_PROJECT_ID)
        throw new Error('Wrong audience');

      const email = (info.email || '').toLowerCase().trim();
      if (!email) throw new Error('Google tokeninfo missing email; cannot map to Firebase UID');

      // Look up the Firebase UID by email so we NEVER return the Google sub.
      // This is the fix for the cross-device tier-mismatch bug.
      const kvUrl   = process.env.KV_REST_API_URL;
      const kvToken = process.env.KV_REST_API_TOKEN;
      let firebaseUid = null;
      if (kvUrl && kvToken) {
        try {
          const lookup = await fetch(`${kvUrl}/get/${encodeURIComponent(`uid_by_email:${email}`)}`, {
            headers: { Authorization: `Bearer ${kvToken}` },
          });
          const ld = await lookup.json();
          firebaseUid = ld.result || null;
        } catch(kvErr) { /* fall through */ }
      }

      if (!firebaseUid) {
        // No Firebase-UID mapping means this user has never successfully signed
        // in via Firebase on this deployment. We refuse to return the Google sub
        // because it would create split-UID data. Bounce them to re-auth.
        throw new Error('Firebase UID unknown for this email; please sign in again');
      }

      return {
        uid:   firebaseUid,
        email: info.email || '',
        name:  info.name  || '',
        emailVerified: info.email_verified === true || info.email_verified === 'true',
        provider: 'google.com',
      };
    } catch(gErr) {
      throw new Error(`Token verification failed: ${fbErr.message}`);
    }
  }
}

export { verifyFirebaseToken, verifyTokenFlexible };
