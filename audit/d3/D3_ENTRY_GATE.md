# D3 Entry Gate — Review Screen

**Date:** 2026-09-06 · **Tip:** `f60d492` · Nothing pushed, nothing deployed
**Status:** BLOCKED on one decision (§3). Everything else is verified and ready.

D3's scope, from `audit/TODO_PHASE1.md:19` and
`CARDRESELL_PLAN_AND_ROADMAP.md:530`:

> Render every missing field by server reason; fee breakdown reconciles to the
> cent.

---

## 1. The two inherited constraints, and what they actually mean

### 1a. "Rows become tappable, so case 15 has to invert deliberately"

Correct and straightforward. `tests/draft-list-screen.mjs` case 15 currently
asserts that a real `click` and a real Enter `keydown` on a `.draft-row` move
nothing — `switchView` not called, `location.href` unchanged, drafts still
visible.

D3 makes that assertion false **by design**. When it lands, case 15 must be
rewritten to assert the new behaviour (a row opens the review screen for its own
`draftId`), in the same commit that makes rows tappable. It must not be deleted,
skipped, or softened to something that passes either way.

The reason it was written as behaviour rather than "no row carries a click
handler" is now load-bearing in the other direction too: the screen binds one
delegated listener to `#draftsWrap`, so a handler-presence assertion would
neither catch a regression nor register the intended change. See instance 5 in
`audit/PATTERN_ASSERTION_SURFACE.md`.

### 1b. "It should call `readinessOf` rather than mapping `v.blocking` itself"

This one does not mean what it appears to mean, and the difference matters.

`readinessOf` is a **server** function (`api/_draftService.js:530`).
`validateDraftForSlot` and `v.blocking` live in `api/` and are **not reachable
from the browser** — there is no bundler and no `package.json`, and adding one is
on the do-not-do list. Verified: `js/core.8bd8277a.js` contains **zero**
occurrences of `.blocking`.

So a client screen cannot call `readinessOf`. The constraint applies to **D3's
server half**, and it is the right warning aimed at exactly the right place —
because the violation it warns about **already exists in shipped code.** See §3.

For D3's client half the constraint reads: **render `readiness` as the server
sent it; derive nothing.** That is what the list screen already does
(`js/core.8bd8277a.js:18638` reads `summary.readiness.publishable` and nothing
else).

---

## 2. What already exists and is ready

| Primitive | Status |
|---|---|
| Single-draft read | `api/drafts.js:188-192` → `readDraft()`, returns the **full draft including `packet`** |
| Full-draft read is the intended review path | Stated at `api/_draftService.js:505-511` — the list deliberately omits the packet "the review screen fetches the full draft when the seller opens it" |
| `hasPacket` boolean on list rows | `api/_draftService.js:511` — lets a row say "priced from a saved quote" without carrying the quote |
| Server-owned blocker copy | `readinessOf` → `{code, message}`, incl. the computed `SLOT_TITLE_TOO_LONG` text |
| Navigation entry point | `openDraftsFocused(draftId)` already exists for the reverse direction |
| Contract coverage of the read path | **None.** `DRAFT_LIST_API_CONTRACT.md` only references `?id=` for draft-id validation (`:317`, `:734`). The response body is unfrozen. |

That last row is good news: D3 is not fighting a frozen contract.

---

## 3. THE BLOCKER — `publishable` means two different things on the wire

This is the decision I need before writing anything.

**List path** ships a narrowed, client-safe projection:

```js
summary.readiness = { publishable: <boolean>, blockers: [{code, message}] }
```

**Single-draft read** (`api/drafts.js:190`) ships:

```js
{ draft: got.draft, publishable: got.publishable }
```

where `got.publishable` is `validateDraftForSlot(cur.draft)`
(`api/_draftService.js:306`) — **the entire validator result object**, not a
boolean.

Run against a 140-char, `$0`, `ebay:fixed-price` draft:

```
validateDraftForSlot -> {"ok":false,"violations":[...2 blocking errors...],...}
typeof               -> object
Boolean(v)           -> true      <-- what a client reading body.publishable gets
v.ok                 -> false
```

**A client doing `if (body.publishable)` gets `true` for a draft with two
blocking errors.** Same field name, opposite meaning, and the wrong reading is
the natural one. D3 is the first client consumer of this path, so D3 is where it
detonates.

