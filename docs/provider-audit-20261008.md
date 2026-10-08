# CardResell provider audit — October 8, 2026

## Decision

The existing stack is a workable baseline, not a verified best-in-market stack.
No provider change is justified by marketing claims alone. This audit inspected
the application integration, official provider documentation, existing evaluation
records and the production log sample collected this session. It did not run a
paid head-to-head recognition or grading benchmark. No new subscriptions, account
changes, listing publication or customer-credit charges occurred.

## Findings and decisions

| Capability | Evidence | Decision |
|---|---|---|
| Single-card recognition | `api/_ximilar.js` calls Ximilar tcg_id/sport_id, requests one image, parses only `_objects[0]`. Confidence thresholds are application settings, not independently calibrated accuracy probabilities. | Retain as baseline; compare exact-printing results on identical phone photos before replacement. |
| Binder pages | Ximilar documents `analyze_all:true`, one image per request, charged per detected card. Default is largest-card identification. Our wrapper does not enable or parse the multi-card route. | First binder candidate is the provider we already use. Add a separate bounded workflow; do not switch this option on inside single-credit billing. |
| Recognition challenger | CardSight AI's official Node SDK documents multi-card recognition and identifiable-set checks. Its catalog totals are vendor claims with different counting units. | Candidate for a shadow evaluation, not an approved replacement. Measure actual supported printings, not headline catalog size. |
| Secondary challenger | TCGGraph documents printing-level recognition, but says multiple-card localization is not shipped. | Possible single-card/cropped-pocket challenger; not a whole-page replacement today. |
| Catalog | Live local indexes contain 20,699 Pokemon and 15,229 Magic reference records. External APIs add searchable coverage. Known local gaps remain. | Keep canonical per-game sources and add periodic coverage audits; distinguish physical printing, finish, language and reference-image availability. |
| Pokemon language expansion | TCGdex documents multilingual records, but its FAQ acknowledges incorrect external pricing mappings and missing images. | Evaluate as a supplementary identity source. Never trust a matching price alone as printing identity. |
| Prices | Application uses TCG Price Lookup, game-specific APIs, PriceCharting and eBay sold-page retrieval. Recent production logs include eBay 403 failures. | Sold-comp reliability is a priority gap. Compare providers using dated, traceable sales matched to exact printing/condition. Do not substitute asking prices and call them sold comps. |
| eBay sold-data access | Official eBay documentation says Marketplace Insights is restricted and not open to new users. | A normal developer key does not establish access. Assess a documented data-provider route; do not promise a simple API swap. |
| Grading | Repository release notes record gpt-6.1-sol production selection and gpt-4o fallback; Deep uses Ximilar CV. Existing slab tests are policy constrained, not proof of raw-card accuracy. | Retain pending a raw-photo evaluation. Score visible defects, repeatability, confidence and condition ordering now; later reconcile certified returns. |
| December retirement | `_gradeModel.js` still defaults to gpt-5 when the production setting is absent/invalid. The recorded production override avoids this model. | Deployment guard/default migration remains a follow-up risk. Do not revert by merely removing the override after retirement. |
| Auto listing | Current application supports drafts/handoff. `api/_ebayAuth.js` uses an application token; it does not establish seller authorization for publishing. | Implement seller OAuth, policies, inventory/offer creation, image handling, reviewed publishing and reconciliation before claiming auto listing. |
| Provider accounting | Usage summarizer accepted only gpt-5/gpt-4o although telemetry records newer candidates. | Fixed the local reporting tool to use the grading candidate list; 27 timer/usage checks passed. Counts remain observations, not invoices. |

## Binder acceptance specification

Start with 3x3 pages; include empty pockets, repeated copies, mixed orientation,
glare, sleeves and incomplete crops. Preserve source page and bounding box per
card. Show every detected pocket in a review grid with unresolved status and
editable exact printing/quantity. Repeated artwork is not automatically a duplicate
physical copy. Require review before creating inventory or drafts. A page image is
identification evidence, not sufficient grading or listing-condition photography.

Provider charges are per detected card. Establish a bounded detection/review step
and visible user cost before identification. Do not assume capping the returned
array limits upstream billing. Retried page submissions must not charge twice.

## Benchmark and selection gates

Use at least 200 independently labeled physical cards as an initial development
comparison, stratified by supported game, era, language, foil/parallel and capture
quality, plus at least 20 binder pages. These sample sizes are an initial proposal,
not a statistical guarantee. Keep a separate untouched holdout; multiple photos
of one physical card must remain in the same split. Do not tune on the holdout.

Report exact set/number/language/finish accuracy, coverage, wrong confident matches,
abstentions, manual-correction burden, median/p95 latency, retry rate and cost per
correct identification. Count every attempt, including failures. Compare identical
inputs and record provider/model versions, dates and response provenance. Report
finish as unresolved when the photograph does not establish it.

For grading, keep certified slab-label reading separate from predicting a raw
card's condition. Grade numbers alone cannot validate unseen defects. Blind shop
assessments and repeat raw captures can test useful behavior before PSA returns.

Implementation order: fix measurement, verify pricing-source reliability, prepare
the shared photo benchmark, implement binder pilot, then connected eBay listing.
Provider accounts/keys for challengers and seller authorization remain necessary
for live acceptance. None is proven available merely because deployment access
exists. No whole-app or competitive accuracy percentage is established.

## Primary references checked

- https://docs.ximilar.com/collectibles/recognition — analyze_all, rotation, language, per-card billing.
- https://github.com/CardSightAI/cardsightai-sdk-node — multi-card recognition and set checks.
- https://tcggraph.com/docs/recognition — printing-level recognition; one card per frame.
- https://tcgdex.dev/faq — languages, missing images, known external price mapping issues.
- https://tcgpricelookup.com/docs/api-reference — existing provider API.
- https://www.developer.ebay.com/api-docs/buy/static/ref-marketplace-supported.html — restricted Marketplace Insights access.
- https://developer.ebay.com/api-docs/sell/static/inventory/publishing-offers.html — listing publication requirements.
- https://developers.openai.com/api/docs/deprecations — older GPT-5 December 11 retirement.

Repository evidence: `docs/unit-economics-20261005.md`,
`docs/psa-reference-pilot-20261008.md`, `docs/catalog-expansion-20261008.md`,
`api/_ximilar.js`, `api/_gradeModel.js`, `api/ebay-sold.js`,
`api/_ebayAuth.js`, `tools/provider-usage-report.mjs`.
