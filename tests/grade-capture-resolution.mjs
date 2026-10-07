// Grading capture resolution / crop margin / body budget, run against the
// shipped bundle's real compressImage + _gradeCaptureSpec with a simulated
// canvas whose JPEG size scales with pixels x quality.
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : (fail++, console.log('  FAIL', n, d)); };
const idx = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = idx.match(/\/js\/(core\.[0-9a-f]{8}\.js)/)[1];
const js = readFileSync(new URL(`../js/${core}`, import.meta.url), 'utf8');
const grab = name => { const i = js.indexOf(`function ${name}(`); let d = 0, j = js.indexOf('{', i);
  for (let k = j; k < js.length; k++) { if (js[k] === '{') d++; else if (js[k] === '}' && --d === 0) return js.slice(i, k + 1); } };
check('no grading call left at 1000 px', !/compressImage\(file, 1000\)/.test(js));
check('front/back/edge use the capture spec', (js.match(/compressImage\(file, \.\.\._gradeCaptureSpec\('face'\)\)/g) || []).length === 2
  && js.includes("compressImage(file, ..._gradeCaptureSpec('edge'))"));
function env({ W = 3024, H = 4032, bounds = { x: 400, y: 500, w: 2200, h: 3070 }, bytesPerPx = 0.2 } = {}) {
  const drawn = [];
  class Canvas { constructor() { this.width = 0; this.height = 0; }
    getContext() { const c = this; return { drawImage: (...a) => drawn.push({ canvas: c, args: a }), getImageData: () => ({ data: [] }) }; }
    toDataURL(_t, q) { const bytes = this.width * this.height * bytesPerPx * (q / 0.85) ** 2;
      return 'data:image/jpeg;base64,' + 'A'.repeat(Math.round(bytes * 4 / 3)); } }
  const window = { CardResellFastPath: { detectCardBounds: () => ({ ...bounds }) } };
  const document = { createElement: () => new Canvas() };
  class Image { set src(_) { this.naturalWidth = W; this.naturalHeight = H; setTimeout(() => this.onload(), 0); } }
  const URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  const performance = { now: () => 0 }; const console = { log() {}, warn() {} };
  const f = new Function('window', 'document', 'Image', 'URL', 'performance', 'console',
    grab('_gradeCaptureSpec') + '\n' + grab('compressImage') + '\nreturn { spec: _gradeCaptureSpec, compress: compressImage };');
  return { ...f(window, document, Image, URL, performance, console), window, drawn };
}
// Deep Grade face photo
{ const e = env(); e.window._gradeIsDeep = true;
  const b64 = await e.compress({}, ...e.spec('face'));
  const crop = e.drawn.find(d => d.args.length === 9);
  const out = e.drawn[e.drawn.length - 1].canvas;
  check('deep face short side ~2000 px', Math.min(out.width, out.height) >= 1900, `${out.width}x${out.height}`);
  check('deep face within 1.45 MB budget', b64.length <= 1450000, b64.length);
  check('crop widened by 3% each side', crop && crop.args[1] === 400 - 66 && crop.args[2] === 500 - 92 && crop.args[3] === 2200 + 132,
    crop && crop.args.slice(1, 5).join(','));
}
// Budget fallback: very detailed photo must still fit
{ const e = env({ bytesPerPx: 1.2 }); e.window._gradeIsDeep = true;
  const b64 = await e.compress({}, ...e.spec('face'));
  check('noisy photo reduced to fit budget', b64.length <= 1450000, b64.length); }
// Crop padding clamps at image borders
{ const e = env({ bounds: { x: 2, y: 3, w: 3020, h: 4027 } }); e.window._gradeIsDeep = true;
  await e.compress({}, ...e.spec('face'));
  const crop = e.drawn.find(d => d.args.length === 9);
  check('padding clamped inside frame', crop.args[1] === 0 && crop.args[2] === 0 && crop.args[1] + crop.args[3] <= 3024 && crop.args[2] + crop.args[4] <= 4032); }
// Quick Grade and edges
{ const e = env(); e.window._gradeIsDeep = false;
  const b64 = await e.compress({}, ...e.spec('face')); const out = e.drawn[e.drawn.length - 1].canvas;
  check('quick face long side 1600 (short >= 768 for GPT high detail)', Math.max(out.width, out.height) === 1600 && Math.min(out.width, out.height) >= 768);
  check('quick face within 700 KB', b64.length <= 700000); }
{ const e = env(); e.window._gradeIsDeep = true;
  const b64 = await e.compress({}, ...e.spec('edge'));
  check('edge photo within 250 KB', b64.length <= 250000, b64.length); }
// Default callers (ID scan) unchanged: no padding, no budget
{ const e = env();
  await e.compress({}, 1200, { skipCrop: false });
  const crop = e.drawn.find(d => d.args.length === 9);
  check('non-grading callers keep original crop', crop.args[1] === 400 && crop.args[3] === 2200); }
check('worst-case Deep body under 4.5 MB', 2 * 1450000 + 4 * 250000 + 20000 < 4.5 * 1024 * 1024);
console.log(`grade-capture-resolution: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
