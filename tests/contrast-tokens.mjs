/**
 * contrast-tokens — WCAG AA sweep over the neutral text tokens.
 *
 * WHY THIS EXISTS
 *
 * `--text-faint` shipped at 1.90:1 (light on --bg) and 1.92:1 (dark on
 * --surface) across 105 references, and the thing that let it sit there was not
 * that nobody looked -- it was that looking was manual. It was measured in the
 * original audit, logged as debt, routed around by a code comment, and then
 * stayed broken, because a measurement written into a document does not fail
 * when someone edits a hex literal.
 *
 * That is the general shape: correct-looking code with nothing pinning it is one
 * refactor from silent breakage. This file is the pin. It re-derives the ratios
 * from the rendered page rather than trusting the numbers recorded in
 * CSS_TOKEN_DEBT.md, so the document and the stylesheet cannot drift apart
 * without something going red.
 *
 * WHAT IT ASSERTS, AND THE TWO NON-OBVIOUS PARTS
 *
 * 1. It composites GRADIENT backdrops instead of skipping them. The dark value
 *    was first solved to #89877e against the four flat surfaces and then
 *    measured 4.41 / 4.31 on two tinted .plan-card gradients. A tint lowers the
 *    contrast a flat-surface measurement promised, so the flat surfaces are not
 *    the worst case. An earlier version of this sweep skipped any element with a
 *    background-image and reported "0 failures" over a 33-node hole.
 *
 * 2. It asserts the SELF-CHECK first. A contrast sweep that silently matches
 *    zero elements passes vacuously and looks identical to a clean bill of
 *    health -- and this sweep selects nodes by computed colour, so a token
 *    rename or a value change makes it match nothing at all. So the node count
 *    is asserted before the ratios. Proved falsifiable by hand on 2026-09-07 by
 *    reverting both tokens: reports 35/35 dark failures at exactly 1.92 on
 *    --surface, corroborating the originally reported figure.
 *
 * MUTATION MATRIX (2026-09-07). Every mutation was verified to have actually
 * applied before its result was recorded -- M-M first ran against a blank line
 * and returned 12/0, which is indistinguishable from a test that cannot fail.
 * A mutation that mutates nothing is a false clean bill of health.
 *
 *   M-J  light --text-faint -> #b3b1ab (as shipped broken)      3 red
 *   M-K  dark  --text-faint -> #4a4840 (as shipped broken)      3 red
 *   M-L  dark  --text-faint -> #89877e (flat-surfaces-only fix) 1 red  <-- see below
 *   M-M  light --text-muted -> #8a8880 (lightened)              2 red
 *   M-N  dark  --text-muted -> #6f6d66 (darkened)               2 red
 *   M-O  light --text-muted -> #18160f (= --text, darker)       1 red  (correct:
 *          raising contrast cannot fail an AA floor, so only the value pin trips)
 *
 * M-L IS THE HONEST WEAK SPOT. #89877e fails AA only on the two tinted
 * .plan-card gradients, and those live in a modal that is not rendered in the
 * default state, so the live sweep never reaches them and only the value pin
 * catches it. The gradient-compositing code above is therefore exercised by the
 * default-state gradients but NOT by the two panels that motivated writing it;
 * those two ratios (4.41 / 4.31) were computed by hand and are recorded in
 * CSS_TOKEN_DEBT.md. Opening the pricing modal inside this sweep would close
 * the gap and is not done here.
 *
 * KNOWN COVERAGE LIMIT, deliberately not papered over: only the default
 * rendered state is swept. Nodes inside closed modals, error states and empty
 * states are never visited, so a pass here is not a whole-app guarantee. Four
 * always-dark #0a0a0a nodes were caught only because they happened to render.
 *
 * ATTRIBUTION LIMIT: light-mode --text-faint is deliberately equal to
 * --text-muted (the light ramp admits no third tier at AA -- see
 * CSS_TOKEN_DEBT.md 2026-09-07). Selecting by computed colour therefore cannot
 * tell the two tokens apart in light mode, so LIGHT_MIN_NODES covers both.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';

const PW = '/home/user/node_modules/playwright/index.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = harness('contrast-tokens');

/* Expected token values. Duplicated from index.html on purpose: if someone
   edits the stylesheet, this file must be edited too, and the edit is where the
   ratio question gets asked again. A test that reads the value out of the file
   it is checking asserts only that the file equals itself. */
const TOKENS = {
  light: { '--text': '#18160f', '--text-muted': '#6b6960', '--text-faint': '#6b6960' },
  dark:  { '--text': '#d4d2cc', '--text-muted': '#918f86', '--text-faint': '#8d8b82' },
};

/* Floors, not exact counts. An exact count turns every unrelated copy change
   into a red assertion and trains people to bump the number without reading. */
const MIN_NODES = { light: 200, dark: 200 };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};

