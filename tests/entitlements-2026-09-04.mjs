/**
 * Entitlement + session-integrity majors — 2026-09-04
 *
 * Sixth majors group from the Sol E2E audit:
 *   SOL-PLAT-002  /api/pro-status turned an unverifiable token into a 200
 *                 free/zero-credit body, so an expired session looked exactly
 *                 like a genuine free account and the client zeroed a paying
 *                 user's tier and credits.
 *   SOL-PLAT-003  Bulk Grade's Pro Max entitlement lived only in mutable
 *                 client state (window._userTier), console-bypassable.
 *   SOL-SCAN-G-1  Bulk Grade revoked front/back object URLs but never the four
 *                 deep-grade edge photos, nor over-cap or replaced queues.
 */
import fs from 'node:fs';
import { readAppSource } from './_appsource.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readAppSource();
const PRO  = fs.readFileSync(path.join(ROOT, 'api/pro-status.js'), 'utf8');
const SCAN = fs.readFileSync(path.join(ROOT, 'api/scan.js'), 'utf8');

let pass = 0;
const fails = [];
const ok = (n, c) => { if (c) pass++; else fails.push(n); };
const eq = (n, a, e) => {
  const A = JSON.stringify(a), E = JSON.stringify(e);
  if (A === E) pass++; else fails.push(`${n}\n      expected ${E}\n      actual   ${A}`);
};
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

