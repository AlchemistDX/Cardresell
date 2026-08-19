import { verifyTokenFlexible } from './_verifyToken.js';
import { identifyWithXimilar } from './_ximilar.js';
import { gradeWithXimilar } from './_ximilar_grade.js';
import { getUserTier, TIER_BENEFITS, isPaidTier } from './_tier.js';
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

    // ── PHOTO QC GATE ──
    // Reject if the user uploaded the same photo multiple times (gaming the
    // photo-count requirement). We hash the first 4KB of each base64 payload
    // — near-identical uploads will collide, distinct photos won't.
    // Also reject if any photo is suspiciously small (< 4KB) which usually
    // means a thumbnail or corrupted upload.
    const photoSlots = [
      { name: 'front',        b64: imageBase64 },
      { name: 'back',         b64: backBase64 },
      { name: 'top edge',     b64: topEdgeBase64 },
      { name: 'bottom edge',  b64: bottomEdgeBase64 },
      { name: 'left edge',    b64: leftEdgeBase64 },
      { name: 'right edge',   b64: rightEdgeBase64 },
    ].filter(p => p.b64);

    const seen = new Map(); // signature → first slot name
    const dupePairs = [];
    for (const p of photoSlots) {
      // Use a middle-slice signature (not just prefix) to avoid header
      // collisions when the client re-encodes. 512 chars from the middle is
      // plenty to distinguish real photos while staying fast.
      const s = p.b64.length;
      const sig = s < 1024 ? p.b64 : p.b64.substring(Math.floor(s / 2) - 256, Math.floor(s / 2) + 256);
      if (seen.has(sig)) {
        dupePairs.push([seen.get(sig), p.name]);
      } else {
        seen.set(sig, p.name);
      }
    }
    if (dupePairs.length > 0) {
      return res.status(400).json({
        error: `Deep Grade needs distinct photos of each side/edge. Detected duplicate uploads: ${dupePairs.map(pair => `${pair[0]} = ${pair[1]}`).join(', ')}. Retake each photo showing that specific side of the card.`,
        code: 'DUPLICATE_PHOTOS',
        duplicates: dupePairs,
      });
    }

    // Reject any photo that's smaller than ~8KB — real phone photos of a card
    // are 100KB+. Anything smaller is a thumbnail, screenshot, or icon.
    const tinyPhotos = photoSlots.filter(p => p.b64.length < 8000);
    if (tinyPhotos.length > 0) {
      return res.status(400).json({
        error: `Some photos are too small to grade accurately: ${tinyPhotos.map(p => p.name).join(', ')}. Please upload full-resolution phone photos, not thumbnails.`,
        code: 'PHOTOS_TOO_SMALL',
        tooSmall: tinyPhotos.map(p => p.name),
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
    const tier       = await getUserTier(process.env.STRIPE_SECRET_KEY, kvUrl, kvToken, googleSub, userEmail);
    const isPro      = isPaidTier(tier); // any paid tier gets monthly grants
    const benefits   = TIER_BENEFITS[tier] || TIER_BENEFITS.free;
    const gradeGrant = benefits.gradeGrant; // 0 / 10 / 25 / 60
    const idGrant    = benefits.idGrant;    // 0 / 20 / 50 / 150

    if (isIdentifyMode) {
      // ID scans: paid tiers draw from monthly free bucket first (grant), then
      // fall back to paid ID credits. Non-paid users go straight to paid.
      const stamp      = getMonthStamp();
      const idFreeUsed = isPro ? await getKVInt(kvUrl, kvToken, `scans:${key}:id_free_used_${stamp}`) : idGrant;
      const idFreeLeft = isPro ? Math.max(0, idGrant - idFreeUsed) : 0;
      const idPaid     = await getKVInt(kvUrl, kvToken, `scans:${key}:id_paid_left`);

      if (idFreeLeft <= 0 && idPaid <= 0) {
        return res.status(402).json({ error: 'No ID scan credits remaining.', needsPayment: true, mode: 'identify' });
      }
      if (idFreeLeft > 0) {
        await incrKV(kvUrl, kvToken, `scans:${key}:id_free_used_${stamp}`);
        consumedFrom = 'id_free';
        consumedAmount = 1;
      } else {
        await setKV(kvUrl, kvToken, `scans:${key}:id_paid_left`, idPaid - 1);
        consumedFrom = 'id_paid_left';
        consumedAmount = 1;
      }
    } else {
      // Graded scans: draw from tier's monthly grant bucket first, then paid_left.
      // Deep Grade costs 2 credits — must come from the SAME bucket (no mixing).
      const paid     = await getKVInt(kvUrl, kvToken, `scans:${key}:paid_left`);
      const stamp    = getMonthStamp();
      const freeUsed = isPro ? await getKVInt(kvUrl, kvToken, `scans:${key}:free_used_${stamp}`) : gradeGrant;
      const freeLeft = isPro ? Math.max(0, gradeGrant - freeUsed) : 0;

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
      if (consumedFrom === 'id_free') {
        const stamp = getMonthStamp();
        const cur   = await getKVInt(kvUrl, kvToken, `scans:${key}:id_free_used_${stamp}`);
        await setKV(kvUrl, kvToken, `scans:${key}:id_free_used_${stamp}`, Math.max(0, cur - consumedAmount));
      } else if (consumedFrom === 'id_paid_left') {
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
      ? `You are a strict, professional trading card grader trained to PSA's OFFICIAL published standards. You are analyzing ${imageDescription}.${deepGradeInstructions}

═══ WHY THIS MATTERS ═══
The user is a reseller or collector deciding whether to spend $25–$100 in
grading fees + shipping + weeks of turnaround on this specific card,
based on YOUR estimate. If you overgrade, they lose real money — grading
fees on a card that comes back a 7 instead of a 9 is a $50–$400 hit per
card. If you undergrade, they miss a real PSA 10 payday. Either error
costs them money. They do not want to be flattered. They want the truth.

Brutal honesty > polite hedging. If you cannot see the corners because
of holder glare, say so and CAP the grade — do NOT hand out a Gem Mint
verdict on a card whose corners you cannot inspect. If the photos are
blurry, sleeved, glared, or otherwise compromised, your confidence MUST
be "low" and your psa_estimate MUST reflect the WORST-case reasonable
interpretation of what you can see, not the best-case.

BEFORE grading, understand these realities:
- PSA 10 (Gem Mint) is rare (~5–10% of modern submissions) but NOT impossible. Do not artificially demote a card that meets the published thresholds AND you can fully inspect.
- Be STRICT but ACCURATE. Under-grading a card that meets PSA 10 criteria under clear photos is just as wrong as over-grading a damaged one.
- Use the OFFICIAL PSA centering thresholds below. Do NOT invent stricter thresholds. 55/45 front is the PSA 10 threshold — not a defect.
- Modern cards are graded MORE strictly than vintage (pre-1980). Vintage tolerates print defects, factory miscuts, and wax staining that would sink a modern card.
- If the image quality is poor or you cannot clearly see the card, lower confidence AND lower the grade — do not just add a note.

═══ THROUGH-PLASTIC PENALTY (mandatory) ═══
If the card is in a sleeve, toploader, top-loader, one-touch, magnetic
holder, screwdown, semi-rigid, penny sleeve, or graded slab (CGC/PSA/
BGS/SGC/TAG) — in other words, if you can see plastic between the
camera and the card:
  • confidence MUST be "low" (never "medium", never "high")
  • "holder_glare" OR "reflective_sleeve" MUST appear in confidence_drivers
  • psa_estimate is CAPPED at 8 unless the card is in a fresh raw pack pull
    quality state clearly visible through the plastic AND you can rule out
    corner whitening / edge chipping / surface scratches
  • If it's a SLAB (rigid case with printed label): psa_estimate reflects
    what YOU can see raw — do NOT trust the printed grade on the label;
    it's not what the user is asking about
  • limiting_factor MUST start with "Card is scanned through [sleeve/
    holder/slab] — " and explain what you cannot verify
  • grade_label CANNOT be "Gem Mint" through plastic — use "Near Mint" or
    lower and let the user re-scan raw for a real estimate
  • worth_grading MUST be false when scanned through plastic (the user
    should raw-scan first before spending grading fees)

═══ HONESTY RULES (mandatory) ═══
• If confidence is "low", psa_distribution MUST spread across at least 3
  grades with no bucket > 55%. High-confidence-looking distributions
  (80/15/5) on low-confidence scans are dishonest.
• If confidence_drivers contains ANY entry other than ["none"], you MAY
  NOT return psa_estimate=10. A card you cannot fully inspect is not a
  Gem Mint candidate.
• If confidence_drivers is non-empty, eye_appeal cannot be "Strong" —
  eye appeal requires being able to see the card cleanly.
• If you notice ANY visible defect (whitening, chipping, scratches,
  print lines, off-centering worse than 55/45), it MUST be named
  specifically in the relevant *_desc field AND counted in flaw_count.
  Do not soften language ("very slight" is fine; "basically none" is not).
• worth_grading = true ONLY when you would personally bet $30 that this
  card comes back a PSA 9 or 10 from a real grader. If you have ANY
  meaningful doubt, worth_grading = false.
• Never write "Card meets all PSA 10 criteria" unless you also emit
  psa_estimate=10. Those two must always agree.

═══ PSA 10 CALIBRATION (do not swing to the other extreme) ═══
Being brutally honest ≠ defaulting to 8. PSA 10 is rare but real —
approximately 5–10% of modern submissions grade a 10, higher on
popular pack-fresh chase cards. A raw card that passes ALL of the
following SHOULD be a PSA 10 candidate:
  • 55/45 or better on BOTH axes
  • four perfectly sharp corners under close inspection
  • smooth edges with no chipping / whitening / roughness
  • no visible surface scratches, print lines, or gloss breaks
  • confidence_drivers=["none"]
When those conditions are met, the correct output is psa_estimate=10
with a probability distribution like {10: 55–75, 9: 20–35, 8: 5–10}.
Refusing to name a real PSA 10 candidate because "PSA 10 is rare" is
JUST AS DISHONEST as overgrading a slabbed card — you cost the user
a real payday.

USE THE FULL RANGE of psa_distribution to express certainty:
  • Textbook clean pack-fresh raw with clear photos: {10: 65, 9: 30, 8: 5}
  • Looks 10 but one axis is 56/44: {10: 40, 9: 50, 8: 10}
  • One faint corner flaw under magnification: {9: 65, 10: 15, 8: 20}
  • Multiple minor flaws: {8: 55, 9: 25, 7: 20}
  • Through plastic: {8: 40, 7: 35, 9: 15, 6: 10} — spread is honest
The percentages ARE the answer — they let the user weigh a $25 grading
fee against a 65% shot at PSA 10. Don't round to (100, 0, 0) OR to
(33, 33, 34). Pick numbers that reflect what the photos actually show.

═══ OFFICIAL PSA CENTERING THRESHOLDS (memorize these) ═══
FRONT centering (worst axis rules — check BOTH L/R and T/B):
  • PSA 10: 55/45 or better on BOTH axes
  • PSA 9:  60/40 or better on BOTH axes
  • PSA 8:  65/35 or better on BOTH axes
  • PSA 7:  70/30 or better
  • PSA 6:  75/25 or better
BACK centering is SIGNIFICANTLY more lenient:
  • PSA 10 back: 75/25 or better
  • PSA 9 back:  90/10 or better
  • PSA 8 back:  90/10 or better
Critical: 55/45 front IS the PSA 10 threshold. Never call 55/45 "moderate off-center" or use it to cap the grade below 10.

═══ OFFICIAL PSA CORNER STANDARDS ═══
  • PSA 10: "Four perfectly sharp corners" (no whitening, no softening, no fraying under magnification)
  • PSA 9:  ONE minor flaw total across corners/edges/surface/centering (most commonly very slight corner wear on 1 corner)
  • PSA 8:  "Slightest fraying at one or two corners" OR moderate defects in one other pillar
  • PSA 7:  Fuzzy corners, one or more corners with visible wear to the naked eye
  • PSA 6:  Obvious wear at multiple corners

═══ OFFICIAL PSA EDGE STANDARDS ═══
  • PSA 10: Smooth edges, no chipping, no roughness even under loupe
  • PSA 9:  Very slight edge wear on one edge at most
  • PSA 8:  Minor rough edges or one small chip
  • PSA 7:  Visible chipping or roughness on multiple edges

═══ OFFICIAL PSA SURFACE STANDARDS ═══
  • PSA 10: No scratches, no print lines that impair eye appeal, no gloss breaks, no stains. A "slight printing imperfection" is allowed on a 10 ONLY if it does not impair overall appeal.
  • PSA 9:  One tiny print line or a barely-visible scratch
  • PSA 8:  Light surface scratches or a visible print line
  • PSA 7:  Multiple scratches or a noticeable print defect

═══ ONE-FLAW RULE FOR PSA 9 ═══
PSA 9 allows exactly ONE minor flaw across all four pillars. Two or more minor flaws = PSA 8, not PSA 9.
Example: very slight whitening on 1 corner AND 60/40 centering = PSA 8 (two flaws), not PSA 9.

═══ HOW TO GRADE (in this order) ═══
1. Measure centering on BOTH axes front. Determine the CENTERING CEILING using thresholds above (worst axis rules). If a back photo is present, ALSO measure back centering and populate centering_back — do not leave it empty.
2. Inspect all 4 corners. Note any whitening "visible to naked eye" vs "only under magnification."
3. Inspect all 4 edges (use dedicated edge close-ups if provided).
4. Inspect front surface for scratches, print lines, gloss breaks, stains.
5. Apply the one-flaw rule: count minor flaws across all 4 pillars. Overall grade is the LOWER of (centering ceiling) and (grade allowed by flaw count).
6. Eye appeal judgment: for borderline cards (e.g. 9 vs 10), consider overall eye appeal. Note if defects are in focal areas (center of card, subject's face).

═══ WRITING QUALITY RULES ═══
• limiting_factor MUST name a specific pillar (centering / corners / edges / surface / eye appeal) AND a specific defect. Vague statements like "minor issues" or "multiple factors" are forbidden.
• limiting_factor MUST reconcile with psa_estimate: if psa_estimate is at the centering ceiling, say "Card meets all PSA {N} criteria and no defects prevent a higher grade."; otherwise name the exact defect blocking the next grade up.
• If a photo IS provided for a side (front, back, or an edge), do NOT write "cannot be assessed from provided photos." Grade what you can see. Only use that language for pillars where NO photo shows that side.
• Do NOT hedge in corners_desc / edges_desc / surface_desc when clear photos are available — commit to a description.
• psa_distribution's TOP bucket MUST equal psa_estimate. If you're 90% sure it's a PSA 9, the top bucket is grade=9 with pct=90.
• flaw_count must match the actual defects described. Zero flaws → PSA 10 candidate. One flaw → PSA 9 candidate. Two flaws → PSA 8 candidate.
• Never mention "AI", "model", "vision system", or "algorithm" in any field. Write like a professional human grader.

Evaluate and return:
1. card_name: The card name
2. centering_lr: Left/right ratio as "NN/NN" ONLY, e.g. "55/45". No units, no extra text.
3. centering_tb: Top/bottom ratio as "NN/NN" ONLY, e.g. "52/48". No units, no extra text.
4. centering_back: OPTIONAL. If the back is visible, worst-axis back ratio "NN/NN". Otherwise empty string.
5. centering_ceiling: Integer 1-10. The MAX PSA grade allowed by front centering alone using the official thresholds above.
6. corners_desc: Plain-language PSA-native description. Use phrases like: "four perfectly sharp corners", "very slight whitening on 1 corner (visible only under magnification)", "slight fraying at 2 corners visible to naked eye", "obvious wear at 3+ corners". Never use fake sub-scores.
7. edges_desc: PSA-native description of all 4 edges. Note if edges cannot be fully assessed from provided photos.
8. surface_desc: PSA-native description of the front surface. Explicitly call out print lines, scratches, gloss breaks, holder glare.
9. flaw_count: Integer 0-4. Count of PILLARS with any visible flaw (centering worse than 55/45 counts as 1, any visible corner wear counts as 1, etc.).
10. psa_estimate: Integer 1-10. Single most-likely PSA grade. This is the LOWER of centering_ceiling and (grade allowed by flaw_count using the one-flaw rule).
11. psa_distribution: Object with probability weights for the top 3 grades, summing to ~100. Example: {"10": 15, "9": 60, "8": 25}. Base this on how borderline the defects are and photo confidence. If highly confident in a single grade, weight it heavily (e.g. 90/8/2).
12. limiting_factor: 1-sentence explanation of why this grade and not the next one up. Example: "Centering qualifies for PSA 10; very slight whitening on 1 top corner is the primary reason this projects as a 9 rather than a 10."
13. grade_label: ("Gem Mint", "Mint", "Near Mint-Mint", "Near Mint", "Excellent-Mint", "Excellent", "Very Good", "Good", "Poor")
14. eye_appeal: "Strong" | "Average" | "Weak" — overall visual impression. Note in eye_appeal_notes if defects are in focal areas (center of card art, subject's face) which hurt eye appeal more than defects in blank border areas.
15. eye_appeal_notes: 1 sentence on eye appeal.
16. worth_grading: true only if psa_estimate >= 9 AND the card has meaningful value raw. Grading fees + shipping typically require a PSA 9 outcome to break even on modern cards.
17. confidence: "high" | "medium" | "low" — how confident you are given photo quality, angles, holder glare, and edge visibility.
18. confidence_drivers: Array of strings explaining what limits your confidence. Options: "holder_glare", "limited_edge_visibility", "blurry_photo", "single_photo_only", "back_not_visible", "low_resolution", "reflective_sleeve", "finger_covering_card", "none". Return ["none"] if photos are all clear and you have HIGH confidence — do NOT invent drivers just to seem cautious.
19. is_slabbed: true if the card is inside a graded slab (CGC, PSA, BGS, SGC, TAG). Signals: rigid clear plastic outer shell with printed label header, visible grade text like "GEM MINT 10", serial/cert number, or barcode. If slabbed, add "holder_glare" to confidence_drivers and note the estimate will be skewed. Recommend a raw re-scan in limiting_factor.
20. slab_grader: If is_slabbed=true, the company ("PSA", "CGC", "BGS", "SGC", "TAG", or "Other"). Empty string otherwise.
21. slab_grade: If is_slabbed=true, the printed grade (e.g. "10", "9.5", "8"). Empty string otherwise.
22. is_vintage: true if the card is pre-1980 (older Topps sports, WOTC-era Pokémon Base Set through Neo). Apply lenient vintage standards if true.

DO NOT emit numeric sub-grades like 8.5/10. PSA does not publish numeric sub-grades. Report PSA-native language only.

Respond ONLY with valid JSON:
{"card_name":"...","centering_lr":"55/45","centering_tb":"52/48","centering_back":"","centering_ceiling":10,"corners_desc":"...","edges_desc":"...","surface_desc":"...","flaw_count":1,"psa_estimate":9,"psa_distribution":{"10":15,"9":60,"8":25},"limiting_factor":"...","grade_label":"Mint","eye_appeal":"Strong","eye_appeal_notes":"...","worth_grading":true,"confidence":"medium","confidence_drivers":["limited_edge_visibility"],"is_slabbed":false,"slab_grader":"","slab_grade":"","is_vintage":false}`
      : `You are a trading card expert. Look at this card image and identify it.

BE HONEST about uncertainty. If the card art, number, or set name isn't perfectly clear (blurry photo, glare, similar-looking cards from different sets, unclear card number), you MUST return your top 2–3 candidate matches with a confidence score for each, INSTEAD of guessing one wrong answer. Only return a single answer when you are highly confident it's correct.

═══ ANTI-HALLUCINATION RULES ═══ (violations = wrong answer, worse than empty)
• NEVER invent a card name. If you cannot read the printed name clearly, return card_name="" and image_quality="glare_blocked"/"blurry"/"cropped". A blank field is FAR better than a plausible-sounding wrong guess.
• NEVER invent a set code. Set codes have strict formats:
    – Pokémon: 2–4 uppercase letters/digits like SVI, MEW, PGO, 151, OBF, SV1, SV3PT5.
    – Yu-Gi-Oh: 3–4 letters + hyphen + region + 3 digits like PHRA-EN012, CORE-EN080, LOB-EN001, MP24-EN123.
    – MTG: 3-letter code like MH3, LCI, WOE, MOM.
    – One Piece: OP01–OP12, ST01–ST25, EB01, PRB01.
    – Lorcana: 3-letter code like TFC, ROF, INK, URR.
  If you cannot read a set code matching one of these formats, return set_code="". Do NOT invent 9-digit numeric IDs, do NOT make up codes like "COG-EN082" that don't exist.
• For Yu-Gi-Oh cards specifically: card names are printed in a clean font at the top. If you cannot read the name letter-for-letter, return card_name="" — do NOT combine words to invent names like "Skyfire of the Sacred Beast", "Blitzclique - Breakaway", "Distrust Paranoia", or "Elfnotes: Quatrain of Succession". Made-up names are the #1 failure mode; refusing to guess is the correct behavior.
• If you're returning candidates[], EACH candidate name must also be a real card you're actually confident exists. Do not fill the array with made-up alternatives.
• confidence="high" requires: readable name + readable card number + a set code matching the formats above. If any of those three is unreadable, confidence must be "medium" or "low".
• When confidence is "low" AND you cannot read the name, prefer empty card_name over any guess.

GLARE + SLEEVE HANDLING: Reflective toploaders and holographic sleeves often create glare that blocks key details (card number, set symbol, or HP). If glare is blocking a critical detail:
  - Set confidence to "low" and set image_quality to "glare_blocked"
  - Populate glare_regions with which detail is blocked: "card_number", "set_symbol", "card_name", or "art"
  - Still return your best-guess candidates from what IS visible, but DO NOT pretend to read details you can't see
  - Suggest a retake angle in retake_hint (e.g. "Tilt the card 15° away from the light source and remove any reflective sleeve.")

Other low-quality photo signals: blur, cropped edges, dark shadow, upside-down. Set image_quality to "blurry", "cropped", "dark", or "rotated" accordingly.

Extract for the best match:
1. card_name: The Pokémon or character or player name IN ENGLISH (e.g. "Mewtwo VSTAR", "Charizard ex", "Ampharos", "LeBron James"). Populate ONLY when you can clearly read the printed name letter-for-letter. If the name area is blurry, glared, cropped, cut off, or otherwise unreadable, return "" — do NOT guess plausible-sounding combinations of words. If the card is Japanese and only shows katakana/hiragana (e.g. "ラフレシア") AND you can clearly read the katakana, TRANSLATE to the English name ("Vileplume") and put that in card_name. Never return raw Japanese text in card_name.
2. card_number: The card number (e.g. "079/078", "025/165", or for sports the printed # like "175" or "RA-LJ")
3. set_name: The exact printed set name (e.g. "Pokémon GO", "Crown Zenith", "Topps Chrome", "Panini Prizm"). CRITICAL: You MUST return either a real set name OR an empty string "". NEVER return editorial commentary like "Not an official set", "counterfeit", "custom card", "unknown", or "fake" — our database will look up the set from the card number if you don't know it. If you can't read the set symbol clearly, return "".
3b. set_code: The SET CODE printed on the card. Format depends on TCG:
    – Pokémon: 2–4 uppercase chars in BOTTOM-LEFT/RIGHT near the card number (e.g. "SVI", "MEW", "PGO", "151", "SV1", "OBF").
    – Yu-Gi-Oh: Left/right of the artwork or bottom-left, format "XXX(X)-EN###" or region equivalent ("PHRA-EN012", "CORE-EN080").
    – MTG: 3-letter code in bottom-left near the set symbol.
    – One Piece: "OP##", "ST##" format near collector number.
    – Lorcana: 3-letter code near collector number.
  MUST match one of these formats. If unreadable OR you cannot match a real format, return "". NEVER invent 9-digit numeric IDs or make up codes.
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
        // Identify mode uses 'medium' reasoning — the tighter anti-hallucination
        // rules need real reasoning budget to decide "can I actually read this?"
        // vs. "is this a plausible guess?". Grade mode stays at 'low' because the
        // grading prompt is more mechanical (measure ratios, apply thresholds).
        body.reasoning_effort = isGradeMode ? 'low' : 'medium';
        // GPT-5 reasoning tokens count toward max_completion_tokens.
        // Medium reasoning can eat 2000-4000 tokens before visible output.
        // Give a generous budget so real output isn't truncated / empty.
        body.max_completion_tokens = isDeepGrade ? 5000 : (isGradeMode ? 4000 : 5000);
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

    // ── SET-CODE FORMAT VALIDATION ──
    // Vision models sometimes invent set codes when they can't read the real
    // one (e.g. 9-digit numeric IDs like "101305049", or made-up codes like
    // "COG-EN082" for Yu-Gi-Oh where COG isn't a real set). Validate against
    // known formats per TCG and clear invalid ones. Better to have no set_code
    // than a wrong one (which would poison the grounding lookup).
    const validateSetCode = (code, cardType) => {
      if (!code || typeof code !== 'string') return '';
      const c = code.trim().toUpperCase();
      if (!c) return '';
      // Reject pure numeric IDs longer than 3 chars — e.g. "101305049" invented.
      // Note: Pokémon "151" and "165" ARE real set codes so we allow 3-char digits.
      if (/^\d+$/.test(c) && c.length > 3) return '';
      // Reject anything too long to be a real set code.
      if (c.length > 12) return '';
      const t = (cardType || 'pokemon').toLowerCase();
      if (t === 'yugioh') {
        // Real YGO codes: 3-5 letters + hyphen + region (EN/DE/FR/IT/PT/SP/JP/KR/TC/AE) + 3 digits
        // OR promo codes like MP24-EN123, RA02-EN050, YGLD-ENA01.
        return /^[A-Z0-9]{2,6}-(EN|DE|FR|IT|PT|SP|JP|KR|TC|AE)[A-Z0-9]{2,4}$/.test(c) ? c : '';
      }
      if (t === 'pokemon') {
        // 2–5 uppercase alphanumeric, no hyphens. SVI, MEW, PGO, 151, SV3PT5.
        return /^[A-Z0-9]{2,6}$/.test(c) ? c : '';
      }
      if (t === 'mtg') {
        return /^[A-Z0-9]{3}$/.test(c) ? c : '';
      }
      if (t === 'onepiece') {
        return /^(OP|ST|EB|PRB)\d{2}$/.test(c) ? c : '';
      }
      if (t === 'lorcana') {
        return /^[A-Z]{3}$/.test(c) ? c : '';
      }
      // Sports and other — loose validation, just no pure numerics.
      return /^[A-Z0-9-]{2,10}$/.test(c) ? c : '';
    };
    const beforeCode = cardInfo.set_code;
    cardInfo.set_code = validateSetCode(cardInfo.set_code, cardInfo.card_type);
    if (beforeCode && !cardInfo.set_code) {
      console.warn(`[scan] rejected invalid set_code "${beforeCode}" for ${cardInfo.card_type}`);
    }
    if (Array.isArray(cardInfo.candidates)) {
      cardInfo.candidates.forEach(c => {
        if (c) c.set_code = validateSetCode(c.set_code, c.card_type || cardInfo.card_type);
      });
    }

    // 2026-08-18: Validate card_number too — the "#101305049" hallucination
    // from the YGO Baybarron report was the model inventing a 9-digit ID and
    // stuffing it in card_number (not set_code, which is what validateSetCode
    // caught). Real card_numbers per TCG:
    //   pokemon: 1-4 digits, sometimes with "/total" or "TG01", "SV31"
    //   yugioh:  <SET>-<REG><NUM> like PHRA-EN012, OR plain 8-digit passcode
    //            (real YGO card passcodes are exactly 8 digits like 12571621)
    //   mtg:     1-4 digits
    //   lorcana: N/total or plain number
    //   onepiece: <SET>-###
    const validateCardNumber = (num, cardType) => {
      if (!num || typeof num !== 'string') return '';
      const n = num.trim().toUpperCase();
      if (!n) return '';
      // Universal: reject 5-12 digit numbers that aren't YGO passcodes (real
      // YGO passcodes are exactly 8 digits; anything else all-numeric with 5-12
      // chars is likely hallucinated).
      if (/^\d+$/.test(n)) {
        const t = (cardType || '').toLowerCase();
        if (t === 'yugioh') {
          // Accept 8-digit YGO passcodes only. Anything else (5, 6, 7, 9+ digits) is fake.
          if (n.length === 8) return num;
          if (n.length <= 4) return num; // short position numbers OK
          return '';
        }
        // Non-YGO: purely numeric > 4 digits is suspicious. Real card_numbers
        // are 1-4 digit set positions, or contain a slash / letters.
        if (n.length > 4) return '';
      }
      // Reject anything absurdly long.
      if (n.length > 20) return '';
      return num;
    };
    const beforeNum = cardInfo.card_number;
    cardInfo.card_number = validateCardNumber(cardInfo.card_number, cardInfo.card_type);
    if (beforeNum && !cardInfo.card_number) {
      console.warn(`[scan] rejected invalid card_number "${beforeNum}" for ${cardInfo.card_type}`);
      // If card_number was garbage, the whole ID is suspect. For YGO where
      // grounding depends on set_code, also blank the set_code so the client
      // shows an unmatched scan panel instead of a confident wrong card.
      if ((cardInfo.card_type || '').toLowerCase() === 'yugioh') {
        cardInfo.set_code = '';
      }
    }
    if (Array.isArray(cardInfo.candidates)) {
      cardInfo.candidates.forEach(c => {
        if (c) c.card_number = validateCardNumber(c.card_number, c.card_type || cardInfo.card_type);
      });
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

    // ── Yu-Gi-Oh grounding pass (YGOProDeck) ──
    // YGOProDeck is a free unauth'd API with the full YGO card database.
    // If we have a set_code that survived validation (format XXX-EN###),
    // look up the exact card and OVERRIDE card_name from ground truth.
    // This kills "Skyfire of the Sacred Beast" / "Distrust Paranoia" style
    // hallucinations where the model invents plausible names.
    //
    // Endpoint: /api/v7/cardsetsinfo.php?setcode=PHRA-EN012
    // Returns: {id, name, set_name, set_code, set_rarity, set_price}
    if (
      !isGradeMode &&
      cardInfo.card_type === 'yugioh' &&
      cardInfo.set_code &&
      /^[A-Z0-9]{2,6}-(EN|DE|FR|IT|PT|SP|JP|KR|TC|AE)[A-Z0-9]{2,4}$/.test(cardInfo.set_code)
    ) {
      try {
        const ac = new AbortController();
        const tt = setTimeout(() => ac.abort(), 4000);
        const r = await fetch(
          `https://db.ygoprodeck.com/api/v7/cardsetsinfo.php?setcode=${encodeURIComponent(cardInfo.set_code)}`,
          { signal: ac.signal }
        ).catch(() => null);
        clearTimeout(tt);
        if (r && r.ok) {
          const j = await r.json().catch(() => null);
          if (j && j.name && j.set_name) {
            const before = { name: cardInfo.card_name, set: cardInfo.set_name };
            // OVERRIDE with ground truth
            cardInfo.card_name = j.name;
            cardInfo.set_name = j.set_name;
            cardInfo.rarity = j.set_rarity || cardInfo.rarity;
            cardInfo.grounded = true;
            cardInfo.grounded_id = String(j.id);
            console.log(`[scan] YGO grounded: "${before.name}" → "${cardInfo.card_name}" (${cardInfo.set_code})`);
          } else {
            console.log(`[scan] YGO grounding: no match for "${cardInfo.set_code}"`);
          }
        }
      } catch(e) {
        console.warn('YGO grounding failed:', e?.message || e);
      }
    }

    if (isGradeMode) {
      // Coerce sub-grades to numbers (GPT sometimes returns strings) and clamp 1-10.
      const clampSub = (v) => {
        const n = typeof v === 'number' ? v : parseFloat(v);
        if (!isFinite(n)) return null;
        return Math.max(1, Math.min(10, n));
      };

      // ── OFFICIAL PSA CENTERING CEILING (server-side safety net) ────────
      // The model is now prompted with the correct thresholds, but we also
      // enforce them server-side in case the model makes an arithmetic
      // mistake or ignores the prompt. "NN/NN" → worse pct of the pair.
      const parseRatio = (s) => {
        if (!s || typeof s !== 'string') return null;
        const m = s.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
        if (!m) return null;
        const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (!isFinite(a) || !isFinite(b) || a + b === 0) return null;
        return Math.max(a, b) / (a + b); // 0.5..1.0 — higher means MORE off-center
      };
      const centeringCeilingFromRatio = (worstRatio) => {
        if (worstRatio == null) return null;
        // OFFICIAL PSA front-centering thresholds:
        //   PSA 10: 55/45 or better → worstRatio <= 0.55
        //   PSA 9:  60/40 or better → worstRatio <= 0.60
        //   PSA 8:  65/35 or better → worstRatio <= 0.65
        //   PSA 7:  70/30 or better → worstRatio <= 0.70
        //   PSA 6:  75/25 or better → worstRatio <= 0.75
        //   PSA 5:  80/20 or better → worstRatio <= 0.80
        // Small tolerance for measurement noise.
        const t = 0.005;
        if (worstRatio <= 0.55 + t) return 10;
        if (worstRatio <= 0.60 + t) return 9;
        if (worstRatio <= 0.65 + t) return 8;
        if (worstRatio <= 0.70 + t) return 7;
        if (worstRatio <= 0.75 + t) return 6;
        if (worstRatio <= 0.80 + t) return 5;
        return 4;
      };

      // Read the new response fields (with legacy fallback so a mid-deploy
      // window doesn't break output).
      const centeringLR = cardInfo.centering_lr || (typeof cardInfo.centering === 'string' ? (cardInfo.centering.match(/(\d{1,2}\/\d{1,2})\s*L\/R/i)?.[1] || '') : '');
      const centeringTB = cardInfo.centering_tb || (typeof cardInfo.centering === 'string' ? (cardInfo.centering.match(/(\d{1,2}\/\d{1,2})\s*T\/B/i)?.[1] || '') : '');
      const centeringBack = cardInfo.centering_back || '';

      const rLR = parseRatio(centeringLR);
      const rTB = parseRatio(centeringTB);
      const worstFront = (rLR != null && rTB != null) ? Math.max(rLR, rTB) : (rLR ?? rTB);
      const computedCeiling = centeringCeilingFromRatio(worstFront);
      const modelCeiling = clampSub(cardInfo.centering_ceiling);
      // Trust the server computation over the model's self-reported ceiling.
      const centeringCeiling = computedCeiling ?? (modelCeiling != null ? Math.round(modelCeiling) : null);

      // Enforce the centering ceiling on the reported PSA estimate.
      let psaEstimate = clampSub(cardInfo.psa_estimate);
      if (psaEstimate != null) psaEstimate = Math.round(psaEstimate);
      if (centeringCeiling != null && psaEstimate != null && psaEstimate > centeringCeiling) {
        psaEstimate = centeringCeiling;
      }

      // Legacy subgrades object — keep populated for older frontend paths.
      // Centering sub-score derived from the ceiling (10 → 10, 9 → 9, etc.).
      const sg = cardInfo.subgrades || {};
      let subgrades = {
        centering: centeringCeiling ?? clampSub(sg.centering),
        corners:   clampSub(sg.corners),
        edges:     clampSub(sg.edges),
        surface:   clampSub(sg.surface),
      };

      // ── CV-grade overlay: replace GPT eyeball estimates with Ximilar's ──
      // pixel-measured pillar scores. Ximilar's grader measures centering
      // to the pixel, evaluates each corner/edge polygon independently, and
      // detects surface defects with a purpose-built model. GPT-5's prose
      // (grade_notes, centering description) is kept for the human-readable
      // summary; the numeric sub-grades come from Ximilar.
      //
      // ── Slab detection ──
      // If the card appears to be in a graded slab (CGC/PSA/BGS holder),
      // the CV grader is trained on RAW cards and will give bad results
      // (plastic glare, holder corners, label crop). We combine three signals:
      //   1) GPT-5's own slab flag (from the grading prompt)
      //   2) cardInfo._ximilar_graded (present if identify was run)
      //   3) Ximilar grader's slab hint on the card object (populated below)
      // If any signal fires, we STILL return the grade (user paid for it) but
      // attach slab_warning so the UI can show a friendly "sneaky, sneaky".
      let looksSlabbed =
        !!(cardInfo?._ximilar_graded) ||
        !!(cardInfo?.is_slabbed === true) ||
        !!(cardInfo?.slabbed    === true);

      // ── COST GATE ──
      // Ximilar /card-grader/v2/grade = 100 credits ≈ $0.109 per call on the
      // 100k plan. At $0.10/credit user pricing:
      //   Quick Grade (1 credit) → -9% margin (LOSES money)
      //   Deep Grade  (2 credits) → +46% margin
      // So we only enable Ximilar grader for Deep Grade. Quick Grade keeps
      // the GPT-5-only path (~$0.01 cost, 89% margin).
      //
      // The ENABLE_XIMILAR_GRADER env var is the master feature flag:
      //   'off' | unset → GPT-5 only for all grade modes (safe default)
      //   'deep_only'   → Ximilar CV pillars on Deep Grade only
      //   'all'         → Ximilar CV pillars on Quick + Deep (WARNING: unprofitable Quick Grade)
      const graderFlag = (process.env.ENABLE_XIMILAR_GRADER || 'off').toLowerCase();
      const useXimilarGrader =
        (graderFlag === 'deep_only' && isDeepGrade) ||
        (graderFlag === 'all');

      let cvSource = 'gpt';
      let cvCentering = null;
      let cvGrader   = null;
      if (useXimilarGrader && ximilarToken && imageBase64) {
        try {
          const t0 = Date.now();
          const imgs = backBase64 ? [imageBase64, backBase64] : [imageBase64];
          const xg = await gradeWithXimilar(imgs, mimeType || 'image/jpeg', ximilarToken);
          console.log('[scan] ximilar-grader took', Date.now() - t0, 'ms ok=', xg.ok, 'reason=', xg.reason);
          // Ximilar's grader returns holder detection on the card object.
          // Some responses expose it as record.card[0].holder or record.holder.
          if (xg.raw?.records?.[0]) {
            const rec0 = xg.raw.records[0];
            const holder =
              rec0.card?.[0]?.holder ||
              rec0.holder ||
              rec0.card?.[0]?.slab   ||
              null;
            if (holder && typeof holder === 'object' && (holder.present === true || holder.detected === true || holder.grade)) {
              looksSlabbed = true;
            }
          }
          if (xg.ok && xg.grades) {
            const xs = {
              centering: clampSub(xg.grades.centering),
              corners:   clampSub(xg.grades.corners),
              edges:     clampSub(xg.grades.edges),
              surface:   clampSub(xg.grades.surface),
            };
            // Only overwrite each pillar if Ximilar returned a valid number.
            subgrades = {
              centering: xs.centering ?? subgrades.centering,
              corners:   xs.corners   ?? subgrades.corners,
              edges:     xs.edges     ?? subgrades.edges,
              surface:   xs.surface   ?? subgrades.surface,
            };
            cvSource   = 'ximilar';
            cvCentering = xg.cv?.centering || null;
            cvGrader   = {
              condition: xg.grades.condition,
              final:     clampSub(xg.grades.final),
              corners:   xg.cv?.corners || [],
              edges:     xg.cv?.edges || [],
            };
          }
        } catch(e) {
          console.warn('[scan] ximilar-grader threw, keeping GPT sub-grades:', e?.message || e);
        }
      }
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

      // If Ximilar returned a pixel-measured centering string, expose it as
      // the canonical `centering` field ("55/45 L/R, 52/48 T/B") so the UI
      // shows the real measurement instead of GPT's eyeball estimate.
      // Also re-compute the ceiling from Ximilar's more accurate numbers.
      //
      // CRITICAL: When Ximilar overrides, we must sync centering_lr /
      // centering_tb (the wire fields the UI reads for its meter) so the
      // meter bars, zone labels, ceiling caption, and psa_estimate all
      // reflect the SAME numbers. Previously the display string got updated
      // but the wire fields stayed as GPT's eyeball estimate — the UI would
      // render a meter showing 55/45 with a caption saying "caps at PSA 6",
      // which was mathematically impossible and shattered user trust.
      let finalCenteringLR = centeringLR;
      let finalCenteringTB = centeringTB;
      let centeringDisplay =
        (centeringLR || centeringTB)
          ? [centeringLR && `${centeringLR} L/R`, centeringTB && `${centeringTB} T/B`].filter(Boolean).join(', ')
          : (cardInfo.centering || 'Unknown');
      let finalCenteringCeiling = centeringCeiling;
      if (cvCentering?.leftRight || cvCentering?.topBottom) {
        const lr = cvCentering.leftRight;
        const tb = cvCentering.topBottom;
        centeringDisplay = [lr && `${lr} L/R`, tb && `${tb} T/B`].filter(Boolean).join(', ');
        // Sync wire fields so meter + caption stay in sync.
        if (lr) finalCenteringLR = lr;
        if (tb) finalCenteringTB = tb;
        // Re-run the ceiling calc with Ximilar's pixel-measured numbers.
        const rLRx = parseRatio(lr);
        const rTBx = parseRatio(tb);
        const worstX = (rLRx != null && rTBx != null) ? Math.max(rLRx, rTBx) : (rLRx ?? rTBx);
        const cvCeil = centeringCeilingFromRatio(worstX);
        if (cvCeil != null) {
          finalCenteringCeiling = cvCeil;
          subgrades.centering = cvCeil;
          if (psaEstimate != null && psaEstimate > cvCeil) psaEstimate = cvCeil;
        }
      }

      // ── FINAL COHERENCE PASS ──
      // Regardless of which source produced the ratios, the ceiling MUST
      // match what the ratios say. This catches the case where the model
      // returned inconsistent fields (e.g. centering_lr="55/45" but
      // centering_ceiling=6). Recompute from the numbers we're about to
      // display and let the numbers win.
      {
        const rLRf = parseRatio(finalCenteringLR);
        const rTBf = parseRatio(finalCenteringTB);
        const worstF = (rLRf != null && rTBf != null) ? Math.max(rLRf, rTBf) : (rLRf ?? rTBf);
        const truCeil = centeringCeilingFromRatio(worstF);
        if (truCeil != null) {
          if (truCeil !== finalCenteringCeiling) {
            console.warn('[scan] centering ceiling desync corrected:', {
              had: finalCenteringCeiling, computed: truCeil,
              lr: finalCenteringLR, tb: finalCenteringTB,
            });
          }
          finalCenteringCeiling = truCeil;
          subgrades.centering = truCeil;
          // psa_estimate can only be as high as the centering ceiling.
          if (psaEstimate != null && psaEstimate > truCeil) psaEstimate = truCeil;
        }
      }

      // Photo-based confidence gets a bump when Ximilar CV grades are available.
      if (cvSource === 'ximilar' && confidence !== 'high' && totalPhotos >= 2) {
        confidence = 'medium';
      }

      // Slab warning gets attached whenever we detected a slab, regardless
      // of which grader (Ximilar or GPT) produced the numbers. It's the
      // client's job to render it as a top-of-card banner.
      const slabWarning = looksSlabbed
        ? {
            slabbed: true,
            title: 'Sneaky, sneaky.',
            message: 'This card looks like it\'s already in a graded slab. Grading results will be skewed by the plastic and label — trust the number on the slab, not this estimate.',
          }
        : null;

      // Normalize psa_distribution: array of top 3 buckets summing to ~100.
      // ENFORCE: top bucket grade must equal psa_estimate (model sometimes
      // returns a distribution whose top bucket disagrees with its own
      // point estimate — that's incoherent and confusing to users).
      let distArray = [];
      const distObj = cardInfo.psa_distribution;
      if (distObj && typeof distObj === 'object') {
        const entries = Object.entries(distObj)
          .map(([g, p]) => ({ grade: parseInt(g, 10), pct: parseFloat(p) }))
          .filter(x => isFinite(x.grade) && isFinite(x.pct) && x.pct > 0)
          .sort((a, b) => b.pct - a.pct)
          .slice(0, 3);
        const total = entries.reduce((s, x) => s + x.pct, 0);
        if (total > 0) {
          distArray = entries.map(x => ({ grade: x.grade, pct: Math.round((x.pct / total) * 100) }));
        }
      }
      // If distribution missing, synthesize a conservative one around psaEstimate.
      if (distArray.length === 0 && psaEstimate != null) {
        if (confidence === 'high') {
          distArray = [{ grade: psaEstimate, pct: 80 }];
          if (psaEstimate < 10) distArray.push({ grade: psaEstimate + 1, pct: 10 });
          if (psaEstimate > 1)  distArray.push({ grade: psaEstimate - 1, pct: 10 });
        } else {
          distArray = [{ grade: psaEstimate, pct: 55 }];
          if (psaEstimate < 10) distArray.push({ grade: psaEstimate + 1, pct: 20 });
          if (psaEstimate > 1)  distArray.push({ grade: psaEstimate - 1, pct: 25 });
        }
      }
      // ── COHERENCE ENFORCEMENT ──
      // If the model's top bucket disagrees with psa_estimate (or if the server
      // just downgraded psa_estimate via the centering ceiling), rebuild the
      // distribution around the corrected psa_estimate. This keeps the UI's
      // "Most likely PSA X" and the top bar of the distribution in agreement.
      if (psaEstimate != null && distArray.length > 0 && distArray[0].grade !== psaEstimate) {
        // Preserve the model's uncertainty spread but shift the peak.
        const shift = psaEstimate - distArray[0].grade;
        distArray = distArray.map(x => ({ grade: Math.max(1, Math.min(10, x.grade + shift)), pct: x.pct }));
      }

      // ── THROUGH-PLASTIC HONESTY ENFORCEMENT ──
      // No matter what the model says, if we detected a slab/sleeve/holder,
      // hard-cap the outputs to reflect that we're grading through plastic.
      // The user cannot make a money decision on a grade estimate through a
      // reflective surface — they need to re-scan raw.
      const throughPlastic = looksSlabbed;
      if (throughPlastic) {
        // Force confidence down.
        confidence = 'low';
        // Force worth_grading to false — through plastic is not actionable.
        cardInfo.worth_grading = false;
        // Cap psa_estimate at 8 (Excellent-Mint) — anything higher is
        // dishonest when we can't see the card cleanly.
        if (psaEstimate != null && psaEstimate > 8) {
          console.warn('[scan] through-plastic cap applied to psa_estimate:', {
            was: psaEstimate, capped: 8,
          });
          psaEstimate = 8;
        }
        // Force grade_label consistency with the cap.
        if (psaEstimate != null && psaEstimate < 10 && cardInfo.grade_label === 'Gem Mint') {
          cardInfo.grade_label = psaEstimate >= 9 ? 'Mint' : 'Near Mint-Mint';
        }
        // Force eye_appeal down — you can't call eye appeal Strong when the
        // card is behind reflective plastic.
        if (cardInfo.eye_appeal === 'Strong') cardInfo.eye_appeal = 'Average';
        // Make sure the distribution reflects the uncertainty. If the top
        // bucket is > 55%, flatten it — low-confidence scans should show
        // spread, not false conviction.
        if (distArray.length > 0 && distArray[0].pct > 55) {
          const top = distArray[0];
          const rest = distArray.slice(1);
          const totalRest = rest.reduce((s, x) => s + x.pct, 0) || 1;
          top.pct = 50;
          const remain = 50;
          rest.forEach(x => { x.pct = Math.round((x.pct / totalRest) * remain); });
        }
      }

      // ── CONFIDENCE-VS-GRADE HONESTY ENFORCEMENT ──
      // A card with impediments cannot be a PSA 10. If drivers are
      // non-empty AND non-['none'], cap psa_estimate at 9.
      const hasRealDrivers = Array.isArray(cardInfo.confidence_drivers)
        && cardInfo.confidence_drivers.some(d => d && d !== 'none');
      if (hasRealDrivers && psaEstimate === 10) {
        console.warn('[scan] impediments present but psa_estimate=10 — capping at 9');
        psaEstimate = 9;
      }
      // worth_grading backstop: if final psa_estimate < 9 or confidence is
      // low, worth_grading must be false. Grading fees on a PSA 8 modern
      // card are net-negative under any realistic scenario.
      if (cardInfo.worth_grading === true) {
        if (psaEstimate == null || psaEstimate < 9 || confidence === 'low') {
          console.warn('[scan] worth_grading=true but grade/confidence too low — forcing false:', {
            psaEstimate, confidence,
          });
          cardInfo.worth_grading = false;
        }
      }

      // Low confidence + narrow distribution is dishonest. Spread it out.
      if (confidence === 'low' && distArray.length > 0 && distArray[0].pct > 55) {
        const top = distArray[0];
        const rest = distArray.slice(1);
        const totalRest = rest.reduce((s, x) => s + x.pct, 0) || 1;
        top.pct = 50;
        rest.forEach(x => { x.pct = Math.round((x.pct / totalRest) * 50); });
      }

      // ── LIMITING FACTOR PROSE RECONCILIATION ──
      // The model writes limiting_factor as free text, but sometimes it
      // contradicts the (server-corrected) numbers we're about to show —
      // e.g. it says "caps at PSA 6" while the measured centering is 55/45.
      // Detect that mismatch and replace with a deterministic sentence
      // derived from the actual measured numbers. Better to say something
      // boring-but-true than something confidently wrong.
      let reconciledLimitingFactor = cardInfo.limiting_factor || '';
      {
        const lf = String(reconciledLimitingFactor).toLowerCase();
        // Look for a grade number the prose is claiming, in patterns like
        //   "caps at PSA 6" / "psa 6 centering" / "projects as a 7" / "a psa 8"
        const claim = lf.match(/caps at psa\s*(\d{1,2})/i)
                   || lf.match(/psa\s*(\d{1,2})\s*centering/i)
                   || lf.match(/projects?\s+as\s+(?:a\s+)?psa\s*(\d{1,2})/i)
                   || lf.match(/\ba\s+psa\s*(\d{1,2})\b/i);
        const claimedGrade = claim ? parseInt(claim[1], 10) : null;
        const worstAxis = (() => {
          const a = parseRatio(finalCenteringLR);
          const b = parseRatio(finalCenteringTB);
          return (a != null && b != null) ? Math.max(a, b) : (a ?? b);
        })();
        const truCeil = centeringCeilingFromRatio(worstAxis);
        // Prose is lying if:
        //  • It names a grade that's LOWER than what the numbers support, OR
        //  • It contradicts our final psa_estimate by more than 1 grade.
        const proseIsLying =
          (claimedGrade != null && truCeil != null && claimedGrade < truCeil) ||
          (claimedGrade != null && psaEstimate != null && Math.abs(claimedGrade - psaEstimate) >= 2);
        if (proseIsLying) {
          console.warn('[scan] limiting_factor prose contradicts measured centering — rewriting:', {
            model_said: reconciledLimitingFactor,
            claimed_grade: claimedGrade,
            measured_ceiling: truCeil,
            psa_estimate: psaEstimate,
            lr: finalCenteringLR, tb: finalCenteringTB,
          });
          if (psaEstimate === 10) {
            reconciledLimitingFactor = `Measured centering (${finalCenteringLR || '?'} L/R, ${finalCenteringTB || '?'} T/B) qualifies for PSA 10. Corners, edges, and surface show no observable defects in the photos provided.`;
          } else if (psaEstimate != null && truCeil != null && psaEstimate === truCeil) {
            reconciledLimitingFactor = `Measured centering (${finalCenteringLR || '?'} L/R, ${finalCenteringTB || '?'} T/B) caps the front-centering grade at PSA ${truCeil}. The next grade up would require tighter centering.`;
          } else if (psaEstimate != null) {
            reconciledLimitingFactor = `Measured centering (${finalCenteringLR || '?'} L/R, ${finalCenteringTB || '?'} T/B) allows up to PSA ${truCeil ?? psaEstimate}. Final estimate is PSA ${psaEstimate} — review the pillar notes for the specific defect blocking a higher grade.`;
          }
        }
      }

      // Confidence drivers — array of strings the UI can render as chips.
      let confidenceDrivers = Array.isArray(cardInfo.confidence_drivers)
        ? cardInfo.confidence_drivers.filter(x => typeof x === 'string' && x.length)
        : [];
      // Auto-inject drivers we know about server-side.
      if (looksSlabbed && !confidenceDrivers.includes('holder_glare')) confidenceDrivers.push('holder_glare');
      if (totalPhotos < 2 && !confidenceDrivers.includes('single_photo_only')) confidenceDrivers.push('single_photo_only');
      if (!backDataUrl && !confidenceDrivers.includes('back_not_visible')) confidenceDrivers.push('back_not_visible');
      if (edgeImages.length < 4 && isDeepGrade && !confidenceDrivers.includes('limited_edge_visibility')) confidenceDrivers.push('limited_edge_visibility');
      if (confidenceDrivers.length === 0) confidenceDrivers = ['none'];

      return res.status(200).json({
        success:       true,
        mode:          'grade',
        deepGrade:     isDeepGrade,
        creditsUsed:   gradeCost,
        photoCount:    totalPhotos,
        card_name:     cardInfo.card_name     || '',

        // Centering — measured ratios + official PSA thresholds
        centering:            centeringDisplay,
        centering_lr:         finalCenteringLR || '',
        centering_tb:         finalCenteringTB || '',
        centering_back:       centeringBack || '',
        centering_ceiling:    finalCenteringCeiling ?? centeringCeiling ?? null,
        centering_thresholds: {
          psa10: '55/45 or better',
          psa9:  '60/40 or better',
          psa8:  '65/35 or better',
          psa7:  '70/30 or better',
          back_note: 'Back centering is significantly more lenient (75/25 for PSA 10)',
        },

        // PSA-native descriptions (no fake sub-scores)
        corners_desc: cardInfo.corners_desc || cardInfo.corners || 'Unknown',
        edges_desc:   cardInfo.edges_desc   || cardInfo.edges   || 'Unknown',
        surface_desc: cardInfo.surface_desc || cardInfo.surface || 'Unknown',

        // Legacy fields for older UI — mirror the new *_desc values
        corners: cardInfo.corners_desc || cardInfo.corners || 'Unknown',
        edges:   cardInfo.edges_desc   || cardInfo.edges   || 'Unknown',
        surface: cardInfo.surface_desc || cardInfo.surface || 'Unknown',

        // Overall grade prediction
        psa_estimate:      psaEstimate ?? cardInfo.psa_estimate ?? null,
        psa_distribution:  distArray,
        limiting_factor:   reconciledLimitingFactor,
        grade_label:       cardInfo.grade_label   || '',
        grade_notes:       cardInfo.grade_notes   || reconciledLimitingFactor || '',

        // Eye appeal (new PSA-aligned judgment layer)
        eye_appeal:        cardInfo.eye_appeal || 'Average',
        eye_appeal_notes:  cardInfo.eye_appeal_notes || '',

        flaw_count:      clampSub(cardInfo.flaw_count) ?? null,
        worth_grading:   cardInfo.worth_grading ?? false,
        is_vintage:      cardInfo.is_vintage === true,

        // Legacy subgrades kept for backward-compat with the current UI.
        // Centering here = the ceiling grade (not a fake sub-score).
        subgrades,

        confidence,
        confidence_drivers: confidenceDrivers,
        cv_source:     cvSource,     // 'ximilar' or 'gpt'
        cv_grader:     cvGrader,     // { condition, final, corners[], edges[] } when ximilar succeeded
        // Grading standard disclosure — aligned to OFFICIAL PSA thresholds now.
        grading_standard: cvSource === 'ximilar'
          ? 'AI estimate using OFFICIAL PSA thresholds with pixel-measured centering. Final grade is at PSA\'s discretion.'
          : 'AI estimate using OFFICIAL PSA thresholds (55/45 = PSA 10, 60/40 = PSA 9, 65/35 = PSA 8). Final grade is at PSA\'s discretion.',
        slab_warning:  slabWarning,
        // If it's a slab, echo back what GPT read off the label so the UI
        // can say "CGC 10" instead of just "probably slabbed".
        slab_info:     looksSlabbed
          ? {
              grader: cardInfo.slab_grader || '',
              grade:  cardInfo.slab_grade  || '',
            }
          : null,
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
