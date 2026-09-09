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

## RV-5 — flip completeness through the real record path (added 2026-09-08)

**Run:** serve the repo on a local port, then
`CR_E2E_URL=http://127.0.0.1:<port>/index.html node tests/flip-completeness-e2e.mjs`.
**Must be true:** 22/22. **Last run 2026-09-08: 22 passed, 0 failed.**

**Why it exists.** `tests/payout-honesty.mjs` lifts the completeness helpers out
of the bundle and asserts their return values. That is a unit test and cannot
speak for the surfaces the original `hasCosts` defect actually reached
— persisted records, the portfolio total, "Best Flip", and the CSV export.
RV-5 follows one record through all of them: explicit zeros survive a reload as
complete, a blank cost stays provisional after reload and inside the aggregate,
a pre-tracking record stays untracked with no missing-field list invented for
it, and all three remain distinguishable in the exported file.

**Why it is not a runner slot.** It needs Playwright and a local HTTP server.
The offline runner provides neither and the repo has no `package.json` to depend
on Playwright from. It is a declared exclusion in `tests/test-registry.mjs`.

---

## RV-6 — rendered-ranking comparison across the chart change (added 2026-09-08)

**Run:** extract the pre-change build (`git archive fa4739b^`), serve both, and
compare the painted `.payout-rank-row` name/amount pairs in DOM order.
**Must be true:** identical amounts and identical order in every case.

**Why it exists.** `_payoutBarGeom` returns geometry only and has no amount
field, but that fact is a property of the helper, not proof that the caller
preserved amounts and ordering. The claim is carried by rendered output instead.

**Last run 2026-09-08 — 4 cases, all identical:**

| case | override | rendered ranking (identical before and after) |
|---|---|---|
| mixed signs | $3.00 | Poshmark $0.05 · CardNexus −$9.24 · Mercari −$9.30 · Whatnot −$9.63 · eBay −$9.70 · TCGPlayer −$9.70 |
| all negative | $1.00 | Poshmark −$1.95 · CardNexus −$11.08 · Mercari −$11.10 · Whatnot −$11.41 · eBay −$11.43 · TCGPlayer −$11.43 |
| ordinary profitable | $45.00 | Poshmark $36.00 · CardNexus $29.40 · Mercari $28.50 · Whatnot $27.80 · TCGPlayer $26.74 · eBay $26.64 |
| high value | $400.00 | CardNexus $356.00 · Mercari $348.00 · Whatnot $344.10 · TCGPlayer $334.70 · eBay $334.60 · Poshmark $320.00 |

The two cases the chart change targets — mixed signs and all-negative — are the
first two rows.

---

## RV-7 — D7 listing photos, store and screen (added 2026-09-08)

`tests/listing-photos.mjs`, **92 checks, 92 passing, run twice** on
2026-09-08 against `js/core.3f83abec.js`. It is a **declared exclusion** in
`tests/test-registry.mjs`, not an offline slot, on the same grounds as
`flip-completeness-e2e.mjs`: it needs Playwright and a local HTTP server the
offline runner does not stand up.

Run by hand: `node tests/listing-photos.mjs`.

What only this suite covers:

| area | what it establishes |
|---|---|
| store transaction | a fault fired after every blob `put` reports success but before commit ⇒ caller sees a rejection, no orphan blob survives, manifest byte-identical |
| picker | files arrive via `setInputFiles` on the real hidden input, not a synthesised `File` in page JS |
| reorder | the chosen order survives a **full page reload**, not just a repaint |
| missing photo | renders as its own tile with its own sentence while its neighbours still show thumbnails, and the empty line stays hidden |
| cap | 12 is attributed to CardResell and explicitly not to eBay |
| failure | the previously displayed collection is intact, the failure is shown, and no success line appears beside it |
| no upload | add, reorder and remove issue no request with a body, scoped after boot |

**What it does not establish.** It runs in headless Chromium only, so it says
nothing about Safari or iOS, where the storage behaviour that motivated the
browser-scoped copy is most likely to differ. It does not establish a storage
ceiling — no quota-exhaustion experiment was run, by decision. Glare is not
asserted because glare is advisory, not a gate.

---

## Open behaviour question — same-card basis retention (opened 2026-09-08)

Tracked here rather than left inside the D7 basis-loss packet, because it is a
product decision with a release consequence and it is nobody's side note.

