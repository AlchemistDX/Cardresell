# Tax-audit source provenance and excerpts

Supports the venue tax classifications in `audit/d3/TAX_TREATMENT_T2_9.md`.

## Why this file replaced the full captures

An earlier revision committed complete text captures of all 25 external
pages (2.45 MB). That was removed before any push, on review: full vendor pages
carry copyright exposure, repository weight and a maintenance burden, and
they preserve large amounts of page content unrelated to any fee finding.

What is retained here is what reproducing a classification actually needs:
the source URL, the retrieval timestamp, the SHA-256 and byte count of the
original capture, and the smallest excerpt that carries the fee-base or tax
statement. Scripts, navigation and unrelated policy sections are gone.

**Final redirected URL: `Unverified` for every row.** The captures were
taken without recording the post-redirect URL and it cannot be recovered
from the stored bytes. Re-fetching today would record today's redirect, not
the one that applied at capture time, so the field is left unestablished
rather than backfilled.

Line numbers below are positions in the **original** capture, so existing
citations such as `tcgplayer.txt:9` and `tcgbulk.txt:117` still resolve
against the hash recorded for that file.

Lines cited by number in an audit document are **pinned**: they appear in
full, never truncated and never dropped by the cap, so this reduction cannot
silently break an existing citation.

Excerpt selection is otherwise mechanical (`tools/reduce-captures.py`): lines matching a
fee/tax keyword set, minus navigation boilerplate, capped at 14 lines or
1400 characters per page. It is a **filter, not a summary** — every line is
verbatim from the capture. Where a classification depends on a sentence the
filter did not reach, the quote is in `TAX_TREATMENT_T2_9.md` with its URL.


---


## `cardkingdom.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://www.cardkingdom.com/purchasing/how_to_sell> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:40:53Z |
| Original capture SHA-256 | `f1d77176d4cbc77d9a4ab0794ef85785a3d640ecb53cd0796e5ef93b3133befd` |
| Original capture bytes | 14,484 |

Excerpt (line numbers from the original capture):

```
43: Receiving and processing your sell orders effectively is an important part of our commitment to you. We're unable to support infrastructure for DDU shipments and cannot cover the associated costs. Using DDP helps us maintain the high level of service and seller experience you expect.
147: Payments for cards are done by a percentage system based on the NM buy price for a card. You will see the NM
148: buy price for a card listed when you are adding cards onto your sell order. Depending on the price of the
149: card and what edition the card is from, we will pay a certain percentage of the base NM buy price for the
161: For example, if you had an Amonkhet card that had a base buy price with us of $25, but it was graded down to
162: EX, we would pay $21.25 for the card, or 85%. If you had an Alpha card with a base buy price of $25 and it
```


## `cardmarket.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://www.cardmarket.com/en/Policies/Fees> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:39:20Z |
| Original capture SHA-256 | `b08a89632af01d17323dbf362c7ab913ec0dc7b5371a6d3765e70115e7aedca3` |
| Original capture bytes | 912 |

Excerpt (line numbers from the original capture):

```
26: of the order's total article value (depending on the selected shipping method) 2, 3
29: of the article value per article sold 2, 3, 4
32: All prices are inclusive of VAT.
33: - 1 There can be additional fees taken by your bank or payment service provider we have no influence on.
34: - 2 All fees are rounded up to the next higher Euro cent. That means that at least fees of 0,01 € apply.
35: - 3 Professional sellers from EU countries outside Germany with a valid EU VAT ID do not pay VAT.
36: - 4 Maximum transaction fee of 100€/£ per article.
```


## `cardnexus.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://help.cardnexus.com/articles/9938652-fee-structure-overview> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:39:21Z |
| Original capture SHA-256 | `9bcfe7c5ad7b0a337daef058970de3e42cef244479b47486c9cf2b2f778ff268` |
| Original capture bytes | 3,207 |

Excerpt (line numbers from the original capture):

