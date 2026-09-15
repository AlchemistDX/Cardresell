/**
 * The seller must be able to CONFIRM a printing, and to reach a candidate that
 * is not in the top three.
 *
 * WHY THIS SUITE EXISTS. On 2026-09-14 review established that the server-side
 * work was necessary but not sufficient: api/scan.js serialized
 * `needs_confirmation`, `identity_resolution.candidates` and
 * `identity_resolution.all_candidates`, and NO client code read any of them.
 * The live bundle contained zero occurrences of `needs_confirmation`,
 * `identity_resolution`, or `all_candidates`. Putting candidates on the wire
 * does not make them seller-reachable, so the product guarantee — "show the
 * seller a short list when the image cannot distinguish between printings" —
 * was not actually implemented.
 *
 * WHY IT DRIVES A REAL BROWSER. A source assertion that "the renderer mentions
 * all_candidates" would pass against a renderer that mentions it and never
 * renders it. So this suite loads the real bundle in a real browser, feeds the
 * real dispatch path a real server payload shape, and reads the resulting DOM.
 *
 * WHAT IT ASSERTS:
 *   1. a NEEDS_CONFIRMATION payload renders a confirmation, never a single
 *      identified card;
 *   2. the short list shown first is exactly three;
 *   3. the complete count is disclosed to the seller;
 *   4. the SEVENTH candidate is NOT in the short list, and IS reachable after
 *      the seller opens the full list;
 *   5. the REAL selection handler debits once and opens the seventh card's
 *      final screen, not the top guess; cancel and debit failures select nothing.
 *
 * Item 5 is the one that matters. An off-by-one between the short list and the
 * full list would still render nine buttons and still "work" on candidate one.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { billingHarness, catalogue, PAID_KEY } from './_scanBillingHarness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = '/home/user/node_modules/playwright/index.js';
const PORT = Number(process.env.CR_CONFIRM_PORT || 8341);
const B = `http://127.0.0.1:${PORT}`;

const { check, done } = harness('identity-confirmation-browser');
const EVIDENCE = process.env.CR_CONFIRM_EVIDENCE || '/home/user/workspace/confirmation-browser-evidence';
mkdirSync(EVIDENCE, { recursive: true });

// ── server ─────────────────────────────────────────────────────────────────
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

/* The payload shape api/scan.js actually emits (identityResponseFields()):
 * nine consistent printings, short list of three, complete set of nine.
 * The target sits at index 6 — the seventh candidate. */
const TARGET_SET = 'set6';
let h = billingHarness({ bucket: 'free' });
const PAYLOAD = (await h.scan()).payload;
check('real handler confirmation is net zero', h.net() === 0);
check('real handler emits explicit null printing', PAYLOAD.printing === null);
check('confirmation creates no successful record or search stats',
  !h.commands.some(c => /^(scan:|stats:searches:)/.test(c.key)));
let debitMode = 'success', debitRequests = [], draftWrites = [], blocked = [];
let releaseDebit;

