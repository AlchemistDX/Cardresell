# Batch price explanations

Prepared October 14, 2026, from release `1e5546b134e06487a83b7ddfccb4a2b9466f8552`.

Batch rows now include a collapsed, keyboard-operable price explanation. Recorded
catalogue prices say “Market estimate”; seller overrides say “Your price”; prices
without recorded provenance say “Saved price.” Unavailable values are explicitly
distinguished from zero. Internal `comp` provenance is never presented as proof
of an actual completed sale.

The explanation distinguishes automatic finish guesses from seller choices and
unchosen condition from a seller's condition selection. Neither is presented as
independent verification. Amounts are per copy and before fees, shipping and
purchase cost. Provider update time is not fabricated from the local scan time.

Opening the disclosure does not change prices, fetch data, spend scan credits,
require confirmation or block saving. The existing optional Finish control and
automatic pricing continue to work. Sports lookup guidance now says price
research rather than promising live sold comparisons.

## Verification

The previous version failed the new estimate-label check. Browser tests exercise
actual scan/catalogue mapping against synthetic responses, then open and close
the explanation with the keyboard. They verify unchanged batch data and provider
request count, labels after seller price edits and finish repricing, zero and
missing values, unknown provenance, and escaping of markup-like finish/condition
text. Mobile and desktop layouts are included. No customer records or paid
provider operations are used. Final suite and live results are on the PR.

New assets: `js/ui.1b112ae9.js`, `js/scan-finish.ca87e059.js`, and
`assets/scan-finish.5ecc8b73.css`. Previous immutable assets remain available.
