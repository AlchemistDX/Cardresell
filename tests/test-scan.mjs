// tests/test-scan.mjs
// Integration tests for /api/scan — Deep Grade + credit math + refunds + regressions.
// Mocks global fetch to intercept OpenAI + Upstash KV traffic, then calls the handler directly.

import { completionGuard } from './_complete.mjs';
const { finish: _finish, skipAll: _skipAll } = completionGuard('test-scan');

/* ── AUTHENTICATION IN THIS SUITE ───────────────────────────────────────────
 *
 * api/scan.js was hardened on 2026-08-25 (see api/scan.js:646): identity comes
 * only from a cryptographically verified token, and body-supplied identity is
 * ignored. This suite used to hand it an UNSIGNED JWT. Established
 * empirically on 2026-09-10: the refusal was api/scan.js:664 -- the catch
 * around verifyTokenFlexible -- and all 29 cases were answered 401 before any
 * scan logic ran. Credit math, refunds and Deep Grade were untested while the
 * suite reported green.
 *
 * Repaired 2026-09-10 the way the draft harness already did it: mint a test
 * RSA keypair here, sign the fixture tokens with it, and serve the matching
 * public key where the verifier looks for Google's (tests/_signedToken.mjs).
 * verifyTokenFlexible then runs for real -- real RS256 signature check, real
 * issuer, audience and expiry checks. Only the key authority is substituted.
 * The endpoint has no test-only bypass and is unchanged.
 *
 * Group 7 below asserts the rejections that follow from that: an unsigned
 * token, a tampered signature, a wrong audience, an expired token and a
 * missing header are each refused with 401 and no credit movement. Those
 * assertions are only meaningful because the accepted tokens are genuinely
 * verified.
 *
 * This is LOCAL coverage. Deployed authentication against real Google-issued
 * tokens is a separate check and remains open as RV-1.
 */

import handler from '../api/scan.js';
import { makeSigner } from './_signedToken.mjs';
import { TIER_BENEFITS } from '../api/_tier.js';

// ── Mock KV store ──────────────────────────────────────────────────────────
class MockKV {
  constructor(initial = {}) {
    this.store = { ...initial };
    this.opLog = [];
  }
  handleRequest(url, options = {}) {
    const u = new URL(url);
    // /get/<key>
    let m = u.pathname.match(/^\/get\/(.+)$/);
    if (m) {
      const key = decodeURIComponent(m[1]);
      this.opLog.push(['get', key]);
      return this._resp({ result: this.store[key] ?? null });
    }
    // /set/<key>/<value>
    m = u.pathname.match(/^\/set\/([^/]+)\/(.+)$/);
    if (m) {
      const key = decodeURIComponent(m[1]);
      const val = decodeURIComponent(m[2]);
      this.opLog.push(['set', key, val]);
      this.store[key] = val;
      return this._resp({ result: 'OK' });
    }
    // /setex/<key>/<ttl>/<value>
    // Added 2026-09-10: the REAL verifier caches an email->uid mapping here
    // (api/_verifyToken.js). While the fixtures sent unsigned tokens the
    // verifier never got far enough to write it, so MockKV never needed the
    // verb; with real verification it does, and an unhandled verb threw
    // inside the verify call and was reported as a 401.
    m = u.pathname.match(/^\/setex\/([^/]+)\/([^/]+)\/(.+)$/);
    if (m) {
      const key = decodeURIComponent(m[1]);
      const ttl = parseInt(decodeURIComponent(m[2]), 10);
      const val = decodeURIComponent(m[3]);
      this.opLog.push(['setex', key, String(ttl), val]);
      this.store[key] = val;
      this.ttls = this.ttls || {};
      this.ttls[key] = ttl;
      return this._resp({ result: 'OK' });
    }
    // /incr/<key>
    m = u.pathname.match(/^\/incr\/(.+)$/);
    if (m) {
      const key = decodeURIComponent(m[1]);
      const cur = parseInt(this.store[key] ?? '0') || 0;
      this.store[key] = String(cur + 1);
      this.opLog.push(['incr', key]);
      return this._resp({ result: cur + 1 });
    }
    // /decrby/<key>/<n> and /incrby/<key>/<n>
    // Same story as setex: the endpoint debits credits with DECRBY, and while
    // every case was refused at the door the mock never saw the verb. An
    // unhandled verb threw INSIDE the handler's credit path, which the
    // endpoint absorbed -- so the case looked like a wrong response shape
    // rather than a broken mock. Recorded here so the next reader does not
    // re-diagnose it as a product defect.
    m = u.pathname.match(/^\/(decrby|incrby)\/([^/]+)\/(.+)$/);
    if (m) {
      const verb = m[1];
      const key = decodeURIComponent(m[2]);
      const by = parseInt(decodeURIComponent(m[3]), 10) || 0;
      const cur = parseInt(this.store[key] ?? '0') || 0;
      const next = verb === 'decrby' ? cur - by : cur + by;
      this.store[key] = String(next);
      this.opLog.push([verb, key, String(by)]);
      return this._resp({ result: next });
    }
    // /decr/<key>
    m = u.pathname.match(/^\/decr\/(.+)$/);
    if (m) {
      const key = decodeURIComponent(m[1]);
      const cur = parseInt(this.store[key] ?? '0') || 0;
      this.store[key] = String(cur - 1);
      this.opLog.push(['decr', key]);
      return this._resp({ result: cur - 1 });
    }
    // /del/<key>
    m = u.pathname.match(/^\/del\/(.+)$/);
    if (m) {
      const key = decodeURIComponent(m[1]);
      const had = this.store[key] !== undefined;
      delete this.store[key];
      this.opLog.push(['del', key]);
      return this._resp({ result: had ? 1 : 0 });
    }
    // /expire/<key>/<ttl>
    m = u.pathname.match(/^\/expire\/([^/]+)\/(.+)$/);
    if (m) {
      const key = decodeURIComponent(m[1]);
      this.ttls = this.ttls || {};
      this.ttls[key] = parseInt(decodeURIComponent(m[2]), 10);
      this.opLog.push(['expire', key]);
      return this._resp({ result: this.store[key] === undefined ? 0 : 1 });
    }
    throw new Error('Unhandled KV url: ' + url);
  }
  _resp(body) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  }
  getInt(key) { return parseInt(this.store[key] ?? '0') || 0; }
}

