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
  PACKET_INPUT_FIELDS, packetInputFingerprint, stampPriceBasisReporting,
  readStoredPacket, PACKET_COMPAT, PACKET_MIGRATIONS, normalizeShippingAssumptions,
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

// CHANGED TWICE ON 2026-09-07, and the second change is the interesting one.
//
// First: these contexts used to set `ebayTopRated: 'yes'` alone and expect the
// 10% discount. They no longer get it from status alone, because the discount
// is a per-LISTING benefit. `ebayTrsListing: 'yes'` was added as a second
// required field. The 'top rated status only' row was added at the same time
// and pins the case the old contexts silently mis-modelled: status without a
// qualifying listing pays the FULL fee.
//
// Second, after the third review: `ebayTrsListing` was the wrong shape. It read
// as one more seller field, and in production it really was one -- persisted,
// global, and therefore able to discount a card the seller never answered
// about. These contexts now carry `trsEligible`, a resolved boolean that the
// surface pricing the listing must supply. A ctx that omits it is not eligible,
// which is the correct default and the reason this field is not optional-truthy.
const CTXS = [
  { name: 'default no-store',      shipCharge: 0, shipCost: 0, ebayStore: 'none',  ebayPromo: 0, ebayTopRated: 'no' },
  { name: 'top rated + listing ok', shipCharge: 0, shipCost: 0, ebayStore: 'none',  ebayPromo: 0, ebayTopRated: 'yes', trsEligible: true },
  { name: 'basic store',           shipCharge: 0, shipCost: 0, ebayStore: 'basic', ebayPromo: 0, ebayTopRated: 'no' },
  { name: 'buyer-paid shipping',   shipCharge: 5, shipCost: 4.50, ebayStore: 'none', ebayPromo: 0, ebayTopRated: 'no' },
  { name: 'promoted 3%',           shipCharge: 0, shipCost: 0, ebayStore: 'none',  ebayPromo: 3, ebayTopRated: 'no' },
  { name: 'everything at once',    shipCharge: 5.95, shipCost: 5.10, ebayStore: 'basic', ebayPromo: 4, ebayTopRated: 'yes', trsEligible: true },
  { name: 'top rated status only', shipCharge: 0, shipCost: 0, ebayStore: 'none',  ebayPromo: 0, ebayTopRated: 'yes', trsEligible: false },
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

check('packet carries all five metadata fields (fee pair renamed to clientDeclared*)',
      packet.metadata.packetSchemaVersion === PACKET_SCHEMA_VERSION
      && packet.metadata.taxonomyTreeVersion === '134'
      && packet.metadata.clientDeclaredFeeModelRevision === FEE_MODEL_REVISION
      && packet.metadata.clientDeclaredFeeScheduleDate === '2026-09'
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
        return p.metadata.clientDeclaredFeeModelRevision === null && p.blocked === true
          && p.blockingCodes.includes(PACKET_CODES.MISSING_FEE_MODEL_REVISION);
      })(),
      'a silent fallback would let core.js and the packet drift — the exact ambiguity this field removes');

// ---------------------------------------------------------------------------
// The no-default rule, pinned against the pressure that will be applied to it.
//
// MISSING_FEE_MODEL_REVISION is an ERROR by design, and once the producer is
// connected it will appear in logs whenever a client omits the field. An error
// in logs reads as a thing to silence, and the cheapest silence is a default —
// `ctx.feeModelRevision ?? 1`, or `?? FEE_MODEL_REVISION` re-declared
// server-side. Either one makes every affected packet claim it was priced by a
// fee revision that never priced it, and the claim is unfalsifiable afterwards
// because the packet no longer records that it did not know.
//
// A default here is worse than the error it hides: the error is loud and
// recoverable, the default is quiet and permanent. These checks exist so that
// change cannot be made without a test going red and someone reading this.
// ---------------------------------------------------------------------------
for (const [label, bad] of [
  ['absent',          {}],
  ['undefined',       { feeModelRevision: undefined }],
  ['null',            { feeModelRevision: null }],
  ['zero-as-absent',  { feeModelRevision: NaN }],
  ['string "3"',      { feeModelRevision: '3' }],
  ['float 3.5',       { feeModelRevision: 3.5 }],
]) {
  check(`feeModelRevision ${label} blocks rather than defaulting`,
        (() => {
          const p = buildListingPacket(slab, { ...bad, feeScheduleVerified: 'Sep 2026', now: NOW });
          return p.metadata.clientDeclaredFeeModelRevision === null
            && p.blocked === true
            && p.blockingCodes.includes(PACKET_CODES.MISSING_FEE_MODEL_REVISION);
        })(),
        'a packet that cannot say which fee logic priced it must say so, not guess');
}

