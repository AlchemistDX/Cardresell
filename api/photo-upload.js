/**
 * POST /api/photo-upload?id=<draftId> -- host one seller photograph.
 *
 * WHAT THIS IS FOR. eBay's bulk-draft importer fetches photos from URLs, so a
 * photograph sitting in IndexedDB on the seller's phone cannot reach a
 * listing. This is the only door through which one becomes an https URL, and
 * it exists so that the authorization decision is made on the SERVER, from a
 * verified token and the draft's real owner -- not by a client that could ask
 * for any key it liked.
 *
 * THE THREE THINGS IT REFUSES, in this order:
 *   1. An unauthenticated caller.                          401
 *   2. An authenticated caller who does not own the draft.  404
 *   3. Bytes that are not an image type we can name.        415/413
 *
 * Ownership is established by READING THE DRAFT under the caller's own
 * namespace. `getDraft(kv, googleSub, draftId)` can only ever return a draft
 * that belongs to `googleSub`, so a draft id belonging to someone else is
 * indistinguishable from one that does not exist -- which is the correct
 * answer to give, and the reason this is a 404 and not a 403. CORS is not the
 * authorization boundary; this is.
 *
 * NO HOST IS CONFIGURED TODAY. `photoHostFromEnv` returns null until the
 * hosting decision is taken, and this handler then answers 501 with
 * PHOTO_HOST_NOT_CONFIGURED. That is a reported, handled outcome: the export
 * tells the seller photos were not hosted rather than writing a blank column
 * while claiming they went.
 */

import { verifyTokenFlexible } from './_verifyToken.js';
import { makeKv } from './_kv.js';
import { getDraft, isSyntheticTestSub, isDraftId, ERR as STORE_ERR } from './_draftStore.js';
import {
  photoHostFromEnv,
  checkUploadable,
  checkExportablePhotoUrl,
  photoObjectKey,
  PHOTO_HOST_ERR,
  UPLOAD_MAX_BYTES,
} from './_photoHost.js';

/* A base64 image inflates by 4/3 on the wire. The ceiling is applied to the
   DECODED length as well, below; this one only stops an oversized body from
   being decoded at all. */
const MAX_BODY_CHARS = Math.ceil((UPLOAD_MAX_BYTES * 4) / 3) + 1024;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return res.status(503).json({ error: 'Storage unavailable' });

  // ── 1. Authentication ────────────────────────────────────────────────────
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken || idToken.length < 20) return res.status(401).json({ error: 'Sign in required' });

  let googleSub = '';
  try {
    const info = await verifyTokenFlexible(idToken);
    googleSub = info.uid;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (!googleSub) return res.status(401).json({ error: 'Sign in required' });
  if (isSyntheticTestSub(googleSub)) {
    return res.status(403).json({ error: 'Reserved account namespace' });
  }

  const draftId = (req.query && req.query.id) ? String(req.query.id) : '';
  if (!draftId || !isDraftId(draftId)) {
    return res.status(400).json({ error: 'A draft id is required' });
  }

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const photoId = String(body.photoId || '');
  if (!photoId || !/^[A-Za-z0-9_-]{1,64}$/.test(photoId)) {
    return res.status(400).json({ error: 'A photo id is required' });
  }

  const kv = makeKv(kvUrl, kvToken);

  /* ── 2. Ownership ───────────────────────────────────────────────────────
     Read under the caller's own namespace. `draftKey(googleSub, draftId)`
     scopes the read to this account, so another seller's draft is not visible
     here at all and is reported as absent rather than as forbidden.

     getDraft returns a RESULT OBJECT -- `{ok:false, error:'DRAFT_NOT_FOUND'}`
     for an absent draft -- and never null. A truthiness check on it is
     therefore always true, which is how a non-owner reached the host step
     while the suite's ownership assertion was the only thing that noticed.
     `ok` is the only field that answers "may this caller use this draft".

     A failed READ is not absence. STORE_UNAVAILABLE answers 503, because
     telling a seller their draft does not exist when we merely could not read
     it is the silent-omission failure in a different coat. */
  let found;
  try {
    found = await getDraft(kv, googleSub, draftId);
  } catch {
    return res.status(503).json({ error: 'Storage unavailable' });
  }
  if (!found || found.ok !== true) {
    if (found && found.error === STORE_ERR.STORE_UNAVAILABLE) {
      return res.status(503).json({ error: 'Storage unavailable' });
    }
    return res.status(404).json({ error: 'Draft not found' });
  }

  // ── 3. The bytes ─────────────────────────────────────────────────────────
  const contentType = String(body.contentType || '').toLowerCase();
  const b64 = String(body.dataBase64 || '');
  if (!b64) return res.status(400).json({ error: 'No image data' });
  if (b64.length > MAX_BODY_CHARS) {
    return res.status(413).json({ error: 'Photo too large', code: PHOTO_HOST_ERR.TOO_LARGE });
  }

  let bytes;
  try {
    bytes = Buffer.from(b64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Unreadable image data' });
  }
  /* Buffer.from is lenient with invalid base64 -- it drops what it cannot
     decode rather than throwing -- so undecodable input arrives here as zero
     bytes rather than as an exception.

     HONEST NOTE: this line is defence in depth, not the load-bearing gate.
     Deleting it does not change any observable behaviour, because
     `checkUploadable` below independently refuses a zero byteLength with
     PHOTO_HOST_ERR.EMPTY. It is kept so the reason for the refusal is stated
     where the decode happens, but it must not be cited as the guard. */
  if (!bytes || bytes.length === 0) {
    return res.status(400).json({ error: 'Unreadable image data', code: PHOTO_HOST_ERR.EMPTY });
  }

  const gate = checkUploadable({ contentType, byteLength: bytes.length });
  if (!gate.ok) {
    const status = gate.reason === PHOTO_HOST_ERR.TOO_LARGE ? 413
      : gate.reason === PHOTO_HOST_ERR.EMPTY ? 400 : 415;
    return res.status(status).json({ error: 'Photo not accepted', code: gate.reason });
  }

  // ── 4. The host, which may not exist yet ─────────────────────────────────
  const host = photoHostFromEnv(process.env);
  if (!host) {
    /* Not an error to hide. The seller's photographs are intact on their
       device; what is missing is somewhere to publish them to. The export
       path reads this code and says exactly that. */
    return res.status(501).json({
      error: 'Photo hosting is not set up yet',
      code: PHOTO_HOST_ERR.NOT_CONFIGURED,
    });
  }

  const key = photoObjectKey({ ownerSub: googleSub, draftId, photoId, ext: gate.ext });

  let put;
  try {
    put = await host.put({ key, bytes, contentType });
  } catch (err) {
    return res.status(502).json({
      error: 'Could not upload the photo',
      code: (err && err.code) || PHOTO_HOST_ERR.UPLOAD_FAILED,
    });
  }

  /* What the provider handed back is checked against eBay's rules before it
     is returned. A provider that yields an http:// link, or a pre-signed URL
     past 2048 characters, has produced something eBay's importer would
     silently drop -- and a URL we never validated is not an exportable one. */
  const chk = checkExportablePhotoUrl(put && put.url);
  if (!chk.ok) {
    return res.status(502).json({
      error: 'The photo host returned a URL eBay could not use',
      code: PHOTO_HOST_ERR.BAD_URL,
      detail: chk.detail,
    });
  }

  return res.status(201).json({ url: put.url, photoId, draftId });
}
