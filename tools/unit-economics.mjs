#!/usr/bin/env node
// Planning model for CardResell variable margin. NOT invoice accounting.
// Inputs are public list prices (2026-10-05) plus code-derived call patterns;
// replace the token assumptions with measured PROVIDER_USAGE output
// (tools/provider-usage-report.mjs) before treating any figure as accepted.
// Usage: node tools/unit-economics.mjs [--json]

const P = {
  // Ximilar: Business 100K $69 / 100k credits; credit packs $99 / 100k (worst case).
  ximilarPerCredit: { low: 69 / 100000, high: 99 / 100000 },
  ximilarCredits: { identify: 10, grader: 100 }, // tcg_id/sport_id = 10, "Grade a card" = 100
  // OpenAI standard list prices per token.
  gpt5: { input: 1.25e-6, output: 10e-6 },
  gpt4o: { input: 2.5e-6, output: 10e-6 },
  // gpt-5 high-detail tiles: 70 base + 140/512px tile. Client compresses to 1000px max,
  // so a portrait card (~714x1000) = 2x2 tiles = 630 tokens per image.
  imageTokens: 630,
  promptTextTokens: { low: 4000, high: 7000 },
  outputTokens: { quick: { low: 1500, high: 4000 }, deep: { low: 2500, high: 5000 } }, // caps 4000/5000
  stripe: { pct: 0.029, fixed: 0.30, billingPct: 0.007 },
};

const r4 = x => Math.round(x * 10000) / 10000;
const ximilar = (credits, b) => credits * P.ximilarPerCredit[b];
function gpt(images, outKey, b, fallback = false) {
  const inTok = P.promptTextTokens[b] + images * P.imageTokens;
  const out = P.outputTokens[outKey][b];
  let c = inTok * P.gpt5.input + out * P.gpt5.output;
  // High case: gpt-5 attempt fails after spending output, then gpt-4o (max_tokens 500/700).
  if (fallback) c += inTok * P.gpt4o.input + (outKey === 'deep' ? 700 : 500) * P.gpt4o.output;
  return c;
}

export function operationCosts() {
  const o = {};
  for (const b of ['low', 'high']) {
    const idCalls = b === 'low' ? 1 : 2; // TCG miss -> sport retry
    o[b] = {
      id_scan: ximilar(P.ximilarCredits.identify * idCalls, b),
      id_miss_refunded: ximilar(P.ximilarCredits.identify * 2, b), // cost with no revenue
      quick_grade: gpt(2, 'quick', b, b === 'high') + ximilar(P.ximilarCredits.identify * idCalls, b),
      // ENABLE_XIMILAR_GRADER=deep_only (Production, 2026-10-05): grader on Deep only.
      deep_grade: gpt(6, 'deep', b, b === 'high')
        + ximilar(P.ximilarCredits.identify * idCalls + P.ximilarCredits.grader, b),
    };
  }
  return o;
}

const netOneTime = cents => (cents / 100) * (1 - P.stripe.pct) - P.stripe.fixed;
const netSub = cents => (cents / 100) * (1 - P.stripe.pct - P.stripe.billingPct) - P.stripe.fixed;

export function model() {
  const cost = operationCosts();
  const packs = [
    ['id_25', 'id', 25, 299], ['id_100', 'id', 100, 999], ['id_500', 'id', 500, 2999], ['id_1000', 'id', 1000, 4999],
    ['grade_10', 'grade', 10, 599], ['grade_25', 'grade', 25, 1299], ['grade_50', 'grade', 50, 2299],
  ];
  const packRows = [];
  for (const [id, kind, n, cents] of packs) for (const disc of [0, 25]) {
    const price = Math.round(cents * (1 - disc / 100));
    const net = netOneTime(price);
    // Grade credit worst case = half a Deep Grade (2 credits) or one Quick Grade, whichever costs more.
    const unitHigh = kind === 'id' ? cost.high.id_scan : Math.max(cost.high.quick_grade, cost.high.deep_grade / 2);
    const unitLow = kind === 'id' ? cost.low.id_scan : cost.low.quick_grade;
    packRows.push({ pack: id, discount_pct: disc, price: price / 100, net_receipt: r4(net),
      net_per_credit: r4(net / n), variable_cost_per_credit_low: r4(unitLow), variable_cost_per_credit_high: r4(unitHigh),
      margin_pct_at_high_cost: Math.round((1 - unitHigh * n / net) * 100) });
  }
  const plans = [['starter', 499, 25, 5], ['casual', 999, 50, 15], ['pro', 1999, 250, 40], ['business', 4999, 750, 100]];
  const planRows = plans.map(([plan, cents, id, grade]) => {
    const net = netSub(cents);
    const full = id * cost.high.id_scan + grade * Math.max(cost.high.quick_grade, cost.high.deep_grade / 2);
    return { plan, price: cents / 100, net_receipt: r4(net), full_use_cost_high: r4(full),
      margin_full_use_high: r4(net - full), margin_pct: Math.round((1 - full / net) * 100) };
  });
  const gradeHigh = Math.max(cost.high.quick_grade, cost.high.deep_grade / 2);
  const free = {
    first_month_high: r4(15 * cost.high.id_scan + 2 * gradeHigh),
    later_month_high: r4(5 * cost.high.id_scan + 1 * gradeHigh),
  };
  return { label: 'planning_estimate_not_invoices_or_profit', assumptions: P, operation_costs: cost,
    packs: packRows, plans: planRows, free_user_cost: free };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = model();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(m, null, 2)); process.exit(0); }
  console.log(m.label);
  for (const b of ['low', 'high']) console.log(b, Object.fromEntries(Object.entries(m.operation_costs[b]).map(([k, v]) => [k, r4(v)])));
  console.table(m.packs); console.table(m.plans); console.log('free user', m.free_user_cost);
}
