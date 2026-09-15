/* Identity resolution — work-order item 3.
 *
 * Replaces arbitrary first-result selection (`cards[0]`, `card_sets[0]`,
 * `hits[0]`) with an explicit decision over the whole candidate set.
 *
 * The product guarantee permits exactly three outcomes for a readable card:
 * name the exact printing, show a short list, or report that it cannot
 * identify the card. It never permits silently substituting a nearby
 * printing. Taking element [0] of an unordered provider response is that
 * silent substitution, so it is removed here rather than re-ranked.
 *
 * This module is pure: no network, no KV, no auth. Every branch is reachable
 * from a unit test. See tests/identity-resolution.mjs.
 */

'use strict';

const CACHE_SCHEMA_VERSION = 2; // bump invalidates pre-correction cache entries

const END = {
  EXACT_MATCH: 'EXACT_MATCH',
  NEEDS_CONFIRMATION: 'NEEDS_CONFIRMATION',
  UNKNOWN_CARD: 'UNKNOWN_CARD',
  UNSUPPORTED_CARD: 'UNSUPPORTED_CARD',
  UNREADABLE_IMAGE: 'UNREADABLE_IMAGE',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
};

const MAX_CONFIRMATION_CANDIDATES = 3;

/* ---------- printed-identifier consistency ---------------------------------
 * Only identifiers actually printed on the card may be used to accept a
 * candidate. Editorial catalogue text (parentheticals such as
 * "(Alternate Art)" or "(Store Championship Trophy Card)") is NOT printed on
 * the card and must never be used to discriminate at scan time, even though it
 * does disambiguate the catalogue. Measured on the TCGCSV categories: full
 * product name resolves One Piece and Lorcana catalogue ambiguity to zero, but
 * does so through exactly this unreadable editorial text.
 */

function normNumber(v) {
  if (v == null) return null;
  // "004/102", "4", "004" -> "4"; keep any alphabetic suffix ("SV49", "TG12")
  const s = String(v).trim().toUpperCase();
  if (!s) return null;
  const head = s.split('/')[0];
  const m = head.match(/^([A-Z]*)0*(\d+)([A-Z]*)$/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  return head.replace(/^0+(?=\d)/, '');
}

function normText(v) {
  if (v == null) return null;
  return String(v).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ') || null;
}

/**
 * Strip editorial parentheticals and bracketed qualifiers from a catalogue
 * name, leaving only text a seller could read off the card.
 *
 * Catalogue names carry qualifiers like "(Alternate Art)",
 * "(Store Championship Trophy Card)" and "(Mirror Holofoil)". These are
 * editorial: they disambiguate the catalogue but are not printed on the card.
 *
 * They must be neither an agreement nor a conflict. Treating them as a
 * conflict rejects every candidate and refunds a card that IS in the
 * catalogue; treating them as an agreement manufactures a false exact match
 * from text the scanner never saw. Stripping them lets the remaining printed
 * identifiers decide, and leaves genuine ties to confirmation.
 */
function stripEditorial(v) {
  if (v == null) return null;
  return String(v)
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s+-\s+\d+\/\d+\s*$/, '') // trailing " - 061/190" catalogue suffix
    .trim();
}

/** Compare one printed identifier. Returns 'agree' | 'conflict' | 'unknown'. */
function compareField(observed, candidate, kind) {
  if (kind === 'number') {
    const o = normNumber(observed);
    const c = normNumber(candidate);
    if (o == null || c == null) return 'unknown';
    return o === c ? 'agree' : 'conflict';
  }
  const o = normText(kind === 'name' ? stripEditorial(observed) : observed);
  const c = normText(kind === 'name' ? stripEditorial(candidate) : candidate);
  if (o == null || c == null) return 'unknown';
  return o === c ? 'agree' : 'conflict';
}

/**
 * Score a candidate against what was read off the card.
 *
 * Rarity is excluded from CROSS-PROVIDER comparison: rarity vocabularies differ
 * between providers, so comparing an observed rarity string (from the vision
 * model) against a provider's own rarity string manufactures false conflicts.
 *
 * It is admitted only when the caller passes `rarityComparable: true`, meaning
 * observed and candidate rarity come from the SAME vocabulary. This is the
 * within-provider disambiguation case: item 5 measured that adding set_rarity
 * resolves 3,872/3,872 colliding (passcode, set_code) pairs in YGOProDeck,
 * where both sides of the comparison are YGOProDeck's own `set_rarity` values.
 *
 * A caller that has only a vision-model rarity guess must NOT set this flag;
 * the correct outcome there is NEEDS_CONFIRMATION, not a coin flip.
 */
