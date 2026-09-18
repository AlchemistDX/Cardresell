// DORMANT durable server binding store. No routes, Stripe calls or credentials.
// Only a trusted server checkout/schedule controller may call these mutations.
// Persist intent BEFORE Stripe creation; retry the same Stripe idempotency key.
// Redis and Stripe are NOT one transaction. An unknown external outcome stays
// recoverable, never permission to invent a new intent or blindly create again.
import { createHash, randomBytes } from 'node:crypto';
import { MEMBERSHIP_VERSION, LAUNCH_PLANS, LAUNCH_PACKS, quoteLaunchPack } from './_launchMembershipConfig.js';

const PREFIX = `membership:${MEMBERSHIP_VERSION}:bindings:`;
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, function (key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item;
});
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const validUID = x => typeof x === 'string' && x.length > 0 && x.length <= 128 && !/[\u0000-\u0020\u007f]/.test(x);
const validId = (x, prefix) => typeof x === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_]{1,180}$`).test(x);
const validIntent = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const epoch = x => Number.isInteger(x) && x > 0 && x <= 4102444800;
export class MembershipBindingError extends Error {
  constructor(code, cause) { super(code, cause === undefined ? undefined : { cause }); this.code = code; }
}
function insist(value, code = 'invalid_binding') { if (!value) throw new MembershipBindingError(code); }
function exact(value, fields) {
  insist(isObject(value) && Object.keys(value).length === fields.length && fields.every(k => Object.hasOwn(value, k)));
}
function seal(kind, data) { return { version: MEMBERSHIP_VERSION, kind, data, hash: hash(canonical(data)) }; }
function unseal(record, kind) {
  insist(isObject(record) && record.version === MEMBERSHIP_VERSION && record.kind === kind
    && isObject(record.data) && record.hash === hash(canonical(record.data)), 'corrupt_binding');
  return record.data;
}
export const newMembershipIntentId = () => randomBytes(32).toString('hex');

// Records and alias mappings are written together. Existing records are never
// overwritten/repaired. Exact JSON validation occurs before the sole MSET.
// Finite historical terms never mutate; overlapping terms are refused. An
// explicit new authorized finite range is required for every later period.
export const MEMBERSHIP_BINDINGS_SCRIPT = `
local ok,p=pcall(cjson.decode,ARGV[1])
if not ok or type(p)~='table' then error('invalid input') end
local function same(a,b)
  if type(a)~=type(b) then return false end
  if type(a)~='table' then return a==b end
  for k,v in pairs(a) do if not same(v,b[k]) then return false end end
  for k,_ in pairs(b) do if a[k]==nil then return false end end
  return true
end
local function encode(v)
  local ok,s=pcall(cjson.encode,v)
  if not ok or type(s)~='string' then error('invalid encoding') end
  local valid,decoded=pcall(cjson.decode,s)
  if not valid or not same(v,decoded) then error('invalid encoding') end
  return s
end
local function read(key,kind)
  local raw=redis.call('GET',key)
  if not raw then return nil end
  local ok,r=pcall(cjson.decode,raw)
  if not ok or type(r)~='table' or r.version~=p.version or r.kind~=kind
    or type(r.data)~='table' or type(r.hash)~='string' then error('corrupt binding') end
  return r
end
local writes={}
local function put(key,r) table.insert(writes,key); table.insert(writes,encode(r)) end
local function fail(code) return encode({ok=false,code=code}) end
local function pair(rootKey,root,aliasKey,alias,shared)
  local old=read(rootKey,root.kind)
  local mapped=read(aliasKey,alias.kind)
  if old then
    if not same(old,root) then return 'binding_conflict' end
    if not mapped or not same(mapped,alias) then return 'corrupt_mapping' end
    return nil
  end
  if mapped and (not shared or not same(mapped,alias)) then return 'mapping_conflict' end
  put(rootKey,root)
  if not mapped then put(aliasKey,alias) end
  return nil
