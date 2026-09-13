/**
 * The photo column, and the sentence next to it.
 *
 * WHAT FAILED IN THE FIELD. On 2026-09-12 a production CSV imported into eBay
 * Drafts and carried title, description, price, quantity and SKU. The
 * photographs did not arrive, because `Item photo URL` was the empty string in
 * every row the app has ever produced. Alongside that blank column the app
 * printed a hardcoded sentence saying the column was "present but left blank" --
 * true then, and a lie the moment hosting exists.
 *
 * WHAT THIS SUITE PROVES, in a real browser against the real bundle:
 *   1. Hosted URLs land in column index 7, pipe-separated, in the seller's own
 *      order -- eBay's gallery image is the first URL, so order is behaviour.
 *   2. eBay's documented limits are enforced on the field, and anything
 *      dropped is REPORTED rather than vanishing.
 *   3. With no photos hosted, the column is blank AND the disclosure says so
 *      in its own words for each distinct reason.
 *   4. When photos ARE in the column, the export stops telling the seller to
 *      go and attach them by hand.
 *   5. `ensureExportablePhotos` never reports success with an empty list, and
 *      surfaces the server's 501 as NOT_CONFIGURED rather than as an empty
 *      result that reads like "no photos".
 *   6. An unchanged photo is REUSED on a second export rather than re-uploaded,
 *      and a replaced or removed photo changes the next export.
 *   7. A photo whose hosting is close to expiry is renewed.
 *   8. A browser the storage provider will not accept a PUT from is reported as
 *      PUT_BLOCKED, distinctly from an upload that was rejected.
 *   9. Catalogue artwork never reaches the photo column.
 *  10. A per-photo upload failure leaves the draft intact and exposes a
 *      photo-only retry.
 *
 * WHY THE STUB IS A TRIO NOW. The client no longer posts image bytes to our
 * API: it asks for a ticket, PUTs the blob straight to storage, and asks the
 * server to verify. The stub below stands in for those three deployed
 * functions; their own refusals are proven against the real handlers in
 * tests/photo-upload-endpoint-2026-09-13.mjs.
 *
 * NOT ESTABLISHED HERE: that eBay accepts the file (that needs a real Seller
 * Hub upload), and that a real R2 bucket exists (none is configured).
 *
 * Run: NODE_PATH=/home/user/node_modules node tests/photo-export-wiring-2026-09-13.mjs
 */

import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';
/* The stub signs and verifies receipts with the PRODUCT'S helper. Restating
   the HMAC here would let the client drop the receipt and still pass. */
import { signUploadReceipt, verifyUploadReceipt } from '../api/_photoReceipt.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = '/home/user/node_modules/playwright/index.js';
const T = harness('photo export wiring');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

/* ── the stubbed hosting trio ────────────────────────────────────────────────
   `mode` chooses the behaviour per test. Every call is recorded, because
   several assertions below are about what the client did NOT send -- a reused
   photo must produce no ticket at all, and the PUT must not carry our token. */
let mode = 'ok';
const ticketCalls = [];
const putCalls = [];
const completeCalls = [];
const resetCalls = () => { ticketCalls.length = 0; putCalls.length = 0; completeCalls.length = 0; };

/* The fake bucket's public host. Distinct from the app origin, as R2's would be. */
const PUB = 'https://cdn.test';
/* A test secret. Not a credential: it only has to be a secret the stub and the
   verifier agree on. */
const RECEIPT_SECRET = 'wiring-suite-receipt-secret-not-real';
/* A fixed owner namespace: the real one is an HMAC the server computes, and the
   only property this suite depends on is that it is opaque and stable. */
const NS = 'a'.repeat(32);
const keyFor = (draftId, photoId, sha, ext) =>
  `seller-photos/${NS}/${draftId}/${photoId}-${sha.slice(0, 16)}${ext}`;

/* Where the presigned PUT points. `blockedOrigin` is a SECOND server on
   another port that sends no CORS headers, so the browser really refuses the
   cross-origin PUT -- the PUT_BLOCKED path is exercised by an actual blocked
   request rather than by a stubbed error code. */
let blockedOrigin = '';

const readBody = (req) => new Promise((r) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => { try { r(JSON.parse(raw || '{}')); } catch { r({}); } });
});

/* The RAW request text, kept so the byte assertions can measure the real
   request rather than a re-serialised copy of a parsed object. */
