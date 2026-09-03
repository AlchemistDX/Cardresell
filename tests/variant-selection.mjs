// Variant selection guard — added 2026-09-03 after the price audit.
//
// The audit found a median 82% disagreement between our two raw price sources.
// The cause was not staleness. Both sources were returning fresh prices for a
// MORE EXPENSIVE PRINTING than the card the user actually holds.
//
// Worked example (real data, Neo Genesis Lugia #9, TCGplayer product 86903):
//     1st Edition Holofoil   market $1085.03   low $2999.99   mid $7750.00
//     Unlimited Holofoil     market  $518.99   low  $498.74   mid  $535.91
// One product, two printings. We preferred 1st Edition and published $5,917
// for a card that trades near $519.
//
// These tests pin the direction of the preference. They are cheap to keep and
// the bug they cover is expensive: it overstates, so a seller lists high,
// nothing sells, and they conclude the app lies.

import { bestPriceForProduct, normalizeSetName } from '../api/_tcgcsv.js';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function check(label, cond, hint) {
  if (cond) { console.log('  \u2713 ' + label); passed++; }
  else { console.log('  \u2717 ' + label + (hint ? '\n      ' + hint : '')); failed++; }
}

console.log('\n[Variant selection]');

// ── The regression itself ────────────────────────────────────
{
  const lugia = {
    '1st Edition Holofoil': { market: 1085.03, low: 2999.99, mid: 7750.0, high: 10000 },
    'Unlimited Holofoil':   { market: 518.99,  low: 498.74,  mid: 535.91, high: 600 },
  };
  const got = bestPriceForProduct(lugia);
  check('unlimited is preferred over 1st edition',
        got.variant === 'unlimitedholofoil',
        `picked '${got.variant}' at $${got.market}`);
  check('the published price is the unlimited one',
        got.market === 518.99,
        `got $${got.market}; $1085.03 means we are back on the 1st Edition row`);
}

// ── Guard the guard: don't over-correct ──────────────────────
{
  // A product that only exists as 1st Edition must still return a price.
  // Refusing to price it would be a different kind of wrong.
  const only1st = { '1st Edition Holofoil': { market: 900, low: 850, mid: 900, high: 1000 } };
  const got = bestPriceForProduct(only1st);
  check('a 1st-edition-only product still returns its price',
        got.market === 900 && got.variant === '1steditionholofoil',
        'demoting premium printings must not mean refusing to price them');
}

{
  // Modern sets have no 1st Edition. Holofoil must still beat Reverse Holofoil.
  const modern = {
    'Holofoil':         { market: 100, low: 90, mid: 100, high: 120 },
    'Reverse Holofoil': { market: 40,  low: 35, mid: 40,  high: 50 },
  };
  check('modern holo ordering is unchanged',
        bestPriceForProduct(modern).variant === 'holofoil',
        'the fix must not disturb the common modern case');
}

{
  // The ordered list can't enumerate every subtype TCGplayer invents. The
  // fallback path must not quietly reintroduce the premium bias.
  const odd = {
    'Shadowless Holofoil': { market: 5000, low: 4000, mid: 5000, high: 6000 },
    'Zeta Printing':       { market: 200,  low: 180,  mid: 200,  high: 250 },
  };
  const got = bestPriceForProduct(odd);
  check('unrecognised premium subtypes lose to plain ones in fallback',
        got.market === 200,
        `picked $${got.market}; the fallback sort is not demoting 'Shadowless'`);
}

{
  check('an empty price map is handled',
        bestPriceForProduct(null).market === null &&
        bestPriceForProduct({}).market === null,
        'must not throw on a product with no prices');
}

// ── Set mismatch guard (api/tcg-price.js) ────────────────────
{
  const src = readFileSync(new URL('../api/tcg-price.js', import.meta.url), 'utf8');
  check('the live-search path rejects a set mismatch',
        /reason: 'set_mismatch'/.test(src) &&
        /normalizeSetName\(best\.setName\) !== normalizeSetName\(set\)/.test(src),
        "name=Charizard&set=Evolving Skies returned Base Set (Shadowless) at $10,000");

  // The comparison has to be normalised, or "SV02: Paldea Evolved" vs
  // "Paldea Evolved" would reject every legitimate modern match.
  check('the mismatch comparison is normalised, not literal',
        normalizeSetName('SV02: Paldea Evolved') === normalizeSetName('Paldea Evolved'),
        'a literal compare here would break far more than it fixes');
}

// ── PriceCharting premium correction (api/pricecharting.js) ──
{
  const src = readFileSync(new URL('../api/pricecharting.js', import.meta.url), 'utf8');
  check('PriceCharting demotes unrequested variant printings',
        /PC_VARIANT_RE/.test(src) && /_premiumCorrected/.test(src),
        "'Pikachu / Base Set / 58' resolved to [1st Edition] at $177.50 vs ~$9 unlimited");

  check('the correction only fires when the caller did not ask for it',
        /askedPremium/.test(src),
        'a user searching for a 1st Edition must still get one');

  check('a failed correction keeps the original match',
        /catch \(e\) \{ \/\* keep the original match/.test(src),
        'the plural-endpoint lookup must not be able to fail the whole price');
}

console.log('\n[PriceCharting variant detection — structural, not enumerated]');
{
  const pc = readFileSync(new URL('../api/pricecharting.js', import.meta.url), 'utf8');

  // The enumerated-denylist approach lost twice: version one caught only the
  // "1st Edition" family and Pikachu #58 slid to [E3 Red Cheeks] ($682.50);
  // version two added E3 and it slid again to [PokeTour 1999] ($198.89),
  // against ~$9 for the plain card. Naming the masks is a losing game, so the
  // rule is now structural: PriceCharting brackets every non-default
  // printing, and we test for the bracket.
  check('variant detection is the bracket, not a list of printing names',
        /const PC_VARIANT_RE = \/\\\[\[\^\\\]\]\+\\\]\//.test(pc),
        'an enumerated list only catches the masks we already lost to');

  check('the old enumerated constant is gone',
        !/PC_PREMIUM_RE/.test(pc),
        'leaving it behind invites a future edit to reintroduce the list');

  check('caller intent is matched separately from product naming',
        /const PC_ASKED_VARIANT_RE/.test(pc),
        'the user types "1st Edition", PriceCharting writes "[1st Edition]" -- ' +
        'two different vocabularies, two different regexes');

  check('a wrong collector number forces re-resolution',
        /matchWrongNumber/.test(pc),
        'Rayquaza/EX Deoxys/97 matched "Rayquaza EX #102" -- a different card');

  check('the number filter is applied when picking the replacement',
        /pcNumberMatches\(number, p\['product-name'\]\)/.test(pc),
        'otherwise the correction can swap in a plain copy of the WRONG card');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
