# Q3 — Cross-surface disclosure parity

**Question:** do the surfaces that make money claims disclose *equivalent facts* —
not identical text — about how those numbers were derived?

**Status: first pass. One confirmed defect, two of my own false positives
corrected, one confirmed clean. Not complete.**

---

## Method note, before any finding

My first move was a keyword-presence table: regex per disclosure concept, one
column per surface. **That is the exact defect this repo's pattern catalogue is
about** — a regex hit is evidence about a surface, not about whether a fact is
disclosed. Two cells were wrong when checked against the actual sentences:

- **`pricing.html` "±15% band" → FALSE POSITIVE.** The `15%` on that page is the
  *top-up pack discount* for the Pro tier ("Top-up pack discount — 10% 15%").
  Nothing to do with the price band.
- **`accuracy.html` "tax" → matched, but not the fact I was testing for.** The
  hits are about eBay's FVF applying to item + shipping + tax, which is a
  different disclosure from "the payout excludes buyer sales tax."

Recorded because the table looked authoritative and was wrong in the direction
of *reassurance* — it showed parity where there is none. Every finding below is
from reading the rendered sentence, not from a match count.

---

## Finding Q3-A — the grading panel runs a second fee model, and discloses it

**Severity: high. This is BIAS-1, rule 1, and disclosure parity converging on one
block of code.**

`renderGradingUpside` (`js/core.7f9c03ad.js:11425+`) declares its own constants:

```js
const GRADING_FEE = 25;   // PSA value tier ~$25 all-in     (:11435)
const FEES_PCT    = 13;   // eBay + shipping typical        (:11436)
```

and captions its output (`:11552`):

> `net after $25 fee + 13% sale fees`

with the headline (`:11539`):

> `📈 Best case: <tier> → $<n> net upside vs raw sell`

The function **never calls `feeEbay`** — confirmed by extracting the function
body and searching it (`feeEbay: --`). So:

1. **Rule 1 violation.** One business behaviour — "what does eBay take" — has
   two implementations: the audited `PLATFORMS.ebay` model with
   `feeAuditedOn: '2026-09-01'` (`:5873`), and `FEES_PCT = 13`. A second fee
   model is on the do-not-do list. This is instance **9** of rule 1 being bitten.
2. **Disclosure parity failure, and the bad kind.** The panel is not silent about
   its basis — silence would be safer. It states a *specific, checkable* basis
   that **disagrees with the model every other surface uses**. A reader who
   compares the grading panel's "13% sale fees" against the fee table on
   `accuracy.html` finds two different numbers for the same venue, with no
   disclosure that they differ. Per the standing rule — cross-source
   disagreement is disclosed, never averaged away — this is worse than an
   omission, because it reads as precision.
3. **Both simplifications lean the same way.** This is the BIAS-1 mechanism with
   figures attached:
   - `GRADING_FEE = 25` is flat. The server tiers PSA by declared value
     (`api/grade-opportunity.js:44-52`): `<$200 → 25`, `<$500 → 50`,
     `else → 100`. So for any card at or above $200 the panel understates
     grading cost by **$25–$75**.
   - `FEES_PCT = 13` against an eBay FVF that applies to the **whole order**
     (item + shipping + tax) plus a per-order charge — the correction
     `accuracy.html` already makes in its own words.
   - Understating cost inflates upside. **Both errors push the number up**, on
     the panel whose entire purpose is to argue for paying to grade.

**Not fixed here.** The fix is BIAS-1 as already scoped — route through
`feeEbay`, and take the per-column grader question (BIAS-3 / -7 / -8) with it,
since the caption's `$25` is a PSA value-tier figure being applied to a column
subtitled `BGS/CGC`. Ordering stands: after D3.

**What is new** is that BIAS-1 is not only a directional-bias defect. It is a
rule-1 duplicate and a false-precision disclosure, so it cannot be closed by
adjusting a constant — only by deleting the second model.

