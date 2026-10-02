// Temporary read-only build diagnostic. No public endpoint; no raw records or
// credentials in output. No enrollment, fence, balance or subscription writes.
import { createHash } from 'node:crypto';
import { membershipRedis } from '../api/_membershipLegacyFence.js';
import { membershipPreflight } from '../api/_membershipPreflight.js';
import { membershipEnrollmentKey } from '../api/_membershipConsumption.js';
const owner = 'fzUpcrXKDdQzGORl0bLQ6mTwML73';
const sha = x => createHash('sha256').update(x).digest('hex');
if (process.env.VERCEL_ENV === 'production') {
  try {
    const known = [
      ['legacyOwner', `pro:${owner}`],
      ['enrollment', membershipEnrollmentKey(owner)],
      ['authority', 'membership:launch-v2:active:' + sha(owner)],
      ['idStanding', `scans:${owner}:id_paid_left`],
      ['gradeStanding', `scans:${owner}:paid_left`],
      ['welcomeMarker', `signup_bonus:${owner}`],
      ['writerFence', 'membership:launch-v2:legacy_fence'],
    ];
    const rows = {};
    for (const [name, key] of known) {
      const raw = await membershipRedis(['GET', key]);
      rows[name] = { present: raw !== null, digest: raw === null ? null : sha(raw) };
      if (name === 'writerFence') rows[name].installed = raw === '1';
      if (name === 'legacyOwner' && raw !== null) {
        const p = JSON.parse(raw);
        rows[name].fieldNames = Object.keys(p).sort();
        rows[name].canonicalSubscriptionMatches = p.subscriptionId === 'sub_1TqbkwFW2YZoedIZGKzsOLjn';
        rows[name].canonicalCustomerMatches = p.customerId === 'cus_UqILx52TtoCldY';
      }
    }
    console.log('MEMBERSHIP_PRODUCTION_READ_ONLY ' + JSON.stringify({
      commit: process.env.VERCEL_GIT_COMMIT_SHA, rows,
      preflight: await membershipPreflight({ ...process.env, MEMBERSHIP_LIVE_PREFLIGHT: 'enabled' }, fetch, 'live'),
      mutated: false,
    }));
  } catch {
    console.log('MEMBERSHIP_PRODUCTION_READ_ONLY ' + JSON.stringify({
      status: 'UNCONFIRMED', mutated: false, detail: 'Read-only inventory incomplete; do not activate.',
    }));
  }
}
