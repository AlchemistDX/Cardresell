/**
 * POST /api/photo-upload -- the authorization boundary and the byte gate.
 *
 * WHAT THIS SUITE PROVES. That the only door turning a seller's photograph
 * into a public https URL refuses, in order: an unauthenticated caller, a
 * caller who does not own the draft, and bytes that are not an image type we
 * can name. And that with no host configured it reports NOT_CONFIGURED rather
 * than pretending success.
 *
 * The ownership case is the one that matters. It runs a REAL second account
 * against a draft owned by the first, through the real handler, with the real
 * store -- not a unit check on a helper. Where a test asserts a refusal it
 * also asserts the same request SUCCEEDS for the owner, so a handler that
 * refused everybody could not pass.
 *
 * Run: node tests/photo-upload-endpoint-2026-09-13.mjs
 */

import { harness } from './_assert.mjs';

const T = harness('photo upload endpoint');

// ── in-memory Upstash over fetch, plus the token endpoint ─────────────────
const store = new Map();

const OWNER_EMAIL = 'owner@example.com';
const OTHER_EMAIL = 'other@example.com';
// Which email the next token verifies as. The handler resolves the uid from
// the token, so switching this switches accounts exactly as two real signed-in
// devices would.
let currentEmail = OWNER_EMAIL;

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('oauth2.googleapis.com/tokeninfo')) {
    return {
      ok: true, status: 200,
      json: async () => ({
        aud: '971593505703-6feq3nn7p9580krori6r157rfm5tp88l.apps.googleusercontent.com',
        email: currentEmail, sub: 'google-sub-not-used',
      }),
    };
  }
  if (u.includes('googleapis.com')) return { ok: false, status: 500, json: async () => ({}) };

  const parts = u.replace('https://kv.test/', '').split('/').map(decodeURIComponent);
  const [cmdRaw, ...rest] = parts;
  const cmd = cmdRaw.toLowerCase();
  if (cmd === 'get') {
    const v = store.has(rest[0]) ? store.get(rest[0]) : null;
    return { ok: true, status: 200, json: async () => ({ result: v }) };
  }
  if (cmd === 'set') {
    store.set(rest[0], rest[1]);
    return { ok: true, status: 200, json: async () => ({ result: 'OK' }) };
  }
  if (cmd === 'del') {
    store.delete(rest[0]);
    return { ok: true, status: 200, json: async () => ({ result: 1 }) };
  }
  return { ok: true, status: 200, json: async () => ({ result: null }) };
};

process.env.KV_REST_API_URL = 'https://kv.test';
process.env.KV_REST_API_TOKEN = 'test-token';

const DS = await import('../api/_draftStore.js');
const KVM = await import('../api/_kv.js');
const HOST = await import('../api/_photoHost.js');
const EP = await import('../api/photo-upload.js');

const kv = KVM.makeKv('https://kv.test', 'test-token');

// The handler resolves a uid by email, so the two accounts are distinct subs.
const OWNER_SUB = 'owner-sub-0001';
const OTHER_SUB = 'other-sub-0002';
store.set(`uid_by_email:${OWNER_EMAIL}`, OWNER_SUB);
store.set(`uid_by_email:${OTHER_EMAIL}`, OTHER_SUB);

