# CardResell Plan and Roadmap

**Repository:** `/home/user/workspace/cardresell`  
**Verified:** 2026-09-06  
**Purpose:** Give a new contributor enough product, architecture, policy, roadmap, and operational context to work usefully without first reconstructing the project.

## How to read this document

This document distinguishes three kinds of statements:

- **Verified** means the statement was checked against the repository at the branch and commit recorded below.
- **Decided** means an audit or strategy document records an explicit product decision that current code does not contradict.
- **Unverified** means the repository cannot establish an operational fact, a third-party dashboard state, or a claimed past test run.

The repository is authoritative about implemented behavior. The planning documents are authoritative about intent only when the code does not disagree. When an old plan, audit packet, comment, or context brief conflicts with current code, **the code wins** and the conflict is called out.

No production calls or test suites were run while preparing this document. No repository file, branch, remote, or deployment was changed.

## Executive summary

CardResell is a solo-built trading-card seller application. Its durable product goal is:

> Scan a trading card, identify it, show what it is worth with source and uncertainty, recommend where to sell it and why, then help the seller list it for a fair price.

The scope is **trading cards**, not only trading-card games, because sports cards are already in scope. The intended categories include Pokémon, sports, Magic, Yu-Gi-Oh!, One Piece, and Lorcana (`audit/CARDRESELL_WHERE_WERE_GOING.md:12-26`).

eBay is the first connected venue because it is the first execution path, not because CardResell is meant to become an eBay-only client. The architecture models venue and strategy as a slot, keeps the authoritative draft record venue-neutral, and requires each publishable venue to have its own validation contract (`audit/CARDRESELL_WHERE_WERE_GOING.md:61-73`).

The repository currently contains the Phase 1 foundations, listing-packet logic, draft persistence, and the D1 Sell entry point. Block D is still in progress. The next intended unit is **D2.1, the user-facing all-drafts list**. The server already exposes a paged hydrated list, but there is no draft-list screen in the client; after creation the client only stores `window._crLastDraftId` and shows a toast (`js/core.d9e1b484.js:18388-18397`).

Deployment is on hold. Do not push, deploy, activate credentials, or infer production state without explicit owner authorization.

---

# 1. Product definition

## 1.1 The end goal

The frozen north star defines CardResell as “the seller's hub for trading cards” and commits the product to identification, disclosed valuation, venue recommendation, and selling execution (`audit/CARDRESELL_WHERE_WERE_GOING.md:12-18`). “Best place” is not simply the venue with the highest theoretical net. The intended recommendation considers net payout, liquidity, data confidence, and plural seller preferences such as speed, effort, risk, platforms already used, and minimum acceptable net (`audit/CARDRESELL_WHERE_WERE_GOING.md:28-53`).

The strategic wedge is graded-card selling. Slabs add certification-aware identity, grade-aware valuation, grading economics, and marketplace-specific listing requirements. The defensible chain is:

> Identification → raw/slab valuation → grading economics → marketplace economics → liquidity → seller-specific net → recommended action → listing execution → actual outcome → learning.

That rationale is recorded in `audit/CARDRESELL_WHERE_WERE_GOING.md:77-95`.

## 1.2 What Phase 1 is

Phase 1 is not connected publishing. Its intended user flow is:

1. Scan a card or select a saved collection row.
2. Choose **Sell**.
3. Receive a prepared listing containing a title, category and aspects, price, expected net, fee and shipping breakdown, condition guidance, description, and photo state.
4. Copy the prepared fields and continue in eBay's own flow.

There is deliberately no publish button and no eBay account connection in Phase 1. The seller completes the marketplace submission (`audit/CARDRESELL_WHERE_WERE_GOING.md:145-165`).

Phase 1 also states its limitations:

- Seller photos remain local to the device.
- Some marketplace fields must be completed on the marketplace.
- Marketplace restrictions must be surfaced before handoff.
- The seller still pastes or confirms fields; Phase 2 removes that work.

## 1.3 What CardResell is not

The following constraints are binding:

- No collection of marketplace passwords.
- No headless-browser listing automation.
- No reading seller dashboards through DOM automation.
- No circumvention of a closed partner API.
- No guessed marketplace descriptor value IDs.
- No second implementation of a business rule merely to make a new layer convenient.
- No publish button before Phase 3.
- No automatic publish in any phase; a person submits.
- No server storage of seller photographs in Phase 1.
- No new package manager, bundler, or framework migration without an explicit architecture decision.
- No high-cardinality telemetry fields such as card names, SKUs, prices, or user IDs.

The Phase 1 constraints are recorded in `audit/PHASE1_CHECKLIST_2026-09-05.md:533-554`; the durable product constraints are in `audit/CARDRESELL_WHERE_WERE_GOING.md:196-201`.

---

## 1.4 Why a scanner at all

The weak answer is "it is easier than typing." If that were the whole reason,
the scanner would be a convenience feature and could be cut. It is not, and it
cannot.

**1. The scanner exists to resolve identity, not to save keystrokes.**
A card's value does not hang off its name. It hangs off the exact printing:
set, collector number, rarity, variant, and edition. "Mew" is hundreds of
distinct products at wildly different prices; the Crown Zenith Galarian Gallery
GG10 is a different economic object from a base-set Mew, and a seller who types
the name has no way to know which one they are holding. This is why
`/api/scan` returns *candidates* rather than an answer, and why the user
confirms one before anything is charged (`api/scan.js:8`,
`api/scan-debit-id.js:3-5`). The scanner's product job is to collapse a
hundred plausible SKUs to one correct SKU. Everything downstream — price, fee
math, payout, listing title — is only as correct as that one decision.

The credit model is the tell. The system debits on *confirmation* of a
candidate and refunds when no candidates are returned
(`api/scan-debit-id.js`, `api/scan-refund.js:11`). CardResell charges for a
resolved identity, because the resolved identity is the thing of value.

**2. Identification cost is what decides whether a card is worth listing at
all.** This is the business argument and it is the one most easily missed.
Most cards in a real collection are worth a few dollars. The seller's cost per
card is dominated by human time, not by fees. If identifying and pricing one
card takes two minutes of manual searching, then a \$3 card is not worth
listing, and the seller rationally leaves the entire long tail of their
collection in a box. Drive identification toward a few seconds and the
profitability floor drops, which changes *which cards exist as inventory*. A
scanner is therefore not a faster path to the same outcome — it expands the set
of cards that can be sold at all. That is also why bulk and rapid-scan modes
are first-class rather than power-user extras.

**3. A scan is evidence of a specific physical copy; typing is not.**
Typing a name describes a catalog entry. A scan captures the copy in the
seller's hand at a moment in time. That distinction is load-bearing:
`_crScanInstanceId()` mints a fresh UUID per displayed scan so two scans of the
same product are not treated as the same physical card
(`js/core.d9e1b484.js:18269-18290`). Condition claims, listing photos (D7), and
not accidentally listing one card twice all depend on having an instance rather
than a product.