// The other half of the rule: a revision that IS supplied is recorded verbatim
// and not normalised, floored, or replaced by the server's idea of current.
// Without this, "no default" could be satisfied by a producer that quietly
// overwrites a stale-but-honest client value with a fresh-but-wrong one.
check('a supplied feeModelRevision is recorded verbatim, not normalised',
      (() => {
        const p = buildListingPacket(slab, {
          feeModelRevision: 1, feeScheduleVerified: 'Sep 2026', now: NOW,
        });
        return p.metadata.clientDeclaredFeeModelRevision === 1
          && !p.blockingCodes.includes(PACKET_CODES.MISSING_FEE_MODEL_REVISION);
      })(),
      'an older revision honestly reported beats a current one asserted on its behalf');

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
  /* CHANGED 2026-09-07 (third review). These cases used to carry the listing
     confirmation as a profile field -- `{ ebayTopRated: 'yes', ebayTrsListing:
     'yes' }` -- and call `trsDiscountApplies(prof)` with one argument. The
     review's finding was that a per-listing answer cannot live in the profile
     at all, so the confirmation is now the rule's SECOND argument and the
     profile carries only the seller's status. Every expected verdict below is
     unchanged; only where the confirmation comes from has moved. The retired
     case 'a profile saved before the listing key existed is not eligible' is
     replaced by two stronger ones: the rule ignores a profile-borne
     confirmation entirely, and it refuses a truthy non-boolean. */
  const base = { shipCharge: 0, shipCost: 0, ebayStore: 'none', ebayPromo: 0 };
  const topRated  = { ...base, ebayTopRated: 'yes' };
  const notRated  = { ...base, ebayTopRated: 'no'  };
  // ctx for the payout/inversion helpers now carries a resolved boolean.
  const statusOnly = { ...topRated, trsEligible: false };
  const confirmed  = { ...topRated, trsEligible: true  };

  check('🔴 Top Rated status alone does not earn the discount',
        trsDiscountApplies(topRated, false) === false,
        'the discount is a per-listing benefit; status is necessary, not sufficient');
  check('a confirmed qualifying listing does earn it',
        trsDiscountApplies(topRated, true) === true);
  check('🔴 withdrawing the confirmation withdraws the discount',
        trsDiscountApplies(topRated, false) === false,
        'a stale yes must not outlive the answer that produced it');
  check('a qualifying listing from a non-Top-Rated seller earns nothing',
        trsDiscountApplies(notRated, true) === false,
        'handling time alone is not Top Rated Plus');
  check('an absent profile is not eligible',
        trsDiscountApplies(undefined, true) === false && trsDiscountApplies({}, true) === false);
  check('🔴 a confirmation carried on the profile is ignored',
        trsDiscountApplies({ ebayTopRated: 'yes', ebayTrsListing: 'yes' }) === false,
        'the rule must not be able to reach a global answer, even if one is handed to it');
  check('🔴 a truthy non-boolean is not a confirmation',
        trsDiscountApplies(topRated, 'yes') === false
        && trsDiscountApplies(topRated, 1) === false
        && trsDiscountApplies(topRated, {}) === false,
        'only an explicit true counts, so a select element or a status string cannot stand in');

  // The discount is 10% of the PERCENTAGE fee only. eBay: "The discount does
  // not apply to the per order portion of the final value fee."
  const P = 184.99;
  const fFull = feeEbay(P, 0, 'none', 0, trsDiscountApplies(topRated, false));
  const fDisc = feeEbay(P, 0, 'none', 0, trsDiscountApplies(topRated, true));
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

// ===========================================================================
// THE FEE-SCHEDULE STAMP — found by sequencing, not by a red test
//
// Found while wiring the client, BEFORE anything rendered a packet, and that
// order is the only reason it was found at all. The docblock for
// buildListingPacket said feeScheduleVerified comes from
// `PLATFORMS.ebay.verified`. No such field exists. The real one is
// `feeAuditedOn: '2026-09-01'` — and `YYYY-MM-DD` matched neither branch of
// normalizeVerifiedStamp, so it fell out as null.
//
// Three defects stacked, each individually survivable:
//   1. the docblock named a field that does not exist, and it is the only
//      instruction whoever wires a caller has;
//   2. the format the real field uses was not accepted;
//   3. a null result was reported NOWHERE — no code, no severity, nothing.
//
// (3) is what made the other two invisible. A packet with a silently-null
// stamp is not blocked and raises no finding, so a client wired straight from
// the docblock produces a clean-LOOKING packet with a missing field, and the
// first person to notice is debugging the review screen's renderer.
// TAXONOMY_VERSION_ASSUMED, in the same code table, is the precedent: when a
// version is not live-read, a code says so. The omission was an omission.
// ===========================================================================
console.log('\nthe fee-schedule stamp: the real field format, and the two ways it can be missing');
{
  const FS_CARD = () => ({
    name: 'Charizard', setName: 'Base Set', number: '4', year: 1999,
    game: 'pokemon', condition: 'near mint',
  });
  const codesOf = (p) => (p.notes || []).map((w) => w.code);

  check('\u{1F534} the YYYY-MM-DD stamp the venue table really carries is accepted',
        normalizeVerifiedStamp('2026-09-01') === '2026-09',
        `got ${JSON.stringify(normalizeVerifiedStamp('2026-09-01'))} \u2014 that string is PLATFORMS.ebay.feeAuditedOn verbatim`);
  check('the day is dropped, not carried',
        normalizeVerifiedStamp('2026-09-30') === '2026-09',
        'a fee schedule has month granularity; the stamp answers WHICH schedule, not when we looked');
  for (const [inp, want] of [['2026-09', '2026-09'], ['Sep 2026', '2026-09'], ['Sept. 2026', '2026-09']])
    check(`the previously-accepted form ${JSON.stringify(inp)} still normalizes`,
          normalizeVerifiedStamp(inp) === want, `got ${normalizeVerifiedStamp(inp)}`);
  for (const bad of ['2026-9-1', '09/01/2026', 'garbage', '2026'])
    check(`${JSON.stringify(bad)} is still refused rather than guessed at`,
          normalizeVerifiedStamp(bad) === null,
          'widening this into a general date parser would start inventing months');

  const absent = buildListingPacket(FS_CARD(), { feeModelRevision: 1, now: NOW });
  check('\u{1F534} an absent stamp is now REPORTED rather than silently null',
        codesOf(absent).includes(PACKET_CODES.FEE_SCHEDULE_DATE_ABSENT),
        JSON.stringify(codesOf(absent)));

  const drifted = buildListingPacket(FS_CARD(), {
    feeModelRevision: 1, feeScheduleVerified: '09/01/2026', now: NOW,
  });
  check('\u{1F534} a stamp that arrived but could not be read is a DIFFERENT code',
        codesOf(drifted).includes(PACKET_CODES.FEE_SCHEDULE_DATE_UNPARSEABLE)
        && !codesOf(drifted).includes(PACKET_CODES.FEE_SCHEDULE_DATE_ABSENT),
        JSON.stringify(codesOf(drifted))
        + ' \u2014 unparseable means the format on the other side MOVED; absent does not');

  check('both leave the packet UNBLOCKED',
        absent.blocked === false && drifted.blocked === false,
        'a listing is publishable without knowing which month the schedule was audited, and the '
        + 'arithmetic version it would gate is already carried by feeModelRevision');
  check('and both leave the stamp null rather than defaulting it to this month',
        absent.metadata.clientDeclaredFeeScheduleDate === null
        && drifted.metadata.clientDeclaredFeeScheduleDate === null,
        'same no-default rule as feeModelRevision: an unknown month is not this month');

  const good = buildListingPacket(FS_CARD(), {
    feeModelRevision: 1, feeScheduleVerified: '2026-09-01', now: NOW,
  });
  check('a readable stamp raises NEITHER code',
        !codesOf(good).includes(PACKET_CODES.FEE_SCHEDULE_DATE_ABSENT)
        && !codesOf(good).includes(PACKET_CODES.FEE_SCHEDULE_DATE_UNPARSEABLE),
        JSON.stringify(codesOf(good)));
  check('whitespace counts as absent, not as drift',
        codesOf(buildListingPacket(FS_CARD(), {
          feeModelRevision: 1, feeScheduleVerified: '   ', now: NOW,
        })).includes(PACKET_CODES.FEE_SCHEDULE_DATE_ABSENT),
        'a caller that sent nothing is not a format that changed');
}


