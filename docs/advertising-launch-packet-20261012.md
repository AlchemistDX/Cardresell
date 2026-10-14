# CardResell advertising launch packet

Prepared October 12, 2026, America/New_York. Status: materials ready for review;
public promotion and paid spend remain gated. No ads or outreach were sent
during this preparation pass. Approved daily backup storage is enabled at $0.25 per GB-month, keeping
the latest day; the OpenAI $100 organization limit is enforced. This is an operating proposal, not a
forecast of sales. The owner confirms provider permissions were already granted
in earlier replies; Ximilar sends low-credit warnings. Duplicate outreach is closed.

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
| Recovery | Isolated restore passed scoped checks; production daily backup enabled with one-day retention at approved $0.25/GB-month | Verify first completed scheduled backup |
| Data permissions | Owner confirms prior permission replies from all providers for existing CardResell use | Complete; no duplicate outreach |
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

1. Complete recurring backup and economics checks below. Refresh
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
| PriceCharting | Account invoice; commercial permission already owner-confirmed | Keep fixed licensing expense separate from marginal lookups; no duplicate permission request |
| Stripe | Four charge balance transactions reconciled: $14.71 gross, $1.62 processing fees, $13.09 net; separate $0.03 October Billing usage fee | The $0.03 is an account-level fee with no direct invoice reference; neither amount is provider-adjusted profit |

For each row record period, currency, gross charge, credits/discounts, net billed
amount, production share, evidence location and unresolved difference. Blank
amounts mean unknown, never zero. Provider attempts observed in logs are not
equivalent to invoices; log retention and missing responses can leave gaps.

Fully loaded cost per delivered ID/grade should include the operation's
failed/retried attempts, allocated fixed costs and free-user activity. If
operations cannot be allocated reliably, report a range with the unallocated
pool separately. Do not create a precise CAC target until this is reconciled.

### Payment fees now reconciled

| Current-system purchase | Gross | Processing fee | Net to Stripe balance |
| --- | ---: | ---: | ---: |
| Starter initial subscription | $4.99 | $0.44 | $4.55 |
| 25 ID pack, Free price | $2.99 | $0.39 | $2.60 |
| 10 Grade pack, Business price | $4.49 | $0.43 | $4.06 |
| 25 ID pack, Business price | $2.24 | $0.36 | $1.88 |
| Total | $14.71 | $1.62 | $13.09 |

Read-only Stripe verification on October 12: all four charge balance entries
are available; matching payments succeeded; no refund or dispute was present.
Checkout tax amounts are zero. Available balance is not proof of a bank payout.
The separate $0.03 Billing fee is outside the processing-fee table; its direct
purchase allocation remains unconfirmed. These owner/testing purchases are
not advertising conversions, and provider expenses are still outstanding.

Known recurring provider commitments observed so far are Ximilar $64/month and
TCG Price Lookup $49.99/month: $113.99/month combined. That is a partial subtotal,
not all operating expenses. PriceCharting, hosting/storage, OpenAI usage and
credit-redemption costs cannot be treated as zero or charged against this
small purchase sample without aligned periods and allocation.

### Free-user exposure and current pack review

The offline cost planner now reads the actual welcome grant, Free allowance,
credit consumption rules and every plan's current pack quote from the canonical
configuration. It covers all 35 plan/pack combinations in two scenarios. It
does not change customer prices or make provider requests.

A new eligible Free account can receive 10 ID + 1 Grade welcome credits and
5 ID + 1 Grade for one calendar month: **15 ID + 2 Grade combined**. Credits do
not expire; usage may happen later, and another calendar month adds another
monthly grant. Treat unused balances as future service obligations.

For 100 accounts fully redeeming that combined allowance:

| Scenario | Modeled resource cost | What it means |
| --- | ---: | --- |
| Remaining shared Ximilar monthly quota, one ID call per operation | $3.40 OpenAI variable cost | Excludes the real $64 monthly Ximilar commitment and all other costs |
| Extra credits valued at the observed $11/10K offer, two ID calls per operation | $49.20 | $46.20 of Ximilar credits + $3.00 assumed OpenAI cost; the most expensive modeled grade mix is one Deep Grade per account |
| Same extra-credit scenario, hypothetical 30% of equally costly attempts refunded | $70.29 | Sensitivity only, not an observed failure rate or spending ceiling |

The $49.20 is allocated resource cost, not an invoice: buying from zero prepaid
and included balance would require five whole 10K packs ($55) plus the modeled
$3 OpenAI usage, or **$58 cash**, with 8K credits left over. No packs were bought.
AI rates here remain historical sample assumptions. Fixed subscriptions,
hosting, free users from other cohorts, retries beyond the sensitivity, existing
balances and support remain outside these figures. This is not a forecast of
100 signups or an enforceable signup cap.

