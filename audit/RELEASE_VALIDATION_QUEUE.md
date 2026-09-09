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

## ADJUDICATED 2026-09-09 — verdicts

Every entry below now carries a verdict: **passed**, **blocking**, or
**deferred with its limitation**. The offline and read-only items were finished
without waiting on credentials; three items that had been parked behind "needs
Playwright and a local server" were run on 2026-09-09.

| Item | Verdict |
| --- | --- |
| RV-1 grade response contract | **BLOCKING** — needs the deployed function |
| RV-2 T2.14 disclosure accessibility | **DEFERRED** — needs a real screen reader; dagger name still unverified |
| RV-3 eBay live suite | **BLOCKING** — Production-only credentials (G2) |
| RV-4 draft KV live | **BLOCKING** — no live KV binding (G1) |
| RV-5 flip completeness | **PASSED** — re-run 2026-09-09, 22 / 0 |
| RV-6 rendered ranking | **PASSED, narrowed** — re-run 2026-09-09, identical in 4 / 4 cases, two default-tier rows only |
| RV-7 D7 listing photos | **PASSED** — re-run 2026-09-09, 92 / 0; Safari/iOS limitation retained |
| RV-8 preview reads production KV | **BLOCKING** — decide before the first push (G1) |
| RV-9 the other eighteen live checks | **BLOCKING** — same gate as RV-3 |
| RV-10 containment mechanism | **BLOCKING** — control and scope not established |
| CH-1 published verification token | **BLOCKING** — G3; replacement token is step 3 of the rotation window |
| CH-2 code fallback to that token | **CLOSED IN CODE at `6c610e2`** — the literal is gone, the token is read at call time, and an absent token fails closed with `503 verification_token_unset`. Reaches production when the release deploys. *(An earlier row here said "prepared, not applied" — wrong, and corrected 15:12.)* |
| CH-3 unencrypted TPL key | **CLOSED at `c4ea5e4`** — #518 revoked, replacement verified by post-revocation lookups, storage type now `sensitive` (`3570d97`). Public and plain-storage exposures both closed. **Do not re-open; the TPL rotation is done.** Only G12 / R4 activation remains, tracked under release preparation. |
| Same-card basis retention | **DEFERRED** — product decision; consequence is disclosed, not silent |
| D5 §8.3 signed-in continuation | **PASSED for one tested case**; stays in the queue. Q-D5-5 desktop never exercised |

**4 passed · 7 blocking · 2 closed · 3 deferred.** Every blocking item is
credential-, configuration-, or deployment-gated. None is blocked on writing
more code. **Closed** means done and evidenced — CH-2 in code at `6c610e2`,
CH-3 by the completed rotation at `c4ea5e4`. Neither is owner work any more;
CH-2 reaches production with the release, and the only TPL item left is R4
activation (G12).

*Counts and verdicts in this table are current as of 2026-09-09 15:12 EDT.*
*Anything in the History and withdrawn sections below is dated evidence, not*
*live status — see the banner above those sections before treating an entry*
*there as a blocker.*

## RELEASE PREPARATION — the remaining items (opened 2026-09-09, corrected 15:12 and 15:25)

> **CORRECTION, and it is mine.** The first version of this section, written at
> 15:00, told the owner to perform a TPL rotation **that was already complete**,
> described CH-2 as an unwritten one-line edit **when the code change is
> committed**, and claimed the proxy is "metered but unenforced" **when
> enforcement off means not metered at all**. It also proposed budget numbers
> without accounting for the clustering in our own request shape, or for the
> provider-side 429 this session had already seen. A later revision then
> overstated that 429 as an established two-second window — corrected again at
> 15:25, and the standing description is that the provider's precise limit is
> **unknown**. Each error came from rewriting a summary against older
> prose instead of against the branch. The corrected text follows; the errors
> are named rather than quietly patched, because a release checklist that
> re-opens finished work is worse than no checklist.

RV-13's local implementation is complete and adjudicated; it is no longer the
head of this queue. What follows is, and **none of it is code**.

**Authorization recorded 2026-09-09 15:31 EDT:** Will granted permission to
push what Phase 1 needs. Recorded, and deliberately **not acted on yet** —
authorization was never the constraint here. The first Phase 1 push is gated by
containment (steps 11a/11b of the rotation checklist), whose control has not
been read yet, and that gate exists to stop a push from deploying into a shared
store. A standing permission does not remove a technical prerequisite, so the
push waits on containment rather than on consent.

Nothing below has been executed. Local implementation is not authorization, and
authorization is not readiness.

### Already closed — do not re-open

| Item | Closed by | Evidence |
| --- | --- | --- |
| **G11 / R1 — TPL key rotation** | `c4ea5e4` | **Key #518 revoked.** Three post-revocation lookups through www on novel terms with fresh cache keys returned 200, `x-vercel-cache MISS`, age 0 — with #518 dead, no other credential could have produced them. This is the one observation in the sequence that needs no inference. |
| **CH-3 — TPL key exposure** | `c4ea5e4`, storage at `3570d97` | Closed as worded: the **public** exposure and the **plain-storage** exposure are both closed. Storage type is now **`sensitive`** — write-only, not merely `encrypted`, because `encrypted` is readable back via `decrypt=true` and would have left the read-back path open. |
| **CH-2 — published token fallback** | `6c610e2` | **The change is written and committed.** `api/ebay-notifications.js` now reads `cleanCredential(process.env.EBAY_VERIFICATION_TOKEN) \|\| ''` at call time; there is no literal. An absent token fails closed with `503 verification_token_unset` and no `challengeResponse` field. It reaches production when the release deploys — that is deployment, not authorship. |

**TPL rotation needs no further action.** The only TPL item still open is
**G12 / R4 activation**, which is item 3 below.

### 1. eBay credential rotation and verification — the next owner task

The one credential task left. The procedure is written and self-contained
(`audit/ROTATION_EXECUTION_CHECKLIST.md`); the pre-flight configuration has been
read; the harness has been corrected so it no longer compares production against
the committed literal it was serving — it was agreeing with itself.

The verification token is **replaced with a fresh random value**, never the repo
literal nor that literal with the newline stripped: whitespace-cleaning a
published value leaves a published value in production. **CH-1** closes when
production stops serving the repo default and eBay's challenge completes against
the new token.

### 2. Deployment containment and non-production KV isolation

**Blocking, mechanism not yet established** (RV-8, RV-10). Non-production
deployments currently reach the same KV as production, so verification against
that store is both contaminating and unpersuasive. Isolation first; **the
verification then runs against the isolated store.** This gates the first push.
It does not gate item 1.

### 3. R4 activation — the activated deployment must carry both halves

**The requirement, stated properly: the deployment being activated must contain
both R4's implementation and its intended configuration.** Not "deploy first,
then configure" — that was too rigid, and it was mine. **Settings can be
prepared beforehand**, and preparing them early is the better order, because it
means the activating deployment is built with them already in place.

Two facts fix the shape of this:

- **The implementation is not in production.** `9aaf326` is what production
  runs, and `api/_tplBudget.js` **does not exist at that commit** —
  `git show 9aaf326:api/_tplBudget.js` fails. Variables set against it configure
  nothing, because there is no budget code there to configure.
- **Changing environment variables after a deployment requires a new deployment
  to carry them**, as the rotation already demonstrated: the replacement TPL key
  took effect only once a fresh deployment was built with it. **Reading a value
  at call time does not change this.** Call-time reads stop a warm instance
  freezing a value it read at module load; they do not pull a variable into a
  build made before the variable existed. I have conflated those two things
  before, so it is worth stating plainly.

**And "metered but unenforced" was false — withdrawn.** With
`TPL_BUDGET_ENFORCE` unset or `'0'`, `budgetMode` returns `DISABLED` and the
entire reservation block at `api/tpl-proxy.js:131+` is skipped: no reservation,
no counting, no KV cache read or write. Enforcement off is **R4 bypassed**, not
R4 observing quietly. The counters in the measurement section came from a test
fixture, not from a disabled production path.

So the order is:

1. **Containment and KV isolation** — ahead of the first Phase 1 push, per item
   2. Unchanged.
