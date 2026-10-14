# Search dismissal and keyboard quality of life

Prepared October 13, 2026, America/New_York (October 14 UTC).
This extends the pending scan-comparison optimization; not yet published.

## Changes

- Escape now cancels the queued autocomplete lookup and invalidates any pending
  reply. Previously it only hid the dropdown, so a queued lookup could reopen it.
  The typed query stays in the field and an explicit Enter can search again.
- Closing full results invalidates an unfinished search, preventing its late
  response from repopulating the dismissed dropdown. Completed results retain
  their existing short reuse window to avoid unnecessary repeat lookups.
- Enter used to confirm an input-method composition no longer submits search.
- The full-results back/close button has the accessible name “Close search results.”

No scanner identity, price, fee, billing or data-persistence rules change.
The entry document uses new immutable core and UI assets; previous files remain
available. The earlier scan-distance optimization remains included.

## Evidence

The shipped search input handlers, search dispatcher, request coordination and
catalog renderers run in the browser fixture with a deliberately delayed provider.
The former fixture-only input listener was replaced with the actual shipped
listeners, so debounce, Escape and composing-key behavior are exercised directly.

The previous code failed the new queued-lookup cancellation assertion. A separate
baseline run also failed the IME-confirmation assertion. The candidate passes
36 search checks at 390px and 1280px, including query retention, explicit retry,
late replies, completed-result reuse, correct card selection and provider errors.
These checks use synthetic responses and send no provider requests.

Asset integrity (157 checks), configured build and whitespace checks pass. The
full local regression passed: 118 executed suites, three optional/live slots
skipped, exit zero. Skips are not passes. No production release,
customer account mutation or paid operation is performed in this pass.