// ─── NO_PRICE vs NO_TARGET_NET_PRICING vs basis-is-not-source ──────────────
// WAS: one code, NO_PRICE, triggered on the absence of ctx.pricing (the
// target-payout inversion) and worded "No list price computed. Set a target
// payout to get one." Name, message and trigger described three different
// things, and no test asserted any of them -- which is why changing the
// semantics could pass 175/0 in silence. Split because a priced draft with no
// inversion is normal and must not be told it has no price.
{
  console.log('\nNO_PRICE / NO_TARGET_NET_PRICING / basis provenance');
  const C = () => ({ name: 'Charizard', setName: 'Base Set', number: '4', year: 1999,
                     game: 'pokemon', condition: 'near mint' });
  const BASE = { feeModelRevision: 1, feeScheduleVerified: '2026-09-01', now: NOW };
  const bm = { label: 'TCGPlayer market', sourceUrl: 'https://www.tcgplayer.com/product/1',
               cacheAgeSec: 3600, low: 30, mid: 40, high: 55 };
  const codes = p => (p.notes || []).map(n => n.code);

  const priced = buildListingPacket(C(), { ...BASE, price: 250, priceSource: 'comp', basisMeta: bm });
  check('\u{1F534} a $250 comp-priced draft is NOT told it has no price',
        !codes(priced).includes(PACKET_CODES.NO_PRICE),
        'this is the regression: NO_PRICE used to fire here and render beside the price');
  // WAS: asserted NO_TARGET_NET_PRICING fires on this ordinary priced draft,
  // where no target payout was requested. That was the behaviour, and the
  // behaviour was wrong: no production UI offers target-net pricing, so the
  // warning appeared on every draft for declining a feature nobody was shown.
  // Now absent-request is absent optional analysis. The failure arm -- asked
  // and could not answer -- is asserted below.
  check('no target requested is silence, not a warning',
        !codes(priced).includes(PACKET_CODES.NO_TARGET_NET_PRICING));
  check('a target requested but uncomputable still warns',
        codes(buildListingPacket(C(), { ...BASE, price: 250, priceSource: 'comp', targetNet: 200 }))
          .includes(PACKET_CODES.NO_TARGET_NET_PRICING),
        'the two arms cannot share a gate: wrongly-absent is invisible, wrongly-present is noise');
  check('neither price note blocks the listing',
        priced.blocked === false && priced.blockingCodes.length === 0);

  const unpriced = buildListingPacket(C(), { ...BASE });
  check('a draft with no price still reports NO_PRICE',
        codes(unpriced).includes(PACKET_CODES.NO_PRICE));
  // WAS: 'an unpriced draft reports BOTH conditions' -- NO_PRICE and
  // NO_TARGET_NET_PRICING together. The two-names point still holds, but it
  // was demonstrated with a draft that never requested a target, so the
  // second code was noise rather than a second finding. Demonstrated now with
  // an unpriced draft that DID request one.
  check('unpriced AND target-requested reports both, neither standing in for the other',
        (() => {
          const c = codes(buildListingPacket(C(), { ...BASE, targetNet: 200 }));
          return c.includes(PACKET_CODES.NO_PRICE) && c.includes(PACKET_CODES.NO_TARGET_NET_PRICING);
        })());
  check('an unpriced draft with no target asked reports only NO_PRICE',
        codes(unpriced).includes(PACKET_CODES.NO_PRICE)
        && !codes(unpriced).includes(PACKET_CODES.NO_TARGET_NET_PRICING));

  const zero = buildListingPacket(C(), { ...BASE, price: 0, priceSource: 'seller' });
  check('$0 is a price, not the absence of one',
        !codes(zero).includes(PACKET_CODES.NO_PRICE),
        'some venues permit a zero-priced listing; falsiness is the wrong test');

  const inverted = buildListingPacket(C(), { ...BASE, price: 250, priceSource: 'comp',
                                             pricing: { ok: true, listPrice: 275, exact: true } });
  check('a real inversion result clears NO_TARGET_NET_PRICING',
        !codes(inverted).includes(PACKET_CODES.NO_TARGET_NET_PRICING));

  const sellerWithBasis = buildListingPacket(C(), { ...BASE, price: 250, priceSource: 'seller', basisMeta: bm });
  check('\u{1F534} a basis beside a seller-typed price is flagged as context, not provenance',
        codes(sellerWithBasis).includes(PACKET_CODES.PRICE_BASIS_NOT_SOURCE_OF_PRICE),
        'same asymmetry as SELLER_PRICED: presenting a typed number as comp-derived is the stronger false claim');
  check('the basis is retained, not stripped, when it is flagged',
        sellerWithBasis.priceBasis && sellerWithBasis.priceBasis.label === 'TCGPlayer market',
        'deleting evidence to avoid mislabelling it is the wrong trade');
  check('a comp-sourced price with the same basis is NOT flagged',
        !codes(priced).includes(PACKET_CODES.PRICE_BASIS_NOT_SOURCE_OF_PRICE));
  check('a seller price with no basis is NOT flagged',
        !codes(buildListingPacket(C(), { ...BASE, price: 250, priceSource: 'seller' }))
          .includes(PACKET_CODES.PRICE_BASIS_NOT_SOURCE_OF_PRICE),
        'nothing was mislabelled if nothing was stamped');

  check('priceSource is in the input fingerprint because the packet now reads it',
        PACKET_INPUT_FIELDS.includes('priceSource'),
        'a field that changes packet bytes and is absent from the fingerprint is a stale packet waiting for the write site nobody has written yet');
  check('adding it actually changes the fingerprint',
        packetInputFingerprint({ price: 250, priceSource: 'comp', title: 'T' })
        !== packetInputFingerprint({ price: 250, priceSource: 'seller', title: 'T' }));
}