// ── Mock res ──────────────────────────────────────────────────────────────
function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return res;
}

// ── Test infra ────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
function assert(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}
async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log('✓');
    passed++;
  } catch(e) {
    console.log('✗');
    console.log('    ' + e.message);
    failed++;
    failures.push({ name, err: e.message });
  }
}

// ── Environment setup ─────────────────────────────────────────────────────
process.env.KV_REST_API_URL     = 'https://mock-kv.local';
process.env.KV_REST_API_TOKEN   = 'mock-token';
process.env.OPENAI_API_KEY      = 'mock-openai';
process.env.STRIPE_SECRET_KEY   = ''; // avoid Stripe fallback path
// Identify mode routes to Ximilar as the sole identity authority and returns
// 503 IDENTIFY_PROVIDER_UNAVAILABLE without a token (api/scan.js:983). The
// fixtures predate that and mocked OpenAI for identify. The token is only a
// presence check here; the HTTP call itself is mocked below.
process.env.XIMILAR_API_TOKEN   = 'mock-ximilar';

// Global fetch mock — routed based on URL host
let currentKV = null;
let openaiHandler = null;
const originalFetch = globalThis.fetch;

// ── Ximilar mock ──────────────────────────────────────────────────────────
// A high-confidence single answer: api/_ximilar.js:134 needs the top distance
// under 0.35 and the runner-up at least 0.15 further away.
function goodXimilar() {
  return () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      records: [{
        _objects: [{
          _tags: {
            Subcategory: [{ name: 'Pokemon' }],
            Alphabet: [{ name: 'latin' }],
            Side: [{ name: 'front' }],
          },
          _identification: {
            best_match: {
              name: 'Charizard VMAX', card_number: '020/189',
              set: 'Darkness Ablaze', set_code: 'DAA', rarity: 'Rainbow Rare',
              full_name: 'Charizard VMAX 020/189',
            },
            alternatives: [{ name: 'Charizard V', card_number: '019/189', set: 'Darkness Ablaze' }],
            distances: [0.05, 0.60],
          },
        }],
      }],
    }),
    text: () => Promise.resolve(''),
  });
}
function failingXimilar(status = 500) {
  return () => Promise.resolve({
    ok: false, status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve('ximilar down'),
  });
}

let ximilarHandler = null;

