/**
 * The authorization preamble for every photo endpoint.
 *
 * Both the ticket endpoint and the completion endpoint must answer the same
 * three questions in the same order, with the same status codes. Writing that
 * twice would be two implementations of one business behaviour, and the two
 * would drift -- the ownership bug this codebase already found (a truthiness
 * check on a result object that is never null) would have had to be fixed in
 * two places. It lives here once.
 *
 * REFUSAL ORDER, and why each status is what it is:
 *   1. No/short token, or a token that will not verify   -> 401
 *   2. A synthetic test namespace                        -> 403
 *   3. A malformed draft id                              -> 400
 *   4. A draft this caller does not own, or that is absent -> 404
 *   5. Storage that could not be read                    -> 503
 *
 * (4) is a 404 and not a 403 on purpose. `getDraft(kv, googleSub, draftId)`
 * reads under the caller's own namespace, so another seller's draft is not
 * visible here at all; reporting it as forbidden would confirm the id exists.
 * CORS is not the authorization boundary -- this is.
 *
 * (5) matters: a failed READ is not absence. Telling a seller their draft does
 * not exist when we merely could not read it is a silent omission wearing a
 * different coat.
 */

import { verifyTokenFlexible } from './_verifyToken.js';
import { makeKv } from './_kv.js';
import { getDraft, isSyntheticTestSub, isDraftId, ERR as STORE_ERR } from './_draftStore.js';

export function setPhotoCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * @returns {{ok:true, googleSub, kv, draftId, draft}}
 *        | {ok:false, status:number, body:object}
 */
export async function authorizeDraftPhotoRequest(req, draftIdRaw) {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) {
    return { ok: false, status: 503, body: { error: 'Storage unavailable' } };
  }

  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken || idToken.length < 20) {
    return { ok: false, status: 401, body: { error: 'Sign in required' } };
  }

  let googleSub = '';
  try {
    const info = await verifyTokenFlexible(idToken);
    googleSub = info.uid;
  } catch {
    return { ok: false, status: 401, body: { error: 'Invalid or expired token' } };
  }
  if (!googleSub) {
    return { ok: false, status: 401, body: { error: 'Sign in required' } };
  }
  if (isSyntheticTestSub(googleSub)) {
    return { ok: false, status: 403, body: { error: 'Reserved account namespace' } };
  }

  const draftId = String(draftIdRaw || '');
  if (!draftId || !isDraftId(draftId)) {
    return { ok: false, status: 400, body: { error: 'A draft id is required' } };
  }

  const kv = makeKv(kvUrl, kvToken);

  let found;
  try {
    found = await getDraft(kv, googleSub, draftId);
  } catch {
    return { ok: false, status: 503, body: { error: 'Storage unavailable' } };
  }
  /* `ok` is the only field that answers "may this caller use this draft".
     getDraft returns a result object and never null, so a truthiness check
     here is always true -- that is exactly how a non-owner once reached the
     host step. */
  if (!found || found.ok !== true) {
    if (found && found.error === STORE_ERR.STORE_UNAVAILABLE) {
      return { ok: false, status: 503, body: { error: 'Storage unavailable' } };
    }
    return { ok: false, status: 404, body: { error: 'Draft not found' } };
  }

  return { ok: true, googleSub, kv, draftId, draft: found.draft || found.value || null };
}

/** A photo id is opaque and client-minted; it must still be a safe key
 *  component, because it lands in an object key. */
export function checkPhotoId(value) {
  const s = String(value || '');
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : '';
}
