# Launch checklist — 2026-10-29

This is a status record, not a claim that every card or every launch gate passes.

## Completed with evidence

- Major-game identification: eight supplied Pokémon, Magic and Yu-Gi-Oh! fronts plus eight degraded copies automatically identified on production. See [major-games-release.md](major-games-release.md) for the tested commit, identities, finish limitations and credit accounting.
- Fee comparison is visible in the bulk results, including singles versus lot payout. Unknown purchase costs remain unknown and negative payouts remain visible.
- Placeholder ±15% ranges removed; asking-price evidence is distinguished from sold evidence.
- Draft download help has a hide/reopen control and Seller Hub upload link. CSV export does not require connecting eBay.
- Scanner transport now treats non-JSON service failures as recoverable service errors. It preserves the operation ID for an explicit same-photo retry; it does not automatically resend, claim a refund or ask for a clearer photo. Existing sign-in and insufficient-credit handling remain intact.

Transport-change validation: recovery 91/91, single-scan browser 150/150 (including new HTML 503 and malformed HTTP 200 recovery cases), bulk-recovery browser 135/135, asset fingerprints 285/285. Tests use controlled upstream responses; they are not live provider accuracy measurements.

## Remaining supplied-photo acceptance

The browser was signed out during this follow-up. No additional paid live scans were performed. Earlier outcomes below are historical, not newly verified against the major-game release.

| Sample | Earlier result | Next check |
| --- | --- | --- |
| Monkey.D.Luffy P-043, second-anniversary stamp | Printing review | Require exact stamped printing; never substitute ordinary P-043 price |
| Noi 119/204 | Automatic identity | Repeat against current release and degraded photo |
| Make the Potion 94/204 | Automatic identity | Repeat against current release and degraded photo |
| Satoru Gojo, Union Arena | Unsupported | Catalogue, lookup, pricing, scan and draft routing must all work before support is claimed |
| LeBron James 2019 Panini Mosaic #8, PSA 9 | Slab review | Verify label, grade and certificate; no raw-price substitution |
| Josh Sweat 2025 Panini Prizm #4 | Automatic identity, no price | Verify identity and honest unavailable-price state |

## External and device gates

- eBay Connect currently checks seller registration, policies and locations. It does not establish market-wide sold-data entitlement, direct publishing or listing sync. Do not advertise those capabilities as live.
- Confirm actual eBay publishing eligibility before enabling publishing. No live listings have been created by these checks.
- Complete physical iPhone Safari camera/upload acceptance. Desktop responsive tests do not establish camera behavior on a physical phone.
- Recheck checkout/free-to-paid flow without an unauthorized real purchase.
- Keep unsupported games and unavailable exact-grade prices explicit. A reference price is not a verified sold comp or an exact physical-finish certification.

Do not mark the launch complete until the remaining acceptance and external/device gates have evidence.
