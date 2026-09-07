# Pattern — An assertion that names a behaviour and evidences a surface

**20 instances.** The highest-numbered entry is instance 20; that number, not
this sentence, is the thing to check.

> 2026-09-07: this header read **"Six instances"** while the file carried 19 — a
> stamped count, stale by thirteen, in the document about claims that outlive
> their evidence.
>
> Two failed attempts to make it derived, both worth keeping. The first counting
> regex matched `## N.` only and returned **4**, missing the fourteen
> `## Instance N —` headings. Corrected, it returned **13** — because instances
> 1–6 are list items under "The catalogue", not headings, and instance 17 shares
> a heading with instance 2 under "The impossible-world subclass". **This file is
> not machine-countable in its current structure**, so "the headings are the
> source of truth and this line is a cache" was a promise the format cannot
> keep, written one line after instance 19 was recorded.
>
> Recording the honest position instead: the count here is hand-maintained and
> therefore suspect, and the check is to read the last entry's number. Making it
> genuinely derivable would mean restructuring instances 1–6 and 17 into their
> own headings — a real change, not a header edit, and not done. A derivation is
> only as good as its parser, and a parser is only as good as the structure it
> parses.

First treated as a class in `audit/DECISION_SOURCE_DISAGREEMENT.md:19-22` at
three. This file is the catalogue; other docs should cite it rather than
re-deriving the pattern or guessing the count.

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
| 17 | `setListing` helper | a seller editing a listing field | **assignment to `.value`**, dispatching no event, so `oninput="calc()"` never ran | `tests/trs-listing-scope.mjs`, commit `f747e9e` |

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

### Instance 20 — a direction asserted from the mechanism, never computed (2026-09-07)

Q3-A found the grading panel running a second fee model on `FEES_PCT = 13` and a
flat `GRADING_FEE = 25`. I then wrote that **both simplifications push the same
way** and inflate upside, reasoning from the mechanism: understating a cost
raises a profit. The reasoning is sound and the conclusion is **false for three
of the four seller profiles.**

`feeEbay` reads the profile — 12.35% with a store, 13.25% without, ×0.9 for Top
Rated, plus an additive per-order fee. Flat 13 understates at every price under
the default no-store/not-TRS profile, and **crosses over** at $61.54, $37.21 and
$21.22 for the other three. On the grading side `getGradingCost` is
grader-specific, so flat $25 understates PSA above $200 and BGS always, and
**overstates CGC and SGC by $7 at every price.**

Computed, the finding is worse than the one I asserted: **the error changes sign
across the grader columns rendered side by side in the same panel.** A single
stated basis is simultaneously too low for the PSA column and too high for the
CGC column next to it. "Consistently optimistic" is a *predictable* defect a
reader can discount; sign-flipping inside one widget is not.

The pattern, and it is the catalogue's own theme pointed at a bias claim rather
than a test: **a directional claim is a claim about the whole input space, and a
mechanism argument only establishes direction at a point.** Two costs being
understated somewhere does not make a lean. The check is cheap — tabulate the
signed error across the real parameters (here profile × grader × price, twenty
cells, one script) — and it inverted the conclusion.

Corollary for `audit/DIRECTIONAL_BIAS_AUDIT.md`: **"7 of 7 lean optimistic" was
established the same way**, by reading mechanisms, and BIAS-1 is now known to be
mis-signed for two of four columns. The other six findings have not been
tabulated and that headline should not be repeated as though they had been.


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


### Re-ask "complete by what definition" on anything stamped complete (2026-09-07)

Instance 18's lesson — a narrow sweep reported as clean is its own instance of
the pattern — was **written down, and then the same error was committed in the
same session that recorded it.** The `eq(` sweep was called a complete
enumeration; it was complete over one spelling of the construct, and the other
spelling held two orders of magnitude more sites, including a subclass where the
signature **inverts** and recommends weakening the assertions rule 1 most needs
exact.

