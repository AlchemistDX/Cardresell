/**
 * The draft-list Download control, exercised end to end with the REAL button.
 *
 * WHAT FAILED IN THE FIELD, 2026-09-13. Will's evidence:
 *   * IMG_4263: one seller photo is in the review-screen manifest for a
 *     Charizard TG03 draft.
 *   * IMG_4262: the same photo is in the draft's thumbnail on the drafts list.
 *   * 10.csv: the CSV Will downloaded from the drafts list carried the title,
 *     the price ($32.84), the quantity, everything -- except `Item photo URL`,
 *     which was blank.
 * Meanwhile the review-screen copy shipped in the previous packet explicitly
 * promises the photo IS uploaded when the seller creates the eBay file. The
 * silent blank column contradicts the shipped promise.
 *
 * WHAT THIS SUITE PROVES, in a real browser against the real bundle, driving
 * the actual `[data-draft-download]` control (not a helper the button happens
 * to call):
 *
 *   1. SUCCESS. When a local seller photo exists and hosting works, the
 *      downloaded CSV's `Item photo URL` cell is a populated URL from the
 *      hosting stub -- the same URL that came back on the /complete response.
 *      This is asserted against the actual bytes that came out of the browser,
 *      captured through a Blob-URL revoke intercept so the assertion reads the
 *      file the seller would have opened, not a copy reconstructed from state.
 *
 *   2. FAILURE (the exact evidence). When the manifest names a photo but the
 *      blob record is not readable -- Safari eviction, blob pruning, a store
 *      that opens partially -- no CSV is downloaded and the seller sees a
 *      specific error naming what happened. This is the state the field bug
 *      was silently producing a blank column for.
 *
 *   3. FAILURE (SIGNED_OUT with local photo). When a token cannot be obtained
 *      and a local photo exists, no CSV is downloaded. The old rule fell
 *      through to a blank column in this case too.
 *
 *   4. FAILURE (NOT_CONFIGURED with local photo). When hosting is not
 *      configured but a local photo exists, no CSV is downloaded. The old
 *      rule also fell through here.
 *
 *   5. NO LOCAL PHOTOS + HOSTING OFF stays a build. If the seller has nothing
 *      to host and hosting is off, the CSV is still built with a blank column
 *      and the disclosure says why. Withholding it here would leave sellers
 *      on unhosted deployments with no export path.
 *
 * MUTATION discipline. The refusal branch is asserted three ways:
 *   * No anchor with a `download` attribute was clicked.
 *   * The error copy contains "nothing was exported" and names the reason.
 *   * The photo in IndexedDB is untouched -- an aborted refusal must not lose
 *     the seller's photograph.
 *
 * Run: NODE_PATH=/home/user/node_modules node tests/photo-download-gating-2026-09-13.mjs
 */

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';
import { signUploadReceipt, verifyUploadReceipt } from '../api/_photoReceipt.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = '/home/user/node_modules/playwright/index.js';
const T = harness('photo download gating (draft-list button)');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png',
};

// Stub trio, same shape as photo-export-wiring.
let mode = 'ok';
let token = 'stub-id-token';
const PUB = 'https://cdn.test';
const RECEIPT_SECRET = 'gating-suite-secret-not-real';
const NS = 'a'.repeat(32);
const DRAFT_ID = 'drf_' + 'c'.repeat(32);
const SKU = 'PKMTG03CHAR';

