// /api/_verifyToken.js
// Shared Firebase ID token verifier for all API routes.
// Firebase tokens are JWTs signed by Google — we verify using Google's public keys.
// This is the lightweight approach that works in Vercel Edge/Serverless without the Admin SDK.

const FIREBASE_PROJECT_ID = 'cardresell-e0329';
const GOOGLE_OAUTH_CLIENT_ID = '971593505703-6feq3nn7p9580krori6r157rfm5tp88l.apps.googleusercontent.com';

// Cache Google public keys (they rotate every 6hrs, cache for 5hrs)
let _cachedKeys = null;
let _cacheExpiry = 0;

async function getGooglePublicKeys() {
  if (_cachedKeys && Date.now() < _cacheExpiry) return _cachedKeys;
  const r = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  if (!r.ok) throw new Error('Failed to fetch Google public keys');
  _cachedKeys = await r.json();
  _cacheExpiry = Date.now() + 5 * 60 * 60 * 1000;
  return _cachedKeys;
}

function base64urlToBuffer(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
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

  // Verify signature using Google's public keys
  const keys = await getGooglePublicKeys();
  const certPem = keys[header.kid];
  if (!certPem) throw new Error('Unknown key ID');

  // Import the certificate and verify
  const certBody = certPem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const certDer  = base64urlToBuffer(certBody);
  const cryptoKey = await crypto.subtle.importKey(
    'spki', certDer,
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

  return {
    uid:   payload.sub,
    email: payload.email || '',
    name:  payload.name  || '',
    // Firebase email/password users have firebase.sign_in_provider
    provider: payload.firebase?.sign_in_provider || 'unknown',
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
        provider: 'google.com',
      };
    } catch(gErr) {
      throw new Error(`Token verification failed: ${fbErr.message}`);
    }
  }
}

export { verifyFirebaseToken, verifyTokenFlexible };
