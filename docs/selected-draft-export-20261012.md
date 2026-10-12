# Selected eBay draft export — October 12, 2026

The Drafts list now has per-card selection, Select all loaded eBay drafts / Clear selection, and Download selected drafts. Only readable ebay:fixed-price summaries are eligible. Pagination is explicit: selecting all does not silently include unloaded drafts.

The download is one US/USD Create-Drafts CSV with one template preamble/header and one Draft row per selected card. It reuses the existing individual serializer and server-fetched draft/packet, including title, SKU, category, price, quantity, description and hosted seller-photo links. It never emits Add or publishes a listing. Unresolved condition and item specifics remain explicit work for the seller in eBay; no category-specific identifiers are guessed. No seller OAuth is needed for this manual file handoff.

Preparation is sequential and reuses the individual export photo-manifest and upload checks. If any selected draft cannot be read or its attached photos cannot be prepared, no combined file downloads. A retry retains selection. Account changes or a list reload cancel the in-flight combined download. Existing photos/drafts are retained. Downloads disclose missing photos, outstanding details and photo-link retention. A link opens Seller Hub Reports upload; the seller uploads the CSV, checks eBay's results, then reviews and publishes drafts. Re-uploading a file may create duplicates, so the UI asks sellers to check results first.

Source: eBay Uploadable Templates, checked October 12, 2026:
https://pages.ebay.com/sh/reports/help/uploadable-file-feeds/
This documents one product per row and Create new drafts for bulk import to the Drafts folder, followed by seller review and activation. The existing serializer preserves the actual September 10 eBay draft template already in the repository.

Validation: expanded draft-card-actions-browser covers selected/unselected rows, a single file/header, separate Draft actions, hosted-photo associations, failed second-row preparation, retry, account-change cancellation, mobile width and existing edit/delete/individual-download behavior. Asset fingerprint and registry checks plus build inspection pass. Local browser fixtures replace authentication/store and photo-host responses; no actual eBay account import or publishing was performed. Real Seller Hub import acceptance remains unverified.
