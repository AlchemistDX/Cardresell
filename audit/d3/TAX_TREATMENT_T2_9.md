# T2.9 — Venue tax-treatment audit (BIAS-10 remedy, step 1)

**Read 2026-09-08. Fifteen venues. Every finding below is quoted from the raw
text of the venue's own published page**, retrieved this sitting and stored at
`/home/user/workspace/taxaudit/raw/<key>.txt`. Nothing here is quoted from a
comparison site, a summary, or a prior CardResell document.

---

## 0. The three quantities, kept apart

The reviewer's separation is load-bearing and this document holds to it. Three
different numbers get called "tax" and only one of them is what T2.9 is about:

| quantity | what it is | in scope for T2.9? |
|---|---|---|
| **Tax collected / remitted** | Buyer-paid sales tax or VAT the venue collects at checkout and remits to the authority. Passes through; never the seller's money. | **No.** Not modelled, not disclosed as a seller cost. |
| **The amount subject to fees** | The base the venue multiplies its percentage against. May or may not include the tax above. | **Yes. This is the whole question.** |
| **Seller revenue** | What lands in the seller's account: sale − fees. | **No.** Affected only via the middle row. |

A venue can collect tax (row 1) and still not charge fees on it (row 2). eBay
does both; Whatnot's commission does the first without the second while its
processing fee does both. Conflating them is how a false "no tax here" gets
written down.

## 0.1 What `taxOn` asks

> **Does any fee this model charges the seller apply to a base that includes
> buyer-paid sales tax?**

Not *"does the commission"*. The wider question is the correct one because the
disclosure exists to warn the seller that the estimate may be low, and a
tax-inclusive **processing** fee understates the estimate exactly as a
tax-inclusive commission would. Reading only the commission sentence is what
made my first pass record Whatnot as a confirmed zero. It is not one. See §5.

## 0.2 Answer states, and why the basis is a separate field

`taxOn` carries three values, as decided. It is paired with `taxBasis`, which
records **how** the answer was established, because "we read the page and it
says no" and "the page never addresses it" are both spelled `false` if you only
keep the answer.

| `taxOn` | `taxBasis` | meaning |
|---|---|---|
| `true` | `published-inclusive` | The page states the base includes tax. |
| `false` | `published-exclusive` | The page states the base excludes tax, or enumerates the base closed and tax is not in the enumeration. **A confirmed zero.** |
| `false` | `no-seller-fee` | Buylist / direct purchase where **this model applies no separate seller service fee**. The claim is exactly: *no modelled seller service fee has a tax-bearing base.* `taxOn: false` therefore records that there is no fee of ours for a buyer-tax component to sit inside — it does **not** assert that the transaction was untaxed, and it does **not** assert the venue is confirmed to charge no seller fee. **This is a statement about our fee model, not a tax determination and not an external verification of the venue's whole fee schedule.** |
| `'unknown'` | `payment-method` | Policy is published, but the deciding input — how the buyer paid — is not knowable at draft time. |
| `'unknown'` | `unstated` | The published fee page does not address it. |

**`'unknown'` renders the disclosure. It never suppresses it.** Silence on a fee
page is not a zero, and this table is the mechanism that keeps the two apart.

**No tax rate is introduced anywhere in this work.** No venue gets a modelled tax
amount, no universal rate is assumed, and no fee function gains a tax parameter.
The gap closes by disclosure, per the binding rule.

---

## 1. eBay

| | |
|---|---|
| **Published fee base** | "The **total amount of the sale** includes the item price, any handling charges, any shipping costs collected from the buyer (some exceptions apply), **sales tax**, and any other applicable fees." Worked example: "$424 is the total amount of the sale (includes 6% sales tax)", final value fee 13.6% of $424 = $58.06. A second example uses "$10,070 (includes 6% sales tax)". Source: [eBay selling fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822) |
| **Current implementation** | `feeEbay(price, shipCharge, ebayStore, ebayPromo, trsEligible)` — no tax parameter. `items.feeBase = total` where `total = price + shipCharge`. Fee understated $3.18 on eBay's own $400 example, $13.39 on the $10,070 example (BIAS-9). |
| **Missing inputs** | Buyer's ship-to jurisdiction and its rate. Neither exists at draft time or comparison time. |
| **Seller-facing disclosure** | Present today, and only here. `items.taxNote = true` hardcoded in `feeEbay`; renders "Buyer sales tax (not estimated) —". `FEE_DISCLOSURE.estimateNote` names eBay specifically. |
| **Required correction** | `taxOn: true`, `taxBasis: 'published-inclusive'`. Delete the hardcoded line; the disclosure must arrive from the field. **The fee is not to be corrected by modelling a rate** — this is BIAS-9's "cannot be fixed by modelling it, and that is the finding." |

