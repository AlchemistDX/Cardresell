/*
 * review-fee-ax-check — accessibility-tree evidence for the fee <dl>.
 *
 * Element presence is not an announcement. This walks the real AX tree via CDP
 * (`page.accessibility` was removed in Playwright 1.59) and reports, in tree
 * order, what a screen reader would traverse -- so "the dt is there" can be
 * replaced by "the term and its value are adjacent, in this order, with these
 * names".
 */

import { readFileSync, writeFileSync } from 'node:fs';
import pw from '/home/user/node_modules/playwright/index.js';
const { chromium } = pw;
import { renderFeeBlock, BUNDLE_PATH } from './review-fee-dl-render.mjs';

const ROOT = '/home/user/workspace/cardresell';
const index = readFileSync(`${ROOT}/index.html`, 'utf8');
const styles = [...index.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');

function harness(theme, block, label) {
  return `<!DOCTYPE html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8">
<style>${styles}</style>
<style>body{margin:0;padding:20px;background:var(--bg);font-family:system-ui,sans-serif}
.wrap{max-width:420px}h2{font-size:.8rem;color:var(--text-muted);margin:0 0 8px}</style>
</head><body><div class="wrap"><h2>${label} · ${theme}</h2>${block}</div></body></html>`;
}

const cases = [
  { name: 'priced',   theme: 'light', block: renderFeeBlock(40) },
  { name: 'priced',   theme: 'dark',  block: renderFeeBlock(40) },
  { name: 'unpriced', theme: 'light', block: renderFeeBlock(null) },
  { name: 'unpriced', theme: 'dark',  block: renderFeeBlock(null) },
];

const browser = await chromium.launch();
const out = [];

for (const c of cases) {
  const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
  await page.setContent(harness(c.theme, c.block, c.name), { waitUntil: 'load' });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Accessibility.enable');
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');

  const byId = new Map(nodes.map(n => [n.nodeId, n]));
  const rows = [];
  for (const n of nodes) {
    if (n.ignored) continue;
    const role = n.role && n.role.value;
    const name = n.name && n.name.value;
    if (!role) continue;
    if (['DescriptionList', 'DescriptionListTerm', 'DescriptionListDetail',
         'definition', 'term', 'descriptionlist', 'DescriptionTerm'].includes(role)
        || /description|term|definition/i.test(role)) {
      rows.push({ role, name: name || '' });
    }
  }

  /* Text content in DOM order, for reading-order evidence independent of how
     Chromium happens to name dt/dd roles. */
  const readingOrder = await page.evaluate(() => {
    const dl = document.querySelector('.review-fees-table');
    if (!dl) return null;
    return [...dl.children].map(el => ({
      tag: el.tagName.toLowerCase(),
      kind: el.getAttribute('data-fee-row'),
      text: el.textContent.replace(/\s+/g, ' ').trim(),
    }));
  });

  const pairing = await page.evaluate(() => {
    const dl = document.querySelector('.review-fees-table');
    if (!dl) return { ok: false, why: 'no .review-fees-table' };
    const kids = [...dl.children];
    const bad = [];
    for (let i = 0; i < kids.length; i += 2) {
      const a = kids[i], b = kids[i + 1];
      if (!a || a.tagName !== 'DT') bad.push(`index ${i} is ${a ? a.tagName : 'missing'}, expected DT`);
      if (!b || b.tagName !== 'DD') bad.push(`index ${i + 1} is ${b ? b.tagName : 'missing'}, expected DD`);
      if (a && b && a.getAttribute('data-fee-row') !== b.getAttribute('data-fee-row'))
        bad.push(`pair ${i}: dt kind ${a.getAttribute('data-fee-row')} != dd kind ${b.getAttribute('data-fee-row')}`);
    }
    return { ok: bad.length === 0, bad, count: kids.length };
  });

  const computed = await page.evaluate(() => {
    const g = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).color : null; };
    return {
      taxAmount:      g('.review-fee-amount[data-fee-row="basis"]'),
      withheldAmount: g('.review-fee-amount[data-fee-row="withheld"]'),
      netAmount:      g('.review-fee-amount[data-fee-row="net"]'),
    };
  });

  const shot = `${ROOT}/audit/d3/ax-fee-${c.name}-${c.theme}.png`;
  await page.locator('.review-fees').screenshot({ path: shot });

  out.push({ ...c, block: undefined, axRows: rows, readingOrder, pairing, computed, shot });
  await page.close();
}

await browser.close();

let report = `# Fee <dl> accessibility evidence\n\nBundle: \`${BUNDLE_PATH}\`\nViewport 720px. Generated ${new Date().toISOString()}\n`;
for (const c of out) {
  report += `\n## ${c.name} · ${c.theme}\n\n`;
  report += `dl children: ${c.pairing.count} · strict dt/dd alternation + kind match: **${c.pairing.ok ? 'PASS' : 'FAIL'}**`;
  if (!c.pairing.ok) report += `\n\n${c.pairing.bad.map(b => `- ${b}`).join('\n')}`;
  report += `\n\n**Reading order (DOM order inside the \`<dl>\`):**\n\n`;
  for (const r of c.readingOrder) report += `- \`${r.tag}\` [${r.kind}] ${JSON.stringify(r.text)}\n`;
  report += `\n**AX tree nodes with a description/term/definition role:** ${c.axRows.length}\n\n`;
  for (const r of c.axRows) report += `- ${r.role}${r.name ? ` — ${JSON.stringify(r.name)}` : ''}\n`;
  report += `\n**Computed amount colours:** tax \`${c.computed.taxAmount}\` · withheld \`${c.computed.withheldAmount}\` · net \`${c.computed.netAmount}\`\n`;
  report += `\nScreenshot: \`${c.shot.replace(ROOT + '/', '')}\`\n`;
}
writeFileSync(`${ROOT}/audit/d3/FEE_DL_AX_EVIDENCE.md`, report);
console.log(report);
