# RC-1 — comparison copy and release checklist

**Date:** 2026-09-09 · branch `phase1-block-d`
**Nothing is pushed, deployed, or rotated.** No deployment authorization is
claimed or implied. This document is the single current execution view for the
Phase 1 initial release; the correction history that produced it is preserved
below the line at §H.

---

## A. Where the release stands

| | |
| --- | --- |
| Feature work | **Complete for this candidate.** D1–D7 closed. No further expansion. |
| Copy | **Closed.** Your wording is implemented and pinned (§H-7). |
| Offline suites | **47 registered suites recorded, 47 exit 0, one of them an explicit skip** (`draft-kv-live`). Per-suite record: `audit/evidence/suite-record.txt` (§D-1). |
| Browser verification | **Partial.** Three queue items ran today; **three named coverage gaps remain** — Pro-tier ranking, desktop signed-in continuation, Safari/iOS photos (§D-3). |
| Credential-gated verification | **Blocked.** Needs credentials, a live store, or a signed-in account (§D-2). |
| Code | **One item outstanding: CH-2**, prepared locally today, deliberately **not** in the maintenance rebuild (§D-4). |
| Configuration | **Blocked.** Production KV is shared with nonproduction; two credentials are exposed. |
| Remaining path | Six owner steps, one at a time (§E). |

**Correction to my last summary.** I wrote "every offline suite green" and
"none is blocked on writing more code." Both were too broad. The first was an
impression from twelve suites I had run, not a record of all of them — running
the full set individually found **two suites already red at HEAD**, both on
evidence shape rather than behaviour, now repaired and recorded. The second
ignored CH-2, which is unfinished code and is listed as blocking. The claim I
can defend is narrower: **what remains is one prepared code change plus
configuration and credentials.**

---

## B. Release gates

| # | Gate | State |
| --- | --- | --- |
| G1 | Production KV isolated from nonproduction — **including existing deployments and local copies**, not only the variable targets | **Open** — blocks G12 |
| G2 | eBay Cert ID rotated at the provider, production-only | **Open** — owner |
| G3 | Verification token regenerated, production-only | **Open** — owner |
| G4 | Exact live Phase 0 commit rebuilt with new configuration (**not** a promotion) | **Open** |
| G5 | `node tools/verify-challenge.mjs` PASSES — READY is not proof | **Open** |
| G6 | eBay portal save and challenge completed | **Open** |
| G7 | `bash tools/run-ebay-live.sh` recorded and adjudicated per check, never by total | **Open** |
| G8 | Containment control verified — gates **the first push and the containment steps 11a–13**, and does *not* gate the separately authorized maintenance rebuild or the provider-side credential work | **Open** — RV-10 |
| G9 | Release-validation queue adjudicated, warnings and skips explicit | **Adjudicated (§D).** Closes when its four blocking items close |
| G10 | §1 copy approved and implemented | **Closed** |
| G11 | TPL paid key rotated at the provider and stored non-plain — closes at **revocation of the old key** (§E-2d), not at generation | **Open** — owner. Plan now established, no outage needed (five key slots) |
| G12 | R4 activated: `TPL_BUDGET_ENFORCE=1`, KV store resolved, budget numbers set by Will — **and real-store verification recorded first (§E-3), so activation is not itself the first experiment** | **Open** — needs G1 + G11 + recorded real-store evidence |
| G13 | CH-2 published-token fallback removed — **in the later release, after the replacement token is verified in production**, never in the rebuild | **Prepared, not shipped** (§D-4) |

G11 and G12 exist because **disabling R4 is a scope choice and does not resolve
CH-3's exposure.** With R4 off and no rotation item, the exposed paid key would
have disappeared from the gate list entirely.

**One word corrected there: "cost".** The plan refuses requests at the ceiling
rather than billing past it, so the exposure's worst case is **lookup
denial-of-service until the midnight-UTC reset, not an unbounded bill.** The
gates stand unchanged — only the reason is now stated accurately.

---

## C. R4 — what actually ships, and in which mode

R4 ships **present and self-binding, activated by configuration, not by code.**
The earlier "ships inactive" phrasing contradicted G12 and is withdrawn: G12
requires activation, so the release cannot both require it and ship without it.
What is true is that R4 is **inert until `TPL_BUDGET_ENFORCE=1` is set**, and
setting it is G12's job.

Three modes, deliberately distinguishable in production:

| Mode | Condition | Behaviour |
| --- | --- | --- |
| `DISABLED` | `TPL_BUDGET_ENFORCE` unset or `'0'` | Passes through, exactly as before R4. **Unmetered by choice.** |
| `ENABLED_UNBOUND` | enforcement on, KV genuinely unconfigured | **503 `budget_store_unbound`**, `Cache-Control: no-store`, **no paid call**. |
| `ENFORCING` | enforcement on, store resolved | Meters, caches, and returns `budget_exhausted` at the cap. |

`budget_store_unbound` and `budget_exhausted` are separate reasons on purpose.
The first says the meter is missing; the second says the meter ran out. Reading
one as the other would hide a broken deployment behind a plausible cost message.

### The production binding — your point, and the fix

You were right that an injected mock proves only the calling path. Nothing on
Vercel calls `setBudgetStore`, so the store slot would have stayed `null` in
production and **every uncached lookup would have become
`budget_store_unbound` the moment G12 flipped enforcement on** — correct
fail-closed behaviour and a total outage at the same time.

`api/_tplBudgetStore.js` is the real KV-backed store, and
`api/tpl-proxy.js:resolveBudgetStore()` resolves it **lazily from the
environment on first use**. Lazy rather than at module load, because the offline
suite has to toggle configured and unconfigured states inside one process, and
because an injected store must still win so the existing sections are not
quietly testing a path production never takes.

**Verified with an isolated store, enforcement enabled, upstream mocked, and no
injection anywhere** — `tests/tpl-budget-offline.mjs` §12, 20 checks:

- KV reads as configured from the environment, and the mode reports
  **`ENFORCING`, not `ENABLED_UNBOUND`** — the check that would have caught the
  outage.
- An uncached lookup **returns 200 rather than 503**, calls the mocked provider
  exactly once, and spends allowance against a `tpl:budget:` key in the
  self-resolved store, with a TTL set on the window it created.
- An identical lookup is served from that store with **no second provider
  call**, and says `X-TPL-Cache: hit`.
- A cap of 2 is reached **through the self-resolved store**, returning 503
  `budget_exhausted` — not `budget_store_unbound` — and making no further call.
- With KV genuinely absent, the mode is `ENABLED_UNBOUND`, the paid call is
  blocked, and the reason is `budget_store_unbound`.
- An injected store still overrides environment resolution.

`tpl-budget-offline`: **101 passed, 0 failed.** No real KV, no real provider, no
quota consumed.

**Still open:** the store has never touched a real KV. G12 stays open, and
its first activation must **not** be the first time this code meets Vercel KV —
that is what the recorded real-store evidence in Step 3 is for.

**The budget numbers are no longer a blank, though.** `BUDGET_DEFAULTS` (max
1000 / hour, per-IP 60, 6 h cache, 24 h stale) remain **explicit placeholders,
not policy** — but the plan they must respect is now established rather than
Unverified: **Starter, 2,500 requests/day, midnight UTC reset, refused at the
ceiling.** Step 4 derives the values from that and shows the arithmetic. The
placeholder 1000/hour would permit **24,000/day against a 2,500/day allowance**,
which is the concrete reason it was never a recommendation.

---

## D. Release validation — adjudicated

Every item is classified **passed**, **blocking**, or **deferred with its
limitation**. I did not wait on credentials to finish the offline and read-only
items; three items that had been sitting behind "needs Playwright" ran today.

### D-1. Offline suite results — the complete record, not a sample

Run individually, never through `run-all.sh`.

**My last packet said "every offline suite green" on the strength of the twelve
suites below. That was a sample presented as a census.** So I ran **all 47
registered suite files**, one process each, and wrote a per-suite record with
timestamps and exit codes to **`audit/evidence/suite-record.txt`**. That file is
the citation; this table is a cache of it.

**And the first version of that record was itself wrong by omission** — it named
only `draft-kv-live` as skipped and said nothing about the four suites the
registry *declares* as excluded from the runner. Corrected accounting:

| | |
| --- | --- |
| Non-helper suite files on disk | **51** |
| Invoked by the runner | **47** — all exit 0 (52 slots; some suites own both a run branch and a SKIPPED branch) |
| **Declared exclusions** | **4** — not invoked, not counted, each stated below |
| Runtime skips within the 47 | **1** — `draft-kv-live` (RV-4). **A skip is recorded as a skip, never counted as a pass.** |
| Red at HEAD before today | **2** — both on evidence shape, one with fragility still open |

**The four declared exclusions, stated individually — exit zero cannot settle
any of them:**

| Suite | Disposition |
| --- | --- |
| **`ebay-live`** | **NOT RUN.** Not "excluded by me" and not "skipped by the runner" — it is **not invoked by `run-all.sh` at all**, and I did not run it separately. Invoked bare it **self-skips and exits 0**, which is exactly why exit zero could never have settled this. **Deliberately not run now:** the local Cert ID is the pre-rotation credential slated for G2, and this run *is* G7's baseline, to be taken **after** rotation. Running it now would spend live quota on a credential about to be revoked. Its declared note claims "currently 18/19" — treat that as a **historical** reading; it also sits uneasily with RV-9, which records only check 19 as ever established. |
| **`test-scan`** | **NOT RUN. Declared UNRESOLVED, not benign** — it cannot pass offline and needs an offline harness or an `EBAY_LIVE`-style gate. Same gap RV-1 records. |
| **`listing-photos`** | **Ran separately: 92 / 0.** Needs Playwright and its own server. Headless Chromium only (RV-7). |
| **`flip-completeness-e2e`** | **Ran separately: 22 / 0.** Same Playwright dependency (RV-5). |