const { chromium, devices } = (await import(PW)).default;
const browser = await chromium.launch();
// WebKit is not installed in this environment. This is Chromium mobile/touch
// emulation at iPhone 13 dimensions, NOT Safari or a physical iPhone.
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
console.log('Browser: Chromium, iPhone 13 mobile/touch emulation (390x664), NOT physical iPhone/Safari');
await ctx.route('**/*', async route => {
  const req = route.request(), u = new URL(req.url());
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.origin === B && u.pathname === '/api/scan-debit-id') {
    debitRequests.push(req.postDataJSON());
    // Hold the response to observe the actual pending UI and double-tap guard.
    await new Promise(resolve => { releaseDebit = resolve; });
    if (debitMode === 'network') return route.abort('failed');
    if (debitMode === 'error') return json({ ok: false, error: 'test debit unavailable' }, 503);
    if (debitMode === 'denied') return json({ ok: false, error: 'test debit denied' });
    const r = await h.pick(req.postDataJSON());
    // Actual handler has committed. Discard only its outgoing response.
    if (debitMode === 'lost-after-commit') return route.abort('failed');
    return json(r.payload, r.statusCode);
  }
  if (u.hostname === 'api.pokemontcg.io') return json({ data: catalogue });
  if (u.origin === B && u.pathname === '/api/pro-status')
    return json({ tier: 'pro', isPro: true, idPaidLeft: Number(h.store.get(PAID_KEY)), idFreeLeft: 0 });
  if (u.origin === B && u.pathname.startsWith('/api/')) {
    if (/draft/.test(u.pathname) && !['GET', 'HEAD'].includes(req.method())) draftWrites.push(req.url());
    return json({ ok: false, data: [], error: 'offline test endpoint' }, 503);
  }
  if (u.origin === B) return route.continue();
  blocked.push(u.href);
  return route.abort('blockedbyclient'); // no real auth, provider or paid network traffic
});
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(B + '/', { waitUntil: 'domcontentloaded' });

await page.waitForFunction(
  () => typeof window._renderIdentityConfirmation === 'function',
  null, { timeout: 20000 },
);
check('the real bundle exposes the confirmation renderer', true);
const pickerSource = await page.evaluate(() => String(window._pickScanCandidate));
check('the real picker contains the debit and final-card routing code',
  pickerSource.includes('/api/scan-debit-id') && pickerSource.includes('_pendingIdScanCard'));
await page.evaluate(() => {
  window.googleUser = { sub: 'offline-browser-seller', email: 'seller@example.test' };
  window._googleIdToken = 'x'.repeat(40); // synthetic isolated context, never a login
  document.getElementById('scanOverlay').style.display = 'flex';
});

// ── render the short list through the real renderer ─────────────────────────
const short = await page.evaluate((payload) => {
  // Real elements the scanner writes into.
  let statusEl = document.getElementById('scanStatus');
  let resultEl = document.getElementById('scanResult');
  if (!statusEl || !resultEl) throw new Error('real scanner DOM is missing');
  const handled = window._renderIdentityConfirmation(payload, statusEl, resultEl, null);
  const btns = [...resultEl.querySelectorAll('[data-testid="identity-candidate"]')];
  const countEl = resultEl.querySelector('[data-testid="identity-count"]');
  return {
    handled,
    rendered: !!resultEl.querySelector('[data-testid="identity-confirmation"]'),
    shortCount: btns.length,
    shortSets: btns.map((b) => b.getAttribute('data-candidate-set')),
    total: countEl ? Number(countEl.getAttribute('data-total')) : null,
    shown: countEl ? Number(countEl.getAttribute('data-shown')) : null,
    hasMoreBtn: !!resultEl.querySelector('[data-testid="identity-more"]'),
    moreLabel: resultEl.querySelector('[data-testid="identity-more"]')?.textContent || null,
    headingText: statusEl.textContent || '',
  };
}, PAYLOAD);

check('a NEEDS_CONFIRMATION payload is handled by the confirmation path',
      short.handled === true && short.rendered === true,
      `handled=${short.handled} rendered=${short.rendered}`);
check('the seller is asked, not told', /pick the right one/i.test(short.headingText),
      short.headingText);
check('the short list shown first is exactly three',
      short.shortCount === 3, `rendered ${short.shortCount} candidates`);
check('the COMPLETE candidate count is disclosed to the seller',
      short.total === 9, `disclosed total=${short.total}`);
check('the short list is honestly labelled as a subset',
      short.shown === 3 && short.total === 9, `shown=${short.shown} total=${short.total}`);
check('the seventh candidate is NOT in the short list (so this test is meaningful)',
      !short.shortSets.includes(TARGET_SET), JSON.stringify(short.shortSets));
check('a "show all matches" affordance exists',
      short.hasMoreBtn === true, `moreLabel=${short.moreLabel}`);
