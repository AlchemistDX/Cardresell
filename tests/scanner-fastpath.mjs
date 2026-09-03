#!/usr/bin/env node
// tests/scanner-fastpath.mjs
//
// Pins the 2026-09-03 scanner fixes. Background: the offline pHash fastpath had
// a measured 0% hit rate on the index's OWN reference images. Cause: the
// 2026-08-21 detectCardBounds() auto-crop was applied before hashing, but
// card-index.json is built from UNCROPPED images (tools/seed_set.py hashes raw
// bytes), so every stored hash was silently invalidated. Separately, the
// "Card not recognized" branch logged nothing, so the failure was invisible.
//
// These checks are structural (they assert the code still has the right shape).
// The empirical calibration harness lives at tools/fastpath_calibration.mjs and
// must be re-run by hand if you touch hashing, cropping, or the thresholds.
//
// Measured after the fix (n=30 reference images, tools/fastpath_calibration.mjs):
//   accepted 26/30, wrong-accepted 0, mean pHash self-distance 2.5 bits.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const index = readFileSync(join(ROOT, 'index.html'), 'utf8');
const scanMiss = readFileSync(join(ROOT, 'api', 'scan-miss.js'), 'utf8');
const seeder = readFileSync(join(ROOT, 'tools', 'seed_set.py'), 'utf8');

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  \u2713 ${name}`); };
const bad = (name, why) => { fail++; console.log(`  \u2717 ${name}\n      ${why}`); };
const check = (name, cond, why) => cond ? ok(name) : bad(name, why || 'assertion failed');

console.log('\nScanner fastpath + miss-logging regressions');
console.log('\u2500'.repeat(60));

{
  const html = index;
  const code = html.replace(/\/\*[\s\S]*?\*\//g, '');

  // ── 1. Dual-hash: the index is uncropped, so we MUST also hash uncropped ──
  check('hashes the cropped canvas',
    /const\s+ph\s*=\s*computePHash\(cropCanvas\)/.test(code),
    'computePHash(cropCanvas) missing');
  check('hashes the RAW uncropped canvas too',
    /const\s+phRaw\s*=\s*computePHash\(canvas\)/.test(code) &&
    /const\s+dhRaw\s*=\s*computeDHash\(canvas\)/.test(code),
    'phRaw/dhRaw missing — without these the fastpath cannot match the index, ' +
    'which is built from UNCROPPED images. This is the 0%-hit-rate bug.');

  // ── 2. NN loop must score min(cropped, uncropped) ──
  check('NN loop scores both crop and raw and takes the min',
    /hamming\(ph,\s*c\.p\)\s*\*\s*2/.test(code) &&
    /hamming\(phRaw,\s*c\.p\)\s*\*\s*2/.test(code) &&
    /dCrop\s*<\s*dRaw\s*\?\s*dCrop\s*:\s*dRaw/.test(code),
    'scoring must consider both hash variants');

  // ── 3. Calibrated thresholds ──
  const cm = code.match(/const\s+CONFIDENCE_MAX\s*=\s*(\d+)/);
  check('CONFIDENCE_MAX is the calibrated 20',
    cm && cm[1] === '20',
    `found ${cm ? cm[1] : 'nothing'}; 20 is the conservative end of the ` +
    'measured zero-false-accept plateau. Re-run tools/fastpath_calibration.mjs ' +
    'before changing it — a false accept shows a confidently WRONG card.');
  const gm = code.match(/const\s+GAP_MIN\s*=\s*(\d+)/);
  check('GAP_MIN still 6 (the rule that prevents false accepts)',
    gm && gm[1] === '6',
    `found ${gm ? gm[1] : 'nothing'}; the gap rule is what eliminates ` +
    'wrong accepts on near-duplicate arts. Do not lower it.');

  // ── 4. The stale, now-false comment must not come back ──
  check('stale "holo cards score > 20" threshold claim is gone',
    !/pHash\+dHash\s*\u2264\s*12\s*empirically matches only the exact card/.test(html),
    'that comment describes the pre-crop world and is false');

  // ── 5. Logging: the unrecognized branch must log ──
  const callSites = (code.match(/_logScanMiss\(/g) || []).length;
  check('_logScanMiss has more than one call site',
    callSites >= 3,
    `found ${callSites} occurrences (1 def + calls). Before 2026-09-03 there ` +
    'was exactly one call site, in the scan-miss panel path, so total ' +
    'recognition failures logged NOTHING.');
  check('unrecognized branch logs with reason "unrecognized"',
    /_logScanMiss\(null,\s*\{[\s\S]{0,400}?reason:\s*'unrecognized'/.test(code),
    'the "Card not recognized" branch must call _logScanMiss');
  check('_logScanMiss accepts and merges an `extra` payload',
    /function\s+_logScanMiss\(pending,\s*extra\)/.test(code) &&
    /\.\.\.\(extra\s*\|\|\s*\{\}\)/.test(code),
    'signature must carry the diagnosis fields');
  check('unrecognized log captures fastpath diagnosis',
    /fpBestDist:/.test(code) && /fpBestGuess:/.test(code) && /modelUsed:/.test(code),
    'without best-dist / best-guess / model the log is not actionable');
}

{
  // ── 6. Server must accept a name-less, number-less payload ──
  const code = scanMiss.replace(/\/\*[\s\S]*?\*\//g, '');
  check('scan-miss accepts reason-only payloads',
    /if\s*\(!payload\.name\s*&&\s*!payload\.number\s*&&\s*!payload\.reason\)/.test(code),
    'a total recognition failure has NO name and NO number by definition; ' +
    'requiring either silently discards the highest-signal record we get');
  check('scan-miss persists the diagnosis fields',
    /reason:\s*clip\(body\.reason/.test(code) &&
    /fpBestDist:/.test(code) &&
    /modelUsed:\s*clip\(body\.modelUsed/.test(code),
    'diagnosis fields must be stored, not just accepted');
  check('dedup key does not collapse all unrecognized misses into one record',
    /payload\.name\s*\|\|\s*payload\.number\s*\n?\s*\?/.test(code) &&
    /\$\{payload\.reason\}\|\$\{payload\.fpBestId\}/.test(code),
    'keying only on name|number|set would make every total failure share one key');
  check('30-day TTL retained',
    /TTL_SECONDS\s*=\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60/.test(code));
}

{
  // ── 7. The seeder must stay uncropped — this is the contract the fix relies on ──
  check('seeder still hashes raw uncropped bytes (contract for dual-hash)',
    /def\s+phash\(img_bytes/.test(seeder) &&
    /def\s+dhash\(img_bytes/.test(seeder) &&
    !/detectCardBounds|crop\(/.test(seeder),
    'if the seeder ever starts cropping, the uncropped client hash stops ' +
    'matching and the fastpath silently dies again. Change both together.');
  check('seeder pHash still 32x32 / dHash still 9x8',
    /resize\(\(32,\s*32\)/.test(seeder) && /resize\(\(9,\s*8\)/.test(seeder),
    'client computePHash/computeDHash assume these geometries');
}

console.log('\u2500'.repeat(60));
console.log(`  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
