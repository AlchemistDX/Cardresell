/**
 * tests/trs-listing-scope.mjs — the Top Rated Plus confirmation is scoped to
 * ONE listing, in a real browser.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The 10% Top Rated Plus discount needs two things: the seller holds Top Rated
 * status, and the listing itself qualifies. Status is durable and belongs to the
 * seller profile. Qualification is a property of one listing and does not.
 *
 * On 2026-09-07 it was implemented as a fifth seller-profile key. That was
 * wrong in a way the first fix did not reach: giving it its own key with a 'no'
 * default stopped an OLD saved profile from being misread as a confirmation,
 * which is a migration property. The value still persisted, so a seller who
 * confirmed while pricing one card kept confirming for every card after it, and
 * a reload turned a previous card's answer into the current card's eligibility.
 * The third review caught it. This suite is the permanent record that it cannot
 * come back.
 *
 * The four states are the review's own acceptance list:
 *   1. status only                          -> no discount
 *   2. confirmation for the current listing  -> percentage discount applies
 *   3. card / slot / listing terms change    -> confirmation clears
 *   4. confirmation withdrawn                -> discount gone, per-order fee unchanged
 *
 * State 3 is the one the original implementation failed, and it is checked
 * against every input that makes up the listing context, one at a time, so a
 * future edit that drops an input from the context fails here rather than
 * quietly widening the answer's reach.
 *
 * WHY A BROWSER AND NOT tests/listing-packet-offline.mjs
 * ------------------------------------------------------
 * That suite already pins the RULE -- trsDiscountApplies, feeEbay, the payout
 * row and the inversion -- as pure functions, including that a truthy
 * non-boolean is not a confirmation. What it cannot pin is SCOPE, because scope
 * is a question about the DOM, localStorage and a lexically-bound `selectedCard`
 * that only exist in a document. The two suites are not duplicates: one asks
 * "does the rule compute the right number", the other asks "does the answer
 * belong to this card".
 *
 * MUTATION EVIDENCE (2026-09-07, recorded here rather than only in a commit
 * message, because the shape of this table is the argument for the design and
 * commit messages are the one part of the corpus nobody greps).
 *
 *   A  remove touchListingContext() from the top of calc()      -> 2 red
 *   B  remove touchListingContext() from the search listener    -> 1 red
 *   C  drop _listingInstance from trsListingContext()           -> 1 red
 *   D  stop clearing the stamp in setSelectedCard()             -> GREEN
 *   E  drop the revision check in trsListingConfirmed()         -> GREEN
 *   F  keep the revision bump, remove the clear inside touch    -> GREEN
 *   G  remove BOTH the clear inside touch and the revision check-> 3 red
 *
 * D, E and F staying green is not a gap, and it is worth being precise about
 * why. E and F are the two halves of the same pair: the revision check alone
 * closes the round-trip hole (F), the clear-on-mismatch alone closes it (E),
 * and removing both opens it (G). Two mechanisms that are each individually
 * sufficient is the definition of defence in depth, and G is the proof that
 * neither is decorative. C and D are the same pair for listing identity.
 *
 * What no test here isolates is a single mechanism as NECESSARY, because none
 * of them is. If a future change removes one, this suite stays green by design;
 * G is the case that fails if someone removes two.
 *
 * Run: node tests/trs-listing-scope.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = '/home/user/node_modules/playwright/index.js';

const T = harness('trs-listing-scope');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};

/* Self-hosted on port 0, same as the other two screen suites. An ungated
   loopback origin, so nothing here can reach production and the port cannot
   collide with the long-lived static servers in this sandbox. */
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
const { chromium } = _pw;
const browser = await chromium.launch();

async function boot() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('  [pageerror] ' + e.message); });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.trsListingConfirmed === 'function', { timeout: 15000 });
  return { ctx, page };
}

/* Puts the page into a state that stands in for "a card is being priced":
   a search term, a price, and shipping figures. selectedCard stays null because
   it is a lexical binding no test can assign (see trsListingContext), which is
   exactly why the context also reads the search input. */
