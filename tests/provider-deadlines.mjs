import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { identifyWithXimilar } from '../api/_ximilar.js';
import { observeProviderAttempt } from '../api/_providerUsage.js';
import { summarizeProviderUsage } from '../tools/provider-usage-report.mjs';

const original = { fetch, setTimeout, clearTimeout, log: console.log, warn: console.warn };
let cases = 0;
const observations = [], timers = new Set();
try {
  console.log = line => { if (line.startsWith('PROVIDER_USAGE ')) observations.push(JSON.parse(line.slice(15))); };
  console.warn = () => {};
  globalThis.setTimeout = fn => { const t = { fn }; timers.add(t); return t; };
  globalThis.clearTimeout = t => timers.delete(t);
  const stall = signal => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('body stalled'), { name: 'AbortError' })));
    assert.equal(timers.size, 1, 'deadline remains active after response headers');
    [...timers][0].fn();
  });
  for (const ok of [true, false]) {
    let calls = 0;
    globalThis.fetch = async (_, init) => { calls++; return { ok, status: ok ? 200 : 503,
      json: () => stall(init.signal), text: () => stall(init.signal) }; };
    const result = await identifyWithXimilar('fixture', 'image/jpeg', 'fixture');
    assert.equal(result.reason, 'timeout');
    assert.equal(calls, 1, 'ambiguous identification must not be resubmitted');
    assert.equal(observations.at(-1).reason, 'timeout');
    assert.equal(timers.size, 0);
    cases++;
  }
  const scan = readFileSync(new URL('../api/scan.js', import.meta.url), 'utf8');
  const source = scan.slice(scan.indexOf('    async function tryModel('), scan.indexOf('    const primaryModel = gradeModelPrimary('));
  const make = new Function('observeProviderAttempt', 'callModel', 'isDeepGrade', 'isGradeMode', 'visionContent', source + '; return tryModel;');
  let calls = 0;
  const run = make(observeProviderAttempt, async (_, signal) => {
    calls++; return { ok: true, status: 200, json: () => stall(signal) };
  }, false, true, [{ type: 'image_url' }]);
  await assert.rejects(run('gpt-5'), { name: 'AbortError' });
  assert.equal(calls, 1);
  assert.equal(timers.size, 0);
  assert.equal(observations.at(-1).reason, 'timeout');
  cases++;
  for (const reason of ['submit_timeout_ambiguous', 'submit_malformed', 'job_failed', 'job_timeout', 'poll_http_403']) {
    await observeProviderAttempt({ provider: 'ximilar', operation: 'card_grade', mode: 'deep_grade' }, async () => ({ ok: false, reason }));
    assert.equal(observations.at(-1).reason, reason.startsWith('poll_http') ? 'http' : reason);
    cases++;
  }
  const summary = summarizeProviderUsage(observations.map(JSON.stringify));
  assert.equal(summary.groups.find(g => g.key.includes('card_grade')).failure_reasons.job_timeout, 1);
  assert.equal(summary.attempts, 8);
  cases++;
} finally {
  Object.assign(globalThis, { fetch: original.fetch, setTimeout: original.setTimeout, clearTimeout: original.clearTimeout });
  console.log = original.log; console.warn = original.warn;
}
console.log(`provider-deadlines: ${cases} passed, 0 failed -- SUITE COMPLETE, exit=0`);
