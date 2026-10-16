# Binder photo preservation and explicit catalogue recovery

The reported binder batches returned 0/9 Magic and 4/9 Pokémon identities. Production logs showed successful Ximilar HTTP responses with low-confidence matches, not upload or connection failures. Screenshots show sleeve glare and some neighbouring cards inside pocket crops. They are not original camera files, so these changes do not establish a new recognition success rate.

## Changes

- Binder-created JPEG files retain their prepared bytes through `_bulkScanOne`, including the existing 1400px cap and 0.95 JPEG quality. Previously the bulk path encoded them again at 1200px and 0.90. Only files created by this binder instance qualify; an arbitrary upload with a binder filename does not. Files over 2MiB or read failures use the existing bounded encoder. The 350px persistent thumbnail remains small.
- Definite identification misses and locally rejected photos offer **Find card by name · free**. English Magic and Pokémon printings come from the existing public catalogue services. The seller selects a result and explicitly confirms its artwork, set and number beside their photo.
- Confirmation updates the existing batch row and its summary. It preserves the physical file, scan/copy IDs, quantity, condition and acquisition metadata. It does not save inventory, create a draft, submit a scan, or spend an ID credit. Rows are labelled **Selected from catalogue**.
- Searches have cancellation, a 15-second deadline, pagination, escaped input, plain-text rendering and a restricted artwork host list. Account changes, batch replacement, row removal, photo replacement, automatic rescue, saving and draft activity invalidate confirmation. Closing the batch closes the dialog.
- Recognition cutoffs, provider selection, automatic OCR acceptance, billing/refunds and eBay execution settings are unchanged. Finish prices remain catalogue estimates until the seller edits them; condition is not inferred.

## Verification

`tests/bulk-lookup-browser.mjs` exercises shipped binder crops and scan handoff, byte equality, ordinary-upload fallback, manual confirmation of a non-first printing, physical-copy preservation, pagination, provider errors, cancellation, unsafe artwork, and stale account/batch guards in portrait and landscape. All photos and catalogue responses are synthetic; external traffic is blocked. It is a required release gate in the test registry.

Run it with `CR_CHROMIUM=<binary> node tests/bulk-lookup-browser.mjs`, alongside the binder scan, interaction, auto-selection, multi-page and printed-name rescue gates and the standard local regression suite. `tools/build-bulk-lookup.mjs` and `tools/build-binder.mjs` produce fingerprinted assets; previously shipped assets remain immutable.

## Remaining limits

This improves submitted image fidelity and recovery from misses. It does not prove that Ximilar covers the specific new Magic printing, correct perspective in an angled binder page, remove sleeve glare, or recover detail absent from the original. A comparison on original photos remains necessary to quantify recognition accuracy.

The existing [Pokémon TCG API](https://docs.pokemontcg.io/api-reference/cards/search-cards/) currently advertises deprecation and continued existing-key support through March 1, 2027. This change reuses the app's current catalogue, with visible failures and recoverable batch state. Provider migration needs a separate planned change. Magic uses [Scryfall search](https://scryfall.com/docs/api/cards/search), explicitly requesting physical English printings with `unique=prints`.
