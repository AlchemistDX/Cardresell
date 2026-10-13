# Bulk selling venues — October 13, 2026

Adds Full Grip Games, Meta TCG and Card Conduit to the venue picker and Pro/Business (including equivalent legacy) bundle: 18 venues, with Free/Starter at 2 and Casual at 9. No price, credit or billing changes.

The three new routes use whole-shipment cash quotes, not retail ratios. The Venues dialog has an entry that works without scanning 100 individual cards. The bulk/Collection selling planner also provides these buyers for the selected stack, even when retail prices are missing. Enabled venues and current plan access govern calculation; details and official links remain discoverable.

The seller enters the complete quote, postage/packing/insurance once, and additional payout/sorting/sleeve deductions. Blank costs are unknown, not zero. Acceptance must be explicitly confirmed. Changing the selection or stack count clears the old offer and acceptance. Unsupported games, known Japanese Pokémon, slabs, empty selections and Card Conduit Standard shipments over 2,500 cards are rejected. These routes do not enter the single-card retail payout ranking or upgrade-savings claims.

Card Conduit Standard models 10% of assessed wholesale value plus $0.03 per processed card, including valueless cards. If fees exceed value, buyer payout is floored at zero while postage still reduces the seller's net. Curated, Sorted and Auto-Sifted programs are not modeled. Full Grip and Meta TCG require live category quotes; published bulk prices are not a blanket offer for every card with a $1 retail value.

Public sources read on October 13 UTC (October 12 US Eastern):

- https://www.fullgripgames.com/buylistfaq
- https://www.fullgripgames.com/buylist/pokemon_singles-pokemon_bulk/2763
- https://metatcg.com/pages/bulk-buy-submission
- https://cardconduit.com/faq

Rules are publicly sourced, not company-verified. No affiliate agreement or referral link is implied; outbound URLs are official pages. Rates, limits, accepted condition and deductions must be checked before shipping. The calculator covers US sellers and USD only and does not submit or ship anything.

## Verification

- `tests/bulk-venues-browser.mjs`: 80 checks; real shipped page at 320, 390 and 1280px, fee arithmetic, game/condition limits, quote invalidation, plan gating, opt-in and keyboard behavior.
- `tests/selling-plan-browser.mjs`: 186 existing selling-plan checks.
- `tests/membership-venue-access.mjs`: 41 checks, server/catalogue/frontend count parity and existing access boundaries.
- `tests/fee-truth-offline.mjs`: 122 checks of existing fee behavior.
- `tests/asset-fingerprints.mjs`: 115 checks; new immutable asset URLs, historical assets retained.
- `tests/test-registry.mjs`: 12 checks, new browser gate registered.
- `git diff --check` and ordinary build entry pass.

These are focused synthetic checks, not a complete run of the repository's 118-part runner or live buyer acceptance. No customer credits or external purchases were used.
