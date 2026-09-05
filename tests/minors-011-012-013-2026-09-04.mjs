/**
 * SOL-PLAT-011 / 012 / 013 regression — 2026-09-04
 *
 * 011  Gold text failed AA on light surfaces; purple button label failed AA.
 * 012  pricing.html (and the other public pages) had no social preview image.
 * 013  No CSP; user API keys persisted to localStorage.
 *
 * These assert measured contrast and storage behaviour, not just that a string
 * is present, so a future colour tweak that quietly drops below 4.5:1 fails.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const idx = read('index.html');
const vercel = JSON.parse(read('vercel.json'));

let pass = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) pass++;
  else fails.push(msg);
}
function eq(actual, expected, msg) {
  ok(actual === expected, `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/* ── WCAG 2.x relative luminance / contrast ─────────────────────────── */
function lum(hex) {
  const h = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
// Self-check the contrast maths against WCAG's own reference pairs, so a bug
// in this helper can't silently green the colour assertions below.
ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01, 'contrast(): black/white must be 21:1');
ok(Math.abs(contrast('#777777', '#ffffff') - 4.48) < 0.02, 'contrast(): #777 on white must be ~4.48:1');
ok(Math.abs(contrast('#ffffff', '#ffffff') - 1) < 1e-9, 'contrast(): identical colours must be 1:1');