end
local result
if p.action=='intent' then
  local err=pair(KEYS[1],p.record,KEYS[2],p.alias,true)
  if err then return fail(err) end
  result=p.record
elseif p.action=='session' or p.action=='settlement' then
  local order=read(KEYS[1],'order')
  if not order or not same(order,p.order) then return fail('order_mismatch') end
  local customer=read(KEYS[2],'customer')
  if not customer or not same(customer,p.customer) then return fail('corrupt_mapping') end
  if p.action=='settlement' then
    local session=read(KEYS[5],'session')
    local sessionMap=read(KEYS[6],'session_map')
    if not session or not same(session,p.session) or not sessionMap or not same(sessionMap,p.sessionMap) then
      return fail('session_mismatch')
    end
  end
  local err=pair(KEYS[3],p.record,KEYS[4],p.alias,false)
  if err then return fail(err) end
  if p.history then
    local authority=read(KEYS[7],'history_authority')
    local index=read(KEYS[8],'term_index')
    if redis.call('EXISTS',KEYS[3])==1 then
      -- A replay may never turn missing history into a fresh empty index.
      if not authority or not same(authority,p.history) or not index
        or index.data.scope~=p.history.data.scope
        or (index.data.entries~=false and type(index.data.entries)~='table') then
        return fail('corrupt_mapping')
      end
    else
      if authority or index then return fail('corrupt_mapping') end
      put(KEYS[7],p.history); put(KEYS[8],p.initialIndex)
    end
  end
  result=p.record
elseif p.action=='term' then
  for i,expected in ipairs(p.references) do
    local current=read(KEYS[5+i],expected.kind)
    if not current or not same(current,expected) then return fail('corrupt_mapping') end
  end
  local sub=read(KEYS[1],'subscription_map')
  if not sub or not same(sub,p.subscription) then return fail('subscription_mismatch') end
  local origin=read(KEYS[4],'order')
  local settlement=read(KEYS[5],'settlement')
  if not origin or not same(origin,p.origin) or not settlement or not same(settlement,p.settlement) then
    return fail('subscription_mismatch')
  end
  local existing=read(KEYS[2],'term')
  local index=read(KEYS[3],'term_index')
  if not index or index.data.scope~=p.scope
    or (index.data.entries~=false and type(index.data.entries)~='table') then error('corrupt index') end
  if existing then
    if not same(existing,p.record) then return fail('binding_conflict') end
    if not index then return fail('corrupt_mapping') end
    local matches=0
    for _,entry in ipairs(index.data.entries or {}) do
      if same(entry,p.entry) then matches=matches+1 end
    end
    if matches~=1 then return fail('corrupt_mapping') end
  else
    local entries=index and index.data.entries or {}
    if #entries>=128 then return fail('term_limit') end
    for _,entry in ipairs(entries) do
      if type(entry.start)~='number' or type(entry.finish)~='number' or entry.finish<=entry.start then error('corrupt index') end
      if p.entry.start<entry.finish and p.entry.finish>entry.start then return fail('term_overlap') end
    end
    -- JS supplies the full expected post-index and its canonical digest. Compare
    -- every old entry to ensure concurrent appends cannot lose an existing term.
    if not same(entries,p.beforeEntries) then return fail('index_changed') end
    put(KEYS[2],p.record); put(KEYS[3],p.afterIndex)
  end
  result=p.record
elseif p.action=='read' then
  result=read(KEYS[1],p.kind)
elseif p.action=='read_bundle' then
  -- Atomic snapshot of a fixed server-generated key list. Return serialized
  -- records, not aliased Lua tables in a shared result graph.
  local values={}
  for i,key in ipairs(KEYS) do
    local r=read(key,p.kinds[i])
    values[i]=r and encode(r) or false
  end
  return encode({ok=true,records=values})
