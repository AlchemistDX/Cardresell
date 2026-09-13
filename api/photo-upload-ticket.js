/**
 * POST /api/photo-upload-ticket -- metadata in, a short-lived presigned PUT out.
 *
 * WHY A TICKET INSTEAD OF AN UPLOAD
 *
 * The previous endpoint relayed the image as base64 through this function. A
 * 2.5 MB iPhone photograph becomes ~3.4 MB on the wire, which can exceed the
 * platform's request-body boundary BEFORE any application code runs. The
 * seller would see an opaque platform error, and the byte gate -- the thing
 * that is supposed to explain the refusal -- would never execute. So this
 * endpoint accepts METADATA ONLY and never sees image bytes.
 *
 * WHAT IT WILL NOT TAKE FROM THE CLIENT
 *
 *   - The object key. Computed here, from an HMAC of the owner under a
 *     server-held secret. A client that could name its own key could write
 *     into another seller's prefix.
 *   - The public URL. The completion endpoint builds it from the bucket's
 *     configured base. A client-supplied URL is never authoritative.
 *   - Success. The signature here only permits a PUT; whether an object
 *     actually landed is established by a real HEAD in photo-upload-complete.
 *
 * The raw Google subject and the seller's email stay out of the key, because
 * these URLs are handed to eBay's importer and are public in practice.
 */

import { setPhotoCors, authorizeDraftPhotoRequest, checkPhotoId } from './_photoAuth.js';
import { resolvePhotoProvider, PHOTO_PROVIDER_STATE } from './_photoProvider.js';
import {
  checkUploadable,
  PHOTO_HOST_ERR,
  EBAY_PHOTO_MAX,
} from './_photoHost.js';
import { R2_PRESIGN_TTL_SECONDS } from './_r2Host.js';
import { signUploadReceipt } from './_photoReceipt.js';

