# Company outreach readiness

Prepared October 13, 2026, America/New_York (October 14 UTC).

Status: release candidate prepared for review; production publication pending.

Final local regression: **117 suites passed, 3 optional/live slots skipped**
across the 120-slot runner; exit 0. The skipped slots were the real hosted-store
test, the runner's production HTTP probe, and the separately gated condition-pill
interaction. The public production HTTP probe was run separately as recorded
below. Build inspection and whitespace checks also passed. Skips are not passes.

## Release scope

The public About link preview still promised live sold-comparison prices, and
the Contact page mixed support, billing, and business inquiries with conflicting
response-time expectations. These are prominent pages for companies evaluating
an outreach email.

The candidate provides a concise product overview, a three-step seller workflow,
low-value-card guidance, and prominent links into the app and methodology. It
states the limits of pricing, photo grade estimates, and listing drafts. Contact
has direct sections for product support, fee/data corrections, and partnerships,
with useful email subjects and one consistent response-time expectation. All
routes use the existing public inbox. Secondary text is more readable.

The app and server accept the fixed `email_outreach` acquisition label. It stays
with the existing 30-day local attribution and reaches the protected event report
and checkout metadata. Arbitrary recipient text is not an accepted label.
Standalone About and Contact pages do not emit the app's acquisition events.

No membership entitlement, fee calculation, scan debit, account-grant logic,
customer data, or marketplace publishing behavior changes in this candidate.
Bulk scanning keeps automatic prices and the optional Finish / printing picker.
The full regression run also exposed an intermittent saved-grade cleanup race:
the native dialog close event is queued, so the old report could remain in the
hidden DOM after an account switch closed the dialog. The owner-change handler
now clears private content synchronously before calling `close()`. A deterministic
check inspects content at the close boundary, retaining the existing account
isolation assertions. The new immutable asset is `grade-history.6100a33d.js`;
the previously shipped asset remains available for cached clients.

## Links for the owner to use after publication

| Use | Destination |
| --- | --- |
| Main email link, with aggregate outreach attribution | https://www.cardresell.org/?cr_campaign=email_outreach |
| Short product overview | https://www.cardresell.org/about |
| Fee, buylist, or grading-data corrections | https://www.cardresell.org/contact#fee-updates |
| Partnership or integration discussion | https://www.cardresell.org/contact#partnerships |

One channel label groups the campaign; it does not identify individual companies
or prove that a recipient read an email. Mail scanners, repeat visits, and browser
privacy controls affect counts. Record actual replies and company confirmations
separately. Do not mark a company or fee schedule verified merely because a
message was sent.

The existing outreach draft describes estimated proceeds and preparing cards
for sale, which matches the released product's scope. Automatic eBay sold-data
access remains degraded; successful marketplace import and publication are not
established by downloading a draft file.

## Verification and publication

The baseline is `4f08482` on `codex/profit-readiness`. Its tree exactly matches
production commit `7d3edc0` and recovered local welcome commit `0f6c8e2`.
Production was READY at `dpl_Hm3k1hvGGtcYDscjc7HRgbvuJoXc` when inspected.

Targeted checks passed: 802 brand/navigation checks, 108 customer-journey checks,
224 copy checks, 157 asset checks, 29 acquisition checks, and 570 checkout
transport checks. Browser checks use synthetic accounts/catalogues. Checkout
checks use an isolated per-process Redis store and simulated Stripe responses;
no real purchase or customer credit was consumed. About and Contact were viewed
at phone and desktop widths; narrow-screen anchor navigation clears the header.

The current production API smoke returned 17 passing checks, one degraded
(automatic eBay sold data), and zero failures. It is evidence for the current
release, not the unpublished candidate. The one-hour production error-log sample
contained four `url.parse()` deprecation warnings and no application exceptions;
this is a sampled window, not a historical reliability guarantee.

The first full regression run exposed six browser-harness dependencies on a
previous workspace or default browser installation. They now resolve the local
Playwright dependency and respect `CR_CHROMIUM`, preserving their assertions.
It also exposed an outdated printed-name-rescue assertion requiring an unpriced
row. That assertion now enforces the owner's restored automatic-price behavior,
checks that the finish remains an estimate, and prohibits invented foil evidence
or mandatory per-row confirmation. No scanner implementation was changed.
The final regression gate includes the deterministic grade-history close-boundary
check after the synchronous cleanup fix.

Three additional legacy suites needed alignment with already shipped behavior:
Collection links use the identity-bound card snapshot, saved automatic finishes
carry `finishEstimated`, and removing old welcome text legitimately reduced an
accessible-color occurrence count. The tests retain the exact saved-field union,
identity capture before opening, zero raw gold text, measured 4.5:1 contrast, and
the existing runtime contrast coverage floor. No application behavior was changed
to satisfy those stale assertions.

## Remaining work beyond this release

Company outreach and a broad paid-acquisition campaign are different milestones.
The October 13 workflow review records the manual restore drill and later daily
backup enablement; remaining recovery evidence is the first scheduled snapshot
and retention. Reconcile provider invoices with completed tool use before scaling
paid acquisition. Refresh aging venue schedules using authoritative replies and
sources. Existing provider-permission and owner phone/payment acceptance are not
reopened by this pass. No company email or paid campaign was sent or activated.

Production publication remains a final owner decision under the previously
established release rule. The code and checks are prepared for that review.
