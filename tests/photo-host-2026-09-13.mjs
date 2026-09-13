/**
 * Seller-photo hosting: the eBay URL contract, the upload gate, and the fake.
 *
 * WHAT THIS SUITE IS FOR. eBay's importer either fetches a URL or silently
 * produces a listing with no pictures. There is no error to react to, so every
 * rule eBay documents about that column has to be enforced on our side, before
 * the seller uploads a file. Each assertion below cites the eBay wording it
 * comes from; where there is no citation, there is no rule being claimed.
 *
 * Sources (quoted in api/_photoHost.js):
 *   https://pages.ebay.com/sh/reports/help/create-listings-bulk/
 *   https://www.ebay.com/help/policies/listing-policies/picture-policy?id=4370
 *
 * Run: node tests/photo-host-2026-09-13.mjs
 */

import { harness } from './_assert.mjs';
import {
  EBAY_PHOTO_MAX,
  EBAY_PHOTO_URL_MAX,
  EBAY_PHOTO_SEPARATOR,
  EBAY_PHOTO_MIN_LONGEST_SIDE,
  UPLOAD_MAX_BYTES,
  PHOTO_HOST_ERR,
  checkExportablePhotoUrl,
  joinPhotoUrls,
  checkUploadable,
  photoObjectKey,
  makeFakePhotoHost,
} from '../api/_photoHost.js';
/* Resolution moved to its own module when R2 arrived, to keep exactly one
   resolver. The assertions below are unchanged in meaning: they still ask
   what the app resolves from an environment, only now of the module that
   actually answers that question. */
import { photoHostFromEnv } from '../api/_photoProvider.js';

const T = harness('photo hosting contract');

await T.section('eBay documented limits are the documented numbers', async () => {
  // "Up to 12 images per listing is supported by Seller Hub Reports."
  T.check('max photos is 12', EBAY_PHOTO_MAX === 12, `got ${EBAY_PHOTO_MAX}`);
  // "Character limit: Max length 2048"
  T.check('url max is 2048', EBAY_PHOTO_URL_MAX === 2048, `got ${EBAY_PHOTO_URL_MAX}`);
  // "use the pipe ( | ) character to separate the values"
  T.check('separator is a pipe', EBAY_PHOTO_SEPARATOR === '|', `got ${EBAY_PHOTO_SEPARATOR}`);
  // "at least one photo that is 500 pixels on the longest side"
  T.check('min longest side is 500', EBAY_PHOTO_MIN_LONGEST_SIDE === 500,
    `got ${EBAY_PHOTO_MIN_LONGEST_SIDE}`);
});

await T.section('a URL eBay could fetch is accepted', async () => {
  const ok = checkExportablePhotoUrl('https://photos.example.com/a/b/p1.jpg');
  T.check('https .jpg accepted', ok.ok === true, JSON.stringify(ok));
  T.check('.png accepted',
    checkExportablePhotoUrl('https://photos.example.com/p.png').ok === true);
  T.check('.jpeg accepted',
    checkExportablePhotoUrl('https://photos.example.com/p.jpeg').ok === true);
  // Pre-signed URLs carry a query string; the EXTENSION rule is about the path.
  T.check('query string does not disqualify a .jpg path',
    checkExportablePhotoUrl('https://s.example.com/p.jpg?sig=abc&exp=1').ok === true);
  T.check('uppercase extension accepted',
    checkExportablePhotoUrl('https://s.example.com/P.JPG').ok === true);
});

