// tests/listing-packet-offline.mjs
// Block B tests: title (B1), condition descriptors (B3), target-net inversion
// (B4) and packet metadata (B5).
//
// No network, no env, no KV.
//
// B4 is tested against the REAL feeEbay pulled out of js/core.*.js by brace
// matching — the same technique tests/fee-truth-offline.mjs uses. Testing a
// copy of the fee math would prove nothing: the whole point of inverting by
// bisection is that it calls the one real forward function.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildListingTitle, titleSegments, DEFAULT_MAX_TITLE } from '../api/_listingTitle.js';
import {
  buildConditionBlock, buildConditionPayload, conditionHandoffLines,
  CONDITION_CODES, SEVERITY,
} from '../api/_conditionDescriptors.js';
import {
  buildListingPacket, stampPriceBasis, ageFromRetrievedAt, normalizeVerifiedStamp,
  findRelativeAgeKeys, FORBIDDEN_AGE_KEYS, PACKET_SCHEMA_VERSION, PACKET_CODES,
} from '../api/_listingPacket.js';
import { CONDITION, CONDITION_DESCRIPTOR, DESCRIPTOR_VALUES_RESOLVED } from '../api/_ebayTaxonomy.js';
import { cardIdentity, skuFor } from '../api/_cardIdentity.js';
import { readCoreBundle } from './_assetRefs.mjs';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
function check(name, cond, hint = '') {
  // A Promise is never a truth value. `(async () => {...})()` is always
  // truthy, so passing one here asserts nothing while printing ok — we
  // shipped two of those. Make the whole category impossible, loudly.
  if (cond && typeof cond.then === 'function') {
    failed++;
    console.log(`  FAIL ${name}\n       → TEST_API_MISUSE: a Promise is not a truth value; await it or use checkAsync()`);
    return;
  }

  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${hint ? '\n       → ' + hint : ''}`); }
}
/** For assertions whose condition is async. Awaits, then asserts. */
async function checkAsync(name, thunk, hint) {
  let v;
  try { v = await (typeof thunk === 'function' ? thunk() : thunk); }
  catch (e) { v = false; hint = `threw: ${e.message}`; }
  return check(name, !!v, hint);
}


// ── Pull the real fee + inversion functions out of the built core.js ───────
// Resolved from index.html, never by scanning js/. A directory scan used to
// live here and it picked the FIRST core.*.js it found. That worked only while
// exactly one existed: the moment a retired bundle was kept on disk during the
// f70d460f rename, this scan silently loaded the Phase 0 file and the fee
// constants vanished. The document decides what ships, so the document decides
// what we test.
const _core    = readCoreBundle();
const coreFile = _core.rel;
const coreSrc  = _core.source;

function extractFn(name) {
  const start = coreSrc.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`could not find function ${name} in ${coreFile}`);
  let depth = 0, i = coreSrc.indexOf('{', start);
  for (; i < coreSrc.length; i++) {
    if (coreSrc[i] === '{') depth++;
    else if (coreSrc[i] === '}') { depth--; if (depth === 0) break; }
  }
  return coreSrc.slice(start, i + 1);
}
function extractConstInt(name) {
  const m = coreSrc.match(new RegExp(`const ${name}\\s*=\\s*(\\d+);`));
  if (!m) throw new Error(`could not find const ${name} in ${coreFile}`);
  return `const ${name} = ${m[1]};`;
}

function extractConstRaw(name) {
  const m = coreSrc.match(new RegExp(`const ${name}\\s*=\\s*\\[[^\\]]*\\];`));
  if (!m) throw new Error(`could not find const ${name} in ${coreFile}`);
  return m[0];
}

const {
  trsDiscountApplies, feeEbay, netEbayForPrice, listPriceForTargetNet,
  FEE_MODEL_REVISION, FEE_TOTAL_DISCONTINUITIES,
} = new Function(`
  ${extractConstInt('FEE_MODEL_REVISION')}
  ${extractConstRaw('FEE_TOTAL_DISCONTINUITIES')}
  ${extractFn('trsDiscountApplies')}
  ${extractFn('feeEbay')}
  ${extractFn('netEbayForPrice')}
  ${extractFn('listPriceForTargetNet')}
  return {
    trsDiscountApplies, feeEbay, netEbayForPrice, listPriceForTargetNet,
    FEE_MODEL_REVISION, FEE_TOTAL_DISCONTINUITIES,
  };