/* ── token extraction ───────────────────────────────────────────────── */
function themeBlock(sel) {
  const at = idx.indexOf(sel);
  ok(at !== -1, `theme block ${sel} must exist`);
  const body = idx.slice(at, idx.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}
const LIGHT = themeBlock(':root, [data-theme="light"]');
const DARK = themeBlock('[data-theme="dark"] {');

/* ═══ SOL-PLAT-011 ═══════════════════════════════════════════════════ */

ok('gold-text' in LIGHT, '011: light theme must define --gold-text');
ok('gold-text' in DARK, '011: dark theme must define --gold-text');

// Every light surface gold text can legitimately land on. If a new surface
// token is added, add it here too.
const LIGHT_SURFACES = ['bg', 'surface', 'surface-2', 'surface-off', 'gold-hi', 'orange-bg', 'green-bg', 'red-bg']
  .filter((k) => k in LIGHT).map((k) => [k, LIGHT[k]]);
ok(LIGHT_SURFACES.length >= 6, '011: expected at least 6 light surface tokens to test against');

for (const [name, bg] of LIGHT_SURFACES) {
  const r = contrast(LIGHT['gold-text'], bg);
  ok(r >= 4.5, `011: --gold-text ${LIGHT['gold-text']} on --${name} ${bg} is ${r.toFixed(2)}:1, below AA 4.5`);
}
// Body and muted text must also still pass, so this fix can't mask a regression.
for (const fg of ['text', 'text-muted']) {
  for (const [name, bg] of LIGHT_SURFACES.filter(([n]) => ['bg', 'surface', 'surface-2'].includes(n))) {
    const r = contrast(LIGHT[fg], bg);
    ok(r >= 4.5, `011: --${fg} on --${name} is ${r.toFixed(2)}:1, below AA 4.5`);
  }
}
// The raw brand gold must NOT be used as normal text on light any more.
const rawGoldOnLight = contrast(LIGHT.gold, LIGHT.bg);
ok(rawGoldOnLight < 4.5,
  `011: sanity — raw --gold was supposed to be the failing value (${rawGoldOnLight.toFixed(2)}:1); if it now passes, this fix is obsolete and the test needs revisiting`);

// Dark rendering must be untouched: --gold-text there is the same value as --gold.
eq(DARK['gold-text'], DARK.gold, '011: dark --gold-text must equal dark --gold so dark theme renders identically');
ok(contrast(DARK['gold-text'], DARK.bg) >= 4.5,
  `011: dark --gold-text on dark --bg is ${contrast(DARK['gold-text'], DARK.bg).toFixed(2)}:1, below AA`);

// No text usage may still point at the raw brand token. The negative lookbehind
// matters: border-color:, accent-color:, border-top-color: and background-color:
// all END with the literal "color:", and must NOT be counted or rewritten.
const textGold = [...idx.matchAll(/(?<![-a-zA-Z])color:var\(--gold\)/g)].length;
eq(textGold, 0, '011: no `color:var(--gold)` text usage may remain — it fails AA on light');
const textGoldToken = [...idx.matchAll(/(?<![-a-zA-Z])color:var\(--gold-text\)/g)].length;
eq(textGoldToken, 125, '011: expected 125 gold text usages repointed to --gold-text');

// Fills, borders and accents must keep the original brand colour.
eq((idx.match(/background:var\(--gold\)/g) || []).length, 63, '011: background:var(--gold) count must be unchanged');
eq((idx.match(/border-color:var\(--gold\)/g) || []).length, 35, '011: border-color:var(--gold) count must be unchanged');
eq((idx.match(/border-top-color:var\(--gold\)/g) || []).length, 8, '011: border-top-color:var(--gold) count must be unchanged');
eq((idx.match(/accent-color:var\(--gold\)/g) || []).length, 3, '011: accent-color:var(--gold) count must be unchanged');

// Purple button: white label on a purple fill.
const btn = idx.match(/background:(#[0-9a-fA-F]{6});color:#fff;border:none;border-radius:8px;padding:\.55rem 1rem;font-weight:700;font-size:\.85rem;cursor:pointer">Scan again anyway/);
ok(btn, '011: "Scan again anyway" button must still be present with an explicit fill');
if (btn) {
  const r = contrast('#ffffff', btn[1]);
  ok(r >= 4.5, `011: white label on ${btn[1]} is ${r.toFixed(2)}:1, below AA 4.5`);
  ok(btn[1].toLowerCase() !== '#8b5cf6', '011: button must not use the original #8b5cf6 (4.23:1 with white)');
}
// The slider accent is not text and must be left alone.
eq((idx.match(/accent-color:#8b5cf6/g) || []).length, 1, '011: slider accent-color:#8b5cf6 must be untouched (not text)');

/* ═══ SOL-PLAT-012 ═══════════════════════════════════════════════════ */

const OG_IMG = 'https://www.cardresell.org/og-image.png';
for (const f of ['index.html', 'pricing.html', 'about.html', 'contact.html', 'accuracy.html']) {
  const h = read(f);
  ok(h.includes(`<meta property="og:image" content="${OG_IMG}"`), `012: ${f} must declare og:image`);
  ok(/<meta name="twitter:image" content="https:\/\/www\.cardresell\.org\/og-image\.png"/.test(h), `012: ${f} must declare twitter:image`);
  eq((h.match(/name="twitter:card"/g) || []).length, 1, `012: ${f} must declare exactly one twitter:card (no duplicate)`);
  eq((h.match(/property="og:image"/g) || []).length, 1, `012: ${f} must declare exactly one og:image`);
  ok(/content="https:\/\//.test(h.match(/<meta property="og:image"[^>]*>/)[0]), `012: ${f} og:image must be an absolute https URL`);
  ok(/<meta property="og:url" content="https:\/\/www\.cardresell\.org/.test(h), `012: ${f} must declare an absolute og:url`);
}
// The shared asset must actually be routed, or every preview 404s.
ok(JSON.stringify(vercel.routes).includes('/og-image.png'), '012: vercel.json must route /og-image.png');

/* ═══ SOL-PLAT-013 ═══════════════════════════════════════════════════ */

// No user API key may be written to localStorage.
ok(!idx.includes("localStorage.setItem('cardsell_openai_key'"), '013: OpenAI key must not be written to localStorage');
ok(!idx.includes("localStorage.setItem('cardsell_tpl_key'"), '013: TPL key must not be written to localStorage');
ok(idx.includes("sessionStorage.setItem('cardsell_openai_key'"), '013: OpenAI key must be written to sessionStorage');
ok(idx.includes("sessionStorage.getItem('cardsell_openai_key')"), '013: OpenAI key must be read from sessionStorage');
// Keys already on disk from an earlier build must be migrated and erased.
ok(idx.includes("localStorage.removeItem('cardsell_openai_key')"), '013: a legacy localStorage OpenAI key must be purged');
ok(idx.includes("localStorage.removeItem('cardsell_tpl_key')"), '013: a legacy localStorage TPL key must be purged');
ok(!/localStorage\.getItem\('cardsell_tpl_key'\)/.test(idx), '013: the TPL key must not be read back from localStorage');

// CSP headers.
const route = vercel.routes.find((r) => r.src === '/(.*)' && r.continue && r.headers);
ok(route, '013: catch-all header route must exist');
const H = route ? route.headers : {};
const csp = H['Content-Security-Policy'] || '';
const cspRO = H['Content-Security-Policy-Report-Only'] || '';
ok(csp, '013: an enforced Content-Security-Policy header must be set');
ok(cspRO, '013: a Content-Security-Policy-Report-Only header must be set');
for (const d of ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'", "form-action 'self'"]) {
  ok(csp.includes(d), `013: enforced CSP must include ${d}`);
}
// The enforced policy must stay origin-independent. A default-src or script-src
// here would silently break inline scripts and third-party SDKs in production.
ok(!/default-src/.test(csp), '013: enforced CSP must NOT set default-src until the report-only pass is clean');
ok(!/script-src/.test(csp), '013: enforced CSP must NOT set script-src until the report-only pass is clean');
// form-action 'self' is only safe because there are no forms at all.
for (const f of ['index.html', 'pricing.html', 'about.html', 'contact.html', 'accuracy.html', 'terms.html', 'privacy.html', 'signin.html']) {
  eq((read(f).match(/<form/g) || []).length, 0, `013: ${f} must have no <form> (form-action 'self' assumes this)`);
}
// The report-only policy must cover every origin the app really uses.
for (const o of [
  'https://www.gstatic.com',            // Firebase auth SDK
  'https://challenges.cloudflare.com',  // Turnstile
  'https://api.pokemontcg.io',
  'https://api.scryfall.com',
  'https://api.lorcana-api.com',
  'https://db.ygoprodeck.com',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
]) {
  ok(cspRO.includes(o), `013: report-only CSP must allow ${o}`);
}
ok(/script-src[^;]*'unsafe-inline'/.test(cspRO), "013: report-only script-src must allow 'unsafe-inline' while scripts remain inline (see SOL-PLAT-007)");
ok(/default-src 'self'/.test(cspRO), "013: report-only CSP must set default-src 'self'");
// Pre-existing headers must survive.
for (const h of ['Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options', 'Permissions-Policy']) {
  ok(H[h], `013: pre-existing ${h} header must be preserved`);
}

/* ── report ─────────────────────────────────────────────────────────── */
if (fails.length) {
  console.error(`\n[minors-011-012-013] ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`[minors-011-012-013] ${pass}/${pass} assertions passed`);
