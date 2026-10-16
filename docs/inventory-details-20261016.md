# Inventory details and recovery — 2026-10-16

## Seller workflow

Each Collection copy now has **Inventory details** for purchase cost, location,
source SKU and acquisition date. Printing, grade, condition and physical copy ID
are unchanged. The source SKU is descriptive and may be shared by multiple copies;
it is not used as a physical identity or marketplace SKU.

Blank purchase cost means unknown; explicit zero means the copy cost nothing.
Only changed fields are written, so opening the form does not erase a legacy date
or an unknown value. Purchase costs require nonnegative amounts with at most two
decimal places. Acquisition dates use YYYY-MM-DD or blank for unknown. Existing
prepared listing drafts keep their previously prepared details.

**Set location** operates on the current selection, including cards hidden by a
filter. The dialog lists all targets, requires a changed location (or an explicit
clear action) and confirmation, and supports up to 500 individual copies. Under
the same Web Lock as local sale recovery, every selected record is compared with
the reviewed snapshot before a single checked portfolio write. Any stale, sold,
deleted, grouped or ambiguous target refuses the entire batch. Unrelated records
remain intact. Failed storage writes leave the form and entered values available.
A pending sale or inventory-choice journal must be finished before editing.

## Field protection and synchronization

Each edited field carries its own version-1 revision ID, linear ancestors and
original baseline. Changes to different fields combine. A stale baseline or older
ancestor cannot erase an edit; concurrent changes to the same field require an
explicit choice. Timestamps do not decide protected values. Malformed, unsupported,
cyclic or excessive histories fail closed. Each field retains at most 100 ancestors;
reaching the limit refuses a new edit rather than pruning proof.

Server POST and browser push/pull use the same field merge. Both browser collection
merges are computed before writing either set. Malformed local JSON is preserved,
and acknowledged cloud data is merged with the latest local rows. Current sold-copy
receipts and tombstones filter records before comparing inventory details. A
protected inventory edit cannot outrank a retained deletion mark even if its local
timestamp is later. Existing tombstone retention/capacity limits remain unchanged;
permanent sold-copy proof still prevents restocking after a sale report is deleted.

## Review and recovery

**Review inventory sync** is available in Collection and Flips. It fetches the
account snapshot without applying it locally, identifies which fields conflict,
and displays both versions with no preselected choice. The chosen version supplies
only conflicting fields; independent edits combine. Canonical account identity
and non-editable metadata stay unchanged.

`POST /api/user-data` with `action: resolve_inventory` uses the existing verified
account boundary and Redis compare-and-set. An exact reviewed account snapshot is
required. Both originals, the explicit choice and its resulting record are archived
atomically with the update. The owner-only GET returns this recovery archive.
A request ID is idempotent: repeated identical requests return the receipt; a reused
ID with another payload fails. A later sale or deletion is never reversed by replay.
Ordinary client snapshots cannot replace the server-owned archive.

The archive has no TTL and stops at 100 choices. The existing 900 KB account cap,
300 KB recovery-request cap and bounded CAS retries fail without partial writes.
These histories are operational recovery records, not tamper-proof audit trails.

Before POST, the browser persists an owner-scoped journal and pauses background
sync. Only **Resume saved choice** replays an unfinished request. A verified receipt
is saved before applying local changes. Failed local storage, lost responses and
account switching remain recoverable. Late local edits, sales or deletions are
preserved. A stale-review rejection requires a fresh review; an unknown network
outcome retains the original request. Corrupt journals stay intact and block sync.

**Download recovery backup** includes device inventory, sales, tombstones, sold-copy
proof, both recovery journals and the reviewed account snapshot with its archives.
Unreadable local JSON is included as raw text; authentication tokens are excluded.
There is no automatic JSON restore flow in this release.

## Verification

- `tests/inventory-details.mjs`: 52 checks against shared merge rules and the actual
  authenticated handler with isolated Redis. Includes independent/concurrent edits,
  unknown/zero costs, stale and duplicate IDs, deletion/sale precedence, capacity,
  idempotent recovery and authorization isolation.
- `tests/inventory-details-browser.mjs`: 71 checks at 390 and 1280 pixels, using the
  shipped UI, real handler and isolated Redis with stubbed authentication. Covers
  forms, hidden selections, all-or-nothing batches, storage failure, reload, real
  push/pull, explicit conflict choices, recovery backups, lost responses, late local
  changes/sales and account switching. Screenshots were visually inspected.
- Full local runner, required identity/export/photo browser release gates and the
  membership release inspector must pass before releasing. Exact results, deployment
  commit, public asset fingerprints and sampled logs are recorded in the release PR.

No customer inventory was edited for testing. Public production checks do not prove
an authenticated live-account walkthrough. This release does not change eBay
credentials, publish marketplace listings, ingest orders or charge for scans.
Live eBay publishing and automatic sales synchronization still require separate
account setup and validation; the existing listing-write gate remains disabled.
