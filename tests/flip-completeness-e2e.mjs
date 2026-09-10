// Flip completeness through the REAL record path. Added 2026-09-08 (BIAS-6).
//
// WHY THIS IS SEPARATE FROM tests/payout-honesty.mjs.
//
// payout-honesty lifts the helpers out of the live bundle and asserts their
// return values. That is a unit test and it is honestly labelled as one. It
// cannot establish the thing the original defect actually broke: the defect
// reached PERSISTED records, the portfolio total, "Best Flip", and the CSV.
// A helper that returns the right object proves nothing about whether the
// object survives being written to storage, read back on a fresh page load,
// summed into a headline, and exported.
//
// So this suite drives the shipped page in a real browser and follows one
// record all the way through. Four cases, matching the acceptance list:
//
//   1. explicit zeros saved  -> completeness survives a reload as complete
//   2. one cost left blank   -> still provisional after reload AND in the total
//   3. a legacy record       -> still untracked; no missing-field list invented
//   4. export                -> the three stay distinguishable in the CSV
//
// WHY IT IS A DECLARED EXCLUSION RATHER THAN A RUNNER SLOT: it needs a browser
// and a local HTTP server, which the offline runner does not provide, and the
// repo has no package.json to depend on Playwright from. Registering it as an
// offline suite would be the "unit claims in E2E costume" mistake in reverse --
// an environment-dependent check pretending to be part of the offline gate.
// It is declared in tests/test-registry.mjs and listed in the release
// validation queue instead.
//
// RUN:  node tests/flip-completeness-e2e.mjs            (expects a server on 8097)
//       CR_E2E_URL=http://127.0.0.1:PORT/index.html node tests/flip-completeness-e2e.mjs

import { completionGuard } from './_complete.mjs';
const { finish: _finish } = completionGuard('flip-completeness-e2e');

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/user/node_modules/playwright');

const URL_ = process.env.CR_E2E_URL || 'http://127.0.0.1:8097/index.html';

let passed = 0, failed = 0;
function check(label, cond, hint) {
  if (cond) { console.log('  \u2713 ' + label); passed++; }
  else { console.log('  \u2717 ' + label + (hint ? '\n      ' + hint : '')); failed++; }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 1200 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

await page.goto(URL_, { waitUntil: 'load' });
await page.waitForTimeout(1200);

/* ── Seed through the SAVE path, not by hand-writing the shape ─────────────
   The record is built by the same _readCostFields()/costMeta code the
   "+ Log a Flip" and "mark sold" flows use, so this exercises what a seller
   would actually produce rather than a fixture that happens to match. */
const seeded = await page.evaluate(() => {
  const k = getUserKey('flips');
  localStorage.removeItem(k);

  const mk = (over) => {
    const base = { id: over.id, card: over.card, set: 'Test Set', platform: 'eBay',
                   date: '2026-09-08', sellPrice: over.sellPrice, buyPrice: over.buyPrice };
    if (over.raw) {
      // Route the values through the shipped reader, via real inputs, so
      // costMeta is produced by production code and not by this test.
      const ids = {};
      Object.keys(over.raw).forEach((f, i) => {
        const id = `__e2e_${over.id}_${f}`;
        let el = document.getElementById(id);
        if (!el) { el = document.createElement('input'); el.type = 'number'; el.id = id; document.body.appendChild(el); }
        el.value = over.raw[f];
        ids[f] = id;
        void i;
      });
      const read = _readCostFields(ids);
      Object.assign(base, read.values, { costMeta: read.meta });
      const net = _flipNetOf(base);
      base.profit = net.net;
    } else {
      base.profit = over.legacyProfit;   // legacy row: no costMeta at all
    }
    return base;
  };

  const rows = [
    mk({ id: 'zeros', card: 'Zeros Card', sellPrice: 200, buyPrice: 100,
         raw: { buyPrice: '100', fees: '0', shippingCost: '0', gradingCost: '0' } }),
    mk({ id: 'blank', card: 'Blank Fee Card', sellPrice: 200, buyPrice: 100,
         raw: { buyPrice: '100', fees: '', shippingCost: '0', gradingCost: '0' } }),
    { id: 'legacy', card: 'Legacy Card', set: 'Old Set', platform: 'TCGPlayer',
      date: '2026-08-01', sellPrice: 95, buyPrice: 40, profit: 55 },
  ];
  saveFlipsData(rows);
  return { wrote: rows.length, hasMeta: rows.map(r => !!r.costMeta) };
});
check('three records written through saveFlipsData()',
  seeded.wrote === 3 && seeded.hasMeta[0] && seeded.hasMeta[1] && !seeded.hasMeta[2],
  JSON.stringify(seeded));

/* ── RELOAD. Everything below reads from storage on a fresh document. ───── */
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1000);

const after = await page.evaluate(() => {
  const rows = loadFlipsData();
  const by = (id) => rows.find(r => r.id === id);
  const comp = (id) => _flipCompleteness(by(id));
  return {
    count: rows.length,
    zeros:  comp('zeros'),
    blank:  comp('blank'),
    legacy: comp('legacy'),
    blankMetaFees: (by('blank').costMeta || {}).fees,
    zerosMetaFees: (by('zeros').costMeta || {}).fees,
    legacyHasMeta: 'costMeta' in by('legacy'),
  };
});

