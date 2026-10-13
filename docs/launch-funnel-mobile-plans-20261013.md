# Launch funnel and mobile plans verification

October 13, 2026 UTC.

## Changes

- Add an authenticated-visit observation once per tab and acquisition channel. It does not represent a new signup or unique person.
- Recognize new draft creation, export download initiation and export failures in campaign aggregates. Replayed draft requests are excluded from creation counts.
- Export observations use fixed single/selected and size buckets. Server-side listing telemetry accepts only these dimensions and the bounded acquisition channel; card, owner, file and arbitrary source data are excluded.
- A batch produces one download event, not one event per prepared row. Failed batches do not produce success events; cancellation produces neither success nor failure.
- Put plan price, compact catalogue allowances, draft limits and the purchase/sign-in action before closed Plan details. Renewal and Quick/Deep usage remain visible; detailed benefits and billing explanations remain available.
- Retain previous immutable assets. New active assets: core.8f4079b6.js, auth.1aca8ff5.js, membership-shop.6b3f4693.js.

## Verification

- Full local runner: all 115 local suites passed; three named live/opt-in suites were skipped by `--local`. Registry covers 118 slots. This is not a live-provider acceptance test.
- Acquisition tracking: 27 checks passed.
- Membership identity and storefront: 256 checks passed.
- Draft card actions in a real local browser: 146 checks passed.
- Plan layout at 320, 375, 430 and 1280 pixels: five cards fit without horizontal overflow; details start closed and open; action and summary targets are at least 44 pixels. Uses real shipped CSS and shop code with a synthetic public catalogue response, not a production purchase.
- Build inspection and whitespace checks passed.
- The first full run reported two failures in newly added export assertions because the capture also included unrelated payout observations. The test capture was restricted to export event names. The focused suite and entire local runner then passed. No application change was needed for that correction.

## Measurement limits

These are aggregate, best-effort browser observations, not unique people, joined user journeys or revenue. Download-start does not prove a file was saved, imported into eBay or published. Continue reconciling paid customers with authoritative paid and fulfilled records. Actual eBay seller-account CSV acceptance remains unverified.

The launch kit contains usable copy, a recording outline and channel links. No video has been recorded and no advertising spend has been activated. An isolated backup restore drill and aging fee-source refresh remain before broad scaling. Existing provider permissions and Ximilar low-credit warnings are already addressed.
