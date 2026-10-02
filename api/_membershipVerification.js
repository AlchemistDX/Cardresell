// Preserve the existing UID-keyed account verification contract. This is not
// email-to-UID matching and does not manufacture Firebase email_verified claims.
// Only invoke for an already authenticated Firebase subject.
export async function readMembershipVerification(execute, uid, now = Date.now()) {
  if (typeof uid !== 'string' || !uid || uid.length > 128 || /[\u0000-\u001f\u007f]/.test(uid)) return null;
  const raw = await execute(['GET', `email_verified:${uid}`]);
  if (raw === null) return null;
  let record;
  try { record = JSON.parse(raw); } catch { return null; }
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || record.verified === false || record.emailVerified === false
    || typeof record.verifiedAt !== 'string') return null;
  const time = Date.parse(record.verifiedAt);
  if (!Number.isFinite(time) || time < 0 || time > now) return null;
  // Historical records need not have an email or a "via" field. Do not invent
  // either, relabel their source, or infer verification from tier/bonus flags.
  const email = typeof record.email === 'string' && record.email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email) ? record.email : null;
  return { verified: true, email, source: 'stored_account_verification' };
}
