# CardResell owner test pack

Prepared October 29, 2026. **Updated October 31: phone recordings reviewed and sample priorities clarified by the owner.** See [the observed results and fixes](owner-video-review-2026-10-31.md). One actual eBay CSV import reached an editable draft with its photo, title, price and quantity. Binder identification was 7/9 automatic plus two manual recoveries. Fresh-card acceptance, the full camera lifecycle and second-device checks below remain open. The supplied named cards are regression examples, not the required owner test set.

Use https://www.cardresell.org on your actual iPhone in Safari. The software baseline is production commit `f613a493f7e558c976566941d3e47d4f4b73a4f3`. If a later release is installed, record its date/time rather than assuming this build. The short workflow recheck can be recorded separately from the wider scanner and device checks; one long phone recording is unnecessary.

You need your cards, your normal CardResell account, access to your eBay Seller Hub, and optionally a second device. Start a screen recording after signing in; keep passwords, codes and payment details out of it. No new subscription purchase or AI grade submission is required. Identification submissions can consume ID credits: note the displayed balance and submit each chosen photo once. A deliberate repeat is a separate attempt.

## 1. Short recheck with any suitable card

1. Open Card Lookup and note your plan and ID credit balance.
2. Choose a card from your collection, preferably a full art, SIR or other special printing you would normally scan individually. Scan it using the normal ID scan flow. No particular card name is required.
3. Check the exact name, set, printed number and language/edition where applicable against the physical card. Another printing is a failure, even if its name or picture looks similar. Check finish separately.
4. Note whether it identified automatically, asked you to choose, or failed. Record approximate seconds from submission to a usable result.
5. Check that the price source and available low/high values are labelled. Do not compare against an old dollar amount: prices change. Missing data must remain unavailable, not become an invented range.
6. Confirm fee/net-payout comparisons appear without opening a special fee dropdown or pressing Calculate. The optional detailed breakdown may stay collapsed.
7. Note the final ID credit balance. If it fails, capture the error/refund status and stop repeating that same photo; report the first failure.

**Pass:** correct identity, usable next step, comparison visible, no unexplained duplicate credit charge. An identification review is recorded as review, not automatic success.

Check both draft-entry routes when practical: **Create draft** directly from a scan, and **View price & fees → Create draft**. Each must retain that physical copy's photo, identity, finish and available price. Reuse the current result when possible; do not rescan solely for a duplicate test. If another scan is necessary, use another suitable card and count it as another attempt. If catalogue recovery is needed naturally, its selected printing must receive a matching quote or a clear unavailable state. Do not force a failure just to exercise recovery.

## 2. Check unfamiliar cards in the workflows people will use

Prioritize Pokémon, Magic and Yu-Gi-Oh! Use fresh cards chosen before viewing scanner results, with identities and printings checked independently. Keep their images out of scanner tuning until the evaluation finishes. Choose freely within the following mix; there is no required list of card names. These priorities reflect the owner's expected use, not measured customer usage.

| Workflow | Main coverage | What to record |
|---|---|---|
| Individual scans | Mostly full arts, Pokémon SIRs and relevant special printings in each game; include older, rare, promo and similar-art printings | Exact printing, automatic/review/wrong/failed outcome, time, finish and quote availability |
| Binder pages | Ordinary commons/uncommons alongside rare, full-art, foil and reverse-holo cards; sleeves, different pockets and repeated physical copies | Every occupied pocket, missed/duplicate pockets, exact identity per pocket and retained photo/copy association |
| Real phone conditions | Natural handheld glare, mild blur, tilt, shadows and imperfect framing across both workflows | Original first-attempt result and any later recovery separately; unreadable cases must fail or request review honestly |
| Graded cards | Grade/company visible on the label; keep separate from raw-card results | Grade retained, no raw price substituted for a missing exact-grade quote |

For each attempt record: game; single/binder and pocket; expected name/set/number/language/edition; result; seconds; finish; quote source or unavailable; credit change/error. Include failures and keep the initial denominator unchanged after corrections. Repeated photos are attempts, not additional independent cards. A page with nine saved cards after two manual recoveries is seven automatic identities plus two recoveries, not nine automatic successes.

Correct name/set/number does not prove finish recognition. A labelled base-printing estimate is acceptable as an explicit limitation; silently claiming an exact foil price is not. Finish selection stays optional and editable; this test record must not become a mandatory questionnaire in the scanning flow.

The supplied 14 cards and the earlier eight-card Pokémon/Magic/Yu-Gi-Oh! results remain development regressions. Repeat those internally when a relevant change needs checking; they do not replace fresh-card evaluation or require the owner to find those cards again. Supporting games and sports remain separate coverage, with unsupported outcomes recorded honestly.

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
Fresh-card results (game, single/binder, exact printing, outcome, seconds):
Binder occupied / automatically correct / manual recovery / wrong / missed pockets:
Finish uncertain / price unavailable:
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
