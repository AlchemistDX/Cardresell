/**
 * tests/listing-photos.mjs — D7 local listing photos, in a real browser.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The D7 store cannot be tested in node: IndexedDB is a browser API, and the
 * property under test is a TRANSACTION property, so a fake would be testing
 * the fake. Every check here runs against the real bundle in real Chromium.
 *
 * The load-bearing check is `transaction abort after blob success`. The whole
 * corrected design (audit/d7/D7_ENTRY_GATE.md §6.3) rests on one distinction:
 * an individual request reporting success is NOT the item being stored. If
 * that distinction is wrong, every other check here still passes while the
 * store silently loses data. So the suite forces an abort at exactly the point
 * where the blob requests have all succeeded and the transaction has not
 * committed, and asserts three things: the caller sees a rejection, no blob
 * survives, and the manifest is unchanged.
 *
 * The second is `two tabs add to the same draft`. The manifest is read and
 * rewritten inside the write transaction precisely so a stale UI copy cannot
 * clobber a concurrent addition. A suite that adds from one tab at a time
 * would pass against the broken version.
 *
 * NOT REGISTERED YET in audit/RELEASE_VALIDATION_QUEUE.md — recorded as an
 * open item, same as draft-review-screen.mjs was for five days. Registration
 * happens in the D7 closeout, not here, and the omission is written down
 * rather than left to be noticed.
 *
 * Run: node tests/listing-photos.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = '/home/user/node_modules/playwright/index.js';
const T = harness('listing-photos');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};

function startHost() {
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
    catch (_) { res.writeHead(400).end(); return; }
    if (rel === '/') rel = '/index.html';
    const abs = path.resolve(ROOT, '.' + rel);
    if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(abs, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
      res.writeHead(200, {
        'content-type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(buf);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

const { server, port } = await startHost();
const _pw = (await import(PW)).default;
const browser = await _pw.chromium.launch();

/* One context per scenario = one origin's storage, isolated. Two PAGES in the
   same context share storage, which is what makes the two-tab check real. */
async function ctxWith() {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  return ctx;
}
async function pageIn(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('  [pageerror] ' + e.message); });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.photosAdd === 'function', { timeout: 15000 });
  return page;
}

/* Build real File objects in the page. A 1x1 PNG is a real image the browser
   will decode, so validation checks are not testing a made-up byte string. */
const MAKE_FILES = `(names) => names.map((n, i) => {
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
  return new File([bytes, new Uint8Array([i])], n, { type: 'image/png' });
})`;

const add = (page, draftId, names) => page.evaluate(
  async ({ draftId, names, mk }) => {
    const files = eval(mk)(names);
    try { return { ok: true, res: await window.photosAdd(draftId, files) }; }
    catch (e) { return { ok: false, name: e.name, code: e.code, message: e.message }; }
  },
  { draftId, names, mk: MAKE_FILES },
);

const list = (page, draftId) => page.evaluate(async (id) => {
  const r = await window.photosList(id);
  return { order: r.order, photos: r.photos.map(p => ({ id: p.id, missing: p.missing, bytes: p.blob ? p.blob.size : 0, name: p.name })) };
}, draftId);

/* Raw store inspection, deliberately NOT through the module under test. */
const rawCounts = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open('cardresell-listing-photos');
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction(['manifest', 'blobs'], 'readonly');
    const m = tx.objectStore('manifest').getAll();
    const b = tx.objectStore('blobs').count();
    tx.oncomplete = () => { db.close(); resolve({ manifest: m.result, blobs: b.result }); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  };
}));

const dropBlob = (page, photoId) => page.evaluate((pid) => new Promise((resolve, reject) => {
  const req = indexedDB.open('cardresell-listing-photos');
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction(['blobs'], 'readwrite');
    tx.objectStore('blobs').delete(pid);
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  };
  req.onerror = () => reject(req.error);
}), photoId);

// ── 1. reload, order, removal ────────────────────────────────────────────
{
  console.log('\n1. round-trip: reload, order, removal');
  const ctx = await ctxWith();
  let page = await pageIn(ctx);
  const r = await add(page, 'draft-A', ['a.png', 'b.png', 'c.png']);
  T.check('three photos add in one call', r.ok && r.res.added.length === 3, JSON.stringify(r));
  const ids = r.ok ? r.res.added : [];

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.photosList === 'function', { timeout: 15000 });
  const afterReload = await list(page, 'draft-A');
  T.check('order survives a reload, unchanged',
    JSON.stringify(afterReload.order) === JSON.stringify(ids),
    `${JSON.stringify(afterReload.order)} vs ${JSON.stringify(ids)}`);
  T.check('bytes survive a reload', afterReload.photos.every(p => !p.missing && p.bytes > 0));
  T.check('names survive a reload',
    afterReload.photos.map(p => p.name).join(',') === 'a.png,b.png,c.png',
    afterReload.photos.map(p => p.name).join(','));

  // Remove the MIDDLE one: the defect is losing relative order of survivors,
  // not closing a gap in display numbering (D7 gate §6.4).
  await page.evaluate(async (pid) => await window.photosRemove('draft-A', pid), ids[1]);
  const afterRemove = await list(page, 'draft-A');
  T.check('removal drops exactly one entry', afterRemove.order.length === 2, JSON.stringify(afterRemove.order));
  T.check('survivors keep their RELATIVE order',
    JSON.stringify(afterRemove.order) === JSON.stringify([ids[0], ids[2]]),
    JSON.stringify(afterRemove.order));
  T.check('surviving ids are STABLE across the removal',
    afterRemove.photos.every(p => ids.includes(p.id)));
  const raw = await rawCounts(page);
  T.check('the removed blob is gone from the blob store too', raw.blobs === 2, `blobs=${raw.blobs}`);
  T.check('removal did not touch other drafts',
    raw.manifest.length === 1 && raw.manifest[0].draftId === 'draft-A');
  await ctx.close();
}

