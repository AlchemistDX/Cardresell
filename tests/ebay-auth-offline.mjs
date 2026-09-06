// tests/ebay-auth-offline.mjs
// Offline unit tests for the eBay auth + taxonomy helpers.
//
// No network. Runs in the standard suite on every commit.
//
// The first block is a REGRESSION TEST for the 2026-09-05 outage: every eBay
// value in .env.production and in Vercel carried a trailing literal "\n",
// which made eBay reject the Basic Auth header as invalid_client. That cost 24
// days, a support-ticket draft, and a needless Cert ID rotation. If anyone
// removes cleanCredential(), these tests fail loudly.

import {
  cleanCredential, describeCredential, getEbayCredentials,
  getEbayAppToken, fetchEbayAppToken, _resetTokenMemo, ebayHeaders,
} from '../api/_ebayAuth.js';

import {
  CARD_CATEGORIES, CONDITION, CONDITION_DESCRIPTOR, US_CATEGORY_TREE_ID,
  DESCRIPTOR_VALUES_RESOLVED, categoryForCard, buildRequiredAspects,
} from '../api/_ebayTaxonomy.js';

let passed = 0, failed = 0;
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


// ── 1. Credential hygiene (the regression) ────────────────────────────────
console.log('\ncredential hygiene — the August outage');

const SYNTHETIC_APP = 'FAKEUSER-Fakeapps-PRD-1f00d0000-deadbeef'; // 40 chars, synthetic - never put a real credential here
check('literal backslash-n suffix is stripped',
      cleanCredential(SYNTHETIC_APP + '\\n') === SYNTHETIC_APP,
      'this exact input produced 24 days of invalid_client');

check('quoted value with inner literal newline is stripped',
      cleanCredential('"' + SYNTHETIC_APP + '\\n"') === SYNTHETIC_APP,
      '.env.production stored it as KEY="value\\n" — quotes outside, escape inside');

check('real trailing newline is stripped',
      cleanCredential(SYNTHETIC_APP + '\n') === SYNTHETIC_APP,
      'Vercel stored values carried a real newline');

check('cleaned App ID is exactly 40 chars',
      cleanCredential('"' + SYNTHETIC_APP + '\\n"').length === 40);

check('repeated escape sequences are stripped',
      cleanCredential(SYNTHETIC_APP + '\\n\\n\\r') === SYNTHETIC_APP);

check('single quotes are peeled',
      cleanCredential("'" + SYNTHETIC_APP + "'") === SYNTHETIC_APP);

check('surrounding whitespace is stripped',
      cleanCredential('  ' + SYNTHETIC_APP + '  \t') === SYNTHETIC_APP);

check('interior characters are never touched',
      cleanCredential('PRD-f00dfeedface-0000-1111-2222-3333') === 'PRD-f00dfeedface-0000-1111-2222-3333',
      'a clean credential must pass through byte-identical');

check('a literal \\n in the MIDDLE is preserved',
      cleanCredential('abc\\ndef') === 'abc\\ndef',
      'only edges are stripped — never mangle a legitimate interior value');

check('nullish input yields empty string',
      cleanCredential(null) === '' && cleanCredential(undefined) === '');

check('unbalanced quote is left alone',
      cleanCredential('"' + SYNTHETIC_APP) === '"' + SYNTHETIC_APP,
      'only peel quotes when they are balanced');

// ── 2. Diagnostics never leak secrets ─────────────────────────────────────
console.log('\ndiagnostics');

const d = describeCredential('EBAY_CERT_ID', '"PRD-f00dfeedface-0000-1111-2222-3333\\n"');
check('describeCredential flags a dirty value', d.wasDirty === true,
      'this is the signal that was missing in August');
check('describeCredential reports the clean length', d.length === 36);
check('describeCredential never returns the full secret',
      d.prefix.length <= 8 && !JSON.stringify(d).includes('1111-2222-3333'),
      'error paths get logged; a Cert ID must not land in logs');

