# Basis Loss — Cause Established, Reproduced Deterministically

Branch `phase1-block-d`. Live bundle `js/core.3f83abec.js` (referenced
`index.html:3832`). Nothing pushed, nothing deployed. Credential rotation still
gates pushing.

Scope of this packet: the `draft-review-screen` basis-loss finding only. D7
implementation stays closed. No Phase 1 percentage is claimed.

---

## 1. What was asked, and what it produced

The direction was to capture one complete sequence — the successful binding,
each subsequent clear with its stack and the card then active, and the
correlated create with the card requested and the basis at context
construction — to install the capture before setup, to retain the first failing
trace, and then to turn the demonstrated ordering into a controlled
reproduction that distinguishes a late callback clearing the current card's
basis from a test installing its basis before card loading had finished.

Done. The answer is the second alternative, and the trace says so directly.

## 2. The retained trace

Installed before any setup in the section, as a property trap on the basis
global plus a fetch wrap, test page only, no production hook. The first failing
trace is retained at `audit/d7/basis-loss-trace.json` and is never overwritten:
a later green run cannot erase the evidence of an earlier red one.

Reproduction rate with the capture live: **3 of 6 focused runs**.

The decisive four events, verbatim from the retained file (times are ms from
capture install):

| t | kind | detail |
|---|---|---|
| 289 | BIND | `sourceUrl` `https://www.tcgplayer.com/CARD-A`, `cardKey` `4e2c6b7b` |
| 303 | CLEAR | active card `4e2c6b7b`; stack `loadCardUI (js/core.3f83abec.js:3556) <- doHydrate (:765) <- _restoreLastLoadedCard (:792) <- (:20252)` |
| 1242 | CREATE | requested `Card A/inst_scan_4d8317f7…`, `basisAtContext` `null`, active card `4e2c6b7b` |

Read across those rows:

- The clear is **`loadCardUI`** (`js/core.3f83abec.js:3556`), reached from
  `doHydrate` inside `_restoreLastLoadedCard`, which the bundle schedules on a
  **400ms startup timer** (`:20252`) and which re-hydrates itself once more
  "after a beat" (`:793`).
- The card active at the clear is **`4e2c6b7b` — card A itself**, the same key
  the basis was stamped to. So this is a **same-card reload dropping that
  card's own basis**, not a card change dropping a foreign one.
- The create at t=1242 is correctly correlated (the `inst_scan_` identity, its
  own case window) and carries `basisAtContext: null`. Consistent with the
  earlier conclusion that request miscorrelation is eliminated.

**Which alternative this is.** The bind at t=289 lands 14ms before the clear at
t=303 — the test installed its basis while startup card loading was still
pending. It is not a late callback clearing a basis the user had established
under steady state.

## 3. Confirmation, by removing the race

The startup restore is now stubbed out in that section, with the reason
recorded inline. The section measures basis binding rather than racing startup.

- Before: **3 of 6** focused runs failed.
- After: **6 of 6** focused runs pass, then **4 of 4** full-suite runs at
  **345 passed, 0 failed**.

That is the cause confirmed by removal, not by rerunning for green.

## 4. The controlled reproduction

Neutralising a timer would leave the ordering untested and the diagnosis
resting on one saved artifact. So the ordering is now reproduced deliberately,
off any timer, in a new section — `a same-card reload drops that card's own
bound basis`. It writes the real `cr:lastCard:v1` snapshot, waits out the
bundle's own timers, binds a basis for card A, then calls
`_restoreLastLoadedCard()` explicitly. Deterministic: **3 of 3**, and green in
every full run since.

It asserts, at the seam a create body is assembled from:

1. a basis for card A is bound and stamped to card A;
2. `_crPricingContext({ card: A })` carries that basis while it is bound;
3. the restore path ran and reloaded the same card;
4. 🔴 the reload cleared the basis it had just been given for that same card;
5. 🔴 the pricing context a create would carry then has no basis at all —
   asked with the same card that just had one;
6. `feeModelRevision` still survives, so this is a lost basis, not a lost
   context.

**One correction inside this work.** My first version asked
`_crPricingContext({})` with no card. That builder withholds the ambient basis
from a caller that cannot say which card it is pricing
(`js/core.3f83abec.js:20700-20706`), so it returns no `basisMeta` whatever the
global holds — the "after" assertion would have passed for the wrong reason.
Fixed to pass the card in both the before and after reads, and the "before"
assertion now fails if the basis is not actually visible to the builder.