// ── 2. THE LOAD-BEARING CHECK: abort after blob success, before commit ───
{
  console.log('\n2. transaction abort after blob request success, before commit');
  const ctx = await ctxWith();
  const page = await pageIn(ctx);
  const seed = await add(page, 'draft-B', ['keep-1.png', 'keep-2.png']);
  T.check('seed addition committed', seed.ok && seed.res.order.length === 2);
  const seedOrder = seed.ok ? seed.res.order : [];

  /* The fault fires AFTER every blob put has reported success and BEFORE the
     manifest write and commit. If the store reported saves on request
     success, this call would resolve. */
  const aborted = await page.evaluate(async (mk) => {
    window._photoStoreFaults = { abortBeforeCommit: true };
    const files = eval(mk)(['ghost-1.png', 'ghost-2.png']);
    let outcome;
    try { outcome = { resolved: true, value: await window.photosAdd('draft-B', files) }; }
    catch (e) { outcome = { resolved: false, code: e.code, message: e.message }; }
    window._photoStoreFaults = null;
    return outcome;
  }, MAKE_FILES);

  T.check('the caller sees a REJECTION, not a save',
    aborted.resolved === false, JSON.stringify(aborted));
  T.check('the rejection is the forced abort, not some earlier throw',
    aborted.code === 'FORCED_ABORT', String(aborted.code));

  const raw = await rawCounts(page);
  T.check('NO ghost blob survives the abort — request success was not storage',
    raw.blobs === 2, `blobs=${raw.blobs}, expected 2 (the seed pair only)`);
  const row = raw.manifest.find(m => m.draftId === 'draft-B');
  T.check('the manifest is byte-for-byte unchanged by the aborted add',
    JSON.stringify(row.order) === JSON.stringify(seedOrder),
    JSON.stringify(row.order));

  const after = await list(page, 'draft-B');
  T.check('a read after the abort shows no partial state',
    after.order.length === 2 && after.photos.every(p => !p.missing));

  const again = await add(page, 'draft-B', ['real.png']);
  T.check('the store still works after an aborted transaction',
    again.ok && again.res.order.length === 3, JSON.stringify(again));
  await ctx.close();
}

// ── 3. two tabs adding to the same draft ─────────────────────────────────
{
  console.log('\n3. two tabs add to the same draft concurrently');
  const ctx = await ctxWith();
  const tab1 = await pageIn(ctx);
  const tab2 = await pageIn(ctx);
  await add(tab1, 'draft-C', ['base.png']);

  /* Both tabs hold the SAME stale view of the manifest (one entry) and then
     both add. A store that wrote back a UI-captured manifest would end with
     two entries; reading inside the transaction ends with three. */
  const [r1, r2] = await Promise.all([
    add(tab1, 'draft-C', ['from-tab-1.png']),
    add(tab2, 'draft-C', ['from-tab-2.png']),
  ]);
  T.check('both tabs report success', r1.ok && r2.ok, JSON.stringify([r1, r2]));
  const final = await list(tab1, 'draft-C');
  T.check('NEITHER addition overwrote the other — all three are present',
    final.order.length === 3, `order=${JSON.stringify(final.order)}`);
  const names = final.photos.map(p => p.name).sort().join(',');
  T.check('both tabs\' files are the ones present',
    names === 'base.png,from-tab-1.png,from-tab-2.png', names);
  T.check('every surviving entry has its bytes', final.photos.every(p => !p.missing && p.bytes > 0));
  await ctx.close();
}

// ── 4. a manifest entry whose bytes are missing ──────────────────────────
{
  console.log('\n4. manifest entry with missing bytes');
  const ctx = await ctxWith();
  const page = await pageIn(ctx);
  const r = await add(page, 'draft-D', ['one.png', 'two.png', 'three.png']);
  await dropBlob(page, r.res.added[1]);
  const after = await list(page, 'draft-D');
  T.check('the manifest still names all three', after.order.length === 3, JSON.stringify(after.order));
  T.check('the entry with missing bytes is flagged MISSING, not dropped',
    after.photos[1].missing === true && after.photos[1].bytes === 0,
    JSON.stringify(after.photos[1]));
  T.check('its neighbours are unaffected',
    after.photos[0].missing === false && after.photos[2].missing === false);
  T.check('missing and never-added do NOT render identically',
    (await page.evaluate(() => window.PHOTO_MISSING_COPY)) !== (await page.evaluate(() => window.PHOTO_EMPTY_COPY)));
  await ctx.close();
}

// ── 5. complete local absence ────────────────────────────────────────────
{
  console.log('\n5. complete local absence');
  const ctx = await ctxWith();
  const page = await pageIn(ctx);
  const empty = await list(page, 'never-touched');
  T.check('an untouched draft lists nothing', empty.order.length === 0 && empty.photos.length === 0);

  const copy = await page.evaluate(() => window.PHOTO_EMPTY_COPY);
  T.check('the empty line scopes itself to THIS BROWSER',
    /this browser/i.test(copy), copy);
  /* Eviction clears a bucket in its entirety, so an absent manifest is not
     evidence of an empty history. The copy must not claim one. */
  T.check('the empty line makes NO claim about what was added',
    !/(nothing|none|never|no photos were|haven't|have not) (was|were|been) ?(added)?/i.test(copy)
    && !/added/i.test(copy), copy);

  const limit = await page.evaluate(() => window.PHOTO_BROWSER_LIMIT_COPY);
  T.check('the limitation copy is browser-scoped, not device-scoped',
    /browser/i.test(limit), limit);
  T.check('the limitation copy states no upload happens', /not uploaded/i.test(limit), limit);
  T.check('the limitation copy is unconditional — no "if"/"when applicable" hedge',
    !/\bif you\b|when applicable|may not/i.test(limit), limit);
  await ctx.close();
}

// ── 6. no image bytes leave the browser ──────────────────────────────────
{
  console.log('\n6. no upload');
  const ctx = await ctxWith();
  const page = await pageIn(ctx);
  /* FIRST RUN CAUGHT THE CHECK, NOT THE STORE. This began as "no POST/PUT
     during the whole page lifetime" and failed on a page-load beacon to
     /api/events with an empty body. Probed it directly: the beacon fires twice
     before any photo call and the add issues zero requests. So the original
     assertion was measuring page boot, not the feature.

     Fixed in the CHECK, not by relaxing what the store must do. The window is
     now scoped to the add-and-list call, and a second assertion holds
     independently of any window: no request at any point carries a non-empty
     body while photos are in play. A leak would have to appear in one of
     those two, and the beacon appears in neither. */
  await page.evaluate(() => new Promise(r => setTimeout(r, 1200))); // let boot settle
  const bodies = [];
  const everyBody = [];
  page.on('request', (req) => {
    const mm = req.method();
    if (mm === 'POST' || mm === 'PUT' || mm === 'PATCH') {
      let dd = ''; try { dd = req.postData() || ''; } catch (_) { dd = '[unreadable]'; }
      everyBody.push({ url: req.url(), len: dd.length });
    }
  });
  page.on('request', (req) => {
    const m = req.method();
    if (m === 'POST' || m === 'PUT' || m === 'PATCH') {
      let d = '';
      try { d = req.postData() || ''; } catch (_) { d = '[unreadable]'; }
      bodies.push({ url: req.url(), method: m, len: d.length, data: d.slice(0, 200) });
    }
  });
  await add(page, 'draft-E', ['secret-1.png', 'secret-2.png']);
  await list(page, 'draft-E');
  await page.evaluate(() => new Promise(r => setTimeout(r, 600)));
  T.check('adding photos issued NO upload request at all',
    bodies.length === 0, JSON.stringify(bodies));
  T.check('no request carried a non-empty body while photos were in play',
    everyBody.every(b => b.len === 0), JSON.stringify(everyBody));
  T.check('no request body mentions a photo filename',
    !bodies.some(b => /secret-/.test(b.data)));
  T.check('no request went to an upload-shaped endpoint',
    !everyBody.some(b => /upload|photo|image|media|blob/i.test(b.url)), JSON.stringify(everyBody));
  await ctx.close();
}

// ── 7. failure copy does not guess a cause ───────────────────────────────
{
  console.log('\n7. failure copy names only what is established');
  const ctx = await ctxWith();
  const page = await pageIn(ctx);
  const msgs = await page.evaluate(() => {
    const q = new Error('quota'); q.name = 'QuotaExceededError';
    const lim = new Error('limit'); lim.code = 'PHOTO_LIMIT';
    const unknown = new Error('something went wrong');
    return {
      quota: window.photoStorageFailureMessage(q),
      limit: window.photoStorageFailureMessage(lim),
      unknown: window.photoStorageFailureMessage(unknown),
    };
  });
  T.check('a quota error names the quota — the browser established that',
    /storage is full/i.test(msgs.quota), msgs.quota);
  T.check('an unexplained failure does NOT name private mode',
    !/private|incognito|blocked|setting/i.test(msgs.unknown), msgs.unknown);
  T.check('an unexplained failure says the photos were not saved in this browser',
    /this browser/i.test(msgs.unknown) && /not (saved|added)/i.test(msgs.unknown), msgs.unknown);
  T.check('no failure message speculates about a cause across the board',
    !Object.values(msgs).some(m => /probably|likely|might be|may be because/i.test(m)));
  T.check('hitting the per-draft cap reads as a cap, not a storage failure',
    /up to \d+ photos/i.test(msgs.limit) && !/storage/i.test(msgs.limit), msgs.limit);

  const capped = await page.evaluate(async (mk) => {
    const names = Array.from({ length: 14 }, (_, i) => `f${i}.png`);
    const res = await window.photosAdd('draft-F', eval(mk)(names));
    let second;
    try { second = { resolved: true, v: await window.photosAdd('draft-F', eval(mk)(['over.png'])) }; }
    catch (e) { second = { resolved: false, code: e.code }; }
    return { first: res, second };
  }, MAKE_FILES);
  T.check('the cap truncates rather than rejecting a partly-fitting batch',
    capped.first.order.length === 12 && capped.first.skipped === 2, JSON.stringify(capped.first).slice(0, 160));
  T.check('adding past a full draft rejects with the cap code',
    capped.second.resolved === false && capped.second.code === 'PHOTO_LIMIT', JSON.stringify(capped.second));
  await ctx.close();
}

// ═════════════════════════════════════════════════════════════════════════
// PART TWO — the SCREEN. Everything above tests the store; a store that makes
// no requests establishes nothing about what its caller sends, and a store
// that returns a `missing` flag establishes nothing about what a seller sees.
// These drive the real picker on the real review screen.
// ═════════════════════════════════════════════════════════════════════════

import { generateReadFixtures } from './_draftListFixtures.mjs';
const FX = await generateReadFixtures();

/** Boot the review screen for one draft, with the draft read stubbed. */
async function reviewPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('  [pageerror] ' + e.message); });
  await page.route('**/api/drafts*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FX.publishable.body) });
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.renderReviewView === 'function', { timeout: 15000 });
  await page.evaluate(() => { window._crIdToken = async () => 'test-id-token'; });
  return page;
}

