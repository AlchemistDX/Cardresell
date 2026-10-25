# Scanner and binder audit — October 24, 2026

The scanner and binder workflow audit found and fixed recognition-adapter, printing-handoff, timeout and review-interface defects. **2,865 checks passed across 34 targeted suites.** These are software regression checks, not a card-recognition accuracy percentage.

The full current scanner flow was reviewed: camera/file input → local photo checks → binder alignment and pocket selection → upload → provider interpretation → exact-printing enrichment → review and credit confirmation → batch recovery, collection and draft handoff. The provider is still Ximilar. Recognition thresholds, paid-request options and the sports retry policy are unchanged.

## Findings and fixes

| Finding | Consequence | Correction and evidence |
|---|---|---|
| Missing/unrecognized game tags defaulted to Pokémon | Magic or another game could enter the wrong catalog/pricing path | Prefer the catalog match’s game; support accent/MTG aliases; retain a supported visual tag as fallback; unknown games produce a refunded miss. Actual-adapter contract tests cover both Magic and other supported games. |
| First detected object was assumed to be the card | A slab label could be mistaken for an identity | Select the Card object. Multiple identified cards require a tighter crop. Test label-first, label-only and multiple-card responses. |
| Record-level failures and invalid distances were not checked | HTTP-success responses could produce a false match or misleading retake guidance | Reject failed image records and malformed, negative, unsorted or missing scores; provider faults return a temporary error with a refund. |
| Alternatives inherited the top match’s distance; distance was rendered as a percentage | Review could overstate certainty | Preserve each candidate’s own distance; remove uncalibrated match percentages and unmeasured photo-quality claims. Cutoffs remain 0.35/0.55 with the same gap rule. |
| Review preferred a derived ID over the verified catalog ID | A chosen Magic printing could lose its exact catalog reference | Keep the verified printing ID through the offered choice and accepted result; real scan/accept handlers tested against private Redis. |
| Sports metadata used undocumented field names; numeric identifiers could be reclassified as Yu-Gi-Oh | Set, sport and brand could be lost or routed incorrectly | Preserve provider set_name, subcategory and company; keep sports identifiers in the sports flow. |
| Some catalog deadlines ended at response headers | A stalled body could leave the scan waiting | Keep Magic, Lorcana and relevant Yu-Gi-Oh deadlines active through JSON decoding. Fault tests cover body stalls, HTTP, network and parse failures. |
| Candidate text was interpolated into HTML; options were small | Unsafe provider text and harder mobile review | Escape names/details, remove percentage claims and enlarge candidate details/tap targets. Shipped picker tested at 390px and 1280px. |
| Old accuracy scripts were broken or diverged from shipped code | Their results could misrepresent current behavior | Replace duplicate-import/hardcoded-path script with an offline, labeled-fixture run of the shipped JavaScript. Python entry point delegates to it. |

The new adapter tests failed 24 of 31 cases before the fix and pass all 31 now. The new catalog deadline assertion also fails against the prior implementation and passes after the fix. Three new suites are registered in the normal test runner.

## Measured photo results

| Measurement | Result | Meaning |
|---|---|---|
| Occupied/empty classification on seven synthetic/composited binder pages | All 66 pocket labels matched: 46 occupied, 20 empty | Selection behavior on these fixtures, not recognition accuracy |
| Real owner binder photo | 1500 × 2000 source; all 9 occupied pockets selected | One real Pokémon page; convenience sample |
| Prepared crops from that page | 9/9 complete crops; each 443 × 605; all passed size/blur checks | Crop preparation is usable; passing QC does not prove readable fine print, absence of glare or successful ID |
| Qualified local artwork candidates | 0/9 | No crop met the local matcher’s conservative gate |
| Raw nearest-name guesses | 4/9 correct names | Diagnostic only; the other five illustrate why weak neighbors must never be promoted |
| Automatic identities from local matching | 0/9; zero unsafe promotions | The workflow correctly keeps Ximilar/explicit catalog review as the identity boundary |
| Non-card control | No accepted identity or qualified candidate | One negative icon control |
| Evaluation calls | Zero scan requests; zero browser errors | No paid recognition, customer credits, inventory or listings changed |

Detailed rows, source hashes, shipped asset references and regression counts are in [scanner-audit-20261024.json](scanner-audit-20261024.json).

## Workflow verification

Tests cover the enlarged binder camera guide across supported layouts, viewport resizing, native capture alignment, rotation, grid movement without trapping scroll, selection reset, multi-page navigation, minimum crop dimensions, JPEG handoff without recompression, camera track cleanup and decoder fallback.

The single/bulk flows also cover ambiguous choices, exact selected printing and finish, pricing isolation, manual name lookup, no charge before acceptance, atomic credit use/refunds, lost acknowledgements, repeated confirmation, retaking a card, recovery after interruption, account changes, stale async responses, and preventing uncertain cards from becoming collection items or listing drafts. Real Redis is used for billing/state transitions; provider/auth/catalog responses are isolated fixtures. Full `run-all.sh` application coverage was not repeated; the 34 scanner-related suites and asset/registry gates were selected for this audit.

## Limits and the next accuracy measurement

**A live Ximilar recognition rate has not been measured in this audit.** The recovered Magic uploads are phone screenshots of review/results, not the original camera input. They cannot reproduce the exact bytes or resolution the provider received. The reported 0/9 Magic and 4/9 Pokémon outcomes remain historical user observations, not a post-fix benchmark. No matching provider-usage logs were available in the scoped one-hour production window checked during the audit.

The real-page test is small and Pokémon-only. It does not establish Magic, other games, foil/finish identification, language coverage, very recent-set coverage, native iPhone Safari performance, or grading accuracy. Chromium tests cover mobile viewports and synthetic camera streams; a real iPhone camera/Safari check remains necessary. A 400px crop short edge remains a minimum guard, not a quality guarantee.

For a defensible recognition benchmark, retain the original full-resolution Magic and Pokémon photos and independently label game, card name, set, number, language and finish. Score name and exact-printing accuracy separately, including correct matches, wrong matches, review-needed results, misses, latency and charges/refunds. Include glare, sleeves, rotations, mixed/empty pages and recent releases. Threshold changes require that evidence; they were not loosened to force more matches here.

## Reproduce locally

Install the project’s test dependencies and provide Chromium/Redis as required by the existing suites. Then:

```sh
node tests/ximilar-contract.mjs
node tests/scanner-catalog-deadlines.mjs
node tests/scanner-audit-browser.mjs
node tests/binder-autoselect-browser.mjs
node tools/fastpath_calibration.mjs tests/fixtures/scanner-accuracy.json /tmp/scanner-accuracy.json
```

`CR_CHROMIUM` can point to a local Chromium executable. The evaluator serves repository assets locally through Playwright routing and blocks external/API requests. Its manifest accepts explicitly labeled local single-card photos or binder pages. Results are local-artwork diagnostics, never a substitute for a live, independently labeled provider benchmark.

Provider contract reference: [Ximilar Collectibles Recognition documentation](https://docs.ximilar.com/collectibles/recognition). The adapter retains single-image recognition and rotation correction; it does not enable per-card analyze-all billing.