```
3: Every time you check out, a service fee is added on top of your cart total:
17: The fee is calculated on your entire cart (items + shipping) and applied **once per checkout**, regardless of how many sellers are in your cart. The fixed portion varies by currency to reflect approximately the same value (~€0.30 equivalent).
19: **Example:** You buy cards from two EU sellers for a total of €88 (including shipping). Your buyer fee is (€88 × 2.5%) + €0.30 = **€2.50**. You pay **€90.50** at checkout.
21: If you pay with your **seller balance**, a different fee applies: a flat **1%**, with no fixed fee.
23: The buyer fee is always shown clearly before you confirm your payment — no surprises.
27: Sellers pay a commission on each order they fulfill:
29: |**Region**|**Commission**|
31: |**Europe**|5% of order total|
32: |**North America**|8% of order total|
34: The "order total" includes the item subtotal and the shipping cost. The commission is deducted automatically from your payout — you never have to pay it upfront.
36: **Example:** A buyer purchases €55 worth of cards from you with €5 shipping (€60 total). Your seller fee is €60 × 5% = **€3.00**. You receive **€57.00**.
38: If a buyer uses a promo code, the discount is absorbed by CardNexus — not by you. You always receive the full sale amount minus your commission.
40: ## Why Are NA Fees Higher Than EU?
42: North American transactions have higher payment processing costs and tax compliance requirements. The 8% rate reflects these additional operational costs. We're actively working to bring this down as volume grows.
```


## `cardnexus_faq.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://help.cardnexus.com/articles/1754380-selling-faq> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:40:53Z |
| Original capture SHA-256 | `4731f09613356f2eba0c295263a165d31caffb09aed0af516cf41c48a8b52a28` |
| Original capture bytes | 4,563 |

Excerpt (line numbers from the original capture):

```
11: ## What fees do I pay as a seller?
13: Sellers pay a commission on each order they fulfill: **5% in Europe** and **8% in North America**. The fee is calculated on the order total (items + shipping) and deducted automatically from your payout — you never pay it upfront. If a buyer uses a promo code, CardNexus absorbs the discount — your payout is never af...
```


## `cardsphere.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://www.cardsphere.com/terms> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:39:18Z |
| Original capture SHA-256 | `9e8ad8af8e5cf0f1419e847993f00e8832c2674713eb66854a5dfb7e65440553` |
| Original capture bytes | 49,626 |

Excerpt (line numbers from the original capture):

```
53: Users who have been banned are not allowed to create new accounts or continue to access Cardsphere by any other means. Subsequent or additional accounts of banned users will be immediately closed upon detection, and a processing fee of up to $100.00 USD will be taken from the account balance to cover the administrat...
112: The card will be charged in USD (United States Dollars), any fees related to currency conversion will be borne by the payment card holder.
114: Any additional fees charged by the payment card company will be borne by the payment card holder.
116: Any fees associated with the processing of the payment card transaction are borne by Cardsphere.
126: The account will be charged in USD (United States Dollars), any fees related to currency conversion will be borne by the payment card holder.
128: Any additional fees charged by PayPal will be borne by the payment account holder.
130: Any fees associated with the processing of the PayPal transaction are borne by Cardsphere.
142: There are processing fees associated with each of the refund methods, borne by you.
166: Cardsphere will withhold a processing fee from the amount of Stored Value to be refunded in the amount of the greatest of:
191: You are responsible for any fees and charges applied by PayPal associated with this transaction (e.g. merchant fees).
193: Cardsphere will withhold a processing fee from the amount of Stored Value to be refunded in the amount of the greatest of:
```


## `comc.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://comc.zendesk.com/hc/en-us/articles/360053737993-What-are-the-commission-fees> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:39:17Z |
| Original capture SHA-256 | `e93aecab931e4a56f80b10c08dfac717663a5b92388f14e502e67b1eab0dab56` |
| Original capture bytes | 1,317 |

Excerpt (line numbers from the original capture):

```
13: When you click on links to various merchants on this site and make a purchase, this can result in this site earning a commission.
```


## `comc2.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://comc.zendesk.com/hc/en-us/articles/360053737993-What-are-the-commission-fees> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:40:43Z |
| Original capture SHA-256 | `97ddb8f019652b03e6e05a8e7846ee0009c79d09e7fcfad0cd96e9e71d9f6e9c` |
| Original capture bytes | 936 |