const readBody = (req) => new Promise((r) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => { try { r(JSON.parse(raw || '{}')); } catch { r({}); } });
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (u.pathname === '/api/photo-upload-ticket') {
    const body = await readBody(req);
    if (mode === 'not_configured') {
      return send(501, { error: 'not configured', code: 'PHOTO_HOST_NOT_CONFIGURED' });
    }
    const ext = body.contentType === 'image/png' ? '.png' : '.jpg';
    const objectKey = `seller-photos/${NS}/${body.draftId}/${body.photoId}-${String(body.sha256 || '').slice(0, 16)}${ext}`;
    const receipt = signUploadReceipt(RECEIPT_SECRET, {
      owner: 'stub-owner-namespace-0000000000', draftId: body.draftId,
      photoId: body.photoId, objectKey, contentType: body.contentType,
      byteLength: body.byteLength, sha256: body.sha256,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    });
    return send(200, {
      putUrl: `${APP_ORIGIN}/r2put/${encodeURIComponent(objectKey)}?X-Amz-Signature=stub&X-Amz-Expires=300`,
      publicUrl: `${PUB}/${objectKey}`, objectKey,
      requiredHeaders: { 'Content-Type': body.contentType },
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      uploadReceipt: receipt, sha256: body.sha256,
      photoId: body.photoId, draftId: body.draftId,
      contentType: body.contentType, byteLength: body.byteLength, ttlSeconds: 300,
    });
  }

  if (u.pathname.startsWith('/r2put/')) {
    await new Promise((r) => { req.on('data', () => {}); req.on('end', r); });
    res.writeHead(200); return res.end('');
  }

  if (u.pathname === '/api/photo-upload-complete') {
    const body = await readBody(req);
    const rv = verifyUploadReceipt(RECEIPT_SECRET, body.uploadReceipt);
    if (!rv.ok) return send(400, { error: 'receipt', code: rv.reason });
    return send(201, {
      draftId: body.draftId, retentionDays: 30,
      hosted: {
        photoId: body.photoId, objectKey: body.objectKey,
        publicUrl: `${PUB}/${body.objectKey}`, sha256: body.sha256,
        contentType: body.contentType, byteLength: body.byteLength,
        uploadedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
    });
  }

  if (u.pathname === '/api/drafts') {
    return send(200, {
      draft: { draftId: DRAFT_ID, sku: SKU,
               title: 'Charizard TG03 Base Set',
               price: 32.84, quantity: 1 },
      packet: { category: { id: '183454' },
                title: { text: 'Charizard TG03 Base Set' },
                description: { text: 'Charizard, Base Set, TG03.' } },
    });
  }

  let rel = u.pathname === '/' ? '/index.html' : u.pathname;
  const f = path.join(ROOT, rel.replace(/^\/+/, ''));
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const APP_ORIGIN = `http://127.0.0.1:${server.address().port}`;

const { chromium } = (await import(PW)).default;
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on('console', (m) => { if (m.type() === 'error') console.log('  console.error: ' + m.text()); });

await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.photosAdd === 'function'
     && typeof window._draftDownloadGo === 'function'
     && typeof window.ensureExportablePhotos === 'function'
);
await page.evaluate((tok) => { window._googleIdToken = tok; }, token);

/* ── helpers driven inside the page ───────────────────────────────────────── */

async function seedOneUsablePhoto() {
  await page.evaluate(async (id) => {
    // A tiny PNG so uploads are quick. Same 1x1 the other suites use.
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10,
      0,0,0,13,73,72,68,82, 0,0,0,1, 0,0,0,1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
      0,0,0,10,73,68,65,84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180,
      0,0,0,0,73,69,78,68, 174, 66, 96, 130]);
    const file = new File([bytes], 'photo.png', { type: 'image/png' });
    await window.photosAdd(id, [file]);
  }, DRAFT_ID);
}

async function makeBlobRecordUnreadable() {
  // The manifest already names the photo. We drop the record from the `blobs`
  // store so photosList() returns { missing: true, blob: null } for it -- the
  // exact shape Will's device was in. Retry against transient VersionErrors
  // from a store still open under the product code.
  await page.evaluate(async (id) => {
    const l = await window.photosList(id);
    const photoId = l.order[0];
    // The product opens PHOTO_DB_NAME = 'cardresell-listing-photos' with
    // stores 'manifest' and 'blobs'. Delete straight from 'blobs'; retry a
    // couple of times in case a product-code transaction is mid-flight.
    for (let attempt = 0; attempt < 5; attempt++) {
      const err = await new Promise((resolve) => {
        let req;
        try { req = indexedDB.open('cardresell-listing-photos'); }
        catch (e) { resolve(e); return; }
        req.onerror = () => resolve(req.error || new Error('open failed'));
        req.onblocked = () => resolve(new Error('open blocked'));
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('blobs')) { db.close(); resolve(new Error('no blobs store')); return; }
          const tx = db.transaction('blobs', 'readwrite');
          tx.objectStore('blobs').delete(photoId);
          tx.oncomplete = () => { db.close(); resolve(null); };
          tx.onerror = () => { db.close(); resolve(tx.error || new Error('tx err')); };
          tx.onabort = () => { db.close(); resolve(tx.error || new Error('tx abort')); };
        };
      });
      if (!err) return;
      await new Promise((r) => setTimeout(r, 100));
      if (attempt === 4) throw err;
    }
  }, DRAFT_ID);
}

