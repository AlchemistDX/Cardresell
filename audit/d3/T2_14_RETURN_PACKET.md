# T2.14 — Fee-row term/value semantics

**Tip this was written against:** `45cdbcf` · bundle `js/core.7f9c03ad.js` sha256 `24cd52cb5fe08f8b…`
**Commits:** `b956c10` (the change) · `c7bccb2` (measured mutation results) · `45cdbcf` (pattern instance 28)
**Nothing pushed.** `origin/main` is still `9aaf326`. The push gate is unchanged and unmet.

---

## 1. Which surface needed conversion

You asked me to confirm this before changing anything, because an earlier packet already reported a `<dl>` change and you did not want completed work redone. That instruction was correct and it changed what I built.

**The review screen was already converted.** `_reviewFeesHtml` emits `<dl class="review-fees-table">`, and both row helpers — `_reviewFeeRow` and `_reviewBasisRow` — already emitted `<dt>`/`<dd>`. That is the completed work the earlier packet described. **I did not touch the conversion.**

**A second surface still uses `div`/`span`:** `_platTileHtml`'s fee recipe, in the ranking tiles (`js/core.7f9c03ad.js`, grep `class="fee-row"`). It is a different screen, out of D3's scope, and **not converted**. Recorded so it is not mistaken for done.

**So the real gap was not markup.** It was that one fee row did not exist as a row at all:

The withheld Top Rated Plus discount existed **only as a prose note** below the total (`data-fee-trs="withheld"`). A seller scanning the breakdown for what eBay charges saw no line for the discount, and a screen reader reached the disclosure only after the total. That is exactly the case the corpus already named — *"every time you correctly refuse to give a number a worse name, you create a state that renders as absence, and absence already has a meaning."* On this surface an absent row means **the venue has no such fee**. We were rendering a deliberate withholding using the vocabulary of a non-existent one.

## 2. What changed

Four edits, all in `js/core.7f9c03ad.js` and `index.html`. **No amount, disclosure wording, or calculation changed** — verified by `accuracy-fee-parity` (17/17) and by the amounts in §4 being identical before and after.

1. **`_reviewBasisRow(label, qualifier, amount, kind)`** — added an optional fourth parameter defaulting to `'basis'`. Extended, not duplicated: rule 1, one business behaviour, one implementation.
2. **`FEE_DISCLOSURE.trsWithheldLabel` / `trsWithheldQualifier`** — `'Top Rated Plus discount'` / `'not applied'`, with a comment recording T2.14, the Q-A vocabulary, why `$0.00` would be a claim, and the never-had limitation in §5.
3. **The row itself**, inserted between the fee rows and the net row in the priced branch. It reuses the tax row's existing em-dash-plus-qualifier mechanism rather than inventing a second one.
4. **A CSS scoping bug this exposed** (`index.html`): `.review-fee-amount[data-fee-row="basis"]{color:var(--text-muted)}` was scoped to `basis` alone, so the new withheld em dash rendered at full `--text` weight while the tax row's identical em dash was muted. Two visually identical non-values would have had different emphasis. Added the `withheld` selector.

### Two defects the accessibility check found, which the visual check could not

**The qualifier had no space.** `.review-fee-qual{margin-left:5px}` supplied the gap on screen, so the row looked right in every screenshot. But margin is not text: the **accessible name** computed to `"Fee base(item)"`, `"Buyer sales tax(not estimated)"`, `"Top Rated Plus discount(not applied)"`. Added a literal space in the markup and reduced the margin `5px → 1px` so the visual gap is unchanged. `_platTileHtml`'s equivalent row has always carried that space; the review screen had drifted without it.

This is the concrete answer to your instruction that element presence alone does not establish usable announcements. The elements were present and correctly paired *before* this packet; the announcement was still wrong.

**Seller-facing copy contained literal `--`.** The withheld note read `"qualifying -- same- or 1-business-day handling"`. Visible in `audit/d3/ax-fee-priced-light.png`. Changed to em dashes. Typography only; no word, number or disclosure altered. Two assertions now guard it, because this codebase uses `--` in comments constantly and the copy sits inside a comment-dense region.

## 3. Focused accessibility evidence

Chrome DevTools Protocol `Accessibility.getFullAXTree`, at 720px, four cases. Full output: `audit/d3/FEE_DL_AX_EVIDENCE.md`. Tool: `tools/review-fee-ax-check.mjs`.

| Case | `<dl>` children | Alternation + kind match | AX term/definition nodes |
|---|---|---|---|
| priced · light | 14 | **PASS** | 15 |
| priced · dark | 14 | **PASS** | 15 |
| unpriced · light | 4 | **PASS** | 5 |
| unpriced · dark | 4 | **PASS** | 5 |

**Reading order and announced names, priced (from the AX tree, not the DOM):**

```
DescriptionList
term       — "Item price"
definition   → StaticText "$40.00"
term       — "Fee base (item)"
definition   → StaticText "$40.00"
term       — "Buyer sales tax (not estimated)"
definition   → StaticText "—"
term       — "Final Value Fee (13.25% trading cards)"
definition   → StaticText "−$5.30"
term       — "Per-order fee"
definition   → StaticText "−$0.40"
term       — "Top Rated Plus discount (not applied)"
definition   → StaticText "—"
term       — "Estimated net (item only)"
definition   → StaticText "$34.30"
```

**On the empty `name` of each `definition`.** I checked this specifically rather than reporting the roles and stopping. `definition` nodes compute an empty accessible *name* — correct per spec, `dd` is not named from its contents — so the roles alone would not have told us whether the amounts are announced. Each `definition`'s **child `StaticText`** carries the value, shown above. That is what establishes the amount is reachable: term announced from the name, value announced from content.

