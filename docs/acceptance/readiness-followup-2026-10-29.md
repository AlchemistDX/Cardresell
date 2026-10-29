# Readiness follow-up — 29 October 2026

## Changes in this release

The seller's comparison must reflect the membership the server has just confirmed. Previously, a comparison rendered before sign-in completed stayed on “Best free payout” with locked venues even while the header displayed Business. Pressing Calculate repaired it, but sellers should not need to discover that workaround.

`checkProStatus` now rerenders the current comparison after applying a successful, current-account membership response. It uses the existing local calculation; it does not scan, request new provider prices, change venue preferences, or grant access independently of the server. Error and stale-account responses retain their existing guards. Both upgrades and server-confirmed downgrades are exercised.

The price-research warning now says “Individual eBay sold listings unavailable.” A separate TCG Price Lookup eBay average can still be available. The sparse-sales message likewise refers to individual sales. No data source, price estimate, or sold-data entitlement is changed.

## Evidence

- Before the membership correction, the new full-app regression reproduced the failure at 390px and 1280px: 44 checks passed, 2 failed. Both failures were the stale paid-member comparison.
- After correction, the initial membership test passed 46/46, individual sold-data resilience passed 47/47, and the selling selection browser journey passed 150/150. The final membership test additionally checks server-confirmed downgrade behavior at both widths.
- On the previous live build, Business appeared in the header while “Best free payout” and locked venues remained. Clicking Calculate changed it to “Best net payout” and removed the locked-membership upsell. This independently confirmed the stale-render problem.
- The complete 176-entry release runner passed with exit 0 in 655.041 seconds. It explicitly skipped the real-store credential gate, production HTTP smoke, and optional condition interaction. The condition interaction was subsequently run separately and passed 17/17. Final membership checks passed 48/48; sold-data resilience 47/47; selling selection 150/150. Isolated fixtures do not constitute a purchase, real Seller Hub import, or physical-phone acceptance.

## Checklist reconciliation

| Area | Completed evidence | Still open |
|---|---|---|
| Main games | Eight supplied Pokémon/Magic/Yu-Gi-Oh! fronts and eight reduced-quality copies automatically matched in the recorded production acceptance, including Greninja. Exact-search ranking fixed in the preceding release. | Broader representative photos and a held-out benchmark; the small supplied sample cannot support a universal accuracy claim. Exact-versus-related search headings remain a usability follow-up, not a new mandatory question. |
| Pricing | Reported low/high endpoints, condition/freshness guards, usable market values, separately labelled aggregates, exact-grade isolation; clearer individual-sold warning in this release. | TPL account history entitlement and complete paid-plan field coverage. No fabricated ranges or market-wide individual sold feed. |
| Payout comparison | Immediate comparison, shared shipping assumptions, unknown purchase cost preserved, negative payouts retained; membership refresh corrected here. | Independent seller feedback on clarity and task time. |
| Drafts | Explicit creation, source information, consistent recorded shipping, correct active rows/count, export tutorial with hide/reopen and Seller Hub upload link. | Actual accepted Seller Hub CSV import. Direct publishing remains gated by seller policies/location setup and separate acceptance. |
| Inventory | Existing fixture workflows cover per-copy identity, costs, location, imports, backup/recovery, concurrent edits, sales and reconciled profit. | A fresh live cross-device seller journey; no customer inventory was edited for this audit. |
| Purchase/mobile | Existing payment/credit evidence is retained; automated fulfillment and browser checks are part of the release runner. | Current physical iPhone camera/rotation/background/poor-network acceptance. No new live purchase is claimed. |
| Commercial proof | Provider accounting/reporting tooling and prior plan confirmation exist. | Current invoice/usage reconciliation and independent 5–10-seller pilot. |

## Inputs needed to close the external gates

1. TCG Price Lookup plan details showing whether historical prices are included, plus current usage/billing exports for the provider cost reconciliation. No API keys or passwords are needed. The previously confirmed Ximilar subscription and provider permissions do not need to be reconfirmed.
2. A physical iPhone Safari recording/results for the existing camera checklist, followed by scan → comparison → draft download on the current release. Include permission retry, rotation and background/resume. Browser viewport tests cannot supply this evidence.
3. Seller Hub's upload result for an exported draft CSV in the intended account, with an editable accepted draft. Import acceptance is separate from publishing; no live listing needs to be published for this gate. Seller policies/location setup is needed only for the separately gated publishing path.
4. A broader independently labelled photo sample and pilot participants for accuracy/task-completion evidence. No invitations, purchases or advertising were initiated.

The original Luffy photo and two sports cases remain review cases; Union Arena remains unsupported. The major-game priority is satisfied for the supplied sample, not all future photographs. Do not advertise all games, unrestricted sold comps, automatic publishing, or automatic sales sync as completed.

The competitive list is not wholly complete. The release fixes are concrete software work; outstanding evidence and optional product follow-ups remain explicitly open.

## Release identity

- Application commit: `bc3babb4079bf6fd94873cf4ca930aa47ccae613`
- Deployment: `dpl_2wAbp4uw51sZ6YjGjPgAN48Mu7hc` (READY; both production domains assigned)
- Core: `js/core.ebb71974.js`, SHA-256 `ebb71974d59eba5b78e987c58361db5ff652d9bbbb37937136425e98ccbfc0f5`
- Index SHA-256: `1bb92bb1aec5438a84b55f1af7f8017e30e8a6a7b638aad3c01872ce340c17dd`

Sandbox and local release hashes agree. No provider/account configuration was changed.

## Production verification

The fresh browser reload at https://www.cardresell.org/ loaded `/js/core.ebb71974.js`. The saved Greninja selection restored with the Business header and “Best net payout” automatically, without clicking Calculate. The individual-sold warning appeared alongside the separately labelled $1.99 TPL eBay 7-day average; the provider market was $0.79 and reported asking endpoints $0.44–$1.50. These are observed provider figures, not independently appraised values. No scan, inventory, draft, purchase or marketplace listing write was performed.

Screenshot: [deployed membership comparison](screenshots/readiness-fixed-2026-10-29.jpg).

Post-deploy runtime sample: five error-level records were inspected; all five were Node DEP0169 `url.parse()` deprecation warnings on function startup. No application exception appeared in that sampled deployment/window. This is a bounded observation, not an ongoing uptime guarantee.
