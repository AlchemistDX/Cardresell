// Evidence provenance is independent of whether the CV job completed.
export function parseCenteringRatio(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(/^\s*(\d{1,3}(?:\.\d+)?)\s*\/\s*(\d{1,3}(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  if (a > 100 || b > 100 || Math.abs(a + b - 100) > 1) return null;
  return Math.max(a, b) / (a + b);
}

export function selectCenteringEvidence(lr, tb, cv) {
  const axis = (model, measured) => parseCenteringRatio(measured) != null
    ? { value: measured, source: 'measured' }
    : parseCenteringRatio(model) != null
      ? { value: model, source: 'model_estimated' } : { value: '', source: 'unknown' };
  const leftRight = axis(lr, cv?.leftRight), topBottom = axis(tb, cv?.topBottom);
  const sources = [leftRight.source, topBottom.source];
  const source = sources.every(s => s === 'measured') ? 'measured'
    : sources.includes('measured') ? 'mixed'
      : sources.includes('model_estimated') ? 'model_estimated' : 'unknown';
  return { leftRight, topBottom, source };
}

// These remain uncalibrated model weights, never observed outcome probabilities.
// Reconcile after ALL caps; omit contradictory/invalid distributions.
export function finalGradeDistribution(input, estimate) {
  if (!Number.isInteger(estimate) || estimate < 1 || estimate > 10) return [];
  const valid = (input || []).filter(x => Number.isInteger(x.grade) && x.grade >= 1 && x.grade <= 10
    && Number.isFinite(x.pct) && x.pct > 0).sort((a,b) => b.pct - a.pct);
  if (!valid.length) return [];
  const shift = estimate - valid[0].grade, merged = new Map();
  for (const x of valid) {
    const grade = Math.max(1, Math.min(10, x.grade + shift));
    merged.set(grade, (merged.get(grade) || 0) + x.pct);
  }
  const rows = [...merged].map(([grade,pct]) => ({grade,pct})).sort((a,b) => b.pct - a.pct || Math.abs(a.grade-estimate)-Math.abs(b.grade-estimate));
  if (rows[0].grade !== estimate) return [];
  const total = rows.reduce((sum,x) => sum+x.pct,0);
  const exact = rows.map(x => x.pct / total * 100);
  rows.forEach((x,i) => { x.pct = Math.floor(exact[i]); });
  const remainder = 100 - rows.reduce((sum,x) => sum+x.pct,0);
  const order = rows.map((_,i) => i).sort((a,b) => (exact[b]-rows[b].pct) - (exact[a]-rows[a].pct));
  for (let i=0;i<remainder;i++) rows[order[i]].pct++;
  return rows;
}
