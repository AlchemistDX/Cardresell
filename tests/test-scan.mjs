// tests/test-scan.mjs
// Integration tests for /api/scan — Deep Grade + credit math + refunds + regressions.
// Mocks global fetch to intercept OpenAI + Upstash KV traffic, then calls the handler directly.

import handler from '../api/scan.js';

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
    // /incr/<key>
    m = u.pathname.match(/^\/incr\/(.+)$/);
    if (m) {
      const key = decodeURIComponent(m[1]);
      const cur = parseInt(this.store[key] ?? '0') || 0;
      this.store[key] = String(cur + 1);
      this.opLog.push(['incr', key]);
      return this._resp({ result: cur + 1 });
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

// Global fetch mock — routed based on URL host
let currentKV = null;
let openaiHandler = null;
let pokemonTcgHandler = null;
const originalFetch = globalThis.fetch;

// Default PokemonTCG.io mock — returns the card GPT identified as a real match,
// so the identify-path returns the same values it did pre-verification.
function defaultPokemonTcgHandler() {
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      data: [{
        id: 'swsh3-020',
        name: 'Charizard VMAX',
        number: '020',
        set: { name: 'Darkness Ablaze' },
        hp: '330',
        rarity: 'Rainbow Rare',
        supertype: 'Pokemon',
      }],
    }),
    text: () => Promise.resolve(''),
  });
}

function installMocks(kv, openaiFn, pokemonTcgFn) {
  currentKV = kv;
  openaiHandler = openaiFn;
  pokemonTcgHandler = pokemonTcgFn || defaultPokemonTcgHandler;
  globalThis.fetch = (url, options) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.startsWith(process.env.KV_REST_API_URL)) return currentKV.handleRequest(u, options);
    if (u.includes('openai.com'))               return openaiHandler(u, options);
    if (u.includes('api.pokemontcg.io'))         return pokemonTcgHandler(u, options);
    if (u.includes('stripe.com'))               return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
    throw new Error('Unexpected fetch: ' + u);
  };
}
function restoreFetch() { globalThis.fetch = originalFetch; }

// ── Fake Firebase JWT (unsigned, just for token parsing tests) ────────────
function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function makeFakeToken(uid = 'user123', email = 'test@example.com', verified = true) {
  // Use a token so short/malformed it takes the body-email fallback path
  // (Firebase verification will fail; handler proceeds with body values.)
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
function bodyFor({ mode, deepGrade = false, hasBack = false, hasEdges = false } = {}) {
  const b = {
    imageBase64: 'AAAA',
    mimeType: 'image/jpeg',
    email: 'test@example.com',
    googleSub: 'user123',
    mode,
  };
  if (deepGrade) b.deepGrade = true;
  if (hasBack) { b.backBase64 = 'BBBB'; b.backMimeType = 'image/jpeg'; }
  if (hasEdges) {
    b.topEdgeBase64 = 'CCCC';    b.topEdgeMimeType = 'image/jpeg';
    b.bottomEdgeBase64 = 'DDDD'; b.bottomEdgeMimeType = 'image/jpeg';
    b.leftEdgeBase64 = 'EEEE';   b.leftEdgeMimeType = 'image/jpeg';
    b.rightEdgeBase64 = 'FFFF';  b.rightEdgeMimeType = 'image/jpeg';
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
  const req = makeReq(bodyFor({ mode: 'grade' }), makeFakeToken());
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
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), makeFakeToken());
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
  assert(res.body.subgrades && res.body.subgrades.centering === 9, 'subgrades present');
  // Confidence capped at medium for 2-photo quick grade
  assert(res.body.confidence === 'medium', `confidence capped at medium, got ${res.body.confidence}`);
});

