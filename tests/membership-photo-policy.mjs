import assert from 'node:assert/strict';
import { photoStorageStatus, checkPhotoAdmission, photoProcessingFeedback,
  PHOTO_RETENTION_COPY } from '../api/_membershipPhotoPolicy.js';
import { LAUNCH_PLANS } from '../api/_launchMembershipConfig.js';
import { UPLOAD_MAX_BYTES } from '../api/_photoHost.js';

let checks = 0;
function eq(actual, expected) { assert.deepEqual(actual, expected); checks++; }
const ledger = (retainedBytes = 0, reservedBytes = 0) =>
  ({ version: 'launch-v2', ready: true, retainedBytes, reservedBytes });
const input = { serverPlan: 'free', ledger: ledger(), bytes: 1,
  contentType: 'image/jpeg', origin: 'seller', authoritativePhotoCount: 0 };
const check = overrides => checkPhotoAdmission({ ...input, ...overrides });
for (const [serverPlan, plan] of Object.entries(LAUNCH_PLANS)) {
  eq(photoStorageStatus({ serverPlan, ledger: ledger() }).limitBytes, plan.photoStorageBytes);
  const full = photoStorageStatus({ serverPlan, ledger: ledger(plan.photoStorageBytes) });
  eq(full.availableBytes, 0);
  eq(full.warning, true);
  eq(full.mayReadExisting, true);
  eq(full.mayExportExisting, true);
  eq(full.overLimit, false);
  const over = photoStorageStatus({ serverPlan, ledger: ledger(plan.photoStorageBytes + 1) });
  eq(over.overLimit, true);
  eq(over.availableBytes, 0);
}
for (const serverPlan of ['constructor', '__proto__', '', null, 'ultimate']) {
  eq(check({ serverPlan }).code, 'unknown_plan');
}
for (const value of [undefined, {}, { ...ledger(), ready: false },
  { ...ledger(), version: 'legacy' }, ledger(-1), ledger(0, -1),
  ledger(NaN), ledger(Infinity), ledger('1'), ledger(0.5),
  ledger(Number.MAX_SAFE_INTEGER, 1)]) {
  eq(check({ ledger: value }).code, 'storage_not_ready');
}
for (const bytes of [0, -1, 0.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  eq(check({ bytes }).code, 'invalid_bytes');
}
eq(check({ bytes: UPLOAD_MAX_BYTES }).ok, true);
eq(check({ bytes: UPLOAD_MAX_BYTES + 1 }).code, 'file_too_large');
for (const contentType of ['image/png', 'image/jpeg']) eq(check({ contentType }).ok, true);
for (const contentType of ['constructor', '__proto__', 'image/svg+xml', null]) {
  eq(check({ contentType }).code, 'unsupported_type');
}
for (const origin of ['catalogue', 'reference', undefined, '__proto__']) {
  eq(check({ origin }).code, 'not_seller_photo');
}
eq(check({ origin: 'scan' }).ok, true);
eq(check({ authoritativePhotoCount: 11 }).ok, true);
eq(check({ authoritativePhotoCount: 12 }).code, 'photo_count_limit');
for (const authoritativePhotoCount of [undefined, -1, '0', 0.5]) {
  eq(check({ authoritativePhotoCount }).code, 'photo_count_unverified');
}
eq(check({ ledger: ledger(99_999_998, 1) }).ok, true);
eq(check({ ledger: ledger(99_999_998, 2) }).code, 'storage_limit');
eq(check({ ledger: ledger(101_000_000) }).code, 'storage_limit');
eq(photoStorageStatus({ serverPlan: 'free', ledger: ledger(89_999_999) }).warning, false);
eq(photoStorageStatus({ serverPlan: 'free', ledger: ledger(90_000_000) }).warning, true);
eq(check().requiresAtomicReservation, true);
eq(check().requiresEnforceableUploadCapability, true);
const before = JSON.stringify(input);
checkPhotoAdmission(input);
eq(JSON.stringify(input), before);
for (const code of ['constructor', '__proto__', 'secret-token', null]) {
  eq(photoProcessingFeedback(code), 'Photo processing could not be completed. Please retry.');
}
eq(photoProcessingFeedback('cleanup_pending').includes('confirmed'), true);
eq(Object.isFrozen(PHOTO_RETENTION_COPY), true);
console.log(`${checks} passed, 0 failed. Dormant pure policy only; no storage ledger, atomic admission, provider enforcement or managed upload proof.`);
