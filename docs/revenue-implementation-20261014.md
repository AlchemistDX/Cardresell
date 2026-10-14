# Revenue implementation priorities

Owner approved continuing with the useful Gemini, Claude and Grok ideas on October 14, 2026. Build on the existing seller workflow and keep payout rankings independent of commercial relationships.

## First release: recommendations that deliver the requested feature

The shop previously recommended Starter to a Free user following the more-venues prompt, although both plans have the same venue access. Match venue requests to the lowest-priced higher plan with additional catalogue venue coverage. Batch-grading requests require actual batch support; draft-capacity requests require more saved drafts; paid flip tracking must not produce an unrelated upsell for an already-paid user. If no higher plan supplies the requested benefit, omit the recommendation. Keep explicit plan selection and general plan browsing behavior.

The catalogue continues to supply prices, allowances and capabilities. No prices, entitlements, credit debits, renewal timing or payment contracts change. Existing checkout and shop events retain the originating prompt. Checkout retries retain their original operation and campaign rather than creating a second purchase.

Validation: the actual storefront executed against synthetic account/catalogue responses passes 272 checks, including feature selection, reordered catalogue, unavailable benefits, already-included features, explicit targets, account switching and checkout recovery. Required full regression and production verification are recorded with the release. Synthetic checkout is not an actual payment test.

## Ordered follow-up work

| Work | Existing foundation | Completion evidence |
| --- | --- | --- |
| Conversion and cost measurement | Campaign counters; checkout metadata; payment/fulfillment ledger; provider-attempt logs and report script | Reconcile a defined period of authoritative payments, refunds and fulfillment with provider invoices and observed attempts. Keep unknown costs and incomplete log coverage visible. Browser events are observations, not customer conversion rates or revenue. |
| Bulk inventory productivity | Bulk scanning; finish inference and optional corrections; lot-versus-singles and shipment-quote comparisons; tiered draft capacity | Extend import and editing only where a gap exists. Preserve identity, quantity, condition, finish and cost; preview ambiguous rows; retries must not duplicate inventory. Evaluate whole-shipment economics with explicit assumptions. |
| Profit and expense export | Flip tracking, purchase-cost math and Grading Log export | Separate estimates from realized sales; include expenses and refunds; reconcile totals and prevent double-counted costs. Start with accounting exports; do not advertise automated tax reconciliation before implementing it. |
| Partner monetization | Outbound venue links and prior owner-reported outreach | Record actual replies, approved programs, qualifying action, attribution and earned commission. A listing draft or outbound click is not a qualifying affiliate purchase. Keep partner offers separate from payout rankings. |
| Annual plans | Monthly paid-period issuance, rollover and subscription lifecycle | Reconciled full-use/retry costs; explicit annual billing versus monthly credit grants; tested renewals, retries, cancellation, refunds and plan changes; consistent terms and catalogue. Do not activate a new billing product from a scenario model alone. |
| Shop tools and fee API | Shared fee engine and seller workflows | Validate demand with shop users, define support and versioning, demonstrate stable fee coverage and permitted data use before selling access. |

## Decisions retained

Measurement spot-check on October 14: the most recent 100 `PROVIDER_USAGE` production records returned within a 24-hour query contained 97 successful TCG identification attempts, two failed TCG attempts and one failed sports attempt. All 100 had unknown billed cost. This capped sample does not represent the full day, unique cards/customers, customer credit debits or independently measured identification accuracy. It confirms logging is available; current invoices and complete period reconciliation remain necessary before pricing decisions.

- Keep Starter: it has concrete credit, draft and tracking benefits. Measure demand before removing a plan.
- Existing credit packs remain the immediate option for occasional scanning. A day pass needs a distinct feature-access use case and measured costs.
- Preserve immediate bulk pricing and the compact, automatically defaulted Finish / printing control. Corrections must not require another paid scan.
- Preserve equal scanner/grader quality across plans. Measure accuracy before changing model routing; do not cache a physical card's condition solely by catalogue identity.
- Grading economics show outcomes across possible grades with disclosed assumptions. Centering alone is not a grade or a profit guarantee.
- No paid ranking position, paid accuracy badge, forced onboarding or unsupported savings claims.
- Real eBay Seller Hub import acceptance, an independent ID/grade accuracy study, current fee confirmations and provider cost reconciliation remain evidence tasks. A passing local test is not completion of those external checks.

This document is an implementation order, not a revenue forecast or a claim that later features are live.
