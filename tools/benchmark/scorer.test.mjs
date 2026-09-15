/* Adversarial tests for the benchmark scorer — work-order item 7.
 *
 * "Test the scorer against deliberately wrong responses before using its
 * results." A scorer is only evidence if it FAILS things that deserve to fail.
 * Every test below feeds a response that a broken scorer would pass.
 *
 * Run: node tools/benchmark/scorer.test.mjs
 */
import assert from 'node:assert/strict';
import * as S from './scorer.mjs';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
};

const label = { game: 'pokemon', setCode: 'base1', number: '2/102', name: 'Ivysaur' };
const rec = { photoPath: 'a.jpg', label };

console.log('Unicode preservation (the defect that inflated Japanese accuracy)');
t('two different Japanese names do NOT compare equal', () => {
  // Old scorer: both normalised to '' and compared equal.
  assert.notEqual(S.normIdent('リーフィア'), S.normIdent('サンダース'));
  assert.equal(S.normIdent('リーフィア'), 'リーフィア');
});
t('a wrong Japanese card is graded WRONG, not correct', () => {
  const jp = { game: 'pokemon', setCode: 'sv2a', number: '001/165', name: 'リーフィア' };
  const out = S.scoreOne({ photoPath: 'x.jpg', label: jp }, {
    endState: 'EXACT_MATCH',
    printing: { ...jp, name: 'サンダース' }, // different card
  });
  assert.equal(out.verdict, S.VERDICT.WRONG_EXACT, 'must not pass a different Japanese card');
});
t('accents are preserved, not folded away', () => {
  assert.notEqual(S.normIdent('Pokémon'), S.normIdent('Pokemon'));
});
t('NFKC still unifies genuine compatibility forms', () => {
  assert.equal(S.normIdent('ﬁre'), S.normIdent('fire')); // ligature
  assert.equal(S.normIdent('２'), '2');                   // fullwidth digit
});

console.log('\ndeliberately wrong responses must be caught');
t('wrong printing in the same set is WRONG_EXACT', () => {
  const out = S.scoreOne(rec, { endState: 'EXACT_MATCH', printing: { ...label, number: '3/102', name: 'Venusaur' } });
  assert.equal(out.verdict, S.VERDICT.WRONG_EXACT);
});
t('right name in the WRONG set is WRONG_EXACT (complete identity, not name-only)', () => {
  const out = S.scoreOne(rec, { endState: 'EXACT_MATCH', printing: { ...label, setCode: 'base4' } });
  assert.equal(out.verdict, S.VERDICT.WRONG_EXACT, 'set code is part of the printing identity');
});
t('right name and set in the WRONG game is WRONG_EXACT', () => {
  const out = S.scoreOne(rec, { endState: 'EXACT_MATCH', printing: { ...label, game: 'lorcana' } });
  assert.equal(out.verdict, S.VERDICT.WRONG_EXACT);
});
t('empty printing is not a match', () => {
  assert.equal(S.scoreOne(rec, { endState: 'EXACT_MATCH', printing: {} }).verdict, S.VERDICT.WRONG_EXACT);
});
t('null printing is not a match', () => {
  assert.equal(S.scoreOne(rec, { endState: 'EXACT_MATCH', printing: null }).verdict, S.VERDICT.WRONG_EXACT);
});
t('a response echoing the label as a shortlist of 1 is not an exact match', () => {
  const out = S.scoreOne(rec, { endState: 'NEEDS_CONFIRMATION', candidates: [label] });
  assert.equal(out.verdict, S.VERDICT.CORRECT_IN_SHORTLIST);
  assert.notEqual(out.verdict, S.VERDICT.CORRECT_EXACT, 'confirmation is not an exact match');
});

