/**
 * tests/entry-identity.mjs — collection entry identity, in a real browser.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every collection entry id was minted as
 * `Date.now() + added + Math.floor(Math.random() * 1000)`. Saving several copies
 * inside one millisecond relied on a 1-in-1000 draw per copy to stay distinct,
 * and the id is the lookup key in dozens of places, so a duplicate meant editing
 * one copy edited a sibling and deleting one deleted the wrong row.
 *
 * THE MEASUREMENT IS NOT THE ACCEPTANCE. The first scenario below reproduces the
 * OLD generator's collision under a frozen clock and a controlled random source.
 * It is labelled DEFECT MEASUREMENT and it asserts the collision, because a test
 * that passes by observing the broken behaviour documents a defect and does not
 * accept a fix. Every scenario after it is ACCEPTANCE and requires the corrected
 * behaviour.
 *
 * WHY NOT max(existing id) + 1. Two devices holding the same synced collection
 * compute the same next id deterministically, so `_unionById` -- which keys on
 * String(id) -- silently collapses two different cards into one. The two-device
 * scenario runs that merge rather than arguing about it.
 *
 * WHAT UUIDs DO NOT FIX. A UUID makes accidental collision negligible; it does
 * not make merging, tombstoning, or sibling integrity correct. Those are
 * separate scenarios below and are asserted independently.
 *
 * Determinism: no scenario depends on wall-clock timing or on real entropy for
 * its verdict. `Date.now` is frozen and `crypto.getRandomValues` is replaced with
 * a counter where the point is that ids collide or do not. The real
 * `crypto.randomUUID` is exercised separately, where the assertion is about
 * shape and distinctness rather than a specific value.
 *
 * NOT REGISTERED in audit/RELEASE_VALIDATION_QUEUE.md yet -- recorded as an open
 * item, same as listing-photos.mjs. Written down rather than left to be noticed.
 *
 * Run: node tests/entry-identity.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = '/home/user/node_modules/playwright/index.js';
const T = harness('entry-identity');

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

/* One context per scenario = one origin's storage. Two PAGES in one context
   share localStorage, which is what makes the two-tab scenario real rather
   than two independent simulations. */
async function ctxWith() {
  return browser.newContext({ viewport: { width: 1100, height: 800 } });
}
async function pageIn(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('  [pageerror] ' + e.message); });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window._crNewEntryId === 'function', { timeout: 15000 });
  return page;
}

/* ── DEFECT MEASUREMENT ─────────────────────────────────────────────────────
   
   Reproduces the OLD generator under a frozen clock and a random source that
   returns the same draw. This scenario PASSES by observing the collision. It is
   evidence the defect was real; it is NOT evidence the fix works. */
await T.section('DEFECT MEASUREMENT — the old generator collides (not an acceptance)', async () => {
  const ctx = await ctxWith();
  const page = await pageIn(ctx);

  const collided = await page.evaluate(() => {
    // Verbatim shape of the replaced expression, js/ui.*.js _bulkSaveToCollection.
    const NOW = 1757000000000;
    const oldGen = (added, rnd) => NOW + added + Math.floor(rnd * 1000);
    // Three copies of one card inside one millisecond. `added` is the running
    // count of rows appended in this save, so it does distinguish copies within
    // a single save -- the collision this measures is across CONCURRENT saves,
    // where two callers each start from their own `added`.
    const tabA = [0, 1, 2].map(i => oldGen(i, 0.5));
    const tabB = [0, 1, 2].map(i => oldGen(i, 0.5));
    const all = tabA.concat(tabB);
    return { distinct: new Set(all).size, total: all.length, sample: all.slice(0, 4) };
  });
  T.check('two concurrent saves in the same millisecond produced overlapping ids',
    collided.distinct < collided.total,
    `distinct=${collided.distinct} of ${collided.total} — ${JSON.stringify(collided.sample)}`);
  T.check('   (this documents the defect; the acceptance scenarios follow)', true, '');
  await ctx.close();
});

/* ── ACCEPTANCE: the generator ──────────────────────────────────────────── */
await T.section('ACCEPTANCE — new ids are distinct even with the clock frozen', async () => {
  const ctx = await ctxWith();
  const page = await pageIn(ctx);

  const gen = await page.evaluate(() => {
    // Freeze the clock. Any generator that leans on Date.now() for uniqueness
    // now has nothing to lean on.
    const realNow = Date.now;
    Date.now = () => 1757000000000;
    try {
      const ids = [];
      for (let i = 0; i < 500; i++) ids.push(window._crNewEntryId());
      return {
        distinct: new Set(ids).size,
        total: ids.length,
        allStrings: ids.every(x => typeof x === 'string'),
        // v4 UUID shape, so the value is not silently a timestamp again.
        uuidShaped: ids.every(x => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x)),
        sample: ids[0],
      };
    } finally { Date.now = realNow; }
  });
  T.check('500 ids minted with a frozen clock are all distinct',
    gen.distinct === gen.total, `distinct=${gen.distinct} of ${gen.total}`);
  T.check('every new id is a string', gen.allStrings, JSON.stringify(gen.sample));
  T.check('and a v4 UUID, so uniqueness does not rest on the clock',
    gen.uuidShaped, JSON.stringify(gen.sample));

  /* The fallback matters: it runs on any browser without crypto.randomUUID, and
     if it degraded to the old millisecond scheme the fix would be void there. */
  const fb = await page.evaluate(() => {
    const realNow = Date.now, realCrypto = window.crypto;
    Date.now = () => 1757000000000;
    try {
      // Remove randomUUID but keep getRandomValues: the first fallback tier.
      Object.defineProperty(window, 'crypto', {
        value: { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) },
        configurable: true,
      });
      const ids = [];
      for (let i = 0; i < 200; i++) ids.push(window._crNewEntryId());
      return { distinct: new Set(ids).size, total: ids.length,
               uuidShaped: ids.every(x => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x)) };
    } finally {
      Object.defineProperty(window, 'crypto', { value: realCrypto, configurable: true });
      Date.now = realNow;
    }
  });
  T.check('without crypto.randomUUID the getRandomValues fallback still yields distinct v4 ids',
    fb.distinct === fb.total && fb.uuidShaped, JSON.stringify(fb));
  await ctx.close();
});

/* ── ACCEPTANCE: legacy ids are never touched ───────────────────────────── */
await T.section('ACCEPTANCE — existing numeric ids survive unchanged', async () => {
  const ctx = await ctxWith();
  const page = await pageIn(ctx);

  const legacy = await page.evaluate(() => {
    const key = window.getUserKey('portfolio');
    // A collection saved by an older build: bare integer ids.
    const before = [
      { id: 1757000000001, card: 'Pikachu',  set: 'Base', buyPrice: 1, updatedAt: 1 },
      { id: 1757000000002, card: 'Squirtle', set: 'Base', buyPrice: 2, updatedAt: 1 },
    ];
    localStorage.setItem(key, JSON.stringify(before));
    const read = window.loadPortData();
    return {
      ids: read.map(r => r.id),
      types: read.map(r => typeof r.id),
    };
  });
  T.check('a stored numeric id is read back as the same number, not renumbered',
    JSON.stringify(legacy.ids) === JSON.stringify([1757000000001, 1757000000002]),
    JSON.stringify(legacy));
  T.check('and is still a number, so nothing was silently rewritten',
    legacy.types.every(t => t === 'number'), JSON.stringify(legacy.types));

  /* The compatibility crux. A legacy row holds the NUMBER 1757000000001; a DOM
     data attribute can only carry the STRING '1757000000001'. Before
     centralisation, `x.id === id` was false there and the row action silently
     did nothing. */
  const eq = await page.evaluate(() => ({
    numVsString: window._crIdEq(1757000000001, '1757000000001'),
    stringVsNum: window._crIdEq('1757000000001', 1757000000001),
    uuidSelf:    window._crIdEq('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'),
    different:   window._crIdEq(1757000000001, 1757000000002),
    uuidVsOther: window._crIdEq('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', 'ffffffff-e5f6-4a7b-8c9d-0e1f2a3b4c5d'),
    nullLeft:    window._crIdEq(null, '1'),
    nullRight:   window._crIdEq('1', undefined),
    bothNull:    window._crIdEq(null, null),
  }));
  T.check('a legacy number matches its own string form, in both argument orders',
    eq.numVsString === true && eq.stringVsNum === true, JSON.stringify(eq));
  T.check('a UUID matches itself', eq.uuidSelf === true, JSON.stringify(eq));
  T.check('different ids still do not match', eq.different === false && eq.uuidVsOther === false,
    JSON.stringify(eq));
  T.check('a missing id never matches anything, including another missing id',
    eq.nullLeft === false && eq.nullRight === false && eq.bothNull === false,
    JSON.stringify(eq));
  await ctx.close();
});

