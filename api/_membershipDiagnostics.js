// Fixed categories only: never log bearer tokens, identities, raw provider
// messages, customer IDs, environment values, or request bodies.
const reasons = new Set([
  'membership_cutover_paused', 'purchase_disabled', 'membership_environment_invalid',
  'test_owners_invalid', 'owner_pilot_required', 'invalid_live_audience', 'invalid_live_pilot',
  'billing_unavailable', 'owner_import_corrupt', 'invalid_owner_authorization',
  'customer_association_required', 'context_mismatch', 'context_unavailable',
  'membership_context_unavailable', 'enrollment_unavailable', 'benefits_unavailable',
  'subscription_authority_missing', 'authentication_required', 'membership_access_restricted',
  'owner_import_required', 'store_unavailable', 'transport_unavailable', 'transport_status',
]);
const stages = new Set(['catalogue_runtime', 'catalogue_context', 'account_runtime', 'account_operation']);
export function reportMembershipFailure(stage, error, report = console.warn) {
  const reason = [error?.code, error?.message].find(value => reasons.has(value))
    || (error?.name === 'SyntaxError' ? 'invalid_serialized_configuration_or_state' : 'unclassified');
  try { report('MEMBERSHIP_REQUEST_FAILED', stages.has(stage) ? stage : 'unknown', reason); }
  catch { /* Diagnostics must never alter response or admission. */ }
}
