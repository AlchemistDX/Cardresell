# Seller-entered refunds and expenses — 2026-10-16

This milestone extends the saved-sale workflow. It does not issue refunds,
publish listings, reconcile marketplace payouts, or restore returned stock.

## Seller workflow

- Log a sale or mark a physical copy sold with refunds and other expenses.
- In Flips → Sales report → Correct sale, edit the cumulative amounts for that
  sale. Keep the original proceeds; enter fees after fee credits and avoid
  counting an expense twice. A note of up to 500 characters can explain costs.
- Blank amounts remain unknown. Entering zero explicitly confirms none.
  Existing sales need their refund and other-expense inputs reviewed before
  entering complete report totals; no automatic migration invents zeros.
- Dashboard, detail, table and CSV derive profit from the saved inputs instead
  of an old cached profit field. Refunds reduce revenue. ROI divides net by
  purchase, fees, shipping, grading and other expenses, excluding refunds from
  invested capital. Losses keep their sign.
- Reports group later adjustments by the **original sale date**. This is a
  seller-entered sale report, not a cash-flow, marketplace settlement or tax
  report. CSV retains existing columns and appends refunds, other expenses and
  notes; unknown amounts and incomplete net remain blank.

## Preservation and conflicts

Corrections retain the original sale ID, physical-copy link and other metadata.
Refunding or deleting a report never reopens a sold copy. Storage failures keep
the form open; account and exact-record checks refuse stale edits. Correction
saves share the existing Web Lock with interrupted-sale recovery.

`api/_saleCorrections.js` is also the source of the generated browser helper.
Corrections carry an opaque revision ID, ancestor IDs and their original
accounting snapshot. Multiple offline corrections can sync together. The
existing user-data Redis CAS applies the same ancestry checks on a retry.
Older snapshots cannot strip a correction. Divergent edits, reused revisions
with changed amounts, unsupported histories and ambiguous local IDs stop sync
while preserving local and cloud versions. No timestamp decides between
conflicting accounting edits. Uncorrected legacy records retain their existing
snapshot merge behavior.

The history is bounded at 100 ancestors. Reaching that limit refuses the next
correction instead of truncating its proof. Histories are not a tamper-proof
audit trail: an authenticated seller controls their own records.

There is no in-product conflict-resolution chooser yet. A held conflict needs
exports from the affected devices and explicit reconciliation; repeatedly
retrying does not select a winner. Cloud account notification and marketplace
statement import remain separate work. Existing account UIDs, subscriptions,
credits and listing write gates are untouched.

## Verification and release

- `tests/sale-reconciliation.mjs`: actual user-data handler with isolated Redis,
  concurrent corrections, stale snapshots, immutable sold identity, malformed
  histories and preservation on conflicts.
- `tests/sale-reconciliation-browser.mjs`: shipped page at 390 and 1280 pixels,
  partial/full refunds, explicit zero versus unknown, losses, ROI, CSV injection
  handling, reload, real sync callbacks with controlled responses, and mark sold.
- Existing report tests retain storage-failure, stale-editor and owner-change
  coverage; fixtures now explicitly confirm the two newly tracked fields.
- Run the full local suite, the three required browser gates from the release
  validation queue, and the membership build inspector before release. Record
  actual results and Production verification in the release PR.

No paid scan, live customer record or external marketplace mutation is needed
for these tests. A Production file/auth-boundary check does not establish
authenticated live-account sync or marketplace acceptance.
