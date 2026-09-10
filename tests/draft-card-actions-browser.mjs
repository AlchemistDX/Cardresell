/**
 * tests/draft-card-actions-browser.mjs — Edit, Delete and Download from the
 * draft card, in a real browser, against the real handler and a real store.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The three card actions have rendering functions, a PATCH route with server
 * suites, and a delete executor already exercised by draft-delete-browser.
 * None of that establishes that a seller can change a price on the card, save
 * it, reload the page and find the change still there. "The buttons exist" is
 * not the claim being made here; the claim is that the seller actions work.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT
 * ---------------------------------
 * Real: the browser, the shipped bundle, the shipped index.html, the real
 * api/drafts.js handler, real store code, real RS256 verification, real
 * idempotency records, real revision conflicts.
 *
 * Substituted by tools/dev-draft-server.mjs and named so nobody mistakes them
 * for verified: Google's JWKS (a locally minted keypair, still verified) and
 * Upstash (an in-memory map speaking the same REST shape). The Lua scripts are
 * the suites' JS re-implementation, not Redis executing them, and TTL is not
 * modelled — so nothing here claims either.
 *
 * NOT ESTABLISHED BY THIS FILE: that eBay accepts the downloaded CSV. This
 * asserts the file's columns and values against eBay's published Create-Drafts
 * template; no upload to a seller account has been performed.
 *
 * Run: node tests/draft-card-actions-browser.mjs
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = '/home/user/node_modules/playwright/index.js';
const PORT = Number(process.env.CR_CARD_ACTIONS_PORT || 8329);
const B = `http://127.0.0.1:${PORT}`;
const SLOT = 'ebay:fixed-price';
const SHOTS = process.env.CR_SHOT_DIR || '/home/user/workspace/shots';

const T = harness('draft-card-actions-browser');

/* Two spellings over the harness's `check`, so an equality failure prints both
   sides instead of the word "false". Neither adds a code path: both end in
   T.check, which is what counts the run. */
