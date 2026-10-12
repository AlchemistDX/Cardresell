# eBay sold-data reliability — October 12, 2026

## Confirmed cause and limits

Production deployment `dpl_G3KAXPdJnN4xG9CC3HbxbgreUdqT` logged
`ebay-sold unavailable: 403` at 06:06:14 UTC. The endpoint reads eBay's sold
search HTML; it does not use Marketplace Insights or the application's OAuth
credentials. Rotating those credentials would not repair this request path.

eBay's official Buy API support page, checked October 12, states that
Marketplace Insights is restricted and not open to new users:
https://developer.ebay.com/api-docs/buy/static/ref-marketplace-supported.html

This confirms a documented access limitation, not the current entitlement of
this particular developer account. No new entitlement probe, credentials
retrieval, third-party purchase, access-control workaround or outreach was
performed. Provider access is NOT restored by this patch.

## Changes

- Blank or unrecognized response markup no longer becomes a cached successful
  empty search. An explicit zero-result heading can establish an empty search;
  a readable set of listings filtered out by grade can also yield zero matches.
- Unreadable responses use the existing short shared cooldown. Access refusals
  retain the existing 15-minute cooldown. The service still identifies itself
  honestly and does not change routes or client identity to bypass refusals.
- The cache version changes so old parser-generated empty entries cannot mask
  the new classification. Prices stay null on provider failure.
- The pricing panel distinguishes unavailable eBay data from too few matching
  sales, and retains manual sold-listings research even when a guide price is
  available. Other providers keep their own price labels.

## Verification

The added unreadable-response regression failed against the original handler.
The updated suite covers blank markup, changed markup, unreadable listing
fields, explicit empty results, shared cooldown, grade filtering, confidence
recalculation and the shipped pricing renderer with/without a guide price.
See the associated pull request for final test counts and release evidence.

## Next step for dependable automatic sold prices

Confirm whether the existing developer account has a documented supported
sold-data entitlement. If it does not, ask eBay Developer Support about the
supported commercial route; do not treat a normal developer key, seller OAuth
or a working active-listings search as sold-data authorization.

For any proposed third-party feed, obtain written confirmation of commercial
display/cache rights, supported card categories and countries, pricing, rate
limits, service expectations, sale dates, currency, shipping treatment, and how
accepted offers differ from displayed asking prices. Evaluate dated sample
sales against exact set/number/variant/condition before integrating or paying.

Until then, advertising may describe the working price comparison and manual
eBay research workflow, but should not promise dependable automatic eBay sold
coverage. This patch improves failure handling; it is not a replacement feed.
