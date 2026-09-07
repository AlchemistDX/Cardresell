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

## Which live surfaces are actually affected

Raised on review: if D2.1's degraded banner was built off the existing banner styling, the
degraded state would ship with no warning treatment — a live defect in current work rather than
legacy. **Checked, and the hypothesis is disconfirmed as stated:** there is no degraded or
maintenance banner using either class. The three `🛠️` occurrences in the bundle are the
legitimate "List now" / "List & ship yourself" workflow icon, not a maintenance indicator.

**The check found something worse on a different surface.** `.warning-banner` has exactly one
caller (`js/core.7f9c03ad.js:7289`), and it is the stale-fee-schedule warning:

> "All marketplace fee schedules are past the 45-day verification window. Rankings are shown for
> reference only until the next fee audit."

Both of its identity declarations are dead. `border:1px solid var(--amber)` and
`background:var(--amber-bg)` are invalid, so only `margin`, `padding`, `border-radius`,
`color:var(--text)`, `font-size` and `line-height` survive. It renders as **an ordinary
paragraph of body text** — no border, no fill, no colour distinction from surrounding copy.

So the banner that tells a seller the entire ranking is unreliable is styled to look like the
ranking's own prose. That is the live defect the review was reaching for; it is on the fee-audit
surface rather than the degraded surface.

`.clamp-note` (`:7328`, the High-clamp explanation) degrades more gracefully: its
`border:1px solid var(--divider)` and `background:var(--surface-2, …)` both resolve, so it keeps
its box and loses only the 3px amber left bar that marks it as a caution.

`role` attributes are unaffected — both carry `role="status"` / `role="note"`, so assistive
technology still announces them correctly. The failure is visual only, which is precisely why
nothing caught it: the accessible name and role are right, the behaviour is right, and the
appearance is the one property no assertion covered.
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

---

# Resolved 2026-09-06 — it was never a missing palette entry

The remedy notes above said a warning token does not exist in the palette, so declaring an amber
pair would be a palette addition and reusing `--gold` would change what a warning looks like.
**Both claims were wrong, and the reason they were wrong is the more useful finding.**

The palette already declares a complete warning tier, in **both** the light and dark blocks:

| Token | Light | Dark |
|---|---|---|
| `--orange` | `#b85c00` | `#e0832a` |
| `--orange-bg` | `#fff4e6` | `#1e1004` |

It is already in use and already working — `.note-warn` (`index.html:908`) renders a warning with
exactly this pair. So `.warning-banner` and `.clamp-note` were not missing a token. **They were a
second implementation of a colour the palette already had**, and the only reason the duplication
was visible at all is that the second implementation was never declared.

That is rule 1 — one business behaviour, exactly one implementation — caught for the fifth time,
in CSS rather than in code. Worth noting how it hid: a duplicate colour token is not a duplicate
function, so nothing about it looks like the shape the team has learned to watch for. **The tell
was that the same visual meaning had two vocabularies, and one of them resolved to nothing.**

## The fix

Both rules now reference the declared tier. No palette addition, no new token, no design call:

- `.warning-banner` — `border:1px solid var(--orange)`, `background:var(--orange-bg)`.
- `.clamp-note` — `border-left:3px solid var(--orange)`; background simplified to
  `var(--surface-2)` and colour to `var(--text)`, since both fallback chains already resolved to
  those and the dead half of each was noise.

`var(--amber)` and `var(--amber-bg)` now appear **zero** times in the repo.

Contrast, computed rather than assumed — body text is `var(--text)` on `var(--orange-bg)`:

| Mode | Pair | Ratio |
|---|---|---|
| Light | `#18160f` on `#fff4e6` | **16.66:1** |
| Dark | `#d4d2cc` on `#1e1004` | **12.28:1** |
| Light | border `#b85c00` on `#fff4e6` | 4.23:1 (non-text, needs 3:1) |
| Dark | border `#e0832a` on `#1e1004` | 6.59:1 |

## What the before/after showed

The screenshot is worth recording in words, because the defect was worse than "no border".

Before, the stale-fee disclaimer rendered as bare body text while `.clamp-note` **kept its box**
— so the hierarchy was **inverted**. A note explaining one clamped comp looked like a callout,
and the banner disclaiming every ranking on the page looked like prose. A seller scanning the
surface would read the smaller caveat and skip the larger one.

`role="status"` survived throughout, so a screen-reader user got the warning and a sighted user
did not. That is an unusual direction for that gap to run — the accessible name, role and
behaviour were all correct, and appearance was the single property no assertion covered.

## Why this mattered beyond appearance

§5.5 forbids inventing freshness, and the banner **is** the mechanism that keeps the ranking
honest when the fee data is stale. With its styling dead, the rule was satisfied in the DOM and
not in the seller's experience. A disclosure requirement discharged into invisible markup is not
discharged. That is the argument for making the palette call rather than deferring it — and in
the end there was no call to make, only a duplicate to delete.

