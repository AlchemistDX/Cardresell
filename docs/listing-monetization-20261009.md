# Listing value and revenue proposal — October 9, 2026

Status: the draft-capacity and bulk-preparation ladder below is implemented for launch memberships in the follow-up release. See draft-tier-rollout-20261009.md for enforcement, compatibility exceptions and verification. Revenue-service ideas remain proposals; no new revenue service is claimed as active.

## Recommended upgrade ladder

| Plan | Active saved drafts | Proposed bulk draft preparation |
|---|---:|---|
| Free | 5 | Individual drafts |
| Starter | 25 | Up to 10 selected cards per action |
| Casual | 100 | Up to 25 selected cards per action |
| Pro | 500 | Up to 100 selected cards per action |
| Business | 2,000 | Up to 500 selected cards per action |

Active capacity is simultaneous saved work, not a monthly creation allowance. Deleting a draft frees a slot. Recommend no extra monthly creation meter at first: ID and Grade usage is already metered, and draft preparation should remain free of additional scan charges. Bulk-draft selection is distinct from the Pro/Business ten-card batch-grading upload feature. Never label the two as interchangeable.

Preserve existing records on introduction and downgrade. Above-cap accounts must still be able to read, edit, copy, export and delete existing drafts; block only additional creation until capacity is available or the account upgrades. Replays of successful creates must not consume additional capacity. Server-resolved membership must determine limits for every create path, with concurrency-safe enforcement, reliable failure recovery, bulk preflight/partial-result messaging and an accurate usage display. Existing quota code deliberately fails open during storage failures and has reconciliation paths: it requires review before using it as a paid entitlement boundary. Test Business pagination and storage at 2,000 before advertising that capacity. Self-service plan switching must be implemented before relying on repeated upgrade prompts.

## Customer wording

Current copy: “Keep up to 500 saved listing drafts with prefilled card details, ready to review, copy or export.”

Once tier limits are actually enforced, replace the capacity from a shared server catalogue. Lead with prefilled listing drafts and bulk preparation. Do not advertise automatic publishing or crossposting. There is no need to put a repeated manual-publishing disclaimer inside each subscription benefit.

## Competitor evidence

Reviewed official pages on October 9, 2026; advertised capabilities were researched, not personally acceptance-tested.

- LUDEX lists Free at five eBay publications/month, Lite $4.99 and Standard $9.99 at 50, and Pro $24.99 at 250. Publishing is US-only. https://www.ludex.com/membership/
- Card Dealer Pro advertises Prospect $9/month with 500 AI credits and CollX plus one marketplace; Majors $19/month with 1,100 AI credits, two additional marketplaces, custom title/description templates and inventory tools. Its AI-credit unit is not equivalent to CardResell's ID or Grade credits. https://www.carddealerpro.com/
- CollX Pro advertises bulk market pricing, collection CSV export, listing photos and inventory locations. https://www.collx.app/collx-pro

Prefilled drafts are useful but not unique. CardResell should compete on the combined seller decision workflow: estimated proceeds after fees, grading estimates and economics, then draft preparation. Validate accuracy and time saved; do not claim market superiority from a feature list.

## Revenue order

1. Membership retention and upgrades: tiered active capacity and bulk convenience, then reusable templates and saved seller defaults. Templates are a proposed addition, not a live promise. Measure first useful draft, repeated use, cap encounters, upgrade conversion and retention. Do not reward paywall encounters alone.
2. Existing ID/Grade packs: contextual replenishment when credits run low, with clear balance and included plan discounts. Measure net receipts against actual inference/provider costs, refunds and support. No automatic top-ups without opt-in.
3. Affiliate purchases and seller supplies: audit existing eBay/TCGplayer attribution before adding placements. Code already contains affiliate-related routing; that is not evidence of approved accounts or collected commissions. eBay and TCGplayer operate purchase-referral programs. A seller creating a draft or visiting a selling page is not itself a commission event. Keep estimated-payout rankings independent of affiliate payments and disclose affiliate links.
   - https://partnernetwork.ebay.com/page/trading-cards
   - https://docs.tcgplayer.com/docs/tcgplayer-affiliate-program
4. Paid inventory onboarding: test a fixed-scope CSV cleanup/import service for stores once preservation and import checks are dependable. Price only after measuring labor. This requires an operational service, not just a checkout button.
5. Dealer upgrades: reusable templates, inventory-location labels, bulk editing and profit reports before a new expensive dealer plan. These are candidates pending implementation/validation, not currently included benefits.
6. Later partnerships: grading/consignment referrals under real partner agreements, with payment terms and service responsibilities established first. Clearly labeled sponsorships become useful after there is measurable traffic. Do not sell ranking position in the payout comparison.

Avoid near-term commitments to resale of provider data, a paid public API, guaranteed grading outcomes or marketplace transaction fees. Rights, provider cost, reliability and a real transaction role have not been established. No new affiliate enrollment, outreach, ad spend, provider subscription or billing product is created by this proposal.

## Validation of this copy release

Membership asset regenerated with a content hash. Existing copy, asset and storefront checks used; release inspector run. No entitlement change or customer billing action.
