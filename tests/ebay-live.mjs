// tests/ebay-live.mjs
// LIVE eBay API harness. Hits api.ebay.com for real.
//
//   node tests/ebay-live.mjs              → skips (exit 0), safe in the suite
//   EBAY_LIVE=1 node tests/ebay-live.mjs  → runs against production eBay
//
// Gated on purpose. The application-token endpoint is capped at 1,000 calls
// per day, and the standard suite runs on every commit — an ungated live test
// would quietly eat that budget and make the suite fail whenever eBay hiccups
// or the sandbox has no egress.
//
// Credentials are read from .env.production and passed through
// cleanCredential(), the same path the serverless functions use.

import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Load .env.production BEFORE importing helpers (they read process.env) ──
function loadEnvFile(name) {
  const p = join(ROOT, name);
  if (!existsSync(p)) return 0;
  let n = 0;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    if (process.env[m[1]] === undefined) { process.env[m[1]] = m[2]; n++; }
  }
  return n;
}

const loaded = loadEnvFile('.env.production') || loadEnvFile('.env.local');

const {
  cleanCredential, getEbayAppToken, fetchEbayAppToken, ebayHeaders, _resetTokenMemo,
} = await import('../api/_ebayAuth.js');
const {
  CARD_CATEGORIES, US_CATEGORY_TREE_ID, VERIFIED_TREE_VERSION,
  getDefaultCategoryTreeId, getItemAspectsForCategory, getRequiredAspectNames,
} = await import('../api/_ebayTaxonomy.js');

// ── Gate ──────────────────────────────────────────────────────────────────
if (process.env.EBAY_LIVE !== '1') {
  console.log('ebay-live: SKIPPED (set EBAY_LIVE=1 to run against production eBay)');
  console.log(`           loaded ${loaded} vars; creds present: ` +
    `${!!cleanCredential(process.env.EBAY_APP_ID)} / ${!!cleanCredential(process.env.EBAY_CERT_ID)}`);
  process.exit(0);
}

