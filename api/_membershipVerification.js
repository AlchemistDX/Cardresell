// Preserve the existing UID-keyed account verification contract. This is not
// email-to-UID matching and does not manufacture Firebase email_verified claims.
// Only invoke for an already authenticated Firebase subject.
export async function readMembershipVerification(execute, uid, now = Date.now(), onDiagnostic) {
  const observe = stage => { try { onDiagnostic?.(stage); } catch {} };
  if (typeof uid !== 'string' || !uid || uid.length > 128 || /[\u0000-\u001f\u007f]/.test(uid)) return null;
  let raw;
  try { raw = await execute(['GET', `email_verified:${uid}`]); }
  catch (error) { observe('stored_verification_read_failed'); throw error; }
  if (raw === null) { observe('stored_verification_missing'); return null; }
  let record;
  try { record = JSON.parse(raw); } catch { observe('stored_verification_malformed_json'); return null; }
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    observe('stored_verification_invalid_record'); return null;
  }
  if (record.verified === false || record.emailVerified === false) {
    observe('stored_verification_negative'); return null;
  }
  if (typeof record.verifiedAt !== 'string') { observe('stored_verification_invalid_record'); return null; }
  const time = Date.parse(record.verifiedAt);
  if (!Number.isFinite(time) || time < 0 || time > now) {
    observe('stored_verification_invalid_timestamp'); return null;
  }
  // Historical records need not have an email or a "via" field. Do not invent
  // either, relabel their source, or infer verification from tier/bonus flags.
  const email = typeof record.email === 'string' && record.email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email) ? record.email : null;
  observe('stored_verification_accepted');
  return { verified: true, email, source: 'stored_account_verification' };
}
