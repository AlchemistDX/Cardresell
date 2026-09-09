/**
 * tests/tpl-outcome-render.mjs — RV-13, in a real browser.
 *
 * WHAT THIS ESTABLISHES, AND WHY SOURCE TEXT COULD NOT
 * ----------------------------------------------------
 * RV-13 was first filed with an interface-wide claim that could not be
 * supported: `searchWithTPL` returning null proves the HELPER merges outcomes,
 * it does not prove what any SCREEN says. Only one caller was ever traced to a
 * misleading string. So the assertion has to be "what is on screen after a
 * mocked 429", not "what does the source contain" — which needs a real DOM and
 * a real render.
 *
 * FOUR INPUT CONDITIONS, held distinct end to end:
 *   429 + reason per_ip_limit      -> rate_limited   (temporary, seller waits)
 *   503 + reason budget_exhausted  -> budget         (temporary, limit reached)
 *   transport failure              -> network        (temporary, connection)
 *   200 with data: []              -> genuine empty  (the ONLY "no matches")
 *
 * THE RULE THAT MATTERS MOST HERE
 * -------------------------------
 * A TPL failure must never replace a working fallback provider's results with
 * an error screen. Case group C proves that directly: TPL is rate-limited while
 * PokemonTCG.io answers normally, and the dropdown must show cards.
 *
 * Run: node tests/tpl-outcome-render.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = '/home/user/node_modules/playwright/index.js';
const T = harness('tpl-outcome-render');

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
    catch { res.writeHead(400).end(); return; }
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
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* ── Conditions ─────────────────────────────────────────────────────────────
   Each returns a Playwright route action for /api/tpl-proxy. `expect` is the
   data-tpl-reason the UI must carry, or null for the genuine-empty case.      */
const CONDITIONS = [
  { key: 'rate_limited', label: '429 per_ip_limit',
    act: r => r.fulfill({ status: 429, contentType: 'application/json',
      body: JSON.stringify({ error: 'Too many lookups from this address', reason: 'per_ip_limit' }) }) },
  { key: 'budget', label: '503 budget_exhausted',
    act: r => r.fulfill({ status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: 'Lookup temporarily unavailable', reason: 'budget_exhausted' }) }) },
  { key: 'network', label: 'transport failure',
    act: r => r.abort('failed') },
  { key: null, label: '200 with zero results',
    act: r => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: [], total: 0, limit: 100, offset: 0 }) }) },
];

/** The seven callers that own a dropList render. */
const CALLERS = [
  { fn: 'searchPokemon',   args: ['charizard'] },
  { fn: 'searchPokemonJP', args: ['pikachu'] },
  { fn: 'searchMTG',       args: ['black lotus'] },
  { fn: 'searchLorcana',   args: ['elsa'] },
  { fn: 'searchOnePiece',  args: ['luffy'] },
  { fn: 'searchYugioh',    args: ['dark magician'] },
  { fn: 'searchTPLGame',   args: ['goku', 'dragonball', '\u{1F409}', 'No Dragon Ball cards found.'] },
];

const NOT_FOUND_WORDING = /no (results|matches|pok|magic|lorcana|yu-gi|[a-z ]*cards) *(found|)/i;

const { chromium } = (await import(PW)).default;
const { server, port } = await startHost();
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));

