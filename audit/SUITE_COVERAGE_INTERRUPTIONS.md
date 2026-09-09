# Suite coverage interruptions

A suite that crashes mid-file does not report a failure count — it reports the
assertions it reached and then a stack trace. Every commit made while it was in
that state was validated by **less** coverage than the suite's name implies, and
restoring it later does not retroactively validate them.

This file exists so that fact is attached to the revisions it applies to,
rather than being mentioned once in a return packet. One entry per
interruption. **Recording an interruption is not the same as re-validating the
revisions inside it, and this file never claims to.**

---

## SI-1 — `tests/quick-pricing.mjs`, `_crRetrievedAtFrom` (2026-09-08)

**Symptom.** `ReferenceError: _crRetrievedAtFrom is not defined`, thrown from
inside a `new Function` built out of source fragments extracted from the live
bundle by string search. Node exits non-zero at that point; nothing after it in
the file runs.

**Cause.** The suite's server→wire→basis→headline chain block evaluates the
bundle's `window._crBasis = { … }` literal verbatim. When the retrieval-time
work moved that literal onto a helper call (`_crRetrievedAtFrom(_basisMeta)`),
the helper's own source was not in the evaluated scope. The extraction still
matched, so the failure was a crash rather than a missing-fragment assertion.

**Window, measured not inferred.**

| Revision | `quick-pricing` result |
|---|---|
| `00445d0` — T2.10 closeout, where the chain block was added | **219 passed, 0 failed** (last known good; re-run from a clean worktree 2026-09-08) |
| `a8dc3d6` — introduced `_crRetrievedAtFrom` | interrupted |
| `aa706dd` | interrupted |
| `16653e8` | interrupted |
| `a477635` | interrupted |
| `0cc4477` — Lane A three-check close | interrupted |
| `ffa735d` | **205 ✓ reached, then crash** (re-run from a clean worktree 2026-09-08) |
| `da13bee` — create-path binding; extraction repaired | **219 passed, 0 failed** |

**Six revisions were made while the suite was interrupted**, and the two
bundle generations that shipped inside that window are `34fb750c` (at `a8dc3d6`)
and `c61a6ef9` (at `0cc4477`).

**What was lost.** 14 assertions — 205 reached against 219 available. They are
the tail of the file: the chain's own hops, and the T2.14 fee-row and
midpoint-provenance integration cases that sit after it.

**What today's 219/0 does and does not establish.**

- **Does:** the suite is whole again at `da13bee`, and the 14 tail assertions
  pass against the current bundle. The repair prepends the real source of
  `_crRetrievedAtFrom`, `_crIntentToken` and `_crBindBasis` rather than stubbing
  them, so the chain still exercises shipped code.
- **Does NOT:** validate `a8dc3d6`, `aa706dd`, `16653e8`, `a477635`, `0cc4477`
  or `ffa735d`. Those revisions were merged on a reduced suite. The tail
  assertions have never been run against the `34fb750c` or `c61a6ef9` bundles,
  and — per the citation map — no file with `34fb750c`'s bytes survives to run
  them against. `c61a6ef9` is recoverable (`git show ffa735d:js/core.c61a6ef9.js`)
  if anyone wants that specific gap closed; it has not been closed.
- **Does NOT** establish that no other suite is currently interrupted. The
  detection here was incidental — the crash surfaced only because a neighbouring
  change touched the same extraction. **See the prevention item below; it is not
  done.**

**Prevention — OPEN, not implemented.** A suite's exit code is checked, but
nothing checks that a suite ran the number of assertions it ran last time. A
crash after 205 of 219 looks like a pass to anything reading only "no ✗ lines".
The cheap version is a per-suite expected-count floor, asserted by the suite
itself, so a truncated run is a failure rather than a shorter success. Not
built. Recorded here so the next interruption is caught by a check instead of by
luck.


---

## 2026-09-08 — a suite had drifted out of the runner, found incidentally again