function startHost() {
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
    catch (_) { res.writeHead(400).end(); return; }
    if (rel === '/') rel = '/index.html';
    const abs = path.resolve(ROOT, '.' + rel);
    if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(abs, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
      res.writeHead(200, {
        'content-type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(buf);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

/* Runs in the page. Returns, for every rendered text node whose computed colour
   equals one of the tokens, the WORST contrast ratio across every opaque
   backdrop the element could be sitting on -- including each individual stop of
   any gradient in its ancestor chain. */
function sweep(tokenHexes) {
  const px = (s) => {
    const m = (s || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const a = m[1].split(',').map(parseFloat);
    return [a[0], a[1], a[2], a.length > 3 ? a[3] : 1];
  };
  const hex = (a) => '#' + a.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
  const comp = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat([1]);
  const lum = (a) => {
    const c = a.slice(0, 3).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const cr = (x, y) => {
    const l1 = lum(x), l2 = lum(y);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const gradientStops = (s) => {
    const out = []; const re = /rgba?\([^)]+\)/g; let m;
    while ((m = re.exec(s || ''))) { const c = px(m[0]); if (c) out.push(c); }
    return out;
  };

  function backdrops(el) {
    const chain = []; let n = el;
    while (n) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') {
        const st = gradientStops(s.backgroundImage);
        chain.push(st.length ? st : [[0, 0, 0, 0]]);
      }
      const bc = px(s.backgroundColor);
      if (bc && bc[3] > 0) { chain.push([bc]); if (bc[3] === 1) break; }
      n = n.parentElement;
    }
    let bases = [[255, 255, 255, 1]];
    for (let i = chain.length - 1; i >= 0; i--) {
      const next = [];
      for (const base of bases) for (const s of chain[i]) next.push(comp(s, base));
      bases = next;
      if (bases.length > 64) bases = bases.slice(0, 64); // combinatorial guard
    }
    return bases;
  }

  const out = [];
  document.querySelectorAll('*').forEach((el) => {
    if (['SCRIPT', 'STYLE', 'TITLE', 'META', 'LINK', 'HEAD'].includes(el.tagName)) return;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.visibility === 'hidden' || cs.display === 'none' || r.width === 0 || r.height === 0) return;
    const c = px(cs.color);
    if (!c || c[3] === 0) return;
    const h = hex(c);
    if (!tokenHexes.includes(h)) return;
    const fs = parseFloat(cs.fontSize), fw = +cs.fontWeight;
    const need = (fs >= 24 || (fs >= 18.66 && fw >= 700)) ? 3.0 : 4.5;
    let worst = Infinity, wbg = null;
    for (const bg of backdrops(el)) {
      const v = cr(c, bg);
      if (v < worst) { worst = v; wbg = hex(bg); }
    }
    out.push({
      cls: (typeof el.className === 'string' ? el.className : '') || el.tagName,
      fs, need, worst: +worst.toFixed(2), color: h, bg: wbg,
      txt: el.textContent.trim().slice(0, 40),
    });
  });
  return out;
}

const { server, port } = await startHost();
const _pw = (await import(PW)).default;
const browser = await _pw.chromium.launch();

try {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ colorScheme: theme, viewport: { width: 720, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    /* Token values resolve as declared. If this fails, every ratio below is
       measuring some other colour and the sweep's silence means nothing. */
    const resolved = await page.evaluate((names) => {
      const cs = getComputedStyle(document.documentElement);
      const toHex = (v) => {
        const d = document.createElement('div');
        d.style.color = v.trim(); document.body.appendChild(d);
        const c = getComputedStyle(d).color; d.remove();
        const m = c.match(/(\d+),\s*(\d+),\s*(\d+)/);
        return m ? '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('') : null;
      };
      const o = {};
      for (const n of names) o[n] = toHex(cs.getPropertyValue(n));
      return o;
    }, Object.keys(TOKENS[theme]));

    for (const [name, want] of Object.entries(TOKENS[theme])) {
      T.check(
        `${theme}: ${name} resolves to ${want}`,
        resolved[name] === want,
        `resolved ${resolved[name]}, expected ${want}`,
      );
    }

    /* Select by the values the page ACTUALLY resolved, not by the values this
       file expects. That distinction is what stops the ratio assertion going
       vacuous: if someone edits a token, `resolved` follows the edit, the sweep
       still visits the same DOM nodes, and the ratio assertion goes red on the
       real new contrast -- while the value assertions above independently go red
       on the change itself. Selecting by the EXPECTED values instead means a
       token edit makes the sweep match nothing and pass over an empty set.
       Demonstrated 2026-09-07: mutations M-J/M-K/M-L each tripped only the value
       assertion and left the sweep green across 0 measured nodes. */
    const nodes = await sweepPage(page, Object.values(resolved).filter(Boolean));

    /* SELF-CHECK BEFORE RATIOS. A sweep matching zero nodes passes vacuously
       and is indistinguishable from a clean result. Asserted first so the
       failure message points at the instrument, not at the stylesheet. */
    T.check(
      `${theme}: sweep matched ${nodes.length} rendered token text nodes (floor ${MIN_NODES[theme]}) — the instrument found something to measure`,
      nodes.length >= MIN_NODES[theme],
      `matched ${nodes.length}, floor ${MIN_NODES[theme]} — a vacuous pass looks identical to a clean result`,
    );

    const fails = nodes.filter((n) => n.worst < n.need);
    T.check(
      `${theme}: every neutral text token clears WCAG AA on its worst backdrop, gradients composited`,
      fails.length === 0,
      fails.map((f) => `${f.worst} < ${f.need} at ${f.fs}px .${f.cls} "${f.txt}" on ${f.bg}`).join('\n       → '),
    );

    /* The specific node that made this a release blocker. .field-label carries
       the TRS confirmation select, so it is named rather than left to the
       aggregate -- an aggregate assertion that goes green tells you nothing
       about which node was the reason you wrote it. */
    const label = nodes.find((n) => String(n.cls).includes('field-label'));
    if (label) {
      T.check(
        `${theme}: .field-label measures ${label.worst}:1 (was 1.90 light / 1.92 dark; labels the TRS select)`,
        label.worst >= 4.5,
        `.field-label at ${label.worst}:1 on ${label.bg}`,
      );
    }

    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

async function sweepPage(page, hexes) {
  return page.evaluate(
    ([fnSrc, h]) => new Function('return ' + fnSrc)()(h),
    [sweep.toString(), hexes],
  );
}

T.done();
