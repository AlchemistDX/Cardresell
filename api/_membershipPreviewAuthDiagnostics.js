// Temporary observation only: no identity values, token material, records,
// provider messages or caller-selected labels. Vercel supplies request context.
const stages = new Set([
  'token_received', 'token_claims_well_formed',
  'firebase_signature_claims_verified', 'subject_matched',
  'token_email_verified', 'token_email_unverified_or_absent',
  'stored_verification_lookup_started', 'stored_verification_missing',
  'stored_verification_malformed_json', 'stored_verification_invalid_record',
  'stored_verification_negative', 'stored_verification_invalid_timestamp',
  'stored_verification_read_failed', 'stored_verification_accepted',
  'stored_verification_unavailable', 'authentication_accepted',
  'authentication_rejected', 'preview_identity_authorized',
]);

export function membershipPreviewAuthDiagnostics(env, write = stage =>
  console.info('MEMBERSHIP_AUTH_PREVIEW_V1', stage)) {
  const enabled = env?.VERCEL_ENV === 'preview'
    && env?.VERCEL_GIT_COMMIT_REF === 'feature/launch-membership-v2';
  return stage => {
    if (!enabled || !stages.has(stage)) return;
    try { write(stage); } catch { /* Observation cannot affect admission. */ }
  };
}
