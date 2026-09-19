import { publicMembershipCatalogue } from './_membershipPurchaseRoutes.js';
import { membershipPurchaseRuntime } from './_membershipPurchaseRuntime.js';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (!req.headers?.authorization) return res.status(200).json({
    ...publicMembershipCatalogue(), purchaseEnabled: false,
  });
  try { return await membershipPurchaseRuntime().catalogue(req, res); }
  catch { return res.status(503).json({ error: 'membership_purchase_not_enabled' }); }
}
