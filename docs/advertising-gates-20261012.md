# Advertising readiness evidence — October 12, 2026

This supplements and supersedes the pending evidence in the earlier October 12
launch notes where stated below. It is not approval to buy ads or a percentage
readiness estimate. Production is now PR #44, merge
`f392f9bf2d3e294720fc09b98e3db68470db3d73`, released October 12.
Public HTML, grading JS/CSS and core JS returned 200 and byte-matched the
tested version. The initial deployment error/fatal log check found no records;
this was a short observation window, not a long-term reliability claim.

## Payment fulfillment: verified for current checkout history

Read-only Stripe inspection paginated the complete-session query: 31 sessions,
`has_more: false`. Four used the launch-v2 checkout system. The remaining 27
legacy sessions were outside this reconciliation's scope.

| Current-system purchase | Gross USD | Durable credit grant |
| --- | ---: | --- |
| Starter initial subscription invoice | $4.99 | 25 ID, 5 Grade |
| 25 ID pack, Free pricing | $2.99 | 25 ID |
| 10 Grade pack, Business pricing | $4.49 | 10 Grade |
| 25 ID pack, Business pricing | $2.24 | 25 ID |

All four sessions are complete/paid; their PaymentIntents succeeded for the
matching amounts. The subscription invoice is paid and has one paid invoice
payment, whose PaymentIntent also succeeded. Expanded latest charges report
zero refunded amount and no dispute at inspection time. Gross total: $14.71.

Each payment was matched to its immutable checkout intent, owner, order binding,
and saved grant receipt in production. All four original order hashes and
grant-request bindings validate. All eight order/receipt records have Redis TTL
`-1` (persistent). The historical Business ID pack repair is included; it was
not replayed or repaired again. No grants, balances or payments were changed.

These are purchases across two accounts in the owner/testing history, not proof
of acquired customers, net revenue, profit or all-time fulfillment. Refund and
dispute state is point-in-time evidence, not a guarantee about future reversals.
No new purchase was made. Private customer/payment identifiers are deliberately
not copied into this document.

## Recovery: isolated restore and scoped invariants verified

Production database: `upstash-kv-bistre-arrow`. Snapshot
`production-launch-check-20261012` is Completed, 3.03 MB. The isolated Free-tier
target `cardresell-recovery-drill-20261012` has a completed restore from that
snapshot. Production was not overwritten or reconnected to the target.

The eight original payment/order strings in the restored target are byte-for-byte
identical to production. Read-only checks on the restored target additionally
found:

- Seven included-credit histories referencing eight allocation lots: all
  referenced lots exist, owners match, no duplicate lot references within a
  history, and ID/Grade usage remains between zero and the granted amount.
- 42 draft records, including 32 deleted drafts: all decode and their draft IDs
  match their authoritative key suffixes.
- 11 saved user-data records containing two portfolio cards, zero flips and
  68 deletion markers: portfolio/flip containers decode with the expected
  structure.
- Across the checked history, allocation, draft and user-data keys: 36 are
  persistent and 32 retain an expiry. No structural errors in these checks.

An inspection-only Lua decode/re-encode omitted a null field and initially made
one order hash appear different. Reading the original stored strings resolved
this: all original hashes validate; no stored corruption was found.

Scope limits: this does not establish full application failover, every secondary
draft index, every deletion-marker semantic, or a measured recovery-time target.
Do not report key counts as permanently fixed; expiring records change normally.
Keep the restored target disconnected from production applications.

**Scheduled protection remains open:** production's Daily Backup switch is OFF.
Automatic approval review rejected enabling that persistent setting without
explicit approval. No retry or policy change was made. Confirm the available
retention and any added charge, then obtain approval for the concrete setting.
A successful manual snapshot/restore is not a recurring backup policy. Never
restore over production as a drill.

## Attribution: checkout labeling verified; paid campaign conversion pending

An existing live QA Checkout Session is open/unpaid, $2.99 USD, with
`acquisition_campaign=qa` and
`acquisition_model=client_last_non_direct_30d_v1`. This confirms deployed checkout
metadata without another charge. The latest-session query was limited to 100 and
had more pages; it was only used to locate this QA session.

The four fulfilled payments above predate these labels and remain `unknown`.
Never relabel them direct or infer their campaign. Exclude QA from ad reporting.
For the first genuine campaign purchase, join the session's intent to the saved
order/grant, then check its settlement and reversals exactly as above. An unpaid
checkout, browser success event or aggregate event count is not a conversion.
Initial-purchase attribution does not automatically attribute renewal revenue.