**4. It is also the largest accuracy liability in the system, which is the
reason it keeps getting audited.** Every other component can only be as right
as the identification it was handed. A misread collector number does not
produce a missing price — it produces a *confident, wrong* price, delivered to
a seller as a valuation. That failure mode is strictly worse than returning
nothing, and it is the direct reason for candidate confirmation instead of
auto-accept, for the recurring scan-accuracy audits, and for `/api/scan-miss`,
which records cards the scanner identified but the catalog could not match so
coverage gaps can be prioritized from evidence rather than guessed
(`api/scan-miss.js:1-11`). A residual bulk number-misread issue is still open
(§8.8); it is a correctness bug, not a polish item.

**Summary for a reviewer:** the scanner is the identity layer. Convenience is a
side effect. If a proposed change makes scanning faster but less certain about
*which* card it resolved, it is a net loss, and this project will reject it.

---

# 2. Repository and runtime architecture

## 2.1 Physical shape

This is a plain static web application plus Vercel serverless functions:

| Layer | Current implementation |
|---|---|
| Document shell | `index.html` |
| Main client application | `js/core.d9e1b484.js` |
| Supporting client bundles | `js/config.20ebe911.js`, `js/ui.6b3a528e.js`, `js/pwa.68032543.js`, `js/auth.5cf1cd22.js` |
| API | 55 JavaScript files directly under `api/` |
| Tests | 45 files directly under `tests/`; 26 registered suite slots in `tests/run-all.sh` |
| Deployment definition | `vercel.json` |
| Build system | None; there is no `package.json`, `node_modules`, or bundler |

`index.html` loads the five current bundles at `index.html:3514-3518`. Vercel maps `api/**/*.js` to Node serverless functions and the HTML and JavaScript files to static output (`vercel.json:3-21`).

The current main bundle is `core.d9e1b484.js`. Older review packets that name `core.f70d460f.js` describe an earlier checkpoint and are not current.

## 2.2 Client/server split

The browser owns:

- Camera and file interaction.
- Local photo quality checks.
- A catalog fast path for sufficiently distinctive Pokémon and Magic images.
- Presentation and selection state.
- The current single implementation of marketplace fee calculations.
- The current effective-price selection.
- Local collection storage and its best-effort cloud mirror.
- Calls to server-owned identity, eligibility, pricing, draft, auth, and payment APIs.

The server owns:

- Authentication and credit enforcement.
- Paid or quota-bearing scan work.
- Canonical identity normalization and listing readiness.
- SKU and title derivation.
- Listing packet structure and venue validation.
- Draft persistence, revision conflict control, idempotency, quotas, indexes, and tombstones.
- Third-party credentials and price-provider calls.

Policy belongs server-side when a malicious or stale browser could bypass it, when two client entry points must agree, or when later connected-marketplace work will rely on it. A client may decide what to display, but it must not be the only authority for whether a card can become a listing. The D1 client explicitly refuses to answer eligibility itself and asks `/api/sell-eligibility` (`js/core.d9e1b484.js:18011-18021`).

The fee model is the deliberate exception. The production implementation already lives in the large client bundle, and the inverse calls that same forward function. Moving or re-deriving it on the server now would create a second fee model. This leaves client-supplied draft price as a declared trust boundary, not as a solved boundary (`api/drafts.js:410-432`; `js/core.d9e1b484.js:18308-18331`).

---

# 3. How a card moves from scan to price to listing draft

## 3.1 Scan intake

The primary browser entry point is `processScanImage()` (`js/core.d9e1b484.js:13270-13299`).

The sequence is:

1. Validate the selected file and require a signed-in Google user (`js/core.d9e1b484.js:13270-13289`).
2. Show the preview and retain a local object/data URL for the current card (`js/core.d9e1b484.js:13313-13333`).
3. Run client photo-quality gates before a paid API call. Low resolution, blur, duplicate, and unreadable cases are refused; a QC runtime failure fails closed and says no credit was used (`js/core.d9e1b484.js:13335-13394`).
4. Try the client catalog fast path. A confident hit can identify the card without spending a scan credit; a miss falls through to the server (`js/core.d9e1b484.js:13397-13467`).
5. Compress the image and POST it with a bearer token to `/api/scan` (`js/core.d9e1b484.js:13471-13499`).

The server scan handler requires a verified token and ignores body-supplied identity, so a caller cannot choose another user's account for credit consumption (`api/scan.js:642-669`). It validates required images before debiting and enforces grade-mode photo requirements before paid work (`api/scan.js:676-725`). It dispatches grounding by card family—Pokémon, Magic, Yu-Gi-Oh!, Lorcana, One Piece, and sports—through `groundCardInfoByGame()` (`api/scan.js:625-635`).

## 3.2 Canonical card identity

`api/_cardIdentity.js` is the identity authority.

`identityReadiness(row)` normalizes the row's identity axes and returns one frozen answer containing:

- `sufficientForSku`: game, set, and number are present.
- `sufficient`: all SKU axes plus display name are present, and no alias conflict exists.
- `missingAxes`.
- `conflicts`.

The two booleans are derived from the same missing-axis list rather than implemented independently (`api/_cardIdentity.js:510-548`). `hasSufficientIdentity()` is only a thin SKU wrapper (`api/_cardIdentity.js:551-562`).

Product identity and valuation identity are intentionally different. Raw condition is outside the SKU but inside the valuation key, so a Near Mint and heavily played copy can be the same product without sharing a cached value (`api/_cardIdentity.js:564-621`).

## 3.3 Price retrieval and selection

After a card is selected, the client builds identity-specific query parameters and starts TCGplayer/TCGCSV, eBay-sold, and PriceCharting requests in parallel (`js/core.d9e1b484.js:2280-2355`).

The source roles are:

- `/api/tcg-price` chooses a TCGplayer market value derived from completed sales when available. Active low, mid, and high asks are not treated as the same quantity as market (`api/tcg-price.js:555-583`).
- `/api/pricecharting` resolves a PriceCharting product and returns one selected raw or graded guide value plus the complete grade-price map. Sports cards use the sister `sportscardspro.com` catalog (`api/pricecharting.js:439-490`).
- `/api/ebay-sold` is intended to add measured sold comps. Current client comments record that the production path returns 403, but that runtime state was not re-tested for this document (`js/core.d9e1b484.js:3794-3806`).

Every displayed price should distinguish when CardResell retrieved it from when the provider dated it. The client knows retrieval time but PriceCharting does not provide a source “as of” date, so the UI says “retrieved” and “no price date” rather than inventing freshness (`js/core.d9e1b484.js:1715-1739`, `1818-1849`).

For raw cards, condition multipliers are:

