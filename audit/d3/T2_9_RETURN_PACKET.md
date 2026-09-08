# T2.9 / BIAS-10 — Return packet, revision 4

**Revision 4** applies three consistency corrections requested on revision 3:
the debit conclusion is now stated once and identically in §0/§1/§3/§8, the
tested artifact is identified by content hash, and the capture description
matches what is actually in the tree. No new audit work; amounts, disclosures
and calculations are unchanged.

**Scope of revision 3:** the **two blocking corrections** from the second
review — the TCGplayer debit conclusion (§1, §9) and the raw-page captures
(§9, and §19 of the tax document) — plus the accepted refinements to
buylist wording, the eBay sentence, and the labelling of non-eBay rendered
states. Revision 2's resolution of the original six rejections is retained. Nothing was pushed and nothing was deployed. `D3`, `BIAS-1` and
`BIAS-6` remain closed and untouched.

## The artifact these results were measured against

Revision 2's bundle name was retained in error while the production copy and
TRS-gating changes were made. Resolved:

| | |
|---|---|
| Commit under review | `0c759cd` |
| Bundle `index.html` resolved at that commit | `js/core.59d4b1ab.js` |
| **SHA-256[:8] of those bytes** | **`9f0f6b30`** — the name was stale, the bytes are the tested ones |
| Live bundle name today | `js/core.9f0f6b30.js` (21,491 lines), **byte-identical** to the above (`diff` clean) |
| Retired name | `js/core.59d4b1ab.js` retained in-tree with its **own** `6011b67` bytes |

So the focused results below were measured against the bytes now called
`core.9f0f6b30.js`, and every `:NNNN` citation in this packet resolves against
them unchanged. **No committed immutable bundle was overwritten:** the rename
copied the edited bytes to their true content address and restored the retired
name's own bytes, because `vercel.json:47` serves `/js/*.<8hex>.js` as
`immutable` for a year. Full record in `audit/BUNDLE_RENAME_9f0f6b30.md`;
mechanism in `audit/PATTERN_ASSERTION_SURFACE.md` instance 38.

I did not detect this myself. A read-only snapshot tool reported
`filenameMatchesBytes: false`, and our own `tests/asset-fingerprints.mjs` — which
I had not run, because I selected suites by what I changed semantically rather
than by the fact that a bundle file had changed — then failed 14/1.

**Suites, run individually (`tests/run-all.sh` not run):**

| Suite | Result |
|---|---|
| `tests/review-fee-dl.mjs` | **21 passed, 0 failed** |
| `tests/draft-review-screen.mjs` | **180 passed, 0 failed** |
| `tests/accuracy-fee-parity.mjs` | **41 passed, 0 failed** |
| `tests/asset-fingerprints.mjs` | **15 passed, 0 failed** (added after the miss above) |

**The `19` in revision 2's copy of this table was stale, not a second run.**
`review-fee-dl` was 19 before the TRS gate; registering `venueTrsNote` as
behaviour added 2 checks, and §6 correctly reported 21. The summary table was
not updated with the body. 21/0 is the count against the `9f0f6b30` bytes.

---

## 0. The six rejections, and what each one cost

| # | Your finding | Disposition |
|---|---|---|
| R1 | TCGplayer debit exception unreconciled | **Claim withdrawn, and no replacement claim is made.** Our two retrievals of the fee page return different text, so debit-specific processing treatment is unresolved. No fee-model change follows (§1) |
| R2 | "No buyer checkout" is not a tax exemption | **Class dissolved.** TCG Bulk split out to `'unknown'`; the other three re-grounded on a fee finding, not a tax finding; `no-buyer-tax` and "confirmed zero" retired (§2) |
| R3 | Unknown treatment cannot support magnitude or direction | **Three statements narrowed**, including withdrawing the claim that ranking was unaffected (§3) |
| R4 | Wording must be state-appropriate; the helper cannot supply the explanation | **New `venueEstimateNote(pid)`.** Surfaced a latent defect of my own in the process (§4) |
| R5 | Amber/stale dates wrong | **You are correct.** Oct 2 / Oct 17, verified against the floor and the strict thresholds (§5) |
| R6 | Helper returning `true` ≠ rendered output | **Claim withdrawn.** Suites run, three states rendered and shown (§6) |

---

## 1. R1 — TCGplayer: the claim is withdrawn, and our two retrievals disagree

