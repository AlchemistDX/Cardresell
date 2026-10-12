# Bulk value and selling comparison

Bulk results hid the only value total when purchase cost was blank or zero.
The results now always show total known card value, with a separate selected
value. Blank purchase cost is $0. Physical quantities count, including merged
duplicates. Missing prices are disclosed as an incomplete subtotal, never a
known zero. Value less purchase cost is explicitly before selling fees and
shipping.

Bulk results and Collection now open the same read-only selling comparison.
With no selection it uses all identified bulk cards / the entire Collection;
otherwise it uses the selected cards. Selection within the comparison can be
adjusted independently. No price edits or selections in this dialog modify
the saved Collection or create/publish listings.

The comparison shows:

- One lot at an editable target price, with one order fee and one shipment.
- All singles on each eligible venue, each copy modeled as a separate order.
- Each single's best modeled venue and the total for that allocation.

It reuses `feeEbay`, `feeTCGPlayer` and `feeMercari`. Venue access and enabled
settings are respected. Recommendations cover these compared venues, not all
marketplaces. TCGplayer uses seller-shipped Marketplace settings, excludes
unsupported/unknown games, Japanese cards and slabs, and requires one supported
game for a lot. Direct fulfillment is not modeled. eBay uses the existing Store
and promoted rate profile; Top Rated Plus is not inferred for these listings.

The same entered prices are used across venues. Lot price starts at the sum of
known singles values, explicitly described as an assumption, not an appraisal
or offer. Actual demand and sale prices can differ. Separate buyer-paid shipping
and postage/packing inputs exist for lots and singles, with $0 defaults disclosed
next to results. Purchase cost is separate from net payout. Collection selection
retains actual per-card costs; bulk pack cost is allocated per physical copy.
Missing card values prevent a complete-selection ranking until corrected.

Source checks on 2026-10-12:

- eBay US fees: https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822
- eBay Store fees: https://www.ebay.com/help/selling/fees-credits-invoices/store-selling-fees?id=4809
- TCGplayer lot support: https://help.tcgplayer.com/hc/en-us/articles/360008108714-How-to-List-Bulk-Lots-on-TCGplayer
- TCGplayer lot requirements: https://help.tcgplayer.com/hc/en-us/articles/360008226493-Bulk-Lots-Seller-FAQ
- TCGplayer Marketplace rates: https://help.tcgplayer.com/hc/en-us/articles/23315007565079-How-to-Understand-Commissions-and-Fees
- Mercari fees: https://www.mercari.com/us/help_center/article/169/

Whatnot's current fee page describes a new September 2026 tier structure; it is
not included in this comparison. Reviewing the older single-card Whatnot model
is separate follow-up work, not evidence that its current rates were verified.
Dealer quotes, consignment, non-US sales, buyer-tax fee effects, insertion fees,
subscriptions, returns and payout-method extras are outside this model.

Validation uses synthetic cards, the shipped DOM and referenced bundles:
selling-plan browser/math 126 checks over 320/390/844/1280px; bulk draft 102;
Collection draft 44; existing flip/pack 100; photo preflight 26; binder 58;
asset fingerprints 111; test registry 12. Release build inspector passes.
Tests cover quantity, zero/missing/invalid prices, negative net, fee caps,
shipping, venue coverage, selected and whole-Collection entry points, edits,
cost allocation, native modal focus/Escape and no API calls.

No production scan, credit spend, listing publication or new saved card is
needed for verification. Production release evidence is recorded in the PR.