---

## Finding Q3-B — `accuracy.html` never mentions the derived band

`accuracy.html` has a **Live pricing** section and a **Known limits** section,
and the app discloses the derived band in-flow, twice, well:

> "Estimated band. Comp is the displayed source value; Sell Now and Patient are
> calculated as 15% either side of it — **not observed sales.**"
> (`js/core.7f9c03ad.js:4290-4297`; slab variant at `:4259-4262`)

That copy is **correct and well-built**: the percentage is interpolated from
`_QP_DERIVED_SPREAD` (`:3859`, `= 0.15`) rather than typed into the string, so it
cannot stamp a stale number if the spread changes.

But `accuracy.html` — the page whose job is to document how prices are derived —
contains **zero** occurrences of `15%`, `patient`, `sell now`, `fallback`, or
`estimated band`. A user reading the methodology page cannot learn that a rung
exists where two of the three headline numbers are **arithmetic on the comp
rather than observed sales**.

**Equivalent-facts test: fails.** The in-app surface discloses a derivation the
methodology page does not record. This is a genuine parity gap, not a wording
difference.

### The T2.5 collision, resolved: two mechanisms, not one

**They are separate.** T2.5 does not touch the band this paragraph would
describe.

| | Mechanism 1 — synthesized `low`/`high` | Mechanism 2 — the strategy band |
|---|---|---|
| Lives | server, `api/tcg-price.js:241,243` (TCGplayer rung) and `:293,295` (fallback rung) | client, `core:3859` → `:3884` |
| Operates on | `displayMarket` / `fb.market`, filling absent upstream fields | `comp` |
| Renders as | `· range $low–$high` next to the source row (`core:1911-1912`, `:1990-1991`) | Sell Now / Comp / Patient tiers |
| Coefficient | `0.85` / `1.15`, hardcoded 4× | `_QP_DERIVED_SPREAD = 0.15`, hardcoded 1× |
| T2.5 | drops it **on the fallback rung only** | untouched |

So T2.5 removes one instance of mechanism 1 and leaves mechanism 1 alive on the
TCGplayer rung and mechanism 2 entirely alive. Copy about the strategy band
survives T2.5 intact.

Mechanism 2 is also the better-documented of the two: `core:3875-3883` records
why a symmetric band beat the measured alternative — `basis.low/mid` are active
listing asks across *all* conditions, so "Sell Now" undercut the cheapest ask,
which on a Base Set Charizard was a $125 heavily-played copy. A band around the
comp is an estimate and says so; it never quotes a different card's condition
back at the seller. That reasoning is worth preserving in whatever copy lands.

**But the collision resolves the guard question against naming the number.**
One magnitude — 15% — is hardcoded **five times across two unrelated
mechanisms**. A paragraph on `accuracy.html` saying "15%" would read as covering
both, which is precisely the failure mode flagged: it would describe one
derivation in words that appear to cover another, and after T2.5 it would appear
to cover a rung that no longer has a range. Naming the *mechanism* — arithmetic
on the comp, not observed sales — is both more accurate and invariant to the
number changing.

**Decision: the fact is what is missing, not the number.** Copy states the
derivation and omits the magnitude; the figure stays in-app where it is
interpolated from the constant and cannot go stale. No literal, no stamp, no
guard to maintain. The copy-plus-guard option remains available if the figure is
ever wanted on the page, scoped exactly as below — but it is not the cheaper
path and it is not the one the gap calls for.

**Copy still NOT written**, for a new reason: Q3-C below means the paragraph
should cover *both* derivations, which changes its shape. One coherent proposal
after Q3-C is triaged, rather than a paragraph about the strategy band that
would need rewriting a day later.

For the record, had the figure been wanted on the page, the guard was:

1. A short paragraph under **Live pricing** stating that when no listing spread
   is available, Sell Now and Patient are computed as a fixed percentage either
   side of the comp and are not observed sales.