// ─── The producer-side normalizer sweep ────────────────────────────────────
// The question asked of every field this module normalizes: is there a code
// for the failure case? These rows all answered no, and each one resolved to
// a silent null that a review screen would render as an empty caption.
{
  console.log('\nnormalizer sweep: taxonomy version and price basis');
  const C = () => ({ name: 'Charizard', setName: 'Base Set', number: '4', year: 1999,
                     game: 'pokemon', condition: 'near mint' });
  const BASE = { feeModelRevision: 1, feeScheduleVerified: '2026-09-01', now: NOW,
                 price: 250, priceSource: 'comp' };
  const codes = p => (p.notes || []).map(n => n.code);
  const meta  = p => p.metadata;

  // ── Taxonomy: the mirror defect ─────────────────────────────────────────
  // A DIFFERENT severity class from the rest of the sweep. The others fail to
  // state something; this one accepted an unvalidated string, stamped it
  // 'live', and SUPPRESSED the honest fallback notice in the process.
  const garbage = buildListingPacket(C(), { ...BASE, taxonomyTreeVersion: 'complete garbage' });
  check('\u{1F534} a garbage taxonomy version can no longer buy the \'live\' label',
        meta(garbage).taxonomyTreeVersionSource === 'verified-constant',
        `got ${meta(garbage).taxonomyTreeVersionSource}`);
  check('\u{1F534} and it no longer SUPPRESSES the honest fallback notice',
        codes(garbage).includes(PACKET_CODES.TAXONOMY_VERSION_ASSUMED),
        'the inversion was that a dishonest input silenced the code that would have been correct');
  check('the drift is named as well as the fallback — both, not one',
        codes(garbage).includes(PACKET_CODES.TAXONOMY_VERSION_UNPARSEABLE));
  check('the recorded value is the verified constant, not the garbage',
        meta(garbage).taxonomyTreeVersion === '134');

  const live = buildListingPacket(C(), { ...BASE, taxonomyTreeVersion: '134' });
  check('a real eBay categoryTreeVersion is still accepted as live',
        meta(live).taxonomyTreeVersionSource === 'live'
        && !codes(live).includes(PACKET_CODES.TAXONOMY_VERSION_UNPARSEABLE));
  check('a numeric 134 is accepted too — eBay returns a string, callers may not',
        meta(buildListingPacket(C(), { ...BASE, taxonomyTreeVersion: 134 })).taxonomyTreeVersionSource === 'live');
  const blank = buildListingPacket(C(), { ...BASE, taxonomyTreeVersion: '   ' });
  check('whitespace counts as absent, not as drift — same rule as the fee schedule',
        codes(blank).includes(PACKET_CODES.TAXONOMY_VERSION_ASSUMED)
        && !codes(blank).includes(PACKET_CODES.TAXONOMY_VERSION_UNPARSEABLE));
  check('\'13.4\' is refused rather than salvaged',
        codes(buildListingPacket(C(), { ...BASE, taxonomyTreeVersion: '13.4' }))
          .includes(PACKET_CODES.TAXONOMY_VERSION_UNPARSEABLE));

  // ── Price basis: the live shape, not a hypothetical ─────────────────────
  // core:3326 and core:4845 both set _crBasis to exactly this. Every
  // sports-card price produces a basis with a label and nothing else.
  const sportsShape = { value: 40, low: null, mid: null, high: null,
                        label: 'SportsCardsPro guide \u00b7 1998 Kobe Bryant' };
  const sports = buildListingPacket(C(), { ...BASE, basisMeta: sportsShape });
  check('\u{1F534} the SportsCardsPro basis shape no longer stamps clean',
        codes(sports).includes(PACKET_CODES.PRICE_BASIS_AGE_ABSENT)
        && codes(sports).includes(PACKET_CODES.PRICE_BASIS_INCOMPLETE),
        'this is what core:3326 and core:4845 actually build');
  check('the missing fields are named, not just counted',
        (sports.notes.find(n => n.code === PACKET_CODES.PRICE_BASIS_INCOMPLETE) || {})
          .missing.join(',') === 'sourceUrl');

  const good = { label: 'TCGPlayer market', sourceUrl: 'https://www.tcgplayer.com/product/1',
                 cacheAgeSec: 3600, datedBySource: true };
  check('a complete basis raises none of the sweep codes',
        codes(buildListingPacket(C(), { ...BASE, basisMeta: good }))
          .every(c => !String(c).startsWith('PRICE_BASIS_')));

  check('absent age and unreadable age are DIFFERENT codes',
        codes(buildListingPacket(C(), { ...BASE, basisMeta: { ...good, cacheAgeSec: 'soon' } }))
          .includes(PACKET_CODES.PRICE_BASIS_AGE_UNPARSEABLE),
        'incomplete caller vs feed drift want different responses');
  check('a negative age is drift, not a valid retrieval time',
        codes(buildListingPacket(C(), { ...BASE, basisMeta: { ...good, cacheAgeSec: -5 } }))
          .includes(PACKET_CODES.PRICE_BASIS_AGE_UNPARSEABLE));

  check('a non-boolean dating flag is reported instead of reading as \'not dated\'',
        codes(buildListingPacket(C(), { ...BASE, basisMeta: { ...good, datedBySource: 'yes' } }))
          .includes(PACKET_CODES.PRICE_BASIS_DATING_UNPARSEABLE),
        'false is a CLAIM about the feed; unknown is not the same claim');
  check('an honestly false dating flag is NOT reported',
        !codes(buildListingPacket(C(), { ...BASE, basisMeta: { ...good, datedBySource: false } }))
          .includes(PACKET_CODES.PRICE_BASIS_DATING_UNPARSEABLE),
        'PriceCharting publishes no as-of date and that is already handled honestly');

  check('a comp-derived price with NO basis says so',
        codes(buildListingPacket(C(), { ...BASE })).includes(PACKET_CODES.PRICE_BASIS_ABSENT));
  check('a seller-typed price with no basis is NOT a finding',
        !codes(buildListingPacket(C(), { ...BASE, priceSource: 'seller' }))
          .includes(PACKET_CODES.PRICE_BASIS_ABSENT),
        'a seller who typed their own number owes no market basis');

  check('none of the sweep codes block a listing',
        buildListingPacket(C(), { ...BASE, basisMeta: sportsShape,
                                  taxonomyTreeVersion: 'garbage' }).blocked === false);

  // The wrapper and the reporting form cannot drift: one is defined as the other.
  check('stampPriceBasis is a thin wrapper over the reporting form',
        JSON.stringify(stampPriceBasis(good, NOW))
        === JSON.stringify(stampPriceBasisReporting(good, NOW).basis),
        'two parse implementations is how the stamp and its findings start disagreeing');
}

