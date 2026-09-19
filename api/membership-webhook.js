import { membershipPurchaseRuntime } from './_membershipPurchaseRuntime.js';
export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  try { return await membershipPurchaseRuntime().webhook(req, res); }
  catch { return res.status(503).json({ error: 'membership_not_enabled' }); }
}
