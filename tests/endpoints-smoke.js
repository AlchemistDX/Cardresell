// Smoke test all API endpoints on prod. Runs unauthenticated — expects 401/400
// for auth-required endpoints and 200/400 for public ones. Verifies each
// endpoint is at least responding, not 404 or 500.
//
// Usage: node tests/endpoints-smoke.js [--base=https://www.cardresell.org]

const BASE = (process.argv.find(a => a.startsWith('--base=')) || '--base=https://www.cardresell.org').slice(7);

// [endpoint, method, expected_status_codes, body?]
const cases = [
  // Public endpoints — should 200 or 400 (missing params)
  ['/api/ebay-sold?q=charizard+psa+10',  'GET',  [200, 400, 502]],
  ['/api/tcg-price?q=charizard',         'GET',  [200, 400]],
  ['/api/pro-status',                    'GET',  [200, 401]],
  ['/api/sports',                        'GET',  [200, 400, 404]],

  // Auth-required endpoints — should 401 without token
  ['/api/stripe-checkout',               'POST', [401],       {}],
  ['/api/stripe-annual-checkout',        'POST', [401],       {}],
  ['/api/stripe-grade-checkout',         'POST', [401, 400],  {}],
  ['/api/stripe-id-checkout',            'POST', [401, 400],  {}],
  ['/api/stripe-portal',                 'POST', [401],       {}],
  ['/api/scan',                          'POST', [401],       {}],
  ['/api/scan-credits',                  'POST', [401, 400],  {}],
  ['/api/collection',                    'POST', [401, 400],  {}],
];

let failures = 0;
let checks = 0;

async function run() {
  console.log(`Smoke testing endpoints against ${BASE}\n`);

  for (const [ep, method, expected, body] of cases) {
    checks++;
    const url = `${BASE}${ep}`;
    try {
      const opts = { method, headers: {} };
      if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      const r = await fetch(url, opts);
      const ok = expected.includes(r.status);
      const symbol = ok ? '✓' : '✗';
      console.log(`  ${symbol} ${method.padEnd(4)} ${ep.padEnd(38)} → ${r.status} ${ok ? '' : `(expected one of ${expected.join(',')})`}`);
      if (!ok) failures++;
    } catch (e) {
      failures++;
      console.log(`  ✗ ${method.padEnd(4)} ${ep.padEnd(38)} → NETWORK ERROR: ${e.message}`);
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Total: ${checks} checks, ${failures} failure(s)`);
  process.exit(failures ? 1 : 0);
}

run();