/* ── ACCEPTANCE: row actions, legacy and new ────────────────────────────── */
await T.section('ACCEPTANCE — row actions reach the right entry, legacy and UUID', async () => {
  const ctx = await ctxWith();
  const page = await pageIn(ctx);

  /* Deleting through the REAL delete path, dispatching a REAL click on markup
     the app rendered, is the only way to prove the handler conversion works.
     Calling deletePortEntry() directly would skip the part that broke. */
  const acted = await page.evaluate(async () => {
    const key = window.getUserKey('portfolio');
    const rows = [
      { id: 1757000000001, card: 'Legacy One', set: 'Base', buyPrice: 1, updatedAt: 1 },
      { id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', card: 'New One', set: 'Base', buyPrice: 2, updatedAt: 1 },
      { id: 1757000000003, card: 'Legacy Two', set: 'Base', buyPrice: 3, updatedAt: 1 },
    ];
    localStorage.setItem(key, JSON.stringify(rows));

    // Stub confirm so the delete path is not blocked by a modal.
    window.confirm = () => true;

    const out = {};
    // Build the same markup the renderer emits, then click it for real.
    const host = document.createElement('div');
    host.innerHTML = `
      <button data-entry-act="port-delete" data-entry-id="1757000000001">x</button>
      <button data-entry-act="port-delete" data-entry-id="a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d">x</button>`;
    document.body.appendChild(host);

    host.children[0].click();
    await new Promise(r => setTimeout(r, 50));
    out.afterLegacyDelete = JSON.parse(localStorage.getItem(key)).map(r => String(r.id));

    host.children[1].click();
    await new Promise(r => setTimeout(r, 50));
    out.afterUuidDelete = JSON.parse(localStorage.getItem(key)).map(r => String(r.id));

    host.remove();
    return out;
  });
  T.check('clicking delete on a LEGACY numeric row removes exactly that row',
    JSON.stringify(acted.afterLegacyDelete) === JSON.stringify(['a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', '1757000000003']),
    JSON.stringify(acted));
  T.check('clicking delete on a UUID row removes exactly that row',
    JSON.stringify(acted.afterUuidDelete) === JSON.stringify(['1757000000003']),
    JSON.stringify(acted));

  /* The row is itself clickable (it opens a detail view). A click on a button
     INSIDE the row must not also open the detail view -- the behaviour the
     replaced markup got from an inline event.stopPropagation(). */
  const nested = await page.evaluate(async () => {
    localStorage.setItem(window.getUserKey('portfolio'), JSON.stringify([
      { id: 'u-1', card: 'Nested', set: 'Base', buyPrice: 1, updatedAt: 1 },
    ]));
    window.confirm = () => true;
    let opened = 0;
    const realOpen = window.openCollectionCardDetail;
    window.openCollectionCardDetail = () => { opened++; };
    const host = document.createElement('div');
    host.innerHTML = `
      <table><tbody>
        <tr data-entry-act="open-card" data-entry-id="u-1">
          <td><button data-entry-act="port-delete" data-entry-id="u-1">x</button></td>
        </tr>
      </tbody></table>`;
    document.body.appendChild(host);
    host.querySelector('button').click();
    await new Promise(r => setTimeout(r, 50));
    const afterButton = { opened, rows: JSON.parse(localStorage.getItem(window.getUserKey('portfolio'))).length };
    host.remove();
    window.openCollectionCardDetail = realOpen;
    return afterButton;
  });
  T.check('a delete button inside a clickable row deletes without opening the row',
    nested.opened === 0 && nested.rows === 0, JSON.stringify(nested));

  /* The REAL save path, not the generator in isolation.
     
     Found by mutation: reverting `_bulkSaveToCollection` to the old
     `Date.now() + added + Math.floor(Math.random() * 1000)` left the suite green,
     because every earlier scenario called `_crNewEntryId()` directly. The
     generator being correct is not the same claim as the save path using it. */
  const savePath = await page.evaluate(() => {
    const key = window.getUserKey('portfolio');
    localStorage.setItem(key, '[]');
    const realNow = Date.now;
    Date.now = () => 1757000000000;   // every copy "saved" in one millisecond
    try {
      // Two scan rows, one of them with qty 3, so the save appends four rows in
      // a single call -- the case the old scheme fumbled.
      window._bulkSaveToCollection(
        [{ name: 'Charizard', set: { name: 'Base Set' }, number: '4', qty: 3, marketPrice: 200 },
         { name: 'Blastoise', set: { name: 'Base Set' }, number: '2', qty: 1, marketPrice: 90 }],
        [100, 50], false,
      );
    } finally { Date.now = realNow; }
    const rows = JSON.parse(localStorage.getItem(key));
    const ids = rows.map(r => r.id);
    return {
      count: rows.length,
      distinct: new Set(ids).size,
      allStrings: ids.every(x => typeof x === 'string'),
      uuidShaped: ids.every(x => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x)),
      sample: ids[0],
    };
  });
  T.check('the real bulk save writes four rows for qty 3 + qty 1',
    savePath.count === 4, JSON.stringify(savePath));
  T.check('and every id it minted is distinct despite the frozen clock',
    savePath.distinct === 4, JSON.stringify(savePath));
  T.check('and the save path uses the UUID generator, not a timestamp scheme',
    savePath.allStrings && savePath.uuidShaped, JSON.stringify(savePath));

  /* ── THE DETERMINISTIC SAME-SAVE COLLISION ────────────────────────────────
     
     A previous version of this packet claimed the old scheme could not collide
     WITHIN one save, because `added` increments per copy. That was wrong, and
     the owner supplied the counterexample. For
     
         Date.now() + added + Math.floor(Math.random() * 1000)
     
     with the clock frozen at T, copy 0 draws added=0 and copy 1 draws added=1
     (`added++` runs AFTER the id is minted, js/ui.*.js). So:
     
         copy 0: T + 0 + 1  = T+1
         copy 1: T + 1 + 0  = T+1
     
     The offset does not guarantee uniqueness; it only shifts the draw. Any two
     copies i<j collide whenever their random contributions differ by exactly
     j-i, which for adjacent copies is a 999-in-a-million draw per pair -- rare,
     not impossible, and it was reported as impossible.
     
     So this drives the REAL save with Math.random scripted to produce exactly
     that pair. The assertion is DISTINCTNESS, not id format: reverting the
     generator must fail this, and it must fail for the collision itself rather
     than for the shape of the value. */
  const deterministic = await page.evaluate(() => {
    const key = window.getUserKey('portfolio');
    localStorage.setItem(key, '[]');
    const realNow = Date.now, realRandom = Math.random;
    Date.now = () => 1757000000000;
    // floor(0.001 * 1000) === 1, then floor(0.0 * 1000) === 0.
    const draws = [0.001, 0.0];
    let i = 0;
    Math.random = () => (i < draws.length ? draws[i++] : 0);
    try {
      window._bulkSaveToCollection(
        [{ name: 'Charizard', set: { name: 'Base Set' }, number: '4', qty: 2, marketPrice: 200 }],
        [100], false,
      );
    } finally { Date.now = realNow; Math.random = realRandom; }
    const rows = JSON.parse(localStorage.getItem(key));
    const ids = rows.map(r => r.id);
    return {
      count: rows.length,
      ids,
      distinct: new Set(ids).size,
      // What the OLD expression would have produced from these same draws.
      wouldHaveBeen: [1757000000000 + 0 + 1, 1757000000000 + 1 + 0],
    };
  });
  T.check('the deterministic collision pair writes two rows',
    deterministic.count === 2, JSON.stringify(deterministic));
  T.check('ACCEPTANCE — two copies saved at a frozen clock with the colliding random draws still get DISTINCT ids',
    deterministic.distinct === 2, JSON.stringify(deterministic));
  T.check('DEFECT MEASUREMENT — those same draws would have produced one id twice under the old expression',
    deterministic.wouldHaveBeen[0] === deterministic.wouldHaveBeen[1],
    JSON.stringify(deterministic.wouldHaveBeen));

  /* ── REFUSAL, AND THE SELLER'S WORK ──────────────────────────────────────
     
     Owner direction (Q-ID-2): remove the permissive Math.random fallback. If
     neither crypto method is available, stop the save with a clear error while
     preserving the scan, form inputs and photographs for retry.
     
     So: crypto is removed entirely, a batch save is attempted, and the
     assertions are that it REFUSED, that it wrote NOTHING, and that the inputs
     it would have consumed are still present. */
  const refusal = await page.evaluate(() => {
    const key = window.getUserKey('portfolio');
    const before = [{ id: 1757000000001, card: 'Pre-existing', buyPrice: 1, updatedAt: 1 }];
    localStorage.setItem(key, JSON.stringify(before));

    // Stand in for the seller's in-progress work.
    window._bulkRows = [
      { name: 'Charizard', set: { name: 'Base Set' }, number: '4', qty: 2, marketPrice: 200,
        imageDataUrl: 'data:image/jpeg;base64,AAAA' },
    ];
    window._bulkSaved = false;
    const toasts = [];
    const realToast = window.showToast;
    window.showToast = (m, k) => { toasts.push({ m: String(m), k }); };

    // Remove BOTH crypto paths. `crypto` is non-writable on window in Chromium,
    // so shadow it on the scope the bundle actually resolves through.
    const realCrypto = window.crypto;
    let removed = false;
    try {
      Object.defineProperty(window, 'crypto', { value: undefined, configurable: true });
      removed = (typeof window.crypto === 'undefined');
    } catch (_) { removed = false; }

    let threw = null, returned;
    try {
      returned = window._bulkSaveToCollection(window._bulkRows, [100], false);
    } catch (e) { threw = String(e && e.message || e); }

    try { Object.defineProperty(window, 'crypto', { value: realCrypto, configurable: true }); } catch (_) {}
    window.showToast = realToast;

    const after = JSON.parse(localStorage.getItem(key) || '[]');
    return {
      removed,
      threw,
      rowsAfter: after.length,
      idsAfter: after.map(r => r.id),
      untouched: JSON.stringify(after) === JSON.stringify(before),
      toasts,
      // The seller's work, as it stands after the refusal.
      scanRowsKept: Array.isArray(window._bulkRows) && window._bulkRows.length === 1,
      photoBytesKept: !!(window._bulkRows && window._bulkRows[0]
        && String(window._bulkRows[0].imageDataUrl || '').startsWith('data:')),
      notMarkedSaved: window._bulkSaved === false,
    };
  });
  T.check('the no-crypto condition was actually established (otherwise the rest proves nothing)',
    refusal.removed === true, JSON.stringify(refusal));
  T.check('ACCEPTANCE — a save with no secure id available writes NOTHING',
    refusal.rowsAfter === 1 && refusal.untouched === true, JSON.stringify(refusal));
  T.check('ACCEPTANCE — it does not throw at the seller; it reports and returns',
    refusal.threw === null, JSON.stringify(refusal));
  /* Copy revised 2026-09-12 on owner direction: the scan screen is the ONE
     surface where 'your scanned rows and photos are still here' is established
     by test rather than assumed, so it gets its own sentence. The generic
     sentence must NOT appear here, and neither may the withdrawn promise that
     another browser would carry this work across. */
  T.check('ACCEPTANCE — the seller is told, once, in one sentence',
    refusal.toasts.length === 1 && refusal.toasts[0].k === 'error'
      && /can\u2019t create a card ID/i.test(refusal.toasts[0].m),
    JSON.stringify(refusal.toasts));
  T.check('ACCEPTANCE — the scan screen gets the scan-specific wording, naming rows and photos',
    refusal.toasts.length === 1
      && /scanned rows and photos are still on this page/i.test(refusal.toasts[0].m),
    JSON.stringify(refusal.toasts));
  T.check('and it does NOT promise another browser will carry the unsaved work across',
    refusal.toasts.length === 1
      && !/up-to-date browser|another browser|open CardResell in/i.test(refusal.toasts[0].m),
    JSON.stringify(refusal.toasts));
  T.check('ACCEPTANCE — the scan rows and the photo bytes survive for retry',
    refusal.scanRowsKept && refusal.photoBytesKept, JSON.stringify(refusal));
  T.check('ACCEPTANCE — the batch is not marked saved, so the retry affordance stays',
    refusal.notMarkedSaved === true, JSON.stringify(refusal));

  /* And the refusal must be distinguishable from an unrelated bug. A guard that
     swallows every exception turns a real defect into a silent no-op, which is
     the failure mode Rule 2 names. */
  const propagates = await page.evaluate(() => {
    let sawOther = false;
    try {
      window._crGuardMint(() => { throw new Error('something else entirely'); });
    } catch (e) { sawOther = /something else entirely/.test(String(e.message)); }
    const refusedReturn = window._crGuardMint(() => {
      const err = new Error('x'); err.crNoSecureId = true; throw err;
    });
    return { sawOther, refusedReturn };
  });
  T.check('ACCEPTANCE — an unrelated exception still propagates through the mint guard',
    propagates.sawOther === true, JSON.stringify(propagates));
  T.check('ACCEPTANCE — only the tagged refusal is converted into a false return',
    propagates.refusedReturn === false, JSON.stringify(propagates));

  /* No Math.random path may remain in the generator. The owner asked for the
     fallback REMOVED, not narrowed, so its absence is asserted at source. */
  const noFallback = await page.evaluate(async () => {
    const names = Array.from(document.querySelectorAll('script[src]')).map(s => s.getAttribute('src'));
    const texts = await Promise.all(names.map(n => fetch(n).then(r => r.text())));
    const joined = texts.join('\n');
    const i = joined.indexOf('function _crNewEntryId()');
    // Brace-match the real body rather than slicing a fixed window, which
    // spilled into neighbouring functions.
    let body = '';
    if (i !== -1) {
      let depth = 0, j = joined.indexOf('{', i);
      for (let k = j; k < joined.length; k++) {
        if (joined[k] === '{') depth++;
        else if (joined[k] === '}') { depth--; if (depth === 0) { body = joined.slice(i, k + 1); break; } }
      }
    }
    /* Strip comments before asserting. The generator's comments DISCUSS
       Math.random -- they are what explain why it is not used -- and an earlier
       version of this check fired on that prose. The fix is to test code rather
       than to special-case the wording: a detector that has to be taught to
       ignore particular sentences is a detector that can be talked out of
       firing. Stripping comments is a general transformation, not an exemption. */
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    return {
      found: i !== -1,
      bodyChars: body.length,
      codeChars: code.length,
      usesMathRandom: /Math\.random/.test(code),
      hasEidPrefix: /'eid-'|"eid-"/.test(code),
      throwsTagged: /crNoSecureId\s*=\s*true/.test(code),
    };
  });
  T.check('the generator carries no Math.random fallback and no eid- last resort',
    noFallback.found && !noFallback.usesMathRandom && !noFallback.hasEidPrefix,
    JSON.stringify(noFallback));
  T.check('and it refuses with the tagged error instead',
    noFallback.throwsTagged === true, JSON.stringify(noFallback));

  /* ── 123 AND "123" AS SEPARATE ROWS ──────────────────────────────────────
     
     Owner correction 2. An earlier packet claimed no stored entry can have a
     numeric-STRING id, reasoning from the five generators. That does not follow:
     imports, restores, sync, earlier versions of the app and manual data edits
     could all have introduced one, and none of those are visible from the
     generators. The defensible claim is narrower and is what this file now
     records:
     
       the inspected generators produced numeric ids, and the existing merge
       function already normalises ids to strings.
     
     That supports aligning LOOKUP with MERGE, which is what _crIdEq does. It
     does not establish a complete production-data history.
     
     So this scenario MEASURES what the shipped code does with such a pair
     instead of asserting what it should. It does not repair the data. The
     finding is documented in the packet, not fixed here, because collapsing or
     renumbering these rows is exactly the silent renumbering the owner
     prohibited. */
  const mixed = await page.evaluate(() => {
    const key = window.getUserKey('portfolio');
    const rows = [
      { id: 123,   card: 'Numeric row', buyPrice: 1, currentValue: 10, updatedAt: 1000 },
      { id: '123', card: 'String row',  buyPrice: 2, currentValue: 20, updatedAt: 2000 },
      { id: 999,   card: 'Bystander',   buyPrice: 3, currentValue: 30, updatedAt: 3000 },
    ];
    localStorage.setItem(key, JSON.stringify(rows));

    const read = JSON.parse(localStorage.getItem(key));
    // 1. Storage keeps both, with their types intact.
    const bothStored = read.length === 3
      && typeof read[0].id === 'number' && typeof read[1].id === 'string';

    // 2. What does the ONE comparison say about them?
    const eq = window._crIdEq(123, '123');

    // 3. What does a lookup find? (`find` returns the FIRST match.)
    const found = read.find(r => window._crIdEq(r.id, '123'));

    // 4. What does the merge function -- which behaved this way BEFORE this
    //    change -- do when the two rows meet?
    const merged = window._unionById(read, []);

    return {
      bothStored,
      idEqSaysSame: eq,
      lookupFinds: found ? found.card : null,
      mergedCount: merged.length,
      mergedCards: merged.map(r => r.card),
      survivor: merged.filter(r => window._crIdEq(r.id, 123)).map(r => r.card),
    };
  });
  T.check('MEASUREMENT — storage holds 123 and "123" as two rows, types intact',
    mixed.bothStored === true, JSON.stringify(mixed));
  T.check('MEASUREMENT — _crIdEq treats 123 and "123" as the SAME entry',
    mixed.idEqSaysSame === true, JSON.stringify(mixed));
  T.check('MEASUREMENT — a lookup therefore resolves to the FIRST of the pair, shadowing the second',
    mixed.lookupFinds === 'Numeric row', JSON.stringify(mixed));
  T.check('MEASUREMENT — the pre-existing merge collapses the pair to one row (this predates _crIdEq)',
    mixed.mergedCount === 2 && !mixed.mergedCards.includes('Numeric row')
      && mixed.mergedCards.includes('String row'),
    JSON.stringify(mixed));
  T.check('MEASUREMENT — the unrelated row is unaffected either way',
    mixed.mergedCards.includes('Bystander'), JSON.stringify(mixed));
  T.check('and nothing in this scenario rewrote or renumbered the stored rows',
    mixed.bothStored === true, JSON.stringify(mixed));

  /* ── refreshSingleCardPrice, BEHAVIOURALLY, FOR BOTH ID SHAPES ────────────
     
     Owner correction 3. This exact action was the demonstrated coverage gap:
     reverting its lookup to `x.id === id` left the suite green. The source-shape
     guard added earlier catches the reintroduction, but a source check is not a
     behaviour check, so the action is now driven for real.
     
     _fetchPriceForEntry is stubbed -- the point is which ROW the write lands on,
     not whether the price feed works -- and the sibling is asserted unchanged. */
  for (const shape of ['legacy-numeric', 'uuid']) {
    const r = await page.evaluate(async (shape) => {
      const key = window.getUserKey('portfolio');
      const targetId = shape === 'legacy-numeric' ? 1757000000001
        : 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      const siblingId = shape === 'legacy-numeric' ? 1757000000002
        : 'ffffffff-1111-4222-8333-444444444444';
      localStorage.setItem(key, JSON.stringify([
        { id: targetId,  card: 'Target',  buyPrice: 1, currentValue: 10, updatedAt: 1000 },
        { id: siblingId, card: 'Sibling', buyPrice: 1, currentValue: 10, updatedAt: 1000 },
      ]));

      const realFetchPrice = window._fetchPriceForEntry;
      const realRender = window.renderCollectionView;
      const realToast = window.showToast;
      let askedFor = null;
      window._fetchPriceForEntry = async (entry) => { askedFor = entry && entry.card; return 77.5; };
      window.renderCollectionView = () => {};
      window.showToast = () => {};

      // The row's button and value cell, as the renderer emits them.
      const host = document.createElement('div');
      host.innerHTML = '<button id="colRefreshRow_' + targetId + '"></button>'
                     + '<span id="colVal_' + targetId + '"></span>';
      document.body.appendChild(host);

      // The id arrives as a STRING, exactly as a data attribute delivers it.
      await window.refreshSingleCardPrice(String(targetId));

      window._fetchPriceForEntry = realFetchPrice;
      window.renderCollectionView = realRender;
      window.showToast = realToast;
      host.remove();

      const after = JSON.parse(localStorage.getItem(key));
      const t = after.find(x => window._crIdEq(x.id, targetId));
      const sib = after.find(x => window._crIdEq(x.id, siblingId));
      return {
        askedFor,
        targetValue: t && t.currentValue,
        targetSource: t && t.valueSource,
        targetIdType: t && typeof t.id,
        siblingValue: sib && sib.currentValue,
        siblingSource: sib && sib.valueSource,
        siblingRefreshed: sib && sib.lastRefreshed,
        rows: after.length,
      };
    }, shape);
    T.check(`ACCEPTANCE — refreshSingleCardPrice resolves the ${shape} row and asks the feed for IT`,
      r.askedFor === 'Target', JSON.stringify(r));
    T.check(`ACCEPTANCE — the ${shape} target row receives the new price`,
      r.targetValue === 77.5, JSON.stringify(r));
    /* SEPARATE FINDING, deliberately measured rather than asserted.
       
       refreshSingleCardPrice sets `p.valueSource = 'comp'` (core :11026) with a
       comment saying nothing else in the app may set that value -- but
       _commitPortfolioRefresh grafts only _PRICE_REFRESH_FIELDS (core :10900),
       which lists currentValue, lastRefreshed, img, imageUrl and tcgplayerUrl.
       valueSource is not in that list, so the assignment is dropped and never
       reaches storage. A silent omission, which Rule 2 names as the bug.
       
       This is NOT an id-compatibility defect and it is NOT fixed here: the
       owner asked for the photo and id topics in separate reviewed commits, and
       price provenance is a third topic. The behaviour is pinned so the packet
       can report it and so a later fix has a failing assertion to flip. */
    T.check(`DEFECT MEASUREMENT — valueSource:'comp' is dropped before storage on the ${shape} row (NOT fixed in this commit)`,
      r.targetSource === undefined,
      'observed valueSource=' + JSON.stringify(r.targetSource) + ' — see _PRICE_REFRESH_FIELDS');
    T.check(`ACCEPTANCE — the ${shape} sibling is untouched`,
      r.rows === 2 && r.siblingValue === 10 && !r.siblingSource && !r.siblingRefreshed,
      JSON.stringify(r));
    if (shape === 'legacy-numeric') {
      T.check('and the legacy row\u2019s id is still a number after the write',
        r.targetIdType === 'number', JSON.stringify(r));
    }
  }

  /* ── THE NINE DISPATCHED ACTIONS, BOTH ID SHAPES ─────────────────────────
     
     A compact matrix rather than nine full scenarios: for each action the map
     declares, a real click is dispatched on real markup for a legacy numeric id
     and for a UUID, and the assertion is that the handler was reached with the
     id INTACT as a string. Reaching the handler with the right id is the part
     the compatibility change can break; what each handler then does is covered
     by its own suite. */
  const matrix = await page.evaluate(() => {
    const acts = Object.keys(window._CR_ENTRY_ACTIONS || {});
    const ids = { 'legacy-numeric': '1757000000001', 'uuid': 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };
    const out = [];
    for (const act of acts) {
      for (const [shape, id] of Object.entries(ids)) {
        // Replace every handler the map routes to with a recorder.
        const seen = [];
        const saved = {};
        const targets = ['openGradingModal','deleteGradingEntry','openMarkSoldModal',
          'openCollectionCardDetail','refreshSingleCardPrice','deletePortEntry',
          'openFlipDetail','deleteFlip','deletePort'];
        for (const n of targets) { saved[n] = window[n]; window[n] = (x) => seen.push({ fn: n, arg: x }); }

        const host = document.createElement('div');
        host.innerHTML = '<button data-entry-act="' + act + '" data-entry-id="' + id + '">x</button>';
        document.body.appendChild(host);
        host.firstChild.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        host.remove();
        for (const n of targets) window[n] = saved[n];

        out.push({
          act, shape,
          reached: seen.length === 1,
          fn: seen.length ? seen[0].fn : null,
          argOk: seen.length === 1 && seen[0].arg === id,
          argType: seen.length ? typeof seen[0].arg : null,
        });
      }
    }
    return { actionCount: acts.length, rows: out, bad: out.filter(r => !r.reached || !r.argOk) };
  });
  T.check('the dispatcher declares nine entry actions',
    matrix.actionCount === 9, JSON.stringify({ n: matrix.actionCount }));
  T.check('ACCEPTANCE — every one of the nine actions reaches its handler for BOTH id shapes, id intact as a string',
    matrix.rows.length === 18 && matrix.bad.length === 0,
    JSON.stringify(matrix.bad.slice(0, 6)));
  await ctx.close();
});

