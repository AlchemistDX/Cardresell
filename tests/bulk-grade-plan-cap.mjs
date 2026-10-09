// Owner decision 2026-10-09: Business batches up to 25 cards, Pro 10.
// Checks the catalogue contract, the batch tool's plan-derived cap and the copy.
import { readFileSync } from 'node:fs';
import { publicMembershipCatalogue } from '../api/_membershipPurchaseRoutes.js';
import { MEMBERSHIP_PAID_FEATURES } from '../api/_membershipFeaturePolicy.js';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : (fail++, console.log('  FAIL', n, d)); };
const c = publicMembershipCatalogue(), byId = Object.fromEntries(c.plans.map(p => [p.id, p]));
for (const [id, n] of Object.entries({ free: 0, starter: 0, casual: 0, pro: 10, business: 25 }))
  check(`catalogue ${id} batch size ${n}`, byId[id].features.bulkGradeCards === n && byId[id].features.bulkGrade === (n > 0));
check('billing feature table unchanged (boolean only)', JSON.stringify(MEMBERSHIP_PAID_FEATURES) ===
  JSON.stringify({ starter: { bulkGrade: false }, casual: { bulkGrade: false }, pro: { bulkGrade: true }, business: { bulkGrade: true } }));
check('prices and allowances unchanged', [byId.pro.monthlyPriceCents, byId.business.monthlyPriceCents, byId.pro.gradeCredits, byId.business.gradeCredits,
  byId.pro.packDiscountPercent, byId.business.packDiscountPercent].join() === '1999,4999,40,100,15,25');
const idx = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../' + idx.match(/\/(js\/ui\.[0-9a-f]{8}\.js)/)[1], import.meta.url), 'utf8');
const i = ui.indexOf('function _bulkGradeCapForTier('), body = ui.slice(i, ui.indexOf('\n}', i) + 2);
const cap = (venue, tier) => new Function('window', body + '; return _bulkGradeCapForTier();')({ _membershipVenueAccess: venue, _userTier: tier });
check('Business plan caps at 25', cap({ plan: 'business' }, 'business') === 25);
check('Pro plan caps at 10', cap({ plan: 'pro' }, 'pro') === 10);
check('legacy batch access stays at 10', cap(null, 'pro_max') === 10 && cap(null, 'ultimate') === 10);
check('server venue plan wins over a stale tier', cap({ plan: 'pro' }, 'business') === 10);
check('open path derives cap from plan', /window\._bulkGradeCap = _bulkGradeCapForTier\(\);/.test(ui));
check('trim message names Business for smaller caps', ui.includes("(cap < 25 ? ' · Business grades up to 25 per batch' : '')"));
check('no fixed 10-per-session copy remains in the batch tool', !/up to 10 per session|up to 10 cards\. /.test(ui));
const pr = readFileSync(new URL('../pricing.html', import.meta.url), 'utf8');
check('pricing table: Business up to 25 cards', /<th scope="row">Business<\/th>.*<td>Up to 25 cards<\/td><\/tr>/.test(pr));
check('pricing table: Pro up to 10 cards', /<th scope="row">Pro<\/th>.*<td>Up to 10 cards<\/td><\/tr>/.test(pr));
// Upgrade panel Pro -> Business mentions the bigger batch (run shop code in a stub).
const shop = readFileSync(new URL('../js/membership-shop.js', import.meta.url), 'utf8');
check('shop card copy is catalogue-driven', shop.includes("'Batch-grade uploaded photo sets for up to ' + (plan.features.bulkGradeCards || 10) + ' cards."));
check('upgrade panel states the batch step-up', shop.includes("'Batch-grade up to ' + to.features.bulkGradeCards + ' cards at a time, up from ' + from.features.bulkGradeCards + '.'"));
console.log(`bulk-grade-plan-cap: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
