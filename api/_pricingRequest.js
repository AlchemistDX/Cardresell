// Bound the entire lookup, including follow-up identity requests and retries.
// Errors contain fixed labels only: provider URLs can contain API credentials.
export function createPricingRequest({ budgetMs = 7500, maxAttempts = 4,
  fetchImpl = (...args) => fetch(...args), now = () => Date.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const deadline = now() + budgetMs;
  let attempts = 0;
  const failure = (reason, status) => Object.assign(new Error(reason), { reason, status });
  return async function request(url) {
    for (let retry = 0; retry < 2; retry++) {
      const remaining = deadline - now();
      if (remaining <= 0 || attempts >= maxAttempts) throw failure('lookup_budget_exhausted');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(3500, remaining));
      let transient = false;
      try {
        attempts++;
        const response = await fetchImpl(url, {
          headers: { 'User-Agent': 'CardResell/1.0', Accept: 'application/json' }, signal: controller.signal,
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          transient = [500, 502, 503, 504].includes(response.status) && !response.headers?.get('retry-after');
          throw failure(response.status === 429 ? 'provider_rate_limited' : 'provider_http_error', response.status);
        }
        // A malformed or stalled body is not automatically re-requested.
        const data = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw failure('provider_invalid_response');
        return data;
      } catch (error) {
        const safe = error.reason ? error : failure(controller.signal.aborted ? 'provider_timeout' : 'provider_unavailable');
        if (!transient || retry > 0 || attempts >= maxAttempts || deadline - now() <= 250) throw safe;
      } finally { clearTimeout(timer); }
      await sleep(200);
    }
  };
}

// Cache outages must not consume the whole browser response window.
export async function pricingCacheCommand(url, token, command, timeoutMs = 600) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command), signal: controller.signal });
    if (!response.ok) { void response.body?.cancel().catch(() => {}); return null; }
    const data = await response.json();
    return data?.error ? null : data?.result;
  } catch { return null; }
  finally { clearTimeout(timer); }
}
