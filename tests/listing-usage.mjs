// Actual Lua, private Unix-socket Redis. No network/provider or real account.
import { createHash, randomUUID, generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { harness } from './_assert.mjs';
import { redisCommand as redis, redisRest } from './_idRedis.mjs';
import { mutateListing, listingUsageKeys, LISTING_COMMIT_SCRIPT, makeListingKv } from '../api/_listingUsage.js';
import { draftKey, getDraft, putDraft, discardDraft, buildDraft } from '../api/_draftStore.js';
import { lifecycleKey, lifecycleFenceKey } from '../api/_draftLifecycle.js';
import { createDraft, updateDraft, deleteDraftOp } from '../api/_draftService.js';
import { LAUNCH_PLANS } from '../api/_launchMembershipConfig.js';
import { LISTING_INDEX_SCRIPT, listingIndexIntentKey, repairListingIndex, listListingIds } from '../api/_listingIndex.js';
import { draftsKey, skuDraftKey } from '../api/_draftIndex.js';
const t = harness('listing-usage');
const owner = 'syntheticListingOwner', kv = (...a) => redis(a);
process.env.LISTING_USAGE_V2 = 'enabled';
const keys = listingUsageKeys(owner, 'period_one');
const input = n => ({ instanceId: `inst_${n}`, slot: 'ebay:fixed-price',
  sku: `sku_${n}`, title: 'Synthetic card', price: 10, priceSource: 'seller' });
const create = (n, key = randomUUID(), use = kv, generation = 0) =>
  mutateListing(use, owner, 'create', { input: input(n), generation }, key);
const change = (action, draft, key = randomUUID(), use = kv) =>
  mutateListing(use, owner, action, { draftId: draft.draftId, expectedRev: draft.rev }, key);
const read = async key => JSON.parse(await redis(['GET', key]));
const reset = () => redis(['FLUSHDB']);
async function seed({ plan = 'free', active = 0, created = 0, expiry = false } = {}) {
  const now = Number((await redis(['TIME']))[0]), d = new Date(now * 1000);
  const start = plan === 'free' ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000 : now - 100;
  const end = plan === 'free' ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000 : expiry ? now - 1 : now + 10000;
  const account = { v: 2, owner, epoch: 'epoch_one', ready: true, revision: 0, active,
    entitlement: { version: 'ent_one', plan, periodId: 'period_one', start, end } };
  const bootstrap = { v: 2, owner, epoch: 'epoch_one', state: 'complete', writerFence: 'v2-only', creationPolicy: 'prospective' };
  const period = { v: 2, owner, epoch: 'epoch_one', periodId: 'period_one', start, end, created };
  await redis(['MSET', keys.account, JSON.stringify(account), keys.bootstrap, JSON.stringify(bootstrap), keys.period, JSON.stringify(period)]);
}
async function snapshot() {
  const list = (await redis(['KEYS', '*'])).filter(k => !/^draftinst(lock|fence):/.test(k)).sort();
  return JSON.stringify(await Promise.all(list.map(async k => [k, await redis(['GET', k]), await redis(['PTTL', k])]))); 
}
async function rejects(label, fn, code) {
  try { await fn(); t.check(label, false, 'unexpected success'); }
  catch (e) { t.check(label, e.code === code, `actual ${e.code || e.message}`); }
}
async function unchanged(label, fn, code) {
  const before = await snapshot(); await rejects(label, fn, code);
  t.check(`${label}: authoritative bytes/TTLs unchanged`, await snapshot() === before);
}
await t.section('No bootstrap assumptions and exact catalog admission', async () => {
  await reset();
  await unchanged('Missing bootstrap', () => create('missing'), 'LISTING_BOOTSTRAP_REQUIRED');
  await seed();
  for (const key of [keys.account, keys.bootstrap, keys.period]) {
    const old = await redis(['GET', key]); await redis(['DEL', key]);
    await unchanged('Deleted authority never rebuilt', () => create('bad'),
      key === keys.period ? 'LISTING_PERIOD_UNAVAILABLE' : 'LISTING_BOOTSTRAP_REQUIRED');
    await redis(['SET', key, old]);
    await redis(['SET', key, 'nil']);
    await unchanged('Malformed authority never treated as zero', () => create('bad'), 'LISTING_STATE_INVALID');
    await redis(['SET', key, old]);
  }
  for (const [plan, caps] of Object.entries(LAUNCH_PLANS)) {
    await reset(); await seed({ plan, active: caps.activeListings - 1, created: caps.newListings - 1 });
    await create(plan);
    t.check(`${plan}: exact catalog last slot`, (await read(keys.account)).active === caps.activeListings
      && (await read(keys.period)).created === caps.newListings);
    await unchanged(`${plan}: active cap`, () => create(`${plan}_over`), 'LISTING_ACTIVE_CAP');
    await seed({ plan, created: caps.newListings });
    await unchanged(`${plan}: creation cap independently enforced`, () => create(`${plan}_new`), 'LISTING_CREATION_CAP');
  }
});
await t.section('Concurrent atomic admission and durable retry', async () => {
  await reset(); await seed();
  const attempts = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => create(`race${i}`)));
  t.check('Ten rows racing five free slots create exactly five', attempts.filter(x => x.status === 'fulfilled').length === 5);
  t.check('Both counters exactly five', (await read(keys.account)).active === 5 && (await read(keys.period)).created === 5);
  t.check('Exactly five draft and operation records', (await redis(['KEYS', 'draft:*'])).length === 5
    && (await redis(['KEYS', `${keys.base}:op:*`])).length === 5);
  await reset(); await seed();
  const op = randomUUID(); let lose = true;
  const lost = async (...args) => {
    const result = await kv(...args);
    if (args[0] === 'EVAL' && args[1] === LISTING_COMMIT_SCRIPT && lose) { lose = false; throw new Error('local lost response'); }
    return result;
  };
  await rejects('Lost commit response is unknown, not refunded', () => create('loss', op, lost), 'LISTING_OUTCOME_UNKNOWN');
  const after = await snapshot(), recovered = await create('loss', op);
  t.check('Same operation replays exact committed state without writes', recovered.replayed && await snapshot() === after);
  t.check('Lost response consumed exactly one', (await read(keys.account)).active === 1 && (await read(keys.period)).created === 1);
  for (const key of await redis(['KEYS', `${keys.base}:op:*`])) t.check('Operation evidence does not expire', await redis(['TTL', key]) === -1);
  await unchanged('Same key different request refused', () => create('other', op), 'LISTING_OPERATION_MISMATCH');
  const same = await create('loss');
  t.check('New intent on occupied row returns existing and never recounts', same.result.existing
    && same.result.draftId === recovered.result.draftId && (await read(keys.period)).created === 1);
});
await t.section('Archive restore delete and generation preserve content and counters', async () => {
  await reset(); await seed();
  let d = (await create('lifecycle')).result.draft;
  const raw = await read(draftKey(owner, d.draftId));
  raw.card = { name: 'Keep me', photos: [{ objectKey: 'synthetic-not-deletion-authority' }] };
  raw.packet = { version: 'retained', nested: { sellerImage: 'synthetic' } };
  await redis(['SET', draftKey(owner, d.draftId), JSON.stringify(raw)]); d = raw;
  const archiveKey = randomUUID(), archived = await change('archive', d, archiveKey);
  t.check('Archive releases only active, preserves photo/card/packet content', archived.result.draft.status === 'archived'
    && JSON.stringify(archived.result.draft.card) === JSON.stringify(raw.card)
    && JSON.stringify(archived.result.draft.packet) === JSON.stringify(raw.packet)
    && (await read(keys.account)).active === 0 && (await read(keys.period)).created === 1);
  const snap = await snapshot(); await change('archive', d, archiveKey);
  t.check('Archive replay exact bytes', await snapshot() === snap);
  t.check('Archived lifecycle remains occupied', (await create('lifecycle')).result.draft.status === 'archived');
  const account = await read(keys.account); account.active = 5; await redis(['SET', keys.account, JSON.stringify(account)]);
  await unchanged('Restore checks active cap', () => change('restore', archived.result.draft), 'LISTING_ACTIVE_CAP');
  account.active = 0; await redis(['SET', keys.account, JSON.stringify(account)]);
  const restored = await change('restore', archived.result.draft);
  t.check('Restore same identity, no creation', restored.result.draftId === d.draftId
    && (await read(keys.account)).active === 1 && (await read(keys.period)).created === 1);
  const again = await change('archive', restored.result.draft);
  const removed = await change('delete', again.result.draft);
  t.check('Delete archived never double releases active', (await read(keys.account)).active === 0 && (await read(keys.period)).created === 1);
  t.check('Delete preserves retained content and advances generation', removed.result.draft.card.name === 'Keep me'
    && removed.result.generation === 1 && removed.result.draft.status === 'deleted');
  const cleanup = await read(`${keys.base}:cleanup:${d.draftId}`);
  t.check('Durable intent preserves old photo references but cannot authorize object deletion',
    cleanup.state === 'awaiting_photo_ledger' && cleanup.physicalDeletionAuthorized === false
    && cleanup.snapshot.card.photos[0].objectKey === 'synthetic-not-deletion-authority');
  t.check('Tombstone and cleanup permanent', await redis(['TTL', draftKey(owner, d.draftId)]) === -1
    && await redis(['TTL', `${keys.base}:cleanup:${d.draftId}`]) === -1);
  await unchanged('Old generation cannot recreate', () => create('lifecycle'), 'LISTING_GENERATION_STALE');
  const fresh = await create('lifecycle', randomUUID(), kv, 1);
  t.check('Explicit next generation creates independently', fresh.result.draftId !== d.draftId && (await read(keys.period)).created === 2);
});
await t.section('CAS races, malformed state, period and legacy writer boundaries', async () => {
  await reset(); await seed({ plan: 'casual', expiry: true });
  await unchanged('Expired paid period never admits', () => create('late'), 'LISTING_PERIOD_EXPIRED');
  await seed(); const firstKey = randomUUID(), first = await create('period', firstKey);
  const beforePeriod = await redis(['GET', keys.period]);
  const a = await read(keys.account); a.entitlement.periodId = 'period_two'; a.entitlement.version = 'ent_two';
  const k2 = listingUsageKeys(owner, 'period_two').period, old = await read(keys.period);
  await redis(['MSET', keys.account, JSON.stringify(a), k2, JSON.stringify({ ...old, periodId: 'period_two', created: 0 })]);
  t.check('Recorded replay retains original captured period', (await create('period', firstKey)).result.usage.periodId === 'period_one');
  await create('new_period');
  t.check('Rollover preserves active and old period, increments only new period', (await read(keys.account)).active === 2
    && await redis(['GET', keys.period]) === beforePeriod && (await read(k2)).created === 1);
  await unchanged('Stale revision cannot archive', () => change('archive', { ...first.result.draft, rev: 99 }), 'LISTING_REVISION_CONFLICT');
  const guarded = await putDraft(kv, owner, { ...first.result.draft, schemaVersion: 1, listingUsage: undefined }, randomUUID());
  t.check('Legacy writer cannot strip v2 schema and overwrite', !guarded.ok && guarded.error === 'LISTING_ATOMIC_WRITE_REQUIRED');
  delete process.env.LISTING_USAGE_V2;
  await unchanged('Core disabled independently of records', () => create('off'), 'LISTING_DISABLED');
  await rejects('Rollback service refuses legacy edit of v2 record', () => updateDraft(kv, owner,
    first.result.draftId, { title: 'Changed' }, 1, randomUUID()), 'LISTING_ATOMIC_WRITE_REQUIRED');
  await unchanged('Flag OFF enrolled create cannot use legacy quota', () =>
    createDraft(kv, owner, input('rollback'), randomUUID()), 'LISTING_ATOMIC_WRITE_REQUIRED');
  await unchanged('Flag OFF enrolled delete cannot use legacy release', () =>
    deleteDraftOp(kv, owner, first.result.draftId, 1, randomUUID()), 'LISTING_ATOMIC_WRITE_REQUIRED');
  const absentTarget = buildDraft(input('direct'));
  const direct = await putDraft(kv, owner, absentTarget, randomUUID());
  t.check('Direct legacy new-draft writer blocked for enrolled account', direct.error === 'LISTING_ATOMIC_WRITE_REQUIRED'
    && await redis(['GET', draftKey(owner, absentTarget.draftId)]) === null);
  await redis(['SET', draftKey(owner, 'corrupt_draft'), 'nil']);
  const protectedDiscard = await discardDraft(kv, owner, 'corrupt_draft', randomUUID());
  t.check('Legacy corrupt-record discard cannot destroy enrolled data', protectedDiscard.error === 'LISTING_ATOMIC_WRITE_REQUIRED'
    && await redis(['GET', draftKey(owner, 'corrupt_draft')]) === 'nil');
  await redis(['DEL', draftKey(owner, 'corrupt_draft')]);
  process.env.LISTING_USAGE_V2 = 'enabled';
  let interleave = true;
  const changedBootstrap = async (...args) => {
    if (args[1] === LISTING_COMMIT_SCRIPT && interleave) {
      interleave = false; await redis(['DEL', keys.bootstrap]);
    }
    return kv(...args);
  };
  await rejects('Bootstrap disappears between reads and commit: no admission', () => create('interleave', randomUUID(), changedBootstrap), 'LISTING_BOOTSTRAP_REQUIRED');
  t.check('No new draft after authority race', (await redis(['KEYS', 'draft:*'])).length === 2);
  await seed(); let fenceOnce = true;
  const stale = async (...args) => {
    if (args[1] === LISTING_COMMIT_SCRIPT && fenceOnce) {
      fenceOnce = false; await redis(['INCR', lifecycleFenceKey(owner, 'inst_fenced', 'ebay:fixed-price')]);
    }
    return kv(...args);
  };
  await unchanged('Stale lifecycle fence cannot commit', () => create('fenced', randomUUID(), stale), 'LISTING_FENCED');
  await seed();
  const broken = async (...args) => {
    if (args[1] === LISTING_COMMIT_SCRIPT) {
      const p = JSON.parse(args.at(-1)); p.operation = 'nil'; args[args.length - 1] = JSON.stringify(p);
    }
    return kv(...args);
  };
  await unchanged('Final operation decode failure before MSET preserves all records', () => create('nil', randomUUID(), broken), 'LISTING_OUTCOME_UNKNOWN');
  const lifeKey = lifecycleKey(owner, 'inst_period', 'ebay:fixed-price'), life = await redis(['GET', lifeKey]);
  await redis(['DEL', lifeKey]);
  await unchanged('Missing lifecycle pointer is not new empty row', () => create('period'), 'LISTING_LIFECYCLE_UNRESOLVED');
  await redis(['SET', lifeKey, life]);
  const rowKey = (await redis(['KEYS', `${keys.base}:row:*`])).find(k => k.endsWith(createHash('sha256')
    .update(JSON.stringify(['inst_period', 'ebay:fixed-price'])).digest('hex')));
  const row = await redis(['GET', rowKey]); await redis(['DEL', rowKey]);
  await unchanged('Missing row authority cannot be recreated over existing lifecycle', () => create('period'), 'LISTING_LIFECYCLE_UNRESOLVED');
  await redis(['SET', rowKey, row]);
});

