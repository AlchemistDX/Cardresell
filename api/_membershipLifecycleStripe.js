// Fixed-account TEST transport and durable, one-attempt-per-step mutations.
// A timeout never means Stripe did nothing. Claims have no TTL and are not reset.
import { createHash } from 'node:crypto';
import { MEMBERSHIP_STRIPE_API_VERSION } from './_membershipStripe.js';
import { LAUNCH_PLANS } from './_launchMembershipConfig.js';
const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ref = x => typeof x === 'string' ? x : x?.id;
const insist = (ok, code = 'lifecycle_transport_unavailable') => {
  if (!ok) throw Object.assign(new Error(code), { code });
};
const CAS = `if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
redis.call('SET',KEYS[1],ARGV[2]); return 1`;
export function createMembershipLifecycleStripe({ execute, reader, apiKey, accountId, priceMap,
  fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
  insist(/^sk_test_[A-Za-z0-9]+$/.test(apiKey) && /^acct_[A-Za-z0-9]+$/.test(accountId));
  const prices = structuredClone(priceMap);
  const plans = Object.keys(LAUNCH_PLANS).filter(x => x !== 'free');
  insist(plans.every(p => /^price_[A-Za-z0-9_]+$/.test(prices.plans[p]?.priceId)));
  const planFor = id => {
    const matches = plans.filter(p => prices.plans[p].priceId === id);
    insist(matches.length === 1, 'unknown_price');
    return matches[0];
  };
  async function validatePrice(plan) {
    const price = await reader.retrievePrice(prices.plans[plan].priceId);
    insist(price?.object === 'price' && price.id === prices.plans[plan].priceId && price.livemode === false
      && ref(price.product) === prices.plans[plan].productId && price.currency === 'usd'
      && price.unit_amount === LAUNCH_PLANS[plan].monthlyPriceCents
      && price.recurring?.interval === 'month' && price.recurring.interval_count === 1, 'price_mismatch');
  }
  async function request(path, body, key) {
    insist(/^(account|subscriptions\/sub_[A-Za-z0-9_]+|subscription_schedules(?:\/sub_sched_[A-Za-z0-9_]+)?)$/.test(path));
    if (path !== 'account') await request('account');
    const abort = new AbortController();
    let timer;
    const url = 'https://api.stripe.com/v1/' + path;
    const work = async () => {
      const response = await fetchImpl(url, { method: body ? 'POST' : 'GET', redirect: 'error',
        signal: abort.signal, headers: { Authorization: `Bearer ${apiKey}`,
          'Stripe-Version': MEMBERSHIP_STRIPE_API_VERSION, 'Content-Type': 'application/x-www-form-urlencoded',
          ...(body ? { 'Idempotency-Key': key } : {}) },
        ...(body ? { body: new URLSearchParams(body).toString() } : {}) });
      insist(!abort.signal.aborted && response.status === 200 && !response.redirected
        && (!response.url || response.url === url)
        && /^application\/json\b/.test(response.headers.get('content-type') || ''));
      const chunks = []; let size = 0;
      const stream = response.body.getReader();
      try {
        while (true) {
          const chunk = await stream.read();
          insist(!abort.signal.aborted);
          if (chunk.done) break;
          size += chunk.value.byteLength; insist(size <= 1000000);
          chunks.push(Buffer.from(chunk.value));
        }
      } finally { stream.cancel().catch(() => {}); }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (path === 'account') insist(value?.object === 'account' && value.id === accountId, 'account_mismatch');
      else insist(value && value.livemode === false);
      return value;
    };
    try {
      return await Promise.race([work(), new Promise((_, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(Object.assign(new Error('lifecycle_timeout'),
          { code: 'lifecycle_timeout' })); }, timeoutMs);
      })]);
    } catch (e) { abort.abort(); throw Object.assign(new Error('lifecycle_transport_unavailable'),
      { code: 'lifecycle_transport_unavailable' }); }
    finally { clearTimeout(timer); }
  }
  async function rawSubscription(subscriptionId) {
    insist(/^sub_[A-Za-z0-9_]+$/.test(subscriptionId));
    await request('account');
    const account = await reader.retrieveAccount();
    insist(account?.id === accountId, 'account_mismatch');
    const s = await reader.retrieveSubscription(subscriptionId);
    const item = s?.items?.data?.[0];
    insist(s?.object === 'subscription' && s.id === subscriptionId && s.livemode === false
      && /^cus_[A-Za-z0-9_]+$/.test(ref(s.customer)) && s.items?.has_more === false
      && s.items.data.length === 1 && item.quantity === 1
      && Number.isSafeInteger(item.current_period_start) && Number.isSafeInteger(item.current_period_end)
      && item.current_period_end > item.current_period_start && typeof s.cancel_at_period_end === 'boolean',
    'unsupported_subscription');
    const plan = planFor(ref(item.price));
    await validatePrice(plan);
    return { s, item, plan };
  }
  async function snapshot(subscriptionId) {
    const { s, item, plan } = await rawSubscription(subscriptionId);
    let scheduledChange = null;
    if (s.schedule) {
      const scheduleId = ref(s.schedule);
      insist(/^sub_sched_[A-Za-z0-9_]+$/.test(scheduleId));
      const schedule = await request('subscription_schedules/' + scheduleId);
      insist(schedule.object === 'subscription_schedule' && schedule.id === scheduleId
        && ref(schedule.subscription) === subscriptionId && ref(schedule.customer) === ref(s.customer)
        && schedule.end_behavior === 'release' && Array.isArray(schedule.phases), 'schedule_mismatch');
      insist(schedule.phases.every(p => (!p.discounts || p.discounts.length === 0)
        && (!p.default_tax_rates || p.default_tax_rates.length === 0)
        && p.automatic_tax?.enabled !== true && !p.trial_end && !p.coupon
        && p.items?.every(i => (!i.discounts || i.discounts.length === 0)
          && (!i.tax_rates || i.tax_rates.length === 0))), 'unsupported_schedule');
      const future = schedule.phases.filter(p => p.start_date >= item.current_period_end);
      insist(future.length <= 1, 'unsupported_schedule');
      if (future.length) {
        const phase = future[0];
        insist(phase.start_date === item.current_period_end && phase.items?.length === 1
          && phase.items[0].quantity === 1 && phase.proration_behavior === 'none', 'unsupported_schedule');
        const futurePlan = planFor(ref(phase.items[0].price));
        await validatePrice(futurePlan);
        scheduledChange = { plan: futurePlan, effectiveAt: phase.start_date };
      }
    }
    return { subscriptionId, customerId: ref(s.customer), accountId, livemode: false, status: s.status,
      plan, periodStart: item.current_period_start, periodEnd: item.current_period_end,
      cancelAtPeriodEnd: s.cancel_at_period_end, scheduledChange };
  }
  async function step(command, stage, operation) {
    const key = 'membership:launch-v2:stripe-command:' + digest([accountId, command.owner, command.operationId, stage]);
    const input = digest(command), initial = JSON.stringify({ input, state: 'claimed' });
    const prior = await execute(['GET', key]);
    if (prior !== null) {
      const parsed = JSON.parse(prior);
      insist(parsed.input === input && ['claimed', 'complete'].includes(parsed.state), 'command_conflict');
      return parsed.state === 'complete' ? parsed.result : null;
    }
    if (await execute(['SET', key, initial, 'NX']) !== 'OK') return null;
    const result = await operation();
    const next = JSON.stringify({ input, state: 'complete', result });
    insist(await execute(['EVAL', CAS, 1, key, initial, next]) === 1, 'command_pending');
    return result;
  }
  return Object.freeze({
    retrieveSubscriptionSnapshot: snapshot,
    async executeCommand(command) {
      insist(command && /^[a-f0-9]{64}$/.test(command.operationId)
        && ['plan_change', 'cancel'].includes(command.kind) && command.phase === 'requested'
        && typeof command.idempotencyKey === 'string', 'invalid_command');
      const { s, item } = await rawSubscription(command.subscriptionId);
      insist(item.current_period_end === command.effectiveAt && s.status === 'active'
        && (!s.discounts || s.discounts.length === 0) && !s.trial_end
        && (!s.default_tax_rates || s.default_tax_rates.length === 0)
        && s.automatic_tax?.enabled !== true, 'unsupported_subscription');
      if (command.kind === 'cancel') {
        insist(!s.schedule, 'schedule_requires_reconciliation');
        if (s.cancel_at_period_end) return { status: 'confirmed', snapshot: await snapshot(s.id) };
        const result = await step(command, 'cancel', () => request('subscriptions/' + s.id,
          { cancel_at_period_end: 'true', proration_behavior: 'none' }, command.idempotencyKey + '-cancel'));
        return { status: result ? 'submitted' : 'pending', snapshot: await snapshot(s.id) };
      }
      insist(Object.hasOwn(prices.plans, command.plan) && !s.cancel_at_period_end, 'invalid_plan_change');
      await validatePrice(command.plan);
      const created = await step(command, 'schedule-create', async () => {
        insist(!s.schedule, 'schedule_requires_reconciliation');
        const value = await request('subscription_schedules', { from_subscription: s.id },
          command.idempotencyKey + '-create');
        insist(value.object === 'subscription_schedule' && /^sub_sched_[A-Za-z0-9_]+$/.test(value.id)
          && ref(value.subscription) === s.id && ref(value.customer) === ref(s.customer), 'schedule_mismatch');
        return { id: value.id };
      });
      if (!created) return { status: 'pending' };
      const attached = await rawSubscription(s.id);
      insist(ref(attached.s.schedule) === created.id
        && ref(attached.s.customer) === ref(s.customer), 'schedule_mismatch');
      const desired = {
        end_behavior: 'release', proration_behavior: 'none',
        'phases[0][start_date]': String(item.current_period_start),
        'phases[0][end_date]': String(command.effectiveAt),
        'phases[0][items][0][price]': ref(item.price), 'phases[0][items][0][quantity]': '1',
        'phases[0][proration_behavior]': 'none',
        'phases[1][start_date]': String(command.effectiveAt),
        'phases[1][items][0][price]': prices.plans[command.plan].priceId,
        'phases[1][items][0][quantity]': '1', 'phases[1][duration][interval]': 'month',
        'phases[1][duration][interval_count]': '1', 'phases[1][proration_behavior]': 'none',
      };
      await step(command, 'schedule-update', () => request('subscription_schedules/' + created.id,
        desired, command.idempotencyKey + '-update'));
      const current = await snapshot(s.id);
      return { status: current.scheduledChange?.plan === command.plan
        && current.scheduledChange.effectiveAt === command.effectiveAt ? 'confirmed' : 'pending', snapshot: current };
    },
  });
}