**Finding: the retrieved versions of the fee page disagree. Debit-specific
processing treatment remains unresolved. No fee-model change follows.**

Revision 3 framed this as two readings of one text. That was wrong, and your
fresh retrieval is why. We are not reading the same page.

**What both retrievals agree on.** A `2.5% + $.30` figure sits on the
Marketplace Seller (Level 1–4) row. Neither of us disputes the row, the tier, or
the amount.

**What they disagree on.** The column heading, which is the only thing that
scopes that figure to a payment method.

| | Your retrieval | My capture (2026-09-08T13:39:17Z, SHA-256 `1d2aa480…`) |
|---|---|---|
| Column heading | **Transaction Fee** | **`Domestic CC/Paypal Processing Fee*`** (line 13) |
| Occurrences of "transaction fee" | present | **0** (case-insensitive, whole file) |

**Why the disagreement is the whole question.** Under your heading the fee is
unconditional and our 100%-of-orders model is right. Under mine it is scoped to
credit card and PayPal, and the debit case is unaddressed. The heading decides
it, and the heading is what moved.

**I am not asserting my capture is the correct one.** It is 2,824 bytes of
markdown-converted text and could be a partial or variant rendering; a page can
also be edited between two same-day fetches, or served differently by region or
account context. I have no basis to rank the two retrievals, and the earlier
version of this section which argued from *my* text toward a possible
**overstatement on debit** is withdrawn — that argument required treating one
retrieval as authoritative, which is exactly what is in dispute.