const eq = (name, actual, expected) =>
  T.check(name, Object.is(actual, expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const ok = (name, cond, hint) => T.check(name, !!cond, hint);

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

const CARD = { name: 'Charizard VMAX', set: 'Champions Path', number: '074/073', game: 'pokemon' };

async function apiCreate(sub, instanceId, key, over = {}) {
  const tok = await tokenFor(sub);
  const r = await fetch(`${B}/api/drafts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, 'Idempotency-Key': key },
    body: JSON.stringify({ card: CARD, instanceId, slot: SLOT, price: 32.84, priceSource: 'comp', ...over }),
  });
  const j = await r.json().catch(() => ({}));
  const id = (j.draft && j.draft.draftId) || j.draftId || null;
  if (!id) throw new Error(`seed create failed: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return { status: r.status, id };
}

async function apiRead(sub, id) {
  const tok = await tokenFor(sub);
  const r = await fetch(`${B}/api/drafts?id=${encodeURIComponent(id)}`, { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json().catch(() => ({}));
  const d = j.draft || {};
  return { status: r.status, code: j.code, rev: d.rev, price: d.price, title: d.title,
           priceSource: d.priceSource, packet: j.packet || null };
}

async function apiPatch(sub, id, rev, body) {
  const tok = await tokenFor(sub);
  const r = await fetch(`${B}/api/drafts?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, 'Idempotency-Key': `seed-${id}-r${rev}` },
    body: JSON.stringify({ expectedRev: rev, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, rev: j.draft && j.draft.rev };
}

const { chromium } = (await import(PW)).default;
const browser = await chromium.launch();

async function boot({ sub, collection = [], viewport = { width: 1280, height: 900 } } = {}) {
  const tok = await tokenFor(sub);
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((rows) => {
    try { localStorage.setItem('cardsell_portfolio', JSON.stringify(rows)); } catch (_) {}
  }, collection);

  const wire = [];
  let plan = null;
  await page.route('**/api/drafts*', async (route) => {
    const req = route.request();
    const rec = {
      method: req.method(),
      url: req.url(),
      key: (await req.allHeaders())['idempotency-key'] || null,
      body: req.postData() || null,
    };
    wire.push(rec);
    if (plan) {
      const verdict = await plan(rec, route, wire.length - 1);
      if (verdict === 'handled') return;
    }
    await route.continue();
  });

  await page.goto(`${B}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof window.renderDraftsView === 'function' && typeof window.switchView === 'function',
    { timeout: 20000 });
  await page.evaluate((t) => { window._crIdToken = async () => t; }, tok);
  await page.evaluate(() => {
    window.__toasts = [];
    const orig = window.showToast;
    window.showToast = (m) => { window.__toasts.push(String(m)); try { if (orig) orig(m); } catch (_) {} };
  });
  return { ctx, page, wire, errors, setPlan: (fn) => { plan = fn; } };
}

/** Open the drafts list and wait for the rows to be painted. */
async function openList(page) {
  // switchView is the real entry point -- renderDraftsView alone paints rows
  // into a container the seller cannot see, and a click on an invisible button
  // is not the thing being tested.
  await page.evaluate(() => window.switchView('drafts'));
  await page.waitForFunction(
    () => window._draftsState && window._draftsState.loading === false,
    { timeout: 20000 },
  );
  await page.waitForTimeout(250);
}

const toasts = (page) => page.evaluate(() => window.__toasts.slice());
const settle = (page, ms = 500) => page.waitForTimeout(ms);
const cardSel = (id) => `.draft-card[data-draft-id="${id}"]`;
const bodyOf = (rec) => { try { return JSON.parse(rec.body || '{}'); } catch (_) { return {}; } };
const patches = (wire) => wire.filter((r) => r.method === 'PATCH');
const deletes = (wire) => wire.filter((r) => r.method === 'DELETE');

try {

  /* ═══════════════════════════════════════════════════════════════════════
     GROUP 1 — the card shows the four things a seller scans for
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('G1 — the card shows the four things a seller scans for', async () => {
    const sub = 'u-card-1';
    const { ctx, page, errors } = await boot({ sub });
    const { id } = await apiCreate(sub, 'inst-1', 'seed-card-actions-1-0000-0000');
    await openList(page);

    const card = page.locator(cardSel(id));
    eq('card is on screen', await card.count(), 1);
    ok('title rendered', (await card.locator('.draft-row-title').innerText()).includes('Charizard'));
    ok('price rendered', (await card.locator('.draft-row-price').innerText()).includes('32.84'));
    eq('readiness rendered', (await card.locator('.draft-row-ready').count()), 1);
    eq('thumbnail slot rendered', (await card.locator('.draft-row-thumb').count()), 1);
    eq('three actions', await card.locator('.draft-card-actions .draft-act').count(), 3);
    eq('no page errors', errors.join('|'), '');
    await ctx.close();
  });

  /* ═══════════════════════════════════════════════════════════════════════
     GROUP 2 — EDIT: change, save, reload, reopen, still there
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('G2 — EDIT: change, save, reload, reopen, still there', async () => {
    const sub = 'u-card-2';
    const { ctx, page, wire, errors } = await boot({ sub });
    const { id } = await apiCreate(sub, 'inst-2', 'seed-card-actions-2-0000-0000');
    await openList(page);

    await page.click(`${cardSel(id)} [data-draft-edit]`);
    await settle(page, 200);
    eq('edit panel open', await page.locator(`${cardSel(id)} .draft-edit`).count(), 1);

    await page.fill(`${cardSel(id)} [data-edit-field="title"]`, 'Charizard VMAX 074/073 PSA 9');
    await page.fill(`${cardSel(id)} [data-edit-field="price"]`, '41.00');
    await page.click(`${cardSel(id)} [data-edit-save]`);
    await settle(page, 900);

    const p = patches(wire);
    eq('exactly one PATCH', p.length, 1);
    ok('PATCH carried expectedRev', bodyOf(p[0]).expectedRev === 1);
    ok('PATCH carried an idempotency key', typeof p[0].key === 'string' && p[0].key.length > 0);
    ok('client did not send priceSource', !('priceSource' in bodyOf(p[0])));

    const after = await apiRead(sub, id);
    eq('server stored the new price', after.price, 41);
    eq('server stored the new title', after.title, 'Charizard VMAX 074/073 PSA 9');
    eq('server rev advanced', after.rev, 2);
    eq('manual price is seller-provenance', after.priceSource, 'seller');

    // Reload the whole page, not just the list: a value only in memory would
    // survive a repaint and not survive this.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
    () => typeof window.renderDraftsView === 'function' && typeof window.switchView === 'function',
    { timeout: 20000 });
    await page.evaluate((t) => { window._crIdToken = async () => t; }, await tokenFor(sub));
    await openList(page);
    const card = page.locator(cardSel(id));
    ok('title survives a full reload', (await card.locator('.draft-row-title').innerText()).includes('PSA 9'));
    ok('price survives a full reload', (await card.locator('.draft-row-price').innerText()).includes('41.00'));

    // Reopen the editor: it must seed from the reloaded row, not from a stale
    // copy of what was typed.
    await page.click(`${cardSel(id)} [data-draft-edit]`);
    await settle(page, 200);
    eq('editor reopens with the saved title',
      await page.inputValue(`${cardSel(id)} [data-edit-field="title"]`), 'Charizard VMAX 074/073 PSA 9');
    eq('editor reopens with the saved price',
      await page.inputValue(`${cardSel(id)} [data-edit-field="price"]`), '41.00');
    eq('no page errors', errors.join('|'), '');
    await ctx.close();
  });

  /* ═══════════════════════════════════════════════════════════════════════
     GROUP 3 — EDIT under a revision conflict: the typing survives
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('G3 — EDIT under a revision conflict: the typing survives', async () => {
    const sub = 'u-card-3';
    const { ctx, page, errors } = await boot({ sub });
    const { id } = await apiCreate(sub, 'inst-3', 'seed-card-actions-3-0000-0000');
    await openList(page);

    await page.click(`${cardSel(id)} [data-draft-edit]`);
    await settle(page, 200);
    await page.fill(`${cardSel(id)} [data-edit-field="price"]`, '55.25');
    await page.fill(`${cardSel(id)} [data-edit-field="title"]`, 'My unsaved title');

    // Somebody else advances the draft between the seed and the save.
    const moved = await apiPatch(sub, id, 1, { title: 'Changed elsewhere' });
    eq('the other writer won', moved.status, 200);

    await page.click(`${cardSel(id)} [data-edit-save]`);
    await settle(page, 1000);

    eq('the editor is still open', await page.locator(`${cardSel(id)} .draft-edit`).count(), 1);
    eq('the typed price is still in the field',
      await page.inputValue(`${cardSel(id)} [data-edit-field="price"]`), '55.25');
    eq('the typed title is still in the field',
      await page.inputValue(`${cardSel(id)} [data-edit-field="title"]`), 'My unsaved title');
    const err = await page.locator(`${cardSel(id)} .draft-edit-conflict`).innerText();
    ok('a conflict is explained, not swallowed', /chang|updat|elsewhere|again/i.test(err));

    const still = await apiRead(sub, id);
    eq('the conflicting save did not land', still.title, 'Changed elsewhere');
    eq('rev did not advance twice', still.rev, 2);
    eq('no page errors', errors.join('|'), '');
    await ctx.close();
  });

  /* ═══════════════════════════════════════════════════════════════════════
     GROUP 4 — DELETE from the card: cancel, then confirm
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('G4 — DELETE from the card: cancel, then confirm', async () => {
    const sub = 'u-card-4';
    const { ctx, page, wire, errors } = await boot({ sub });
    const { id } = await apiCreate(sub, 'inst-4', 'seed-card-actions-4-0000-0000');
    await openList(page);

    await page.click(`${cardSel(id)} [data-draft-delete]`);
    await settle(page, 200);
    eq('confirmation shown', await page.locator(`${cardSel(id)} .draft-del`).count(), 1);
    await page.click(`${cardSel(id)} [data-delete-cancel]`);
    await settle(page, 200);
    eq('cancel closes it', await page.locator(`${cardSel(id)} .draft-del`).count(), 0);
    eq('cancel sent no DELETE', deletes(wire).length, 0);
    eq('the draft is still there', (await apiRead(sub, id)).status, 200);

    await page.click(`${cardSel(id)} [data-draft-delete]`);
    await settle(page, 200);
    await page.click(`${cardSel(id)} [data-delete-go]`);
    await settle(page, 1200);

    const d = deletes(wire);
    eq('exactly one DELETE', d.length, 1);
    ok('DELETE carried expectedRev', bodyOf(d[0]).expectedRev === 1);
    ok('DELETE carried an idempotency key', typeof d[0].key === 'string' && d[0].key.length > 0);
    eq('the draft is gone on the server', (await apiRead(sub, id)).status, 410);
    eq('the card left the list', await page.locator(cardSel(id)).count(), 0);
    ok('the seller was told', (await toasts(page)).join('|').length > 0);
    eq('no page errors', errors.join('|'), '');
    await ctx.close();
  });

  /* ═══════════════════════════════════════════════════════════════════════
     GROUP 5 — DELETE with the response lost: reconcile, do not double-ask
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('G5 — DELETE with the response lost: reconcile, do not double-ask', async () => {
    const sub = 'u-card-5';
    const { ctx, page, wire, errors, setPlan } = await boot({ sub });
    const { id } = await apiCreate(sub, 'inst-5', 'seed-card-actions-5-0000-0000');
    await openList(page);

    // The DELETE reaches the server and the answer never comes back. The
    // client cannot tell that from "never arrived", which is the whole point.
    setPlan(async (rec, route) => {
      if (rec.method !== 'DELETE') return null;
      const tok = await tokenFor(sub);
      await fetch(`${B}/api/drafts?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, 'Idempotency-Key': rec.key },
        body: rec.body,
      });
      await route.abort('failed');
      return 'handled';
    });

    await page.click(`${cardSel(id)} [data-draft-delete]`);
    await settle(page, 200);
    await page.click(`${cardSel(id)} [data-delete-go]`);
    await settle(page, 1500);

    eq('the server did delete it', (await apiRead(sub, id)).status, 410);
    ok('the client reconciled rather than reporting a failure',
      await page.evaluate((i) => !document.querySelector(`.draft-card[data-draft-id="${i}"]`), id));
    ok('a GET followed the lost DELETE',
      wire.some((r, n) => r.method === 'DELETE' && wire.slice(n + 1).some((q) => q.method === 'GET')));
    eq('no page errors', errors.join('|'), '');
    await ctx.close();
  });

  /* ═══════════════════════════════════════════════════════════════════════
     GROUP 6 — DOWNLOAD: a real file, with eBay's Create-Drafts columns
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('G6 — DOWNLOAD: a real file, with eBay\'s Create-Drafts columns', async () => {
    const sub = 'u-card-6';
    const { ctx, page, errors } = await boot({ sub });
    const { id } = await apiCreate(sub, 'inst-6', 'seed-card-actions-6-0000-0000');
    const seeded = await apiRead(sub, id);
    await openList(page);

    const waitDl = page.waitForEvent('download', { timeout: 15000 });
    await page.click(`${cardSel(id)} [data-draft-download]`);
    const dl = await waitDl;
    const file = await dl.path();
    const text = await (await import('node:fs/promises')).readFile(file, 'utf8');
    await settle(page, 400);

    ok('the file is named for the draft', /\.csv$/.test(dl.suggestedFilename()));
    ok('CRLF line endings', text.includes('\r\n'));

    const [head, row] = text.trim().split('\r\n');
    const cols = head.split(',');
    const cells = row.match(/("([^"]|"")*"|[^,]*)/g).filter((_, n) => n % 2 === 0);
    const at = (name) => {
      const i = cols.indexOf(name);
      if (i < 0) return null;
      let v = cells[i] || '';
      if (v.startsWith('"')) v = v.slice(1, -1).replace(/""/g, '"');
      return v;
    };

    // Columns and values from eBay's Create-Drafts template documentation.
    eq('Action is Draft, not Add', at('Action'), 'Draft');
    eq('Format is FixedPrice', at('Format'), 'FixedPrice');
    eq('Duration is GTC', at('Duration'), 'GTC');
    ok('Start price has no currency symbol', /^\d+\.\d{2}$/.test(at('Start price')));
    eq('Start price is the draft price', at('Start price'), '32.84');
    eq('Quantity present', at('Quantity'), '1');
    ok('Title within eBay\u2019s 80 characters', (at('Title') || '').length > 0 && at('Title').length <= 80);
    ok('Category ID is the packet category',
      seeded.packet ? at('Category ID') === String(seeded.packet.category.id) : at('Category ID') === '');
    ok('Description present', (at('Description') || '').length > 0);
    ok('no newline survived into a field', !/\n/.test(row));

    // The three deliberate omissions, each of which the panel must explain.
    eq('no photo column, because a local file cannot travel in this file',
      cols.filter((c) => /photo/i.test(c)).length, 0);
    eq('no condition column, because descriptor value ids are unresolved',
      cols.filter((c) => /^Condition/i.test(c)).length, 0);
    eq('no item-specific columns, because aspect values are unverified',
      cols.filter((c) => /^C:/.test(c)).length, 0);

    const panel = await page.locator(`${cardSel(id)} .draft-dl`).innerText();
    ok('the panel says where to upload it', /Seller Hub/i.test(panel));
    ok('the panel says it makes a draft, not a live listing', /draft listing, not a live one/i.test(panel));
    ok('the panel says photos are attached on eBay', /photo/i.test(panel) && /Drafts folder/i.test(panel));
    ok('the panel says condition is picked on eBay', /condition/i.test(panel));
    ok('the panel says account settings are not in the file', /shipping|returns|location/i.test(panel));

    // ACCESS. Upload lives behind Seller Hub Reports and not every account has
    // it: eBay opts business sellers in automatically, private sellers need at
    // least one sale first. The app cannot detect which a seller is -- there is
    // no authorized eBay session here -- so it must SAY so, and a download that
    // ends at a tab the seller cannot open is the failure being prevented.
    ok('the panel discloses that upload needs Seller Hub Reports access',
      /Seller Hub Reports/i.test(panel));
    ok('the disclosure names the business-seller case',
      /business sellers/i.test(panel));
    ok('the disclosure names the private-seller precondition',
      /private sellers/i.test(panel) && /at least one sale/i.test(panel));
    eq('no page errors', errors.join('|'), '');
    await ctx.close();
  });

  /* ═══════════════════════════════════════════════════════════════════════
     GROUP 7 — the same three actions at 375px
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('G7 — the same three actions at 375px', async () => {
    const sub = 'u-card-7';
    const { ctx, page, errors } = await boot({ sub, viewport: { width: 375, height: 812 } });
    const { id } = await apiCreate(sub, 'inst-7', 'seed-card-actions-7-0000-0000');
    await openList(page);

    const card = page.locator(cardSel(id));
    const box = await card.boundingBox();
    ok('the card fits the viewport', box.width <= 375);

    const acts = card.locator('.draft-card-actions .draft-act');
    for (let i = 0; i < 3; i += 1) {
      const b = await acts.nth(i).boundingBox();
      ok(`action ${i + 1} meets the 44px touch height`, b.height >= 44);
      ok(`action ${i + 1} is inside the viewport`, b.x >= 0 && b.x + b.width <= 375);
    }
    // Buttons on one line at 375px, not stacked and not overflowing.
    const ys = [];
    for (let i = 0; i < 3; i += 1) ys.push((await acts.nth(i).boundingBox()).y);
    ok('actions share one row', Math.max(...ys) - Math.min(...ys) < 2);

    const noOverflow = await page.evaluate(() => {
      const el = document.getElementById('draftsWrap');
      return el ? el.scrollWidth <= el.clientWidth + 1 : false;
    });
    ok('the list does not scroll sideways', noOverflow);

    await page.screenshot({ path: `${SHOTS}/draft-card-375-list.png`, fullPage: false });
    await page.click(`${cardSel(id)} [data-draft-edit]`);
    await settle(page, 250);
    const inp = await page.locator(`${cardSel(id)} [data-edit-field="price"]`).boundingBox();
    ok('the price field meets the 44px touch height', inp.height >= 44);
    ok('the price field is inside the viewport', inp.x >= 0 && inp.x + inp.width <= 375);
    await page.screenshot({ path: `${SHOTS}/draft-card-375-edit.png`, fullPage: false });

    await page.click(`${cardSel(id)} [data-edit-cancel]`);
    await page.click(`${cardSel(id)} [data-draft-delete]`);
    await settle(page, 250);
    await page.screenshot({ path: `${SHOTS}/draft-card-375-delete.png`, fullPage: false });
    await page.click(`${cardSel(id)} [data-delete-cancel]`);

    const waitDl = page.waitForEvent('download', { timeout: 15000 });
    await page.click(`${cardSel(id)} [data-draft-download]`);
    await waitDl;
    await settle(page, 500);
    eq('the download panel renders on a phone',
      await page.locator(`${cardSel(id)} .draft-dl`).count(), 1);
    const dlBox = await page.locator(`${cardSel(id)} .draft-dl`).boundingBox();
    ok('the download panel is inside the viewport', dlBox.x >= 0 && dlBox.x + dlBox.width <= 375);
    await page.screenshot({ path: `${SHOTS}/draft-card-375-download.png`, fullPage: false });
    eq('no page errors', errors.join('|'), '');
    await ctx.close();
  });

  /* ═══════════════════════════════════════════════════════════════════════
     GROUP 8 — desktop evidence shots
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('G8 — desktop evidence shots', async () => {
    const sub = 'u-card-8';
    const { ctx, page } = await boot({ sub });
    const { id } = await apiCreate(sub, 'inst-8', 'seed-card-actions-8-0000-0000');
    await openList(page);
    await page.screenshot({ path: `${SHOTS}/draft-card-desktop-list.png` });
    await page.click(`${cardSel(id)} [data-draft-edit]`);
    await settle(page, 250);
    await page.screenshot({ path: `${SHOTS}/draft-card-desktop-edit.png` });
    await page.click(`${cardSel(id)} [data-edit-cancel]`);
    const waitDl = page.waitForEvent('download', { timeout: 15000 });
    await page.click(`${cardSel(id)} [data-draft-download]`);
    await waitDl;
    await settle(page, 500);
    await page.screenshot({ path: `${SHOTS}/draft-card-desktop-download.png` });
    await ctx.close();
  });

} finally {
  await browser.close();
  shutdown();
}

T.done();
