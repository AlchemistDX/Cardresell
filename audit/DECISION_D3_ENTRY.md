# Decision — D3 Entry Gate

**Date:** 2026-09-06 · **Decided at tip:** `f60d492` · **Implemented at:** this commit
**Answers:** `audit/d3/D3_ENTRY_GATE.md` §5 questions 1–3
**Decided by:** owner. Recorded here with the implementation verified against the code.

---

## 1. The `publishable` blocker — neither A nor B

**Decision: rename first, then add.** The sub-question I had set aside is the fix; A and B
are both downstream of it.

### Why both options as I scoped them were incomplete

The trap is not the field's **shape**, it is the field's **name**.

`publishable` is an adjective. A field named with an adjective and holding an object will be
read as a boolean forever, by everyone, on every path. `if (body.publishable)` is not a
mistake someone might make — it is the reading the name asks for. Option A leaves that
intact by design; option B removes it from one path and leaves it on two.

That second point decides it. The full object also ships on **create** and **edit**
(`api/_draftService.js:257, :338`). B as I scoped it fixes only the read path, so afterwards
`publishable` would mean a narrowed object on read, the full validator result on create and
edit, and a bare boolean inside `summary.readiness` on list. **Three meanings for one name
across four paths is worse than one wrong meaning consistently applied.** Fixing it on all
three paths is the coherent version of B — and at that point the migration is larger than
the rename that makes it unnecessary.

### What was decided

1. **Rename `publishable` → `validation` on every path shipping the full validator object**:
   single-draft read, create, edit. `if (body.validation)` is not a reading anyone writes
   expecting a boolean, so the trap is gone **by construction rather than by removal**.
2. **Add `readiness: readinessOf(draft)` to the single-draft read.** D3 reads only this.
   `validation` stays for tests and server-side inspection.
3. **The client never reads `validation`.** Inheritance 1b restated: render `readiness` as
   sent, derive nothing. This is what keeps option C rejected.

Rule 1 holds: both projections come from one `validateDraftForSlot` call site through the
existing `readinessOf`. Two projections of one derivation is not two implementations.

### A correction I accepted

I had offered A as the right answer "if you would rather not touch a passing E2E suite
before the rotation is done." **That reasoning does not hold. The rotation gates pushing,
not editing.** Everything here is local and unpushed; a suite is equally passing whether or
not the Cert ID has rotated. There is no schedule pressure from the push gate on any local
work, and the gate should not acquire an authority it does not have.

---

## 2. What shipped

### Producers renamed — 7 sites

| Site | Was | Now |
|---|---|---|
| `api/_draftService.js:257` | `publishable: validateDraftForSlot(written.draft)` | `validation:` |
| `api/_draftService.js:~296` | `publishable:` (reconcile replay) | `validation:` |
| `api/_draftService.js:~306` | `publishable:` (`readDraft`) | `validation:` **+ `readiness: readinessOf(cur.draft)`** |
| `api/_draftService.js:~338` | `publishable:` (edit) | `validation:` |
| `api/drafts.js:190` | `{draft, publishable}` | `{draft, validation, readiness}` |
| `api/drafts.js:247` | `publishable: r.publishable \|\| null` | `validation: r.validation \|\| null` |
| `api/drafts.js:273` | `{draft, replayed, publishable}` | `{draft, replayed, validation}` |

**Untouched:** `readinessOf`'s `publishable: v.ok`. That is a real boolean and is now the
only field named `publishable` anywhere on the wire.

Two of these — `drafts.js:247` (create) and `:273` (edit) — I had **not** reported in the
entry-gate doc. My §3 consumer table said the create and edit paths shipped the field via
`_draftService`, but I had not traced it through the handler. The map was 7 producers, not 4.

### Consumers migrated — 14 lines, mechanical

- `tests/draft-crud-e2e.mjs` — 11 sites (`:193, 592, 672, 682, 691, 776, 791-793, 820, 846`)
- `tests/draft-list-cap.mjs` — 3 sites (`:729, 736, 738`). **I had not counted these**; my
  entry-gate doc said "~12 assertions in `draft-crud-e2e`" and named no other suite.
- `tests/draft-readiness.mjs` — **no change.** Every reference there is to `readinessOf`'s
  boolean, correctly.

Per the decision this was a rename, not a migration to direct `validateDraftForSlot` calls.
The observation that those assertions are unit claims wearing an E2E costume is accepted as
probably right and left as **separate cleanup** — folding it in would mean two reasons to
touch a passing suite in one commit.

### Contract — Amendment 3

§2.7 froze the create response's nine keys, one being `publishable`. Amended in place: the
ninth key is now `validation`, key count and byte-identical guarantee unchanged.

