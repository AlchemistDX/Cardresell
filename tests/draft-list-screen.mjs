/**
 * tests/draft-list-screen.mjs — D2.1 drafts screen, in a real browser.
 *
 * Cases 2, 3, 4, 8, 11, 14, 15, 21, 22 of Part 4 in
 * audit/DRAFT_LIST_API_CONTRACT.md. The rest of the case list belongs to the
 * offline suites and to tests/draft-focus.mjs; the allocation is recorded in
 * audit/DECISION_CLIENT_TEST_HARNESS.md.
 *
 * WHY A BROWSER AND NOT SOURCE TEXT
 * ---------------------------------
 * Case 15 is the reason. It has to establish that a row does not navigate. The
 * obvious version of that test — "no row carries a click handler" — passes
 * cheerfully while every row is tappable, because a delegated listener on an
 * ancestor container appears on no row at all. This screen *does* use
 * delegation. So the only honest form of the assertion is to synthesize a real
 * click on a real row and check that nothing moved, which needs a real DOM.
 *
 * Once one case needs a browser, the rest come along for free, and they get
 * better: case 11 stops asking "is every message in the source" and starts
 * asking "is every message on screen."
 *
 * FIXTURES ARE GENERATED, NEVER HAND-WRITTEN
 * ------------------------------------------
 * Every envelope served here comes from tests/_draftListFixtures.mjs, which
 * seeds the harness store and calls the real api/drafts.js handler. Part 4
 * makes this binding, and the reasoning is worth restating: a hand-written
 * envelope that disagrees with production still fails loudly, but it fails as
 * "the screen is broken." You then fix the screen to match the wrong fixture
 * and the suite goes green against a shape the server never sends.
 *
 * The one place this suite edits a generated envelope is case 2, where a
 * blocker `message` is replaced with a sentinel. That is the case's entire
 * point — the shape stays real, only the text becomes traceable.
 *
 * Run: node tests/draft-list-screen.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';
import { readCoreBundle } from './_assetRefs.mjs';
import { generateFixtures } from './_draftListFixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = '/home/user/node_modules/playwright/index.js';

const T = harness('draft-list-screen');

/* ═══════════════════════════════════════════════════════════════════════════
   Static host
   ---------------------------------------------------------------------------
   Port 0 so the suite never collides with the dev server on 8097 or the stale
   copy on 8090. It serves ROOT, so the browser resolves index.html's own
   <script src> and physically cannot load the retired core.569ff536.js —
   which is the same guarantee readCoreBundle() gives the offline cases, only
   enforced by the file the app actually references.
   ═══════════════════════════════════════════════════════════════════════════ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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

    // Contain the host to ROOT. A test fixture is not a reason to ship a
    // traversal, even one that only ever runs on a loopback port.
    const abs = path.resolve(ROOT, '.' + rel);
    if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end(); return;
    }
    fs.readFile(abs, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
      res.writeHead(200, {
        'content-type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(buf);
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Page fixture
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Serve one canned envelope for every GET /api/drafts, and count the requests.
 *
 * `plan` is a function (searchParams, hitIndex) -> { status, body }, so a case
 * can answer the first request differently from the second. The counter is what
 * case 21 asserts on: "exactly one request", not "no loop in the source".
 */
async function mountDrafts(page, plan) {
  const hits = [];
  await page.route('**/api/drafts*', async (route) => {
    const u = new URL(route.request().url());
    const i = hits.length;
    hits.push({ url: u.pathname + u.search, params: Object.fromEntries(u.searchParams) });
    const out = plan(u.searchParams, i) || { status: 200, body: {} };
    await route.fulfill({
      status: out.status,
      contentType: 'application/json',
      body: JSON.stringify(out.body ?? {}),
    });
  });
  return hits;
}

