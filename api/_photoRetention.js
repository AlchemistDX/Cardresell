/**
 * Retention bookkeeping for hosted export photos.
 *
 * THE POLICY (owner decision, 2026-09-13)
 *
 *   - A hosted photo expires 30 days after the LATEST export preparation.
 *   - Preparing another export renews unchanged photos before they approach
 *     expiry, so a seller who keeps exporting never loses a working CSV.
 *   - Removing a photo, or deleting its draft, requests immediate deletion.
 *   - A failed deletion stays QUEUED and visible as pending cleanup. It is not
 *     retried silently into oblivion and it is not dropped.
 *   - Reference artwork is never hosted, so it never appears here.
 *
 * R2 lifecycle rules can expire objects as a backstop, but they cannot renew
 * on export and cannot honour an explicit removal promptly, so the
 * application still owns this bookkeeping. The lifecycle rule is defence in
 * depth against a row this module loses -- not the mechanism.
 */

export const PHOTO_RETENTION_DAYS_DEFAULT = 30;

/**
 * Renew when the remaining life falls under a third of the window.
 *
 * A fixed absolute threshold would either renew on every export (pointless
 * writes) or leave a photo one day from expiry unrenewed because it was
 * exported "recently enough". A fraction of the window scales with a changed
 * PHOTO_RETENTION_DAYS without a second constant to keep in step.
 */
export const RENEW_WHEN_REMAINING_FRACTION = 1 / 3;

export const CLEANUP_STATE = Object.freeze({
  PENDING: 'PENDING',
  DONE: 'DONE',
});

