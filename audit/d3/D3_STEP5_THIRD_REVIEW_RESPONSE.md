# D3 Step 5 — Third review response

**Commit at time of writing:** `59a971f` · branch `phase1-block-d` · tree clean
**Reviewed document:** D3 Step 5 · Third review, `491558c`, 7 September 2026
**Nothing pushed. Nothing deployed. `origin/main` is still `9aaf326`.**

**This document is self-contained.** Your stated evidence limit is that the repo,
commits and tests are not independently inspected — so every `file:line` below is
a pointer you cannot open, and any reference to one of our internal audit files
would be a dead end. Everything this response relies on is therefore reproduced
in the appendices: the rule and rider (A), the structural class (B), the
stale-packet instance (C), the two open defects it discloses (D, E), and the
token comment (F). Nothing here requires a second file.

Every claim below is bound to `file:line` so that *we* can be held to it and so a
future reader with repo access can check it. Where the repo cannot establish
something, it says **Unverified**. Line numbers in `js/core.7f9c03ad.js` shift as
the bundle is edited — re-grep rather than trusting a citation's line number
after any further change.

---

## 1. The blocker was already closed before the review arrived

> *"D3 is not ready to close because the new listing confirmation is still
> described as a global profile key."*

**The description was stale, not the code.** The reviewer read the return packet,
which documented the shape as it existed when the packet was written. The value
stopped being a profile key earlier the same day. This is a documentation defect
on our side, not a disagreement — the packet described a shape the code no longer
had, and a reviewer working from the packet had no way to know.

**`ebayTrsListing` is not a profile key:**

- `js/core.7f9c03ad.js:5660-5673` — `_crSellerProfile()` returns four keys:
  `ebayStore`, `ebayTopRated`, `ebayPromo`, `tcgLevel`. `ebayTrsListing` is
  absent, with the reason stated inline at `:5668-5669`: *"ebayTrsListing is NOT
  read here. It describes one listing, not the seller, so it is not a profile key
  at all."*
- `js/core.7f9c03ad.js:5675+` — the confirmation is held in
  `_trsListingConfirm = { ctx, ok, rev }`, stamped with the listing context it
  was given in.
- `noteTrsListingAnswer()` at `:5833-5847` calls `touchListingContext()` **before**
  stamping, so an answer given after an unrecalculated field edit is stamped
  against the post-edit revision. The reasoning is in the comment at `:5837-5842`.
- `trsListingConfirmed()` at `:5820-5829` has two guards: a monotonic revision
  check and a live context comparison, and **evicts** the stamp on mismatch.
- `syncTrsListingControl()` at `:5852-5864` clears the visible select when the
  answer has expired, so the control cannot read "Yes" against a full fee. It is
  deliberately called for its eviction side effect even when no control exists
  (`:5856-5858`), so a surface without the select cannot leave a stale stamp for
  the next surface to read.

**The four acceptance states you required are each covered by a registered
assertion in `tests/trs-listing-scope.mjs` (60 passed, 0 failed):**

| Required state | Assertion | Line |
|---|---|---|
| status only → no discount | `no confirmation, so no eligibility`; full 13.25% charged | `:200-202` |
| confirmation → percentage discount | `the percentage fee is exactly 90% of the full rate` | `:213-217` |
| card/slot/terms change → cleared or re-derived | `the confirmation no longer counts`; slot variant at `:298` | `:247`, `:298` |
| withdrawal → discount gone, per-order fee unchanged | `the per-order fee is unchanged by the discount either way` | `:315-324` |

**Your specific reload concern is directly asserted:**
`:343` — *the saved profile contains no listing confirmation*; `:375` — *a reload
does not convert a prior answer into current eligibility*; `:377` — the control
returns to its safe default; `:378` — the durable seller status still survives, so
this is a scope fix and not a regression.

Also covered beyond your list: an identical re-scan of the same card does not
inherit the answer (only the listing instance distinguishes the two contexts, and
it did); returning to an earlier context does not return to an earlier revision;
clearing and retyping the same price requires fresh confirmation; and all four
context inputs (`priceOverride`, `shipCharge`, `shipCost`, `searchInput`) reach the
mutation boundary through their own events.