await T.section('a URL eBay would silently drop is refused', async () => {
  // "The photo URL needs to start with the hypertext https://"
  const http = checkExportablePhotoUrl('http://photos.example.com/p.jpg');
  T.check('http:// refused', http.ok === false && http.reason === PHOTO_HOST_ERR.BAD_URL,
    JSON.stringify(http));
  T.check('http:// is not silently upgraded to https',
    http.ok === false, 'an upgrade here would invent reachability we never tested');

  // "...end with a file extension like .jpg or .png"
  const noExt = checkExportablePhotoUrl('https://photos.example.com/p');
  T.check('no extension refused', noExt.ok === false, JSON.stringify(noExt));
  T.check('extension in the QUERY does not count as the path ending',
    checkExportablePhotoUrl('https://s.example.com/object?name=p.jpg').ok === false);

  // Over 2048: a pre-signed URL really can exceed this.
  const long = 'https://s.example.com/' + 'a'.repeat(2100) + '.jpg';
  const tooLong = checkExportablePhotoUrl(long);
  T.check('over 2048 characters refused',
    tooLong.ok === false && /2048/.test(tooLong.detail || ''), JSON.stringify(tooLong));

  // A pipe inside a member would split the field into unfetchable fragments.
  const piped = checkExportablePhotoUrl('https://s.example.com/a|b.jpg');
  T.check('a pipe inside the url is refused',
    piped.ok === false && /pipe/.test(piped.detail || ''), JSON.stringify(piped));

  // "If an image URL has blank spaces, you must replace the blank spaces with
  //  %20; otherwise, the image will not appear in the listing."
  const spaced = checkExportablePhotoUrl('https://s.example.com/my photo.jpg');
  T.check('a raw space is refused', spaced.ok === false, JSON.stringify(spaced));
  T.check('an already-encoded space is accepted',
    checkExportablePhotoUrl('https://s.example.com/my%20photo.jpg').ok === true);

  T.check('empty refused', checkExportablePhotoUrl('').ok === false);
  T.check('null refused', checkExportablePhotoUrl(null).ok === false);
  T.check('unparseable refused', checkExportablePhotoUrl('https://').ok === false);
});

await T.section('the field is pipe-joined in the seller order', async () => {
  const r = joinPhotoUrls([
    'https://s.example.com/1.jpg',
    'https://s.example.com/2.jpg',
    'https://s.example.com/3.jpg',
  ]);
  T.check('joined with pipes',
    r.field === 'https://s.example.com/1.jpg|https://s.example.com/2.jpg|https://s.example.com/3.jpg',
    r.field);
  // eBay uses the FIRST url as the gallery image, so order is load-bearing.
  T.check('first url stays first', r.kept[0] === 'https://s.example.com/1.jpg', r.kept[0]);
  T.check('nothing dropped', r.dropped === 0, String(r.dropped));

  const many = Array.from({ length: 15 }, (_, i) => `https://s.example.com/${i}.jpg`);
  const capped = joinPhotoUrls(many);
  T.check('capped at eBay\u2019s 12', capped.kept.length === 12, String(capped.kept.length));
  T.check('the overflow is REPORTED, not silently swallowed',
    capped.dropped === 3, String(capped.dropped));
  T.check('the kept twelve are the first twelve, in order',
    capped.kept[0] === 'https://s.example.com/0.jpg'
    && capped.kept[11] === 'https://s.example.com/11.jpg');
  T.check('the field has exactly 11 separators for 12 urls',
    capped.field.split(EBAY_PHOTO_SEPARATOR).length === 12,
    String(capped.field.split(EBAY_PHOTO_SEPARATOR).length));

  T.check('no photos yields an empty field', joinPhotoUrls([]).field === '');
  T.check('a non-array yields an empty field', joinPhotoUrls(null).field === '');
});

await T.section('only image bytes we can name an extension for are uploadable', async () => {
  const jpg = checkUploadable({ contentType: 'image/jpeg', byteLength: 1024 });
  T.check('jpeg accepted, ext .jpg', jpg.ok === true && jpg.ext === '.jpg', JSON.stringify(jpg));
  const png = checkUploadable({ contentType: 'image/png', byteLength: 1024 });
  T.check('png accepted, ext .png', png.ok === true && png.ext === '.png', JSON.stringify(png));
  T.check('content type is matched case-insensitively',
    checkUploadable({ contentType: 'IMAGE/JPEG', byteLength: 10 }).ok === true);

  // A HEIC from an iPhone is refused rather than uploaded and named .jpg: the
  // mislabelled object is exactly the silent substitution the rules forbid.
  const heic = checkUploadable({ contentType: 'image/heic', byteLength: 1024 });
  T.check('heic refused rather than renamed to .jpg',
    heic.ok === false && heic.reason === PHOTO_HOST_ERR.UNSUPPORTED_TYPE, JSON.stringify(heic));
  T.check('pdf refused',
    checkUploadable({ contentType: 'application/pdf', byteLength: 10 }).ok === false);
  T.check('missing type refused', checkUploadable({ byteLength: 10 }).ok === false);

  const empty = checkUploadable({ contentType: 'image/jpeg', byteLength: 0 });
  T.check('zero bytes refused',
    empty.ok === false && empty.reason === PHOTO_HOST_ERR.EMPTY, JSON.stringify(empty));
  const big = checkUploadable({ contentType: 'image/jpeg', byteLength: UPLOAD_MAX_BYTES + 1 });
  T.check('over the size ceiling refused',
    big.ok === false && big.reason === PHOTO_HOST_ERR.TOO_LARGE, JSON.stringify(big));
  T.check('exactly at the ceiling accepted',
    checkUploadable({ contentType: 'image/jpeg', byteLength: UPLOAD_MAX_BYTES }).ok === true);
});