let passed = 0, failed = 0, warned = 0;
function check(name, cond, hint = '') {
  // A Promise is never a truth value. `(async () => {...})()` is always
  // truthy, so passing one here asserts nothing while printing ok — we
  // shipped two of those. Make the whole category impossible, loudly.
  if (cond && typeof cond.then === 'function') {
    failed++;
    console.log(`  FAIL ${name}\n       → TEST_API_MISUSE: a Promise is not a truth value; await it or use checkAsync()`);
    return;
  }

  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${hint ? '\n       → ' + hint : ''}`); }
}
/** For assertions whose condition is async. Awaits, then asserts. */
async function checkAsync(name, thunk, hint) {
  let v;
  try { v = await (typeof thunk === 'function' ? thunk() : thunk); }
  catch (e) { v = false; hint = `threw: ${e.message}`; }
  return check(name, !!v, hint);
}

function warn(name, note) { warned++; console.log(`  warn ${name}\n       → ${note}`); }

async function get(url, token, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${url}${qs ? '?' + qs : ''}`, { headers: ebayHeaders(token) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

console.log(`\nebay-live: LIVE RUN (loaded ${loaded} vars from env file)\n`);

// ── 1. Credentials ────────────────────────────────────────────────────────
console.log('credentials');
const appId  = cleanCredential(process.env.EBAY_APP_ID);
const certId = cleanCredential(process.env.EBAY_CERT_ID);
check('App ID present and 40 chars', appId.length === 40, `got ${appId.length}`);
check('Cert ID present and 36 chars', certId.length === 36, `got ${certId.length}`);
if (process.env.EBAY_APP_ID !== appId) {
  warn('EBAY_APP_ID needed cleaning',
       'the stored value is malformed — clean it at the source (Vercel env / .env.production)');
}
if (process.env.EBAY_CERT_ID !== certId) {
  warn('EBAY_CERT_ID needed cleaning', 'same — clean at the source');
}

// ── 2. Application token ──────────────────────────────────────────────────
console.log('\napplication token');
let token = null;
try {
  const res = await fetchEbayAppToken();
  token = res.token;
  check('client_credentials returns a token', !!token);
  check('token expires in ~2h', res.expiresIn >= 3600, `expires_in=${res.expiresIn}`);
  check('token has eBay\'s expected prefix', token.startsWith('v^1.1#'),
        'eBay application tokens start with v^1.1# — a different shape means something changed');
} catch (e) {
  check('client_credentials returns a token', false,
        `${e.message} ${e.hint || ''} ${JSON.stringify(e.detail || '')}`);
}

if (!token) {
  console.log(`\n${passed} passed, ${failed} failed, ${warned} warnings — aborting, no token`);
  process.exit(1);
}

// ── 3. Caching ────────────────────────────────────────────────────────────
console.log('\ntoken caching');
_resetTokenMemo();
const c1 = await getEbayAppToken();
const c2 = await getEbayAppToken();
check('cached helper returns a usable token', !!c1);
check('two consecutive calls return the same token', c1 === c2,
      'if these differ, caching is broken and the 1,000/day cap will be hit');
const hasKv = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
if (!hasKv) warn('Redis not configured in this environment',
                 'token caching fell back to per-instance memory only');

// ── 4. Taxonomy ───────────────────────────────────────────────────────────
console.log('\ntaxonomy');
try {
  const tree = await getDefaultCategoryTreeId('EBAY_US');
  check('US default category tree id is "0"', tree.categoryTreeId === US_CATEGORY_TREE_ID,
        `got ${tree.categoryTreeId}`);
  if (tree.categoryTreeVersion !== VERIFIED_TREE_VERSION) {
    warn(`category tree version moved: ${VERIFIED_TREE_VERSION} → ${tree.categoryTreeVersion}`,
         're-verify the category ids and required aspects, then update _ebayTaxonomy.js');
  } else {
    check(`category tree version still ${VERIFIED_TREE_VERSION}`, true);
  }
} catch (e) {
  check('taxonomy tree id lookup', false, e.message);
}

console.log('\ncategory aspects — required set must match our constants');
for (const [key, cat] of Object.entries(CARD_CATEGORIES)) {
  try {
    const live = await getRequiredAspectNames(cat.id);
    const same = live.length === cat.requiredAspects.length &&
                 live.every(a => cat.requiredAspects.includes(a));
    check(`${key} (${cat.id}) requires [${cat.requiredAspects.join(', ')}]`, same,
          `eBay now returns [${live.join(', ')}] — update CARD_CATEGORIES before listing`);

    const full = await getItemAspectsForCategory(cat.id);
    const total = (full.aspects || []).length;
    if (total !== cat.totalAspects) {
      warn(`${key} aspect count moved: ${cat.totalAspects} → ${total}`,
           'informational only; new optional aspects may be worth filling for search placement');
    }
  } catch (e) {
    check(`${key} aspect lookup`, false, e.message);
  }
}

// ── 5. Browse API ─────────────────────────────────────────────────────────
console.log('\nbrowse api (ACTIVE listings only — not sold comps)');
try {
  const r = await get('https://api.ebay.com/buy/browse/v1/item_summary/search', token,
    { q: 'charizard base set holo', limit: '3' });
  check('item_summary/search returns 200', r.status === 200, `got ${r.status}: ${r.text.slice(0, 160)}`);
  const items = r.json?.itemSummaries || [];
  check('search returns at least one item', items.length > 0);
  check('items carry a price', items.every(i => i.price?.value));
  if (items[0]) {
    console.log(`       e.g. ${items[0].title?.slice(0, 58)} — ` +
                `$${items[0].price.value} ${items[0].price.currency}`);
  }
} catch (e) {
  check('browse search', false, e.message);
}

// ── 6. Known limitations — these SHOULD fail ──────────────────────────────
// Documented so that if eBay ever grants us access, the harness tells us
// instead of us assuming the door is still shut.
console.log('\nknown limitations (expected to be denied)');
try {
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${appId}:${certId}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights',
    }).toString(),
  });
  if (r.status === 200) {
    warn('Marketplace Insights scope is NOW GRANTED',
         'sanctioned SOLD comps are available — revisit api/ebay-sold.js, which currently parses search HTML');
  } else {
    check('Marketplace Insights scope still denied (sold comps unavailable)', r.status === 400,
          `got ${r.status} — investigate`);
  }
} catch (e) {
  warn('insights scope probe failed', e.message);
}