async function driveDownloadButton() {
  return await page.evaluate(async (id) => {
    // A drafts row must exist for the click path _draftDownloadGo takes.
    window._draftsState.rows = [{ draftId: id,
      summary: { title: 'Charizard TG03 Base Set', sku: 'PKMTG03CHAR' } }];
    // Intercept the anchor click AND capture the object-URL bytes so we can
    // read what would have been saved. Without both, a "no CSV" assertion can
    // pass because the anchor was never clicked while a file was still built.
    let saved = null;
    let savedBytes = null;
    const revokeReal = URL.revokeObjectURL.bind(URL);
    const createReal = URL.createObjectURL.bind(URL);
    const blobByUrl = new Map();
    URL.createObjectURL = function (b) {
      const u = createReal(b);
      blobByUrl.set(u, b);
      return u;
    };
    const clickReal = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) {
        saved = this.download;
        const b = blobByUrl.get(this.href);
        if (b) {
          // Read synchronously by chaining; the outer awaits.
          savedBytes = b.text().then((t) => { savedBytes = t; return t; });
        }
      }
      return clickReal.apply(this, arguments);
    };
    URL.revokeObjectURL = revokeReal;
    try {
      await window._draftDownloadGo(id);
    } finally {
      HTMLAnchorElement.prototype.click = clickReal;
      URL.createObjectURL = createReal;
    }
    if (savedBytes && typeof savedBytes.then === 'function') savedBytes = await savedBytes;
    const d = window._draftsState.dl || {};
    return {
      saved, savedBytes,
      error: d.error || '',
      retryText: (d.photoRetry && d.photoRetry.text) || '',
      retryLabel: (d.photoRetry && d.photoRetry.label) || '',
      panel: window._draftDownloadPanelHtml({ draftId: id }),
    };
  }, DRAFT_ID);
}

