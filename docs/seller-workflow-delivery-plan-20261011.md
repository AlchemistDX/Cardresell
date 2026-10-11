# CardResell seller workflow delivery plan

Prepared October 11, 2026. Baseline: production commit `dd378d9` plus the reviewed, not-yet-published scanner fixes in this working branch. This is a delivery plan, not a claim that the proposed features are live.

## Outcome and scope

A seller should be able to capture a stack or binder, correct only the uncertain details, save each physical copy once, prepare usable drafts, choose a selling venue with explicit estimated costs, and later reconcile an actual sale. The same identity and purchase cost must survive every step.

The first release connects existing capabilities. Hands-free capture, batch selling advice, direct marketplace integration and order reconciliation follow behind explicit gates. No new paid service, advertising campaign, customer credit grant or subscription change is included in this plan.

## Current starting point

| Area | Present in the October 11 release | Work still needed |
| --- | --- | --- |
| ID capture | Single ID, Rapid Scan, uploaded batches, multi-page guided binder crops and review | Hands-free capture; persistent resumable batch sessions; representative accuracy benchmark |
| Binder | Up to 10 pages; automatic grid fitting when plausible; pocket selection and one batch quote | Owner phone acceptance across more real layouts, sleeves, glare and empty pockets |
| Identification | Server identification, exact-printing checks, bounded Magic printed-name rescue | Broader exact-printing/language evidence; uniform unresolved/review UX |
| Collection | Local save, account-scoped cloud metadata sync, search and selection | Stable scan-to-collection copy links; explicit save recovery; bulk-edit and batch provenance |
| Drafts | Single/bulk preparation, per-plan capacity, receipt/retry handling, exports and local photos | One connected batch handoff; real seller-account import acceptance; shared instance identity |
| Grading | Quick/Deep, pre-grade advisory photo checks, saved reports; Pro 10/Business 25 uploaded cards | Physical-camera/fallback acceptance and representative calibration; no continuous batch Grade camera claim |
| Selling math | Estimated net proceeds, fee dates, grading ROI, eight fee schedules refreshed Oct 11 | Batch decisions, seller presets, sensitivity/unknown-input handling, actual-sale reconciliation |
| Marketplace publishing | Drafts, files and handoff | Direct authorized publishing, seller connections, order/quantity synchronization |
| Operations | Extensive regression suite, provider deadlines and partial usage telemetry | Reconciled provider costs, backup/restore evidence, catalog freshness monitoring and persistent operational metrics |

Catalog snapshot: 20,699 Pokémon image-reference records/173 represented sets; 18,618 Magic records/121 sets. These are bounded local indexes, not recognition accuracy or complete printing/language coverage.

## Findings that determine the architecture

1. `_bulkDraftUnits` currently identifies copies as `inst_scan_<copyUid>`. `_bulkSaveToCollection` mints unrelated entry IDs, and Collection draft preparation uses `inst_col_<entryId>`. A connected flow must preserve a physical-copy link instead of treating those as new inventory. Matching by card name/artwork is not a safe migration strategy: two identical cards may really be two copies.
2. The active collection transport is `/api/user-data`, with local `portfolio`/`flips` snapshots, account ownership, deletion tombstones, compare-and-set and a 2,000-row bound. Do not build on the differently shaped legacy `/api/collection` route simply because its name looks relevant.
3. The existing `_inventoryInstance.js` models lots, while the live scan/collection path saves per-copy entries. The first connected release keeps per-copy records and groups them visually. A lot migration is separate work, including cost conservation and slab/cert constraints.
4. Draft authority already exists in `_draftService`, `_draftBulk`, `_draftPlanPolicy` and related stores. The new session journal coordinates those interfaces; it must not become a second entitlement, SKU or billing implementation.
5. Seller photos live in a local photo store today. A metadata session must not silently become cloud photo storage. After device changes or local eviction, the UI must say that a photo needs reattachment.
6. Current legacy cost paths can represent skipped cost entry as zero. New workflow records distinguish unknown (`null`) from a deliberately entered zero. Existing zeroes cannot be automatically reclassified without evidence.