| Condition | Multiplier |
|---|---:|
| Near Mint | 1.00 |
| Lightly Played | 0.85 |
| Moderately Played | 0.65 |
| Heavily Played | 0.45 |
| Damaged | 0.25 |

Graded variants force the multiplier to 1.0 because grade already expresses condition (`js/core.d9e1b484.js:4571-4601`). The current UI also hides the raw-condition control for sports cards and graded variants (`js/core.d9e1b484.js:4555-4569`).

When there is no measured low/high book for a selected basis, Quick Pricing creates a disclosed estimate at comp −15%, comp, and comp +15%. The source labels explicitly say this is derived rather than observed (`js/core.d9e1b484.js:3794-3841`).

## 3.4 Why disagreeing sources are shown and not averaged

CardResell shows TCGplayer and PriceCharting as distinct measurements. It does not turn disagreement into an average.

The reason is epistemic, not cosmetic:

- An average would be a third number that neither provider reported.
- The feeds do not provide enough condition-level detail to relabel either value as a precise Near Mint quote.
- A seller needs to know which source underlies the payout calculation.

The current code says TCGCSV has no condition-level SKU and PriceCharting raw is an ungraded/loose blend; it therefore states that neither source is a condition-graded Near Mint quote (`js/core.d9e1b484.js:1741-1757`, `1809-1812`).

**The disclosure is WITHDRAWN as of 2026-09-04 and is not rendered anywhere.** What follows
describes code that exists and does not run.

The detection thresholds are `_sourceDisagreement` (`js/core.d9e1b484.js:1767`): both values
exist, the higher is at least $20, and the ratio is outside 1.5× in either direction. The
renderer `_renderSourceDisagreement` (`:1784`) names both sources, shows both values, and names
the basis used for payout.

Neither function is called. `_renderSourceDisagreement` appears exactly once in the bundle —
its own definition — and `_sourceDisagreement` appears twice: its definition and a mention
inside the withdrawal comment at `:1910-1922`. The withdrawal comment states that detection is
"still exercised by tests"; **that is not accurate.** The only test is a regex asserting the
string `function _sourceDisagreement` appears in the bundle text
(`tests/launch-audit-regressions.mjs:1664`), which would pass if the body were `return null`.
The label has been corrected to say what it checks.

**What the withdrawal costs, recorded on purpose:** when the two feeds disagree by more than
50%, the seller sees only the basis we picked, with no statement that the other source says
something very different. Both numbers are still rendered separately and neither is averaged
into the other, so §5.4's actual prohibition — do not average — holds. What is missing is the
explicit statement of disagreement.

**Decision (2026-09-06): the disclosure returns to the card detail view, in its own unit.**
Rationale and scope in `audit/DECISION_SOURCE_DISAGREEMENT.md`. It is not in D2.1's scope.

This corrects the roadmap context brief. Its statement that TCGplayer is “Near Mint only” is not what the current client claims. **Code wins:** do not describe the TCGplayer figure as a Near Mint quote without new provider-level evidence.

## 3.5 Sell eligibility

The card-panel and collection entry points use one client transport, `fetchSellStamps()`, to call `/api/sell-eligibility` (`js/core.d9e1b484.js:18110-18155`).

The browser sends an allowlisted wire projection, not the whole row. This keeps base64 thumbnails and future private fields off the request. A permanent test compares the client field list with the server schema because a silent allowlist drift would make valid cards fail (`js/core.d9e1b484.js:18044-18090`).

The server:

- Requires auth.
- Refuses batches over 500 rather than truncating.
- Calls the shared identity readiness implementation.
- Returns one positional stamp per input row.

The card-panel gate binds each response to a render generation and auth token so a slow response for card A cannot enable Sell on card B (`js/core.d9e1b484.js:18024-18042`, `18199-18250`).

## 3.6 Draft creation

The client currently hardcodes the D1 route to `ebay:fixed-price` and calls one shared `_crCreateDraft()` from both scan and collection entry points (`js/core.d9e1b484.js:18293-18300`, `18357-18383`).

For an unsaved scan, `_crScanInstanceId()` mints a fresh UUID for each displayed scan and reuses it for a double tap on that display. Two separate scans of the same product therefore do not claim to be the same physical copy (`js/core.d9e1b484.js:18269-18290`).

The create request sends:

- The card row.
- An opaque physical-copy `instanceId`.
- A venue/strategy slot.
- Price when one exists.
- Explicit price source when one exists.
- A required idempotency key.

It does **not** send a client-authored SKU or title. The server derives both through `skuFor()` and `buildListingTitle()` and refuses callers that try to set them (`api/drafts.js:410-490`).

An identified card with no available comp is allowed to become an unpriced draft. Missing price is a normal incomplete state and produces `SLOT_PRICE_REQUIRED`; zero is a present value and can be refused separately by the venue's slot rules (`api/_draftStore.js:267-294`, `430-474`).

`createDraft()` refuses unknown slot names before quota, idempotency, index, or record side effects; reserves the 500-draft cap atomically; writes the authoritative record before indexes; reports index degradation without claiming the save failed; and returns publish-readiness as information (`api/_draftService.js:171-266`).

The API has no publish path. It provides authenticated GET, POST, PATCH, and DELETE for drafts, with required idempotency on create and required expected revision on edit/delete (`api/drafts.js:14-38`).

## 3.7 Listing packet

The packet builder lives in `api/_listingPacket.js`; it composes canonical identity, SKU, title, category and aspects, condition, metadata, and validation findings (`api/_listingPacket.js:315-445`).

Title assembly lives in `api/_listingTitle.js` and drops complete low-priority segments to fit the venue limit rather than truncating a word in half (`api/_listingTitle.js:97-165`).

Condition behavior is intentionally conservative:

- A raw card is “Ungraded”; the seller selects actual condition. The code does not convert an estimated scan grade into a marketplace condition claim (`api/_conditionDescriptors.js:60-89`).
- A graded card carries grader, grade, and cert intent, but unresolved eBay descriptor IDs remain unresolved.
- `buildConditionPayload()` refuses to emit an API payload while descriptor values are unresolved rather than guessing an accepted ID (`api/_conditionDescriptors.js:92-193`).

This is what “do not stamp a lie” means in executable form.

---

# 4. Draft architecture and invariants

## 4.1 Record authority

The draft record is authoritative. Secondary indexes are rebuildable and may degrade without converting a successful record write into a failed save (`api/_draftIndex.js:58-66`; `api/_draftService.js:242-266`).

Draft storage provides:

- Required idempotency with request fingerprints.
- Optimistic concurrency through monotonic `rev`.
- Tombstones so stale writes cannot resurrect deleted drafts.
- A strict active-draft cap of 500 through atomic reservation.
- A reserved synthetic test namespace.
- Explicit degraded/unavailable states rather than an empty-list lie.

Edits require the revision the client read; a mismatch refuses the write rather than silently overwriting another device (`api/_draftStore.js:477-513`).

