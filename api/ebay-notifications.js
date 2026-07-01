// /api/ebay-notifications — eBay Marketplace Account Deletion/Closure Notifications
// GET  ?challenge_code=xxx  → responds with SHA-256 hash to verify endpoint ownership
// POST (JSON body)          → acknowledges deletion notification with 200 OK

import { createHash } from 'crypto';

// This token must match exactly what you enter in the eBay portal
const VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN || 'CardResell-eBay-Notify-2026-secure-token-v1';
const ENDPOINT_URL       = 'https://www.cardresell.org/api/ebay-notifications';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-ebay-signature');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: eBay challenge verification ──
  if (req.method === 'GET') {
    const challengeCode = req.query?.challenge_code;
    if (!challengeCode) {
      return res.status(400).json({ error: 'challenge_code required' });
    }

    // Hash: challengeCode + verificationToken + endpoint (in this exact order)
    const hash = createHash('sha256');
    hash.update(challengeCode);
    hash.update(VERIFICATION_TOKEN);
    hash.update(ENDPOINT_URL);
    const challengeResponse = hash.digest('hex');

    // Must respond with application/json and the challengeResponse field
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ challengeResponse });
  }

  // ── POST: eBay sends account deletion notification ──
  if (req.method === 'POST') {
    const body = req.body || {};

    // Log for audit trail (no user data stored — CardResell doesn't store eBay user data)
    console.log('EBAY_DELETION_NOTIFICATION:', JSON.stringify({
      topic:          body?.metadata?.topic,
      notificationId: body?.notification?.notificationId,
      eventDate:      body?.notification?.eventDate,
      // Not logging userId/username — we don't store this data
    }));

    // CardResell does not store any eBay user personal data.
    // We acknowledge the notification immediately with 200 OK as required.
    return res.status(200).json({ received: true });
  }

  return res.status(405).end();
}