## 2. TCGplayer

| | |
|---|---|
| **Published fee base** | "TCGplayer charges fees based on the subtotal (item amount + shipping cost). **We do not charge fees on taxes for orders paid by debit card.** However, **credit cards and PayPal do include taxes when determining the fee** … (item amount + shipping cost + taxes)." Worked example: commission 10.25% of **Subtotal** $66.30 = $6.80; processing 2.5% + $0.30 of **Order Total** $70.78 = $2.07, where "Order Total = Subtotal + Sales Tax". Sources: [TCGplayer fees](https://help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees), [fee calculation examples](https://help.tcgplayer.com/hc/en-us/articles/360047732673-Fee-Calculation-Examples) |
| **Current implementation** | `feeTCGPlayer(price, shipCharge, tcgLevel)`. `base = price + shipCharge` for both components, and `out.feeBase` is emitted. Commission base **matches** the published subtotal definition. For the processing component the direction of error is **not established in one direction**: against credit card / PayPal our base is **understated** (theirs adds tax); against debit, see the withdrawal below. |
| **Missing inputs** | The buyer's payment method, plus the tax amount. The payment method is not merely unmeasured — it does not exist until checkout, after the draft is written. |
| **Seller-facing disclosure** | Fee base row renders. **No tax row.** The split basis appears nowhere on any surface. |
| **Required correction** | `taxOn: 'unknown'`, `taxBasis: 'payment-method'`. This is not ignorance of the policy — the policy is fully published — it is a genuinely conditional outcome, and the condition resolves after the estimate is made. Renders the disclosure. |


**WITHDRAWN: "the processing base is correct for debit."** The first version of
this document asserted that. It is withdrawn, and it is withdrawn in the
direction that is worse for us, not better.

*The passage is real and I have it.* `taxaudit/raw/tcgplayer.txt:9`, an italic
Note sitting immediately above the Marketplace Fees table on
[TCGplayer's fees article](https://help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees):
"We do not charge fees on taxes for orders paid by debit card. However, credit
cards and PayPal do include taxes when determining the fee." The applicable
configuration is stated only as the buyer's **payment method** — the passage
names no seller tier, no store configuration and no region.

*What I cannot establish is the thing I asserted.* "Correct for debit" requires
knowing that on a debit order TCGplayer charges a 2.5% + $0.30 processing fee on
the tax-exclusive subtotal. The Note establishes only that **taxes are not in
the fee base** for debit.

**REVISED 2026-09-08 (second review).** The reviewer read this as an argument
from the absence of a worked example, and on that reading rejected it —
correctly. Absence of a debit example is not evidence that debit carries no
processing fee, and the earlier text did lean on it. But the reviewer's proposed
replacement is not what the captured page says either, so neither version is
adopted. From the raw text, per the standing rule that enumerated policy is
cited from the page and not from anything that condensed it:

1. **The page never uses the phrase "transaction fee."** Zero occurrences in
   `tcgplayer.txt`. The reviewer's "a transaction fee is charged on each sale …
   marketplace sellers pay 2.5% + $0.30" merges two separate columns.
2. **The 2.5% + $0.30 column is scoped to CC/PayPal by its own header.**
   `tcgplayer.txt:13` reads
   `|Seller Type|Marketplace Commission Fee|Pro Fee|Direct Shipping Replacement Cost|Sync Fee|Domestic CC/Paypal Processing Fee*|`,
   and `:15` puts `2.5%+$.30` in that last column for Level 1–4. The fee charged
   on **every** sale is the Marketplace Commission (`10.25%` on the captured
   page). So the scoping is **affirmative page text**, not an inference from
   silence — which is a stronger basis than the version that was rejected.
3. **The Note's own rationale points the same way:** the processing amount "is
   used to cover the added processing costs for **those payment methods**"
   (`:9`), i.e. credit cards and PayPal.
4. **But the reviewer has a real textual counter, and it survives.** "We do not
   charge fees on taxes for orders paid by debit card" presupposes that *some*
   fee applies to debit orders. That is satisfied by the commission alone, so it
   does not establish that the processing line applies to debit — but it does
   block any claim that debit orders are fee-free.

*Result: the published text is genuinely ambiguous on one point* — whether the
CC/PayPal-headed processing line applies to debit at all. Both readings are
textual, neither is refuted by the capture, and **no source in hand resolves it.**
So it stays an **open item, not a finding**, and nothing is published as
established in either direction. What is now recorded is the ambiguity itself,
with both readings and their line cites, rather than a one-sided hypothesis.

*Stated against the decision boundary, not as a number.* The two readings differ
by exactly the processing line: on a $100 item that is `2.5% + $0.30 = $2.80`,
against a commission of `$10.75` — roughly a fifth of the modelled fee total. It
is therefore large enough to matter to ranking near a tie, and **no ranking
effect has been ruled out** (§16). Our model charges the processing line on 100%
of orders, so if the CC/PayPal scoping is the correct reading we **overstate** on
debit orders while **understating** on credit-card orders through the tax base —
opposite directions on one venue, resolved by a payment method that does not
exist until checkout. That is precisely why the classification is
`taxOn: 'unknown'`, `taxBasis: 'payment-method'` and why the warning renders.

*Not actioned in code.* No fee-model change follows from an unresolved ambiguity,
and the standing rule forbids inventing an input to a fee model. Resolving it
needs a debit-path source TCGplayer has not published; the alternative is a
seller-reported debit invoice, which is evidence we do not have.

*Reproducibility note.* The reviewer's own fetch of the fees article did not
return this Note. Rather than commit the full pages, the capture is now reduced
to `audit/d3/sources/taxaudit/PROVENANCE.md` — source URL, retrieval timestamp,
SHA-256 and byte count of the original, plus pinned verbatim excerpts for every
line an audit document cites by number (`:9`, `:13`, `:15` here). See §19.

## 3. Poshmark

| | |
|---|---|
| **Published fee base** | Not obtainable. Terms of Service defers: fees are "as set forth in our **Fee Policy** (which is incorporated by reference)". `poshmark.com/fee_policy` resolves back to the Terms of Service, which does not enumerate the base. `poshmark.com/fees`, `poshmark.com/help/1` and two `support.poshmark.com` articles all returned client errors. The only published figures are the rate: "20% seller fee for sales over $15 and $2.95 for sales $15 and under" ([Poshmark ToS notice](https://poshmark.com/terms), [Poshmark blog](https://blog.poshmark.com/2024/10/21/returning-to-original-fees/)). The ToS confirms tax is **collected** — "Poshmark will collect from Buyers on behalf of Sellers where legally obligated" — which is quantity 1, not quantity 2. |
| **Current implementation** | `feePoshmark(price)` — takes price alone. Flat $2.95 under $15, else 20% of price. No `feeBase`, no tax row. |
| **Missing inputs** | The published base itself, before any tax question. |
| **Seller-facing disclosure** | None of either kind. |
| **Required correction** | `taxOn: 'unknown'`, `taxBasis: 'unstated'`. Renders the disclosure. Poshmark carries the **highest rate in the venue set**, so an unstated base here is the single largest unquantified magnitude exposure — BIAS-10 measured Poshmark as the most flattered venue at $4.80 on a $400 card at 6%. |

## 4. COMC

| | |
|---|---|
| **Published fee base** | "Fixed-price sales, whether sold on the COMC platform or via eBay have a flat **5% transaction fee of the item's sale price**." ([COMC commission fees](https://comc.zendesk.com/hc/en-us/articles/360053737993-What-are-the-commission-fees)) Tax is not mentioned. The `/Sell` page is JavaScript-gated and its raw text carries no fee schedule at all. |
| **Current implementation** | `feeCOMC(price, service, isGraded, cashout)` — 5% of price, plus submission fee, $5 ship-in, 10% cash-out and a $1 under-$250 surcharge. No `feeBase`, no tax row. |
| **Missing inputs** | Whether "sale price" is gross or net of tax. Additionally, COMC lists into its own eBay consignment store, where eBay's tax-inclusive FVF is **COMC's** cost, not the seller's — so eBay's rule does not transfer here, and that non-transfer must not be read either way. |
| **Seller-facing disclosure** | None. |
| **Required correction** | `taxOn: 'unknown'`, `taxBasis: 'unstated'`. Renders the disclosure. |

## 5. Whatnot — corrected during this audit

| | |
|---|---|
| **Published fee base** | **Split, and explicitly so.** Commission: "a charge calculated as a percentage of the **final price** … The final price refers to the price the item sold for to the buyer, **which does not include shipping or taxes**." Payment processing: "a charge calculated as a percentage of the **total order value** of a transaction. This includes the **final price of the item sold plus shipping and buyer-paid tax**." ([Whatnot seller fees](https://help.whatnot.com/hc/en-us/articles/4847069165965-Whatnot-Seller-Fees-and-Commissions-Schedule)) |
| **Current implementation** | `feeWhatnot(price, shipCharge)` — commission `min(price,1500) × 8%` (correct, tax-exclusive by policy); processing `(price + shipCharge) × 2.9% + $0.30`, **which omits buyer-paid tax that the published base includes**. The code comment above the function already records this: "We do not model buyer-paid tax anywhere in this engine." |
| **Missing inputs** | The tax amount, for the processing component only. |
| **Seller-facing disclosure** | None. The line item is labelled "Payment processing (2.9% + $0.30 of item + shipping)" — accurate about what we compute, silent about what Whatnot charges. |
| **Required correction** | `taxOn: **true**`, `taxBasis: 'published-inclusive'`. |

**This entry is a correction to my own step-1 finding.** My first pass read the
commission sentence, recorded Whatnot as `false` / confirmed zero, and moved on.
The processing-fee sentence three paragraphs later says the opposite about the
other half of the same schedule. Two consequences worth keeping:

1. It is the direct evidence for the `taxOn` definition in §0.1. Had the field
   been defined as "does the commission apply to a tax-inclusive total", Whatnot
   would have been recorded as a confirmed zero **on a true reading of the wrong
   sentence** — the worst available outcome, because a confirmed zero suppresses
   the disclosure permanently and nothing would ever have re-opened it.
2. The fact was **already in the codebase**, in a comment, and had been since the
   2026-09-01 fee-truth pass. It was invisible to this audit until the page was
   re-read, because a comment is not a field. That is pattern instance 22
   demonstrating itself inside the work filed to remedy it.

## 6. Mercari

| | |
|---|---|
| **Published fee base** | "**10% Selling fee** — 10% of the **item price + buyer-paid shipping**". The same page defines a different (now-retired) fee tax-inclusively: the pre-2025 buyer Payment Processing Fee was "2.9% of the transaction price (**includes the item price, shipping, service fee and sales tax**)". ([Mercari selling fees](https://www.mercari.com/us/help_center/article/169/)) |
| **Current implementation** | `feeMercari(price, shipCharge)` — `(price + shipCharge) × 10%`, single line item. Matches the published base exactly. No processing fee exists for sellers after Jan 6 2025, so there is no second component to test. |
| **Missing inputs** | None. |
| **Seller-facing disclosure** | No fee-base row, no tax row. The base is right and unstated. |
| **Required correction** | `taxOn: false`, `taxBasis: 'published-exclusive'`. **A confirmed zero.** The enumeration is closed, and the strength of the reading is that the same document uses "includes … sales tax" when it means that — so its absence from the 10% base is a contrast within one page, not an argument from silence. Disclosure correctly suppressed. |

## 7. Mana Pool

| | |
|---|---|
| **Published fee base** | Marketplace fee: "5% of the price of the merchandise", and "the fee is **not applied to shipping charges, only the price of the product**". Credit card fees: "We charge Stripe's credit card fees (2.9% + 30 cents as of 12-7-23) … we charge $0.30 per seller, per order." ([Mana Pool fees](https://support.manapool.com/hc/en-us/articles/21779686206615-Fees-Mana-Pool-and-Credit-Card-Fees)) **The page states the marketplace base precisely and says nothing about the processing base.** |
| **Current implementation** | `feeManaPool(price, shipCharge)` — marketplace `price × 5%` (correct), processing `(price + shipCharge) × 2.9% + $0.30`. |
| **Missing inputs** | The processing fee's base. Stripe bills the amount actually charged, which at a taxed checkout includes tax — but Mana Pool does not say so, and inferring it from how Stripe generally works would be exactly the invented input the binding rule forbids. |
| **Seller-facing disclosure** | None. |
| **Required correction** | `taxOn: 'unknown'`, `taxBasis: 'unstated'`. Renders the disclosure. **Deliberately not `false`.** The marketplace component is a clean published exclusion, but §0.1 asks about *any* fee, and the processing component is unaddressed — this is structurally the Whatnot case with the second sentence missing. |

## 8. Cardsphere

| | |
|---|---|
| **Published fee base** | Not published. The Terms address tax only as the user's own liability — "You are responsible for paying any import taxes or duties" under a "Taxes and Duties" heading — which is neither of the three quantities in §0. ([Cardsphere terms](https://www.cardsphere.com/terms)) No fee-base statement for the 3% seller fee or the 10% cashout exists in the raw text. |
| **Current implementation** | `feeCardsphere(price)` — `price × 3%` seller fee, plus 10% PayPal cashout on the net. Price only; shipping is not a parameter. |
| **Missing inputs** | The base for both components. |
| **Seller-facing disclosure** | None. |
| **Required correction** | `taxOn: 'unknown'`, `taxBasis: 'unstated'`. Renders the disclosure. |

## 9. Cardmarket

| | |
|---|---|
| **Published fee base** | "Selling — **5% of the article value per article sold**", "Currency Conversion Fee 3%", and a footnote that applies to the fee table as a whole: "**All prices are inclusive of VAT**", with "Professional sellers from EU countries outside Germany with a valid EU VAT ID do not pay VAT." ([Cardmarket fees](https://www.cardmarket.com/en/Policies/Fees)) |
| **Current implementation** | `feeCardmarket(price, shipCharge)` — `price × 5%` capped ≈ $110, plus `(price + shipCharge) × 3%` currency conversion. |
| **Missing inputs** | Whether "article value" is the VAT-inclusive displayed price. **Note that "all prices are inclusive of VAT" is a statement about Cardmarket's own fees carrying VAT — a tax on the fee — not about VAT being inside the base.** Reading it as the latter would be a category error between quantity 1 and quantity 2. |
| **Seller-facing disclosure** | None. |
| **Required correction** | `taxOn: 'unknown'`, `taxBasis: 'unstated'`. Renders the disclosure. This is the venue where the disclosure copy fits worst — the label says "Buyer sales tax" and the regime is VAT, where EU displayed prices are conventionally gross, the opposite default from US sales tax. Recorded as an open copy question in §12 rather than silently resolved. |

## 10. Card Kingdom · 11. CoolStuffInc · 12. Star City Games — the no-seller-fee buylists

**These three, and NOT TCG Bulk.** My first pass put all four in one class on the
strength of a structural argument — "the venue is the buyer, so there is no buyer
checkout, so there is no buyer tax." The reviewer rejected that argument, and
TCG Bulk is the venue that shows why: its own terms say it **does not take legal
title** and **is not the seller or buyer**. It is an intermediary. The structural
premise is false there, and once it is false for one member it cannot be the
thing that defines the class. TCG Bulk is therefore split out into §13 below and
recorded `'unknown'`.

What survives for these three is narrower, and the scope must be kept exact.
**The supported claim is:**

> No modelled seller service fee has a tax-bearing base.

**Not:** "the venue is confirmed to charge no seller fee." That second sentence is
an external-verification claim about the venue's entire fee schedule, and only
CoolStuffInc and SCG have affirmative language approaching it. Card Kingdom does
not, and must not inherit their strength — see the per-venue row below. This is
also why **"excluded" is the right word and "confirmed zero" was not**; the older
phrase is retired everywhere (§16).

| | |
|---|---|
| **Published fee base** | Card Kingdom: "Payments for cards are done by a percentage system based on the **NM buy price** for a card"; the seller ships in and is paid by check, PayPal or store credit ([Card Kingdom](https://www.cardkingdom.com/purchasing/how_to_sell)). CoolStuffInc: "**no fees on any collections**", "you receive the full value for your cards without any deductions" ([CoolStuffInc](https://www.coolstuffinc.com/main_fullservice_selllist.php)). SCG Sell List: "**Pay no Service Fees**" ([Star City Games](https://sellyourcards.starcitygames.com/)). |
| **Current implementation** | All three route through `feeBuylist(price, ratio, serviceFeePct)` (`js/core.9f0f6b30.js:8035`) and pass **no** `serviceFeePct`. The "fee" they display is the retail-to-offer haircut, not a charge. |
| **Strength of the evidence, per venue** | CoolStuffInc and SCG publish an affirmative "no fees" / "pay no Service Fees" sentence. **Card Kingdom does not.** Its page states a buy-price percentage and never says the word fee either way — an A-2 pattern (absence of a fee, or a fee never checked for). Card Kingdom's `false` therefore rests on weaker evidence than the other two, and that difference is recorded here rather than averaged away. |
| **Missing inputs** | For the **fee** question: none for CoolStuffInc and SCG; Card Kingdom is A-2. For the **tax** question: not answered, and not claimed to be. |
| **Seller-facing disclosure** | No tax row. `venueTaxNote` returns `null` when `taxOn === false` (`js/core.9f0f6b30.js:6746`). |
| **Required correction** | `taxOn: false`, `taxBasis: 'no-seller-fee'` (`js/core.9f0f6b30.js:6438, 6452, 6472`). |

**What `false` means here, stated precisely.** It means: *no seller service fee
is published, so there is no fee of ours for a buyer-tax component to be charged
on.* It does **not** mean the transaction carried no tax, and it does not mean
anyone confirmed a zero. "Confirmed zero" has been withdrawn as a description of
this class — in this document, in `accuracy.html`, and in the published summary.
A historical blank cannot be retrospectively declared a confirmed zero.

**Why the suppression is still correct.** Our estimate charges these venues no
service fee. A disclosure whose subject is "a fee we charge you may be charged on
buyer-paid tax" has no referent when there is no fee. The row is suppressed
because the *question does not arise*, not because the answer is known to be
zero.

**COMC and Fanatics are deliberately not in this class.** Both require shipping
cards in, which makes them *feel* like buylists, but both are **consignment**: a
third-party buyer checks out and the seller's proceeds derive from that buyer's
payment. Both are recorded `'unknown'` above.

## 13. TCG Bulk — split out, and unknown

| | |
|---|---|
| **Published fee base** | "a **10% TCG Bulk service fee** applies to **the transaction** and is deducted from the **Seller's proceeds**" (`taxaudit/raw/tcgbulk.txt:117`, [TCG Bulk terms](https://tcgbulk.com/page/terms-of-service)). A separate optional 3.5% shipment protection, capped at USD 200 (`:125`). |
| **Why it is not a buylist** | Same terms, `:9`: TCG Bulk "**does not take legal title to the Products and is not the seller or buyer**". The structural argument that carried §10–12 does not apply. |
| **Missing inputs** | **"The transaction" is never composed anywhere in the document.** It is not enumerated, no worked example decomposes it, and no sentence states whether it includes tax or shipping. So the 10% fee's base is unknown, and whether buyer-paid tax sits inside it is unknown. |
| **Current implementation** | `feeBuylist(...)` with `serviceFeePct = 0.10` — a real seller charge, unlike §10–12. |
| **Seller-facing disclosure** | Tax row renders in the **unestablished** state: *Buyer sales tax (treatment not established)*. |
| **Required correction** | `taxOn: 'unknown'`, `taxBasis: 'unstated'` (`js/core.9f0f6b30.js:6544`). |

## 14. CardNexus

| | |
|---|---|
| **Published fee base** | "Sellers pay a commission on each order they fulfill: 5% in Europe and 8% in North America. The fee is calculated on the **order total (items + shipping)**", and separately "**The 'order total' includes the item subtotal and the shipping cost.**" Worked example: €55 of cards + €5 shipping → €60 × 5% = €3.00. The buyer-side 2.5% + $0.30 is not a seller cost. ([CardNexus fee structure](https://help.cardnexus.com/articles/9938652-fee-structure-overview), [selling FAQ](https://help.cardnexus.com/articles/1754380-selling-faq)) |
| **Current implementation** | `feeCardNexus(price, shipCharge)` — `(price + shipCharge) × 8%`, single line item. Matches. |
| **Missing inputs** | None. |
| **Seller-facing disclosure** | No fee-base row, no tax row. |
| **Required correction** | `taxOn: false`, `taxBasis: 'published-exclusive'`. **A confirmed zero** — the page defines "order total" as a closed two-item enumeration, in a sentence written specifically to define it, and the only seller-side fee uses that base. The tax language elsewhere on the page ("tax compliance requirements" as a justification for the 8% North America rate) is about CardNexus's operating cost, not about the base, and is not read as evidence either way. |

## 15. Fanatics Collect

| | |
|---|---|
| **Published fee base** | "The Buy Now marketplace features a **seller's fee that's a percentage of the sale price of your listing**. … All cards listed less than 120% of the market value provided by Card Ladder have a seller's fee of just 6%." Auctions: "There are no fees to sell graded collectibles in Weekly or Premier Auctions." ([Fanatics Collect selling](https://support.fanaticscollect.com/en_us/selling-on-fanatics-collect-Byq2QAQpel), [Buy Now fees](https://support.fanaticscollect.com/en_us/buy-now-fees-ry33QCXaxe)) Tax appears nowhere in the raw text of either page. |
| **Current implementation** | `feeFanatics(price)` — 6% default tier, plus a $5 inbound-ship line. Price only. |
| **Missing inputs** | Whether "sale price of your listing" is gross or net of tax. |
| **Seller-facing disclosure** | None. |
| **Required correction** | `taxOn: 'unknown'`, `taxBasis: 'unstated'`. Renders the disclosure. |

---

## 16. Result

| `taxOn` | count | venues |
|---|---|---|
| `true` | **2** | eBay, Whatnot |
| `false` | **5** | Mercari, CardNexus (`published-exclusive`) · Card Kingdom, CoolStuffInc, Star City Games (`no-seller-fee`) |
| `'unknown'` | **8** | TCGplayer (payment-method) · Poshmark, COMC, Mana Pool, Cardsphere, Cardmarket, Fanatics Collect, **TCG Bulk** (unstated) |

**The disclosure goes from 1 venue to 10 of 15.** It is suppressed on 5, every
one of them for a recorded reason that can be re-opened by grep — and on three of
those five the reason is "no seller fee exists here", not "tax was confirmed
absent".

**BIAS-10's own counts are stale and are corrected here, not rewritten
elsewhere.** The finding was filed against a 12-venue set and its text says
"one of twelve", "eleven venues" and "ten venues" in three places. The set is
now 15, and the pre-fix disclosure coverage was **1 of 15**. The magnitude
argument is unaffected — it never depended on the count.

**What this result does and does not license, restated after review.** Eight
venues are `'unknown'`. An unknown treatment cannot support a confirmed
magnitude or a confirmed direction, so the following three narrowings apply
everywhere this audit is summarised:

1. **`taxOn: true` establishes policy inclusion, not a positive omitted amount on
   every transaction.** eBay and Whatnot include buyer tax in a published fee
   base; on an order where no buyer tax applies, the omitted amount is zero. The
   supportable phrasing is *"may understate fees when buyer-paid tax applies"* —
   not "understates fees".
2. **No net direction is claimed across the venue set.** TCGplayer alone may run
   in **both** directions depending on the buyer's payment method (§2). A signed
   total requires the unknowns to be resolved, and they are not.
3. **No ranking effect has been ruled out.** Different corrections across venues
   can change the ordering near a tie, and this work did not test for that. The
   earlier statement that ranking was unaffected is withdrawn; the honest
   statement is that the ranking question is **open and untested**.

## 17. The stamp — `feeAuditedOn` is NOT bumped

T2.9 step 2 says to bump `feeAuditedOn` "because step 1 is a real re-audit."
The same section's closing line says "**Do not bump `feeAuditedOn` for a
tax-only check**", and `DISCLOSURE_PARITY_Q3.md` § "The stamp: one date or two?"
resolves it: "do not bump `feeAuditedOn` without actually re-reading. Bumping it
to cover a tax-only check would stamp a schedule re-verification that did not
happen."

**Resolved explicitly: the stamp is not bumped.** Step 2's conditional was not
met. I re-read all fifteen pages, but I extracted and verified **the tax window
only** — I did not re-verify a single fee rate, cap, tier or fixed charge against
the page. That is a tax-only check by the definition that matters, whatever the
retrieval covered. `feeAuditedOn` is published on `accuracy.html` as "Last
verified" for the *schedule*; bumping it would publish a claim this work does not
support.

**Consequence, stated so it cannot be lost:** the fee re-audit remains due, on
its own clock. All 15 stamps stay at `2026-09-01`.

**Corrected dates.** The first version of this section said amber `2026-10-01`
and stale `2026-10-16`. That was wrong, and the reviewer's correction is
adopted. `feeAuditAgeDays` (`js/core.9f0f6b30.js:6686`) floors a `Date.UTC`
difference, and the thresholds are strict: stale at `> 45`, amber at `> 30`. A
2026-09-01 stamp reaches age 30 on 2026-10-01 — which is **not** `> 30` — so it
turns **amber on 2026-10-02** and **stale on 2026-10-17**. And per the one-date decision, **no `taxCheckedOn` field is
added**; a second date earns its place only if a venue publishes tax treatment
somewhere other than its fee schedule, which none of these fifteen does.

## 18. Open, and not closed by this work

- **TCGplayer and Whatnot both have split bases**, and `taxOn` is one value per
  venue. The field answers §0.1's question correctly for both, but it cannot
  express *which component*. Adequate for the disclosure, which is a warning and
  not a calculation. It would not be adequate for anything that computed from it
  — and nothing may, because of the binding rule.
- **The Cardmarket copy mismatch — now CLOSED by this revision.** "Buyer sales
  tax" was the wrong noun for a VAT regime. Cardmarket now carries
  `taxNoun: 'Buyer VAT'` (`js/core.9f0f6b30.js:6406`) and its standing note is
  VAT-appropriate. Critically, the note does **not** imply that a
  VAT-inclusive price needs another tax amount added on top: it says only that
  the published schedule *does not establish* whether VAT forms part of any fee
  base.
- **Disclosure is not completeness.** The seller-facing note opens by conceding
  that showing the caveat does not make the estimate arithmetically complete. A
  warning names today's missing inputs; it does not supply them.
- **`feeBase` / `feeBaseLabel` still emit on 2 venues of 15** (eBay, TCGplayer).
  That is BIAS-10's *other* half and T2.9 does not cover it. Thirteen venues
  continue to show a fee total with no stated base. **Explicitly still open.**
- **TCG Bulk's fee base against the vendor** — open before this audit, open
  after it, and now the reason §13 is `'unknown'` rather than `false`.
- **Does a TCGplayer processing fee exist at all on debit orders?** See the
  withdrawal in §2. Possible **overstatement**, unresolved, no source either way.
- **Card Kingdom is A-2.** Its `false` rests on the absence of a fee statement
  rather than on an affirmative "no fees" sentence, unlike CoolStuffInc and SCG.
- **Poshmark's base is unobtainable from published text**, not merely
  tax-silent. Five URLs attempted; the Fee Policy is incorporated by reference
  and does not resolve to a distinct page.

---

*All quotations retrieved 2026-09-08 from the raw text of the linked pages.
Raw captures: `/home/user/workspace/taxaudit/raw/`.*

---

## 19. Sources — reduced, not committed in full

An earlier revision of this work committed complete text captures of all 25
external pages (2,569,243 bytes) under `audit/d3/sources/taxaudit/`. **They were
removed before any push.** The reasons given on review are correct and are not
argued with: full vendor pages carry copyright exposure, add permanent
repository weight, and create a maintenance burden for content that is mostly
unrelated to any fee finding.

What replaces them, in `audit/d3/sources/taxaudit/`:

| File | Contents |
|---|---|
| `PROVENANCE.md` | Per capture: source URL, retrieval timestamp (UTC), SHA-256 and byte count of the original, and the minimal verbatim excerpt carrying the fee-base or tax statement. |
| `manifest.json` | The same metadata, machine-readable. |
| *(generator)* | `tools/reduce-captures.py` — the reduction is reproducible, not hand-curated. |

Four properties worth stating, because each was a way this could have gone
wrong:

1. **Excerpts are a filter, not a summary.** Every retained line is verbatim
   from the capture. Selection is a keyword match minus navigation boilerplate.
   No line was rewritten, condensed or paraphrased — which is the standing rule
   for enumerated policy.
2. **Lines cited by number are pinned.** `tcgplayer.txt:9, :13, :15` and
   `tcgbulk.txt:9, :117, :125` are retained in full, exempt from truncation and
   from the per-page cap, so this reduction cannot silently break a citation
   that already exists. Line numbers are positions in the **original** capture,
   so existing cites still resolve against the recorded hash.
3. **The hash is what makes an excerpt checkable.** It anchors each excerpt to
   the byte stream it came from, so a future reader can confirm an excerpt is
   faithful to a capture they no longer have — which was the whole reason the
   full pages were committed in the first place.
4. **Final redirected URL is `Unverified` for every row.** It was not recorded
   at capture time and cannot be recovered from the stored bytes. Re-fetching
   today would record *today's* redirect, not the one that applied at capture
   time, so the field is left unestablished rather than backfilled — per the
   standing rule that the repo writes **Unverified** where it cannot establish
   a fact.

**This is now part of the required local history cleanup, not separate from it.**
`git rm` removes the files from the working tree and the index, but the blobs
remain reachable from commit `6011b67` on `phase1-block-d`, which has never been
pushed. So the 2.6 MB is still in local history and **must be dropped by the
same rewrite that handles the credential scrub**, not by a follow-up commit.
Tracked in `audit/TODO_PHASE1.md`.
