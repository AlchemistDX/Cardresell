// Regression: the bulk row for Bulbasaur / Mega Evolution #133 showed
// "Price unavailable" for a card the catalog holds and prices at ~$20.64.
// Two independent defects, both verified live on 2026-09-04:
//
//  A. The scanner reported the name as "Bulbasaur (Mega Evolution Stamped)".
//     pokemontcg.io returned ZERO rows for every query built from that
//     string -- with the number, with the set, and name-only. The
//     parenthetical is a variant note the scanner adds, not part of the
//     catalog name.
//  B. normalizeSetName's prefix stripper had no right-hand boundary, so the
//     "me" alternative matched the first two letters of the WORD
//     "Mega Evolution" -> "ga evolution", while the catalog's
//     "ME01: Mega Evolution" normalised correctly to "mega evolution". The
//     two sides never compared equal, so /api/tcg-price answered
//     `set_mismatch` for a product it had matched exactly. "Mew" -> "w" was
//     broken the same way.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeSetName } from '../api/_tcgcsv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const TCGCSV = readFileSync(join(ROOT, 'api/_tcgcsv.js'), 'utf8');

let pass = 0; const fails = [];
const ok = (m, c) => { if (c) pass++; else fails.push(m); };
const eq = (m, a, b) => { if (Object.is(a, b)) pass++; else fails.push(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); };

