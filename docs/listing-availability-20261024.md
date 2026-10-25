# Saved copy status and listing exports

Collection now shows each copy's saved sale/production eBay reservation status, the last check time, a refresh action, and a direct link to the relevant eBay operation. Draft preparation, price comparison, inventory backups and recording actual sales remain available. A saved plan is explicitly labelled as not sent.

Before building a manual listing file, the shipped client checks the selected draft revisions against the verified user's saved inventory and permanent sale receipts. It checks again after photos are prepared, before the single or combined download. Recorded sales, held operations (including uncertain, ended and account-deleted states), corrupt reservations, missing/grouped/duplicated tracked stock, stale/deleted/archived drafts and failed checks stop the file. Selected drafts referring to the same physical copy are rejected. Local permanent sale receipts also block exports before cloud sync completes. Failed batches retain their selections and unlock retry controls.

The new `POST /api/listing-availability` is read-only. It accepts up to 100 `{draftId, rev}` entries or 2,000 Collection copy IDs. It uses verified UID keys, reads production holds regardless of current connection settings, never reads seller tokens, and returns only the requested statuses. Lua GETs read inventory, holds and re-read draft bytes atomically, rejecting wrong key types; draft bytes must match the initial identity lookup. It never reserves stock, changes a draft, charges a credit or contacts eBay.

Reading a production operation and explicitly cancelling an unsent production plan remain possible if connection configuration is disabled or switched to Sandbox. Provider recovery and mutations still require configuration matching the requested environment. Cancelling only affects that owner's unsent plan; no uncertain/live operation is released. Status caches are short-lived and owner-scoped, refresh on focus, and invalidate after cloud sync or operation changes. Failed checks retract prior clear status.

## Verification

The new suites run the actual handlers against isolated Redis, then drive the shipped browser and real read handler at 390px and 1280px. They cover owner boundaries, receipts after report deletion, malformed/wrong-type holds, connection changes, cancellation, stale revisions, a hold appearing during photo work, batch retry recovery, local sales, malformed replies and an account switch during a delayed check. Existing Collection, photo exports, listing CSV, operation recovery, copy-sale integrity, asset fingerprints and test registry suites are also checked. No customer inventory or live marketplace writes are used.

## Limits and rollout

This is a check of saved CardResell evidence, not a transaction that reserves a manual CSV export. State can change after the snapshot; a large batch is checked in chunks. Previously downloaded files, older cached clients, outside listings and sales still require reconciliation. A scan draft not linked to Collection retains manual export with an explicit untracked status; it does not become authoritative stock. Direct marketplace writes remain disabled. This release does not grant eBay write scopes, enable automatic sale imports, or add access to global sold-listing history.

There is no inventory migration. Existing reservations, receipts and credentials retain their formats. New immutable assets are referenced from `index.html`; prior shipped assets are retained. If rolling back the client, retain the read-only availability endpoint for cached new clients until they reload.
