# Batch preparation cancellation and recovery races

Two bugs were reproduced in the shipped Collection batch workflow using local
browser fixtures, with all external transport blocked.

## Cancellation during preflight

After confirming a batch, closing its review during a slow capacity check did
not revoke approval. When the check completed, the old implementation saved the
journal, reopened progress, and submitted drafts despite the cancellation.

Preparation now retains the exact review dialog and reviewed selection. After
capacity and eligibility checks, and immediately before the initial journal
write, it verifies that the review is still open and current under the same
account. Cancel, Close and Escape therefore stop preflight without creating a
batch or submitting drafts. The selection remains available for fresh review.

This applies before the durable batch exists. Closing progress after requests
have started still leaves the already-approved batch running and recoverable;
Pause remains the explicit way to stop after the current request.

## Stale recovery-clear confirmation

An unreadable recovery dialog could delete a newer record written by another
tab while its confirmation was open. The clear action now captures the exact
unreadable bytes reviewed by the user and compares them again under the shared
batch lock before removal. Any replacement is preserved, including another
unreadable record. The dialog explains the change and asks the user to reopen
progress. Unchanged records can still be cleared with explicit confirmation.

## Verification

The existing `collection-batch-recovery.mjs` browser suite adds all three close
actions at three async boundaries: capacity, eligibility and snapshot hashing.
It checks no draft or admission writes, no new journal, no reopened dialog,
preserved selection, and a successful fresh batch after cancellation. It also
tests valid and unreadable replacements from another real tab during native
confirmation, normal clearing, and completion after closing saved progress.

Both original defects failed their regression assertions before their fixes.
The release also runs the complete local suite under the verified external
network restriction and the identity, listing export, listing photo and
membership release checks. No eBay authentication, marketplace writes, paid
scans or customer-data changes are needed for these checks.
