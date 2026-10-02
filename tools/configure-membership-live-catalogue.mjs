// Operator CLI only. curl uses the approved credential proxy; Vercel receives
// secret values over stdin, never argv, files or logs. No charge/subscription
// creation, invoice payment, balance writes, activation or deployment here.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { LAUNCH_PLANS, LAUNCH_PACKS } from '../api/_launchMembershipConfig.js';
const accountId = 'acct_1Tno55FW2YZoedIZ';
const project = 'prj_NJbWQ7VxpYIjzpCDj7X7vtmEdLbU';
const team = 'team_6s4mtmL1E2PlqUbMADRWtGNs';
const scope = 'willsep200-9430s-projects';
const origin = 'https://www.cardresell.org';
const apply = process.argv.includes('--apply');
const catalogueOnly = process.argv.includes('--catalogue-only');
const insist = (v, code) => { if (!v) throw Error(code); };
const digest = x => createHash('sha256').update(x).digest('hex');
let productionCredential;
function stripe(path, body, operation) {
  const args = ['--silent', '--show-error', '--max-time', '25', '--cacert', '/etc/ssl/certs/ca-certificates.crt',
    '-H', 'Stripe-Version: 2026-08-26.dahlia'];
  if (body) {
    insist(apply, 'apply_required');
    args.push('-X', 'POST', '-H', 'Idempotency-Key: cr-live-v2-' + digest(operation));
  }
  const form = body ? new URLSearchParams(body).toString() : undefined;
  let input = form;
  if (productionCredential) {
    // Existing Vercel server credential stays in process memory/stdin. Never
    // argv, source, a file, console output, or a client response.
    args.push('--config', '-');
    input = `header = "Authorization: Bearer ${productionCredential}"\n`
      + (form ? `data = "${form}"\n` : '');
  } else if (body) args.push('--data-binary', '@-');
  args.push('https://api.stripe.com/v1/' + path);
  const raw = execFileSync('curl', args, { encoding: 'utf8', input });
  const result = JSON.parse(raw);
  if (result.error) throw Error('stripe_' + (result.error.code || result.error.type || 'failed'));
  return result;
}
function vercel(path, method = 'GET', body) {
  const args = ['api', path + (path.includes('?') ? '&' : '?') + 'teamId=' + team,
    '--scope', scope, '--token', process.env.VERCEL_TOKEN, '--method', method, '--raw'];
  if (body) args.push('--input', '-');
  return JSON.parse(execFileSync('vercel', args, { encoding: 'utf8', input: body ? JSON.stringify(body) : undefined,
    stdio: ['pipe', 'pipe', 'pipe'] }));
}
const events = ['checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed', 'invoice.payment_action_required',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'charge.refunded', 'refund.created', 'refund.updated', 'refund.failed',
  'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed'];
