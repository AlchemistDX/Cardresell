// /api/scan — Secure CardSight AI proxy
// Key stays server-side. Validates Google ID token before forwarding.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Verify Google ID token ──
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken) {
    return res.status(401).json({ error: 'Sign in with Google to use the scanner.' });
  }

  try {
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
    if (!googleRes.ok) {
      return res.status(401).json({ error: 'Invalid Google session. Please sign in again.' });
    }
    const tokenInfo = await googleRes.json();
    const expectedClientId = '971593505703-6feq3nn7p9580krori6r157rfm5tp88l.apps.googleusercontent.com';
    if (tokenInfo.aud !== expectedClientId) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
  } catch (err) {
    return res.status(401).json({ error: 'Could not verify Google sign-in.' });
  }

  // ── 2. Get image ──
  const { imageBase64, mimeType } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: 'No image provided.' });
  }

  // ── 3. Forward to CardSight AI using multipart/form-data ──
  const apiKey = process.env.CARDSIGHT_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Scanner not configured.' });
  }

  try {
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const mime = mimeType || 'image/jpeg';

    // Build multipart body manually — avoids any external dependencies
    const boundary = '----CardSellBoundary' + Date.now();
    const filename = 'card.jpg';

    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, imageBuffer, footer]);

    const cardSightRes = await fetch('https://api.cardsight.ai/v1/identify/card', {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length.toString(),
      },
      body,
    });

    if (!cardSightRes.ok) {
      const errText = await cardSightRes.text();
      console.error('CardSight error:', cardSightRes.status, errText);
      return res.status(502).json({ error: 'Card identification failed. Try a clearer photo.' });
    }

    const result = await cardSightRes.json();
    return res.status(200).json(result);

  } catch (err) {
    console.error('Scan proxy error:', err);
    return res.status(500).json({ error: 'Scanner temporarily unavailable.' });
  }
}
