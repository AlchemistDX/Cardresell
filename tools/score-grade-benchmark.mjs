// Offline only: no provider requests, uploads or credits.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const grade = x => typeof x === 'number' && Number.isFinite(x) && x >= 1 && x <= 10;
export function scoreGradeBenchmark(rows) {
  if (!Array.isArray(rows)) throw Error('Expected an array of attempts');
  const seen = new Set(), groups = new Map(), first = new Map();
  for (const r of rows) {
    if (!r.card_id || !['quick','deep'].includes(r.mode) || !Number.isInteger(r.attempt) || r.attempt < 1
        || !['success','unresolved','error'].includes(r.status)
        || !['certified','shop_estimate','pending'].includes(r.reference_type)) throw Error('Invalid attempt identity/status/reference type');
    if (r.capture_type && !['raw','slabbed','unknown'].includes(r.capture_type)) throw Error('Invalid capture type');
    if (r.app_grade != null && !grade(r.app_grade)) throw Error('Invalid app grade');
    if (r.reference_grade != null && !grade(r.reference_grade)) throw Error('Invalid reference grade');
    const key = JSON.stringify([r.card_id,r.mode]), attemptKey=JSON.stringify([r.card_id,r.mode,r.attempt]);
    if (seen.has(attemptKey)) throw Error('Duplicate attempt: '+attemptKey);
    seen.add(attemptKey);
    if (!first.has(key) || r.attempt < first.get(key).attempt) first.set(key,r);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(r);
  }
  const baseline=[...first.values()];
  const summarize = sample => {
    const n=sample.length, predictedTen=sample.filter(r=>r.app_grade===10);
    return {n, exact:n?sample.filter(r=>r.app_grade===r.reference_grade).length/n:null,
      within_one:n?sample.filter(r=>Math.abs(r.app_grade-r.reference_grade)<=1).length/n:null,
      mae:n?sample.reduce((s,r)=>s+Math.abs(r.app_grade-r.reference_grade),0)/n:null,
      signed_error:n?sample.reduce((s,r)=>s+r.app_grade-r.reference_grade,0)/n:null,
      predicted_tens:predictedTen.length,
      false_tens:predictedTen.filter(r=>r.reference_grade<10).length,
      ten_precision:predictedTen.length?predictedTen.filter(r=>r.reference_grade===10).length/predictedTen.length:null};
  };
  const eligible=r=>r.status==='success' && r.identity_correct===true && r.blind===true && grade(r.app_grade) && grade(r.reference_grade);
  const report={attempts:rows.length,unique_cards:new Set(rows.map(r=>r.card_id)).size,baseline_attempts:baseline.length,
    baseline_errors:baseline.filter(r=>r.status==='error').length,
    baseline_unresolved:baseline.filter(r=>r.status==='unresolved').length,
    baseline_wrong_identity:baseline.filter(r=>r.identity_correct===false).length,
    eligible_blind_baselines:baseline.filter(eligible).length,
    comparisons:[],repeatability:[]};
  for (const mode of ['quick','deep']) for (const type of ['certified','shop_estimate']) {
    const graders=new Set(baseline.filter(r=>r.mode===mode&&r.reference_type===type).map(r=>String(r.reference_grader||'unspecified').toUpperCase()));
    for (const grader of graders) for (const capture of ['raw','slabbed','unknown']) {
      const all=baseline.filter(r=>r.mode===mode&&r.reference_type===type&&String(r.reference_grader||'unspecified').toUpperCase()===grader && (r.capture_type || 'unknown')===capture);
      if (!all.length) continue;
      const sample=all.filter(eligible);
      report.comparisons.push({mode,reference_type:type,reference_grader:grader,capture_type:capture,
        interpretation:type==='shop_estimate'?'shop agreement, not certified accuracy':grader==='PSA'?'blind PSA comparison':'cross-standard comparison, not PSA accuracy',
        baseline_attempts:all.length,excluded:all.length-sample.length,...summarize(sample)});
    }
  }
  for (const rs of groups.values()) if (rs.length>1) {
    const values=rs.filter(r=>r.status==='success'&&r.identity_correct===true&&grade(r.app_grade)).map(r=>r.app_grade);
    report.repeatability.push({card_id:rs[0].card_id,mode:rs[0].mode,attempts:rs.length,valid:values.length,
      range:values.length>1?Math.max(...values)-Math.min(...values):null});
  }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw Error('Usage: node tools/score-grade-benchmark.mjs attempts.json');
  console.log(JSON.stringify(scoreGradeBenchmark(JSON.parse(readFileSync(process.argv[2],'utf8'))),null,2));
}