function installMocks(kv, openaiFn, ximilarFn = goodXimilar()) {
  currentKV = kv;
  openaiHandler = openaiFn;
  ximilarHandler = ximilarFn;
  globalThis.fetch = (url, options) => {
    const u = typeof url === 'string' ? url : url.toString();
    // The real verifier fetches Google's public keys here. Serving the test
    // signer's key is the ONLY substitution; the verification itself is real.
    if (signer.isJwksUrl(u))                    return Promise.resolve(signer.jwksResponse());
    if (u.startsWith(process.env.KV_REST_API_URL)) return currentKV.handleRequest(u, options);
    if (u.includes('ximilar.com'))              return ximilarHandler(u, options);
    if (u.includes('openai.com'))               return openaiHandler(u, options);
    if (u.includes('stripe.com'))               return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
    throw new Error('Unexpected fetch: ' + u);
  };
}
function restoreFetch() { globalThis.fetch = originalFetch; }

// ── Signed Firebase-shaped ID tokens ──────────────────────────────────────
// The signer's public key is served to the real verifier by installMocks()
// below, so these tokens pass a genuine signature check.
const signer = await makeSigner();

// The identity every fixture KV key is written against: scans:user123:*.
const FIXTURE_SUB = 'user123';
const FIXTURE_EMAIL = 'test@example.com';

/** A token the verifier will accept, for the fixture identity. */
const goodToken = await signer.mint({ sub: FIXTURE_SUB, email: FIXTURE_EMAIL });

/** An unsigned token of the shape this suite used to send. Must be refused. */
function makeUnsignedToken(uid = FIXTURE_SUB, email = FIXTURE_EMAIL, verified = true) {
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return 'header.' + b64url({
    sub: uid, email, email_verified: verified,
    aud: 'cardresell-e0329',
    iss: 'https://securetoken.google.com/cardresell-e0329',
    exp: Math.floor(Date.now()/1000) + 3600,
    iat: Math.floor(Date.now()/1000),
  }) + '.sig';
}

// Standard OpenAI mock: returns a valid grade JSON
function goodOpenAI(mode = 'grade') {
  return () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      choices: [{ message: { content: mode === 'grade' ? JSON.stringify({
        card_name: 'Charizard VMAX',
        centering: '55/45 L/R, 50/50 T/B',
        corners: 'Near Mint',
        edges: 'Mint',
        surface: 'Mint',
        psa_estimate: 9,
        grade_label: 'Mint',
        grade_notes: 'Light corner wear on top-left.',
        worth_grading: true,
        subgrades: { centering: 9, corners: 8.5, edges: 9.5, surface: 9.5 },
        confidence: 'high',
      }) : JSON.stringify({
        card_name: 'Charizard VMAX',
        card_number: '020/189',
        set_name: 'Darkness Ablaze',
        hp: '330',
        card_type: 'pokemon',
        rarity: 'Rainbow Rare',
      }) } }],
    }),
    text: () => Promise.resolve(''),
  });
}

// OpenAI returns 500 error
function failingOpenAI() {
  return () => Promise.resolve({
    ok: false, status: 500,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve('Internal server error'),
  });
}

// OpenAI returns garbage JSON
function malformedOpenAI() {
  return () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      choices: [{ message: { content: 'not json at all' } }],
    }),
    text: () => Promise.resolve(''),
  });
}

// Minimal valid request body helper
// A photo payload the endpoint will accept. Two real rules apply to Deep
// Grade (api/scan.js:749 and :767): the slots must be DISTINCT, and each must
// be at least 8000 base64 chars, because a real phone photo is 100KB+ and
// anything smaller is a thumbnail. The fixtures used four-character strings,
// which the endpoint correctly refuses as duplicate thumbnails. Discovered
// 2026-09-10, once real token verification let execution reach that far for
// the first time. The fixture was wrong, not the product.
// The duplicate check signs a 512-char slice from the MIDDLE of the payload,
// not the prefix, so the slots must differ throughout -- repeating the slot
// tag is what makes them distinct wherever the signature is taken from.
function photo(slot) {
  return slot.repeat(2500); // 4-char tag x 2500 = 10000 chars, well over 8000
}

function bodyFor({ mode, deepGrade = false, hasBack = false, hasEdges = false } = {}) {
  const b = {
    imageBase64: photo('FRNT'),
    mimeType: 'image/jpeg',
    email: 'test@example.com',
    googleSub: 'user123',
    mode,
  };
  if (deepGrade) b.deepGrade = true;
  if (hasBack) { b.backBase64 = photo('BACK'); b.backMimeType = 'image/jpeg'; }
  if (hasEdges) {
    b.topEdgeBase64 = photo('TOPE');    b.topEdgeMimeType = 'image/jpeg';
    b.bottomEdgeBase64 = photo('BOTE'); b.bottomEdgeMimeType = 'image/jpeg';
    b.leftEdgeBase64 = photo('LEFE');   b.leftEdgeMimeType = 'image/jpeg';
    b.rightEdgeBase64 = photo('RGTE');  b.rightEdgeMimeType = 'image/jpeg';
  }
  return b;
}

