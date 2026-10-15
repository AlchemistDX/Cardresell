# Reviewed, recoverable Collection draft batches

October 15, 2026. Continues the seller-workspace release in PR #93 from `088936d7d96dc58cc4917009c7afb63f56c0d4d8` on `codex/profit-readiness`.

## Seller workflow

Select Collection copies and choose Prepare drafts. A review dialog offers three asking-price choices: use each saved value, apply one explicit USD asking price to the batch, or leave prices blank. Optional buyer shipping charge and estimated postage apply to each draft. Both shipping fields must be stated together; explicit zero is retained. Existing drafts keep their stored settings when recovered.

Missing saved values stay unpriced. Acquisition cost is no longer silently used as the asking price, for either a Collection batch or an individual Collection card. Costs and Collection values are not edited by draft defaults. Collection search also matches storage location and source SKU.

The batch shows each copy's progress and links to confirmed drafts. A seller can pause after the current request. After a reload, Resume saved batch recovers unknown outcomes with their original request and continues unattempted cards. Reload alone never submits a draft. The recovery entry remains available even after the Collection becomes empty.

## Recovery guarantees and boundaries

- A bounded, account-scoped browser journal records the entire reviewed batch before admission or draft writes. Each request is marked sending before transmission. The exact payload, idempotency key, generation, original batch membership, price and shipping assumptions survive reload.
- A failed progress write stops further cards. If a draft was already saved, the earlier sending record remains available for reconciliation. Malformed successful responses and network failures remain uncertain rather than being reported as unsaved.
- Confirmed rows are skipped on resume. Removed or ambiguous physical copies are blocked. Unattempted cards changed since review require a new review; uncertain requests preserve the original reviewed intent. Server lifecycle checks refuse attempts for deleted drafts without silently changing their generation.
- The original batch admission is renewed with unchanged membership after its server TTL. Current plan limits still apply; batches are never silently divided to bypass a lower limit. Capacity and authentication failures retain the current card for retry and stop later requests.
- Web Locks serialize execution for the same account across tabs. A browser without this capability stops before batch writes and keeps individual-card drafting available. Journal comparisons detect unexpected concurrent changes. No browser capability is inferred from a user-agent string.
- Account changes abort subsequent requests and prevent old outcomes or photo attachments appearing under the new account. The shared create client's retry and photo caches are now account-scoped, including individual-card requests. A token refresh that crosses an account change is refused before sending.
- Recovery stores no auth token or image bytes. A saved photo fingerprint allows attachment only if the same local photo is still available; otherwise the draft reports that its photo needs review. Photo availability remains subject to the existing local-photo storage limits.

Recovery is local to this browser and account, capped at 500 copies and 2 MB per journal, and may be lost if browser storage is cleared. Saved drafts remain server-side. The latest batch stays available until a new reviewed batch replaces its completed record. This does not recover an unfinished scan session or provide cross-device job synchronization.

These remain listing drafts and exports. This release does not enable eBay authorization, marketplace publication, order imports or cross-marketplace synchronization. Those dependencies and remaining lifecycle work remain documented in `seller-workspace-20261015.md`.

## Verification

Focused real-browser coverage includes shared price/shipping defaults, blank prices, interruption during a request, explicit resume, failed journal writes before and after a save, current-plan refusals, removed cards, deleted drafts, account switches, concurrent tabs and unreadable recovery records. The phone review was visually inspected at 390 pixels, and layout checks also cover 1280 pixels.

The real draft-handler test deliberately commits a draft and drops its response. After a browser reload, the same body and key recover the saved draft and complete the second copy. It checks one stored draft per physical card and the approved asking price and shipping amounts in server-returned records. The test uses isolated identity, storage and provider fixtures; it is not a production account or real marketplace acceptance test.

The full local gate passed: 129 registered suites, 126 executed and the same three explicit local-mode exclusions (real-store draft pass, production endpoint smoke, optional condition-applicability interaction). Focused results were 71 recovery assertions, 100 Collection browser assertions and 126 real draft-handler/bulk assertions. The final asset checks were rerun after the dialog-centering adjustment: 190 passed. The runner's later browser/recovery suites also included that final adjustment. Production verification is recorded in the release pull request.

## Maintained assets

`node tools/build-draft-batch.mjs` fingerprints the batch and Collection-selection modules and updates their live references. The asset gate requires each referenced module to match its source. Previously released asset files are retained for cached clients.
