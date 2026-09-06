// tests/sku-identity.mjs
// Golden tests for canonical card identity + SKU. Phase 1, Block A3.
//
// No network, no env, no KV. Runs in the standard suite on every commit.
//
// These are the tests that stop a normalization change from silently
// re-identifying every card a user owns. Two properties matter and they pull
// in opposite directions:
//
//   SAME card  → SAME sku, no matter which code path saved it
//   DIFFERENT card → DIFFERENT sku, including "same card, different slab"
//
// Getting the first wrong duplicates a user's collection. Getting the second
// wrong merges two cards they own into one and loses a sale.

import {
  IDENTITY_NAMESPACE, GAME_CODES, KNOWN_GRADERS,
  normalizeText, normalizeNumber,
  canonicalGame, canonicalLanguage, canonicalGrader, canonicalGrade, canonicalCert,
  isSlab, identityAxes, identityString, skuFor, cardIdentity, hasSufficientIdentity,
  identityCompleteness,
} from '../api/_cardIdentity.js';

import { draftsKey, skuDraftKey, DRAFT_INDEX_TTL_SEC } from '../api/_draftIndex.js';

let passed = 0, failed = 0;
function check(name, cond, hint = '') {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${hint ? '\n       → ' + hint : ''}`); }
}
function same(name, a, b, hint) { check(name, skuFor(a) === skuFor(b), hint); }
function diff(name, a, b, hint) { check(name, skuFor(a) !== skuFor(b), hint); }

// A real-shaped collection row, matching what core.js savePortData writes.
const BASE = {
  id: 1757100000000,
  updatedAt: 1757100000000,
  card: 'Charizard ex',
  set: 'Obsidian Flames',
  setCode: 'obf',
  number: '125',
  rarity: 'Double Rare',
  game: 'pokemon',
  cardType: 'pokemon',
  isJapanese: false,
  grader: null,
  grade: null,
  buyPrice: 12,
  currentValue: 40,
};
const row = (over = {}) => ({ ...BASE, ...over });

// ── 1. Determinism ─────────────────────────────────────────────────────────
console.log('\ndeterminism');

same('same row twice → same sku', row(), row());
check('sku is stable across object key order',
      skuFor({ number: '125', game: 'pokemon', setCode: 'obf' })
        === skuFor({ setCode: 'obf', game: 'pokemon', number: '125' }),
      'identityString must use a fixed field order, not Object.keys order');

check('sku carries the v1 namespace',
      skuFor(row()).startsWith(`${IDENTITY_NAMESPACE}-`),
      'namespace versioning is what lets normalization rules change later');

// ── 2. The pokemonjp / isJapanese double-encoding ──────────────────────────
// This is the bug this module exists to close. Language is stored twice in the
// live data model and nothing enforces that the copies agree.
console.log('\nlanguage is stored twice — both paths must converge');

same('game:pokemonjp === game:pokemon + isJapanese:true',
     row({ game: 'pokemonjp', isJapanese: false }),
     row({ game: 'pokemon',   isJapanese: true }),
     'the same JP card saved by two code paths must not become two cards');

same('pokemonjp + isJapanese:true is not double-counted',
     row({ game: 'pokemonjp', isJapanese: true }),
     row({ game: 'pokemon',   isJapanese: true }));

diff('English and Japanese prints are different cards',
     row({ game: 'pokemon', isJapanese: false }),
     row({ game: 'pokemon', isJapanese: true }),
     'a JP print prices differently and must list separately');

check('canonicalGame collapses pokemonjp → pokemon',
      canonicalGame({ game: 'pokemonjp' }) === 'pokemon');
check('canonicalLanguage reads pokemonjp as ja',
      canonicalLanguage({ game: 'pokemonjp' }) === 'ja');
check('canonicalLanguage reads isJapanese as ja',
      canonicalLanguage({ game: 'pokemon', isJapanese: true }) === 'ja');
check('canonicalLanguage also accepts raw scan field is_japanese',
      canonicalLanguage({ game: 'pokemon', is_japanese: true }) === 'ja',
      'scan.js emits is_japanese; core.js stores isJapanese');
check('default language is en',
      canonicalLanguage(row()) === 'en');
check('cardType is a fallback when game is absent',
      canonicalGame({ cardType: 'yugioh' }) === 'yugioh');

// ── 3. Slab identity, including the newly-added cert ───────────────────────
console.log('\nslab identity — cert is what separates two identical grades');

const psa9a = row({ grader: 'PSA', grade: '9', cert: '84213771' });
const psa9b = row({ grader: 'PSA', grade: '9', cert: '84213772' });

same('🔴 two PSA 9s of the same card are ONE product class', psa9a, psa9b,
     'cert identifies a slab, not a product — duplicates are separated by inventory instance id');

same('cert is irrelevant to the sku entirely', psa9a, row({ grader: 'PSA', grade: '9' }));

diff('raw and graded are different', row(), psa9a);
diff('PSA 9 and PSA 10 are different',
     row({ grader: 'PSA', grade: '9',  cert: '1' }),
     row({ grader: 'PSA', grade: '10', cert: '1' }));
diff('PSA 9 and CGC 9 are different',
     row({ grader: 'PSA', grade: '9', cert: '1' }),
     row({ grader: 'CGC', grade: '9', cert: '1' }));

same('slabs with no cert still resolve (pre-Phase-1 rows)',
     row({ grader: 'PSA', grade: '9' }),
     row({ grader: 'PSA', grade: '9' }),
     'cert was never captured before Phase 1 — old rows must not break');

check('a grade with no grader is not a slab',
      isSlab({ grade: '9' }) === false,
      'estGrade is our own guess, not a grading company');
check('a grader with no grade is not a slab',
      isSlab({ grader: 'PSA' }) === false);
check('grader + grade is a slab',
      isSlab({ grader: 'PSA', grade: '9' }) === true);
check('cert on a raw card is ignored',
      identityAxes(row({ cert: '999' })).cert === '',
      'a cert without a grader is meaningless and must not enter identity');

check('unknown grader is preserved, never coerced to a known one',
      canonicalGrader({ grader: 'RCG' }) === 'RCG',
      'silently mapping an unknown grader onto PSA would misprice the card');
check('known graders normalize case and punctuation',
      canonicalGrader({ grader: ' psa ' }) === 'PSA');
check('every advertised grader survives normalization',
      KNOWN_GRADERS.every((g) => canonicalGrader({ grader: g.toLowerCase() }) === g));

// ── 4. Source disagreement that must NOT split a card ─────────────────────
console.log('\nsource formatting differences must not split one card');

same('zero-padded card number matches unpadded',
     row({ number: '045/198' }), row({ number: '45/198' }),
     'sources zero-pad inconsistently; same physical card');
same('set code case and spacing are irrelevant',
     row({ setCode: 'OBF' }), row({ setCode: ' obf ' }));
same('accents in a set name are stripped',
     row({ setCode: '', set: 'Pokémon Jungle' }),
     row({ setCode: '', set: 'Pokemon Jungle' }));
same('grade 9.0 and 9 are the same grade',
     row({ grader: 'PSA', grade: '9.0', cert: '1' }),
     row({ grader: 'PSA', grade: '9',   cert: '1' }));
same('numeric grade and string grade agree',
     row({ grader: 'PSA', grade: 10,   cert: '1' }),
     row({ grader: 'PSA', grade: '10', cert: '1' }));
same('cert leading zeros are stripped',
     row({ grader: 'PSA', grade: '9', cert: '0084213771' }),
     row({ grader: 'PSA', grade: '9', cert: '84213771' }));
same('rarity case and spacing are irrelevant',
     row({ rarity: 'Double Rare' }), row({ rarity: 'double  rare' }));

same('a renamed card is the same card',
     row({ card: 'Charizard ex' }), row({ card: 'Charizard EX (Full Art)' }),
     'card names vary across sources more than any other field — display only');

check('cert precision survives a long value',
      canonicalCert({ cert: '000123456789012345' }) === '123456789012345',
      'parseInt would lose precision here — must be string surgery');

// ── 5. Real differences that MUST split ───────────────────────────────────
console.log('\nreal differences must split');

diff('different card number', row({ number: '125' }), row({ number: '126' }));
diff('different set',         row({ setCode: 'obf' }), row({ setCode: 'sv4' }));
diff('different game',        row({ game: 'pokemon' }), row({ game: 'mtg' }));
diff('different rarity/variant is a different printing',
     row({ rarity: 'Double Rare' }), row({ rarity: 'Illustration Rare' }),
     'rarity is the only parallel/variant signal in the data model');

// ── 6. Format guarantees ──────────────────────────────────────────────────
console.log('\nsku format');

const skus = [
  row(), psa9a, row({ game: 'pokemonjp' }), row({ game: 'sports', setCode: 'topps-chrome-2024' }),
  row({ game: 'mtg', setCode: 'lci', number: '0399' }), row({ game: 'onepiece', setCode: 'op05' }),
  row({ setCode: 'a-very-long-set-code-that-keeps-going-and-going', number: '12345678' }),
].map(skuFor);

check('all skus ≤ 40 chars', skus.every((s) => s.length <= 40),
      'venue SKU fields are length-limited: ' + skus.map((s) => s.length).join(','));
check('all skus are safe ASCII', skus.every((s) => /^[A-Za-z0-9-]+$/.test(s)),
      'must survive URLs, CSV exports and venue APIs unescaped');
check('all skus are distinct', new Set(skus).size === skus.length);
check('head is human-readable', skuFor(row()).includes(GAME_CODES.pokemon),
      'a SKU should be debuggable at a glance, not fully opaque');
check('unknown game still produces a valid sku',
      /^v2-XXX/.test(skuFor({ setCode: 'x', number: '1' })));

check('empty axes do not shift meaning',
      skuFor({ game: 'pokemon', setCode: 'a', number: '' })
        !== skuFor({ game: 'pokemon', setCode: '', number: 'a' }),
      'pipe-delimited with empty segments preserved, or these two collide');

check('identityString is pipe-delimited and starts with the namespace',
      identityString(row()).startsWith(`${IDENTITY_NAMESPACE}|`));
check('raw cards mark the grader slot explicitly',
      identityString(row()).includes('|raw|'),
      'an empty grader slot must be a token, not a gap');

// ── 7. cardIdentity record ────────────────────────────────────────────────
console.log('\ncardIdentity record');

const ident = cardIdentity(psa9a);
check('graded flag set',        ident.graded === true);
check('sku present',            ident.sku === skuFor(psa9a));
check('display name preserved', ident.displayName === 'Charizard ex');
check('carries no venue fields',
      !Object.keys(ident).some((k) => /ebay|tcgplayer|mercari|whatnot|venue|platform/i.test(k)),
      'identity is platform-neutral by design — venue #2 must be an addition, not a migration');

check('sufficient identity requires game, set and number',
      hasSufficientIdentity(row()) === true
      && hasSufficientIdentity({ game: 'pokemon' }) === false
      && hasSufficientIdentity({ setCode: 'obf', number: '1' }) === false);

// ── 8. Index keys — the cross-tenant regression ───────────────────────────
console.log('\ndraft index keys');

const sku = skuFor(psa9a);
check('sku→draft key is scoped to the user',
      skuDraftKey('userA', sku) !== skuDraftKey('userB', sku),
      'the checklist specified a global sku_draft:<sku> — two sellers listing the same card would collide');
check('drafts key is scoped to the user',
      draftsKey('userA') !== draftsKey('userB'));
check('index TTL is a sane positive window',
      DRAFT_INDEX_TTL_SEC > 30 * 24 * 3600 && DRAFT_INDEX_TTL_SEC <= 365 * 24 * 3600);

// ── 9. Normalization primitives ───────────────────────────────────────────
console.log('\nprimitives');

check('normalizeText handles null/undefined', normalizeText(null) === '' && normalizeText(undefined) === '');
check('normalizeNumber handles null',         normalizeNumber(null) === '');
check('normalizeNumber keeps slashes',        normalizeNumber('045/198') === '45/198');
check('normalizeNumber preserves plain zero', normalizeNumber('0') === '0');
check('normalizeNumber strips separators',    normalizeNumber('SV 045') === 'sv45');
check('canonicalGrade of empty is empty',     canonicalGrade({}) === '');
check('canonicalGrade keeps non-numeric grades',
      canonicalGrade({ grade: 'Authentic Altered' }) === 'authenticaltered');


// ── 10. Cert propagation and incomplete-instance semantics ───────────────
// The reviewer's Fix A. The identity model always had a cert axis, but the
// save path could not supply one, so every slab was silently an incomplete
// instance while reporting itself as valid identity. Completeness and
// instance-uniqueness are now two separate questions.
console.log('\ncert propagation / incomplete instances');

const SLAB_NO_CERT = { game: 'pokemon', setCode: 'sv1', number: '045/198', grader: 'psa', grade: '9' };
const SLAB_CERT_A  = { ...SLAB_NO_CERT, cert: '84061234' };
const SLAB_CERT_B  = { ...SLAB_NO_CERT, cert: '84069999' };
const RAW_CARD     = { game: 'pokemon', setCode: 'sv1', number: '045/198' };

check('a raw card is complete PRODUCT identity',
      identityCompleteness(RAW_CARD).complete === true);
check('🔴 the SKU never claims to identify one physical copy — for anything',
      identityCompleteness(RAW_CARD).identifiesOnePhysicalCopy === false &&
      identityCompleteness(SLAB_CERT_A).identifiesOnePhysicalCopy === false,
      'uniformly false is honest; true-for-slabs invited callers to use the SKU as an instance key');
check('🔴 a cert-less slab is COMPLETE product identity',
      identityCompleteness(SLAB_NO_CERT).complete === true,
      '"PSA 9 Charizard Base Set 4" is exactly the product whose payout we compare');
check('cert is no longer a missing identity axis',
      !identityCompleteness(SLAB_NO_CERT).missing.includes('cert'));
check('but a slab still recommends a cert, for the listing',
      identityCompleteness(SLAB_NO_CERT).certRecommended === true &&
      identityCompleteness(RAW_CARD).certRecommended === false);
check('grader and grade ARE identity — a PSA 9 and a PSA 10 are different products',
      skuFor(SLAB_NO_CERT) !== skuFor({ ...SLAB_NO_CERT, grade: '10' }) &&
      skuFor(SLAB_NO_CERT) !== skuFor({ ...SLAB_NO_CERT, grader: 'bgs' }));
check('cardIdentity exposes certKnown so callers cannot miss it',
      cardIdentity(SLAB_NO_CERT).certKnown === false &&
      cardIdentity(SLAB_CERT_A).certKnown === true);
check('🔴 two PSA 9s of the same card are the SAME product class',
      skuFor(SLAB_CERT_A) === skuFor(SLAB_CERT_B),
      'same comps, same category, same payout math — cert belongs on the instance');
check('a raw copy and a graded copy are still different products',
      skuFor(RAW_CARD) !== skuFor(SLAB_CERT_A));
check('the namespace was bumped, so the hash change is auditable',
      skuFor(SLAB_CERT_A).startsWith('v2-'),
      'a silent re-key of persisted inventory is undebuggable later');
check('cert separators are normalized — 8406-1234 is the same slab as 84061234',
      skuFor({ ...SLAB_NO_CERT, cert: '8406-1234' }) === skuFor({ ...SLAB_NO_CERT, cert: '84061234' }));
check('a cert on a RAW card does not affect its identity',
      skuFor({ ...RAW_CARD, cert: '84061234' }) === skuFor(RAW_CARD),
      'cert is only meaningful when grader + grade are present');
check('hasSufficientIdentity is unchanged by cert — it gates listability, not uniqueness',
      hasSufficientIdentity(SLAB_NO_CERT) === true);

// ── 11. Explicit language input (reviewer #3) ────────────────────────────
console.log('\nlanguage signals');

check('explicit language:"ja" is honored',
      canonicalLanguage({ game: 'pokemon', language: 'ja' }) === 'ja');
check('explicit lang:"jp" is honored',
      canonicalLanguage({ game: 'pokemon', lang: 'jp' }) === 'ja');
check('explicit language:"japanese" is honored',
      canonicalLanguage({ game: 'pokemon', language: 'Japanese' }) === 'ja');
check('explicit language:"en" stays English',
      canonicalLanguage({ game: 'pokemon', language: 'en' }) === 'en');
check('game:pokemonjp still wins over an English language default',
      canonicalLanguage({ game: 'pokemonjp', language: 'en' }) === 'ja',
      'the game field describes the printing; language is often a UI default');
check('isJapanese flag still wins over an English language default',
      canonicalLanguage({ game: 'pokemon', isJapanese: true, language: 'en' }) === 'ja');
check('🔴 both JP save paths produce the SAME sku',
      skuFor({ game: 'pokemonjp', setCode: 'sv1', number: '045' }) ===
      skuFor({ game: 'pokemon', isJapanese: true, setCode: 'sv1', number: '045' }),
      'two code paths, one card');
check('an unknown language string does not silently become Japanese',
      canonicalLanguage({ game: 'pokemon', language: 'de' }) === 'en');

// ── 12. Key delimiter safety (reviewer #7) ──────────────────────────────
console.log('\nkey encoding contract');

check('a sub containing the separator cannot forge another key',
      skuDraftKey('a:b', 'sku1') !== skuDraftKey('a', 'b:sku1'),
      'components are percent-encoded, so ":" is not in a component alphabet');
check('a sku containing the separator is encoded too',
      !skuDraftKey('u1', 'a:b').endsWith('a:b'));
check('ordinary subs and skus are unaffected',
      skuDraftKey('1234567890', 'v1-charizard-abcdef0123456789')
        === 'skudraft:1234567890:v1-charizard-abcdef0123456789');

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
