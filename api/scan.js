import { verifyTokenFlexible } from './_verifyToken.js';
import { identifyWithXimilar } from './_ximilar.js';
// /api/scan — Ximilar-first card identification (GPT-5 fallback)
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
  // Every scan gets a short opaque id so the user can request a refund from the
  // "not my card" button. We ONLY log successful identify responses so the id
  // is never claimable if the credit was already refunded on the server side.
  const scanId = _shortId();
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

  const openaiKey    = process.env.OPENAI_API_KEY;
  const ximilarToken = process.env.XIMILAR_API_TOKEN;
  if (!openaiKey) { await refundCredits(); return res.status(500).json({ error: 'Scanner not configured.' }); }

  // ── 4a. Try Ximilar FIRST for identify mode ──
  // Ximilar's purpose-built collectibles model returns in ~1s and covers
  // Pokemon/MTG/YGO/Lorcana/OnePiece/Sports. GPT-5 was taking 30-60s per
  // scan; Ximilar cuts that to ~1s with better accuracy on holos.
  //
  // Fallthrough conditions (chain to GPT-5):
  //   - identify mode only (grade mode still uses GPT for centering/edges)
  //   - Ximilar returns low_confidence, no_match, network error, http error
  //   - No XIMILAR_API_TOKEN env var
  if (isIdentifyMode && ximilarToken && imageBase64) {
    // Detect "maybe sports" heuristically: user hasn't told us, and Ximilar's
    // TCG endpoint would return no_match for real sports cards. Try TCG first;
    // fall back to sport_id if the first attempt returns no_match/no_card.
    const t0 = Date.now();
    let xim = await identifyWithXimilar(imageBase64, mimeType || 'image/jpeg', ximilarToken, 'tcg');
    if (!xim.ok && (xim.reason === 'no_match' || xim.reason === 'no_card_detected')) {
      // Retry as sports card (cheap: still 10 credits, same as TCG)
      const ximSport = await identifyWithXimilar(imageBase64, mimeType || 'image/jpeg', ximilarToken, 'sport');
      if (ximSport.ok) xim = ximSport;
    }
    const tMs = Date.now() - t0;
    console.log('[scan] ximilar took', tMs, 'ms ok=', xim.ok, 'reason=', xim.reason, 'dist=', xim.cardInfo?._ximilar_dist);

    if (xim.ok) {
      const cardInfo = xim.cardInfo;
      const idConfNorm = cardInfo.confidence || 'high';

      // Multi-candidate picker path
      if (xim.needsPicker && Array.isArray(xim.candidates) && xim.candidates.length >= 2) {
        await refundCredits();
        const cleanCandidates = xim.candidates.map(c => ({
          card_name: c.card_name, card_number: c.card_number, set_name: c.set_name,
          set_code: c.set_code || '', hp: c.hp || '', card_type: c.card_type || 'pokemon',
          is_japanese: c.is_japanese === true, rarity: c.rarity || '',
          sport: c.sport || '', year: c.year || '',
          confidence_pct: c.confidence_pct || 50,
          grounded_id: c._grounded_id || null,
        }));
        return res.status(200).json({
          success: true, mode: 'identify', needsPicker: true,
          confidence: 'medium', candidates: cleanCandidates,
          image_quality: 'ok', glare_regions: [], retake_hint: '',
          card_name: cardInfo.card_name, card_number: cardInfo.card_number,
          set_name: cardInfo.set_name, set_code: cardInfo.set_code,
          grounded: true, grounded_id: cardInfo._grounded_id,
          hp: cardInfo.hp, card_type: cardInfo.card_type,
          is_japanese: cardInfo.is_japanese, jp_name: cardInfo.jp_name,
          rarity: cardInfo.rarity, sport: cardInfo.sport, year: cardInfo.year,
          source: 'ximilar',
        });
      }

      // Single confident answer — log + return, skip GPT entirely
      _incrSearchStats(kvUrl, kvToken);
      if (hasKV && consumedFrom) {
        try {
          const record = {
            uid: key, consumed_from: consumedFrom, consumed_amount: consumedAmount,
            card_name: cardInfo.card_name, card_number: cardInfo.card_number,
            set_name: cardInfo.set_name, confidence: idConfNorm,
            image_quality: 'ok', created_at: Date.now(), source: 'ximilar',
          };
          await setKVWithTTL(kvUrl, kvToken, `scan:${scanId}`, JSON.stringify(record), 3600);
        } catch(e) { /* non-fatal */ }
      }
      return res.status(200).json({
        success: true, mode: 'identify', scan_id: scanId,
        confidence: idConfNorm, image_quality: 'ok',
        glare_regions: [], retake_hint: '',
        card_name: cardInfo.card_name, card_number: cardInfo.card_number,
        set_name: cardInfo.set_name, set_code: cardInfo.set_code,
        grounded: true, grounded_id: cardInfo._grounded_id,
        hp: cardInfo.hp, card_type: cardInfo.card_type,
        is_japanese: cardInfo.is_japanese, jp_name: cardInfo.jp_name,
        rarity: cardInfo.rarity, sport: cardInfo.sport, year: cardInfo.year,
        source: 'ximilar',
      });
    }
    // else: fall through to GPT-5 vision (unchanged path below)
    console.log('[scan] ximilar miss, falling back to GPT-5');
  }

  // ── 4. Call GPT-4o Vision (fallback) ──
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

