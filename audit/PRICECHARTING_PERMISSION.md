# PriceCharting — written permission received, and what it obliges us to do

**Status: permission granted in writing, 2026-09-04, by Brady Haugh of
PriceCharting, in reply to the 2026-09-03 request.** Nothing in this document
is deployed or pushed. It records the terms, audits the shipped code against
them, and asks the questions I cannot answer alone.

---

## 1. What we were actually granted

Quoting the reply, so the terms are not paraphrased into something softer:

> "We support this exact use case. Until you reach $1000/mo in revenue you can
> use our Legendary subscription ($50/mo) to access the data via API, provided
> you cite us in your product (either an icon or text with a linkback to our
> product page). Once you hit $1000 we would convert you over to a formal
> Commercial Agreement which users a small revenue share to convert any
> competitive dynamics into symbiotic ones."
>
> "You will indeed have access to SportsCardsPro data and PriceCharting data
> with the one sub."

Four separable things:

| # | Term | Kind |
|---|---|---|
| 1 | Commercial use of the API on the $50/mo Legendary sub is **supported**, not merely tolerated | permission |
| 2 | **We must cite them in the product** — an icon or text, **with a linkback to their product page** | ongoing obligation |
| 3 | Above **$1000/mo revenue**, this arrangement ends and converts to a formal Commercial Agreement with a small revenue share | tripwire |
| 4 | The one subscription covers **both** SportsCardsPro and PriceCharting data | scope, and see §3 |

This closes the standing question about whether the graded-price source could
be used in a paid product. It does not close it permanently — it closes it up
to a revenue number we do not currently measure.

---

## 2. The obligation restated as our own behaviour

Their condition is "cite us in your product." Written that way it is a
sentence about us, which is the form we can actually hold: **every surface that
shows a number derived from their data carries their name and a link back to
them.** That is a rule about our rendering, not a claim about their terms, so
it survives whatever they do next.

Audited against the shipped bundle `js/core.3f83abec.js`:

| Surface | Name shown | Linkback | Verdict |
|---|---|---|---|
| Quick Pricing grade ladder | "PriceCharting guide values" (`js/core.3f83abec.js:4466-4467`) | **only when `ladder.url` exists** — otherwise the same words render as plain text | **gap** |
| Price row caption | "PriceCharting guide value" via `srcMap` (`js/core.3f83abec.js:4937`) | none at this element | **gap** |
| Listing basis label | "PriceCharting guide value" (`js/core.3f83abec.js:2618`, `:2690`) | none | **gap** |
| JP search helper | "PriceCharting JP Search" link (`index.html:2329`) | yes | ok |
| Graded search links | `pricecharting.com/search-products?q=…` | yes, but to a **search URL**, not a product page | see Q2 |

So the name is present in every place I found, and the **linkback is not**. On
their wording the citation is "an icon or text *with* a linkback" — the link is
part of the condition, not a nicety. Three surfaces currently satisfy half of
it.

I have not changed any of this yet. It is a visible product change on surfaces
under review, and §5 has the questions that decide its shape.

---

## 3. A provenance defect this reply exposes

Their sentence "you will have access to SportsCardsPro data **and**
PriceCharting data" confirms the two are distinct datasets under one account.
The server already treats them as distinct and deliberately so:

- `api/pricecharting.js:489` selects host `https://www.sportscardspro.com` for
  sports cards.
- It stamps `source: 'sportscardspro'` vs `'pricecharting'` accordingly
  (`api/pricecharting.js:640`, `:648`, `:696`, `:720`, `:887`), with a comment
  at `:883` recording that "sports values come from the sportscardspro guide".

The display layer then throws that distinction away:

```
pricecharting: 'PriceCharting guide value', sportscardspro: 'PriceCharting guide value'
                                                              ^ js/core.3f83abec.js:4937
```

