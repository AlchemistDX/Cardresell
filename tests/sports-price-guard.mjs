// Regression guard for the sports price path in api/pricecharting.js.
//
// Background (2026-09-03): every sports price lookup returned null because
// PriceCharting's single-match endpoint ranks Funko POP figures first for
// player-name queries. Switching to the plural /api/products endpoint fixed
// that, but exposed a worse failure: entertainment sets ship under the SAME
// brand names as sports cards, so "2000 Bowman Tom Brady" resolved to a
// "Star Wars 2025 Topps Chrome Sketch" and would have reported its $50 as a
// Brady comp. A confident wrong price is worse than no price.
//
// Every "reject" case below is a real match production actually returned.
// Run: node tests/sports-price-guard.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'api', 'pricecharting.js'), 'utf8');

// Extract the pure helpers so we can exercise them without a network or token.
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('pricecharting.js no longer defines ' + name);
  // Start brace-matching AFTER the parameter list. Scanning from the first '{'
  // grabs a destructured signature -- `function f({ a, b })` captured just
  // `function f({ a, b }` and shipped a truncated helper, which surfaced only
  // as "Unexpected token 'export'" from the generated module (2026-09-04).
  let p = 0, parenEnd = -1;
  for (let k = src.indexOf('(', i); k < src.length; k++) {
    if (src[k] === '(') p++;
    else if (src[k] === ')') { p--; if (!p) { parenEnd = k; break; } }
  }
  if (parenEnd < 0) throw new Error('unbalanced parens in signature of ' + name);
  const start = src.indexOf('{', parenEnd);
  if (start < 0) throw new Error('no body found for ' + name);
  let depth = 0;
  for (let k = start; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces reading ' + name);
}

const generated = path.join(here, '_pcfns.generated.mjs');
fs.writeFileSync(
  generated,
  [grab('isSportsCategoryOk'), grab('sportsCandidateAdmissible'), grab('scoreSportsCandidate'),
   grab('pcParallelOf'), grab('_parNorm'), grab('filterSportsParallel'),
   grab('pcNumberOf'), grab('pcNumberMatches'), grab('pcNameOf'), grab('pcNameMatches'),
   grab('pcIdentityRejection'),
   'export { isSportsCategoryOk, sportsCandidateAdmissible, scoreSportsCandidate, pcParallelOf, filterSportsParallel, pcNameMatches, pcNumberMatches, pcIdentityRejection };'].join('\n')
);

const {
  sportsCandidateAdmissible, pcParallelOf, filterSportsParallel,
  pcNameMatches, pcNumberMatches, pcIdentityRejection,
} = await import(
  'file://' + generated + '?v=' + Date.now()
);

const P = (pn, cn) => ({ 'product-name': pn, 'console-name': cn });

const JORDAN  = { name: 'Michael Jordan',  year: '1986', brand: 'Fleer',         number: '57',  sport: 'Basketball' };
const BRADY   = { name: 'Tom Brady',       year: '2000', brand: 'Bowman',        number: '236', sport: 'Football'   };
const GRIFFEY = { name: 'Ken Griffey Jr.', year: '1989', brand: 'Upper Deck',    number: '1',   sport: 'Baseball'   };
const MORANT  = { name: 'Ja Morant',       year: '2019', brand: 'Panini Select', number: '42',  sport: 'Basketball' };

