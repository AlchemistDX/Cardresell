// Grade requests must keep the evaluated production default when configuration
// is absent or invalid, while preserving explicit overrides and fallback.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gradeModelPrimary, isReasoningModel, DEFAULT_GRADE_MODEL, GRADE_FALLBACK_MODEL } from '../api/_gradeModel.js';
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : (fail++, console.log('  FAIL', name)); };
check('default matches evaluated production model', DEFAULT_GRADE_MODEL === 'gpt-6.1-sol' && gradeModelPrimary(undefined) === 'gpt-6.1-sol');
check('empty -> default', gradeModelPrimary('') === 'gpt-6.1-sol' && gradeModelPrimary('   ') === 'gpt-6.1-sol');
check('unknown -> default', gradeModelPrimary('gpt-9-ultra') === 'gpt-6.1-sol' && gradeModelPrimary('o3') === 'gpt-6.1-sol');
check('non-string -> default', gradeModelPrimary(42) === 'gpt-6.1-sol' && gradeModelPrimary(null) === 'gpt-6.1-sol');
for (const m of ['gpt-6.1-sol', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-luna', 'gpt-5'])
  check(`allowlisted ${m}`, gradeModelPrimary(m) === m && gradeModelPrimary(` ${m.toUpperCase()}\n`) === m);
check('fallback gpt-4o', GRADE_FALLBACK_MODEL === 'gpt-4o');
for (const m of ['gpt-5', 'gpt-6.1-sol', 'gpt-5.6-terra', 'gpt-6-luna', 'gpt-5.6-sol']) check(`reasoning ${m}`, isReasoningModel(m));
for (const m of ['gpt-4o', 'gpt-4.1', 'gpt-50x', '']) check(`non-reasoning ${m || 'empty'}`, !isReasoningModel(m));
const src = readFileSync(new URL('../api/scan.js', import.meta.url), 'utf8');
check('scan uses selector', src.includes('gradeModelPrimary(process.env.GRADE_MODEL_PRIMARY)'));
check('scan has no hardcoded primary attempt', !src.includes("tryModel('gpt-5')"));
check('scan uses reasoning helper', src.includes('const isGpt5 = isReasoningModel(modelId);'));
const usage = readFileSync(new URL('../api/_providerUsage.js', import.meta.url), 'utf8');
check('telemetry labels candidates', ['gpt-6.1-sol', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-luna'].every(m => usage.includes(`'${m}'`)));

// Exercise the shipped request and fallback block with an injected transport.
// No provider credentials, network requests, or customer credits are used.
const start = src.indexOf('    async function callModel(');
const end = src.indexOf('\n    if (!attempt.ok) {\n      console.error(\'Both models failed:', start);
assert.ok(start >= 0 && end > start, 'grade request block found');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction('fetch', 'process', 'console', 'observeProviderAttempt',
  'gradeModelPrimary', 'GRADE_FALLBACK_MODEL', 'isReasoningModel', 'openaiKey',
  'visionContent', 'isGradeMode', 'isDeepGrade',
  src.slice(start, end) + '\nreturn { attempt, modelUsed };');
const photos = [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,fixture', detail: 'high' } }];
const card = { card_name: 'Fixture card', psa_estimate: 8 };
async function request(raw, deep = false, firstFailure = '') {
  const sent = [];
  const result = await run(async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(init.method, 'POST');
    assert.ok(init.signal instanceof AbortSignal);
    sent.push(JSON.parse(init.body));
    const failure = sent.length === 1 ? firstFailure : '';
    return {
      ok: failure !== 'http', status: failure === 'http' ? 503 : 200,
      text: async () => 'fixture error',
      json: async () => ({ choices: [{ message: { content: failure === 'empty' ? ''
        : failure === 'parse' ? 'invalid fixture response' : JSON.stringify(card) } }] }),
    };
  }, { env: { GRADE_MODEL_PRIMARY: raw } }, { warn() {} },
  async (_, work) => work(() => {}), gradeModelPrimary, GRADE_FALLBACK_MODEL,
  isReasoningModel, 'fixture-key', photos, true, deep);
  return { ...result, sent };
}
for (const raw of [undefined, '', '   ', 'not-a-model', 42, null, ' GPT-6.1-SOL\n']) {
  for (const deep of [false, true]) {
    const result = await request(raw, deep);
    assert.equal(result.sent.length, 1, 'successful primary must not call fallback');
    assert.equal(result.modelUsed, 'gpt-6.1-sol');
    assert.deepEqual(result.sent[0], { model: 'gpt-6.1-sol',
      messages: [{ role: 'user', content: photos }], reasoning_effort: 'low',
      max_completion_tokens: deep ? 5000 : 4000 });
    assert.deepEqual(result.attempt.cardInfo, card);
    pass++;
  }
}
for (const failure of ['http', 'empty', 'parse']) {
  for (const deep of [false, true]) {
    const result = await request(undefined, deep, failure);
    assert.deepEqual(result.sent.map(body => body.model), ['gpt-6.1-sol', 'gpt-4o']);
    assert.equal(result.sent[1].max_tokens, deep ? 700 : 500);
    assert.equal(result.sent[1].reasoning_effort, undefined);
    assert.equal(result.sent[1].max_completion_tokens, undefined);
    assert.equal(result.modelUsed, 'gpt-4o');
    assert.deepEqual(result.attempt.cardInfo, card);
    pass++;
  }
}
console.log(`grade-model-selection: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