It also leaks validator internals — `violations`, `severity`, `blocking` flags,
`warnings`/`infos` counts — to the client, which is the raw material for exactly
the client-side blocker mapping §3.4 forbids. The list path narrows on purpose;
this path does not narrow at all.

### Who consumes it today

| Consumer | Reads | Effect of change |
|---|---|---|
| `js/core.8bd8277a.js` | only `summary.readiness.publishable` (list path) | **none** |
| `tests/draft-crud-e2e.mjs` | `publishable.ok`, `.violations`, `.warnings`, `.infos` at `:193, 592, 672, 682, 691, 776, 791-793, 820, 846` | **~12 assertions** |
| create/edit responses | also ship `publishable: validateDraftForSlot(...)` (`:257`, `:338`) | same question, same field |

### The options

**A — add `readiness`, keep `publishable`.** Single-draft read returns
`{draft, publishable, readiness: readinessOf(draft)}`. D3 reads only `readiness`.
Non-breaking; `draft-crud-e2e` untouched.

Rule-1 check: this adds a second *projection*, not a second *derivation*. Both
come from one `validateDraftForSlot` call site via the existing `readinessOf`, so
no new implementation of the business rule appears. Rule 1 is satisfied. The cost
is that one response carries the same fact twice, and the hazardous
`if (body.publishable)` reading survives for whoever comes next.

**B — replace `publishable` with `readiness`.** Cleanest wire, one representation,
hazard gone. Costs a migration of ~12 assertions in `draft-crud-e2e.mjs`, which
legitimately test validator internals (warning and info counts) that `readiness`
deliberately does not expose — so some of those assertions would need to call
`validateDraftForSlot` directly rather than read it off a response. That is
arguably more correct anyway: they are unit claims about the validator wearing an
E2E costume.

**C — D3 reads `publishable.violations` and filters on `.blocking`.** This is
"mapping `v.blocking` itself" in the client, plus re-authoring copy the server
owns. **Rejected by inheritance 1b.** Listed only to record that it was
considered and refused.

### A sub-question either way

`publishable` is a bad name for a validator object regardless of which option
wins, because the truthiness trap survives any additive change. Worth renaming to
`validation` on the paths that ship the full object (read, create, edit). That is
a larger blast radius than A and smaller than the confusion it prevents, but it
is a third decision and I am not folding it into the first two.

**My recommendation: B, with the `draft-crud-e2e` assertions that test warning
and info counts moved to direct `validateDraftForSlot` calls.** It is more work
now and it removes the trap rather than routing around it. A is the right answer
if you would rather not touch a passing E2E suite before the rotation is done —
which is a legitimate reason, and it is your call, not mine.

---

## 4. What I will build once §3 is decided

In order, one commit each:

1. The read-path change from §3, with `draft-crud-e2e` green.
2. `#reviewView` — container, tab-less (reached from a row, not the tab bar),
   sharing the drafts CSS tokens.
3. Row navigation in the drafts screen + **case 15 inverted in the same commit**.
4. Field-by-field rendering driven entirely by `readiness.blockers` — every
   missing field named by its server reason, no client copy.
5. The fee breakdown, which must **reconcile to the cent**. This is the part with
   real risk: per the standing rule, if it is off by more than a nickel I fix the
   function, not the label. It also inherits `net(price)` non-monotonicity
   (`js/core.8bd8277a.js` net-fee docblock, retired-bundle citation
   `d9e1b484:6466-6494`) — so any inversion is by bisection on the forward
   function, never re-derived algebra.
6. A browser suite for the review screen, mutation-tested like slot 29.

## 5. Open questions for you

1. **§3: A, B, or B-with-rename?** Blocks everything.
2. **Does the fee breakdown show gross → fees → net, or net with fees
   expandable?** D4 puts provenance on every number, so the breakdown will grow a
   source per line; the layout should anticipate that rather than be rebuilt in
   D4.
3. **Is the review screen reachable by URL** (`#review/<draftId>`), or only by
   tapping a row? A URL makes it linkable and testable but adds a routing surface
   the app does not currently have.

Nothing in §4 starts before §3 is settled — the wire shape determines the screen.
