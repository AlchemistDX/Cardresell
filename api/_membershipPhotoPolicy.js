// Dormant launch-v2 policy. This is neither an upload capability nor a quota
// reservation. A future server transaction must recheck authoritative counters
// and reserve bytes atomically before issuing an enforceable upload capability.
import { LAUNCH_PLANS } from './_launchMembershipConfig.js';
import { EBAY_PHOTO_MAX, UPLOAD_CONTENT_TYPES, UPLOAD_MAX_BYTES } from './_photoHost.js';

const integer = value => Number.isSafeInteger(value) && value >= 0;
const failure = (code, message) => Object.freeze({ ok: false, code, message });

export const PHOTO_RETENTION_COPY = Object.freeze({
  retained: 'Storage includes retained seller-photo versions and derivatives. Archiving a listing does not free photo storage.',
  deletion: 'Storage is released only after an unreferenced file has been physically deleted. Files still needed by another record are retained.',
  downgrade: 'Existing photos remain accessible when you are above your plan limit. New uploads are blocked until enough space is available.',
  duplicate: 'A duplicated listing needs its own photos of the physical card. Seller photos are not copied.',
});

function planFor(name) {
  return typeof name === 'string' && Object.hasOwn(LAUNCH_PLANS, name)
    ? LAUNCH_PLANS[name] : null;
}

// Inputs must come from a reconciled authoritative server ledger, never browser
// metadata or a cache index. Missing/unknown legacy inventory fails closed.
export function photoStorageStatus({ serverPlan, ledger } = {}) {
  const plan = planFor(serverPlan);
  if (!plan) return failure('unknown_plan', 'Your plan could not be verified. Please retry.');
  if (!ledger || ledger.version !== 'launch-v2' || ledger.ready !== true ||
      !integer(ledger.retainedBytes) || !integer(ledger.reservedBytes) ||
      !Number.isSafeInteger(ledger.retainedBytes + ledger.reservedBytes)) {
    return failure('storage_not_ready', 'Photo storage accounting is unavailable. Existing photos remain available; please retry uploads later.');
  }
  const usedBytes = ledger.retainedBytes + ledger.reservedBytes;
  const limitBytes = plan.photoStorageBytes;
  return Object.freeze({
    ok: true, retainedBytes: ledger.retainedBytes,
    reservedBytes: ledger.reservedBytes, usedBytes, limitBytes,
    availableBytes: Math.max(0, limitBytes - usedBytes),
    overLimit: usedBytes > limitBytes,
    warning: usedBytes >= Math.ceil(limitBytes * 0.9),
    // Never gate reading/exporting existing work on storage usage.
    mayReadExisting: true, mayExportExisting: true,
  });
}

export function checkPhotoAdmission({
  serverPlan, ledger, bytes, contentType, origin, authoritativePhotoCount,
} = {}) {
  const status = photoStorageStatus({ serverPlan, ledger });
  if (!status.ok) return status;
  if (!integer(bytes) || bytes === 0) {
    return failure('invalid_bytes', 'The photo must have a valid, positive file size.');
  }
  if (typeof contentType !== 'string' || !Object.hasOwn(UPLOAD_CONTENT_TYPES, contentType)) {
    return failure('unsupported_type', 'Upload a JPEG or PNG seller photo.');
  }
  if (origin !== 'seller' && origin !== 'scan') {
    return failure('not_seller_photo', 'Use your own photo of this physical card, not a catalogue image.');
  }
  if (!integer(authoritativePhotoCount)) {
    return failure('photo_count_unverified', 'The listing’s photo count could not be verified. Please retry.');
  }
  if (authoritativePhotoCount >= EBAY_PHOTO_MAX) {
    return failure('photo_count_limit', `This listing supports at most ${EBAY_PHOTO_MAX} photos.`);
  }
  // Preserve the existing technical file ceiling. Storage plan units remain
  // decimal bytes; do not label this binary-sized file ceiling as "20 MB".
  if (bytes > UPLOAD_MAX_BYTES) {
    return failure('file_too_large', `Use a photo no larger than ${UPLOAD_MAX_BYTES.toLocaleString('en-US')} bytes.`);
  }
  if (bytes > status.availableBytes) {
    return failure('storage_limit', 'There is not enough photo storage. Existing photos and exports remain available.');
  }
  return Object.freeze({
    ok: true, bytesToReserve: bytes, availableBytes: status.availableBytes,
    requiresAtomicReservation: true,
    requiresEnforceableUploadCapability: true,
  });
}

// Safe, allowlisted user-facing errors. Never render provider responses, object
// keys, tokens, URLs, or request bodies as a failure message.
export function photoProcessingFeedback(code) {
  const messages = {
    queued: 'Your photos are queued. Keep this page open while processing finishes.',
    rate_limited: 'Photo processing is busy. Wait before retrying; deleting listings does not reset processing limits.',
    upload_failed: 'The photo upload could not be confirmed. Retry the same upload rather than creating another listing.',
    cleanup_pending: 'Deletion is pending. Storage usage will update after file removal is confirmed.',
  };
  return typeof code === 'string' && Object.hasOwn(messages, code)
    ? messages[code] : 'Photo processing could not be completed. Please retry.';
}