## Groundwork prepared in this branch

| Deliverable | Scope | Activation |
| --- | --- | --- |
| `shared/seller-workflow.mjs` | Versioned metadata journal, separate copy/collection/instance IDs, explicit review, immutable operation snapshots, revision/account guards, uncertain-result reconciliation, terminal receipts and integer-cent cost allocation | Dormant; no browser import, storage adapter, API or paid provider call |
| `tests/seller-workflow.mjs` | Executable adversarial scenarios for the journal and cost conservation | `npm run workflow:check` |
| `tools/sync-catalog-stats.mjs` | Derives public catalog counts and source hashes from the two actual indexes | `npm run catalog:stats`; `--check` is in the build command |
| `data/catalog-stats.json` | Reproducible, scoped catalog evidence | Static route explicitly configured; no general data-directory publishing |
| `.github/workflows/workflow-foundation.yml` | Read-only, dependency-free journal/catalog/release checks on PRs and the working branches; pinned checkout action | First hosted run passed on `8e0204f`; subsequent commits require their own readback |
| Single ID lifecycle correction | Abandoned/account-switched preparation cannot dispatch; missing QC fails closed; stale callbacks cannot repaint another scan | Prepared for release; see `single-scan-parity-20261011.md` |
| Bulk collection save correction | A failed local write cannot continue into a success toast, success telemetry or “saved” state | Prepared for release; tested against the actual saver |

The journal is deliberately not a production exactly-once guarantee. Exactly-once effects require the existing server idempotency/CAS rules plus a durable client adapter. Its revision check is an in-memory precondition, not a distributed lock. The 500-copy journal bound is a technical envelope, not a newly granted plan allowance or a change to Bulk ID limits.

Local verification of this groundwork completed: 19 targeted suites passed, including the new journal (23 scenarios), catalog generator (10 checks), actual bulk saver (16), single-ID lifecycle (66), and the existing Rapid Scan, binder, multi-page binder, Magic rescue, grade-photo, grade-confidence, Collection drafts, fee-report, copy-truth and asset checks. Syntax, test registry, catalog evidence and the configured build checks passed. Hosted CI and deployment are separate checks; no end-to-end connected workflow acceptance is claimed.

## Delivery sequence and effort

Ranges are focused engineering days for one developer, including relevant automated tests and review. They exclude waiting for provider approval, seller access or owner phone testing; they are planning estimates, not calendar promises. Re-estimate each phase after its first integration test.

| Phase | Priority | Estimate | Depends on | Release criterion |
| --- | --- | ---: | --- | --- |
| 0. Reconcile and harden | P0 | 1–2 | Current work | Exact reviewed commit, no lost newer features, truthfully reported save states |
| 1. Connected batch workflow | P0 | 6–10 | Phase 0 | Restartable scan → review → Collection → drafts, same physical copies throughout |
| 2. Hands-free stack capture | P1 | 5–10 | Phase 1 + phone test access | Stable capture feedback, no accidental duplicate frames, intentional identical copies retained |
| 3. Batch selling decisions | P1 | 4–7 | Phase 1 + cost/provenance | Explainable batch recommendations with unknown inputs kept unknown |
| 4. eBay seller connection | P1 | 10–20 + external waits | Phase 1 + export/policy/photo gates | One authorized listing flow and recoverable quantity/order reconciliation |
| 5. Actual profit and inventory follow-up | P1 | 5–10 | Phase 1; Phase 4 for sync | Imports/replays cannot double-count sales; estimates remain separate from actuals |
| 6. Acquisition and recurring operation | Ongoing | Stage after measured beta | All applicable launch gates | Proven completion, measured variable costs and repeat usage before paid scaling |

