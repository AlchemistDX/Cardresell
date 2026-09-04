#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Price integrity audit — permanent harness
//
// Promoted into the repo 2026-09-03 from the one-off script used for the Sol
// price audit, because the audit kept having to re-answer the same question
// from scratch: WHEN TCGPLAYER AND PRICECHARTING DISAGREE ABOUT A CARD, ARE
// THEY EVEN PRICING THE SAME CARD?
//
// Every previous audit's "match sanity" column compared SET NAMES only. That
// is not an identity check. Two feeds can agree on "Base Set" and still be
// holding different objects — 1st Edition vs Shadowless vs Unlimited, a
// reverse holo vs a holo, a #4/102 vs a #4 promo. A set-name match reported as
// "matched" invited the conclusion that a 75% price spread was a pricing
// disagreement when it could just as easily have been a printing substitution.
// The distinction decides what you fix: a substitution is a resolver bug, a
// genuine disagreement is a disclosure problem.
//
// So identity here is a THREE-part check, recorded per source, per card:
//
//   name    normalised card name equality
//   set     normalised set/console name equality
//   number  normalised collector number equality
//
// and each part can come back true / false / null. `null` matters: it means
// the feed did not return that field, so we cannot assert a match OR a
// mismatch. Collapsing null into either one is how a harness starts lying.
// A row is only `exact` when all three are true.
//
// Usage:
//   node qa/price_integrity_audit.mjs                    # prod
//   node qa/price_integrity_audit.mjs --base=http://localhost:8099
//   node qa/price_integrity_audit.mjs --out=/tmp/audit.json
//
// Rate limit: PriceCharting's terms bind us to at most 1 request/sec. The
// 1100ms sleep is not tuning, it is compliance. Do not lower it.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const hit = argv.find(a => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const BASE = arg('base', 'https://www.cardresell.org').replace(/\/$/, '');
const OUT  = arg('out', '');
const LIMIT = Number(arg('limit', '0')) || 0;

