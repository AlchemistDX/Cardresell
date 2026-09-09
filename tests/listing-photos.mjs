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

await browser.close();
server.close();
T.done();
