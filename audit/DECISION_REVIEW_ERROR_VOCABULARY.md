# Decision — Review Screen Error Vocabulary

**Date:** 2026-09-06 · D3 step 2 · Answers `audit/d3/D3_STEP2.md` §4

---

## Decision

**Option A — narrow the grep — and drop `_REVIEW_ERR_ALIAS`.** The review screen owns its
copy table outright. C stays rejected for the reason given: relocating code out of a slice to
make an assertion pass is flipping the tripwire wearing a refactor's clothes.

---

## The reframe is right in its conclusion and wrong in its premise

The proposed reasoning is that these are two vocabularies for two different domains, and that
the shared word "unreadable" is a coincidence of English. **The first half doesn't hold.**

The list path does not have an independent vocabulary. It **translates** the store's errors
into row reasons: `reason` is a `ROW_REASON` value derived from a `STORE_ERR` value, and the
two diverge for exactly one case — the store says `DRAFT_RECORD_UNREADABLE`, the row says
`DRAFT_UNREADABLE`. That divergence is already documented as naming trap #1 in contract §2.5.

So for the overlapping subset, both paths are reporting the **same store condition** under two
names. That is a shared source, not a coincidence of English.

The claim that survives is the second half: the read/edit path has conditions the list cannot
express — `DRAFT_REVISION_CONFLICT`, `DRAFT_REVISION_REQUIRED`, `DRAFT_NOT_EDITABLE` — and the
list has a per-row partial-failure concept the read cannot express. **The vocabularies overlap
on a shared source and diverge outside the overlap.** Neither "one vocabulary" nor "two
unrelated domains" describes it.

### Why de-aliasing is still correct

The better argument is about **consequence, not domain**.

On the list, an unreadable record means one row is a stub and the rest of the list works. On
the review screen, the same store condition means the seller has nothing — no fields, no
verdict, no fee breakdown. Same cause, different situation, and the copy has to tell the seller
different things about what to do next.

An alias asserts that two surfaces should say the same thing. They shouldn't. That's the
justification, and it's more durable than the domain claim: if someone later adds a genuinely
shared code, "two unrelated domains" collapses and the de-aliasing looks unjustified, while
"different consequence, different copy" still holds.

So the code comment's sentence — "a vocabulary difference is not a licence for a second copy
table" — is right as written, and simply isn't what's happening here. What licenses the second
table is a consequence difference, not a vocabulary difference. Reword rather than reverse.

---

## Two hazards to record while this is open

### 1. The two spellings will look like a bug to the next person

`DRAFT_UNREADABLE` and `DRAFT_RECORD_UNREADABLE` now both appear in the bundle, denoting the
same store condition on two surfaces. That reads as an inconsistency someone should tidy, and
tidying it in either direction breaks something: unifying on the store spelling breaks the
list's row matching; unifying on the row spelling breaks the read path.

Contract §2.5 documents the trap from the list side. It now needs the read side too — the note
should say both spellings are correct, name which surface uses which, and say plainly that
they must not be unified.

### 2. Narrowing by position will break again

Scoping the grep from `_DRAFT_STUB_COPY` to "the start of the review screen" repairs the proxy
by re-inferring the region from what happens to sit next to it. The next thing appended to the
bundle re-widens it silently, which is how this assertion got here.

**Declare the region instead of inferring it.** An explicit end sentinel — a marker comment the
slice reads — makes the boundary a stated fact rather than a consequence of code order. Then
appending code cannot move it, and moving the region deliberately is a visible edit to the
marker.

---

## On "this is the pattern again, on the reuse side"

It's a sibling, not instance 7, and the distinction matters for the remedy.

The catalogue's pattern is a **check** whose name claims more than its evidence samples. What
`_draftsAbsorb` shows is an **implementation** that is correct because of a property of its own
endpoint — the list's failures ship prose — with that dependency nowhere stated. Copied to an
endpoint whose failures ship machine codes, it prints `DRAFT_NOT_FOUND` at a seller.

Both are failures of unstated scope, which is why they feel like one thing. The remedies
differ:

- For an assertion: **name the reach.** "…in the list screen region" rather than "the client".
- For an implementation: **state the invariant at the site.** `_draftsAbsorb` should say that
  it renders `body.error` directly because this endpoint's errors are human copy, and that the
  line is not portable.

Worth its own short entry rather than a sixth tally mark under a pattern about tests.

---

## Sequencing

Both changes touch a passing assertion and a shipped comment, so they land together, in one
commit, ahead of the deferred bundle rename (`D3_STEP2.md` §5.1). Deferring the rename until
the error table settles is right — retiring two bundles for one step would cost a second set of
citation offsets for no benefit.