## The ratchet shrank

`KNOWN_UNDECLARED` in `tests/draft-review-screen.mjs` went from four entries to two
(`--text-primary`, `--muted`). The ratchet now also asserts **every entry in the baseline is
still actually referenced**, so a fixed token cannot linger in the list — a ratchet that only
grows is a list where fixed debt accumulates, which is the same "number someone maintains for no
benefit" failure this file refuses elsewhere. Verified by mutation: adding a fixed entry to the
baseline fails the suite (81 passed → 80/1).

## 2026-09-07 — `--text-muted` fails AA in dark, passes in light

Measured, not eyeballed. A reviewer said the dark-theme fee labels "look faint";
the instruction was to measure before judging compliance, so:

| pairing | ratio | AA (4.5:1) |
| --- | --- | --- |
| `--text-muted` `#6b6960` on light `--bg` `#f2f1ed` | **4.87** | pass |
| `--text-muted` `#78766f` on dark surface `#21201a` | **3.59** | **fail** |
| `--text-muted` `#78766f` on dark `--bg` `#111009` | **4.19** | **fail** |
| `--text` on dark surface `#21201a` | 10.80 | pass |
| `--orange` on `--orange-bg` (dark) | 6.59 | pass |

The failure is not the fee block's. `--text-muted` has **242 usages** across
`index.html` and the bundle, and it is below AA on *both* dark backgrounds, so
every muted label in the app is affected in dark mode and none are in light.
The fee breakdown only made it visible by putting five muted labels in a row.

Nothing about the text is "large" for WCAG purposes — the fee labels are
`.9rem` and the note is `.8rem`, both well under the 18.66px-bold / 24px
threshold, so 3:1 does not apply and 4.5:1 is the bar.

**Not changed here, deliberately.** Lifting one token value in the dark block
would repaint 242 usages in a step-5 fee commit, and some of them are on the
do-not-touch list. Candidates, measured against both dark backgrounds:

| candidate | on `#21201a` | on `#111009` |
| --- | --- | --- |
| `#8a887f` | 4.59 | 5.36 |
| `#918f86` | 5.04 | 5.88 |
| `#95938a` | 5.30 | 6.19 |

`#8a887f` is the minimum that clears AA on the tighter of the two. Awaiting a
decision before touching it.

### Decided and closed 2026-09-07 — `#918f86`, in its own commit

Taken: **`--text-muted` in the dark block is now `#918f86`.** Light mode is
untouched. Measured after the change, in a real browser, reading computed
colours and walking up to the first non-transparent ancestor background rather
than assuming which surface a label sits on:

| pairing | ratio | AA |
| --- | --- | --- |
| `#918f86` on dark `--bg` `#111009` | **5.88** | pass |
| `#918f86` on dark `--surface` `#1a1915` | **5.43** | pass |
| `#918f86` on dark `--surface-2` `#21201a` | **5.04** | pass |

Every text pair on the review screen in dark now clears AA, tightest being
5.04 (`.review-back` on `--surface-2`). `.field-hint` measures 5.43.

**Why `#918f86` over the cheaper `#8a887f`.** `#8a887f` passes at 4.59 on the
tighter surface — 0.09 above the bar. A token used 242 times, sitting nine
hundredths above a compliance floor, fails the moment any surface darkens by a
shade, and nothing in the build would catch it. That is not a fix, it is a fix
with an expiry date.

The cost of the extra headroom is a small loss of muted-ness, and it is worth
stating in numbers rather than hand-waving. Contrast between the muted token
and `--text` `#d4d2cc`, i.e. how clearly muted text reads as subordinate:

| dark muted | vs `--text` |
| --- | --- |
| `#78766f` (old, failing) | 3.01 |
| `#8a887f` | 2.35 |
| `#918f86` (taken) | 2.14 |

For reference, **light mode already ships 3.29** (`#6b6960` vs `#18160f`). Both
candidates land well below that, so neither one meaningfully preserves the
separation light mode has — dark muted is inherently less distinguishable here
whichever value is picked. The choice between them moves separation by 0.21 and
moves contrast headroom by 0.45. Only one of those two numbers is a compliance
risk, so the decision goes to contrast.

**Scope actually touched.** One declaration in the dark `:root` block. The
do-not-touch items were checked and none of them resolve through this token:
the Grade gold-set and the wallpaper are gold- and image-driven, and the
homepage feature-grid blurb was inspected in dark after the change and reads
unchanged in layout. No copy, no layout, no light-mode value moved.

**Still open, separately:** `--text-faint` measures **1.92** in dark
(`#4a4840` on `--surface`), confirmed again in the browser this round across
~61 usages. It is a much larger and more invasive change than one token
substitution, it is not what this commit is about, and it stays logged here.