Phases 2 and 3 can be reordered after observing pilot bottlenecks. Provider enrollment/read-only documentation for Phase 4 can be investigated while Phase 1 ships. Do not delay the useful connected workflow while waiting for marketplace API access.

## Phase 0: reconcile and harden

**WF-001 — Preserve and release the pending work.** Rebase onto the latest remote head, retain immutable old bundles, verify source hashes, run scoped scanner/browser tests and inspect the exact deployed commit. If the remote head moves, re-review the merge; never move the branch backwards. Keep the new journal dormant.

**WF-002 — Truthful storage state.** A failed collection write leaves rows/photos available and says it failed. Local success and cloud success are separate states. Capacity, malformed storage, quota and account changes must never be reported as successful saves. The prepared bulk fix covers the false-success branch; it does not yet make repeated saves idempotent.

**WF-003 — Public evidence upkeep.** Generate catalog counts/hash evidence, fail checks on stale counts, verify static routing, and retain fee-audit dates unless the source was actually re-read. Audit the “weekly refresh” claim against an observed job/run history; remove or qualify it if the process is not operational. Review policy wording against local photos, provider processing and temporary asynchronous jobs.

**WF-004 — Operational records.** Keep billing/account records and private business analysis out of future public commits. Inventory existing public documents and prepare a narrowly scoped removal/private-storage change. Removing a current file does not erase public history; do not rewrite history or change repository visibility without a specific review of the effect on deployments and collaborators.

## Phase 1: one connected batch

**WF-101 — Persistent session adapter.** Implement an IndexedDB adapter around the versioned journal, scoped by verified account ID. Persist `pending` before invoking an external mutation. Use transactions and compare revisions across tabs; localStorage alone is not an atomic multi-tab lock. Quota/corrupt/future-schema failures preserve the original record for recovery, never reset it to an empty session. Store metadata only; reference the existing local photo store. Surface “saved on this device,” “account sync pending,” “confirmed” and “needs recovery.”

**WF-102 — Stable copy mapping.** At capture, keep `scanUid`/`copyUids`. Before the first save, allocate and persist each `collectionId` once. Retain the existing scan draft instance ID, and pass that link through the Collection path only after validating it against the owned row. Legacy Collection rows keep `inst_col_<id>`. A newly acquired identical card gets a fresh copy ID. Do not infer links from names, prices or thumbnails. Where a scan already has a draft, recover it through the existing service instead of creating another.

**WF-103 — Collection save adapter.** Reuse `/api/user-data` with the current account/CAS/tombstone model. Add stable IDs to the snapshot, detect identity conflicts and verify returned success. A repeat after a lost response reuses the same IDs. Once deleted, a copy must not be resurrected by an old session; deleted/gone resources require explicit new action. Test the 2,000-row and 900 KB limits before promising larger inventory.

**WF-104 — Batch review screen.** Reuse the existing scan results and present “Needs review,” “Ready,” “Saved” and “Draft ready.” Keep cards with uncertain set/number/language/finish visible; do not price or export them as a verified different printing. Bulk actions apply only to selected rows, show affected copies, and support undo before submission. Changing identity invalidates associated price/eligibility evidence. Conditions are seller-confirmed, never silently Near Mint. Empty/failed pockets remain visible and excluded from save/draft actions until resolved.

**WF-105 — Purchase-cost sheet.** Support whole-batch cost and per-copy edits in integer cents. Allocate the remainder deterministically in stable copy order. Show total basis and preserve it through quantity changes/splits. Unknown cost gives unknown profit. Grouping duplicate products visually must not merge different costs, conditions, photos or slab certificates.

**WF-106 — Draft orchestration.** After confirmed save, fetch current capacity and eligibility, prepare the existing bulk manifest, and call `_crCreateDraft` with its generation/idempotency handling. Preserve immutable request payloads through ambiguous failures. Do not automatically split a selection to evade plan limits. Stop on uncertain saves, auth or capacity failures and keep unattempted rows selected. Show per-copy outcomes and an explicit retry/recovery action. “Prepare drafts” must not publish to a marketplace.

