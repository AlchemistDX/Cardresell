// 2026-10-10: Ximilar identify telemetry records match distance and gap for
// threshold calibration. Numbers only, bounded, never on OpenAI records.
import { observeProviderAttempt } from '../api/_providerUsage.js';
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : (fail++, console.log('  FAIL', n)); };
const logs = []; const orig = console.log;
async function rec(meta, obs, result = { ok: true }) {
  logs.length = 0; console.log = m => logs.push(String(m));
  try { await observeProviderAttempt(meta, async observe => { observe(obs); return result; }); } finally { console.log = orig; }
  return JSON.parse(logs.find(l => l.startsWith('PROVIDER_USAGE ')).slice(15));
}
const x = { provider: 'ximilar', operation: 'tcg_id', mode: 'identify', inputImages: 1 };
let r = await rec(x, { status: 200, matchDistance: 0.61234, matchGap: 0.04 }, { ok: false, reason: 'low_confidence' });
check('distance rounded to 3 dp', r.match_distance === 0.612);
check('gap recorded', r.match_gap === 0.04);
check('outcome unchanged', r.outcome === 'failure' && r.reason === 'low_confidence' && r.http_status === 200);
r = await rec(x, { status: 200, matchDistance: 0.2 });
check('missing gap stays null', r.match_distance === 0.2 && r.match_gap === null);
for (const bad of [-1, 3, NaN, Infinity, '0.4', null, {}]) {
  r = await rec(x, { matchDistance: bad, matchGap: bad });
  check(`rejects ${String(bad)}`, r.match_distance === null && r.match_gap === null);
}
r = await rec(x, { status: 200 });
check('no distance supplied stays null', r.match_distance === null);
r = await rec({ provider: 'openai', operation: 'chat_completion', mode: 'grade', model: 'gpt-6.1-sol' },
  { status: 200, matchDistance: 0.3, usage: { prompt_tokens: 5000, completion_tokens: 10, total_tokens: 5010, prompt_tokens_details: { cached_tokens: 3584 } } });
check('openai record never carries match fields', r.match_distance === null && r.match_gap === null);
check('openai cached tokens still recorded', r.cached_prompt_tokens === 3584 && r.prompt_tokens === 5000);
check('record has no image or identity fields', !/base64|email|uid|card_name/.test(JSON.stringify(r)));
console.log(`provider-match-distance: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