**What running the full set actually found.** Two suites were **already red at
HEAD before any of today's work**, and my narrower claim had concealed both:

- **`majors-flip-and-pack`** — three separate stale bindings. It lifted
  `_flipNetOf` out of the bundle **without its `_flipCompleteness` callee**, so
  it threw at first use; it asserted `hasCosts`, a field **deleted** when
  completeness moved into `_flipCompleteness`; and it grepped each write path for
  an inline `Math.max(0, parseFloat(…))` clamp that had been **consolidated into
  `_flipNetOf`** — Rule 1 working as intended, one behaviour in one place. That
  last one is worth naming: asserting the old text would have argued for
  *duplicating the clamp back into both callers.* Repaired to the standing
  pattern — name the behaviour, evidence the surface — and the clamp is now
  asserted **behaviourally** against the function that owns it (a negative fee
  clamps to zero rather than crediting back). **107 passed, 0 failed.** No
  production behaviour changed, and no assertion was deleted to reach green.
- **`condition-applicability`** — **an isolated pass with startup fragility that
  was not repaired.** 17 / 0 run alone; it crashed when run back to back with
  another server-starting suite in the same shell. I changed nothing about that:
  no port allocation, no teardown, no root cause established. The recorded line
  is the isolated run, and **the fragility is open.** It should not be described
  as simply green.

This is the third instance of the same defect shape in three days
(`fee-truth-offline`, then these two): **a green assertion resting on an
incidental textual arrangement rather than on the behaviour it names.** The
standing pattern exists for it; what was missing was running the whole set often
enough to see it.

The twelve suites cited in the last packet, unchanged:

| Suite | Result |
| --- | --- |
| `tpl-budget-offline` | **101 / 0** — includes the new §12 production-binding section |
| `tpl-proxy-offline` | 65 / 0 |
| `draft-review-screen` | 370 / 0 |
| `listing-packet-offline` | 232 / 0 |
| `review-fee-dl` | 21 / 0 |
| `copy-truth-offline` | all passed — includes the 12 RC-1 copy assertions |
| `payout-honesty` | 32 / 0 |
| `accuracy-fee-parity` | 41 / 0 |
| `contrast-tokens` | 12 / 0 |
| `decision-restatements` | 34 / 0 |
| `asset-fingerprints` | 72 / 0 |
| `test-registry` | 12 / 0 |
| **`fee-truth-offline`** | **PASSES.** Final outcome below. |
| **`ebay-notify-token`** | **22 / 0** — new today, the CH-2 suite (§D-4) |

**`fee-truth-offline` — final outcome.** **Green.** It was **already red at
HEAD before any RC-1 work** — confirmed by stashing the RC-1 changes and
re-running. It failed on **evidence, not behaviour**: two vocabulary reads were
pinned as adjacent template interpolations within 120 characters, and the
earlier refactor into `venueTaxNote()` broke that textual shape without changing
what a seller sees. Rewritten to the standing pattern — name the behaviour,
evidence the surface: the helper reads the shared vocabulary, the ranking takes
its note from the helper, and each literal string occurs exactly once. No
production behaviour changed to make it pass.

### D-2. Queue adjudication

| Item | Verdict | Basis / limitation |
| --- | --- | --- |
| **RV-1** grade response contract | **BLOCKING** | Needs a grade scan against the deployed function. `tests/test-scan.mjs` has no offline harness, so nothing here can substitute. The risk is precisely a silent one: `_crGradingScope` falls back to a WeakMap when `analysis_id` is missing, so a source assertion cannot see the failure. |
| **RV-2** T2.14 disclosure accessibility | **DEFERRED** — limitation stated | Needs a real screen reader. `page.accessibility` is absent from the installed Playwright build, so no automated proxy exists here. **The dagger's accessible name remains unverified and is carried, not claimed.** Element presence is established; announcement is not. |
| **RV-3** eBay live suite | **BLOCKING** | Needs `EBAY_APP_ID` / `EBAY_CERT_ID`, Production-only. Gated behind G2. Adjudicate per check — the harness prints counts, never a fraction, and a clean run can print 18 passed. |
| **RV-4** draft KV live | **BLOCKING** | No live KV binding here. The only registered suite that cannot run in this sandbox. Gated behind G1. |
| **RV-5** flip completeness, real record path | **PASSED** | Re-run today against the current bundle: **22 passed, 0 failed.** Explicit zeros survive reload as complete, a blank cost stays provisional through reload and aggregate, a pre-tracking record stays untracked with no invented missing-field list, and all three stay distinguishable in the export. |
| **RV-6** rendered ranking across the change | **PASSED, with a stated narrowing** | Re-run today comparing `HEAD~1` against `HEAD` — the RC-1 blank-shipping note is inserted immediately above the ranking, so this is the right comparison to make. Rendered `.payout-rank-row` name/amount pairs **identical in all four cases** ($3 · $1 · $45 · $400). **Limitation:** the harness rendered the **two** default-tier rows, not the six-row Pro ranking recorded on 2026-09-08; the tier could not be lifted from page scope. The check is non-vacuous but narrower than the original run. |
| **RV-7** D7 listing photos | **PASSED, with the Safari limitation retained** | Re-run today against the current bundle: **92 passed, 0 failed** — store transaction, real file picker, reorder across a full reload, missing-photo tile, the 12 cap attributed to CardResell, failure leaving the prior collection intact, and no request body. **Limitation unchanged:** headless Chromium only. It says nothing about Safari or iOS, which is exactly where the storage behaviour that motivated the browser-local design is most likely to differ. No storage-ceiling experiment was run, by decision. |
| **RV-8** Preview and Development read production KV | **BLOCKING — decide before the first push** | A push creates a Preview, and the Preview is the exposure, so this cannot be resolved afterwards. SSO protection is access control, **not data isolation**: a preview build with a bad key prefix writes to the production store whether or not anyone opens it. This is G1. |
| **RV-9** the other eighteen live-harness checks | **BLOCKING** | Only check 19 has ever been established, and only because it needs no credential. The rotation run establishes the baseline for the remaining eighteen. Same gate as RV-3. |
| **RV-10** containment mechanism | **BLOCKING** | The "disable automatic Preview deployment" toggle was **never established to exist with that scope**. What the project exposes is `gitProviderOptions.createDeployments`, which appears to govern Git-triggered deployments **as a whole, production included**. Read-only inspection has gone as far as it can; the exact control must be identified in the dashboard **before** a window that needs to deploy. |
| **CH-1** production verification token is the repo default | **BLOCKING** | Measured: production's challenge response equals the committed default **plus a trailing newline**, so the variable is set to a published value carrying stray whitespace. Closed by G3. |
| **CH-2** code falls back to a published token | **BLOCKING — code. Now written locally, and deliberately not shipped** (§D-4) | Was `api/ebay-notifications.js:17`. Prepared today, held out of the rebuild, lands after the replacement token is verified. |
| **CH-3** `CARDSELL_TPL_KEY` stored unencrypted | **BLOCKING** | Assessed read-only. The route is anonymous and unmetered, and every query parameter is forwarded verbatim, so the edge cache is bypassable. The deployed client sends no cache-buster, so this is **abuse potential, not observed bleeding**. Whether it has been abused is now **substantially answered for the current window**: the owner's 2026-09-09 dashboard reading showed **1 of 2,500 daily requests used**, so there is no sustained draw. Earlier days remain unestablished — a daily counter against a midnight-UTC reset cannot speak to history. **The plan is Starter, 2,500/day, blocked at the limit**, so the exposure's worst case is **lookup denial-of-service until midnight UTC, not an unbounded bill**. **R2 and R3 are built and included in the proposed release — nothing has shipped.** Production still runs `9aaf326`, which contains neither. **R1 rotation is G11 and R4 activation is G12**. CORS is withdrawn as a control: origin and `Referer` are client-asserted. |
| **Same-card basis retention** | **DEFERRED — product decision, not a defect** | The consequence is disclosed rather than silent: the review screen states `data-packet-basis="absent"` and flags a comp-derived price as owing a source. Retention is not obviously safe — reinstating a basis whose card is no longer certain recreates the leak the binding work exists to prevent. Production clearing stays unchanged. |
| **D5 §8.3 signed-in eBay continuation** | **PASSED for one tested case; stays in the queue** | 2026-09-08, owner-attested, iOS Safari mobile web: verbatim search and `caty=183454` displayed, comparable match shown. **A pass establishes that case, not a continuing compatibility guarantee** — these are undocumented eBay internals. **Q-D5-5 desktop has never been exercised** and remains open. |

**Score: 4 passed · 9 blocking · 3 deferred with limitations.**

**Correction to what I wrote under this table last time.** I said "none of them
is blocked on writing more code." **CH-2 is code**, and it is in the blocking
list, so the sentence contradicted the table directly above it. The accurate
statement: **eight of the nine blocking items are credential-, configuration-,
or deployment-gated; the ninth is CH-2, which is code, and which is now written
(§D-4) but held back from the rebuild by design.**

### D-3. What browser verification does *and does not* establish

The three items above establish **the named cases they ran**. They do not
establish browser verification in general, and I should not have summarised them
that way. Three gaps remain open, each stated where it belongs rather than
rolled into a total:

| Gap | Status | Why it matters |
| --- | --- | --- |
| **Pro-tier ranking coverage** | **Outstanding.** RV-6 rendered the **two** default-tier rows; the six-row Pro ranking recorded on 2026-09-08 was not re-rendered, because `_tierPlatforms` reads a module-scoped `_userTier` that cannot be lifted from page scope. | The comparison is non-vacuous but narrower than the original run. Pro sees four venues this check never rendered. |
| **Desktop signed-in eBay continuation (Q-D5-5)** | **Never exercised.** D5 §8.3 passed on **iOS Safari mobile web only**, owner-attested, one case. | The handoff relies on undocumented eBay parameters. A mobile pass is not a desktop pass. |
| **Safari / iOS listing photos** | **Limited.** RV-7's 92 checks ran on **headless Chromium only**. No storage-ceiling experiment was run, by decision. | Safari and iOS are exactly where the browser-local storage behaviour that motivated the design is most likely to differ. |

