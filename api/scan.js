// /api/scan — GPT-4o Vision card identification
// POST { imageBase64, mimeType, email, googleSub }
// Authorization: Bearer <google_id_token>
// Returns: { card_name, card_number, set_name, hp, card_type, rarity, success: true }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Auth ──
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
    } catch(e) {}
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
    const paid     = await getKVInt(kvUrl, kvToken, `scans:${key}:paid_left`);
    const isPro    = await checkProStatus(process.env.STRIPE_SECRET_KEY, kvUrl, kvToken, googleSub, userEmail);
    const stamp    = getMonthStamp();
    const freeUsed = isPro ? await getKVInt(kvUrl, kvToken, `scans:${key}:free_used_${stamp}`) : 10;
    const freeLeft = isPro ? Math.max(0, 10 - freeUsed) : 0;

    if (freeLeft <= 0 && paid <= 0) {
      return res.status(402).json({ error: 'No scan credits remaining.', needsPayment: true });
    }

    if (freeLeft > 0) {
      await incrKV(kvUrl, kvToken, `scans:${key}:free_used_${stamp}`);
    } else {
      await setKV(kvUrl, kvToken, `scans:${key}:paid_left`, paid - 1);
    }
  }

  // ── 3. Get image ──
  const { imageBase64, mimeType } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'No image provided.' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'Scanner not configured.' });

  // ── 4. Call GPT-4o Vision ──
  try {
    const mime   = mimeType || 'image/jpeg';
    const dataUrl = `data:${mime};base64,${imageBase64}`;

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: dataUrl, detail: 'high' }
              },
              {
                type: 'text',
                text: `You are a trading card expert. Look at this card image and extract:
1. card_name: The Pokémon or character name (e.g. "Mewtwo VSTAR", "Charizard ex", "LeBron James")
2. card_number: The card number (e.g. "079/078", "025/165")
3. set_name: The set name (e.g. "Pokémon GO", "Crown Zenith", "Prizm")
4. hp: HP number if Pokémon card (e.g. "280")
5. card_type: "pokemon", "sports", or "mtg"
6. rarity: e.g. "Rainbow Rare", "Secret Rare", "Holo Rare"

Respond ONLY with valid JSON, no explanation:
{"card_name":"...","card_number":"...","set_name":"...","hp":"...","card_type":"...","rarity":"..."}`
              }
            ]
          }
        ]
      })
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error('OpenAI error:', openaiRes.status, errText);
      // Refund credit on OpenAI failure
      if (hasKV) {
        const paid = await getKVInt(kvUrl, kvToken, `scans:${key}:paid_left`);
        await setKV(kvUrl, kvToken, `scans:${key}:paid_left`, paid + 1);
      }
      return res.status(502).json({ error: 'Scanner temporarily unavailable. Credit refunded.' });
    }

    const openaiData = await openaiRes.json();
    const content = openaiData.choices?.[0]?.message?.content || '';

    // Parse the JSON response from GPT-4o
    let cardInfo;
    try {
      // Strip markdown code blocks if present
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      cardInfo = JSON.parse(cleaned);
    } catch(e) {
      console.error('GPT-4o parse error:', content);
      return res.status(502).json({ error: 'Could not identify this card. Try a clearer photo.' });
    }

    if (!cardInfo.card_name) {
      return res.status(422).json({ error: 'Could not identify the card. Try a clearer photo with better lighting.' });
    }

    return res.status(200).json({
      success: true,
      card_name:   cardInfo.card_name   || '',
      card_number: cardInfo.card_number || '',
      set_name:    cardInfo.set_name    || '',
      hp:          cardInfo.hp          || '',
      card_type:   cardInfo.card_type   || 'pokemon',
      rarity:      cardInfo.rarity      || '',
    });

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
