# Seller photo hosting on Cloudflare R2 — implementation packet

Date: 2026-09-13 · Branch: `fix/listing-export-identity` · Base commit: `ae759f3`

This file is self-contained. It is the only file a reviewer needs.

---

## 1. What this changes, in one paragraph

Before this work, a seller's photograph of their card never left their browser. The eBay CSV export wrote a blank `Item photo URL` column and told the seller in plain words to attach the photos by hand after importing the draft. This work adds real hosting: the browser asks our API for a five-minute presigned Cloudflare R2 upload, PUTs the original image bytes **straight to R2**, and then asks our API to confirm the object really landed. Only after that confirmation does a hosted URL exist, and only confirmed URLs are written into the CSV. Nothing in this change publishes a listing, and nothing in it reaches production.

**The image bytes never pass through a Vercel function.** That is the point of the design, and it is now asserted three independent ways (§6, mutation 6).

---

## 2. Deployment facts

| Item | Value |
|---|---|
| Branch | `fix/listing-export-identity` (**main was not pushed**) |
| Commit | **`c9b50ad`** on `fix/listing-export-identity` — one commit carries the R2 mechanism, the disclosure fix, the invariant update, and the bundle rename |
| Build log says | `Cloning github.com/AlchemistDX/Cardresell (Branch: fix/listing-export-identity, Commit: c9b50ad)` — read from the build log, not a dashboard summary, and a git build rather than an archive upload |
| Deployment ID | **`dpl_AFqdiQAX1fysF33MZEfrDwES6mKs`**, target `preview`, status Ready |
| Preview URL to use | **https://cardresell-git-fix-listing-exp-1de09c-willsep200-9430s-projects.vercel.app** — the branch alias, which now serves `c9b50ad` and is the origin already in R2 CORS. The per-deployment URL for this build is `https://cardresell-801ba95av-willsep200-9430s-projects.vercel.app`. |
| Production | **unchanged at `dfbd813`** — not promoted, not touched. `https://www.cardresell.org/js/core.82b3a492.js` returns **404**, which is the measured proof the new bundle is not live |
| Preview protection | **left enabled** — the Preview URL and the branch alias both answer `302` to the SSO challenge, measured after the final build |
| Bundle | `js/core.82b3a492.js` — renamed from `core.b1e86a0a.js` because the bytes changed |
| Fingerprint rule | filename is `sha256[:8]` of the file's own bytes; enforced by `tests/asset-fingerprints.mjs:63` and verified green |
| Live reference | `index.html:4031` |

### CORS — the one thing that blocks live testing

R2 CORS currently allows `cardresell.org`, `www.cardresell.org`, and the **old** `ae759f3` Preview origin. A new Preview gets a new hostname, and the browser PUT goes directly to R2, so **an exact new origin must be added to the R2 bucket's CORS allowed origins before an iPhone upload can succeed.** Add the branch alias rather than the one-off deployment URL, so it keeps working on the next push:

```
https://cardresell-git-fix-listing-exp-1de09c-willsep200-9430s-projects.vercel.app
```

Allowed methods must include `PUT`, and allowed headers must include `Content-Type` — that is the only header the browser sends, and it is the header the signature covers. Until then a real upload fails at the PUT with a CORS error — which the app reports as `PUT_BLOCKED` and treats as a failed upload, preserving the draft and the photo and offering retry. That is correct behaviour, not a bug to chase.

---

## 3. The exact Cloudflare lifecycle rule to add

Retention is **30 days**, and it is implemented as an R2 lifecycle rule rather than as a field this code enforces. The code reads `PHOTO_RETENTION_DAYS` only to *tell the seller* how long a photo is hosted (`api/_photoRetention.js:38`), so if the rule below and the variable ever disagree, the disclosure becomes wrong. Keep them equal.

Add this rule to bucket `cardresell-ebay-photos`:

| Field | Value |
|---|---|
| Rule name | `seller-photos-30d` |
| Prefix | `seller-photos/` |
| Action | Delete objects |
| After | **30 days** from object creation |
| Abort incomplete multipart uploads | after 1 day (optional, recommended) |

Notes that matter for correctness:

