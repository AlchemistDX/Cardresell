// The post-scan "out of ID credits" nudge must count included + paid credits.
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : (fail++, console.log('  FAIL', n)); };
const idx = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = idx.match(/\/js\/(core\.[0-9a-f]{8}\.js)/)?.[1];
check('index references a core bundle', !!core);
const src = core ? readFileSync(new URL(`../js/${core}`, import.meta.url), 'utf8') : '';
const i = src.indexOf("showToast('Out of ID scan credits");
check('toast present', i > 0);
const block = src.slice(Math.max(0, i - 900), i);
const decl = block.match(/const remaining = ([^;]+);/)?.[1] || '';
check('remaining counts paid credits', decl.includes('window._idScanCredits'));
check('remaining counts included/welcome credits', decl.includes('window._freeIdLeft'));
// Behavioural: evaluate the expression with a Free user who has 0 paid / 14 included.
const remaining = new Function('window', `return ${decl};`)({ _idScanCredits: 0, _freeIdLeft: 14 });
check('free user with 14 included is not out', remaining === 14);
check('truly empty is zero', new Function('window', `return ${decl};`)({}) === 0);
console.log(`id-credit-toast: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
