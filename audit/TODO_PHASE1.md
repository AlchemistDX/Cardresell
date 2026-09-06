# CardResell — Phase 1 To-Do

Live list of what is next. Keeps two tracks: the Block D path we are already on (top), and small survivors from the reviewer-62 audit worth doing on the side (bottom). One place, not two.

Last update: 2026-09-06 after reviewer-62 audit (`audit/reviewer62/REVIEWER_62_VERDICT.md`, commit `047d83e`).

---

## Track 1 — Block D (main path, resume here)

Status per `audit/CARDRESELL_PLAN_AND_ROADMAP.md` §6.2.

| Block | State | Next action |
|---|---|---|
| A–C | Implemented | — |
| D1 (Sell entry point) | Implemented | — |
| D2.0 (readiness consolidation) | Implemented | Do not add a second sufficiency formula. |
| **D2.1 (draft-list UI)** | **Next — resume here** | Resolve the summary/findings gap first (§6.3 of the roadmap doc), then build the All-drafts screen with stubs, paging, degraded/unavailable states, and 44×44 targets. Navigate by returned ID. |
| D3 (review screen) | Later in D | Render every missing field by server reason; fee breakdown reconciles to the cent. |
| D4 (number provenance) | Later in D | Provider, source URL, absolute retrieval time, fee revision, seller/manual attribution visible. |
| D5 (copy-ready handoff) | Later in D | One-tap field copying and eBay continuation; no publish control. |
| D6 (new-seller warning) | Later in D | Show before handoff when applicable; do not invent eligibility. |
| D7 (local photos) | Later in D | Ordered local photo state, validation, removal, cross-device limitation copy; no server upload. |

### D2.1 entry gate (pinned)

Roadmap §3.4 in `CARDRESELL_PLAN_AND_ROADMAP.md` still describes the withdrawn cross-source disclosure as live. **Fix that description before another reviewer reads the doc against D2.1.** Detection is still computed and tested — decide whether to route it to the card detail view only, or to keep it fully dark. Question sits with you.

### D2.1 blocker (unchanged from the roadmap)

`api/_draftService.js:493-512` — the current summary rows contain identity, status, revision, title, price, quantity, timestamps, and `hasPacket`. They do **not** carry `publishable` findings. "Needs price" cannot be honestly derived from the list response alone. D2.1 needs either a server-summary extension or a per-draft read. No client-side inference.

---

## Track 2 — Reviewer-62 audit survivors (side path)

All six are small, all reduce a live truth or money defect, none is a rebuild. Pick any of these in a natural gap during D2.1 work — do not let them delay D2.1 itself.

Ordered by cost of leaving them broken, not by ease.

### T2.1 — Rename `📬 Price Drop Alerts`

- **Where:** `index.html:1646`.
- **Why:** the label promises a feature that does not exist. Rule 3 violation (do not stamp a lie).
- **Fix:** rename to what it actually is — a newsletter signup for launches/updates. One line.
- **Watch:** do not name it "Coming soon" if it is not on the roadmap.

### T2.2 — Reconcile pricing copy across index and pricing pages

- **Where:** `index.html:2941/2981/3004` say "save about 25%"; `pricing.html:210/233/413` say "3 months free". Different offers.
- **Why:** `pricing.html:256-259` already documents a prior incident where the site advertised unbuyable packs. This failure mode has bitten once. Rule 1 violation.
- **Fix:** decide which offer is real, use that string in both files, then extract the tier price/period strings to a single source of truth so a next edit cannot drift again.
- **Watch:** the retired Ultimate tier is on the do-not-touch list — do not revive it while consolidating.

### T2.3 — Refund the credit on `looksSlabbed`

- **Where:** `api/scan.js:2004-2008` detects a slab after the debit at `:785`. The comment openly says "we STILL return the grade (user paid for it)" (`:2002`). `refundCredits()` at `:956` is never called on that path.
- **Why:** user pays for a result the server itself labels non-actionable. Money defect. This is reviewer item 12, sharpened.
- **Fix:** call the existing `refundCredits()` in the slab branch, keep the honesty caps that follow. A few lines. One toast line client-side ("Slab detected — grade returned as reference, credit refunded.").
- **Watch:** do not add a second refund helper. Reuse `refundCredits()` per rule 1.

### T2.4 — Rate-limit the paid open proxies

- **Where:** `api/tpl-proxy.js:11-19` (unauthenticated open proxy in front of the paid TPL key, wildcard CORS), `api/pricecharting.js:439-444` (same shape).
- **Why:** anyone can bill our paid API quota from a browser console. The scan endpoints are actually the well-defended ones — this is the exposure.
- **Fix:** build **one** shared KV-counter rate-limit helper (pattern already in `api/scan-refund.js:91-101`). Apply it to both endpoints. Per-IP + per-hour cap.
- **Watch:** rule 1 — do not inline a second limiter in each endpoint. One helper, two call sites.

### T2.5 — Stop printing a fabricated ±15% band as observed

- **Where:** `api/tcg-price.js:290-295` synthesizes `low = market × 0.85` / `high = market × 1.15` on the fallback rung; `js/core.d9e1b484.js:1859-1870` renders it as a real range.
- **Why:** fires precisely when the primary feed is down — the moment the number deserves the least confidence gets a made-up spread. Rule 2 violation.
- **Fix:** two options — (a) drop `low`/`high` on the fallback rung entirely; (b) render them but label as "estimated range" and change the caption to reflect the source. Prefer (a) unless we have a downstream consumer that needs them.
- **Watch:** the existing fallback caption at `js/core.d9e1b484.js:2513-2543` correctly names the rung. Do not weaken that.

### T2.6 — Fix bulk `needsPicker` rendering as a confident ✓

- **Where:** `js/ui.6b3a528e.js:3188-3204` branches on `if (data.card_name)`. A response the server flagged for disambiguation renders as resolved with no picker.
- **Why:** correctness. A wrong ID silently priced is the exact failure this project is most exposed to. Single-scan handles it correctly.
- **Fix:** branch on the server's `needsPicker` flag before `card_name`. In bulk, a `needsPicker` row should render as "Pick correct match" with a picker action, not as ✓.
- **Watch:** verify the bulk refund path still works if the user cancels the picker — the credit was debited pre-scan and the picker confirms via `api/scan-debit-id.js`.

---

## Also open (not audit survivors, from prior notes)

- **eBay Cert ID rotation** — sha256[:12] `e3f0a0bc343d` was printed in plaintext in an earlier session. Rotation is mandatory. Once rotated, delete `refs/recovery/pre-scrub-c2366b2`. Do not use the unblock URL.
- **Commit `94dc777` message A/B undecided.** Option A keeps history; option B rewrites 28 SHAs to redact a partial-credential disclosure. Awaiting your call.
- **31 outgoing commits, nothing pushed.** No deployment until you authorize it.

---

## Rules that keep biting

Listed once so a new reviewer or contributor cannot skip them:

1. One business behavior = one implementation.
2. Never display an invented number.
3. Do not stamp a lie.
4. `main` auto-deploys — every push needs its own fresh `confirm_action`.
5. No password collection. (Note: shipped code has already breached this — separate decision.)

Do-not-touch: Ultimate (retired), Grade gold-set, Wallpaper, homepage feature-grid blurb.
