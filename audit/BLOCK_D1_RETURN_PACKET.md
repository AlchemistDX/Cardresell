# Block D1 — Return Packet

Commit `4c384d0`. 24 suites green, unpushed, production still on Phase 0.

Answering the six required items. Two of the verdict's claims did not survive contact
with the code and are argued below rather than quietly implemented; one of my own
claims from the previous packet was false and is retracted.

---

## Retraction first

The previous packet said, of the disabled List button on a refused collection row:
"tapping it toasts the full message." **That was false.** A native `disabled` button
receives no click event and cannot take focus. Measured in the browser:

```
{"afterClick":0,"afterDispatch":1,"focusable":false}
```

`afterClick: 0` is a real user click doing nothing. Only a synthetically dispatched
event fired. The reason was reachable by mouse hover and by nothing else — not by
touch, not by keyboard, not by a screen reader. My QA had read the `title` attribute
and recorded that as verification without ever clicking the control. The verdict was
right to suspect this, and right for a reason I had not noticed.

---

## 1. Out-of-order eligibility responses + generation binding

**Partially disputed.** The headline scenario in the verdict — slow eligible A, fast
refused B, A lands last — **was already handled** before this change. The old guard was
not a bare boolean: it keyed on `_crIntentToken(card)`, a hash of the card's identity
fields, and discarded any response whose token no longer matched the pending one. A and
B hash differently, so A's late answer was already dropped.

This is not a debating point, it is measured. Running the new test file against the
pre-fix `core.js` from `HEAD`:

```
FAIL 🔴 a re-render of the SAME card still discards the older answer
FAIL 🔴 an eligible answer earned by a signed-in account is dropped after sign-out
FAIL and nothing is left approved
FAIL a different account in flight also invalidates the answer
FAIL 🔴 and offers a retry, because a dropped connection is not evidence
FAIL the thumbnail never goes on the wire
FAIL neither do free-text notes
sell-gate-ordering: 13 passed, 7 failed
```

The two A/B reordering tests are in the 13 that passed. The real defects were the three
cases an identity hash structurally cannot see:

- **the same card rendered twice** — identical hash, so the stale answer applied
- **sign-out mid-flight** — the card never changed, so the guard never fired
- **account switch mid-flight** — same shape

Fixed with a monotonic generation counter plus the auth token captured at request time:

```js
function _crStamp()      { return { gen: _crSellGen, auth: window._googleIdToken || '' }; }
function _crStillCurrent(t) {
  return t && t.gen === _crSellGen && t.auth === (window._googleIdToken || '');
}
```

`applySellGate` bumps the generation on entry, so a new card, a re-render of the same
card, and a re-ask all invalidate everything in flight. Collection batches capture the
same stamp, and `renderCollectionView` bumps the generation before hydrating — so a
batch still in flight from a previous render cannot decorate the rows that replaced it.

**On the tests being permanent rather than Playwright-only.** `core.js` is a classic
script with no module boundary, so there was no clean way to import it into the offline
suite. Rather than reimplement the generation logic in the test — which would pass
forever while the app broke, the same duplicate-implementation trap this block has been
avoiding all the way down — the test slices the D1 block out of the shipped file by its
banner comment and evaluates it in a `node:vm` sandbox with a small DOM stub. It costs a
stub and buys the property that matters: edit the real logic, the test fails. No new
dependencies. Registered as suite 17/24.

## 2. The Sell control is gone from refused rows

Not disabled — absent. An ineligible row now renders a `Needs info` control that is not
a Sell control, is enabled, and carries the sentence in `aria-label`. Measured in the
browser at 390px:

```json
{"text":"Needs info","disabled":false,"isSellControl":false,
 "aria":"We could not read the set this card belongs to.",
 "clickToasted":["We could not read the set this card belongs to."],
 "keyboardFocusable":true}
```

Touch, keyboard, and screen reader all reach the reason now. `_crAttr`, the manual
attribute escaper, is deleted — the controls are built with `createElement` and
`textContent`, so the escaping hazard is gone rather than handled.

**Found in QA and not in the plan:** at 390px both controls were being compressed by the
cell's flex row to **11×20px** — nominally rendered, impossible to hit. `flex:0 0 auto`
and `min-height:32px` bring them to 56×32 (List) and 72×33 (Needs info). Honest caveat:
32px is still under the 44px tap-target guideline. It matches the existing 🎉 Sold
control in the same row, so raising it is a change to the whole collection table rather
than a D1 change, and I have not made it. Flagging rather than claiming compliance.

## 3. Alias conflicts → refusal

**Partially disputed.** `identityFieldConflicts(row)` returns the list of alias groups
whose non-empty members do not normalize to the same value; a non-empty result refuses.
It is a list, not a count, so the seller can be told which two values fought.

The verdict asked for conflict checks across "card name, set, number, game/category,
language, grader, grade, variant, cert." Implementing that literally would have shipped
a feature that refuses ordinary cards. Two of those are not alias groups:

- **`setCode` vs `set`/`setName`** — a machine code and a display name are different
  kinds of field. `TGO3` and `Lost Origin Trainer Gallery` are both correct and both
  present on real rows. Treating them as conflicting refuses every card carrying a set
  code. Precedence between different fields is legitimate; precedence between *spellings
  of one field* is the hazard.
- **`grader` / `grade` / `variant`** — single-spelling fields. Nothing to conflict with.

`game` **is** included, compared after canonicalization so the legitimate
`pokemonjp` → `pokemon` collapse is not read as disagreement. Groups checked:
`card|card_name|name`, `set|set_name|setName`, `number|card_number`, `language|lang`,
`cert|certNumber|cert_number`, `game|cardType`.

