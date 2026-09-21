// Read-only diagnostics, not cutover authority. A fence understood by new code
// cannot revoke credentials embedded in an older deployment.
export async function membershipWriterReadiness({ execute, billingEnabled }) {
  try {
    const fence = await execute(['GET', 'membership:launch-v2:legacy_fence']);
    return {
      datastoreReadable: true,
      fence: fence === null ? 'absent' : fence === '1' ? 'installed' : 'invalid',
      billingRouteEnabled: billingEnabled === 'on',
      oldCredentialRevocation: 'requires_provider_evidence',
      cutoverProven: false,
    };
  } catch {
    return { datastoreReadable: false, fence: 'unknown',
      oldCredentialRevocation: 'requires_provider_evidence', cutoverProven: false };
  }
}
