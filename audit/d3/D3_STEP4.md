# D3 step 4 — blockers render against the field they name

**Commit `cbe4db4`, branch `phase1-block-d`. 57 commits outgoing. Nothing pushed, nothing deployed.**

## What shipped

Every blocker on the wire now renders against the input it is about, and `field` is on the wire
to make that possible without the client guessing.

- **`api/_draftService.js`** — `readinessOf` maps `({code, field, message})`.
- **`js/core.7f9c03ad.js`** — `_REVIEW_FIELDS` (title, price, marketplace, in *repair* order, not
  data order), `_reviewFieldValue`, `_reviewGroupBlockers`, `_reviewBlockerLine`,
  `_reviewFieldsHtml`. Blocker text is the server's message, verbatim. The code goes in
  `data-blocker-code`, never in visible text.
- **`index.html`** — `.review-fields` and friends, plus a fix described below.
- **`tests/draft-review-screen.mjs`** — new, **80/0**. The 30 scratch assertions from `/tmp`
  migrated in-repo and generated from the real handler instead of hand-written.
- **`tests/draft-readiness.mjs`** — both drift guards updated, each recording its old claim in
  the test file.
- **Amendment 6** filed in place in the contract.

## Three findings worth more than the feature

### 1. The contract's exclusion of `field` was never argued

§1.2 dropped four keys in one edit under one sentence: `field`, `detail`, `severity` and
`blocking` are "redundant on the wire, since every element of `v.blocking` is by construction
blocking and of error severity."

That reason is exactly true of `severity` and `blocking` — both are constants over `v.blocking`.
It reaches `detail` only by accident; `detail` is excluded because it is an internal diagnostic,
which is a different argument that happens to give the same answer. It does not reach `field` at
all. `field` varies per finding, cannot be derived from anything else on the wire, and is the
only thing on the wire that says where a blocker belongs. **It was excluded by proximity.**

The generalisation: **a shared reason can be stretched over a key it doesn't cover.** Grouping
decisions into one line is how a justification loses its scope quietly, and the result reads as
more considered than it was — four keys, one confident sentence, and nothing in the text to
signal that the sentence only argued for two.

The cost of its absence was concrete. Without `field`, a client that wants to show a blocker
next to its input has exactly one option: its own code→field table. That is a second
implementation of a server fact, and it fails the way that class always fails — silently, only
for new inputs. Add a fifth `VIOLATION` code and the server raises it correctly, the wire
carries it correctly, the screen puts it in the wrong place, and **every existing test passes**,
because every existing test uses the four codes already in the table. The suite pins it by
sending a real code under a deliberately mismatched `field` and asserting the screen follows the
wire; a client table passes every other case in the file.

### 2. Step 3 shipped a focus ring that never rendered

`632473f` added `.draft-row-open:focus-visible{outline:2px solid var(--accent)}`. `--accent` is
not a declared token. An undefined custom property doesn't fall back — it invalidates the
**entire declaration**, so the ring did not render at all, on the one control whose whole
justification was that a keyboard user must be able to reach it. Now `var(--gold)`.

Every behaviour assertion passed, because "Enter opens the row" is true with or without a
visible ring. Same shape as the click-only binding: the assertion named a behaviour and the
defect was in a different surface.

**The first fix was worse than the bug.** It hand-listed seven token names and asserted each
resolved — green forever, and it would have caught `--accent` only because I already knew to
look. That is a cache of a derivation, which is the dropped offset table again in a test's
clothes. Replacing it with a scan of the stylesheet (every `var(--x)` reference must be in the
set of `--x:` declarations) found **four more undeclared tokens in the same run**:

| Token | Refs | Consequence |
|---|---|---|
| `--amber` | 2 | `.clamp-note`, `.warning-banner` borders never render — **a warning banner with no warning styling** |
| `--amber-bg` | 2 | those backgrounds never apply |
| `--muted` | 3 | three inline styles keep the inherited colour |
| `--text-primary` | 1 | `.density-btn` hover colour never changes |