### Where we do not yet meet your bar

> *"make the confirmation cover the benefit, not handling alone… Either enforce
> those conditions from known product state or ask the seller to confirm the
> listing qualifies."*

**Accepted, open.** The scope bug is fixed; the *scope of the question* is not.
The control still asks about handling time. Seller-country and the local-pickup
exclusion are **not** enforced from product state and **not** asked. The returns
exception for trading cards is the one condition we can assert from known state.

We are not shipping a widened question inside D3. Widening it means either
enforcing conditions from state we do not hold, or adding a second confirmation —
and a disclosed assumption is, as you say, not enough when it changes the
estimate. Filed rather than patched. The review screen remains undiscounted
regardless, so nothing currently renders a discount off the narrow question.

---

## 2. Answers to your three answers

**1 · `<dl>` for fee rows — accepted, not yet landed.** Semantic shape agreed.
Also accepted: no third column reserved for D4 price provenance, and price
provenance belongs beside the Price field because it describes the asking price,
not the fee schedule. **Unverified:** we have not run an accessibility-API or
screen-reader pass on the converted markup, because the conversion is not
written. Verification will use CDP `Accessibility.getFullAXTree` —
`page.accessibility` is removed in Playwright 1.59.

**2 · One authoritative date + a projection guard — accepted.** No runtime fetch,
no build system. The guard is a bidirectional row-level comparison between
`accuracy.html` and the authoritative fee-model data, failing on missing venue,
extra venue, or mismatched date, plus a source comment near the table. Your
framing is the part worth keeping on the record: this *does not* pretend the
cells are no longer duplicated, it makes the duplication mechanically
accountable. Not yet written.

**3 · Share the contract, not the markup — accepted, and it corrects us.** We had
been treating a shared renderer as the goal. Agreed that forcing one renderer
across a ranking tile and a draft review buys a brittle abstraction, that
`FEE_DISCLOSURE` should own the shared language and neutral disclosure data, and
that parity tests over five facts — fee base, unknown-tax state, audit state,
estimate limitation, applied/withheld Top Rated Plus assumption — are the real
drift control. Revisit a shared renderer only if *behaviour* keeps diverging, not
markup. `accuracy-fee-parity` (15/0) is the existing partial instance of this
pattern; it does not yet cover all five facts.

---

## 3. Findings since the packet you reviewed

These are ours, not responses. Two of them make the picture worse.

**Q3-C client half landed (`9a3c7ac`)** — three separate conditions on the
Lowest-listing row: provenance decides the label (keyed off `lowBasis`, never
`marketBasis`); the relation to the median ask decides whether it is a floor at
all, independent of provenance; `datedBySource` is now derived from `marketBasis`
instead of hardcoded `true`. Behavioural block added to `tests/quick-pricing.mjs`
(55/0) and mutation-tested two ways.

**`9a3c7ac` does not close that row — T2.14.** Withholding the row leaves the
suppressed state (we have a floor and distrust it) rendering identically to the
never-had-it state (upstream sent no low). Those are the two cases a seller most
needs separated. A visible mislabel was traded for an invisible omission. Filed
as instance **22c**, and the withhold-rather-than-relabel rule now carries a
mandatory rider: *withholding is only complete once the withheld state is
distinguishable from the never-had-it state.* No copy proposed — disclosure here
asserts something about why the book is inverted, which needs the Q7 decision.

**Eight suites were green before that fix was written.** Including the three
assertions that supposedly pin the row's copy. They grep for the string, the
string never moved, and they would have passed against a build with the guard
deleted. Recorded as evidence that the catalogue's oldest pattern is still its
most common, twenty-three instances later. The operative consequence: a passing
run is evidence about strings until someone proves the assertion can fail. Two
mutation tests are the only reason the fix is known to be guarded rather than
merely accompanied by tests.

**Q3-F — the headline is trimmed downward and nothing says so.** Measured against
13,638 real catalog products: the blend admits the low ask 52.18% of the time,
median own-effect −11.01%, net −3.99% versus a mid/market centre. That is a
systematic downward adjustment to the number every other figure derives from,
disclosed on no surface, under a basis label reading `TCGPlayer market` on a rung
where `marketBasis` is `'ask_blend'` and no sale sits behind the number. Live
under the current default — it requires no change to become real.

