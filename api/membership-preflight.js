import { membershipPreflight } from './_membershipPreflight.js';
import { membershipRedis } from './_membershipLegacyFence.js';
import { membershipWriterReadiness } from './_membershipWriterReadiness.js';
let pending;
let expires = 0;
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Vercel owns VERCEL_URL. Permit only this immutable Preview deployment's
  // hostname and the approved stable alias, never a caller-provided origin.
  const immutableHost = /^[a-z0-9-]+\.vercel\.app$/.test(process.env.VERCEL_URL || '')
    && req.headers.host === process.env.VERCEL_URL;
  const stableHost = req.headers.host === 'cardresell-membership-v2-preview.vercel.app';
  if (process.env.VERCEL_ENV !== 'preview'
    || (process.env.VERCEL_GIT_COMMIT_REF || process.env.MEMBERSHIP_PREFLIGHT_BRANCH) !== 'feature/launch-membership-v2'
    || (!stableHost && !immutableHost)) {
    return res.status(404).json({ status: 'DISABLED',
      previewEnvironment: process.env.VERCEL_ENV === 'preview',
      branchBound: (process.env.VERCEL_GIT_COMMIT_REF || process.env.MEMBERSHIP_PREFLIGHT_BRANCH) === 'feature/launch-membership-v2',
      stableHost });
  }
  if (req.method !== 'GET') return res.status(405).json({ status: 'METHOD_NOT_ALLOWED' });
  if (!pending || Date.now() >= expires) {
    expires = Date.now() + 60000;
    pending = membershipPreflight(process.env);
  }
  const result = { ...await pending, deployment: {
    commit: /^[a-f0-9]{40}$/.test(process.env.VERCEL_GIT_COMMIT_SHA || '') ? process.env.VERCEL_GIT_COMMIT_SHA : null,
    branch: 'feature/launch-membership-v2', environment: 'preview',
  }, writerReadiness: await membershipWriterReadiness({
    execute: membershipRedis, billingEnabled: process.env.MEMBERSHIP_BILLING_V2,
  }) };
  return res.status(result.status === 'PASS' ? 200 : 503).json(result);
}