**A sports-card value fetched from SportsCardsPro is captioned "PriceCharting
guide value."** The number may well be right; the attribution is not. Eight
lines below that map sits a comment recording the same defect being fixed on
2026-09-03 for TCGplayer — "The number was right and the attribution was wrong,
which is the one combination a pricing tool cannot ship: it tells the user to
go verify $161.25 on TCGplayer, where it does not exist." **Correction to my own first pass:** I wrote that this sends the user to the
wrong site. It does not, and I should have checked before saying so. Every
display link is `pricecharting.com/game/<id>`
(`api/pricecharting.js:433`, `:870`, `:891`), and the comment at `:486-487`
records that this path 301-redirects to the correct public page for sports ids
too. The user's verification link lands where it should. What is wrong is
narrower and purely attributional: the caption names the dataset the bytes did
not come from.

**Not established:** whether the two sites publish identical values for the
same item. If they do, the caption is still wrong but harmless to verify
against; if they do not, it is a stamped lie. I did not test it, and I am not
going to assume it either way.

This is now also a **compliance** question, not only an honesty one: if we must
cite the source, we should cite the one the bytes came from.

---

## 4. The $1000/mo tripwire is unmeasured

Term 3 is the one that can hurt us quietly. The arrangement is valid "until you
reach $1000/mo in revenue," and today nothing in the product or the audit trail
watches that line. We would cross it in a good month and only notice when
someone thought to check, which converts a friendly, pre-agreed conversion into
a breach discovered after the fact.

Two things follow, and I have done neither because both are decisions:

- **A measurement.** Monthly recurring revenue against a $1000 threshold, with
  the alert firing *below* the line — at $750, say — so the Commercial
  Agreement conversation starts before the term lapses rather than after.
- **A definition.** "Revenue" is not defined in the reply. Ours is currently
  subscription revenue plus scan credits plus grading checkout; whether their
  $1000 means gross revenue, revenue from card-pricing features, or net of
  Stripe fees changes when the line is crossed by a wide margin.

**Configuration note.** The endpoint reads `PRICECHARTING_API_TOKEN` and
returns `{ source: 'unconfigured' }` when it is unset (`api/pricecharting.js:14-15`,
`:465`, `:500`). The in-code comment says the tier is $49/mo; the reply says
$50/mo — a trivial discrepancy, but the comment is now the stale one. I have
not touched any credential and am not reporting whether the token is set in any
environment; that stays outside this document, and the Cert ID rotation still
gates pushing regardless.

---

## 5. Questions — I need answers before I change any of this

**Q0 — The citation condition is not optional, and his silence is not approval.**
You read the reply as not mentioning our citations. He did mention citation — it
is the one condition attached to the permission: *"provided you cite us in your
product (either an icon or text with a linkback to our product page)."* What he
did not do is inspect our surfaces and pronounce them sufficient. Those are
different things, and the second one is the one we would be relying on. He has
never seen where our labels sit or which of them link. Absence of a complaint
about a thing he could not see is not compliance with the term he wrote down.
The gap in §2 is small and cheap to close; I would rather close it than treat
it as pre-forgiven.

### Owner decision, 2026-09-08

The owner's reading: *"'Cite us in your product' means let people know your
prices come from us, which we do, and once our Stripe revenue is over $1000 we
can email and negotiate a fee."*

**Accepted on the revenue term.** "Revenue" is now defined for our purposes as
**Stripe revenue**, and the plan at the threshold is to email PriceCharting and
negotiate. Recorded as the operating definition. Two residual notes, neither a
disagreement: Stripe revenue is itself two numbers — gross charges or net
payouts after Stripe's fees — and the difference is real money at this scale;
and the term reads "until you reach $1000/mo," so the email needs to go *before*
the line is crossed, not after we notice. That is why §4 wants the alert at
roughly $750. Nothing about the definition changes that.

**One correction on the citation term, then it is yours to call.** The
parenthetical is *"either an icon or text with a linkback to our product
page."* It parses two ways:

- **A.** either [an icon] or [text **with a linkback**] — an icon alone is
  enough; text needs the link.
- **B.** either [an icon] or [text], **with a linkback** — the link is required
  either way.

Our three short surfaces are **unlinked text**. Under reading A they need the
link. Under reading B they need the link. There is no parse of that sentence
under which bare unlinked text is the satisfied form — the only linkless option
he offered was an icon, which we do not currently show. So "we already do this"
is true of the *naming* and not yet true of the *citation as he described it*.

