// Match the evaluated production primary so missing/invalid configuration does
// not silently switch grading models. GRADE_MODEL_PRIMARY still supports an
// explicit allowlisted override; removing it restores this production default.
export const DEFAULT_GRADE_MODEL = 'gpt-6.1-sol';
export const GRADE_FALLBACK_MODEL = 'gpt-4o';
export const GRADE_MODEL_CANDIDATES = Object.freeze(['gpt-5', 'gpt-6.1-sol', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-luna']);

export function gradeModelPrimary(raw) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return GRADE_MODEL_CANDIDATES.includes(value) ? value : DEFAULT_GRADE_MODEL;
}

// Reasoning-family models take reasoning_effort + max_completion_tokens.
export function isReasoningModel(modelId) {
  return /^gpt-(5|6)(\.|-|$)/.test(String(modelId));
}
