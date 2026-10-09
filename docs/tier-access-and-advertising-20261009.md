# Tier access and advertising readiness — October 8, 2026 Eastern

## Correction and saved-grade release

The prior release exposed a real gap: batch grading was hidden and used an obsolete API response. This release repairs the normal Grade → Bulk Grade → Upload path for Pro/Business, with up to 10 ordered photo sets per batch, a labeled photo review before charging, sequential processing and durable request recovery. Quick uses front/back; Deep uses six photos. Native batch camera capture remains unavailable. Credits are server-confirmed; uncertain responses pause the queue and recover the same operation without a second charge. Closing while processing waits for the current card.

Private saved AI grades are included on every plan: explicit Save grade after a single result or Save grade reports after a batch; Collection → Saved AI grades; authenticated storage; reopen, JSON download and delete. Maximum 500 reports per account, no automatic expiry and no additional credits. Photos are excluded. Existing manual Grading Log remains separate. Earlier unsaved results cannot be recovered. Saving is explicit, with failures visible and retryable. Stable analysis identifiers prevent duplicate recovered reports.

Validation includes 24 real browser-to-handler/Redis checks through the normal mobile entry, plus the 21-check grade-history suite. Authentication/provider responses are synthetic; no live customer credits were consumed. This is engineering verification, not physical phone or new authenticated production acceptance.

Listing policy remains the default legacy 500 saved drafts per account, individual or selected bulk-scan draft creation, no separate ID/Grade charge for drafting. Proposed tier draft/monthly/storage limits remain disabled. eBay export prepares marketplace drafts; no automatic publishing or cross-posting is offered.

## Scope
Continue from production fdf66b4. Ship consistent tier benefits and access, correct public offers, and close the remaining software launch defects. Do not purchase ads, send outreach, change prices/allowances, rebind accounts, or treat device/provider acceptance as completed.

## Launch feature decisions

| Benefit | Free | Starter | Casual | Pro | Business |
|---|---|---|---|---|---|
| Monthly price USD | $0 | $4.99 | $9.99 | $19.99 | $49.99 |
| Monthly ID / Grade credits | 5 / 1 | 25 / 5 | 50 / 15 | 250 / 40 | 750 / 100 |
| Supported comparison venues | 2 | 2 | Up to 9 | Up to 15 | Up to 15 |
| Extra pack savings | None | None | 10% | 15% | 25% |
| Single-card ID, Quick/Deep estimates | Yes, using credits | Yes | Yes | Yes | Yes |
| Existing local flip tracking | Up to 10 | Beyond 10 | Beyond 10 | Beyond 10 | Beyond 10 |
| Grading Log export | Existing paid gate | Included | Included | Included | Included |
| Quick/Deep batch uploads, up to 10 cards | No | No | No | Included | Included |
| Private saved AI grade reports | Included | Included | Included | Included | Included |
| Listing drafts | Existing account/technical limits on every plan; no new tier limits advertised |
| Cloud photo allowance / automatic publishing | Not sold as operational plan benefits |

Verified eligible accounts also receive 10 ID + 1 Grade once. Credits do not expire. Quick Grade costs 1 Grade credit; Deep costs 2, subject to the existing explicit fallback/refund policy. No tier receives a different grading-accuracy promise. Business buys capacity and pack savings, not exclusive accuracy.

The default Free/Starter comparison venues are eBay and TCGplayer. Game support and selected venues affect availability. Local flip/export gates are interface features over local data; they are not server-held inventory quotas. Existing audited Free/legacy capability exceptions are preserved; a browser/email claim does not grant one.

## Enforcement and preservation

