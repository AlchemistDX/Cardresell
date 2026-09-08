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

import { readAppSource } from './_appsource.mjs';
import { readCoreBundle } from './_assetRefs.mjs';
const index = readAppSource();
const tcgPrice = readFileSync(new URL('../api/tcg-price.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
function check(label, cond, hint) {
  // A Promise is never a truth value. `(async () => {...})()` is always
  // truthy, so passing one here asserts nothing while printing ok — we
  // shipped two of those. Make the whole category impossible, loudly.
  if (cond && typeof cond.then === 'function') {
    failed++;
    console.log(`  FAIL ${label}\n       → TEST_API_MISUSE: a Promise is not a truth value; await it or use checkAsync()`);
    return;
  }

  if (cond) { console.log('  \u2713 ' + label); passed++; }
  else { console.log('  \u2717 ' + label + (hint ? '\n      ' + hint : '')); failed++; }
}
/** For assertions whose condition is async. Awaits, then asserts. */
async function checkAsync(label, thunk, hint) {
  let v;
  try { v = await (typeof thunk === 'function' ? thunk() : thunk); }
  catch (e) { v = false; hint = `threw: ${e.message}`; }
  return check(label, !!v, hint);
}


console.log('\n[Headline price]');
{
  const code = tcgPrice.replace(/\/\*[\s\S]*?\*\//g, '');

  // 2026-09-07 RETARGETED (Q3-C). These three used to pin the old bare-number
  // return shape:
  //   /const displayMarket = _headlinePrice\(/
  //   /return Math\.round\(M \* 100\) \/ 100;/
  //   /if \(M == null\) return _trimmedMean\(/
  // _headlinePrice now returns { value, basis } so the two branches -- a
  // completed sale vs an aggregate of active asks -- are distinguishable by a
  // consumer. Before the basis existed there was no field in which that
  // difference could be represented, and every reader defaulted to the more
  // authoritative of the two (pattern instance 22). The behaviour each of these
  // three protects is unchanged; only the shape carrying it moved.
  check('the headline comes from _headlinePrice, not the ask blend',
        /const _head = _headlinePrice\(/.test(code)
          && /const displayMarket = _head\.value;/.test(code),
        'reverting to _trimmedMean re-publishes $424.90 on a $500.12 card');

  check('_headlinePrice returns the market price when it is sane',
        /return \{ value: Math\.round\(M \* 100\) \/ 100, basis: 'sales' \};/.test(code),
        'the sale price must be published verbatim, not averaged with asks');

  check('the blend survives as the no-market fallback',
        /if \(M == null\) \{/.test(code)
          && /const blended = _trimmedMean\(/.test(code),
        'cards without a market price still need a number');

  check('the ask blend is labelled as an ask blend, not as a sale',
        /basis: blended == null \? null : 'ask_blend'/.test(code),
        'the code says market and asks must never be relabelled as each other');

  /* RETIRED 2026-09-08 by Q7 option (iii).
     This used to assert that the spread synthesizers fired only around an
     observed centre:
         const _spreadOk = _head.basis === 'sales';
         low:  ... _spreadOk ? displayMarket * 0.85 : null
         high: ... _spreadOk ? displayMarket * 1.15 : null
     That was the Q3-C narrowing, and it was correct for the defect it targeted
     -- a 0.85 floor taken off an ask blend published `low` ABOVE `mid`, so the
     "Lowest listing" row rendered above the median ask.

     Q7 deleted both synthesizers outright, so `_spreadOk` no longer exists and
     this assertion can only fail. It is not re-pointed at the new code, because
     the thing worth asserting is no longer "the guard is correct" but "there is
     nothing to guard" -- and that is asserted in the Q7 integration block
     below, together with the reason the guard was never the weak part: the
     client inferred provenance from value presence, so a correctly-tagged
     derived endpoint was relabelled as provider data on arrival.

     The inversion this protected against is now unreachable by construction:
     no centre-derived endpoint is published at all. */
  check('no spread is synthesized around any centre, observed or not',
        !/_spreadOk/.test(code.replace(/\/\*[\s\S]*?\*\//g, '')),
        'Q7 removed the synthesizers; a reintroduced guard means a reintroduced spread');

  check('each published endpoint carries its origin',
        /marketBasis: _head\.basis/.test(code)
          && /lowBasis:/.test(code) && /highBasis:/.test(code),
        'a derived endpoint must not render under a label asserting observation');

  // 2026-09-07 (Q3-C). BEHAVIOURAL, not textual. Every assertion above greps
  // source text, and the inversion this protects against was live for the whole
  // period they were green -- a published `low` 42% ABOVE `mid`. None of them
  // could have caught it, because none of them ran the function. This one runs
  // the real _headlinePrice / _trimmedMean / _clampHighPriceInPlace over the
  // input range and asserts the ORDERING the seller sees.
  //
  // Extraction notes, both bugs found the hard way: brace-matching from
  // `function <name>` closes on the DESTRUCTURED PARAMETER LIST and yields a
  // one-line fragment, so walk the parameter parens to their match first. And
  // under ESM (strict mode) eval'd function declarations never reach module
  // scope -- use new Function(code + 'return {...}').
  {
    const grab = (name) => {
      const i = tcgPrice.indexOf('function ' + name);
      if (i < 0) return null;
      let p = tcgPrice.indexOf('(', i), pd = 0, close = -1;
      for (let k = p; k < tcgPrice.length; k++) {
        if (tcgPrice[k] === '(') pd++;
        else if (tcgPrice[k] === ')') { pd--; if (!pd) { close = k; break; } }
      }
      let d = 0; const j = tcgPrice.indexOf('{', close);
      for (let k = j; k < tcgPrice.length; k++) {
        if (tcgPrice[k] === '{') d++;
        else if (tcgPrice[k] === '}') { d--; if (!d) return tcgPrice.slice(i, k + 1); }
      }
      return null;
    };
    const names = ['_isSentinelPrice', '_trimmedMean', '_headlinePrice', '_clampHighPriceInPlace'];
    const bodies = names.map(grab);
    check('the pricing functions are extractable for behavioural testing',
          bodies.every(b => b && b.split('\n').length > 2),
          'a one-line body means the brace matcher closed on the parameter list');

    if (bodies.every(Boolean)) {
      const pre = 'const _PRICE_SENTINELS = new Set([99999, 999999, 99999.99]);'
                + ' const _HIGH_CAP_MULT = 3.0;';
      const F = new Function(pre + '\n' + bodies.join('\n')
                             + '\nreturn {' + names.join(',') + '};')();
      const publish = (r) => {
        const head = F._headlinePrice({ low: r.low, market: r.market, mid: r.mid, high: r.high });
        const dm = head.value;
        const ok = head.basis === 'sales';
        const data = {
          market: dm,
          low:  r.low  ?? (ok ? dm * 0.85 : null),
          mid:  r.mid  ?? dm,
          high: r.high ?? (ok ? dm * 1.15 : null),
        };
        F._clampHighPriceInPlace(data);
        return data;
      };

      // The measured case: upstream omitted marketPrice and low, mid 100 /
      // high 300. Published low $141.67 against mid $100.00 and rendered
      // "Lowest listing $141.67" -- a floor 42% above the median ask.
      const m = publish({ low: null, market: null, mid: 100, high: 300 });
      check('the measured inversion case publishes no floor at all',
            m.low === null,
            'a 0.85 floor off an ask blend that already contains the high ask');
      check('the ask-blend centre is still published',
            m.market === 166.67,
            'withholding the spread must not withhold the headline');

      // Whole inversion band, 1.53x mid < high <= 3.0x mid, plus both sides of
      // _HIGH_CAP_MULT. The guard BOUNDS this defect rather than catching it
      // (pattern instance 23), so the sweep must cross 3.0x deliberately.
      let inverted = 0;
      for (let h = 100; h <= 600; h++) {
        const d = publish({ low: null, market: null, mid: 100, high: h });
        if (d.low != null && d.mid != null && d.low > d.mid) inverted++;
      }
      check('no derived-centre input publishes low above mid',
            inverted === 0,
            `${inverted} of 501 high values invert the published range`);

      // An observed centre keeps its band -- roadmap Q7 is still open and this
      // change deliberately does not answer it.
      const q7 = publish({ low: null, market: 110, mid: 100, high: 300 });
      check('an observed centre still carries its derived band',
            q7.low === 93.5,
            'this change withholds around a derived centre only, not everywhere');
    }
  }

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

  // Anchor the slice to the next function (_qpReapplyChosenTier now sits
  // between qpApply and toggleQpInfo) and assert ORDER rather than character
  // distance -- the old /[\s\S]{0,40}/ window broke the moment a comment or
  // an extra assignment was added between the flag and the recalc.
  {
    const qa = index.slice(index.indexOf('function qpApply('),
                           index.indexOf('function _qpReapplyChosenTier'));
    check('applying a tier marks the price as user-chosen',
          qa.indexOf('window._ovAutoFilled = false;') !== -1 &&
          qa.indexOf('calc();') > qa.indexOf('window._ovAutoFilled = false;'),
          'a deliberately chosen price must be used verbatim, not re-adjusted for condition');

    // 2026-09-04: the tier ID must be recorded BEFORE calc() runs, so a
    // condition change can re-derive the same strategy at the new condition.
    check('applying a tier records which tier it was',
          qa.indexOf('window._qpChosenTier = tierId || null;') !== -1 &&
          qa.indexOf('calc();') > qa.indexOf('window._qpChosenTier = tierId || null;'),
          'without the id, a tile choice goes stale when the condition changes');
  }

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


// ── Q3-C client: the Lowest-listing row, exercised as BEHAVIOUR ──────────────
// 2026-09-07. The three assertions that previously pinned this copy
// (tests/copy-truth-offline.mjs and tests/draft-review-screen.mjs) all pass
// against a build where the guarding logic is deleted, because they grep for the
// string "Lowest listing" and the string is still in the file. That is instance
// 1 of audit/PATTERN_ASSERTION_SURFACE.md: an assertion that names a behaviour
// and evidences a surface. This block extracts the real row builder out of the
// live bundle and runs it, so the assertion fails when the behaviour changes.
{
  /* CHANGED 2026-09-07 (D3 closeout). Was:

         const core = readAppSource('js/core.7f9c03ad.js');

     A hardcoded content-addressed filename. The D3 rename repointed
     index.html to core.24cd52cb.js and left 7f9c03ad.js on disk as a retired
     copy -- deliberately, because vercel.json serves /js/* immutable. So this
     line kept reading a file that still existed, still parsed, and was no
     longer the app. It would have gone on passing while asserting against
     bytes the browser never loads, and the block's own comment above explains
     that its whole purpose is to test the LIVE bundle rather than grep a
     string. Found by grepping for the retired name after the rename, not by a
     failure, because there is no failure to find.

     resolveCoreBundle reads index.html, treats zero and two matches as errors,
     and therefore cannot silently pick the retired file. */
  const core = readCoreBundle().source;
  const i = core.indexOf('const _lowIsObserved');
  const j = core.indexOf('if (basis.market != null)', i);
  check('the row builder is still locatable in the bundle',
        i !== -1 && j > i,
        'if this fails the extraction below is silently testing nothing');

  const rowFn = new Function('basis', 'condMult', 'fmt', 'rows',
                             core.slice(i, j) + '; return rows;');
  const money = (v) => '$' + v.toFixed(2);
  const label = (basis) => {
    const r = rowFn(basis, 1, money, []);
    return r.length ? r[0][0] : null;   // null === row withheld
  };

  // Condition (1): provenance decides the NAME.
  check('an observed floor is called a listing',
        label({ low: 80, mid: 100, lowBasis: 'observed' }) === 'Lowest listing',
        'the healthy path must keep its plain name');

  check('a DERIVED floor is not called a listing',
        label({ low: 80, mid: 100, lowBasis: 'derived' }) === 'Estimated low',
        'no listing exists at a synthesized price, so listing language is a lie');

  // Condition (2): the relation decides whether it is a floor AT ALL, and this
  // must hold on OBSERVED endpoints too -- that is the whole point of it being
  // a separate condition. If someone folds (2) into (1), this is the assertion
  // that fails.
  check('an observed floor above the median ask is withheld, not relabelled',
        label({ low: 255, mid: 100, lowBasis: 'observed' }) === null,
        'a floor above an observed ask is not a floor; T2.10, healthy path');

  check('a derived floor above the median ask is also withheld',
        label({ low: 255, mid: 100, lowBasis: 'derived' }) === null,
        'both conditions can fire at once and the row must still vanish');

  check('no low means no row',
        label({ low: null, mid: 100, lowBasis: null }) === null,
        'baseline -- guards must not invent a row');

  check('an observed floor with no median ask keeps its name',
        label({ low: 80, mid: null, lowBasis: 'observed' }) === 'Lowest listing',
        'condition (2) cannot be evaluated without mid, so provenance alone '
        + 'decides; an observed low IS a real listing, so the name is true');

  // Condition (3) lives at the basis, not in this function. Assert it there so
  // nobody "tidies" it into the row builder, where it would be keyed off the
  // wrong provenance field.
  check('datedBySource is derived from marketBasis, not hardcoded',
        /datedBySource:\s*tcg\.marketBasis === 'sales'/.test(core),
        'it is a claim about the CENTRE, so centre provenance is its input');

  check('the row builder does not read marketBasis',
        !/marketBasis/.test(core.slice(i, j)),
        'keying the row off centre provenance leaves it mislabelled on the '
        + 'healthy path -- the exact defect this change fixes');
}


/* ══ Q7 option (iii): a range renders only when one was measured ════════════
   The decision this covers replaced "synthesize a low and a high so the comp
   doesn't look lonely" with "show the comp alone and say so". The gate is one
   function, `_crMeasuredRange`, and it is extracted from the live bundle and
   run rather than grepped, because "the synthesizer is gone" is a claim about
   a surface while "a malformed pair does not render" is a claim about
   behaviour -- instance 1 of audit/PATTERN_ASSERTION_SURFACE.md.
   (This cited a nonexistent "instance 30" until 2026-09-08.) */
{
  console.log('\n[Q7 — measured range gate]');
  const core = readCoreBundle().source;
  const i = core.indexOf('const _CR_MEASURED_ORIGINS');
  const j = core.indexOf('const _CR_NO_RANGE_NOTE');
  check('the range gate is locatable in the bundle', i !== -1 && j > i,
        'if this fails every assertion below is testing nothing');
  const gate = new Function(core.slice(i, j) + '; return _crMeasuredRange;')();

  const O = 'tcgplayer';
  // The five cases named in the acceptance list, plus the three the gate exists
  // to catch that a low/high enumeration would miss.
  const cases = [
    ['both endpoints, one origin',   { low: 10, high: 40, lowBasis: O, highBasis: O }, true,  null],
    ['neither endpoint',             { lowBasis: O, highBasis: O },                    false, 'no-endpoints'],
    ['low only',                     { low: 10, lowBasis: O },                         false, 'low-only'],
    ['high only',                    { high: 40, highBasis: O },                       false, 'high-only'],
    ['reversed',                     { low: 40, high: 10, lowBasis: O, highBasis: O }, false, 'reversed'],
    ['mixed origin',                 { low: 10, high: 40, lowBasis: O, highBasis: 'ebay-sold' }, false, 'mixed-origin'],
    ['unattributed',                 { low: 10, high: 40 },                            false, 'unattributed'],
    ['derived endpoint',             { low: 10, high: 40, lowBasis: 'derived', highBasis: 'derived' }, false, 'derived-endpoint'],
    ['equal endpoints',              { low: 40, high: 40, lowBasis: O, highBasis: O }, false, 'degenerate'],
  ];
  for (const [name, input, wantOk, wantWhy] of cases) {
    const r = gate(input);
    check(`Q7: ${name} ${wantOk ? 'renders as a range' : 'does not render as a range'}`,
          r.ok === wantOk, `got ${JSON.stringify(r)}`);
    if (!wantOk) {
      check(`Q7: ${name} is refused as "${wantWhy}", not lumped in with the rest`,
            r.why === wantWhy,
            `distinct reasons are the only way to tell a provider that sent `
            + `nothing from one that sent something wrong; got "${r.why}"`);
    }
  }

  // The negative rule, stated directly. A synthesized band is symmetric about
  // the comp by construction, so if symmetry were ever treated as evidence the
  // gate would authenticate exactly what it was built to reject.
  check('Q7: symmetry about a comp is NOT accepted as provenance',
        gate({ low: 85, high: 115, market: 100 }).ok === false,
        'a -15%/+15% pair is the shape of the fabrication, not of a measurement');
  check('Q7: an untagged pair is refused before it is range-checked',
        gate({ low: 10, high: 40 }).why === 'unattributed',
        'a well-formed untagged pair must not pass on the strength of looking tidy');

  // Zero and negatives are absent values, not small ones.
  check('Q7: a zero endpoint counts as absent, not as a floor of $0',
        gate({ low: 0, high: 40, lowBasis: O, highBasis: O }).why === 'high-only',
        'rendering "$0.00-$40.00" would claim someone sold one for nothing');

  // Source paths: the synthesizers the decision required removing.
  check('Q7: the eBay rolling averages no longer stand in for range endpoints',
        !/ebay\?\.avg_30d\s*\?\?\s*null/.test(core) && !/tcgplayer\?\.low\s+\?\?\s+condData\?\.ebay/.test(core),
        'a 30-day mean is not the bottom of a range, and pairing it with a '
        + 'TCGplayer high produced a mixed-origin range on the common path');
  check('Q7: the copied mid is tagged rather than passed off as a median ask',
        /mid: mkt, midBasis: 'derived'/.test(core),
        'mid === market is the market value printed twice, not a median');
  /* CHANGED 2026-09-08. This used to assert the live variant hardcoded its tags:
       lowBasis: Number(d.low) > 0 ? 'tcgplayer' : null
       high: null, highBasis: null
     and it passed, which is worth recording, because the line it was pinning
     was the defect. It confirmed that endpoints were tagged; it never asked
     WHERE the tag came from. The tag came from `Number(d.low) > 0` -- value
     presence -- so a server-synthesized 0.85 x market low arriving correctly
     labelled 'derived' on the wire was relabelled 'tcgplayer' here and passed
     the measured-range gate as provider data.

     An assertion that a provenance field is populated is not an assertion that
     the provenance is true. The check now requires the value to be READ off the
     wire, and the behavioural consequence is covered end-to-end in the Q7
     integration block below. */
  check('Q7: the live variant reads endpoint provenance off the wire',
        /lowBasis:\s*_dLow\s*!=\s*null\s*\?\s*\(d\.lowBasis\s*\|\|\s*null\)/.test(core)
          && /highBasis:\s*_dHigh\s*!=\s*null\s*\?\s*\(d\.highBasis\s*\|\|\s*null\)/.test(core),
        'provenance must never be inferred from value presence');
  check('Q7: the live variant still tags its copied mid as derived',
        /mid:\s*d\.market,\s*midBasis:\s*'derived'/.test(core),
        'mid is the market value copied, not a median ask');

  check('Q7: origin metadata survives the trip into the pricing basis',
        (core.match(/lowBasis:\s+b\.lowBasis/).length > 0) && /highBasis: p\.highBasis/.test(core),
        'dropping the tags at _qpBasis and re-deriving them at the render site '
        + 'is how the range got authenticated by its shape in the first place');

  // The comp-alone copy, fixed by the decision.
  check('Q7: the single-reference wording is exactly as decided',
        core.includes("'Single reference price. No observed market range is available.'"),
        'the wording is the disclosure; paraphrasing it changes what is claimed');
  check('Q7: the withheld-range case says so beside the comp',
        /noRangeStr = rangeStr \? ''/.test(core),
        'a comp with no range must not simply render as a bare precise number');
  check('Q7: the Market price badge line no longer vouches for an ungated range',
        /rangeStr \+ noRangeStr/.test(core),
        'badge and range shared a line, so the range borrowed the badge');

  // Sell Now / Comp / Patient survive, relabelled.
  check('Q7: the three suggestions are still offered',
        /label:'Sell Now'/.test(core) && /label:'Comp'/.test(core) && /label:'Patient'/.test(core),
        'option (iii) keeps them -- it changes what they are called');
  check('Q7: they are labelled calculated suggestions, not estimates of a market',
        (core.match(/calculated suggestion/g) || []).length >= 2,
        'both outer tiers must name themselves as computed by this app');
  check('Q7: the captions no longer call the trio a band',
        !/Estimated band\./.test(core),
        '"band" names a measured interval; nothing measured a width here');
  check('Q7: the captions deny being a provider range in so many words',
        (core.match(/not a '\s*\+\s*'provider range|not a \\?'?provider range/g) || []).length >= 1
          || (core.match(/provider range/g) || []).length >= 2,
        'the specific misreading to head off is "this is what the source said"');
}


/* ── Q7 integration: ingestion -> basis -> gate ───────────────────────────────
   2026-09-08. The gate tests above prove _crMeasuredRange refuses malformed
   pairs. They do NOT prove a synthesized endpoint cannot reach it wearing a
   provider tag, because they hand the gate its basis fields directly. That was
   the actual defect, and it lived in the seam:

     server api/tcg-price.js  synthesized  low = displayMarket * 0.85
                              and tagged   lowBasis = 'derived'   (honest)
     client js/core ingestion stamped      lowBasis = 'tcgplayer' (from
                                           VALUE PRESENCE, ignoring the wire)
     gate                     saw          'tcgplayer' in _CR_MEASURED_ORIGINS
                              and          RENDERED it as a measured range.

   Tagging the synthesized number did not protect anything, because the consumer
   inferred the tag instead of reading it. So this block runs the REAL ingestion
   expression, lifted from the live bundle, against payload shapes the server
   can actually emit, and composes its output into the REAL gate. A surface
   assertion ("the 0.85 is gone") cannot establish this; only running the chain
   can. Instance 29 of audit/PATTERN_ASSERTION_SURFACE.md.

   CHANGED-FROM: nothing. This block is new; no prior assertion covered the
   ingestion seam, which is why the defect survived the Q7 commit. */
{
  console.log('\n[Q7 — ingestion to gate, integration]');
  const core = readCoreBundle().source;

  // ---- 1. the two server synthesizers are gone from BOTH paths ----
  const server = readFileSync(new URL('../api/tcg-price.js', import.meta.url), 'utf8');
  /* Strip comments properly. A first pass filtered lines starting with // or *,
     which was not enough and failed loudly: the commit that deleted these
     synthesizers QUOTES the deleted lines inside a block comment, so the naive
     filter kept `low: r.low ?? (` as if it were live code and the assertion
     measured the explanation rather than the program. Block comments have to
     come out as regions, not as lines. */
  const _codeOnly = server
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !/^\s*\/\//.test(l))
    .join('\n');
  check('server tcgcsv path no longer synthesizes low from market',
        !/low:\s*r\.low\s*\?\?\s*\(/.test(_codeOnly),
        'the 0.85 spread must be deleted, not re-guarded');
  check('server tcgcsv path no longer synthesizes high from market',
        !/high:\s*r\.high\s*\?\?\s*\(/.test(_codeOnly));
  check('server free-API path no longer synthesizes low from market',
        !/low:\s*fb\.low\s*\?\?\s*\(fb\.market/.test(_codeOnly));
  check('server free-API path no longer synthesizes high from market',
        !/high:\s*fb\.high\s*\?\?\s*\(fb\.market/.test(_codeOnly));
  check('no percentage spread multiplier survives in server code',
        !/\*\s*0\.85|\*\s*1\.15/.test(_codeOnly),
        'both multipliers must be absent from executable lines');
  check('server free-API path now attributes its endpoints',
        /lowBasis:\s*fb\.low\s*!=\s*null\s*\?\s*'provider'/.test(_codeOnly),
        'Scryfall/lorcana/ygoprodeck endpoints must name a provider, not inherit one');
  check('clamping a high invalidates its observed basis',
        /if\s*\(data\.highBasis\s*!=\s*null\)\s*data\.highBasis\s*=\s*'derived'/.test(_codeOnly),
        'a clamped high is computed from anchor, so it is our number not the provider\u2019s');

  // ---- 2. lift the REAL ingestion expression out of the live bundle ----
  const a = core.indexOf("const _dLow  = Number(d.low)");
  const b = core.indexOf("currentPrices['tcgplayer_live'] = liveVariant;");
  check('the live-variant ingestion is locatable in the bundle', a !== -1 && b > a,
        'if this fails every assertion below is testing nothing');
  const ingest = new Function('d', core.slice(a, b) + '; return liveVariant;');

  // ---- 3. extract the gate ----
  const gi = core.indexOf('const _CR_MEASURED_ORIGINS');
  const gj = core.indexOf('const _CR_NO_RANGE_NOTE');
  const gate = new Function(core.slice(gi, gj) + '; return _crMeasuredRange;')();

  // The composed chain, exactly as production runs it.
  const chain = (payload) => {
    const v = ingest(payload);
    // _qpBasis carries these three through verbatim; asserted separately above.
    return { variant: v, verdict: gate({ low: v.low, high: v.high,
                                         lowBasis: v.lowBasis, highBasis: v.highBasis }) };
  };

  // ---- 4. the defect case: a derived endpoint must NOT become provider data ----
  {
    // Shape the OLD server emitted: synthesized low, honestly tagged 'derived'.
    const r = chain({ market: 100, low: 85, lowBasis: 'derived', high: null, highBasis: null });
    check('a wire-tagged derived low is not relabelled as provider data',
          r.variant.lowBasis === 'derived',
          'ingestion must READ lowBasis off the wire, never infer it from value presence');
    check('a derived endpoint cannot pass the gate through ingestion',
          r.verdict.ok === false,
          'this is the exact bypass: 0.85 x market rendering as a TCGplayer range');
  }
  {
    // Both endpoints synthesized and tagged derived - the full old shape.
    const r = chain({ market: 100, low: 85, lowBasis: 'derived', high: 115, highBasis: 'derived' });
    check('a fully derived pair is refused with derived-endpoint',
          r.verdict.ok === false && r.verdict.why === 'derived-endpoint');
  }
  {
    // The free-API path used to send endpoints with NO basis at all.
    const r = chain({ market: 100, low: 85, high: 115 });
    check('untagged endpoints do not acquire a tag from ingestion',
          r.variant.lowBasis === null && r.variant.highBasis === null,
          'the field they arrive on must not lend them its vendor name');
    check('untagged endpoints are refused as unattributed',
          r.verdict.ok === false && r.verdict.why === 'unattributed');
  }
  {
    // A clamped high arrives tagged derived; the pair must not render.
    const r = chain({ market: 100, low: 90, lowBasis: 'observed',
                      high: 300, highBasis: 'derived', highClamped: true });
    check('a clamped high does not render as a measured endpoint',
          r.verdict.ok === false && r.verdict.why === 'derived-endpoint');
  }

  // ---- 5. the converse: a genuinely supplied range MUST still render ----
  {
    const r = chain({ market: 100, low: 90, lowBasis: 'observed', high: 130, highBasis: 'observed' });
    check('a genuinely observed pair renders through the whole chain',
          r.verdict.ok === true,
          'the gate must not have been tightened into refusing everything');
  }
  {
    /* The case the reviewer asked for explicitly. 85/115 around a 100 comp is
       the fabrication SHAPE, but here both endpoints are attributed observed
       provider figures that genuinely came back symmetric. Symmetry must
       neither authenticate nor disqualify: the tags decide, and only the tags.
       Same numbers as the defect case above, opposite verdict, and the ONLY
       difference is provenance. */
    const r = chain({ market: 100, low: 85, lowBasis: 'observed', high: 115, highBasis: 'observed' });
    check('a genuinely supplied symmetric range still renders',
          r.verdict.ok === true,
          'symmetry must not disqualify an attributed range');
    const bad = chain({ market: 100, low: 85, lowBasis: 'derived', high: 115, highBasis: 'derived' });
    check('identical numbers flip verdict on provenance alone',
          r.verdict.ok === true && bad.verdict.ok === false,
          'the pair 85/115 renders or withholds purely on its tags');
  }
  {
    // Mixed origin across two real providers is still refused.
    const r = chain({ market: 100, low: 90, lowBasis: 'tcgplayer', high: 130, highBasis: 'ebay-sold' });
    check('two providers do not compose one measured range',
          r.verdict.ok === false && r.verdict.why === 'mixed-origin',
          'an ask floor under a sold ceiling is not one measurement context');
  }
  {
    // high absent entirely - the common real shape for this endpoint.
    const r = chain({ market: 100, low: 90, lowBasis: 'observed' });
    check('a lone observed low is still withheld',
          r.verdict.ok === false && r.verdict.why === 'low-only');
  }

  // ---- 6. the copy claim: Comp keeps its basis label ----
  check('Comp retains a source/basis label rather than being called calculated',
        core.includes('Comp is the displayed source value'),
        'only Sell Now and Patient are calculated suggestions');
  check('only the two outer tiers are called calculated suggestions',
        /Sell Now and Patient are calculated/.test(core) &&
        !/Comp[^.]{0,40}calculated suggestion/.test(core));
}

/* ── BIAS-5: the unidentified-card scope must not be shared ─────────────────
   2026-09-08. _crGradingScope used to `return 'unknown'` with no card identity,
   which made every unidentified card ONE scope -- so a cost entered against one
   scanned-but-unresolved card was subtracted from the next one's comps. That is
   the cross-card inheritance the (card, grader) scope exists to prevent,
   arriving through the one key that ignores the card.

   CHANGED-FROM: no prior assertion existed for the no-identity branch; the
   earlier scope tests all supplied either a pc.url or a name. */
{
  console.log('\n[BIAS-5 — unidentified card scope]');
  const core = readCoreBundle().source;
  const i = core.indexOf('const _crGradingAnonScope');
  const j = core.indexOf('function _crGradingGrader');
  check('the scope function is locatable', i !== -1 && j > i);
  const scope = new Function(core.slice(i, j) + '; return _crGradingScope;')();

  check('no-identity branch no longer returns the shared literal',
        scope(null, {}) !== 'unknown',
        "'unknown' was a single shared bucket for every unidentified card");

  const cardA = {}, cardB = {};
  check('two unidentified cards get different scopes',
        scope(null, cardA) !== scope(null, cardB),
        'this is the inheritance case: A\u2019s cost must not reach B');
  check('the same unidentified card keeps its scope across re-renders',
        scope(null, cardA) === scope(null, cardA),
        'a fresh key each render would silently discard what the seller typed');

  check('a server scan id is preferred over a minted token',
        scope(null, { scan_id: 'sc_123' }) === 'scan:sc_123',
        'a real per-analysis id beats anything we mint');
  check('two analyses of the same scan id share one scope',
        scope(null, { scan_id: 'sc_9' }) === scope(null, { scan_id: 'sc_9' }));
  check('different scan ids do not share a scope',
        scope(null, { scan_id: 'sc_1' }) !== scope(null, { scan_id: 'sc_2' }));

  // Identity, when present, still wins and is still stable.
  check('an identified card still scopes by printing url',
        scope({ url: 'https://x/y' }, {}) === 'pc:https://x/y');
  check('returning to an identified card restores its own scope',
        scope({ url: 'https://x/y' }, cardA) === scope({ url: 'https://x/y' }, cardB),
        'the intended behaviour: identity wins over the per-analysis token');
  check('name+set scoping is unchanged',
        scope(null, { name: 'Pikachu', set: 'Base', number: '58' })
          === 'card:Pikachu|Base|58');
  check('two different named cards do not share a scope',
        scope(null, { name: 'A' }) !== scope(null, { name: 'B' }));

  // With no data object at all there is nothing to be stable against, so reuse
  // is withheld rather than faked.
  check('no data object withholds reuse entirely',
        scope(null, null) !== scope(null, null),
        'we cannot tell whether the next render is the same card');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
