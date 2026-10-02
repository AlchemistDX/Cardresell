// Optional read-only deployment check. Never performs import, schedules,
// installs a fence, or changes a Stripe object. Enabled only on an explicit
// production candidate build; ordinary builds do no additional work.
if (process.env.MEMBERSHIP_OWNER_READ_ONLY_INSPECT === 'enabled') {
  try {
    const { transitionMembershipOwner } = await import('./transition-membership-owner.mjs');
    const result = await transitionMembershipOwner({ stage: 'inspect' });
    console.log('MEMBERSHIP_OWNER_READ_ONLY ' + JSON.stringify({
      commit: process.env.VERCEL_GIT_COMMIT_SHA, ...result,
    }));
  } catch (error) {
    console.error('MEMBERSHIP_OWNER_READ_ONLY ' + (
      /^[a-z_]+$/.test(error?.message || '') ? error.message : 'unconfirmed'
    ));
    process.exitCode = 1;
  }
}