await T.section('object keys are scoped to one owner and one draft', async () => {
  const k = photoObjectKey({ ownerSub: 'sub_A', draftId: 'drf_1', photoId: 'ph_9', ext: '.jpg' });
  T.check('owner appears in the key', k.includes('sub_A'), k);
  T.check('draft appears in the key', k.includes('drf_1'), k);
  T.check('photo id appears in the key', k.includes('ph_9'), k);
  T.check('key ends in the extension', k.endsWith('.jpg'), k);

  // Two owners cannot collide, which is what stops one seller's key from
  // addressing another's object.
  const other = photoObjectKey({ ownerSub: 'sub_B', draftId: 'drf_1', photoId: 'ph_9', ext: '.jpg' });
  T.check('a different owner yields a different key', k !== other, `${k} vs ${other}`);

  // The per-draft prefix is what makes deletion a prefix operation.
  T.check('the draft prefix is a strict prefix of the key',
    k.startsWith('seller-photos/sub_A/drf_1/'), k);

  // Traversal cannot escape the prefix.
  const nasty = photoObjectKey({
    ownerSub: '../../etc', draftId: 'drf_1', photoId: 'ph_9', ext: '.jpg',
  });
  /* The sanitizer reduces `../../etc` to `etc`, so the owner segment is still
     present -- as a harmless literal. The property that matters is not that
     the string disappears but that it cannot ESCAPE the prefix: no `..` and
     no extra path segments, so the key keeps the fixed four-segment shape and
     still lands under seller-photos/. */
  T.check('traversal characters are stripped, so the key cannot escape its prefix',
    !nasty.includes('..') && nasty.split('/').length === 4
    && nasty.startsWith('seller-photos/'), nasty);

  let threw = false;
  try { photoObjectKey({ ownerSub: '', draftId: 'd', photoId: 'p', ext: '.jpg' }); }
  catch { threw = true; }
  T.check('a missing owner throws rather than producing an unscoped key', threw);

  // A key must itself be URL-safe, or the URL built from it fails the contract.
  T.check('key contains no character needing encoding', /^[A-Za-z0-9/_.-]+$/.test(k), k);
});