Registering the D7 photo suite made `tests/test-registry.mjs` go red on a file
that is not the D7 one: **`tests/decision-restatements.mjs`**, added at
`d0e9665`, present on disk, never invoked by `tests/run-all.sh` and never
declared excluded. `git log -S` over the runner shows it was never referenced
there at any point, so this is not a regression — it never landed. It is the
same failure class the exclusions block was written to stop, and it survived
because nothing forced anyone to look until an unrelated slot was added.

Both files are now accounted for, and **in different ways, deliberately**:

- `decision-restatements.mjs` is now **slot 48**, an ordinary offline slot. It
  needs nothing the runner does not have.
- `listing-photos.mjs` is a **declared exclusion**, on the
  `flip-completeness-e2e.mjs` precedent — Playwright and a local server. Its
  results live in `RELEASE_VALIDATION_QUEUE.md` as RV-7.

**Not fixed by this.** The detection was still incidental. The registry only
answers "is every file accounted for", asked whenever someone happens to run
it; nothing runs it on a change to `tests/`. And the per-suite assertion-count
floor recorded in the previous entry is **still not built** — a suite that
crashes partway still reads as a pass to anything checking only the exit code.
`decision-restatements.mjs` was 33/33 when run by hand at this checkpoint; that
is a hand-run number, not a gate.


## 2026-09-08 — `draft-review-screen` basis-binding flake: capture race ruled out

Reviewer direction was to correlate each captured POST with its intended create
and retain the failing payload and timing, rather than accumulate passing
reruns. Done, and it changed the answer.

**What the suite used to do.** `posted = null`, click, then "wait for ANY
POST." A body arriving after the reset satisfied the wait regardless of which
click produced it, and nothing retained what arrived or when.

**What it does now.** Every POST is retained with sequence and arrival time
(`tests/draft-review-screen.mjs`, `postLog` / `postLogDump`), each of the four
cases declares the create it expects by identity, and the wait matches within
that case's window only. A new assertion — *"each create arrived inside the case
that issued it, and there were four"* — states the correlation directly. The
predicate deliberately does **not** mention `basisMeta`: that is the value under
test, and waiting on it would turn a product defect into a timeout.

**A predicate bug of my own, first.** My first identity predicate required
`!body.instanceId` for the panel create. Panel creates carry
`inst_scan_<uuid>`, so three waits timed out at 15s each and the suite reported
creates as absent that had in fact arrived — 335/4, deterministically. Recorded
because it is the same class of error as the flake itself: the check was wrong
about the product, not the reverse.

**The finding.** With the corrected predicate the flake reproduced twice in
four runs, and once more in a later batch. In every failing run:

- the correlation assertion **passed** — exactly four creates, one per case,
  each inside its own window, with case 3's create carrying the right
  `inst_scan_` identity;
- the payload for case 3 carried `basisMeta=undefined`;
- the in-page capture read **`basisAtPost=null`**.

So the capture race is **ruled out**. The body that failed the assertion was
case 3's own create, and the basis global was **already null before that body
was built** — this is not a serialization defect on the wire either. A second
observed failure mode, on case 2's evidence check, has the identical signature:
`captured as the request left: null`.

**Still open, and deliberately not guessed.** What clears the global. Only two
sites in the bundle write null — `loadCardUI` (`js/core.3f83abec.js:3556`) and
`_onPrintingChange` (`:4866`) — and neither is a create-success handler, so the
obvious story (a prior create's success clearing a basis bound after it) is
**not supported by the code as read**. A test-side trap now records the stack
of every clear and prints it in both failing assertions' detail
(`__basisClears`). It has not yet caught a failing run: the three runs after it
was added went 339/0, 338/1 (case 2, before the trap read was wired into that
assertion), 339/0.

**Next step** is to reproduce with the trap live on both assertions and read the
stack, not to rerun for green. There is a real product question waiting behind
it: if something can clear a bound basis between binding and create, a seller's
comp provenance can silently vanish from a packet in production, which is
exactly what the binding work existed to prevent.

Unchanged: the per-suite assertion-count floor is still not built, and registry
drift detection is still incidental.
