# Core values and seller workflow audit — 2026-10-26

CardResell's useful promise remains: bring inventory in once, prepare listings faster, choose where to sell, and know what you actually earned. This audit checks that promise against the shipped experience and makes a small set of repairs. It is not a claim that every feature or external integration is finished.

## Product rules

1. Preserve the physical copy and its history. Imports, scans, drafts, sales and recovery must not silently create a different card or lose its costs.
2. Show what the evidence supports. Exact printing, price source, missing costs and uncertainty matter more than a confident-looking number.
3. Make the seller's choice change the recommendation and outgoing research. Keep publishing and other consequential choices under seller control.
4. Make common work direct and interrupted work recoverable. Present a clear next action; show specialist controls when needed.
5. State capabilities and plan limits plainly. A research link, prepared draft, linked account and live published listing are different outcomes.

These rules follow the owner's stated product promise and the durable principles in `audit/CARDRESELL_PLAN_AND_ROADMAP.md`. That older roadmap's operational dates and release holds are not treated as current deployment state.

## Repairs in this release

**Wrong-card research race.** Opening card A, then card B, could let A's slower TCGplayer lookup overwrite B's research link. The actual browser regression failed before the fix. Each open now has its own identity and account guard; a closed modal or changed account also rejects the late result. Background metadata refresh uses the same guard so it cannot reopen an old card view.

**Clearer action labels.** Links that open marketplace research now say “eBay sold research” or “TCGplayer research.” The welcome note explains how to check recent sales and that automatic sold data may be unavailable. The scanner purchase description says “Available price references.” The Free flip pitch states its 10-flip allowance.

**Less everyday clutter.** Collection and Flips group their three review/recovery buttons under “Sync and recovery.” Import, add, reports and normal work remain directly available. A failed sync or pending saved recovery choice opens the group automatically; the direct cloud retry remains visible. This uses native disclosure controls, wrapping buttons and 44px minimum touch targets. Checks and screenshot review cover 320px, 390px and desktop layouts.

**Test maintenance.** Batch-save assertions now include the existing explicit cost metadata and verify its value. Recovery browser tests navigate the visible disclosure before exercising the real handler and Redis paths. The old sign-out test depended on two statements being adjacent; it now executes the shipped reset functions and checks that account identity and the membership notice clear. Copy checks enforce the revised sold-data disclosure.

## Audit coverage and result

| Seller task / value | Evidence checked | Result and boundary |
| --- | --- | --- |
| Enter, import and retain inventory once | CSV identity round trips, import preview/history, duplicate protection, copy edits, zero versus unknown costs | Local and browser gates pass. Original copy identity and cost provenance remain protected. |
| Identify and review cards | Single, rapid and binder flows; uncertain match confirmation; finish/printing correction; Magic text recovery; cancellation and credit atomicity | Workflow gates pass. These fixtures do not measure live Ximilar recognition accuracy. |
| Compare value honestly | Source/printing selection, freshness and price-evidence gates, selected-card URLs, shipping/fee assumptions | No fabricated percentage-based low/high range is introduced. Missing evidence stays missing. The wrong-card link race is repaired. |
| Choose a selling approach | Selling-priority, selected-copy, bulk-venue and selling-plan browser gates | Preferences affect the next step. Least-work guidance can lead to an eBay draft; quick-cash guidance does not invent a sale-time promise; no-shipping guidance keeps that constraint. |
| Prepare listings with seller control | Draft CRUD/caps, reviewed defaults, missing-photo and field validation, export, reservations and interrupted operation recovery | Local gates pass. Production's direct eBay mutation gate remains off; a connection is not a published listing. |
| Record actual results | Sold-copy continuity, sale corrections, cost completeness, reporting and exports | Known-cost calculations and missing-cost exclusions pass. A missing cost is not silently treated as zero profit expense. |
| Recover and keep accounts separate | Lost responses, conflicts, backups, changed accounts, expired authentication, storage failures | Browser/API/isolated-Redis gates pass. Recovery controls are simpler to find when a problem occurs. |
| Understand the offer | Homepage, Pricing, Accuracy, About, Contact, Privacy, Terms, public membership catalogue and claims tests | All eight read-only routes returned HTTP 200. Public plan names, prices, credits and venue allowances agree with the current catalogue. Updated UI removes the specific overclaims found here. |
| Use the app on a phone | Existing brand, condition, scanner, binder, grade-upload and seller-browser checks; new recovery layouts | Responsive Chromium checks pass. Physical iPhone camera/Safari acceptance remains separate. |