await page.screenshot({ path: path.join(EVIDENCE, '01-confirmation-shortlist.png') });

// ── open the full list and select the seventh candidate ────────────────────
await page.getByTestId('identity-more').click();
const picked = await page.evaluate((targetSet) => {
  const resultEl = document.getElementById('scanResult');
  const btns = [...resultEl.querySelectorAll('[data-testid="identity-candidate"]')];
  const target = btns.find((b) => b.getAttribute('data-candidate-set') === targetSet);
  const targetIdx = btns.indexOf(target);
  return {
    fullCount: btns.length,
    fullSets: btns.map((b) => b.getAttribute('data-candidate-set')),
    targetPresent: !!target,
    targetIdx,
    stashedLength: (window._pendingScanCandidates || []).length,
  };
}, TARGET_SET);

check('opening "show all" renders every candidate',
      picked.fullCount === 9, `rendered ${picked.fullCount} of 9`);
check('the seventh candidate is reachable in the full list',
      picked.targetPresent === true, JSON.stringify(picked.fullSets));
check('it is genuinely at position seven',
      picked.targetIdx === 6, `found at index ${picked.targetIdx}`);
check('the stashed list the handler indexes into is the FULL list',
      picked.stashedLength === 9,
      `handler would index into a ${picked.stashedLength}-item list, so an index ` +
      `beyond 3 could resolve to the wrong candidate or undefined`);
const target = page.locator('[data-testid="identity-candidate"][data-candidate-set="set6"]');
await target.scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(EVIDENCE, '02-seventh-candidate.png') });
// Actual mobile DOM tap, then the detached button's second click while the
// first debit is held: the production handler must reject duplicate work.
const targetElement = await target.elementHandle();
await target.tap();
await targetElement.evaluate(button => button.click());
await page.waitForFunction(() => window._scanCandidateDebitPending === true);
await new Promise(resolve => setTimeout(resolve, 100));
check('one debit request for rapid double click', debitRequests.length === 1);
check('debit receives seventh raw printing and issued receipt',
  debitRequests[0]?.candidate.set === TARGET_SET && debitRequests[0]?.confirmation_id === PAYLOAD.confirmation_id);
check('pending debit has no identified UI or draft', await page.evaluate(() =>
  !document.getElementById('scanStatus').textContent.includes('✓') &&
  !window._pendingIdScanCard && !window._lastIdentifiedCard &&
  document.getElementById('scanSuccessBadge').style.display === 'none') && draftWrites.length === 0);
releaseDebit();
await page.waitForFunction(() =>
  document.getElementById('scanOverlay').style.display === 'none' &&
  document.getElementById('cardNameEl').textContent === 'Pikachu' &&
  document.getElementById('cardMetaEl').textContent.includes('set6'), null, { timeout: 20000 });
check('actual final selected-card DOM is candidate seven, not candidate one',
  await page.locator('#cardNameEl').isVisible() &&
  /set6.*#58/.test(await page.locator('#cardMetaEl').textContent()));
check('one total net credit across scan plus real debit handler', h.net() === 1 && h.selections.length === 1);
check('browser confirmation used monthly free, never paid', h.store.get(PAID_KEY) === '5');
check('real picker was never replaced', await page.evaluate(() => String(window._pickScanCandidate)) === pickerSource);
check('selection did not create a draft', draftWrites.length === 0);
await page.locator('#cardNameBlock').scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(EVIDENCE, '03-selected-seventh-card.png') });
const successEvidence = { net: h.net(), requests: debitRequests, commands: h.commands,
  title: await page.locator('#cardNameEl').textContent(), meta: await page.locator('#cardMetaEl').textContent() };

