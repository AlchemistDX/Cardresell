# Release-validation queue

Checks that cannot run offline in this sandbox and must run before release.
Created 2026-09-08. This file exists because "carry it into release validation"
was previously said in prose and then lived nowhere — a queue nobody can read is
not a queue.

Each entry states what to run, what must be true, and **why the offline
assertions are not sufficient**. That last column is the point: several entries
have passing source-level assertions, and a source assertion establishes where a
field was written, never that it arrives.

---

## ADJUDICATED 2026-09-09 — verdicts

Every entry below now carries a verdict: **passed**, **blocking**, or
**deferred with its limitation**. The offline and read-only items were finished
without waiting on credentials; three items that had been parked behind "needs
Playwright and a local server" were run on 2026-09-09.

| Item | Verdict |
| --- | --- |
| RV-1 grade response contract | **BLOCKING** — needs the deployed function |
| RV-2 T2.14 disclosure accessibility | **DEFERRED** — needs a real screen reader; dagger name still unverified |
| RV-3 eBay live suite | **BLOCKING** — Production-only credentials (G2) |
| RV-4 draft KV live | **BLOCKING** — no live KV binding (G1) |
| RV-5 flip completeness | **PASSED** — re-run 2026-09-09, 22 / 0 |
| RV-6 rendered ranking | **PASSED, narrowed** — re-run 2026-09-09, identical in 4 / 4 cases, two default-tier rows only |
| RV-7 D7 listing photos | **PASSED** — re-run 2026-09-09, 92 / 0; Safari/iOS limitation retained |
| RV-8 preview reads production KV | **BLOCKING** — decide before the first push (G1) |
| RV-9 the other eighteen live checks | **BLOCKING** — same gate as RV-3 |
| RV-10 containment mechanism | **BLOCKING** — control and scope not established |
| CH-1 published verification token | **BLOCKING** — G3 |
| CH-2 code fallback to that token | **BLOCKING** — code change, deliberately not made unasked |
| CH-3 unencrypted TPL key | **BLOCKING** — G11 rotation, G12 activation |
| Same-card basis retention | **DEFERRED** — product decision; consequence is disclosed, not silent |
| D5 §8.3 signed-in continuation | **PASSED for one tested case**; stays in the queue. Q-D5-5 desktop never exercised |

**4 passed · 9 blocking · 3 deferred.** Every blocking item is credential-,
configuration-, or deployment-gated. None is blocked on writing more code.

### 2026-09-09 run records

- **RV-5** — `CR_E2E_URL=http://127.0.0.1:<port>/index.html node tests/flip-completeness-e2e.mjs`
  against the current bundle `js/core.73a71fac.js`: **22 passed, 0 failed.**
- **RV-7** — `node tests/listing-photos.mjs` against `js/core.73a71fac.js`:
  **92 passed, 0 failed.** Limitation unchanged: headless Chromium only, and no
  storage-ceiling experiment.
- **RV-6** — compared `HEAD~1` against `HEAD`, which is the right pair: the RC-1
  blank-shipping note is inserted immediately above the ranking. Rendered
  `.payout-rank-row` name/amount pairs **identical in all four cases**
  ($3.00 · $1.00 · $45.00 · $400.00). **Narrowing, stated rather than hidden:**
  the harness rendered the **two** default-tier rows, not the six-row Pro
  ranking of the 2026-09-08 run — the tier gate reads a module-scoped value that
  could not be lifted from page scope. Non-vacuous, but narrower. A first attempt
  returned **zero** rows and was discarded as vacuous rather than reported as a
  pass.

---

## RV-1 — grade response contract (added 2026-09-08, from the BIAS-5 change)

**Why offline assertions are not enough.** `tests/quick-pricing.mjs` asserts that
`api/scan.js` contains `analysis_id: scanId` and that `scan_id` does not appear
in the grade-mode response literal. Those are text assertions over source. They
establish that the field was **added**; they cannot establish that the response
**path** returns it — an early return, a later overwrite, a serializer, or a
wrapper could all drop it, and the whole point of the BIAS-5 fix is that
`_crGradingScope` silently falls back to the WeakMap when the field is missing.
A silent fallback plus a source-only assertion is exactly the shape that let the
`scan:` branch sit unreachable in production while looking correct in review.

**Run:** exercise a successful grade scan against the deployed function with a
mocked or fixture card.

**Must be true:**

1. The 200 response body contains `analysis_id`, a non-empty string.
2. The 200 response body does **not** contain `scan_id`. `scan_id` keys the
   refund path, which is claimable only for scans logged to KV
   (`api/scan.js:1220`); grade scans are not logged, so exposing that name would
   make them look claimable.
3. Two grade scans in one session return **different** `analysis_id` values.
4. Client-side, `_crGradingScope` resolves to `scan:<analysis_id>` and not to an
   anonymous WeakMap token. If it resolves to a token, item 1 failed silently.

**Blocked by:** `tests/test-scan.mjs` has no offline harness (existing open
item). This entry is the concrete reason to build one.

---

## RV-2 — accessibility of the T2.14 disclosure row (added 2026-09-08)

**Why offline assertions are not enough.** The note is visible text in document
order and `a11y-mobile-2026-09-04` passes 174/0, but element presence alone does
not establish a usable announcement, and `page.accessibility` has been removed
from the installed Playwright build, so no automated proxy is available here.

**Run:** a real screen reader over the Quick Pricing ladder in the state where a
supplied low exceeds the comparison reference.

**Must be true:**

1. `Provider low (not used)` is announced as the row's name.
2. The em-dash value is not announced as a price, or as nothing at all in a way
   that leaves the row nameless.
3. The explanation note is announced in the same row context, not orphaned after
   the table.
4. The dagger's accessible name is announced (this has been carried as
   unverified since the prior checkpoint and is still unverified).

---

## RV-3 — eBay live suite (pre-existing, restated here)

