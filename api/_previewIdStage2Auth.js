// Temporary Stage2 restriction only. Shared Firebase verifier semantics unchanged.
import { verifyFirebaseToken } from './_verifyToken.js';
import { Stage2Error } from './_previewIdStage2.js';
export const STAGE2_AUTH_PROVIDERS = ['password', 'google.com', 'apple.com'];
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v;
const email = v => text(v, 320) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const denied = () => { throw new Stage2Error('dedicated_account_signin_required'); };
export async function stage2VerifiedIdentity(token) {
  // Inspect strict raw claims only AFTER normal signature/audience/issuer checks.
  // No email-recovery or Apple email_verified override in this test-account flow.
  let user, claims, header;
  try {
    user = await verifyFirebaseToken(token);
    claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  } catch (_) { denied(); }
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== 'RS256' || !text(claims.sub, 128) || !email(claims.email) || claims.email_verified !== true
      || !Number.isFinite(claims.exp) || claims.exp <= now || !Number.isFinite(claims.iat)
      || claims.iat < 0 || claims.exp <= claims.iat || claims.iat > now + 300
      || !STAGE2_AUTH_PROVIDERS.includes(claims.firebase?.sign_in_provider)
      || user.uid !== claims.sub || user.email !== claims.email
      || user.provider !== claims.firebase.sign_in_provider) denied();
  return user;
}
export function stage2MatchBrowserIdentity(user, identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)
      || Object.keys(identity).some(k => !['uid', 'email', 'providers'].includes(k))
      || identity.uid !== user.uid || identity.email !== user.email
      || !Array.isArray(identity.providers) || identity.providers.length < 1 || identity.providers.length > 3
      || new Set(identity.providers).size !== identity.providers.length
      || identity.providers.some(p => !STAGE2_AUTH_PROVIDERS.includes(p))
      || !identity.providers.includes(user.provider)) denied();
  return { uid: user.uid, email: user.email, provider: user.provider };
}