await test('identify mode — deducts 1 from id_paid_left, not paid_left', async () => {
  const kv = new MockKV({
    'scans:user123:id_paid_left': '10',
    'scans:user123:paid_left': '2',
  });
  installMocks(kv, goodOpenAI('identify'));
  const req = makeReq(bodyFor({ mode: 'identify' }), makeFakeToken());
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
  const req = makeReq(bodyFor({ mode: 'identify' }), makeFakeToken());
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
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), makeFakeToken());
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
  assert(res.body.subgrades.centering === 9, 'subgrades in response');
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
  const req = makeReq(body, makeFakeToken());
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
  const req = makeReq(body, makeFakeToken());
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
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: false, hasEdges: true }), makeFakeToken());
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
  const req = makeReq(body, makeFakeToken());
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
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: false }), makeFakeToken());
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
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: false, hasEdges: false }), makeFakeToken());
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
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), makeFakeToken());
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
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 402, '402');
  assert(openaiCalled === false, 'openai not called');
});

await test('deep grade with 0 credits — 402', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '0' });
  installMocks(kv, () => goodOpenAI('grade')());
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 402, '402');
});

await test('deep grade with exactly 2 credits — succeeds, drains to 0', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '2' });
  installMocks(kv, goodOpenAI('grade'));
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), makeFakeToken());
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
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 502, 'want 502 got ' + res.statusCode);
  assert(kv.getInt('scans:user123:paid_left') === 5, `refunded — want 5 got ${kv.getInt('scans:user123:paid_left')}`);
});

await test('quick grade + OpenAI 500 — refunds 1 credit', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, failingOpenAI());
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 502, '502');
  assert(kv.getInt('scans:user123:paid_left') === 5, 'refunded to 5');
});

await test('identify + OpenAI 500 — refunds id_paid_left', async () => {
  const kv = new MockKV({ 'scans:user123:id_paid_left': '10' });
  installMocks(kv, failingOpenAI());
  const req = makeReq(bodyFor({ mode: 'identify' }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 502, '502');
  assert(kv.getInt('scans:user123:id_paid_left') === 10, 'refunded');
});

await test('deep grade + garbled OpenAI response — refunds both', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, malformedOpenAI());
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), makeFakeToken());
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
  installMocks(kv, emptyNameOpenAI);
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), makeFakeToken());
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
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), makeFakeToken());
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
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), makeFakeToken());
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
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), makeFakeToken());
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
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), makeFakeToken());
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
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200');
  assert(res.body.subgrades.centering === null, 'null when missing');
  assert(res.body.confidence === 'medium', 'default confidence for quick grade');
});

// ─── Group 7: Auth regressions ───
console.log('\n[7] Auth regressions — body-fallback + no-auth');

await test('no token — falls back to body email + googleSub', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, goodOpenAI('grade'));
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), null);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, 'want 200 got ' + res.statusCode + ' body: ' + JSON.stringify(res.body));
  assert(kv.getInt('scans:user123:paid_left') === 4, 'deducted');
});

await test('no email anywhere — 401 unauthorized', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, goodOpenAI('grade'));
  const body = bodyFor({ mode: 'grade', hasBack: true });
  body.email = '';
  body.googleSub = '';
  const req = makeReq(body, null);
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 401, '401');
  assert(kv.getInt('scans:user123:paid_left') === 5, 'unchanged');
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
  const req = makeReq(body, makeFakeToken());
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
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), makeFakeToken());
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
    [`scans:user123:free_used_${stamp}`]: '9', // freeLeft = 1
  });
  installMocks(kv, goodOpenAI('grade'));
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200');
  assert(kv.getInt('scans:user123:paid_left') === 8, `paid_left -2 got ${kv.getInt('scans:user123:paid_left')}`);
  assert(kv.getInt(`scans:user123:free_used_${stamp}`) === 9, 'free_used unchanged');
});

// ─── Group 10: PokemonTCG.io verification (hallucination guard) ───
console.log('\n[10] Server-side PokemonTCG.io verification');

