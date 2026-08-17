// _ximilar.js — Ximilar Collectibles Recognition wrapper.
//
// Purpose-built purpose: return a cardInfo-shaped object (same fields as
// scan.js's GPT-5 result) so callers can use it as a drop-in replacement.
// Falls back to null on any error/no-match so caller can chain to GPT.
//
// Endpoints used:
//   POST https://api.ximilar.com/collectibles/v2/tcg_id     — TCG (Pokemon, MTG, Yugioh, Lorcana, OP)
//   POST https://api.ximilar.com/collectibles/v2/sport_id   — Sports cards
//
// Docs: https://docs.ximilar.com/collectibles/recognition
// Auth: Authorization: Token <api_key>
// Credits: 10 per TCG identify, 10 per Sports identify

// Distance thresholds (Ximilar returns 0..1+, lower = more similar):
//   < 0.35 → very confident, single answer
//   < 0.55 → confident, but if 2nd candidate is also close return picker
//   >= 0.55 → not confident enough, let GPT try
const DIST_HIGH_CONF      = 0.35;
const DIST_MEDIUM_CONF    = 0.55;
const DIST_GAP_FOR_SINGLE = 0.15; // 2nd must be at least this far from 1st for single-answer

/**
 * Identify a card via Ximilar. Returns:
 *   { ok: true,  cardInfo: {...} }                       — single confident answer
 *   { ok: true,  candidates: [{...},...], needsPicker }  — multiple close candidates
 *   { ok: false, reason: '...' }                         — no match, fell short, or API error
 *
 * @param {string} imageBase64  base64 (no data: prefix)
 * @param {string} mime         'image/jpeg' etc
 * @param {string} apiToken     Ximilar API token (from env)
 * @param {'tcg'|'sport'} kind  which endpoint to hit
 */
