# Sale conflict review and recovery — 2026-10-16

## Seller workflow

Collection and Flips now expose **Review sale sync**. The review fetches the
signed-in account snapshot without merging it into the device. Conflicting
sales show both dates, original proceeds, all six cost inputs, expense notes,
and profit after tracked costs. Unknown costs remain unknown. No version is
preselected; the seller chooses either the device or account accounting values.

The choice keeps the account's original sale ID, physical-copy link and
non-accounting metadata. It never restocks a card, issues a refund, publishes a
listing, or changes credits or subscriptions. The seller can subsequently use
Sales report → Correct sale for further adjustments.

**Download recovery backup** creates JSON containing device inventory, sales,
tombstones, sold-copy proof, unfinished journals and the reviewed account data.
It includes the account's saved-choice archive when the account read succeeded.
A pending choice includes both reviewed versions in its device journal. An
unreadable local value is exported as raw bytes rather than silently discarded.
Tokens and authentication state are not included. This is a recovery format,
not an automatic restore or CSV-import format; keep the file private.

## Atomic account choice

`POST /api/user-data` with `action: resolve_sale` uses the existing verified UID
and one-key Redis compare-and-set. The exact reviewed account row must still
exist, be visible after tombstones, and have an unambiguous ID. The device row
must refer to the same sale and physical copy. Unsupported correction histories
remain held. Only a genuine accounting conflict may be resolved this way.

The chosen values become a new correction descended from the reviewed account
revision. Existing account metadata and other inventory/sales survive. An
unreviewed branch on a third device still conflicts; the explicit choice does
not authorize overwriting later edits or all possible branches.

The same CAS stores a receipt with both complete reviewed rows, the choice and
the result. Reusing the same request ID and payload returns that receipt without
another mutation, even if the sale was subsequently deleted. Reusing its ID for
a different payload is rejected. Normal sync retains this server-owned archive;
clients cannot clear it by omitting it. The archive has no TTL and refuses new
choices at 100 entries rather than pruning evidence. The existing 900 KB
account limit and a 300 KB request limit also fail without partial writes.

The revision history is still bounded at 100 ancestors. Histories and receipts
are operational recovery records, not tamper-proof accounting audit trails.

## Device recovery and concurrent edits

The browser writes an owner-scoped journal before POST, using the same Web Lock
as sale correction and interrupted-sale recovery. Ordinary push/pull callbacks
pause while the journal exists, including responses already in flight. The
request is only retried when the seller presses **Resume saved choice**.

The browser verifies and persists the account receipt before changing the local
sale. A failed local write or failed journal clear remains safely repeatable.
A changed or deleted local row is preserved after an account commit and needs a
fresh review. Account changes refuse late responses, and returning to the
original account allows recovery. A confirmed stale-review rejection offers a
fresh review; a network/unknown outcome keeps the original request for retry.
Corrupt journals remain intact and block automatic sync.

## Additional input fix

The existing mark-sold modal delayed autofocus by 50 ms. Browser regression
checks exposed that it could move focus back to the sale price after a seller
had started entering a cost, putting the next digit into the wrong field. The
callback now focuses only while the modal is open and no input inside it has
focus. The sale-reconciliation browser test verifies that a cost field retains
focus through this delay.

## Verification

- `tests/sale-conflicts.mjs`: real user-data handler and isolated Redis, both
  choices, exact-row checks, numeric/string identity, authorization isolation,
  concurrent same/different choices, unrelated simultaneous edits, lost-ack
  idempotency, deletions, unsupported histories and capacity preservation.
- `tests/sale-conflicts-browser.mjs`: shipped page through the actual API and
  isolated Redis at 390 and 1280 pixels. Includes no default choice, both profit
  outcomes, inert stored HTML, JSON backup, local/cloud stale reviews, reload,
  interrupted response, failed journal/local writes, changed local data during
  a request, account switching and corrupt-journal backup.
- Full local runner, required identity/export/photo browser release gates and
  membership build inspector must pass. Actual results and Production hashes,
  auth boundaries and observability are recorded in the release PR.

These tests use synthetic data and stubbed authentication. Public Production
verification does not establish an authenticated live-account walkthrough.
Live eBay publication and order synchronization still require separate account
setup and validation; listing writes remain disabled.