**WF-107 — Browser acceptance.** Exercise the normal entry point at 320/390 px portrait and phone landscape, with actual local HTTP adapters and isolated Redis. Include 1/25/100/500-copy scenarios within applicable plan limits; mixed games; identical copies; missing images; Unicode and hostile imported text; cloud offline; lost response; browser restart; two tabs; account switch; deletion; capacity downgrade; and unknown/zero purchase cost. Assert no duplicate collection entry/draft, no lost copy and no false “saved.”

**First pilot walkthrough:** import/capture 30 known cards, correct a foil and an uncertain printing, enter a $10 batch cost, save, reload, prepare selected drafts, interrupt a response, resume, export and confirm that the same copies and exactly $10 of basis remain. Test with synthetic services first, then an authorized pilot account. Marketplace import acceptance requires that seller account; a CSV opening in a spreadsheet is not equivalent evidence.

## Phase 2: hands-free stack capture

**WF-201 — Capture state machine.** `searching → stable → encoding → captured → waiting_for_removal → searching`. A visible counter, sound and optional vibration acknowledge a captured photo. Announce identification separately. Provide manual shutter, undo last capture, pause, “another identical copy” and finish/review. Never deduplicate physical inventory solely by image similarity.

**WF-202 — Quality and resource budget.** Reuse current face guidance and compression. Run low-resolution sampling on-device and encode one best frame per encounter. Close tracks/workers on exit, stop on backgrounding and bound the queue's memory. Avoid uploading recorded video or invoking a paid identifier for every frame. Baseline behavior is capture → review/credit quote → identification; real-time paid identification would need a separate explicit session budget and stop control.

**WF-203 — Device evidence.** Test real iPhone Safari and Android Chrome with sleeves, reflective cards, repeated identical copies, fast removal, a held-still card, camera permission loss, rotation and a call/background interruption. A held card must not accumulate copies. A deliberate second copy must remain possible. Record dropped/multiple captures, time per 100 cards and false “captured” events.

## Phase 3: batch selling decisions

**WF-301 — Seller presets.** Save only meaningful seller inputs: eligible venues, shipping service/cost, packaging, relevant account tier and desired minimum profit. Reuse the tested fee functions; do not fork another fee calculator. Changes invalidate affected estimates.

**WF-302 — Batch estimate service.** Price only confirmed printings with source, age, currency and variant provenance. Reuse/cache catalog results and bound concurrent requests. Recalculate fees locally when inputs change. Display unavailable inputs and excluded venues; do not invent live buylist offers or sell-through data.

**WF-303 — Actionable outputs.** Sort by estimated net proceeds and show the assumptions. Suggest reviewing bundles when standalone shipping dominates; account for shared shipping/fees rather than adding single-card estimates. Let sellers set a minimum desired profit and derive an asking-price range. Show grading opportunities as an optional screen with cost/uncertainty, never auto-spend Grade credits.

**WF-304 — Evidence gate.** A fixed synthetic arithmetic matrix proves cents, thresholds, cash-out rules, shipping and unknown-input handling. A seller-reviewed sample checks whether recommendations are usable. Faster sale predictions remain unavailable until there is defensible sales/age evidence.

## Phase 4: first marketplace connection

Choose eBay first, subject to confirmed developer/seller access. This plan creates no seller connection or live listing.

**WF-401 — Access and account binding.** Confirm eBay Developer Program access, required user OAuth scopes, supported seller marketplace/currency, location and business policies. Store tokens server-side, encrypted with least access, never in the journal, browser storage or logs. Implement disconnect, revocation and account-switch protection before a publish button.

**WF-402 — Listing validation and photos.** Map confirmed identity to category/aspects and condition descriptors. Retrieve actual seller policies rather than guessing them. Check required images, quantity, price/currency and location. Seller-photo upload is a separate design/consent/retention milestone because the current photo model is local. Show the final listing preview and actionable missing requirements.

