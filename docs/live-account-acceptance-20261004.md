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