The generalisable part is not "sweep better." It is that **writing down a rule
does not install it.** What caught this was neither a better sweep nor the rule
being on record — it was a second look at a claim already marked done, prompted
from outside. So the habit worth having is narrow and cheap:

> When something is stamped **complete**, **clean**, **registered**, **verified**
> or **swept**, ask *complete by what definition* — and specifically, what
> spelling, what corpus, what range of inputs. Then check that the definition is
> the one the claim needs, not the one the check happened to implement.

Every instance in this catalogue answers that question badly in some way:
instance 8 was complete over a hand-listed set, 18 over one guard shape, 19 over
one call spelling, and the registry work found eleven suites "registered" by
memory. The claim was never false about what it measured. It was false about
what it was taken to mean.

Corollary, from the three ad-hoc greps: **the checker is part of the claim.**
"Complete" asserted by a fresh hand-written query inherits that query's scope and
precision, not the artifact's. Re-run the artifact or reuse its helpers.

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

## Instance 14 — a surface that reimplements a disclosure discloses less

**2026-09-07, the review screen's fee block (D3 step 5).**

Step 5 shipped a fee breakdown that invented its own vocabulary: **"What you
keep"** for the net, a prose sentence for the shipping exclusion, and no tax
disclosure at all. `_platTileHtml` had, since 2026-09-01, been rendering a
**"Fee base (item)"** qualifier row, a **"Buyer sales tax (not modeled)"** row
and a dated **Verified/Stale pill** — three mechanisms for exactly those three
jobs, against the same fee model.

This is rule 1's sixth occurrence, and the step-5 write-up claimed to have
caught the sixth prospectively (the `_crSellerProfile()` extraction). It caught
*a* sixth. It introduced another in the same commit.

What makes this instance worth its own entry is the direction of the damage.
The previous five duplicate implementations could **drift** — two copies of a
rule that might disagree later. This one was wrong **on arrival**, because the
duplicate was not a copy. It was a *reduction*:

| the ranking surface disclosed | the review screen disclosed |
| --- | --- |
| fee base, with an `(item)` / `(item + shipping)` qualifier | a prose sentence |
| buyer sales tax, `(not modeled)`, $0.00 | nothing |
| the schedule's stamped date, Verified/Stale | nothing |

A seller who reached the estimate through the ranking list could see the fee
schedule had expired. A seller who reached the same number through Sell could
not. Same model, same staleness rules, one surface honouring them.

The tax omission is the sharpest of the three, because it is not merely a
scoping choice. eBay charges the final value fee on a total that **includes
sales tax** ([published schedule](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822)),
so an estimate that silently drops tax is *understating the fee*, not narrowing
its scope. The engine cannot model it — the rate belongs to a buyer address
that does not exist while the card is a draft — which is precisely why the row
has to say so. **A zero is a claim; a zero next to "(not modeled)" is a
disclosure.** The qualifier is the load-bearing part, so the assertion is on the
qualifier, not on the row.

### The generalisation

> **Before building a disclosure, grep for the disclosure.** A second
> implementation of a *rule* drifts; a second implementation of a *disclosure*
> starts out weaker, because the reimplementation only carries the caveats its
> author happened to think of, and no test can miss a caveat that was never
> written down.

### Corollary — a word ban is not a behaviour assertion

Two step-5 assertions were removed as part of this, for the same underlying
reason they were written: *"the word Source does not appear"* and *"the word
Provenance does not appear"*. Both would have failed the moment the block
legitimately named its fee source — which is the direction the screen was
already going. A third, `querySelectorAll('th, thead').length === 0`, banned
`th scope="row"`: a **row** header, the accessible way to label a row, and not
a column at all. The instruction was *no column header*; the assertion enforced
*no table semantics*.

> **An assertion that bans a spelling cannot tell a disclosure from a column.**

---

## 15 — a negative source assertion cannot tell code from a comment about that code

**Found:** 2026-09-07, D3 step 5 rev2.

