// Use the real grant table; only the external tier lookup is doubled.
import { TIER_BENEFITS, getUserTier as realGetUserTier } from '../../api/_tier.js';
export { TIER_BENEFITS };
export async function getUserTier(...args) {
  if (globalThis.__STUB?.useRealTier) return realGetUserTier(...args);
  return (globalThis.__STUB||{}).tier || 'pro';
}
export function isPaidTier(t) { return t !== 'free'; }
export default { getUserTier, TIER_BENEFITS, isPaidTier };