---

## 4. Your scoped `--text-faint` check — passes

> *"Check whether any essential instruction, fee disclosure, status, or
> interactive label in Block D uses it."*

Block D occurrences: `.qp-row-age` (`index.html:684`, carries the basis
provenance label), `.qp-info-caveat` (`:622`), `.qp-graded-note` (`:623`),
`.price-source` (`:593`), `.badge-na` (`:871`), `.note-italic` (`:898`).

Computed contrast, `--text-faint` against all four surface tokens per theme:

| | `--bg` | `--surface` | `--surface-2` | `--surface-off` |
|---|---|---|---|---|
| light `#6b6960` | 4.87:1 | 5.14:1 | 5.51:1 | 4.58:1 |
| dark `#8d8b82` | 5.58:1 | 5.15:1 | 4.78:1 | 5.25:1 |

**Minimum 4.58:1.** All eight clear 4.5:1 for normal text. No Block D occurrence
needs to change before release.

**Hold this result loosely — it is a pass on the question asked, and the light-mode
half of the table is not measuring what it appears to measure.** `#6b6960` is
byte-identical to `--text-muted`. So the light row is the second tier measured
twice, not a third tier verified. "Minimum 4.58:1" is true and it is **not**
evidence that a faint tier is AA-compliant, because in light mode there is no
faint tier to be compliant.

The consequence is forward-looking: if the neutral ramp is ever re-cut so a third
tier can exist, every Block D occurrence listed above silently inherits whatever
the new value is, **unreviewed**, and this pass does not cover it. The occurrences
were checked against a value that is currently a duplicate, not against the token's
intended role. Recorded here rather than only in the internal debt log, because the debt log
is not what gets read at release.

**The residual debt is not contrast, and is already logged.** In light mode
`--text-faint` is `#6b6960` — byte-identical to `--text-muted`. The third tier
does not exist in light mode; it was made AA-compliant by being collapsed into
the tier above it. Two token names, one value, 105 references. Documented at
`index.html:100-110`, with the full comment quoted in **Appendix F**, and logged
internally as a deliberate choice between collapsing the tokens and re-cutting the
neutral ramp. Not
reopened here, per your instruction. Worth noting it is the same shape as T2.14
and instance 22 — two states a reader needs separated rendering identically — the
third occurrence of that shape in one day.

---

## 4b. The stale-packet failure mode, and the rule it produced

Filed as **instance 25**, carried in full in **Appendix C**. Worth stating in this
document because it cost this review cycle.

Every prior entry in our defect catalogue is a claim that was
*wrong about the code*. This one was accurate when written and became wrong by
the code moving underneath it. Nobody was careless — the packet was correct at
write time, and that is not a property that survives.

> **A snapshot handed to a reviewer is read as the present tense.**

The remedy is not more care in the packet. It is that the reader must be able to
tell whether they are reading history:

> **A review request carries the commit it was written against.**

Then a reviewer comparing the packet's tip against the branch tip can see for
themselves whether a described shape is current, and a blocker raised against a
stale description is identifiable before it consumes a cycle. This response
states its commit in the header; from here that is a rule, not a formatting
habit.

---

## 5. Closeout status against your list

| Requirement | Status |
|---|---|
| Listing-scope blocker | **Closed** — `:5660-5673`, `:5820-5864`, 60/0 |
| Benefit-scope of the question (country, local pickup) | **Open, filed** — not widening inside D3 |
| Semantic `<dl>` fee rows | **Open** — accepted, not written |
| Static-date parity guard | **Open** — accepted, not written |
| 720px light/dark across all states | **Partial** — done for the Lowest-listing row states (20 combinations, no overflow, leader self-adjusts, no orphan separator). Fee-row states not yet re-verified after the `<dl>` conversion, which has not happened |
| `--text-faint` scoped check | **Closed on the question asked** — min 4.58:1. Light-mode figures measure `--text-muted` twice, since the tokens share a hex; a re-cut ramp re-exposes every Block D occurrence unreviewed |
| Final bundle rename → `asset-fingerprints` 15/0 | **Open** — held red at 14/1 by design; the rename is D3's last action |
| Clean-checkout safe suite run + executed/skipped inventory | **Open** |
| Cert ID rotation | **NOT DONE. Push remains blocked.** |
| Credential hygiene — inventory labels, rewrite the partial commit-message disclosure | **Open** |

