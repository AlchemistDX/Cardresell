# Core-game provider recovery — October 29, 2026

Scope: Pokémon, Magic and Yu-Gi-Oh!, with Japanese Pokémon routing preserved. Optional sports/Union Arena work is deferred. This is a provider-integration release, not a claim of exhaustive card recognition accuracy.

## Corrected behavior

- A card selected through Scryfall or another fallback catalogue now requests graded prices from its own game. Previously the call site defaulted non-Pokémon cards without `tplGameSlug` to Pokémon.
- Graded detail and name requests have a six-second header/body deadline. Failed requests return control to the existing unavailable-price flow instead of waiting indefinitely.
- Name-based graded lookup inspects up to 100 returned candidates rather than 20. This remains a bounded quick search, not exhaustive enumeration.
- Detail responses must carry the requested provider ID. Explicit foreign-game responses, stale selections and malformed responses cannot supply prices.
- Known Pokémon era prefixes such as `SM - Unbroken Bonds` match the same set without its presentation prefix. Meaningful differences such as `Base Set 2`, collector suffixes, full collector denominators and finish differences remain protected.
- Malformed search envelopes are unavailable, not successful empty searches.
- The new regression is registered in the full suite. Existing price-evidence fixtures execute the shared deadline/game helpers too.
- No new mandatory questions, modal dialogs, paid service subscriptions or catalogue migrations.

## Live paid-provider evidence

Read-only production calls to `/api/tpl-proxy` returned HTTP 200 for all seven distinct queries. Three broad queries were repeated to inspect their response shape; no inventory, drafts, listings or account credits were modified.

| Query | Game | Evidence |
|---|---|---|
| Mew | Pokémon | 100 returned rows, including Unbroken Bonds 76/214; condition-specific market and asking-price fields present. |
| Lightning Bolt | Magic | 100 returned rows; raw and graded pricing present on the sampled Alpha printing, but its collector number is null. |
| Dark Magician | Yu-Gi-Oh! | 100 returned rows, including LCYW-EN001, 1st Edition. |
| Mega Greninja ex | Pokémon | Exact 081 promo present as `Mega Greninja ex - 081`, `ME: Mega Evolution Promo`, Holofoil; NM market $0.79 at audit time. |
| Eager Glyphmage | Magic | Secrets of Strixhaven #11, Normal and Foil; NM market $0.13 / $0.15 at audit time. |
| Stadium Tidalmage | Magic | Secrets of Strixhaven #232, Normal and Foil; NM market $0.08 / $0.09 at audit time. |
| Blitzclique - Breakaway | Yu-Gi-Oh! | Chaos Origins CORI-EN051, 1st Edition; NM market $0.26 at audit time. |

These are observed provider quotes, not appraised values, physical finish verification or independent sold-transaction audits. Broad searches include fuzzy results; neither their counts nor their prices establish an exact printing by themselves. The Greninja query reports 346 total hits but returns only its first 100: this release does not claim complete paid-search pagination. Supplemental catalogue browsing remains available.

## Acceptance boundary

The earlier signed-in photo acceptance remains 8/8 core-game cards on originals and 8/8 on reduced-quality fixtures (see `major-games-release.md`). This release changes lookup/price recovery, not photo recognition. Those 16 scans were not rerun or rebilled here. The separate short-name Mew/Muk scanner fix was deployed in `bff528d` before this release.

Missing provider collector numbers, unsupported exact variants and absent graded prices remain unavailable rather than guessed. The paid provider's live responses confirm that the difficult examples exist; they do not certify every set, language or printing in the subscription. Physical iPhone camera acceptance, a representative accuracy study and external eBay entitlement gates remain separate work.

## Validation

- New core-game recovery suite: 48 checks passed, including actual shipped helper execution, late responses, wrong games, wrong IDs, era prefixes, and header/body stalls.
- Price evidence: 52 checks passed; exact finish, collector and set safeguards preserved.
- Full `bash tests/run-all.sh --local` completed with ALL CHECKS PASSED across 176 registered suite entries. Conditional/live suites retain their documented skip gates; this is not a real-payment or physical-device test.
- Paid-provider browser outcome checks passed 142 checks, draft selection handoff 62, and immutable asset fingerprints 285.
- Shipped core bundle: `js/core.302986f3.js`. Production release and post-release checks are recorded in the conversation handoff.

## Production release

- Application commit: `09ed446228efdb84f2545b5879c4fb44462a7336`.
- Deployment: `dpl_CUWxrjzADR1D37nnxnpWuq9ZyQcW`, READY on `www.cardresell.org` and `cardresell.org`.
- Public HTML references `js/core.302986f3.js`; fetched bytes independently hash to `302986f3` (1,525,821 bytes).
- Full regression command exited 0 after 624 seconds, with ALL CHECKS PASSED. No app code changed after that run.
- A fresh Chromium page at 390px executed the shipped detail helper against the live paid proxy. Mew/Pokémon, Lightning Bolt/Magic and Dark Magician/Yu-Gi-Oh! all returned their exact requested IDs, game and name, with 5/20/5 price rows respectively. This is a browser/provider integration check, not physical iPhone camera acceptance.
- The initial early-page check returned null for Yu-Gi-Oh!; its direct API response was valid. A settled-page individual retry and then a complete three-game retry passed. The original null's precise cause was not established; it is not counted as a pass.
- Deployment-scoped error/fatal logs returned no entries in the five-minute post-deployment check. This is a short observation window, not a future uptime guarantee.
