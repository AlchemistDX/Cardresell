# Subscription claims and advertising audit — October 9, 2026

## Verified offer

The live public membership catalogue matched the release source for prices, credit allowances, venue counts and batch capability. Signed-out purchaseEnabled=false is expected and does not establish whether an authenticated pilot can purchase. Existing billing and purchase history were not changed or charged by this audit.

| Plan | USD/month | ID/month | Grade/month | Pack discount | Venue comparisons | Batch photo grading |
|---|---:|---:|---:|---:|---:|---|
| Free | 0 | 5 | 1 | None | 2 | No |
| Starter | 4.99 | 25 | 5 | None | 2 | No |
| Casual | 9.99 | 50 | 15 | 10% | Up to 9 | No |
| Pro | 19.99 | 250 | 40 | 15% | Up to 15 | Up to 10 cards |
| Business | 49.99 | 750 | 100 | 25% | Up to 15 | Up to 25 cards |

- Every plan: individual identification and Quick/Deep AI estimates using credits; explicit private saved reports (500/account, no photos); listing drafts under the existing shared 500-draft limit, including selected bulk-scan draft creation. Marketplace publishing is manual. No extra scan debit for preparing a draft.
- Every paid plan: flip tracking beyond the Free ten-record limit and manual Grading Log export. This does not remove cloud/device technical limits or imply unlimited storage. Saved AI report download is separate from the paid manual Grading Log export.
- Batch grading is uploaded, ordered photo sets; it is not a completed native multi-card camera loop. Quick costs one Grade credit/card; Deep two subject to the existing explicit fallback/refund policy.
- Welcome credits remain 10 ID + 1 Grade once for verified eligible Free accounts, separate from recurring Free allowances. Issued credits roll over and do not expire. No tier has a higher grading-accuracy promise.
- Self-service plan switching, automatic marketplace publishing, cloud-photo allowances, proposed tier listing quotas and guaranteed priority support are not advertised as working benefits. Buylist/consignment calculations are estimates; availability depends on game, venue and seller eligibility.

## Corrected in this follow-up

1. Batch photo grading is now a direct column in the public comparison table and appears in Pro/Business descriptions.
2. Every subscription card discloses the 500-report and 500-draft limits. Saving is explicit; grade photos are not saved; listing publication is manual.
3. Replaced active legacy "unlimited tracking" messages. The Mark Sold warning now appears at nine records, consistent with ten Free slots, rather than incorrectly announcing one slot left at four.
4. Retired pricing/shop overlays are inert, hidden and forced off by the active stylesheet, so a stale caller cannot show old annual or Pro Max purchase offers. Existing compatibility IDs remain to avoid breaking legacy close/focus handlers; normal entry goes to the current five-plan storefront.
5. A legacy ?pro=1 return no longer grants client-side paid status, fabricates credits or announces an upgrade. It requests server confirmation and preserves other URL parameters. Stripe/ledger authority is unchanged.

## Catalogue and API

Local reference indexes: 20,699 Pokémon records across 173 represented sets; 18,618 Magic records across 121 sets; 49 separate Pokémon text-only records. IDs are unique. These counts describe image references, not total external search coverage or recognition accuracy.

The fresh historical Pokémon repository set-count comparison still finds 49 missing images in five sets; all 49 identities have text-only local fallback. Equal set counts do not prove all finishes/IDs/languages are covered. The historical repository is not a current full-universe catalogue. A fresh Scryfall set-list probe returned HTTP 400 here; a new total coverage percentage is not claimed. See data/catalog-coverage-20261009.json.

The retiring Pokémon API is still integrated; Scrydex is not activated. Official retirement remains March 1, 2027. Scrydex integration requires a confirmed account/plan and server-side credentials, schema/variant mapping, 100-card pagination, usage limits and actual provider acceptance. Browser outage timeouts and identity-only fallback are working; they do not replace live pricing. The prior Cloudflare-blocked health probe does not prove an outage for all users. See pokemon-api-and-advertising-20261009.md for official sources and migration costs.

## Launch status

Current audited subscription claims align with implemented access; that is not a blanket claim that every product roadmap feature or every external provider is complete. Physical iPhone camera acceptance, naturally observed live Deep-to-Quick fallback acceptance and subsequent newly eligible account onboarding/checkout remain the existing public-admission gates. No public-admission change, new subscription, ad spending or outreach occurred.

## Validation

- Live public membership catalogue matched all five configured plan prices, ID/Grade amounts, venue counts and batch flags.
- 614 browser checks across four viewport sizes and light/dark themes, now requiring all five subscription cards to render, the two correct batch plans, disclosed limits and retired-overlay blocking. Mobile subscription screenshot reviewed. Authentication/provider replies were synthetic; no checkout submitted.
- 84 entitlement checks, including a new executed legacy-return regression proving the URL alone grants no paid status/credits and preserves campaign parameters.
- Storefront identity/checkout behavior 201; venue access 41; purchase routes 52; launch regressions 440; copy truth 224; asset fingerprints 107; inline syntax ten blocks with zero errors. Release inspector and diff checks passed.
- This is scoped source/browser/handler verification, not a claim of a new authenticated production purchase or physical grading accuracy benchmark.
