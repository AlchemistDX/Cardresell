# T2.9 / BIAS-10 — Return packet, revision 2

**Scope of this revision:** the six rejections in the last review, resolved
against code. Nothing was pushed and nothing was deployed. `D3`, `BIAS-1` and
`BIAS-6` remain closed and untouched.

**Live bundle: `js/core.59d4b1ab.js` (21,491 lines).** Every line citation below
was re-derived against that file after the rename. The superseded revision cited
`core.2c7cf451.js`; the offset between them is recorded in
`audit/BUNDLE_CITATION_MAP.md`.

**Suites, run individually (`tests/run-all.sh` not run):**

| Suite | Result |
|---|---|
| `tests/review-fee-dl.mjs` | **19 passed, 0 failed** |
| `tests/draft-review-screen.mjs` | **180 passed, 0 failed** |
| `tests/accuracy-fee-parity.mjs` | **41 passed, 0 failed** |

---

## 0. The six rejections, and what each one cost

| # | Your finding | Disposition |
|---|---|---|
| R1 | TCGplayer debit exception unreconciled | **Claim withdrawn.** Passage located and quoted; the assertion it was supposed to support is now an open item running in the *opposite* direction (§1) |
| R2 | "No buyer checkout" is not a tax exemption | **Class dissolved.** TCG Bulk split out to `'unknown'`; the other three re-grounded on a fee finding, not a tax finding; `no-buyer-tax` and "confirmed zero" retired (§2) |
| R3 | Unknown treatment cannot support magnitude or direction | **Three statements narrowed**, including withdrawing the claim that ranking was unaffected (§3) |
| R4 | Wording must be state-appropriate; the helper cannot supply the explanation | **New `venueEstimateNote(pid)`.** Surfaced a latent defect of my own in the process (§4) |
| R5 | Amber/stale dates wrong | **You are correct.** Oct 2 / Oct 17, verified against the floor and the strict thresholds (§5) |
| R6 | Helper returning `true` ≠ rendered output | **Claim withdrawn.** Suites run, three states rendered and shown (§6) |

---

## 1. R1 — TCGplayer: the claim is withdrawn, and it fails toward overstatement

