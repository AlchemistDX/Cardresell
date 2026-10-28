# Original-photo scanner benchmark — October 28, 2026

The owner's 14 physical cards were submitted through the signed-in production scanner at `www.cardresell.org`, using the original front photographs. Back photographs supplied reference information; they were not a second identification input. No cards were saved to customer inventory, drafted, listed or advertised during this benchmark. Originals are not committed to this repository.

The bulk baseline ran at approximately 05:22–05:25 UTC against the pricing release preceding PR #144. The UI reported **8 identified, 3 not identified and 3 needing review**, with two of the eight missing prices. That is a UI outcome count, **not an exact-printing accuracy rate**: some accepted results were wrong or incomplete. The visible ID balance fell from 398 to 390 during the bulk run. Later confirmation charges were not independently reconciled.

## Results from the original photographs

| Card and visible reference | Live result | Finding |
| --- | --- | --- |
| Dusclops 070/185 | Identification temporarily unavailable | Provider HTTP 200 was rejected as `invalid_response`. The UI incorrectly suggested a clearer photo. The malformed response field is still unknown. |
| Applin, Stellar Crown 012/142, reverse holo | Review: Prismatic Evolutions #9 or Stellar Crown #12 | Correct Stellar Crown printing was offered and later selected. The resulting normal/base estimate did not establish the reverse-holo finish. |
| Mimikyu, Paldean Fates 037/091 | Identification temporarily unavailable | Same `invalid_response` boundary as Dusclops; not evidence that the original photo was unreadable. |
| Monkey.D.Luffy P-043, 2nd Anniversary stamp | Accepted Dreamhack Dallas 2024 #043; no price | **Wrong event printing accepted.** Name and number alone are insufficient for this promo. |
| Blitzclique - Breakaway, CORI-EN051, 1st Edition | Accepted name, Unknown set #101305051, $0.25 | **Printed set/collector identity was not established.** A name-wide price was shown. |
| Mega Greninja ex, MEP EN 081 | Correct in both a single scan and the bulk scan | The reported repeated failure did not reproduce in these two attempts. Single lookup showed a $0.82 market, $0.45–$1.50 listed range and $1.99 eBay seven-day aggregate; bulk used a different feed's $0.76 holofoil estimate. These observations do not establish universal reliability or comparable source coverage. |
| Eager Glyphmage, SOS 0011, foil | Accepted Secrets of Strixhaven #11, $0.14 foil | Name, set and number matched; foil route was used. |
| Stadium Tidalmage, SOS 0232 | Accepted Secrets of Strixhaven #232, $0.07 normal | Name, set and number matched. Finish was not independently confirmed. |
| Charizard, Team Up 14/181, PSA 9 slab | Accepted Team Up #14, $17.80 normal/base | **Graded context was lost.** A raw-card estimate was shown for a slab. |
| Noi — Acrobatic Baby, Ursula's Return 119/204 | Accepted Noi, Ursula's Return #119, $0.11 normal | Name/set/number matched. Subtitle and finish remain acceptance details to check. |
| Make the Potion, Ursula's Return 94/204 | Review: Fabled #98 or Ursula's Return #94 | Correct printing offered. Confirmation was attempted after the 15-minute receipt expired and was properly rejected; no accepted identity resulted. |
| Satoru Gojo, Union Arena | Unsupported card type; then inappropriate Pokémon-style OCR recovery | The provider can cover this game, but the app's complete search/pricing workflow does not. Do not present it as supported automatic identification. |
| LeBron James, 2019–20 Panini Mosaic #8, PSA 9 slab | Three review choices with identical visible labels | No defensible selection could be made. Variant/full catalogue names were omitted, and slab context needs protection. |
| Josh Sweat, 2025 Panini Prizm #4 | Accepted Prizm #4; no market value | Name/set/number matched. Sports research was explicitly required. Parallel and price were not established. |

Prices above are observed test outputs, not current valuations or endorsements of the incorrect matches.

## Changes from these findings

- PR #144 added bounded response-failure telemetry: enum validation reason and numeric score/candidate counts. It records neither raw provider payloads nor photographs. Matching thresholds and paid provider options did not change.
- Record-level graded-slab classification and detected slab labels now survive the provider adapter. A detected slab goes to free manual review before raw pricing, saving or a paid candidate confirmation. Automatic grade-label reading is **not** implemented by this change.
- One Piece promos are held for artwork/event review instead of trusting the first event match. This is a conservative safeguard, not automatic recognition of the correct anniversary variant.
- Yu-Gi-Oh preserves the full printed set code, uses it as the grounded collector identifier, and holds incomplete printing identities for review. Bulk prices must match both the returned set and number; the name-wide fuzzy price fallback is removed.
- Review choices include available variation and full catalogue names. Reviews are counted separately from failures, provider outages are described as scanner trouble, and unsupported games skip automatic OCR recovery into another game.
- Review responses refund the ID credit and remain ineligible for inventory/drafts. Normal exact matches retain their existing path. No new paid provider option or additional vision request is introduced.