function grabFn(src, name) {
  const sig = `function ${name}(`;
  const start = src.indexOf(sig);
  if (start === -1) throw new Error(`function ${name} not found`);
  let i = src.indexOf('{', src.indexOf(')', start));
  let d = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

/* ═══════════════════════════════════════════════════════════
   SOL-PLAT-002 — expired session must be a 401, not a fake free account
   ═══════════════════════════════════════════════════════════ */
{
  const nc = stripComments(PRO);
  const m = nc.match(/catch\s*\(\s*e\s*\)\s*\{([\s\S]{0,400}?)\}/);
  ok('the token-verification catch block still exists', !!m);
  const body = m ? m[1] : '';
  ok('a failed token verification returns 401', /status\(401\)/.test(body));
  ok('the 401 no longer returns a 200', !/status\(200\)/.test(body));
  ok('the 401 carries an error message', /error:/.test(body));
  ok('the 401 does not assert a free tier', !/isPro:\s*false/.test(body));
  ok('the 401 does not assert zero credits',
     !/freeScansLeft:\s*0/.test(body) && !/paidScansLeft:\s*0/.test(body));
  ok('the 401 is machine-distinguishable', /sessionExpired:\s*true/.test(body));
  ok('the message tells the user to sign in again', /Sign in again/i.test(body));
}
{
  // The genuinely anonymous cases must STAY 200 — a missing header is not an
  // expired session, and 401-ing it would break the signed-out home screen.
  const nc = stripComments(PRO);
  ok('a missing Authorization header still returns 200',
     /if\s*\(\s*!idToken\s*\)\s*return\s*res\.status\(200\)/.test(nc));
  ok('a token that verifies but has no sub still returns 200',
     /if\s*\(\s*!userSub\s*\)\s*\{[\s\S]{0,200}?status\(200\)/.test(nc));
}

/* ── the client must not silently keep stale state on a 401 ── */
{
  const body = stripComments(grabFn(HTML, 'checkProStatus'));
  ok('the client branches on 401', /r\.status\s*===\s*401/.test(body));
  ok('the client drops the dead token', /window\._googleIdToken\s*=\s*null/.test(body));
  ok('the client records the expired session', /_sessionExpired\s*=\s*true/.test(body));
  ok('the client tells the user', /showToast\(/.test(body));
  ok('the client clears the flag on a good response', /_sessionExpired\s*=\s*false/.test(body));
  // Critically: it must bail BEFORE overwriting tier/credit state.
  const at401 = body.search(/r\.status\s*===\s*401/);
  const atTier = body.search(/window\._userTier\s*=/);
  const atCredits = body.search(/window\._scanCredits\s*=/);
  ok('the 401 branch precedes the tier overwrite', at401 !== -1 && atTier !== -1 && at401 < atTier);
  ok('the 401 branch precedes the credit overwrite', at401 !== -1 && atCredits !== -1 && at401 < atCredits);
  // Brace-match the branch instead of slicing a fixed window, which
  // overruns into the success path and makes the next two checks meaningless.
  const branch = (() => {
    let i = body.indexOf('{', at401), d = 0;
    for (let j = i; j < body.length; j++) {
      if (body[j] === '{') d++;
      else if (body[j] === '}') { d--; if (d === 0) return body.slice(i, j + 1); }
    }
    return body.slice(at401);
  })();
  ok('the 401 branch returns without falling through', /return\s*;/.test(branch));
  ok('the 401 branch does not set a tier', !/_userTier\s*=/.test(branch));
  ok('the 401 branch does not zero credits', !/_scanCredits\s*=/.test(branch));
}

/* ═══════════════════════════════════════════════════════════
   SOL-PLAT-003 — Bulk Grade entitlement enforced server-side
   ═══════════════════════════════════════════════════════════ */
{
  const nc = stripComments(SCAN);
  ok('the server reads a bulkGrade flag off the body',
     /isBulkGrade\s*=\s*isGradeMode\s*&&\s*\(req\.body\s*\|\|\s*\{\}\)\.bulkGrade\s*===\s*true/.test(nc));
  ok('bulkGrade is only meaningful in grade mode', /isBulkGrade\s*=\s*isGradeMode\s*&&/.test(nc));
  ok('an ineligible tier is rejected with 403',
     /if\s*\(\s*isBulkGrade\s*&&[\s\S]{0,120}?\)\s*\{[\s\S]{0,200}?status\(403\)/.test(nc));
  const m = nc.match(/if\s*\(\s*isBulkGrade\s*&&([\s\S]{0,120}?)\)\s*\{/);
  ok('the gate allows pro_max', m && /pro_max/.test(m[1]));
  ok('the gate allows ultimate (grandfathered)', m && /ultimate/.test(m[1]));
  ok('the gate does not reintroduce a retired tier as a purchasable option',
     !/startTierCheckout\('ultimate'\)/.test(HTML));
  const seg = nc.slice(nc.search(/if\s*\(\s*isBulkGrade\s*&&/));
  ok('the 403 names the required tier', /requiresTier:\s*'pro_max'/.test(seg.slice(0, 400)));
  ok('the 403 message is user-facing prose', /Bulk Grade requires Pro Max\./.test(seg.slice(0, 400)));

  // The rejection must precede any credit debit, or a Free user pays to be
  // told no.
  const gateAt = nc.search(/if\s*\(\s*isBulkGrade\s*&&/);
  const debitAt = nc.search(/if\s*\(\s*isIdentifyMode\s*\)/);
  ok('the entitlement gate precedes the credit branch',
     gateAt !== -1 && debitAt !== -1 && gateAt < debitAt);
  // And it must sit inside the authenticated KV branch, after tier resolution.
  const tierAt = nc.search(/const tier\s*=\s*await getUserTier/);
  ok('the gate runs after the server resolves the real tier',
     tierAt !== -1 && gateAt > tierAt);
  ok('the gate uses the server-resolved tier, not a client value',
     m && !/req\.body/.test(m[1]) && !/_userTier/.test(m[1]));
}
{
  // Client must declare the flag, and ONLY on the bulk path.
  ok('the bulk grade request declares bulkGrade',
     (HTML.match(/bulkGrade:\s*true/g) || []).length === 1);
  const bulkBody = HTML.slice(HTML.indexOf('bulkGrade: true') - 400, HTML.indexOf('bulkGrade: true') + 100);
  ok('the flag sits on a grade-mode request body', /mode:\s*'grade'/.test(bulkBody));
  // Single-card grading must be unchanged.
  const singleAt = HTML.indexOf("mode: 'grade'");
  const singleBody = HTML.slice(singleAt, singleAt + 500);
  ok('single-card grading does not send bulkGrade', !/bulkGrade/.test(singleBody));
  ok('there are still exactly two grade request bodies',
     (HTML.match(/mode: 'grade'/g) || []).length === 2);
}
{
  // A 403 must stop the batch, not retry every remaining card.
  const at = HTML.indexOf('resp.status === 403');
  ok('the bulk grade worker handles 403', at !== -1);
  const seg = HTML.slice(at, at + 700);
  ok('a 403 stops the batch', /return 'STOP'/.test(seg));
  ok('a 403 surfaces the server message', /e\.error/.test(seg));
  ok('a 403 tells the user', /showToast\(/.test(seg));
  ok('a 403 has a message even if the body is unparseable',
     /Bulk Grade requires Pro Max\./.test(seg));
  // 402 and 401 handling must survive.
  ok('the 402 out-of-credits path still exists', /resp\.status === 402/.test(HTML));
  ok('the 401 auth path still exists in the grade worker',
     /resp\.status === 401/.test(HTML));
}
{
  // The client-side gate stays as a UX affordance — it just is no longer the
  // only thing standing between a Free user and the workflow.
  ok('the client tier gate is still present', /_bulkGradeShowSection\('tierGate'\)/.test(HTML));
  ok('the client gate still recognises pro_max',
     /isEligible\s*=\s*tier === 'pro_max'/.test(HTML));
}

/* ═══════════════════════════════════════════════════════════
   SOL-SCAN-G-1 — every Bulk Grade object URL is released
   ═══════════════════════════════════════════════════════════ */
const G = new Function(`
  const revoked = [];
  const URL = { revokeObjectURL(u) { revoked.push(u); } };
  const window = { _bulkGradeQueue: [], _bulkGradeResults: [] };
  ${grabFn(HTML, '_bulkGradeRevokeItem').replace('const _BULK_GRADE_URL_SLOTS', 'var _X')}
  ${grabFn(HTML, '_bulkGradeRevokeAllUrls')}
  return { revoked, window, _bulkGradeRevokeItem, _bulkGradeRevokeAllUrls };
`.replace('var _X', 'const _BULK_GRADE_URL_SLOTS'));

// Rebuild cleanly with the constant in scope.
const SLOTS_SRC = HTML.match(/const _BULK_GRADE_URL_SLOTS = \[[^\]]*\];/)[0];
const G2 = new Function(`
  const revoked = [];
  const URL = { revokeObjectURL(u) { revoked.push(u); } };
  const window = { _bulkGradeQueue: [], _bulkGradeResults: [] };
  ${SLOTS_SRC}
  ${grabFn(HTML, '_bulkGradeRevokeItem')}
  ${grabFn(HTML, '_bulkGradeRevokeAllUrls')}
  return {
    slots: _BULK_GRADE_URL_SLOTS,
    run(queue, results) {
      revoked.length = 0;
      window._bulkGradeQueue = queue; window._bulkGradeResults = results || [];
      _bulkGradeRevokeAllUrls();
      return revoked.slice();
    },
    runItem(item) { revoked.length = 0; _bulkGradeRevokeItem(item); return revoked.slice(); },
  };
`)();

eq('every photo slot is covered', G2.slots,
   ['front', 'back', 'topEdge', 'bottomEdge', 'leftEdge', 'rightEdge']);

// The exact audit repro: one deep-grade card, six photos.
{
  const card = {
    front:      { objectUrl: 'blob:f' },
    back:       { objectUrl: 'blob:b' },
    topEdge:    { objectUrl: 'blob:t' },
    bottomEdge: { objectUrl: 'blob:bo' },
    leftEdge:   { objectUrl: 'blob:l' },
    rightEdge:  { objectUrl: 'blob:r' },
  };
  const got = G2.run([card], [{ objectUrl: 'blob:res' }]);
  eq('all six photos plus the result blob are revoked', got.sort(),
     ['blob:b', 'blob:bo', 'blob:f', 'blob:l', 'blob:r', 'blob:res', 'blob:t'].sort());
  ok('the four edge blobs are no longer leaked',
     ['blob:t', 'blob:bo', 'blob:l', 'blob:r'].every(u => got.includes(u)));
}
// Quick Grade (front + back only) must still work and not throw on absent edges.
{
  const got = G2.run([{ front: { objectUrl: 'blob:f' }, back: { objectUrl: 'blob:b' } }], []);
  eq('quick grade revokes both photos', got.sort(), ['blob:b', 'blob:f']);
}
// Legacy flat shape with a bare objectUrl.
eq('a flat queue item is revoked', G2.runItem({ objectUrl: 'blob:x' }), ['blob:x']);
// Robustness.
eq('a null item revokes nothing', G2.runItem(null), []);
eq('an empty item revokes nothing', G2.runItem({}), []);
eq('a slot with no url revokes nothing', G2.runItem({ front: {} }), []);
eq('a null slot revokes nothing', G2.runItem({ front: null, back: undefined }), []);
eq('an empty queue revokes nothing', G2.run([], []), []);
eq('a null queue revokes nothing', G2.run(null, null), []);
// A full 10-card deep session: 60 photo blobs, none left behind.
{
  const queue = Array.from({ length: 10 }, (_, i) => ({
    front: { objectUrl: `f${i}` }, back: { objectUrl: `b${i}` },
    topEdge: { objectUrl: `t${i}` }, bottomEdge: { objectUrl: `bo${i}` },
    leftEdge: { objectUrl: `l${i}` }, rightEdge: { objectUrl: `r${i}` },
  }));
  const got = G2.run(queue, []);
  eq('a 10-card deep session revokes all 60 blobs', got.length, 60);
  ok('every blob is unique and accounted for', new Set(got).size === 60);
}

/* ── over-cap and replaced queues must be released too ── */
{
  const body = stripComments(grabFn(HTML, 'processBulkGradeFiles'));
  ok('cards dropped by the cap are revoked',
     /cards\.slice\(cap\)\.forEach\(_bulkGradeRevokeItem\)/.test(body));
  ok('the previous queue is revoked before it is replaced',
     /\(window\._bulkGradeQueue \|\| \[\]\)\.forEach\(_bulkGradeRevokeItem\)/.test(body));
  // Order matters: the old queue must be freed BEFORE the reference is lost.
  const revokeAt = body.search(/\(window\._bulkGradeQueue \|\| \[\]\)\.forEach\(_bulkGradeRevokeItem\)/);
  const assignAt = body.search(/window\._bulkGradeQueue = selected/);
  ok('the old queue is freed before reassignment',
     revokeAt !== -1 && assignAt !== -1 && revokeAt < assignAt);
  // And the over-cap revoke must run before the slice that discards them.
  const capAt = body.search(/cards\.slice\(cap\)\.forEach/);
  ok('over-cap cards are freed inside the truncation branch',
     capAt !== -1 && capAt < assignAt);
  ok('truncation is still reported to the user', /truncated = true/.test(body));
}
{
  // closeBulkGrade must still be the thing that runs cleanup.
  const body = stripComments(grabFn(HTML, 'closeBulkGrade'));
  ok('closing Bulk Grade revokes every url', /_bulkGradeRevokeAllUrls\(\)/.test(body));
  ok('closing Bulk Grade clears the queue', /_bulkGradeQueue\s*=\s*\[\]/.test(body));
  ok('closing Bulk Grade clears the results', /_bulkGradeResults\s*=\s*\[\]/.test(body));
}
// The old two-slot cleanup must be gone.
ok('the front/back-only cleanup no longer exists',
   !/q && q\.back && q\.back\.objectUrl/.test(HTML));

/* ── standing copy rules ── */
ok('no maintenance wording', !/maintenance/i.test(HTML));
ok('no beta wording', !/\bbeta\b/i.test(HTML));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  for (const x of fails) console.log('  ✗ ' + x);
  process.exit(1);
}
