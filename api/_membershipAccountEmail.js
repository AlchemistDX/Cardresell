// Recover a missing token email only from Firebase's authenticated account
// record. Never search by email, replace the signed UID, or accept client claims.
const ACCOUNT_LOOKUP = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=AIzaSyByHlvesKEFGqOTPPx35b1gAG-4zgrPt-c';
export async function readMembershipAccountEmail(token, uid, request = fetch) {
  const response = await request(ACCOUNT_LOOKUP, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Error('account_email_unavailable');
  const body = await response.json();
  if (!Array.isArray(body.users) || body.users.length !== 1) throw Error('account_email_unavailable');
  const account = body.users[0];
  if (account.localId !== uid || account.disabled === true) throw Error('account_email_unavailable');
  const valid = value => typeof value === 'string' && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (valid(account.email)) return account.email;
  const emails = (Array.isArray(account.providerUserInfo) ? account.providerUserInfo : [])
    .filter(provider => provider.providerId === 'google.com' && valid(provider.email))
    .map(provider => provider.email.toLowerCase());
  const unique = [...new Set(emails)];
  return unique.length === 1 ? unique[0] : null;
}
