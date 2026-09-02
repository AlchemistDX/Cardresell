// /api/grade-opportunity — Should this card be graded?
// GET ?name=Charizard&set=Base+Set&number=4&game=pokemon
// Returns { recommendation, targetGrade, gradedEst, gradingCost, expectedProfit, edgePct, ... }
//
// Purpose: stop users from burning AI grade scan credits on cards where
// grading is economically stupid. Silent by default — only speaks up when
// the math actually works out.
//
// Phase 1: conservative category multipliers, PSA only.
// Phase 2 will replace multipliers with real historical eBay PSA data
// once we have an eBay path that isn't 403'd.

const PLATFORM_FEE_PCT = 0.13; // eBay blended (final value + payment processing)

// Grade multipliers by raw-price tier. Conservative — better to be silent
// than to over-promise. Numbers based on typical Pokemon/MTG/YGO market data.
const MULTIPLIERS = {
  // tier boundaries in USD raw price
  under5:   { psa10: 3.0, psa9: 1.5, bgs95: 2.0 },
  mid5_25:  { psa10: 4.0, psa9: 2.0, bgs95: 3.0 },
  mid25_100:{ psa10: 5.0, psa9: 2.2, bgs95: 3.5 },
  high100_500: { psa10: 4.0, psa9: 2.0, bgs95: 3.0 },
  over500:  { psa10: 3.0, psa9: 1.8, bgs95: 2.5 },
};

function getTier(rawPrice) {
  if (rawPrice < 5)   return 'under5';
  if (rawPrice < 25)  return 'mid5_25';
  if (rawPrice < 100) return 'mid25_100';
  if (rawPrice < 500) return 'high100_500';
  return 'over500';
}

function getTierLabel(tier) {
  return {
    under5:   'under $5 (grading rarely justified)',
    mid5_25:  'mid-tier $5-$25 (chase yield sweet spot)',
    mid25_100:'$25-$100 (premium chases)',
    high100_500: '$100-$500 (edge compresses)',
    over500:  '$500+ (grading is rounding error)',
  }[tier];
}

function getGradingCost(rawPrice, grader = 'PSA') {
  if (grader === 'BGS') return 50;
  if (grader === 'CGC') return 18;
  if (grader === 'SGC') return 18;
  // PSA (default)
  if (rawPrice < 200) return 25;
  if (rawPrice < 500) return 50;
  return 100;
}

async function fetchTcgPrice({ name, set, number, rarity, host }) {
  const params = new URLSearchParams({ name });
  if (set)    params.set('set', set);
  if (number) params.set('number', number);
  if (rarity) params.set('rarity', rarity);
  try {
    const url = `https://${host}/api/tcg-price?${params.toString()}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!r.ok) return null;
    return await r.json();
  } catch(e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Vercel/Node represents duplicate query parameters as arrays. Normalize
  // every public string parameter so malformed or repeated parameters return
  // a controlled response instead of crashing the serverless function.
  const queryString = (value, fallback = '') => {
    const normalized = Array.isArray(value) ? value[0] : value;
    return String(normalized ?? fallback).trim();
  };
  const name   = queryString(req.query.name);
  const set    = queryString(req.query.set);
  const number = queryString(req.query.number);
  const rarity = queryString(req.query.rarity);
  const game   = queryString(req.query.game, 'pokemon').toLowerCase();

  const fetchedAt = new Date().toISOString();

  if (!name) return res.status(400).json({ error: 'name required' });

  // Skip games we don't have grading confidence for
  if (game === 'sports' || game === 'pokemonjp') {
    return res.status(200).json({
      recommendation: 'sell_raw',
      reasoning: [`${game} grading opportunities not modeled yet`],
      fetchedAt,
    });
  }

  // Get raw price from TCG (source of truth). Passing host so we call our own API.
  const host = req.headers.host || 'www.cardresell.org';
  const tcg = await fetchTcgPrice({ name, set, number, rarity, host });

  if (!tcg || !tcg.market || tcg.market < 2) {
    // Data too weak or card too cheap to be worth analyzing
    return res.status(200).json({
      recommendation: 'sell_raw',
      rawPrice: tcg?.market || null,
      reasoning: tcg?.market
        ? [`raw price ($${tcg.market.toFixed(2)}) too low for grading ROI`]
        : ['no reliable raw price available'],
      fetchedAt,
    });
  }

  const rawPrice = tcg.market;
  const tier = getTier(rawPrice);
  const mults = MULTIPLIERS[tier];

  // Target PSA 10 (highest EV path). We show PSA 10 economics but hedge
  // that "at PSA 10" is the ceiling, not the guarantee — the frontend
  // should be explicit that this assumes the card grades a 10.
  const targetGrade = 'PSA 10';
  const grader = 'PSA';
  const gradedEst = rawPrice * mults.psa10;
  const gradingCost = getGradingCost(rawPrice, grader);
  const platformFees = gradedEst * PLATFORM_FEE_PCT;
  const expectedProfit = gradedEst - gradingCost - platformFees - rawPrice;
  const edgePct = (expectedProfit / rawPrice) * 100;

  // Threshold logic
  let recommendation;
  if (expectedProfit >= 30 && edgePct >= 40) {
    recommendation = 'worth_grading';
  } else if (expectedProfit >= 10 || edgePct >= 20) {
    recommendation = 'borderline';
  } else {
    recommendation = 'sell_raw';
  }

  const reasoning = [
    getTierLabel(tier),
    `${mults.psa10}× ${targetGrade} multiplier (conservative)`,
    `${grader} grading cost: $${gradingCost}`,
  ];

  if (recommendation === 'worth_grading') {
    reasoning.push(`assumes the card actually grades ${targetGrade}`);
  }

  return res.status(200).json({
    rawPrice: Math.round(rawPrice * 100) / 100,
    recommendation,
    targetGrade,
    gradedEst: Math.round(gradedEst * 100) / 100,
    gradingCost,
    platformFees: Math.round(platformFees * 100) / 100,
    expectedProfit: Math.round(expectedProfit * 100) / 100,
    edgePct: Math.round(edgePct),
    grader,
    tier,
    reasoning,
    fetchedAt,
    cardName: tcg.cardName || name,
    setName: tcg.setName || set,
  });
}
