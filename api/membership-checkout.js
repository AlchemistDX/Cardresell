import { membershipPurchaseRuntime } from './_membershipPurchaseRuntime.js';
export default async function handler(req, res) {
  try { return await membershipPurchaseRuntime().checkout(req, res); }
  catch { return res.status(503).json({ error: 'membership_purchase_not_enabled' }); }
}