/* ── ACCEPTANCE: an id is data, never code ──────────────────────────────── */
await T.section('ACCEPTANCE — ids never reach the page as executable source', async () => {
  const ctx = await ctxWith();
  const page = await pageIn(ctx);

  /* The old markup interpolated the id into an onclick STRING. That only worked
     because ids were bare integers; a UUID dropped in unquoted is a syntax
     error, and it also meant a hostile id was executable. */
  const asData = await page.evaluate(async () => {
    window.confirm = () => true;
    const nasty = `u'1");alert(1);//`;
    localStorage.setItem(window.getUserKey('portfolio'), JSON.stringify([
      { id: nasty, card: 'Hostile', set: 'Base', buyPrice: 1, updatedAt: 1 },
      { id: 'u-keep', card: 'Keep', set: 'Base', buyPrice: 2, updatedAt: 1 },
    ]));
    const host = document.createElement('div');
    const btn = document.createElement('button');
    btn.setAttribute('data-entry-act', 'port-delete');
    btn.setAttribute('data-entry-id', nasty);   // set as DATA, never parsed
    host.appendChild(btn);
    document.body.appendChild(host);
    btn.click();
    await new Promise(r => setTimeout(r, 50));
    const left = JSON.parse(localStorage.getItem(window.getUserKey('portfolio'))).map(r => r.id);
    host.remove();
    return { left };
  });
  T.check('an id containing quotes and a script fragment still deletes only its own row',
    JSON.stringify(asData.left) === JSON.stringify(['u-keep']), JSON.stringify(asData));

  /* Source-level check: no surviving handler interpolates an entry id into an
     onclick string. This is a shape assertion about the bundle, so it catches a
     REINTRODUCTION that no behavioural test would notice. */
  const src = await page.evaluate(async () => {
    const names = Array.from(document.querySelectorAll('script[src]')).map(s => s.getAttribute('src'));
    const texts = await Promise.all(names.map(n => fetch(n).then(r => r.text())));
    const bad = [];
    texts.forEach((t, i) => {
      const re = /onclick=(?:\\?")[^"]*\$\{[A-Za-z_$][\w$]*\.id\}/g;
      const hits = t.match(re);
      if (hits) bad.push({ file: names[i], hits: hits.slice(0, 3), count: hits.length });
    });
    return { files: names.length, bad };
  });
  T.check('no bundle interpolates an entry id into an onclick handler',
    src.files > 0 && src.bad.length === 0, JSON.stringify(src));

  /* Every entry lookup must go through the central comparison.
     
     Found by mutation: reverting ONE lookup (`refreshSingleCardPrice`) to
     `x.id === id` left the suite green, because no scenario drove that
     particular action with a legacy row. Testing each of the ~40 call sites
     behaviourally is not realistic, and the risk the owner named is precisely
     ad-hoc conversion -- a comparison reintroduced at a site nobody is
     watching. So the shape is asserted at the source: a strict comparison
     against a collection-entry id is a defect wherever it appears.
     
     The pattern is narrow on purpose. DOM element ids (`e.target.id`),
     catalogue candidate ids, venue tier ids and packet category ids are NOT
     collection entries and are deliberately out of scope; they are matched by
     their own receiver names and excluded below. */
  const lookups = await page.evaluate(async () => {
    const names = Array.from(document.querySelectorAll('script[src]')).map(s => s.getAttribute('src'));
    const texts = await Promise.all(names.map(n => fetch(n).then(r => r.text())));
    // Receivers that are NOT collection entries.
    const EXEMPT = /^(e\.target|ev\.target|panel|t|c|tier|cat|el|node|btn|input|section)$/;
    /* Named exceptions, not a loosened pattern. Each is a lookup over a
       DIFFERENT id space than collection entries, so string-unifying it would
       be wrong rather than merely unnecessary. Listing them exactly means
       adding one is a visible edit to this file, not a silently widened
       regex. */
    const ALLOWED = [
      'tiers.find(x => x.id === id)',       // venue fee tiers, ids are fixed slugs
    ];
    const bad = [];
    texts.forEach((t, i) => {
      const re = /([A-Za-z_$][\w$]*)\.id\s*(===|!==)\s*([A-Za-z_$][\w$.]*|'[^']*')/g;
      let m;
      while ((m = re.exec(t))) {
        const recv = m[1];
        if (EXEMPT.test(recv)) continue;
        // Enough surrounding source to identify WHICH collection is searched.
        const ctx = t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 2);
        if (ALLOWED.some(a => ctx.includes(a))) continue;
        // Comparing against a string LITERAL is a DOM/element check, not an
        // entry lookup ("t.id === 'market'").
        if (m[3].startsWith("'")) continue;
        bad.push({ file: names[i], expr: m[0] });
      }
    });
    return { files: names.length, count: bad.length, bad: bad.slice(0, 6) };
  });
  T.check('no entry lookup compares ids with === instead of the central helper',
    lookups.files > 0 && lookups.count === 0, JSON.stringify(lookups));

  /* And one of those actions driven for real against a LEGACY numeric row,
     because a source-shape check is not a behaviour check. */
  const legacyAction = await page.evaluate(async () => {
    const key = window.getUserKey('portfolio');
    localStorage.setItem(key, JSON.stringify([
      { id: 1757000000001, card: 'Legacy Refresh', set: 'Base', buyPrice: 1, currentValue: 5, updatedAt: 1 },
    ]));
    // Record whether the lookup FOUND the entry. refreshSingleCardPrice returns
    // early when it does not, so a network call is not needed to tell the
    // difference: the found path touches the row button element first.
    let reachedFound = false;
    const realFetch = window.fetch;
    window.fetch = async (...a) => { reachedFound = true; return realFetch(...a); };
    const host = document.createElement('div');
    host.innerHTML = '<button id="colRefreshRow_1757000000001"></button>';
    document.body.appendChild(host);
    try {
      // The id arrives as a STRING, exactly as a data attribute delivers it.
      await window.refreshSingleCardPrice('1757000000001');
    } catch (_) { /* network outcome is irrelevant; reaching it is the point */ }
    window.fetch = realFetch;
    host.remove();
    return { reachedFound };
  });
  T.check('a legacy numeric row is FOUND when its action is driven with a string id',
    legacyAction.reachedFound === true, JSON.stringify(legacyAction));
  await ctx.close();
});

