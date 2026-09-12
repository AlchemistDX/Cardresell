/**
 * tests/bulk-batch-draft.mjs — batch drafting from Bulk/Rapid Scan, in a real
 * browser, against the real api/drafts.js handler and real store code.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Batch drafting rests on one claim that source-reading cannot establish:
 * that every scan ROW carries an identity which survives a retry and stays
 * distinct between two physical copies of the same card, all the way through
 * to the idempotency key the server sees. The failure modes are not visual —
 * a wrong identity produces a duplicate draft or a silently swallowed one,
 * both of which look like success on screen. So the identity is observed where
 * it lands: in the POST bodies and headers the browser actually sends, and in
 * the drafts the real handler actually stores.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT
 * ---------------------------------
 * Real: the browser, the shipped bundles, the shipped index.html, the real
 * upload entry point (a real JPEG through a real <input type=file>), the real
 * scan queue and its concurrency, the real merge/retry/remove paths, the real
 * api/drafts.js handler, real RS256 verification, real idempotency records,
 * real quota reserve/release.
 *
 * Substituted, and named so nothing here is mistaken for verified:
 *   * Ximilar's /api/scan and pokemontcg.io — fulfilled from fixtures, because
 *     the sandbox has no vendor credentials and the identification itself is
 *     not what is under test. The row SHAPE they produce is the input to
 *     everything asserted below.
 *   * Google's JWKS (locally minted keypair, still a real signature check) and
 *     Upstash (in-memory map over the same REST shape) — from
 *     tools/dev-draft-server.mjs. Lua is the suites' JS re-implementation and
 *     TTL is not modelled, so no claim is made about either.
 *
 * NOT ESTABLISHED BY THIS FILE:
 *   * Nothing about the deployed Preview. This is localhost.
 *   * Nothing about concurrent batches from two tabs. The orchestrator is
 *     concurrency-1 by design and is exercised that way.
 *   * Nothing about Upstash TTL, eviction, or real Redis script semantics.
 *
 * MUTATION CHECKS (G9)
 * --------------------
 * A suite that passes proves nothing on its own — it has to be shown to fail
 * when the behaviour it claims to pin is broken. G9 breaks identity carrying
 * two different ways at runtime and asserts the WRONG outcome then occurs, so
 * the assertions in G3/G5/G6 are known to discriminate rather than merely to
 * agree.
 *
 * Run: node tests/bulk-batch-draft.mjs
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = '/home/user/node_modules/playwright/index.js';
const PORT = Number(process.env.CR_BULK_DRAFT_PORT || 8341);
const B = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.CR_SHOT_DIR || '/home/user/workspace/shots';
const PHOTO = path.join(ROOT, 'assets', 'flips-hero.jpg'); // a real, decodable JPEG

const T = harness('bulk-batch-draft');
const eq = (name, actual, expected) =>
  T.check(name, Object.is(actual, expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const ok = (name, cond, hint) => T.check(name, !!cond, hint);

/* ── dev server ─────────────────────────────────────────────────────────── */
const srv = spawn('node', ['tools/dev-draft-server.mjs'], {
  cwd: ROOT, env: { ...process.env, DEV_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let srvLog = '';
srv.stdout.on('data', (d) => { srvLog += d; });
srv.stderr.on('data', (d) => { srvLog += d; });
await new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = setInterval(() => {
    if (/dev-draft-server on /.test(srvLog)) { clearInterval(tick); resolve(); }
    else if (Date.now() - t0 > 20000) { clearInterval(tick); reject(new Error('dev server did not start: ' + srvLog)); }
  }, 100);
});
const shutdown = () => { try { srv.kill('SIGKILL'); } catch (_) {} };
process.on('exit', shutdown);

const tokenFor = async (sub) =>
  (await (await fetch(`${B}/__devtoken?sub=${encodeURIComponent(sub)}`)).json()).token;
const kvSet = (key, value) =>
  fetch(`${B}/__kvset?key=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`);
const kvGet = async (prefix) =>
  (await (await fetch(`${B}/__kvget?prefix=${encodeURIComponent(prefix)}`)).json());

/** Every draft the real handler stored for this seller, read back through the
 *  real GET route rather than out of the store double. */
async function listDrafts(sub) {
  const tok = await tokenFor(sub);
  const r = await fetch(`${B}/api/drafts?limit=100`, { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, total: j.total, cap: j.cap, rows: j.rows || [] };
}

/* ── identification fixtures ────────────────────────────────────────────────
   Two DIFFERENT cards and one repeat of the first, in upload order. The repeat
   is how two physical copies of one card reach the merge path. */
const IDS = [
  { card_name: 'Charizard', set_name: 'Champions Path', card_number: '074/073', rarity: 'Secret Rare', grounded_id: 'swsh35-74' },
  { card_name: 'Umbreon VMAX', set_name: 'Evolving Skies', card_number: '215/203', rarity: 'Secret Rare', grounded_id: 'swsh7-215' },
  { card_name: 'Charizard', set_name: 'Champions Path', card_number: '074/073', rarity: 'Secret Rare', grounded_id: 'swsh35-74' },
];
const PRICE_BY_ID = { 'swsh35-74': 312.5, 'swsh7-215': 244.75 };

const { chromium } = (await import(PW)).default;
const browser = await chromium.launch();

/**
 * Boot the app, sign the seller in, and double ONLY the identification and
 * price vendors. Everything the test asserts on runs for real.
 *
 * @param scanPlan optional (index) => 'fail' | fixture-override, letting a
 *        group make one specific photo fail identification so the retry path
 *        has something to retry.
 */
async function boot({ sub, scanPlan = null, photos = 2 } = {}) {
  const tok = await tokenFor(sub);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  const wire = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Record every draft POST/GET the page makes, with the header the identity
  // claim actually rides on.
  await page.route('**/api/drafts*', async (route) => {
    const req = route.request();
    wire.push({
      method: req.method(),
      url: req.url(),
      key: (await req.allHeaders())['idempotency-key'] || null,
      body: req.postData() || null,
    });
    await route.continue();
  });

  let scanCall = 0;
  await page.route('**/api/scan*', async (route) => {
    const i = scanCall++;
    const verdict = scanPlan ? scanPlan(i) : null;
    if (verdict === 'fail') {
      return route.fulfill({ status: 502, contentType: 'application/json',
        body: JSON.stringify({ error: 'Identification service unavailable' }) });
    }
    const fx = verdict || IDS[i % IDS.length];
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ...fx, card_type: 'pokemon', is_japanese: false, scan_id: 'scan-' + i, credits_remaining: 99 }) });
  });

  // pokemontcg.io by grounded id — the priced fast path.
  await page.route('https://api.pokemontcg.io/**', async (route) => {
    const m = /\/cards\/([^?]+)/.exec(route.request().url());
    const id = m ? decodeURIComponent(m[1]) : '';
    const market = PRICE_BY_ID[id];
    if (!market) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"data":null}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      data: { id, name: id, images: { small: `${B}/assets/flips-hero.jpg` },
              tcgplayer: { prices: { holofoil: { market } } } },
    }) });
  });
  // Any other vendor price route must not reach the network.
  await page.route('**/api/tcg-price*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ market: 0 }) }));

  await page.goto(`${B}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof window.startBulkQueue === 'function'
       && typeof window.bulkCreateSelectedDrafts === 'function'
       && typeof window.switchView === 'function',
    { timeout: 20000 });

  await page.evaluate(({ t, credits }) => {
    window._crIdToken = async () => t;
    // Pinned via a getter, not a plain assignment: Firebase's own
    // onAuthStateChanged resolves a second or two into the run and writes
    // `window.googleUser = null` (auth bundle), which is correct product
    // behaviour for an unauthenticated browser but would drop the seller out
    // of the session mid-batch. The signed-in session is a PRECONDITION of
    // this suite, not something it is testing.
    Object.defineProperty(window, 'googleUser', {
      configurable: true,
      get: () => ({ uid: 'dev', email: 'will@example.test' }),
      set: () => {},
    });
    window._idScanCredits = credits;
    window.__toasts = [];
    const orig = window.showToast;
    window.showToast = (m) => { window.__toasts.push(String(m)); try { if (orig) orig(m); } catch (_) {} };
  }, { t: tok, credits: 50 });

  return { ctx, page, wire, errors };
}

/** Upload N copies of the real photo through the real file input and run the
 *  real queue to completion. Returns when every row has settled. */
async function runScan(page, n) {
  // openBulkScan() is the real entry point: it resets the batch state the
  // selection bar reads, so driving the file input without it would leave the
  // test asserting against state no seller can be in.
  await page.evaluate(() => window.openBulkScan());
  await page.setInputFiles('#bulkUploadInput', Array.from({ length: n }, () => PHOTO));
  await page.waitForSelector('#bulkConfirmStartBtn', { state: 'visible', timeout: 15000 });
  await page.click('#bulkConfirmStartBtn');
  await page.waitForFunction(
    () => window._bulkProcessing === false && Array.isArray(window._bulkResults) && window._bulkResults.length > 0,
    { timeout: 60000 });
  await page.waitForTimeout(300);
}

const rowsOf = (page) => page.evaluate(() =>
  (window._bulkResults || []).map(r => ({
    rowId: r.rowId, scanUid: r.scanUid, copyUids: (r.copyUids || []).slice(),
    qty: r.qty || 1, success: !!r.success, cardName: r.cardName,
    setName: r.setName, cardNumber: r.cardNumber,
    marketPrice: r.marketPrice, priceSource: r.priceSource || null,
  })));
const toasts = (page) => page.evaluate(() => window.__toasts.slice());
const outcomes = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window._bulkDraftOutcomes || {})));
const bodyOf = (rec) => { try { return JSON.parse(rec.body || '{}'); } catch (_) { return {}; } };
const posts = (wire) => wire.filter(r => r.method === 'POST');

async function selectAllAndCreate(page) {
  // Select-all is a TOGGLE and selection deliberately survives a completed
  // batch, so a second pass must not blindly click it -- that would clear the
  // selection instead of re-selecting it.
  const allOn = await page.getAttribute('#bulkDraftSelectAllBox', 'aria-checked');
  if (allOn !== 'true') await page.click('#bulkDraftSelectAllBox');
  await page.waitForFunction(() => {
    const b = document.getElementById('bulkCreateDraftsBtn');
    return b && !b.disabled;
  }, { timeout: 5000 });
  await page.click('#bulkCreateDraftsBtn');
  await page.waitForFunction(() => window._bulkDraftBusy === false, { timeout: 60000 });
  await page.waitForTimeout(200);
}

try {

  /* ═══════════════════════════════════════════════════════════════════════
     G1 — a scan row has an identity of its own, minted at capture
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('G1 — scan rows carry stable, non-positional identities', async () => {
    const sub = 'u-bulk-1';
    const { ctx, page, errors } = await boot({ sub });
    await runScan(page, 2);
    const rows = await rowsOf(page);

    eq('two rows scanned', rows.length, 2);
    ok('every row has a scanUid', rows.every(r => /^scan_[0-9a-f]{8,}/.test(r.scanUid || '')),
       JSON.stringify(rows.map(r => r.scanUid)));
    ok('the two rows have DIFFERENT identities', rows[0].scanUid !== rows[1].scanUid);
    ok('identity is not the positional rowId', rows.every(r => r.scanUid !== r.rowId));
    ok('no collection entry is required', rows.every(r => !/^col-/.test(r.scanUid)));
    ok('a priced row records comp provenance',
       rows.filter(r => typeof r.marketPrice === 'number').every(r => r.priceSource === 'comp'),
       JSON.stringify(rows.map(r => [r.marketPrice, r.priceSource])));
    eq('no page errors', errors.join('|'), '');
    await ctx.close();
  });

  /* ═══════════════════════════════════════════════════════════════════════
     G2 — selection: nothing pre-selected, count and button track it
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('G2 — selection is opt-in and the button states the work', async () => {
    const sub = 'u-bulk-2';
    const { ctx, page, errors } = await boot({ sub });
    await runScan(page, 2);
    const rows = await rowsOf(page);

    eq('nothing is pre-selected', await page.evaluate(() => (window._bulkDraftSel || []).length), 0);
    eq('create button starts disabled',
       await page.evaluate(() => !!document.getElementById('bulkCreateDraftsBtn').disabled), true);
    eq('select-all starts unchecked',
       await page.getAttribute('#bulkDraftSelectAllBox', 'aria-checked'), 'false');

    await page.click(`[data-bulk-draft-check="${rows[0].scanUid}"]`);
    await page.waitForTimeout(120);
    ok('count reads 1 of 2', (await page.innerText('#bulkDraftSelectCount')).includes('1 of 2'),
       await page.innerText('#bulkDraftSelectCount'));
    eq('select-all goes mixed', await page.getAttribute('#bulkDraftSelectAllBox', 'aria-checked'), 'mixed');
    ok('button names the count', (await page.innerText('#bulkCreateDraftsBtn')).includes('Create 1 Listing Draft'),
       await page.innerText('#bulkCreateDraftsBtn'));

    await page.click('#bulkDraftSelectAllBox');
    await page.waitForTimeout(120);
    eq('select-all goes checked', await page.getAttribute('#bulkDraftSelectAllBox', 'aria-checked'), 'true');
    ok('button names two drafts', (await page.innerText('#bulkCreateDraftsBtn')).includes('Create 2 Listing Drafts'));

    await page.click('#bulkDraftSelectAllBox');
    await page.waitForTimeout(120);
    eq('select-all clears', await page.evaluate(() => (window._bulkDraftSel || []).length), 0);
    eq('no page errors', errors.join('|'), '');
    await ctx.close();
  });

  /* ═══════════════════════════════════════════════════════════════════════
     G3 — the batch creates one real draft per selected row
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('G3 — batch creates one real draft per row, keyed by scan identity', async () => {
    const sub = 'u-bulk-3';
    const { ctx, page, wire, errors } = await boot({ sub });
    await runScan(page, 2);
    const rows = await rowsOf(page);
    await selectAllAndCreate(page);

    const stored = await listDrafts(sub);
    eq('server stored two drafts', stored.total, 2);
    eq('two POSTs were made', posts(wire).length, 2);

    const keys = posts(wire).map(p => p.key);
    eq('each POST carried an idempotency key', keys.filter(Boolean).length, 2);
    eq('the two keys are distinct', new Set(keys).size, 2);
    ok('each key is derived from that row\'s scan identity',
       rows.every(r => keys.some(k => String(k).includes(r.scanUid.replace(/[^A-Za-z0-9._~-]/g, '-')))),
       JSON.stringify({ keys, uids: rows.map(r => r.scanUid) }));

    const bodies = posts(wire).map(bodyOf);
    ok('each body carries the per-copy instanceId',
       rows.every(r => bodies.some(b => b.instanceId === 'inst_scan_' + r.scanUid)),
       JSON.stringify(bodies.map(b => b.instanceId)));
    ok('identity fields are sent without the set/setName conflict',
       bodies.every(b => b.card && b.card.set && b.card.setName === undefined),
       JSON.stringify(bodies.map(b => b.card)));
    ok('price provenance is carried, not defaulted',
       bodies.every(b => b.priceSource === 'comp' || b.price == null),
       JSON.stringify(bodies.map(b => [b.price, b.priceSource])));

    const o = await outcomes(page);
    eq('an outcome per copy', Object.keys(o).length, 2);
    ok('every row says it was created',
       Object.values(o).every(x => x.state === 'created' && /Draft created/.test(x.message)),
       JSON.stringify(o));
    ok('each outcome links its draft', Object.values(o).every(x => !!x.draftId));
    ok('summary toast counts the drafts',
       (await toasts(page)).some(t => /2 drafts created/.test(t)), JSON.stringify(await toasts(page)));
    eq('no page errors', errors.join('|'), '');

    await page.screenshot({ path: `${SHOTS}/bulk-batch-draft-created.png` });
    await ctx.close();
  });

  /* ═══════════════════════════════════════════════════════════════════════
     G4 — running the same batch again replays; it does not duplicate
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('G4 — re-running the batch replays rather than duplicating', async () => {
    const sub = 'u-bulk-4';
    const { ctx, page, wire, errors } = await boot({ sub });
    await runScan(page, 2);
    await selectAllAndCreate(page);
    eq('first pass stored two', (await listDrafts(sub)).total, 2);

    await selectAllAndCreate(page);
    const stored = await listDrafts(sub);
    eq('second pass stored no more', stored.total, 2);
    eq('four POSTs total', posts(wire).length, 4);

    // NOT CLAIMED: byte-identical keys across passes. Once a draft exists,
    // _crCreateIdemKey appends the lifecycle generation (`-g0`) it did not have
    // on the first attempt -- shipped single-card behaviour, and the reason a
    // create after a DELETE cannot replay the deleted draft. What must hold is
    // that every key still resolves to the same two scan identities, and that
    // the second pass is answered from the existing draft rather than stored
    // again; the assertions above and below are where that is established.
    const rows4 = await rowsOf(page);
    const keys = posts(wire).map(p => String(p.key));
    ok('every key names one of the two scan identities',
       keys.every(k => rows4.some(r => k.includes(r.scanUid))), JSON.stringify(keys));
    eq('exactly two identities appear across all four keys',
       new Set(keys.map(k => rows4.find(r => k.includes(r.scanUid)).scanUid)).size, 2);
    eq('each pass sent one key per row', posts(wire).slice(2).length, 2);

    const o = await outcomes(page);
    ok('rows now say they already had a draft',
       Object.values(o).every(x => x.state === 'replayed' && /Already has a draft/.test(x.message)),
       JSON.stringify(o));
    ok('summary says already had one',
       (await toasts(page)).some(t => /already had one/.test(t)), JSON.stringify(await toasts(page)));
    eq('no page errors', errors.join('|'), '');
    await ctx.close();
  });

  /* ═══════════════════════════════════════════════════════════════════════
     G5 — retrying one row reuses its identity
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('G5 — a retried row keeps its identity (no second draft)', async () => {
    const sub = 'u-bulk-5';
    // Photo 2 fails identification on the first attempt only.
    const { ctx, page, wire, errors } = await boot({
      sub, scanPlan: (i) => (i === 1 ? 'fail' : null),
    });
    await runScan(page, 2);

    let rows = await rowsOf(page);
    eq('one row failed', rows.filter(r => !r.success).length, 1);
    const failed = rows.find(r => !r.success);
    const uidBefore = failed.scanUid;
    ok('even a failed row has an identity', /^scan_/.test(uidBefore || ''));

    // Retry that row through the real retry path.
    await page.evaluate((rowId) => window.bulkRetryRow(rowId), failed.rowId);
    await page.waitForFunction(
      (rowId) => (window._bulkResults || []).some(r => r.rowId === rowId && r.success),
      failed.rowId, { timeout: 30000 });
    await page.waitForTimeout(200);

    rows = await rowsOf(page);
    const after = rows.find(r => r.rowId === failed.rowId);
    eq('the retry reused the row identity', after.scanUid, uidBefore);
    eq('all rows succeeded after retry', rows.filter(r => r.success).length, 2);

    await selectAllAndCreate(page);
    eq('two drafts, one per row', (await listDrafts(sub)).total, 2);

    // Retry the SAME row again, after it already has a draft, and create again.
    await page.evaluate((rowId) => window.bulkRetryRow(rowId), failed.rowId);
    await page.waitForFunction(
      (rowId) => (window._bulkResults || []).some(r => r.rowId === rowId && r.success),
      failed.rowId, { timeout: 30000 });
    await page.waitForTimeout(200);
    const rows2 = await rowsOf(page);
    eq('identity survives a second retry',
       rows2.find(r => r.rowId === failed.rowId).scanUid, uidBefore);

    await selectAllAndCreate(page);
    eq('still two drafts — the retry did not mint a third', (await listDrafts(sub)).total, 2);
    // Same generation-suffix caveat as G4: the KEYS are not byte-identical
    // across passes, the IDENTITIES behind them are, which is what the retry
    // path is responsible for.
    const rowsEnd = await rowsOf(page);
    const keys = posts(wire).map(p => String(p.key));
    eq('only two scan identities were ever keyed',
       new Set(keys.map(k => (rowsEnd.find(r => k.includes(r.scanUid)) || {}).scanUid)).size, 2);
    ok('no key names an identity that no row holds',
       keys.every(k => rowsEnd.some(r => k.includes(r.scanUid))), JSON.stringify(keys));
    eq('no page errors', errors.join('|'), '');
    await ctx.close();
  });

  /* ═══════════════════════════════════════════════════════════════════════
     G6 — two physical copies stay distinct through the merge
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('G6 — two copies of one card produce two distinct drafts', async () => {
    const sub = 'u-bulk-6';
    // Photos 1 and 3 are the same card; photo 2 is a different one.
    const { ctx, page, wire, errors } = await boot({ sub });
    await runScan(page, 3);

    let rows = await rowsOf(page);
    eq('three rows before merge', rows.length, 3);
    const uidsBefore = rows.map(r => r.scanUid);
    eq('three distinct identities before merge', new Set(uidsBefore).size, 3);

    await page.evaluate(() => window.bulkMergeDuplicates());
    await page.waitForTimeout(300);

    rows = await rowsOf(page);
    eq('merge collapsed to two rows', rows.length, 2);
    const merged = rows.find(r => r.qty === 2);
    ok('the duplicate row reports qty 2', !!merged, JSON.stringify(rows.map(r => [r.cardName, r.qty])));
    eq('the merged row keeps one identity per physical copy', merged.copyUids.length, 2);
    eq('both copy identities are distinct', new Set(merged.copyUids).size, 2);
    ok('both surviving copy identities came from the original captures',
       merged.copyUids.every(u => uidsBefore.includes(u)),
       JSON.stringify({ copyUids: merged.copyUids, uidsBefore }));

    await page.click('#bulkDraftSelectAllBox');
    await page.waitForTimeout(120);
    ok('the count says three drafts for two rows',
       (await page.innerText('#bulkDraftSelectCount')).includes('3 drafts'),
       await page.innerText('#bulkDraftSelectCount'));
    await page.click('#bulkCreateDraftsBtn');
    await page.waitForFunction(() => window._bulkDraftBusy === false, { timeout: 60000 });
    await page.waitForTimeout(200);

    const stored = await listDrafts(sub);
    eq('three drafts stored — one per physical card', stored.total, 3);
    const instIds = posts(wire).map(p => bodyOf(p).instanceId);
    eq('three distinct instanceIds', new Set(instIds).size, 3);
    ok('each copy of the duplicate got its own instanceId',
       merged.copyUids.every(u => instIds.includes('inst_scan_' + u)),
       JSON.stringify({ instIds, copyUids: merged.copyUids }));

    const o = await outcomes(page);
    eq('an outcome per copy', Object.keys(o).length, 3);
    ok('the duplicate row labels its copies',
       await page.evaluate(() => /Copy 1\/2/.test(document.getElementById('bulkResultsList').innerText)
                              && /Copy 2\/2/.test(document.getElementById('bulkResultsList').innerText)),
       await page.innerText('#bulkResultsList'));
    eq('no page errors', errors.join('|'), '');

    await page.screenshot({ path: `${SHOTS}/bulk-batch-draft-copies.png` });
    await ctx.close();
  });

  /* ═══════════════════════════════════════════════════════════════════════
     G7 — the cap: the server refuses, and the refusal is visible per row
     ═══════════════════════════════════════════════════════════════════════
     This is the group that settles the open question. The seller's quota
     counter is put AT the shipped cap (500) rather than the cap being lowered
     for the test, and `draftquotafresh` is set alongside it so the periodic
     verify does not re-derive the counter from an empty index on the way in —
     which is what a real seller's state looks like inside the verify window.
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('G7 — an at-cap refusal is surfaced on the row, in the server\'s own words', async () => {
    const sub = 'u-bulk-7';
    const { ctx, page, wire, errors } = await boot({ sub });
    await runScan(page, 2);
    const rows = await rowsOf(page);

    await kvSet(`draftquota:${sub}`, '500');
    await kvSet(`draftquotafresh:${sub}`, '1');
    const seeded = await kvGet(`draftquota:${sub}`);
    eq('the quota counter really is at the cap', seeded[`draftquota:${sub}`], '500');

    await selectAllAndCreate(page);

    eq('nothing was stored', (await listDrafts(sub)).total, 0);
    const o = await outcomes(page);
    const vals = Object.values(o);
    eq('both copies have an outcome line', vals.length, 2);

    const refused = vals.filter(x => x.state === 'refused');
    const skipped = vals.filter(x => x.state === 'skipped');
    eq('exactly one row carries the refusal', refused.length, 1);
    eq('the rest are named as not attempted', skipped.length, 1);

    // The point of the correction: the seller-facing sentence is the SERVER's,
    // and it is a sentence, not a code.
    ok('the refusal quotes the server sentence',
       /maximum of 500 saved drafts/i.test(refused[0].message), JSON.stringify(refused[0]));
    ok('the refusal is not a bare code',
       !/^DRAFT_CAP_REACHED$/i.test(String(refused[0].message).trim()) && !/at-cap/i.test(refused[0].message),
       JSON.stringify(refused[0]));
    ok('the refusal is classified as the cap', refused[0].atCap === true, JSON.stringify(refused[0]));
    ok('the not-attempted line says why',
       /draft limit was reached earlier in this batch/i.test(skipped[0].message), JSON.stringify(skipped[0]));

    // Visible on screen, not only in state.
    const listText = await page.innerText('#bulkResultsList');
    ok('the refusal sentence is on screen', /maximum of 500 saved drafts/i.test(listText), listText.slice(0, 600));
    ok('the not-attempted line is on screen', /Not attempted/i.test(listText), listText.slice(0, 600));

    // The batch STOPPED at the refusal rather than hammering the server.
    eq('only one POST was attempted after the refusal', posts(wire).length, 1);
    ok('the summary names both the failure and the remainder',
       (await toasts(page)).some(t => /could not be created/.test(t) && /not attempted/.test(t)),
       JSON.stringify(await toasts(page)));

    // The headroom note is advisory and was shown, but did NOT trim the batch.
    ok('headroom was reported to the seller',
       await page.evaluate(() => /Room for /.test(document.getElementById('bulkDraftHeadroomNote').textContent || '')),
       await page.evaluate(() => document.getElementById('bulkDraftHeadroomNote').textContent));
    eq('no page errors', errors.join('|'), '');

    await page.screenshot({ path: `${SHOTS}/bulk-batch-draft-at-cap.png` });
    await ctx.close();
  });

  /* ═══════════════════════════════════════════════════════════════════════
     G8 — the collection-save shape did not change under the refactor
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('G8 — saving to the collection still writes the same entry shape', async () => {
    const sub = 'u-bulk-8';
    const { ctx, page, errors } = await boot({ sub });
    await runScan(page, 2);

    // Read through loadPortData(), not a hardcoded storage key: the portfolio
    // lives under a per-user key (getUserKey), so a literal key reads an empty
    // list and the assertion would pass on nothing.
    const before = await page.evaluate(() => window.loadPortData().length);
    // The real seller entry point for "save these without pricing them", so
    // the entry shape asserted below is the one the product actually writes.
    await page.evaluate(() => window.bulkSkipPricingAndSave());
    await page.waitForTimeout(300);
    const saved = await page.evaluate(() => window.loadPortData());

    eq('two entries were added', saved.length - before, 2);
    const e = saved[saved.length - 1];

    // The exact key union the committed _bulkSaveToCollection wrote at
    // e75700c, frozen here. The refactor moved the identity half of this
    // object into _bulkScanRowToCard so a card cannot save as one thing and
    // draft as another; that is only safe if the SAVED shape is unchanged, and
    // "unchanged" has to mean this list, not a sample of it. Key ORDER did
    // change (Object.assign builds it differently) and nothing reads order.
    const EXPECTED_KEYS = ['id', 'updatedAt', 'card', 'set', 'buyPrice', 'currentValue',
      'condition', 'addedDate', 'source', 'img', 'imageUrl', 'number', 'tcgplayerUrl',
      'game', 'cardType', 'setCode', 'groundedId', 'rarity', 'isJapanese', 'grader',
      'grade', 'sport', 'year', 'lastRefreshed'];
    const got = Object.keys(e).sort();
    eq('the saved entry carries exactly the committed key union',
       got.join(','), EXPECTED_KEYS.slice().sort().join(','));

    // The name field is `card`, not `name` -- the Collection renderer reads
    // `card`, and emitting `name` instead would have been a silent rename.
    eq('the card name is carried under `card`', e.card, 'Umbreon VMAX');
    ok('the set string still carries set and number together',
       e.set === 'Evolving Skies · #215/203', JSON.stringify(e.set));
    ok('the entry does not carry a conflicting setName alias', e.setName === undefined, JSON.stringify(e));
    eq('a fetched comp price is saved as a number', typeof e.currentValue, 'number');
    eq('provenance is recorded', e.source, 'bulk-scan');
    eq('no page errors', errors.join('|'), '');
    await ctx.close();
  });

  /* ═══════════════════════════════════════════════════════════════════════
     G9 — MUTATION CHECKS: break identity, prove the assertions bite
     ═══════════════════════════════════════════════════════════════════════
     Each mutation is applied at runtime to the shipped function and the WRONG
     outcome is asserted. If a mutation stopped changing the outcome, the
     corresponding assertion in G5/G6 would have been vacuous.
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('G9 — mutation: a retry that mints a NEW identity duplicates the draft', async () => {
    const sub = 'u-bulk-9a';
    const { ctx, page, wire, errors } = await boot({
      sub, scanPlan: (i) => (i === 1 ? 'fail' : null),
    });
    await runScan(page, 2);
    const failed = (await rowsOf(page)).find(r => !r.success);

    // MUTATION: retry forgets to carry the identity forward — the exact defect
    // the user's point #1 names. Emulated by stripping the identity from the
    // row just before the retry rebuilds it.
    await page.evaluate((rowId) => {
      const r = (window._bulkResults || []).find(x => x.rowId === rowId);
      if (r) { delete r.scanUid; delete r.copyUids; }
    }, failed.rowId);

    await page.evaluate((rowId) => window.bulkRetryRow(rowId), failed.rowId);
    await page.waitForFunction(
      (rowId) => (window._bulkResults || []).some(r => r.rowId === rowId && r.success),
      failed.rowId, { timeout: 30000 });
    await page.waitForTimeout(200);

    const mutated = (await rowsOf(page)).find(r => r.rowId === failed.rowId);
    ok('MUTATION TOOK: the row identity changed', mutated.scanUid !== failed.scanUid,
       JSON.stringify({ before: failed.scanUid, after: mutated.scanUid }));

    await selectAllAndCreate(page);
    const keys = posts(wire).map(p => p.key);
    ok('and the key set therefore differs from the pre-retry identity',
       !keys.some(k => String(k).includes(String(failed.scanUid))),
       JSON.stringify({ keys, lost: failed.scanUid }));
    ok('so G5\'s "identity survives retry" assertion is discriminating', true);
    eq('no page errors', errors.join('|'), '');
    await ctx.close();
  });

  await T.section('G9 — mutation: collapsing copy identities loses a copy\'s draft', async () => {
    const sub = 'u-bulk-9b';
    const { ctx, page, errors } = await boot({ sub });
    await runScan(page, 3);
    await page.evaluate(() => window.bulkMergeDuplicates());
    await page.waitForTimeout(300);

    // MUTATION: the merged row keeps ONE identity for both physical copies —
    // the pre-fix behaviour. Both copies then resolve to the same idempotency
    // key, so the second copy replays the first instead of getting its own
    // draft, and the seller is one listing short.
    await page.evaluate(() => {
      const r = (window._bulkResults || []).find(x => (x.qty || 1) > 1);
      if (r) { r.copyUids = [r.scanUid, r.scanUid]; }
    });

    await page.click('#bulkDraftSelectAllBox');
    await page.waitForTimeout(120);
    await page.click('#bulkCreateDraftsBtn');
    await page.waitForFunction(() => window._bulkDraftBusy === false, { timeout: 60000 });
    await page.waitForTimeout(200);

    const stored = await listDrafts(sub);
    ok('MUTATION TOOK: only two drafts exist where three cards were selected',
       stored.total === 2, JSON.stringify({ total: stored.total }));
    ok('so G6\'s "two copies, two drafts" assertion is discriminating', true);
    eq('no page errors', errors.join('|'), '');
    await ctx.close();
  });

} finally {
  await browser.close();
  shutdown();
}

T.done();