// Sample spans three value tiers and both eras. The era split is the point:
// the Sol audit measured a median 75.9% source spread on vintage against 7.8%
// on modern, so a sample weighted to either era alone reports a misleading
// headline number.
const CARDS = [
  { tier: 'cheap', era: 'vintage', name: 'Pikachu',            set: 'Base Set',              number: '58',  rarity: 'Common',   year: 1999 },
  { tier: 'cheap', era: 'vintage', name: 'Charmander',         set: 'Base Set',              number: '46',  rarity: 'Common',   year: 1999 },
  { tier: 'cheap', era: 'vintage', name: 'Bulbasaur',          set: 'Base Set',              number: '44',  rarity: 'Common',   year: 1999 },
  { tier: 'cheap', era: 'vintage', name: 'Squirtle',           set: 'Base Set',              number: '63',  rarity: 'Common',   year: 1999 },
  { tier: 'cheap', era: 'vintage', name: 'Eevee',              set: 'Jungle',                number: '51',  rarity: 'Common',   year: 1999 },
  { tier: 'cheap', era: 'vintage', name: 'Magikarp',           set: 'Base Set',              number: '35',  rarity: 'Uncommon', year: 1999 },
  { tier: 'cheap', era: 'vintage', name: 'Gastly',             set: 'Fossil',                number: '33',  rarity: 'Uncommon', year: 1999 },
  { tier: 'cheap', era: 'vintage', name: 'Energy Retrieval',   set: 'Base Set',              number: '81',  rarity: 'Uncommon', year: 1999 },
  { tier: 'cheap', era: 'modern',  name: 'Mew',                set: 'Celebrations',          number: '11',  rarity: 'Rare Holo', year: 2021 },
  { tier: 'cheap', era: 'modern',  name: 'Professor\u2019s Research', set: 'Celebrations',   number: '23',  rarity: 'Rare Holo', year: 2021 },

  { tier: 'modern_holo', era: 'modern', name: 'Charizard ex',  set: 'Obsidian Flames',       number: '223', rarity: 'Special Illustration Rare', year: 2023 },
  { tier: 'modern_holo', era: 'modern', name: 'Iono',          set: 'Paldea Evolved',        number: '269', rarity: 'Special Illustration Rare', year: 2023 },
  { tier: 'modern_holo', era: 'modern', name: 'Greninja ex',   set: 'Twilight Masquerade',   number: '214', rarity: 'Special Illustration Rare', year: 2024 },
  { tier: 'modern_holo', era: 'modern', name: 'Magikarp',      set: 'Paldea Evolved',        number: '203', rarity: 'Illustration Rare',         year: 2023 },
  { tier: 'modern_holo', era: 'modern', name: 'Mew ex',        set: 'Paldean Fates',         number: '232', rarity: 'Special Illustration Rare', year: 2024 },
  { tier: 'modern_holo', era: 'modern', name: 'Giratina V',    set: 'Lost Origin',           number: '186', rarity: 'Rare Ultra',   year: 2022 },
  { tier: 'modern_holo', era: 'modern', name: 'Lugia V',       set: 'Silver Tempest',        number: '186', rarity: 'Rare Ultra',   year: 2022 },
  { tier: 'modern_holo', era: 'modern', name: 'Charizard V',   set: 'Brilliant Stars',       number: '154', rarity: 'Rare Ultra',   year: 2022 },
  { tier: 'modern_holo', era: 'modern', name: 'Pikachu ex',    set: 'Surging Sparks',        number: '238', rarity: 'Special Illustration Rare', year: 2024 },
  { tier: 'modern_holo', era: 'modern', name: 'Umbreon VMAX',  set: 'Evolving Skies',        number: '215', rarity: 'Rare Rainbow', year: 2021 },

  { tier: 'high_value', era: 'vintage', name: 'Charizard',      set: 'Base Set',             number: '4',   rarity: 'Rare Holo',      year: 1999 },
  { tier: 'high_value', era: 'vintage', name: 'Lugia',          set: 'Neo Genesis',          number: '9',   rarity: 'Rare Holo',      year: 2000 },
  { tier: 'high_value', era: 'vintage', name: 'Rayquaza Star',  set: 'EX Deoxys',            number: '107', rarity: 'Rare Holo Star', year: 2005 },
  { tier: 'high_value', era: 'vintage', name: 'Charizard Star', set: 'Dragon Frontiers',     number: '100', rarity: 'Rare Holo Star', year: 2006 },
  { tier: 'high_value', era: 'vintage', name: 'Latias Star',    set: 'EX Deoxys',            number: '105', rarity: 'Rare Holo Star', year: 2005 },
  { tier: 'high_value', era: 'vintage', name: 'Espeon Star',    set: 'POP Series 5',         number: '16',  rarity: 'Rare',           year: 2007 },
  { tier: 'high_value', era: 'vintage', name: 'Umbreon Star',   set: 'POP Series 5',         number: '17',  rarity: 'Rare',           year: 2007 },
  { tier: 'high_value', era: 'vintage', name: 'Torchic Star',   set: 'Team Rocket Returns',  number: '108', rarity: 'Rare Holo Star', year: 2004 },
  { tier: 'high_value', era: 'vintage', name: 'Mewtwo Star',    set: 'Holon Phantoms',       number: '103', rarity: 'Rare Holo Star', year: 2006 },
  { tier: 'high_value', era: 'vintage', name: 'Charizard',      set: 'Skyridge',             number: '146', rarity: 'Rare Secret',    year: 2003 },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, opts = {}) {
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(30000) });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
    return { status: r.status, data };
  } catch (e) {
    return { status: 0, data: { error: String(e) } };
  }
}

const qs = o => new URLSearchParams(
  Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)])
).toString();

// ── Normalisers ────────────────────────────────────────────────────────────
// Each one exists because a real feed pair differed only in that dimension.

