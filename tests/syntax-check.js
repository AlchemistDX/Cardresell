const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
const targets = files.length ? files : [
  '/home/user/workspace/cardresell/index.html',
  '/home/user/workspace/cardresell/signin.html',
];

// Classic inline scripts (skip src=, JSON, and module — modules checked separately)
const classicRe = /<script(?![^>]*\bsrc=)(?![^>]*\btype=["']application\/(?:json|ld\+json)["'])(?![^>]*\btype=["']module["'])[^>]*>([\s\S]*?)<\/script>/gi;
// Module inline scripts
const moduleRe = /<script(?![^>]*\bsrc=)[^>]*\btype=["']module["'][^>]*>([\s\S]*?)<\/script>/gi;

let totalErrors = 0;
let totalBlocks = 0;

for (const file of targets) {
  if (!fs.existsSync(file)) {
    console.log(`SKIP (missing): ${file}`);
    continue;
  }
  const html = fs.readFileSync(file, 'utf8');
  const name = path.basename(file);

  // Classic blocks — must parse as a plain function body
  let m, i = 0;
  while ((m = classicRe.exec(html)) !== null) {
    i++; totalBlocks++;
    try { new Function(m[1]); }
    catch (e) {
      totalErrors++;
      const line = html.slice(0, m.index).split('\n').length;
      console.log(`[${name}] CLASSIC block #${i} at line ~${line}: ${e.message}`);
    }
  }

  // Module blocks — modules permit top-level await, so wrap in async function
  // and strip import/export statements (new Function can't handle them but the
  // browser can, and they're just declarations we don't need to validate).
  let mm, j = 0;
  while ((mm = moduleRe.exec(html)) !== null) {
    j++; totalBlocks++;
    const stripped = mm[1]
      .replace(/^\s*import\s+[^;]+;?\s*$/gm, '')
      .replace(/^\s*export\s+/gm, '');
    try { new Function(`return (async function(){ ${stripped} })`); }
    catch (e) {
      totalErrors++;
      const line = html.slice(0, mm.index).split('\n').length;
      console.log(`[${name}] MODULE block #${j} at line ~${line}: ${e.message}`);
    }
  }

  console.log(`[${name}] Checked ${i} classic + ${j} module <script> blocks`);
}

console.log(`Total: ${totalBlocks} blocks, ${totalErrors} error(s)`);
process.exit(totalErrors ? 1 : 0);
