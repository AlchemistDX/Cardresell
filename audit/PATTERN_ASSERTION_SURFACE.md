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
