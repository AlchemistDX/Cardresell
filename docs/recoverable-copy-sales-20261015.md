# Recoverable sales and sold-copy identity

## Problem and behavior

Mark sold previously saved a flip, added a deletion marker and removed the Collection row in separate writes. A failed marker or removal could leave the same card available to log again. Cloud sync had no lasting sale identity: deleting a report row or expiring a 90-day deletion marker could restore sold stock from an old snapshot.

The new path saves an owner-scoped recovery journal before any business data. Its original sale ID, price, cost-field states and copy details are reused on explicit recovery. Failed writes keep the modal open; Collection offers **Resume saved sale** after reload. A Web Lock serializes sale commits across tabs. Browsers without Web Locks refuse this path before changing records. A different account cannot see or resume the journal. Corrupt records are preserved and require review.

Once the sale row is stored, the copy is excluded from available local stock, including when later writes fail. Recovery checks the sale ID and copy link, preserves an existing corrected sale, writes a lasting receipt, checks the deletion-marker write, removes only the sold copy, then clears the journal. Clearing failure remains repeatable. This is local write recovery, not an offline marketplace operation.

Explicit zero acquisition cost from CSV remains zero in the sale form. Blank fees and costs remain unknown. Success text directs sellers to complete missing costs rather than claiming actual profit. Sale records retain source Collection ID, import identity, location, SKU, condition, finish, game, grade/certificate, acquisition date and original acquisition cost.

## Cloud invariants

`userdata:<verified UID>` remains the Collection/Flips authority. No data is moved to the older `collection:<UID>` API. A versioned `copySales` field contains `{copyId, saleId, recordedAt}` receipts, derived by the server from linked sale rows before merges and tombstones are applied. Client-supplied receipts cannot clear or replace this history.

- The existing snapshot CAS stores the sale, receipt and exclusion from stock together.
- One physical-copy ID cannot have two distinct sale IDs. One sale ID cannot be reassigned to another copy or have its copy link removed.
- Revenue and cost corrections on the same sale remain supported.
- Receipts do not expire with deletion markers or disappear when a flip report is deleted. Returns/reacquisition need a future explicit workflow; this release does not silently reopen the same identity.
- Conflicting legacy sales return 409 and preserve saved bytes for review. Unknown receipt versions are retained and refused.
- History is bounded at 10,000 receipts and the existing 900 KB account snapshot limit; reaching a limit fails without pruning receipt history. Existing 2,000-row collection/report limits remain.
- GET projects legacy linked sales into receipts and excludes their copies immediately; the next successful POST persists those receipts. Client pull/push responses merge receipt evidence and remove sold copies from fresh local inventory without replacing unrelated local edits.

Local receipts live at `cardsell_<UID>_copy_sales_v1`; the one active recovery journal is `cardsell_<UID>_sale_recovery_v1`. Anonymous device records use the existing unscoped key convention. Account sync derives receipts from migrated linked flips; device-only history without a remaining flip is not an account receipt. Clearing browser storage can remove device-only work. There is no automatic server recovery of an unsynced journal.

## Listing reservations

Saving an eBay plan now requires exactly one unsold, synced Collection row whose physical instance is `inst_col_<Collection ID>`. Missing, ambiguous, deleted, sold or quantity-grouped stock is refused. Draft-only scanned cards must first enter Collection. The userdata bytes are checked in the same Redis CAS that reserves the listing, so a sale saved between inventory validation and reservation prevents the plan. Future prepare/publish paths use the same revalidation. A sale recorded after an unsent plan keeps the plan available for cancellation and blocks preparation.

Recording a sale does **not** withdraw an eBay listing or release an uncertain operation. Recovery and owner cancellation remain available. Production listing writes remain hard-disabled, and seller access, live publishing, sales synchronization, refunds and actual-profit reconciliation remain unfinished. This increment does not claim cross-marketplace oversell prevention.

## Verification

`tests/copy-sales.mjs` exercises the actual user-data handler and Redis CAS: concurrent conflicting sales, stale snapshots, report deletion, expired markers, corrections, legacy conflicts, opaque IDs, future schema, missing/sold/grouped stock and sale-versus-plan races. The eBay operation fixture now seeds its actual cloud Collection row.

`tests/sale-recovery-browser.mjs` drives the shipped entry document/core/module in Chromium. Faults cover journal, flip, receipt, tombstone, portfolio and journal-clear writes; reload and explicit recovery; original sale identity and cost states; sibling preservation; two tabs; owner changes during a queued lock; corrupt journals; mobile and desktop controls. No paid scan, customer account or live marketplace write is used.

The prior source-shape durability assertion now checks delegation to the recovery commit; the storage-order guarantee is executed in the browser fault tests. The existing numeric-ID success scenario awaits the now-asynchronous Mark sold action. All historical hashed assets are retained unchanged; index.html selects the new content hashes.
