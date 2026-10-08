import {scoreGradeBenchmark} from '../tools/score-grade-benchmark.mjs';
import {parseCenteringRatio,selectCenteringEvidence,finalGradeDistribution} from '../api/_gradeEvidence.js';
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
  && src.includes("const centeringWord = centeringEvidence.source === 'measured'"));
check('centering_source exposed', src.includes("centering_source: centeringEvidence.source"));
check('unmeasured image quality is unknown, not ok', !/image_quality: 'ok'/.test(src) && !src.includes("image_quality || 'ok'"));
// Label follows the final grade; centering-lowered grades explain the centering cap.
const helper = src.slice(src.indexOf('const PSA_GRADE_LABELS'), src.indexOf('\n}', src.indexOf('function gradeLabelFor')) + 2);
const label = new Function(helper + '; return gradeLabelFor;')();
check('label follows final grade', label(7) === 'Near Mint' && label(9) === 'Mint' && label(3) === 'Very Good' && label(10) === 'Gem Mint' && label(9.5) === 'Mint');
check('no label for missing grade', label(null) === '' && label(undefined) === '' && label('') === '');
check('response uses final-grade label', src.includes("grade_label:       gradeLabelFor(psaEstimate ?? cardInfo.psa_estimate) || cardInfo.grade_label || '',"));
check('centering-lowered grade rewrites stale prose', /const centeringLowered = modelPsa != null[\s\S]{0,200}modelPsa > psaEstimate;\s*\n\s*const proseIsLying = proseContradicts \|\| centeringLowered;/.test(src));

// 2026-10-06: centering header follows centering_source; share text says estimate.
{
  const idx2 = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const coreName = idx2.match(/\/js\/(core\.[0-9a-f]{8}\.js)/)[1];
  const cjs = readFileSync(new URL(`../js/${coreName}`, import.meta.url), 'utf8');
  check('centering header switches on centering_source', cjs.includes("data.centering_source === 'measured' ? 'MEASURED CENTERING"));
  check('share text never claims a real grade result', !/came back PSA|CardResell AI called it|AI graded my|pulled a PSA/.test(cjs));
  check('share title says Est. PSA', cjs.includes("_cardName + ' \u2014 Est. PSA '") || cjs.includes("_cardName + ' — Est. PSA '"));
}

for (const bad of ['', 'n/a', '150/50', '55/20', 'bad 55/45', '0/0', true, null]) check('invalid ratio refused: '+bad, parseCenteringRatio(bad) === null);
check('extreme valid ratio preserved', parseCenteringRatio('100/0') === 1);
check('decimal ratio accepted', parseCenteringRatio('55.5/44.5') === .555);
check('CV scores alone are not measured centering',selectCenteringEvidence('55/45','50/50',{}).source === 'model_estimated');
check('one CV axis is mixed',selectCenteringEvidence('55/45','50/50',{leftRight:'60/40'}).source === 'mixed');
check('both CV axes are measured',selectCenteringEvidence('70/30','70/30',{leftRight:'55/45',topBottom:'50/50'}).source === 'measured');
check('invalid CV axis cannot replace estimate',selectCenteringEvidence('55/45','50/50',{leftRight:'500/0'}).leftRight.value === '55/45');
check('missing evidence unknown',selectCenteringEvidence('','',null).source === 'unknown');
const distribution = finalGradeDistribution([{grade:10,pct:80},{grade:9,pct:20}],9);
check('final cap moves distribution peak', distribution[0].grade === 9);
check('distribution totals 100', distribution.reduce((s,x)=>s+x.pct,0) === 100);
check('invalid buckets refused',finalGradeDistribution([{grade:12,pct:100}],9).length === 0);
check('single boundary bucket normalized',finalGradeDistribution([{grade:1,pct:50}],1)[0].pct === 100);
check('no grade means no invented distribution',finalGradeDistribution([{grade:9,pct:100}],null).length === 0);

const baseline={card_id:'A',mode:'deep',attempt:1,status:'success',identity_correct:true,blind:true,app_grade:9,reference_type:'certified',reference_grader:'PSA',reference_grade:8,capture_type:'raw'};
const report=scoreGradeBenchmark([baseline,{...baseline,attempt:2,app_grade:8},{...baseline,card_id:'B',reference_type:'shop_estimate',app_grade:10},{...baseline,card_id:'C',status:'error',app_grade:null}]);
check('benchmark repeats do not inflate sample',report.baseline_attempts===3 && report.comparisons[0].n===1);
check('benchmark keeps error exclusions',report.baseline_errors===1 && report.comparisons[0].excluded===1);
check('benchmark MAE uses observed baseline',report.comparisons[0].mae===1);
check('benchmark separates shop agreement',report.comparisons[1].interpretation.startsWith('shop agreement'));
check('benchmark false tens counted',report.comparisons[1].false_tens===1);
check('benchmark repeat range',report.repeatability[0].range===1);
check('no data no invented accuracy',scoreGradeBenchmark([]).comparisons.length===0);
let refused=false;try{scoreGradeBenchmark([baseline,baseline]);}catch{refused=true;}check('duplicate attempts refused',refused);
check('nonblind excluded',scoreGradeBenchmark([{...baseline,blind:false}]).comparisons[0].n===0);
check('slab and raw separated',scoreGradeBenchmark([baseline,{...baseline,card_id:'D',capture_type:'slabbed'}]).comparisons.length===2);
console.log(`grade-evidence-honesty: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
