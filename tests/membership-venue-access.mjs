import { completionGuard } from './_complete.mjs';
const { finish } = completionGuard('membership-venue-access');
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'acorn';
import { membershipVenueAccess } from '../api/_membershipVenuePolicy.js';
import { publicMembershipCatalogue } from '../api/_membershipPurchaseRoutes.js';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../' + index.match(/src="\/?(js\/core\.[a-f0-9]+\.js)"/)[1], import.meta.url), 'utf8');
const ast = parse(core, { ecmaVersion: 'latest' });
const functions = ['platformsForTier', '_venueTier'];
const declarations = ast.body.filter(n => functions.includes(n.id?.name)
  || n.type === 'VariableDeclaration' && n.declarations.some(d => ['FREE_PLATFORMS', 'PRO_PLATFORMS', 'PRO_MAX_PLATFORMS'].includes(d.id.name)));
const window = { googleUser: { sub: 'owner-a' }, _isPro: true };
const actualVenues = new Function('window', declarations.map(n => core.slice(n.start, n.end)).join('\n')
  + '\nreturn () => Array.from(platformsForTier(_venueTier()));')(window);
const expected = { free: 2, starter: 2, casual: 9, pro: 15, business: 15,
  legacy_pro: 9, legacy_pro_max: 15, legacy_ultimate: 15 };
let checks = 0;
for (const [plan, count] of Object.entries(expected)) {
  const policy = membershipVenueAccess(plan);
  window._userTier = plan;
  window._membershipVenueAccess = { owner: 'owner-a', plan, tier: policy.tier };
  assert.equal(actualVenues().length, count, plan + ' shipped frontend count'); checks++;
  assert.equal(policy.count, count, plan + ' server count'); checks++;
  if (['pro', 'business', 'legacy_pro_max', 'legacy_ultimate'].includes(plan)) {
    assert.ok(actualVenues().includes('comc'), plan + ' includes advanced venues'); checks++;
  }
}
for (const plan of publicMembershipCatalogue().plans) {
  assert.equal(plan.marketplaceCount, expected[plan.id], plan.id + ' advertised count'); checks++;
}
window.googleUser = { sub: 'owner-b' };
assert.equal(actualVenues().length, 2, 'stale identity cannot retain paid venue access'); checks++;
window.googleUser = { sub: 'owner-a' }; window._isPro = false;
assert.equal(actualVenues().length, 2, 'signed out or expired entitlement returns free venues'); checks++;
window._isPro = true; window._membershipVenueAccess = null;
for (const [tier, count] of Object.entries({ pro: 9, pro_max: 15, ultimate: 15, unknown: 2 })) {
  window._userTier = tier;
  assert.equal(actualVenues().length, count, 'legacy ' + tier); checks++;
}
assert.equal(membershipVenueAccess('__proto__').count, 2); checks++;
const ui = fs.readFileSync(new URL('../' + index.match(/src="\/?(js\/ui\.[a-f0-9]+\.js)"/)[1], import.meta.url), 'utf8');
const uiAst = parse(ui, { ecmaVersion:'latest' });
const helper = uiAst.body.find(n=>n.id?.name === '_bulkGradeAccess');
const batchAccess = new Function('window',ui.slice(helper.start,helper.end)+'; return _bulkGradeAccess;')(window);
window.googleUser={sub:'owner-a'};window._isPro=true;
for(const p of publicMembershipCatalogue().plans){
  window._userTier=p.id;
  window._membershipVenueAccess={owner:'owner-a',plan:p.id,bulkGrade:p.features.bulkGrade};
  assert.equal(batchAccess(),['pro','business'].includes(p.id));checks++;
}
window.googleUser={sub:'owner-b'};assert.equal(batchAccess(),null);checks++;
window.googleUser={sub:'owner-a'};delete window._membershipVenueAccess.bulkGrade;
assert.equal(batchAccess(),null);checks++;
window._membershipVenueAccess=null;window._userTier='pro_max';assert.equal(batchAccess(),true);checks++;
window._isPro=false;assert.equal(batchAccess(),false);checks++;
console.log(`Membership venue access: ${checks} passed`);

finish(checks, 0);
