import { observeProviderAttempt } from './_providerUsage.js';
// _ximilar_grade.js — Ximilar Card Grader wrapper (async job API).
//
// Purpose: get pixel-measured centering + per-corner + per-edge + surface
// grades from Ximilar's purpose-built AI grader. This replaces GPT-5's
// eyeball-estimated pillar scores with real computer-vision measurements.
//
// Endpoint (async job; the old sync card-grader/v2/grade is retired):
//   POST https://api.ximilar.com/account/v2/request/  then  GET .../request/<id>
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
 * Grade a card via Ximilar's asynchronous grading job.
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
export async function gradeWithXimilar(imagesBase64, mime, apiToken, mode = 'grade') {
  if (!apiToken) return { ok: false, reason: 'missing_token' };
  const imgs = Array.isArray(imagesBase64) ? imagesBase64 : [imagesBase64];
  if (!imgs.length || !imgs[0]) return { ok: false, reason: 'missing_image' };
  return observeProviderAttempt({ provider: 'ximilar', operation: 'card_grade', mode, inputImages: Math.min(imgs.length, 2) },
    observe => grade(imgs, apiToken, observe));
}

// Ximilar retired the synchronous card-grader endpoints; grading is now an
// asynchronous job: POST /account/v2/request/ (type card-grader, endpoint
// grade, <=2 records) then GET /account/v2/request/<id> until DONE.
// Docs: https://docs.ximilar.com/collectibles/card-grading (checked 2026-10-06).
//
// One end-to-end budget bounds submit + every poll, including body reads.
// The job is submitted exactly once per call: a lost/ambiguous submit is NOT
// retried (that could pay for a second job). Polls never resubmit.
export const XIMILAR_ASYNC_SUBMIT_URL = 'https://api.ximilar.com/account/v2/request/';
const DEFAULT_BUDGET_MS = 55000;
const REQUEST_TIMEOUT_MS = 12000;
const FIRST_POLL_DELAY_MS = 6000;
const POLL_INTERVAL_MS = 2500;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function timedJson(url, init, msLeft, fetchImpl) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), Math.max(1, Math.min(REQUEST_TIMEOUT_MS, msLeft)));
  try {
    const resp = await fetchImpl(url, { ...init, signal: ac.signal });
    let data = null, parseError = false;
    try { data = await resp.json(); } catch (e) {
      // A body that stalls past the deadline is a timeout, not a bad payload.
      if (ac.signal.aborted) throw Object.assign(new Error('body timeout'), { name: 'AbortError' });
      parseError = true;
    }
    return { status: resp.status, ok: resp.ok, data, parseError };
  } finally { clearTimeout(t); }
}

export async function gradeAsync(imgs, apiToken, observe = () => {}, opts = {}) {
  const fetchImpl = opts.fetch || fetch;
  const now = opts.now || Date.now;
  const wait = opts.sleep || sleep;
  const deadline = now() + (opts.budgetMs || DEFAULT_BUDGET_MS);
  const left = () => deadline - now();
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Token ${apiToken}` };
  const records = imgs.slice(0, 2).map((b64, idx) => ({ _base64: b64, Side: idx === 0 ? 'Front' : 'Back' }));

  let submitted;
  try {
    submitted = await timedJson(XIMILAR_ASYNC_SUBMIT_URL, { method: 'POST', headers,
      body: JSON.stringify({ type: 'card-grader', endpoint: 'grade', records }) }, left(), fetchImpl);
  } catch (e) {
    // Ambiguous: Ximilar may have accepted the job. Do not resubmit.
    return { ok: false, reason: e?.name === 'AbortError' ? 'submit_timeout_ambiguous' : 'network_error' };
  }
  observe({ status: submitted.status });
  if (!submitted.ok) return { ok: false, reason: `http_${submitted.status}` };
  const jobId = submitted.data?.id;
  if (submitted.parseError || typeof jobId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(jobId)) {
    return { ok: false, reason: 'submit_malformed' };
  }
  console.log('[scan] ximilar-grader job submitted', jobId);

  let status = submitted.data?.status || 'CREATED', job = submitted.data, polls = 0;
  if (status !== 'DONE') await wait(Math.min(FIRST_POLL_DELAY_MS, Math.max(0, left() - 1000)));
  while (status !== 'DONE') {
    if (!['CREATED', 'PROCESSING', 'PENDING', 'QUEUED'].includes(status)) {
      return { ok: false, reason: 'job_failed', jobId, jobStatus: String(status).slice(0, 24) };
    }
    if (left() < 1500) return { ok: false, reason: 'job_timeout', jobId, polls };
    polls++;
    let polled;
    try {
      polled = await timedJson(XIMILAR_ASYNC_SUBMIT_URL + encodeURIComponent(jobId), { method: 'GET', headers }, left(), fetchImpl);
    } catch { polled = null; } // transient poll failure: keep polling within budget
    if (polled?.ok && !polled.parseError && polled.data) { job = polled.data; status = job.status; }
    else if (polled && [401, 403, 404].includes(polled.status)) return { ok: false, reason: `poll_http_${polled.status}`, jobId };
    if (status !== 'DONE') await wait(Math.min(POLL_INTERVAL_MS, Math.max(0, left() - 1000)));
  }
  const data = job?.response;
  return { ...parseGradeResponse(data), jobId, polls };
}

async function grade(imgs, apiToken, observe) {
  return gradeAsync(imgs, apiToken, observe);
}

// Record shape is unchanged from the documented grade endpoint example.
export function parseGradeResponse(data) {
  const rec = data?.records?.[0];
  if (!rec || rec._status?.code >= 400) {
    return { ok: false, reason: 'no_card_detected', raw: data };
  }

  const g = rec.grades || {};
  // Ximilar may not always populate all grades — bail out only if there's nothing usable.
  if (g.final == null && g.corners == null && g.edges == null && g.surface == null && g.centering == null) {
    return { ok: false, reason: 'empty_grades', raw: data };
  }

  if (![g.final, g.corners, g.edges, g.surface, g.centering].some(v => toNum(v) != null)) {
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
  if (typeof v !== 'number' && (typeof v !== 'string' || !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
}