await test('identify — GPT high confidence + PokemonTCG match — passes through', async () => {
  const kv = new MockKV({ 'scans:user123:id_paid_left': '5' });
  installMocks(kv, goodOpenAI('identify')); // default PokemonTCG mock returns matching card
  const req = makeReq(bodyFor({ mode: 'identify' }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200 got ' + res.statusCode);
  assert(res.body.card_name === 'Charizard VMAX', 'name preserved');
  assert(res.body.card_number === '020', 'number normalized to match');
  assert(res.body.set_name === 'Darkness Ablaze', 'set preserved');
  assert(res.body.confidence !== 'low', 'not downgraded when verified');
});

await test('identify — hallucinated set+number, real name — rewrites with real card', async () => {
  const kv = new MockKV({ 'scans:user123:id_paid_left': '5' });
  // GPT returns real Wigglytuff name but hallucinates "MEO2: Phantasmal Flames · 105/094"
  const openai = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      choices: [{ message: { content: JSON.stringify({
        card_name: 'Wigglytuff',
        card_number: '105/094',
        set_name: 'MEO2: Phantasmal Flames', // fake set
        hp: '90',
        card_type: 'pokemon',
        rarity: 'Rare Holo',
        confidence: 'high',
      }) } }],
    }),
    text: () => Promise.resolve(''),
  });
  // PokemonTCG.io returns the REAL Wigglytuff card
  const pokemonTcg = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      data: [{
        id: 'cg1-13',
        name: 'Wigglytuff',
        number: '13',
        set: { name: 'Crystal Guardians' },
        hp: '80',
        rarity: 'Rare Holo',
        supertype: 'Pokemon',
      }],
    }),
    text: () => Promise.resolve(''),
  });
  installMocks(kv, openai, pokemonTcg);
  const req = makeReq(bodyFor({ mode: 'identify' }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200 got ' + res.statusCode);
  assert(res.body.card_name === 'Wigglytuff', 'name kept');
  assert(res.body.card_number === '13', `number rewritten got ${res.body.card_number}`);
  assert(res.body.set_name === 'Crystal Guardians', `set rewritten got ${res.body.set_name}`);
  assert(res.body.verified_by === 'pokemontcg', 'flagged as verified');
  // Confidence downgraded because we corrected the model
  assert(res.body.confidence === 'medium', `confidence downgraded got ${res.body.confidence}`);
});

await test('identify — GPT name is total hallucination — downgrades to low + unverified', async () => {
  const kv = new MockKV({ 'scans:user123:id_paid_left': '5' });
  const openai = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      choices: [{ message: { content: JSON.stringify({
        card_name: 'Fakemon Ultra V',
        card_number: '999/999',
        set_name: 'Made Up Set',
        confidence: 'high',
      }) } }],
    }),
    text: () => Promise.resolve(''),
  });
  // PokemonTCG.io returns no results
  const pokemonTcg = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({ data: [] }),
    text: () => Promise.resolve(''),
  });
  installMocks(kv, openai, pokemonTcg);
  const req = makeReq(bodyFor({ mode: 'identify' }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200 got ' + res.statusCode);
  assert(res.body.confidence === 'low', `confidence low got ${res.body.confidence}`);
  assert(res.body.unverified === true, 'flagged unverified');
  assert(res.body.verified_by === 'pokemontcg', 'verified_by set');
});