export default async function handler(req, res) {
  setPhotoCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = (req.body && typeof req.body === 'object') ? req.body : {};

  /* Authentication and ownership first, before any provider work: a caller
     who does not own the draft must learn nothing about whether hosting is
     configured. */
  const auth = await authorizeDraftPhotoRequest(req, body.draftId || (req.query && req.query.id));
  if (!auth.ok) return res.status(auth.status).json(auth.body);
  const { googleSub, draftId } = auth;

  const photoId = checkPhotoId(body.photoId);
  if (!photoId) return res.status(400).json({ error: 'A photo id is required' });

  /* A CardResell-side cap, not an eBay requirement. Enforced here as well as
     in the browser store, because the browser is not a boundary. */
  const index = Number(body.index);
  if (Number.isFinite(index) && index >= EBAY_PHOTO_MAX) {
    return res.status(400).json({
      error: `A draft can host at most ${EBAY_PHOTO_MAX} photos`,
      code: PHOTO_HOST_ERR.TOO_MANY || 'TOO_MANY',
    });
  }

  /* The byte and type gate runs on the DECLARED metadata. The declaration is
     not trusted as final -- the completion HEAD compares the real object's
     size and type against it -- but refusing an unsupported type here saves
     the seller a pointless upload and gives them the app's own wording. */
  const gate = checkUploadable({
    contentType: String(body.contentType || '').toLowerCase(),
    byteLength: Number(body.byteLength),
  });
  if (!gate.ok) {
    const status = gate.reason === PHOTO_HOST_ERR.TOO_LARGE ? 413
      : gate.reason === PHOTO_HOST_ERR.EMPTY ? 400 : 415;
    return res.status(status).json({ error: 'Photo not accepted', code: gate.reason });
  }

  const sha256 = String(body.sha256 || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    return res.status(400).json({ error: 'A sha256 of the photo is required' });
  }

  /* ── REFERENCE ARTWORK IS REFUSED HERE, NOT ONLY AT CAPTURE ───────────────
     `_scanPhotoSnapshot` already refuses a catalogue https:// image in the
     browser by accepting only `data:image/` URLs, so artwork cannot reach the
     photo store. That is the first gate, and it is the one that matters in
     practice -- but it lives in code the client controls, so it is not a
     boundary. This is the boundary.

     Catalogue artwork is not a photograph of the seller's card. Hosting it
     under the seller's prefix and writing it into `Item photo URL` would put
     somebody else's image on their listing, which is the one thing the
     standing rule forbids outright.

     Two shapes are refused:
       - an origin that is not a local capture, and
       - any request carrying a remote source URL at all. A request that
         names a URL to fetch is asking for the remote-fetching service this
         design deliberately does not have. */
  const origin = String(body.origin || 'seller').toLowerCase();
  const LOCAL_ORIGINS = ['scan', 'seller'];
  const remoteish = ['sourceUrl', 'remoteUrl', 'artworkUrl', 'imageUrl', 'url', 'fetchUrl']
    .filter((k) => typeof body[k] === 'string' && body[k]);
  if (!LOCAL_ORIGINS.includes(origin) || remoteish.length) {
    return res.status(400).json({
      error: 'Only a photograph taken on this device can be uploaded',
      code: 'PHOTO_REFERENCE_ARTWORK',
    });
  }

  /* ── THE (DRAFT, PHOTO) PAIR ──────────────────────────────────────────────
     The photo is bound to this draft structurally rather than looked up:
     there is no server-side photo manifest to look it up in -- the manifest
     lives in the browser's IndexedDB, which is the whole reason hosting is
     needed. What this endpoint CAN guarantee, and does:

       - the caller owns `draftId` (established above, against the draft
         store, before any of this runs);
       - the object key is computed from (ownerNs, draftId, photoId, sha256),
         so a photo signed for one draft cannot be written under another;
       - the receipt binds the same tuple, and the completion endpoint
         recomputes the key and refuses any mismatch.

     So a photo cannot cross between drafts or between sellers. What is NOT
     established here is that the seller's device really holds a photo with
     this id -- an unverifiable claim, and a harmless one: the worst a client
     can do is reserve a key under its own prefix and never upload to it, and
     the completion HEAD refuses to record that as hosted. */

  const provider = resolvePhotoProvider(process.env);
  if (provider.state === PHOTO_PROVIDER_STATE.MISCONFIGURED) {
    /* Chosen but incomplete. This is a deployment mistake and must be visible
       rather than degrading into blank photo columns. The missing NAMES are
       safe to report; no value is ever echoed. */
    return res.status(500).json({
      error: 'Photo hosting is configured incorrectly',
      code: 'PHOTO_HOST_MISCONFIGURED',
      missing: provider.missing || [],
    });
  }
  if (!provider.host) {
    /* Not an error to hide: the seller's photographs are intact on their
       device; what is missing is somewhere to publish them to. The export
       path reads this code and says exactly that. */
    return res.status(501).json({
      error: 'Photo hosting is not set up yet',
      code: PHOTO_HOST_ERR.NOT_CONFIGURED,
    });
  }

  const host = provider.host;

  const contentType = String(body.contentType || '').toLowerCase();
  const byteLength = Number(body.byteLength);

  let objectKey;
  let putUrl;
  let publicUrl;
  let requiredHeaders;
  let expiresAt;
  let uploadReceipt;
  try {
    const ownerNs = host.ownerNamespace(googleSub);
    objectKey = host.objectKey({ ownerNs, draftId, photoId, sha256, ext: gate.ext });

    const signed = host.presignPut(objectKey, { contentType });
    putUrl = signed.url;
    expiresAt = signed.expiresAt;
    /* Returned rather than assumed. The browser must send exactly the headers
       the signature covers; a convention duplicated at the call site is the
       shape that drifts. */
    requiredHeaders = signed.requiredHeaders || {};

    /* Informational, and server-built. The completion endpoint rebuilds it
       from the configured base and ignores whatever the client sends back --
       a client-supplied public URL is never authoritative. Building it here
       too means a bad PHOTO_HOST_PUBLIC_BASE_URL is caught before the seller
       spends an upload on it. */
    publicUrl = host.publicUrl(objectKey);

    /* The gate's own decision, signed. See _photoReceipt.js for why. The
       owner claim is the opaque namespace, never the raw Google subject:
       this token travels through the browser. */
    uploadReceipt = signUploadReceipt(process.env.PHOTO_KEY_SECRET, {
      owner: ownerNs, draftId, photoId, objectKey,
      contentType, byteLength, sha256, expiresAt,
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Could not prepare the upload',
      code: (err && err.code) || 'PHOTO_TICKET_FAILED',
    });
  }

  return res.status(200).json({
    putUrl,
    publicUrl,
    objectKey,
    requiredHeaders,
    expiresAt,
    uploadReceipt,
    /* Echoed so the client can complete without re-deriving them, and so a
       mismatch between what it hashed and what was signed is visible. */
    photoId,
    draftId,
    sha256,
    contentType,
    byteLength,
    ttlSeconds: R2_PRESIGN_TTL_SECONDS,
  });
}