else return fail('invalid_action') end
local response=encode({ok=true,record_json=result and encode(result) or false})
if #writes>0 then redis.call('MSET',unpack(writes)) end
return response
`;

export function createMembershipBindingStore({ execute, accountId, livemode, priceMap }) {
  insist(typeof execute === 'function' && validId(accountId, 'acct') && typeof livemode === 'boolean', 'store_configuration');
  const prices = structuredClone(priceMap);
  insist(isObject(prices) && isObject(prices.packs) && isObject(prices.plans), 'store_configuration');
  const knownPrices = new Set();
  for (const [group, names] of [['packs', Object.keys(LAUNCH_PACKS)], ['plans', Object.keys(LAUNCH_PLANS).filter(x => x !== 'free')]]) {
    insist(Object.keys(prices[group]).length === names.length, 'store_configuration');
    for (const name of names) {
      const map = prices[group][name];
      insist(isObject(map) && Object.keys(map).length === 2
        && validId(map.priceId, 'price') && validId(map.productId, 'prod')
        && !knownPrices.has(map.priceId), 'store_configuration');
      knownPrices.add(map.priceId);
    }
  }
  const scope = canonical({ accountId, livemode });
  const aliasKey = (kind, value) => `${PREFIX}${kind}:${hash(`${scope}:${value}`)}`;
  const key = (kind, intent) => `${PREFIX}${kind}:${intent}`;
  const termKey = (subScope, start) => `${PREFIX}term:${subScope}:${start}`;
  async function call(action, keys, data) {
    try {
      const raw = await execute(['EVAL', MEMBERSHIP_BINDINGS_SCRIPT, keys.length, ...keys,
        JSON.stringify({ version: MEMBERSHIP_VERSION, action, ...data })]);
      insist(typeof raw === 'string', 'store_unavailable');
      const response = JSON.parse(raw);
      insist(isObject(response) && typeof response.ok === 'boolean', 'store_unavailable');
      if (!response.ok) {
        insist(['binding_conflict', 'mapping_conflict', 'corrupt_mapping', 'order_mismatch',
          'session_mismatch', 'subscription_mismatch', 'term_overlap', 'term_limit',
          'index_changed', 'invalid_action'].includes(response.code), 'store_unavailable');
        throw new MembershipBindingError(response.code);
      }
      return response;
    } catch (cause) {
      if (cause instanceof MembershipBindingError) throw cause;
      throw new MembershipBindingError('store_unavailable', cause);
    }
  }
  const read = async (k, kind) => {
    const r = await call('read', [k], { kind });
    if (r.record_json === false) return null;
    insist(typeof r.record_json === 'string', 'corrupt_binding');
    const record = JSON.parse(r.record_json); unseal(record, kind); return record;
  };
  function base(data) {
    insist(data.version === MEMBERSHIP_VERSION && data.accountId === accountId && data.livemode === livemode
      && validUID(data.owner) && validId(data.customerId, 'cus'));
  }
  function orderData(input) {
    exact(input, ['intentId', 'kind', 'owner', 'customerId', 'plan', 'packId']);
    insist(validIntent(input.intentId) && ['pack', 'subscription'].includes(input.kind));
    const data = { version: MEMBERSHIP_VERSION, accountId, livemode, ...input, quantity: 1, currency: 'usd' };
    base(data);
    if (input.kind === 'pack') {
      insist(Object.hasOwn(LAUNCH_PACKS, input.packId) && Object.hasOwn(LAUNCH_PLANS, input.plan));
      const quote = quoteLaunchPack(input.packId, input.plan);
      Object.assign(data, prices.packs[input.packId], { amountCents: quote.amountCents, planAtCheckout: input.plan });
    } else {
      insist(input.packId === null && input.plan !== 'free' && Object.hasOwn(LAUNCH_PLANS, input.plan));
      Object.assign(data, prices.plans[input.plan], { amountCents: LAUNCH_PLANS[input.plan].monthlyPriceCents });
    }
    data.stripeIdempotencyKey = `membership-${MEMBERSHIP_VERSION}-${input.intentId}`;
    return data;
  }
  function validateOrder(record) {
    const data = unseal(record, 'order');
    const expected = orderData(Object.fromEntries(['intentId', 'kind', 'owner', 'customerId', 'plan', 'packId'].map(k => [k, data[k]])));
    insist(canonical(data) === canonical(expected), 'corrupt_binding');
    return data;
  }
  const customerRecord = order => seal('customer', {
    owner: order.owner, customerId: order.customerId, accountId, livemode,
  });
  const linkData = (order, extras) => ({
    intentId: order.intentId, orderHash: hash(canonical(order)), owner: order.owner,
    customerId: order.customerId, accountId, livemode, ...extras,
  });
  const historyRecord = mapping => seal('history_authority', {
    scope: hash(`${scope}:${mapping.subscriptionId}`), subscriptionId: mapping.subscriptionId,
    originIntentId: mapping.intentId, settlementHash: hash(canonical(mapping)),
  });
  async function loadOrder(intentId) {
    insist(validIntent(intentId));
    const order = await read(key('order', intentId), 'order');
    insist(order, 'binding_missing'); validateOrder(order); return order;
  }
  async function sessionRecord(order, sessionId) {
    const session = await read(key('session', order.intentId), 'session');
    insist(session && canonical(unseal(session, 'session')) === canonical(linkData(order, { sessionId })), 'session_mismatch');
    return session;
  }
  async function bundle(keys, kinds) {
    const result = await call('read_bundle', keys, { kinds });
    insist(Array.isArray(result.records) && result.records.length === keys.length, 'corrupt_binding');
    return result.records.map((raw, i) => {
      if (raw === false) return null;
      insist(typeof raw === 'string', 'corrupt_binding');
      const record = JSON.parse(raw); unseal(record, kinds[i]); return record;
    });
  }
  function indexData(index, subScope) {
    insist(index, 'corrupt_mapping');
    const data = unseal(index, 'term_index');
    insist(data.scope === subScope, 'corrupt_binding');
    // Explicit false is the initialized, empty history. Never JSON []: Redis
    // cjson would encode its empty Lua table as {}, changing the sealed bytes.
    if (data.entries === false) return { scope: subScope, entries: [] };
    insist(Array.isArray(data.entries) && data.entries.length > 0 && data.entries.length <= 128, 'corrupt_binding');
    let end = 0;
    for (const entry of data.entries) {
      insist(isObject(entry) && epoch(entry.start) && epoch(entry.finish) && entry.finish > entry.start
        && entry.start >= end && /^[a-f0-9]{64}$/.test(entry.hash), 'corrupt_binding');
      end = entry.finish;
    }
    return data;
  }
  function validateTerm(record, entry, order, subscriptionId) {
    insist(record && record.hash === entry.hash, 'corrupt_mapping');
    const term = unseal(record, 'term'); base(term);
    insist(term.subscriptionId === subscriptionId && term.kind === 'subscription'
      && term.owner === order.owner && term.customerId === order.customerId && term.originIntentId === order.intentId
      && term.effectiveFrom === entry.start && term.effectiveUntil === entry.finish
      && /^[a-f0-9]{64}$/.test(term.authorizationId)
      && Object.hasOwn(prices.plans, term.plan) && term.priceId === prices.plans[term.plan].priceId
      && term.productId === prices.plans[term.plan].productId && term.currency === 'usd'
      && term.amountCents === LAUNCH_PLANS[term.plan].monthlyPriceCents, 'corrupt_binding');
    return term;
  }
  return Object.freeze({
    async createIntent(input) {
      const data = orderData(input), record = seal('order', data), alias = customerRecord(data);
      await call('intent', [key('order', input.intentId), aliasKey('customer', input.customerId)], { record, alias });
      return structuredClone(data);
    },
    async getIntent(intentId) { return validateOrder(await loadOrder(intentId)); },
    async inspectIntent(intentId) {
      const origin = await loadOrder(intentId), order = validateOrder(origin);
      const records = await bundle([key('order', intentId), key('session', intentId), key('settlement', intentId)],
        ['order', 'session', 'settlement']);
      insist(records[0] && canonical(records[0]) === canonical(origin), 'corrupt_mapping');
      const session = records[1] && unseal(records[1], 'session');
      const settlement = records[2] && unseal(records[2], 'settlement');
      if (session) insist(validId(session.sessionId, 'cs')
        && canonical(session) === canonical(linkData(order, { sessionId: session.sessionId })), 'corrupt_binding');
      if (settlement) {
        insist(session && (order.kind === 'pack'
          ? validId(settlement.paymentId, 'pi') && settlement.subscriptionId === null
          : validId(settlement.subscriptionId, 'sub') && settlement.paymentId === null), 'corrupt_binding');
        insist(canonical(settlement) === canonical(linkData(order, {
          sessionId: session.sessionId, paymentId: settlement.paymentId, subscriptionId: settlement.subscriptionId,
        })), 'corrupt_binding');
      }
      const keys = [key('order', intentId), key('session', intentId), key('settlement', intentId),
        aliasKey('customer', order.customerId)];
      const kinds = ['order', 'session', 'settlement', 'customer'];
      const expected = [...records, customerRecord(order)];
      if (session) {
        keys.push(aliasKey('session_map', session.sessionId)); kinds.push('session_map');
        expected.push(seal('session_map', session));
      }
      if (settlement) {
        const kind = order.kind === 'pack' ? 'payment_map' : 'subscription_map';
        keys.push(aliasKey(kind, settlement.paymentId || settlement.subscriptionId)); kinds.push(kind);
        expected.push(seal(kind, settlement));
        if (order.kind === 'subscription') {
          const history = historyRecord(settlement), subScope = history.data.scope;
          keys.push(`${PREFIX}history_authority:${subScope}`, `${PREFIX}term_index:${subScope}`);
          kinds.push('history_authority', 'term_index');
          expected.push(history);
          // Index is mutable only through append CAS, not an immutable link.
        }
      }
      const checked = await bundle(keys, kinds);
      insist(checked.slice(0, expected.length).every((r, i) => canonical(r) === canonical(expected[i])), 'corrupt_mapping');
      if (settlement && order.kind === 'subscription') indexData(checked.at(-1), historyRecord(settlement).data.scope);
      return { order, state: settlement ? 'canonical_bound' : session ? 'session_bound' : 'intent_persisted',
        sessionId: session?.sessionId || null, paymentId: settlement?.paymentId || null,
        subscriptionId: settlement?.subscriptionId || null };
    },
    async bindSession({ intentId, sessionId }) {
      insist(validId(sessionId, 'cs'));
      const origin = await loadOrder(intentId), order = validateOrder(origin);
      const record = seal('session', linkData(order, { sessionId }));
      await call('session', [key('order', intentId), aliasKey('customer', order.customerId),
        key('session', intentId), aliasKey('session_map', sessionId)],
      { order: origin, customer: customerRecord(order), record, alias: seal('session_map', record.data) });
      return structuredClone(record.data);
    },
    async bindSettlement({ intentId, sessionId, paymentId = null, subscriptionId = null }) {
      const origin = await loadOrder(intentId), order = validateOrder(origin);
      insist(validId(sessionId, 'cs'));
      const session = await sessionRecord(order, sessionId);
      insist(order.kind === 'pack'
        ? validId(paymentId, 'pi') && subscriptionId === null
        : validId(subscriptionId, 'sub') && paymentId === null);
      const record = seal('settlement', linkData(order, { sessionId, paymentId, subscriptionId }));
      const kind = order.kind === 'pack' ? 'payment_map' : 'subscription_map';
      const history = order.kind === 'subscription' ? historyRecord(record.data) : null;
      await call('settlement', [key('order', intentId), aliasKey('customer', order.customerId),
        key('settlement', intentId), aliasKey(kind, paymentId || subscriptionId),
        key('session', intentId), aliasKey('session_map', sessionId),
        ...(history ? [`${PREFIX}history_authority:${history.data.scope}`, `${PREFIX}term_index:${history.data.scope}`] : [])],
      { order: origin, customer: customerRecord(order), session, sessionMap: seal('session_map', session.data),
        record, alias: seal(kind, record.data),
        ...(history ? { history, initialIndex: seal('term_index', { scope: history.data.scope, entries: false }) } : {}) });
      return structuredClone(record.data);
    },
    async getCheckoutOrder(sessionId) {
      insist(validId(sessionId, 'cs'));
      const mapping = await read(aliasKey('session_map', sessionId), 'session_map');
      if (!mapping) return null;
      const mapped = unseal(mapping, 'session_map'); insist(validIntent(mapped.intentId), 'corrupt_binding');
      const origin = await loadOrder(mapped.intentId), order = validateOrder(origin);
      insist(order.kind === 'pack', 'unsupported_order_kind');
      const settlement = await read(key('settlement', order.intentId), 'settlement');
      insist(settlement, 'settlement_pending');
      const data = unseal(settlement, 'settlement');
      insist(validId(data.paymentId, 'pi') && data.subscriptionId === null
        && canonical(data) === canonical(linkData(order, { sessionId, paymentId: data.paymentId, subscriptionId: null })), 'corrupt_binding');
      const expected = [origin, seal('session', linkData(order, { sessionId })), seal('session_map', linkData(order, { sessionId })),
        settlement, seal('payment_map', data), customerRecord(order)];
      const records = await bundle([key('order', order.intentId), key('session', order.intentId), aliasKey('session_map', sessionId),
        key('settlement', order.intentId), aliasKey('payment_map', data.paymentId), aliasKey('customer', order.customerId)],
      ['order', 'session', 'session_map', 'settlement', 'payment_map', 'customer']);
      insist(records.every((r, i) => r && canonical(r) === canonical(expected[i])), 'corrupt_mapping');
      return { ...order, sessionId, paymentId: data.paymentId };
    },
    async createTerm(input) {
      exact(input, ['originIntentId', 'subscriptionId', 'plan', 'effectiveFrom', 'effectiveUntil', 'authorizationId']);
      insist(validId(input.subscriptionId, 'sub') && epoch(input.effectiveFrom) && epoch(input.effectiveUntil)
        && input.effectiveUntil > input.effectiveFrom && /^[a-f0-9]{64}$/.test(input.authorizationId)
        && Object.hasOwn(prices.plans, input.plan));
      const origin = await loadOrder(input.originIntentId), order = validateOrder(origin);
      insist(order.kind === 'subscription', 'unsupported_order_kind');
      const sub = await read(aliasKey('subscription_map', input.subscriptionId), 'subscription_map');
      insist(sub, 'binding_missing');
      const mapping = unseal(sub, 'subscription_map');
      insist(validId(mapping.sessionId, 'cs') && mapping.paymentId === null
        && canonical(mapping) === canonical(linkData(order, {
          sessionId: mapping.sessionId, paymentId: null, subscriptionId: input.subscriptionId,
        })), 'subscription_mismatch');
      const data = { version: MEMBERSHIP_VERSION, kind: 'subscription', owner: order.owner,
        accountId, livemode, customerId: order.customerId, ...input,
        ...prices.plans[input.plan], currency: 'usd', amountCents: LAUNCH_PLANS[input.plan].monthlyPriceCents };
      const record = seal('term', data), subScope = hash(`${scope}:${input.subscriptionId}`);
      const indexKey = `${PREFIX}term_index:${subScope}`;
      const index = await read(indexKey, 'term_index');
      const entries = indexData(index, subScope).entries;
      const referenceKeys = [aliasKey('customer', order.customerId), key('session', order.intentId),
        aliasKey('session_map', mapping.sessionId), `${PREFIX}history_authority:${subScope}`,
        ...entries.map(e => termKey(subScope, e.start))];
      const references = await bundle(referenceKeys, ['customer', 'session', 'session_map', 'history_authority', ...entries.map(() => 'term')]);
      const expectedLinks = [customerRecord(order), seal('session', linkData(order, { sessionId: mapping.sessionId })),
        seal('session_map', linkData(order, { sessionId: mapping.sessionId })), historyRecord(mapping)];
      insist(references.slice(0, 4).every((r, i) => r && canonical(r) === canonical(expectedLinks[i])), 'corrupt_mapping');
      references.slice(4).forEach((r, i) => validateTerm(r, entries[i], order, input.subscriptionId));
      const entry = { start: input.effectiveFrom, finish: input.effectiveUntil, hash: record.hash };
      const afterIndex = seal('term_index', { scope: subScope,
        entries: [...entries, entry].sort((a, b) => a.start - b.start) });
      await call('term', [aliasKey('subscription_map', input.subscriptionId),
        termKey(subScope, input.effectiveFrom), indexKey, key('order', input.originIntentId),
        key('settlement', input.originIntentId), ...referenceKeys], {
        record, scope: subScope, entry, beforeEntries: entries, afterIndex,
        subscription: sub, origin, settlement: seal('settlement', mapping), references,
      });
      return structuredClone(data);
    },
    async getSubscriptionTerm(subscriptionId, periodStart) {
      insist(validId(subscriptionId, 'sub') && epoch(periodStart));
      const subScope = hash(`${scope}:${subscriptionId}`), indexKey = `${PREFIX}term_index:${subScope}`;
      const historyKey = `${PREFIX}history_authority:${subScope}`;
      const [sub, index, history] = await bundle([aliasKey('subscription_map', subscriptionId), indexKey, historyKey],
        ['subscription_map', 'term_index', 'history_authority']);
      if (!sub) {
        insist(!index && !history, 'corrupt_mapping');
        return null;
      }
      const data = indexData(index, subScope);
      const mapping = unseal(sub, 'subscription_map');
      insist(history && canonical(history) === canonical(historyRecord(mapping)), 'corrupt_mapping');
      insist(validIntent(mapping.intentId) && validId(mapping.sessionId, 'cs'), 'corrupt_binding');
      const origin = await loadOrder(mapping.intentId), order = validateOrder(origin);
      insist(order.kind === 'subscription' && mapping.paymentId === null
        && canonical(mapping) === canonical(linkData(order, {
          sessionId: mapping.sessionId, paymentId: null, subscriptionId,
        })), 'corrupt_mapping');
      const chainKeys = [aliasKey('subscription_map', subscriptionId), key('order', order.intentId),
        key('settlement', order.intentId), aliasKey('customer', order.customerId),
        key('session', order.intentId), aliasKey('session_map', mapping.sessionId), historyKey];
      const expectedChain = [sub, origin, seal('settlement', mapping), customerRecord(order),
        seal('session', linkData(order, { sessionId: mapping.sessionId })),
        seal('session_map', linkData(order, { sessionId: mapping.sessionId })), history];
      const records = await bundle([indexKey, ...data.entries.map(e => termKey(subScope, e.start)), ...chainKeys],
        ['term_index', ...data.entries.map(() => 'term'), 'subscription_map', 'order', 'settlement', 'customer', 'session', 'session_map', 'history_authority']);
      insist(records[0] && canonical(records[0]) === canonical(index), 'index_changed');
      insist(records.slice(1 + data.entries.length).every((r, i) => r && canonical(r) === canonical(expectedChain[i])), 'corrupt_mapping');
      const terms = records.slice(1, 1 + data.entries.length)
        .map((record, i) => validateTerm(record, data.entries[i], order, subscriptionId));
      return terms.find(term => periodStart >= term.effectiveFrom && periodStart < term.effectiveUntil) || null;
    },
  });
}
