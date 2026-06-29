// /api/scan — CardGrader.AI proxy (replaced CardSight)
// Submits card photo, polls until complete, returns normalized result
// CardGrader.AI docs: https://cardgrader.ai/api-docs
// Module: "full" = identification + AI grade + pricing (2 credits/scan)
// Polling: async queue, 30–120s typical, poll GET /v1/scans/{id}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

  // ── 2. Get image from request ──
  const { imageBase64, mimeType } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'No image provided.' });

  const cgKey = process.env.CARDGRADER_API_KEY;
  if (!cgKey) return res.status(503).json({ error: 'Scanner not configured.' });

  const CG_BASE = 'https://cardgrader.ai/v1';
  const authHeader = { 'Authorization': `Bearer ${cgKey}` };

  try {
    // ── 3. Submit scan to CardGrader.AI ──
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const mime = mimeType || 'image/jpeg';
    const boundary = '----CGBoundary' + Date.now();

    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="front"; filename="card.jpg"\r\nContent-Type: ${mime}\r\n\r\n`
    );
    const modulePart = Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="modules"\r\n\r\nfull`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, imageBuffer, modulePart, footer]);

    const idempotencyKey = 'cs-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

    const submitRes = await fetch(`${CG_BASE}/scans`, {
      method: 'POST',
      headers: {
        ...authHeader,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length.toString(),
        'Idempotency-Key': idempotencyKey,
      },
      body,
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      console.error('CardGrader submit error:', submitRes.status, errText);
      if (submitRes.status === 402) {
        return res.status(402).json({ error: 'Scanner credits used up. Please top up at cardgrader.ai.' });
      }
      return res.status(502).json({ error: 'Scan submission failed. Try a clearer photo.' });
    }

    const submitted = await submitRes.json();
    const scanId = submitted.id;
    if (!scanId) return res.status(502).json({ error: 'No scan ID returned.' });

    // ── 4. Poll until complete (max 110s, every 4s) ──
    const MAX_POLLS = 27;
    const POLL_INTERVAL = 4000;
    let result = null;

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));

      const pollRes = await fetch(`${CG_BASE}/scans/${scanId}`, { headers: authHeader });
      if (!pollRes.ok) {
        console.error('CardGrader poll error:', pollRes.status);
        continue;
      }
      const pollData = await pollRes.json();

      if (pollData.status === 'completed') {
        result = pollData;
        break;
      }
      if (pollData.status === 'failed') {
        return res.status(502).json({ error: 'Scan failed. Try a clearer, well-lit photo.' });
      }
      // status: queued / processing — keep polling
    }

    if (!result) {
      return res.status(504).json({ error: 'Scan timed out. Try again with a clearer photo.' });
    }

    // ── 5. Normalize response for frontend ──
    const id = result.identification || {};
    const grading = result.grading || {};
    const value = result.value || {};

    return res.status(200).json({
      // Card identity
      cardName:   id.name || '',
      cardNumber: id.number || '',
      setName:    id.set || '',
      year:       id.year || '',
      category:   id.category || '',
      parallel:   id.parallel || '',
      subject:    id.subject || '',

      // AI grade prediction
      grade:          grading.grade ?? null,
      predictedGrade: grading.predictedGrade ?? null,
      subGrades:      grading.subGrades || null,
      gradeSummary:   grading.summary || '',
      gradeJustification: grading.justification || '',

      // Pricing from real sold comps
      rawEstimate:    value.rawEstimate ?? null,
      gradedEstimate: value.gradedEstimate ?? null,
      gradedValueSpread: value.gradedValueSpread || [],
      currency:       value.currency || 'USD',

      // Market insights
      gradingRecommendation: result.market?.gradingRecommendation || '',
      marketInsights:        result.market?.insights || '',

      // Meta
      creditsRemaining: submitted.creditsRemaining ?? null,
      scanId,
    });

  } catch (err) {
    console.error('Scan proxy error:', err);
    return res.status(500).json({ error: 'Scanner temporarily unavailable.' });
  }
}