async function setListing(page, over = {}) {
  await page.evaluate((o) => {
    /* Dispatches the real event, because the first version of this helper
       assigned .value and dispatched nothing. Every assertion below still
       passed, which is the problem: priceOverride, shipCharge and shipCost
       carry oninput="calc()" in the markup, so a silent assignment tested a
       code path no seller can take and proved nothing about the wiring. */
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('searchInput', o.card ?? 'Charizard VMAX');
    set('priceOverride', o.price ?? '400');
    set('shipCharge', o.shipCharge ?? '0');
    set('shipCost', o.shipCost ?? '0');
    set('ebayStore', o.store ?? 'none');
    set('ebayPromo', o.promo ?? '0');
    set('ebayTopRated', o.status ?? 'yes');
    /* Deliberately does NOT default the confirmation control. An earlier
       version wrote 'no' on every call, which reset the control before
       syncTrsListingControl could be observed clearing it -- the helper was
       quietly doing the thing under test. Only an explicit `listing` moves it. */
    if (o.listing !== undefined) set('ebayTrsListing', o.listing);
  }, over);
}

/* Answers the confirmation the way the real control does: stamp the context,
   then recalculate. Going through noteTrsListingAnswer rather than setting a
   variable means the test exercises the same entry point the onchange handler
   uses, so a change to that handler is visible here. */
async function answer(page, value) {
  await page.evaluate((v) => {
    document.getElementById('ebayTrsListing').value = v;
    window.noteTrsListingAnswer();
  }, value);
}

/* The two numbers that matter, read from the live fee engine rather than from
   any rendered surface, so this suite stays about scope and does not duplicate
   the ranking surface's rendering assertions. */
async function fees(page) {
  return page.evaluate(() => {
    const prof = window._crSellerProfile();
    const elig = window.trsDiscountApplies(prof, window.trsListingConfirmed());
    const price = parseFloat(document.getElementById('priceOverride').value) || 0;
    const rows = window.feeEbay(price, 0, prof.ebayStore, prof.ebayPromo, elig);
    const fvf = rows.find((r) => /Final Value Fee/.test(r.l));
    const perOrder = rows.find((r) => !/Final Value Fee/.test(r.l) && r.a > 0 && r.a < 1);
    return {
      eligible: elig,
      confirmed: window.trsListingConfirmed(),
      fvf: fvf ? fvf.a : null,
      fvfLabel: fvf ? fvf.l : null,
      perOrder: perOrder ? perOrder.a : null,
      selectValue: document.getElementById('ebayTrsListing').value,
    };
  });
}

const near = (a, b) => Math.abs(a - b) < 0.005;

// ── State 1 ────────────────────────────────────────────────────────────────
await T.section('state 1 — Top Rated status alone earns no discount', async () => {
  const { ctx, page } = await boot();
  await setListing(page, { status: 'yes', listing: 'no' });
  const f = await fees(page);
  T.check('the seller really is Top Rated',
    await page.evaluate(() => window._crSellerProfile().ebayTopRated) === 'yes');
  T.check('🔴 no confirmation, so no eligibility', f.eligible === false, JSON.stringify(f));
  T.check('the full percentage fee is charged', near(f.fvf, 400 * 0.1325), `fvf=${f.fvf}`);
  T.check('the row does not name a programme the listing has not earned',
    !/Top Rated Plus/.test(f.fvfLabel || ''), String(f.fvfLabel));
  await ctx.close();
});

// ── State 2 ────────────────────────────────────────────────────────────────
await T.section('state 2 — a confirmation for the current listing applies it', async () => {
  const { ctx, page } = await boot();
  await setListing(page, { status: 'yes' });
  await answer(page, 'yes');
  const f = await fees(page);
  T.check('the confirmation is live for this listing', f.confirmed === true, JSON.stringify(f));
  T.check('eligibility follows', f.eligible === true);
  T.check('the percentage fee is exactly 90% of the full rate',
    near(f.fvf, 400 * 0.1325 * 0.9), `fvf=${f.fvf} expected=${(400 * 0.1325 * 0.9).toFixed(4)}`);
  T.check('the row names Top Rated Plus, the thing that granted it',
    /Top Rated Plus/.test(f.fvfLabel || ''), String(f.fvfLabel));
  await ctx.close();
});

// ── State 3 ────────────────────────────────────────────────────────────────
/* One case per context input. Written as a loop over real inputs rather than
   one combined case, because a combined case passes as long as ANY input
   invalidates the answer -- and would therefore keep passing while an input was
   quietly dropped from the context. */
