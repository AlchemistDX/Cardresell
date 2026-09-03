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

  check('a market price wildly off the ask book falls back to the blend',
        /M > D \* 3 \|\| M < D \/ 3/.test(code),
        'the sanity valve catches stale or erroneous market prices');
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