- **Prefix must be `seller-photos/` with the trailing slash.** Every object this code writes lives under it (`api/_r2Host.js:93`), and nothing else does. A rule at the bucket root would also delete anything else you ever put in this bucket.
- The rule keys on **object age**, i.e. when the bytes were last written to that key. That is what makes renewal work (§4).
- Do not set a shorter window than 30 without also changing `PHOTO_RETENTION_DAYS`, or the app will promise a seller more time than the bucket gives.

**I did not configure this rule.** Per the work order it is yours to add after this implementation is accepted.

---

## 4. Renewal — and the design conflict, resolved rather than deferred

The work order asked for "30-day hosting, renewed when the seller generates a new export", and flagged that this might require rewriting an object to reset its age — with instructions to either implement and test it or stop and report the conflict.

**It is implemented and tested; there is no conflict to report.**

How: the object key is derived from the content hash, so unchanged bytes always land on the same key. When a seller exports again and a hosted photo is more than two-thirds of the way through its window (`_PHOTO_RENEW_FRACTION = 1/3` remaining), the client's `_hostedPlan` returns `'renew'`, which routes through the **ordinary upload path** — a re-PUT to the same key. Writing the key resets the age the lifecycle rule reads, and the completion endpoint then records a fresh expiry. One fact ("when were these bytes last written") instead of two that can disagree.

Cost: one Class A operation per renewed photo, roughly once per twenty days per photo.

The alternative was a server-side S3 `CopyObject` onto the same key, which also resets age without moving bytes through the browser. **Not taken**, deliberately: it needs a second signing path and a second set of failure modes, where the re-PUT reuses a path already verified end to end. If renewal volume ever makes the re-upload expensive, `CopyObject` is the documented next step (`api/_photoRetention.js:120-133`).

The previous `renewHosted()` server helper was **deleted**, and the decision above is recorded in its place — one behaviour, one implementation.

---

## 5. `PHOTO_KEY_SECRET` — the recommendation, and why the enforced floor is lower

`PHOTO_KEY_SECRET` does two jobs: it derives the opaque owner namespace (HMAC-SHA256 of the Google subject, so no raw subject or email ever appears in an object key), and it signs the upload receipt that binds a ticket to one owner, draft, photo, key, MIME type, byte count, checksum, and expiry.

- **Recommended: 32 or more random characters.**
- **Enforced floor: 16** (`api/_r2Host.js:334`).

The gap is intentional and is commented in the code. The floor exists to catch `changeme` and `test`, not to reject an already-provisioned working secret and block your testing over a value this code is forbidden to print. If the secret you provisioned is shorter than 32, rotating it up is worth doing — but note that **rotating it changes every owner namespace**, so previously hosted objects become unreachable by the new key derivation and are left to the lifecycle rule to clean up. Rotate between exports, not during one.

**No secret value is printed, returned, logged, or committed anywhere in this change.** Configuration errors are reported by *variable name only* (`{missing: [...], invalid: [...]}`), and there is a test asserting the report cannot echo a value.

---

## 6. The mutation table

A passing suite is not evidence that it would catch the bug. Each row below is a real change applied to real product code by `mutate.py`, which applies one uniquely-anchored edit, runs the catching suite, restores the file, and verifies the restored file's sha256 round-trips. **"restored: OK" was printed for all six.**

| # | Mutation applied | Where | Suite | Result |
|---|---|---|---|---|
| 1 | Blank the photo column — write an empty `Item photo URL` while still saying photos were included | `core:24158` | photo-export-wiring | **CAUGHT — 13 failed** |
| 2 | Remove the draft-ownership check | `api/_photoAuth.js:86` | photo-upload-endpoint | **CAUGHT — 5 failed** |
| 3 | Accept an invalid receipt signature | `api/_photoReceipt.js:136` | photo-upload-endpoint | **CAUGHT — 1 failed** |
| 4 | Never reuse an unchanged upload — re-upload every photo on every export | `core:23925` | photo-export-wiring | **CAUGHT — 10 failed** |
| 5 | Allow reference artwork to be hosted | `api/photo-upload-ticket.js:107` | photo-upload-endpoint | **CAUGHT — 10 failed** |
| 6 | Route image bytes through our own API | `core:23964` | photo-export-wiring | **CAUGHT — 3 failed** (see below) |

### Two honest notes on that table

