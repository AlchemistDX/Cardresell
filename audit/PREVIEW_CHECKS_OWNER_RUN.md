# Preview checks to run in your own browser — RV-4, Q-D8-6, and the cap refusal

Written to be run without opening any other file. Everything you need — URLs,
key names, exact strings to look for, and what a failure looks like — is here.

**Build under test:** commit `46a5a4e` on `phase1-block-d`.
**Preview URL:** https://cardresell-mc1yik7d1-willsep200-9430s-projects.vercel.app
**Not production.** Nothing here touches `www.cardresell.org`, and nothing here
is a production approval.

Preview has deployment protection on, so the URL only opens in a browser already
signed in to your Vercel account. That is why these three checks are yours to
run rather than mine: I have no signed-in Vercel session and no Firebase
identity, and I did not create one in your project.

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

## Step 3 — the draft-cap refusal on Preview

You asked me not to call the cap message a confirmed defect without exercising
it on a Preview build. I have to report a correction rather than a confirmation.

**The earlier claim was wrong.** The requirement said the client had no cap
message, on the strength of a bundle grep for `at-cap` returning zero hits.
`'at-cap'` is an internal server constant that never goes over the wire, so that
grep could not have found anything either way. The shipped build already had the
handler — `if (r.status === 409 && /CAP/i.test(...))` — showing "You've reached
the draft limit. Finish or discard a draft to start another." **There was no
missing-message defect.** What this change actually does is show the server's
own sentence on the row that was refused, instead of a client paraphrase.

I exercised the refusal locally against the real `api/drafts.js` handler and saw
the server sentence on screen. If you want it on Preview too, here is a
reversible way to do it without lowering the shipped cap:

1. In **`aureolin-door`** Data Browser, create these two keys:
   - `draftquota:SUB` = `500`
   - `draftquotafresh:SUB` = `1`
   The second one matters: without it the server recounts your real drafts on the
   next call and overwrites the 500.
2. On Preview, select two cards and press Create.
3. **Expect:** the first row is refused with the server's sentence, containing
   the phrase **"maximum of 500 saved drafts"**, and the second row reads
   **"Not attempted — the draft limit was reached earlier in this batch."**
   Also expect a note above the button reading "Room for 0 more drafts (500 of
   500 used) — 2 selected. Cards past the limit will say so on their own row."
4. **Delete both keys afterwards.** On the next create the server recounts from
   your real draft set and the true number returns. Leaving them in place would
   leave your Preview account permanently at a fake cap.

The headroom note is advisory only. It never trims the batch, and the server's
refusal is the only thing that decides. That was your second point and it is
built that way deliberately: a stale headroom number that refused cards the
server had room for would be worse than a refusal on the row.

---

## What I could not check, stated plainly

- **Anything requiring a signed-in session on Preview.** No Vercel session, no
  Firebase identity. I declined to create a test user in your Firebase project
  without your approval.
- **The live-store suite** (`tests/draft-kv-live.mjs`) stays skipped. Running it
  means pulling nonproduction store credentials into this sandbox, and the
  deployed round-trip in Step 1 is stronger evidence than the suite would be.
  Not worth broadening credential exposure for weaker proof.
- **Application-level concurrency and URL-size limits** remain unestablished, per
  your note. The REST results stand only for the commands and sizes tested.
