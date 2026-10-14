# Binder finish inference correction

Owner screenshots showed Gloom at $45.26, Skiploom at $44.58 and Poochyena at $16.23, all assigned Reverse Holofoil. These are observed app quotes, not verified market values or independently confirmed finishes.

The bulk price chooser promoted a generic `foil` hint to Reverse Holofoil whenever Normal and Reverse were the available options. The finish mapper preserved that selection. A generic foil/holo signal does not establish the specific printing, particularly in a binder photograph.

Pokémon bulk scans now use the Normal catalogue reference when it is available, labelled “Base-printing estimate.” This is an explicit pricing assumption, not a claim that the scanner verified non-foil. The disclosure explains the assumption. Automatic pricing and the optional one-tap Finish / printing correction remain; no added scan request or confirmation step is introduced.

Missing Normal prices remain missing rather than borrowing a premium value; zero remains zero. When the catalogue returns only one finish, including Reverse Holofoil, the scanner now selects it and uses its available price automatically. This follows the owner's Lillipup BW52 screenshot feedback: the earlier reverse-only exception unnecessarily left that row unpriced. The result remains an estimate, with the sole-option basis explained in Market estimate and an optional Finish / printing correction. Missing prices still remain missing. Other games' finish handling is unchanged.

The basis is preserved with saved finish metadata and cleared by seller selection. Existing saved cards are not rewritten: their previous finish may be intentional. Correct an existing row using its Finish / printing dropdown; there is no need to spend another scan credit.

Regression fixtures reproduce the screenshot premium values with explicitly synthetic base prices. They test initial mapping, missing and zero base prices, holo-only catalogues, reverse-only catalogues, optional corrections and persistence. A Lillipup BW52 fixture uses a synthetic $2.25 quote, not a current market valuation. Browser tests use synthetic HTTP responses and exercise the actual scan-to-price-to-subtotal flow, correction, Collection save/reload and refresh at 320, 390 and 1280 pixels. They do not measure real-world visual classification accuracy.

The scan-finish source has been reconciled with the previously served bundle before this change. `tools/build-scan-finish.mjs` writes a new immutable asset and updates the entry reference; the asset gate now checks source parity so a later rebuild cannot silently discard live finish rules or price disclosures.

Release validation and production evidence are recorded on the pull request. The optional buyer-tax calculator improvement remains queued behind this scan-pricing correction.
