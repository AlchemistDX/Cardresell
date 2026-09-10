/**
 * tests/draft-delete-browser.mjs — delete and recreate, in a real browser,
 * against the real handler and a real store.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The D8 delete path had server suites and a client implementation, and
 * NOTHING in between: no registered check drove the confirmation, the
 * reconcile, the 410 stop or the adoption notice through a browser. A screen
 * that is only ever asserted by rendering functions in isolation can be
 * correct in every unit and still not delete a draft.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT
 * ---------------------------------
 * Real: the browser, the shipped bundle, the shipped index.html, the real
 * api/drafts.js handler, the real store code, real RS256 token verification,
 * real idempotency records, real lifecycle generations and fences.
 *
 * Substituted, by tools/dev-draft-server.mjs, and named so no reader mistakes
 * them for verified: Google's JWKS (a keypair minted locally, still verified),
 * and Upstash (an in-memory map speaking the same REST shape). Two consequences
 * that bound what this file may claim:
 *
 *   * TTL is not modelled. `expire` answers 1 and records nothing, and the
 *     script `setEx` ignores its seconds. A lock never lapses here, so lock
 *     EXPIRY is not tested by this file and is not claimed by it.
 *   * The Lua scripts are the suites' JS re-implementation
 *     (tests/_kvScripts.mjs), not Redis executing them. Verifying the actual
 *     scripts against an isolated Redis is a separate outstanding check.
 *
 * Run: node tests/draft-delete-browser.mjs
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = '/home/user/node_modules/playwright/index.js';
const PORT = Number(process.env.CR_DELETE_BROWSER_PORT || 8321);
const B = `http://127.0.0.1:${PORT}`;
const SLOT = 'ebay:fixed-price';

const T = harness('draft-delete-browser');

// ── the server under test ──────────────────────────────────────────────────
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

// ── node-side helpers: seeding and inspection, never assertion targets ─────
const tokenFor = async (sub) =>
  (await (await fetch(`${B}/__devtoken?sub=${encodeURIComponent(sub)}`)).json()).token;

const CARD = { name: 'Charizard VMAX', set: 'Champions Path', number: '074/073', game: 'pokemon' };

async function apiCreate(sub, instanceId, key, over = {}) {
  const tok = await tokenFor(sub);
  const r = await fetch(`${B}/api/drafts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, 'Idempotency-Key': key },
    body: JSON.stringify({ card: CARD, instanceId, slot: SLOT, price: 32.84, priceSource: 'seller', ...over }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, id: j.draftId, existing: j.existing, generation: j.generation, code: j.code };
}

async function apiRead(sub, id) {
  const tok = await tokenFor(sub);
  const r = await fetch(`${B}/api/drafts?id=${encodeURIComponent(id)}`, { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, code: j.code, rev: j.draft && j.draft.rev, price: j.draft && j.draft.price, title: j.draft && j.draft.title };
}

async function apiPatch(sub, id, rev, body) {
  const tok = await tokenFor(sub);
  const r = await fetch(`${B}/api/drafts?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, 'Idempotency-Key': `patch-${id}-r${rev}` },
    body: JSON.stringify({ expectedRev: rev, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, rev: j.draft && j.draft.rev, code: j.code };
}

async function apiList(sub) {
  const tok = await tokenFor(sub);
  const r = await fetch(`${B}/api/drafts`, { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ids: (j.rows || []).map((x) => x.draftId), total: j.total };
}

const kvget = async (prefix) => (await (await fetch(`${B}/__kvget?prefix=${encodeURIComponent(prefix)}`)).json());
const kvdel = async (prefix) => (await (await fetch(`${B}/__kvdel?prefix=${encodeURIComponent(prefix)}`)).json());
const quotaOf = async (sub) => {
  const rows = await kvget(`draftquota:${sub}`);
  const v = rows[`draftquota:${sub}`];
  return v === undefined ? null : Number(v);
};

// ── the browser ────────────────────────────────────────────────────────────
const { chromium } = (await import(PW)).default;
const browser = await chromium.launch();

/**
 * A page with the real bundle, a real token, and every /api/drafts request
 * recorded on the way out.
 *
 * `plan(rec, route)` may take a request over -- returning 'handled' means the
 * plan already answered it. Anything else passes through to the real handler,
 * so the default is a live round trip, not a fixture.
 */
