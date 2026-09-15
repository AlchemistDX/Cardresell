#!/usr/bin/env node
// scanner-benchmark-run.mjs
//
// Runs a labeled photo manifest through CardResell's Production scanner and
// grades each result against the label. Produces scanner-benchmark-results.json.
//
// Usage:
//   1. Sign in to https://cardresell.org in a real browser.
//   2. Open devtools -> Application -> IndexedDB -> firebaseLocalStorageDb ->
//      firebaseLocalStorage -> your uid -> stsTokenManager.accessToken. Copy it.
//      OR: run `fetch('/api/session').then(r=>r.text())` in the console (if
//      that route echoes the token). OR: sign in via a REST flow with your
//      Google refresh token.
//   3. `export CARDRESELL_ID_TOKEN=<paste>` and
//      `export CARDRESELL_ENDPOINT=https://cardresell.org/api/scan` (or the
//      preview URL for the current deploy).
//   4. `node scanner-benchmark-run.mjs <labeled-manifest.json> <photos-dir>
//      [--max=50] [--sleep=200]`
//
// Output goes to scanner-benchmark-results.json in the current dir.
//
// The token expires in 1 hour. If a scan returns 401, the runner stops and
// asks you to re-paste.

import fs from 'node:fs/promises';
import path from 'node:path';
import { scoreOne, aggregate, validateManifest, enforceScanCap, SCAN_CAP } from './scorer.mjs';

const argv = process.argv.slice(2);
const manifestPath = argv[0];
const photosDir = argv[1];
const maxScans = parseInt((argv.find(a => a.startsWith('--max=')) || '--max=50').split('=')[1], 10);
const sleepMs = parseInt((argv.find(a => a.startsWith('--sleep=')) || '--sleep=200').split('=')[1], 10);

if (!manifestPath || !photosDir) {
  console.error('Usage: node scanner-benchmark-run.mjs <manifest.json> <photos-dir> [--max=N] [--sleep=ms]');
  process.exit(2);
}

const idToken = process.env.CARDRESELL_ID_TOKEN;
const endpoint = process.env.CARDRESELL_ENDPOINT || 'https://cardresell.org/api/scan';
if (!idToken) {
  console.error('CARDRESELL_ID_TOKEN not set. See header for how to obtain.');
  process.exit(2);
}

// SCORING IS NOT DEFINED HERE.
// The previous local normalize() did .replace(/[^a-z0-9]/g,''), which collapsed
// every Japanese card name to the empty string, so two different Japanese cards
// compared EQUAL and every Japanese scan graded correct regardless of the answer.
// It also treated a MISSING label field as an automatic pass.
// Scoring now lives in ../cardresell/tools/benchmark/scorer.mjs (34 tests).

async function scanOne(record, idx, total) {
  const photoPath = path.resolve(photosDir, record.photoPath);
  const buf = await fs.readFile(photoPath).catch(() => null);
  if (!buf) return { ...record, error: 'file_not_found', verdict: 'error' };
  const ext = path.extname(photoPath).slice(1).toLowerCase() || 'jpeg';
  const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
  const imageBase64 = buf.toString('base64');
  const body = { imageBase64, mimeType, mode: 'identify' };

  const t0 = Date.now();
  let resp, json, httpStatus, errorMessage = null;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    httpStatus = resp.status;
    if (resp.status === 401) {
      errorMessage = 'auth_expired';
      throw new Error('Token expired; stop and re-paste CARDRESELL_ID_TOKEN.');
    }
    const text = await resp.text();
    try { json = JSON.parse(text); } catch { json = { rawText: text.slice(0, 500) }; }
  } catch (e) {
    errorMessage = errorMessage || e.message;
  }
  const latencyMs = Date.now() - t0;

  // Grade the result.
  const actualEndState = deriveEndState(json, httpStatus);
  const actualName = json?.cardInfo?.card_name || json?.candidates?.[0]?.card_name || '';
  const actualSetCode = json?.cardInfo?.set_code || json?.candidates?.[0]?.set_code || '';
  const actualNumber = json?.cardInfo?.card_number || json?.candidates?.[0]?.card_number || '';
  const actualRarity = json?.cardInfo?.rarity || '';
  const actualConfidence = json?.confidence || (json?.needsPicker ? 'medium' : '');
  const candidateList = Array.isArray(json?.candidates)
    ? json.candidates.map(c => ({ name: c.card_name, setCode: c.set_code, number: c.card_number }))
    : [];

  const scored = scoreOne(
    {
      label: {
        game: record.expectedGame ?? record.game,
        setCode: record.expectedSetCode,
        number: record.expectedCollectorNumber,
        name: record.expectedName,
      },
      expectedEndState: record.expectedEndState,
    },
    {
      endState: actualEndState,
      identity: { game: json?.cardInfo?.game, setCode: actualSetCode, number: actualNumber, name: actualName },
      candidates: candidateList,
      error: errorMessage || undefined,
    },
  );
  const verdict = scored.verdict;

  return {
    photoPath: record.photoPath,
    label: {
      game: record.expectedGame ?? record.game,
      setCode: record.expectedSetCode,
      number: record.expectedCollectorNumber,
      name: record.expectedName,
    },
    labeledEndState: record.expectedEndState,
    scoreDetail: scored,
    labeledPhotoQuality: record.photoQuality,
    actualEndState, actualName, actualSetCode, actualNumber, actualRarity,
    actualGroundedId: json?.cardInfo?.grounded_id || json?.cardInfo?._grounded_id || null,
    actualConfidence,
    actualCandidateCount: candidateList.length,
    actualCandidateList: candidateList,
    latencyMs, httpStatus, errorMessage, verdict,
    usedXimilar: !!json?.cardInfo?._ximilar,
    ximilarDistance: json?.cardInfo?._ximilar_dist ?? null,
    usedGPTVisionFallback: !!json?._gpt_fallback,
    grounderName: json?.cardInfo?._mtg_grounded_by || json?.cardInfo?._ygo_grounded_by
      || json?.cardInfo?._pokemon_grounded_by || json?.cardInfo?._lorcana_grounded_by
      || json?.cardInfo?._onepiece_grounded_by || null,
  };
}

