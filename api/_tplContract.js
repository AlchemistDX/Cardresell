// api/_tplContract.js
// The TCGPriceLookup proxy's request contract, extracted so it can be tested
// without network and without a running function.
//
// WHY THIS EXISTS
//
// `api/tpl-proxy.js` previously forwarded every query parameter it received
// (`:32-37` before 2026-09-09) to a PAID upstream, with no caller
// authentication and no usage limit. The narrow fix is to reject anything the
// client contract does not name, BEFORE the upstream call, so an unrecognised
// request costs nothing.
//
// WHAT THIS DOES NOT DO — stated because the earlier version of this fix was
// described as more than it was:
//
//   * It does NOT eliminate cache bypass. Vercel keys dynamic responses by the
//     INCOMING request URL, so distinct incoming URLs remain distinct cache
//     entries regardless of what we forward upstream. Normalising the upstream
//     request does not merge those entries.
//   * It does NOT bound spending. Distinct VALID requests still miss the cache
//     and still reach the provider. Bounding spend needs a server-side cache
//     plus an aggregate cap (R4), not this.
//
// What it does: closes the UNKNOWN-PARAMETER path, so junk and duplicated
// parameters are rejected with 400 and `no-store` and make zero upstream calls.
//
// THE CONTRACT IS DERIVED FROM BOTH CLIENTS, not from one bundle:
//   production commit 9aaf326e7 ships js/core.569ff536.js
//   HEAD (outgoing)              ships js/core.66c39922.js
// Both call exactly three sites, with the same parameters:
//   /v1/cards/search  q, game, limit=100
//   /v1/cards/search  q, game, limit=20
//   /v1/cards/<id>    (no parameters)
// Neither client calls /v1/cards/lookup.

/**
 * Per-path parameter contract. A path absent from this map is not proxied.
 * `params` lists every accepted name; anything else is rejected.
 */
export const TPL_CONTRACT = [
  {
    // /v1/cards/search
    match: /^\/v1\/cards\/search$/,
    params: {
      q:     { required: true,  validate: (v) => v.length >= 1 && v.length <= 200,
               hint: 'q must be 1-200 characters' },
      game:  { required: false, validate: (v) => /^[a-z0-9][a-z0-9-]{0,31}$/.test(v),
               hint: 'game must be a lowercase slug' },
      limit: { required: false, validate: (v) => /^[0-9]{1,3}$/.test(v)
                                              && +v >= 1 && +v <= 100,
               hint: 'limit must be an integer 1-100' },
    },
  },
  {
    // /v1/cards/<id> — the id lives in the path; no parameters are accepted.
    match: /^\/v1\/cards\/[A-Za-z0-9_-]{1,64}$/,
    params: {},
  },
  // LIMITATION, stated rather than hidden: TPL ids are opaque, so the id
  // pattern above also matches the literal string "lookup". We cannot tell an
  // id named "lookup" from the retired endpoint. What IS closed is the
  // parameterised form — the only useful one.
  //
  // /v1/cards/lookup is deliberately ABSENT. It was allow-listed at
  // tpl-proxy.js:25 but is called by NEITHER client (0 occurrences in
  // core.569ff536.js and core.66c39922.js), so it was a billable path reachable
  // by anyone for no product reason. Removing it is behaviour-preserving for
  // the app. If a future client needs it, add it here WITH a named parameter
  // list rather than restoring an unparameterised entry.
];

/**
 * Validate an incoming query object (Vercel's `req.query` shape: values are
 * strings, or ARRAYS when a parameter is repeated).
 *
 * @returns {{ok: true, path: string, upstreamQuery: URLSearchParams}}
 *        | {ok: false, status: number, error: string, detail?: string}
 */
export function validateTplRequest(query) {
  const q = query && typeof query === 'object' ? query : {};

  // `path` itself may be duplicated. Reject rather than picking one, which is
  // what the old `Array.isArray(v) ? v[0] : v` did silently.
  if (Array.isArray(q.path)) {
    return { ok: false, status: 400, error: 'duplicate parameter',
             detail: 'path was supplied more than once' };
  }
  const path = typeof q.path === 'string' ? q.path : '';
  if (!path) {
    return { ok: false, status: 400, error: 'path required' };
  }

  const entry = TPL_CONTRACT.find((e) => e.match.test(path));
  if (!entry) {
    return { ok: false, status: 400, error: 'path not allowed' };
  }

  const upstreamQuery = new URLSearchParams();

  for (const [name, raw] of Object.entries(q)) {
    if (name === 'path') continue;

    // A repeated parameter is rejected, not collapsed. Collapsing silently
    // picks a value the caller did not unambiguously ask for, and a silent
    // choice is the bug.
    if (Array.isArray(raw)) {
      return { ok: false, status: 400, error: 'duplicate parameter',
               detail: `${name} was supplied more than once` };
    }

    const spec = entry.params[name];
    if (!spec) {
      // The whole point: an unnamed parameter costs nothing upstream.
      return { ok: false, status: 400, error: 'unknown parameter',
               detail: `${name} is not accepted for this path` };
    }

    const value = typeof raw === 'string' ? raw : String(raw ?? '');
    if (!spec.validate(value)) {
      return { ok: false, status: 400, error: 'invalid parameter',
               detail: spec.hint };
    }
    upstreamQuery.append(name, value);
  }

  for (const [name, spec] of Object.entries(entry.params)) {
    if (spec.required && !upstreamQuery.has(name)) {
      return { ok: false, status: 400, error: 'missing parameter',
               detail: `${name} is required for this path` };
    }
  }

  return { ok: true, path, upstreamQuery };
}