2. **A parity guard, mandatory if the copy lands.** `accuracy.html` is static and
   may not gain a build step or a runtime fetch, so the percentage would be a
   literal in the page — exactly the "stamp" the standing rule warns about. The
   established answer is the Q2 pattern: extend `tests/accuracy-fee-parity.mjs`
   to assert the page's stated spread equals `_QP_DERIVED_SPREAD`, so the number
   is guarded rather than trusted. Without the guard, do not add the copy.

Deliberately not written yet: it is user-facing copy on the accuracy page, and
the rule is that the model changes first and the stamp second.

---

## Narrowed — what the fee-surface guard actually proves

`accuracy.html`'s fee table and the review screen's fee breakdown are backed by
the same model and now hold a **bidirectional venue + date parity guard**:
`tests/accuracy-fee-parity.mjs`, **15/0**, all 15 venues agreeing at
`2026-09-01`. **Scope of that proof, corrected after review:** it establishes
venue-set and date parity between the two projections, in both directions. It
does **not** establish equivalence of fee bases, tax treatment, discounts,
shipping cost, or source qualifications on the rendered surfaces — and Q3-A is a
live example of a fee-basis divergence the date guard cannot see. Those checks
are unfinished. Separate markup for the two surfaces is an accepted decision; the
parity test is what closes the drift risk. Note the two surfaces are backed by
*two* tables — `PLATFORMS` (fee table) and `CROSS_BORDER` (cross-border table),
where one row groups four buylist venues, so **12 rows carry 15 venues**. Row
count is not venue count.

---

## Not yet walked

- The payout bar chart and `msProfitPreview` (BIAS-6 territory) — not inspected
  for disclosure basis.
- Aggregator service-fee rows.
- Whether the "estimate, not a guarantee" language on `pricing.html` and
  `about.html` is equivalent to the in-app disclosures or weaker.
(`_renderGradeOpportunity` resolved — see Q3-D.)

---

## Finding Q3-C — a displayed "range" can be arithmetic, with a Market price pill on it

Same defect family as Q3-A, different surface, and arguably worse.

`core:1911-1912` renders `· range $<low>–$<high>` next to the TCGplayer source
row, immediately after a green **"Market price"** trust pill. Those values come
straight from the price payload — where `api/tcg-price.js:241,243` fills them in
as `displayMarket * 0.85` / `* 1.15` whenever upstream omits `low`/`high`:

```js
low:  r.low  ?? (displayMarket * 0.85),
high: r.high ?? (displayMarket * 1.15),
```

**Nothing on the surface distinguishes an observed range from a synthesized
one.** A range is inherently a claim about observed dispersion, and this one is
presented under a pill that asserts market data. When the fallback fires, the
number is arithmetic wearing the costume of a measurement — the Q3-A pattern
exactly: a stated basis that survives a reader checking it, and hands them a
wrong answer with no signal.

Note the synthesized case is **mechanically detectable**: a fabricated range is
exactly symmetric, `high / low === 1.15 / 0.85 ≈ 1.3529`, so a tripwire is
possible. Not asserted here — a genuine range could coincidentally hit that
ratio, so it is a tripwire and not a proof, the same standing as the drift guard.

The honest fix is upstream: the payload should mark a synthesized range so the
caption can withhold it or label it, rather than the client inferring from a
ratio. **Not scoped here.** Filed.

---

## Finding Q3-D — BIAS-1 stays one function

`_renderGradeOpportunity` is **not** a third fee model. Resolved:

- Its real name is `_renderGradeOpportunity_withdrawn` (`core:2178`), and it has
  **no callers** — the only other reference in the repo is the assertion that
  keeps it that way.
- That assertion is `tests/launch-audit-regressions.mjs:833`:
  `(code.match(/_renderGradeOpportunity_withdrawn/g) || []).length === 1`. **This
  is one of the six rule-1 exact counts the widened sweep classified as
  must-stay-exact, and it is the clearest possible vindication of that call.**
  The `1` is the definition and nothing else; a floor would pass a re-added call
  site, which is the precise defect the guard exists to catch. A signature-driven
  conversion would have broken it.