/* ── ACCEPTANCE: two tabs ───────────────────────────────────────────────── */
await T.section('ACCEPTANCE — two tabs saving at once keep both entries', async () => {
  const ctx = await ctxWith();
  const tabA = await pageIn(ctx);
  const tabB = await pageIn(ctx);   // same context ⇒ same localStorage

  /* Both tabs mint ids with the clock frozen to the same instant. A counter or a
     timestamp scheme collides here; that is the point. */
  const mint = (p) => p.evaluate(() => {
    const realNow = Date.now;
    Date.now = () => 1757000000000;
    try { return [0, 1, 2].map(() => window._crNewEntryId()); }
    finally { Date.now = realNow; }
  });
  const [idsA, idsB] = await Promise.all([mint(tabA), mint(tabB)]);
  const overlap = idsA.filter(x => idsB.includes(x));
  T.check('ids minted concurrently in two tabs at the same frozen instant do not overlap',
    overlap.length === 0 && new Set(idsA.concat(idsB)).size === 6,
    `overlap=${JSON.stringify(overlap)}`);

  /* And the merge that combines them keeps all six rows. `_unionById` keys on
     String(id), so a collision would silently drop a card rather than error. */
  const merged = await tabA.evaluate(({ a, b }) => {
    const rowsA = a.map((id, i) => ({ id, card: 'A' + i, updatedAt: 10 }));
    const rowsB = b.map((id, i) => ({ id, card: 'B' + i, updatedAt: 10 }));
    const u = window._unionById(rowsA, rowsB);
    return { count: u.length, cards: u.map(r => r.card).sort() };
  }, { a: idsA, b: idsB });
  T.check('merging both tabs\u2019 rows keeps all six, none silently collapsed',
    merged.count === 6, JSON.stringify(merged));
  await ctx.close();
});