const readRaw = (req) => new Promise((r) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => r(raw));
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  // ── 1. the ticket ─────────────────────────────────────────────────────────
  if (u.pathname === '/api/photo-upload-ticket') {
    const rawBody = await readRaw(req);
    const body = JSON.parse(rawBody || '{}');
    ticketCalls.push({
      draftId: body.draftId, photoId: body.photoId, contentType: body.contentType,
      byteLength: body.byteLength, sha256: body.sha256,
      origin: body.origin,
      auth: req.headers['authorization'] || '',
      /* MUTATION FINDING, 2026-09-13. This was a NAMED-FIELD blacklist --
         `body.dataBase64 || body.data || body.blob`. Mutation 6 added the
         bytes under `imageBase64` instead, and the suite passed: 123/0 with a
         base64 image on the wire to our own API. A blacklist of field names
         cannot prove the absence of bytes, so the check is now structural and
         is made of three independent parts:
           1. the exact KEY SET the request is allowed to have,
           2. any value that looks like a data: url or a long base64 run,
           3. the request body's own size.
         Any future field carrying bytes fails (1) whatever it is called. */
      keys: Object.keys(body).sort(),
      /* The base64 run has to be longer than a sha256 hex digest, which is a
         legitimate 64-character field here and which an earlier version of
         this regex flagged as image bytes. 256 is comfortably above every
         legitimate field and far below the ~3.4 MB a real photograph becomes. */
      hadBytes: Object.values(body).some((v) => typeof v === 'string'
        && (/^data:/i.test(v) || (v.length > 256 && /^[A-Za-z0-9+/=]+$/.test(v)))),
      bodyBytes: rawBody.length,
      /* Any field naming a url to fetch. The production endpoint refuses the
         whole request when one is present, so the suite records whether the
         client ever sends one. */
      hadSourceUrl: ['sourceUrl', 'remoteUrl', 'artworkUrl', 'imageUrl', 'url', 'fetchUrl']
        .some((k) => typeof body[k] === 'string' && body[k]),
    });
    if (mode === 'not_configured') {
      return send(501, { error: 'Photo hosting is not set up yet', code: 'PHOTO_HOST_NOT_CONFIGURED' });
    }
    if (mode === 'misconfigured') {
      return send(500, { error: 'Photo hosting is configured incorrectly',
                         code: 'PHOTO_HOST_MISCONFIGURED', missing: ['keySecret'] });
    }
    if (mode === '401') return send(401, { error: 'Sign in required' });

    const ext = body.contentType === 'image/png' ? '.png' : '.jpg';
    const objectKey = keyFor(body.draftId, body.photoId, String(body.sha256 || ''), ext);
    const origin = (mode === 'put_blocked' && blockedOrigin) ? blockedOrigin : APP_ORIGIN;
    /* The stub issues a receipt with the SAME signature the product uses, so
       the client's job -- return it untouched -- is really exercised. */
    const receipt = signUploadReceipt(RECEIPT_SECRET, {
      owner: 'stub-owner-namespace-0000000000', draftId: body.draftId,
      photoId: body.photoId, objectKey, contentType: body.contentType,
      byteLength: body.byteLength, sha256: body.sha256,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    });
    return send(200, {
      putUrl: `${origin}/r2put/${encodeURIComponent(objectKey)}?X-Amz-Signature=stub&X-Amz-Expires=300`,
      publicUrl: `${PUB}/${objectKey}`,
      objectKey,
      /* Exactly what the signature covers. The stub's PUT route asserts the
         client sent these and nothing else of substance. */
      requiredHeaders: { 'Content-Type': body.contentType },
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      uploadReceipt: receipt,
      sha256: body.sha256,
      photoId: body.photoId,
      draftId: body.draftId,
      contentType: body.contentType,
      byteLength: body.byteLength,
      ttlSeconds: 300,
    });
  }

  // ── 2. the direct PUT (standing in for R2) ────────────────────────────────
  if (u.pathname.startsWith('/r2put/')) {
    let bytes = 0;
    await new Promise((r) => { req.on('data', (c) => { bytes += c.length; }); req.on('end', r); });
    putCalls.push({
      key: decodeURIComponent(u.pathname.slice('/r2put/'.length)),
      contentType: req.headers['content-type'] || '',
      auth: req.headers['authorization'] || '',
      bytes,
      method: req.method,
    });
    if (mode === 'put_rejected') { res.writeHead(403); return res.end('denied'); }
    res.writeHead(200); return res.end('');
  }

  // ── 3. the completion, which in production follows a real HEAD ────────────
  if (u.pathname === '/api/photo-upload-complete') {
    const body = await readBody(req);
    completeCalls.push({ objectKey: body.objectKey, photoId: body.photoId,
                         sha256: body.sha256, auth: req.headers['authorization'] || '',
                         receipt: body.uploadReceipt || '' });
    /* THE RECEIPT IS VERIFIED HERE, with the real verifier. A client that
       dropped or mangled it gets the production refusal rather than a pass,
       so "the client returns the receipt untouched" is tested end to end
       instead of asserted by inspecting a request log. */
    const rv = verifyUploadReceipt(RECEIPT_SECRET, body.uploadReceipt);
    if (!rv.ok) return send(400, { error: 'This upload could not be confirmed', code: rv.reason });
    if (mode === 'complete_unverified') {
      return send(409, { error: 'The photo was not found in storage', code: 'PHOTO_NOT_UPLOADED' });
    }
    if (mode === 'fail_second' && completeCalls.length === 2) {
      return send(409, { error: 'The photo was not found in storage', code: 'PHOTO_NOT_UPLOADED' });
    }
    const scheme = mode === 'bad_url' ? 'http://cdn.test' : PUB;
    return send(201, {
      draftId: body.draftId,
      retentionDays: 30,
      hosted: {
        photoId: body.photoId,
        objectKey: body.objectKey,
        publicUrl: `${scheme}/${body.objectKey}`,
        sha256: body.sha256,
        contentType: body.contentType,
        byteLength: body.byteLength,
        uploadedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
    });
  }

  /* The draft read. Needed only by the sections that drive the real
     _draftDownloadGo, which builds the file from the SERVER's copy rather than
     from the list row. Returns the same two fixtures the CSV assertions use, so
     the file produced through the button is the file the rest of the suite
     inspects. */
  if (u.pathname === '/api/drafts') {
    return send(200, {
      draft: { draftId: DRAFT_ID, sku: 'PKMBASE30', title: 'Ivysaur 30/102 Base Set',
               price: 12.34, quantity: 1 },
      packet: { category: { id: '183454' }, title: { text: 'Ivysaur 30/102 Base Set' },
                description: { text: 'Ivysaur, Base Set, number 30.' } },
    });
  }

  if (u.pathname === '/api/photo-delete') {
    const body = await readBody(req);
    return send(200, { deleted: body.objectKeys || [], pending: [], hosted: true });
  }

  let rel = u.pathname === '/' ? '/index.html' : u.pathname;
  const f = path.join(ROOT, rel.replace(/^\/+/, ''));
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const B = `http://127.0.0.1:${server.address().port}`;
const APP_ORIGIN = B;

/* The no-CORS origin. `localhost` and `127.0.0.1` are different origins to the
   browser, so this really is cross-origin, and it answers the preflight with
   nothing -- exactly the shape of a bucket whose CORS policy omits our site. */
const blocker = http.createServer((req, res) => { res.writeHead(200); res.end(''); });
await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
blockedOrigin = `http://localhost:${blocker.address().port}`;

const { chromium } = (await import(PW)).default;
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${B}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.photosAdd === 'function'
     && typeof window._ebayDraftCsv === 'function'
     && typeof window.ensureExportablePhotos === 'function'
     && typeof window._exportPhotoField === 'function'
     && typeof window.photosSetHosted === 'function'
     && typeof window._hostedPlan === 'function',
  null, { timeout: 20000 },
);