All 35 current plan/pack combinations retain positive modeled contribution
before fixed/other costs in the two scenarios, including the 30% sensitivity.
That is not a profit finding. For example, the Business 1,000-ID pack leaves
only $4.67 in the extra-credit / 30% sensitivity before those omitted costs.
Do not use the pack's $37.49 sale price as an allowable acquisition cost.

Validation: 70 distinct scenario/plan/pack rows, six free-grant rows, canonical
Business pricing, whole-grade redemption and the 100-account arithmetic checked.
Real delivered-unit costs still require aligned invoices and delivery evidence;
these scenarios do not fill those missing observations with assumed actuals.

## Provider permissions and warnings — established context

The owner confirmed on October 12 at 15:12 Eastern that TCG Price Lookup,
PriceCharting and Ximilar had already replied with permission in earlier
conversations. Permission outreach is complete for the existing CardResell use.
The redundant drafts were removed from this active packet; do not send them.

Ximilar sends low-credit warnings. Include reviewing those notices and the
account's remaining allowance in launch operations. No new warning setup or
repeat support question is needed. This does not imply automatic top-ups or
a hard spending cap; no such behavior is inferred from the warnings.

The original reply text was not recovered during this continuation. The source
for this status is the owner's explicit confirmation, supplemented by recovered
prior TCG Price Lookup commercial-license context. Preserve that distinction
without turning missing local copies back into a permission blocker.

## Concrete next decisions

1. Verify the first completed scheduled backup on production upstash-kv-bistre-arrow.
   Daily Backup is enabled with Last 1 day retention at the owner-approved
   $0.25 per GB-month rate. No Prod Pack upgrade was purchased. Retain the
   isolated-restore evidence separately; a saved setting is not a completed run.
2. Reconcile the provider billing/usage exports listed above and review existing
   Ximilar low-credit notices before requesting ad-budget sign-off.
3. Once checks pass, approve the concrete $70 test and bounded provider exposure,
   or revise the amount. Approval has not been inferred from preparation.

## Sources and validation

Official sources reviewed October 12, 2026:
- https://tcgpricelookup.com/terms
- https://tcgpricelookup.com/faq
- https://www.pricecharting.com/api-documentation (successfully refreshed October 12)
- https://upstash.com/docs/redis/features/backup

General public provider terms are background; the owner's confirmation of prior
permission replies controls the existing-use launch checklist. Exact contractual
conditions are not reconstructed here. The approved backup rate was verified
in the account. This packet is preparation, not a legal interpretation of a license.

Checked locally: acquisition-tracking 23/23. Checked over public HTTPS: both
shop_qr and meta_ads landing URLs preserve their query and return 200; pricing,
contact, privacy, terms, robots, sitemap and PNG preview return 200 with the
expected content types. Reviewed existing 1200x630 social artwork; no invented
prices or new provider promises added. HTTP checks do not substitute for a
real ad-platform approval, human phone acceptance or an acquired purchase.

### Latest operational evidence

See the account-evidence continuation in advertising-gates-20261012.md. Ximilar
Business 100K is $64/month with paid invoice evidence; OpenAI reports $1.05
for the active Cardresell key in the October 1–12 dashboard window. Neither is
a complete delivered-unit margin calculation. Production one-day daily backups
are enabled at the approved $0.25 per GB-month rate, with the first scheduled
run still unverified. OpenAI's existing $100 organization monthly limit is
enforced. No ad launch is authorized by this update.

### Control execution update

OpenAI's existing $100 organization monthly limit is now enforced after owner
approval. Enforcement may lag slightly and requests can fail at the ceiling.
Upstash initially disclosed $0.25 per GB-month in the enable dialog, so the
operation was cancelled pending specific rate approval. The owner subsequently
approved that rate; Daily Backup is now saved ON with Last 1 day retention.
The first scheduled backup has not appeared in the table yet. One-day retention
does not require Prod Pack, but it is not free storage.

### Cost evidence update

The Ximilar operation export separates 381 TCG requests / 3,810 credits and
seven sports requests / 70 credits through October 12 at 13:00 Eastern.
Current-release logs yielded 128 provider attempts after that cutoff; the two
datasets are not an aligned delivered-unit reconciliation. Vercel billing
samples also require period and production allocation checks. See the detailed
coverage in advertising-gates-20261012.md.

The local planning tool now uses the verified $64 account subscription and
the offered $11/10K prepaid pack instead of unverified public/pack assumptions.
It retains explicit unknowns; its output is a sensitivity scenario, not margin
proof or a recommendation to change customer pricing. No pack was purchased.