function makeReq(body, token) {
  return {
    method: 'POST',
    headers: { authorization: token ? 'Bearer ' + token : '' },
    body,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//                              TEST CASES
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── /api/scan integration tests ──');

// ─── Group 1: Existing behavior (regression) ───
console.log('\n[1] Existing behavior — quick grade + identify still work as before');

await test('quick grade (front only, no back) — 400 rejects, no credit deducted', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  let openaiCalled = false;
  installMocks(kv, () => { openaiCalled = true; return goodOpenAI('grade')(); });
  const req = makeReq(bodyFor({ mode: 'grade' }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 400, 'want 400 got ' + res.statusCode);
  assert(res.body.missingPhotos.includes('back'), 'back listed as missing');
  assert(kv.getInt('scans:user123:paid_left') === 5, 'no credit deducted');
  assert(openaiCalled === false, 'openai not called');
});

await test('quick grade (front + back) — succeeds, deducts 1 credit', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '3' });
  installMocks(kv, goodOpenAI('grade'));
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, 'want 200 got ' + res.statusCode);
  assert(res.body.success === true, 'success');
  assert(res.body.mode === 'grade', 'mode grade');
  assert(res.body.deepGrade === false, 'deepGrade false');
  assert(res.body.creditsUsed === 1, 'creditsUsed=1');
  assert(res.body.photoCount === 2, 'photoCount=2');
  assert(kv.getInt('scans:user123:paid_left') === 2, 'paid_left -1');
  // The centering sub-score is DERIVED from the measured ratio server-side and
  // deliberately overrides whatever the model reported (api/scan.js:1969 and
  // :1982: "Trust the server computation over the model's self-reported
  // ceiling"). The fixture asserted the model's own 9 was echoed back, which
  // would pass even if the derivation were deleted. 55/45 L/R with 50/50 T/B
  // ceilings at 10, so assert the derived value and the override itself.
  assert(res.body.subgrades, 'subgrades present');
  assert(res.body.subgrades.centering === 10,
    `centering derived from 55/45 → 10, got ${res.body.subgrades.centering}`);
  assert(res.body.centering_ceiling === 10, 'centering_ceiling 10');
  assert(res.body.subgrades.corners === 8.5 && res.body.subgrades.surface === 9.5,
    'the other pillars still come from the model');
  // Confidence capped at medium for 2-photo quick grade
  assert(res.body.confidence === 'medium', `confidence capped at medium, got ${res.body.confidence}`);
});

await test('identify mode — deducts 1 from id_paid_left, not paid_left', async () => {
  const kv = new MockKV({
    'scans:user123:id_paid_left': '10',
    'scans:user123:paid_left': '2',
  });
  installMocks(kv, goodOpenAI('identify'));
  const req = makeReq(bodyFor({ mode: 'identify' }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200');
  assert(res.body.mode === 'identify', 'identify mode');
  assert(kv.getInt('scans:user123:id_paid_left') === 9, 'id_paid_left -1');
  assert(kv.getInt('scans:user123:paid_left') === 2, 'paid_left UNCHANGED');
});

await test('identify mode — no id credits → 402', async () => {
  const kv = new MockKV({ 'scans:user123:id_paid_left': '0' });
  installMocks(kv, goodOpenAI('identify'));
  const req = makeReq(bodyFor({ mode: 'identify' }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 402, '402');
  assert(res.body.needsPayment === true, 'needsPayment');
});

// ─── Group 2: Deep Grade happy path ───
console.log('\n[2] Deep Grade — full 6-photo flow');

await test('deep grade with all 6 photos — deducts 2, gets high confidence', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  let openaiCallCount = 0;
  let capturedBody = null;
  const openai = (url, opts) => {
    openaiCallCount++;
    capturedBody = JSON.parse(opts.body);
    return goodOpenAI('grade')();
  };
  installMocks(kv, openai);
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, 'want 200 got ' + res.statusCode);
  assert(res.body.deepGrade === true, 'deepGrade=true in response');
  assert(res.body.creditsUsed === 2, 'creditsUsed=2');
  assert(res.body.photoCount === 6, 'photoCount=6');
  assert(kv.getInt('scans:user123:paid_left') === 3, `paid_left want 3 got ${kv.getInt('scans:user123:paid_left')}`);
  assert(openaiCallCount === 1, 'exactly 1 openai call');
  const imgCount = capturedBody.messages[0].content.filter(c => c.type === 'image_url').length;
  assert(imgCount === 6, `openai got 6 images, got ${imgCount}`);
  // Derived from the ratio, not echoed from the model — see the quick-grade
  // case above for the code references.
  assert(res.body.subgrades.centering === 10,
    `centering derived from 55/45 → 10, got ${res.body.subgrades.centering}`);
  assert(res.body.confidence === 'high', 'high confidence at 6 photos');
});

await test('deep grade with 4 photos (front + back + 2 edges) — succeeds, medium confidence', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  let capturedBody = null;
  installMocks(kv, (url, opts) => { capturedBody = JSON.parse(opts.body); return goodOpenAI('grade')(); });
  const body = bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true });
  // Drop 2 edges — keep only top + bottom
  delete body.leftEdgeBase64; delete body.leftEdgeMimeType;
  delete body.rightEdgeBase64; delete body.rightEdgeMimeType;
  const req = makeReq(body, goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, 'want 200 got ' + res.statusCode);
  assert(res.body.deepGrade === true, 'deepGrade=true');
  assert(res.body.creditsUsed === 2, 'still 2 credits');
  assert(res.body.photoCount === 4, 'photoCount=4');
  assert(res.body.confidence === 'medium', `confidence capped at medium for 4 photos, got ${res.body.confidence}`);
  const imgCount = capturedBody.messages[0].content.filter(c => c.type === 'image_url').length;
  assert(imgCount === 4, `openai got 4 images, got ${imgCount}`);
});

