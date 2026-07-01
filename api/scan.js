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

  // ── 3. Get image + mode (read early so credit logic can branch) ──
  const { imageBase64, mimeType, mode } = req.body || {};
  const isGradeMode    = mode === 'grade';
  const isIdentifyMode = !isGradeMode; // identify is the default

  // ── 2. Check & consume a scan credit ──
  // Track WHICH bucket we drew from so we can refund the exact same bucket on failure.
  // 'id_paid' | 'id_free_<stamp>' | 'grade_paid' | 'grade_free_<stamp>' | null (nothing consumed)
  //
  // IMPORTANT: Consumption uses atomic Upstash DECR / INCR so two concurrent scans
  // from the same user can't both read the same balance and each write balance-1
  // (the demo "bought 2 credits, only 1 usable" bug). If DECR takes the balance
  // below 0 we roll it back with INCR before returning 402.
  let creditsDrawnFrom = null;
  // Pro-plan monthly free allowances
  const ID_FREE_PER_MONTH    = 20;
  const GRADE_FREE_PER_MONTH = 10;
  if (hasKV) {
    const isPro = await checkProStatus(process.env.STRIPE_SECRET_KEY, kvUrl, kvToken, googleSub, userEmail);

    if (isIdentifyMode) {
      // ID scans: Pro users draw from id_free_used_<stamp> bucket first (20/mo), then id_paid_left
      const stamp = getMonthStamp();
      let consumed = false;

      if (isPro) {
        // Atomically increment used-counter, then check we stayed under the cap.
        const usedAfter = await incrKV(kvUrl, kvToken, `scans:${key}:id_free_used_${stamp}`);
        if (usedAfter !== null && usedAfter <= ID_FREE_PER_MONTH) {
          creditsDrawnFrom = `id_free_${stamp}`;
          consumed = true;
        } else if (usedAfter !== null) {
          // Went over the free cap — roll back the increment.
          await decrKV(kvUrl, kvToken, `scans:${key}:id_free_used_${stamp}`);
        }
      }

      if (!consumed) {
        // Atomically decrement paid balance; if we went below 0 someone else took the last one.
        const paidAfter = await decrKV(kvUrl, kvToken, `scans:${key}:id_paid_left`);
        if (paidAfter !== null && paidAfter >= 0) {
          creditsDrawnFrom = 'id_paid';
          consumed = true;
        } else if (paidAfter !== null) {
          await incrKV(kvUrl, kvToken, `scans:${key}:id_paid_left`);
        }
      }

      if (!consumed) {
        return res.status(402).json({ error: 'No ID scan credits remaining.', needsPayment: true, mode: 'identify' });
      }
    } else {
      // Graded scans: draw from Pro free bucket first, then paid_left
      const stamp = getMonthStamp();
      let consumed = false;

      if (isPro) {
        const usedAfter = await incrKV(kvUrl, kvToken, `scans:${key}:free_used_${stamp}`);
        if (usedAfter !== null && usedAfter <= GRADE_FREE_PER_MONTH) {
          creditsDrawnFrom = `grade_free_${stamp}`;
          consumed = true;
        } else if (usedAfter !== null) {
          await decrKV(kvUrl, kvToken, `scans:${key}:free_used_${stamp}`);
        }
      }

      if (!consumed) {
        const paidAfter = await decrKV(kvUrl, kvToken, `scans:${key}:paid_left`);
        if (paidAfter !== null && paidAfter >= 0) {
          creditsDrawnFrom = 'grade_paid';
          consumed = true;
        } else if (paidAfter !== null) {
          await incrKV(kvUrl, kvToken, `scans:${key}:paid_left`);
        }
      }

      if (!consumed) {
        return res.status(402).json({ error: 'No grading credits remaining.', needsPayment: true, mode: 'grade' });
      }
    }
  }

  // Helper: refund the exact bucket we drew from. Safe to call multiple times
  // as long as `creditsDrawnFrom` is nulled after the first refund.
  async function refundCredit(reason) {
    if (!hasKV || !creditsDrawnFrom) return;
    try {
      if (creditsDrawnFrom === 'id_paid') {
        await incrKV(kvUrl, kvToken, `scans:${key}:id_paid_left`);
      } else if (creditsDrawnFrom === 'grade_paid') {
        await incrKV(kvUrl, kvToken, `scans:${key}:paid_left`);
      } else if (creditsDrawnFrom.startsWith('grade_free_')) {
        const stamp = creditsDrawnFrom.replace('grade_free_', '');
        // Free bucket is a counter of USES, so refund decrements it.
        await decrKV(kvUrl, kvToken, `scans:${key}:free_used_${stamp}`);
      } else if (creditsDrawnFrom.startsWith('id_free_')) {
        const stamp = creditsDrawnFrom.replace('id_free_', '');
        await decrKV(kvUrl, kvToken, `scans:${key}:id_free_used_${stamp}`);
      }
      console.log('Refunded credit:', creditsDrawnFrom, 'reason:', reason);
    } catch(e) {
      console.error('Refund failed:', e);
    }
    creditsDrawnFrom = null;
  }
  if (!imageBase64) return res.status(400).json({ error: 'No image provided.' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'Scanner not configured.' });

  const { backBase64, backMimeType } = req.body || {};

  // ── 4. Call GPT-4o Vision ──
  try {
    const mime   = mimeType || 'image/jpeg';
    const dataUrl = `data:${mime};base64,${imageBase64}`;
    const backDataUrl = backBase64 ? `data:${backMimeType || 'image/jpeg'};base64,${backBase64}` : null;

    const prompt = isGradeMode
      ? `You are a strict, professional trading card grader trained to PSA standards. You are analyzing ${backDataUrl ? 'TWO images: the front AND back of a card' : 'ONE image: the FRONT of a card only (back not provided)'}.

BEFORE grading, understand this critical reality:
- PSA 10 (Gem Mint) is EXTREMELY rare — fewer than 5% of submitted cards receive it
- PSA 9 is already excellent — most well-kept cards land at PSA 8 or below
- Any visible flaw — even minor corner wear, off-centering, a single scratch — drops the grade significantly
- Be STRICT and REALISTIC. It is better to underestimate than overestimate
- If the image quality is poor or you cannot clearly see the card, say so in grade_notes and give a conservative grade

Grading scale:
- PSA 10: Perfectly centered (50/50 to 55/45), zero corner wear, zero edge chips, zero surface scratches under any light
- PSA 9: Near perfect, possibly one tiny flaw barely visible
- PSA 8: Light corner wear OR slight off-centering OR minor surface issue
- PSA 7: Noticeable corner wear AND/OR moderate centering issues
- PSA 6 or below: Clear visible damage, heavy wear, major centering issues

Evaluate and return:
1. card_name: The card name
2. centering: Estimate left/right and top/bottom as percentage (e.g. "60/40 L/R, 55/45 T/B")
3. corners: Describe all 4 corners specifically — any whitening, bends, fraying ("Mint", "Near Mint", "Light Wear", "Moderate Wear", "Heavy Wear")
4. edges: Describe all 4 edges — chips, roughness, nicks ("Mint", "Near Mint", "Light Wear", "Moderate Wear", "Heavy Wear")
5. surface: Front surface — scratches, print lines, holo damage, stains ("Mint", "Near Mint", "Light Wear", "Moderate Wear", "Heavy Wear")
6. psa_estimate: A realistic integer grade 1-10. DO NOT default to 10. Be strict.
7. grade_label: ("Gem Mint", "Mint", "Near Mint-Mint", "Near Mint", "Excellent-Mint", "Excellent", "Very Good", "Good", "Poor")
8. grade_notes: 1-2 sentences on the SPECIFIC flaws observed (or why it earns a high grade if truly flawless)
9. worth_grading: true only if psa_estimate >= 8 AND the card has meaningful value raw
10. card_number: The exact card number as printed (e.g. "079/078", "184/197"). Empty string if not visible.
11. set_name: The set name if visible (e.g. "Surging Sparks", "Crown Zenith"). Empty string if unclear.
12. rarity: The card's rarity family (e.g. "Special Illustration Rare", "Secret Rare", "Rainbow Rare", "Holo Rare", "Common"). Empty string if unclear.

Respond ONLY with valid JSON:
{"card_name":"...","centering":"...","corners":"...","edges":"...","surface":"...","psa_estimate":8,"grade_label":"...","grade_notes":"...","worth_grading":false,"card_number":"...","set_name":"...","rarity":"..."}`
      : `You are a trading card expert. Look at this card image and extract:
1. card_name: The Pokémon or character name (e.g. "Mewtwo VSTAR", "Charizard ex", "LeBron James")
2. card_number: The card number (e.g. "079/078", "025/165")
3. set_name: The set name (e.g. "Pokémon GO", "Crown Zenith", "Prizm")
4. hp: HP number if Pokémon card (e.g. "280")
5. card_type: "pokemon", "sports", or "mtg"
6. rarity: e.g. "Rainbow Rare", "Secret Rare", "Holo Rare"

Respond ONLY with valid JSON, no explanation:
{"card_name":"...","card_number":"...","set_name":"...","hp":"...","card_type":"...","rarity":"..."}`;

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: isGradeMode ? 500 : 200,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: dataUrl, detail: isGradeMode ? 'high' : 'auto' }
              },
              // Include back image for grade mode if provided
              ...(isGradeMode && backDataUrl ? [{
                type: 'image_url',
                image_url: { url: backDataUrl, detail: 'high' }
              }] : []),
              { type: 'text', text: prompt }
            ]
          }
        ]
      })
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error('OpenAI error:', openaiRes.status, errText);
      await refundCredit('openai_error');
      return res.status(502).json({ error: 'Scanner temporarily unavailable. Credit refunded.', refunded: true });
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
      await refundCredit('parse_error');
      return res.status(502).json({ error: 'Could not read the card. Your credit was refunded — try a clearer photo.', refunded: true });
    }

    if (!cardInfo.card_name) {
      await refundCredit('no_card_name');
      return res.status(422).json({ error: 'Could not identify the card. Your credit was refunded — try a clearer photo with better lighting.', refunded: true });
    }

    if (isGradeMode) {
      return res.status(200).json({
        success:       true,
        mode:          'grade',
        card_name:     cardInfo.card_name     || '',
        centering:     cardInfo.centering     || 'Unknown',
        corners:       cardInfo.corners       || 'Unknown',
        edges:         cardInfo.edges         || 'Unknown',
        surface:       cardInfo.surface       || 'Unknown',
        psa_estimate:  cardInfo.psa_estimate  ?? null,
        grade_label:   cardInfo.grade_label   || '',
        grade_notes:   cardInfo.grade_notes   || '',
        worth_grading: cardInfo.worth_grading ?? false,
        // Identifier fields — used by the frontend to auto-load the exact card into
        // the detail view after grading so the user sees raw + estimated-graded price
        // without having to re-search. Empty strings are OK; the client falls back to
        // a name-only search when card_number/set_name are missing.
        card_number:   cardInfo.card_number   || '',
        set_name:      cardInfo.set_name      || '',
        rarity:        cardInfo.rarity        || '',
      });
    }

    return res.status(200).json({
      success: true,
      mode:        'identify',
      card_name:   cardInfo.card_name   || '',
      card_number: cardInfo.card_number || '',
      set_name:    cardInfo.set_name    || '',
      hp:          cardInfo.hp          || '',
      card_type:   cardInfo.card_type   || 'pokemon',
      rarity:      cardInfo.rarity      || '',
    });

  } catch(err) {
    console.error('Scan error:', err);
    await refundCredit('unexpected');
    return res.status(500).json({ error: 'Scanner temporarily unavailable. Your credit was refunded — please try again.', refunded: true });
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

// Atomic Upstash INCR — returns the value AFTER increment, or null on failure.
async function incrKV(kvUrl, kvToken, key) {
  try {
    const r = await fetch(`${kvUrl}/incr/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    if (!r.ok) return null;
    const d = await r.json();
    const v = d?.result;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const n = parseInt(v); return isNaN(n) ? null : n; }
    return null;
  } catch(e) { return null; }
}

// Atomic Upstash DECR — returns the value AFTER decrement, or null on failure.
async function decrKV(kvUrl, kvToken, key) {
  try {
    const r = await fetch(`${kvUrl}/decr/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    if (!r.ok) return null;
    const d = await r.json();
    const v = d?.result;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const n = parseInt(v); return isNaN(n) ? null : n; }
    return null;
  } catch(e) { return null; }
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
