# Decision — Cross-source disagreement: where it goes, and why D2.1 is unblocked

**Date:** 2026-09-06 · **Status:** decided · **Scope:** not D2.1
**Closes:** the D2.1 entry gate (roadmap §3.4 description + routing call)

---

## The state, established before deciding

| Fact | Evidence |
|---|---|
| The renderer is not called | `_renderSourceDisagreement` appears **once** in `js/core.d9e1b484.js` — its own definition at `:1784` |
| Detection is not called either | `_sourceDisagreement` appears **twice**: definition at `:1767`, and a mention inside the withdrawal comment at `:1910-1922` |
| The withdrawal was contextual, not substantive | The comment at `:1913-1915` records the reason: the disclosure "fired on homepage cards and read as a defect in the app rather than a fact about the feeds" |
| The cost was recorded honestly at the time | `:1918-1922` states what the seller loses |
| **The comment's claim that detection is "still exercised by tests" is false** | The only test is `tests/launch-audit-regressions.mjs:1664`, a regex over bundle text asserting `function _sourceDisagreement` appears. The whole suite is text-regex based (`const index = readAppSource()`, `:8`). It would pass if the body were `return null`. |
| Roadmap §3.4 and §5.4 described the disclosure in the present tense as live | Both now corrected |

The false test claim is the third instance this session of an assertion that was green and
proved nothing — after the `SLOT_` prefix trap and the offset-518 fixture. In all three cases
the assertion was structurally incapable of failing for the reason it named. That pattern is
now worth treating as a class rather than three coincidences.

The test label has been corrected to "the detection function definition is still present in the
bundle (text only)", with a comment stating that it does not exercise the thresholds. The
assertion itself is kept — it does have one real job, which is to stop a cleanup pass from
deleting the function while the routing decision is pending.

---

## The decision

**The disclosure returns, routed to the card detail view only. It is its own unit, and it is
not part of D2.1.**

### Why the card detail view and not dark

The withdrawal reason was about *placement*, and the code says so: it fired on homepage cards,
where a seller has no context for it and it reads as a defect. That is an argument against the
homepage, not against the disclosure.

The card detail view is the only surface where the disclosure can read as information:

- It is where the payout math happens, and §3.4's own stated purpose for the disclosure is that
  "a seller needs to know which source underlies the payout calculation."
- Both source values are already rendered there, separately and labelled. The disclosure adds a
  sentence about two numbers the seller is already looking at, rather than introducing a
  discrepancy out of nowhere.
- A seller on the card detail view has chosen to evaluate one card. The interruption cost that
  made it wrong on the homepage does not exist there.

### Why not permanently dark

§5.4 states the rule as "Disclose disagreement; do not average it away." Going permanently dark
would leave the codebase holding a rule it does not follow, which is how a rule becomes a habit
nobody can justify. The honest options were to route it or to strike the rule — and the rule is
right, so it gets routed.

Worth being precise about what is currently broken and what isn't: the load-bearing half of
§5.4 — do not average, keep source identity — **is satisfied today**. Both numbers render
separately and no third number is invented. Only the explicit statement of disagreement is
missing. So this is a gap, not a violation, and it does not need to be closed urgently.

### Why it is not in D2.1

D2.1 is the drafts list. Its rows show a price the seller has already chosen, with provenance
(D4's job), not a live cross-source comparison. There is no comparison on that screen to
disagree about.

Putting a disagreement affordance on a draft row would also recreate the exact failure the
withdrawal was about: a discrepancy notice appearing in a list context where the seller is
scanning rather than evaluating. The homepage lesson applies to the drafts list more than it
applies anywhere else in the app.

**So D2.1 is unblocked, and the entry gate closes without the feature being built.** The
contract needs no change; the screen needs no disagreement branch.

---

## What this leaves open, stated plainly

- **The routing unit is not scheduled.** It requires a bundle change and therefore a rename,
  and it should land with a real behavior test — which needs `_sourceDisagreement` reachable
  from a test, not asserted by regex over the bundle text. That extraction problem is the real
  work, and it is shared with every other client function in this bundle.
- **No behavior test for the 1.5× / $20 thresholds exists or can exist** under the current
  text-regex test approach. Recorded rather than papered over.
- **§12's checklist item was reworded**, not ticked. It now asks what the code actually
  guarantees — source identity retained, no averaging — and notes that explicit disclosure is
  withdrawn per §3.4.

---

## Corrections applied elsewhere in this commit

- `audit/CARDRESELL_PLAN_AND_ROADMAP.md` §3.4 — rewritten. Now states the disclosure is
  withdrawn and not rendered, gives the real occurrence counts, corrects the false
  "exercised by tests" claim, restates the cost, and points here for the routing decision.
- `audit/CARDRESELL_PLAN_AND_ROADMAP.md` §5.4 — corrected. No longer calls the disclosure
  "implemented"; distinguishes the satisfied half of the rule from the unsatisfied half.
- `audit/CARDRESELL_PLAN_AND_ROADMAP.md` §12 — checklist item reworded to be tickable.
- `tests/launch-audit-regressions.mjs:1664` — label corrected, comment added stating what the
  assertion does not cover.
