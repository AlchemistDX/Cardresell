import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolveCoreBundle } from './_assetRefs.mjs';

const canonical = readFileSync(new URL('../js/photo-qc.js', import.meta.url), 'utf8');
const bundle = readFileSync(resolveCoreBundle().path, 'utf8');
const start = bundle.indexOf('// photo-qc.js (');
const end = bundle.indexOf('})();', start) + 5;
assert(start >= 0 && end > start, 'shipped photo QC module exists');
let cases = 0;
for (const source of [canonical, bundle.slice(start, end)]) {
  for (const mode of ['fast', 'rejected', 'throws', 'absent', 'unreadable']) {
    let created = 0, revoked = 0, images = 0, closed = 0;
    const bitmap = { width: 100, height: 100, close() { closed++; } };
    const context = {
      window: {}, console: { warn() {} },
      URL: { createObjectURL() { created++; return 'blob:fixture'; }, revokeObjectURL() { revoked++; } },
      Image: class {
        constructor() { images++; this.width = 100; this.height = 100; }
        set src(value) { queueMicrotask(() => mode === 'unreadable' ? this.onerror(Error('decode')) : this.onload()); }
      },
      // Canvas analysis isn't involved in decoder selection. Its existing
      // nonfatal behavior is retained; small dimensions avoid the blur pass.
      document: { createElement() { throw Error('canvas outside fixture'); } },
    };
    if (mode !== 'absent') context.createImageBitmap = () => {
      if (mode === 'throws') throw Error('unsupported decoder');
      return mode === 'fast' ? Promise.resolve(bitmap) : Promise.reject(Error('unsupported format'));
    };
    vm.runInNewContext(source, context);
    const result = await context.window.CardResellPhotoQC.check({});
    assert.deepEqual(Array.from(result.reasons), [mode === 'unreadable' ? 'unreadable' : 'low_resolution']);
    assert.equal(images, mode === 'fast' ? 0 : 1);
    assert.equal(created, images);
    assert.equal(revoked, created, 'all fallback object URLs released');
    assert.equal(closed, mode === 'fast' ? 1 : 0);
    cases++;
  }
}
console.log(`Photo decoder fallback: ${cases} passed, 0 failed -- SUITE COMPLETE, exit=0`);