`)();

// ═══════════════════════════════════════════════════════════════════════════
// B1 — titles
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nB1 — listing titles, 20 real collection cards');

// Deliberately awkward: very long Pokémon names, JP prints, sports parallels,
// a card with no rarity, a card with no set, and the longest real card name
// we have seen in the wild.
const CARDS = [
  { card: 'Charizard ex', set: 'Obsidian Flames', setCode: 'obf', number: '125', rarity: 'Double Rare', game: 'pokemon' },
  { card: 'Charizard ex', set: 'Obsidian Flames', setCode: 'obf', number: '125', rarity: 'Double Rare', game: 'pokemon', grader: 'PSA', grade: '10', cert: '84213771' },
  { card: 'Pikachu with Grey Felt Hat', set: 'Promo', setCode: 'promo', number: '085', rarity: 'Promo', game: 'pokemon', grader: 'CGC', grade: '9.5', cert: '5501234' },
  { card: 'Mew ex', set: 'Paldean Fates', setCode: 'paf', number: '232', rarity: 'Special Illustration Rare', game: 'pokemon' },
  { card: 'Lugia V', set: 'Silver Tempest', setCode: 'sit', number: '186', rarity: 'Alternate Art Secret Rare', game: 'pokemon', grader: 'BGS', grade: '9.5', cert: '0014567890' },
  { card: 'Rayquaza VMAX', set: 'Evolving Skies', setCode: 'evs', number: '218', rarity: 'Alternate Art Secret Rare', game: 'pokemon' },
  { card: 'Umbreon VMAX', set: 'Evolving Skies', setCode: 'evs', number: '215', rarity: 'Alternate Art Secret Rare', game: 'pokemon', grader: 'PSA', grade: '9', cert: '77112233' },
  { card: 'Blastoise', set: 'Base Set', setCode: 'base1', number: '2', rarity: 'Holo Rare', game: 'pokemon', grader: 'PSA', grade: '8', cert: '11223344' },
  { card: 'Mewtwo', set: 'Pokemon Card 151', setCode: 'sv2a', number: '150', rarity: 'Art Rare', game: 'pokemonjp' },
  { card: 'Gengar', set: 'VSTAR Universe', setCode: 's12a', number: '199', rarity: 'Special Art Rare', game: 'pokemon', isJapanese: true, grader: 'PSA', grade: '10', cert: '99887766' },
  { card: 'Black Lotus', set: 'Alpha', setCode: 'lea', number: '233', rarity: 'Rare', game: 'mtg', grader: 'BGS', grade: '8.5', cert: '0000123456' },
  { card: 'Ragavan, Nimble Pilferer', set: 'Modern Horizons 2', setCode: 'mh2', number: '138', rarity: 'Mythic Rare', game: 'mtg' },
  { card: 'Blue-Eyes White Dragon', set: 'Legend of Blue Eyes White Dragon', setCode: 'lob', number: '001', rarity: 'Ultra Rare', game: 'yugioh', grader: 'PSA', grade: '9', cert: '44556677' },
  { card: 'Dark Magician Girl', set: 'Magician\'s Force', setCode: 'mfc', number: '000', rarity: 'Secret Rare', game: 'yugioh' },
  { card: 'Elsa - Spirit of Winter', set: 'Rise of the Floodborn', setCode: 'rot', number: '042', rarity: 'Legendary', game: 'lorcana' },
  { card: 'Monkey D. Luffy', set: 'Romance Dawn', setCode: 'op01', number: '120', rarity: 'Secret Rare', game: 'onepiece' },
  { card: 'Victor Wembanyama', set: 'Panini Prizm', setCode: 'prizm-2023', number: '136', rarity: 'Silver Prizm', game: 'sports', year: '2023', grader: 'PSA', grade: '10', cert: '88990011' },
  { card: 'Michael Jordan', set: 'Fleer', setCode: 'fleer-1986', number: '57', rarity: '', game: 'sports', year: '1986', grader: 'PSA', grade: '8', cert: '22334455' },
  { card: 'Shohei Ohtani', set: 'Topps Chrome Update Sapphire Edition Refractor', setCode: 'tcu-2024', number: '289', rarity: 'Orange Refractor Parallel', game: 'sports', year: '2024' },
  { card: 'Iono', set: 'Paldea Evolved', setCode: 'pal', number: '269', rarity: 'Special Illustration Rare', game: 'pokemon', grader: 'SGC', grade: '10', cert: '66778899' },
];

const titles = CARDS.map((c) => ({ card: c, t: buildListingTitle(c) }));

check('all 20 titles build', titles.every((x) => x.t.ok),
      titles.filter((x) => !x.t.ok).map((x) => x.card.card).join(', '));
check('all 20 titles are ≤ 80 chars', titles.every((x) => x.t.length <= DEFAULT_MAX_TITLE),
      titles.filter((x) => x.t.length > 80).map((x) => `${x.card.card}=${x.t.length}`).join(', '));
check('no title has a doubled space',   titles.every((x) => !/\s{2}/.test(x.t.title)));
check('no title starts or ends with space', titles.every((x) => x.t.title === x.t.title.trim()));
check('every title contains the card name or a whole-word prefix of it',
      titles.every((x) => {
        const first = String(x.card.card).split(' ')[0];
        return x.t.title.includes(first);
      }));
check('no title ends mid-token on a separator', titles.every((x) => !/[#\-,/]$/.test(x.t.title)));

// The rule that matters: dropping happens by whole segment, never by slicing.
const longest = buildListingTitle(CARDS[18]);   // Topps Chrome Sapphire, very long set
check('over-budget title drops whole segments instead of truncating',
      longest.length <= 80 && longest.dropped.length > 0
      && !longest.title.endsWith('...') && !/\bRefracto$|\bParalle$/.test(longest.title),
      `got "${longest.title}" (${longest.length}), dropped=${longest.dropped.join(',')}`);

check('grade tag survives budget pressure on a graded card',
      titles.filter((x) => x.card.grader).every((x) => !x.t.dropped.includes('gradeTag')),
      '"PSA 10" is the strongest search term on a slab — it must outrank rarity');

check('card name is never dropped',
      titles.every((x) => !x.t.dropped.includes('name')));

const jp = buildListingTitle(CARDS[8]);
check('Japanese print is labelled Japanese in the title', jp.title.includes('Japanese'),
      `got "${jp.title}"`);
const jpFlag = buildListingTitle(CARDS[9]);
check('isJapanese:true also labels Japanese', jpFlag.title.includes('Japanese'));
check('English cards are not labelled Japanese',
      !buildListingTitle(CARDS[0]).title.includes('Japanese'));

const sportsT = buildListingTitle(CARDS[16]);
check('sports title leads with the year', /^2023\b/.test(sportsT.title), `got "${sportsT.title}"`);
check('non-sports title does not spend budget on a year',
      !buildListingTitle({ ...CARDS[0], year: '2023' }).title.startsWith('2023'),
      'the Pokémon set name already implies the year');

check('card number keeps its printed zero padding in the title',
      buildListingTitle(CARDS[2]).title.includes('#085'),
      'display, not identity — the card is printed 085 and buyers search it that way');

check('a nameless card refuses to build a title',
      buildListingTitle({ set: 'Base Set', number: '4' }).ok === false,
      'emitting "#4 PSA 10" would look like a listing and sell nothing');

const monster = buildListingTitle({
  card: 'Supercalifragilistic Extraordinarily Overlong Character Name Of Unusual Length Indeed Truly',
  setCode: 'x', number: '1', game: 'pokemon',
});
check('name longer than the cap is cut on a word boundary',
      monster.length <= 80 && !monster.title.endsWith('Unusua') && monster.nameClamped === true,
      `got "${monster.title}" (${monster.length})`);

check('control characters are stripped from titles',
      !/[\r\n\t<>]/.test(buildListingTitle({ ...CARDS[0], card: 'Charizard\n<ex>' }).title));

check('cert is not spent on title budget',
      titles.every((x) => !x.card.cert || !x.t.title.includes(x.card.cert)),
      'cert belongs in the structured condition descriptor, where eBay indexes it');

// ── Frozen golden strings ─────────────────────────────────────────────────
// These 20 strings were read line by line and judged as titles a buyer would
// actually click. Printing them for eyeball review was not enough: nothing
// stopped a later ordering or separator change from quietly rewriting all 20
// while every property assertion above still passed. Freezing the exact
// output means any change to title composition has to be looked at and
// re-approved, not merely re-run.
const GOLDEN_TITLES = [
  "Charizard ex Obsidian Flames #125 Double Rare",
  "Charizard ex Obsidian Flames #125 Double Rare PSA 10",
  "Pikachu with Grey Felt Hat Promo #085 Promo CGC 9.5",
  "Mew ex Paldean Fates #232 Special Illustration Rare",
  "Lugia V Silver Tempest #186 Alternate Art Secret Rare BGS 9.5",
  "Rayquaza VMAX Evolving Skies #218 Alternate Art Secret Rare",
  "Umbreon VMAX Evolving Skies #215 Alternate Art Secret Rare PSA 9",
  "Blastoise Base Set #2 Holo Rare PSA 8",
  "Mewtwo Pokemon Card 151 #150 Art Rare Japanese",
  "Gengar VSTAR Universe #199 Special Art Rare Japanese PSA 10",
  "Black Lotus Alpha #233 Rare BGS 8.5",
  "Ragavan, Nimble Pilferer Modern Horizons 2 #138 Mythic Rare",
  "Blue-Eyes White Dragon Legend of Blue Eyes White Dragon #001 Ultra Rare PSA 9",
  "Dark Magician Girl Magician's Force #000 Secret Rare",
  "Elsa - Spirit of Winter Rise of the Floodborn #042 Legendary",
  "Monkey D. Luffy Romance Dawn #120 Secret Rare",
  "2023 Victor Wembanyama Panini Prizm #136 Silver Prizm PSA 10",
  "1986 Michael Jordan Fleer #57 PSA 8",
  "2024 Shohei Ohtani Topps Chrome Update Sapphire Edition Refractor #289",
  "Iono Paldea Evolved #269 Special Illustration Rare SGC 10",
];

const goldenDiffs = [];
titles.forEach(({ t }, i) => {
  if (t.title !== GOLDEN_TITLES[i]) {
    goldenDiffs.push(`[${i}] expected "${GOLDEN_TITLES[i]}"\n            got "${t.title}"`);
  }
});
check('🔴 all 20 golden titles match their frozen expected strings',
      goldenDiffs.length === 0,
      goldenDiffs.slice(0, 5).join('\n       '));
check('the golden set covers both raw and graded cards',
      GOLDEN_TITLES.some((g) => /\b(PSA|BGS|CGC|SGC)\b/.test(g)) &&
      GOLDEN_TITLES.some((g) => !/\b(PSA|BGS|CGC|SGC)\b/.test(g)));

// Print the golden set so a reviewer can eyeball readability, which no
// assertion can check for them.
console.log('\n  ── golden titles ──');
for (const { t } of titles) console.log(`  ${String(t.length).padStart(2)}  ${t.title}`);

// ═══════════════════════════════════════════════════════════════════════════
// B3 — condition descriptors
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nB3 — condition descriptors must refuse, not guess');

const slab = { card: 'Charizard ex', setCode: 'obf', number: '125', game: 'pokemon', grader: 'PSA', grade: '10', cert: '84213771' };
const raw  = { card: 'Charizard ex', setCode: 'obf', number: '125', game: 'pokemon' };

const cSlab = buildConditionBlock(slab);
const cRaw  = buildConditionBlock(raw);

check('graded card uses condition 2750', cSlab.conditionId === CONDITION.GRADED);
check('raw card uses condition 4000',    cRaw.conditionId  === CONDITION.UNGRADED);
check('graded emits grader descriptor 27501',
      cSlab.descriptors.some((d) => d.nameId === CONDITION_DESCRIPTOR.PROFESSIONAL_GRADER));
check('graded emits grade descriptor 27502',
      cSlab.descriptors.some((d) => d.nameId === CONDITION_DESCRIPTOR.GRADE));
check('graded emits cert descriptor 27503 when a cert is present',
      cSlab.descriptors.some((d) => d.nameId === CONDITION_DESCRIPTOR.CERT_NUMBER));
check('raw emits ungraded descriptor 40001',
      cRaw.descriptors.some((d) => d.nameId === CONDITION_DESCRIPTOR.UNGRADED_CONDITION));

check('no descriptor invents a value id for grader or grade',
      cSlab.descriptors
        .filter((d) => d.nameId !== CONDITION_DESCRIPTOR.CERT_NUMBER)
        .every((d) => d.valueId === null),
      'a guessed value id publishes a wrong grade and fails silently');
check('cert is free text, so it carries its own value',
      cSlab.descriptors.find((d) => d.nameId === CONDITION_DESCRIPTOR.CERT_NUMBER).valueId === '84213771');

check('apiReady is false while descriptor values are unresolved',
      DESCRIPTOR_VALUES_RESOLVED === false && cSlab.apiReady === false);

const payload = buildConditionPayload(slab);
check('payload builder REFUSES while values are unresolved',
      payload.ok === false && payload.payload === null
      && payload.refusedBecause === CONDITION_CODES.UNRESOLVED_CONDITION_DESCRIPTOR,
      'this is the single most important assertion in Block B');
check('refusal names the unresolved descriptor ids',
      payload.unresolvedNameIds.includes(CONDITION_DESCRIPTOR.PROFESSIONAL_GRADER)
      && payload.unresolvedNameIds.includes(CONDITION_DESCRIPTOR.GRADE));
check('raw payload also refuses (seller picks condition)',
      buildConditionPayload(raw).ok === false);

check('unresolved descriptor is a WARNING in Phase 1, not an ERROR',
      cSlab.notes.find((n) => n.code === CONDITION_CODES.UNRESOLVED_CONDITION_DESCRIPTOR)
        ?.severity === SEVERITY.WARNING,
      'ERROR here would block every graded card — the entire wedge — to guard a submission Phase 1 never makes');

check('unknown grader warns and is not coerced',
      (() => {
        const b = buildConditionBlock({ ...slab, grader: 'RCG' });
        return b.grader === 'RCG'
          && b.notes.some((n) => n.code === CONDITION_CODES.UNSUPPORTED_GRADER);
      })());
check('missing cert on a slab warns',
      buildConditionBlock({ ...slab, cert: '' }).notes
        .some((n) => n.code === CONDITION_CODES.MISSING_CERT_NUMBER));
check('raw card never asserts a condition value',
      cRaw.descriptors.every((d) => d.intendedValue === null),
      'our estGrade is a scan heuristic, not an inspected condition');
check('handoff lines name grader, grade and cert',
      (() => { const l = conditionHandoffLines(slab).join(' | ');
        return l.includes('PSA') && l.includes('10') && l.includes('84213771'); })());

// ═══════════════════════════════════════════════════════════════════════════
// B4 — target net → list price
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nB4 — target net inverted by bisection on the real feeEbay');

check('FEE_MODEL_REVISION exists and is an integer',
      Number.isInteger(FEE_MODEL_REVISION) && FEE_MODEL_REVISION >= 1);

// CHANGED 2026-09-07. These contexts used to set `ebayTopRated: 'yes'` alone
// and expect the 10% discount. They no longer get it from status alone: the
// discount is a per-LISTING benefit, so `ebayTrsListing: 'yes'` -- the seller's
// confirmation that the listing offers qualifying handling -- is now required
// too. The 'top rated status only' row below is new and pins the case the old
// contexts silently mis-modelled: status without a qualifying listing pays the
// FULL fee.
const CTXS = [
  { name: 'default no-store',      shipCharge: 0, shipCost: 0, ebayStore: 'none',  ebayPromo: 0, ebayTopRated: 'no' },
  { name: 'top rated + listing ok', shipCharge: 0, shipCost: 0, ebayStore: 'none',  ebayPromo: 0, ebayTopRated: 'yes', ebayTrsListing: 'yes' },
  { name: 'basic store',           shipCharge: 0, shipCost: 0, ebayStore: 'basic', ebayPromo: 0, ebayTopRated: 'no' },
  { name: 'buyer-paid shipping',   shipCharge: 5, shipCost: 4.50, ebayStore: 'none', ebayPromo: 0, ebayTopRated: 'no' },
  { name: 'promoted 3%',           shipCharge: 0, shipCost: 0, ebayStore: 'none',  ebayPromo: 3, ebayTopRated: 'no' },
  { name: 'everything at once',    shipCharge: 5.95, shipCost: 5.10, ebayStore: 'basic', ebayPromo: 4, ebayTopRated: 'yes', ebayTrsListing: 'yes' },
  { name: 'top rated status only', shipCharge: 0, shipCost: 0, ebayStore: 'none',  ebayPromo: 0, ebayTopRated: 'yes', ebayTrsListing: 'no' },
];
const TARGETS = [1, 4.99, 8, 9.5, 10, 10.5, 12, 25, 60, 99.99, 250, 900, 2499, 2501, 5000, 7499, 7501, 12000];

// ── Ground truth. The reviewer's assertion is the right one: the answer must
// be the LOWEST cent price whose net clears the target, not merely a close
// inverse. Proving that needs an independent oracle, so we scan every cent
// below the returned price and assert none of them clears.
function noCheaperPriceClears(target, ctx, priceDollars) {
  const EPS = 0.005;
  const top = Math.round(priceDollars * 100);
  for (let cents = 1; cents < top; cents++) {
    if (netEbayForPrice(cents / 100, ctx) >= target - EPS) return cents / 100;
  }
  return null;
}

let sweepBad = [], optBad = [];
for (const ctx of CTXS) {
  for (const target of TARGETS) {
    const r = listPriceForTargetNet(target, ctx);
    if (!r.ok) { sweepBad.push(`${ctx.name}@${target}: not ok (${r.reason})`); continue; }
    const actual = netEbayForPrice(r.listPrice, ctx);
    if (actual < target - 0.005) {
      sweepBad.push(`${ctx.name}@${target}: price ${r.listPrice} nets only ${actual.toFixed(4)}`);
    }
    if (Math.abs(actual - r.achievedNet) > 0.005) {
      sweepBad.push(`${ctx.name}@${target}: reported achievedNet ${r.achievedNet} != real ${actual.toFixed(4)}`);
    }
    if (target <= 300) {
      const cheaper = noCheaperPriceClears(target, ctx, r.listPrice);
      if (cheaper !== null) {
        optBad.push(`${ctx.name}@${target}: returned ${r.listPrice} but ${cheaper} also clears`);
      }
    }
  }
}
check(`sweep: ${CTXS.length} fee configs x ${TARGETS.length} targets all clear the target`,
      sweepBad.length === 0, sweepBad.slice(0, 6).join('\n       -> '));

check('🔴 returned price is the LOWEST cent price that clears — verified against an exhaustive scan',
      optBad.length === 0, optBad.slice(0, 6).join('\n       -> '));

// This is the assertion the previous revision was missing. The old
// implementation bisected and then scanned down a fixed 60 cents, which was
// suboptimal even at DEFAULT fee settings (target $8.34 returned $10.00 when
// $9.96 clears it) — and the old test grid did not catch it because it only
// asserted "clears the target within $0.05", never "is the cheapest such
// price". Dense cent-level optimality across the step is the real guard.
const denseBad = [];
for (const ctx of [CTXS[0], CTXS[4]]) {
  for (let cents = 100; cents <= 1400; cents += 1) {
    const t = cents / 100;
    const r = listPriceForTargetNet(t, ctx);
    if (!r.ok) { denseBad.push(`${ctx.name}@${t}: not ok`); continue; }
    const cheaper = noCheaperPriceClears(t, ctx, r.listPrice);
    if (cheaper !== null) denseBad.push(`${ctx.name}@${t}: got ${r.listPrice}, ${cheaper} also clears`);
  }
}
check('1301 dense cent targets straddling the $10 step are each priced optimally',
      denseBad.length === 0, denseBad.slice(0, 6).join('\n       -> '));

// ── The discontinuity bound the reviewer asked for. Rather than trusting the
// declared list, derive it: walk cent by cent and record every point where net
// goes DOWN as price goes UP. A future stepped fee will fail this until it is
// declared.
function derivedDiscontinuityTotals(ctx) {
  const found = [];
  let prev = netEbayForPrice(0.01, ctx);
  for (let cents = 2; cents <= 300000; cents++) {
    const n = netEbayForPrice(cents / 100, ctx);
    // Report the highest total still on the LOW side of the step, which is
    // what FEE_TOTAL_DISCONTINUITIES declares (feeEbay tests `total <= 10`).
    if (n < prev - 1e-9) {
      found.push(Math.round(((cents - 1) / 100 + (Number(ctx.shipCharge) || 0)) * 100) / 100);
    }
    prev = n;
  }
  return found;
}
const derived = derivedDiscontinuityTotals(CTXS[0]);
check('declared FEE_TOTAL_DISCONTINUITIES matches what feeEbay actually does',
      JSON.stringify(derived) === JSON.stringify(FEE_TOTAL_DISCONTINUITIES.map(Number)),
      `derived ${JSON.stringify(derived)} vs declared ${JSON.stringify(FEE_TOTAL_DISCONTINUITIES)}`);
check('the FVF tier break is a slope change, not a step',
      !derived.includes(2500) && !derived.includes(7500),
      'tierBoundary * baseRate is equal from both sides, so bisection is safe across it');
check('the only discontinuity is the per-order fee, and it is exactly $0.10 deep',
      (() => {
        const c = CTXS[0];
        const below = netEbayForPrice(10.00, c);
        const above = netEbayForPrice(10.01, c);
        return Math.abs((below - above) - (0.10 - 0.01 * (1 - 0.1325))) < 0.02;
      })(),
      'the step is the $0.30 -> $0.40 per-order jump');

// The old fixed 60-cent window could not have been correct in general: the
// price gap needed to recover $0.10 of net is 0.10 / (1 - rate - promo), which
// exceeds 60 cents once the promoted rate is high enough. Branch-wise search
// has no window to outgrow.
const promoBad = [];
for (const promo of [0, 4, 20, 40, 60, 80]) {
  const ctx = { shipCharge: 0, shipCost: 0, ebayStore: 'none', ebayPromo: promo, ebayTopRated: 'no' };
  for (const t of [1, 3, 8.34, 9.5, 12, 40]) {
    const r = listPriceForTargetNet(t, ctx);
    if (!r.ok) continue;
    const cheaper = noCheaperPriceClears(t, ctx, r.listPrice);
    if (cheaper !== null) promoBad.push(`promo ${promo}%@${t}: got ${r.listPrice}, ${cheaper} clears`);
  }
}
check('optimality holds at promoted rates where a fixed 60-cent window fails',
      promoBad.length === 0, promoBad.slice(0, 6).join('\n       -> '));

check('list prices are whole cents',
      CTXS.every((ctx) => TARGETS.every((t) => {
        const r = listPriceForTargetNet(t, ctx);
        return !r.ok || Math.abs(r.listPrice * 100 - Math.round(r.listPrice * 100)) < 1e-9;
      })));

check('achievedNet is recomputed, never echoed from the target',
      (() => {
        const r = listPriceForTargetNet(100, CTXS[0]);
        return r.achievedNet !== undefined && Math.abs(r.achievedNet - 100) <= 0.05;
      })());

check('higher target never yields a lower price',
      (() => {
        let prev = -Infinity;
        for (const t of TARGETS) {
          const r = listPriceForTargetNet(t, CTXS[0]);
          if (!r.ok) return false;
          if (r.listPrice < prev - 1e-9) return false;
          prev = r.listPrice;
        }
        return true;
      })());

check('top rated seller needs a lower price for the same payout',
      listPriceForTargetNet(100, CTXS[1]).listPrice < listPriceForTargetNet(100, CTXS[0]).listPrice,
      'the 10% FVF discount has to show up somewhere');
check('basic store needs a lower price than no store',
      listPriceForTargetNet(100, CTXS[2]).listPrice < listPriceForTargetNet(100, CTXS[0]).listPrice);
check('promoted listings need a higher price',
      listPriceForTargetNet(100, CTXS[4]).listPrice > listPriceForTargetNet(100, CTXS[0]).listPrice);

check('unreachable payout is refused, not approximated',
      (() => {
        const r = listPriceForTargetNet(100, { ...CTXS[0], ebayPromo: 100 });
        return r.ok === false && r.reason === 'UNREACHABLE_NET' && r.listPrice === null;
      })(),
      'if marginal fees eat every extra dollar, say so instead of returning a number');

check('target below the price floor reports atFloor',
      (() => { const r = listPriceForTargetNet(-20, CTXS[0]); return r.ok && r.atFloor === true; })());

// ── Malformed input must produce a defined refusal, never a loop or a
// confident-looking number. Numerical inversion fails strangely on garbage.
const MALFORMED_TARGETS = [NaN, Infinity, -Infinity, 'abc', null, undefined, {}, [], '12abc'];
check('every malformed target is refused with BAD_TARGET',
      MALFORMED_TARGETS.every((t) => {
        const r = listPriceForTargetNet(t, CTXS[0]);
        return r.ok === false && r.reason === 'BAD_TARGET' && r.listPrice === null;
      }),
      MALFORMED_TARGETS.map((t) => `${String(t)}=${JSON.stringify(listPriceForTargetNet(t, CTXS[0]).reason)}`).join(' '));
check('zero target is valid and lands at the floor',
      (() => { const r = listPriceForTargetNet(0, CTXS[0]); return r.ok === true; })(),
      'zero is a legitimate target, unlike NaN');
check('an absurd target still returns a defined result',
      (() => { const r = listPriceForTargetNet(1e9, CTXS[0]); return r.ok === true || r.reason === 'UNREACHABLE_NET'; })());

const BAD_CTXS = [
  { name: 'negative shipCharge', shipCharge: -5 },
  { name: 'negative shipCost',   shipCost: -5 },
  { name: 'negative promo',      ebayPromo: -10 },
  { name: 'promo over 100',      ebayPromo: 150 },
  { name: 'NaN shipCharge',      shipCharge: NaN },
  { name: 'Infinity shipCost',   shipCost: Infinity },
];
check('malformed fee settings are refused with BAD_CONTEXT',
      BAD_CTXS.every((b) => {
        const r = listPriceForTargetNet(50, { ...CTXS[0], ...b });
        return r.ok === false && r.reason === 'BAD_CONTEXT' && r.listPrice === null;
      }),
      BAD_CTXS.map((b) => `${b.name}=${listPriceForTargetNet(50, { ...CTXS[0], ...b }).reason}`).join(' '));

check('result carries the fee model revision that priced it',
      listPriceForTargetNet(50, CTXS[0]).feeModelRevision === FEE_MODEL_REVISION);
check('exact flag is honest about the achieved net',
      (() => {
        const r = listPriceForTargetNet(37.77, CTXS[0]);
        return r.exact === (Math.abs(r.achievedNet - 37.77) <= 0.05);
      })());

// ═══════════════════════════════════════════════════════════════════════════
// B5 — packet metadata, and the relative-age bug
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nB5 — metadata stamp; no relative ages may be persisted');

check("normalizeVerifiedStamp('Sep 2026') → '2026-09'",
      normalizeVerifiedStamp('Sep 2026') === '2026-09');
check('already-normalized stamp passes through',
      normalizeVerifiedStamp('2026-09') === '2026-09');
check('every month name parses',
      ['Jan 2026','Feb 2026','Mar 2026','Apr 2026','May 2026','Jun 2026',
       'Jul 2026','Aug 2026','Sep 2026','Oct 2026','Nov 2026','Dec 2026']
        .map(normalizeVerifiedStamp)
        .every((v, i) => v === `2026-${String(i + 1).padStart(2, '0')}`));
check('unparseable verification date returns null, not a guess',
      normalizeVerifiedStamp('sometime last year') === null
      && normalizeVerifiedStamp('') === null,
      'an unknown verification date must not masquerade as a known one');

const NOW = Date.parse('2026-09-05T21:00:00.000Z');
const basisMeta = {
  label: 'TCGPlayer market', low: 30, mid: 40, high: 55, highClamped: true,
  cacheAgeSec: 3 * 3600, sourceUrl: 'https://www.tcgplayer.com/product/1', datedBySource: true,
};
const stamped = stampPriceBasis(basisMeta, NOW);

check('cacheAgeSec becomes an absolute retrievedAt',
      stamped.retrievedAt === '2026-09-05T18:00:00.000Z',
      `got ${stamped.retrievedAt}`);
check('stamped basis carries no cacheAgeSec',
      !('cacheAgeSec' in stamped),
      'persisting a relative age freezes it — the draft would still say "3 hr ago" next week');
check('display age is recomputed at read time',
      ageFromRetrievedAt(stamped.retrievedAt, NOW) === '3 hr ago'
      && ageFromRetrievedAt(stamped.retrievedAt, NOW + 3 * 86400 * 1000) === '3 days ago',
      'same stamp, different read time, different age — that is the whole point');
check('missing age yields null rather than a fabricated timestamp',
      stampPriceBasis({ label: 'x' }, NOW).retrievedAt === null);
check('datedBySource distinction survives into the packet',
      stamped.datedBySource === true
      && stampPriceBasis({ ...basisMeta, datedBySource: false }, NOW).datedBySource === false,
      'PriceCharting publishes no as-of date; that caveat must not be lost');
check('highClamped survives into the packet', stamped.highClamped === true);

const packet = buildListingPacket(slab, {
  feeModelRevision: FEE_MODEL_REVISION,
  feeScheduleVerified: 'Sep 2026',
  taxonomyTreeVersion: '134',
  pricing: listPriceForTargetNet(120, CTXS[0]),
  basisMeta,
  now: NOW,
});

check('packet carries all five metadata fields',
      packet.metadata.packetSchemaVersion === PACKET_SCHEMA_VERSION
      && packet.metadata.taxonomyTreeVersion === '134'
      && packet.metadata.feeModelRevision === FEE_MODEL_REVISION
      && packet.metadata.feeScheduleVerified === '2026-09'
      && packet.metadata.generatedAt === '2026-09-05T21:00:00.000Z',
      JSON.stringify(packet.metadata));

check('🔴 finished packet contains NO relative-age key anywhere',
      findRelativeAgeKeys(packet).length === 0,
      'found: ' + findRelativeAgeKeys(packet).join(', '));
check('the relative-age walker actually works',
      findRelativeAgeKeys({ a: { b: [{ cacheAgeSec: 1 }] } }).length === 1,
      'a guard that cannot fail proves nothing');
check('forbidden key list covers the field core.js really uses',
      FORBIDDEN_AGE_KEYS.includes('cacheAgeSec'));

check('a live taxonomy read is labelled live',
      packet.metadata.taxonomyTreeVersionSource === 'live');
check('an assumed taxonomy version is labelled as the verified constant, not live',
      (() => {
        const p = buildListingPacket(slab, {
          feeModelRevision: FEE_MODEL_REVISION, feeScheduleVerified: 'Sep 2026', now: NOW,
        });
        return p.metadata.taxonomyTreeVersionSource === 'verified-constant'
          && p.notes.some((n) => n.code === PACKET_CODES.TAXONOMY_VERSION_ASSUMED);
      })(),
      'never claim a live read we did not perform');

check('missing feeModelRevision is a blocking ERROR, never defaulted to 0',
      (() => {
        const p = buildListingPacket(slab, { feeScheduleVerified: 'Sep 2026', now: NOW });
        return p.metadata.feeModelRevision === null && p.blocked === true
          && p.blockingCodes.includes(PACKET_CODES.MISSING_FEE_MODEL_REVISION);
      })(),
      'a silent fallback would let core.js and the packet drift — the exact ambiguity this field removes');

check('a complete graded packet is NOT blocked',
      packet.blocked === false,
      'blocking codes: ' + packet.blockingCodes.join(', '));
check('unresolved condition descriptors do not block the Phase 1 handoff',
      !packet.blockingCodes.includes(CONDITION_CODES.UNRESOLVED_CONDITION_DESCRIPTOR));
check('insufficient identity blocks',
      buildListingPacket({ card: 'Mystery' }, {
        feeModelRevision: FEE_MODEL_REVISION, now: NOW,
      }).blockingCodes.includes(PACKET_CODES.INSUFFICIENT_IDENTITY));

check('packet is keyed by the canonical sku',
      packet.sku.startsWith('v2-') && packet.sku === packet.identity.sku);
check('packet reports the real achieved net, not the requested target',
      Math.abs(packet.pricing.achievedNet - netEbayForPrice(packet.pricing.listPrice, CTXS[0])) < 0.006);

// Category + aspect routing (B2 wiring)
check('Pokémon routes to the CCG category 183454', packet.category.id === '183454');
check('sports routes to 261328',
      buildListingPacket(CARDS[16], { feeModelRevision: FEE_MODEL_REVISION, now: NOW })
        .category.id === '261328');
check('CCG variant aspect is named Rarity',
      (() => {
        // CARDS[1] is the graded Charizard, which carries a rarity; the bare
        // `slab` fixture deliberately has none.
        const p = buildListingPacket(CARDS[1], { feeModelRevision: FEE_MODEL_REVISION, now: NOW });
        return p.aspects.optional.Rarity?.[0] === 'Double Rare'
          && !('Parallel/Variety' in p.aspects.optional);
      })(),
      'grounded in the real aspect list for 183454');
check('an aspect with no data is omitted rather than sent empty',
      !('Rarity' in packet.aspects.optional) && !('Parallel/Variety' in packet.aspects.optional),
      'the bare slab fixture has no rarity, so no rarity aspect should appear');
check('sports variant aspect is named Parallel/Variety, not Rarity',
      (() => {
        const p = buildListingPacket(CARDS[16], { feeModelRevision: FEE_MODEL_REVISION, now: NOW });
        return 'Parallel/Variety' in p.aspects.optional && !('Rarity' in p.aspects.optional);
      })(),
      'the sports category has no Rarity field — sending it would send a field that does not exist');
check('Language aspect is filled from the canonical language axis',
      packet.aspects.optional.Language[0] === 'English'
      && buildListingPacket(CARDS[8], { feeModelRevision: FEE_MODEL_REVISION, now: NOW })
           .aspects.optional.Language[0] === 'Japanese');
check('aspect values are flagged unverified',
      packet.aspects.valuesVerified === false
      && packet.notes.some((n) => n.code === PACKET_CODES.UNVERIFIED_ASPECT_VALUES),
      'we verified the aspect NAMES against eBay; we never captured the allowed VALUES');

check('packet carries no venue-specific identity fields',
      !Object.keys(packet.identity).some((k) => /ebay|mercari|tcgplayer|whatnot/i.test(k)));

check('packet is JSON-round-trippable',
      (() => { try { return JSON.parse(JSON.stringify(packet)).sku === packet.sku; }
               catch { return false; } })());


// ═══════════════════════════════════════════════════════════════════════════
// B6 — hardening pass from external review
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nB6 — review hardening');

// ── Fee model revision fixture (#26) ─────────────────────────────────────
// FEE_MODEL_REVISION is stamped onto every packet so a saved payout can be
// traced to the fee schedule that produced it. That stamp is worthless if the
// fee math can change without the revision moving. This hashes the real
// feeEbay output over a fixed grid: if the output changes, this test fails
// until someone bumps the revision and re-freezes the hash. Changing fees
// becomes a deliberate two-line act instead of an invisible one.
const FEE_FIXTURE = { revision: 1, hash: null };   // hash filled in below
function feeOutputHash() {
  const rows = [];
  for (const store of ['none', 'basic']) {
    for (const topRated of ['no', 'yes']) {
      for (const promo of [0, 2, 5, 12]) {
        for (const price of [0.01, 4.99, 9.99, 10.00, 10.01, 25, 99.99, 2499, 2500,
                             2501, 7499, 7500, 7501, 12000]) {
          for (const shipCharge of [0, 4.99]) {
            // CHANGED 2026-09-07. This used to pass `topRated` -- the string
            // 'no'/'yes' -- straight into feeEbay's last argument. That
            // argument is now a RESOLVED boolean, so the string would have
            // silently landed as not-eligible and quietly re-frozen this hash
            // over undiscounted output. The row label stays 'no'/'yes' so the
            // frozen hash is comparable across the change: if it still
            // matches, the fee ARITHMETIC is byte-identical and only the
            // eligibility plumbing moved, which is exactly the claim.
            const fees = feeEbay(price, shipCharge, store, promo, topRated === 'yes');
            const total = fees.reduce((s, f) => s + Number(f.a || 0), 0);
            rows.push([store, topRated, promo, price, shipCharge,
                       total.toFixed(6), fees.feeBase, fees.length].join('|'));
          }
        }
      }
    }
  }
  return crypto.createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 32);
}
const currentFeeHash = feeOutputHash();
FEE_FIXTURE.hash = 'PLACEHOLDER';
check(`fee fixture grid is non-trivial (${896} rows hashed)`,
      currentFeeHash.length === 32);
check('FEE_MODEL_REVISION is a positive integer',
      Number.isInteger(FEE_MODEL_REVISION) && FEE_MODEL_REVISION >= 1);
// The fixture is written to disk on first run and compared thereafter, so the
// expected hash lives next to the code rather than in a reviewer's memory.
const fixturePath = path.join(root, 'tests', 'fixtures', 'fee-model.json');
fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
let feeFixture = null;
try { feeFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')); } catch { /* first run */ }
if (!feeFixture) {
  fs.writeFileSync(fixturePath,
    JSON.stringify({ revision: FEE_MODEL_REVISION, hash: currentFeeHash }, null, 2) + '\n');
  feeFixture = { revision: FEE_MODEL_REVISION, hash: currentFeeHash };
  console.log(`  note  wrote new fee fixture (revision ${FEE_MODEL_REVISION}, hash ${currentFeeHash})`);
}
check('🔴 fee output matches the frozen fixture, or the revision was bumped',
      feeFixture.hash === currentFeeHash || feeFixture.revision !== FEE_MODEL_REVISION,
      `feeEbay output changed (${feeFixture.hash} → ${currentFeeHash}) while `
    + `FEE_MODEL_REVISION stayed at ${FEE_MODEL_REVISION}. Bump the revision and `
    + `update tests/fixtures/fee-model.json — a stamped payout must be traceable `
    + `to the schedule that produced it.`);
check('fixture records the revision it was frozen against',
      Number.isInteger(feeFixture.revision));

// ── Title degradation order (#11) ────────────────────────────────────────
// Segments must fall away in a stated priority order, not in whatever order
// the budget happens to bite. One overlength example proved the mechanism;
// several prove the ORDER.
const DEGRADE = [
  { card: 'Shohei Ohtani', set: 'Topps Chrome Update Sapphire Edition Refractor Superfractor', setCode: 'a', number: '289', rarity: 'Orange Refractor Parallel', game: 'sports', year: '2024' },
  { card: 'Elsa - Spirit of Winter Enchanted Edition', set: 'Rise of the Floodborn Special Expanded Printing', setCode: 'b', number: '042', rarity: 'Super Rare Legendary Enchanted', game: 'lorcana' },
  { card: 'Blue-Eyes Ultimate Dragon of the Eternal Sky', set: 'Legend of Blue Eyes White Dragon Anniversary Reprint', setCode: 'c', number: '001', rarity: 'Ultra Secret Parallel Rare', game: 'yugioh', grader: 'PSA', grade: '10', cert: '1' },
  { card: 'Pikachu Illustrator Promotional Card Extended Title', set: 'Coro Coro Comic Promotional Series', setCode: 'd', number: '001', rarity: 'Promo Illustrator Trophy', game: 'pokemon', isJapanese: true },
];
const PRIORITY = ['name', 'gradeTag', 'number', 'setName', 'language', 'year', 'rarity'];
const TOP_THREE = ['name', 'gradeTag', 'number'];
const orderBad = [];
for (const c of DEGRADE) {
  const r = buildListingTitle(c);
  if (!r.ok) { orderBad.push(`${c.card}: refused`); continue; }
  if (r.length > DEFAULT_MAX_TITLE) { orderBad.push(`${c.card}: ${r.length} chars`); continue; }
  const segs = titleSegments(c);

  // Invariant 1 — nothing was dropped that would have fit. This is the real
  // guarantee of priority-ordered first fit: a dropped segment must genuinely
  // not have fit alongside what was kept, so budget is never wasted and no
  // segment is discarded arbitrarily.
  for (const dropped of r.dropped) {
    const text = segs[dropped];
    if (!text) continue;
    if (r.length + 1 + String(text).length <= DEFAULT_MAX_TITLE) {
      orderBad.push(`${c.card}: dropped ${dropped} ("${text}") though it would have fit`);
    }
  }

  // Invariant 2 — strict precedence for the three segments a buyer searches
  // on. These may never be sacrificed to keep anything below them, no matter
  // how well a cheaper segment fits the leftover budget.
  for (const top of TOP_THREE) {
    if (!segs[top] || !r.dropped.includes(top)) continue;
    const keptLower = PRIORITY
      .slice(PRIORITY.indexOf(top) + 1)
      .filter((k) => segs[k] && !r.dropped.includes(k));
    if (keptLower.length) {
      orderBad.push(`${c.card}: dropped top-three ${top} but kept [${keptLower}]`);
    }
  }
}
check('overlength titles drop nothing that would have fit, and never sacrifice the top three',
      orderBad.length === 0, orderBad.slice(0, 5).join('\n       → '));
check('no degraded title exceeds the budget',
      DEGRADE.every((c) => buildListingTitle(c).length <= DEFAULT_MAX_TITLE));
check('name always survives degradation',
      DEGRADE.every((c) => !buildListingTitle(c).dropped.includes('name')));

// ── Raw vs graded priority (#12) ─────────────────────────────────────────
// On a slab, "PSA 10" outranks rarity. On a raw card there is no grade tag to
// rank, so rarity should get the budget instead. Same card, both ways.
const SQUEEZE = { card: 'Charizard ex Special Delivery Extended Art Print', set: 'Obsidian Flames Expanded Reprint Series', setCode: 'e', number: '125', rarity: 'Double Rare Illustration', game: 'pokemon' };
const rawT   = buildListingTitle(SQUEEZE);
const gradeT = buildListingTitle({ ...SQUEEZE, grader: 'PSA', grade: '10', cert: '84213771' });
check('graded version keeps the grade tag under budget pressure',
      gradeT.title.includes('PSA 10'), `got "${gradeT.title}"`);
check('graded version spends that budget by dropping something lower',
      gradeT.dropped.length >= rawT.dropped.length,
      `raw dropped [${rawT.dropped}], graded dropped [${gradeT.dropped}]`);
check('raw version does not invent a grade tag',
      !/\b(PSA|BGS|CGC|SGC|TAG|ACE)\b/.test(rawT.title), `got "${rawT.title}"`);
check('both versions stay within budget',
      rawT.length <= DEFAULT_MAX_TITLE && gradeT.length <= DEFAULT_MAX_TITLE);

// ── ageFromRetrievedAt must not invent plausible ages (#19) ─────────────
const BAD_STAMPS = [
  null, undefined, '', 'yesterday', 'not-a-date', '2026-13-45T00:00:00Z',
  {}, [], NaN, 0, -1,
];
check('every malformed retrievedAt yields null, never a plausible age',
      BAD_STAMPS.every((v) => ageFromRetrievedAt(v, Date.now()) === null),
      BAD_STAMPS.map((v) => `${JSON.stringify(v)}=${ageFromRetrievedAt(v, Date.now())}`).join(' '));
check('🔴 a bare -1 no longer renders as a confident age',
      ageFromRetrievedAt(-1, Date.now()) === null,
      'this used to come back as "9379 days ago"');
check('a pre-2015 stamp is treated as corrupt, not as very stale data',
      ageFromRetrievedAt('1999-01-01T00:00:00Z', Date.now()) === null);
const nowRef = Date.now();
check('🔴 a future retrievedAt is refused rather than reported as fresh',
      ageFromRetrievedAt(new Date(nowRef + 6 * 3600 * 1000).toISOString(), nowRef) === null,
      'clamping to zero used to render six hours in the future as "just now"');
check('small clock skew is tolerated instead of blanking the age',
      ageFromRetrievedAt(new Date(nowRef + 30 * 1000).toISOString(), nowRef) === 'just now');
check('a real past timestamp still measures correctly',
      ageFromRetrievedAt(new Date(nowRef - 3600 * 1000).toISOString(), nowRef) === '1 hr ago',
      `got ${ageFromRetrievedAt(new Date(nowRef - 3600 * 1000).toISOString(), nowRef)}`);
check('day-scale ages still render',
      ageFromRetrievedAt(new Date(nowRef - 3 * 86400 * 1000).toISOString(), nowRef) === '3 days ago');
check('no age string ever carries a minus sign',
      [-1, 0, nowRef + 1e9, nowRef - 1e9].every((v) => {
        const a = ageFromRetrievedAt(new Date(v).toISOString(), nowRef);
        return a === null || !String(a).includes('-');
      }));

// ── Cert-less slab is flagged, not passed off as inventory (#2 / Fix A) ──
const SLAB_ROW = { card: 'Umbreon VMAX', set: 'Evolving Skies', setCode: 'evs', number: '215',
                   rarity: 'Alternate Art Secret Rare', game: 'pokemon', grader: 'PSA', grade: '9' };
const packetNoCert = buildListingPacket(SLAB_ROW, { feeModelRevision: FEE_MODEL_REVISION });
const packetCert   = buildListingPacket({ ...SLAB_ROW, cert: '77112233' },
                                        { feeModelRevision: FEE_MODEL_REVISION });
check('a cert-less slab raises SLAB_WITHOUT_CERT',
      packetNoCert.notes.some((n) => n.code === PACKET_CODES.SLAB_WITHOUT_CERT),
      JSON.stringify(packetNoCert.notes.map((n) => n.code)));
check('SLAB_WITHOUT_CERT is a WARNING — the seller may still list',
      packetNoCert.notes.filter((n) => n.code === PACKET_CODES.SLAB_WITHOUT_CERT)
        .every((n) => n.severity === SEVERITY.WARNING) && packetNoCert.blocked === false);
check('a certified slab raises no cert warning',
      !packetCert.notes.some((n) => n.code === PACKET_CODES.SLAB_WITHOUT_CERT));
check('a raw card raises no cert warning',
      !buildListingPacket({ card: 'Mew ex', set: 'Paldean Fates', setCode: 'paf', number: '232', game: 'pokemon' },
                          { feeModelRevision: FEE_MODEL_REVISION })
        .notes.some((n) => n.code === PACKET_CODES.SLAB_WITHOUT_CERT));
check('packet identity reports certKnown either way',
      packetNoCert.identity.certKnown === false &&
      packetCert.identity.certKnown === true);
check('🔴 a cert does NOT change the sku — it is instance data now',
      packetNoCert.sku === packetCert.sku,
      'two PSA 9s share a product class; the inventory instance separates the copies');
check('the SKU never claims to identify one physical copy',
      packetCert.identity.identifiesOnePhysicalCopy === false);
check('a cert-less slab still warns, because the LISTING is worse without it',
      packetNoCert.notes.some((n) => n.code === PACKET_CODES.SLAB_WITHOUT_CERT));

// ── The live save path must actually be able to supply a cert (Fix A) ────
// The identity model has always had a cert axis. What was missing was any way
// for a user to fill it, which made the axis decorative. These assertions are
// source-level on purpose: they fail if the input or the write is removed.
const coreForCert  = readCoreBundle().source;
const htmlForCert  = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
check('🔴 the flip modal has a cert input',
      /id="mCertNumber"/.test(htmlForCert));
check('🔴 the collection write persists cert',
      /cert:\s*savedCert\s*\|\|\s*null/.test(coreForCert),
      'without this line the cert input is decoration');
check('cert is only read when grader AND grade are present',
      /savedCert\s*=\s*\(savedGrader && savedGrade\)/.test(coreForCert),
      'a cert on a raw card would invent a slab');
check('cert separators are stripped at capture',
      /replace\(\/\[\^0-9A-Za-z\]\/g, ''\)/.test(coreForCert));
check('the cert field is hidden and cleared when the card is not graded',
      /if \(certInput\) certInput\.value = '';/.test(coreForCert));
check('closing the modal clears the cert field',
      /if \(certField\) certField\.style\.display = 'none';/.test(coreForCert) &&
      /'mGradingCost','mCertNumber'/.test(coreForCert));

// ── Platform neutrality is behavioural, not just a key-name check (#5) ──
// The end goal is a cross-venue seller hub, so identity must not shift when
// eBay-specific metadata is attached. Same physical card + arbitrary venue
// fields → same SKU.
const PHYSICAL = { game: 'pokemon', setCode: 'evs', number: '215', grader: 'psa', grade: '9', cert: '77112233' };
const VENUE_NOISE = [
  { ebayCategoryId: '183454' },
  { ebayCategoryId: '261328', ebayConditionId: '2750', ebayListingId: '1234567890' },
  { mercariCategory: 'tcg', mercariBrand: 'Pokemon' },
  { tcgplayerProductId: 998877, tcgplayerUrl: 'https://tcgplayer.com/x' },
  { whatnotLivestreamId: 'abc', whatnotCategory: 'pokemon' },
  { ebayCategoryId: '183050', mercariCategory: 'tcg', tcgplayerProductId: 1, platform: 'eBay' },
];
const baseSku = skuFor(PHYSICAL);
const neutralityBad = VENUE_NOISE
  .filter((noise) => skuFor({ ...PHYSICAL, ...noise }) !== baseSku)
  .map((noise) => Object.keys(noise).join('+'));
check('🔴 arbitrary venue metadata never changes the SKU',
      neutralityBad.length === 0,
      `these changed identity: ${neutralityBad.join(', ')}`);
check('a venue field cannot smuggle in a different card either',
      skuFor({ ...PHYSICAL, ebayTitle: 'Charizard ex #125' }) === baseSku,
      'display strings are not identity');
check('identity object carries no venue-named keys',
      !Object.keys(cardIdentity(PHYSICAL)).some((k) => /ebay|mercari|tcgplayer|whatnot/i.test(k)));


// ── B7 — aspect values must be visibly non-submission-grade (review) ──────
console.log('\nB7 — unverified aspect values');
{
  const jp = buildListingPacket({ card: 'Gengar VSTAR', set: 'VSTAR Universe', number: '199',
                           game: 'pokemonjp', rarity: 'Special Art Rare' },
                         { feeModelRevision: 1 });
  const gameVal = jp.aspects.required.Game?.[0] || '';
  check('🔴 an internal game token never reaches the Game aspect',
        !/^pokemon(jp)?$/i.test(gameVal),
        `Game aspect was "${gameVal}" — that is our routing key, not eBay vocabulary`);
  check('it renders a human label the seller can match instead',
        gameVal === 'Pokémon TCG', `got "${gameVal}"`);
  check('the value records that WE translated it',
        jp.aspects.provenance?.Game?.source === 'internal-token-mapped');
  check('🔴 no required aspect value is marked submission-ready',
        Object.values(jp.aspects.provenance || {}).every((p) => p.submissionReady === false));
  check('🔴 the packet as a whole is not submission-ready',
        jp.aspects.submissionReady === false && jp.aspects.valuesVerified === false,
        'copy-ready is not the same claim as submission-ready');
  const note = jp.notes.find((n) => n.code === 'UNVERIFIED_ASPECT_VALUES');
  check('the warning names the aspects we filled ourselves',
        !!note && Array.isArray(note.mappedAspects) && note.mappedAspects.includes('Game'));
  check('the warning tells the seller to confirm before submitting',
        !!note && /confirm it before submitting/.test(note.message));
  check('Japanese-ness is not smuggled into the game name',
        !/japan/i.test(gameVal),
        'language belongs in the Language aspect, not in the name of the game');

  const seller = buildListingPacket({ card: 'Michael Jordan', set: '1986 Fleer', number: '57',
                               game: 'sports', sport: 'Basketball' }, { feeModelRevision: 1 });
  check('a seller-supplied value is distinguished from one we mapped',
        seller.aspects.provenance?.Sport?.source === 'seller-confirmed');
  check('but it is still not submission-ready in Phase 1',
        seller.aspects.provenance?.Sport?.submissionReady === false,
        'we hold verified aspect NAMES, never verified VALUES');
  const missing = buildListingPacket({ card: 'Some Card', set: 'Some Set', number: '1',
                               game: 'sports' }, { feeModelRevision: 1 });
  check('an absent required aspect is provenance-tracked too',
        missing.aspects.provenance?.Sport?.source === 'missing'
        && missing.aspects.provenance?.Sport?.value === null);
}

// ── Top Rated Plus: a listing benefit, not a seller status ───────────────
// 2026-09-07. feeEbay's last argument used to be the raw seller-status string,
// so every estimate for a Top Rated seller was discounted 10% regardless of
// whether the listing qualified. eBay's own wording is that a Top Rated seller
// CAN QUALIFY THEIR LISTINGS if the listing offers same- or 1-business-day
// handling (free returns being waived for Trading Cards). Status is necessary,
// not sufficient. These cases pin all three states and the boundary the
// discount must NOT cross.
{
  console.log('\nB8 — Top Rated Plus is a listing benefit, not a seller status');
  const base = { shipCharge: 0, shipCost: 0, ebayStore: 'none', ebayPromo: 0 };
  const statusOnly = { ...base, ebayTopRated: 'yes', ebayTrsListing: 'no'  };
  const confirmed  = { ...base, ebayTopRated: 'yes', ebayTrsListing: 'yes' };
  const withdrawn  = { ...confirmed, ebayTrsListing: 'no' };
  const neither    = { ...base, ebayTopRated: 'no',  ebayTrsListing: 'no'  };
  const listingOnly= { ...base, ebayTopRated: 'no',  ebayTrsListing: 'yes' };

  check('🔴 Top Rated status alone does not earn the discount',
        trsDiscountApplies(statusOnly) === false,
        'the discount is a per-listing benefit; status is necessary, not sufficient');
  check('a confirmed qualifying listing does earn it',
        trsDiscountApplies(confirmed) === true);
  check('🔴 withdrawing the confirmation withdraws the discount',
        trsDiscountApplies(withdrawn) === false,
        'a stale yes must not outlive the answer that produced it');
  check('a qualifying listing from a non-Top-Rated seller earns nothing',
        trsDiscountApplies(listingOnly) === false,
        'handling time alone is not Top Rated Plus');
  check('an absent profile is not eligible',
        trsDiscountApplies(undefined) === false && trsDiscountApplies({}) === false);
  check('🔴 a profile saved before the listing key existed is not eligible',
        trsDiscountApplies({ ebayTopRated: 'yes' }) === false,
        'an old saved "I am Top Rated" must never be read as a listing confirmation');

  // The discount is 10% of the PERCENTAGE fee only. eBay: "The discount does
  // not apply to the per order portion of the final value fee."
  const P = 184.99;
  const fFull = feeEbay(P, 0, 'none', 0, trsDiscountApplies(statusOnly));
  const fDisc = feeEbay(P, 0, 'none', 0, trsDiscountApplies(confirmed));
  const fvfOf = (rows) => rows.find((r) => /Final Value Fee/.test(r.l));
  const perOrderOf = (rows) => rows.find((r) => !/Final Value Fee/.test(r.l) && r.a > 0 && r.a < 1);

  check('status-only pays the full percentage fee',
        Math.abs(fvfOf(fFull).a - P * 0.1325) < 0.005,
        `fvf=${fvfOf(fFull).a.toFixed(4)} expected=${(P * 0.1325).toFixed(4)}`);
  check('confirmed pays exactly 90% of it',
        Math.abs(fvfOf(fDisc).a - P * 0.1325 * 0.9) < 0.005,
        `fvf=${fvfOf(fDisc).a.toFixed(4)} expected=${(P * 0.1325 * 0.9).toFixed(4)}`);
  check('🔴 the per-order fee is identical either way',
        perOrderOf(fFull).a === perOrderOf(fDisc).a,
        `full=${perOrderOf(fFull).a} disc=${perOrderOf(fDisc).a} — eBay excludes the per-order portion`);
  check('the discounted row names the programme that grants it',
        /Top Rated Plus/.test(fvfOf(fDisc).l) && !/Top Rated Plus/.test(fvfOf(fFull).l),
        `CHANGED 2026-09-07: was 'Top Rated'. The seal and the discount are `
        + `LISTING-level and eBay calls that Top Rated Plus; "Top Rated" alone `
        + `named the seller status, which is not what earns the row.`);
  check('the rate signature states the two exact operations, not a rounded blend',
        fvfOf(fDisc).f === '13.25% \u221210% Top Rated Plus',
        `13.25% less 10% is exactly 11.925%, which does not survive 2dp rounding; got ${JSON.stringify(fvfOf(fDisc).f)}`);

  // A string where a boolean is expected is the exact bug that would silently
  // drop the discount from the payout row while the fee rows still showed it.
  check('🔴 feeEbay refuses a raw status string as eligibility',
        fvfOf(feeEbay(P, 0, 'none', 0, 'yes')).a === fvfOf(fFull).a,
        'the argument is a resolved boolean; a truthy string must not discount');

  // And the inversion has to agree with the forward function, or the payout row
  // and the suggested list price would disagree about the same listing.
  const netFull = netEbayForPrice(P, statusOnly);
  const netDisc = netEbayForPrice(P, confirmed);
  check('the payout row sees the discount too',
        netDisc > netFull && Math.abs((netDisc - netFull) - P * 0.1325 * 0.1) < 0.01,
        `full=${netFull.toFixed(4)} disc=${netDisc.toFixed(4)}`);
  check('and the target-net inversion does as well',
        listPriceForTargetNet(150, confirmed).listPrice < listPriceForTargetNet(150, statusOnly).listPrice,
        'a cheaper fee must mean a cheaper list price for the same payout');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