## Provider entitlement and cost: still blocking paid promotion

Authenticated TCG Price Lookup billing showed Pro at $49.99/month, a paid
September 28 bill and next billing October 28; the dashboard showed 10,000/day.
This replaces the earlier unknown-plan status. It does not settle commercial
permissions or actual marginal usage costs.

The provider's FAQ allows commercial resale applications on paid plans and
describes price caching of 5–60 minutes. Its terms (dated February 1, 2026)
restrict competing services and resale/redistribution without explicit written
authorization. This is a permissions ambiguity to resolve with the provider,
not a conclusion that CardResell is in violation.

Repository defaults include a six-hour fresh cache and up to 24-hour stale
fallback in `_tplBudget.js`; another price route uses a 30-minute cache. Verify
effective production settings and obtain explicit permission for the actual
display/cache behavior before declaring this gate passed. Attribution already
exists in the site's footer; attribution alone does not establish rights.

Questions prepared for the provider, not sent:

1. Confirm this account's current plan, daily reset timezone, hard/soft limit,
   overage pricing and whether other applications share its allowance.
2. Confirm permission for CardResell's paid consumer app to display card values,
   compare estimated selling proceeds, and use data in user listing drafts.
3. Confirm permitted cache durations, stale fallback, derivative calculations,
   customer exports and required attribution; clarify how the terms and FAQ
   apply to this use. We are not requesting permission to resell raw API access.
4. Provide current commercial/API terms and any partnership option in writing.

Production's observed TPL allowance remains 400 requests per aligned hour and
60 per IP, enforcement enabled. No limit was changed. The 9,600 reservations
possible across 24 aligned hours are neither actual usage nor a dollar cap.
OpenAI/Ximilar billed usage, retries and overage behavior still need reconciliation
before calculating contribution margin or selecting a customer-acquisition budget.
Existing provider log summaries explicitly report unknown dollars as unknown.

## Staged advertising release

| Gate | Status | Next concrete evidence |
| --- | --- | --- |
| Phone and core workflow | Owner accepted; PR #44 live | Repeat only when a relevant regression appears |
| Current-system payments | Four payments reconciled | Continue monitoring new payments and reversals |
| Recovery | Isolated restore and scoped checks pass | Approved recurring retention policy; timed application recovery exercise |
| Provider permissions | Paid plan confirmed; terms ambiguous | Written confirmation for actual display/cache/export behavior |
| Unit economics | Incomplete | Actual billed scan/grade/retry costs and bounded overage exposure |
| Acquisition tracking | QA checkout label confirmed | First real tagged purchase joined to durable fulfillment |
| Paid advertising | Hold broad spend | Clear provider/cost/backup gates, then owner-approved small capped pilot |

Once those gates clear, begin with one channel and a distinct supported campaign
label, agree a total spending cap, and review fulfilled purchases, support issues,
refunds and contribution margin before expanding. Do not invent a CAC target
from the $14.71 testing history. Pause the pilot for lost credits, duplicate
charges, cross-account data, inability to restore, or uncontrolled provider spend.

Supported message direction for review: identify cards, organize a collection,
and compare estimated selling proceeds. State that identification and prices
require review; availability and actual payouts vary. Do not advertise guaranteed
grades/profit, automatic marketplace publishing, reliable automatic eBay sold
records, or the best price across every marketplace. Bulk scanning and draft
creation do not imply those capabilities. No ads or company emails were sent.

Sources checked October 12, 2026:
- https://tcgpricelookup.com/faq
- https://tcgpricelookup.com/terms
- https://upstash.com/docs/redis/features/backup
- Authenticated Stripe, TCG Price Lookup billing, Vercel and Upstash account UI.

## Advertising preparation continuation — October 12, after PR #44

The live production release includes automatic multi-grader fee estimates and
primary bulk listing-draft access. The acquisition suite passed again: 23/23.
The account currently available in the Upstash browser shows only a Personal
workspace with no databases. This does not overturn the earlier restore evidence
or prove the production database is absent; it blocks fresh account-level
verification of retention, pricing and the Daily Backup setting. No backup
setting, provider subscription or advertising account was changed.