try {
  if (process.argv.includes('--use-production-key')) {
    const rows = vercel(`/v9/projects/${project}/env`).envs.filter(e =>
      e.key === 'STRIPE_SECRET_KEY' && e.target?.length === 1 && e.target[0] === 'production');
    insist(rows.length === 1, 'production_credential_ambiguous');
    const stored = vercel(`/v1/projects/${project}/env/${rows[0].id}`);
    productionCredential = typeof stored.value === 'string' ? stored.value.trim() : '';
    insist(/^(?:sk|rk)_live_[A-Za-z0-9]+$/.test(productionCredential), 'production_credential_invalid');
  }
  const account = stripe('account');
  insist(account.id === accountId && account.charges_enabled === true, 'wrong_account');
  const list = stripe('prices?limit=100&active=true');
  insist(list.has_more === false, 'price_inventory_incomplete');
  if (!apply) {
    console.log(JSON.stringify({ accountId, chargesEnabled: true, activeLivePrices: list.data.filter(p => p.livemode === true).length,
      action: 'Read-only inventory. Pass --apply for the authorized catalogue configuration, not activation.' }));
    process.exit(0);
  }
  const priceMap = { plans: {}, packs: {} };
  for (const [group, catalogue] of [['plans', LAUNCH_PLANS], ['packs', LAUNCH_PACKS]]) {
    for (const [name, c] of Object.entries(catalogue)) {
      if (name === 'free') continue;
      const productId = `prod_cr_launch_v2_${group}_${name}`;
      const lookup = `cr_launch_v2_${group}_${name}_usd`;
      const amount = group === 'plans' ? c.monthlyPriceCents : c.basePriceCents;
      let matches = list.data.filter(p => p.lookup_key === lookup);
      insist(matches.length <= 1, 'duplicate_price');
      if (!matches.length) {
        const title = group === 'plans' ? `CardResell ${name[0].toUpperCase() + name.slice(1)} Monthly`
          : `${c.credits} ${c.kind === 'id' ? 'ID' : 'Grade'} Credits`;
        const description = group === 'plans'
          ? `${c.idCredits} ID + ${c.gradeCredits} Grade credits added each paid month. Issued credits never expire. Cancel at period end.`
          : `${c.credits} ${c.kind === 'id' ? 'identification' : 'grading'} credits. Credits never expire.`;
        const products = stripe('products?limit=100');
        insist(products.has_more === false, 'product_inventory_incomplete');
        let product = products.data.find(p => p.id === productId);
        if (!product) product = stripe('products', { id: productId, name: title, description,
          'metadata[membership_version]': 'launch-v2', 'metadata[selection]': name }, `product-${productId}`);
        insist(product.id === productId && product.livemode === true && product.active === true, 'product_mismatch');
        const body = { product: productId, currency: 'usd', unit_amount: String(amount),
          lookup_key: lookup, nickname: title, 'metadata[membership_version]': 'launch-v2' };
        if (group === 'plans') body['recurring[interval]'] = 'month';
        matches = [stripe('prices', body, `price-${lookup}`)];
      }
      const p = stripe('prices/' + matches[0].id);
      insist(p.livemode === true && p.active === true && p.product === productId
        && p.currency === 'usd' && p.unit_amount === amount
        && (group === 'plans' ? p.recurring?.interval === 'month' && p.recurring.interval_count === 1
          : p.type === 'one_time' && p.recurring === null), 'price_mismatch');
      priceMap[group][name] = { priceId: p.id, productId };
    }
  }
  const packProducts = Object.values(priceMap.packs).map(p => p.productId).sort();
  const coupons = { free: null, starter: null };
  const couponList = stripe('coupons?limit=100&expand[]=data.applies_to');
  insist(couponList.has_more === false, 'coupon_inventory_incomplete');
  for (const [plan, percent] of [['casual', 10], ['pro', 15], ['business', 25]]) {
    const id = `CR_LAUNCH_V2_${plan.toUpperCase()}_${percent}`;
    let coupon = couponList.data.find(c => c.id === id);
    if (!coupon) {
      const body = { id, percent_off: String(percent), duration: 'once', name: `${plan} credit-pack discount` };
      packProducts.forEach((product, i) => { body[`applies_to[products][${i}]`] = product; });
      coupon = stripe('coupons', body, `coupon-${id}`);
    }
    const actual = stripe(`coupons/${id}?expand[]=applies_to`);
    insist(actual.livemode === true && actual.valid === true && actual.percent_off === percent
      && actual.duration === 'once' && actual.amount_off === null && actual.max_redemptions === null
      && actual.redeem_by === null && JSON.stringify([...actual.applies_to.products].sort()) === JSON.stringify(packProducts),
    'coupon_mismatch');
    coupons[plan] = coupon.id;
  }
  const portals = stripe('billing_portal/configurations?limit=100');
  insist(portals.has_more === false, 'portal_inventory_incomplete');
  let portal = portals.data.find(p => p.metadata?.membership_version === 'launch-v2');
  if (!portal) portal = stripe('billing_portal/configurations', {
    'metadata[membership_version]': 'launch-v2', 'business_profile[headline]': 'Manage your CardResell membership',
    'business_profile[privacy_policy_url]': origin + '/privacy', 'business_profile[terms_of_service_url]': origin + '/terms',
    'features[payment_method_update][enabled]': 'true', 'features[invoice_history][enabled]': 'true',
    'features[subscription_cancel][enabled]': 'true', 'features[subscription_cancel][mode]': 'at_period_end',
    'features[subscription_cancel][proration_behavior]': 'none', 'features[subscription_update][enabled]': 'false',
  }, 'portal-v1');
  insist(portal.livemode === true && portal.active === true && portal.features.subscription_update.enabled === false
    && portal.features.subscription_cancel.mode === 'at_period_end'
    && portal.features.payment_method_update.enabled === true && portal.features.invoice_history.enabled === true, 'portal_mismatch');
  if (catalogueOnly) {
    console.log(JSON.stringify({ accountId, livemode: true, priceMap, coupons,
      portalConfiguration: portal.id, returnOrigin: origin, events,
      productionPurchasingActivated: false, secretsExposed: false }, null, 2));
    process.exit(0);
  }
  const envs = vercel(`/v9/projects/${project}/env`).envs;
  function save(key, value) {
    const rows = envs.filter(e => e.key === key && e.target?.includes('production'));
    insist(rows.length <= 1 && rows.every(e => e.target.length === 1 && !e.gitBranch), 'env_scope_conflict');
    const body = { key, value, type: 'sensitive', target: ['production'] };
    if (rows.length) vercel(`/v9/projects/${project}/env/${rows[0].id}`, 'PATCH', body);
    else vercel(`/v10/projects/${project}/env`, 'POST', body);
  }
  // This creates configuration only. Purchase/live-billing flags are not set.
  save('MEMBERSHIP_STRIPE_LIVE_ACCOUNT', accountId);
  save('MEMBERSHIP_STRIPE_LIVE_PRICES', JSON.stringify(priceMap));
  save('MEMBERSHIP_STRIPE_LIVE_COUPONS', JSON.stringify(coupons));
  save('MEMBERSHIP_STRIPE_LIVE_PORTAL_CONFIGURATION', portal.id);
  save('MEMBERSHIP_STRIPE_LIVE_RETURN_ORIGIN', origin);
  save('MEMBERSHIP_LIVE_CREDENTIAL_SOURCE', 'existing');
  save('MEMBERSHIP_LIVE_OWNERS', JSON.stringify(['fzUpcrXKDdQzGORl0bLQ6mTwML73']));
  const hooks = stripe('webhook_endpoints?limit=100');
  insist(hooks.has_more === false, 'webhook_inventory_incomplete');
  let hook = hooks.data.find(w => w.url === origin + '/api/membership-webhook');
  if (!hook) {
    const body = { url: origin + '/api/membership-webhook', api_version: '2026-08-26.dahlia',
      description: 'CardResell launch-v2 membership fulfillment' };
    events.forEach((event, i) => { body[`enabled_events[${i}]`] = event; });
    hook = stripe('webhook_endpoints', body, 'webhook-production-v1');
    insist(/^whsec_[A-Za-z0-9]+$/.test(hook.secret), 'missing_new_webhook_secret');
    save('MEMBERSHIP_STRIPE_LIVE_WEBHOOK_SECRET', hook.secret);
  } else insist(envs.some(e => e.key === 'MEMBERSHIP_STRIPE_LIVE_WEBHOOK_SECRET'
    && e.type === 'sensitive' && e.target?.length === 1 && e.target[0] === 'production'), 'existing_webhook_secret_unverified');
  insist(hook.livemode === true && hook.api_version === '2026-08-26.dahlia'
    && JSON.stringify([...hook.enabled_events].sort()) === JSON.stringify([...events].sort()), 'webhook_mismatch');
  // Do not send live customer events to a not-yet-deployed membership route.
  hook = stripe('webhook_endpoints/' + hook.id, { disabled: 'true' }, 'webhook-await-activation-v1');
  insist(hook.status === 'disabled', 'webhook_disable_unconfirmed');
  console.log(JSON.stringify({ accountId, livemode: true, priceMap, coupons, portalConfiguration: portal.id,
    webhook: { id: hook.id, url: hook.url, status: hook.status, events },
    productionPurchasingActivated: false, secretsExposed: false }, null, 2));
} catch (error) {
  // Child-process exceptions can embed argv/stdout, including a response secret.
  // Never print the original exception or raw service response.
  const safeCode = typeof error?.message === 'string' && /^[a-z_]{1,80}$/.test(error.message)
    ? error.message : 'operation_unconfirmed';
  console.error('Live catalogue setup stopped: ' + safeCode
    + '. Reconcile the existing idempotent operation before retrying. No charge was requested.');
  process.exitCode = 1;
}