Excerpt (line numbers from the original capture):

```
1: The following are the different types of Commission Fees for utilizing COMC:
3: **Transaction Fee:** Fixed-price sales, whether sold on the COMC platform or via eBay have a flat 5% transaction fee of the item's sale price. The transaction fee is charged when the card is sold. Auction sale transaction fees are slightly lower. Please review our Auction page here for more information.
5: **Cash-out Fee:** To withdraw proceeds from sales, or withdraw credit deposited into your COMC account, there is a 10% Cash-Out fee. This fee percentage may be slightly higher for international users. Additionally, if the funds are request as a check rather than PayPal deposit, there is a small check fee. Learn more...
7: We have a more comprehensive list of our fees found here. This page includes submission selling rates, storage fees and seller fees.
```


## `coolstuffinc.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://www.coolstuffinc.com/main_fullservice_selllist.php> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:39:20Z |
| Original capture SHA-256 | `84d17003285b861743616fd75df2ef01d632025fd056a8a29ad0e591952aba5d` |
| Original capture bytes | 4,156 |

Excerpt (line numbers from the original capture):

```
11: Orders under 1,000 cards typically processed within 7 business days from the date Received. Larger orders may require additional processing time.
19: We’re proud to be the only company in the industry with **no fees on any collections** – big or small. That means you get full value for your cards, with no deductions.
23: Every day, we receive singles sell orders that were damaged in transit due to poor packing practices, or orders that are unorganized, leading to delays. Be sure to watch this video to see how to keep your singles safe and organized for quick processing!
51: ### How does the service fee work?
53: We’re thrilled to offer our Full Service Selling with no service fees on any collection, big or small. This means you receive the full value for your cards without any deductions, making us the only company in the industry offering this exceptional benefit!
63: ### How long does the processing take?
65: Orders containing 1,000 cards or fewer are typically processed within 7 business days from the date they are marked as Received at our Maitland location. Larger orders may take additional processing time, usually ranging from 2 to 10 additional business days. If you drop off your cards at one of our remote store loc...
71: Once processing has started, **returns are not possible**. All submissions are considered final once they’ve been received.
77: We use the CoolStuffInc Sell List for all pricing in our Full Service Selling program. This includes pricing for individual cards as well as bulk pricing. All offers are based on the current rates in our official Sell List at the time of processing.
```


## `ebay.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:39:17Z |
| Original capture SHA-256 | `f6d4c870a38e164a97116c4f1c721ecd83779272a8450a3f0abb521e6d89a45f` |
| Original capture bytes | 18,189 |

Excerpt (line numbers from the original capture):

```
5: - Basic fees for most categories
7: - Fees for Real Estate listings
9: - Fees for optional listing upgrades
11: - Additional final value fees
19: - Examples of fee calculations
23: We charge two main types of selling fees: an insertion fee when you create a listing, and a final value fee when your item sells.
27: Do you have an eBay Store or want to sell vehicles? Fees are different for Store subscribers and for selling vehicles.
33: Every month, you get up to 250 zero insertion fee listings, or more if you have an eBay Store. Learn more about how zero insertion fee listings work, including the terms and exclusions for those listings.
35: After you've used your zero insertion fee allowance, insertion fees are:
39: - Charged per listing and per category. So, if you list your item in two categories, you'll pay an insertion fee for the second category too
49: Good 'Til Cancelled listings are fixed price listings that renew automatically once per calendar month. We charge an insertion fee and applicable optional listing upgrade fees when you list your item for the first time, and each time it renews. These listings count towards your monthly zero insertion fee listings. F...
53: We charge one final value fee when your item sells, and you don't have to worry about third-party payment processing fees. This fee is calculated as a percentage of the total amount of the sale, plus a per order fee. For orders $10.00 or less the per order fee is $0.30, for orders over $10.00 the per order fee is $0...
```


## `fanatics.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://support.fanaticscollect.com/en_us/buy-now-fees-ry33QCXaxe> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:39:18Z |
| Original capture SHA-256 | `97aa27a85f86f3e6b71ad2fe0d50ae52eb5299a60c6c27f99e5e9d3d023c770d` |
| Original capture bytes | 1,780 |

