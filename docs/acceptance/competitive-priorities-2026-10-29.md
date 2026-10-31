# CardResell competitive work plan — 29 October 2026

## Position and evidence boundary

**October 31 update:** [Owner phone recordings and follow-up fixes](owner-video-review-2026-10-31.md) establish one accepted editable Seller Hub draft with its seller photo, title, price and quantity. Other item specifics, direct publishing, the full physical-camera checklist and second-device journey remain open. The observed binder result was seven automatic identities plus two manual recoveries. Historical “actual Seller Hub import remains open” statements below describe the October 29 baseline; the one-sample gate now has evidence.

Build the seller workflow in order: identify the exact printing → understand the price → compare proceeds → prepare the listing → track the physical copy and actual profit. A longer feature menu is not proof of a better seller workflow.

This review combines current repository acceptance records and first-party competitor documentation. Competitor feature descriptions are their claims, not independent accuracy tests. Earlier CardResell tests remain evidence for their tested releases only. Do not convert a 14-card convenience sample into a public accuracy percentage.

## Current competitive baseline

| Capability | Evidence and gap | Required outcome |
|---|---|---|
| Fast identification | Major-game original/degraded sample passes recorded; Luffy original, sports disambiguation and Union Arena remain limited | Prioritize Pokémon, Magic and Yu-Gi-Oh!; exact set/number/edition, easy correction, recoverable failures |
| Variant selection | Collectr describes scan → variant/quantity/condition → portfolio | Preserve fast bulk flow; default from evidence and keep finish editable without compulsory questionnaires |
| Price evidence | Ludex describes condition/parallel-filtered recent sales and historical reports; CardResell has source-labelled references/asking evidence and some aggregates | Show what each figure measures, its source/date/condition, and honest missing data; never fabricate a low/high interval |
| Selling decision | CardResell's comparison and singles/lot economics are the main differentiated workflow | Immediate net comparison, shared shipping assumptions, negative proceeds visible, clear cost/profit distinction |
| Complete a listing | Ludex documents reviewed in-app eBay publishing; CardResell currently prepares drafts/CSV | Prove actual Seller Hub acceptance first; separately complete seller-account setup and validated publishing before claiming parity |
| Inventory | CardResell already has per-copy location, cost, imports, protected sync and sale reconciliation code | Test the normal path with few steps; preserve unknown cost, quantities and identity across import → draft → sale |
| Trust and mobile reliability | Desktop/browser fixtures are extensive; physical-camera acceptance is separate | Publish measured evidence; test actual Safari camera/zoom/permissions/rotation and recovery |
| Commercial readiness | Earlier owner payment evidence exists; latest checkout and actual provider economics need reconciliation | One consistent public purchase story; accurate fulfillment, entitlements and measured gross margin |

## Work from the beginning

### 1. Find the correct card — software updated; broader acceptance open

- Fix reproduced search ordering: card-name identity must outrank set similarity. An unrelated Squirtle from Base Set must not precede the requested Charizard from Base Set. Exact bare names must precede related names. Preserve all candidates and stable ties.
- Implemented in the follow-up upgrade: matching query name/set/number results precede labelled broader suggestions in both grid and list views, including fallback catalogues. All candidates remain selectable; explicit price sorting is preserved. The 70-check search workflow covers mobile/desktop, punctuation, collector-only input, misspellings and outage recovery.
- Recheck name, name+set, collector number, punctuation, spelling errors, no result and provider outage for the three main games.
- Maintain a balanced benchmark: common/rare, old/new, promo, foil/reverse, similar art, glare, blur, tilted, cropped and slab cases. Separate automatic correct identity, review, wrong identity, unsupported and unavailable price.
- Provider usage reporting now includes OCR and slab operations previously omitted by the report, with observed median/p95 duration, image counts and missing-usage counts. These are provider-attempt timings, not end-to-end scan latency or billed costs. Do not silently resubmit billable scans. A wider benchmark still needs independently labelled photos and end-to-end timings.

Exit evidence: exact name/set/number preserved through selection and downstream pricing; zero wrong-card automatic selections in the agreed benchmark. Review outcomes remain visible, not relabelled as successes.

### 2. Give a useful and defensible price

- Trace each paid database's supported games and fields through the response to the UI. Having a database subscription does not guarantee a quote for every printing.
- Check condition/finish/edition and raw versus graded isolation. Expose missing exact-grade prices rather than substituting raw values.
- Reconcile competing on-screen source messages: the live Greninja view showed “eBay sold prices unavailable” alongside a separately labelled TPL eBay 7-day aggregate. The sources differ, but the first label is too broad for that combination; scope it to individual sold comparisons.
- Keep market references, listed asks and sold aggregates distinct. Show usable low or high independently; never reintroduce ±15% placeholders.
- Determine actual TPL history entitlement before enabling history calls or estimating their cost.

Exit evidence: source/date and price meaning survive selection → comparison → newly created draft; stale/missing/zero endpoints do not become invented market ranges.

### 3. Make the selling comparison the obvious next step

- Verify free and paid venue visibility against actual entitlement, including cancelled/legacy memberships. The Business badge/free-result mismatch was reproduced and fixed in bc3babb; current-account membership refresh now rerenders comparisons, including downgrades.
- Test a $1 card, $10 card, expensive slab, 100 low-value cards, unknown acquisition cost, free shipping and buyer-paid shipping.
- Keep purchase cost separate from selling payout; show actual profit only when costs are known. Compare lots and singles without extra mandatory questions.

Exit evidence: comparison and saved draft use the same recorded assumptions; wrong game, stale selection and late responses cannot contaminate the next card.

