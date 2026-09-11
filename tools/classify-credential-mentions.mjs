#!/usr/bin/env node
// tools/classify-credential-mentions.mjs
//
// Classifies credential mentions in a file WITHOUT emitting any value.
//
// It answers one question per mention: is this prose, a placeholder, or an
// apparent credential value? It reports the line number, the credential type,
// and the environment only where the line states one. It never prints the
// line, a substring of the line, or any matched value.
//
//   node tools/classify-credential-mentions.mjs <file>
//
// No network. No token validation. No history rewriting. Read-only.

import { readFileSync } from 'node:fs';

const TYPES = [
  ['Cert ID',            /cert\s?id|client\s?secret/i],
  ['App ID',             /app\s?id|client\s?id/i],
  ['Dev ID',             /dev\s?id/i],
  ['RuName',             /ru\s?name/i],
  ['Verification token', /verification\s?token/i],
  ['User token',         /user\s?token|auth'?n'?auth/i],
  ['Refresh token',      /refresh\s?token/i],
];

// A placeholder announces itself. Checked before the value heuristic, because
// <YOUR-CERT-ID> is long and token-shaped but is not a value.
const PLACEHOLDER = /<[^>]*>|\{\{.*?\}\}|\bx{6,}|\*{4,}|•{4,}|\byour[-_ ]|\bTODO\b|\bREDACTED\b|\bplaceholder\b|\bexample\b|\.{3,}/i;

/** A run long and mixed enough to be a real secret rather than a word. */
function looksLikeValue(line) {
  // eBay's own documented shapes, then a generic high-entropy run.
  const shapes = [
    /\b(PRD|SBX)-[A-Za-z0-9]{6,}-[A-Za-z0-9]{4,}/,          // App/Cert ID
    /\bv\^1\.1#[A-Za-z0-9+/=_^#*]{20,}/,                     // eBay OAuth token
    /\b[A-Za-z0-9_-]{32,}\b/,                                // long opaque run
  ];
  for (const re of shapes) {
    const m = line.match(re);
    if (!m) continue;
    const s = m[0];
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((c) => c.test(s)).length;
    if (classes >= 2) return true;      // mixed case or digits: not an English word
  }
  return false;
}

function environmentOf(line) {
  if (/\bsandbox\b|\bSBX-/i.test(line)) return 'sandbox (stated)';
  if (/\bproduction\b|\bprod\b|\bPRD-/i.test(line)) return 'production (stated)';
  return 'not stated';
}

const file = process.argv[2];
if (!file) { console.error('usage: node tools/classify-credential-mentions.mjs <file>'); process.exit(1); }

const lines = readFileSync(file, 'utf8').split(/\r?\n/);
const rows = [];

lines.forEach((line, i) => {
  const types = TYPES.filter(([, re]) => re.test(line)).map(([t]) => t);
  if (!types.length) return;
  const classification = PLACEHOLDER.test(line) ? 'placeholder'
    : looksLikeValue(line) ? 'APPARENT CREDENTIAL VALUE'
    : 'prose';
  rows.push({ line: i + 1, types: types.join(' + '), classification, env: environmentOf(line) });
});

console.log(`file: ${file}`);
console.log(`lines scanned: ${lines.length}; mentions found: ${rows.length}`);
console.log('');
console.log('  line | credential type      | classification            | environment');
console.log('  -----+----------------------+---------------------------+------------------');
for (const r of rows) {
  console.log(
    `  ${String(r.line).padStart(4)} | ${r.types.padEnd(20)} | ${r.classification.padEnd(25)} | ${r.env}`
  );
}
// Second pass. A value can sit on a line that names no credential type — under
// a heading, in a code block, on its own. Scanning only labelled lines would
// have missed exactly that, so every line is checked for a value shape.
const unlabelled = [];
lines.forEach((line, i) => {
  const labelled = TYPES.some(([, re]) => re.test(line));
  if (labelled) return;
  if (PLACEHOLDER.test(line)) return;
  if (looksLikeValue(line)) {
    // Name the type WITHOUT printing the value: walk back to the nearest
    // preceding line that carries a type label, and report that label only.
    let inferred = 'none within 6 lines', at = null;
    for (let k = i - 1; k >= 0 && k >= i - 6; k--) {
      const hit = TYPES.filter(([, re]) => re.test(lines[k])).map(([t]) => t);
      if (hit.length) { inferred = hit.join(' + '); at = k + 1; break; }
    }
    unlabelled.push({ line: i + 1, env: environmentOf(line), inferred, at });
  }
});

console.log(`unlabelled lines carrying a value shape: ${unlabelled.length}`);
for (const u of unlabelled) {
  const src = u.at ? ` (from line ${u.at})` : '';
  console.log(`  line ${String(u.line).padStart(4)} | nearest label: ${u.inferred}${src} | ${u.env}`);
}

console.log('');
const values = rows.filter((r) => r.classification === 'APPARENT CREDENTIAL VALUE');
console.log(`apparent values: ${values.length}`);
if (values.length) {
  console.log('Classification only. Presence of a value does not establish that it is');
  console.log('still active; that is an account fact, not a repository fact.');
}
