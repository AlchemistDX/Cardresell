/* tests/collector-number-format.mjs
 *
 * displayCollectorNumber: appending a set's printed denominator WITHOUT
 * producing a number that does not exist.
 *
 * Will's correction 5: "The number formatter needs safeguards. Simply
 * appending a denominator could produce TG12/TG30/132. Preserve already-
 * complete numbers, prefixes and zeros; append only verified, applicable
 * denominators."
 *
 * So the cases that matter here are the REFUSALS, not the happy path. Each
 * block below is one way a naive `${number}/${printedTotal}` is wrong, and the
 * refusals outnumber the appends deliberately.
 */
import { harness } from './_assert.mjs';
import { displayCollectorNumber as fmt } from '../api/_listingTitle.js';

const T = harness('collector-number-format');
const { check: ok, section } = T;
const eq = (name, got, want) =>
  ok(name, got === want, `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);


await section('the demonstration case -- the seller\u2019s actual card', () => {

  /* Verified against api.pokemontcg.io/v2/cards/me1-134 in-session:
     number "134", printedTotal 132, total 188. The card is a secret rare, so its
     printed number EXCEEDS the printed total, and "134/132" is exactly what is
     on the card and what buyers search. */
  eq('D1. Ivysaur 134 in a 132-card set reads 134/132', fmt('134', 132), '134/132');
  eq('D2. a leading # on the input is not doubled', fmt('#134', 132), '134/132');
});

await section('refusal: the number is already complete', () => {

  /* Appending here would produce "125/197/165" -- two denominators. */
  eq('A1. a slashed number is returned untouched', fmt('125/197', 165), '125/197');
  eq('A2. even when the denominators agree', fmt('132/132', 132), '132/132');
  eq('A3. and with a leading #', fmt('#079/078', 165), '079/078');
});

await section('refusal: subset prefixes are numbered against their own run', () => {

  /* TG12 is Trainer Gallery card 12 of 30, not 12 of the main set. "TG12/132"
     is the specific string Will named as the failure to avoid. 1,620 records in
     card-index.json carry a prefix like this. */
  eq('B1. TG12 does not become TG12/132', fmt('TG12', 132), 'TG12');
  eq('B2. TG30 does not become TG30/132', fmt('TG30', 132), 'TG30');
  eq('B3. RC8 keeps its Radiant Collection prefix', fmt('RC8', 132), 'RC8');
  eq('B4. SWSH001 is left alone', fmt('SWSH001', 202), 'SWSH001');
  eq('B5. GG05 is left alone', fmt('GG05', 159), 'GG05');
  eq('B6. a trailing-letter promo number is left alone', fmt('14a', 132), '14a');
  eq('B7. an H-prefixed number is left alone', fmt('H12', 110), 'H12');
});

await section('refusal: the denominator is not verified', () => {

  /* "Do not derive the denominator from the catalogue's record count or maximum
     card number." An absent denominator must print the bare number rather than
     a guess. */
  eq('C1. no denominator supplied', fmt('134', undefined), '134');
  eq('C2. null denominator', fmt('134', null), '134');
  eq('C3. empty-string denominator', fmt('134', ''), '134');
  eq('C4. zero is not a denominator', fmt('134', 0), '134');
  eq('C5. a negative is not a denominator', fmt('134', -132), '134');
  eq('C6. a non-numeric denominator', fmt('134', 'lots'), '134');
  eq('C7. NaN', fmt('134', NaN), '134');
  eq('C8. a fractional denominator is refused', fmt('134', 132.5), '134');
});

await section('leading zeros survive', () => {

  /* "Preserve meaningful prefixes and leading zeros in collector numbers." The
     raw string is never re-parsed, so the padding printed on the card stays. */
  eq('E1. 007 keeps both zeros', fmt('007', 102), '007/102');
  eq('E2. 007 keeps them with no denominator too', fmt('007', undefined), '007');
  eq('E3. a single leading zero survives', fmt('04', 102), '04/102');
});

await section('empty and malformed input', () => {

  eq('F1. empty string', fmt('', 132), '');
  eq('F2. undefined', fmt(undefined, 132), '');
  eq('F3. null', fmt(null, 132), '');
  eq('F4. a lone # is not a number', fmt('#', 132), '');
  eq('F5. whitespace only', fmt('   ', 132), '');
  eq('F6. surrounding whitespace is trimmed', fmt('  134  ', 132), '134/132');
  eq('F7. a numeric (not string) input still works', fmt(134, 132), '134/132');
});

await section('the formatter is not an identity function', () => {

  /* If the safeguards were implemented by simply never appending, every refusal
     above would pass while the feature did nothing. This is the assertion that
     makes the refusals meaningful. */
  ok('G1. the happy path really does append',
    fmt('134', 132) !== fmt('134', undefined),
    'the formatter never appends, so every refusal above is vacuous');
});

/* ── the identity effect of restoring leading zeros ─────────────────────────
   Will's correction 6: "measure the identity effects of restoring leading
   zeros before any backfill."

   MEASURED, not assumed. tools/seed_set_v2.py strips leading zeros when it
   writes the catalogue's `nu` field, so a display fix would mean putting them
   back. The question is whether that re-identifies cards. It does not: the
   number identity axis runs through normalizeNumber (api/_cardIdentity.js:79-84),
   whose final step strips leading zeros from every digit run before the axis is
   hashed. So zeros are a PRESENTATION property, not an identity one.

   These assertions pin that property, so a later change to normalizeNumber
   cannot quietly turn a cosmetic backfill into a re-identification of every
   card a seller owns. No backfill is performed here. */

const { skuFor, normalizeNumber } = await import('../api/_cardIdentity.js');

await section('restoring leading zeros is SKU-neutral (measured)', () => {
  const base = { card: 'Ivysaur', set: 'Mega Evolution', setCode: 'MEG', game: 'pokemon', rarity: 'Illustration Rare' };
  const sku = (number) => skuFor({ ...base, number });

  const pairs = [
    ['134', '134',  'unchanged control'],
    ['7',   '007',  'three-digit pad'],
    ['7',   '07',   'two-digit pad'],
    ['12',  '0012', 'over-padded'],
    ['RC8', 'RC08', 'prefixed number'],
    ['TG12','TG012','prefixed, over-padded'],
  ];
  for (const [stripped, padded, why] of pairs) {
    ok(`H. ${stripped} vs ${padded} -> same SKU (${why})`,
      sku(stripped) === sku(padded),
      `${sku(stripped)} !== ${sku(padded)}`);
  }

  /* NON-VACUITY. If skuFor ignored the number entirely, every pair above would
     match while measuring nothing. A genuinely different number must move it. */
  ok('H0. the SKU really is sensitive to the collector number',
    sku('134') !== sku('135'),
    'skuFor does not vary with the number, so the pairs above are vacuous');

  ok('H1. the zero-stripping lives in normalizeNumber, which is what the axis hashes',
    normalizeNumber('007') === normalizeNumber('7') && normalizeNumber('007') === '7',
    `normalizeNumber('007') = ${JSON.stringify(normalizeNumber('007'))}`);

  /* And the thing zeros DO affect: what the seller reads. */
  ok('H2. zeros survive into the DISPLAY number (the reason to restore them)',
    fmt('007', 102) === '007/102',
    `fmt('007', 102) = ${JSON.stringify(fmt('007', 102))}`);
});

T.done();
