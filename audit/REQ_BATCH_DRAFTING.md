# Requirement — Batch drafting from Bulk Scan and Rapid Scan

Recorded 2026-09-11. Originally written as a requirement with a size and no work
started; **the owner has since folded it into Phase 1** as the one approved
addition to the standing "no further feature expansion" instruction. This file
is now both the requirement and the as-built record, with the requirement's own
errors corrected in place rather than quietly dropped.

## Scope correction, carried forward

The earlier wording **"create eBay drafts"** was too broad. **Corrected:** this
creates **CardResell listing drafts** through the existing review/export
handoff. It does **not** talk to eBay. The venue-neutral position holds: eBay is
the first integration, not the destination.

## Behaviour required

Both **Bulk Scan** and **Rapid Scan** result screens:

1. **Per-row selection** — a control on each result row.
2. **Select All** — with a visible selected count and a clear partial state.
3. **Create Selected Drafts** — one action, operating on the selection.
4. **Per-card results** — every selected card reports its own outcome. A batch
   of 40 in which 3 fail must show **which 3** and why, in the existing
   review-screen error vocabulary. A batch-level "some failed" is not
   acceptable; a silent omission is the bug.
5. **Duplicate protection** — reuses the existing per-row create identity and
   the verbatim held payload, per card. Re-running Create Selected on a
   partially-succeeded batch must replay, not duplicate. **410 stays explicit:**
   a stale generation shows the deleted state and requires a fresh deliberate
   Create — no automatic refresh and retry.
6. **Draft-cap handling** — see the corrected finding below. Batch shows
   remaining headroom before submitting, and surfaces each server refusal on the
   row it belongs to.
7. **No automatic publishing.** Nothing is submitted anywhere. The end state is
   drafts in the existing Drafts view.

## Four owner corrections, and how each was answered

**1. Scan identity — `col-<entryId>` assumes a collection entry exists.**
Correct, and it was the wrong basis. Bulk and Rapid Scan rows are unsaved; there
is no entry id to key on, and a positional index is not stable across a re-sort
or a removal. Each scan row is now stamped with a `scan_<hex>` identity **at
capture**, before any lookup. Retrying one row reuses its identity, so a retry
replays rather than duplicating. Two physical copies of the same card carry two
identities and stay distinct — they draft as "Copy 1" and "Copy 2".

**2. Cap handling — available space can change during the batch.**
Correct. The pre-flight headroom read is a **planning aid only**. It never trims
the batch and it is never treated as permission: every card is still submitted
and the server's refusal is authoritative. A refusal is shown on the row that
was refused, and the remaining unattempted rows are marked "Not attempted"
rather than silently dropped.

**3. Cap-message evidence — zero `at-cap` matches does not establish that no
message appears.** The owner was right, and the original requirement's claim was
**wrong**. `'at-cap'` is only the internal `QUOTA.AT_CAP` string and never goes
on the wire, so grepping the bundle for it could not have found anything. The
shipped client at `e75700c` **did** handle the refusal — `if (r.status === 409
&& /CAP/i.test(...))` — and showed "You've reached the draft limit. Finish or
discard a draft to start another." **There was no missing-message defect.** The
row in the table below is corrected accordingly.

What was genuinely worth changing: the server sends its own sentence
(`"You have reached the maximum of 500 saved drafts. Finish or delete one to
save another."`, `api/drafts.js:97-105`, HTTP 409, `code: DRAFT_CAP_REACHED`).
A batch row now shows **the server's sentence** rather than a client paraphrase
of it. The single-card toast copy is unchanged.

**4. Support draft still contained the two claims.** Fixed in the message body,
not only in the note below it — see `audit/EBAY_SUPPORT_QUESTION.md`.

## What already existed, and what did not

| Piece | State | Evidence |
|---|---|---|
| Single-card create | Exists | `POST /api/drafts` |
| Retry identity + payload preservation | Exists | `_crIdemKey`, `_crCreateAttempt` |
| 410 / explicit-new-Create | Exists | `api/_draftService.js` |
| Cap enforcement server-side | Exists | `api/_draftQuota.js` (`DRAFT_CAP = 500`) |
| Cap message client-side | **Exists — earlier "MISSING" was wrong** | `/CAP/i` branch present at `e75700c`; the grep looked for a string that is never on the wire |
| Bulk Scan overlay shell | Exists | `bulkScanOverlay` |
| Row selection / Select All | Built here | — |
| Batch orchestration | Built here | — |
| Per-card result reporting | Built here | — |

## A real bug this work surfaced

`bulkMergeDuplicates` incremented `qty` **before** concatenating `copyUids`. The
short uid list was then repaired by minting a filler uid, which pushed the real
second copy's uid past the `slice(0, qty)` in `_bulkDraftUnits`. Result: **two
cards in hand, one draft, no error.** Fixed by making the uid list
authoritative — each side is sliced to its own qty, `qty = uids.length`, and
both are set together before any render.

## Verification

`tests/bulk-batch-draft.mjs` — real browser, real `api/drafts.js`, real store;
only `/api/scan`, the card API, `/api/tcg-price`, JWKS and Upstash are doubled.
Nine groups covering identity at capture, opt-in selection and tri-state select
all, one draft per row, replay on re-run, retry reusing its identity, two copies
producing distinct drafts, the at-cap refusal, the frozen collection-save shape,
and two **mutation checks** that fail the suite if the retry and copy logic is
broken — so the passing result is not self-confirming. Registered as slot 58 in
`tests/run-all.sh`.

## Still owed at the time of writing

The cap refusal has been exercised against the real handler locally; the owner
asked for it on the **Preview build**, which is outstanding until the branch is
deployed. Signed-in Preview draft/lifecycle checks (RV-4, Q-D8-6) are likewise
outstanding. Production deployment remains a separate approval.
