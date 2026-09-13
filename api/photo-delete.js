/**
 * POST /api/photo-delete -- remove hosted copies immediately.
 *
 * The retention policy has two triggers: expiry (30 days after the latest
 * export preparation) and an EXPLICIT removal. This is the explicit one, used
 * when a seller removes a photo or deletes a draft.
 *
 * WHY DELETION IS QUEUED BEFORE IT IS ATTEMPTED
 *
 * The cleanup row is written first, then the delete is attempted. If it were
 * the other way round, a crash between a failed delete and the write would
 * leave an object in R2 that nothing knows to remove -- an orphan that keeps
 * costing storage and, worse, keeps a seller's photograph reachable after they
 * asked for it to be gone. A failed deletion therefore stays PENDING and
 * visible as pending cleanup rather than being reported as done.
 *
 * R2's own lifecycle rules are a BACKSTOP for rows this path loses, not the
 * mechanism: a lifecycle rule cannot honour an explicit removal promptly.
 *
 * TWO SCOPES:
 *   {photoId, sha256} -- one photograph, replaced or removed.
 *   {scope:'draft'}   -- the whole draft, deleted. Every hosted key listed by
 *                        the caller for that draft, under this owner's prefix.
 *
 * A caller can only ever name keys inside its OWN prefix: every key is
 * recomputed or prefix-checked against the caller's HMAC namespace, so a
 * request to delete another seller's object is refused rather than executed.
 */

import { setPhotoCors, authorizeDraftPhotoRequest, checkPhotoId } from './_photoAuth.js';
import { resolvePhotoProvider } from './_photoProvider.js';
import { PHOTO_HOST_ERR } from './_photoHost.js';
import { queueCleanup, markCleanup, pendingCleanup } from './_photoRetention.js';

export default async function handler(req, res) {
  setPhotoCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = (req.body && typeof req.body === 'object') ? req.body : {};

  const auth = await authorizeDraftPhotoRequest(req, body.draftId || (req.query && req.query.id));
  if (!auth.ok) return res.status(auth.status).json(auth.body);
  const { googleSub, draftId } = auth;

  const provider = resolvePhotoProvider(process.env);
  if (!provider.host) {
    /* Nothing is hosted, so there is nothing to delete. This is a success:
       the requested end state -- no hosted copies -- already holds. */
    return res.status(200).json({ deleted: [], pending: [], hosted: false });
  }
  const host = provider.host;

  let ownerNs;
  try {
    ownerNs = host.ownerNamespace(googleSub);
  } catch (err) {
    return res.status(500).json({
      error: 'Could not resolve the photo key',
      code: (err && err.code) || 'PHOTO_KEY_FAILED',
    });
  }

  /* Every key must sit under this owner's own draft prefix. This is the
     authorization check for deletion: ownership of the DRAFT was established
     above, and this confines the operation to that draft's objects. */
  const allowedPrefix = `seller-photos/${ownerNs}/${draftId}/`;

  const requested = [];
  if (Array.isArray(body.objectKeys)) {
    for (const k of body.objectKeys) requested.push(String(k));
  }
  if (body.photoId) {
    const pid = checkPhotoId(body.photoId);
    if (!pid) return res.status(400).json({ error: 'A photo id is required' });
    /* A photo is addressed by key because the hash is part of the name; the
       caller holds the key from its hosted record. Nothing is guessed. */
    if (!requested.length) {
      return res.status(400).json({ error: 'The hosted key for that photo is required' });
    }
  }
  if (!requested.length) {
    return res.status(400).json({ error: 'Nothing to delete' });
  }

  const outside = requested.filter((k) => !k.startsWith(allowedPrefix));
  if (outside.length) {
    /* Refuse the whole request rather than deleting the subset that happens to
       be permitted: a request naming a key outside this draft is not a request
       we understand, and partially honouring an ambiguous instruction is how
       the wrong object gets destroyed. */
    return res.status(400).json({
      error: 'Those photos do not belong to this draft',
      code: 'PHOTO_KEY_MISMATCH',
      count: outside.length,
    });
  }

  let queue = Array.isArray(body.cleanupQueue) ? body.cleanupQueue : [];
  const now = Date.now();
  const reason = String(body.reason || 'REMOVED');

  const deleted = [];
  for (const key of requested) {
    queue = queueCleanup(queue, { objectKey: key, reason, nowMs: now });
    let result;
    try {
      result = await host.remove(key);
    } catch (err) {
      result = { ok: false, detail: (err && err.message) || PHOTO_HOST_ERR.UPLOAD_FAILED };
    }
    queue = markCleanup(queue, key, result, Date.now());
    if (result && result.ok) deleted.push(key);
  }

  const pending = pendingCleanup(queue);
  /* 200 even with pending rows. The deletions that succeeded really did, and
     the caller is handed the queue so the pending ones stay visible. A 500
     here would suggest nothing happened. */
  return res.status(200).json({
    deleted,
    pending,
    cleanupQueue: queue,
    hosted: true,
  });
}
