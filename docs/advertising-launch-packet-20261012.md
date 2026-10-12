# CardResell advertising launch packet

Prepared October 12, 2026, America/New_York. Status: materials ready for review;
public promotion and paid spend remain gated. No ads, outreach, purchases or
new provider commitments have been made. This is an operating proposal, not a
forecast of sales or a claim that commercial permissions have been granted.

## What we are selling

CardResell helps trading-card sellers identify supported cards, compare
estimated selling proceeds and prepare listing drafts. Lead with the selling
decision. Grading comparisons and collection organization support that decision.

First audience hypothesis: US adults who already sell trading cards and want
to reduce the work between identifying a card and preparing a listing. Start
with the supported Pokémon workflow demonstrated on the owner's phone; do not
present this as measured demand or advertise equally strong coverage for every
game. Use broad seller language and actual app demonstrations.

Primary promise: **See what you could keep after fees.**

Primary action: **Compare a card.** Secondary action after results: create a
listing draft. Free compares eBay and TCGplayer; venue eligibility depends on
the card. Paid plans add features and credits. Link to current pricing rather
than putting subscription amounts into long-lived artwork.

Say “estimated,” “supported cards,” “listing drafts,” and “review before use.”
Do not promise guaranteed profit, guaranteed grades, appraisal/authentication,
unlimited free scans, automatic marketplace posting or complete sold-listing
coverage. Avoid showing provider logos as endorsements. Use approved brand
assets and owned footage; crop out account names, balances and customer data.

## Release and launch gate

Production: PR #44, commit f392f9bf2d3e294720fc09b98e3db68470db3d73.
The grading fee input is replaced with automatic published-fee estimates;
Create Listing Drafts is a primary bulk action and Compare selling is under
More actions. Fees vary with eligibility, value and submission details.

| Area | Evidence | Remaining requirement |
| --- | --- | --- |
| Core flow | Owner phone acceptance; PR #44 deployed; 186 selling-plan and 88 grading checks previously passed | Fix any new regression discovered by actual use |
| Public destinations | Homepage with shop/meta tags, pricing, contact, privacy, terms, robots, sitemap and social image return HTTP 200 | Recheck before publishing a campaign |
| Tracking | 23 acquisition checks pass; prior QA checkout metadata verified | Reconcile first genuine tagged purchase to fulfillment |
| Payments | Four current-system owner/testing purchases reconciled in earlier evidence | These are not acquired-customer or profitability evidence |
| Recovery | Earlier isolated snapshot/restore passed scoped checks | Correct production account, recurring retention and cost approval; first scheduled backup verified |
| Data permissions | TCG Price Lookup paid account previously confirmed; public terms need clarification; PriceCharting commercial agreement unverified | Written permission for actual display, caching and draft/export use |
| Economics | Provider usage tooling exists; actual dollar coverage incomplete | Reconcile invoices, failed attempts, free usage and overages |
| Ad spend | Nothing purchased | Owner approves channel, total cap and maximum provider exposure |

The detailed evidence and its limits are in advertising-gates-20261012.md.
Prepare private demos now; release public materials only after permissions and
operating gates are cleared. Do not treat “organic” as an exemption from data
permissions or service readiness.

## Campaign links

Use the canonical www domain. These channel labels already exist in production.

| Placement | Destination |
| --- | --- |
| Local shop sign or business-card QR | https://www.cardresell.org/?cr_campaign=shop_qr |
| Facebook / Instagram paid test | https://www.cardresell.org/?cr_campaign=meta_ads |
| YouTube demo | https://www.cardresell.org/?cr_campaign=youtube |
| Discord post, where the community permits promotion | https://www.cardresell.org/?cr_campaign=discord |
| Reddit post, where promotion is permitted | https://www.cardresell.org/?cr_campaign=reddit |
| Internal acceptance only | https://www.cardresell.org/?cr_campaign=qa |

Tracking stores a bounded channel, using the last non-direct channel for up to
30 days. It does not identify unique visitors or persist arbitrary campaign,
shop or creative IDs. Do not claim per-shop or per-ad attribution from these
labels. Keep platform spend/creative reporting separately; use one creative
and one channel first to reduce ambiguity. Existing owner/test activity and
the qa channel are excluded from acquisition results. Never place personal
information or secret identifiers in campaign links.

## Ready-to-use copy — drafts, not posted

### Local shop sign

**Selling trading cards?**

See what you could keep after fees.

Look up supported cards, compare estimated selling payouts and prepare
listing drafts with CardResell.

**Compare a card at cardresell.org**

Free compares eBay and TCGplayer. Estimates vary; review card details and
costs before selling.

Production note: use the shop_qr destination above for any QR. Verify the
actual encoded URL and test a printed proof on iPhone before ordering a batch.
No QR artwork or print order is included in this preparation pass.

### Facebook / Instagram concept A — first test

Headline: **See what you could keep after fees**

Primary text: Selling a card? The price is only part of the decision.
CardResell helps you compare estimated selling payouts and prepare a listing
draft. Start by comparing eBay and TCGplayer for supported cards.