An assertion banned a spelling by searching the bundle source for it. The
spelling was absent from the code and present in a comment *explaining why the
code avoids it*. The assertion failed on a correct file.

**The shape:** a source-text assertion reads the file as one flat string, so it
cannot distinguish an implementation from prose about that implementation.
Comments that document a constraint will trip the assertion that enforces it —
the better the comment, the more likely it trips.

**Fix:** strip comment-only lines before asserting on source text.

---

## 16 — an assertion can pin a bug in place

**Found:** 2026-09-07, D3 step 5 rev3, Blocker 3.

`draft-review-screen.mjs` asserted **'a Top Rated seller keeps strictly more of
the same price'**. It was green. It was green *because* the review screen was
inheriting a global seller status into a per-listing fee discount — which was
the bug. The assertion did not merely fail to catch it; the assertion
**required** it, and would have gone red the moment the bug was fixed.

**The shape:** an assertion written from the implementation's behaviour rather
than from the *behaviour the business owes* becomes a lock. Fixing the code
breaks the test, the test looks authoritative because it is old and green, and
the pressure is to revert the fix.

**The tell:** ask what source the assertion's expectation came from. Here the
expectation came from the code. Nothing external ever said a Top Rated *seller*
should get a per-listing discount — eBay's own page says the opposite.

**Fix:** the assertion's real intent — the screen reads the profile rather than
hardcoding defaults — is now proved with the **store tier**, which genuinely is
a property of the seller. The old text is recorded inside the test file, marked
`CHANGED 2026-09-07`, because a flip and a silencing look identical in a diff.

**Related:** a mutation that cannot be observed is *not* this. The tier
comparison `<= 7500` → `< 7500` changes nothing, because both branches compute
the same value at exactly 7500. That is a real equivalence, not a pinned bug,
and it is recorded in the test file so nobody invents an assertion to chase it.

## The impossible-world subclass — instances 2 and 17

Instance 17 is the same failure as instance 2, and naming the pair is worth more
than either tally mark, because the second instance is what proves it is a shape
rather than an accident.

**Instance 2** ran a paging assertion against an index that had been emptied.
**Instance 17** ran five state-invalidation assertions against a DOM mutated by
direct assignment. Both were green. Both proved nothing. In both cases the
fixture had constructed a world the program does not run in, and every assertion
inside that world was true and irrelevant.

The difference between them is the axis of the impossibility, and that is why
one instance did not inoculate us against the other:

| | Instance 2 | Instance 17 |
|---|---|---|
| What was impossible | the **data** — an index no user has | the **interaction mechanism** — an edit no user can make |
| Looked correct because | the fixture was real code, freshly generated | the values were real, and the final state was right |
| Why it passed | nothing contradicted it | the *endpoint* matched; only the *path* was fictional |

Instance 2 taught us to check what state a fixture creates. That check passes
cleanly on instance 17: the state was right, the values were right, the
selectors were right. What was wrong was the *verb*. A DOM is not a data
structure with an incidental event system bolted on; the event system is the
program. Setting `input.value = '450'` in JavaScript does not fire `input`, so
every handler the application hangs off that event is absent from the test, and
what remains is a test of the assignment operator.

**The line for the catalogue:** *a fixture that drives the DOM by assignment is
testing a program nobody runs.*

**The tell**, and it generalises past the DOM: ask whether the fixture reaches
the state through the same **mechanism** the user does, not merely whether it
reaches the same state. Endpoint equality is not path equality. Any assertion
about *invalidation*, *ordering*, or *reaction* is an assertion about the path,
and a fixture that skips the path cannot evidence it — which is precisely why
all five state-3 cases were green while two genuinely reachable defects sat
behind them.

**The remedy in force:** `setListing` dispatches real `input` and `change`
events. That single change turned one assertion red immediately, and the red was
informative rather than a regression — the production handler had already
cleared the control, so the test's manual cleanup call correctly found nothing
to do. An assertion written against a fictional path had been describing the
test's own housekeeping as if it were the application's behaviour.