**On the three-in-one-day observation:** promoted to a named **Class** in our
defect catalogue rather than left as three instances (**Appendix B** carries it
in full). All
three are "we know something the surface cannot express," and two of the three
were produced by correct decisions, so it is not a carelessness pattern. It is the
downstream cost of rules we intend to keep — every rule that pushes toward
withholding rather than guessing produces a state whose honest rendering is
nothing, and nothing is already an existing claim with an existing meaning. The
review question that follows is now in the checklist: *for every state where we
correctly decline to publish a number, what does the seller see, and what else
produces that same view?* The contact sheet is promoted from a nicety to a
required step for any change that adds or removes a rendered state, since none of
the three was findable by per-state assertions.

**On your closeout framing:** we are treating "finish the listing-scope blocker,
semantic fee rows, static-date parity guard, final bundle rename, and safe local
suite run" as the definition of D3-complete, with the benefit-scope question and
T2.14 explicitly *outside* that definition and carried into the open list rather
than silently absorbed. Saying so because a list of five items reads as
exhaustive, and two known-open things are not on it.

---

## Sources

- eBay selling fees — https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822
- eBay seller standards policy — https://www.ebay.com/help/policies/selling-policies/seller-standards-policy?id=4347
- eBay Top Rated Seller Program — https://www.ebay.com/sellercenter/protections/top-rated-program
- W3C WCAG 2.2 Contrast (Minimum) — https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- tcgcsv bulk data (Q3-F measurement source, public read-only) — https://tcgcsv.com/tcgplayer

---

# Appendices — full text of everything cited above

These are reproduced verbatim from our internal audit files so this response
stands alone. They are the filed record, not a summary written for this document.

---

## Appendix A — the rule and its mandatory rider

## Rule — withhold rather than relabel, and its mandatory rider

Stated three times as a remedy before it was ever written down as a rule
(`DIRECTIONAL_BIAS_AUDIT.md:757` on the grading upside,
`D3_STEP5_SECOND_REVIEW_RESPONSE.md:178` on the review-screen discount,
condition (2) of `9a3c7ac` on the Lowest-listing row):

> **A number with no defensible name does not get a worse name. It goes away.**

The rule is right and stays. But it manufactures the instance-22 collapse **by
design**: every correct refusal to mislabel creates a state that renders as
absence, and absence already means something to the reader — usually "we don't
have this." So the rule is incomplete on its own and carries a rider:

> **Withholding is only complete once the withheld state is distinguishable from
> the never-had-it state.** If suppressing the number makes the surface identical
> to the surface where the number never existed, the mislabel has been traded for
> a different false claim, not removed.

Corollary for review: a withhold-on-condition fix is not assessable from its
diff. The diff shows the suppression, which is the part that is correct. What has
to be checked is the **rendered collision** between the suppressed state and the
naturally-empty state, which only appears when the two are put next to each
other. Per-state assertions cannot see it — T2.14 survived nine of them, each
correct in isolation.

---

## Appendix B — the class this response reports three instances of

## Class — states the surface cannot distinguish (three instances in one day, 2026-09-07)

Instance 22, T2.14/22c, and the `--text-faint` token collapse are the same defect
wearing three costumes. All three are **"we know something the surface cannot
express."**

| instance | what we know | what the surface shows |
|---|---|---|
| 22 | this venue was assessed and charges no tax-inclusive fee **vs** nobody ever looked | identical blank |
| 22c / T2.14 | we have a floor and distrust it **vs** upstream sent no floor | identical absent row |
| token collapse | this text is a third-tier annotation **vs** this text is ordinary muted body copy | identical `#6b6960` |

