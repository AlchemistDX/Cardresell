# cardresell.org — UX / Product Audit

**Date:** July 1, 2026  ·  **Scope:** Public site, logged-out flows, mobile + desktop

## Overall verdict

The core value prop — net payout after all platform fees — is genuinely differentiated and worth building around. Execution around it is rough: several critical flows fail silently, the credits model is unexplained, and the site has no trust signals (no About, Contact, Terms, or Privacy Policy). A first-time visitor will likely bounce within 30 seconds.

## Top 5 strengths

1. **Net-payout-after-fees is the killer feature** — real utility, hard to find elsewhere
2. **Search autocomplete is fast** — inline images + prices, best part of the app
3. **eBay fee breakdown is honest and transparent** — builds trust
4. **Multi-TCG support** (Pokémon EN/JP, Magic, Yu-Gi-Oh, Sports) is a real differentiator
5. **"Try an example" button** kills blank-state paralysis

## Top 10 issues (see GitHub issues for full acceptance criteria)

| # | Severity | Issue | GH# |
|---|---|---|---|
| 1 | critical | Search results tile is broken | [#1](../../issues/1) |
| 2 | critical | "Charizard ex" search returns generic error | [#2](../../issues/2) |
| 3 | critical | Scan button silently does nothing for logged-out users | [#3](../../issues/3) |
| 4 | critical | Grade button needs a teaser modal, not a disappearing toast | [#4](../../issues/4) |
| 5 | critical | Credits system is unexplained | [#5](../../issues/5) |
| 6 | major | No About / Contact / ToS / Privacy | [#6](../../issues/6) |
| 7 | major | Negative eBay payout has no context | [#7](../../issues/7) |
| 8 | major | Blurred Pro upsell is a dark pattern | [#8](../../issues/8) |
| 9 | major | "My Flips" is jargon with no value prop | [#9](../../issues/9) |
| 10 | minor | "Tap to sell here" is ambiguous | [#10](../../issues/10) |

## Quick wins (ship this week)

- Fix search result tiles (Collectr-style layout) — #1
- Real error handling on failed searches — #2
- Persistent modals instead of disappearing toasts — #3, #4
- Rename "My Flips" → "Sales Tracker" — #9
- Rename "scans" → "card lookups" everywhere — #5
- Add footer with About/Contact/Terms/Privacy stubs — #6
- Add "Best platform" green highlight — #7
- Unblur one platform in Pro section — #8

## Bigger structural issues

1. **Credits model is opaque** — no explanation of what a scan is, how many free, why bulk is cheaper
2. **Pro subscription is poorly positioned** — no dedicated pricing page, no feature comparison, no trial
3. **Mobile layout is untested** — two-column card detail will collapse badly on mobile
4. **Branding is weak** — no tagline, no hero, no social proof
5. **No onboarding flow** — new users land on a blank search bar
6. **Grade Scan is a black box** — no explanation of how it works before login gate

See [`grade-scan-promotion-spec.md`](./grade-scan-promotion-spec.md) for the Grade Scan repositioning plan.
