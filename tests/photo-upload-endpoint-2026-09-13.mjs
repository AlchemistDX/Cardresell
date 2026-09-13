/**
 * The three photo endpoints: ticket, completion, deletion.
 *
 * WHAT THIS SUITE PROVES. That the doors turning a seller's photograph into a
 * public https URL refuse, in order: an unauthenticated caller, a caller who
 * does not own the draft, a type or size eBay could not use, and -- the one
 * that only exists because the browser now uploads directly -- a client that
 * REPORTS a successful upload which never happened.
 *
 * WHY IT WAS REWRITTEN. This suite used to exercise `api/photo-upload.js`, a
 * base64 relay that no longer exists: a 2.5MB iPhone photograph became ~3.4MB
 * on the wire and could exceed the platform's request-body boundary before any
 * application validation ran. The behaviours asserted below are the same
 * behaviours, asked of the endpoints that now answer for them. The ownership
 * case (Will's case 12) is unchanged in meaning and still runs a REAL second
 * account against the first account's draft, through the real handler and the
 * real store.
 *
 * Where a test asserts a refusal it also asserts the same request SUCCEEDS for
 * the owner, so a handler that refused everybody could not pass.
 *
 * Run: node tests/photo-upload-endpoint-2026-09-13.mjs
 */

import { harness } from './_assert.mjs';
import { createHash } from 'node:crypto';

const T = harness('photo upload endpoints');

// ── in-memory Upstash over fetch, plus the token endpoint and a fake R2 ──────
const store = new Map();

const OWNER_EMAIL = 'owner@example.com';
const OTHER_EMAIL = 'other@example.com';
let currentEmail = OWNER_EMAIL;

/* The fake bucket. `objects` is what R2 would really hold; the endpoints only
   ever learn about it through a signed HEAD, exactly as in production. */
const objects = new Map();   // key -> { byteLength, contentType }
const r2Calls = [];          // every signed request the handlers made

/* R2 returns an ETag on a HEAD. For a single PUT it is the md5 of the stored
   bytes -- which is exactly why the product records it as OPAQUE and names
   nothing after it. A fixed invented value here is enough: the assertion is
   that whatever the provider reported is what got recorded. */
const R2_ETAG = '9f8e7d6c5b4a39281706a5b4c3d2e1f0';