**Cost of the class, so far:** instance 2 hid a paging defect; instance 17 hid
two reachable ones (an eligibility read below `calc()`'s `price <= 0` early
return, and a search listener that debounced without ever recalculating). Two
instances, three defects, zero red assertions.

---

## Directional bias — a class a correctness audit cannot see (2026-09-07)

A correctness audit clears estimates one at a time. It cannot see a **lean**,
because every individual simplification passes as "a rough estimate".

The check that finds it is cheap and different: for each number the seller sees,
ask **which direction the error runs when it is wrong**, and line the answers up
in a column. `renderGradingUpside` returned seven independent simplifications,
all overstating the seller's outcome, none running the other way. Seven
independent choices landing on the same side is not coincidence.

Full audit: `audit/DIRECTIONAL_BIAS_AUDIT.md`.

**AMENDED 2026-09-07 — the mechanism is structural, not statistical.** The
original entry treated seven-for-seven as improbable coincidence. It is not
coincidence and it is not about care. Four of the seven are *omissions* — a
missing fee, missing shipping, missing tax, missing postage — and **in a
net-of-costs calculation an omission has only one available direction**.
Forgetting a cost always makes the number bigger.

So the general law is: **any net-estimate surface built by simplification leans
optimistic by construction.** The defense therefore cannot be care, review
attention, or conservative temperament — none of those change a failure mode's
direction, only its frequency. The defense has to be structural: one owner, and
every surface routed through it, so there is no second model to omit from.

Three further things this class teaches:

1. **A lean is worse than an error.** An error is a bug and gets fixed. A lean
   reads as marketing rather than arithmetic and attacks credibility directly.
2. **The lean lives in persuasive surfaces, not in the core.** `feeEbay` is
   honest; the grading-upside *pitch panel* drifted 57% at $20. Audit effort
   follows correctness risk, so it pools where the math is hard — and the math
   is easy exactly where the incentive to flatter is strongest.
3. **A correctness audit of an item can find the direction and still miss the
   class.** T2.7 recorded "one-directional bias, not just an inconsistency" a
   day before this pass, for one item. Seeing that an item leans is not the same
   as seeing that leaning is generated by the construction method — and the
   remedies differ: one fixes a constant, the other re-owns a surface.
4. **Rule 1 needs an external binding.** Consolidating to one owner gives that
   owner the same property a parity assertion has: no second opinion. So the
   single owner's assertions must bind to the external source. `feeEbay` is
   trustworthy because it names eBay's clauses. `renderGradingUpside` names
   nothing, cites nothing, and is the one that drifted.

Also recorded, from the same pass: **a comment asserting a cost is included over
code that excludes it is worse than no comment** — `FEES_PCT = 13; // eBay +
shipping typical` never subtracts shipping. The comment answers the reviewer's
question wrongly and stops the check.

And on verification hygiene: **a mutation that mutates nothing is a false clean
bill of health.** Mutation M-M in `tests/contrast-tokens.mjs` first ran against a
blank line and returned 12/0, which is indistinguishable from a test that cannot
fail. Verify the mutation applied before recording its result.

---

## 18. A guard whose threshold no reachable input can cross (2026-09-07)

`_clampHigh` (`js/core.7f9c03ad.js:1758`) clamps a high price to `market × 3`.
The synthesized fallback band is `market × 1.15`. **1.15 is never greater than
3**, so on the fallback rung the clamp is structurally unreachable — it cannot
fire on the rung where the data is least trustworthy. The server's
`_clampHighPriceInPlace` (`api/tcg-price.js:531`, applied at `:131 :268 :305
:511`) uses the same `× 3` and is unreachable there for the same reason.
`:305` is the call that runs immediately after the band is synthesized.

