// /api/ebay-notifications — eBay Marketplace Account Deletion/Closure Notifications
// GET  ?challenge_code=xxx  → responds with SHA-256 hash to verify endpoint ownership
// POST (JSON body)          → acknowledges deletion notification with 200 OK

import { createHash } from 'crypto';
import { cleanCredential } from './_ebayAuth.js';

// This token must match exactly what you enter in the eBay portal
// cleanCredential() strips stray quotes, real whitespace, and LITERAL \n / \r
// / \t sequences. This is load-bearing, not defensive dressing: on 2026-09-05
// the value stored in Vercel production carried a trailing newline, so this
// endpoint was answering eBay's challenge with a hash over the wrong token.
// The clean token hashes to c61401b9...; the corrupted one to 0d8f324a...,
// and production was returning the latter. A mismatched challenge response
// fails eBay's endpoint validation, which gates production API access.
// CH-2, 2026-09-09: the published fallback is REMOVED.
//
// This line previously read `... || '<a literal committed to this repository>'`.
// CH-1 measured production actually serving that published value, so the
// fallback was not a theoretical hazard -- it was the live configuration. Worse,
// it made the failure invisible: an unset or cleared variable produced a
// perfectly well-formed challenge response computed over a token anyone can
// read in the repository, and every health check would have passed.
//
// Rule 2 -- a silent fallback to a wrong value IS the bug. There is now no
// fallback. An absent token fails closed and says so.
//
// Read at call time rather than captured at module load, so the value cannot be
// frozen by a cold start that happened before the variable was set, and so the
// offline suite can exercise present and absent in one process.
function verificationToken() {
  return cleanCredential(process.env.EBAY_VERIFICATION_TOKEN) || '';
}
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

    // Fail closed. Answering the challenge with a hash over an empty or
    // published token would tell eBay we own an endpoint we cannot prove we
    // own, and would do it while looking healthy. A 503 is legible; a wrong
    // 200 is not.
    const TOKEN = verificationToken();
    if (!TOKEN) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({ error: 'verification_token_unset' });
    }

    // Hash: challengeCode + verificationToken + endpoint (in this exact order)
    const hash = createHash('sha256');
    hash.update(challengeCode);
    hash.update(TOKEN);
    hash.update(ENDPOINT_URL);
    const challengeResponse = hash.digest('hex');

    // Must respond with application/json and the challengeResponse field
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ challengeResponse });
  }

  // ── POST: eBay sends account deletion notification ──
  // Deliberately NOT gated on the token. POST does not use it, and refusing a
  // deletion notification because of our own misconfiguration would turn a
  // configuration defect into a compliance failure. The challenge fails closed;
  // the acknowledgement stays open.
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