Live draft records are not assigned an expiration in the store. Deleted tombstones have a 90-day TTL (`api/_draftStore.js:517-544`, `827-853`). Draft indexes have a 180-day TTL and are designed to be reconciled from authoritative records (`api/_draftIndex.js:24-27`, `58-66`). Therefore the old “no draft TTL” product decision still holds for records even though indexes and tombstones have maintenance TTLs.

## 4.2 List contract already available server-side

The default `GET /api/drafts` returns a hydrated page; `?ids=1` preserves the internal bare-ID form. Invalid paging values are refused rather than silently coerced. Default page size is 25 and maximum is 100 (`api/drafts.js:117-172`; `api/_draftService.js:479-535`).

Pagination sorts IDs lexically, then uses a **numeric offset cursor** into that order. Rows are sorted by recency only inside the selected page, so editing a draft does not move it across page boundaries (`api/_draftService.js:535-550`). This stability claim is about edits; creation or deletion can still change the ID set between requests.

Unreadable, too-new, failed-read, and vanished records can appear as explicit stub rows. A failed read is not treated as evidence that a seller's work does not exist (`api/_draftService.js:456-490`).

The current summary rows contain identity, status, revision, title, price, quantity, timestamps, and `hasPacket` (`api/_draftService.js:493-512`). They do **not** contain `publishable` findings. D2.1's requirement that “Needs price” be server-derived cannot be satisfied honestly from the current page response alone. D2.1 must either:

1. extend each server summary with the relevant validation state/findings, or
2. read each full draft by ID and use the server's `publishable` result.

Adding `if (!row.price)` in the browser is not acceptable.

---

# 5. Working rules and why they exist

## 5.0 Where these rules came from, and how to work with the owner

The rules below are not style preferences imported from a handbook. Each one is
scar tissue. A reviewer who treats them as negotiable will spend their credibility
re-arguing a settled question.

The recent commit history is the evidence, and it is worth reading before
proposing anything:

| Commit | What it fixed | Which rule it bought |
|---|---|---|
| `f0324d4` | Sufficiency was being decided in more than one place; `$0` was being treated as a missing price | One behavior, one implementation |
| `781a265` | Hashed bundles are served `immutable` for a year, so changed bytes under an old filename mean cached clients keep running old code against a new backend | Rename on every byte change; guard it in CI |
| `a202a27` | A fee test selected its bundle by directory order, so it could silently grade the wrong file | A test that can pass against the wrong artifact is not a test |
| `11cb952` | Two functions both wrote `style.display` on the raw-condition pills, so the winner depended on call order | One behavior, one implementation |

Note the shape of the last one: the prices were never wrong. The defect was that
the UI solicited a click it had already decided to discard. **Correct arithmetic
is not sufficient; the interface must not imply a control matters when it does
not.**

Working context a new contributor should know:

- The project is built by one non-professional developer who tests heavily in
  production and in incognito, often from a phone. Mobile reality and coarse
  pointer targets are not afterthoughts.
- Two AI reviewers audit this work in parallel. Their suggestions are always
  checked against the actual codebase and never adopted verbatim. They have
  caught real defects, including the immutable-bundle bug above and a wrongly
  claimed persistence behavior. They have also produced confident, wrong claims.
  **Being cited is not being right.** Bind every claim to a file and line.
- The owner's stated preference: "feel free to ask questions or bring up ideas
  just make sure everything is in the doc so I can copy it over." Deliverables
  are self-contained documents, not chat threads.
- A known live risk against rule 1 is still open at the time of writing: two
  grading-cost models coexist (see §8.4). It has not been fixed, and it should
  not be described as fixed.

## 5.1 One behavior equals one implementation

**Rule:** A business fact has one owner. Other layers translate or call it; they do not reimplement it.

**Why:** Two copies can agree today and still be a latent defect. The user-visible symptom appears later: a button enables an action the API refuses, a displayed fee differs from checkout math, or one row shape behaves differently from another.

**Current examples:**

- Listing readiness is computed by `identityReadiness()` and consumed by both the Sell stamp and draft create path (`api/_cardIdentity.js:480-548`; `api/drafts.js:449-462`).
- Both Sell entry points use one `_crCreateDraft()` implementation (`js/core.d9e1b484.js:18357-18383`).
- Target-net inversion calls the existing forward `feeEbay()` calculation instead of reconstructing a second fee formula (`js/core.d9e1b484.js:6450-6499`).
- Draft request normalization belongs in `api/drafts.js`; the idempotency layer asserts canonical input instead of coercing it again (`api/drafts.js:22-33`).

The git history records why this is cultural rather than theoretical. Commit `f0324d4` consolidated sufficiency in one place, and commit `779cf55` renamed the static drift check as a tripwire rather than proof. The current comments state that four regressions had the duplicated-readiness shape (`js/core.d9e1b484.js:18014-18019`).

## 5.2 Do not stamp a lie

**Rule:** Do not attach a label, timestamp, provenance, identity, or marketplace value that the evidence does not support.

**Why:** A missing or unresolved value is recoverable. A plausible wrong value is trusted, copied, cached, or eventually published.

**Current examples:**

- PriceCharting retrieval time is not presented as the provider's price date (`js/core.d9e1b484.js:1715-1739`).
- A manual price is attributed to `seller`; a missing source is never defaulted to seller (`api/drafts.js:503-510`; `api/_draftStore.js:456-467`).
- Raw card condition remains the seller's choice (`api/_conditionDescriptors.js:64-89`).
- Unresolved eBay descriptor IDs block payload generation rather than being guessed (`api/_conditionDescriptors.js:173-193`).
- An unreadable draft remains an explicit row instead of disappearing (`api/_draftService.js:462-490`).
- A new scan receives a new instance UUID instead of hashing product identity into a false physical-copy identity (`js/core.d9e1b484.js:18269-18290`).

## 5.3 Fix the function, not the label

**Rule:** If target-net inversion misses by more than $0.05, fix the calculation. Do not relax or rewrite the UI claim.

**Why:** The seller acts on net proceeds. Copy changes cannot make incorrect arithmetic true.

The inverse seeks the lowest list price that clears the target, then recomputes achieved net through `feeEbay()` (`js/core.d9e1b484.js:6459-6475`). It handles the non-monotonic $10 order-fee step as separate continuous branches rather than assuming pure bisection over a smooth function (`js/core.d9e1b484.js:6466-6494`). The roadmap makes the nickel round trip and cent-level displayed reconciliation permanent gates (`audit/PHASE1_CHECKLIST_2026-09-05.md:438-478`).

## 5.4 Disclose disagreement; do not average it away

**Rule:** Keep source-specific values, show disagreement, and name the basis used.

**Why:** An average of incompatible measurements creates false precision. Accuracy matters more than matching a competitor's simpler headline.

