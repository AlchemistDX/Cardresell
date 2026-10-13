# Optional bulk finish correction

Restore automatic pricing for bulk and binder scans. Remove mandatory per-card finish confirmation. A compact native Finish / printing dropdown defaults to the scanner/catalogue estimate; foil hints select matching catalogue finishes when available. Seller correction updates the row price and subtotal without another scan. Missing finish-specific prices remain unknown. Preserve the estimated versus seller-chosen distinction internally and carry the selected finish to Collection and drafts. Collection refresh respects its finish key. Generic source prices remain estimates without inventing a finish.

Validation: 48 scan-finish browser checks (phone and desktop), 90 binder-camera browser checks, 104 customer-journey checks and 157 asset checks passed. Synthetic scan/catalogue responses, no live customer credits consumed. Inspected the phone screenshot. Existing upstream enrollment diagnostics preserved without modification.