/* ── ACCEPTANCE: two devices ────────────────────────────────────────────── */
await T.section('ACCEPTANCE — two devices from the same synced collection', async () => {
  const ctx = await ctxWith();
  const page = await pageIn(ctx);

  /* This is the scenario that rules out max(existing id) + 1. Both devices hold
     the SAME synced collection, so a counter computes the same next id on each,
     and the union keyed by id keeps one of the two cards. */
  const twoDevice = await page.evaluate(() => {
    const synced = [
      { id: 1757000000001, card: 'Shared One', updatedAt: 5 },
      { id: 1757000000002, card: 'Shared Two', updatedAt: 5 },
    ];
    const realNow = Date.now;
    Date.now = () => 1757000000000;
    try {
      // Counter approach, computed independently on each device.
      const nextCounter = (rows) => Math.max(...rows.map(r => Number(r.id) || 0)) + 1;
      const counterA = nextCounter(synced);
      const counterB = nextCounter(synced);
      const counterMerge = window._unionById(
        synced.concat([{ id: counterA, card: 'Device A card', updatedAt: 9 }]),
        synced.concat([{ id: counterB, card: 'Device B card', updatedAt: 9 }]),
      );

      // UUID approach, same starting state.
      const uuidA = window._crNewEntryId();
      const uuidB = window._crNewEntryId();
      const uuidMerge = window._unionById(
        synced.concat([{ id: uuidA, card: 'Device A card', updatedAt: 9 }]),
        synced.concat([{ id: uuidB, card: 'Device B card', updatedAt: 9 }]),
      );
      return {
        counterSameId: counterA === counterB,
        counterRows: counterMerge.length,
        counterCards: counterMerge.map(r => r.card),
        uuidSameId: uuidA === uuidB,
        uuidRows: uuidMerge.length,
        uuidCards: uuidMerge.map(r => r.card).sort(),
      };
    } finally { Date.now = realNow; }
  });
  T.check('DEFECT MEASUREMENT: a counter mints the same id on both devices and the merge loses a card',
    twoDevice.counterSameId === true && twoDevice.counterRows === 3,
    JSON.stringify(twoDevice));
  T.check('ACCEPTANCE: UUIDs differ across devices and the merge keeps both new cards',
    twoDevice.uuidSameId === false && twoDevice.uuidRows === 4
      && twoDevice.uuidCards.includes('Device A card') && twoDevice.uuidCards.includes('Device B card'),
    JSON.stringify(twoDevice));
  await ctx.close();
});

/* ── ACCEPTANCE: tombstones ─────────────────────────────────────────────── */
await T.section('ACCEPTANCE — deletion tombstones work for both id shapes', async () => {
  const ctx = await ctxWith();
  const page = await pageIn(ctx);

  /* Tombstones are what stop a deleted row being handed back by the next sync
     pull. They key on String(id), so a UUID needs no change -- but "needs no
     change" is a claim, and this runs it. */
  const tomb = await page.evaluate(() => {
    const legacyId = 1757000000001;
    const uuidId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    window._addTombstones('portfolio', [legacyId, uuidId]);
    const marks = window.loadTombstones().portfolio || {};

    // The server hands both rows back, older than the deletion.
    const remote = [
      { id: legacyId, card: 'Deleted legacy', updatedAt: 1 },
      { id: uuidId,   card: 'Deleted uuid',   updatedAt: 1 },
      { id: 'u-live', card: 'Still here',     updatedAt: 1 },
    ];
    const afterDelete = window._applyTombstones(remote, marks).map(r => String(r.id));

    // A row edited AFTER the deletion must survive: the survival rule is
    // row.updatedAt > deletedAt, not "tombstoned forever".
    const later = [{ id: uuidId, card: 'Re-added uuid', updatedAt: Date.now() + 60000 }];
    const afterReadd = window._applyTombstones(later, marks).map(r => String(r.id));
    return {
      markKeys: Object.keys(marks).sort(),
      afterDelete,
      afterReadd,
    };
  });
  T.check('a tombstone is recorded for a legacy id and a UUID alike',
    tomb.markKeys.length === 2
      && tomb.markKeys.includes('1757000000001')
      && tomb.markKeys.includes('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'),
    JSON.stringify(tomb.markKeys));
  T.check('both deleted rows are dropped from a server snapshot and the live row is kept',
    JSON.stringify(tomb.afterDelete) === JSON.stringify(['u-live']), JSON.stringify(tomb));
  T.check('a row edited after its deletion survives, so a tombstone is not permanent',
    JSON.stringify(tomb.afterReadd) === JSON.stringify(['a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d']),
    JSON.stringify(tomb));
  await ctx.close();
});

