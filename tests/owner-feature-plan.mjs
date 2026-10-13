// 2026-10-10: owner test account (single MEMBERSHIP_LIVE_OWNERS entry) gets
// Business FEATURES only, behind MEMBERSHIP_OWNER_FEATURE_PLAN=business.
import fs from 'node:fs';
import vm from 'node:vm';
import { ownerFeaturePlan } from '../api/_membershipFeaturePolicy.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const on = { MEMBERSHIP_OWNER_FEATURE_PLAN: 'business', MEMBERSHIP_LIVE_OWNERS: '["owner-uid"]' };
ok(ownerFeaturePlan('owner-uid', on) === 'business', 'reserved owner gets business features');
ok(ownerFeaturePlan('someone-else', on) === null, 'any other account gets nothing');
ok(ownerFeaturePlan('owner-uid', { ...on, MEMBERSHIP_OWNER_FEATURE_PLAN: '' }) === null, 'off unless switched on');
ok(ownerFeaturePlan('owner-uid', { ...on, MEMBERSHIP_OWNER_FEATURE_PLAN: 'true' }) === null, 'only the exact value "business" switches it on');
ok(ownerFeaturePlan('owner-uid', { ...on, MEMBERSHIP_LIVE_OWNERS: '["owner-uid","b"]' }) === null, 'two owners -> fails closed');
ok(ownerFeaturePlan('owner-uid', { ...on, MEMBERSHIP_LIVE_OWNERS: 'owner-uid' }) === null, 'non-JSON owners -> fails closed');
ok(ownerFeaturePlan('owner-uid', { ...on, MEMBERSHIP_LIVE_OWNERS: '[]' }) === null, 'no owner -> nothing');
ok(ownerFeaturePlan('', on) === null && ownerFeaturePlan(undefined, on) === null, 'empty owner -> nothing');
ok(ownerFeaturePlan('owner-uid', {}) === null, 'default environment -> off');
const rb = fs.readFileSync(new URL('../api/_membershipRouteBilling.js', import.meta.url), 'utf8');
ok(/const featurePlan = ownerFeaturePlan\(owner\) \|\| await compFeaturePlan\(owner, membershipRedis\);/.test(rb), 'feature plan: owner, else an env-listed comp grant (2026-10-13)');
ok(/capabilities: featurePlan === 'business'\s*\? \{ bulkGrade: true, venueTier: membershipVenueAccess\('business'\)\.tier, bulkGradeCards: BULK_GRADE_CARD_LIMITS\.business, featurePlan: 'business' \}\s*: \{ bulkGrade: id\.bulk_grade, venueTier: membershipVenueAccess\(tier\)\.tier \}/.test(rb), 'balances: owner capabilities Business, everyone else unchanged');
ok(/const tier = id\.period_active \? id\.plan : 'free';/.test(rb), 'plan tier itself is not overridden');
ok(!/credits:.*ownerFeaturePlan/.test(rb), 'credit fields untouched');
const dp = fs.readFileSync(new URL('../api/_draftPlanPolicy.js', import.meta.url), 'utf8');
ok(dp.indexOf('ownerFeaturePlan(owner)') > dp.indexOf('membershipRouteMode()'), 'draft override only in launch mode');
ok(/Math\.max\(b\.activeLimit, 500\)/.test(dp), 'draft capacity never drops below imported 500');
const scan = fs.readFileSync(new URL('../api/scan.js', import.meta.url), 'utf8');
ok(/let _featureBusiness = !!ownerFeaturePlan\(key\);/.test(scan) && (scan.match(/bulkGrade: isBulkGrade && !_featureBusiness \}/g) || []).length === 2, 'ledger feature flag skipped only for owner or comp Business, debit + Deep->Quick paths');
ok(/if \(membershipV2 && isBulkGrade\) \{\s*try \{\s*const balance = await membershipBalances\(key\);/.test(scan), 'server Bulk Grade check still runs for everyone');
const lua = fs.readFileSync(new URL('../api/_membershipConsumption.js', import.meta.url), 'utf8');
ok(!lua.includes('ownerFeaturePlan'), 'atomic billing script untouched');
const ps = fs.readFileSync(new URL('../api/pro-status.js', import.meta.url), 'utf8');
ok(/if \(b\.capabilities\?\.featurePlan === 'business'\) b = \{ \.\.\.b, billingTier: b\.tier, billingIsPro: b\.isPro, tier: 'business', isPro: true \};/.test(ps), 'status route presents owner as Business on any real plan, keeps billingTier');
ok(ps.indexOf("tier: 'business'") < ps.indexOf("return res.status(200).json({ ...b,"), 'override applied before the response');
for (const f of ['membership-account.js', 'scan-credits.js']) { let src = ''; try { src = fs.readFileSync(new URL('../api/' + f, import.meta.url), 'utf8'); } catch {} ok(!src.includes("tier: 'business'"), f + ' keeps the real plan (no plan-change offers from a display label)'); }
// Client cap.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../js/' + html.match(/\/js\/(ui\.[0-9a-f]{8}\.js)/)[1], import.meta.url), 'utf8');
const st = ui.indexOf('function _bulkGradeCapForTier'), en = ui.indexOf('\n}\n', st) + 3;
const cap = (access, tier, sub = 'u1') => { const c = { window: { _membershipVenueAccess: access, _userTier: tier, googleUser: { sub } } }; vm.createContext(c); vm.runInContext(ui.slice(st, en) + ';this.r=_bulkGradeCapForTier();', c); return c.r; };
ok(cap({ owner: 'u1', plan: 'casual', bulkGradeCards: 25 }, 'casual') === 25, 'owner on Casual plan gets 25-card batches');
ok(cap({ owner: 'u1', plan: 'pro', bulkGradeCards: null }, 'pro') === 10, 'Pro stays 10');
ok(cap({ owner: 'u1', plan: 'business', bulkGradeCards: null }, 'business') === 25, 'Business stays 25');
ok(cap({ owner: 'other', plan: 'casual', bulkGradeCards: 25 }, 'casual', 'u1') === 10, 'stale access for another account ignored');
ok(cap({ owner: 'u1', plan: 'casual', bulkGradeCards: 99 }, 'casual') === 25, 'never above 25');
const core = fs.readFileSync(new URL('../js/' + html.match(/\/js\/(core\.[0-9a-f]{8}\.js)/)[1], import.meta.url), 'utf8');
ok(/bulkGradeCards: Number\.isInteger\(d\.capabilities\?\.bulkGradeCards\) && d\.capabilities\.bulkGradeCards > 0/.test(core), 'client reads server batch size');
console.log(`owner-feature-plan: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