globalThis.fetch = async (url, opts = {}) => {
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

  // The R2 S3 endpoint. Presigned, so the path carries the key.
  if (u.includes('.r2.cloudflarestorage.com')) {
    const method = String(opts.method || 'GET').toUpperCase();
    const key = decodeURIComponent(new URL(u).pathname.replace(/^\/[^/]+\//, ''));
    r2Calls.push({ method, key, url: u });
    const rec = objects.get(key);
    if (method === 'HEAD') {
      if (!rec) return { ok: false, status: 404, headers: { get: () => null } };
      return {
        ok: true, status: 200,
        headers: {
          get: (h) => (String(h).toLowerCase() === 'content-length' ? String(rec.byteLength)
            : String(h).toLowerCase() === 'content-type' ? rec.contentType
            : String(h).toLowerCase() === 'etag' ? `"${R2_ETAG}"` : null),
        },
      };
    }
    if (method === 'DELETE') {
      if (!rec) return { ok: false, status: 404, headers: { get: () => null } };
      objects.delete(key);
      return { ok: true, status: 204, headers: { get: () => null } };
    }
    return { ok: true, status: 200, headers: { get: () => null } };
  }

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

/* R2 is configured for this suite, because the interesting assertions are
   about a CONFIGURED host. The not-configured state gets its own section,
   which clears these and puts them back. */
/* THE SHAPES ARE REAL, THE VALUES ARE NOT.
   These were placeholder strings ('acct-test', 'ak-test') until the provider
   started failing closed on malformed configuration -- and then the fixture
   was the thing that was wrong, not the product: 'acct-test' is not a shape a
   Cloudflare account id can have, so a suite that accepted it was asserting
   against a configuration that could never exist. Each value below now has
   the shape the real setting has, with invented content. */
const R2_ENV = {
  PHOTO_HOST_PROVIDER: 'r2',
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',     // 32 hex
  R2_ACCESS_KEY_ID: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',  // 32 hex
  R2_SECRET_ACCESS_KEY: 'f'.repeat(64),                   // 64 hex
  R2_BUCKET: 'cardresell-ebay-photos',
  PHOTO_HOST_PUBLIC_BASE_URL: 'https://photos.example.org',
  PHOTO_KEY_SECRET: 'test-photo-key-secret-not-a-real-one',
  PHOTO_RETENTION_DAYS: '30',
};
const setR2 = (on) => {
  for (const k of Object.keys(R2_ENV)) {
    if (on) process.env[k] = R2_ENV[k];
    else delete process.env[k];
  }
};
setR2(true);

const DS = await import('../api/_draftStore.js');
const KVM = await import('../api/_kv.js');
const HOST = await import('../api/_photoHost.js');
const TICKET = await import('../api/photo-upload-ticket.js');
const COMPLETE = await import('../api/photo-upload-complete.js');
const DELETE_EP = await import('../api/photo-delete.js');

const kv = KVM.makeKv('https://kv.test', 'test-token');

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
const callOn = (mod) => async (opts) => {
  const res = fakeRes();
  await mod.default(fakeReq(opts), res);
  return res;
};
const ticket = callOn(TICKET);
const complete = callOn(COMPLETE);
const remove = callOn(DELETE_EP);

/* A real 1x1 PNG, so nothing here is hashing a made-up string. */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_B64, 'base64');
const PNG_SHA = createHash('sha256').update(PNG_BYTES).digest('hex');
const PNG_LEN = PNG_BYTES.length;

const draft = DS.buildDraft({
  slot: 'ebay-fixed-price',
  title: 'Ivysaur 30/102 Base Set',
  sku: 'PKMBASE30',
  instanceId: 'inst_test_1',
  price: 12.34,
});
const DRAFT_ID = draft.draftId;
await DS.putDraft(kv, OWNER_SUB, draft, 'op-seed-1');

const tbody = (over = {}) => ({
  draftId: DRAFT_ID,
  photoId: 'ph_abc123',
  contentType: 'image/png',
  byteLength: PNG_LEN,
  sha256: PNG_SHA,
  ...over,
});

/* Completion now requires the receipt the ticket issued. `cbody` builds a
   completion body FROM a real ticket response rather than hand-assembling one,
   because a hand-assembled body would silently drift from what the endpoint
   actually signs and the suite would stop testing the round trip. */
const cbody = (t, over = {}) => ({
  draftId: DRAFT_ID,
  photoId: t.body.photoId,
  objectKey: t.body.objectKey,
  contentType: t.body.contentType,
  byteLength: t.body.byteLength,
  sha256: t.body.sha256,
  uploadReceipt: t.body.uploadReceipt,
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────

await T.section('the owner gets a ticket, and it is a ticket and not an upload', async () => {
  currentEmail = OWNER_EMAIL;
  const r = await ticket({ body: tbody() });
  T.check('the owner is issued a ticket (200)', r.statusCode === 200,
    `${r.statusCode} ${JSON.stringify(r.body)}`);
  T.check('a presigned PUT url is returned',
    typeof r.body.putUrl === 'string' && r.body.putUrl.startsWith('https://'),
    String(r.body && r.body.putUrl).slice(0, 40));
  T.check('the url is signed for PUT and expires',
    /X-Amz-Signature=/.test(r.body.putUrl) && /X-Amz-Expires=/.test(r.body.putUrl),
    'an unsigned or non-expiring url would be a public write handle');
  T.check('a server-computed object key is returned, not one the client named',
    typeof r.body.objectKey === 'string' && r.body.objectKey.startsWith('seller-photos/'),
    String(r.body.objectKey));

  /* THE FIVE-MINUTE WINDOW, read off the signature rather than off our own
     constant -- the constant is what we meant, the query parameter is what R2
     will enforce. */
  T.check('the signature expires in five minutes, not fifteen',
    new URL(r.body.putUrl).searchParams.get('X-Amz-Expires') === '300',
    String(new URL(r.body.putUrl).searchParams.get('X-Amz-Expires')));

  /* Content type is INSIDE the signature. Without this, the presigned URL is a
     handle to store any content type under the seller's prefix, and the
     completion HEAD would be comparing against whatever the client chose. */
  T.check('🔴 content-type is part of the signature, so the browser cannot store a different type',
    new URL(r.body.putUrl).searchParams.get('X-Amz-SignedHeaders') === 'content-type;host',
    String(new URL(r.body.putUrl).searchParams.get('X-Amz-SignedHeaders')));
  T.check('and the exact headers to send are returned rather than left to convention',
    r.body.requiredHeaders && r.body.requiredHeaders['Content-Type'] === 'image/png',
    JSON.stringify(r.body.requiredHeaders));

  /* REVERSAL, RECORDED. This suite previously asserted the ticket must NOT
     return a public url, on the reasoning that a url before the HEAD is a
     claim. The work order requires it in the ticket response, and the earlier
     reasoning does not survive contact with it: the url is derived from the
     configured public base and the server-computed key, so it is knowable at
     signing time, and returning it means a broken
     PHOTO_HOST_PUBLIC_BASE_URL is caught BEFORE the seller spends an upload
     on it. What the earlier assertion was actually protecting is unchanged and
     is asserted below: the recorded url is the one the COMPLETION endpoint
     builds after its HEAD, and a client-supplied url is never honoured. */
  T.check('the ticket returns the public url it will have, built by the server',
    typeof r.body.publicUrl === 'string'
    && r.body.publicUrl === 'https://photos.example.org/' + r.body.objectKey,
    String(r.body.publicUrl));

  T.check('a tamper-evident receipt is returned',
    typeof r.body.uploadReceipt === 'string' && r.body.uploadReceipt.split('.').length === 2,
    String(r.body.uploadReceipt).slice(0, 24));
  T.check('🔴 the receipt does not carry the seller\u2019s google subject or email',
    !r.body.uploadReceipt.includes(OWNER_SUB) && !r.body.uploadReceipt.includes(OWNER_EMAIL)
    && !Buffer.from(r.body.uploadReceipt.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64')
        .toString('utf8').includes(OWNER_EMAIL),
    'the receipt travels through the browser');

  /* The point of the rewrite: no image bytes cross this endpoint. */
  const withBytes = await ticket({ body: tbody({ dataBase64: PNG_B64 }) });
  T.check('🔴 image bytes in the request are ignored, not relayed',
    withBytes.statusCode === 200 && !withBytes.body.dataBase64 && !withBytes.body.url,
    JSON.stringify(withBytes.body).slice(0, 120));
});

await T.section('the object key hides the seller and is stable for the same bytes', async () => {
  currentEmail = OWNER_EMAIL;
  const a = await ticket({ body: tbody() });
  const b = await ticket({ body: tbody() });
  T.check('the same photo and bytes produce the SAME key -- this is what lets an unchanged photo be reused',
    a.body.objectKey === b.body.objectKey, `${a.body.objectKey} vs ${b.body.objectKey}`);

  const otherBytesSha = createHash('sha256').update(Buffer.concat([PNG_BYTES, Buffer.from([0])])).digest('hex');
  const c = await ticket({ body: tbody({ sha256: otherBytesSha, byteLength: PNG_LEN + 1 }) });
  T.check('🔴 different bytes produce a DIFFERENT key -- a replaced photo cannot reuse the old object',
    c.body.objectKey !== a.body.objectKey, String(c.body.objectKey));

  T.check('the raw google subject is not in the key',
    !a.body.objectKey.includes(OWNER_SUB), a.body.objectKey);
  T.check('the seller email is not in the key',
    !a.body.objectKey.includes(OWNER_EMAIL) && !a.body.objectKey.includes('owner@'), a.body.objectKey);
  T.check('the key is namespaced per owner and per draft',
    new RegExp(`^seller-photos/[0-9a-f]{32}/${DRAFT_ID}/`).test(a.body.objectKey), a.body.objectKey);
});

await T.section('an unauthenticated caller is refused', async () => {
  const none = await ticket({ body: tbody(), headers: {} });
  T.check('no Authorization header is 401', none.statusCode === 401,
    `${none.statusCode} ${JSON.stringify(none.body)}`);
  const short = await ticket({ body: tbody(), headers: { authorization: 'Bearer abc' } });
  T.check('a too-short token is 401', short.statusCode === 401, String(short.statusCode));
  T.check('the refusal names signing in', /sign in/i.test((none.body && none.body.error) || ''),
    JSON.stringify(none.body));

  const nc = await complete({ body: tbody({ objectKey: 'seller-photos/x/y/z.png' }), headers: {} });
  T.check('completion is 401 without a token too', nc.statusCode === 401, String(nc.statusCode));
  const nd = await remove({ body: { draftId: DRAFT_ID, objectKeys: ['k'] }, headers: {} });
  T.check('deletion is 401 without a token too', nd.statusCode === 401, String(nd.statusCode));
});

await T.section('a caller who does not own the draft cannot host its photos', async () => {
  // Will's case 12.
  currentEmail = OTHER_EMAIL;
  const r = await ticket({ body: tbody() });
  T.check('🔴 a non-owner is refused a ticket', r.statusCode !== 200,
    `${r.statusCode} ${JSON.stringify(r.body)}`);
  T.check('the refusal is 404 -- another account\u2019s draft is reported absent, not forbidden',
    r.statusCode === 404, String(r.statusCode));
  T.check('no upload url is returned to a non-owner', !(r.body && r.body.uploadUrl),
    JSON.stringify(r.body));
  T.check('a non-owner is not even told whether hosting is configured',
    !(r.body && (r.body.code === 'PHOTO_HOST_MISCONFIGURED' || r.body.code === HOST.PHOTO_HOST_ERR.NOT_CONFIGURED)),
    JSON.stringify(r.body));

  const c = await complete({ body: tbody({ objectKey: 'seller-photos/aaa/bbb/c.png' }) });
  T.check('🔴 a non-owner cannot record a hosted photo either', c.statusCode === 404,
    `${c.statusCode} ${JSON.stringify(c.body)}`);
  const d = await remove({ body: { draftId: DRAFT_ID, objectKeys: ['seller-photos/a/b/c.png'] } });
  T.check('🔴 a non-owner cannot delete this draft\u2019s photos', d.statusCode === 404,
    String(d.statusCode));

  currentEmail = OWNER_EMAIL;
  const ok = await ticket({ body: tbody() });
  T.check('the owner is still admitted after the non-owner was refused',
    ok.statusCode === 200, String(ok.statusCode));
});

await T.section('an unknown draft is refused the same way as another account\u2019s', async () => {
  currentEmail = OWNER_EMAIL;
  /* Well-formed (`drf_` + 32 hex, per _draftStore.js:132) but never written, so
     this asks about ABSENCE and not about the id format. */
  const missing = await ticket({ body: tbody({ draftId: 'drf_' + 'a'.repeat(32) }) });
  T.check('an id that does not exist is 404', missing.statusCode === 404,
    `${missing.statusCode} ${JSON.stringify(missing.body)}`);
  const noId = await ticket({ body: tbody({ draftId: '' }) });
  T.check('a missing draft id is 400', noId.statusCode === 400, String(noId.statusCode));
  const badId = await ticket({ body: tbody({ draftId: '../../etc/passwd' }) });
  T.check('a malformed draft id is 400', badId.statusCode === 400, String(badId.statusCode));
});

await T.section('the gate refuses what eBay could not use, before any upload happens', async () => {
  currentEmail = OWNER_EMAIL;
  const heic = await ticket({ body: tbody({ contentType: 'image/heic' }) });
  T.check('an unsupported type is 415, not ticketed and renamed .jpg',
    heic.statusCode === 415 && heic.body.code === HOST.PHOTO_HOST_ERR.UNSUPPORTED_TYPE,
    `${heic.statusCode} ${JSON.stringify(heic.body)}`);

  const zero = await ticket({ body: tbody({ byteLength: 0 }) });
  T.check('a zero-byte photo is 400', zero.statusCode === 400,
    `${zero.statusCode} ${JSON.stringify(zero.body)}`);

  const big = await ticket({ body: tbody({ byteLength: HOST.UPLOAD_MAX_BYTES + 1 }) });
  T.check('an oversized photo is 413 -- refused on the DECLARED size, so the seller never uploads it',
    big.statusCode === 413, `${big.statusCode} ${JSON.stringify(big.body)}`);

  const noSha = await ticket({ body: tbody({ sha256: '' }) });
  T.check('a missing sha256 is 400 -- without it there is no stable key', noSha.statusCode === 400,
    String(noSha.statusCode));
  const badSha = await ticket({ body: tbody({ sha256: 'not-a-hash' }) });
  T.check('a malformed sha256 is 400', badSha.statusCode === 400, String(badSha.statusCode));

  const noPhotoId = await ticket({ body: tbody({ photoId: '' }) });
  T.check('a missing photo id is 400', noPhotoId.statusCode === 400, String(noPhotoId.statusCode));
  const nastyPhotoId = await ticket({ body: tbody({ photoId: '../../escape' }) });
  T.check('a photo id with path characters is refused at the door',
    nastyPhotoId.statusCode === 400, String(nastyPhotoId.statusCode));

  const over = await ticket({ body: tbody({ index: HOST.EBAY_PHOTO_MAX }) });
  T.check(`a thirteenth photo is refused (cap ${HOST.EBAY_PHOTO_MAX})`,
    over.statusCode === 400, `${over.statusCode} ${JSON.stringify(over.body)}`);
  const under = await ticket({ body: tbody({ index: HOST.EBAY_PHOTO_MAX - 1 }) });
  T.check('the twelfth is still allowed, so the cap is a cap and not a block',
    under.statusCode === 200, String(under.statusCode));
});

// ── completion: the client's word is not evidence ────────────────────────────

await T.section('completion refuses a photo that was never uploaded', async () => {
  currentEmail = OWNER_EMAIL;
  objects.clear();
  const t = await ticket({ body: tbody() });
  const key = t.body.objectKey;

  /* The browser says it uploaded. The bucket is empty. This is the failure
     that would otherwise reach a listing as a broken photograph. */
  const r = await complete({ body: cbody(t) });
  T.check('🔴 a claimed upload with nothing in the bucket is 409, not 201',
    r.statusCode === 409 && r.body.code === 'PHOTO_NOT_UPLOADED',
    `${r.statusCode} ${JSON.stringify(r.body)}`);
  T.check('no hosted record is returned for an absent object', !(r.body && r.body.hosted),
    JSON.stringify(r.body));
  T.check('a real HEAD was actually performed -- the refusal is measured, not assumed',
    r2Calls.some((c) => c.method === 'HEAD' && c.key === key),
    JSON.stringify(r2Calls.slice(-3)));
});

await T.section('completion records a photo that really is there', async () => {
  currentEmail = OWNER_EMAIL;
  const t = await ticket({ body: tbody() });
  const key = t.body.objectKey;
  objects.set(key, { byteLength: PNG_LEN, contentType: 'image/png' });

  const r = await complete({ body: cbody(t) });
  T.check('a verified upload is 201', r.statusCode === 201,
    `${r.statusCode} ${JSON.stringify(r.body)}`);
  T.check('the hosted record carries the server-built public url',
    r.body.hosted && r.body.hosted.publicUrl.startsWith('https://photos.example.org/'),
    JSON.stringify(r.body.hosted));
  T.check('the public url is https, which eBay requires',
    r.body.hosted.publicUrl.startsWith('https://'), r.body.hosted.publicUrl);
  T.check('the record carries the hash, so a later export can tell the bytes are unchanged',
    r.body.hosted.sha256 === PNG_SHA, String(r.body.hosted.sha256));
  T.check('the record carries an expiry', typeof r.body.hosted.expiresAt === 'string'
    && Number.isFinite(Date.parse(r.body.hosted.expiresAt)), String(r.body.hosted.expiresAt));
  T.check('the expiry is 30 days out', r.body.retentionDays === 30, String(r.body.retentionDays));

  const days = (Date.parse(r.body.hosted.expiresAt) - Date.now()) / 86400000;
  T.check('and the stamped date really is ~30 days ahead, not a label',
    days > 29.9 && days < 30.1, String(days));

  /* hostedAt is when we CONFIRMED it, which is the moment the url became a
     fact. Distinct from expiresAt, and it must be a real instant. */
  T.check('the record stamps when we verified it',
    typeof r.body.hosted.hostedAt === 'string'
    && Math.abs(Date.parse(r.body.hosted.hostedAt) - Date.now()) < 60000,
    String(r.body.hosted.hostedAt));
  /* The provider's identity for the stored bytes, recorded as observed. It is
     NOT our content hash -- the sha256 above is -- and nothing is named after
     it. */
  T.check('the record carries the provider ETag observed on the HEAD',
    r.body.hosted.etag === R2_ETAG, String(r.body.hosted.etag));
  T.check('🔴 the ETag is recorded as opaque and is not mistaken for our hash',
    r.body.hosted.sha256 === PNG_SHA && r.body.hosted.sha256 !== r.body.hosted.etag,
    `${r.body.hosted.sha256} / ${r.body.hosted.etag}`);
});

// ── the receipt: the gate's own decision, not the client's later claim ───────

await T.section('the receipt is what makes the completion trustworthy', async () => {
  currentEmail = OWNER_EMAIL;
  objects.clear();
  const t = await ticket({ body: tbody() });
  const key = t.body.objectKey;
  objects.set(key, { byteLength: PNG_LEN, contentType: 'image/png' });

  const none = await complete({ body: cbody(t, { uploadReceipt: undefined }) });
  T.check('🔴 no receipt is refused -- the completion is not a standalone write',
    none.statusCode === 400 && none.body.code === 'RECEIPT_MISSING',
    `${none.statusCode} ${JSON.stringify(none.body)}`);

  /* A receipt whose payload has been edited. This is the whole point of the
     HMAC: the byte count inside the receipt is the one the gate approved, so
     editing it must invalidate the signature rather than change the decision. */
  const [payload, sig] = t.body.uploadReceipt.split('.');
  const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  decoded[7] = 'f'.repeat(64);   // a different sha256 claim
  const forgedPayload = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const forged = await complete({ body: cbody(t, { uploadReceipt: `${forgedPayload}.${sig}` }) });
  T.check('🔴 an edited receipt with the original signature is refused',
    forged.statusCode === 400 && forged.body.code === 'RECEIPT_BAD_SIGNATURE',
    `${forged.statusCode} ${JSON.stringify(forged.body)}`);

  const garbage = await complete({ body: cbody(t, { uploadReceipt: 'not-a-receipt' }) });
  T.check('a malformed receipt is refused rather than crashing',
    garbage.statusCode === 400 && /RECEIPT_/.test(String(garbage.body.code)),
    `${garbage.statusCode} ${JSON.stringify(garbage.body)}`);

  /* Signed by us, for a real seller, and used to complete a DIFFERENT
     seller's draft. Ownership of the draft is rechecked independently, so this
     is specifically the receipt refusing to be transplanted. */
  const otherSecret = process.env.PHOTO_KEY_SECRET;
  const RCP = await import('../api/_photoReceipt.js');
  /* The caller's own namespace, derived through the product's helper rather
     than restated -- a hand-copied constant here would keep passing if the
     derivation changed. */
  const R2H = await import('../api/_r2Host.js');
  const RCP_OWNER_NS = R2H.ownerNamespace(process.env.PHOTO_KEY_SECRET, OWNER_SUB);
  const foreignReceipt = RCP.signUploadReceipt(otherSecret, {
    owner: 'a'.repeat(32), draftId: DRAFT_ID, photoId: 'ph_abc123', objectKey: key,
    contentType: 'image/png', byteLength: PNG_LEN, sha256: PNG_SHA,
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  });
  const notYours = await complete({ body: cbody(t, { uploadReceipt: foreignReceipt }) });
  T.check('🔴 a validly signed receipt issued to another owner is 403, not 201',
    notYours.statusCode === 403 && notYours.body.code === 'RECEIPT_NOT_YOURS',
    `${notYours.statusCode} ${JSON.stringify(notYours.body)}`);

  /* An expired receipt. The presigned PUT has already lapsed by then, so this
     is defence in depth -- but a receipt with no enforced lifetime would be a
     permanent write-registration handle. */
  const stale = RCP.signUploadReceipt(otherSecret, {
    owner: RCP_OWNER_NS, draftId: DRAFT_ID, photoId: 'ph_abc123', objectKey: key,
    contentType: 'image/png', byteLength: PNG_LEN, sha256: PNG_SHA,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  const expired = await complete({ body: cbody(t, { uploadReceipt: stale }) });
  T.check('🔴 an expired receipt is refused (410), and says to try the photo again',
    expired.statusCode === 410 && expired.body.code === 'RECEIPT_EXPIRED'
    && /try the photo again/i.test(String(expired.body.error)),
    `${expired.statusCode} ${JSON.stringify(expired.body)}`);

  /* The numbers compared on the HEAD are the ISSUED ones. A client that
     tickets a small photo and completes claiming a big one must not get the
     comparison rewritten under it. */
  const lying = await complete({ body: cbody(t, { byteLength: PNG_LEN + 5000 }) });
  T.check('🔴 a byte count that disagrees with the receipt is refused',
    lying.statusCode === 400 && lying.body.code === 'RECEIPT_MISMATCH'
    && lying.body.field === 'byteLength',
    `${lying.statusCode} ${JSON.stringify(lying.body)}`);
  T.check('and the refusal names the field without echoing either value',
    !JSON.stringify(lying.body).includes(String(PNG_LEN + 5000)),
    JSON.stringify(lying.body));

  const good = await complete({ body: cbody(t) });
  T.check('the untouched receipt still completes, so the refusals above are specific',
    good.statusCode === 201, `${good.statusCode} ${JSON.stringify(good.body)}`);
});

// ── reference artwork is refused at the boundary, not only at capture ────────

await T.section('catalogue artwork cannot be signed for upload', async () => {
  currentEmail = OWNER_EMAIL;
  for (const origin of ['artwork', 'catalogue', 'reference', 'pokemontcg', '']) {
    const r = await ticket({ body: tbody({ origin }) });
    const allowed = origin === '';   // absent defaults to a local capture
    T.check(`origin "${origin || '(absent)'}" is ${allowed ? 'allowed' : 'refused'}`,
      allowed ? r.statusCode === 200
              : (r.statusCode === 400 && r.body.code === 'PHOTO_REFERENCE_ARTWORK'),
      `${r.statusCode} ${JSON.stringify(r.body)}`);
  }
  for (const origin of ['scan', 'seller', 'SELLER']) {
    const r = await ticket({ body: tbody({ origin }) });
    T.check(`a local capture (origin "${origin}") is signed`, r.statusCode === 200,
      `${r.statusCode} ${JSON.stringify(r.body)}`);
  }

  /* A request that NAMES a url to fetch is asking for the remote-fetching
     service this design deliberately does not have. Refused whatever the
     origin claims, because the two together are the artwork-laundering
     shape. */
  for (const field of ['sourceUrl', 'remoteUrl', 'artworkUrl', 'imageUrl', 'url', 'fetchUrl']) {
    const r = await ticket({ body: tbody({ origin: 'seller', [field]: 'https://images.pokemontcg.io/base1/4_hires.png' }) });
    T.check(`🔴 a request carrying ${field} is refused, not fetched`,
      r.statusCode === 400 && r.body.code === 'PHOTO_REFERENCE_ARTWORK',
      `${r.statusCode} ${JSON.stringify(r.body)}`);
    T.check(`and no request was made to that host for ${field}`,
      !r2Calls.some((c) => String(c.url || '').includes('pokemontcg.io')),
      JSON.stringify(r2Calls.slice(-2)));
  }
});

await T.section('completion refuses an object that is not what was prepared', async () => {
  currentEmail = OWNER_EMAIL;
  const t = await ticket({ body: tbody() });
  const key = t.body.objectKey;

  objects.set(key, { byteLength: PNG_LEN + 99, contentType: 'image/png' });
  const size = await complete({ body: cbody(t) });
  T.check('🔴 a size mismatch is 409, not recorded',
    size.statusCode === 409 && size.body.code === 'PHOTO_SIZE_MISMATCH',
    `${size.statusCode} ${JSON.stringify(size.body)}`);

  objects.set(key, { byteLength: PNG_LEN, contentType: 'text/html' });
  const type = await complete({ body: cbody(t) });
  T.check('🔴 a type mismatch is 409 -- an html body served from the photo url is refused',
    type.statusCode === 409 && type.body.code === 'PHOTO_TYPE_MISMATCH',
    `${type.statusCode} ${JSON.stringify(type.body)}`);

  /* A client naming someone else's key. The key is recomputed from the
     caller's own namespace, so the echo cannot be honoured. */
  objects.set('seller-photos/deadbeefdeadbeefdeadbeefdeadbeef/other/x.png',
    { byteLength: PNG_LEN, contentType: 'image/png' });
  const foreign = await complete({
    body: cbody(t, { objectKey: 'seller-photos/deadbeefdeadbeefdeadbeefdeadbeef/other/x.png' }),
  });
  T.check('🔴 a client-named key under another prefix is 400, even though that object exists',
    foreign.statusCode === 400 && foreign.body.code === 'PHOTO_KEY_MISMATCH',
    `${foreign.statusCode} ${JSON.stringify(foreign.body)}`);

  objects.set(key, { byteLength: PNG_LEN, contentType: 'image/png' });
  const ok = await complete({ body: cbody(t) });
  T.check('the correct object still completes, so the refusals above are specific',
    ok.statusCode === 201, String(ok.statusCode));
});

// ── deletion and pending cleanup ─────────────────────────────────────────────

await T.section('removal deletes the hosted object immediately', async () => {
  currentEmail = OWNER_EMAIL;
  const t = await ticket({ body: tbody() });
  const key = t.body.objectKey;
  objects.set(key, { byteLength: PNG_LEN, contentType: 'image/png' });

  const r = await remove({ body: { draftId: DRAFT_ID, objectKeys: [key] } });
  T.check('the delete is accepted', r.statusCode === 200, `${r.statusCode} ${JSON.stringify(r.body)}`);
  T.check('the key is reported deleted', (r.body.deleted || []).includes(key), JSON.stringify(r.body));
  T.check('🔴 the object really is gone from the bucket, not just reported gone',
    !objects.has(key), 'the object survived a reported deletion');
  T.check('nothing is left pending when the delete succeeded',
    (r.body.pending || []).length === 0, JSON.stringify(r.body.pending));
});

await T.section('a failed deletion stays visible as pending cleanup', async () => {
  currentEmail = OWNER_EMAIL;
  const t = await ticket({ body: tbody({ photoId: 'ph_fail_1' }) });
  const key = t.body.objectKey;
  objects.set(key, { byteLength: PNG_LEN, contentType: 'image/png' });

  /* R2 refuses the delete. The object stays; the seller asked for it gone. */
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('.r2.cloudflarestorage.com')
        && String(opts.method || '').toUpperCase() === 'DELETE') {
      return { ok: false, status: 503, headers: { get: () => null } };
    }
    return realFetch(url, opts);
  };
  const r = await remove({ body: { draftId: DRAFT_ID, objectKeys: [key] } });
  globalThis.fetch = realFetch;

  T.check('the response is still 200 -- the request was understood and acted on',
    r.statusCode === 200, String(r.statusCode));
  T.check('🔴 the failed key is NOT reported deleted',
    !(r.body.deleted || []).includes(key), JSON.stringify(r.body.deleted));
  T.check('🔴 it is queued as pending cleanup rather than forgotten',
    (r.body.pending || []).some((p) => p.objectKey === key),
    JSON.stringify(r.body.pending));
  T.check('the queue is handed back so the pending row survives the response',
    Array.isArray(r.body.cleanupQueue) && r.body.cleanupQueue.length > 0,
    JSON.stringify(r.body.cleanupQueue));
  T.check('and the object is indeed still in the bucket, which is why it is pending',
    objects.has(key), 'the fixture did not actually simulate a failure');
});

await T.section('deletion refuses keys outside this draft, whole-request', async () => {
  currentEmail = OWNER_EMAIL;
  const t = await ticket({ body: tbody({ photoId: 'ph_mine_1' }) });
  const mine = t.body.objectKey;
  const theirs = 'seller-photos/ffffffffffffffffffffffffffffffff/other-draft/x.png';
  objects.set(mine, { byteLength: PNG_LEN, contentType: 'image/png' });
  objects.set(theirs, { byteLength: PNG_LEN, contentType: 'image/png' });

  const r = await remove({ body: { draftId: DRAFT_ID, objectKeys: [mine, theirs] } });
  T.check('🔴 a mixed request is refused, not partially honoured',
    r.statusCode === 400 && r.body.code === 'PHOTO_KEY_MISMATCH',
    `${r.statusCode} ${JSON.stringify(r.body)}`);
  T.check('🔴 the permitted key was NOT deleted either -- an ambiguous instruction destroys nothing',
    objects.has(mine), 'a refused request still deleted something');
  T.check('and the foreign object is untouched', objects.has(theirs), 'deleted another prefix');

  const empty = await remove({ body: { draftId: DRAFT_ID, objectKeys: [] } });
  T.check('a delete naming nothing is 400 rather than a silent no-op',
    empty.statusCode === 400, String(empty.statusCode));
});

// ── configuration states ─────────────────────────────────────────────────────

await T.section('with no host configured, that is reported rather than faked', async () => {
  currentEmail = OWNER_EMAIL;
  setR2(false);
  const t = await ticket({ body: tbody() });
  T.check('the ticket endpoint answers 501 NOT_CONFIGURED',
    t.statusCode === 501 && t.body.code === HOST.PHOTO_HOST_ERR.NOT_CONFIGURED,
    `${t.statusCode} ${JSON.stringify(t.body)}`);
  T.check('the refusal explains hosting is not set up, rather than blaming the seller',
    /not set up/i.test((t.body && t.body.error) || ''), JSON.stringify(t.body));

  const d = await remove({ body: { draftId: DRAFT_ID, objectKeys: ['anything'] } });
  T.check('deletion with no host is 200 -- the end state "nothing hosted" already holds',
    d.statusCode === 200 && d.body.hosted === false, `${d.statusCode} ${JSON.stringify(d.body)}`);
  setR2(true);
});

await T.section('a half-configured host is visible, and never leaks a value', async () => {
  currentEmail = OWNER_EMAIL;
  const kept = process.env.PHOTO_KEY_SECRET;
  delete process.env.PHOTO_KEY_SECRET;

  const t = await ticket({ body: tbody() });
  T.check('🔴 "chosen but incomplete" is 500 MISCONFIGURED, NOT the 501 for "not chosen"',
    t.statusCode === 500 && t.body.code === 'PHOTO_HOST_MISCONFIGURED',
    `${t.statusCode} ${JSON.stringify(t.body)}`);
  T.check('the missing variable is named so it can be fixed',
    (t.body.missing || []).includes('keySecret') || (t.body.missing || []).includes('PHOTO_KEY_SECRET'),
    JSON.stringify(t.body.missing));

  const dump = JSON.stringify(t.body);
  T.check('🔴 no configured VALUE appears in the response',
    !dump.includes(R2_ENV.R2_SECRET_ACCESS_KEY) && !dump.includes(R2_ENV.R2_ACCESS_KEY_ID)
    && !dump.includes('test-photo-key-secret'),
    dump);

  process.env.PHOTO_KEY_SECRET = kept;
  const ok = await ticket({ body: tbody() });
  T.check('restoring the secret restores the ticket, so the 500 was about that variable',
    ok.statusCode === 200, String(ok.statusCode));
});

await T.section('the method and CORS preconditions', async () => {
  currentEmail = OWNER_EMAIL;
  for (const [name, fn] of [['ticket', ticket], ['complete', complete], ['delete', remove]]) {
    const get = await fn({ method: 'GET', body: tbody() });
    T.check(`GET on ${name} is 405`, get.statusCode === 405, String(get.statusCode));
    const opts = await fn({ method: 'OPTIONS' });
    T.check(`OPTIONS preflight on ${name} is 200`, opts.statusCode === 200, String(opts.statusCode));
    T.check(`${name} answers CORS, but CORS is not what authorizes the request`,
      !!opts.headers['Access-Control-Allow-Origin'],
      'the authorization boundary is the token and the owner-scoped read');
  }

  /* CORS on OUR endpoints is not the browser's upload permission. The PUT goes
     to R2, whose bucket CORS policy is configured at the provider -- a fact
     this suite can state but not prove, because no code here sets it. */
  const opts = await ticket({ method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  T.check('a preflight from any origin still does not carry a ticket',
    !opts.body || !opts.body.uploadUrl, JSON.stringify(opts.body));
});

T.done();
