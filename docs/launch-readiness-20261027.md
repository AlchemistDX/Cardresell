# CardResell launch readiness — October 27, 2026 (America/New_York)

The seller workflow remains the release priority: find or identify the exact card, see estimated fees and take-home amounts immediately, choose a price, and prepare an editable draft. This release removes the temporary ±15% asking-price buttons. It does not start an advertising campaign.

## Current checklist

| Work | Status and evidence |
| --- | --- |
| Show fee comparison without opening a dropdown | Shipped in PR #141; preserved and covered again in the pricing browser journey. Selling questions remain optional. |
| Replace fixed percentage low/high | This release uses current, condition-matched reported TCGplayer endpoints. A usable low or high survives when the other endpoint is missing. Zero, invalid, stale and conflicting endpoints do not create a range. |
| Keep the market value usable | Market remains available even when outside the listing range. Missing or zero TCGplayer market can fall back to a positive, explicitly sourced eBay aggregate already in the feed. The market value automatically drives fee comparison; selecting another value updates fees and the draft asking price. |
| Show available sold evidence accurately | A condition/grade-matched eBay 1-, 7- or 30-day average from TCG Price Lookup can be offered separately. It is an aggregate, not individual sold comparisons, a confidence interval, or a promised sale price. Duplicate amounts do not create duplicate buttons. |
| Correct price freshness | Use the TCGplayer quote's `last_price_update` for raw asking prices. A catalogue `updated_at` or another source's timestamp cannot refresh those asks. Old or undated asks cannot drive the buttons or range bar. |
| Help sellers finish draft export | PR #142 ships single/bulk export guidance, “Don't show again,” a reopen control, and the eBay Seller Hub Reports upload link. The download is still a draft for seller review. |
| Explain eBay Connect | Account connection does not grant restricted market-wide sold-history access. Direct eBay publishing remains disabled. Connecting is not required for CSV export. This release makes no automatic-listing claim. |
| Provider permissions | Previously confirmed by the owner; not reopened as missing. TPL plan/history entitlement is a separate unconfirmed item. |
| Payment/credit fulfillment and phone use | Earlier owner evidence remains valid: reviewed payments matched the intended accounts and credit grants, and physical-phone workflows were confirmed. This release does not claim to repeat a live payment or physical-phone test. |
| Backup/restore | Carry forward the earlier restore drill and the owner's October 14 scheduled-backup evidence (6.37 MB, one-day retention). No new restore or changed retention is claimed here. |

## Provider findings and cost boundary

Read-only production searches sampled Charizard, Pikachu and Lightning Bolt. Many condition rows had a positive market value but zero low/high. Some had a narrow real listing range with market outside it. Requiring market to be between listing endpoints discarded useful information; generating ±15% would not repair the missing observations.

The existing response already includes eBay aggregate averages for some exact selections, so this improvement adds no provider request. TCGplayer's Market Price and listed asking prices measure different things. TPL's documented history route could support a separately labeled historical market view, but the account's plan and history entitlement are not confirmed. No history endpoint, paid upgrade or new billable lookup was enabled.

Production TPL request guards were read, not changed: enforcement on, 400 per 3,600-second global window and 60 per IP. These are request limits, not proof of the subscribed allowance or a dollar spending cap. Ximilar's owner-confirmed subscription is $70/month for 100,000 credits; actual Quick/Deep paths, retries, other provider charges and gross margin still need reconciliation against invoices/usage.

References:

- [TCGplayer price-point definitions](https://help.tcgplayer.com/hc/en-us/articles/222376867-What-do-the-different-price-points-on-TCGplayer-com-mean)
- [TCG Price Lookup FAQ](https://tcgpricelookup.com/faq)
- [TCG Price Lookup history API](https://tcgpricelookup.com/docs/api-reference?endpoint=price-history)
- [eBay restricted API availability](https://developer.ebay.com/api-docs/buy/static/ref-marketplace-supported.html)

## Release verification

Focused verification completed against the shipped entry document and its referenced assets:

- Price evidence and exact-card/printing matching: 52 checks passed, including zero/missing endpoints, stale quote dates, invalid markets, graded source attribution and wrong-condition refusal.
- Pricing browser journey: 219 checks passed at 320px, 390px and 1280px, with light/dark screenshots, immediate fee comparison, condition changes, hand-entered prices and draft request contents.
- Captured production response replay: nine actual returned cards, NM and LP each (18 selections), including market outside the listed range and missing endpoints. No additional provider calls were made for the replay. Mobile screenshots with both two and four choices were inspected.
- Configured build and whitespace validation passed.

The final complete regression run passed: **170 suites executed successfully out of 172 registered**, with two explicit skips (real-store credentials and the local runner’s production HTTP smoke). The condition-pill browser gate was enabled. Skipped checks are not passes. Automated browser journeys isolate provider/auth/write endpoints and do not purchase credits, upload listings to eBay, or certify physical-card recognition accuracy. After deployment, the production domain must serve the exact tested assets and pass the pricing browser journey with APIs intercepted; those results belong in the release record, not in a claim of live customer-account writes.

## Remaining evidence before expanding advertising

1. **Current real-phone acceptance:** complete the owner's planned live run with original card photos on the intended phone/browser. Cover exact printing/finish, a wrong or ambiguous match, condition changes, fees, save/reload and draft/export. Record failures rather than treating screenshots or synthetic inputs as an accuracy benchmark.
2. **Original-photo benchmark:** label a representative physical-card set and measure exact-card/printing accuracy, abstentions and retries. No defensible percentage is available yet.
3. **Real Seller Hub import:** import a generated draft CSV in the intended seller account and check the accepted fields/validation results. A correct download and upload link do not prove eBay acceptance or publication.
4. **Unit economics:** reconcile current provider plans, allowances, actual billed usage and retry costs with Quick/Deep and paid-credit revenue. Confirm TPL history entitlement before committing to historical-range work.
5. **Small seller pilot:** after the above acceptance results, review 5–10 invited sellers completing useful tasks before broad paid traffic. Earlier owner purchases are not outside-customer conversion evidence. No invitations or ad spending were sent by this work.

The working readiness estimate remains about **85%**, as a planning judgment rather than a measured score. This release closes concrete product issues; automated passes alone cannot close the real-photo, seller-account or billing evidence above. Automatic individual eBay sold comps and direct publishing are not promises for the first launch.

Rollback baseline: production commit `4cb05b27284ae20c2fecbe40cf19b615cd4db867`, deployment `dpl_gqy6kin6ECXTwo7WXNnQGRFreL1u`. Release integration continues on `codex/profit-readiness`; `main` remains unchanged.
