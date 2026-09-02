import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import gradeOpportunity from '../api/grade-opportunity.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
const stripeCheckout = fs.readFileSync(path.join(root, 'api/stripe-checkout.js'), 'utf8');
const tierApi = fs.readFileSync(path.join(root, 'api/_tier.js'), 'utf8');
const userDataApi = fs.readFileSync(path.join(root, 'api/user-data.js'), 'utf8');
const collectionApi = fs.readFileSync(path.join(root, 'api/collection.js'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

console.log('\n[Launch audit regressions]');

check(
  'grade-opportunity client sends game exactly once',
  index.includes("fetch('/api/grade-opportunity?' + tcgParams.toString(),") &&
    !index.includes("tcgParams.toString() + (card.game ? '&game='")
);
check(
  'visible payout ranks use the tier-filtered eligible list',
  index.includes('const rankIdx = _eligibleDisplay.indexOf(r);')
);
check(
  'platform result tile is not an outer anchor',
  !index.includes('const cardTag  = sellUrl') &&
    index.includes('html += `<div class="${cls}">')
);
check(
  'sell destination remains a dedicated accessible link',
  index.includes('<a class="plat-sell-badge"') &&
    index.includes('aria-label="Open ${esc(info.name)} to sell this card"')
);
check(
  'retired Ultimate deep links map to Pro Max with an honest message',
  index.includes("['pro','pro_max','ultimate'].includes(upgradeParam)") &&
    index.includes("Ultimate was retired. Pro Max now includes all 15 venues.")
);
check(
  'non-applicable venues do not receive buyer-paid shipping',
  index.includes('const effectiveShipCharge = p.buyerShippingRevenue === false ? 0 : shipCharge;') &&
    (index.match(/buyerShippingRevenue: false/g) || []).length >= 8
);
check(
  'all-stale rankings show a reference-only warning',
  index.includes('All marketplace fee schedules are past the 45-day verification window.')
);
check(
  'hidden photo-tip images are deferred until the overlay opens',
  !index.includes('loading="lazy" src="/photo-tips/') &&
    index.includes("document.querySelectorAll('#photoTipsOverlay img[data-src]')")
);
check(
  'Stripe checkout requires verified token identity',
  stripeCheckout.includes("if (!idToken || idToken.length < 20)") &&
    !stripeCheckout.includes('fall through to body email')
);
check(
  'Stripe email fallback encodes plus-addressed emails',
  tierApi.includes("encodeURIComponent(email)")
);
check(
  'KV write failures are surfaced instead of returning false success',
  userDataApi.includes('kv_write_failed:') &&
    collectionApi.includes('kv_write_failed:')
);
check(
  'legacy unauthenticated Stripe redirect endpoints are removed',
  !fs.existsSync(path.join(root, 'api/stripe-pro-redirect.js')) &&
    !fs.existsSync(path.join(root, 'api/stripe-grade-redirect.js')) &&
    !fs.existsSync(path.join(root, 'api/stripe-id-redirect.js'))
);
check(
  'MTG pHash index is deployed and cached',
  vercel.includes('"src": "mtg-index.json"') &&
    vercel.includes('"src": "/mtg-index.json"')
);
check(
  'baseline security headers are configured',
  vercel.includes('"X-Content-Type-Options": "nosniff"') &&
    vercel.includes('"Strict-Transport-Security"') &&
    vercel.includes('"X-Frame-Options": "SAMEORIGIN"')
);

/* ── CR-021: mobile shop reachability ────────────────────────────────────
   The credit shop used to live only inside the gear settings panel, and the
   <=480px media query set `.hdr .settings-btn{display:none!important}`. On a
   phone in portrait that left NO route to buy ID scans or AI grades — a total
   revenue block on the majority device. These checks pin the fix. */

// Isolate the <=480px block so we only assert against mobile rules.
const mobileBlock = (index.match(/@media\(max-width:480px\)\{[\s\S]*?\n\}/) || [''])[0];

check(
  'CR-021 mobile media query does not hide the settings button',
  mobileBlock.length > 0 && !/\.hdr\s+\.settings-btn[^{]*\{[^}]*display:\s*none/.test(mobileBlock)
);
check(
  'CR-021 header exposes an always-visible Shop button',
  index.includes('id="shopBtn"') &&
    index.includes('openShop(\'id\',\'header\')') &&
    !/#shopBtn\s*\{[^}]*display:\s*none/.test(mobileBlock)
);
check(
  'CR-021 shop modal exists with both credit tabs',
  index.includes('id="shopOverlay"') &&
    index.includes('id="shopTabId"') &&
    index.includes('id="shopTabGrade"') &&
    index.includes('function openShop(')
);
check(
  'CR-021 shop lists all six credit packs at the canonical prices',
  ["shopBuy('id','10')", "shopBuy('id','50')", "shopBuy('id','100')",
   "shopBuy('grade','10')", "shopBuy('grade','25')", "shopBuy('grade','50')"]
    .every(s => index.includes(s)) &&
  ['$1.99', '$7.99', '$12.99', '$5.99', '$22.99'].every(s => index.includes(s))
);
check(
  'CR-021 shop reuses the hardened Stripe checkout starters',
  /function shopBuy\([\s\S]{0,260}startGradeScanCheckout\(qty\)[\s\S]{0,160}startIdScanCheckout\(qty\)/.test(index)
);
check(
  'CR-021 ?packs= deep link opens the shop, not the pack-less plan modal',
  index.includes("window.openShop(want, 'pricing_page_packs')") &&
    !index.includes("window.openPricingModal('pricing_page_packs_' + want)")
);
check(
  'CR-021 out-of-credit gates route to the shop rather than the plan modal',
  index.includes("openShop('id', 'id_scan_402')") &&
    index.includes("openShop('grade', 'grade_scan_402')") &&
    index.includes("openShop('grade', 'grade_scan_gate')") &&
    !index.includes("openPricingModal('id_scan_402')") &&
    !index.includes("openPricingModal('grade_scan_402')") &&
    !index.includes("openPricingModal('grade_scan_gate')")
);
check(
  'CR-021 low-credit toasts point at Shop, not the hidden Settings gear',
  !index.includes('top up anytime in Settings') &&
    !index.includes('tap Settings to buy more') &&
    index.includes('Shop to buy more')
);
check(
  'CR-021 client stores the monthly ID allowance so balances are not understated',
  index.includes('window._freeIdLeft = d.idFreeLeft || 0;')
);
check(
  'CR-021 shop copy does not claim the monthly allowance rolls over',
  index.includes('purchased credits never expire') &&
    !index.includes('Credits never expire, and unused ones roll over every month')
);

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    market: 100,
    cardName: 'Charizard',
    setName: 'Base Set',
  }),
});

const req = {
  method: 'GET',
  query: {
    name: 'Charizard',
    set: 'Base Set',
    number: '4',
    game: ['pokemon', 'pokemon'],
  },
  headers: { host: 'www.cardresell.org' },
};
const res = {
  statusCode: 200,
  headers: {},
  body: null,
  setHeader(k, v) { this.headers[k] = v; return this; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  end() { return this; },
};

try {
  await gradeOpportunity(req, res);
  check('duplicate query values do not crash grade-opportunity', res.statusCode === 200);
  check('grade-opportunity still returns a recommendation', !!res.body?.recommendation);
} catch (error) {
  check(`duplicate query values do not crash grade-opportunity (${error.message})`, false);
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
