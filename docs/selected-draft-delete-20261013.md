# Delete selected drafts

Drafts now offers **Delete selected drafts** alongside the existing selection actions. The confirmation shows the exact number and explains that saved listing details and hosted draft photos are removed; Collection cards and live eBay listings are unaffected.

The operation snapshots selected loaded draft IDs and revisions and runs the existing delete executor sequentially. The executor retains revision checks, idempotency, hosted-photo cleanup and lost-response reconciliation. A failure stops further deletes and keeps remaining drafts selected. Account changes stop further writes. Counts are reloaded from the server; failed refreshes do not invent a new total. Previously loaded rows remain available after partial completion and subsequent pages deduplicate IDs.

Validation (synthetic accounts only):
- Selected-delete browser suite: 30 checks passed, including cancellation, selected-only deletion, duplicate confirmation, revision conflicts, lost responses, missing revisions, refresh failure, account switching, final empty-state feedback and 390px layout.
- Existing delete browser suite: 113 checks passed.
- Draft-list screen: 102 checks passed.
- Test registry: 12 checks passed.

Browser suites exercise the shipped bundle and real API handler with synthetic RS256 authentication and an in-memory Upstash substitute. They do not validate production Redis or operate on customer drafts.