- `_membershipFeaturePolicy.js` defines the paid feature policy separately from billing amounts.
- The atomic consumption operation resolves paid access from the validated current invoice allocation and Redis time. Pro/Business enable batch grading during paid-through access. Starter/Casual deny it. Future scheduled plans grant nothing early.
- Debit and earned-retry admission enforce access again atomically. Expiry removes batch access but preserves issued credits, completed-operation replay and exact-source refunds.
- Existing legacy capability records remain compatible; expired paid periods cannot retain batch access.
- Browser access uses the identity-bound server capability; mismatched/missing snapshots fail closed. Removed the owner-email UI bypass and retired Pro Max labels from the active batch screen.
- Storefront source and shipped asset now agree. The pricing generator refreshes amounts/features without reverting the reviewed design and descriptions.
- First-account status reads distinguish missing enrollment (409 setup required) from corrupt/unavailable billing (503). They do not fabricate balances or enroll accounts.
- About, Terms, Contact and Accuracy now match monthly plans, estimated pricing, supported catalogue coverage and confirmed/pending refund behavior. No new fee verification date or accuracy percentage is claimed.

## Verification evidence

Full 89-slot local runner completed. Its only failed suites were stale assertions in copy-truth, entitlement wording and mobile a11y. After updating those assertions to the approved behavior, targeted reruns passed: copy truth 224, entitlements 78, a11y 177. Existing opt-in skips remain skips.

Focused tests: consumption 141 (including paid-plan access, concurrent replay, expiry, retry denial and refunds); normal HTTP routes 143 (all four paid plans, provider-call gating, exact charge, setup status and existing refund fault cases); venue/frontend feature policy 41; storefront 201; catalogue/purchase routes 52; immutable assets 105. Browser integration 590 checks across four viewport sizes and both themes, using synthetic account/catalogue data. No paid provider requests, purchases or customer credits used.

This is engineering verification, not a claim of new live Stripe subscription acceptance or physical iPhone acceptance. Existing live payment and Gmail onboarding evidence is retained in the earlier readiness log.

## Advertising release gates

Completed software work: current pricing and upgrade benefits; authoritative batch access; honest public disclosures; mobile navigation; existing conversion attribution and provider usage instrumentation; documented credit-refund recovery.

Still open:
1. Physical iPhone acceptance of the latest camera guidance/capture lifecycle. Use the six unpaid checks in `camera-phone-acceptance-20261008.md`; do not submit a paid grade just to test the camera.
2. Owner's October 6 condition: keep public admission restricted until the live Deep-to-Quick fallback policy is accepted. Fault paths pass isolated real-Redis/HTTP tests, but a naturally occurring live fallback has not yet been accepted. Do not deliberately break a production provider to create one.
3. Public audience release after those conditions: production audience variable is configured; no admission setting changed in this release. Pricing continues to disclose pilot-only purchasing. Verify a newly eligible account can enter, verify, receive its one-time credits exactly once and reach checkout before directing public traffic.
4. Before paid ad spending/scaling: reconcile Ximilar grading usage/overage policy and representative all-in provider costs. Historical scenario margins are not realized profit. No ad budget or purchase is authorized by this document.

Outlook/school inbox placement remains unmeasured, but Gmail email/password onboarding and a non-Gmail delivery path were accepted earlier. Do not misreport all email signup as blocked.

Production error review in the hour before this release showed eBay sold-search 403s and Node URL deprecation warnings. The interface must retain manual marketplace search and must not advertise guaranteed in-app eBay sold comps. These findings are not a new scanner/ledger outage.

No percentage of overall product completeness is asserted. Public paid advertising remains gated by the checks above.

## Prepared message and attribution

Ready-to-use message after admission acceptance:
“Before you sell your next card, compare what you could keep after fees. CardResell helps you identify supported cards, review available market prices, and compare estimated payouts. Start free at cardresell.org.”

Short demo sequence: identify a supported card; confirm its exact printing; review the price source; compare eBay/TCGplayer payouts using stated assumptions; show the listing draft/handoff. Show photo grades only as estimates. Do not imply automatic publishing, guaranteed sales, professional grading, or unavailable sold data.

Existing bounded tracking supports these prepared links:
- Shop sign/QR: https://www.cardresell.org/?cr_campaign=shop_qr
- Discord/community: https://www.cardresell.org/?cr_campaign=discord
- Video: https://www.cardresell.org/?cr_campaign=youtube

Track entry → verified account → first successful identification → subscription/pack checkout → server-verified fulfillment. Browser events help diagnose conversion; Stripe and the ledger remain authoritative for revenue and credits. Measure failed scans/refunds and provider costs alongside conversion. No outreach or campaigns have been sent or purchased.
