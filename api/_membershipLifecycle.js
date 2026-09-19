// Dormant, server-only lifecycle coordination. No network/config/route activation.
// customers.get owns normal authenticated UID association; no email/metadata auth.
// Canonical snapshots are a NEW trusted transport projection, not Stripe raw JSON.
// Subscription status NEVER authorizes credits. Paid invoices use the approved
// full payment validator twice: read-only validation, immutable term, real grant.
// Redis/Stripe are not one transaction; schedule commands are durable intents only.
import { createHash, randomBytes } from 'node:crypto';
import { MEMBERSHIP_VERSION, LAUNCH_PLANS } from './_launchMembershipConfig.js';
import { createMembershipPaymentAdapter } from './_membershipPayments.js';
import { membershipGrantHoldKey } from './_membershipLedger.js';

const hash = x => createHash('sha256').update(x).digest('hex');
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const id = (x, prefix) => typeof x === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_]{1,180}$`).test(x);
const uid = x => typeof x === 'string' && x.length > 0 && x.length <= 128 && !/[\u0000-\u0020\u007f]/.test(x);
const operation = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const epoch = x => Number.isSafeInteger(x) && x > 0 && x <= 4102444800;
const plan = x => Object.hasOwn(LAUNCH_PLANS, x) && x !== 'free';
const ref = x => typeof x === 'string' ? x : x?.id;
const stable = value => JSON.stringify(value, (_, x) => object(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
export class MembershipLifecycleError extends Error {
  constructor(code, cause) { super(code, cause === undefined ? undefined : { cause }); this.code = code; }
}
function insist(ok, code = 'lifecycle_invalid') { if (!ok) throw new MembershipLifecycleError(code); }

// Exact byte CAS. Validate EVERY output before the sole mutation. No cjson
// re-encoding of stored records; JS generates deterministic JSON before EVAL.
export const MEMBERSHIP_LIFECYCLE_CAS = `
local p=cjson.decode(ARGV[1])
if type(p)~='table' or #KEYS<1 or #KEYS>8 or #p~=#KEYS then error('invalid lifecycle write') end
local writes={}
for i,key in ipairs(KEYS) do
  local row=p[i]
  if type(row)~='table' then error('invalid lifecycle write') end
  local old=redis.call('GET',key)
  if (row.before==false and old) or (row.before~=false and old~=row.before) then return 0 end
  if row.after~=false then
    if type(row.after)~='string' or string.len(row.after)>200000 then error('invalid lifecycle write') end
    local ok,v=pcall(cjson.decode,row.after)
    if not ok or type(v)~='table' then error('invalid lifecycle write') end
    table.insert(writes,key); table.insert(writes,row.after)
  end
