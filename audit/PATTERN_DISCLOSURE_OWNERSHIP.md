# Pattern — A disclosure keyed to our behaviour holds; one keyed to theirs is a claim we cannot maintain

Extracted 2026-09-08 from the D5 eBay continuation control
(`audit/d5/D5_ENTRY_GATE.md` §8.3), where it decided what was safe to print
beside a hand-off whose far side we cannot observe. It is not about eBay.

## The test

For any sentence this app shows a user, ask **whose behaviour makes it true.**

- **Ours** — the sentence describes something this codebase does, a value it
  holds, or a time it acted. If it stops being true, something on our side
  changed, so something on our side can be made to go red.
- **Theirs** — the sentence describes what a venue, source, or matcher will do.
  If it stops being true, **nothing on our side changes.** No test fails, no
  banner appears, no field goes stale. The sentence rots silently and keeps
  rendering.

The second kind is not forbidden. It is **unmaintainable**, which is a different
and worse property than being wrong: a wrong claim can be found, an
unmaintainable one cannot be watched.

## Why it is the same shape as the "no field, no check" finding

That finding: a fact carried in prose with no field behind it has nowhere to be
checked, so its correctness is unauditable regardless of whether it is currently
right. This one is that, one layer out: a claim about someone else's behaviour
has nowhere to be *maintained*, because the signal that would invalidate it
never reaches us.

Both are questions about **whether a thing can be audited at all**, asked before
the question of whether it is presently correct. Answering the second first is
how a corpus accumulates sentences that were true once.

## Applied

| Disclosure | Keyed to | Verdict |
|---|---|---|
| "Retrieved by CardResell — Sep 8, 2026, 12:00 PM" | ours — when *we* read the source, explicitly not when the source published | **passes**; the caption says so in as many words |
| Price-basis label (`seller` / venue / source name) | ours — which basis this app used for this number | **passes** |
| "Declared by this app: fee model revision 1, fee schedule 2026-09" | ours — and it names the limit, "not verified against a server-owned fee contract" | **passes** |
| "We send eBay this search: …" | ours — the string we put in the URL | **passes** |
| "Nothing is listed or published until you do it there yourself" | ours — we have no publish path in Phase 1 | **passes** |
| "Their matcher … does not always answer the same way twice" | theirs, but stated as *non-guarantee* | **passes** — a disclaimed unknown is not a maintained claim |
| "Compare the collector number on eBay's match to **NNN/NNN**" | **ours up to the redirect, theirs after it** | **the exception**, and the only one; it assumes the query arrives |

The last row is why `D5_ENTRY_GATE.md` §8.3 step 4 exists — a test attached to
the one line that needs one. That is the remedy when a "theirs" claim is
genuinely worth shipping: **not softer wording, but a named check that can
fail.**

## Rule

Prefer the "ours" phrasing of any disclosure, even when it says less. "We read
this at 12:00 PM" is weaker than "this price is current" and it is the only one
of the two we can stand behind a year from now. When a claim must be keyed to
someone else's behaviour, ship it with the check that would catch it changing,
and record where that check lives.

## Related

- `audit/PATTERN_ASSERTION_SURFACE.md` — an assertion names a behaviour and
  evidences a surface.
- `audit/DECISION_SOURCE_DISAGREEMENT.md` — disagreement is disclosed, never
  averaged; same instinct applied to two sources rather than one boundary.
