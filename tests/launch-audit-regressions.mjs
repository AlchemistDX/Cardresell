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
