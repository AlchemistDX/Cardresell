# CardResell — Monthly Expenses & Break-Even Analysis

**Date:** 2026-08-19
**MRR from paying customers:** $0 (1 active Stripe sub — the owner's test account)
**Users signed up:** unknown without an admin dashboard query, but assume pre-launch scale

---

## Fixed monthly costs (recurring, guaranteed)

| Service | What it does | Cost/mo | Free tier headroom |
| --- | --- | --- | --- |
| **Vercel Pro** | Hosting, serverless functions, edge network | **$20.00** | Required for the app to run; Hobby tier would hit function-invocation caps immediately post-launch |
| **Upstash Redis (KV)** | User credits, tiers, cache for eBay/TCG prices, referral state, share links | **$0.00** | Free tier: 10k commands/day, 256MB. Currently well under. Bumps to $0.20/100k commands over free. Pay-as-you-go. |
| **Firebase Auth** | Google sign-in, email verification, token issuance | **$0.00** | Free tier: 50k MAU. Not a concern until real scale. |
| **Resend (email)** | Verification emails, price drop alerts | **$0.00** | Free tier: 3k emails/mo, 100/day. Bumps to $20/mo at 50k emails. |
| **Cloudflare Turnstile** | Anti-bot on signup-bonus claim | **$0.00** | Free tier is generous, no realistic risk of overage |
| **Domain (cardresell.org)** | Registered annually | **$1.25** | ~$15/yr amortized |
| **GitHub** | Repo hosting, secrets scanning | **$0.00** | Free for public/private |
| **Fixed subtotal** | | **~$21.25** | |

## Variable API costs (per-user actions)

These scale with usage. Numbers are per-request; monthly total depends on scan volume.

| API | Action | Cost per call | Notes |
| --- | --- | --- | --- |
| **OpenAI Vision (GPT-4o)** | Quick Grade (1 photo) | ~$0.003 | 1-credit path |
| **OpenAI Vision (GPT-4o)** | Deep Grade fallback (4-6 photos, if Ximilar fails) | ~$0.006-0.012 | Rare path |
| **OpenAI Vision (GPT-4o)** | ID Scan (identification fallback) | ~$0.003 | Ximilar handles most; GPT is fallback |
| **Ximilar Card ID** | Primary ID for Pokémon, sports, etc. | **~$0.00109** | 100 Ximilar credits = $0.109 → $0.00109/scan |
| **Ximilar CV Grader** | Deep Grade centering/corner/edge/surface | ~$0.005-0.01 | 2-credit Deep Grade path |
| **PokémonTCG.io** | Card catalog lookup | $0.00 | Unauthenticated tier: 1000/day. Auth would be 20k/day. Constraint. |
| **TCGplayer via TCGPriceLookup** | Live raw prices | Paid key, cost/lookup unknown | Behind server-side proxy (`CARDSELL_TPL_KEY`). Verify the monthly plan. |
| **eBay sold comps (scraper)** | Sold-listing medians | **$0.00 + broken** | Returns 403 on 100% of calls right now (see audit 2026-08-19) |

### API cost estimates by user scale

Assuming an average user does: **5 ID scans + 1 grade + 3 lookups/month**

| Users active/mo | ID scans (Ximilar) | Grades (Ximilar CV + GPT) | Total variable/mo |
| --- | --- | --- | --- |
| 100 | 500 × $0.00109 = $0.55 | 100 × $0.008 = $0.80 | **~$1.35** |
| 500 | 2,500 × $0.00109 = $2.73 | 500 × $0.008 = $4.00 | **~$6.73** |
| 1,000 | 5,000 × $0.00109 = $5.45 | 1,000 × $0.008 = $8.00 | **~$13.45** |
| 5,000 | 25,000 × $0.00109 = $27.25 | 5,000 × $0.008 = $40.00 | **~$67.25** |
| 10,000 | 50,000 × $0.00109 = $54.50 | 10,000 × $0.008 = $80.00 | **~$134.50** |

**Note:** These are optimistic — assumes Ximilar handles all ID scans (no GPT fallback), free-tier users only scan a few times before hitting credit gates. Real burn will be higher if users grade heavily or if Ximilar falls back to GPT often.

## Total monthly cost by user scale

| Users active/mo | Fixed | Variable | **Total** |
| --- | --- | --- | --- |
| Pre-launch (<50 users) | $21.25 | ~$0.50 | **~$21.75** |
| 100 users | $21.25 | $1.35 | **~$22.60** |
| 500 users | $21.25 | $6.73 | **~$27.98** |
| 1,000 users | $21.25 | $13.45 | **~$34.70** |
| 5,000 users | $21.25 | $67.25 | **~$88.50** |
| 10,000 users | $21.25 | $134.50 | **~$155.75** |

---

## Revenue side — pricing tiers

Based on the current `_tier.js` structure. Values as documented; verify against Stripe dashboard.

| Tier | Monthly | Annual | Grader credits/mo | ID scans/mo |
| --- | --- | --- | --- | --- |
| **Free** | $0 | $0 | 0 (verified email = 1 one-time) | 0 (verified email = 10 one-time) |
| **Pro** | $9.99 | ~$89.99 | 10 | 20 |
| **Pro Max** | $19.99 | $179.99 | ~30 | ~60 |
| **Ultimate** | $39.99 | $359.99 | ~100 | ~200 |

Plus one-off top-ups:
- 5 Grade Scans → $3.99
- 15 Grade Scans → $9.99
- 40 Grade Scans → $19.99
- 10 ID Scans → $1.99
- 40 ID Scans → $6.99
- 80 ID Scans → $11.99

## Break-even analysis

Assume no top-up revenue (conservative). To cover **~$22/mo fixed baseline**:

- **1 Pro subscriber** ($9.99) → **loss of $12/mo**
- **3 Pro subscribers** ($29.97) → **profit of ~$8/mo** *break-even ~3 Pro subs*
- **2 Pro Max subscribers** ($39.98) → **profit of ~$18/mo**
- **1 Ultimate subscriber** ($39.99) → **profit of ~$18/mo**

To cover **$155/mo at 10k active users**:

- **~16 Pro subscribers** = $159.84
- **~5 Ultimate subscribers** = $199.95
- **~10 Pro Max subscribers** = $199.90
- Realistic mix (~2% paid conversion at 10k active) = ~200 paid users → mostly Pro tier = **~$2,000 MRR** vs $155 cost → **very profitable**

**Conversion assumption:** ~1-3% of active users convert to paid on freemium SaaS. Even 1% at 5k users = 50 paid subs ~= $500 MRR against $88/mo cost.

## Current actual state

- **MRR:** $0 (Owner's Ultimate test sub doesn't count)
- **Fixed burn:** ~$21/mo
- **Variable burn:** ~$0-2/mo (pre-launch scale)
- **Net:** **-$21/mo** until first real customer signs up
- **First paying customer** = still ~$11/mo loss (Pro tier)
- **Third paying Pro subscriber** = **break-even**

## Notable financial risks

1. **eBay scraper is broken** — not a cost issue but a churn risk. Users see blank graded prices and leave. Every user we lose is future revenue lost.
2. **PokémonTCG.io unauthenticated tier caps at 1,000/day** — at ~200 users doing 5 lookups/day, we hit the ceiling. Getting `CARDSELL_PTCG_KEY` in env unlocks 20k/day free.
3. **Ximilar credits** — if a user burns through free ID scans and doesn't pay, we still eat the Ximilar cost. Free-tier gating must be tight.
4. **TCGPriceLookup** — the plan cost is unknown to me. Confirm monthly cost in the vendor dashboard; could be a significant fixed line item.
5. **Vercel function invocations** — Pro tier includes 1M/mo. Above that: $0.60/1M. Not a concern until real scale.
6. **Vercel bandwidth** — Pro tier includes 1TB/mo. Card images could burn this fast if we don't optimize. Watch this line.

## Immediate levers to cut costs / add revenue

1. **Add `CARDSELL_PTCG_KEY` to env** — free 20x lift in PokémonTCG.io ceiling
2. **Optimize card image bandwidth** — Vercel image optimization or CDN caching
3. **Fix eBay comps** — churn prevention, no direct cost impact
4. **Enable annual billing prominently** — annual = 2 months upfront cash, less churn
5. **Add a "$4.99 Basic" tier?** — lower entry price, could triple paid conversion
6. **One-off scan pack marketing** — no subscription commitment, users try before subscribing

## What's NOT in this doc (you may want to add)

- **Founder time** (opportunity cost of your hours)
- **Marketing spend** (currently $0, but launch may need it)
- **Legal/accounting** (LLC filing, sales tax nexus if any)
- **Card inventory cost** (if using CardResell for your own reselling)
- **Business bank account fees** (Mercury, Novo, etc. — usually $0/mo)
- **Insurance, phone, other overhead**