**The Note is in my capture and is not itself contested** (`tcgplayer.txt:9`,
[TCGplayer fees](https://help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees)):

> *Note: TCGplayer charges fees based on the subtotal (item amount + shipping
> cost). We do not charge fees on taxes for orders paid by debit card. However,
> credit cards and PayPal do include taxes when determining the fee …*

It establishes that taxes are outside the base on debit. It does not settle
whether a processing fee applies on debit, and neither retrieval supplies a
debit worked example — all eight in
`audit/d3/sources/taxaudit/tcgplayer_examples.txt` are credit card or PayPal.

**No fee-model change.** `taxOn: 'unknown'`, `taxBasis: 'payment-method'`
(`js/core.9f0f6b30.js:6312`) is unchanged and remains the correct record for a
conditional that resolves at checkout, after the draft is written. Recorded as
an open item with **no direction stated**. Resolving it needs a retrieval both
parties can pin — a dated archival snapshot, or TCGplayer confirming the current
heading — not a third reading by either of us.

---

## 2. R2 — the buylist class was an argument, not evidence

You were right, and TCG Bulk is the venue that proves it.

**TCG Bulk's own terms contradict the premise.**
`audit/d3/sources/taxaudit/tcgbulk.txt:9` — TCG Bulk "**does not take legal title
to the Products and is not the seller or buyer**". My justification was "the
venue is the buyer, so there is no buyer checkout, so there is no buyer tax."
That is false for TCG Bulk by its own text. Once the premise fails for one
member it cannot define the class.

**TCG Bulk is split out and reclassified `'unknown'`** (`js/core.9f0f6b30.js:6544`,
`taxBasis: 'unstated'`). Its 10% service fee is real and applies "to **the
transaction**" (`tcgbulk.txt:117`) — and **"the transaction" is never composed
anywhere in the document**: not enumerated, no worked example, no sentence
saying whether it includes tax or shipping. So both the base and the tax question
are unknown. Its tax row now renders.

**The other three keep `false`, on a narrower and better-evidenced footing.**
Card Kingdom, CoolStuffInc and SCG are `taxBasis: 'no-seller-fee'`
(`js/core.9f0f6b30.js:6438, 6452, 6472`). All three pass **no** `serviceFeePct`
into `feeBuylist(price, ratio, serviceFeePct)` (`js/core.9f0f6b30.js:8035`), so
our estimate charges them no service fee at all.

This is your distinction, adopted as written: **a supported finding that no
seller service fee exists answers the model-specific fee question without making
a sweeping tax claim.** `false` here means *there is no fee of ours for a
buyer-tax component to sit inside*. It does **not** mean the transaction was
untaxed. The suppression is correct because the **question does not arise**, not
because the answer is a known zero.

**Evidence strength differs across the three, and is recorded rather than
averaged.** CoolStuffInc ("no fees on any collections") and SCG ("Pay no Service
Fees") publish affirmative sentences. **Card Kingdom does not** — its page states
a buy-price percentage and never uses the word fee either way. That is an A-2
pattern (absent, or never checked for), and Card Kingdom's `false` is explicitly
weaker than the other two.

**Retired vocabulary.** `no-buyer-tax` no longer exists in the codebase.
**"Confirmed zero" is withdrawn** as a description of this class in
`audit/d3/TAX_TREATMENT_T2_9.md`, in `accuracy.html`, and in the published
summary — `accuracy.html` now carries a paragraph headed **"'Excluded' does not
mean the buyer paid no tax"** stating the retraction on the page itself. A
historical blank cannot be retrospectively declared a confirmed zero.

**"Confirmed zero" survives only for `published-exclusive`** (Mercari, CardNexus),
where a closed enumeration in a sentence written to define the base is the
evidence.

**Your point about the test is accepted.** The suite restricting allowed
`taxBasis` strings enforces vocabulary consistency; it has never been evidence
that a classification is true. It was not cited as such here.

**Counts after reclassification:** `true` **2** (eBay, Whatnot) · `false` **5**
(Mercari, CardNexus `published-exclusive`; CK, CSI, SCG `no-seller-fee`) ·
`'unknown'` **8**. **The tax row renders on 10 of 15 venues**, up from 1.

---

## 3. R3 — three statements narrowed

Adopted as three standing constraints, written into
`audit/d3/TAX_TREATMENT_T2_9.md` §16 and into `accuracy.html` prose:

1. **`taxOn: true` establishes policy inclusion, not a positive omitted amount on
   every transaction.** On an order with no buyer tax the omitted amount is zero.
   The published phrasing is now your wording verbatim: **"may understate fees
   when buyer-paid tax applies."**
2. **No net direction is claimed across the venue set.** §1 above is the reason —
   TCGplayer's debit treatment is unresolved between two retrievals, so its
   contribution is not signed. A signed total needs the unknowns resolved.
3. **No ranking effect has been ruled out.** My earlier statement that ranking was
   unaffected is **withdrawn**. Different corrections across venues can change
   ordering near a tie, and this work did not test for it. The ranking question
   is open and untested, and is now written that way.

---

## 4. R4 — state-appropriate wording, and a defect your instruction uncovered

You were right that a shared helper can decide **whether** to warn but cannot
**supply the explanation**. Carrying that out found a live defect of mine.

**The defect.** `FEE_DISCLOSURE.estimateNote` was one constant, emitted
unconditionally under the review screen's breakdown, and its text **named eBay**
and described eBay's base. Every assertion on it passed, because the review
screen is pinned to `ebay:fixed-price`. It was right **only by scope**. The
moment D4 shows a second venue, it prints *"eBay charges its fee on the total
sale"* directly beneath a row reading *"Buyer VAT (treatment not established)"*.
Latent, not live. Logged as instance 36 in `audit/PATTERN_ASSERTION_SURFACE.md`.

**The remedy.** `estimateNote` → `estimateStem` (`js/core.9f0f6b30.js:7486`) plus
**`venueEstimateNote(pid)`** (`js/core.9f0f6b30.js:6774`), wired at the render
site (`js/core.9f0f6b30.js:21370`). Three states:

**Known-inclusive** (eBay):

> An estimate, not a payout. This estimate calculates fees on the item price
> only. eBay calculates its fee from the total sale, including buyer-paid
> shipping and sales tax; neither is included in this estimate. When buyer sales
> tax applies — or when shipping changes the seller's costs — the final proceeds
> may differ.

**Adopted from your revision, including the reason.** The sentence was
grammatically unclear and it also **claimed a direction it could not support**:
it named two omissions, buyer-paid tax and buyer-paid shipping, then closed with
"may be lower." Those two do not share a direction — a buyer's shipping payment
and the seller's postage cost move proceeds opposite ways — so "lower" was true
of the tax half only. `proceeds may differ` is the honest close.

That cost four test assertions, each coupled to the old wording. Three were
re-pointed; one was **withdrawn rather than re-pointed**, because its premise
went with the copy: `draft-review-screen`'s *"the note states the direction of
the error"* asserted `/may be lower/i`, and there is no longer a single
direction to state. It is replaced by an assertion that the note names both
omissions and commits to **no** direction, and each change carries an inline
`USED TO ASSERT` note recording the old text and why it moved.

**Unestablished** (Cardmarket, VAT-appropriate):

> An estimate, not a payout. This estimate calculates fees on the item price
> only. Cardmarket's published fee schedule does not establish whether buyer VAT
> forms part of any fee base, so we cannot say whether this estimate is complete
> on that point.

Note what this deliberately does **not** say: it does not imply that a
VAT-inclusive transaction needs another tax amount added. It says only that the
schedule does not establish whether VAT sits in a fee base. Cardmarket also now
carries `taxNoun: 'Buyer VAT'` (`js/core.9f0f6b30.js:6406`), closing the copy
mismatch that was previously listed as open.

**Excluded** (Card Kingdom): the stem alone, no second sentence, no tax row.

**"Never by modelling" is withdrawn** as too broad. The disclosure now opens by
conceding that **showing the caveat does not make the estimate arithmetically
complete** — it names today's missing inputs and does not supply them.

**Two further defects surfaced only in the rendered sentence.** `.toLowerCase()`
flattened "Buyer VAT" to "buyer vat"; and "charges its fee" overstated Whatnot,
whose commission excludes tax and whose **payment processing** fee alone uses the
inclusive total. Both fixed and both now asserted on the rendered string.

**One regression, recorded rather than quietly fixed.** Replacing the constant
dropped **buyer-paid shipping** from eBay's sentence — a second real omission the
screen had disclosed since D3. `tests/draft-review-screen.mjs` caught it (2
failures). Restored via per-venue `taxBaseName` / `taxBaseIncludes` /
`taxBaseFeeName`, so each venue uses its **own published term** ("total sale" is
eBay's; "total order value" is Whatnot's) rather than a paraphrase neither
published.

---

## 5. R5 — your dates are correct, mine were wrong

`feeAuditAgeDays` (`js/core.9f0f6b30.js:6686`) floors a `Date.UTC` difference.
Thresholds are strict: **stale `> 45`**, **amber `> 30`**. A `2026-09-01` stamp
is age 30 on 2026-10-01, which is not `> 30`.

**Amber 2026-10-02. Stale 2026-10-17.** Not Oct 1 / Oct 16. Corrected in the
audit doc. **`feeAuditedOn` stays unchanged** at `2026-09-01` on all 15 venues —
this was a tax-only check and bumping the stamp would publish a schedule
re-verification that did not happen.

---

## 6. R6 — rendered, not asserted from a return value

**The byte-identical claim is withdrawn.** You are right: executing the helper
and obtaining `true` establishes what the helper returns, not what the screen
emits. `audit/PATTERN_ASSERTION_SURFACE.md` instance 35 has been corrected in
place to say so — it was itself an instance of the pattern that page documents.

**Suites run individually:** `review-fee-dl` 21/21 · `draft-review-screen`
180/180 · `accuracy-fee-parity` 41/41.

**Rendered states, read from the emitted markup. Three of the four are
simulated renderer states, not customer-reachable screens.** The production
review screen remains pinned to `ebay:fixed-price`, so only the eBay row is
currently reachable by a customer. The Cardmarket, TCG Bulk and Card Kingdom
rows are produced by driving the real renderer with a venue id it will not
receive in production until D4's multi-venue review screen exists. They are
evidence that the renderer branches correctly — nothing more. **This packet does
not claim a multi-venue review screen exists.**

| Venue | Reachability | State | Emitted row |
|---|---|---|---|
| eBay | **reachable in production** | known-inclusive | `<dt class="review-fee-label" data-fee-row="tax-included">Buyer sales tax <span class="review-fee-qual">(not estimated)</span></dt>` |
| Cardmarket | *simulated renderer state* | unknown | `<dt class="review-fee-label" data-fee-row="tax-unestablished">Buyer VAT <span class="review-fee-qual">(treatment not established)</span></dt>` |
| TCG Bulk | *simulated renderer state* | unknown | `<dt class="review-fee-label" data-fee-row="tax-unestablished">Buyer sales tax <span class="review-fee-qual">(treatment not established)</span></dt>` |
| Card Kingdom | *simulated renderer state* | excluded | *(no row emitted)* |

---

## 7. A vacuous assertion this work created, disclosed

Renaming `estimateNote` → `estimateStem` left `tests/review-fee-dl.mjs:208`
reading a property that no longer exists. `!/--/.test(undefined)` stringifies to
`"undefined"`, which contains no double hyphen, so **the assertion passed on
nothing** for the length of this sitting. It never went red, which is why it
needs saying out loud.

It now reads every state the seller can be shown, asserts the set is non-empty so
it cannot pass on nothing again, and carries a `USED TO ASSERT` comment recording
the old text and why it changed. Four assertions were added around it: known
inclusion concedes an omission while unestablished does not; no non-eBay note
describes eBay's base; acronyms survive splicing; Whatnot names the processing
fee.

The offline renderer `tools/review-fee-dl-render.mjs` also had to be taught the
new helper (`fnSource('venueEstimateNote')` + the `new Function` binding), or the
suite would have failed to construct rather than failed to assert.

---

## 8. Still open — not closed by this work

- **TCGplayer debit processing treatment is unresolved (§1).** Two same-day
  retrievals of the fee page disagree on the heading that scopes the
  2.5% + $0.30 column. Direction of any error is **not stated**, because the
  scope question is what would determine it. No fee-model change.
- **`feeBase` / `feeBaseLabel` still emit on 2 of 15** (eBay, TCGplayer) —
  BIAS-10's other half, untouched by T2.9. Thirteen venues show a fee total with
  no stated base, split-basis venues cannot express which component, and **no
  ranking effect has been ruled out**.
- **TCG Bulk's fee base against the vendor** — "the transaction" never composed.
- **Card Kingdom A-2** — `false` on absence, not on an affirmative statement.
- **Poshmark's base is unobtainable from published text.** Five URLs; the Fee
  Policy is incorporated by reference and does not resolve to a distinct page.
- **Push and deployment remain blocked.** Cert ID rotation is not done.

---

## 9. The two blocking corrections, and what is next

**Blocking 1 — TCGplayer.** Your epistemic point is accepted and the
absence-of-a-worked-example argument is gone. Your *reading* of the fee table is
not adopted, because the captured page contradicts it on two checkable points:
the page contains **zero** occurrences of "transaction fee", and the 2.5% + $0.30
column is headed **"Domestic CC/Paypal Processing Fee\*"** by the page itself
(`tcgplayer.txt:13`, `:15`). The fee charged on every sale is the Marketplace
Commission. Your counter-point survives too: "we do not charge fees on taxes for
orders paid by debit card" does presuppose *some* fee on debit — satisfied by the
commission alone. So §1 now records an **unresolved two-reading ambiguity in the
published text**, quoting both with line cites, expressed against the decision
boundary (the disputed processing line is ≈ $2.80 on a $100 item against $10.75
of commission, roughly a fifth of the fee total). `taxOn: 'unknown'` /
`taxBasis: 'payment-method'` are preserved, and the warning still renders. No
fee-model change follows from an unresolved ambiguity.

**Blocking 2 — the captures are not being pushed.** 2,569,243 bytes across 25
files, reduced to **52 KB**: `PROVENANCE.md` + `manifest.json` carrying source
URL, retrieval timestamp, SHA-256 and byte count of each original, plus minimal
verbatim excerpts, generated reproducibly by `tools/reduce-captures.py`.
Lines cited by number are **pinned** — retained in full, exempt from truncation
and the per-page cap — so the reduction cannot break an existing citation.
Final redirected URL is **Unverified** on every row: it was not recorded at
capture time, and re-fetching would record today's redirect, not that one.
**Tree versus history, stated plainly** — §1 and Sources previously described
the full captures as committed evidence and are now corrected:

| Where | What is there now |
|---|---|
| Working tree / `HEAD` | `PROVENANCE.md` + `manifest.json` only (~52 KB). **No `*.txt` captures.** |
| Unpushed history (`6011b67`) | The 25 full captures remain reachable as blobs. `git rm` cleared tree and index, not history. |
| Outside the repo | Originals retained at a local path, unversioned. |
| `origin/main` | Nothing. 158 commits outgoing, none pushed. |

**Your correction accepted, and it changes the plan.** Private evidence
retention and public redistribution are different questions, and revision 3
conflated them by folding "drop the captures from `6011b67`" into the required
history rewrite. Those blobs are unpushed and private; they are not a
redistribution event. **That item is withdrawn — no additional history rewriting
is planned or authorized on this account**, and `audit/TODO_PHASE1.md` has been
corrected accordingly. The pre-existing rewrite obligation is unrelated and
unchanged.

**Pinned lines meet your condition: original numbering is preserved, not
remapped.** Each excerpt block is headed *"line numbers from the original
capture"* and every line carries its original number as a literal prefix, so
`tcgplayer.txt:9` resolves to the line numbered `9`:

```
  9: *Note: TCGplayer charges fees based on the subtotal (item amount + shipping cost). We do not charge fees on taxes …*
 13: |Seller Type|Marketplace Commission Fee|Pro Fee|…|Domestic CC/Paypal Processing Fee*|
 15: |Marketplace Seller (Level 1-4 Account)|10.25%|N/A|N/A|N/A|2.5%+$.30|
```

Numbering is against the original capture, whose SHA-256 is recorded per file,
so a quotation stays checkable against the bytes it came from. Nothing has been
pushed. See §19 of the tax document.

**Also applied:** the no-seller-fee scope is now exactly *"no modelled seller
service fee has a tax-bearing base"* — never "the venue is confirmed to charge no
seller fee"; Card Kingdom stays **A-2** and does not inherit CoolStuffInc's and
SCG's strength; "excluded" replaces "confirmed zero" throughout; the Whatnot note
still names the payment-**processing** fee specifically; and the three non-eBay
rows are labelled **simulated renderer states** (§6).

**One new defect, found by your own R4 method.** Applying "render the non-eBay
states" a second time surfaced the row **directly below** the one R4 named:
`trsWithheldLabel` and `trsWithheldNote` were emitted unconditionally, so
Cardmarket and TCG Bulk printed *"Top Rated Plus discount (not applied)"* plus
eBay's handling-time and US-residency copy. Fixed behind `trsProgram: true` on
eBay's `PLATFORMS` entry and a new `venueTrsNote(pid)`, which deliberately fails
**closed with no row** — the opposite of `venueTaxNote` — because asserting a
venue runs a discount programme it does not run is a false claim, whereas
silence on tax implies false completeness. Registered as behaviour: suite 19 →
21. Logged as instance **37**; the page header also said "35 instances" while 36
was filed below it, and that is corrected.

**Next, per your item 6:** T2.10 `midBasis`. `api/tcg-price.js:290` emits
`mid: r.mid ?? displayMarket` with `marketBasis`/`lowBasis`/`highBasis` but **no
`midBasis`**, while the fallback path at `:367` does set it — the two paths
disagree, and the client copies the other three but not `midBasis`. The work is
scoped to your constraints: carry `midBasis` on the main path, **do not** make
the low/high range gate depend on mid, label any derived mid a **calculated
reference** rather than a median observed ask, test main/fallback parity, and
check **T2.14 separately** because a derived midpoint currently influences
whether a provider low is withheld.

---

## Sources

All quotations retrieved 2026-09-08. **What is in the tree is a provenance
record, not the full captures** — see §9 and the note below.

- eBay — https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822
- TCGplayer fees — https://help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees
- TCGplayer fee examples — https://help.tcgplayer.com/hc/en-us/articles/360047732673-Fee-Calculation-Examples
- Whatnot — https://help.whatnot.com/hc/en-us/articles/4847069165965-Whatnot-Seller-Fees-and-Commissions-Schedule
- Mercari — https://www.mercari.com/us/help_center/article/169/
- COMC — https://comc.zendesk.com/hc/en-us/articles/360053737993-What-are-the-commission-fees
- Mana Pool — https://support.manapool.com/hc/en-us/articles/21779686206615-Fees-Mana-Pool-and-Credit-Card-Fees
- Cardsphere — https://www.cardsphere.com/terms
- Cardmarket — https://www.cardmarket.com/en/Policies/Fees
- CardNexus — https://help.cardnexus.com/articles/9938652-fee-structure-overview · https://help.cardnexus.com/articles/1754380-selling-faq
- Fanatics Collect — https://support.fanaticscollect.com/en_us/selling-on-fanatics-collect-Byq2QAQpel · https://support.fanaticscollect.com/en_us/buy-now-fees-ry33QCXaxe
- Card Kingdom — https://www.cardkingdom.com/purchasing/how_to_sell
- CoolStuffInc — https://www.coolstuffinc.com/main_fullservice_selllist.php
- Star City Games — https://sellyourcards.starcitygames.com/
- TCG Bulk — https://tcgbulk.com/page/terms-of-service
- Poshmark — https://poshmark.com/terms · https://blog.poshmark.com/2024/10/21/returning-to-original-fees/
