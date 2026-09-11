#!/usr/bin/env node
// tools/compare-cert-generation.mjs
//
// Answers ONE question: which portal-visible Cert ID generation, if any, is
// the value currently stored in Vercel?
//
// It prints only the matched generation label, or "no match". It never echoes
// an entered value, never writes one to disk, and makes no network request of
// any kind. Nothing here authenticates; nothing here reaches eBay or Vercel.
//
//   node tools/compare-cert-generation.mjs
//
// Operator-run. Entered values come from the operator's own clipboard: the
// Vercel-stored value (EBAY_CERT_ID is stored `encrypted`, not `sensitive`,
// so the owner can reveal it) and each generation the portal currently lists.
//
// What a match establishes: the configured value IS that generation.
// What "no match" establishes: it is none of the generations the portal
// currently DISPLAYS. Expired generations that are no longer shown cannot be
// ruled in or out, so "no match" leaves the configured generation UNKNOWN
// rather than establishing it is absent.

import { createInterface } from 'node:readline';
import { createHash, timingSafeEqual } from 'node:crypto';

/** Fixed-width digest so comparison never depends on length, and so nothing
 *  derived from a value is ever displayed. */
export const fingerprint = (v) => createHash('sha256').update(String(v).trim(), 'utf8').digest();

export function matchGeneration(stored, generations) {
  const s = fingerprint(stored);
  for (const g of generations) {
    if (timingSafeEqual(s, fingerprint(g.value))) return { matched: true, label: g.label };
  }
  return { matched: false, label: null };
}

/** True when the entered text still carries the transport defect. Reported as
 *  a boolean; the value is never shown. */
export const hasEdgeWhitespace = (v) => v !== String(v).trim() || /\\n$/.test(v);

async function hidden(prompt) {
  process.stdout.write(prompt);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const onData = (ch) => {
    const s = ch.toString();
    if (s === '\r' || s === '\n' || s === '\u0004') return;
    process.stdout.write('\u001b[2K\u001b[200D' + prompt);
  };
  process.stdin.on('data', onData);
  try {
    return await new Promise((res) => rl.question('', (a) => { rl.close(); res(a); }));
  } finally {
    process.stdin.removeListener('data', onData);
    process.stdout.write('\n');
  }
}

async function main() {
  if (!process.stdin.isTTY) {
    console.error('Refusing to run without a TTY: piped input would appear in shell history.');
    process.exit(2);
  }
  console.log('Compare the Vercel-stored Cert ID against the portal-visible generations.');
  console.log('Nothing entered is echoed, stored, or sent anywhere.\n');

  const stored = await hidden('Vercel-stored EBAY_CERT_ID: ');
  if (!stored) { console.error('Nothing entered.'); process.exit(2); }
  if (hasEdgeWhitespace(stored)) {
    console.log('NOTE: the entered text has leading/trailing whitespace or a literal \\n.');
    console.log('      That is an input-handling observation about what was pasted here.');
    console.log('      It does NOT establish that the Vercel-stored value is wrong.');
  }

  const n = Number(await new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question('How many generations does the portal currently list? ', (a) => { rl.close(); res(a); });
  }));
  if (!Number.isInteger(n) || n < 1 || n > 10) { console.error('Expected 1-10.'); process.exit(2); }

  const generations = [];
  for (let i = 1; i <= n; i++) {
    const label = await new Promise((res) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(`  Generation ${i} label (e.g. "current" / "grace, expires 2026-11-08"): `, (a) => { rl.close(); res(a); });
    });
    const value = await hidden(`  Generation ${i} value: `);
    if (!value) { console.error('Nothing entered.'); process.exit(2); }
    generations.push({ label: label || `generation ${i}`, value });
  }

  const r = matchGeneration(stored, generations);
  console.log('\n--- result ---');
  if (r.matched) {
    console.log(`MATCH: the Vercel-stored Cert ID is the generation labelled "${r.label}".`);
    console.log('Established: the configured value is that generation.');
  } else {
    console.log('NO MATCH against any generation the portal currently displays.');
    console.log('NOT established: that it is absent. Expired generations no longer');
    console.log('shown cannot be ruled in or out, so the configured generation');
    console.log('remains UNKNOWN. The rotation may replace it either way.');
  }
  console.log('\nThis comparison makes no authentication request. Run the single token');
  console.log('exchange separately, on this exact pair.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('failed:', e?.message ?? 'unknown'); process.exit(1); });
}
