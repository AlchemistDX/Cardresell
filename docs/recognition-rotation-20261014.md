# TCG recognition rotation correction

The recognition wrapper now sends `rotate: true` to Ximilar's TCG identification
endpoint. The provider documents this option as disabled by default and says it
corrects card orientation before identification:
https://docs.ximilar.com/collectibles/recognition (checked 2026-10-14).

This applies to TCG identification, including the identification step used during
Quick and Deep Grade. The sports endpoint keeps its existing request options; its
documented optional attributes do not list this flag. The image payload, one-image
request shape, 15-second deadline, confidence thresholds, candidate confirmation,
and failure/refund routing are unchanged. There is no new retry or provider call.

The real-wrapper tests in `tests/provider-timer-cleanup.mjs` replace only the
network boundary. They check the TCG/sports request contract, grading modes, the
high and medium confidence boundaries, close-candidate confirmation, missing
distances, low-confidence rejection, and one usage record per request. Existing
deadline and refund suites remain part of the release gate.

These checks verify request construction and decision handling. They do not
measure an accuracy improvement, resolve glare or obscured card details, prove
the provider's latency or billing for the option, or establish a cause for any
particular failed recognition. A full-resolution photo evaluation and physical
phone acceptance remain necessary before making recognition claims.
