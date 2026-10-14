# Post-outreach review

On October 14, 2026 (America/New_York), the owner reported completing all planned outreach emails. This records the owner's update, not independently confirmed delivery, opens or replies. No email was sent by this release.

## Current correction

eBay's official standard and Store selling-fee pages publish an increase in the seller currency conversion charge for US-registered sellers from 3% to 3.25%, effective October 14, 2026:

- https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822
- https://www.ebay.com/help/selling/fees-credits-invoices/store-selling-fees?id=4809

The charge applies when eBay converts funds for listings or sales on another eBay site. A foreign buyer alone does not establish a conversion. The 1.65% international fee is a separate charge and is waived for eligible eBay International Shipping transactions.

The public methodology table previously merged those conditions and still showed 3%. This release corrects both disclosures, aligns the app and public eBay fee-review date to October 14, and adds a dated changelog entry. The standard and Store trading-card rate tables were re-read: 13.25% through $7,500 without Basic+ Store, 12.35% through $2,500 for Basic+ Store, then 2.35%; the published $10 per-order boundary remains $0.30/$0.40. Fee arithmetic is unchanged. International and conversion charges remain explicitly excluded from the estimate. This update does not fix the separately disclosed buyer-sales-tax modelling gap.

Shipping-charge, postage-cost and purchase-cost captions now label their inputs programmatically and focus the corresponding field when clicked. No new input, account preference or fee assumption is added.

## Next priorities

1. Measure first-use completion through the existing lookup, scan and purchase funnel. The existing `email_outreach` label only attributes visits that actually carry that label; it cannot reconstruct missing attribution or prove email opens.
2. Record actual company replies, objections and source confirmations separately from traffic. An email sent or a click received is not a fee or licensing confirmation.
3. Obtain a real Seller Hub import results report for a current export. Local CSV preflight is not marketplace acceptance.
4. Run a held-out ID/grade study with real labelled card evidence and report failures as well as matches. No measured accuracy rate is published by this release.
5. Add a buyer-tax assumption as a separate calculator change with consistent ranking, draft and grading-ROI scope. Current tax omissions remain disclosed.

Production publication and validation are recorded on the release PR. No prices, plan entitlements, payment behavior or customer data changed.