await test('deep grade with 5 photos (front + back + 3 edges) — succeeds, medium', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, goodOpenAI('grade'));
  const body = bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true });
  delete body.rightEdgeBase64; delete body.rightEdgeMimeType;
  const req = makeReq(body, goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200');
  assert(res.body.photoCount === 5, 'photoCount=5');
  assert(res.body.confidence === 'medium', 'medium at 5 photos');
});

// ─── Group 3: Deep Grade validation ───
console.log('\n[3] Deep Grade — validation blocks incomplete uploads');

await test('deep grade missing back — rejects BEFORE credit deduction', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  let openaiCalled = false;
  installMocks(kv, () => { openaiCalled = true; return goodOpenAI('grade')(); });
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: false, hasEdges: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 400, 'want 400 got ' + res.statusCode);
  assert(Array.isArray(res.body.missingPhotos), 'missingPhotos array');
  assert(res.body.missingPhotos.includes('back'), 'back listed');
  assert(kv.getInt('scans:user123:paid_left') === 5, 'paid_left UNCHANGED');
  assert(openaiCalled === false, 'openai not called');
});

await test('deep grade with only 1 edge — rejects (below 2 minimum)', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, () => { throw new Error('should not reach openai'); });
  const body = bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true });
  delete body.leftEdgeBase64; delete body.rightEdgeBase64; delete body.bottomEdgeBase64;
  const req = makeReq(body, goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 400, 'want 400 got ' + res.statusCode);
  assert(res.body.edgeCount === 1, `edgeCount=1 in error, got ${res.body.edgeCount}`);
  assert(res.body.needsMoreEdges === 1, `needsMoreEdges=1, got ${res.body.needsMoreEdges}`);
  assert(kv.getInt('scans:user123:paid_left') === 5, 'no credit deducted');
});

await test('deep grade with 0 edges — rejects (needs 2 minimum)', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, () => { throw new Error('should not reach openai'); });
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: false }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 400, '400');
  assert(res.body.edgeCount === 0, 'edgeCount=0');
  assert(res.body.needsMoreEdges === 2, 'needsMoreEdges=2');
  assert(kv.getInt('scans:user123:paid_left') === 5, 'no credit deducted');
});

await test('deep grade with front only — rejects on missing back FIRST', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, () => { throw new Error('should not reach openai'); });
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: false, hasEdges: false }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 400, '400');
  assert(res.body.missingPhotos.includes('back'), 'reports missing back');
  assert(kv.getInt('scans:user123:paid_left') === 5, 'no credit deducted');
});

// ─── Group 4: Insufficient credits for deep grade ───
console.log('\n[4] Deep Grade — insufficient credits');

