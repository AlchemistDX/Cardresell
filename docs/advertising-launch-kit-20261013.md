# CardResell advertising launch kit

Prepared October 13, 2026. Start with a small campaign for active TCG sellers: identify cards, compare estimated take-home payouts, and prepare listing drafts for review. The first objective is ten outside paying customers who use the workflow, not a large visitor count.

## Primary ad

**Headline:** Scan your cards. Plan your next sale.

**Text:** Selling trading cards? CardResell helps identify supported cards from photos, compare estimated payouts after fees, and prepare listing drafts you can review. Explore grading costs and published wait times before deciding whether to submit. Start with the Free plan at cardresell.org.

**Call to action:** Try CardResell

**Visible qualification:** Photo-based identification and grade estimates need review. Prices and payouts are estimates; limits vary by plan.

## Short video alternative

**Headline:** What could you keep from your next card sale?

**Text:** Compare estimated payouts across your supported selling options. Then prepare your card details as a listing draft, ready to review. Try CardResell free.

**Call to action:** Compare your cards

Keep a readable “Estimated payouts. Plan limits apply.” caption alongside the comparison screen.

## Thirty second demo outline

Use a real supported card and the released mobile interface. Keep any waits visible or label edits as shortened. Hide account details, customer data and identifiers. Use a card photo you have permission to show.

| Time | Screen recording | Voiceover |
| --- | --- | --- |
| 0–4 seconds | Card on desk, then camera or upload control | “Got cards to sell?” |
| 4–10 seconds | Identify one card and review the match | “Identify your card from a photo, then check the match.” |
| 10–17 seconds | Payout comparison with fees visible | “Compare estimated take-home payouts before choosing where to sell.” |
| 17–23 seconds | Grading comparison with fee and wait-time lines visible | “Considering grading? Check the costs and published wait times.” |
| 23–27 seconds | Create a draft and open its review screen | “Prepare a listing draft and review the details.” |
| 27–30 seconds | CardResell name, URL and Free plan call to action | “Try CardResell at cardresell.org.” |

This is a recording script, not a produced video. Do not show an eBay import success screen until an actual seller-account import has been accepted. Downloading a CSV does not establish acceptance or publication.

## Offer and destination

Lead with the Free plan so visitors can evaluate their own cards. For regular sellers, show Pro as an option at $19.99 USD per month with 250 ID credits and 40 Grade credits monthly. Paid plans renew until canceled; cancellation takes effect at period end. Quick Grade uses 1 Grade credit and Deep Grade uses 2. Issued credits do not expire. Reconfirm the displayed catalogue before publishing price-led creative.

Use one source label per channel:

| Placement | Destination |
| --- | --- |
| Paid Facebook or Instagram | https://www.cardresell.org/?cr_campaign=meta_ads |
| YouTube demo | https://www.cardresell.org/?cr_campaign=youtube |
| Authorized Discord promotion | https://www.cardresell.org/?cr_campaign=discord |
| Card shop QR | https://www.cardresell.org/?cr_campaign=shop_qr |
| Company outreach email | https://www.cardresell.org/?cr_campaign=email_outreach |
| Internal checks only | https://www.cardresell.org/?cr_campaign=qa |

Labels group traffic by channel. Creative-level attribution is not implemented. Use one creative at a time per channel if you need an interpretable first comparison, and retain the ad platform's spend report separately. Do not put email addresses or customer identifiers in these links.

The email-outreach label is included in the October 14 outreach-readiness candidate; use its dedicated reporting bucket after that release is deployed. Company outreach is measured separately from paid ads. Email security scanners and repeated visits can affect counts; an observed visit does not prove that a recipient personally read an email. For a product overview, use `/about`; direct fee corrections and collaboration questions to `/contact#fee-updates` and `/contact#partnerships`. Those standalone information pages do not emit the app's acquisition events; use the tagged app link as the primary email destination.

## Daily measurement

Read the existing protected event report with `breakdown=campaign` for the same UTC reporting dates as the ad platform. Keep its admin credential private; do not put report links containing it in messages or screenshots. Exclude `qa` and owner testing.

| Signal | Meaning and limitation |
| --- | --- |
| `page_view` | Observed entry, deduplicated per browser tab and channel; not unique visitors. |
| `authenticated_visit` | A signed-in visit observed once per tab and channel; not a new signup or unique account. |
| `id_scan_completed`, `grade_completed` | Reported completed tool use; repeated uses count again. |
| `listing_draft_created` | A newly created draft; opening an existing draft and replayed requests are excluded. |
| `listing_export_download_started` | Browser download initiation after file preparation. Not proof of saving, eBay import or a published listing. |
| `listing_export_failed` | Export attempt failed. Repeated attempts count separately; canceled preparation is not counted as a successful export. |
| Membership checkout events | Observed checkout progress. A verified return can be missed when a buyer never returns. |
| Fulfilled paid checkout record | Payment and fulfillment evidence. Reconcile against Stripe, excluding tests, duplicates, refunds and owner purchases. |

Browser counts are aggregate, best-effort, client-reported events. They are not a joined customer funnel, an exact conversion rate or revenue. Ad blockers, repeat actions and tabs affect counts. Campaign labels are client-reported and can persist for 30 days after a non-direct visit; they do not prove an ad caused a purchase. Checkout metadata carries the acquisition label for initial purchases, not automatic renewal attribution.

For the first seven days, record channel, spend, observed visits, signed-in visits, completed scans, drafts, download starts, export failures, distinct outside paying customers and collected payments less refunds. Reconcile each counted paid customer with a fulfilled payment rather than a browser event.

Calculate acquisition cost as spend divided by distinct new outside paying customers. If there are none, report “no acquired paying customers” rather than zero acquisition cost. Compare acquisition cost with realized contribution after payment processing, credits consumed, provider usage and refunds; subscription price alone is not profit or lifetime value.

## Test and scale decisions

A proposed first paid test is $10 per day for seven days, capped at $70 total, on one channel with one creative. This budget has not been approved or spent. Confirm the cap and the chosen placement before activating any campaign.

Review after day three and day seven. Pause immediately for broken checkout, missing paid credits, customer data exposure or repeated scan/export failures. With working tools but weak activation, fix the landing message or first-use step before increasing spend. Ten outside paying users is an initial learning target, not proof of repeat retention or profitability.

Before broad spend, confirm the first scheduled daily backup and its retention, reconcile provider usage with billed costs, and refresh aging fee sources. The October 13 workflow review records the earlier isolated manual restore and later daily-backup enablement; do not repeat that completed drill or treat it as full application failover. Keep grading fees and turnaround dates within their published freshness window, and recheck the current grading snapshot before October 26, 2026 UTC. Provider permissions and Ximilar low-credit warnings have already been addressed; do not reopen those as launch blockers.

## Claims to keep out of the campaign

Do not promise guaranteed grades, guaranteed profits, an accuracy percentage without validation, instant grading-company turnaround, automatic live listing publication, successful eBay bulk import before seller-account acceptance, or a measured time saving that has not been measured. State AI grade estimates and mixed-grader price guides as estimates wherever shown.

The first campaign can advertise the verified scan, comparison and draft-preparation workflow while eBay import acceptance remains a separate verification item.
