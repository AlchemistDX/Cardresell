/* api/_setPrintedTotals.js
 *
 * The printed denominator for a set, or null.
 *
 * There are two ways a card reaches a draft, and the denominator has to travel
 * along BOTH of them or the fix only works for whichever path a given scan
 * happened to take:
 *
 *   PATH 1 -- the live pokemontcg.io lookup (api/scan.js). The set object in
 *     that response already carries `printedTotal`, so that path just needs to
 *     stop dropping it.
 *   PATH 2 -- the local supplemental catalogue, card-index.json. It stores no
 *     denominator at all, so the value comes from the reviewed table in
 *     data/set-printed-totals.json, keyed by the set id already on the record
 *     (`si`) or the set code (`sc`).
 *
 * `null` is a legitimate, common answer and means "unverified". Callers must
 * render the bare collector number in that case rather than substituting a
 * guess -- never the catalogue's record count, and never its maximum card
 * number, both of which give 188 for the set that exposed this bug while the
 * cards themselves are printed /132.
 */
/* RUNTIME LOADING IS EMBEDDED, NOT READ FROM DISK.
 *
 * This module previously resolved data/set-printed-totals.json at runtime via
 * import.meta.url + readFileSync. That crashed the deployed function: this was
 * the only file under api/ using import.meta, api/drafts.js is its only
 * importer, and /api/drafts was the only endpoint that returned
 * FUNCTION_INVOCATION_FAILED in production on 2026-09-13 while /api/health,
 * /api/scan, /api/ebay-sold and /api/grade-share all stayed healthy. The same
 * unauthenticated request returned 401 on the previous release and 500 on that
 * one, so the regression is measured, not inferred.
 *
 * The registered suite could not catch it: every slot runs in-process under
 * node, and none exercises the built serverless runtime, which is where this
 * broke. The read was already wrapped in a non-fatal try/catch, so the missing
 * file was never the failure -- module evaluation was.
 *
 * The table is small and reviewed, so it is embedded. data/set-printed-totals.json
 * remains the seeder's reviewed metadata record, including the provenance and
 * the why-not-derived reasoning, and a parity check asserts the two agree so
 * they cannot drift.
 *
 * Frozen so a caller cannot mutate a shared lookup table by accident. */
const SET_PRINTED_TOTALS = Object.freeze({
  me1: Object.freeze({
    name: 'Mega Evolution',
    ptcgoCode: 'MEG',
    printedTotal: 132,
    total: 188,
    verifiedAt: '2026-09-12',
    verifiedFrom: 'https://api.pokemontcg.io/v2/cards/me1-134',
  }),
});

function loadPrintedTotals() {
  return SET_PRINTED_TOTALS;
}

/** Accepts a set id ("me1") or a set code ("MEG"). Returns a positive integer or null. */
export function printedTotalForSet(setIdOrCode) {
  const key = String(setIdOrCode == null ? '' : setIdOrCode).trim();
  if (!key) return null;
  const sets = loadPrintedTotals();

  const direct = sets[key] || sets[key.toLowerCase()];
  if (direct && Number.isInteger(direct.printedTotal) && direct.printedTotal > 0) {
    return direct.printedTotal;
  }

  // Fall back to a ptcgoCode match ("MEG" -> me1).
  const upper = key.toUpperCase();
  for (const entry of Object.values(sets)) {
    if (entry && String(entry.ptcgoCode || '').toUpperCase() === upper
        && Number.isInteger(entry.printedTotal) && entry.printedTotal > 0) {
      return entry.printedTotal;
    }
  }
  return null;
}

/**
 * The denominator for a card, preferring a value the live API already supplied
 * over the reviewed table. `liveSet` is a pokemontcg.io set object when one is
 * in hand, otherwise null.
 */
export function resolvePrintedTotal({ liveSet = null, setId = '', setCode = '' } = {}) {
  const live = liveSet && Number(liveSet.printedTotal);
  if (Number.isInteger(live) && live > 0) return live;
  return printedTotalForSet(setId) ?? printedTotalForSet(setCode);
}