The threshold and renderer exist at `js/core.d9e1b484.js:1767` and `:1784`. **The renderer is
withdrawn and neither function is called** — see §3.4 for the corrected state, the cost, and the
routing decision.

The rule as stated is still satisfied in its load-bearing half: source-specific values are kept
and shown separately, and nothing is averaged. The unsatisfied half is the explicit disclosure
of disagreement.

## 5.5 Never invent liquidity, freshness, or timing

Do not manufacture sell-through rates, days-to-sale ranges, source dates, or “updated daily” text. The price caption deliberately removed an unverified “Updated daily” fallback (`js/core.d9e1b484.js:1818-1849`). If liquidity data is unavailable, say so.

## 5.6 Refuse rather than silently truncate or coerce

- Oversized eligibility batches are refused by the server; the client chunks them (`js/core.d9e1b484.js:18116-18131`).
- Invalid draft paging parameters return 400 instead of quietly turning into defaults (`api/drafts.js:143-160`).
- Unsupported slots are refused before side effects (`api/_draftService.js:174-195`).
- Client-supplied derived SKU/title are refused rather than ignored (`api/drafts.js:434-481`).

This makes caller defects visible and keeps retries explainable.

## 5.7 Fail closed on authority and paid work

No stamp means no Sell button (`js/core.d9e1b484.js:18014-18021`). Photo QC failure means no paid scan (`js/core.d9e1b484.js:13381-13394`). Invalid auth cannot spend another account's credits (`api/scan.js:645-669`).

## 5.8 “Under maintenance,” not “beta”

User-facing unfinished states are described as under maintenance. The product does not use “beta” as a substitute for a precise limitation. The tool/wrench icon is the approved visual language for the in-progress listing workflow, but contributors should not add decorative emoji elsewhere.

## 5.9 Do not deploy without authorization

No push, deployment, environment change, secret activation, or production smoke run occurs without explicit owner permission. The configured Vercel production branch is currently unverified, so do **not** rely on the context brief's claim that pushing `main` necessarily deploys production.

---

# 6. Roadmap

The roadmap uses phases for seller capability and blocks for current Phase 1 implementation. Dates are intentionally omitted; current uncertainty does not support calendar promises.

## 6.1 Product phases

| Phase | Seller capability | Entry criteria |
|---|---|---|
| 0 | Scan, identify, price, grading ROI, fee math | Existing client and pricing APIs remain truthful and regression-covered. |
| 1 | Sell → complete copy-ready listing finished on eBay | Blocks A-E complete; D2 list and D3 review work; every number has provenance; no publish path; local-photo limitation explicit. |
| 2 | Connect eBay and create a real marketplace draft | Official user OAuth verified; credential rotation complete; live gate 19/19; descriptor value IDs resolved from user-scoped policies; token storage/deletion contract reviewed. |
| 3 | Human-triggered publish from CardResell and order/outcome visibility | Phase 2 reliable; hosted photo storage provisioned with retention/deletion rules; publish validation complete; explicit human submit remains. |
| 3.5 | Execute on a second venue | Second venue has its own OAuth/API feasibility, slot contract, validation, and outcome measurement; no borrowing eBay rules. |
| 4 | Bulk execution | Single-card identity, review, idempotency, and recovery proven at production scale. |
| 5 | Exports for other platforms | Stable venue-neutral packet/export schema and explicit per-destination limitations. |
| 6 | Public storefronts | Listing and inventory lifecycle mature enough to expose public seller state safely. |

The phase sequence is the frozen product roadmap (`audit/CARDRESELL_WHERE_WERE_GOING.md:122-141`).

## 6.2 Phase 1 blocks: verified now/next/later

> **The basis of this column has not been checked (2026-09-08).** The statuses
> below were assigned on the strength of code existing and suites passing.
> Two reachability sweeps (`audit/d3/LANE_A_STEP1_PACKET.md` §10) found that
> those two things do not establish that a seller can reach the behaviour:
> `listPriceForTargetNet` has 25 test calls and, across every commit in
> history, no production call site; `buildListingPacket` had no caller until
> `3db7169`; and the packet's output is still discarded before it reaches HTTP.
> Block B is the demonstrated case and is marked **Implemented** here.
>
> Every status in this table therefore inherits that doubt until a per-block
> reachability pass runs. **The prior "roughly 80–85% implemented" estimate is
> withdrawn pending that pass** — not revised downward, withdrawn, because the
> sweeps invalidated its basis without establishing a replacement. Do not quote
> a Phase 1 percentage from this document until the pass is recorded.
>
> **Update, same day:** a provisional **75-80% seller-reachable** was offered
> on review, then **withdrawn by the reviewer.** Both percentages are now
> superseded estimates: 80-85% (owner, basis unchecked) and 75-80% (reviewer,
> an adjustment of that same unchecked basis). Withdrawing the basis withdraws
> both, so neither is a current figure and neither may be quoted forward.
>
> **There is no current Phase 1 percentage.** Progress is measured against the
> seller workflow and the original Phase 1 requirements. See
> `audit/d3/LANE_A_STEP1_PACKET.md` section 13 for the record of both figures,
> and section 11b for the defect that showed why the packet block's
> seller-reachable contribution was zero rather than partial.

| Block | State | What is present | Exit or next-entry criterion |
|---|---|---|---|
| A — Foundations | **Implemented** | Canonical identity, SKU/valuation distinction, inventory instance helpers, draft indexes, idempotency | Keep golden identity tests and server authority intact. |
| B — Packet | **Implemented, with external fields gated** | Title, taxonomy/aspects, condition intent, target-net inverse, metadata/schema | Do not claim API-ready eBay condition payloads until user-scoped IDs are resolved. |
| C — Drafts | **Implemented** | Authenticated CRUD, revisions, idempotency, authoritative records, rebuildable indexes, 500 cap, tombstones, paged list | Real-KV behavior remains a gated test and must pass before release. |
| D1 — Sell entry | **Implemented and reviewed** | Server-owned eligibility, card and collection entry points, one create transport, unpriced drafts | Preserve gate/create parity and response generation binding. |
| D2.0 — Readiness consolidation | **Implemented** | One `identityReadiness()` owner; `$0` distinct from absence; drift tripwire | Do not add a client or endpoint-local sufficiency formula. |
| D2.1 — Draft list UI | **Next** | Server paging and summary primitives exist; no client screen exists | Resolve summary/findings gap; implement All drafts; stubs, paging, degraded/unavailable states, 44×44 targets; navigate by returned ID. |
| D3 — Review screen | **Later in Block D** | Packet and draft read primitives exist | D2 navigation stable; render every missing field by server reason; fee breakdown reconciles to cent. |
| D4 — Number provenance | **Later in Block D** | Price-source primitives exist, but full review presentation does not | Provider, source URL, absolute retrieval time, fee revision, and seller/manual attribution visible. |
| D5 — Copy-ready handoff | **Later in Block D** | No complete handoff screen | One-tap field copying and eBay continuation; no publish control. |
| D6 — New-seller warning | **Later in Block D** | Not verified in current client | Show before handoff when applicable; do not invent eligibility. |
| D7 — Local photos | **Later in Block D** | Scan-local photos exist; listing-photo workflow not complete | Ordered local photo state, validation, removal, and cross-device limitation copy; no server upload. |
| E — Gates and telemetry | **Partially present, not closed** | Many offline suites, asset test, prod smoke slot, existing events rail | Required local, real-KV, browser, hosted cache, live eBay, numerical, and funnel gates pass in the authorized environment. |