- Worth recording the irony: the withdrawn surface had the **correct** basis. Its
  caption reads `est. profit after $${gradingCost} grading + eBay fees
  (${g.edgePct}% edge)`, and both values are server-supplied from
  `api/grade-opportunity.js:128-131`, which tiers grading cost via
  `getGradingCost(rawPrice, grader)` and subtracts a computed `platformFees`.
  The surface that survived is the one that hardcodes `25` and `13`.

**BIAS-1's scope is unchanged: one function, `renderGradingUpside`.**

## Sources

- [eBay selling fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822)
- Server grading tiers: `api/grade-opportunity.js:44-52`

---

## Q3-E — the comparison surface, walked for tax (2026-09-07)

**Asked by the reviewer, and the answer is no: the tax half is eBay-only.**

BIAS-9 does not block D3 because the review screen discloses its narrower base.
That is a disclosure on **one** surface. The venue comparison surface is where the
seller is told which marketplace to use, and it was never walked for this.

### Measured — which venue fee functions carry which disclosure

| field | venues that set it | of 12 |
|---|---|---:|
| `feeBase` / `feeBaseLabel` | `feeEbay`, `feeTCGPlayer` | **2** |
| `taxNote` | `feeEbay` | **1** |

Both rows are conditional at the render (`js/core.7f9c03ad.js:8154`,
`:8155` — `r.feeBase != null` and `r.taxNote`), so for the other ten venues the
comparison table prints **no fee-base row and no tax row at all.** Poshmark,
COMC, Fanatics, Whatnot, Mercari, ManaPool, Cardsphere, Cardmarket, the three
buylists and CardNexus each show a fee total whose base is unstated.

So the answer to the parity question: **the shipping half is present for two
venues, the tax half for one, and the equivalent-fact test fails.** eBay's seller
is told the estimate excludes buyer sales tax. Eleven venues' sellers are not,
and the ranking that chooses between them is computed on bases that omit it
everywhere.

### Does it move the ranking? Order: no. Magnitude: yes.

$400 card, 6% buyer sales tax ($24), no shipping charged, default profile:

| venue | fee now | net now | net if fee also charged on tax | flattered by |
|---|---:|---:|---:|---:|
| Fanatics | 29.00 | 371.00 | 369.56 | +1.44 |
| Mercari | 40.00 | 360.00 | 357.60 | +2.40 |
| Whatnot | 43.90 | 356.10 | 353.48 | +2.62 |
| TCGplayer L1 | 53.30 | 346.70 | 343.52 | +3.18 |
| eBay (no store) | 53.40 | 346.60 | 343.42 | +3.18 |
| Poshmark | 80.00 | 320.00 | 315.20 | +4.80 |

Ranking order is **identical** before and after. But two numbers matter more than
the order:

1. **The omission is proportional to the fee rate, so it always flatters the
   more expensive venue more** — $4.80 for Poshmark against $1.44 for Fanatics.
   It **compresses the apparent spread between cheap and expensive venues by up
   to $3.36** on a $400 card. The product's value claim is the *size* of the
   difference ("you'd keep $51 more"), not just the order, and that size is
   understated in the direction of making an expensive venue look acceptable.
2. **The eBay ↔ TCGplayer gap is $0.10, against a per-venue omission of $3.18 —
   32×.** Order survives here only because those two happen to be flattered by
   the same amount. **If their real tax treatment differs at all, a $0.10 gap
   flips.**

### What is actually unverified, and it is the load-bearing part

The order-survives result above assumes the omission is **uniform** — that every
venue charges commission on a tax-inclusive total, exactly as eBay does. **That
is asserted nowhere and verified for exactly one venue.** eBay is confirmed from
raw page text. For the other eleven, this repo has no citation either way.

