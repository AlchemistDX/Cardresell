// Refresh catalogue amounts while preserving the reviewed public-page design/copy.
import { readFile, writeFile } from 'node:fs/promises';
import { publicMembershipCatalogue } from '../api/_membershipPurchaseRoutes.js';
const c = publicMembershipCatalogue();
const money = n => '$' + (n / 100).toFixed(2);
const rows = c.plans.map(p => `<tr><th scope="row">${p.name}</th><td>${money(p.monthlyPriceCents)}</td><td>${p.idCredits}</td><td>${p.gradeCredits}</td><td>${p.packDiscountPercent ? p.packDiscountPercent + '%' : 'None'}</td><td>${p.marketplaceCount === 2 ? 'eBay + TCGplayer' : 'Up to ' + p.marketplaceCount}</td><td>Up to 500</td><td>${p.features.bulkGrade ? 'Up to 10 cards' : 'Not included'}</td></tr>`).join('\n');
const packs = c.packs.map(p => `<li><span>${p.credits.toLocaleString('en-US')} ${p.kind === 'id' ? 'ID' : 'Grade'} credits</span><strong>${money(p.amountCents)}</strong></li>`).join('\n');
const path = new URL('../pricing.html', import.meta.url);
let html = await readFile(path, 'utf8');
if ((html.match(/<tbody>/g)||[]).length !== 1 || (html.match(/<ul class="packs">/g)||[]).length !== 1) throw Error('Pricing template sections missing or ambiguous');
html = html.replace(/<tbody>[\s\S]*?<\/tbody>/, '<tbody>' + rows + '</tbody>')
  .replace(/<ul class="packs">[\s\S]*?<\/ul>/, '<ul class="packs">' + packs + '</ul>');
await writeFile(path, html);
if (process.argv[2]) await writeFile(process.argv[2], html.replaceAll('href="/?shop=1"', 'href="#preview-status"')
  .replace('<main>', '<main><p id="preview-status">Read-only private preview. Checkout is disabled here.</p>'));
console.log('Refreshed pricing.html from server catalogue; reviewed design and descriptions retained.');
