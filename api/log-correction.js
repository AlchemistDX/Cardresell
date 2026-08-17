// /api/log-correction — Training signal for the scan reranker
// -------------------------------------------------------------------
// Tracks how often users hit "Wrong card?" to correct an ID pick and
// which candidate they end up choosing. This is a free feedback loop
// that tells us:
//   1. Overall wrong-card rate (should be < 5% for a healthy scanner)
//   2. Which set-pair collisions confuse pHash most (e.g. Celestial
//      Storm vs Chaos Rising for Metang #94)
//   3. Whether the reranker's pHash pick is systematically wrong for
//      a given set/rarity combo (signal to drop pHash entirely or
//      retrain)
//
// KV keys (fire-and-forget, best-effort):
//   stats:corrections:total        — running total
//   stats:corrections:YYYY-MM-DD   — daily count
//   stats:correction:<chosen>      — how often each card is the correction target
//
// No credit spend, no PII stored.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return res.status(200).json({ ok: true, logged: false });

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const chosen = String(body?.chosen || '').slice(0, 64);
    if (!chosen) return res.status(400).json({ error: 'chosen required' });

    const d = new Date();
    const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    const h = { Authorization: `Bearer ${kvToken}` };
    // Fire in parallel, don't await individually
    await Promise.allSettled([
      fetch(`${kvUrl}/incr/${encodeURIComponent('stats:corrections:total')}`, { method: 'POST', headers: h }),
      fetch(`${kvUrl}/incr/${encodeURIComponent('stats:corrections:' + day)}`, { method: 'POST', headers: h }),
      fetch(`${kvUrl}/incr/${encodeURIComponent('stats:correction:' + chosen)}`, { method: 'POST', headers: h }),
    ]);
    return res.status(200).json({ ok: true });
  } catch(e) {
    console.error('log-correction error:', e.message);
    return res.status(200).json({ ok: true, error: e.message });
  }
}
