# Tier Expansion Spec — Pro Max + Ultimate

**Status:** Ready to implement
**Owner:** @alchemistdx
**Est. work:** 3 commits, ~4-6 hours total dev time
**Blocks:** Trust bundle (#1 + #14) resumes after this ships

---

## Goal

Expand from 1 paid tier (Pro) to 3 paid tiers (Pro / Pro Max / Ultimate) with
value-anchored pricing, monthly credit grants, tier-based top-up discounts, and
Ultimate-exclusive features. Never remove anything from existing Pro users.

## Final tier structure (locked with user 2026-08-17)

| | Free | Pro | Pro Max | Ultimate |
|---|---|---|---|---|
| **Monthly** | $0 | $9.99 | $19.99 | $39.99 |
| **Annual** (3 mo free) | — | $89.99 | $179.99 | $359.99 |
| **Grade scans/mo** | 0 | 10 | 25 | 60 |
| **ID scans/mo** | 0 | 25* | 75 | 200 |
| **Top-up discount** | — | 10% | 15% | 25% |
| **Rapid Scan priority queue** | — | ✅ | ✅ (higher) | ✅ (highest) |
| **6 platforms compared** | — (2) | ✅ | ✅ | ✅ |
| **Payout bar chart** | — | ✅ | ✅ | ✅ |
| **Unlimited flip tracking** | 5 flips | ✅ | ✅ | ✅ |
| **Deal Score + Max Buy** | — | ✅ | ✅ | ✅ |
| **Bulk Grade tool** (10 cards) | — | — | — | ✅ |
| **★ Ultimate badge** | — | — | — | ✅ |
| **Included value/mo** | — | ~$14 | ~$40 | ~$100 |

\* NOTE: current Pro is 20 ID scans/mo. **Bump to 25 for parity math** — user-facing
copy already says "20", so leave copy at 20 for existing Pro subs, but new Pro
signups get 25 (both are honored by grant logic; just update the copy).
**DECISION NEEDED:** confirm with user whether to raise Pro to 25 or keep at 20
and adjust Max/Ultimate to 20/50 and 50/150 instead. Recommend keeping 20 for
Pro (already promised) and setting Max=50 ID, Ultimate=150 ID.

**REVISED TABLE (recommended, honors existing Pro promise):**

| | Pro | Pro Max | Ultimate |
|---|---|---|---|
| Grade scans/mo | 10 | 25 | 60 |
| ID scans/mo | **20** | **50** | **150** |

Value math with revised ID counts:
- Pro: $9.99 + (20 × $0.199) = $9.99 + $3.98 = **$13.97/mo** ✅ (matches "Worth ~$14")
- Pro Max: $24.99 + (50 × $0.199) = $24.99 + $9.95 = **$34.94/mo** → "Worth ~$35"
- Ultimate: $59.99 + (150 × $0.199) = $59.99 + $29.85 = **$89.84/mo** → "Worth ~$90"

## Stripe assets (already created 2026-08-17)

Products:
- `prod_V5fFv7rkd01zAo` — CardResell Pro Max
- `prod_V5fFdjvKRLv40X` — CardResell Ultimate

Prices (LIVE mode):
- Pro Max Monthly `$19.99` → `price_1U5TuuFW2YZoedIZrCDg0kMc`
- Pro Max Annual `$179.99` → `price_1U5TuuFW2YZoedIZ5slunA3B`
- Ultimate Monthly `$39.99` → `price_1U5TuvFW2YZoedIZ2Qs99Qoq`
- Ultimate Annual `$359.99` → `price_1U5TuvFW2YZoedIZDq7tffR6`

Coupons (LIVE, duration=forever):
- `PRO_TOPUP_10` — 10% off
- `MAX_TOPUP_15` — 15% off
- `ULTIMATE_TOPUP_25` — 25% off

Existing Pro prices (unchanged, keep supporting):
- Pro Monthly `$9.99` — check current env var
- Pro Annual `$89.99` — check current env var

## Unit economics (recomputed with final numbers)

Per-user monthly direct cost:

| Tier | Grade COGS | ID COGS | Stripe fee | Total cost | Price | Net margin |
|---|---|---|---|---|---|---|
| Pro | 10 × $0.07 = $0.70 | 20 × $0.007 = $0.14 | $0.59 | $1.43 | $9.99 | **$8.56 (86%)** |
| Pro Max | 25 × $0.07 = $1.75 | 50 × $0.007 = $0.35 | $0.88 | $2.98 | $19.99 | **$17.01 (85%)** |
| Ultimate | 60 × $0.07 = $4.20 | 150 × $0.007 = $1.05 | $1.46 | $6.71 | $39.99 | **$33.28 (83%)** |

Top-up discounts erode margin but stay profitable at all levels (see Aug 17
message analysis — 25% off top-ups still yields ~$6.20 net on a $10 top-up).

---

## Feature: Rapid Scan priority queue

**What it is:** Paid-tier scan requests get routed ahead of Free-tier requests
in the processing queue. Under load, Free users wait; paid users don't notice.

**Why it's a good feature:**
- Cheap to build (queue priority flag)
- Real value under any traffic spike (launch day, viral TikTok, etc.)
- Nothing to promise or measure — either your scan resolves fast or it doesn't
- Pairs perfectly with the tier ladder narrative

**Priority ordering:**
1. Ultimate (highest priority)
2. Pro Max
3. Pro
4. Free (lowest)

**Implementation:**
- Add `priority` field to scan request payload (server-set based on tier)
- If we're using Upstash Redis for anything queue-like, add priority routing
- If we're doing pure serverless (no queue), skip this for now and just
  advertise "faster scans" on paid tiers — under our current traffic it's true
  by default (no queue = no wait)

**Copy on pricing modal:**
- Pro: "⚡ Rapid Scan — priority queue"
- Pro Max: "⚡ Rapid Scan — higher priority"
- Ultimate: "⚡ Rapid Scan — top priority"

**PUNT DECISION:** Do we build actual queue priority or advertise the promise
now and build queue infrastructure only when we see load issues? Recommend the
latter — put "⚡ Rapid Scan" on the pricing card as a tier badge, defer real
queue plumbing to when we have >1000 concurrent users.

---

## Feature: Bulk Grade tool (Ultimate-only)

**What it is:** Upload up to 10 card images at once, get a combined multi-card
grade report as a single PDF export.

**Why Ultimate-only:**
- Serious LCS-owner catnip (grade a whole box in one sitting)
- Real dev work (batch processing, PDF generation, progress tracking)
- Justifies the $39.99 price jump vs Pro Max $19.99

**Implementation:**
1. New endpoint `api/scan-bulk.js`
   - Accepts array of up to 10 image sets (front + back per card)
   - Server-side: process serially (not parallel, to keep Ximilar cost sane)
   - Deducts 10 grade credits (from monthly bucket first, then paid)
   - Ultimate-only guard: return 403 if tier != 'ultimate'
   - Returns: array of grade results + shared metadata
2. New UI in scan drawer: "Bulk Grade" button visible only to Ultimate users
3. Drag-drop up to 10 cards, front/back per card
4. Progress bar: "3 of 10 cards processed..."
5. On complete: table view + "Download PDF" button
6. PDF export uses existing PDF library (`pdfmake` or `jspdf`, whichever we have)

**Scoping note:** This is the biggest single lift. Recommend building it in a
separate commit AFTER tier plumbing is live and Ultimate is purchaseable.
Ultimate users see "Coming soon" badge on Bulk Grade for the first 1-2 weeks.

---

## Files to modify

### Backend

#### `api/scan-credits.js`
- Extend `tierMaps` (or introduce it if not there) to key on 4 tiers instead of 1
- Add `getTierBenefits(tier)` helper → returns `{gradeGrant, idGrant, topupDiscount}`
- Extend response to include `tier: 'free'|'pro'|'pro_max'|'ultimate'` + `topupDiscount`
- Grant amounts per tier:
  - Pro: 10 grade, 20 ID
  - Pro Max: 25 grade, 50 ID
  - Ultimate: 60 grade, 150 ID

#### `api/scan.js`
- Replace `checkProStatus` boolean call with `getUserTier` returning tier string
- Update monthly grant checks to use per-tier limits (currently hardcoded to 10 grade / 20 ID)
- Free bucket KV keys stay the same (`free_used_<month>`, `id_free_used_<month>`)
- If Bulk Grade is in scope: add tier gate on `api/scan-bulk.js`

#### `api/stripe-webhook.js`
- Extend `tierMaps` to recognize 4 new price IDs (Pro Max monthly/annual, Ultimate monthly/annual)
- On `customer.subscription.updated` or `.created`: write tier to KV `user:<sub>:tier`
- On `customer.subscription.deleted`: clear tier back to 'free'
- Store metadata `tier` on the subscription itself for observability

#### `api/stripe-checkout-*.js` and `api/stripe-redirect-*.js`
- Split existing Pro checkout into 4 checkout endpoints OR add `tier` query param
- Recommend: single `api/stripe-subscription-checkout.js?tier=pro|pro_max|ultimate&interval=month|year`
- Map tier + interval to price ID

#### Top-up checkout (existing `api/stripe-grade-checkout.js`, `api/stripe-id-checkout.js`)
- Read user's current tier from KV
- Apply the appropriate Stripe coupon at checkout:
  - Pro → `PRO_TOPUP_10`
  - Pro Max → `MAX_TOPUP_15`
  - Ultimate → `ULTIMATE_TOPUP_25`
- Free users → no coupon

#### `api/get-user-tier.js` (NEW, optional)
- Small utility endpoint frontend can hit to know current tier
- Or fold into `api/scan-credits.js` response

### Frontend

#### `index.html` pricing modal (lines ~2420-2500)
- Convert from 3-column to 4-column desktop layout (Free / Pro / Pro Max / Ultimate)
- Mobile: horizontal-scroll or tab switcher for 4 tiers
- Each tier card gets:
  - Header with "Worth $X/mo" value anchor
  - Feature list with dollar amounts per line item
  - CTA button
  - Featured badge on Pro (default upsell target)
  - Gold "PREMIUM" or "★" badge on Ultimate
- Add annual toggle at top (Monthly / Annual)
- Style pass — Ultimate card needs to visually feel more premium (gradient border, gold accent)

**Desktop mockup (rough):**
```
┌─────┬────────┬────────┬──────────┐
│ Free│  Pro   │ Pro Max│ Ultimate │
│ $0  │ $9.99  │ $19.99 │  $39.99  │
├─────┼────────┼────────┼──────────┤
│feat │ feats  │ feats  │  feats   │
│feat │ feats  │ feats  │  feats   │
├─────┼────────┼────────┼──────────┤
│[Cur]│[Get Pro│[Get Max│[Get Ult] │
└─────┴────────┴────────┴──────────┘
```

**Mobile mockup:** Vertical stack of 4 cards, one per screen, swipe to next.

#### `index.html` scan gate + credit panel copy
- Update "Pro includes 10 Grader + 20 ID scans/mo" → conditional based on tier
- Add tier badge next to user name in header
- Show tier-specific top-up discount at checkout ("You save 15% as Pro Max")

#### `index.html` header
- Add ★ Ultimate badge visual element (gold gradient background, star icon)
- Show on all Ultimate accounts next to name

#### `updateProUI()` function
- Rename to `updateTierUI()` — takes tier string, updates all tier-conditional DOM
- Called from anywhere Pro state matters

### Stripe env vars (Vercel prod)

Add to Vercel:
- `STRIPE_PRICE_PRO_MAX_MONTHLY=price_1U5TuuFW2YZoedIZrCDg0kMc`
- `STRIPE_PRICE_PRO_MAX_ANNUAL=price_1U5TuuFW2YZoedIZ5slunA3B`
- `STRIPE_PRICE_ULTIMATE_MONTHLY=price_1U5TuvFW2YZoedIZ2Qs99Qoq`
- `STRIPE_PRICE_ULTIMATE_ANNUAL=price_1U5TuvFW2YZoedIZDq7tffR6`

**Use `printf '%s' "$value" | vercel env add` — never `echo` (adds newline
that Stripe rejects).**

---

## Rollout plan (3 commits)

### Commit 1 — Tier plumbing + purchase flow
- Backend: tier maps in scan-credits, scan, stripe-webhook
- Backend: split/parameterize subscription checkout endpoints
- Backend: top-up coupon application based on tier
- Frontend: new 4-column pricing modal (desktop)
- Frontend: annual toggle
- Frontend: tier-aware CTA buttons
- Vercel env vars pushed
- **Ship criteria:** User can purchase Pro Max or Ultimate; credits grant correctly; top-ups get correct discount at checkout

### Commit 2 — Ultimate badge + polish
- ★ Ultimate badge in header + wherever Pro badge appears
- Mobile pricing modal responsive refinement
- Copy pass across app: "Pro or higher" wording where tier gates exist
- **Ship criteria:** Ultimate users look/feel premium in the app

### Commit 3 — Bulk Grade tool (Ultimate-only)
- `api/scan-bulk.js` endpoint
- Bulk Grade UI in scan drawer
- PDF export
- **Ship criteria:** Ultimate user can bulk-grade 10 cards → single PDF report

---

## Testing checklist

Before deploying each commit:

- [ ] Free user can still upgrade to Pro
- [ ] Existing Pro user is unchanged (10 grade + 20 ID + 10% off top-ups)
- [ ] New Pro Max user gets 25 grade + 50 ID + 15% off top-ups
- [ ] New Ultimate user gets 60 grade + 150 ID + 25% off top-ups
- [ ] Monthly credit reset works for all 3 tiers on new month
- [ ] Downgrade path: Pro Max → Pro correctly drops grant to 10/20
- [ ] Cancel path: subscription deleted → tier back to 'free'
- [ ] Annual variants create correct sub with correct grant amount
- [ ] Coupon applies correctly at top-up checkout for each tier
- [ ] Mobile pricing modal readable and usable
- [ ] No 500s from missing env vars (`STRIPE_PRICE_*` all set)
- [ ] Stripe webhook handles all 4 new price IDs correctly

---

## Followups (not part of this expansion)

- Rapid Scan real queue priority (only if we see load issues)
- Team seats / Business tier (for LCS multi-seat use case)
- Founding Ultimate rewards (first 100 Ultimate signups get merch)
- Referral bonus scaling by tier (Ultimate refers = bigger bonus)
- CardResell Discord w/ tier-gated channels