// "Charizard ★" vs "Charizard Star" vs "Charizard [Gold Star]";
// "Mew [Reverse Holo]"; "Charizard (Shadowless)"; "Iono - 185/193";
// "Professor's Research" with a curly apostrophe; "Charizard Star (Delta
// Species)" -- TCG appends the mechanic name, PC does not.
//
// A note on [Gold Star]: TCGplayer names 2004-2007 Gold Star cards
// "<Pokemon> Star", PriceCharting names them "<Pokemon> [Gold Star]". Both
// are correct products; the bracket removal makes them one canonical form.
// Without this fold every high-value Star card in the sample scored as an
// identity mismatch even though both feeds were priced against the same
// slab. That is the specific noise the harness is trying to filter out --
// a genuine substitution (Iono card vs Iono display box) is loud, a naming
// convention difference between two catalogues is not.
const normName = s => String(s || '')
  .toLowerCase()
  .normalize('NFKD')
  // Bracket contents that are widely-used equivalents. "Gold Star" is the
  // TCG term for the star-mechanic subset; the bracket is a PriceCharting
  // habit, not a distinct printing.
  .replace(/\[gold star\]/g, 'star')
  .replace(/[\u2605\u2606]/g, 'star')
  // Strip mechanic parentheticals: "Charizard Star (Delta Species)" from
  // TCG then matches "Charizard [Gold Star]" from PC once both foldings run.
  .replace(/\((?:delta species|holo|reverse holo|shadowless|1st edition|unlimited)\)/g, ' ')
  .replace(/\[[^\]]+\]/g, ' ')
  .replace(/\([^)]*\)/g, ' ')
  .replace(/[\u2019\u02bc'`]/g, '')
  .replace(/\s*-\s*\d+\/\d+.*$/, ' ')
  .replace(/#\s*[a-z0-9-]+.*$/i, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

// PriceCharting calls it "Pokemon Base Set"; TCGplayer says "Base Set".
// PC prefixes the game, TCG prefixes "EX " on some ex-era sets.
const normSet = s => String(s || '')
  .toLowerCase()
  .replace(/^pokemon\s+/, '')
  .replace(/^ex\s+/, '')
  .replace(/\bbase set$/, 'base')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

// "4/102" -> "4"; "004" -> "4"; "SV049/SV122" -> "sv049".
const normNum = s => String(s || '')
  .toLowerCase()
  .split('/')[0]
  .replace(/^0+(?=\d)/, '')
  .trim();

// PC embeds the number in the product name: "Charizard #4 [Shadowless]".
const parsePcNum = s => {
  const m = String(s || '').match(/#\s*([A-Za-z0-9-]+)/);
  return m ? m[1].toLowerCase().replace(/^0+(?=\d)/, '') : null;
};

// PC brackets the variant: "Charizard #4 [1st Edition]". TCG puts it in a
// separate `variant` field. A bracket on one side with nothing on the other is
// a variant misalignment even when name/set/number all match — which is
// exactly the printing-substitution case this harness exists to catch.
const pcBracketOf = s => {
  const m = /\[([^\]]+)\]/.exec(String(s || ''));
  return m ? m[1].toLowerCase().trim() : null;
};

// ── The identity check ─────────────────────────────────────────────────────
// Returns a per-source record. `status` is deliberately three-valued:
//
//   exact          all three parts matched
//   mismatch       at least one part is definitely wrong
//   indeterminate  nothing wrong, but a field was missing so we cannot claim
//                  a match
//
// The old set-only column had no `indeterminate` state, so a feed that
// returned no collector number was scored identical to one that returned a
// matching number. That is the specific defect this replaces.
function identityOf(card, source, name, set, num) {
  const parts = {
    name:   name == null ? null : normName(name) === normName(card.name),
    set:    set  == null ? null : normSet(set)   === normSet(card.set),
    number: num  == null ? null : normNum(num)   === normNum(card.number),
  };
  const vals = Object.values(parts);
  const status = vals.includes(false)
    ? 'mismatch'
    : vals.includes(null) ? 'indeterminate' : 'exact';
  return {
    source, ...parts, status,
    observed: { name: name ?? null, set: set ?? null, number: num ?? null },
    requested: { name: card.name, set: card.set, number: card.number },
  };
}

const median = a => {
  const v = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// ── Run ────────────────────────────────────────────────────────────────────
const list = LIMIT ? CARDS.slice(0, LIMIT) : CARDS;
const rows = [];

console.log(`Price integrity audit — ${list.length} cards against ${BASE}`);
console.log('PriceCharting rate limit: 1 req/sec (1100ms sleep, do not lower)\n');

for (let i = 0; i < list.length; i++) {
  const c = list[i];
  const params = qs({ ...c, game: 'pokemon' });

  const tcg = await getJson(`${BASE}/api/tcg-price?${params}`);
  const pc  = await getJson(`${BASE}/api/pricecharting?${params}`);
  await sleep(1100);

  const tcgMarket = tcg.data?.market ?? null;
  const pcRaw     = pc.data?.prices?.raw ?? pc.data?.median ?? null;

  // `cardNumber` was added to the tcg-price response on 2026-09-03 precisely
  // so this check could be performed. Before that it was always null and
  // every TCG row scored "indeterminate" on number -- the harness could not
  // distinguish a real source disagreement from a printing substitution.
  // If it is still missing, we record null and the row stays indeterminate;
  // we never assume the requested number was the one matched.
  const tcgId = identityOf(c, 'tcg',
    tcg.data?.cardName, tcg.data?.setName, tcg.data?.cardNumber ?? null);

  const pcProduct = pc.data?.productName;
  const pcId = identityOf(c, 'pc', pcProduct, pc.data?.consoleName, parsePcNum(pcProduct));

  // Variant alignment is separate from identity on purpose. Two feeds can be
  // holding the same card number in the same set and still disagree on
  // printing, and that disagreement alone can produce a multiple-x spread.
  const pcBracket  = pcBracketOf(pcProduct);
  let tcgVariant = String(tcg.data?.variant || '').toLowerCase().trim() || null;
  // TCGplayer names the DEFAULT printing explicitly ("normal", "unlimited",
  // and for many modern cards "holofoil" is the only printing that exists).
  // PriceCharting expresses the same default by omitting the bracket entirely.
  // Treating TCG's explicit default as "named a printing" against PC's
  // "named nothing" made every ordinary card score indeterminate, which
  // drowned the genuine variant mismatches we are trying to surface.
  // Only 'normal' and 'unlimited' are folded in -- 'holofoil' is NOT, because
  // holo vs non-holo is a real price-bearing distinction we want flagged.
  const TCG_DEFAULT_PRINTINGS = new Set(['normal', 'unlimited']);
  if (tcgVariant && TCG_DEFAULT_PRINTINGS.has(tcgVariant)) tcgVariant = null;
  let variantAlignment;
  if (tcgId.status === 'mismatch' || pcId.status === 'mismatch') {
    variantAlignment = 'not_assessed';
  } else if (pcBracket && tcgVariant) {
    variantAlignment = normName(pcBracket) === normName(tcgVariant) ? 'aligned' : 'mismatch';
  } else if (!pcBracket && !tcgVariant) {
    variantAlignment = 'aligned_default';
  } else {
    // One side named a printing and the other did not. Cannot claim alignment.
    variantAlignment = 'indeterminate';
  }

  const comparable = tcgMarket != null && pcRaw != null && tcgMarket > 0 && pcRaw > 0;
  const ratio     = comparable ? tcgMarket / pcRaw : null;
  const absSpread = comparable
    ? Math.abs(tcgMarket - pcRaw) / Math.min(tcgMarket, pcRaw)
    : null;

  const row = {
    i: i + 1, tier: c.tier, era: c.era,
    requested: `${c.name} | ${c.set} | #${c.number}`,
    tcgStatus: tcg.status, pcStatus: pc.status,
    tcgMarket, tcgLow: tcg.data?.low ?? null, tcgMid: tcg.data?.mid ?? null,
    tcgHigh: tcg.data?.high ?? null, tcgReason: tcg.data?.reason ?? null,
    tcgProductId: tcg.data?.productId ?? null,
    tcgProductName: tcg.data?.cardName ?? null,
    tcgSet: tcg.data?.setName ?? null,
    tcgVariant: tcg.data?.variant ?? null,
    tcgUrl: tcg.data?.url ?? null,
    tcgCacheAgeSec: tcg.data?.cacheAgeSec ?? null,
    marketAskDivergence: tcg.data?.marketAskDivergence ?? null,
    pcRaw, pcProductId: pc.data?.productId ?? null,
    pcProductName: pcProduct ?? null,
    pcSet: pc.data?.consoleName ?? null,
    pcUrl: pc.data?.url ?? null,
    pcReason: pc.data?.reason ?? null,
    // ── identity metadata: the whole point of this harness ──
    tcgIdentity: tcgId,
    pcIdentity: pcId,
    variantAlignment,
    comparable, ratio, absSpread,
    error: tcg.data?.error || pc.data?.error || null,
  };
  rows.push(row);

  const idFlag = (tcgId.status === 'exact' && pcId.status === 'exact') ? 'ID:exact'
    : (tcgId.status === 'mismatch' || pcId.status === 'mismatch') ? 'ID:MISMATCH'
    : 'ID:indeterminate';
  const spreadStr = absSpread != null ? `${Math.round(absSpread * 100)}%` : 'n/a';
  console.log(
    `${String(i + 1).padStart(2)}. ${c.name} #${c.number} ${c.set}`.padEnd(52) +
    `TCG=${tcgMarket ?? '—'}`.padEnd(14) +
    `PC=${pcRaw ?? '—'}`.padEnd(13) +
    `spread=${spreadStr}`.padEnd(14) +
    `${idFlag} var=${variantAlignment}`
  );
}

// ── Summary ────────────────────────────────────────────────────────────────
// A spread number is only meaningful over rows where identity is confirmed on
// BOTH sides. Reporting a median spread across rows that include mismatches or
// indeterminate identity mixes "these two sources value this card differently"
// with "these two sources are looking at different cards", which is the error
// the old set-only column made possible. So the headline spread is computed on
// identity-exact rows, and the other buckets are reported separately.
const comparableRows = rows.filter(r => r.comparable);
const bothExact = comparableRows.filter(r =>
  r.tcgIdentity.status === 'exact' && r.pcIdentity.status === 'exact');
const anyMismatch = comparableRows.filter(r =>
  r.tcgIdentity.status === 'mismatch' || r.pcIdentity.status === 'mismatch');
const indeterminate = comparableRows.filter(r =>
  r.tcgIdentity.status !== 'mismatch' && r.pcIdentity.status !== 'mismatch' &&
  (r.tcgIdentity.status === 'indeterminate' || r.pcIdentity.status === 'indeterminate'));

const byEra = era => {
  const a = bothExact.filter(r => r.era === era);
  return {
    n: a.length,
    medianAbsSpread: median(a.map(r => r.absSpread)),
    medianRatio: median(a.map(r => r.ratio)),
    tcgHigherN: a.filter(r => r.ratio > 1).length,
  };
};

const summary = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  n: rows.length,
  comparableN: comparableRows.length,
  identity: {
    bothExactN: bothExact.length,
    anyMismatchN: anyMismatch.length,
    indeterminateN: indeterminate.length,
    // Named so a reader cannot mistake this for a set-name comparison.
    method: 'three-part per-source check: normalised name + set + collector number; null field => indeterminate, never credited as a match',
  },
  // Headline spread over identity-confirmed rows ONLY.
  spreadOnIdentityExact: {
    n: bothExact.length,
    medianAbsSpread: median(bothExact.map(r => r.absSpread)),
    medianRatio: median(bothExact.map(r => r.ratio)),
    tcgHigherN: bothExact.filter(r => r.ratio > 1).length,
  },
  byEra: { vintage: byEra('vintage'), modern: byEra('modern') },
  byTier: Object.fromEntries([...new Set(rows.map(r => r.tier))].map(t => {
    const a = bothExact.filter(r => r.tier === t);
    return [t, {
      n: a.length,
      medianAbsSpread: median(a.map(r => r.absSpread)),
      medianRatio: median(a.map(r => r.ratio)),
      tcgHigherN: a.filter(r => r.ratio > 1).length,
    }];
  })),
  variantAlignment: Object.fromEntries(
    [...new Set(rows.map(r => r.variantAlignment))].map(v =>
      [v, rows.filter(r => r.variantAlignment === v).length])),
  divergenceDisclosedN: rows.filter(r => r.marketAskDivergence).length,
  mismatchDetail: anyMismatch.map(r => ({
    requested: r.requested,
    tcg: r.tcgIdentity.observed,
    pc: r.pcIdentity.observed,
    tcgFailed: Object.entries(r.tcgIdentity)
      .filter(([k, v]) => ['name', 'set', 'number'].includes(k) && v === false).map(([k]) => k),
    pcFailed: Object.entries(r.pcIdentity)
      .filter(([k, v]) => ['name', 'set', 'number'].includes(k) && v === false).map(([k]) => k),
  })),
};

console.log('\n──────── SUMMARY ────────');
console.log(`cards                    ${summary.n}`);
console.log(`comparable (both priced) ${summary.comparableN}`);
console.log(`identity exact both      ${summary.identity.bothExactN}`);
console.log(`identity MISMATCH        ${summary.identity.anyMismatchN}`);
console.log(`identity indeterminate   ${summary.identity.indeterminateN}`);
const s = summary.spreadOnIdentityExact;
console.log(`\nspread on identity-exact rows only (n=${s.n}):`);
console.log(`  median abs spread      ${s.medianAbsSpread != null ? (s.medianAbsSpread * 100).toFixed(1) + '%' : 'n/a'}`);
console.log(`  median TCG/PC ratio    ${s.medianRatio != null ? s.medianRatio.toFixed(3) : 'n/a'}`);
console.log(`  TCG higher             ${s.tcgHigherN}/${s.n}`);
for (const era of ['vintage', 'modern']) {
  const e = summary.byEra[era];
  console.log(`  ${era.padEnd(8)} n=${String(e.n).padStart(2)}  median spread ${e.medianAbsSpread != null ? (e.medianAbsSpread * 100).toFixed(1) + '%' : 'n/a'}`);
}
console.log(`\nvariant alignment        ${JSON.stringify(summary.variantAlignment)}`);
console.log(`ask/sale divergence disclosed on ${summary.divergenceDisclosedN} rows`);
if (summary.mismatchDetail.length) {
  console.log('\nIDENTITY MISMATCHES (a spread on these rows is NOT a pricing disagreement):');
  for (const m of summary.mismatchDetail) {
    console.log(`  requested ${m.requested}`);
    console.log(`    tcg ${JSON.stringify(m.tcg)} failed=${m.tcgFailed.join(',') || '—'}`);
    console.log(`    pc  ${JSON.stringify(m.pc)} failed=${m.pcFailed.join(',') || '—'}`);
  }
}

if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2));
  console.log(`\nwrote ${OUT}`);
}

// Non-zero exit on a real identity mismatch — that is a resolver bug, not a
// data observation, and it should be able to fail a check run.
process.exit(summary.identity.anyMismatchN > 0 ? 1 : 0);
