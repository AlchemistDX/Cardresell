# Catalog accuracy and acceptance — 2026-10-08

Camera guide work is paused at the user's request. Prioritize correct identity,
printing and coverage. Neither image quality warnings nor catalog matching prove
that every detail is readable.

## Server enrichment repair

The production enrichment functions for Pokémon, Magic, Yu-Gi-Oh! and Lorcana
previously could choose the first catalog result or a name-only reprint and
overwrite scan details. Enrichment now requires supported printing evidence:
name, collector number and an exact set alias for Pokémon/Magic/Lorcana; a
printed set code and an unambiguous printing for Yu-Gi-Oh! Explicit language
conflicts are refused. Collector-number suffixes are preserved. Pokémon caches
are versioned and checked against the requested identity before use.

A Yu-Gi-Oh! passcode alone can identify a card but cannot choose its printing.
Card-wide prices are no longer attached as if printing-specific. Ambiguous
results retain the original scan evidence. This prevents enrichment corruption;
it does not independently certify the upstream scan, finish, artwork variant,
authenticity or grade. Fewer enrichments are an expected conservative tradeoff.

Validation: 273 isolated checks passed: catalog-printing-evidence 23,
scan-rarity-grounding 19, scan-hygiene 182, test-scan 37 and test-registry 12.
The production scan functions ran against synthetic provider responses and
isolated Redis; no customer credits or paid provider scans were used. Syntax,
release inspection and whitespace checks passed. These are regressions, not
real-world recognition calibration.

## Coverage audit

Repository index counts, unique IDs, 2026-10-08:

| Local instant-match index | Cards | Represented sets |
|---|---:|---:|
| Pokémon | 20,506 | 171 |
| Magic | 11,924 | 109 |

These are local image-hash indexes, not the total searchable catalog. External
identification and catalog APIs add coverage. A represented set is not necessarily
complete. No competitor parity percentage is established.

Read-only Scryfall `/sets` audit: among 224 released, non-digital, nonempty sets
of types core, expansion, masters, draft_innovation and commander, 42 have at
least one local index entry and 182 have none. Cutoff: 2026-10-08. Examples absent
locally: Foundations Commander (FDC), Wilds of Eldraine (WOE), Commander Masters
(CMM), The Lord of the Rings: Tales of Middle-earth (LTR). This measures local
representation, not whether the external identification service can find them.
Reproduce with `python tools/audit-catalog-coverage.py --mtg-sets <sets.json>`
using the JSON response from `https://api.scryfall.com/sets`.

The Pokémon sets endpoint returned HTTP 500 during this audit, so current remote
coverage could not be measured. Official docs at https://docs.pokemontcg.io/
announce no new account registrations and existing-key service through
2027-03-01. Plan a replacement before expanding dependence on that API. No new
provider account, subscription or migration was created.

## Remaining accuracy work

- The client image-hash fast path still accepts some results automatically.
  The Magic index uses a limited unique-artwork selection; a large distance gap
  within that selection cannot certify a printing absent from the index.
- Measure same-art reprints, finish variants and language coverage with labeled
  photos, including examples absent from the local index. Reference-image
  self-matches are not a substitute for phone-photo accuracy.
- Expand printing-aware coverage only with ambiguity handling and measured
  regressions. Simply adding hash rows does not guarantee better identification.
- Overall completion remains approximately 85%; local regression results do not
  complete phone acceptance or establish catalog parity.

## Phone test list

Use ordinary ID scans first; Deep Grade is unnecessary for these checks. Scans
that reach the server retain their normal credit cost. Record starting/ending
balance. No customer credits were used in the implementation tests.

1. **Baseline:** scan a clear, common card. Check exact name, set, number,
   language and displayed image against the physical card.
2. **Same-art reprint:** scan two printings with the same name/art. Each must
   retain its own set and number. A wrong automatic match is a failure.
3. **Variants:** test foil/nonfoil and alternate art where available. An
   unconfirmed finish must not silently receive another variant's price.
4. **Number suffix:** test a promo or special-number card. Symbols and suffixes
   must not disappear or change the selected printing.
5. **Language:** test an English and a non-English card. The catalog image and
   identity must not silently switch languages.
6. **Older/newer set:** test a known older set and a recent released set. Record
   exact physical identity for every miss; distinguish a miss from a wrong match.
7. **Yu-Gi-Oh!:** scan a reprinted card with a visible set code. Verify that the
   selected set and rarity correspond to that code, not just the passcode.
8. **Ambiguity:** obscure the number or set slightly. The app should offer
   uncertainty/retake where needed; any confident wrong printing fails acceptance.
9. **Repeat:** repeat one clear card three times. Record whether the exact
   identity stays consistent. Do not infer grade consistency from ID scans.

For each attempt save: game, true name/set/number/language/finish, returned
identity, correct/wrong/unresolved, whether it was instant or server lookup,
credit change and screenshot. Report exact-printing accuracy and unresolved
rate separately, by game, with the sample count. No measured rate yet.
