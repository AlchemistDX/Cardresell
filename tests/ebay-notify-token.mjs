/*
 * ebay-notify-token — CH-2. The published-token fallback is gone, and this
 * suite is what stops it coming back.
 *
 * WHY THIS EXISTS
 *
 * `api/ebay-notifications.js` read
 *   cleanCredential(process.env.EBAY_VERIFICATION_TOKEN) || '<repo literal>'
 * and CH-1 measured production actually serving that literal. So the fallback
 * was not a latent hazard; it was the live configuration.
 *
 * The dangerous property is not that the value was published. It is that the
 * failure was INVISIBLE. An unset variable produced a well-formed 200 with a
 * correctly-computed hash -- over a token any reader of this repository can
 * supply. Nothing in a health check, a status page, or eBay's own validation
 * would have reported a problem, because from the outside the endpoint was
 * behaving perfectly. Rule 2: the silent fallback IS the bug.
 *
 * WHAT THIS SUITE PINS
 *
 * 1. The literal is absent from the source. A text assertion, and text is all
 *    that is needed for a claim about absence -- if the string is not in the
 *    file it cannot be returned by it.
 * 2. Behaviour: an absent token yields 503 and NO challengeResponse. This is
 *    the assertion the text one cannot make, because "the fallback was deleted"
 *    and "the handler now fails closed" are different facts, and a deletion
 *    that left an empty-string hash would satisfy the first while failing the
 *    second in the worst possible way -- a stable, wrong, well-formed answer.
 * 3. A present token still produces the SAME hash as before the change. The
 *    correction must not move the answer for a correctly-configured endpoint,
 *    or completing eBay's challenge would depend on which version is deployed.
 * 4. POST still acknowledges without a token. Refusing a deletion notification
 *    over our own misconfiguration converts a config defect into a compliance
 *    failure. The challenge fails closed; the acknowledgement stays open. That
 *    asymmetry is deliberate and is pinned so nobody "fixes" it later.
 *
 * NOT IN THE MAINTENANCE REBUILD. The rebuild deploys the exact live Phase 0
 * commit, which predates this change entirely, so it is excluded by
 * construction rather than by anyone remembering. This lands in the later
 * release, and only after the replacement token is verified in production --
 * removing the fallback BEFORE a good token is in place would take a working
 * endpoint down.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { harness } from './_assert.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const T = harness('ebay-notify-token');

const SRC_PATH = join(ROOT, 'api', 'ebay-notifications.js');
const src = readFileSync(SRC_PATH, 'utf8');
const ENDPOINT = 'https://www.cardresell.org/api/ebay-notifications';

// The literal, reconstructed rather than written, so this file does not
// reintroduce the published string it exists to forbid.
const PUBLISHED = ['CardResell', 'eBay', 'Notify', '2026', 'secure', 'token', 'v1'].join('-');

// ── 1. The literal is gone from the source ──────────────────────────────────
T.check('the published token literal no longer appears in api/ebay-notifications.js',
  !src.includes(PUBLISHED),
  'CH-2: this was the only remaining occurrence in the tree');

T.check('…and no `|| \'…\'` string fallback remains on the token read',
  !/EBAY_VERIFICATION_TOKEN\s*\)\s*\|\|\s*['"][^'"]{4,}['"]/.test(src),
  'a different literal would be the same defect wearing a different value');

T.check('the token is read at call time, not captured at module load',
  /function\s+verificationToken\s*\(/.test(src),
  'a module-load capture freezes the value for the life of a warm instance');

T.check('the empty-token branch returns 503 with an explicit reason',
  /verification_token_unset/.test(src));

// ── 2..4. Behaviour, through the real handler ───────────────────────────────
const mkRes = () => {
  const r = { headers: {}, code: null, body: null, ended: false };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
};

const handler = (await import('../api/ebay-notifications.js')).default;
const CHALLENGE = 'challenge-code-fixture-0001';
const saved = process.env.EBAY_VERIFICATION_TOKEN;

try {
  // ── An ABSENT token fails closed ──
  delete process.env.EBAY_VERIFICATION_TOKEN;
  {
    const res = mkRes();
    await handler({ method: 'GET', query: { challenge_code: CHALLENGE }, headers: {} }, res);
    T.check('with no token configured the challenge returns 503', res.code === 503);
    T.check('…and returns NO challengeResponse at all',
      !res.body || res.body.challengeResponse === undefined,
      'the whole defect was a well-formed answer computed over the wrong token');
    T.check('…naming the reason rather than a generic error',
      res.body && res.body.error === 'verification_token_unset');
    T.check('…and is not cacheable', res.headers['cache-control'] === 'no-store');
  }

  // An EMPTY or whitespace-only value is the same case as absent. This is the
  // shape CH-1 actually found in production -- a stored value that looked set.
  for (const bad of ['', '   ', '\n', '""']) {
    process.env.EBAY_VERIFICATION_TOKEN = bad;
    const res = mkRes();
    await handler({ method: 'GET', query: { challenge_code: CHALLENGE }, headers: {} }, res);
    T.check(`a token of ${JSON.stringify(bad)} is treated as unset, not hashed`,
      res.code === 503 && (!res.body || res.body.challengeResponse === undefined));
  }

  // ── A PRESENT token still produces the historical hash ──
  // Computed here independently of the handler, in the documented order:
  // challengeCode + token + endpoint.
  {
    const token = 'a-replacement-token-fixture';
    process.env.EBAY_VERIFICATION_TOKEN = token;
    const expected = createHash('sha256')
      .update(CHALLENGE).update(token).update(ENDPOINT).digest('hex');

    const res = mkRes();
    await handler({ method: 'GET', query: { challenge_code: CHALLENGE }, headers: {} }, res);
    T.check('a configured token still answers 200', res.code === 200);
    T.check('…with the same hash the pre-change handler produced',
      res.body && res.body.challengeResponse === expected,
      'the correction must not move the answer for a correctly-configured endpoint');
    T.check('…hashing challenge + token + endpoint in that order, not another',
      res.body.challengeResponse !== createHash('sha256')
        .update(token).update(CHALLENGE).update(ENDPOINT).digest('hex'));
  }

  // The stray-whitespace case CH-1 measured: a trailing newline must not change
  // the hash, or a clean portal value and a dirty stored value disagree.
  {
    const token = 'a-replacement-token-fixture';
    const clean = createHash('sha256')
      .update(CHALLENGE).update(token).update(ENDPOINT).digest('hex');
    for (const dirty of [`${token}\n`, ` ${token} `, `"${token}"`, `${token}\\n`]) {
      process.env.EBAY_VERIFICATION_TOKEN = dirty;
      const res = mkRes();
      await handler({ method: 'GET', query: { challenge_code: CHALLENGE }, headers: {} }, res);
      T.check(`stray wrapping ${JSON.stringify(dirty.replace(token, 'T'))} still hashes to the clean value`,
        res.body && res.body.challengeResponse === clean,
        'CH-1: production was serving a hash over a token with a trailing newline');
    }
  }

  // A missing challenge_code is still a 400, not a 503. The two failures are
  // different -- one is the caller's, one is ours -- and must stay legible.
  {
    process.env.EBAY_VERIFICATION_TOKEN = 'a-replacement-token-fixture';
    const res = mkRes();
    await handler({ method: 'GET', query: {}, headers: {} }, res);
    T.check('a missing challenge_code is still 400, not 503', res.code === 400,
      'a caller error and a configuration error must not report as the same thing');
  }

  // ── POST stays open ──
  for (const tok of [undefined, 'a-replacement-token-fixture']) {
    if (tok === undefined) delete process.env.EBAY_VERIFICATION_TOKEN;
    else process.env.EBAY_VERIFICATION_TOKEN = tok;
    const res = mkRes();
    await handler({
      method: 'POST', headers: {},
      body: { metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' },
              notification: { notificationId: 'n-1', eventDate: '2026-09-09T00:00:00Z' } },
    }, res);
    T.check(`a deletion notification is acknowledged with the token ${tok ? 'set' : 'unset'}`,
      res.code === 200 && res.body && res.body.received === true,
      'our misconfiguration must not become a compliance failure');
  }
} finally {
  if (saved === undefined) delete process.env.EBAY_VERIFICATION_TOKEN;
  else process.env.EBAY_VERIFICATION_TOKEN = saved;
}

T.done();
