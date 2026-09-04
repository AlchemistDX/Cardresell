// Regression: the bulk row for "Minun - Paradox Rift #194 (Illustration Rare)"
// rendered $50.00 "Normal" with a 2006 thumbnail. That is POP Series 3 Minun
// #4 -- a different card entirely. Verified against pokemontcg.io on
// 2026-09-04: `name:"Minun"` returns 20 printings, Paradox Rift #194 is the
// LAST, and the request asked for pageSize=10, so the correct card was
// truncated out before scoring. Every surviving candidate then scored zero
// (wrong number, wrong set, wrong rarity), the sort was stable, and the first
// arbitrary printing -- POP Series 3 #4 at $50.00 -- was rendered as the
// user's card.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const TCG = readFileSync(join(ROOT, 'api/tcg-price.js'), 'utf8');

let pass = 0; const fails = [];
const ok = (m, c) => { if (c) pass++; else fails.push(m); };
const eq = (m, a, b) => { if (Object.is(a, b)) pass++; else fails.push(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); };

function grabFn(src, sig) {
  const i = src.indexOf(sig);
  if (i === -1) return '';
  let j = src.indexOf('{', src.indexOf(')', i)), d = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  return '';
}

// ── 1. The candidate list must not be truncated ────────────────────────────
{
  const fn = grabFn(HTML, 'async function _bulkFetchPokemonCards');
  ok('the card-search helper exists', fn.length > 0);
  ok('it no longer caps the candidate list at 10', !/pageSize=10\b/.test(fn));
  ok('it requests the full result set', /pageSize=250/.test(fn));
  const m = fn.match(/pageSize=(\d+)/);
  ok('the page size covers the 20 Minun printings', m && Number(m[1]) >= 20);
  ok('it still selects the fields the matcher scores on',
     /select=id,name,set,number,rarity,images,tcgplayer/.test(fn));
}

