// Actual storefront JS in an isolated minimal DOM. Synthetic auth/fetch only;
// this is not a browser, Firebase acceptance, Stripe, or managed-service test.
import vm from 'node:vm';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { harness } from './_assert.mjs';
const t = harness('membership-shop-identity');
const source = fs.readFileSync(new URL('../js/membership-shop.js', import.meta.url), 'utf8');
const later = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const flush = () => new Promise(r => setImmediate(r));
const walk = e => [e, ...e.children.flatMap(walk)];
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.disabled = false; this.listeners = {}; }
  append(x) { this.children.push(x); }
  setAttribute() {}
  addEventListener(name, fn) { this.listeners[name] = fn; }
  replaceChildren() { this.children = []; }
  querySelectorAll(selector) { return walk(this).filter(x => x !== this && x.tag === selector); }
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.close?.(); }
  focus() {}
}
const user = owner => ({ uid: owner, getIdToken: async () => 'synthetic_token_' + owner });
function setup({ initial = user('A'), state = {}, onCheckout, onCatalogue, onAccount } = {}) {
  const body = new Element('body'), requests = [], navigations = [];
  const window = { googleUser: initial, _waitForAuth: async () => {} };
  const history = { state, replaceState(value) { this.state = value; } };
  const catalogue = { plans: [], purchaseEnabled: true, packs: [
    { packId: 'id_25', kind: 'id', credits: 25, amountCents: 299 },
    { packId: 'id_100', kind: 'id', credits: 100, amountCents: 999 },
  ] };
  const response = () => ({ ok: true, status: 200,
    json: async () => ({ status: 'checkout_ready', url: 'https://checkout.stripe.com/c/pay/cs_synthetic' }) });
  const sandbox = { window, history, document: { body, activeElement: new Element('button'), createElement: tag => new Element(tag) },
    Intl, crypto: webcrypto, Uint8Array, URL,
    location: { href: 'https://synthetic.invalid/', assign: url => navigations.push(url) },
    fetch: async (url, options = {}) => {
      if (url === '/api/membership-account') return onAccount ? onAccount(options)
        : { ok: false, status: 503, json: async () => ({ error: 'not_enabled' }) };
      if (url.includes('catalogue')) {
        if (onCatalogue) await onCatalogue(options);
        return { ok: true, status: 200, json: async () => catalogue };
      }
      requests.push({ auth: options.headers.Authorization, request: JSON.parse(options.body) });
      return onCheckout ? await onCheckout(options, response) : response();
    } };
  vm.runInNewContext(source, sandbox);
  return { window, history, requests, navigations,
    open: () => window.openMembershipShop(),
    buttons: () => walk(body).filter(e => e.tag === 'button' && /ID credits/.test(e.textContent || '')),
    controls: () => walk(body).filter(e => e.tag === 'button'),
    message: () => walk(body).filter(e => e.tag === 'p').map(e => e.textContent).join(' '),
  };
}
await t.section('original account-switch counterexamples', async () => {
  const held = later(); let calls = 0;
  const a = user('A'); a.getIdToken = () => ++calls === 2 ? held.promise : Promise.resolve('synthetic_token_A');
  const h = setup({ initial: a }); await h.open(); const old = h.buttons()[0];
  const pending = old.onclick(); await flush(); h.window.googleUser = user('B'); held.resolve('synthetic_token_A'); await pending;
  t.check('token-inflight account switch sends no checkout', h.requests.length === 0);
  t.check('token-inflight switch cannot redirect', h.navigations.length === 0);
  t.check('token-inflight switch does not mislabel recovery owner', !h.history.state.membershipPurchases);
  t.check('stale controls disabled', old.disabled && /account changed/.test(h.message()));
  const committed = later(); const j = setup({ onCheckout: async (_, done) => { await committed.promise; return done(); } });
  await j.open(); const request = j.buttons()[0].onclick(); await flush();
  j.window.googleUser = user('B'); committed.resolve(); await request;
  t.check('post-inflight account switch cannot redirect A checkout into B session', j.navigations.length === 0);
  t.check('A operation retained under A only', j.history.state.membershipPurchases.A.owner === 'A' && !j.history.state.membershipPurchases.B);
});
await t.section('double tap shares one outstanding request', async () => {
  const held = later(); let calls = 0; const a = user('A');
  a.getIdToken = () => ++calls === 2 ? held.promise : Promise.resolve('synthetic_token_A');
  const h = setup({ initial: a }); await h.open(); const buttons = h.buttons();
  const first = buttons[0].onclick(); const second = buttons[0].onclick(); const other = buttons[1].onclick();
  await flush(); held.resolve('synthetic_token_A'); await Promise.all([first, second, other]);
  t.check('only one checkout POST across same/different selection double tap', h.requests.length === 1);
  t.check('single intended selection and redirect', h.requests[0].request.selection === 'id_25' && h.navigations.length === 1);
});
await t.section('per-owner and legacy recovery preserve operation identity', async () => {
  const legacy = { owner: 'A', request: { requestId: 'a'.repeat(64), kind: 'pack', selection: 'id_25' } };
  const h = setup({ initial: user('B'), state: { unrelated: 'retained', membershipPurchase: legacy } });
  await h.open(); await h.buttons()[0].onclick(); const b = h.requests[0].request.requestId;
  t.check('new B request does not overwrite legacy A operation', h.history.state.membershipPurchases.A.request.requestId === legacy.request.requestId);
  t.check('B request has separate identity and preserves unrelated history', b !== legacy.request.requestId && h.history.state.unrelated === 'retained');
  h.window.googleUser = user('A'); await h.open(); await h.buttons()[0].onclick();
  t.check('A recovery uses identical saved request', JSON.stringify(h.requests[1].request) === JSON.stringify(legacy.request));
  h.window.googleUser = user('B'); await h.open(); await h.buttons()[0].onclick();
  t.check('B recovery keeps original request ID', h.requests[2].request.requestId === b);
  await h.buttons()[1].onclick();
  t.check('unresolved B operation blocks new selection', h.requests.length === 3 && /awaiting confirmation/.test(h.message()));
});
await t.section('catalogue account changes invalidate displayed quote', async () => {
  const held = later(); const h = setup({ onCatalogue: async () => held.promise });
  const pending = h.open(); await flush(); h.window.googleUser = user('B'); held.resolve(); await pending;
  t.check('late A catalogue cannot enable buttons for B', h.buttons().length === 0 && /account changed/.test(h.message()));
});
await t.section('normal auth object cannot use another account global token', async () => {
  // auth.5cf1cd22.js:216-229 creates a plain googleUser; :316-321 assigns
  // _googleIdToken asynchronously. Use that normal object shape, not only SDK mocks.
  const h = setup({ initial: { uid: 'B', sub: 'B' } });
  h.window._googleIdToken = 'synthetic_token_A';
  h.window._fbCurrentUser = user('B');
  await h.open(); const button = h.buttons()[0];
  if (button && !button.disabled) await button.onclick();
  t.check('plain B identity must never POST cached A token', h.requests.every(r => r.auth !== 'Bearer synthetic_token_A'));
  t.check('plain B identity must not redirect a checkout authorized by cached A', !h.requests.some(r => r.auth === 'Bearer synthetic_token_A') || h.navigations.length === 0);
});
await t.section('SDK authority must be present and remain bound', async () => {
  for (const provider of [null, user('A')]) {
    const h = setup({ initial: { uid: 'B', sub: 'B' } });
    h.window._googleIdToken = 'synthetic_token_B';
    h.window._fbCurrentUser = provider;
    await h.open();
    t.check('missing/mismatched SDK cannot enable cached-token checkout', h.buttons().length === 0 && h.requests.length === 0 && h.navigations.length === 0);
  }
  const held = later(); let calls = 0;
  const sdk = user('B'); sdk.getIdToken = () => ++calls === 2 ? held.promise : Promise.resolve('synthetic_token_B');
  const h = setup({ initial: { uid: 'B', sub: 'B' } }); h.window._fbCurrentUser = sdk;
  await h.open(); const pending = h.buttons()[0].onclick(); await flush();
  h.window._fbCurrentUser = user('A'); held.resolve('synthetic_token_B'); await pending;
  t.check('SDK-only replacement during token await blocks checkout and redirect', h.requests.length === 0 && h.navigations.length === 0 && /account changed/.test(h.message()));
});
await t.section('account controls preserve identity and durable command', async () => {
  const calls = [];
  const onAccount = async options => {
    if (options.method === 'POST') {
      calls.push(JSON.parse(options.body));
      return { ok: true, status: 202, json: async () => ({ status: 'pending' }) };
    }
    return { ok: true, status: 200, json: async () => ({ creditsAvailable: true,
      credits: { included: { id: 50, grade: 15 }, welcome: { id: 10, grade: 1 },
        purchased: { id: 100, grade: 25 } },
      state: { subscriptionId: 'sub_fixture', snapshot: { status: 'active', periodEnd: 2000000000 } } }) };
  };
  const h = setup({ onAccount }); await h.open();
  t.check('source balances displayed without expiry', /Included: 50 ID/.test(h.message())
    && /Verification bonus: 10 ID/.test(h.message()) && /Purchased: 100 ID/.test(h.message()));
  const cancel = h.controls().find(b => /Cancel at renewal/.test(b.textContent));
  await cancel.onclick(); await cancel.onclick();
  t.check('uncertain cancellation retry keeps same operation', calls.length === 2
    && calls[0].operationId === calls[1].operationId && calls[0].action === 'cancel');
  const refresh = h.controls().find(b => /Refresh subscription/.test(b.textContent));
  await refresh.onclick();
  t.check('pending change does not block canonical refresh', calls.length === 3 && calls[2].action === 'refresh');
  h.window.googleUser = user('B'); await cancel.onclick();
  t.check('stale account control cannot post for a different owner', calls.length === 3 && cancel.disabled);
});
await t.section('confirmed command from a lost response must not permanently lock later actions', async () => {
  const calls = [];
  const h = setup({ state: { membershipCommands: { A: {
    action: 'change', operationId: 'f'.repeat(64), plan: 'pro',
  } } }, onAccount: async options => {
    if (options.method === 'POST') {
      calls.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ status: 'confirmed' }) };
    }
    // Current publicState carries only the safe operation ID, never private claim authority.
    return { ok: true, status: 200, json: async () => ({ creditsAvailable: false,
      state: { subscriptionId: 'sub_fixture', snapshot: { status: 'active', plan: 'pro',
        periodStart: 2000000000, periodEnd: 2002592000 },
        command: { operationId: 'f'.repeat(64), kind: 'plan_change', plan: 'pro', phase: 'confirmed', effectiveAt: 2000000000 } } }) };
  } });
  await h.open();
  const cancel = h.controls().find(b => /Cancel at renewal/.test(b.textContent));
  t.check('server-confirmed past-boundary plan change exposes next cancellation action', !!cancel);
  await cancel.onclick();
  t.check('retained confirmed change does not permanently block next cancellation',
    calls.some(x => x.action === 'cancel'));
});
t.done();
