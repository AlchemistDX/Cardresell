# T2.9 / BIAS-10 — venue tax-treatment audit: return packet

**Date:** 2026-09-08 · **Local commits:** `251f3a0` (audit + implementation), `79dc1bd` (duplicate-surface follow-up)
**Live bundle at the time of writing:** `js/core.2c7cf451.js`, 21,353 lines. Every `file:line` below is against that file unless another path is named.
**Nothing has been pushed or deployed.** The Cert ID is still unrotated, so the push gate is closed. This packet is a code-and-evidence review request, not a release request.

This document is self-contained. All source quotations, all counts, all citations and all test results needed to check it are inside it.

---

## 0. Your five instructions, and where each is answered

| Instruction | Where |
|---|---|
| "one table per venue covering the published fee base, current implementation, missing inputs, seller-facing disclosure and required correction" | § 3, fifteen venues. "Required correction" now also records the correction **as applied**, with the line it landed on. |
| "Keep tax collected/remitted, the amount subject to fees, and seller revenue separate" | § 1. The separation is load-bearing in three of the fifteen readings (Poshmark, Cardmarket, Cardsphere) and is called out in each. |
| "Unknown tax must remain distinguishable from confirmed zero" | § 2. Two field values, not one: `taxOn` carries the answer, `taxBasis` carries **how the answer was reached**, so a zero can be re-opened by grep. A test rejects `taxOn: false` on any basis that does not establish a zero. |
| "do not introduce a guessed universal tax rate" | No tax rate exists anywhere in this work. No fee function gained a tax parameter. § 4.4 states what was deliberately *not* built and why the gap closes by disclosure. |
| "For T2.10, establish whether the compared figures describe the same condition, variant, currency, measurement type and time window before explaining their disagreement" | Not started. T2.9 is the whole of this packet. § 9 records the T2.10 entry conditions so they are not lost. |

---

## 1. The three quantities, kept apart

These get conflated on venue help pages constantly, and conflating them is how a fee model acquires an invented input. They are separate throughout.

| # | Quantity | Whose money | Does this work touch it? |
|---|---|---|---|
| 1 | **Tax collected and remitted** — what the buyer pays in sales tax, and who sends it to the state | The buyer's money, passing through a marketplace facilitator | **No.** Every US venue here is a marketplace facilitator and remits directly. Not the seller's liability, not modelled, not displayed. |
| 2 | **The amount subject to fees** — the base the venue multiplies its rate against | Determines the seller's cost | **This is the only question T2.9 asks.** |
| 3 | **Seller revenue** — proceeds after fees | The seller's money | Downstream of quantity 2, and wrong whenever quantity 2 is wrong. |

**Why the separation is not pedantry.** Three venues publish a sentence about tax that answers quantity 1 and looks like it answers quantity 2:

- **Poshmark** — "Poshmark will collect from Buyers on behalf of Sellers where legally obligated." That is quantity 1. It says nothing about the 20% fee's base.
- **Cardmarket** — "All prices are inclusive of VAT" in the fee table footnote. That is VAT charged **on Cardmarket's own fee** — a tax on the fee, quantity 1 territory — not VAT sitting inside the base. Reading it as the latter is a category error, and it is the single easiest wrong answer in this set.
- **Cardsphere** — "You are responsible for paying any import taxes or duties." Neither of the three; it is the seller's own liability on a different transaction.

All three are recorded `'unknown'`. None was resolved by the tax sentence it happens to contain.

---

## 2. The field, and why "unknown" needed a second column

### 2.1 What `taxOn` asks

> **Does any fee this model charges the seller apply to a base that includes buyer-paid sales tax?**

The scope word is **any**, not "the commission". That wording is a direct consequence of the Whatnot finding in § 3.6: Whatnot's commission excludes tax and its payment-processing fee includes it, both stated on the same page. Under the narrow question Whatnot is a confirmed zero; under the correct one it is a confirmed yes. The narrow question returns the opposite answer, and a confirmed zero **suppresses the disclosure permanently** — nothing would have re-opened it.

### 2.2 Answer states

| `taxOn` | Meaning | Disclosure |
|---|---|---|
| `true` | The published base includes buyer-paid tax. Our estimate understates the fee, and by how much is unknowable at estimate time. | **Renders** |
| `false` | Confirmed zero, for a recorded reason. | **Suppressed** |
| `'unknown'` | The published page does not settle it. | **Renders** |

