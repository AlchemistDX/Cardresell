// Decide whether the model's limiting_factor prose contradicts the measured
// numbers. Only CENTERING-attributed caps can contradict measured centering; a
// grade capped by creases, whitening, dents or scratches is not a centering
// claim and must keep the model's specific explanation.
const NON_CENTERING_DEFECT = /\b(crease|creas|fold|bend|bent|dent|whiten|chip|fray|scratch|scuff|abras|stain|tear|torn|water|warp|crimp|ding|print line|corner|edge|surface)/i;

export function limitingFactorClaim(text) {
  const lf = String(text || '').toLowerCase();
  const claim = lf.match(/\bcap(?:s|ped)?\s+(?:it\s+)?at\s+psa\s*(\d{1,2})/i)
             || lf.match(/psa\s*(\d{1,2})\s*centering/i)
             || lf.match(/projects?\s+as\s+(?:a\s+)?psa\s*(\d{1,2})/i)
             || lf.match(/\ba\s+psa\s*(\d{1,2})\b/i);
  const grade = claim ? parseInt(claim[1], 10) : null;
  const explicitCentering = /psa\s*\d{1,2}\s*centering/i.test(lf);
  const centeringAttributed = grade != null
    && (explicitCentering || (/center/i.test(lf) && !NON_CENTERING_DEFECT.test(lf)));
  return { grade, centeringAttributed };
}

export function limitingFactorContradicts(text, { centeringCeiling, psaEstimate }) {
  const { grade, centeringAttributed } = limitingFactorClaim(text);
  if (grade == null) return { contradicts: false, claimedGrade: null };
  const belowCentering = centeringAttributed && centeringCeiling != null && grade < centeringCeiling;
  const offEstimate = psaEstimate != null && Math.abs(grade - psaEstimate) >= 2;
  return { contradicts: belowCentering || offEstimate, claimedGrade: grade };
}
