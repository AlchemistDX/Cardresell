// Called only AFTER the Firebase JWT signature, project and claims are checked.
// Firebase's primary email can be absent/unverified even when Google sign-in
// succeeded. Resolve the Google provider record for this signed UID instead of
// trusting a client email, merely linked provider, or an email-to-UID mapping.
const LOOKUP = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=AIzaSyByHlvesKEFGqOTPPx35b1gAG-4zgrPt-c';
const normalize = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

export async function readGoogleProviderVerification(token, claims, request = fetch) {
  if (claims.firebase?.sign_in_provider !== 'google.com') return null;
  const subjects = claims.firebase?.identities?.['google.com'];
  if (!Array.isArray(subjects) || subjects.length !== 1
    || typeof subjects[0] !== 'string' || !subjects[0]) return null;
  const response = await request(LOOKUP, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Error('google_verification_unavailable');
  const body = await response.json();
  if (!Array.isArray(body.users) || body.users.length !== 1) return null;
  const account = body.users[0];
  if (account.localId !== claims.sub || account.disabled === true || account.tenantId) return null;
  if (account.validSince !== undefined
    && (!/^\d+$/.test(String(account.validSince)) || Number(account.validSince) > claims.iat)) return null;
  const providers = (Array.isArray(account.providerUserInfo) ? account.providerUserInfo : [])
    .filter(p => p.providerId === 'google.com');
  if (providers.length !== 1 || providers[0].rawId !== subjects[0]) return null;
  const email = normalize(providers[0].email);
  // Google is authoritative for Gmail addresses. Other domains still require
  // explicit verification; a Google-linked non-Gmail address alone is not proof.
  // https://firebase.google.com/docs/auth/users#verified_email_addresses
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com$/.test(email) || email.length > 254) return null;
  // Never certify a different primary address, even on this same account.
  if ((account.email && normalize(account.email) !== email)
    || (claims.email && normalize(claims.email) !== email)) return null;
  return { email, emailVerified: true };
}
