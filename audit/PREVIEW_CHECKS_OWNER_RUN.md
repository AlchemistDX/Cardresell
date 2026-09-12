# Preview checks to run in your own browser — RV-4 and Q-D8-6

Written to be run without opening any other file. Everything you need — URL,
key names, exact strings to look for, and what a failure looks like — is here.

**Preview URL:** https://cardresell-8x9mr2o1h-willsep200-9430s-projects.vercel.app

**Build under test:** commit `a311137`, the tip of `phase1-block-d`.

**On the two commit numbers you spotted.** You were right to stop on that. The
report named `a311137` and an earlier copy of this sheet named `46a5a4e`, and
"they probably only differ by docs" is not something you should have to take on
faith. Established: `46a5a4e..a311137` is **two lines in this file and nothing
else**, and the combined digest of `index.html` plus everything under `js/` is
byte-identical across `be49e0a`, `46a5a4e`, and `a311137` (`8fca2bf6fdcfcf63`
for all three). The application code under test never changed across those
commits; only audit documents did. To remove the ambiguity rather than explain
it, the URL above is a **fresh deployment made from the tip**, so the deployed
build and the branch tip name the same commit. The two older Preview URLs are
superseded — ignore them.

One residual honesty note so this does not become the same problem again: the
deployment above was made from a clean tree at `a311137`. **This sheet was then
revised** (cap step deferred, concurrency gap stated) and committed on top, so
the branch tip is now ahead of the deployed build **by documentation only** —
`index.html` and `js/` are untouched, same `8fca2bf6fdcfcf63` digest. Step 0
below verifies the build you are actually looking at from the browser, which
does not depend on trusting any of this.

**Not production.** Nothing here touches `www.cardresell.org`, and nothing here
is a production approval.

Preview has deployment protection on, so the URL only opens in a browser already
signed in to your Vercel account. That is why these checks are yours to run
rather than mine: I have no signed-in Vercel session and no Firebase identity,
and I did not create one in your project.

---

## Step 0 — confirm you are on the right build (30 seconds)

Open the Preview URL. Then open the browser console and paste:

```js
[...document.querySelectorAll('script[src]')].map(s => s.src.split('/').pop()).join('\n')
```

**Expect to see `core.2db046e6.js` and `ui.e6529e78.js`.** If you see
`core.ebc21977.js` or `ui.6b3a528e.js`, you are on the old build and nothing
below is meaningful — hard-reload and check again.

While you are in the console, grab your account identifier, which every KV key
below is built from:

```js
window.googleUser && window.googleUser.sub
```

Copy that value. Call it **`SUB`** for the rest of this document.

---

## Step 1 — RV-4: one marked draft exists in nonproduction and not in production

**What this proves:** the Preview environment writes to the nonproduction store
only, so Preview activity cannot appear in production data.

### 1a. Create one draft, marked so you can find it

1. Sign in to the app on Preview with your Google account.
2. Open **Bulk scan** and identify a single card — any card. One is enough.
3. On the results screen, tick the checkbox on that card's row. The bar at the
   top should read **"1 of 1 selected"** (it is always "N of M selected") and
   the button at the bottom should change from "Create Listing Drafts" to
   **"Create 1 Listing Draft"**. If that row is a two-copy row, the count line
   also appends " · 2 drafts" and the button says "Create 2 Listing Drafts" —
   one draft per physical copy is correct.
4. Press it. Expect a toast reading **"1 draft created"** and a line on the row
   itself saying the draft was created.
5. In the console, capture the identifiers:

```js
copy(JSON.stringify({ sub: window.googleUser.sub }, null, 2))
```

6. Open the **Drafts** view and note the draft you just made. Open the draft and
   confirm it reopens with the card, condition, and price you saw on the scan
   row — that is the "reopen" half of RV-4. A draft that lists but will not
   reopen is a failure.
7. Get its id: with the draft open, in the console run

```js
await (async () => {
  const t = await _crIdToken();
  const r = await fetch('/api/drafts?limit=5', { headers: { Authorization: 'Bearer ' + t } });
  const j = await r.json();
  return j.drafts.map(d => ({ id: d.draftId, card: d.card && d.card.card, rev: d.rev }));
})()
```

Copy the `id` of the draft you just created — it looks like
`drf_` followed by 32 hex characters. Call it **`DRAFTID`**.

### 1b. Prove the record is in `aureolin-door` (nonproduction)

In the Vercel dashboard, open **Storage → `aureolin-door` → Data Browser**, and
look up this exact key:

```
draft:SUB:DRAFTID
```

**Expect:** the key exists and its value is a JSON draft record whose `draftId`
matches `DRAFTID`. Also expect these two to exist:

```
drafts:SUB                 (a set; DRAFTID is a member)
draftquota:SUB             (a number, and it should be small)
```

### 1c. Prove that exact key is absent from `bistre-arrow` (production)

