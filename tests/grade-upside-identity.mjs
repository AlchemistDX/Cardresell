// Grading-upside prices the card the grade identified, not a name-only guess.
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : (fail++, console.log('  FAIL', n)); };
const idx = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = idx.match(/\/js\/(core\.[0-9a-f]{8}\.js)/)[1];
const js = readFileSync(new URL(`../js/${core}`, import.meta.url), 'utf8');
const i = js.indexOf('renderGradingUpside(upsideEl, pc, psa, psaGrade, data);');
const block = js.slice(js.lastIndexOf('(async () => {', i), i);
check('uses grade response set_name', block.includes('data.set_name'));
check('uses grade response card_number', block.includes('data.card_number'));
check('stale ID-scan record only used for the same card', block.includes('_sameCard ? ident.setName') && block.includes('_sameCard ? ident.number'));
check('no unconditional ident.setName', !/if \(ident\.setName\)/.test(block));
const pg = js.match(/const psaGrade = ([^;]+);/)[1];
const f = new Function('psa', `return ${pg};`);
check('PSA 3 button says 3', f(3) === 3);
check('PSA 9.5 stays 9, 10 stays 10, junk -> 1', f(9.5) === 9 && f(10) === 10 && f(undefined) === 1 && f(12) === 10);
const pc = readFileSync(new URL('../api/pricecharting.js', import.meta.url), 'utf8');
check('server: name-only TCG not exact match', pc.includes("const printingConfirmed = !!pcid || game === 'sports' || !!number;")
  && pc.includes('hasExactMatch: printingConfirmed'));
check('server: reason + field exposed', pc.includes("'printing not confirmed (no collector number)'") && pc.includes('matchedPriceKey: pickedKey, printingConfirmed,'));
console.log(`grade-upside-identity: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
