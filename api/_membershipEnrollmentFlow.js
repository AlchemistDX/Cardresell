// Normal authenticated association: complete the audited enrollment first,
// then independent, idempotent monthly and welcome grants. No Stripe customer
// creation occurs until this function completes.
import { grantMembership } from './_membershipLedger.js';
import { membershipEnrollmentKey } from './_membershipConsumption.js';

export function createMembershipEnrollmentFlow({ execute, provision, bootstrap, issueFree }) {
  return async (owner, identity) => {
    if (identity?.uid !== owner || identity.verified !== true
      || typeof identity.email !== 'string' || identity.email.length > 254
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email.trim())) {
      throw Object.assign(Error('authentication_required'), { code: 'authentication_required' });
    }
    await provision(owner);
    await bootstrap(owner);
    const free = await issueFree(owner);
    if (free.status === 'paid') return { status: 'paid_preserved' };
    if (!['issued', 'replayed'].includes(free.status)) throw Error('free_baseline_required');
    const welcome = await grantMembership(async command => {
      // Validate current authority atomically with the unchanged grant script.
      // A concurrent paid transition or fence failure cannot mint a late award.
      const count = command[2];
      const guard = `
if redis.call('GET',KEYS[${count + 1}])~='1' then return redis.error_reply('enrollment_not_ready') end
local ok,enrollment=pcall(cjson.decode,redis.call('GET',KEYS[${count + 2}]) or '')
local p=cjson.decode(ARGV[1])
if not ok or enrollment.version~='launch-v2' or enrollment.owner~=p.owner
 or enrollment.verified~=true or enrollment.plan~='free' then
 return redis.error_reply('enrollment_not_ready')
end
`;
      return execute(['EVAL', guard + command[1], count + 2,
        ...command.slice(3, 3 + count), 'membership:launch-v2:legacy_fence',
        membershipEnrollmentKey(owner), ...command.slice(3 + count)]);
    }, 'welcome', { owner, email: identity.email, verified: true });
    return { status: 'free_ready', monthly: free.status, welcome: welcome.granted };
  };
}