try {
  const r = await get('https://api.ebay.com/buy/browse/v1/item_summary/search', token,
    { q: 'charizard', filter: 'soldItems:true', limit: '1' });
  const rejected = (r.json?.warnings || []).some(w => w.errorId === 12002);
  if (rejected) {
    check('Browse still rejects a soldItems filter', true);
  } else {
    warn('Browse may now support a sold filter',
         'if so, api/ebay-sold.js can move off HTML parsing onto the sanctioned API');
  }
} catch (e) {
  warn('sold-filter probe failed', e.message);
}

// ── 7. Notification challenge hash ────────────────────────────────────────
// This is the check that caught the production bug on 2026-09-05.
console.log('\naccount-deletion endpoint');
const ENDPOINT = 'https://www.cardresell.org/api/ebay-notifications';
const vToken = cleanCredential(process.env.EBAY_VERIFICATION_TOKEN)
  || 'CardResell-eBay-Notify-2026-secure-token-v1';
const CHAL = 'harness-' + Date.now();

function expectedHash(tok) {
  const h = createHash('sha256');
  h.update(CHAL); h.update(tok); h.update(ENDPOINT);
  return h.digest('hex');
}

if (process.env.EBAY_VERIFICATION_TOKEN &&
    process.env.EBAY_VERIFICATION_TOKEN !== vToken) {
  warn('EBAY_VERIFICATION_TOKEN is malformed in this environment',
       'code now cleans it, but clean it at the source too so other tooling agrees');
}

try {
  const r = await fetch(`${ENDPOINT}?challenge_code=${encodeURIComponent(CHAL)}`,
    { headers: { Accept: 'application/json' } });
  const j = await r.json();
  check('deployed endpoint answers the challenge', r.status === 200 && !!j.challengeResponse);
  const want = expectedHash(vToken);
  if (j.challengeResponse === want) {
    check('deployed challenge hash matches the CLEAN token', true);
  } else {
    // Identify WHICH corruption production is hashing, so the fix is obvious
    // rather than a guess. These are the exact shapes seen on 2026-09-05.
    const candidates = [
      ['trailing real newline',        vToken + '\n'],
      ['trailing CRLF',                vToken + '\r\n'],
      ['trailing literal backslash-n', vToken + '\\n'],
      ['wrapped in double quotes',     '"' + vToken + '"'],
      ['quoted + literal newline',     '"' + vToken + '\\n"'],
      ['trailing space',               vToken + ' '],
    ];
    const hit = candidates.find(([, v]) => j.challengeResponse === expectedHash(v));
    check('deployed challenge hash matches the CLEAN token', false,
          hit
            ? `PRODUCTION IS HASHING A MALFORMED TOKEN (${hit[0]}). eBay endpoint validation ` +
              'will fail against a clean portal value. Fix: deploy the cleanCredential() call in ' +
              'api/ebay-notifications.js AND strip the stray character from the Vercel env value.'
            : `hash mismatch, cause unknown — deployed=${j.challengeResponse.slice(0, 16)}… ` +
              `expected=${want.slice(0, 16)}…. Confirm the token stored in eBay's portal matches ` +
              'EBAY_VERIFICATION_TOKEN exactly.');
  }
} catch (e) {
  warn('could not reach the deployed endpoint', e.message);
}

console.log(`\n${passed} passed, ${failed} failed, ${warned} warnings`);
process.exit(failed ? 1 : 0);
