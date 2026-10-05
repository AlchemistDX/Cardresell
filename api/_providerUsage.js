// Server-only observations. No customer identifiers, prompts, images or raw errors.
// Usage is provider-reported, never inferred from a successful response.
import { randomUUID } from 'node:crypto';

const modes = new Set(['identify', 'grade', 'deep_grade']);
const operations = new Set(['tcg_id', 'sport_id', 'card_grade', 'chat_completion']);
const models = new Set(['gpt-5', 'gpt-4o']);
const reasons = new Set(['http', 'empty', 'parse', 'parse_error', 'network', 'network_error',
  'timeout', 'no_records', 'no_card_detected', 'no_match', 'low_confidence', 'empty_grades',
  'missing_input', 'missing_token', 'missing_image']);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

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
  };
  const observe = ({ status, usage } = {}) => {
    if (Number.isInteger(status) && status >= 100 && status <= 599) record.http_status = status;
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
      : /^http_\d{3}$/.test(result?.reason || '') ? 'http' : 'other';
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