console.log('\nnumber normalisation must not create false matches');
t('leading zeros and set size are equivalent', () => {
  const out = S.scoreOne(rec, { endState: 'EXACT_MATCH', printing: { ...label, number: '002' } });
  assert.equal(out.verdict, S.VERDICT.CORRECT_EXACT);
});
t('different numbers stay different', () => {
  assert.notEqual(S.normNumber('2/102'), S.normNumber('20/102'));
});
t('TG12 is not 12', () => {
  assert.notEqual(S.normNumber('TG12'), S.normNumber('12'));
});

console.log('\ntop-3 is exactly three');
t('correct card at position 4 does NOT count', () => {
  const filler = (n) => ({ game: 'pokemon', setCode: 'base1', number: `${n}/102`, name: `Filler${n}` });
  const out = S.scoreOne(rec, { endState: 'NEEDS_CONFIRMATION', candidates: [filler(9), filler(8), filler(7), label] });
  assert.equal(out.verdict, S.VERDICT.WRONG_SHORTLIST, 'position 4 is outside top-3');
  assert.equal(out.evidence.overLimit, true, 'oversized shortlist is flagged');
});
t('correct card at position 3 does count', () => {
  const filler = (n) => ({ game: 'pokemon', setCode: 'base1', number: `${n}/102`, name: `Filler${n}` });
  const out = S.scoreOne(rec, { endState: 'NEEDS_CONFIRMATION', candidates: [filler(9), filler(8), label] });
  assert.equal(out.verdict, S.VERDICT.CORRECT_IN_SHORTLIST);
});

console.log('\ninfrastructure vs recognition separation');
t('HTTP 500 is infrastructure, not a recognition miss', () => {
  const out = S.scoreOne(rec, { httpStatus: 500 });
  assert.equal(out.verdict, S.VERDICT.INFRA_ERROR);
  assert.equal(out.isRecognition, false);
});
t('HTTP 429 is infrastructure, never a missing card', () => {
  const out = S.scoreOne(rec, { httpStatus: 429 });
  assert.equal(out.verdict, S.VERDICT.INFRA_ERROR);
  assert.equal(out.isRecognition, false);
});
t('401 is an auth failure, reported separately from infra', () => {
  assert.equal(S.scoreOne(rec, { httpStatus: 401 }).verdict, S.VERDICT.AUTH_FAILURE);
});
t('SOURCE_UNAVAILABLE is infrastructure, not UNKNOWN_CARD', () => {
  const out = S.scoreOne(rec, { endState: 'SOURCE_UNAVAILABLE' });
  assert.equal(out.verdict, S.VERDICT.INFRA_ERROR);
  assert.equal(out.isRecognition, false);
});
t('infrastructure failures are excluded from accuracy denominators', () => {
  const a = S.aggregate([
    S.scoreOne(rec, { endState: 'EXACT_MATCH', printing: label }),
    S.scoreOne(rec, { httpStatus: 500 }),
    S.scoreOne(rec, { httpStatus: 401 }),
  ]);
  assert.equal(a.identifiableScans, 1);
  assert.equal(a.top1Accuracy, 1);
  assert.equal(a.infrastructureFailures, 1);
  assert.equal(a.authFailures, 1);
});

console.log('\nincomplete labels are unscoreable, never free passes');
t('missing setCode in the label makes the row unscoreable', () => {
  const out = S.scoreOne({ photoPath: 'a.jpg', label: { game: 'pokemon', number: '2/102', name: 'Ivysaur' } },
    { endState: 'EXACT_MATCH', printing: label });
  assert.equal(out.verdict, S.VERDICT.UNSCOREABLE_LABEL);
  assert.deepEqual(out.evidence.missing, ['setCode']);
});
t('unscoreable rows do not inflate accuracy', () => {
  const a = S.aggregate([S.scoreOne({ photoPath: 'a.jpg', label: { name: 'Ivysaur' } }, { endState: 'EXACT_MATCH', printing: label })]);
  assert.equal(a.identifiableScans, 0);
  assert.equal(a.top1Accuracy, null, 'no denominator means no accuracy claim');
});

