# Major-game scanner release preparation

Status: PREPARED, NOT ACCEPTED FOR LAUNCH.

Application: `892af836d596ea04a6dfa7e778c0b5c7385a5794`
Production deployment: `dpl_A3UbdVgis12Lr2hi7uXyDSuxxTWd`
Production URL: https://www.cardresell.org/

## Scope and evidence

Pokémon, Magic, and Yu-Gi-Oh! are the priority. The companion
`major-games-cases.json` records 16 fixtures, their SHA-256 hashes, dimensions,
expected names, sets, and printed identifiers. Photos remain outside Git.
The reduced-quality fixtures use a maximum dimension of 1024 pixels, JPEG
quality 65, brightness 0.8, and Gaussian blur radius 0.35. They are synthetic
stress cases, not a representative customer accuracy study.

All 16 live cases have now run on this application release.

| Card | Original | Reduced quality |
|---|---|---|
| Dusclops | Automatic Vivid Voltage #70 | Same identity |
| Applin | Match review | Match review |
| Mimikyu | Automatic Paldean Fates #037 | Same identity |
| Blitzclique | Name found, printing review | Same review |
| Mega Greninja ex | Automatic Mega Evolution Promos #81 | Same identity |
| Eager Glyphmage | Automatic Secrets of Strixhaven #11, foil selected | Same identity, **non-foil selected** |
| Stadium Tidalmage | Automatic Secrets of Strixhaven #232 | Same identity |
| Charizard slab | Team Up #14, PSA 9, certificate 51044018 | Same identity, grade and certificate |

Execution: 16/16 (100%). Identity outcomes: 12 automatic, 4 review, no wrong
automatic identity observed in this small test set. This is not general
accuracy or launch-readiness certification. Eager's finish changes between
photos and remains a separate pricing/variant failure. Stadium's physical
finish is not independently certified. Charizard correctly states no verified
price for this grade; no raw value is substituted.

Credit balance across this acceptance set: 373 to 361, twelve successful IDs
and four reviews. No net debit for the review cases was observed. No inventory,
real drafts or listings were saved. Original final batch: 371 to 367; reduced
quality batch: 367 to 361.

Reduced-quality diagnostics: Applin textLength 261, nameRows 18, candidates 0,
ratios []; Blitzclique textLength 491, nameRows 6, candidates 0, printedCodes [].
Higher resolution alone did not solve these two cards. Current diagnostics
cannot distinguish missing OCR characters from token-boundary/normalization
problems, so do not claim a provider-only root cause. The reader currently uses
_ocr.full_text. Provider documentation also describes per-region OCR text;
inspect those structures with bounded, non-sensitive diagnostics before
changing extraction. Do not substitute guessed _identification values for
independent printed evidence.

## Changes already deployed

- Pokémon symbol-era cards no longer require an abbreviation absent from the
  physical card. Exact visual identity plus printed name/number and verified
  official set denominator can corroborate a unique printing. Conflicting
  printed set codes still prevent automatic acceptance.
- Capture preserves up to 2048px at JPEG quality 0.92, within a 2 MB base64
  budget. This is an implementation change, not proof of improved live OCR.
- Slab evidence uses the dedicated slab identification endpoint, retaining
  strict grade/certificate checks and preventing raw-price substitution.

## Verification completed

Printed evidence: 35 passed (rerun during preparation). Previous verification
of this application source: billing/refund 15, sports retry 54, slab browser
60, Ximilar contract 45, registry 12. The remote full local suite completed
with ALL CHECKS PASSED; conditional/live suites may skip. These are not live
photo accuracy results. The remote sandbox is stopped.

## Remaining repair order

1. Inspect missing collector evidence in full text versus OCR regions for
   Applin and Blitzclique. Preserve exact printed-code and unique-printing checks.
2. Repair extraction based on actual response evidence. Keep provider work
   bounded and within the same customer operation; no extra credit debit.
3. Fix finish uncertainty: Eager's degraded photo must not silently turn a foil
   card into a confidently priced non-foil. Identity and finish need distinct
   confidence handling without adding mandatory questions to every scan.
4. Run relevant regression tests, verify production API startup, then repeat
   both failing identities and finish checks in fresh tabs after deployment.
5. Repeat the complete 16-case matrix when the scanner changes. Preserve
   original fixtures and hashes; never count manual candidate selection as auto.
6. Continue the broader pre-advertising checklist below after scanner acceptance.

## Acceptance gates

- Every original has the correct automatic name, set and collector identifier.
  A review or manually selected candidate is not an automatic pass.
- No wrong automatic identity in either group. Review on a degraded image is
  safer than a fabricated match, but remains an unresolved usability result.
- Finish and condition are separately checked; an identity pass does not
  establish reverse holo, foil, physical condition, or authenticity.
- Charizard retains PSA 9 and its photographed certificate; no raw price is
  substituted. Missing graded price must be explicit.
- Failed/review outcomes follow the refund contract; retries do not double-debit.
- Production API startup and an authenticated photo scan succeed after deploy.
- No claim of general scanner accuracy is based solely on this small fixture set.

## Broader pre-advertising checklist

These remain separate from scanner acceptance and require current verification:

- Fee comparison is visible without an extra special dropdown, uses actual
  venue formulas, and does not retain the blanket 15% placeholder.
- Low/high ranges are measured provider data; missing data is explained without
  fabricated bounds or false precision.
- eBay Connect clearly states what it enables. Connection is not proof of sold
  data access or automatic draft publishing.
- Downloaded eBay drafts have clear upload guidance and a verified Seller Hub
  destination, plus dismissible/reopenable help if implemented.
- Sports, One Piece, Lorcana and Union Arena results are not implied by the
  three-game acceptance. Known unsupported games remain explicitly labeled.

## Rollback readiness

If a new deployment fails module startup, stop paid testing and inspect the
deployment logs before further scans. Do not reintroduce the import.meta URL
runtime loader that previously failed under deployed CommonJS. A rollback
target must be chosen from an inspected, healthy prior deployment; an older
commit is not automatically a safe rollback. Preserve the current production
deployment ID above and do not move aliases without checking its successor.