**What is established.** `loadCardUI` (`js/core.3f83abec.js:3556`) clears
`_crBasis` on every card load. The clear **treats both cases alike**: a load of
a DIFFERENT card, where dropping the previous card's basis is the leak
prevention the binding work was built for, and a reload of the SAME card, where
the basis just bound for that card is dropped too. Demonstrated deterministically
by `a same-card reload drops that card's own bound basis` in
`tests/draft-review-screen.mjs`, driven through the real
`_restoreLastLoadedCard()` path.

**What is not established.** Whether a same-card reload SHOULD retain the
basis. Retention is not obviously safe: reinstating a basis whose card is no
longer certain recreates the foreign-provenance leak. Production reachability
is also undemonstrated — the only observed occurrence was a test binding a
basis while a startup card load was still pending. No minimum duration is
claimed in either direction.

**Why it is not urgent.** The consequence is disclosed, not silent: the review
screen states `data-packet-basis="absent"` with "No price source was recorded
with these listing details.", and flags a comp-derived price as owing a source
(`tests/draft-review-screen.mjs:2519`, `:2521`).

**What would close it.** A decision on the intended same-card behaviour, and if
retention is chosen, a rule that distinguishes the two loads by card identity
rather than by timing. Production clearing stays unchanged until then.

---

## Not in this queue

Everything else registered in `tests/run-all.sh` runs offline and was run at the
2026-09-08 checkpoint — 41 of 42 suites, all green. Anything reported as "not
rerun" must name which of these six entries it falls under, or it was simply
not run.

## Signed-in eBay continuation (D5 §8.3) — open, owner-run

The four checks in `audit/d5/D5_SIGNED_IN_VERIFICATION.md` §6 need a real
signed-in eBay seller account. No instrument exists in the build environment:
the cloud browser has no logins and this project does not collect marketplace
passwords. A logged-out baseline was re-taken 2026-09-08 and passes all four
questions, including the query surviving in the address bar; it is a comparison
point, not the answer.

Pre-committed consequences for each outcome are in §7 of that document, written
before the observation. Two of the five rows are blockers.

**Recurring pre-deploy check (Q-D5-3, ACCEPTED 2026-09-08).** The `title`/`caty`
parameters we depend on are undocumented eBay internals with no compatibility
promise, so a silent change on their side would otherwise surface as seller
confusion rather than as a failed check. Manual by necessity — it cannot be
automated without a signed-in session the build environment does not have.

Each run records:

| Field | Why |
| --- | --- |
| Date | A pass ages; eBay can change between deploys. |
| Account + browser context | The result belongs to a case, not to the product. |
| Landing screen — is our search and category displayed? | **The criterion.** |
| Offered match — can the seller compare a collector number? | **The criterion.** |
| Surface: mobile web **and** desktop | Both in scope (Q-D5-5). **Mobile is the priority** — it is the scan workflow, where a seller who just photographed a card is standing. **Desktop is retained** for saved-collection sellers working a list later. |
| Did it route into the eBay app? | **Recorded, not scored.** Opening the app is not a failure by itself; the destination and whether usable card details are in front of the seller decide the result, exactly as in a browser. An app run is a rendering surface we have never observed, so note it when it happens. |
| Final URL, verbatim | Evidence only. A missing query does not prove the inputs were discarded (eBay may consume them and redirect to a clean URL), and a surviving query does not prove they were used. |

**A pass establishes that tested case, not a continuing compatibility
guarantee.** The item stays in this queue after a successful run rather than
being struck off.

Pre-committed fallback if the inputs do not reach the workflow: keep a usable
generic eBay continuation with manual-copy instructions, keep the identity
instruction phrased to hold wherever eBay presents a selection, remove only
screen-assuming wording, and do not hunt for further undocumented parameters to
preserve prefill (D5 verification §7.2).

### Run log

| Date | Account / browser | Search + category displayed? | Match comparable? | Final URL | Result |
| --- | --- | --- | --- | --- | --- |
| 2026-09-08 | Owner, **iOS Safari mobile web** (not the eBay app); **signed in — owner-attested**, *"yes I was signed into safari"* | Yes, verbatim search and `caty=183454` category | Yes — `Charizard VMAX (Secret) 074/073 Champions Path Holo` | Not readable (Safari shows `ebay.com` only); evidence only, not a criterion | **Pass for that tested case.** Screenshot: `audit/d5/evidence/2026-09-08-signed-in-ios-safari.jpeg` |