/* A signed-in seller, faked at the same seam the app reads. The endpoint's
   real token check is covered by the endpoint suite; here the point is that
   the client SENDS the header it claims to. */
await page.evaluate(() => {
  window._fbCurrentUser = { getIdToken: async () => 'test-id-token-' + 'x'.repeat(30) };
});

const DRAFT_ID = 'drf_2791e2eb72fc4323bf81c0119652577e';

/** Put N real 1x1 PNGs into the store for a draft, in order. */
async function seedPhotos(draftId, n) {
  return page.evaluate(async ({ draftId, n }) => {
    const PNG = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
    const bytes = new Uint8Array(PNG.length);
    for (let i = 0; i < PNG.length; i++) bytes[i] = PNG.charCodeAt(i);
    const files = [];
    for (let i = 0; i < n; i++) {
      /* Each photo gets DISTINCT bytes -- a trailing marker -- so the content
         hash differs per photo. Identical bytes would hash identically and the
         reuse assertions below could not tell one photo from another. */
      const tail = new Uint8Array([i + 1]);
      files.push(new File([bytes, tail], 'p' + (i + 1) + '.png', { type: 'image/png' }));
    }
    await window.photosAdd(draftId, files);
    const l = await window.photosList(draftId);
    return l.order;
  }, { draftId, n });
}

/** Wipe a draft's photos so a section starts from a known store. */
async function clearPhotos(draftId) {
  return page.evaluate(async (id) => {
    const l = await window.photosList(id);
    for (const pid of (l.order || []).slice()) await window.photosRemove(id, pid);
    const after = await window.photosList(id);
    return after.order.length;
  }, draftId);
}

const draftFixture = {
  draftId: DRAFT_ID, sku: 'PKMBASE30', title: 'Ivysaur 30/102 Base Set',
  price: 12.34, quantity: 1,
};
const packetFixture = { category: { id: '183454' }, title: { text: 'Ivysaur 30/102 Base Set' },
                        description: { text: 'Ivysaur, Base Set, number 30.' } };

/** Column 7 of the single Draft row, as the file really contains it. */
function photoCell(csv) {
  const line = csv.split(/\r\n/).find((l) => l.startsWith('Draft,'));
  if (!line) throw new Error('no Draft row');
  const cells = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) { cells.push(cur); cur = ''; }
    else cur += c;
  }
  cells.push(cur);
  return { cell: cells[7], cells };
}

async function buildCsv(report) {
  return page.evaluate(({ d, p, rep }) => {
    const r = window._ebayDraftCsv(d, p, rep);
    return { csv: r.csv, owed: r.owed, notes: r.notes };
  }, { d: draftFixture, p: packetFixture, rep: report });
}

const runExport = (id = DRAFT_ID) =>
  page.evaluate((d) => window.ensureExportablePhotos(d), id);

// ── 1. hosted urls really reach column 7, in order ────────────────────────
await T.section('hosted photos land in the photo column, in the seller\u2019s order', async () => {
  mode = 'ok'; resetCalls();
  const order = await seedPhotos(DRAFT_ID, 3);
  T.check('three photos were seeded', order.length === 3, JSON.stringify(order));

  const report = await runExport();
  T.check('the report is ok', report.ok === true, JSON.stringify(report));
  T.check('three photos were uploaded', report.uploaded === 3, JSON.stringify(report));
  T.check('the client asked for three tickets', ticketCalls.length === 3, String(ticketCalls.length));
  T.check('the client sent an Authorization header on the ticket request',
    ticketCalls.every((c) => /^Bearer /.test(c.auth)),
    JSON.stringify(ticketCalls.map((c) => c.auth.slice(0, 12))));
  T.check('\ud83d\udd34 no image bytes were sent to our API',
    ticketCalls.every((c) => !c.hadBytes),
    'base64 in the request body is the failure mode this rewrite exists to remove');
  T.check('\ud83d\udd34 the bytes went to the storage provider instead, three PUTs of real length',
    putCalls.length === 3 && putCalls.every((c) => c.method === 'PUT' && c.bytes > 20),
    JSON.stringify(putCalls.map((c) => [c.method, c.bytes])));
  T.check('\ud83d\udd34 the PUT carries NO CardResell token -- it would leak to the storage provider',
    putCalls.every((c) => c.auth === ''),
    JSON.stringify(putCalls.map((c) => c.auth)));
  T.check('the PUT declares the photo\u2019s own content type',
    putCalls.every((c) => c.contentType === 'image/png'),
    JSON.stringify(putCalls.map((c) => c.contentType)));
  T.check('every upload was confirmed with the server before being used',
    completeCalls.length === 3, String(completeCalls.length));
  T.check('the declared sha256 is a real hash of the bytes, not a placeholder',
    ticketCalls.every((c) => /^[0-9a-f]{64}$/.test(String(c.sha256))),
    JSON.stringify(ticketCalls.map((c) => String(c.sha256).slice(0, 8))));
  T.check('each photo hashed differently, so the three are distinguishable',
    new Set(ticketCalls.map((c) => c.sha256)).size === 3,
    JSON.stringify(ticketCalls.map((c) => String(c.sha256).slice(0, 8))));

  const { cell, cells } = photoCell((await buildCsv(report)).csv);
  T.check('\ud83d\udd34 the photo column is no longer blank', cell !== '', `column 7 = ${JSON.stringify(cell)}`);
  T.check('the row still has 11 columns', cells.length === 11, String(cells.length));
  T.check('the urls are pipe-separated', cell.split('|').length === 3, cell);
  T.check('every url is https', cell.split('|').every((u) => u.startsWith('https://')), cell);
  T.check('the column order matches the manifest order exactly',
    cell.split('|').map((u) => u.split('/').pop().replace(/-[0-9a-f]{16}\.png$/, '')).join(',') === order.join(','),
    `${cell}\nvs manifest ${order.join(',')}`);
  T.check('\ud83d\udd34 the urls in the file are the SERVER\u2019s, from the verified completion',
    cell.split('|').every((u) => u.startsWith(PUB + '/seller-photos/')),
    'a client-assembled url would be a claim rather than a verified fact');

  const { owed, notes } = await buildCsv(report);
  const nag = owed.filter((o) => /photo/i.test(o));
  T.check('\ud83d\udd34 the export no longer tells the seller to attach the photos by hand',
    nag.length === 0,
    `photos are in the file, yet the disclosure still says: ${JSON.stringify(nag)}`);
  T.check('\ud83d\udd34 the 30-day life of the links is stated on the branch that hosted them',
    (notes || []).some((n) => /30 days/.test(n)), JSON.stringify(notes));
  T.check('and the note says a fresh download renews them',
    (notes || []).some((n) => /renew/i.test(n)), JSON.stringify(notes));
  T.check('and that deleting the draft or photos invalidates the file',
    (notes || []).some((n) => /delet/i.test(n)), JSON.stringify(notes));
});