Open **Storage → `bistre-arrow` → Data Browser** and look up the **same** key:

```
draft:SUB:DRAFTID
```

**Expect: no such key.** That is the result the check exists to produce.

Two honest cautions about reading this result:

- `drafts:SUB` may well **exist** in `bistre-arrow`, because you have used
  production before. Its existence is not a failure. What must not be there is
  `DRAFTID` — neither as its own `draft:` record nor as a member of that set.
  Check the set membership too, not just the record.
- A data browser that silently returns empty for a malformed key looks identical
  to a genuine absence. Before trusting the empty result, look up
  `drafts:SUB` in the same store in the same way. If that comes back with
  data, your key syntax and store selection are good, and the empty result on
  `draft:SUB:DRAFTID` is real. If it also comes back empty, you cannot yet
  conclude anything.

**Record the outcome as:** key present in `aureolin-door`, key and set-membership
absent from `bistre-arrow`, absence corroborated by a positive control read in
the same store.

---

## Step 2 — Q-D8-6: delete, then prove a new draft needs a deliberate Create

**What this proves:** a deleted draft is not silently resurrected by a retry.

1. Still on Preview, delete the draft you made in Step 1 from the Drafts view.
2. Go back to the same scan row for the same card and press the create action
   again on that row.
3. **Expect:** it does **not** quietly recreate the old draft and does **not**
   auto-retry. You should get an explicit deleted/gone state and have to make a
   fresh deliberate Create. A brand-new draft is fine — a **new** `drf_…` id is
   the correct outcome. What would be a failure is the old `DRAFTID` coming
   back, or a new draft appearing with no action from you.
4. Confirm in `aureolin-door` that the old key is now a **tombstone**: the key
   `draft:SUB:DRAFTID` still exists, but the value carries `deletedAt` and the
   card payload is gone. Retained, not erased, is the intended behaviour.

---

## Step 3 — the draft-cap refusal: DEFERRED, do not run today

**Do not run a cap test by hand-editing quota keys.** The earlier version of
this sheet told you to overwrite `draftquota:SUB` and `draftquotafresh:SUB` in
the Data Browser and delete them afterwards. That procedure was not safe enough
to put in front of you, for a reason I understated: **deleting a key is not the
same as restoring it.**

- `draftquotafresh:SUB` is written by the server with a TTL
  (`set … EX <interval>`). If it already exists, it has a *remaining* lifetime.
  Overwriting it discards that, and no delete-afterwards step brings it back.
- `draftquota:SUB` may hold a legitimate count. Writing `500` over it and then
  deleting it leaves the next call to re-seed from a recount — which is probably
  fine, and "probably fine" is not a restore procedure.
- Neither key's pre-existing value or remaining TTL is captured anywhere before
  the overwrite, so if the recount path misbehaved there would be nothing to
  restore *to*.

So this step is on hold until it has one of:

1. **A precise capture-and-restore procedure** — read and record both values and
   the remaining TTL on the fresh key (`TTL draftquotafresh:SUB`) *before*
   touching anything, and restore both value and expiry afterwards rather than
   deleting; or
2. **An isolated test account** whose quota keys nobody cares about, which is
   the cleaner option and removes the restore problem entirely.

Neither is needed to complete Steps 1 and 2, which is why the cap test is now
separated from them rather than sitting at the end of the same sheet.

**What the cap evidence currently rests on, stated precisely.** The refusal has
been exercised against the real `api/drafts.js` handler locally, with the quota
seeded at the shipped cap of 500 in a throwaway local store, and the server's
sentence containing "maximum of 500 saved drafts" was observed on screen. That
is local evidence against real server code, not Preview evidence, and I am not
upgrading it. Separately, the original "client has no cap message" claim was
**wrong** and has been withdrawn — it came from grepping the bundle for
`at-cap`, a server-internal constant that never goes over the wire. The shipped
build already had the handler (`if (r.status === 409 && /CAP/i.test(...))`) and
its own sentence. There was no missing-message defect. What this change does is
show the server's wording on the refused row instead of a client paraphrase.

## What I could not check, stated plainly

- **Anything requiring a signed-in session on Preview.** No Vercel session, no
  Firebase identity. I declined to create a test user in your Firebase project
  without your approval.
- **Concurrency.** One successful draft round-trip in Step 1 proves the Preview
  store boundary and the create/reopen path. It says **nothing** about
  concurrent behaviour — interleaved creates, simultaneous claims on the same
  revision, or the quota INCR under parallel load — and it is not a substitute
  for the live suite's concurrency checks. Those remain unrun. `DRAFT_KV_LIVE`
  stays skipped by choice, and that choice leaves this gap open rather than
  closing it.
- **Application-level concurrency and URL-size limits** remain unestablished,
  per your earlier note. The REST results stand only for the commands and sizes
  tested.
- **The draft cap on Preview**, deferred above pending a restore procedure or a
  test account.
