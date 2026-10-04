// Eligibility for a separately authorized live pilot, never account ownership.
// Call only AFTER createMembershipAuthenticator has verified the Firebase token.
// A stored alternate-email verification is not Google/Firebase email authority.
export function createMembershipLivePilot(raw = '[]') {
  const emails = JSON.parse(raw);
  if (!Array.isArray(emails) || emails.length > 5 || emails.some(email =>
    typeof email !== 'string' || email.length > 254 || email !== email.trim()
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw Error('invalid_live_pilot');
  const approved = new Set(emails.map(email => email.toLowerCase()));
  return identity => identity?.verified === true
    && typeof identity.uid === 'string' && identity.uid.length > 0
    && identity.verificationSource === undefined
    && typeof identity.email === 'string'
    && approved.has(identity.email.toLowerCase());
}
