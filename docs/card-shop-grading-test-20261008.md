# Card-shop grading test — October 8, 2026

Goal: measure useful pre-grading estimates and repeatability. A shop opinion is
valuable feedback, but is not a certified PSA result. Keep it separate in results.
Do not adjust the app to agree with a handful of meeting cards and then score
those same cards as independent validation.

## Before starting

Open a fresh page at https://www.cardresell.org. Use the same phone, lighting,
distance and neutral background throughout. Record starting Grade credits.
Use only cards the owner permits you to photograph. Avoid filters or edits.
Keep the card flat, square to the camera, in focus, with all edges visible.
Use even light; take another angle for reflective surfaces. Do not remove cards
from sealed slabs. Slabbed-card results must be marked as through-plastic.

Aim for 10–20 different cards if time allows, spanning clean, visibly worn,
creased/dented, off-center, foil, older and newer cards. This is a pilot sample,
not proof of a population accuracy rate. Do not select only successful scans.

## For each card

1. Assign an anonymous ID (C01, C02, …); record name, set, number, language,
   finish and raw/slabbed status. Verify identification before assessing grade.
2. Ask the shop to write its independent assessment and reasons before seeing
   the app output. Keep any known certified grade outside the app's photographs.
   Mark a result **not blind** if the label/grade was visible to the app.
3. Run Deep Grade using front, back and the requested edge photos. Ordinary
   grading credits apply. Save the complete result, including confidence,
   limiting factor, centering ratios, centering source and any fallback notice.
4. Reveal the independent assessment. Record both values without replacing
   either. Mark the reference as shop estimate or certified, and record grader.
5. Record elapsed time, credits charged/refunded, wrong identity, unresolved
   result or error. Preserve failures and screenshots alongside successes.

## Repeatability and app checks

- Pick three cards covering different conditions. Take three fresh photo sets
  per card under the same setup. Keep every run; do not pick the best result.
- If time/credits permit, compare Quick and Deep for those cards separately.
- Confirm the shown set/number/variant and catalog image match the card.
- Check that the final estimate, label and distribution agree. Percentages are
  uncalibrated AI weights, not validated grading probabilities.
- Verify a partial measurement says partly measured, rather than fully measured.
- Check front/back retake, cancel, and return to the card without losing context.
- If Deep Grade falls back, record its notice and the actual credit adjustment.
  If an adjustment is unconfirmed, preserve the support reference and do not
  retry repeatedly. No purchase or account changes are needed for this test.

## Recording template

For each attempt capture:

| Field | Example / allowed value |
|---|---|
| card_id / mode / attempt | C01 / deep / 1 |
| status | success, unresolved, error |
| identity_correct / blind | true or false; unknown can be null |
| capture_type | raw, slabbed, unknown |
| app_grade | numeric estimate, or null if unavailable |
| reference_type | shop_estimate, certified, pending |
| reference_grader / reference_grade | PSA / 9; or shop name / 8 |
| additional notes | raw/slabbed, lighting, timing, credit change, flaws, screenshots |

Save attempts as a JSON array for the offline scorer:

```json
[
  {
    "card_id": "C01", "mode": "deep", "attempt": 1,
    "status": "unresolved", "identity_correct": null, "blind": true,
    "app_grade": null, "capture_type": "raw", "reference_type": "pending",
    "reference_grader": "", "reference_grade": null,
    "notes": "Replace this blank record with the observed result."
  }
]
```

`node tools/score-grade-benchmark.mjs attempts.json` uses no network or credits.
It reports exact agreement, within-one agreement, mean absolute error, signed
error, false predicted 10s, repeat ranges and exclusions. It keeps Quick/Deep,
shop estimates and different certified graders separate. Only the first attempt
per card/mode contributes to accuracy; repeats measure consistency. Non-PSA
certified grades are cross-standard comparisons, not PSA ground truth.

Send the recorded results and screenshots back after the meeting. Raw cards
submitted for formal grading remain pending until their actual results arrive.

Photo setup reference: [Ximilar grading documentation](https://docs.ximilar.com/collectibles/card-grading). Its service is intended for soft/pre-grading from photos. No accuracy percentage is inferred from that documentation.
