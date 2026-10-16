# CSV import history and recovery protection — 2026-10-16

## Problem and behavior

The CSV importer previously checked current sales rows and deletion markers, but
did not read the permanent sold-copy ledger. Once a sale report was deleted and
its deletion marks expired, a repeat CSV import could add the same physical copy
back to device inventory. Account synchronization already refused the sold copy,
but the import preview and local save should honor that proof as well.

The importer now uses the same strict retired-copy policy as JSON backup recovery.
Permanent receipts exclude both remembered import IDs and explicit CardResell
Collection IDs. Missing reports do not erase that protection. Unsupported,
unreadable or conflicting sold histories stop the import while retaining the
original records. Malformed deletion history and ambiguous local IDs also stop it.

**Add as new purchases** remains an explicit way to add different physical copies
of the same printing, assigning fresh IDs. It cannot reuse a mapped CardResell ID.
Quantities, unknown versus zero amounts, conditions, locations and source SKUs keep
their existing import behavior.

## Recovery and concurrent tabs

Import review and commit capture the raw portfolio, sales, tombstones, permanent
sold ledger and four pending sale/sync/inventory-recovery journals. Any change to
that snapshot requires another review. An unfinished sale, sale-sync choice,
inventory-sync choice or backup recovery must be completed before importing.
Unreadable journals remain intact, with a message to download a recovery backup.

Import commits acquire the existing owner-scoped sale/recovery Web Lock. After
waiting, they check the current account and reviewed snapshot again. The final
check and single local portfolio write run synchronously inside the lock. Two
participating tabs cannot both commit against the same old inventory: the later
tab reviews again and keeps the first tab's additions. A sale receipt arriving
while an import waits also invalidates the preview.

Controls and Escape are disabled while a commit waits or saves. An account change
cancels the old dialog and prevents the queued callback from writing into either
account. A browser without Web Locks receives an actionable refusal before any
inventory change. Failed local storage retains the preview for retry.

The sync-size estimate now includes the local sold-copy ledger. Saving still uses
the existing local-first flow and clearly says that account sync confirms
separately. No new server write action or automatic replay was introduced.

## Limits

Protection uses the history currently available on this device and the import's
remembered identities. A modified CSV without CardResell Collection IDs can produce
different import fingerprints; the importer cannot infer whether those are the
same physical cards. It cannot discover an unreceived sale on another device while
offline. The account's permanent sold-copy check remains in force at sync.

Existing CSV size, physical-copy count and tombstone retention limits remain.
The Web Lock coordinates operations that use the existing sale/recovery lock;
this does not claim that every legacy browser writer has been converted to it.

## Verification

- `tests/collection-import.mjs`: 97 checks, including the shared policy, strict
  file parsing, explicit new purchases, preserved details, stale previews,
  malformed history and the shipped import UI at phone and desktop widths.
- `tests/import-history-browser.mjs`: 45 checks using the complete shipped app,
  actual user-data handler and isolated Redis with synthetic authentication.
  Covers import and sync, actual sale recovery and sale-report deletion, expired
  tombstones, ledger-only changes after preview, each pending journal, malformed
  records, simultaneous tabs, queued ownership changes and missing Web Locks.
- Both suites are registered in the full runner. The skipped-copy preview was
  visually checked at 390 and 1280 pixels. Full runner, required identity/export/
  photo gates, membership release inspection and exact production verification
  results are recorded in the release PR.

No customer inventory or marketplace listings were changed for testing. Public
production checks establish release identity and unauthenticated boundaries, not
an authenticated live-account walkthrough. eBay publishing, automatic sales sync
and the external sold-comps provider remain separate outstanding work.