// ── 2. eBay's documented field limits ─────────────────────────────────────
await T.section('the field obeys eBay\u2019s documented limits, and reports what it drops', async () => {
  const r = await page.evaluate(() => {
    const many = [];
    for (let i = 1; i <= 15; i++) many.push('https://cdn.test/a/p' + i + '.jpg');
    return {
      over12: window._exportPhotoField(many),
      http:   window._exportPhotoField(['http://cdn.test/a.jpg']),
      noExt:  window._exportPhotoField(['https://cdn.test/a']),
      pipe:   window._exportPhotoField(['https://cdn.test/a|b.jpg']),
      space:  window._exportPhotoField(['https://cdn.test/a b.jpg']),
      long:   window._exportPhotoField([
        'https://cdn.test/' + 'a'.repeat(1200) + '.jpg',
        'https://cdn.test/' + 'b'.repeat(1200) + '.jpg',
      ]),
    };
  });
  T.check('capped at eBay\u2019s documented 12', r.over12.kept.length === 12, String(r.over12.kept.length));
  T.check('the 3 beyond the cap are reported, not swallowed',
    r.over12.dropped.length === 3, JSON.stringify(r.over12.dropped.length));
  T.check('11 separators for 12 urls',
    (r.over12.field.match(/\|/g) || []).length === 11, r.over12.field.slice(0, 40));
  T.check('http is refused', r.http.kept.length === 0 && r.http.dropped.length === 1,
    JSON.stringify(r.http));
  T.check('a url with no file extension is refused', r.noExt.kept.length === 0, JSON.stringify(r.noExt));
  T.check('a url containing the separator is refused rather than corrupting the field',
    r.pipe.kept.length === 0, JSON.stringify(r.pipe));
  T.check('a space is percent-encoded, because eBay says the image will not appear otherwise',
    r.space.kept.length === 1 && r.space.field === 'https://cdn.test/a%20b.jpg', JSON.stringify(r.space));
  T.check('the field is trimmed under 2048 characters',
    r.long.field.length <= 2048, String(r.long.field.length));
  T.check('what was trimmed for length is reported',
    r.long.dropped.some((d) => d.why === 'FIELD_OVER_2048'), JSON.stringify(r.long.dropped));
});

// ── 3. an unchanged photo is reused, not re-uploaded (Will's case 8) ──────
await T.section('a second export reuses the unchanged hosted photos', async () => {
  mode = 'ok'; resetCalls();
  const report = await runExport();
  T.check('the second export still yields three urls', report.urls.length === 3,
    JSON.stringify(report));
  T.check('\ud83d\udd34 nothing was uploaded again', report.uploaded === 0, JSON.stringify(report));
  T.check('\ud83d\udd34 all three were reused', report.reused === 3, JSON.stringify(report));
  T.check('\ud83d\udd34 no ticket was even requested -- the reuse is decided before any network call',
    ticketCalls.length === 0, JSON.stringify(ticketCalls));
  T.check('and no bytes were re-sent to storage', putCalls.length === 0, String(putCalls.length));

  const { cell } = photoCell((await buildCsv(report)).csv);
  T.check('the reused urls are the same ones, still in order',
    cell.split('|').length === 3 && cell.split('|').every((u) => u.startsWith(PUB + '/')), cell);
  T.check('the export is still reported as ok', report.ok === true, JSON.stringify(report));
});

