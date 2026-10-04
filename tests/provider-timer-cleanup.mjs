import assert from 'node:assert/strict';
import { identifyWithXimilar } from '../api/_ximilar.js';
import { gradeWithXimilar } from '../api/_ximilar_grade.js';

const original = { fetch: globalThis.fetch, setTimeout, clearTimeout, warn: console.warn };
let cases = 0;
try {
  console.warn = () => {};
  for (const invoke of [() => identifyWithXimilar('fixture', 'image/jpeg', 'fixture'),
    () => gradeWithXimilar(['fixture'], 'image/jpeg', 'fixture')]) {
    for (const outcome of ['success', 'http', 'network', 'abort']) {
      const active = new Set();
      globalThis.setTimeout = fn => { const timer = { fn }; active.add(timer); return timer; };
      globalThis.clearTimeout = timer => active.delete(timer);
      globalThis.fetch = async () => {
        if (outcome === 'network') throw Error('synthetic network failure');
        if (outcome === 'abort') throw Object.assign(Error('synthetic deadline'), { name: 'AbortError' });
        return { ok: outcome === 'success', status: 503, text: async () => '', json: async () => ({ records: [] }) };
      };
      await invoke();
      assert.equal(active.size, 0, `${outcome} must clear its request timer`);
      cases++;
    }
  }
} finally {
  globalThis.fetch = original.fetch;
  globalThis.setTimeout = original.setTimeout;
  globalThis.clearTimeout = original.clearTimeout;
  console.warn = original.warn;
}
console.log(`Provider timer cleanup: ${cases} passed, 0 failed -- SUITE COMPLETE, exit=0`);