async function openReview(page, id) {
  await page.evaluate((i) => window.openDraftReview(i), id);
  await page.waitForFunction(() => window._reviewState && window._reviewState.loading === false, { timeout: 15000 });
  await page.waitForFunction(() => !!document.querySelector('[data-photo-block]'), { timeout: 15000 });
  await page.waitForFunction(() => window._photoUi && window._photoUi.loaded === true, { timeout: 15000 });
}

/* Write real image files to disk so the picker receives them the way a
   seller's picker does — setInputFiles, not a synthesised File in page JS. */
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'd7photos-'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function pngAt(name, salt) {
  const abs = path.join(TMP, name);
  fs.writeFileSync(abs, Buffer.concat([PNG, Buffer.from([salt])]));
  return abs;
}
function junkAt(name, body) {
  const abs = path.join(TMP, name);
  fs.writeFileSync(abs, Buffer.from(body));
  return abs;
}

/* TWO CHECK BUGS FOUND HERE, RECORDED BECAUSE THEY BOTH LOOKED LIKE PRODUCT
   FAILURES.

   v1 waited for `busy === false`, which is the state BEFORE the add starts, so
   every assertion sampled a blank screen and the suite reported the UI broken.
   v2 waited for the `busy` edge true-then-false. That works for a batch that
   reaches IndexedDB, and CANNOT work for a batch rejected during validation:
   HEIC is refused with no await that yields to the event loop, so the flag
   goes up and down inside one task and no poller can observe it. The suite
   then blamed the UI for a wait it could never satisfy.

   v3 waits on the RENDERED BLOCK instead of on internal state -- what the
   seller would see change. It needs no production counter, and it is the same
   surface the assertions read. */
const blockHtml = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-photo-block]');
  return el ? el.innerHTML : '';
});

const pick = async (page, files) => {
  const before = await blockHtml(page);
  await page.setInputFiles('[data-photo-input]', files);
  await page.waitForFunction((prev) => {
    const el = document.querySelector('[data-photo-block]');
    return !!el && el.innerHTML !== prev && !/data-photo-loading/.test(el.innerHTML)
      && !el.querySelector('[data-photo-add][disabled]');
  }, before, { timeout: 30000 });
  await page.evaluate(() => new Promise(r => setTimeout(r, 250)));
};

const tiles = (page) => page.evaluate(() => (
  [...document.querySelectorAll('[data-photo-item]')].map((el) => ({
    id: el.getAttribute('data-photo-item'),
    pos: (el.querySelector('.photo-pos') || {}).innerText || '',
    gone: !!el.querySelector('[data-photo-missing]'),
    goneText: (el.querySelector('[data-photo-missing]') || {}).innerText || '',
    hasImg: !!el.querySelector('img.photo-thumb'),
    upDisabled: !!el.querySelector('[data-photo-move="up"]').disabled,
    downDisabled: !!el.querySelector('[data-photo-move="down"]').disabled,
  }))
));

const screenState = (page) => page.evaluate(() => ({
  limitVisible: !!document.querySelector('[data-photo-limit]'),
  limitText: (document.querySelector('[data-photo-limit]') || {}).innerText || '',
  emptyShown: !!document.querySelector('[data-photo-empty]'),
  emptyText: (document.querySelector('[data-photo-empty]') || {}).innerText || '',
  status: (document.querySelector('[data-photo-status]') || {}).innerText || '',
  statusKind: (document.querySelector('[data-photo-status]') || {}).getAttribute
    ? document.querySelector('[data-photo-status]').getAttribute('data-photo-status-kind') : null,
  gridShown: !!document.querySelector('[data-photo-grid]'),
}));