// ── Reviewer corrections, 2026-09-08 ──────────────────────────────────────
console.log('\nthe fingerprint proves the packet was built from the draft');
const codes = (p) => (p.notes || []).map((n) => n.code);

// THE COUNTEREXAMPLE, as a regression. Before this, buildDraft computed the
// fingerprint from the draft, so the stored value was the DRAFT's fingerprint
// and the reader inevitably agreed with it. A $100 packet on a $500 draft read
// as current. The builder now stamps what it consumed.
{
  const B = { feeModelRevision: 1, feeScheduleVerified: 'Sep 2026', now: NOW };
  const SLOT = 'ebay:fixed-price';
  const at = (p) => buildListingPacket(CARDS[0], { ...B, slot: SLOT, price: p, priceSource: 'comp' });
  const p100 = at(100), p500 = at(500);
  check('the builder stamps a fingerprint of its own inputs',
        typeof p100.metadata.inputFingerprint === 'string'
        && p100.metadata.inputFingerprint.includes('price=number:100'));
  check('a different price yields a different stamp',
        p100.metadata.inputFingerprint !== p500.metadata.inputFingerprint);
  check('\u{1F534} the stamp is the packet\u2019s claim, so a $100 packet cannot describe a $500 draft',
        p100.metadata.inputFingerprint
          !== packetInputFingerprint({ sku: p100.sku, slot: SLOT, price: 500,
                                       priceSource: 'comp', title: p100.title.text }),
        'this comparison used to be draft-against-itself, which is always true');
  check('and the matching packet does agree with its own draft',
        p500.metadata.inputFingerprint
          === packetInputFingerprint({ sku: p500.sku, slot: SLOT, price: 500,
                                       priceSource: 'comp', title: p500.title.text }));

  // The shape fiction. Every version assertion in draft-index-recovery.mjs was
  // green while readStoredPacket read a TOP-LEVEL packetSchemaVersion that
  // buildListingPacket has never written -- so a real packet read back
  // INCOMPATIBLE. Asserted here against a REAL producer output, not a fixture.
  check('\u{1F534} a packet from the real producer reads back CURRENT, not INCOMPATIBLE',
        readStoredPacket(p500).status === PACKET_COMPAT.CURRENT,
        'the version tests used a hand-built shape production never emits');
  check('and the version lives where the producer writes it',
        p500.metadata.packetSchemaVersion === PACKET_SCHEMA_VERSION
        && p500.packetSchemaVersion === undefined);
}

// Client-declared fee metadata may not present itself as server-verified.
{
  const declared = buildListingPacket(CARDS[0], {
    feeModelRevision: 99, feeScheduleVerified: '2099-12', now: NOW, price: 10, priceSource: 'seller' });
  check('a client-declared fee revision is not named as verified',
        declared.metadata.feeScheduleVerified === undefined
        && declared.metadata.clientDeclaredFeeScheduleDate === '2099-12',
        'the server type-checks this and cannot validate it; a future date passes');
  check('the boundary is stated in one field a consumer can branch on',
        declared.metadata.feeMetadataSource === 'client-declared');
  check('\u{1F534} supplying values cannot suppress the disclosure',
        codes(declared).includes(PACKET_CODES.FEE_METADATA_CLIENT_DECLARED),
        'a supplied value buying silence is the taxonomy defect in another field');
  check('and the disclosure names the fields it is about',
        (declared.notes.find((n) => n.code === PACKET_CODES.FEE_METADATA_CLIENT_DECLARED).fields || [])
          .includes('clientDeclaredFeeModelRevision'));
  check('it is INFO, not a warning: a labelled boundary is not a defect',
        declared.notes.find((n) => n.code === PACKET_CODES.FEE_METADATA_CLIENT_DECLARED).severity === SEVERITY.INFO);
}


