/**
 * The upload receipt: what the ticket endpoint decided, made tamper-evident.
 *
 * WHY A RECEIPT AT ALL
 *
 * The ticket endpoint does the whole gate -- authentication, draft ownership,
 * photo id, MIME type, byte limit, the 12-photo cap, artwork refusal -- and
 * then hands the browser a presigned PUT. The completion endpoint runs later,
 * as a separate request, and has no memory of any of that. Without a receipt
 * it would have to re-derive every decision from numbers the CLIENT sends it,
 * which means a client could declare a different byte count or MIME type at
 * completion than the one the signature was issued for.
 *
 * So the ticket signs its own decision and the completion verifies it. The
 * receipt is not a session and not an authorisation: the completion endpoint
 * still authenticates the caller and still rechecks draft ownership. The
 * receipt only establishes that THIS (owner, draft, photo, key, type, size,
 * checksum, expiry) tuple is the one this server issued, and that it has not
 * been edited on the way back.
 *
 * WHAT IS BOUND, AND WHY EACH FIELD
 *
 *   owner       the opaque HMAC namespace, NOT the raw Google subject. The
 *               receipt travels through the browser, so the raw subject and
 *               the email stay out of it for the same reason they stay out of
 *               the object key.
 *   draftId     so a receipt for one draft cannot complete another.
 *   photoId     so a receipt cannot be reused for a different photo.
 *   objectKey   so the completion cannot be pointed at an arbitrary object.
 *   contentType
 *   byteLength  so the HEAD comparison is against the ISSUED numbers rather
 *   sha256      than against numbers the client repeats at completion time.
 *   expiresAt   so a receipt outlives neither the signature nor its purpose.
 *
 * WHY HMAC AND NOT A SIGNED COOKIE OR A KV ROW
 *
 * A KV row would be a second store to keep consistent, and an extra round
 * trip on a path that already does one HEAD. An HMAC under PHOTO_KEY_SECRET
 * needs no storage, and the secret is the same one that derives the owner
 * namespace -- one secret, one place it is configured, and a rotation
 * invalidates outstanding receipts, which is the correct behaviour.
 *
 * NO NEW DEPENDENCIES: node:crypto only.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Bumped if the claim set ever changes shape, so an old receipt is refused
 *  rather than misread. */
export const PHOTO_RECEIPT_VERSION = 1;

export const RECEIPT_ERR = Object.freeze({
  MISSING: 'RECEIPT_MISSING',
  MALFORMED: 'RECEIPT_MALFORMED',
  BAD_SIGNATURE: 'RECEIPT_BAD_SIGNATURE',
  EXPIRED: 'RECEIPT_EXPIRED',
  VERSION: 'RECEIPT_VERSION',
  NOT_CONFIGURED: 'RECEIPT_NOT_CONFIGURED',
  MISMATCH: 'RECEIPT_MISMATCH',
  NOT_YOURS: 'RECEIPT_NOT_YOURS',
});