**So the defensible label is: "the named browser cases passed on the platforms
stated," not "browser verification is complete."**

### D-4. CH-2 — written, tested, and held out of the rebuild

You were right that CH-2 contradicted my summary, and right that it did not need
to wait on you. It is now done locally.

**The change.** `api/ebay-notifications.js` no longer carries the published
literal — it is gone from the source tree outside `./audit/`. Three specifics:

1. The token is read **at call time** (`verificationToken()`), not captured at
   module load. A module-load capture freezes the value for the life of a warm
   instance, which is how a rotated token can keep failing after the variable is
   corrected.

   > **This does not replace the redeploy, and must not be read as doing so.**
   > A call-time read only removes one *additional* failure mode — a warm
   > instance holding a stale value. It does nothing about the primary one: on
   > Vercel, **an environment-variable change does not reach any running
   > deployment at all.** The new value is only present in the process
   > environment of a deployment created *after* the change. So the sequence is
   > unchanged and non-negotiable: **change the variable, then deploy, then
   > verify.** Call-time reading makes the deployed code honest about what it
   > has; it does not give it something it was never handed. The same applies to
   > `CARDSELL_TPL_KEY` at 2c — which is why 2c is a redeploy and not an edit.
2. **GET fails closed.** No token → `503 verification_token_unset`,
   `Cache-Control: no-store`, and **no `challengeResponse` field at all**. The
   dangerous property of the old code was never that the value was published —
   it was that the failure was **invisible**: an unset variable produced a
   well-formed 200 with a correctly-computed hash over a token any reader of the
   repository could supply. Nothing in a health check would have flagged it.
   Rule 2: the silent fallback *is* the bug.
3. **POST stays open, deliberately.** A deletion notification is acknowledged
   whether or not the token is configured. Refusing one over *our own*
   misconfiguration would convert a configuration defect into a compliance
   failure. The challenge fails closed; the acknowledgement does not. That
   asymmetry is pinned by a test so it is not "tidied up" later.

**The tests.** New suite `tests/ebay-notify-token.mjs`, **22 passed, 0 failed**,
registered as runner slot 51 of 52 (`test-registry` re-derives the total: 12 / 0).
It pins the absence of the literal, the 503-with-no-response behaviour, that an
empty or whitespace-only value is treated as unset rather than hashed, that a
missing `challenge_code` is still **400** and not 503 (a caller's error and ours
must stay distinguishable), that stray wrapping still hashes to the clean value
— the exact shape CH-1 measured in production — and that **a configured token
produces the identical hash the pre-change handler produced.** That last one is
the point: the correction must not move the answer for a correctly-configured
endpoint, or completing eBay's challenge would depend on which version is
deployed.

**Where it does *not* go.**

| | |
| --- | --- |
| Maintenance rebuild (G4) | **Excluded by construction.** The rebuild deploys the **exact live Phase 0 commit**, which is hundreds of commits behind `phase1-block-d` and predates this change entirely. It cannot carry it, so exclusion does not depend on anyone remembering. |
| Later release | **Included — as G13, and only after G3 and G6 succeed.** Removing the fallback **before** a good token is in place would take a currently-working endpoint down. The order is: new token verified in production, *then* the fallback removal ships. |

---

## E. Your next steps — one at a time

Six steps, in order, and each one's result changes what the next should be.
**Step 1 is a single dashboard read** — that is all I need from you to keep
moving. Nothing below Step 1 is asked of you yet.

### Step 1 — DONE. The plan is now established, not Unverified.

You answered all five questions. This step is closed, and the numbers below are
**established fact** everywhere they appear in this document. No key values were
exchanged, which is exactly right.

**Updated 2026-09-09 — the second dashboard reading shows Pro active.** Both
readings are kept, because the transition is itself the evidence.

| Item | Earlier reading | **Current** |
| --- | --- | --- |
| Plan | Starter — 2,500/day | **Pro — 10,000/day** ("10,000 requests remaining today") |
| Daily usage | 1 used, 2,499 remaining | **0 of 10,000 (0%)**, "across all active API keys" |
| Reset | Midnight UTC | **Unchanged** — rendered as Sep 9 08:00 PM local, i.e. midnight UTC |
| Overage | **Blocked at the limit** (your confirmation) | Unchanged |
| Key overlap | 5 slots permitted, 1 active | **5 slots, 1 active** — and two keys now show **Revoked** |
| Licence | Commercial use needs Pro | **Satisfied** |

**Three consequences, none of them cosmetic:**

1. **Overlap is available.** Five key slots with one in use means 2a can generate
   the new key while the old one still serves. **The rotation needs no outage**,
   and the contingency I wrote for the no-overlap case is not needed.
2. **Overage is refused, not billed.** So exhausting the allowance is an
   **availability failure, not a bill.** This settles the wording problem for
   good: there is no per-request overage rate, therefore **no dollar figure to
   convert to.** The request-allowance framing is the only honest one available
   — see Step 4.
3. **The Pro upgrade carried a commercial-use licence, and it is now active** —
   so the compliance requirement is met, not merely planned.
4. **Revocation is demonstrated on this account, not assumed.** Two keys already
   carry a **Revoked** state, which is worth knowing before step 10 of the
   rotation performs one.
5. **The single active key is the exposed one** — Key #518, created Jun 28 2026,
   the value stored `type: plain`. CH-3 stays open until it is replaced and
   revoked. Pro changes the allowance; it does nothing about the exposure.

**No plan question remains.** The numbers below are recalculated for Pro — and
the hourly cap deliberately does **not** scale with the ceiling.

### Step 2 — The TPL rotation window: its own sequence, its own authorization

This was previously folded into the eBay window, which was wrong in two
directions at once. It would have absorbed a paid-key rotation into an
authorization you gave for an eBay maintenance rebuild, and — because the eBay
window is gated on things that have nothing to do with TPL — it also risked
leaving **the exposed key untouched** for as long as eBay stayed blocked.

**These are two independent credentials on two independent providers. They get
two windows.** This one needs Step 1's answers first and nothing else; it does
**not** wait on eBay, on G1, or on the maintenance rebuild.

| # | Action | Why in this position |
| --- | --- | --- |
| 2a | **Generate the new key** at TCGPriceLookup, old one still live | **Confirmed available** — five key slots, one in use. No outage is required, and the no-overlap contingency is withdrawn. |
| 2b | **Delete** `CARDSELL_TPL_KEY` and **re-add it encrypted** with the new value | Vercel **cannot convert a variable in place.** Re-adding is the only path, and it is why this cannot be a quiet edit. |
| 2c | **Redeploy a named target, then verify with `x-vercel-cache` plus the provider-side usage delta** — exact target and check below | "Redeploy" alone could ship 237 outgoing commits, and my earlier header check **could not fail**. Both corrected below rather than left to the moment. |
| 2d | **Revoke the old key at the provider** | **The step that actually closes CH-3.** Everything before it adds a good key; only this removes the exposed one. If the window ends here, the exposure is closed even if 2e never happens. |
| 2e | **Then** R4 activation (G12) — with Step 4's real numbers and Step 3's recorded real-store evidence | Enforcement is worth having, but it is a *mitigation*. It must not be mistaken for the remedy, and it must not delay 2d. |

**2d is the gate, not 2e.** A revoked key is the only state in which the
published value stops being usable. R4 with an unrevoked exposed key is a
speed limit on a road anyone can still drive.

**And a revoked or exposed secret is not a rollback target.** If 2c fails, the
rollback is a *newly generated* key, not the old one.

#### 2c in full — the exact target, and a check that can actually fail

"Redeploy" was doing far too much work in one word. Two distinct hazards:

**Hazard 1 — redeploying the wrong thing.** This branch is `phase1-block-d`,
**~237 commits ahead of `origin/main`**. A plain "deploy" here would ship all of
that as a side effect of a key rotation. That must not happen. The target is the
commit **already live**, redeployed only to pick up the new variable:

| | |
| --- | --- |
| Commit | **`9aaf326`** (`9aaf326e75b235ee500cf134eeb5f869f299b2a4`) |
| Existing production deployment | `dpl_AuwggY9YcPftJcqSnsztAw4qPfmT`, `READY`, created **2026-09-05T17:17:47Z**, ref `main` |
| Action | **Redeploy that deployment** — Vercel's "Redeploy" on that specific entry. Not a branch deploy, not a push, not `--prod` from this working tree. |
| Configuration it must carry | `CARDSELL_TPL_KEY` = the new value, **`type: encrypted`** |
| Must NOT carry | Any commit from `phase1-block-d`, and **not** the CH-2 change (G13) |

This is the same target as the exact-commit maintenance rebuild, and it is a
deployment — so it needs your authorization, and it is **not** gated by RV-10.

**Hazard 2 — a verification that could not fail. My earlier check was invalid,
and this is the correction.** I proposed: `200` with **no `X-TPL-Cache`
header** proves the provider was reached. It is wrong twice.

**It does not distinguish cache from function.** A CDN can replay a response
that never carried that header; absence is preserved on replay. So "absent" is
consistent with both "the function ran" and "the edge answered from five minutes
ago" — the exact distinction the check existed to draw.

**And the header does not exist at the target.** Decisive, and I should have
checked the deployed handler instead of reading the outgoing one:

| Fact at `9aaf326` | Evidence |
| --- | --- |
| `api/tpl-proxy.js` is **55 lines** | `git show 9aaf326:api/tpl-proxy.js` — 206 lines on this branch |
| **No `X-TPL-Cache` header on any path** | Its only cache line is `Cache-Control: public, s-maxage=300, stale-while-revalidate=60` at `:50` |
| `api/_tplBudget.js` **absent** | `git cat-file -e 9aaf326:api/_tplBudget.js` fails — R4 postdates this commit |