**WF-403 — Publish journal and reconciliation.** Assign a stable merchant SKU and retain offer/listing IDs. Create inventory, create/update offer, then publish. A timeout is “unknown”; query/reconcile the existing offer before any repeat publish. Handle each item in a bulk response independently. Respect provider rate limits and Retry-After. Begin with one marketplace; do not advertise automatic cross-listing yet.

**WF-404 — Quantity/order safety.** Import order lines with stable provider IDs, deduplicate events, reserve/decrement stock transactionally, handle cancellations/returns and reconcile missed updates. Actual marketplace state is authoritative. Cross-channel publication is a later gate because synchronization cannot eliminate every oversell race; define the inventory reservation policy first.

**WF-405 — Pilot release.** Sandbox failure-path tests, then one owner-authorized live listing with confirmed details/price, readback and agreed cleanup. Prove revoked auth, response loss, invalid policy, partial batch failure and an already-published offer do not create duplicates. No new listing fees or customer publications during ordinary development tests.

TCGplayer's public documentation currently states that it is not granting new API access. Therefore export/import compatibility is the baseline; direct TCGplayer synchronization remains access-dependent and must not be sold as committed functionality.

## Phase 5: actual profit and repeat use

**WF-501 — Sales-file import.** Start with explicit file schemas and preview all mappings. Record source plus transaction/line ID, preserve raw imported evidence with bounded retention and reject duplicates. Never deduplicate only by date/title/amount. Do not need buyer names/addresses for profit analytics.

**WF-502 — Sale linkage.** Match by merchant SKU/listing ID and physical-copy mapping. Unmatched sales go to review rather than an invented card match. Track gross receipts, refunds, marketplace fees, postage, packaging and cost basis separately, with currency and known/unknown status.

**WF-503 — Reconciliation.** Compute realized profit only from known actual components. Estimate missing fees only with a visible estimate label. Reimport/replay, partial sale, refund and return cannot double-count proceeds or silently restore stock. Keep a dated correction trail.

**WF-504 — Inventory follow-up.** Show stale listings, unsold stock and material estimated-net changes. Start with an on-demand dashboard and a limited watchlist. Scheduled price checks and user notifications require explicit opt-in, refresh budgets and a way to pause them. Do not poll every stored card continuously.

## Product and revenue policy

- Keep current prices, credit allocations, draft capacities and discounts while measuring the connected workflow. This plan grants no new entitlements.
- Free should demonstrate the complete useful single-card journey. Existing plan limits remain server authoritative.
- Paid value should come from larger reviewed batches, saved seller presets, reusable templates, batch decisions and eventually marketplace connections/reconciliation—not making users pay to read or recover their own records.
- Candidate packaging: Starter/Casual for lighter batch preparation; Pro for recurring seller workflow and batch decisions; Business for higher volume and future connected operations. Publish any new promises only when the matching feature is enabled and accepted.
- Do not promise unlimited paid inference. Meter provider work separately from inexpensive local organization/editing/export.
- Do not add a paid API contract before proving its coverage, per-success cost and effect on retention. Scrydex activation remains a separate provider/account/schema/budget decision.

## Cost and reliability controls

Capture/preflight runs locally. Reuse catalog/cache reads; preserve exact-printing evidence. Retry only bounded, recoverable operations with their original identity. Count failed/refunded provider attempts in operating cost. Retain known rate-limit responses and halt uncached work during provider cooldowns where appropriate.

Before paid acquisition, measure actual provider costs for fulfilled and failed work, reconcile invoices, include payment fees/refunds/credit obligations, and evaluate each tier under heavy legitimate usage. Server attempt logs alone are not a financial ledger. Account-level provider spending limits and an operational stop switch must be verified. No margin percentage is asserted from unmeasured usage.