### 4. Finish the sale preparation

- Draft rows/counts, explicit Create label, shipping estimate, new-draft provenance and stale image fixes were deployed and verified; see workflow-fixes-2026-10-29.md.
- Validate single/bulk CSV against the actual Seller Hub importer, including photos, condition, item specifics, quantity and rejected-row feedback. A generated CSV passing tests is not proof eBay accepted it.
- Existing connection has unresolved seller policy/location readiness. Resolve that independently of CSV; do not require connection for export.
- Future direct publishing needs a reviewed listing, explicit action, idempotency, uncertain-response reconciliation, inventory reservation and a saved marketplace listing ID. Do not enable publishing merely because OAuth succeeds.

Exit evidence: accepted draft import and editable eBay draft, with no unintended live listing. Direct publishing remains a separate gated release.

### 5. Make collection management worth switching for

- Walk import → location/cost edit → select copies → draft/export → record sale → actual profit/report.
- Test duplicates as distinct physical copies; retain acquisition cost and condition. Verify reload, another device and interrupted sync without overwriting newer edits.
- Provide an understandable export/backup path. Refine normal navigation before adding more recovery controls to the primary screen.

Exit evidence: the same physical copy and costs persist across the workflow; sold copies cannot be accidentally restocked or listed twice.

### 6. Prove the purchase and mobile experience

- Check public free limits, plan descriptions, upgrade, return from checkout, credit grants, refund recovery and cancelled-plan entitlements as one story.
- Carry forward previous valid owner payment evidence; repeat only the changed boundaries. Do not claim a fresh payment test without a transaction.
- Physical iPhone Safari: camera permission denial/retry, zoom, front/back upload, binder-grid drag, background/foreground, rotation and poor network. Browser viewport emulation is not device acceptance.

Exit evidence: no paid-success/zero-credit mismatch, no duplicate charges/grants, understandable failure recovery, and completed device checklist.

### 7. Establish proof and economics before broad advertising

- Reconcile invoices/usage with actual scan/grade paths, retries, refunded misses, allowances and discounts. The older unit-economics planning model is not a current profit statement.
- Published the dated 16-attempt / eight-card major-game identity check, transformation recipe, hashes, tested build and explicit exclusions on accuracy.html and in benchmarks/major-games-identification-20261029.json. This makes existing acceptance evidence inspectable; it is not an independent balanced benchmark or universal accuracy score. Keep grading estimates distinct from professional grades/authentication.
- Pilot with 5–10 independent sellers. Record task completion, time to comparison/draft, corrections, repeat usage and reasons to pay. The task script, held-out photo composition and proposed acceptance thresholds are prepared in seller-pilot-protocol-2026-10-29.md. No participants have been recruited and no pilot results are claimed.
- Describe shipped capabilities accurately. Do not advertise automatic market-wide sold comps, direct publishing, automatic sales sync or universal game coverage while those remain unavailable.

Exit evidence: independently completed seller journeys and measured contribution margin. This is the gate for expanding advertising, not another feature-count milestone.

## First change and verification

Search ordering was reproduced against shipped core.39b02d90.js: two new behavior assertions failed (428 passed / 2 failed). The correction in core.7472ba7d.js passes all 430 launch-audit regression checks and 285 asset-fingerprint checks. It changes ordering only, preserves every returned row, and does not add paid provider requests. The full 176-entry release runner completed with ALL CHECKS PASSED, exit 0, in 636.6 seconds; conditional/live checks retained their normal skips. The tested index/core SHA-256 values match the release files. Application commit: c98cbc5d147e94b4c7a44c42905467473787724f. Production deployment dpl_5UCpamJhhdQrtfmUCYkaX7W7C1v8 reached READY on both production domains. The live browser loaded core.7472ba7d.js, and searching Charizard Base Set displayed Charizard Base Set #004/102 first, followed by Base Set 2 and other printings. The test made no inventory, draft or marketplace listing writes. Screenshot: screenshots/search-ranking-2026-10-29.jpg. This proves the sampled order, not the accuracy of every displayed provider price.

## Sources checked

- Collectr scan workflow: https://www.getcollectr.com/scan
- Ludex valuation and recent-sales features: https://ludex.featurebase.app/help/articles/3061259-understanding-your-ludex-collection-value
- Ludex reviewed eBay listing workflow: https://ludex.featurebase.app/help/articles/9002034-how-to-list-a-card-on-ebay-from-the-ludex
- CollX identification/manual recovery, pricing and marketplace: https://collx.app/faq
- CardResell evidence: launch-checklist-2026-10-29.md, major-games-release.md, workflow-fixes-2026-10-29.md; ../launch-readiness-20261027.md; ../inventory-details-20261016.md.

Status: implementation and acceptance are tracked separately. Search ordering, match-versus-suggestion UI, scoped sold-data wording, membership comparison refresh, complete provider-operation reporting and publication of the dated identity sample are implemented. The full release and live deployment evidence are recorded in competitive-upgrades-2026-10-29.md. Independent sample/pilot, physical-device acceptance, actual Seller Hub import, history entitlement and invoice reconciliation remain open; no overall readiness percentage or all-seven-phases completion is claimed.


## Follow-up release

The ambiguous individual-sold warning and stale membership comparison have been corrected in application commit `bc3babb4079bf6fd94873cf4ca930aa47ccae613`. The membership issue was reproduced in mobile/desktop regression tests and independently confirmed on the prior live build. The complete release runner passed. See [readiness-followup-2026-10-29.md](readiness-followup-2026-10-29.md) for exact evidence, limitations and the inputs still needed; this does not close all seven phases.
