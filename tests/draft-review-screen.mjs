/**
 * tests/draft-review-screen.mjs — the D3 review screen, in a real browser.
 *
 * WHY THIS FILE EXISTS IN THE REPO
 * -------------------------------
 * These checks were written during D3 steps 2 and 3 and lived in /tmp. That
 * was fine for a scratch verification and wrong as a resting place: a suite
 * outside version control cannot fail anyone but the person who ran it, and it
 * hand-wrote its own envelopes, which Part 4 of the contract forbids.
 *
 * Moving them in-repo forced the fixture rule to be honoured, and the rule paid
 * for itself again: generating the read envelope from the real handler is what
 * showed `readiness.blockers[n]` carrying a `field` key at all. The scratch
 * file's hand-written envelope had no `field`, because the person writing it
 * did not know there was one to write.
 *
 * NOT YET REGISTERED in tests/run-all.sh. That wiring belongs to D3 step 6
 * along with the rest of the suite-ladder decision. The assertions are durable
 * now; only the runner entry is deferred, and this comment is the record that
 * the deferral is deliberate.
 *
 * Run: node tests/draft-review-screen.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';
import { generateReadFixtures } from './_draftListFixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = '/home/user/node_modules/playwright/index.js';

const T = harness('draft-review-screen');

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

const clone = (x) => JSON.parse(JSON.stringify(x));

const { server, port } = await startHost();
const _pw = (await import(PW)).default;
const { chromium } = _pw;
const browser = await chromium.launch();

const F = await generateReadFixtures();

async function boot(plan) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('  [pageerror] ' + e.message); });
  const hits = [];
  await page.route('**/api/drafts*', async (route) => {
    const u = new URL(route.request().url());
    hits.push(Object.fromEntries(u.searchParams));
    const out = plan(u.searchParams, hits.length - 1) || { status: 200, body: {} };
    await route.fulfill({ status: out.status, contentType: 'application/json', body: JSON.stringify(out.body ?? {}) });
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.renderReviewView === 'function', { timeout: 15000 });
  // AFTER load, never in an init script — `_crIdToken` is a top-level async
  // function declaration and evaluating the bundle overwrites an early stub.
  await page.evaluate(() => { window._crIdToken = async () => 'test-id-token'; });
  const tok = await page.evaluate(async () => await window._crIdToken());
  if (tok !== 'test-id-token') throw new Error('token stub did not take effect: ' + tok);
  return { ctx, page, hits };
}

const serveRead = (fx) => () => ({ status: fx.status, body: fx.body });

async function openReview(page, id) {
  await page.evaluate((i) => window.openDraftReview(i), id);
  await page.waitForFunction(() => window._reviewState && window._reviewState.loading === false, { timeout: 15000 });
  await page.waitForFunction(() => {
    const w = document.getElementById('reviewWrap');
    return w && w.innerHTML.trim().length > 0;
  }, { timeout: 15000 });
}

/** Every rendered field group, with the blocker lines attached to each. */
const fieldsOf = (page) => page.evaluate(() => (
  [...document.querySelectorAll('#reviewWrap .review-field')].map((el) => ({
    field: el.getAttribute('data-review-field'),
    label: (el.querySelector('.review-field-label') || {}).innerText || '',
    value: (el.querySelector('.review-field-value') || {}).innerText || '',
    blockers: [...el.querySelectorAll('.review-blocker')].map((b) => ({
      code: b.getAttribute('data-blocker-code'), text: b.innerText,
    })),
  }))
));