Also added **§2.9, the single-draft read** — previously unspecified anywhere in the
contract, which referenced `?id=` only for draft-id validation. It now specifies
`{draft, validation, readiness}`, states that `draft` is the path carrying the `packet`, and
records that clients read `readiness` and only `readiness`.

Written as amendments **in place** rather than as superseding documents, for the reason in §4.

---

## 3. Verification

All standalone. `tests/run-all.sh` NOT run — it hits prod.

| Suite | Result |
|---|---|
| `tests/draft-crud-e2e.mjs` | **130 / 0** |
| `tests/draft-list-cap.mjs` | **130 / 0** |
| `tests/draft-readiness.mjs` | **PASS** |
| `tests/draft-focus.mjs` | 56 / 0 |
| `tests/draft-list-screen.mjs` (slot 29) | 80 / 0 |
| `tests/asset-fingerprints.mjs` | 15 / 0 |

Direct proof that the trap is closed and the projections agree, on a 140-char `$0`
`ebay:fixed-price` draft:

```
validation.ok                        : false
readiness.publishable                : false   (typeof boolean: true)
readiness.blockers                   : 2 × {code,message} only
agree (readiness.publishable === v.ok): true

if (body.publishable) would have been : true    <-- 2 blocking errors
if (body.readiness.publishable) is    : false   <-- correct

readiness keys                       : publishable,blockers
blocker leaks severity/blocking?     : false
```

**Caveat on what this proves.** This is a direct call to `readinessOf` and
`validateDraftForSlot`, plus six suites that exercise the renamed field through the real
handler. It is not a registered assertion that the single-draft read *response body* carries
`readiness` — no suite asserts on that key yet, because D3 has no suite yet. That assertion
belongs in D3's browser suite (step 6 of §4 in the entry-gate doc), and until it exists this
row of the contract is documented but not enforced. Recording that rather than letting six
green suites imply coverage they do not provide.

---

## 4. Fee breakdown layout

**Decision: net as the headline, breakdown always visible beneath it, one line per fee.**

Not net-with-expandable-fees. The standing rule is that the breakdown reconciles to the cent
— and **a reconciliation the seller has to tap to see is a claim they will never check.**
Collapsing it puts the arithmetic behind a gesture precisely where the project's credibility
rests on the arithmetic being checkable.

D4 points the same way: provenance is a source per line, and a collapsed panel is where
provenance would go to hide. Lay it out now as a table that can grow a column — fee label,
amount, room for source — so D4 adds a column rather than rebuilding the section.

Gross → fees → net, top to bottom, ending on the number the seller acts on.

---

## 5. URL reachability

**Decision: no. Row tap only, no `#review/<draftId>`.**

- **Half a router is worse than none.** The app has `switchView` and nothing else. Hash
  routing for one screen means the back button works on review and silently fails on
  collection, flips, and lookup — an inconsistency a user discovers by losing their place.
  Routing is a deliberate unit for when several views need it, not a side effect of D3.
- **The testability argument is already satisfied.** The browser harness calls navigation
  functions directly. A URL would make the screen linkable, not more testable.
- **A draft id in a URL invites an assumption it doesn't earn.** The record is auth-gated so
  this is not a leak, but a URL that looks shareable and isn't is a support question waiting
  to happen.

If D5's copy-ready handoff needs a returnable link, that is the moment to design routing
properly across all views.

---

## 6. Why these were written as in-place amendments

Instance 4 in `audit/PATTERN_ASSERTION_SURFACE.md` — the contract's DONE stamp — is the only
one of the six that is not a check in a test file, and it is the one this project is most
exposed to. Eighteen audit documents, one codebase. **A false claim in a test gets caught
when the test runs; a false claim in a document gets cited.**

So Amendment 3 edits §2.7 where it stands and `DECISION_MAINTENANCE_COPY.md` carries its
amendment inline. A superseded document that stays readable is a citation trap. The
catalogue now closes on the general rule: a document asserting that work is complete is
evidence about the document, not about the work — including that document.

---

## 7. D3 is unblocked

Order unchanged from `d3/D3_ENTRY_GATE.md` §4, with step 1 now done:

1. ~~Read-path change~~ — **done, this commit.**
2. `#reviewView` container, reached from a row, sharing the drafts CSS tokens.
3. Row navigation + **case 15 inverted in the same commit**, asserting a row opens review
   for its own `draftId`.
4. Field-by-field rendering driven entirely by `readiness.blockers`, no client copy.
5. Fee breakdown per §4 above. Reconciles to the cent; if it is off by more than a nickel
   the function gets fixed, not the label. Any inversion by bisection on the forward
   function, never re-derived algebra.
6. Browser suite, mutation-tested like slot 29 — including the missing assertion named in §3.
