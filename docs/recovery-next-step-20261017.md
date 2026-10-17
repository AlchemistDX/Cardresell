# Direct next-card recovery

The batch footer previously offered “Find an unidentified card” but only scrolled to a row and focused its first button, commonly the new-photo action. Sellers then had to find and select the separate free catalogue-search button.

The footer now opens catalogue recovery directly for the next eligible missed or rejected card, with the label “Find next card by name · free.” Pending provider choices remain the first priority. Transient failures keep an accurately labelled review action that focuses the row's retry controls. Ineligible replacement/rescan rows are skipped, and account ownership is checked again on click. If a recovery module cannot open, focus remains available on the row rather than disappearing.

Validation: 188 workflow browser checks across 320×740, 390×844, 844×390 and 1280×900, including direct recovery, skipping transient errors, retry-only fallback, pending-match review, existing partial saves/cost allocation, and account isolation. Asset fingerprints: 254 passed. No paid scans or customer/marketplace writes. This changes navigation only, not recognition accuracy or credit accounting.