function photoCellFromCsv(csv) {
  // Skip the four #INFO preamble rows and the header, take the first data row,
  // parse it as a real CSV (quoted commas allowed) and read column 7.
  const rows = String(csv || '').split(/\r\n/).filter(Boolean);
  const data = rows.slice(-1)[0]; // last non-empty line is the single data row
  if (!data) return null;
  const cells = [];
  let cur = '', inQ = false;
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    if (inQ) {
      if (ch === '"' && data[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { cur += ch; }
    } else {
      if (ch === ',') { cells.push(cur); cur = ''; }
      else if (ch === '"' && cur === '') { inQ = true; }
      else { cur += ch; }
    }
  }
  cells.push(cur);
  return cells[7] || '';
}

/* ── the sections ─────────────────────────────────────────────────────────── */

await T.section('SUCCESS: hosted URL lands in Item photo URL when the button is pressed', async () => {
  mode = 'ok'; token = 'stub-id-token';
  await page.evaluate(async (id) => {
    const rows = await window.photosList(id).catch(() => ({ order: [] }));
    for (const pid of (rows.order || [])) { await window.photosRemove(id, pid).catch(() => {}); }
  }, DRAFT_ID);
  await seedOneUsablePhoto();
  await page.evaluate((tok) => { window._googleIdToken = tok; }, token);

  const out = await driveDownloadButton();

  T.check('a CSV really was offered to the seller',
    typeof out.saved === 'string' && /\.csv$/.test(out.saved), String(out.saved));
  T.check('and the download file is named after the SKU',
    out.saved && out.saved.includes('PKMTG03CHAR'), String(out.saved));

  const cell = photoCellFromCsv(out.savedBytes);
  T.check('🔴 Item photo URL cell is not blank',
    cell && cell.length > 0, JSON.stringify({ cell, savedBytes: (out.savedBytes || '').slice(0, 400) }));
  T.check('🔴 Item photo URL is the hosted URL scheme',
    cell && cell.startsWith(PUB + '/seller-photos/'), String(cell).slice(0, 200));
  T.check('and the fingerprint in the URL matches the seeded photo',
    cell && /seller-photos\/[a-f0-9]{32}\//.test(cell), String(cell).slice(0, 200));
  T.check('the seller was NOT told nothing was exported (this is the success branch)',
    !/nothing was exported/i.test(out.error) && !/nothing was exported/i.test(out.retryText),
    JSON.stringify({ err: out.error, retry: out.retryText }));
});

await T.section('FAILURE (the field bug): manifest has a photo but the blob is unreadable → no CSV', async () => {
  mode = 'ok'; token = 'stub-id-token';
  await page.evaluate(async (id) => {
    const rows = await window.photosList(id).catch(() => ({ order: [] }));
    for (const pid of (rows.order || [])) { await window.photosRemove(id, pid).catch(() => {}); }
  }, DRAFT_ID);
  await seedOneUsablePhoto();
  await makeBlobRecordUnreadable();

  // Sanity: photosList sees the missing entry, and it is what
  // ensureExportablePhotos will filter out.
  const shape = await page.evaluate(async (id) => {
    const l = await window.photosList(id);
    const rep = await window.ensureExportablePhotos(id);
    return { orderLen: l.order.length,
             missing: l.photos.filter((p) => p.missing).length,
             usable: l.photos.filter((p) => p.blob && !p.missing).length,
             report: rep };
  }, DRAFT_ID);
  T.check('the manifest still names the photo',
    shape.orderLen === 1, JSON.stringify(shape));
  T.check('the blob record really is unreadable',
    shape.missing === 1 && shape.usable === 0, JSON.stringify(shape));
  T.check('ensureExportablePhotos reports NONE with localCount>0 and missingCount>0',
    shape.report.reason === 'NONE'
    && shape.report.localCount === 1
    && shape.report.missingCount === 1
    && shape.report.urls.length === 0,
    JSON.stringify(shape.report));

  const out = await driveDownloadButton();

  T.check('🔴 NO CSV was downloaded — the download is aborted, not silently blank',
    out.saved === null && out.savedBytes === null,
    JSON.stringify({ saved: out.saved, bytes: (out.savedBytes || '').slice(0, 200) }));
  T.check('🔴 the seller is told nothing was exported, in those words',
    /nothing was exported/i.test(out.error) || /no file was created/i.test(out.error),
    String(out.error));
  T.check('🔴 the error names WHY (the photo is no longer available in this browser)',
    /no longer available in this browser/i.test(out.error), String(out.error));
  T.check('the retry panel is shown with a labelled control',
    /data-dl-photo-retry=/.test(out.panel) && out.retryLabel.length > 0,
    JSON.stringify({ retryLabel: out.retryLabel, panel: out.panel.slice(0, 300) }));

  // The store was not touched. An aborted refusal that lost the photo would
  // be worse than the silent blank column.
  const still = await page.evaluate((id) => window.photosList(id).then((l) => l.order.length), DRAFT_ID);
  T.check('the manifest entry is still there after the refusal',
    still === 1, String(still));
});

await T.section('FAILURE (SIGNED_OUT + local photo): no CSV, specific reason', async () => {
  mode = 'ok';
  await page.evaluate(async (id) => {
    const rows = await window.photosList(id).catch(() => ({ order: [] }));
    for (const pid of (rows.order || [])) { await window.photosRemove(id, pid).catch(() => {}); }
  }, DRAFT_ID);
  await seedOneUsablePhoto();
  // Real signed-out: _crIdToken() returns '' when _googleIdToken is empty.
  await page.evaluate(() => { window._googleIdToken = ''; });

  const out = await driveDownloadButton();
  T.check('🔴 NO CSV downloaded when signed out with a local photo',
    out.saved === null,
    JSON.stringify({ saved: out.saved, err: out.error }));
  // Because _reviewFetch itself returns 401 first, _draftDownloadGo shows the
  // sign-in copy from its own 401 branch rather than the photoReport branch.
  T.check('the seller is told to sign in again',
    /sign in/i.test(out.error), String(out.error));
});

await T.section('FAILURE (NOT_CONFIGURED + local photo): no CSV, hosting-off reason', async () => {
  mode = 'not_configured';
  await page.evaluate((tok) => { window._googleIdToken = tok; }, 'stub-id-token');
  await page.evaluate(async (id) => {
    const rows = await window.photosList(id).catch(() => ({ order: [] }));
    for (const pid of (rows.order || [])) { await window.photosRemove(id, pid).catch(() => {}); }
  }, DRAFT_ID);
  await seedOneUsablePhoto();

  const out = await driveDownloadButton();
  T.check('🔴 NO CSV downloaded when hosting is off and a local photo exists',
    out.saved === null,
    JSON.stringify({ saved: out.saved, err: out.error }));
  T.check('🔴 the error names hosting is not switched on',
    /photo hosting is not switched on/i.test(out.error), String(out.error));
  T.check('and says nothing was exported',
    /nothing was exported/i.test(out.error), String(out.error));
});

await T.section('NO LOCAL PHOTOS + hosting off: CSV still builds with a blank column', async () => {
  mode = 'not_configured';
  await page.evaluate(async (id) => {
    const rows = await window.photosList(id).catch(() => ({ order: [] }));
    for (const pid of (rows.order || [])) { await window.photosRemove(id, pid).catch(() => {}); }
  }, DRAFT_ID);

  const out = await driveDownloadButton();
  T.check('a CSV is offered',
    typeof out.saved === 'string' && /\.csv$/.test(out.saved), String(out.saved));
  const cell = photoCellFromCsv(out.savedBytes);
  T.check('and the photo cell is blank (nothing to host, and said so)',
    cell === '', JSON.stringify({ cell }));
});

await browser.close();
await new Promise((r) => server.close(r));
T.done();
