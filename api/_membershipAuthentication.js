// Membership ownership is the cryptographically verified Firebase subject.
// Never use the legacy email-to-UID fallback for financial operations.
import { verifyFirebaseToken } from './_verifyToken.js';

export function createMembershipAuthenticator({ verify = verifyFirebaseToken, now = Date.now } = {}) {
  return async token => {
    try {
      if (typeof token !== 'string' || token.length > 16384) throw new Error();
      const parts = token.split('.');
      if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
      // These checks only reject malformed claims. They confer no authority:
      // signature, audience and issuer validation must still succeed below.
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      const seconds = Math.floor(now() / 1000);
      if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid
        || !Number.isSafeInteger(claims.exp) || claims.exp <= seconds
        || !Number.isSafeInteger(claims.iat) || claims.iat < 0 || claims.iat > seconds + 300
        || typeof claims.sub !== 'string' || !claims.sub.trim() || claims.sub.length > 128) throw new Error();
      const user = await verify(token);
      if (user?.uid !== claims.sub || user.emailVerified !== true) throw new Error();
      return { uid: user.uid, verified: true, email: user.email };
    } catch {
      throw Object.assign(new Error('authentication_required'), { code: 'authentication_required' });
    }
  };
}