await t.section('Duplicate concurrency, terminal response loss and bounded counters', async () => {
  await reset(); await seed();
  const key = randomUUID();
  const concurrent = await Promise.allSettled([create('same_intent', key), create('same_intent', key)]);
  t.check('Concurrent same operation has a successful writer', concurrent.some(x => x.status === 'fulfilled'));
  const saved = await create('same_intent', key);
  t.check('Same-operation concurrency plus retry writes one draft and creation',
    saved.replayed && (await redis(['KEYS', 'draft:*'])).length === 1
    && (await read(keys.account)).active === 1 && (await read(keys.period)).created === 1);
  const deleteKey = randomUUID();
  let lose = true;
  const drop = async (...args) => {
    const out = await kv(...args);
    if (args[1] === LISTING_COMMIT_SCRIPT && lose) { lose = false; throw new Error('synthetic lost reply'); }
    return out;
  };
  await rejects('Lost delete response is unknown', () => change('delete', saved.result.draft, deleteKey, drop), 'LISTING_OUTCOME_UNKNOWN');
  const before = await snapshot(), replay = await change('delete', saved.result.draft, deleteKey);
  t.check('Delete retry never releases twice or recreates cleanup intent', replay.replayed
    && await snapshot() === before && (await read(keys.account)).active === 0
    && (await read(keys.period)).created === 1);
  await reset(); await seed();
  const d = (await create('overflow')).result.draft, raw = { ...d, rev: Number.MAX_SAFE_INTEGER - 1 };
  await redis(['SET', draftKey(owner, d.draftId), JSON.stringify(raw)]);
  await unchanged('Draft revision overflow fails before any commit', () => change('archive', raw), 'LISTING_STATE_INVALID');
  await redis(['SET', draftKey(owner, d.draftId), JSON.stringify(d)]);
  const lifeKey = lifecycleKey(owner, d.instanceId, d.slot), life = await read(lifeKey);
  await redis(['SET', lifeKey, JSON.stringify({ ...life, gen: Number.MAX_SAFE_INTEGER - 1, lastDraftGen: Number.MAX_SAFE_INTEGER - 1 })]);
  await unchanged('Generation overflow fails before deletion', () => change('delete', d), 'LISTING_STATE_INVALID');
  await reset(); await seed();
  const over = (await create('over_cap')).result.draft, account = await read(keys.account);
  await redis(['SET', keys.account, JSON.stringify({ ...account, active: 6 })]);
  const archived = await change('archive', over);
  t.check('Over-cap account can still archive without erasing creation history',
    archived.result.usage.active === 5 && archived.result.usage.created === 1);
  await unchanged('Over-cap restore remains refused', () => change('restore', archived.result.draft), 'LISTING_ACTIVE_CAP');
});