// ── Quote age survives a rebuild ─────────────────────────────────────────
// Reviewer check: "Keep quote age unchanged when reusing a quote. Rebuilding
// now must not make an earlier retrieval appear newer."
{
  const RETRIEVED = Date.parse('2026-09-08T12:00:00.000Z');
  const CREATE    = Date.parse('2026-09-08T12:10:00.000Z');
  const REBUILD   = Date.parse('2026-09-08T13:00:00.000Z');
  const basis = (extra) => ({ label: 'PriceCharting loose', sourceUrl: 'https://www.pricecharting.com/x',
                              datedBySource: false, ...extra });
  // findings are {code}, not packet notes -- the file-level `codes` helper
  // reads p.notes and does not apply here.
  const fcodes = (fs) => fs.map((f) => f.code);

  // The create path has only a duration, and converting it is correct there:
  // the build and the read are the same moment.
  const created = stampPriceBasis(basis({ cacheAgeSec: (CREATE - RETRIEVED) / 1000 }), CREATE);
  check('a create converts the relative age to the right absolute retrieval time',
        created.retrievedAt === '2026-09-08T12:00:00.000Z');

  // THE DEFECT, demonstrated. Re-converting the SAME duration at rebuild time
  // moves the retrieval 50 minutes forward. An hour-old quote reads as ten
  // minutes old, and nothing reports it.
  const naive = stampPriceBasis(basis({ cacheAgeSec: (CREATE - RETRIEVED) / 1000 }), REBUILD);
  check('\ud83d\udd34 re-converting a duration at rebuild time WOULD move the retrieval forward',
        naive.retrievedAt === '2026-09-08T12:50:00.000Z',
        'ten minutes before the REBUILD instead of before the create: the age is right, the anchor is wrong');

  // The fix: the rebuild declares the absolute time it already knows, and the
  // answer no longer depends on when the rebuild ran.
  const rebuilt = stampPriceBasis(basis({ retrievedAt: '2026-09-08T12:00:00.000Z' }), REBUILD);
  check('a rebuild that declares the absolute retrieval time preserves it',
        rebuilt.retrievedAt === '2026-09-08T12:00:00.000Z');
  check('and the same declaration is clock-independent',
        stampPriceBasis(basis({ retrievedAt: '2026-09-08T12:00:00.000Z' }), CREATE).retrievedAt
          === rebuilt.retrievedAt);

  // Absolute WINS over a stale duration, because a rebuild may carry both: the
  // client's cached basis object still has the duration it was built with.
  const both = stampPriceBasisReporting(
    basis({ retrievedAt: '2026-09-08T12:00:00.000Z', cacheAgeSec: 600 }), REBUILD);
  check('the absolute form is preferred when both are present',
        both.basis.retrievedAt === '2026-09-08T12:00:00.000Z');
  check('and no age-absent warning appears beside a usable retrieval time',
        !fcodes(both.findings).includes(PACKET_CODES.PRICE_BASIS_AGE_ABSENT),
        'a warning that wrongly appears is noise');

  // ── The regression must REQUIRE the original time ───────────────────────
  //
  // Review's point: an assertion that the answer is 12:00 passes for two
  // different reasons, and only one of them is the fix. If the absolute
  // preference were dropped tomorrow, `both` -- which carries BOTH forms -- is
  // the input that separates them, and the wrong answer it produces is exactly
  // the negative control above. So the correct behaviour is pinned against the
  // defect's own output rather than against a bare literal.
  //
  // Concretely: with both forms present, dropping the preference re-converts
  // cacheAgeSec: 600 against REBUILD and yields 12:50 -- `naive.retrievedAt`.
  // Asserting inequality with that value is what makes this test fail when the
  // preference regresses. `naive` is therefore load-bearing, not decoration,
  // and must not be deleted as a redundant case.
  check('\ud83d\udd34 and the preferred answer is NOT the one re-conversion would give',
        both.basis.retrievedAt !== naive.retrievedAt
          && naive.retrievedAt === '2026-09-08T12:50:00.000Z',
        `absolute=${both.basis.retrievedAt} vs re-converted=${naive.retrievedAt} — if these ever match, the absolute preference has been lost`);

  // The same requirement one level up, through the packet builder, because the
  // preference could hold in stampPriceBasisReporting and still be bypassed by
  // whatever the builder hands it.
  const bothPk = buildListingPacket(CARDS[0], {
    feeModelRevision: 7, feeScheduleVerified: '2026-09-01', slot: 'ebay:fixed-price',
    price: 100, priceSource: 'comp', maxTitleLength: 80, now: REBUILD,
    basisMeta: basis({ retrievedAt: '2026-09-08T12:00:00.000Z', cacheAgeSec: 600 }),
  });
  check('\ud83d\udd34 a rebuilt packet carrying both forms keeps the ORIGINAL retrieval time',
        bothPk.priceBasis.retrievedAt === '2026-09-08T12:00:00.000Z'
          && bothPk.priceBasis.retrievedAt !== naive.retrievedAt,
        `${bothPk.priceBasis.retrievedAt} — the rebuild must not walk an hour-old quote forward to ten minutes old`);

  // A future timestamp is refused, not clamped. Clamping would turn a wrong
  // client clock into a plausible retrieval time.
  const future = stampPriceBasisReporting(
    basis({ retrievedAt: '2026-09-09T00:00:00.000Z' }), REBUILD);
  check('a future retrieval time is refused rather than clamped',
        future.basis.retrievedAt === null
          && fcodes(future.findings).includes(PACKET_CODES.PRICE_BASIS_RETRIEVAL_UNPARSEABLE));

  // Generation time is a separate field and DOES move. The two must not be
  // conflated: the packet was generated at 13:00 from a quote read at 12:00.
  const pk = buildListingPacket(CARDS[0], {
    feeModelRevision: 7, feeScheduleVerified: '2026-09-01', slot: 'ebay:fixed-price',
    price: 100, priceSource: 'comp', maxTitleLength: 80, now: REBUILD,
    basisMeta: basis({ retrievedAt: '2026-09-08T12:00:00.000Z' }),
  });
  check('the packet records generation at rebuild time',
        pk.metadata.generatedAt === '2026-09-08T13:00:00.000Z');
  check('and retrieval at the original time',
        pk.priceBasis.retrievedAt === '2026-09-08T12:00:00.000Z');
  check('and does not claim the source dated it',
        pk.priceBasis.datedBySource === false);
}



