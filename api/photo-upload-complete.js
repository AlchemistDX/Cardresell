/**
 * POST /api/photo-upload-complete -- verify the object really exists, then record it.
 *
 * THE CLIENT'S WORD IS NOT EVIDENCE. The browser PUTs directly to R2, so the
 * only report this function gets is "I uploaded it". Recording that would make
 * the hosted URL a claim rather than a fact, and the failure would surface as
 * a listing with broken photographs -- the exact silent-omission shape this
 * codebase treats as the bug.
 *
 * So: a real HEAD against R2 before anything is recorded, comparing
 *
 *   - existence,
 *   - byte length against the ticket's declared length,
 *   - content type against the ticket's declared type,
 *   - and the key against the one this endpoint recomputes from the owner.
 *
 * THE KEY IS RECOMPUTED, NOT ACCEPTED. The client echoes back an objectKey,
 * but it is compared against a server-side recomputation from the caller's own
 * HMAC namespace. A client that invents a key gets a 400, so a caller cannot
 * register an object living under another seller's prefix as its own.
 *
 * THE PUBLIC URL IS BUILT HERE, from the bucket's configured public base --
 * never taken from the request.
 */

import { setPhotoCors, authorizeDraftPhotoRequest, checkPhotoId } from './_photoAuth.js';
import { resolvePhotoProvider, PHOTO_PROVIDER_STATE } from './_photoProvider.js';
import { PHOTO_HOST_ERR, checkUploadable } from './_photoHost.js';
import { retentionDays, expiryFrom, hostedRecord } from './_photoRetention.js';
import {
  verifyUploadReceipt, matchUploadReceipt, RECEIPT_ERR,
} from './_photoReceipt.js';