await test('identify — correct number+hp finds right card across multiple sets (Wigglytuff #105 regression)', async () => {
  const kv = new MockKV({ 'scans:user123:id_paid_left': '5' });
  // GPT correctly reads number+hp off the card, but guesses the wrong set
  const openai = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      choices: [{ message: { content: JSON.stringify({
        card_name: 'Wigglytuff',
        card_number: '105/094',
        set_name: 'Paradox Rift',  // wrong — real answer is Phantasmal Flames
        hp: '120',
        card_type: 'pokemon',
        rarity: 'Illustration Rare',
        confidence: 'high',
      }) } }],
    }),
    text: () => Promise.resolve(''),
  });
  // Simulate the real Pokemon TCG API behavior: first query (name-scoped)
  // returns 20 old Wigglytuffs, none numbered 105. Second query
  // (name+number-scoped) returns the correct me2-105 Phantasmal Flames card.
  let callIdx = 0;
  const pokemonTcg = (url) => {
    callIdx++;
    // The first query is number-scoped now (`name:Wigglytuff* number:105`)
    // and returns the correct me2-105 directly.
    if (url.includes('number%3A105') || url.includes('number:105')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({
          data: [{
            id: 'me2-105',
            name: 'Wigglytuff',
            number: '105',
            set: { name: 'Phantasmal Flames' },
            hp: '120',
            rarity: 'Illustration Rare',
            supertype: 'Pokemon',
          }],
        }),
        text: () => Promise.resolve(''),
      });
    }
    // Fallback queries return the wrong-set cards
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({
        data: [
          { id: 'ex14-13', name: 'Wigglytuff', number: '13', set: { name: 'Crystal Guardians' }, hp: '90', rarity: 'Rare Holo' },
          { id: 'swsh3-68', name: 'Wigglytuff', number: '68', set: { name: 'Darkness Ablaze' }, hp: '120', rarity: 'Rare' },
        ],
      }),
      text: () => Promise.resolve(''),
    });
  };
  installMocks(kv, openai, pokemonTcg);
  const req = makeReq(bodyFor({ mode: 'identify' }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200 got ' + res.statusCode);
  assert(res.body.card_name === 'Wigglytuff', 'name kept');
  assert(res.body.card_number === '105', `number preserved got ${res.body.card_number}`);
  assert(res.body.set_name === 'Phantasmal Flames', `set corrected to Phantasmal Flames got ${res.body.set_name}`);
  assert(res.body.verified_by === 'pokemontcg', 'flagged verified');
});

await test('identify — PokemonTCG.io unavailable — still returns GPT answer (skip)', async () => {
  const kv = new MockKV({ 'scans:user123:id_paid_left': '5' });
  const pokemonTcg = () => Promise.resolve({
    ok: false, status: 500,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve('server error'),
  });
  installMocks(kv, goodOpenAI('identify'), pokemonTcg);
  const req = makeReq(bodyFor({ mode: 'identify' }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200 got ' + res.statusCode);
  assert(res.body.card_name === 'Charizard VMAX', 'GPT answer preserved on API outage');
  assert(res.body.card_number === '020/189', 'number unchanged on outage');
  assert(res.body.unverified !== true, 'not marked unverified on outage');
});

// ─── Group 11: Deep Grade precision fields (single PSA + confidence % + located flaws) ───
console.log('\n[11] Deep Grade precision fields — single PSA + confidence % + located flaws');

// Reusable OpenAI stub returning the new Deep Grade schema.
function deepGradePrecisionOpenAI(overrides = {}) {
  return () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      choices: [{ message: { content: JSON.stringify({
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
        confidence_pct: 82,
        located_flaws: [
          { location: 'top-left corner', severity: 'light', description: 'faint whitening under angled light' },
          { location: 'front surface — holo area', severity: 'faint', description: 'one micro print line' },
        ],
        needs_more_photos: false,
        ...overrides,
      }) } }],
    }),
    text: () => Promise.resolve(''),
  });
}

await test('deep grade (6 photos) returns confidence_pct + located_flaws + needs_more_photos', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, deepGradePrecisionOpenAI());
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200 got ' + res.statusCode);
  assert(res.body.deepGrade === true, 'deepGrade true');
  // Single integer PSA — no range.
  assert(res.body.psa_estimate === 9, 'psa_estimate=9');
  // confidence_pct present as number 0-100.
  assert(typeof res.body.confidence_pct === 'number', 'confidence_pct is number');
  assert(res.body.confidence_pct === 82, 'confidence_pct passthrough = 82');
  // Located flaws sanitized + preserved.
  assert(Array.isArray(res.body.located_flaws), 'located_flaws is array');
  assert(res.body.located_flaws.length === 2, 'two flaws');
  assert(res.body.located_flaws[0].location === 'top-left corner', 'flaw location');
  assert(res.body.located_flaws[0].severity === 'light', 'flaw severity');
  assert(typeof res.body.located_flaws[0].description === 'string' && res.body.located_flaws[0].description.length > 0, 'flaw description');
  assert(res.body.needs_more_photos === false, 'needs_more_photos false');
});

