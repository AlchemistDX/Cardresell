# Local scan comparison optimization

Prepared October 13, 2026, America/New_York (October 14 UTC).
Release candidate based on production merge `a48e118`; not yet published.

The scanner compares cropped and uncropped perceptual hashes against 39,317
Pokémon and Magic catalog records. Its distance helper called general-purpose
`parseInt` twice for every hexadecimal character in every comparison. This
batch converts ASCII hex digits directly while retaining the same bit-count
calculation, uppercase handling, empty-string result, mismatched-length sentinel,
and malformed-digit behavior.

Only that conversion inside the first `hamming` helper changes in the core
application. Hash generation, crop detection, scoring weights, candidate gates,
record order, server identification, pricing, credit handling and finish selection
are unchanged. The new immutable bundle is `js/core.9cbeff3e.js`; the previous
`js/core.dea40438.js` remains available for cached pages and rollback.

## Measured result

`tools/benchmark-scan-distance.mjs` runs both actual shipped helper versions in
local headless Chromium 153.0.8010.0. Each sample performs three catalog scoring
passes using cropped/uncropped inputs: 471,804 distance calls. After warmup it
alternates old/new order for seven samples and checks identical score checksums.

| Measure | Previous helper | Candidate helper |
| --- | ---: | ---: |
| Median time for the three scoring passes | 320.5 ms | 46.3 ms |
| Individual samples | 315.5–332.4 ms | 45.1–50.1 ms |
| Score checksum | 9,531,857 | 9,531,857 |

The measured scoring-loop reduction is **85.6%**. This is an isolated local
Chromium result, not a claim about iPhone performance or end-to-end scan time.
Camera capture, image hashing, catalog downloads and provider latency remain
outside the measurement. Initial page payload size is not reduced by this work.

## Verification

- New registered distance suite: nine groups passed, including every lower/upper
  hex-digit pair against an independent bit oracle, all 65,536 byte-character
  pairs against the previous helper, and 1,000 deterministic 64-bit cases.
- Three full-catalog comparisons preserve every weighted score, best and second
  candidate, tie order, raw/cropped choice and candidate gate.
- Existing printing-evidence suite: 28 checks passed, including server verification
  after a close artwork match and preservation of canonical printing identity.
- Existing shipped bulk/finish browser suite: 54 checks passed at phone and desktop
  sizes, using synthetic services without paid scans or customer data.
- Configured build and whitespace checks passed.
- Full local regression passed: 118 suites executed successfully across 121
  runner slots; three optional/live checks were skipped (real hosted store,
  production HTTP probe in local mode, separately gated condition-pill check).
  The runner exited zero. Skips are not counted as passes. No new production
  scan or physical-phone acceptance was performed for this candidate.

Production publication requires the owner's final release approval. Existing
company outreach links remain live on the previous release. Paid advertising,
provider invoices and scheduled backup retention are outside this code change.
