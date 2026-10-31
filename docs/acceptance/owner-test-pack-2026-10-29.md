# CardResell owner test pack

Prepared October 29, 2026. **Updated October 31: two owner phone recordings reviewed.** See [the observed results and fixes](owner-video-review-2026-10-31.md). One actual eBay CSV import reached an editable draft with its photo, title, price and quantity. Binder identification was 7/9 automatic plus two manual recoveries. The main-eight benchmark, full camera lifecycle and second-device checks below remain unrun in these recordings.

Use https://www.cardresell.org on your actual iPhone in Safari. Allow roughly 20–30 minutes, plus eBay's processing time. The software baseline is production commit `41fec9a5854d7a562749000c24c0a40a185d0308`. If a later release is installed, record its date/time rather than assuming this build.

You need your cards, your normal CardResell account, access to your eBay Seller Hub, and optionally a second device. Start a screen recording after signing in; keep passwords, codes and payment details out of it. No new subscription purchase or AI grade submission is required. Identification submissions can consume ID credits: note the displayed balance and submit each chosen photo once. A deliberate repeat is a separate attempt.

## 1. Start with Greninja

1. Open Card Lookup and note your plan and ID credit balance.
2. Scan the supplied Mega Greninja ex front using the normal ID scan flow.
3. Confirm the result is **Mega Greninja ex, Mega Evolution Promo, #081**. Provider wording may include “ME:” or “- 081”. Another Greninja printing is a failure, even if its picture looks similar.
4. Note whether it identified automatically, asked you to choose, or failed. Record approximate seconds from submission to a usable result.
5. Check that the price source and available low/high values are labelled. Do not compare against an old dollar amount: prices change. Missing data must remain unavailable, not become an invented range.
6. Confirm fee/net-payout comparisons appear without opening a special fee dropdown or pressing Calculate. The optional detailed breakdown may stay collapsed.
7. Note the final ID credit balance. If it fails, capture the error/refund status and stop repeating that same photo; report the first failure.

**Pass:** correct identity, usable next step, comparison visible, no unexplained duplicate credit charge. An identification review is recorded as review, not automatic success.

## 2. Check the main games

Use the same process for the other seven cards. Use ordinary handheld photos with all card edges visible; include one mildly tilted or imperfectly lit shot. Do not make the text completely unreadable. The earlier original/degraded results are reference evidence, not a guarantee that this new run will pass.

| Card | Expected set / printed number | Result: automatic / review / wrong / failed | Seconds | Credit change / error |
|---|---|---|---|---|
| Mega Greninja ex | Mega Evolution Promo / 081 | — | — | — |
| Dusclops | Vivid Voltage / 070/185 | — | — | — |
| Applin | Stellar Crown / 012/142 | — | — | — |
| Mimikyu | Paldean Fates / 037/091 | — | — | — |
| Charizard, PSA 9 | Team Up / 14/181; PSA 9 | — | — | — |
| Eager Glyphmage | Secrets of Strixhaven / 11 | — | — | — |
| Stadium Tidalmage | Secrets of Strixhaven / 232 | — | — | — |
| Blitzclique - Breakaway | Chaos Origins / CORI-EN051; 1st Edition shown on card | — | — | — |

Record finish separately: Applin appears reverse holo and the two Magic photos are foil. Correct name/set/number does not prove finish recognition. A labelled base-printing estimate is acceptable as an explicit limitation; silently claiming an exact foil price is not. For Charizard, the app must retain PSA 9 and must not substitute a raw value when an exact-grade price is missing.

Optional after the main eight: Luffy, Noi, Make the Potion, Satoru Gojo, LeBron and Josh Sweat complete the supplied 14-card sample. Luffy's original and the two sports cards previously required review; Union Arena was unsupported. Record these outcomes honestly, separately from the main-game acceptance.

## 3. Check search, fees and the simple workflow

