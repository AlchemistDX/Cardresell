# Binder and individual scan finish review — 2026-10-13

## Outcome

A card identification is no longer treated as confirmation of its surface finish. Fresh non-sports scans require a seller finish choice before automatic pricing and draft preparation. The same rule applies to binder crops, uploads, rapid scans, individual-card lookup and Magic printed-name recovery. Existing saved records are not migrated.

The seller can choose an available normal/non-foil, holo, reverse holo, foil or etched printing, enter another finish, or save the card to Collection unpriced. The choices reflect the catalogue response; they are not a verdict from the image. A missing finish or missing price stays unpriced. Checking a finish makes no identification or price-provider request and spends no scan credits.

## What the audit found

- `/api/scan` returns a generic foil/non-foil hint. A foil hint does not distinguish holo from reverse holo, stamped variants, texture or other set-specific treatments.
- Bulk pricing selected one catalogue price and discarded the alternatives. MTG's foil fallback could also be labelled as ordinary USD/non-foil.
- Some saved-card backfill paths could substitute another printing's price. Collection rows could display cost as the value of an unpriced card.
- A delayed startup restore could replace a freshly selected card while a finish dialog referenced the previous object.

## Changes

- Preserve finish alternatives, including unavailable prices. TCGCSV responses now include `allVariants`; the cache version changes so older response shapes expire immediately.
- Confirm the surface separately from card identity and condition. The dialog explains binder glare, sleeve shine, viewing angle, pattern, texture and stamps without claiming one rule works for every set.
- Keep uncertainty through Collection save, reload and export. Unpriced scan rows show unknown value and gain/loss. Seller-entered values remain possible.
- Refresh only a matching finish key. Card-wide price ladders and automatic slab prices cannot replace the new scan's finish-specific value; unmatched combinations require a verified manual value.
- Carry confirmed `finish` into draft titles and CCG item specifics. Existing identity hashes/SKUs remain unchanged. Different finishes and unconfirmed copies are not automatically merged.
- Keep the picker within the shared keyboard-dialog lifecycle, return focus on dismissal, and reject stale Collection/batch edits. Restore yields to an existing card selection.

## Verification

The new end-to-end gate uses the shipped app with synthetic scan and catalogue responses at 390px/light and 1280px/dark. It checks foil-hint ambiguity, reverse-holo selection, custom/missing/zero values, keyboard behavior, no extra scan/provider call, unpriced saves, persistence, stale dialogs, MTG alternatives, draft gating, draft metadata and distinct physical copies.

| Check | Result |
| --- | --- |
| Scan finish browser gate | 90 assertions passed |
| Binder capture/crop browser gate | 90 passed |
| Customer search/save/sign-in journey | 90 passed |
| Real draft API and batch identity gate | 113 passed |
| Listing packet construction | 472 passed |
| Draft review and provenance | 422 passed |
| Printed-name recovery | 26 passed |
| Asset fingerprints | 121 passed |
| Local release build | Passed |
| Complete local regression runner | Passed: 116 suites executed, 3 explicitly skipped |

The draft tests now perform the real finish-choice action before draft creation. Exact-shape assertions include the new provenance fields. Historical tests that expected startup restoration to overwrite a fresh selection now assert that it yields. The catalogue UI test waits for a visible result before clicking, rather than treating a timing delay as proof that a result was absent.

## Limits

This verifies safe handling of uncertainty, not improved optical recognition. No live paid scan was submitted and no labelled physical-card accuracy benchmark was performed. Existing binder crop tests establish preparation and handoff, not identification or foil accuracy. Sports retain their separate parallel chooser. Real examples should be checked using the same card photographed in its binder, outside it, and at a gently tilted angle with the actual finish recorded.

No emails, ads, purchases, production customer records or existing card identities were changed by these checks. Deployment status is recorded separately after the release gate.