**The header would have been absent on every response — cached or fresh, good
key or dead key. The check could not fail.** Followed literally, it returns
"verified" unconditionally, and then 2d revokes the only key serving live
traffic. A self-confirming test immediately before an irreversible step.

##### The corrected check

**Signal 1 — `x-vercel-cache`, to exclude the CDN.** Documented values are
`HIT`, `MISS`, `STALE`, `PRERENDER`, `REVALIDATED`, `BYPASS`
([Vercel response headers](https://vercel.com/docs/headers/response-headers)).

| Response | Means |
| --- | --- |
| `x-vercel-cache: HIT` / `STALE` | Served by the CDN. **Proves nothing about the key.** |
| `x-vercel-cache: MISS` / `BYPASS` | Not a CDN replay. **Necessary, not sufficient** — the same docs note `MISS` "does not necessarily mean that a function ran", since runtime-cached `fetch` results can also present as `MISS`, and point to runtime logs instead. |
| `401` / `403` from the provider | New key wrong or not yet active. **Do not revoke the old key** — stop and fix. |

**Signal 2 — the deployed handler's own behaviour.** Once the CDN is excluded,
the 55-line handler at `9aaf326` has **no application cache to fall back on**:
no KV, no `_tplBudget`, no store. Every allowed path runs
`fetch(url, { headers: { 'X-API-Key': key } })` at `:44` and returns the
provider's status verbatim at `:46`. **This inference is specific to this
commit** — it would not hold on this branch's 206-line handler, and it is not a
general claim that a CDN `MISS` excludes an application cache.

**Signal 3 — the replacement key's own `Last used` timestamp. This is the
confirming evidence.** The dashboard lists each key with its own `Last used`
value, so verification can be **attributed to the specific key under test**
rather than inferred from an account-wide number. Record the new key's
identifier (its **Key #** — never the secret) and its initial `Last used`
state; after the verification request, that key's timestamp must **advance**.

**Why not the account-wide total — and this is not hypothetical.** The current
dashboard reading shows **Daily Usage 0 of 10,000** while the active key reports
**`Last used: Sep 9, 2026, 06:23 AM`**, roughly four hours earlier and inside
today's midnight-UTC window. The total covers all five possible key slots, moves
with real user traffic, and in that reading did not reflect a same-day use at
all — whether it lags or was reset by the plan change, I cannot tell from one
screenshot and will not guess.

**Had "the total must rise by exactly N" been the stop condition, that state
would have failed a working rotation** and sent me to generate another key to
fix a counter problem. The total is kept as **corroboration, not the decisive
signal.**

**If the new key's `Last used` does not advance:** wait briefly and refresh for
dashboard lag. If it still has not advanced, **stop and leave the old key
active.**

**Signal 4 — runtime logs**, confirming an invocation of `/api/tpl-proxy` at the
verification timestamp, as the documentation itself advises.

**The check now has two properties it lacked.** It can **fail** — a dead key
surfaces as a passed-through `401`/`403`. And a repeated identical request
returning `x-vercel-cache: HIT` is available as a **cache control**, showing the
signal distinguishes states rather than reading one constant.

**That control is diagnostic, not a pass criterion.** Once the replacement key's
own `Last used` has advanced, authentication is established. A repeat that stays
`MISS` is a **caching question to investigate separately** — it does not
un-verify a working key, and it is not a rotation failure.

**Request hygiene.** All params except `path` are forwarded verbatim
(`9aaf326:api/tpl-proxy.js:32-36`), so a novel query value varies the CDN cache
key *and* reaches the provider legitimately. Use a card not requested in the
previous five minutes rather than an invented parameter, which the provider may
reject. Note these verification calls **spend the shared daily allowance** and
bypass R4 — two or three requests of 2,500, which is verification, not abuse.

**Only after Signals 1–3 agree does 2d revoke the old key.** Revoking on a
cached `200`, or on an absent header that never existed, is precisely the
mistake this section exists to prevent.

---

#### TPL rotation — the short procedure

Ten steps, no branching. **Nothing here is authorized by the current review**;
this is the sequence to run when you say so.

| # | Step | Stop condition |
| --- | --- | --- |
| 1 | Generate the replacement key. **Leave the old key active.** | Five slots permitted, one in use — no outage |
| 2 | Record the **new key's identifier (its Key #) and its initial `Last used` state** — empty, or its creation time. **Never the secret.** Note the account total as background. | This is the baseline the decisive check compares against |
| 3 | In Vercel, **delete** `CARDSELL_TPL_KEY` and **re-add encrypted** with the new value | Cannot be converted in place |
| 4 | **Redeploy `dpl_AuwggY9YcPftJcqSnsztAw4qPfmT`** (commit `9aaf326`) from that deployment's own entry | **Not** a branch deploy, **not** a push, **not** `--prod` from this tree |
| 5 | **Capture the rebuild's own returned deployment ID and URL**, and confirm its commit is **`9aaf326`** | The redeploy produces a **new deployment**. `dpl_AuwggY9YcPftJcqSnsztAw4qPfmT` is the **source** to rebuild from, **not** the thing to test. Wrong commit → **stop** |
| 6 | **One** request to the **new deployment's URL from step 5** for a card not looked up in the last 5 min; capture full response headers | Expect **`200`** and **`x-vercel-cache: MISS`/`BYPASS`**. `HIT`/`STALE` → change the card and retry |
| 7 | Confirm **Vercel invocation logs** show `/api/tpl-proxy` on **that deployment** at that timestamp | Part of the pass criteria, not decoration |
| 8 | **Re-read the new key's own `Last used`. It must have advanced.** | Not advanced → wait briefly and refresh; still not advanced → **stop, leave the old key active** |
| 9 | Read the account-wide total | **Corroboration only.** A flat total does **not** fail the rotation |
| 10 | Confirm **`www.cardresell.org` resolves to the step-5 deployment**, then repeat step 6 against the live host | Alias unmoved → **stop.** Revoking now would strand production on the old key |
| 11 | **Revoke the old key** | **This is the step that closes CH-3** |

**The pass criterion is conjunctive — steps 6, 7 and 8 together.** No single
one of them is sufficient, and demoting the account total did not promote the
timestamp into a lone decisive signal:

| Signal | Alone it establishes | Alone it misses |
| --- | --- | --- |
| `200` + `MISS`/`BYPASS` (6) | The CDN did not answer from cache | Whether a function ran, per Vercel's own docs |
| Invocation log (7) | Our function executed | Whether the upstream call authenticated |
| Key's `Last used` advanced (8) | **That key** authenticated at the provider | Whether it was *this* request or concurrent traffic |

Read together they close each other's gap: the log ties execution to the
timestamp, and the timestamp ties authentication to the specific key.
**Any one of the three failing stops the procedure.**

**Optional diagnostic, not a gate.** Repeating the step-6 request should return
`x-vercel-cache: HIT`, confirming the cache signal discriminates. If it stays
`MISS`, **investigate caching separately** — a verified key is not un-verified
by it.

**Failure handling — and this is containment, not rollback.** A `401`/`403` at
step 5, or no timestamp movement at step 6, means **stop and leave the old key
active**. The old key was never deactivated, so there is nothing to restore and
no rollback step: continuing to serve on it is **containment while the problem
is diagnosed**. Generate a further replacement if needed. **The old key is
never revoked until some replacement has been verified**, and it is never a
target to restore *to*, because it is the exposed value.

**Cost.** One to three provider requests out of 10,000. These bypass R4 and
spend the shared allowance — the accounting, not an objection.

**Explicitly not in this procedure:** R4 activation (G12, needs Step 3's
real-store evidence and Step 4's numbers), the CH-2 change (G13), any
`phase1-block-d` commit, and any push.

---

### Step 3 — Isolate the store, then let me verify the binding on it

Provision a **separate non-production KV store** so Preview and Development stop
reading and writing the store behind `www.cardresell.org`. Every KV row on the
project is currently a single row targeting `production,preview,development`.

**Retargeting the variables is not the whole of G1, and I let that slip last
time.** Changing which environments a variable applies to says nothing about
consumers that already hold the production values. Three of them:

| Consumer | Why retargeting misses it | What closes it |
| --- | --- | --- |
| **Existing Preview deployments** | Each one was built with the production KV credentials **baked into that build**. It keeps using them when someone opens it, regardless of what the variable now targets. | Confirm no retained Preview deployment can still reach the production store — either the deployments are removed, or the store's credentials are rotated so the old ones stop working. |
| **Local copies** — `.env` files, shells, notes, anything pulled with `vercel env pull` | Nothing on the dashboard touches a developer machine. | Confirm the local copies are removed, and treat the values as **exposed** until the store credential is rotated. |
| **The production store credential itself** | It has been readable from non-production for the whole life of the project. | It is the only thing whose rotation makes every stale copy above simultaneously useless. |

**This is no longer hypothetical — I found one, in this sandbox.**
`cardresell/.env.production` exists here, 2,257 bytes, 43 variables. It is a
live local copy holding production credentials, and it is precisely the consumer
that retargeting the dashboard variables does not touch. **By name only, never
values**, it carries:

| Group | Variables present |
| --- | --- |
| **Production KV / Redis** | `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, `REDIS_URL` |
| **The exposed TPL key** | `CARDSELL_TPL_KEY` |
| **eBay** | `EBAY_APP_ID`, `EBAY_CERT_ID`, `EBAY_VERIFICATION_TOKEN` |
| **Payments** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, + 8 price IDs |
| **Other** | `OPENAI_API_KEY`, `CARDGRADER_API_KEY`, `BLOB_*` |

**On "never committed" — I inferred that from `.gitignore` and should not
have.** A `.gitignore` entry is not history; it stops *future* accidental adds
and says nothing about a file added before the rule existed, added with
`git add -f`, or present on a branch that predates it. This repository's history
has also been **rewritten** (a `refs/original/` filter-branch backup and
`refs/recovery/pre-scrub-c2366b2` both exist), which is exactly the situation
where "it's ignored, so it's fine" is worth nothing.

**Checked properly, and it does hold — by evidence now, not by inference:**

| Sweep | Result |
| --- | --- |
| `git log --all -- .env.production` and `-- '.env*'` | No commit in reachable history touches either path |
| Commits searched | **880**, across every ref including `refs/original/refs/heads/phase1-block-d` and `refs/recovery/pre-scrub-c2366b2` |
| Unreachable commits (`git fsck --unreachable`) | **9**, trees searched, no `.env*` entry in any |
| Unreachable blobs | **8**, none matching an env-file shape (`CARDSELL_TPL_KEY=`, `KV_REST_API_TOKEN=`, `STRIPE_SECRET_KEY=`, `EBAY_CERT_ID=`) |

**Bounded, as it should be:** this establishes it was never committed *in this
clone*. It cannot speak to a copy pushed from another machine, a fork, or a
provider-side secret-scanning event. Those would be visible on GitHub, not here.

**And local possession is not disclosure.** Three things follow, and I need to
separate them more carefully than I did:

1. **This file is why `ebay-live` reported "creds present: true / true"** when I
   invoked it. The suite would have run against production eBay with the
   **pre-rotation** Cert ID had it been given `EBAY_LIVE=1`. Another reason it
   stays not-run until after G2.
2. **It holds write-capable production KV tokens.** Any local script pointed at
   it writes to the store behind `www.cardresell.org` — the exact hazard G1
   exists to close, and it is open right now regardless of what the dashboard
   variables target.
3. **Retargeting `KV_*` to a new store will not change this file.** It must be
   deleted or repointed as its own action; deleting the file removes the copy,
   not the validity of what it contained.

**Correcting my own overreach: I wrote "every value in it stays exposed". That
does not follow, and it would license indiscriminate rotation.** Local
possession of a credential file is not evidence that its contents were
disclosed. The two must stay separate:

| | Evidence | Treatment |
| --- | --- | --- |
| **`CARDSELL_TPL_KEY`** | **Known disclosure**, independent of this file: stored `type: plain` and readable where it should not have been. That is CH-3. | **Rotate — evidenced.** |
| **Production KV / Redis tokens** | Readable from non-production for the project's life. **No disclosure evidence**, but the blast radius is a write-capable production datastore and rotation is the only thing that invalidates stale copies in old builds. | **Rotate — justified on blast radius and on G1's own requirement, and stated as that rather than as a breach.** |
| **eBay Cert ID and verification token** | Already scheduled for rotation as G2/G3, for reasons predating this file. | Rotate — **for the existing reason**, not because of this file. |
| **Stripe, OpenAI, CardGrader, Blob** | **Present in a local file. No disclosure evidence at all.** | **Do not rotate on this basis.** Handle the file; leave the credentials alone absent evidence. |

Rotating everything a credential file happens to contain would be expensive,
would churn live payment configuration, and would substitute activity for
analysis. The file needs **handling**; only the first two rows need rotation,
and only the first is a known exposure.

**Keep production credentials out of the isolated-store tests.** The real-store
verification must run against the **new** store's own credentials, supplied to
that test alone. It must not read `.env.production`, and the isolation work must
not become another consumer of the values it is supposed to retire.

I have not deleted the file: it is the only local record of which variables
exist, it is needed to reason about the rotation, and removing your credential
file unasked is not my call. **Recommend deleting it after Step 2 and Step 3
close, and rotating the KV store credential as part of Step 3 rather than only
provisioning a second store.** Say the word and I will remove it.

So G1 reads: **isolated, and the previous consumers demonstrably stopped using
production credentials.** Changing environment targets alone does not establish
that.

This unblocks RV-4 and RV-8. When it is done, tell me and I will run the
**real-store verification**: the R4 binding against the actual Vercel KV, with
enforcement enabled and the provider still mocked — the same shape as the
offline §12 proof, but meeting a real store for the first time. **That evidence
is a precondition of G12** (§B), so activation is never itself the first
experiment.

**One caution.** The earlier claim that separating environments would invalidate
completed functional tests was wrong and is struck. Those tests assert behaviour
against a KV interface, not a particular store. A new store needs its
configuration checked; it does not need the results re-earned.

### Step 4 — The budget numbers, now derivable from a real allowance

Step 1 closed the input, so this stops being a placeholder. **2,500 requests per
day, resetting at midnight UTC, refused at the ceiling.**

**First, two corrections to how I described this.**

**It is not a rolling window.** `api/_tplBudget.js:139` computes
`windowId = Math.floor(now / 1000 / config.windowSec)` and keys the counter
`tpl:budget:${windowId}`. That is a **fixed (tumbling) window aligned to the
Unix epoch** — with `windowSec: 3600` it resets on the hour, and it carries the
standard fixed-window burst behaviour: 100 calls at 10:59 and 100 at 11:00 is
200 inside two minutes. Calling it rolling was wrong and I have not verified any
claim that depended on the word.

**And "daily exhaustion is arithmetically impossible" is withdrawn.** The
multiplication is right and the conclusion does not follow from it. A guarantee
of that kind needs three things, and only one of them holds:

| Requirement | State |
| --- | --- |
| Compatible window boundaries | **Holds.** `86400 % 3600 == 0`, so epoch-aligned hourly windows nest exactly inside the midnight-UTC plan day — no straddle. This is the one part I can assert. |
| Durable counters | **Partly.** A store *outage* fails closed — `store.incr` throwing returns `STORE_DOWN`/`STORE_DOWN_STALE` and **no paid call** (`:148-152`, `:165-170`). But a store that is *available and empty* — evicted, flushed, or newly provisioned mid-window — restarts the counter at 1 and re-grants the hour's allowance. |
| **Every relevant request through the same limiter** | **Fails, and this is the one that breaks the claim.** |

**What shares the provider allowance while bypassing R4 entirely:**

- **Other keys on the account.** The allowance is per plan, not per key; five slots exist.
- **Old deployments.** Every previously deployed Vercel deployment stays invocable at its own URL, and `9aaf326` — the live one — has **no R4 in it at all** (§6b). Provider calls from there are uncounted by construction.
- **Local and non-production callers.** `.env.production` in this sandbox carries `CARDSELL_TPL_KEY`; any local run spends the same daily allowance.
- **The verification requests themselves,** including the ones in the rotation procedure below.

**So the honest framing:** 100/hour is a **proposed traffic limit that bounds
what the production function contributes**. It is not a guarantee against daily
exhaustion, because it does not sit in front of everything that can spend. With
that said, here is the arithmetic it rests on:

| Hourly cap | Saturated for 24 h | Headroom under 2,500 |
| --- | --- | --- |
| 104/hr | 2,496/day | 4 (0.2%) — technically safe, no margin for a reset-boundary straddle |
| **100/hr** | **2,400/day** | **100 (4.0%)** |
| 120/hr | 2,880/day | **overshoots by 380** — a saturated day exhausts the plan |

**Pro is now active (10,000/day) — and the recommendation stays 100/hr.** The
allowance did not quadruple because demand grew; it grew because a licence was
purchased. Multiplying the cap by four would convert all of it into exposed
traffic capacity and leave the same 4% margin I had on Starter:

| Hourly cap on Pro | Saturated for 24 h | Share of 10,000 | Unallocated |
| --- | --- | --- | --- |
| **100/hr (keep)** | 2,400/day | **24%** | **7,600/day** |
| 400/hr (×4) | 9,600/day | 96% | 400/day |

The unallocated 7,600 is not waste — it is the mitigation for exactly what the
limiter provably cannot cover, which is the reason the impossibility claim was
withdrawn: other keys, the still-live `9aaf326` deployment that contains no R4
at all, local callers, verification requests, the hour-boundary burst, and an
available-but-empty store re-granting a window. A limiter that cannot see those
paths should not be sized as though it were the only spender. **Raise the cap
when measured demand approaches it, not because the ceiling moved.**

**Recommended, and stated as a recommendation rather than a fact:**

| Variable | Value | Reasoning |
| --- | --- | --- |
| `TPL_BUDGET_MAX` | **100** | Caps the production function's contribution at 2,400/day if every hour saturates. **A traffic limit, not a guarantee** — see the three requirements above. |
| `TPL_BUDGET_WINDOW_SEC` | **3600** | Fixed hourly window, epoch-aligned, nesting cleanly in the UTC plan day. A daily window would let one burst consume the whole allowance by mid-morning; the tradeoff is the hour-boundary burst noted above. |
| `TPL_PER_IP_MAX` | **15** | **Unvalidated — blocks activation until a seller session is measured**, on Pro as much as on Starter. A per-IP cap protects individual users from each other; the plan size does not change whether 15 is the right number. See the sizing note below. |

**Why 15 per IP is not yet a defensible number.** The unit is **provider calls,
not seller actions**, and the live bundle spends more than one per action. There
are three distinct call sites: a search at `js/core.73a71fac.js:301`
(`/v1/cards/search`, `limit=100`), a by-id fetch at `:515` (`/v1/cards/<id>`),
and a second name search at `:533` (`limit=20`). A search-then-select flow
therefore costs **at least two** calls, so 15 is on the order of **seven seller
actions per hour** — not fifteen. And several users can share one IP behind
NAT/CGNAT or an office or campus network, in which case they share the 15
between them. A phone switching towers can also change IP mid-session.

**What would settle it:** instrument one normal seller session and count actual
provider calls per action, then size per-IP from the measured figure. Until
that exists, 15 is a placeholder with a slightly better argument than 60 behind
it — not a validated limit. The 6 h result cache reduces the real cost of
repeat lookups but does not change the sizing question for a first pass through
new cards.

Note the real variable name is **`TPL_PER_IP_MAX`** — an earlier draft of this
section said `TPL_BUDGET_PER_IP_MAX`, which does not exist
(`api/_tplBudget.js:52`). Setting the wrong name would have silently left the
placeholder 60 in force, which is the class of defect Rule 2 is about.

**The result cache does real work here.** Successes cache for 6 h with a 24 h
stale window, so repeat lookups of the same card do not spend allowance. The
100/hr ceiling applies to *provider* calls, not user actions.

**The dollar-cap question is closed, and only that question.** You confirmed
requests are **blocked at the limit**, not billed beyond it. So there is no
per-request overage rate for TPL and **no conversion to a dollar figure
exists.** Any earlier phrasing of this budget as a spending cap is withdrawn,
not softened.

**Scoping that correctly, because I overstated it last time.** The hard cutoff
resolves **TPL overage billing**. It does not resolve:

- **Other operating costs.** Vercel function invocations, KV/Redis operations
  and bandwidth are still consumed by traffic that TPL refuses to serve — a
  blocked provider call still ran a function.
- **Availability risk.** Exhaustion means card lookups stop working until
  midnight UTC. On a paid product that is a user-facing outage, and the fixed
  reset means it cannot be cleared early.
- **The other paid keys** on this route class — `OPENAI_API_KEY` and
  `CARDGRADER_API_KEY` — whose billing behaviour is **not** established by
  anything TPL does (§4).

So "hitting the cap is an availability event, not a cost event" is true **of
TPL's provider bill** and should not be read as a general statement about
running the service.

**On Pro.** 10,000/day supports **400/hr** on the same arithmetic (9,600/day
saturated, 4% reserve). If the upgrade completes, tell me and I will restate
these three numbers; nothing else in the sequence changes.

**The licensing question is answered — withdrawn as a question.** I asked
whether commercial use is permitted on Starter; the supplied pricing screen
already says it, explicitly: **Starter is non-commercial use.** CardResell
charges for scans, so it is commercial, and there is no separate permission.

**So Pro is a compliance requirement, not a performance choice.** The
10,000/day allowance is a side effect of buying the licence rather than the
reason to buy it, and the sequencing follows: the upgrade is not something to
defer until traffic justifies it.

**This should not be re-asked — and the confirmation has now arrived too.** The
dashboard reads **Current Plan: Pro**, so both halves are closed: the licence
question was already answered by the pricing screen, and activation is
observed. **No TPL plan question is open.**

### Step 5 — The bounded eBay maintenance window, when you authorize it

`audit/ROTATION_EXECUTION_CHECKLIST.md`, unchanged. It rotates the Cert ID (G2)
and the verification token (G3), rebuilds the **exact live Phase 0 commit** with
the new configuration — **a rebuild, not a promotion of an existing deployment**
— then completes the portal challenge (G6) and runs the live harness (G7).

Two things to hold onto during it:

- **`READY` is not proof.** G5 is `node tools/verify-challenge.mjs` actually
  passing.
- **A revoked or exposed secret is not a safe rollback target.** The rollback
  plan cannot be "put the old key back."

**What RV-10 gates.**

| Gated by RV-10 | Not gated by RV-10 |
| --- | --- |
| The **first push** to `main` — a push creates a Preview, and the Preview is the exposure | Rotating the eBay Cert ID and verification token **at the provider** |
| Containment **steps 11a–13** | **The exact-commit maintenance rebuild**, which you authorize separately |
| | Steps 1–4 above, and the whole TPL sequence |

**Correction.** I previously wrote that "the credential window has no deployment
in it" and listed "the rebuild deployment" as gated by RV-10. Both are struck.
**The credential window does contain a deployment** — the exact-commit rebuild
is a deployment, and pretending otherwise made the distinction sound cleaner
than it is. The rebuild is not gated by RV-10 because **you authorize it
directly**, not because it isn't a deployment.

The distinction that survives, and the only one being claimed: **containment
gates the push and steps 11a–13 — not the separately authorized maintenance
rebuild, and not the provider-side credential work.** Rotation still comes
before containment, because making containment a prerequisite would hold an
exposed credential open waiting on a dashboard control nobody has yet located.

Identify the exact control and its true scope in the dashboard **before the
push** — if `createDeployments` suppresses production deployments too, that
matters to a window whose whole purpose is to deploy.

### Step 6 — Close validation, then ask me for the release commit

When Steps 3 and 5 are done, the nine blocking items in §D collapse into a small
set of live runs: RV-1, RV-3, RV-4, RV-9, and the containment control. I will
run them, adjudicate each **per check rather than by total**, and bring you the
results with warnings and skips named individually.

Only then do I ask you to approve **the exact commit and the exact deployment
scope**. No push happens before that approval, and pushing to `main`
auto-deploys, so there is no rehearsal.

---

## F. Two wording points, corrected

**Zero is a fallback assumption, not an established shipping cost.** When a
shipping field is blank, the ranking treats it as `$0` — `parseFloat(raw) || 0`
at `js/core.73a71fac.js:8357-8358`. That is an assumption the product is making
on the seller's behalf, and it is now visible beside the comparison it feeds
(`:8720`, `data-ship-assumed`): *"Shipping: … is blank, so this ranking assumes
$0. Venues differ in how shipping is treated, so entering it can change the
order."* It says **assumes**, not *is*. **An intentionally entered zero remains
a valid input** and produces no note — the note fires only on a genuinely blank
field, so a seller who meant zero is never told they left something out.

There is no saved shipping state to reconcile: the inputs at `index.html:2509`
and `:2515` both default to `value="0"` and **nothing persists them**, so
"blank" only ever means the seller cleared the field.

**Shipping can affect venue ordering.** It plainly does — venues differ in
whether they keep buyer shipping and in what postage costs. My earlier "cannot
reorder" was wrong. The accurate and narrower claim: **the ranking already
accounts for shipping, so the order it shows is not missing that effect.** And
the formula establishes the *shipping treatment* specifically — not the broader
claim that every deduction is covered. Tax stays unmodelled by design, and two
venues still lack a declared `feeBase`.

---

## G. What ships, and what is visibly deferred

**Ships:** D1 Sell entry point · D2 draft creation and the frozen list API · D3
review screen, field rendering, fee breakdown · D4 number provenance · D5 eBay
continuation · D6 new-seller and restriction guidance · D7 browser-local listing
photos · CH-3 R2 proxy contract validation · CH-3 R3 cache-header correction ·
§1 review copy · R4 metering, inert until G12.

**One deployment manifest.** D1–D7 and R2/R3 deploy together as a single
commit, as you directed. R2/R3 are not a separate deployment.

| Deferred | Why | Reopened by |
| --- | --- | --- |
| Target-net user entry | Engine implemented and tested; entry surface deferred | Product decision |
| Shipping in the listing packet | The ranking models it; the packet has no shipping term | **RC-2, first** |
| Condition guidance text | Interface promises a draft, not a listing | **RC-2, second** |
| Listing description text | Same | **RC-2, third** |
| R4 activation | Inert until enforcement is enabled | G1 + G11 → G12 |

**RC-2 order is settled and not reopened here:** packet shipping → condition
guidance → description text, with target-net entry deferred. Packet shipping is
framed as **carrying the seller's existing shipping assumptions into the
draft** — not as building a new shipping model.

---
---

# §H. Correction history

Kept below the execution view, unedited. This is how the sections above were
arrived at, including the claims that were wrong.

## H-0. Correction first — my §3 was wrong, and it changes the copy you specified

Your Q-RC-3 instruction was premised on my claim that net excludes shipping and
that shipping could therefore reorder the recommendation. **I checked the
client, and that claim is wrong in both halves.** I had grepped `api/` only and
generalised from an empty result.

**The ranking surface already models shipping in full.** `js/core.73a71fac.js:8549`
computes `netPayout = price + effectiveShipCharge − totalFees − p.sellerShip`,
where `effectiveShipCharge` is zeroed per venue when the venue keeps buyer
shipping (`:8547`, driven by `buyerShippingRevenue: false` on the venues that
do), and `sellerShip` is set per venue — `shipCost`, `0` for TCGplayer Direct
(`:8365`), `intlShipCost()` for the international venue (`:8460`). Both inputs
come from seller-entered fields (`:8323`). Its total row is labelled **"Net
after all deductions"** (`:9015`), and that label is accurate.

**Corrected wording (2026-09-09, review).** I wrote that shipping "cannot
reorder the recommendation." That is wrong as stated: shipping *can* affect
venue ordering — it plainly does, since venues differ in whether they keep buyer
shipping and in what postage costs. The accurate claim is narrower: **the
ranking already accounts for shipping, so the ordering it shows is not missing
that effect.** And the formula establishes the *shipping treatment*, not the
broader claim that every deduction is covered — tax remains unmodelled by
design, and two venues still lack a declared `feeBase`. Applying your "Estimated payout before shipping" label to
that surface would make a true number read as a qualified one. I have not
applied it there.

**The review screen already carries the qualification you asked for.** It renders
"Estimated net" with an "item price only" qualifier and a total row reading
**"Estimated net (item only)"** (`:21992-22028`). The code comment at `:21906`
records the reasoning explicitly: it cannot borrow "Net after all deductions"
"because it models seller shipping, and this screen does not, so borrowing that
label would claim a completeness the number lacks."

**What is actually true:** the item-only net belongs to the *connected-selling
review screen*, not to the comparison. `api/_listingPacket.js` has no shipping
term. The gap is narrower than I described and sits somewhere else — §1.

**Consequences for the RC doc:** §3 of `PHASE1_RELEASE_CANDIDATE.md` is
withdrawn. "Shipping economics" is not an unstarted feature; it is unmodelled in
one specific surface. Its RC-2 priority is a genuine question again, since the
surface where a seller picks a venue already has it.

---

---

## H-1. The real residual risk, and the copy that addresses it

One product now shows a seller two different net figures for the same card:

| Surface | Number | Includes shipping? | Current label |
| --- | --- | --- | --- |
| Venue ranking / best-payout badge | `netPayout` | **Yes** — buyer revenue and seller cost, per venue | "Net after all deductions" |
| Connected-selling review screen | packet net | **No** | "Estimated net (item only)" |

Both labels are individually honest. **Neither tells the seller the two numbers
answer different questions**, so a seller who ranks eBay best at one figure and
then sees a different figure on the review screen has no way to know which is
the comparable one. That is the risk worth writing copy for — not a missing
qualifier, but an unexplained discrepancy between two qualified numbers.

### Proposed copy — review screen only

Placed on the review screen's fee block, adjacent to the existing "Estimated net
(item only)" total, reusing the established `review-fees-note` mechanism rather
than inventing a surface:

> **Not the same as the payout comparison.** This figure covers the item price
> only. The venue comparison also counts what the buyer pays for shipping and
> what postage costs you, so its number will differ. Use the comparison to
> choose where to sell.

Nothing changes on the ranking surface. Its label is correct.

**Not adopted, and why:** your "Estimated payout before shipping" wording with
"They may change which venue pays you most." The first half fits the review
screen but the second half is a claim about venue ordering, and the review
screen does not rank venues — the surface that does already includes shipping.
Saying it there would describe a defect the product does not have.

**Open for your call:** whether you still want a qualifier on the ranking
surface for the inputs a seller may leave at zero. If `shipCharge` and
`shipCost` are blank, "Net after all deductions" is arithmetically true but rests
on unentered assumptions. I have not written copy for that because I have not
established what the fields default to or whether the UI prompts for them.
**Unverified.**

---

---

## H-2. Description and condition guidance — you were right to push

I called shipping the only item affecting product claims. That was also wrong,
for the reason you gave: if the interface promises a complete or ready-to-publish
listing, missing description and condition text is a broken promise.

**Checked the wording.** The entry control says **"Start a listing draft for this
card"** (`:20853-20854`), the failure toast says "Couldn't start the listing
draft" (`:20796`), and the screen is titled as a review of a draft. The packet
surface already states when a title was truncated for a venue and names what was
dropped (`:22574`).

**So the interface consistently promises a *draft*, not a finished listing.**
Nothing found claims completeness or readiness to publish. That makes shipping
RC-1 without description or condition text defensible on the wording that
exists — but it is now a constraint on RC-1, not an accident: **no RC-1 copy may
describe the output as complete, ready to publish, or ready to list.**

---

---

## H-7. Implemented since the last packet

**Review-screen copy — your wording, verbatim** (`js/core.73a71fac.js:7652`,
rendered at `:22073`). Added to `FEE_DISCLOSURE` rather than typed inline, so it
cannot drift the way the tax copy did. Pinned by five assertions in
`tests/copy-truth-offline.mjs`: that it says what the estimate covers, that it
names the comparison as the shipping-inclusive surface, that it says **"may
differ"**, that it **never** says "will differ", and that it does not attribute
the discrepancy to shipping. All read comment-stripped source, so a comment
cannot satisfy them.

**Shipping-field defaults — checked, and one was invisible.** Established:

| State | Value used | Visible to the seller? |
| --- | --- | --- |
| Default on load | `0` | **Yes** — the field renders `value="0"` (`index.html:2509`, `:2515`) |
| Seller types `0` | `0` | **Yes** — they made the assumption by making it |
| Seller **clears** the field | `0` | **No** — field looks empty, ranking uses `0` |
| Saved value | **none exists** | n/a |

There is no persistence: nothing writes `shipCharge` or `shipCost` to
`localStorage`, so there is no saved state and every session starts at the
rendered `0`. "Blank" therefore only ever means the seller cleared it.

`parseFloat(v) || 0` collapsed all three states into one number. The arithmetic
was right — zero *is* the correct assumption absent an input — but the cleared
field made it silently. Blankness is now tracked separately from the value
(`:8350-8355`, read at `:8357-8358`) and stated beside the comparison it feeds (`:8720`): "Shipping: what the
buyer pays is blank, so this ranking assumes $0. Venues differ in how shipping
is treated, so entering it can change the order." An intentionally entered `0`
is **not** flagged. New style uses declared tokens only.

**R4 modes pinned separately** (`api/tpl-proxy.js`). Enablement is now explicit
and independent of binding:

| `TPL_BUDGET_ENFORCE` | Store | Mode | Behaviour |
| --- | --- | --- | --- |
| unset / `0` | none | `DISABLED` | Unmetered, by choice — pre-R4 behaviour |
| `1` | none | `ENABLED_UNBOUND` | **503 `budget_store_unbound`, no paid call** |
| `1` | bound | `ENFORCING` | Metered |

Eleven assertions, section 11 of `tests/tpl-budget-offline.mjs`. The one that
matters: with enforcement on and no store, the provider `fetch` counter does not
move. An operator who turned the control on is entitled to assume it is on, so a
missing binding fails closed instead of restoring the unmetered path — the worst
possible response to a misconfigured control, because nothing would look wrong.
`budget_store_unbound` is distinct from `budget_exhausted` so a
misconfiguration cannot read as a spent budget.

---

---

## H-8. Release validation — as recorded at the time — results

Fourteen suites, run individually (never `run-all.sh`).

| Suite | Result |
| --- | --- |
| `tpl-budget-offline` | **82 passed, 0 failed** (was 71; +11 mode cases) |
| `tpl-proxy-offline` | 65 passed, 0 failed |
| `draft-review-screen` | 370 passed, 0 failed |
| `listing-packet-offline` | 232 passed, 0 failed |
| `review-fee-dl` | 21 passed, 0 failed |
| `copy-truth-offline` | all passed (+12 new) |
| `payout-honesty` | 32 passed, 0 failed |
| `accuracy-fee-parity` | 41 passed, 0 failed |
| `fee-truth-offline` | **was FAILING before this work** — see below |
| `contrast-tokens` | 12 passed, 0 failed |
| `decision-restatements` | 34 passed, 0 failed |
| `asset-fingerprints` | **70 passed, 0 failed** after two forced repairs |
| `test-registry` | 12 passed, 0 failed |

### Two findings, neither caused by the RC-1 edits

**1. `fee-truth-offline` was already red.** I confirmed by stashing my changes
and re-running: it failed identically at `HEAD`. So it has been failing for at
least one commit and was reported as green somewhere it should not have been.

It failed on its **evidence, not its behaviour**. The assertion pinned the two
vocabulary reads as adjacent template interpolations within 120 characters. The
disclosure was later refactored into `venueTaxNote(pid)` (`:6873`), which reads
the same fields and returns a `{label, qualifier}` pair for every surface — a
*stronger* version of what the assertion wanted, and it broke the assertion.
Rewritten per the standing pattern: the helper reads the shared vocabulary, the
ranking path takes its note from the helper (`:8605`), and each literal string
occurs exactly once, so a surface that starts restating the copy fails. Now
green on behaviour rather than on shape.

**2. Bundle rename forced, twice.** Editing the bundle invalidated its
content-addressed name. `js/core.66c39922.js` → **`js/core.73a71fac.js`**, with
references updated in `index.html`, `api/_tplContract.js`,
`tests/tpl-proxy-offline.mjs`, `tests/draft-review-screen.mjs`. My first attempt
used `git mv`, which *removed* the retired bundle — the suite caught it and I
restored the retired bytes from `HEAD`. Retired bundles stay on disk because
audit documents cite line numbers in them.

**Not run and still outstanding:** `draft-kv-live` and `ebay-live` (both need
live credentials and the closed gates), and RV-1…RV-10 remain unadjudicated as a
set. The headless-Chromium-only coverage limit is unchanged, so Q-D5-5 is still
unexercised on desktop.

---

---

## H-11. Corrections made 2026-09-09 (second pass) — six execution gaps

All six were mine. Recorded so the pattern in them is visible, not just the
fixes.

| # | What I had written | What was wrong | Now |
| --- | --- | --- | --- |
| 1 | "None is blocked on writing more code" | **CH-2 is code** and was in the blocking list on the same page. The sentence contradicted the table above it. | CH-2 written and tested (§D-4), held out of the rebuild, ships as G13 after the token is verified. |
| 2 | TPL rotation "prepared" in Step 1, executed nowhere | Step 4 described only eBay. The rotation had a preparation and no execution — so it would either be **absorbed into the eBay authorization** or **leave the exposed key untouched** for as long as eBay stayed blocked. | Its own step, own sequence, own authorization (§E-2), independent of eBay and of G1. |
| 3 | RV-10 "gates the credential window" | **Drift, in the same direction, twice.** Containment gates the **push** and steps 11a–13, not the no-push credential work. | Stated as a two-column table in both §E-5 and the queue, with the reason the drift keeps recurring. |
| 4 | "R4 activated" as a gate | Left "first activation" free to mean the first *production experiment*. | G12 now requires the **recorded real-store evidence** from §E-3 as a precondition. |
| 5 | "Every offline suite green", "browser verification complete" | A **sample presented as a census**, and a set of named cases presented as general coverage. | 47 suites run individually with a per-suite record cited (§D-1); three browser gaps named as outstanding or limited (§D-3). |
| 6 | G1 as "retarget the variables" | Retargeting says nothing about **existing Preview deployments and local copies** that already hold the production values. | Restored to G1 and §E-3 with the three consumers named and what closes each. |

**The pattern across 1, 3, and 5.** Each was a *summary* that was cleaner than
the *record* underneath it. In every case the detailed section was right and the
headline rounded it off in the flattering direction. That is the same defect as
the test failures in §D-1 — a claim resting on a convenient shape rather than
on what it names — and it argues for the same remedy: derive the summary from
the record instead of writing it from memory.

---

## H-12. Corrections made 2026-09-09 (third pass) — an unfailable test

**The serious one first: my verification check could not fail.** I proposed that
a `200` with **no `X-TPL-Cache` header** proved the provider had been reached
with the replacement key. The rebuild target is `9aaf326`, whose 55-line
handler **never sets that header at all** and predates `_tplBudget.js`
entirely. The header is absent on every response from it — cached or fresh,
good key or dead. Followed literally, the procedure returns "verified"
unconditionally and the next step revokes the only key serving live traffic.

Two process failures produced it. I read the **outgoing** handler and reasoned
about the **deployed** one, having myself named the target as a commit ~237
behind. And I never asked the question that catches this class of defect: *what
observation would make this check fail?* An unfailable check placed immediately
before an irreversible action is worse than no check, because it manufactures
confidence.

The replacement rests on `x-vercel-cache` to exclude the CDN — necessary but
not sufficient, per Vercel's own documentation — corroborated by the
**provider-side usage delta**, which is the only signal originating from the
party that actually validates the key.

**Second: "daily exhaustion is arithmetically impossible" is withdrawn.** The
multiplication was right; the conclusion did not follow. A limiter guarantee
needs every relevant request to pass through it, and other keys, old
deployments (including the live one, which has no R4), local callers, and the
verification requests themselves all spend the same allowance while bypassing
R4. 100/hour is a **proposed traffic limit** on what the production function
contributes.

**Third: I called the window rolling; it is fixed.** `_tplBudget.js:139` floors
epoch seconds into a window id — a tumbling window with the standard
hour-boundary burst behaviour. Of the three requirements, only boundary
compatibility actually holds (`86400 % 3600 == 0`).

**Fourth: overage scope.** The provider's hard cutoff resolves **TPL overage
billing** — not other operating costs (functions and KV still run for refused
lookups), not availability risk, and not the other paid keys on this route
class.

**Fifth: "gitignored, so never committed" was an inference, not a check** —
especially poor in a repository whose history has been rewritten. Checked
properly it does hold: 880 commits across all refs including the filter-branch
backup and the pre-scrub recovery ref, plus 9 unreachable commits and 8
unreachable blobs, none containing `.env*`. Bounded to this clone.

**Sixth: "every value in it stays exposed" overreached.** Local possession is
not disclosure. The known TPL exposure is now kept distinct from the KV tokens
(rotate on blast radius and G1's requirement, not on a breach claim) and from
Stripe/OpenAI/CardGrader/Blob (**do not rotate** absent evidence). Production
credentials stay out of the isolated-store tests.

**Seventh: one usage reading is not an abuse finding.** 1 of 2,500 at that
timestamp establishes **low recorded usage at that moment** — not the absence
of abuse, on that day or any earlier one.

**Withdrawn as a question, because it was already answered:** whether
commercial use is permitted on Starter. The supplied pricing screen states
Starter is non-commercial. Pro is therefore a **compliance requirement**, and
the only outstanding item is confirmation that it is active.

---

## H-13. Corrections made 2026-09-09 (fourth pass) — attribution, and a stopped rotation

**The account-wide total was the wrong decisive signal, and the dashboard
proves it.** I made "the provider counter must rise by exactly N" the
confirming evidence. It answers the wrong question: it tells me *the account*
spent requests, not that **the replacement key authenticated**. The per-key
`Last used` field answers the actual question, and it is attributable.

What makes this more than a refinement is visible in the supplied screenshot:
**Daily Usage reads 0 of 10,000** while the active key reports **`Last used:
Sep 9, 2026, 06:23 AM`** — inside today's midnight-UTC window. Whether the
total lags or reset on the plan change, I cannot tell from one reading and will
not guess. Either way: **my stop condition would have failed a working
rotation**, and the failure would have been read as "the replacement key does
not work" — sending me to generate another key to fix a counter problem. The
total is now corroboration only.

Same defect as last round, one level up. Last round the check **could not
fail**; this round it **could fail for reasons unrelated to what it claimed to
measure**. Both come from choosing a signal by availability rather than by
asking what it actually attributes.

**The `HIT` control is demoted from gate to diagnostic.** I had made it a stop
condition, which meant a caching quirk could invalidate a key that had
demonstrably authenticated. It stays as a useful check that the cache signal
discriminates; a persistent `MISS` is now a **caching investigation**, not a
rotation failure.

**"Rollback" was the wrong word, and it mattered.** The old key stays active
throughout, because nothing revokes it until a replacement verifies. So there
is no state to restore and no rollback: continuing on the old key is
**containment while the problem is diagnosed**. Writing it as a rollback
implied a restoration step toward the exposed value — the opposite of the
intent.

**"R2 and R3 shipped" removed.** They are built, tested against mocks, and
included in the proposed release. **Nothing has shipped.** Production runs
`9aaf326`, which contains neither. A related overclaim went with it: the
query-param row read "CLOSED by R2", now stated as addressed in the built
change and not in production.

**Pro is active, and the hourly cap deliberately did not scale with it.** The
allowance grew because a licence was bought, not because demand grew.
Multiplying 100/hr by four would put 96% of the plan into exposed traffic
capacity and leave the same thin margin I had on Starter. Keeping 100/hr uses
24% and leaves **7,600/day unallocated** — which is the mitigation for exactly
what the limiter provably cannot see, and the reason the impossibility claim
was withdrawn: other keys, the still-live no-R4 deployment, local callers,
verification requests, the hour-boundary burst. Raise it against measured
demand, not against a ceiling. **Per-IP 15 still blocks activation** until a
seller session is measured; plan size has no bearing on whether 15 is right.

---

## H-14. Two execution details corrected, and the one task that needs no authorization

**The rebuild's own deployment is the verification target.** My procedure said
to test "the deployment's own URL", which reads as the **source** deployment.
Redeploying `dpl_AuwggY9YcPftJcqSnsztAw4qPfmT` **creates a new deployment with
its own ID and URL**; the old one keeps serving the old bundle and old env. Had
I verified against the source URL I would have measured the deployment that
does **not** carry the replacement key — a third variant of the same failure
mode: a check pointed at the wrong object. The procedure now captures the
returned ID and URL, confirms the commit is `9aaf326`, and **confirms
`www.cardresell.org` resolves to it before revocation** — revoking while the
alias still points elsewhere would strand production on a revoked key.

**The pass criterion is conjunctive.** Demoting the account total corrected an
attribution error; it did not promote the timestamp into a lone decisive
signal. A timestamp advancing cannot distinguish this request from concurrent
traffic. Pass now requires the uncached `200`, the matching invocation
evidence, and the key's own `Last used` **together** — any one failing stops.

**Available with no authorization: the per-IP seller-session measurement.**
This needs mocked upstream calls and the live bundle's three call sites, not
your key and not rotation. It is the thing blocking a defensible
`TPL_PER_IP_MAX`, so it can be done while the rotation waits. **100/hour stays
provisional until those results are reviewed.**

---

## H-10. Decisions taken this round — recorded, not reopened

- Ranking relabel **withdrawn** at your instruction; ranking and packet
  calculations stay distinct until they share inputs.
- Review copy: your shorter wording, adopted verbatim.
- Shipping defaults: bounded implementation check, done — the blank case was the
  live one.
- RC-2 order: packet shipping → condition guidance → description text.

Nothing pushed, nothing deployed, no credential rotated. Nothing here was taken
as authorization for either.

---

## R4 per-IP sizing — mechanism established, `15` is very likely wrong

Done without a key, without rotation approval, and without spending a lookup,
per the reviewer's note that this work is unblocked. Evidence is the live branch
bundle `js/core.73a71fac.js` and `api/_tplBudget.js`.

**Call-site census, corrected.** A loose search found **4** occurrences of
`tpl-proxy`, one more than the three previously recorded. Line **410** is a
**comment** describing the pass-through proxy, not a call. So the earlier count
of **three real call sites stands, now verified rather than assumed**:

| Site | Function | Path |
| --- | --- | --- |
| `js/core.73a71fac.js:301` | `searchWithTPL` | `/v1/cards/search` |
| `js/core.73a71fac.js:515` | `fetchTPLCardById` | `/v1/cards/{id}` |
| `js/core.73a71fac.js:533` | `fetchTPLGradedByNameNumber` | `/v1/cards/search` |

**Three findings that drive the number up, each with its own evidence.**

1. **`searchWithTPL` is invoked from 8 places** — `:1125`, `:1261`, `:1423`,
   `:1523`, `:1607`, `:1646`, `:1676`, `:14569`. It is not one screen's helper.
2. **Search is debounced at 180 ms** (`js/core.73a71fac.js:1043`,
   `setTimeout(() => doSearch(q), 180)`). 180 ms is shorter than an ordinary
   mid-word typing pause, so one card name can emit **several** searches rather
   than one.
3. **No client-side cache sits in front of any of the three.** A sweep for
   cache/memo structures found none, so re-searching or revisiting a card
   re-spends. The only caching is the CDN's `s-maxage=300` on identical URLs.
4. **The graded path fires two calls, not one.** `fetchTPLCardById:5223` and
   `fetchTPLGradedByNameNumber:5232` are adjacent in the same path.

**Consequence.** `TPL_PER_IP_MAX = 15` per hour plausibly buys a seller only
**three to five cards**, not fifteen, once debounce fan-out and the two-call
graded path are counted. On a shared or NAT'd address it is worse. Shipping 15
would throttle ordinary sellers and read to them as the app being broken.

**Bounds, stated honestly.** This is **mechanism-derived, not measured**. The
mechanism is established at `file:line`; the calls-per-card **count is
Unverified** until a session is instrumented. I am not replacing 15 with another
invented number \u2014 that is the same error in the other direction.

**Also corrected: where `15` comes from.** It is a **proposed value in this
document**, not a configured one. `api/_tplBudget.js:34` defaults `perIpMax` to
**60**, and `TPL_PER_IP_MAX` is set in no env file or script in the tree. So
today's effective per-IP cap is the **60** default, not 15 \u2014 a four-fold
difference between the plan and the code that had not been noticed.

**Next step, needing nothing from the owner:** instrument the three call sites
against a mocked upstream, drive one representative seller session
(search a card, select it, view graded), and record the actual call count. That
count sets `TPL_PER_IP_MAX`.
