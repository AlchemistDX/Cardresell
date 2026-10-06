// Limiting-factor reconciliation: centering-only contradiction; defect caps keep model text.
import { readFileSync } from 'node:fs';
import { limitingFactorContradicts as c, limitingFactorClaim } from '../api/_limitingFactor.js';
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : (fail++, console.log('  FAIL', n)); };
// Live case 2026-10-06: crumpled Goodra V, 50/50 centering (ceiling 10), estimate 2.
check('crease cap kept', ['Multiple deep creases cap at PSA 2 despite 50/50 centering.', 'Deep creases caps at PSA 2.', 'Creases capped at PSA 2.']
  .every(t => !c(t, { centeringCeiling: 10, psaEstimate: 2 }).contradicts));
check('whitening cap kept', !c('Back corner whitening caps at PSA 8.', { centeringCeiling: 10, psaEstimate: 8 }).contradicts);
check('dent "a PSA 6" kept', !c('A dent on the surface makes this a PSA 6 at best.', { centeringCeiling: 9, psaEstimate: 6 }).contradicts);
// Original purpose: invented centering cap below measured centering is still rewritten.
check('false centering cap rewritten', c('Centering caps at PSA 6.', { centeringCeiling: 10, psaEstimate: 9 }).contradicts);
check('"psa 6 centering" rewritten', c('This is PSA 6 centering on the front.', { centeringCeiling: 10, psaEstimate: 10 }).contradicts);
check('true centering cap kept', !c('Off-center 60/40 front caps at PSA 9.', { centeringCeiling: 9, psaEstimate: 9 }).contradicts);
// Estimate disagreement still rewritten regardless of attribution.
check('claim 2+ off estimate rewritten', c('Creases cap at PSA 3.', { centeringCeiling: 10, psaEstimate: 8 }).contradicts);
check('no grade claim kept', !c('Corners are the limiting pillar.', { centeringCeiling: 10, psaEstimate: 9 }).contradicts);
check('empty kept', !c('', { centeringCeiling: 10, psaEstimate: 9 }).contradicts && !c(null, {}).contradicts);
check('unknown ceiling no centering rewrite', !c('Centering caps at PSA 6.', { centeringCeiling: null, psaEstimate: 6 }).contradicts);
check('claim parse', limitingFactorClaim('caps at PSA 7').grade === 7 && limitingFactorClaim('nothing').grade === null);
const src = readFileSync(new URL('../api/scan.js', import.meta.url), 'utf8');
check('scan uses helper', src.includes('limitingFactorContradicts(reconciledLimitingFactor'));
check('scan does not log model prose', !src.includes('model_said: reconciledLimitingFactor'));
console.log(`limiting-factor-reconcile: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