// A second tab has no first-tab click guard. It reuses the receipt and same
// seventh choice through the unmodified shipped picker and real handler.
const secondTab = await ctx.newPage();
await secondTab.goto(B, { waitUntil: 'domcontentloaded' });
await secondTab.waitForFunction(() => typeof window._renderIdentityConfirmation === 'function');
await secondTab.evaluate(payload => {
  window.googleUser = { sub: 'offline-browser-seller', email: 'seller@example.test' };
  window._googleIdToken = 'x'.repeat(40);
  document.getElementById('scanOverlay').style.display = 'flex';
  _renderIdentityConfirmation(payload, document.getElementById('scanStatus'), document.getElementById('scanResult'), null);
}, PAYLOAD);
await secondTab.getByTestId('identity-more').click();
releaseDebit = null;
await secondTab.locator('[data-candidate-set="set6"]').click();
while (!releaseDebit) await new Promise(resolve => setTimeout(resolve, 10));
releaseDebit();
await secondTab.waitForFunction(() => window._scanCandidateDebitPending === false);
check('second-tab real picker replay charges zero additional credits', h.net() === 1 && h.selections.length === 2);
check('second-tab replay returns same printing', await secondTab.evaluate(() =>
  window._pendingIdScanCard?.setName === 'set6' || document.getElementById('cardMetaEl').textContent.includes('set6')));
await secondTab.close();

// Each failure/cancel starts with an empty isolated page; no real account or
// user storage is touched. Only endpoint responses differ; app functions remain real.
const failureEvidence = [];
for (const mode of ['cancel', 'error', 'denied', 'network', 'insufficient', 'lost-after-commit']) {
  h.restore();
  h = billingHarness();
  const payload = (await h.scan()).payload;
  debitMode = mode;
  debitRequests = [];
  releaseDebit = null;
  if (mode === 'insufficient') h.store.set(PAID_KEY, '0'); // another worker spent the balance
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window._renderIdentityConfirmation === 'function');
  await page.evaluate(payload => {
    window.googleUser = { sub: 'offline-browser-seller', email: 'seller@example.test' };
    window._googleIdToken = 'x'.repeat(40);
    document.getElementById('scanOverlay').style.display = 'flex';
    // A new confirmation must retire stale transient success state, not load
    // an earlier card when Cancel or a failed debit exits this flow.
    window._pendingIdScanCard = { name: 'Stale card', number: '1' };
    window._pendingScanBannerCard = 'Stale card';
    document.getElementById('scanSuccessBadge').style.display = 'flex';
    document.getElementById('scanGradeCTA').classList.add('show');
    _setScanBtns('success');
    _scheduleScanAutoAdvance(60000);
    _renderIdentityConfirmation(payload, document.getElementById('scanStatus'), document.getElementById('scanResult'), null);
  }, payload);
  check(`${mode}: confirmation clears stale pending success before any action`, await page.evaluate(() =>
    window._pendingIdScanCard === null && window._pendingScanBannerCard === null &&
    !window._scanAutoAdvanceTimer &&
    document.getElementById('scanSuccessBadge').style.display === 'none' &&
    !document.getElementById('scanGradeCTA').classList.contains('show')));
  if (mode === 'cancel') {
    await page.getByTestId('identity-cancel').click();
  } else {
    await page.getByTestId('identity-more').click();
    await page.locator('[data-candidate-set="set6"]').click();
    await page.waitForFunction(() => window._scanCandidateDebitPending === true);
    while (!releaseDebit || debitRequests.length === 0) await new Promise(resolve => setTimeout(resolve, 10));
    releaseDebit();
    await page.waitForFunction(() => window._scanCandidateDebitPending === false);
  }
  const state = await page.evaluate(() => ({
    pending: window._pendingIdScanCard || null,
    identified: window._lastIdentifiedCard || null,
    persisted: localStorage.getItem('cr:lastCard:v1:ident'),
    title: document.getElementById('cardNameEl').textContent,
    heading: document.getElementById('scanStatus').textContent,
    error: document.getElementById('scanResult').textContent,
    successVisible: document.getElementById('scanSuccessBadge').style.display !== 'none',
    viewVisible: document.getElementById('scanViewCardBtn').style.display !== 'none',
    cta: document.getElementById('scanGradeCTA').classList.contains('show'),
    autoAdvance: !!window._scanAutoAdvanceTimer,
  }));
  check(`${mode}: no identified result, persisted identity, success UI or draft`,
    state.pending === null && state.identified === null && state.persisted === null &&
    state.title === '' && !state.heading.includes('✓') && !state.successVisible &&
    !state.viewVisible && !state.cta && !state.autoAdvance && draftWrites.length === 0,
    JSON.stringify(state));
  check(`${mode}: expected debit request count`, debitRequests.length === (mode === 'cancel' ? 0 : 1));
  check(`${mode}: no successful record or stats`, !h.commands.some(c => /^(scan:|stats:searches:)/.test(c.key)));
  check(`${mode}: billing matches actual commit`, mode === 'insufficient' ? Number(h.store.get(PAID_KEY)) === 0 : h.net() === (mode === 'lost-after-commit' ? 1 : 0));
  if (mode === 'cancel') check('cancel: no selection handler request', h.selections.length === 0);
  if (mode === 'error' || mode === 'denied') check(`${mode}: debit failure is visible`, /Could not debit/.test(state.error));
  if (mode === 'network') check('network failure is visible', /Network error/.test(state.error));
  await page.screenshot({ path: path.join(EVIDENCE, `04-${mode}.png`) });
  failureEvidence.push({ mode, state, debitRequests, commands: h.commands });
  if (mode === 'lost-after-commit') {
    check('post-commit loss displays real retry button', await page.getByTestId('identity-retry').isVisible());
    debitMode = 'success';
    releaseDebit = null;
    await page.getByTestId('identity-retry').click();
    while (!releaseDebit) await new Promise(resolve => setTimeout(resolve, 10));
    releaseDebit();
    await page.waitForFunction(() =>
      document.getElementById('scanOverlay').style.display === 'none' &&
      document.getElementById('cardMetaEl').textContent.includes('set6'), null, { timeout: 20000 });
    check('visible retry preserves byte-equivalent receipt and candidate', JSON.stringify(debitRequests[0]) === JSON.stringify(debitRequests[1]));
    check('post-commit retry has one lifetime debit and final seventh printing', h.net() === 1 && h.selections.length === 2
      && /set6.*#58/.test(await page.locator('#cardMetaEl').textContent()));
    await page.screenshot({ path: path.join(EVIDENCE, '05-commit-lost-retry.png') });
  }
}

