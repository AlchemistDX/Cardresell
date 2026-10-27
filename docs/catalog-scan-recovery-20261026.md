# Catalog-to-scanner recovery — October 26, 2026

This follow-up makes the audited catalogs usable after a missed scan. It does not add provider records or certify complete worldwide catalogs or measured Ximilar recognition accuracy.

## Problems fixed

- Binder recovery offered only English Magic and Pokémon despite the broader search catalogs. Its Pokémon-only live dependency could also prevent recovery during a provider outage.
- Name recovery still used the old Lorcana feed, lacked a One Piece catalog path, and could confirm Japanese Pokémon text against English identities.
- Japanese bulk price lookup could fall through to English pricing after a missing Japanese quote. Japanese rows could also open the English tab or save an English game field.
- A printing explicitly selected from a saved catalog could be searched and selected again when opening card details.

## Resulting behavior

- Binder recovery offers Magic English, Pokémon English/Japanese, Yu-Gi-Oh! English, Lorcana English and One Piece English. A missed binder row can receive an on-device name suggestion for any of these routes. Sports remains a separate research/manual workflow.
- Pokémon/Yu-Gi-Oh!/Lorcana/One Piece name checks reuse the audited same-origin snapshots. Japanese native text uses the native catalog. Exact names, a short leading sleeve-noise token, or a unique bounded spelling correction can suggest a name. Ambiguous corrections remain unconfirmed. Magic retains its bounded Scryfall name query.
- Text lookup returns a name only: no ID, set, number, artwork, price, finish or successful identity is inferred. Existing OCR limits, cancellation, refund and account guards remain in place. No extra photo recognition requests or scan debits are introduced.
- Free binder search uses saved catalogs directly for the added games. English Pokémon retains live lookup, with saved-catalog fallback on failure/empty first page and an explicit browse action after live results. Magic includes paper printings, variations and extras. All sources paginate; an entered collector number filters exact saved-catalog numbers.
- Identity-only Yu-Gi-Oh! records without a printing and provider-marked pre-release products cannot confirm a physical copy. Missing images remain usable with an explicit unavailable-image state; card-wide Yu-Gi-Oh! art is never substituted. Unnumbered DON!! cards remain searchable.
- The seller chooses a printing, compares it with their photo, and explicitly approves it. The same physical row retains its photo, scan/copy IDs, condition, acquisition cost and location. Snapshot matches contain no prices. Approved identity reaches details directly and preserves language through inventory/draft mapping.
- A missing or failed Japanese quote remains unavailable. It cannot query the English pricing path.
- Closing, changing the search, switching accounts, replacing the batch or receiving another result prevents late catalog work from rendering or confirming a choice.

## Verification and remaining limits

**1,868 checks passed across 15 targeted suites, with zero failures.** The companion JSON records the suites and active asset hashes. Tests use the shipped mobile/desktop UI, real catalog snapshots and real browser storage with synthetic photos and blocked external services. Existing OCR checks also run native Tesseract against generated title strips. Screenshots of the confirmation dialog were inspected at 390px and 1280px.

No paid live Ximilar benchmark, real iPhone camera test, or exhaustive sports/variant checklist was performed. Catalog counts and coverage gaps remain those in `catalog-completeness-20261026.md`. The catalog refresh process still requires a reviewed import and release; no automatic production schedule is claimed.
