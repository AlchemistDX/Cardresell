// Eligibility only: ownership always remains the cryptographically verified UID.
// Email-code admission requires both the authenticated account email and the
// server-owned proof for that exact UID to match the approved pilot address.
export function createMembershipLivePilot(raw = '[]') {
  const emails = JSON.parse(raw);
  if (!Array.isArray(emails) || emails.length > 5 || emails.some(email =>
    typeof email !== 'string' || email.length > 254 || email !== email.trim()
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw Error('invalid_live_pilot');
  const approved = new Set(emails.map(email => email.toLowerCase()));
  return identity => {
    if (identity?.verified !== true || typeof identity.uid !== 'string' || !identity.uid
      || typeof identity.email !== 'string') return false;
    if (identity.verificationSource !== undefined) {
      if (identity.verificationSource !== 'stored_account_verification'
        || typeof identity.authenticatedEmail !== 'string' || typeof identity.verificationEmail !== 'string'
        || identity.authenticatedEmail.toLowerCase() !== identity.verificationEmail.toLowerCase()
        || identity.email.toLowerCase() !== identity.verificationEmail.toLowerCase()) return false;
    }
    return approved.has(identity.email.toLowerCase());
  };
}
