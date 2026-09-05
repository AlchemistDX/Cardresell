// Regressions for the 2026-09-04 bulk-scan misfire report.
// Two independent bugs, four fixes. Each assertion below pins a fix that was
// verified against live data before it was written:
//   * pokemontcg.io returned HTTP 500 on 5 of 8 identical queries (62%).
//   * /api/tcg-price had price + imageUrl for every card that came back blank:
//     Minun #194 $44.78, Cresselia #071 $26.49, Ivysaur #134 $19.64,
//     Bulbasaur #133 $20.87.
//   * api/tcg-price.js emits `imageUrl`; it has never emitted `image`.
import { readFileSync } from 'node:fs';
import { readAppSource } from './_appsource.mjs';
const h = readAppSource();
const api = readFileSync(new URL('../api/tcg-price.js', import.meta.url), 'utf8');
let fail = 0;
const ok = (name, cond) => { if (!cond) { console.error('FAIL: ' + name); fail++; } else console.log('pass: ' + name); };

function slice(startRe, endRe, label) {
  const s = h.search(startRe);
  if (s < 0) throw new Error('anchor not found: ' + label);
  const rest = h.slice(s + 10);
  const e = rest.search(endRe);
  return e < 0 ? h.slice(s) : h.slice(s, s + 10 + e);
}

// ── Fix 1: pokemontcg.io is no longer a single point of failure ──────────
const pokePath = slice(/async function _bulkFetchPrice\(/, /\nasync function |\nfunction /, 'bulk price dispatcher');
ok('bulk Pokemon path falls back to /api/tcg-price when pokemontcg.io returns nothing',
   /if \(!cards \|\| !cards\.length\)\s*\{[\s\S]{0,900}?(\/api\/tcg-price|_bulkTcgPriceShim)/.test(pokePath));
ok('the fallback is reached before giving up (no bare early return on empty cards)',
   !/if \(!cards \|\| !cards\.length\) return null;/.test(pokePath));
ok('fallback only accepts a positive market price',
   /rFb\.ok[\s\S]{0,200}?d\.market > 0/.test(pokePath)
   || /_bulkTcgPriceShim/.test(pokePath));
ok('fallback carries an image through so the row is never priced-but-blank',
   /rFb[\s\S]{0,600}?imageUrl: d\.imageUrl \|\| d\.image/.test(pokePath));

// ── Fix 2: read the field the API actually returns ───────────────────────
ok('api/tcg-price.js really does emit imageUrl', /imageUrl:/.test(api));
ok('api/tcg-price.js does not emit a bare `image` field (so d.image alone is dead)',
   !/^\s*image:/m.test(api));
const deadImageReads = h.match(/imageUrl: [^\n]*\|\| d\.image \|\| /g) || [];
ok('no bulk fallback reads d.image without trying d.imageUrl first',
   !/(?<!imageUrl \|\| )\bd\.image\b/.test(h.replace(/d\.imageUrl \|\| d\.image/g, 'OK')));
ok('all three bulk fallbacks prefer d.imageUrl',
   (h.match(/d\.imageUrl \|\| d\.image/g) || []).length >= 3);

// ── Fix 3: one card's price can never sit under another card's art ───────
const swap = slice(/function _beginCardSwap\(/, /\nfunction _endCardSwap/, '_beginCardSwap');
ok('_beginCardSwap bumps the image generation', /window\._imgGen = \(window\._imgGen \|\| 0\) \+ 1;/.test(swap));
ok('_beginCardSwap also removes a stale #scanMissPanel', /getElementById\('scanMissPanel'\)/.test(swap));
ok('the stale panel is actually detached, not just hidden',
   /_stalePanel\.parentNode\.removeChild\(_stalePanel\)/.test(swap));
// Order matters only in that both happen in the same synchronous block.
ok('panel removal is synchronous inside _beginCardSwap (no await/setTimeout)',
   !/await |setTimeout/.test(swap.slice(swap.indexOf('_stalePanel'))));

const enrich = slice(/async function _enrichMissPanelWithPriceCharting\(/, /\nasync function |\nfunction /, 'PC enrichment');
ok('PC enrichment snapshots the card generation', /const _pcGenSnap = window\._imgGen \|\| 0;/.test(enrich));
ok('PC enrichment discards a write that belongs to a retired card',
   /\(window\._imgGen \|\| 0\) !== _pcGenSnap\) return;/.test(enrich));
ok('the generation guard sits AFTER the await, where staleness is observable',
   enrich.indexOf('await fetch') < enrich.indexOf('!== _pcGenSnap'));
ok('the isConnected guard is kept alongside the generation guard',
   /panel\.isConnected/.test(enrich));

// ── Fix 4: no leftover dropdown over a resolved card ─────────────────────
const openIn = slice(/async function bulkOpenCardInLookup\(/, /\nfunction _showBackToBulkPill/, 'bulkOpenCardInLookup');
ok('bulk row tap closes the search dropdown', /closeSearchModal\(\)/.test(openIn));
ok('dropdown is closed before the overlay is paused',
   openIn.indexOf('closeSearchModal') < openIn.indexOf("getElementById('bulkScanOverlay')"));

// ── Standing product rules ──────────────────────────────────────────────
ok('no "beta" wording anywhere', !/beta/i.test(h));
// The 1F6E0 glyph itself is legitimately used as the "List now" / "List & ship
// yourself" workflow icon, so the raw emoji must NOT be asserted absent. What
// must stay absent is the maintenance MARKER — the emoji paired with
// maintenance/unavailable wording that was withdrawn from the UI.
ok('no maintenance marker wording paired with the tools glyph',
   !/\u{1F6E0}\uFE0F?[^\n]{0,40}(maintenance|unavailable|temporarily|down for)/iu.test(h));
ok('no "under maintenance" copy in the UI', !/under maintenance/i.test(h));

console.log(fail ? `\n${fail} FAILED` : '\nall bulk-scan misfire regressions pass');
process.exit(fail ? 1 : 0);
