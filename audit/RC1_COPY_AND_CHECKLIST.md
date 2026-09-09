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
| Offline verification | **Complete.** Every offline suite green, including `fee-truth-offline` (§C). |
| Browser verification | **Complete.** The three Playwright-gated queue items ran today (§D). |
| Credential-gated verification | **Blocked.** Four queue items need credentials or a signed-in account (§D). |
| Configuration | **Blocked.** Production KV is shared with nonproduction; two credentials are exposed. |
| Remaining path | Five owner steps, one at a time (§E). |

**What blocks the release is configuration and credentials, not code.**

---

## B. Release gates

| # | Gate | State |
| --- | --- | --- |
| G1 | Production KV isolated from nonproduction | **Open** — blocks G12 |
| G2 | eBay Cert ID rotated at the provider, production-only | **Open** — owner |
| G3 | Verification token regenerated, production-only | **Open** — owner |
| G4 | Exact live Phase 0 commit rebuilt with new configuration (**not** a promotion) | **Open** |
| G5 | `node tools/verify-challenge.mjs` PASSES — READY is not proof | **Open** |
| G6 | eBay portal save and challenge completed | **Open** |
| G7 | `bash tools/run-ebay-live.sh` recorded and adjudicated per check, never by total | **Open** |
| G8 | Containment control verified (gates steps 11a–13) | **Open** — RV-10 |
| G9 | Release-validation queue adjudicated, warnings and skips explicit | **Adjudicated (§D).** Closes when its four blocking items close |
| G10 | §1 copy approved and implemented | **Closed** |
| G11 | TPL paid key rotated at the provider and stored non-plain | **Open** — owner |
| G12 | R4 activated: `TPL_BUDGET_ENFORCE=1`, KV store resolved, budget numbers set by Will | **Open** — needs G1 + G11 |

G11 and G12 exist because **disabling R4 is a scope choice and does not resolve
CH-3's cost exposure.** With R4 off and no rotation item, the exposed paid key
would have disappeared from the gate list entirely.

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

**Still open:** the store has never touched a real KV. G12 stays open, and its
first activation is the first time this code meets Vercel KV. The budget numbers
in `BUDGET_DEFAULTS` (max 1000 / hour, per-IP 60, 6 h cache, 24 h stale) are
**explicit placeholders, not policy** — see §E-3.

---

## D. Release validation — adjudicated

Every item is classified **passed**, **blocking**, or **deferred with its
limitation**. I did not wait on credentials to finish the offline and read-only
items; three items that had been sitting behind "needs Playwright" ran today.

### D-1. Offline suite results

Run individually, never through `run-all.sh`.

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
| **CH-2** code falls back to a published token | **BLOCKING — code, and I have not changed it** | `api/ebay-notifications.js:17` still reads `… || '<repo literal>'`. Removing the fallback makes the endpoint **fail closed** if the variable is ever unset — which is correct, and is also a behaviour change landing in the same window that revalidates the endpoint. **I am not making that change unasked;** it is a decision for you, and the safe order is to change it *after* G3 and G6 succeed, never during. |
| **CH-3** `CARDSELL_TPL_KEY` stored unencrypted | **BLOCKING** | Assessed read-only. The route is anonymous and unmetered, and every query parameter is forwarded verbatim, so the edge cache is bypassable. The deployed client sends no cache-buster, so this is **abuse potential, not observed bleeding** — whether it has been abused is **Unverified** and lives in the provider dashboard. R2 and R3 shipped; **R1 rotation is G11 and R4 activation is G12**. CORS is withdrawn as a control: origin and `Referer` are client-asserted. |
| **Same-card basis retention** | **DEFERRED — product decision, not a defect** | The consequence is disclosed rather than silent: the review screen states `data-packet-basis="absent"` and flags a comp-derived price as owing a source. Retention is not obviously safe — reinstating a basis whose card is no longer certain recreates the leak the binding work exists to prevent. Production clearing stays unchanged. |
| **D5 §8.3 signed-in eBay continuation** | **PASSED for one tested case; stays in the queue** | 2026-09-08, owner-attested, iOS Safari mobile web: verbatim search and `caty=183454` displayed, comparable match shown. **A pass establishes that case, not a continuing compatibility guarantee** — these are undocumented eBay internals. **Q-D5-5 desktop has never been exercised** and remains open. |

