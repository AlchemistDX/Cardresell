# Decision Record — `94dc777` Commit History, and the Push Gate

**Decided:** 2026-09-06 by the owner · **Tip:** `cbb5552`, branch `phase1-block-d`, clean tree,
36 outgoing commits, nothing pushed

---

## Decision: Option A — keep the history

`94dc777`'s message is retained as written. No rebase, no rewrite, no force-push. The commit
and its 35 descendants keep their current SHAs.

### Evidence

A scan of the commit message found **no full credential and no credential-shaped fragment**:

- Zero alphanumeric runs of 30+ characters, so neither a 40-character App ID nor a
  36-character Cert ID is present in full.
- Zero runs of 12–29 characters mixing upper case, lower case, and digits.
- The only runs over 20 characters are two, both SHA- or identifier-shaped rather than
  secret-shaped.

Method, for anyone re-checking: counts only, values never printed. `git log -1 --format=%B`
piped through `grep -oE` on character-class runs, then `wc -l`. Reproducible without
disclosing anything.

### Rationale

Option B would rewrite 36 commits to redact fragments of a credential that is being retired
anyway. Those SHAs are cited throughout the audit corpus — the plan doc's git-state section and
commit-history table, `TODO_PHASE1.md`, and the contract doc's own verified-against line. A
rewrite invalidates every one of them, and the plan doc's own rule is that a rewrite requires
all review evidence to be regenerated.

The documentation pass is the larger half of the cost, not the rebase. Paying it to redact a
fragment of a dead credential is a bad trade.

### The condition attached to this decision

**A is safe because rotation happens.** The decision rests on the Cert ID being retired, which
turns the fragments into references to a dead credential.

**If rotation stalls indefinitely, revisit this.** A keeps the fragments in place; only
rotation makes that harmless.

---

## The binding rule this produces

> **Do not push before the Cert ID is rotated. Full stop, under either option.**

`94dc777` is unreachable from `origin/main` (`git merge-base --is-ancestor` returns false), so
the fragments exist only in unpushed history. **The push is the publishing event.** Pushing
before rotation publishes fragments of a live credential; pushing after rotation publishes
fragments of a dead one.

This corrects an earlier framing — mine — that treated the first push as a deadline for the
history decision. The dependency points the other way: rotation is the gate on the push. Under
A that gate is the only protection, because A leaves the fragments in place to be published
as-is.

Note this rule is **additive to**, not a replacement for, the existing deploy authorization
rule (§5.9, "Do not deploy without authorization"). Rotation being complete does not by itself
authorize a push; it removes one blocker. Pushing `main` auto-deploys, so a push still needs
its own explicit authorization.

---

## Rotation sequence

Order matters. This is a portal action in the eBay developer account; no repository change
substitutes for it.

1. Rotate the Cert ID in the eBay developer portal.
2. Update the Vercel environment variable in **both Production and Preview**.
3. Confirm the live path still works: `EBAY_LIVE=1 node tests/ebay-live.mjs`.
4. **Then** delete `refs/recovery/pre-scrub-c2366b2` — verified still present at
   `c2366b29bdc98ad7eb4281d256c085ba3a97c418`. Deleting it before step 3 removes the fallback
   while the new credential is unproven.
5. Do not use the unblock URL at any point.

**Steps 2 and 3 depend on the open Vercel dashboard questions**, chiefly whether Preview
receives live eBay credentials and whether Preview reads production KV. If Preview shares the
production key, rotation must land in both environments simultaneously or Preview breaks.

### On the 18/19 pass bar

The live harness currently reports 18/19, so **18/19 is the bar for confirming the rotation
worked** — the nineteenth failure predates it and rotation is not expected to fix it.

This is not the same as the release gate. Phase 2 entry requires **19/19**, verified at
`audit/CARDRESELL_PLAN_AND_ROADMAP.md:482` (§6.1 Product phases), whose Phase 2 row reads
"Official user OAuth verified; credential rotation complete; live gate 19/19; descriptor value
IDs resolved from user-scoped policies; token storage/deletion contract reviewed." The same
document restates it at `:641` — "The live harness is reported at 18/19; release requires
19/19."

A rotation verified at 18/19 confirms the credential, and nothing more. Do not later cite
"18/19 passed" as clearing the Phase 2 gate.

Also note `:601` — "reportedly at 18/19; this was not re-run." The 18/19 figure is itself a
carried-forward report, not a fresh measurement. Step 3 will be the first re-run, so treat it
as establishing the baseline as much as confirming the rotation. If it comes back at something
other than 18/19, the delta is not necessarily the rotation's fault.

---

## What this closes, and what it does not

**Closed:** the `94dc777` A/B decision. Removed from the open-items list in `TODO_PHASE1.md`.

**Still open:** the Cert ID rotation itself, and the five Vercel dashboard unknowns that steps
2 and 3 depend on.

**Unaffected:** D2.1. Neither item blocks the `readiness` server change or the drafts screen.

---

## Pinned state

36 outgoing commits at tip `cbb5552`. The orientation packet's count of 33 was accurate at
`95435b4`; the three since are the T2.7/T2.8 to-do patch, the contract document, and
Amendment 1 — **all documentation-only**, so every code line number cited across the corpus
remains valid.
