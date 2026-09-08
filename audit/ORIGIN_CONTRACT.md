# The origin contract — what an accepted provenance token guarantees

Retrieved 2026-09-08. Implemented as `_CR_ORIGIN_CONTRACT` in
`js/core.1eea628c.js`; `_CR_MEASURED_ORIGINS = Object.keys(_CR_ORIGIN_CONTRACT)`
so the allow-list cannot drift from the guarantees.

## Why this file exists

The Q7 gate admits a range when both endpoints carry a tag from an allow-list.
The reviewer's objection: matching tags establish neither a common provider nor
compatible condition, currency or measurement contexts by themselves. Two
figures both labelled `'observed'` pass the list while possibly being an ask
from one vendor and a sale from another, in different currencies, for different
conditions. The allow-list was checking *string membership* and the code was
describing the result as a *measured range*.

So each token now records what it guarantees, and the guarantee is asserted
(`tests/quick-pricing.mjs`, section 5c) rather than assumed. The guarantees are
mostly **structural** — they follow from where in the payload the figures were
read, not from a new field travelling beside every number. That was the
reviewer's allowance and it is the reason no new fields were added.

## Tokens

| token | provider | instrument | currency | structural guarantee |
|---|---|---|---|---|
| `tcgplayer` | TCGplayer | ask | USD | one `prices.raw[condition].tcgplayer` block |
| `observed` | TCGplayer | ask | USD | one tcgcsv price row |
| `ebay-sold` | eBay | sale | USD | one sold-comps query for one product |
| `provider` | varies per response | **unknown** | USD | one upstream card object from one free API |

`provider` deliberately declares its instrument unknown. Its upstream vendor
varies per response, so whether a figure is an ask or a completed sale is not
established, and it must never be labelled either. It is on the list because the
figures are co-contextual with each other, not because their nature is known.

The gate independently requires `lowBasis === highBasis`, so an ask can never be
composed with a sale inside one range. The contract is what makes that
requirement mean something: without a recorded instrument, "same tag" was a
string comparison.

## Vendor evidence

TCGplayer figures, from the [TCG Price Lookup FAQ](https://tcgpricelookup.com/faq),
verbatim:

> TCGPlayer provides marketplace listings, what sellers are currently asking, for
> raw cards in every condition (Near Mint to Damaged) with market, low, mid, and
> high values.

> Each condition includes TCGPlayer (market, low, mid, high) and eBay (1-day,
> 7-day, 30-day averages) where data is available.

> eBay prices are aggregate averages (1-day, 7-day, 30-day) computed from actual
> completed sales, what buyers actually paid.

> All prices are USD. Both TCGPlayer market data and eBay sold-listing averages
> are sourced from US-based marketplaces and reported in US dollars.

The [API reference](https://tcgpricelookup.com/docs/api-reference?endpoint=cards-search)
gives `market` as "Current TCGplayer market price" and `low`/`mid`/`high` as a
TCGplayer "Listing price range" — list prices, not completed sales — and states
that `raw` is keyed by condition.

That last clause is the condition guarantee for the `tcgplayer` token, and it is
why the validator checks that the block it was handed is the one the raw map
holds under the condition being priced (`why: 'block-not-condition-scoped'`)
rather than trusting a key name.

Corroborating for `observed`: `api/_tcgcsv.js:131-134` maps
`market: p.marketPrice, low: p.lowPrice, mid: p.midPrice, high: p.highPrice`
from a single `p` row, so the four figures are co-contextual by construction.

## What is NOT guaranteed

- **Currency is documented, not verified per response.** All four tokens record
  USD on the vendor's statement above. Nothing in the payload carries a currency
  code, so a vendor change would not be detected here.
- **`provider`'s instrument stays unknown** and no code path may present its
  figures as asks or as sales.
- **Freshness is not part of this contract.** Age handling is separate.