console.log('\nrefusals');
t('refusing a fully labelled card is WRONG_REFUSAL', () => {
  assert.equal(S.scoreOne(rec, { endState: 'UNKNOWN_CARD' }).verdict, S.VERDICT.WRONG_REFUSAL);
});
t('refusing a card expected to be refused is correct', () => {
  const out = S.scoreOne({ photoPath: 'b.jpg', expectedEndState: 'UNSUPPORTED_CARD', label: {} },
    { endState: 'UNSUPPORTED_CARD' });
  assert.equal(out.verdict, S.VERDICT.CORRECT_REFUSAL);
});
t('naming a printing for an unsupported card is WRONG_EXACT', () => {
  const out = S.scoreOne({ photoPath: 'b.jpg', expectedEndState: 'UNSUPPORTED_CARD', label: {} },
    { endState: 'EXACT_MATCH', printing: label });
  assert.equal(out.verdict, S.VERDICT.WRONG_EXACT);
});
t('unknown end state is flagged, not silently ignored', () => {
  assert.equal(S.scoreOne(rec, { endState: 'PROBABLY_FINE' }).verdict, S.VERDICT.UNEXPECTED_STATE);
});

console.log('\nevery incorrect automatic exact match is counted');
t('wrongHighConfidence counts each silent substitution', () => {
  const a = S.aggregate([
    S.scoreOne(rec, { endState: 'EXACT_MATCH', printing: label }),
    S.scoreOne(rec, { endState: 'EXACT_MATCH', printing: { ...label, name: 'Venusaur' } }),
    S.scoreOne(rec, { endState: 'EXACT_MATCH', printing: { ...label, setCode: 'base4' } }),
  ]);
  assert.equal(a.wrongHighConfidenceCount, 2);
  assert.ok(Math.abs(a.wrongHighConfidenceRate - 2 / 3) < 1e-9);
});

console.log('\nmanifest validation and scan cap');
t('empty manifest is rejected', () => {
  const r = S.validateManifest({ records: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /empty/.test(e)));
});
t('missing records array is rejected', () => {
  assert.equal(S.validateManifest({}).ok, false);
});
t('manifest with an incomplete label is rejected', () => {
  const r = S.validateManifest({ records: [{ photoPath: 'a.jpg', label: { name: 'Ivysaur' } }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /incomplete label/.test(e)));
});
t('valid manifest passes', () => {
  const r = S.validateManifest({ records: [{ photoPath: 'a.jpg', label }] });
  assert.equal(r.ok, true); assert.equal(r.count, 1);
});
t('scan cap of 50 is enforced by throwing, not truncating', () => {
  assert.throws(() => S.enforceScanCap(51), /exceeds the authorised cap of 50/);
  assert.equal(S.enforceScanCap(50), 50);
});
t('nonsense scan counts are rejected', () => {
  assert.throws(() => S.enforceScanCap(0));
  assert.throws(() => S.enforceScanCap(-1));
  assert.throws(() => S.enforceScanCap(2.5));
});

console.log('\nmeta: the scorer must reject an all-wrong run');
t('a scanner that returns the same card for everything scores ~0, not ~1', () => {
  const cards = [
    { game: 'pokemon', setCode: 'base1', number: '2/102', name: 'Ivysaur' },
    { game: 'pokemon', setCode: 'base1', number: '4/102', name: 'Charizard' },
    { game: 'pokemon', setCode: 'sv2a', number: '001/165', name: 'リーフィア' },
    { game: 'lorcana', setCode: 'TFC', number: '1/204', name: 'Ariel' },
  ];
  const scored = cards.map((c) => S.scoreOne({ photoPath: 'x', label: c },
    { endState: 'EXACT_MATCH', printing: cards[0] })); // always answers Ivysaur
  const a = S.aggregate(scored);
  assert.equal(a.top1Accuracy, 0.25, 'only the one genuine match counts');
  assert.equal(a.wrongHighConfidenceCount, 3);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
