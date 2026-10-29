# Major-game scanner release verification

Status: PRIORITY PHOTO ACCEPTANCE PASSED. This is not universal accuracy or a
certification of every game, condition, finish, or future customer photo.

Application: `5c137dbcd6da2dc1da891b523bf0a131f1c9eb19`
Production deployment: `dpl_GeyjXpHqc1MKbRivhyGgDrxuDdxV`
Production URL: https://www.cardresell.org/
Verified: 2026-10-29 UTC.

## Live acceptance

All 16 unchanged fixtures ran through the signed-in production upload and scan
flow in a fresh browser tab after deployment. No candidate was manually chosen.
The companion JSON preserves original hashes and records each outcome.

| Card | Original and reduced-quality result |
|---|---|
| Dusclops | Automatic Vivid Voltage #70 |
| Applin | Automatic Stellar Crown #012 |
| Mimikyu | Automatic Paldean Fates #037 |
| Blitzclique - Breakaway | Automatic Chaos Origins #CORI-EN051 |
| Mega Greninja ex | Automatic Mega Evolution Promos #81 |
| Eager Glyphmage | Automatic Secrets of Strixhaven #11 |
| Stadium Tidalmage | Automatic Secrets of Strixhaven #232 |
| Charizard slab | Automatic Team Up #14, PSA 9, certificate 51044018 |

Result: 16 automatic correct identities, zero reviews, zero wrong automatic
identities observed. The reduced-quality fixtures are synthetic stress cases
(1024px maximum, JPEG quality 65, brightness 0.8, blur radius 0.35), not a
representative sample of customers. Both Magic photos use the same clearly
labeled base-printing estimate; this does not establish their physical finish.
Both Charizard scans explicitly lack a verified price for the grade and never
substitute a raw-card price. The final batch charged exactly 16 credits
(balance 356 to 340). No inventory, real draft, or listing was saved.

Earlier repair attempts are not counted in this final acceptance. One earlier
Yu-Gi-Oh request was incorrectly classified as a slab by the upstream provider;
it was held for review and refunded. The latest original and degraded scans
both passed. That observation remains a monitoring concern rather than evidence
that all provider classification failures have been eliminated. An in-page
repeat reused cached results and was excluded; acceptance used a fresh tab.

## Implemented repairs

- Read bounded high-confidence OCR regions alongside full text, preserving
  region boundaries and Unicode collector separators.
- For English Yu-Gi-Oh codes, correct O/S/I only in the three numeric suffix
  positions. Require a unique catalogue printing, printed name, and independent
  visual name agreement for corrected codes. Prefixes are not fuzzed;
  conflicting printed codes remain unresolved.
- If a valid single-card Pokemon OCR read misses its collector fraction, make
  one bounded OCR read of an enlarged lower-left image crop. Processing caps
  image dimensions/bytes, respects request time budgets, and adds no customer
  debit. Native image processing uses pinned sharp 0.35.5 and a lockfile.
- A missing Pokemon slash can be recovered only from the complete observed
  numeric token, exact visual name/set/number, and official set metadata.
  Conflicting explicit fractions/set codes, outages, and ambiguous printings
  still prevent automatic acceptance.
- Preserve symbol-era set support and dedicated slab-label verification.
- Use a stable labeled base-price estimate across games when finish is
  uncertain. Finish correction stays optional; no mandatory new question.

## Broader launch checklist verified

- Live bulk comparison shows lot and singles fees/net payouts immediately.
  Negative payouts remain visible; unknown purchase cost is not invented.
- The blanket +/-15% price tiers are removed. Reported asking-price ranges are
  distinguished from sold data, and unavailable ranges remain explicit.
- eBay draft downloads expose the Seller Hub Reports upload link. Draft help
  supports Don't show again and can be reopened. This release did not upload
  a real CSV to eBay or publish a listing.
- eBay Connect copy correctly describes read-only seller setup/policy/location
  checks and reusable selling settings. It does not unlock sold-price data,
  direct publishing, or automatic sales/inventory synchronization. CSV export
  does not require connecting.

## Verification

Targeted checks: printed evidence 46, billing/refund 15, finish selection 74,
finish browser 226, native focused crop processing passed. Broader checks:
fee truth 132, price evidence 52, selling-price browser 219, draft help browser
78. The full `bash tests/run-all.sh --local` run completed with ALL CHECKS PASSED.
Conditional/live suites may skip; test counts are not photo accuracy results.

## Remaining limits

- General recognition quality still depends on upstream visual/OCR services;
  fail-closed reviews and refunds remain necessary.
- Physical foil, reverse foil, condition, and authenticity are not certified
  by identity acceptance. Estimates are labeled and sellers may correct them.
- Sold-data access and verified graded prices are not guaranteed by an eBay
  connection. Missing values are intentionally not fabricated.
- Sports, One Piece, Lorcana, and Union Arena are outside this three-game
  acceptance. The earlier 14-card report remains historical evidence only.

## Rollback

The preceding healthy production deployment was
`dpl_5UygnJivzcpWGiLS8dQXydoadjyD` (b406673). It lacks joined-digit recovery for
original Applin. Inspect deployment health before any rollback. Never restore
an import.meta URL runtime loader: it previously broke the deployed CommonJS
scan route. No rollback was performed for this release.
