# Optional bulk finish correction

Restore automatic pricing for bulk and binder scans. Remove mandatory per-card finish confirmation. A compact Finish / printing button and choice menu matching the condition picker defaults to the scanner/catalogue estimate; foil hints select matching catalogue finishes when available. Seller correction updates the row price and subtotal without another scan. Missing finish-specific prices remain unknown. Preserve the estimated versus seller-chosen distinction internally and carry the selected finish to Collection and drafts. Collection refresh respects its finish key. Generic source prices remain estimates without inventing a finish.

Validation: 54 scan-finish browser checks (phone and desktop), 90 binder-camera browser checks, 104 customer-journey checks and 157 asset checks passed. Synthetic scan/catalogue responses, no live customer credits consumed. Inspected the phone screenshot. Existing upstream enrollment diagnostics preserved without modification.

Follow-up: use the same compact pill styling and bottom-sheet option list as condition. Highlight the automatic guess. Selecting an option commits immediately and closes the menu; cancel preserves the estimate. Keyboard focus returns to the row control.