// ── 4. replacing and removing a photo changes the next export (case 9) ────
await T.section('replacing a photo changes the next export; removing one shortens it', async () => {
  mode = 'ok'; resetCalls();
  const before = photoCell((await buildCsv(await runExport())).csv).cell.split('|');

  /* Replace the SECOND photo with different bytes, in place. */
  const order = await page.evaluate(async (id) => {
    const l = await window.photosList(id);
    const target = l.order[1];
    await window.photosRemove(id, target);
    const PNG = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
    const bytes = new Uint8Array(PNG.length);
    for (let i = 0; i < PNG.length; i++) bytes[i] = PNG.charCodeAt(i);
    const f = new File([bytes, new Uint8Array([9, 9, 9])], 'replacement.png', { type: 'image/png' });
    await window.photosAdd(id, [f]);
    const after = await window.photosList(id);
    return after.order;
  }, DRAFT_ID);
  T.check('the draft still holds three photos after the replacement',
    order.length === 3, JSON.stringify(order));

  resetCalls();
  const report = await runExport();
  T.check('\ud83d\udd34 exactly one photo was uploaded -- the replacement',
    report.uploaded === 1, JSON.stringify(report));
  T.check('the two unchanged photos were reused', report.reused === 2, JSON.stringify(report));
  const after = photoCell((await buildCsv(report)).csv).cell.split('|');
  T.check('\ud83d\udd34 the file\u2019s photo column really changed',
    after.join('|') !== before.join('|'), `${before.join('|')}\n->\n${after.join('|')}`);
  T.check('\ud83d\udd34 the replaced photo\u2019s old url is gone from the file',
    !after.includes(before[1]), `still present: ${before[1]}`);
  T.check('the surviving urls are still there', after.includes(before[0]),
    `${before[0]} vanished`);

  // Now remove one and export again.
  resetCalls();
  await page.evaluate(async (id) => {
    const l = await window.photosList(id);
    await window.photosRemove(id, l.order[0]);
  }, DRAFT_ID);
  const shorter = await runExport();
  const cell = photoCell((await buildCsv(shorter)).csv).cell;
  T.check('\ud83d\udd34 removing a photo shortens the column to two urls',
    cell.split('|').length === 2, cell);
  T.check('\ud83d\udd34 the removed photo\u2019s url is not in the file',
    !cell.split('|').includes(after[0]), `still present: ${after[0]}`);
  T.check('nothing was re-uploaded to shorten it', shorter.uploaded === 0,
    JSON.stringify(shorter));
});

// ── 5. renewal near expiry ────────────────────────────────────────────────
await T.section('hosting close to expiry is renewed rather than left to lapse', async () => {
  const plans = await page.evaluate(() => {
    const rec = (days) => ({
      objectKey: 'seller-photos/n/d/p-abc.png', publicUrl: 'https://cdn.test/x.png',
      sha256: 'aa', expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
    });
    return {
      fresh:   window._hostedPlan(rec(25), 'aa'),
      nearing: window._hostedPlan(rec(5),  'aa'),
      lapsed:  window._hostedPlan(rec(-1), 'aa'),
      changed: window._hostedPlan(rec(25), 'bb'),
      absent:  window._hostedPlan(null,    'aa'),
      unparseable: window._hostedPlan({ objectKey: 'k', publicUrl: 'https://cdn.test/x.png',
                                        sha256: 'aa', expiresAt: 'not a date' }, 'aa'),
    };
  });
  T.check('25 days left is kept', plans.fresh === 'keep', plans.fresh);
  T.check('\ud83d\udd34 5 days left is renewed, inside the final third of the 30-day window',
    plans.nearing === 'renew', plans.nearing);
  T.check('\ud83d\udd34 an expiry already past is re-uploaded, not treated as live',
    plans.lapsed === 'upload', plans.lapsed);
  T.check('different bytes force an upload regardless of expiry',
    plans.changed === 'upload', plans.changed);
  T.check('no hosted record means upload', plans.absent === 'upload', plans.absent);
  T.check('\ud83d\udd34 an unreadable expiry is treated as expired -- a listing with a dead url is the bug',
    plans.unparseable === 'upload', plans.unparseable);

  /* And the renewal really happens through the export, not just in the planner. */
  mode = 'ok'; resetCalls();
  await page.evaluate(async (id) => {
    const l = await window.photosList(id);
    const recs = Object.values(l.hosted || {}).map((h) => ({
      ...h, expiresAt: new Date(Date.now() + 4 * 86400000).toISOString(),
    }));
    await window.photosSetHosted(id, recs);
  }, DRAFT_ID);
  const report = await runExport();
  T.check('\ud83d\udd34 an export near expiry renews every photo rather than reusing it',
    report.renewed === 2 && report.reused === 0, JSON.stringify(report));
  T.check('it really went back to storage to do so', putCalls.length === 2,
    String(putCalls.length));
  T.check('and the export is still ok, with the same number of urls',
    report.ok === true && report.urls.length === 2, JSON.stringify(report));
});

// ── 6. no hosting: blank column, and a sentence that says so ──────────────
await T.section('with nothing hosted the column is blank AND the file says why', async () => {
  mode = 'not_configured'; resetCalls();
  /* The hosted records have to go, or the reuse path would answer from them
     and never reach the server's 501. */
  await clearPhotos(DRAFT_ID);
  await seedPhotos(DRAFT_ID, 2);
  const report = await runExport();
  T.check('the outcome is reported as NOT_CONFIGURED, not as "no photos"',
    report.ok === false && report.reason === 'NOT_CONFIGURED', JSON.stringify(report));
  T.check('it stopped after the first 501 instead of retrying every photo',
    ticketCalls.length === 1, String(ticketCalls.length));

  const { csv, owed } = await buildCsv(report);
  const { cell } = photoCell(csv);
  T.check('the photo column is blank', cell === '', JSON.stringify(cell));
  const line = owed.find((o) => /photo/i.test(o)) || '';
  T.check('\ud83d\udd34 the blank column is disclosed, so it is not a silent omission',
    !!line, JSON.stringify(owed));
  T.check('the disclosure says hosting is not switched on, rather than blaming the seller',
    /hosting isn\u2019t switched on/i.test(line), line);
  T.check('it says the column is blank in plain words', /blank/i.test(line), line);
  T.check('it names the manual routes that do work',
    /Download listing photos/i.test(line) && /eBay/i.test(line), line);
});

await T.section('a half-configured host reads as a deployment fault, not as "no photos"', async () => {
  mode = 'misconfigured'; resetCalls();
  const report = await runExport();
  T.check('\ud83d\udd34 the reason is MISCONFIGURED, distinct from NOT_CONFIGURED',
    report.reason === 'MISCONFIGURED', JSON.stringify(report));
  T.check('it stopped at the first one rather than repeating the same fault per photo',
    ticketCalls.length === 1, String(ticketCalls.length));
  const { csv, owed } = await buildCsv(report);
  T.check('the column is blank', photoCell(csv).cell === '', 'expected a blank column');
  const line = owed.find((o) => /photo/i.test(o)) || '';
  T.check('the disclosure says hosting is not set up correctly',
    /isn\u2019t set up correctly/i.test(line), line);
});

