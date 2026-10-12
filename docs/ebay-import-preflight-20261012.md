# eBay draft import preflight — October 12, 2026

Rechecked eBay's current Seller Hub Reports documentation:
https://pages.ebay.com/sh/reports/help/uploadable-file-feeds/

Create new drafts supports one product per row, optional hosted photo URLs and
seller review before activation. Action and Category ID are required. CardResell
uses the retained September 10 downloaded template, Draft actions, the 11 template
columns and CRLF records. Optional unresolved condition/item specifics are left
for the seller rather than invented.

Found and fixed: a read-withheld/stale packet could previously produce a blank
Category ID while reporting a successful download. Individual and selected-batch
exports now require a positive numeric category from the server-read packet before
hosting that row's photos. A missing or malformed category names the repair:
open the draft and refresh listing details. No partial combined file is downloaded,
and selection and stored drafts are preserved. This check establishes a syntactic
category, not that eBay still supports that leaf category.

Browser regression coverage includes a missing second-row packet, no partial
file, retained selection, no photo upload for the invalid row, malformed IDs on
individual downloads, and successful subsequent retry with restored valid data.

Actual Seller Hub acceptance remains unverified. The upload page requires sign-in,
and eBay restricts sign-in from the cloud browser. No sign-in retry, account upload
or listing publication was attempted. Local fixtures do not substitute for an eBay
results report. Do not advertise a verified live import based on these checks.
