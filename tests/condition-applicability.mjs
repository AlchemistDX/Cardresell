// Condition-applicability interaction test.
// Proves: the Condition pill group is on screen exactly when it can move a
// price, and that the sports path and the graded path no longer fight over it.
// Playwright lives outside the repo (this project intentionally has no
// package.json), so the path is overridable for other machines.
import { completionGuard } from './_complete.mjs';
const { finish: _finish } = completionGuard('condition-applicability');

const PW = process.env.PLAYWRIGHT_PATH || '/home/user/node_modules/playwright/index.js';
const _pw = (await import(PW)).default;
const { chromium } = _pw;

let pass = 0, fail = 0;
const check = (label, cond) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
};

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
const BASE = process.env.SITE_BASE || 'http://127.0.0.1:8097';
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1200);

// Seed the printing selector with one raw and one graded option so the real
// functions have something to read. We drive the app's own functions from here
// on -- no reimplementation of the rule inside the test.
await page.evaluate(() => {
  const sel = document.getElementById('printingSelect');
  sel.innerHTML = '';
  const raw = document.createElement('option');
  raw.value = 'holofoil'; raw.textContent = 'Holofoil';
  const psa = document.createElement('option');
  psa.value = 'psa_8'; psa.textContent = 'PSA 8';
  sel.append(raw, psa);
  sel.value = 'holofoil';
});

const condVisible = () => page.evaluate(() => {
  const el = document.getElementById('condPills');
  const lb = document.getElementById('condLabel');
  const vis = n => !!(n && n.style.display !== 'none' && n.offsetParent !== null);
  return { pills: vis(el), label: vis(lb) };
});

const selectedCond = () => page.evaluate(() =>
  document.querySelector('#condPills .pill.sel')?.dataset.cond || null);

// ── 1. Raw, non-sports: the control applies and is on screen ────────────────
await page.evaluate(() => { selectedCard = { game: 'pokemon' }; updatePriceFromPrinting(); });
let v = await condVisible();
check('raw + non-sports: condition pills visible', v.pills);
check('raw + non-sports: condition label visible', v.label);
check('predicate agrees (applies = true)', await page.evaluate(() => _conditionApplies()));

// ── 2. User picks a real condition, then switches to a slab ─────────────────
await page.evaluate(() => {
  const lp = document.querySelector('#condPills .pill[data-cond="lp"]');
  document.querySelectorAll('#condPills .pill').forEach(x => x.classList.remove('sel'));
  lp.classList.add('sel');
});
check('user selection recorded as Light Play', (await selectedCond()) === 'lp');

await page.evaluate(() => {
  document.getElementById('printingSelect').value = 'psa_8';
  updatePriceFromPrinting();
});
v = await condVisible();
check('graded selected: condition pills hidden', !v.pills);
check('graded selected: condition label hidden', !v.label);
check('predicate agrees (applies = false)', await page.evaluate(() => !_conditionApplies()));
check('multiplier is forced to 1.0 while graded',
  (await page.evaluate(() => getCondMultiplier())) === 1.0);
check('hidden, not reset: Light Play still recorded', (await selectedCond()) === 'lp');

// ── 3. Back to raw: control returns AND the user's choice survived ──────────
await page.evaluate(() => {
  document.getElementById('printingSelect').value = 'holofoil';
  updatePriceFromPrinting();
});
v = await condVisible();
check('back to raw: condition pills visible again', v.pills);
check('back to raw: Light Play preserved, not reset to NM', (await selectedCond()) === 'lp');
check('back to raw: multiplier is Light Play again (0.85)',
  (await page.evaluate(() => getCondMultiplier())) === 0.85);

// ── 4. Sports: hidden regardless of printing ───────────────────────────────
await page.evaluate(() => { _applySportsPriceControls({ game: 'sports' }); });
v = await condVisible();
check('sports: condition pills hidden', !v.pills);

// ── 5. THE REGRESSION CASE: sports card on a raw printing. Previously the
//       sports path wrote display:'' for non-sports and the graded path wrote
//       'none', so whichever ran last won. Now one owner weighs both.
await page.evaluate(() => {
  selectedCard = { game: 'sports' };
  document.getElementById('printingSelect').value = 'holofoil';
  updatePriceFromPrinting();          // the graded path's hook runs...
  _applySportsPriceControls();         // ...then the sports path runs
});
v = await condVisible();
check('sports + raw printing: still hidden after BOTH paths run', !v.pills);

await page.evaluate(() => {
  _applySportsPriceControls();         // reverse the order
  updatePriceFromPrinting();
});
v = await condVisible();
check('sports + raw printing: still hidden in the reverse order too', !v.pills);

// ── 6. Non-sports recovery, and no console errors ──────────────────────────
await page.evaluate(() => { selectedCard = { game: 'pokemon' }; _applySportsPriceControls(); updatePriceFromPrinting(); });
v = await condVisible();
check('leaving sports for a raw pokemon card restores the pills', v.pills);
check('no uncaught page errors during the run', errs.length === 0);
if (errs.length) console.log('       errors: ' + errs.join(' | '));

console.log(`\ncondition-applicability: ${pass} passed, ${fail} failed`);
await browser.close();
_finish(pass, fail);

_finish(pass, fail);