2. **Approve the values** (below). They may be set at any point from here on;
   what matters is that they are in place when the activating deployment is
   built.
3. **Verify R4 with enforcement enabled, against the isolated store.** This is
   where activation is actually proven: enforcement on, a real store, and
   non-production. `budgetConfig` treats `TPL_BUDGET_MAX` and
   `TPL_BUDGET_WINDOW_SEC` as the configured-ness test
   (`api/_tplBudget.js:55-56`), so until both are set `usable` is false whatever
   the others say.
4. **Prepare the production deployment with the approved values and the correct
   binding**, then activate it — both halves present in the same deployment,
   binding confirmed rather than inferred from configuration.

**Enforcement stays last, and is fail-closed by design.** With
`TPL_BUDGET_ENFORCE='1'` and no bound store, `budgetMode` returns
`ENABLED_UNBOUND` and every uncached lookup 503s
(`api/tpl-proxy.js:44-56,:123`). Correct behaviour, and a total outage if it
reaches production ahead of a confirmed binding.

#### The six settings — policy choices for your approval, not derived limits

| Variable | Proposed | Standing |
| --- | --- | --- |
| `TPL_BUDGET_MAX` | `400` | **Policy choice.** See the three caveats below. |
| `TPL_BUDGET_WINDOW_SEC` | `3600` | One hour. Matches the code default and keeps the arithmetic legible. |
| `TPL_PER_IP_MAX` | `60` | **Policy choice**, provisional. The one scripted session charged 5 calls for 4 cards; 60/hour is roughly twelve times that shape. A starting point with headroom, not a percentile. |
| `TPL_CACHE_TTL_SEC` | `21600` | 6 hours, mirroring `api/pricecharting.js:18` — the house precedent for the same class of paid lookup. |
| `TPL_STALE_TTL_SEC` | `86400` | 24 hours an expired entry stays servable as stale. Degraded prices beat a dead lookup. |
| `TPL_BUDGET_ENFORCE` | **last** | Enabled for the isolated-store verification at step 3; reaches production only in the deployment prepared at step 4. |

**Three things the 400 does not do**, stated because the first version of this
table implied otherwise:

1. **It leaves only 400 calls of daily headroom.** 400 × 24 = 9,600 against a
   10,000/day plan. That is a thin margin, and it is thin by construction rather
   than by evidence.
2. **It is one shared hourly limiter, and it does not cap account-wide usage.**
   The 9,600 figure holds only if that limiter is intact and is the sole path to
   the key. Another deployment, a direct caller, or any request that does not
   pass through this proxy spends from the same daily account total without
   touching the counter.
3. **An hourly cap does not control short bursts.** This holds on the
   arithmetic alone: a 3,600-second window cannot constrain what happens inside
   any few seconds of it, whatever the provider's rules turn out to be.

   **The provider's precise limit is unknown**, and my earlier phrasing here
   overstated it a second time after it had already been downgraded elsewhere in
   this file. What was observed during the rotation run is one 429 with the
   daily counter nowhere near 10,000, followed by successful retries
   (`c4ea5e4`). **One 429 plus later successes does not establish a two-second
   window, a call count, or any threshold** — a burst rule, a transient
   provider-side condition, and several other explanations all fit that single
   observation equally well. No further probing is warranted; establishing the
   rule would mean deliberately spending paid quota to demonstrate a limit.

   What survives, and is enough to matter for sizing: **our request shape can
   cluster.** The 180 ms debounce is shorter than a mid-word pause, and the
   graded path fires two adjacent calls from one user action. So clustering is
   real and an hourly cap is the wrong instrument for it, while the provider's
   response to clustering is **Unverified**.

All five numbers are **explicitly provisional** wherever stated. Refining them
from real traffic is a post-launch improvement, not a launch prerequisite:
collecting the traffic cannot be a precondition for the release that generates
it.

### 4. RV-11 — has local work available, and stays non-blocking

**Corrected: this was listed under "needs a deployed function or a live
credential." It does not, and its agreed severity stands.**

RV-11 is a **fail-open entitlement default plus a possible admin-reporting
undercount** — not a revenue-loss defect, and **non-blocking**. That severity was
already adjudicated and is not re-opened here.

The available local work needs no credentials and no account access: drive
`api/stripe-webhook.js` with **synthetic events and a mocked KV** in both
delivery orders — `checkout.session.completed` → `customer.subscription.created`
and the reverse — recording the final persisted `plan`. That establishes whether
a wrong label is possible at all and which order produces it. **If neither order
yields `pro_monthly` for an annual subscription, the Stripe/KV comparison is
unnecessary.**

The sequencing constraint is unchanged and load-bearing: **map the annual price
in code before touching the `|| 'pro'` fallback** at `api/_tier.js:113`. That
fallback is currently the only thing granting Pro to the annual price, because
the map has no entry for it. Tightening it first revokes access from every
legitimate annual subscriber the moment it ships.

### 5. Remaining release checks, then deployment authorization

The blocking entries in the verdict table: RV-1, RV-3, RV-4, RV-8, RV-9, RV-10
and CH-1, plus the live suites never run (`tests/ebay-live.mjs`,
`tests/test-scan.mjs`). They share one shape — each needs a deployed function, a
live credential, or a real store.

**Deployment is yours alone and must be explicit.** A push to `main`
auto-deploys, so there is no rehearsal step between authorization and
production. Nothing here should be read as asking for it.

### Where Phase 1 stands

**Roughly 90% complete — a judgment, not a computed figure**, recorded as one so
it is not later quoted as a measurement. What remains is **release
configuration and verification against what is actually deployed**, which no
passing local suite can substitute for.

---

### 2026-09-09 run records

- **RV-5** — `CR_E2E_URL=http://127.0.0.1:<port>/index.html node tests/flip-completeness-e2e.mjs`:
  **22 passed, 0 failed.** First run 2026-09-09 against `js/core.73a71fac.js`;
  **re-run 2026-09-09 15:00 against the current bundle `js/core.2cb1e377.js`,
  same result.** The bundle has been renamed four times since the first run, so
  the earlier citation is kept only as history.
- **RV-7** — `node tests/listing-photos.mjs`: **92 passed, 0 failed.** Same two
  runs, same result, current bundle `js/core.2cb1e377.js`. Limitation unchanged:
  headless Chromium only, and no storage-ceiling experiment.
- **RV-13 rendered outcomes** — `node tests/tpl-outcome-render.mjs` against
  `js/core.2cb1e377.js`: **150 passed, 0 failed** (was 136 at the previous
  packet; groups G and H and the panel-discrimination assertions were added
  since). Stable across two consecutive runs.