---

## 2026-09-07 — `--text-faint` paid, and what it cost to find out

### Resolved

`--text-faint` was the single token behind the `.field-label` release blocker.
The reported 1.90:1 and 1.92:1 were never two problems: 1.90 is the light value
on `--bg`, 1.92 is the dark value on `--surface`. One token, one fix, and the
fix clears every use of it at once. Inventory at the time of the fix was **105
references** (index.html 53, core bundle 13, remainder in CSS rules), grown from
the ~61 recorded in the original audit.

| theme | was | measured | now | measured |
|---|---|---|---|---|
| light | `#b3b1ab` | 1.90 / 2.00 / 2.14 / 1.78 | `#6b6960` | 4.87 / 5.14 / 5.51 / 4.58 |
| dark  | `#4a4840` | 2.08 / 1.92 / 1.78 / 1.96 | `#8d8b82` | 5.58 / 5.12 / 4.75 / 5.20 |

(surfaces: `--bg` / `--surface` / `--surface-2` / `--surface-off`)

Verified live at 720px in both themes: **219 rendered nodes at the token, 0
below AA, 0 skipped.** The instrument was proved falsifiable by reverting both
values and confirming it reports 35/35 dark failures at exactly 1.92 on
`--surface` — which independently corroborates the originally reported figure.

### Finding 1 — the light ramp cannot support a third text tier

Solving for the faintest value on this hue ramp that still clears 4.5:1 on the
darkest surface the token lands on returns **`#6b6960`, which is `--text-muted`
itself**. One step lighter (`#6c6a61`) measures 4.48 there. So light-mode
`--text-faint` is now *deliberately identical* to `--text-muted`.

What we believed was a three-tier hierarchy was two tiers and an illegible one.
The token's entire distinguishing property was being less readable than muted,
which is not a property worth having a name for.

**Two token names resolving to one value is rule 1's duplicate-implementation
smell** and should not be a permanent state. Left standing rather than collapsed
across 105 references mid-D3. **Decision owed:** collapse the tokens, or re-cut
the neutral ramp so a third tier can exist at AA. Note that hierarchy at these
sizes is already carried by size, weight, letterspacing and casing — the
micro-caps labels read as subordinate without being faint.

Dark retains four steps between faint and muted, so a third tier is technically
available there and imperceptible in practice.

### Finding 2 — a flat-surface contrast measurement is not a worst case

The dark value was first solved to `#89877e` against the four flat surfaces. It
then measured **4.41 and 4.31** on two tinted gradient panels that also sit
under this token — `.plan-card.tier-max` (`rgba(102,187,255,.06)` over
`--surface`, effective `#1f2323`) and `.plan-card.tier-ultimate`
(`rgba(196,122,0,.10)`, effective `#2b2313`). A tint lowers the contrast a
flat-surface measurement promised, so solving on flat surfaces alone ships a
failure. Re-solved against six surfaces.

**This applies to `--text-muted` too.** That token was fixed earlier with
flat-surface measurements only and its comment still records only those. It
happens to pass the two gradients (4.90 / 4.79), so there is no live defect —
but it passed by luck, not by having been checked. Contrast tooling that skips
gradient backdrops is measuring the easy case.

### Finding 3 — the always-dark surface bug

Four nodes paired a *theme-aware* text token with a *theme-fixed* `#0a0a0a`
background, so raising the light token turned a passing combination into a
failing one (9.23 → 3.65). These were regressions **caused by** the fix, caught
because the sweep reran, and pinned to `#8d8b82`:

- `index.html` flip-detail panel ×3 — `Bought` / `Sold` / `Platform`
- `#msProfitPreview` — `Enter a sold price to see profit` (was `--text-muted`, 3.60)

Root cause is a hex-literal surface where a token belongs. `#0a0a0a` appears at
many more sites in `index.html`; only those currently rendered were measurable,
so **this class is not closed.** Modal-only surfaces were never in the sweep.

### Coverage limits, stated plainly

- Only the default rendered state was swept. Nodes inside closed modals, error
  states, and empty states were never measured.
- Once light `--text-faint` equalled `--text-muted`, an instrument that selects
  by *computed colour* can no longer tell the two tokens apart in light mode.
  The light figure of 179 nodes therefore covers both tokens, not just this one.
  That is fine for an AA sweep and wrong for attribution.

### Incidental, and the most alarming thing in this pass

The affiliate disclosure — `⚠️ Some sell buttons are affiliate…` — measured
**2.08:1** in dark mode. A disclosure that exists to be conspicuous was the
least readable text on the page. Now 5.58. Nothing about the contrast debt
flagged it as different from decorative micro-copy, because contrast tooling
sorts by ratio and not by what the text is *for*.
