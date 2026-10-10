// 2026-10-10: the sports retry runs only on no_match (a card was detected but
// not matched). An empty photo (no_card_detected) must not cost a second call.
// Executes the shipped block from api/scan.js against a mock provider.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../api/scan.js', import.meta.url), 'utf8');
const start = src.indexOf("    let xim = await identifyWithXimilar(");
const end = src.indexOf("    const tMs = Date.now() - t0;", start);
if (start < 0 || end < 0) throw Error('retry block not found');
const block = src.slice(start, end);
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : (fail++, console.log('  FAIL', n)); };
const AsyncFunction = (async () => {}).constructor;
async function run(tcg, sport) {
  const calls = [];
  const identifyWithXimilar = async (_b, _m, _t, kind) => { calls.push(kind); return kind === 'tcg' ? tcg : sport; };
  const fn = new AsyncFunction('identifyWithXimilar', 'imageBase64', 'mimeType', 'ximilarToken', block + '\nreturn xim;');
  const xim = await fn(identifyWithXimilar, 'AAAA', 'image/jpeg', 't');
  return { xim, calls };
}
let r = await run({ ok: false, reason: 'no_card_detected' }, { ok: true, cardInfo: {} });
check('no_card_detected: one paid call only', r.calls.join() === 'tcg');
check('no_card_detected: reason kept', r.xim.reason === 'no_card_detected');
r = await run({ ok: false, reason: 'no_match' }, { ok: true, cardInfo: { card_name: 'Sport' } });
check('no_match: sports retry runs', r.calls.join() === 'tcg,sport');
check('no_match: sports success returned', r.xim.ok && r.xim.cardInfo.card_name === 'Sport');
r = await run({ ok: false, reason: 'no_match' }, { ok: false, reason: 'no_card_detected' });
check('no_match then sports miss: latest reason kept', r.xim.reason === 'no_card_detected' && r.calls.length === 2);
r = await run({ ok: true, cardInfo: { card_name: 'Pikachu' } }, null);
check('tcg success: no sports call', r.calls.join() === 'tcg' && r.xim.ok);
for (const reason of ['http', 'timeout', 'low_confidence', 'no_records']) {
  r = await run({ ok: false, reason }, { ok: true });
  check(`${reason}: no sports call`, r.calls.join() === 'tcg' && r.xim.reason === reason);
}
console.log(`ximilar-sport-retry: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
