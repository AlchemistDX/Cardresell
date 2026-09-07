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
