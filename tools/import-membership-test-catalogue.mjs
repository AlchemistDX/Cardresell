// Offline import only. Never connects to Stripe or writes environment settings.
import { readFile, writeFile } from 'node:fs/promises';
import { LAUNCH_PLANS, LAUNCH_PACKS } from '../api/_launchMembershipConfig.js';

export function importTestCatalogue(input) {
  if (input?.livemode !== false || !/^acct_[A-Za-z0-9]+$/.test(input.stripeContext)
    || !Array.isArray(input.items) || input.items.length !== 11) throw new Error('invalid_test_catalogue');
  const prices = { plans: {}, packs: {} }, seen = new Set(), priceIds = new Set();
  for (const item of input.items) {
    const group = item.kind === 'membership' ? 'plans' : item.kind === 'pack' ? 'packs' : null;
    const entry = group === 'plans' ? LAUNCH_PLANS[item.key] : group === 'packs' ? LAUNCH_PACKS[item.key] : null;
    const expected = group === 'plans' ? entry?.monthlyPriceCents : entry?.basePriceCents;
    if (!entry || item.key === 'free' || item.amount !== expected || seen.has(item.key)
      || !/^price_[A-Za-z0-9_]+$/.test(item.priceId) || priceIds.has(item.priceId)
      || !/^prod_[A-Za-z0-9_]+$/.test(item.productId)) throw new Error('catalogue_mismatch');
    seen.add(item.key); priceIds.add(item.priceId);
    prices[group][item.key] = { priceId: item.priceId, productId: item.productId };
  }
  if (Object.keys(prices.plans).length !== 4 || Object.keys(prices.packs).length !== 7) throw new Error('incomplete_catalogue');
  return {
    status: 'Offline import of owner-supplied test IDs. Not reverified with Stripe; not activated.',
    MEMBERSHIP_STRIPE_TEST_ACCOUNT: input.stripeContext,
    MEMBERSHIP_STRIPE_TEST_PRICES: prices,
    missing: ['Secret test key', 'Webhook secret', 'Canonical membership-discount coupon mappings',
      'Trusted customer context provisioning', 'Normal return/webhook and subscription lifecycle integration',
      'Real test-mode acceptance'],
  };
}
if (process.argv[1]?.endsWith('/import-membership-test-catalogue.mjs')) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Provide input catalogue and output paths');
  const result = importTestCatalogue(JSON.parse(await readFile(process.argv[2], 'utf8')));
  await writeFile(process.argv[3], JSON.stringify(result, null, 2) + '\n');
  console.log('Validated 4 monthly plans and 7 packs offline. No external changes.');
}
