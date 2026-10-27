# Catalog coverage audit — October 26, 2026

The audit covers every game exposed in CardResell and each catalog/price provider used by those paths. It does **not** certify a complete worldwide checklist or a scanner accuracy rate.

## Verified expansion and fixes

| Game | Imported searchable records | Scope |
|---|---:|---|
| Pokémon English | 21,256 | Entire returned TCGdex physical-card list; 2,480 digital Pocket records excluded using the provider's Pocket series. Existing PokémonTCG.io and local reference searches remain available. |
| Pokémon Japanese | 30,408 | Single-card identity records from all 461 TCGCSV Japanese groups. Separate Japanese-name lookup has 12,781 TCGdex records; these overlap and are not additional physical printings. |
| Yu-Gi-Oh! | 45,205 | YGOProDeck identities and set-code/rarity rows. Includes 538 identities without a cataloged printing. Card-wide prices and artwork are not assigned to the chosen printing. |
| Lorcana | 3,622 | All 21 TCGCSV groups inspected; includes distinct product IDs for alternate treatments. Puzzle inserts/sealed products without card identity fields are excluded. |
| One Piece | 7,332 | All 87 TCGCSV groups inspected; unnumbered DON!! records retained, sealed products excluded. Announced products are marked pre-release when the provider marks them that way. |
| Magic | 110,037 in checked live query | Scryfall paper search, including extras and variations, exposes pagination. This is a provider-reported query count, not an imported or ID-by-ID-certified local catalog. |
| Sports / Other | Not certified | Sports guide/search references have no verified exhaustive year/set/parallel checklist. Other remains manual entry. |

- “Browse catalog printings” is available after quick priced results. Fallbacks use same-origin snapshots rather than downloading public catalogs for each user.
- All matches are accessible in pages of 50. The full-screen catalog now retains browse, retry and pagination actions, preserves filters on load-more, and rejects stale query/game results.
- Japanese selection no longer substitutes English card identities/prices. Native Japanese input uses the separate Japanese-name source.
- Yu-Gi-Oh! no longer silently chooses the first set or assigns cross-printing card prices to it.
- The paid search request has a six-second header/body deadline so a stalled lookup can reach the saved catalog. Loading a catalog does not spend ID credits or repeat paid search requests.
- New immutable manifest, data and JavaScript URLs prevent old browser caches from mixing different snapshots. Old deployed asset generations remain present.
- The legacy seeder no longer pushes an unverified, unversioned index to `main`. It prepares versioned changes for the verified release workflow.

## Coverage limits found

- TCGdex English has six declared set-count discrepancies (W Promotional, Jumbo, Sample, Radiant Collection, Lycanroc Trainer Kit, My First Battle). A source's missing records are reported, not fabricated.
- The secondary Japanese TCGdex source has 69 set-count discrepancies; the larger TCGCSV Japanese product catalog supplements it, without guessing cross-provider printing equivalence.
- Three Japanese TCGCSV groups and one One Piece group return empty product arrays. Their group names are in the saved evidence, so “every group checked” cannot be mistaken for “every group populated.”
- Local visual references remain **20,699 Pokémon / 173 represented sets** and **18,618 Magic / 121 represented sets**. They are not the complete search catalog and do not measure Ximilar coverage. Missing reference images do not imply an identity cannot be searched.
- Some printed variants (editions, foil finishes, languages, alternative artwork, promos) do not have distinct IDs or complete mappings in a provider. User confirmation remains necessary.
- Identity snapshots contain no live prices. A result with missing market evidence stays unpriced; imported record counts are not sold-comparison counts.

## Provider inventory

| Provider | Audit outcome |
|---|---|
| TCGCSV / TCGplayer public export | Validated success/error envelopes, counts, category/group ownership, unique product IDs, every group in imported categories; non-card exclusions and empty groups recorded. Category 1/2/3 group inventories also captured for comparison, not equated to other providers' sets. |
| TCGdex | Downloaded complete EN/JA list endpoints, validated IDs and set membership, compared declared set totals; excluded digital Pocket via the series relationship. Native-language identities are kept separate from translated products. |
| PokémonTCG.io / primary data repository | Live set endpoint returned HTTP 503; primary repository's set file provided the reference comparison. Existing image/identity fallback retained. Deprecation/migration is a separate dependency, not silently enabled here. |
| Scryfall | Fresh set list and paper-printing query; checked existing pagination and exact printing handoff. English is the default search language. |
| YGOProDeck | Downloaded all 14,645 returned identities and full set inventory. Removed placeholder identity, retained distinct set code/rarity combinations and disclosed unprinted/unmapped identities. |
| Lorcana-API | Downloaded all 2,694 returned rows for comparison. Search fallback now uses the larger TCGCSV product catalog; server recognition/enrichment remains separately constrained. |
| TCG Price Lookup | Existing budgeted live query is a quick search, capped at 100 results. It is not used as an enumeration proof. Supplemental catalog browsing avoids paid pagination. |
| PriceCharting / SportsCardsPro | Pricing/reference search paths inspected; no authenticated exhaustive product enumeration or sports manufacturer checklist certified. |
| Scrydex | Optional existing pilot provider remains gated; this audit does not activate a paid migration or assert its complete coverage. |
| Ximilar / image CDNs | Recognition service and images are not searchable checklist completeness proofs. No extra paid image-ID calls were made for this audit. |

## Reproduce / refresh

Use a fresh cache directory for a new provider snapshot; rerunning the same snapshot reuses validated bodies. The TCGCSV update marker must stay the same throughout the import. All five catalogs must validate before any new manifest is published. Disappeared prior IDs block a refresh by default; an explicit reviewed `--allow-removals` run records every removed ID. Empty/truncated/foreign-game responses cannot replace the existing catalog.

```sh
python tools/build-search-catalogs.py --cache /tmp/cardresell-catalog-audit --as-of 2026-10-26
python tools/audit-all-catalogs.py --cache /tmp/cardresell-catalog-audit --as-of 2026-10-26 --report docs/catalog-completeness-20261026.json
node tools/version-search-catalog.mjs
python tests/catalog-snapshot-import.py
CR_CHROMIUM=/path/to/chromium node tests/catalog-completeness.mjs
```

`data/catalog/coverage.json` records source URLs, SHA-256 hashes, per-group product counts, exclusions, gaps and the TCGCSV build timestamp. `docs/catalog-completeness-20261026.json` reports all game coverage. The updater prepares a reviewable release; no unverified background production schedule is claimed.

## Validation

Release checks exercise the real mobile and desktop catalog, each game and native Japanese search, later-page selection, exact set/number/language handoff, malformed snapshot rejection, cache recovery, missing images, source isolation, unchanged scanner review/billing boundaries, and provider outages. The test output recorded with this release is the evidence; this is not a provider-wide recognition or sales-price benchmark.

Verified: **1707 checks across 16 targeted suites, zero failures** (including 390px and 1280px real-browser workflows and unchanged single/binder recovery). Details: `catalog-completeness-tests-20261026.json`. The full repository suite was not rerun.