await t.section('Actual normal drafts handler with synthetic verified Firebase JWT and real Redis', async () => {
  await reset(); await seed();
  process.env.KV_REST_API_URL = 'https://kv.synthetic.invalid';
  process.env.KV_REST_API_TOKEN = 'synthetic-token';
  globalThis.crypto ||= webcrypto;
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'synthetic-listing-key', alg: 'RS256' };
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: owner, aud: 'cardresell-e0329', iss: 'https://securetoken.google.com/cardresell-e0329',
    iat: now, exp: now + 3600, email: 'synthetic@example.invalid', email_verified: true,
    firebase: { sign_in_provider: 'google.com' } };
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const token = `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
  const commands = [];
  let indexFailure = false, loseCommit = false;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url) === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com') return Response.json({ keys: [jwk] });
    if (String(url).startsWith('https://kv.synthetic.invalid')) {
      const args = opts.body ? JSON.parse(opts.body) : [];
      if (indexFailure && args[1] === LISTING_INDEX_SCRIPT) throw new Error('Synthetic index unavailable');
      const response = await redisRest(url, opts, commands);
      if (loseCommit && args[1] === LISTING_COMMIT_SCRIPT) { loseCommit = false; throw new Error('Synthetic committed response lost'); }
      return response;
    }
    throw new Error('External network forbidden by test');
  };
  const { default: handler } = await import('../api/drafts.js');
  async function call(method, query, requestBody, key = randomUUID(), auth = token) {
    const req = { method, query, body: requestBody, headers: { authorization: `Bearer ${auth}`, 'idempotency-key': key } };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; return this; }, end() { return this; } };
    await handler(req, res); return res;
  }
  const httpInput = { instanceId: 'inst_http', slot: 'ebay:fixed-price', price: 20,
    card: { game: 'pokemon', set_name: 'Champions Path', card_number: '074/073',
      card_name: 'Charizard VMAX', rarity: 'Secret Rare', language: 'en' } };
  const key = randomUUID(), c = await call('POST', {}, httpInput, key);
  t.check('Actual authenticated normalized POST creates v2 draft', c.statusCode === 201 && c.body.draft?.schemaVersion === 2,
    JSON.stringify(c.body));
  t.check('Create returns trusted period reset without invented active reset', c.body.usage.periodTimeUnit === 'unix_seconds'
    && c.body.usage.creationResetsAt === c.body.usage.periodEnd && c.body.usage.activeResetsAt === null);
  let listed = await call('GET', {});
  t.check('Normal hydrated list immediately shows created draft and tier cap', listed.statusCode === 200
    && listed.body.rows.some(r => r.draftId === c.body.draftId) && listed.body.cap === 5);
  t.check('Derived set and SKU pointer written', (await redis(['SMEMBERS', draftsKey(owner)])).includes(c.body.draftId)
    && await redis(['GET', skuDraftKey(owner, c.body.draft.sku)]) === c.body.draftId);
  const retry = await call('POST', {}, httpInput, key);
  t.check('Handler retry 200 same draft and one creation', retry.statusCode === 200 && retry.body.replayed
    && retry.body.draftId === c.body.draftId && (await read(keys.period)).created === 1);
  const ar = await call('POST', { id: c.body.draftId, action: 'archive' }, { expectedRev: 1 });
  t.check('Authenticated archive handler preserves full draft', ar.statusCode === 200 && ar.body.draft.status === 'archived');
  listed = await call('GET', {});
  t.check('Archive remains list-visible without occupying active quota',
    listed.body.rows.find(r => r.draftId === c.body.draftId)?.summary.status === 'archived' && listed.body.usage.active === 0);
  const get = await call('GET', { id: c.body.draftId });
  t.check('Normal GET can still read archived v2 record', get.statusCode === 200 && get.body.draft?.status === 'archived');
  const re = await call('POST', { id: c.body.draftId, action: 'restore' }, { expectedRev: 2 });
  t.check('Authenticated restore consumes active only', re.statusCode === 200 && re.body.draft.rev === 3
    && (await read(keys.period)).created === 1);
  const a = await read(keys.account), p = await read(keys.period);
  await redis(['MSET', keys.account, JSON.stringify({ ...a, active: 6 }), keys.period, JSON.stringify({ ...p, created: 11 })]);
  const editKey = randomUUID(), editBody = { expectedRev: 3, title: 'Edited over cap', price: 27 };
  const edit = await call('PATCH', { id: c.body.draftId }, editBody, editKey);
  t.check('Normal v2 edit succeeds over both caps with revision increment', edit.statusCode === 200 && edit.body.draft.rev === 4
    && edit.body.draft.price === 27 && edit.body.draft.priceSource === 'seller');
  t.check('Edit does not recount or discard stored card and packet', edit.body.usage.active === 6 && edit.body.usage.created === 11
    && JSON.stringify(edit.body.draft.card) === JSON.stringify(re.body.draft.card)
    && JSON.stringify(edit.body.draft.packet) === JSON.stringify(re.body.draft.packet));
  const editedBytes = await redis(['GET', draftKey(owner, c.body.draftId)]);
  const replayEdit = await call('PATCH', { id: c.body.draftId }, editBody, editKey);
  t.check('Edit retry replays exact revision, no rebuild or rewrite', replayEdit.statusCode === 200 && replayEdit.body.replayed
    && await redis(['GET', draftKey(owner, c.body.draftId)]) === editedBytes);
  const altered = await call('PATCH', { id: c.body.draftId }, { ...editBody, title: 'Altered intent' }, editKey);
  t.check('Same edit key altered payload rejected', altered.statusCode === 409 && altered.body.code === 'LISTING_OPERATION_MISMATCH');
  const stale = await call('PATCH', { id: c.body.draftId }, editBody);
  t.check('Stale edit rejected without overwrite', stale.statusCode === 409 && stale.body.code === 'LISTING_REVISION_CONFLICT');
  listed = await call('GET', {});
  t.check('List displays current edited revision while over cap', listed.body.rows.find(r => r.draftId === c.body.draftId)?.summary.rev === 4);
  const cap = await call('POST', {}, { ...httpInput, instanceId: 'inst_overcap' });
  t.check('Active refusal returns trusted cap and no calendar reset', cap.statusCode === 409 && cap.body.code === 'LISTING_ACTIVE_CAP'
    && cap.body.usage.activeLimit === 5 && cap.body.usage.activeResetsAt === null
    && cap.body.usage.creationResetsAt === p.end);
  await redis(['SET', keys.account, JSON.stringify({ ...(await read(keys.account)), active: 1 })]);
  const creationCap = await call('POST', {}, { ...httpInput, instanceId: 'inst_creation_cap' });
  t.check('Creation refusal returns trusted end-of-period reset', creationCap.statusCode === 409
    && creationCap.body.code === 'LISTING_CREATION_CAP' && creationCap.body.usage.created === 11
    && creationCap.body.usage.creationResetsAt === p.end);
  await redis(['SET', keys.period, JSON.stringify(p)]);
  const bad = await call('DELETE', { id: c.body.draftId }, { expectedRev: 4 }, randomUUID(), token.slice(0, -5) + 'WRONG');
  t.check('Invalid signature cannot delete', bad.statusCode === 401 && (await read(keys.account)).active === 1);
  const del = await call('DELETE', { id: c.body.draftId }, { expectedRev: 4 });
  t.check('Normal authenticated DELETE atomically releases active', del.statusCode === 200 && del.body.generation === 1
    && (await read(keys.account)).active === 0 && (await read(keys.period)).created === 1);
  listed = await call('GET', { ids: '1' });
  t.check('Deleted draft omitted from normal IDs response and derived set',
    !listed.body.draftIds.includes(c.body.draftId) && !(await redis(['SMEMBERS', draftsKey(owner)])).includes(c.body.draftId));
  await call('POST', {}, httpInput, key);
  t.check('Old create replay cannot re-index a deleted draft', !(await redis(['SMEMBERS', draftsKey(owner)])).includes(c.body.draftId)
    && await redis(['GET', skuDraftKey(owner, c.body.draft.sku)]) === null);
  indexFailure = true;
  const failedIndexInput = { ...httpInput, instanceId: 'inst_cache_failure' }, failedKey = randomUUID();
  const savedDegraded = await call('POST', {}, failedIndexInput, failedKey);
  t.check('Index failure reports saved and degraded, not failed create', savedDegraded.statusCode === 201
    && savedDegraded.body.saved && savedDegraded.body.degraded && savedDegraded.body.repairRequired);
  t.check('Failed index retains durable repair intent', await redis(['GET', listingIndexIntentKey(owner, savedDegraded.body.draftId)]) !== null);
  indexFailure = false;
  listed = await call('GET', {});
  t.check('Normal list repairs index failure and surfaces saved draft', listed.body.rows.some(r => r.draftId === savedDegraded.body.draftId)
    && await redis(['GET', listingIndexIntentKey(owner, savedDegraded.body.draftId)]) === null);
  const lostKey = randomUUID(), lostInput = { ...httpInput, instanceId: 'inst_lost_handler' };
  loseCommit = true;
  const unknown = await call('POST', {}, lostInput, lostKey);
  t.check('Handler committed lost response returns unknown without compensation', unknown.statusCode === 503 && unknown.body.outcomeUnknown);
  listed = await call('GET', {});
  t.check('List recovers committed-but-unindexed draft before caller retries',
    listed.body.rows.some(r => r.summary?.instanceId === lostInput.instanceId));
  const recovered = await call('POST', {}, lostInput, lostKey);
  t.check('Lost response handler retry repairs and never recounts', recovered.statusCode === 200 && recovered.body.replayed
    && !recovered.body.degraded && (await read(keys.period)).created === 3);
  const editLossKey = randomUUID(), editLoss = { expectedRev: 1, notes: 'Retained after response loss' };
  loseCommit = true;
  const unknownEdit = await call('PATCH', { id: recovered.body.draftId }, editLoss, editLossKey);
  const retryLostEdit = await call('PATCH', { id: recovered.body.draftId }, editLoss, editLossKey);
  t.check('Lost edit response replays same revision and unchanged counts', unknownEdit.statusCode === 503
    && retryLostEdit.statusCode === 200 && retryLostEdit.body.replayed && retryLostEdit.body.draft.rev === 2
    && retryLostEdit.body.usage.active === 2 && retryLostEdit.body.usage.created === 3);
  const race = await Promise.all([call('PATCH', { id: recovered.body.draftId }, { expectedRev: 2, price: 31 }),
    call('PATCH', { id: recovered.body.draftId }, { expectedRev: 2, price: 32 })]);
  t.check('Concurrent edits from one revision admit one writer', race.filter(r => r.statusCode === 200).length === 1
    && (await read(draftKey(owner, recovered.body.draftId))).rev === 3
    && (await read(keys.period)).created === 3);
  await redis(['DEL', draftsKey(owner)]);
  listed = await call('GET', {});
  t.check('Lost list cache rebuilds from primary storage without losing drafts', listed.statusCode === 200
    && listed.body.rows.length === 2 && (await redis(['SMEMBERS', draftsKey(owner)])).length === 2);
  const rebuildKey = randomUUID(), rebuildBody = { expectedRev: 3,
    pricingContext: { feeModelRevision: 1, feeScheduleVerified: '2026-09-01' } };
  const rebuilt = await call('PATCH', { id: recovered.body.draftId }, rebuildBody, rebuildKey);
  t.check('Atomic edit uses existing server packet builder and stamps new revision',
    rebuilt.statusCode === 200 && rebuilt.body.packetRebuilt && rebuilt.body.draft.rev === 4 && !!rebuilt.body.draft.packet);
  const rebuiltRaw = await redis(['GET', draftKey(owner, recovered.body.draftId)]);
  const rebuildRetry = await call('PATCH', { id: recovered.body.draftId }, rebuildBody, rebuildKey);
  t.check('Rebuild replay does not recompute packet or change stored bytes', rebuildRetry.statusCode === 200
    && rebuildRetry.body.replayed && !rebuildRetry.body.packetRebuilt
    && await redis(['GET', draftKey(owner, recovered.body.draftId)]) === rebuiltRaw);
  const contextMismatch = await call('PATCH', { id: recovered.body.draftId },
    { ...rebuildBody, pricingContext: { feeModelRevision: 2 } }, rebuildKey);
  t.check('Rebuild context participates in durable operation binding', contextMismatch.statusCode === 409
    && contextMismatch.body.code === 'LISTING_OPERATION_MISMATCH');
  const badRebuild = await call('PATCH', { id: recovered.body.draftId },
    { expectedRev: 4, pricingContext: { feeModelRevision: 1, now: 1 } });
  t.check('Forbidden rebuild input leaves authority unchanged', badRebuild.statusCode !== 200
    && await redis(['GET', draftKey(owner, recovered.body.draftId)]) === rebuiltRaw
    && (await read(keys.period)).created === 3);
  await redis(['SET', skuDraftKey(owner, recovered.body.draft.sku), c.body.draftId]);
  const repairedPointer = await repairListingIndex(kv, owner, recovered.body.draft);
  t.check('Positive tombstoned SKU pointer can be replaced by live current draft',
    !repairedPointer.degraded && await redis(['GET', skuDraftKey(owner, recovered.body.draft.sku)]) === recovered.body.draftId);
  const pointerBefore = await redis(['GET', skuDraftKey(owner, recovered.body.draft.sku)]);
  await repairListingIndex(kv, owner, c.body.draft);
  t.check('Delayed deleted-draft repair cannot clear another live pointer',
    await redis(['GET', skuDraftKey(owner, recovered.body.draft.sku)]) === pointerBefore);
  let pointerRace = true;
  const racePointerKv = async (...args) => {
    if (args[1] === LISTING_INDEX_SCRIPT && pointerRace) {
      pointerRace = false;
      await redis(['SET', skuDraftKey(owner, recovered.body.draft.sku), savedDegraded.body.draftId]);
    }
    return kv(...args);
  };
  const pointerRaceResult = await repairListingIndex(racePointerKv, owner, c.body.draft);
  t.check('Compare-delete pointer race rechecks and preserves concurrent replacement',
    !pointerRaceResult.degraded && await redis(['GET', skuDraftKey(owner, recovered.body.draft.sku)]) === savedDegraded.body.draftId);
  const failScan = async (...args) => {
    if (String(args[0]).toUpperCase() === 'SCAN') return ['1', []];
    if (String(args[0]).toUpperCase() === 'SMEMBERS') return [];
    return kv(...args);
  };
  const incomplete = await listListingIds(failScan, owner);
  t.check('Incomplete bounded scans cannot declare an empty successful list', incomplete.unavailable && incomplete.degraded);
  t.check('No legacy quota commands or SCARD admission', !commands.some(c => c.cmd === 'scard'
    || String(c.key).startsWith('draftquota:')));
  const rawClient = makeListingKv('https://kv.synthetic.invalid', 'synthetic-token');
  t.check('Body-form transport reaches actual Redis', await rawClient('GET', keys.account) === await redis(['GET', keys.account]));
});
t.done();