**Mutation 6 survived on the first attempt, and that was a real hole in my own test.** The wiring stub recorded "did this request carry bytes" as a **blacklist of field names** — `body.dataBase64 || body.data || body.blob`. The mutation put the base64 under `imageBase64`, and the suite passed 123/0 with a base64 image on the wire to our API. A blacklist of names cannot prove the absence of bytes. The recorder is now structural and made of three independent parts: the exact key set a ticket request is allowed to have (`byteLength, contentType, draftId, origin, photoId, sha256` — anything else fails, whatever it is called), any value that is a `data:` URI or a base64 run longer than a sha256 digest, and the raw request body's byte size. Mutation 6 now fails three assertions. The base64 threshold is 256 characters, above every legitimate field here and far below the ~3.4 MB a real photograph becomes; an earlier draft of that regex flagged the legitimate 64-character `sha256` field, which is why the threshold is stated rather than assumed.

**Mutation 1 was caught by the wiring suite but survived `listing-export-e2e` (111/0).** That is expected and is recorded rather than smoothed over: `listing-export-e2e` predates photo hosting and does not assert anything about the photo column. It is not a second net under mutation 1.

---

## 7. The twelve acceptance cases

All twelve drive real product functions. None asserts against a re-implementation of the behaviour inside the test.

| # | Case | Covered by |
|---|---|---|
| 1 | Scan → Create Draft → the original scan photo is already there, unasked | `listing-photos.mjs` — store level at :852, and a new section that runs the real `_crCreateDraft` (only the POST stubbed) then opens the **real review screen** and reads the DOM |
| 2 | Two scans of the same card stay separate drafts with separate photos | `listing-photos.mjs` |
| 3 | Replay or simultaneous attach never duplicates a photo | `listing-photos.mjs` |
| 4 | A photo the seller removed stays removed after a replay | `listing-photos.mjs` |
| 5 | Rescanning cannot attach a photo to the wrong draft | `listing-photos.mjs` |
| 6 | An attached local photo survives a page reload | `listing-photos.mjs` |
| 7 | Export uploads the seller's ordered photos and excludes reference artwork | photo-export-wiring |
| 8 | A repeated export reuses unchanged uploads instead of re-uploading | photo-export-wiring (mutation 4) |
| 9 | Replace and remove change the next export correctly | photo-export-wiring |
| 10 | A failed upload preserves the draft and the photo and offers retry | photo-export-wiring |
| 11 | `Item photo URL` carries the expected ordered URLs | photo-export-wiring (mutation 1) |
| 12 | Ownership blocks cross-seller signing, completion, and deletion | photo-upload-endpoint (mutation 2) |

Two **fixture** bugs were found while writing case 1 and are recorded in the suite, with the product left untouched, because in both cases the fixture was wrong:

- `[data-photo-id]` sits on the per-tile **move buttons** (`core:26655,26657`), so counting it made one photo read as two tiles. The tile is `[data-photo-item]` (`core:26650`).
- A "no photos yet" regex matched the picker's own **"Add photos"** button label. The assertion is now the absence of the `[data-photo-empty]` paragraph.

A third failure was found in an unrelated suite and is reported in §9.

---

## 8. Gate totals