## Verification and its limits

Focused controlled tests passed: 39 provider-adapter cases, 27 real-handler/isolated-ledger routing checks including legacy free/paid and membership refunds, and 150 shipped-browser checks at 320px, 390px and 1280px. Browser checks include free manual handoff, no accepted raw identity, no inventory/draft writes, escaped provider text, unsupported-game handling and rejection of wrong-printing prices. Additional browser gates passed: 476 bulk confirmation checks with real isolated ledgers, 134 single-scan review checks, 135 bulk retry checks, 62 text-recovery checks and 17 condition-applicability checks. The configured build and immutable-asset validation passed. The full local runner completed with one failing suite: two obsolete assertions required the removed Yu-Gi-Oh name-wide fallback. After replacing those assertions with execution of the shipped exact-printing lookup, all 187 deeplink checks passed; asset and affected browser checks were rerun successfully. Together with the separate condition-applicability run, 170 of 172 registered suites have passing coverage. The real-store and production HTTP smoke gates were excluded from the local run; post-deployment results are recorded separately.

**Original-photo acceptance of the safeguards is still pending.** The first session ended when the browser service timed out during fresh uploads and also failed its recovery calls. Controlled responses verify application handling; they do not prove that the provider will detect every slab or distinguish a particular photographed promo.

## Diagnostic continuation

The browser recovered later on October 28. Re-uploading Dusclops and Mimikyu into a new batch in the same tab replayed the previous failed operations: the client retained a photo-request hash in session storage even after a confirmed refund. Reloading the page did not release that key. No new provider attempt appeared for that replay, and the visible balance stayed at 390.

A fresh tab submitted both originals at approximately **12:05:45 UTC** against production `d23232d`. Both requests reached Ximilar and returned HTTP 200 with **five distances and four alternatives**. Both were rejected specifically as **`scores_unordered`**. This identifies an application response-validation boundary, not unreadable photographs or a missing response. No raw provider response or photo was logged.

The follow-up change keeps each distance attached to its original candidate and compares the best match against the nearest of **all** competing scores. An unsorted tail no longer fails the request. A closer named alternative requires review; a close score without a named candidate still fails safely. Distance cutoffs are unchanged, and no weak best match is automatically promoted from an alternative.

The transport also retires a completed, refunded identification failure's recovery key, allowing the next explicit user attempt to reach the provider. It does not retry automatically. Successful, ambiguous, pending, interrupted and uncertain-billing requests retain their operation token; grading retains its existing behavior. The legacy `IDENTIFY_PROVIDER_UNAVAILABLE` response is recognized because that contract already awaits the refund, so failures cached before this release can recover.

Focused tests passed: **45 provider-contract checks, 61 transport/recovery checks, 37 real-handler/isolated-ledger checks and 18 bounded-telemetry checks**. The ledger checks include unavailable refund acknowledgments for free, paid and membership credits, and unavailable durable-result completion for membership scans. The full 172-slot local runner passed its 170 enabled suites; real-store and production HTTP smoke remained gated out. After the final account-state recheck was added following asynchronous response parsing, the 61 transport checks, 37 ledger checks, 150 identity-review browser checks, 285 asset checks and configured build passed again. These are controlled tests; fresh original-photo outcomes after the follow-up deployment must be recorded separately.

## Required follow-up before advertising

1. Fresh production scans of all 14 originals, prioritizing Dusclops, Mimikyu, both slabs, Luffy, Blitzclique and the unresolved review receipts. Capture bounded diagnostic reasons for the two malformed-response failures before changing validation.
2. Exact finish/printing review, particularly reverse holo Applin, Luffy's anniversary artwork, sports parallels and slab label grade. Avoid treating a base-price estimate as proof of the photographed variant's value.
3. Real-phone save/reload and draft/export acceptance with confirmed identities; a real Seller Hub CSV import and inspection of its validation report.
4. Reconcile provider invoices, allowances and retry usage with credit revenue. Complete a small seller pilot before broader advertising.

See [launch readiness](launch-readiness-20261027.md) for fee comparison, sourced ranges, draft guidance and eBay capability boundaries. Those features remain shipped; market-wide individual sold comparisons and direct publishing are still unavailable.