## 5. What was NOT changed, and why

- **The clear stays.** Not removed, not narrowed. A card change must not carry
  the previous card's provenance forward; that leak is what the binding work
  existed to stop, and it is the worse failure of the two.
- **No speculative restore of the last non-null basis.** Reinstating a basis
  whose card is no longer certain recreates exactly that leak.

What the reproduction does establish is a requirement the clear does not
currently distinguish: dropping a **foreign** basis on a card change and
dropping the **current card's own** basis on a reload of that same card are
different things, and only the first is intended. Whether a same-card reload
should keep the basis is an **open product question, recorded and not decided
here**. The original binding fix prevented foreign provenance; retaining a
legitimate basis is a separate requirement and is not met.

## 6. "Silently vanish" — withdrawn

My earlier packet said provenance could silently vanish. That was wrong, and
the code contradicts it. `_reviewBasisHtml` (`js/core.3f83abec.js:22262`) with
no basis at all renders `data-packet-basis="absent"` and the sentence "No price
source was recorded with these listing details.", and when the draft's
`priceSource` is `comp` or `venue` it adds `data-basis-unsupported` and "This
price is recorded as comp-derived, so it should have one."

Already asserted, not newly claimed: `tests/draft-review-screen.mjs:2519`
("no recorded source is stated as absent") and `:2521` ("a comp-derived price
with no basis is flagged as owing one"). The loss is **disclosed, and flagged
as owing a source** in the comp-derived case.

**Reachability outside test setup: not demonstrated.** Binding a basis requires
a priced read, so a seller cannot be holding one inside the first 400ms of a
page load. Recorded as undemonstrated rather than ruled out.

## 7. Run accounting, including the interrupted command

- **Retained:** `draft-review-screen` full **345/0 ×4**; focused section
  **6/6** after the fix, and **3/6 failing** before it (those failures are the
  finding, not noise). Neighbouring suites, each run individually to completion
  after the shared-harness change: `test-registry` 12/0 · `draft-store` 147/0 ·
  `listing-photos` 92/0 · `decision-restatements` 33/0 ·
  `asset-fingerprints` 64/0 · `draft-crud-e2e` 192/0 ·
  `listing-packet-offline` 232/0 · `deeplink-companions` 178/0 ·
  `launch-audit-regressions` 438/0.
- **Marked incomplete:** the earlier command that queued five full runs in one
  shell was killed at the shell time limit. Four runs had completed and are
  retained; the fifth is **incomplete, no exit status captured**, and is not
  counted. The focused investigation was then run separately rather than by
  queueing more full-suite repetitions.
- **Filename correction:** `deeplink-companions` is `.js`, not `.mjs`. My first
  invocation used the wrong extension and Node reported `MODULE_NOT_FOUND`.
  That was a **failed invocation, not a suite failure**, and it is not counted
  as a result either; the suite was then run and reported 178/0.

## 8. The section filter, and why it announces itself

Focused iteration needed a way to run one section. `tests/_assert.mjs` now
honours an opt-in `CR_ONLY` substring filter. Absent the variable nothing
changes and every section runs.

A filtered run is an **incomplete** run, so it cannot be allowed to print the
same summary line as a full one: each skipped section prints `skipped by
CR_ONLY`, and the summary appends `-- INCOMPLETE RUN: N section(s) skipped by
CR_ONLY=<value>`. Otherwise "the rest did not execute" would read as "the rest
passed" — the same direction of error as the harness bug that once let a throw
report one failure instead of eleven.

## 9. Status

- D7 implementation: **closed**, unchanged by this work.
- Basis loss: **cause established** — the bundle's 400ms startup restore
  reloading the same card and clearing its basis, with the test's bind landing
  inside that window. Request miscorrelation: **eliminated**. Reproduction:
  **deterministic**.
- Open, not solved: whether a same-card reload should retain the basis
  (product question); reachability outside test setup (undemonstrated);
  Safari/iOS unverified; local photos never reach eBay; RV-7; D5 signed-in
  checks; D6 remaining verification; SI-1; two rotation-gating dashboard
  answers; PriceCharting Q1–Q6.
- **No verified Phase 1 percentage. Nothing pushed. Nothing deployed.**