await T.section('a signed-out seller is told that, not shown an empty column silently', async () => {
  mode = 'ok';
  /* Signing out means clearing the CACHED token too. `_crIdToken` stores the
     last good token on `window._googleIdToken` and returns it when no user
     object is present, so nulling only the user objects leaves a signed-in
     caller -- the product is right about that, the earlier fixture was not. */
  await page.evaluate(() => {
    window._fbCurrentUser = null; window.googleUser = null; window._googleIdToken = '';
  });
  const report = await runExport();
  T.check('the reason is SIGNED_OUT', report.reason === 'SIGNED_OUT', JSON.stringify(report));
  const { csv, owed } = await buildCsv(report);
  T.check('the column is blank', photoCell(csv).cell === '', 'expected a blank column');
  const line = owed.find((o) => /photo/i.test(o)) || '';
  T.check('the disclosure says the seller is signed out', /signed out/i.test(line), line);
  await page.evaluate(() => {
    window._fbCurrentUser = { getIdToken: async () => 'test-id-token-' + 'x'.repeat(30) };
    window._googleIdToken = '';
  });
});

// ── 7. failures: rejected, unverified, and blocked all read differently ───
await T.section('a partial failure stops the file rather than exporting two of three', async () => {
  mode = 'fail_second'; resetCalls();
  await clearPhotos(DRAFT_ID);
  await seedPhotos(DRAFT_ID, 3);

  /* ONE run, through the button. An earlier draft of this section called
     ensureExportablePhotos first and then pressed the button; by the second
     run the first two photos were already hosted and reused, the stub's
     "second completion fails" trigger had already been spent, and the export
     succeeded -- so the abort assertion passed while the abort never
     happened. The export is driven exactly once here, and the evidence for
     what happened underneath is read off the recorded calls. */
  const aborted = await page.evaluate(async (id) => {
    /* _draftDownloadGo starts from the list row, so without one it returns
       before doing anything -- and an assertion that "no file was produced"
       would pass for the wrong reason. */
    window._draftsState.rows = [{ draftId: id, summary: { title: 'Ivysaur 30/102 Base Set',
                                                          sku: 'PKMBASE30' } }];
    /* The saved file is a click on an anchor with a download attribute.
       Watching URL.createObjectURL instead would also catch photo thumbnail
       previews, which is how an earlier version of this probe reported a file
       that was never offered to the seller. */
    let saved = null;
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) saved = this.download;
      return realClick.apply(this, arguments);
    };
    try {
      await window._draftDownloadGo(id);
    } finally { HTMLAnchorElement.prototype.click = realClick; }
    const d = window._draftsState.dl || {};
    return { saved, error: d.error || '', retry: d.photoRetry || null,
             html: window._draftDownloadPanelHtml({ draftId: id }) };
  }, DRAFT_ID);

  /* What really happened underneath: all three were PUT, all three
     completions were attempted, and exactly one was refused. Without this the
     section could be passing on an export that never uploaded anything. */
  T.check('all three photos were really PUT to storage', putCalls.length === 3,
    JSON.stringify(putCalls.map((c) => c.key.slice(-20))));
  T.check('and a completion was attempted for each', completeCalls.length === 3,
    String(completeCalls.length));
  T.check('\ud83d\udd34 each PUT carried exactly the content type the ticket signed',
    putCalls.every((c) => c.contentType === 'image/png'),
    JSON.stringify(putCalls.map((c) => c.contentType)));
  T.check('\ud83d\udd34 no PUT carried an Authorization header -- the signature is the authority',
    putCalls.every((c) => !c.auth), JSON.stringify(putCalls.map((c) => !!c.auth)));
  T.check('\ud83d\udd34 every completion returned the receipt the ticket issued, unmodified',
    completeCalls.length > 0 && completeCalls.every((c) => c.receipt
      && ticketCalls.length && typeof c.receipt === 'string' && c.receipt.split('.').length === 2),
    JSON.stringify(completeCalls.map((c) => String(c.receipt).slice(0, 12))));
  T.check('no ticket request carried image bytes or a url to fetch',
    ticketCalls.every((c) => !c.hadBytes && !c.hadSourceUrl),
    JSON.stringify(ticketCalls.map((c) => [c.hadBytes, c.hadSourceUrl])));
  /* The key set, which is what actually closes the door. See the MUTATION
     FINDING note on the recorder above: a blacklist of names let a base64
     image through under a name nobody had thought of. */
  const TICKET_KEYS = ['byteLength', 'contentType', 'draftId', 'origin', 'photoId', 'sha256'];
  T.check('🔴 every ticket request carries EXACTLY the six expected fields and nothing else',
    ticketCalls.length > 0 && ticketCalls.every((c) => c.keys.join(',') === TICKET_KEYS.join(',')),
    JSON.stringify(ticketCalls.map((c) => c.keys)));
  /* And a size ceiling, because the whole reason the bytes go straight to
     storage is that a photograph does not fit in one of our request bodies.
     A ticket request is metadata: a few hundred bytes. */
  T.check('🔴 no ticket request body is anywhere near the size of a photograph',
    ticketCalls.every((c) => c.bodyBytes < 1024),
    JSON.stringify(ticketCalls.map((c) => c.bodyBytes)));
  T.check('and each ticket declared where the photo came from',
    ticketCalls.every((c) => c.origin === 'seller' || c.origin === 'scan'),
    JSON.stringify(ticketCalls.map((c) => c.origin)));

  /* THE DECISION UNDER TEST. This used to build the file from the survivors
     and disclose the shortfall. It no longer does: an imported eBay draft
     missing one photograph cannot be undone by a disclosure in our UI, so the
     only cheap moment to fix it is before the file exists. */
  T.check('\ud83d\udd34 no file was produced at all',
    aborted.saved === null, `a file named ${aborted.saved} was saved despite a failed required upload`);
  T.check('\ud83d\udd34 the seller is told nothing was exported, in those words',
    /nothing was exported/i.test(aborted.error), String(aborted.error));
  T.check('and told their draft and photos are unchanged',
    /draft and your photos are unchanged/i.test(aborted.error), String(aborted.error));
  T.check('the failure count the seller sees is the real one',
    aborted.retry && aborted.retry.count === 1, JSON.stringify(aborted.retry));
  T.check('\ud83d\udd34 the retry control is offered on the same panel',
    /data-dl-photo-retry="/.test(aborted.html), aborted.html.slice(0, 300));
  T.check('\ud83d\udd34 the photos are all still in the store',
    (await page.evaluate((id) => window.photosList(id).then((l) => l.order.length), DRAFT_ID)) === 3,
    'an aborted export lost the seller\u2019s photographs');

  /* And the retry really does produce the file, so the refusal above is a
     stop rather than a dead end. */
  mode = 'ok'; resetCalls();
  const retried = await page.evaluate(async (id) => {
    let saved = null;
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) saved = this.download;
      return realClick.apply(this, arguments);
    };
    try { await window._draftDownloadGo(id); } finally { HTMLAnchorElement.prototype.click = realClick; }
    const d = window._draftsState.dl || {};
    return { saved, error: d.error || '', retry: d.photoRetry || null };
  }, DRAFT_ID);
  T.check('\ud83d\udd34 pressing again after the fault clears produces the file',
    retried.saved === 'ebay-draft-PKMBASE30.csv' && !retried.error, JSON.stringify(retried));
  T.check('and the retry notice is cleared rather than left on screen',
    retried.retry === null, JSON.stringify(retried.retry));

  /* The states where nothing COULD have uploaded keep the file, because
     withholding it there leaves a seller with no export at all on a
     deployment where hosting was never switched on. Asserted in the
     not-configured section above; named here so the two rules are not
     confused for each other. */
});

