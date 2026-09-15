export const TIER_BENEFITS = { free: {}, pro: {}, pro_max: {} };
export async function getUserTier() { return (globalThis.__STUB||{}).tier || 'pro'; }
export function isPaidTier(t) { return t !== 'free'; }
export default { getUserTier, TIER_BENEFITS, isPaidTier };