So the honest statement of the current state is not "the ranking is fine." It is:
**the ranking is correct if and only if an unverified uniformity assumption
holds, and the margin protecting the #4/#5 boundary is $0.10 against a $3.18
per-venue effect.**

Filed as **BIAS-10**. The work it needs, in order:

1. Per-venue, from **raw page text** and not a summary: does the venue charge its
   commission on a total that includes buyer sales tax? One citation per venue.
2. Wherever the answer is yes and the model omits it, the venue owes the **same**
   disclosure eBay already carries — equivalent fact, not identical string.
   `taxNote` is already a per-venue flag on the fee-items object, so this is a
   flag plus a citation per venue, not a new mechanism.
3. Wherever the answer is no, record that too — an accurate model with no note is
   correct, and the next reader needs to know it was checked rather than missed.
4. Only then is the compression figure meaningful, because only then is the
   per-venue delta real rather than assumed.

**Do not add a tax rate to any model.** Tax depends on the buyer and the ship-to
state; a draft and a comparison row both have neither. The fix is disclosure and
citation, exactly as with BIAS-9 — the estimate stays a lower bound on the fee.

### Q3-E revised — the compression is the finding, and the root cause is a missing field

**Reframed after review 2026-09-07.** The headline above was wrong about which
result mattered. "Order survives" is the reassuring number and it led. The finding
is the other one:

> **The omission scales with the fee rate, so it always flatters the more
> expensive venue more, and therefore compresses the gap the product exists to
> report.**

"You'd keep $51 more on Fanatics" is the sentence a seller acts on. The ordering
is a means to that sentence, not the product. A spread compressed by up to $3.36
on a $400 card makes every expensive venue look closer to acceptable than it is —
**a lean in the number the product exists to produce**, not in a supporting
figure. BIAS-10 is a magnitude bias, not a ranking bug, and it should be read
that way in the register.

#### The $0.10 margin is instance 18 from the other side

The eBay ↔ TCGplayer gap of $0.10 survives a $3.18 per-venue error **only because
the two errors are equal.** Nothing in the code, the tests, or this document
records that the equality is load-bearing. It is a safety margin that holds by
coincidence of two near-identical fee rates, and it would stop holding the moment
either venue's tax treatment or rate diverged — with no test failing.

Same shape as pattern instance 18: a threshold whose safety depends on an input
range nobody wrote down. Recorded there as a second form rather than a new
instance, because the mechanism is identical and inflating the count is the exact
failure that file already documents about itself.

#### The general rule, stated once

**No invented input to a fee model.** Not "no invented tax rate" — the narrower
form invites the next person to invent something else. A tax rate needs a buyer
and a ship-to state; neither exists at draft time or at comparison time. And the
specific reason this rule is stricter for fee inputs than elsewhere: **an
invented input propagates into every venue's number simultaneously and silently**,
so it cannot show up as an outlier. It moves the whole board and looks like
consistency. Disclosure and citation close a gap of this kind; modeling does not.

#### The root cause: `taxNote` is encoded as a line, not as a field

**Promoted above the stamp question 2026-09-07 — this explains the shape of
everything above it.**

`items.taxNote = true` is hardcoded inside `feeEbay` (`js/core.7f9c03ad.js:6840`).
The fact "this venue charges its commission on a tax-inclusive total" is a
**venue fact**, and every other venue fact lives in `PLATFORMS`. Encoding it as a
line inside one fee function is rule-1 wrong in the same shape as the duplicate
fee model, and it is the mechanical reason eleven venues silently have no note:
there was never a field to leave blank.

**Eleven venues are not missing a disclosure because anyone decided they did not
need one.** They are missing it because there was nothing to be missing. And that
is the general form worth naming:

> **A fact encoded as a line inside one implementation is invisible everywhere
> that implementation is not.**

