// Grade results explain moderate/low confidence with fixes, and show the
// centering limit beside the overall grade (2026-10-11, reviewer feedback).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
const root = resolve(new URL('..', import.meta.url).pathname);
const fx = n => readFileSync(join(root, 'tests/fixtures/grade-check', n)).toString('base64');
const types = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json' };
const server = createServer((q,s)=>{let p=decodeURIComponent(new URL(q.url,'http://x').pathname);p=join(root,p==='/'?'index.html':p);if(!existsSync(p)){s.statusCode=404;return s.end();}s.setHeader('content-type',types[extname(p)]||'application/octet-stream');s.end(readFileSync(p));});
await new Promise(r=>server.listen(0,'127.0.0.1',r)); const origin=`http://127.0.0.1:${server.address().port}`;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const shot = process.argv[2] || '';
const base = { success: true, mode: 'grade', analysis_id: 'a1', card_name: 'Cresselia', card_type: 'pokemon', creditsUsed: 2,
  centering: '52/48 L/R, 54/46 T/B', centering_lr: '52/48', centering_tb: '54/46', centering_source: 'measured',
  corners_desc: 'Light whitening on two corners', edges_desc: 'Minor nicks', surface_desc: 'Clean', psa_estimate: 7,
  psa_distribution: [{ grade: 7, pct: 52 }, { grade: 8, pct: 28 }, { grade: 6, pct: 20 }], limiting_factor: 'Corner whitening limits this to PSA 7.',
  grade_label: 'NM', grade_notes: '', eye_appeal: 'Average', worth_grading: false, grading_standard: 'AI estimate.' };
