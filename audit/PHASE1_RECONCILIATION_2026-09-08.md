# Phase 1 requirements, reconciled against the seller workflow

**Date:** 2026-09-08 · **Branch** `phase1-block-d`, HEAD `2727d53` · `origin/main` = `9aaf326`.
**Nothing pushed. Nothing deployed.** Live bundle `js/core.86000bf2.js` (22,331 lines).

This is not a status estimate. It is a requirement-by-requirement read of the
two source documents against what a seller can reach in code today.

**There is no current Phase 1 percentage, and this document does not supply
one.** Both prior figures — 80–85% (owner, basis unchecked) and 75–80%
(reviewer, an adjustment of that same basis) — are superseded and may not be
quoted forward. Recorded at `audit/d3/LANE_A_STEP1_PACKET.md` §13.

Sources reconciled: `audit/CARDRESELL_PLAN_AND_ROADMAP.md` §1.2 (the Phase 1
user flow), §6.2 (the block table), §6.3 (the D2.1 contract); and
`audit/TODO_PHASE1.md` (tracks 1 and 2).

---

## 0. Target net — unfinished, and outside Lane A

Stated first and separately so its exclusion from Lane A does not read as
removal from Phase 1.

- **`listPriceForTargetNet` is NEVER WIRED.** 25 test calls; across every
  commit in history, **no production call site**
  (`audit/d3/LANE_A_STEP1_PACKET.md` §10).
- The packet's `pricing.targetNet` / `achievedNet` / `exact` / `delta` fields
  exist in the builder's output (`api/_listingPacket.js:860-870`) and are
  populated only when a caller supplies a target net. No client caller does.
- **Status: UNFINISHED. Owner: not this lane.** By agreement it is out of Lane
  A's scope and is not being wired here. It remains an original Phase 1
  requirement and is carried on this list until it is either wired or
  explicitly dropped by the owner.
- Do not wire it opportunistically. The inversion rule stands: invert by
  bisection on the forward function, never re-derive algebra.

---

## 1. The Phase 1 user flow, step by step

Roadmap §1.2 defines four steps. Reconciled:

| Step | Requirement | Reachable today |
|---|---|---|
| 1 | Scan a card, or select a saved collection row | **Yes.** Both entry points exist and both create drafts — panel `#crSellBtn` (`index.html:2195`) and the Collection row button (`js/core.86000bf2.js:20515`). Server-owned eligibility gates both. |
| 2 | Choose **Sell** | **Yes.** One create transport, `_crCreateDraft`. |
| 3 | Receive a prepared listing | **Partial — see §2.** Title, category, aspects, condition and a fee breakdown render. Expected net, shipping breakdown, description and photo state do not. |
| 4 | Copy the prepared fields and continue in eBay's own flow | **Copy: yes** (`Copy title`, `Copy card details`, `Copy everything`, `_reviewCopyPayload`). **Continue in eBay: no** — there is no continuation control anywhere on the review screen; a grep for an eBay URL in the review slice returns nothing but comment text. |

Step 3 is where the gap is, and it is a content gap rather than a plumbing one:
the draft, packet, staleness, refresh and copy path all work end to end.

## 2. What "a prepared listing" is missing

§1.2 names seven things a prepared listing contains. Checked against the
builder's return value (`api/_listingPacket.js:842-877`) and the review
renderer (`_reviewPacketHtml`, `_reviewFeesHtml`):

| Named in §1.2 | In the packet | On the review screen |
|---|---|---|
| Title | `title.text` | Yes |
| Category and aspects | `category`, `aspects` with per-aspect provenance | Yes |
| Price | draft `price` | Yes |
| Expected net | only via `pricing.achievedNet`, populated only for a target-net call that never happens | **No** |
| Fee **and shipping** breakdown | no shipping field exists in the packet at all | Fees yes; **shipping no** |
| Condition guidance | `condition` (`api/_conditionDescriptors.js`) | Condition label yes; guidance text **no** |
| Description | **no description field exists in the packet** | **No** |
| Photo state | nothing; no listing-photo state exists | **No** |

**None of these four gaps is a defect in shipped behaviour** — nothing claims
them today, so nothing lies. They are unbuilt requirements. Filing them as
gaps rather than as defects is the distinction that matters for the do-not-
stamp-a-lie rule.

## 3. Block-by-block

Statuses below are re-read against code, not carried from §6.2. The §6.2
caveat still applies to any block marked from suites alone; where this pass
established reachability, it says so.