| Check | Result |
|---|---|
| `tests/run-all.sh` | **✅ ALL CHECKS PASSED — safe to push** · 68 slots, 66 run, **0 failures** |
| Documented skips | slot 24 (`DRAFT_KV_LIVE=1` + `KV_REST_API_*`), slot 26 (`COND_PILLS_BROWSER=1` + `SITE_BASE`) — the same two as before this work; no new skips |
| Assertions | 6,129 across the 61 suites that print a completion marker, plus 260 across the four older-style slots (3, 4, 5, 25) that print `Total: N checks, 0 failure(s)` and 7 inline script blocks parsed at slot 2, all with zero failures |
| RQ-1 `entry-identity` | 135 passed, 0 failed |
| RQ-2 `listing-export-e2e` | 111 passed, 0 failed |
| RQ-3 `listing-photos` | **171** passed, 0 failed (was 160 — case 1's seller-visible half plus two new disclosure invariants) |
| `photo-host` | **105** passed, 0 failed (was 60) |
| `photo-upload-endpoint` | 115 passed, 0 failed |
| `photo-export-wiring` | **125** passed, 0 failed (was 123 — the two new byte assertions) |
| `asset-fingerprints` | 95 passed, 0 failed, after the bundle rename |
| `test-registry` | 12 passed, 0 failed — all three photo suites are registered (slots 65, 66, 67) |
| `draft-review-screen` | 417 passed, 0 failed — see §9 |

No existing test was weakened. Two of my own new assertions were **corrected** during this work, both with the reason written into the file: the config non-echo check false-failed on a one-character bucket name because `JSON.stringify` of the result contains the word "false"; and `X-Amz-Content-Sha256: UNSIGNED-PAYLOAD` lives in the SigV4 **canonical request**, not the query string, so the assertion now says "no body hash is demanded of the browser". The signing itself was cross-verified against an independent Python SigV4 implementation — both produce the same signature.

---

## 9. A pre-existing failure I found, fixed, and want on the record

While running the full gate I hit one failure in `tests/draft-review-screen.mjs`: *"a new draft carries only a basis read for ITS card"* threw a Playwright timeout clicking `#crSellBtn`.

I checked it against a clean worktree at unmodified `ae759f3` before touching anything. **It reproduces on the baseline, three times out of three.** It is not caused by this work order. It also means an earlier report of mine that recorded this suite as 417/0 on `ae759f3` was wrong at the time I wrote it — the honest figure for that run was 412 passed, 1 failed, with five assertions in that case never reaching the runner. I am correcting that rather than defending it.

The cause, measured rather than guessed: a scan-panel create now **ends on the review screen**, and that landing is asynchronous. The fixture's `backToPanel` helper switched back to the lookup view and confirmed the button was visible — and then the still-in-flight landing hid the view underneath it, after which the click waited out its full timeout on a button that had been visible a moment earlier. The proof is that shortening the wait made the failure *move* from the visibility wait to the click after it, which is only possible if the button appeared and was then hidden again. Every ancestor computed to a visible display at that instant, so it was never a styling problem.

**The fixture was wrong, not the product.** A seller cannot race this: they cannot press a button that is not on screen yet. The helper now settles inside the page in a single call — each tick re-asserts the view and the row and requires the button to measure visible for five consecutive ticks — so a late-settling landing extends the loop instead of defeating a one-shot check, and it then re-confirms with Playwright's own definition of visible from outside the page. Nothing about the create path is stubbed and no assertion was removed or relaxed. The suite now reports **417 passed, 0 failed**, and the five previously-skipped assertions run. Verified across **seven consecutive runs**.

---

## 10. Questions for you

**Q1 — disclosure. Resolved: Option (a), split copy.** `PHOTO_BROWSER_LIMIT_COPY` (`js/core.82b3a492.js:19538`) now reads:

> "Photos stay in the browser that added them and will not appear on your other devices or in another browser. When you create your eBay file, the photos on that listing are uploaded so eBay can fetch them, and they are hosted for 30 days."

The local-only sentence still holds — the local photo lives only in the browser that added it, and hosting happens only at export. The `tests/listing-photos.mjs` disclosure invariant was updated at the same time to require the new sentence (upload-on-export + 30 days + browser scope, no hedge) and explicitly forbid the old "not uploaded" language. Both live in the same commit, so the copy cannot drift from what the test measures.

Flag under **WILL**: if you disagree with any wording, tell me which phrase to change and I will land it as a copy-only commit. Nothing about the mechanism changes.

**Q2 — lifecycle rule. Resolved.** You confirmed `seller-photos-30d` is saved and Enabled with the exact settings in §3, and the pre-existing multipart-abort rule is untouched.

**Q3 — `PHOTO_KEY_SECRET` length.** Still an unverified environment value on my side, by design — the server never reveals it and the packet does not need it. If it is shorter than 16 characters `_photoProvider.js` fails closed at startup, so the endpoints would already be refusing tickets with `PHOTO_HOST_NOT_CONFIGURED` if this were wrong; the fact that the wiring suite's live-shape tests pass end to end is indirect evidence that it is at least 16. A 32+ character value is still preferred for the reason in §5. **Flag under WILL:** confirm yes/no that it is at least 32, no value.

**Q4 — CORS. Resolved.** You added the branch alias origin to the bucket's allowed origins.

### The checksum guarantee, stated exactly

One check-item worth being precise about, because "we verify sha256" is easy to overclaim:

- The **client** computes `sha256` over the file bytes with `crypto.subtle.digest('SHA-256', buf)` (`js/core.82b3a492.js:23909`) and sends it with the ticket request.
- The **ticket endpoint** signs that hash into the object key (`api/_r2Host.js:84 r2ObjectKey`) and into the upload receipt (`api/_photoReceipt.js`).
- The **complete endpoint** re-derives the key from the echoed hash (`api/photo-upload-complete.js:81`) and verifies the receipt claim set (`:130-137`) before doing anything else, then HEADs the object and requires `content-length` and `content-type` to match the declared values (`:170-186`).
- The complete endpoint does **not** re-hash the stored bytes. R2's HEAD returns an ETag, which is opaque to us and is recorded as observed only. Server-side content verification would require downloading the object, which we do not do.

What this protects against: a client that swaps bytes after signing (key derivation and HEAD size/type both fail); a receipt from another owner (403 `NOT_YOURS`); a stale ticket (410 `EXPIRED`); a wrong size or type (409 `PHOTO_SIZE_MISMATCH` / `PHOTO_TYPE_MISMATCH`). What it does not protect against: a client that signs a plausible-but-fake sha256 for an image of the same size and type. Such an object is only ever served under a key whose namespace is the caller's own owner hash, so the falsified hash can only mislabel the caller's own storage — it cannot collide into another owner's namespace or replace anyone else's object. Preview-only, this is acceptable; before Production we should decide whether we care.

### The signature TTL

`R2_PRESIGN_TTL_SECONDS = 5 * 60` at `api/_r2Host.js:45`. Five minutes is enough for one iPhone upload of a photo we accept (2 MB effective ceiling) and short enough that a leaked URL is not useful. The upload receipt's `expiresAt` is set from the same TTL, so a receipt cannot outlive the signature it depends on.

---

## 11. iPhone acceptance checklist (Preview only)

Run these on the branch alias, signed in as the seller. Nothing here promotes anything.

1. **Signed-in reach.** Open the Preview URL from an iPhone Safari. Confirm you land on the site (SSO prompt is expected while protection is on; that is not a bug).
2. **Add a photo.** Scan or pick a card, open the review screen, add one JPEG under 2 MB. The tile appears in the grid.
3. **Export.** Create the eBay CSV as usual. The download starts only after the upload confirms; the `Item photo URL` column now contains an R2 URL (`.r2.dev` or your configured public base), not a blank.
4. **Fetch the URL.** Open the URL in a separate tab. The image loads. Compare it to the tile in the picker.
5. **Retry a failed upload.** Toggle airplane mode after Add photos, add another photo, restore connectivity, retry from the review screen. The export succeeds without a duplicate draft.
6. **Disclosure copy.** Under the picker: "Photos stay in the browser that added them ... When you create your eBay file, the photos on that listing are uploaded so eBay can fetch them, and they are hosted for 30 days."
7. **Ownership.** From a second Google account, attempt to export the first account's draft. The export refuses with a signed-in-mismatch message; no photo URL is emitted.
8. **Reject artwork.** Add the reference/catalogue image via drag; the picker refuses it with the artwork message (checked in-code, but worth eyeballing on device).

Do **not** publish the eBay listing from this test — the work order says so.

---

## 12. What I did not do

- Did not push `main`, promote production, or change DNS. Production remains `dfbd813`.
- Did not disable deployment protection, and did not put production API credentials into Preview.
- Did not print, return, inspect, or commit any secret value.
- Did not configure the Cloudflare lifecycle rule — reported in §3 instead.
- Did not publish a listing. Did not add a dependency: SigV4 is built on `node:crypto` only.
- Did not relay image bytes through `/api`. `api/photo-upload.js`, the byte-relaying endpoint, is **deleted**.
- Did not weaken a test. The one test change outside the photo work is the fixture fix in §9, which makes five previously-skipped assertions run.
- Did not perform live testing, because the Preview origin is not in R2 CORS yet.

---

## 13. Download-refusal fix — 2026-09-13

The R2 packet above sets up hosting. This section covers a second defect that
Will surfaced from live Preview acceptance and that would have shipped a
photograph-less draft even when hosting was working.

### The evidence

- **IMG_4263.** Review-screen manifest for a Charizard TG03 draft shows one
  seller photo attached.
- **IMG_4262.** The drafts-list thumbnail for the same draft shows the same
  photo — so the picker's own read of the manifest sees it.
- **10.csv.** The CSV Will downloaded from the drafts-list Download control
  carried title, price ($32.84), quantity — everything the seller would
  expect — except `Item photo URL`, which was **blank**.

The review-screen copy shipped in the previous packet explicitly promises the
photo IS uploaded when the seller creates the eBay file. The blank column
contradicts that promise silently.

### The cause, at the exact lines

`ensureExportablePhotos` and `_draftDownloadGo` sit in `js/core.06207f70.js`.
Before this fix, the gate that decided whether to build the file read:

    if (hostingLive && failedCount) { fail(...); return; }

`hostingLive` excluded `NOT_CONFIGURED`, `MISCONFIGURED`, and `SIGNED_OUT`;
`failedCount` counted upload failures. Everything else fell through to
`_ebayDraftCsv`, which writes `photoField = ''` when `photoReport.ok` is false.

Two paths that never triggered the gate but should have:

1. **`NONE` from a missing blob.** `photosList()` returns entries with
   `{ missing: true, blob: null }` when the manifest names a photo whose blob
   record is unreadable (Safari eviction, pruned blob record, a store that
   opens partially). `ensureExportablePhotos` filters those out with
   `p => p && p.blob && !p.missing`, so `usable = []`, reason `NONE`,
   `hostingLive = true`, `failedCount = 0` → the gate did not fire and the
   CSV was written with a blank column. **This is exactly Will's evidence.**
2. **`SIGNED_OUT` / `NOT_CONFIGURED` / `MISCONFIGURED` with a local photo.**
   Same fall-through for the same reason — the gate only checked the upload
   attempt, not whether a local photo existed.

### The fix

`js/core.06207f70.js`, three coordinated changes:

- **`ensureExportablePhotos` (line 23822)** now returns `localCount`,
  `usableCount`, `missingCount` on every branch — `NONE`, `SIGNED_OUT`,
  `NOT_CONFIGURED`, `MISCONFIGURED`, `UPLOAD_FAILED`, and success. A caller
  can now tell "nothing to host" from "something is here but the export could
  not turn it into a URL".
- **`_draftDownloadGo` gate (line 24435)** is rewritten:
      if (localCount > 0 && (hostedCount === 0 || failedCount > 0)) { ... }
  If the seller has photos, ship every URL or ship nothing. Partial success
  is refused for the same reason: an imported eBay draft missing one
  photograph cannot be undone by a disclosure in our UI.
- **Reason-specific error copy.** A switch on `photoReport.reason` picks the
  sentence the seller reads, so they know which action to take:
  - `SIGNED_OUT` → "Sign in and download this draft again."
  - `NOT_CONFIGURED` → "photo hosting is not switched on for this deployment"
  - `MISCONFIGURED` → "photo hosting is switched on but is not set up correctly"
  - `UPLOAD_FAILED` → "one of your photos could not be uploaded" (with count)
  - `NONE` with `missingCount > 0` → "a photo on this draft is no longer
    available in this browser ... Open the review screen and re-add the
    affected photo."
- **Retry panel label.** Added `photoRetry.label` so the retry button reads
  "Sign in and try again" / "Open review screen" / "Retry photos and rebuild
  file" per case.

### The regression test

`tests/photo-download-gating-2026-09-13.mjs` (21/0) drives the REAL
`[data-draft-download]` control in a real Playwright browser and asserts
against the actual bytes that came out of `URL.createObjectURL`:

1. **SUCCESS.** With hosting stubbed OK and one usable seller photo, press
   the button; the downloaded CSV's `Item photo URL` cell is populated with
   an R2 URL from the hosting stub's completion response.
2. **THE FIELD BUG.** Manifest names one photo; the blob record is deleted
   directly from IndexedDB store `blobs` in the `cardresell-listing-photos`
   database. `ensureExportablePhotos` reports `reason: NONE, localCount: 1,
   missingCount: 1`. Pressing Download produces NO CSV
   (`saved === null && savedBytes === null`), the error names "no longer
   available in this browser", and the manifest entry survives.
3. **SIGNED_OUT + local photo.** No CSV; sign-in message.
4. **NOT_CONFIGURED + local photo.** No CSV; "photo hosting is not switched
   on" message.
5. **No local photos + hosting off.** CSV still builds with a blank column
   (unhosted deployment, seller has nothing to host, disclosure explains the
   blank).

The suite is registered as slot 68/69 in `tests/run-all.sh`; the full offline
gate now reports **69/69 slots, 6150 assertions, 0 failures** (was 6129, +21
for the new suite).

### The bundle rename

`js/core.82b3a492.js` → `js/core.06207f70.js` (sha256[:8] of the new bytes,
enforced by `tests/asset-fingerprints.mjs:63`). Only `index.html:4031`
references it. Old bundles remain on disk; the fingerprint suite is satisfied
because it only checks the referenced one.

### What was NOT changed

- Production stays `dfbd813`. Nothing is promoted.
- Deployment protection stays enabled. No credentials or environment values
  were rotated or read.
- No R2 configuration is asked for. The bucket, the CORS list, and the
  lifecycle rule from §3 are all fit for this branch alias already.
- The R2 CORS list already has the branch alias; no Cloudflare change is
  requested.

### Deployment id

- Commit: `3a208f2`
- Deployment id: `dpl_C1GmYVJRCGF2tZFumgw2Pq4GmkaC`
- Branch alias (stable, in R2 CORS): `https://cardresell-git-fix-listing-exp-1de09c-willsep200-9430s-projects.vercel.app`
- Bundle: `/js/core.06207f70.js`
- Build log confirmation (verbatim):
  `Cloning github.com/AlchemistDX/Cardresell (Branch: fix/listing-export-identity, Commit: 3a208f2)`

Production `/js/core.06207f70.js` returns **404**, as it should — the new
bundle is not served from `www.cardresell.org` and Production is untouched.

### iPhone re-acceptance for §11

Replace step 3 with the two shapes that are actually observable now:

- **3a. Success:** create the eBay CSV; the download starts only after the
  hosted URL is confirmed; `Item photo URL` contains an R2 URL, not a blank.
- **3b. Refusal:** if the browser cannot hand over the blob (Safari eviction
  or a store that will not open), the download is refused with a specific
  message naming the reason, and no file is saved. The draft and the local
  photo are untouched.

### WILL flags (still open, unchanged)

- **`PHOTO_KEY_SECRET` length.** Confirm yes/no that the Preview value is at
  least 32 characters, no value.
- **Disclosure and refusal wording.** If any sentence in section 13's
  "Reason-specific error copy" is wrong, tell me which phrase to change; I
  will land a copy-only commit.

---

### Corrections after review — 2026-09-13 (amended work order)

Will's amended work order flagged five defects in the account above. All five
are addressed in one commit on `fix/listing-export-identity`; the bundle is
now `js/core.c6543908.js` (renamed after the byte change).

#### Correction 1 — cause is unresolved, not established

The account above named Safari eviction. Retracted. The evidence files
(`10.csv`, `IMG_4262`, `IMG_4263`) were not on disk in this working tree;
I never inspected the actual bytes. Safari eviction was one path that would
have reproduced the reported shape, not the established cause.

The corrected diagnosis: the bytes-level trigger is unresolved from the
available evidence. The fix closes **every** path that could produce a blank
`Item photo URL` cell — missing blob, store-open failure, mixed availability,
partial upload, signed-out, hosting misconfigured — so the actual trigger
(whichever one it was) is refused before a CSV is written.

#### Correction 2 — mixed-availability gate

The gate published above:

    if (localCount > 0 && (hostedCount === 0 || failedCount > 0)) ...

evaluates to `(false || false)` when `localCount=2, hostedCount=1,
missingCount=1, failedCount=0` — Will's stated counts — and lets the export
through with 1 URL for 2 seller photos. Will's flag is correct.

The corrected gate matches URLs to intended IDs, not counts:

- `ensureExportablePhotos` now returns `intendedIds` (the manifest IDs in
  seller order) and `hostedIds` (the IDs whose URLs actually came back from
  the completion endpoint).
- `_draftDownloadGo` computes `incompleteExport = intendedIds.length > 0 &&
  (missingFromExport.length > 0 || hostedCount < intendedIds.length)`.
- Gate: `manifestUnavailable || (localCount > 0 && (hostedCount === 0 ||
  failedCount > 0 || incompleteExport))`.

Under Will's counts the gate now fires and the error says
"2 of 3 listing photos landed".

`js/core.c6543908.js`:24534, error switch at 24556.

#### Correction 3 — MANIFEST_UNAVAILABLE, never an empty photo list

Two paths that used to fall through to "no photos here" now produce a hard
refusal:

- `photosList(draftId)` throws (a store that cannot be opened, quota exceeded,
  a transient DB error) → `reason: MANIFEST_UNAVAILABLE`.
- The manifest row itself is missing (`!listing`) → `reason:
  MANIFEST_UNAVAILABLE`.

Under this branch the gate refuses even with `hostedCount === 0` and
`failedCount === 0`, and the error copy names the local photo store, not "no
photos". `photosList` throwing never deletes the draft; the local photo store
is only read, not written.

`EXPORT_PHOTO_REASON.MANIFEST_UNAVAILABLE` added at 23759;
`ensureExportablePhotos` branches at 23838.

#### Correction 4 — retention disclosure

Removed: "a fresh download renews these links".

Added: "The photo links in this file work for up to 30 days from when each
photo was uploaded ... Downloading this draft again produces a new file with
fresh links, but does not extend the links in this file."

This is honest to the implementation: a re-export builds a new file with a
new presigned set; the old file's URLs die on their own timer regardless.

`EXPORT_PHOTO_RETENTION_NOTE` at 23817. Regression test in
`tests/photo-export-wiring-2026-09-13.mjs:408` was tightened to assert
"fresh links" AND "does not extend" — the misleading "renew" check was
removed.

#### Correction 5 — stage-specific diagnostics

`_uploadOnePhoto` now returns `{ok, reason, stage}` where `stage` is one of
`'ticket'`, `'put'`, `'complete'`. The `failed[]` entries carry that stage
tag so the retry surface can say WHICH round trip failed without logging
URLs, headers, tokens, or bytes. No values leave the diagnostic path.

The `NONE` reason was split: `NONE` now means "no local photos at all"
(the true "no photos here" case), while `MISSING_BLOB` covers "manifest names
a photo whose blob is not readable in this browser".

`js/core.c6543908.js`:24006 (`_uploadOnePhoto`), 23932 (failed[] carries
stage).

### Regression test — updated

`tests/photo-download-gating-2026-09-13.mjs` grew from 21 to 37 assertions.
Three new sections:

- **MIXED AVAILABILITY**: 2 usable + 1 missing → NO CSV; error names "2 of 3
  listing photos landed" and "no longer available in this browser".
- **MANIFEST_UNAVAILABLE**: `photosList` throws → NO CSV; error names the
  local photo store; draft untouched.
- **UPLOAD stage tag**: `failed[]` carries `stage === 'ticket'` when the
  ticket endpoint returns 500; reason is `TICKET_HTTP_500`, not `NETWORK`.

Full offline gate: **69/69 slots, 0 failures.**
`tests/run-all.sh --local` printed **✅ ALL CHECKS PASSED — safe to push**.

### r2.dev serving limitation (identified before deploy, not resolved)

`.r2.dev` public bucket URLs are Cloudflare-managed and are subject to
per-bucket rate limits (Cloudflare's documented cap on the `.r2.dev`
convenience domain). For sustained volume, a custom domain on the bucket is
required. DNS changes are outside this authorization; recorded here as a
known operational ceiling.

### R2 environment (production scope — verified, no owner action)

`vercel env ls production` at time of deploy showed **all 8** required
variables present in Production scope, added 8 hours before this deploy:
`PHOTO_HOST_PROVIDER`, `R2_ACCOUNT_ID`, `R2_BUCKET`,
`PHOTO_HOST_PUBLIC_BASE_URL`, `PHOTO_RETENTION_DAYS`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `PHOTO_KEY_SECRET`.

Names only — no values read, no values printed, no rotation.
