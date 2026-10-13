// Comp grants (2026-10-13): exact ledger Lua in private local Redis. Synthetic
// identities only; no handler activation, env credentials or external services.
import { harness } from './_assert.mjs';
import { redisCommand as redis } from './_idRedis.mjs';
import { grantMembership, prepareMembershipGrant } from '../api/_membershipLedger.js';
import { parseCompGrants, claimCompGrants, compFeaturePlan, compFeatureKey, compOperationKey } from '../api/_membershipComp.js';
import { readFileSync } from 'node:fs';

const t = harness('membership-comp');
const UID = 'syntheticCompOwner', OTHER = 'syntheticOtherOwner';
const idKey = u => `scans:${u}:id_paid_left`, gradeKey = u => `scans:${u}:paid_left`;
const num = async k => Number(await redis(['GET', k]) || 0);
const G = { grant: 'comp-20261013-test', email: 'Comp.User@Example.test', id: 500, grade: 500, plan: 'business' };
const env = list => ({ MEMBERSHIP_COMP_GRANTS: JSON.stringify(list) });
const ident = (more = {}) => ({ uid: UID, email: 'comp.user@example.test', emailVerified: true, ...more });
await redis(['FLUSHDB']);

await t.section('env parsing fails closed', async () => {
  t.check('valid list parses, email lowercased', parseCompGrants(JSON.stringify([G]))[0]?.email === 'comp.user@example.test');
  t.check('absent is empty', parseCompGrants(undefined).length === 0 && parseCompGrants('').length === 0);
  t.check('not JSON is empty', parseCompGrants('comp,x').length === 0);
  t.check('more than 5 is empty', parseCompGrants(JSON.stringify([1,2,3,4,5,6].map(i => ({ ...G, grant: 'comp-x-' + i })))).length === 0);
  t.check('over 1000 credits rejected', parseCompGrants(JSON.stringify([{ ...G, id: 1001 }])).length === 0);
  t.check('extra field rejected', parseCompGrants(JSON.stringify([{ ...G, uid: 'x' }])).length === 0);
  t.check('bad plan rejected', parseCompGrants(JSON.stringify([{ ...G, plan: 'ultimate' }])).length === 0);
  t.check('duplicate grant IDs rejected', parseCompGrants(JSON.stringify([G, { ...G, email: 'b@x.test' }])).length === 0);
  t.check('one bad entry disables all', parseCompGrants(JSON.stringify([G, { ...G, grant: 'BAD' }])).length === 0);
});

await t.section('ledger envelope validation', async () => {
  const bad = async (name, input) => { try { prepareMembershipGrant('comp', input); t.check(name, false, 'accepted'); } catch (e) { t.check(name, e.code === 'invalid_envelope', e.code); } };
  const ok = { owner: UID, grantId: G.grant, idGrant: 500, gradeGrant: 500, plan: 'business' };
  await bad('missing field', { owner: UID, grantId: G.grant, idGrant: 1, gradeGrant: 1 });
  await bad('over 1000', { ...ok, idGrant: 1001 });
  await bad('zero total', { ...ok, idGrant: 0, gradeGrant: 0 });
  await bad('bad grant id', { ...ok, grantId: 'pi_123' });
  await bad('bad plan', { ...ok, plan: 'pro' });
  const cmd = prepareMembershipGrant('comp', ok).command;
  t.check('operation key is per grant, not per owner', cmd[3] === compOperationKey(G.grant));
  t.check('credits go to the permanent paid buckets', cmd[4] === idKey(UID) && cmd[5] === gradeKey(UID));
  t.check('feature record key is per owner', cmd[6] === compFeatureKey(UID));
});

