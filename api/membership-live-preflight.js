import { membershipPreflight } from './_membershipPreflight.js';
import { membershipWriterReadiness } from './_membershipWriterReadiness.js';
import { membershipRedis } from './_membershipLegacyFence.js';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (process.env.VERCEL_ENV !== 'production' || process.env.MEMBERSHIP_LIVE_PREFLIGHT !== 'enabled') {
    return res.status(404).json({ error: 'not_found' });
  }
  const result = await membershipPreflight(process.env, globalThis.fetch, 'live');
  const commit = process.env.VERCEL_GIT_COMMIT_SHA;
  return res.status(result.status === 'PASS' ? 200 : 503).json({
    ...result, deployment: { environment: 'production', commit: /^[a-f0-9]{40}$/.test(commit || '') ? commit : null },
    purchasingEnabled: process.env.MEMBERSHIP_PURCHASE_LIVE_MODE === 'enabled',
    writerReadiness: await membershipWriterReadiness({ execute: membershipRedis,
      billingEnabled: process.env.MEMBERSHIP_BILLING_V2 }),
  });
}
