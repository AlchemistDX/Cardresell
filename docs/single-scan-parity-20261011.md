# Single-card scan parity — October 11, 2026

The interrupted October 9 single-scan fix was reconciled against the October 11 production release, dd378d9, rather than publishing the older bundle. AST comparison confirms only cancelScan, processScanImage and _startSingleScanCapture changed in the new core asset. The new grading photo checks, confidence display, fee calculations, binder workflows, Magic rescue and Business batch limits are preserved.

Single-card ID now checks its capture session and account after quality checking, local matching and compression. Cancelled, replaced or signed-out/account-switched preparation cannot start a paid identification request. A missing photo checker fails closed. Compression errors are visible. The duplicate-photo override belongs to one photo.

Late file-reader callbacks, provider responses, catalog hydration and OCR progress cannot populate a different scan session. Abandoned/error previews are released; candidate-selection previews remain available until confirmation or cancellation. Requests already dispatched retain their existing durable recovery, charging and refund behavior; cancelling does not make a dispatched request free.

## Verification

Seventeen focused suites passed against the merged source: single-scan preflight 66; scan recovery 1 scenario suite; scan hygiene 182; input reset 1 scenario suite; bulk preflight 14; Rapid Scan browser 88; binder browser 46; binder autoselection 53; multi-page binder 24; Magic text rescue 26; grading photo checks 23; grading confidence display 20; fee pill/report browser 25; collection drafts browser 44; batch Grade plan caps 18; asset fingerprints 109; test registry 12. Release inspection and diff checks passed.

The new single-scan suite is an explicit separate release gate in test-registry. The newer release already registered the prior ten unregistered suites and repaired the stale hint assertion; those older local edits were not reapplied.

These checks use synthetic services and local browser fixtures. They do not replace physical-phone acceptance or establish recognition/grade accuracy. No provider purchase, customer charge, credit grant, billing-rule change, admission change or advertising spend was made.