/* ── ACCEPTANCE: siblings ───────────────────────────────────────────────── */
await T.section('ACCEPTANCE — multiple copies of one card stay independent', async () => {
  const ctx = await ctxWith();
  const page = await pageIn(ctx);

  /* The defect's real cost: four copies of the same card, and editing or
     deleting one hits a sibling. Same card name, same set, same everything
     except identity -- which is exactly the case a name-based lookup would get
     wrong too. */
  const siblings = await page.evaluate(async () => {
    const key = window.getUserKey('portfolio');
    const realNow = Date.now;
    Date.now = () => 1757000000000;   // all four "saved" in one millisecond
    let ids;
    try { ids = [0, 1, 2, 3].map(() => window._crNewEntryId()); }
    finally { Date.now = realNow; }

    const rows = ids.map((id, i) => ({
      id, card: 'Charizard', set: 'Base Set', number: '4/102',
      buyPrice: 100, currentValue: 200, updatedAt: 1, copyIndex: i,
    }));
    localStorage.setItem(key, JSON.stringify(rows));
    window.confirm = () => true;

    const out = { distinct: new Set(ids).size };

    // Edit copy #1 only, through the stored-shape write the app uses.
    const edited = JSON.parse(localStorage.getItem(key));
    const target = edited.find(r => window._crIdEq(r.id, String(ids[1])));
    target.buyPrice = 999;
    localStorage.setItem(key, JSON.stringify(edited));
    const afterEdit = JSON.parse(localStorage.getItem(key));
    out.pricesAfterEdit = afterEdit.map(r => r.buyPrice);

    // Delete copy #2 only, through the real click path.
    const host = document.createElement('div');
    const btn = document.createElement('button');
    btn.setAttribute('data-entry-act', 'port-delete');
    btn.setAttribute('data-entry-id', String(ids[2]));
    host.appendChild(btn);
    document.body.appendChild(host);
    btn.click();
    await new Promise(r => setTimeout(r, 50));
    const afterDelete = JSON.parse(localStorage.getItem(key));
    out.remaining = afterDelete.map(r => r.copyIndex).sort();
    out.pricesAfterDelete = afterDelete.map(r => r.buyPrice);
    host.remove();
    return out;
  });
  T.check('four copies saved in one millisecond all have distinct ids',
    siblings.distinct === 4, JSON.stringify(siblings));
  T.check('editing one copy changes only that copy\u2019s price',
    JSON.stringify(siblings.pricesAfterEdit) === JSON.stringify([100, 999, 100, 100]),
    JSON.stringify(siblings.pricesAfterEdit));
  T.check('deleting one copy leaves the other three, and the edit intact',
    JSON.stringify(siblings.remaining) === JSON.stringify([0, 1, 3])
      && JSON.stringify(siblings.pricesAfterDelete) === JSON.stringify([100, 999, 100]),
    JSON.stringify(siblings));
  await ctx.close();
});

/* ── ACCEPTANCE: refusal on the four non-bulk minting paths ─────────────────
   
   Owner review, 2026-09-12: "The refusal evidence shown is strongest for bulk
   save. For the other four paths, point to named tests proving the stated
   preservation behaviour. Mark-as-sold particularly needs to demonstrate that
   neither the collection record nor the flip log changes when ID creation
   fails."
   
   That criticism was fair. The earlier packet asserted preservation on all
   five by reading the code; only the bulk path was driven. Each path below is
   now driven with both crypto methods removed, and each asserts what that
   specific surface is supposed to keep -- not a shared claim about photos,
   which four of these surfaces do not have. */
await T.section('ACCEPTANCE — the other four minting paths refuse without losing work', async () => {
  const ctx = await ctxWith();
  const page = await pageIn(ctx);

  const r = await page.evaluate(async () => {
    const pKey = window.getUserKey('portfolio');
    const fKey = window.getUserKey('flips');
    const gKey = window.getUserKey('grading_log');

    /* One existing collection row, so mark-as-sold has something real to act
       on and we can prove it is still there afterwards. */
    const seedPort = [{ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', card: 'Blastoise',
                        set: 'Base Set', number: '2', currentValue: 120, buyPrice: 50 }];
    localStorage.setItem(pKey, JSON.stringify(seedPort));
    localStorage.setItem(fKey, '[]');
    localStorage.setItem(gKey, '[]');

    const snap = () => ({
      port: localStorage.getItem(pKey),
      flips: localStorage.getItem(fKey),
      grading: localStorage.getItem(gKey),
    });

    const toasts = [];
    const realToast = window.showToast;
    window.showToast = (m, k) => { toasts.push({ m: String(m), k }); };
    const realConfirm = window.confirm;
    window.confirm = () => true;

    const realCrypto = window.crypto;
    let removed = false;
    try {
      Object.defineProperty(window, 'crypto', { value: undefined, configurable: true });
      removed = (typeof window.crypto === 'undefined');
    } catch (_) { removed = false; }

    const out = { removed, paths: {} };

    /* Helper: run one path, capture storage before/after and what it threw. */
    const drive = (name, setup, run, readWork) => {
      const before = snap();
      const tBefore = toasts.length;
      let threw = null;
      try { setup && setup(); } catch (e) { /* setup failures are reported below */ }
      try { run(); } catch (e) { threw = String((e && e.message) || e); }
      const after = snap();
      out.paths[name] = {
        threw,
        portUnchanged: before.port === after.port,
        flipsUnchanged: before.flips === after.flips,
        gradingUnchanged: before.grading === after.grading,
        toastsAdded: toasts.length - tBefore,
        lastToast: toasts.length ? toasts[toasts.length - 1] : null,
        work: (readWork && readWork()) || null,
      };
    };

    /* --- 1. collection add (saveFlipEntry, port branch) ------------------- */
    drive('collectionAdd',
      () => {
        /* _modalMode is a module-local `let`, not a window global, so the mode
           is set through the real entry point rather than poked. Field ids are
           the shipped ones (mCardName / mSetName / mBuyPrice), verified
           against saveFlipEntry -- my first attempt invented fmCard etc, the
           form stayed empty, and the save bailed on its own blank-name
           validation BEFORE reaching the mint. Storage was unchanged for the
           wrong reason, which is exactly the false pass this fixture exists to
           avoid. */
        window.openAddFlip('hold');
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        set('mCardName', 'Venusaur');
        set('mSetName', 'Base Set');
        set('mBuyPrice', '40');
        set('mCurrentValue', '60');
      },
      () => { window.saveFlipEntry(); },
      /* The seller's work on THIS surface is the typed form, not photos. */
      () => {
        const el = document.getElementById('mCardName');
        const buy = document.getElementById('mBuyPrice');
        const modal = document.getElementById('flipModal');
        return {
          typedCardKept: !!(el && el.value === 'Venusaur'),
          typedBuyKept: !!(buy && buy.value === '40'),
          modalStillOpen: !!(modal && modal.classList.contains('open')),
        };
      });

    /* --- 2. flip log (saveFlipEntry, flip branch) ------------------------- */
    drive('flipLog',
      () => {
        window.openAddFlip('flip');
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        set('mCardName', 'Machamp');
        set('mSetName', 'Base Set');
        set('mBuyPrice', '10');
        set('mSellPrice', '35');
      },
      () => { window.saveFlipEntry(); },
      () => {
        const c = document.getElementById('mCardName');
        const sell = document.getElementById('mSellPrice');
        return {
          typedCardKept: !!(c && c.value === 'Machamp'),
          typedSellKept: !!(sell && sell.value === '35'),
        };
      });

    /* --- 3. grading entry (saveGradingEntry) ------------------------------ */
    drive('gradingEntry',
      () => {
        window._gradingEditId = null;
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        set('gmCard', 'Alakazam');
        set('gmSet', 'Base Set');
        set('gmCost', '25');
        set('gmGrader', 'psa');
      },
      () => { window.saveGradingEntry(); },
      () => {
        const c = document.getElementById('gmCard');
        const cost = document.getElementById('gmCost');
        return {
          typedCardKept: !!(c && c.value === 'Alakazam'),
          typedCostKept: !!(cost && cost.value === '25'),
        };
      });

    /* --- 4. mark-as-sold (confirmMarkSold) -------------------------------- */
    drive('markSold',
      () => {
        window._markSoldEntryId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        set('msSellPrice', '150');
        set('msBuyPrice', '50');
      },
      () => { window.confirmMarkSold(); },
      () => {
        const port = JSON.parse(localStorage.getItem(pKey) || '[]');
        const flips = JSON.parse(localStorage.getItem(fKey) || '[]');
        const sell = document.getElementById('msSellPrice');
        return {
          collectionRowStillThere: port.length === 1
            && port[0].id === 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          noFlipRecorded: flips.length === 0,
          typedSellKept: !!(sell && sell.value === '150'),
        };
      });

    try { Object.defineProperty(window, 'crypto', { value: realCrypto, configurable: true }); } catch (_) {}
    window.showToast = realToast;
    window.confirm = realConfirm;
    out.allToasts = toasts;
    return out;
  });

  T.check('the no-crypto condition was established for all four paths',
    r.removed === true, JSON.stringify({ removed: r.removed }));

  const P = r.paths || {};
  const generic = /can\u2019t create a card ID/i;
  const notScanCopy = (m) => !/scanned rows and photos/i.test(String(m || ''));

  /* 1. collection add */
  T.check('ACCEPTANCE — collection add: nothing is written on refusal',
    P.collectionAdd && P.collectionAdd.portUnchanged && P.collectionAdd.flipsUnchanged,
    JSON.stringify(P.collectionAdd));
  T.check('ACCEPTANCE — collection add: the typed form survives for retry',
    P.collectionAdd && P.collectionAdd.work
      && P.collectionAdd.work.typedCardKept && P.collectionAdd.work.typedBuyKept,
    JSON.stringify(P.collectionAdd));
  T.check('ACCEPTANCE — collection add: it reports rather than throwing at the seller',
    P.collectionAdd && P.collectionAdd.threw === null && P.collectionAdd.toastsAdded === 1,
    JSON.stringify(P.collectionAdd));

  /* 2. flip log */
  T.check('ACCEPTANCE — flip log: nothing is written on refusal',
    P.flipLog && P.flipLog.flipsUnchanged && P.flipLog.portUnchanged,
    JSON.stringify(P.flipLog));
  T.check('ACCEPTANCE — flip log: the typed form survives for retry',
    P.flipLog && P.flipLog.work
      && P.flipLog.work.typedCardKept && P.flipLog.work.typedSellKept,
    JSON.stringify(P.flipLog));

  /* 3. grading entry */
  T.check('ACCEPTANCE — grading entry: nothing is written on refusal',
    P.gradingEntry && P.gradingEntry.gradingUnchanged,
    JSON.stringify(P.gradingEntry));
  T.check('ACCEPTANCE — grading entry: the typed form survives for retry',
    P.gradingEntry && P.gradingEntry.work
      && P.gradingEntry.work.typedCardKept && P.gradingEntry.work.typedCostKept,
    JSON.stringify(P.gradingEntry));

  /* 4. mark-as-sold -- the specific demonstration the owner asked for. */
  T.check('ACCEPTANCE — mark-as-sold: the COLLECTION RECORD does not change',
    P.markSold && P.markSold.portUnchanged
      && P.markSold.work && P.markSold.work.collectionRowStillThere,
    JSON.stringify(P.markSold));
  T.check('ACCEPTANCE — mark-as-sold: the FLIP LOG does not change either',
    P.markSold && P.markSold.flipsUnchanged
      && P.markSold.work && P.markSold.work.noFlipRecorded,
    JSON.stringify(P.markSold));
  T.check('ACCEPTANCE — mark-as-sold: the card is therefore neither sold nor lost',
    P.markSold && P.markSold.portUnchanged && P.markSold.flipsUnchanged,
    JSON.stringify(P.markSold));
  T.check('ACCEPTANCE — mark-as-sold: the entered sold price survives for retry',
    P.markSold && P.markSold.work && P.markSold.work.typedSellKept,
    JSON.stringify(P.markSold));

  /* Copy, per surface. None of these four may claim photos are preserved. */
  ['collectionAdd', 'flipLog', 'gradingEntry', 'markSold'].forEach((k) => {
    T.check('ACCEPTANCE — ' + k + ': uses the generic sentence, NOT the scan wording about photos',
      P[k] && P[k].lastToast && generic.test(P[k].lastToast.m) && notScanCopy(P[k].lastToast.m),
      JSON.stringify(P[k] && P[k].lastToast));
  });
  T.check('and no refusal on these four surfaces mentions scans or photographs at all',
    ['collectionAdd', 'flipLog', 'gradingEntry', 'markSold'].every((k) =>
      P[k] && P[k].lastToast && !/scan|photo/i.test(String(P[k].lastToast.m))),
    JSON.stringify(Object.keys(P).map(k => (P[k].lastToast || {}).m)));

  await ctx.close();
});

