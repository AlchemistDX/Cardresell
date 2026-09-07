# Pattern — An assertion that names a behaviour and evidences a surface

**Six instances.** First treated as a class in
`audit/DECISION_SOURCE_DISAGREEMENT.md:19-22` at three. This file is the
catalogue; other docs should cite it rather than re-deriving the pattern or
guessing the count.

## The shape

A check claims a property about **behaviour** — "only X retries," "the site never
says Y," "the thresholds hold" — but the evidence it actually gathers is the
**text or shape of one surface**. The claim and the evidence are different
propositions. The check can be green while the named property is false, and
reading the check tells you nothing, because the name is the part that lies.

**Text tests fail toward false confidence; behaviour tests fail toward false
alarm.** A behaviour test that breaks wakes you up. A text test that stops
covering its subject goes quiet, and quiet reads as fine.

The corollary that keeps catching us: **green-after-work is worse than
green-on-arrival**, because the work looks like care. Every instance below was
written deliberately by someone trying to be careful.

## The catalogue

| # | Instance | Named | Actually evidenced | Where |
|---|---|---|---|---|
| 1 | `SLOT_` prefix trap | a blocking-code contract | the prefix of a string | `DECISION_SOURCE_DISAGREEMENT.md:19-22` |
| 2 | offset-518 fixture | paging against a populated index | a fixture green against an **emptied** index | same |
| 3 | `/function _sourceDisagreement/` | the 1.5×/$20 thresholds hold | the function is still present in bundle text | same, `:24-27` |
| 4 | the contract's DONE stamp | D2.1 complete | a doc line saying so | `DRAFT_LIST_API_CONTRACT.md` |
| 5 | case 15, original form | rows navigate nowhere | no row carries a click handler — **delegation defeats it** | `tests/draft-list-screen.mjs`, commit `f8a8248` |
| 6 | `no maintenance wording` / `no beta wording` | a **site-wide** copy rule | the text of `readAppSource()` output | `tests/a11y-mobile-2026-09-04.mjs:409-410`, `DECISION_MAINTENANCE_COPY.md` |

Instance 5 is the one to keep in mind when writing new checks: it was the
*careful* version of the assertion. "No row has a handler" sounds stricter than
"clicking a row does nothing." It is weaker, because the screen binds one
listener to `#draftsWrap` and that listener appears on no row at all.

## Why #6 is a genuine addition and not just a sixth tally mark

The first five all failed in **one** direction — they were too weak, and every
one produced false confidence. #6 fails in **both directions at once**:

- **Over-broad.** `readAppSource()` inlines the bundle into the tested text, so a
  rule about user-facing copy polices **code comments**. A comment explaining why
  the word is banned trips the ban.
- **Under-broad.** `readAppSource()` reads HTML and the bundle. It never reads
  `api/`. So `api/verify-send.js:155` ships *"Email delivery is restricted during
  beta"* to users today, and the `no beta wording` assertion is **structurally
  blind** to the one place the forbidden word actually reaches a user. That is
  T2.8, still open.

So the assertion that exists to catch this class of copy problem cannot see the
only live instance of it, while it can see — and fail on — a comment that no user
will ever read.

That matters for how the class is understood. The lesson from #1–#5 was "your
green check may be weaker than its name." #6 adds: **the surface you sampled also
defines what you can never catch, and that blind spot is invisible from inside the
check.** The assertion looks site-wide because its name says site-wide. Nothing
in the test names its own reach.

## A second-order consequence, from #6

Because the pair was written from a general "no provisional-sounding language"
instinct rather than from plan doc §5.8, **there was never a competing rule to
lose.** Two consecutive assertions where one implements §5.8 and the other
inverts it are not a considered position; §5.8 was never in the room. What looked
like a collision between two rules was one rule and one artifact.

Generalised: **an instance of this pattern can masquerade as a genuine
disagreement between authorities.** Before adjudicating a conflict between a
check and a spec, establish that the check is a considered position at all. The
tell here was cheap and mechanical — look at the adjacent line. That is a better
move than reconstructing intent, which produces a plausible rationale for a rule
that never had one, and inventing a reason for a rule is the same class of error
as inventing a number.

## Practice

- Name the check after what it actually samples. `'the detection function
  definition is still present in the bundle (text only)'` is the corrected form
  of #3 — long, honest, and it stops the label from doing the lying.
- State the reach in the test. If it cannot see `api/`, say so where someone
  editing it will look.
- Prefer behaviour when the claim is behavioural, and synthesize real events.
  Case 15 dispatches an actual `click` and an actual Enter `keydown`.
- **Prove the instrument can fail.** Case 15 verifies its `switchView` spy
  observes a real call; without that, its four assertions are decoration. A
  mutation that the suite does not catch is the same finding.
