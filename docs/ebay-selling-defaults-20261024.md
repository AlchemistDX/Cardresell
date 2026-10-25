# eBay reusable selling settings and setup recovery

Continues the linked-seller workflow after PR #116. A seller can now reuse the
shipping policy, payment policy, return policy and dispatch location selected
in an eBay draft. The settings are saved only when the seller chooses **Save
selling defaults** and apply to fresh drafts after current eBay requirements
have loaded. Existing draft choices take precedence. **Use saved defaults**
explicitly replaces the current choices; **Forget saved defaults** leaves the
current draft untouched.

Defaults are browser-local, expire after 90 days, and contain four setting IDs,
a timestamp and an opaque account context. The context binds the CardResell
owner, eBay seller and environment, and stays stable through same-seller
reauthorization. It contains no token. No condition, photo, certificate,
inventory availability statement or publication approval is reused. Each check
still reloads current provider requirements and validates the exact selected
settings on the server. Removed, disabled, incomplete, calculated-shipping or
wrong-marketplace choices cannot be silently substituted. Storage failures
are visible and preserve the current draft choices.

## Setup and recovery

- A healthy connected account emphasizes **Check seller setup** rather than
  reconnecting. The connection dialog can lead directly to listing drafts.
- **Check seller setup** in draft review opens the connection dialog and runs
  the read-only checks. Closing it restores focus and the draft's selections.
- Missing US policies have an official Business Policies help link. Missing
  usable inventory locations have a separate explanation and setup reference.
  The current read-only connection cannot create policies or locations.
- Setup counts enabled locations with a nonblank key and usable dispatch
  address. A paginated/incomplete response remains unknown rather than being
  presented as the seller's complete list. Submission checks use the same
  address validation; a blank postal code is not an address.
- Failed requirements refreshes retract the old requirements and disable
  review saving until a successful reload. Selections remain recoverable.
- Browser requests bind the observed connection version. The server also
  rejects a seller change between reading that version and obtaining the
  token, before loading another seller's settings. Existing CAS checks still
  protect changes during provider reads and final saving.
- Missing provider policy IDs cannot become the literal string `undefined`.

## Verification

Nine focused suites passed on the final sources:

| Suite | Assertions |
| --- | ---: |
| ebay-selling-defaults-browser | 68 |
| ebay-seller-connect | 164 |
| ebay-listing-review | 114 |
| ebay-connect-browser | 90 |
| ebay-listing-review-browser | 42 |
| ebay-listing-operations | 94 |
| ebay-listing-operations-browser | 42 |
| asset-fingerprints | 254 |
| test-registry | 12 |

Total: 880 assertions. The new browser suite loads the content-addressed assets
referenced by index.html and exercises browser → real review/connection
handlers → isolated Redis → saved review. It covers 390px and 1280px layouts,
repeated drafts, account changes, same-seller reconnect, obsolete settings,
failed refreshes, local-storage failure, focus recovery and absence of
marketplace writes. Both layouts were visually inspected. Build inspection,
JavaScript syntax and whitespace checks also passed. This was a focused pass,
not a full run of all 150 registered suites.

No customer drafts, real marketplace listings, seller policies, inventory
locations, sales or credentials were changed during tests. Existing Node
module-type warnings remain. This does not verify the owner's current live
policy or location configuration.

## Remaining direct-selling milestone

The seller connection is established; direct publishing and automatic sales
synchronization remain disabled. The next activation work is permission-bound
write authorization, physical-copy availability checks shared across collection,
export and direct operations, explicit per-listing fee approval, and verified
publication/recovery followed by order and cancellation reconciliation. The
existing operation engine and reservations remain gated until these work
together. Automatic market-wide recent sold comps remain a separate provider
access limitation.

Primary references checked for the setup guidance:

- [eBay Business Policies](https://www.ebay.com/help/selling/business-policies/business-policies?id=4212)
- [Inventory locations](https://developer.ebay.com/api-docs/sell/static/inventory/managing-inventory-locations.html)
- [Required offer fields](https://developer.ebay.com/api-docs/sell/static/inventory/publishing-offers.html)