// ── 8. the seller adds through the picker ────────────────────────────────
{
  console.log('\n8. add through the real picker');
  const ctx = await ctxWith();
  const page = await reviewPage(ctx);
  await openReview(page, 'draft-ui-1');

  const before = await screenState(page);
  T.check('an empty draft shows the empty line, not a grid',
    before.emptyShown && !before.gridShown, JSON.stringify(before));
  T.check('the empty line is the browser-scoped one',
    /no listing photos are available in this browser/i.test(before.emptyText), before.emptyText);
  T.check('the browser-local limitation is visible with NO photos present',
    before.limitVisible && /browser/i.test(before.limitText), before.limitText);

  await pick(page, [pngAt('one.png', 1), pngAt('two.png', 2), pngAt('three.png', 3)]);
  const after = await screenState(page);
  const t = await tiles(page);
  T.check('three tiles render after the pick', t.length === 3, String(t.length));
  // GUARDED: `every` on an empty array is true, so this assertion passed
  // vacuously on the first run while the screen was blank. A count check is
  // part of the condition now, not a separate line that can fail alone.
  T.check('each tile shows a real thumbnail',
    t.length === 3 && t.every(x => x.hasImg && !x.gone), JSON.stringify(t));
  T.check('positions are numbered 1..3', t.map(x => x.pos).join(',') === '1,2,3', t.map(x => x.pos).join(','));
  T.check('the empty line is gone once photos exist', !after.emptyShown);
  T.check('the browser-local limitation is STILL visible with photos present',
    after.limitVisible && /browser/i.test(after.limitText), after.limitText);
  T.check('the batch line states how many were added', /added 3 photos/i.test(after.status), after.status);
  T.check('first tile cannot move up, last cannot move down',
    t.length === 3 && t[0].upDisabled && !t[0].downDisabled
    && t[2].downDisabled && !t[2].upDisabled, JSON.stringify(t.map(x => [x.upDisabled, x.downDisabled])));
  await ctx.close();
}

// ── 9. reorder, and the chosen order after reload ────────────────────────
{
  console.log('\n9. reorder through seller controls, verified after reload');
  const ctx = await ctxWith();
  let page = await reviewPage(ctx);
  await openReview(page, 'draft-ui-2');
  await pick(page, [pngAt('r1.png', 11), pngAt('r2.png', 12), pngAt('r3.png', 13)]);
  const ids = (await tiles(page)).map(x => x.id);

  // Move the LAST photo up one place: 1,2,3 -> 1,3,2
  await page.click(`[data-photo-item="${ids[2]}"] [data-photo-move="up"]`);
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
  let order = (await tiles(page)).map(x => x.id);
  T.check('moving the last photo up swaps it with its neighbour',
    JSON.stringify(order) === JSON.stringify([ids[0], ids[2], ids[1]]), JSON.stringify(order));

  // And move the first one down: 1,3,2 -> 3,1,2
  await page.click(`[data-photo-item="${ids[0]}"] [data-photo-move="down"]`);
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  order = (await tiles(page)).map(x => x.id);
  T.check('moving the first photo down swaps it the other way',
    JSON.stringify(order) === JSON.stringify([ids[2], ids[0], ids[1]]), JSON.stringify(order));

  /* THE REQUIREMENT: the CHOSEN order after a reload, not just after a
     repaint. A screen that reordered only its own array would pass everything
     above and fail here. */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.renderReviewView === 'function', { timeout: 15000 });
  await page.evaluate(() => { window._crIdToken = async () => 'test-id-token'; });
  await openReview(page, 'draft-ui-2');
  const afterReload = (await tiles(page)).map(x => x.id);
  T.check('THE CHOSEN ORDER SURVIVES A FULL RELOAD',
    JSON.stringify(afterReload) === JSON.stringify([ids[2], ids[0], ids[1]]), JSON.stringify(afterReload));
  T.check('positions renumber 1..3 after reordering — ids are what stayed stable',
    (await tiles(page)).map(x => x.pos).join(',') === '1,2,3');
  await ctx.close();
}

// ── 10. remove through seller controls ───────────────────────────────────
{
  console.log('\n10. remove through seller controls');
  const ctx = await ctxWith();
  const page = await reviewPage(ctx);
  await openReview(page, 'draft-ui-3');
  await pick(page, [pngAt('d1.png', 21), pngAt('d2.png', 22), pngAt('d3.png', 23)]);
  const ids = (await tiles(page)).map(x => x.id);
  await page.click(`[data-photo-item="${ids[1]}"] [data-photo-remove]`);
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  const left = await tiles(page);
  T.check('the removed tile is gone from the screen', left.length === 2);
  T.check('survivors keep relative order and renumber',
    JSON.stringify(left.map(x => x.id)) === JSON.stringify([ids[0], ids[2]])
    && left.map(x => x.pos).join(',') === '1,2', JSON.stringify(left.map(x => [x.id, x.pos])));

  // Removing the last one returns the browser-scoped empty line, not a blank.
  await page.click(`[data-photo-item="${ids[0]}"] [data-photo-remove]`);
  await page.evaluate(() => new Promise(r => setTimeout(r, 250)));
  await page.click(`[data-photo-item="${ids[2]}"] [data-photo-remove]`);
  await page.evaluate(() => new Promise(r => setTimeout(r, 250)));
  const end = await screenState(page);
  T.check('removing every photo shows the empty line again',
    end.emptyShown && /available in this browser/i.test(end.emptyText), end.emptyText);
  T.check('and the limitation line is still there', end.limitVisible);
  await ctx.close();
}

// ── 11. missing photo renders distinctly from an empty collection ────────
{
  console.log('\n11. missing placeholder vs empty collection, on screen');
  const ctx = await ctxWith();
  const page = await reviewPage(ctx);
  await openReview(page, 'draft-ui-4');
  await pick(page, [pngAt('m1.png', 31), pngAt('m2.png', 32), pngAt('m3.png', 33)]);
  const ids = (await tiles(page)).map(x => x.id);
  await dropBlob(page, ids[1]);
  await page.evaluate(() => window._photoUi && (window._photoUi.loaded = false));
  await page.evaluate(() => window.loadDraftReview('draft-ui-4'));
  await page.waitForFunction(() => window._photoUi && window._photoUi.loaded === true, { timeout: 15000 });
  const t = await tiles(page);
  const st = await screenState(page);
  T.check('all three tiles still render — the lost one is not dropped', t.length === 3, String(t.length));
  T.check('the lost photo renders as its OWN element with its own sentence',
    t[1].gone && /no longer available in this browser/i.test(t[1].goneText), JSON.stringify(t[1]));
  T.check('the lost photo shows no image', !t[1].hasImg);
  T.check('THE EMPTY LINE IS NOT SHOWN — a lost photo is not an empty collection',
    !st.emptyShown && st.gridShown, JSON.stringify(st));
  T.check('its neighbours still show their thumbnails', t[0].hasImg && t[2].hasImg);
  T.check('the lost tile is still reorderable and removable',
    (await page.evaluate((id) => !!document.querySelector(`[data-photo-item="${id}"] [data-photo-remove]`), ids[1])));
  await ctx.close();
}