const b = await chromium.launch({ executablePath: process.env.CR_CHROMIUM || undefined, args: ['--no-sandbox'] });
try {
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => localStorage.setItem('cs_landing_seen', '1'));
  await page.route('**/*', r => { const u = r.request().url(); if (!u.startsWith(origin) || u.includes('/api/')) return r.fulfill({ status: 204, body: '' }); return r.continue(); });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof submitGradeScan === 'function' && typeof _gradeWhyConfidenceHtml === 'function', null, { timeout: 30000 });
  await page.evaluate((P) => { window.__P = P; window.googleUser = { sub: 'u', email: 'e' }; window._googleIdToken = 't';
    document.getElementById('scanOverlay').style.display = 'flex'; },
    { fs: fx('front-sharp.jpg'), bs: fx('back-sharp.jpg'), ts: fx('top-sharp.jpg'), tsoft: fx('top-soft.jpg'), bos: fx('bottom-sharp.jpg') });
  const run = async (reply, photos, deep, anyway) => page.evaluate(async ({ reply, photos, deep, anyway }) => {
    const P = window.__P;
    window.cardResellScanRequest = async () => ({ status: 200, ok: true, json: async () => reply });
    window._gradeFrontBase64 = P[photos[0]]; window._gradeBackBase64 = P[photos[1]];
    window._gradeEdges = Object.fromEntries(Object.entries(photos[2] || {}).map(([k, v]) => [k, P[v]])); window._gradeIsDeep = deep;
    window._gradePhotoAccepted = null;
    await submitGradeScan(deep);
    if (anyway) { const btn = [...document.querySelectorAll('#scanResult button')].find(x => /Grade anyway/.test(x.textContent)); btn.click();
      for (let i = 0; i < 100 && !document.querySelector('.grade-headline'); i++) await new Promise(r => setTimeout(r, 50)); }
    const q = s => document.querySelector(s);
    return { headline: q('.grade-headline')?.textContent || '', conf: q('.grade-confidence')?.textContent || '',
      why: q('.grade-why-confidence')?.innerText || '', split: q('.grade-centering-split')?.innerText || '',
      order: [...document.querySelectorAll('#scanResult > div')].map(d => d.className).filter(Boolean).join(','),
      oldLine: /Confidence reduced by/.test(document.getElementById('scanResult').innerText) };
  }, { reply, photos, deep, anyway });

  // 1. Moderate Deep Grade, 4 of 6 photos, soft top edge graded anyway.
  let r = await run({ ...base, deepGrade: true, photoCount: 4, confidence: 'medium', confidence_drivers: ['limited_edge_visibility'], centering_ceiling: 10 },
    ['fs', 'bs', { top: 'tsoft', bottom: 'bos' }], true, true);
  if (shot) await page.screenshot({ path: shot, fullPage: false });
  ok(r.headline === 'PSA 7' && r.conf === 'Moderate confidence', 'headline + badge: ' + r.headline + ' / ' + r.conf);
  ok(/WHY MODERATE CONFIDENCE/.test(r.why), 'why block shown for moderate');
  ok(/Limited edge visibility \(4 of 6 photos used\)\. Add all four edge photos/.test(r.why), 'grader driver merged with the photo count');
  ok((r.why.match(/Add all four edge photos/g) || []).length === 1, 'edge advice not repeated');
  ok(/Your top edge photo measured soft focus on this phone\. Retake it/.test(r.why), 'phone measurement included');
  { const h = await page.evaluate(() => _gradeWhyConfidenceHtml({ confidence: 'medium', confidenceLabel: 'Moderate confidence', drivers: [],
      driverLabel: k => k, photoCheck: null, isDeep: true, photoCount: 5 }));
    ok(/This Deep Grade used 5 of 6 photos\.<\/span> <span[^>]*>Add all four edge photos for high confidence\./.test(h), 'photo-count ceiling explained on its own'); }
  ok(/CENTERING\s+PSA 10\s+Measured/.test(r.split) && /OVERALL\s+PSA 7/.test(r.split), 'centering and overall side by side: ' + r.split.replace(/\s+/g, ' '));
  ok(/Centering is not what is holding this card back\. Corners, edges or surface are\./.test(r.split), 'centering not the limit');
  ok(!r.oldLine, 'old one-line drivers text removed');
  ok(r.order.indexOf('grade-why-confidence') >= 0 && r.order.indexOf('grade-why-confidence') < r.order.indexOf('grade-centering-split'), 'why block sits above the split');

  // 2. High confidence, 6 photos: no why block.
  r = await run({ ...base, deepGrade: true, photoCount: 6, confidence: 'high', confidence_drivers: ['none'], centering_ceiling: 9, psa_distribution: [{ grade: 9, pct: 60 }] },
    ['fs', 'bs', { top: 'ts', bottom: 'bos' }], true, false);
  ok(r.headline === 'PSA 9' && r.conf === 'High confidence' && r.why === '', 'high confidence: no why block');
  ok(/Up to PSA 9/.test(r.split) && /Centering is the limit here\. It caps this card at PSA 9\./.test(r.split), 'centering is the limit');

  // 3. Quick Grade: two-photo ceiling explained; estimated centering labelled.
  r = await run({ ...base, deepGrade: false, photoCount: 2, confidence: 'medium', confidence_drivers: ['none'], centering_ceiling: 8, centering_source: 'estimated', creditsUsed: 1 },
    ['fs', 'bs', {}], false, false);
  ok(/Quick Grade uses 2 photos, so it tops out at moderate confidence\. Deep Grade with all four edges can reach high confidence\./.test(r.why), 'quick ceiling explained');
  ok(/Up to PSA 8\s+Estimated/.test(r.split), 'estimated centering labelled');

  // 4. Low confidence through a holder; unknown centering.
  r = await run({ ...base, deepGrade: true, photoCount: 6, confidence: 'low', confidence_drivers: ['holder_glare', 'blurry_photo'], centering_ceiling: null, centering_source: 'unknown' },
    ['fs', 'bs', { top: 'ts', bottom: 'bos' }], true, false);
  ok(r.conf === 'Low confidence' && /WHY LOW CONFIDENCE/.test(r.why), 'low confidence block');
  ok(/Holder glare\. Take the card out of its holder/.test(r.why) && /Blurry photo\. Hold the phone steady/.test(r.why), 'both drivers with fixes');
  ok(!/of 6 photos/.test(r.why), 'full photo set: no count item');
  ok(/Not measured/.test(r.split) && !/Centering is/.test(r.split), 'unknown centering: no claim either way');

  // 5. Escaping: an odd driver key cannot inject markup.
  const html = await page.evaluate(() => _gradeWhyConfidenceHtml({ confidence: 'medium', confidenceLabel: 'Moderate confidence', drivers: ['<img src=x onerror=alert(1)>'],
    driverLabel: k => k, photoCheck: null, isDeep: true, photoCount: 6 }));
  ok(!/<img/.test(html) && /&lt;img/.test(html), 'driver text escaped');
  ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
} finally { await b.close(); server.close(); }
console.log(`grade-result-explain-browser: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