Excerpt (line numbers from the original capture):

```
23: There are no fees for purchasing in the Buy Now Marketplace — the price you see is the price you pay.
25: **Note:** A fulfillment fee applies if you choose to have your item shipped. Keeping it in your Fanatics Collect vault is free.
29: The Buy Now Marketplace uses a simplified seller fee model:
31: - Listings priced at less than 120% of market value (as provided by Card Ladder) are charged a 6% seller fee
32: - Listings priced at or above 120% of market value incur a 12% seller fee
34: There is no minimum fee, and 6% is one of the lowest rates in the industry.
38: If your listing is priced above the Great Price threshold but you accept an offer within that threshold, the lower 6% seller fee will apply. This fee is based on the final sale price, not the original listing price.
42: There are no buyer’s premiums or bonus commissions on purchases or sales.
```


## `fanatics_sell.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://support.fanaticscollect.com/en_us/selling-on-fanatics-collect-Byq2QAQpel> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:40:43Z |
| Original capture SHA-256 | `6046a8a404e21923889a1ada63493c35a6e4aab1f766d9e7755b39cf924f0d2f` |
| Original capture bytes | 16,042 |

Excerpt (line numbers from the original capture):

```
12: Fanatics Collect connects buyers and sellers of trading cards and memorabilia around the world through fixed-price listings and auctions. Our comprehensive range of services, expert customer service, and auctions and Buy Now marketplace that host tens of thousands of listings spanning common collection builders to s...
38: ## What are the seller fees for Fanatics Collect?
40: There are no fees to sell graded collectibles in Weekly or Premier Auctions. All eligible auction sales earn bonus commission outlined in our How it Works page here.
42: The Buy Now marketplace features a seller’s fee that’s a percentage of the sale price of your listing. The fees are as follows:
44: All cards listed less than 120% of the market value provided by Card Ladder have a seller’s fee of just 6% – one of the lowest rates in the industry.
46: If you wish to sell raw or ungraded collectibles, you can use our grading and authentication partners to access partnership pricing and preferred rates and a streamlined path from raw to graded and on the market. Grading fees can be found on our submission form. Select Non-Authenticated (Raw) Trading Cards to get st...
48: All collectibles valued at less than $50 curated into the Fanatics Collect Vault and not submitted to auction or sold within 30 days incur a one-time $3 fee. A full summary of costs associated with vaulting your collectibles can be found here.
52: Within two days of receiving your submission, we mark it as received on your account and send you an email notification. When we begin processing your submission, including imaging, titling, and prepping for sale, we mark your items as processing. You can see this status in your Member Dashboard and on the mobile ap...
```


## `https_poshmark_com_terms.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://poshmark.com/terms> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:41:26Z |
| Original capture SHA-256 | `e858229899a199d69a0900c3035be0887eb5e4ab61351f789fc0aef02168ae52` |
| Original capture bytes | 1,192,399 |

Excerpt (line numbers from the original capture):

```
88: - create any derivative works of, modify, or reverse engineer any part of the Service;
105: **c. Share Your Thoughts and Ideas** We appreciate your thoughts and ideas. You acknowledge and agree that any comments, suggestions, ideas, feedback, or other information about the Service (“
107: **Feedback**”), provided by you to Poshmark will not be confidential or proprietary, and Poshmark shall be entitled to the unrestricted use and dissemination of the Feedback for any purpose, commercial or otherwise, without acknowledgment or compensation to you.
111: *You can access the Service through a mobile device, but you will be responsible for any associated fees from your wireless provider. If you use any third-party software, including Apple software, in connection with the Service, then you must comply with such third party’s terms and conditions.*
113: **a. Your Responsibility for Mobile Fees and Costs** When you access the Service through a mobile device, you may incur a fee for data usage or other associated costs from your wireless provider. You are solely responsible for such fees and will be solely responsible for your use of the Service on your mobile device...
129: **b. You License Your Content to Us** By Posting any User Content, you hereby represent and warrant that you have sufficient rights in the User Content to grant us the below license. By Posting any User Content, you hereby grant to Poshmark and its affiliated companies a nonexclusive, worldwide, royalty free, fully ...
```


