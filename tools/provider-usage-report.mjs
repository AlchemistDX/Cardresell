// Usage: node tools/provider-usage-report.mjs < runtime-log-export.ndjson
// Accepts raw PROVIDER_USAGE lines or JSON lines with message/text fields.
// Exported logs can be incomplete: this is not an invoice or profit report.
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { GRADE_MODEL_CANDIDATES, GRADE_FALLBACK_MODEL } from '../api/_gradeModel.js';

const supportedModels = new Set([null, ...GRADE_MODEL_CANDIDATES, GRADE_FALLBACK_MODEL]);

const fields = ['prompt_tokens', 'cached_prompt_tokens', 'completion_tokens', 'reasoning_tokens', 'total_tokens'];
export function summarizeProviderUsage(lines) {
  const groups = new Map(), seen = new Set();
  let duplicates = 0, ignored = 0;
  for (const line of lines) {
    let record;
    try {
      let text = line;
      if (line.trim().startsWith('{')) {
        const entry = JSON.parse(line);
        text = entry.message ?? entry.text ?? '';
        if (entry.event === 'provider_attempt') record = entry;
      }
      if (!record) {
        const start = text.indexOf('PROVIDER_USAGE ');
        if (start < 0) { ignored++; continue; }
        record = JSON.parse(text.slice(start + 'PROVIDER_USAGE '.length));
      }
      if (record.event !== 'provider_attempt' || record.version !== 1 ||
          !/^[0-9a-f-]{36}$/.test(record.attempt_id) ||
          !['openai', 'ximilar'].includes(record.provider) ||
          !['identify', 'grade', 'deep_grade', 'unknown'].includes(record.mode) ||
          !['tcg_id', 'sport_id', 'card_grade', 'chat_completion', 'unknown'].includes(record.operation) ||
          !supportedModels.has(record.model) ||
          !['success', 'failure'].includes(record.outcome)) { ignored++; continue; }
    } catch { ignored++; continue; }
    if (seen.has(record.attempt_id)) { duplicates++; continue; }
    seen.add(record.attempt_id);
    const key = [record.provider, record.operation, record.mode, record.model || 'none'].join('/');
    if (!groups.has(key)) groups.set(key, { key, attempts: 0, successes: 0, failures: 0,
      duration_ms_sum: 0, duration_samples: 0, cost_usd: null,
      usage: Object.fromEntries(fields.map(field => [field, { reported_total: 0, unknown_attempts: 0 }])) });
    const group = groups.get(key);
    group.attempts++;
    group[record.outcome === 'success' ? 'successes' : 'failures']++;
    if (Number.isSafeInteger(record.duration_ms) && record.duration_ms >= 0) {
      group.duration_ms_sum += record.duration_ms; group.duration_samples++;
    }
    for (const field of fields) {
      const value = record[field];
      if (Number.isSafeInteger(value) && value >= 0) group.usage[field].reported_total += value;
      else group.usage[field].unknown_attempts++;
    }
  }
  return { measurement: 'observed_provider_attempts_not_invoices_or_profit',
    coverage: 'provided_log_export_only', attempts: seen.size, duplicates, ignored,
    groups: [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lines = [];
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) lines.push(line);
  console.log(JSON.stringify(summarizeProviderUsage(lines), null, 2));
}