function deriveEndState(json, httpStatus) {
  if (!json) return 'SOURCE_UNAVAILABLE';
  if (httpStatus >= 500) return 'SOURCE_UNAVAILABLE';
  if (json.error) {
    const err = String(json.error).toLowerCase();
    if (err.includes('unreadable') || err.includes('image')) return 'UNREADABLE_IMAGE';
    if (err.includes('unknown') || err.includes('no match')) return 'UNKNOWN_CARD';
    if (err.includes('sign in') || err.includes('unauthorized')) return 'SOURCE_UNAVAILABLE';
    return 'SOURCE_UNAVAILABLE';
  }
  if (json.needsPicker) return 'NEEDS_CONFIRMATION';
  if (json.cardInfo?.grounded === true || json.cardInfo?._grounded === true) return 'EXACT_MATCH';
  if (json.cardInfo?.card_name && !json.cardInfo?.grounded) return 'NEEDS_CONFIRMATION';
  return 'UNKNOWN_CARD';
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
  const rawItems = Array.isArray(manifest)
    ? manifest
    : manifest.records || manifest.labels || manifest.samples || [];

  // Accept both manifest schemas. The reference manifest nests ground truth
  // under `label`; the older template used flat expected* fields. Neither is
  // allowed to omit a field silently: a missing label field is scored
  // `unscoreable_label`, never a pass.
  const items = rawItems.map((r) => {
    if (r.label) {
      return {
        ...r,
        expectedGame: r.label.game,
        expectedSetCode: r.label.setCode,
        expectedCollectorNumber: r.label.number,
        expectedName: r.label.name,
        expectedEndState: r.expectedEndState ?? 'EXACT_MATCH',
      };
    }
    return r;
  });

  if (items.length === 0) {
    console.error('Manifest contains no records. Refusing to report a 100% pass over an empty set.');
    process.exit(2);
  }

  if (manifest.manifestKind === 'REFERENCE_IMAGES') {
    console.error('');
    console.error('*** REFERENCE IMAGES, NOT CAMERA PHOTOS ***');
    console.error('These are clean catalogue artwork renders. Results measure the');
    console.error('identity-resolution path only. Do NOT report any figure from this');
    console.error('run as camera accuracy. The independent camera benchmark');
    console.error('(250 cards / 500 photos / owner devices / labeler != implementer)');
    console.error('is separate and remains Unrun.');
    console.error('');
  }

  const capped = enforceScanCap(Math.min(items.length, maxScans));
  const slice = items.slice(0, capped);
  console.error(`Running ${slice.length} scans (out of ${items.length}, cap ${SCAN_CAP}) against ${endpoint}`);

  const results = [];
  for (let i = 0; i < slice.length; i++) {
    const rec = slice[i];
    try {
      const r = await scanOne(rec, i, slice.length);
      results.push(r);
      console.error(`  [${i+1}/${slice.length}] ${rec.photoPath} -> ${r.verdict} (${r.latencyMs}ms)`);
      if (r.verdict === 'auth_expired') {
        console.error('  Auth token expired. Stopping. Re-export CARDRESELL_ID_TOKEN and re-run.');
        break;
      }
    } catch (e) {
      results.push({ ...rec, verdict: 'error', errorMessage: e.message });
      console.error(`  [${i+1}/${slice.length}] ${rec.photoPath} -> error: ${e.message}`);
    }
    if (sleepMs > 0) await new Promise(r => setTimeout(r, sleepMs));
  }

  const aggregates = summarize(results);
  const out = { endpoint, ranAt: new Date().toISOString(), maxScans, totalRun: results.length, aggregates, results };
  await fs.writeFile('scanner-benchmark-results.json', JSON.stringify(out, null, 2));
  console.error(`\nWrote scanner-benchmark-results.json`);
  const fmt = (v) => (v == null ? 'n/a (no scoreable results)' : v.toFixed(4));
  console.error(JSON.stringify(aggregates, null, 2));
  console.error(`  top1=${fmt(aggregates.top1Accuracy)}  top3=${fmt(aggregates.top3Accuracy)}`);
  console.error(`  wrongHighConfidence=${fmt(aggregates.wrongHighConfidenceRate)}`);
  console.error(`  p50=${aggregates.p50LatencyMs ?? 'n/a'}ms p95=${aggregates.p95LatencyMs ?? 'n/a'}ms`);
  if (aggregates.excludedFromAccuracy) {
    console.error(`  excluded from accuracy denominators: ${JSON.stringify(aggregates.excludedFromAccuracy)}`);
  }
}

// Aggregation is delegated to the validated scorer. The previous local
// summarize() counted verdict names ('silent_substitute',
// 'correct_picker_within_top3', 'missed') that the corrected scorer never
// emits, so every metric would have silently computed 0.0000 rather than
// failing loudly.
function summarize(rs) {
  const agg = aggregate(rs.map((r) => r.scoreDetail).filter(Boolean));
  const lat = rs.map((r) => r.latencyMs).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const p = (q) => (lat.length ? lat[Math.max(0, Math.floor(lat.length * q) - 1)] : null);
  return { ...agg, p50LatencyMs: p(0.5), p95LatencyMs: p(0.95) };
}

main().catch(e => { console.error(e); process.exit(1); });
