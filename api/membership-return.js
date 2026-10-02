import { membershipPurchaseRuntime } from './_membershipPurchaseRuntime.js';
export default async function handler(req, res) {
  try { return await (await membershipPurchaseRuntime()).checkoutReturn(req, res); }
  catch { return res.status(503).json({ error: 'membership_not_enabled' }); }
}
