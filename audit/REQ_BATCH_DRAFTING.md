# Requirement — Batch drafting from Bulk Scan and Rapid Scan (2026-09-11)

Recorded as a **requirement with a size**, not as work started. It is **new
scope**: it was not in the Phase 1 release-candidate list, so the ~95% figure
cannot absorb it. Sizing is at the end.

## Scope correction accepted first

The earlier wording **"create eBay drafts"** was too broad and I should not have
carried it forward. **Corrected:** this creates **CardResell listing drafts**
through the **existing review/export handoff**. It does **not** talk to eBay, and
nothing about it implies direct eBay integration. The venue-neutral position
holds: eBay is the first integration, not the destination.

## Behaviour required

Both **Bulk Scan** and **Rapid Scan** result screens:

1. **Per-row selection** — a control on each result row.
2. **Select All** — with a visible selected count, and a clear partial state.
3. **Create Selected Drafts** — one action, operating on the selection.
4. **Per-card results** — every selected card reports its own outcome. A batch
   of 40 in which 3 fail must show **which 3** and why, using the existing
   review-screen error vocabulary. **A batch-level "some failed" is not
   acceptable** — a silent omission is the bug (Rule 2).
5. **Duplicate protection** — reuses the existing per-row create identity, not a
   new one. Today's key is
   `_crIdemKey('sell', 'col-<entryId>', slot, 'g'+generation)`
   (`js/core.ebc21977.js:21177-21178`), and an unresolved attempt's payload is
   held verbatim in `_crCreateAttempt` (`:21446`) so a retry cannot carry a
   generation the seller never attempted. **Batch must reuse both mechanisms
   per card.** Re-running Create Selected on a partially-succeeded batch must
   replay, not duplicate. **410 stays explicit:** a stale generation shows the
   deleted state and requires a fresh deliberate Create — no automatic refresh
   and retry.
6. **Draft-cap handling** — the cap is `DRAFT_CAP = 500`
   (`api/_draftQuota.js:69`) and the server refuses with `AT_CAP: 'at-cap'`
   (`:96`). **Two problems to solve, and the first is a defect that already
   exists:** the cap is never surfaced in the client — a grep of the live bundle
   for `at-cap` / `AT_CAP` returns **zero** hits, so today a refusal has no
   seller-facing sentence. Batch must (a) give `AT_CAP` a sentence, and (b)
   check remaining headroom **before** submitting a batch that would cross the
   cap, so the seller is told "you can create 12 of these 40" rather than
   discovering it 12 cards in.
7. **No automatic publishing.** Nothing is submitted anywhere. The end state is
   drafts in the existing Drafts view, reachable through the existing review /
   export path.

## What already exists, and what does not

| Piece | State | Evidence |
|---|---|---|
| Single-card create | **Exists** | `POST /api/drafts`, `js/core.ebc21977.js:21469` |
| Retry identity + payload preservation | **Exists** | `:21137` `_crIdemKey`, `:21446` `_crCreateAttempt` |
| 410 / explicit-new-Create | **Exists** | server `api/_draftService.js:338` |
| Cap enforcement server-side | **Exists** | `api/_draftQuota.js:69, :96` |
| Cap message client-side | **MISSING** | zero `at-cap` hits in the live bundle |
| Bulk Scan overlay shell | **Exists** | `:20119` `bulkScanOverlay` |
| Row selection / Select All | **Does not exist** | no selection controls on scan results |
| Batch orchestration | **Does not exist** | — |
| Per-card result reporting | **Does not exist** | — |

## Sizing

**Estimate: 4 units of work, 1 of them a pre-existing defect.**

1. **Selection UI on both screens** — per-row control, Select All with partial
   state, selected count. Two screens, shared component. *Small.*
2. **Batch orchestrator** — sequences per-card creates reusing the existing
   identity and retry rules, holds per-card state across a partial failure, and
   makes re-running replay rather than duplicate. **This is the hard part**:
   concurrency, ordering, and the interaction with generation preconditions. It
   is also where a wrong turn produces duplicate drafts, so it needs a mutation
   test, not just a passing suite. *Medium-large.*
3. **Per-card result surface** — an outcome per row in the existing error
   vocabulary. *Small-medium.*
4. **Cap headroom + `AT_CAP` sentence** — the missing client message, plus a
   pre-flight headroom read. *Small, and it fixes an existing gap.*

**Effect on the estimate.** Phase 1 was ~95% against a scope that did not
include this. Adding it, the honest statement is: **the previously scoped Phase
1 work remains ~95% complete; this requirement is additional and not started.**
I am not restating a single blended percentage, because that would either hide
the new work or falsely discount the finished work. **Which side of the Phase 1
line this sits on is your call** — it is a plausible Phase 1.5 / Phase 2 item,
and the standing instruction is no further feature expansion, so nothing here
gets built without your say.
