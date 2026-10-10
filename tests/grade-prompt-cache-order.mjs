// 2026-10-10: grade requests must open with the identical static rules so
// OpenAI's prefix cache can apply. Uses the shipped block from api/scan.js.
import { buildVisionContent } from '../tools/grade-model-eval.mjs';
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : (fail++, console.log('  FAIL', n)); };
const base = { mimeType: 'image/jpeg', imageBase64: 'AAAA', backBase64: 'BBBB', isGradeMode: true };
const quick = buildVisionContent({ ...base, isDeepGrade: false });
const deep = buildVisionContent({ ...base, isDeepGrade: true, topEdgeBase64: 'T', bottomEdgeBase64: 'B', leftEdgeBase64: 'L', rightEdgeBase64: 'R' });
const front = buildVisionContent({ mimeType: 'image/jpeg', imageBase64: 'AAAA', isGradeMode: true, isDeepGrade: false });
for (const [name, v, n] of [['quick', quick, 2], ['deep', deep, 6], ['front-only', front, 1]]) {
  check(`${name}: static rules first`, v[0].type === 'text' && v[0].text.startsWith("You are a strict, professional trading card grader"));
  check(`${name}: per-request description second`, v[1].type === 'text' && v[1].text.startsWith('You are analyzing '));
  check(`${name}: photos last, in order`, v.slice(2).every(x => x.type === 'image_url') && v.length === 2 + n
    && v[2].image_url.url.endsWith('AAAA'));
  check(`${name}: static prefix is large enough to cache (>4,096 chars)`, v[0].text.length > 4096);
  check(`${name}: no per-request values in the static prefix`, !/You are analyzing|DEEP GRADE MODE —/.test(v[0].text));
}
check('static prefix identical across quick/deep/front-only', quick[0].text === deep[0].text && deep[0].text === front[0].text);
check('deep note travels in the per-request text', deep[1].text.includes('DEEP GRADE MODE') && !quick[1].text.includes('DEEP GRADE MODE'));
check('back image order preserved', quick[3].image_url.url.endsWith('BBBB') && deep[3].image_url.url.endsWith('BBBB'));
const id = buildVisionContent({ mimeType: 'image/jpeg', imageBase64: 'AAAA', isGradeMode: false, isDeepGrade: false });
check('identify layout unchanged (image then prompt)', id[0].type === 'image_url' && id[1].type === 'text');
console.log(`grade-prompt-cache-order: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