// ── 3. Missing-credential handling ────────────────────────────────────────
console.log('\nmissing credentials');

let threw = null;
try { getEbayCredentials({ EBAY_APP_ID: '', EBAY_CERT_ID: 'x' }); }
catch (e) { threw = e; }
check('empty App ID throws', threw !== null);
check('error carries a machine-readable code', threw?.code === 'EBAY_CREDS_MISSING');
check('error carries per-var diagnostics', Array.isArray(threw?.detail) && threw.detail.length === 2);

threw = null;
try { getEbayCredentials({ EBAY_APP_ID: '"\\n"', EBAY_CERT_ID: '"\\n"' }); }
catch (e) { threw = e; }
check('a value that is ONLY an escape sequence counts as missing', threw !== null,
      'otherwise we send "Basic OjA=" and get a baffling 401');

// ── 4. Token flow (mocked fetch) ──────────────────────────────────────────
console.log('\ntoken flow');

const realFetch = globalThis.fetch;
let tokenCalls = 0, lastInit = null;

function mockToken({ ok = true, body = null, status = 200 } = {}) {
  globalThis.fetch = (url, init) => {
    const u = String(url);
    if (u.includes('/identity/v1/oauth2/token')) {
      tokenCalls++; lastInit = init;
      return Promise.resolve({
        ok, status,
        text: () => Promise.resolve(body ?? JSON.stringify({
          access_token: 'v^1.1#i^1#test-token', expires_in: 7200,
          token_type: 'Application Access Token',
        })),
      });
    }
    // Redis unavailable in this test — mimic a failed cache
    return Promise.reject(new Error('no network'));
  };
}

const ENV = { EBAY_APP_ID: SYNTHETIC_APP, EBAY_CERT_ID: 'PRD-testcert' };

// Ensure no KV so the helper takes the in-memory path deterministically
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
process.env.EBAY_APP_ID  = '"' + SYNTHETIC_APP + '\\n"';   // deliberately dirty
process.env.EBAY_CERT_ID = '"PRD-testcert\\n"';

_resetTokenMemo();
mockToken();
tokenCalls = 0;

const t1 = await getEbayAppToken();
check('token is returned', t1 === 'v^1.1#i^1#test-token');
check('exactly one token request was made', tokenCalls === 1);

check('Basic auth header is used, not body credentials',
      /^Basic /.test(lastInit.headers.Authorization),
      'eBay 401s when client_id/secret go in the body — verified 2026-09-05');

const decoded = Buffer.from(lastInit.headers.Authorization.slice(6), 'base64').toString();
check('the DIRTY env value was cleaned before hashing into the header',
      decoded === `${SYNTHETIC_APP}:PRD-testcert`,
      `header carried: ${JSON.stringify(decoded)} — this is the whole point of the fix`);

check('grant_type is client_credentials', lastInit.body.includes('grant_type=client_credentials'));

const t2 = await getEbayAppToken();
check('second call is served from the in-instance memo', tokenCalls === 1 && t2 === t1,
      'app-token endpoint is capped at 1,000/day — caching is not optional');

const t3 = await getEbayAppToken({ forceRefresh: true });
check('forceRefresh bypasses the memo', tokenCalls === 2 && t3 === t1);

// Error surfacing
_resetTokenMemo();
mockToken({ ok: false, status: 401, body: '{"error":"invalid_client","error_description":"client authentication failed"}' });
threw = null;
try { await getEbayAppToken(); } catch (e) { threw = e; }
check('a 401 throws', threw !== null);
check('401 carries the HTTP status', threw?.status === 401);
check('invalid_client attaches the malformed-credential hint',
      typeof threw?.hint === 'string' && /newline|malformed/i.test(threw.hint),
      'next time this fails, the hint should point at the credential, not at eBay');

globalThis.fetch = realFetch;
_resetTokenMemo();

