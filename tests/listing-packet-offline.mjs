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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
function check(name, cond, hint = '') {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${hint ? '\n       → ' + hint : ''}`); }
}

// ── Pull the real fee + inversion functions out of the built core.js ───────
const coreFile = fs.readdirSync(path.join(root, 'js')).find((f) => /^core\..*\.js$/.test(f));
const coreSrc  = fs.readFileSync(path.join(root, 'js', coreFile), 'utf8');

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

const { feeEbay, netEbayForPrice, listPriceForTargetNet, FEE_MODEL_REVISION } = new Function(`
  ${extractConstInt('FEE_MODEL_REVISION')}
  ${extractFn('feeEbay')}
  ${extractFn('netEbayForPrice')}
  ${extractFn('listPriceForTargetNet')}
  return { feeEbay, netEbayForPrice, listPriceForTargetNet, FEE_MODEL_REVISION };
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

const CTXS = [
  { name: 'default no-store',      shipCharge: 0, shipCost: 0, ebayStore: 'none',  ebayPromo: 0, ebayTopRated: 'no' },
  { name: 'top rated',             shipCharge: 0, shipCost: 0, ebayStore: 'none',  ebayPromo: 0, ebayTopRated: 'yes' },
  { name: 'basic store',           shipCharge: 0, shipCost: 0, ebayStore: 'basic', ebayPromo: 0, ebayTopRated: 'no' },
  { name: 'buyer-paid shipping',   shipCharge: 5, shipCost: 4.50, ebayStore: 'none', ebayPromo: 0, ebayTopRated: 'no' },
  { name: 'promoted 3%',           shipCharge: 0, shipCost: 0, ebayStore: 'none',  ebayPromo: 3, ebayTopRated: 'no' },
  { name: 'everything at once',    shipCharge: 5.95, shipCost: 5.10, ebayStore: 'basic', ebayPromo: 4, ebayTopRated: 'yes' },
];
const TARGETS = [1, 4.99, 8, 9.5, 10, 10.5, 12, 25, 60, 99.99, 250, 900, 2499, 2501, 5000, 7499, 7501, 12000];

let sweepBad = [];
for (const ctx of CTXS) {
  for (const target of TARGETS) {
    const r = listPriceForTargetNet(target, ctx);
    if (!r.ok) { sweepBad.push(`${ctx.name}@${target}: not ok (${r.reason})`); continue; }
    const actual = netEbayForPrice(r.listPrice, ctx);
    if (Math.abs(actual - target) > 0.05) {
      sweepBad.push(`${ctx.name}@${target}: price ${r.listPrice} nets ${actual.toFixed(4)} (off by ${(actual - target).toFixed(4)})`);
    }
    if (Math.abs(actual - r.achievedNet) > 0.005) {
      sweepBad.push(`${ctx.name}@${target}: reported achievedNet ${r.achievedNet} != real ${actual.toFixed(4)}`);
    }
  }
}
check(`full sweep: ${CTXS.length} fee configs × ${TARGETS.length} targets lands within $0.05`,
      sweepBad.length === 0, sweepBad.slice(0, 6).join('\n       → '));

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

// The per-order fee steps $0.30 → $0.40 at a $10 order total, so net drops a
// dime there and the curve is not strictly monotonic. Bisection alone can land
// on the wrong side of that step.
const stepBad = [];
for (let cents = 850; cents <= 1150; cents += 1) {
  const t = cents / 100;
  const r = listPriceForTargetNet(t, CTXS[0]);
  if (!r.ok) { stepBad.push(`${t}: not ok`); continue; }
  const actual = netEbayForPrice(r.listPrice, CTXS[0]);
  if (actual < t - 0.005) stepBad.push(`${t}: price ${r.listPrice} nets only ${actual.toFixed(4)}`);
}
check('301 targets straddling the $10 per-order fee step all clear the target',
      stepBad.length === 0, stepBad.slice(0, 5).join('\n       → '));

check('unreachable payout is refused, not approximated',
      (() => {
        const r = listPriceForTargetNet(100, { ...CTXS[0], ebayPromo: 200 });
        return r.ok === false && r.reason === 'UNREACHABLE_NET' && r.listPrice === null;
      })(),
      'if marginal fees eat every extra dollar, say so instead of returning a number');

check('target below the price floor reports atFloor',
      (() => { const r = listPriceForTargetNet(-20, CTXS[0]); return r.ok && r.atFloor === true; })());
check('non-numeric target is rejected',
      listPriceForTargetNet('abc', CTXS[0]).ok === false);
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
      packet.sku.startsWith('v1-') && packet.sku === packet.identity.sku);
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