## `m_2024_10_21_returning_to_original_fees_.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://blog.poshmark.com/2024/10/21/returning-to-original-fees/> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:41:27Z |
| Original capture SHA-256 | `effc403893bd223db6cb5adba6a9dde486bb8113a64733ad133efeff88a26e5b` |
| Original capture bytes | 4,806 |

Excerpt (line numbers from the original capture):

```
5: *Together we Grow*, and every decision we make is guided by our deep commitment to you, our community. In this spirit, **we have decided to revert to our original fee structure effective October 24, 2024. **
7: We made the recent fee change with the goal of helping you, our sellers, grow and earn more by balancing fees between sellers and shoppers. However, over the past few weeks we have seen that shoppers spent less on purchases as they shifted their spending from orders to fees, leaving our sellers with less cash in the...
9: **Here’s what we’re doing to make it right: ** **We’re reverting to the original seller fee structure**: Effective October 24, 2024*, we’re returning to the original fee structure of 20% seller fee for sales over $15 and $2.95 for sales $15 and under. **We’re removing the Buyer Protection Fee:**Shoppers will still r...
11: We hope this decision reflects our commitment to listening and evolving based on your feedback. We are dedicated to making this platform work for you and encourage you to share your thoughts here. Your voice helps us continue to build a marketplace and community where anyone can thrive.
17: *By continuing to use Poshmark after 10/24/2024 (including by continuing to maintain listings on Poshmark), you agree to the above updates to our Fee Policy regarding the reversion to our original seller fee structure and removal of the Buyer Protection Fee.
19: **For any listing created or edited between 12:00 AM PT 10/3/2024 and 11:59 PM PT 10/23/2024 that was sold via a Buy Now order between 12:00 AM PT 10/24/2024 and 11:59 PM PT 10/27/2024, the seller will be rebated the seller fee difference if the new seller fee is higher. The rebate will be provided as redeemable cre...
```


## `manapool.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://support.manapool.com/hc/en-us/articles/21779686206615-Fees-Mana-Pool-and-Credit-Card-Fees> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:39:18Z |
| Original capture SHA-256 | `70cc4a5095e70fca87b27133796949aef1927b46d206d8631c3fa558121b604a` |
| Original capture bytes | 544 |

Excerpt (line numbers from the original capture):

```
1: The fees on the site are:
7: - The Mana Pool marketplace fee is 5% of the price of the merchandise
9: - the fee is not applied to shipping charges, only the price of the product
15: - We charge Stripe's credit card fees (2.9% + 30 cents as of 12-7-23).
```


## `mercari.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://www.mercari.com/us/help_center/article/169/> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:40:43Z |
| Original capture SHA-256 | `e8468fcd8361667d7f2b27d201c0fdf1058b52ffca3c35361d9ba8419217e469` |
| Original capture bytes | 14,533 |

Excerpt (line numbers from the original capture):

```
1: Listing an item is always free on Mercari. Fees are charged when an item sells or when a service is used. The
2: following charts explain fees on Mercari.
5: Starting January 6, 2025, a Buyer Protection fee of 3.6% will apply to the item price and buyer-paid shipping for new and updated listings. When you make a purchase, a service fee will be charged. An additional payment processing fee will not apply. The amount of the fee will be displayed as part of the final price ...
11: 3.6% Item Price + buyer-paid Shipping
14: A 10% buyer fee will apply to the buyer until the listing is updated.
17: 3.6% of the item price + buyer-paid shipping
20: A Buyer Protection fee of 3.6% of the combined amount of item price and buyer-paid shipping will be charged to the buyer.
26: Effective January 6, 2025, a 10% selling fee will apply to item price and buyer-paid shipping for new and updated listings.
28: Note: Existing listings created before January 6, 2025 will be updated automatically within a week. The new fee structure will also apply when you update an existing listing.
33: 10% of the item price + buyer-paid shipping
36: A selling fee will not be applied until the listing is updated.
39: 10% of the item price + buyer-paid shipping
42: A 10% selling fee of the combined amount of item price and buyer-paid shipping will be charged to the seller.
46: ### Transaction and Payment Fees
```