/** Cut every network path except the ones a case deliberately opens. */
async function isolate(p) {
  // Fallback providers ANSWER, and answer empty. Aborting them instead made
  // the transport-failure cases throw inside the caller before any give-up
  // render happened — which is a real robustness gap (an aborted fallback
  // fetch is uncaught in six of these callers, recorded separately), but it is
  // not the condition under test. Here every provider must reply "nothing
  // found" so the give-up point is genuinely reached with no provider result.
  const EMPTY_JSON = { status: 200, contentType: 'application/json', body: '{"data":[],"results":[]}' };
  for (const pat of ['**://api.pokemontcg.io/**', '**://api.lorcana**',
    '**://db.ygoprodeck.com/**', '**://*.tcgdex.net/**']) {
    await p.route(pat, r => r.fulfill(EMPTY_JSON));
  }
  // Scryfall says "no such card" with a 404, which is the shape searchMTG reads.
  await p.route('**://api.scryfall.com/**', r => r.fulfill({
    status: 404, contentType: 'application/json', body: '{"object":"error","code":"not_found"}' }));
  for (const pat of ['**://www.googletagmanager.com/**', '**://*.google-analytics.com/**',
    '**://apis.google.com/**', '**://accounts.google.com/**',
    '**://*.vercel-insights.com/**', '**://*.firebaseio.com/**', '**://*.googleapis.com/**']) {
    await p.route(pat, r => r.abort());
  }
  // NO catch-all on **/api/** here. Playwright resolves the FIRST matching
  // handler, so a catch-all registered up front silently swallows the
  // /api/tpl-proxy mock each case depends on — which is how this suite first
  // reported every caller rendering "not found" when the mock never fired.
}

const EMPTY_JSON_FULFILL = { status: 200, contentType: 'application/json', body: '{"data":[],"results":[]}' };
const TPL_RE = /\/api\/tpl-proxy/;

/** A normal, successful proxy answer. */
const HEALTHY = r => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: [{ id: 'p1', name: 'Charizard ex', number: '223',
    set: { name: 'Obsidian Flames' }, rarity: 'Special Illustration Rare',
    images: {}, prices: { raw: { near_mint: { tcgplayer: { market: 120 } } } } }],
    total: 1, limit: 100, offset: 0 }),
});

/**
 * Wait until the page stops writing to the search box on its own. Two
 * consecutive stable reads, because the startup demo settles in stages.
 */
async function settle(p, ms = 600) {
  let last = null, stable = 0;
  for (let i = 0; i < 40; i++) {
    const v = await p.evaluate(() => document.getElementById('searchInput')?.value ?? null);
    if (v === last) { stable++; if (stable >= 2) return; } else { stable = 0; }
    last = v;
    await p.waitForTimeout(ms / 2);
  }
}
let tplHits = 0;
async function mountTpl(p, act) {
  // A regex, not a glob. The glob form matched nothing here and the suite
  // reported it honestly as every caller rendering "unavailable" — the mock
  // was never firing and the static host was answering 404.
  await p.unroute(TPL_RE).catch(() => {});
  await p.route(TPL_RE, async (route) => { tplHits++; await act(route); });
}

async function dropHtml(p) {
  return p.evaluate(() => document.getElementById('dropList')?.innerHTML || '');
}

async function runCaller(p, c) {
  // Item 3: put the seller's text in the REAL input first, so preservation can
  // be asserted on the element's value rather than on copy that claims it.
  await p.evaluate(async ({ fn, args }) => {
    const el = document.getElementById('dropList');
    if (el) el.innerHTML = '';
    const si = document.getElementById('searchInput');
    if (si) si.value = args[0];
    await window[fn](...args);
  }, { fn: c.fn, args: c.args });
  // The callers carry a stale-write guard and late provider settles, so a
  // render can land a tick after the call resolves. Reading once made this
  // suite flaky — a different caller failed on each run. Poll instead.
  for (let i = 0; i < 25; i++) {
    const h = await dropHtml(p);
    // Some callers paint their own "Searching…" placeholder first. Returning
    // on the first non-empty read picked that up and reported a false failure.
    if (h && h.trim() && !/drop-loading|Searching/i.test(h)) return h;
    await p.waitForTimeout(40);
  }
  return dropHtml(p);
}

/** The actual value sitting in the search box right now. */
const inputValue = p => p.evaluate(() => document.getElementById('searchInput')?.value ?? null);