const cases = [
  // --- must ADMIT: the genuine cards ---
  ['real 1986 Fleer Jordan',   P('Michael Jordan #57',    '1986 Fleer Basketball'),    JORDAN,  true],
  ['real 2000 Bowman Brady',   P('Tom Brady #236',        '2000 Bowman Football'),     BRADY,   true],
  ['real 1989 UD Griffey',     P('Ken Griffey Jr. #1',    '1989 Upper Deck Baseball'), GRIFFEY, true],
  ['real card, no facets',     P('Michael Jordan #57',    '1986 Fleer Basketball'),    { name: 'Michael Jordan' }, true],

  // --- must REJECT: every one of these came back from production ---
  ['Marvel Michael B. Jordan', P('Michael B. Jordan [Sapphire] #AA-MBJ', 'Marvel 2025 Topps Chrome Studios Autograph'), JORDAN,  false],
  ['Star Wars "Neil A Brady"', P('Neil A Brady',          'Star Wars 2025 Topps Chrome Sketch'), BRADY,   false],
  ['GPK x MLB Griffey',        P('Ken Griffey Jr. #24',   '2023 Topps Garbage Pail Kids x MLB C Name Variation'), GRIFFEY, false],
  ['Panini Fortnite',          P('Screen Shot #42',       '2019 Panini Fortnite'),     MORANT,  false],
  ['Funko POP NFL',            P('Tom Brady [Wave 3] #59','Funko POP NFL'),            BRADY,   false],
  ['Bowman GPK NBA',           P('Ace Bailey #BGP-2',     '2025 Bowman GPK NBA'),      BRADY,   false],

  // --- must REJECT via the franchise guard ALONE ---
  // Scan often gives us a player name and nothing else. With no year or sport
  // to disagree with, the surname matches an entertainment card exactly, so the
  // franchise check is the only thing standing between the user and a Garbage
  // Pail Kids price presented as a Griffey comp.
  ['GPK Griffey, name only',   P('Ken Griffey Jr. #24',   '2023 Topps Garbage Pail Kids x MLB C Name Variation'), { name: 'Ken Griffey Jr.' }, false],
  ['Marvel Jordan, name only', P('Michael Jordan #12',    'Marvel 2025 Topps Chrome'),  { name: 'Michael Jordan' }, false],
  ['Fortnite, name only',      P('Ja Morant #42',         '2019 Panini Fortnite'),      { name: 'Ja Morant' },      false],

  // --- must REJECT via the surname check ALONE ---
  // Same set, same year, same sport, real sports category -- only the player is
  // wrong. PriceCharting happily returns set-mates when the player query is
  // fuzzy, and a 1986 Fleer Barkley is not a 1986 Fleer Jordan.
  ['set-mate, wrong player',   P('Charles Barkley #7',    '1986 Fleer Basketball'),    JORDAN,  false],
  ['same set, wrong player 2', P('Hakeem Olajuwon #68',   '1986 Fleer Basketball'),    JORDAN,  false],

  // --- must REJECT: right player, wrong printing (100x price gaps) ---
  ['right player wrong year',  P('Michael Jordan #23',    '2003 Fleer Basketball'),    JORDAN,  false],
  ['right player wrong sport', P('Michael Jordan #57',    '1986 Fleer Baseball'),      JORDAN,  false],
];

let pass = 0, fail = 0;
for (const [label, prod, facets, want] of cases) {
  const got = sportsCandidateAdmissible(prod, facets);
  if (got === want) { pass++; console.log(`  PASS  ${label.padEnd(26)} admissible=${got}`); }
  else { fail++; console.log(`> FAIL  ${label.padEnd(26)} admissible=${got} want=${want}`); }
}

