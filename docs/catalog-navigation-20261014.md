# Catalog navigation and safe display text

Prepared October 14, 2026, from release commit
`6d139a7f5a2e9edd874c88fabff723b1ee166315`.

Search results now use the application's shared modal focus handling. Opening
results focuses the close control; Tab stays within the dialog; closing or
selecting a card restores the opener. Escape dismisses an open filter first,
then the results screen. Filters, view switching, sorting and card selection
use native buttons with visible keyboard focus. Filter state and the next view
action have accessible labels, including after restoring a saved view.

Catalog display strings are escaped in card tiles and list rows. Filter options
use textContent and event listeners instead of assembling inline HTML handlers.
Names containing quotes, ampersands or markup remain literal, usable values.
The number filter's reset option correctly says “All card numbers.”

The new immutable UI asset is `js/ui.8331dbae.js`; the previously deployed asset
remains available. Scanner identification, automatic pricing and the optional
Finish control are unchanged.

## Verification

The previous version failed the new dialog-role assertion. The full application
browser test covers both 390px and 1280px layouts with synthetic catalog replies:
focus entry and wrap, layered Escape, exact filter selection, keyboard card
selection, opener restoration, saved view labels, and literal rendering of
hostile text in both views and filter options. These tests do not call paid
providers or write customer records.

Build and whitespace validation pass. Final regression and deployment evidence
is recorded on the pull request. These checks cover the changed workflow, not
physical-device or screen-reader certification.