const MOVES = [
  { what: 'the card being priced', apply: (o) => ({ ...o, card: 'Pikachu VMAX' }) },
  { what: 'the asking price', apply: (o) => ({ ...o, price: '450' }) },
  { what: 'buyer-paid shipping', apply: (o) => ({ ...o, shipCharge: '5.95' }) },
  { what: 'the postage the seller pays', apply: (o) => ({ ...o, shipCost: '4.50' }) },
];

for (const mv of MOVES) {
  await T.section(`state 3 — changing ${mv.what} clears the confirmation`, async () => {
    const { ctx, page } = await boot();
    const start = { status: 'yes' };
    await setListing(page, start);
    await answer(page, 'yes');
    const before = await fees(page);
    T.check('the discount was genuinely applied first',
      before.eligible === true && near(before.fvf, 400 * 0.1325 * 0.9),
      JSON.stringify(before));

    await setListing(page, mv.apply(start));
    const after = await fees(page);
    T.check('🔴 the confirmation no longer counts',
      after.confirmed === false && after.eligible === false, JSON.stringify(after));

    /* And the visible control stops saying Yes. A control still reading "Yes"
       beside an undiscounted fee is worse than the original bug: the seller
       would see a confirmation and a full fee and have no way to reconcile
       them.

       CHANGED 2026-09-07 (second pass). This used to call
       syncTrsListingControl() itself and assert it returned true, i.e. that it
       found something to clear. That passed only because the helper driving
       these edits assigned .value without dispatching an event, so the real
       oninput="calc()" handler never ran and the control was still sitting on a
       stale "Yes" waiting for the test to clean up after it. With real events
       dispatched, calc() clears the control during the edit and the explicit
       call correctly finds nothing to do. The assertion now checks the state
       the seller would actually see, which is what it should have checked
       first: after a real edit, the control reads "no" already. */
    const shown = await page.evaluate(() => ({
      value: document.getElementById('ebayTrsListing').value,
      furtherWorkNeeded: window.syncTrsListingControl(),
    }));
    T.check('the control has already cleared itself by the time the edit settles',
      shown.value === 'no', JSON.stringify(shown));
    T.check('and nothing is left for a later sync to fix',
      shown.furtherWorkNeeded === false, JSON.stringify(shown));
    await ctx.close();
  });
}

await T.section('state 3 — changing the grade slot clears the confirmation', async () => {
  const { ctx, page } = await boot();
  await setListing(page, { status: 'yes' });
  await answer(page, 'yes');
  T.check('the discount was genuinely applied first',
    (await fees(page)).eligible === true);
  // The grade pills are the slot the ranking surface prices against. Moving the
  // selection is a different listing, not a different opinion about this one.
  const moved = await page.evaluate(() => {
    const pills = [...document.querySelectorAll('#gradedPills .pill')];
    if (pills.length < 2) return { skipped: true, n: pills.length };
    const cur = document.querySelector('#gradedPills .pill.sel');
    const next = pills.find((p) => p !== cur);
    if (cur) cur.classList.remove('sel');
    next.classList.add('sel');
    return { skipped: false, to: next.dataset.val };
  });
  if (moved.skipped) {
    T.check('grade pills are present to move', false, `only ${moved.n} pill(s) found`);
  } else {
    const after = await fees(page);
    T.check('🔴 the confirmation no longer counts after a slot change',
      after.confirmed === false && after.eligible === false,
      `moved to ${moved.to} — ${JSON.stringify(after)}`);
  }
  await ctx.close();
});

