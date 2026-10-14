# Submission shipping clarification — October 14, 2026

The submission-cost editor now explains that its per-card shipping amount
includes shipping to the grader, return shipping and insurance. It describes
an equal split across the order as one allocation option. Changing submission
size still does not reinterpret an amount already entered per card.

SGC comparisons link directly to the official return-shipping schedule and
explain that both card count and total declared order value affect the charge.
No flat shipping charge is inserted. The fee explanation also calls out that
SGC can apply a higher tier based on the final graded value. The CSV export
preserves these assumptions for readers outside the app.

The existing automatic per-outcome grading fee calculation, blank-versus-zero
shipping behavior, snapshot date and standard-size US submission scope are
unchanged. The copy does not promise that all SGC submissions are free of other
charges: special-format items and other exceptions remain subject to SGC terms.

Public references:
- https://www.gosgc.com/card-grading/shipping-fees
- https://www.gosgc.com/card-grading/services-pricing
- https://www.gosgc.com/terms

This change does not add a marketplace, introduce a partner claim or change
affiliate status. No private company correspondence is included in the repo.

Release checks exposed an existing source/build mismatch: the active grading
asset included the eBay buyer-tax note and CSV metadata, while its source did
not. Both disclosures are now preserved in the source. The asset-fingerprint
suite checks grading source/build parity to prevent a rebuild from dropping
them again. Previously shipped fingerprinted assets remain unchanged.

Verification: the full local gate passed all 121 runnable suites (three named
live/opt-in suites skipped). The focused grading browser gate passed 104
checks. Manual mobile review confirmed the source link, blank shipping,
retained buyer-tax disclosure and SGC export metadata. Asset fingerprints and
grading source/build parity passed 167 checks.
