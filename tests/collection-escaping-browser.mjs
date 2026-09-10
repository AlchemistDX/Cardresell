/**
 * The Collection renderer must not let seller text or third-party image URLs
 * escape the attribute they are interpolated into.
 *
 * WHY THIS SUITE EXISTS. On 2026-09-10 the bundle carried three separate
 * `esc2` helpers escaping three different character sets, and the one used by
 * renderCollectionView escaped `& < >` but NOT `"` — while interpolating into
 * double-quoted attributes: `src="${esc2(thumb)}"` and `title="${esc2(p.card)}"`.
 * A `"` in a card name or a thumbnail URL closes the attribute early and the
 * remainder is parsed as further attributes. Card names are seller-entered and
 * thumbnail URLs come from third-party card data.
 *
 * WHY IT DRIVES THE REAL RENDERER. A source assertion that "the helper is
 * called" would pass against a second helper that is called and wrong — which
 * is exactly the defect that existed. So this suite seeds the real
 * localStorage key, loads the real bundle in a real browser, calls the real
 * renderCollectionView(), and reads the resulting DOM. The question it asks is
 * not "which function was called" but "where did the value end up".
 *
 * WHAT IT ASSERTS, per hostile value:
 *   1. the value stays inside its intended attribute, byte for byte;
 *   2. the element gains no attribute the renderer did not write;
 *   3. no element is created that the renderer did not write;
 *   4. ordinary display survives — the visible text is the plain original,
 *      not an entity-mangled version of it.
 *
 * Escaping that breaks display is not a fix. Both halves are required.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = '/home/user/node_modules/playwright/index.js';
const PORT = Number(process.env.CR_ESCAPING_PORT || 8327);
const B = `http://127.0.0.1:${PORT}`;

const { check, done } = harness('collection-escaping-browser');

// ── server ─────────────────────────────────────────────────────────────────
const srv = spawn('node', ['tools/dev-draft-server.mjs'], {
  cwd: ROOT, env: { ...process.env, DEV_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let srvLog = '';
srv.stdout.on('data', (d) => { srvLog += d; });
srv.stderr.on('data', (d) => { srvLog += d; });
await new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = setInterval(() => {
    if (/dev-draft-server on /.test(srvLog)) { clearInterval(tick); resolve(); }
    else if (Date.now() - t0 > 20000) { clearInterval(tick); reject(new Error('dev server did not start: ' + srvLog)); }
  }, 100);
});
const shutdown = () => { try { srv.kill('SIGKILL'); } catch (_) {} };
process.on('exit', shutdown);

// ── the hostile rows ───────────────────────────────────────────────────────
// Every one of these is a value a seller could type or a card API could
// return. None of them is exotic: a quote inside a card name is ordinary
// punctuation, and query strings with quotes appear in real image CDNs.
const ATTACK_NAME  = 'Charizard" onmouseover="window.__pwned=1" data-x="';
const ATTACK_THUMB = 'https://img.example.com/c.png?q=1" onerror="window.__pwned=2" data-y="';
const QUOTED_NAME  = 'Pikachu "Birthday" Promo';
const AMP_SET      = 'Sword & Shield <Promo>';

const ROWS = [
  { id: 901, card: ATTACK_NAME, set: AMP_SET, buyPrice: 10, currentValue: 12, img: ATTACK_THUMB },
  { id: 902, card: QUOTED_NAME, set: 'Base Set', buyPrice: 5, currentValue: 6,
    img: 'https://img.example.com/p.png', grader: 'psa', grade: 10 },
];

const { chromium } = (await import(PW)).default;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.addInitScript((rows) => {
  try { localStorage.setItem('cardsell_portfolio', JSON.stringify(rows)); } catch (_) {}
}, ROWS);
await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.renderCollectionView === 'function', null, { timeout: 20000 });

// Render through the real entry point, then read the real DOM back.
const shot = await page.evaluate(() => {
  window.renderCollectionView();
  const wrap = document.getElementById('collectionWrap');
  const rows = [...wrap.querySelectorAll('tr.col-row')];
  const read = (tr) => {
    const img = tr.querySelector('td.col-thumb img');
    const nameDiv = tr.querySelector('.ft-card');
    const setCell = tr.querySelector('td.ft-set');
    const soldBtn = [...tr.querySelectorAll('button')].find(b => /Sold/.test(b.textContent));
    const names = (el) => el ? [...el.attributes].map(a => a.name).sort() : null;
    return {
      imgSrc: img ? img.getAttribute('src') : null,
      imgAttrs: names(img),
      imgTagCount: tr.querySelectorAll('td.col-thumb img').length,
      thumbCellChildTags: [...(tr.querySelector('td.col-thumb > div')?.children || [])].map(e => e.tagName),
      nameTitle: nameDiv ? nameDiv.getAttribute('title') : null,
      nameAttrs: names(nameDiv),
      nameText: nameDiv ? nameDiv.textContent : null,
      nameChildTags: nameDiv ? [...nameDiv.children].map(e => e.tagName) : null,
      setText: setCell ? setCell.textContent : null,
      setChildTags: setCell ? [...setCell.children].map(e => e.tagName) : null,
      soldTitle: soldBtn ? soldBtn.getAttribute('title') : null,
      soldAttrs: names(soldBtn),
      cellCount: tr.children.length,
    };
  };
  return {
    rowCount: rows.length,
    rows: rows.map(read),
    pwned: window.__pwned ?? null,
    scriptsInWrap: wrap.querySelectorAll('script').length,
    // Anything the renderer never writes, anywhere under the collection table.
    strayHandlerAttrs: [...wrap.querySelectorAll('*')]
      .flatMap(el => [...el.attributes].map(a => a.name))
      .filter(n => /^on(error|mouseover|load|focus|toggle)$/.test(n)),
    strayDataAttrs: [...wrap.querySelectorAll('*')]
      .flatMap(el => [...el.attributes].map(a => a.name))
      .filter(n => n === 'data-x' || n === 'data-y'),
  };
});

// ── the two rows in sorted order ───────────────────────────────────────────
// The renderer sorts by unrealized gain descending: row 901 gains 2, row 902
// gains 1, so 901 is first. Asserted rather than assumed, because reading the
// wrong row would make every check below vacuous.
check('the renderer produced both rows', shot.rowCount === 2,
      'got ' + shot.rowCount + ' rows; every assertion below reads one of them');
const A = shot.rows[0] || {};
const P = shot.rows[1] || {};
check('row order is the documented gain-descending order',
      A.setText === 'Sword & Shield <Promo>',
      'expected the attack row first; got set text ' + JSON.stringify(A.setText));

// ── 1. the value stays inside its attribute ────────────────────────────────
check('a quote-bearing thumbnail URL stays whole inside src',
      A.imgSrc === ATTACK_THUMB,
      'src should be the original bytes; got ' + JSON.stringify(A.imgSrc));
check('a quote-bearing card name stays whole inside title',
      A.nameTitle === ATTACK_NAME,
      'title should be the original bytes; got ' + JSON.stringify(A.nameTitle));
check('the same name stays whole inside the Sold button title',
      A.soldTitle === 'Log sale of ' + ATTACK_NAME + ' and move to Flips',
      'got ' + JSON.stringify(A.soldTitle));
check('an ordinary quoted card name stays whole inside title',
      P.nameTitle === QUOTED_NAME + ' — PSA 10',
      'got ' + JSON.stringify(P.nameTitle));

// ── 2. no attribute the renderer did not write ─────────────────────────────
check('the thumbnail img gains no attribute the renderer did not write',
      Array.isArray(A.imgAttrs)
        && A.imgAttrs.join(',') === ['src', 'loading', 'alt', 'style'].sort().join(','),
      'attributes: ' + JSON.stringify(A.imgAttrs));
check('the card-name div gains no attribute the renderer did not write',
      Array.isArray(A.nameAttrs) && A.nameAttrs.join(',') === ['class', 'title'].sort().join(','),
      'attributes: ' + JSON.stringify(A.nameAttrs));
check('the Sold button gains no attribute the renderer did not write',
      Array.isArray(A.soldAttrs)
        && A.soldAttrs.join(',') === ['type', 'onclick', 'title', 'style'].sort().join(','),
      'attributes: ' + JSON.stringify(A.soldAttrs));
check('no event-handler attribute appears anywhere the renderer never wrote one',
      shot.strayHandlerAttrs.length === 0,
      'found ' + JSON.stringify(shot.strayHandlerAttrs));
check('no attacker data-* attribute is created',
      shot.strayDataAttrs.length === 0,
      'found ' + JSON.stringify(shot.strayDataAttrs));

// ── 3. no element the renderer did not write ───────────────────────────────
check('the row still has exactly its nine cells',
      A.cellCount === 9, 'got ' + A.cellCount + ' cells');
check('the thumbnail cell holds exactly one img and nothing else',
      A.imgTagCount === 1 && A.thumbCellChildTags.join(',') === 'IMG',
      'children: ' + JSON.stringify(A.thumbCellChildTags));
check('a hostile card name creates no child element',
      Array.isArray(A.nameChildTags) && A.nameChildTags.length === 0,
      'children: ' + JSON.stringify(A.nameChildTags));
check('a hostile set value creates no child element',
      Array.isArray(A.setChildTags) && A.setChildTags.length === 0,
      'children: ' + JSON.stringify(A.setChildTags));
check('no script element is injected into the collection',
      shot.scriptsInWrap === 0, 'found ' + shot.scriptsInWrap);
check('no injected handler ever executed',
      shot.pwned === null, 'window.__pwned = ' + JSON.stringify(shot.pwned));
check('the page threw nothing while rendering hostile values',
      pageErrors.length === 0, pageErrors.join(' | '));

// ── 4. ordinary display survives ───────────────────────────────────────────
// Escaping that leaks &amp; or &quot; into what the user reads is a different
// defect, not a fix. textContent is the decoded text, so these compare against
// the plain original.
check('an ampersand-and-angle set renders as its plain text',
      A.setText === AMP_SET, 'got ' + JSON.stringify(A.setText));
check('a quoted card name renders as its plain text',
      P.nameText === 'PSA 10' + QUOTED_NAME || P.nameText.includes(QUOTED_NAME),
      'got ' + JSON.stringify(P.nameText));
check('the hostile name renders as its plain text, quote included',
      A.nameText === ATTACK_NAME, 'got ' + JSON.stringify(A.nameText));
check('the graded row keeps its grade chip as a real element',
      Array.isArray(P.nameChildTags) && P.nameChildTags.join(',') === 'SPAN',
      'children: ' + JSON.stringify(P.nameChildTags));

await browser.close();
shutdown();
done(); // harness().done() emits the SUITE COMPLETE marker and exits
