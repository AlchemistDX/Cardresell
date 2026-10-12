# Connected selling and advertising decision — October 12, 2026

## Decision

Prepare eBay as the first connected selling destination. Finish the existing
physical-copy/Collection/draft handoff while building seller authorization.
Keep a shared inventory model so a second destination does not require a second
copy of every card. Do not release simultaneous multi-marketplace selling until
sale reconciliation and inventory reservations have been proven.

Invited, clearly described beta feedback is the appropriate next marketing
stage. Broad paid acquisition is not yet justified by the available acceptance
evidence. eBay automation is not a prerequisite for advertising the current
supported utility, but must not be included in advertising claims until it is
actually released and accepted. No ads or outreach were sent by this work.

## Evidence checked today

| Check | Observed result | Limit |
| --- | --- | --- |
| Production deployment | Vercel reports READY at production commit `dd378d99b30d7e5b99dd6908f7fb537f8af7373e` | The workflow branch is not deployed |
| Direct homepage fetch | HTTP 200; exact bytes match production branch `index.html` | Availability is not a phone/customer acceptance test |
| Public `/api/membership-catalogue` | HTTP 200; `purchaseEnabled: false` | Public response alone does not establish every authenticated account's entitlement; pilot restrictions remain documented |
| Runtime investigation | Returned error cluster and eight sampled stderr records were Node `url.parse()` deprecation warnings | Do not count these as proven failed customer requests or infer zero other failures |
| Existing eBay helper | `_ebayAuth.js` obtains an application token | This does not authorize acting for a seller |
| Listing packet | `_listingPacket.js` keeps `submissionReady: false`; condition value IDs remain unresolved | Copy-ready listing text is not a publishable API payload |
| Acquisition instrumentation | Current HTML and `/api/events` have campaign labels and membership funnel events | These are observed event counts, not unique customers, verified revenue or measured acquisition economics |

Older readiness notes contain a qualitative 85% figure. It is not a current
advertising score and is not reused here. Search-engine homepage extraction
showed stale content; the direct live-byte comparison above is the release
evidence. Detailed prior acceptance gaps are in `ad-readiness-20261009.md` and
`product-readiness-20261009.md`; this decision does not mark them complete.

## Groundwork implemented in this continuation

`api/_ebaySellerConsent.js` adds a dormant server-only consent-intent primitive:

- Fixed sandbox/production eBay consent endpoints and inventory scope; eBay
  registered RuName is separate from an arbitrary browser-provided URL.
- Random 256-bit state with ten-minute Redis expiry; stored keys/records contain
  digests rather than raw account IDs, browser nonces or OAuth state.
- Binding to the trusted caller's verified owner ID, browser-session nonce,
  environment, client ID, RuName and requested scopes.
- Atomic one-use claim; mismatched ownership/session/configuration preserves
  the legitimate intent. Corruption, invalid expiry and ambiguous storage
  responses fail closed. A lost claim response requires new consent.

`npm run ebay:consent:check` passed 51 checks against a fresh process-owned Redis,
including 20 concurrent claims, replay, account/session/config mix-ups, expiry,
corruption, and lost write/consume responses. Existing workflow checks passed
(journal 23, scan mapping 19, auth 6, catalog 10), plus registry 12 and the build.
The Redis suite is an explicit local release gate, not part of hosted offline CI.
No real eBay connection or real-account acceptance was performed.

This module has no HTTP route, token exchange, encrypted token storage or
publisher. It does not authenticate a user by itself. Nothing imports it into
the live app. The existing workflow estimate remains about 25% of Phase 1
implementation prepared; this additional prerequisite does not complete an
end-to-end customer milestone.

## Implementation order and acceptance gates

| Priority | Concrete work | Completion evidence |
| --- | --- | --- |
| 1 — finish the core handoff | Preserve complete catalog/printing/sports metadata, stable physical-copy ID, Collection receipt and draft instance; add durable copy retirement across expired/compacted tombstones | Actual normal-entry flow survives reload, two devices, deleted copies and lost responses without duplicates or resurrection |
| 2 — seller connection | Add authenticated start/callback routes, protected browser session, token exchange and encrypted account-scoped token vault; separate sandbox and production | Sandbox consent, denial, account switch, revoked/expired token, reconnect and disconnect tests; identity of the connected seller shown correctly |
| 3 — listing preflight | Resolve category/condition/aspect values, seller policies, inventory location, photos, currency, price and stock; show actionable missing fields | Known-good and deliberately invalid sandbox examples; no guessed condition enum values or false submission readiness |
| 4 — one marketplace listing | Durable operation receipts and deterministic owned SKU; create inventory/offer, explicit reviewed publication, persist returned offer/listing IDs | Sandbox listing lifecycle including partial batches, timeouts, reconciliation, retry and withdrawal; seller-approved production pilot afterwards |
| 5 — order reconciliation | Ingest sales, reserve/decrement physical copies, replay events safely and reconcile periodically | Reordered/duplicate events and missed notifications cannot oversell the same copy |
| 6 — second marketplace | Reuse account connection, inventory and receipt contracts; implement only verified supported operations | Two-market inventory conflict tests and measured seller demand before expansion |

Before step 2 is activated, the HTTP boundary must verify Firebase identity on
both legs using a documented callback-compatible server session. Never derive
owner ID or session nonce from request-body assertions. Use a server-issued
Secure/HttpOnly browser cookie with suitable SameSite behavior for the provider
redirect; invalidate its generation on sign-out/account switch. Protect the
start request against CSRF, cap outstanding intents, and rate-limit by account
and network. The callback must reject duplicate/missing parameters, consume
state on a valid denial, handle short-lived codes, redact query strings and
send no-store responses. Do not place callback codes/tokens in analytics or
browser storage. Exchange/refresh failures must not be presented as connected.

