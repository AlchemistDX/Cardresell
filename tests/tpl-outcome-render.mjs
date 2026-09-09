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

const TPL_RE = /\/api\/tpl-proxy/;
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
  await p.evaluate(async ({ fn, args }) => {
    const el = document.getElementById('dropList');
    if (el) el.innerHTML = '';
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

try {
  await isolate(page);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.searchWithTPL === 'function', { timeout: 15000 });

  T.check('the page loads the bundle index.html names', true);

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