// ── 5. Headers ────────────────────────────────────────────────────────────
console.log('\nrequest headers');
const h = ebayHeaders('tok');
check('bearer token is set', h.Authorization === 'Bearer tok');
check('US marketplace is the default', h['X-EBAY-C-MARKETPLACE-ID'] === 'EBAY_US');

// ── 6. Verified taxonomy constants ────────────────────────────────────────
console.log('\ntaxonomy constants (verified live 2026-09-05)');
check('CCG category id', CARD_CATEGORIES.CCG.id === '183454');
check('Sports category id', CARD_CATEGORIES.SPORTS.id === '261328');
check('Non-sport category id', CARD_CATEGORIES.NON_SPORT.id === '183050');
check('US category tree id is "0"', US_CATEGORY_TREE_ID === '0');
check('CCG requires exactly one aspect: Game',
      CARD_CATEGORIES.CCG.requiredAspects.length === 1 &&
      CARD_CATEGORIES.CCG.requiredAspects[0] === 'Game');
check('Sports requires exactly one aspect: Sport',
      CARD_CATEGORIES.SPORTS.requiredAspects[0] === 'Sport');
check('Non-sport requires exactly one aspect: Franchise',
      CARD_CATEGORIES.NON_SPORT.requiredAspects[0] === 'Franchise');
check('graded condition id is 2750', CONDITION.GRADED === '2750');
check('ungraded condition id is 4000', CONDITION.UNGRADED === '4000');
check('grader / grade / cert descriptor ids',
      CONDITION_DESCRIPTOR.PROFESSIONAL_GRADER === '27501' &&
      CONDITION_DESCRIPTOR.GRADE === '27502' &&
      CONDITION_DESCRIPTOR.CERT_NUMBER === '27503');
check('descriptor VALUE ids are still flagged unresolved',
      DESCRIPTOR_VALUES_RESOLVED === false,
      'flip this only after reading real value ids from the API — never guess them');

// ── 7. Category routing ───────────────────────────────────────────────────
console.log('\ncategory routing');
check('a Pokémon card routes to CCG',
      categoryForCard({ game: 'Pokémon TCG', setName: 'Base Set' }).id === '183454');
check('set name alone is enough for Pokémon',
      categoryForCard({ setName: 'Pokemon Base Set' }).id === '183454');
check('Magic routes to CCG', categoryForCard({ game: 'Magic: The Gathering' }).id === '183454');
check('a card with a player routes to Sports',
      categoryForCard({ player: 'Michael Jordan', setName: '1986 Fleer' }).id === '261328');
check('Prizm routes to Sports', categoryForCard({ setName: 'Panini Prizm Basketball' }).id === '261328');
check('Star Wars routes to non-sport',
      categoryForCard({ franchise: 'Star Wars' }).id === '183050');
check('an unknown card defaults to CCG',
      categoryForCard({}).id === '183454',
      'Pokémon is the dominant inventory, so CCG is the safe default');

// ── 8. Required-aspect packet construction ────────────────────────────────
console.log('\nrequired-aspect mapping');
const okPacket = buildRequiredAspects({ game: 'Pokémon TCG', setName: 'Base Set' });
check('a complete card yields no missing aspects', okPacket.missing.length === 0);
check('Game aspect is an array (eBay requires arrays)',
      Array.isArray(okPacket.aspects.Game) && okPacket.aspects.Game[0] === 'Pokémon TCG');
check('packet carries the category id', okPacket.categoryId === '183454');

const sportsGap = buildRequiredAspects({ player: 'Michael Jordan', setName: '1986 Fleer' });
check('a sports card with no Sport value reports it missing',
      sportsGap.missing.includes('Sport'),
      'the packet must refuse to look listable when it is not');

const inferred = buildRequiredAspects({ setName: 'Pokemon Jungle' });
check('Pokémon is inferred when game is absent',
      inferred.aspects.Game?.[0] === 'Pokémon TCG' && inferred.missing.length === 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
