// /api/scan — CardGrader.AI proxy (async submit + poll)
// POST: validates auth, checks/consumes credit, submits scan to CardGrader, returns { scanId }
// The frontend then polls /api/scan-result?id={scanId} until completed.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Auth: verify Google ID token or accept email fallback ──
  const idToken   = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  const bodyEmail = req.body?.email || '';
  const bodySub   = req.body?.googleSub || '';

  let userEmail = bodyEmail;
  let googleSub = bodySub;

  if (idToken && idToken.length > 20) {
    try {
      const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
      if (googleRes.ok) {
        const info = await googleRes.json();
        const expectedClientId = '971593505703-6feq3nn7p9580krori6r157rfm5tp88l.apps.googleusercontent.com';
        if (info.aud === expectedClientId) {
          userEmail = info.email || userEmail;
          googleSub = info.sub  || googleSub;
        }
      }
    } catch(e) { /* fallback to email */ }
  }

  if (!userEmail) {
    return res.status(401).json({ error: 'Sign in with Google to use the scanner.' });
  }

  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  const hasKV   = !!(kvUrl && kvToken);
  const key     = googleSub || userEmail;

  // ── 2. Check & consume a scan credit ──
  if (hasKV) {
    const paid    = await getKVInt(kvUrl, kvToken, `scans:${key}:paid_left`);
    const isPro   = await checkProStatus(process.env.STRIPE_SECRET_KEY, kvUrl, kvToken, googleSub, userEmail);
    const stamp   = getMonthStamp();
    const freeUsed = isPro ? await getKVInt(kvUrl, kvToken, `scans:${key}:free_used_${stamp}`) : 10;
    const freeLeft = isPro ? Math.max(0, 10 - freeUsed) : 0;

    if (freeLeft <= 0 && paid <= 0) {
      return res.status(402).json({ error: 'No scan credits remaining. Purchase a scan to continue.', needsPayment: true });
    }

    // Consume credit (free first, then paid)
    if (freeLeft > 0) {
      await incrKV(kvUrl, kvToken, `scans:${key}:free_used_${stamp}`);
    } else {
      await setKV(kvUrl, kvToken, `scans:${key}:paid_left`, paid - 1);
    }
  }

  // ── 3. Get images (front required, back required by CardGrader) ──
  const { imageBase64, mimeType, backBase64, backMimeType } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'No image provided.' });
  if (!backBase64)  return res.status(400).json({ error: 'Back photo required. Please photograph both sides of the card.' });

  // ── 4. Submit scan to CardGrader.AI ──
  const cgKey = process.env.CARDGRADER_API_KEY;
  if (!cgKey) return res.status(500).json({ error: 'Scanner not configured.' });

  try {
    const frontBuffer = Buffer.from(imageBase64, 'base64');
    const backBuffer  = Buffer.from(backBase64,  'base64');
    const frontMime   = mimeType     || 'image/jpeg';
    const backMime    = backMimeType || 'image/jpeg';
    const boundary    = '----CardSellBoundary' + Date.now();
    const idempotencyKey = `cs-${key.slice(0, 16)}-${Date.now()}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);

    // Build multipart body with front + back + modules
    const frontHeader  = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="front"; filename="front.jpg"\r\nContent-Type: ${frontMime}\r\n\r\n`);
    const frontFooter  = Buffer.from(`\r\n`);
    const backHeader   = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="back"; filename="back.jpg"\r\nContent-Type: ${backMime}\r\n\r\n`);
    const backFooter   = Buffer.from(`\r\n`);
    const modulePart   = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="modules"\r\n\r\nfull`);
    const finalBoundary = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([frontHeader, frontBuffer, frontFooter, backHeader, backBuffer, backFooter, modulePart, finalBoundary]);

    const cgRes = await fetch('https://cardgrader.ai/v1/scans', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cgKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Idempotency-Key': idempotencyKey,
      },
      body,
    });

    if (!cgRes.ok) {
      const errText = await cgRes.text();
      console.error('CardGrader submit error:', cgRes.status, errText);

      // Refund credit if submission failed
      if (hasKV) {
        const paid = await getKVInt(kvUrl, kvToken, `scans:${key}:paid_left`);
        await setKV(kvUrl, kvToken, `scans:${key}:paid_left`, paid + 1);
      }

      // Handle specific error codes
      if (cgRes.status === 402) {
        return res.status(502).json({ error: 'Card scanner service credit issue. Please try again later.' });
      }
      return res.status(502).json({ error: 'Card scan failed. Try a clearer photo of the card.' });
    }

    const result = await cgRes.json();
    // Returns: { id, status: "queued", modules, creditsCharged, creditsRemaining, links }
    const scanId = result.id;

    if (!scanId) {
      console.error('CardGrader no scan ID:', result);
      return res.status(502).json({ error: 'Scanner did not return a scan ID. Please try again.' });
    }

    console.log('CardGrader scan submitted:', JSON.stringify({ scanId, status: result.status, key }));

    // Return scan ID — frontend will poll /api/scan-result?id={scanId}
    return res.status(202).json({ scanId, status: result.status || 'queued' });

  } catch(err) {
    console.error('Scan error:', err);
    return res.status(500).json({ error: 'Scanner temporarily unavailable. Please try again.' });
  }
}

// ── KV helpers ──
function getMonthStamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function getKVInt(kvUrl, kvToken, key) {
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const d = await r.json();
    const raw = d.result;
    if (raw === null || raw === undefined) return 0;
    if (typeof raw === 'string' && raw.startsWith('[')) {
      try { return parseInt(JSON.parse(raw)[0]) || 0; } catch(e) {}
    }
    return parseInt(raw) || 0;
  } catch(e) { return 0; }
}

async function setKV(kvUrl, kvToken, key, value) {
  try {
    await fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(value))}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` }
    });
  } catch(e) {}
}

async function incrKV(kvUrl, kvToken, key) {
  try {
    await fetch(`${kvUrl}/incr/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` }
    });
  } catch(e) {}
}

async function checkProStatus(stripeKey, kvUrl, kvToken, googleSub, email) {
  if (kvUrl && kvToken && googleSub) {
    try {
      const r = await fetch(`${kvUrl}/get/${encodeURIComponent(`pro:${googleSub}`)}`, {
        headers: { Authorization: `Bearer ${kvToken}` }
      });
      const d = await r.json();
      if (d.result) {
        const rec = JSON.parse(d.result);
        if (rec.status === 'active') return true;
      }
    } catch(e) {}
  }
  if (!stripeKey || !email) return false;
  try {
    const r = await fetch(
      `https://api.stripe.com/v1/customers/search?query=email:"${email}"&limit=1`,
      { headers: { Authorization: `Bearer ${stripeKey}` } }
    );
    if (!r.ok) return false;
    const d = await r.json();
    const cust = d.data?.[0];
    if (!cust) return false;
    const subR = await fetch(
      `https://api.stripe.com/v1/subscriptions?customer=${cust.id}&status=active&limit=1`,
      { headers: { Authorization: `Bearer ${stripeKey}` } }
    );
    const subD = await subR.json();
    return (subD.data?.length || 0) > 0;
  } catch(e) { return false; }
}
