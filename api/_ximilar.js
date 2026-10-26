import { observeProviderAttempt } from './_providerUsage.js';
// _ximilar.js — Ximilar Collectibles Recognition wrapper.
//
// Returns a cardInfo-shaped result or an explicit failure reason. Identification
// callers surface misses without substituting an ungrounded card guess.
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
//   >= 0.55 → not confident enough, return a miss
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
export async function identifyWithXimilar(imageBase64, mime, apiToken, kind = 'tcg', mode = 'identify') {
  if (!apiToken || !imageBase64) return { ok: false, reason: 'missing_input' };
  return observeProviderAttempt({ provider: 'ximilar', operation: kind === 'sport' ? 'sport_id' : 'tcg_id', mode, inputImages: 1 },
    observe => identify(imageBase64, apiToken, kind, observe));
}

async function identify(imageBase64, apiToken, kind, observe) {

  const url = kind === 'sport'
    ? 'https://api.ximilar.com/collectibles/v2/sport_id'
    : 'https://api.ximilar.com/collectibles/v2/tcg_id';

  const body = { records: [{ _base64: imageBase64 }] };
  // TCG rotation correction defaults off. Ask the same identification request to
  // orient the detected card; keep sports on its separately documented options.
  if (kind !== 'sport') body.rotate = true;

  // Ximilar accepts either `_base64` or `_url`. Use base64 since the client
  // uploaded the image directly and we haven't stored it anywhere public.

  let resp, json, timeoutId;
  try {
    const ac = new AbortController();
    timeoutId = setTimeout(() => ac.abort(), 15000);
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${apiToken}`,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    observe({ status: resp.status });
    if (!resp.ok) {
      console.warn('[ximilar] non-2xx:', resp.status);
      // Keep the deadline active while consuming error responses too.
      const errText = await resp.text();
      return { ok: false, reason: 'http', status: resp.status, errText: errText.slice(0, 300) };
    }
    json = await resp.json();
  } catch (e) {
    const reason = ['AbortError', 'TimeoutError'].includes(e.name) ? 'timeout' : resp ? 'parse' : 'network';
    console.warn('[ximilar] request failed:', reason);
    return { ok: false, reason, error: e.message };
  } finally {
    clearTimeout(timeoutId);
  }

  const rec = json?.records?.[0];
  if (!rec) return { ok: false, reason: 'no_records' };
  // HTTP 200 does not guarantee that this individual image was processed.
  if (rec._status && (!Number.isInteger(rec._status.code) || rec._status.code < 200 || rec._status.code >= 300)) {
    return { ok: false, reason: 'record_error' };
  }

  if (!Array.isArray(rec._objects)) return { ok: false, reason: 'invalid_response' };
  // Detection can include a Slab Label before the Card. Never identify the
  // label as the card. Older responses omitted the name on a sole object.
  const cards = rec._objects.filter(o => o?.name === 'Card' ||
    (rec._objects.length === 1 && o && !o.name && o._identification));
  const identifiedCards = cards.filter(o => o._identification?.best_match?.name);
  if (identifiedCards.length > 1) return { ok: false, reason: 'multiple_cards' };
  const obj = identifiedCards[0] || cards[0];
  if (!obj) return { ok: false, reason: 'no_card_detected' };

  // A visual game tag can route free text recovery after a miss. It is not
  // a card identity and must never be taken from a rejected nearest match.
  const visualGame = mapSubcategoryToCardType(obj._tags?.Subcategory?.[0]?.name, 'tcg');
  const gameHint = visualGame || (String(obj._tags?.Category?.[0]?.name || '').toLowerCase().includes('sport') ? 'sports' : '');

  const ident = obj._identification || {};
  const best  = ident.best_match;
  if (!best?.name) return { ok: false, reason: 'no_match', gameHint };
  if (typeof best.name !== 'string' || !best.name.trim()) return { ok: false, reason: 'invalid_response' };

  const alternatives = Array.isArray(ident.alternatives) ? ident.alternatives : [];
  const distances    = Array.isArray(ident.distances)    ? ident.distances    : [];
  // Scores are ordered numeric distances, not probabilities. A corrupt or
  // incomplete score must never become a confident match through JS coercion.
  if (distances.length < alternatives.length + 1 ||
      distances.some((d, i) => typeof d !== 'number' || !Number.isFinite(d) || d < 0 || (i && d < distances[i - 1])) ||
      alternatives.some(a => !a || typeof a.name !== 'string' || !a.name.trim())) {
    return { ok: false, reason: 'invalid_response' };
  }
  const dBest   = distances[0];
  const dSecond = distances[1] ?? Infinity;
  observe?.({ matchDistance: distances[0], ...(distances.length > 1 ? { matchGap: distances[1] - distances[0] } : {}) });

  // Extract card-tag signals for cardInfo enrichment
  const tags = obj._tags || {};
  const foilTag  = tags['Foil/Holo']?.[0]?.name || '';
  const sideTag  = tags['Side']?.[0]?.name || 'front';
  const subCat   = tags['Subcategory']?.[0]?.name || ''; // Pokemon | Magic The Gathering | Yu-Gi-Oh | ...
  const alphabet = tags['Alphabet']?.[0]?.name || 'latin'; // latin | japanese | korean | ...
  const gradedTag = tags['Graded']?.[0]?.name === 'yes';

  // Prefer the matched catalog entry's game to a visual object tag. Missing
  // or unsupported games must not inherit Pokemon pricing and catalog IDs.
  const typeFor = m => mapSubcategoryToCardType(m.subcategory || best.subcategory || subCat, kind);
  if (!typeFor(best)) return { ok: false, reason: 'unsupported_card_type' };
  const isJapanese = alphabet === 'japanese' || /japanese/i.test(best.subcategory || subCat);

  // Build cardInfo for the confident-single case
  const buildCardInfo = (m, distance) => ({
    card_name:   m.name || '',
    card_number: m.card_number || '',
    set_name:    m.set || m.set_name || '',
    set_code:    m.set_code || '',
    hp:          '', // Ximilar doesn't return HP directly
    card_type:   typeFor(m),
    is_japanese: isJapanese,
    jp_name:     isJapanese && m.japanese_name ? m.japanese_name : '',
    rarity:      m.rarity || '',
    sport:       kind === 'sport' ? (m.sport || m.subcategory || '') : '',
    brand:       kind === 'sport' ? (m.company || '') : '',
    year:        m.year ? String(m.year) : '',
    _grounded:      true,
    _grounded_id:   deriveGroundedId(m),
    _ximilar:       true,
    _ximilar_dist:  distance,
    _ximilar_links: m.links || {},
    _ximilar_side:  sideTag,
    _ximilar_foil:  foilTag,
    _ximilar_graded: gradedTag,
    // For downstream image loading — we have TCGPlayer / cardmarket links.
    // Keep the raw best_match around for the client if it wants them.
    _ximilar_full_name: m.full_name || '',
    image_quality: 'unknown',
    confidence:    distance < DIST_HIGH_CONF ? 'high' : 'medium',
  });

  // HIGH CONFIDENCE: top match well below threshold AND second match is meaningfully worse
  if (dBest < DIST_HIGH_CONF && (dSecond - dBest) >= DIST_GAP_FOR_SINGLE) {
    return {
      ok: true,
      cardInfo: buildCardInfo(best, dBest),
    };
  }

  // MEDIUM CONFIDENCE: top is under medium threshold — return picker if close alternatives exist
  if (dBest < DIST_MEDIUM_CONF) {
    // Build 2-3 candidates: top + close alternatives (within 0.2 of top)
    const closeAlts = alternatives
      .map((a, i) => ({ ...a, dist: distances[i + 1] }))
      .filter(a => a.dist < Math.min(DIST_MEDIUM_CONF + 0.1, dBest + 0.25))
      .slice(0, 2);

    if (closeAlts.length === 0) {
      // Only one plausible answer — return it as single (medium confidence)
      // A close second distance without its candidate cannot establish a
      // unique identity. Ask for a retry instead of hiding the ambiguity.
      if (dSecond < Math.min(DIST_MEDIUM_CONF + 0.1, dBest + 0.25)) return { ok: false, reason: 'invalid_response' };
      return { ok: true, cardInfo: buildCardInfo(best, dBest) };
    }

    if (closeAlts.some(a => !typeFor(a))) return { ok: false, reason: 'unsupported_card_type' };
    const candidates = [
      buildCardInfo(best, dBest),
      ...closeAlts.map(a => buildCardInfo(a, a.dist)),
    ];

    return {
      ok: true,
      needsPicker: true,
      candidates,
      cardInfo: buildCardInfo(best, dBest), // top guess for UI convenience
    };
  }

  // Too uncertain — preserve the miss instead of presenting a weak guess.
  return { ok: false, reason: 'low_confidence', distance: dBest, gameHint };
}


function mapSubcategoryToCardType(subCat, kind) {
  if (kind === 'sport') return 'sports';
  const s = String(subCat || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (s.includes('pokemon'))     return 'pokemon';
  if (s.includes('magic') || s === 'mtg') return 'mtg';
  if (s.replace(/[^a-z]/g, '').includes('yugioh')) return 'yugioh';
  if (s.includes('lorcana'))     return 'lorcana';
  if (s.replace(/[^a-z]/g, '').includes('onepiece')) return 'onepiece';
  return null;
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