try {
  await isolate(page);
  // The proxy mock is mounted BEFORE navigation, because the page runs a
  // first-visitor demo at startup — autoRunExampleCard() writes 'Charizard'
  // into the search box, calls doSearch(), polls for the dropdown and clicks
  // the top printing. That demo issues real lookups and overwrites the input,
  // and it is why an earlier version of this suite saw a random caller fail
  // with the input reading "Charizard": the demo was still settling. It is
  // startup behaviour, not a defect in the search path.
  await mountTpl(page, HEALTHY);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.searchWithTPL === 'function', { timeout: 15000 });

  T.check('the page loads the bundle index.html names', true);

  // Let the startup demo finish, then count what it cost before the seller has
  // typed anything at all.
  await settle(page);
  const bootHits = tplHits;
  T.check(`BOOT: the first-visitor demo issued ${bootHits} proxy request(s) before any typing`, true);

  /* ── A. the helper keeps the four conditions distinct ─────────────────── */
  for (const cond of CONDITIONS) {
    await mountTpl(page, cond.act);
    const res = await page.evaluate(() => window.searchWithTPL('charizard', 'pokemon'));
    if (cond.key === null) {
      T.check(`A/${cond.label}: helper reports a successful empty search`,
        res && res.ok === true && Array.isArray(res.cards) && res.cards.length === 0,
        JSON.stringify(res));
    } else {
      T.check(`A/${cond.label}: helper reports ok:false with reason "${cond.key}"`,
        res && res.ok === false && res.reason === cond.key, JSON.stringify(res));
    }
  }

  /* ── B. every caller renders the distinction ──────────────────────────── */
  for (const c of CALLERS) {
    for (const cond of CONDITIONS) {
      await mountTpl(page, cond.act);
      let html = '';
      try { html = await runCaller(page, c); }
      catch (e) { T.check(`B/${c.fn}/${cond.label}: caller ran`, false, String(e.message || e)); continue; }

      const reason = (html.match(/data-tpl-reason="([a-z_]+)"/) || [])[1] || null;
      const text = html.replace(/<[^>]*>/g, ' ');

      if (cond.key === null) {
        T.check(`B/${c.fn}: a genuine empty search does NOT claim unavailability`,
          reason === null, `rendered reason=${reason}`);
      } else {
        T.check(`B/${c.fn}/${cond.label}: renders reason "${cond.key}"`,
          reason === cond.key, `rendered reason=${reason} :: ${text.slice(0, 120)}`);
        T.check(`B/${c.fn}/${cond.label}: does not tell the seller the card was not found`,
          !NOT_FOUND_WORDING.test(text), text.slice(0, 160));
        T.check(`B/${c.fn}/${cond.label}: tells the seller their input is still there`,
          /still here|try again|connection/i.test(text), text.slice(0, 160));
        // Item 3: the copy is not the evidence. The element's value is.
        const live = await inputValue(page);
        T.check(`B/${c.fn}/${cond.label}: the search box STILL HOLDS "${c.args[0]}"`,
          live === c.args[0], `input value is now ${JSON.stringify(live)}`);
      }
    }
  }

  /* ── C. a working fallback is never replaced by an error screen ───────── */
  await page.unroute('**://api.pokemontcg.io/**').catch(() => {});
  await page.route('**://api.pokemontcg.io/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: [{ id: 'base1-4', name: 'Charizard', number: '4',
      set: { name: 'Base', releaseDate: '1999/01/09' }, rarity: 'Rare Holo',
      images: { small: 'x.png', large: 'x.png' }, tcgplayer: { prices: {} } }] }),
  }));
  await mountTpl(page, CONDITIONS[0].act); // TPL rate-limited
  const cHtml = await runCaller(page, CALLERS[0]);
  T.check('C: TPL rate-limited but PokemonTCG.io answers — cards still render',
    /drop-item/.test(cHtml), cHtml.replace(/<[^>]*>/g, ' ').slice(0, 200));
  T.check('C: …and no unavailability screen replaced them',
    !/data-tpl-state="unavailable"/.test(cHtml));
  await page.unroute('**://api.pokemontcg.io/**').catch(() => {});
  await page.route('**://api.pokemontcg.io/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }));

  /* ── F. the FALLBACK provider does not answer either ──────────────────────
     RV-13 item 2. Three callers did a bare `await fetch(url)` on their
     fallback, so a provider that never answered rejected out of the caller and
     the unavailability panel could not render — the promised recoverable state
     was unreachable exactly when it was needed. Two of them also read any
     non-ok status as "no such card".                                        */

  /** Route one provider to a failure and run its caller. */
  async function withProvider(pattern, action, caller, tplAct) {
    await page.unroute(pattern).catch(() => {});
    await page.route(pattern, action);
    await mountTpl(page, tplAct);
    const html = await runCaller(page, caller);
    const value = await inputValue(page);
    await page.unroute(pattern).catch(() => {});
    await page.route(pattern, r => r.fulfill(EMPTY_JSON_FULFILL));
    return { html, value, reason: (html.match(/data-tpl-reason="([a-z_]+)"/) || [])[1] || null };
  }

  const errsBeforeF = pageErrors.length;

  // F1 — both providers fail: TPL rate-limited, PokemonTCG.io unreachable.
  const f1 = await withProvider('**://api.pokemontcg.io/**', r => r.abort('failed'),
    CALLERS[0], CONDITIONS[0].act);
  T.check('F1: both providers failed — renders the unreachable-database state',
    f1.reason === 'network', `reason=${f1.reason} :: ${f1.html.replace(/<[^>]*>/g, ' ').slice(0, 140)}`);
  T.check('F1: and does not tell the seller the card was not found',
    !NOT_FOUND_WORDING.test(f1.html.replace(/<[^>]*>/g, ' ')));
  T.check('F1: the search box still holds "charizard"', f1.value === 'charizard',
    JSON.stringify(f1.value));

  // F2 — TPL SUCCEEDS and is genuinely empty, Scryfall unreachable. Before this
  // pass the caller rejected here; the seller saw nothing change at all.
  const f2 = await withProvider('**://api.scryfall.com/**', r => r.abort('failed'),
    CALLERS[2], CONDITIONS[3].act);
  T.check('F2: a successful-empty TPL plus an unreachable Scryfall is NOT "no Magic cards"',
    f2.reason === 'network', `reason=${f2.reason} :: ${f2.html.replace(/<[^>]*>/g, ' ').slice(0, 140)}`);
  T.check('F2: the search box still holds "black lotus"', f2.value === 'black lotus',
    JSON.stringify(f2.value));

  // F3 — YGOProDeck answers 500. Previously rendered "No Yu-Gi-Oh! cards found":
  // a provider failure told to the seller as an absence.
  const f3 = await withProvider('**://db.ygoprodeck.com/**',
    r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server"}' }),
    CALLERS[5], CONDITIONS[3].act);
  T.check('F3: a 500 from YGOProDeck reads as unavailable, not as an absence',
    f3.reason === 'unavailable', `reason=${f3.reason} :: ${f3.html.replace(/<[^>]*>/g, ' ').slice(0, 140)}`);

  // F4 — the discrimination has to cut both ways: YGOProDeck answers 400 for a
  // name that matches nothing, so 400 IS an absence for THIS provider.
  const f4 = await withProvider('**://db.ygoprodeck.com/**',
    r => r.fulfill({ status: 400, contentType: 'application/json',
      body: '{"error":"No card matching your query was found in the database."}' }),
    CALLERS[5], CONDITIONS[3].act);
  T.check('F4: a 400 from YGOProDeck is a genuine no-match and says so',
    f4.reason === null && /no yu-gi-oh! cards found/i.test(f4.html),
    `reason=${f4.reason} :: ${f4.html.replace(/<[^>]*>/g, ' ').slice(0, 140)}`);

  T.check('F: no uncaught rejection escaped any caller during these four cases',
    pageErrors.length === errsBeforeF,
    `new page errors: ${JSON.stringify(pageErrors.slice(errsBeforeF))}`);

  // F5 — recovery after a fallback failure, both providers healthy again.
  await mountTpl(page, HEALTHY);
  const f5 = await runCaller(page, CALLERS[0]);
  T.check('F5: the next request after a fallback failure succeeds and shows cards',
    /drop-item/.test(f5) && !/data-tpl-state="unavailable"/.test(f5),
    f5.replace(/<[^>]*>/g, ' ').slice(0, 160));

  /* ── D. recovery on a later successful request ────────────────────────── */
  await mountTpl(page, CONDITIONS[0].act);
  const before = await runCaller(page, CALLERS[3]); // lorcana, no fallback provider
  T.check('D: first request is refused and says so',
    /data-tpl-reason="rate_limited"/.test(before));
  await mountTpl(page, r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: [{ id: 'l1', name: 'Elsa - Snow Queen', number: '42',
      set: { name: 'The First Chapter' }, rarity: 'Legendary', images: {}, prices: { raw: {} } }],
      total: 1, limit: 100, offset: 0 }),
  }));
  const after = await runCaller(page, CALLERS[3]);
  T.check('D: the next successful request recovers and shows cards',
    /drop-item/.test(after) && !/data-tpl-state="unavailable"/.test(after),
    after.replace(/<[^>]*>/g, ' ').slice(0, 200));

  /* ── G. the EIGHTH caller: the scan/revisit path ──────────────────────────
     RV-13 item 1. _loadScannedCardExactImpl is not on window and MUST NOT be
     put there (no test-only production global), so this drives it through a
     real production entry instead: _restoreLastLoadedCard() reads the
     'cr:lastCard:v1' snapshot at boot and, when the snapshot has no _fullCard
     and no grounded id, hands the card to _loadScannedCardExact. That is the
     seller revisiting a scanned card after a refresh. Seeding the snapshot
     also turns the first-visitor demo off by itself (_hasSavedCard gates it),
     so this case is isolated without any test hook.                        */

  const SNAP = { name: 'Mega Greninja ex', number: '214', setName: 'Chaos Rising',
                 rarity: 'Special Illustration Rare', game: 'pokemon' };

  // A FRESH CONTEXT PER CONDITION. Two earlier shapes failed and are recorded
  // because each failed differently:
  //   * seeding localStorage from the loaded page and reloading — boot code
  //     clears the key before the 400 ms restore timer, so nothing restored;
  //   * one page with an init script — the first condition restored and the
  //     next three did not, i.e. run 1 left state behind that suppressed the
  //     restore on run 2.
  // Both showed up as an empty input and an empty dropdown, which is exactly
  // what a broken fixture and a broken product look like from the outside, so
  // the case is built to make that distinction impossible to fudge: the
  // 'ok but empty' condition MUST still produce a rendered not-found, which
  // only happens if the scan path actually ran.
  const scanErrors = [];

  async function runScanRevisit(tplAct) {
    const ctx = await browser.newContext();
    const sp = await ctx.newPage();
    sp.on('pageerror', e => scanErrors.push(String(e && e.message || e)));
    await isolate(sp);
    await sp.addInitScript(snap => {
      localStorage.setItem('cr:lastCard:v1', JSON.stringify(snap));
      localStorage.setItem('cs_landing_seen', '1'); // no first-visitor demo
    }, SNAP);
    await mountTpl(sp, tplAct);
    const before = tplHits;
    await sp.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await sp.waitForFunction(() => typeof window.searchWithTPL === 'function', { timeout: 15000 });
    // The restore is scheduled 400 ms after DOMContentLoaded; the scan path
    // then tries its providers and finally fires the same doSearch() a seller
    // pressing Enter would.
    await sp.waitForTimeout(1500);
    await settle(sp);
    const out = {
      hits: tplHits - before,
      missPanel: await sp.evaluate(() => {
        const el = document.getElementById('scanMissPanel');
        return el ? el.innerText.replace(/\s+/g, ' ').trim() : null;
      }),
      drop: await dropHtml(sp),
      value: await inputValue(sp),
    };
    await ctx.close();
    return out;
  }

  let revisitHits = null;
  for (const cond of CONDITIONS) {
    const g = await runScanRevisit(cond.act);
    if (revisitHits === null) revisitHits = g.hits;
    const dropText = g.drop.replace(/<[^>]*>/g, ' ');
    const reason = (g.drop.match(/data-tpl-reason="([a-z_]+)"/) || [])[1] || null;
    const surface = `missPanel=${g.missPanel ? JSON.stringify(g.missPanel.slice(0, 90)) : 'none'} :: reason=${reason} :: drop=${JSON.stringify(dropText.slice(0, 110))}`;

    T.check(`G/scan-revisit/${cond.label}: the scanned card is still presented, not erased`,
      g.value === SNAP.name, `input value ${JSON.stringify(g.value)} :: ${surface}`);

    if (cond.label === '200 with zero results') {
      // A completed lookup that found nothing: an absence may be stated here.
      T.check('G/scan-revisit/200 with zero results: a completed empty search IS allowed to say "not found"',
        reason === null && /no pok/i.test(dropText), surface);
    } else {
      T.check(`G/scan-revisit/${cond.label}: the dropdown it opens carries the unavailable state`,
        reason !== null, surface);
      T.check(`G/scan-revisit/${cond.label}: and no surface tells the seller the card was not found`,
        !NOT_FOUND_WORDING.test(dropText), surface);
    }
    T.check(`G/scan-revisit/${cond.label}: the scan notice reads as recoverable, not as an absence`,
      !!g.missPanel && /live pricing unavailable/i.test(g.missPanel),
      g.missPanel ? JSON.stringify(g.missPanel.slice(0, 140)) : 'no panel rendered');
  }
  T.check(`G: one revisit of one card issued ${revisitHits} proxy request(s)`, true,
    'restore hydrates twice (the panel is cleared and re-hydrated), and each hydration runs the scan path plus its doSearch');
  T.check('G: no uncaught rejection escaped the scan path in any condition',
    scanErrors.length === 0, JSON.stringify(scanErrors.slice(0, 3)));


  /* ── E. twenty-card measurement ───────────────────────────────────────── */
  await mountTpl(page, r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: [{ id: 'p1', name: 'Charizard ex', number: '223',
      set: { name: 'Obsidian Flames' }, rarity: 'Special Illustration Rare',
      images: {}, prices: { raw: { near_mint: { tcgplayer: { market: 120 } } } } }],
      total: 1, limit: 100, offset: 0 }),
  }));
  tplHits = 0;
  const CARDS = 20;
  const t0 = Date.now();
  for (let i = 0; i < CARDS; i++) {
    await page.evaluate(async (n) => {
      const el = document.getElementById('dropList');
      if (el) el.innerHTML = '';
      await window.searchPokemon('charizard ex ' + n);
    }, i);
  }
  const elapsed = Date.now() - t0;
  const perCard = tplHits / CARDS;
  T.check(`E: twenty cards handled issued ${tplHits} proxy requests ` +
          `(${perCard.toFixed(2)} per card, ${elapsed} ms wall clock)`, true);
  T.check('E: the measurement counted at least one request per card handled',
    tplHits >= CARDS, `hits=${tplHits}`);
  console.log(`\n  MEASUREMENT: ${tplHits} /api/tpl-proxy requests for ${CARDS} cards ` +
              `= ${perCard.toFixed(2)} per card handled, over ${elapsed} ms.\n` +
              `  Direct calls only — no typing, so the 180 ms debounce is NOT exercised here.\n`);

} catch (e) {
  console.log('\n  SUITE ERROR: ' + (e && e.stack || e));
  T.check('the suite ran to completion', false, String(e && e.message || e));
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}

T.done();