// ── an exact match must NOT render a confirmation ───────────────────────────
const exact = await page.evaluate(() => {
  const statusEl = document.getElementById('scanStatus');
  const resultEl = document.getElementById('scanResult');
  resultEl.innerHTML = '';
  const handled = window._renderIdentityConfirmation({
    success: true, card_name: 'Ivysaur', identified: true, needs_confirmation: false,
    end_state: 'EXACT_MATCH',
    identity_resolution: {
      stage: 'pokemon_rank', end_state: 'EXACT_MATCH', reason: 'exactly one candidate',
      candidates: [], candidate_count: 0, more_available: false, all_candidates: [],
    },
  }, statusEl, resultEl, null);
  return { handled, rendered: !!resultEl.querySelector('[data-testid="identity-confirmation"]') };
});
check('an EXACT_MATCH does not render a confirmation prompt',
      exact.handled === false && exact.rendered === false,
      `handled=${exact.handled} rendered=${exact.rendered}`);

check('no page errors while driving the confirmation flow',
      pageErrors.length === 0, pageErrors.join(' | '));
writeFileSync(path.join(EVIDENCE, 'evidence.json'), JSON.stringify({
  browser: 'Chromium iPhone 13 mobile/touch emulation; no WebKit installed; not physical iPhone',
  initialPayload: PAYLOAD, success: successEvidence, failures: failureEvidence,
  pageErrors, blockedExternalRequests: blocked, draftWrites,
}, null, 2));
h.restore();

await browser.close();
shutdown();
done();
