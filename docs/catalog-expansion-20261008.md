# Catalog expansion — 2026-10-08

Added provider-verified English printing records to the local reference-image indexes. Existing records are unchanged. Source URLs, response hashes, per-set counts and failures are in `data/catalog-import-20261008.json`.

| Game | Before | Added | After |
|---|---:|---:|---:|
| pokemon | 20,506 | 193 | 20,699 |
| mtg | 11,924 | 3,305 | 15,229 |

## Sets imported

| Game | Set | New records | Released provider records covered |
|---|---|---:|---:|
| pokemon | Aquapolis (ecard2) | 1 | 182/182 |
| pokemon | Hidden Legends (ex5) | 1 | 102/102 |
| pokemon | HGSS Black Star Promos (hsp) | 0 | 24/25 |
| pokemon | McDonald's Collection 2014 (mcd14) | 0 | 0/12 |
| pokemon | McDonald's Collection 2015 (mcd15) | 0 | 0/12 |
| pokemon | McDonald's Collection 2018 (mcd18) | 0 | 0/12 |
| pokemon | McDonald's Collection 2017 (mcd17) | 0 | 0/12 |
| pokemon | 30th Celebration (me55) | 161 | 161/161 |
| pokemon | 30th Celebration: Classic Collection (me55c) | 30 | 30/30 |
| mtg | Reality Fracture (fra) | 418 | 452/452 |
| mtg | The Hobbit (hob) | 67 | 321/321 |
| mtg | Marvel Super Heroes (msh) | 52 | 453/453 |
| mtg | Teenage Mutant Ninja Turtles (tmt) | 43 | 320/320 |
| mtg | Lorwyn Eclipsed (ecl) | 44 | 408/408 |
| mtg | Foundations Commander (fdc) | 319 | 319/319 |
| mtg | Wilds of Eldraine (woe) | 381 | 381/381 |
| mtg | Commander Masters (cmm) | 1067 | 1067/1067 |
| mtg | The Lord of the Rings: Tales of Middle-earth (ltr) | 853 | 853/853 |
| mtg | Secrets of Strixhaven (sos) | 61 | 368/368 |

Magic uses Scryfall `unique=prints`, English paper cards, all result pages, extras and variations. Finish variants that share one provider ID are not counted as separate records. Pokémon uses canonical PokémonTCG.io IDs and printed numbers. No hashes are invented for unavailable images. Six Reality Fracture variants dated 2026-10-23 were excluded; the eligible subset is 456 of the 462 returned records. All added IDs, names, sets, numbers, image URLs and Magic release dates were checked against the downloaded source responses.

## Search and identity fixes

- Removed the 20-result Magic cutoff. Users can load subsequent pages and browse all Magic printings even when the first pricing provider returns a partial list.
- Search rows show collector numbers. Failed pages can retry; stale responses cannot replace another search.
- A verified Magic canonical ID loads its exact record directly. Search auto-selection requires a single exact name/game/set/number/language match, consistent with any canonical ID. Prefix scoring is removed. Ambiguity clears a previous calculator card and leaves the choices open.
- High-resolution Pokémon image URLs are idempotent; an already-high-resolution URL no longer gets a second `_hires` suffix.
- Catalog URLs carry content versions, and the active core bundle gets a new content hash. Cached older catalogs do not block these additions.

## Remaining coverage limits

The Pokémon set-count audit still has 49 image-index gaps: HGSS18 and 12 cards each in McDonald’s 2014, 2015, 2017 and 2018. Primary-provider image links returned 404. The secondary records checked for HGSS18 and the 2014 set also lacked image URLs. These catalog identities can still exist in external text searches; missing reference images are not proof that a card cannot be found online. Equal set counts do not independently establish complete ID/finish coverage.
The scoped Magic audit still has 178 released physical sets with no local hash entries. External Scryfall searches cover more than the local index. Non-English editions, other games and specialty Pokémon products are not made complete by this batch. No claim of universal coverage or competitor parity.

## Validation

- `python tests/catalog-import.py`: 8 offline cases covering pagination, duplicate IDs, source identity, corrupt images and future releases.
- `CR_CHROMIUM=/tmp/camera-review/chromium node tests/catalog-search.mjs`: 24 isolated cases plus real DOM at 390×844 and 844×390, including paging, manual selection, exact automatic selection and refusing a number prefix.
- Client printing, scanner, asset fingerprint and test registry gates also run for release. Existing catalog records and unique IDs are checked against the base commit. An idempotent rerun across all ten Magic sets added zero records and reported zero failures.
- No paid identification/grading calls or customer credits used. Reference-image records and regression tests are not a phone-photo accuracy benchmark.

## Phone acceptance

1. Scan Masterful Flourish, SOS #89; verify the physical set, number and displayed card.
2. Search a heavily reprinted Magic card, tap **Browse all Magic printings** if shown, then **Load more printings**. Select an older edition and verify set and collector number.
3. Scan one card from either September Pokémon set and one from a newly added Magic set. Record correct, wrong or unresolved separately.
4. Try two same-art printings. Missing set/number evidence must not make the app silently select the first result.
5. Open the catalog image on a Pokémon result that already uses a high-resolution source URL. It should load without a doubled `_hires` path.

Implementation uses public metadata and images. Sources: https://scryfall.com/docs/api/cards/search and https://docs.pokemontcg.io/.

## Repeating the import

Use `tools/fill-catalog-gaps.py` with explicit `--pokemon`/`--mtg` set codes, `--as-of`, a fresh `--cache` directory and `--report`. The cache freezes a resumable source snapshot; use a new cache for a fresh provider audit. The command never commits or deploys. After review run `node tools/version-catalog-assets.mjs`, run the gates and publish the reviewed files together.
