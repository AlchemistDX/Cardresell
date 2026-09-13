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
 *
 * NOT ESTABLISHED HERE: that eBay accepts the file (that needs a real Seller
 * Hub upload), and that any photo host exists (none is configured).
 *
 * Run: NODE_PATH=/home/user/node_modules node tests/photo-export-wiring-2026-09-13.mjs
 */

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = '/home/user/node_modules/playwright/index.js';
const T = harness('photo export wiring');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

/* A static host for the real app, plus a stub /api/photo-upload whose
   behaviour each test chooses. The stub stands in for the deployed function;
   the endpoint's own refusals are proven against the real handler in
   tests/photo-upload-endpoint-2026-09-13.mjs. */
let uploadMode = 'ok';
const uploadCalls = [];

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/api/photo-upload') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      uploadCalls.push({ id: u.searchParams.get('id'), photoId: body.photoId,
                         contentType: body.contentType, bytes: (body.dataBase64 || '').length,
                         auth: req.headers['authorization'] || '' });
      const send = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (uploadMode === 'not_configured') {
        return send(501, { error: 'Photo hosting is not set up yet', code: 'PHOTO_HOST_NOT_CONFIGURED' });
      }
      if (uploadMode === '401') return send(401, { error: 'Sign in required' });
      if (uploadMode === 'fail_second' && uploadCalls.length === 2) {
        return send(502, { error: 'Could not upload the photo', code: 'PHOTO_UPLOAD_FAILED' });
      }
      if (uploadMode === 'bad_url') {
        return send(201, { url: 'http://cdn.test/x.jpg', photoId: body.photoId });
      }
      // A plausible hosted URL, distinct per photo so ORDER is observable.
      return send(201, {
        url: 'https://cdn.test/seller-photos/o/' + u.searchParams.get('id')
             + '/' + body.photoId + (body.contentType === 'image/png' ? '.png' : '.jpg'),
        photoId: body.photoId,
      });
    });
    return;
  }
  let rel = u.pathname === '/' ? '/index.html' : u.pathname;
  const f = path.join(ROOT, rel.replace(/^\/+/, ''));
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const B = `http://127.0.0.1:${server.address().port}`;

const { chromium } = (await import(PW)).default;
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${B}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.photosAdd === 'function'
     && typeof window._ebayDraftCsv === 'function'
     && typeof window.ensureExportablePhotos === 'function'
     && typeof window._exportPhotoField === 'function',
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
      files.push(new File([bytes], 'p' + (i + 1) + '.png', { type: 'image/png' }));
    }
    await window.photosAdd(draftId, files);
    const l = await window.photosList(draftId);
    return l.order;
  }, { draftId, n });
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
    return { csv: r.csv, owed: r.owed };
  }, { d: draftFixture, p: packetFixture, rep: report });
}

