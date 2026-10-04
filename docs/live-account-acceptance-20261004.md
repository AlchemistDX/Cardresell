# Live account acceptance — October 4, 2026

Authorized separate test account: willsep200@gmail.com. Original paid owner willsep202@gmail.com remains separate.

Live sign-in completed through Google. The legacy Firebase account omitted its primary email; existing UID-specific email verification alone did not meet the pilot matching rule. Added an authenticated Firebase accounts:lookup read, only after token signature/project/expiry/subject verification and saved verification succeeded, to recover a missing primary/linked Google email. Lookup requires the same UID, rejects disabled/mismatched/multiple records, and cannot replace a conflicting primary email. Pilot rules, owner/customer bindings and stored proof are unchanged.

Source 4418445bef227b2da80e1ef1b76a535c32020afc (local 78c98de; identical tree d86271e8267a95e404fde01d4474c7952a1ddc1e), Production dpl_EAZdcitSYYyiqm7Re95DBuk4PCrH READY with www.cardresell.org alias. Membership gate passed; authentication suite 34 passed.

Live results:
- Google session persists on reload; normal home reload leaves Shop closed.
- Membership admission succeeds and pricing verifies.
- Explicit account setup completed. Current balance: included 5 ID + 1 Grade; verification bucket 0 + 0; preserved standing 0 ID + 1 Grade. Total 5 ID + 2 Grade. Balances survived reload unchanged. This is an existing account, not a fresh signup allocation test.
- 25 ID pack opens actual live Stripe Checkout at $2.99. Stopped without entering payment details or paying, then used Back to CARDRESELL.
- Fixed subsequent presentation bug: customer-associated Free state lacks a subscription status, and the public adapter mislabeled it not_associated. Return associated when lifecycle contains customerId; do not invite setup again.

Remaining acceptance: a real card photo scan and credit accounting, phone camera capture, subscription lifecycle acceptance where not already evidenced, consistent old upsell copy, and a measured seller pilot before paid advertising scale. Opening Checkout is not a completed-charge or webhook acceptance claim.

## Live photo acceptance

Production dpl_6pe93Urt6rEodJ2DmcBpZzc8sB9b, source 3cbc395d4cc812402340bca844e0517e52f08222: supplied IMG_4064(3).jpeg identified correctly as Minun, Paradox Rift #194, Illustration Rare. Shop ledger changed from 5 ID / 2 Grade to 4 ID / 2 Grade. Front plus IMG_4065.jpeg Quick Grade completed with a low-confidence PSA 8 estimate and an explicit holder/sleeve limitation. This verifies workflow, not physical grading accuracy. Shop ledger then showed included 4 ID / 0 Grade and preserved 0 ID / 1 Grade: total 4 ID / 1 Grade, exactly one debit per operation.

The first live attempt exposed missing operation IDs in the legacy browser callers; added an owner-bound, request-digest operation helper, persisting only hashes/random IDs in sessionStorage for reload/network recovery. Server scan-intent tests: 70 passed. The grade test then exposed cloned file inputs retaining inline onchange while also receiving addEventListener: the durable server intent returned 202 for the duplicate and prevented a second debit. Follow-up removes the cloned inline handler before binding one listener, refreshes authoritative balances after completed HTTP responses, and preserves separate paid/included counters so totals are not doubled. Targeted input/reset and request/recovery regressions pass; asset checks 99 and auth integrity 96 pass.

No payment was made. Public advertising remains blocked on the remaining acceptance list and current closed pilot admission. Do not infer general launch readiness from this single-card test.