function checkCandidate(observed, candidate, opts = {}) {
  const checks = {
    number: compareField(observed.number, candidate.number, 'number'),
    name: compareField(observed.name, candidate.name, 'name'),
    setCode: compareField(observed.setCode, candidate.setCode, 'text'),
  };
  if (opts.rarityComparable) {
    checks.rarity = compareField(observed.rarity, candidate.rarity, 'text');
  }
  const conflicts = Object.entries(checks).filter(([, v]) => v === 'conflict').map(([k]) => k);
  const agreements = Object.entries(checks).filter(([, v]) => v === 'agree').map(([k]) => k);
  return { checks, conflicts, agreements, consistent: conflicts.length === 0 };
}

/**
 * Resolve an identity decision.
 *
 * @param {object}   observed   What was read off the card image.
 * @param {object[]} candidates Provider candidate printings.
 * @param {object}   opts
 *   @param {boolean} opts.sourceFailed   a required source could not be reached
 *   @param {string}  opts.sourceError    detail for SOURCE_UNAVAILABLE
 *   @param {boolean} opts.imageUnreadable
 *   @param {boolean} opts.gameSupported  default true
 *   @param {boolean} opts.rarityComparable observed.rarity and candidate.rarity
 *          are drawn from the SAME provider vocabulary (see checkCandidate)
 * @returns {{endState:string, printing:object|null, candidates:object[], reason:string, evidence:object}}
 */
function resolveIdentity(observed = {}, candidates = [], opts = {}) {
  const {
    sourceFailed = false,
    sourceError = null,
    imageUnreadable = false,
    gameSupported = true,
  } = opts;

  // Order matters: infrastructure and readability outcomes are not recognition
  // outcomes and must never be reported as UNKNOWN_CARD (which bills as a
  // refundable miss and pollutes accuracy measurement).
  if (imageUnreadable) {
    return mk(END.UNREADABLE_IMAGE, null, [], 'image did not yield readable identifying parts', { observed });
  }
  if (!gameSupported) {
    return mk(END.UNSUPPORTED_CARD, null, [], 'card game is outside the supported catalogue', { observed });
  }
  if (sourceFailed) {
    return mk(END.SOURCE_UNAVAILABLE, null, [], sourceError || 'identity source unreachable', { observed });
  }

  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (list.length === 0) {
    return mk(END.UNKNOWN_CARD, null, [], 'no candidate printings returned by source', { observed });
  }

  const scored = list.map((c) => ({ candidate: c, ...checkCandidate(observed, c, { rarityComparable: opts.rarityComparable }) }));
  const consistent = scored.filter((s) => s.consistent);

  // Everything the source offered conflicts with the card in hand. Reporting
  // one of them anyway is the silent substitution the guarantee forbids.
  if (consistent.length === 0) {
    return mk(
      END.UNKNOWN_CARD, null, [],
      'every candidate conflicts with a printed identifier read off the card',
      { observed, rejected: scored.map((s) => ({ candidate: s.candidate, conflicts: s.conflicts })) }
    );
  }

  if (consistent.length === 1) {
    const only = consistent[0];
    return mk(END.EXACT_MATCH, only.candidate, [], 'exactly one candidate is consistent with the printed identifiers', {
      observed, checks: only.checks, agreements: only.agreements,
    });
  }

  // More than one candidate survives. Prefer a strictly dominant candidate:
  // one that agrees on strictly more printed identifiers than every other.
  const maxAgree = Math.max(...consistent.map((s) => s.agreements.length));
  const top = consistent.filter((s) => s.agreements.length === maxAgree);
  if (top.length === 1 && maxAgree > 0) {
    return mk(END.EXACT_MATCH, top[0].candidate, [], 'one candidate agrees on strictly more printed identifiers than any other', {
      observed, checks: top[0].checks, agreements: top[0].agreements,
      runnersUp: consistent.filter((s) => s !== top[0]).length,
    });
  }

  // Genuinely ambiguous on readable evidence -> short list, never a guess.
  // Capped at three: a "short list" longer than that is not a short list, and
  // the top-3 metric is defined over exactly three candidates.
  const shortList = consistent.slice(0, MAX_CONFIRMATION_CANDIDATES).map((s) => s.candidate);
  return mk(
    END.NEEDS_CONFIRMATION, null, shortList,
    `${consistent.length} candidates are equally consistent with the printed identifiers`,
    {
      observed,
      consistentCount: consistent.length,
      truncated: consistent.length > MAX_CONFIRMATION_CANDIDATES,
      tiedOnAgreements: maxAgree,
    }
  );
}