// ── 1. hosted urls really reach column 7, in order ────────────────────────
await T.section('hosted photos land in the photo column, in the seller\u2019s order', async () => {
  uploadMode = 'ok'; uploadCalls.length = 0;
  const order = await seedPhotos(DRAFT_ID, 3);
  T.check('three photos were seeded', order.length === 3, JSON.stringify(order));

  const report = await page.evaluate((id) => window.ensureExportablePhotos(id), DRAFT_ID);
  T.check('the report is ok', report.ok === true, JSON.stringify(report));
  T.check('three photos were uploaded', report.uploaded === 3, JSON.stringify(report));
  T.check('the client sent an Authorization header',
    uploadCalls.length === 3 && uploadCalls.every((c) => /^Bearer /.test(c.auth)),
    JSON.stringify(uploadCalls.map((c) => c.auth.slice(0, 12))));
  T.check('the client sent real bytes, not an empty body',
    uploadCalls.every((c) => c.bytes > 20), JSON.stringify(uploadCalls.map((c) => c.bytes)));

  const { cell, cells } = photoCell((await buildCsv(report)).csv);
  T.check('\ud83d\udd34 the photo column is no longer blank', cell !== '', `column 7 = ${JSON.stringify(cell)}`);
  T.check('the row still has 11 columns', cells.length === 11, String(cells.length));
  T.check('the urls are pipe-separated', cell.split('|').length === 3, cell);
  T.check('every url is https', cell.split('|').every((u) => u.startsWith('https://')), cell);
  T.check('the column order matches the manifest order exactly',
    cell.split('|').map((u) => u.split('/').pop().replace(/\.png$/, '')).join(',') === order.join(','),
    `${cell}\nvs manifest ${order.join(',')}`);

  const { owed } = await buildCsv(report);
  const nag = owed.filter((o) => /photo/i.test(o));
  T.check('\ud83d\udd34 the export no longer tells the seller to attach the photos by hand',
    nag.length === 0,
    `photos are in the file, yet the disclosure still says: ${JSON.stringify(nag)}`);
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

// ── 3. no hosting: blank column, and a sentence that says so ──────────────
await T.section('with nothing hosted the column is blank AND the file says why', async () => {
  uploadMode = 'not_configured'; uploadCalls.length = 0;
  const report = await page.evaluate((id) => window.ensureExportablePhotos(id), DRAFT_ID);
  T.check('the outcome is reported as NOT_CONFIGURED, not as "no photos"',
    report.ok === false && report.reason === 'NOT_CONFIGURED', JSON.stringify(report));
  T.check('it stopped after the first 501 instead of retrying every photo',
    uploadCalls.length === 1, String(uploadCalls.length));

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

await T.section('a signed-out seller is told that, not shown an empty column silently', async () => {
  uploadMode = 'ok';
  /* Signing out means clearing the CACHED token too. `_crIdToken` stores the
     last good token on `window._googleIdToken` and returns it when no user
     object is present, so nulling only the user objects leaves a signed-in
     caller -- the product is right about that, the earlier fixture was not. */
  await page.evaluate(() => {
    window._fbCurrentUser = null; window.googleUser = null; window._googleIdToken = '';
  });
  const report = await page.evaluate((id) => window.ensureExportablePhotos(id), DRAFT_ID);
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

// ── 4. partial failure is partial, and says so ────────────────────────────
await T.section('a partial upload failure keeps the good photos and names the rest', async () => {
  uploadMode = 'fail_second'; uploadCalls.length = 0;
  const report = await page.evaluate((id) => window.ensureExportablePhotos(id), DRAFT_ID);
  T.check('the report is ok because some photos did upload', report.ok === true, JSON.stringify(report));
  T.check('the failure is listed', report.failed.length === 1, JSON.stringify(report.failed));
  const { csv, owed } = await buildCsv(report);
  T.check('the surviving photos are in the column', photoCell(csv).cell.split('|').length === 2,
    photoCell(csv).cell);
  T.check('\ud83d\udd34 the photo that failed is disclosed, not silently missing',
    owed.some((o) => /could not be uploaded/i.test(o)), JSON.stringify(owed));
});

await T.section('a host that returns a url eBay could not fetch does not reach the file', async () => {
  uploadMode = 'bad_url';
  const report = await page.evaluate((id) => window.ensureExportablePhotos(id), DRAFT_ID);
  const { csv, owed } = await buildCsv(report);
  T.check('an http:// url from the host never reaches the column',
    !photoCell(csv).cell.includes('http://'), photoCell(csv).cell);
  T.check('and the shortfall is disclosed rather than passing as a success',
    owed.some((o) => /photo/i.test(o)), JSON.stringify(owed));
});

// ── 5. the no-report caller ───────────────────────────────────────────────
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

// ── 6. the interim download button ────────────────────────────────────────
await T.section('Download listing photos hands over the files it really has', async () => {
  const res = await page.evaluate((id) => window.downloadListingPhotos(id), DRAFT_ID);
  T.check('it reports the number of photos it found', res.total === 3, JSON.stringify(res));
  T.check('it reports how many it started saving', res.saved === 3, JSON.stringify(res));
  const msg = await page.evaluate((r) => window.downloadListingPhotosMessage(r), res);
  T.check('the message states a count rather than promising a result',
    /3 photos/.test(msg), msg);
  T.check('the message tells the seller the order matters', /order/i.test(msg), msg);
  const none = await page.evaluate(() => window.downloadListingPhotos('drf_' + 'f'.repeat(32)));
  T.check('an empty draft is reported, not silently "saved"',
    none.ok === false && none.reason === 'NONE', JSON.stringify(none));
});

await browser.close();
await new Promise((r) => server.close(r));
T.done();