## `poshmark.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://poshmark.com/terms> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:40:43Z |
| Original capture SHA-256 | `fc6e0aba173db33560de65fda803ffeb4384cd06705f2f3a32e5053c52a85b42` |
| Original capture bytes | 271 |

No line in this capture matched the fee/tax keyword set. The page was
retrieved and searched; the classification that cites it rests on the
**absence** of a fee-base statement, which is recorded in
`TAX_TREATMENT_T2_9.md` rather than quoted here.


## `poshmark_feepolicy.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://poshmark.com/fee_policy> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:44:11Z |
| Original capture SHA-256 | `e858229899a199d69a0900c3035be0887eb5e4ab61351f789fc0aef02168ae52` |
| Original capture bytes | 1,192,399 |

Excerpt (line numbers from the original capture):

```
88: - create any derivative works of, modify, or reverse engineer any part of the Service;
105: **c. Share Your Thoughts and Ideas** We appreciate your thoughts and ideas. You acknowledge and agree that any comments, suggestions, ideas, feedback, or other information about the Service (“
107: **Feedback**”), provided by you to Poshmark will not be confidential or proprietary, and Poshmark shall be entitled to the unrestricted use and dissemination of the Feedback for any purpose, commercial or otherwise, without acknowledgment or compensation to you.
111: *You can access the Service through a mobile device, but you will be responsible for any associated fees from your wireless provider. If you use any third-party software, including Apple software, in connection with the Service, then you must comply with such third party’s terms and conditions.*
113: **a. Your Responsibility for Mobile Fees and Costs** When you access the Service through a mobile device, you may incur a fee for data usage or other associated costs from your wireless provider. You are solely responsible for such fees and will be solely responsible for your use of the Service on your mobile device...
129: **b. You License Your Content to Us** By Posting any User Content, you hereby represent and warrant that you have sufficient rights in the User Content to grant us the below license. By Posting any User Content, you hereby grant to Poshmark and its affiliated companies a nonexclusive, worldwide, royalty free, fully ...
```


## `poshmark_help.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://poshmark.com/terms> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:40:53Z |
| Original capture SHA-256 | `10a75bd91929e223fa7615b8d6ec85dc12f00a1a5340b3769c62549383a5d037` |
| Original capture bytes | 155 |

No line in this capture matched the fee/tax keyword set. The page was
retrieved and searched; the classification that cites it rests on the
**absence** of a fee-base statement, which is recorded in
`TAX_TREATMENT_T2_9.md` rather than quoted here.


## `s_www_coolstuffinc_com_main_selllist_php.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://www.coolstuffinc.com/main_fullservice_selllist.php> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:41:27Z |
| Original capture SHA-256 | `37f1f254ac0350f09ea6e1f58536b9c1cf44264a2458041fa256edb25d08e761` |
| Original capture bytes | 5,732 |

Excerpt (line numbers from the original capture):

```
13: Every day, we receive singles sell orders that were damaged in transit due to poor packing practices, or orders that are unorganized, leading to delays. Be sure to watch this video to see how to keep your singles safe and organized for quick processing!
65: We pay 75% of the listed near mint price on played condition cards. We grade all cards as we process your sell order once it arrives. Any changes due to condition will be applied at that time. All changes are viewable from your account page by clicking the link associated with the sell cart in the Recent Sell Orders...
95: We can return items marked for return with a future order for no charge. Alternatively, if you would like them sent back separately there is a fee to cover the shipping/materials ($2.99 for card game, returns within the contiguous USA). Return item shipping for sealed products or to non-US countries will vary based ...
```


## `scg.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://sellyourcards.starcitygames.com/> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:39:20Z |
| Original capture SHA-256 | `c6fa539173799560efe202d070f231ee38f1132b2034e6db00370a6a01f0935f` |
| Original capture bytes | 1,547 |

Excerpt (line numbers from the original capture):

```
39: - Pay a 10% Service Fee (5% over $10,000)
```