async function boot({ sub, collection = [] } = {}) {
  const tok = await tokenFor(sub);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
  await page.waitForFunction(() => typeof window.openDraftReview === 'function', { timeout: 20000 });
  // AFTER load: `_crIdToken` is a top-level declaration and evaluating the
  // bundle overwrites an init-script stub.
  await page.evaluate((t) => { window._crIdToken = async () => t; }, tok);
  // Toasts and analytics are observed by wrapping the real functions, not by
  // adding hooks to the bundle: nothing test-only ships in production.
  await page.evaluate(() => {
    window.__toasts = [];
    const orig = window.showToast;
    window.showToast = (m) => { window.__toasts.push(String(m)); try { if (orig) orig(m); } catch (_) {} };
    window.__events = [];
    const oe = window.trackEvent;
    window.trackEvent = (n, p) => { window.__events.push({ n, p }); try { if (oe) oe(n, p); } catch (_) {} };
  });
  return { ctx, page, wire, errors, setPlan: (fn) => { plan = fn; } };
}

const openReview = async (page, id) => {
  await page.evaluate((i) => window.openDraftReview(i), id);
  await page.waitForFunction(() => window._reviewState && window._reviewState.loading === false, { timeout: 20000 });
};

const toasts = (page) => page.evaluate(() => window.__toasts.slice());
const events = (page) => page.evaluate(() => window.__events.slice());
const rowState = (page, inst) => page.evaluate((i) => {
  try { return JSON.parse(JSON.stringify(_crDraftState[i] || null)); } catch (_) { return 'UNREACHABLE'; }
}, inst);
const reviewState = (page) => page.evaluate(() => ({
  hasDraft: !!window._reviewState.draft,
  rev: window._reviewState.draft && window._reviewState.draft.rev,
  price: window._reviewState.draft && window._reviewState.draft.price,
  gone: window._reviewState.gone ? JSON.parse(JSON.stringify(window._reviewState.gone)) : null,
  deleteUi: (typeof window._reviewState.deleteUi === 'object' && window._reviewState.deleteUi)
    ? JSON.parse(JSON.stringify(window._reviewState.deleteUi)) : window._reviewState.deleteUi || null,
}));
const bodyOf = (rec) => { try { return JSON.parse(rec.body || '{}'); } catch (_) { return {}; } };
const posts = (wire) => wire.filter((r) => r.method === 'POST');
const deletes = (wire) => wire.filter((r) => r.method === 'DELETE');
const collectionRow = (id) => ({ id, name: CARD.name, set: CARD.set, number: CARD.number, game: 'pokemon', currentValue: 32.84 });

const settle = (page, ms = 700) => page.waitForTimeout(ms);

