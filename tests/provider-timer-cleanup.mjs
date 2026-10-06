import assert from 'node:assert/strict';
import { identifyWithXimilar } from '../api/_ximilar.js';
import { gradeWithXimilar } from '../api/_ximilar_grade.js';
import { observeProviderAttempt } from '../api/_providerUsage.js';
import { summarizeProviderUsage } from '../tools/provider-usage-report.mjs';
import { readFileSync } from 'node:fs';

const original = { fetch: globalThis.fetch, setTimeout, clearTimeout, warn: console.warn, log: console.log };
let cases = 0;
const observations = [];
try {
  console.warn = () => {};
  console.log = line => { if (line.startsWith('PROVIDER_USAGE ')) observations.push(JSON.parse(line.slice(15))); };
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
      const record = observations.at(-1);
      assert.equal(record.event, 'provider_attempt');
      assert.equal(record.cost_usd, null);
      assert.equal(record.billed_units, null);
      assert.equal(record.provider, 'ximilar');
      assert.equal(record.http_status, ['network', 'abort'].includes(outcome) ? null : 503);
      cases++;
    }
  }

  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ records: [{
    _objects: [{ _identification: { best_match: { name: 'Minun' }, distances: [0.1, 0.8] } }],
    grades: { final: 9, corners: 9 },
  }] }) });
  assert.equal((await identifyWithXimilar('fixture', 'image/jpeg', 'fixture', 'sport', 'grade')).cardInfo.card_name, 'Minun');
  assert.equal(observations.at(-1).operation, 'sport_id');
  assert.equal(observations.at(-1).mode, 'grade');
  assert.equal(observations.at(-1).outcome, 'success');
  // Grading is an async job (sync endpoint retired); a job already DONE at submit needs no poll.
  globalThis.fetch = async url => ({ ok: true, status: 200, json: async () => (String(url).includes('/account/v2/request/')
    ? { id: 'job-fixture-0001', status: 'DONE', response: { records: [{ grades: { final: 9, corners: 9 } }] } } : {}) });
  assert.equal((await gradeWithXimilar(['front', 'back', 'ignored'], 'image/jpeg', 'fixture', 'deep_grade')).grades.final, 9);
  assert.equal(observations.at(-1).input_images, 2);
  assert.equal(observations.at(-1).mode, 'deep_grade');
  assert.equal(observations.at(-1).outcome, 'success');
  cases += 2;

  // Exercise the real shipped OpenAI attempt function, with only its network
  // boundary replaced. Each paid fallback must retain its own usage record.
  const scan = readFileSync(new URL('../api/scan.js', import.meta.url), 'utf8');
  const source = scan.slice(scan.indexOf('    async function tryModel('), scan.indexOf('    const primaryModel = gradeModelPrimary('));
  const run = new Function('observeProviderAttempt', 'callModel', 'isDeepGrade', 'isGradeMode', 'visionContent',
    source + '; return tryModel;');
  for (const outcome of ['success', 'empty', 'parse', 'http', 'network', 'bad_json']) {
    const usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 30 } };
    const invoke = run(observeProviderAttempt, async () => {
      if (outcome === 'network') throw new Error('SECRET_TOKEN user@example.com');
      return { ok: outcome !== 'http', status: outcome === 'http' ? 429 : 200,
        text: async () => 'SECRET_TOKEN', json: async () => {
          if (outcome === 'bad_json') throw Error('bad JSON');
          return { usage, choices: [{ message: { content: outcome === 'empty' ? '' : outcome === 'parse' ? 'private photo text' : '{"card_name":"Minun"}' } }] };
        } };
    }, true, true, [{ type: 'image_url' }, { type: 'image_url' }, { type: 'text' }]);
    const before = observations.length;
    if (['network', 'bad_json'].includes(outcome)) await assert.rejects(invoke('gpt-5'));
    else assert.equal((await invoke('gpt-5')).ok, outcome === 'success');
    assert.equal(observations.length, before + 1);
    const record = observations.at(-1);
    assert.equal(record.mode, 'deep_grade');
    assert.equal(record.input_images, 2);
    assert.equal(record.prompt_tokens, ['http', 'network', 'bad_json'].includes(outcome) ? null : 100);
    assert.equal(record.outcome, outcome === 'success' ? 'success' : 'failure');
    assert.doesNotMatch(JSON.stringify(record), /SECRET_TOKEN|user@|Minun|private photo/);
    cases++;
  }
  const result = { ok: true, value: 'untouched' };
  assert.equal(await observeProviderAttempt({ provider: 'openai', mode: 'email@example.com', model: 'secret', operation: 'secret' }, async observe => {
    observe({ status: '200', usage: { prompt_tokens: -1, completion_tokens: '50', total_tokens: NaN } });
    return result;
  }), result);
  const invalid = observations.at(-1);
  assert.equal(invalid.mode, 'unknown');
  assert.equal(invalid.model, null);
  assert.equal(invalid.prompt_tokens, null);
  assert.equal(invalid.completion_tokens, null);
  assert.equal(invalid.total_tokens, null);
  cases++;
  const before = observations.length;
  await identifyWithXimilar('', '', '');
  await gradeWithXimilar([], '', '');
  assert.equal(observations.length, before, 'no provider attempt for missing input');
  cases++;
  const report = summarizeProviderUsage([...observations.map(JSON.stringify), JSON.stringify(observations[0]), 'unrelated log']);
  assert.equal(report.attempts, observations.length);
  assert.equal(report.duplicates, 1);
  assert.equal(report.ignored, 1);
  const openai = report.groups.find(group => group.key === 'openai/chat_completion/deep_grade/gpt-5');
  assert.equal(openai.attempts, 6);
  assert.equal(openai.usage.prompt_tokens.reported_total, 300, 'retain usage on empty/parse failure');
  assert.equal(openai.usage.prompt_tokens.unknown_attempts, 3, 'missing usage is unknown, not free');
  assert.equal(openai.cost_usd, null);
  cases++;
  console.log = () => { throw Error('log unavailable'); };
  assert.equal(await observeProviderAttempt({}, async () => result), result);
  const failure = Error('provider failure');
  await assert.rejects(observeProviderAttempt({}, async () => { throw failure; }), error => error === failure);
  cases++;
} finally {
  globalThis.fetch = original.fetch;
  globalThis.setTimeout = original.setTimeout;
  globalThis.clearTimeout = original.clearTimeout;
  console.warn = original.warn;
  console.log = original.log;
}
console.log(`Provider timers and usage: ${cases} passed, 0 failed -- SUITE COMPLETE, exit=0`);
