// Server-only immutable owner/customer association. Unknown POST outcomes never
// restart creation. No email lookup, metadata ownership inference, or live mode.
import { createHash, randomBytes } from 'node:crypto';
const hash = x => createHash('sha256').update(x).digest('hex');
const uid = x => typeof x === 'string' && x.length > 0 && x.length <= 128 && !/[\u0000-\u0020\u007f]/.test(x);
const id = (x, p) => typeof x === 'string' && new RegExp(`^${p}_[A-Za-z0-9_]+$`).test(x);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const CAS = `
if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
local alias=redis.call('GET',KEYS[2])
if alias and alias~=ARGV[3] then return -1 end
redis.call('MSET',KEYS[1],ARGV[2],KEYS[2],ARGV[3])
return 1`;
const IMPORT = `
if redis.call('GET',KEYS[1])~='1' then return 0 end
local owner=redis.call('GET',KEYS[2])
local alias=redis.call('GET',KEYS[3])
local audit=redis.call('GET',KEYS[4])
if owner or alias or audit then
 if owner==ARGV[1] and alias==ARGV[2] and audit==ARGV[3] then return 2 end
 return 0
end
redis.call('MSET',KEYS[2],ARGV[1],KEYS[3],ARGV[2],KEYS[4],ARGV[3])
return 1`;
export function createMembershipCustomers({ execute, stripe, accountId, livemode, allowCreate,
  authorizeExisting, now = Date.now }) {
  if (!id(accountId, 'acct') || livemode !== false || typeof execute !== 'function'
    || typeof allowCreate !== 'function') fail('customer_configuration');
  const prefix = `membership:launch-v2:customers:${hash(accountId + ':test')}:`;
  const key = owner => { if (!uid(owner)) fail('invalid_owner'); return prefix + hash(owner); };
  function record(raw, owner) {
    if (!raw) return null;
    let r; try { r = JSON.parse(raw); } catch { fail('customer_corrupt'); }
    if (r.version !== 1 || r.owner !== owner || r.accountId !== accountId || r.livemode !== false
      || !['claimed', 'bound'].includes(r.state) || !/^[a-f0-9]{64}$/.test(r.operationId)
      || !Number.isSafeInteger(r.createdAt) || (r.state === 'bound' && !id(r.customerId, 'cus'))) fail('customer_corrupt');
    return r;
  }
  async function canonical(customerId) {
    const account = await stripe.retrieveAccount();
    if (account?.id !== accountId || account.object !== 'account') fail('account_mismatch');
    const c = await stripe.retrieveCustomer(customerId);
    if (c?.id !== customerId || c.object !== 'customer' || c.livemode !== false || c.deleted) fail('customer_mismatch');
    return c;
  }
  async function get(owner) {
    const r = record(await execute(['GET', key(owner)]), owner);
    if (r?.state === 'bound') {
      const alias = await execute(['GET', prefix + 'alias:' + r.customerId]);
      if (alias !== owner) fail('customer_corrupt');
    }
    return r;
  }
  async function bind(owner, raw, customerId) {
    const r = record(raw, owner);
    if (!r || r.state !== 'claimed') fail('customer_conflict');
    await canonical(customerId);
    const next = { ...r, state: 'bound', customerId };
    const result = await execute(['EVAL', CAS, 2, key(owner), prefix + 'alias:' + customerId,
      raw, JSON.stringify(next), owner]);
    if (result === 1) return next;
    const current = await get(owner);
    if (current?.state === 'bound' && current.customerId === customerId) return current;
    fail('customer_conflict');
  }
  return Object.freeze({
    get,
    // Server-only, single-owner migration entry point. The injected authority
    // must resolve audited UID/customer evidence, never a browser payload/email.
    // Does not create a Stripe customer or overwrite an existing association.
    async bindAuditedExisting(owner) {
      key(owner);
      if (typeof authorizeExisting !== 'function') fail('existing_binding_not_authorized');
      const audit = structuredClone(await authorizeExisting(owner));
      if (!audit || Object.keys(audit).length !== 6 || audit.owner !== owner
        || audit.accountId !== accountId || audit.livemode !== false
        || !id(audit.customerId, 'cus') || !/^[a-f0-9]{64}$/.test(audit.evidenceId)
        || !Number.isSafeInteger(audit.approvedAt) || audit.approvedAt < 0
        || audit.approvedAt > now()) fail('existing_binding_not_authorized');
      await canonical(audit.customerId);
      const next = { version: 1, owner, accountId, livemode: false, state: 'bound',
        operationId: hash(JSON.stringify([owner, accountId, audit.customerId, audit.evidenceId])),
        createdAt: audit.approvedAt, customerId: audit.customerId };
      const journal = JSON.stringify({ ...audit, kind: 'audited_existing_customer' });
      const result = await execute(['EVAL', IMPORT, 4, 'membership:launch-v2:legacy_fence',
        key(owner), prefix + 'alias:' + audit.customerId, key(owner) + ':import',
        JSON.stringify(next), owner, journal]);
      if (![1, 2].includes(result)) fail('customer_conflict');
      return next;
    },
    async ensure(owner) {
      const existing = await get(owner);
      if (existing) return existing;
      if (await allowCreate(owner) !== true) fail('customer_creation_not_authorized');
      const claim = { version: 1, owner, accountId, livemode: false, state: 'claimed',
        operationId: randomBytes(32).toString('hex'), createdAt: now() };
      const raw = JSON.stringify(claim);
      const won = await execute(['SET', key(owner), raw, 'NX']);
      if (won !== 'OK') return get(owner);
      const result = await stripe.createCustomer({ operationId: claim.operationId });
      if (!id(result?.id, 'cus')) fail('customer_pending');
      return bind(owner, raw, result.id);
    },
    // Administrative migration/recovery adapter ONLY: caller must establish
    // ownership from audited server records, never request body/email/metadata.
    async bindTrusted({ owner, customerId, operationId }) {
      if (!id(customerId, 'cus') || !/^[a-f0-9]{64}$/.test(operationId)) fail('invalid_binding');
      const existing = await get(owner);
      if (existing?.state === 'bound') {
        if (existing.customerId !== customerId) fail('customer_conflict');
        return existing;
      }
      if (!existing || existing.operationId !== operationId) fail('customer_conflict');
      return bind(owner, JSON.stringify(existing), customerId);
    },
  });
}