function mk(endState, printing, candidates, reason, evidence) {
  return { endState, printing: printing || null, candidates: candidates || [], reason, evidence: evidence || {} };
}

/* ---------- bounded retry within the scan timeout ------------------------- */

/**
 * Retry a source call inside a hard deadline. Distinguishes retryable
 * transport/5xx/429 faults from permanent 4xx, and never exceeds the deadline
 * (a scan that overruns its budget is a failed scan, not a slow one).
 *
 * HTTP 429 is rate limiting, not a missing resource: it is retryable and may
 * carry Retry-After. It must never be recorded as a missing endpoint.
 */
async function withBoundedRetry(fn, {
  deadlineMs = 4000, maxAttempts = 3, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const start = now();
  const attempts = [];
  let lastErr = null;
  for (let i = 1; i <= maxAttempts; i++) {
    const remaining = deadlineMs - (now() - start);
    if (remaining <= 0) {
      attempts.push({ attempt: i, skipped: 'deadline exhausted before attempt' });
      break;
    }
    try {
      const res = await fn({ attempt: i, remainingMs: remaining });
      const status = res && typeof res.status === 'number' ? res.status : null;
      if (status !== null && status >= 400) {
        const retryable = status === 429 || status >= 500;
        attempts.push({ attempt: i, status, retryable, class: classifyStatus(status) });
        if (!retryable) {
          return { ok: false, status, attempts, permanent: true, class: classifyStatus(status) };
        }
        lastErr = new Error(`HTTP ${status}`);
        const wait = retryAfterMs(res) ?? Math.min(2 ** (i - 1) * 150, 1000);
        if (deadlineMs - (now() - start) <= wait) break;
        await sleep(wait);
        continue;
      }
      attempts.push({ attempt: i, status, ok: true });
      return { ok: true, status, value: res, attempts };
    } catch (e) {
      lastErr = e;
      attempts.push({ attempt: i, error: String((e && e.message) || e), retryable: true, class: 'network' });
      const wait = Math.min(2 ** (i - 1) * 150, 1000);
      if (deadlineMs - (now() - start) <= wait) break;
      await sleep(wait);
    }
  }
  return { ok: false, attempts, permanent: false, error: lastErr ? String(lastErr.message || lastErr) : 'exhausted', class: 'exhausted' };
}

function classifyStatus(status) {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'client_error';
  return 'ok';
}

function retryAfterMs(res) {
  try {
    const h = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
    if (!h) return null;
    const secs = Number(h);
    if (Number.isFinite(secs)) return Math.min(Math.max(secs, 0) * 1000, 5000);
    const when = Date.parse(h);
    if (!Number.isNaN(when)) return Math.min(Math.max(when - Date.now(), 0), 5000);
  } catch (_) { /* fall through */ }
  return null;
}

/* ---------- cache versioning ---------------------------------------------- */

/**
 * Namespace a cache key with the schema version so entries written by the
 * pre-correction selector cannot be served after this change. Those entries
 * recorded a first-result guess as though it were an exact match; they must
 * expire by construction, not by waiting out a 30-day TTL.
 */
function versionedCacheKey(rawKey) {
  return `idv${CACHE_SCHEMA_VERSION}:${rawKey}`;
}

function isCurrentCacheEntry(entry) {
  return !!entry && entry.schemaVersion === CACHE_SCHEMA_VERSION;
}

function stampCacheEntry(payload) {
  return { ...payload, schemaVersion: CACHE_SCHEMA_VERSION };
}

export {
  END as END_STATES,
  CACHE_SCHEMA_VERSION,
  MAX_CONFIRMATION_CANDIDATES,
  resolveIdentity,
  checkCandidate,
  compareField,
  normNumber,
  normText,
  stripEditorial,
  withBoundedRetry,
  classifyStatus,
  versionedCacheKey,
  isCurrentCacheEntry,
  stampCacheEntry,
};