DEEP GRADE MODE — You have ${orderedImages.length} photos including ${edgeImages.length} dedicated edge close-up${edgeImages.length === 1 ? '' : 's'}. This is a professional-tier inspection. Be MORE precise on the per-pillar sub-grades because you can actually see corner and edge detail. Use the edge close-ups to catch flaws that would be invisible in a whole-card shot.${edgeImages.length < 4 ? ` (Note: fewer than 4 edge shots — use "medium" confidence unless the shots you have are very clear.)` : ''}` : '';

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

Respond ONLY with valid JSON:
{"card_name":"...","centering":"...","corners":"...","edges":"...","surface":"...","psa_estimate":8,"grade_label":"...","grade_notes":"...","worth_grading":false,"subgrades":{"centering":9,"corners":8.5,"edges":9,"surface":9},"confidence":"medium"}`
      : `You are a trading card expert. Look at this card image and identify it.

BE HONEST about uncertainty. If the card art, number, or set name isn't perfectly clear (blurry photo, glare, similar-looking cards from different sets, unclear card number), you MUST return your top 2–3 candidate matches with a confidence score for each, INSTEAD of guessing one wrong answer. Only return a single answer when you are highly confident it's correct.

GLARE + SLEEVE HANDLING: Reflective toploaders and holographic sleeves often create glare that blocks key details (card number, set symbol, or HP). If glare is blocking a critical detail:
  - Set confidence to "low" and set image_quality to "glare_blocked"
  - Populate glare_regions with which detail is blocked: "card_number", "set_symbol", "card_name", or "art"
  - Still return your best-guess candidates from what IS visible, but DO NOT pretend to read details you can't see
  - Suggest a retake angle in retake_hint (e.g. "Tilt the card 15° away from the light source and remove any reflective sleeve.")

Other low-quality photo signals: blur, cropped edges, dark shadow, upside-down. Set image_quality to "blurry", "cropped", "dark", or "rotated" accordingly.

Extract for the best match:
1. card_name: The Pokémon or character or player name IN ENGLISH (e.g. "Mewtwo VSTAR", "Charizard ex", "Ampharos", "LeBron James"). CRITICAL: This field must ALWAYS be populated when ANY name is visible on the card, even if you're uncertain about the exact set. The name is the most-visible part of every card and near-impossible to misread — do NOT leave this blank just because set/number are uncertain. Only leave it blank if the card is truly unrecognizable (upside down, torn, or completely blurred). If the card is Japanese and only shows katakana/hiragana (e.g. "ラフレシア"), TRANSLATE to the English Pokémon name ("Vileplume") and put that in card_name. Never return raw Japanese text in card_name.
2. card_number: The card number (e.g. "079/078", "025/165", or for sports the printed # like "175" or "RA-LJ")
3. set_name: The exact printed set name (e.g. "Pokémon GO", "Crown Zenith", "Topps Chrome", "Panini Prizm"). CRITICAL: You MUST return either a real set name OR an empty string "". NEVER return editorial commentary like "Not an official set", "counterfeit", "custom card", "unknown", or "fake" — our database will look up the set from the card number if you don't know it. If you can't read the set symbol clearly, return "".
3b. set_code: The 2-4 character SET CODE printed in the BOTTOM-LEFT or BOTTOM-RIGHT of Pokémon cards, right next to or above the card number (e.g. "SVI", "MEW", "ME04", "CRZ", "PGO", "151", "SV1", "OBF"). This code is HIGHLY reliable and lets us look up the exact set even when set_name is unknown. Read the exact printed characters. If not visible or unreadable, return "".
4. hp: HP number if Pokémon card (e.g. "280")
5. card_type: One of "pokemon", "mtg", "yugioh", "lorcana", "onepiece", or "sports". Look at the frame/back/logo to decide — Magic cards have a mana cost circle in the top right; Yu-Gi-Oh cards have a diamond attribute icon and level stars; Lorcana cards have an ink cost in the top left and Disney characters; One Piece cards have a colored border with cost in a circle; Pokémon cards show HP and energy symbols. Sports cards show a photo of a real athlete, a team logo/jersey, brand marks like Topps/Panini/Bowman/Upper Deck/Fleer/Donruss/Score/Select/Prizm/Optic/Mosaic/Chronicles, and often a copyright year.
6. is_japanese: true if the card text is primarily Japanese (hiragana/katakana/kanji) OR the card number uses JP set codes like "SV5K", "s10a", "sv4a". Otherwise false. STRONG SIGNALS for is_japanese=true: any katakana on the name line (ラフレシア, リザードン), the word ポケモン or たね anywhere on the card, or JP-specific rarity markers (RR, SR, SAR, UR). If is_japanese=true, set_name should be the English name of the JP set (e.g. "Jungle" not 「ジャングル」, "151" not 「ポケモンカード151」).
7. rarity: e.g. "Rainbow Rare", "Secret Rare", "Holo Rare", or for sports: "Refractor", "Rookie", "Auto", "Numbered /99", "Base", etc.
8. sport: ONLY for sports cards — one of "Baseball", "Basketball", "Football", "Hockey", "Soccer", "Other". Determine by team logo, jersey style, or ball visible.
9. year: ONLY for sports cards — the copyright / season year printed on the card (e.g. "2023", "2011", "1997").
10. confidence: "high" | "medium" | "low" — be strict. "high" means you can clearly read the card number AND the set symbol AND the art matches. Any doubt → "medium" or "low". If image_quality is anything other than "ok", confidence must be "low".
11. candidates: OPTIONAL array of top 2–3 matches when confidence is medium or low. Each element: {card_name, card_number, set_name, hp, card_type, is_japanese, rarity, sport, year, confidence_pct}. Rank most likely first. If confidence is "high", omit or return an empty array.
12. image_quality: "ok" | "glare_blocked" | "blurry" | "cropped" | "dark" | "rotated" — a single tag describing the photo. Use "ok" only when you can clearly see all key details.
13. glare_regions: OPTIONAL array of strings when image_quality="glare_blocked". Elements: "card_number", "set_symbol", "card_name", "art", "hp".
14. retake_hint: OPTIONAL 1-sentence advice for the user on how to retake the photo. Only include when image_quality != "ok".
15. jp_name: OPTIONAL. If is_japanese=true, the raw Japanese card name as printed on the card (e.g. "ラフレシア", "リザードン"). Omit for English cards.

Respond ONLY with valid JSON, no explanation:
{"card_name":"...","card_number":"...","set_name":"...","set_code":"...","hp":"...","card_type":"...","is_japanese":false,"jp_name":"","rarity":"...","sport":"...","year":"...","confidence":"high|medium|low","image_quality":"ok","glare_regions":[],"retake_hint":"","candidates":[{"card_name":"...","card_number":"...","set_name":"...","set_code":"...","hp":"...","card_type":"...","is_japanese":false,"rarity":"...","sport":"...","year":"...","confidence_pct":75}]}`;

    // Build the vision content once so we can retry with a different model if needed.
    const visionContent = [
      { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
      ...(isGradeMode && backDataUrl ? [{ type: 'image_url', image_url: { url: backDataUrl, detail: 'high' } }] : []),
      ...edgeImages.map(e => ({ type: 'image_url', image_url: { url: e.dataUrl, detail: 'high' } })),
      { type: 'text', text: prompt }
    ];

    // 2026-08-16: try gpt-5 first (native multimodal, 84.2% MMMU vs
    // gpt-4o's 72.2% — huge win on card ID / OCR-through-glare). If
    // it errors (org tier not enabled, unknown-param rejection, etc.)
    // fall back to gpt-4o so identify never hard-fails on a model change.
    async function callModel(modelId) {
      const isGpt5 = modelId.startsWith('gpt-5');
      const body = {
        model: modelId,
        messages: [{ role: 'user', content: visionContent }],
      };
      if (isGpt5) {
        body.reasoning_effort = 'low';
        // GPT-5 reasoning tokens count toward max_completion_tokens.
        // Even at 'low' effort, reasoning can eat 500-1500 tokens before
        // any visible output. Give a generous budget so real output isn't
        // truncated / empty.
        body.max_completion_tokens = isDeepGrade ? 5000 : (isGradeMode ? 4000 : 3000);
      } else {
        body.max_tokens = isDeepGrade ? 700 : (isGradeMode ? 500 : 300);
      }
      return fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    }

    // Try gpt-5 first, then gpt-4o. Fall through on 3 conditions:
    //   (1) HTTP error on the response
    //   (2) empty message content (gpt-5 can burn all tokens on reasoning)
    //   (3) JSON parse failure (model returned prose instead of JSON)
    async function tryModel(modelId) {
      const r = await callModel(modelId);
      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        return { ok: false, reason: 'http', status: r.status, errText: errText.slice(0, 300) };
      }
      const j = await r.json();
      const content = j.choices?.[0]?.message?.content || '';
      const finishReason = j.choices?.[0]?.finish_reason || '';
      if (!content.trim()) {
        return { ok: false, reason: 'empty', finish_reason: finishReason, usage: j.usage };
      }
      try {
        const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        // Handle cases where model wrapped JSON in extra text: find first {...} block.
        const jsonStart = cleaned.indexOf('{');
        const jsonEnd = cleaned.lastIndexOf('}');
        const jsonStr = (jsonStart >= 0 && jsonEnd > jsonStart) ? cleaned.slice(jsonStart, jsonEnd + 1) : cleaned;
        return { ok: true, cardInfo: JSON.parse(jsonStr), raw: content };
      } catch(e) {
        return { ok: false, reason: 'parse', raw: content.slice(0, 500) };
      }
    }

    let modelUsed = 'gpt-5';
    let attempt = await tryModel('gpt-5');
    if (!attempt.ok) {
      console.warn('gpt-5 attempt failed, falling back to gpt-4o:', attempt.reason,
                   attempt.reason === 'http' ? `${attempt.status} ${attempt.errText}` :
                   attempt.reason === 'empty' ? `finish=${attempt.finish_reason} usage=${JSON.stringify(attempt.usage)}` :
                   attempt.raw);
      modelUsed = 'gpt-4o';
      attempt = await tryModel('gpt-4o');
    }

    if (!attempt.ok) {
      console.error('Both models failed:', attempt);
      await refundCredits();
      if (attempt.reason === 'parse') {
        return res.status(502).json({ error: 'Could not identify this card. Try a clearer photo. Credits refunded.' });
      }
      return res.status(502).json({ error: 'Scanner temporarily unavailable. Credits refunded.' });
    }

    const cardInfo = attempt.cardInfo;

    // If the model returned empty card_name but populated candidates,
    // promote the top candidate — some models zero out the top-level
    // fields when they want to defer to the candidates array.
    if (!cardInfo.card_name && Array.isArray(cardInfo.candidates) && cardInfo.candidates[0]?.card_name) {
      const c0 = cardInfo.candidates[0];
      cardInfo.card_name   = c0.card_name   || cardInfo.card_name;
      cardInfo.card_number = c0.card_number || cardInfo.card_number;
      cardInfo.set_name    = c0.set_name    || cardInfo.set_name;
      cardInfo.set_code    = c0.set_code    || cardInfo.set_code;
      cardInfo.hp          = c0.hp          || cardInfo.hp;
      cardInfo.card_type   = c0.card_type   || cardInfo.card_type;
      cardInfo.is_japanese = c0.is_japanese === true || cardInfo.is_japanese === true;
      cardInfo.rarity      = c0.rarity      || cardInfo.rarity;
      cardInfo.sport       = c0.sport       || cardInfo.sport;
      cardInfo.year        = c0.year        || cardInfo.year;
    }

    if (!cardInfo.card_name) {
      await refundCredits();
      return res.status(422).json({ error: 'Could not identify the card. Try a clearer photo with better lighting. Credits refunded.' });
    }

    // Sanitize set_name if the model returned editorial commentary
    // instead of a real set ("Not an official set", "counterfeit", etc).
    // Clear it and let the grounding pass below fill in the real set.
    if (cardInfo.set_name) {
      const s = String(cardInfo.set_name).toLowerCase();
      const badPatterns = [
        'not an official', 'not official', 'counterfeit', 'custom card',
        'custom / fake', 'not a real', 'unknown set', 'no set', 'fake',
        'unofficial', 'proxy', 'reprint (unofficial)'
      ];
      if (badPatterns.some(p => s.includes(p))) {
        console.warn(`Model returned editorial set_name, clearing: "${cardInfo.set_name}"`);
        cardInfo.set_name = '';
      }
    }
    // Same sanitization for candidates — the picker UI shouldn't show garbage sets either.
    if (Array.isArray(cardInfo.candidates)) {
      const badPatterns = [
        'not an official', 'not official', 'counterfeit', 'custom card',
        'custom / fake', 'not a real', 'unknown set', 'no set', 'fake',
        'unofficial', 'proxy'
      ];
      cardInfo.candidates.forEach(c => {
        if (c && c.set_name) {
          const s = String(c.set_name).toLowerCase();
          if (badPatterns.some(p => s.includes(p))) c.set_name = '';
        }
      });
    }

    // ── 2026-08-16: pokemontcg.io grounding pass ──
    // Vision models don't know sets released after their training cutoff
    // and sometimes label real recent cards as "Not an official set /
    // custom / counterfeit". Fix: after the model returns a name + number,
    // look the card up in pokemontcg.io and OVERRIDE set_name/rarity from
    // the authoritative source. Only runs for pokemon cards (skipped for
    // sports/mtg/yugioh/lorcana/onepiece which use different data sources).
    if (
      !isGradeMode &&
      (cardInfo.card_type || 'pokemon') === 'pokemon' &&
      !cardInfo.is_japanese &&
      cardInfo.card_name &&
      cardInfo.card_number
    ) {
      try {
        const rawName = String(cardInfo.card_name).trim();
        const rawNum  = String(cardInfo.card_number).trim();
        const rawSet  = String(cardInfo.set_name || '').trim();
        const rawSetCode = String(cardInfo.set_code || '').trim().replace(/[^A-Za-z0-9]/g, '');
        const cleanNum  = rawNum.replace(/\/.*$/, '').trim(); // "100/086" → "100"
        const cleanName = rawName.replace(/["\\]/g, '').trim();

        // Build a series of pokemontcg.io queries from most specific to
        // least specific. We stop at the first that returns a match with
        // matching CARD NUMBER (server-side re-check to defeat fuzzy
        // wildcards) so we never override with a completely different card.
        const queries = [];
        // 0. Best signal: printed set code + number — unambiguous, no name needed.
        //    pokemontcg.io indexes set.ptcgoCode (SVI, MEW, etc.) and set.id.
        //    Try both fields since some sets use ptcgoCode, others use id.
        if (rawSetCode && cleanNum) {
          queries.push(`set.ptcgoCode:${rawSetCode} number:${cleanNum}`);
          queries.push(`set.id:${rawSetCode.toLowerCase()} number:${cleanNum}`);
        }
        if (cleanName && cleanNum) {
          // 1. Exact quoted name + number
          queries.push(`name:"${cleanName}" number:${cleanNum}`);
          // 2. Some cards store name without "ex"/"EX" or with ★ glyph.
          //    Strip common suffixes and retry.
          const nameNoSuffix = cleanName
            .replace(/\s+(ex|EX|VMAX|VSTAR|V|GX|Star|\u2605)$/i, '')
            .trim();
          if (nameNoSuffix && nameNoSuffix !== cleanName) {
            queries.push(`name:"${nameNoSuffix}" number:${cleanNum}`);
          }
          // 3. Last identifier word only, e.g. "Mega Greninja ex" → "Greninja".
          const words = cleanName.split(/\s+/).filter(w => w && !/^(mega|ex|EX|VMAX|VSTAR|V|GX|Star|\u2605)$/i.test(w));
          const identifier = words[words.length - 1] || words[0];
          if (identifier && identifier !== cleanName && !queries.some(q => q.includes(`"${identifier}"`))) {
            queries.push(`name:"${identifier}" number:${cleanNum}`);
          }
        }

        let best = null;
        for (const q of queries) {
          try {
            const ptcgUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=15&select=id,name,set,number,rarity,hp`;
            const ptcgRes = await fetch(ptcgUrl, { signal: AbortSignal.timeout(4500) });
            if (!ptcgRes.ok) continue;
            const j = await ptcgRes.json();
            const cards = (j.data || []).filter(c => {
              // HARD requirement: card number must match. pokemontcg.io
              // sometimes returns fuzzy matches; we need an exact number match.
              if (!c.number) return false;
              const cnNum = String(c.number).replace(/^0+/, '');
              const wantNum = cleanNum.replace(/^0+/, '');
              return cnNum === wantNum;
            });
            if (cards.length === 0) continue;

            // If we have >1 hit for the same card number, prefer the one
            // whose set name shares tokens with what the model reported
            // (helps with the Mega Evolution / new-set case where the
            // model may have gotten close but not exact).
            const modelSetLo = rawSet.toLowerCase();
            let ranked = cards;
            if (modelSetLo && cards.length > 1) {
              ranked = cards.map(c => {
                const setLo = (c.set?.name || '').toLowerCase();
                const setTokens = new Set(modelSetLo.split(/\W+/).filter(t => t.length >= 3));
                let hit = 0;
                for (const t of setTokens) if (setLo.includes(t)) hit++;
                return { c, score: hit };
              }).sort((a,b) => b.score - a.score).map(x => x.c);
            }
            // Also prefer newer sets when tied (releaseDate desc)
            best = ranked[0];
            if (best) break;
          } catch(_) { /* try next query */ }
        }

        if (best) {
          cardInfo.set_name = best.set?.name || cardInfo.set_name || '';
          if (!cardInfo.rarity && best.rarity) cardInfo.rarity = best.rarity;
          if (!cardInfo.hp && best.hp)         cardInfo.hp     = String(best.hp);
          if (best.name) cardInfo.card_name = best.name;
          if (best.number) cardInfo.card_number = String(best.number);
          cardInfo._grounded = true;
          cardInfo._grounded_id = best.id || null;
          cardInfo._grounded_set_code = best.set?.ptcgoCode || best.set?.id || '';
        }
      } catch(e) {
        // Grounding is best-effort. If pokemontcg.io times out or 500s,
        // fall through to the model's original set_name.
        console.warn('pokemontcg.io grounding failed:', e?.message || e);
      }
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
        is_japanese:    c.is_japanese === true,
        rarity:         c.rarity         || '',
        sport:          c.sport          || '',
        year:           c.year           || '',
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
        image_quality: cardInfo.image_quality || 'ok',
        glare_regions: Array.isArray(cardInfo.glare_regions) ? cardInfo.glare_regions : [],
        retake_hint:   cardInfo.retake_hint || '',
        // Also include the top guess for UI convenience.
        card_name:    cardInfo.card_name   || cleanCandidates[0].card_name   || '',
        card_number:  cardInfo.card_number || cleanCandidates[0].card_number || '',
        set_name:     cardInfo.set_name    || cleanCandidates[0].set_name    || '',
        set_code:     cardInfo.set_code    || cleanCandidates[0].set_code    || '',
        grounded:     cardInfo._grounded === true,
        grounded_id:  cardInfo._grounded_id || null,
        hp:           cardInfo.hp          || cleanCandidates[0].hp          || '',
        card_type:    cardInfo.card_type   || cleanCandidates[0].card_type   || 'pokemon',
        is_japanese:  cardInfo.is_japanese === true || cleanCandidates[0].is_japanese === true,
        jp_name:      cardInfo.jp_name     || cleanCandidates[0].jp_name     || '',
        rarity:       cardInfo.rarity      || cleanCandidates[0].rarity      || '',
        sport:        cardInfo.sport       || cleanCandidates[0].sport       || '',
        year:         cardInfo.year        || cleanCandidates[0].year        || '',
      });
    }

    // Real search — count it toward the public social-proof counter. Fire-and-forget.
    _incrSearchStats(kvUrl, kvToken);

    // Log the successful scan so the client can later request a refund via
    // POST /api/scan-refund { scan_id }. Server keeps the source-of-truth
    // record of what was scanned + which credit bucket was consumed.
    if (hasKV && consumedFrom) {
      try {
        const record = {
          uid:            key,
          consumed_from:  consumedFrom,
          consumed_amount: consumedAmount,
          card_name:      cardInfo.card_name   || '',
          card_number:    cardInfo.card_number || '',
          set_name:       cardInfo.set_name    || '',
          confidence:     idConfNorm || 'high',
          image_quality:  cardInfo.image_quality || 'ok',
          created_at:     Date.now(),
        };
        // 1-hour TTL: refunds must happen within the same session
        await setKVWithTTL(kvUrl, kvToken, `scan:${scanId}`, JSON.stringify(record), 3600);
      } catch(e) { /* non-fatal */ }
    }

    return res.status(200).json({
      success: true,
      mode:        'identify',
      scan_id:     scanId,
      confidence:  idConfNorm || 'high',
      image_quality: cardInfo.image_quality || 'ok',
      glare_regions: Array.isArray(cardInfo.glare_regions) ? cardInfo.glare_regions : [],
      retake_hint:   cardInfo.retake_hint || '',
      card_name:   cardInfo.card_name   || '',
      card_number: cardInfo.card_number || '',
      set_name:    cardInfo.set_name    || '',
      set_code:    cardInfo.set_code    || '',
      grounded:    cardInfo._grounded === true,
      grounded_id: cardInfo._grounded_id || null,
      hp:          cardInfo.hp          || '',
      card_type:   cardInfo.card_type   || 'pokemon',
      is_japanese: cardInfo.is_japanese === true,
      jp_name:     cardInfo.jp_name     || '',
      rarity:      cardInfo.rarity      || '',
      sport:       cardInfo.sport       || '',
      year:        cardInfo.year        || '',
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

// Upstash Redis SET with EX (TTL in seconds). Used for scan_id → record.
async function setKVWithTTL(kvUrl, kvToken, key, value, ttlSeconds) {
  try {
    await fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(value))}?EX=${ttlSeconds}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` }
    });
  } catch(e) {}
}

// Short opaque id — 24 chars, url-safe, enough entropy that guessing another
// user's scan_id is not economical (~10^36 combinations).
function _shortId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 24; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// ── Public search-counter increment (fire-and-forget). Powers the landing-page
// social-proof counter. Same key namespace as api/tcg-price.js so both endpoints
// feed into a single lifetime total.
function _todayKeyUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function _incrSearchStats(kvUrl, kvToken) {
  if (!kvUrl || !kvToken) return;
  fetch(`${kvUrl}/incr/${encodeURIComponent('stats:searches:total')}`, {
    method: 'POST', headers: { Authorization: `Bearer ${kvToken}` }
  }).catch(() => {});
  fetch(`${kvUrl}/incr/${encodeURIComponent('stats:searches:' + _todayKeyUTC())}`, {
    method: 'POST', headers: { Authorization: `Bearer ${kvToken}` }
  }).catch(() => {});
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
