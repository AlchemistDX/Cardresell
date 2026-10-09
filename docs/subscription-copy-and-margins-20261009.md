# Subscription benefits and margin review — 2026-10-09 UTC

## Shipped scope

Subscription modal and /pricing explain who each plan serves and why to move up:
Free explores the tools; Starter covers occasional pickups; Casual expands venue
comparison; Pro adds the full supported comparison set and regular intake capacity;
Business adds volume and the largest pack savings. Monthly allowance differences
in the modal derive from the API catalogue. All plans use the same scanner/grader.
No unsupported storage, automatic listing, priority support, sales or accuracy
promises are advertised. Purchase eligibility, billing controls and pilot restrictions
are preserved. No price, allowance, discount or Stripe product changed.

## Decision

Keep Casual 10%, Pro 15%, Business 25% pack discounts for now. Business currently
includes 750 ID and 100 Grade credits for $49.99/month. The previous assertion
that it is simply the lowest-margin plan was too broad. Its percentage contribution
is lower in the paid overflow scenario, but its dollar contribution is higher.
Actual plan profitability cannot be ranked without reconciled usage/invoices.

The old October 5 model used obsolete model token assumptions and its accompanying
report double-counted the fixed Ximilar subscription and allocated usage. The
October 7 correction is controlling. Old script now warns it is historical.
Run `node tools/unit-economics-current.mjs` for reproducible current scenarios using
canonical launch prices and allowances.

## Assumptions and limitations

Official pricing checked October 9 UTC:
- https://www.ximilar.com/pricing/ : $69/month for 100,000 credits; extra
  100,000-credit pack $99; identification 10 credits; full card grading 100.
- https://stripe.com/pricing : domestic card processing 2.9% + $0.30.
- https://stripe.com/billing/pricing : use 0.7% subscription Billing as planning
  assumption; actual contracted payment fees and add-ons must be reconciled.
- Small historical live OpenAI sample from Oct 7 handoff: Quick ~$0.017,
  Deep ~$0.030. These are estimates from a few runs, not averages or bounds.
- Ximilar grader enabled on Deep only according to existing production handoff.
  Billing dashboard did not reconcile grader usage; budget its listed price.
- Full allowance redeemed, choosing the more costly mix per Grade credit.
  Fees deducted before contribution. Percentage denominator is gross revenue,
  unlike the historical report which used receipts after payment fees.
- Shared $69 subscription is company overhead counted once. Within its remaining
  quota, marginal Ximilar cost is zero. This is not a sustainable unlimited-free
  usage assumption. Non-expiring credits can be used in a later month.
- Overflow scenario values all incremental Ximilar credits at the $99 pack rate
  and assumes two identification calls per operation. Larger packs/plans can
  reduce costs. This is a scenario, not a ceiling on cost.
- Infrastructure, support, taxes, disputes, refunds and AI retries/fallbacks are
  excluded. Thus figures are contribution before fixed/other costs, not profit.

| Paid overflow scenario | Monthly revenue | Full-use variable cost | Contribution | % of revenue |
|---|---:|---:|---:|---:|
| Starter | $4.99 | $0.87 | $3.64 | 73.0% |
| Casual | $9.99 | $2.11 | $7.22 | 72.3% |
| Pro | $19.99 | $7.93 | $11.04 | 55.2% |
| Business | $49.99 | $22.29 | $25.60 | 51.2% |

Inside the remaining shared quota the Business contribution is ~$46.19 before
fixed/other costs. Neither scenario is a claim about actual realized margins.

## Would lower discounts help?

Only additional pack purchases change. Business's included allowance cost stays
the same. Example: 1,000-ID pack, all incremental usage valued at extra-pack rates:

| Business discount | Customer price | After card processing | Contribution, two ID calls per redeemed credit | Same plus hypothetical 30% refunded scan attempts |
|---|---:|---:|---:|---:|
| 25% current | $37.49 | $36.10 | $16.30 | $7.82 |
| 20% option | $39.99 | $38.53 | $18.73 | $10.24 |
| 15% option | $42.49 | $40.96 | $21.16 | $12.67 |

30% is sensitivity analysis, not the observed failure rate; each refunded attempt
is assumed to consume two identification calls and no customer credit. No OpenAI
is used on this ID-only path. Reducing Business 25% to 20% improves this pack by
about $2.43 after processing, before changes in purchase demand. Keep the upgrade
benefit until usage data supports a change. If buffer becomes necessary, evaluate
20% Business while retaining a step above Pro; review existing subscriber terms
and reflect any approved change consistently in catalogue, checkout and copy.