CTA: **Learn more**

Destination: https://www.cardresell.org/?cr_campaign=meta_ads

Small on-screen qualifier: Estimates vary. Review identity, condition and costs.

### Concept B — keep in reserve

Headline: **Turn a card scan into your next listing draft**

Primary text: Identify supported trading cards, review their details and
prepare listing drafts in CardResell. Compare estimated selling proceeds
before deciding where to sell. Scan credits and plan limits apply.

Use the same meta_ads destination if tested later. Run sequentially with
dated notes; channel attribution cannot establish which creative caused a sale.

### Community introduction

I built CardResell to make the steps between identifying a card and preparing
a listing easier. It compares estimated selling payouts and helps create
listing drafts. I'd like feedback from people who regularly sell cards:
does the comparison help you decide what to do next? Identification, condition
and prices still need review. Here's the tool: [insert the matching channel link].

Only post where promotion is welcome. Disclose ownership as above. No invented
testimonials, user counts, income claims or endorsement language.

### 20-second screen-recording script

| Time | Visual | Voice / caption |
| --- | --- | --- |
| 0–3 sec | A card beside the phone; no visible account information | “Selling a card? Check what you could keep.” |
| 3–8 sec | Actual identification result; confirm the correct printing | “Identify your card and review the details.” |
| 8–14 sec | Actual estimated payout comparison, fee details visible | “Compare estimated proceeds after fees and your shipping costs.” |
| 14–18 sec | Create Listing Drafts action and a real draft review | “Then prepare your listing draft.” |
| 18–20 sec | CardResell name and URL | “Compare a card at CardResell.org.” |

Use an authentic result, not a fabricated valuation. Keep “Estimates vary;
review before selling” legible. If speeding up loading, label the demonstration
as edited. Do not imply the draft was published to eBay. Use royalty-free or
owned audio with suitable permissions. The recording itself remains to be made.

## Launch sequence and spending proposal

1. Clear permissions, recurring backup and economics gates below. Refresh
   dated grading fees before their snapshot expires. Confirm the contact page
   reaches a monitored support inbox.
2. Conduct five private owner-led seller demonstrations. Observe whether each
   person can review a card, understand the estimate and create a draft. Record
   completion, confusion and bugs without collecting unnecessary personal data.
3. After gate clearance and each shop's permission, approach up to three local
   shops with the demo and draft sign. Start with a digital proof; do not order
   printed stock until one shop accepts placement. No outreach is sent here.
4. Proposed paid learning test: one Facebook/Instagram campaign, one creative,
   US adult audience, seven days, **$70 total media ceiling**. This is a proposal
   for approval, not an authorized purchase or a profitability-derived budget.
   Confirm billing currency, tax treatment and enforceable total/account cap
   in the actual ad account before activation. Do not rely on a daily budget
   alone as a hard total cap. If total exposure cannot be bounded, do not launch.
5. Review daily. Stop at the approved total or day seven, whichever comes first.
   Do not automatically refill, extend or broaden the campaign.

Use an additional explicit provider-spend ceiling based on verified provider
controls. An application request allowance is not a dollar cap. Until that
exposure is understood, media budget approval alone does not clear launch.

Do not add a new advertising pixel or upload customer lists as routine prep.
The current first-party channel measurement can support this small test;
pixel-based optimization would be a separate privacy/configuration decision.

## What to measure and when to stop

Daily operating sheet: date/time zone, channel, platform spend, landing clicks,
observed page events, checkout attempts, verified initial purchases, durable
fulfillment, refunds/disputes, support issues, provider charges and coverage.
Keep unique customers separate from events and transactions. Dedupe purchases
by the authoritative Stripe session/order binding; never count browser success
events as paid conversions. Renewal revenue is separate until attribution is
explicitly established. Client-reported channels are directional, not proof of
incremental ad impact.

CAC = ad spend / distinct acquired paying customers. With zero customers,
report “no acquired customers” rather than $0 CAC. Report “unknown” if customer
classification or attribution is incomplete.

Pilot cash contribution = attributable collected revenue excluding taxes
minus refunds, payment fees, provider charges, incremental hosting/storage,
paid support and media spend. Separately reserve for unused purchased credits
and included allowances. It is not lifetime profit; do not assume renewals.
Track owner support time even if not paid in cash. Fixed subscriptions remain
visible as operating expenses rather than disappearing from the business model.

Pause immediately for double charges, lost credits, cross-account data,
unbounded provider spend, failed recovery protection or misleading prices.
Pause the ad if the landing page or primary flow breaks. At day seven, do not
scale on clicks or signups alone: require reconciled purchases, reliable
fulfillment and credible positive contribution after outstanding usage costs.
A small sample cannot establish a durable conversion rate.

## Provider-cost reconciliation worksheet

Use the same closed time window for invoices, usage and app activity. Do not
paste keys, customer identifiers or full request bodies into this document.