**The passage is real and I have it.** `audit/d3/sources/taxaudit/tcgplayer.txt:9`
— an italic Note directly above the Marketplace Fees table on
[TCGplayer's fees article](https://help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees):

> *Note: TCGplayer charges fees based on the subtotal (item amount + shipping
> cost). We do not charge fees on taxes for orders paid by debit card. However,
> credit cards and PayPal do include taxes when determining the fee …*

**Applicable configuration:** the buyer's **payment method**, and nothing else.
The passage names no seller tier, no store configuration, no region.

**What I cannot establish is precisely what I asserted.** "The processing base is
correct for debit" requires knowing that a debit order carries a 2.5% + $0.30
processing fee computed on the tax-exclusive subtotal. The Note establishes only
that **taxes are not in the base** on debit. It does not establish that the
processing fee **exists** on debit orders. **All eight worked configurations** in
`audit/d3/sources/taxaudit/tcgplayer_examples.txt` are credit card or PayPal.
There is no debit worked example in either capture.

**Our model charges 2.5% + $0.30 on 100% of orders.** So if debit orders carry no
processing fee, we **overstate** TCGplayer fees on every debit order — the
opposite direction from the credit-card case, on the same venue. Expressed
against the boundary rather than as a number: **TCGplayer's error is not signed**,
because the sign depends on a payment method that does not exist until checkout,
after the draft is written.

Recorded as an **open item, not a finding**. Neither branch is published.
`taxOn: 'unknown'`, `taxBasis: 'payment-method'` (`js/core.59d4b1ab.js:6312`) is
unchanged and is the correct record for a conditional that resolves after we
estimate.

**Reproducibility.** Your fetch of that article did not return the Note. The 25
raw captures are therefore now **committed to the repo** at
`audit/d3/sources/taxaudit/` (2.6 MB), so every quotation in this packet can be
checked against the bytes I read rather than against a re-fetch.

---

## 2. R2 — the buylist class was an argument, not evidence

You were right, and TCG Bulk is the venue that proves it.

**TCG Bulk's own terms contradict the premise.**
`audit/d3/sources/taxaudit/tcgbulk.txt:9` — TCG Bulk "**does not take legal title
to the Products and is not the seller or buyer**". My justification was "the
venue is the buyer, so there is no buyer checkout, so there is no buyer tax."
That is false for TCG Bulk by its own text. Once the premise fails for one
member it cannot define the class.

**TCG Bulk is split out and reclassified `'unknown'`** (`js/core.59d4b1ab.js:6544`,
`taxBasis: 'unstated'`). Its 10% service fee is real and applies "to **the
transaction**" (`tcgbulk.txt:117`) — and **"the transaction" is never composed
anywhere in the document**: not enumerated, no worked example, no sentence
saying whether it includes tax or shipping. So both the base and the tax question
are unknown. Its tax row now renders.

**The other three keep `false`, on a narrower and better-evidenced footing.**
Card Kingdom, CoolStuffInc and SCG are `taxBasis: 'no-seller-fee'`
(`js/core.59d4b1ab.js:6438, 6452, 6472`). All three pass **no** `serviceFeePct`
into `feeBuylist(price, ratio, serviceFeePct)` (`js/core.59d4b1ab.js:8035`), so
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
   TCGplayer alone may run in both directions. A signed total needs the unknowns
   resolved.
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

**The remedy.** `estimateNote` → `estimateStem` (`js/core.59d4b1ab.js:7486`) plus
**`venueEstimateNote(pid)`** (`js/core.59d4b1ab.js:6774`), wired at the render
site (`js/core.59d4b1ab.js:21370`). Three states:

**Known-inclusive** (eBay):

> An estimate, not a payout. This estimate calculates fees on the item price
> only. eBay charges its fee on the total sale, which includes buyer-paid
> shipping and buyer sales tax and this estimate excludes, so on an order where
> buyer sales tax applies your actual proceeds may be lower.

**Unestablished** (Cardmarket, VAT-appropriate):

> An estimate, not a payout. This estimate calculates fees on the item price
> only. Cardmarket's published fee schedule does not establish whether buyer VAT
> forms part of any fee base, so we cannot say whether this estimate is complete
> on that point.

Note what this deliberately does **not** say: it does not imply that a
VAT-inclusive transaction needs another tax amount added. It says only that the
schedule does not establish whether VAT sits in a fee base. Cardmarket also now
carries `taxNoun: 'Buyer VAT'` (`js/core.59d4b1ab.js:6406`), closing the copy
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

`feeAuditAgeDays` (`js/core.59d4b1ab.js:6686`) floors a `Date.UTC` difference.
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

**Suites run individually:** `review-fee-dl` 19/19 · `draft-review-screen`
180/180 · `accuracy-fee-parity` 41/41.

**Rendered states, read from the emitted markup:**

| Venue | State | Emitted row |
|---|---|---|
| eBay | known-inclusive | `<dt class="review-fee-label" data-fee-row="tax-included">Buyer sales tax <span class="review-fee-qual">(not estimated)</span></dt>` |
| Cardmarket | unknown | `<dt class="review-fee-label" data-fee-row="tax-unestablished">Buyer VAT <span class="review-fee-qual">(treatment not established)</span></dt>` |
| TCG Bulk | unknown | `<dt class="review-fee-label" data-fee-row="tax-unestablished">Buyer sales tax <span class="review-fee-qual">(treatment not established)</span></dt>` |
| Card Kingdom | excluded | *(no row emitted)* |

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

- **Does a TCGplayer processing fee exist on debit orders at all?** §1. Possible
  **overstatement**. No source either way.
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

## 9. Next, per your instruction

T2.10 proceeds **against live code**: trace the current server-to-client price
values before investigating anything. If synthesis has returned, that is a
regression and gets reported as one. Otherwise the `$255` example and its derived
threshold are marked **historical**. **Q7 is not reopened and the deleted
`market × 0.85` mechanism is not investigated.**

---

## Sources

All quotations retrieved 2026-09-08. Raw captures committed at
`audit/d3/sources/taxaudit/`.

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