/* ── ACCEPTANCE: ambiguity refuses the mutation ─────────────────────────────
   
   Owner review, 2026-09-12: "Where multiple rows match the normalized ID, the
   safe behaviour is to report ambiguity and refuse that mutation without
   choosing the first row or renumbering anything."
   
   And the framing correction that prompted it, accepted: replacing strict
   comparisons with _crIdEq CHANGED local lookup behaviour for an unsynced
   123 / "123" pair. It is not merely a pre-existing hazard made visible, and a
   detector would measure it without preventing a wrong-row action.
   
   The sharpest case is delete. The delete paths are written as
   .filter(row => !_crIdEq(row.id, id)), so an ambiguous id removed BOTH
   records -- and wrote a tombstone, propagating that loss to every other
   device. */
await T.section('ACCEPTANCE — an ambiguous id refuses the mutation and keeps both rows', async () => {
  const ctx = await ctxWith();
  const page = await pageIn(ctx);

  const amb = await page.evaluate(async () => {
    const pKey = window.getUserKey('portfolio');
    const seed = () => localStorage.setItem(pKey, JSON.stringify([
      { id: 123,   card: 'Charizard', set: 'Base Set', number: '4', currentValue: 200 },
      { id: '123', card: 'Blastoise', set: 'Base Set', number: '2', currentValue: 120 },
      { id: 999,   card: 'Venusaur',  set: 'Base Set', number: '15', currentValue: 90 },
    ]));

    const toasts = [];
    const realToast = window.showToast;
    window.showToast = (m, k) => { toasts.push({ m: String(m), k }); };
    const realConfirm = window.confirm;
    window.confirm = () => true;

    const out = { resolver: {}, actions: {} };

    /* The resolver itself, before any caller. */
    seed();
    const rows = JSON.parse(localStorage.getItem(pKey));
    const one = window._crResolveEntry(rows, 999);
    const two = window._crResolveEntry(rows, '123');
    const none = window._crResolveEntry(rows, 'nope');
    out.resolver = {
      unique: { ok: one.ok, count: one.count, card: one.row && one.row.card },
      ambiguous: { ok: two.ok, count: two.count, row: two.row, flagged: two.ambiguous },
      missing: { ok: none.ok, count: none.count, flagged: none.ambiguous },
    };

    /* Each mutation, driven with the ambiguous id. */
    const driveAction = (name, fn) => {
      seed();
      const before = localStorage.getItem(pKey);
      const tBefore = toasts.length;
      let threw = null;
      try { fn(); } catch (e) { threw = String((e && e.message) || e); }
      const after = localStorage.getItem(pKey);
      const rowsAfter = JSON.parse(after || '[]');
      out.actions[name] = {
        threw,
        unchanged: before === after,
        rowCount: rowsAfter.length,
        /* Both members of the pair must still be present, types intact. */
        bothKept: rowsAfter.some(r => r.id === 123 && r.card === 'Charizard')
               && rowsAfter.some(r => r.id === '123' && r.card === 'Blastoise'),
        typesIntact: rowsAfter.some(r => typeof r.id === 'number' && r.id === 123)
                  && rowsAfter.some(r => typeof r.id === 'string' && r.id === '123'),
        toastsAdded: toasts.length - tBefore,
        lastToast: toasts.length ? toasts[toasts.length - 1] : null,
        tombstones: (() => {
          try {
            const t = JSON.parse(localStorage.getItem(window.getUserKey('tombstones')) || '{}');
            const list = (t && t.portfolio) || [];
            return Array.isArray(list) ? list.length : 0;
          } catch (_) { return -1; }
        })(),
      };
    };

    /* Clear tombstones first so the counts below mean something. */
    try { localStorage.removeItem(window.getUserKey('tombstones')); } catch (_) {}

    driveAction('deletePortEntry', () => window.deletePortEntry('123'));
    driveAction('deletePort',      () => window.deletePort('123'));

    /* Price refresh: stub the feed so this measures WHICH row is written, not
       whether the network works. */
    const realFetchPrice = window._fetchPriceForEntry;
    window._fetchPriceForEntry = async () => 77.5;
    driveAction('refreshSingleCardPrice', () => window.refreshSingleCardPrice('123'));
    window._fetchPriceForEntry = realFetchPrice;

    driveAction('markSoldConfirm', () => {
      window._markSoldEntryId = '123';
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set('msSellPrice', '150');
      set('msBuyPrice', '50');
      window.confirmMarkSold();
    });
    out.flipsAfterMarkSold = JSON.parse(localStorage.getItem(window.getUserKey('flips')) || '[]').length;

    driveAction('startListingDraft', () => {
      if (typeof window.startListingDraftForEntry === 'function') window.startListingDraftForEntry('123');
    });

    /* And the unambiguous id must still work -- a refusal that blocks
       everything is not a fix. */
    seed();
    const beforeOk = JSON.parse(localStorage.getItem(pKey)).length;
    try { window.deletePortEntry(999); } catch (_) {}
    const afterOk = JSON.parse(localStorage.getItem(pKey) || '[]');
    out.unambiguousStillWorks = {
      before: beforeOk,
      after: afterOk.length,
      venusaurGone: !afterOk.some(r => r.card === 'Venusaur'),
      pairUntouched: afterOk.length === 2,
    };

    window.showToast = realToast;
    window.confirm = realConfirm;
    out.allToasts = toasts;
    return out;
  });

  const R = amb.resolver || {};
  T.check('the resolver returns exactly-one for an unambiguous id',
    R.unique && R.unique.ok === true && R.unique.count === 1 && R.unique.card === 'Venusaur',
    JSON.stringify(R.unique));
  T.check('ACCEPTANCE — the resolver reports TWO matches for the 123 / "123" pair',
    R.ambiguous && R.ambiguous.count === 2 && R.ambiguous.flagged === true,
    JSON.stringify(R.ambiguous));
  T.check('ACCEPTANCE — and it refuses to pick one: ok is false and no row is returned',
    R.ambiguous && R.ambiguous.ok === false && R.ambiguous.row === null,
    JSON.stringify(R.ambiguous));
  T.check('a missing id is reported as not-found, NOT as ambiguous',
    R.missing && R.missing.count === 0 && R.missing.flagged === false,
    JSON.stringify(R.missing));

  const A = amb.actions || {};
  const names = ['deletePortEntry', 'deletePort', 'refreshSingleCardPrice',
                 'markSoldConfirm', 'startListingDraft'];

  names.forEach((n) => {
    T.check('ACCEPTANCE — ' + n + ' on an ambiguous id changes NOTHING in storage',
      A[n] && A[n].unchanged === true, JSON.stringify(A[n]));
    T.check('ACCEPTANCE — ' + n + ': both members of the pair are still there, types intact',
      A[n] && A[n].bothKept === true && A[n].typesIntact === true && A[n].rowCount === 3,
      JSON.stringify(A[n]));
    T.check('ACCEPTANCE — ' + n + ': the seller is told the id is ambiguous',
      A[n] && A[n].toastsAdded >= 1 && A[n].lastToast
        && /share this card ID/i.test(A[n].lastToast.m),
      JSON.stringify(A[n] && A[n].lastToast));
    T.check(n + ' refuses without throwing at the seller',
      A[n] && A[n].threw === null, JSON.stringify(A[n]));
  });

  /* The tombstone is the part that would have travelled. */
  T.check('ACCEPTANCE — a refused delete writes NO tombstone, so the loss cannot sync to other devices',
    A.deletePortEntry && A.deletePortEntry.tombstones === 0
      && A.deletePort && A.deletePort.tombstones === 0,
    JSON.stringify({ a: A.deletePortEntry && A.deletePortEntry.tombstones,
                     b: A.deletePort && A.deletePort.tombstones }));
  T.check('ACCEPTANCE — a refused mark-as-sold records no flip either',
    amb.flipsAfterMarkSold === 0, JSON.stringify({ flips: amb.flipsAfterMarkSold }));

  /* A refusal that blocks everything would be a regression, not a fix. */
  T.check('ACCEPTANCE — an UNAMBIGUOUS id still deletes, and leaves the ambiguous pair alone',
    amb.unambiguousStillWorks && amb.unambiguousStillWorks.venusaurGone === true
      && amb.unambiguousStillWorks.pairUntouched === true,
    JSON.stringify(amb.unambiguousStillWorks));

  /* Nothing anywhere in this scenario renumbered a stored row. */
  T.check('and nothing in this scenario renumbered or rewrote either id',
    names.every(n => A[n] && A[n].typesIntact === true),
    JSON.stringify(names.map(n => A[n] && A[n].typesIntact)));

  await ctx.close();
});

