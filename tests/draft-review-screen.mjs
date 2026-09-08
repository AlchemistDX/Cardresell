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
 * REGISTERED as slot 30 of 31 on 2026-09-07. This comment used to say the
 * registration was deferred to D3 step 6 and that the deferral was deliberate.
 * It was, and it was also the wrong call: for five days this file was green on
 * whichever branch its author last ran it on and could not fail anyone else.
 *
 * Run: node tests/draft-review-screen.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';
import { generateReadFixtures } from './_draftListFixtures.mjs';
import { readCoreBundle } from './_assetRefs.mjs';

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
    // WAS: 'the verdict says ready', asserting t.includes('Ready to list').
    // CHANGED 2026-09-08: "Ready to list" now requires TWO things, because it
    // used to be a lie in one real case. This fixture's draft passes every
    // readiness check and has no stored listing packet, so there is nothing to
    // list WITH -- the old assertion approved a screen that told the seller to
    // go ahead while withholding the title and aspects they would need. The
    // readiness verdict itself is unchanged and still asserted, below.
    T.check('every readiness check passes',
      F.publishable.body.readiness.publishable === true
      && F.publishable.body.readiness.blockers.length === 0,
      JSON.stringify(F.publishable.body.readiness));
    T.check('yet the verdict withholds "Ready to list", because there are no listing details yet',
      !t.includes('Ready to list') && /refresh/i.test(t), t);
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
        return p ? { state: p.getAttribute('data-fee-verified'), text: p.textContent || '', cls: p.className || '' } : null;
      })(),
      headline: (box.querySelector('[data-fee-net-headline]') || {}).textContent || null,
      note: (box.querySelector('.review-fees-note') || {}).textContent || '',
      /* CHANGED 2026-09-07 (third review). Was:
             rows: [...box.querySelectorAll('.review-fee-row')].map(r => ({
               ..., cells: r.children.length }))
         reading a wrapper div with two child divs, and asserting cells === 2.
         The fee rows are now a <dl> of alternating <dt>/<dd> DIRECT children,
         so there is no per-row wrapper left to count children on. Rows are
         paired by DOM order instead, which is the property that actually
         matters for a definition list: `pairOk` below fails if the sequence
         is anything other than dt,dd,dt,dd..., which is the same guarantee
         `cells === 2` used to give, expressed against the real markup. */
      dlTag: (box.querySelector('.review-fees-table') || {}).tagName || null,
      dlChildTags: [...(box.querySelector('.review-fees-table') || { children: [] }).children].map((c) => c.tagName),
      rows: (() => {
        const dl = box.querySelector('.review-fees-table');
        if (!dl) return [];
        const kids = [...dl.children];
        const out = [];
        for (let i = 0; i + 1 < kids.length; i += 2) {
          const dt = kids[i], dd = kids[i + 1];
          out.push({
            kind: dt.getAttribute('data-fee-row'),
            label: dt.textContent || '',
            amount: dd.textContent || '',
            // A dt whose amount carries a different data-fee-row would mean the
            // grid had visually paired a label with someone else's number.
            kindMatches: dt.getAttribute('data-fee-row') === dd.getAttribute('data-fee-row'),
          });
        }
        return out;
      })(),
      pairOk: (() => {
        const dl = box.querySelector('.review-fees-table');
        if (!dl) return false;
        const tags = [...dl.children].map((c) => c.tagName);
        if (tags.length === 0 || tags.length % 2 !== 0) return false;
        return tags.every((t, i) => t === (i % 2 === 0 ? 'DT' : 'DD'));
      })(),
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

    // CHANGED 2026-09-07. This case used to move `ebayTopRated` to 'yes' and
    // assert the net went UP, i.e. that the review screen inherited a global
    // seller status into a per-listing fee discount. That inheritance is the
    // bug -- Top Rated is a seller status, the 10% discount is a Top Rated
    // Plus LISTING benefit -- so the assertion was pinning it in place. The
    // case's real claim, that the screen reads the profile rather than
    // hardcoding the documented defaults, is now proved with the store tier,
    // which genuinely is a property of the seller: no store pays 13.25%, a
    // Basic store pays 12.35%. Old assertion text: 'a Top Rated seller keeps
    // strictly more of the same price'.
    const moved = await page.evaluate(() => {
      const el = document.getElementById('ebayStore');
      if (!el) return false;
      el.value = 'basic';
      window._reviewPaint();
      return window._crSellerProfile().ebayStore === 'basic';
    });
    const after = await feesOf(page);

    T.check('the profile select moved', moved === true);
    T.check('a Basic Store seller keeps strictly more of the same price',
      amt(after.headline) > amt(before.headline),
      `${before.headline} -> ${after.headline}`);
    T.check('the gross did not move, only the fees did',
      amt(after.rows.find((r) => r.kind === 'gross').amount)
        === amt(before.rows.find((r) => r.kind === 'gross').amount));
    await ctx.close();
  });

  // 2026-09-07. The other half of the same fix, and the more important half:
  // the profile is global, the Top Rated Plus discount is per-listing, so a
  // confirmation the seller made while pricing some unrelated scan must not
  // follow them into this draft. Until a draft records its own confirmation
  // the screen shows the undiscounted fee and says so -- a fee estimated too
  // high is a disappointment, a payout estimated too high is a promise made
  // on eBay's behalf that we cannot keep.
  await T.section('a global Top Rated answer never discounts a draft', async () => {
    const { ctx, page } = await boot(serveRead(F.publishable));
    await openReview(page, F.ids.publishable);
    const before = await feesOf(page);

    /* CHANGED 2026-09-07 (third review). Was:
             const p = window._crSellerProfile();
             return { status: p.ebayTopRated, listing: p.ebayTrsListing };
       and asserted `flipped.listing === 'yes'` -- i.e. that the confirmation
       had landed in the seller profile. It had, and that was the bug: a
       per-listing answer in a persisted global store. The assertion documented
       the defect as if it were the contract.

       It now asserts the opposite: the profile must NOT carry the key at all,
       and the confirmation must be stamped and live in memory only. The
       downstream red checks are unchanged, so the discount-leak guard they
       provide is untouched by this flip. */
    const flipped = await page.evaluate(() => {
      const st = document.getElementById('ebayTopRated');
      const lg = document.getElementById('ebayTrsListing');
      if (!st || !lg) return null;
      st.value = 'yes'; lg.value = 'yes';
      // Stamp it the way the real change handler does, so this is the strongest
      // form of the leak: a genuinely valid confirmation for the ranking
      // surface's current context, which the draft must still not inherit.
      window.noteTrsListingAnswer();
      window._reviewPaint();
      const p = window._crSellerProfile();
      let persisted = null;
      try { persisted = localStorage.getItem('cr_seller_profile_v1'); } catch (e) { persisted = 'THREW'; }
      return {
        status: p.ebayTopRated,
        profileHasListingKey: ('ebayTrsListing' in p),
        confirmedNow: window.trsListingConfirmed(),
        persisted: String(persisted || ''),
      };
    });
    const after = await feesOf(page);

    T.check('the status answer took', flipped && flipped.status === 'yes', JSON.stringify(flipped));
    T.check('🔴 the seller profile carries no listing-confirmation key',
      flipped && flipped.profileHasListingKey === false,
      'a per-listing answer in the seller profile is the defect itself');
    T.check('the confirmation is genuinely live, so this is the real leak case',
      flipped && flipped.confirmedNow === true, JSON.stringify(flipped));
    T.check('🔴 the confirmation never reaches localStorage',
      flipped && !/ebayTrsListing/.test(flipped.persisted),
      `persisted profile was ${flipped && flipped.persisted}`);
    T.check('🔴 the draft net did not move',
      amt(after.headline) === amt(before.headline),
      `${before.headline} -> ${after.headline} — a global answer leaked into a per-listing benefit`);
    /* CHANGED 2026-09-07 (D3 closeout, after T2.14). Was:

           T.check('🔴 no fee row claims the discount',
             !after.rows.some((r) => /Top Rated/.test(r.label || '')),
             after.rows.map((r) => r.label).join(' | '));

       That assertion required NO fee row to mention Top Rated at all, because
       at the time the withheld discount existed only as prose beneath the
       total. T2.14 added a real row for it, so the old form went red on a
       change that improved the thing it was guarding -- the classic case of an
       assertion having encoded the implementation rather than the behaviour.

       The BEHAVIOUR being guarded is unchanged and still the point of this
       whole block: a global "I am Top Rated" answer must not turn into a
       discount on this draft. What changed is what satisfies it. A row naming
       the discount is now correct; a row carrying an AMOUNT for it is the
       leak. So the assertion is split -- the row must exist, and it must carry
       the stated non-value rather than any figure. Deleting the check would
       have removed the leak guard entirely, which is why it was sharpened
       instead. */
    const trsRows = after.rows.filter((r) => /Top Rated/.test(r.label || ''));
    T.check('the withheld discount has exactly one fee row',
      trsRows.length === 1,
      `${trsRows.length} rows mention Top Rated: ` +
      after.rows.map((r) => r.label).join(' | '));
    T.check('🔴 that row claims no amount — the global answer did not become a discount',
      trsRows.length === 1 && trsRows[0].amount.trim() === '\u2014',
      `withheld row amount is ${JSON.stringify(trsRows[0] && trsRows[0].amount)} — ` +
      `anything numeric here means a per-listing benefit was granted on a ` +
      `global answer, and "$0.00" would claim it was computed and came to nothing`);
    T.check('🔴 that row is typed as withheld, not as a fee',
      trsRows.length === 1 && trsRows[0].kind === 'withheld' && trsRows[0].kindMatches,
      `kind=${trsRows[0] && trsRows[0].kind} kindMatches=${trsRows[0] && trsRows[0].kindMatches}`);
    T.check('the screen says the discount is withheld, and which way that errs',
      await page.evaluate(() => {
        const el = document.querySelector('[data-fee-trs="withheld"]');
        return el ? el.textContent.trim() : '';
      /* CHANGED 2026-09-07: previously required the note to name
         "same- or 1-business-day handling" as the missing condition. The
         confirmation now covers the whole benefit, so the note names all three
         conditions and the assertion checks each of them -- a note that
         mentioned only handling would now be understating what a draft lacks.

         CHANGED AGAIN 2026-09-07 (same day, second pass): the second condition
         was asserted as /US ship-from/ and is now /resident in the US/. This
         assertion did its job -- it went red the moment the copy was corrected,
         which is what a disclosure-parity check is for. But it had been pinning
         a WRONG predicate. eBay's condition is that the seller is resident in
         the country they are Top Rated in; ship-from is a property of the
         parcel, not the seller. Item location appears in the policy only as the
         basis for the free-returns condition, which is waived for Trading
         Cards. So the old regex was faithfully protecting an error, and a green
         run here was evidence of consistency rather than correctness.
         (https://www.ebay.com/help/policies/selling-policies/seller-standards-policy?id=4347)

         The lesson is narrow and worth keeping: a parity assertion proves two
         surfaces agree. It cannot prove they are right, and it will defend a
         shared mistake as energetically as a shared truth. */
      }).then((t) => /Top Rated Plus/.test(t) && /same- or 1-business-day handling/.test(t)
                     && /resident in the US/.test(t) && /local-pickup only/.test(t)
                     && /may be lower/.test(t)),
      'silence about a withheld discount reads as a fee that is simply high');
    await ctx.close();
  });

  /* RENAMED AND REPREMISED 2026-09-07 (third review).
     Was: 'the table is shaped for a provenance column and does not claim one'.
     Its first two assertions were `cells === 2` on every row and "all rows have
     the same cell count, so a column can be added at once" -- both written to
     hold a THIRD fee-row column open for D4 price provenance.

     That plan is withdrawn. Price provenance describes the asking price, not
     the fee schedule, so it belongs beside the Price field; fee provenance
     applies to the schedule as a whole and is already the dated audit pill.
     A third column would have put a price-shaped fact in a fee-shaped slot.

     Instance 16 in audit/PATTERN_ASSERTION_SURFACE.md is exactly this: an
     assertion can pin a design in place. Those two checks came from the plan,
     not from a source, and had they survived they would have argued against
     the <dl> conversion on the grounds that a dl has no cells to count.

     What survives is the part that was never about the column: no header sits
     above a column that does not exist. What is added is the definition-list
     structure the review chose. */
  await T.section('the fee rows are a definition list, and no column is promised', async () => {
    const { ctx, page } = await boot(serveRead(F.publishable));
    await openReview(page, F.ids.publishable);
    const f = await feesOf(page);

    T.check('the breakdown container is a <dl>', f.dlTag === 'DL', String(f.dlTag));
    T.check('its children alternate dt, dd, dt, dd with none left over',
      f.pairOk === true, JSON.stringify(f.dlChildTags));
    T.check('every label is paired with an amount carrying the same row kind',
      f.rows.length > 0 && f.rows.every((r) => r.kindMatches),
      JSON.stringify(f.rows.map((r) => [r.kind, r.kindMatches])));
    T.check('no wrapper element sits between the dl and its terms',
      f.dlChildTags.every((t) => t === 'DT' || t === 'DD'), JSON.stringify(f.dlChildTags));

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
    // The real guard the word bans were reaching for, restated for a dl: the
    // list holds nothing but terms and definitions, so there is no third
    // element a column header could be heading.
    T.check('the breakdown holds nothing but terms and definitions',
      f.dlChildTags.length > 0 && f.dlChildTags.every((t) => t === 'DT' || t === 'DD'));

    /* Announcement, not just markup. A dl can be structurally correct and still
       be announced as a flat run of text if something upstream overrides its
       role, so this reads the accessibility tree the browser actually exposes
       rather than the tags we wrote. Checks the roles are present and that the
       first term announced is the first term in the DOM -- i.e. reading order
       matches visual order. */
    /* Read through CDP rather than page.accessibility, which Playwright removed
       in 1.59 (this repo runs 1.59.0, and the first draft of this check threw
       "Cannot read properties of undefined"). Accessibility.getFullAXTree is
       the same tree the removed helper wrapped, so this is a stronger read,
       not a weaker substitute: it returns Chromium's computed roles for the
       whole document and the pairing is filtered out of it by name. */
    const cdp = await page.context().newCDPSession(page);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const roleOf = (n) => String((n.role && n.role.value) || '');
    const nameOf = (n) => String((n.name && n.name.value) || '').trim();
    const labels = f.rows.map((r) => r.label.trim());
    const terms = nodes.filter((n) => /DescriptionListTerm|term/i.test(roleOf(n)));
    const defs  = nodes.filter((n) => /DescriptionListDetail|definition/i.test(roleOf(n)));
    T.check('Chromium computes a term role for every fee row',
      terms.length === f.rows.length,
      `${terms.length} terms vs ${f.rows.length} rows — roles seen: ${[...new Set(nodes.map(roleOf))].filter((r) => /desc|term|defin|list/i.test(r)).join(',')}`);
    T.check('Chromium computes a definition role for every term',
      defs.length === terms.length, `${defs.length} definitions vs ${terms.length} terms`);
    /* Announced order matches visual order. Compares the sequence of computed
       term names against the sequence of dt text, so a dl that is structurally
       valid but announced out of order still fails. */
    T.check('the announced term order is the visual row order',
      terms.length > 0 && terms.every((n, i) => labels[i] && labels[i].startsWith(nameOf(n).slice(0, 8))),
      `${JSON.stringify(terms.map(nameOf))} vs ${JSON.stringify(labels)}`);
    /* Each amount is reachable UNDER its own definition node.
       First attempt asserted `nameOf(def).length > 0` and failed with six empty
       strings -- correctly. A `definition` role does not take its accessible
       name from its contents (unlike the term role, which does and is why the
       order check above works on names alone), so the amount is exposed as a
       descendant static-text node rather than as the definition's name. The
       assertion was measuring a property the role does not have; the markup was
       fine. Kept as a note because the failure looked exactly like broken
       markup, and the next person to touch this will hit it too.
       Walks childIds instead, which is where the text actually lives. */
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    /* LEAF names only. Collecting every name on the way down duplicated each
       amount ("$400.00 $400.00"), because a container and its static-text child
       both report the same computed name. Only the leaves carry text a screen
       reader actually reads out once. */
    const textUnder = (n, depth = 0) => {
      if (!n || depth > 4) return '';
      const kids = (n.childIds || []).map((id) => byId.get(id)).filter(Boolean);
      if (kids.length === 0) return nameOf(n);
      return kids.map((k) => textUnder(k, depth + 1)).filter(Boolean).join(' ').trim();
    };
    const defTexts = defs.map((n) => textUnder(n));
    T.check('every amount is reachable under its own definition node',
      defTexts.length > 0 && defTexts.every((t) => t.length > 0),
      JSON.stringify(defTexts));
    T.check('the announced amounts are the visual amounts, in order',
      defTexts.every((t, i) => f.rows[i] && t.replace(/\s+/g, '') === f.rows[i].amount.trim().replace(/\s+/g, '')),
      `${JSON.stringify(defTexts)} vs ${JSON.stringify(f.rows.map((r) => r.amount.trim()))}`);
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
    T.check('the note names buyer sales tax', /sales tax/i.test(f.note), f.note);

    // CHANGED 2026-09-07. These two used to read:
    //   'the note says why shipping is excluded' -> /draft does not carry/
    //   'the note names buyer sales tax as unmodelled' -> /sales tax is not modell?ed/
    // They passed against a note that said "Fees are charged on the item price
    // only". That sentence describes OUR estimate but is phrased as a fact
    // about eBay, and as a fact about eBay it is false: eBay charges on the
    // total sale including buyer-paid shipping and sales tax. The assertions
    // could not catch it because they only checked that the exclusions were
    // NAMED, not that the sentence attributed them to the right party. So the
    // replacement asserts attribution and direction of error.
    T.check('the note attributes the item-only base to this estimate, not to eBay',
      /this estimate calculates fees on the item price only/i.test(f.note), f.note);
    // USED TO ASSERT `/ebay charges .*total sale/i`. Reworded 2026-09-08 to
    // "calculates ... from the total sale" when the sentence was split; the
    // claim under test -- eBay's base is broader than ours -- is unchanged.
    T.check('the note states eBay\u2019s base is broader',
      /ebay calculates .*from the total sale/i.test(f.note), f.note);
    /* USED TO ASSERT `/may be lower/i` under the name "the note states the
       direction of the error". WITHDRAWN 2026-09-08 (second review): the note
       names TWO omissions, buyer-paid sales tax and buyer-paid shipping, and
       they do not share a direction -- a buyer's shipping payment and the
       seller's postage cost move proceeds opposite ways. Asserting one
       direction was asserting something the sentence cannot support, so the
       assertion is replaced rather than re-pointed: the note must name both
       omissions and must NOT commit to a direction. */
    T.check('the note names both omissions and claims no single direction',
      /buyer-paid shipping/i.test(f.note)
      && /sales tax/i.test(f.note)
      && /proceeds may differ/i.test(f.note)
      && !/may be lower/i.test(f.note), f.note);
    T.check('the note does not assert the item-only base as eBay\u2019s rule',
      !/^(?!.*this estimate).*fees are charged on the item price only/i.test(f.note), f.note);

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
    // exists to say so.
    //
    // CHANGED 2026-09-07. 'the tax row shows no invented amount' used to
    // require /^\$?0\.00$/ -- it REQUIRED the invented amount it was named
    // after. The reasoning it recorded was "a zero is a claim; a zero next to
    // (not modeled) is a disclosure", and that reasoning is wrong: the tax we
    // are not modelling is an unknown POSITIVE amount, so a zero is a claim the
    // parenthetical does not retract. A reader reconciling gross minus fees
    // reads a zero as a line that was counted and found empty. An em dash says
    // the amount is not known, which is what is true, and keeps the
    // informational row out of the arithmetic.
    const tax = f.rows.find((r) => /sales tax/i.test(r.label));
    T.check('buyer sales tax is disclosed as a row', !!tax,
      JSON.stringify(f.rows.map((r) => r.label)));
    T.check('the tax row is qualified as not estimated',
      !!tax && /not estimated/i.test(tax.label), tax && tax.label);
    T.check('the tax row shows no amount at all, not a zero',
      !!tax && !/\d/.test(tax.amount || '') && /\u2014|-{2,}|n\/a/i.test(tax.amount || ''),
      tax && JSON.stringify(tax.amount));
    T.check('no row anywhere in the breakdown prints a zero amount',
      !f.rows.some((r) => /^[\u2212-]?\$?0(\.00)?$/.test((r.amount || '').trim())),
      JSON.stringify(f.rows.map((r) => [r.label, r.amount])));

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

    // CHANGED 2026-09-07: was 'the pill reads Verified <date>'. An unqualified
    // "Verified" sat inches from a price the seller typed and a comp we did not
    // verify, so it was the nearest thing on screen to a claim about the price.
    // It verifies the FEE SCHEDULE and must say which noun it means.
    T.check('the pill names the fee schedule, not the price',
      !!fresh.pill && /fee schedule/i.test(fresh.pill.text), fresh.pill && fresh.pill.text);
    T.check('the pill does not claim a verified price',
      !!fresh.pill && !/verified price|price verified/i.test(fresh.pill.text),
      fresh.pill && fresh.pill.text);

    // The date must be a real day, not a month name standing in for one. A
    // month-granularity stamp was measured from the LAST day of that month,
    // which always rounded toward fresh and hid up to 29 days of age.
    T.check('the stamped date names a day, not just a month',
      !!fresh.pill && /\b[A-Z][a-z]{2}\s+\d{1,2},\s+(19|20)\d{2}\b/.test(fresh.pill.text),
      fresh.pill && fresh.pill.text);

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
    const _stampedDate = (fresh.pill.text.match(/[A-Z][a-z]{2}\s+\d{1,2},\s+(?:19|20)\d{2}/) || [''])[0];
    T.check('the stale pill still shows which date expired',
      !!stale.pill && !!_stampedDate && stale.pill.text.includes(_stampedDate),
      stale.pill && stale.pill.text);
    T.check('the shared rule moved too, so the pill tracked it',
      (await page.evaluate(() => window.isFeeStale('ebay'))) === true);
    // Staleness qualifies the estimate; it does not delete it. A seller who
    // came here to read a number must still get the number.
    T.check('the estimate itself survives the stale state',
      /^\$\d/.test(stale.headline || ''), stale.headline);

    // ---- both sides of both thresholds, through the real render path ----
    // The audit date is a real day, so an offset from it lands on a known age.
    // 45 is the stale cutoff (`> 45`) and 30 the amber cutoff (`> 30`), so the
    // interesting pairs are 45/46 and 30/31. A rule written with >= would pass
    // a one-sided test and fail here.
    /* CHANGED 2026-09-07 (D3 closeout). Was:

           const _base = Date.now();
           const atAge = async (days) => {
             await page.clock.setFixedTime(new Date(_base + (days - 6) * 86400000));

       The `- 6` was the stamp's age in days on the day this was written. It is
       a hardcoded calendar constant, so the helper silently drifted one day
       further out of true every day: by 2026-09-07 the 2026-09-01 stamp was 7
       days old, every case landed one day late, and the suite reported the
       `30 -> not amber` and `45 -> not stale` cases as failures. Both
       "failures" were the harness, not the rule -- `isFeeStale` is `> 45` and
       `isFeeAmber` is `> 30` exactly as documented, and at a true age of 30 and
       45 they are correctly quiet.

       This is the failure mode the block's own comment warned about one screen
       up -- it moves the CLOCK because the config is not reachable -- and then
       measured the moved clock against a constant instead of against the
       config. The age now comes from the app's own `verifiedAgeDays`, so the
       offset is derived from whatever the stamp actually says. Changing the
       stamp or waiting a day no longer moves the boundaries under the test.

       Kept as a boundary pair rather than pinned to absolute dates: the point
       is that 30/31 and 45/46 straddle a `>` and would both pass under `>=`. */
    const _base = Date.now();
    /* Restore the real instant before measuring. The stale-flip block above
       left a fixed clock 200 days in the future, so measuring here without
       resetting reports ~207 and every offset below lands before the stamp,
       where the age is Infinity and the boundary cases assert nothing. That
       mistake was made once while writing this and caught by the two cases
       failing in OPPOSITE directions -- a symptom that says the input moved,
       not that a threshold is off by one. */
    await page.clock.setFixedTime(new Date(_base));
    await page.evaluate(() => window._reviewPaint());
    const _realAge = await page.evaluate(() => window.verifiedAgeDays('ebay'));
    T.check('the stamp age is a finite number, so the offsets below mean something',
      Number.isFinite(_realAge) && _realAge >= 0,
      `verifiedAgeDays('ebay') = ${_realAge} — a non-finite age would make every ` +
      `boundary case below land on Infinity and assert nothing`);

    /* ---- independent date arithmetic, not borrowed from the app ----
       Added 2026-09-07 at review request. The boundary cases below take their
       offset from `verifiedAgeDays`, which is the function under test: that is
       right for threshold work (it isolates the `>` from the calendar) but it
       means an age-calculation error would move the offsets and the thresholds
       together and cancel out. So the calendar is checked ONCE here, against
       absolute browser time and an explicit audit date, with the expected
       number computed in the test.

       The rule being pinned is `Math.floor((Date.now() - Date.UTC(y,m,d)) /
       86400000)` -- UTC-elapsed, floored, anchored at UTC midnight of the
       stamp. Consequence worth stating because it surprised this harness once:
       for a `2026-09-01` stamp the answer is 6 at 10:00 EDT on 2026-09-07 and
       7 at 22:00 EDT the SAME evening, because 22:00 EDT is already
       2026-09-08T02:00Z. "Six calendar days" and "age 7" are both correct
       readings of that instant. A local-calendar difference would report 6 all
       day; this function does not, by design -- floor on UTC elapsed never
       reports an audit as fresher than it is, wherever the reader sits. */
    const _fixture = [
      ['2026-09-01', '2026-09-07T14:00:00Z', 6],   // 10:00 EDT -> 6d 14h
      ['2026-09-01', '2026-09-08T02:06:00Z', 7],   // 22:06 EDT same evening -> 7d 2h
      ['2026-09-01', '2026-09-01T00:00:00Z', 0],   // the instant of the audit
      ['2026-09-01', '2026-09-01T23:59:59Z', 0],   // same UTC day, not yet a day old
      ['2026-09-01', '2026-09-02T00:00:00Z', 1],   // exactly one day
      ['2026-03-01', '2026-03-31T12:00:00Z', 30],  // across a month end
      ['2026-02-27', '2026-03-01T00:00:00Z', 2],   // non-leap February
    ];
    for (const [stamp, at, want] of _fixture) {
      const m = stamp.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const anchorMs = Date.UTC(+m[1], +m[2] - 1, +m[3]);
      const got = Math.floor((Date.parse(at) - anchorMs) / 86400000);
      T.check(`age arithmetic: ${stamp} read at ${at} is ${want} days`,
        got === want, `got ${got}`);
    }
    /* The same rule through the REAL reader and the REAL config stamp, so the
       fixture above is not merely checking a re-implementation of itself. */
    {
      /* The stamp is read from the bundle the document loads, not from a
         `window.PLATFORMS` global -- `PLATFORMS` is module-scoped and exposing
         it would be a test-only production global, which is forbidden. Same
         regex shape `accuracy-fee-parity.mjs` uses on the same config. */
      const _src = readCoreBundle().source;
      const _m = _src.match(/\n\s*ebay:\s*\{[\s\S]*?feeAuditedOn:\s*'([^']*)'/);
      const stamp = _m && _m[1];
      T.check('the ebay stamp is a plain ISO date, so the arithmetic is defined',
        /^\d{4}-\d{2}-\d{2}$/.test(stamp || ''), `feeAuditedOn = ${JSON.stringify(stamp)}`);
      const sm = String(stamp).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const anchorMs = Date.UTC(+sm[1], +sm[2] - 1, +sm[3]);
      for (const at of ['2026-09-07T14:00:00Z', '2026-09-08T02:06:00Z', '2026-10-17T00:00:00Z']) {
        const want = Math.floor((Date.parse(at) - anchorMs) / 86400000);
        await page.clock.setFixedTime(new Date(Date.parse(at)));
        const got = await page.evaluate(() => window.verifiedAgeDays('ebay'));
        T.check(`verifiedAgeDays('ebay') at ${at} is ${want}`,
          got === want, `got ${got} from stamp ${stamp}`);
      }
      await page.clock.setFixedTime(new Date(_base));
      await page.evaluate(() => window._reviewPaint());
    }

    const atAge = async (days) => {
      await page.clock.setFixedTime(new Date(_base + (days - _realAge) * 86400000));
      await page.evaluate(() => window._reviewPaint());
      return await feesOf(page);
    };
    for (const [days, wantStale, wantAmber] of [[30, false, false], [31, false, true], [45, false, true], [46, true, true]]) {
      const p = await atAge(days);
      T.check(`at ${days} days the schedule is ${wantStale ? 'stale' : 'not stale'}`,
        !!p.pill && (p.pill.state === 'stale') === wantStale,
        `${days}d -> ${JSON.stringify(p.pill)}`);
      T.check(`at ${days} days the pill is ${wantAmber ? 'flagged' : 'unflagged'}`,
        !!p.pill && /\bstale\b/.test(p.pill.cls || '') === wantAmber,
        `${days}d -> cls=${p.pill && p.pill.cls}`);
    }

    // ---- a future audit date has not happened, so it cannot be fresh ----
    // Winding the clock back before the recorded audit makes that recorded date
    // a future one, without touching the config. The old rule clamped a future
    // age to 0 and reported FRESH, so `Sep 2099` bought permanent verification.
    await page.clock.setFixedTime(new Date(_base - 400 * 86400000));
    await page.evaluate(() => window._reviewPaint());
    const future = await feesOf(page);
    T.check('an audit date in the future does not read as verified',
      !!future.pill && future.pill.state !== 'fresh', JSON.stringify(future.pill));
    T.check('an audit date in the future is not presented as a date at all',
      !!future.pill && !/\b(19|20)\d{2}\b/.test(future.pill.text), future.pill && future.pill.text);
    T.check('an unusable audit date says so in words',
      !!future.pill && /not verified/i.test(future.pill.text), future.pill && future.pill.text);
    T.check('the estimate still survives an unusable audit date',
      /^\$\d/.test(future.headline || ''), future.headline);

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

  /* ── The seller-visible packet workflow, end to end ─────────────────────
   *
   * create -> reload -> review -> edit -> rebuild -> reload, in a real browser,
   * asserting the values that are actually ON SCREEN and actually ON THE
   * CLIPBOARD. Asserting the state object instead would prove the client
   * absorbed the envelope, which is not the claim: the claim is that a seller
   * reading this screen sees the right listing details and copies the right
   * bytes.
   *
   * "Reload" here means a fresh page load with a fresh context -- no state
   * carried in memory, which is exactly the condition under which the packet
   * has to come back off the record rather than out of a variable.
   */
  await T.section('a packet reaches the seller, and survives a reload', async () => {
    const { ctx, page } = await boot(serveRead(F.packetCurrent));
    await openReview(page, F.ids.packetCurrent);

    const rows = await page.evaluate(() => (
      [...document.querySelectorAll('[data-review-packet="usable"] [data-packet-field]')].map((el) => ({
        key: el.getAttribute('data-packet-field'),
        label: (el.querySelector('.review-field-label') || {}).innerText || '',
        value: (el.querySelector('.review-field-value') || {}).innerText || '',
      }))
    ));
    const expectTitle = F.packetCurrent.body.packet.title.text;
    const titleRow = rows.find((r) => r.key === 'title');

    T.check('the listing title is on screen', !!titleRow, JSON.stringify(rows.map((r) => r.key)));
    T.check('and it is the packet\u2019s title, character for character',
      titleRow && titleRow.value === expectTitle,
      `${titleRow && titleRow.value} !== ${expectTitle}`);
    T.check('the category the packet chose is shown',
      rows.some((r) => r.key === 'category' && r.value === F.packetCurrent.body.packet.category.label));
    T.check('and the required aspects are shown as required',
      await page.evaluate(() => document.querySelectorAll('[data-packet-required]').length) > 0);

    // THE QUALIFICATION. The fee revision behind these details is the client's
    // own declaration and the screen has to say so -- a number shown without
    // its boundary is a claim nobody checked.
    const declared = await page.evaluate(() => {
      const el = document.querySelector('[data-packet-declared]');
      return el ? { src: el.getAttribute('data-packet-declared'), text: el.innerText } : null;
    });
    T.check('\ud83d\udd34 the client-declared fee qualification is visible', !!declared);
    T.check('and it names the source as client-declared',
      declared && declared.src === 'client-declared', declared && declared.src);
    T.check('and says in words that it is not verified',
      declared && /not verified/i.test(declared.text), declared && declared.text);
    T.check("the server's own FEE_METADATA_CLIENT_DECLARED note is rendered verbatim",
      await page.evaluate(() => !!document.querySelector('[data-packet-note="FEE_METADATA_CLIENT_DECLARED"]')));

    // The clipboard, read back. Permission is granted rather than reaching
    // past the button into a payload function: what the seller pastes is the
    // thing under test, and a production global existing only for this
    // assertion would be a test-only global.
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: page.url().replace(/\/[^/]*$/, '') });
    await page.click('[data-packet-copy="title"]');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    T.check('\ud83d\udd34 Copy title puts the packet\u2019s title on the clipboard',
      copied === expectTitle, `${JSON.stringify(copied)} !== ${JSON.stringify(expectTitle)}`);

    await page.click('[data-packet-copy="all"]');
    const copiedAll = await page.evaluate(() => navigator.clipboard.readText());
    T.check('Copy everything includes the title and the category',
      copiedAll.includes(expectTitle) && copiedAll.includes(F.packetCurrent.body.packet.category.label));

    // The quote's age, on the record the reload reads.
    T.check('the retrieval time on the wire is the original 12:00',
      F.packetCurrent.body.packet.priceBasis.retrievedAt === '2026-09-08T12:00:00.000Z',
      F.packetCurrent.body.packet.priceBasis.retrievedAt);

    T.check('and the draft reads as ready to list',
      await page.evaluate(() => {
        const v = document.querySelector('[data-review-verdict]');
        return v && v.getAttribute('data-review-verdict');
      }) === 'ready');
    await ctx.close();

    // ── RELOAD: a fresh context, nothing in memory ────────────────────────
    const two = await boot(serveRead(F.packetCurrent));
    await openReview(two.page, F.ids.packetCurrent);
    const afterReload = await two.page.evaluate(() => {
      const el = document.querySelector('[data-packet-field="title"] .review-field-value');
      return el ? el.innerText : null;
    });
    T.check('\ud83d\udd34 after a reload the same title comes back off the record',
      afterReload === expectTitle, `${afterReload} !== ${expectTitle}`);
    await two.ctx.close();
  });

  await T.section('an edit withdraws the details rather than showing stale ones', async () => {
    const { ctx, page } = await boot(serveRead(F.packetStale));
    await openReview(page, F.ids.packetStale);

    T.check('the packet block reports itself unusable',
      await page.evaluate(() => !!document.querySelector('[data-review-packet="unusable"]')));
    T.check('with the server\u2019s reason attached, not re-derived',
      await page.evaluate(() => {
        const el = document.querySelector('[data-review-packet="unusable"]');
        return el && el.getAttribute('data-packet-reason');
      }) === F.packetStale.body.packetReason,
      F.packetStale.body.packetReason);

    // THE REQUIREMENT, stated as an assertion: the content is GONE. Not
    // labelled stale above unchanged rows -- gone.
    T.check('\ud83d\udd34 no listing rows are rendered at all',
      await page.evaluate(() => document.querySelectorAll('[data-packet-field]').length) === 0);
    T.check('\ud83d\udd34 no copy buttons are rendered at all',
      await page.evaluate(() => document.querySelectorAll('[data-packet-copy]').length) === 0);

    // And the old title is nowhere in the packet block, in case some other
    // element carried it forward.
    const stalePriorTitle = F.packetCurrent.body.packet.title.text;
    T.check('\ud83d\udd34 the previous packet\u2019s title appears nowhere in the block',
      await page.evaluate((t) => {
        const el = document.querySelector('[data-review-packet]');
        return !el || !el.innerText.includes(t);
      }, stalePriorTitle));

    T.check('the seller is told what to do about it',
      /refresh/i.test(await page.evaluate(() => {
        const el = document.querySelector('[data-review-packet="unusable"]');
        return el ? el.innerText : '';
      })));
    T.check('a refresh control is offered',
      await page.evaluate(() => !!document.querySelector('[data-packet-refresh]')));

    // The combination rule: the DRAFT is valid, the DETAILS are not, and the
    // verdict must not say "Ready to list" beside details we refused to show.
    T.check('the draft itself is publishable',
      F.packetStale.body.readiness && F.packetStale.body.readiness.publishable === true,
      JSON.stringify(F.packetStale.body.readiness && F.packetStale.body.readiness.publishable));
    T.check('\ud83d\udd34 yet the verdict says the details need a refresh, not "Ready to list"',
      await page.evaluate(() => {
        const v = document.querySelector('[data-review-verdict]');
        return v && v.getAttribute('data-review-verdict');
      }) === 'details-stale');
    await ctx.close();
  });

  await T.section('a rebuild restores the details and does not age the quote', async () => {
    // The plan drives the whole sequence off one page: stale read, then a
    // PATCH, then the re-read the client performs itself.
    let patched = null;
    const plan = (params, n) => {
      if (params.get('__method') === 'PATCH') return null; // not used; see below
      return n === 0
        ? { status: 200, body: F.packetStale.body }
        : { status: 200, body: F.packetCurrent.body };
    };
    void plan;

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('  [pageerror] ' + e.message); });
    let gets = 0;
    await page.route('**/api/drafts*', async (route) => {
      const req = route.request();
      if (req.method() === 'PATCH') {
        patched = JSON.parse(req.postData() || '{}');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ draft: F.packetCurrent.body.draft, packetRebuilt: true }) });
        return;
      }
      gets += 1;
      const body = gets === 1 ? F.packetStale.body : F.packetCurrent.body;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.renderReviewView === 'function', { timeout: 15000 });
    await page.evaluate(() => { window._crIdToken = async () => 'test-id-token'; });

    await openReview(page, F.ids.packetStale);
    T.check('setup: the screen starts in the unusable state',
      await page.evaluate(() => !!document.querySelector('[data-review-packet="unusable"]')));

    await page.click('[data-packet-refresh]');
    await page.waitForFunction(() => !!document.querySelector('[data-review-packet="usable"]'), { timeout: 15000 });

    T.check('the refresh sent a PATCH', !!patched, JSON.stringify(patched));
    T.check('\ud83d\udd34 carrying a pricingContext',
      patched && patched.pricingContext && Number.isInteger(patched.pricingContext.feeModelRevision),
      JSON.stringify(patched && patched.pricingContext));
    T.check('and the revision the client actually saw',
      patched && patched.expectedRev === F.packetStale.body.draft.rev,
      `${patched && patched.expectedRev} vs ${F.packetStale.body.draft.rev}`);
    // A refresh is not an edit. If this ever carries a title or a price, the
    // button has quietly become a writer of whatever was last rendered.
    T.check('\ud83d\udd34 and NO edit fields',
      patched && !('title' in patched) && !('price' in patched) && !('quantity' in patched),
      JSON.stringify(Object.keys(patched || {})));

    // The whole reason the rebuild carries a retrieval time: refreshing the
    // bytes is not re-reading the source.
    // WAS: 'the pricingContext reuses the ORIGINAL retrieval time, not now',
    // asserting patched.pricingContext.basisMeta.retrievedAt === 12:00.
    // CHANGED 2026-09-08 because that assertion described a design this test
    // disproved. The client cannot forward the prior retrieval time: the read
    // gate withholds a withdrawn packet's content in all three of its cases --
    // unrecorded inputs, inputs that never matched at rev 1, and inputs that
    // differ after an edit -- so the client holds nothing to forward in exactly
    // the case where a refresh happens. (This comment previously said staleness
    // only follows an edit; the first two cases disprove that.) The PATCH went out with no basisMeta at all and the
    // assertion failed. Preservation moved to the server, which always has the
    // record. The client's obligation is now the NEGATIVE one below -- send no
    // basis it cannot vouch for -- and the preservation itself is asserted
    // through the real handler in tests/draft-crud-e2e.mjs.
    T.check('\ud83d\udd34 the refresh sends no price basis it cannot vouch for',
      patched && (!patched.pricingContext.basisMeta
        || !patched.pricingContext.basisMeta.retrievedAt),
      `${JSON.stringify(patched && patched.pricingContext.basisMeta)} — a retrieval time invented by the client would age the quote wrongly in the one direction nobody notices`);

    T.check('after the rebuild the client RE-READ rather than trusting the PATCH',
      gets === 2, `GETs=${gets}`);
    const restored = await page.evaluate(() => {
      const el = document.querySelector('[data-packet-field="title"] .review-field-value');
      return el ? el.innerText : null;
    });
    T.check('and the listing details are back on screen',
      restored === F.packetCurrent.body.packet.title.text, restored);
    T.check('with the copy buttons back',
      await page.evaluate(() => document.querySelectorAll('[data-packet-copy]').length) === 3);
    await ctx.close();
  });

  await T.section('a refused rebuild says something the seller can act on', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('  [pageerror] ' + e.message); });
    await page.route('**/api/drafts*', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 409, contentType: 'application/json',
          body: JSON.stringify({
            error: 'This draft was created before listing details were stored, so it cannot be refreshed.',
            code: 'PACKET_REBUILD_NO_CARD_ROW', retryable: false,
            hint: 'Scan the card again and start a new listing. The existing draft is unaffected and can still be edited.',
          }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(F.packetAbsent.body) });
    });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.renderReviewView === 'function', { timeout: 15000 });
    await page.evaluate(() => { window._crIdToken = async () => 'test-id-token'; });
    await openReview(page, F.ids.packetAbsent);

    T.check('a draft with no packet says so, rather than saying the details are stale',
      await page.evaluate(() => {
        const el = document.querySelector('[data-review-packet]');
        return el && el.getAttribute('data-review-packet');
      }) === 'absent');

    await page.click('[data-packet-refresh]');
    await page.waitForFunction(() => !!document.querySelector('[data-packet-refresh-error]'), { timeout: 15000 });
    const err = await page.evaluate(() => {
      const el = document.querySelector('[data-packet-refresh-error]');
      return { code: el.getAttribute('data-packet-refresh-error'), text: el.innerText };
    });
    T.check('\ud83d\udd34 the refusal is reported under its own code',
      err.code === 'PACKET_REBUILD_NO_CARD_ROW', err.code);
    T.check('\ud83d\udd34 and tells the seller to scan the card again',
      /scan the card again/i.test(err.text), err.text);
    T.check('and says the existing draft is unharmed',
      /unaffected|still be edited/i.test(err.text), err.text);
    T.check('the draft is still fully rendered beneath it',
      await page.evaluate(() => document.querySelectorAll('#reviewWrap .review-field[data-review-field]').length) > 0);
    await ctx.close();
  });

  await T.section('loading another draft leaves nothing of the first behind', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('  [pageerror] ' + e.message); });
    let n = 0;
    await page.route('**/api/drafts*', async (route) => {
      const body = n++ === 0 ? F.packetCurrent.body : F.packetAbsent.body;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.renderReviewView === 'function', { timeout: 15000 });
    await page.evaluate(() => { window._crIdToken = async () => 'test-id-token'; });

    await openReview(page, F.ids.packetCurrent);
    const first = F.packetCurrent.body.packet.title.text;
    T.check('setup: the first draft\u2019s details are on screen',
      await page.evaluate(() => !!document.querySelector('[data-packet-copy]')));

    await openReview(page, F.ids.packetAbsent);
    T.check('\ud83d\udd34 the second draft shows none of the first\u2019s listing content',
      await page.evaluate((t) => !document.getElementById('reviewWrap').innerText.includes(t), first));
    T.check('\ud83d\udd34 and the first draft\u2019s copy buttons are gone',
      await page.evaluate(() => document.querySelectorAll('[data-packet-copy]').length) === 0);
    await ctx.close();
  });

  /* ── D5: the eBay continuation control ─────────────────────────────────
   *
   * What these assertions can and cannot hold, stated once so no later reader
   * mistakes their scope. They assert the URL WE BUILD and the gate we build it
   * behind. They do NOT assert that eBay honours it: no suite here can reach
   * eBay, and the previous sell link died without a single test going red
   * precisely because a URL can stay well-formed long after it stops working.
   * The browser evidence for the endpoint is in audit/d5/D5_ENTRY_GATE.md, and
   * it will rot the same way; when the control breaks it will break there,
   * silently, and someone will have to go look.
   *
   * The one behaviour these DO establish end to end is the negative one that
   * matters most for a Phase 1 with no publish path: clicking the control hands
   * the seller to eBay and sends nothing to CardResell.
   */
  await T.section('the continuation control hands the seller to eBay and nothing else', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('  [pageerror] ' + e.message); });
    // Nothing leaves the machine: the popup's navigation is aborted, so the
    // assertion reads the URL the click requested rather than eBay's response.
    const ebayAsked = [];
    await ctx.route('**://*.ebay.com/**', (r) => { ebayAsked.push(r.request().url()); r.abort(); });
    const apiCalls = [];
    await page.route('**/api/**', async (route) => {
      const u = new URL(route.request().url());
      apiCalls.push(route.request().method() + ' ' + u.pathname);
      if (/\/api\/drafts/.test(u.pathname)) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(F.packetCurrent.body) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.renderReviewView === 'function', { timeout: 15000 });
    await page.evaluate(() => { window._crIdToken = async () => 'test-id-token'; });
    await openReview(page, F.ids.packetCurrent);

    const pkt = F.packetCurrent.body.packet;
    const opt = (pkt.aspects && pkt.aspects.optional) || {};
    const one = (k) => { const v = opt[k]; const x = Array.isArray(v) ? v[0] : v; return String(x == null ? '' : x).trim(); };
    const expectSeed = [one('Card Name'), one('Card Number'), one('Set')].filter(Boolean).join(' ');

    const link = await page.evaluate(() => {
      const a = document.querySelector('[data-sell-start="ebay"]');
      if (!a) return null;
      return { tag: a.tagName, href: a.getAttribute('href'), target: a.getAttribute('target'),
               rel: a.getAttribute('rel'), text: a.innerText };
    });
    T.check('the control renders as a link, not a submit',
      link && link.tag === 'A', JSON.stringify(link));
    const u = link ? new URL(link.href) : null;
    T.check('\ud83d\udd34 it points at eBay\u2019s prelist match step',
      !!u && u.host === 'www.ebay.com' && u.pathname === '/sl/prelist/identify',
      u && (u.host + u.pathname));
    T.check('\ud83d\udd34 the seed it carries is the card, built from the packet\u2019s own aspects',
      !!u && u.searchParams.get('title') === expectSeed,
      `${u && u.searchParams.get('title')} vs ${expectSeed}`);
    T.check('and the category is the packet\u2019s, not a hardcoded one',
      !!u && u.searchParams.get('caty') === String(pkt.category.id),
      `${u && u.searchParams.get('caty')} vs ${pkt.category.id}`);
    // EPN pays on a buyer's qualifying purchase. A seller opening a listing
    // form is not one, so tracking it as if it were would be an unverified
    // revenue claim attached to the account that does earn.
    T.check('\ud83d\udd34 it carries no affiliate tracking, unlike every buy-side link',
      !!u && !['campid', 'mkcid', 'mkevt', 'mkrid', 'toolid', 'customid', 'siteid'].some((k) => u.searchParams.has(k)),
      link && link.href);
    T.check('it opens in a new tab without handing eBay our window',
      link && link.target === '_blank' && /noopener/.test(link.rel || ''), JSON.stringify(link));

    // The seed is on screen, not only in the href. eBay answered one probe for
    // card 232/165 with a product-library match on 205/165 -- their catalogue
    // and ours disagree and their matcher answers anyway, so a seller who can
    // read the query they are being sent with can catch it on arrival.
    const seedShown = await page.evaluate(() => {
      const el = document.querySelector('[data-sell-start-seed]');
      return el ? el.innerText : null;
    });
    T.check('\ud83d\udd34 the seed is shown to the seller, not just hyperlinked',
      !!seedShown && seedShown.includes(expectSeed), seedShown);
    T.check('and the copy promises the flow opens, never that eBay will match',
      !!seedShown && /opens/i.test(seedShown) && !/(prefill|pre-fill|fills in|filled in|we.ll list)/i.test(seedShown),
      seedShown);
    T.check('and it says nothing is published until the seller does it there',
      !!seedShown && /nothing is listed or published/i.test(seedShown), seedShown);

    const before = apiCalls.length;
    const [popup] = await Promise.all([
      ctx.waitForEvent('page'),
      page.click('[data-sell-start="ebay"]'),
    ]);
    await page.waitForTimeout(400);
    // Read the URL the click ASKED FOR, off the aborted route, not popup.url():
    // the abort leaves the popup sitting on chrome-error://chromewebdata, which
    // is what the first version of this assertion read and failed on. Asserting
    // the request is also the stronger claim -- it holds even if eBay answers
    // with a redirect, which is exactly how the previous sell link died.
    T.check('\ud83d\udd34 clicking it requests eBay\u2019s prelist step in a new tab',
      ebayAsked.some((h) => /^https:\/\/www\.ebay\.com\/sl\/prelist\/identify\?/.test(h))
        && popup !== page,
      ebayAsked.join(', ') || '(no eBay request)');
    // Scoped to the DRAFT, deliberately. An earlier version asserted zero calls
    // to /api/* after the click and failed on GET /api/stats, POST /api/events
    // and GET /api/tpl-proxy -- page-level traffic on its own timers that has
    // nothing to do with this control. Asserting silence we do not have would
    // have meant weakening the assertion later under pressure; the claim worth
    // holding is narrower and true: the continuation touches no draft state and
    // asks no endpoint to publish anything.
    const afterClick = apiCalls.slice(before);
    T.check('\ud83d\udd34 and it writes nothing \u2014 no draft call, no publish call, no write of any kind',
      !afterClick.some((c) => /\/api\/drafts/.test(c))
        && !afterClick.some((c) => /publish|list|offer|inventory/i.test(c))
        && !afterClick.some((c) => /^(POST|PUT|PATCH|DELETE)/.test(c) && !/\/api\/events/.test(c)),
      afterClick.join(', ') || '(nothing)');
    await popup.close();
    await ctx.close();
  });

  await T.section('the continuation is gated exactly like the copy row', async () => {
    // Same gate, read from the same two predicates. A continuation that
    // survived into a state where `Copy title` is refused would walk the seller
    // into eBay carrying the very thing the finding names -- so these assert the
    // two controls appear and disappear TOGETHER rather than asserting the
    // continuation's own absence, which would pass even if the gates drifted
    // apart in the other direction.
    for (const [name, fx, id] of [
      ['a withdrawn packet', F.packetStale, F.ids.packetStale],
      ['a packet with a blocking finding', F.packetBlocked, F.ids.packetBlocked],
      ['a draft with no packet', F.packetAbsent, F.ids.packetAbsent],
    ]) {
      const { ctx, page } = await boot(serveRead(fx));
      await openReview(page, id);
      const counts = await page.evaluate(() => ({
        copy: document.querySelectorAll('[data-packet-copy]').length,
        sell: document.querySelectorAll('[data-sell-start]').length,
      }));
      T.check(`\ud83d\udd34 ${name}: copy withheld and the continuation withheld with it`,
        counts.copy === 0 && counts.sell === 0, JSON.stringify(counts));
      await ctx.close();
    }
    const { ctx, page } = await boot(serveRead(F.packetCurrent));
    await openReview(page, F.ids.packetCurrent);
    const counts = await page.evaluate(() => ({
      copy: document.querySelectorAll('[data-packet-copy]').length,
      sell: document.querySelectorAll('[data-sell-start]').length,
    }));
    T.check('and a usable packet has both \u2014 the gate is shared, not merely absent',
      counts.copy === 3 && counts.sell === 1, JSON.stringify(counts));
    await ctx.close();
  });

  await T.section('a packet that cannot name the card says so instead of linking', async () => {
    /* The one envelope here that is MODIFIED rather than generated, and the
     * reason: the real producer derives Card Name / Card Number / Set from the
     * stored card row, so it cannot emit a usable packet with none of them.
     * The state is still reachable on a client -- an older stored packet, a
     * catalogue row that lost its name -- and Rule 2 says the silent omission
     * is the bug, so the branch has to be exercised from the only side that
     * can produce it. What is asserted is the CLIENT's behaviour on an empty
     * seed; nothing here claims the server can produce this shape.
     */
    const stripped = JSON.parse(JSON.stringify(F.packetCurrent.body));
    for (const k of ['Card Name', 'Card Number', 'Set']) delete stripped.packet.aspects.optional[k];
    const { ctx, page } = await boot(() => ({ status: F.packetCurrent.status, body: stripped }));
    await openReview(page, F.ids.packetCurrent);
    const st = await page.evaluate(() => ({
      link: document.querySelectorAll('[data-sell-start]').length,
      copy: document.querySelectorAll('[data-packet-copy]').length,
      note: (document.querySelector('[data-sell-start-absent]') || {}).innerText || null,
    }));
    T.check('\ud83d\udd34 no link is offered when there is nothing to search for',
      st.link === 0, JSON.stringify(st));
    T.check('\ud83d\udd34 and the seller is told why, rather than the control vanishing',
      !!st.note && /eBay/i.test(st.note), st.note);
    T.check('the rest of the packet is untouched \u2014 this withholds one control, not the screen',
      st.copy === 3, JSON.stringify(st));
    await ctx.close();
  });

  /* ── Q3: a packet can be CURRENT and still not fit to list ──────────────
   *
   * The verdict had three arms -- readiness, then usability, then ready -- and
   * neither of the first two sees a packet's own ERROR findings. Server
   * readiness does not close the gap either: `readinessOf` is
   * `validateDraftForSlot` over the stored draft fields, so this fixture comes
   * back publishable with zero blockers while its packet reports
   * MISSING_FEE_MODEL_REVISION. Before the fourth arm this rendered
   * "Ready to list".
   */
  await T.section('a packet that cannot be listed does not say Ready to list', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('  [pageerror] ' + e.message); });
    await page.route('**/api/drafts*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(F.packetBlocked.body) });
    });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.renderReviewView === 'function', { timeout: 15000 });
    await page.evaluate(() => { window._crIdToken = async () => 'test-id-token'; });
    await openReview(page, F.ids.packetBlocked);

    // The three facts the old rule had in hand, stated so a later reader can
    // see that none of them could have produced the right answer.
    T.check('setup: the server says the draft is publishable, with no blockers',
      F.packetBlocked.body.readiness.publishable === true
        && F.packetBlocked.body.readiness.blockers.length === 0,
      JSON.stringify(F.packetBlocked.body.readiness));
    T.check('setup: and the packet is CURRENT and usable',
      F.packetBlocked.body.packetStatus === 'CURRENT' && F.packetBlocked.body.packetUsable === true,
      `${F.packetBlocked.body.packetStatus} / ${F.packetBlocked.body.packetUsable}`);
    T.check('setup: while carrying a blocking finding',
      F.packetBlocked.body.packet.blocked === true
        && F.packetBlocked.body.packet.blockingCodes.includes('MISSING_FEE_MODEL_REVISION'),
      JSON.stringify(F.packetBlocked.body.packet.blockingCodes));

    const verdict = await page.evaluate(() => {
      const el = document.querySelector('[data-review-verdict]');
      return el ? { state: el.getAttribute('data-review-verdict'), text: el.innerText } : null;
    });
    T.check('\ud83d\udd34 the verdict is NOT ready',
      verdict && verdict.state !== 'ready',
      JSON.stringify(verdict));
    T.check('\ud83d\udd34 it is reported as a problem with the details, not as a stale packet',
      verdict && verdict.state === 'details-blocked', verdict && verdict.state);
    T.check('and the screen never contains the words Ready to list',
      await page.evaluate(() => !document.getElementById('reviewWrap').innerText.includes('Ready to list')));
    T.check('the count is the number of blocking findings',
      verdict && /^1 problem with the listing details$/.test(verdict.text.trim()), verdict && verdict.text);

    // The finding itself, in the seller's terms rather than the producer's.
    const finding = await page.evaluate(() => {
      const el = document.querySelector('[data-packet-blocking]');
      return el ? { code: el.getAttribute('data-packet-blocking'), text: el.innerText } : null;
    });
    T.check('\ud83d\udd34 the finding is printed under its own code',
      finding && finding.code === 'MISSING_FEE_MODEL_REVISION', JSON.stringify(finding));
    T.check('\ud83d\udd34 and it does not print the developer instruction the server sends',
      finding && !/FEE_MODEL_REVISION from core\.js/.test(finding.text)
        && !/feeModelRevision/.test(finding.text),
      finding && finding.text);
    T.check('it says what the seller can do about it',
      finding && /refresh the listing details/i.test(finding.text), finding && finding.text);

    // Copy is withheld: a blocked packet is a paste away from being listed.
    T.check('\ud83d\udd34 there are no copy buttons for a packet that cannot be listed',
      await page.evaluate(() => document.querySelectorAll('[data-packet-copy]').length) === 0);
    // The gate is in the payload builder, not in the rendering. Proven by
    // giving the handler a button anyway -- ordinary markup the delegated
    // listener already matches -- and showing that pressing it copies nothing.
    // Deliberately NOT a test-only production global: the assertion goes
    // through the same click path a seller would use.
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${port}` });
    await page.evaluate(async () => {
      await navigator.clipboard.writeText('SENTINEL-NOT-OVERWRITTEN');
      const host = document.querySelector('[data-review-packet]');
      const b = document.createElement('button');
      b.setAttribute('data-packet-copy', 'all');
      b.id = 'crInjectedCopy';
      b.textContent = 'Copy everything';
      b.style.cssText = 'display:block;width:160px;height:32px';
      host.appendChild(b);
    });
    await page.click('#crInjectedCopy');
    await page.waitForFunction(() => {
      const t = document.getElementById('csToast');
      return t && t.textContent && t.textContent.length > 0;
    }, { timeout: 15000 });
    T.check('\ud83d\udd34 pressing a copy control anyway copies nothing',
      await page.evaluate(() => navigator.clipboard.readText()) === 'SENTINEL-NOT-OVERWRITTEN');
    T.check('\ud83d\udd34 and the refusal says fix, not refresh',
      await page.evaluate(() => document.getElementById('csToast').textContent)
        === 'These listing details have a problem to fix first.',
      await page.evaluate(() => document.getElementById('csToast').textContent));
    await page.evaluate(() => { const b = document.getElementById('crInjectedCopy'); if (b) b.remove(); });
    // The fields stay: the seller has to be able to see WHICH part is wrong.
    T.check('the listing fields are still shown, so the finding can be located',
      await page.evaluate(() => document.querySelectorAll('[data-packet-field]').length) > 0);
    T.check('the block is marked as blocked without pretending to be unusable',
      await page.evaluate(() => {
        const el = document.querySelector('[data-review-packet]');
        return el && el.getAttribute('data-review-packet') === 'usable' && el.hasAttribute('data-packet-blocked');
      }));
    await ctx.close();
  });

  /* ── Q2: another card's basis cannot ride along on this card's refresh ───
   *
   * The exercise from review, run on the client: scan card B, then refresh
   * card A's saved draft. A populated global is not the question -- what
   * matters is what leaves the browser. The server refuses a client basis on
   * this route as well (tests/draft-crud-e2e.mjs), so this is the first of two
   * independent answers rather than the only one.
   */
  await T.section('a refresh cannot carry another card\u2019s price basis', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('  [pageerror] ' + e.message); });
    let patched = null;
    let gets = 0;
    await page.route('**/api/drafts*', async (route) => {
      const req = route.request();
      if (req.method() === 'PATCH') {
        patched = JSON.parse(req.postData() || '{}');
        await route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ draft: F.packetCurrent.body.draft, validation: F.packetCurrent.body.validation, packetRebuilt: true }) });
        return;
      }
      gets++;
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(gets === 1 ? F.packetStale.body : F.packetCurrent.body) });
    });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.renderReviewView === 'function', { timeout: 15000 });
    await page.evaluate(() => { window._crIdToken = async () => 'test-id-token'; });

    // Card B is scanned: the read stamps the global the pricing context is
    // ordinarily built from. This is the state the question asks about.
    const FOREIGN_URL = 'https://www.pricecharting.com/CARD-B';
    await page.evaluate((u) => {
      window._crBasis = { label: 'Card B comp', sourceUrl: u, retrievedAt: '2026-09-08T20:00:00.000Z', low: 9, mid: 10, high: 11 };
    }, FOREIGN_URL);
    T.check('setup: a foreign basis really is populated at refresh time',
      await page.evaluate(() => !!(window._crBasis && window._crBasis.sourceUrl)) === true);

    await openReview(page, F.ids.packetStale);
    await page.click('[data-packet-refresh]');
    await page.waitForFunction(() => document.querySelectorAll('[data-packet-copy]').length === 3, { timeout: 15000 });

    T.check('setup: the refresh did go out',
      patched !== null && patched.pricingContext && Number.isInteger(patched.pricingContext.feeModelRevision),
      JSON.stringify(patched && patched.pricingContext));
    T.check('\ud83d\udd34 the request carries NO price basis at all',
      patched && !patched.pricingContext.basisMeta,
      JSON.stringify(patched && patched.pricingContext.basisMeta));
    T.check('\ud83d\udd34 and card B\u2019s source is nowhere in the request body',
      JSON.stringify(patched || {}).indexOf('CARD-B') === -1,
      JSON.stringify(patched));
    T.check('the populated global did not reach the wire even though it was set',
      await page.evaluate((u) => (window._crBasis || {}).sourceUrl === u, FOREIGN_URL) === true,
      'the global is still set, so the absence above is the builder refusing it rather than nothing being there');
    await ctx.close();
  });

  /* ── Q1, client half: a refresh whose response was lost ─────────────────
   *
   * The key is `pkt-<draftId>-r<rev>` and it does not make a retry replay: the
   * route is not idempotency-keyed, the revision is the token, so the second
   * attempt sends a revision that has moved and the server answers
   * DRAFT_REVISION_CONFLICT. Nothing is duplicated, which is the safety that
   * matters, but the seller must not be told the refresh failed when it
   * happened. So the conflict re-reads, and the re-read decides.
   */
  await T.section('a refresh whose response was lost is recovered, not reported', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('  [pageerror] ' + e.message); });
    let gets = 0;
    let patches = 0;
    await page.route('**/api/drafts*', async (route) => {
      const req = route.request();
      if (req.method() === 'PATCH') {
        patches++;
        // The first attempt already landed somewhere the client never saw.
        await route.fulfill({ status: 409, contentType: 'application/json',
          body: JSON.stringify({ error: 'expectedRev does not match', code: 'DRAFT_REVISION_CONFLICT', current: F.packetCurrent.body.draft }) });
        return;
      }
      gets++;
      // First read: stale, so the button is there. After the conflict the
      // re-read shows what the lost attempt actually did.
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(gets === 1 ? F.packetStale.body : F.packetCurrent.body) });
    });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.renderReviewView === 'function', { timeout: 15000 });
    await page.evaluate(() => { window._crIdToken = async () => 'test-id-token'; });
    await openReview(page, F.ids.packetStale);

    await page.click('[data-packet-refresh]');
    // Waited DEFENSIVELY. A bare waitForFunction here throws on the very
    // regression this section exists to catch, and a case that throws stops
    // reporting on its own remaining claims -- so the timeout becomes a value
    // the assertions can read instead of an exception.
    const recovered = await page
      .waitForFunction(() => document.querySelectorAll('[data-packet-copy]').length === 3, { timeout: 15000 })
      .then(() => true).catch(() => false);

    T.check('setup: the refresh was refused as a revision conflict', patches === 1, `PATCHes=${patches}`);
    T.check('\ud83d\udd34 the seller ends up with usable listing details',
      recovered === true, 'the copy controls never came back after the conflict');
    T.check('\ud83d\udd34 the conflict triggered a re-read rather than an error message',
      gets === 2, `GETs=${gets}`);
    T.check('\ud83d\udd34 no refresh error is shown, because the refresh had happened',
      await page.evaluate(() => !document.querySelector('[data-packet-refresh-error]')));
    T.check('\ud83d\udd34 and the details the seller asked for are on screen',
      await page.evaluate(() => {
        const el = document.querySelector('[data-packet-field="title"] .review-field-value');
        return el ? el.innerText : null;
      }) === F.packetCurrent.body.packet.title.text);
    T.check('the verdict is ready, from the re-read and not from the PATCH',
      await page.evaluate(() => {
        const el = document.querySelector('[data-review-verdict]');
        return el && el.getAttribute('data-review-verdict');
      }) === 'ready');
    await ctx.close();
  });

  /* A conflict that is NOT self-healing still has to be reported, and under the
   * code the server actually sends. The client compared against the CONSTANT
   * NAME 'REV_CONFLICT' while the wire carries 'DRAFT_REVISION_CONFLICT'
   * (STORE_ERR in api/_draftStore.js), so the branch never ran and every
   * conflict fell through to "try again in a moment" -- advice that cannot
   * work, since the stale part is the revision being resent.
   */
  await T.section('a real conflict with another device is still reported', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('  [pageerror] ' + e.message); });
    await page.route('**/api/drafts*', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 409, contentType: 'application/json',
          body: JSON.stringify({ error: 'expectedRev does not match', code: 'DRAFT_REVISION_CONFLICT' }) });
        return;
      }
      // The re-read still shows no usable packet: whatever changed the
      // revision was not this refresh.
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(F.packetStale.body) });
    });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.renderReviewView === 'function', { timeout: 15000 });
    await page.evaluate(() => { window._crIdToken = async () => 'test-id-token'; });
    await openReview(page, F.ids.packetStale);

    await page.click('[data-packet-refresh]');
    await page.waitForFunction(() => !!document.querySelector('[data-packet-refresh-error]'), { timeout: 15000 });
    const err = await page.evaluate(() => {
      const el = document.querySelector('[data-packet-refresh-error]');
      return { code: el.getAttribute('data-packet-refresh-error'), text: el.innerText };
    });
    T.check('\ud83d\udd34 the conflict is reported under the code the server sends',
      err.code === 'DRAFT_REVISION_CONFLICT', err.code);
    T.check('\ud83d\udd34 and says the draft changed elsewhere, not "try again in a moment"',
      /changed somewhere else/i.test(err.text) && !/try again in a moment/i.test(err.text), err.text);
    T.check('it sends the seller to the current version',
      /reopen/i.test(err.text), err.text);
    await ctx.close();
  });

  /* ── The create path: whose basis does a NEW draft carry? ────────────────
   *
   * The PATCH route refuses a client basis outright, so a refresh cannot
   * import one. That says nothing about the POST, where a live basis is
   * legitimate and is the only place a comp can enter a packet at all. The
   * question from review: populate the browser's basis for card B, get to card
   * A without a new price read, create A's draft, and see what A's packet
   * holds.
   *
   * Both entry points are exercised through the control the seller actually
   * touches -- the panel's own button (index.html, onclick="startListingDraft()")
   * and the button hydrateCollectionSellButtons() renders into a Collection row
   * -- because the two paths differ in exactly the way that mattered here: one
   * goes through the card panel and one never touches it.
   *
   * WHAT THIS FOUND. The panel path was already clean, for a reason that is not
   * the binding: loadCardUI nulls the basis on every card load, so arriving at
   * card A discards B's read. The Collection path never loads a card, so
   * nothing cleared it, and card A's create went out carrying card B's
   * sourceUrl, low/mid/high and retrieval time. Fixed by binding the basis to
   * the card it was read for; see _crBindBasis in the bundle.
   */
  await T.section('a new draft carries only a basis read for ITS card', async () => {
    const FOREIGN = 'https://www.pricecharting.com/CARD-B';
    const CARD_A = { id: 'cra1', name: 'Card A', game: 'pokemon', set: 'Base Set', number: '4/102' };

    // One page, four situations, because the leak was ORDER-dependent: it
    // needed a read for B to survive into a create for A.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('  [pageerror] ' + e.message); });
    let posted = null;
    // Waiting on window._crLastDraftId would only work once -- it stays set
    // after the first create, so every later wait would return immediately and
    // the assertions would read the PREVIOUS body. The wait is on the request
    // this side captured, per case.
    const waitPost = async () => {
      for (let i = 0; i < 150; i++) {
        if (posted !== null) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    };
    await page.route('**/api/drafts*', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        posted = JSON.parse(req.postData() || '{}');
        await route.fulfill({ status: 201, contentType: 'application/json',
          body: JSON.stringify({ draftId: 'drf_created' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    // The Collection button is only drawn for a row the server calls eligible.
    await page.route('**/api/sell-eligibility', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ stamps: [{ eligible: true }] }) });
    });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.startListingDraft === 'function', { timeout: 15000 });
    await page.evaluate(() => { window._crIdToken = async () => 'test-id-token'; });

    // Record `_crBasis` AS the create leaves, from inside the page. The claim
    // being evidenced is "the global was populated when the body was built",
    // and the only place that instant exists is the call itself: reading the
    // global after the click races the success handler that clears it, and
    // reading it from the route handler stalls the paused request. This wraps
    // fetch in the TEST page only -- no production global, no production hook.
    await page.evaluate(() => {
      const real = window.fetch;
      window.__basisAtPost = null;
      window.fetch = function (input, init) {
        const url = String((input && input.url) || input || '');
        const method = String((init && init.method) || (input && input.method) || 'GET');
        if (method.toUpperCase() === 'POST' && /\/api\/drafts/.test(url)) {
          window.__basisAtPost = (window._crBasis || {}).sourceUrl || null;
        }
        return real.apply(this, arguments);
      };
    });

    const priceCardB = (u) => page.evaluate((url) => {
      // Deliberately NOT bound: this stands in for a read that happened while
      // card B was on screen, whose binding is to B and not to A.
      window._crBasis = { value: 10, label: 'Card B comp', sourceUrl: url, low: 9, mid: 10, high: 11,
        retrievedAt: '2026-09-08T20:00:00.000Z', cardKey: 'bbbbbbbb' };
      window._ovAutoFilled = true;
    }, u);

    // ── 1. The panel path: card B priced, then card A loaded, no new read.
    await priceCardB(FOREIGN);
    const switched = await page.evaluate((A) => {
      try { loadCardUI(A); } catch (e) { return 'threw: ' + e.message; }
      return window._crBasis === null ? 'cleared' : 'kept';
    }, CARD_A);
    T.check('loading a card discards the previous card\u2019s basis',
      switched === 'cleared', String(switched));

    posted = null;
    await page.evaluate((A) => {
      window._crSellApproved = A;                    // what applySellGate leaves behind
      const row = document.getElementById('crSellRow');
      if (row) row.style.display = '';               // the gate's own show, without the round trip
    }, CARD_A);
    await page.click('#crSellBtn');
    T.check('setup: the panel button issued a create', await waitPost() === true);
    T.check('setup: the panel button really did create a draft',
      posted !== null && posted.card && posted.card.name === 'Card A',
      JSON.stringify(posted && posted.card));
    T.check('\ud83d\udd34 the panel path sends no basis for a card it never priced',
      posted && posted.pricingContext && !posted.pricingContext.basisMeta,
      JSON.stringify(posted && posted.pricingContext));
    T.check('\ud83d\udd34 and card B is nowhere in the create body',
      JSON.stringify(posted || {}).indexOf('CARD-B') === -1, JSON.stringify(posted));

    // ── 2. The Collection path: card B priced in the panel, row A listed. This
    // is the case that leaked, and it never goes near loadCardUI.
    posted = null;
    await priceCardB(FOREIGN);
    await page.evaluate(() => {
      localStorage.setItem(getUserKey('portfolio'), JSON.stringify([
        { id: 'row_a', name: 'Card A', game: 'pokemon', set: 'Base Set', number: '4/102', currentValue: 400 },
      ]));
      // The cell renderCollectionView leaves for the hydrator to fill.
      const host = document.createElement('div');
      host.id = 'crSellCell_row_a';
      host.style.cssText = 'display:flex;padding:8px';
      document.body.appendChild(host);
    });
    await page.evaluate(() => hydrateCollectionSellButtons(loadPortData()));
    const btn = await page.evaluate(() => {
      const b = document.querySelector('#crSellCell_row_a button');
      return b ? b.textContent : null;
    });
    T.check('setup: the Collection row rendered its real List control',
      typeof btn === 'string' && /List/.test(btn), String(btn));
    T.check('setup: card B\u2019s basis is still populated at click time',
      await page.evaluate((u) => (window._crBasis || {}).sourceUrl === u, FOREIGN) === true);

    await page.click('#crSellCell_row_a button');
    T.check('setup: the Collection button issued a create', await waitPost() === true);
    T.check('setup: the Collection button created a draft for row A',
      posted !== null && posted.instanceId === 'inst_col_row_a', JSON.stringify(posted && posted.instanceId));
    T.check('\ud83d\udd34 REGRESSION: a Collection create sends no unbound basis',
      posted && posted.pricingContext && !posted.pricingContext.basisMeta,
      'before _crBindBasis this carried card B\u2019s sourceUrl, low/mid/high and retrievedAt: '
        + JSON.stringify(posted && posted.pricingContext));
    T.check('\ud83d\udd34 REGRESSION: card B is nowhere in the create body',
      JSON.stringify(posted || {}).indexOf('CARD-B') === -1, JSON.stringify(posted));
    // WAS: the same claim, read with page.evaluate AFTER the click returned.
    // That read raced the create's success handler, which clears `_crBasis`.
    // It passed while the bundle was smaller and failed once unrelated work
    // changed the timing, then passed again on a rerun: the claim was right,
    // the evidence sampled an instant the claim is not about. It is now
    // captured in the page as the create leaves, which is exactly when the
    // create body existed.
    T.check('the global was populated when the create body was built, so the '
      + 'absence is a refusal, not an empty read',
      await page.evaluate(() => window.__basisAtPost) === FOREIGN,
      'a populated global that does not reach the wire is the whole point of '
        + 'the check; captured as the request left: '
        + String(await page.evaluate(() => window.__basisAtPost)));

    // ── 3. The legitimate case must still work, or the binding has just
    // deleted comp provenance from every packet.
    posted = null;
    await page.evaluate((A) => {
      window._crBasis = _crBindBasis({ value: 400, label: 'TCGplayer market',
        sourceUrl: 'https://www.tcgplayer.com/CARD-A', low: 380, mid: 400, high: 430,
        retrievedAt: '2026-09-08T20:30:00.000Z' }, A);
      window._crSellApproved = A;
    }, CARD_A);
    await page.click('#crSellBtn');
    T.check('setup: the legitimate create went out', await waitPost() === true);
    const meta = posted && posted.pricingContext && posted.pricingContext.basisMeta;
    T.check('\ud83d\udd34 a basis read FOR this card is still sent',
      !!(meta && meta.sourceUrl === 'https://www.tcgplayer.com/CARD-A'), JSON.stringify(meta));
    T.check('with its tiers and its own retrieval time intact',
      !!(meta && meta.low === 380 && meta.mid === 400 && meta.high === 430
         && meta.retrievedAt === '2026-09-08T20:30:00.000Z'), JSON.stringify(meta));

    // ── 4. An unstamped basis is not usable. This is the standing guard for a
    // read path added later that forgets to bind: it loses provenance rather
    // than attaching someone else's.
    posted = null;
    await page.evaluate((A) => {
      window._crBasis = { value: 400, label: 'unbound read', sourceUrl: 'https://x.test/UNBOUND',
        retrievedAt: '2026-09-08T20:45:00.000Z' };
      window._crSellApproved = A;
    }, CARD_A);
    await page.click('#crSellBtn');
    T.check('setup: the unbound-basis create went out', await waitPost() === true);
    T.check('\ud83d\udd34 a basis carrying no card identity is dropped',
      posted && posted.pricingContext && !posted.pricingContext.basisMeta,
      JSON.stringify(posted && posted.pricingContext));
    T.check('and the unbound source never reaches the wire',
      JSON.stringify(posted || {}).indexOf('UNBOUND') === -1, JSON.stringify(posted));
    T.check('the fee revision still goes out, so dropping the basis is not dropping the context',
      posted && posted.pricingContext.feeModelRevision === 1,
      JSON.stringify(posted && posted.pricingContext));

    await ctx.close();
  });

  /* ─────────────────────────────────────────────
     D4 -- where the price came from

     Five behaviours, each evidenced on the surface a seller reads, all of them
     after a real load of the stored record rather than off a live in-memory
     basis:

       1. the stored source label reaches the screen, and its link is an href
          only when the stored string is a safe http(s) URL;
       2. the retrieval time rendered is the STORED absolute instant -- a
          rebuild moves `metadata.generatedAt` and must not move the caption;
       3. a basis beside a seller-typed price is labelled context, and a basis
          behind a comp-derived price is labelled as what determined it;
       4. missing source and missing retrieval time are STATED, not blank;
       5. an unusable packet clears the whole block.

     The hostile-URL fixture stores `javascript:alert(document.domain)` through
     the real POST handler, unsanitized, because the rejection under test is
     the client's. A fixture that arrived pre-cleaned would pass this section
     while the screen was wide open.
  ───────────────────────────────────────────── */
  const basisOf = (page) => page.evaluate(() => {
    const el = document.querySelector('#reviewWrap .review-packet-basis');
    if (!el) return null;
    const q = (sel) => el.querySelector(sel);
    const link = q('[data-basis-link]');
    return {
      state:   el.getAttribute('data-packet-basis'),
      role:    el.getAttribute('data-basis-role'),
      src:     el.getAttribute('data-basis-price-source'),
      unsupported: el.hasAttribute('data-basis-unsupported'),
      text:    el.innerText,
      html:    el.innerHTML,
      roleNote: (q('[data-basis-role-note]') || {}).innerText || '',
      linkHref: link ? link.getAttribute('href') : null,
      linkText: link ? link.innerText : null,
      rejected: !!q('[data-basis-link-rejected]'),
      linkAbsent: !!q('[data-basis-link-absent]'),
      sourceAbsent: !!q('[data-basis-source-absent]'),
      retrievedAttr: (q('[data-basis-retrieved-at]') || {}).getAttribute
        ? q('[data-basis-retrieved-at]').getAttribute('data-basis-retrieved-at') : null,
      retrievedText: (q('[data-basis-field="retrieved"] .review-field-value') || {}).innerText || '',
      retrievedAbsent: !!q('[data-basis-retrieved-absent]'),
      dating: (q('[data-basis-dating]') || {}).getAttribute
        ? q('[data-basis-dating]').getAttribute('data-basis-dating') : null,
      sourcePublished: (q('[data-basis-source-published]') || {}).getAttribute
        ? q('[data-basis-source-published]').getAttribute('data-basis-source-published') : null,
      sourceDatedUnrecorded: !!q('[data-basis-source-dated="unrecorded"]'),
    };
  });

  await T.section('a seller can see where the price came from, after a reload', async () => {
    // ── 1. comp-derived: the basis is the evidence ──────────────────────────
    {
      const { ctx, page } = await boot(serveRead(F.packetCompPriced));
      await openReview(page, F.ids.packetCompPriced);
      const b = await basisOf(page);
      T.check('setup: the stored packet is usable and carries a basis',
        F.packetCompPriced.body.packetUsable === true && !!F.packetCompPriced.body.packet.priceBasis);
      T.check('\ud83d\udd34 the provenance block renders for a usable packet', b && b.state === 'present', JSON.stringify(b && b.state));
      T.check('\ud83d\udd34 the stored source label reaches the seller',
        b && b.linkText === F.packetCompPriced.body.packet.priceBasis.label, b && b.linkText);
      T.check('\ud83d\udd34 a stored https link becomes the href, unaltered',
        b && b.linkHref === F.packetCompPriced.body.packet.priceBasis.sourceUrl, b && b.linkHref);
      T.check('the link cannot hand the opener to the source',
        b && /rel="noopener noreferrer nofollow"/.test(b.html));
      T.check('\ud83d\udd34 a comp-derived price is labelled as DERIVED from the basis',
        b && b.role === 'determining' && /derived from the market data/i.test(b.roleNote),
        b && b.role + ' / ' + b.roleNote);
      // The stored instant, not the moment the bytes were made. 12:00Z was
      // fixed at fixture time; generatedAt is today, so a display sourced from
      // generatedAt would render a different DATE and this comparison catches
      // it rather than depending on a millisecond difference.
      T.check('\ud83d\udd34 the retrieval time rendered is the STORED absolute instant',
        b && b.retrievedAttr === '2026-09-08T12:00:00.000Z', b && b.retrievedAttr);
      T.check('setup: the packet was generated at a different instant than it was retrieved',
        F.packetCompPriced.body.packet.metadata.generatedAt !== '2026-09-08T12:00:00.000Z',
        F.packetCompPriced.body.packet.metadata.generatedAt);
      T.check('and the caption does not print the generation time',
        b && b.text.indexOf(F.packetCompPriced.body.packet.metadata.generatedAt) === -1);
      // WAS: 'PriceCharting publishes no as-of date, so the caption says we
      // read it', asserting dating === 'retrieval' only when datedBySource was
      // false -- which accepted the other arm, where the SAME retrieval instant
      // was captioned "The source published this as-of date". Review named the
      // hole: a datedBySource boolean does not establish that our retrieval
      // instant is the source's as-of instant, and nothing records the latter.
      // The caption is now unconditional and the assertion no longer has an
      // arm to be wrong in.
      T.check('\ud83d\udd34 the retrieval caption attributes the read to CardResell, never to the source',
        b && b.dating === 'retrieval'
          && /CardResell read the source/i.test(b.text)
          // The retired FALSE claim, specifically. The corrected copy contains
          // the words "the source published" in a denial, so a bare negative
          // on that phrase fails on the fixed text -- the assertion has to name
          // the claim, not the vocabulary.
          && !/source published this as-of date/i.test(b.text),
        b && b.dating + ' / ' + b.text);
      T.check('\ud83d\udd34 no source-published date is shown, because none is recorded',
        b && b.sourcePublished === null
          && F.packetCompPriced.body.packet.priceBasis.sourcePublishedAt === undefined,
        b && b.sourcePublished);
      await ctx.close();
    }

    // ── 2. the rebuild does not make the quote look newer ───────────────────
    {
      T.check('setup: the rebuild moved the generation time',
        F.packetCompRebuilt.body.packet.metadata.generatedAt
          !== F.packetCompPriced.body.packet.metadata.generatedAt,
        F.packetCompRebuilt.body.packet.metadata.generatedAt);
      const { ctx, page } = await boot(serveRead(F.packetCompRebuilt));
      await openReview(page, F.ids.packetCompRebuilt);
      const b = await basisOf(page);
      T.check('\ud83d\udd34 after a rebuild the rendered retrieval time has NOT moved',
        b && b.retrievedAttr === '2026-09-08T12:00:00.000Z', b && b.retrievedAttr);
      await ctx.close();
    }

    // ── 3. seller-typed: the same basis is context, not evidence ────────────
    {
      const { ctx, page } = await boot(serveRead(F.packetSellerPriced));
      await openReview(page, F.ids.packetSellerPriced);
      const b = await basisOf(page);
      T.check('setup: same basis fields as the comp-derived draft',
        JSON.stringify(F.packetSellerPriced.body.packet.priceBasis)
          === JSON.stringify(F.packetCompPriced.body.packet.priceBasis));
      T.check('\ud83d\udd34 a basis beside a seller-typed price is labelled CONTEXT',
        b && b.role === 'context', b && b.role);
      T.check('\ud83d\udd34 and the copy denies that it determined the price',
        b && /you set this asking price yourself/i.test(b.roleNote)
          && /not what the price was derived from/i.test(b.roleNote), b && b.roleNote);
      T.check('the heading changes with the role, so the two are not one screen',
        b && /market context/i.test(b.text) && !/where this price came from/i.test(b.text), b && b.text.slice(0, 80));
      await ctx.close();
    }

    // ── 4. a hostile stored link never becomes an href ──────────────────────
    {
      T.check('setup: the stored link is a javascript: URL',
        F.packetHostileUrl.body.packet.priceBasis.sourceUrl.startsWith('javascript:'),
        F.packetHostileUrl.body.packet.priceBasis.sourceUrl);
      const { ctx, page } = await boot(serveRead(F.packetHostileUrl));
      await openReview(page, F.ids.packetHostileUrl);
      const b = await basisOf(page);
      T.check('\ud83d\udd34 a javascript: source link is not rendered as a link at all',
        b && b.linkHref === null, b && b.linkHref);
      T.check('\ud83d\udd34 and the URL string does not reach the DOM in any form',
        b && b.html.indexOf('javascript:') === -1 && b.html.indexOf('alert(') === -1);
      T.check('\ud83d\udd34 the label still shows, with the reason there is no link',
        b && /PriceCharting loose/.test(b.text) && b.rejected === true, b && b.text);
      await ctx.close();
    }

    // ── 5. missing pieces are stated, not blank ─────────────────────────────
    {
      const { ctx, page } = await boot(serveRead(F.packetPartialBasis));
      await openReview(page, F.ids.packetPartialBasis);
      const b = await basisOf(page);
      T.check('setup: the stored basis is label-only -- the real SportsCardsPro shape',
        F.packetPartialBasis.body.packet.priceBasis.sourceUrl === null
          && F.packetPartialBasis.body.packet.priceBasis.retrievedAt === null);
      T.check('\ud83d\udd34 a basis with no link says so instead of showing a dead label',
        b && b.linkAbsent === true && b.linkHref === null && /no link was recorded/i.test(b.text), b && b.text);
      T.check('\ud83d\udd34 a basis with no retrieval time says so instead of rendering blank',
        b && b.retrievedAbsent === true && /no retrieval time recorded/i.test(b.retrievedText),
        b && b.retrievedText);
      T.check('and no as-of sentence is printed for a time we do not have',
        b && b.dating === null, b && b.dating);
      await ctx.close();
    }

    // ── 6. a comp-derived price with no basis at all ────────────────────────
    {
      const { ctx, page } = await boot(serveRead(F.packetNoBasis));
      await openReview(page, F.ids.packetNoBasis);
      const b = await basisOf(page);
      T.check('setup: usable packet, priceBasis null, price recorded as comp-derived',
        F.packetNoBasis.body.packetUsable === true
          && F.packetNoBasis.body.packet.priceBasis === null
          && F.packetNoBasis.body.draft.priceSource === 'comp');
      T.check('\ud83d\udd34 no recorded source is stated as absent',
        b && b.state === 'absent' && /no price source was recorded/i.test(b.text), b && b.text);
      T.check('\ud83d\udd34 and a comp-derived price with no basis is flagged as owing one',
        b && b.unsupported === true && /should have one/i.test(b.text), b && b.text);
      await ctx.close();
    }

    // ── 7. an unusable packet clears the block entirely ─────────────────────
    {
      T.check('setup: the stale envelope withholds the packet',
        F.packetStale.body.packetUsable === false, String(F.packetStale.body.packetUsable));
      const { ctx, page } = await boot(serveRead(F.packetStale));
      await openReview(page, F.ids.packetStale);
      const b = await basisOf(page);
      T.check('\ud83d\udd34 an unusable packet renders NO provenance block', b === null, JSON.stringify(b));
      const body = await page.evaluate(() => document.getElementById('reviewWrap').innerText);
      T.check('and no source label survives on screen',
        body.indexOf('PriceCharting loose') === -1);
      T.check('and no retrieval instant survives on screen',
        body.indexOf('2026-09-08T12:00') === -1);
      await ctx.close();
    }

    // ── 7b. a feed that dates its own data, with no instant recorded ────────
    // The gap is stated. It is NOT filled with our retrieval time, which is
    // what the retired caption did.
    {
      T.check('setup: the stored basis claims datedBySource with no source instant',
        F.packetDatedBySource.body.packet.priceBasis.datedBySource === true
          && F.packetDatedBySource.body.packet.priceBasis.sourcePublishedAt === undefined);
      const { ctx, page } = await boot(serveRead(F.packetDatedBySource));
      await openReview(page, F.ids.packetDatedBySource);
      const b = await basisOf(page);
      T.check('\ud83d\udd34 the retrieval row is still attributed to CardResell',
        b && b.dating === 'retrieval' && /CardResell read the source/i.test(b.text), b && b.dating);
      T.check('\ud83d\udd34 and the missing source date is stated, not substituted',
        b && b.sourceDatedUnrecorded === true
          && /was not recorded with this quote/i.test(b.text)
          && b.sourcePublished === null, b && b.text);
      T.check('the retrieval instant is not offered as the source date',
        b && !/source published this as-of date/i.test(b.text), b && b.text);
      await ctx.close();
    }

    // ── 7c. a price EDIT re-attributes, and the basis survives as context ───
    //
    // The defect this closes: priceSource never moved on an edit, so a seller
    // who typed over a comp-derived price was told their own number "was
    // derived from the market data below". The fix is in the edit owner
    // (applyEdit in api/_draftStore.js), and this asserts the seller-visible
    // end of it after a real PATCH and a reload.
    {
      const before = F.packetCompPriced.body.draft;
      const after  = F.packetPriceEdited.body.draft;
      T.check('setup: the draft was created comp-derived and the edit moved the price',
        before.priceSource === 'comp' && after.price === 365 && after.price !== before.price,
        after.priceSource + ' / ' + after.price);
      T.check('\ud83d\udd34 the edit recorded the price as SELLER-set',
        after.priceSource === 'seller', after.priceSource);
      T.check('\ud83d\udd34 and the original basis was preserved, not dropped',
        F.packetPriceEdited.body.packet.priceBasis
          && F.packetPriceEdited.body.packet.priceBasis.label === 'PriceCharting loose'
          && F.packetPriceEdited.body.packet.priceBasis.retrievedAt === '2026-09-08T12:00:00.000Z',
        JSON.stringify(F.packetPriceEdited.body.packet.priceBasis));
      const { ctx, page } = await boot(serveRead(F.packetPriceEdited));
      await openReview(page, F.ids.packetPriceEdited);
      const b = await basisOf(page);
      T.check('\ud83d\udd34 the screen no longer claims the seller\'s price was derived',
        b && b.role === 'context' && !/derived from the market data/i.test(b.text),
        b && b.role);
      T.check('\ud83d\udd34 it reads as market context beside the price',
        b && /market context/i.test(b.text) && /you set this asking price yourself/i.test(b.roleNote),
        b && b.roleNote);
      T.check('the preserved basis is still fully rendered',
        b && b.linkText === 'PriceCharting loose' && b.retrievedAttr === '2026-09-08T12:00:00.000Z',
        b && b.linkText + ' / ' + b.retrievedAttr);
      const shown = await page.evaluate(() => document.getElementById('reviewWrap').innerText);
      T.check('\ud83d\udd34 and the rebuilt packet documents the NEW price',
        /\$365/.test(shown) && !/\$400\.00/.test(shown), shown.slice(0, 120));
      await ctx.close();
    }

    // ── 7d. a NOTES-only edit must not move attribution ─────────────────────
    // The control on 7c: "any edit means the seller set the price" would be a
    // different false claim, and this is the assertion that forbids it.
    {
      T.check('\ud83d\udd34 a notes-only edit leaves the price attribution alone',
        F.packetNotesEdited.body.draft.priceSource === 'comp',
        F.packetNotesEdited.body.draft.priceSource);
      T.check('setup: the notes edit did land',
        F.packetNotesEdited.body.draft.notes === 'ships Monday',
        F.packetNotesEdited.body.draft.notes);
      const { ctx, page } = await boot(serveRead(F.packetNotesEdited));
      await openReview(page, F.ids.packetNotesEdited);
      const b = await basisOf(page);
      T.check('\ud83d\udd34 and the screen still says the price was derived from the basis',
        b && b.role === 'determining' && /derived from the market data/i.test(b.text), b && b.role);
      await ctx.close();
    }

    // ── 8. the action is named for what it does ─────────────────────────────
    // A rebuild re-reads the DRAFT, not the market. "Refresh price" would
    // promise a new quote; the button must not.
    {
      const { ctx, page } = await boot(serveRead(F.packetCompPriced));
      await openReview(page, F.ids.packetCompPriced);
      const label = await page.evaluate(() => {
        const b = document.getElementById('reviewRefreshBtn');
        return b ? b.innerText.trim() : null;
      });
      T.check('\ud83d\udd34 the rebuild action is labelled Refresh listing details',
        label === 'Refresh listing details', label);
      T.check('and it does not promise a new price', label && !/price|quote/i.test(label), label);
      await ctx.close();
    }
  });

} finally {
  await browser.close();
  server.close();
}

T.done();
