// _ximilar_grade.js — Ximilar Card Grader wrapper (sync endpoint).
//
// Purpose: get pixel-measured centering + per-corner + per-edge + surface
// grades from Ximilar's purpose-built AI grader. This replaces GPT-5's
// eyeball-estimated pillar scores with real computer-vision measurements.
//
// Endpoint (sync, no polling required):
//   POST https://api.ximilar.com/card-grader/v2/grade
//
// Docs: https://docs.ximilar.com/collectibles/card-grading
// Auth: Authorization: Token <api_key>
//
// Response shape (relevant fields):
//   { records: [{
//       _objects: [{ bound_box, prob }],
//       corners: [{ name, bound_box, point, grade }],   // 4 corners
//       edges:   [{ name, polygon, grade }],            // 4 edges
//       card: [{ polygon, bound_box, surface: {grade}, centering: {left/right, top/bottom, pixels, offsets} }],
//       grades: { corners, edges, surface, centering, final, condition }
//   }] }
//
// If both front and back are submitted in one call, `final` is a weighted
// average (70% front / 30% back).

/**
 * Grade a card via Ximilar's sync grader.
 * @param {string|string[]} imagesBase64  one image or [front, back] as base64 (no data: prefix)
 * @param {string} mime                    'image/jpeg' etc
 * @param {string} apiToken                Ximilar API token
 * @returns {Promise<{ok:boolean, reason?:string, grades?:object, cv?:object, raw?:object}>}
 *
 * On success:
 *   {
 *     ok: true,
 *     grades: { corners: 8, edges: 7.5, surface: 9, centering: 8.5, final: 8.0, condition: 'Near Mint' },
 *     cv: {
 *       centering: { leftRight: '55/45', topBottom: '52/48', pixels: [12,10,14,11], offsets: {...} },
 *       corners:   [{name:'UL', grade:9}, ...],
 *       edges:     [{name:'UPPER', grade:8}, ...],
 *       surface:   9
 *     },
 *     raw: <full ximilar response>
 *   }
 */
export async function gradeWithXimilar(imagesBase64, mime, apiToken) {
  if (!apiToken) return { ok: false, reason: 'missing_token' };
  const imgs = Array.isArray(imagesBase64) ? imagesBase64 : [imagesBase64];
  if (!imgs.length || !imgs[0]) return { ok: false, reason: 'missing_image' };

  // Ximilar sync grader limit: max 2 records (front + back)
  const records = imgs.slice(0, 2).map((b64, idx) => ({
    _base64: b64,
    side: idx === 0 ? 'front' : 'back',
  }));

  const url = 'https://api.ximilar.com/card-grader/v2/grade';
  let resp;
  try {
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), 30000); // grader is slower than ID (~3-8s)
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${apiToken}`,
      },
      body: JSON.stringify({ records }),
      signal: ac.signal,
    });
    clearTimeout(timeoutId);
  } catch(e) {
    return { ok: false, reason: e.name === 'AbortError' ? 'timeout' : 'network_error', error: e.message };
  }

  if (!resp.ok) {
    return { ok: false, reason: `http_${resp.status}`, error: await resp.text().catch(() => '') };
  }

  let data;
  try { data = await resp.json(); }
  catch(e) { return { ok: false, reason: 'parse_error', error: e.message }; }

  const rec = data?.records?.[0];
  if (!rec || rec._status?.code >= 400) {
    return { ok: false, reason: 'no_card_detected', raw: data };
  }

  const g = rec.grades || {};
  // Ximilar may not always populate all grades — bail out only if there's nothing usable.
  if (g.final == null && g.corners == null && g.edges == null && g.surface == null && g.centering == null) {
    return { ok: false, reason: 'empty_grades', raw: data };
  }

  const cardBlock = rec.card?.[0] || {};
  const centering = cardBlock.centering || {};
  const surface   = cardBlock.surface || {};

  return {
    ok: true,
    grades: {
      corners:   toNum(g.corners),
      edges:     toNum(g.edges),
      surface:   toNum(g.surface ?? surface.grade),
      centering: toNum(g.centering),
      final:     toNum(g.final),
      condition: g.condition || null,
    },
    cv: {
      centering: {
        leftRight: centering['left/right'] || centering.left_right || null,
        topBottom: centering['top/bottom'] || centering.top_bottom || null,
        pixels:    centering.pixels || null,
        offsets:   centering.offsets || null,
      },
      corners: (rec.corners || []).map(c => ({ name: c.name, grade: toNum(c.grade) })),
      edges:   (rec.edges   || []).map(e => ({ name: e.name, grade: toNum(e.grade) })),
      surface: toNum(surface.grade ?? g.surface),
    },
    raw: data,
  };
}

function toNum(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
