// Live unauthenticated boundary checks. Provider GETs can populate normal
// caches/search counters. No card, draft, payment or telemetry record is seeded.
// Exit 0 = sampled contracts passed; 1 = failure; 2 = provider degraded.
// This is not authenticated persistence, payment or camera acceptance.
//
// Usage: node tests/endpoints-smoke.js [--base=https://www.cardresell.org]

import { pathToFileURL } from 'node:url';

const BASE = (process.argv.find(a => a.startsWith('--base=')) || '--base=https://www.cardresell.org').slice(7);

// [endpoint, method, expected_status_codes, body?]
export const cases = [
  // Public endpoints — should 200 or 400 (missing params)
  ['/api/ebay-sold?q=charizard+psa+10',  'GET',  [200, 502]],
  ['/api/tcg-price?q=charizard',         'GET',  [200]],
  ['/api/pro-status',                    'GET',  [200, 401]],
  ['/api/sports',                        'GET',  [400]],
  // Empty payload reaches the no-record branch, avoiding fake miss telemetry.
  ['/api/scan-miss',                     'POST', [204], {}],
  ['/api/tcgp-resolve?url=' + encodeURIComponent('https://prices.pokemontcg.io/tcgplayer/xy1-1'), 'GET', [200, 404, 502]],
  ['/api/tcgp-resolve?url=https://evil.example.com',                                              'GET', [400]],  // SSRF whitelist check

  // Auth-required endpoints — should 401 without token
  // Legacy purchase routes are fenced by api/_membershipLegacyFence.js and must
  // stay closed (503 membership_legacy_fenced / payment_cutover_pending).
  ['/api/stripe-checkout',               'POST', [503],       {}],
  ['/api/stripe-annual-checkout',        'POST', [503],       {}],
  ['/api/stripe-grade-checkout',         'POST', [503],  {}],
  ['/api/stripe-id-checkout',            'POST', [503],  {}],
  ['/api/stripe-portal',                 'POST', [503],       {}],
  ['/api/scan',                          'POST', [401],       {}],
  ['/api/scan-credits',                  'POST', [503],  {}],
  ['/api/collection',                    'POST', [401],  {}],
  ['/api/drafts',                        'GET',  [401]],
  ['/api/user-data',                     'GET',  [401]],
  ['/api/membership-catalogue',          'GET',  [200]],
];

export function classifyResponse(test, status, contentType, body) {
  const [ep, , expected] = test;
  const fail = detail => ({ state: 'fail', detail });
  const degraded = detail => ({ state: 'degraded', detail });
  const pass = detail => ({ state: 'pass', detail });
  if (!expected.includes(status)) return fail(`expected ${expected.join('/')}, got ${status}`);
  if (status === 204) return pass('empty telemetry payload accepted');
  if (!contentType?.includes('application/json') || !body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('expected a JSON object, not a login page or malformed response');
  }
  if (ep.startsWith('/api/stripe-')) {
    return body.error === 'membership_legacy_fenced' || body.error === 'membership_payment_cutover_pending'
      ? pass('legacy payment route fenced') : fail('unexpected payment fence response');
  }
  if (ep === '/api/scan-credits') {
    return body.error === 'membership_payment_cutover_pending' || body.error === 'membership_legacy_fenced'
      ? pass('legacy credits route fenced') : fail('unexpected credits fence response');
  }
  if (ep.startsWith('/api/ebay-sold')) {
    if (status === 502 || body.available === false || body.reason === 'provider_unavailable') return degraded('sold-comps provider unavailable');
    if (!Array.isArray(body.items) || !Number.isFinite(body.count)) return fail('missing sold-comps result shape');
    return body.count > 0 && body.items.length > 0 ? pass('sold comps returned') : degraded('no sold comps returned for the probe');
  }
  if (ep.startsWith('/api/tcg-price')) {
    // This intentionally broad query must refuse to guess a printing.
    return body.reason === 'ambiguous_printing' && body.market === null
      ? pass('ambiguous printing refused') : fail('broad Charizard query did not refuse ambiguous pricing');
  }
  if (ep.startsWith('/api/tcgp-resolve?url=https://evil')) {
    return typeof body.error === 'string' ? pass('unsupported destination refused') : fail('missing URL rejection');
  }
  if (ep.startsWith('/api/tcgp-resolve')) {
    if (status === 404 || status === 502) return degraded('known product URL could not be resolved');
    return typeof body.productId === 'string' && /^[1-9]\d*$/.test(body.productId) ? pass('product URL resolved') : fail('missing product ID');
  }
  if (ep === '/api/membership-catalogue') {
    return body.version === 'launch-v2' && body.purchaseEnabled === false && Array.isArray(body.plans) && body.plans.length > 0
      ? pass('public catalogue returned; anonymous purchasing disabled') : fail('unexpected public catalogue');
  }
  if (status >= 400) return typeof body.error === 'string' ? pass('request correctly refused') : fail('missing refusal reason');
  if (ep === '/api/pro-status') return body.isPro === false ? pass('anonymous visitor has no paid entitlement') : fail('unexpected anonymous entitlement');
  return fail('no response contract defined');
}

async function run() {
  console.log(`Smoke testing endpoints against ${BASE}\n`);
  let failures = 0, degraded = 0, checks = 0;

  for (const [ep, method, expected, body] of cases) {
    checks++;
    const url = `${BASE}${ep}`;
    try {
      const opts = { method, headers: {}, redirect: 'manual', signal: AbortSignal.timeout(25_000) };
      if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      const r = await fetch(url, opts);
      const payload = r.status === 204 ? null : await r.json().catch(() => null);
      const result = classifyResponse([ep, method, expected, body], r.status, r.headers.get('content-type'), payload);
      console.log(`  ${result.state.toUpperCase()} ${method} ${ep} → ${r.status}: ${result.detail}`);
      if (result.state === 'fail') failures++;
      if (result.state === 'degraded') degraded++;
    } catch (e) {
      failures++;
      console.log(`  ✗ ${method.padEnd(4)} ${ep.padEnd(38)} → NETWORK ERROR: ${e.message}`);
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Total: ${checks} checks, ${checks - failures - degraded} passed, ${degraded} degraded, ${failures} failed`);
  console.log('Signed-in persistence, paid fulfillment and physical camera flows were not exercised.');
  process.exitCode = failures ? 1 : degraded ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
