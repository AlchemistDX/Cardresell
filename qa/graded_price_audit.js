#!/usr/bin/env node
/**
 * Graded Price Audit — probe every meaningful grader × grade combo across
 * a representative card set, log what /api/ebay-sold returns, and flag
 * anomalies. See qa/GRADED_PRICE_AUDIT_2026-08-19.md for the report.
 *
 * Ground truth: eBay sold listings themselves. This audit doesn't prove
 * a median is "correct" — it verifies the pipeline is filtering right,
 * returning enough comps, and correctly separating grader tiers.
 */

const HOST = 'https://www.cardresell.org';
const DELAY_MS = 1200;      // eBay-friendly pacing
const TIMEOUT_MS = 25000;

const CARDS = [
  { q: 'Charizard 4/102 Base Set 1999',       label: 'Charizard Base Set (high volume)' },
  { q: 'Pikachu Illustrator CoroCoro Promo',  label: 'Pikachu Illustrator (extreme rarity)' },
  { q: 'Umbreon VMAX Alt Art 215 Evolving',   label: 'Umbreon VMAX Alt Art (modern chase)' },
  { q: 'Michael Jordan 1986 Fleer #57 Rookie',label: 'MJ 1986 Fleer RC (sports)' },
  { q: 'Mew ex 232 Scarlet Violet 151',       label: 'Mew ex 232 (recent moderate)' },
];

const GRADES = [
  { grade: '',         desc: 'Raw (ungraded)' },
  { grade: 'PSA 10',   desc: 'PSA 10' },
  { grade: 'PSA 9',    desc: 'PSA 9' },
  { grade: 'PSA 8',    desc: 'PSA 8' },
  { grade: 'PSA 7',    desc: 'PSA 7' },
  { grade: 'PSA 5',    desc: 'PSA 5' },
  { grade: 'BGS 10',   desc: 'BGS 10 (Pristine)' },
  { grade: 'BGS 9.5',  desc: 'BGS 9.5 (Gem Mint)' },
  { grade: 'BGS 9',    desc: 'BGS 9 (Mint)' },
  { grade: 'CGC 10',   desc: 'CGC 10 (Pristine)' },
  { grade: 'CGC 9.5',  desc: 'CGC 9.5 (Gem Mint)' },
  { grade: 'CGC 9',    desc: 'CGC 9 (Mint)' },
  { grade: 'SGC 10',   desc: 'SGC 10 (Gem Mint)' },
  { grade: 'SGC 9',    desc: 'SGC 9 (Mint)' },
];

const results = [];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function probe(card, gradeObj) {
  const params = new URLSearchParams({ q: card.q, limit: '15' });
  if (gradeObj.grade) params.set('grade', gradeObj.grade);
  const url = `${HOST}/api/ebay-sold?${params.toString()}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const elapsed = Date.now() - started;
    const status = r.status;
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    return { ok: r.ok, status, elapsed, body, url };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, status: 0, elapsed: Date.now() - started, body: null, url, error: String(e.message || e) };
  }
}

function analyzeItems(items, grade) {
  if (!Array.isArray(items) || items.length === 0) return { mismatches: [], graderMix: {} };
  const mismatches = [];
  const graderMix = {};
  const wantMatch = grade ? new RegExp(`\\b${grade.replace(/\s+/g, '[\\s-]?').replace('.', '\\.')}\\b`, 'i') : null;
  const anyGrader = /\b(psa|bgs|cgc|sgc|ace|hga|gma)\s*(gem|black|pristine|mint)?\s*\d/i;

  for (const it of items) {
    const t = it.title || '';
    // Track grader mix (which grader is actually in the title)
    const gm = t.match(/\b(psa|bgs|cgc|sgc|ace|hga|gma)\s*\d(?:\.\d)?/i);
    const gk = gm ? gm[0].toUpperCase().replace(/\s+/g, ' ') : 'no-grader';
    graderMix[gk] = (graderMix[gk] || 0) + 1;

    if (grade && wantMatch && !wantMatch.test(t)) {
      mismatches.push({ title: t, price: it.price, reason: 'grade regex miss' });
    }
    if (!grade && anyGrader.test(t)) {
      mismatches.push({ title: t, price: it.price, reason: 'raw request but grader in title' });
    }
  }
  return { mismatches, graderMix };
}

(async () => {
  console.log(`\n=== Graded Price Audit — ${new Date().toISOString()} ===`);
  console.log(`Cards: ${CARDS.length}   Grade combos: ${GRADES.length}   Total calls: ${CARDS.length * GRADES.length}`);
  console.log(`Pacing: ${DELAY_MS}ms between calls\n`);

  let n = 0;
  for (const card of CARDS) {
    console.log(`\n─── ${card.label} ───`);
    for (const g of GRADES) {
      n++;
      const label = `[${n}/${CARDS.length * GRADES.length}] ${card.label.padEnd(38)} · ${g.desc.padEnd(22)}`;
      process.stdout.write(label);
      const r = await probe(card, g);
      const body = r.body || {};
      const items = body.items || [];
      const { mismatches, graderMix } = analyzeItems(items, g.grade);

      const summary = {
        card: card.label,
        query: card.q,
        gradeReq: g.grade || '(raw)',
        gradeDesc: g.desc,
        httpStatus: r.status,
        elapsedMs: r.elapsed,
        cached: body.cached === true,
        cacheAgeSec: body.cacheAgeSec || 0,
        count: body.count || 0,
        rawCount: body.rawCount || 0,
        median: body.median,
        avg: body.avg,
        low: body.low,
        high: body.high,
        trueLow: body.trueLow,
        trueHigh: body.trueHigh,
        outliersRemoved: body.outliersRemoved || 0,
        confidence: body.confidence || 'unknown',
        confidenceScore: body.confidenceScore || 0,
        confidenceReasons: body.confidenceReasons || [],
        mismatchCount: mismatches.length,
        mismatches: mismatches.slice(0, 3),
        graderMix,
        error: r.error || body.error || null,
      };
      results.push(summary);

      const flag = mismatches.length ? ` ⚠ ${mismatches.length} mismatches` : '';
      const cache = body.cached ? ' [cache]' : '';
      process.stdout.write(` → ${summary.count} comps, $${summary.median ?? '—'} (${summary.confidence})${cache}${flag}\n`);

      await sleep(DELAY_MS);
    }
  }

  const fs = require('fs');
  fs.writeFileSync('/home/user/workspace/cardresell/qa/graded_price_audit_raw.json', JSON.stringify(results, null, 2));
  console.log(`\n\n✓ Raw data saved to qa/graded_price_audit_raw.json (${results.length} records)`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