Current official backup documentation describes daily retention choices of one
or three days; availability and incremental price for the production resource
still require the correct account. Prior automatic approval review rejected
enabling Daily Backup without explicit approval. Do not retry that change under
the broad preparation request. Prepare the exact resource, retention and cost
for approval once access is restored.

PriceCharting's indexed API documentation states internal-use licensing and
requires a commercial agreement for sharing prices. No written agreement is
present in this evidence. Direct refetch was blocked with HTTP 403, so this
continuation does not assert newly inspected account terms. Add PriceCharting
alongside TCG Price Lookup to the written-permissions gate.

See advertising-launch-packet-20261012.md for copy, channel links, launch
sequence, cost reconciliation fields and drafted provider requests.

## Account evidence continuation — October 12, approximately 13:46 ET

The account-access blocker is resolved. Use Vercel project Connections → Storage
→ upstash-kv-bistre-arrow → Open in Upstash. This opens the Vercel-integrated
Upstash account, distinct from the empty Personal workspace. The resource is
connected to CardResell Production; aureolin-door is Preview/Development.

Production Backups shows Daily Backup OFF and the completed 3.03 MB
production-launch-check-20261012 backup, plus the earlier October 2 snapshot.
The retention menu offers Last 1 day; Last 3 days is marked PROD. Upstash's
official Prod Pack article says all plans support one-day daily retention and
three-day retention requires the $200/month add-on. Propose enabling the
existing plan's one-day daily backup only; no upgrade or restore. No setting
was changed because the earlier approval rejection requires explicit permission.
Verify the first completed scheduled backup after enabling before closing this gate.
Source: https://upstash.com/blog/upstash-prod-pack

Resource cost observations differ: Vercel's resource page displayed $0.30 for
September 30–October 31; the provider dashboard displayed $0.38 with 188K
commands. These are dashboard usage estimates with potentially different
refresh times, not reconciled invoices. Do not combine or present them as
separate charges.

### Ximilar: authenticated allowance and invoices established

Owner-selected account exposes Business 100K. Current monthly allowance:
100,000 credits, 4,020 used, 95,980 remaining, renewal October 16. Unused plan
credits do not roll over according to the account page. The invoice table
shows August 16 and September 16 monthly invoices of $64 each, both Paid;
Credit Packs and Manual Invoices each show zero entries.

Statistics for October 1–12 show 3,880 credits, 388 requests and one active
service: Collectibles Recognition. Its operation filter lists Identify a TCG
card and Identify a sports card. The calendar-month statistics and current
subscription allowance cover different periods; 3,880 versus 4,020 is not
evidence of missing charges. The visible chart did not establish complete
per-operation success/failure attribution or overage behavior.

At full use, $64 / 100,000 = $0.00064 per included credit; the observed aggregate
ratio is 10 credits per request, equivalent to $0.0064 at full plan utilization.
This is capacity arithmetic, not measured marginal cost or cost per successful
CardResell scan. The full $64 subscription is payable even with unused credits;
failed attempts, binder processing, refunds and application delivery still need
reconciliation. Do not extrapolate successful-user economics from these ratios.

### OpenAI: key-scoped usage and missing hard enforcement established

Owner-selected account: Personal organization / Default project. Usage key
filter lists active Cardresell and a deleted Cardresell key. With active
Cardresell selected and the dashboard date query October 1–12, it reports
$1.05, 59 requests and 375,820 tokens. These are provider dashboard observations,
not a settled invoice or count of delivered grades. UTC/calendar cutoff and
reporting lag must be reconciled before comparing to application events.

The model usage page reports several models, so the aggregate must not be
labeled the cost of a single grading model. Requests may include testing and
retries; the key label alone does not prove every request was a live customer.

Organization Limits explicitly says “Limit not enforced” for the $100 monthly
limit, with alerts at $80 and $100. The edit dialog exposes an OFF “Enforce a
hard limit” switch. It was inspected and cancelled without saving. Proposed
control: enforce the existing $100 organization monthly limit, without raising
it. Reaching the ceiling may stop all API activity in this organization,
including CardResell AI grading and other projects; obtain explicit owner
approval before applying. No secrets or credential changes are needed.

### Remaining gate status

Access and plan evidence advanced; do not mark overall economics complete.
Still needed: cost-to-delivery reconciliation, Ximilar exhaustion/overage
behavior, other provider license expenses, recurring-backup approval and
completion, OpenAI hard-limit decision, and written commercial permissions.
No advertisements, provider messages, purchases or settings changes occurred.