Three in one day is not coincidence, and it is not carelessness — 22c and the
token collapse were both produced by correct decisions. **This project generates
this class structurally.** The reason is in our own rules: they push consistently
toward withholding rather than guessing (no invented rate, no invented input to a
fee model, no relabelling a market as an ask, withhold rather than relabel). Every
one of those rules is right. Every one of them produces a state whose honest
rendering is *nothing* — and nothing already means something to a reader, usually
"we don't have this."

> **A codebase that refuses to guess accumulates states that render as absence.
> Absence is not a neutral output; it is an existing claim with an existing
> meaning. Withholding therefore does not remove a false claim by default — it
> substitutes a quieter one, unless the distinction is designed.**

### Consequence for how this file is read

The catalogue has been treating each entry as a mechanism to avoid. This class
says something different: the defect is the **downstream cost of a rule we intend
to keep**. It cannot be driven to zero by being more careful, only by pairing each
withholding with a designed distinction. So the question belongs in the review
checklist, not in the retrospective:

> For every state where we correctly decline to publish a number: what does the
> seller see, and what else produces that same view?

### Standing detection method

None of the three was found by an assertion. 22 was found by grepping twelve
function bodies; 22c by putting five rendered states on one contact sheet; the
token collapse by computing contrast on two tokens and noticing the hex matched.
The common factor is **comparison across states**, which per-state rigor cannot
reach by construction. The contact sheet is therefore promoted from a nicety to a
required step for any change that adds or removes a rendered state.

---

## Appendix C — instance 25, the stale packet

## 25. A return packet was accurate when written and became wrong by standing still (2026-09-07)

The third review's one blocker — *"the new listing confirmation is still described
as a global profile key"* — was true of the packet and false of the code. The
value stopped being a profile key earlier the same day the packet was read.

**This is a new failure mode for this corpus.** Every prior instance is a claim
that was wrong about the code: an assertion naming a behaviour it never checked, a
comment describing a branch that changed, a stamp outliving its source. This one
was *correct at the moment it was written* and became wrong by the code moving
underneath it. Nobody made an error. The packet froze, the branch did not.

> **A snapshot handed to a reviewer is read as the present tense. Accuracy at
> write time is not a property that survives.**

**Remedy — not "more care in the packet".** Care cannot fix this; the packet was
careful. What is missing is the reader's ability to tell whether they are reading
history:

> **A review request must carry the commit it was written against.** Then a
> reviewer comparing the packet's tip to the branch tip can see for themselves
> whether a described shape is current, and a blocker raised against a stale
> description is identifiable as such before it costs a review cycle.

Applied from `D3_STEP5_THIRD_REVIEW_RESPONSE.md` onward: every packet header
states the commit and branch it describes, and the response states the commit it
was written at. Both were present in this response by luck of format, not by rule.
Now it is a rule.

Cost of the omission here: one review cycle spent on a closed blocker, and a
verdict of "D3 is not ready to close" that was based on it.

---

## Appendix D — T2.14, open defect disclosed in section 3

### T2.14 — the withheld floor row is indistinguishable from having no floor data

Found by the D3 visual pass on `9a3c7ac`, not by any assertion. All 20
width/theme/state combinations render correctly — no overflow, no wrapping, the
dotted leader self-adjusts (497px vs 494px across the two label lengths, floor is
`min-width:1rem` and the narrowest observed was 45px), and the withheld case
leaves no orphan separator because `.qp-row + .qp-row` is sibling-scoped with no
`nth-child` anywhere.

The defect is what the correct rendering means. Compare two states:

| state | what the seller sees |
|---|---|
| low endpoint absent upstream | `Market price  $96.00  TCGPlayer market` |
| low endpoint present, above the median ask, withheld by condition (2) | `Market price  $300.00  TCGPlayer market` |

Identical layout. The seller cannot tell "we have no floor for this card" from
"we have a floor and judged it untrustworthy". **We know which case we are in and
we do not say.**

This is the same shape as instance 24: a suppression justified by a judgement the
user never sees. Condition (2) is still correct — a floor above an observed ask
is not a floor, and printing it was the worse option. But "withhold rather than
relabel" was accepted here on the strength of matching the server's behaviour,
and the server's version has the same gap (Q3-B decided the copy omits the
numeric spread, which is a different question from whether the omission is
announced at all).