| Source | Evidence to obtain | Allocation / missing coverage |
| --- | --- | --- |
| OpenAI | Organization/project usage and billed cost export; model breakdown; retries and failures; effective spend controls | Separate grade/deep-grade and non-CardResell activity; include failed/refunded user attempts |
| Ximilar | Plan invoice, purchased/included units, per-operation debits, overage rules and hard limits | Separate single-card, binder and grading use; count detected cards when billed per card |
| TCG Price Lookup | Actual account plan, invoice, quota reset, overage/hard-stop terms and sharing with other apps | Prior observation: Pro $49.99/month, 10,000/day; do not replace with conflicting public plan names |
| Vercel / Upstash | Project/resource usage bill, storage, compute and backup charges | Separate preview/testing and production; earlier $0.21 installation usage estimate was not a final production invoice |
| PriceCharting | Account invoice and written commercial agreement | Keep fixed licensing expense separate from marginal lookups |
| Stripe | Actual balance transaction fees, refunds and disputes for included purchases | Use actual charged fees, not a generic percentage guess |

For each row record period, currency, gross charge, credits/discounts, net billed
amount, production share, evidence location and unresolved difference. Blank
amounts mean unknown, never zero. Provider attempts observed in logs are not
equivalent to invoices; log retention and missing responses can leave gaps.

Fully loaded cost per delivered ID/grade should include the operation's
failed/retried attempts, allocated fixed costs and free-user activity. If
operations cannot be allocated reliably, report a range with the unallocated
pool separately. Do not create a precise CAC target until this is reconciled.

## Provider permission requests — drafts, not sent

### TCG Price Lookup account support

Subject: Confirm CardResell commercial display and caching permissions

Hello,

I operate CardResell.org, a paid and free tool for trading-card sellers. We use
pricing data to show card values, calculate estimated selling proceeds and
help users prepare listing drafts. We are preparing a small advertising launch
and would like written confirmation that our account permits these uses.

Our account was shown as Pro at $49.99/month with a 10,000-request daily
allowance. Please confirm the current entitlement, reset time, overage rules
and whether the allowance is a hard stop. Your FAQ describes commercial resale
apps, while the terms restrict competing services and redistribution without
written authorization. Please confirm how these apply to CardResell.

Please also confirm permitted cache retention, stale-data fallback, derived
fee calculations, inclusion in user listing drafts/exports and attribution.
Our application currently has defaults of six hours fresh and up to 24 hours
stale on one proxy, and 30 minutes on another route; we can align these with
the agreed requirements. We are not offering raw API resale.

Please provide the applicable commercial terms or agreement for this account.

Thank you,
Will — CardResell

### PriceCharting account support

Subject: Commercial permission for CardResell pricing comparisons

Hello,

I operate CardResell.org, a trading-card seller tool with free and paid plans.
We would like to confirm commercial rights before advertising the product.

We use PriceCharting guide values in card results and grading comparisons,
with links back to relevant PriceCharting product pages. The comparisons
subtract estimated selling and grading costs; users may prepare listing drafts.
We label guide values separately from individual sold listings and do not
offer raw API access for resale.

Your API documentation refers to internal use and a commercial agreement for
sharing price data. Please confirm whether our account has an agreement that
covers customer-facing display, derived comparisons, caching and user
drafts/exports. If not, please provide the appropriate license, pricing,
attribution and retention requirements for this use.

Thank you,
Will — CardResell

Send only after the owner approves outreach and the correct account support
recipient/channel is verified. No account secrets are needed in either draft.

## Concrete next decisions

1. Restore access to the production Upstash workspace. Then confirm the exact
   resource, one- or three-day retention availability and added cost. Recommend
   the longest included daily retention; do not silently purchase a plan upgrade.
   The earlier automatic approval rejection requires explicit permission for
   the actual recurring backup setting. Verify its first completed scheduled
   backup after enabling; retain the isolated-restore evidence separately.
2. Approve sending the two permission requests through verified support channels,
   or supply existing written commercial agreements if already held.
3. Supply or securely expose the provider billing/usage exports listed above.
   Reconcile these before requesting ad-budget sign-off.
4. Once gates pass, approve the concrete $70 test and bounded provider exposure,
   or revise the amount. Approval has not been inferred from preparation.

## Sources and validation

Official sources reviewed October 12, 2026:
- https://tcgpricelookup.com/terms
- https://tcgpricelookup.com/faq
- https://www.pricecharting.com/api-documentation (indexed documentation;
  direct refetch returned 403 on this continuation)
- https://upstash.com/docs/redis/features/backup

The TCG FAQ supports some commercial uses but does not resolve the account's
conflicting plan/terms evidence. Backup documentation describes daily retention
choices but does not establish this resource's billing. Account-specific unknowns
remain unknown. This packet is preparation, not a legal interpretation of a license.

Checked locally: acquisition-tracking 23/23. Checked over public HTTPS: both
shop_qr and meta_ads landing URLs preserve their query and return 200; pricing,
contact, privacy, terms, robots, sitemap and PNG preview return 200 with the
expected content types. Reviewed existing 1200x630 social artwork; no invented
prices or new provider promises added. HTTP checks do not substitute for a
real ad-platform approval, human phone acceptance or an acquired purchase.