**Computed colours** (contrast intent preserved across the new row):

- light: tax `rgb(107,105,96)` · withheld `rgb(107,105,96)` · net `rgb(24,22,15)`
- dark: tax `rgb(145,143,134)` · withheld `rgb(145,143,134)` · net `rgb(212,210,204)`

Withheld matches tax exactly and differs from net in both themes — the two non-values are styled alike, and neither is styled like a real figure. This is the check that would have caught the CSS bug in §2.4 had it existed before.

**Visual, 720px, both themes:** `audit/d3/ax-fee-{priced,unpriced}-{light,dark}.png`. No wrap, overflow or truncation on any row; the longest term, `"Final Value Fee (13.25% trading cards)"`, fits on one line at 720px in both themes.

## 4. Executed test results

Executed, not inferred. Nothing else was run — in particular **`tests/run-all.sh` was not run**, it reaches production.

| Suite | Result |
|---|---|
| `node tests/review-fee-dl.mjs` (new) | **15 passed, 0 failed** |
| `node tests/accuracy-fee-parity.mjs` | **17 passed, 0 failed** |
| `node --check js/core.7f9c03ad.js` | passes |

`tests/review-fee-dl.mjs` asserts the term/value contract, the withheld pair and its stated non-value, the qualifier's literal space, the unpriced skeleton, and the copy vocabulary. It has a negative control first: the renderer slices its template out of the production bundle by marker, so a moved marker yields an empty string and every structural assertion would otherwise pass over nothing.

**Rendered priced amounts, `$40.00`, no store, not Top Rated** — unchanged by this work: gross `$40.00` · fee base `$40.00` · tax `—` · FVF `−$5.30` · per-order `−$0.40` · **withheld `—`** · net `$34.30`.

### Mutation evidence

Three mutations against `b956c10`, each reverted, bundle verified byte-identical (`24cd52cb5fe08f8b`) afterwards:

| Mutation | Result | Which assertions |
|---|---|---|
| delete the withheld row | 12 / **3 failed** | the three withheld checks, only those |
| `dt`/`dd` → `div`/`span` | 12 / **3 failed** | alternation, withheld pair, **and the qualifier floor** |
| remove the literal space | 14 / **1 failed** | exactly the space check |

The third failure in row two is the negative control firing: it reported `"0 qualifier terms found (floor 2)"`. Without it, the space assertion downstream would have passed over an empty set and reported ok on markup containing no `dt` at all.

### An invalid first run, and why you are reading about it

The first execution of those three mutations produced different numbers, which I believed for several minutes. The loop reverted with `git checkout js/core.7f9c03ad.js` while **the T2.14 edits were still uncommitted**. So iteration one's revert removed the mutation *and the feature*. Iterations two and three then reported failures that were the feature's absence, not the mutation's effect — and reported *more* failures than expected, which reads like a thorough guard rather than a missing subject. The tell was one unexplained extra failure in a copy-vocabulary assertion that neither mutation touches.

The work was reapplied, **committed**, and the mutations re-run; the table above is the valid run. Both runs are recorded in the test file's header comment. Filed as **pattern instance 28** in `audit/PATTERN_ASSERTION_SURFACE.md`: *mutation testing requires something to revert to; a revert command inside a verification loop is a destructive operation wearing a verification's clothing.* The precondition was invisible in the technique — every prior mutation in this corpus happened to run against committed code, so what made the practice safe was never part of what got adopted.

## 5. What this does not establish

- **T2.14's never-had arm is unverifiable on this surface.** Q-A's contract has two arms: withheld renders as a present pair with a stated non-value; never-had renders as no pair. Only the withheld arm is asserted. This screen models exactly one slot (`CR_REVIEW_FEE_SLOT = 'ebay:fixed-price'`) and refuses every other, so **no venue here lacks a Top Rated program**. The contract is half-covered by construction. The second half needs a second modelled venue, and I have not written a test that pretends otherwise.
- **The unpriced state omits the withheld pair.** Stating it rather than glossing it: unpriced renders only the gross and net skeleton pairs. It also omits the tax row and every fee row, so the state reads as a skeleton rather than as a claim that this venue has no discount. That reasoning is now an explicit assertion in the suite rather than an inference from a missing check — but it is a judgement, and if you read the skeleton differently it should change.
- **`_platTileHtml` is still `div`/`span`.** Out of D3 scope, unconverted, tracked.
- **This closes a guard increment, not release readiness.** 15/15 and 17/17 are two suites. Neither is a full-suite run, and the clean-checkout safe local suite run with an executed/skipped inventory is still open.
- **Amount correctness is not in scope here.** This suite asserts that whatever the model produced is announced as a term and a value in the right order. A green run says nothing about the arithmetic; the BIAS work and `fee-truth-offline` own that.

## 6. Next, in order

1. **Bundle rename** — D3's last action, per the standing decision. `asset-fingerprints` goes 14/1 → 15/0 at the rename.
2. **BIAS-1** after the rename — route `renderGradingUpside` through `feeEbay`, which closes BIAS-3, -7 and -8 with it.
3. Clean-checkout safe local suite run with an executed/skipped inventory.
4. Credential hygiene: inventory labels, and rewrite the earlier partial commit-message disclosure before any push.

## Sources

- [eBay Top Rated Program](https://www.ebay.com/sellercenter/protections/top-rated-program) — the qualification conditions the withheld note paraphrases: same- or 1-business-day handling, US-resident seller, not local-pickup-only.
- [eBay selling fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822) — the 13.25% trading-card rate and the per-order fee.
- [WCAG 2.2 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) — the standard the computed-colour check is measured against.
