# Reviewed inventory backup recovery — 2026-10-16

## Seller workflow

**Recover inventory** in Collection and Flips accepts version-1 CardResell
inventory or sale recovery JSON backups. The seller explicitly chooses the saved
device or account inventory, reviews every missing copy and confirms the receiving
account. Preview does not write to the account or device.

Recovery adds only missing individual physical copies, retaining the original ID,
card details, purchase cost (including unknown versus zero), location, source SKU,
acquisition date, metadata and supported field histories. Existing copies are
skipped. Sale links, permanent sold-copy receipts, retained deletion marks and
unfinished sale records from both backup snapshots are checked along with current
device and account history. A known sold or deleted copy is excluded even if the
selected inventory snapshot still contains it.

The file's sales, deletion records, listing drafts and pending operations are not
restored. This is missing-inventory recovery, not a complete account rollback.
An older backup cannot prove a later sale or deletion absent from all available
histories. Existing tombstone retention and capacity limits remain unchanged;
the current account's permanent sold-copy ledger still protects sold copies after
their sale reports are deleted.

Files are limited to 4 MB. A request supports 1–500 missing individual copies and
800 KB; each copy is limited to 300 KB, and combined inventory to 2,000 copies.
Malformed JSON, duplicate IDs, grouped quantities, unsupported histories and
unsafe record keys are rejected without changing records. Preview renders file
values as text. There is no automatic source selection or automatic recovery.

## Account save and interrupted recovery

The existing verified account boundary handles `POST /api/user-data` with
`action: recover_inventory`. A bounded Redis compare-and-set loop saves the added
copies and their server-owned receipt atomically. If any reviewed ID now exists,
is sold or has a retained deletion mark, the entire request stops for a fresh
preview. Independent concurrent additions are preserved.

An identical recovery ID and request returns its original receipt; reuse with a
different payload fails. Receipt verification includes the exact canonical request
SHA-256 and ordered copy IDs. Replays return the latest visible account inventory
and sales, so later edits, sales and deletions are not undone. Normal snapshot
uploads cannot erase the server-owned archive. The archive has no TTL and stops at
100 recoveries rather than discarding retry proof; the existing 900 KB account
storage cap also applies.

Recovered legacy fields receive a protected baseline for purchase cost, location,
source SKU and acquisition date. Existing field histories remain intact. This
prevents a later stale legacy snapshot from silently replacing recovered values;
divergent protected edits continue to use **Review inventory sync**.

The browser saves an owner-scoped request before contacting the server and pauses
background sync. **Resume saved recovery** explicitly retries that same request.
A verified receipt is saved before device changes, and the journal is cleared only
after those writes succeed. Interrupted requests, failed local storage, reloads and
account switching retain the original request. A definite rejection can be cleared
with **Start fresh preview**; an unknown result cannot be discarded by that action.
Corrupt journals remain available in a download and block automatic synchronization.

The same Web Lock used by sale recovery serializes local recovery operations.
Current owner and exact reviewed local records are checked before sending. The
response merges with the latest device records; later local additions, sales and
deletions survive. Conflicting local identities stop application for review. Both
inventory and sales merges are computed before device writes. A failed local write
retains the confirmed request, and resume fetches current account state again.

**Download current backup** preserves device records, journals and unreadable raw
JSON plus the reviewed account snapshot when available. Authentication tokens are
excluded. Existing inventory- and sale-conflict backup downloads now include this
recovery journal as well.

## Verification and release boundaries

- `tests/inventory-backup-recovery.mjs`: 50 checks of shared policy and the actual
  authenticated handler with isolated Redis. Includes ID preservation, unknown/zero
  cost, retired copies, immutable receipts, concurrency, stale previews, later
  edits/sales/deletions, authorization isolation and storage limits.
- `tests/inventory-backup-recovery-browser.mjs`: 52 checks at phone and desktop
  sizes using shipped UI, the real handler and isolated Redis with synthetic auth.
  Includes explicit preview/confirmation, hostile file text, failed storage at
  multiple stages, lost acknowledgements, reload, retries, late local changes,
  account switching and corrupt-journal export. Both layouts were visually checked.
- Both suites are registered in the full local runner. The full runner, required
  identity/export/photo gates and membership release inspector must pass before
  release. Actual results and production verification are recorded in the PR.

Testing uses synthetic accounts and isolated storage, with no customer inventory
edits or paid scans. Public production checks verify release files and unauthenticated
boundaries; they do not establish an authenticated live-account walkthrough.
This change does not enable eBay publishing, ingest marketplace orders or change
credentials. Marketplace account setup and validation remain separate work.
