// Persistent rollback fence, independent of the rollout flag. This is not a
// bootstrap lock: activation still requires draining/fencing old writers.
import { createHash } from 'node:crypto';
export function listingAccountPrefix(owner) {
  return `listing:v2:${createHash('sha256').update(String(owner)).digest('hex')}`;
}
export async function legacyListingWriteGuard(kv, owner) {
  try {
    const base = listingAccountPrefix(owner);
    const account = await kv('get', `${base}:account`);
    const bootstrap = await kv('get', `${base}:bootstrap`);
    // Present malformed state must also block legacy writes. Only proven
    // absence of BOTH authorities permits the unchanged legacy branch.
    if (account === null && bootstrap === null) return null;
    return 'LISTING_ATOMIC_WRITE_REQUIRED';
  } catch { return 'LISTING_UNAVAILABLE'; }
}