export function retentionDays(env = process.env) {
  const n = Number((env && env.PHOTO_RETENTION_DAYS) || PHOTO_RETENTION_DAYS_DEFAULT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : PHOTO_RETENTION_DAYS_DEFAULT;
}

export function expiryFrom(nowMs, days) {
  return new Date(Number(nowMs) + Math.floor(days) * 86400000).toISOString();
}

/** Has this hosted photo already lapsed? An unparseable or absent expiry
 *  counts as expired: treating an unknown expiry as live is how a listing
 *  ships with a dead photo URL. */
export function isExpired(entry, nowMs) {
  const t = Date.parse((entry && entry.expiresAt) || '');
  if (!Number.isFinite(t)) return true;
  return t <= Number(nowMs);
}

/**
 * Should this photo be re-uploaded, renewed, or left alone?
 *
 *   'upload' -- nothing hosted, the hash changed, or it has already lapsed.
 *   'renew'  -- hosted and valid, but close enough to expiry to push out.
 *   'keep'   -- hosted, valid, comfortably live. Case 8: no upload.
 *
 * The hash comparison is what implements cases 8 and 9 together: identical
 * bytes mean an identical hash means the same object, and changed bytes mean a
 * new hash, hence a new upload and a changed export.
 */
export function planForPhoto({ hosted, sha256, nowMs, days }) {
  if (!hosted || !hosted.objectKey || !hosted.publicUrl) return 'upload';
  if (String(hosted.sha256 || '') !== String(sha256 || '')) return 'upload';
  if (isExpired(hosted, nowMs)) return 'upload';
  const t = Date.parse(hosted.expiresAt);
  const remaining = t - Number(nowMs);
  const window = Math.floor(days) * 86400000;
  if (remaining < window * RENEW_WHEN_REMAINING_FRACTION) return 'renew';
  return 'keep';
}

/**
 * The hosted-metadata record stored against a draft.
 *
 * Only metadata: never image bytes, and never a client-supplied URL. The URL
 * here is the one the SERVER built from the bucket's configured public base
 * and the server-computed key.
 */
export function hostedRecord({
  photoId, objectKey, publicUrl, sha256, contentType, byteLength,
  uploadedAt, hostedAt, etag, expiresAt,
}) {
  return {
    photoId: String(photoId),
    objectKey: String(objectKey),
    publicUrl: String(publicUrl),
    sha256: String(sha256),
    contentType: String(contentType),
    byteLength: Number(byteLength),
    uploadedAt: String(uploadedAt),
    /* When WE confirmed the object exists. Defaults to `uploadedAt` because
       they are the same instant on the only path that writes this record --
       the completion endpoint, after its HEAD. */
    hostedAt: String(hostedAt || uploadedAt),
    /* The provider's identity for the stored bytes, as observed. Nullable:
       a provider may omit it, and an absent ETag is recorded as absent
       rather than as an empty string that reads like a value. */
    etag: etag ? String(etag) : null,
    expiresAt: String(expiresAt),
  };
}

/* renewHosted() USED TO LIVE HERE, and it was wrong.
 *
 * It moved the recorded `expiresAt` forward while leaving the object in the
 * bucket untouched. That is only safe if retention is enforced by OUR expiry
 * field. It is not: `PHOTO_RETENTION_DAYS=30` is implemented as a Cloudflare
 * lifecycle rule keyed on the object's own age, so an object whose bytes were
 * last written 29 days ago is deleted on schedule no matter what our record
 * says. A renewal that only touched the record would produce exactly the
 * failure this whole design exists to prevent: a listing whose photo URLs are
 * live in our data and 404 at eBay.
 *
 * WHAT SHIPS INSTEAD. A renewal re-PUTs the bytes to the same key. The key is
 * derived from the content hash, so unchanged bytes land on the same object,
 * and the write resets the storage age the lifecycle rule reads. It costs one
 * Class A operation per renewed photo, roughly every twenty days per photo,
 * and it keeps one fact -- when these bytes were last written -- instead of
 * two that can disagree. That path is `_hostedPlan` returning 'renew' in the
 * client, which routes through the ordinary upload; the completion endpoint
 * then writes a fresh record with a fresh expiry.
 *
 * The alternative considered was a server-side S3 CopyObject onto the same
 * key, which also resets object age without moving bytes through the browser.
 * It was not taken: it needs a second signing path and a second set of failure
 * modes, and the re-PUT reuses the path that is already verified end to end.
 * If renewal volume ever makes the re-upload expensive, CopyObject is the
 * documented next step -- see audit/PHOTO_HOSTING_R2_PACKET.md.
 */

/**
 * Queue a deletion.
 *
 * Queued FIRST, then attempted. If the attempt fails the row is already
 * durable and the seller can see pending cleanup; if the row were written only
 * after a failure, a crash between the failed delete and the write would leave
 * an orphaned object that nothing knows to remove.
 */
export function queueCleanup(queue, { objectKey, reason, nowMs }) {
  const rows = Array.isArray(queue) ? queue.slice() : [];
  if (rows.some((r) => r.objectKey === objectKey && r.state === CLEANUP_STATE.PENDING)) return rows;
  rows.push({
    objectKey: String(objectKey),
    reason: String(reason || 'REMOVED'),
    state: CLEANUP_STATE.PENDING,
    queuedAt: new Date(Number(nowMs)).toISOString(),
    attempts: 0,
    lastError: null,
  });
  return rows;
}

export function markCleanup(queue, objectKey, result, nowMs) {
  return (Array.isArray(queue) ? queue : []).map((r) => {
    if (r.objectKey !== objectKey || r.state !== CLEANUP_STATE.PENDING) return r;
    if (result && result.ok) {
      return { ...r, state: CLEANUP_STATE.DONE, deletedAt: new Date(Number(nowMs)).toISOString(), lastError: null };
    }
    return {
      ...r,
      attempts: Number(r.attempts || 0) + 1,
      lastError: String((result && result.detail) || 'unknown'),
    };
  });
}

export function pendingCleanup(queue) {
  return (Array.isArray(queue) ? queue : []).filter((r) => r.state === CLEANUP_STATE.PENDING);
}

/**
 * The sentence shown on the export screen.
 *
 * It states the window and the consequence of deleting the source draft,
 * because a seller who deletes a draft and then imports a week-old CSV would
 * otherwise get a listing with broken photographs and no way to know why.
 */
export function retentionDisclosure(days) {
  const d = Math.floor(days);
  return `Photo links in this file stay available for ${d} days from this export. `
    + 'Exporting again renews them. Deleting this draft or its photos removes the '
    + 'hosted copies immediately, which leaves an unimported file without photos.';
}