Backups must cover durable collections, drafts, operation receipts and order mappings. Demonstrate restoration into an isolated environment; do not count “a backup exists” as a recovery drill. Browser-only photos and unuploaded sessions require an explicit device-loss warning and export/recovery path.

## Measurement and release gates

| Measure | How to establish it | Gate |
| --- | --- | --- |
| Exact accepted printing | Label a held-out set with name, set, number, finish and language; report accepted errors and abstentions separately | Proposed pilot target: ≥99% exact accepted matches, with coverage and sample size reported; never achieve this by hiding rejected cards |
| Workflow time | Same 100-card sample, same device/operator; include corrections, save and accepted export | Proposed goal: ≥30% less median hands-on time than the current CardResell workflow; measure competitor comparisons separately |
| Duplicates/lost records | Failure injection and restart/account/two-tab tests | Zero observed duplicate effects or lost confirmed copies in the acceptance matrix |
| Cost basis | Per-copy and whole-batch arithmetic, edits and splits | Exact conservation in cents; unknown remains unknown |
| Draft/export quality | Actual required fields and seller-account import | All accepted rows import; failed rows retain actionable errors |
| Provider cost | Attempts and actual invoice units, including refunds/failures | Report cost per 100 confirmed IDs and completed grades; owner accepts economics before scaling |
| Retention | Opted-in pilot cohorts, completed batches and repeat weekly use | Observe at least two weeks of repeat use before making retention claims |
| Recovery | Lost response, reload, quota, corrupt record, revoked auth, server conflict | Clear unconfirmed state and a tested reconciliation path; no blind new operation |

Start with a stratified 200–300-card benchmark covering the supported target games, duplicate copies, same-art reprints, foils, multiple languages, sleeves and poor photos. Publish the distribution and abstention rate. A single binder page is useful regression evidence, not a universal accuracy benchmark.

Telemetry should contain anonymous/session IDs, step durations, counts, version, failure category and provider-attempt outcome. Do not include photo bytes, tokens, raw email addresses, buyer addresses or free-form seller notes. Operational alerts must be bounded and actionable, not a stream of every provider response.

## Rollout and completion rule

1. Finish and verify the repository revision; keep the journal dormant.
2. Implement Phase 1 behind a default-off workflow flag, restricted to the existing pilot cohort. Rollback must leave sessions readable/exportable and preserve old draft/collection routes.
3. Run isolated automated checks, then owner phone/seller-account walkthroughs without manufacturing a provider outage or changing admission rules.
4. Measure workflow completion and cost. Fix the largest observed failure before widening the cohort.
5. Enable each later phase only after its own receipt/recovery and user-value gates pass.
6. Reconcile public pricing/features with enabled server capabilities before any paid campaign. Preserve the owner's pilot purchasing restriction until explicitly changed.

A feature is complete only when its normal UI path, authenticated server boundary, stored result, retry/recovery behavior, device acceptance and public description agree. A pure module, prototype screen, successful mock or deploy marked READY alone is not completion.

## First implementation handoff

### October 11 continuation: transactional storage and scan mapping

The next implementation slice is prepared on the same review branch and remains dormant. No production browser entry point imports these modules, no public feature claim or entitlement changed, and there are no new provider requests.

