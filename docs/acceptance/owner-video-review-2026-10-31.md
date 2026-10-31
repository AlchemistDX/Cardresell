# Owner phone test review — 31 October 2026

Reviewed both supplied recordings in full (approximately six minutes each). They show iPhone Safari; the phone model and iOS version are not established. Both audio tracks are silent. Timestamps below are approximate, relative to the named part.

The recordings contain sign-in, payment and account screens. Neither the recordings nor their frames are included in this repository. This report records only product behavior. It does not establish a new purchase/credit reconciliation or authorize any live listing.

## Observed results before this patch

| Part / time | Observation | Result |
|---|---|---|
| 1 / 1:00–1:27 | Custom-camera Machoke scan failed; OCR offered a long garbled string as a possible name. A success checkmark appeared while identification was still running. | Failed attempt; misleading intermediate UI |
| 1 / 1:30–1:50 | Closer native-camera retake identified Machoke, 151 #177. Direct Create draft retained the seller photo but opened an unpriced draft. | Identity passed; price handoff failed |
| 1 / 2:15–2:35 | Previous grading promotion remained visible during a new identification attempt. | Stale state / unnecessary distraction |
| 1 / 2:50–3:20 | Card Lookup showed market/asking data and a separately labelled TPL eBay seven-day aggregate. A chosen $28.85 price reached a new draft. That lookup-created draft did not carry the earlier scan photo; retrieval time/source link were unavailable in its provenance. | Price choice passed; photo/provenance follow-up remains |
| 1 / 4:00–4:35 | Bulk single-card scan identified Machoke, produced a $20.43 estimate and created a draft with the seller photo. Fee comparisons were visible. | Sampled bulk path passed |
| 1 / 5:05–5:35 | eBay connection limitations and draft help were accessible, including the upload link and suppression option. | Controls observed; preference persistence not tested on the phone |
| 2 / 0:45 | Seller Hub rejected `cardsell_collection.csv` as an unrecognised template. | Wrong file selected: collection backup, not eBay draft CSV |
| 2 / 1:30–2:30 | Correct `ebay-draft…csv` upload completed. Complete listings opened an editable Machoke draft with one seller photo, the intended title, $20.43 price and quantity one. | One real eBay import accepted; photo/title/price/quantity observed |
| 2 / 2:15–2:40 | Several item specifics still needed completion. No final Publish action was observed. | Editable draft acceptance is not complete listing/publishing acceptance |
| 2 / 3:00–3:25 | Nine binder pockets submitted; seven identified automatically. Froslass and Dwebble needed recovery. | **7/9 automatic**, not 9/9 |
| 2 / 3:30–4:00 | Owner removed noise from “a Froslass i”, selected Twilight Masquerade #053 and recovered identity. Price remained unavailable. | Manual identity recovery; missing price |
| 2 / 4:10–4:45 | Owner corrected “Dwebblests”, selected Paradox Rift #6 and changed the finish to reverse holo. | Manual recovery and finish choice observed |
| 2 / 4:50–6:05 | All nine cards reached Collection, with one price missing. The chosen Dwebble finish persisted through navigation. Complete selling comparison was withheld for the unpriced card. | Same-session save/navigation observed; reload/second-device persistence not established |

The main eight-card Pokémon/Magic/Yu-Gi-Oh benchmark, including Greninja, was **not rerun in these videos**. Its earlier original/degraded-photo evidence remains scoped to the earlier tested release.

## Fixes in this patch

- Single-scan Create draft now waits for the same bounded price check that starts after identification. The price, estimated finish, physical-copy identifier and captured photo travel together. Missing prices remain empty; slabs never inherit raw prices.
- The scan → View price & fees → Create draft route also keeps the original photo and copy identity. The binding belongs to that card object and account; an independent lookup, another set/number or an account switch cannot inherit it. Private photo bytes are not added to the catalogue JSON or draft request.
- Choosing an identity-only catalogue printing in batch recovery now checks its price before accepting it. A back action, closed dialog, replaced scan or account change cannot apply a late result.
- English Pokémon pricing can consult the existing priced catalogue while the public catalogue is stalled. The fallback must match the requested set and collector number. A read-only production check on 31 October returned Froslass, Twilight Masquerade #053/167, with a $0.30 holofoil market reference and a separate reverse-holo quote. This is availability evidence at that moment, not a lasting card valuation.
- Single-card camera capture maps the visible guide into the sensor image with a margin around every edge. It falls back to the full visible image when geometry/resolution is unsuitable. Grading and edge captures retain their previous framing. This change has geometry/lifecycle regression evidence, not a new physical-phone accuracy result.
- New scans hide prior grading prompts, prices and success marks. Main price/draft actions precede grading links. The initial success badge no longer has conflicting display styles.
- Noisy OCR fragments are no longer offered as unconfirmed card names. Catalogue-backed cleanup handles the observed “a Froslass i” case; selecting the actual printing remains explicit.
- Draft download is labelled **eBay CSV**; Collection export is labelled **Collection CSV**. Help explains iPhone Share → Save to Files, the `ebay-draft` filename, Seller Hub Reports → Uploads and checking results before another upload.

## Verification

- The first new single-scan regression failed against the original implementation: it created a draft with **zero price lookups**.
- Updated phone-viewport regressions: **70 checks passed**, including quote handoff, photo snapshot, finish, unknown price, slab isolation, stalled providers, wrong-printing fallback rejection, account/scan changes, cancelled manual recovery, OCR noise, guide geometry and both draft-entry photo paths.
- The additional lookup-photo regression also failed before its fix: the draft had no photo and a new copy ID.
- Catalogue recovery: **214 checks passed**. Draft/export integration through the actual draft handler and isolated store: **80 checks passed**. Asset fingerprints: **285 checks passed**. Truthful copy: **224 checks passed**.
- Final release run: `DRAFT_KV_LIVE=0 CR_LIVE_STATIC=0 COND_PILLS_BROWSER=1 bash tests/run-all.sh --local` exited **0**, with the 177-slot registry complete and all enabled suites passing. Two explicit gates were skipped: the credentialed production KV test and production endpoint smoke in local mode. The condition-control browser checks were enabled. Browser fixtures use synthetic identities/prices and isolated storage; they do not spend scan credits or modify the owner's inventory.
- Release assets: `core.1ae7d9c1.js`, `ui.8410945f.js`, `scan-finish.c5515738.js`, `bulk-lookup.15659470.js`, `scan-text-recovery.dc1165d0.js` and `search-catalog.5a24e024.js`.

## Remaining acceptance

1. Repeat the failed Machoke custom-camera path once on the patched phone build, then the original main-game cards. Record automatic identity separately from manual review. Do not claim a population accuracy rate from these convenience samples.
2. Physical Safari permission retry, rotation, background/resume, network recovery and second-device collection checks remain untested. Same-session navigation is not a substitute.
3. Both draft-entry photo paths have automated regression evidence and still need a physical-phone recheck. Missing provider timestamps or source links remain explicitly unavailable; they are not invented. Seller Hub item specifics must still be reviewed and completed.
4. The observed eBay import closes the **one real sample accepted/editable** gate. It does not prove every game, slab, item-specific field, bulk CSV or direct publishing path. eBay Connect still does not provide market-wide individual sold transactions or automatic publishing.
5. Current provider usage/billing exports, TPL history entitlement and an independent seller pilot remain outstanding. No additional purchase is requested merely to repeat payment evidence.

## Release

Release checks passed. Production commit, deployment and live verification will be recorded after deployment completes.
