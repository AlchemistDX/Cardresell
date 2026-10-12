# Selected draft review — October 12, 2026

Adds Review selected drafts beside the bulk download. Review follows loaded list order and includes only selected eBay fixed-price drafts. The selected queue displays its position and Previous / Next draft / Back to selected drafts controls. Opening a selected row also starts the queue at that card; unrelated single-draft entry points retain ordinary review behavior.

Returning normally preserves the loaded pages and selected IDs so sellers can download the same group without rebuilding it. Refresh drafts explicitly reloads the list. The selection is temporary browser state, not persisted across reloads or accounts. Queue position means navigation position, not a claim that a draft has passed review.

Navigation waits for photo saving, loading, packet refresh and deletion work. Photo-block repaints update queue controls. A request sequence and account snapshot prevent a slow older draft read from replacing the currently opened draft. Account changes invalidate the selection/queue. If any queued draft is deleted, the return path reloads authoritative list data and counts instead of restoring a stale card.

Verification includes selection filtering/order, queue boundaries, previous/next, return-to-selection, mobile width, photo-save navigation guard, an out-of-order server response, and deletion followed by navigation and return. Existing draft export/edit/delete and review-screen tests run against local authenticated fixtures. No eBay drafts or listings are created by this change.