/* ── ACCEPTANCE: target-row and sibling preservation, where nothing else
      established it ──────────────────────────────────────────────────────────
   
   Owner direction Q-C3-1, 2026-09-12: "Keep the dispatcher matrix. Reference
   the existing behavioural tests for destructive actions and mark-as-sold; add
   targeted coverage only where those tests do not establish target-row and
   sibling preservation."
   
   Survey of what already exists, so this section adds nothing duplicative:
   
     deletePortEntry   -- BEHAVIOURAL already, both id shapes: 'clicking delete
                          on a LEGACY numeric row removes exactly that row',
                          'clicking delete on a UUID row removes exactly that
                          row', and 'deleting one copy leaves the other three'.
                          No gap.
     refreshSingleCardPrice -- BEHAVIOURAL already (target priced, sibling
                          untouched, both shapes). No gap.
     deleteFlip / deletePort / deleteGradingEntry -- durability-tombstones
                          covers these via stripComments(grabFn(...)) + regex.
                          That is SOURCE SHAPE, not behaviour: it establishes
                          that a tombstone call appears in the text, not that
                          the right row was removed. GAP.
     confirmMarkSold   -- durability-tombstones and majors-flip-and-pack both
                          assert source shape only (_flipNetOf present, bails
                          before deleting if the flip did not persist). No test
                          drives a SUCCESSFUL sale and checks that the target
                          left the collection, arrived in the flip log, and
                          that a sibling was untouched. GAP.
   
   So four gaps, and only those four are covered below. */
await T.section('ACCEPTANCE — target and siblings, for the four actions nothing else covered behaviourally', async () => {
  const ctx = await ctxWith();
  const page = await pageIn(ctx);

  const r = await page.evaluate(async () => {
    const out = {};
    const realConfirm = window.confirm;
    window.confirm = () => true;
    const realToast = window.showToast;
    window.showToast = () => {};

    const TARGET = 1757000000001;                          // legacy numeric
    const SIB    = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'; // UUID sibling

    /* --- deleteFlip ------------------------------------------------------- */
    {
      const k = window.getUserKey('flips');
      localStorage.setItem(k, JSON.stringify([
        { id: TARGET, card: 'Charizard', sellPrice: 200, profit: 50 },
        { id: SIB,    card: 'Blastoise', sellPrice: 120, profit: 30 },
      ]));
      window.deleteFlip(String(TARGET));   // string, as a data attribute delivers it
      const after = JSON.parse(localStorage.getItem(k) || '[]');
      out.deleteFlip = {
        count: after.length,
        targetGone: !after.some(f => String(f.id) === String(TARGET)),
        siblingKept: after.some(f => f.id === SIB && f.card === 'Blastoise'),
        siblingUnchanged: after.length === 1 && after[0].sellPrice === 120 && after[0].profit === 30,
      };
    }

    /* --- deletePort ------------------------------------------------------- */
    {
      const k = window.getUserKey('portfolio');
      localStorage.setItem(k, JSON.stringify([
        { id: TARGET, card: 'Charizard', currentValue: 200 },
        { id: SIB,    card: 'Blastoise', currentValue: 120 },
      ]));
      window.deletePort(String(TARGET));
      const after = JSON.parse(localStorage.getItem(k) || '[]');
      out.deletePort = {
        count: after.length,
        targetGone: !after.some(x => String(x.id) === String(TARGET)),
        siblingKept: after.some(x => x.id === SIB && x.currentValue === 120),
        siblingIdTypeIntact: after.length === 1 && typeof after[0].id === 'string',
      };
    }

    /* --- deleteGradingEntry ---------------------------------------------- */
    {
      const k = window.getUserKey('grading_log');
      localStorage.setItem(k, JSON.stringify([
        { id: TARGET, card: 'Charizard', cost: 25, grader: 'psa' },
        { id: SIB,    card: 'Blastoise', cost: 30, grader: 'cgc' },
      ]));
      window.deleteGradingEntry(String(TARGET));
      const after = JSON.parse(localStorage.getItem(k) || '[]');
      out.deleteGradingEntry = {
        count: after.length,
        targetGone: !after.some(e => String(e.id) === String(TARGET)),
        siblingKept: after.some(e => e.id === SIB && e.cost === 30 && e.grader === 'cgc'),
      };
    }

    /* --- confirmMarkSold, the SUCCESS path ------------------------------- */
    {
      const pk = window.getUserKey('portfolio');
      const fk = window.getUserKey('flips');
      localStorage.setItem(pk, JSON.stringify([
        { id: TARGET, card: 'Charizard', set: 'Base Set', number: '4',
          currentValue: 200, buyPrice: 50, img: 'https://example.test/charizard.png' },
        { id: SIB,    card: 'Blastoise', set: 'Base Set', number: '2',
          currentValue: 120, buyPrice: 40 },
      ]));
      localStorage.setItem(fk, '[]');
      window._isPro = true;   // keep the free-plan cap out of this scenario
      window._markSoldEntryId = String(TARGET);
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set('msSellPrice', '175');
      set('msBuyPrice', '50');
      set('msFees', '');
      set('msShipCost', '');
      set('msGradingCost', '');
      let threw = null;
      try { window.confirmMarkSold(); } catch (e) { threw = String((e && e.message) || e); }
      const port = JSON.parse(localStorage.getItem(pk) || '[]');
      const flips = JSON.parse(localStorage.getItem(fk) || '[]');
      out.markSoldSuccess = {
        threw,
        portCount: port.length,
        targetLeftCollection: !port.some(x => String(x.id) === String(TARGET)),
        siblingKept: port.some(x => x.id === SIB && x.currentValue === 120),
        flipCount: flips.length,
        flipIsTheTarget: flips.length === 1 && flips[0].card === 'Charizard',
        flipSellPrice: flips.length === 1 ? flips[0].sellPrice : null,
        /* The flip is a NEW record with its own id -- it must not reuse the
           collection row's id, or the flip log and a synced collection row
           could collide. */
        flipHasOwnId: flips.length === 1 && String(flips[0].id) !== String(TARGET),
        flipIdIsUuid: flips.length === 1
          && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(flips[0].id)),
        flipCarriedImage: flips.length === 1 && flips[0].img === 'https://example.test/charizard.png',
      };
    }

    window.confirm = realConfirm;
    window.showToast = realToast;
    return out;
  });

  const D = r.deleteFlip || {};
  T.check('ACCEPTANCE — deleteFlip removes exactly the target flip',
    D.count === 1 && D.targetGone === true, JSON.stringify(D));
  T.check('ACCEPTANCE — deleteFlip leaves the sibling flip byte-intact',
    D.siblingKept === true && D.siblingUnchanged === true, JSON.stringify(D));

  const P = r.deletePort || {};
  T.check('ACCEPTANCE — deletePort removes exactly the target row',
    P.count === 1 && P.targetGone === true, JSON.stringify(P));
  T.check('ACCEPTANCE — deletePort leaves the sibling row and its id type intact',
    P.siblingKept === true && P.siblingIdTypeIntact === true, JSON.stringify(P));

  const G = r.deleteGradingEntry || {};
  T.check('ACCEPTANCE — deleteGradingEntry removes exactly the target entry',
    G.count === 1 && G.targetGone === true, JSON.stringify(G));
  T.check('ACCEPTANCE — deleteGradingEntry leaves the sibling entry intact',
    G.siblingKept === true, JSON.stringify(G));

  const M = r.markSoldSuccess || {};
  T.check('a successful mark-as-sold does not throw',
    M.threw === null, JSON.stringify(M));
  T.check('ACCEPTANCE — mark-as-sold moves the TARGET out of the collection',
    M.targetLeftCollection === true && M.portCount === 1, JSON.stringify(M));
  T.check('ACCEPTANCE — mark-as-sold leaves the SIBLING in the collection untouched',
    M.siblingKept === true, JSON.stringify(M));
  T.check('ACCEPTANCE — mark-as-sold records exactly one flip, and it is the target card',
    M.flipCount === 1 && M.flipIsTheTarget === true && M.flipSellPrice === 175,
    JSON.stringify(M));
  T.check('ACCEPTANCE — the new flip gets its OWN uuid, not the collection row\u2019s id',
    M.flipHasOwnId === true && M.flipIdIsUuid === true, JSON.stringify(M));
  T.check('and the flip carries the collection row\u2019s image rather than losing it',
    M.flipCarriedImage === true, JSON.stringify(M));

  await ctx.close();
});

await browser.close();
server.close();
T.done();
