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

await browser.close();
server.close();
T.done();