try {

  /* ═════════════════════════════════════════════════════════════════════════
     1. CANCEL

     The claim is about the WIRE, not the screen: a cancelled confirmation must
     not have asked the server for anything. A screen that returned to normal
     after issuing the DELETE would look identical.
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('cancelling the confirmation sends no DELETE and changes nothing', async () => {
    const sub = 'seller-cancel';
    const made = await apiCreate(sub, 'inst_col_c1', 'seed-cancel-20260910-aaa1');
    T.check('seed: created', made.status === 201 && !!made.id, JSON.stringify(made));
    const q0 = await quotaOf(sub);

    const { page, wire, ctx } = await boot({ sub });
    await openReview(page, made.id);
    await page.click('#reviewDeleteBtn');
    await page.waitForSelector('#reviewDeleteGo', { timeout: 10000 });
    T.check('the confirmation is on screen', await page.isVisible('#reviewDeleteGo'));
    await page.click('#reviewDeleteCancel');
    await settle(page);

    T.check('no DELETE was sent', deletes(wire).length === 0,
      JSON.stringify(deletes(wire).map((r) => r.url)));
    const st = await reviewState(page);
    T.check('the draft is still on screen', st.hasDraft === true && st.gone === null, JSON.stringify(st));
    T.check('the confirmation is dismissed', st.deleteUi === null, JSON.stringify(st.deleteUi));
    T.check('the confirm button is gone from the DOM', (await page.$('#reviewDeleteGo')) === null);

    const rec = await apiRead(sub, made.id);
    T.check('the record is unchanged and still readable', rec.status === 200 && rec.rev === 1, JSON.stringify(rec));
    T.check('the quota did not move', (await quotaOf(sub)) === q0, `${q0} -> ${await quotaOf(sub)}`);
    await ctx.close();
  });

  /* ═════════════════════════════════════════════════════════════════════════
     2. CONFIRM — and the three things a confirmation has to survive

     The tombstone across a RELOAD is the load-bearing one. A screen that only
     hid the row would pass every in-page assertion and lose the deletion on
     the next page load.
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('confirming deletes: wire, copy, reload, list, quota', async () => {
    const sub = 'seller-confirm';
    const made = await apiCreate(sub, 'inst_col_c2', 'seed-confirm-20260910-aaa1');
    T.check('seed: created', made.status === 201, JSON.stringify(made));
    const q0 = await quotaOf(sub);
    T.check('seed: quota counted the create', q0 === 1, String(q0));

    const { page, wire, ctx } = await boot({ sub });
    await openReview(page, made.id);
    await page.click('#reviewDeleteBtn');
    await page.waitForSelector('#reviewDeleteGo');
    await page.click('#reviewDeleteGo');
    await page.waitForFunction(() => !!window._reviewState.gone, { timeout: 20000 });

    // ── the request the browser actually sent ──
    const del = deletes(wire);
    T.check('exactly one DELETE', del.length === 1, String(del.length));
    T.check('DELETE names the draft in the query', del[0] && del[0].url.includes(`id=${made.id}`), del[0] && del[0].url);
    T.check('DELETE carries an Idempotency-Key keyed on draft AND revision',
      del[0] && del[0].key === `del-${made.id}-r1`, del[0] && del[0].key);
    T.check('DELETE body is exactly the seen revision',
      JSON.stringify(bodyOf(del[0])) === JSON.stringify({ expectedRev: 1 }), del[0] && del[0].body);

    // ── the copy ──
    const st = await reviewState(page);
    T.check('the gone surface records lastState deleted', st.gone && st.gone.lastState === 'deleted', JSON.stringify(st.gone));
    T.check('the gone copy says the draft was deleted',
      st.gone && /This draft was deleted\./.test(st.gone.text), st.gone && st.gone.text);
    T.check('the draft is off the screen', st.hasDraft === false);
    const tl = await toasts(page);
    T.check('the seller is told', tl.includes('Draft deleted.'), JSON.stringify(tl));
    const rs = await rowState(page, 'inst_col_c2');
    T.check('the row is marked empty', rs && rs.presence === 'empty', JSON.stringify(rs));
    T.check('the row took the new generation off the delete response', rs && rs.generation === 1, JSON.stringify(rs));
    T.check('the row no longer names a draft', rs && rs.draftId === null, JSON.stringify(rs));
    T.check('the badge count is UNKNOWN, not decremented',
      (await page.evaluate(() => window._crDraftCount)) === null,
      String(await page.evaluate(() => window._crDraftCount)));

    // ── the store ──
    T.check('the record answers 410 with DRAFT_DELETED',
      (await apiRead(sub, made.id)).status === 410, JSON.stringify(await apiRead(sub, made.id)));
    const q1 = await quotaOf(sub);
    T.check('the quota released exactly one slot', q1 === q0 - 1, `${q0} -> ${q1}`);
    const list = await apiList(sub);
    T.check('the draft is out of the list', !list.ids.includes(made.id), JSON.stringify(list.ids));

    // ── across a reload ──
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.openDraftReview === 'function', { timeout: 20000 });
    const tok2 = await tokenFor(sub);
    await page.evaluate((t) => { window._crIdToken = async () => t; }, tok2);
    await openReview(page, made.id);
    const st2 = await reviewState(page);
    T.check('after reload the draft is still gone', !!st2.gone && st2.hasDraft === false, JSON.stringify(st2));
    T.check('after reload the copy still says deleted',
      st2.gone && /This draft was deleted\./.test(st2.gone.text), st2.gone && st2.gone.text);

    // ── the drafts list screen, rendered ──
    await page.evaluate(() => window.loadDraftsFirstPage && window.loadDraftsFirstPage());
    await settle(page, 1200);
    const shown = await page.evaluate((id) => document.body.innerHTML.includes(id), made.id);
    T.check('the deleted id is not rendered anywhere on the drafts screen', shown === false);

    // ── a repeated delete does not hand back a second slot ──
    const tok = await tokenFor(sub);
    const again = await fetch(`${B}/api/drafts?id=${made.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, 'Idempotency-Key': `del-${made.id}-r1-retry` },
      body: JSON.stringify({ expectedRev: 1 }),
    });
    T.check('a repeated delete is not an error', again.status === 200 || again.status === 410, String(again.status));
    T.check('the quota still shows one release, not two', (await quotaOf(sub)) === q1, String(await quotaOf(sub)));
    await ctx.close();
  });

  /* ═════════════════════════════════════════════════════════════════════════
     3. THE LOST RESPONSE — three shapes, three different honest answers

     A failed HTTP response does not establish that the deletion failed. Each
     shape below is a DIFFERENT truth, and the screen has to tell them apart by
     reading the record rather than by reading the status code.
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('committed, then the response was dropped: the reread finds the deletion', async () => {
    const sub = 'seller-lost-a';
    const made = await apiCreate(sub, 'inst_col_l1', 'seed-lost-a-20260910-aaa1');
    const q0 = await quotaOf(sub);
    const { page, wire, ctx, setPlan } = await boot({ sub });
    await openReview(page, made.id);

    // Let the REAL handler run and commit, then throw its response away.
    let dropped = 0;
    setPlan(async (rec, route) => {
      if (rec.method !== 'DELETE') return null;
      await route.fetch();          // the handler commits the tombstone
      dropped++;
      await route.abort('failed');  // the client never learns that it did
      return 'handled';
    });

    await page.click('#reviewDeleteBtn');
    await page.waitForSelector('#reviewDeleteGo');
    await page.click('#reviewDeleteGo');
    await page.waitForFunction(() => !!window._reviewState.gone || (window._reviewState.deleteUi && window._reviewState.deleteUi.error), { timeout: 20000 });

    T.check('the response was dropped once', dropped === 1, String(dropped));
    const st = await reviewState(page);
    T.check('the screen shows the draft as gone', !!st.gone, JSON.stringify(st));
    T.check('it does NOT claim the draft is still here',
      !(st.deleteUi && /still here/i.test(String(st.deleteUi.error || ''))), JSON.stringify(st.deleteUi));
    const gets = wire.filter((r) => r.method === 'GET');
    T.check('a reconciliation read was made', gets.length >= 1, String(gets.length));
    T.check('the tombstone really is committed in the store',
      (await apiRead(sub, made.id)).status === 410);
    T.check('the quota released once despite the lost response',
      (await quotaOf(sub)) === q0 - 1, `${q0} -> ${await quotaOf(sub)}`);
    // The reconcile read learns the deletion from the RECORD, and the record's
    // 410 carries DRAFT_DELETED -- so this route is entitled to the deleted
    // wording. Asserted rather than assumed, because the same surface must NOT
    // say it for a retirement (case 6).
    T.check('the copy is the deleted wording', st.gone && /was deleted/.test(st.gone.text), st.gone && st.gone.text);
    await ctx.close();
  });

  await T.section('failed before commit: the draft is preserved and said to be preserved', async () => {
    const sub = 'seller-lost-b';
    const made = await apiCreate(sub, 'inst_col_l2', 'seed-lost-b-20260910-aaa1');
    const q0 = await quotaOf(sub);
    const { page, wire, ctx, setPlan } = await boot({ sub });
    await openReview(page, made.id);

    // Aborted WITHOUT being forwarded: the handler never saw it.
    setPlan(async (rec, route) => {
      if (rec.method !== 'DELETE') return null;
      await route.abort('failed');
      return 'handled';
    });

    await page.click('#reviewDeleteBtn');
    await page.waitForSelector('#reviewDeleteGo');
    await page.click('#reviewDeleteGo');
    await page.waitForFunction(() => window._reviewState.deleteUi && window._reviewState.deleteUi.error, { timeout: 20000 });

    const st = await reviewState(page);
    T.check('the draft is NOT shown as gone', st.gone === null, JSON.stringify(st.gone));
    T.check('the draft is still on screen', st.hasDraft === true);
    T.check('the message says the draft is still here',
      /still here/i.test(String(st.deleteUi.error)), String(st.deleteUi.error));
    T.check('the message invites another attempt rather than promising anything',
      /try deleting it again/i.test(String(st.deleteUi.error)), String(st.deleteUi.error));
    T.check('the record is untouched', (await apiRead(sub, made.id)).status === 200);
    T.check('the quota did not move', (await quotaOf(sub)) === q0, `${q0} -> ${await quotaOf(sub)}`);
    T.check('the reconciliation read happened before that claim was made',
      wire.filter((r) => r.method === 'GET').length >= 1);
    await ctx.close();
  });

  await T.section('the reconciliation read itself fails: uncertainty stays explicit', async () => {
    const sub = 'seller-lost-c';
    const made = await apiCreate(sub, 'inst_col_l3', 'seed-lost-c-20260910-aaa1');
    const { page, ctx, setPlan } = await boot({ sub });
    await openReview(page, made.id);

    // Everything after the confirmation is unreachable: the DELETE and the
    // read that would have resolved it.
    setPlan(async (rec, route) => {
      if (rec.method === 'DELETE' || rec.method === 'GET') { await route.abort('failed'); return 'handled'; }
      return null;
    });

    await page.click('#reviewDeleteBtn');
    await page.waitForSelector('#reviewDeleteGo');
    await page.click('#reviewDeleteGo');
    await page.waitForFunction(() => window._reviewState.deleteUi && window._reviewState.deleteUi.error, { timeout: 20000 });

    const msg = String((await reviewState(page)).deleteUi.error);
    T.check('it says it could not check', /couldn.t check whether the draft was deleted/i.test(msg), msg);
    T.check('it does not claim the draft survived', !/still here/i.test(msg), msg);
    // "whether the draft was deleted" is the hedge itself, so the assertion
    // has to be about the ASSERTED form, not about the words appearing.
    T.check('it does not state a deletion as fact',
      !/(?<!whether )(this|the|your) draft was deleted/i.test(msg), msg);
    T.check('every mention of deletion is hedged',
      msg.split(/was deleted/i).length - 1 === (msg.match(/whether the draft was deleted/gi) || []).length, msg);
    T.check('it points somewhere the seller can find out', /open your drafts/i.test(msg), msg);
    T.check('the screen is not showing a gone surface', (await reviewState(page)).gone === null);
    await ctx.close();
  });

  /* ═════════════════════════════════════════════════════════════════════════
     4. TWO BROWSER CONTEXTS

     B deletes the draft A is holding. A's pending RETRY -- the original key,
     the original payload -- must not recreate it, and A must not paper over
     the 410 with an automatic replacement POST. Only a fresh, explicit action
     creates again.
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('B deletes; A retries; nothing is resurrected and nothing auto-retries', async () => {
    const sub = 'seller-two-ctx';
    const ENTRY = 'F1';
    const INST = 'inst_col_' + ENTRY;

    const A = await boot({ sub, collection: [collectionRow(ENTRY)] });
    // A creates through the real collection entry point.
    await A.page.evaluate((e) => window.startListingDraftForEntry(e), ENTRY);
    await A.page.waitForFunction(() => window.__toasts.length > 0, { timeout: 20000 });
    const firstPost = posts(A.wire)[0];
    const id = (await apiList(sub)).ids[0];
    T.check('A created one draft', posts(A.wire).length === 1 && !!id, JSON.stringify({ posts: posts(A.wire).length, id }));
    T.check("A's first create sent no generation (the row knew none)",
      bodyOf(firstPost).generation === undefined, firstPost && firstPost.body);
    const RETRY_KEY = firstPost.key;
    T.check("A's key has no generation suffix while the generation is unknown",
      RETRY_KEY === `sell-col-${ENTRY}-ebay-fixed-price`, RETRY_KEY);
    const rsA = await rowState(A.page, INST);
    T.check('A now knows the row is live', rsA && rsA.presence === 'live', JSON.stringify(rsA));
    T.check('A knows it at generation 0', rsA && rsA.generation === 0, JSON.stringify(rsA));
    T.check('A knows which draft it is', rsA && rsA.draftId === id, JSON.stringify(rsA));

    // B, a second context for the same seller, deletes it.
    const Bp = await boot({ sub });
    await openReview(Bp.page, id);
    await Bp.page.click('#reviewDeleteBtn');
    await Bp.page.waitForSelector('#reviewDeleteGo');
    await Bp.page.click('#reviewDeleteGo');
    await Bp.page.waitForFunction(() => !!window._reviewState.gone, { timeout: 20000 });
    T.check('B sees it deleted', !!(await reviewState(Bp.page)).gone);
    T.check('the store agrees', (await apiRead(sub, id)).status === 410);

    // A's PENDING RETRY. Same intent, so the same key and the same payload:
    // the row state is put back to what A held when it sent the original --
    // live, generation not yet known -- through the real row-state function.
    await A.page.evaluate((d) => _crNoteRowState('inst_col_F1', { presence: 'live', generation: null, draftId: d }), id);
    // Both observation buffers are cleared: A's FIRST create legitimately
    // fired a created event, and leaving it in the array would make the next
    // assertion pass or fail on the wrong request.
    await A.page.evaluate(() => { window.__toasts.length = 0; window.__events.length = 0; });
    await A.page.evaluate((e) => window.startListingDraftForEntry(e), ENTRY);
    await A.page.waitForFunction(() => window.__toasts.length > 0, { timeout: 20000 });
    await settle(A.page, 1000);

    const retry = posts(A.wire)[1];
    T.check("A's retry reused the original key", retry && retry.key === RETRY_KEY, retry && retry.key);
    T.check("A's retry reused the original payload verbatim",
      retry && retry.body === firstPost.body, retry && retry.body);
    T.check('A sent exactly two POSTs: no automatic replacement',
      posts(A.wire).length === 2, JSON.stringify(posts(A.wire).map((p) => p.key)));
    const tA = await toasts(A.page);
    T.check('A is told the draft is over', tA.some((m) => /no longer available|was deleted/.test(m)), JSON.stringify(tA));
    T.check('the refused retry fired no created event',
      (await events(A.page)).every((e) => e.n !== 'listing_draft_created'),
      JSON.stringify(await events(A.page)));
    T.check('the retry did not recreate anything', (await apiList(sub)).ids.length === 0,
      JSON.stringify((await apiList(sub)).ids));
    T.check('A took the new generation off the refusal',
      (await rowState(A.page, INST)).generation === 1, JSON.stringify(await rowState(A.page, INST)));

    // A fresh, explicit action. The generation is now known, so the key is a
    // new one -- and this is the whole reason the key carries it: the original
    // key's recorded result names a deleted draft and the replay gate
    // (api/_draftService.js:338) refuses it forever.
    await A.page.evaluate(() => { window.__toasts.length = 0; window.__events.length = 0; });
    await A.page.evaluate((e) => window.startListingDraftForEntry(e), ENTRY);
    await A.page.waitForFunction(() => window.__toasts.length > 0, { timeout: 20000 });
    const fresh = posts(A.wire)[2];
    T.check('the fresh create used a NEW key carrying the generation',
      fresh && fresh.key === `sell-col-${ENTRY}-ebay-fixed-price-g1`, fresh && fresh.key);
    T.check('the fresh create sent the generation it obtained',
      bodyOf(fresh).generation === 1, fresh && fresh.body);
    const after = await apiList(sub);
    T.check('a NEW draft exists', after.ids.length === 1, JSON.stringify(after.ids));
    T.check('and it is not the deleted one', after.ids[0] !== id, JSON.stringify({ old: id, now: after.ids[0] }));
    const tA2 = await toasts(A.page);
    T.check('the seller is told a draft was started', tA2.some((m) => /Listing draft started\./.test(m)), JSON.stringify(tA2));
    T.check('this one DID count as a create',
      (await events(A.page)).some((e) => e.n === 'listing_draft_created'), JSON.stringify(await events(A.page)));
    await A.ctx.close();
    await Bp.ctx.close();
  });

  /* ═════════════════════════════════════════════════════════════════════════
     5. existing:true — ADOPTION IS NOT A CREATE

     The screen must open what the seller already wrote, keep it, and take no
     credit for it: no created event, no count increase, no "started" copy.
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('existing:true opens the saved draft, preserves edits, counts nothing', async () => {
    const sub = 'seller-adopt';
    const ENTRY = 'G1';
    const INST = 'inst_col_' + ENTRY;
    const made = await apiCreate(sub, INST, 'seed-adopt-20260910-aaa1');
    // A seller edit made BEFORE the adoption, so "preserved" means something.
    const edited = await apiPatch(sub, made.id, 1, { price: 41.5, priceSource: 'seller' });
    T.check('seed: the seller edit landed', edited.status === 200 && edited.rev === 2, JSON.stringify(edited));

    const { page, wire, ctx } = await boot({ sub, collection: [collectionRow(ENTRY)] });
    await page.evaluate(() => { window._crDraftCount = 7; });
    await page.evaluate((e) => window.startListingDraftForEntry(e), ENTRY);
    await page.waitForFunction(() => window.__toasts.length > 0, { timeout: 20000 });
    await page.waitForFunction(() => window._reviewState && window._reviewState.loading === false, { timeout: 20000 });

    const tl = await toasts(page);
    T.check('the copy says the saved draft was opened', tl.includes('Opened your saved draft'), JSON.stringify(tl));
    T.check('it does not say a draft was started', !tl.some((m) => /Listing draft started/.test(m)), JSON.stringify(tl));
    T.check('no created event was fired',
      (await events(page)).every((e) => e.n !== 'listing_draft_created'), JSON.stringify(await events(page)));
    T.check('the draft count was not incremented',
      (await page.evaluate(() => window._crDraftCount)) === 7,
      String(await page.evaluate(() => window._crDraftCount)));
    const st = await reviewState(page);
    T.check('the review screen opened the SAVED draft', st.hasDraft === true && st.rev === 2, JSON.stringify(st));
    T.check("the seller's edited price is what is shown", Number(st.price) === 41.5, String(st.price));
    const rec = await apiRead(sub, made.id);
    T.check('nothing was written to the record by the adoption',
      rec.status === 200 && rec.rev === 2 && Number(rec.price) === 41.5, JSON.stringify(rec));
    T.check('no second draft was made', (await apiList(sub)).ids.length === 1,
      JSON.stringify((await apiList(sub)).ids));
    T.check('exactly one POST was sent', posts(wire).length === 1, String(posts(wire).length));
    await ctx.close();
  });

  /* ═════════════════════════════════════════════════════════════════════════
     6. THE UNKNOWN GENERATION, and the wording for a row that merely ENDED

     Two separate claims that share a fixture:
       * an omitted generation must reach the legacy-resolution path, which
         ADOPTS an existing draft. It must not create a second one.
       * a row that ended without a recorded deletion must not be described to
         the seller as something they deleted.
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('an unknown generation takes the legacy-resolution path', async () => {
    const sub = 'seller-legacy';
    const ENTRY = 'H1';
    const INST = 'inst_col_' + ENTRY;
    const made = await apiCreate(sub, INST, 'seed-legacy-20260910-aaa1');
    T.check('seed: created', made.status === 201, JSON.stringify(made));
    // A draft that predates the lifecycle record: the draft stays, its
    // lifecycle row is removed, which is exactly what a pre-D8 draft looks
    // like to the handler.
    const gone = await kvdel(`draftinst:${sub}:${INST}:`);
    T.check('seed: the lifecycle record is absent', gone.deleted.length >= 1, JSON.stringify(gone));

    const { page, wire, ctx } = await boot({ sub, collection: [collectionRow(ENTRY)] });
    await page.evaluate((e) => window.startListingDraftForEntry(e), ENTRY);
    await page.waitForFunction(() => window.__toasts.length > 0, { timeout: 20000 });

    const p0 = posts(wire)[0];
    T.check('the request omitted the generation entirely',
      p0 && !Object.prototype.hasOwnProperty.call(bodyOf(p0), 'generation'), p0 && p0.body);
    T.check('the key carried no generation suffix', p0 && !/-g\d+$/.test(p0.key), p0 && p0.key);
    const tl = await toasts(page);
    T.check('the pre-existing draft was ADOPTED, not replaced',
      tl.includes('Opened your saved draft'), JSON.stringify(tl));
    T.check('no second draft was created', (await apiList(sub)).ids.length === 1 && (await apiList(sub)).ids[0] === made.id,
      JSON.stringify((await apiList(sub)).ids));
    T.check('the row is now known live at a resolved generation',
      (await rowState(page, INST)).presence === 'live', JSON.stringify(await rowState(page, INST)));
    await ctx.close();
  });

  await T.section('a row that merely ended is never described as the seller deleting it', async () => {
    // Driven through the real copy function with the real wire shapes, because
    // the wording rule is about what the RECORD says, not about the status code
    // that delivered it.
    const { page, ctx } = await boot({ sub: 'seller-copy' });
    const copy = await page.evaluate(() => ({
      deleted:   _crGoneCopy({ code: 'DRAFT_DELETED', lastState: 'deleted', generation: 1 }),
      gone:      _crGoneCopy({ code: 'DRAFT_GENERATION_STALE', lastState: 'gone', generation: 2 }),
      retired:   _crGoneCopy({ code: 'DRAFT_GENERATION_STALE', lastState: 'retired', generation: 3 }),
      silent:    _crGoneCopy({ code: 'DRAFT_GENERATION_STALE', generation: 4 }),
      empty:     _crGoneCopy({}),
    }));
    T.check('a recorded deletion may say it was deleted',
      /was deleted/.test(copy.deleted.text), copy.deleted.text);
    for (const k of ['gone', 'retired', 'silent', 'empty']) {
      T.check(`${k}: does not say the seller deleted it`, !/you deleted/i.test(copy[k].text), copy[k].text);
      T.check(`${k}: does not assert a deletion at all`, !/was deleted/.test(copy[k].text), copy[k].text);
      T.check(`${k}: says it is no longer available`, /no longer available/.test(copy[k].text), copy[k].text);
      T.check(`${k}: does not invite a refresh or a retry`, !/refresh|try again/i.test(copy[k].text), copy[k].text);
      T.check(`${k}: lastState is not rewritten to deleted`, copy[k].lastState !== 'deleted', String(copy[k].lastState));
    }
    T.check('no copy anywhere in this set says "you deleted"',
      Object.values(copy).every((c) => !/you deleted/i.test(c.text)));
    await ctx.close();
  });

  /* ═════════════════════════════════════════════════════════════════════════
     7. THE BUTTON LABELS, from the row states these cases produce
     ═══════════════════════════════════════════════════════════════════════ */
  await T.section('the row label follows what the row actually knows', async () => {
    const { page, ctx } = await boot({ sub: 'seller-labels' });
    const labels = await page.evaluate(() => {
      _crNoteRowState('inst_live', { presence: 'live', generation: 0, draftId: 'drf_x' });
      _crNoteRowGone('inst_empty', { lastState: 'deleted', generation: 1 });
      return {
        live: _crDraftBtnLabel('inst_live'),
        empty: _crDraftBtnLabel('inst_empty'),
        unknown: _crDraftBtnLabel('inst_never_seen'),
      };
    });
    T.check('a known live draft opens', labels.live === 'Open draft', labels.live);
    T.check('a confirmed-empty lifecycle creates', labels.empty === 'Create listing draft', labels.empty);
    T.check('an unresolved row commits to neither', labels.unknown === 'Start or resume listing', labels.unknown);
    await ctx.close();
  });

} finally {
  await browser.close();
  shutdown();
}

T.done();