## `scg_help.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://sellyourcards.starcitygames.com/> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:39:21Z |
| Original capture SHA-256 | `13cb1c42ebc1d07f5e12f363abaef6fe44c86c39b3147fe3fb0ef5ddd52b22e5` |
| Original capture bytes | 1,183 |

Excerpt (line numbers from the original capture):

```
13: #### Processing Your Sell List Request
17: #### Processing Your Ship + Sell Request
```


## `tcgbulk.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://tcgbulk.com/page/terms-of-service> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:39:21Z |
| Original capture SHA-256 | `67f72916790f292277ecce6bbbd234abb75b46fa71f59606293fdda91d4d3760` |
| Original capture bytes | 24,836 |

Excerpt (line numbers from the original capture):

```
9: TCG Bulk provides technology that connects sellers of physical trading cards with buyers. Except where we expressly state otherwise, the contract for the sale of Products is between the Seller and the Buyer. TCG Bulk facilitates the transaction but does not take legal title to the Products and is not the seller or buyer under that contract.
33: Transactions facilitated by TCG Bulk concern physical trading cards and related physical goods. The Binder, scanner results, account balance, estimates, and other digital records are Service features; they are not digital goods, legal title documents, stored-value products, or independently transferable assets.
45: Binder contents are informational records based on data you or the Service provide. A Binder entry does not create an Offer to Purchase or Contract of Sale and does not guarantee that a Buyer will accept the card or pay a displayed or estimated amount. Applicable rates, limits, fees, and eligibility are those shown ...
55: A Seller creates a Submission by selecting a Buyer and confirming the Products, quantities, rates, shipping destination, fees, and other displayed terms. Unless the Service clearly states otherwise, the Contract of Sale becomes binding when the Seller confirms the Submission against the Buyer's active Offer to Purch...
65: Unless the Offer to Purchase expressly states otherwise, the Seller is responsible for packaging and outbound shipping costs. The Seller must package Products securely, use accurate shipment information, and enter one valid tracking number for each parcel.
105: **Buyers:** Published rates and qualifying Offers to Purchase must be accurate and funded. Once a Seller confirms a qualifying Submission, the Buyer must honor it, inspect it fairly, pay amounts due, and not reject or return Products merely because the Buyer changes its mind. A Buyer that wrongfully rejects or retur...
117: Unless a different fee is clearly shown before the Seller confirms a Submission, a 10% TCG Bulk service fee applies to the transaction and is deducted from the Seller's proceeds. The final transaction summary will show the applicable fee. We may change fees for future transactions by giving notice or clearly displaying the new fee before confirmation; a change does not alter a fee already accepted for an existing Submission.
125: If optional shipment protection is offered and selected for a Submission, the displayed fee, coverage limit, evidence requirements, exclusions, and claim process apply. Under the current program, where shown at checkout, the fee may be 3.5% and coverage may be limited to USD 200 for a package confirmed lost by the carrier.
```


## `tcgplayer.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:39:17Z |
| Original capture SHA-256 | `1d2aa4805191a63cef415a14496a408444967dec09ce3d5e134aae7e8d80ae9f` |
| Original capture bytes | 2,824 |

Excerpt (line numbers from the original capture):

```
3: When selling with TCGplayer, commission fees are applied to your transaction based on where the sale took place and which programs you are a part of. The commission and Pro fee total is capped at $50 per product sold.
5: **Example: **An order that contains 2 $1000 cards would have a total commission and Pro fees of $100, $50 for each card.
7: Please refer to the table below for the different fee structures available.
9: *Note: TCGplayer charges fees based on the subtotal (item amount + shipping cost). We do not charge fees on taxes for orders paid by debit card. However, credit cards and PayPal do include taxes when determining the fee, and this amount is used to cover the added processing costs for those payment methods (item amount + shipping cost + taxes).*
13: |Seller Type|Marketplace Commission Fee|Pro Fee|Direct Shipping Replacement Cost|Sync Fee|Domestic CC/Paypal Processing Fee*|
15: |Marketplace Seller (Level 1-4 Account)|10.25%|N/A|N/A|N/A|2.5%+$.30|
21: *If your account does not meet the criteria above please contact us here for more details on your specific fees
25: *Credit card processing fee for international orders is 3.5%+$.30*
29: |Sale Origination|Marketplace Commission Fee|Pro Fee|Domestic CC/Paypal Processing Fee*|
37: *Credit card processing fee for international orders is 3.5%+$.30*
39: For examples on how we calculate these fees, please read our Fee Calculation Examples help file.
43: TCGplayer uses Bankers Rounding for calculating fees:
```