The D block definitions are in `audit/PHASE1_CHECKLIST_2026-09-05.md:248-269`. D2.0 and the pinned D2.1 invariants are at `audit/PHASE1_CHECKLIST_2026-09-05.md:291-365`.

## 6.3 D2.1 non-negotiable contract

D2.1 must:

- Use labels **Drafts** and **All drafts**, never Recent or Latest.
- Page through lexically sorted draft IDs with the server's numeric offset cursor.
- Apply recency ordering only within a page.
- Never infer the newly created draft from `rows[0]`; use the returned `draftId`.
- Render unreadable, too-new, failed-read, and vanished rows with an actionable explanation.
- Show unavailable and degraded states honestly.
- Derive **Needs price** from server validation findings, not `if (!price)`.
- Treat idempotent replay as success and open the existing draft.
- Use 44×44 targets for coarse-pointer actions.

The frozen requirements are recorded in `audit/PHASE1_CHECKLIST_2026-09-05.md:271-289` and the server paging implementation is at `api/_draftService.js:456-550`.

---

# 7. Current repository state

## 7.1 Git state verified on 2026-09-06

| Fact | Verified value |
|---|---|
| Current branch | `phase1-block-d` |
| HEAD | `11cb952` |
| `origin/main` | `9aaf326` |
| Commits reachable from HEAD but not `origin/main` | 29 |
| Working tree | Clean |
| Local `main` | `f0324d4`, ahead of `origin/main` |
| Remote `phase1-block-d` | Not present |
| Recovery ref | `refs/recovery/pre-scrub-c2366b2` exists |

These values came from read-only `git status`, `git branch -avv`, `git rev-list`, `git rev-parse`, `git log`, and `git show-ref`. They are not file-line facts and will age as soon as the branch changes.

The last five commits are:

1. `11cb952` — Stop offering a condition control that a slab ignores.
2. `a202a27` — Stop fee tests choosing a bundle by directory order.
3. `781a265` — Name the bundle after its bytes and guard it.
4. `779cf55` — Call the drift guard a tripwire, not proof.
5. `f0324d4` — D2.0 readiness consolidation and zero-price distinction.

## 7.2 What the registered suite enforces

`tests/run-all.sh` registers 26 numbered slots:

1. Asset fingerprints.
2. Inline `<script>` syntax.
3. Auth integrity.
4. Scan-miss regressions.
5. Deep-link and companion-link behavior.
6. Copy truth.
7. Fee truth.
8. Stripe webhook P0 behavior.
9. Launch-audit regressions.
10. Variant selection.
11. Sports price guard.
12. Quick Pricing and headline price.
13. Sports parallel matching.
14. Scanner fast path and miss logging.
15. Offline eBay auth and taxonomy.
16. Card identity and SKU.
17. D1 eligibility.
18. Sell response ordering and wire size.
19. Listing packet, title, condition, target net, and metadata.
20. Draft index recovery and packet schema.
21. Draft store revisions, tombstones, and schema.
22. Draft CRUD.
23. Draft list, cap, paging, and severity.
24. Real-KV draft persistence, gated.
25. Production endpoint smoke, enabled by default unless `--local`.
26. Browser condition-applicability interaction, gated.

The registration is visible at `tests/run-all.sh:30-248`.

Important limits:

- Slot 24 runs only with `DRAFT_KV_LIVE=1` and KV credentials (`tests/run-all.sh:214-223`).
- Slot 25 calls `https://www.cardresell.org` by default and is skipped only with `--local` (`tests/run-all.sh:14-20`, `225-236`).
- Slot 26 runs only with `COND_PILLS_BROWSER=1` and a served `SITE_BASE` (`tests/run-all.sh:239-248`).
- `tests/ebay-live.mjs` is **not** registered in `run-all.sh`.
- Several dated audit tests are present but unregistered.
- The syntax slot checks inline scripts; it is not a substitute for `node --check` on changed external JavaScript (`tests/run-all.sh:38-43`).

The context brief says the 26-slot suite last exited 0. That execution was not independently verified because no durable run log was found and this review was forbidden to run the suite. Treat it as an audit report, not current evidence.

## 7.3 What is gated or absent

- The real-KV suite is opt-in.
- The browser interaction suite is opt-in.
- The live eBay harness is separate and reportedly at 18/19; this was not re-run.
- There is no D2 draft-list client UI.
- There is no D3 listing review screen.
- There is no Phase 1 publish path by design.
- There is no user-token OAuth or API-ready eBay condition payload.
- There is no server-side seller-photo persistence.
- The active production deployment SHA, configured production branch, Preview environment secrets, Preview KV isolation, and domain routing are unverified.

---

# 8. Known defects, open decisions, and unverified operations

Nothing in this section is solved merely because it is documented.

## 8.1 Mandatory credential work

**Mandatory:** Rotate the eBay Cert ID. Audit records state that it was exposed in plaintext in a prior conversation. No repository inspection can prove dashboard rotation, and the audit explicitly says rotation remains open (`audit/D2_0_ASSET_FINGERPRINT_RETURN_PACKET.md:326-335`).

Do not print credential values, fragments, or unblock URLs into code, fixtures, logs, or documents. Rotation must include:

1. Create/activate the replacement in the authorized secret store.
2. Verify the new credential.
3. Verify the old credential is retired.
4. Check issued-token implications rather than assuming secret rotation invalidates every token.
5. Record only status, checker, and time.
6. Remove the local recovery ref only after rotation and clean-history confirmation.

## 8.2 Pending owner decision on commit history

Commit `94dc777`'s message contains small fragments of real eBay identifiers. The audit found no full outgoing credential, but it leaves two owner choices:

- Push history as-is, accepting that the fragments are not authenticating material.
- Rewrite the message, which changes every descendant commit SHA and requires all review, hashes, and tests to be rerun against the new tip.

No rewrite has been performed and no owner decision was found (`audit/D2_0_ASSET_FINGERPRINT_RETURN_PACKET.md:210-219`, `326-338`). Do not silently choose.

## 8.3 eBay live and dashboard gates

Open and unverified:

- The live harness is reported at 18/19; release requires 19/19.
- Which Git branch Vercel treats as Production.
- The active production deployment SHA.
- Whether a feature-branch push produces Preview and at which URL.
- Whether Preview receives live eBay secrets.
- Whether Preview reads production KV.
- Current domain routing and installed integration/webhook state.