- **RV-6** — compared `HEAD~1` against `HEAD`, which is the right pair: the RC-1
  blank-shipping note is inserted immediately above the ranking. Rendered
  `.payout-rank-row` name/amount pairs **identical in all four cases**
  ($3.00 · $1.00 · $45.00 · $400.00). **Narrowing, stated rather than hidden:**
  the harness rendered the **two** default-tier rows, not the six-row Pro
  ranking of the 2026-09-08 run — the tier gate reads a module-scoped value that
  could not be lifted from page scope. Non-vacuous, but narrower. A first attempt
  returned **zero** rows and was discarded as vacuous rather than reported as a
  pass.

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
**Must be true:** 19/19 — **unchanged and not substituted.** The "currently
18/19" figure previously recorded here has **no run behind it**
(`audit/CARDRESELL_PLAN_AND_ROADMAP.md:657`: "reportedly at 18/19; this was not
re-run") and is withdrawn as a bar. The harness prints
`X passed, Y failed, Z warnings` and never a fraction, and at least four of its
nineteen happy-path checks exist only in one branch — so a clean run with a
moved category-tree version prints 18 passed / 0 failed, indistinguishable from
one real failure by that fraction. Judge individual checks, never the total. See
`audit/ROTATION_PLAN_BOUNDED.md` §1.
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
**Must be true:** 22/22. **Last run 2026-09-09 15:00 against `js/core.2cb1e377.js`: 22 passed, 0 failed.** (First run 2026-09-08, same result, against a bundle four renames older.)

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

---

## RV-8 — Preview and Development read production KV

**Established 2026-09-08** (`audit/ROTATION_GATE_ANSWERED.md` §2.2): every
KV/Redis variable on the `cardresell` project is a single row targeting
`production,preview,development`. One row carries one value, so preview and
development deployments read and write the **production** store. No key on the
project has more than one row, so there is no per-environment store.

**Exposure.** A preview deployment of a branch with an unfinished migration, a
bad key prefix, or a destructive fixture writes into the store serving
`www.cardresell.org`. The outgoing draft-persistence work writes by design, so
this is not hypothetical.

**Mitigation, weaker than first recorded.** `ssoProtection.deploymentType =
all_except_custom_domains` means previews are not publicly *reachable*. That is
access control, **not data isolation** — it constrains who can request a URL and
says nothing about what deployed code writes once running. A preview build with
a bad key prefix or an unfinished migration writes to the production store
whether or not a human opens it, and scheduled or webhook-triggered paths need
no browser at all. **The earlier "self-inflicted damage only" framing was too
strong and is struck.**

**Also struck:** the claim that separating environments would invalidate the
completed functional tests. It would not. Those tests assert behaviour against a
KV interface, not against a particular store; a new store requires **checking
the new configuration**, not re-earning the results. That was an invented cost
for the fix.

**DECISION REQUIRED BEFORE THE FIRST PUSH** — not after. A push automatically
creates a Preview, and the Preview is the exposure, so this cannot be resolved
afterwards. Chosen order (`audit/ROTATION_PLAN_BOUNDED.md` §3): **(1)** disable
automatic Preview deployment — one reversible project setting that removes the
trigger outright; **(2)** provision a separate non-production store, which is
the durable answer; **(3)** re-enable Previews. Step 1's cost is real: it removes
the only pre-production verification surface for as long as it lasts. Each step
needs its own concrete authorized action.

**Not a rotation item** — the rotation neither causes nor fixes it, and
redeploying the live commit does not create a Preview, so the rotation sitting
may precede this decision provided nothing is pushed.

---

## CH-1 — production eBay verification token is the repo's committed default

**Measured 2026-09-08** by an unauthenticated `GET` to our own public endpoint
(`audit/ROTATION_PLAN_BOUNDED.md` §0): production's challenge response matches
the repository's committed default token **plus one trailing newline**. Because
the deployed code is `process.env.EBAY_VERIFICATION_TOKEN || '<repo literal>'`
and the literal carries no newline, the environment variable **is set**, and its
stored value is the published default with stray whitespace.

Two defects in one variable: a **value published in the repository** is serving
production, and a **stray character** breaks eBay's endpoint validation against
a clean portal value. Replace with a generated value in eBay's portal and in
Vercel, and stop the code literal being a usable fallback. No value, fragment,
or hash recorded.

---

## RV-9 — the other eighteen live-harness checks are unverified

`tests/ebay-live.mjs` has never been run in this workspace: it requires
`EBAY_APP_ID` and `EBAY_CERT_ID`, which are Production-only in Vercel and absent
here. Only check 19 (`deployed challenge hash matches the CLEAN token`) has been
established, and only because that one needs no credential. The rotation run
establishes the baseline for the remaining eighteen as much as it confirms the
new credential.

---

## CH-2 — the production code fallback to a published token

`api/ebay-notifications.js:17` still reads
`cleanCredential(process.env.EBAY_VERIFICATION_TOKEN) || '<repo literal>'`. The
literal is a value committed to the repository, and CH-1 established production
was serving it. **The environment change in the rotation window does not remove
this**, so an unset or cleared production variable silently falls back to a
published value.

Code change, tracked separately from the rotation. After the harness edit of
2026-09-09 the literal appears in exactly one place in the tree — this line.

---

## CH-3 — `CARDSELL_TPL_KEY` is stored unencrypted

Observed 2026-09-09: three project variables are `type: plain` rather than
`encrypted` — `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY`, and
`CARDSELL_TPL_KEY` (targets `production,preview,development`). Plain rows have
their values returned in cleartext by the project detail endpoint, and one such
value was displayed in agent working output while reading Git deployment
settings. It was not written to any file, but treat it as exposed.

If `CARDSELL_TPL_KEY` is a live API key: re-create it as an **encrypted**
variable (Vercel cannot convert in place — delete and re-add) and **rotate** it.
The two `BLOB_*` rows are store identifiers, not secrets, and can stay.

Not part of the rotation window, which is already changing two credentials.

**Assessed read-only 2026-09-09 — `audit/CH3_TPL_KEY_ASSESSMENT.md`.** The key
is the paid TCGPriceLookup key (`api/tpl-proxy.js:18,:44`). The route is
**anonymous and unmetered**: no caller verification, no usage limit, and every
query param forwarded verbatim (`:32-37`), so the `s-maxage=300` edge cache
(`:50`) is bypassable with any junk param. Calibrated: the deployed client sends
only `path`, `q`, `game`, `limit` with no cache-buster, so this is abuse
potential, not active bleeding. Whether it has been abused is **Unverified** —
provider dashboard and Vercel invocation records, owner-side.

**CORS is not the boundary** — origin and `Referer` are client-asserted and do
not constrain direct requests. Withdrawn as a proposed control.

**Class of two, not one:** `api/pricecharting.js` also holds a paid key while
anonymous, but reads named params and caches 6h in KV (`:18,:35,:446-462`), so
its exposure is first-time lookups only. It is the model for the remedy, and
`api/scan.js:1,:785-797` (verify + atomic credit debit) is the stronger house
pattern. Also a **terms** question given the open PriceCharting negotiation, not
just a cost one.

**Remedy R1 rotate at provider (owner) · R2 named param allow-list, provably
behaviour-preserving · R3 stop caching failures · R4 KV cache + cap, blocked on
KV isolation.** Q-CH3-1..4 await owner answers; R2–R3 await authorization.

---

## RV-10 — containment mechanism unverified

`audit/ROTATION_EXECUTION_CHECKLIST.md` §4. The "disable automatic Preview
deployment" toggle named in the earlier plan was **not established to exist with
that scope**. What the project exposes is
`gitProviderOptions.createDeployments: "enabled"`, which appears to govern
Git-triggered deployments **as a whole, production included** — broader than a
preview-only switch. `link.deploymentEnabled` is unset, and reading that as
"default enabled" is an inference, not an observation.

Verify the exact control and scope in the dashboard before relying on it. If it
suppresses production deployments too, that must be understood before the
maintenance window, which needs to deploy.

### What RV-10 gates — corrected 2026-09-09

This has drifted twice, in the same direction each time, so it is stated as a
table rather than a sentence:

| Gated by RV-10 | **Not** gated by RV-10 |
| --- | --- |
| The **first push** to `main` — a push creates a Preview, and the Preview is the exposure | Rotating the eBay Cert ID or verification token **at the provider** |
| Containment **steps 11a–13** of the maintenance window | Rotating or revoking the TPL key at TCGPriceLookup |
| | **The exact-commit maintenance rebuild** — a deployment, separately authorized by the owner |
| | Reading a dashboard, choosing budget numbers, provisioning an isolated store |

**Struck, 2026-09-09 (second pass).** An earlier version of this table listed
"the rebuild **deployment**" in the gated column and justified it with the claim
that "the credential window contains no deployment." **Both are wrong.** The
credential window **does** contain a deployment — the exact-commit rebuild. The
rebuild sits outside RV-10 because the **owner authorizes it directly**, not
because it is somehow not a deployment. The tidier phrasing was doing work the
facts do not support.

**The surviving distinction:** containment gates **the push and steps 11a–13**,
and does **not** gate the separately authorized maintenance rebuild or the
provider-side credential work.

**Rotation comes first; containment comes second.** Both earlier drifts inverted
this, because containment reads like a precaution and precautions feel like they
belong at the front. Treating containment as a prerequisite for rotation would
hold an exposed credential open while waiting on a dashboard control nobody has
yet located — the exact failure containment exists to prevent.

**Containment does not revoke production-KV access from existing deployments or
from local development** — `KV_*`, `KV_URL` and `REDIS_URL` target
`development` from the same single rows. Keep both out of write-capable testing
until a separate store exists, and **do not run the deferred preview-surface
checks against production instead.**

## RV-11 — Unknown prices default to Pro; possible annual-count error

**Supersedes an earlier, wrong filing of RV-11**, kept in History at the foot of
this file. **My original claim was wrong.** I wrote that an annual subscriber "pays $89.99 and the
tier lookup returns nothing", and the reviewer, reasonably relying on that,
called it the most serious defect of the session and the only one where a seller
loses money to CardResell. **Neither is true.** I stopped tracing at
`api/_tier.js:58` \u2014 the line that returns `null` \u2014 and reported the null as the
outcome. It is not the outcome. Every consumer catches it.

**Four independent fallbacks, all landing on the correct tier.**

| Consumer | Line | What happens to the unmapped annual price |
| --- | --- | --- |
| `api/_tier.js` | `:113` | `priceIdToTier(priceId) \|\| 'pro'` |
| `api/pro-status.js` | `:114` | `metaTier \|\| priceMap[priceId] \|\| 'pro'` |
| `api/stripe-webhook.js` | `:111` | `\|\| undefined`, then \u2026 |
| `api/stripe-webhook.js` `storeProUser` | `:194` | `tier \|\| existing.tier \|\| 'pro'` |

An annual **Pro** subscriber therefore resolves to **`'pro'`**, which is the
**right** tier for the $89.99/yr plan. **No entitlement is lost, no customer is
owed a comp, and nobody needs contacting.** The read paths do have a fallback;
I asserted they did not without reading them.

**The rule the reviewer drew still holds \u2014 it just did not fire here.** "A
fallback on the write path without a matching fallback on the read path
manufactures unrecognized state" is a sound check. Applied honestly, the read
paths **each** carry a fallback, so the pair is not mismatched. The general check
is worth keeping; this instance is not an example of it.

### What is actually defective, at reduced severity

**1. The lenient fallback fails open, which is the inverse of what I claimed.**
`api/_tier.js:113` carries its own comment: *"any active sub with unknown price
\u2192 assume Pro"*. So an active subscription at **any** unrecognized price \u2014 a
retired plan, a discounted one, a mistake \u2014 is **granted Pro**. The system errs
toward granting entitlement, which is precisely **why** no one loses money, and
is a real risk pointing the other way. **Severity: worth a decision, not a
blocker.**

**2. `"undefined"` as a computed key \u2014 real, and masked.** `api/pro-status.js:108`
does create a literal `"undefined"` key mapped to `'pro'`, so a subscription with
a **missing** price ID collides with it and resolves to Pro. Its effect is
currently invisible because `:114`'s `|| 'pro'` would return `'pro'` anyway. The
reviewer's instinct to trace it before a fix ships was right; the trace shows it
**writes nothing on its own** \u2014 it is a lookup map, rebuilt per request, never
persisted. **No record cleanup is implied by this key.**

**3. The one durable-record concern that survives \u2014 and it is about reporting.**
`storeProUser:193` persists `plan: plan || existing.plan || 'pro_monthly'`, and
the `subscription.created` branch at `:116` passes `plan` as **`undefined`**. So
an annual subscription can be written to KV as **`'pro_monthly'`**. That matters
because `api/admin.js:135` counts annual subscribers as
`if (data.plan === 'pro_annual') proAnnual++` \u2014 so **the admin annual count can
undercount**, showing fewer annual subscribers than exist.

**Unverified, and order-dependent:** `api/stripe-annual-checkout.js` does set
`pro_annual` in metadata, and `api/stripe-webhook.js:78` reads
`obj.metadata?.plan || 'pro_monthly'`. Whether the final persisted value is
correct depends on **webhook delivery order** between `checkout.session.completed`
and `customer.subscription.created`, which **cannot be established from the code
alone**. So: the undercount is **possible, not demonstrated**.

**Corrected severity: RV-11 is a fail-open entitlement default plus a possible
admin-reporting undercount. It is not a revenue-loss defect and not the most
serious finding of the session.** It should not be sequenced ahead of the
rotation on the strength of my original claim.

**What Stripe would still settle** \u2014 read-only, and now for a different reason
than comping anyone: whether any annual subscriber exists, and whether their KV
`plan` reads `pro_annual` or `pro_monthly`. That converts item 3 from possible to
measured. Worth doing before any fix, since the fix differs if records are
already wrong.

### Sequencing, per the reviewer

**Map the supported annual price *before* touching the fallback.** The order is
load-bearing, not stylistic. `|| 'pro'` at `api/_tier.js:113` is currently the
**only** thing granting Pro to the annual price, because the map has no entry for
it. Remove or tighten the fallback first and every annual subscriber loses access
the moment it ships. So: **add the mapping, verify annual resolves through the
map rather than the fallback, and only then decide whether the fallback should
keep failing open.** A cleanup done in the other order revokes legitimate access.

### The annual-count question needs both sources, not Stripe alone

Corrected: I implied Stripe would settle it. It cannot. Stripe establishes
**which subscriptions exist and at what price/interval**; KV holds the
**`plan` label** that `api/admin.js:135` counts. The defect is a **disagreement
between the two**, so it is only visible by comparing them. Stripe alone shows
subscriptions; KV alone shows labels with nothing to check them against.

**And the delivery-order question is testable locally, without either.** The two
orders are `checkout.session.completed` → `customer.subscription.created` and the
reverse. Both can be driven against `api/stripe-webhook.js` with synthetic events
and a mocked KV, recording the final persisted `plan`. That establishes **whether
a wrong label is possible at all**, and which order produces it, with no account
access and no authorization. **Do this first** — if neither order yields
`pro_monthly` for an annual sub, the Stripe/KV comparison is unnecessary.

**The fix recommendation stands but is no longer urgent:** map the constant in
code so one behaviour has one implementation. It now also wants a decision on
whether `|| 'pro'` should keep failing open.

## History — RV-11 as originally filed (RETRACTED 2026-09-09, superseded)

> **HISTORICAL EVIDENCE — NOT LIVE STATUS.** Everything from here to the end of
> this section is a dated record of what was believed at the time, kept because
> the reasoning that retracted it is worth as much as the finding. **Do not
> re-open anything below as a blocker.** Live status is the verdict table at the
> top of this file, which is dated. If a statement here and a statement there
> disagree, the table wins, and the disagreement is the point of keeping both.


**Not a blocker. Not current. Retained only so the correction has something to
point at.** Every factual claim in this block was disproved by the trace in the
current RV-11 entry above: the read paths each carry a fallback, so annual
subscribers resolve to `'pro'` and no customer is owed anything. Read the
current entry for the live findings.

<details>
<summary>Original text, preserved unedited</summary>

### (retracted) Annual subscribers are charged and resolve to no tier

Found by the sweep the reviewer asked for. **This is a live production path**, not
branch work: `git diff 9aaf326 HEAD` is **empty** for all three files below, so
the code described here is what `www.cardresell.org` runs today.

**The chain, each link at `file:line`.**

1. `STRIPE_PRICE_ANNUAL_ID` is **absent from the Vercel project** (40 vars
   enumerated, name-only read). Nothing sets it.
2. `api/stripe-annual-checkout.js:20` therefore sells the annual plan at a
   hardcoded constant: `const priceId = process.env.STRIPE_PRICE_ANNUAL_ID || ANNUAL_PRICE_FALLBACK`,
   where `ANNUAL_PRICE_FALLBACK` is defined at `api/stripe-annual-checkout.js:10`
   as the **$89.99/yr** price. **Checkout succeeds** \u2014 the `503 'Payments not
   configured'` guard at `:21` is satisfied by the fallback.
3. `api/_tier.js:53` maps the annual price via
   `add(process.env.STRIPE_PRICE_ANNUAL_ID, 'pro')`, and `add` at `:51` is
   guarded `if (id)`. Unset \u21d2 **no entry is added**.
4. The fallback constant is mapped **nowhere**: a search for
   `ANNUAL_PRICE_FALLBACK` in `api/_tier.js` and `api/pro-status.js` returns
   **0 hits**. The price the customer actually bought at is not in the tier map.
5. `api/_tier.js:58` returns `map[priceId] || null`. So
   `priceIdToTier('<the annual price>')` \u2192 **`null`**.
6. `api/pro-status.js:108` has the same hole in a worse form: as a **computed
   object key**, `undefined` becomes the literal string `"undefined"`, so the map
   gains a `"undefined"` entry that can never match a real price ID.

**So a customer pays $89.99 for a year and the tier lookup for their
subscription returns nothing.** Sold successfully, entitlement not granted \u2014 the
purchase path and the recognition path disagree because only one of them has a
fallback.

**Exactly the shape already named twice.** `hasPacket` permanently false,
`buildListingPacket` with no caller, and now a price ID that only checkout knows
about. **Rule 2 \u2014 a silent null is the bug** \u2014 and this one is on the revenue path.

**What is established and what is not.**

- **Established:** steps 1\u20136 above, all at `file:line`, in production code.
- **Unverified:** what the downstream consumers do with `null`. `getUserTier`
  (`api/_tier.js:66`) has a KV fast path and a Stripe-by-email fallback; whether
  `null` degrades to `'free'` or is handled some other way is **not yet traced**.
- **Unverified:** whether any annual subscriber exists. With no revenue data I
  cannot say whether this has already cost a real customer their entitlement, or
  is latent. **It is not safe to assume latent.**

**Severity: blocking for the release, and it does not wait for the rotation.**
Independent of TPL, eBay and the KV gate.

**Two candidate fixes, both needing a redeploy, neither authorized.**

1. **Set `STRIPE_PRICE_ANNUAL_ID` in Vercel** to the same price the fallback
   already sells at. No code change; makes the map and checkout agree.
2. **Map the fallback in code**, so the constant is the single source for both
   paths.

Option 1 is smaller, but leaves two places stating the same price. Option 2
matches **Rule 1 \u2014 one business behaviour, one implementation**. **Recommend 2**,
with the constant imported by `_tier.js` rather than duplicated.

**Q-RV11-1 (owner):** which fix, and is either authorized to deploy? Until one
ships, **annual is being sold into a tier gap.**

</details>

## RV-12 — WITHDRAWN. Duplicates R3, which is already built and mock-tested.

> **HISTORICAL EVIDENCE — NOT LIVE STATUS.** Everything from here to the end of
> this section is a dated record of what was believed at the time, kept because
> the reasoning that retracted it is worth as much as the finding. **Do not
> re-open anything below as a blocker.** Live status is the verdict table at the
> top of this file, which is dated. If a statement here and a statement there
> disagree, the table wins, and the disagreement is the point of keeping both.


**Not a new defect. Not a queue item. Filed in error.**

The success-only fix **already exists on this branch**, and has since R3:

| Branch `api/tpl-proxy.js` | Behaviour |
| --- | --- |
| `:185` | `if (r.status >= 200 && r.status < 300)` → sets `s-maxage=300` |
| `:194` | `else` → `Cache-Control: no-store` |
| `:99, :124, :146, :155, :203` | `no-store` on validation failure, unbound budget, stale serve, exhausted/per-IP, and upstream throw |

So the production observation at `9aaf326` is **the symptom R3 was written to
fix**, and it belongs to R3's release, not to a new queue entry. **Correct
linkage: the rotation run produced the first live confirmation that the
unconditional header is real in production — evidence for shipping R3, not a
finding of its own.**

### The part that is worse than a duplicate

`api/tpl-proxy.js:183` on this branch already carries this comment, which I
wrote:

> *"Note the withdrawn claim: this does NOT mean a dead key was previously
> served for five minutes — Vercel's cacheable statuses exclude 401, 429 and
> 5xx, so most failures were never cached whatever we asked for."*

**I then re-made that exact claim in RV-12**, writing that one rate-limited
request "poisons that query for five minutes for every user" — against a
retraction already committed, in the file I was reading. Marking it "Unverified"
did not help: **the answer was not unknown, it was recorded, in my own code
comment.** The reviewer had to withdraw the same claim twice.

**Withdrawn: the poisoning consequence.** Vercel's cacheable statuses exclude
`429`, `500` and `502`, so the documented platform behaviour prevents it
([Vercel caching criteria](https://vercel.com/docs/edge-network/caching)). The
unconditional header is still worth correcting — because relying on an external
list of eligible statuses is fragile, which is what `no-store` at `:194` makes
explicit — but **there is no user-facing harm to claim**, and I should not have
described one.

### Two more corrections to the same run

**The burst-limit explanation is plausible, not established. Downgraded.** One
`429` followed by successful retries establishes **neither window, scope nor
threshold**. I wrote "short-window burst limit, not a daily quota" as though
observed; **one observation cannot separate those**, and it does not show that a
twenty-card session meets any limit. Hourly allowance and short-term pacing are
**different constraints**, and R4 sizing is not rewritten by this. **Recorded as:
one `429` occurred under concurrent lookups; cause Unverified.**

**And my freshness evidence was invalid.** I argued the payloads proved a live
provider call because they carried `tcgplayer_id`, `cdn.tcgpricelookup.com`
image URLs and a `last_price_update`. **A cache replays exactly those fields** —
they are payload contents, and payload contents cannot establish freshness. What
actually carried the rotation proof: **`x-vercel-cache: MISS` with `age: 0` on
terms never queried in the session**, so no edge entry could exist, plus **#518
already revoked**, leaving no other credential able to produce a `200`. **The
conclusion stands; that particular argument for it does not.**

---

<details>
<summary>RV-12 as originally filed (withdrawn — retained for the correction to point at)</summary>

### (withdrawn) RV-12 original text

**Production defect at `9aaf326`. Found during the TPL rotation verification, not
by review.**

`api/tpl-proxy.js` at `9aaf326`, lines 47\u201351:

```
res.status(r.status);                                    // upstream status, verbatim
res.setHeader('Content-Type', ...);
// Cache TPL responses at the edge for 5 min — big cost saver
res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
res.send(body);
```

**The header is set unconditionally, after the upstream status has been
applied.** A `429`, a `500`, a provider outage body \u2014 each is stamped
"cacheable for five minutes, serve stale for sixty seconds beyond that",
identically to a real 28 KB card payload. **The code draws no distinction
between a payload and an error.** The comment says "Cache TPL responses",
and the implementation caches TPL *responses* rather than TPL *data*.

**How it was found:** a live lookup returned `429` from the provider (a
short-window burst limit; `:47` passes the status through verbatim, which is how
the attribution was established). That surfaced the header being applied to it.

**Rule 2 applies:** the failure is not that an error occurred \u2014 it is that the
error is dressed as a cacheable success. If honoured, one rate-limited request
poisons that query for five minutes for **every** user, and `stale-while-
revalidate` extends it: the first user's `429` becomes everyone's answer, and
nothing on the read side knows the cached body is an error rather than a card.

**This is the reviewer's write/read asymmetry rule, and here it does fire.** The
write path labels an error as durable, and no read path distinguishes it. Unlike
RV-11, there is no lenient default catching it downstream.

### What is Unverified, stated plainly

**Whether Vercel's edge actually caches a `429`.** Its CDN honours caching
directives for a specific set of status codes, and `429` is not obviously among
them, so **the live blast radius may currently be nil**. I have not tested it,
and testing it means deliberately provoking repeated provider rate limits \u2014
consuming paid quota to demonstrate an abuse case.

**The code defect does not depend on that answer.** It relies on an undocumented
platform behaviour to be harmless, and a `500` or a `502`-shaped upstream body
may sit inside the cacheable set where `429` does not. **Severity: real, bounded,
and not release-blocking on current evidence.**

### Fix, and the one judgement call in it

Set the caching header **only for a successful upstream status**, and send an
explicit non-cacheable header otherwise. One behaviour, one implementation.

The judgement call: the existing comment calls the 5-minute cache a "big cost
saver", and it is \u2014 it is what keeps the daily counter far from 10,000. **The fix
must not weaken caching of real payloads while excluding errors.** Narrow the
condition to the status, not to the caching.

</details>

## RV-13 — FIXED ON BRANCH. Lookup failure no longer reads as "no such card"

**Status: implemented and mock-tested on `phase1-block-d`, in bundle
`js/core.2cb1e377.js`. Still present in the live bundle `js/core.569ff536.js`,
which is what production serves — so RV-13 stays in this queue until a push.**

The original filing overstated the blast radius (one caller was traced, seven
were asserted). That correction is kept in full below, and the fix does not
rely on the withdrawn part: the four input conditions are now held distinct at
the helper and rendered distinctly by **all eight** callers, measured in a
browser rather than argued from source — including the scan path, which was
Unverified in the previous version of this entry and is now driven through a
real production entry point. Fallback providers that never answer are handled
in the same pass; that was filed here as a separate gap and is now fixed,
because an uncaught rejection made the promised unavailable state unreachable.

`searchWithTPL` at `:297`:

```
if (!window.tplApiKey) return null;
...
if (!r.ok) return null;
const json = await r.json();
if (!(json.data && json.data.length)) return null;
```

**Every non-2xx becomes `null`.** A `429`, a `500`, a `502`, an aborted timeout
\u2014 all collapse into the **same value** the code uses for "this card does not
exist." Grepping `429` across both bundles returns **2 hits, both `429,#d`**,
an SVG path/colour fragment. **There is no rate-limit handling anywhere in the
client.**

**Rule 2, exactly as stated: the silent null IS the bug.** The seller who gets
rate-limited is not told to wait \u2014 they are told, in effect, that their card
isn't in the database. The rational response to that message is to **retype the
query**, which issues more lookups into the condition that caused it.

### This is the write/read asymmetry rule firing properly

Unlike RV-11, there is no lenient default catching it, and unlike RV-12 the
consequence needs no platform assumption:

- **R4 already produces distinguishable refusals** \u2014 `api/tpl-proxy.js:155`
  returns `'Too many lookups from this address'` with `reason: 'per_ip_limit'`,
  and `'Lookup temporarily unavailable'` with `budget_exhausted`.
- **The client discards all of it at `:303`.** `!r.ok \u2192 null`. The reason string,
  the status, the distinction between "slow down" and "not found" \u2014 none reaches
  the interface.

**So shipping R4 as built would add a spending control whose refusals are
invisible to the person they are refusing.** That is a defect in the pair, not in
either half, and it is the correct target of the burst observation \u2014 **not** the
per-IP number, which remains unresized and Unverified.

### CORRECTION — the seller-facing consequence was asserted, not traced

**The `null` proves the helper merges outcomes. It does not prove every screen
says "no such card", and I wrote it as though it did.** Tracing the eight
callers in `js/core.569ff536.js`:

| Caller | Guard | Established end state |
| --- | --- | --- |
| `:1459` generic `gameSlug` | `if (!data \|\| !data.length)` | **Renders `"${emptyMsg} Try a different name."`** — every failure mode reaches this |
| `:938` pokemon, `:1236` mtg, `:1489` yugioh | `if (tplData)` | falls through — **end state not established** |
| `:1336` lorcana, `:1420` onepiece | `if (tplData && tplData.length)` | falls through — **not established** |
| `:1074` pokemon-jp | no guard at the call | falls through to TCGdex / PokemonTCG.io fallbacks — **not established** |
| `:12258` scan | `if (tplHits && tplHits.length)` | falls through to other match strategies — **not established** |

**So the confirmed blast radius is one caller, not the interface.** The other
seven may mask the failure behind a fallback provider, may leave the dropdown
untouched, or may reach a different empty state — **unestablished, and that is
exactly what the mocked render must settle.**

**Now established (it was not, from the snippet I showed):** the `catch` block at
`:307` does `console.warn` then `return null`, so **thrown timeouts and network
failures merge into the same null** as a `429`. The merge is real across all
four input conditions; only the *display* varies.

**Severity: real loss of error information, to be corrected before R4
activation.** The interface-wide phrasing is withdrawn.

### `window.tplApiKey` — checked, not a finding

`js/config.20ebe911.js:4`: `window.CARDSELL_TPL_KEY = '__PROXIED__'; // sentinel
— real key stays server-side`. It is a **presence gate**, matching the earlier
record. **Not a credential, not a new finding**, and closed here rather than
left hanging as an open question.

~~**Open question:** whether `:297` reads a gate or a value.~~ **Closed** by
the paragraph above — it is the `__PROXIED__` sentinel, a presence gate. The
question is struck rather than deleted so the record shows it was answered.

### RV-13 — the fix, and what the browser actually rendered

**Bundle: `js/core.2cb1e377.js`** (renamed four times during this work, per
the content-addressed convention: `73a71fac` → `176e4a56` → `e9f21f4e` → `613f164a` → `2cb1e377`; only
`2cb1e377` matches its own content and only it is referenced by
`index.html:3837`).

**1. The helper stopped merging outcomes.** `searchWithTPL` returns a
discriminated result instead of `null`:

| Return | Meaning |
| --- | --- |
| `{ok: true, cards: [...]}` | provider answered with cards |
| `{ok: true, cards: []}` | **successful empty search** — the only case that may say "no matches" |
| `{ok: false, cards: null, reason}` | refusal or failure; `reason` ∈ `rate_limited` \| `budget` \| `unavailable` \| `network` \| `not_configured` |

The reason is read from R4's own JSON where R4 sent one — `per_ip_limit` →
`rate_limited`, `budget_exhausted` → `budget` — and derived from the status
otherwise (`429` → `rate_limited`). The `catch` path, the one that had been
merging thrown timeouts into the same `null`, yields `network`.

**2. Ten give-up points now route through one helper.** `tplOutcomeHtml(res,
emptyHtml)` returns the seller's original empty-state markup when the search
genuinely succeeded and returned nothing, and a temporary-unavailability panel
when it did not. One behaviour, one implementation — Rule 1. The panel carries
`data-tpl-state="unavailable" data-tpl-reason="<reason>"`, which is what the
suite asserts on rather than on copy wording.

**3. Successful fallback results are preserved.** The six game callers keep
their existing truthiness exactly — `(_tplRes.cards && _tplRes.cards.length) ?
_tplRes.cards : null` — so a TPL refusal still falls through to Scryfall,
PokemonTCG.io, TCGdex, ygoprodeck or Lorcana as before. **A TPL failure never
replaces another provider's working results with an error screen.** Case group
C proves it directly: TPL rate-limited, PokemonTCG.io answering, cards render
and no unavailability panel appears.

The Japanese path needed a decision, and it is recorded rather than buried: it
always synthesizes a usable eBay JP comps entry, so it *has* a successful
fallback result even when TPL refused. That result is kept, and the notice is
prepended above it — otherwise absent prices look like prices the card doesn't
have. **A judgement call, not a derived rule.**

**4. One judgement call at MTG's Scryfall 404.** When Scryfall says "no such
card" but TPL was unavailable, we cannot assert the card doesn't exist — the
temporary message wins over the 404's empty state. Deliberate; the alternative
is asserting an absence from an incomplete search.

### Rendered outcomes — `node tests/tpl-outcome-render.mjs`

**134 assertions, 0 failed** (two consecutive runs at this size; the earlier
81-assertion version was stable across five). Four input conditions are mocked
at the proxy boundary: `429` + `per_ip_limit`, `503` + `budget_exhausted`, a
transport-level abort, and `200` with `data: []`.

| Caller | 429 | budget | network | genuine empty |
| --- | --- | --- | --- | --- |
| `searchPokemon` | `rate_limited` | `budget` | `network` | its own "no cards found" |
| `searchPokemonJP` | `rate_limited` + JP comps kept | `budget` + kept | `network` + kept | JP comps, no notice |
| `searchMTG` | `rate_limited` | `budget` | `network` | "no Magic cards found" |
| `searchLorcana` | `rate_limited` | `budget` | `network` | "no Lorcana cards found" |
| `searchOnePiece` | `rate_limited` | `budget` | `network` | its own panel |
| `searchYugioh` | `rate_limited` | `budget` | `network` | "no Yu-Gi-Oh! cards found" |
| `searchTPLGame` (generic) | `rate_limited` | `budget` | `network` | "`${emptyMsg}` Try a different name." |
| **`_loadScannedCardExactImpl`** (scan/revisit) | `rate_limited` | `budget` | `network` | "no Pokémon cards found" |

For every failure condition the suite asserts four things: the rendered
`data-tpl-reason` matches the condition, the text does **not** tell the seller
the card was not found, the text tells them their input is still there, and
**`document.getElementById('searchInput').value` still equals what was typed.**
For the genuine-empty condition it asserts the opposite — **no** unavailability
claim, and a rendered not-found.

**The input-preservation assertion is now on the element, not on the copy.**
Wording that says "your search is still here" proves nothing; the value read
back from the input does. Adding that assertion immediately caught a real
interference the copy-level check had hidden — see the startup demo below.

### The eighth caller — established, through a production entry

`_loadScannedCardExactImpl` is not on `window`, and putting it there would be a
test-only production global, which is not allowed. So the fixture drives it the
way a seller does: `_restoreLastLoadedCard()` reads the `cr:lastCard:v1`
snapshot at boot and, when that snapshot carries a name but no `_fullCard` and
no grounded id, hands the card to `_loadScannedCardExact`. **That is the seller
revisiting a scanned card after a refresh** — a real path, no new global, and
seeding the snapshot also switches the first-visitor demo off by itself because
`_hasSavedCard` gates it.

What renders, per condition:

- **The scanned card is still presented.** The input holds `Mega Greninja ex`
  in all four conditions; nothing is erased.
- **`#scanMissPanel` reads "Live pricing unavailable"** and "This card loaded
  but we don't have live market prices" — recoverable phrasing, and it never
  claims the card does not exist.
- **The dropdown this path opens** (the scan path fires the same `doSearch()`
  Enter would) carries `data-tpl-reason` for all three failure conditions, and
  a plain not-found only for the successful-empty one.
- **No uncaught rejection escapes the scan path** in any condition.

**Cost of that revisit: 4 `/api/tpl-proxy` requests for one card.** The restore
hydrates twice — it detects that the panel was cleared and re-hydrates — and
each hydration runs the scan path and then its `doSearch`. Recorded as measured,
not defended.

**Two fixture shapes failed first, and both are recorded because they failed
differently.** Seeding `localStorage` from the loaded page and reloading: boot
code clears the key before the 400 ms restore timer, so nothing restored. One
page with an init script: the first condition restored and the next three did
not, so run 1 left state behind that suppressed the restore. Both looked
identical from outside — empty input, empty dropdown — which is also what a
genuinely broken scan path looks like. The case now runs **a fresh browser
context per condition**, and the successful-empty condition must still produce
a rendered not-found, which only happens if the path actually ran. That
assertion exists specifically so a silent fixture failure cannot be mistaken
for a passing product.

### Fallback providers that do not answer — FIXED (was filed as a separate gap)

Previously filed here as a robustness gap and left unfixed. It is fixed now,
because it made the promised state unreachable exactly when it was needed: an
uncaught rejection prevented the unavailability panel from rendering at all.

Three callers did a bare `await fetch(url)` on their fallback provider —
`searchPokemon`, `searchMTG`, `searchYugioh`. Two of them additionally read any
non-ok status as "no such card", which is the same conflation RV-13 fixed one
layer up. `searchMTG` also had an explicit `throw new Error('Scryfall ' +
status)`. Those are gone.

One implementation of "the provider might not answer", plus one adjudicator:

| | Meaning | Seller sees |
| --- | --- | --- |
| provider answered, ok | fallback completed | its own results, or the TPL outcome |
| provider never answered | `{ok:false, reason:'network'}` | "Could not reach the card database" |
| provider answered with a not-found status | genuine absence **for that provider** | TPL still decides whether an absence may be claimed |
| provider answered with any other error | `{ok:false, reason:'unavailable'}` | "temporarily unavailable" |

The not-found statuses are per provider and stated per provider: Scryfall uses
`404`; **YGOProDeck answers HTTP `400` when a name matches nothing**, so `400`
is an absence for that provider and only for it. Everything else non-ok is the
provider failing.

**This change caught a regression in itself.** The first version had the
adjudicator return the TPL outcome when the fallback had answered fine — which
meant that with TPL rate-limited and PokemonTCG.io answering normally, it
panelled over a working result set. That is precisely the failure the
preserve-the-fallback rule exists to prevent, and case group C failed on it
immediately. A completed fallback now returns `{ok:true}` and nothing else; the
caller's own give-up point still consults the TPL outcome to decide whether an
empty result may be called an absence. Two cases were wrong, the suite said so,
and both are recorded rather than quietly corrected.

Verified in the browser (case group F, four cases plus recovery):

- **Both providers failed** (TPL 429, PokemonTCG.io unreachable) → the
  unreachable-database state renders, no not-found wording, and the box still
  holds `charizard`.
- **TPL succeeded-empty and Scryfall unreachable** → `network`, not "no Magic
  cards found". This case previously rejected out of the caller and the seller
  saw nothing change at all.
- **YGOProDeck 500** → `unavailable`. Previously rendered "No Yu-Gi-Oh! cards
  found" — a provider failure told to the seller as an absence.
- **YGOProDeck 400** → a genuine no-match, and it says so. The discrimination
  has to cut both ways or it is just a blanket excuse.
- **No uncaught rejection escaped any caller** across those four cases
  (asserted on `pageerror`, not inferred).
- **Recovery:** the next request after a fallback failure succeeds and shows
  cards.

`searchLorcana` needed no change — `_getLorcanaCards` already had
`.catch(() => [])` — and `searchPokemonJP`'s fallback fetch was already wrapped.
`searchOnePiece` and `searchTPLGame` have no fallback fetch.

### Seller-session measurement — counted where R4 charges

**Two numbers have now been withdrawn from this section, and both were mine.**
First the twenty-call loop, which reported 1.00 requests per card without ever
typing, selecting or revisiting. Then the six-request session that replaced it:
it counted requests to `/api/tpl-proxy` and called them TPL demand. **They are
not.** `reserveUpstream` reads its cache *first* and returns `CACHE_HIT` before
it touches either counter (`api/_tplBudget.js:117-127`) — so a cache hit
increments neither the per-IP counter nor the aggregate allowance, and costs
nothing at the provider. Only a **miss** reaches `store.incr`, and only a miss
can become a paid call. Counting endpoint requests overstates paid demand and
mis-sizes the per-IP cap in the same motion.

The session is now metered where the charge happens. The fixture mirrors the
real key (`cacheKey`, `api/_tplBudget.js:78` — contracted params sorted, so
param order does not fork an entry) and caches successes only, as
`api/tpl-proxy.js:187` does. Three counters, never summed:

- **req** — requests that reached the endpoint
- **chrg** — cache misses: what R4 reserves against the aggregate allowance and
  counts against the per-IP cap
- **cach** — served from cache: not charged, not per-IP counted
- **fb** — mocked fallback-provider calls (pokemontcg.io and friends), a
  different budget entirely

| Seller action | req | chrg | cach | fb |
| --- | --- | --- | --- | --- |
| page load, before touching anything | 0 | 0 | 0 | 0 |
| typed "charizard ex" — 12 keystrokes 70 ms apart, then a 700 ms pause | 1 | 1 | 0 | 0 |
| selected the first printing | 0 | 0 | 0 | 0 |
| typed "blastois", paused 400 ms, finished it — one card, two pauses | 2 | 2 | 0 | 0 |
| selected that printing | 0 | 0 | 0 | 0 |
| typed "pikachu" | 1 | 1 | 0 | 0 |
| selected that printing | 0 | 0 | 0 | 0 |
| came back to the first card | 1 | **0** | 1 | 0 |
| selected it again | 0 | 0 | 0 | 0 |
| reloaded — the last card restores itself | 0 | 0 | 0 | 0 |
| typed "gyarados" while TPL had nothing | 1 | 1 | 0 | **1** |
| **total** | **6** | **5** | **1** | **1** |

Four cards, three selections, one revisit, one reload.

What this establishes:

- **The debounce holds.** Twelve keystrokes typed straight through cost **one**
  lookup. The same card typed across two pauses cost **two** — the boundary was
  crossed deliberately, because that is what exercises it.
- **Selecting a printing costs nothing.** The click path does not re-look-up.
- **Revisiting a card already looked up charges nothing** — one request, one
  cache hit, zero allowance, and it does not count against the per-IP cap
  either. Asserted on the counters, not assumed from the cache's existence.
- **Chargeable calls are strictly fewer than proxy requests** (5 of 6 here),
  which is the whole reason the two cannot be used interchangeably. The suite
  asserts that inequality so the distinction cannot quietly collapse again.
- **A reload after a selection costs nothing**, because the full card was
  persisted. The scan-revisit case costs 4 requests for the same gesture,
  because only a name was stored.
- **Fallback-provider traffic moves independently.** It stays at 0 while TPL
  answers, because a fallback is only consulted when TPL returns nothing.

**What it still does not establish.** One session shape is not a distribution.
**5 chargeable calls for 4 cards is the result of this scripted scenario and
nothing more — it is not a production ceiling.** Corrected 2026-09-09: an
earlier version of this section called it a ceiling on the grounds that
production shares one cache across sellers while the fixture's cache is
per-session. Shared caching does pull in that direction, but it is only one of
the forces. Different queries do not share entries, a retried or re-typed search
after `cacheTtlSec` expires is a fresh miss, and a seller who searches more
widely than this script charges more per card. Production demand can land above
this figure as easily as below it, and this run does not bound it in either
direction.

That is still enough to set the six `TPL_*` values as **explicitly
provisional** — a scenario-justified starting point that is honest about being
one. It is not enough to call them measured, and no wording here should imply
that it is.
Refining them from a real-traffic percentile is a post-launch improvement and
**is not a launch prerequisite** — collecting traffic cannot be a precondition
for the release that generates the traffic. What remains genuinely blocking is
unchanged and is configuration, not measurement: **the six `TPL_*` variables
are absent from Vercel, so none of these defaults are in force in production.**

No live request was made anywhere in this work. Providers and the proxy are
mocked throughout, successful-response caching is untouched, and no limit was
probed.

### Early input versus the startup demo — a defect, found and fixed

Waiting for the demo to settle kept the other cases honest and proved nothing
about a seller who starts typing straight away. Driving that case found a real
defect, and it was worse than a stale value.

`autoRunExampleCard()` writes "Charizard" into the search box, runs `doSearch`,
then **polls for up to nine seconds** for a dropdown row and clicks the first
one it finds. A seller typing inside that window had their own results clicked
for them: the fixture typed `pikachu`, and the box ended up holding
**"Pikachu ex"** — a printing chosen by the page, not by the seller, on a card
they were still mid-way through searching for. Everything downstream — the
price panel, the payout comparison, the listing draft — would have been built
from that unrequested selection.

Two guards, one rule: **once there is real input, the demo is over.**

1. **It will not clobber a non-empty box.** If anything is already in the search
   input when the demo starts, it returns without writing. This also removed a
   fixture flake in which the demo's own late write overwrote a case's text and
   failed a random caller each run — the same defect, one beat earlier.
2. **It abandons its poll the moment the seller touches the box** — `input`,
   `keydown` or `paste`, plus a value re-check immediately before the click,
   because the rows the poll is about to click may be *theirs*.

It returns `'abandoned'` rather than `false` in both cases: `false` means the
demo *failed* and the caller pulses the "Try Charizard" prompt, and a seller who
is already typing does not need to be pulsed at.

Verified in the browser (case group H, six assertions): the demo does write
"Charizard" before the seller starts, the seller's `pikachu` is in the box
immediately after typing, **it is still `pikachu` after the demo's poll window
closes**, no printing was chosen out of the seller's own results, their results
are still on screen to choose from, and no uncaught rejection escaped while the
two overlapped. Plus one that matters as much: **left alone, the demo still runs
and still selects the example printing** — a guard that silently disables the
feature it guards is not a fix.

### The scan panel now discriminates too

Adjudicated: the seller should not have to reconcile a generic panel against a
more precise dropdown, and this is inside RV-13's existing purpose rather than
new scope.

`_renderScanMissPanel` said **"Live pricing unavailable"** whether we had looked
and found no live price or had never completed the lookup. It took no lookup
outcome at all — it could not have discriminated. The scan path now keeps the
last TPL outcome it saw and hands it to the panel, which renders:

| Situation | Headline | Body | Attribute |
| --- | --- | --- | --- |
| lookup completed, no live price | "Live pricing unavailable" | unchanged — track it, check sold comps | `data-scan-price-state="no_price"` |
| lookup did not complete | **"Price lookup unavailable"** | the reason, then "This card loaded, so nothing is lost — we just could not finish checking its price. The sold-comp links below still work." | `data-scan-price-state="unavailable"` + `data-tpl-reason` |

The reason sentences come from `TPL_UNAVAILABLE_MSG`, the same vocabulary the
dropdown uses — one vocabulary, not a second one that can drift from it (Rule 1).

Case group G asserts this on the element rather than on the copy, in all four
conditions: the failed conditions carry `state="unavailable"` with the matching
reason, the successful-empty condition carries `state="no_price"` with **no**
reason and does not claim the lookup failed, and **panel and dropdown agree on
the reason** in every failing condition. That last assertion is the one that
would catch the two surfaces drifting apart again.

### Follow-up — the four-request scan revisit (not a release blocker)

Adjudicated as a follow-up optimization: request count alone does not make it a
release blocker. **How many of those four requests are charged in production is
unmeasured** — an earlier version of this section asserted they would be "mostly
cache hits in production, where the cache is shared." That was an inference from
the cache's existence, not a measurement, and it is withdrawn. What is measured
is the request count below.

Revisiting a scanned card costs **4 `/api/tpl-proxy` requests** because the
restore hydrates twice — it detects the panel was cleared and re-hydrates — and
each hydration runs the scan path and then its `doSearch`. Measured, not
argued.

**The constraint on fixing it: card identity must survive.** The double
hydration is doing something. The restore path deals with a snapshot that has a
name, number, set and rarity but no `_fullCard` and no grounded id, and the
match strategies that resolve it — exact number, then leading-zero-stripped
number, then rarity+set — are exactly what keeps a revisit from silently landing
on a *different* printing of the same name. Any de-duplication has to keep the
resolved card identical to what the un-optimized path resolves, and that is the
test to write first: same snapshot in, same card id out, fewer requests. **Not
attempted in this pass.**
### Three things the suite found about the suite

Recorded because each produced a confident false result first, and a harness
that lies deserves the same scrutiny as code that lies:

1. **Route registration order.** Playwright resolves the **most recently
   registered** matching handler. A catch-all `**/api/**` alongside the specific
   `tpl-proxy` mock silently decides the outcome by registration order — the
   suite has no catch-all for this reason, and the same mistake reappeared in a
   scratch debug script and made the scan path look broken when it was not. The
   glob `**/api/tpl-proxy*` also matched nothing; the mock uses a regex.
2. **Reading `dropList` once was flaky** — some callers paint a "Searching…"
   placeholder first, and a different caller failed on each run. The read polls
   past loading states.
3. **The page writes to the search box on its own at startup.** The
   first-visitor demo overwrote the seller's text mid-case, and a random caller
   failed each run reporting the input as "Charizard". The element-level input
   assertion is what surfaced it; the copy-level check never could. Cases wait
   for the page to stop writing before asserting — **and this one turned out not
   to be a harness artefact at all.** Driving the case deliberately (group H)
   showed the same demo could overwrite, and then auto-select from, a real
   seller's input. It is fixed in the product, not worked around in the fixture;
   the section above records it. A flaky test was reporting a real defect.

### Questions for Will — RV-13

Both earlier questions here have been decided by you and are implemented above —
the four-request revisit is recorded as a follow-up optimization with the
identity constraint attached, and the scan panel now discriminates. What is left
is not a question about the work:

1. **Nothing is pushed.** This is branch-local: `phase1-block-d`, live bundle
   `core.569ff536.js` still has RV-13. Production still serves Phase 0 and still
   shows the old behaviour on all three of these — the generic scan panel, the
   demo that can overwrite early input, and the lookup failure that reads as
   "no such card". A push to `main` auto-deploys, so it waits on you saying so
   explicitly.
