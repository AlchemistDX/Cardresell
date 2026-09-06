# Block D1 Review Packet — the Sell entry point

**Commit:** `2726f32` · **Date:** 2026-09-06 · **Suite:** 23/23 green, 0 failed
**Reviewer format:** blocker / should-fix / deferred

---

## What D1 was supposed to do

From `PHASE1_CHECKLIST_2026-09-05.md` § Block D:

| | Task | Done when |
|---|---|---|
| D1 | "Sell" entry point on scan result and collection rows | Appears only when identity is sufficient to build a packet |

That "done when" is the whole design constraint. A Sell button that appears and
then fails is worse than no button, because the seller learns the product is
broken rather than learning what their card is missing.

---

## The one decision everything else follows from

**The button is not drawn from a client-side check.**

The obvious implementation is three lines in `core.js`:

```js
if (card.game && card.set && card.number) showSellButton();
```

That would work on the day it was written and would be a second implementation
of identity sufficiency. The first time the server's rule changed — a new game
needing a language axis, say — the button would keep appearing and the create
would start refusing. The symptom is a button that does nothing, which is the
hardest class of bug to get reported.

So the flow is: `core.js` asks `/api/sell-eligibility`, which calls
`sellStamp()` in `api/_sellEligibility.js`, which is the same function
`normalizeCreateInput` in `api/drafts.js` refuses on.

`tests/sell-eligibility.mjs` asserts they cannot diverge — it calls
`EP.normalizeCreateInput` and `SELL.sellStamp` on the same rows and fails if the
gate and the create ever disagree. That test is the actual load-bearing part of
this block.

One further guard inside the stamp: `eligible` delegates to
`hasSufficientIdentity(row)`, **not** to `missing.length === 0`. If someone adds
a required axis to `hasSufficientIdentity` and forgets to add its reason code to
`missingIdentityAxes`, the stamp goes ineligible with a generic message. It
never goes eligible with an empty list. The failure mode is a vague sentence,
not a dead button.

---

## Files

| File | Status | What it is |
|---|---|---|
| `api/_sellEligibility.js` | new, ~110 lines | Single owner of "can this row start a draft?" |
| `api/sell-eligibility.js` | new, 94 lines | `POST` batch endpoint, auth required |
| `tests/sell-eligibility.mjs` | new | 37 passed / 0 failed, includes the drift test |
| `api/drafts.js` | modified | Create contract: client names the card, server derives sku + title |
| `api/_cardIdentity.js` | modified | Reads both clients' field spellings |
| `index.html` | modified | `#crSellRow` / `#crSellBlocked` above the outbound CTAs |
| `js/core.569ff536.js` | modified | Gate, batch fetch, one shared create call |
| `tests/draft-list-cap.mjs` | modified | HTTP payload updated to the new create contract |
| `tests/run-all.sh` | modified | 22 → 23 steps |

---

## Decisions worth arguing with

### 1. Auth is required to answer "can I sell this?"

The endpoint 401s without a bearer token. That means a signed-out visitor
browsing the Collection sees no Sell button at all.

Rationale: creating a draft needs a verified sub. A button that always ends at a
sign-in wall is a dark pattern with extra steps. Signed-out gets a true
sentence — "Sign in to start a listing for this card." — in the button's place,
so nothing is silently missing.

The counter-argument is real: eligibility is a property of the card, not the
viewer, and a signed-out seller might want to know their card is listable before
committing to an account. I chose the honest-refusal path over the
tease-then-wall path. Worth a reviewer's opinion.

### 2. Response stamping was built, then reverted

The first implementation embedded a stamp in the `/api/scan` and
`/api/collection` responses — no extra round trip.

It was reverted on discovering that `renderCollectionView()` (core.js:8922)
reads `loadPortData()` → `localStorage`. **The rendered Collection never passes
through `/api/collection` at all.** Response stamps would have covered some rows
and not others, and the client would have needed both a read-it-off-the-row path
and an ask-the-server path — two implementations, chosen by accident of which
screen you came from.

One path, asked for. Response-embedded stamps become correct in Phase 2, once
the card object is threaded end to end. Rationale is recorded in the
`_sellEligibility.js` header so the next person doesn't rediscover it.

### 3. An oversized batch is refused, not truncated

`MAX_ROWS = 500`, matching the Pro collection cap. Over that, the endpoint
returns `ROWS_TOO_MANY` rather than stamping the first 500.

A truncated answer reads to the UI as "those cards can't be sold." Chunking is
the client's job and `fetchSellStamps` does it.

### 4. `_cardIdentity` was widened rather than adding a client translator

The live scan panel spells fields `name` / `setName`. A saved Collection row
spells them `card` / `set`. The API tests use `card_name` / `set_name`.

The alternative was a `toServerRow()` helper in `core.js`. That helper is a
translation layer, and a translation layer is the second implementation of
identity in disguise — it decides what counts as a set, which is exactly the
decision `_cardIdentity` exists to own.

So the server reads all the spellings. Two safety pins in
`tests/sku-identity.mjs` (85 passed, re-verified): `setCode` still wins over any
set-name spelling, and `displayName` is display-only and outside the SKU, so
widening it cannot move a SKU.

### 5. Both entry points share one create call

The first cut of the client block had `startListingDraft()` and
`startListingDraftForEntry()` each with their own `fetch('/api/drafts')` and
their own full status ladder. I caught it before commit and extracted
`_crCreateDraft()`.

Flagging it because it is the fourth-plus time this shape has appeared in this
codebase (fee model, normalization, delete, authoritative draft record). The two
copies would have drifted the first time a status code changed.

---

## Blockers