| Block | §6.2 said | This pass |
|---|---|---|
| A — Foundations | Implemented | **Implemented.** Identity, SKU, instances, indexes, idempotency; exercised through the real create path this session. |
| B — Packet | Implemented, external fields gated | **Implemented and now reachable.** Its caller landed at `3db7169`; before that the block's seller-reachable contribution was zero, not partial (§11b). `targetNet` is the unwired part — §0. |
| C — Drafts | Implemented | **Implemented.** CRUD, revisions, idempotency, 500 cap, tombstones, paged list. |
| D1 — Sell entry | Implemented and reviewed | **Implemented.** Both entry points; and as of `da13bee` the Collection one no longer carries the panel card's price basis (§17). |
| D2.0 — Readiness | Implemented | **Implemented.** One `identityReadiness()` owner. |
| D2.1 — Draft list UI | Next | **Implemented this session.** All-drafts screen, paging, server-owned blocker copy, `draft-list-screen` 101/0. |
| D3 — Review screen | Later | **Implemented this session.** Field rendering by server reason, packet arms, fee breakdown, refresh, copy. `draft-review-screen` 268/0. |
| **D4 — Number provenance** | Later | **NOT IMPLEMENTED.** The review screen renders no provider, no source URL and no absolute retrieval time. The data exists — `priceBasis` carries `label`, `sourceUrl`, `low/mid/high`, `retrievedAt` (`api/_listingPacket.js:483-496`) and is now correctly bound to its card — but **nothing renders it.** Fee revision is disclosed (`clientDeclaredFeeModelRevision`, shown as "Declared by this app … not verified"). Seller/manual attribution is stored (`priceSource`) but not displayed. |
| **D5 — Copy-ready handoff** | Later | **PARTIAL.** One-tap copying is done and tested. The eBay continuation is absent. No publish control — correct, and it must stay absent. |
| **D6 — New-seller warning** | Later | **NOT IMPLEMENTED.** The seller profile exists (`SELLER_PROFILE_KEYS`, `js/core.86000bf2.js:6000`; default no-store / not-Top-Rated / Level 1–4) and feeds fee arithmetic, but no pre-handoff restriction warning is shown. Requirement stands: show when applicable, **do not invent eligibility**. |
| **D7 — Local photos** | Later | **NOT IMPLEMENTED.** A grep for listing-photo state returns nothing. Scan-local photos exist and are a different thing. Requirement includes the cross-device limitation copy and no server upload. |
| E — Gates and telemetry | Partially present, not closed | **Partially present.** Offline suites and the asset test are enforced; the real-KV, browser and prod-smoke legs are not closed. |

**Order these four in.** D4 is the cheapest and the highest-truth-value: the
data is already on the wire and already bound to the right card, so it is a
renderer, not a feature. D5's continuation is one control. D6 needs an owner
decision on what "applicable" means before any copy is written. D7 is the
largest and the only one that is genuinely new state.

## 4. Track 2 survivors — still open

From `audit/TODO_PHASE1.md`. None was closed by Lane A work.

| Item | Status |
|---|---|
| T2.1 `📬 Price Drop Alerts` label promises a feature that does not exist | Open |
| T2.2 pricing copy disagrees between `index.html` and `pricing.html` | Open |
| T2.3 no credit refund on `looksSlabbed` — money defect | Open |
| T2.4 unauthenticated open proxies in front of paid keys | Open |
| T2.5 fabricated ±15% band printed as observed | Open |
| T2.6 bulk `needsPicker` renders as a confident ✓ | Open |
| T2.7 grading panel's flat $25 against our own tiers | Open, four named parts |
| T2.8 shipped copy says "beta" (`api/verify-send.js:155`) | Open |
| T2.9 venue tax treatment | **DONE 2026-09-08**, 1 of 15 → 9 of 15 disclosed |

Also carried, from the audit corpus rather than from tracks: `applyEdit` never
updates `priceSource`; `feeBase`/`feeBaseLabel` emit on 2 of 15 venues; four
undeclared CSS tokens; 109 unresolved citation-map entries; 48 release-registry
entries; RV-1…RV-6; four duplicate `codes` helpers in
`tests/listing-packet-offline.mjs`.

## 5. Gates, unchanged by any of this

- **PUSH GATE.** Do not push before the eBay Cert ID is rotated. Full stop.
  Sequence: rotate in the eBay portal → update the Vercel Production env var →
  `EBAY_LIVE=1 node tests/ebay-live.mjs` at 19/19 (currently 18/19) → then
  delete `refs/recovery/pre-scrub-c2366b2`. Never use the unblock URL. Never
  reprint a credential value. **Rotation is mandatory and not done.**
- `main` auto-deploys. No deployment without explicit authorization.
- `tests/run-all.sh` is not run.

## 6. What this reconciliation does not establish

- It does not produce a completion figure, and declines to.
- It does not re-verify blocks A, B, C or D1 by fresh reachability sweep; it
  reports A–D3 as implemented on the strength of code plus this session's
  real-browser exercises of the create, list, review, refresh and copy paths.
  The §6.2 caveat has not been discharged block by block.
- The four "NOT IMPLEMENTED" entries are absences read from grep and from the
  renderer's own field lists. An absence is easier to establish than a
  presence, but a grep is still a grep — each is stated with the symbol or
  field list it was read against so it can be checked.
