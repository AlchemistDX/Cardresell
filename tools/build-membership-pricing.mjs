// Generated public pricing uses the exact same catalogue as the checkout route.
import { writeFile } from 'node:fs/promises';
import { publicMembershipCatalogue } from '../api/_membershipPurchaseRoutes.js';
const c = publicMembershipCatalogue();
const money = n => '$' + (n / 100).toFixed(2);
const rows = c.plans.map(p => `<tr><th scope="row">${p.name}</th><td>${money(p.monthlyPriceCents)}</td><td>${p.idCredits}</td><td>${p.gradeCredits}</td><td>${p.packDiscountPercent ? p.packDiscountPercent + '%' : 'None'}</td></tr>`).join('\n');
const packs = c.packs.map(p => `<li><span>${p.credits.toLocaleString('en-US')} ${p.kind === 'id' ? 'ID' : 'Grade'} credits</span><strong>${money(p.amountCents)}</strong></li>`).join('\n');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CardResell | Plans and credits</title><meta name="description" content="Compare Free, Starter, Casual, Pro and Business monthly plans and ID and Grade credit packs. Credits never expire.">
<link rel="canonical" href="https://www.cardresell.org/pricing"><link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="theme-color" content="#faf9f6">
<meta property="og:title" content="CardResell | Plans and credits">
<meta property="og:url" content="https://www.cardresell.org/pricing">
<meta property="og:image" content="https://www.cardresell.org/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://www.cardresell.org/og-image.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap">
<style>
:root{color-scheme:light dark;--bg:#faf9f6;--fg:#191914;--line:#d8d6cd;--accent:#775300}
@media(prefers-color-scheme:dark){:root{--bg:#171713;--fg:#f1f0e8;--line:#45453b;--accent:#e8bd61}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 'Inter',sans-serif}
main,header,footer{max-width:960px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;align-items:center}
a{color:var(--accent)}h1{font-size:2rem;margin:16px 0}h2{font-size:1.25rem;margin-top:32px}
table{width:100%;border-collapse:collapse;text-align:left;min-width:560px}td,th{padding:16px 12px;border-bottom:1px solid var(--line)}
.scroll{overflow:auto}.packs{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.packs li{padding:16px;border:1px solid var(--line);border-radius:8px;display:flex;justify-content:space-between;gap:16px}
.cta{display:inline-block;padding:12px 24px;background:var(--accent);color:var(--bg);border-radius:8px;font-weight:700;text-decoration:none}
.note{font-size:.875rem}a:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
</style></head><body><header><a href="/">CardResell</a><a href="/?shop=1">Open the shop</a></header>
<main><h1>Find your plan. Keep your credits.</h1>
<p>Five monthly plans. Separate ID and Grade balances. All credits never expire.</p>
<p class="note">New catalogue preview. Purchase activation is pending verification; existing billing stays unchanged.</p>
<div class="scroll" tabindex="0" aria-label="Plan comparison; scroll horizontally on small screens"><table><thead><tr><th>Plan</th><th>USD / month</th><th>ID / month</th><th>Grade / month</th><th>Pack discount</th></tr></thead><tbody>${rows}</tbody></table></div>
<p>Free verified accounts also receive a one-time bonus of 10 ID + 1 Grade, separate from their monthly allowance.</p>
<h2>Credit packs</h2><p>Base prices below. Your eligible membership discount is applied in the signed-in shop and checkout. Discounts do not stack.</p>
<ul class="packs">${packs}</ul>
<p>One ID scan uses 1 ID credit. Grade uses 1 Grade credit; Deep Grade uses 2.</p>
<p>Existing subscribers keep their current billing until a scheduled renewal change. Cancellation retains paid benefits through the paid-through date.</p>
<p>For existing billing, open the profile menu and choose Manage billing to cancel or update your payment method. New membership account controls remain in test mode until acceptance is complete.</p>
<a class="cta" href="/?shop=1">Open plans &amp; credits</a>
</main><footer><a href="/terms.html">Terms</a> · <a href="/privacy.html">Privacy</a></footer></body></html>`;
await writeFile(new URL('../pricing.html', import.meta.url), html);
if (process.argv[2]) {
  const preview = html
    .replaceAll('href="/?shop=1"', 'href="#preview-status"')
    .replace('class="note">New catalogue', 'class="note" id="preview-status">Read-only private preview. Checkout is disabled here. New catalogue');
  await writeFile(process.argv[2], preview);
}
console.log('Generated pricing.html from server catalogue.');
