# Major-game scanner release preparation

Status: PREPARED, NOT ACCEPTED FOR LAUNCH.

Application: `892af836d596ea04a6dfa7e778c0b5c7385a5794`
Production deployment: `dpl_A3UbdVgis12Lr2hi7uXyDSuxxTWd`
Production URL: https://www.cardresell.org/

## Scope and evidence

Pokémon, Magic, and Yu-Gi-Oh! are the priority. The companion
`major-games-cases.json` records 16 fixtures, their SHA-256 hashes, dimensions,
expected names, sets, and printed identifiers. Photos remain outside Git.
The reduced-quality fixtures use a maximum dimension of 1024 pixels, JPEG
quality 65, brightness 0.8, and Gaussian blur radius 0.35. They are synthetic
stress cases, not a representative customer accuracy study.

Four original cases have now been tested on this release:

| Case | Live result |
|---|---|
| Dusclops | Automatic Vivid Voltage #70; $0.13 normal base-printing estimate |
| Mimikyu | Automatic Paldean Fates #037; $0.27 holofoil estimate |
| Applin | Match review; OCR returned no collector fraction |
| Blitzclique | Name found, printing review; OCR returned no printed set code |

Two pass identity; two remain review; twelve cases remain pending. Thus 4/16
planned checks have run (25% execution), not 25% scanner accuracy or readiness.
Earlier Magic and Greninja successes belong to the previous release and must
not be reported as fresh passes.

The previously timed-out three-photo upload recovered with all three images
queued. One Scan All submission completed; balance moved from 372 to 371,
consistent with Mimikyu consuming one credit and the two review cases having
no net debit. No inventory or listing drafts were saved.

Production diagnostics on the current release: Applin textLength 247,
nameRows 18, candidates 0, ratios []; Blitzclique textLength 506, nameRows 6,
candidates 0, printedCodes []. Mimikyu's exact 037/091 evidence and PAF set
corroboration yielded one verified printing. Increasing image resolution alone
has not solved Applin or Blitzclique; the next repair must improve evidence
extraction without replacing it with a guessed printing.

## Changes already deployed

- Pokémon symbol-era cards no longer require an abbreviation absent from the
  physical card. Exact visual identity plus printed name/number and verified
  official set denominator can corroborate a unique printing. Conflicting
  printed set codes still prevent automatic acceptance.
- Capture preserves up to 2048px at JPEG quality 0.92, within a 2 MB base64
  budget. This is an implementation change, not proof of improved live OCR.
- Slab evidence uses the dedicated slab identification endpoint, retaining
  strict grade/certificate checks and preventing raw-price substitution.

## Verification completed

Printed evidence: 35 passed (rerun during preparation). Previous verification
of this application source: billing/refund 15, sports retry 54, slab browser
60, Ximilar contract 45, registry 12. The remote full local suite completed
with ALL CHECKS PASSED; conditional/live suites may skip. These are not live
photo accuracy results. The remote sandbox is stopped.

## Live execution order

1. The recovered three-photo batch is complete. Start a
   fresh tab and upload one remaining original photo at a time. Confirm the queued image
   before Scan All. Never repeatedly click Scan All while a request is pending.
2. Prioritize Applin, Mimikyu, Blitzclique, and the Charizard slab. Then repeat
   Greninja and both Magic cards against the current release.
3. Run all eight reduced-quality cases. Record automatic exact identity,
   wrong identity, review, unsupported, timeout, and unavailable price separately.
4. Record start/end credits, displayed finish, price source, and elapsed scan
   time. Do not count file-transfer time as identification latency.
5. Inspect diagnostics for failures, repair the general cause, run relevant
   regressions, deploy, then use a fresh tab to avoid idempotent result replay.
6. Save visible result evidence. Do not save inventory, create real listing
   drafts, publish listings, or buy credits during acceptance.

## Acceptance gates

- Every original has the correct automatic name, set and collector identifier.
  A review or manually selected candidate is not an automatic pass.
- No wrong automatic identity in either group. Review on a degraded image is
  safer than a fabricated match, but remains an unresolved usability result.
- Finish and condition are separately checked; an identity pass does not
  establish reverse holo, foil, physical condition, or authenticity.
- Charizard retains PSA 9 and its photographed certificate; no raw price is
  substituted. Missing graded price must be explicit.
- Failed/review outcomes follow the refund contract; retries do not double-debit.
- Production API startup and an authenticated photo scan succeed after deploy.
- No claim of general scanner accuracy is based solely on this small fixture set.

## Broader pre-advertising checklist

These remain separate from scanner acceptance and require current verification:

- Fee comparison is visible without an extra special dropdown, uses actual
  venue formulas, and does not retain the blanket 15% placeholder.
- Low/high ranges are measured provider data; missing data is explained without
  fabricated bounds or false precision.
- eBay Connect clearly states what it enables. Connection is not proof of sold
  data access or automatic draft publishing.
- Downloaded eBay drafts have clear upload guidance and a verified Seller Hub
  destination, plus dismissible/reopenable help if implemented.
- Sports, One Piece, Lorcana and Union Arena results are not implied by the
  three-game acceptance. Known unsupported games remain explicitly labeled.

## Rollback readiness

If a new deployment fails module startup, stop paid testing and inspect the
deployment logs before further scans. Do not reintroduce the import.meta URL
runtime loader that previously failed under deployed CommonJS. A rollback
target must be chosen from an inspected, healthy prior deployment; an older
commit is not automatically a safe rollback. Preserve the current production
deployment ID above and do not move aliases without checking its successor.
