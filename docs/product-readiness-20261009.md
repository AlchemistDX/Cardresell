# Product readiness — 2026-10-09

## Implemented in this release

- Normal mobile Grade → Bulk Grade → upload flow for Pro/Business, up to ten ordered card photo sets. Photo review precedes charging. Quick costs one Grade credit; Deep two, with actual server-reported fallback/refund. The batch stops safely on access, credit, service or uncertain-response failures. Recovery reuses the same durable request; it does not replay finished cards.
- Explicit private report saving for single and batch grades on every plan, up to 500 reports/account. Reports reopen in Collection → Saved AI grades and can be downloaded or deleted. Photos are not stored. Saving failures remain visible and retryable. Recovered analyses have stable report identifiers.
- Batch result thumbnails and numbered rows, accurate notes, CSV export with spreadsheet-formula protection. Estimates remain visibly distinct from certified grades. Upload batches are supported; a native multi-card camera loop is not shipped.
- Collection sync rejects unreadable/corrupt storage rather than interpreting it as an empty account. Atomic compare-and-set and bounded retry preserve concurrent additions. Explicit tombstones preserve deletions; their capacity now matches the 2,000-row collection limit. Failed cloud saves show device-only status and a retry control. Responses from a previous account cannot populate the current account.
- Ambiguous duplicate collection IDs pause synchronization and preserve the records for manual resolution. No automatic data repair or account rebinding was performed. Same-ID snapshot conflicts retain the existing timestamp policy; a field-level conflict-resolution interface is still future work.
- Pokémon provider-outage fallback offers locally known identities without invented prices. A separate 49-record historical metadata supplement covers HGSS18 and McDonald's 2014/2015/2017/2018 gaps. These are text-search records, not image-reference coverage. Image-index failures do not suppress the available metadata-only results.
- Additive Magic image-reference expansion with canonical Scryfall printing IDs, all result pages, source hashes, released-printing filters and explicit failures. Exact-printing confirmation rules are unchanged. Counts and set coverage are recorded in data/catalog-import-20261009.json and the release verification below.

## Listing rules

All current plans retain the existing maximum of 500 saved listing drafts per account. Individual and selected bulk-scan draft creation remain available under the existing account/technical gates, with no separate ID/Grade charge for preparing drafts. Proposed new monthly, tier-specific draft and cloud-photo quotas remain disabled. Marketplace handoff/export is supported; automatic eBay publishing or cross-posting is not sold as a working feature. Existing eBay sold-data availability is unreliable, so manual marketplace search remains necessary.

## Verification scope

The complete local regression runner was executed. Six suites initially contained stale assertions for changed behavior/registration and were corrected; focused reruns passed. New checks exercise actual application handlers with isolated real Redis and browser interactions through the normal mobile entry. Synthetic provider/auth responses avoid paid grading calls and customer credit consumption. Browser batch: 24 checks; collection storage: 24; saved reports: 21; outage fallback: 12; importer: eight. Asset fingerprints and final release checks are recorded after catalog import.

This evidence does not establish physical-camera acceptance, a newly authenticated production grading purchase, real image-recognition accuracy or production-provider fallback acceptance.

## Remaining work and release conditions

1. Physical iPhone camera guidance and capture lifecycle acceptance, following docs/camera-phone-acceptance-20261008.md. The native batch-camera loop also remains unimplemented; current batch support is photo upload.
2. Owner's existing condition: retain restricted public admission until a naturally occurring live Deep-to-Quick fallback is accepted. Isolated failure/recovery tests are passing. Production providers were not deliberately broken to manufacture a fallback.
3. After admission acceptance, verify a newly eligible user can enter, verify email, receive the welcome credits exactly once and reach checkout. No admission settings, ad spending or outreach changed in this release.
4. Catalog expansion remains ongoing. Local image indexes are bounded subsets, not a complete claim of every printing, finish, language or game. Text fallback does not provide live market prices. The 49 historical Pokémon records still lack usable image references. Recognition accuracy needs representative physical-card benchmarking; raw image hash counts are not an accuracy score.
5. Plan and implement migration of the retiring Pokémon TCG API. Its official documentation states existing API keys are supported only through March 1, 2027 (https://docs.pokemontcg.io/). The historical metadata supplement provides continuity for known identities; it does not replace pricing or an actively maintained provider.
6. Before paid-ad scaling, confirm grading-provider usage/overage policy and measure representative all-in costs against fulfilled revenue and refunds. Scenario margins are provisional.
7. A current production backup/restore drill, broader game/language coverage, field-level collection conflict resolution and native batch camera capture are not claimed complete by this release.

No percentage of product perfection or guarantee of grading accuracy is asserted. Existing plan prices, monthly credit allocations, discount percentages and billing authority remain unchanged.

## Final catalog verification

Magic image index: 15,229 → 18,618 unique printing IDs across 121 represented sets; 3,389 additions, all prior records unchanged. Completed source coverage in this import: h2r 16, lcc 370, who 1,178, woc 173, ltc 585, mat 230, moc 450, mom 387. Each set matches the canonical provider count captured in the source manifest; no failed imports. Pokémon retains 20,699 image records plus 49 separate metadata-only records. Represented sets are not a claim that every historical printing or variant is covered. Final asset fingerprints: 107 passing; syntax: ten inline blocks, zero errors.
