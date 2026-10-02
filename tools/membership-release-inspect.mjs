// Ordinary builds do no additional work. Read-only inspection is optional.
// An explicit operator build may run apply/schedule only through the exact
// commit, pause, backup and revocation guards in transitionMembershipOwner.
const stage = process.env.MEMBERSHIP_OWNER_TRANSITION_STAGE;
if (stage || process.env.MEMBERSHIP_OWNER_READ_ONLY_INSPECT === 'enabled') {
  try {
    if (stage && !['apply', 'schedule'].includes(stage)) throw Error('invalid_transition_stage');
    const { transitionMembershipOwner } = await import('./transition-membership-owner.mjs');
    const result = await transitionMembershipOwner({ stage: stage || 'inspect' });
    console.log((stage ? 'MEMBERSHIP_OWNER_OPERATOR ' : 'MEMBERSHIP_OWNER_READ_ONLY ') + JSON.stringify({
      commit: process.env.VERCEL_GIT_COMMIT_SHA, ...result,
    }));
  } catch (error) {
    console.error('MEMBERSHIP_OWNER_OPERATOR_UNCONFIRMED ' + (
      /^[a-z_]+$/.test(error?.message || '') ? error.message : 'unconfirmed'
    ));
    process.exitCode = 1;
  }
}