Eight dead declarations in production, none of which any hand-written list would have named,
because nobody knew they were there. Recorded in `audit/CSS_TOKEN_DEBT.md` and **ratcheted, not
exempted**: the assertion is "no token *outside* this set is undeclared", so a new one fails on
arrival and fixing an old one doesn't break the suite. Deliberately not a count — a count is a
number someone maintains for no benefit, and it fails in the unsafe direction as often as the
safe one.

I did not fix the four. `.warning-banner` is user-facing and the codebase has `--red` and
`--gold` but **no warning token**, so declaring an amber pair is a palette addition and reusing
`--gold` changes what a warning looks like. That's a design call on a surface step 4 doesn't own.

Two supporting rules: **a derivation needs a negative control** (a broken regex returns an empty
set, which reads as a clean bill of health — so the suite asserts the scan found >100 references
and >20 declarations, that a known token is present, and that `--accent` is absent).

### 3. The new suite's worst defect was in the assertion, and only mutation found it

The check for a missing `field` was `x.field.length > 0`. Removing `field` from the wire didn't
fail it — it threw a `TypeError`, and the throw ended the process. Output: **one** reported
failure. The real damage was eleven, and every case after the first never ran.

That's worse than a buggy assertion. **A crashing assertion converts a wide regression into a
single line and silently cancels the rest of the suite** — a strictly worse instrument than no
assertion, because it reports a small number confidently. And it was only visible because the
mutation was run; a green suite can never show it, since the crash needs exactly the condition
production doesn't currently produce.

Rule: **an assertion about a value's absence must not dereference it.** Absence is the case it
exists for, so it's the one input guaranteed to reach it.

## Mutations (all four caught, after the crash was fixed)

| Mutation | Failures |
|---|---|
| Server stops shipping `field` | 11 in the review suite + `draft-readiness` FAIL |
| Client uses a code→field table | 8 |
| Drop the never-drop fallback group | 6 |
| Render every blocker under every field (duplicate, not drop) | 14 |
| Reintroduce `var(--accent)` | 1 — the token ratchet |

The duplicate mutation matters separately: a per-field count wouldn't notice the same blocker
rendered twice. The suite asserts each wire blocker appears **exactly once** on screen.

## Open, carried forward

- **INFO findings cannot reach any client.** `readinessOf` maps `v.blocking` only, and `v.blocking`
  is exactly the ERROR set. `DRAFT_NO_PRICE_PROVENANCE` and `DRAFT_PRICE_SELLER_ENTERED` are INFO,
  and §2.9 says clients read `readiness` and only `readiness`. Both true, both deliberate,
  together meaning the review screen **cannot render a provenance notice today**.
  **Surfaced, not fixed** — widening `blockers` to hold non-blocking findings makes the key a lie
  and puts `publishable: true` next to a non-empty `blockers` array. Three unchosen options in
  `audit/OPEN_INFO_NOT_ON_THE_WIRE.md`. **Step 5 inherits this**: the fee table can grow a
  provenance column but cannot fill it, and step 5 should say so rather than implying the column
  is one query away.
- **`asset-fingerprints` 14/1**, held deliberately. Bundle bytes changed again. The single rename
  closes D3.
- **`draft-review-screen.mjs` is unregistered.** Step 6 owns the runner wiring; the deferral is
  recorded in the file's header rather than only here.
- The read-body-carries-`readiness` gap is **closed** — the generated fixtures assert it across
  all four envelopes, so it's a claim about what the handler emits, not what a fixture author
  believed.

## Suites

`draft-review-screen` **80/0 (new)** · `draft-list-screen` 101/0 · `draft-focus` 56/0 ·
`draft-list-cap` 130/0 · `draft-crud-e2e` 130/0 · `draft-readiness` PASS ·
`asset-fingerprints` 14/1 (held).
