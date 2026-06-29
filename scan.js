// /api/scan — Secure CardSight AI proxy
// The API key NEVER touches the frontend. This serverless function:
//   1. Validates the user is signed in via Google (checks id_token)
//   2. Forwards the image to CardSight AI
//   3. Returns card identification results

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Verify Google ID token ──
  const authHeader = req.headers['authorization'] || '';
  const idToken = authHeader.replace('Bearer ', '').trim();

  if (!idToken) {
    return res.status(401).json({ error: 'Sign in with Google to use the scanner.' });
  }

  try {
    // Verify with Google's tokeninfo endpoint (no extra libraries needed)
    const googleRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
    );
    if (!googleRes.ok) {
      return res.status(401).json({ error: 'Invalid Google session. Please sign in again.' });
    }
    const tokenInfo = await googleRes.json();

    // Make sure the token was issued for OUR app
    const expectedClientId = '971593505703-6feq3nn7p9580krori6r157rfm5tp88l.apps.googleusercontent.com';
    if (tokenInfo.aud !== expectedClientId) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    // Token is valid — user is authenticated
  } catch (err) {
    return res.status(401).json({ error: 'Could not verify Google sign-in.' });
  }

  // ── 2. Get image from request body ──
  const { imageBase64, mimeType } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: 'No image provided.' });
  }

  // ── 3. Forward to CardSight AI ──
  const apiKey = process.env.CARDSIGHT_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Scanner not configured.' });
  }

  try {
    // Convert base64 to blob for multipart upload
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const mime = mimeType || 'image/jpeg';

    // CardSight expects multipart/form-data with an 'image' field
    const FormData = (await import('formdata-node')).FormData;
    const { Blob } = await import('buffer');
    
    const form = new FormData();
    form.set('image', new Blob([imageBuffer], { type: mime }), 'card.jpg');

    const cardSightRes = await fetch('https://api.cardsight.ai/identify/card', {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        ...Object.fromEntries(form.headers || []),
      },
      body: form,
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
