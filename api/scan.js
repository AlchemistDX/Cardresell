import { verifyTokenFlexible } from './_verifyToken.js';
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
      const tokenInfo = await verifyTokenFlexible(idToken);
      googleSub = tokenInfo.uid   || googleSub;
      userEmail = tokenInfo.email || userEmail;
    } catch(e) { /* proceed with body values */ }
  }

  if (!userEmail) {
    return res.status(401).json({ error: 'Sign in with Google to use the scanner.' });
  }

  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  const hasKV   = !!(kvUrl && kvToken);
  const key     = googleSub || userEmail;

  // ── 3. Get image + mode (read early so credit logic can branch) ──
  const { imageBase64, mimeType, mode, deepGrade } = req.body || {};
  const isGradeMode    = mode === 'grade';
  const isIdentifyMode = !isGradeMode; // identify is the default
  // Deep Grade = 6-photo PSA-style inspection (front + back + 4 edges), costs 2 credits.
  // Only applies to grade mode; ignored otherwise.
  const isDeepGrade    = isGradeMode && deepGrade === true;
  const gradeCost      = isDeepGrade ? 2 : 1;

  // Pull edge photos early so we can validate BEFORE deducting any credits
  const { backBase64, backMimeType,
          topEdgeBase64, topEdgeMimeType,
          bottomEdgeBase64, bottomEdgeMimeType,
          leftEdgeBase64, leftEdgeMimeType,
          rightEdgeBase64, rightEdgeMimeType } = req.body || {};

  // Photo count validation — enforce per-tier minimums BEFORE deducting any credits or
  // spending money on OpenAI. "More photos = better grade" but we set a floor so tier
  // pricing reflects real work being done.
  const edgeCount = [topEdgeBase64, bottomEdgeBase64, leftEdgeBase64, rightEdgeBase64].filter(Boolean).length;
  const totalPhotos = (imageBase64 ? 1 : 0) + (backBase64 ? 1 : 0) + edgeCount;

  if (isDeepGrade) {
    // Deep Grade: 4–6 photos required. Must include front + back at minimum,
    // plus at least 2 edge photos (any combination).
    if (!imageBase64 || !backBase64) {
      return res.status(400).json({
        error: 'Deep Grade requires at least a front and back photo of the card.',
        missingPhotos: [!imageBase64 && 'front', !backBase64 && 'back'].filter(Boolean),
      });
    }
    if (edgeCount < 2) {
      return res.status(400).json({
        error: `Deep Grade needs 4–6 photos total (front, back, plus 2–4 edge close-ups). You provided ${totalPhotos}.`,
        needsMoreEdges: 2 - edgeCount,
        edgeCount,
      });
    }
  } else if (isGradeMode) {
    // Quick Grade: front + back required.
    if (!imageBase64 || !backBase64) {
      return res.status(400).json({
        error: 'Grading requires both a front and back photo of the card.',
        missingPhotos: [!imageBase64 && 'front', !backBase64 && 'back'].filter(Boolean),
      });
    }
  }

  // ── 2. Check & consume scan credit(s) ──
  // Track what was consumed so we can refund on downstream failure.
  let consumedFrom   = null; // 'id_paid_left' | 'paid_left' | 'free'
  let consumedAmount = 0;
  if (hasKV) {
    const isPro = await checkProStatus(process.env.STRIPE_SECRET_KEY, kvUrl, kvToken, googleSub, userEmail);

    if (isIdentifyMode) {
      // ID scans: draw from id_paid_left bucket
      const idPaid = await getKVInt(kvUrl, kvToken, `scans:${key}:id_paid_left`);
      if (idPaid <= 0) {
        return res.status(402).json({ error: 'No ID scan credits remaining.', needsPayment: true, mode: 'identify' });
      }
      await setKV(kvUrl, kvToken, `scans:${key}:id_paid_left`, idPaid - 1);
      consumedFrom = 'id_paid_left';
      consumedAmount = 1;
    } else {
      // Graded scans: draw from Pro free bucket first, then paid_left.
      // Deep Grade costs 2 credits — must come from the SAME bucket (no mixing).
      const paid     = await getKVInt(kvUrl, kvToken, `scans:${key}:paid_left`);
      const stamp    = getMonthStamp();
      const freeUsed = isPro ? await getKVInt(kvUrl, kvToken, `scans:${key}:free_used_${stamp}`) : 10;
      const freeLeft = isPro ? Math.max(0, 10 - freeUsed) : 0;

      if (freeLeft < gradeCost && paid < gradeCost) {
        return res.status(402).json({
          error: gradeCost > 1
            ? `Deep Grade needs ${gradeCost} grading credits. You have ${Math.max(freeLeft, paid)}.`
            : 'No grading credits remaining.',
          needsPayment: true,
          mode: 'grade',
          deepGrade: isDeepGrade,
          cost: gradeCost,
        });
      }
      if (freeLeft >= gradeCost) {
        // Deduct from free bucket by incrementing free_used by gradeCost
        for (let i = 0; i < gradeCost; i++) {
          await incrKV(kvUrl, kvToken, `scans:${key}:free_used_${stamp}`);
        }
        consumedFrom = 'free';
        consumedAmount = gradeCost;
      } else {
        await setKV(kvUrl, kvToken, `scans:${key}:paid_left`, paid - gradeCost);
        consumedFrom = 'paid_left';
        consumedAmount = gradeCost;
      }
    }
  }
  if (!imageBase64) return res.status(400).json({ error: 'No image provided.' });

  // Refund helper — called on any downstream failure so the user isn't charged for a broken scan.
  async function refundCredits() {
    if (!hasKV || !consumedFrom || !consumedAmount) return;
    try {
      if (consumedFrom === 'id_paid_left') {
        const cur = await getKVInt(kvUrl, kvToken, `scans:${key}:id_paid_left`);
        await setKV(kvUrl, kvToken, `scans:${key}:id_paid_left`, cur + consumedAmount);
      } else if (consumedFrom === 'paid_left') {
        const cur = await getKVInt(kvUrl, kvToken, `scans:${key}:paid_left`);
        await setKV(kvUrl, kvToken, `scans:${key}:paid_left`, cur + consumedAmount);
      } else if (consumedFrom === 'free') {
        const stamp = getMonthStamp();
        const cur   = await getKVInt(kvUrl, kvToken, `scans:${key}:free_used_${stamp}`);
        await setKV(kvUrl, kvToken, `scans:${key}:free_used_${stamp}`, Math.max(0, cur - consumedAmount));
      }
    } catch(e) { console.error('Refund error:', e); }
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) { await refundCredits(); return res.status(500).json({ error: 'Scanner not configured.' }); }

  // ── 4. Call GPT-4o Vision ──
  try {
    const mime   = mimeType || 'image/jpeg';
    const dataUrl = `data:${mime};base64,${imageBase64}`;
    const backDataUrl = backBase64 ? `data:${backMimeType || 'image/jpeg'};base64,${backBase64}` : null;

    // Deep Grade edge images (only include ones actually provided — could be 2, 3, or 4)
    const edgeImages = isDeepGrade ? [
      topEdgeBase64    && { label: 'TOP edge',    dataUrl: `data:${topEdgeMimeType    || 'image/jpeg'};base64,${topEdgeBase64}`    },
      bottomEdgeBase64 && { label: 'BOTTOM edge', dataUrl: `data:${bottomEdgeMimeType || 'image/jpeg'};base64,${bottomEdgeBase64}` },
      leftEdgeBase64   && { label: 'LEFT edge',   dataUrl: `data:${leftEdgeMimeType   || 'image/jpeg'};base64,${leftEdgeBase64}`   },
      rightEdgeBase64  && { label: 'RIGHT edge',  dataUrl: `data:${rightEdgeMimeType  || 'image/jpeg'};base64,${rightEdgeBase64}`  },
    ].filter(Boolean) : [];

    // Build ordered image list with human-readable labels for the prompt
    const orderedImages = [
      { label: 'FRONT of card',        dataUrl: dataUrl },
      { label: 'BACK of card',         dataUrl: backDataUrl },
      ...edgeImages, // already labeled TOP/BOTTOM/LEFT/RIGHT if present
    ].filter(x => x.dataUrl);

    const imageDescription = orderedImages.length > 1
      ? `${orderedImages.length} images in order: ${orderedImages.map((img, i) => `(${i+1}) ${img.label}`).join(', ')}.`
      : 'ONE image: the FRONT of a card only';

    const deepGradeInstructions = isDeepGrade ? `

DEEP GRADE MODE — You have ${orderedImages.length} photos including ${edgeImages.length} dedicated edge close-up${edgeImages.length === 1 ? '' : 's'}. This is a professional-tier inspection. Be MORE precise on the per-pillar sub-grades because you can actually see corner and edge detail. Use the edge close-ups to catch flaws that would be invisible in a whole-card shot.${edgeImages.length < 4 ? ` (Note: fewer than 4 edge shots — use "medium" confidence unless the shots you have are very clear.)` : ''}

DEEP GRADE PRECISION RULES (mandatory — no ranges allowed):
1. Return ONE integer psa_estimate (1-10). NEVER return a range like "8-10" or "9 or 10".
2. Return confidence_pct as an integer 0-100 reflecting how sure you are of that single grade.
   - 85-100 = confident (multiple photos, all pillars clearly visible)
   - 60-84  = reasonably sure (minor angles/lighting could change one pillar)
   - 40-59  = tentative (some pillar was hard to read — you're still committing to ONE grade)
   - 0-39   = low confidence — in this case ALSO set needs_more_photos:true and explain in grade_notes what's missing (e.g. "back edge not visible")
3. Return located_flaws: an array where each entry is {"location":"...","severity":"faint|light|moderate|heavy","description":"..."}. Locations MUST be specific: "top-left corner", "top-right corner", "bottom-left corner", "bottom-right corner", "top edge", "bottom edge", "left edge", "right edge", "front surface — top half", "front surface — bottom half", "front surface — holo area", "back surface", "centering". Include ONLY flaws you can actually see. If the card is genuinely flawless return [].
4. Sub-grades stay on the 0.5 grid (e.g. 9.5, 8.0). Match the located_flaws — a flaw at "top-left corner" should pull the corners sub-grade down.
5. Committing to a single grade with lower confidence is ALWAYS preferred over returning a range or hedging with "8-9".` : '';

    const prompt = isGradeMode
      ? `You are a strict, professional trading card grader trained to PSA standards. You are analyzing ${imageDescription}.${deepGradeInstructions}

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
10. subgrades: object with numeric 1-10 sub-scores for each pillar: { "centering": 9.5, "corners": 8.5, "edges": 9, "surface": 9 }. Use half-steps (e.g. 8.5). Be strict — match the descriptors above.
11. confidence: "high" | "medium" | "low" — how confident you are in this grade given the photo quality and angles you had to work with.
${isDeepGrade ? `12. confidence_pct: integer 0-100 (see DEEP GRADE PRECISION RULES above).
13. located_flaws: array of {location, severity, description} — empty array [] if the card is genuinely flawless.
14. needs_more_photos: boolean — true ONLY when confidence_pct < 40 and the missing photo would resolve the ambiguity.` : ''}

Respond ONLY with valid JSON:
${isDeepGrade
  ? `{"card_name":"...","centering":"...","corners":"...","edges":"...","surface":"...","psa_estimate":8,"grade_label":"...","grade_notes":"...","worth_grading":false,"subgrades":{"centering":9,"corners":8.5,"edges":9,"surface":9},"confidence":"medium","confidence_pct":72,"located_flaws":[{"location":"top-left corner","severity":"light","description":"faint whitening visible under angled light"}],"needs_more_photos":false}`
  : `{"card_name":"...","centering":"...","corners":"...","edges":"...","surface":"...","psa_estimate":8,"grade_label":"...","grade_notes":"...","worth_grading":false,"subgrades":{"centering":9,"corners":8.5,"edges":9,"surface":9},"confidence":"medium"}`
}`
      : `You are a trading card expert. Look at this card image and identify it.

BE HONEST about uncertainty. If the card art, number, or set name isn't perfectly clear (blurry photo, glare, similar-looking cards from different sets, unclear card number), you MUST return your top 2–3 candidate matches with a confidence score for each, INSTEAD of guessing one wrong answer. Only return a single answer when you are highly confident it's correct.

Extract for the best match:
1. card_name: The Pokémon or character name (e.g. "Mewtwo VSTAR", "Charizard ex", "LeBron James")
2. card_number: The card number (e.g. "079/078", "025/165")
3. set_name: The set name (e.g. "Pokémon GO", "Crown Zenith", "Prizm") — VERIFY the set matches the card number range and art style. Do not guess a set.
4. hp: HP number if Pokémon card (e.g. "280")
5. card_type: "pokemon", "sports", or "mtg"
6. rarity: e.g. "Rainbow Rare", "Secret Rare", "Holo Rare"
7. confidence: "high" | "medium" | "low" — be strict. "high" means you can clearly read the card number AND the set symbol AND the art matches. Any doubt → "medium" or "low".
8. candidates: OPTIONAL array of top 2–3 matches when confidence is medium or low. Each element: {card_name, card_number, set_name, hp, card_type, rarity, confidence_pct}. Rank most likely first. If confidence is "high", omit or return an empty array.

Respond ONLY with valid JSON, no explanation:
{"card_name":"...","card_number":"...","set_name":"...","hp":"...","card_type":"...","rarity":"...","confidence":"high|medium|low","candidates":[{"card_name":"...","card_number":"...","set_name":"...","hp":"...","card_type":"...","rarity":"...","confidence_pct":75}]}`;

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: isDeepGrade ? 700 : (isGradeMode ? 500 : 300),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: dataUrl, detail: 'high' }
              },
              // Include back image for grade mode if provided
              ...(isGradeMode && backDataUrl ? [{
                type: 'image_url',
                image_url: { url: backDataUrl, detail: 'high' }
              }] : []),
              // Deep Grade: include whatever edge close-ups the user provided (2–4)
              ...edgeImages.map(e => ({
                type: 'image_url',
                image_url: { url: e.dataUrl, detail: 'high' }
              })),
              { type: 'text', text: prompt }
            ]
          }
        ]
      })
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error('OpenAI error:', openaiRes.status, errText);
      // Refund whatever credits we deducted (1 for quick / identify, 2 for deep grade)
      await refundCredits();
      return res.status(502).json({ error: 'Scanner temporarily unavailable. Credits refunded.' });
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
      // Refund on parse failure — user didn't get a valid grade.
      await refundCredits();
      return res.status(502).json({ error: 'Could not identify this card. Try a clearer photo. Credits refunded.' });
    }

    if (!cardInfo.card_name) {
      await refundCredits();
      return res.status(422).json({ error: 'Could not identify the card. Try a clearer photo with better lighting. Credits refunded.' });
    }

    if (isGradeMode) {
      // Coerce sub-grades to numbers (GPT sometimes returns strings) and clamp 1-10.
      const clampSub = (v) => {
        const n = typeof v === 'number' ? v : parseFloat(v);
        if (!isFinite(n)) return null;
        return Math.max(1, Math.min(10, n));
      };
      const sg = cardInfo.subgrades || {};
      const subgrades = {
        centering: clampSub(sg.centering),
        corners:   clampSub(sg.corners),
        edges:     clampSub(sg.edges),
        surface:   clampSub(sg.surface),
      };
      // Compute a server-side confidence floor based on how many photos we actually had.
      // GPT can't over-claim: if it says "high" but we only had 2 photos, we downgrade to medium.
      const gptConf = (typeof cardInfo.confidence === 'string')
        ? cardInfo.confidence.toLowerCase()
        : null;
      const gptConfNorm = ['high','medium','low'].includes(gptConf) ? gptConf : null;
      // Photo-count-based ceiling for confidence:
      //   Deep Grade 6 photos = up to high
      //   Deep Grade 4–5 photos = up to medium
      //   Quick Grade 2 photos = up to medium
      const photoCap = totalPhotos >= 6 ? 'high' : (totalPhotos >= 4 ? 'medium' : 'medium');
      const capOrder = { low: 0, medium: 1, high: 2 };
      const defaultConf = isDeepGrade ? (totalPhotos >= 6 ? 'high' : 'medium') : 'medium';
      let confidence = gptConfNorm || defaultConf;
      if (capOrder[confidence] > capOrder[photoCap]) confidence = photoCap;

      // ── Deep-Grade-only precision fields ──
      // confidence_pct: integer 0-100. Committed to a single PSA number.
      // located_flaws:  array of {location, severity, description}.
      // needs_more_photos: true only when confidence_pct is very low.
      let confidencePct = null;
      let locatedFlaws = [];
      let needsMorePhotos = false;
      if (isDeepGrade) {
        // Parse confidence_pct — accept number or "72%" style strings.
        const rawPct = cardInfo.confidence_pct;
        const pctNum = typeof rawPct === 'number' ? rawPct : parseFloat(String(rawPct || '').replace('%', ''));
        if (isFinite(pctNum)) confidencePct = Math.max(0, Math.min(100, Math.round(pctNum)));

        // Fall back to deriving a pct from the string confidence if the model didn't return one.
        if (confidencePct == null) {
          confidencePct = confidence === 'high' ? 85 : confidence === 'low' ? 40 : 65;
        }

        // Clamp confidence_pct by photo count so the model can't over-claim on 4-photo Deep Grade.
        const pctCap = totalPhotos >= 6 ? 95 : (totalPhotos >= 4 ? 80 : 65);
        if (confidencePct > pctCap) confidencePct = pctCap;

        // Located flaws — sanitize each entry.
        const rawFlaws = Array.isArray(cardInfo.located_flaws) ? cardInfo.located_flaws : [];
        const okSeverity = new Set(['faint','light','moderate','heavy']);
        locatedFlaws = rawFlaws
          .filter(f => f && typeof f === 'object' && (f.location || f.description))
          .slice(0, 8)
          .map(f => ({
            location:    String(f.location || '').slice(0, 60).trim() || 'unspecified',
            severity:    okSeverity.has(String(f.severity || '').toLowerCase())
                           ? String(f.severity).toLowerCase()
                           : 'light',
            description: String(f.description || '').slice(0, 200).trim(),
          }));

        needsMorePhotos = cardInfo.needs_more_photos === true || confidencePct < 40;
      }

      return res.status(200).json({
        success:       true,
        mode:          'grade',
        deepGrade:     isDeepGrade,
        creditsUsed:   gradeCost,
        photoCount:    totalPhotos,
        card_name:     cardInfo.card_name     || '',
        centering:     cardInfo.centering     || 'Unknown',
        corners:       cardInfo.corners       || 'Unknown',
        edges:         cardInfo.edges         || 'Unknown',
        surface:       cardInfo.surface       || 'Unknown',
        psa_estimate:  cardInfo.psa_estimate  ?? null,
        grade_label:   cardInfo.grade_label   || '',
        grade_notes:   cardInfo.grade_notes   || '',
        worth_grading: cardInfo.worth_grading ?? false,
        subgrades,
        confidence,
        // Deep-Grade-only precision fields (null/empty for Quick Grade for backward compat)
        confidence_pct:    isDeepGrade ? confidencePct   : null,
        located_flaws:     isDeepGrade ? locatedFlaws    : [],
        needs_more_photos: isDeepGrade ? needsMorePhotos : false,
      });
    }

    // ── Low-confidence path: return top candidates and refund the credit.
    // Frontend shows a "Is it one of these?" picker; user selects the correct card;
    // then a second scan-confirm call debits the credit. This prevents charging
    // users when the AI wasn't sure and got it wrong.
    const idConf = (typeof cardInfo.confidence === 'string')
      ? cardInfo.confidence.toLowerCase()
      : null;
    const idConfNorm = ['high','medium','low'].includes(idConf) ? idConf : null;
    const rawCandidates = Array.isArray(cardInfo.candidates) ? cardInfo.candidates : [];
    const cleanCandidates = rawCandidates
      .filter(c => c && typeof c === 'object' && (c.card_name || c.card_number))
      .slice(0, 3)
      .map(c => ({
        card_name:      c.card_name      || '',
        card_number:    c.card_number    || '',
        set_name:       c.set_name       || '',
        hp:             c.hp             || '',
        card_type:      c.card_type      || 'pokemon',
        rarity:         c.rarity         || '',
        confidence_pct: (typeof c.confidence_pct === 'number' ? c.confidence_pct : null),
      }));

    // Only trigger the picker when the model is actually uncertain AND we got
    // multiple candidates. High-confidence single answers pass straight through.
    if ((idConfNorm === 'low' || idConfNorm === 'medium') && cleanCandidates.length >= 2) {
      // Refund the ID credit — user hasn't gotten a final answer yet.
      await refundCredits();
      return res.status(200).json({
        success:      true,
        mode:         'identify',
        needsPicker:  true,
        confidence:   idConfNorm,
        candidates:   cleanCandidates,
        // Also include the top guess for UI convenience.
        card_name:    cardInfo.card_name   || cleanCandidates[0].card_name   || '',
        card_number:  cardInfo.card_number || cleanCandidates[0].card_number || '',
        set_name:     cardInfo.set_name    || cleanCandidates[0].set_name    || '',
        hp:           cardInfo.hp          || cleanCandidates[0].hp          || '',
        card_type:    cardInfo.card_type   || cleanCandidates[0].card_type   || 'pokemon',
        rarity:       cardInfo.rarity      || cleanCandidates[0].rarity      || '',
      });
    }

    // ── HIGH-CONFIDENCE PATH: verify against PokemonTCG.io before returning ──
    // GPT-4o often nails the card_name but hallucinates card_number + set_name.
    // If the {name, number, set} combo isn't a real card, either rewrite it
    // with the actual best match or downgrade to a picker.
    const startingConf = idConfNorm || 'high';
    const verified = await verifyCardWithPokemonTCG(
      cardInfo.card_name   || '',
      cardInfo.card_number || '',
      cardInfo.set_name    || '',
      cardInfo.hp          || '',
      cardInfo.rarity      || ''
    );

    if (verified.status === 'match') {
      // GPT's answer matched a real card. Trust it, optionally normalizing.
      return res.status(200).json({
        success: true,
        mode:        'identify',
        confidence:  startingConf,
        card_name:   verified.card.card_name,
        card_number: verified.card.card_number,
        set_name:    verified.card.set_name,
        hp:          cardInfo.hp        || verified.card.hp        || '',
        card_type:   cardInfo.card_type || 'pokemon',
        rarity:      cardInfo.rarity    || verified.card.rarity    || '',
        verified_by: 'pokemontcg',
      });
    }

    if (verified.status === 'rewrite') {
      // Name matched but number/set was hallucinated. Rewrite with the real card.
      // Downgrade confidence slightly since we corrected the model.
      return res.status(200).json({
        success: true,
        mode:        'identify',
        confidence:  startingConf === 'high' ? 'medium' : startingConf,
        card_name:   verified.card.card_name,
        card_number: verified.card.card_number,
        set_name:    verified.card.set_name,
        hp:          verified.card.hp        || cardInfo.hp        || '',
        card_type:   cardInfo.card_type || 'pokemon',
        rarity:      verified.card.rarity    || cardInfo.rarity    || '',
        verified_by: 'pokemontcg',
        // If we have multiple plausible matches, offer picker so user can confirm
        ...(verified.candidates && verified.candidates.length >= 2 ? {
          needsPicker: true,
          candidates: verified.candidates,
        } : {}),
      });
    }

    // status === 'no_match' (name didn't even match any real card) OR
    // status === 'skip' (PokemonTCG.io unavailable — trust GPT as-is)
    // For 'no_match' we downgrade because GPT is likely hallucinating the whole card.
    // For 'skip' we return unchanged so we never block on a 3rd-party outage.
    if (verified.status === 'no_match') {
      return res.status(200).json({
        success: true,
        mode:        'identify',
        confidence:  'low',
        card_name:   cardInfo.card_name   || '',
        card_number: cardInfo.card_number || '',
        set_name:    cardInfo.set_name    || '',
        hp:          cardInfo.hp          || '',
        card_type:   cardInfo.card_type   || 'pokemon',
        rarity:      cardInfo.rarity      || '',
        verified_by: 'pokemontcg',
        unverified:  true,
      });
    }

    return res.status(200).json({
      success: true,
      mode:        'identify',
      confidence:  startingConf,
      card_name:   cardInfo.card_name   || '',
      card_number: cardInfo.card_number || '',
      set_name:    cardInfo.set_name    || '',
      hp:          cardInfo.hp          || '',
      card_type:   cardInfo.card_type   || 'pokemon',
      rarity:      cardInfo.rarity      || '',
    });

  } catch(err) {
    console.error('Scan error:', err);
    // Refund on any unexpected exception
    try { await refundCredits(); } catch(e) {}
    return res.status(500).json({ error: 'Scanner temporarily unavailable. Credits refunded. Please try again.' });
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

// ── PokemonTCG.io verification ──
// GPT-4o can return a confident card_name but hallucinate a fake set_name +
// card_number combo (e.g. "MEO2: Phantasmal Flames · 105/094" for a card that
// actually lives in "Crystal Guardians"). Query PokemonTCG.io and:
//   'match'    - the {name, number, set} combo is a real card. Trust GPT.
//   'rewrite'  - the name matched real cards but the number/set was wrong.
//                Replace them with the best real match, offer picker if ambiguous.
//   'no_match' - the name doesn't match any card in the database. Likely full
//                hallucination — downgrade confidence + mark unverified.
//   'skip'     - PokemonTCG.io was unreachable. Don't block on it — trust GPT.
// Timeout of 4s so a slow API doesn't wedge the scanner.
async function verifyCardWithPokemonTCG(name, number, setName, hp, rarity) {
  if (!name || typeof name !== 'string') return { status: 'skip' };
  // Strip any trailing collector number from name ("Wigglytuff 105/094" —> "Wigglytuff")
  // so we don't feed it into the API's `name:` query and get zero hits.
  const cleanName = name.replace(/["\\]/g, '').replace(/\s+#?0*\d+(?:\s*\/\s*\d+)?\s*$/,'').trim();
  const cleanNumber = (number || '').replace(/\/.*$/, '').replace(/^0+/, '').trim();
  const cleanSet    = (setName || '').trim().toLowerCase();
  const cleanHp     = (hp || '').toString().replace(/[^0-9]/g, '');
  const cleanRarity = (rarity || '').toString().toLowerCase();
  if (!cleanName) return { status: 'skip' };

  // Try multiple query strategies. Critically, we run ALL of them and merge
  // the results — the exact-name query returns oldest-set-first and often
  // truncates modern sets past pageSize; the number-scoped query catches those.
  const firstWord = cleanName.split(/\s+/)[0];
  const queries = [
    ...(cleanNumber ? [`name:${firstWord}* number:${cleanNumber}`] : []),
    `name:"${cleanName}"`,
    `name:${firstWord}*`,
  ];

  const merged = new Map(); // id -> card
  let anyQueryReachedApi = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    for (const q of queries) {
      const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=30&select=id,name,set,number,rarity,hp,supertype,images`;
      let r;
      try { r = await fetch(url, { signal: controller.signal }); } catch(e) { continue; }
      if (!r.ok) continue;
      anyQueryReachedApi = true;
      let j;
      try { j = await r.json(); } catch(e) { continue; }
      for (const c of (j.data || [])) {
        if (c && c.id && !merged.has(c.id)) merged.set(c.id, c);
      }
      // Early-exit only after the number-scoped query if it returned a hit —
      // that's usually the definitive answer.
      if (q.startsWith(`name:${firstWord}* number:`) && merged.size > 0) break;
    }
  } catch(e) {
    return { status: 'skip' };
  } finally {
    clearTimeout(timer);
  }

  if (!anyQueryReachedApi) return { status: 'skip' };
  const cards = Array.from(merged.values());
  if (cards.length === 0) return { status: 'no_match' };

  const normSet = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const gptSetNorm = normSet(cleanSet);

  // Score each candidate. Higher = better. Number is the strongest signal;
  // HP is a fingerprint (same Pokemon has different HP across sets);
  // rarity narrows to the right print variant.
  const numOf = (c) => {
    const raw = (c.number || '').toString();
    return raw.split('/')[0].replace(/^0+/, '').trim();
  };
  // Assemble full "X/Y" collector number. PokemonTCG.io stores `card.number`
  // as just the numerator (e.g. "197") and the denominator on
  // `card.set.printedTotal` (e.g. 196 for a Secret Rare 197/196). eBay's
  // catalog matcher needs the full X/Y to hit the right print variant, so
  // always emit "X/Y" when we have a printedTotal.
  const fullNumOf = (c) => {
    const raw = (c.number || '').toString().trim();
    if (!raw) return '';
    if (raw.includes('/')) return raw; // already X/Y (rare, but be safe)
    const denom = c.set?.printedTotal || c.set?.total;
    return denom ? `${raw}/${denom}` : raw;
  };
  const score = (c) => {
    let s = 0;
    const cNum = numOf(c);
    const cSet = normSet(c.set?.name);
    const cHp  = (c.hp || '').toString().replace(/[^0-9]/g, '');
    const cRar = (c.rarity || '').toString().toLowerCase();
    // Number match — the strongest signal we have
    if (cleanNumber && cNum === cleanNumber) s += 100;
    // Set fuzzy match — GPT often gets this wrong so weight lower than num
    if (gptSetNorm && cSet && (cSet.includes(gptSetNorm) || gptSetNorm.includes(cSet))) s += 40;
    // HP fingerprint — very reliable when the model actually read HP off the card
    if (cleanHp && cHp && cleanHp === cHp) s += 30;
    // Rarity signal — illustration rare / secret rare / etc
    if (cleanRarity && cRar) {
      if (cRar === cleanRarity) s += 20;
      else {
        // partial rarity token match (e.g. "illustration" ≤≥ "illustration rare")
        const tokens = cleanRarity.split(/\s+/).filter(t => t.length > 3);
        if (tokens.some(t => cRar.includes(t))) s += 10;
      }
    }
    // Prefer exact-name matches over wildcard "name*" hits
    if ((c.name || '').toLowerCase() === cleanName.toLowerCase()) s += 5;
    return s;
  };

  const ranked = cards
    .map(c => ({ c, s: score(c) }))
    .sort((a, b) => b.s - a.s);

  const topScore   = ranked[0].s;
  const runnerUp   = ranked[1] ? ranked[1].s : -1;
  const topCard    = ranked[0].c;

  // High-confidence match: number matched AND (set OR hp OR rarity) matched
  // and no other card is close in score.
  const decisive = topScore >= 100 && (topScore - runnerUp) >= 20;

  if (decisive) {
    return {
      status: 'match',
      card: {
        card_name:   topCard.name || cleanName,
        card_number: fullNumOf(topCard) || cleanNumber,
        set_name:    topCard.set?.name || setName,
        hp:          topCard.hp || '',
        rarity:      topCard.rarity || '',
      },
    };
  }

  // Otherwise return top-N candidates for the picker so the user resolves it.
  const candidates = ranked.slice(0, 3).map(({ c }) => ({
    card_name:      c.name || cleanName,
    card_number:    fullNumOf(c),
    set_name:       c.set?.name || '',
    hp:             c.hp || '',
    card_type:      'pokemon',
    rarity:         c.rarity || '',
    confidence_pct: null,
    image_small:    c.images?.small || c.images?.large || '',
  }));

  return {
    status: 'rewrite',
    card: {
      card_name:   topCard.name || cleanName,
      card_number: fullNumOf(topCard),
      set_name:    topCard.set?.name || '',
      hp:          topCard.hp || '',
      rarity:      topCard.rarity || '',
    },
    candidates,
  };
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