// ═══════════════════════════════════════════════════════════════════════════
// RC-2.1 — shipping assumptions: recorded, never applied
// ═══════════════════════════════════════════════════════════════════════════
//
// The thing these tests exist to protect is a NEGATIVE: this packet must not
// grow a second shipping model. The venue comparison already owns that
// behaviour end to end, and two implementations of one business rule is the
// failure this repo has a standing rule against. So the assertions below check
// that shipping is CARRIED and DISCLOSED, and that every pricing figure is
// left exactly as it was.
console.log('\nRC-2.1 — shipping assumptions');
{
  const scodes = (p) => (p.notes || []).map((n) => n.code).filter((c) => c.startsWith('SHIPPING'));
  const noteFor = (p, code) => (p.notes || []).find((n) => n.code === code);
  const build = (shipping, extra = {}) => buildListingPacket(CARDS[0], {
    feeModelRevision: 7, feeScheduleVerified: '2026-09-01', slot: 'ebay:fixed-price',
    price: 100, priceSource: 'comp', maxTitleLength: 80,
    now: Date.parse('2026-09-09T13:00:00.000Z'),
    shipping, ...extra,
  });

  // ── The disclosure is unconditional ──────────────────────────────────────
  // Same property FEE_METADATA_CLIENT_DECLARED has, and for the same reason:
  // it reports a boundary, not a missing value, so a complete input must not
  // be able to buy silence about it.
  const full = build({ buyerPays: 5, sellerCost: 4.5 });
  check('a fully specified shipping pair is recorded',
        full.shipping.buyerPays.amount === 5 && full.shipping.sellerCost.amount === 4.5
        && full.shipping.buyerPays.declared === true && full.shipping.sellerCost.declared === true);
  check('🔴 supplying both sides cannot suppress the not-applied disclosure',
        scodes(full).includes(PACKET_CODES.SHIPPING_NOT_IN_NET),
        'a seller who filled the fields in is the one most likely to assume they were applied');
  check('and the block states it structurally, not only in prose',
        full.shipping.appliedToPricing === false);
  check('the disclosure is INFO — a labelled boundary is not a defect',
        noteFor(full, PACKET_CODES.SHIPPING_NOT_IN_NET).severity === SEVERITY.INFO);
  check('and it names the surface that DOES include shipping',
        /venue comparison/i.test(noteFor(full, PACKET_CODES.SHIPPING_NOT_IN_NET).message),
        'telling a seller a number is incomplete without saying where the complete one is is not guidance');
  check('the copy says the comparison MAY differ, never WILL',
        /may differ/.test(noteFor(full, PACKET_CODES.SHIPPING_NOT_IN_NET).message)
        && !/will differ/.test(noteFor(full, PACKET_CODES.SHIPPING_NOT_IN_NET).message));

  // ── The negative: no second fee model ────────────────────────────────────
  const noShip   = build(undefined);
  const withShip = build({ buyerPays: 25, sellerCost: 12 });
  check('🔴 shipping does not move ANY pricing figure in the packet',
        JSON.stringify(noShip.pricing) === JSON.stringify(withShip.pricing),
        'the moment shipping changes a number here, this file owns a second shipping model');
  check('and shipping is not blocking at any severity',
        withShip.blockingCodes.every((c) => !c.startsWith('SHIPPING'))
        && noShip.blockingCodes.every((c) => !c.startsWith('SHIPPING')));

  // ── Absent, and the empty object that means the same thing ───────────────
  check('nothing supplied is reported as absent, not as zero',
        noShip.shipping === null && scodes(noShip).includes(PACKET_CODES.SHIPPING_ABSENT));
  check('🔴 and absent is NOT recorded as a declared zero',
        noShip.shipping === null,
        'a silent zero here would read downstream as "the seller ships free"');
  const empty = build({});
  check('an empty object agrees with a missing one',
        empty.shipping === null && scodes(empty).includes(PACKET_CODES.SHIPPING_ABSENT),
        'two shapes for one state means a consumer branching on null gets two answers');
  // The collapse to null must not swallow a value the seller needs back.
  const onlyJunk = build({ buyerPays: 'four dollars' });
  check('🔴 but "nothing declared" does NOT collapse away rejected text',
        onlyJunk.shipping !== null && onlyJunk.shipping.buyerPays.rejected === 'four dollars',
        'the rejected value is the one thing the seller needs in order to correct it');
  check('🔴 and that case is never reported as absent',
        scodes(onlyJunk).includes(PACKET_CODES.SHIPPING_UNPARSEABLE)
        && !scodes(onlyJunk).includes(PACKET_CODES.SHIPPING_ABSENT),
        'ABSENT beside UNPARSEABLE is self-contradictory: one says empty, the other quotes the contents');
  check('it is a partial, and names the side genuinely left alone',
        scodes(onlyJunk).includes(PACKET_CODES.SHIPPING_PARTIAL)
        && noteFor(onlyJunk, PACKET_CODES.SHIPPING_PARTIAL).missing === 'sellerCost');
  check('and neither reports a partial',
        !scodes(noShip).includes(PACKET_CODES.SHIPPING_PARTIAL)
        && !scodes(empty).includes(PACKET_CODES.SHIPPING_PARTIAL));

  // ── The blank-is-zero conflation, stated rather than inherited ───────────
  const zero = build({ buyerPays: 0, sellerCost: 0 });
  check('a declared zero is recorded as declared, with the amount kept',
        zero.shipping.buyerPays.declared === true && zero.shipping.buyerPays.amount === 0);
  check('🔴 but the packet says it cannot tell free shipping from an untouched field',
        scodes(zero).includes(PACKET_CODES.SHIPPING_ZERO_UNCONFIRMED),
        'index.html declares both inputs value="0", so zero is the default, not a statement');
  check('and it names both sides when both are zero',
        noteFor(zero, PACKET_CODES.SHIPPING_ZERO_UNCONFIRMED).fields.join(',') === 'buyerPays,sellerCost');
  check('a nonzero pair raises no zero note',
        !scodes(full).includes(PACKET_CODES.SHIPPING_ZERO_UNCONFIRMED));
  check('an ABSENT side does not also raise the zero note',
        !scodes(noShip).includes(PACKET_CODES.SHIPPING_ZERO_UNCONFIRMED),
        'absence is already reported; saying it twice under a second name is noise');

  // ── Partial ──────────────────────────────────────────────────────────────
  const partial = build({ sellerCost: 4.5 });
  check('one side supplied is reported as partial, naming the missing side',
        scodes(partial).includes(PACKET_CODES.SHIPPING_PARTIAL)
        && noteFor(partial, PACKET_CODES.SHIPPING_PARTIAL).missing === 'buyerPays');
  check('and the supplied side is still kept',
        partial.shipping.sellerCost.amount === 4.5 && partial.shipping.buyerPays.declared === false);
  check('a partial is not also an absent',
        !scodes(partial).includes(PACKET_CODES.SHIPPING_ABSENT));

  // ── Unparseable, split from absent ───────────────────────────────────────
  const junk = build({ buyerPays: '5.00 usd', sellerCost: 4 });
  check('an unreadable value is reported as unparseable, not as absent',
        scodes(junk).includes(PACKET_CODES.SHIPPING_UNPARSEABLE)
        && !scodes(junk).includes(PACKET_CODES.SHIPPING_ABSENT));
  check('🔴 and the seller\u2019s own text is handed back, not blanked',
        junk.shipping.buyerPays.rejected === '5.00 usd' && junk.shipping.buyerPays.amount === null,
        'a seller cannot correct a value the product refuses to show them');
  const blank = build({ buyerPays: '   ', sellerCost: 4 });
  check('whitespace is absence, not corruption',
        !scodes(blank).includes(PACKET_CODES.SHIPPING_UNPARSEABLE)
        && blank.shipping.buyerPays.declared === false
        && blank.shipping.buyerPays.rejected === null);

  // ── Negative, recorded rather than clamped ───────────────────────────────
  const neg = build({ buyerPays: 5, sellerCost: -4 });
  check('a negative cost is reported',
        scodes(neg).includes(PACKET_CODES.SHIPPING_NEGATIVE)
        && noteFor(neg, PACKET_CODES.SHIPPING_NEGATIVE).fields.join(',') === 'sellerCost');
  check('🔴 and is kept as supplied, not clamped to zero',
        neg.shipping.sellerCost.amount === -4,
        'clamping makes a sign error indistinguishable from free shipping');

  // ── The normalizer is testable on its own ────────────────────────────────
  const direct = normalizeShippingAssumptions({ buyerPays: '7', sellerCost: '' });
  check('the normalizer is pure and reports without a packet',
        direct.shipping.buyerPays.amount === 7
        && direct.findings.map((f) => f.code).includes(PACKET_CODES.SHIPPING_PARTIAL));
  check('a non-object is absent, not a crash',
        normalizeShippingAssumptions('4.50').shipping === null
        && normalizeShippingAssumptions([]).shipping === null);

  // ── v1 → v2 migration ────────────────────────────────────────────────────
  // The bump exists because a v1 packet has no shipping key at all, and an
  // undefined at the consumer is indistinguishable from "the seller declared
  // nothing". These two are not the same event and must not read the same.
  check('the schema is at 2 and the 1→2 hop is registered',
        PACKET_SCHEMA_VERSION === 2 && typeof PACKET_MIGRATIONS[1] === 'function');
  const v1 = { sku: 'x', title: { text: 'T' }, metadata: { packetSchemaVersion: 1, generatedAt: 'G' } };
  const read = readStoredPacket(v1);
  check('a v1 packet migrates rather than reading as current',
        read.status === PACKET_COMPAT.MIGRATED && read.usable === true
        && read.migrationsApplied.join(',') === '1->2');
  check('and lands an explicit null shipping block',
        read.packet.shipping === null);
  check('🔴 the migration does not invent findings the original build never made',
        read.packet.notes === undefined,
        'a v1 packet was built by code that could not observe shipping; stamping SHIPPING_ABSENT would claim it looked');
  check('the rest of the packet survives the hop',
        read.packet.sku === 'x' && read.packet.title.text === 'T'
        && read.packet.metadata.generatedAt === 'G');
  check('🔴 and the stored object is not mutated in place',
        v1.shipping === undefined && v1.metadata.packetSchemaVersion === 1,
        'migrating a caller\u2019s object under them corrupts whatever else holds a reference');

  // ── The fingerprint deliberately does NOT cover shipping ─────────────────
  // Same treatment as priceBasis and pricing: those arrive as CONTEXT, not as
  // stored draft fields, and the fingerprint's job is to detect a packet that
  // no longer describes the DRAFT it is attached to. Adding a non-draft field
  // would invalidate packets on a change the draft cannot record.
  check('shipping is not in the draft-input projection',
        !PACKET_INPUT_FIELDS.includes('shipping'),
        'the projection lists persisted draft fields; shipping arrives through pricingContext');
  check('so changing shipping does not restamp the fingerprint',
        full.metadata.inputFingerprint === noShip.metadata.inputFingerprint);
}