const b64u = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (str) => Buffer.from(
  String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/* The claims are serialised in a FIXED field order rather than with
   JSON.stringify over an object, because key order in the round trip is not
   guaranteed and a signature over a differently-ordered encoding of the same
   claims would not verify. */
const FIELDS = ['v', 'owner', 'draftId', 'photoId', 'objectKey',
                'contentType', 'byteLength', 'sha256', 'expiresAt'];

function canonical(claims) {
  return JSON.stringify(FIELDS.map((f) => {
    const v = claims[f];
    return v === undefined || v === null ? '' : String(v);
  }));
}

/**
 * Sign a receipt. Returns `<payload>.<signature>`, both base64url.
 *
 * Throws when the secret is absent: a receipt that is not actually signed
 * would verify nothing, and failing closed here is the whole point.
 */
export function signUploadReceipt(secret, claims) {
  const s = String(secret || '');
  if (!s) {
    const e = new Error('signUploadReceipt: PHOTO_KEY_SECRET is not configured');
    e.code = RECEIPT_ERR.NOT_CONFIGURED;
    throw e;
  }
  for (const f of ['owner', 'draftId', 'photoId', 'objectKey', 'contentType', 'sha256', 'expiresAt']) {
    if (!String(claims[f] || '')) {
      const e = new Error('signUploadReceipt: missing ' + f);
      e.code = RECEIPT_ERR.MALFORMED;
      throw e;
    }
  }
  if (!Number.isFinite(Number(claims.byteLength)) || Number(claims.byteLength) <= 0) {
    const e = new Error('signUploadReceipt: byteLength must be a positive number');
    e.code = RECEIPT_ERR.MALFORMED;
    throw e;
  }
  const full = { ...claims, v: PHOTO_RECEIPT_VERSION, byteLength: Number(claims.byteLength) };
  const payload = b64u(Buffer.from(canonical(full), 'utf8'));
  const sig = b64u(createHmac('sha256', s).update(payload, 'utf8').digest());
  return `${payload}.${sig}`;
}

/**
 * Verify a receipt's signature and expiry, and return its claims.
 *
 * Returns a reason rather than throwing, because every reason maps to a
 * different HTTP answer at the completion endpoint.
 */
export function verifyUploadReceipt(secret, token, opts = {}) {
  const s = String(secret || '');
  if (!s) return { ok: false, reason: RECEIPT_ERR.NOT_CONFIGURED };
  const t = String(token || '');
  if (!t) return { ok: false, reason: RECEIPT_ERR.MISSING };

  const dot = t.indexOf('.');
  if (dot <= 0 || dot === t.length - 1) return { ok: false, reason: RECEIPT_ERR.MALFORMED };
  const payload = t.slice(0, dot);
  const given = t.slice(dot + 1);

  const expected = b64u(createHmac('sha256', s).update(payload, 'utf8').digest());
  /* Constant-time compare. The lengths are compared first because
     timingSafeEqual throws on a length mismatch, and a forged token of the
     wrong length must be a refusal rather than a 500. */
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: RECEIPT_ERR.BAD_SIGNATURE };
  }

  let arr;
  try {
    arr = JSON.parse(unb64u(payload).toString('utf8'));
  } catch {
    return { ok: false, reason: RECEIPT_ERR.MALFORMED };
  }
  if (!Array.isArray(arr) || arr.length !== FIELDS.length) {
    return { ok: false, reason: RECEIPT_ERR.MALFORMED };
  }
  const claims = {};
  FIELDS.forEach((f, i) => { claims[f] = arr[i]; });
  claims.byteLength = Number(claims.byteLength);
  if (Number(claims.v) !== PHOTO_RECEIPT_VERSION) {
    return { ok: false, reason: RECEIPT_ERR.VERSION };
  }

  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const exp = Date.parse(String(claims.expiresAt || ''));
  /* An unparseable expiry is expired. A receipt whose lifetime cannot be
     established must not be honoured. */
  if (!Number.isFinite(exp) || exp <= now) {
    return { ok: false, reason: RECEIPT_ERR.EXPIRED };
  }
  return { ok: true, claims };
}

/**
 * Does this receipt describe the request being completed, and is it the
 * caller's own?
 *
 * Split out from verification so the completion endpoint answers "forged or
 * expired" separately from "signed by us, but for somebody else's draft".
 */
export function matchUploadReceipt(claims, actual) {
  if (String(claims.owner) !== String(actual.owner)) {
    return { ok: false, reason: RECEIPT_ERR.NOT_YOURS };
  }
  const fields = ['draftId', 'photoId', 'objectKey', 'contentType', 'sha256'];
  for (const f of fields) {
    if (String(claims[f]) !== String(actual[f])) {
      return { ok: false, reason: RECEIPT_ERR.MISMATCH, field: f };
    }
  }
  if (Number(claims.byteLength) !== Number(actual.byteLength)) {
    return { ok: false, reason: RECEIPT_ERR.MISMATCH, field: 'byteLength' };
  }
  return { ok: true };
}
