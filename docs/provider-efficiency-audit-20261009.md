# Provider efficiency and release audit — October 9, 2026

## Changes

- Ximilar identification now retains its 15-second deadline through JSON and error-body consumption. Timeout observations are explicitly labeled; a stalled response is not automatically resubmitted.
- OpenAI grading attempts now have a 60-second deadline covering headers and body. Successful-response timeouts escape to the existing refund handler instead of initiating a second model attempt. Existing HTTP/empty/parse fallback rules remain. An abort does not establish that the provider incurred no cost.
- eBay sold comparisons use bounded cache requests and a six-second full-body provider deadline. Access denial/challenge pauses uncached lookups for 15 minutes, rate limits for five minutes, and transient failure for 30 seconds. Shared cooldown is best effort in Redis with per-instance fallback, not a distributed concurrency lock. Good cached comparisons remain usable. The direct marketplace search link remains available; unavailable comparisons have null prices and an explicit reason.
- Removed browser impersonation/rotation headers. Provider denial is respected; this release does not establish reliable or licensed eBay sold-data access.
- Cached raw comparisons are reused while confidence is recomputed against the current request's market price. Raw and graded searches cannot collide merely because their combined keywords match. Private statistical samples are omitted from API responses.
- Scalar query validation, length bounds and a 1–50 result bound prevent malformed or unbounded inputs. Exact-grade filtering distinguishes PSA 9 from PSA 9.5, accepts multiple spaces/hyphens, and excludes hyphenated slabs from raw results.
- Async grading failure reasons retain their identity in provider observations; the usage report counts failure categories. Invoice units/costs remain unknown when not reported.
- Live Stripe Business description was corrected from 1,000 to the implemented 750 monthly ID credits, retaining 100 Grade credits and 25% pack discount; draft capacities are explicit. Readback confirmed. No price, allowance, subscription or financial ledger was changed.
- A billing regression fixture used October 7 as a future fence after that date had passed. It now uses a future boundary relative to isolated Redis time, preserving the intended test.

## Verification

Fresh focused suites passed: provider timers/usage 27; provider deadline failures 9; eBay resilience 15; async grading 32; model selection 23; membership ledger 281; consumption 141; lifecycle 187; fulfillment 12; payment grants 625; checkout 323; scan intent 70; pricing-provider allowance 101; catalog search 24; printing evidence 23; catalog outage 21; copy truth 224; draft capacity 69; saved reports 21; scan recovery 1; launch regressions 440; asset fingerprints 109; auth integrity 96; fee arithmetic 122; fee-page parity 41; acquisition tracking 23; grading proceeds 103; quick pricing 219. Browser flows: Rapid Scan 88, binder 46, collection-to-drafts 44, batch Grade 24. Checks differ in scope and are not a recognition-accuracy score.

All provider and billing regression requests were synthetic. Redis was isolated. Browser environment failures were corrected by selecting the available Chromium and isolated Redis runtime; these were not application defects. Syntax and diff checks passed. A limited current-tracked-file secret-pattern scan found no matching live private keys/tokens; Git history and full penetration testing were not covered.

## Remaining limits

- Provider invoice reconciliation and outstanding credit obligations are not established by attempt logs. The TCGPriceLookup allowance is not a company-wide dollar cap. Ximilar/OpenAI need verified account-level limits and failed/refunded attempt costs before paid acquisition scales.
- Source catalog recount: Pokémon 20,699 image records/173 represented sets; Magic 18,618/121; 49 separate Pokémon metadata-only records. These are not completeness or accuracy percentages.
- Scrydex pilot remains disconnected/default-off; activation requires its documented provider/account/schema/budget acceptance. The legacy Pokémon API announces March 1, 2027 retirement for existing keys.
- Published fee evidence dates remain September 1, 2026. Arithmetic/copy tests do not reverify marketplace fee schedules. Recheck those source schedules before their 45-day freshness gate expires.
- Physical-phone camera acceptance, naturally occurring live Deep-to-Quick fallback acceptance, fresh-user admission/email/welcome/checkout acceptance, and backup/restore evidence remain open.
- Automatic marketplace publishing, continuous stack-video recognition, complete language/printing coverage and a native batch Grade camera loop are not shipped. Existing batch grading supports ordered uploaded photo sets.
- Current source default grade model still depends on the previously reviewed production override; revalidate the default/fallback model availability before provider retirement dates.

Keep existing public-admission controls. No new paid service, ad purchase, outreach, account migration or historical credit repair was performed. Public repository notes intentionally exclude private revenue/account totals; the owner-facing audit contains the financial reconciliation scope.
