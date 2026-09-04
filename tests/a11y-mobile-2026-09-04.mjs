/**
 * Accessibility, mobile-target, and honest-copy majors — 2026-09-04
 *
 * Seventh majors group from the Sol E2E audit:
 *   SOL-PLAT-004  "Save All to Collection" wrote to localStorage['flips'] --
 *                 an unscoped key no renderer reads -- and called a renderer
 *                 (renderFlips) that has never existed. Apparent data loss
 *                 after a paid batch.
 *   SOL-PLAT-005  .ft-card clipped long identities at 160px, so two variants
 *                 with very different values rendered identically.
 *   SOL-PLAT-006  Four overlays had no dialog semantics, no focus containment,
 *                 and Escape did nothing.
 *   SOL-PLAT-008  Non-standard `appearance:slider-vertical` warned on console.
 *   SOL-PLAT-009  Mobile controls measured below 44x44 px.
 *   SOL-PLAT-010  "3 months free" overstated the annual discount by 8 cents.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0;
const fails = [];
const ok = (n, c) => { if (c) pass++; else fails.push(n); };
const eq = (n, a, e) => {
  const A = JSON.stringify(a), E = JSON.stringify(e);
  if (A === E) pass++; else fails.push(`${n}\n      expected ${E}\n      actual   ${A}`);
};
const near = (n, a, e, tol = 0.005) => {
  if (Math.abs(a - e) <= tol) pass++;
  else fails.push(`${n}\n      expected ~${e} (+/-${tol})\n      actual   ${a}`);
};
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

function grabFn(src, name) {
  const sig = `function ${name}(`;
  const start = src.indexOf(sig);
  if (start === -1) throw new Error(`function ${name} not found`);
  let i = src.indexOf('{', src.indexOf(')', start));
  let d = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`unbalanced braces for ${name}`);
}
function cssRule(sel) {
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = HTML.match(re);
  return m ? m[1] : null;
}

/* ═══════════════════════════════════════════════════════════
   SOL-PLAT-004 — bulk grade save must use the scoped helpers
   ═══════════════════════════════════════════════════════════ */
{
  const body = stripComments(grabFn(HTML, 'saveBulkGradeToCollection'));
  ok('the bulk grade save reads through loadFlipsData', /const flips = loadFlipsData\(\)/.test(body));
  ok('the bulk grade save writes through saveFlipsData', /saveFlipsData\(flips\)/.test(body));
  ok('the raw unscoped read is gone', !/localStorage\.getItem\('flips'\)/.test(body));
  ok('the raw unscoped write is gone', !/localStorage\.setItem\('flips'/.test(body));
  ok('it calls the renderer that actually exists', /renderFlipsView\(\)/.test(body));
  ok('the nonexistent renderFlips call is gone', !/renderFlips\(\)/.test(body.replace(/renderFlipsView\(\)/g, '')));
  // Must sit inside THIS function, immediately after the flips renderer --
  // a call anywhere else in the file does not refresh the saved batch.
  ok('it also refreshes the Collection surface',
     /renderFlipsView\(\);[\s\S]{0,80}?_maybeRerenderCollection\(true\)/.test(body));
  ok('the success toast still reports the count', /Saved ' \+ added \+ ' graded cards/.test(body));
  // The renderer it names must be a real top-level function.
  ok('renderFlipsView is defined', /\nfunction renderFlipsView\(/.test(HTML));
  ok('renderFlips is NOT defined under that name', !/\nfunction renderFlips\(/.test(HTML));
  ok('the scoped helpers it relies on exist',
     /\nfunction loadFlipsData\(/.test(HTML) && /\nfunction saveFlipsData\(/.test(HTML));
  // No other survivor of the unscoped key anywhere in the app.
  ok('nothing else reads the unscoped flips key', !/localStorage\.getItem\('flips'\)/.test(HTML));
  ok('nothing else writes the unscoped flips key', !/localStorage\.setItem\('flips'/.test(HTML));
}

/* ═══════════════════════════════════════════════════════════
   SOL-PLAT-005 — long identities must wrap, not truncate
   ═══════════════════════════════════════════════════════════ */
{
  const card = cssRule('.ft-card');
  ok('.ft-card still exists', !!card);
  ok('.ft-card no longer forces nowrap', !/white-space:nowrap/.test(card));
  ok('.ft-card no longer ellipsises', !/text-overflow:ellipsis/.test(card));
  ok('.ft-card no longer clips overflow', !/overflow:hidden/.test(card));
  ok('.ft-card wraps normally', /white-space:normal/.test(card));
  ok('.ft-card can break inside a long token', /overflow-wrap:anywhere/.test(card));
  ok('.ft-card keeps a readable line-height', /line-height:1\.3/.test(card));
  ok('.ft-card is no longer capped at 160px', !/max-width:160px/.test(card));
  const mw = card.match(/max-width:([\d.]+)rem/);
  ok('.ft-card has a rem-based cap', !!mw);
  ok('.ft-card cap is wider than before', mw && parseFloat(mw[1]) >= 18);
  ok('.ft-card keeps its weight and colour', /font-weight:600/.test(card) && /var\(--text\)/.test(card));

  const set = cssRule('.ft-set');
  ok('.ft-set exists', !!set);
  ok('.ft-set has a minimum width so it cannot collapse', /min-width:9rem/.test(set));
  ok('.ft-set wraps long set names', /overflow-wrap:anywhere/.test(set));
  ok('.ft-set keeps the muted small type', /font-size:\.72rem/.test(set) && /var\(--text-muted\)/.test(set));

  ok('the set cell uses the class, not an inline style',
     /<td class="ft-set">\$\{esc2\(p\.set/.test(HTML));
  ok('the old inline-styled set cell is gone',
     !/<td style="font-size:\.72rem;color:var\(--text-muted\)">\$\{esc2\(p\.set/.test(HTML));
  ok('the set value is still escaped', /class="ft-set">\$\{esc2\(/.test(HTML));
  ok('the em-dash fallback survives', /esc2\(p\.set\|\|'—'\)/.test(HTML));
}

/* ═══════════════════════════════════════════════════════════
   SOL-PLAT-006 — dialog semantics, Escape, focus containment
   ═══════════════════════════════════════════════════════════ */
const OVERLAYS = [
  ['pricingOverlay',   'aria-labelledby="pricingTitle"'],
  ['scanOverlay',      'aria-label="Card scanner"'],
  ['bulkScanOverlay',  'aria-label="Bulk scan"'],
  ['bulkGradeOverlay', 'aria-label="Bulk grade"'],
];
for (const [id, label] of OVERLAYS) {
  const at = HTML.indexOf(`id="${id}"`);
  ok(`${id} exists in the markup`, at !== -1);
  const tag = HTML.slice(HTML.lastIndexOf('<div', at), HTML.indexOf('>', at) + 1);
  // Word-boundary the attribute: data-role="dialog" is not a dialog role.
  ok(`${id} is a dialog`, /(?:^|\s)role="dialog"/.test(tag));
  ok(`${id} is modal`, /aria-modal="true"/.test(tag));
  ok(`${id} is programmatically focusable`, /tabindex="-1"/.test(tag));
  ok(`${id} has an accessible name`, tag.includes(label));
}
ok('the pricing title carries the id its dialog points at',
   /class="pricing-title" id="pricingTitle"/.test(HTML));

/* ── the shared handler ── */
{
  const nc = stripComments(HTML);
  ok('a dialog registry exists', /const _DIALOGS = \{/.test(nc));
  for (const [id] of OVERLAYS) {
    ok(`${id} is registered with a close action`,
       new RegExp(`${id}\\s*:\\s*\\(\\)\\s*=>`).test(nc));
  }
  ok('the registry closes pricing via its real closer', /pricingOverlay:\s*\(\) => closePricingModal\(\)/.test(nc));
  ok('the registry closes the scanner via its real closer', /scanOverlay:\s*\(\) => cancelScan\(\)/.test(nc));
  ok('the registry closes bulk scan via its real closer', /bulkScanOverlay:\s*\(\) => closeBulkScan\(\)/.test(nc));
  ok('the registry closes bulk grade via its real closer', /bulkGradeOverlay:\s*\(\) => closeBulkGrade\(\)/.test(nc));
  // Every registered closer must be a real function.
  for (const fn of ['closePricingModal', 'cancelScan', 'closeBulkScan', 'closeBulkGrade']) {
    ok(`${fn} is defined`, new RegExp(`\\nfunction ${fn}\\(`).test(HTML));
  }
  // Isolate THE dialog listener by brace-matching from its registration, so
  // these checks cannot be satisfied by some other listener in the file.
  const listenAt = nc.indexOf("document.addEventListener('keydown', (e) => {\n  if (e.key !== 'Escape' && e.key !== 'Tab') return;");
  ok('a keydown listener handles Escape and Tab', listenAt !== -1);
  const listener = (() => {
    if (listenAt === -1) return '';
    let i = nc.indexOf('{', nc.indexOf('=>', listenAt)), d = 0;
    for (let j = i; j < nc.length; j++) {
      if (nc[j] === '{') d++;
      else if (nc[j] === '}') { d--; if (d === 0) return nc.slice(listenAt, nc.indexOf(';', j) + 1); }
    }
    return '';
  })();
  ok('the guard is the listener\'s first statement, with nothing short-circuiting it',
     /\(e\) => \{\s*if \(e\.key !== 'Escape' && e\.key !== 'Tab'\) return;/.test(listener));
  ok('the listener body is not dead code', !/=> \{\s*return;/.test(listener));
  ok('Escape closes the dialog', /if \(e\.key === 'Escape'\)[\s\S]{0,160}?_DIALOGS\[el\.id\]\(\)/.test(nc));
  ok('Escape is prevented from doing anything else', /if \(e\.key === 'Escape'\) \{\s*e\.preventDefault\(\)/.test(nc));
  ok('Tab wraps from the last control back to the first',
     /!e\.shiftKey && active === last[\s\S]{0,80}?first\.focus/.test(nc));
  ok('Shift+Tab wraps from the first control back to the last',
     /e\.shiftKey && active === first[\s\S]{0,80}?last\.focus/.test(nc));
  ok('Tab pulls focus in when it is outside the dialog',
     /!el\.contains\(active\)[\s\S]{0,140}?focus/.test(nc));
  ok('the listener is registered in the capture phase so it wins',
     /\}, true\);$/.test(listener.trim()));
}

/* ── the open/close lifecycle really runs ── */
{
  const opens = [
    ['openPricingModal', 'pricingOverlay'],
    ['processScanImage', 'scanOverlay'],
    ['processGradeImage', 'scanOverlay'],
  ];
  for (const [fn, id] of opens) {
    const body = stripComments(grabFn(HTML, fn));
    ok(`${fn} moves focus into ${id}`, body.includes(`_dialogOpened('${id}')`));
  }
  const closes = [
    ['closePricingModal', 'pricingOverlay'],
    ['cancelScan', 'scanOverlay'],
    ['closeBulkScan', 'bulkScanOverlay'],
    ['closeBulkGrade', 'bulkGradeOverlay'],
  ];
  for (const [fn, id] of closes) {
    const body = stripComments(grabFn(HTML, fn));
    ok(`${fn} restores focus to the opener`, body.includes(`_dialogClosed('${id}')`));
  }
  ok('the bulk scan overlay moves focus in when shown',
     /bulkScanOverlay'\);\s*ov\.style\.display = 'flex';\s*_dialogOpened\('bulkScanOverlay'\)/.test(HTML));
  ok('the bulk grade overlay moves focus in when shown',
     /ov\.style\.display = 'flex';\s*_dialogOpened\('bulkGradeOverlay'\)/.test(HTML));
  // The closers must not lose the behaviour they already had.
  ok('closeBulkGrade still revokes object urls',
     /_bulkGradeRevokeAllUrls\(\)/.test(grabFn(HTML, 'closeBulkGrade')));
  ok('closeBulkScan still revokes object urls',
     /revokeObjectURL/.test(grabFn(HTML, 'closeBulkScan')));
  ok('cancelScan still clears the auto-advance timer',
     /_clearScanAutoAdvance\(\)/.test(grabFn(HTML, 'cancelScan')));
  ok('closePricingModal still ignores clicks on its children',
     /evt\.target !== document\.getElementById\('pricingOverlay'\)/.test(grabFn(HTML, 'closePricingModal')));
}

/* ── executable behaviour of the focus helpers ── */
const H = (() => {
  const nc = HTML;
  const src = [
    nc.match(/const _FOCUSABLE = [\s\S]*?;\n/)[0],
    grabFn(nc, '_dialogIsOpen'),
    grabFn(nc, '_dialogFocusables'),
  ].join('\n');
  return new Function(`
    const getComputedStyle = () => ({ zIndex: '0' });
    ${src}
    return { _dialogIsOpen, _FOCUSABLE };
  `)();
})();

// _dialogIsOpen must read the right signal per overlay style.
{
  const classy = (open) => ({
    classList: { contains: (c) => c === 'pricing-overlay' || (c === 'open' && open) },
    style: { display: 'none' },
  });
  eq('a pricing overlay with .open reads as open', H._dialogIsOpen(classy(true)), true);
  eq('a pricing overlay without .open reads as closed', H._dialogIsOpen(classy(false)), false);

  const inline = (d) => ({ classList: { contains: () => false }, style: { display: d } });
  eq('an inline overlay set to flex reads as open', H._dialogIsOpen(inline('flex')), true);
  eq('an inline overlay set to none reads as closed', H._dialogIsOpen(inline('none')), false);
  eq('an inline overlay with no display set reads as closed', H._dialogIsOpen(inline('')), false);
  eq('a missing element reads as closed', H._dialogIsOpen(null), false);
}
// The focusable selector must cover the controls these dialogs actually use
// and must exclude things that cannot take focus.
{
  const sel = H._FOCUSABLE;
  for (const frag of ['a[href]', 'button:not([disabled])', 'input:not([disabled])',
                      'select:not([disabled])', 'textarea:not([disabled])']) {
    ok(`the focusable selector includes ${frag}`, sel.includes(frag));
  }
  ok('the focusable selector excludes tabindex="-1"', sel.includes('[tabindex]:not([tabindex="-1"])'));
  ok('the focusable selector does not naively match every element', !/^\*/.test(sel));
}

/* ── aria-live on the surfaces that change without user action ── */
for (const id of ['scanStatus', 'bulkProgressLabel', 'bulkGradeProgressLabel']) {
  const at = HTML.indexOf(`id="${id}"`);
  ok(`${id} exists`, at !== -1);
  const tag = HTML.slice(at, HTML.indexOf('>', at) + 1);
  ok(`${id} is announced politely`, /aria-live="polite"/.test(tag));
  ok(`${id} is not announced assertively`, !/aria-live="assertive"/.test(tag));
}

/* ═══════════════════════════════════════════════════════════
   SOL-PLAT-009 — 44x44 minimum touch targets at 375px
   ═══════════════════════════════════════════════════════════ */
{
  // Find the mobile block that carries the new minimums. Strip comments first,
  // and anchor on the block's own opening brace -- a lazy match from any
  // @media swallowed the preceding one-line query and made the rule count
  // meaningless.
  const cleanCss = stripComments(HTML);
  // Comment stripping leaves the whitespace behind, so match tolerantly.
  const startM = cleanCss.match(/@media\(max-width:480px\)\{\s*\.hdr button:not\(\.settings-btn\)/);
  const start = startM ? startM.index : -1;
  ok('the 44px mobile block is its own @media block', start !== -1);
  const block = start === -1 ? '' : cleanCss.slice(start, cleanCss.indexOf('\n}', start) + 2);
  ok('a 480px block declares the 44px minimums', !!block);
  const b = block || '';
  const REQUIRED = [
    ['.hdr button:not(.settings-btn):not(#shopBtn)', 'header buttons (Upgrade was 81.9x29)'],
    ['.hdr a', 'header links (Sign In was 57.8x30.6)'],
    ['.scan-sub-btn', 'scan sub buttons (ID Scan was 112.7x35.5)'],
    ['.game-select', 'the game selector (was 178x34.6)'],
    ['.venues-btn', 'the venues button (was 120.2x34.6)'],
    ['.vc-edit', 'the collection edit control (was 28.4x24.4)'],
    ['#tryExampleBtn', 'Try Charizard (was 118.7x27.4)'],
  ];
  for (const [sel, why] of REQUIRED) {
    ok(`the mobile block sizes ${why}`, b.includes(sel));
  }
  // Every selector named must resolve against real markup, so none of these
  // rules is styling a class that does not exist.
  ok('.hdr is a real element the rule can descend from', HTML.includes('class="hdr"'));
  ok('.hdr contains buttons to size', /class="hdr"[\s\S]{0,3000}?<button/.test(HTML));
  // Shop and Settings keep the CR-021 hit-box treatment instead of growing.
  ok('the header rule exempts the icon-only controls',
     b.includes('.hdr button:not(.settings-btn):not(#shopBtn)'));
  ok('the CR-021 hit box for those two is still in place',
     /\.hdr \.settings-btn::after,#shopBtn::after\{content:'';position:absolute;inset:-7px/.test(HTML));
  ok('the hit-box inset still yields 44px from a 30px box', 30 + 7 * 2 === 44);
  ok('.hdr contains links to size', /class="hdr"[\s\S]{0,3000}?<a /.test(HTML));
  for (const cls of ['scan-sub-btn', 'game-select', 'venues-btn', 'vc-edit']) {
    ok(`.${cls} is used in the markup or a template`, HTML.includes(cls + '"') || HTML.includes(cls + ' '));
  }
  ok('#tryExampleBtn is a real element id', HTML.includes('id="tryExampleBtn"'));
  // Icon-only controls get a hit box, not a bigger glyph.
  ok('the promo close gets a 44px hit box', b.includes('.promo-banner-close'));
  ok('the pricing close gets a 44px hit box', b.includes('.pricing-close'));
  ok('icon hit boxes are centred so the glyph stays put',
     /min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center/.test(b));
  ok('the close-button rule names classes that exist',
     HTML.includes('class="promo-banner-close"') && HTML.includes('class="pricing-close"'));
  // No selector invented out of thin air.
  for (const ghost of ['.ov-close', '.promo-close{']) {
    ok(`the block does not reference the nonexistent ${ghost}`, !b.includes(ghost));
  }
  // Every rule in the block must actually set a 44px dimension -- no rule
  // sneaking in that only changes padding.
  const inner = b.replace(/^@media\(max-width:480px\)\{/, '').replace(/\}\s*$/, '');
  const rules = inner.match(/[^{}]+\{[^}]*\}/g) || [];
  const sized = rules.filter(r => /min-height:44px|min-width:44px/.test(r));
  eq('every rule in the block sets a 44px dimension', sized.length, rules.length);
  ok('the block covers at least seven selector groups', rules.length >= 7);
}

/* ═══════════════════════════════════════════════════════════
   SOL-PLAT-008 — no non-standard appearance keyword
   ═══════════════════════════════════════════════════════════ */
ok('appearance:slider-vertical is gone', !/appearance:slider-vertical/.test(HTML));
ok('the -webkit- prefixed form is gone', !/-webkit-appearance:slider-vertical/.test(HTML));
ok('the standards-based vertical range styling is kept',
   (HTML.match(/writing-mode:vertical-lr;direction:rtl/g) || []).length === 2);
ok('both zoom sliders still exist',
   HTML.includes('id="liveCapZoomSlider"') && HTML.includes('id="bulkRapidZoomSlider"'));
ok('both zoom sliders still declare a vertical orientation',
   (HTML.match(/orient="vertical"/g) || []).length === 2);

/* ── analytics must not compete with startup ── */
{
  ok('the insights probe waits for load',
     /window\.addEventListener\('load', \(\) => setTimeout\(_loadInsights, 0\), \{ once: true \}\)/.test(HTML));
  ok('an already-loaded page still gets analytics',
     /if \(document\.readyState === 'complete'\) setTimeout\(_loadInsights, 0\)/.test(HTML));
  ok('the defensive content-type probe is retained',
     /javascript\|ecmascript/.test(HTML));
  ok('the probe is still wrapped so analytics cannot break the app',
     /_loadInsights\(\) \{\s*\n\s*try \{/.test(HTML));
}

/* ═══════════════════════════════════════════════════════════
   SOL-PLAT-010 — the annual claim must match the arithmetic
   ═══════════════════════════════════════════════════════════ */
{
  // Recompute from the prices the page actually renders.
  const annualDiscount = (monthly, annual) => 1 - annual / (monthly * 12);
  const freeMonths = (monthly, annual) => 12 - annual / monthly;

  near('Pro annual saves ~24.93%', annualDiscount(9.99, 89.99), 0.24933, 0.0001);
  near('Pro Max annual saves ~24.97%', annualDiscount(19.99, 179.99), 0.24966, 0.0001);
  // "3 months free" would require 9 monthly payments exactly.
  near('Pro annual equals ~2.99 months free', freeMonths(9.99, 89.99), 2.9920, 0.001);
  near('Pro Max annual equals ~3.00 months free', freeMonths(19.99, 179.99), 2.9960, 0.001);
  ok('Pro annual is short of a true 3 months free', freeMonths(9.99, 89.99) < 3);
  ok('Pro Max annual is short of a true 3 months free', freeMonths(19.99, 179.99) < 3);
  // The shortfall is 8 cents at both tiers -- more than a nickel, so the claim
  // could not stay.
  near('the Pro shortfall is 8 cents', 89.99 - 9.99 * 9, 0.08, 0.001);
  near('the Pro Max shortfall is 8 cents', 179.99 - 19.99 * 9, 0.08, 0.001);
  // Both annual figures round to 25%, so "about 25%" is true at both tiers.
  ok('both tiers round to 25%',
     Math.round(annualDiscount(9.99, 89.99) * 100) === 25 &&
     Math.round(annualDiscount(19.99, 179.99) * 100) === 25);

  ok('the overstated claim is gone everywhere', !/3 months free/i.test(HTML));
  ok('the annual banner now claims about 25%', /save about 25%<\/strong>/.test(HTML));
  ok('both annual notes now claim about 25%',
     (HTML.match(/save about 25%/g) || []).length >= 3);
  ok('the SAVE 25% badge is unchanged', /SAVE 25%/.test(HTML));
  // Prices themselves must not have moved.
  for (const p of ['$9.99', '$89.99', '$19.99', '$179.99', '$7.50/mo', '$15/mo']) {
    ok(`the rendered price ${p} is unchanged`, HTML.includes(p));
  }
  ok('the annual prices were not quietly rewritten',
     !HTML.includes('$89.91') && !HTML.includes('$179.91'));
}

/* ── protected areas and standing copy rules ── */
ok('the retired Ultimate tier is still not purchasable', !/startTierCheckout\('ultimate'\)/.test(HTML));
ok('no maintenance wording', !/maintenance/i.test(HTML));
ok('no beta wording', !/\bbeta\b/i.test(HTML));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  for (const x of fails) console.log('  ✗ ' + x);
  process.exit(1);
}