This is the catalogue pattern in a new costume. The other 17 entries are about
*assertions* naming a behaviour and evidencing a surface. This one is about a
**guard** naming a protection and evidencing a condition that cannot occur where
the protection is most needed. Same defect, different artifact: the name
promises coverage the code cannot deliver, and reading the guard tells you
nothing — its logic is correct, its threshold is sound, and its comment is
accurate. Every local check passes.

**It was not found by reading the clamp. It was found by proving a removal was
safe.** Discharging T2.5's "unless we have a downstream consumer" condition
forced the question "what happens to `_clampHigh` if `high` disappears?", and
the answer was "nothing, because it never fired here." A guard's reachability is
invisible from the guard; it is only visible from the range of its input.

**Generalisation worth a sweep:** which other guards have thresholds no
reachable input can cross? A first pass over multiplier-thresholds found only
two comparison sites (`core:1761` at `× 3`, `core:3969` at `× 1.02`), the second
of which is reachable. That is a narrow sweep — it only catches
`x > y * k` shapes, not absolute thresholds, enum guards, or length floors. **A
guard is only as good as the widest input that reaches it, and nothing in the
codebase records what that range is.**

Corollary for the contrast work in the same session: this is why
`tests/contrast-tokens.mjs` asserts its node-count floor *before* its ratios. A
sweep matching zero nodes and a guard whose threshold is unreachable are the
same failure — a check that passes because nothing arrived, not because
everything was fine.

## 19. An assertion that pins an occurrence count (2026-09-07)

`tests/minors-011-012-013-2026-09-04.mjs:96` asserted
`eq(textGoldToken, 125, '011: expected 125 gold text usages repointed to
--gold-text')`. It found **130**. Nothing had regressed — five *more* text
usages had been repointed to the accessible token, which is precisely the
direction SOL-PLAT-011 existed to push. The assertion reported an improvement
as a defect.

**This is not the catalogue's usual shape, and that is why it gets its own
entry.** Entries 1–18 are assertions whose evidence is *too weak* for the
proposition they name: the claim over-reaches the surface it inspects. A count
assertion does not over-claim its evidence. It claims **the wrong proposition
entirely**. "There are exactly 125 of these" is not a weaker version of "gold
text meets AA on light surfaces" — it is a different statement, one that happens
to have been true on the day it was written.

**The distinguishing property: it is equally loud in both directions.** A
removal of five usages and an addition of five usages produce the identical
failure, with the identical message. An assertion that cannot distinguish
improvement from regression trains you to dismiss it — and dismissal is the
actual damage, because it is indistinguishable from the response you should have
to a false alarm. The signal and the noise are the same event.

Note what was already correct in the same test. The line immediately above it —
`eq(textGold, 0, '011: no color:var(--gold) text usage may remain — it fails AA
on light')` — is a real behavioural assertion, and it passes. The count line
added only the claim that the repointing was *broad* rather than token. A floor
(`>= 125`) says that and stays true under further repointing. Fixed as a floor,
with the prior assertion and the reason for the change recorded in the test
body.

**Where it was found matters as much as what it was.** This suite was never
wired into `tests/run-all.sh`, so it had been red without anyone observing it.
The count assertion and the unregistered suite are the same failure viewed from
two sides: a check nobody runs, and a check that cannot tell you anything when
it does run. See `tests/test-registry.mjs`.

**The precedent, now located.** The "flake that impersonated the regression" is
real and recorded — in a **test body**, not in `audit/`, which is why the corpus
grep missed it. It is `tests/trs-listing-scope.mjs:353-365`, from `f747e9e`: the
reload case read `ebayTopRated` before the saved profile had rehydrated into the
controls, so it failed intermittently *on the assertion that says the durable
status survived* — i.e. it failed in the exact shape of the bug the scope fix
could plausibly have caused. The note there states the cost directly: "A flake
that fails in a RANDOM shape gets investigated. A flake that fails in the exact
shape of the bug the change under test could plausibly have caused gets
pattern-matched to 'known flaky, re-run it' — and then the day the scope fix
genuinely does eat the seller's durable status, the assertion that catches it is
the one everybody has been trained to dismiss." Fixed by waiting on observable
state rather than a timeout. That it lives in the test rather than here is the
standing practice working as intended; the pointer is what was missing.