function grabFn(src, sig) {
  const i = src.indexOf(sig);
  if (i === -1) return '';
  let d = 0;
  for (let k = src.indexOf('{', src.indexOf(')', i)); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  return '';
}

// ── A. Set-name normalisation must not eat real words ──────────────────────
// The plain name and the catalog's code-prefixed name MUST agree, or the
// price API rejects its own correct match.
for (const [plain, coded] of [
  ['Mega Evolution', 'ME01: Mega Evolution'],
  ['Mew',            'SV: Mew'],
  ['Paldea Evolved', 'SV02: Paldea Evolved'],
  ['Paradox Rift',   'SV04: Paradox Rift'],
  ['Chilling Reign', 'SWSH06: Chilling Reign'],
  ['Chaos Rising',   'ME04: Chaos Rising'],
  ['Evolutions',     'XY - Evolutions'],
  ['Shrouded Fable', 'SV: Shrouded Fable'],
  ['Mega Evolution Energies',   'MEE: Mega Evolution Energies'],
  ['Scarlet & Violet Energies', 'SVE: Scarlet & Violet Energies'],
  ['Mega Evolution Promo',      'ME: Mega Evolution Promo'],
  ['Delta Reign',               'ME06: Delta Reign'],
  ['Destined Rivals',           'SV10: Destined Rivals'],
]) {
  eq(`"${plain}" and "${coded}" normalise alike`,
     normalizeSetName(plain), normalizeSetName(coded));
}

// The specific corruptions.
eq('"Mega Evolution" is not truncated to "ga evolution"', normalizeSetName('Mega Evolution'), 'mega evolution');
eq('"Mew" is not truncated to "w"', normalizeSetName('Mew'), 'mew');
eq('"Mewtwo" survives intact', normalizeSetName('Mewtwo'), 'mewtwo');
eq('"Metagross" survives intact', normalizeSetName('Metagross'), 'metagross');
eq('"Dpicked" style words are not truncated', normalizeSetName('Dragon'), 'dragon');
eq('"Smeargle" is not truncated', normalizeSetName('Smeargle'), 'smeargle');
eq('"Bwana" is not truncated', normalizeSetName('Bwana'), 'bwana');
eq('"Xyz" is not truncated', normalizeSetName('Xylophone'), 'xylophone');

// Genuine set codes must STILL be stripped -- the fix must not go slack.
eq('a numeric set code is still stripped', normalizeSetName('SV02: Paldea Evolved'), 'paldea evolved');
eq('a bare colon code is still stripped', normalizeSetName('SM: Guardians Rising'), 'guardians rising');
eq('a dash-separated code is still stripped', normalizeSetName('XY - Evolutions'), 'evolutions');
eq('a space-separated code is still stripped', normalizeSetName('SM Base Set'), 'base set');
eq('the ME code is still stripped', normalizeSetName('ME01: Mega Evolution'), 'mega evolution');
ok('two different sets do not collide',
   normalizeSetName('Paradox Rift') !== normalizeSetName('Paldea Evolved'));
ok('Mega Evolution and Mew remain distinct',
   normalizeSetName('Mega Evolution') !== normalizeSetName('Mew'));

// The boundary is expressed as a lookahead on a non-letter.
{
  const src = grabFn(TCGCSV, 'export function normalizeSetName');
  ok('the normaliser exists', src.length > 0);
  ok('the prefix strip is boundary-guarded', /\(\?=\\d\|\[/.test(src) || /\(\?=/.test(src));
  ok('the prefix alternation is still present', /sv\|swsh\|xy\|bw\|hgss\|dp\|sm\|me/.test(src));
}

// Sweep every real catalog set name captured from tcgcsv (220 groups,
// 2026-09-04). For each one carrying a code prefix, the plain name the
// scanner sends MUST normalise to the same string as the catalog's coded
// name. This is the assertion the Bulbasaur bug would have failed, and it
// removes the need to guess which codes exist -- SV06.5 was guessed in the
// first draft of this test and no such format is in the catalog.
{
  const groups = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures_pokemon_groups.json'), 'utf8'));
  ok(`the catalog fixture is populated (${groups.length} groups)`, groups.length > 150);
  const broken = [];
  let checked = 0;
  for (const g of groups) {
    const m = g.match(/^([A-Za-z]{2,6}\d*)\s*:\s*(.+)$/);
    if (!m) continue;
    checked++;
    if (normalizeSetName(m[2]) !== normalizeSetName(g)) broken.push(g);
  }
  ok(`every coded catalog name matches its plain form (${checked} checked)`, broken.length === 0);
  if (broken.length) fails.push('  unmatched: ' + broken.slice(0, 6).join(', '));
  eq('no catalog set name normalises to nothing',
     groups.filter(g => !normalizeSetName(g)).length, 0);
  // Distinctness. Two families of real set names DO collide after
  // normalisation, both pre-existing and both deliberate: resolveGroupId
  // breaks the tie by preferring the older groupId ("Base Set" 1999 beats
  // "SM Base Set"). Verified against the pre-fix normaliser on 2026-09-04 --
  // the boundary fix changed exactly two names ("MEE:"/"SVE:" energies, which
  // previously kept a stray leading "e") and introduced no new collisions.
  // Pin the known families by name so a NEW merge fails this test.
  const byNorm = {};
  for (const g of groups) (byNorm[normalizeSetName(g)] ||= []).push(g);
  const collided = Object.keys(byNorm).filter(k => byNorm[k].length > 1).sort();
  eq('only the two known set-name families collide', collided.join(','), 'base set,promos');
  eq('the base-set family is the expected three groups',
     byNorm['base set'].slice().sort().join('|'), 'Base Set|SM Base Set|XY Base Set');
  eq('the promo family is the expected three groups',
     byNorm['promos'].slice().sort().join('|'), 'HGSS Promos|SM Promos|XY Promos');
  // The energy groups were repaired by the boundary fix.
  eq('the ME energies group no longer keeps a stray letter',
     normalizeSetName('MEE: Mega Evolution Energies'), 'mega evolution energies');
  eq('the SV energies group no longer keeps a stray letter',
     normalizeSetName('SVE: Scarlet & Violet Energies'), 'scarlet violet energies');
}

// ── B. Name qualifiers must not zero out every query ───────────────────────
const varSrc = grabFn(HTML, 'function _bulkNameVariants');
ok('the name-variant helper exists', varSrc.length > 0);
const nameVariants = new Function(`${varSrc}; return _bulkNameVariants;`)();

const bulba = nameVariants('Bulbasaur (Mega Evolution Stamped)');
eq('the qualified name is still tried first', bulba[0], 'Bulbasaur (Mega Evolution Stamped)');
eq('a stripped spelling is added', bulba[1], 'Bulbasaur');
eq('exactly two spellings are produced', bulba.length, 2);

eq('a bracketed qualifier is also stripped',
   nameVariants('Unown [A]').join('|'), 'Unown [A]|Unown');
eq('a plain name yields exactly one spelling', nameVariants('Minun').length, 1);
eq('a plain name is unchanged', nameVariants('Minun')[0], 'Minun');
eq('inner whitespace is collapsed', nameVariants('Charizard ex (Special Illustration Rare)')[1], 'Charizard ex');
eq('a name that is ENTIRELY a qualifier is not reduced to empty',
   nameVariants('(Promo)').length, 1);
eq('an empty name yields no spellings', nameVariants('').length, 0);
eq('a null name yields no spellings', nameVariants(null).length, 0);
ok('no spelling is ever an empty string', nameVariants('(Promo)').every(v => v.trim().length > 0));
// Unown [A] is a REAL distinct catalog name, so the qualified form must not
// be dropped -- only supplemented.
ok('the qualified spelling is never discarded',
   nameVariants('Unown [A]').includes('Unown [A]'));

// ── C. The query ladder uses both spellings, selective forms first ─────────
{
  const fn = grabFn(HTML, 'async function _bulkFetchPrice(');
  ok('the Pokemon price function exists', fn.length > 0);
  const qi = fn.indexOf('const _names = _bulkNameVariants(cleanName);');
  ok('the ladder is built from the variant helper', qi !== -1);
  const ladder = fn.slice(qi, fn.indexOf('let cards', qi));
  ok('it loops over every spelling', /for \(const nm of _names\)/.test(ladder));
  ok('the number query uses the loop variable', /number:\$\{cleanNumber\}|name:"\$\{nm\}" number:/.test(ladder));
  ok('the set query uses the loop variable', /name:"\$\{nm\}" set\.name:/.test(ladder));
  ok('the bare-name query uses the loop variable', /queries\.push\(`name:"\$\{nm\}"`\)/.test(ladder));
  ok('the raw name is no longer hardcoded into queries', !/name:"\$\{cleanName\}"/.test(ladder));
  // Selective queries for BOTH spellings must precede either bare-name query,
  // so widening the net never costs precision.
  const iSel = ladder.indexOf('set.name:');
  const iBare = ladder.indexOf('queries.push(`name:"${nm}"`)');
  ok('selective queries come before the bare-name queries', iSel !== -1 && iSel < iBare);
  ok('there are two separate loops, not one', (ladder.match(/for \(const nm of _names\)/g) || []).length === 2);
}

// ── D. The price-API fallbacks try both spellings too ──────────────────────
{
  const fetchSrc = grabFn(HTML, 'async function _bulkTcgPriceFetch');
  ok('the shared fallback fetcher exists', fetchSrc.length > 0);
  ok('it iterates the name spellings', /for \(const nm of _bulkNameVariants\(name\)\)/.test(fetchSrc));
  ok('it sends the loop variable, not the raw name', /encodeURIComponent\(nm\)/.test(fetchSrc));
  ok('it keeps looking when a spelling returns no price', /if \(d && d\.market > 0\) return d;/.test(fetchSrc));
  ok('it keeps looking on a non-ok response', /if \(!r\.ok\) continue;/.test(fetchSrc));
  ok('it returns null when no spelling prices', /return null;/.test(fetchSrc));
  ok('it still passes the set through', /'&set='\s*\+\s*encodeURIComponent\(setName\)/.test(fetchSrc));
  ok('it still passes the number through', /'&number='\s*\+\s*encodeURIComponent\(number\)/.test(fetchSrc));
  ok('it still passes the rarity through', /'&rarity='\s*\+\s*encodeURIComponent\(rarity\)/.test(fetchSrc));

  // Every fallback site must be routed through the helper -- a single missed
  // site silently keeps the old behaviour for that path.
  const shimCalls = (HTML.match(/_bulkTcgPriceShim\(/g) || []).length;
  ok(`all fallback sites use the shim (found ${shimCalls})`, shimCalls >= 6);
  ok('no bulk fallback still hardcodes the raw scanner name',
     !/fetch\(`\/api\/tcg-price\?name=\$\{encodeURIComponent\(cleanName\)\}/.test(HTML));
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log('\nFAILURES:'); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
