// Regression checks for the scan-to-search-grid fallback fix (Aug 12 2026).
//
// What could regress if someone touches _loadScannedCardExact:
//   - Silent-wrong-card mode (cards[0] fallthrough) coming back
//   - openCatalog fallback being re-added outside the feature flag branch
//   - _renderScanMissPanel getting deleted
//   - /api/scan-miss client hook being removed
//   - Feature flag inverted (defaults to OFF instead of ON)
//
// Usage: node tests/scan-miss.js

const fs = require('fs');

const INDEX = '/home/user/workspace/cardresell/index.html';
const SCAN_MISS_API = '/home/user/workspace/cardresell/api/scan-miss.js';

let failures = 0;
let checks = 0;

function check(name, cond, detail) {
  checks++;
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}`);
    if (detail) console.log(`      ${detail}`);
  }
}

const html = fs.readFileSync(INDEX, 'utf8');

console.log('\n[scan-miss regression checks]');

// Isolate the _loadScannedCardExact function body so we don't cross-match
// unrelated openCatalog calls elsewhere in the file.
const fnStart = html.indexOf('async function _loadScannedCardExact');
check('_loadScannedCardExact function still exists', fnStart >= 0);

let fnBody = '';
if (fnStart >= 0) {
  // Find the matching closing brace by tracking depth
  let depth = 0;
  let i = html.indexOf('{', fnStart);
  const start = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) { fnBody = html.slice(start, i + 1); break; }
    }
  }
}

check('_loadScannedCardExact function body extracted', fnBody.length > 100,
      `extracted ${fnBody.length} chars`);

// The silent-wrong-card bug: `if (!match) match = cards[0]` — must not exist
check('No unconditional cards[0] fallthrough (silent wrong-card bug)',
      !/if\s*\(!\s*match\s*\)\s*match\s*=\s*cards\[0\]/.test(fnBody),
      'The `if (!match) match = cards[0]` line would silently load the wrong card. Remove it.');

// The old openCatalog fallback must ONLY appear inside the feature-flag OFF branch.
// Strip line comments before counting so `// old openCatalog() fallback` docs don't
// count as a call site.
const fnBodyNoComments = fnBody.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const openCatalogCount = (fnBodyNoComments.match(/openCatalog\s*\(/g) || []).length;
check('openCatalog is called at most once inside _loadScannedCardExact (behind flag)',
      openCatalogCount <= 1,
      `Found ${openCatalogCount} openCatalog calls; expected 0 or 1 (only inside _SCAN_MISS_V2 === false branch)`);

// If openCatalog IS still in there, it MUST be gated by the feature flag
if (openCatalogCount >= 1) {
  check('openCatalog fallback is gated by _SCAN_MISS_V2 flag',
        /_SCAN_MISS_V2\s*===\s*false[\s\S]{0,400}openCatalog\s*\(/.test(fnBody),
        'openCatalog must appear inside the `if (window._SCAN_MISS_V2 === false)` branch, not as an unconditional fallback');
}

// Feature flag defaults to ON (the check is `=== false`, meaning anything else including undefined = new behavior)
check('Feature flag defaults to ON (checks for === false to trigger legacy)',
      /_SCAN_MISS_V2\s*===\s*false/.test(fnBody),
      'The flag check should be `window._SCAN_MISS_V2 === false` so the new panel is default');

// The new panel renderer must be reachable from the fallthrough
check('_renderScanMissPanel is called from the fallthrough',
      /_renderScanMissPanel\s*\(\s*pending\s*\)/.test(fnBody),
      '_renderScanMissPanel(pending) must be called when no confident match is found');

// The miss logger must be called
check('_logScanMiss is called from the fallthrough',
      /_logScanMiss\s*\(\s*pending\s*\)/.test(fnBody),
      '_logScanMiss(pending) must be called so we can see which cards are missing');

// Match reason tracking (Part 1 of the plan)
check('Match reason is tracked (matchReason variable exists)',
      /matchReason\s*=/.test(fnBody),
      'matchReason tracking was added so we know HOW a card matched. Do not remove.');

// Now check the standalone functions exist
console.log('\n[scan-miss helpers]');
check('_renderScanMissPanel function defined', /function\s+_renderScanMissPanel\s*\(/.test(html));
check('_scanMissAdjustName function defined', /function\s+_scanMissAdjustName\s*\(/.test(html));
check('_scanMissDismiss function defined', /function\s+_scanMissDismiss\s*\(/.test(html));
check('_logScanMiss function defined', /function\s+_logScanMiss\s*\(/.test(html));

// Panel uses affiliate URL builders (would lose revenue if raw eBay/TCG URLs were used)
check('Scan-miss panel uses buildEbayUrl (affiliate-tagged eBay button)',
      /_renderScanMissPanel[\s\S]{0,2000}buildEbayUrl\s*\(/.test(html),
      'The eBay button in the scan-miss panel MUST use buildEbayUrl to keep EPN affiliate tracking');
check('Scan-miss panel uses buildTcgpUrl (affiliate-tagged TCGplayer button)',
      /_renderScanMissPanel[\s\S]{0,2000}buildTcgpUrl\s*\(/.test(html),
      'The TCGplayer button in the scan-miss panel MUST use buildTcgpUrl to keep Impact affiliate tracking');

// Endpoint exists
console.log('\n[scan-miss API endpoint]');
const hasApi = fs.existsSync(SCAN_MISS_API);
check('/api/scan-miss.js endpoint file exists', hasApi);
if (hasApi) {
  const api = fs.readFileSync(SCAN_MISS_API, 'utf8');
  check('Endpoint accepts POST', /req\.method\s*!==\s*['"]POST['"]/.test(api) || /req\.method\s*===\s*['"]POST['"]/.test(api));
  check('Endpoint has CORS headers', /Access-Control-Allow-Origin/.test(api));
  check('Endpoint writes to KV', /KV_URL/.test(api) && /kv\s*\(/.test(api));
  check('Endpoint clips string fields to prevent abuse', /clip\s*\(|slice\s*\(\s*0/.test(api));
  check('Endpoint has TTL on stored records', /EXPIRE|TTL|EX['"]?\s*,/i.test(api));
}

console.log(`\n──────────────────────────────────────────────────`);
console.log(`Total: ${checks} checks, ${failures} failure(s)`);
if (failures > 0) {
  console.log(`\n❌ Scan-miss regression checks FAILED`);
  process.exit(1);
}
console.log(`\n✅ Scan-miss regressions covered`);