end
if #writes>0 then redis.call('MSET',unpack(writes)) end
return 1`;

export function createMembershipLifecycle({
  execute, accountId, livemode, customers, bindings, stripe, payments, priceMap,
  now = () => Math.floor(Date.now() / 1000), canonicalTimeoutMs = 10000,
  verifyLegacyAuthorization,
}) {
  insist(typeof execute === 'function' && id(accountId, 'acct') && typeof livemode === 'boolean'
    && typeof customers?.get === 'function' && typeof bindings?.inspectIntent === 'function'
    && typeof bindings?.createTerm === 'function' && typeof stripe?.verifyWebhook === 'function'
    && typeof payments?.webhook === 'function' && typeof payments?.invoiceRecovery === 'function' && object(priceMap?.plans)
    && Number.isSafeInteger(canonicalTimeoutMs) && canonicalTimeoutMs >= 100 && canonicalTimeoutMs <= 30000,
  'lifecycle_configuration');
  const prices = structuredClone(priceMap);
  const prefix = `membership:${MEMBERSHIP_VERSION}:lifecycle:${hash(`${accountId}:${livemode}`)}:`;
  const key = (kind, name) => prefix + kind + ':' + hash(name);
  function encode(kind, data) {
    const text = stable({ version: 1, kind, accountId, livemode, data, digest: hash(stable(data)) });
    insist(text.length <= 190000, 'lifecycle_capacity');
    return text;
  }
  async function read(kind, name) {
    return readAt(kind, key(kind, name));
  }
  async function readAt(kind, k) {
    const raw = await execute(['GET', k]);
    if (raw === null) return { key: k, raw, data: null };
    let r; try { r = JSON.parse(raw); } catch (cause) { throw new MembershipLifecycleError('lifecycle_corrupt', cause); }
    insist(object(r) && r.version === 1 && r.kind === kind && r.accountId === accountId
      && r.livemode === livemode && object(r.data) && r.digest === hash(stable(r.data)), 'lifecycle_corrupt');
    return { key: k, raw, data: r.data };
  }
  async function cas(rows) {
    insist(rows.length > 0 && rows.length <= 8 && new Set(rows.map(r => r.record.key)).size === rows.length);
    const args = rows.map(({ record, kind, next }) => ({
      before: record.raw === null ? false : record.raw,
      after: next === undefined ? false : encode(kind, next),
    }));
    return await execute(['EVAL', MEMBERSHIP_LIFECYCLE_CAS, rows.length,
      ...rows.map(r => r.record.key), JSON.stringify(args)]) === 1;
  }
  async function association(owner) {
    insist(uid(owner), 'authentication_required');
    const authoritative = await customers.get(owner);
    insist(authoritative?.state === 'bound' && authoritative.owner === owner
      && id(authoritative.customerId, 'cus')
      && (authoritative.accountId === undefined || authoritative.accountId === accountId)
      && (authoritative.livemode === undefined || authoritative.livemode === livemode), 'customer_unbound');
    const a = await read('owner', owner), reverse = await read('customer', authoritative.customerId);
    if (a.data || reverse.data) {
      insist(a.data?.owner === owner && a.data.customerId === authoritative.customerId
        && reverse.data?.owner === owner && reverse.data.customerId === authoritative.customerId, 'association_corrupt');
    }
    return { a, reverse, customerId: authoritative.customerId };
  }
  async function associate({ owner, customerId } = {}) {
    const { a, reverse, customerId: expected } = await association(owner);
    insist(customerId === expected, 'customer_mismatch');
    if (a.data) return structuredClone(a.data);
    const data = { owner, customerId, subscriptionId: null };
    const ok = await cas([{ record: a, kind: 'owner', next: data },
      { record: reverse, kind: 'customer', next: { owner, customerId } }]);
    if (!ok) {
      const raced = await association(owner);
      insist(raced.a.data, 'lifecycle_conflict');
      return structuredClone(raced.a.data);
    }
    return JSON.parse(stable(data));
  }
  function validateState(s, owner, subscriptionId) {
    insist(s && s.owner === owner && s.subscriptionId === subscriptionId && id(s.customerId, 'cus')
      && operation(s.originIntentId) && plan(s.originPlan) && Number.isSafeInteger(s.revision) && s.revision >= 0
      && Array.isArray(s.transitions) && s.transitions.length > 0 && s.transitions.length <= 120
      && s.transitions.every((r, i) => plan(r.plan) && Number.isSafeInteger(r.effectiveAt)
        && r.effectiveAt >= 0 && (i === 0 ? r.effectiveAt === 0 : r.effectiveAt > s.transitions[i - 1].effectiveAt))
      && (s.claim === null || (object(s.claim) && operation(s.claim.operationId) && operation(s.claim.token))),
    'lifecycle_corrupt');
  }
  async function load(owner, subscriptionId) {
    insist(id(subscriptionId, 'sub'));
    const assoc = await association(owner);
    insist(assoc.a.data?.subscriptionId === subscriptionId, 'subscription_unbound');
    const record = await read('subscription', subscriptionId);
    validateState(record.data, owner, subscriptionId);
    insist(record.data.customerId === assoc.customerId, 'customer_mismatch');
    return { ...assoc, record, s: record.data };
  }
  async function checkout({ order, subscriptionId, sessionId } = {}) {
    insist(object(order) && operation(order.intentId) && id(subscriptionId, 'sub') && id(sessionId, 'cs'));
    const origin = await bindings.inspectIntent(order.intentId);
    insist(origin?.state === 'canonical_bound' && origin.subscriptionId === subscriptionId
      && origin.sessionId === sessionId && origin.paymentId === null
      && stable(origin.order) === stable(order) && order.kind === 'subscription'
      && order.accountId === accountId && order.livemode === livemode && plan(order.plan), 'origin_mismatch');
    await associate({ owner: order.owner, customerId: order.customerId });
    const { a, reverse } = await association(order.owner);
    const record = await read('subscription', subscriptionId);
    if (record.data) {
      validateState(record.data, order.owner, subscriptionId);
      insist(a.data.subscriptionId === subscriptionId && record.data.originIntentId === order.intentId, 'origin_mismatch');
      return recoverCheckout(order, subscriptionId, sessionId);
    }
    insist(a.data.subscriptionId === null, 'subscription_conflict');
    const s = { owner: order.owner, customerId: order.customerId, subscriptionId, originIntentId: order.intentId,
      originPlan: order.plan, revision: 0, snapshot: null, claim: null, command: null,
      transitions: [{ plan: order.plan, effectiveAt: 0 }] };
    const ok = await cas([{ record, kind: 'subscription', next: s },
      { record: a, kind: 'owner', next: { ...a.data, subscriptionId } }, { record: reverse }]);
    insist(ok, 'lifecycle_conflict');
    return recoverCheckout(order, subscriptionId, sessionId);
  }
  async function recoverCheckout(order, subscriptionId, sessionId) {
    // The session is a locator only. Canonical invoice verification below owns
    // actual paid authority; metadata or a paid-looking return URL owns nothing.
    const session = await stripe.retrieveCheckoutSession(sessionId);
    insist(session?.object === 'checkout.session' && session.id === sessionId
      && session.livemode === livemode && session.mode === 'subscription'
      && ref(session.customer) === order.customerId && ref(session.subscription) === subscriptionId
      && session.client_reference_id === order.intentId
      && session.status === 'complete' && session.payment_status === 'paid', 'canonical_checkout_invalid');
    if (session.invoice === null) return { status: 'subscription_bound', subscriptionId, invoiceStatus: 'pending' };
    const invoiceId = ref(session.invoice);
    insist(id(invoiceId, 'in'), 'canonical_invoice_missing');
    const grant = await invoiceRecovery({ owner: order.owner, subscriptionId, invoiceId });
    return { status: 'fulfilled', subscriptionId, invoiceId, grant };
  }
  async function get({ owner, subscriptionId } = {}) {
    const { a } = await association(owner);
    if (!a.data) return { status: 'not_associated' };
    if (!subscriptionId) subscriptionId = a.data.subscriptionId;
    if (!subscriptionId) return structuredClone(a.data);
    return structuredClone((await load(owner, subscriptionId)).s);
  }
  function snapshot(value, s) {
    const fields = ['subscriptionId', 'customerId', 'accountId', 'livemode', 'status', 'plan',
      'periodStart', 'periodEnd', 'cancelAtPeriodEnd', 'scheduledChange'];
    insist(object(value) && Object.keys(value).length === fields.length && fields.every(f => Object.hasOwn(value, f))
      && value.subscriptionId === s.subscriptionId && value.customerId === s.customerId
      && value.accountId === accountId && value.livemode === livemode && plan(value.plan)
      && ['active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'].includes(value.status)
      && epoch(value.periodStart) && epoch(value.periodEnd) && value.periodEnd > value.periodStart
      && typeof value.cancelAtPeriodEnd === 'boolean', 'canonical_snapshot_invalid');
    const c = value.scheduledChange;
    insist(c === null || (object(c) && Object.keys(c).length === 2 && plan(c.plan)
      && epoch(c.effectiveAt) && c.effectiveAt === value.periodEnd), 'canonical_schedule_invalid');
    insist(!s.snapshot || (value.periodStart >= s.snapshot.periodStart
      && !(s.snapshot.status === 'canceled' && value.status !== 'canceled')), 'canonical_regression');
    return structuredClone(value);
  }
  async function refresh({ owner, subscriptionId, operationId }, reconcile = false) {
    insist(operation(operationId));
    insist(typeof stripe.retrieveSubscriptionSnapshot === 'function', 'canonical_projection_unavailable');
    const { record, s, a } = await load(owner, subscriptionId);
    const op = await read('refresh', `${subscriptionId}:${operationId}`);
    if (op.data) {
      insist(op.data.owner === owner && op.data.subscriptionId === subscriptionId
        && op.data.operationId === operationId && ['pending', 'completed'].includes(op.data.state), 'lifecycle_corrupt');
      if (op.data.state === 'completed') return structuredClone(op.data.result);
      if (!reconcile) return { status: 'pending', operationId };
      insist(s.claim?.operationId === operationId, 'lifecycle_conflict');
    } else {
      insist(!reconcile, 'reconciliation_missing');
      if (s.claim) return { status: 'pending', operationId: s.claim.operationId };
    }
    const token = randomBytes(32).toString('hex');
    const next = { ...s, claim: { operationId, token } };
    const pending = { owner, subscriptionId, operationId, state: 'pending' };
    if (!await cas([{ record, kind: 'subscription', next }, { record: op, kind: 'refresh', next: pending }, { record: a }])) {
      return { status: 'pending', operationId };
    }
    // Any throw after claim leaves a durable pending operation. NEVER clear a
    // claim on transport error or infer "no external work" from missing response.
    let observed, timer;
    const abort = new AbortController();
    try {
      observed = await Promise.race([
        stripe.retrieveSubscriptionSnapshot(subscriptionId, { signal: abort.signal }),
        new Promise((_, reject) => { timer = setTimeout(() => {
          abort.abort(); reject(new Error('canonical read deadline'));
        }, canonicalTimeoutMs); }),
      ]);
    }
    catch (cause) { throw new MembershipLifecycleError('canonical_outcome_unknown', cause); }
    finally { clearTimeout(timer); }
    const value = snapshot(observed, s), current = await read('subscription', subscriptionId);
    const currentOp = await read('refresh', `${subscriptionId}:${operationId}`);
    validateState(current.data, owner, subscriptionId);
    if (current.data.claim?.token !== token) return { status: 'superseded', operationId };
    const after = structuredClone(current.data);
    const command = after.command;
    if (command?.phase === 'requested') {
      const confirmed = command.kind === 'cancel'
        ? value.cancelAtPeriodEnd && value.periodEnd === command.effectiveAt
        : (value.scheduledChange?.plan === command.plan && value.scheduledChange.effectiveAt === command.effectiveAt)
          || (value.plan === command.plan && value.periodStart === command.effectiveAt);
      if (confirmed) {
        after.command.phase = 'confirmed';
        if (command.kind === 'plan_change') {
          insist(after.transitions.length < 120
            && command.effectiveAt > after.transitions.at(-1).effectiveAt, 'transition_conflict');
          after.transitions.push({ plan: command.plan, effectiveAt: command.effectiveAt });
        }
      }
    }
    const expected = after.transitions.filter(r => r.effectiveAt <= value.periodStart).at(-1);
    insist(expected?.plan === value.plan, 'unrecognized_plan_transition');
    after.snapshot = value; after.claim = null; after.revision++;
    const result = { status: 'refreshed', operationId, revision: after.revision, snapshot: value };
    const ok = await cas([{ record: current, kind: 'subscription', next: after },
      { record: currentOp, kind: 'refresh', next: { ...pending, state: 'completed', result } }]);
    return ok ? JSON.parse(stable(result)) : { status: 'superseded', operationId };
  }
  async function request({ owner, subscriptionId, operationId, plan: requestedPlan }, kind) {
    insist(operation(operationId) && (kind === 'cancel' || plan(requestedPlan)));
    const { record, s, a } = await load(owner, subscriptionId);
    const op = await read('command', `${subscriptionId}:${operationId}`);
    if (op.data) {
      insist(op.data.owner === owner && op.data.subscriptionId === subscriptionId && op.data.kind === kind
        && op.data.plan === (kind === 'cancel' ? null : requestedPlan), 'operation_conflict');
      return structuredClone(op.data);
    }
    insist(!s.claim, 'refresh_pending');
    insist(s.snapshot?.status === 'active' && s.snapshot.periodEnd > now(), 'active_period_required');
    // A confirmed command stays immutable. New changes can be requested only
    // after its boundary passed and a fresh canonical period was observed.
    insist(!s.command || (s.command.phase === 'confirmed'
      && s.snapshot.periodStart >= s.command.effectiveAt), 'change_pending');
    insist(kind === 'cancel' || requestedPlan !== s.snapshot.plan, 'unchanged_plan');
    const command = { owner, subscriptionId, operationId, kind, plan: kind === 'cancel' ? null : requestedPlan,
      effectiveAt: s.snapshot.periodEnd, phase: 'requested',
      idempotencyKey: `membership-lifecycle-${hash(`${accountId}:${livemode}:${subscriptionId}:${operationId}`)}` };
    const ok = await cas([{ record, kind: 'subscription', next: { ...s, command } },
      { record: op, kind: 'command', next: command }, { record: a }]);
    insist(ok, 'lifecycle_conflict');
    return JSON.parse(stable(command));
  }
  async function verify({ rawBody, signature } = {}) {
    insist((Buffer.isBuffer(rawBody) || rawBody instanceof Uint8Array) && rawBody.length > 0
      && rawBody.length <= 1000000 && typeof signature === 'string' && signature.length <= 4096, 'invalid_signature');
    let e; try { e = await stripe.verifyWebhook(rawBody, signature); }
    catch (cause) { throw new MembershipLifecycleError('invalid_signature', cause); }
    insist(object(e) && e.object === 'event' && id(e.id, 'evt') && typeof e.type === 'string'
      && e.livemode === livemode && (e.account == null || e.account === accountId) && object(e.data?.object), 'invalid_event');
    return e;
  }
  async function invoice(input, recovery = null) {
    // The existing payment validator checks all canonical settlement fields.
    // Its virtual term is derived ONLY from immutable origin + readback-confirmed
    // transitions. The first pass cannot mutate any term, marker or credit.
    let candidate = null;
    const dry = createMembershipPaymentAdapter({ stripe, accountId, livemode, priceMap: prices,
      bindings: { getCheckoutOrder: (...args) => bindings.getCheckoutOrder(...args),
        async getSubscriptionTerm(subscriptionId, start) {
          insist(recovery === null || subscriptionId === recovery.subscriptionId, 'subscription_mismatch');
          const record = await read('subscription', subscriptionId);
          insist(record.data, 'subscription_unbound');
          const { s } = await load(record.data.owner, subscriptionId);
          const old = await bindings.getSubscriptionTerm(subscriptionId, start);
          if (old) return old;
          const transition = s.transitions.filter(r => r.effectiveAt <= start).at(-1);
          insist(transition, 'term_authorization_missing');
          const next = s.transitions.find(r => r.effectiveAt > start);
          candidate = { originIntentId: s.originIntentId, subscriptionId, plan: transition.plan,
            effectiveFrom: start, effectiveUntil: next?.effectiveAt ?? 4102444800,
            authorizationId: hash(`${subscriptionId}:${start}:${transition.plan}`) };
          return { ...candidate, version: MEMBERSHIP_VERSION, kind: 'subscription', owner: s.owner,
            customerId: s.customerId, accountId, livemode, currency: 'usd',
            amountCents: LAUNCH_PLANS[transition.plan].monthlyPriceCents, ...prices.plans[transition.plan] };
        } },
      fulfill: async (kind, envelope) => ({ kind, envelope }),
    });
    const validated = recovery === null ? await dry.webhook(input) : await dry.invoiceRecovery({
      invoiceId: recovery.invoiceId, authenticatedOwner: recovery.owner,
    });
    insist(validated?.kind === 'period', 'invoice_validation_required');
    if (candidate) {
      // Finite canonical invoice interval, NOT an open-ended future term.
      candidate.effectiveUntil = validated.envelope.periodEnd;
      await bindings.createTerm(candidate);
    }
    // Re-fetch, re-verify and real grant. Response loss safely replays business ID.
    return recovery === null ? payments.webhook(input) : payments.invoiceRecovery({
      invoiceId: recovery.invoiceId, authenticatedOwner: recovery.owner,
    });
  }
  async function invoiceRecovery({ owner, subscriptionId, invoiceId } = {}) {
    insist(uid(owner), 'authentication_required');
    insist(id(subscriptionId, 'sub') && id(invoiceId, 'in'), 'invalid_reference');
    await load(owner, subscriptionId);
    return invoice(null, { owner, subscriptionId, invoiceId });
  }
  // Explicitly isolated Preview staging, NOT an import into checkout bindings.
  // A real legacy origin cannot be represented by a fabricated cs_* session.
  // No schedule/term/enrollment/financial mutation or live-mode staging here.
  async function stageLegacyMigration(envelope) {
    insist(livemode === false && typeof verifyLegacyAuthorization === 'function'
      && typeof stripe.retrieveLegacySubscriptionSnapshot === 'function', 'legacy_preview_only');
    const fields = ['authorizationId', 'owner', 'customerId', 'subscriptionId', 'accountId', 'livemode',
      'legacyPriceId', 'targetPlan', 'effectiveAt', 'approvedAt', 'noImmediateCharge', 'noMidperiodGrant'];
    insist(object(envelope) && Object.keys(envelope).length === fields.length
      && fields.every(k => Object.hasOwn(envelope, k)) && operation(envelope.authorizationId)
      && uid(envelope.owner) && id(envelope.customerId, 'cus') && id(envelope.subscriptionId, 'sub')
      && envelope.accountId === accountId && envelope.livemode === false
      && id(envelope.legacyPriceId, 'price') && plan(envelope.targetPlan)
      && epoch(envelope.effectiveAt) && epoch(envelope.approvedAt) && envelope.approvedAt <= now()
      && envelope.noImmediateCharge === true && envelope.noMidperiodGrant === true, 'legacy_authorization_invalid');
    const authorized = structuredClone(envelope);
    insist(await verifyLegacyAuthorization(structuredClone(authorized)) === true, 'legacy_authorization_denied');
    const assoc = await association(authorized.owner);
    insist(assoc.customerId === authorized.customerId, 'customer_mismatch');
    const record = await read('legacy_preview', authorized.subscriptionId);
    const authority = await read('legacy_authority', authorized.authorizationId);
    const data = { authorization: authorized, disposition: 'preview_only_not_scheduled',
      financialMutation: false, bindingImport: false };
    if (record.data || authority.data) {
      insist(stable(record.data) === stable(data) && stable(authority.data) === stable(data), 'legacy_migration_conflict');
      return JSON.parse(stable(data));
    }
    insist(authorized.effectiveAt > now(), 'legacy_boundary_passed');
    const normal = await read('subscription', authorized.subscriptionId);
    insist(!normal.data && (!assoc.a.data || assoc.a.data.subscriptionId === null), 'legacy_origin_conflict');
    const canonical = await stripe.retrieveLegacySubscriptionSnapshot(authorized.subscriptionId);
    insist(object(canonical) && canonical.accountId === accountId && canonical.livemode === false
      && canonical.subscriptionId === authorized.subscriptionId && canonical.customerId === authorized.customerId
      && canonical.priceId === authorized.legacyPriceId && canonical.periodEnd === authorized.effectiveAt
      && canonical.status === 'active', 'legacy_canonical_mismatch');
    const ok = await cas([{ record, kind: 'legacy_preview', next: data },
      { record: authority, kind: 'legacy_authority', next: data }, { record: normal }, { record: assoc.a }]);
    insist(ok, 'lifecycle_conflict');
    return JSON.parse(stable(data));
  }
  async function fenceReversal(event, expected) {
    // Transport MUST refetch canonical refund/dispute/charge AND original
    // payment/invoice linkage, in the configured account/mode. Event payload
    // references, email, metadata and amounts are never provenance authority.
    let p;
    try { p = await stripe.resolveReversalProvenance({ eventType: event.type, objectId: event.data.object.id }); }
    catch (cause) { throw new MembershipLifecycleError('reversal_provenance_unavailable', cause); }
    const fields = ['accountId', 'livemode', 'objectType', 'objectId', 'customerId',
      'paymentId', 'invoiceId', 'invoiceLookupComplete', 'reason'];
    const reasons = { refund: ['refund_pending', 'refund_succeeded', 'refund_failed', 'refund_canceled'],
      dispute: ['dispute_open', 'dispute_closed'], charge: ['charge_refunded'] };
    insist(object(p) && Object.keys(p).length === fields.length && fields.every(f => Object.hasOwn(p, f))
      && p.accountId === accountId && p.livemode === livemode && p.objectType === expected[0]
      && p.objectId === event.data.object.id && id(p.customerId, 'cus')
      && id(p.paymentId, 'pi') && (p.invoiceId === null || id(p.invoiceId, 'in'))
      && p.invoiceLookupComplete === true && reasons[expected[0]].includes(p.reason), 'reversal_provenance_incomplete');
    const targets = [{ kind: 'pack', id: p.paymentId }];
    if (p.invoiceId !== null) targets.push({ kind: 'period', id: p.invoiceId });
    const review = await read('fenced_review', event.id);
    const data = { eventId: event.id, eventType: event.type, objectId: p.objectId,
      disposition: 'review_required', financialMutation: false, lateGrantExclusion: 'installed',
      customerId: p.customerId, paymentId: p.paymentId, invoiceId: p.invoiceId,
      reason: 'new_grants_held_existing_credits_unchanged' };
    if (review.data) {
      insist(stable(review.data) === stable(data), 'event_conflict');
      // Never silently recreate lost hold authority from a retained receipt.
      for (const target of targets) {
        const record = await readAt('hold', membershipGrantHoldKey(target.kind, target.id));
        insist(record.data?.businessKind === target.kind && record.data.businessId === target.id
          && record.data.customerId === p.customerId && record.data.disposition === 'review_required', 'hold_corrupt');
      }
      return review.data;
    }
    const rows = [{ record: review, kind: 'fenced_review', next: data }];
    for (const target of targets) {
      const record = await readAt('hold', membershipGrantHoldKey(target.kind, target.id));
      const hold = { businessKind: target.kind, businessId: target.id,
        customerId: p.customerId, disposition: 'review_required' };
      insist(!record.data || stable(record.data) === stable(hold), 'hold_conflict');
      rows.push({ record, kind: 'hold', ...(record.data ? {} : { next: hold }) });
    }
    // One EVAL installs all exact business holds and evidence together. The
    // financial EVAL either ran earlier (credits preserved) or sees the hold.
    const installed = await cas(rows);
    insist(installed, 'lifecycle_conflict'); // retry same verified event on CAS race
    return JSON.parse(stable(data));
  }
  async function processWebhook(input) {
    const event = await verify(input);
    if (['invoice.paid', 'invoice.payment_succeeded'].includes(event.type)) return invoice(input);
    if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
      'invoice.payment_failed', 'invoice.payment_action_required'].includes(event.type)) {
      let subscriptionId;
      if (event.type.startsWith('invoice.')) {
        insist(event.data.object.object === 'invoice' && id(event.data.object.id, 'in'), 'invalid_event');
        const bill = await stripe.retrieveInvoice(event.data.object.id);
        insist(bill?.object === 'invoice' && bill.id === event.data.object.id && bill.livemode === livemode
          && bill.parent?.type === 'subscription_details', 'canonical_invoice_invalid');
        subscriptionId = ref(bill.parent.subscription_details?.subscription);
      } else {
        insist(event.data.object.object === 'subscription', 'invalid_event');
        subscriptionId = event.data.object.id;
      }
      insist(id(subscriptionId, 'sub'), 'invalid_event');
      const record = await read('subscription', subscriptionId);
      insist(record.data, 'subscription_unbound');
      const input = { owner: record.data.owner, subscriptionId, operationId: hash(event.id) };
      const result = await refresh(input);
      if (result.status !== 'pending') return result;
      // A verified retry may recover a read-only canonical fetch. Rotate the
      // persisted claim token so a still-running prior reader cannot commit.
      // This never retries an external financial command or invoice grant.
      const recovered = await refresh({ ...input, operationId: result.operationId }, true);
      if (result.operationId === input.operationId || recovered.status !== 'refreshed') return recovered;
      // Another event owned the pending claim. Do not acknowledge this event
      // from that earlier observation: perform its own fresh canonical read.
      // Bounded to one reconciliation; any new contention stays pending/503.
      return refresh(input);
    }
    if (['charge.refunded', 'refund.created', 'refund.updated', 'refund.failed',
      'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed'].includes(event.type)) {
      const expected = event.type.startsWith('charge.dispute.') ? ['dispute', 'dp']
        : event.type.startsWith('refund.') ? ['refund', 're'] : ['charge', 'ch'];
      insist(event.data.object.object === expected[0] && id(event.data.object.id, expected[1]), 'invalid_event');
      if (typeof stripe.resolveReversalProvenance === 'function') return fenceReversal(event, expected);
      const r = await read('review', event.id);
      const data = { eventId: event.id, eventType: event.type, objectId: event.data.object.id,
        disposition: 'review_required', financialMutation: false,
        lateGrantExclusion: 'unavailable',
        reason: 'canonical_reversal_and_atomic_provenance_protocol_not_integrated' };
      if (r.data) { insist(stable(r.data) === stable(data), 'event_conflict'); return r.data; }
      if (!await cas([{ record: r, kind: 'review', next: data }])) {
        const existing = await read('review', event.id);
        insist(stable(existing.data) === stable(data), 'event_conflict');
      }
      return JSON.parse(stable(data));
    }
    return { ignored: true };
  }
  return Object.freeze({ associate, checkout, get, refresh, invoiceRecovery, stageLegacyMigration,
    reconcile: input => refresh(input, true),
    requestChange: input => request(input, 'plan_change'),
    requestCancel: input => request(input, 'cancel'),
    processWebhook, webhook: processWebhook });
}