await test('deep grade with only 1 credit — 402, no OpenAI call, no partial deduct', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '1' });
  let openaiCalled = false;
  installMocks(kv, () => { openaiCalled = true; return goodOpenAI('grade')(); });
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 402, 'want 402 got ' + res.statusCode);
  assert(res.body.needsPayment === true, 'needsPayment');
  assert(res.body.deepGrade === true, 'deepGrade flag in error');
  assert(res.body.cost === 2, 'cost=2 in error');
  assert(kv.getInt('scans:user123:paid_left') === 1, 'paid_left UNCHANGED');
  assert(openaiCalled === false, 'openai not called');
});

await test('quick grade with 0 credits — 402, no OpenAI', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '0' });
  let openaiCalled = false;
  installMocks(kv, () => { openaiCalled = true; return goodOpenAI('grade')(); });
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 402, '402');
  assert(openaiCalled === false, 'openai not called');
});

await test('deep grade with 0 credits — 402', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '0' });
  installMocks(kv, () => goodOpenAI('grade')());
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 402, '402');
});

await test('deep grade with exactly 2 credits — succeeds, drains to 0', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '2' });
  installMocks(kv, goodOpenAI('grade'));
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200');
  assert(kv.getInt('scans:user123:paid_left') === 0, 'drained');
});

// ─── Group 5: Refund logic ───
console.log('\n[5] Refunds — credits returned on failure');

await test('deep grade + OpenAI 500 — refunds BOTH credits', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, failingOpenAI());
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 502, 'want 502 got ' + res.statusCode);
  assert(kv.getInt('scans:user123:paid_left') === 5, `refunded — want 5 got ${kv.getInt('scans:user123:paid_left')}`);
});

await test('quick grade + OpenAI 500 — refunds 1 credit', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, failingOpenAI());
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 502, '502');
  assert(kv.getInt('scans:user123:paid_left') === 5, 'refunded to 5');
});

await test('identify + Ximilar provider failure — 503 and refunds id_paid_left', async () => {
  // Rewritten 2026-09-10. The case used to fail OpenAI, but identify no longer
  // touches OpenAI at all: Ximilar is the sole identity authority and there is
  // no GPT fallback (api/scan.js:980-982, :1032-1036). Failing OpenAI left the
  // real provider healthy, so the case proved nothing about the refund. Fail
  // the provider that identify actually uses.
  const kv = new MockKV({ 'scans:user123:id_paid_left': '10' });
  installMocks(kv, failingOpenAI(), failingXimilar(500));
  const req = makeReq(bodyFor({ mode: 'identify' }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 503, 'want 503 got ' + res.statusCode);
  assert(res.body.code === 'IDENTIFY_PROVIDER_UNAVAILABLE', 'provider-unavailable code');
  assert(kv.getInt('scans:user123:id_paid_left') === 10, 'refunded');
});

await test('deep grade + garbled OpenAI response — refunds both', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, malformedOpenAI());
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 502, '502');
  assert(kv.getInt('scans:user123:paid_left') === 5, 'both refunded');
});

await test('deep grade + OpenAI returns card_name empty — refunds both', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  const emptyNameOpenAI = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      choices: [{ message: { content: JSON.stringify({ card_name: '' }) } }],
    }),
    text: () => Promise.resolve(''),
  });
  // Grade mode grounds the card identity through Ximilar before it asks the
  // model, so an empty model card_name is no longer fatal on its own — the
  // grounded name fills it. The unnamed-card refund therefore only triggers
  // when NEITHER source produced a name, which is what this case now sets up.
  installMocks(kv, emptyNameOpenAI, failingXimilar(500));
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 422, 'want 422 got ' + res.statusCode);
  assert(kv.getInt('scans:user123:paid_left') === 5, 'both refunded');
});

// ─── Group 6: Response shape (frontend contract) ───
console.log('\n[6] Response shape — frontend contract');

await test('quick grade response has legacy + new fields', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, goodOpenAI('grade'));
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  const legacy = ['card_name','centering','corners','edges','surface','psa_estimate','grade_label','grade_notes','worth_grading'];
  for (const f of legacy) assert(f in res.body, `legacy field ${f} missing`);
  assert('subgrades' in res.body, 'subgrades in response');
  assert('confidence' in res.body, 'confidence in response');
  assert('deepGrade' in res.body, 'deepGrade in response');
  assert('creditsUsed' in res.body, 'creditsUsed in response');
  assert('photoCount' in res.body, 'photoCount in response');
});