**The family boundary, tightened.** These are *not* the same defect, and saying
"same family" loosely would let the family absorb anything annoying. The flake
was **nondeterministic** and failed in the shape of a real bug. The count
assertion is **deterministic** and states the wrong proposition. What they
actually share is narrower and worth naming as exactly this:

> **The failure signal does not distinguish the case you care about from a case
> you do not, and the damage in both is trained dismissal.**

That is the membership test. Not "the assertion was annoying," not "it failed
when nothing was broken" — specifically that the *signal itself* is unable to
separate the two, so the correct response to the noise and the correct response
to the signal are the same action. Everything else about the two instances
differs: cause, determinism, and fix.

**The sweep, run rather than deferred (2026-09-07).** Instance 18's sweep stayed
narrow because guard *shapes* vary and `x > y * k` is one form among many — an
open-ended search reported as clean would have been its own instance. This one
is different in kind: `eq(` with `.length` or `matchAll().length` and a literal
integer is an **exact textual signature** in files we own, so the sweep is a
complete enumeration of the construct rather than an approximation of a shape.
Deferring a closed sweep is overcaution, not caution.

Result: **15 `eq(` sites involving a length; 8 with a literal integer.** All 8
in `tests/minors-011-012-013-2026-09-04.mjs`. Triaged, and the triage is the
useful output:

| Site | Assertion | Verdict |
|---|---|---|
| `:115-118` | gold `background` / `border-color` / `border-top-color` / `accent-color` counts = 63 / 35 / 8 / 3 | **instance 19 — converted to floors** |
| `:129` | `accent-color:#8b5cf6` = 1 | **instance 19 — split into a floor plus an absence assertion** |
| `:138-139` | `twitter:card` = 1, `og:image` = 1 | **not instance 19 — kept exact** |
| `:175` | `<form>` count = 0 | **not instance 19 — kept exact** |

The counter-examples fix the boundary. For a duplicate `og:image`, **1 is the
proposition, not a proxy for one** — duplicate meta tags are the defect
SOL-PLAT-012 was filed for, because scrapers pick unpredictably between them,
and a floor would pass the exact bug being guarded. Likewise `<form>` count `0`:
absence *is* the behaviour. So the test for instance 19 is **not** "is the
expected value a literal integer." It is **"is that integer the proposition, or
a stand-in for one."**

Note the four at `:115-118` were **not stale** — 63/35/8/3 all still held. They
were converted anyway, because a passing count assertion is the same defect as a
failing one that simply has not been asked yet. What they guard is one
direction: 011 repointed gold *text*, and the risk was that the sweep also
converted a fill or border, which shows up as the count **dropping**. Someone
adding a new gold border later is not a defect, and the exact form fails on it
identically. Floors say the real thing. Negative controls: repointing one fill
takes 63 → 62 and fails the floor; adding one takes it to 64 and passes;
injecting a text use of `#8b5cf6` trips the new absence assertion; injecting an
*accent* use does not. 106/106.

A stronger inverse — "`--gold-text` is never used for a non-text property" — was
tried first and **rejected on evidence**: `border-color:var(--gold-text)` and
`border-top-color:var(--gold-text)` each appear once and both are deliberate.
Recorded rather than asserted.

