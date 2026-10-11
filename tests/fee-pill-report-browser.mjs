// Fee pills show how old each venue's fee schedule is and offer a pre-filled
// "Report a fee problem" email; Poshmark's $15.00 boundary follows its terms (2026-10-11).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
const root = resolve(new URL('..', import.meta.url).pathname);
const types = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json' };
const server = createServer((q,s)=>{let p=decodeURIComponent(new URL(q.url,'http://x').pathname);p=join(root,p==='/'?'index.html':p);if(!existsSync(p)){s.statusCode=404;return s.end();}s.setHeader('content-type',types[extname(p)]||'application/octet-stream');s.end(readFileSync(p));});
await new Promise(r=>server.listen(0,'127.0.0.1',r)); const origin=`http://127.0.0.1:${server.address().port}`;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const shot = process.argv[2] || '';
const b = await chromium.launch({ executablePath: process.env.CR_CHROMIUM || undefined, args: ['--no-sandbox'] });
try {
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => localStorage.setItem('cs_landing_seen', '1'));
  await page.route('**/*', r => { const u = r.request().url(); if (!u.startsWith(origin) || u.includes('/api/')) return r.fulfill({ status: 204, body: '' }); return r.continue(); });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof calc === 'function' && typeof feePoshmark === 'function', null, { timeout: 30000 });
  const r = await page.evaluate(() => {
    selectedCard = { name: 'Charizard & Co' };
    window.getEffectivePrice = () => 40;
    calc();
    const rows = [...document.querySelectorAll('.fee-verified-row')];
    const sum = a => a.reduce((t, f) => t + f.a, 0);
    const out = { rows: rows.length, items: [] };
    for (const row of rows) {
      const pill = row.querySelector('.fee-verified-pill'), rep = row.querySelector('.fee-report-link');
      out.items.push({ pid: rep?.getAttribute('data-fee-report'), pill: pill?.textContent || '', href: rep?.getAttribute('href') || '', text: rep?.textContent || '' });
    }
    out.age = Object.fromEntries(Object.keys(PLATFORMS).map(p => [p, feeAuditAgeDays(p)]));
    out.audited = Object.fromEntries(Object.keys(PLATFORMS).map(p => [p, PLATFORMS[p].feeAuditedOn]));
    out.posh = [sum(feePoshmark(14.99)), sum(feePoshmark(15)), sum(feePoshmark(15.01)), feePoshmark(15)[0].l];
    return out;
  });
  if (shot) { await page.locator('.fee-verified-row').first().scrollIntoViewIfNeeded(); await page.screenshot({ path: shot }); }
  ok(r.rows >= 2, 'a pill row per rendered venue: ' + r.rows);
  ok(r.items.every(i => i.text === 'Report a fee problem' && i.href.startsWith('mailto:will@cardresell.org?subject=')), 'every row has the report link');
  const ago = d => d === 0 ? ' · today' : d === 1 ? ' · 1 day ago' : ` · ${d} days ago`;
  for (const pid of ['ebay', 'tcgplayer', 'poshmark', 'comc', 'fanatics', 'whatnot', 'mercari', 'manapool'])
    ok(r.audited[pid] === '2026-10-11', pid + ' re-audited Oct 11');
  for (const pid of ['cardsphere', 'cardmarket', 'cardkingdom', 'coolstuffinc', 'scg', 'cardnexus', 'tcgbulk'])
    ok(r.audited[pid] === '2026-09-01', pid + ' keeps its Sep 1 date (not re-read)');
  const eb = r.items.find(i => i.pid === 'ebay');
  ok(eb && eb.pill.endsWith('Oct 11, 2026' + ago(r.age.ebay)), 'eBay pill shows date and age: ' + (eb && eb.pill));
  ok(r.items.every(i => / · (today|1 day ago|\d+ days ago)$/.test(i.pill) || /not verified/.test(i.pill)), 'every dated pill says how old it is');
  const body = decodeURIComponent((eb.href.split('&body=')[1]) || '');
  ok(decodeURIComponent(eb.href.split('subject=')[1].split('&')[0]) === 'Fee problem: eBay', 'subject names the venue');
  ok(/^Venue: eBay\nCard: Charizard & Co\nPrice used: \$40\.00\nNet shown: \$\d+\.\d\d\nFee schedule date shown: Oct 11, 2026\n\nWhat looks wrong:\n$/.test(body), 'body is pre-filled: ' + JSON.stringify(body));
  ok(!/[<>"]/.test(eb.href), 'href carries no raw markup characters');
  ok(Math.abs(r.posh[0] - 2.95) < 1e-9 && Math.abs(r.posh[1] - 2.95) < 1e-9 && Math.abs(r.posh[2] - 3.002) < 1e-9, 'Poshmark: $15.00 pays $2.95, $15.01 pays 20%: ' + r.posh.slice(0, 3));
  ok(r.posh[3] === 'Flat commission ($15 and under)', 'Poshmark label matches its terms');
  ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
} finally { await b.close(); server.close(); }
console.log(`fee-pill-report-browser: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
