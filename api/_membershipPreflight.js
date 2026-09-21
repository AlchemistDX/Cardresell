import { LAUNCH_PLANS, LAUNCH_PACKS } from './_launchMembershipConfig.js';
import { MEMBERSHIP_STRIPE_API_VERSION } from './_membershipStripe.js';

// Read-only deployment diagnostics. No credentials, Stripe response bodies,
// customer data or error messages are returned. No datastore is accessed.
export async function membershipPreflight(env, fetchImpl = fetch) {
  const checks = [];
  const check = (name, passed) => checks.push({ name, status: passed ? 'PASS' : 'FAIL' });
  if (env.VERCEL_ENV !== 'preview'
    || (env.VERCEL_GIT_COMMIT_REF || env.MEMBERSHIP_PREFLIGHT_BRANCH) !== 'feature/launch-membership-v2') {
    return { status: 'DISABLED', checks: [] };
  }
  const key = env.MEMBERSHIP_STRIPE_TEST_KEY;
  check('restricted_test_key_format', typeof key === 'string' && /^rk_test_[A-Za-z0-9]+$/.test(key));
  if (checks.at(-1).status === 'FAIL') return { status: 'FAIL', checks };
  async function get(path) {
    const r = await fetchImpl('https://api.stripe.com/v1/' + path, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { Authorization: 'Bearer ' + key, 'Stripe-Version': MEMBERSHIP_STRIPE_API_VERSION },
    });
    if (r.status !== 200 || r.redirected) {
      checks.push({ name: 'stripe_read_' + path.split(/[/?]/)[0],
        status: 'FAIL', httpStatus: r.status });
      throw Error('unavailable');
    }
    const text = await r.text();
    if (text.length > 1000000) throw Error('unavailable');
    return JSON.parse(text);
  }
  let prices;
  try { prices = JSON.parse(env.MEMBERSHIP_STRIPE_TEST_PRICES); } catch {}
  if (!prices?.plans || !prices?.packs) {
    check('price_mapping_present', false);
    return { status: 'FAIL', checks };
  }
  try {
    const account = await get('account');
    check('account_identity', account.object === 'account' && account.id === env.MEMBERSHIP_STRIPE_TEST_ACCOUNT);
    if (checks.at(-1).status === 'FAIL') return { status: 'FAIL', checks };
    for (const [group, catalogue] of [['plans', LAUNCH_PLANS], ['packs', LAUNCH_PACKS]]) {
      check(group + '_mapping_count', Object.keys(prices[group]).length === (group === 'plans' ? 4 : 7));
      for (const [name, config] of Object.entries(catalogue)) {
        if (name === 'free') continue;
        const mapping = prices[group][name];
        if (!/^price_[A-Za-z0-9_]+$/.test(mapping?.priceId)
          || !/^prod_[A-Za-z0-9_]+$/.test(mapping?.productId)) {
          check(name + '_mapping', false); continue;
        }
        const p = await get('prices/' + mapping.priceId);
        check(name + '_price', p.object === 'price' && p.id === mapping.priceId
          && p.active === true && p.livemode === false && p.product === mapping.productId
          && p.currency === 'usd' && p.unit_amount === (group === 'plans' ? config.monthlyPriceCents : config.basePriceCents)
          && (group === 'plans' ? p.type === 'recurring' && p.recurring?.interval === 'month'
            && p.recurring.interval_count === 1 : p.type === 'one_time' && p.recurring == null));
        const product = await get('products/' + mapping.productId);
        check(name + '_product', product.object === 'product' && product.id === mapping.productId
          && product.active === true && product.livemode === false);
      }
    }
    const products = Object.values(prices.packs).map(p => p.productId).sort();
    const candidates = [];
    let cursor = '';
    for (let page = 0; page < 10; page++) {
      const list = await get('coupons?limit=100&expand[]=data.applies_to' + (cursor ? '&starting_after=' + encodeURIComponent(cursor) : ''));
      if (list.object !== 'list' || !Array.isArray(list.data) || typeof list.has_more !== 'boolean') throw Error('unavailable');
      candidates.push(...list.data);
      if (!list.has_more) break;
      if (page === 9 || !list.data.length) throw Error('unavailable');
      cursor = list.data.at(-1).id;
    }
    const couponMap = { free: null, starter: null }, couponDiagnostics = {};
    for (const [plan, percent] of [['casual', 10], ['pro', 15], ['business', 25]]) {
      const matches = candidates.filter(c => c.object === 'coupon' && c.livemode === false && c.valid === true
        && c.percent_off === percent && c.amount_off === null && c.currency === null && c.duration === 'once'
        && Array.isArray(c.applies_to?.products)
        && JSON.stringify([...c.applies_to.products].sort()) === JSON.stringify(products));
      check(plan + '_unique_pack_coupon', matches.length === 1);
      couponDiagnostics[plan] = {
        exactMatches: matches.length,
        candidates: candidates.filter(c => c.percent_off === percent).map(c => ({
          id: c.id, objectMatches: c.object === 'coupon', testMode: c.livemode === false,
          valid: c.valid === true, amountOffNull: c.amount_off === null,
          currencyNull: c.currency === null, once: c.duration === 'once',
          productRestrictionPresent: Array.isArray(c.applies_to?.products),
          productCount: Array.isArray(c.applies_to?.products) ? c.applies_to.products.length : null,
          missingPackProducts: products.filter(p => !c.applies_to?.products?.includes(p)),
          extraProductCount: Array.isArray(c.applies_to?.products)
            ? c.applies_to.products.filter(p => !products.includes(p)).length : null,
        })),
      };
      if (matches.length === 1) couponMap[plan] = matches[0].id;
    }
    const portalId = env.MEMBERSHIP_STRIPE_TEST_PORTAL_CONFIGURATION;
    if (!/^bpc_[A-Za-z0-9_]+$/.test(portalId)) throw Error('unavailable');
    const portal = await get('billing_portal/configurations/' + portalId), f = portal.features;
    check('portal_configuration', portal.object === 'billing_portal.configuration' && portal.id === portalId
      && portal.active === true && portal.livemode === false
      && f?.payment_method_update?.enabled === true && f?.invoice_history?.enabled === true
      && f?.subscription_cancel?.enabled === true && f.subscription_cancel.mode === 'at_period_end'
      && f?.subscription_update?.enabled === false);
    check('webhook_secret_present', /^whsec_[A-Za-z0-9]+$/.test(env.MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET));
    return { status: checks.every(c => c.status === 'PASS') ? 'PASS' : 'FAIL', checks, couponDiagnostics,
      // Coupon identifiers are public catalogue configuration, not secrets.
      ...(Object.keys(couponMap).length === 5 ? { couponMap } : {}) };
  } catch {
    check('canonical_read_complete', false);
    return { status: 'FAIL', checks };
  }
}
