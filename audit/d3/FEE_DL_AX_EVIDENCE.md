# Fee <dl> accessibility evidence

Bundle: `js/core.7f9c03ad.js`
Viewport 720px. Generated 2026-09-08T01:25:26.494Z

## priced · light

dl children: 14 · strict dt/dd alternation + kind match: **PASS**

**Reading order (DOM order inside the `<dl>`):**

- `dt` [gross] "Item price"
- `dd` [gross] "$40.00"
- `dt` [basis] "Fee base (item)"
- `dd` [basis] "$40.00"
- `dt` [basis] "Buyer sales tax (not estimated)"
- `dd` [basis] "—"
- `dt` [fee] "Final Value Fee (13.25% trading cards)"
- `dd` [fee] "−$5.30"
- `dt` [fee] "Per-order fee"
- `dd` [fee] "−$0.40"
- `dt` [withheld] "Top Rated Plus discount (not applied)"
- `dd` [withheld] "—"
- `dt` [net] "Estimated net (item only)"
- `dd` [net] "$34.30"

**AX tree nodes with a description/term/definition role:** 15

- DescriptionList
- term — "Item price"
- definition
- term — "Fee base (item)"
- definition
- term — "Buyer sales tax (not estimated)"
- definition
- term — "Final Value Fee (13.25% trading cards)"
- definition
- term — "Per-order fee"
- definition
- term — "Top Rated Plus discount (not applied)"
- definition
- term — "Estimated net (item only)"
- definition

**Computed amount colours:** tax `rgb(107, 105, 96)` · withheld `rgb(107, 105, 96)` · net `rgb(24, 22, 15)`

Screenshot: `audit/d3/ax-fee-priced-light.png`

## priced · dark

dl children: 14 · strict dt/dd alternation + kind match: **PASS**

**Reading order (DOM order inside the `<dl>`):**

- `dt` [gross] "Item price"
- `dd` [gross] "$40.00"
- `dt` [basis] "Fee base (item)"
- `dd` [basis] "$40.00"
- `dt` [basis] "Buyer sales tax (not estimated)"
- `dd` [basis] "—"
- `dt` [fee] "Final Value Fee (13.25% trading cards)"
- `dd` [fee] "−$5.30"
- `dt` [fee] "Per-order fee"
- `dd` [fee] "−$0.40"
- `dt` [withheld] "Top Rated Plus discount (not applied)"
- `dd` [withheld] "—"
- `dt` [net] "Estimated net (item only)"
- `dd` [net] "$34.30"

**AX tree nodes with a description/term/definition role:** 15

- DescriptionList
- term — "Item price"
- definition
- term — "Fee base (item)"
- definition
- term — "Buyer sales tax (not estimated)"
- definition
- term — "Final Value Fee (13.25% trading cards)"
- definition
- term — "Per-order fee"
- definition
- term — "Top Rated Plus discount (not applied)"
- definition
- term — "Estimated net (item only)"
- definition

**Computed amount colours:** tax `rgb(145, 143, 134)` · withheld `rgb(145, 143, 134)` · net `rgb(212, 210, 204)`

Screenshot: `audit/d3/ax-fee-priced-dark.png`

## unpriced · light

dl children: 4 · strict dt/dd alternation + kind match: **PASS**

**Reading order (DOM order inside the `<dl>`):**

- `dt` [gross] "Item price"
- `dd` [gross] "—"
- `dt` [net] "Estimated net (item only)"
- `dd` [net] "—"

**AX tree nodes with a description/term/definition role:** 5

- DescriptionList
- term — "Item price"
- definition
- term — "Estimated net (item only)"
- definition

**Computed amount colours:** tax `null` · withheld `null` · net `rgb(24, 22, 15)`

Screenshot: `audit/d3/ax-fee-unpriced-light.png`

## unpriced · dark

dl children: 4 · strict dt/dd alternation + kind match: **PASS**

**Reading order (DOM order inside the `<dl>`):**

- `dt` [gross] "Item price"
- `dd` [gross] "—"
- `dt` [net] "Estimated net (item only)"
- `dd` [net] "—"

**AX tree nodes with a description/term/definition role:** 5

- DescriptionList
- term — "Item price"
- definition
- term — "Estimated net (item only)"
- definition

**Computed amount colours:** tax `null` · withheld `null` · net `rgb(212, 210, 204)`

Screenshot: `audit/d3/ax-fee-unpriced-dark.png`