export async function identifyWithXimilar(imageBase64, mime, apiToken, kind = 'tcg') {
  if (!apiToken || !imageBase64) return { ok: false, reason: 'missing_input' };

  const url = kind === 'sport'
    ? 'https://api.ximilar.com/collectibles/v2/sport_id'
    : 'https://api.ximilar.com/collectibles/v2/tcg_id';

  const dataUrl = `data:${mime || 'image/jpeg'};base64,${imageBase64}`;
  const body = { records: [{ _base64: imageBase64 }] };

  // Ximilar accepts either `_base64` or `_url`. Use base64 since the client
  // uploaded the image directly and we haven't stored it anywhere public.

  let resp;
  try {
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), 15000);
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${apiToken}`,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    clearTimeout(timeoutId);
  } catch (e) {
    console.warn('[ximilar] fetch failed:', e.message);
    return { ok: false, reason: 'network', error: e.message };
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    console.warn('[ximilar] non-2xx:', resp.status, errText.slice(0, 300));
    return { ok: false, reason: 'http', status: resp.status, errText: errText.slice(0, 300) };
  }

  let json;
  try {
    json = await resp.json();
  } catch (e) {
    return { ok: false, reason: 'parse', error: e.message };
  }

  const rec = json?.records?.[0];
  if (!rec) return { ok: false, reason: 'no_records' };

  // If Ximilar didn't detect any card object at all, fall through
  const obj = rec._objects?.[0];
  if (!obj) return { ok: false, reason: 'no_card_detected' };

  const ident = obj._identification || {};
  const best  = ident.best_match;
  if (!best?.name) return { ok: false, reason: 'no_match' };

  const alternatives = Array.isArray(ident.alternatives) ? ident.alternatives : [];
  const distances    = Array.isArray(ident.distances)    ? ident.distances    : [];
  const dBest   = distances[0] ?? 1.0;
  const dSecond = distances[1] ?? 1.0;

  // Extract card-tag signals for cardInfo enrichment
  const tags = obj._tags || {};
  const foilTag  = tags['Foil/Holo']?.[0]?.name || '';
  const sideTag  = tags['Side']?.[0]?.name || 'front';
  const subCat   = tags['Subcategory']?.[0]?.name || ''; // Pokemon | Magic The Gathering | Yu-Gi-Oh | ...
  const alphabet = tags['Alphabet']?.[0]?.name || 'latin'; // latin | japanese | korean | ...
  const gradedTag = tags['Graded']?.[0]?.name === 'yes';

  const cardType = mapSubcategoryToCardType(subCat, kind);
  const isJapanese = alphabet === 'japanese' || subCat === 'Pokemon Japanese';

  // Build cardInfo for the confident-single case
  const buildCardInfo = (m) => ({
    card_name:   m.name || '',
    card_number: m.card_number || '',
    set_name:    m.set || '',
    set_code:    m.set_code || '',
    hp:          '', // Ximilar doesn't return HP directly
    card_type:   cardType,
    is_japanese: isJapanese,
    jp_name:     isJapanese && m.japanese_name ? m.japanese_name : '',
    rarity:      m.rarity || '',
    sport:       kind === 'sport' ? (m.sport || '') : '',
    year:        m.year ? String(m.year) : '',
    _grounded:      true,
    _grounded_id:   deriveGroundedId(m),
    _ximilar:       true,
    _ximilar_dist:  dBest,
    _ximilar_links: m.links || {},
    _ximilar_side:  sideTag,
    _ximilar_foil:  foilTag,
    _ximilar_graded: gradedTag,
    // For downstream image loading — we have TCGPlayer / cardmarket links.
    // Keep the raw best_match around for the client if it wants them.
    _ximilar_full_name: m.full_name || '',
    image_quality: 'ok',
    confidence:    dBest < DIST_HIGH_CONF ? 'high' : 'medium',
  });

  // HIGH CONFIDENCE: top match well below threshold AND second match is meaningfully worse
  if (dBest < DIST_HIGH_CONF && (dSecond - dBest) >= DIST_GAP_FOR_SINGLE) {
    return {
      ok: true,
      cardInfo: buildCardInfo(best),
    };
  }

  // MEDIUM CONFIDENCE: top is under medium threshold — return picker if close alternatives exist
  if (dBest < DIST_MEDIUM_CONF) {
    // Build 2-3 candidates: top + close alternatives (within 0.2 of top)
    const closeAlts = alternatives
      .map((a, i) => ({ ...a, dist: distances[i + 1] ?? 1.0 }))
      .filter(a => a.dist < Math.min(DIST_MEDIUM_CONF + 0.1, dBest + 0.25))
      .slice(0, 2);

    if (closeAlts.length === 0) {
      // Only one plausible answer — return it as single (medium confidence)
      return { ok: true, cardInfo: buildCardInfo(best) };
    }

    const candidates = [
      { ...buildCardInfo(best),        confidence_pct: Math.round((1 - dBest)   * 100) },
      ...closeAlts.map(a => ({ ...buildCardInfo(a), confidence_pct: Math.round((1 - a.dist) * 100) })),
    ];

    return {
      ok: true,
      needsPicker: true,
      candidates,
      cardInfo: buildCardInfo(best), // top guess for UI convenience
    };
  }

  // Too uncertain — let GPT handle it
  return { ok: false, reason: 'low_confidence', distance: dBest };
}


function mapSubcategoryToCardType(subCat, kind) {
  if (kind === 'sport') return 'sports';
  const s = (subCat || '').toLowerCase();
  if (s.includes('pokemon'))     return 'pokemon';
  if (s.includes('magic'))       return 'mtg';
  if (s.includes('yu-gi'))       return 'yugioh';
  if (s.includes('lorcana'))     return 'lorcana';
  if (s.includes('one piece'))   return 'onepiece';
  return 'pokemon'; // TCG default — client uses this to pick pricing source
}

/**
 * Build a canonical grounded_id the client can use to fetch card details.
 * Prefer pokemontcg.io-style ids ({set_series_code}-{card_number}) when possible.
 * Fallback: the set_code + card_number.
 */
function deriveGroundedId(m) {
  const seriesCode = (m.set_series_code || '').toLowerCase();
  const num = String(m.card_number || '').replace(/^0+/, ''); // strip leading zeros
  if (seriesCode && num) return `${seriesCode}-${num}`;
  if (m.set_code && num) return `${m.set_code.toLowerCase()}-${num}`;
  return null;
}
