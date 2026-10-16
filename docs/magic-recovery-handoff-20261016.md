# Magic printed-name recovery after manual confirmation

A binder page with zero Magic identities had no trusted set for the existing printed-name fallback. The catalogue dialog could confirm a card, but it never started that fallback. Screenshots also show names well below the top of some pocket crops; all three previous OCR strips ended within the top 19%.

## Changes

- Explicitly confirming a Magic printing starts name recovery for unresolved cards, using that confirmed set. A newly confirmed set also permits a new attempt after a previous set produced no match. Concurrent triggers share one job; a new set arriving during that job is processed afterward.
- Three overlapping OCR strips now span the upper 35% of the pocket. Recognition distance and name-similarity thresholds are unchanged. A successful automatic recovery still displays **Matched from the printed name. Please check it.**
- Catalogue responses must match the requested set, English language and physical-paper game, and contain a printing ID and collector number. Price, finish choices and artwork are taken from that response. Recovery no longer performs another fuzzy price lookup that could select a different printing. Missing base prices remain missing; they are not replaced by premium foil prices.
- A visible progress bar offers a 44px Stop button. Reader loading, worker creation, decoding, recognition, requests and the overall job have bounded waits. A stalled reader is terminated before another read can start. Cancellation also releases workers arriving late.
- Delayed work cannot update a different account, batch, queue, removed row, replaced photo, saved batch, draft operation, or row being edited in the catalogue dialog. Closing the batch cancels recovery immediately. Rows and physical-copy metadata remain in place, and no recovery action saves inventory or spends ID credits.
- Provider responses that explicitly require review cannot supply trusted sets for recovering other rows.

## Verification

- `node tests/bulk-text-rescue.mjs`: shipped runtime with synthetic OCR/catalogue boundaries; exact-set/printing validation, prices, concurrency, late responses, account and photo changes, cancellation, timeout cleanup, and new-set retries.
- `CR_CHROMIUM=<binary> CR_TESSERACT=<binary> node tests/bulk-text-rescue-browser.mjs`: shipped mobile DOM, CSS and recovery code in portrait/landscape. Confirms a printing from a zero-match page, checks automatic follow-up, progress/Stop, retained physical-card data, manual editing and account/close races. Native Tesseract reads synthetic card titles at 5%, 18% and 28% of pocket height from the actual generated strips.
- The catalogue, binder, identity, export and photo release gates plus the standard local regression suite accompany this change. Tests use synthetic data and block external traffic; no paid scans or customer account writes are used.

The first full run exposed two existing timing assumptions in unrelated browser fixtures: offline external resources could delay draft-page loading, and host scheduling could turn nominal 70ms typing gaps into real debounce pauses. The draft fixture now aborts external resources immediately. The typing fixture advances the browser clock explicitly between native key events; assertions and production debounce behavior are unchanged.

## Limits and follow-up

These checks demonstrate the handoff, crop coverage and lifecycle behavior. They do not establish recognition accuracy on the original photographed binder pages. Glare, blur, card angles, mixed-set pages and same-set alternate art can still need manual confirmation. A page with no trusted Magic set requires one seller-confirmed printing before automatic name recovery can start.

The existing bulk path still treats a provider response containing a convenience `card_name` as a successful row even when `needsPicker` asks for a choice. This release only prevents that unconfirmed row from seeding recovery. A separate provider-candidate review change must preserve the server's confirmation receipt and debit-on-confirmation flow; it must not bypass billing by reclassifying a pending choice as free catalogue recovery.