| Component | Implemented and locally verified | Still needed before enabling for sellers |
| --- | --- | --- |
| `shared/seller-workflow-store.mjs` | Real IndexedDB transactions; account-scoped records; compare-and-set revisions; resolves writes only after transaction completion; requests strict durability | Verified-auth lifecycle wiring, recovery UI, Safari/Android acceptance and device-loss/export guidance |
| Physical-copy reservations | Session and copy links commit atomically; unique Collection/instance identities per account; a second session cannot allocate new inventory IDs for an already assigned copy | Server-side validation of the owned Collection link; legacy draft recovery; deletion/tombstone integration |
| Corruption and storage failures | Corrupt/future records remain intact; list reports damaged records; quota/abort failures refuse success; no localStorage fallback | Recovery/export tooling and safe archive policy; never prune uncertain operations or release a deleted copy for replay |
| `shared/seller-workflow-scan.mjs` | Uses the existing scan copy/card helpers; keeps `inst_scan_<copyUid>`; allocates Collection IDs once within initialization; read-only planned-action projection | Actual scanner UI handoff and review screen; photo reattachment state; complete inventory payload mapping before cloud writes |
| Metadata and cost | No photos/tokens/URLs in the journal; unknown cost is distinct from zero; unchosen condition/finish/language stay unknown | Preserve additional catalog/sports evidence needed by existing inventory fields; explicit condition/printing review before execution |

The scan row's `variant` field currently carries pricing-source labels such as `usd` or `tcgplayer_live`. The adapter deliberately does not treat it as a foil/printing finish. Review must supply a real finish separately.

The store currently caps retained sessions at 25 per account/device. This is a safety bound for the dormant adapter, **not** a subscription allowance. Existing sessions stay readable at capacity; new sessions fail clearly. Archive/export and retention rules must be implemented before general activation. The browser can still lose local data through eviction, clearing or device loss; this is not cloud sync or a backup guarantee.

Verification for this continuation: `npm run workflow:check` passed (23 journal scenarios, 19 scan-mapping scenarios, 10 catalog checks and current evidence); `npm run workflow:browser` passed 22 real-Chromium scenarios using a persistent profile and the shipped scan helper functions. They cover full browser restart, two-tab initialization/revision races, account switching, immutable recovery, copy/Collection collisions, corrupt/future records, injected quota failure, request-success followed by transaction abort, the 500-copy technical envelope and bounded session capacity. Test registry (12 checks), configured build and diff checks also passed. No provider calls or customer writes were used. Quota is failure injection, not a physical device storage-exhaustion test. Chromium is not owner-phone acceptance.

Next task: connect the read-only review and verified-auth lifecycle, then WF-103 using the actual `/api/user-data` handler with isolated Redis. Persist pending before dispatch, retain the existing CAS/tombstone transport, distinguish on-device persistence from confirmed account sync, and verify the returned collection IDs. Extend canonical inventory metadata deliberately before connecting writes; never reconstruct missing sports/catalog fields from card names. Then connect the existing draft service and its generation/receipt recovery. WF-101/102 have tested library groundwork; their production integration and the end-to-end Phase 1 gate remain open.

Storage semantics references used during implementation:
- https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction
- https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction

## October 11 continuation: persisted review and market totals

The next review slice is implemented in `shared/seller-workflow-auth.mjs`,
`shared/seller-workflow-review.mjs` and its stylesheet. It remains **dormant**:
the production HTML/bundles do not import it, and the new shared assets are not
published by the static route configuration. The actual scanner helper functions
are exercised with the review DOM and real IndexedDB in browser acceptance.

- Resume account-scoped batches after reload, edit exact-printing/condition
  metadata, and explicitly confirm each physical copy. Editing identity or cost
  clears the previous confirmation. Unknown condition/finish/language stay blank.
- Keep unknown purchase cost distinct from zero. Parse decimal input as integer
  cents and sum with integer arithmetic, including the maximum safe per-copy
  cent value. Review pages show 25 copies at a time within the existing 500-copy
  technical envelope; this grants no plan entitlement.
- Bind local access to the existing Firebase SDK user and token subject. An auth
  generation invalidates even a switch away and back to the same account; late
  token/store callbacks cannot restore another account's screen. This is client
  session binding, not a replacement for authenticated server authorization.
- Export the latest validated metadata journal, excluding photos/tokens. This
  is not an import/restore feature or a full Collection backup. Corrupt/future
  records are retained and reported; raw damaged-record recovery is still open.
- Show local persistence truthfully. Pending/uncertain/blocked operations show
  **Needs recovery** and cannot be edited. The screen offers no Collection save,
  draft creation, billing or provider action yet.