## `tcgplayer_examples.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://help.tcgplayer.com/hc/en-us/articles/360047732673-Fee-Calculation-Examples> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:39:17Z |
| Original capture SHA-256 | `7e3c7d8302c69bb227427dfcfa9ee054d35d9db8363d83b3f373df9f625494cb` |
| Original capture bytes | 4,337 |

Excerpt (line numbers from the original capture):

```
1: # Fee Calculation Examples
3: Here you will find examples of each type of TCGplayer fee calculation. For a concise breakdown of these fee types, please visit our TCGplayer Fees help file.
5: In the calculation examples, we will be determining fees for the following sample order.
7: Note, Subtotal = Items + Shipping cost, and Order Total = Subtotal + Sales Tax
9: ** In the fees listed above we are using NC Sales Tax as an example. Each state has unique sales tax rules and regulations. For more information check out * *How Sales Tax Works on TCGplayer* *.*
13: Marketplace Commission: 10.25%
23: PayPal/Credit Card Processing Fee: 2.5% + $0.30
33: Total Marketplace Sale (Level 1-4 Seller) Fees = Marketplace Commission + Total PayPal/Credit Card Fees
43: Marketplace Commission = 9.25%
63: PayPal/Credit Card Processing Fee = 2.5% + $0.30
73: Total Marketplace Sale (Pro Sellers, Non-Direct) Fees = Marketplace Commission + Pro Fee + Total PayPal/Credit Card Fees
83: Marketplace Commission: 9.25%
91: **$6.13**+ Sync Fee (Determined by sync provider)
93: PayPal/Credit Card Processing Fee = 2.5%+$0.30
```


## `whatnot.txt`

| Field | Value |
| --- | --- |
| Source URL | <https://help.whatnot.com/hc/en-us/articles/4847069165965-Whatnot-Seller-Fees-and-Commissions-Schedule> |
| Final redirected URL | **Unverified** (not recorded at capture time) |
| Retrieved (UTC) | 2026-09-08T13:39:18Z |
| Original capture SHA-256 | `80700bc5d73e2bdf1ce2b3326065c70996dde52f29c58ddc5048733250cc9389` |
| Original capture bytes | 8,465 |

Excerpt (line numbers from the original capture):

```
1: There are two kinds of fees that will always impact your earnings on a sale – Whatnot’s
3: **commission fee** (Whatnot’s “cut” of the sale) and the **payment processing fee** (covering services provided by our payment processor). These fees are charged once your item is sold and are automatically deducted from your revenue from that sale.
5: While we use the term “fee(s)” broadly in this article, for clarity, a
7: **“commission” is a charge calculated as a percentage of the final price** of an item (i.e. a sales commission). The final price refers to the **price the item sold for to the buyer**, which does not include shipping or taxes. For example, if the seller started the auction at $1 and a buyer won the auction for $20, ...
11: **payment processing fee” is a charge calculated as a percentage of the total order value of a transaction**. This includes the ** final price of the item sold plus shipping and buyer-paid tax**. For a breakdown of how payment processing fees differ in other countries, visit Earnings Payout Timeline.
13: In certain circumstances, Whatnot is required to charge tax on our commission fee and payment processing fee. The applicable taxes depend upon the seller’s location and, outside the US, a seller's tax registration status. For more information, please visit this article.
15: **US, Canada and Australia Seller Fee Structure**
17: |Category|Commission Fee|Payment Processing Fee|
19: |Comics & Anime, Toys & Hobbies, Trading Card Games, and Sports Singles (see other restrictions)|8% on final price up to $1,500; 0% on portion over $1,500 (limited time only)|2.9% on total order value + $0.30|
```

