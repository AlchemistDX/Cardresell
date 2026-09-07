# Decision — The "maintenance" Copy-Rule Collision

**Date:** 2026-09-06 · **Tip:** `06792ec` · Decided after D2.1 shipped
**Status:** DECIDED. The narrowing is not yet implemented — see "Open, deliberately."

---

## The collision

`tests/a11y-mobile-2026-09-04.mjs:409` asserts site-wide:

```js
ok('no maintenance wording', !/maintenance/i.test(HTML))
```

Contract §3.5 — inherited from `CARDRESELL_PLAN_AND_ROADMAP.md` §5.8 — mandates
that exact wording for unfinished states, and forbids "beta" as the alternative.

Both cannot stand as written.

## Amendment (2026-09-06, same day)

The decision below adjudicates a collision. On the owner's reading, confirmed by
the adjacent-line evidence in "Two findings" and now catalogued as instance 6 in
`audit/PATTERN_ASSERTION_SURFACE.md`, **there was no collision to adjudicate.**

Two consecutive assertions where one implements §5.8 and the other inverts it are
not a considered rule. Nobody weighed "under maintenance" against §5.8 and
decided against it — the pair was written from a different instinct entirely and
§5.8 was never in the room. So there was never a competing rule to lose, only an
artifact.

The outcome is unchanged and the reasoning below still holds as written. What
changes is its weight: §5.8 does not *win* a contest, it was never in one. The
narrowing is repair of an artifact, not a ruling against a rule. That matters for
anyone who later reads the assertion and assumes someone had a reason for it.

Generalised in `PATTERN_ASSERTION_SURFACE.md`: before adjudicating a conflict
between a check and a spec, establish that the check is a considered position at
all.

---

## Decision: §5.8 is the standing rule. The assertion narrows.

Three reasons, in order of weight.

**1. The plan doc is the authority on product intent; the assertion has no
recorded rationale.** It arrived in `0328c0c` grouped under "protected areas and
standing copy rules" with nothing in the commit body explaining it. §5.8 states a
reason: the product does not use "beta" as a substitute for a precise limitation,
and "under maintenance" is the substitute it does use. A rule with a reason
outranks a rule without one.

**2. The assertion is overbroad in a way that is independently a defect.**
`readAppSource()` inlines the bundle into the tested text, so the ban covers
**code comments**. A comment explaining why the word is banned trips the ban.
Whatever the original intent was, it was not that.

**3. The assertion currently gates nothing.** `tests/a11y-mobile-2026-09-04.mjs`
is unregistered in `tests/run-all.sh`. The collision is latent today and becomes
blocking the moment someone registers that suite — which they should, and which
is exactly when nobody will want to be relitigating a copy rule.

### What narrowing means

Scope the assertion to **rendered user-facing text on marketing surfaces** —
homepage marketing sections and `pricing.html` — and drop the bundle source from
its input entirely.

---

## Verification

Every claim above was checked against the repo at `06792ec` before filing.

| Claim | Result |
|---|---|
| `tests/a11y-mobile-2026-09-04.mjs:409` reads `ok('no maintenance wording', !/maintenance/i.test(HTML))` | **Confirmed**, verbatim |
| The suite is unregistered in `tests/run-all.sh` | **Confirmed** — `grep -c "a11y-mobile"` = 0 |
| Plan doc §5.8 exists and mandates the wording | **Confirmed** at `audit/CARDRESELL_PLAN_AND_ROADMAP.md:491` |
| `pricing.html` exists as a narrowing target | **Confirmed** (8 top-level HTML surfaces) |
| Live surfaces currently contain the word | **Zero occurrences** in `index.html`, `pricing.html`, `js/core.8bd8277a.js` |

---

## Two findings the decision did not have

### 1. The rationale is partly recoverable, and it is not the marketing story

The write-up reconstructs the intent as "under maintenance reads as unreliable to
a prospective customer," flags it as a guess, and says the rationale is
unrecoverable. The guess is honest, but the adjacent line is better evidence:

```js
409  ok('no maintenance wording', !/maintenance/i.test(HTML));
410  ok('no beta wording',        !/\bbeta\b/i.test(HTML));
```

They are consecutive, in the same block. §5.8 **forbids "beta" and mandates
"under maintenance."** So of the two adjacent assertions, one implements §5.8 and
the other inverts it.

That is the shape of a pair written from a general "no provisional-sounding
language" instinct rather than from §5.8 — banning both halves of a rule that
bans one half and mandates the other. It explains the collision without needing a
marketing-storefront theory, and it explains why no rationale was recorded: from
inside that instinct there was nothing to justify.

This is still inference. But it is inference from adjacent code rather than
reconstructed product reasoning, which is the weaker claim and the better
grounded one. **The narrowing should cite this, and should not assert the
marketing explanation as fact.** Inventing a reason for a rule is the same class
of error as inventing a number.

### 2. The pair is also *under*-broad, and that is the more dangerous half

`readAppSource()` reads HTML plus the inlined bundle. It never reads `api/`. So
`api/verify-send.js:155` ships this to users today:

> "Email delivery is restricted during beta. Use the Firebase verification link
> instead — check your inbox after tapping Continue."

That is a user-facing "beta" string — the exact thing §5.8 forbids — and the
`no beta wording` assertion at :410 cannot see it. It is already tracked as
**T2.8** and remains open.

So the pair is simultaneously overbroad (it polices code comments) and underbroad
(it misses server-authored user-facing copy). Narrowing :409 without extending
:410 to server response strings fixes the half that has never caused a user
problem and leaves the half that is causing one now.

**The narrowing should land with that extension**, not before it.

This blindness is why instance 6 is catalogued as the first in the class to fail
in *both* directions. The first five were uniformly too weak. This one polices a
code comment no user will read and cannot see the one string a user actually
gets. See `audit/PATTERN_ASSERTION_SURFACE.md`.

---

## The reworded degraded banner was correct regardless — with one exception

The banner now reads:

> 🛠️ Some draft details couldn't be refreshed just now. Your drafts are saved.

The wording reasoning holds and did not depend on this decision: `degraded` is a
transient data condition, not an unfinished feature. §5.8 governs unfinished
features, so the mandated phrasing would have been wrong for this surface even
with no assertion in the way. The collision never blocked D2.1 and does not block
D3.

**The emoji is a separate problem, and it is mine.** §5.8's third clause reads:

> "The tool/wrench icon is the approved visual language for the in-progress
> listing workflow, but contributors should not add decorative emoji elsewhere."

🛠️ is approved *for the in-progress listing workflow*. A degraded-refresh banner
is not that workflow — it is the data condition I just argued is categorically
different. The same distinction that makes the wording correct makes the emoji
unlicensed: I used the icon precisely where I had established §5.8 does not
reach.

Recommend dropping it, leaving:

> Some draft details couldn't be refreshed just now. Your drafts are saved.

The `🛠️ Drafts` tab label keeps its icon — that one *is* the listing workflow,
which is the approved case.

Not changed in this commit; it is a copy edit to a shipped banner and belongs with
the narrowing work rather than folded into a decision record.

---

## Open, deliberately

The narrowing is not scheduled. It touches a passing suite and should land
together with (a) registering that suite in `tests/run-all.sh` and (b) extending
the "beta" check to server response copy, closing T2.8. Those three changes argue
for each other; individually each looks like an unmotivated edit to a green test.

Add to that the banner emoji removal above, which is small but should not be lost.
