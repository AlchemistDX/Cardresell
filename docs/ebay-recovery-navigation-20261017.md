# Recover eBay operations after a draft disappears

A draft-specific operation lookup fails when its source draft has been deleted, even though the durable physical-copy operation is still available through the account-wide index. The detail dialog previously exposed only reload, leaving sellers without an immediate route to the retained plan.

Draft-specific dialogs now always offer “View all saved operations,” including after an initial load failure. The navigation is disabled during requests and rechecks account ownership before opening the account-wide view. Failed initial loads stop displaying “Loading”; failed refreshes explicitly label previously displayed status as stale. Cancellation and publication boundaries are unchanged.

Validation: 42 browser → actual handler → isolated Redis checks across 390px and 1280px widths, covering deletion, initial and subsequent lookup failures, exact plan preservation, global navigation, explicit cancellation, lost save acknowledgements, read-only recovery and account switches. Asset fingerprints: 254 passed. No real account records, marketplace requests or credentials used. One added test initially passed a string rather than the documented options object to the opener; the harness call was corrected and the complete suite passed.

This release improves access to saved plans. Direct eBay listing mutations remain disabled and real seller authorization/acceptance is still outstanding.