// ── State 4 ────────────────────────────────────────────────────────────────
await T.section('state 4 — withdrawing the confirmation removes only the percentage discount', async () => {
  const { ctx, page } = await boot();
  await setListing(page, { status: 'yes' });
  await answer(page, 'yes');
  const on = await fees(page);
  await answer(page, 'no');
  const off = await fees(page);

  T.check('the discount was applied before withdrawal', on.eligible === true, JSON.stringify(on));
  T.check('🔴 withdrawal removes eligibility', off.eligible === false, JSON.stringify(off));
  T.check('the percentage fee returns to the full rate',
    near(off.fvf, 400 * 0.1325), `fvf=${off.fvf}`);
  /* eBay: "The discount does not apply to the per order portion of the final
     value fee." So the per-order fee must be byte-identical across all four
     states -- if withdrawal moved it, we would be modelling a discount eBay
     does not give and then removing one it never gave. */
  T.check('🔴 the per-order fee is unchanged by the discount either way',
    on.perOrder === off.perOrder, `on=${on.perOrder} off=${off.perOrder}`);
  T.check('the row stops naming Top Rated Plus',
    !/Top Rated Plus/.test(off.fvfLabel || ''), String(off.fvfLabel));
  await ctx.close();
});

// ── Persistence ────────────────────────────────────────────────────────────
await T.section('the confirmation never survives a reload', async () => {
  const { ctx, page } = await boot();
  await setListing(page, { status: 'yes' });
  await answer(page, 'yes');
  T.check('confirmed before reload', (await fees(page)).eligible === true);

  // Persist the profile the way the real change handler does, so this is the
  // strongest form of the case: everything that CAN be saved has been.
  const saved = await page.evaluate(() => {
    window.saveSellerProfile();
    try { return String(localStorage.getItem('cr_seller_profile_v1') || ''); }
    catch (e) { return 'THREW'; }
  });
  T.check('🔴 the saved profile contains no listing confirmation',
    !/ebayTrsListing/.test(saved), saved);
  T.check('the saved profile does still carry the durable seller status',
    /ebayTopRated/.test(saved), saved);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.trsListingConfirmed === 'function', { timeout: 15000 });
  /* Wait for the profile to be REHYDRATED, not merely for the bundle to have
     evaluated. Restoring the saved profile into the controls happens after
     load, so reading ebayTopRated too early sees the markup default and this
     case failed intermittently -- and it failed on the assertion that says the
     durable status survived, i.e. it looked like the scope fix had eaten the
     seller's status. A flake that impersonates a regression is worse than a
     flake, so the wait is on the observable state rather than a timeout.

     There is a second reason this one mattered, worth stating because it is the
     more expensive failure mode. A flake that fails in a RANDOM shape gets
     investigated. A flake that fails in the exact shape of the bug the change
     under test could plausibly have caused gets pattern-matched to "known
     flaky, re-run it" -- and then the day the scope fix genuinely does eat the
     seller's durable status, the assertion that catches it is the one everybody
     has been trained to dismiss. The wait is not just about green runs; it is
     about keeping this assertion's failures meaningful. */
  await page.waitForFunction(
    () => (document.getElementById('ebayTopRated') || {}).value === 'yes',
    { timeout: 15000 },
  );
  const after = await page.evaluate(() => ({
    confirmed: window.trsListingConfirmed(),
    status: window._crSellerProfile().ebayTopRated,
    control: (document.getElementById('ebayTrsListing') || {}).value,
  }));
  T.check('🔴 a reload does not convert a prior answer into current eligibility',
    after.confirmed === false, JSON.stringify(after));
  T.check('the control comes back at its safe default', after.control === 'no', JSON.stringify(after));
  T.check('the durable status did survive, so this is a scope fix and not a regression',
    after.status === 'yes', JSON.stringify(after));
  await ctx.close();
});

// ── The context itself ─────────────────────────────────────────────────────
await T.section('an answer carries the context it was given in', async () => {
  const { ctx, page } = await boot();
  await setListing(page, { status: 'yes' });
  const ctx1 = await page.evaluate(() => window.trsListingContext());
  await answer(page, 'yes');
  await setListing(page, { status: 'yes', card: 'Mewtwo GX' });
  const ctx2 = await page.evaluate(() => window.trsListingContext());
  T.check('a different card is a different context', ctx1 !== ctx2, `${ctx1} vs ${ctx2}`);

  // Returning to the original listing must NOT resurrect the answer. The stamp
  // is cleared on read, so a seller who wanders away and back re-confirms.
  await page.evaluate(() => window.syncTrsListingControl());
  await setListing(page, { status: 'yes' });
  const back = await fees(page);
  T.check('🔴 returning to the original listing does not resurrect the answer',
    back.confirmed === false && back.eligible === false, JSON.stringify(back));
  await ctx.close();
});

