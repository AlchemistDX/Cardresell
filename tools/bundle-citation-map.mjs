#!/usr/bin/env node
// Maps audit-corpus citations written against a RETIRED bundle onto the live one.
//
// Why this is a script and not just a table: a table is a derived value stamped
// into a document, and a stamped derived value is a claim nobody re-checks. The
// bundle rename to core.7f9c03ad.js came in one hash off a predicted name for
// exactly that reason (audit/BUNDLE_RENAME_7f9c03ad.md). So the offset table in
// audit/BUNDLE_CITATION_MAP.md is a convenience cache, and this is the source of
// truth. Re-derive, then stamp.
//
// Two modes:
//   node tools/bundle-citation-map.mjs            verify every corpus citation resolves
//   node tools/bundle-citation-map.mjs <hash> <n> map one line, for a human mid-read
//
// Direct maps only, never composed. Reading a d9e1b484 citation by chaining
// d9e1b484->8bd8277a->7f9c03ad is fine at two generations and unpleasant at five;
// every retired generation is diffed straight against live instead.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const LIVE = liveBundleName();

function liveBundleName() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const m = [...html.matchAll(/src="\/js\/(core\.[0-9a-f]{8}\.js)"/g)];
  if (m.length !== 1) throw new Error(`index.html must reference exactly one core bundle, found ${m.length}`);
  return m[0][1];
}

function lines(f) { return readFileSync(join(ROOT, 'js', f), 'utf8').split('\n'); }

// Longest-common-subsequence line alignment. Returns 1-based old -> 1-based new,
// or null where the line has no byte-identical counterpart.
function align(a, b) {
  const map = new Map();
  const bIndex = new Map();
  b.forEach((l, i) => { const k = bIndex.get(l); if (k) k.push(i); else bIndex.set(l, [i]); });
  // Anchor on lines that are unique in BOTH files, then fill equal runs outward.
  const anchors = [];
  const aCount = new Map();
  a.forEach(l => aCount.set(l, (aCount.get(l) || 0) + 1));
  a.forEach((l, i) => {
    const js = bIndex.get(l);
    if (aCount.get(l) === 1 && js && js.length === 1) anchors.push([i, js[0]]);
  });
  let last = -1; const kept = [];
  for (const [i, j] of anchors) { if (j > last) { kept.push([i, j]); last = j; } }
  for (const [i, j] of kept) {
    map.set(i + 1, j + 1);
    for (let d = 1; a[i - d] !== undefined && b[j - d] !== undefined && a[i - d] === b[j - d]; d++) map.set(i - d + 1, j - d + 1);
    for (let d = 1; a[i + d] !== undefined && b[j + d] !== undefined && a[i + d] === b[j + d]; d++) map.set(i + d + 1, j + d + 1);
  }
  for (let i = 1; i <= a.length; i++) if (!map.has(i)) map.set(i, null);
  return map;
}

function intervals(map, n) {
  const out = [];
  for (let L = 1; L <= n; L++) {
    const t = map.get(L); const off = t === null ? null : t - L;
    const prev = out[out.length - 1];
    if (prev && prev.off === off && prev.to === L - 1) prev.to = L;
    else out.push({ from: L, to: L, off });
  }
  return out;
}

function retiredBundles() {
  return readdirSync(join(ROOT, 'js'))
    .filter(f => /^core\.[0-9a-f]{8}\.js$/.test(f) && f !== LIVE);
}

function corpusFiles(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e); const s = statSync(p);
    if (s.isDirectory()) corpusFiles(p, acc);
    else if (['.md', '.mjs', '.js'].includes(extname(e))) acc.push(p);
  }
  return acc;
}

const live = lines(LIVE);

// ---- single-citation mode -------------------------------------------------
if (process.argv[2]) {
  const hash = process.argv[2].replace(/^core\.|\.js$/g, '');
  const L = Number(process.argv[3]);
  const old = lines(`core.${hash}.js`);
  const t = align(old, live).get(L);
  console.log(`core.${hash}.js:${L}  ->  ${t ? `${LIVE}:${t}` : 'NO TARGET (line changed or removed)'}`);
  if (t) {
    console.log(`  identical: ${old[L - 1] === live[t - 1]}`);
    console.log(`  ${live[t - 1].trim().slice(0, 100)}`);
  }
  process.exit(t ? 0 : 1);
}

// ---- verify mode ---------------------------------------------------------
console.log(`live bundle: ${LIVE} (${live.length} lines)\n`);
const files = corpusFiles(join(ROOT, 'audit')).concat(corpusFiles(join(ROOT, 'tests')));
let checked = 0, ok = 0;
const problems = [];

for (const bundle of retiredBundles()) {
  const hash = bundle.slice(5, 13);
  const old = lines(bundle);
  const re = new RegExp(`core\\.${hash}\\.js:(\\d+)(?:-(\\d+))?`, 'g');
  const hits = [];
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(re)) {
      const a = Number(m[1]); const b = m[2] ? Number(m[2]) : a;
      for (let L = a; L <= Math.min(b, a + 400); L++) hits.push([f, L]);
    }
  }
  if (!hits.length) { console.log(`${bundle}  ${String(old.length).padStart(6)} lines   no line-citations in the corpus`); continue; }
  const map = align(old, live);
  let good = 0;
  for (const [f, L] of hits) {
    checked++;
    const t = map.get(L);
    if (t && old[L - 1] === live[t - 1]) { ok++; good++; }
    else problems.push(`${f}  core.${hash}.js:${L}`);
  }
  const iv = intervals(map, old.length);
  console.log(`${bundle}  ${String(old.length).padStart(6)} lines   ${good}/${hits.length} citations resolve   ${iv.length} intervals`);
  if (iv.length <= 8) for (const r of iv) console.log(`    ${String(r.from).padStart(6)} - ${String(r.to).padStart(6)}   ${r.off === null ? 'NO TARGET' : (r.off >= 0 ? '+' : '') + r.off}`);
}

console.log(`\n${ok}/${checked} cited lines are byte-identical at their mapped position`);
if (problems.length) {
  console.log(`\n${problems.length} citation(s) do not resolve — the cited line changed or moved:`);
  for (const p of problems.slice(0, 40)) console.log(`  ${p}`);
  process.exit(1);
}
console.log('OK');