// ── 12. decoding validation and HEIC guidance, through the picker ────────
{
  console.log('\n12. validation through the picker');
  const ctx = await ctxWith();
  const page = await reviewPage(ctx);
  await openReview(page, 'draft-ui-5');

  await pick(page, [pngAt('good.png', 41), junkAt('bad.png', 'this is not a png at all, not even close')]);
  let st = await screenState(page);
  let t = await tiles(page);
  T.check('the decodable file was added', t.length === 1 && t[0].hasImg, String(t.length));
  T.check('the undecodable file was NOT added', t.length === 1);
  T.check('the status names the rejected file', /bad\.png/.test(st.status), st.status);
  T.check('the status reports the partial outcome, both halves',
    /added 1 photo/i.test(st.status) && /not added/i.test(st.status), st.status);

  await pick(page, [junkAt('photo.heic', 'heic-ish bytes')]);
  st = await screenState(page);
  T.check('a HEIC file is refused with the iPhone Settings guidance',
    /most compatible/i.test(st.status), st.status);
  T.check('the HEIC guidance is the SCAN path wording, not a second copy of it',
    st.status.includes('Settings › Camera › Formats'), st.status);
  T.check('a refused batch does not remove what was already there',
    (await tiles(page)).length === 1);
  await ctx.close();
}

// ── 13. the cap is described as ours, not eBay's ─────────────────────────
{
  console.log('\n13. partial batch and the cap wording');
  const ctx = await ctxWith();
  const page = await reviewPage(ctx);
  await openReview(page, 'draft-ui-6');
  const many = Array.from({ length: 14 }, (_, i) => pngAt(`b${i}.png`, 60 + i));
  await pick(page, many);
  const st = await screenState(page);
  const t = await tiles(page);
  T.check('exactly the cap was stored', t.length === 12, String(t.length));
  T.check('the status says how many were added', /added 12 photos/i.test(st.status), st.status);
  T.check('the status says how many were skipped', /2 photos were not added/i.test(st.status), st.status);
  T.check('the cap is attributed to CARDRESELL', /cardresell keeps up to 12/i.test(st.status), st.status);
  T.check('the cap is explicitly NOT presented as an eBay requirement',
    /not an ebay requirement/i.test(st.status), st.status);
  T.check('the cap line scopes itself to this browser', /in this browser/i.test(st.status), st.status);
  await ctx.close();
}

// ── 14. transaction failure on screen ───────────────────────────────────
{
  console.log('\n14. transaction failure preserves the displayed collection');
  const ctx = await ctxWith();
  const page = await reviewPage(ctx);
  await openReview(page, 'draft-ui-7');
  await pick(page, [pngAt('safe1.png', 81), pngAt('safe2.png', 82)]);
  const kept = (await tiles(page)).map(x => x.id);
  T.check('two photos are displayed before the failure', kept.length === 2);

  /* Capture the draft's REAL id before the fault. `draft-ui-7` is the argument
     openReview passes; the id on the loaded draft comes from the fixture body,
     so comparing against the literal was the fixture's error, not the product's. */
  const draftIdBefore = await page.evaluate(() =>
    window._reviewState && window._reviewState.draft && window._reviewState.draft.draftId);
  T.check('the draft under test has a real id to compare against',
    typeof draftIdBefore === 'string' && draftIdBefore.length > 0, String(draftIdBefore));

  await page.evaluate(() => { window._photoStoreFaults = { abortBeforeCommit: true }; });
  await pick(page, [pngAt('doomed.png', 83)]);
  const st = await screenState(page);
  const t = await tiles(page);
  T.check('THE PREVIOUSLY DISPLAYED COLLECTION IS INTACT',
    JSON.stringify(t.map(x => x.id)) === JSON.stringify(kept), JSON.stringify(t.map(x => x.id)));
  T.check('every kept tile still shows its thumbnail', t.every(x => x.hasImg && !x.gone));
  T.check('the failure is shown', st.status.length > 0 && st.statusKind === 'error', JSON.stringify(st));
  /* WAS: `!/added/i && !/saved/i` on the whole status. That failed on correct
     behaviour -- the frozen failure copy is "...could not be saved..., so they
     were NOT ADDED", which contains both words as negations. A substring ban
     cannot tell a claim from its denial. Now it bans the two POSITIVE shapes:
     the added-count phrasing the success path emits, and an affirmative save
     claim. */
  T.check('NO saved confirmation appears beside the failure',
    !/Added \d+ photo/i.test(st.status)
    && !/\bphotos? (?:were|was|are|is) saved\b/i.test(st.status)
    && !/\bsaved to this browser\b/i.test(st.status), st.status);
  T.check('and the failure copy states the photos were NOT added',
    /were not added/i.test(st.status), st.status);
  T.check('the failure does not guess a cause',
    !/private|incognito|blocked|probably|likely/i.test(st.status), st.status);
  T.check('the empty line is not shown — the collection was not cleared', !st.emptyShown);

  /* Owner's photo-acceptance item 4 has TWO halves. The assertions above cover
     the displayed collection; these cover the draft itself and the shape of the
     retry, which were previously only implied. */
  const draftAfterFailure = await page.evaluate(() => {
    /* Read the surface the screen already exposes -- _reviewState is what the
       review view renders from -- rather than adding a test-only global to
       production, which the standing rules forbid. */
    const rs = window._reviewState || {};
    return {
      present: !!rs.draft,
      id: rs.draft && rs.draft.draftId,
      loading: rs.loading,
      errored: !!rs.error,
    };
  });
  T.check('ACCEPTANCE — the draft survives the attachment failure and is still the open draft',
    draftAfterFailure.present === true
    && draftAfterFailure.id === draftIdBefore
    && draftAfterFailure.loading === false
    && draftAfterFailure.errored === false,
    JSON.stringify(draftAfterFailure));

  await page.evaluate(() => { window._photoStoreFaults = null; });
  await pick(page, [pngAt('after.png', 84)]);
  T.check('the screen recovers and accepts the next add',
    (await tiles(page)).length === 3, String((await tiles(page)).length));
  const rec = await screenState(page);
  T.check('the error line is replaced, not appended to',
    rec.statusKind === 'ok' && /added 1 photo/i.test(rec.status), JSON.stringify(rec));
  /* This is the photo-only retry: the seller re-picks photos on the SAME draft
     and the add succeeds. There is no separate "retry photos" button, and none
     is claimed -- the affordance is that the picker stays available on the open
     draft while the draft and its earlier photos are untouched. Asserting what
     exists rather than what the wording might suggest. */
  const retryShape = await page.evaluate((expectId) => ({
    sameDraft: !!(window._reviewState && window._reviewState.draft
      && window._reviewState.draft.draftId === expectId),
    pickerAvailable: !!document.querySelector('[data-photo-block] input[type=file]'),
  }), draftIdBefore);
  T.check('ACCEPTANCE — the retry is photo-only: same draft, picker still available, no re-creation',
    retryShape.sameDraft === true && retryShape.pickerAvailable === true,
    JSON.stringify(retryShape));
  await ctx.close();
}

