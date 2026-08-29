# Fee Accuracy Audit — 2026-08-29

Commit: `40233cd` · Deployed to prod · All checks pass

## Method

Standalone Node harness (`qa/fee_audit_2026-08-29.js`) extracts every fee function from `index.html`, evaluates them in isolation, and cross-checks the computed effective take-rate against hand-derived expected values from official platform docs.

- **Price matrix**: $1, $5, $15, $50, $100, $500, $1,500, $5,000
- **12 marketplaces**: eBay, TCGplayer, Poshmark, Fanatics Collect, COMC, Whatnot, Mercari, Mana Pool, Cardsphere, Cardmarket, Card Kingdom, CoolStuffInc
- **Shipping baseline**: $4 buyer-paid, $4 seller-cost
- **eBay default**: "No Store / Starter" (matches UI default)

## Results

- **96 / 96** price-matrix checks pass
- **10 / 10** edge-case tests pass (threshold switches, caps, top-rated discount, graded surcharge, cashout)

## Bug found and fixed

`feeEbay()` used a $7,500 threshold for the 2.35% tier boundary regardless of store subscription. Per eBay's public fees page ([tc-singles promo](https://pages.ebay.com/promo/2025/tc-singles/)), Basic Store and above actually drops to 2.35% at $2,500, not $7,500.

**Impact**: Basic-store sellers on cards priced $2,500–$7,500 saw fees ~1 percentage point too high. Cash impact on a $5,000 card: overstated fees by ~$250.

**Fix** (commit `40233cd`):
```js
const isBasicPlus  = ebayStore === 'basic';
const baseRate     = isBasicPlus ? 0.1235 : 0.1325;
const tierBoundary = isBasicPlus ? 2500   : 7500;
```

## Effective take-rate matrix (% of price)

| Platform     | $1     | $5     | $15    | $50    | $100   | $500   | $1,500 | $5,000 |
|--------------|--------|--------|--------|--------|--------|--------|--------|--------|
| ebay         | 96.25% | 29.85% | 19.45% | 15.11% | 14.18% | 13.44% | 13.31% | 13.27% |
| tcgplayer    | 42.75% | 18.75% | 14.75% | 13.35% | 13.05% | 12.81% | 12.77% | 12.76% |
| poshmark     |295.00% | 59.00% | 20.00% | 20.00% | 20.00% | 20.00% | 20.00% | 20.00% |
| fanatics     |506.00% |106.00% | 39.33% | 16.00% | 11.00% |  7.00% |  6.33% |  6.10% |
| comc         |570.00% |118.00% | 42.67% | 16.30% | 10.65% |  6.13% |  5.38% |  5.11% |
| whatnot      | 40.90% | 16.90% | 12.90% | 11.50% | 11.20% | 10.96% | 10.92% |  5.31% |
| mercari      | 10.00% | 10.00% | 10.00% | 10.00% | 10.00% | 10.00% | 10.00% | 10.00% |
| manapool     | 37.90% | 13.90% |  9.90% |  8.50% |  8.20% |  7.96% |  7.92% |  7.91% |
| cardsphere   | 12.70% | 12.70% | 12.70% | 12.70% | 12.70% | 12.70% | 12.70% | 12.70% |
| cardmarket   |  8.00% |  8.00% |  8.00% |  8.00% |  8.00% |  8.00% |  8.00% |  5.20% |
| cardkingdom  | 50.00% | 50.00% | 50.00% | 50.00% | 50.00% | 50.00% | 50.00% | 50.00% |
| coolstuffinc | 52.00% | 52.00% | 52.00% | 52.00% | 52.00% | 52.00% | 52.00% | 52.00% |

### What the matrix confirms

- **Ship-in platforms (Fanatics, COMC) dominate on high-value cards** — 5–7% effective at $500+, versus 13% on eBay/TCGplayer. The $5-per-card ship-in overhead only pays off above ~$75-$100.
- **Whatnot's $1,500 commission cap** is real and shows up in the matrix — take rate drops from 10.92% at $1,500 to 5.31% at $5,000.
- **Cardmarket's €100 commission cap** kicks in around $2,200 and produces the same drop (8.00% → 5.20% at $5,000).
- **Buylists (Card Kingdom, CoolStuffInc) are flat 50/52%** across all prices — reflects the retail-to-offer haircut, not a percentage fee. This is honest but harsh; both tiles have red-flag warnings that this is an estimate.
- **Mercari's flat 10%** is the most predictable fee model of any listing platform. No processing, no per-order.

### Where the numbers look scary but aren't bugs

- **Poshmark at $1 = 295%**: this is the $2.95 flat commission expressed as % of a $1 sale. The tile's redFlag pill warns "Best for cards under $15 — flat $2.95 fee (jumps to 20% at $15+)".
- **Fanatics / COMC at $1 = 500%+**: the fixed $5 ship-in cost dominates cheap cards. Both tiles' redFlags warn about ship-in and both have `bestFor` pills at $75+ and $150+ respectively.
- **eBay at $1 = 96%**: $0.30 per-order fee + 13.25% FVF = uneconomic for $1 cards. Tile doesn't flag this yet — could add a "not viable under $2" bestFor.

## Sources (all verified Aug 2026)

- eBay: [help/selling/fees-credits-invoices/selling-fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees), [tc-singles promo](https://pages.ebay.com/promo/2025/tc-singles/)
- TCGplayer: [help.tcgplayer.com/articles/201357836](https://help.tcgplayer.com/hc/en-us/articles/201357836)
- Poshmark: [poshmark.com/fee](https://poshmark.com/fee)
- Whatnot: [help.whatnot.com/articles/4847069165965](https://help.whatnot.com/hc/en-us/articles/4847069165965)
- Mercari: [help_center/article/2518](https://www.mercari.com/us/help_center/article/2518/)
- COMC: [blog.comc.com/2025/10/01/ingestion-service-level-update](https://blog.comc.com/2025/10/01/ingestion-service-level-update-october-1-2025/)
- Fanatics Collect: [support.fanaticscollect.com/buy-now-fees](https://support.fanaticscollect.com/en_us/buy-now-fees-ry33QCXaxe)
- Mana Pool: [support.manapool.com/articles/21779686206615](https://support.manapool.com/hc/en-us/articles/21779686206615)
- Cardsphere: [trademagic.gg/compare](https://trademagic.gg/compare)
- Cardmarket: [cardmarket.com/en/Policies/Fees](https://www.cardmarket.com/en/Policies/Fees)
- Card Kingdom: [cardkingdom.freshdesk.com/articles/3000093663](https://cardkingdom.freshdesk.com/support/solutions/articles/3000093663)
- CoolStuffInc: [coolstuffinc.com/main_fullservice_selllist.php](https://www.coolstuffinc.com/main_fullservice_selllist.php)