// ── The ordering hole ──────────────────────────────────────────────────────
/* The follow-up review's blocker. Deleting the stamp when a stale read happens
   protects nothing if no read happens between the two edits. These cases make
   the round trip through real events with NO eligibility call in between, and
   the discount must still be off at the end. */

await T.section('a price round-trip with no read in between does not revive the answer', async () => {
  const { ctx, page } = await boot();
  await setListing(page, { status: 'yes', price: '400' });
  await answer(page, 'yes');
  T.check('confirmed at the starting price', (await fees(page)).eligible === true);

  /* Emptying the field is the interesting move, not changing the number.
     calc() returns early when the price is <= 0, and the eligibility read sits
     below that return, so this is the one supported edit on which no comparison
     used to be performed. Both edits go through the real oninput handler and
     nothing in this test calls the reader between them. */
  await page.evaluate(() => {
    const el = document.getElementById('priceOverride');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.value = '400';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const after = await fees(page);
  T.check('🔴 clearing the price and retyping it requires a fresh confirmation',
    after.confirmed === false && after.eligible === false, JSON.stringify(after));
  T.check('the full percentage fee is charged again', near(after.fvf, 400 * 0.1325), `fvf=${after.fvf}`);
  await ctx.close();
});

await T.section('a search round-trip through the debounce does not revive the answer', async () => {
  const { ctx, page } = await boot();
  await setListing(page, { status: 'yes', card: 'Charizard VMAX' });
  await answer(page, 'yes');
  T.check('confirmed on the original query', (await fees(page)).eligible === true);

  /* The search listener debounces by 180ms and never calls calc(), so this path
     had no synchronous reader at all. Both keystrokes are dispatched back to
     back, inside one evaluate, so the debounce cannot have fired in between and
     the test cannot accidentally supply the read it is meant to do without. */
  await page.evaluate(() => {
    const el = document.getElementById('searchInput');
    el.value = 'Pikachu VMAX';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.value = 'Charizard VMAX';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const after = await fees(page);
  T.check('🔴 typing away and back requires a fresh confirmation',
    after.confirmed === false && after.eligible === false, JSON.stringify(after));
  await ctx.close();
});

await T.section('the revision only ever moves forward', async () => {
  const { ctx, page } = await boot();
  await setListing(page, { status: 'yes', price: '400' });
  const seen = await page.evaluate(() => {
    const el = document.getElementById('priceOverride');
    const revs = [window.touchListingContext()];
    for (const v of ['450', '400', '450', '400']) {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      revs.push(window.touchListingContext());
    }
    return revs;
  });
  T.check('🔴 returning to an earlier context does not return to an earlier revision',
    seen.every((r, i) => i === 0 || r >= seen[i - 1]) && seen[seen.length - 1] > seen[0],
    JSON.stringify(seen));
  await ctx.close();
});

// ── The identity axis, one component at a time ─────────────────────────────
/* Moving the query does not test selectedCard.id: the suite would still pass
   with the id removed from the stamp entirely. Each component is therefore
   moved on its own, with everything else held constant. setSelectedCard is the
   real production boundary all eleven assignment sites go through, not a
   test-only global. */

await T.section('changing the selected card while the query text is unchanged invalidates', async () => {
  const { ctx, page } = await boot();
  await setListing(page, { status: 'yes', card: 'Charizard' });
  await page.evaluate(() => window.setSelectedCard({ id: 'sv-001', name: 'Charizard', game: 'pokemon' }));
  await answer(page, 'yes');
  T.check('confirmed against the first card', (await fees(page)).eligible === true);

  const held = await page.evaluate(() => {
    const before = document.getElementById('searchInput').value;
    // Same visible name, different catalog id. Nothing else moves.
    window.setSelectedCard({ id: 'base-004', name: 'Charizard', game: 'pokemon' });
    return { before, after: document.getElementById('searchInput').value };
  });
  T.check('the query text really was held constant',
    held.before === held.after && held.after === 'Charizard', JSON.stringify(held));
  const after = await fees(page);
  T.check('🔴 a different catalog id is a different listing',
    after.confirmed === false && after.eligible === false, JSON.stringify(after));
  await ctx.close();
});

await T.section('changing only the query while the selected card is unchanged invalidates', async () => {
  const { ctx, page } = await boot();
  await setListing(page, { status: 'yes', card: 'Charizard' });
  await page.evaluate(() => window.setSelectedCard({ id: 'sv-001', name: 'Charizard', game: 'pokemon' }));
  await answer(page, 'yes');
  T.check('confirmed against the first query', (await fees(page)).eligible === true);
  await page.evaluate(() => {
    const el = document.getElementById('searchInput');
    el.value = 'Charizard ex';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const after = await fees(page);
  T.check('🔴 the seller starting to type another card expires the answer',
    after.confirmed === false && after.eligible === false, JSON.stringify(after));
  await ctx.close();
});

await T.section('a new scan of an identical card does not inherit the confirmation', async () => {
  const { ctx, page } = await boot();
  await setListing(page, { status: 'yes', card: 'Charizard VMAX', price: '400' });
  const card = { id: 'swsh-020', name: 'Charizard VMAX', game: 'pokemon' };
  await page.evaluate((c) => window.setSelectedCard({ ...c }), card);
  await answer(page, 'yes');
  T.check('confirmed on the first scan', (await fees(page)).eligible === true);

  /* Catalog identity is not listing identity. This second object is equal to
     the first on every field the context can see -- id, name, game -- and every
     DOM input is untouched, so the context comparison cannot tell them apart.
     Only the instance counter can, which is the reason it exists. */
  const same = await page.evaluate((c) => {
    const before = window.trsListingContext();
    window.setSelectedCard({ ...c });
    return { before, after: window.trsListingContext() };
  }, card);
  T.check('every visible component of the two contexts is identical',
    same.before.split('|').slice(1).join('|') === same.after.split('|').slice(1).join('|'),
    JSON.stringify(same));
  T.check('🔴 only the listing instance distinguishes them, and it did',
    same.before !== same.after, JSON.stringify(same));
  const after = await fees(page);
  T.check('🔴 the second scan starts unconfirmed',
    after.confirmed === false && after.eligible === false, JSON.stringify(after));
  await ctx.close();
});

await T.section('an ordinary repaint keeps a valid confirmation', async () => {
  const { ctx, page } = await boot();
  await setListing(page, { status: 'yes', price: '400' });
  await answer(page, 'yes');
  /* The guards must expire an answer that no longer applies without expiring
     one that does. Recalculating, touching the boundary and re-reading
     eligibility are all things the app does many times per listing, and if any
     of them consumed the answer the seller would have to re-confirm to see a
     number they had already earned. */
  const reads = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 5; i++) {
      window.touchListingContext();
      window.syncTrsListingControl();
      try { window.calc(); } catch (e) { /* ranking needs more state than this fixture has */ }
      out.push(window.trsListingConfirmed());
    }
    return out;
  });
  T.check('🔴 five repaints in a row do not consume the answer',
    reads.every((r) => r === true), JSON.stringify(reads));
  T.check('and the control still shows Yes',
    (await fees(page)).selectValue === 'yes');
  await ctx.close();
});

// ── Boundary coverage ──────────────────────────────────────────────────────
await T.section('every context input reaches the mutation boundary', async () => {
  const { ctx, page } = await boot();
  await setListing(page, { status: 'yes', price: '400' });
  /* The revision guard is only as good as the set of paths that reach the
     boundary. Rather than trusting that, each DOM input in the context is moved
     through its real event and the revision must advance. A future edit that
     removes oninput="calc()" from one of these, or adds an input to the context
     without a handler, fails here -- which is the failure mode the two previous
     attempts at this feature both had. */
  const inputs = ['priceOverride', 'shipCharge', 'shipCost', 'searchInput'];
  for (const id of inputs) {
    const moved = await page.evaluate((elId) => {
      const el = document.getElementById(elId);
      if (!el) return { missing: true };
      const before = window.touchListingContext();
      el.value = elId === 'searchInput' ? 'Some Other Card' : '77';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return { missing: false, before, after: window.touchListingContext() };
    }, id);
    T.check(`${id} advances the revision through its own event`,
      moved.missing === false && moved.after > moved.before, `${id} — ${JSON.stringify(moved)}`);
  }
  await ctx.close();
});

await browser.close();
server.close();
T.done();
