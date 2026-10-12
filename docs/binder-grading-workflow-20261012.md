# Binder capture, grading decisions and listing handoff — October 12

This change starts from production PR #44. It does not change scan billing,
provider integrations, membership allowances, or publish eBay listings.

## Binder capture and adjustment

The Binder page flow now opens a rear-camera preview with a pocket guide for
its selected layout. The guide and the captured crop use the same normalized
bounds. Camera access starts only after the camera button is pressed. Audio is
not requested. Capturing, cancelling, hiding the page, closing the scan flow,
and a permission result arriving after cancellation all release camera tracks.
Permission denial leaves the camera-roll picker available.

After capture or upload, sellers can drag the photo under a fixed grid, zoom,
use arrow buttons/keys, rotate 90 degrees, reset automatic fitting, or use the
existing individual edge controls. Adjustments regenerate the actual submitted
JPEG crops, not just the preview. Old crop selections cannot be submitted during
an adjustment. Images stay within original source pixels, preserve the existing
padding, and still fail the existing 400px minimum if zoomed too far. No upscaling,
provider calls or credit deductions occur while fitting and reviewing pockets.

This is rectangular alignment, not perspective correction. An angled page may
need a straight-on retake. Hardware camera resolution and iPhone Safari behavior
still need device acceptance; the browser checks use a synthetic camera stream.
Captured camera pages currently enter one-page review; camera-roll multipage
upload retains the existing combined confirmation flow.

## Grading comparison

The existing automatic eligible service selection, tier dropdown, shipping
inputs, shared eBay fee engine, optional capital rate, and lower-grade disclosure
remain. The new layout makes service name, working-day turnaround, approximate
calendar months, and difference versus raw visible in collapsed outcomes.

A live comparison shows raw proceeds and the highest available conditional
outcome for the selected grader. It explicitly does not call that outcome likely,
realistic, or a recommendation. Missing prices are excluded. A positive scenario
gets a border highlight; raw-ahead differences remain visible. The raw net updates
with the same sale-shipping input used for graded net.

An optional other-cost field covers grading tax, supplies and time cost. It is
subtracted once from proceeds and included in the capital basis if capital cost
is enabled. Zero excludes those costs. Blank shipping remains visibly incomplete;
proceeds are not profit after the card's acquisition cost.

CSV export includes card identity when available, grader, every outcome, price
basis, service, wait, each cost, net/difference, rate/extra-days assumptions,
snapshot/export dates and missing-cost qualifications. It saves a portable
comparison; it does not add a new cloud Grading Log record.

Deep Grade's `psa_distribution` is explicitly an uncalibrated model distribution
in `api/_gradeEvidence.js`. This change does not turn it into calibrated expected
profit or apply PSA weights to other companies. PriceCharting's current mapped
guide fields do not supply individual sale dates or sample sizes, so those are
marked unavailable rather than invented.

Official fee and wait sources: PSA and CGC direct pages were rechecked October
12; their published times agree with the existing same-day snapshot. SGC's
indexed official pricing page confirms its Standard 40+ day / $50 opening
bracket. Beckett's official page confirms only Express is currently open; its
form could not be re-read through the search tool in this pass, so the already
verified same-day Express snapshot is retained, not described as newly verified.
The existing 14-day expiry still withholds stale fee calculations.

- https://www.psacard.com/services/tradingcardgrading
- https://www.cgccards.com/submit/services-fees/cgc-grading/
- https://www.gosgc.com/card-grading/services-pricing
- https://www.beckett.com/
- https://beckett.jotform.com/form/beckett-card-grading-submission

## eBay workflow

Draft review now follows card/price and fee review, then the seller's photos,
then copyable listing details and the existing marketplace handoff. Three step
links help return to each section. “Copy everything” now also includes the
packet's buyer description; stale/blocked packet controls remain withheld.
The handoff explains copying details, adding photos and reviewing eBay's match.
It does not submit or publish anything, and does not restore restricted automatic
sold-price data access.

## Verification

| Check | Passed |
| --- | ---: |
| Binder browser: capture, alignment, original crop pixels, cancellation, resolution, quote | 90 |
| Binder multipage handoff | 24 |
| Binder automatic selection | 53 |
| Grading costs, tier eligibility, mobile rendering and CSV | 96 |
| Draft review, clipboard, preparation order, stale/blocked packets | 422 |
| Referenced immutable asset fingerprints | 115 |
| Test registry | 12 |

Build inspection and diff checks pass. All paid providers are blocked in these
browser tests; no scans, purchases or listings were made. Synthetic portrait and
landscape camera screenshots and a mobile grading view were visually inspected.
These checks establish the changed client mechanics, not recognition accuracy,
future grades, physical-phone camera quality or a live eBay listing round trip.