**Not fixing this unilaterally.** Any disclosure copy here asserts something
about why the book is inverted, and that is T2.10's subject, which needs a Q7
decision. What is recorded is that the fix as shipped converts a visible
mislabel into an invisible omission, that this is an improvement and not a
closure, and that anyone reading `9a3c7ac` as "the Lowest-listing row is now
honest" is reading it too generously.

**Cross-reference:** recorded as instance **22c** in
`audit/PATTERN_ASSERTION_SURFACE.md` [our defect catalogue — the rule it names is
reproduced as Appendix A above], and the withhold-rather-than-relabel rule
now carries a mandatory rider there — withholding is only complete once the
withheld state is distinguishable from the never-had-it state.

**On the commit record:** `9a3c7ac`'s message does not carry this caveat and has
not been reworded, because the hash is already cited in T2.14 and in the instance
1 addendum, and a reword changes the hash those citations point at. The caveat
instead sits in the code at the render site, which is where a reader who greps
this row actually lands, and in the title of the follow-up commit.

Detection note, generalisable: this was invisible to nine passing behavioural
assertions because every one of them checks a single state in isolation. The
defect is in the **collision between two states**, which only a side-by-side
render shows. Worth asking of any withhold-on-condition fix: does the withheld
state look different from the never-had-it state?

---

## Appendix E — Q3-F, open disclosure gap disclosed in section 3

## Q3-F — the headline is trimmed downward and nothing says so (live, not hypothetical)

T2.13 was filed as a design question about the blend's shape. One half of it is
**not** a pending question — it is a current, undisclosed property of the number
every other figure on the site derives from.

Under today's default the blend admits the low ask 52.18% of the time, where it
pulls the headline down a median 11.01% (in the same direction 97.3% of the
time). Net against a `(mid*2 + market)/3` centre: below in 41.8% of products,
mean **−3.99%**.

**That is a systematic downward adjustment to the published price, applied now,
disclosed nowhere.** Not in the caption, not in the range line, not in the basis
label — which reads `TCGPlayer market` on a rung where, when `marketBasis` is
`'ask_blend'`, no market sale is behind the number at all.

It sits inside Q3's actual subject rather than T2.13's: Q3 asks what the seller
is told about how a number was made. The seller is told the number is TCGplayer
market. On the ask-blend rung it is a mid-anchored trimmed average of the ask
book, adjusted downward by a term the seller cannot see and we have never named.

**Deliberately not proposing copy here.** Both the honest labels depend on
T2.13's outcome, and inventing one now would pin copy to a shape that may change.
What is being recorded is that the disclosure gap exists under the current
default and does not require any change to become real — so it cannot be
deferred as "pending T2.13" without saying out loud that we are shipping an
undisclosed adjustment in the meantime.

Pairs with `marketBasis` already being on the wire: the field that would let a
caption tell the truth here exists and, like `marketAskDivergence`, no client
reads it (instance 24).

---

## Appendix F — the `--text-faint` token comment, quoted in full

Declared at `index.html:100-110` (light) and `:155-161` (dark):

```
/* --text-faint is currently identical to --text-muted in light mode. That is a
   smell and should not survive as a permanent state. It is left standing
   rather than collapsed across 105 references mid-D3, and is logged in
   CSS_TOKEN_DEBT.md as a decision to take deliberately: collapse the tokens,
   or re-cut the neutral ramp so a third tier can exist at AA. Hierarchy at
   these sizes is carried by size, weight and letterspacing anyway -- the
   micro-caps labels read as subordinate without needing to be faint. */
  --text-faint:    #6b6960;
```

```
/* #8d8b82 is the faintest value clearing 4.5:1 on all six. That leaves four
   steps between this and --text-muted (#918f86), so the dark ramp does admit
   a third tier -- barely, and not perceptibly. The light ramp admits none at
   all; see the light-mode note above. */
  --text-faint:    #8d8b82;
```

The dark comment's "four steps… barely, and not perceptibly" is the reason the
dark half of the contrast table should also be read as a compliance result rather
than a hierarchy result.