// ── 15. no upload, through the picker and every UI action ───────────────
{
  console.log('\n15. no upload through the actual UI actions');
  const ctx = await ctxWith();
  const page = await reviewPage(ctx);
  await openReview(page, 'draft-ui-8');
  await page.evaluate(() => new Promise(r => setTimeout(r, 800)));
  /* Scoped AFTER boot and the draft read, and covering every mutation the
     seller can perform — add, reorder, remove. A store that issues no
     requests says nothing about what its caller sends. */
  const sent = [];
  page.on('request', (req) => {
    const m = req.method();
    if (m === 'POST' || m === 'PUT' || m === 'PATCH') {
      let d = ''; try { d = req.postData() || ''; } catch (_) { d = '[unreadable]'; }
      sent.push({ url: req.url(), method: m, len: d.length, head: d.slice(0, 120) });
    }
  });
  await pick(page, [pngAt('u1.png', 91), pngAt('u2.png', 92)]);
  const ids = (await tiles(page)).map(x => x.id);
  await page.click(`[data-photo-item="${ids[1]}"] [data-photo-move="up"]`);
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  await page.click(`[data-photo-item="${ids[0]}"] [data-photo-remove]`);
  await page.evaluate(() => new Promise(r => setTimeout(r, 600)));

  T.check('add, reorder and remove sent NO request with a body',
    sent.every(x => x.len === 0), JSON.stringify(sent));
  T.check('no request went to an upload-shaped endpoint',
    !sent.some(x => /upload|photo|image|media|blob/i.test(x.url)), JSON.stringify(sent));
  T.check('no request body carries a picked filename',
    !sent.some(x => /u1\.png|u2\.png/.test(x.head)), JSON.stringify(sent));
  T.check('no request body carries base64 image bytes',
    !sent.some(x => /iVBORw0KGgo|data:image/.test(x.head)), JSON.stringify(sent));
  await ctx.close();
}

/* -- 16. two drafts side by side, reopened -------------------------------
 *
 * Will's correction 3: "test whether seller-uploaded IndexedDB photos remain
 * attached to the correct draft after reopening."
 *
 * Section 1 reloads with ONE draft in the store. That cannot detect a
 * mis-attachment: with a single draft, "returns this draft's photos" and
 * "returns every photo in the store" are the same answer, so an unfiltered
 * read would pass it. This section keeps two drafts with different photos and
 * asserts each reopen returns its OWN, by identity, by name and by bytes.
 */
{
  console.log('\n16. two drafts, reopened, each keeps its own photos');
  const ctx = await ctxWith();
  let page = await pageIn(ctx);

  const rA = await add(page, 'draft-mix-A', ['A1.png', 'A2.png']);
  const rB = await add(page, 'draft-mix-B', ['B1.png', 'B2.png', 'B3.png']);
  T.check('both drafts seeded', rA.ok && rB.ok, JSON.stringify({ rA, rB }));
  const idsA = rA.ok ? rA.res.added : [];
  const idsB = rB.ok ? rB.res.added : [];
  T.check('the two drafts were issued DISTINCT photo ids',
    idsA.length === 2 && idsB.length === 3 && !idsA.some(id => idsB.includes(id)),
    JSON.stringify({ idsA, idsB }));

  /* Reopen = a fresh page against the same origin storage, which is what the
     seller does when they come back to a draft later. */
  await page.close();
  page = await pageIn(ctx);

  const backA = await list(page, 'draft-mix-A');
  const backB = await list(page, 'draft-mix-B');

  T.check('A reopens with exactly its own two photos',
    JSON.stringify(backA.order) === JSON.stringify(idsA),
    JSON.stringify(backA.order) + ' vs ' + JSON.stringify(idsA));
  T.check('B reopens with exactly its own three photos',
    JSON.stringify(backB.order) === JSON.stringify(idsB),
    JSON.stringify(backB.order) + ' vs ' + JSON.stringify(idsB));
  T.check('A did NOT pick up B\u2019s photos',
    !backA.order.some(id => idsB.includes(id)), JSON.stringify(backA.order));
  T.check('B did NOT pick up A\u2019s photos',
    !backB.order.some(id => idsA.includes(id)), JSON.stringify(backB.order));
  T.check('A\u2019s filenames came back to A',
    backA.photos.map(p => p.name).join(',') === 'A1.png,A2.png',
    backA.photos.map(p => p.name).join(','));
  T.check('B\u2019s filenames came back to B',
    backB.photos.map(p => p.name).join(',') === 'B1.png,B2.png,B3.png',
    backB.photos.map(p => p.name).join(','));
  /* Names could match while the BYTES were swapped, so the blobs are checked
     too. Each file is built with a distinct trailing byte. */
  T.check('every reopened photo carries real bytes, not an empty shell',
    backA.photos.every(p => !p.missing && p.bytes > 0)
    && backB.photos.every(p => !p.missing && p.bytes > 0),
    JSON.stringify({ a: backA.photos, b: backB.photos }));

  /* A draft the seller never added to must come back EMPTY, not holding
     someone else's photos. This is the unfiltered-read check. */
  const backC = await list(page, 'draft-mix-C-never-touched');
  T.check('an untouched draft reopens EMPTY, not with the store\u2019s contents',
    backC.order.length === 0, JSON.stringify(backC.order));

  /* Removal must stay scoped too: deleting from A must not disturb B. */
  await page.evaluate(async (pid) => await window.photosRemove('draft-mix-A', pid), idsA[0]);
  const afterA = await list(page, 'draft-mix-A');
  const afterB = await list(page, 'draft-mix-B');
  T.check('removal from A left A with one photo', afterA.order.length === 1, JSON.stringify(afterA.order));
  T.check('removal from A did not touch B',
    JSON.stringify(afterB.order) === JSON.stringify(idsB), JSON.stringify(afterB.order));

  const raw = await rawCounts(page);
  T.check('the raw store holds both drafts as separate manifests',
    raw.manifest.length === 2
    && raw.manifest.some(m => m.draftId === 'draft-mix-A')
    && raw.manifest.some(m => m.draftId === 'draft-mix-B'),
    JSON.stringify(raw.manifest.map(m => m.draftId)));

  await ctx.close();
}