await test('deep grade low confidence (< 40%) auto-sets needs_more_photos=true', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, deepGradePrecisionOpenAI({ confidence_pct: 30, needs_more_photos: false }));
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200');
  assert(res.body.confidence_pct === 30, 'pct passthrough');
  // Server forces needs_more_photos=true when pct < 40 even if GPT said false.
  assert(res.body.needs_more_photos === true, 'needs_more_photos auto-forced when pct < 40');
});

await test('deep grade confidence_pct clamped by photo count (4 photos → cap 80)', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  // GPT over-claims 95% on 4 photos (front+back+2 edges).
  installMocks(kv, deepGradePrecisionOpenAI({ confidence_pct: 95 }));
  const b = bodyFor({ mode: 'grade', deepGrade: true, hasBack: true });
  b.topEdgeBase64 = 'CCCC'; b.topEdgeMimeType = 'image/jpeg';
  b.bottomEdgeBase64 = 'DDDD'; b.bottomEdgeMimeType = 'image/jpeg';
  const req = makeReq(b, makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200');
  assert(res.body.photoCount === 4, '4 photos');
  assert(res.body.confidence_pct === 80, `confidence_pct capped at 80, got ${res.body.confidence_pct}`);
});

await test('deep grade with malformed located_flaws entries — sanitized', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, deepGradePrecisionOpenAI({
    located_flaws: [
      { location: 'top-left corner', severity: 'LiGhT', description: 'ok' },  // severity case-insensitive
      { location: '', severity: 'bogus', description: 'dropped severity' },   // bad severity → defaults
      null,                                                                    // null entry — filtered
      { severity: 'heavy' },                                                   // no location — defaults
      'not an object',                                                         // filtered
    ],
  }));
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200');
  const flaws = res.body.located_flaws;
  // Must NOT contain null/string entries and severity is normalized lowercase.
  assert(flaws.every(f => f && typeof f === 'object'), 'no non-objects');
  assert(flaws[0].severity === 'light', 'severity lowercased');
  // Bogus severity defaults to "light".
  const bogus = flaws.find(f => f.description === 'dropped severity');
  assert(bogus && bogus.severity === 'light', 'bogus severity defaults to light');
});

await test('deep grade empty located_flaws is valid (flawless card)', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, deepGradePrecisionOpenAI({ located_flaws: [], confidence_pct: 90 }));
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200');
  assert(Array.isArray(res.body.located_flaws), 'located_flaws is array');
  assert(res.body.located_flaws.length === 0, 'zero flaws');
});

await test('deep grade falls back to derived confidence_pct when GPT omits it', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  // Omit confidence_pct entirely; GPT says confidence="high", 6 photos.
  installMocks(kv, deepGradePrecisionOpenAI({ confidence_pct: undefined }));
  const req = makeReq(bodyFor({ mode: 'grade', deepGrade: true, hasBack: true, hasEdges: true }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200');
  assert(typeof res.body.confidence_pct === 'number', 'derived pct is a number');
  // 6 photos + confidence "high" → fallback = 85, cap = 95, so expect 85.
  assert(res.body.confidence_pct === 85, 'derived pct = 85, got ' + res.body.confidence_pct);
});

await test('quick grade does NOT include Deep-only fields as populated values', async () => {
  const kv = new MockKV({ 'scans:user123:paid_left': '5' });
  installMocks(kv, goodOpenAI('grade'));
  const req = makeReq(bodyFor({ mode: 'grade', hasBack: true }), makeFakeToken());
  const res = makeRes();
  await handler(req, res);
  restoreFetch();
  assert(res.statusCode === 200, '200');
  assert(res.body.deepGrade === false, 'deepGrade false');
  // Backward compat: Deep-only fields are present but null/empty for Quick Grade.
  assert(res.body.confidence_pct === null, 'confidence_pct null for Quick Grade');
  assert(Array.isArray(res.body.located_flaws) && res.body.located_flaws.length === 0, 'located_flaws empty for Quick Grade');
  assert(res.body.needs_more_photos === false, 'needs_more_photos false for Quick Grade');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n──────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name}\n     ${f.err}`);
  process.exit(1);
}
