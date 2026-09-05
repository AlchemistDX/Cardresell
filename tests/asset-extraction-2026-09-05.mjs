/**
 * SOL-PLAT-007 — asset extraction regression guard.
 *
 * index.html used to carry ~1.15 MB of inline JS and ~106 KB of inline CSS,
 * making the document 1.46 MB and entirely uncacheable (HTML is no-cache).
 * The app JS/CSS now lives in content-hashed files under /js and /css that
 * are served immutable for a year.
 *
 * These checks defend the three things that can silently break:
 *   1. Someone re-inlines a big block and quietly undoes the win.
 *   2. Someone removes/reorders the vercel.json routes, so the /(.*) catch-all
 *      swallows asset URLs and serves index.html under a .js name (this is a
 *      real failure mode — /js/photo-qc.js did exactly that in production).
 *   3. Someone moves the auth module tag ABOVE the app scripts. Modules are
 *      always deferred, so today auth runs LAST. Hoisting it reverses the
 *      execution order against ~22 globals the app expects it to set.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (detail ? '\n      ' + detail : '')); }
};

console.log('\nSOL-PLAT-007 \u2014 asset extraction\n');

// ── 1. the document stays small ──────────────────────────────────────────
const bytes = Buffer.byteLength(html);
check('index.html stays under 400 KB', bytes < 400_000,
      `index.html is ${bytes} bytes (was 1,463,755 before extraction)`);

const inlineScripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\ssrc=/.test(m[1]));
const biggest = Math.max(0, ...inlineScripts.map(m => Buffer.byteLength(m[2])));
check('no inline script block exceeds 8 KB', biggest <= 8192,
      `largest inline block is ${biggest} bytes \u2014 app JS belongs in /js/*.js`);

// CSS is deliberately NOT extracted. It is render-blocking, so as an external
// file it costs an extra round-trip before the first paint \u2014 measured on
// throttled 3G, extracting it pushed first paint from 976ms to 2136ms. Inline
// it streams with the document and paints immediately.
const inlineCss = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
  .reduce((n, m) => n + Buffer.byteLength(m[1]), 0);
check('CSS stays inline so the first paint needs no extra round-trip',
      inlineCss > 50_000,
      `only ${inlineCss} bytes inline \u2014 do not move the main sheet to an external file`);
check('no external stylesheet was introduced',
      !/<link\s+rel="stylesheet"\s+href="\/css\//.test(html));

// ── 2. every referenced asset exists and is content-hashed ───────────────
const HASHED = /^\/js\/[A-Za-z0-9_-]+\.[0-9a-f]{8}\.js$/;
const refs = [...html.matchAll(/<script[^>]*\ssrc="(\/js\/[^"]+)"/g)].map(m => m[1]);
check('index.html references the extracted scripts', refs.length >= 5,
      `found ${refs.length} local /js references`);
for (const r of refs) {
  check(`${r} is content-hashed`, HASHED.test(r),
        'un-hashed names cannot be safely cached immutable');
  check(`${r} exists on disk`, fs.existsSync(path.join(ROOT, r.slice(1))));
}

// ── 3. execution order: app scripts, THEN the auth module ────────────────
const appTags = ['config', 'core', 'ui', 'pwa']
  .map(n => ({ n, i: html.search(new RegExp(`<script[^>]*src="/js/${n}\\.[0-9a-f]{8}\\.js"`)) }));
for (const { n, i } of appTags) check(`/js/${n}.*.js is present`, i >= 0);
const ordered = appTags.every((t, k) => k === 0 || t.i > appTags[k - 1].i);
check('app scripts are in order: config \u2192 core \u2192 ui \u2192 pwa', ordered);

const authIdx = html.search(/<script[^>]*type="module"[^>]*src="\/js\/auth\.[0-9a-f]{8}\.js"/);
check('auth module is present', authIdx >= 0);
check('auth module tag comes AFTER every app script',
      authIdx > Math.max(...appTags.map(t => t.i)),
      'modules are always deferred; hoisting this reverses auth vs app order');

for (const { n, i } of appTags) {
  const tag = html.slice(i, html.indexOf('>', i) + 1);
  check(`/js/${n}.*.js is deferred`, /\sdefer\b/.test(tag), tag.slice(0, 90));
}

// ── 4. vercel.json actually deploys and routes them ──────────────────────
const buildSrcs = (vercel.builds || []).map(b => b.src);
check('vercel.json builds js/*.js', buildSrcs.includes('js/*.js'),
      'without a builds entry the files are never deployed');

const routes = vercel.routes || [];
const at = pred => routes.findIndex(pred);
const catchAll = at(r => r.src === '/(.*)' && r.dest === '/index.html');
const jsImm = at(r => /^\/js\/\(\[A-Za-z0-9_-\]/.test(r.src || ''));
check('an immutable /js route exists', jsImm >= 0);
check('the /(.*) catch-all still exists', catchAll >= 0);
check('asset routes precede the catch-all',
      jsImm >= 0 && catchAll >= 0 && jsImm < catchAll,
      'otherwise /js/*.js is served index.html as text/html');

const imm = /max-age=31536000/;
check('hashed /js is immutable for a year', imm.test(routes[jsImm]?.headers?.['Cache-Control'] || ''));

// Un-hashed assets must NOT be cached forever, or a future edit is stuck.
const jsPlain = at(r => r.src === '/js/(.*\\.js)');
check('un-hashed /js falls through to a revalidating route', jsPlain >= 0 && jsPlain > jsImm,
      'photo-qc.js is not hashed and must stay revalidatable');
check('un-hashed /js is NOT immutable',
      !imm.test(routes[jsPlain]?.headers?.['Cache-Control'] || ''));

// HTML itself must stay uncached so a new deploy is picked up immediately.
check('index.html is still no-cache',
      /no-cache|no-store|max-age=0/.test(routes[catchAll]?.headers?.['Cache-Control'] || ''),
      'hashed assets are only safe if the HTML that names them is fresh');

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