// ───────────────────────────────────────────────────────────────────────────
// Note copy is UI. `notes[].message` is rendered verbatim to the seller by the
// review screen, so an internal identifier reaching it is a seller-visible
// defect, not a cosmetic one. This fired on the shipping notes, which read
// "Shipping buyerPays and sellerCost came through as zero" -- our object graph
// quoted at a seller. Guarded across EVERY code the module can emit, not just
// the shipping ones, because the next author has no reason to know the rule.
console.log('\nNote copy is seller-facing');
{
  const COPY_CTX = {
    feeModelRevision: 7, feeScheduleVerified: '2026-09-01', slot: 'ebay:fixed-price',
    price: 100, priceSource: 'comp', maxTitleLength: 80,
    now: Date.parse('2026-09-09T13:00:00.000Z'),
  };
  // Internal spellings that must never appear in a sentence. camelCase keys,
  // snake_case codes, and our own words for our own machinery.
  const FORBIDDEN = /buyerPays|sellerCost|appliedToPricing|basisMeta|priceBasis|feeModelRevision|packetSchemaVersion|inputFingerprint|migrationsApplied|[a-z]+_[A-Z]|\bthis packet\b|\bfindings\b/;

  // Every shipping shape that produces a finding, so each branch's copy is
  // actually exercised rather than assumed.
  const cases = [
    ['absent',       undefined],
    ['unparseable',  { buyerPays: 'four dollars', sellerCost: '4.50' }],
    ['negative',     { buyerPays: '-3', sellerCost: '4.50' }],
    ['partial',      { sellerCost: '4.50' }],
    ['zero',         { buyerPays: '0', sellerCost: '0' }],
    ['declared',     { buyerPays: '5.99', sellerCost: '4.50' }],
  ];

  const seen = new Set();
  for (const [name, shipping] of cases) {
    const pk = buildListingPacket(CARDS[0], { ...COPY_CTX, shipping });
    for (const n of pk.notes) {
      seen.add(n.code);
      const bad = FORBIDDEN.exec(String(n.message || ''));
      check(`${name}: ${n.code} copy names no internals` + (bad ? ` (found "${bad[0]}")` : ''),
            !bad, n.message);
      // A sentence that ends mid-clause is what a missing interpolation looks
      // like once the identifier is removed rather than replaced.
      check(`${name}: ${n.code} copy is a finished sentence`,
            /[.!?]$/.test(String(n.message || '').trim())
            && !/\s(and|or|;)\s*[.]/.test(String(n.message || '')),
            n.message);
      check(`${name}: ${n.code} copy leaves the code out of the prose`,
            !String(n.message || '').includes(n.code), n.message);
    }
  }

  // The machine-readable side must keep the internal keys. Fixing the prose by
  // renaming the data would break every consumer reading notes[].data.
  const zero = buildListingPacket(CARDS[0], { ...COPY_CTX, shipping: { buyerPays: '0', sellerCost: '0' } });
  const zn = zero.notes.find((n) => n.code === 'SHIPPING_ZERO_UNCONFIRMED');
  // On the note itself, not under a `data` wrapper -- `add()` spreads its
  // fourth argument onto the note. Asserted against the real shape rather
  // than the one this assertion first assumed.
  check('while the note still carries the internal field keys for machines',
        !!zn && Array.isArray(zn.fields)
        && zn.fields.join(',') === 'buyerPays,sellerCost',
        JSON.stringify(zn));

  check('and the shipping copy branches were all reached',
        ['SHIPPING_ABSENT','SHIPPING_UNPARSEABLE','SHIPPING_NEGATIVE',
         'SHIPPING_PARTIAL','SHIPPING_ZERO_UNCONFIRMED','SHIPPING_NOT_IN_NET']
          .every((c) => seen.has(c)),
        [...seen].join(','));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