await T.section('an upload the server could not verify is a failure, not a success', async () => {
  mode = 'complete_unverified'; resetCalls();
  await clearPhotos(DRAFT_ID);
  await seedPhotos(DRAFT_ID, 2);
  const report = await runExport();
  T.check('\ud83d\udd34 a 409 from the verification step is NOT treated as hosted',
    report.ok === false && report.urls.length === 0, JSON.stringify(report));
  T.check('both photos are reported failed with the server\u2019s own code',
    report.failed.length === 2 && report.failed.every((f) => f.reason === 'PHOTO_NOT_UPLOADED'),
    JSON.stringify(report.failed));
  T.check('the reason is UPLOAD_FAILED rather than NONE',
    report.reason === 'UPLOAD_FAILED', JSON.stringify(report));
  T.check('the PUTs did happen -- so "uploaded" was the client\u2019s belief, and the server overruled it',
    putCalls.length === 2, String(putCalls.length));
  const { csv, owed } = await buildCsv(report);
  T.check('the column is blank rather than carrying an unverified url',
    photoCell(csv).cell === '', photoCell(csv).cell);
  T.check('and the shortfall is disclosed', owed.some((o) => /photo/i.test(o)), JSON.stringify(owed));
});

await T.section('a storage provider the browser may not PUT to reads as PUT_BLOCKED', async () => {
  mode = 'put_blocked'; resetCalls();
  await clearPhotos(DRAFT_ID);
  await seedPhotos(DRAFT_ID, 1);
  const report = await runExport();
  T.check('\ud83d\udd34 a cross-origin PUT the browser refuses is reported as PUT_BLOCKED',
    report.failed.length === 1 && report.failed[0].reason === 'PUT_BLOCKED',
    JSON.stringify(report.failed));
  T.check('which is NOT the same reason as a rejected upload -- the fixes differ',
    report.failed[0].reason !== 'PUT_HTTP_403', JSON.stringify(report.failed));
  T.check('nothing was recorded as hosted', report.urls.length === 0, JSON.stringify(report));
  T.check('and no completion was claimed for a PUT that never landed',
    completeCalls.length === 0, String(completeCalls.length));

  mode = 'put_rejected'; resetCalls();
  const rejected = await runExport();
  T.check('\ud83d\udd34 a PUT the provider answers 403 to reads as PUT_HTTP_403, distinctly',
    rejected.failed.length === 1 && rejected.failed[0].reason === 'PUT_HTTP_403',
    JSON.stringify(rejected.failed));
});

await T.section('a host that returns a url eBay could not fetch does not reach the file', async () => {
  mode = 'bad_url'; resetCalls();
  await clearPhotos(DRAFT_ID);
  await seedPhotos(DRAFT_ID, 1);
  const report = await runExport();
  const { csv, owed } = await buildCsv(report);
  T.check('an http:// url from the host never reaches the column',
    !photoCell(csv).cell.includes('http://'), photoCell(csv).cell);
  T.check('and the shortfall is disclosed rather than passing as a success',
    owed.some((o) => /photo/i.test(o)), JSON.stringify(owed));
});

