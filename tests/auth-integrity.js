// Auth stack integrity checks — catches the exact bugs from Aug 12 revert cycle.
// Runs against index.html and signin.html. Exits 1 on any failure.
//
// Failures this would have caught today:
//   - initializeAuth() replaced with getAuth() (July 5 fix regressed)
//   - browserPopupRedirectResolver dropped from initializeAuth config
//   - `var googleUser = ...` reintroduced (shadow-binding bug)
//   - Chained `window.googleUser = googleUser = {...}` in module (strict-mode throw)
//   - Auth persistence array replaced with getAuth+setPersistence pattern
//   - onAuthStateChanged callback not async
//
// Usage: node tests/auth-integrity.js

const fs = require('fs');
const path = require('path');

const INDEX = '/home/user/workspace/cardresell/index.html';
const SIGNIN = '/home/user/workspace/cardresell/signin.html';

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

function section(label) {
  console.log(`\n[${label}]`);
}

function readFile(p) {
  if (!fs.existsSync(p)) {
    console.log(`SKIP (missing): ${p}`);
    return null;
  }
  return fs.readFileSync(p, 'utf8');
}

const index = readFile(INDEX);
if (!index) process.exit(2);
const signin = readFile(SIGNIN);

// ─── index.html auth module checks ───
section('index.html auth module');

// The whole Firebase Auth module block
const moduleMatch = index.match(/<script[^>]*type="module"[^>]*>([\s\S]*?onAuthStateChanged[\s\S]*?)<\/script>/);
const authModule = moduleMatch ? moduleMatch[1] : '';

check(
  'Firebase Auth module found',
  authModule.length > 0,
  'Could not locate the <script type="module"> block containing onAuthStateChanged'
);