An absence with no representation cannot be audited, cannot be counted, and does
not appear in any diff. A `taxOn` field left unset on eleven venues is a
reviewable hole — greppable, countable, and guard-checkable. Eleven venues with
no such field are not a hole at all; they are the normal case, and nothing
distinguishes "checked and does not apply" from "never considered." Filed as
pattern instance 22.

Sequenced fix — **citations first, publication last:**

1. Re-read all fifteen published fee pages from **raw page text**. Record, per
   venue, whether commission applies to a tax-inclusive total.
2. Add `taxOn: true | false | 'unknown'` to each `PLATFORMS` entry, bumping
   `feeAuditedOn` in the same commit because step 1 was a real re-audit.
3. Derive `taxNote` from `PLATFORMS[pid].taxOn` and delete the hardcoded line —
   one behaviour, one implementation. `'unknown'` must render the disclosure, not
   suppress it: an unverified treatment presents as unverified, matching how
   `feeAuditAgeDays` fails closed.
4. Extend `tests/accuracy-fee-parity.mjs`: every venue carries a `taxOn`, and
   `taxNote` is set if and only if `taxOn !== false`.
5. Only then restate tax treatment on `accuracy.html`, so the guard covers it the
   way it covers venue and date. **Do not publish a tax claim before step 1
   supplies its citation.**

Step 1 is genuine research and it goes stale, which is the argument for folding it
into the next scheduled re-read rather than running it as a one-off: the next
re-audit is due before **2026-10-01** to stay out of amber, and doing tax then
costs one extra field per page instead of fifteen separate visits.

**But the deadline does not belong to the re-audit.** Folding the work in is the
right economics; inheriting the schedule is not. `2026-10-01` is an **amber
display threshold** — a colour change — and tying a seller-facing correctness
item to it means that if the re-audit slips, tax slips with it, and the recorded
reason will be *nothing was due yet* rather than *someone decided to wait*. A
correctness item must not inherit a deadline derived from a styling gate.

> **Tax treatment ships with the next fee re-audit, or by 2026-09-21, whichever
> comes first.**

The independent date is deliberately earlier than amber so that the re-audit
schedule can only ever make it happen sooner, never later.

#### The stamp: one date or two?

The suggestion to date each tax-treatment citation the way `feeAuditedOn` dates
each fee schedule is right about the need. **It has a fork in it, and the
one-date branch is the correct one.**

The existing machinery is already fail-closed and reusable — `feeAuditAgeDays()`
returns `Infinity` for missing, unparseable, future, and calendar-rollover dates;
`isFeeAmber()` at >30 days, `isFeeStale()` at >45. All 15 venues carry
`feeAuditedOn: '2026-09-01'` (6 days old today; amber 2026-10-01, stale
2026-10-16). `tests/accuracy-fee-parity.mjs` already enforces that every venue
carries a stamp and that the model and `accuracy.html` agree on it.

**Against a separate `taxCheckedOn`:** the field's own docblock defines
`feeAuditedOn` as *"when did we last READ the venue's published schedule."* Tax
treatment is on that schedule — it is the same page, read in the same sitting.
A second date for one reading event is two hand-maintained copies of one fact,
which is the duplicate-implementation bug in date form and the precise failure
the parity guard was written to catch. It would also make an inconsistent pair
representable: fees read Sep 1, tax read Oct 15, with no way to say which reading
the row reflects.

**So: one date, and the tax audit IS a fee-schedule re-audit.** Re-read all
fifteen published pages, record the tax answer alongside the fee values, bump
`feeAuditedOn` in the same commit. That keeps one date meaning one thing.

A second date earns its place only under one condition: if tax treatment is ever
published somewhere other than the fee schedule, so the two facts genuinely have
different sources and can go stale independently. Until that is true of a real
venue, do not add the field.

**And do not bump `feeAuditedOn` without actually re-reading.** Bumping it to
cover a tax-only check would stamp a schedule re-verification that did not
happen — a lie in the field whose whole purpose is to not lie about that.