try {

  /* ─────────────────────────────────────────────────────────────────────────
     The read envelope carries `readiness`

     This closes a standing gap. `readiness` was added to the read response on
     the D2.1 rename, and until now NO registered assertion said the read body
     carries it — the contract asserted it and the code did it, with nothing in
     between. It is asserted against a GENERATED envelope, so it is a claim
     about what the handler emits, not about what a fixture author believed.
     ───────────────────────────────────────────────────────────────────────── */
  await T.section('the read response body carries readiness', async () => {
    for (const k of ['publishable', 'blockedTitle', 'blockedPrice', 'blockedBoth']) {
      const b = F[k].body;
      T.check(`${k}: status 200`, F[k].status === 200, String(F[k].status));
      T.check(`${k}: body has a readiness object`, !!b.readiness && typeof b.readiness === 'object');
      T.check(`${k}: readiness.publishable is a boolean`, typeof b.readiness.publishable === 'boolean');
      T.check(`${k}: readiness.blockers is an array`, Array.isArray(b.readiness.blockers));
      T.check(`${k}: every blocker carries code, field and message`,
        b.readiness.blockers.every((x) => typeof x.code === 'string' && typeof x.field === 'string' && typeof x.message === 'string'),
        JSON.stringify(b.readiness.blockers));
      // The old wire shape had no `field`. If it ever goes back, the screen
      // silently loses every association and lands everything in the
      // draft-level group, which still LOOKS fine. So pin the key.
      // Guarded against `field` being absent entirely, not just empty. The
      // first version read `x.field.length > 0` directly and threw a
      // TypeError when the mutation test removed `field` from the wire --
      // which aborted the run after ONE reported failure and skipped every
      // later case. An assertion that crashes on the condition it exists to
      // detect is worse than no assertion: it converts a broad regression
      // into a single line of output and silently cancels the rest of the
      // suite.
      T.check(`${k}: no blocker has an empty or missing field`,
        b.readiness.blockers.every((x) => typeof x.field === 'string' && x.field.length > 0),
        JSON.stringify(b.readiness.blockers.map((x) => x.field)));
    }
  });

  /* ─────────────────────────────────────────────────────────────────────────
     Design tokens actually resolve

     This assertion exists because D3 step 3 shipped
     `outline:2px solid var(--accent)` and `--accent` is not a declared token.
     An undefined custom property makes the WHOLE declaration invalid, so the
     focus ring did not render at all — on the one control whose entire
     justification was that a keyboard user must be able to reach it.
     Every behaviour test passed: activation worked. Nothing could see that the
     focus indicator was missing, because "Enter opens the row" is true with or
     without a visible ring.
     ───────────────────────────────────────────────────────────────────────── */
  await T.section('every token the stylesheet references is declared', async () => {
    // DERIVED, NOT LISTED. The first version of this case hand-listed seven
    // token names and asserted they resolved. That would have caught
    // `--accent` only because the author already knew to look for it -- a
    // hand-maintained list of the things worth checking is the same failure as
    // a hand-maintained offset table, just quieter. So the list comes out of
    // the stylesheet itself, and a future `var(--nonexistent)` fails here
    // without anyone updating this test.
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const declared = new Set([...html.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
    const refs = [...html.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/gi)]
      .map((m) => ({ name: m[1], hasFallback: !!m[2] }));

    const undeclared = [...new Set(refs.filter((r) => !declared.has(r.name) && !r.hasFallback).map((r) => r.name))];

    // KNOWN PRE-EXISTING DEBT, found by this check on the day it was written.
    // Eight references across four tokens that were never declared, so eight
    // declarations silently do not apply. Recorded in
    // audit/CSS_TOKEN_DEBT.md with the affected selectors.
    //
    // This is a RATCHET, not an exemption: the assertion is that no token
    // outside this set is undeclared, so a new one fails immediately. Fixing
    // one of these does NOT break the suite -- the set may legitimately go
    // stale in the safe direction. It is deliberately not a count, because a
    // count is a number someone has to maintain for no benefit.
    // Was ['--text-primary', '--amber', '--amber-bg', '--muted'].
    // --amber and --amber-bg are gone because the two rules that referenced
    // them (.warning-banner, .clamp-note) were pointed at --orange /
    // --orange-bg, the warning tier that was already declared and already
    // working in .note-warn. They were never a missing palette entry; they
    // were a second implementation of a colour the palette already had.
    const KNOWN_UNDECLARED = ['--text-primary', '--muted'];
    const fresh = undeclared.filter((n) => !KNOWN_UNDECLARED.includes(n));

    // The ratchet has to shrink, or it is not a ratchet -- it is a list where
    // fixed debt lingers, which is the "number someone maintains for no
    // benefit" failure this file already refuses elsewhere. If an entry stops
    // being referenced, this fails and the entry must come out.
    const stale = KNOWN_UNDECLARED.filter((n) => !undeclared.includes(n));
    T.check('every entry in KNOWN_UNDECLARED is still actually referenced',
      stale.length === 0,
      'fixed but still listed, remove from the baseline: ' + stale.join(', '));

    T.check(`no NEW undeclared token is referenced without a fallback (${refs.length} refs, ${declared.size} declared)`,
      fresh.length === 0,
      'newly undeclared: ' + fresh.join(', ')
      + ' -- an undefined custom property invalidates the ENTIRE declaration that uses it, '
      + 'so the rule silently does not apply');

    // The ratchet has to be able to fire, or it is decoration. `--accent` is
    // the token D3 step 3 actually shipped by mistake; if it ever comes back,
    // it is not on the known list and this proves the check would catch it.
    T.check('the ratchet would catch --accent coming back',
      !KNOWN_UNDECLARED.includes('--accent') && !declared.has('--accent'));

    // The derivation has to be capable of finding something, or a broken regex
    // reads as a clean bill of health.
    T.check('the scan found a substantial number of references', refs.length > 100, String(refs.length));
    T.check('the scan found the declarations too', declared.size > 20, String(declared.size));
    T.check('a token known to be referenced is in the declared set', declared.has('--border'));
    T.check('a token known NOT to exist is absent from the declared set', !declared.has('--accent'),
      'the negative control failed, so the scan cannot distinguish declared from undeclared');

    // And confirm the browser agrees with the static scan, since the scan
    // reads text and the browser is what actually drops invalid declarations.
    const { ctx, page } = await boot(serveRead(F.publishable));
    const probe = await page.evaluate((names) => {
      const cs = getComputedStyle(document.documentElement);
      return names.map((n) => [n, cs.getPropertyValue(n).trim().length > 0]);
    }, ['--border', '--red', '--gold', '--text-muted', '--accent']);
    for (const [name, resolves] of probe) {
      if (name === '--accent') {
        T.check('--accent resolves to nothing in the browser, as the scan said', resolves === false);
      } else {
        T.check(`${name} resolves in the browser, as the scan said`, resolves === true);
      }
    }
    await ctx.close();
  });

  /* ─────────────────────────────────────────────────────────────────────────
     Fields render, with each blocker under the field it names
     ───────────────────────────────────────────────────────────────────────── */
  await T.section('a clean draft renders its fields with nothing attached', async () => {
    const { ctx, page, hits } = await boot(serveRead(F.publishable));
    await openReview(page, F.ids.publishable);
    const fields = await fieldsOf(page);
    const t = await page.evaluate(() => document.getElementById('reviewWrap').innerText);

    T.check('exactly one request, by id', hits.length === 1 && hits[0].id === F.ids.publishable, JSON.stringify(hits));
    T.check('it did not use ids=', hits.length === 1 && hits[0].ids === undefined);
    T.check('three field groups rendered', fields.length === 3, JSON.stringify(fields.map((f) => f.field)));
    T.check('the fields are title, price, marketplace, in repair order',
      fields.map((f) => f.field).join(',') === 'title,price,slot');
    T.check('no blocker lines anywhere', fields.every((f) => f.blockers.length === 0));
    T.check('no field is marked blocked', await page.evaluate(
      () => document.querySelectorAll('#reviewWrap .review-field-blocked').length === 0));
    T.check('the verdict says ready', t.includes('Ready to list'), t);
    T.check('the title field shows the draft title',
      ((fields[0] || {}).value || '').length > 0 && ((fields[0] || {}).value || '') !== '(untitled draft)', ((fields[0] || {}).value || ''));
    T.check('the price field shows a formatted price', /^\$/.test(((fields[1] || {}).value || '')), ((fields[1] || {}).value || ''));
    T.check('the marketplace field shows the raw slot, as the list does',
      ((fields[2] || {}).value || '') === F.publishable.body.draft.slot, ((fields[2] || {}).value || ''));
    await ctx.close();
  });

  await T.section('a title blocker lands on the title field and nowhere else', async () => {
    const { ctx, page } = await boot(serveRead(F.blockedTitle));
    await openReview(page, F.ids.blockedTitle);
    const fields = await fieldsOf(page);
    const byName = Object.fromEntries(fields.map((f) => [f.field, f]));
    const wire = F.blockedTitle.body.readiness.blockers;

    T.check('the wire has exactly one blocker, on title',
      wire.length === 1 && wire[0].field === 'title', JSON.stringify(wire));
    T.check('the title field carries it', ((byName.title || {}).blockers || []).length === 1);
    T.check('the price field carries none', ((byName.price || {}).blockers || []).length === 0);
    T.check('the marketplace field carries none', ((byName.slot || {}).blockers || []).length === 0);
    T.check('no draft-level group appeared', !byName.__draft);
    T.check('only the title field is marked blocked',
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('#reviewWrap .review-field-blocked')];
        return b.length === 1 && b[0].getAttribute('data-review-field') === 'title';
      }));
    // Server copy, verbatim. The interpolated "Shorten it by N" is the reason
    // a client-side copy table cannot exist for this code.
    T.check('the blocker text is the server\'s message, verbatim',
      ((byName.title || {}).blockers || [{}])[0].text === wire[0].message,
      ((byName.title || {}).blockers || [{}])[0].text + ' vs ' + wire[0].message);
    T.check('and it carries the interpolated remainder',
      /Shorten it by \d+/.test(((byName.title || {}).blockers || [{}])[0].text), ((byName.title || {}).blockers || [{}])[0].text);
    T.check('the code is a data attribute, not visible text',
      ((byName.title || {}).blockers || [{}])[0].code === 'SLOT_TITLE_TOO_LONG'
      && !((byName.title || {}).blockers || [{}])[0].text.includes('SLOT_TITLE_TOO_LONG'));
    await ctx.close();
  });

  await T.section('a price blocker lands on the price field', async () => {
    const { ctx, page } = await boot(serveRead(F.blockedPrice));
    await openReview(page, F.ids.blockedPrice);
    const byName = Object.fromEntries((await fieldsOf(page)).map((f) => [f.field, f]));
    T.check('the price field carries it', ((byName.price || {}).blockers || []).length === 1);
    T.check('the title field carries none', ((byName.title || {}).blockers || []).length === 0);
    T.check('the price value renders as absent, not as zero',
      ((byName.price || {}).value || '') !== '$0.00', ((byName.price || {}).value || ''));
    await ctx.close();
  });

  await T.section('two blockers on two fields go to two places', async () => {
    const { ctx, page } = await boot(serveRead(F.blockedBoth));
    await openReview(page, F.ids.blockedBoth);
    const fields = await fieldsOf(page);
    const byName = Object.fromEntries(fields.map((f) => [f.field, f]));
    const wire = F.blockedBoth.body.readiness.blockers;
    const rendered = fields.reduce((n, f) => n + f.blockers.length, 0);

    T.check('the wire has two blockers on two different fields',
      wire.length === 2 && new Set(wire.map((b) => b.field)).size === 2, JSON.stringify(wire));
    T.check('exactly two blocker lines rendered in total', rendered === 2, String(rendered));
    T.check('one under title', ((byName.title || {}).blockers || []).length === 1);
    T.check('one under price', ((byName.price || {}).blockers || []).length === 1);
    T.check('two fields marked blocked, not three',
      await page.evaluate(() => document.querySelectorAll('#reviewWrap .review-field-blocked').length === 2));
    T.check('the verdict counts both', (await page.evaluate(
      () => document.getElementById('reviewWrap').innerText)).includes('2 things to fix'));
    // Every blocker on the wire appears exactly once on screen. This is the
    // assertion that keeps "nothing is dropped" honest, and it is also what
    // catches the opposite failure — the same blocker rendered under two
    // fields, which a per-field count would not notice.
    const renderedCodes = fields.flatMap((f) => f.blockers.map((b) => b.code)).sort();
    T.check('each wire blocker appears exactly once, no drops and no duplicates',
      JSON.stringify(renderedCodes) === JSON.stringify(wire.map((b) => b.code).sort()),
      JSON.stringify(renderedCodes));
    await ctx.close();
  });

  /* ─────────────────────────────────────────────────────────────────────────
     Nothing is dropped

     The two edited-envelope cases below are the only place this suite alters a
     generated fixture, and it is the same licence case 2 of the list suite
     takes: the SHAPE stays exactly what the handler emitted, and only the one
     value under test is changed. There is no way to obtain a blocker for an
     unknown field from the real handler, because every code it can raise names
     a field the screen renders — which is precisely why the fallback needs
     testing. It is the branch production cannot currently reach and the next
     new violation code will.
     ───────────────────────────────────────────────────────────────────────── */
  await T.section('a blocker for an unrendered field is still shown', async () => {
    const fx = clone(F.blockedTitle);
    fx.body.readiness.blockers[0].field = 'photos';
    const { ctx, page } = await boot(serveRead(fx));
    await openReview(page, F.ids.blockedTitle);
    const fields = await fieldsOf(page);
    const byName = Object.fromEntries(fields.map((f) => [f.field, f]));
    T.check('a draft-level group appeared', !!byName.__draft);
    T.check('it carries the orphaned blocker', ((byName.__draft || {}).blockers || []).length === 1);
    T.check('the message is intact', (((byName.__draft || {}).blockers || [])[0] || {}).text === fx.body.readiness.blockers[0].message);
    T.check('it did NOT land on the title field', ((byName.title || {}).blockers || []).length === 0);
    T.check('and it was not silently dropped',
      fields.reduce((n, f) => n + f.blockers.length, 0) === 1);
    await ctx.close();
  });

  await T.section('a blocker with no field at all is still shown', async () => {
    const fx = clone(F.blockedPrice);
    delete fx.body.readiness.blockers[0].field;
    const { ctx, page } = await boot(serveRead(fx));
    await openReview(page, F.ids.blockedPrice);
    const fields = await fieldsOf(page);
    const byName = Object.fromEntries(fields.map((f) => [f.field, f]));
    T.check('the missing-field blocker went to the draft-level group', ((byName.__draft || {}).blockers || []).length === 1);
    T.check('nothing was dropped', fields.reduce((n, f) => n + f.blockers.length, 0) === 1);
    T.check('no field group claims it', ['title', 'price', 'slot'].every((k) => (((byName[k] || {}).blockers) || []).length === 0));
    await ctx.close();
  });

  /* ─────────────────────────────────────────────────────────────────────────
     The client does not own the code→field association

     A client-side code→field table would pass every case above, because the
     fixtures use the real codes. It only diverges when the wire disagrees with
     the table — so that is what this case builds: a real code, deliberately
     sent under a DIFFERENT field than the one a table would map it to. The
     screen must follow the wire.
     ───────────────────────────────────────────────────────────────────────── */
  await T.section('the field association comes off the wire, not from a client table', async () => {
    const fx = clone(F.blockedTitle);
    // SLOT_TITLE_TOO_LONG, sent under `price`. A code→field table would put
    // this on the title field and be wrong.
    fx.body.readiness.blockers[0].field = 'price';
    const { ctx, page } = await boot(serveRead(fx));
    await openReview(page, F.ids.blockedTitle);
    const byName = Object.fromEntries((await fieldsOf(page)).map((f) => [f.field, f]));
    T.check('the blocker follows the wire onto the price field',
      ((byName.price || {}).blockers || []).length === 1
      && ((byName.price || {}).blockers || [{}])[0].code === 'SLOT_TITLE_TOO_LONG');
    T.check('the title field is empty, despite the code naming a title',
      ((byName.title || {}).blockers || []).length === 0,
      'the client is mapping code to field itself — a second implementation of a server fact');
    await ctx.close();
  });

  /* ─────────────────────────────────────────────────────────────────────────
     `validation` is not a rendering source
     ───────────────────────────────────────────────────────────────────────── */
  await T.section('validation never reaches the DOM', async () => {
    const SENTINEL = 'ZZ-VALIDATION-LEAK-8871';
    const fx = clone(F.blockedBoth);
    for (const v of fx.body.validation.violations) v.message = SENTINEL;
    for (const v of fx.body.validation.blocking) v.message = SENTINEL;
    const { ctx, page } = await boot(serveRead(fx));
    await openReview(page, F.ids.blockedBoth);
    const t = await page.evaluate(() => document.getElementById('reviewWrap').innerText);
    T.check('the validation sentinel is absent from the screen', !t.includes(SENTINEL), t.slice(0, 200));
    T.check('the readiness messages are present instead',
      fx.body.readiness.blockers.every((b) => t.includes(b.message)));
    await ctx.close();
  });

  await T.section('readiness absent means unknown, never derived from validation', async () => {
    const fx = clone(F.blockedBoth);
    delete fx.body.readiness;
    const { ctx, page } = await boot(serveRead(fx));
    await openReview(page, F.ids.blockedBoth);
    const t = await page.evaluate(() => document.getElementById('reviewWrap').innerText);
    const fields = await fieldsOf(page);
    T.check('no verdict is claimed', !t.includes('thing to fix') && !t.includes('things to fix') && !t.includes('Ready to list'), t);
    T.check('state.readiness is null', await page.evaluate(() => window._reviewState.readiness === null));
    T.check('the fields still render', fields.length === 3);
    T.check('with no blocker lines invented from validation',
      fields.reduce((n, f) => n + f.blockers.length, 0) === 0);
    await ctx.close();
  });

  // ── Step 5: the fee breakdown ────────────────────────────────────────────

  const feesOf = (page) => page.evaluate(() => {
    const box = document.querySelector('#reviewWrap .review-fees');
    if (!box) return null;
    return {
      state: box.getAttribute('data-review-fees'),
      heading: (box.querySelector('.review-fees-h') || {}).textContent || '',
      pill: (() => {
        const p = box.querySelector('[data-fee-verified]');
        return p ? { state: p.getAttribute('data-fee-verified'), text: p.textContent || '' } : null;
      })(),
      headline: (box.querySelector('[data-fee-net-headline]') || {}).textContent || null,
      note: (box.querySelector('.review-fees-note') || {}).textContent || '',
      rows: [...box.querySelectorAll('.review-fee-row')].map((r) => ({
        kind: r.getAttribute('data-fee-row'),
        label: (r.querySelector('.review-fee-label') || {}).textContent || '',
        amount: (r.querySelector('.review-fee-amount') || {}).textContent || '',
        cells: r.children.length,
      })),
    };
  });

  // '\u2212$1.23' -> -1.23. Accepts the typographic minus the fee rows use.
  const amt = (t) => {
    const neg = /^\s*[\u2212-]/.test(String(t));
    const n = parseFloat(String(t).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? (neg ? -n : n) : NaN;
  };

  await T.section('a priced draft always shows the breakdown, no toggle', async () => {
    const { ctx, page } = await boot(serveRead(F.publishable));
    await openReview(page, F.ids.publishable);
    const f = await feesOf(page);

    T.check('the breakdown rendered', f !== null);
    T.check('it is in the priced state', f && f.state === 'priced', f && f.state);
    T.check('there is a net headline', f && /^\$\d/.test(f.headline || ''), f && f.headline);
    T.check('there is exactly one gross row',
      f && f.rows.filter((r) => r.kind === 'gross').length === 1);
    T.check('there is exactly one net row',
      f && f.rows.filter((r) => r.kind === 'net').length === 1);
    T.check('there is at least one fee row',
      f && f.rows.filter((r) => r.kind === 'fee').length >= 1,
      JSON.stringify(f && f.rows.map((r) => r.kind)));
    T.check('the gross row shows the draft price',
      f && amt(f.rows.find((r) => r.kind === 'gross').amount) === Number(F.publishable.body.draft.price),
      f && f.rows.find((r) => r.kind === 'gross').amount);
    T.check('nothing needed to be clicked to see it', true);
    await ctx.close();
  });

  await T.section('the rows and the headline come from the same model', async () => {
    const { ctx, page } = await boot(serveRead(F.publishable));
    await openReview(page, F.ids.publishable);
    const f = await feesOf(page);

    const gross = amt(f.rows.find((r) => r.kind === 'gross').amount);
    const net = amt(f.rows.find((r) => r.kind === 'net').amount);
    const fees = f.rows.filter((r) => r.kind === 'fee').reduce((s2, r) => s2 + amt(r.amount), 0);

    // The rows are summed from feeEbay(); the headline is netEbayForPrice().
    // Those are two entry points into one model, and if they ever disagree the
    // model is wrong -- this assertion exists so that shows up here rather
    // than as a seller noticing the column does not add up.
    T.check('gross minus the fee rows equals the net row, to the cent',
      Math.abs((gross + fees) - net) < 0.005,
      `gross ${gross} fees ${fees} net ${net}`);
    T.check('the headline is the same number as the net row',
      Math.abs(amt(f.headline) - net) < 0.005, `${f.headline} vs ${net}`);

    // And the screen's numbers are the model's numbers, not a reimplementation.
    const direct = await page.evaluate((price) => {
      const prof = window._crSellerProfile();
      const items = window.feeEbay(price, 0, prof.ebayStore, prof.ebayPromo, prof.ebayTopRated);
      return {
        fees: items.reduce((s3, x) => s3 + x.a, 0),
        net: window.netEbayForPrice(price, { ebayStore: prof.ebayStore, ebayPromo: prof.ebayPromo, ebayTopRated: prof.ebayTopRated }),
        labels: items.map((x) => String(x.l)),
      };
    }, Number(F.publishable.body.draft.price));

    T.check('the rendered net equals feeEbay/netEbayForPrice called directly',
      Math.abs(direct.net - net) < 0.005, `${direct.net} vs ${net}`);
    T.check('the fee rows are the model\'s own line items, in its order',
      f.rows.filter((r) => r.kind === 'fee').map((r) => r.label).join('|') === direct.labels.join('|'),
      f.rows.filter((r) => r.kind === 'fee').map((r) => r.label).join('|') + ' vs ' + direct.labels.join('|'));
    await ctx.close();
  });

  await T.section('the seller profile has one reader, and the breakdown uses it', async () => {
    const { ctx, page } = await boot(serveRead(F.publishable));
    await openReview(page, F.ids.publishable);
    const before = await feesOf(page);

    // Move the profile the way a seller would, then re-render. If the screen
    // had hardcoded the documented defaults instead of reading the profile,
    // this number would not move.
    const moved = await page.evaluate(() => {
      const el = document.getElementById('ebayTopRated');
      if (!el) return false;
      el.value = 'yes';
      window._reviewPaint();
      return window._crSellerProfile().ebayTopRated === 'yes';
    });
    const after = await feesOf(page);

    T.check('the profile select moved', moved === true);
    T.check('a Top Rated seller keeps strictly more of the same price',
      amt(after.headline) > amt(before.headline),
      `${before.headline} -> ${after.headline}`);
    T.check('the gross did not move, only the fees did',
      amt(after.rows.find((r) => r.kind === 'gross').amount)
        === amt(before.rows.find((r) => r.kind === 'gross').amount));
    await ctx.close();
  });

  await T.section('the table is shaped for a provenance column and does not claim one', async () => {
    const { ctx, page } = await boot(serveRead(F.publishable));
    await openReview(page, F.ids.publishable);
    const f = await feesOf(page);

    T.check('every row has exactly two cells, label and amount',
      f.rows.every((r) => r.cells === 2), JSON.stringify(f.rows.map((r) => r.cells)));
    T.check('all rows have the same cell count, so a column can be added at once',
      new Set(f.rows.map((r) => r.cells)).size === 1);

    // No COLUMN header. A column header with nothing under it is a promise,
    // and the column it would promise is blocked on the packet wiring.
    //
    // 2026-09-07: this used to assert `querySelectorAll('th, thead').length === 0`
    // and, separately, that the strings "Source" and "Provenance" appeared
    // nowhere in the block. Both were wrong, in the same way: they asserted
    // the absence of a spelling rather than the absence of a behaviour.
    //   - Banning `th` outright also bans `th scope="row"`, which is a ROW
    //     header -- the accessible way to label a row, and not a column at all.
    //     The instruction was no column header; the assertion enforced no
    //     table semantics.
    //   - Banning the word "Source" would fail the moment the block legitimately
    //     names the fee source, which is the direction this screen is going.
    //     A word ban cannot tell a disclosure from a column.
    // What actually matters is that no header sits above a column that does not
    // exist, so that is what is asserted now.
    const header = await page.evaluate(() => {
      const box = document.querySelector('#reviewWrap .review-fees');
      return {
        thead:  box.querySelectorAll('thead').length,
        thCol:  box.querySelectorAll('th:not([scope="row"])').length,
        headerish: box.querySelectorAll('[class*="col-head"], [class*="column-header"]').length,
        text: box.innerText,
      };
    });
    T.check('no thead in the breakdown', header.thead === 0);
    T.check('no column-scoped th in the breakdown', header.thCol === 0);
    T.check('no column-header-classed element in the breakdown', header.headerish === 0);
    // The real guard the word bans were reaching for: every row is a label and
    // an amount, so there is nothing a column header could be heading.
    T.check('no row carries a third cell a header could describe',
      f.rows.every((r) => r.cells === 2));
    await ctx.close();
  });

  await T.section('the limitation is stated in the surface, not only in the code', async () => {
    const { ctx, page } = await boot(serveRead(F.publishable));
    await openReview(page, F.ids.publishable);
    const f = await feesOf(page);

    T.check('a note is present', (f.note || '').length > 0);
    T.check('the number is called an estimate, not a payout',
      /estimate/i.test(f.note) && /not a payout/i.test(f.note), f.note);
    T.check('the note names shipping as excluded', /shipping/i.test(f.note), f.note);
    T.check('the note says why shipping is excluded', /draft does not carry/i.test(f.note), f.note);
    T.check('the note names buyer sales tax as unmodelled',
      /sales tax is not modell?ed/i.test(f.note), f.note);

    // The failure this guards: a zero that reads as a fact. Shipping is not
    // modelled AND its value is unknown, so it gets no row at all.
    T.check('shipping is not rendered as a $0.00 fee row',
      !f.rows.some((r) => /ship|postage/i.test(r.label)),
      JSON.stringify(f.rows.map((r) => r.label)));

    // Tax is the opposite case and must not be collapsed into the same rule.
    // eBay charges the final value fee on a total that INCLUDES sales tax
    // (ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822), so an
    // estimate that silently omits tax is understating the fee, not merely
    // scoping it. The engine does not model tax anywhere and cannot -- the
    // rate belongs to a buyer address that does not exist yet -- so the row
    // exists to say so. A zero is a claim; a zero next to "(not modeled)" is a
    // disclosure. The qualifier is the whole point, so assert it, not the row.
    const tax = f.rows.find((r) => /sales tax/i.test(r.label));
    T.check('buyer sales tax is disclosed as a row', !!tax,
      JSON.stringify(f.rows.map((r) => r.label)));
    T.check('the tax row is qualified as not modelled',
      !!tax && /not modell?ed/i.test(tax.label), tax && tax.label);
    T.check('the tax row shows no invented amount',
      !!tax && /^\$?0\.00$/.test((tax.amount || '').replace(/[^0-9.$]/g, '')), tax && tax.amount);

    // The fee base states the scope structurally, where prose can be skimmed past.
    const base = f.rows.find((r) => /fee base/i.test(r.label));
    T.check('a fee base row is present', !!base,
      JSON.stringify(f.rows.map((r) => r.label)));
    T.check('the fee base is qualified as item-only',
      !!base && /\(item\)/i.test(base.label), base && base.label);
    await ctx.close();
  });

  await T.section('the estimate carries the fee schedule\u2019s age, from the shared source', async () => {
    // 2026-09-07. The gap this closes: the ranking surface has shown a dated
    // Verified/Stale pill since 2026-09-01, and this screen showed an
    // unqualified dollar amount. Same fee schedule, same staleness rules, one
    // surface disclosing them and one not -- so a seller who reached the
    // estimate through Sell rather than through the ranking list could not see
    // that the schedule behind it had expired.
    const { ctx, page } = await boot(serveRead(F.publishable));
    await openReview(page, F.ids.publishable);

    const fresh = await feesOf(page);
    T.check('a verification pill is present', !!fresh.pill,
      JSON.stringify(fresh.pill));
    T.check('it carries the schedule\u2019s stamped date',
      !!fresh.pill && /\b(19|20)\d{2}\b/.test(fresh.pill.text), fresh.pill && fresh.pill.text);

    // The pill must be a READING of the shared staleness rule, not a second
    // copy of the 45-day window. A single-state check cannot tell those apart:
    // a pill hardcoded to "fresh" passes every assertion above. So move the
    // upstream value and require the screen to change its mind.
    //
    // The upstream value here is the CLOCK, not the config. `PLATFORMS` is a
    // lexical `const`, so it is not reachable as `window.PLATFORMS` and
    // rewriting the stamped date would have meant adding a production global
    // that exists only for this test. `verifiedAgeDays` measures the stamp
    // against `Date.now()`, so advancing the browser clock moves the real
    // input through the real rule against the real config, and leaves the
    // bundle untouched.
    const agreedFresh = await page.evaluate(() => window.isFeeStale('ebay'));
    T.check('the shared rule and the pill agree before the clock moves',
      agreedFresh === (fresh.pill.state === 'stale'),
      `isFeeStale=${agreedFresh} pill=${fresh.pill.state}`);
    T.check('the schedule is fresh at the real clock, so staleness is the moved state',
      agreedFresh === false, `isFeeStale=${agreedFresh}`);

    // 200 days past the end of the stamped month clears the 45-day window with
    // room to spare, without depending on what today happens to be.
    await page.clock.setFixedTime(new Date(Date.now() + 200 * 86400000));
    await page.evaluate(() => window._reviewPaint());
    const stale = await feesOf(page);

    T.check('an expired schedule flips the pill to stale',
      !!stale.pill && stale.pill.state === 'stale', JSON.stringify(stale.pill));
    T.check('the stale pill says so in words, not only in colour',
      !!stale.pill && /stale/i.test(stale.pill.text), stale.pill && stale.pill.text);
    T.check('the stale pill still shows which date expired',
      !!stale.pill && stale.pill.text.includes(fresh.pill.text.replace(/^\s*Verified\s*/, '').trim()),
      stale.pill && stale.pill.text);
    T.check('the shared rule moved too, so the pill tracked it',
      (await page.evaluate(() => window.isFeeStale('ebay'))) === true);
    // Staleness qualifies the estimate; it does not delete it. A seller who
    // came here to read a number must still get the number.
    T.check('the estimate itself survives the stale state',
      /^\$\d/.test(stale.headline || ''), stale.headline);

    await ctx.close();
  });

  await T.section('the headline names itself an estimate on its face', async () => {
    // The footnote said "estimate"; the headline said "What you keep", which
    // is a payout promise. A seller who reads one line reads the big one.
    const { ctx, page } = await boot(serveRead(F.publishable));
    await openReview(page, F.ids.publishable);
    const f = await feesOf(page);

    T.check('the heading calls it an estimate', /estimat/i.test(f.heading), f.heading);
    T.check('the heading does not promise a payout',
      !/what you keep|you keep|you.ll get|take home/i.test(f.heading), f.heading);
    T.check('the heading states the basis on its face',
      /item price only/i.test(f.heading), f.heading);

    const net = f.rows.find((r) => r.kind === 'net');
    T.check('the total row is qualified too, not just the heading',
      !!net && /estimat/i.test(net.label) && /item only/i.test(net.label), net && net.label);
    await ctx.close();
  });

  await T.section('an unpriced draft still shows the table, with nothing invented', async () => {
    const { ctx, page } = await boot(serveRead(F.blockedPrice));
    await openReview(page, F.ids.blockedPrice);
    const f = await feesOf(page);

    T.check('the draft really has no price',
      F.blockedPrice.body.draft.price === null || F.blockedPrice.body.draft.price === undefined,
      JSON.stringify(F.blockedPrice.body.draft.price));
    T.check('the breakdown still rendered', f !== null);
    T.check('in the unpriced state', f && f.state === 'unpriced', f && f.state);
    T.check('the headline is a dash, not a number', f && f.headline === '\u2014', f && f.headline);
    T.check('no dollar amount appears anywhere in the breakdown',
      f && !f.rows.some((r) => /\$/.test(r.amount)), JSON.stringify(f && f.rows.map((r) => r.amount)));
    T.check('no fee rows were invented', f && f.rows.every((r) => r.kind !== 'fee'));
    T.check('it tells the seller what to do', /add a price/i.test((f && f.note) || ''), f && f.note);
    await ctx.close();
  });

} finally {
  await browser.close();
  server.close();
}

T.done();
