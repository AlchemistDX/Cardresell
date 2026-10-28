// Server-only observations. No customer identifiers, prompts, images or raw errors.
// Usage is provider-reported, never inferred from a successful response.
import { randomUUID } from 'node:crypto';

const modes = new Set(['identify', 'grade', 'deep_grade']);
const operations = new Set(['tcg_id', 'sport_id', 'card_ocr_id', 'slab_id', 'card_grade', 'chat_completion']);
const models = new Set(['gpt-5', 'gpt-4o', 'gpt-6.1-sol', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-luna']);
const reasons = new Set(['http', 'empty', 'parse', 'parse_error', 'network', 'network_error',
  'timeout', 'no_records', 'no_card_detected', 'no_match', 'low_confidence', 'empty_grades',
  'record_error', 'invalid_response', 'unsupported_card_type', 'multiple_cards',
  'missing_input', 'missing_token', 'missing_image', 'submit_timeout_ambiguous',
  'submit_malformed', 'job_failed', 'job_timeout']);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const jobStatuses = new Set(['CREATED', 'PROCESSING', 'PENDING', 'QUEUED', 'DONE', 'ERROR', 'FAILED', 'CANCELLED', 'CANCELED']);
const httpStatus = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const responseIssues = new Set(['objects_missing', 'best_name_invalid', 'scores_missing', 'score_invalid', 'scores_unordered', 'alternative_name_invalid', 'close_candidate_missing']);

export async function observeProviderAttempt(meta, work) {
  const started = Date.now();
  const record = {
    event: 'provider_attempt', version: 1, attempt_id: randomUUID(),
    provider: meta.provider === 'openai' ? 'openai' : 'ximilar',
    operation: operations.has(meta.operation) ? meta.operation : 'unknown',
    mode: modes.has(meta.mode) ? meta.mode : 'unknown',
    model: models.has(meta.model) ? meta.model : null,
    input_images: count(meta.inputImages), http_status: null,
    prompt_tokens: null, cached_prompt_tokens: null, completion_tokens: null,
    reasoning_tokens: null, total_tokens: null,
    // Ximilar endpoints do not document a billed-unit field. Calls/images are
    // observable; their invoice credit usage and USD cost remain unknown.
    billed_units: null, cost_usd: null,
    // 2026-10-10: Ximilar identification match distance (lower = closer) and
    // gap to the second candidate, for threshold calibration. Numbers only.
    match_distance: null, match_gap: null,
    response_issue: null, score_count: null, alternative_count: null,
    // Async grading: submission HTTP success is not job completion. Keep the
    // last poll separate; never log provider payloads or arbitrary status text.
    job_status: null, poll_http_status: null, poll_count: null,
  };
  const observe = ({ status, usage, matchDistance, matchGap, responseIssue, scoreCount, alternativeCount, jobStatus, pollStatus, polls } = {}) => {
    if (httpStatus(status) !== null) record.http_status = status;
    if (record.provider === 'ximilar' && record.operation === 'card_grade') {
      if (jobStatus !== undefined) record.job_status = jobStatuses.has(jobStatus) ? jobStatus : 'UNKNOWN';
      if (pollStatus !== undefined) record.poll_http_status = httpStatus(pollStatus);
      if (polls !== undefined) record.poll_count = count(polls);
    }
    const dist = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 2 ? Math.round(v * 1000) / 1000 : null;
    if (record.provider === 'ximilar' && matchDistance !== undefined) record.match_distance = dist(matchDistance);
    if (record.provider === 'ximilar' && matchGap !== undefined) record.match_gap = dist(matchGap);
    if (record.provider === 'ximilar' && ['tcg_id', 'sport_id'].includes(record.operation)) {
      if (responseIssue !== undefined) record.response_issue = responseIssues.has(responseIssue) ? responseIssue : null;
      if (scoreCount !== undefined) record.score_count = count(scoreCount);
      if (alternativeCount !== undefined) record.alternative_count = count(alternativeCount);
    }
    if (record.provider !== 'openai' || !usage || typeof usage !== 'object') return;
    record.prompt_tokens = count(usage.prompt_tokens);
    record.completion_tokens = count(usage.completion_tokens);
    record.total_tokens = count(usage.total_tokens);
    const cached = count(usage.prompt_tokens_details?.cached_tokens);
    const reasoning = count(usage.completion_tokens_details?.reasoning_tokens);
    record.cached_prompt_tokens = cached !== null && record.prompt_tokens !== null && cached <= record.prompt_tokens ? cached : null;
    record.reasoning_tokens = reasoning !== null && record.completion_tokens !== null && reasoning <= record.completion_tokens ? reasoning : null;
  };
  try {
    const result = await work(observe);
    record.outcome = result?.ok === true ? 'success' : 'failure';
    record.reason = record.outcome === 'success' ? null
      : reasons.has(result?.reason) ? result.reason
      : /^(?:poll_)?http_\d{3}$/.test(result?.reason || '') ? 'http' : 'other';
    return result;
  } catch (error) {
    record.outcome = 'failure';
    record.reason = ['AbortError', 'TimeoutError'].includes(error?.name) ? 'timeout' : 'exception';
    throw error;
  } finally {
    record.duration_ms = Math.max(0, Date.now() - started);
    // Logging must never change results or interrupt a credit refund.
    try { console.log('PROVIDER_USAGE ' + JSON.stringify(record)); } catch {}
  }
}
