// Actual private Redis. No network/auth/provider substitutes are presented as
// normal-browser acceptance. This tests ownership of one HTTP scan attempt.
import { harness } from './_assert.mjs';
import { redisCommand as redis } from './_idRedis.mjs';
import { createMembershipScanIntents, scanIntentDigest } from '../api/_membershipScanIntent.js';
const t = harness('membership-scan-intent');
const input = { owner: 'intentSyntheticOwner', operation: 'a'.repeat(64),
  digest: scanIntentDigest({ mode: 'grade', front: 'synthetic-front', back: 'synthetic-back' }) };
const intents = createMembershipScanIntents({ execute: redis });
const reset = () => redis(['FLUSHDB']);
const snapshot = async () => {
  const keys = (await redis(['KEYS', '*'])).sort();
  return JSON.stringify(await Promise.all(keys.map(async k => [k, await redis(['GET', k]), await redis(['PTTL', k])])));
};
const rejected = async (name, fn, code) => {
  try { await fn(); t.check(name, false); }
  catch (error) { t.check(name, error.code === code, error.code); }
};

await t.section('canonical request binding', async () => {
  t.check('field order and operation token do not change content digest',
    scanIntentDigest({ a: 1, b: { x: 2 }, operation_id: 'a' })
    === scanIntentDigest({ operation_id: 'b', b: { x: 2 }, a: 1 }));
  for (const [a, b] of [
    [{ mode: 'identify' }, { mode: 'grade' }],
    [{ front: 'A' }, { front: 'B' }],
    [{ photos: ['a', 'b'] }, { photos: ['b', 'a'] }],
    [{ deep: false }, { deep: true }],
    [{ a: 1 }, { a: '1' }],
  ]) t.check('changed immutable scan content changes digest', scanIntentDigest(a) !== scanIntentDigest(b));
  for (const bad of [null, [], { bad: undefined }, { bad: Infinity }, { bad: () => 1 }])
    await rejected('unsupported request fails closed', () => scanIntentDigest(bad), 'invalid_scan_intent');
  const cycle = {}; cycle.self = cycle;
  await rejected('cyclic request rejected', () => scanIntentDigest(cycle), 'invalid_scan_intent');
});

await t.section('single acknowledged claimant, immutable result and ownership', async () => {
  await reset();
  const results = await Promise.all(Array.from({ length: 24 }, () => intents.begin(input)));
  const winner = results.find(r => r.state === 'claimed');
  t.check('one winner under concurrency', results.filter(r => r.state === 'claimed').length === 1);
  t.check('all other callers remain pending without claim authority',
    results.filter(r => r.state === 'pending').length === 23
    && results.filter(r => r.state === 'pending').every(r => r.authority === undefined));
  t.check('single receipt and scan identity', results.every(r => r.receipt === winner.receipt && r.scan === winner.scan));
  const body = { success: true, scan_id: winner.scan, pickedCard: { name: 'Synthetic card', prices: [1.23] } };
  const done = await intents.complete(winner.authority, 200, body);
  t.check('canonical result completed', done.state === 'complete' && JSON.stringify(done.body) === JSON.stringify(body));
  const replay = await intents.begin(input);
  t.check('replay returns the same status/body without new claim',
    replay.state === 'complete' && replay.status === 200 && JSON.stringify(replay.body) === JSON.stringify(body));
  const before = await snapshot();
  await rejected('changed photos on same operation rejected',
    () => intents.begin({ ...input, digest: 'b'.repeat(64) }), 'scan_intent_conflict');
  await rejected('different completion cannot overwrite result',
    () => intents.complete(winner.authority, 200, { success: false }), 'scan_intent_conflict');
  await rejected('forged completion token refused',
    () => intents.complete({ ...winner.authority, claim: '0'.repeat(64) }, 200, body), 'scan_intent_conflict');
  t.check('conflicts preserve exact journal bytes and TTL', before === await snapshot());
  const other = await intents.begin({ ...input, owner: 'differentSyntheticOwner' });
  t.check('same operation token is isolated by authenticated owner',
    other.state === 'claimed' && other.receipt !== winner.receipt && other.scan !== winner.scan);
  t.check('journal has no automatic expiration', (await redis(['KEYS', '*'])).length === 2
    && (await Promise.all((await redis(['KEYS', '*'])).map(k => redis(['PTTL', k])))).every(n => n === -1));
});