// ── 8. catalogue artwork never becomes a listing photo (case 7) ───────────
await T.section('catalogue artwork is not hosted and never enters the photo column', async () => {
  mode = 'ok'; resetCalls();
  await clearPhotos(DRAFT_ID);

  const ART = 'https://images.pokemontcg.io/base1/30_hires.png';
  const snap = await page.evaluate((art) => {
    const withArtwork = window._scanPhotoSnapshot({ imageDataUrl: art }, 'inst_art_1');
    const withPhoto = window._scanPhotoSnapshot(
      { imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' },
      'inst_art_1');
    return { withArtwork, hasPhoto: !!(withPhoto && withPhoto.dataUrl) };
  }, ART);
  T.check('\ud83d\udd34 a catalogue https:// image is refused at capture, so it never reaches the store',
    snap.withArtwork === null, JSON.stringify(snap.withArtwork));
  T.check('a real captured data: photograph IS accepted, so the refusal is specific',
    snap.hasPhoto === true, JSON.stringify(snap));

  /* And at EXPORT: with only artwork available, the column is blank and the
     artwork url is nowhere in the file -- not in the photo column, and not
     smuggled into another column either. */
  const report = await runExport();
  const { csv } = await buildCsv(report);
  T.check('the export reports NONE rather than hosting the artwork',
    report.reason === 'NONE' && report.urls.length === 0, JSON.stringify(report));
  T.check('\ud83d\udd34 the artwork url appears nowhere in the exported file',
    !csv.includes('pokemontcg.io'), 'catalogue artwork reached the CSV');
  T.check('the photo column is blank', photoCell(csv).cell === '', photoCell(csv).cell);
  T.check('and no ticket was requested for artwork', ticketCalls.length === 0,
    JSON.stringify(ticketCalls));
});

// ── 9. the no-report caller ───────────────────────────────────────────────
await T.section('a caller that passes no report gets the blank-column disclosure, not silence', async () => {
  const { csv, owed } = await page.evaluate(({ d, p }) => {
    const r = window._ebayDraftCsv(d, p);           // two arguments, as before
    return { csv: r.csv, owed: r.owed };
  }, { d: draftFixture, p: packetFixture });
  T.check('the column is blank', photoCell(csv).cell === '', 'expected blank');
  T.check('\ud83d\udd34 a missing report does not default to the cheerful branch',
    owed.some((o) => /photo/i.test(o) && /blank/i.test(o)), JSON.stringify(owed));
});

await T.section('an empty store reports NONE and never claims success', async () => {
  const report = await page.evaluate(() => window.ensureExportablePhotos('drf_' + 'e'.repeat(32)));
  T.check('reason is NONE', report.reason === 'NONE', JSON.stringify(report));
  T.check('ok is false', report.ok === false, JSON.stringify(report));
  T.check('there is never a successful report with an empty url list',
    !(report.ok && report.urls.length === 0), JSON.stringify(report));
  const noId = await page.evaluate(() => window.ensureExportablePhotos(''));
  T.check('no draft id reports NONE rather than throwing', noId.reason === 'NONE', JSON.stringify(noId));
});

// ── 10. the photo-only retry (case 10) ────────────────────────────────────
await T.section('a failed upload leaves the draft intact and exposes a photo-only retry', async () => {
  mode = 'complete_unverified'; resetCalls();
  await clearPhotos(DRAFT_ID);
  const seeded = await seedPhotos(DRAFT_ID, 2);

  /* The panel state is what the seller sees. Built through the same function
     the app renders, with the report the failing export really produced. */
  const failing = await runExport();
  const view = await page.evaluate(({ id, rep }) => {
    const pFailed = (rep && rep.failed) || [];
    window._draftsState.dl = {
      draftId: id, busy: false, error: null, note: 'Saved.', owed: [], notes: [],
      photoRetry: pFailed.length
        ? { count: pFailed.length, text: pFailed.length + ' photos could not be uploaded, so they are not in this file. Your draft and your photos are unchanged.' }
        : null,
    };
    return window._draftDownloadPanelHtml({ draftId: id });
  }, { id: DRAFT_ID, rep: failing });

  T.check('\ud83d\udd34 a retry control for the photos alone is rendered',
    /data-dl-photo-retry="/.test(view), view.slice(0, 200));
  T.check('it is labelled as retrying the photos, not the whole draft',
    /Retry photos/.test(view), view.slice(0, 400));
  T.check('\ud83d\udd34 the seller is told the draft and the photos are unchanged',
    /draft and your photos are unchanged/i.test(view), view.slice(0, 600));
  T.check('the manual fallback is still offered alongside it',
    /Download listing photos/.test(view), 'the manual route must remain available');
  T.check('\ud83d\udd34 the photos really are still in the store after the failure',
    (await page.evaluate((id) => window.photosList(id).then((l) => l.order.length), DRAFT_ID)) === seeded.length,
    'a failed upload lost the seller\u2019s photographs');

  /* Not offered when a retry could not possibly differ. */
  const notOffered = await page.evaluate((id) => {
    window._draftsState.dl = { draftId: id, busy: false, error: null, note: '', owed: [],
                               notes: [], photoRetry: null };
    return window._draftDownloadPanelHtml({ draftId: id });
  }, DRAFT_ID);
  T.check('\ud83d\udd34 no retry control is shown when no photo failed',
    !/data-dl-photo-retry="/.test(notOffered), 'a control that cannot help reads as the seller\u2019s fault');

  /* And pressing it re-uploads only what failed: the two photos are retried,
     and a mode change makes the retry succeed. */
  mode = 'ok'; resetCalls();
  const retried = await runExport();
  T.check('the retry uploads the photos that had failed', retried.uploaded === 2,
    JSON.stringify(retried));
  T.check('and the file would now carry both urls', retried.urls.length === 2,
    JSON.stringify(retried.urls));
});

// ── 11. the interim download button ───────────────────────────────────────
await T.section('Download listing photos hands over the files it really has', async () => {
  const res = await page.evaluate((id) => window.downloadListingPhotos(id), DRAFT_ID);
  T.check('it reports the number of photos it found', res.total === 2, JSON.stringify(res));
  T.check('it reports how many it started saving', res.saved === 2, JSON.stringify(res));
  const msg = await page.evaluate((r) => window.downloadListingPhotosMessage(r), res);
  T.check('the message states a count rather than promising a result',
    /2 photos/.test(msg), msg);
  T.check('the message tells the seller the order matters', /order/i.test(msg), msg);
  const none = await page.evaluate(() => window.downloadListingPhotos('drf_' + 'f'.repeat(32)));
  T.check('an empty draft is reported, not silently "saved"',
    none.ok === false && none.reason === 'NONE', JSON.stringify(none));
});

await browser.close();
await new Promise((r) => server.close(r));
await new Promise((r) => blocker.close(r));
T.done();
