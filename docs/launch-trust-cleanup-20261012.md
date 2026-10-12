# Launch trust cleanup — 2026-10-12

Public lookup and About copy now describes sourced guide values and estimated
payouts on available venues. Sign-in copy explains that the one-time welcome
credits follow eligible email verification. AI photo assessment is described as
an estimate, without promising a professional grade or naming an old model.

Retired pricing/shop DOM bindings remain inert for legacy initialization, but
superseded offer text and price/CTA attributes have been removed. The active
membership shop continues to use the server catalog. Current plan prices and
billing behavior are unchanged.

TCGplayer payout copy now describes Monday/Thursday initiation after eligibility,
with bank processing additional. The comparison no longer represents its payout
as a fixed 3–7 days after sale. Source checked 2026-10-12:
https://help.tcgplayer.com/hc/en-us/articles/201897958-When-does-TCGplayer-issue-payments
The published domestic eligibility rules depend on delivery/expected delivery;
holidays, disputes and international orders can extend the timeline.

Grading links use the accessible gold text token. Existing immutable assets are
retained; the changed core and grading CSS have new content hashes.

## Verification

- Full local regression runner, including the corrected current-offer assertions.
- Membership gate: all 38 suites complete successfully, with explicit markers.
- Gate fault checks: reject missing completion, partial execution, nonzero exit,
  and timeout; reject an early zero exit from the shared assertion harness.
- Mobile bulk draft flow: 112 checks; grading browser: 104 checks.
- Contrast/accessibility: 106 checks; asset extraction: 52 checks.
- Build inspector and whitespace check.

The test harness flushes final output before exiting. The membership gate now
requires successful process exit plus full completion, with a bounded timeout.
Legacy check scripts emit completion at the actual end of their assertions.

Live payment purchases were not repeated. eBay CSV import acceptance, provider
latency and external customer demand remain separate from these local checks.