The most important question is whether Preview can use live eBay credentials against production data (`audit/D2_0_ASSET_FINGERPRINT_RETURN_PACKET.md:326-335`).

## 8.4 Pricing and grading defects

### Duplicate grading-cost behavior

The client grading-upside panel uses a flat `$25` grading fee and 13% selling fee (`js/core.d9e1b484.js:10923-10927`, `10963-10976`). The server grading-opportunity endpoint uses grader- and value-tier-specific costs: BGS 50, CGC/SGC 18, and PSA 25/50/100 by raw value (`api/grade-opportunity.js:44-52`).

This is a direct “one behavior, two implementations” defect. Do not reconcile it by changing labels. Choose one owner and route both features through it.

### eBay sold comps

Current client comments say the production `api/ebay-sold.js` path returns 403 (`js/core.d9e1b484.js:3794-3806`). That live failure was not independently rechecked. Until a live gate proves otherwise, do not present eBay sold as an available measured spread.

### PriceCharting permission

Audit notes say a permission email was sent on 2026-09-03 and no reply had arrived. The repository cannot verify email state. Treat this as unverified external status.

### Stale-quote threshold

The warning tier exists, but code comments say no stale-quote hours rule was added because the threshold is a product decision, not a value to invent (`api/_draftStore.js:312-318`). The owner still needs to choose evidence and a threshold.

### Consensus versioning

`cardresell-consensus` is an allowed valuation source (`api/_cardIdentity.js:583-598`), but a versioned `cardresell-consensus-v1` composition remains deferred. Do not cache a vaguely defined aggregate as though its composition were permanent.

## 8.5 Draft and Block D gaps

- **No draft-list UI.** Creation ends in a toast and remembered ID (`js/core.d9e1b484.js:18388-18397`).
- **List summaries lack validation findings.** D2.1 cannot honestly derive “Needs price” from the current summary alone (`api/_draftService.js:493-512`).
- **No atomic one-active-draft-per-instance-and-slot rule in `createDraft()`.** Idempotency prevents a repeated request key from duplicating work, but a different key can create another draft for the same instance and slot. The Phase 1 checklist requires atomic enforcement in D2 (`audit/PHASE1_CHECKLIST_2026-09-05.md:271-289`).
- **The server accepts more slots than the Phase 1 UI exposes.** The client hardcodes `ebay:fixed-price`, but `SLOT_RULES` currently recognizes eBay auction, Mercari fixed-price, Whatnot auction, and TCGplayer fixed-price too (`api/_draftStore.js:109-121`). `createDraft()` accepts any key in that registry (`api/_draftService.js:174-195`). Therefore “eBay fixed-price is the only Phase 1 slot” is true of the client, not of the API boundary.
- **Stale comment:** the earlier client comment at `js/core.d9e1b484.js:18163-18178` says the scan token is derived from identity fields, while the later implementation correctly mints a UUID at `18269-18290`. Update the misleading comment when that area is next edited.
- **Four older auth token-refresh copies remain.** `_crIdToken()` avoids creating a fifth but does not retrofit the existing call sites (`js/core.d9e1b484.js:18093-18108`).

## 8.6 Collection gaps

Collection is localStorage-first:

- `loadPortData()` reads the user-scoped portfolio key.
- `savePortData()` writes localStorage and schedules a best-effort `/api/user-data` mirror.
- Network sync is skipped when signed out and errors are silent.

See `js/core.d9e1b484.js:16564-16619`.

The current Collection view has no verified Edit action. Saved rows persist; unsaved in-memory changes do not. Do not describe Collection as server-authoritative.

## 8.7 Accessibility

An audit reports `--text-faint` contrast at 1.90:1 across roughly 61 uses. This measurement was not recomputed for this document. Treat it as an open audit finding that needs a focused contrast check rather than as a newly verified count.

## 8.8 Deferred work

Deferred items include:

- Scanner polish.
- Volatility-banner design.
- Bulk number-misread residuals.
- Full `_crIdToken()` consolidation.
- Versioned consensus composition.
- Remaining launch punch-list items.
- Production photo hosting and its privacy/retention work.

Deferred means intentionally not current, not solved.

---

# 9. Contradictions resolved during this verification

| Prior claim | Current evidence | Resolution |
|---|---|---|
| TCGplayer Market is a Near Mint-only quote | Client explicitly says TCGCSV lacks condition-level SKUs and neither TCGplayer nor PriceCharting is condition-graded (`js/core.d9e1b484.js:1748-1757`, `1809-1812`) | **Code wins.** Do not label either as Near Mint. |
| Current core bundle is `core.f70d460f.js` | `index.html` loads `core.d9e1b484.js` (`index.html:3514-3518`) | Earlier audit packet is a checkpoint, not current state. |
| Repository has about 48 tests | There are 45 direct files in `tests/`; runner has 26 suite slots | Use both exact counts and explain that files and registered slots are different measures. |
| Pushing `main` auto-deploys production | Owner-reported, not repo-inferable: the Vercel production-branch setting lives in the dashboard, which the sandbox cannot reach (Vercel API returns HTTP 000; `npx vercel` fails) | Treat as **owner-reported and operationally binding** — assume a push to `main` reaches real users — while recording that no in-repo artifact proves which branch is Production. The two are not in conflict: the hold exists precisely because the blast radius is unconfirmed. |
| `ebay:fixed-price` is the only accepted Phase 1 slot | Client exposes only that slot, but server registry accepts five slots (`api/_draftStore.js:115-121`) | Scope is UI-only today; API enforcement does not match the stronger statement. |
| D2 “Needs price” can be derived from the list response | Summary rows contain price but not server validation findings (`api/_draftService.js:493-512`) | D2.1 needs a server-summary extension or per-draft read; no client inference. |
| D2 uses a “lexical cursor” | IDs are sorted lexically, but `cursor` is parsed and returned as a numeric offset (`api/drafts.js:143-160`; `api/_draftService.js:547-596`) | **Code wins.** Describe this as numeric offset paging over lexical ID order. |
| Phase 1 checklist says “nothing built” | Current repo contains Blocks A-C, D1, and D2.0 | Header is historical planning text; code and later status annotations win. |
| Scan `instanceId` is an identity-field hash | Current `_crScanInstanceId()` mints a UUID per displayed scan (`js/core.d9e1b484.js:18269-18290`) | Implementation is corrected; an older nearby comment is stale. |
| Drafts have “no TTL” | Authoritative live records have no TTL; tombstones use 90 days and indexes use 180 days | No live-record contradiction. State the layers precisely. |
| The full 26-suite run is currently green | Verified by the primary agent: `COND_PILLS_BROWSER=1 timeout 900 bash tests/run-all.sh` was run at tip `11cb952` on 2026-09-06 and exited 0 with zero suite failures, suite [24/26] skipped. The verifying author of this document did not re-run it, and no durable run log is committed | Attested for tip `11cb952`, not independently reproduced here. Re-run before relying on it at any later tip. |

