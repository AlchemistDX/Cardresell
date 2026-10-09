# Pokémon API and advertising follow-up — October 9, 2026

## Release changes

Homepage search/social descriptions now describe estimated payouts, clearly identify the Free comparison venues (eBay and TCGplayer), and distinguish paid-plan venues/credits. Pricing social descriptions disclose pilot-only purchasing. The regenerated social image labels estimated outcomes and the two free venues, with a new cache version on the homepage/pricing previews. No prices, allowances, admission settings or paid campaigns changed.

Browser fallback requests now have an eight-second budget covering both response headers and JSON body reading. Caller cancellation remains respected and timers/listeners are cleaned up. Scanned Pokémon enrichment shares one eight-second legacy-provider budget across exact-ID and subsequent search requests, then continues to the existing alternatives. Network failure, throttling or server errors stop repeated legacy queries. This bounds the legacy portion, not the entire multi-provider scan/search. Existing card identity and pricing admission rules remain unchanged.

## Verified provider facts

- The Pokémon TCG API is deprecated; existing keys continue through March 1, 2027. Its documentation directs migration to Scrydex: https://docs.pokemontcg.io/.
- Scrydex says old IDs remain compatible, but its schema differs: https://scrydex.com/faq.
- Authentication requires a plan, team ID and API key; requests carry X-Api-Key and X-Team-ID. Secrets must remain server-side: https://scrydex.com/docs/getting-started/authentication.
- Published monthly prices checked today: Starter $29/5,000 credits plus $0.006 overage; Growth $99/50,000 plus $0.002; Professional $399/250,000 plus $0.0016. https://scrydex.com/pricing.
- A general lookup costs one provider credit; multiple lookups, pages and retries can consume more than one per user scan. Vision costs five. The credits guide's general statement and its price-history example differ, so confirm price-history billing before enabling that endpoint: https://scrydex.com/docs/getting-started/api-credits.
- Card images are an array, set becomes expansion, and variants contain prices. Search pages are at most 100 versus existing requests for 250. Prices require include=prices: https://scrydex.com/docs/pokemon/cards.
- The FAQ says graded prices require Growth/Professional; pricing-page text extraction does not reliably preserve feature-inclusion icons. Confirm plan entitlement before purchasing or marketing graded-price support. https://scrydex.com/faq.

## Live check and configuration limits

Two public legacy API lookups and one image request received HTTP 403 from this execution environment. The inspected response reports Cloudflare error 1010. This is a blocked probe, not proof that the provider is unavailable to CardResell users. Do not bypass the block or claim retirement has already occurred.

A non-decrypting project-configuration listing returned 93 entries but no visible Scrydex/Pokémon/TCG-named variables. The endpoint can hide production variables, so this does not establish absence of credentials or absence of an account. No secrets were retrieved, no account was created, and no subscription or provider change was activated.

## Concrete migration work remaining

1. Confirm an existing Scrydex account/plan and usable server-side credentials, or choose a paid plan after reviewing expected request volume. Do not put keys in chat or browser settings.
2. Build a same-origin provider adapter with explicit feature enablement, authenticated request admission, usage limits and request coalescing/cache. Avoid moving the current browser query volume directly into uncapped paid calls.
3. Normalize expansion/collector-number/language/image fields, retain canonical IDs and finish distinctions, and map source/condition/currency/date for prices. Never treat a blended market index as guaranteed TCGplayer sold comps. Do not flatten graded prices into raw prices.
4. Replace dependencies in browser search, Japanese image reference, exact scanned-card lookup, bulk/collection enrichment and server grounding. Handle 100-card pagination explicitly. Audit image CDN and price redirect dependencies separately; API retirement does not itself establish the image/redirect shutdown date.
5. Test exact printing, collector suffixes, regional cards, missing prices, throttling, depleted credits, timeouts and rollback before enabling the paid provider. Keep local identity fallback and existing exact-printing checks.

## Advertising release

The current release corrects preview claims and reduces the chance that a new visitor waits indefinitely for an unresponsive provider. Continue measuring verified onboarding → first successful ID → checkout → fulfilled purchase, plus refunds and provider cost. Public admission and paid advertising still require the existing phone-camera and live-fallback acceptance. See product-readiness-20261009.md for the full feature state.

No migration-complete, accuracy-percentage or advertising-ready claim is made.

## Verification

Provider-outage checks: 21 passing, including real HTTP stalls before headers and during JSON-body transfer, caller cancellation, correct identities and local fallback. Catalog search: 24 passing. Existing browser outcome suite: 150 passing. Copy truth: 224 passing. Asset fingerprints: 107 passing. Ten inline script blocks parsed with zero errors. Release inspector and diff checks passed. The 1200×630 social preview was rendered from its HTML source and visually reviewed. No paid provider calls or customer credit changes.