await T.section('the fake host really records, and cannot be laxer than production', async () => {
  const host = makeFakePhotoHost();
  const key = photoObjectKey({ ownerSub: 's', draftId: 'd', photoId: 'p1', ext: '.jpg' });
  const put = await host.put({ key, bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' });
  T.check('the fake returns an exportable url', checkExportablePhotoUrl(put.url).ok === true, put.url);
  T.check('the fake recorded the byte length', host.puts[0].byteLength === 3,
    String(host.puts[0].byteLength));
  T.check('the fake recorded the key', host.puts[0].key === key, host.puts[0].key);
  T.check('the fake recorded the content type', host.puts[0].contentType === 'image/jpeg');

  // A fake whose URLs would not survive the real contract is worse than none:
  // the suite would pass while production emitted unfetchable links.
  const bad = makeFakePhotoHost({ baseUrl: 'http://insecure.test' });
  let refused = false;
  try { await bad.put({ key, bytes: new Uint8Array([1]), contentType: 'image/jpeg' }); }
  catch (e) { refused = e.code === PHOTO_HOST_ERR.BAD_URL; }
  T.check('a fake configured with http:// refuses instead of emitting a bad url', refused);

  // Deletion by prefix is the operation draft-deletion will need.
  const h2 = makeFakePhotoHost();
  for (const id of ['p1', 'p2']) {
    await h2.put({
      key: photoObjectKey({ ownerSub: 's', draftId: 'dA', photoId: id, ext: '.jpg' }),
      bytes: new Uint8Array([1]), contentType: 'image/jpeg',
    });
  }
  await h2.put({
    key: photoObjectKey({ ownerSub: 's', draftId: 'dB', photoId: 'p3', ext: '.jpg' }),
    bytes: new Uint8Array([1]), contentType: 'image/jpeg',
  });
  const del = await h2.deletePrefix('seller-photos/s/dA/');
  T.check('deleting one draft\u2019s prefix removed both of its objects', del.deleted === 2,
    String(del.deleted));
  T.check('the other draft\u2019s object survived', h2.puts.length === 1 &&
    h2.puts[0].key.includes('/dB/'), JSON.stringify(h2.puts));

  const failing = makeFakePhotoHost({ failOn: () => true });
  let code = '';
  try { await failing.put({ key, bytes: new Uint8Array([1]), contentType: 'image/jpeg' }); }
  catch (e) { code = e.code; }
  T.check('an injectable failure surfaces UPLOAD_FAILED',
    code === PHOTO_HOST_ERR.UPLOAD_FAILED, code);
});

await T.section('no host is configured, and that is reported rather than faked', async () => {
  // The live default. If this ever starts returning a host without the
  // hosting decision being taken, that is the thing this assertion catches.
  T.check('an empty environment yields NO host',
    photoHostFromEnv({}) === null, 'a stub host here would emit unreachable urls');
  T.check('the real process environment yields no host today',
    photoHostFromEnv(process.env) === null);
  T.check('an unknown provider name degrades to null rather than throwing',
    photoHostFromEnv({ PHOTO_HOST_PROVIDER: 'not-a-real-provider' }) === null);
  // The fake is reachable only when a base URL is supplied too, so a stray
  // value cannot route real seller photographs to a fake.
  T.check('provider=fake without a base url is still null',
    photoHostFromEnv({ PHOTO_HOST_PROVIDER: 'fake' }) === null);
  const h = photoHostFromEnv({
    PHOTO_HOST_PROVIDER: 'fake', PHOTO_HOST_BASE_URL: 'https://ok.test',
  });
  T.check('provider=fake with a base url resolves the fake', h && h.name === 'fake');
});

// ── the resolver refuses a present-but-wrong setting ─────────────────────────

await T.section('a malformed setting fails closed, and says which one without echoing it', async () => {
  const { r2HostFromEnv } = await import('../api/_r2Host.js');

  /* A configuration that IS valid, so every refusal below is attributable to
     the one field it changes. These are shapes, not credentials: the account
     id is 32 hex because Cloudflare account ids are, and the keys are the
     right lengths. */
  const GOOD = {
    R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    R2_ACCESS_KEY_ID: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
    R2_SECRET_ACCESS_KEY: 'f'.repeat(64),
    R2_BUCKET: 'cardresell-ebay-photos',
    PHOTO_HOST_PUBLIC_BASE_URL: 'https://photos.example.org',
    PHOTO_KEY_SECRET: 'a-photo-key-secret-not-a-real-one',
  };
  const good = r2HostFromEnv(GOOD, async () => ({ ok: true, status: 200, headers: { get: () => null } }));
  T.check('the valid configuration resolves', good.ok === true && good.host.name === 'r2',
    JSON.stringify(good.missing || good.invalid || 'ok'));

  /* Each row is a value that cannot possibly be right. A present-but-wrong
     setting is worse than an absent one: it produces signed URLs nothing
     accepts, or public URLs eBay cannot fetch, and the seller watches
     photographs silently not arrive. */
  const bad = [
    ['R2_ACCOUNT_ID', 'acct-test', 'a placeholder rather than the 32-hex account id'],
    ['R2_ACCOUNT_ID', '0123456789abcdef', 'the right alphabet but the wrong length'],
    ['R2_BUCKET', 'Cardresell_Photos', 'capitals and an underscore, which R2 will not accept'],
    ['R2_BUCKET', 'a', 'too short to be a bucket name'],
    ['PHOTO_HOST_PUBLIC_BASE_URL', 'http://photos.example.org', 'plain http, which eBay will not fetch'],
    ['PHOTO_HOST_PUBLIC_BASE_URL', 'photos.example.org', 'no scheme at all'],
    ['PHOTO_KEY_SECRET', 'changeme', 'a placeholder secret'],
    ['R2_ACCESS_KEY_ID', 'ak-test', 'a placeholder access key id'],
    ['R2_SECRET_ACCESS_KEY', 'sk-test', 'a placeholder secret access key'],
  ];
  for (const [field, value, why] of bad) {
    const r = r2HostFromEnv({ ...GOOD, [field]: value });
    T.check(`🔴 ${field} = ${why} is refused`,
      r.ok === false && Array.isArray(r.invalid) && r.invalid.includes(field),
      JSON.stringify({ ok: r.ok, missing: r.missing, invalid: r.invalid }));
    /* The refusal names the setting. It must never carry the value, because
       three of these fields are credentials and this array is rendered into a
       500 response body. Checked against the reported NAMES rather than the
       whole object: `JSON.stringify(r)` contains the word "false", so a
       one-character test value like "a" made this pass-or-fail by accident
       rather than by substance. */
    if (value.length > 3) {
      T.check(`and the refusal does not echo the ${field} value`,
        !JSON.stringify({ missing: r.missing, invalid: r.invalid }).includes(value),
        JSON.stringify({ missing: r.missing, invalid: r.invalid }));
    }
    T.check(`no host is handed back for a bad ${field}`, !r.host, String(!!r.host));
  }

  /* Absent is still reported, through the same channel, so a caller that
     already renders `missing` keeps working. */
  const gone = r2HostFromEnv({ ...GOOD, R2_BUCKET: '' });
  T.check('an absent setting is reported as missing, not as invalid',
    gone.ok === false && gone.missing.includes('bucket') && !gone.invalid,
    JSON.stringify(gone));

  /* And the secret floor is 16, deliberately not 32 -- a working deployment's
     provisioned secret must not be rejected by a rule this code cannot even
     print the value to justify. */
  const sixteen = r2HostFromEnv({ ...GOOD, PHOTO_KEY_SECRET: 'x'.repeat(16) });
  T.check('a sixteen-character secret is accepted', sixteen.ok === true, JSON.stringify(sixteen));
  const fifteen = r2HostFromEnv({ ...GOOD, PHOTO_KEY_SECRET: 'x'.repeat(15) });
  T.check('fifteen is not', fifteen.ok === false && fifteen.invalid.includes('PHOTO_KEY_SECRET'),
    JSON.stringify(fifteen));
});

await T.section('the HEAD reports the provider ETag as an opaque identity', async () => {
  const { makeR2Host } = await import('../api/_r2Host.js');
  const calls = [];
  const host = makeR2Host({
    accountId: '0123456789abcdef0123456789abcdef',
    accessKeyId: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
    secretAccessKey: 'f'.repeat(64),
    bucket: 'cardresell-ebay-photos',
    publicBaseUrl: 'https://photos.example.org',
    keySecret: 'a-photo-key-secret-not-a-real-one',
    fetchImpl: async (url, opts = {}) => {
      calls.push({ url: String(url), method: opts.method });
      return {
        ok: true, status: 200,
        headers: {
          get: (h) => ({ 'content-length': '70', 'content-type': 'image/png',
                         etag: '"9f8e7d6c5b4a39281706a5b4c3d2e1f0"' })[String(h).toLowerCase()] ?? null,
        },
      };
    },
  });

  const head = await host.head('seller-photos/ns/drf/x.png');
  T.check('the object is reported present', head.exists === true, JSON.stringify(head));
  T.check('the size and type come back', head.byteLength === 70 && head.contentType === 'image/png',
    JSON.stringify(head));
  T.check('🔴 the ETag is returned with the provider quotes stripped',
    head.etag === '9f8e7d6c5b4a39281706a5b4c3d2e1f0', String(head.etag));
  T.check('the request really was a HEAD, so presence is measured', calls[0].method === 'HEAD',
    JSON.stringify(calls[0].method));
  T.check('and it was signed', /X-Amz-Signature=/.test(calls[0].url), calls[0].url.slice(0, 60));

  /* A weak ETag, which R2 returns for multipart objects. It must still be
     recorded rather than dropped or mistaken for a hash. */
  const weak = makeR2Host({
    accountId: '0123456789abcdef0123456789abcdef',
    accessKeyId: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
    secretAccessKey: 'f'.repeat(64),
    bucket: 'b', publicBaseUrl: 'https://photos.example.org',
    keySecret: 'a-photo-key-secret-not-a-real-one',
    fetchImpl: async () => ({
      ok: true, status: 200,
      headers: { get: (h) => ({ 'content-length': '70', 'content-type': 'image/png',
                                etag: 'W/"abc-1"' })[String(h).toLowerCase()] ?? null },
    }),
  });
  const w = await weak.head('seller-photos/ns/drf/x.png');
  T.check('a weak ETag is kept rather than dropped', typeof w.etag === 'string' && w.etag.length > 0,
    String(w.etag));

  /* An absent ETag is not a failure. The object exists; only the provider's
     label for it is missing. */
  const none = makeR2Host({
    accountId: '0123456789abcdef0123456789abcdef',
    accessKeyId: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
    secretAccessKey: 'f'.repeat(64),
    bucket: 'b', publicBaseUrl: 'https://photos.example.org',
    keySecret: 'a-photo-key-secret-not-a-real-one',
    fetchImpl: async () => ({
      ok: true, status: 200,
      headers: { get: (h) => ({ 'content-length': '70', 'content-type': 'image/png' })[String(h).toLowerCase()] ?? null },
    }),
  });
  const n = await none.head('seller-photos/ns/drf/x.png');
  T.check('a missing ETag still reports the object as present',
    n.exists === true && !n.etag, JSON.stringify(n));
});

await T.section('the presigned PUT pins the content type and the five-minute window', async () => {
  const { makeR2Host, R2_PRESIGN_TTL_SECONDS } = await import('../api/_r2Host.js');
  const host = makeR2Host({
    accountId: '0123456789abcdef0123456789abcdef',
    accessKeyId: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
    secretAccessKey: 'f'.repeat(64),
    bucket: 'cardresell-ebay-photos',
    publicBaseUrl: 'https://photos.example.org',
    keySecret: 'a-photo-key-secret-not-a-real-one',
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null } }),
  });

  const t = host.presignPut('seller-photos/ns/drf/x.png', { contentType: 'image/png' });
  const q = new URL(t.url).searchParams;
  T.check('the window is five minutes', R2_PRESIGN_TTL_SECONDS === 300,
    String(R2_PRESIGN_TTL_SECONDS));
  T.check('and the signature says so', q.get('X-Amz-Expires') === '300', String(q.get('X-Amz-Expires')));
  T.check('🔴 content-type is inside the signature',
    q.get('X-Amz-SignedHeaders') === 'content-type;host', String(q.get('X-Amz-SignedHeaders')));
  T.check('the exact headers to send are returned rather than left to convention',
    t.requiredHeaders && t.requiredHeaders['Content-Type'] === 'image/png',
    JSON.stringify(t.requiredHeaders));
  /* The payload is unsigned -- the server never holds the bytes, so it cannot
     hash them. In query-string SigV4 that literal lives in the canonical
     request, NOT in the url, so it is not observable here; an earlier version
     of this assertion looked for it in the query string and failed for that
     reason rather than because signing was wrong. What IS observable is that
     no body hash is demanded of the browser. That the signature really was
     computed over UNSIGNED-PAYLOAD was established separately by reproducing
     this exact signature with an independent SigV4 implementation. */
  T.check('no body hash is demanded of the browser',
    !q.get('X-Amz-Content-Sha256'),
    'a signed payload would require the server to have read the file');
  T.check('the credential scope is the R2 region and the s3 service',
    /\/auto\/s3\/aws4_request/.test(decodeURIComponent(q.get('X-Amz-Credential') || '')),
    String(q.get('X-Amz-Credential')));
  T.check('🔴 the secret access key never appears in the url',
    !t.url.includes('f'.repeat(40)), 'a leaked key in a presigned url is a public write handle');

  /* A different content type must produce a different signature: if it did
     not, pinning the type would be decoration. */
  const jpg = host.presignPut('seller-photos/ns/drf/x.png', { contentType: 'image/jpeg' });
  T.check('🔴 signing a different content type produces a different signature',
    new URL(jpg.url).searchParams.get('X-Amz-Signature')
      !== q.get('X-Amz-Signature'),
    'the type would not be pinned if it did not change the signature');
});


T.done();