I am not arguing we are in breach of anything he would care about. His name is
visibly on every price surface, the intent of the term is plainly met, and no
reasonable person at PriceCharting would write to complain. I am saying the
cheapest possible version of being unambiguously correct is available, and
below is what it costs.

### Q1 (narrowed) — one small change, yes or no?

Make the source text that already exists into a link. No new UI, no badge, no
second credit line, no visual change beyond the label becoming clickable:

| Surface | Today | After |
|---|---|---|
| Price row caption (`js/core.3f83abec.js:4937`) | text | same text, linked |
| Listing basis label (`js/core.3f83abec.js:2618`, `:2690`) | text | same text, linked |
| Quick Pricing ladder no-url fallback (`:4467`) | text | linked to their canonical page |

That is a small, contained edit to the display layer. It removes the ambiguity
entirely, under either parse, and it needs no reply from Brady. The first two
surfaces already have the card's PriceCharting id available, so the link can be
the specific product page rather than a generic one — which is *better* than the
term asks for.

**Say yes and I will build it into the next slice. Say no and I will record
that the naming-only reading is the decision of record and stop raising it.**
Either answer is fine; what I do not want is for this to sit undecided in a
file while we both assume it is handled.

**Q1 (original) — Where does the linkback go, and how many of them?**
Options: (a) one persistent credit in the footer or an About/Sources panel,
linked, plus the existing unlinked labels left as-is; (b) every source label
becomes a link, so the citation travels with each number; (c) both. (b) is the
strictest reading of "cite us in your product" and the most work; (a) is the
most common industry practice and the least visually noisy. My inclination is
(c) with (b) limited to the price-row caption and the basis label, but this is
your product's visual surface and your relationship with them.

**Q2 — Is a deep search-results link a "linkback to our product page"?**
Ours currently point at `pricecharting.com/search-products?q=…`. That is a link
to their site and arguably better for the user than a homepage. It is not
literally a product page. Do you want me to ask Brady to confirm the search URL
counts, or should the credit link go to a canonical page and the search link
stay separate as a user convenience?

**Q3 — SportsCardsPro: fix the caption, or leave one brand shown?**
Note the wrinkle from the correction above: display links deliberately stay on
`pricecharting.com` because `sportscardspro.com` 403s bots
(`api/pricecharting.js:486-487`). So captioning sports values
"SportsCardsPro" while linking to pricecharting.com would trade one mismatch
for another, and linking to sportscardspro.com directly may be blocked. The
honest form may be naming both — "PriceCharting / SportsCardsPro guide value" —
which is also the form their own email uses.
Fixing the caption is a small, safe change: sports values say "SportsCardsPro
guide value" and link to sportscardspro.com. But if the two sites do publish
the same numbers, you may prefer one brand shown consistently — in which case
the honest form is naming both, not silently picking one. Which do you want,
and do you want me to check whether the values actually differ before deciding?

**Q4 — Does the icon option interest you?** They explicitly allow "an icon."
If PriceCharting has a supplied logo/badge asset, an icon credit is smaller and
cleaner than a text line on dense surfaces. I would need the asset from them —
we should not draw our own version of someone's mark.

**Q5 — Who watches the $1000 line, and what counts?** See §4. I can build the
measurement, but the revenue definition and the alert threshold are yours, and
it is worth asking Brady what he means by revenue rather than guessing and
being wrong in the generous direction.

**Q6 — Should this reply be kept somewhere durable?** Right now the terms exist
in a screenshot of a phone and in this file. A permission that gates commercial
use of a core data source should not depend on an inbox surviving. I would keep
the full text in `audit/` — this document is that, minus the headers. Confirm
that is enough, or say where you want the original.

---

## 6. What this does not resolve

- It says nothing about TCGplayer, Scryfall, YGOProDeck, TCGPriceLookup or eBay
  data. Each has its own terms and none of them were addressed by this reply.
- It is not a signed agreement. It is an email from a person who speaks for the
  company, which is materially better than nothing and materially less than the
  Commercial Agreement they describe. Above $1000/mo we need the real thing.
- Nothing here is built, changed, pushed or deployed. The photo-UI slice
  (`671dc8e`) remains the last commit, and push and deploy stay blocked.
