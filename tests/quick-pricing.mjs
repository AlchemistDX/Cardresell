// Quick Pricing widget + headline price guard. Added 2026-09-03.
//
// Two things are pinned here.
//
// 1. The headline price is the MARKET price (completed sales), not a blend of
//    the sale price with the active-ask statistics. The old blend published
//    $424.90 for Base Set 2 Charizard whose own market figure was $500.12 --
//    $75 under, which is what made the after-fee payouts look wrong.
//
// 2. The Quick Pricing widget never promises a timeline. StockX can say "Sell
//    Faster" because it holds the bid side of an order book. We do not, and no
//    venue we price against publishes time-to-sell (see
//    audit/SELL_VELOCITY_RESEARCH.md). So every tier is named for where the
//    price sits in the ask book, and there is no day-count anywhere near it.

import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tcgPrice = readFileSync(new URL('../api/tcg-price.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
function check(label, cond, hint) {
  if (cond) { console.log('  \u2713 ' + label); passed++; }
  else { console.log('  \u2717 ' + label + (hint ? '\n      ' + hint : '')); failed++; }
}

console.log('\n[Headline price]');
{
  const code = tcgPrice.replace(/\/\*[\s\S]*?\*\//g, '');

  check('the headline comes from _headlinePrice, not the ask blend',
        /const displayMarket = _headlinePrice\(/.test(code),
        'reverting to _trimmedMean re-publishes $424.90 on a $500.12 card');

  check('_headlinePrice returns the market price when it is sane',
        /return Math\.round\(M \* 100\) \/ 100;/.test(code),
        'the sale price must be published verbatim, not averaged with asks');

  check('the blend survives as the no-market fallback',
        /if \(M == null\) return _trimmedMean\(/.test(code),
        'cards without a market price still need a number');

  // 2026-09-03 REVERSED. This used to assert the ask-blend fallback fired when
  // Market disagreed with the median ask by >3x. The audit showed the valve's
  // premise is wrong on thin vintage books: there are no recent sales, so
  // holdout asks sit far above the last real transaction and the valve
  // published those asks as a sale price. Product 84198 (Charizard Star #100)
  // served a $19,800 headline off a $1,000 marketPrice. Market and asks are
  // different quantities; the gap is now disclosed, not substituted.
  check('a market/ask disagreement no longer swaps in the ask blend',
        !/M > D \* 3 \|\| M < D \/ 3/.test(code),
        'publishing the ask book as Market overstated one card by 19.8x');

  check('the market/ask gap is surfaced instead of silently applied',
        /_marketAskDivergence/.test(code),
        'removing the valve must not also remove the warning signal');
}

console.log('\n[Quick Pricing — honest labelling]');
{
  // Isolate the widget markup so a day-count elsewhere in the file can't
  // mask a regression here, and vice versa.
  const mStart = index.indexOf('<div id="quickPricing"');
  const mEnd   = index.indexOf('</div>', index.indexOf('id="qpRows"'));
  const markup = index.slice(mStart, mEnd);
  check('the widget markup was found', mStart > 0 && mEnd > mStart);

  const fStart = index.indexOf('function _qpTiers(');
  const fEnd   = index.indexOf('function updatePriceFromPrinting()');
  const logic  = index.slice(fStart, fEnd);
  check('the widget logic was found', fStart > 0 && fEnd > fStart);

  const zone = markup + logic;

  // The core rule. No day counts, no sell-through, no "sells in".
  check('no day-count claim anywhere in the widget',
        !/\b\d+\s*[-\u2013]?\s*\d*\s*days?\b/i.test(zone),
        'no venue publishes time-to-sell; a day range here would be invented');

  check('no sell-through or velocity claim',
        !/sell[-\s]?through|velocity|days? to (cash|sell)|typically sells/i.test(zone),
        'same rule: we do not have this data for any venue');

  check('the tier labels describe the price, not a promised speed',
        /label:'Sell Now'/.test(logic) &&
        /label:'Market'/.test(logic) &&
        /label:'Top of Book'/.test(logic),
        "'Sell Faster' would promise a timeline we cannot support");

  check('no "beta" anywhere in the widget',
        !/beta/i.test(zone));

  check('the info panel states we do not estimate timelines',
        /No marketplace publishes/i.test(markup) &&
        /don&#8217;t estimate it|do not estimate it/i.test(markup),
        'the caveat is the thing that makes the tier names honest');
}

console.log('\n[Quick Pricing — tier derivation]');
{
  const fStart = index.indexOf('function _qpTiers(');
  const logic  = index.slice(fStart, index.indexOf('function renderQuickPricing()'));

  check('Sell Now is derived from the lowest ask, not invented',
        /id:'now'/.test(logic) && /low - step/.test(logic),
        'the undercut must be computed from a real listing price');

  check('the undercut is visible at the precision we display',
        /const step = low < 100 \? 0\.01 : 1;/.test(logic),
        'a $0.01 undercut on a $2450 card rendered as "$2,450" -- same as the ' +
        'Lowest listing row, two different numbers displayed identically');

  check('Sell Now is suppressed when the low ask is not below market',
        /low != null && market != null && low < market/.test(logic),
        'undercutting above the last sale is not a fast sale');

  check('Top of Book is suppressed unless meaningfully above market',
        /mid > market \* 1\.02/.test(logic),
        'a third tier within a rounding error of market is the same number twice');

  const render = index.slice(index.indexOf('function renderQuickPricing()'),
                             index.indexOf('function qpApply('));
  check('fewer than two tiers hides the widget',
        /tiers\.length < 2/.test(render) && /display = 'none'/.test(render),
        'one price is not a choice between prices');

  check('the marker position is clamped to the bar',
        /Math\.max\(0, Math\.min\(100,/.test(render),
        'a typed price outside the scale must not push the marker off the bar');
}

console.log('\n[Quick Pricing — wiring]');
{
  check('the widget re-renders whenever payouts recompute',
        /try \{ renderQuickPricing\(\); \} catch\(_\) \{\}/.test(index),
        'the selected-tier highlight tracks the price field');

  check('applying a tier marks the price as user-chosen',
        /window\._ovAutoFilled = false;[\s\S]{0,40}calc\(\);/.test(
          index.slice(index.indexOf('function qpApply('), index.indexOf('function toggleQpInfo('))),
        'a deliberately chosen price must be used verbatim, not re-adjusted for condition');

  check('the widget uses its own escaper',
        /function _qpEsc\(/.test(index) &&
        (index.match(/function _esc\(/g) || []).length === 1,
        'a duplicate _esc declaration silently wins or loses depending on block order');

  check('the info toggle keeps aria-expanded in sync',
        /setAttribute\('aria-expanded', String\(open\)\)/.test(index));
}

// ---------------------------------------------------------------------------
// 2026-09-03: Quick Pricing must follow the GRADE selector.
//
// Reported with a screenshot: selecting PSA 10 repainted the headline to the
// graded guide value ($161.25 on Cresselia #71) while Quick Pricing kept
// showing $23.44 / $26.49 / $29.14 and the position bar stayed pinned to the
// raw book -- the raw TCGplayer numbers, rendered underneath a graded price.
//
// renderQuickPricing() was firing correctly all along (calc() calls it, and
// the graded tail of updatePriceFromPrinting() calls calc()). The defect was
// that _qpBasis() returned window._crBasis -- the RAW ladder basis --
// unconditionally, without consulting the grade selector.
// ---------------------------------------------------------------------------
{
  const qpBasis = index.slice(index.indexOf('function _qpBasis()'),
                              index.indexOf('function _qpTiers('));

  check('_qpBasis checks the grade selector',
        /isGradedVariant\(/.test(qpBasis),
        '_qpBasis must branch on the selected printing being a graded slab');

  check('_qpBasis reads the graded row, not the raw ladder basis',
        /currentPrices\[_gk\]/.test(qpBasis),
        'a graded selection must source its own price row');

  // Compare CODE positions only -- the explanatory comment in _qpBasis names
  // window._crBasis while describing the bug, which would fool a raw indexOf.
  const qpBasisCode = qpBasis.replace(/\/\/[^\n]*/g, '');
  check('the graded branch runs BEFORE the _crBasis shortcut',
        qpBasisCode.indexOf('isGradedVariant(') < qpBasisCode.indexOf('window._crBasis'),
        'if _crBasis is read first, every graded selection renders raw numbers');

  check('the graded basis is tagged so the renderer can explain itself',
        /graded:\s*true/.test(qpBasis));

  // A slab has one guide value per grade (low == mid == market), so the tier
  // builder collapses to a single tier. Rather than vanishing -- which reads
  // as a glitch -- the panel keeps its heading and states why there is no
  // spread to choose from. Fabricating a Sell Now / Top of Book around a
  // single guide value would be inventing a listing book that does not exist.
  // 2026-09-04: the gate was `basis.graded && tiers.length < 2`. Once the
  // derived band became universal a slab HAS three tiers, so that gate stopped
  // matching and the graded branch (which draws the grade ladder) was skipped
  // entirely. Graded now takes the branch unconditionally.
  check('a graded slab explains itself instead of silently vanishing',
        /if \(basis && basis\.graded\) \{/.test(index) &&
        /id="qpGradedNote"/.test(index));
  check('the graded branch is not gated on the tier count',
        !/basis\.graded && tiers\.length < 2/.test(index),
        'a slab has three derived tiers, so a <2 gate skips the ladder');

  check('the graded note hides the tiers AND the position bar',
        /const showStrategy = \(on\) =>/.test(index) &&
        /qpBarWrap/.test(index) &&
        /showStrategy\(false\)/.test(index),
        'leaving the bar visible on a slab re-creates the reported bug');

  check('the strategy view is restored for non-graded prices',
        /showStrategy\(true\)/.test(index));

  check('the graded note never promises a timeline',
        !/\b(days?|weeks?|hours?)\b/i.test(
          (/note\.textContent = ([\s\S]*?);\n/.exec(index) || [,''])[1]),
        'no venue publishes time-to-sell -- see audit/SELL_VELOCITY_RESEARCH.md');

  // The headline caption must name the feed the NUMBER came from. The
  // screenshot showed a PriceCharting graded value stamped "TCGPlayer market",
  // which sends the user to verify $161.25 on a site that does not list it.
  check('the headline caption is sourced from the rendered row',
        /srcMap\[p\?\.source\]/.test(index),
        'captioning from selectedCard.source mislabels graded prices');

  check('pricecharting maps to an honest caption',
        /pricecharting: 'PriceCharting guide value'/.test(index));
}

// ---------------------------------------------------------------------------
// 2026-09-03 (second defect, found by verifying on production): calc() has
// several exit paths and only ONE of them refreshed Quick Pricing.
//
// The single renderQuickPricing() call sat at the very bottom of calc(), past
// the free/Pro branch's early `return`. That branch is the one most accounts
// take, so on those tiers the widget never re-rendered after a basis change --
// the raw tiers and position bar stayed frozen under a graded headline even
// though _qpBasis() was returning the correct graded basis. Fixing _qpBasis
// alone was NOT enough; the render had to actually run.
// ---------------------------------------------------------------------------
{
  const calcBody = index.slice(index.indexOf('function calc()'),
                               index.indexOf('function setSort('));
  const renders = (calcBody.match(/renderQuickPricing\(\)/g) || []).length;

  check('calc() refreshes Quick Pricing on more than one exit path',
        renders >= 3,
        `only ${renders} renderQuickPricing() call(s) in calc() -- the free/Pro `
        + 'early return and the no-price return each need their own');

  check('the no-usable-price exit refreshes too',
        /showIntro\(\);[\s\S]{0,400}?renderQuickPricing\(\)[\s\S]{0,40}?return;/.test(calcBody),
        'otherwise the previous card\u2019s tiers linger under a new card');

  const upfp = index.slice(index.indexOf('function updatePriceFromPrinting()'),
                           index.indexOf('function isGradedVariant('));
  check('updatePriceFromPrinting refreshes on every exit',
        (upfp.match(/renderQuickPricing\(\)/g) || []).length >= 2,
        'the printing/grade selector changes the BASIS, not a fee input');

  check('the grade dropdown itself triggers a refresh',
        /id="gradeSelect"[^>]*renderQuickPricing\(\)/.test(index),
        'reported symptom was switching grades leaving the bar unchanged');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
