// Photo check before a grade is charged (2026-10-11). Real browser.
// Every photo about to be sent is measured on the device; a flagged photo is
// named with its reason and can be retaken, and nothing is sent (no credit)
// until the seller retakes or chooses "Grade anyway".
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
const b = await chromium.launch({ executablePath: process.env.CR_CHROMIUM || undefined, args: ['--no-sandbox'] });
try {
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => localStorage.setItem('cs_landing_seen', '1'));
  await page.route('**/*', r => { const u = r.request().url(); if (!u.startsWith(origin) || u.includes('/api/')) return r.fulfill({ status: 204, body: '' }); return r.continue(); });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof submitGradeScan === 'function' && typeof _gradePhotoCheckAll === 'function', null, { timeout: 30000 });
  const P = { fs: fx('front-sharp.jpg'), bs: fx('back-sharp.jpg'), fsoft: fx('front-soft.jpg'), fdark: fx('front-dark.jpg'), fglare: fx('front-glare.jpg'),
    ts: fx('top-sharp.jpg'), tsoft: fx('top-soft.jpg'), bos: fx('bottom-sharp.jpg'), bosoft: fx('bottom-soft.jpg') };
  await page.evaluate((P) => {
    window.__P = P; window.__sent = []; window.__retakes = [];
    window.googleUser = { sub: 'test-user', email: 't@example.com' }; window._googleIdToken = 'tok';
    window.cardResellScanRequest = async (url, opts) => { window.__sent.push(JSON.parse(opts.body)); return { status: 503, ok: false, json: async () => ({ error: 'stubbed' }) }; };
    window._startGradeEdgeCapture = (e) => window.__retakes.push(e);
    window.__set = (front, back, edges, deep) => { window._gradeFrontBase64 = P[front]; window._gradeBackBase64 = P[back];
      window._gradeEdges = Object.fromEntries(Object.entries(edges).map(([k, v]) => [k, P[v]])); window._gradeIsDeep = deep; };
    document.getElementById('scanOverlay').style.display = 'flex';
  }, P);
  const panel = () => page.evaluate(() => ({ status: document.getElementById('scanStatus').textContent,
    rows: [...document.querySelectorAll('#scanResult strong')].map(n => n.textContent + ': ' + n.nextSibling.textContent),
    buttons: [...document.querySelectorAll('#scanResult button')].map(n => n.textContent), sent: window.__sent.length }));

  // Metrics agree with the calibration (sharp hundreds, blurred tens).
  const m = await page.evaluate(async () => { const out = {}; for (const k of ['fs', 'bs', 'fsoft', 'ts', 'tsoft', 'bos', 'bosoft', 'fdark', 'fglare']) out[k] = await _gradePhotoMetrics(window.__P[k]); return out; });
  console.log('metrics', JSON.stringify(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [Math.round(v.sharp), Math.round(v.mean), +v.glare.toFixed(3)]]))));
  ok(m.fs.sharp > 200 && m.bs.sharp > 200, 'sharp faces measure well above the face limit');
  ok(m.fsoft.sharp < 60, 'blurred face below the face limit');
  ok(m.ts.sharp > 60 && m.bos.sharp > 60, 'sharp edge strips well above the edge limit');
  ok(m.tsoft.sharp < 25 && m.bosoft.sharp < 25, 'blurred edge strips below the edge limit');
  ok(m.fdark.mean < 45 && m.fglare.glare > .05, 'dark and glare copies measured');

  // 1. All sharp Deep Grade: sent straight away with the check attached.
  await page.evaluate(() => { window.__set('fs', 'bs', { top: 'ts', bottom: 'bos' }, true); window._gradePhotoAccepted = null; });
  await page.evaluate(() => submitGradeScan(true));
  let s = await page.evaluate(() => window.__sent.slice(-1)[0]);
  ok((await page.evaluate(() => window.__sent.length)) === 1, 'all-sharp deep grade sent once');
  ok(s && s.deepGrade === true && s.captureMeta && Object.keys(s.captureMeta.photoCheck).join() === 'front,back,top,bottom', 'photo check attached for the 4 photos');
  ok(s && Object.values(s.captureMeta.photoCheck).every(r => r.flags.length === 0 && r.accepted === false), 'no flags on sharp photos');

  // 2. Soft front + soft top edge: nothing sent; both named with a reason.
  await page.evaluate(() => window.__set('fsoft', 'bs', { top: 'tsoft', bottom: 'bos' }, true));
  await page.evaluate(() => submitGradeScan(true));
  let p = await panel();
  ok(p.sent === 1, 'flagged photos: nothing sent, no credit');
  ok(/Check these photos before grading/.test(p.status) && /No credits used yet/.test(p.status), 'check screen explains no credits used');
  ok(p.rows.join('|') === 'Front: Soft focus|Top edge: Soft focus', 'flagged rows: ' + p.rows.join('|'));
  ok(p.buttons.filter(t => t === 'Retake').length === 2 && p.buttons.includes('Grade anyway — 2 credits') && p.buttons.includes('Back to edge photos'), 'retake, grade-anyway and back buttons');

  // 3. Retake on the edge row goes to that edge's capture.
  await page.evaluate(() => [...document.querySelectorAll('#scanResult button')].filter(b => b.textContent === 'Retake')[1].click());
  ok((await page.evaluate(() => window.__retakes.join())) === 'top', 'edge retake opens that edge');

  // 4. Grade anyway: sent once, marked accepted with the flags.
  await page.evaluate(() => window.__set('fsoft', 'bs', { top: 'tsoft', bottom: 'bos' }, true));
  await page.evaluate(() => submitGradeScan(true));
  await page.evaluate(() => [...document.querySelectorAll('#scanResult button')].find(b => /Grade anyway/.test(b.textContent)).click());
  await page.waitForFunction(() => window.__sent.length === 2, null, { timeout: 10000 });
  s = await page.evaluate(() => window.__sent[1]);
  ok(s.captureMeta.photoCheck.front.flags.join() === 'soft' && s.captureMeta.photoCheck.front.accepted === true, 'grade anyway sends with front flagged and accepted');
  ok(s.captureMeta.photoCheck.top.flags.join() === 'soft' && s.captureMeta.photoCheck.bottom.flags.length === 0, 'per-photo flags kept');
  ok(s.topEdgeBase64 && s.bottomEdgeBase64 && !s.leftEdgeBase64, 'only captured edges sent');

  // 5. Same photos again: not asked twice. A replaced photo is checked again.
  await page.evaluate(() => submitGradeScan(true));
  ok((await page.evaluate(() => window.__sent.length)) === 3, 'accepted set not asked twice');
  await page.evaluate(() => window.__set('fsoft', 'bs', { top: 'ts', bottom: 'bos' }, true));
  await page.evaluate(() => submitGradeScan(true));
  p = await panel();
  ok(p.sent === 3 && p.rows.join('|') === 'Front: Soft focus', 'changed set is checked again; only the soft front left');

  // 6. Quick Grade: dark and glare named; 1-credit wording; edges never checked.
  await page.evaluate(() => window.__set('fdark', 'bs', { top: 'tsoft' }, false));
  await page.evaluate(() => submitGradeScan(false));
  p = await panel();
  ok(p.sent === 3 && p.rows.join('|') === 'Front: Too dark' && p.buttons.includes('Grade anyway — 1 credit') && p.buttons.includes('Back to review'), 'quick dark: ' + p.rows.join('|'));
  await page.evaluate(() => window.__set('fglare', 'bs', {}, false));
  await page.evaluate(() => submitGradeScan(false));
  p = await panel();
  ok(p.rows.join('|') === 'Front: Strong glare', 'quick glare: ' + p.rows.join('|'));
  await page.evaluate(() => window.__set('fs', 'bs', {}, false));
  await page.evaluate(() => submitGradeScan(false));
  s = await page.evaluate(() => window.__sent.slice(-1)[0]);
  ok((await page.evaluate(() => window.__sent.length)) === 4 && !s.deepGrade && Object.keys(s.captureMeta.photoCheck).join() === 'front,back', 'sharp quick grade sent straight away');
  ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
} finally { await b.close(); server.close(); }
// Server keeps only whitelisted numbers/flags from the client check.
const scan = readFileSync(join(root, 'api/scan.js'), 'utf8');
ok(/filter\(f => \['small', 'dark', 'bright', 'glare', 'soft'\]\.includes\(f\)\)/.test(scan) && scan.includes('photo_check: _pc'), 'server logs a sanitised photo check');
console.log(`grade-photo-check-browser: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