`'unknown'` renders. Silence on a fee page is not a zero, and this is the reviewer instruction I care most about having implemented rather than merely agreed with: `venueTaxNote` returns `taxOn !== false`, so **only an explicit `false` can suppress**, and an unrecognised pid renders too. The helper fails closed toward showing the caveat.

### 2.3 Why `taxBasis` is a separate field

Three genuinely different situations collapse to `false` if you keep only the answer:

| `taxBasis` | Establishes a zero by | Venues |
|---|---|---|
| `'published-exclusive'` | A quoted, closed enumeration of the base that omits tax | Mercari, CardNexus |
| `'no-buyer-tax'` | The **shape of the deal** — a buylist has no buyer checkout, so no buyer tax exists to be inside anything | Card Kingdom, CoolStuffInc, Star City Games, TCG Bulk |
| `'published-inclusive'` | (a yes, not a zero) A quoted statement that the base includes tax | eBay, Whatnot |
| `'payment-method'` | (an unknown) Policy fully published, but the outcome is conditional on a fact that does not exist until checkout | TCGplayer |
| `'unstated'` | (an unknown) The page does not address it | Poshmark, COMC, Fanatics, Mana Pool, Cardsphere, Cardmarket |

`'no-buyer-tax'` is deliberately **not** laundered into `'published-exclusive'`. It is a stronger result than an argument from silence and a weaker one than a quoted exclusion, and the field says which. A test asserts `taxOn: false` appears only on `'published-exclusive'` or `'no-buyer-tax'` — so a future edit cannot record a confirmed zero on `'unstated'`.

---

## 3. The fifteen venues

All quotations retrieved 2026-09-08 from the **raw text** of the linked pages, per the standing rule that enumerated policy is cited from raw page text and not from anything that condensed it. Raw captures retained at `/home/user/workspace/taxaudit/raw/`.

### 3.1 eBay

| | |
|---|---|
| **Published fee base** | "The **total amount of the sale** includes the item price, any handling charges, any shipping costs collected from the buyer (some exceptions apply), **sales tax**, and any other applicable fees." Worked example: "$424 is the total amount of the sale (includes 6% sales tax)", final value fee 13.6% of $424 = $58.06. A second example uses "$10,070 (includes 6% sales tax)". [eBay selling fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822) |
| **Current implementation** | `feeEbay(price, shipCharge, ebayStore, ebayPromo, trsEligible)` — no tax parameter. `feeBase = price + shipCharge`. Fee understated **$3.18** on eBay's own $400 example and **$13.39** on the $10,070 example. That is BIAS-9, and it is not fixed here. |
| **Missing inputs** | The buyer's ship-to jurisdiction and its rate. Neither exists at draft time or comparison time. |
| **Seller-facing disclosure** | Present before this work, **and only here** — `items.taxNote = true` hardcoded inside `feeEbay`. |
| **Correction, applied** | `taxOn: true, taxBasis: 'published-inclusive'` at **:6298**. The disclosure now arrives from the field. **The fee is not corrected by modelling a rate**, per BIAS-9's own conclusion that it cannot be, and that being the finding. |

### 3.2 TCGplayer

