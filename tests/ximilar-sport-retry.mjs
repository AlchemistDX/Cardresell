// 2026-10-10: the sports retry runs only on no_match (a card was detected but
// not matched). An empty photo (no_card_detected) must not cost a second call.
// Executes the shipped block from api/scan.js against a mock provider.
import { readFileSync } from 'node:fs';
import {scanIdentityReview} from '../api/_scanIdentityReview.js';
const src = readFileSync(new URL('../api/scan.js', import.meta.url), 'utf8');
const start = src.indexOf("    let xim = await identifyWithXimilar(");
const end = src.indexOf("    const tMs = Date.now() - t0;", start);
if (start < 0 || end < 0) throw Error('retry block not found');
const block = src.slice(start, end);
const gradeStart = src.indexOf('      let xim = await identifyWithXimilar(', end);
const gradeEnd = src.indexOf("      console.log('[scan] ximilar (grade-mode ident)", gradeStart);
if (gradeStart < 0 || gradeEnd < 0) throw Error('grade retry block not found');
const gradeBlock = src.slice(gradeStart, gradeEnd);
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : (fail++, console.log('  FAIL', n)); };
const AsyncFunction = (async () => {}).constructor;
async function run(tcg, sport, source=block, deep=false) {
  const calls = [];
  const modes = [];
  const identifyWithXimilar = async (_b, _m, _t, kind, mode='identify') => { calls.push(kind); modes.push(mode); return kind === 'tcg' ? tcg : sport; };
  const fn = new AsyncFunction('identifyWithXimilar', 'imageBase64', 'mimeType', 'ximilarToken', 'isDeepGrade', 'scanIdentityReview', source + '\nreturn xim;');
  const xim = await fn(identifyWithXimilar, 'AAAA', 'image/jpeg', 't', deep, scanIdentityReview);
  return { xim, calls, modes };
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
// Grade identification had retained the old empty-photo retry even after ID
// scans stopped it. Exercise both actual grade branches, not a copied policy.
for (const deep of [false,true]) {
  const mode=deep?'deep_grade':'grade';
  for (const reason of ['no_card_detected','http','timeout','network_error','low_confidence','no_records']) {
    r=await run({ok:false,reason},{ok:true,cardInfo:{card_name:'Must not be used'}},gradeBlock,deep);
    check(mode+' '+reason+': no second provider request',r.calls.join()==='tcg');
    check(mode+' '+reason+': original failure retained',!r.xim.ok && r.xim.reason===reason);
    check(mode+' '+reason+': usage keeps correct mode',r.modes.join()===mode);
  }
  r=await run({ok:false,reason:'no_match'},{ok:true,cardInfo:{card_name:'Sport'}},gradeBlock,deep);
  check(mode+': a detected unmatched card still tries sports',r.calls.join()==='tcg,sport' && r.xim.cardInfo.card_name==='Sport');
  check(mode+': both attempts keep the grade mode',r.modes.join()===mode+','+mode);
  r=await run({ok:false,reason:'no_match'},{ok:false,reason:'no_card_detected'},gradeBlock,deep);
  check(mode+': failed sports retry preserves existing grade identity fallback',!r.xim.ok && r.xim.reason==='no_match' && r.calls.length===2);
  r=await run({ok:true,cardInfo:{card_name:'Pikachu'}},null,gradeBlock,deep);
  check(mode+': successful TCG identity makes one request',r.calls.join()==='tcg' && r.xim.cardInfo.card_name==='Pikachu');
}
console.log(`ximilar-sport-retry: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
