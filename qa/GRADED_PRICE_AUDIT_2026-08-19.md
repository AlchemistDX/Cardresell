# Graded Price Audit — 2026-08-19

## TL;DR

**The graded price system isn't returning wrong prices. It's returning no prices.**

All 70 calls across 5 cards × 14 grade combos came back with `count: 0`, `median: null`, `confidence: "insufficient"`. The endpoint itself is up (HTTP 200 in every case). But every single call surfaces this error in the body:

```json
"error": "eBay search returned 403"
```

**eBay is 403-blocking every request from our Vercel datacenter IPs.** The UA rotation in `/api/ebay-sold.js` (lines 229-234) is not defeating whatever detection eBay is using — likely IP-based or TLS-fingerprint-based, neither of which UA rotation fixes.

## Audit setup

- 5 cards: Charizard Base Set, Pikachu Illustrator, Umbreon VMAX Alt Art, MJ 1986 Fleer, Mew ex 232
- 14 grade combos per card: raw, PSA 10/9/8/7/5, BGS 10/9.5/9, CGC 10/9.5/9, SGC 10/9
- 70 total calls, 1.2s pacing
- Endpoint: `https://www.cardresell.org/api/ebay-sold`

## Findings

| Metric                  | Value        |
| ----------------------- | ------------ |
| Calls made              | 70           |
| HTTP success (200)      | 70/70        |
| Comps returned          | 0/70         |
| Median returned         | 0/70         |
| eBay 403s               | 70/70        |
| Cache hits              | 0/70         |
| Non-403 errors          | 0            |

**Every call fails identically.** This is not intermittent — this is total.

## Why the current code fails

Our endpoint parses eBay's public search HTML. That approach has three fatal weaknesses:

1. **Datacenter IP blocklists** — eBay maintains a known list of AWS/Vercel/GCP egress ranges. UA rotation does nothing against IP-level bans.
2. **TLS fingerprint (JA3)** — even with a browser UA, Node's HTTPS TLS handshake looks different from Chrome's. eBay's anti-bot layer (Akamai/Kasada) fingerprints this.
3. **Rate limiting on shared IPs** — Vercel's egress IPs are shared across tenants. Someone else's abuse gets us blocked.

**Cache is empty because the endpoint has been failing long enough that no successful response was ever stored.** Users hitting the app right now see either blank prices or "insufficient comps" for every graded card.

## What this means for the app

Every "AI grading is a big point for us" claim is undermined by this. The workflow currently looks like:

1. User scans card → we identify it (works)
2. User picks PSA + grade → we call `/api/ebay-sold` (fails silently)
3. UI shows blank / insufficient / stale-if-lucky prices
4. Deep Grade recommendation ("Worth grading? Payout $X after fees") has nothing to base $X on

The Grading ROI framework in `memory/knowledge/concepts/card-grading-roi.md` requires reliable graded comp prices. Right now that input is 0-for-70.

## The fix — pick one

### Option A: eBay Browse API via OAuth (correct fix, 2–4 hours)

Already documented in `EBAY_OAUTH_TICKET.md`. This is what the endpoint should have been doing from day one.

- Register an eBay developer app
- Implement OAuth 2.0 client credentials flow (application token, not user token)
- Call `https://api.ebay.com/buy/browse/v1/item_summary/search` with `filter=soldItems`
- eBay's official API — no scraping, no 403, no IP bans

Cost: free up to 5,000 calls/day for prod. Zero infrastructure change.

### Option B: PriceCharting API (fastest fix, ~30 min)

- PriceCharting has graded price data for Pokemon, sports, and Magic
- Public API, JSON response, $10/mo tier or free with attribution
- Doesn't cover every card eBay does, but covers 95% of what users actually grade

### Option C: Residential proxy for the existing scraper (bandaid, ~1 hour)

- Route requests through a residential IP pool (Bright Data, Smartproxy)
- Solves the 403 but adds ~$50–200/mo depending on volume
- Still fragile — eBay can add new detection any day

### Option D: PSA Auction Prices Realized (PSA-only, ~2 hours)

- PSA's official API, covers PSA-graded sales specifically
- Very reliable for the PSA slice (~70% of graded card volume)
- Won't cover BGS/CGC/SGC/raw — would need a fallback

## Recommendation

**Do B first as an emergency stopgop, then A as the real fix.**

- Ship PriceCharting integration today so graded prices actually show up
- Wire the eBay Browse API this week as primary path, PriceCharting as fallback
- Delete the HTML-parsing code — it's causing more confusion than it's worth

The audit script (`qa/graded_price_audit.js`) is reusable — after the fix ships, re-run it and the failure count should go to ~0.

## Raw data

- `qa/graded_price_audit_raw.json` — full response per combo (70 records)
- `qa/graded_price_audit_run.log` — console output from the run

## What we CAN'T verify from this audit

- Whether returned medians are "correct" (no cases where we got any data)
- Whether the grade-filter regex actually rejects wrong grades (no items came back to filter)
- Whether confidence scoring is calibrated (all confidence = "insufficient", not by choice)
- Whether cache TTL is appropriate (cache never populated)

All of those checks become possible once the data path actually works.