/** Silence everything the page would otherwise reach for. */
async function isolate(page) {
  await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  for (const pat of ['**://www.googletagmanager.com/**', '**://*.google-analytics.com/**',
    '**://apis.google.com/**', '**://accounts.google.com/**', '**://*.vercel-insights.com/**',
    '**://*.firebaseio.com/**', '**://*.googleapis.com/**']) {
    await page.route(pat, (r) => r.abort());
  }
}

/**
 * Load the app with a signed-in token and the drafts endpoint stubbed.
 *
 * `_crIdToken` is a top-level function declaration in a classic script, so its
 * binding IS the window property — replacing it here is the same binding the
 * bundle's own bare call resolves. That is the whole auth stub: no cookie, no
 * Firebase, no sign-in flow.
 */
async function openApp(page, port, plan) {
  await isolate(page);
  const hits = await mountDrafts(page, plan);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.renderDraftsView === 'function', { timeout: 15000 });

  // AFTER load, not in an init script. `_crIdToken` is a top-level `async
  // function` declaration, so evaluating the bundle assigns the global binding
  // and overwrites anything an init script had put there first. Stubbing early
  // looked like it worked -- typeof window._crIdToken was still 'function' --
  // and the screen simply rendered its sign-in wall, which is a plausible
  // enough screen that the whole suite failed as "no rows rendered."
  await page.evaluate(() => {
    window.__crTokenCalls = 0;
    window._crIdToken = async () => { window.__crTokenCalls++; return 'test-id-token'; };
  });
  const stubbed = await page.evaluate(async () => await window._crIdToken());
  if (stubbed !== 'test-id-token') throw new Error('token stub did not take effect: ' + stubbed);
  return hits;
}

/** Show the drafts tab and wait for the first paint to settle. */
async function showDrafts(page) {
  await page.evaluate(() => window.switchView('drafts'));
  await page.waitForFunction(
    () => { const s = window._draftsState; return s && s.loading === false; },
    { timeout: 15000 },
  );
  await page.waitForFunction(() => {
    const w = document.getElementById('draftsWrap');
    return w && w.innerHTML.trim().length > 0;
  }, { timeout: 15000 });
}

const rowsOf = (page) => page.evaluate(() => {
  return Array.from(document.querySelectorAll('#draftsWrap .draft-row')).map((el) => ({
    id: el.getAttribute('data-draft-id'),
    stub: el.classList.contains('draft-row-stub'),
    focused: el.classList.contains('draft-row-focused'),
    text: el.innerText,
    blockers: Array.from(el.querySelectorAll('.draft-row-blocker')).map((b) => b.innerText.trim()),
    actions: Array.from(el.querySelectorAll('.draft-row-action')).map((b) => b.innerText.trim()),
  }));
});

/* ═══════════════════════════════════════════════════════════════════════════
   Run
   ═══════════════════════════════════════════════════════════════════════════ */

const _pw = (await import(PW)).default;
const { chromium } = _pw;

const F = await generateFixtures();
const { server, port } = await startHost();
const browser = await chromium.launch({ args: ['--no-sandbox'] });

/** Fresh page per case: _draftsState is module-level, so cases must not share it. */
async function withPage(plan, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('  [pageerror] ' + e.message); });
  try {
    const hits = await openApp(page, port, plan);
    await fn(page, hits);
  } finally {
    await ctx.close();
  }
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const serve = (fx) => () => ({ status: fx.status, body: fx.body });