- [ ] Search **Charizard Base Set**. Base Set #004/102 comes first; Base Set 2 is a broader suggestion. Select the intended card and confirm its set/number carry through.
- [ ] Enter a $1 price override, then $10. Fee/payout results update consistently; negative payouts must remain visible when costs exceed proceeds.
- [ ] Change buyer shipping and your shipping cost separately. The displayed estimate must explain the same inputs used by the draft preview.
- [ ] Leave purchase cost blank: the app must not imply a known actual profit. Enter a cost: profit and selling payout must remain distinct.
- [ ] Reload. Your plan and available comparison venues agree without needing Calculate to repair access.

These are comparison scenarios, not instructions to list a valuable card for $1. Before creating any draft, restore the intended asking price and verify it in the draft preview.

## 4. Camera handling — no paid grade submission

Open the camera, capture a front/back pair, and stop before submitting any grade.

- [ ] Retake the front; the back stays intact.
- [ ] Cancel and reopen twice; the camera and shutter still work.
- [ ] Rotate the phone; controls remain reachable and photos stay correctly associated.
- [ ] Background Safari briefly, return, and check that the feed resumes or offers clear recovery.
- [ ] Deny camera permission once, then restore permission in Safari and retry; the page explains recovery rather than hanging. Do this after the successful basic scan so permission changes do not obscure the first test.
- [ ] Try a poor-network interruption before submission or while loading an unbilled page. Restore the network and check recovery. Do not repeatedly tap Submit to simulate retries.

On iPhone/iPad the hardware zoom slider is intentionally absent because of the earlier freeze. Its absence is not a new failure. Camera hints are advisory, not a guarantee of sharpness or authenticity.

## 5. Prepare and import one real exported draft

Use one card you own and actually intend to sell, preferably an inexpensive card. This test creates a draft only; stop before publishing.

1. Select the exact printing/condition and intended price. Create one draft using the normal app action; confirm the row count increased by exactly one.
2. Download that draft's eBay CSV. Use this newly exported file, not a repository test fixture or an old download.
3. Confirm **How to use drafts** opens. Hide it using its don't-show-again option, then confirm the help button reopens it.
4. Use **Open eBay upload**, which should lead to Seller Hub **Reports → Uploads**. Connection to eBay should not be a prerequisite for CSV export.
5. Upload the file once. Wait for eBay's processing result before retrying. Record accepted/rejected row counts and any exact error message; keep the result/report file.
6. Open the resulting editable eBay draft. Check title, category, set/number, condition, quantity, price, description and photos. Record any field eBay requires you to complete. A CSV downloading successfully is not a passed import.
7. Stop before any final **List / Publish** action. Do not upload the same CSV again just because processing is slow; it can create duplicate drafts.

**Pass:** one intended editable draft, correct values, understandable missing-field feedback, and no live listing. Photo transfer is a separate check; if absent, record it rather than marking the whole photo flow passed.

## 6. Collection persistence and backup

Use a clearly identified test copy, or an existing copy you are comfortable updating. Never sell or alter a real inventory item merely to satisfy this checklist.

- [ ] Save/set its condition, cost and location; reload and confirm all three.
- [ ] On a second device signed into the same account, confirm the same physical copy and values. Mark “not run” if no second device is available.
- [ ] Export a backup and check that a nonempty file downloads. Do not import it over your live collection during this test.
- [ ] If you have a disposable test copy, record a test sale and inspect the recorded fees/cost/profit. Otherwise mark this step “not run”; isolated software tests already cover it.

## Send back this result block

Date/time (Eastern):
Phone model / iOS version:
Browser:
Plan shown:
Starting → ending ID credits:
Main-game results (table above):
Camera failures (step names):
Search / fees / workflow: pass / fail / not run:
eBay upload: accepted __ / rejected __ / still processing:
Editable draft correct? Missing fields/photos?:
Collection / second device / backup: pass / fail / not run:
Worst issue and steps to reproduce:
Recording/screenshot filenames:

For any failure, capture the visible message, the card, the step and approximate time. Do not include API keys, passwords or buyer information. “Not run” is useful evidence; do not mark it passed.

## Separate account information still needed

To reconcile economics and history access, provide current provider usage/billing exports and the TCG Price Lookup plan description showing whether price history is included. Redact credentials and payment details. These are separate from the phone test; eBay OAuth alone does not grant historical prices or market-wide sold data.