---

# 10. How to work in this repository

## 10.1 Before changing anything

1. Read this document.
2. Read the exact helper and its tests before editing a caller.
3. Search for every implementation of the behavior, not only the named function.
4. Identify the one authoritative owner.
5. Check `tests/run-all.sh` to learn whether the relevant test is registered or merely present.
6. Check branch, tip, working tree, and `origin/main` without fetching.
7. Do not read, copy, or print deployment secrets.

## 10.2 Local server

From the repository root, the established local browser convention is port 8097:

```bash
python3 -m http.server 8097
```

Set `SITE_BASE=http://127.0.0.1:8097` for the gated browser condition test when that test is explicitly authorized. Stop only the process you started; never use a broad `pkill -f "http.server"` that can kill another task.

The port convention comes from the audit workflow and browser test configuration. It is not a production requirement.

## 10.3 Syntax checks

For every changed JavaScript file, run:

```bash
node --check path/to/changed-file.js
```

Also check inline scripts through the registered syntax test when appropriate. The runner's syntax slot checks inline `<script>` blocks only (`tests/run-all.sh:38-43`).

Client bundles are classic script-scoped code except the auth module. When probing a classic bundle in a browser harness, top-level `const` values may not appear on `window`; evaluate the bare identifier in the page realm rather than concluding it is absent.

## 10.4 Test safety

Do not run `tests/run-all.sh` casually:

- Default mode calls production (`tests/run-all.sh:4-7`, `225-236`).
- Use `--local` only when an offline run is intended and authorized.
- Real KV needs `DRAFT_KV_LIVE=1` and dedicated credentials.
- Browser interaction needs `COND_PILLS_BROWSER=1` and a local served site.
- Live eBay is separate and can consume third-party access or touch live integration state.

Always state which gates were skipped. “26 suites passed” is misleading when gated slots did not run.

## 10.5 Immutable bundle rename rule

Hashed JavaScript receives `Cache-Control: public, max-age=31536000, immutable` (`vercel.json:47-48`). Therefore:

1. Never change bytes at an existing hashed URL.
2. Make the code change.
3. Compute the file's SHA-256.
4. Rename the file so the eight-character hash segment matches the first eight hex characters of its bytes.
5. Update the one HTML reference.
6. Keep the prior file; cached pages may still request it.
7. Run `tests/asset-fingerprints.mjs`.

The HTML catch-all is no-store, so a normal navigation can fetch a document that names the new asset (`vercel.json:49-50`). The asset test is suite slot 1 (`tests/run-all.sh:30-35`).

## 10.6 Patch discipline

- Make the smallest change that fixes the authoritative behavior.
- Do not add a helper that copies a rule owned elsewhere.
- Do not “fix” source copy to match a wrong number.
- If cached output meaning changes, rotate the cache-key schema.
- Add a behavioral regression test, not only a source-text assertion.
- Treat source-text guards as tripwires, never proof.
- Use server-generated IDs and explicit provenance.
- Preserve records on incompatible schema; refuse handoff rather than destructively migrating by assumption.

## 10.7 Git and deployment discipline

- Work on the current feature branch unless the owner directs otherwise.
- Do not fetch, rebase, rewrite history, push, merge, or deploy without authorization.
- Do not resolve the `94dc777` owner decision implicitly.
- If history is rewritten, every descendant SHA changes and all review evidence must be regenerated.
- Before any authorized deployment, verify the configured Production branch and current deployment SHA in Vercel.
- After an authorized hosted deployment, verify document and asset headers, HTML bundle reference, normal reload behavior, production smoke, and the live eBay gate.

---

# 11. If you are a reviewer, argue with these

These are genuine judgment calls or unresolved architecture edges. Challenge them with evidence.

1. **Client-owned price basis.** Is keeping the sole fee/price implementation in the client an acceptable temporary trust boundary for persisted drafts, or should the behavior be moved—not copied—to a shared/server owner?
2. **D2 list shape.** Should summaries include complete validation findings, a small server-derived display state, or should the client hydrate every visible draft? Compare correctness, latency, and schema coupling.
3. **One active draft per instance and slot.** What atomic key and lifecycle should enforce this without making an idempotent replay fail at the cap or blocking legitimate replacement after discard?
4. **Slot registry versus Phase 1 scope.** Should the API reject every slot except `ebay:fixed-price` until its UI and contract ship, or is accepting dormant validated slots desirable?
5. **Auth for eligibility.** The calculation is harmless, but requiring auth prevents showing Sell readiness to signed-out visitors. Does avoiding two policy modes justify that conversion cost?
6. **Stale quote threshold.** What empirical age should create a warning for each source, and should the threshold vary by market liquidity?
7. **Derived ±15% Quick Pricing band.** Is a symmetric estimate acceptable when measured spread is unavailable, or should the UI show only the comp?
8. **Source disagreement threshold.** Are 1.5× and a $20 floor the right disclosure gates across modern, vintage, sports, and graded cards?
9. **Grading-cost owner.** Should the tiered server model become canonical, or should both client and server call a new shared data contract?
10. **History rewrite.** Is removing small credential fragments from commit metadata worth invalidating the currently reviewed chain of SHAs?
11. **Index lifetime.** A live record persists while secondary indexes expire after 180 days. Does the reconciliation path guarantee a long-inactive seller can always rediscover every draft within request limits?
12. **Condition policy.** Phase 1 correctly refuses an API condition payload but allows copy-ready handoff with warnings. Confirm that this remains honest for every supported category and grader.

Do not reopen settled product direction—trading cards rather than only TCGs, eBay first rather than eBay forever, no auto-publish, official OAuth, source disclosure—unless new evidence changes the underlying premise.

---

# 12. New contributor checklist

Before claiming a task is done:

- [ ] I identified the single owner of each business rule I touched.
- [ ] I did not add a client-side eligibility or validation duplicate.
- [ ] I did not default unknown provenance, condition, timestamp, descriptor, venue eligibility, or source freshness.
- [ ] I handled absence separately from zero.
- [ ] I preserved the difference between product identity, physical instance identity, and selling intent.
- [ ] I used the forward fee function for inverse verification.
- [ ] I retained source identity, and did not average disagreeing sources into a third number. (Explicit cross-source disclosure is withdrawn — §3.4 — so this item does not require it.)
- [ ] I added a behavioral test and confirmed it is registered if it is meant to gate.
- [ ] I stated which tests and external gates were not run.
- [ ] I renamed every changed immutable bundle and updated its HTML reference.
- [ ] I did not run production smoke, live KV, live eBay, push, or deploy without authorization.
- [ ] I did not present an owner decision, credential rotation, dashboard fact, or vendor permission as complete without evidence.