await t.section('uncertain Redis outcomes never reclaim provider execution', async () => {
  await reset();
  let first = true;
  const uncertain = createMembershipScanIntents({ execute: async args => {
    const reply = await redis(args);
    if (first) { first = false; throw new Error('committed response lost'); }
    return reply;
  } });
  await rejected('lost begin reports unavailable', () => uncertain.begin(input), 'scan_intent_unavailable');
  const pending = await intents.begin(input);
  t.check('lost claim is pending, never a second claimant', pending.state === 'pending' && !pending.authority);
  const rawBefore = await snapshot();
  for (let i = 0; i < 5; i++) t.check('repeated retry does not reclaim', (await intents.begin(input)).state === 'pending');
  t.check('unknown claim remains byte-identical', rawBefore === await snapshot());
  await reset();
  const winner = await intents.begin(input);
  const lostComplete = createMembershipScanIntents({ execute: async args => {
    await redis(args); throw new Error('result response lost');
  } });
  await rejected('lost completion reports unavailable',
    () => lostComplete.complete(winner.authority, 503, { error: 'provider_unavailable', refunded: true }),
    'scan_intent_unavailable');
  const replay = await intents.begin(input);
  t.check('known stored provider failure replays without another attempt',
    replay.state === 'complete' && replay.status === 503 && replay.body.refunded === true);
  const retry = await intents.complete(winner.authority, 503, replay.body);
  t.check('same completion retry remains idempotent', retry.state === 'complete');
});

await t.section('malformed authority and completion serialization', async () => {
  await reset();
  for (const bad of [{ ...input, owner: '' }, { ...input, operation: 'bad' }, { ...input, digest: 'bad' }])
    await rejected('invalid authority before mutation', () => intents.begin(bad), 'invalid_scan_intent');
  t.check('no records for invalid identities', (await redis(['DBSIZE'])) === 0);
  const winner = await intents.begin(input), before = await snapshot();
  const cycle = {}; cycle.self = cycle;
  for (const [status, body] of [[199, {}], [200.1, {}], [600, {}], [200, []], [200, cycle]])
    await rejected('invalid result before commit', () => intents.complete(winner.authority, status, body), 'invalid_scan_result');
  t.check('failed serialization preserves running claim', before === await snapshot());
  await redis(['SET', winner.authority.key, '{bad']);
  await rejected('corrupt intent is not a new claim', () => intents.begin(input), 'scan_intent_unavailable');
  const broken = createMembershipScanIntents({ execute: async () => JSON.stringify({ state: 'claimed' }) });
  await rejected('missing response bindings fail closed', () => broken.begin(input), 'scan_intent_unavailable');
});
await t.section('encoder faults cannot commit records or altered responses', async () => {
  for (const action of ['begin', 'complete']) {
    for (const target of ['record', 'response']) {
      for (const fault of ['changed', 'nonstring', 'invalid']) {
        await reset();
        const winner = action === 'complete' ? await intents.begin(input) : null;
        const before = await snapshot();
        const faulty = createMembershipScanIntents({ execute: async args => {
          const prefix = `
local original=cjson
local cjson={decode=original.decode}
cjson.encode=function(v)
  local target=${JSON.stringify(target)}
  local matches=(target=='record' and v.version=='launch-v2')
    or (target=='response' and v.version==nil)
  if matches then
    local fault=${JSON.stringify(fault)}
    if fault=='nonstring' then return 42 end
    if fault=='invalid' then return '{bad' end
    local copy=original.decode(original.encode(v))
    copy.body='{"altered":true}'
    return original.encode(copy)
  end
  return original.encode(v)
end
`;
          return redis([args[0], prefix + args[1], ...args.slice(2)]);
        } });
        await rejected(`${action} ${target} ${fault} fails closed`,
          () => action === 'begin' ? faulty.begin(input)
            : faulty.complete(winner.authority, 200, { actual: true }),
          'scan_intent_unavailable');
        t.check(`${action} ${target} ${fault} preserves all bytes`, before === await snapshot());
      }
    }
  }
});
t.done();
