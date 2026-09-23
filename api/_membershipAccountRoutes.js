import { randomBytes } from 'node:crypto';
import { readMembershipWebhookBody } from './_membershipStripe.js';
const fresh = () => randomBytes(32).toString('hex');
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const fail = code => { throw Object.assign(new Error(code), { code }); };
export function createMembershipAccountRoutes({ authenticate, customers, lifecycle, fulfillment,
  commands, balances, portal, bootstrap, scheduleChanges = true }) {
  async function owner(req) {
    const token = req.headers?.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) fail('authentication_required');
    const user = await authenticate(token);
    if (!user?.uid || user.verified !== true) fail('authentication_required');
    return user;
  }
  const error = (res, e) => res.status(e.code === 'authentication_required' ? 401 : 503).json({
    error: e.code === 'authentication_required' ? e.code : 'membership_pending',
    message: 'Unable to confirm the operation yet. Existing credits are preserved. Retry the same operation.',
  });
  const publicState = state => ({
    status: state.status || state.snapshot?.status || 'not_associated',
    subscriptionId: state.subscriptionId || null,
    snapshot: state.snapshot || null,
    command: state.command ? { operationId: state.command.operationId, kind: state.command.kind, plan: state.command.plan,
      effectiveAt: state.command.effectiveAt, phase: state.command.phase } : null,
    recoveryPending: !!state.claim,
  });
  async function refresh(uid, state, operationId) {
    const input = { owner: uid, subscriptionId: state.subscriptionId,
      operationId: state.claim?.operationId || operationId };
    return state.claim ? lifecycle.reconcile(input) : lifecycle.refresh(input);
  }
  return {
    async account(req, res) {
      res.setHeader('Cache-Control', 'private, no-store');
      if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
      try {
        const identity = await owner(req);
        const uid = identity.uid;
        if (req.method === 'GET') {
          const customer = await customers.get(uid);
          const state = customer?.state === 'bound' ? await lifecycle.get({ owner: uid })
            : { status: customer ? 'customer_pending' : 'not_associated' };
          let credits = null;
          try { credits = await balances(uid); } catch {}
          return res.status(200).json({ state: publicState(state), credits, creditsAvailable: credits !== null, creditsExpire: false,
            management: { portal: typeof portal === 'function' && customer?.state === 'bound', scheduleChanges } });
        }
        const body = req.body;
        if (exact(body, ['action', 'operationId']) && body.action === 'portal'
          && /^[a-f0-9]{64}$/.test(body.operationId) && typeof portal === 'function') {
          const customer = await customers.get(uid);
          if (customer?.state !== 'bound') fail('customer_association_required');
          const session = await portal({ customerId: customer.customerId, operationId: body.operationId });
          const current = await customers.get(uid);
          if (current?.state !== 'bound' || current.customerId !== customer.customerId) fail('customer_conflict');
          return res.status(200).json({ url: session.url });
        }
        if (exact(body, ['action']) && body.action === 'associate') {
          // Complete audited enrollment before claiming any external customer
          // creation. A missing audit must not leave a new Stripe customer.
          if (typeof bootstrap === 'function') await bootstrap(uid, identity);
          const customer = await customers.ensure(uid);
          if (customer?.state !== 'bound') return res.status(202).json({ status: 'customer_pending' });
          await lifecycle.associate({ owner: uid, customerId: customer.customerId });
          return res.status(200).json({ status: 'associated' });
        }
        if (!exact(body, body?.action === 'change' ? ['action', 'operationId', 'plan'] : ['action', 'operationId'])
          || !['change', 'cancel', 'refresh'].includes(body.action) || !/^[a-f0-9]{64}$/.test(body.operationId)) {
          return res.status(400).json({ error: 'invalid_request' });
        }
        if (!scheduleChanges && ['change', 'cancel'].includes(body.action)) {
          return res.status(409).json({ error: 'use_customer_portal' });
        }
        const state = await lifecycle.get({ owner: uid });
        if (!state.subscriptionId) fail('subscription_missing');
        if (body.action === 'refresh') {
          const result = await refresh(uid, state, body.operationId);
          return res.status(200).json({ ...result, state: publicState(await lifecycle.get({ owner: uid })) });
        }
        const command = body.action === 'change'
          ? await lifecycle.requestChange({ owner: uid, subscriptionId: state.subscriptionId,
            operationId: body.operationId, plan: body.plan })
          : await lifecycle.requestCancel({ owner: uid, subscriptionId: state.subscriptionId,
            operationId: body.operationId });
        const current = await lifecycle.get({ owner: uid });
        if (current.command?.phase !== 'confirmed') await commands.executeCommand(command.command || command);
        await refresh(uid, await lifecycle.get({ owner: uid }), fresh());
        const final = await lifecycle.get({ owner: uid });
        const confirmed = final.command?.operationId === body.operationId && final.command.phase === 'confirmed';
        return res.status(confirmed ? 200 : 202).json({ status: confirmed ? 'confirmed' : 'pending',
          state: publicState(final) });
      } catch (e) { return error(res, e); }
    },
    async checkoutReturn(req, res) {
      res.setHeader('Cache-Control', 'private, no-store');
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
      try {
        const { uid } = await owner(req);
        if (!exact(req.body, ['sessionId']) || !/^cs_[A-Za-z0-9_]+$/.test(req.body.sessionId)) {
          return res.status(400).json({ error: 'invalid_request' });
        }
        const result = await fulfillment.checkoutReturn({ sessionId: req.body.sessionId, owner: uid });
        return res.status(result.status === 'pending' ? 202 : 200).json(result);
      } catch (e) { return error(res, e); }
    },
    async webhook(req, res) {
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
      try {
        const rawBody = await readMembershipWebhookBody(req);
        const result = await fulfillment.webhook({ rawBody, signature: req.headers?.['stripe-signature'] });
        if (['pending', 'superseded', 'subscription_bound'].includes(result.status)) {
          return res.status(503).json({ error: 'webhook_recovery_pending' });
        }
        return res.status(200).json({ received: true, status: result.status || 'processed' });
      } catch (e) {
        // No early processed marker. Stripe retries transient/corrupt/missing
        // binding failures; financial idempotence belongs to the ledger.
        return res.status(['invalid_signature', 'invalid_event'].includes(e.code) ? 400 : 503)
          .json({ error: 'webhook_not_processed' });
      }
    },
  };
}
