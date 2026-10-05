// Grade model selection: default unchanged, allowlist-only override, reasoning params.
import { readFileSync } from 'node:fs';
import { gradeModelPrimary, isReasoningModel, DEFAULT_GRADE_MODEL, GRADE_FALLBACK_MODEL } from '../api/_gradeModel.js';
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : (fail++, console.log('  FAIL', name)); };
check('default is gpt-5', DEFAULT_GRADE_MODEL === 'gpt-5' && gradeModelPrimary(undefined) === 'gpt-5');
check('empty -> default', gradeModelPrimary('') === 'gpt-5' && gradeModelPrimary('   ') === 'gpt-5');
check('unknown -> default', gradeModelPrimary('gpt-9-ultra') === 'gpt-5' && gradeModelPrimary('o3') === 'gpt-5');
check('non-string -> default', gradeModelPrimary(42) === 'gpt-5' && gradeModelPrimary(null) === 'gpt-5');
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
console.log(`grade-model-selection: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
