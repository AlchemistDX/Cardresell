# Undeclared CSS custom properties — known debt

**Found 2026-09-06** by the derived token check in `tests/draft-review-screen.mjs`
("every token the stylesheet references is declared"). Not fixed in D3 step 4, because
each fix is a visual decision on a surface step 4 does not own.

## Why this matters

An undefined CSS custom property does not fall back to a sensible default. It makes the
**entire declaration** invalid at computed-value time, so the rule silently does not apply.
Nothing warns, nothing logs, and the element renders as though the line had never been
written. That makes it the CSS equivalent of a dropped error: a stylesheet can be wrong and
look deliberate.

## How this was found

D3 step 3 shipped `.draft-row-open:focus-visible{outline:2px solid var(--accent)}`, and
`--accent` is not a declared token. The focus ring therefore did not render **at all** — on
the one control whose entire justification was that a keyboard user must be able to reach it.
Every behaviour assertion passed, because activation works with or without a visible ring.

The first version of the check hand-listed the token names to verify. That would have caught
`--accent` only because the author already knew to look for it — a hand-maintained list of
what is worth checking is the same failure as a hand-maintained offset table, just quieter.
Deriving the list from the stylesheet found four more offenders in the same run.

## The debt

| Token | Refs | Selector / location | Consequence |
|---|---|---|---|
| `--amber` | 2 | `.clamp-note` (`index.html:844`), `.warning-banner` (`:846`) | `border` / `border-left` never renders — **a warning banner with no warning styling** |
| `--amber-bg` | 2 | `.clamp-note` (`:844`), `.warning-banner` (`:846`) | `background` never applies (one of the two has a `--surface-2` fallback and is fine) |
| `--muted` | 3 | inline styles on `#rSellBlocked` (`:2078`), `#cardSellTip` (`:2094`), a TCGplayer note (`:3436`) | text keeps the inherited colour instead of the muted one |
| `--text-primary` | 1 | `.density-btn:hover:not(.active)` (`:767`) | hover text colour never changes |

`--accent` is **fixed**, not debt: step 4 changed the focus ring to `var(--gold)`.

## Owner and remedy

Unowned. Each needs a decision, not a rename:

- `--amber` / `--amber-bg` — the codebase has `--red` and `--gold` but **no warning token**.
  Declaring an amber pair is a palette addition; reusing `--gold` changes what a warning
  looks like. `.warning-banner` is user-facing, so this is a design call.
- `--muted` — almost certainly meant `--text-muted`, which is declared and used 189 times.
  Lowest-risk of the four, but it is three inline styles, and one sits next to the
  `--text-faint` contrast item already open.
- `--text-primary` — likely meant `--text`. Cosmetic, hover-only.

The suite **ratchets** rather than exempts: it asserts no token *outside* this set is
undeclared, so a new one fails on arrival. Fixing an entry here does not break the suite.