**A third methodological failure worth its own line.** Three times now an
ad-hoc `grep` of mine has been less careful than the assertion it was checking.
(1) A `color:var(--gold)` grep without the negative lookbehind counted 40
AA-failing text usages that do not exist — they are `border-color`,
`accent-color`, `background-color`. (2) A grep of `index.html` alone contradicted
the `:115-118` counts and looked like proof they were stale; they were not —
`read('index.html')` in that suite is `readAppSource()`, the **combined app
source** (1,587,651 bytes vs 334,586), because SOL-PLAT-007 split inline JS and
CSS into hashed files. (3) A regex meant to *derive* this file's instance count
returned 4, then 13, against an actual 19. Each time the careful artifact was
right and the quick check of it was wrong. **Ad-hoc verification of a careful
test reproduces neither its scope nor its precision, and its confident wrong
answer is indistinguishable from a finding.** The rule: re-run the artifact, or
reuse its own helpers — do not re-implement its query by hand.

### The sweep widened, and the "complete enumeration" claim was wrong

The `eq(` sweep was complete **for `eq(`**, and I called that a complete
enumeration of the construct. It was not. The same defect written
`ok(… .length === N)` does not match that signature, and sweeping for it found
**196 `=== <literal>` comparisons on a `.length`** — two orders of magnitude more
than the 8. Calling a sweep complete when it enumerated one spelling of the
construct is the same error as instance 18's narrow sweep, committed in the same
session that recorded the lesson.

Classified, because the raw 196 is not a defect count:

| Class | Count | Verdict |
|---|---|---|
| `=== 0` — absence | 68 | **Not instance 19.** Absence *is* the proposition. |
| `=== 1` on a value the test did not read from source | 58 | Not instance 19. |
| `=== N>1` on a value **the test itself produced** (two taps → `sent.length === 2`) | 39 | **Not instance 19.** Cannot go stale from unrelated edits; the number is the behaviour the test drove. |
| **source-text occurrence count against a literal** | **29** | the actual risk surface |

The 29 split again, and this split is the one that matters:

- **~6 are rule-1 assertions and must stay exact.**
  `(code.match(/function _buildSportsCard\(/g)).length === 1`, and the same
  shape for `_pcVariantKeyForGrade`, `_renderPriceCaption`, `_esc`,
  `_trimmedMean`, `_renderGradeOpportunity_withdrawn`. Here **1 is the
  architectural rule** — one business behaviour, exactly one implementation, the
  rule this project has been bitten by eight times. A floor would pass a second
  implementation, which is the precise defect. These are the strongest
  exact-count assertions in the corpus, not the weakest.
- **~13 are counts of incidental call sites and are instance-19 shaped.**
  `_qpReapplyChosenTier();calc()` === 5, `setVenueEnabled(` === 2,
  `await _fetchPriceForEntry(p)` === 2, `mode: 'grade'` === 2,
  `writing-mode:vertical-lr;direction:rtl` === 2, `class="pack"` === 6,
  `_applyPendingUpgradeInterval` === 2, `tcgNumberMismatch(number,` === 2. A
  legitimate sixth call site fails these identically to a deleted one.
- **The remainder are structural counts** tied to a real fact —
  `sub: 'Any grader'` === 3 and `any grader (PriceCharting)` === 3 track the
  three columns BIAS-3/7/8 are about; `feeAuditedOn` === 15 tracks the venue
  count, which now has a *derived* guard in `tests/accuracy-fee-parity.mjs`
  (15/0) that does not depend on the literal. Judgement per site, not a sweep.

**Status: enumerated, classified, NOT converted.** Only the 8 `eq(` sites were
changed. Converting 13 assertions inside `launch-audit-regressions.mjs` and
`copy-truth-offline.mjs` in the same pass that widened the sweep would be a
large edit to two load-bearing suites justified by a signature match rather than
a reading of each case — and the rule-1 subclass above is proof that the
signature alone gets the verdict wrong. Recorded as the standing follow-up with
its list, which is the honest state: **the boundary is now known, the work is
not done.**

The durable rule from all of it: **the test for instance 19 is never the
syntax.** It is whether the integer is the proposition or a stand-in for one.
`=== 1` for "one implementation" and `=== 0` for "none exist" are propositions.
`=== 5` for "five call sites happen to exist today" is a stand-in.