/* ── ACCEPTANCE: scan image -> Create Draft -> photo attached ──────────────
   
   HISTORY, so the change of meaning is not lost. On 2026-09-12 this slot held a
   MEASUREMENT: it asserted the manifest stayed EMPTY after a scan-created draft,
   which documented the defect. Those assertions have now been inverted on
   purpose, because the local attachment step has been built. A test that passes
   by observing an empty manifest documents a defect; acceptance has to require
   the CORRECT photo to be present. That is what follows.
   
   Everything below drives the real product functions in the real page. */
{
  const ctx = await ctxWith();
  const page = await pageIn(ctx);

  /* A 1x1 GIF, not a PNG. The MIME type must survive end to end, so the fixture
     deliberately is not the format the code might default to. */
  const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const scanRow = (instanceId) => ({
    cardName: 'Ivysaur', set: 'Mega Evolution', setCode: 'MEG',
    number: '134', rarity: 'Illustration Rare', game: 'pokemon',
    imageDataUrl: GIF, instanceId,
  });

  /* Stub only the two edges the sandbox cannot provide -- the auth token and
     the network. The create path itself, the snapshot, the conversion and the
     attachment are the real ones. Every POST body is recorded so the standing
     rule "seller photo bytes never reach the server" is checked against the
     actual request rather than assumed. */
  await page.evaluate(() => {
    window.__posts = [];
    window._crIdToken = async () => 'test-token';
    window.__nextDraftId = 'draft-scan-A';
    window.__failNetwork = false;
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const u = String(url || '');
      if (u.includes('/api/drafts') && opts && opts.method === 'POST') {
        window.__posts.push({ url: u, body: String(opts.body || '') });
        if (window.__failNetwork) throw new Error('network down');
        return new Response(
          JSON.stringify({ draftId: window.__nextDraftId, generation: 1 }),
          { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(url, opts);
    };
  });

  const created = await page.evaluate(async (row) => {
    const out = await window._crCreateDraft({
      card: row, instanceId: row.instanceId, idemKey: 'idem-A',
      price: 12.5, priceSource: 'comp', source: 'bulk-scan', batch: true,
    });
    const listed = await window.photosList('draft-scan-A');
    const p = listed.photos[0] || null;
    let bytes = null, type = null;
    if (p && p.blob) {
      type = p.blob.type;
      const buf = new Uint8Array(await p.blob.arrayBuffer());
      bytes = Array.from(buf.slice(0, 6)).map(b => String.fromCharCode(b)).join('');
    }
    return { ok: out.ok, draftId: out.draftId, photo: out.photo,
             count: listed.order.length, origin: p && p.origin, type, bytes,
             posts: window.__posts.length,
             postBody: window.__posts[0] ? window.__posts[0].body : '' };
  }, scanRow('inst-A'));

  T.check('ACCEPTANCE: creating a draft from a scan attaches exactly one photo',
    created.count === 1, JSON.stringify({ count: created.count, photo: created.photo }));
  T.check('ACCEPTANCE: the attached photo is the scan image, byte-identical at the header',
    created.bytes === 'GIF89a', `header=${JSON.stringify(created.bytes)}`);
  T.check('ACCEPTANCE: the original MIME type is preserved (not renamed to png)',
    created.type === 'image/gif', `type=${JSON.stringify(created.type)}`);
  T.check('ACCEPTANCE: the photo is marked as scan-sourced, so the UI can label it',
    created.origin === 'scan', `origin=${JSON.stringify(created.origin)}`);
  T.check('the create call reported the attachment on its result',
    created.photo && created.photo.attached === true, JSON.stringify(created.photo));

  /* Payload trace, not an assumption: the recorded request body is searched for
     the image itself. */
  /* Payload trace, not an assumption: the recorded request body is searched for
     the image itself.

     NOTE on how this check was arrived at. It first FAILED, and the fixture was
     the reason -- it handed `_crCreateDraft` a raw scan row, whereas the bulk
     caller hands it `_bulkScanRowToCard(row)`, which drops image bytes on
     purpose. Rather than only correcting the fixture, the boundary was defended
     too, because the guarantee had rested entirely on each caller remembering to
     strip. Both layers are now asserted separately below. */
  T.check('seller photo bytes stay OUT of the POST /api/drafts body',
    created.posts === 1
      && !created.postBody.includes('R0lGODlh')
      && !created.postBody.includes('data:image'),
    `postBytes=${created.postBody.length} containsImage=${created.postBody.includes('R0lGODlh')}`);

  /* Layer 1: the mapper the bulk path actually uses drops the bytes. */
  const mapped = await page.evaluate((row) => {
    const fn = window._bulkScanRowToCard;
    if (typeof fn !== 'function') return { absent: true };
    const c = fn(row);
    return { absent: false, json: JSON.stringify(c) };
  }, scanRow('inst-M'));
  T.check('the bulk mapper does not carry image bytes into the card payload',
    mapped.absent === true || !mapped.json.includes('R0lGODlh'),
    JSON.stringify(mapped).slice(0, 300));

  /* Layer 2: even a caller that forgets cannot put bytes on the wire. */
  const stripped = await page.evaluate(() => {
    const c = window._cardWithoutPhotoBytes({
      card: 'Ivysaur',
      imageDataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAA',
      blobRef: 'blob:https://x/y',
      imageUrl: 'https://images.pokemontcg.io/me1/134.png',
    });
    return { json: JSON.stringify(c), keptUrl: c.imageUrl, name: c.card };
  });
  T.check('the request boundary strips data:/blob: values from the card',
    !stripped.json.includes('R0lGODlh') && !stripped.json.includes('blob:'),
    stripped.json);
  T.check('and it keeps reference artwork URLs and ordinary fields intact',
    stripped.keptUrl === 'https://images.pokemontcg.io/me1/134.png'
      && stripped.name === 'Ivysaur', stripped.json);

  /* ── Simultaneous attempts ───────────────────────────────────────────────
     Two attachments of the same source fired without awaiting between them.
     This is the case the earlier list-then-add proposal got wrong. */
  const concurrent = await page.evaluate(async () => {
    const blobOf = () => window._dataUrlToBlob(
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
    const src = () => ({ sourceKey: 'scan:inst-C', blob: blobOf(), name: 'scan-photo' });
    const [a, b] = await Promise.all([
      window.photosAttachScan('draft-scan-C', src()),
      window.photosAttachScan('draft-scan-C', src()),
    ]);
    const listed = await window.photosList('draft-scan-C');
    return { a, b, count: listed.order.length };
  });
  T.check('ACCEPTANCE: two simultaneous attachments produce exactly ONE photo',
    concurrent.count === 1, JSON.stringify(concurrent));
  T.check('exactly one of the two simultaneous attempts reports attaching',
    (concurrent.a.attached ? 1 : 0) + (concurrent.b.attached ? 1 : 0) === 1,
    JSON.stringify({ a: concurrent.a, b: concurrent.b }));
  T.check('the attempt that declined says why, and is not an error',
    (concurrent.a.attached ? concurrent.b.reason : concurrent.a.reason) === 'ALREADY_ATTACHED',
    JSON.stringify({ a: concurrent.a, b: concurrent.b }));

  /* ── Interrupted creation, then replay ───────────────────────────────────
     The first attempt fails at the network. The second replays the same
     idempotency key and succeeds. One photo must result, not two. */
  const replay = await page.evaluate(async (row) => {
    window.__nextDraftId = 'draft-scan-B';
    window.__failNetwork = true;
    let firstErr = null;
    try {
      await window._crCreateDraft({ card: row, instanceId: row.instanceId, idemKey: 'idem-B',
        price: 5, priceSource: 'comp', source: 'bulk-scan', batch: true });
    } catch (e) { firstErr = e.message; }
    window.__failNetwork = false;
    const second = await window._crCreateDraft({ card: row, instanceId: row.instanceId,
      idemKey: 'idem-B', price: 5, priceSource: 'comp', source: 'bulk-scan', batch: true });
    const third = await window._crCreateDraft({ card: row, instanceId: row.instanceId,
      idemKey: 'idem-B', price: 5, priceSource: 'comp', source: 'bulk-scan', batch: true });
    const listed = await window.photosList('draft-scan-B');
    return { firstErr, second: second.photo, third: third.photo, count: listed.order.length };
  }, scanRow('inst-B'));
  T.check('ACCEPTANCE: interrupted creation then replay leaves exactly ONE photo',
    replay.count === 1, JSON.stringify(replay));
  T.check('a further replay declines rather than attaching a second copy',
    replay.third && replay.third.attached === false
      && replay.third.reason === 'ALREADY_ATTACHED', JSON.stringify(replay.third));

  /* ── Deliberate removal survives a retry ─────────────────────────────────
     The seller deletes the auto-attached photo. Retrying creation must not
     bring it back. */
  const removal = await page.evaluate(async (row) => {
    const before = await window.photosList('draft-scan-B');
    await window.photosRemove('draft-scan-B', before.order[0]);
    const afterRemove = await window.photosList('draft-scan-B');
    const retry = await window._crCreateDraft({ card: row, instanceId: row.instanceId,
      idemKey: 'idem-B', price: 5, priceSource: 'comp', source: 'bulk-scan', batch: true });
    const afterRetry = await window.photosList('draft-scan-B');
    return { removed: afterRemove.order.length, retry: retry.photo,
             after: afterRetry.order.length };
  }, scanRow('inst-B'));
  T.check('the seller can remove the auto-attached photo',
    removal.removed === 0, JSON.stringify(removal));
  T.check('ACCEPTANCE: retrying creation does NOT restore a photo the seller deleted',
    removal.after === 0, JSON.stringify(removal));
  T.check('and the retry says the seller removed it, rather than failing silently',
    removal.retry && removal.retry.reason === 'REMOVED_BY_SELLER',
    JSON.stringify(removal.retry));

  /* The ledger must survive the OTHER manifest writers.
     
     Found by mutation, not by inspection: making `photosAdd` and `photosMove`
     write `{draftId, order}` without the ledger left the whole suite green,
     because nothing exercised an add or a move BETWEEN the removal and the
     retry. That is the silent-omission class -- the removal record is quietly
     erased and the next retry restores a photo the seller deleted. */
  const ledgerSurvives = await page.evaluate(async (row) => {
    // Seller deleted the scan photo above; now they add their own and reorder.
     const f = new File([new Uint8Array([1, 2, 3])], 'mine.png', { type: 'image/png' });
    const g = new File([new Uint8Array([4, 5, 6])], 'mine2.png', { type: 'image/png' });
    await window.photosAdd('draft-scan-B', [f, g]);
    await window.photosMove('draft-scan-B', (await window.photosList('draft-scan-B')).order[0], 'down');
    const retry = await window._crCreateDraft({ card: row, instanceId: row.instanceId,
      idemKey: 'idem-B', price: 5, priceSource: 'comp', source: 'bulk-scan', batch: true });
    const listed = await window.photosList('draft-scan-B');
    const origins = listed.photos.map(p => p.origin);
    return { retry: retry.photo, count: listed.order.length, origins };
  }, scanRow('inst-B'));
  T.check('adding and reordering the seller\u2019s own photos does not erase the attach ledger',
    ledgerSurvives.retry && ledgerSurvives.retry.reason === 'REMOVED_BY_SELLER',
    JSON.stringify(ledgerSurvives));
  T.check('so the deleted scan photo is still NOT restored, and only seller photos remain',
    ledgerSurvives.count === 2 && !ledgerSurvives.origins.includes('scan'),
    JSON.stringify(ledgerSurvives));

  /* ── Reopening the correct draft ─────────────────────────────────────────
     A fresh page load. Draft A still has its photo; the unrelated draft has
     none. A photo attached to the wrong draft would show up here. */
  const page2 = await ctx.newPage();
  await page2.goto(page.url(), { waitUntil: 'domcontentloaded' });
  await page2.waitForFunction(() => typeof window.photosList === 'function', { timeout: 15000 });
  const reopened = await page2.evaluate(async () => {
    const a = await window.photosList('draft-scan-A');
    const other = await window.photosList('draft-unrelated');
    const pa = a.photos[0] || null;
    return { a: a.order.length, aOrigin: pa && pa.origin, other: other.order.length };
  });
  T.check('ACCEPTANCE: reopening shows the scan photo on the draft that owns it',
    reopened.a === 1 && reopened.aOrigin === 'scan', JSON.stringify(reopened));
  T.check('and an unrelated draft did not receive it',
    reopened.other === 0, JSON.stringify(reopened));

  /* A rescan mid-create must not swap the photograph: the snapshot is taken
     from the row at call time, so a later mutation of the row cannot reach it. */
  const snapshotStable = await page2.evaluate(() => {
    const row = { instanceId: 'inst-D', imageDataUrl:
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' };
    const snap = window._scanPhotoSnapshot(row, 'inst-D');
    row.imageDataUrl = 'data:image/png;base64,DIFFERENTCARD';
    return { key: snap.sourceKey, type: snap.type,
             stillOriginal: snap.dataUrl.includes('R0lGODlh') };
  });
  T.check('the snapshot holds image and identity together, immune to a later rescan',
    snapshotStable.stillOriginal === true && snapshotStable.key === 'scan:inst-D'
      && snapshotStable.type === 'image/gif', JSON.stringify(snapshotStable));

  /* Catalogue artwork is still refused as a listing photo. */
  const artwork = await page2.evaluate(() => {
    const s = window._scanPhotoSnapshot(
      { instanceId: 'inst-E', imageUrl: 'https://images.pokemontcg.io/me1/134.png' }, 'inst-E');
    return { snap: s };
  });
  T.check('catalogue artwork is never snapshotted as the seller\u2019s photograph',
    artwork.snap === null, JSON.stringify(artwork));

  T.check('the scan-photo label is distinct from the reference-artwork label',
    await page2.evaluate(() => window.SCAN_PHOTO_LABEL === 'Scan photo'
      && window.SCAN_PHOTO_LABEL !== window.REVIEW_REFERENCE_LABEL), 'labels');

  await ctx.close();
}

await browser.close();
server.close();
T.done();