function fakeReq({ method = 'POST', body, query, headers } = {}) {
  return {
    method,
    body,
    query: query || {},
    headers: headers === undefined ? { authorization: 'Bearer ' + 'x'.repeat(40) } : headers,
  };
}
function fakeRes() {
  return {
    statusCode: 0, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}
async function call(opts) {
  const res = fakeRes();
  await EP.default(fakeReq(opts), res);
  return res;
}

/* A real 1x1 PNG, so the byte gate is not being fed a made-up string. */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// A draft really written to the store, owned by OWNER_SUB.
/* `title` is required by buildDraft -- a draft with no title is not a thing
   the store will hold, so the fixture supplies one rather than the product
   being relaxed to accept a draft the real entry point could never create. */
const draft = DS.buildDraft({
  slot: 'ebay-fixed-price',
  title: 'Ivysaur 30/102 Base Set',
  sku: 'PKMBASE30',
  instanceId: 'inst_test_1',
  price: 12.34,
});
const DRAFT_ID = draft.draftId;
await DS.putDraft(kv, OWNER_SUB, draft, 'op-seed-1');

const body = (over = {}) => ({
  photoId: 'ph_abc123',
  contentType: 'image/png',
  dataBase64: PNG_B64,
  ...over,
});

await T.section('the owner gets past authorization', async () => {
  currentEmail = OWNER_EMAIL;
  const r = await call({ query: { id: DRAFT_ID }, body: body() });
  /* No host is configured, so the furthest a correct request can get today is
     501 NOT_CONFIGURED. That IS the pass condition: it proves auth, ownership
     and the byte gate were all satisfied, because every one of those refusals
     happens before the host is consulted. */
  T.check('the owner reaches the host step (501 NOT_CONFIGURED)',
    r.statusCode === 501 && r.body && r.body.code === HOST.PHOTO_HOST_ERR.NOT_CONFIGURED,
    `${r.statusCode} ${JSON.stringify(r.body)}`);
  T.check('the refusal explains hosting is not set up, rather than blaming the seller',
    /not set up/i.test((r.body && r.body.error) || ''), JSON.stringify(r.body));
});

await T.section('an unauthenticated caller is refused', async () => {
  const none = await call({ query: { id: DRAFT_ID }, body: body(), headers: {} });
  T.check('no Authorization header is 401', none.statusCode === 401,
    `${none.statusCode} ${JSON.stringify(none.body)}`);
  const short = await call({
    query: { id: DRAFT_ID }, body: body(), headers: { authorization: 'Bearer abc' },
  });
  T.check('a too-short token is 401', short.statusCode === 401, String(short.statusCode));
  T.check('the refusal names signing in', /sign in/i.test((none.body && none.body.error) || ''),
    JSON.stringify(none.body));
});

await T.section('a caller who does not own the draft cannot host its photos', async () => {
  // The SAME request that just reached the host step, from a second real
  // account. Nothing about the request changes except who is signed in.
  currentEmail = OTHER_EMAIL;
  const r = await call({ query: { id: DRAFT_ID }, body: body() });
  T.check('🔴 a non-owner is refused', r.statusCode !== 501 && r.statusCode !== 201,
    `a non-owner reached the host step: ${r.statusCode} ${JSON.stringify(r.body)}`);
  T.check('the refusal is 404 -- another account\u2019s draft is reported absent, not forbidden',
    r.statusCode === 404, `${r.statusCode} ${JSON.stringify(r.body)}`);
  T.check('no url is returned to a non-owner', !(r.body && r.body.url), JSON.stringify(r.body));

  // And the owner still succeeds, so the refusal is about ownership and not a
  // handler that has started refusing everyone.
  currentEmail = OWNER_EMAIL;
  const owner = await call({ query: { id: DRAFT_ID }, body: body() });
  T.check('the owner is still admitted after the non-owner was refused',
    owner.statusCode === 501, String(owner.statusCode));
});

await T.section('an unknown draft is refused the same way as another account\u2019s', async () => {
  currentEmail = OWNER_EMAIL;
  const missing = await call({ query: { id: DS.newDraftId() }, body: body() });
  T.check('an id that does not exist is 404', missing.statusCode === 404,
    String(missing.statusCode));
  const noId = await call({ body: body() });
  T.check('a missing draft id is 400', noId.statusCode === 400, String(noId.statusCode));
  const badId = await call({ query: { id: 'not-a-draft-id' }, body: body() });
  T.check('a malformed draft id is 400', badId.statusCode === 400, String(badId.statusCode));
});

await T.section('the byte gate refuses what eBay could not use', async () => {
  currentEmail = OWNER_EMAIL;
  const heic = await call({
    query: { id: DRAFT_ID }, body: body({ contentType: 'image/heic' }),
  });
  T.check('an unsupported type is 415, not uploaded and renamed .jpg',
    heic.statusCode === 415 && heic.body.code === HOST.PHOTO_HOST_ERR.UNSUPPORTED_TYPE,
    `${heic.statusCode} ${JSON.stringify(heic.body)}`);

  const empty = await call({ query: { id: DRAFT_ID }, body: body({ dataBase64: '' }) });
  T.check('no image data is 400', empty.statusCode === 400, String(empty.statusCode));

  /* Buffer.from() DROPS undecodable base64 rather than throwing, so a body of
     punctuation decodes to zero bytes. Left unchecked that would upload an
     empty object and hand back a URL to nothing. */
  const junk = await call({ query: { id: DRAFT_ID }, body: body({ dataBase64: '!!!!' }) });
  T.check('undecodable base64 is refused rather than becoming an empty object',
    junk.statusCode === 400, `${junk.statusCode} ${JSON.stringify(junk.body)}`);

  const huge = 'A'.repeat(Math.ceil((HOST.UPLOAD_MAX_BYTES * 4) / 3) + 2048);
  const big = await call({ query: { id: DRAFT_ID }, body: body({ dataBase64: huge }) });
  T.check('an oversized body is 413',
    big.statusCode === 413, `${big.statusCode} ${JSON.stringify(big.body)}`);

  const noPhotoId = await call({ query: { id: DRAFT_ID }, body: body({ photoId: '' }) });
  T.check('a missing photo id is 400', noPhotoId.statusCode === 400, String(noPhotoId.statusCode));
  const nastyPhotoId = await call({
    query: { id: DRAFT_ID }, body: body({ photoId: '../../escape' }),
  });
  T.check('a photo id with path characters is refused at the door',
    nastyPhotoId.statusCode === 400, String(nastyPhotoId.statusCode));
});

await T.section('the method and storage preconditions', async () => {
  currentEmail = OWNER_EMAIL;
  const get = await call({ method: 'GET', query: { id: DRAFT_ID } });
  T.check('GET is 405', get.statusCode === 405, String(get.statusCode));
  const opts = await call({ method: 'OPTIONS' });
  T.check('OPTIONS preflight is 200', opts.statusCode === 200, String(opts.statusCode));
  T.check('CORS is answered, but it is not what authorizes the request',
    !!opts.headers['Access-Control-Allow-Origin'],
    'the authorization boundary is the token and the owner-scoped read');
});

T.done();
