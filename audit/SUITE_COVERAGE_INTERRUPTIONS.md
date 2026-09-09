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