- Finish the shared bulk market-value tracker: priced copies contribute even
  without purchase cost; quantities and genuine zero prices are retained;
  missing/invalid prices are identified; comparisons say above/below purchase
  cost, not realized profit. The percentage can exceed 100%, while only the bar
  width is capped. Updated immutable UI asset: `ui.34d2009e.js`.

Verification: 18 real-Chromium review scenarios, 6 auth-adapter scenarios and 9
market-total scenarios passed. Existing storage-browser scenarios (22), scan
mapping (19), journal (23), catalog evidence (10), bulk save failure (16), scan
hygiene (182), asset fingerprints (109), test registry (12) and the configured
build also passed. Review includes 320/390px portrait and 844px landscape,
two-tab revisions, reload, account races, injected quota failure, hostile text,
metadata export, safe-cent boundaries and 500-copy pagination. Browser screenshots
were visually inspected. Auth responses are synthetic; this is not phone or
real-account acceptance. Auth checks run in hosted foundation CI via
`workflow:check`; both browser suites are explicit `workflow:browser` gates.
The existing Collection handler also passed its 24-check isolated Redis suite;
those checks cover current snapshot/CAS behavior, not the future replay adapter.

**Next integration requirements (WF-103 / WF-106):**

1. Extend canonical saved metadata deliberately to retain existing grounded
   catalog IDs, rarity and sports/year evidence before constructing real
   Collection rows. Do not create a partial inventory record from the current
   review-only card whitelist. Identity edits must invalidate associated pricing
   and eligibility evidence when those adapters are attached.
2. Use `/api/user-data` with its CAS merge. Its current tombstones are bounded
   to 2,000 and expire after 90 days; they are insufficient by themselves to
   prevent an arbitrarily old batch replay from resurrecting a deleted copy.
   Design and test durable save receipts/copy retirement across that boundary,
   including tombstone expiry/compaction, before enabling session replay writes.
3. Persist the immutable pending operation before dispatch; verify the actual
   returned Collection ID and owned physical-copy link before confirming it.
   A lost response requires receipt reconciliation, not fresh entry IDs or
   restamped old records. Keep local persistence and cloud confirmation distinct.
4. Teach both Collection draft entry points and existing-draft lookups to use
   the validated scan-instance link; legacy rows retain `inst_col_<entryId>`.
   Integrate the existing bulk capacity/eligibility/generation/receipt path.
5. Mount the review through the normal scan UI behind a default-off pilot flag
   only after those server gates. Add complete normal-entry browser/isolated
   Redis acceptance, photo reattachment and owner-phone acceptance. Do not
   enable this module by simply adding a production import.

Planning estimate: about 25% of Phase 1 implementation is prepared. No part of
the new connected workflow is enabled for customers, and its end-to-end release
gate remains incomplete. This is an engineering estimate, not a test coverage
or production-completion percentage.

## Primary references checked October 11, 2026

- Shiny published collection/scanning features: https://www.getshiny.io/
- ManaBox scanning sessions, copies, bulk editing and version confirmation: https://www.manabox.app/guides/scanner/getting-started/
- Card Dealer Pro published inventory/listing integrations: https://www.carddealerpro.com/
- TCGplayer Pro scanning and pricing tools: https://seller.tcgplayer.com/pro
- eBay Inventory API prerequisites: https://developer.ebay.com/api-docs/sell/inventory/overview.html
- eBay offer publication requirements: https://www.developer.ebay.com/api-docs/sell/static/inventory/publishing-offers.html
- eBay order discovery: https://developer.ebay.com/api-docs/sell/static/orders/discovering-unfulfilled-orders.html
- TCGplayer API access status: https://docs.tcgplayer.com/docs/getting-started

Competitor feature descriptions are their published claims, not a head-to-head accuracy benchmark. Recheck API requirements at implementation time.