// ---------------------------------------------------------------------------
// HOST GUARD (2026-09-03)
// Sports lookups MUST query sportscardspro.com. The pricecharting.com catalog
// contains no sports cards whatsoever -- pointing sports at it is exactly the
// bug that made every sports price return null for the life of the feature.
// Verified with the docs' public demo token:
//   pricecharting.com/api/products?q=1986+fleer+jordan -> 0 sports categories
//   sportscardspro.com/api/products?q=... -> "Basketball Cards 1986 Fleer"
// ---------------------------------------------------------------------------
const hostChecks = [
  ['sports routes to sportscardspro',
   /const PC_HOST = \(game === 'sports'\)\s*\?\s*'https:\/\/www\.sportscardspro\.com'/.test(src)],
  ['non-sports stays on pricecharting',
   /:\s*'https:\/\/www\.pricecharting\.com';/.test(src)],
  ['no hardcoded API host remains',
   !/`https:\/\/www\.pricecharting\.com\/api\//.test(src)],
  ['every API call uses PC_HOST',
   (src.match(/\$\{PC_HOST\}\/api\//g) || []).length >= 5],
  // 2026-09-04: pinning one literal version made this check fail the very
  // bump it exists to demand (v7 -> v8 for the identity guard). Assert the
  // current version AND that every superseded one is absent, so the check
  // still catches a missing bump but survives a legitimate one.
  ['cache key bumped past v6',
   /const cacheKey = `v9\|/.test(src) && !/const cacheKey = `v[1-8]\|/.test(src)],
  ['parallel is part of the cache key',
   /const cacheKey = `v\d+\|[^`]*\$\{parallel\}/.test(src)],
  // The identity guard reaches the response path at all.
  ['identity mismatch is refused, not priced',
   /reason: 'identity_mismatch'/.test(src)
     && /pcIdentityRejection\(\{/.test(src)],
];
for (const [label, ok] of hostChecks) {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`> FAIL  ${label}`); }
}

// ---------------------------------------------------------------------------
// PARALLEL DISCIPLINE
// Every facet we score on (player, year, brand, number, sport) is IDENTICAL
// across a card's parallels, so scoring cannot separate a base Luka #280 from
// [Silver Prizm] #280 -- three orders of magnitude apart. The bracket is the
// only signal, and when it can't be satisfied we must refuse, never fall back.
// ---------------------------------------------------------------------------
const LUKA = [
  P('Luka Doncic #280',                       'Basketball Cards 2018 Panini Prizm'),
  P('Luka Doncic [Silver Prizm] #280',        'Basketball Cards 2018 Panini Prizm'),
  P('Luka Doncic [Pink Ice Prizm] #280',      'Basketball Cards 2018 Panini Prizm'),
  P('Luka Doncic [White Sparkle Prizm] #280', 'Basketball Cards 2018 Panini Prizm'),
];
// A card that exists ONLY as parallels -- we cannot know which one is in hand.
const PARALLEL_ONLY = [
  P('Victor Wembanyama [Silver] #9',  'Basketball Cards 2024 Panini Prizm Global Reach'),
  P('Victor Wembanyama [Gold] #9',    'Basketball Cards 2024 Panini Prizm Global Reach'),
];

const parCases = [
  ['bracket parsed',            () => pcParallelOf('Luka Doncic [Silver Prizm] #280') === 'silver prizm'],
  ['bare card has no parallel', () => pcParallelOf('Luka Doncic #280') === null],
  ['no ask -> base card only',  () => { const r = filterSportsParallel(LUKA, '');
                                        return r.keep.length === 1 && r.keep[0]['product-name'] === 'Luka Doncic #280'; }],
  ['ask Silver -> Silver',      () => { const r = filterSportsParallel(LUKA, 'Silver Prizm');
                                        return r.keep.length === 1 && r.keep[0]['product-name'] === 'Luka Doncic [Silver Prizm] #280'; }],
  // The headline requirement: a Silver must never be priced as anything else.
  ['Silver never becomes base', () => { const r = filterSportsParallel(LUKA, 'Silver Prizm');
                                        return !r.keep.some(p => pcParallelOf(p['product-name']) === null); }],
  ['Silver never becomes Pink', () => { const r = filterSportsParallel(LUKA, 'Silver Prizm');
                                        return !r.keep.some(p => /pink/.test(p['product-name'].toLowerCase())); }],
  ['unknown parallel refuses',  () => { const r = filterSportsParallel(LUKA, 'Chartreuse Sparkle');
                                        return r.keep.length === 0 && !!r.reason; }],
  ['refusal never falls back',  () => filterSportsParallel(LUKA, 'Chartreuse Sparkle').keep.length === 0],
  ['parallel-only card refuses',() => { const r = filterSportsParallel(PARALLEL_ONLY, '');
                                        return r.keep.length === 0 && /only as parallels/.test(r.reason); }],
];
for (const [label, fn] of parCases) {
  let ok = false;
  try { ok = fn(); } catch (e) { ok = false; }
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`> FAIL  ${label}`); }
}

// ---------------------------------------------------------------------------
// IDENTITY DISCIPLINE (2026-09-04)
// PriceCharting's search always returns *something*. The endpoint used to hand
// that something straight to confidenceForPc({hasExactMatch:true}), so a
// request for Miraidon #197 came back as "Vitality Band #197, exact product
// match, $0.23". A confident price for a card the seller does not own is worse
// than no price at all.
//
// These EXECUTE pcIdentityRejection. An earlier version of this block only
// grepped for `reason: 'identity_mismatch'` and kept passing when the guard's
// `if` was replaced with `if (false)`.
// ---------------------------------------------------------------------------
const rej = (o) => pcIdentityRejection(o) !== null;   // true = refused
const pokemon = (name, number, productName) =>
  rej({ game: 'pokemon', pcid: '', name, number, productName });

const idCases = [
  // The reported bug, exactly.
  ['Miraidon #197 refuses Vitality Band #197',
   () => pokemon('Miraidon', '197', 'Vitality Band #197') === true],
  ['Miraidon #197 refuses Miraidon #013 (right name, wrong card)',
   () => pokemon('Miraidon', '197', 'Miraidon #013') === true],
  ['Bulbasaur refuses a Stellar Crown #143 substitution',
   () => pokemon('Bulbasaur', '133', 'Bulbasaur #143') === true],
  ['a different card entirely is refused',
   () => pokemon('Charizard', '4', 'Blastoise #4') === true],

  // The guard must not become a wrecking ball. These all still price.
  ['the plain card is admitted',
   () => pokemon('Charizard', '4', 'Charizard #4') === false],
  ['bracketed printings are admitted',
   () => pokemon('Charizard', '4', 'Charizard [1st Edition] #4') === false
      && pokemon('Charizard', '4', 'Charizard [Shadowless] #4') === false],
  ['parenthetical qualifiers are admitted',
   () => pokemon('Umbreon VMAX', '215', 'Umbreon VMAX (Alternate Art) #215') === false],
  ['leading zeros are not a mismatch',
   () => pokemon('Okidogi ex', '90', 'Okidogi ex #090') === false],
  ['slashed numbering is admitted',
   () => pokemon('Charizard', '4', 'Charizard #4/102') === false],
  ['punctuated names survive normalisation',
   () => pokemon('Farfetch\u2019d', '27', "Farfetch'd #27") === false
      && pokemon('Mr. Mime', '122', 'Mr. Mime #122') === false
      && pokemon('Ho-Oh', '130', 'Ho-Oh #130') === false],
  ['a name-only lookup (no number given) still prices',
   () => pokemon('Charizard', '', 'Charizard #4') === false],
  ['a candidate with no number cannot be disproved, so it prices',
   () => pokemon('Charizard', '4', 'Charizard') === false],

  // Evolution lines are different cards at the same number.
  ['Charizard V does not accept Charizard VMAX',
   () => pokemon('Charizard V', '17', 'Charizard VMAX #17') === true],

  // Sealed-product guard: the caller asked for a specific card number and the
  // resolved candidate has no number AND clear sealed-product wording. Prod
  // returned Miraidon #197 as "League Battle Deck: Miraidon Ex" at $20.98.
  ['sealed "League Battle Deck" refused when a card number was asked',
   () => pokemon('Miraidon', '197', 'League Battle Deck: Miraidon Ex') === true],
  ['a Booster Box is not a card',
   () => pokemon('Ho-Oh', '130', 'Booster Box') === true
      && pokemon('Charizard', '4', 'Base Set Booster Box') === true],
  ['Elite Trainer Box, ETB, Tin, Blister all refused',
   () => pokemon('Pikachu', '58', 'Base Set Elite Trainer Box') === true
      && pokemon('Pikachu', '58', 'Silver Tempest ETB') === true
      && pokemon('Charizard', '4', 'Charizard Tin') === true
      && pokemon('Pikachu', '58', '3-Pack Blister') === true],
  ['Theme Deck / Starter Deck / Premium Collection refused',
   () => pokemon('Charizard', '4', 'Blackout Theme Deck') === true
      && pokemon('Pikachu', '58', 'Base Set Starter Deck') === true
      && pokemon('Mew', '151', 'Mew Premium Collection') === true],

  // The sealed guard only fires when a number was asked AND the candidate
  // reports no number. These paths must stay open.
  ['a legitimate card without a number in its listing still prices',
   () => pokemon('Charizard', '4', 'Charizard') === false],
  // If the sealed guard fires when it should not, this admits its true purpose
  // by refusing a plain single card whose product name happens to CARRY a
  // number, or a name-only search where no number was even asked.
  ['sealed guard leaves numbered cards alone (Charizard #4)',
   () => pokemon('Charizard', '4', 'Charizard #4') === false],
  ['sealed guard leaves bracketed variants alone (1st Edition #4)',
   () => pokemon('Charizard', '4', 'Charizard [1st Edition] #4') === false],
  ['sealed guard does not fire on name-only lookups',
   () => pokemon('Charizard', '', 'Charizard') === false],
  // Word-boundary discipline. Dropping the \b would let "booster" match
  // inside "turbooster" and "box" match inside "boxelder", flagging cards
  // whose names contain sealed keywords as substrings. Asserted structurally
  // -- an outcome test can't distinguish a \b-guarded match from a substring
  // one when the surrounding regex still catches the same real cases.
  ['sealed keywords are guarded by word boundaries',
   () => /\\b\(\?:booster\\s\*\(\?:box\|bundle\|pack\)/.test(src)],
  // Sealed guard only fires when a number was requested. This candidate does
  // fail the name check ("Miraidon" is not in "Miraidon Base Set Etb") -- the
  // point is that pcIdentityRejection's SEALED clause is not what refuses it.
  ['name-only search does not trip the sealed clause',
   () => {
     const why = pcIdentityRejection({ game: 'pokemon', pcid: '', name: 'Miraidon',
                                       number: '', productName: 'Miraidon Base Set' });
     return why === null; // "Miraidon" matches, no number asked -> admit
   }],
  ['a numbered sealed listing does not need this guard (number check fires)',
   () => pokemon('Charizard', '4', 'Charizard Box #99') === true],

  // Documented exemptions.
  ['sports is exempt (parallel logic owns identity there)',
   () => rej({ game: 'sports', pcid: '', name: 'Luka Doncic',
               number: '280', productName: 'Totally Different #280' }) === false],
  ['an explicit product id is the caller\u2019s choice, not ours to veto',
   () => rej({ game: 'pokemon', pcid: '12345', name: 'Miraidon',
               number: '197', productName: 'Vitality Band #197' }) === false],

  // Refusals must explain themselves.
  ['a refusal names what was asked and what came back',
   () => {
     const why = pcIdentityRejection({ game: 'pokemon', pcid: '', name: 'Miraidon',
                                       number: '197', productName: 'Vitality Band #197' });
     return Array.isArray(why) && why.length > 0
            && /Miraidon/.test(why.join(' ')) && /Vitality Band/.test(why.join(' '));
   }],
];
for (const [label, fn] of idCases) {
  let ok = false;
  try { ok = fn(); } catch (e) { ok = false; }
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`> FAIL  ${label}`); }
}

try { fs.unlinkSync(generated); } catch (_) {}

console.log(`\n[sports-price-guard] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
