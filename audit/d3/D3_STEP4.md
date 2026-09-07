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
  `audit/OPEN_NONBLOCKING_NOT_ON_THE_WIRE.md`. **Step 5 inherits this**: the fee table can grow a
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

---

# Follow-ups from review — `d66c6f0`

Four items raised on review. All four found something; two corrected me.

## 1. The harness was the bigger half of finding 3 — fixed there

The rule I drew ("don't dereference the value whose absence you're testing") fixes the instance
and leaves the mechanism. **The reason eleven failures became one is that a throw ends the run,
and that is a property of `harness()`.** The next dereference bug won't be one anyone is watching
for — if it were, it would have been written correctly.

The direction matters: a runner that aborts reports **less damage than there is**. A broad
regression reads as narrow, and every other regression the same change caused is invisible
because those cases never execute. An instrument that under-reports confidently is worse than one
that's absent.

Two changes in `tests/_assert.mjs`:

- **`section(name, fn)`** — per-case error boundary. A throw is recorded as a failure, labelled
  `[case threw, remaining assertions in this case did not run]`, and the suite continues. The
  label is load-bearing: the resulting count is a **lower bound** and the report should say so.
- **`check` accepts a thunk** — a bare function was already always-truthy, the same class as the
  Promise bug the harness exists to refuse. Evaluating it in a try/catch is the only way an
  assertion *about* absence can avoid dereferencing in the caller's expression, where the harness
  can't see the throw.

**Verified by putting the buggy assertion back and re-running the mutation: 1 reported failure
became 12, and the run completed** (54 passed, 12 failed) instead of exiting mid-suite. All six
suites hold exact baselines, so the change is additive.

## 2. The constancy argument, mechanised

Your check is right and it's executable. The sentence claims a property is **constant**, and a
constancy argument can only license dropping keys that **record** that property.

`tests/draft-readiness.mjs` **case 14**, over a fixture set spanning all four blocking codes:

| Key | Result | Consequence |
|---|---|---|
| `severity` | constant | omitting it is licensed |
| `blocking` | constant | omitting it is licensed |
| `field` | **varies** | no constancy argument can omit it — **the assertion that would have refused the edit** |
| `detail` | varies | pinned, so nobody re-files its exclusion under the constancy sentence |

It also asserts the set still spans all four codes, so the variance checks can't pass vacuously.
Cross-referenced from Amendment 6, which makes the contract's own reasoning executable rather
than re-readable. General form: **when a justification is a quantified claim, the quantifier is
testable.**

## 3. `--amber` — hypothesis disconfirmed, worse defect found next door

**No degraded or maintenance banner uses either class.** The three `🛠️` sites in the bundle are
the legitimate "List now" / "List & ship yourself" workflow icon. So the degraded state is not
affected.

**But `.warning-banner` has exactly one caller** (`js/core.7f9c03ad.js:7289`) and it is the
stale-fee-schedule warning:

> "All marketplace fee schedules are past the 45-day verification window. Rankings are shown for
> reference only until the next fee audit."

`border:1px solid var(--amber)` and `background:var(--amber-bg)` are both dead, so only margin,
padding, radius, colour, font-size and line-height survive. **The banner that tells a seller the
entire ranking is unreliable renders as an ordinary paragraph of body text.** Same conclusion you
were reaching for, on the fee-audit surface instead of the degraded one — and arguably worse,
since this one is disclaiming the numbers the seller is about to act on.

`role="status"` is intact, so assistive technology announces it correctly. Appearance was the one
property no assertion covered. `.clamp-note` degrades gracefully — it keeps its box and loses
only the 3px amber caution bar.

Still not fixed: there is no warning token in the palette, so this is a design call.

## 4. INFO — two corrections to my own filing, and you're right about ordering

**Correction (a):** `DRAFT_NO_PRICE_PROVENANCE` is **WARNING**, not INFO
(`api/_draftStore.js:210`). Only `SELLER_PRICED` is INFO. My packet, the open-decision doc, and
my working notes all said both were INFO. The conclusion is unchanged — only ERROR blocks — but
the severity is exactly what makes correction (b) serious.

**Correction (b):** the wire is the second problem. Confirmed in code:

- `draft.packet` is set **only** from `input.packet` (`api/_draftStore.js:485-489`).
- `buildListingPacket()` (`api/_listingPacket.js:315`) has **no production caller** — every other
  reference is in `tests/listing-packet-offline.mjs`.
- The client never sends one: `packet` appears **3 times in 19,348 lines**, none in a create body.

So no production draft carries a packet, every priced draft raises exactly one of the two
findings always and never neither, and widening the wire today would put a **WARNING asserting a
data-quality defect that does not exist** on every priced draft — telling a seller "we cannot say
where this price came from" about a consensus price whose only missing piece is a snapshot nobody
writes. Stamping a lie, and the copy being technically true of the stored row doesn't rescue it.

**A finding whose trigger is an unwired code path measures the code path, not the data.**

Same defect one layer out: `summarize()` already ships `hasPacket` (`api/_draftService.js:516`)
with a comment justifying it as one cheap boolean. It is — and it is `false` for **every row in
production**, so it carries no information either.

**Ordering, revised:** wire `buildListingPacket` into the create path **first**; decide the
non-blocking wire shape **after**, with varying data to look at. Step 5 is blocked twice over by
one root cause, so it builds the table, states the limitation, and does **not** write a column
header.

Renamed to `audit/OPEN_NONBLOCKING_NOT_ON_THE_WIRE.md` — "INFO" was wrong in the title too.