- Mutation-test anything load-bearing. The delegated-handler mutation is what
  separated #5's careful-but-wrong form from the version that works.

---

## Instance 4 is the one this project is most exposed to

Five of the six instances are checks in test files. **Instance 4 — the contract's own DONE
stamp, which named D2.1 complete and evidenced a doc line saying so — is the only one that
is not.** That makes it the most dangerous of the six here, not the least.

There are eighteen audit documents and one codebase. A false claim in a test gets caught
when the test runs. **A false claim in a document gets cited.** Nothing re-executes a
document; the next reader inherits it as established, and every later doc that cites it
inherits it too. The stamp had no mechanism that could ever have contradicted it.

This is why the amendment to `DECISION_MAINTENANCE_COPY.md` and Amendment 3 to
`DRAFT_LIST_API_CONTRACT.md` were both written as amendments-in-place rather than as new
documents superseding old ones. A superseded doc that stays readable is a citation trap.

Practice rule: **a document asserting that work is complete is evidence about the document,
not about the work.** Re-derive the claim from the code or the suite before citing it,
including when the document is this one.

---

## A sibling pattern: the implementation with an unstated invariant

Found 2026-09-06, building D3 step 2. Recorded here as a **sibling, not a seventh instance** —
the distinction is the remedy.

Every instance above is a **check** whose name claims more than its evidence samples. This one
is an **implementation** that is correct because of a property of its own endpoint, with that
dependency stated nowhere.

`_draftsAbsorb` renders `body.error` straight to the seller:

```js
text: b.error || "Something went wrong loading your drafts."
```

Correct — the list endpoint's failures ship human prose (`'Could not load your drafts'`,
`api/drafts.js:132,174`). Read as *"how this app absorbs a draft-endpoint error,"* wrong: the
single-draft read **in the same file** ships machine codes (`errorBody`, `api/drafts.js:343-344`),
so the same line copied there prints `DRAFT_NOT_FOUND` at a seller. Nothing in the function said
which reading was intended, and the reuse was one line away.

Both patterns are failures of **unstated scope**, which is why they feel like one thing. The
remedies differ:

| | Failure | Remedy |
|---|---|---|
| Assertion | evidence samples less than the name claims | **name the reach** — "…in the drafts screen region", not "the client" |
| Implementation | correctness rests on an unstated local property | **state the invariant at the site**, and say the line is not portable |

Both were applied: `tests/draft-list-screen.mjs` now names its region and reads a declared
sentinel rather than slicing to end-of-bundle, and `_draftsAbsorb` now carries a NOT PORTABLE
note naming the endpoint property it depends on.

**Corollary on narrowing.** Repairing an over-wide assertion by re-inferring its boundary from
adjacent code just reschedules the failure — the next append widens it again, silently, which is
how the original got there. Declare the boundary so that widening it becomes a visible edit.

---

## A document that names a derived value before the derivation runs

Found 2026-09-06, renaming the bundle. **A distinct entry, not a variant of instance 4** — the
two differ in when they can be caught, which is what makes this one worse.

Instance 4 was a document claiming **completed** work. False, but checkable: the code exists,
so anyone suspicious can re-derive the claim today.

This is a document claiming a **future** fact. `audit/d3/D3_STEP2.md` §5.1 stated that the
pending rename would go to `core.8e24cab9.js`. That was true when measured and stopped being
true four edits later, and nothing about the sentence changed to say so. A predicted derived
value is **unfalsifiable until someone acts on it — and acting on it is what makes it wrong.**
Executing it would have created a file whose name disagrees with its contents, which is
precisely the condition `tests/asset-fingerprints.mjs` exists to detect, arrived at by trusting
a document instead of the bytes.

Practice rule: **re-derive, then stamp.** A document may record that a derived value *will be
needed*; it must not record what the value *will be*. Names it cannot know: content hashes,
line numbers in files still being edited, commit counts, offsets.

Corollary — where a derived table is genuinely useful, ship the derivation next to it and let
the derivation be runnable, so the stamped copy can be contradicted rather than inherited. Done
for the citation offsets: `audit/BUNDLE_CITATION_MAP.md` carries the tables,
`tools/bundle-citation-map.mjs` re-derives them and fails on any citation that no longer
resolves. The tool reads the live bundle name out of `index.html` instead of hard-coding it, so
the next rename ages the tables and not the check.

---

## Instance 7 — the assertion crashed on the condition it existed to detect

D3 step 4. The new suite checked that no blocker arrives without a `field`:

```js
b.readiness.blockers.every((x) => x.field.length > 0)
```

Mutation-testing removed `field` from the wire. The check did not fail — it threw
`TypeError: Cannot read properties of undefined (reading 'length')`, and the throw
propagated out of the case, past `finally`, and ended the process.

