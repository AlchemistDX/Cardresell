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
 *   5. selecting that seventh candidate hands that exact candidate to the
 *      selection handler — not the top guess, and not an index into the short
 *      list that silently resolves to the wrong row.
 *
 * Item 5 is the one that matters. An off-by-one between the short list and the
 * full list would still render nine buttons and still "work" on candidate one.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = '/home/user/node_modules/playwright/index.js';
const PORT = Number(process.env.CR_CONFIRM_PORT || 8341);
const B = `http://127.0.0.1:${PORT}`;

const { check, done } = harness('identity-confirmation-browser');

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
const ALL = Array.from({ length: 9 }, (_, i) => ({
  name: 'Pikachu', number: '58', set: 'set' + i,
}));
const TARGET_SET = 'set6';
const PAYLOAD = {
  success: true,
  card_name: 'Pikachu',
  card_number: '58',
  identified: false,
  needs_confirmation: true,
  end_state: 'NEEDS_CONFIRMATION',
  identity_resolution: {
    stage: 'pokemon_rank',
    end_state: 'NEEDS_CONFIRMATION',
    reason: '9 candidates are equally consistent with the printed identifiers',
    candidates: ALL.slice(0, 3),
    candidate_count: 9,
    more_available: true,
    all_candidates: ALL,
  },
};

const { chromium } = (await import(PW)).default;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(B + '/', { waitUntil: 'domcontentloaded' });

await page.waitForFunction(
  () => typeof window._renderIdentityConfirmation === 'function',
  null, { timeout: 20000 },
);
check('the real bundle exposes the confirmation renderer', true);

// ── render the short list through the real renderer ─────────────────────────
const short = await page.evaluate((payload) => {
  // Real elements the scanner writes into.
  let statusEl = document.getElementById('scanStatus');
  let resultEl = document.getElementById('scanResult');
  if (!statusEl) { statusEl = document.createElement('div'); statusEl.id = 'scanStatus'; document.body.appendChild(statusEl); }
  if (!resultEl) { resultEl = document.createElement('div'); resultEl.id = 'scanResult'; document.body.appendChild(resultEl); }
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

// ── open the full list and select the seventh candidate ────────────────────
const picked = await page.evaluate(async (targetSet) => {
  // Capture what the selection handler is handed, without performing a debit.
  window.__pickedCandidate = null;
  window._pickScanCandidate = function (idx) {
    const list = window._pendingScanCandidates || [];
    window.__pickedIndex = idx;
    window.__pickedCandidate = list[idx] || null;
  };
  document.querySelector('[data-testid="identity-more"]').click();

  const resultEl = document.getElementById('scanResult');
  const btns = [...resultEl.querySelectorAll('[data-testid="identity-candidate"]')];
  const target = btns.find((b) => b.getAttribute('data-candidate-set') === targetSet);
  const targetIdx = btns.indexOf(target);
  if (target) target.click();
  return {
    fullCount: btns.length,
    fullSets: btns.map((b) => b.getAttribute('data-candidate-set')),
    targetPresent: !!target,
    targetIdx,
    pickedIndex: window.__pickedIndex ?? null,
    pickedCandidate: window.__pickedCandidate,
    stashedLength: (window._pendingScanCandidates || []).length,
  };
}, TARGET_SET);

check('opening "show all" renders every candidate',
      picked.fullCount === 9, `rendered ${picked.fullCount} of 9`);
check('the seventh candidate is reachable in the full list',
      picked.targetPresent === true, JSON.stringify(picked.fullSets));
check('it is genuinely at position seven',
      picked.targetIdx === 6, `found at index ${picked.targetIdx}`);
check('the selection handler receives the SEVENTH candidate, not the top guess',
      !!picked.pickedCandidate && picked.pickedCandidate.set_name === TARGET_SET,
      `handler received ${JSON.stringify(picked.pickedCandidate)}`);
check('the stashed list the handler indexes into is the FULL list',
      picked.stashedLength === 9,
      `handler would index into a ${picked.stashedLength}-item list, so an index ` +
      `beyond 3 could resolve to the wrong candidate or undefined`);
check('the selected index matches the rendered position (no off-by-one)',
      picked.pickedIndex === 6, `handler got index ${picked.pickedIndex}`);

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

await browser.close();
shutdown();
done();