US eBay trading-card fee rate, order charges and fee base were spot-checked against [eBay's published fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822). TCGplayer Direct's low-value threshold and per-card fee were checked against [TCGplayer's published fees](https://help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees). They match the existing implementation. This is not a fresh certification of every venue's terms; other venues retain their own source dates and freshness safeguards.

## Verification record

**165 main suites and 45 additional release checks pass after the affected test corrections and targeted reruns.** The main runner traversed all 167 slots; the managed-store and production mutation slots were intentionally skipped. Its original exit was 1 for the old copy expectation and a recovery test targeting the hidden Collection group while displaying Flips. Both corrected suites completed with zero failures. The extra run's obsolete sign-out assertion also passes after replacement with the executed behavior check. Three older extra suites use explicit scenario summaries rather than the standard completion marker; their full outputs and exit-zero results were inspected.

The new core-values browser regression has 66 passing assertions. The cost-continuity browser regression has 66. The full checks include 237 selling-next-step assertions, 127 batch-draft assertions, 94 eBay-operation assertions and 42 eBay-operation browser assertions. The configured ordinary build inspection, asset fingerprints, test registry and whitespace check pass. Detailed per-suite results, original failures, rerun records, runtime asset hashes and log hashes are in [core-values-audit-20261026.json](core-values-audit-20261026.json).

Local Chromium, isolated Redis, shipped assets and actual handlers exercise the supported paths. Authentication, providers and payments use synthetic fixtures with external application traffic blocked. The audit performs no live inventory mutation, paid scan, purchase or eBay listing change. Previously deployed hashed assets remain intact; runtime changes are the entry document and a newly hashed core bundle.

## Remaining work, in order

1. **Measure real recognition quality.** Build an exact-printing benchmark from original full-resolution labeled photos, especially Magic binder pages, and run a physical iPhone/Safari capture check. The supplied screenshots demonstrate pain but cannot establish provider accuracy or substitute for original input photos. Keep uncertain results reviewable.
2. **Prove eBay capabilities independently.** Confirm permitted market-wide sold data, seller configuration, reviewed publication and subsequent sale reconciliation before enabling those paths. [eBay documents Marketplace Insights as restricted and not open to new users](https://developer.ebay.com/api-docs/buy/static/ref-marketplace-supported.html). Existing seller OAuth does not establish that entitlement. Current production handlers default to publication disabled; automatic sales sync is not claimed as complete.
3. **Keep launch/payment claims tied to account eligibility.** The signed-out catalogue returns `purchaseEnabled: false`; this does not determine a signed-in pilot account's eligibility. Current billing and account lifecycle gates pass, but no live purchase or subscription change was made for this audit.
4. **Trace the production deprecation warning.** The six error-level log records returned for the inspected one-hour window were all `DEP0169` / `url.parse()` warnings. They do not by themselves establish failed requests. Identify the dependency/runtime source in a separate diagnostic change; do not suppress the warning or describe historical aggregate totals as today's error count.

Two historical billing scripts were not run: one requires an unavailable `facc465` snapshot and an obsolete exact release layout; the other requires a separate historical rollback checkout that is absent. Current billing atomicity, membership and browser checks ran separately. Managed-service mutation tests, live provider acceptance, professional-grade validation, a security penetration test and formal legal compliance certification are outside this audit's evidence.

The next product work should close these measured gaps while preserving the current direct path from inventory to draft to recorded sale. Additional dashboards, venue tables or explanatory layers are not needed to address the findings above.
