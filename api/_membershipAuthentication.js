// Membership ownership is the cryptographically verified Firebase subject.
// Never use the legacy email-to-UID fallback for financial operations.
import { verifyFirebaseToken } from './_verifyToken.js';

export function createMembershipAuthenticator({ verify = verifyFirebaseToken, now = Date.now,
  resolveVerification, resolveAccountEmail,
  onReject = reason => console.warn('MEMBERSHIP_AUTH_REJECTED', reason) } = {}) {
  return async token => {
    let reason = 'malformed_token';
    let action;
    try {
      if (typeof token !== 'string' || token.length > 16384) throw new Error();
      const parts = token.split('.');
      if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
      // These checks only reject malformed claims. They confer no authority:
      // signature, audience and issuer validation must still succeed below.
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      const seconds = Math.floor(now() / 1000);
      reason = 'invalid_claims';
      if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid
        || !Number.isSafeInteger(claims.exp) || claims.exp <= seconds
        || !Number.isSafeInteger(claims.iat) || claims.iat < 0 || claims.iat > seconds + 300
        || typeof claims.sub !== 'string' || !claims.sub.trim() || claims.sub.length > 128) throw new Error();
      reason = 'firebase_verification_failed';
      let user;
      try { user = await verify(token); }
      catch (error) {
        // Fixed categories only. Never log the token, claims, owner or raw error.
        const known = {
          'Wrong audience': 'wrong_project', 'Wrong issuer': 'wrong_issuer',
          'Unknown key ID': 'unknown_signing_key', 'Invalid signature': 'invalid_signature',
          'Failed to fetch Google public keys': 'public_keys_unavailable',
          'crypto is not defined': 'crypto_runtime_unavailable',
          'Token expired': 'expired_token', 'Token issued in the future': 'future_token',
        };
        reason = Object.hasOwn(known, error?.message) ? known[error.message] : reason;
        throw new Error();
      }
      reason = 'subject_mismatch';
      if (user?.uid !== claims.sub) throw new Error();
      reason = 'email_not_verified';
      if (user.emailVerified === true) return { uid: user.uid, verified: true, email: user.email };
      // Signature/project/expiry/subject checks have already succeeded. Honor
      // the site's preexisting server-owned verification for this exact UID.
      const saved = typeof resolveVerification === 'function' ? await resolveVerification(user.uid) : null;
      if (saved?.verified !== true || saved.source !== 'stored_account_verification') {
        action = 'verify_email';
        throw new Error();
      }
      let authenticatedEmail = user.email;
      if (!authenticatedEmail && saved.email && typeof resolveAccountEmail === 'function') {
        reason = 'account_email_unavailable';
        authenticatedEmail = await resolveAccountEmail(token, user.uid);
      }
      return { uid: user.uid, verified: true, email: saved.email || authenticatedEmail,
        verificationSource: saved.source, authenticatedEmail, verificationEmail: saved.email };
    } catch {
      try { onReject(reason); } catch { /* Diagnostics cannot change admission. */ }
      throw Object.assign(new Error('authentication_required'), { code: 'authentication_required',
        ...(action ? { action } : {}) });
    }
  };
}