await test('sub-grades are clamped to 1-10 and coerced from strings', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  const dirtyOpenAI = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      choices: [{ message: { content: JSON.stringify({
        card_name: 'Test', centering: 'x', corners: 'x', edges: 'x', surface: 'x',
        psa_estimate: 8, grade_label: 'x', grade_notes: 'x', worth_grading: false,
        subgrades: { centering: '9.5', corners: 15, edges: -3, surface: 'nope' },
        confidence: 'MEDIUM',
      }) } }],
    }),
    text: () => Promise.resolve(''),
  });
  installMocks(kv, dirtyOpenAI);
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.body.subgrades.centering === 9.5, 'string→number');
  assert(res.body.subgrades.corners === 10, 'clamp high');
  assert(res.body.subgrades.edges === 1, 'clamp low');
  assert(res.body.subgrades.surface === null, 'invalid → null');
  assert(res.body.confidence === 'medium', 'confidence lowercased');
});

await test('confidence cap: GPT says high but only 2 photos → downgrades to medium', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  const highConfOpenAI = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      choices: [{ message: { content: JSON.stringify({
        card_name: 'Test', centering: 'x', corners: 'x', edges: 'x', surface: 'x',
        psa_estimate: 10, grade_label: 'Gem Mint', grade_notes: 'x', worth_grading: true,
        subgrades: { centering: 10, corners: 10, edges: 10, surface: 10 },
        confidence: 'high',
      }) } }],
    }),
    text: () => Promise.resolve(''),
  });
  installMocks(kv, highConfOpenAI);
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.body.confidence === 'medium', `should cap to medium at 2 photos, got ${res.body.confidence}`);
});

await test('confidence: GPT says low, 6 photos → keeps low (no forced upgrade)', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  const lowConfOpenAI = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      choices: [{ message: { content: JSON.stringify({
        card_name: 'Test', centering: 'x', corners: 'x', edges: 'x', surface: 'x',
        psa_estimate: 5, grade_label: 'x', grade_notes: 'blurry photos', worth_grading: false,
        subgrades: { centering: 5, corners: 5, edges: 5, surface: 5 },
        confidence: 'low',
      }) } }],
    }),
    text: () => Promise.resolve(''),
  });
  installMocks(kv, lowConfOpenAI);
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.body.confidence === 'low', 'low preserved even with 6 photos');
});

await test('OpenAI omits subgrades entirely — response has null sub-grades', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  const noSubOpenAI = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      choices: [{ message: { content: JSON.stringify({
        card_name: 'T', centering: 'x', corners: 'x', edges: 'x', surface: 'x',
        psa_estimate: 8, grade_label: 'x', grade_notes: 'x', worth_grading: false,
      }) } }],
    }),
    text: () => Promise.resolve(''),
  });
  installMocks(kv, noSubOpenAI);
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200');
  assert(res.body.subgrades.centering === null, 'null when missing');
  assert(res.body.confidence === 'medium', 'default confidence for quick grade');
});

// ─── Group 7: Auth regressions ───
console.log('\n[7] Auth regressions — the token is the identity');

// These two cases previously asserted the OPPOSITE of current behaviour: that
// a missing token falls back to body email + googleSub. The 2026-08-25
// hardening at api/scan.js:646 removed that fallback deliberately, because it
// let an unauthenticated caller drain a victim's credits by naming their uid.
// The fixture was wrong, not the product.

await test('no token — 401, body identity is ignored', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, goodOpenAI('grade'));
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), null);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 401, 'want 401 got ' + res.statusCode);
  assert(kv.getInt('scans:user123:paid_left') === 5, 'no credit moved');
});

await test('unsigned token — 401, no credit moved', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, goodOpenAI('grade'));
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), makeUnsignedToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 401, 'want 401 got ' + res.statusCode);
  assert(kv.getInt('scans:user123:paid_left') === 5, 'no credit moved');
});

await test('tampered signature on an otherwise valid token — 401', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, goodOpenAI('grade'));
  const bad = await signer.mintTampered({ sub: FIXTURE_SUB, email: FIXTURE_EMAIL });
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), bad);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 401, 'want 401 got ' + res.statusCode);
  assert(kv.getInt('scans:user123:paid_left') === 5, 'no credit moved');
});

await test('correctly signed but wrong audience — 401', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, goodOpenAI('grade'));
  const bad = await signer.mint({ sub: FIXTURE_SUB, email: FIXTURE_EMAIL, aud: 'some-other-project' });
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), bad);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 401, 'want 401 got ' + res.statusCode);
  assert(kv.getInt('scans:user123:paid_left') === 5, 'no credit moved');
});

