import { membershipPreflight } from './_membershipPreflight.js';
let pending;
let expires = 0;
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.VERCEL_ENV !== 'preview'
    || process.env.VERCEL_GIT_COMMIT_REF !== 'feature/launch-membership-v2'
    || req.headers.host !== 'cardresell-membership-v2-preview.vercel.app') {
    return res.status(404).json({ status: 'DISABLED' });
  }
  if (req.method !== 'GET') return res.status(405).json({ status: 'METHOD_NOT_ALLOWED' });
  if (!pending || Date.now() >= expires) {
    expires = Date.now() + 60000;
    pending = membershipPreflight(process.env);
  }
  const result = await pending;
  return res.status(result.status === 'PASS' ? 200 : 503).json(result);
}
