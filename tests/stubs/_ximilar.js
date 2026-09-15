/* Test stub. globalThis.__STUB.ximilar controls identify outcome. */
export async function identifyWithXimilar() {
  const s = (globalThis.__STUB || {}).ximilar || {};
  globalThis.__STUB.ximilarCalls = (globalThis.__STUB.ximilarCalls || 0) + 1;
  if (s.providerError) return { ok: false, reason: s.providerError };
  if (s.miss) return { ok: false, reason: s.miss };
  return { ok: true, cardInfo: JSON.parse(JSON.stringify(s.cardInfo || {})), records: s.records || [] };
}
export default { identifyWithXimilar };