**Run:** `EBAY_LIVE=1 node tests/ebay-live.mjs`.
**Must be true:** 19/19 — **unchanged and not substituted.** The "currently
18/19" figure previously recorded here has **no run behind it**
(`audit/CARDRESELL_PLAN_AND_ROADMAP.md:657`: "reportedly at 18/19; this was not
re-run") and is withdrawn as a bar. The harness prints
`X passed, Y failed, Z warnings` and never a fraction, and at least four of its
nineteen happy-path checks exist only in one branch — so a clean run with a
moved category-tree version prints 18 passed / 0 failed, indistinguishable from
one real failure by that fraction. Judge individual checks, never the total. See
`audit/ROTATION_PLAN_BOUNDED.md` §1.
**Blocked by:** the Cert ID rotation gate. This is a release gate, not a
checkpoint gate.

---

## RV-4 — draft KV live (pre-existing, restated here)

**Run:** `node tests/draft-kv-live.mjs`.
**Must be true:** passes against live KV.
**Blocked by:** no live KV binding in this sandbox. It is the only registered
suite in `tests/run-all.sh` that cannot be run here.

---

## RV-5 — flip completeness through the real record path (added 2026-09-08)

**Run:** serve the repo on a local port, then
`CR_E2E_URL=http://127.0.0.1:<port>/index.html node tests/flip-completeness-e2e.mjs`.
**Must be true:** 22/22. **Last run 2026-09-08: 22 passed, 0 failed.**

**Why it exists.** `tests/payout-honesty.mjs` lifts the completeness helpers out
of the bundle and asserts their return values. That is a unit test and cannot
speak for the surfaces the original `hasCosts` defect actually reached
— persisted records, the portfolio total, "Best Flip", and the CSV export.
RV-5 follows one record through all of them: explicit zeros survive a reload as
complete, a blank cost stays provisional after reload and inside the aggregate,
a pre-tracking record stays untracked with no missing-field list invented for
it, and all three remain distinguishable in the exported file.

**Why it is not a runner slot.** It needs Playwright and a local HTTP server.
The offline runner provides neither and the repo has no `package.json` to depend
on Playwright from. It is a declared exclusion in `tests/test-registry.mjs`.

---

## RV-6 — rendered-ranking comparison across the chart change (added 2026-09-08)

**Run:** extract the pre-change build (`git archive fa4739b^`), serve both, and
compare the painted `.payout-rank-row` name/amount pairs in DOM order.
**Must be true:** identical amounts and identical order in every case.

**Why it exists.** `_payoutBarGeom` returns geometry only and has no amount
field, but that fact is a property of the helper, not proof that the caller
preserved amounts and ordering. The claim is carried by rendered output instead.

**Last run 2026-09-08 — 4 cases, all identical:**

| case | override | rendered ranking (identical before and after) |
|---|---|---|
| mixed signs | $3.00 | Poshmark $0.05 · CardNexus −$9.24 · Mercari −$9.30 · Whatnot −$9.63 · eBay −$9.70 · TCGPlayer −$9.70 |
| all negative | $1.00 | Poshmark −$1.95 · CardNexus −$11.08 · Mercari −$11.10 · Whatnot −$11.41 · eBay −$11.43 · TCGPlayer −$11.43 |
| ordinary profitable | $45.00 | Poshmark $36.00 · CardNexus $29.40 · Mercari $28.50 · Whatnot $27.80 · TCGPlayer $26.74 · eBay $26.64 |
| high value | $400.00 | CardNexus $356.00 · Mercari $348.00 · Whatnot $344.10 · TCGPlayer $334.70 · eBay $334.60 · Poshmark $320.00 |

The two cases the chart change targets — mixed signs and all-negative — are the
first two rows.

---

## RV-7 — D7 listing photos, store and screen (added 2026-09-08)

`tests/listing-photos.mjs`, **92 checks, 92 passing, run twice** on
2026-09-08 against `js/core.3f83abec.js`. It is a **declared exclusion** in
`tests/test-registry.mjs`, not an offline slot, on the same grounds as
`flip-completeness-e2e.mjs`: it needs Playwright and a local HTTP server the
offline runner does not stand up.

Run by hand: `node tests/listing-photos.mjs`.

What only this suite covers:

| area | what it establishes |
|---|---|
| store transaction | a fault fired after every blob `put` reports success but before commit ⇒ caller sees a rejection, no orphan blob survives, manifest byte-identical |
| picker | files arrive via `setInputFiles` on the real hidden input, not a synthesised `File` in page JS |
| reorder | the chosen order survives a **full page reload**, not just a repaint |
| missing photo | renders as its own tile with its own sentence while its neighbours still show thumbnails, and the empty line stays hidden |
| cap | 12 is attributed to CardResell and explicitly not to eBay |
| failure | the previously displayed collection is intact, the failure is shown, and no success line appears beside it |
| no upload | add, reorder and remove issue no request with a body, scoped after boot |

**What it does not establish.** It runs in headless Chromium only, so it says
nothing about Safari or iOS, where the storage behaviour that motivated the
browser-scoped copy is most likely to differ. It does not establish a storage
ceiling — no quota-exhaustion experiment was run, by decision. Glare is not
asserted because glare is advisory, not a gate.

---

## Open behaviour question — same-card basis retention (opened 2026-09-08)

Tracked here rather than left inside the D7 basis-loss packet, because it is a
product decision with a release consequence and it is nobody's side note.

**What is established.** `loadCardUI` (`js/core.3f83abec.js:3556`) clears
`_crBasis` on every card load. The clear **treats both cases alike**: a load of
a DIFFERENT card, where dropping the previous card's basis is the leak
prevention the binding work was built for, and a reload of the SAME card, where
the basis just bound for that card is dropped too. Demonstrated deterministically
by `a same-card reload drops that card's own bound basis` in
`tests/draft-review-screen.mjs`, driven through the real
`_restoreLastLoadedCard()` path.

**What is not established.** Whether a same-card reload SHOULD retain the
basis. Retention is not obviously safe: reinstating a basis whose card is no
longer certain recreates the foreign-provenance leak. Production reachability
is also undemonstrated — the only observed occurrence was a test binding a
basis while a startup card load was still pending. No minimum duration is
claimed in either direction.

**Why it is not urgent.** The consequence is disclosed, not silent: the review
screen states `data-packet-basis="absent"` with "No price source was recorded
with these listing details.", and flags a comp-derived price as owing a source
(`tests/draft-review-screen.mjs:2519`, `:2521`).

**What would close it.** A decision on the intended same-card behaviour, and if
retention is chosen, a rule that distinguishes the two loads by card identity
rather than by timing. Production clearing stays unchanged until then.

---

## Not in this queue

Everything else registered in `tests/run-all.sh` runs offline and was run at the
2026-09-08 checkpoint — 41 of 42 suites, all green. Anything reported as "not
rerun" must name which of these six entries it falls under, or it was simply
not run.

## Signed-in eBay continuation (D5 §8.3) — open, owner-run

The four checks in `audit/d5/D5_SIGNED_IN_VERIFICATION.md` §6 need a real
signed-in eBay seller account. No instrument exists in the build environment:
the cloud browser has no logins and this project does not collect marketplace
passwords. A logged-out baseline was re-taken 2026-09-08 and passes all four
questions, including the query surviving in the address bar; it is a comparison
point, not the answer.

Pre-committed consequences for each outcome are in §7 of that document, written
before the observation. Two of the five rows are blockers.

**Recurring pre-deploy check (Q-D5-3, ACCEPTED 2026-09-08).** The `title`/`caty`
parameters we depend on are undocumented eBay internals with no compatibility
promise, so a silent change on their side would otherwise surface as seller
confusion rather than as a failed check. Manual by necessity — it cannot be
automated without a signed-in session the build environment does not have.

Each run records:

| Field | Why |
| --- | --- |
| Date | A pass ages; eBay can change between deploys. |
| Account + browser context | The result belongs to a case, not to the product. |
| Landing screen — is our search and category displayed? | **The criterion.** |
| Offered match — can the seller compare a collector number? | **The criterion.** |
| Surface: mobile web **and** desktop | Both in scope (Q-D5-5). **Mobile is the priority** — it is the scan workflow, where a seller who just photographed a card is standing. **Desktop is retained** for saved-collection sellers working a list later. |
| Did it route into the eBay app? | **Recorded, not scored.** Opening the app is not a failure by itself; the destination and whether usable card details are in front of the seller decide the result, exactly as in a browser. An app run is a rendering surface we have never observed, so note it when it happens. |
| Final URL, verbatim | Evidence only. A missing query does not prove the inputs were discarded (eBay may consume them and redirect to a clean URL), and a surviving query does not prove they were used. |

**A pass establishes that tested case, not a continuing compatibility
guarantee.** The item stays in this queue after a successful run rather than
being struck off.

Pre-committed fallback if the inputs do not reach the workflow: keep a usable
generic eBay continuation with manual-copy instructions, keep the identity
instruction phrased to hold wherever eBay presents a selection, remove only
screen-assuming wording, and do not hunt for further undocumented parameters to
preserve prefill (D5 verification §7.2).

### Run log

| Date | Account / browser | Search + category displayed? | Match comparable? | Final URL | Result |
| --- | --- | --- | --- | --- | --- |
| 2026-09-08 | Owner, **iOS Safari mobile web** (not the eBay app); **signed in — owner-attested**, *"yes I was signed into safari"* | Yes, verbatim search and `caty=183454` category | Yes — `Charizard VMAX (Secret) 074/073 Champions Path Holo` | Not readable (Safari shows `ebay.com` only); evidence only, not a criterion | **Pass for that tested case.** Screenshot: `audit/d5/evidence/2026-09-08-signed-in-ios-safari.jpeg` |

---

## RV-8 — Preview and Development read production KV

**Established 2026-09-08** (`audit/ROTATION_GATE_ANSWERED.md` §2.2): every
KV/Redis variable on the `cardresell` project is a single row targeting
`production,preview,development`. One row carries one value, so preview and
development deployments read and write the **production** store. No key on the
project has more than one row, so there is no per-environment store.

**Exposure.** A preview deployment of a branch with an unfinished migration, a
bad key prefix, or a destructive fixture writes into the store serving
`www.cardresell.org`. The outgoing draft-persistence work writes by design, so
this is not hypothetical.

**Mitigation, weaker than first recorded.** `ssoProtection.deploymentType =
all_except_custom_domains` means previews are not publicly *reachable*. That is
access control, **not data isolation** — it constrains who can request a URL and
says nothing about what deployed code writes once running. A preview build with
a bad key prefix or an unfinished migration writes to the production store
whether or not a human opens it, and scheduled or webhook-triggered paths need
no browser at all. **The earlier "self-inflicted damage only" framing was too
strong and is struck.**

**Also struck:** the claim that separating environments would invalidate the
completed functional tests. It would not. Those tests assert behaviour against a
KV interface, not against a particular store; a new store requires **checking
the new configuration**, not re-earning the results. That was an invented cost
for the fix.

**DECISION REQUIRED BEFORE THE FIRST PUSH** — not after. A push automatically
creates a Preview, and the Preview is the exposure, so this cannot be resolved
afterwards. Chosen order (`audit/ROTATION_PLAN_BOUNDED.md` §3): **(1)** disable
automatic Preview deployment — one reversible project setting that removes the
trigger outright; **(2)** provision a separate non-production store, which is
the durable answer; **(3)** re-enable Previews. Step 1's cost is real: it removes
the only pre-production verification surface for as long as it lasts. Each step
needs its own concrete authorized action.

**Not a rotation item** — the rotation neither causes nor fixes it, and
redeploying the live commit does not create a Preview, so the rotation sitting
may precede this decision provided nothing is pushed.

---

## CH-1 — production eBay verification token is the repo's committed default

**Measured 2026-09-08** by an unauthenticated `GET` to our own public endpoint
(`audit/ROTATION_PLAN_BOUNDED.md` §0): production's challenge response matches
the repository's committed default token **plus one trailing newline**. Because
the deployed code is `process.env.EBAY_VERIFICATION_TOKEN || '<repo literal>'`
and the literal carries no newline, the environment variable **is set**, and its
stored value is the published default with stray whitespace.

Two defects in one variable: a **value published in the repository** is serving
production, and a **stray character** breaks eBay's endpoint validation against
a clean portal value. Replace with a generated value in eBay's portal and in
Vercel, and stop the code literal being a usable fallback. No value, fragment,
or hash recorded.

---

## RV-9 — the other eighteen live-harness checks are unverified

`tests/ebay-live.mjs` has never been run in this workspace: it requires
`EBAY_APP_ID` and `EBAY_CERT_ID`, which are Production-only in Vercel and absent
here. Only check 19 (`deployed challenge hash matches the CLEAN token`) has been
established, and only because that one needs no credential. The rotation run
establishes the baseline for the remaining eighteen as much as it confirms the
new credential.

---

## CH-2 — the production code fallback to a published token

`api/ebay-notifications.js:17` still reads
`cleanCredential(process.env.EBAY_VERIFICATION_TOKEN) || '<repo literal>'`. The
literal is a value committed to the repository, and CH-1 established production
was serving it. **The environment change in the rotation window does not remove
this**, so an unset or cleared production variable silently falls back to a
published value.

Code change, tracked separately from the rotation. After the harness edit of
2026-09-09 the literal appears in exactly one place in the tree — this line.

---

## CH-3 — `CARDSELL_TPL_KEY` is stored unencrypted

Observed 2026-09-09: three project variables are `type: plain` rather than
`encrypted` — `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY`, and
`CARDSELL_TPL_KEY` (targets `production,preview,development`). Plain rows have
their values returned in cleartext by the project detail endpoint, and one such
value was displayed in agent working output while reading Git deployment
settings. It was not written to any file, but treat it as exposed.

If `CARDSELL_TPL_KEY` is a live API key: re-create it as an **encrypted**
variable (Vercel cannot convert in place — delete and re-add) and **rotate** it.
The two `BLOB_*` rows are store identifiers, not secrets, and can stay.

Not part of the rotation window, which is already changing two credentials.

**Assessed read-only 2026-09-09 — `audit/CH3_TPL_KEY_ASSESSMENT.md`.** The key
is the paid TCGPriceLookup key (`api/tpl-proxy.js:18,:44`). The route is
**anonymous and unmetered**: no caller verification, no usage limit, and every
query param forwarded verbatim (`:32-37`), so the `s-maxage=300` edge cache
(`:50`) is bypassable with any junk param. Calibrated: the deployed client sends
only `path`, `q`, `game`, `limit` with no cache-buster, so this is abuse
potential, not active bleeding. Whether it has been abused is **Unverified** —
provider dashboard and Vercel invocation records, owner-side.

**CORS is not the boundary** — origin and `Referer` are client-asserted and do
not constrain direct requests. Withdrawn as a proposed control.

**Class of two, not one:** `api/pricecharting.js` also holds a paid key while
anonymous, but reads named params and caches 6h in KV (`:18,:35,:446-462`), so
its exposure is first-time lookups only. It is the model for the remedy, and
`api/scan.js:1,:785-797` (verify + atomic credit debit) is the stronger house
pattern. Also a **terms** question given the open PriceCharting negotiation, not
just a cost one.

**Remedy R1 rotate at provider (owner) · R2 named param allow-list, provably
behaviour-preserving · R3 stop caching failures · R4 KV cache + cap, blocked on
KV isolation.** Q-CH3-1..4 await owner answers; R2–R3 await authorization.

---

## RV-10 — containment mechanism unverified

`audit/ROTATION_EXECUTION_CHECKLIST.md` §4. The "disable automatic Preview
deployment" toggle named in the earlier plan was **not established to exist with
that scope**. What the project exposes is
`gitProviderOptions.createDeployments: "enabled"`, which appears to govern
Git-triggered deployments **as a whole, production included** — broader than a
preview-only switch. `link.deploymentEnabled` is unset, and reading that as
"default enabled" is an inference, not an observation.

Verify the exact control and scope in the dashboard before relying on it. If it
suppresses production deployments too, that must be understood before the
maintenance window, which needs to deploy.

### What RV-10 gates — corrected 2026-09-09

This has drifted twice, in the same direction each time, so it is stated as a
table rather than a sentence:

| Gated by RV-10 | **Not** gated by RV-10 |
| --- | --- |
| The **first push** to `main` — a push creates a Preview, and the Preview is the exposure | Rotating the eBay Cert ID or verification token **at the provider** |
| Containment **steps 11a–13** of the maintenance window | Rotating or revoking the TPL key at TCGPriceLookup |
| | **The exact-commit maintenance rebuild** — a deployment, separately authorized by the owner |
| | Reading a dashboard, choosing budget numbers, provisioning an isolated store |

**Struck, 2026-09-09 (second pass).** An earlier version of this table listed
"the rebuild **deployment**" in the gated column and justified it with the claim
that "the credential window contains no deployment." **Both are wrong.** The
credential window **does** contain a deployment — the exact-commit rebuild. The
rebuild sits outside RV-10 because the **owner authorizes it directly**, not
because it is somehow not a deployment. The tidier phrasing was doing work the
facts do not support.

**The surviving distinction:** containment gates **the push and steps 11a–13**,
and does **not** gate the separately authorized maintenance rebuild or the
provider-side credential work.

**Rotation comes first; containment comes second.** Both earlier drifts inverted
this, because containment reads like a precaution and precautions feel like they
belong at the front. Treating containment as a prerequisite for rotation would
hold an exposed credential open while waiting on a dashboard control nobody has
yet located — the exact failure containment exists to prevent.

**Containment does not revoke production-KV access from existing deployments or
from local development** — `KV_*`, `KV_URL` and `REDIS_URL` target
`development` from the same single rows. Keep both out of write-capable testing
until a separate store exists, and **do not run the deferred preview-surface
checks against production instead.**

## RV-11 — Unknown prices default to Pro; possible annual-count error

**Supersedes an earlier, wrong filing of RV-11**, kept in History at the foot of
this file. **My original claim was wrong.** I wrote that an annual subscriber "pays $89.99 and the
tier lookup returns nothing", and the reviewer, reasonably relying on that,
called it the most serious defect of the session and the only one where a seller
loses money to CardResell. **Neither is true.** I stopped tracing at
`api/_tier.js:58` \u2014 the line that returns `null` \u2014 and reported the null as the
outcome. It is not the outcome. Every consumer catches it.

**Four independent fallbacks, all landing on the correct tier.**

| Consumer | Line | What happens to the unmapped annual price |
| --- | --- | --- |
| `api/_tier.js` | `:113` | `priceIdToTier(priceId) \|\| 'pro'` |
| `api/pro-status.js` | `:114` | `metaTier \|\| priceMap[priceId] \|\| 'pro'` |
| `api/stripe-webhook.js` | `:111` | `\|\| undefined`, then \u2026 |
| `api/stripe-webhook.js` `storeProUser` | `:194` | `tier \|\| existing.tier \|\| 'pro'` |

An annual **Pro** subscriber therefore resolves to **`'pro'`**, which is the
**right** tier for the $89.99/yr plan. **No entitlement is lost, no customer is
owed a comp, and nobody needs contacting.** The read paths do have a fallback;
I asserted they did not without reading them.

**The rule the reviewer drew still holds \u2014 it just did not fire here.** "A
fallback on the write path without a matching fallback on the read path
manufactures unrecognized state" is a sound check. Applied honestly, the read
paths **each** carry a fallback, so the pair is not mismatched. The general check
is worth keeping; this instance is not an example of it.

### What is actually defective, at reduced severity

**1. The lenient fallback fails open, which is the inverse of what I claimed.**
`api/_tier.js:113` carries its own comment: *"any active sub with unknown price
\u2192 assume Pro"*. So an active subscription at **any** unrecognized price \u2014 a
retired plan, a discounted one, a mistake \u2014 is **granted Pro**. The system errs
toward granting entitlement, which is precisely **why** no one loses money, and
is a real risk pointing the other way. **Severity: worth a decision, not a
blocker.**

**2. `"undefined"` as a computed key \u2014 real, and masked.** `api/pro-status.js:108`
does create a literal `"undefined"` key mapped to `'pro'`, so a subscription with
a **missing** price ID collides with it and resolves to Pro. Its effect is
currently invisible because `:114`'s `|| 'pro'` would return `'pro'` anyway. The
reviewer's instinct to trace it before a fix ships was right; the trace shows it
**writes nothing on its own** \u2014 it is a lookup map, rebuilt per request, never
persisted. **No record cleanup is implied by this key.**

**3. The one durable-record concern that survives \u2014 and it is about reporting.**
`storeProUser:193` persists `plan: plan || existing.plan || 'pro_monthly'`, and
the `subscription.created` branch at `:116` passes `plan` as **`undefined`**. So
an annual subscription can be written to KV as **`'pro_monthly'`**. That matters
because `api/admin.js:135` counts annual subscribers as
`if (data.plan === 'pro_annual') proAnnual++` \u2014 so **the admin annual count can
undercount**, showing fewer annual subscribers than exist.

**Unverified, and order-dependent:** `api/stripe-annual-checkout.js` does set
`pro_annual` in metadata, and `api/stripe-webhook.js:78` reads
`obj.metadata?.plan || 'pro_monthly'`. Whether the final persisted value is
correct depends on **webhook delivery order** between `checkout.session.completed`
and `customer.subscription.created`, which **cannot be established from the code
alone**. So: the undercount is **possible, not demonstrated**.

**Corrected severity: RV-11 is a fail-open entitlement default plus a possible
admin-reporting undercount. It is not a revenue-loss defect and not the most
serious finding of the session.** It should not be sequenced ahead of the
rotation on the strength of my original claim.

**What Stripe would still settle** \u2014 read-only, and now for a different reason
than comping anyone: whether any annual subscriber exists, and whether their KV
`plan` reads `pro_annual` or `pro_monthly`. That converts item 3 from possible to
measured. Worth doing before any fix, since the fix differs if records are
already wrong.

### Sequencing, per the reviewer

**Map the supported annual price *before* touching the fallback.** The order is
load-bearing, not stylistic. `|| 'pro'` at `api/_tier.js:113` is currently the
**only** thing granting Pro to the annual price, because the map has no entry for
it. Remove or tighten the fallback first and every annual subscriber loses access
the moment it ships. So: **add the mapping, verify annual resolves through the
map rather than the fallback, and only then decide whether the fallback should
keep failing open.** A cleanup done in the other order revokes legitimate access.

### The annual-count question needs both sources, not Stripe alone

Corrected: I implied Stripe would settle it. It cannot. Stripe establishes
**which subscriptions exist and at what price/interval**; KV holds the
**`plan` label** that `api/admin.js:135` counts. The defect is a **disagreement
between the two**, so it is only visible by comparing them. Stripe alone shows
subscriptions; KV alone shows labels with nothing to check them against.

**And the delivery-order question is testable locally, without either.** The two
orders are `checkout.session.completed` → `customer.subscription.created` and the
reverse. Both can be driven against `api/stripe-webhook.js` with synthetic events
and a mocked KV, recording the final persisted `plan`. That establishes **whether
a wrong label is possible at all**, and which order produces it, with no account
access and no authorization. **Do this first** — if neither order yields
`pro_monthly` for an annual sub, the Stripe/KV comparison is unnecessary.

**The fix recommendation stands but is no longer urgent:** map the constant in
code so one behaviour has one implementation. It now also wants a decision on
whether `|| 'pro'` should keep failing open.

## History — RV-11 as originally filed (RETRACTED 2026-09-09, superseded)

**Not a blocker. Not current. Retained only so the correction has something to
point at.** Every factual claim in this block was disproved by the trace in the
current RV-11 entry above: the read paths each carry a fallback, so annual
subscribers resolve to `'pro'` and no customer is owed anything. Read the
current entry for the live findings.

<details>
<summary>Original text, preserved unedited</summary>

### (retracted) Annual subscribers are charged and resolve to no tier

Found by the sweep the reviewer asked for. **This is a live production path**, not
branch work: `git diff 9aaf326 HEAD` is **empty** for all three files below, so
the code described here is what `www.cardresell.org` runs today.

**The chain, each link at `file:line`.**

1. `STRIPE_PRICE_ANNUAL_ID` is **absent from the Vercel project** (40 vars
   enumerated, name-only read). Nothing sets it.
2. `api/stripe-annual-checkout.js:20` therefore sells the annual plan at a
   hardcoded constant: `const priceId = process.env.STRIPE_PRICE_ANNUAL_ID || ANNUAL_PRICE_FALLBACK`,
   where `ANNUAL_PRICE_FALLBACK` is defined at `api/stripe-annual-checkout.js:10`
   as the **$89.99/yr** price. **Checkout succeeds** \u2014 the `503 'Payments not
   configured'` guard at `:21` is satisfied by the fallback.
3. `api/_tier.js:53` maps the annual price via
   `add(process.env.STRIPE_PRICE_ANNUAL_ID, 'pro')`, and `add` at `:51` is
   guarded `if (id)`. Unset \u21d2 **no entry is added**.
4. The fallback constant is mapped **nowhere**: a search for
   `ANNUAL_PRICE_FALLBACK` in `api/_tier.js` and `api/pro-status.js` returns
   **0 hits**. The price the customer actually bought at is not in the tier map.
5. `api/_tier.js:58` returns `map[priceId] || null`. So
   `priceIdToTier('<the annual price>')` \u2192 **`null`**.
6. `api/pro-status.js:108` has the same hole in a worse form: as a **computed
   object key**, `undefined` becomes the literal string `"undefined"`, so the map
   gains a `"undefined"` entry that can never match a real price ID.

**So a customer pays $89.99 for a year and the tier lookup for their
subscription returns nothing.** Sold successfully, entitlement not granted \u2014 the
purchase path and the recognition path disagree because only one of them has a
fallback.

**Exactly the shape already named twice.** `hasPacket` permanently false,
`buildListingPacket` with no caller, and now a price ID that only checkout knows
about. **Rule 2 \u2014 a silent null is the bug** \u2014 and this one is on the revenue path.

**What is established and what is not.**

- **Established:** steps 1\u20136 above, all at `file:line`, in production code.
- **Unverified:** what the downstream consumers do with `null`. `getUserTier`
  (`api/_tier.js:66`) has a KV fast path and a Stripe-by-email fallback; whether
  `null` degrades to `'free'` or is handled some other way is **not yet traced**.
- **Unverified:** whether any annual subscriber exists. With no revenue data I
  cannot say whether this has already cost a real customer their entitlement, or
  is latent. **It is not safe to assume latent.**

**Severity: blocking for the release, and it does not wait for the rotation.**
Independent of TPL, eBay and the KV gate.

**Two candidate fixes, both needing a redeploy, neither authorized.**

1. **Set `STRIPE_PRICE_ANNUAL_ID` in Vercel** to the same price the fallback
   already sells at. No code change; makes the map and checkout agree.
2. **Map the fallback in code**, so the constant is the single source for both
   paths.

Option 1 is smaller, but leaves two places stating the same price. Option 2
matches **Rule 1 \u2014 one business behaviour, one implementation**. **Recommend 2**,
with the constant imported by `_tier.js` rather than duplicated.

**Q-RV11-1 (owner):** which fix, and is either authorized to deploy? Until one
ships, **annual is being sold into a tier gap.**

</details>

## RV-12 — WITHDRAWN. Duplicates R3, which is already built and mock-tested.

**Not a new defect. Not a queue item. Filed in error.**

The success-only fix **already exists on this branch**, and has since R3:

| Branch `api/tpl-proxy.js` | Behaviour |
| --- | --- |
| `:185` | `if (r.status >= 200 && r.status < 300)` → sets `s-maxage=300` |
| `:194` | `else` → `Cache-Control: no-store` |
| `:99, :124, :146, :155, :203` | `no-store` on validation failure, unbound budget, stale serve, exhausted/per-IP, and upstream throw |

So the production observation at `9aaf326` is **the symptom R3 was written to
fix**, and it belongs to R3's release, not to a new queue entry. **Correct
linkage: the rotation run produced the first live confirmation that the
unconditional header is real in production — evidence for shipping R3, not a
finding of its own.**

### The part that is worse than a duplicate

`api/tpl-proxy.js:183` on this branch already carries this comment, which I
wrote:

> *"Note the withdrawn claim: this does NOT mean a dead key was previously
> served for five minutes — Vercel's cacheable statuses exclude 401, 429 and
> 5xx, so most failures were never cached whatever we asked for."*

**I then re-made that exact claim in RV-12**, writing that one rate-limited
request "poisons that query for five minutes for every user" — against a
retraction already committed, in the file I was reading. Marking it "Unverified"
did not help: **the answer was not unknown, it was recorded, in my own code
comment.** The reviewer had to withdraw the same claim twice.

**Withdrawn: the poisoning consequence.** Vercel's cacheable statuses exclude
`429`, `500` and `502`, so the documented platform behaviour prevents it
([Vercel caching criteria](https://vercel.com/docs/edge-network/caching)). The
unconditional header is still worth correcting — because relying on an external
list of eligible statuses is fragile, which is what `no-store` at `:194` makes
explicit — but **there is no user-facing harm to claim**, and I should not have
described one.

### Two more corrections to the same run

**The burst-limit explanation is plausible, not established. Downgraded.** One
`429` followed by successful retries establishes **neither window, scope nor
threshold**. I wrote "short-window burst limit, not a daily quota" as though
observed; **one observation cannot separate those**, and it does not show that a
twenty-card session meets any limit. Hourly allowance and short-term pacing are
**different constraints**, and R4 sizing is not rewritten by this. **Recorded as:
one `429` occurred under concurrent lookups; cause Unverified.**

**And my freshness evidence was invalid.** I argued the payloads proved a live
provider call because they carried `tcgplayer_id`, `cdn.tcgpricelookup.com`
image URLs and a `last_price_update`. **A cache replays exactly those fields** —
they are payload contents, and payload contents cannot establish freshness. What
actually carried the rotation proof: **`x-vercel-cache: MISS` with `age: 0` on
terms never queried in the session**, so no edge entry could exist, plus **#518
already revoked**, leaving no other credential able to produce a `200`. **The
conclusion stands; that particular argument for it does not.**

---

<details>
<summary>RV-12 as originally filed (withdrawn — retained for the correction to point at)</summary>

### (withdrawn) RV-12 original text

**Production defect at `9aaf326`. Found during the TPL rotation verification, not
by review.**

`api/tpl-proxy.js` at `9aaf326`, lines 47\u201351:

```
res.status(r.status);                                    // upstream status, verbatim
res.setHeader('Content-Type', ...);
// Cache TPL responses at the edge for 5 min — big cost saver
res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
res.send(body);
```

**The header is set unconditionally, after the upstream status has been
applied.** A `429`, a `500`, a provider outage body \u2014 each is stamped
"cacheable for five minutes, serve stale for sixty seconds beyond that",
identically to a real 28 KB card payload. **The code draws no distinction
between a payload and an error.** The comment says "Cache TPL responses",
and the implementation caches TPL *responses* rather than TPL *data*.

**How it was found:** a live lookup returned `429` from the provider (a
short-window burst limit; `:47` passes the status through verbatim, which is how
the attribution was established). That surfaced the header being applied to it.

**Rule 2 applies:** the failure is not that an error occurred \u2014 it is that the
error is dressed as a cacheable success. If honoured, one rate-limited request
poisons that query for five minutes for **every** user, and `stale-while-
revalidate` extends it: the first user's `429` becomes everyone's answer, and
nothing on the read side knows the cached body is an error rather than a card.

**This is the reviewer's write/read asymmetry rule, and here it does fire.** The
write path labels an error as durable, and no read path distinguishes it. Unlike
RV-11, there is no lenient default catching it downstream.

### What is Unverified, stated plainly

**Whether Vercel's edge actually caches a `429`.** Its CDN honours caching
directives for a specific set of status codes, and `429` is not obviously among
them, so **the live blast radius may currently be nil**. I have not tested it,
and testing it means deliberately provoking repeated provider rate limits \u2014
consuming paid quota to demonstrate an abuse case.

**The code defect does not depend on that answer.** It relies on an undocumented
platform behaviour to be harmless, and a `500` or a `502`-shaped upstream body
may sit inside the cacheable set where `429` does not. **Severity: real, bounded,
and not release-blocking on current evidence.**

### Fix, and the one judgement call in it

Set the caching header **only for a successful upstream status**, and send an
explicit non-cacheable header otherwise. One behaviour, one implementation.

The judgement call: the existing comment calls the 5-minute cache a "big cost
saver", and it is \u2014 it is what keeps the daily counter far from 10,000. **The fix
must not weaken caching of real payloads while excluding errors.** Narrow the
condition to the status, not to the caching.

</details>

## RV-13 — FIXED ON BRANCH. Lookup failure no longer reads as "no such card"

**Status: implemented and mock-tested on `phase1-block-d`, in bundle
`js/core.e9f21f4e.js`. Still present in the live bundle `js/core.569ff536.js`,
which is what production serves — so RV-13 stays in this queue until a push.**

The original filing overstated the blast radius (one caller was traced, seven
were asserted). That correction is kept in full below, and the fix does not
rely on the withdrawn part: the four input conditions are now held distinct at
the helper and rendered distinctly by every caller that owns a render, measured
in a browser rather than argued from source.

`searchWithTPL` at `:297`:

```
if (!window.tplApiKey) return null;
...
if (!r.ok) return null;
const json = await r.json();
if (!(json.data && json.data.length)) return null;
```

**Every non-2xx becomes `null`.** A `429`, a `500`, a `502`, an aborted timeout
\u2014 all collapse into the **same value** the code uses for "this card does not
exist." Grepping `429` across both bundles returns **2 hits, both `429,#d`**,
an SVG path/colour fragment. **There is no rate-limit handling anywhere in the
client.**

**Rule 2, exactly as stated: the silent null IS the bug.** The seller who gets
rate-limited is not told to wait \u2014 they are told, in effect, that their card
isn't in the database. The rational response to that message is to **retype the
query**, which issues more lookups into the condition that caused it.

### This is the write/read asymmetry rule firing properly

Unlike RV-11, there is no lenient default catching it, and unlike RV-12 the
consequence needs no platform assumption:

- **R4 already produces distinguishable refusals** \u2014 `api/tpl-proxy.js:155`
  returns `'Too many lookups from this address'` with `reason: 'per_ip_limit'`,
  and `'Lookup temporarily unavailable'` with `budget_exhausted`.
- **The client discards all of it at `:303`.** `!r.ok \u2192 null`. The reason string,
  the status, the distinction between "slow down" and "not found" \u2014 none reaches
  the interface.

**So shipping R4 as built would add a spending control whose refusals are
invisible to the person they are refusing.** That is a defect in the pair, not in
either half, and it is the correct target of the burst observation \u2014 **not** the
per-IP number, which remains unresized and Unverified.

### CORRECTION — the seller-facing consequence was asserted, not traced

**The `null` proves the helper merges outcomes. It does not prove every screen
says "no such card", and I wrote it as though it did.** Tracing the eight
callers in `js/core.569ff536.js`:

| Caller | Guard | Established end state |
| --- | --- | --- |
| `:1459` generic `gameSlug` | `if (!data \|\| !data.length)` | **Renders `"${emptyMsg} Try a different name."`** — every failure mode reaches this |
| `:938` pokemon, `:1236` mtg, `:1489` yugioh | `if (tplData)` | falls through — **end state not established** |
| `:1336` lorcana, `:1420` onepiece | `if (tplData && tplData.length)` | falls through — **not established** |
| `:1074` pokemon-jp | no guard at the call | falls through to TCGdex / PokemonTCG.io fallbacks — **not established** |
| `:12258` scan | `if (tplHits && tplHits.length)` | falls through to other match strategies — **not established** |

**So the confirmed blast radius is one caller, not the interface.** The other
seven may mask the failure behind a fallback provider, may leave the dropdown
untouched, or may reach a different empty state — **unestablished, and that is
exactly what the mocked render must settle.**

**Now established (it was not, from the snippet I showed):** the `catch` block at
`:307` does `console.warn` then `return null`, so **thrown timeouts and network
failures merge into the same null** as a `429`. The merge is real across all
four input conditions; only the *display* varies.

**Severity: real loss of error information, to be corrected before R4
activation.** The interface-wide phrasing is withdrawn.

### `window.tplApiKey` — checked, not a finding

`js/config.20ebe911.js:4`: `window.CARDSELL_TPL_KEY = '__PROXIED__'; // sentinel
— real key stays server-side`. It is a **presence gate**, matching the earlier
record. **Not a credential, not a new finding**, and closed here rather than
left hanging as an open question.

~~**Open question:** whether `:297` reads a gate or a value.~~ **Closed** by
the paragraph above — it is the `__PROXIED__` sentinel, a presence gate. The
question is struck rather than deleted so the record shows it was answered.

### RV-13 — the fix, and what the browser actually rendered

**Bundle: `js/core.e9f21f4e.js`** (renamed twice during this work, per the
content-addressed convention: `73a71fac` → `176e4a56` → `e9f21f4e`; only
`e9f21f4e` matches its own content and only it is referenced by
`index.html:3837`).

**1. The helper stopped merging outcomes.** `searchWithTPL` returns a
discriminated result instead of `null`:

| Return | Meaning |
| --- | --- |
| `{ok: true, cards: [...]}` | provider answered with cards |
| `{ok: true, cards: []}` | **successful empty search** — the only case that may say "no matches" |
| `{ok: false, cards: null, reason}` | refusal or failure; `reason` ∈ `rate_limited` \| `budget` \| `unavailable` \| `network` \| `not_configured` |

The reason is read from R4's own JSON where R4 sent one — `per_ip_limit` →
`rate_limited`, `budget_exhausted` → `budget` — and derived from the status
otherwise (`429` → `rate_limited`). The `catch` path, the one that had been
merging thrown timeouts into the same `null`, yields `network`.

**2. Ten give-up points now route through one helper.** `tplOutcomeHtml(res,
emptyHtml)` returns the seller's original empty-state markup when the search
genuinely succeeded and returned nothing, and a temporary-unavailability panel
when it did not. One behaviour, one implementation — Rule 1. The panel carries
`data-tpl-state="unavailable" data-tpl-reason="<reason>"`, which is what the
suite asserts on rather than on copy wording.

**3. Successful fallback results are preserved.** The six game callers keep
their existing truthiness exactly — `(_tplRes.cards && _tplRes.cards.length) ?
_tplRes.cards : null` — so a TPL refusal still falls through to Scryfall,
PokemonTCG.io, TCGdex, ygoprodeck or Lorcana as before. **A TPL failure never
replaces another provider's working results with an error screen.** Case group
C proves it directly: TPL rate-limited, PokemonTCG.io answering, cards render
and no unavailability panel appears.

The Japanese path needed a decision, and it is recorded rather than buried: it
always synthesizes a usable eBay JP comps entry, so it *has* a successful
fallback result even when TPL refused. That result is kept, and the notice is
prepended above it — otherwise absent prices look like prices the card doesn't
have. **A judgement call, not a derived rule.**

**4. One judgement call at MTG's Scryfall 404.** When Scryfall says "no such
card" but TPL was unavailable, we cannot assert the card doesn't exist — the
temporary message wins over the 404's empty state. Deliberate; the alternative
is asserting an absence from an incomplete search.

### Rendered outcomes — `node tests/tpl-outcome-render.mjs`

**81 assertions, 0 failed, stable across five consecutive runs.** Four input
conditions are mocked at the proxy boundary: `429` + `per_ip_limit`, `503` +
`budget_exhausted`, a transport-level abort, and `200` with `data: []`.

| Caller | 429 | budget | network | genuine empty |
| --- | --- | --- | --- | --- |
| `searchPokemon` | `rate_limited` | `budget` | `network` | its own "no cards found" |
| `searchPokemonJP` | `rate_limited` + JP comps kept | `budget` + kept | `network` + kept | JP comps, no notice |
| `searchMTG` | `rate_limited` | `budget` | `network` | "no Magic cards found" |
| `searchLorcana` | `rate_limited` | `budget` | `network` | "no Lorcana cards found" |
| `searchOnePiece` | `rate_limited` | `budget` | `network` | its own panel |
| `searchYugioh` | `rate_limited` | `budget` | `network` | "no Yu-Gi-Oh! cards found" |
| `searchTPLGame` (generic) | `rate_limited` | `budget` | `network` | "`${emptyMsg}` Try a different name." |

For every failure condition the suite asserts three things: the rendered
`data-tpl-reason` matches the condition, the text does **not** tell the seller
the card was not found, and the text tells them their input is still there.
For the genuine-empty condition it asserts the opposite — **no** unavailability
claim.

**The eighth caller is not in that table, and I am not going to pretend it is.**
`_loadScannedCardExactImpl` (the scan path) owns no `dropList` render; its
result feeds other match strategies. Its rendered outcome is **Unverified** —
exercising it needs a scan-session fixture, which is buildable next if you want
it. Seven of eight rendered outcomes are established in a browser; the eighth is
established in source only (falls through, does not claim absence).

**Recovery (case D):** Lorcana, which has no fallback provider on this path, is
refused with `rate_limited`, then the next request succeeds — cards render and
the unavailability panel is gone. **Recovery verified; no sticky error state.**

**Twenty-card measurement (case E):** twenty distinct queries handled through
`searchPokemon` with a successful mocked proxy: **20 requests to
`/api/tpl-proxy`, 1.00 per card handled, 140–164 ms wall clock across runs.**
Direct calls, so **the 180 ms debounce is not exercised** — this measures the
per-card lookup count, not real typing behaviour, and it does not resize the
per-IP number, which stays Unverified. No live requests were made; successful
responses stay cacheable and no limit was probed.

### Two things the suite found about the suite

Recorded because both produced confident false results first, and a harness
that lies is worth the same scrutiny as code that lies:

1. **A catch-all `page.route('**/api/**')` registered before the specific mock
   swallowed it.** Playwright resolved the first matching handler, so every
   caller reported "not found" and the mock never fired. The suite reported that
   honestly — 47 failures — which is how it was caught. The glob
   `**/api/tpl-proxy*` also matched nothing; the mock now uses a regex.
2. **Reading `dropList` once was flaky** — some callers paint a "Searching…"
   placeholder first, and a different caller failed on each run. The read now
   polls past loading states.

### A separate robustness gap, found while mocking

With a fallback provider's fetch **aborted** rather than answering, six of the
seven callers throw an uncaught `TypeError: Failed to fetch` before reaching any
give-up render — e.g. `searchYugioh` at `js/core.e9f21f4e.js:1764`,
`searchPokemon` at `:1208`. The suite therefore has fallbacks answer empty, so
the condition under test is TPL's failure and not the fallback's. **Filed here,
not fixed — it is a different defect from RV-13 and fixing it unasked would be
scope I was not given.**

### Questions for Will — RV-13

1. **Do you want the eighth caller's rendered outcome established?** The scan
   path needs a scan-session fixture to drive in a browser. It is the only one
   of the eight still resting on source reading. I have not built it because it
   is a new fixture, not a continuation of this one.
2. **The uncaught-fetch gap above** — separate defect. Fix it in this pass, or
   file it and leave it for release validation?
3. **Nothing is pushed.** This is branch-local: `phase1-block-d`, live bundle
   `core.569ff536.js` still has RV-13. Production still serves Phase 0 and
   still shows the old behaviour. A push to `main` auto-deploys, so it waits on
   you saying so explicitly.
