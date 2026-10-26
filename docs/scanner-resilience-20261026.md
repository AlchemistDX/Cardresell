# Scanner recovery — October 26, 2026

Missed scans now make several bounded attempts to read a useful card name. This release improves recovery and printing review; it does not claim a measured increase in live Ximilar recognition accuracy.

## What changed

- Ximilar's documented `YuGiOh!` label and the `OnePiece` alias reach their correct game adapters. Rejected identities retain an independent visual game hint, so missed Magic cards can reach Magic recovery even when the search selector still says Pokémon. Low-confidence nearest matches never supply that hint.
- Single-card recovery tries up to four title windows, including a rotated bottom strip for upside-down cards. Lorcana starts around its middle title; sports starts near the lower title area. Japanese Pokémon uses Japanese and English OCR. A general Pokémon tag does not override the seller's explicit Japanese choice.
- Readable lines later in a strip are considered even when sleeve/background noise comes first. Pokémon catalogue queries use a meaningful title word instead of a stray leading token.
- A recovered name opens **Review matching printings**. Name-only recovery no longer silently chooses the first or newest catalogue printing and loads its price. One Piece and sports can retain an editable text suggestion even without a catalogue confirmation.
- Remaining English Magic and Pokémon binder misses get name recovery even when the page has zero identified cards. The existing free catalogue dialog opens with the suggested name and game. It still requires the seller to choose and approve a printing. The new suggestions do not make a row successful, priced, saveable or draftable.
- Existing Magic recovery within a known set remains separate. It skips rows tagged as another game and pending provider choices. Stopping that stage also prevents the subsequent recovery stage from starting.

The provider is still Ximilar. Recognition thresholds, the existing sports retry policy and paid-provider options remain unchanged. These additional text attempts run on the device and do not debit ID credits. Public catalogue queries receive names, not an additional scan request or the card photo. An unsuccessful original ID retains its existing refund behavior.

## Recovery boundaries

Each image has a 45-second overall deadline, an 8-second OCR-read limit, up to four crop reads, and at most six name lookups. The new automatic binder stage has a 90-second budget for the batch; it can stop before reaching every card on a slow device. These limits prevent another indefinite spinner. The existing known-set stage has its own separate 90-second budget.

Stop, closing the scanner, switching accounts, replacing photos, starting another batch, editing a row or beginning a save prevent late work from applying. Completed empty reads are not repeated for the same photo/account; unavailable or timed-out dependencies remain retryable. Workers, decoded images, canvases, object URLs and timers are released. Suggestions are held only for the current photo and account in memory.

Automatic binder name suggestions currently cover English Magic and Pokémon, matching the existing catalogue review dialog. Single-card text recovery covers all seven supported game/language routes. OCR text is a suggestion, not proof of the name, printing, condition or finish.

## Verification

**2,487 checks passed across 21 targeted suites, with zero failures.** The suite list and active asset hashes are in [scanner-resilience-20261026.json](scanner-resilience-20261026.json). The ordinary configured build inspection also passed. This was a targeted scanner release run, not a repeat of the full application regression runner.

The new shipped-browser suite covers delayed title positions, game routing, Japanese selection, sports search, title-line noise, lookup limits, cancellation, timeouts, late worker creation, zero-match pages, manual printing approval, seller metadata, pending choices and stale account/photo/batch guards. Native Tesseract reads generated title fixtures at three vertical positions, upside down, in the Lorcana title area and near a sports card's bottom. Mobile recovery screenshots were inspected.

Existing gates cover single and binder confirmation with actual scan handlers/private Redis, legacy and membership credit paths, lost acknowledgements, no double charge, exact printing/finish, replacement photos, binder camera interactions, catalogue deadlines, asset fingerprints and the test registry. One old source-format assertion was replaced with a behavioral check of the actual batch-finish function; it verifies both starting recovery and respecting Stop.

The saved real Pokémon binder page also went through the shipped crop and recovery code. Native OCR attempted all four strips for each of nine cards (36 reads), and five cards' exact names appeared in the read text and resulting raw suggestions. There were zero scan requests and zero browser errors. This is a small text-readability diagnostic, not five confirmed identities or a live recognition success rate. The other four still need better images, catalogue/manual review or a better text read. Reproduce it with `CR_CHROMIUM=<binary> CR_TESSERACT=<binary> node tools/scan-text-calibration.mjs report.json`; details are in [scanner-text-calibration-20261026.json](scanner-text-calibration-20261026.json).

Live exact-printing accuracy for Magic and other games still needs original full-resolution, independently labeled photos. Historical 0/9 Magic and 4/9 Pokémon screenshots are not a post-release benchmark. Chromium/mobile-layout and native OCR checks do not substitute for real iPhone Safari camera testing or the browser's downloaded OCR engine/language models. No threshold was relaxed to force a success.

Provider references: [Ximilar recognition](https://docs.ximilar.com/collectibles/recognition) and [collectibles taxonomy](https://docs.ximilar.com/taxonomy/collectibles). New immutable assets are referenced by `index.html`; previously deployed assets remain available.