| | |
|---|---|
| **Published fee base** | "TCGplayer charges fees based on the subtotal (item amount + shipping cost). **We do not charge fees on taxes for orders paid by debit card.** However, **credit cards and PayPal do include taxes when determining the fee** … (item amount + shipping cost + taxes)." Worked example: commission 10.25% of **Subtotal** $66.30 = $6.80; processing 2.5% + $0.30 of **Order Total** $70.78 = $2.07, where "Order Total = Subtotal + Sales Tax". [TCGplayer fees](https://help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees), [fee calculation examples](https://help.tcgplayer.com/hc/en-us/articles/360047732673-Fee-Calculation-Examples) |
| **Current implementation** | `feeTCGPlayer(price, shipCharge, tcgLevel)`, `base = price + shipCharge` for both components. Commission base **correct**. Processing base correct for debit, **understated for credit card and PayPal**. |
| **Missing inputs** | The buyer's payment method, plus the tax amount. The payment method is not merely unmeasured — **it does not exist until checkout**, after the draft is written. |
| **Seller-facing disclosure** | Fee-base row rendered; **no tax row**. The split basis appeared on no surface. |
| **Correction, applied** | `taxOn: 'unknown', taxBasis: 'payment-method'` at **:6304**. This is not ignorance of the policy — the policy is fully published — it is a conditional outcome whose condition resolves after we publish the estimate. Renders. |

### 3.3 Poshmark

| | |
|---|---|
| **Published fee base** | **Not obtainable.** The ToS defers: fees are "as set forth in our **Fee Policy** (which is incorporated by reference)". `poshmark.com/fee_policy` resolves back to the ToS, which never enumerates the base. `poshmark.com/fees`, `poshmark.com/help/1` and two `support.poshmark.com` articles all returned client errors — five URLs, no fee-base statement. The only published figures are rates: "20% seller fee for sales over $15 and $2.95 for sales $15 and under" ([Poshmark ToS](https://poshmark.com/terms), [Poshmark blog](https://blog.poshmark.com/2024/10/21/returning-to-original-fees/)). |
| **Current implementation** | `feePoshmark(price)` — price alone. $2.95 under $15, else 20%. No `feeBase`, no tax row. |
| **Missing inputs** | The published base itself, before any tax question arises. |
| **Seller-facing disclosure** | None of either kind. |
| **Correction, applied** | `taxOn: 'unknown', taxBasis: 'unstated'` at **:6310**. Renders. Poshmark carries the **highest rate in the set**, so an unstated base here is the largest single unquantified magnitude exposure — BIAS-10 measured Poshmark as the most flattered venue, **$4.80 on a $400 card at 6%**. |

### 3.4 COMC

| | |
|---|---|
| **Published fee base** | "Fixed-price sales, whether sold on the COMC platform or via eBay have a flat **5% transaction fee of the item's sale price**." ([COMC commission fees](https://comc.zendesk.com/hc/en-us/articles/360053737993-What-are-the-commission-fees)) Tax is not mentioned. The `/Sell` page is JavaScript-gated and its raw text carries no fee schedule at all. |
| **Current implementation** | `feeCOMC(price, service, isGraded, cashout)` — 5% of price, plus submission fee, $5 ship-in, 10% cash-out, $1 under-$250 surcharge. No `feeBase`, no tax row. |
| **Missing inputs** | Whether "sale price" is gross or net of tax. Also: COMC lists into its own eBay consignment store, where eBay's tax-inclusive FVF is **COMC's** cost and not the seller's — so eBay's rule does not transfer, and that non-transfer is not read as evidence either way. |
| **Seller-facing disclosure** | None. |
| **Correction, applied** | `taxOn: 'unknown', taxBasis: 'unstated'` at **:6317**. Renders. |

### 3.5 Fanatics Collect

| | |
|---|---|
| **Published fee base** | "The Buy Now marketplace features a **seller's fee that's a percentage of the sale price of your listing**. … All cards listed less than 120% of the market value provided by Card Ladder have a seller's fee of just 6%." Auctions: "There are no fees to sell graded collectibles in Weekly or Premier Auctions." ([selling on Fanatics Collect](https://support.fanaticscollect.com/en_us/selling-on-fanatics-collect-Byq2QAQpel), [Buy Now fees](https://support.fanaticscollect.com/en_us/buy-now-fees-ry33QCXaxe)) Tax appears nowhere in the raw text of either page. |
| **Current implementation** | `feeFanatics(price)` — 6% default tier plus a $5 inbound-ship line. Price only. |
| **Missing inputs** | Whether "sale price of your listing" is gross or net of tax. |
| **Seller-facing disclosure** | None. |
| **Correction, applied** | `taxOn: 'unknown', taxBasis: 'unstated'` at **:6324**. Renders. |

### 3.6 Whatnot — **a correction to my own first pass**

| | |
|---|---|
| **Published fee base** | **Split, and explicitly so.** Commission: "a charge calculated as a percentage of the **final price** … The final price refers to the price the item sold for to the buyer, **which does not include shipping or taxes**." Payment processing: "a charge calculated as a percentage of the **total order value** of a transaction. This includes the **final price of the item sold plus shipping and buyer-paid tax**." ([Whatnot seller fees](https://help.whatnot.com/hc/en-us/articles/4847069165965-Whatnot-Seller-Fees-and-Commissions-Schedule)) |
| **Current implementation** | `feeWhatnot(price, shipCharge)` — commission `min(price, 1500) × 8%`, correct and tax-exclusive by policy; processing `(price + shipCharge) × 2.9% + $0.30`, **which omits the buyer-paid tax the published base includes**. |
| **Missing inputs** | The tax amount, for the processing component only. |
| **Seller-facing disclosure** | None. The line item reads "Payment processing (2.9% + $0.30 of item + shipping)" — accurate about what we compute, silent about what Whatnot charges. |
| **Correction, applied** | `taxOn: true, taxBasis: 'published-inclusive'` at **:6335**. |

**This entry is a correction, and it is the finding I would most want checked.** My first pass read the commission sentence, recorded Whatnot as a confirmed zero, and moved on. The processing sentence three paragraphs later says the opposite about the other half of the same schedule. Two consequences:

1. It is the direct evidence for the wide `taxOn` definition in § 2.1. Under the narrow reading Whatnot would have been a confirmed zero **on a true reading of the wrong sentence** — the worst available outcome, because a confirmed zero suppresses the disclosure and nothing re-opens it.
2. **The fact was already in the codebase**, in a comment above `feeWhatnot`, since the 2026-09-01 fee-truth pass: "We do not model buyer-paid tax anywhere in this engine." It was invisible to this audit until the page was re-read, because a comment is not a field. That is the pattern this whole item was filed to remedy, demonstrating itself inside the remedy.

### 3.7 Mercari

| | |
|---|---|
| **Published fee base** | "**10% Selling fee** — 10% of the **item price + buyer-paid shipping**". The same page defines a different, now-retired fee tax-inclusively: the pre-2025 buyer Payment Processing Fee was "2.9% of the transaction price (**includes the item price, shipping, service fee and sales tax**)". ([Mercari selling fees](https://www.mercari.com/us/help_center/article/169/)) |
| **Current implementation** | `feeMercari(price, shipCharge)` — `(price + shipCharge) × 10%`, single line item. Matches the published base exactly. No seller processing fee exists after 2025-01-06, so there is no second component. |
| **Missing inputs** | None. |
| **Seller-facing disclosure** | No fee-base row, no tax row. The base was right and unstated. |
| **Correction, applied** | `taxOn: false, taxBasis: 'published-exclusive'` at **:6342**. **A confirmed zero.** The enumeration is closed, and the strength of the reading is that the same document says "includes … sales tax" when it means that — so its absence from the 10% base is a **contrast within one page**, not an argument from silence. Disclosure correctly suppressed. |

### 3.8 Mana Pool

| | |
|---|---|
| **Published fee base** | Marketplace fee: "5% of the price of the merchandise", and "the fee is **not applied to shipping charges, only the price of the product**". Credit card fees: "We charge Stripe's credit card fees (2.9% + 30 cents as of 12-7-23) … we charge $0.30 per seller, per order." ([Mana Pool fees](https://support.manapool.com/hc/en-us/articles/21779686206615-Fees-Mana-Pool-and-Credit-Card-Fees)) The page states the marketplace base **precisely** and says nothing about the processing base. |
| **Current implementation** | `feeManaPool(price, shipCharge)` — marketplace `price × 5%` (correct), processing `(price + shipCharge) × 2.9% + $0.30`. |
| **Missing inputs** | The processing fee's base. Stripe bills the amount actually charged, which at a taxed checkout includes tax — but **Mana Pool does not say so**, and inferring it from how Stripe generally works is precisely the invented input the binding rule forbids. |
| **Seller-facing disclosure** | None. |
| **Correction, applied** | `taxOn: 'unknown', taxBasis: 'unstated'` at **:6356**. Renders. **Deliberately not `false`.** The marketplace component is a clean published exclusion, but § 2.1 asks about *any* fee and the processing component is unaddressed. Structurally this is the Whatnot case **with the second sentence missing**. |

### 3.9 Cardsphere

| | |
|---|---|
| **Published fee base** | Not published. The Terms address tax only as the user's own liability — "You are responsible for paying any import taxes or duties" under a "Taxes and Duties" heading — which is none of the three quantities in § 1. ([Cardsphere terms](https://www.cardsphere.com/terms)) No fee-base statement for the 3% seller fee or the 10% cashout exists in the raw text. |
| **Current implementation** | `feeCardsphere(price)` — `price × 3%` plus 10% PayPal cashout on the net. Price only; shipping is not a parameter. |
| **Missing inputs** | The base for both components. |
| **Seller-facing disclosure** | None. |
| **Correction, applied** | `taxOn: 'unknown', taxBasis: 'unstated'` at **:6368**. Renders. |

### 3.10 Cardmarket

| | |
|---|---|
| **Published fee base** | "Selling — **5% of the article value per article sold**", "Currency Conversion Fee 3%", and a footnote applying to the fee table as a whole: "**All prices are inclusive of VAT**", with "Professional sellers from EU countries outside Germany with a valid EU VAT ID do not pay VAT." ([Cardmarket fees](https://www.cardmarket.com/en/Policies/Fees)) |
| **Current implementation** | `feeCardmarket(price, shipCharge)` — `price × 5%` capped ≈ $110, plus `(price + shipCharge) × 3%` currency conversion. |
| **Missing inputs** | Whether "article value" is the VAT-inclusive displayed price. **"All prices are inclusive of VAT" is a statement about Cardmarket's own fees carrying VAT — a tax on the fee — not about VAT being inside the base.** Reading it as the latter is the § 1 category error. |
| **Seller-facing disclosure** | None. |
| **Correction, applied** | `taxOn: 'unknown', taxBasis: 'unstated'` at **:6384**. Renders. **This is the venue where the disclosure copy fits worst**: the label says "Buyer sales tax" and the regime is VAT, where EU displayed prices are conventionally gross — the opposite default from US sales tax. Recorded as an open copy question in § 8 rather than silently resolved. |

### 3.11–3.14 Card Kingdom · CoolStuffInc · Star City Games · TCG Bulk — the buylist class

One structure, one answer, one table. The distinction from the marketplace venues is **stated rather than collapsed**.

| | |
|---|---|
| **Published fee base** | Card Kingdom: "Payments for cards are done by a percentage system based on the **NM buy price** for a card"; the seller ships in and is paid by check, PayPal or store credit ([how to sell](https://www.cardkingdom.com/purchasing/how_to_sell)). CoolStuffInc: "**no fees on any collections**", "you receive the full value for your cards without any deductions" ([full-service sell list](https://www.coolstuffinc.com/main_fullservice_selllist.php)). SCG: "**Pay no Service Fees**" ([sell your cards](https://sellyourcards.starcitygames.com/)). TCG Bulk: "a **10% TCG Bulk service fee** applies to the transaction and is deducted from the **Seller's proceeds**" ([terms of service](https://tcgbulk.com/page/terms-of-service)). None mentions tax in a fee base. |
| **Current implementation** | All four route through `feeBuylist(price, ratio, serviceFeePct)`. The "fee" is the retail-to-offer haircut; `serviceFeePct` is set for TCG Bulk (10%) and left undefined for the three direct buylists, so that row never renders for them. |
| **Missing inputs** | **None for the tax question.** TCG Bulk's fee base against the vendor remains separately unconfirmed — an open item that **predates this audit and is not closed by it**. |
| **Seller-facing disclosure** | No tax row, and correctly so. |
| **Correction, applied** | `taxOn: false, taxBasis: 'no-buyer-tax'` on all four — Card Kingdom **:6416**, CoolStuffInc **:6430**, SCG **:6446**, TCG Bulk **:6507**. |

**Why this is a confirmed zero and not an unknown.** A buylist transaction has no buyer checkout. The venue **is** the buyer; the seller ships cards in and receives an offer. No buyer-paid sales tax is created anywhere in the transaction, so there is no tax any fee base could include. The question is answered by **the shape of the deal**, not by a sentence on the page — stronger than an argument from silence, weaker than a quoted exclusion, and `taxBasis` records which.

**COMC and Fanatics are deliberately not in this class.** Both require shipping cards in, which makes them *feel* like buylists, but both are **consignment**: a third-party buyer checks out and the seller's proceeds derive from that buyer's payment. The buyer-tax question applies to them in full, and both are `'unknown'` above.

### 3.15 CardNexus

| | |
|---|---|
| **Published fee base** | "Sellers pay a commission on each order they fulfill: 5% in Europe and 8% in North America. The fee is calculated on the **order total (items + shipping)**", and separately "**The 'order total' includes the item subtotal and the shipping cost.**" Worked example: €55 of cards + €5 shipping → €60 × 5% = €3.00. The buyer-side 2.5% + $0.30 is not a seller cost. ([fee structure overview](https://help.cardnexus.com/articles/9938652-fee-structure-overview), [selling FAQ](https://help.cardnexus.com/articles/1754380-selling-faq)) |
| **Current implementation** | `feeCardNexus(price, shipCharge)` — `(price + shipCharge) × 8%`, single line item. Matches. |
| **Missing inputs** | None. |
| **Seller-facing disclosure** | No fee-base row, no tax row. |
| **Correction, applied** | `taxOn: false, taxBasis: 'published-exclusive'` at **:6463**. **A confirmed zero** — the page defines "order total" as a closed two-item enumeration, in a sentence written specifically to define it, and the only seller-side fee uses that base. The tax language elsewhere ("tax compliance requirements" as justification for the 8% North America rate) is about CardNexus's operating cost, not the base, and is **not** read as evidence either way. |

---

## 4. Result and implementation

### 4.1 The answers

| `taxOn` | Count | Venues |
|---|---|---|
| `true` | **2** | eBay, Whatnot — both `published-inclusive` |
| `false` | **6** | Mercari, CardNexus (`published-exclusive`) · Card Kingdom, CoolStuffInc, Star City Games, TCG Bulk (`no-buyer-tax`) |
| `'unknown'` | **7** | TCGplayer (`payment-method`) · Poshmark, COMC, Fanatics, Mana Pool, Cardsphere, Cardmarket (`unstated`) |

**Disclosure coverage: 1 of 15 → 9 of 15.** Suppressed on 6, every one for a recorded reason that can be re-opened by grep.

### 4.2 Code

| Change | Location |
|---|---|
| `taxOn` + `taxBasis` on all fifteen entries | `PLATFORMS` at **:6296**; the fifteen field lines at :6298, :6304, :6310, :6317, :6324, :6335, :6342, :6356, :6368, :6384, :6416, :6430, :6446, :6463, :6507 |
| One shared helper | **:6697** — `function venueTaxNote(pid) { return PLATFORMS[pid]?.taxOn !== false; }`. Only an explicit `false` suppresses; an unrecognised pid renders. |
| Hardcoded statement **deleted** | `items.taxNote = true` inside `feeEbay` no longer exists as a statement. Removed, not superseded. |
| Venue-tile render reads the field | **:8298** — `taxNote: venueTaxNote(p.pid),`; consumed at **:8737** |
| Review-screen render reads the field | **:21228**, gated on `venueTaxNote(pid)`. See § 7. |
| Disclosure copy | `FEE_DISCLOSURE.taxLabel` = `'Buyer sales tax'`, `taxQualifier` = `'not estimated'` at **:7359–:7360**; value is the em-dash `FEE_UNKNOWN` at **:7357** |
| Published restatement | `accuracy.html` — `Last updated · Sep 8, 2026` at :88, new `<h3>Sales tax and the fee base</h3>` at :185 with a fifteen-row table and its sources |

### 4.3 The stamp — `feeAuditedOn` is **not** bumped

T2.9's own to-do entry contained a contradiction: step 2 said to bump `feeAuditedOn` "because step 1 is a real re-audit", and the same section's footer said "**Do not bump `feeAuditedOn` for a tax-only check**."

**Resolved against step 2: not bumped.** Step 2's conditional was not met. All fifteen pages were re-read, but I extracted and verified **the tax window only** — not one fee rate, cap, tier or fixed charge was re-checked against its page. That is a tax-only check by the definition that matters, whatever the retrieval covered. `feeAuditedOn` is published on `accuracy.html` as "Last verified" for **the schedule**; bumping it would publish a claim this work does not support and would reset the staleness clock by six weeks.

All fifteen stamps stay at `'2026-09-01'` — amber at `2026-10-01`, stale at `2026-10-16`. **The fee re-audit remains due.** Per the one-date decision, **no `taxCheckedOn` field was added**; a second date earns its place only if a venue publishes tax treatment somewhere other than its fee schedule, which none of these fifteen does. `accuracy.html` states explicitly that the "Last verified" dates did not move for this pass.

### 4.4 What was deliberately not built

No tax rate. No universal rate. No per-venue rate. No fee function gained a tax parameter. On the two `true` venues we now say the fee is understated **without saying by how much**, because the jurisdiction does not exist at estimate time. Per the binding rule established at BIAS-10: an invented fee input propagates into every venue simultaneously and silently, so it cannot surface as an outlier — it moves the whole board and looks like consistency. **Gaps of this kind close by disclosure and citation, never by modelling.**

---

## 5. Test evidence

`tests/accuracy-fee-parity.mjs`, **17 → 36 checks**, all passing. The file carries a header block titled "WHAT THIS FILE USED TO ASSERT, AND WHY THAT CHANGED (2026-09-08, T2.9)".

What the new checks establish:

- Every one of the fifteen entries carries both fields; both values are drawn from the declared vocabularies.
- `taxOn: false` appears **only** on `'published-exclusive'` or `'no-buyer-tax'` — a confirmed zero cannot be recorded on an unstated basis.
- The hardcoded line is gone, matched with `/^\s*items\.taxNote\s*=/m`.
- Both render surfaces consult `venueTaxNote`, and no ungated tax row survives anywhere in the bundle.
- **Behaviour is executed, not pattern-matched**: the shipped `PLATFORMS` block and the shipped helper are built with `new Function` and interrogated per venue.
- The helper fails closed on an unknown pid.
- The disclosure reaches more than one venue — the specific regression that produced BIAS-10.
- Full **bidirectional** parity between the published `accuracy.html` table and the model, plus four exact-string count assertions ("2 are confirmed tax-inclusive", "6 are confirmed zero", "7 are unknown", "9 of 15").

**Mutation-tested.** Each of these was applied, confirmed to turn the suite red, and reverted, with the bundle hash restored afterward:

| Mutation | Result |
|---|---|
| Flip Mercari `taxOn` → `true` | 4 FAIL |
| Strip a `taxOn` field | 4 FAIL |
| Record `false` on an `'unstated'` basis | 5 FAIL |
| Make the helper fail open | 2 FAIL |
| Drift the published count 9 → 10 | 1 FAIL |
| Restore the unconditional review-screen row | 2 FAIL |

**Suites, run individually:** `accuracy-fee-parity` **36/0** · `asset-fingerprints` **15/0** · `test-registry` 12/0 · `quick-pricing` 188/0 · `payout-honesty` 32/0 · `grading-upside-fees` 103/0 · `flip-completeness-e2e` 22/0 · `contrast-tokens` 12/0. `tests/run-all.sh` was not run.

---

## 6. Three assertions that were wrong first

Each of these initially passed or failed for a reason unrelated to the thing it names. They are recorded because a check that reports the right answer for the wrong reason is worse than an absent one.

1. **`!/items\.taxNote\s*=/` FAILED — on the docblock that explains the deletion**, because the docblock quotes the deleted line. A substring search for removed code cannot distinguish code from prose about code. Anchored to `^\s*`.
2. **The published fee table's parse slice passed by luck.** Its slice ended at the cross-border header; the new tax table was inserted between them, so the slice silently grew by fifteen rows — and *still* reported "parsed 15 venues" and full parity, because the tax rows' third cell contains an `<a>` and failed the row regex's `([^<]+)` on the date column. **It was passing on a neighbouring table's markup shape.** Given an explicit end marker, asserted.
3. **A count check that could not fail.** The first draft carried a fallback matching any bold number anywhere in the section. Replaced with exact strings.

---

## 7. The follow-up: a second, ungated copy of the same row

Found **after** the T2.9 commit, fixed in `79dc1bd`, and the item in this packet I would most want scrutinised.

The remedy replaced a hardcoded disclosure with a shared helper and asserted that the venue-tile render reads it. It does. Meanwhile the D3 review screen builds its own fee table and was emitting the sales-tax row **unconditionally** — `${_reviewBasisRow(FEE_DISCLOSURE.taxLabel, …)}`, no helper, no field. That row was correct, but only because the review screen is pinned to `CR_REVIEW_FEE_SLOT = 'ebay:fixed-price'` (**:21055**) and eBay is `taxOn: true`.

Two implementations of one business behaviour, **agreeing by coincidence of scope** — the rule-1 failure this project has been bitten by nine times, surviving a remedy aimed directly at it. `pid` was already in scope three lines above the row, so the fix is a ternary at **:21228**.

**The rendered output is byte-identical.** Not asserted by reading the code: the shipped `PLATFORMS` block, the shipped `venueTaxNote` and the shipped slot constant were extracted and executed — slot `ebay:fixed-price`, pid `ebay`, `venueTaxNote('ebay') === true`, so the row is emitted before and after. **No amount, disclosure or calculation changes**, and D3's accepted behaviour is unaffected. What changes is that the screen stays correct when it shows a venue whose answer differs.

Two assertions added, both mutation-confirmed. The second — that no ungated `_reviewBasisRow(FEE_DISCLOSURE.taxLabel` survives anywhere — is not redundant: the first would still pass if a **third** unconditional copy appeared on another surface.

**The generalisable check, filed as a fourth rider on pattern instance 35:** when a remedy replaces a hardcoded value with a derived one, grep for the **rendered label**, not for the variable you deleted. The label finds every surface; the variable finds only the one you already knew about.

---

## 8. Open, and not closed by this work

- **`feeBase` / `feeBaseLabel` still emit on 2 of 15** (eBay, TCGplayer). **This is BIAS-10's other half and T2.9 does not touch it.** Thirteen venues still show a fee total with no stated base — the *stated-base* row retains exactly the single-venue shape the *tax* row just lost.
- **Split-basis venues cannot express which component.** `taxOn` is one value per venue. It answers § 2.1 correctly for TCGplayer and Whatnot but cannot say *which* fee carries the tax-inclusive base. Adequate for a warning; **not** adequate for anything that computed from it — and nothing may, per the binding rule.
- **The Cardmarket copy mismatch.** "Buyer sales tax" is the wrong noun for a VAT regime. Fixing it means either a per-venue label or a broader one; both are copy decisions rather than audit findings.
- **TCG Bulk's fee base against the vendor** — open before this audit, open after it.
- **Poshmark's base is unobtainable from published text**, not merely tax-silent. Five URLs attempted; the Fee Policy is incorporated by reference and resolves to no distinct page.
- **BIAS-10's magnitude finding stands unchanged.** The omission is still proportional to fee rate on the seven `'unknown'` venues. Disclosing that we do not know does not make the estimate right — it makes it honest. BIAS-10 remains a **magnitude** bias, not a ranking bug.

**Stale counts corrected in place, entries not rewritten.** BIAS-10 was filed against a twelve-venue set: "one venue of twelve" was 1 of 15, "ten venues" with no base and no tax note was 13, and the T2.9 entry's "eleven of twelve" was 14 of 15. Corrected where they stand, so the finding's history stays legible. The magnitude argument never depended on the count.

---

## 9. T2.10 — not started, entry conditions recorded

Per your instruction, the comparability question comes **before** the explanation. Establishing whether the two figures describe the same **condition, variant, currency, measurement type and time window** is the first work item, not a preamble to a fix I have already chosen.

What is already established and will be re-checked rather than assumed: `low = 0.85 × market` derives from the **sales** book; `mid` is the median **active ask**; they render as an ordered triple. `low > mid` whenever `market > 1.1765 × mid`, and upstream `mid 100 / market 300` publishes `low $255.00` beside `mid $100.00`. The undisclosed band is `1.176 × mid < market ≤ 3.0 × mid`, because `_marketAskDivergence` (`api/tcg-price.js:672`) returns `null` at `ratio <= 3` (`:683`). This is roadmap Q7's evidence (`audit/CARDRESELL_PLAN_AND_ROADMAP.md:847`, item 7) and Q7 is an open reviewer question needing a decision, not a patch. **Q3-C closed the derived-centre mechanism only; it must not be read as "the inversion is fixed".** The existing withholding disclosure stays while this proceeds.

---

## 10. What this packet does not clear

Kept separate, as instructed, and none of it advanced by this work:

- **A-2** — service-fee verification metadata (verified-zero vs never-checked in `if (serviceFeePct)`).
- **TCG Bulk** — confirmation of the calculation's fee base.
- **Release validation RV-1 … RV-4.** RV-5 remains a declared exclusion; its execution requirements and release obligation stay explicit in `audit/RELEASE_VALIDATION_QUEUE.md`.
- **Security and hosting** — credential rotation, history cleanup, Production configuration, Preview access determination.
- **The push gate.** *Do not push before the Cert ID is rotated.* Rotation has not happened. Both commits here are local; `origin/main` is untouched.

D3, BIAS-1 and the accepted grading-cost behaviour stay closed. No chart redesign or BIAS-6 audit rewrite was done. **Phase 1 remains roughly 80–85% implemented.**

---

## Sources

All retrieved 2026-09-08 from raw page text.

- eBay — https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822
- TCGplayer — https://help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees · https://help.tcgplayer.com/hc/en-us/articles/360047732673-Fee-Calculation-Examples
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