export default async function handler(req, res) {
  setPhotoCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = (req.body && typeof req.body === 'object') ? req.body : {};

  const auth = await authorizeDraftPhotoRequest(req, body.draftId || (req.query && req.query.id));
  if (!auth.ok) return res.status(auth.status).json(auth.body);
  const { googleSub, draftId } = auth;

  const photoId = checkPhotoId(body.photoId);
  if (!photoId) return res.status(400).json({ error: 'A photo id is required' });

  const sha256 = String(body.sha256 || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    return res.status(400).json({ error: 'A sha256 of the photo is required' });
  }

  const gate = checkUploadable({
    contentType: String(body.contentType || '').toLowerCase(),
    byteLength: Number(body.byteLength),
  });
  if (!gate.ok) {
    return res.status(400).json({ error: 'Photo not accepted', code: gate.reason });
  }

  const provider = resolvePhotoProvider(process.env);
  if (provider.state === PHOTO_PROVIDER_STATE.MISCONFIGURED) {
    return res.status(500).json({
      error: 'Photo hosting is configured incorrectly',
      code: 'PHOTO_HOST_MISCONFIGURED',
      missing: provider.missing || [],
    });
  }
  if (!provider.host) {
    return res.status(501).json({
      error: 'Photo hosting is not set up yet',
      code: PHOTO_HOST_ERR.NOT_CONFIGURED,
    });
  }
  const host = provider.host;

  // ── The key is recomputed, and the client's echo must match it ────────────
  let expectedKey;
  try {
    const ownerNs = host.ownerNamespace(googleSub);
    expectedKey = host.objectKey({ ownerNs, draftId, photoId, sha256, ext: gate.ext });
  } catch (err) {
    return res.status(500).json({
      error: 'Could not resolve the photo key',
      code: (err && err.code) || 'PHOTO_KEY_FAILED',
    });
  }
  if (String(body.objectKey || '') !== expectedKey) {
    return res.status(400).json({
      error: 'That upload does not match this draft',
      code: 'PHOTO_KEY_MISMATCH',
    });
  }

  /* ── THE RECEIPT ──────────────────────────────────────────────────────────
     Ownership has already been rechecked against the draft store above; the
     receipt is a separate question. It establishes that the tuple being
     completed is the one the TICKET endpoint issued -- same key, same type,
     same byte count, same checksum -- rather than numbers the client repeats
     now. Without it, a caller could ticket a 40 KB image and complete as
     though it were the 4 MB one, and the HEAD comparison would be against
     the client's later claim instead of the issued decision.

     Verified BEFORE the HEAD, because an unsigned or expired receipt should
     cost no storage round trip.

     A receipt signed for a different owner is refused as 403 rather than 400:
     it is a well-formed token being used by somebody it was not issued to. */
  let ownerNs;
  try {
    ownerNs = host.ownerNamespace(googleSub);
  } catch (err) {
    return res.status(500).json({ error: 'Could not resolve the photo owner',
                                  code: 'PHOTO_KEY_FAILED' });
  }

  const receipt = verifyUploadReceipt(process.env.PHOTO_KEY_SECRET, body.uploadReceipt);
  if (!receipt.ok) {
    const status = receipt.reason === RECEIPT_ERR.EXPIRED ? 410
      : receipt.reason === RECEIPT_ERR.NOT_CONFIGURED ? 500 : 400;
    return res.status(status).json({
      error: receipt.reason === RECEIPT_ERR.EXPIRED
        ? 'This upload took too long to confirm. Try the photo again.'
        : 'This upload could not be confirmed',
      code: receipt.reason,
    });
  }

  const declaredBytesForReceipt = Number(body.byteLength);
  const match = matchUploadReceipt(receipt.claims, {
    owner: ownerNs,
    draftId,
    photoId,
    objectKey: expectedKey,
    contentType: String(body.contentType || '').toLowerCase(),
    sha256,
    byteLength: declaredBytesForReceipt,
  });
  if (!match.ok) {
    const status = match.reason === RECEIPT_ERR.NOT_YOURS ? 403 : 400;
    return res.status(status).json({
      error: 'This upload could not be confirmed',
      code: match.reason,
      /* The FIELD that disagreed, never the values: one of them is the
         attacker's and one is ours, and echoing ours is a disclosure. */
      field: match.field || undefined,
    });
  }

  // ── The object must really be there ───────────────────────────────────────
  let head;
  try {
    head = await host.head(expectedKey);
  } catch (err) {
    return res.status(502).json({
      error: 'Could not confirm the uploaded photo',
      code: (err && err.code) || PHOTO_HOST_ERR.UPLOAD_FAILED,
    });
  }
  if (!head || head.exists !== true) {
    return res.status(409).json({
      error: 'The photo was not found in storage',
      code: 'PHOTO_NOT_UPLOADED',
    });
  }

  /* Size and type are compared to the DECLARED values. A mismatch means the
     bytes that landed are not the bytes the ticket was issued for, so the
     record would misdescribe the object. `head.byteLength` may be null if the
     provider omitted content-length; a missing value is not treated as a
     match. */
  const declaredBytes = Number(body.byteLength);
  if (!Number.isFinite(head.byteLength) || head.byteLength !== declaredBytes) {
    return res.status(409).json({
      error: 'The uploaded photo does not match what was prepared',
      code: 'PHOTO_SIZE_MISMATCH',
      expected: declaredBytes,
      observed: Number.isFinite(head.byteLength) ? head.byteLength : null,
    });
  }
  if (head.contentType && head.contentType.split(';')[0].trim() !== String(body.contentType).toLowerCase()) {
    return res.status(409).json({
      error: 'The uploaded photo does not match what was prepared',
      code: 'PHOTO_TYPE_MISMATCH',
    });
  }

  // ── Only now is it a fact ─────────────────────────────────────────────────
  let publicUrl;
  try {
    publicUrl = host.publicUrl(expectedKey);
  } catch (err) {
    return res.status(502).json({
      error: 'The photo host is configured with a URL eBay could not use',
      code: (err && err.code) || PHOTO_HOST_ERR.BAD_URL,
    });
  }

  const now = Date.now();
  const days = retentionDays(process.env);
  const record = hostedRecord({
    photoId,
    objectKey: expectedKey,
    publicUrl,
    sha256,
    contentType: String(body.contentType).toLowerCase(),
    byteLength: declaredBytes,
    /* `hostedAt` is when WE verified it, which is the moment the URL became a
       fact. `uploadedAt` is kept as the same instant and the same field name
       the store already reads, so no consumer has to learn a second name for
       one event. */
    uploadedAt: new Date(now).toISOString(),
    hostedAt: new Date(now).toISOString(),
    /* The storage provider's own identity for the stored bytes, recorded as
       observed. Opaque to us: it is never compared against our sha256 and
       never used to name anything. */
    etag: head.etag || null,
    expiresAt: expiryFrom(now, days),
  });

  return res.status(201).json({ hosted: record, draftId, retentionDays: days });
}
