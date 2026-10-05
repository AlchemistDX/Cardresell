import { membershipPurchaseRuntime } from './_membershipPurchaseRuntime.js';
import { reportMembershipFailure } from './_membershipDiagnostics.js';
export default async function handler(req, res) {
  try { return await (await membershipPurchaseRuntime()).account(req, res); }
  catch (e) { reportMembershipFailure('account_runtime', e); return res.status(503).json({ error: 'membership_not_enabled' }); }
}
