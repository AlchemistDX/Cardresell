// Poor visibility lowers confidence, never the grade; "measured" requires a measurement.
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : (fail++, console.log('  FAIL', n)); };
const src = readFileSync(new URL('../api/scan.js', import.meta.url), 'utf8');
check('no worst-case interpretation rule', !/WORST-case reasonable/.test(src));
check('no lower-the-grade-for-poor-photos rule', !/lower confidence AND lower the grade/.test(src));
check('cannot-inspect-is-not-damage rule present', src.includes('CANNOT INSPECT IS NOT DAMAGE'));
check('no through-plastic cap at 8 in prompt', !/CAPPED at 8/.test(src));
check('no through-plastic server cap at 8', !/psaEstimate = 8;/.test(src));
check('through-plastic still blocks Gem Mint only', /psaEstimate > 9\) \{\s*\n\s*console\.warn\('\[scan\] through-plastic: Gem Mint unverifiable/.test(src));
check('through-plastic keeps low confidence + not worth grading', /throughPlastic\) \{[\s\S]{0,200}confidence = 'low';[\s\S]{0,200}worth_grading = false/.test(src));
check('no unsupported PSA population rate', !/5–10% of modern submissions/.test(src));
check('limiting factor never says Measured for GPT centering', !src.includes('`Measured centering (')
  && src.includes("const centeringWord = cvSource === 'ximilar' ? 'Measured' : 'Estimated';"));
check('centering_source exposed', src.includes("centering_source: cvSource === 'ximilar' ? 'measured' : 'model_estimated'"));
check('unmeasured image quality is unknown, not ok', !/image_quality: 'ok'/.test(src) && !src.includes("image_quality || 'ok'"));
// Label follows the final grade; centering-lowered grades explain the centering cap.
const helper = src.slice(src.indexOf('const PSA_GRADE_LABELS'), src.indexOf('\n}', src.indexOf('function gradeLabelFor')) + 2);
const label = new Function(helper + '; return gradeLabelFor;')();
check('label follows final grade', label(7) === 'Near Mint' && label(9) === 'Mint' && label(3) === 'Very Good' && label(10) === 'Gem Mint' && label(9.5) === 'Mint');
check('no label for missing grade', label(null) === '' && label(undefined) === '' && label('') === '');
check('response uses final-grade label', src.includes("grade_label:       gradeLabelFor(psaEstimate ?? cardInfo.psa_estimate) || cardInfo.grade_label || '',"));
check('centering-lowered grade rewrites stale prose', /const centeringLowered = modelPsa != null[\s\S]{0,200}modelPsa > psaEstimate;\s*\n\s*const proseIsLying = proseContradicts \|\| centeringLowered;/.test(src));
console.log(`grade-evidence-honesty: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
