# Release-validation queue

Checks that cannot run offline in this sandbox and must run before release.
Created 2026-09-08. This file exists because "carry it into release validation"
was previously said in prose and then lived nowhere — a queue nobody can read is
not a queue.

Each entry states what to run, what must be true, and **why the offline
assertions are not sufficient**. That last column is the point: several entries
have passing source-level assertions, and a source assertion establishes where a
field was written, never that it arrives.

---

## RV-1 — grade response contract (added 2026-09-08, from the BIAS-5 change)

**Why offline assertions are not enough.** `tests/quick-pricing.mjs` asserts that
`api/scan.js` contains `analysis_id: scanId` and that `scan_id` does not appear
in the grade-mode response literal. Those are text assertions over source. They
establish that the field was **added**; they cannot establish that the response
**path** returns it — an early return, a later overwrite, a serializer, or a
wrapper could all drop it, and the whole point of the BIAS-5 fix is that
`_crGradingScope` silently falls back to the WeakMap when the field is missing.
A silent fallback plus a source-only assertion is exactly the shape that let the
`scan:` branch sit unreachable in production while looking correct in review.

**Run:** exercise a successful grade scan against the deployed function with a
mocked or fixture card.

**Must be true:**

1. The 200 response body contains `analysis_id`, a non-empty string.
2. The 200 response body does **not** contain `scan_id`. `scan_id` keys the
   refund path, which is claimable only for scans logged to KV
   (`api/scan.js:1220`); grade scans are not logged, so exposing that name would
   make them look claimable.
3. Two grade scans in one session return **different** `analysis_id` values.
4. Client-side, `_crGradingScope` resolves to `scan:<analysis_id>` and not to an
   anonymous WeakMap token. If it resolves to a token, item 1 failed silently.

**Blocked by:** `tests/test-scan.mjs` has no offline harness (existing open
item). This entry is the concrete reason to build one.

---

## RV-2 — accessibility of the T2.14 disclosure row (added 2026-09-08)

**Why offline assertions are not enough.** The note is visible text in document
order and `a11y-mobile-2026-09-04` passes 174/0, but element presence alone does
not establish a usable announcement, and `page.accessibility` has been removed
from the installed Playwright build, so no automated proxy is available here.

**Run:** a real screen reader over the Quick Pricing ladder in the state where a
supplied low exceeds the comparison reference.

**Must be true:**

1. `Provider low (not used)` is announced as the row's name.
2. The em-dash value is not announced as a price, or as nothing at all in a way
   that leaves the row nameless.
3. The explanation note is announced in the same row context, not orphaned after
   the table.
4. The dagger's accessible name is announced (this has been carried as
   unverified since the prior checkpoint and is still unverified).

---

## RV-3 — eBay live suite (pre-existing, restated here)

**Run:** `EBAY_LIVE=1 node tests/ebay-live.mjs`.
**Must be true:** 19/19. Currently 18/19.
**Blocked by:** the Cert ID rotation gate. This is a release gate, not a
checkpoint gate.

---

## RV-4 — draft KV live (pre-existing, restated here)

**Run:** `node tests/draft-kv-live.mjs`.
**Must be true:** passes against live KV.
**Blocked by:** no live KV binding in this sandbox. It is the only registered
suite in `tests/run-all.sh` that cannot be run here.

---

## Not in this queue

Everything else registered in `tests/run-all.sh` runs offline and was run at the
2026-09-08 checkpoint — 41 of 42 suites, all green. Anything reported as "not
rerun" must name which of these four entries it falls under, or it was simply
not run.