The output was **one** reported failure. The real damage was eleven, and every case after the
first was never run. So the mutation looked narrowly contained when it was broad, and any
*other* regression the mutation caused was invisible. The correct read is worse than "the
assertion was buggy": a crashing assertion converts a wide regression into a single line and
silently cancels the remainder of the suite. It is a strictly worse instrument than no
assertion at all, because it reports a small number confidently.

The fix is `typeof x.field === 'string' && x.field.length > 0` — check the shape before the
property. The general rule: **an assertion about a value's absence must not dereference it.**
Absence is the case it is built for, so it is the one input guaranteed to reach it.

This was only visible because the mutation was run. A green suite would never have shown it;
the crash requires exactly the condition production does not currently produce.

---

## Instance 8 — a hand-listed check is a hand-maintained table wearing a test's clothes

Same step. D3 step 3 shipped `outline:2px solid var(--accent)` where `--accent` is not a
declared token. An undefined custom property invalidates the **whole declaration**, so the
focus ring did not render at all — on the one control whose entire justification was keyboard
reachability. Every behaviour assertion passed, because "Enter opens the row" is true with or
without a visible ring. That is instance 1's shape again: the assertion named a behaviour and
the defect was in a different surface.

The interesting part is the first attempted fix. It listed seven token names and asserted each
resolved:

```js
const TOKENS = ['--gold', '--red', '--border', '--text', '--text-muted', '--surface-2', '--radius-md'];
```

That check is green forever and would have caught `--accent` only because the author already
knew to look for it. A hand-maintained list of what is worth checking has the same failure mode
as the dropped offset table: it is a **cache of a derivation**, it goes stale the moment
something new is referenced, and its staleness is invisible from inside it.

Replacing it with a scan of the stylesheet — extract every `var(--x)` reference, extract every
`--x:` declaration, assert the first set is contained in the second — found **four more
undeclared tokens in the same run**, including `.warning-banner`, which renders with no border
or background. Eight dead declarations, none of which any hand-written list would have named,
because nobody knew they were there. Recorded in `audit/CSS_TOKEN_DEBT.md`.

Two supporting rules learned here:

- **A derivation needs a negative control.** A broken regex returns an empty set, which reads
  as a clean bill of health. The suite asserts the scan found >100 references and >20
  declarations, that a known-declared token is in the set, and that `--accent` is not.
- **A ratchet, not an exemption.** Pre-existing debt is enumerated and the assertion is
  "nothing *outside* this set", so a new offender fails on arrival while fixing an old one does
  not break the suite. Deliberately not a count: a count is a number someone maintains for no
  benefit, and it fails in the unsafe direction as often as the safe one.

---

## Instance 9 — the harness was the bigger half of instance 7

Instance 7 recorded a crashing assertion and drew a rule at the assertion: don't dereference the
value whose absence you are testing. That rule is correct and it is the smaller half.

**The reason eleven failures became one is that a throw ends the run.** That is a property of
`harness()`, not of the assertion. The assertion bug was one instance; "a throw ends the run" is
the mechanism that converts *any* future dereference bug into the same misreport — and the next
one will not be one anybody is watching for, because if it were, it would have been written
correctly.

The direction of failure is what makes this urgent. A test runner that aborts reports **less
damage than there is**. A broad regression reads as a narrow one, and every other regression the
same change caused is invisible, because those cases never execute. An instrument that
under-reports confidently is worse than one that is merely absent.

Fixed in two places in `tests/_assert.mjs`:

- **`section(name, fn)`** — a per-case error boundary. A throw is recorded as a failure of the
  case, explicitly labelled `[case threw, remaining assertions in this case did not run]`, and
  the suite continues. The label matters: the resulting count is a **lower bound**, and the
  report should say so rather than presenting a number that looks complete.
- **`check` accepts a thunk.** A bare function was already always-truthy — the same class as the
  Promise bug the harness was built to refuse. Rather than refuse it, evaluate it in a try/catch,
  because a lazy condition is the only way an assertion *about* a value's absence can avoid
  dereferencing that value in the caller's expression, where the harness cannot see the throw.

Verified by restoring the original dereferencing assertion and re-running the mutation: **1
reported failure became 12, and the run completed** (54 passed, 12 failed) instead of exiting
mid-suite. All six existing suites hold their exact baselines, so the change is additive.

The general form: **when an instance is fixable at two levels, fixing only the instance leaves
the mechanism.** Ask which level the next occurrence will arrive through.

---

## Instance 10 — a constancy argument, mechanised

Contract §1.2 dropped four keys from the blocker wire under one sentence: they are "redundant on
the wire, since every element of `v.blocking` is by construction blocking and of error severity."

The author of that edit identified the mechanical check hiding in it. **The sentence is a claim
that a property is constant, and a constancy argument can only license dropping keys that record
that property.** `severity` and `blocking` do. `field` varies per finding, so the sentence could
not have covered it. Four keys, one quantifier, two of them actually quantified over — and no
judgment is required to see it.

