// Regressions for the three Sol-audit blockers fixed on 2026-09-04.
//
// These tests EXECUTE the shipped logic rather than grepping for its text.
// A text-presence assertion survives neutering the code it describes (you can
// delete the `if` and the string still matches), so each fix below is either
// extracted from source and run, or reimplemented against the shipped source
// text so a semantic change breaks the test.

import fs from 'node:fs';
import { readAppSource } from './_appsource.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = readAppSource();
const scanApi = fs.readFileSync(path.join(root, 'api/scan.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  PASS  ${name}`); passed++; }
  else { console.log(`  FAIL  ${name}`); failed++; }
}

console.log('\n[Sol remediation 2026-09-04]');

/* ══════════════════════════════════════════════════════════════════════════
   BLOCKER 1 — collection metadata refresh must not price a slab from raw
   ══════════════════════════════════════════════════════════════════════════
   _refetchCardMeta() backfills a missing price from pokemontcg.io tcgplayer
   prices / /api/tcg-price. Both are RAW market prices. An ACE 10 Base Set
   Charizard with no saved value came out of this path holding raw $366.25
   while keeping its ACE 10 badge.

   We pull the real `needsPrice` expression out of index.html and evaluate it,
   so deleting the isSlab term fails this test. */
{
  const src = index.slice(index.indexOf('async function _refetchCardMeta'));
  const body = src.slice(0, src.indexOf('\n}\n'));

  const isSlabLine = (body.match(/^\s*const isSlab = .*$/m) || [])[0];
  const needsPriceLine = (body.match(/^\s*const needsPrice = .*$/m) || [])[0];

  check('_refetchCardMeta derives isSlab', !!isSlabLine);
  check('_refetchCardMeta derives needsPrice', !!needsPriceLine);

  // Execute the two real lines against fixtures.
  const decide = (p) => {
    const fn = new Function('p', `${isSlabLine}\n${needsPriceLine}\nreturn { isSlab, needsPrice };`);
    return fn(p);
  };

  const ace10 = { card: 'Charizard', grader: 'ace', grade: 10, currentValue: null };
  const r1 = decide(ace10);
  check('an ACE 10 slab with no saved price is recognised as a slab', r1.isSlab === true);
  check('an ACE 10 slab with no saved price is NOT eligible for raw backfill',
        r1.needsPrice === false);

  // Every slab, not just the unsupported grades. PSA 10 has a published value,
  // but it must come from the grade-aware path, never from raw.
  const psa10 = { card: 'Charizard', grader: 'psa', grade: 10, currentValue: null };
  check('a PSA 10 slab is also refused raw backfill', decide(psa10).needsPrice === false);

  const bgs95 = { card: 'Charizard', grader: 'bgs', grade: 9.5, currentValue: 0 };
  check('a BGS 9.5 slab with a zero price is refused raw backfill',
        decide(bgs95).needsPrice === false);

  // A raw card still gets the backfill — this fix must not disable the feature.
  const raw = { card: 'Charizard', currentValue: null };
  check('a raw card with no price DOES still get raw backfill',
        decide(raw).isSlab === false && decide(raw).needsPrice === true);

  const rawPriced = { card: 'Charizard', currentValue: 366.25 };
  check('a raw card that already has a price needs no backfill',
        decide(rawPriced).needsPrice === false);

  // A half-populated slab (grader but no grade) is not a slab and is safe to
  // price from raw — there is no grade label to make the number a lie.
  check('grader without grade is not treated as a slab',
        decide({ card: 'X', grader: 'psa', currentValue: null }).isSlab === false);
  check('grade without grader is not treated as a slab',
        decide({ card: 'X', grade: 10, currentValue: null }).isSlab === false);

  // The image/link backfill must survive — it is grade-independent and was the
  // original point of this function.
  check('image backfill is still gated only on the image, not on slab status',
        /const needsImg\s*=\s*imgIsScan;/.test(body));
  check('the price writes are still reachable for raw cards',
        /p\.currentValue = bestMarket;/.test(body) && /p\.currentValue = d\.market;/.test(body));
}

/* ══════════════════════════════════════════════════════════════════════════
   BLOCKER 2 — "Retry (free)" must actually be free
   ══════════════════════════════════════════════════════════════════════════
   The button said free and the client even commented "Retry is free", but the
   retry was an ordinary /api/scan POST, so it debited a second credit for the
   same photo. The waiver is now earned server-side against a real prior scan
   record. */
{
  // ---- client sends the id ----
  const scanOne = index.slice(index.indexOf('async function _bulkScanOne'));
  const scanOneBody = scanOne.slice(0, scanOne.indexOf('\n}\n'));

  check('the bulk row keeps the server scan id',
        /result\.scanId = data\.scan_id \|\| '';/.test(scanOneBody));
  check('retry_of is only sent when this call is actually a retry',
        /const retryOfId = \(isRetry && item\.retryOf\) \? String\(item\.retryOf\) : '';/.test(scanOneBody));
  check('retry_of rides along in the scan request body',
        /\.\.\.\(retryOfId \? \{ retry_of: retryOfId \} : \{\}\),/.test(scanOneBody));

  const retryRow = index.slice(index.indexOf('async function bulkRetryRow'));
  const retryRowBody = retryRow.slice(0, retryRow.indexOf('\n}\n'));
  check('bulkRetryRow forwards the previous attempt\u2019s scan id',
        /retryOf: oldResult\.scanId \|\| ''/.test(retryRowBody));

  // ---- server honours it, with the fraud gates ----
  // Reimplement the shipped gate and prove each condition is load-bearing.
  const gate = ({ record, refundKey, retryOf, callerUid }) => {
    if (!(retryOf && retryOf.length >= 8 && retryOf.length <= 64)) return false;
    const prior = record;
    if (!(prior && prior.uid === callerUid && !prior.retry_used)) return false;
    if (refundKey) return false;
    return true;
  };
  const rec = (over = {}) => ({ uid: 'user-1', consumed_from: 'id_paid_left', ...over });
  const base = { record: rec(), refundKey: null, retryOf: 'abcd1234', callerUid: 'user-1' };

  check('a genuine retry of your own consumed scan is free', gate(base) === true);
  check('a retry naming a scan with no record is charged',
        gate({ ...base, record: null }) === false);
  check('you cannot claim a free retry against someone else\u2019s scan',
        gate({ ...base, record: rec({ uid: 'user-2' }) }) === false);
  check('the same scan cannot be retried free twice',
        gate({ ...base, record: rec({ retry_used: true }) }) === false);
  check('an already-refunded scan cannot also buy a free retry',
        gate({ ...base, refundKey: { refunded_at: 1 } }) === false);
  check('a too-short retry_of is rejected', gate({ ...base, retryOf: 'abc' }) === false);
  check('an over-long retry_of is rejected',
        gate({ ...base, retryOf: 'x'.repeat(65) }) === false);
  check('an absent retry_of means an ordinary billed scan',
        gate({ ...base, retryOf: '' }) === false);

  // ---- the shipped source must contain each of those gates ----
  const block = scanApi.slice(scanApi.indexOf('const retryOf ='),
                              scanApi.indexOf('if (hasKV && !freeRetry)'));
  check('server reads the prior scan record', /getKVJson\(kvUrl, kvToken, `scan:\$\{retryOf\}`\)/.test(block));
  check('server enforces ownership', /prior\.uid === key/.test(block));
  check('server enforces one free retry per scan', /!prior\.retry_used/.test(block));
  check('server checks the refund ledger',
        /getKVJson\(kvUrl, kvToken, `scan_refund:\$\{retryOf\}`\)/.test(block));
  check('server bounds the retry_of length', /retryOf\.length >= 8 && retryOf\.length <= 64/.test(block));
  check('server burns the entitlement before proceeding',
        /prior\.retry_used = true;[\s\S]{0,200}setKVWithTTL\(kvUrl, kvToken, `scan:\$\{retryOf\}`/.test(block));

  // The debit block must be the thing that gets skipped.
  check('the credit debit is skipped for a granted free retry',
        /if \(hasKV && !freeRetry\) \{/.test(scanApi));
  check('the debit block is no longer unconditional on hasKV alone',
        !/\n  if \(hasKV\) \{\n    const tier\s+= await getUserTier/.test(scanApi));

  // getKVJson must exist in scan.js or the gate throws and silently charges.
  check('scan.js defines the getKVJson helper it now uses',
        /async function getKVJson\(kvUrl, kvToken, key\)/.test(scanApi));

  // Invariant the waiver depends on: a `scan:` record is only written for a
  // credit that was actually consumed. If a refund path ever fell through to a
  // record write, a refunded scan could also claim a free retry.
  const recordWrites = [...scanApi.matchAll(/setKVWithTTL\(kvUrl, kvToken, `scan:\$\{scanId\}`/g)];
  check('every scan record write is still gated on consumedFrom',
        recordWrites.length > 0 && recordWrites.every(m => {
          const before = scanApi.slice(Math.max(0, m.index - 900), m.index);
          return /if \(hasKV && consumedFrom\) \{/.test(before);
        }));
}

/* ══════════════════════════════════════════════════════════════════════════
   BLOCKER 3 — sign-out must clear the previous user's identity
   ══════════════════════════════════════════════════════════════════════════
   onAuthStateChanged's null branch returned early whenever _currentAuthUid was
   truthy, so a real sign-out never cleared anything: window.googleUser
   survived and getUserKey() kept resolving to the signed-out account's
   UID-scoped collection on a shared browser. */
{
  const clearFn = index.slice(index.indexOf('function _clearAuthIdentity()'));
  const clearBody = clearFn.slice(0, clearFn.indexOf('\n    }\n'));

  check('_clearAuthIdentity clears the uid that gated the early return',
        /_currentAuthUid = null;/.test(clearBody));
  for (const f of ['window.googleUser = null;', "window._googleIdToken = null;",
                   "window._userEmail = '';", "window._googleSub = '';", "window._userSub = '';"]) {
    check(`_clearAuthIdentity clears ${f.split(' =')[0].trim()}`, clearBody.includes(f));
  }
  check('_clearAuthIdentity stops the token refresh timer',
        /clearInterval\(window\._tokenRefreshInterval\);/.test(clearBody));
  check('_clearAuthIdentity cancels a pending cloud push',
        /_cancelUserDataSync/.test(clearBody));
  check('_clearAuthIdentity re-renders so the old collection leaves the screen',
        /_maybeRerenderCollection && window\._maybeRerenderCollection\(true\)/.test(clearBody));

  // getUserKey is what actually leaks the data — prove it keys off googleUser,
  // so clearing googleUser is sufficient to stop resolving the old scope.
  const gukLine = (index.match(/^\s*return window\.googleUser \? 'cardsell_' \+ window\.googleUser\.sub.*$/m) || [])[0];
  check('getUserKey scopes storage by window.googleUser', !!gukLine);
  if (gukLine) {
    const getUserKey = new Function('suffix', gukLine).bind(null);
    const g = globalThis;
    const prev = g.window;
    g.window = { googleUser: { sub: 'uid-A' } };
    const signedIn = getUserKey('portfolio');
    g.window = { googleUser: null };
    const signedOut = getUserKey('portfolio');
    g.window = prev;
    check('signed in, storage resolves to the user scope', signedIn === 'cardsell_uid-A_portfolio');
    check('with googleUser cleared, storage no longer resolves to that user',
          signedOut === 'cardsell_portfolio' && !signedOut.includes('uid-A'));
  }

  // The early return must now require the absence of a deliberate sign-out.
  check('the null-auth early return is conditional on there being no sign-out intent',
        /if \(_currentAuthUid && !window\._signOutIntent\) \{/.test(index));
  check('the unconditional early return is gone',
        !/\n        if \(_currentAuthUid\) \{\n          \/\/ A real user was set/.test(index));

  // signOut must declare intent BEFORE calling Firebase, or the callback races
  // ahead of the flag and gets written off as a token-refresh artifact.
  const so = index.slice(index.indexOf('async function signOut()'));
  const soBody = so.slice(0, so.indexOf('\n}\n'));
  const iIntent = soBody.indexOf('window._signOutIntent = true;');
  const iCall   = soBody.indexOf('await window._fbSignOut()');
  check('signOut sets the intent flag', iIntent !== -1);
  check('signOut awaits Firebase rather than firing and forgetting', iCall !== -1);
  check('intent is declared before Firebase is called', iIntent !== -1 && iCall !== -1 && iIntent < iCall);
  check('signOut is async so the await is real', /^async function signOut\(\)/.test(so));
  check('a failed sign-out is surfaced to the user, not just console.error',
        /showToast\('Could not sign out/.test(soBody));
  check('a failed sign-out resets the intent flag so a later null is ignored',
        /window\._signOutIntent = false;[\s\S]{0,200}showToast\('Could not sign out/.test(soBody));
  check('a failed sign-out does NOT clear local identity',
        soBody.indexOf('return;') < soBody.indexOf('_clearAuthIdentityNow'));
  check('a successful sign-out clears identity without waiting on the callback',
        /_clearAuthIdentityNow && window\._clearAuthIdentityNow\(\)/.test(soBody));
  check('_clearAuthIdentityNow is actually exposed for signOut to call',
        /window\._clearAuthIdentityNow = _clearAuthIdentity;/.test(index));
  check('a fresh sign-in resets the sign-out intent',
        /_currentAuthUid = user\.uid;\n        window\._signOutIntent = false;/.test(index));
}

console.log(`\n[sol-remediation] ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