await t.section('claim: once, by the named verified account', async () => {
  await redis(['SET', idKey(UID), '7']); await redis(['SET', gradeKey(UID), '3']);
  t.check('unverified email claims nothing', (await claimCompGrants(ident({ emailVerified: false }), redis, env([G]))).length === 0);
  t.check('a different email claims nothing', (await claimCompGrants(ident({ email: 'someone@example.test' }), redis, env([G]))).length === 0);
  t.check('no Business before the claim', await compFeaturePlan(UID, redis, env([G])) === null);
  const first = await claimCompGrants(ident({ email: ' COMP.user@example.TEST ' }), redis, env([G]));
  t.check('first claim applies', first.length === 1 && first[0] === G.grant);
  t.check('existing balances preserved and topped up', await num(idKey(UID)) === 507 && await num(gradeKey(UID)) === 503);
  t.check('Business features for this UID', await compFeaturePlan(UID, redis, env([G])) === 'business');
  const again = await claimCompGrants(ident(), redis, env([G]));
  t.check('second claim adds nothing', again.length === 0 && await num(idKey(UID)) === 507 && await num(gradeKey(UID)) === 503);
  const replay = await grantMembership(redis, 'comp', { owner: UID, grantId: G.grant, idGrant: 500, gradeGrant: 500, plan: 'business' });
  t.check('exact ledger replay returns the recorded result without adding', replay.ok && await num(idKey(UID)) === 507);
  const other = await claimCompGrants(ident({ uid: OTHER }), redis, env([G]));
  t.check('another UID with the same email cannot claim it', other.length === 0 && await num(idKey(OTHER)) === 0 && await num(gradeKey(OTHER)) === 0);
  try { await grantMembership(redis, 'comp', { owner: OTHER, grantId: G.grant, idGrant: 500, gradeGrant: 500, plan: 'business' }); t.check('direct second-owner claim refused', false); }
  catch (e) { t.check('direct second-owner claim refused', e.code === 'operation_conflict', e.code); }
  t.check('other UID has no Business', await compFeaturePlan(OTHER, redis, env([G])) === null);
});

await t.section('revocation and plan none', async () => {
  t.check('removing the grant from env removes Business', await compFeaturePlan(UID, redis, env([])) === null);
  t.check('credits stay after removal', await num(idKey(UID)) === 507);
  t.check('malformed env removes Business (fail closed)', await compFeaturePlan(UID, redis, { MEMBERSHIP_COMP_GRANTS: '{' }) === null);
  const N = { grant: 'comp-20261013-credits', email: 'credits@example.test', id: 10, grade: 0, plan: 'none' };
  const r = await claimCompGrants({ uid: 'creditsOnly', email: 'credits@example.test', emailVerified: true }, redis, env([N]));
  t.check('credits-only grant applies', r.length === 1 && await num(idKey('creditsOnly')) === 10 && await redis(['GET', gradeKey('creditsOnly')]) === null);
  t.check('credits-only grant gives no Business', await compFeaturePlan('creditsOnly', redis, env([N])) === null);
});

await t.section('wiring', async () => {
  const src = f => readFileSync(new URL('../api/' + f, import.meta.url), 'utf8');
  t.check('pro-status claims after a successful balance read', /b = await membershipBalances\(userSub\);[\s\S]{0,400}claimCompGrants\(/.test(src('pro-status.js')));
  t.check('balances read comp features', /ownerFeaturePlan\(owner\) \|\| await compFeaturePlan\(owner, membershipRedis\)/.test(src('_membershipRouteBilling.js')));
  t.check('scan bulk-grade honours comp Business', /compFeaturePlan\(key, membershipRedis\)/.test(src('scan.js')) && (src('scan.js').match(/bulkGrade: isBulkGrade && !_featureBusiness/g) || []).length === 2);
  t.check('drafts honour comp Business', /balance\.capabilities\?\.featurePlan === 'business'/.test(src('_draftPlanPolicy.js')));
  t.check('pack/period hold check unchanged', /\(p\.kind=='pack' or p\.kind=='period'\) and redis\.call\('EXISTS',KEYS\[9\]\)==1/.test(src('_membershipLedger.js')));
});
t.done();
