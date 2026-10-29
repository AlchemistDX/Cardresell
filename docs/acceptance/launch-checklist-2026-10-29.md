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

Sign-in was restored through the secure browser flow. The six-card production batch on commit `29eb7b1` returned one automatic identity, four reviews and one unsupported game. Balance changed from 340 to 339; only Noi used an ID credit. No inventory, drafts or listings were saved.

| Sample | Latest live outcome | Remaining check |
| --- | --- | --- |
| Monkey.D.Luffy P-043, second-anniversary stamp | Printing review | Require exact stamped printing; never substitute ordinary P-043 price |
| Noi 119/204 | Automatic identity on 29eb7b1 | Degraded photo |
| Make the Potion 94/204 | Fixed; original and degraded photos automatic on 3de6191 | Passed supplied-photo check |
| Satoru Gojo, Union Arena | Unsupported | Catalogue, lookup, pricing, scan and draft routing must all work before support is claimed |
| LeBron James 2019 Panini Mosaic #8, PSA 9 | Slab review | Verify label, grade and certificate; no raw-price substitution |
| Josh Sweat 2025 Panini Prizm #4 | Match review: correct candidate plus an unrelated football candidate | Verify identity and honest unavailable-price state |

## External and device gates

- eBay Connect currently checks seller registration, policies and locations. It does not establish market-wide sold-data entitlement, direct publishing or listing sync. Do not advertise those capabilities as live.
- Confirm actual eBay publishing eligibility before enabling publishing. No live listings have been created by these checks.
- Complete physical iPhone Safari camera/upload acceptance. Desktop responsive tests do not establish camera behavior on a physical phone.
- Recheck checkout/free-to-paid flow without an unauthorized real purchase.
- Keep unsupported games and unavailable exact-grade prices explicit. A reference price is not a verified sold comp or an exact physical-finish certification.

Do not mark the launch complete until the remaining acceptance and external/device gates have evidence.

## Follow-up printing fix

Commit `3de619192573ffd96f3e90aceffa0efbc2a46aff`, production deployment `dpl_6pCLczu8XmNZvb43tr9Afc8WZ3Np`.

- Recognize an English Lorcana language marker joined to the collector fraction, without accepting extended numeric tokens or conflicting reprint numbers.
- One Piece recovery can read one enlarged lower-half crop when the first OCR missed the collector code. A promo still requires exact printed event and catalogue evidence; no generic P-043 price is substituted.
- Evidence tests 54/54; real-handler billing/refund checks 22/22; provider contract 45/45; sports retry 54/54. Production scan endpoint starts normally (GET returns expected HTTP 405).

Live retest on `3de6191`: Make the Potion automatically matched Ursula's Return #94/204 from both the original and degraded images (1024-pixel maximum side, JPEG quality 65, 80% brightness, 0.35-pixel blur). Both displayed a $0.04 normal/base-printing estimate. Balance 339 → 337, exactly two successful IDs. Luffy remained review on both, uncharged.

Follow-up `a9680b1` also reads the promo stamp when the code is already present. Evidence tests 56/56, billing 22/22. Original and degraded Luffy still required review; balance stayed 337. The close-up OCR succeeded at the provider boundary but did not establish a unique catalogue printing. This is not recorded as an identification pass.

Intermediate diagnostic application commit: `a0d065ab53f8efa6b81358cca02e647795b2f0d9`; deployment `dpl_DF4DTKRjt4D8h1CfJ1xdsAEEcZut`, READY with both cardresell.org and www.cardresell.org aliases. A targeted original-photo retest recorded `P-043` and `Anniversary`, but no numbered anniversary token, even after close-up OCR. Luffy remains unresolved, with no ID debit. Diagnostics log only bounded collector/event fragments, not photos, credentials or full OCR.

Before the final focused-crop retest, live testing used three ID credits (340 → 337): Noi once and Make the Potion twice. Review/unsupported outcomes were uncharged. Across the major-game report and this follow-up, 10 of the 14 supplied card identities have automatic passes; Luffy, LeBron and Josh Sweat remain review cases, and Union Arena remains unsupported. This is combined evidence across releases, not a claimed 14/14 run on one final build.

The remaining list is therefore explicit: exact Luffy stamped-promo recovery, sports printing/slab disambiguation, complete Union Arena support, broader lower-quality testing for those games, and the external/device gates above. Do not advertise universal automatic matching or automatic sold-data/direct-listing support.


## Final deployed state

Application commit `bd6430dfc0b7fbac409de22530f6e1c4b22c58bb`, production deployment `dpl_FycU5V8Svmnb5whUKZKovxmYyrNW`, READY on the production aliases. The One Piece close-up now enlarges the lower-right stamp/code region instead of the full lower half.

- Final Luffy pair: degraded photo automatically identified **Monkey.D.Luffy (2nd Anniversary Stamped Promo), P-043**, with a $14.60 market estimate. Original photo still needs printing review. This remains a partial fix, not a two-photo pass.
- Final credit balance: 336. Four successful live IDs used four credits total this follow-up; all review and unsupported outcomes were uncharged. No saved inventory, draft or listing mutations.
- Full `bash tests/run-all.sh --local` completed with exit 0 and ALL CHECKS PASSED before the final crop adjustment (508 seconds). Conditional/live suites retain their normal skip conditions; this is not a claim of live checkout, publishing or device acceptance.
- After the crop adjustment, printed-evidence tests including actual crop geometry passed 57/57, and billing/refund integration passed 22/22. Production module startup returned the expected HTTP 405, and the live pair above exercised the final deployed handler.

The final original-photo score remains 10 of 14 across the recorded releases. Luffy has a separate degraded-photo success; its original is still unresolved. Do not count that partial recovery as a complete original-photo pass.
