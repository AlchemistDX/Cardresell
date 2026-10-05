// Grade-mode OpenAI model selection. Default is unchanged (gpt-5). An operator
// may select an evaluated replacement through GRADE_MODEL_PRIMARY; anything not
// on this allowlist falls back to the default rather than an arbitrary model.
// gpt-5-2025-08-07 API shutdown: 2026-12-11 (OpenAI deprecations page).
export const DEFAULT_GRADE_MODEL = 'gpt-5';
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
