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

} finally {
  await browser.close();
  server.close();
}

T.done();