try {

  /* ─────────────────────────────────────────────────────────────────────────
     Case 2 — blocker text comes only from readiness.blockers[n].message
     ───────────────────────────────────────────────────────────────────────── */
  console.log('\n▶ case 2 — blocker text is the server\'s message, verbatim');
  {
    const SENTINEL = 'ZZ-SENTINEL-4417 this exact sentence came from the server';
    const fx = clone(F.blocked);
    const target = fx.body.rows.find((r) => r.summary && r.summary.readiness.blockers.length === 1);
    const realMessage = target.summary.readiness.blockers[0].message;
    target.summary.readiness.blockers[0].message = SENTINEL;

    await withPage(serve(fx), async (page) => {
      await showDrafts(page);
      const rows = await rowsOf(page);
      const row = rows.find((r) => r.id === target.draftId);

      T.check('the sentinel row rendered at all', !!row);
      T.check('the server\'s sentence appears on screen verbatim',
        !!row && row.blockers.some((b) => b.includes(SENTINEL)));
      T.check('the real message it replaced does NOT appear',
        !!row && !row.text.includes(realMessage),
        'the client is sourcing blocker text from somewhere other than the envelope');

      // The complement matters as much: a client that had authored its own
      // sentence per code would still show *something* for this row, and the
      // sentinel test above would fail — but a client that showed BOTH would
      // pass it. So pin the count.
      T.check('exactly one blocker line on a one-blocker row',
        !!row && row.blockers.length === 1);

      // No code leaked into the text. `code` is for branching and markers.
      const bodyText = await page.evaluate(() => document.getElementById('draftsWrap').innerText);
      T.check('no blocking code is rendered as user-facing text',
        !/SLOT_TITLE_TOO_LONG|SLOT_PRICE_REQUIRED|SLOT_ZERO_PRICE_NOT_ALLOWED|SLOT_RULES_UNKNOWN/.test(bodyText),
        'a code appeared in innerText — codes brief the client, they do not brief the seller');
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     Case 3 — all four stub kinds render a visible row with their own copy
     ───────────────────────────────────────────────────────────────────────── */
  console.log('\n▶ case 3 — four stub kinds, four visible rows, client-authored copy');
  {
    await withPage(serve(F.stubs), async (page) => {
      await showDrafts(page);
      const rows = await rowsOf(page);
      const stubs = rows.filter((r) => r.stub);
      const served = F.stubs.body.rows.filter((r) => !r.summary);

      T.check('the fixture really carries all four stub kinds',
        new Set(served.map((r) => r.reason)).size === 4);
      T.check('every stub row is present in the DOM', stubs.length === served.length);

      for (const s of served) {
        const row = rows.find((r) => r.id === s.draftId);
        T.check(`${s.reason} renders a row`, !!row && row.stub);
        T.check(`${s.reason} row carries non-empty copy`,
          !!row && row.text.trim().length > 0,
          'a stub with no copy is an invisible gap in the list');
        T.check(`${s.reason} copy is not the raw reason code`,
          !!row && !row.text.includes(s.reason),
          'the code was rendered instead of a sentence');
      }

      // Distinct copy per kind — one shared "something went wrong" for all
      // four would satisfy every assertion above.
      const copies = new Set(stubs.map((r) => r.text.trim()));
      T.check('each stub kind has its own copy, not one shared line', copies.size === 4);

      const shown = await page.evaluate(() => document.getElementById('draftsWrap').innerText);
      T.check('no stub row says the draft was "deleted"',
        !/\bdelet/i.test(shown),
        'a vanished record is not a deletion the seller performed; saying so blames them for it');
    });

    // The store's constant is DRAFT_RECORD_UNREADABLE; the ROW value is
    // DRAFT_UNREADABLE. A client keyed on the store constant matches nothing
    // and silently falls through to generic copy — which looks fine on screen.
    //
    // REACH: the drafts screen region, not "the client". These two assertions
    // used to slice to end-of-bundle and read as claims about the whole app.
    // That was an adequate proxy for exactly as long as the bundle had one
    // drafts surface. D3's review screen reads GET /api/drafts?id=, whose
    // failures ship raw STORE_ERR values, so it keys on
    // DRAFT_RECORD_UNREADABLE correctly — and turned the second assertion red
    // without anything being wrong. The claim was always about this screen; the
    // evidence just sampled more than the claim covered.
    //
    // The region is now DECLARED by a sentinel in the bundle rather than
    // inferred from whatever sits next to it, so the next append cannot widen
    // it silently. See audit/DECISION_REVIEW_ERROR_VOCABULARY.md.
    const { source } = readCoreBundle();
    const REGION_END = 'END DRAFTS SCREEN REGION';
    const from = source.indexOf('_DRAFT_STUB_COPY');
    const to = source.indexOf(REGION_END);
    // Both bounds are asserted, not assumed. A missing sentinel makes
    // indexOf return -1, and slice(from, -1) is a near-full-width region that
    // would quietly restore the very over-reach this replaced.
    T.check('the drafts screen region has both bounds in the bundle',
      from !== -1 && to !== -1 && to > from,
      `region bounds not found: from=${from} to=${to} — the sentinel comment was removed or moved`);
    const screen = source.slice(from, to);
    T.check('the drafts screen keys on the row value DRAFT_UNREADABLE',
      screen.includes('DRAFT_UNREADABLE'));
    T.check('the drafts screen does NOT key on the store constant DRAFT_RECORD_UNREADABLE',
      !screen.includes('DRAFT_RECORD_UNREADABLE'),
      'that constant never appears in a row; keying on it matches nothing');
  }

  /* ─────────────────────────────────────────────────────────────────────────
     Case 4 — only DRAFT_READ_FAILED offers retry
     ───────────────────────────────────────────────────────────────────────── */
  console.log('\n▶ case 4 — retry is offered for DRAFT_READ_FAILED and nothing else');
  {
    await withPage(serve(F.stubs), async (page) => {
      await showDrafts(page);
      const rows = await rowsOf(page);
      for (const s of F.stubs.body.rows.filter((r) => !r.summary)) {
        const row = rows.find((r) => r.id === s.draftId);
        const hasAction = !!row && row.actions.length > 0;
        T.check(`${s.reason} (retryable=${s.retryable}) offers retry: ${s.retryable}`,
          hasAction === (s.retryable === true),
          hasAction ? 'a retry that cannot succeed is worse than none' : 'the retryable stub lost its action');
      }
      const retryables = F.stubs.body.rows.filter((r) => !r.summary && r.retryable === true);
      T.check('exactly one stub kind is retryable in the fixture', retryables.length === 1);
      T.check('and it is DRAFT_READ_FAILED', retryables[0].reason === 'DRAFT_READ_FAILED');
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     Case 8 — degraded:true renders rows PLUS a banner
     ───────────────────────────────────────────────────────────────────────── */
  console.log('\n▶ case 8 — degraded renders the list and the banner, never a hidden list');
  {
    T.check('the fixture is a 200 with degraded:true',
      F.degraded.status === 200 && F.degraded.body.degraded === true);
    T.check('and it carries rows to be hidden', F.degraded.body.rows.length > 0);

    await withPage(serve(F.degraded), async (page) => {
      await showDrafts(page);
      const rows = await rowsOf(page);
      const banner = await page.evaluate(() => {
        const el = document.querySelector('#draftsWrap .draft-banner');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { text: el.innerText.trim(), display: cs.display, visibility: cs.visibility };
      });

      T.check('every served row is rendered', rows.length === F.degraded.body.rows.length);
      T.check('the banner exists', !!banner);
      T.check('the banner is actually visible',
        !!banner && banner.display !== 'none' && banner.visibility !== 'hidden');
      T.check('the banner says the drafts are safe',
        !!banner && /saved/i.test(banner.text));
      T.check('degraded does NOT render the empty state',
        !(await page.evaluate(() => !!document.querySelector('#draftsWrap .empty-flips'))),
        'degraded is a data condition; an empty state would tell the seller their work is gone');
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     Case 11 — every blocker on a multi-blocker row is rendered
     ───────────────────────────────────────────────────────────────────────── */
  console.log('\n▶ case 11 — a multi-blocker row shows all of them, not just the first');
  {
    const multi = F.blocked.body.rows.find((r) => r.summary && r.summary.readiness.blockers.length > 1);
    T.check('the fixture contains a genuine multi-blocker row',
      !!multi && multi.summary.readiness.blockers.length >= 2);

    await withPage(serve(F.blocked), async (page) => {
      await showDrafts(page);
      const rows = await rowsOf(page);
      const row = rows.find((r) => r.id === multi.draftId);
      const msgs = multi.summary.readiness.blockers.map((b) => b.message);

      T.check('the multi-blocker row rendered', !!row);
      T.check(`all ${msgs.length} blocker sentences are on screen`,
        !!row && msgs.every((m) => row.text.includes(m)),
        'only the first blocker is shown — the seller fixes one thing and is blocked again');
      T.check('one rendered line per blocker',
        !!row && row.blockers.length === msgs.length);

      // Every other blocked row is fully rendered too, so this is not a
      // one-row special case.
      for (const served of F.blocked.body.rows.filter((r) => r.summary)) {
        const r = rows.find((x) => x.id === served.draftId);
        T.check(`row ${served.draftId.slice(0, 12)} shows all ${served.summary.readiness.blockers.length} blocker(s)`,
          !!r && served.summary.readiness.blockers.every((b) => r.text.includes(b.message)));
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     Case 14 — the created draft is highlighted, even when it is not rows[0]
     ───────────────────────────────────────────────────────────────────────── */
  console.log('\n▶ case 14 — the created draft is highlighted wherever it sits');
  {
    const fx = clone(F.page1);
    // Deliberately NOT rows[0]. A client that highlights the first row passes
    // a rows[0] fixture without doing anything at all.
    const target = fx.body.rows[7];
    T.check('the target is deliberately not the first row',
      target.draftId !== fx.body.rows[0].draftId);

    await withPage(serve(fx), async (page) => {
      await page.evaluate((id) => window.openDraftsFocused(id), target.draftId);
      await page.waitForFunction(() => window._draftsState && window._draftsState.loading === false, { timeout: 15000 });
      await page.waitForFunction(() => document.querySelectorAll('#draftsWrap .draft-row').length > 0, { timeout: 15000 });

      const rows = await rowsOf(page);
      const focused = rows.filter((r) => r.focused);
      T.check('exactly one row is highlighted', focused.length === 1);
      T.check('and it is the created draft', focused.length === 1 && focused[0].id === target.draftId);
      T.check('the first row was not highlighted by accident',
        !rows[0].focused || rows[0].id === target.draftId);
      T.check('no missing-row notice is shown when the row IS present',
        !(await page.evaluate(() => !!document.querySelector('#draftsWrap .draft-notice'))));
    });

    // The 200 replay carries the same draftId as the 201 would, so it must
    // highlight the same row. Branching on `idempotencyState` instead of the
    // id is the mistake this guards.
    T.check('replay and fresh create agree on the draftId',
      F.createFresh.body.draftId === F.createReplay.body.draftId);
    T.check('and they are different statuses', F.createFresh.status === 201 && F.createReplay.status === 200);

    await withPage(serve(fx), async (page) => {
      await page.evaluate((id) => window.openDraftsFocused(id), target.draftId);
      await page.waitForFunction(() => window._draftsState && window._draftsState.loading === false, { timeout: 15000 });
      const focused = (await rowsOf(page)).filter((r) => r.focused);
      T.check('the replay path highlights the same row', focused.length === 1 && focused[0].id === target.draftId);
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     Case 15 — a row click navigates nowhere (behaviour, not handler absence)
     ───────────────────────────────────────────────────────────────────────── */
  console.log('\n▶ case 15 — clicking a row navigates nowhere');
  {
    await withPage(serve(F.page1), async (page) => {
      await showDrafts(page);

      const before = await page.evaluate(() => {
        window.__swCalls = [];
        window.__realSwitchView = window.switchView;
        window.switchView = function (...a) { window.__swCalls.push(a); return window.__realSwitchView.apply(this, a); };
        return {
          hash: location.hash,
          href: location.href,
          view: document.body.getAttribute('data-view'),
          rows: document.querySelectorAll('#draftsWrap .draft-row').length,
        };
      });
      T.check('there are rows to click', before.rows > 0);

      // Dispatched on the row, bubbling — so it travels the real path upward
      // and a delegated listener on #draftsWrap is exercised. The test never
      // needs to know whether delegation is used, which is the point.
      const after = await page.evaluate(() => {
        const row = document.querySelector('#draftsWrap .draft-row');
        row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        const inner = row.querySelector('.draft-row-title') || row.firstElementChild;
        if (inner) {
          inner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        }
        return { calls: window.__swCalls.length };
      });
      await page.waitForTimeout(250);

      const now = await page.evaluate(() => ({
        hash: location.hash,
        href: location.href,
        view: document.body.getAttribute('data-view'),
        draftsVisible: (() => {
          const el = document.getElementById('draftsView');
          return !!el && getComputedStyle(el).display !== 'none';
        })(),
        calls: window.__swCalls.length,
      }));

      T.check('switchView was not called', now.calls === 0 && after.calls === 0);
      T.check('location.hash is unchanged', now.hash === before.hash);
      T.check('the full URL is unchanged', now.href === before.href);
      T.check('the drafts view is still the visible one', now.draftsVisible === true);
      T.check('data-view still reads drafts', now.view === 'drafts');

      await page.evaluate(() => { window.switchView = window.__realSwitchView; });
      T.check('switchView was restored', await page.evaluate(() => window.switchView === window.__realSwitchView));

      // The spy has to be capable of failing, or the four assertions above are
      // decoration. Prove it fires on a call the screen really makes.
      const spyWorks = await page.evaluate(() => {
        window.__swCalls = [];
        window.switchView = function (...a) { window.__swCalls.push(a); return window.__realSwitchView.apply(this, a); };
        window.switchView('drafts');
        const n = window.__swCalls.length;
        window.switchView = window.__realSwitchView;
        return n;
      });
      T.check('the spy does detect a real switchView call', spyWorks === 1,
        'the spy could not observe a call it was watching for — case 15 proved nothing');
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     Case 21 — create-to-list issues EXACTLY ONE list request
     ───────────────────────────────────────────────────────────────────────── */
  console.log('\n▶ case 21 — exactly one list request on the create-to-list path');
  {
    // focusMidList: the target is at offset 37 of 60, so it is NOT on page 1
    // under a naive walk. A client that pages forward hunting for it would
    // still arrive at the right answer — and be wrong about how.
    const fx = F.focusMidList;
    const targetId = F.focusMidTarget;
    T.check('the focus fixture has a non-null focusOffset', fx.body.focusOffset !== null);
    T.check('the target is past the first page', fx.body.focusOffset >= 25);

    await withPage(() => ({ status: fx.status, body: fx.body }), async (page, hits) => {
      await page.evaluate((id) => window.openDraftsFocused(id), targetId);
      await page.waitForFunction(() => window._draftsState && window._draftsState.loading === false, { timeout: 15000 });
      await page.waitForTimeout(400); // let any follow-up request land before counting

      T.check(`exactly one list request was issued (got ${hits.length})`, hits.length === 1,
        'more than one means the client is page-hunting; focusOffset exists so it does not have to');
      T.check('that request carried focus=<id>', hits.length === 1 && hits[0].params.focus === targetId);
      T.check('and did NOT combine focus with cursor',
        hits.length === 1 && hits[0].params.cursor === undefined,
        'the server refuses that pair with LIST_FOCUS_CURSOR_CONFLICT');
      T.check('it did not request ids=1', hits.length === 1 && hits[0].params.ids === undefined);
      T.check('the requested limit is the screen\'s page size',
        hits.length === 1 && hits[0].params.limit === '25');
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     Case 22 — the missing-row notice is one string, not one per cause
     ───────────────────────────────────────────────────────────────────────── */
  console.log('\n▶ case 22 — one notice string across every cause');
  {
    // Cause A: the create came back degraded + repairRequired, so the index
    // write did not land and the row is not in the list.
    const createish = clone(F.page1);
    const orphanId = 'drf_' + 'a'.repeat(32);
    T.check('the orphan id is genuinely absent from the served page',
      !createish.body.rows.some((r) => r.draftId === orphanId));
    T.check('a real create envelope can carry degraded + repairRequired',
      Object.prototype.hasOwnProperty.call(F.createFresh.body, 'degraded')
      && Object.prototype.hasOwnProperty.call(F.createFresh.body, 'repairRequired'));

    let noticeA = null;
    await withPage(serve(createish), async (page) => {
      await page.evaluate((id) => window.openDraftsFocused(id), orphanId);
      await page.waitForFunction(() => window._draftsState && window._draftsState.loading === false, { timeout: 15000 });
      await page.waitForFunction(() => document.querySelectorAll('#draftsWrap .draft-row').length > 0, { timeout: 15000 });

      noticeA = await page.evaluate(() => {
        const el = document.querySelector('#draftsWrap .draft-notice');
        return el ? el.innerText.trim().replace(/\s+/g, ' ') : null;
      });
      T.check('the notice is rendered when the created row is absent', !!noticeA);
      T.check('the notice says the draft is saved', !!noticeA && /saved/i.test(noticeA));
      T.check('the list is still shown alongside the notice',
        (await rowsOf(page)).length === createish.body.rows.length,
        'a missing focus row is not a reason to withhold the drafts that ARE there');
      T.check('this is not the empty state',
        !(await page.evaluate(() => !!document.querySelector('#draftsWrap .empty-flips'))));
      T.check('and not the error state',
        !(await page.evaluate(() => !!document.querySelector('#draftsWrap .empty-flips-h'))));
    });

    // Cause B: the focused id is tombstoned. focusOffset is non-null — the
    // server found it in the index — and yet no row matches. Entirely
    // different cause, same thing to say.
    const tomb = F.focusTombstoned;
    const tombId = F.focusTombstonedTarget;
    T.check('the tombstone fixture has a non-null focusOffset', tomb.body.focusOffset !== null);
    T.check('and no row matches the focused id',
      !tomb.body.rows.some((r) => r.draftId === tombId));

    let noticeB = null;
    await withPage(() => ({ status: tomb.status, body: tomb.body }), async (page) => {
      await page.evaluate((id) => window.openDraftsFocused(id), tombId);
      await page.waitForFunction(() => window._draftsState && window._draftsState.loading === false, { timeout: 15000 });
      await page.waitForFunction(() => document.querySelectorAll('#draftsWrap .draft-row').length > 0, { timeout: 15000 });

      noticeB = await page.evaluate(() => {
        const el = document.querySelector('#draftsWrap .draft-notice');
        return el ? el.innerText.trim().replace(/\s+/g, ' ') : null;
      });
      T.check('the tombstone case renders the notice too', !!noticeB);
      T.check('the tombstone case is not an error', !!noticeB
        && !(/couldn.t load/i.test(await page.evaluate(() => document.getElementById('draftsWrap').innerText))));
    });

    T.check('the two causes produce the IDENTICAL string', !!noticeA && noticeA === noticeB,
      `per-cause copy: A=${JSON.stringify(noticeA)} B=${JSON.stringify(noticeB)}`);

    // The client cannot establish the cause and the server does not send it,
    // so naming one would be a guess presented as fact.
    T.check('the notice does not name a cause',
      !!noticeA && !/tombston|delet|index|repair|degrad|error|fail/i.test(noticeA));
  }

} catch (e) {
  console.log('\n  SUITE ERROR: ' + (e && e.stack || e));
  T.check('the suite ran to completion', false, String(e && e.message || e));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}

T.done();
