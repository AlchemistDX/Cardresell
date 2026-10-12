// Real shipped comparison + shared fee engine; all external requests blocked.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import vm from 'node:vm';
const root = resolve(new URL('..', import.meta.url).pathname);
const html = readFileSync(join(root, 'index.html'), 'utf8');
const asset = html.match(/src="\/(js\/grading-paths\.[a-f0-9]+\.js)"/)[1];
const context = {}; vm.createContext(context); vm.runInContext(readFileSync(join(root, asset), 'utf8'), context);
const { calculate, tiers } = context.CardResellGradingPaths;
const now = Date.parse('2026-10-12T16:00:00Z');
let checks = 0;
const check = (v, m) => { assert.ok(v, m); checks++; };
const common = { raw: '100', rawShip: '5', rate: '12' };
const path = { grader: 'CGC', tier: 'custom', outcome: 'Gem Mint 10', sale: '200', fee: '20', shipping: '10', saleShip: '5', days: '10', extra: '6' };
const calc = (c = common, p = path, date = now) => calculate(c, p, price => price * .9, date);
let result = calc();
check(result.rawNet === 85 && result.proceeds === 145, 'post-fee raw and graded proceeds');
check(result.calendarDays === 20, 'working-day conversion plus transit/sale delay');
check(Math.abs(result.holdingCost - 115 * .12 * 20 / 365) < 1e-9, 'opportunity cost on foregone raw net plus submission cash');
check(Math.abs(result.difference - (60 - result.holdingCost)) < 1e-9, 'incremental proceeds after capital cost');
check(calc({ ...common, rate: '0' }).difference === 60, 'optional capital adjustment off');
check(calc(common, { ...path, shipping: '' }).error, 'blank shipping is not silently zero');
check(!calc(common, { ...path, shipping: '0' }).error, 'explicit zero accepted');
for (const bad of ['-1', 'NaN', 'Infinity', '1e9', 'abc']) check(calc(common, { ...path, sale: bad }).error, 'reject invalid sale ' + bad);
check(calc(common, { ...path, outcome: '' }).error, 'require explicit outcome assumption');
const bulk = { ...path, tier: 'cgc-bulk', fee: '17', days: '150', declared: '200', count: '24' };
check(calc(common, bulk).error, 'bulk rejects insufficient count');
check(!calc(common, { ...bulk, count: '25' }).error, 'bulk accepts 25 eligible cards');
check(calc(common, { ...bulk, count: '25.5' }).error, 'fractional submission count refused');
check(calc(common, { ...bulk, count: '25', declared: '501' }).error, 'declared value tier cap');
check(calc(common, { ...bulk, count: '25', sale: '501' }).error, 'sale scenario above tier cap');
check(calc(common, { ...bulk, count: '25', fee: '1' }).error, 'published fee cannot be silently changed');
check(calc(common, { ...bulk, count: '25' }, now + 15 * 86400000).error, 'expired rate snapshot blocks published scenario');
check(!calc(common, path, now + 15 * 86400000).error, 'custom current quotes remain available');
check(calc(common, { ...bulk, grader: 'PSA' }).error, 'CGC tier cannot price PSA');
check(!tiers.some(t => /value/i.test(t.id)), 'paused PSA Value tiers excluded');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((q, s) => {
  const p = join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!existsSync(p)) { s.statusCode = 404; return s.end(); }
  s.setHeader('content-type', types[extname(p)] || 'application/octet-stream'); s.end(readFileSync(p));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CR_CHROMIUM, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => { localStorage.setItem('cs_landing_seen', '1'); Date.now = () => Date.parse('2026-10-12T16:00:00Z'); });
  await page.route('**/*', r => !r.request().url().startsWith(origin) || r.request().url().includes('/api/')
    ? r.fulfill({ status: 204, body: '' }) : r.continue());
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof renderGradingUpside === 'function' && window.CardResellGradingPaths);
  const render = async (scope, pc = null) => page.evaluate(({ scope, pc }) => {
    let el = document.getElementById('comparison-fixture');
    if (!el) { el = document.createElement('section'); el.id = 'comparison-fixture'; el.style.cssText = 'position:fixed;inset:0;overflow:auto;z-index:999999;background:var(--surface);padding:16px'; document.body.append(el); }
    renderGradingUpside(el, pc, 9, 9, { analysis_id: scope });
  }, { scope, pc });
  await render('one');
  check(await page.locator('.grading-paths').count() === 1, 'comparison mounts with no market comps');
  check(!await page.locator('.grading-paths').evaluate(e => e.open), 'collapsed by default');
  await page.getByText('Compare grading paths', { exact: true }).click();
  const panel = page.locator('.grading-paths');
  const p0 = panel.locator('[data-path="0"]'), p1 = panel.locator('[data-path="1"]');
  check(await p0.locator('[data-field="tier"]').inputValue() === '', 'no automatic tier selected');
  for (const [field, value] of Object.entries(common)) await panel.locator('[data-common] [data-field="' + field + '"]').fill(value);
  await p0.locator('[data-assumptions] summary').click();
  await p0.locator('[data-field="tier"]').selectOption('psa-standard');
  for (const [field, value] of Object.entries({ declared: '200', count: '1', outcome: '9', sale: '200', shipping: '10', saleShip: '5', extra: '6' }))
    await p0.locator('[data-field="' + field + '"]').fill(value);
  check(await p0.locator('[data-field="fee"]').inputValue() === '59.99', 'explicit tier fills sourced base fee');
  const actual = await page.evaluate(() => {
    const profile = _crSellerProfile();
    const net = p => netEbayForPrice(p, { ebayStore: profile.ebayStore, ebayPromo: profile.ebayPromo, trsEligible: false });
    return { rawNet: net(100) - 5, gradedNet: net(200) - 5 - 59.99 - 10 };
  });
  check((await p0.locator('output').innerText()).includes('$' + actual.gradedNet.toFixed(2)), 'UI uses existing eBay fee calculation');
  check(!(await p1.locator('output').innerText()).includes('vs selling raw'), 'missing CGC values do not borrow PSA');
  await p1.locator('[data-assumptions] summary').click();
  await p1.locator('[data-field="tier"]').selectOption('cgc-economy');
  for (const [field, value] of Object.entries({ declared: '200', count: '1', outcome: 'Gem Mint 10', sale: '160', shipping: '10', saleShip: '5', extra: '6' }))
    await p1.locator('[data-field="' + field + '"]').fill(value);
  check((await p1.locator('output').innerText()).includes('If it grades Gem Mint 10'), 'separate explicit CGC outcome');
  check(await panel.evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'mobile comparison has no horizontal overflow');
  await p0.locator('[data-assumptions] summary').click();
  await p1.locator('[data-assumptions] summary').click();
  await panel.locator('summary').first().scrollIntoViewIfNeeded();
  if (process.argv[2]) await page.screenshot({ path: process.argv[2], fullPage: false });
  await p1.locator('[data-assumptions] summary').click();
  await p1.locator('[data-field="grader"]').selectOption('BGS');
  check(await p1.locator('[data-field="sale"]').inputValue() === '', 'grader switch clears resale assumption');
  check(await p1.locator('[data-field="outcome"]').inputValue() === '', 'grader switch clears outcome');
  await render('two');
  check(await page.locator('[data-path="0"] [data-field="sale"]').inputValue() === '', 'different analysis cannot inherit prior assumptions');
  await render('one');
  check(await page.locator('[data-path="0"] [data-field="sale"]').inputValue() === '200', 'same analysis restores its assumptions');
  check(await page.locator('.grading-paths').count() === 1, 'rerender never duplicates comparison');
  await render('priced', { source: 'pricecharting', url: 'https://www.pricecharting.com/game/test', prices: { raw: 100, psa_10: 300 } });
  check(await page.locator('.grading-paths').count() === 1, 'comparison also mounts after existing priced ladder');
  check(await page.locator('[data-common] [data-field="raw"]').inputValue() === '100', 'raw guide prefill retained as editable baseline');
  check(errors.length === 0, 'no page errors: ' + errors.join('; '));
} finally { await browser.close(); server.close(); }
console.log(`grading-paths-browser: ${checks} checks passed`);
