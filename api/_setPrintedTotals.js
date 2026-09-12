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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let TABLE = null;

function table() {
  if (TABLE) return TABLE;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, '..', 'data', 'set-printed-totals.json'), 'utf8');
    const parsed = JSON.parse(raw);
    TABLE = (parsed && parsed.sets && typeof parsed.sets === 'object') ? parsed.sets : {};
  } catch (_) {
    /* A missing or malformed table is not fatal: every lookup returns null and
       every caller prints the bare number. Failing the scan over a display
       nicety would be worse than the nicety being absent. */
    TABLE = {};
  }
  return TABLE;
}

/** Accepts a set id ("me1") or a set code ("MEG"). Returns a positive integer or null. */
export function printedTotalForSet(setIdOrCode) {
  const key = String(setIdOrCode == null ? '' : setIdOrCode).trim();
  if (!key) return null;
  const sets = table();

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
