#!/usr/bin/env node
// Side-by-side grading-model evaluation using the SHIPPED grade prompt.
// Reads the prompt/visionContent block from api/scan.js at runtime (no copy),
// sends the same request to each candidate model, and reports latency, usage,
// parse success and the returned grade fields. Offline QA only: no user, no
// credits, no Production traffic. Costs real OpenAI usage on the key provided.
//
//   OPENAI_API_KEY=... node tools/grade-model-eval.mjs --models gpt-5,gpt-6.1-sol \
//     --front a.jpg [--back b.jpg] [--deep --edges t.jpg,b.jpg,l.jpg,r.jpg] [--repeat 2]
import { readFileSync } from 'node:fs';

const SCAN = new URL('../api/scan.js', import.meta.url);
const PRICES = { // USD per token, standard short-context list prices 2026-10-05
  'gpt-5': [1.25e-6, 10e-6], 'gpt-4o': [2.5e-6, 10e-6], 'gpt-6.1-sol': [2e-6, 10e-6],
  'gpt-6-sol': [2e-6, 10e-6], 'gpt-6-luna': [0.1e-6, 0.5e-6], 'gpt-5.6-sol': [4e-6, 20e-6],
  'gpt-5.6-terra': [2e-6, 12e-6], 'gpt-5.6-luna': [0.2e-6, 1.2e-6], 'gpt-5.4-mini': [0.75e-6, 4.5e-6],
};

export function buildVisionContent(opts) {
  const src = readFileSync(SCAN, 'utf8').split('\n');
  const start = src.findIndex(l => l.includes("const mime   = mimeType || 'image/jpeg';"));
  const vc = src.findIndex((l, i) => i > start && l.includes('const visionContent ='));
  // Ends at the statement's closing line: `    ];` or `    ] : [...];` (cache-ordered layout).
  const end = src.findIndex((l, i) => i > vc && /^    \](;| : .*\];)\s*$/.test(l));
  if (start < 0 || vc < 0 || end < 0) throw Error('shipped prompt block not found in api/scan.js');
  const body = src.slice(start, end + 1).join('\n') + '\nreturn visionContent;';
  const params = ['mimeType', 'imageBase64', 'backBase64', 'backMimeType', 'isDeepGrade', 'isGradeMode',
    'topEdgeBase64', 'bottomEdgeBase64', 'leftEdgeBase64', 'rightEdgeBase64',
    'topEdgeMimeType', 'bottomEdgeMimeType', 'leftEdgeMimeType', 'rightEdgeMimeType'];
  // eslint-disable-next-line no-new-func
  return new Function(...params, body)(...params.map(p => opts[p]));
}

export function requestBody(model, visionContent, { deep }) {
  const body = { model, messages: [{ role: 'user', content: visionContent }] };
  if (/^gpt-(5|6)/.test(model)) { // reasoning models
    body.reasoning_effort = 'low';
    body.max_completion_tokens = deep ? 5000 : 4000;
  } else body.max_tokens = deep ? 700 : 500;
  return body;
}

function parse(content) {
  const c = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const a = c.indexOf('{'), b = c.lastIndexOf('}');
  return JSON.parse(a >= 0 && b > a ? c.slice(a, b + 1) : c);
}

async function run(model, vc, deep, key) {
  const t0 = Date.now();
  const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody(model, vc, { deep })) });
  const ms = Date.now() - t0;
  if (!r.ok) { const e = await r.json().catch(() => ({})); return { model, ms, http: r.status, error: e.error?.code || e.error?.type || 'http' }; }
  const j = await r.json(); const u = j.usage || {};
  const [pi, po] = PRICES[model] || [null, null];
  const cost = pi == null ? null : (u.prompt_tokens || 0) * pi + (u.completion_tokens || 0) * po;
  const out = { model, ms, http: 200, finish: j.choices?.[0]?.finish_reason, prompt_tokens: u.prompt_tokens,
    completion_tokens: u.completion_tokens, reasoning_tokens: u.completion_tokens_details?.reasoning_tokens,
    est_cost_usd: cost == null ? null : Math.round(cost * 1e5) / 1e5 };
  try {
    const g = parse(j.choices?.[0]?.message?.content || '');
    Object.assign(out, { parsed: true, card: g.card_name, grade: g.psa_estimate ?? g.grade_label, limiting: g.limiting_factor, distribution: g.psa_distribution,
      confidence_pct: g.confidence_pct, confidence: g.confidence, slabbed: g.is_slabbed ?? g.slabbed, slab_grade: g.slab_grade ?? null, slab_grader: g.slab_grader ?? null });
  } catch { out.parsed = false; }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const key = process.env.OPENAI_API_KEY; if (!key) throw Error('OPENAI_API_KEY required');
  const b64 = p => p && readFileSync(p).toString('base64');
  const deep = process.argv.includes('--deep');
  const edges = (arg('--edges') || '').split(',').filter(Boolean);
  const vc = buildVisionContent({ mimeType: 'image/jpeg', imageBase64: b64(arg('--front')), backBase64: b64(arg('--back')),
    backMimeType: 'image/jpeg', isDeepGrade: deep, isGradeMode: true,
    topEdgeBase64: b64(edges[0]), bottomEdgeBase64: b64(edges[1]), leftEdgeBase64: b64(edges[2]), rightEdgeBase64: b64(edges[3]) });
  const models = (arg('--models') || 'gpt-5,gpt-6.1-sol').split(',');
  const repeat = Number(arg('--repeat') || 1);
  for (let i = 0; i < repeat; i++) for (const m of models) console.log(JSON.stringify(await run(m, vc, deep, key)));
}