**Score: 4 passed · 9 blocking · 3 deferred with limitations.** Every blocking
item is credential-, configuration-, or deployment-gated. **None of them is
blocked on writing more code.**

---

## E. Your next steps — one at a time

Not six dashboard tasks handed over at once. Do these in order; each one's
result changes what the next one should be.

### Step 1 — Prepare the TPL rotation and activation procedure

**Prepare only. Nothing is rotated yet.** Sign in to the TCGPriceLookup
provider and confirm three things privately, without pasting any value here:

1. That you can generate a **new** key while the current one still works — a
   rotation with no overlap is an outage.
2. Where the plan's **allowance and current usage** are displayed (Step 3 needs
   both numbers, and I have never seen either).
3. That the current key can be revoked **after** the new one is live.

Then confirm the Vercel side of the plan: `CARDSELL_TPL_KEY` is stored as
`type: plain`, and **Vercel cannot convert a variable in place** — it must be
deleted and re-added as encrypted. Treat the existing value as exposed
regardless of what the dashboard shows.

**Do not rotate yet.** Rotation is a live-traffic change and belongs with the
maintenance window in Step 4.

### Step 2 — Isolate the store, then let me verify the binding

One configuration change: provision a **separate non-production KV store** so
Preview and Development stop reading and writing the store behind
`www.cardresell.org`. Every KV row on the project is currently a single row
targeting `production,preview,development`.

This is G1, and it unblocks both RV-4 and RV-8. When it is done, tell me and I
will verify the R4 binding **against the real store with enforcement enabled and
the provider still mocked** — the same shape as the offline §12 proof, but
meeting Vercel KV for the first time.

**One caution.** The earlier claim that separating environments would invalidate
completed functional tests was wrong and is struck. Those tests assert behaviour
against a KV interface, not a particular store. A new store needs its
configuration checked; it does not need the results re-earned.

### Step 3 — Choose the budget numbers, grounded in the real plan

Bring me the two numbers from Step 1 — **plan allowance and current usage** —
and we will set `TPL_BUDGET_MAX`, `TPL_BUDGET_WINDOW_SEC` and
`TPL_BUDGET_PER_IP_MAX` from them.

**I will not invent them.** The values presently in `BUDGET_DEFAULTS` (1000 per
hour, 60 per IP) are **placeholders chosen to be obviously arbitrary**, not a
recommendation. Your actual TPL plan allowance and usage are **Unverified** —
they exist only in the provider dashboard, which I have never seen and will not
guess at.

**And one thing I should not have let stand:** a request allowance is **not a
dollar spending cap**. Saying "cap it at $X" when the plan meters *requests*
would be a made-up conversion. Once you have the real allowance, there are two
honest framings, and which is available depends on how your plan actually bills:

| If your plan… | Then the budget means | And the option is |
| --- | --- | --- |
| includes a fixed request allowance, overage refused | a share of the allowance you are willing to spend before refusing traffic | pick a per-hour number that leaves headroom for a normal day |
| bills per request beyond an allowance | a request ceiling that **maps to** a dollar figure at the published per-request rate | the dollar figure is derived, and I will show the arithmetic rather than assert it |

Until the plan is read, neither framing is available and no number is defensible.

### Step 4 — The bounded eBay maintenance window, when you authorize it

`audit/ROTATION_EXECUTION_CHECKLIST.md`, unchanged. It rotates the Cert ID (G2)
and the verification token (G3), rebuilds the **exact live Phase 0 commit** with
the new configuration — **a rebuild, not a promotion of an existing deployment**
— then completes the portal challenge (G6) and runs the live harness (G7).

Two things to hold onto during it:

- **`READY` is not proof.** G5 is `node tools/verify-challenge.mjs` actually
  passing.
- **A revoked or exposed secret is not a safe rollback target.** The rollback
  plan cannot be "put the old key back."

**RV-10 gates the window's containment steps (11a–13).** Identify the exact
control and its true scope in the dashboard first — if `createDeployments`
suppresses production deployments too, that matters to a window whose whole
purpose is to deploy.

### Step 5 — Close validation, then ask me for the release commit

When Steps 2 and 4 are done, the nine blocking items in §D collapse into a small
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
