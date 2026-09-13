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
| Commit | code: **`968a007`** · current branch head, adding this document: **`c541c6e`** |
| Build log says | `Cloning github.com/AlchemistDX/Cardresell (Branch: fix/listing-export-identity, Commit: c541c6e)` — read from the build log, not a dashboard summary, and a git build rather than an archive upload |
| Deployment ID | **`dpl_5dEJiUiCkLGznGFLZdYRarQESd77`**, target `preview`, status Ready — this is the current build, of `c541c6e`. The code-carrying build of `968a007` was `dpl_6ZDobNuuKys7Ms8gezbbbkkDCQoX`; `c541c6e` adds only this document. |
| Preview URL to use | **https://cardresell-git-fix-listing-exp-1de09c-willsep200-9430s-projects.vercel.app** — the branch alias. Use this one, not a per-deployment URL: the alias always serves the newest build of this branch, so it does not go stale when the branch is pushed again, and it is the origin to put in R2 CORS. The per-deployment URL for the build below is `https://cardresell-i104uotbt-willsep200-9430s-projects.vercel.app`. |
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
