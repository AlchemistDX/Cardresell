// Short-lived, read-only rotation canary. Never accepts credentials, an owner,
// database URL or command from the caller. Disable after cutover.
import { createHash } from 'node:crypto';
import { membershipRedis, MEMBERSHIP_LEGACY_FENCE } from './_membershipLegacyFence.js';
export function createCutoverStatus({ env = process.env, execute = membershipRedis } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const host = req.headers?.host;
    const immutable = /^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL || '')
      && host === env.VERCEL_URL;
    if (env.VERCEL_ENV !== 'production' || env.MEMBERSHIP_CUTOVER_STATUS !== 'enabled'
      || (!immutable && !['www.cardresell.org', 'cardresell.org'].includes(host))) {
      return res.status(404).json({ status: 'disabled' });
    }
    if (req.method !== 'GET') return res.status(405).json({ status: 'method_not_allowed' });
    const state = {
      commit: /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA || '') ? env.VERCEL_GIT_COMMIT_SHA : null,
      billingPaused: env.MEMBERSHIP_CUTOVER_PAUSED === 'enabled',
      purchasingEnabled: env.MEMBERSHIP_PURCHASE_LIVE_MODE === 'enabled',
    };
    try {
      const url = new URL(env.KV_REST_API_URL);
      if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !/^[a-z0-9-]+\.upstash\.io$/.test(url.hostname)) throw Error('invalid_binding');
      state.datastoreEndpointDigest = createHash('sha256').update(url.origin).digest('hex');
      const clock = await execute(['TIME']);
      if (!Array.isArray(clock) || !/^\d+$/.test(String(clock[0]))) throw Error('invalid_clock');
      const fence = await execute(['GET', MEMBERSHIP_LEGACY_FENCE]);
      return res.status(200).json({ ...state, datastoreAuthorization: 'accepted',
        fence: fence === null ? 'absent' : fence === '1' ? 'installed' : 'invalid',
        observedAt: Number(clock[0]), mutated: false });
    } catch (error) {
      const rejected = [401, 403].includes(error?.status);
      return res.status(rejected ? 200 : 503).json({ ...state,
        datastoreAuthorization: rejected ? 'rejected' : 'unconfirmed',
        ...(rejected ? { datastoreHttpStatus: error.status } : {}), mutated: false });
    }
  };
}
export default createCutoverStatus();
