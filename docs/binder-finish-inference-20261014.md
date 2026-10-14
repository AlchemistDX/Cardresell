# Binder finish inference correction

Owner screenshots showed Gloom at $45.26, Skiploom at $44.58 and Poochyena at $16.23, all assigned Reverse Holofoil. These are observed app quotes, not verified market values or independently confirmed finishes.

The bulk price chooser promoted a generic `foil` hint to Reverse Holofoil whenever Normal and Reverse were the available options. The finish mapper preserved that selection. A generic foil/holo signal does not establish the specific printing, particularly in a binder photograph.

Pokémon bulk scans now use the Normal catalogue reference when it is available, labelled “Base-printing estimate.” This is an explicit pricing assumption, not a claim that the scanner verified non-foil. The disclosure explains the assumption. Automatic pricing and the optional one-tap Finish / printing correction remain; no added scan request or confirmation step is introduced.

Missing Normal prices remain missing rather than borrowing a premium value; zero remains zero. A reverse-only feed does not establish a reverse printing and stays unpriced until the seller selects that finish or enters a price. Holo-only base printings retain their automatic price. Other games' finish handling is unchanged.

The basis is preserved with saved finish metadata and cleared by seller selection. Existing saved cards are not rewritten: their previous finish may be intentional. Correct an existing row using its Finish / printing dropdown; there is no need to spend another scan credit.

Regression fixtures reproduce the screenshot premium values with explicitly synthetic base prices. They test initial mapping, missing and zero base prices, holo-only catalogues, reverse-only catalogues, optional corrections and persistence. Browser tests use synthetic HTTP responses and exercise the actual scan-to-price-to-subtotal flow, correction, Collection save/reload and refresh at 320, 390 and 1280 pixels. They do not measure real-world visual classification accuracy.

Release validation and production evidence are recorded on the pull request. The optional buyer-tax calculator improvement remains queued behind this scan-pricing correction.
