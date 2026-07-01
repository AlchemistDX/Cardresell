// /api/scan-result — Poll CardGrader.AI for scan results
// GET ?id={scanId}
// Returns: { status: "queued"|"processing"|"completed"|"failed", result?, progress? }
// Frontend polls this every 3s until status === "completed" or "failed"

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const scanId = req.query?.id;
  if (!scanId) return res.status(400).json({ error: 'scanId required' });

  const cgKey = process.env.CARDGRADER_API_KEY;
  if (!cgKey) return res.status(500).json({ error: 'Scanner not configured.' });

  try {
    const r = await fetch(`https://cardgrader.ai/v1/scans/${encodeURIComponent(scanId)}`, {
      headers: { Authorization: `Bearer ${cgKey}` }
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error('CardGrader poll error:', r.status, errText);
      return res.status(502).json({ error: 'Could not retrieve scan results.', status: 'failed' });
    }

    const data = await r.json();
    const status = data.status || 'unknown';

    // Still processing
    if (status === 'queued' || status === 'processing') {
      return res.status(200).json({
        status,
        progress: data.progressPercent || null,
        message: data.statusMessage || null,
      });
    }

    // Failed
    if (status === 'failed' || status === 'error') {
      return res.status(200).json({ status: 'failed', error: 'Scan could not be completed. Please try a clearer photo.' });
    }

    // Completed — normalize the response for the frontend
    if (status === 'completed') {
      const normalized = normalizeCardGraderResponse(data);
      return res.status(200).json({ status: 'completed', result: normalized });
    }

    // Unknown status — pass through
    return res.status(200).json({ status, raw: data });

  } catch(err) {
    console.error('scan-result error:', err);
    return res.status(500).json({ error: 'Scanner temporarily unavailable.', status: 'failed' });
  }
}

// Normalize CardGrader completed response to match what the frontend expects
// CardGrader completed shape:
// { id, status, identification: { name, set, number, year, subject, category, parallel, printRun },
//   grading: { grade, predictedGrade, subGrades: { centering, corners, edges, surface }, summary, justification },
//   value: { rawEstimate, gradedEstimate, currency, gradedValueSpread: [{ grade, value, confidence }] },
//   market: { insights, gradingRecommendation, context } }
function normalizeCardGraderResponse(raw) {
  if (!raw) return raw;

  const id  = raw.identification || {};
  const gr  = raw.grading || {};
  const val = raw.value || {};
  const mkt = raw.market || {};
  const sub = gr.subGrades || {};

  return {
    // Raw data for debugging
    _raw: raw,
    _scanId: raw.id,

    // Card identity fields the frontend uses
    card_name:   id.name    || '',
    card_number: id.number  || '',
    set_name:    id.set     || '',
    year:        id.year    || '',
    game:        id.category || 'pokemon',
    subject:     id.subject || '',
    parallel:    id.parallel || '',

    // Grading
    grade:       gr.grade ?? gr.predictedGrade ?? null,
    grade_label: gradeLabel(gr.grade ?? gr.predictedGrade),
    grading_summary:    gr.summary || '',
    grading_justification: gr.justification || '',

    // Sub-grades (PSA-style)
    centering: sub.centering ?? null,
    corners:   sub.corners   ?? null,
    edges:     sub.edges     ?? null,
    surface:   sub.surface   ?? null,

    // Value estimates
    raw_value:    val.rawEstimate    ?? null,
    graded_value: val.gradedEstimate ?? null,
    currency:     val.currency       || 'USD',
    graded_value_spread: val.gradedValueSpread || [],

    // Market insights
    market_insights:     mkt.insights             || '',
    grading_recommendation: mkt.gradingRecommendation || '',
    market_context:      mkt.context             || '',

    confidence: 'high', // CardGrader always returns full analysis
  };
}

function gradeLabel(grade) {
  if (grade === null || grade === undefined) return null;
  const g = parseFloat(grade);
  if (g >= 10)   return 'GEM MINT';
  if (g >= 9.5)  return 'MINT+';
  if (g >= 9)    return 'MINT';
  if (g >= 8.5)  return 'NM-MT+';
  if (g >= 8)    return 'NM-MT';
  if (g >= 7.5)  return 'NM+';
  if (g >= 7)    return 'NM';
  if (g >= 6)    return 'EX-MT';
  if (g >= 5)    return 'EX';
  if (g >= 4)    return 'VG-EX';
  if (g >= 3)    return 'VG';
  if (g >= 2)    return 'GOOD';
  return 'POOR';
}
