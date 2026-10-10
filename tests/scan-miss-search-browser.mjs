// 2026-10-10: the ID-scan miss screen's "Search by name" must reach the real
// lookup search box, and "jump to results" fallbacks must name an element
// that exists. Real Chromium against the local index.html.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : (fail++, console.log('  FAIL', n, d)); };
const idx = readFileSync(join(root, 'index.html'), 'utf8');
const core = idx.match(/\/js\/(core\.[0-9a-f]{8}\.js)/)[1];
const src = readFileSync(join(root, 'js', core), 'utf8');
check('no code reference to the nonexistent cardSearchInput', !src.split('\n').some(l => l.includes('cardSearchInput') && !l.trim().startsWith('//')));
check('miss screen button calls the search helper', /cancelScan\(\);_scanMissSearchByName\(\)"[^>]*>Search by name</.test(src));
check('every results-scroll fallback ends at resultsArea',
  (src.match(/getElementById\('sellSection'\) \|\| document\.getElementById\('platformCards'\)(?! \|\| document\.getElementById\('resultsArea'\))/g) || []).length === 0);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = createServer((q, s) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); p = join(root, p === '/' ? 'index.html' : p);
  if (!existsSync(p)) { s.statusCode = 404; return s.end(); } s.setHeader('content-type', types[extname(p)] || 'application/octet-stream'); s.end(readFileSync(p)); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const page = await browser.newPage({ viewport });
    await page.addInitScript(() => localStorage.setItem('cs_landing_seen', '1'));
    await page.route('**/*', r => r.request().url().startsWith(origin) ? r.continue() : r.fulfill({ status: 204, body: '' }));
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._scanMissSearchByName === 'function', null, { timeout: 15000 });
    check(`${viewport.width}px: results area exists`, await page.evaluate(() => !!document.getElementById('resultsArea')));
    // Leave the lookup view first, so the helper must switch back.
    await page.evaluate(() => { try { switchView('collection'); } catch (_) {} document.activeElement?.blur?.(); });
    const ok = await page.evaluate(() => window._scanMissSearchByName());
    const state = await page.evaluate(() => {
      const si = document.getElementById('searchInput'), r = si.getBoundingClientRect();
      return { focused: document.activeElement === si, visible: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight };
    });
    check(`${viewport.width}px: helper reports success`, ok === true);
    check(`${viewport.width}px: search box is focused`, state.focused);
    check(`${viewport.width}px: search box is visible on screen`, state.visible, JSON.stringify(state));
    check(`${viewport.width}px: no page errors`, errors.length === 0, errors.join(' | '));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`scan-miss-search-browser: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
