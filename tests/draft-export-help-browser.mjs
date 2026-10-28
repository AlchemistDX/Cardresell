// Shipped UI → real draft/availability handlers → isolated fixture store → CSV.
// CR_LIVE_STATIC=1 reads production static files; ALL API traffic still goes to
// the local fixture server. No seller account uploads or live writes occur.
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { ROOT } from './_assetRefs.mjs';
import { completionGuard } from './_complete.mjs';
const { finish } = completionGuard('draft-export-help-browser');
let checks = 0;
const check = (ok, message) => { assert.ok(ok, message); checks++; };
const port = Number(process.env.CR_DRAFT_HELP_PORT || 8397);
const local = `http://127.0.0.1:${port}`;
const origin = process.env.CR_LIVE_STATIC === '1' ? 'https://www.cardresell.org' : local;
const shots = process.env.CR_SHOT_DIR || '/tmp/cardresell-draft-export-help';
await mkdir(shots, { recursive: true });
const server = spawn('node', ['tools/dev-draft-server.mjs'], {
  cwd: ROOT, env: { ...process.env, DEV_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', b => { serverLog += b; });
server.stderr.on('data', b => { serverLog += b; });
let browser;
try {
  for (let n = 0; !serverLog.includes('dev-draft-server on '); n++) {
    if (n > 100) throw Error('Fixture server did not start: ' + serverLog.slice(-1000));
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.CR_CHROMIUM, args: ['--no-sandbox'] });
  for (const width of [320, 390, 1280]) {
    const sub = `draft-help-${width}`;
    const { token } = await (await fetch(`${local}/__devtoken?sub=${sub}`)).json();
    const ids = [];
    for (let n = 0; n < 2; n++) {
      const response = await fetch(local + '/api/drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'Idempotency-Key': `${sub}-seed-${n}-0000000000` },
        body: JSON.stringify({ card: { name: 'Charizard VMAX', set: 'Champions Path', number: '074/073', game: 'pokemon' }, instanceId: `${sub}-card-${n}`, slot: 'ebay:fixed-price', price: 32.84 + n, priceSource: 'comp' }),
      });
      const body = await response.json();
      assert.ok(response.ok, JSON.stringify(body));
      ids.push(body.draft?.draftId || body.draftId);
    }
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    const page = await context.newPage(), errors = [], downloads = [];
    let failRead = false;
    page.on('pageerror', e => errors.push(e.message));
    page.on('download', d => downloads.push(d));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (/\/js\/auth\.[a-f0-9]+\.js$/.test(url.pathname)) return route.fulfill({ contentType: 'text/javascript', body: '// Fixture session supplied at the auth boundary.' });
      if (url.pathname.startsWith('/api/')) {
        if (failRead && url.pathname === '/api/drafts' && url.searchParams.has('id') && request.method() === 'GET') return route.fulfill({ status: 503, json: { error: 'Fixture read unavailable.' } });
        const response = await route.fetch({ url: local + url.pathname + url.search });
        return route.fulfill({ response });
      }
      assert.ok(['GET', 'HEAD'].includes(request.method()), 'only static reads may reach production');
      return route.continue();
    });
    await page.addInitScript(() => localStorage.setItem('cs_landing_seen', '1'));
    async function boot() {
      await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof renderDraftsView === 'function' && !!window.CardResellDraftExportHelp);
      await page.evaluate(({ token, sub }) => { window.googleUser = { uid: sub, sub }; window._crIdToken = async () => token; }, { token, sub });
      await page.evaluate(() => switchView('drafts'));
      await page.waitForFunction(() => !_draftsState.loading && _draftsState.rows.length === 2);
    }
    await boot();
    const guide = page.locator('#draftExportHelp'), help = page.locator('#draftExportHelpBtn');
    const card = page.locator(`.draft-card[data-draft-id="${ids[0]}"]`);
    const pref = guide.locator('[data-draft-help-hide-auto]');
    const close = () => guide.getByRole('button', { name: 'Hide guide', exact: true }).click();
    const downloadOne = async () => {
      const pending = page.waitForEvent('download');
      await card.locator('[data-draft-download]').click();
      const download = await pending;
      await page.waitForFunction(() => _draftsState.dl?.success && !_draftsState.dl.busy);
      return download;
    };
    check(await guide.isHidden(), 'guide starts unobtrusively hidden');
    await help.click();
    check(await guide.isVisible(), 'permanent help opens before any export');
    check(await page.evaluate(() => document.activeElement.id === 'draftExportHelpTitle'), 'manual opening focuses the guide heading');
    check((await guide.innerText()).includes('eBay Connect is optional'), 'CSV does not require seller OAuth');
    check((await guide.innerText()).includes('Complete listings'), 'guide includes the post-upload handoff');
    check(await guide.getByRole('link', { name: 'Open eBay upload', exact: true }).getAttribute('href') === 'https://www.ebay.com/sh/reports/uploads', 'guide links to Reports uploads');
    check(await guide.getByRole('link', { name: 'Open eBay upload', exact: true }).getAttribute('rel') === 'noopener noreferrer', 'external upload tab isolates opener');
    await close();
    check(await help.evaluate(n => n === document.activeElement), 'closing restores keyboard focus');
    const first = await downloadOne();
    check((await readFile(await first.path(), 'utf8')).split('\r\n').filter(x => x.startsWith('Draft,')).length === 1, 'individual file contains one unpublished Draft row');
    check(await guide.isVisible(), 'successful individual download offers guide');
    check(await card.getByRole('link', { name: 'Open eBay upload', exact: true }).isVisible(), 'individual success has its own upload link');
    check(!(await card.innerText()).includes('Saved ebay-draft-'), 'download initiation is not falsely called a saved file');
    await pref.check(); await close();
    await downloadOne();
    check(await guide.isHidden(), 'suppression prevents automatic guide');
    check(await card.getByRole('link', { name: 'Open eBay upload', exact: true }).isVisible(), 'suppression preserves upload link');
    await boot(); await downloadOne();
    check(await guide.isHidden(), 'suppression survives page reload');
    await card.getByRole('button', { name: 'How to use drafts', exact: true }).click();
    check(await guide.isVisible() && await pref.isChecked(), 'download help reopens the suppressed guide');
    await pref.uncheck(); await close();
    await page.locator('[data-draft-select-all]').click();
    const bulkPending = page.waitForEvent('download');
    await page.locator('[data-draft-download-selected]').click();
    const bulk = await bulkPending;
    await page.waitForFunction(() => _draftsState.bulk?.success && !_draftsState.bulk.busy);
    check((await readFile(await bulk.path(), 'utf8')).split('\r\n').filter(x => x.startsWith('Draft,')).length === 2, 'bulk CSV retains two unpublished Draft rows');
    check(await guide.isVisible(), 'bulk success offers the same guide after opting back in');
    check(await page.locator('.draft-bulk').getByRole('link', { name: 'Open eBay upload', exact: true }).isVisible(), 'bulk success retains upload link');
    check(await guide.evaluate(n => n.scrollWidth <= n.clientWidth + 1 && n.getBoundingClientRect().width <= innerWidth), 'guide fits ' + width + 'px');
    await help.click();
    await guide.screenshot({ path: `${shots}/guide-${width}.png` });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await guide.screenshot({ path: `${shots}/guide-light-${width}.png` });
    await close(); failRead = true;
    const priorDownloads = downloads.length;
    await card.locator('[data-draft-download]').click();
    await card.locator('.draft-dl-err').waitFor();
    check(await guide.isHidden(), 'failed export cannot open a success guide');
    check(await card.getByRole('link', { name: 'Open eBay upload', exact: true }).count() === 0, 'failed export cannot offer a stale success link');
    check(downloads.length === priorDownloads, 'failed read cannot download a file');
    await help.click();
    await page.evaluate(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { if (k === 'cr_draft_export_help_hidden_v1') throw Error('fixture blocked'); return set.call(this, k, v); }; });
    await pref.check();
    check((await guide.getByRole('status').innerText()).includes('could not save'), 'storage failure is explained');
    await close(); failRead = false; await downloadOne();
    check(await guide.isHidden(), 'blocked storage still suppresses automatic help for this session');
    check(errors.length === 0, errors.join('; '));
    await context.close();
  }
} finally {
  await browser?.close(); server.kill('SIGKILL');
}
finish(checks, 0);
