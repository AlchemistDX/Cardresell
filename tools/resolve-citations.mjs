#!/usr/bin/env node
/**
 * Resolve bundle line-number citations against the current bundle.
 *
 * A citation like `js/core.7f9c03ad.js:6840` names a line in a retired
 * generation. This reads THAT line out of THAT file -- every retired
 * generation is retained on disk, which is what makes this possible -- and
 * looks for the same content in the live bundle. It reports the new line and
 * the enclosing function, or says it could not resolve.
 *
 * It does NOT edit anything. Rewriting a citation is a judgement about
 * whether the citation is live guidance or historical evidence, and that
 * judgement is not something a matcher should make silently.
 *
 * Usage: node tools/resolve-citations.mjs <file.md> [...]
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const LIVE = readdirSync('js')
  .filter((f) => /^core\.[0-9a-f]{8}\.js$/.test(f))
  .find((f) => readFileSync('index.html', 'utf8').includes(`/js/${f}`));
if (!LIVE) throw new Error('could not determine the live bundle from index.html');

const liveLines = readFileSync(`js/${LIVE}`, 'utf8').split('\n');
const liveHash = LIVE.match(/core\.([0-9a-f]{8})\.js/)[1];

// An index from normalized line content -> [line numbers]. Built once.
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const index = new Map();
liveLines.forEach((l, i) => {
  const k = norm(l);
  if (!k || k.length < 12) return; // too generic to identify anything
  if (!index.has(k)) index.set(k, []);
  index.get(k).push(i + 1);
});

// Words that look like a call site but are control flow. Without this the
// matcher happily reports `fn=if()`, which is worse than reporting nothing:
// it reads like a resolved answer.
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'else', 'return', 'function',
  'do', 'try', 'finally', 'typeof', 'await', 'new', 'delete', 'void',
]);

/** Nearest enclosing named function at or above `lineNo` (1-based). */
function enclosingFn(lineNo) {
  const pats = [
    /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)/,
    /^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/,
  ];
  for (let i = lineNo - 1; i >= 0 && i > lineNo - 1200; i -= 1) {
    for (const p of pats) {
      const m = liveLines[i].match(p);
      if (m && !KEYWORDS.has(m[1])) return m[1];
    }
  }
  return null;
}

const CITE = /`?js\/(core\.([0-9a-f]{8})\.js):(\d+)(?:-(\d+))?`?/g;
const rows = [];

for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, 'utf8');
  const seen = new Set();
  let m;
  while ((m = CITE.exec(text)) !== null) {
    const [, name, hash, startS] = m;
    const key = `${name}:${startS}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (hash === liveHash) { rows.push({ file, cite: key, status: 'already-live' }); continue; }

    const path = `js/${name}`;
    if (!existsSync(path)) { rows.push({ file, cite: key, status: 'source-absent' }); continue; }

    const src = readFileSync(path, 'utf8').split('\n');
    const start = Number(startS);
    const content = src[start - 1];
    if (content === undefined) { rows.push({ file, cite: key, status: 'line-out-of-range' }); continue; }

    const hits = index.get(norm(content)) || [];
    if (hits.length === 0) {
      rows.push({ file, cite: key, status: 'gone', was: norm(content).slice(0, 70) });
    } else if (hits.length === 1) {
      rows.push({
        file, cite: key, status: 'resolved', to: hits[0],
        fn: enclosingFn(hits[0]), was: norm(content).slice(0, 70),
      });
    } else {
      rows.push({
        file, cite: key, status: 'ambiguous', to: hits.join(','),
        was: norm(content).slice(0, 70),
      });
    }
  }
}

const by = (s) => rows.filter((r) => r.status === s);
for (const r of rows) {
  const bits = [r.file.replace(/^audit\//, ''), r.cite, r.status];
  if (r.to) bits.push(`-> ${liveHash}:${r.to}`);
  if (r.fn) bits.push(`fn=${r.fn}()`);
  if (r.was) bits.push(`| ${r.was}`);
  console.log(bits.join('  '));
}
console.log('\n--- live bundle:', LIVE);
for (const s of ['resolved', 'ambiguous', 'gone', 'source-absent', 'already-live', 'line-out-of-range']) {
  const n = by(s).length;
  if (n) console.log(`${s}: ${n}`);
}

if (process.env.EMIT_JSON) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.EMIT_JSON, JSON.stringify({ live: LIVE, liveHash, rows }, null, 2));
}