The primitive requests only `sell.inventory`. Before adding account-policy or
order calls, verify each official method's required scope and add the least
privilege scope with explicit consent; an inventory token alone is not enough
for the full roadmap. Configure separate eBay keysets and registered RuNames,
and complete platform eligibility requirements through the owner's developer
account. Credentials should be entered through the deployment secret controls,
not pasted into project documentation or chat.

Do not treat eBay inventory upserts as harmless draft creation: reusing an
existing SKU can change a live listing. Resolve ownership and prior operation
receipts before every retry. Uncertain publication must reconcile the provider
result before attempting another publish.

## How multiple companies can help

| Connection type | Recommendation | Constraint |
| --- | --- | --- |
| Selling destinations | eBay first; evaluate Shopify second if pilot sellers use their own stores | More destinations expand reach; they do not inherently make processing faster |
| Whatnot / TCGplayer | Retain export/manual paths and revisit authorized partner access | Official docs currently say no new API applicants/access; a competitor's integration is not evidence that we can obtain the same access |
| Identification/pricing providers | Define a normalized result with source, timestamp, exact-printing evidence, confidence, cost and timeout | Use a fast primary and bounded fallback; do not pay every provider for every card |
| Processing infrastructure | Queue bounded batches, cache permitted stable data, retry only classified failures and measure tail latency | Respect each provider's quotas and data terms; never spread accounts to evade limits |

A provider adapter should expose capabilities, not promise every company
supports identification, sold prices, inventory, publishing and webhooks.
Unknown price/cost remains unknown rather than zero. Parallelize independent
work within quotas; serialize conflicting changes to the same physical copy.

## Competitive hypothesis and measurement

Card Dealer Pro already advertises scanning, pricing, listing preparation and
connections to eBay, CollX, Whatnot and Shopify. These are published claims,
not an independently measured comparison. Shiny advertises scanning, collection
and price tracking. Adding marketplace connections alone would establish
parity with an existing category, not prove superiority.

Our proposed distinction: help a seller reach a correctly identified, reviewed
listing with fewer edits, understandable estimated net proceeds and recovery
when work is interrupted. Validate that proposition before saying we are
faster, more accurate or more profitable than competitors.

Use `seller-pilot-scorecard.csv` for an initial consented pilot. Begin with ten
sellers and a fixed 100-card, manually verified set covering supported games,
printing variants, foils, duplicates, glare, sleeves and low-value cards. These
are proposed pilot sizes, not achieved results. Keep benchmark images and
participant details out of the public repository; use anonymous IDs in results.
Keep a held-out portion separate from examples used to tune the system.

Record exact-printing correctness, corrections per card, time to reviewed draft,
time to published listing when available, provider cost per successful card,
failure/refund rate and seven-day return use. Separate capture quality, matching
quality and seller corrections. Report median and 95th-percentile time, sample
size, excluded cases and device/network conditions. For a competitive test,
use the same inputs and settings and record any unsupported operation. Do not
infer price accuracy from match accuracy or grading reliability from one page.

The CSV has one row per card/attempt/tool. Blank costs/times mean unmeasured,
never zero; IDs are anonymous. Use `not_available` for publication status when
the product does not support it. Record all failed attempts. Aggregate only
like-for-like tasks; do not compare draft time with publication time. Seven-day
retention and billing conversion require separate consented account cohorts,
not this per-card scorecard.

## Advertising release checklist

| Gate | Required evidence before paid conversion campaign | Current state |
| --- | --- | --- |
| Customer can buy what is advertised | Fresh nonpilot account: signup/email, welcome credit exactly once, checkout, webhook/return fulfillment and entitlement on reload; cancellation/refund recovery exercised appropriately | Not evidenced; public catalogue purchasing disabled |
| Phone journey works | Real iPhone camera/glare/zoom acceptance and live Deep-to-Quick fallback; supported-game scan to saved result on representative images | Prior gaps still open; synthetic/browser checks are not this evidence |
| Claims match the release | Compare every landing/ad claim to live behavior; describe photo grading as advisory and net proceeds as estimates | New connected selling is dormant; do not advertise it as available |
| Operations can withstand customers | Measured provider charges and enforced spending limits, isolated backup restore drill, alert/support ownership and recovery procedure | Prior records leave cost and restore acceptance open |
| Acquisition is measurable | QA campaign journey visible; fulfilled payments reconciled to billing ledger; baseline activation/return-use and actual support/refund costs | Event hooks exist; no validated commercial cohort measured in this review |

Proposed sequence: (1) demonstrate current live features to an invited pilot
with accurate limitations; (2) close the above gates and record results; (3)
run one small, capped paid experiment with one audience and one task-specific
promise; (4) scale only after measured contribution and retention support it.
Actual spend, outreach and purchase-admission changes remain separate decisions.

Before a paid experiment, define its budget, duration and stop conditions.
Pause on a broken signup/fulfillment journey, material incorrect claim, data
loss or unexpected provider spending. Judge acquisition against retained
contribution after provider/payment/support/refund costs, not gross revenue
or browser `checkout_success` events. No conversion or acquisition-cost target
is invented here without baseline data.

## Primary references checked October 12, 2026

- https://developer.ebay.com/develop/guides/sell/authorization
- https://developer.ebay.com/api-docs/sell/static/inventory/publishing-offers.html
- https://developer.ebay.com/develop/api/sell/inventory_api/location/bulkCreateOrReplaceInventoryItem
- https://www.carddealerpro.com/
- https://www.getshiny.io/
- https://developers.whatnot.com/docs/getting-started/introduction
- https://docs.tcgplayer.com/docs/getting-started

Recheck access, scopes, quotas and commercial terms before implementation or
procurement; no new provider subscription or partnership is established here.