// ── 2. A set-scoped query sits between number and bare name ────────────────
{
  const fn = grabFn(HTML, 'async function _bulkFetchPrice(');
  ok('the Pokemon price function exists', fn.length > 0);
  const qi = fn.indexOf('const queries = [];');
  ok('the query ladder is present', qi !== -1);
  const ladder = fn.slice(qi, fn.indexOf('let cards', qi));
  ok('the number query is still tried first', ladder.includes('number:'));
  ok('a set-scoped query was added', ladder.includes('set.name:'));
  ok('the set query is guarded on setName being present', /if \(setName\) queries\.push/.test(ladder));
  ok('the set query strips quotes so it cannot break the query', /replace\(\/"\/g, ''\)/.test(ladder));
  const iNum = ladder.indexOf('number:');
  const iSet = ladder.indexOf('set.name:');
  const iBare = ladder.lastIndexOf('queries.push(`name:');
  ok('order is number, then set, then bare name', iNum < iSet && iSet < iBare);
}

// ── 3. The corroboration guard: the actual fix ─────────────────────────────
const guardSrc = grabFn(HTML, 'function _bulkCandidateCorroborated');
ok('the corroboration guard exists', guardSrc.length > 0);
const setScoreSrc = grabFn(HTML, 'function _bulkSetMatchScore');
ok('the set-match scorer exists', setScoreSrc.length > 0);

// Execute the real functions rather than pattern-matching them.
const _bulkSetMatchScore = new Function(`${setScoreSrc}; return _bulkSetMatchScore;`)();
const _bulkCandidateCorroborated = new Function(
  `${setScoreSrc}; ${guardSrc}; return _bulkCandidateCorroborated;`)();

const POP3    = { number: '4',   set: { name: 'POP Series 3' },  rarity: 'Rare' };
const PR194   = { number: '194', set: { name: 'Paradox Rift' },  rarity: 'Illustration Rare' };
const PR61    = { number: '61',  set: { name: 'Paradox Rift' },  rarity: 'Common' };
const DEOXYS  = { number: '41',  set: { name: 'Deoxys' },        rarity: 'Uncommon' };

// The exact misfire, rejected.
eq('POP Series 3 #4 is rejected for a Paradox Rift #194 scan',
   _bulkCandidateCorroborated(POP3, 'Paradox Rift', '194'), false);
eq('the real card is accepted',
   _bulkCandidateCorroborated(PR194, 'Paradox Rift', '194'), true);
// Every other printing the truncated list could have returned.
for (const c of [
  { number: '7',  set: { name: 'Dragon' } },            { number: '12', set: { name: 'POP Series 1' } },
  { number: 'HGSS17', set: { name: 'HGSS Black Star Promos' } },
  { number: '32', set: { name: 'Secret Wonders' } },    { number: '25', set: { name: 'Majestic Dawn' } },
  { number: '34', set: { name: 'HS—Unleashed' } },      { number: '37', set: { name: 'Emerald' } },
  DEOXYS,                                               { number: '32', set: { name: 'Furious Fists' } },
]) {
  eq(`${c.set.name} #${c.number} is rejected for the Paradox Rift scan`,
     _bulkCandidateCorroborated(c, 'Paradox Rift', '194'), false);
}
// Right set, wrong number still passes -- the set alone corroborates, and the
// score sort already prefers the number match when one exists.
eq('a same-set printing is allowed through',
   _bulkCandidateCorroborated(PR61, 'Paradox Rift', '194'), true);
// Number alone corroborates when the set name is missing or differs in wording.
eq('a number match carries a differently-worded set',
   _bulkCandidateCorroborated(PR194, 'Paradox Rift Set', '194'), true);
eq('zero-padding is not a mismatch',
   _bulkCandidateCorroborated({ number: '093', set: { name: 'Nope' } }, 'Nope Set', '93'), true);
eq('a variant letter suffix is not a mismatch',
   _bulkCandidateCorroborated({ number: '179a', set: { name: 'Nope' } }, '', '179'), true);
eq('with neither number nor set there is nothing to contradict',
   _bulkCandidateCorroborated(POP3, '', ''), true);
eq('a wrong number with no set is rejected',
   _bulkCandidateCorroborated(POP3, '', '194'), false);
eq('rarity alone must NOT corroborate',
   _bulkCandidateCorroborated({ number: '9', set: { name: 'Elsewhere' }, rarity: 'Illustration Rare' },
                              'Paradox Rift', '194'), false);
eq('a missing candidate is rejected', _bulkCandidateCorroborated(null, 'Paradox Rift', '194'), false);
// A merely-overlapping set name must not corroborate. "Rift" appears inside
// "Paradox Rift", but a set called "Rift" is a different product; only an
// exact or prefix match (score >= 2) counts.
eq('a set name that merely overlaps does not corroborate',
   _bulkCandidateCorroborated({ number: '9', set: { name: 'Rift' } }, 'Paradox Rift', '194'), false);
// Scored 1.5 (contains, not prefix) which is below the >= 2 bar. The test
// originally asserted true; the code is right and the expectation was wrong.
eq('a set name that only contains the target does not corroborate',
   _bulkCandidateCorroborated({ number: '9', set: { name: 'Sword & Shield Paradox' } }, 'Paradox', '194'), false);
eq('an exact set name corroborates',
   _bulkCandidateCorroborated({ number: '9', set: { name: 'Paradox Rift' } }, 'Paradox Rift', '194'), true);
eq('a prefix set name corroborates',
   _bulkCandidateCorroborated({ number: '9', set: { name: 'Paradox Rift Promo' } }, 'Paradox Rift', '194'), true);
// The scanner may report the number zero-padded; the guard strips it on BOTH
// sides, so "0194" must still match "194".
eq('a zero-padded scanned number still matches',
   _bulkCandidateCorroborated({ number: '194', set: { name: 'Nope' } }, 'Other', '0194'), true);
eq('a zero-padded scanned number does not match a different card',
   _bulkCandidateCorroborated({ number: '4', set: { name: 'Nope' } }, 'Other', '0194'), false);
eq('a candidate with no number and no set is rejected',
   _bulkCandidateCorroborated({}, 'Paradox Rift', '194'), false);

// ── 4. The guard is actually wired into the match path ─────────────────────
{
  const fn = grabFn(HTML, 'async function _bulkFetchPrice(');
  const at = fn.indexOf('const best = cards[0].c;');
  ok('the winner is still selected by score', at !== -1);
  const after = fn.slice(at, at + 1800);
  ok('the winner is passed through the guard', /_bulkCandidateCorroborated\(best, setName, cleanNumber\)/.test(after));
  ok('an uncorroborated winner is not returned as the card', /if \(!_bulkCandidateCorroborated/.test(after));
  ok('it retries the tcgcsv price route before giving up', /\/api\/tcg-price\?name=/.test(after));
  ok('the retry is a real network call, not stubbed out',
     /await fetch\(`\/api\/tcg-price\?name=/.test(after));
  ok('the retry passes the scanned set so it cannot match another set',
     /rMis[\s\S]{0,40}|&set=' \+ encodeURIComponent\(setName\)/.test(after));
  // The bad-match branch must emit NEITHER a price NOR an image.
  const bi = after.indexOf('if (!_bulkCandidateCorroborated');
  let d = 0, branch = '';
  for (let k = after.indexOf('{', bi); k < after.length; k++) {
    if (after[k] === '{') d++;
    else if (after[k] === '}') { d--; if (d === 0) { branch = after.slice(bi, k + 1); break; } }
  }
  ok('the branch was isolated', branch.length > 0);
  ok('an unconfirmed row carries no price', /marketPrice: null/.test(branch));
  ok('an unconfirmed row carries no image', /imageUrl: ''/.test(branch));
  ok('an unconfirmed row explains itself', /unavailableReason:/.test(branch));
  ok('the explanation does not claim the card is worthless', !/\$0|worthless|no value/i.test(branch));
}

// ── 5. tcg-price must stop rejecting "194" against "194/182" ───────────────
{
  const norm = grabFn(TCG, 'function tcgNormalizeNumber');
  const mism = grabFn(TCG, 'function tcgNumberMismatch');
  ok('the number normaliser exists', norm.length > 0);
  ok('the mismatch check exists', mism.length > 0);
  const tcgNumberMismatch = new Function(`${norm}; ${mism}; return tcgNumberMismatch;`)();
  eq('"194" against "194/182" is NOT a mismatch', tcgNumberMismatch('194', '194/182'), false);
  eq('"4" against "4/130" is NOT a mismatch',     tcgNumberMismatch('4', '4/130'), false);
  eq('zero padding is not a mismatch',            tcgNumberMismatch('93', '093'), false);
  eq('reverse zero padding is not a mismatch',    tcgNumberMismatch('093', '93'), false);
  eq('a trainer-gallery number survives',         tcgNumberMismatch('tg03', 'TG03/TG30'), false);
  eq('identical numbers are not a mismatch',      tcgNumberMismatch('194', '194'), false);
  // Still catches genuinely different cards -- the guard must not go slack.
  eq('a different card in the same set IS a mismatch',  tcgNumberMismatch('194', '61/182'), true);
  eq('a longer number IS a mismatch',                   tcgNumberMismatch('194', '1094/182'), true);
  eq('"4" against "40/102" IS a mismatch',              tcgNumberMismatch('4', '40/102'), true);
  eq('a letter suffix IS still distinguished',          tcgNumberMismatch('179a', '179'), true);
  eq('an empty request is not judged',                  tcgNumberMismatch('', '194'), false);
  eq('an empty resolution is not judged',               tcgNumberMismatch('194', ''), false);
  eq('"0" is preserved, not stripped to empty',         tcgNumberMismatch('0', '0'), false);
  // The zero-strip must be lookahead-guarded. A greedy /^0+/ turns "0" into
  // "" and the function then declines to judge the pair at all.
  const tcgNormalizeNumber = new Function(`${norm}; return tcgNormalizeNumber;`)();
  eq('"0" normalises to "0", not empty string', tcgNormalizeNumber('0'), '0');
  eq('"00" normalises to "0", not empty string', tcgNormalizeNumber('00'), '0');
  eq('"093" normalises to "93"', tcgNormalizeNumber('093'), '93');
  eq('"194/182" normalises to "194"', tcgNormalizeNumber('194/182'), '194');
  eq('"0" against "5" IS a mismatch', tcgNumberMismatch('0', '5'), true);
}

// ── 6. The printed number must outrank a guessed rarity ────────────────────
// Okidogi ex #90 (Special Illustration Rare, $22.63) resolved to Shrouded
// Fable #36 ($0.89) when the scanner reported the rarity as "Double Rare":
// #36 scored 0 + 3 + 15 = 18 against #90's 10 + 3 + 0 = 13. The number is
// printed in plain digits, the rarity is inferred from the art, so the number
// must win. Rarity still separates candidates that share a number.
{
  const fn = grabFn(HTML, 'async function _bulkFetchPrice(');
  const numSrc = grabFn(fn, 'function _numScore');
  const rarSrc = grabFn(fn, 'function _rarityScore');
  ok('the number scorer exists', numSrc.length > 0);
  ok('the rarity scorer exists', rarSrc.length > 0);

  const mk = (src, name, vars) => new Function(
    `const targetNumRaw=${JSON.stringify(vars.num)},targetRarityLo=${JSON.stringify(vars.rar)};${src};return ${name};`)();

  const numScore = (cand, num) => mk(numSrc, '_numScore', { num, rar: '' })(cand);
  const rarScore = (cand, rar) => mk(rarSrc, '_rarityScore', { num: '', rar })(cand);

  const setScore = _bulkSetMatchScore;
  const total = (cand, num, rar, set) =>
    numScore(cand, num) + setScore(cand.set.name, set) + rarScore(cand, rar);

  const OK36 = { number: '36', set: { name: 'Shrouded Fable' }, rarity: 'Double Rare' };
  const OK90 = { number: '90', set: { name: 'Shrouded Fable' }, rarity: 'Special Illustration Rare' };

  eq('an exact number match outscores an exact rarity match',
     numScore(OK90, '90') > rarScore(OK36, 'double rare'), true);
  const s90 = total(OK90, '90', 'double rare', 'Shrouded Fable');
  const s36 = total(OK36, '90', 'double rare', 'Shrouded Fable');
  ok(`#90 now beats #36 when the rarity is misread (${s90} vs ${s36})`, s90 > s36);
  ok('#36 is no longer the winner on a #90 scan', s36 < s90);

  // The case the rarity weight exists for must still work: same name, same
  // number, different rarity -- rarity is the only separator.
  const CROBAT_BASE = { number: '93',  set: { name: 'Sword & Shield' }, rarity: 'Common' };
  const CROBAT_IR   = { number: '093', set: { name: 'Sword & Shield' }, rarity: 'Illustration Rare' };
  eq('both Crobat printings score the same on number',
     numScore(CROBAT_BASE, '93'), numScore(CROBAT_IR, '93'));
  ok('rarity still separates two printings that share a number',
     total(CROBAT_IR, '93', 'illustration rare', 'Sword & Shield') >
     total(CROBAT_BASE, '93', 'illustration rare', 'Sword & Shield'));
  ok('and it separates them the other way for a base-rarity scan',
     total(CROBAT_BASE, '93', 'common', 'Sword & Shield') >
     total(CROBAT_IR, '93', 'common', 'Sword & Shield'));

  // A wrong-numbered card must never win on set + rarity alone.
  eq('set plus rarity cannot outrank a number match',
     total(OK36, '90', 'double rare', 'Shrouded Fable') >= numScore(OK90, '90'), false);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log('\nFAILURES:'); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
