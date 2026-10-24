# Connected eBay workflow follow-up — 2026-10-24

The owner's recording confirms the OAuth callback, account confirmation and
connected status now work. Seller registration returned Complete. The policy
checks were unavailable, and the enabled inventory-location count was zero.
The recording does not establish why the policy calls failed. The integration
remains read-only; no publication or sale synchronization was verified.

## Changes

- Sold-price links use the card's game: CCG Individual Cards (183454) for
  Pokémon, Magic and Yu-Gi-Oh!, Sports Trading Card Singles (261328) for sports.
  Unknown games use all categories. Card numbers, grading, affiliate parameters
  and sold/active filters keep their existing behavior.
- A connected draft's baseline now says category requirements need loading.
  The load action appears first. Final confirmations and saving wait for those
  requirements, and failed requests preserve recovery and cannot unlock saving.
- Failed seller checks retain unknown counts, provide a specific next step and
  expose only numeric HTTP/eBay error codes. Raw provider messages, parameters,
  credentials and account information are excluded. A failed policy lookup in
  draft review now points to the policy setup step instead of a generic error.
- Missing or unavailable policies link to eBay's Business Policies guidance.
  Zero enabled inventory locations is explained separately. No enrollment,
  policies, dispatch address, listing or other seller settings are changed.

The core bundle was derived from the asset referenced by index.html
(core.532e8d96.js). Older content-addressed assets remain unchanged.

## Verification

Local fixtures and isolated Redis; external application requests blocked.

| Suite | Passed |
| --- | ---: |
| ebay-seller-connect | 160 |
| ebay-listing-review | 107 |
| ebay-connect-browser (390 and 1280 px) | 90 |
| ebay-listing-review-browser (390 and 1280 px) | 42 |
| ebay-search-links-browser (shipped app) | 41 |
| asset-fingerprints | 254 |

Total: 694 assertions, no failures. Mobile review screenshot inspected.
These checks do not prove the seller's remaining live configuration is ready.

Official references:

- [eBay Business Policies and opt-in](https://www.ebay.com/help/selling/business-policies/business-policies?id=4212)
- [Trading card category and condition identifiers](https://developer.ebay.com/devzone/xml/docs/Reference/ebay/GetItem.html)