await test('correctly signed but expired — 401', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, goodOpenAI('grade'));
  const past = Math.floor(Date.now() / 1000) - 7200;
  const bad = await signer.mint({ sub: FIXTURE_SUB, email: FIXTURE_EMAIL, iat: past, exp: past + 60 });
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), bad);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 401, 'want 401 got ' + res.statusCode);
  assert(kv.getInt('scans:user123:paid_left') === 5, 'no credit moved');
});

await test('signed by an unpublished key — 401', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, goodOpenAI('grade'));
  // A DIFFERENT signer: correct claims, correct shape, key nobody publishes.
  const rogue = await makeSigner({ kid: 'roguekid' });
  const bad = await rogue.mint({ sub: FIXTURE_SUB, email: FIXTURE_EMAIL });
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), bad);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 401, 'want 401 got ' + res.statusCode);
  assert(kv.getInt('scans:user123:paid_left') === 5, 'no credit moved');
});

await test('the credited identity is the token subject, not the body', async () => {
  // The attack the hardening closed: body names the victim, token names the
  // caller. The debit must land on the TOKEN's uid.
  const kv = new MockKV({ 'scans:victim999:paid_left': '5', 'scans:user123:paid_left': '5' });
  installMocks(kv, goodOpenAI('grade'));
  const body = bodyFor({ mode: 'grade', hasBack: true });
  body.googleSub = 'victim999';
  body.email = 'victim@example.com';
  const req = makeReq(body, goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, 'want 200 got ' + res.statusCode + ' body: ' + JSON.stringify(res.body));
  assert(kv.getInt('scans:victim999:paid_left') === 5, 'victim untouched');
  assert(kv.getInt('scans:user123:paid_left') === 4, 'token subject debited');
});

// ─── Group 8: Method + input validation ───
console.log('\n[8] HTTP + input validation');

await test('GET request — 405', async () => {
  const req = { method: 'GET', headers: {}, body: {} };
  const res = makeRes();
  await handler(req, res);
  assert(res.statusCode === 405, '405');
});

await test('no imageBase64 (quick grade with back) — 400, no credit deducted', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, goodOpenAI('grade'));
  const body = bodyFor({ mode: 'grade', hasBack: true });
  delete body.imageBase64;
  const req = makeReq(body, goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 400, 'want 400 got ' + res.statusCode);
  assert(kv.getInt('scans:user123:paid_left') === 5, 'no credit deducted');
});

// ─── Group 9: Free scans (Pro users) ───
console.log('\n[9] Pro free scans');

await test('deep grade for Pro user with all free scans left — deducts from free bucket', async () => {
  // We simulate a Pro user by seeding pro:<sub> KV so checkProStatus returns true
  const kv = new MockKV({
    'pro:user123': JSON.stringify({ status: 'active' }),
    'scans:user123:paid_left': '0',
    // free bucket empty this month — Pro gets 10, so freeLeft = 10 - 0 = 10
  });
  installMocks(kv, goodOpenAI('grade'));
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200 got ' + res.statusCode + ' body ' + JSON.stringify(res.body));
  // free_used should have been incremented by 2
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  assert(kv.getInt(`scans:user123:free_used_${stamp}`) === 2, `free_used got ${kv.getInt(`scans:user123:free_used_${stamp}`)}`);
  assert(kv.getInt('scans:user123:paid_left') === 0, 'paid_left untouched');
});

await test('deep grade for Pro with 1 free + 10 paid — uses paid (no bucket mixing)', async () => {
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const kv = new MockKV({
    'pro:user123': JSON.stringify({ status: 'active' }),
    'scans:user123:paid_left': '10',
    // One free grade left. The Pro monthly grant is read from the product
    // instead of hardcoded: the fixture said 9 with a comment claiming
    // "freeLeft = 1", which was true when the grant was 10 and silently false
    // once it became 15 (api/_tier.js:26). With 6 free left the endpoint
    // correctly used the free bucket and the case read as a product defect.
    [`scans:user123:free_used_${stamp}`]: String(TIER_BENEFITS.pro.gradeGrant - 1),
  });
  installMocks(kv, goodOpenAI('grade'));
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), goodToken);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200');
  assert(kv.getInt('scans:user123:paid_left') === 8, `paid_left -2 got ${kv.getInt('scans:user123:paid_left')}`);
  assert(kv.getInt(`scans:user123:free_used_${stamp}`) === TIER_BENEFITS.pro.gradeGrant - 1,
    'free_used unchanged');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n──────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name}\n     ${f.err}`);
  _finish(passed, failed);
}

_finish(passed, failed);