That is now asserted rather than trusted, in `tests/draft-readiness.mjs` case 14. Over a fixture
set spanning all four blocking codes:

- `severity` is constant → omitting it is licensed.
- `blocking` is constant → omitting it is licensed.
- `field` **varies** → no constancy argument can omit it. *This is the assertion that would have
  refused the original edit.*
- `detail` also varies → pinned, so nobody later re-files its exclusion under the constancy
  sentence. Its real reason is that it is an internal diagnostic.

The case also asserts the fixture set spans all four codes, because if it stopped spanning them
the variance checks would pass vacuously and prove nothing.

The reusable move: **when a justification is a quantified claim, the quantifier is testable.**
Reasons written in prose get stretched over keys they don't cover, and the stretch is invisible in
the prose but not in the data. Prefer justifications whose scope can be executed.

---

## Instance 11 — a fixture that never reached the state it was named for

Found by scanning for values whose domain has collapsed to one point. The first thing the scan
turned up was not a wire key; it was a test input.

`tests/draft-readiness.mjs` built its no-provenance case as
`base({ priceSource: 'unknown', packet: undefined })`. The provenance gate is
`!hasOwnProperty(draft, 'packet')`, and an object spread **writes the key with an undefined
value** rather than omitting it. So the gate never opened and the fixture produced **zero
violations**. A case named `'no provenance'` asserted nothing about provenance for its entire
life. It could not go red, because the only thing asserted of that row was that it carried a
well-typed `readiness` — which it did.

Compounding it: `'unknown'` and `'consensus'` are not members of `PRICE_SOURCES`
(`{seller, comp, venue}`), and create refuses anything else. The fixtures described drafts the
store would never persist — invisible because `validateDraftForSlot` and `readinessOf` **read**
`priceSource` without validating it.

**A fixture whose name asserts a condition it does not create is worse than a missing fixture,
because it reads as coverage.** A missing case is visible in a list; this one is invisible
everywhere except in the state it failed to build.

Fixed with a `noPacket()` builder that `delete`s the key, and **case 15 as its negative control**
— asserting the builder removes the key, that `base({packet: undefined})` still *has* it (the bug
pinned as an executable fact rather than a comment), that each fixture raises the finding it is
named for, and that `base().priceSource` is one the store would accept.

The general rule, and it is the same one as instance 8: **a fixture is an instrument, so it owes
the same negative control an assertion does.** "Prove the instrument can fail" has to include
proving the *input* reached the condition, not only that the check would fire if it had.

---

## Instance 12 — a colour with two vocabularies, one of which resolved to nothing

`.warning-banner` referenced `--amber` / `--amber-bg`, which were never declared, so both
declarations were invalid and the banner rendered as plain text. The obvious reading was "the
palette is missing a warning token." It was not: `--orange` / `--orange-bg` were **already
declared in both light and dark blocks and already working** in `.note-warn`.

So this was rule 1 — one business behaviour, exactly one implementation — in CSS. Fifth
occurrence, and it hid because **a duplicate colour token does not look like a duplicate
function.** Nothing about it matches the shape the codebase has learned to watch for.

The tell, worth keeping: **the same visual meaning had two vocabularies, and one of them resolved
to nothing.** Where a design intent has more than one token name, one of them is wrong even when
both resolve — and if one resolves to nothing, the duplication is what made the silence possible.
Reaching for a new token is a signal to search the palette for the meaning first, not the name.

---

## Instance 13 — the sixth occurrence, caught in the half-hour before it existed

Step 5 needed the seller's fee tier. The ranking surface already read those three selects
inline at its own call site, so the cheap move was to write the same three lines on the review
screen. That would have been rule 1's sixth occurrence, and it would have been indistinguishable
from the previous five: two surfaces each independently deciding what tier a seller is in, and
no mechanism that would notice when they drifted apart.

Extracted `_crSellerProfile()` instead and moved both callers onto it.

Recording it because the other twelve instances are all archaeology — a defect found after it
shipped, reasoned about backwards. This one is the same pattern used **forwards**, and the tell
was cheaper than any of the diagnoses: *the value I am about to read is already read somewhere
else.* That question costs one grep and it is the whole of the pattern.

The assertion that holds it is worth noting too, because the obvious one would have been
useless. Checking that the screen calls `_crSellerProfile()` asserts the source text, which is
the thing you can see anyway. The assertion instead **moves the profile** — flips Top Rated on,
re-paints, and requires the seller to keep strictly more of the same price while the gross
stays put. That fails if the screen hardcodes the defaults, which is exactly the regression a
future edit would introduce, and it does not care how the value gets there. **Assert the
coupling by moving the upstream value, not by naming the function that reads it.**