Ordering invariance is proved, not asserted — all six permutations of three conflicting
name spellings produce one identical verdict. If the answer depended on key order,
"conflict" would only mean "the reads happened in an unlucky sequence."

Both gates consume the same function: `missingIdentityAxes` returns `SELL_IDENTITY_CONFLICT`,
and `drafts.js` already routes through it, so the create refuses conflicts **with no
change to `drafts.js` at all**. That is the one-implementation rule paying rent.

## 4. Contract proof — and the defect it found

The old drift test passed `{card, instanceId, slot, price}` and proved parity for
identity alone. Rebuilt around the payload `startListingDraft` actually sends,
`priceSource` included. **It immediately failed, for a real reason:**

```
Error: MUTATION_FIELD_UNDECLARED:draft-create:priceSource
```

`priceSource` was never declared in the `draft-create` idempotency fingerprint, so
**every create D1 sends would have thrown** on first real use. Browser QA could not see
it (no signed-in server) and the identity-only test could not see it by construction.
Now declared as `token` — the same number recorded as a seller's asking price and as a
comp-derived price are two different claims about provenance, and D4 puts that claim on
screen, so it belongs in the fingerprint.

**A correction to the verdict's framing.** It asked me to prove `eligible === true`
implies `normalizeCreateInput` succeeds. That is not the full gate. Measured:

| payload | `normalizeCreateInput` |
|---|---|
| `price: 0` | **accepted** (caught later by slot rules) |
| `slot: 'etsy:fixed-price'` | **accepted** (caught later by slot rules) |
| `priceSource: 'vibes'` | refused |
| `price: -1` / `NaN` | refused |
| client-supplied `sku` | refused |

Proving normalize succeeds would have proved the wrong thing. The proof is therefore
split: `sell-eligibility.mjs` proves the two gates agree about **refusal**, and
`draft-crud-e2e.mjs` proves the **acceptance is real** by driving `SVC.createDraft`
against the in-memory store and asserting a stored draft with **no blocking violations**
— across 5 eligible row shapes × both `priceSource` values. A created-but-unlistable
draft would satisfy the letter of the contract and break its intent.

D1's payload space is small enough to enumerate rather than sample: `slot` is a
constant, the client refuses `price <= 0` before calling, and `priceSource` is `seller`
or `comp` and never defaulted. All 10 price/source pairs are asserted.

## 5. instanceId

Taking the first option. A UUID is minted when a scanned card is displayed and retained
while it stays displayed.

Worth naming why the old value was worse than merely fake: hashing the identity fields
made two *separately scanned copies of the same card* collapse to one token — the field
asserted "these are the same physical object," which is false, and D2/D3 would have
inherited that as a draft-to-card relationship. A per-display UUID claims nothing across
scans, still de-dupes a double tap (the idempotency key is derived from it), and treats
a later scan as possibly a different copy, which it is. Real instance identity waits for
inventory.

## 6. Wire size (S3) and retry (S2)

**Retry:** an `ASK_FAILED` result now renders a focusable `Try again` inside the refusal
box, rebuilt each time so it cannot outlive the message that justified it. Signed-out
gets no retry — retrying signed out changes nothing.

**Wire size — one disagreement.** The verdict asked to send "only the fields the server
interprets," i.e. an allowlist. I used a **denylist**. An allowlist is a second
implementation of "which fields mean identity" living on the client, and its failure
mode is silent: forget to allow a field the server reads and a perfectly good card goes
ineligible with no visible cause. A denylist can only remove what it names. I accept the
verdict's point that a transport projection is not a second identity implementation —
but that is true *because* it makes no decisions, and an allowlist does make one.

Test at the cap, as asked — 500 realistic rows with 24 KB thumbnails:

```
ok  all 500 rows go in one request
ok  🔴 the batch stays under 512 KB on the wire
    (500 rows serialised to 184 KB)
```

184 KB against roughly 12 MB unprojected. A separate assertion proves every identity
field survives and the caller's row is not mutated.

## S4 — accepted

Auth-required stays. I accept the correction that show-then-signin is not inherently a
dark pattern; my objection was to showing an *approval* the server never gave, which is
a narrower complaint than the one I made. Measuring the registration effect is not
something D1 can do — no funnel instrumentation exists and the no-high-cardinality-
telemetry rule constrains what can be added. Flagging as a real open question rather
than booking it as done.

---

## Test movement

| suite | before | after |
|---|---|---|
| `sell-eligibility` | 37 | **56** |
| `sell-gate-ordering` | — | **22** (new, suite 17/24) |
| `draft-crud-e2e` | 98 | **99** |
| full run | 23 suites | **24 suites, all green** |

## Files changed

`js/core.569ff536.js` · `api/_cardIdentity.js` · `api/_sellEligibility.js` ·
`api/_idempotency.js` · `tests/sell-eligibility.mjs` · `tests/draft-crud-e2e.mjs` ·
`tests/sell-gate-ordering.mjs` (new) · `tests/run-all.sh`

`api/drafts.js` is deliberately untouched.

## Open, and I would like these argued

1. **32px tap targets.** Fixing properly means changing every control in the collection
   table, not just D1's. In or out of Block D?
2. **Zero price and unsupported slot pass `normalizeCreateInput`.** Currently pinned by
   assertions that document the behaviour rather than fix it, so the follow-up is
   visible when it lands. Should normalize get stricter, or is the slot-rules layer the
   right and only home for that?
3. **Conflict refusal is unreachable from the current scan panel** — it builds one
   spelling per field. It protects the Collection path and any future importer. Is
   shipping a refusal with no live producer the right call, or should it wait for the
   importer that can actually trigger it?