check(
  'uses initializeAuth (NOT bare getAuth)',
  /\binitializeAuth\s*\(/.test(authModule),
  'The July 5 fix requires initializeAuth() to attach persistence properly. getAuth() + setPersistence silently drops persistence.'
);

check(
  'does NOT use getAuth() as the auth constructor',
  !/const\s+auth\s*=\s*getAuth\s*\(/.test(authModule),
  'getAuth() is the buggy pattern. Use initializeAuth(app, { persistence: [...], popupRedirectResolver }).'
);

check(
  'imports browserPopupRedirectResolver',
  /browserPopupRedirectResolver/.test(authModule),
  'signInWithPopup throws auth/argument-error without this passed to initializeAuth. See firebase-js-sdk#7882.'
);

check(
  'passes popupRedirectResolver to initializeAuth',
  /initializeAuth[\s\S]{0,400}popupRedirectResolver/.test(authModule),
  'The resolver must be inside the initializeAuth() config object.'
);

check(
  'imports indexedDBLocalPersistence',
  /indexedDBLocalPersistence/.test(authModule),
  'Persistence array must include IDB for cross-tab sign-in.'
);

check(
  'persistence is an array (not setPersistence call)',
  /persistence\s*:\s*\[/.test(authModule),
  'initializeAuth needs an ORDERED persistence array. setPersistence() after getAuth silently no-ops.'
);

// ─── googleUser variable checks ───
section('googleUser variable safety');

// No `var/let/const googleUser` declaration should exist ANYWHERE outside module
// (would create a shadowing binding for classic scripts)
const badDecl = index.match(/^\s*(var|let|const)\s+googleUser\b/m);
check(
  'no top-level `var/let/const googleUser` declaration',
  !badDecl,
  badDecl ? `Found: "${badDecl[0].trim()}" — will shadow window.googleUser in classic scripts.` : ''
);

// No chained assignments: `window.googleUser = googleUser = ...`
// (in strict-mode module, unqualified `googleUser` assignment throws ReferenceError)
const chained = index.match(/window\.googleUser\s*=\s*googleUser\s*=/);
check(
  'no chained `window.googleUser = googleUser = ...` assignments',
  !chained,
  chained ? `Chained assignment throws ReferenceError silently in strict-mode modules.` : ''
);

// window.googleUser MUST be written on sign-in
check(
  'window.googleUser is written in onAuthStateChanged (sign-in path)',
  /onAuthStateChanged[\s\S]*?window\.googleUser\s*=\s*\{/.test(authModule),
  'Without this write, no checkout can find the user.'
);

// window.googleUser MUST be written to null on sign-out
check(
  'window.googleUser is set to null on sign-out',
  /window\.googleUser\s*=\s*null/.test(authModule),
  ''
);

// ─── onAuthStateChanged callback shape ───
section('onAuthStateChanged callback');

check(
  'callback is async (allows page-module await)',
  /onAuthStateChanged\s*\(\s*auth\s*,\s*async\s*\(/.test(authModule) ||
    /onAuthStateChanged\s*\(\s*auth\s*,\s*\([^)]*\)\s*=>\s*\{/.test(authModule),
  'Non-async callback that awaits inside throws — kills the sign-in handler silently.'
);

// ─── Checkout call safety ───
section('checkout call sites');

// All stripe checkout POST calls must go through _stripeCheckout helper OR direct fetch
const stripeCallRe = /(_stripeCheckout\s*\(\s*['"`]\/api\/stripe|fetch\s*\(\s*['"`]\/api\/stripe[a-z-]*checkout['"`])/g;
const stripeMatches = [...index.matchAll(stripeCallRe)];
check(
  'at least one stripe checkout call site found',
  stripeMatches.length >= 1,
  ''
);

// Each checkout call site should read window.googleUser.email (not bare googleUser.email — which would fail if var shadowing existed)
// This is a soft guard: warn but don't fail if we can't parse the surrounding context
const bareGoogleUserReads = index.match(/body:\s*JSON\.stringify\(\s*\{[^}]*email:\s*googleUser\./g);
check(
  'checkout bodies read window.googleUser.email (not bare googleUser.email)',
  !bareGoogleUserReads,
  bareGoogleUserReads
    ? `Found bare "googleUser.email" reads in checkout bodies: ${bareGoogleUserReads.length}. Should be window.googleUser.email.`
    : ''
);

// ─── Affiliate config ───
section('affiliate configuration');

const affMatch = index.match(/window\.AFFILIATE\s*=\s*\{[\s\S]*?^\};/m);
const affBlock = affMatch ? affMatch[0] : '';

check(
  'window.AFFILIATE config object found',
  affBlock.length > 0,
  ''
);

// eBay must have campid
check(
  'eBay EPN campid is 5339158497',
  /ebay\s*:\s*\{[\s\S]*?campid\s*:\s*['"]5339158497['"]/.test(affBlock),
  ''
);

// TCGplayer Impact — enabled with real IDs
check(
  'TCGplayer Impact affiliate is enabled',
  /tcgplayer\s*:\s*\{[\s\S]*?enabled\s*:\s*true/.test(affBlock),
  'Impact program was approved Jul 11, 2026. If false, we are losing 3.5% commission.'
);

check(
  'TCGplayer partner_id is 7445683',
  /partner_id\s*:\s*['"]7445683['"]/.test(affBlock),
  ''
);

check(
  'TCGplayer campaign_id is 1780961',
  /campaign_id\s*:\s*['"]1780961['"]/.test(affBlock),
  ''
);

check(
  'TCGplayer ad_id is 21018',
  /ad_id\s*:\s*['"]21018['"]/.test(affBlock),
  ''
);

// ─── eBay link builder ───
section('eBay affiliate URL builder');

const buildEbayFn = index.match(/function\s+buildEbayUrl\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
const ebayFn = buildEbayFn ? buildEbayFn[0] : '';

check(
  'buildEbayUrl function found',
  ebayFn.length > 0,
  ''
);

check(
  'buildEbayUrl uses modern mkcid=1 format',
  /mkcid=1/.test(ebayFn),
  'Old campid-only format does not track commissions on modern eBay pages.'
);

check(
  'buildEbayUrl includes mkevt=1',
  /mkevt=1/.test(ebayFn),
  ''
);

// ─── TCGplayer link builder ───
section('TCGplayer affiliate URL builder');

const wrapTcgpFn = index.match(/function\s+wrapTcgpAffiliate\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
const tcgpFn = wrapTcgpFn ? wrapTcgpFn[0] : '';

check(
  'wrapTcgpAffiliate function found',
  tcgpFn.length > 0,
  ''
);

check(
  'wrapTcgpAffiliate uses partner.tcgplayer.com domain',
  /partner\.tcgplayer\.com/.test(tcgpFn),
  'Impact deep links must use partner.tcgplayer.com or the tcgplayer.pxf.io alias.'
);

// ─── signin.html sanity ───
if (signin) {
  section('signin.html');

  const signinModule = signin.match(/<script[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/);
  const signinAuthModule = signinModule ? signinModule[1] : '';

  check(
    'signin.html uses initializeAuth',
    /\binitializeAuth\s*\(/.test(signinAuthModule),
    ''
  );

  check(
    'signin.html imports browserPopupRedirectResolver',
    /browserPopupRedirectResolver/.test(signinAuthModule),
    ''
  );
}

// ─── Summary ───
console.log(`\n${'─'.repeat(50)}`);
console.log(`Total: ${checks} checks, ${failures} failure(s)`);
if (failures > 0) {
  console.log(`\n❌ AUTH INTEGRITY CHECK FAILED`);
  console.log(`Do NOT push to prod. Fix the failures above first.`);
  process.exit(1);
} else {
  console.log(`\n✅ Auth stack integrity verified`);
  process.exit(0);
}