**None known.** Suite 23/23, browser QA green across four panel states and both
collection row states.

---

## Should-fix

**S1 — `instanceId` for an unsaved scan is a hash, not an instance.**
A saved Collection row is a real physical copy, so `inst_col_<row.id>` is a
genuine per-copy key. The scan panel has no such copy: the card is in the
seller's hand, not their inventory. There, `instanceId` is `inst_<djb2 of the
identity fields on screen>`.

Consequences are bounded — it is a de-dup token, never stored as identity, never
used to price or title anything. Worst case is a duplicate draft the seller can
discard, not a wrong number presented as authoritative. But it is not what
`instanceId` means, and two different PSA 9s scanned in sequence would collide
onto one token. The real fix is an inventory instance minted when a card is
taken in hand, which is Block E. Named here rather than quietly settled.

**S2 — four inline copies of the token force-refresh dance in `core.js`.**
`_crIdToken()` is the extracted version and the new D1 calls use it, so there
isn't a fifth. The existing four live in billing and portal paths and were left
alone: retrofitting them means touching payment flows that this block cannot
test. Should be a dedicated change with its own verification.

**S3 — the disabled 🛠️ in a collection row carries its reason in a `title`.**
A table row has no space for a sentence, so an ineligible row shows a faint
disabled 🛠️ whose tooltip names the missing axis, and tapping it toasts the full
message. It is not silently omitted, but a tooltip is weak discovery on touch.
D3's review screen is where a missing field gets named properly; this is the
dense-table compromise until then.

**S4 — the slot is hardcoded to `ebay:fixed-price`.**
Not a preference yet. Choosing among venues is the Block D venue step, and
rendering a picker here that only has one real option would be a control that
does nothing. eBay is the first integration, not the destination.

---

## Deferred (with reasons, not as a backlog dump)

**D-1 — client-supplied `price` is a declared trust boundary.**
`price` and `priceSource` come from the client. The one implementation of price
basis genuinely lives in `core.js` (`window._crBasis`, `getEffectivePrice()`),
and reimplementing it server-side would be the fifth instance of the exact
mistake this design is avoiding.

What the server does enforce: `priceSource` is **never defaulted** — a missing
one is refused — and `PRICE_SOURCE.SELLER` records `DRAFT_PRICE_SELLER_ENTERED`
(INFO) so a seller-typed number can never later be presented as a comp. The
resolution is moving the basis behind a server API in Phase 2, not adding a
second basis now.

**D-2 — no dedupe on `instanceId` + `slot` at create.**
`createDraft` does not refuse a second draft for the same instance and slot; the
`Idempotency-Key` is the only guard, and it holds for a double tap or a retry
after a dropped response, not for a deliberate second click a day later. Whether
one instance may hold two drafts for the same slot is an inventory question, not
a UI one.

**D-3 — the WARNING-tier stale-quote threshold is still undecided.**
Deliberately. It will be a function of pricing source, category, liquidity and
confidence, and picking one universal hour count now would be inventing a number
to make a lint rule pass.

---

## Verification

```
LOCAL_ONLY=1 bash tests/run-all.sh     → 23/23, ALL CHECKS PASSED
tests/sell-eligibility.mjs             → 37 passed, 0 failed   (new)
tests/sku-identity.mjs                 → 85 passed, 0 failed   (re-verified after the widening)
tests/listing-packet-offline.mjs       → 138 passed, 0 failed  (re-verified)
tests/draft-crud-e2e.mjs               → 98 passed, 0 failed
tests/draft-list-cap.mjs               → 129 passed, 0 failed  (payload updated to the new contract)
tests/draft-index-recovery.mjs         → 258 passed, 0 failed  (3 expected-fail lines are the guard proving it fires)
```

**Browser QA** (Playwright, `js_repl`, local server):

| State | Result |
|---|---|
| Server unreachable | Row hidden, "Couldn't check whether this card is ready to list." |
| Signed out | Row hidden, "Sign in to start a listing for this card." |
| Eligible | Button shown, enabled, `_crSellApproved` set |
| Refused | Row hidden, reason names the missing axis, `_crSellApproved` cleared |
| Collection, eligible row | Blue 🛠️ List button beside the existing 🎉 Sold |
| Collection, refused row | Disabled faint 🛠️, tooltip names the missing axis |
| Layout | No overflow, no wrap, existing Sold/refresh/remove actions intact |

Zero page errors. The panel button was restyled blue mid-QA: it was rendering in
the same red as "Sell on eBay" and "Sell on TCGplayer", and those two hand the
seller to someone else's wizard while this one keeps them here. Three
identical-looking CTAs with opposite consequences is a hierarchy failure.

---

## A caught regression worth recording

`tests/draft-list-cap.mjs` went red — 4 failures — on the full run. The cap test
posts to the HTTP endpoint with a client-supplied `sku` and `title`, which the
new create contract refuses outright. Its intent (a create at the cap is 409) is
unchanged; its payload predated the contract.

Recording it because the failure looked like a cap bug and was a contract
change. Fixed by giving the file an `httpInput()` matching the endpoint contract
while `input()` stays correct for direct `SVC.createDraft` calls, which take an
already-normalized record. Same split as `draft-crud-e2e.mjs`.

---

## Not deployed

Eighteen-plus commits remain unpushed; production still runs Phase 0. The deploy
gate is unchanged and still open: `EBAY_LIVE=1 node tests/ebay-live.mjs` sits at
18 pass / 1 fail, and the failing test is fixed by an unpushed commit — pushing
is what makes it green. Sequence remains deploy → prod smoke → live eBay harness
**19/19 or rollback** → rerun the gated real-KV suite.

No deploy without explicit confirmation.