console.log('\n── 1. explicit zeros survive a reload as complete ──');
check('the record is still there after reload', after.count === 3);
check('an explicitly-entered $0 is still recorded as a confirmed zero, not a blank',
  after.zerosMetaFees === 'zero', `got ${after.zerosMetaFees}`);
check('completeness after reload: complete, not provisional',
  after.zeros.reason === 'complete' && after.zeros.provisional === false,
  JSON.stringify(after.zeros));

console.log('\n── 2. a blank cost stays provisional after reload ──');
check('the blank field survived the round trip as blank, not as 0',
  after.blankMetaFees === 'blank', `got ${after.blankMetaFees}`);
check('still provisional after reload, and still names the gap',
  after.blank.provisional === true && after.blank.missing.includes('fees'),
  JSON.stringify(after.blank));
check('the confirmed zeros beside it are NOT reported as missing',
  !after.blank.missing.includes('shippingCost') && !after.blank.missing.includes('gradingCost'),
  JSON.stringify(after.blank.missing));

console.log('\n── 3. a legacy record stays untracked ──');
check('no costMeta was fabricated for it on load', after.legacyHasMeta === false);
check('reported untracked and provisional, not complete',
  after.legacy.tracked === false && after.legacy.reason === 'untracked' && after.legacy.provisional === true,
  JSON.stringify(after.legacy));
check('no missing-field list invented for it',
  after.legacy.missing.length === 0, JSON.stringify(after.legacy.missing));

console.log('\n── 2b. the aggregate reflects it after reload ──');
const agg = await page.evaluate(() => {
  let n = document.getElementById('pnlGrid');
  while (n && n !== document.body) { n.style.display = ''; n.style.visibility = 'visible'; n = n.parentElement; }
  renderFlipsView();
  const t = (id) => (document.getElementById(id) || {}).textContent || '';
  return { label: t('pnlTotalProfitLabel'), note: t('pnlTotalProfitNote'),
           best: t('pnlBestFlipLabel'), bestName: t('pnlBestFlipName') };
});
check('the headline is qualified, not bare "Total Profit"',
  agg.label === 'Total Profit (provisional)', JSON.stringify(agg.label));
check('the note is NEUTRAL -- it does not claim an upper bound',
  !/at most/i.test(agg.note) && /^Provisional total/.test(agg.note), JSON.stringify(agg.note));
check('the note separates the missing-input record from the pre-tracking record',
  /missing cost inputs/.test(agg.note) && /predates cost tracking/.test(agg.note),
  JSON.stringify(agg.note));

console.log('\n── 4. the three stay distinguishable in the export ──');
const csv = await page.evaluate(() => {
  // Capture the export payload without triggering a download.
  const realCreate = document.createElement.bind(document);
  let captured = null;
  document.createElement = (tag) => {
    const el = realCreate(tag);
    if (tag === 'a') { const c = el.click.bind(el); el.click = () => { captured = el.href; }; void c; }
    return el;
  };
  try { exportFlips(); } finally { document.createElement = realCreate; }
  if (!captured) return null;
  return decodeURIComponent(captured.replace(/^data:text\/csv;charset=utf-8,/, ''));
});
check('an export payload was produced', typeof csv === 'string' && csv.length > 0);
if (typeof csv === 'string') {
  const lines = csv.split('\n');
  const cells = (id) => {
    const row = lines.find(l => l.includes(`"${id === 'zeros' ? 'Zeros Card' : id === 'blank' ? 'Blank Fee Card' : 'Legacy Card'}"`));
    return row ? row.split('","').map(c => c.replace(/^"|"$/g, '')) : null;
  };
  const z = cells('zeros'), b = cells('blank'), l = cells('legacy');
  const status = (r) => r ? r[r.length - 2] : null;
  const gap    = (r) => r ? r[r.length - 1] : null;
  check('the header carries the two status columns',
    /Record Status/.test(lines[0]) && /Missing Inputs/.test(lines[0]));
  check('complete record: status says complete FOR TRACKED INPUTS, not "verified"',
    status(z) === 'complete for tracked inputs', JSON.stringify(status(z)));
  check('provisional record: status provisional and the gap is named',
    status(b) === 'provisional' && /fees/.test(gap(b)), JSON.stringify([status(b), gap(b)]));
  check('legacy record: status says the inputs are NOT RECOVERABLE',
    /predates cost tracking/.test(status(l)) && /not recoverable/.test(status(l)),
    JSON.stringify(status(l)));
  check('all three statuses differ from one another',
    new Set([status(z), status(b), status(l)]).size === 3);
  // The empty-cell trap: blank means two opposite things, so the gap column
  // must never be blank -- the reader cannot tell them apart if it is.
  check('the gap cell is never empty, so "blank" cannot be read as "fine"',
    gap(z) === 'none' && gap(l) === 'not recorded' && gap(b) !== '',
    JSON.stringify([gap(z), gap(b), gap(l)]));
  check('no missing-field list was invented for the legacy row',
    !/fees|shipping|grading|purchase price/.test(gap(l)), JSON.stringify(gap(l)));
}

check('no uncaught page errors during the run',
  pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
console.log(`\nflip-completeness-e2e: ${passed} passed, ${failed} failed`);
_finish(passed, failed);

_finish(passed, failed);
