// Actual storefront JS in an isolated minimal DOM. Synthetic auth/fetch only;
// this is not a browser, Firebase acceptance, Stripe, or managed-service test.
import vm from 'node:vm';
import { parse } from 'acorn';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { harness } from './_assert.mjs';
import { publicMembershipCatalogue } from '../api/_membershipPurchaseRoutes.js';
const t = harness('membership-shop-identity');
const source = fs.readFileSync(new URL('../js/membership-shop.js', import.meta.url), 'utf8');
const later = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const flush = () => new Promise(r => setImmediate(r));
const walk = e => [e, ...e.children.flatMap(walk)];
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.disabled = false; this.listeners = {}; }
  get textContent() { return (this.text || '') + this.children.map(x => x.textContent || '').join(''); }
  set textContent(value) { this.text = value; this.children = []; }
  append(x) { this.children.push(x); }
  prepend(x) { this.children.unshift(x); }
  setAttribute() {}
  addEventListener(name, fn) { this.listeners[name] = fn; }
  replaceChildren() { this.children = []; }
  querySelectorAll(selector) { return walk(this).filter(x => x !== this && x.tag === selector); }
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.close?.(); }
  focus() {}
}
const user = owner => ({ uid: owner, getIdToken: async () => 'synthetic_token_' + owner });
function setup({ initial = user('A'), state = {}, onCheckout, onCatalogue, onAccount, suppliedCatalogue, loadCredits, creditElements = {}, rejectAuth = false, href = 'https://synthetic.invalid/' } = {}) {
  const body = new Element('body'), banner = new Element('div'), requests = [], navigations = [], events = [];
  body.append(banner);
  const window = { loadSettingsScanCredits: loadCredits, googleUser: initial, _waitForAuth: async () => {}, trackEvent: (name, props) => events.push({ name, props }) };
  const location = { href, assign: url => navigations.push(url) };
  const history = { state, replaceState(value, unused, url) { this.state = value; if (url) location.href = new URL(url, location.href).href; } };
  const catalogue = suppliedCatalogue || { plans: [], purchaseEnabled: true, packs: [
    { packId: 'id_25', kind: 'id', credits: 25, amountCents: 299 },
    { packId: 'id_100', kind: 'id', credits: 100, amountCents: 999 },
  ] };
  const response = () => ({ ok: true, status: 200,
    json: async () => ({ status: 'checkout_ready', url: 'https://checkout.stripe.com/c/pay/cs_synthetic' }) });
  const sandbox = { window, history, document: { body, getElementById: id => id === 'membershipAccountStatus' ? banner : creditElements[id] || null, activeElement: new Element('button'), createElement: tag => new Element(tag) },
    Intl, crypto: webcrypto, Uint8Array, URL, AbortController, setTimeout, clearTimeout,
    location,
    fetch: async (url, options = {}) => {
      if (url === '/api/membership-account') return onAccount ? onAccount(options)
        : { ok: false, status: 503, json: async () => ({ error: 'not_enabled' }) };
      if (url.includes('catalogue')) {
        if (onCatalogue) { const custom = await onCatalogue(options); if (custom) return custom; }
        if (rejectAuth && options.headers?.Authorization) return { ok: false, status: 401, json: async () => ({ error: 'authentication_required' }) };
        return { ok: true, status: 200, json: async () => catalogue };
      }
      requests.push({ auth: options.headers.Authorization, request: JSON.parse(options.body) });
      return onCheckout ? await onCheckout(options, response) : response();
    } };
  vm.runInNewContext(source, sandbox);
  return { window, history, location, requests, banner, navigations, events,
    open: () => window.openMembershipShop(),
    buttons: () => walk(body).filter(e => e.tag === 'button' && /ID credits/.test(e.textContent || '')),
    controls: () => walk(body).filter(e => e.tag === 'button'),
    links: () => walk(body).filter(e => e.tag === 'a'),
    elements: () => walk(body),
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
    return { ok: true, status: 200, json: async () => ({ management: { scheduleChanges: true }, creditsAvailable: true,
      credits: { included: { id: 50, grade: 15 }, welcome: { id: 10, grade: 1 },
        purchased: { id: 100, grade: 25 } },
      state: { subscriptionId: 'sub_fixture', snapshot: { status: 'active', periodEnd: 2000000000 } } }) };
  };
  const h = setup({ onAccount }); await h.open();
  t.check('source balances displayed without expiry', /Included: 50 ID/.test(h.message())
    && /Verification bonus: 10 ID/.test(h.message()) && /Purchased \/ preserved standing credits: 100 ID/.test(h.message()));
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
    return { ok: true, status: 200, json: async () => ({ management: { scheduleChanges: true }, creditsAvailable: false,
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
await t.section('normal signed-out shop entry reaches existing sign-in', async () => {
  const h = setup({ initial: null });
  await h.window.openShop();
  t.check('header shop entry reaches membership packs', h.buttons().length === 2);
  t.check('signed-out shop does not claim global purchasing is disabled',
    /Sign in to verify/.test(h.message()) && !/Purchases are not enabled/.test(h.message()));
  t.check('sign-in preserves the same-origin membership return path',
    h.links().some(a => a.href === '/signin?next=%2F%3Fshop%3D1'));
  await h.buttons()[0].onclick();
  t.check('signed-out packs navigate to sign-in without a checkout request',
    h.requests.length === 0 && h.navigations[0] === '/signin?next=%2F%3Fshop%3D1');
});
await t.section('rejected billing authentication has a recovery link, not silent dead controls', async () => {
  const h = setup({ rejectAuth: true }); await h.open();
  t.check('401 explains rejected sign-in rather than successful pricing',
    /sign-in was not accepted for billing/.test(h.message()) && !/Membership pricing verified/.test(h.message()));
  t.check('401 retains safe existing sign-in route and sends no purchase',
    h.links().some(x => x.textContent === 'Sign in again to verify billing' && x.href === '/signin?next=%2F%3Fshop%3D1') && h.requests.length === 0);
});
await t.section('separate subscription navigation and seven exact pack selections', async () => {
  for (const plan of ['free', 'starter', 'casual', 'pro', 'business']) {
    const catalogue = { ...publicMembershipCatalogue(plan), purchaseEnabled: true, newSubscriptionAllowed: true };
    for (const pack of catalogue.packs) {
      const h = setup({ suppliedCatalogue: catalogue }); await h.open();
      const label = `${pack.credits.toLocaleString()} ${pack.kind === 'id' ? 'ID' : 'Grade'} credits`;
      const b = h.controls().find(b => b.textContent.startsWith(label));
      t.check(`${plan}/${pack.packId} displays server quoted cents`, b?.textContent.endsWith('$' + (pack.amountCents / 100).toFixed(2)));
      await b.onclick();
      t.check(`${plan}/${pack.packId} sends exact selection without client financial authority`,
        h.requests.length === 1 && h.requests[0].request.kind === 'pack' &&
        h.requests[0].request.selection === pack.packId &&
        Object.keys(h.requests[0].request).sort().join() === 'kind,requestId,selection');
    }
  }
  const c = { ...publicMembershipCatalogue(), purchaseEnabled: true, newSubscriptionAllowed: true };
  const h = setup({ suppliedCatalogue: c }); await h.window.openPricingModal();
  t.check('existing pricing entry opens separate five-card Subscriptions view',
    h.elements().filter(x => x.tag === 'article').length === 5 && h.buttons().length === 0 &&
    h.elements().some(x => x.tag === 'h2' && x.textContent === 'Subscriptions'));
  for (const plan of c.plans.filter(x => x.id !== 'free')) {
    const s = setup({ suppliedCatalogue: c }); await s.window.openSubscriptions();
    await s.controls().find(b => b.textContent === 'Choose ' + plan.name).onclick();
    t.check(`${plan.id} subscription selection preserved`, s.requests[0].request.kind === 'subscription' && s.requests[0].request.selection === plan.id);
  }
  await h.controls().find(b => b.textContent === 'Open credit-pack shop').onclick();
  t.check('Shop contains seven packs, two distinct headings and no plan cards',
    h.elements().filter(x => x.tag === 'article').length === 0 &&
    h.elements().filter(x => x.tag === 'strong' && x.className === 'membership-pack-price').length === 7 &&
    h.elements().some(x => x.tag === 'h3' && x.textContent === 'ID / Scan Credits') &&
    h.elements().some(x => x.tag === 'h3' && x.textContent === 'Grade Credits'));
  const signedOut = setup({ initial: null, suppliedCatalogue: c }); await signedOut.window.openSubscriptions();
  await signedOut.controls().find(b => b.textContent === 'Sign in to choose Casual').onclick();
  t.check('subscription sign-in returns to subscriptions, not packs',
    signedOut.navigations[0] === '/signin?next=%2F%3Fsubscriptions%3D1' && signedOut.requests.length === 0);
  for (const current of ['free', 'casual', 'legacy']) {
    const a = setup({ suppliedCatalogue: { ...c, currentPlan: current === 'legacy' ? 'business' : current },
      onAccount: async () => ({ ok: true, json: async () => ({
        state: { subscriptionId: current === 'free' ? null : 'sub_synthetic', snapshot: { plan: current } },
        credits: { tier: current }, creditsAvailable: false, management: { portal: current !== 'free' }
      }) }) });
    await a.window.openSubscriptions();
    t.check(`${current} current-plan indicator follows account not discount context`,
      current === 'legacy' ? /Current plan: existing legacy/.test(a.message()) && !a.controls().some(x => x.textContent === 'Current plan')
        : a.elements().some(x => x.tag === 'article' && x.textContent.startsWith('Current plan' + current[0].toUpperCase() + current.slice(1))));
  }
});
await t.section('association automatically refreshes normal account flow', async () => {
  let associated = false, gets = 0;
  const h = setup({ onAccount: async options => {
    if (options.method === 'POST') {
      associated = true;
      return { ok: true, status: 200, json: async () => ({ status: 'associated' }) };
    }
    gets++;
    return { ok: true, status: 200, json: async () => ({
      state: { status: associated ? 'associated' : 'not_associated' },
      management: { portal: associated }, creditsAvailable: false,
    }) };
  } });
  await h.open();
  await h.controls().find(b => /Set up your billing account/.test(b.textContent)).onclick();
  t.check('successful association refetches without another owner click', associated && gets === 2);
  t.check('refresh replaces association control with portal', !h.controls().some(b => /Set up your billing account/.test(b.textContent))
    && h.controls().some(b => /Manage billing in Stripe/.test(b.textContent)));
});
await t.section('legacy profile billing entry uses the verified membership account flow', async () => {
  let accountReads = 0;
  const h = setup({ onAccount: async () => {
    accountReads++;
    return { ok: true, status: 200, json: async () => ({
      state: { status: 'associated' }, management: { portal: true }, creditsAvailable: false,
    }) };
  } });
  await h.window.openBillingPortal();
  t.check('profile billing entry opens new account projection', accountReads === 1);
  t.check('only verified portal control is offered', h.controls().some(b => /Manage billing in Stripe/.test(b.textContent)));
  t.check('legacy email-search portal request never sent', h.requests.length === 0 && h.navigations.length === 0);
});
await t.section('confirmed Portal cancellation is not presented as another renewal', async () => {
  const h = setup({ onAccount: async () => ({ ok: true, status: 200, json: async () => ({
    state: { subscriptionId: 'sub_fixture', snapshot: { status: 'active', plan: 'legacy',
      cancelAtPeriodEnd: true, periodEnd: 1791390116 }, migration: { phase: 'authorized_not_scheduled' } },
    management: { portal: true, scheduleChanges: true }, creditsAvailable: false,
  }) }) });
  await h.open();
  t.check('scheduled cancellation is visible', h.message().includes('Cancellation scheduled.'));
  t.check('paid-through boundary replaces renewal wording', h.message().includes('Paid through; cancellation effective:')
    && !h.message().includes('Renewal boundary:'));
  t.check('permanent credits are explicitly retained', h.message().includes('All issued ID and Grade credits remain yours and never expire.'));
  t.check('migration is not advertised over a cancellation', !h.message().includes('Casual transition'));
  t.check('no competing cancellation or change command offered', !h.controls().some(b => /Change to |Cancel at renewal/.test(b.textContent)));
  t.check('normal Stripe Portal remains available', h.controls().some(b => b.textContent === 'Manage billing in Stripe'));
});
await t.section('verified identity without email authority gets verification, never another sign-in', async () => {
  const pending = { owner: 'A', request: { requestId: 'a'.repeat(64), kind: 'pack', selection: 'id_25' } };
  const state = { membershipPurchases: { A: pending }, unrelated: 'keep' };
  let opened = 0;
  const h = setup({ state, onCatalogue: async options => options.headers?.Authorization
    ? { ok: false, status: 401, json: async () => ({ error: 'authentication_required', action: 'verify_email' }) } : null });
  h.window.openVerifyModal = () => { opened++; };
  await h.open();
  t.check('email verification explains signed-in state', /You are signed in/.test(h.message()));
  t.check('no repeated sign-in action', !h.links().some(x => /Sign in again/.test(x.textContent)));
  t.check('all purchase controls remain disabled', h.buttons().every(x => x.disabled));
  const verify = h.controls().find(x => x.textContent === 'Verify email');
  t.check('verification action present', !!verify);
  verify.onclick();
  t.check('normal verification opened without navigation or purchase', opened === 1 && !h.navigations.length && !h.requests.length);
  t.check('pending purchase and unrelated history preserved', h.history.state === state && state.membershipPurchases.A === pending);
  await h.open();
  const stale = h.controls().find(x => x.textContent === 'Verify email');
  h.window.googleUser = user('B'); stale.onclick();
  t.check('stale account cannot launch verification', opened === 1);
});
await t.section('billing access policy rejection does not send verified users through another login loop', async () => {
  let accountCalls = 0;
  const h = setup({ onCatalogue: options => options.headers?.Authorization
    ? { ok: false, status: 403, json: async () => ({ error: 'membership_access_restricted' }) } : null,
    onAccount: () => { accountCalls++; throw Error('unexpected account call'); } });
  await h.open();
  t.check('403 identifies access policy and no payment', /billing access is not enabled/.test(h.message()) && /no payment was started/.test(h.message()));
  t.check('403 does not advise owner login or re-verification', !/Sign in again|existing owner|Verify email/.test(h.message())
    && !h.links().some(x => /signin/.test(x.href || '')));
  t.check('403 keeps purchases disabled and makes no account mutation', h.buttons().every(x => x.disabled)
    && h.requests.length === 0 && accountCalls === 0);
});
await t.section('shop navigation flags are consumed once without losing checkout recovery', async () => {
  const plain = setup(); await flush();
  t.check('ordinary homepage opens no shop', !plain.elements().some(x => x.tag === 'dialog'));
  for (const query of ['shop=1', 'subscriptions=1', 'shop=1&subscriptions=1',
    'membership_return=1&session_id=cs_fixture', 'membership_cancel=1']) {
    const state = { membershipPurchases: { A: { operationId: 'kept', sessionId: 'cs_fixture' } }, unrelated: 17 };
    const h = setup({ state, href: 'https://synthetic.invalid/?' + query + '&utm_source=fixture#account' });
    await flush();
    t.check(query + ' opens exactly one requested modal', h.elements().filter(x => x.tag === 'dialog' && x.open).length === 1);
    const cleaned = new URL(h.location.href);
    t.check(query + ' removes opening flags', ['shop', 'subscriptions', 'membership_return', 'membership_cancel'].every(k => !cleaned.searchParams.has(k)));
    t.check(query + ' preserves history and unrelated URL data', h.history.state === state
      && cleaned.searchParams.get('utm_source') === 'fixture' && cleaned.hash === '#account');
    if (query.includes('session_id')) t.check('checkout session retained for verification', cleaned.searchParams.get('session_id') === 'cs_fixture');
    h.controls().find(x => x.textContent === 'Close').onclick();
    const reloaded = setup({ state: h.history.state, href: h.location.href }); await flush();
    t.check(query + ' refresh does not reopen shop or send purchase', !reloaded.elements().some(x => x.tag === 'dialog') && reloaded.requests.length === 0);
  }
});
await t.section('persisted sign-in stays on account choice; explicit sign-in waits for persistence', async () => {
  const html = fs.readFileSync(new URL('../signin.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(x => !x[1].includes('src=')).map(x => ({ source: x[2], ast: parse(x[2], { ecmaVersion: 'latest', sourceType: 'module' }) }));
  const module = scripts.find(x => x.source.includes('onAuthStateChanged(auth,'));
  const callback = module.ast.body.find(n => n.type === 'ExpressionStatement'
    && n.expression.type === 'CallExpression' && n.expression.callee.name === 'onAuthStateChanged').expression.arguments[1];
  const continuation = module.ast.body.find(n => n.type === 'ExpressionStatement'
    && n.expression.type === 'AssignmentExpression' && n.expression.left.property?.name === '_continueToApp').expression.right;
  const resolver = scripts.find(x => x.source.includes('window._safeSignInDestination ='));
  for (const name of ['googleSignIn', 'doSignIn']) {
    let panels = 0, verifies = 0;
    const navigations = [], held = later();
    const location = { origin: 'https://www.cardresell.org', search: '?next=%2F%3Fshop%3D1', replace: url => navigations.push(url) };
    const window = { location, _dbg() {}, _showAlreadySignedIn: () => { panels++; }, _showVerifyScreen: () => { verifies++; } };
    const context = { window, location, URL, URLSearchParams, document: { getElementById: () => ({ value: 'fixture' }) },
      clearErr() {}, setLoading() {}, showErr() {}, fbMsg: e => e.message, _flushAuthToDisk: () => held.promise };
    vm.runInNewContext(resolver.source, context);
    window._continueToApp = vm.runInNewContext('(' + module.source.slice(continuation.start, continuation.end) + ')', context);
    const onAuth = vm.runInNewContext('(' + module.source.slice(callback.start, callback.end) + ')', context);
    onAuth({ emailVerified: true });
    t.check(name + ': persisted session with next displays account choice without redirect', panels === 1 && navigations.length === 0);
    window._justSignedUp = true; onAuth({ emailVerified: false }); window._justSignedUp = false;
    t.check(name + ': unfinished signup stays on verification', verifies === 1 && navigations.length === 0);
    const signIn = async () => onAuth({ emailVerified: true });
    window._fbGoogleSignIn = signIn; window._fbEmailSignIn = signIn;
    const script = scripts.find(x => x.ast.body.some(n => n.type === 'FunctionDeclaration' && n.id.name === name));
    const fn = script.ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
    const invoke = vm.runInNewContext('(' + script.source.slice(fn.start, fn.end) + ')', context);
    const pending = invoke(); await flush();
    t.check(name + ': observer cannot redirect before persistence completes', navigations.length === 0);
    held.resolve(); await pending;
    t.check(name + ': successful sign-in returns once to intended destination', navigations.length === 1 && navigations[0] === '/?shop=1');
    location.search = '?next=https://attacker.invalid/'; window._continueToApp();
    t.check(name + ': continue still rejects unsafe destinations', navigations[1] === '/');
  }
});
await t.section('membership funnel signals cannot invent payment success or break checkout', async () => {
  const h = setup(); await h.open(); await h.buttons()[0].onclick();
  t.check('successful shop render and checkout redirect produce distinct signals',
    h.events.map(x => x.name).join(',') === 'membership_shop_open,membership_checkout_attempt,membership_checkout_redirect');
  t.check('checkout redirect alone does not report a verified return', !h.events.some(x => x.name === 'membership_return_verified'));
  t.check('checkout telemetry only includes public selection and kind',
    JSON.stringify(h.events[1].props) === JSON.stringify({ plan: 'id_25', trigger: 'pack' }));
  const pending = setup({ onCheckout: async () => ({ ok: true, status: 202, json: async () => ({ status: 'recovery_pending' }) }) });
  await pending.open(); await pending.buttons()[0].onclick();
  t.check('pending checkout is not a redirect or conversion', pending.navigations.length === 0
    && pending.events.at(-1).name === 'membership_checkout_pending');
  const denied = setup({ onCheckout: async () => ({ ok: false, status: 503, json: async () => ({ error: 'checkout_unavailable' }) }) });
  await denied.open(); await denied.buttons()[0].onclick();
  t.check('failed checkout is measured without leaking server errors', denied.events.at(-1).name === 'membership_checkout_failed'
    && !JSON.stringify(denied.events).includes('checkout_unavailable'));
  const broken = setup(); broken.window.trackEvent = () => { throw new Error('analytics unavailable'); };
  await broken.open(); await broken.buttons()[0].onclick();
  t.check('analytics failure cannot stop secure checkout', broken.navigations.length === 1);
  const returnAccount = async () => ({ ok: true, status: 200, json: async () => ({ state: { status: 'not_associated' } }) });
  for (const status of ['pending', 'expired', 'fulfilled']) {
    const r = setup({ href: 'https://synthetic.invalid/?membership_return=1&session_id=cs_synthetic',
      onAccount: returnAccount, onCheckout: async () => ({ ok: true, status: 200, json: async () => ({ status }) }) });
    await flush(); await flush();
    t.check(status + ': URL never declares a paid conversion', !r.events.some(x => x.name === 'membership_return_verified'));
    const verify = r.controls().find(b => b.textContent === 'Verify returned checkout');
    await verify.onclick(); await verify.onclick();
    t.check(status + ': only fulfilled server result emits one return observation',
      r.events.filter(x => x.name === 'membership_return_verified').length === (status === 'fulfilled' ? 1 : 0));
  }
});
await t.section('automatic verified account setup', async () => {
  const verified = owner => ({ ...user(owner), emailVerified: true });
  const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const ready = { state: { status: 'associated' }, creditsAvailable: true };
  const held = later(); let reads = 0, posts = 0, refreshes = 0;
  const h = setup({ initial: verified('A'), onAccount: async options => {
    if (options.method === 'POST') { posts++; await held.promise; return response({ status: 'associated' }); }
    return response(++reads === 1 ? { state: { status: 'not_associated' }, creditsAvailable: false } : ready);
  }});
  h.window.checkProStatus = () => { refreshes++; };
  const first = h.window.ensureMembershipAccount();
  const second = h.window.ensureMembershipAccount();
  await flush();
  t.check('duplicate auth triggers share one setup and association', first === second && posts === 1);
  t.check('setup progress is visible without opening Shop', /Getting your account/.test(h.banner.textContent) && !h.elements().some(e => e.tag === 'dialog'));
  held.resolve(); const result = await first;
  t.check('read-after-write is required before ready', result.status === 'ready' && reads === 2 && refreshes === 1 && h.banner.hidden);
  await h.window.ensureMembershipAccount();
  t.check('ready identity does not repeatedly enroll or refresh', posts === 1 && reads === 2);
  let paidPosts = 0;
  const paid = setup({ initial: verified('P'), onAccount: async o => {
    if (o.method === 'POST') paidPosts++;
    return response({ ...ready, state: { status: 'active', subscriptionId: 'existing_paid' } });
  }});
  t.check('existing paid account uses read-only check', (await paid.window.ensureMembershipAccount()).status === 'ready' && paidPosts === 0);
  let unverifiedCalls = 0;
  const u = setup({ onAccount: async () => { unverifiedCalls++; return response({ error: 'authentication_required', action: 'verify_email' }, 401); } });
  await u.window.ensureMembershipAccount();
  t.check('unverified identity is checked by server without association', unverifiedCalls === 1);
  t.check('verification requirement offers visible email and Google actions', u.controls().some(b => b.textContent === 'Verify email') && u.controls().some(b => b.textContent === 'Sign in with Google'));
  let verifiedClicks = 0, googleClicks = 0;
  u.window.openVerifyModal = () => { verifiedClicks++; };
  u.window._fbGoogleSignIn = () => { googleClicks++; };
  u.controls().find(b => b.textContent === 'Verify email').onclick();
  u.controls().find(b => b.textContent === 'Sign in with Google').onclick();
  t.check('verification controls invoke normal sign-in and verification', verifiedClicks === 1 && googleClicks === 1);
  u.window.googleUser = user('B');
  u.controls().find(b => b.textContent === 'Sign in with Google').onclick();
  t.check('stale verification controls cannot sign in another session', googleClicks === 1);
  let savedPosts = 0;
  const saved = setup({ initial: { ...user('A'), emailVerified: false }, onAccount: async o => {
    if (o.method === 'POST') { savedPosts++; return response({ status: 'associated' }); }
    return response(savedPosts ? ready : { state: { status: 'not_associated' } });
  }});
  t.check('server-owned verification permits setup despite stale Firebase hint', (await saved.window.ensureMembershipAccount()).status === 'ready' && savedPosts === 1);
  const counts = Object.fromEntries(['settingsScanCount', 'settingsScanSub', 'idScanCount', 'idScanSub'].map(id => [id, new Element('div')]));
  const hints = setup({ creditElements: counts,
    loadCredits: async () => { counts.settingsScanCount.textContent = counts.idScanCount.textContent = 'Unavailable'; },
    onAccount: async () => response({ error: 'authentication_required', action: 'verify_email' }, 401) });
  await hints.window.ensureMembershipAccount(); await hints.window.loadSettingsScanCredits();
  t.check('unverified credit display points to verification instead of Shop', counts.settingsScanCount.textContent === 'Verify email' && /verification options/.test(counts.idScanSub.textContent));
  const totals = setup({ creditElements: counts,
    loadCredits: async () => { counts.settingsScanCount.textContent = '2'; counts.idScanCount.textContent = '15'; },
    onAccount: async () => response(ready) });
  await totals.window.ensureMembershipAccount(); await totals.window.loadSettingsScanCredits();
  t.check('credit recovery hints never replace confirmed balances', counts.settingsScanCount.textContent === '2' && counts.idScanCount.textContent === '15');
  for (const status of [401, 403, 503]) {
    let calls = 0;
    const denied = setup({ initial: verified('A'), onAccount: async () => {
      calls++; return response({ error: status === 403 ? 'membership_access_restricted' : 'authentication_required' }, status);
    }});
    const failed = await denied.window.ensureMembershipAccount();
    t.check(status + ': failed authorization/read cannot trigger association', calls === 1 && failed.status === 'pending');
    t.check(status + ': visible explanation, restriction has no pointless retry', !denied.banner.hidden && denied.controls().some(b => b.textContent === 'Retry account setup') === (status !== 403));
  }
  let transientReads = 0, transientPosts = 0;
  const retry = setup({ initial: verified('A'), onAccount: async o => {
    if (o.method === 'POST') { transientPosts++; return response({ status: 'associated' }); }
    return ++transientReads === 1 ? response({}, 503) : response(ready);
  }});
  await retry.window.ensureMembershipAccount();
  await retry.controls().find(b => b.textContent === 'Retry account setup').onclick();
  await flush();
  t.check('visible retry recovers without creating an existing customer', transientReads === 2 && transientPosts === 0 && retry.banner.hidden);
  const switching = later(); let switchedPosts = 0;
  const switched = setup({ initial: verified('A'), onAccount: async o => {
    if (o.method === 'POST') switchedPosts++;
    await switching.promise; return response({ state: { status: 'not_associated' } });
  }});
  const pending = switched.window.ensureMembershipAccount(); await flush();
  switched.window.googleUser = verified('B'); switched.window.resetMembershipAccountSetup();
  switching.resolve(); await pending;
  t.check('account switch cannot associate from stale read or restore stale banner', switchedPosts === 0 && switched.banner.hidden);
  let associated = false, lostPosts = 0;
  const lost = setup({ initial: verified('A'), onAccount: async o => {
    if (o.method === 'POST') { lostPosts++; associated = true; throw new Error('connection lost after commit'); }
    return response(associated ? ready : { state: { status: 'not_associated' } });
  }});
  await lost.window.ensureMembershipAccount();
  t.check('lost association response recovers by reading committed state', (await lost.window.ensureMembershipAccount()).status === 'ready' && lostPosts === 1);
  const missingCredits = setup({ initial: verified('A'), onAccount: async () => response({ ...ready, creditsAvailable: false }) });
  t.check('associated customer without verified balances remains retryable', (await missingCredits.window.ensureMembershipAccount()).status === 'pending' && !missingCredits.banner.hidden);
  const partial = setup({ initial: verified('A'), onAccount: async o => response(o.method === 'POST'
    ? { status: 'customer_pending' } : { state: { status: 'customer_pending' } }) });
  t.check('202/pending customer is never reported ready', (await partial.window.ensureMembershipAccount()).status === 'pending' && !partial.banner.hidden);
});
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const authPath = html.match(/src="\/js\/(auth\.[a-f0-9]{8}\.js)"/)[1];
const authSource = fs.readFileSync(new URL('../js/' + authPath, import.meta.url), 'utf8');
t.check('shipped sign-in and verification completion await automatic setup', (authSource.match(/await window\.ensureMembershipAccount\?\.\(\)/g) || []).length === 2);
t.check('shipped sign-out clears setup and banner', /window\.googleUser = null;\s+window\.resetMembershipAccountSetup\?\.\(\)/.test(authSource));

await t.section('renewal plan changes need confirmation and bind the selected account', async () => {
  const changes=[];
  const current={subscriptionId:'sub_fixture',snapshot:{status:'active',plan:'starter',periodStart:1700000000,periodEnd:2000000000,cancelAtPeriodEnd:false},command:null};
  const h=setup({initial:{...user('A'),emailVerified:true},suppliedCatalogue:{...publicMembershipCatalogue('starter'),purchaseEnabled:true,newSubscriptionAllowed:false},onAccount:async opts=>{
    if(opts.body){const body=JSON.parse(opts.body);changes.push(body);current.command={operationId:body.operationId,kind:'plan_change',plan:body.plan,phase:'requested'};return {ok:true,json:async()=>({status:'pending',state:current})};}
    return {ok:true,json:async()=>({state:current,credits:{tier:'starter'},creditsAvailable:false,management:{portal:true,scheduleChanges:true}})};
  }});
  h.window.confirm=()=>false;
  await h.window.openMembershipShop('subscriptions');
  let control=h.controls().find(x=>x.textContent==='Change to Pro at renewal');
  t.check('eligible subscription offers renewal change',!!control&&!control.disabled);
  await control.onclick();t.check('declining confirmation sends no operation',changes.length===0);
  h.window.confirm=()=>true;await control.onclick();
  t.check('accepted change sends server selection only',changes.length===1&&changes[0].action==='change'&&changes[0].plan==='pro'&&Object.keys(changes[0]).sort().join(',')==='action,operationId,plan');
  t.check('change has durable operation identity',/^[a-f0-9]{64}$/.test(changes[0].operationId));
  const retry=h.controls().find(x=>x.textContent==='Retry pending membership change');
  t.check('pending change exposes recovery',!!retry);
  await retry.onclick();
  t.check('recovery uses the original operation identity',changes.length===2&&changes[1].operationId===changes[0].operationId);
});

await t.section('upgrade ladder recommends the next plan with catalogue-only gains', async () => {
  const c = { ...publicMembershipCatalogue(), purchaseEnabled: true, newSubscriptionAllowed: true };
  const acct = (plan, credits) => async () => ({ ok: true, json: async () => ({
    state: { subscriptionId: plan === 'free' ? null : 'sub_synthetic', snapshot: { plan, status: 'active' } },
    credits: { tier: plan, ...(credits || {}) }, creditsAvailable: !!credits, management: { portal: plan !== 'free' } }) });
  const panelOf = h => h.elements().find(x => x.tag === 'section' && x.className === 'membership-upgrade');
  const card = (h, name) => h.elements().find(x => x.tag === 'article' && x.children.some(k => k.tag === 'h3' && k.textContent === name));
  const plan = id => c.plans.find(p => p.id === id);
  // Casual -> Pro
  const h = setup({ suppliedCatalogue: c, onAccount: acct('casual', { included: { id: 12, grade: 3 }, welcome: { id: 0, grade: 0 }, purchased: { id: 5, grade: 1 } }) });
  await h.window.openSubscriptions();
  const p = panelOf(h), text = p ? p.textContent : '';
  t.check('casual sees a Pro upgrade panel first', p && h.elements().indexOf(p) < h.elements().findIndex(x => x.tag === 'article')
    && text.includes('Pro is your next step up from Casual.'));
  t.check('panel states real allowance increase', text.includes(`${plan('pro').idCredits} ID + ${plan('pro').gradeCredits} Grade credits every month, up from ${plan('casual').idCredits} + ${plan('casual').gradeCredits}.`));
  t.check('panel states venue, buylist, batch and pack gains', text.includes(`up to ${plan('pro').marketplaceCount} supported venues`)
    && text.includes('buylist and consignment') && text.includes('Batch-grade') && text.includes(`Save ${plan('pro').packDiscountPercent}%`) && text.includes(`up from ${plan('casual').packDiscountPercent}%`));
  t.check('panel shows remaining balance from account', text.includes('You have 17 ID and 4 Grade credits left.'));
  t.check('panel shows price step without per-unit math', text.includes('(' + '$' + ((plan('pro').monthlyPriceCents - plan('casual').monthlyPriceCents) / 100).toFixed(2) + ' more than Casual)') && !/per credit|per scan|\/ID/.test(text));
  t.check('Pro card is marked as the recommended next step', card(h, 'Pro').textContent.startsWith('Recommended next step') && /membership-plan-next/.test(card(h, 'Pro').className));
  t.check('current plan card still marked current', card(h, 'Casual').textContent.startsWith('Current plan'));
  // reason-led copy from Free
  const f = setup({ suppliedCatalogue: c, onAccount: acct('free') }); await f.window.openPricingModal('scan_gate');
  t.check('scan gate from Free leads with credits and Starter', (panelOf(f)?.textContent || '').startsWith('Running low on credits? Starter is your next step up from Free.'));
  t.check('Free panel includes flip tracking unlock', (panelOf(f)?.textContent || '').includes('Track more than 10 flips'));
  // bulk grade gate jumps to the first plan that has batch grading
  const b = setup({ suppliedCatalogue: c, onAccount: acct('starter') }); await b.window.openPricingModal('bulk_grade_gate');
  const firstBatch = c.plans.find(x => x.features?.bulkGrade);
  t.check('bulk grade gate recommends the first plan with batch grading', (panelOf(b)?.textContent || '').includes(firstBatch.name + ' is your next step up from Starter.'));
  // explicit plan target
  const e = setup({ suppliedCatalogue: c, onAccount: acct('casual') }); await e.window.startTierCheckout('business');
  t.check('explicit plan target is honored when above current', (panelOf(e)?.textContent || '').includes('Business is your next step up from Casual.'));
  const d = setup({ suppliedCatalogue: c, onAccount: acct('pro') }); await d.window.startTierCheckout('starter');
  t.check('a lower explicit target falls back to the next plan up', (panelOf(d)?.textContent || '').includes('Business is your next step up from Pro.'));
  // top plan, legacy, signed out: no panel
  const top = setup({ suppliedCatalogue: c, onAccount: acct('business') }); await top.window.openSubscriptions();
  t.check('Business has no upgrade panel', !panelOf(top));
  const leg = setup({ suppliedCatalogue: { ...c, currentPlan: 'business' }, onAccount: async () => ({ ok: true, json: async () => ({
    state: { subscriptionId: 'sub_synthetic', snapshot: { plan: 'legacy' } }, credits: { tier: 'legacy' }, creditsAvailable: false, management: { portal: true } }) }) });
  await leg.window.openSubscriptions();
  t.check('legacy membership gets no ladder panel', !panelOf(leg));
  const out = setup({ initial: null, suppliedCatalogue: c }); await out.window.openSubscriptions();
  t.check('signed-out view gets no ladder panel', !panelOf(out));
  t.check('every plan card still discloses the saved-report limit', ['Free','Starter','Casual','Pro','Business'].every(n => /500 private AI grade reports/.test(card(h, n).textContent)));
});
await t.section('out-of-credit shop moments suggest a plan above the packs', async () => {
  const c = { ...publicMembershipCatalogue(), purchaseEnabled: true, newSubscriptionAllowed: true };
  const acct = plan => async () => ({ ok: true, json: async () => ({
    state: { subscriptionId: plan === 'free' ? null : 'sub_synthetic', snapshot: { plan, status: 'active' } },
    credits: { tier: plan }, creditsAvailable: false, management: { portal: plan !== 'free' } }) });
  const nudgeOf = h => h.elements().find(x => x.tag === 'section' && /membership-shop-nudge/.test(x.className || ''));
  const plan = id => c.plans.find(p => p.id === id);
  const g = setup({ suppliedCatalogue: c, onAccount: acct('free') }); await g.window.openShop('grade', 'grade_scan_402');
  const n = nudgeOf(g), text = n ? n.textContent : '';
  t.check('free user out of Grade credits sees a plan nudge in the Shop', text.startsWith('Out of Grade credits? Buy a pack below, or get credits every month with Starter.'));
  t.check('nudge uses catalogue allowances and price only', text.includes(`${plan('starter').idCredits} ID + ${plan('starter').gradeCredits} Grade credits every month`)
    && text.includes('$' + (plan('starter').monthlyPriceCents / 100).toFixed(2) + ' / month') && !/per credit|per scan|save \d+%|%/i.test(text));
  t.check('nudge sits above the packs', g.elements().indexOf(n) < g.elements().findIndex(x => x.tag === 'section' && x.className === 'membership-pack-section'));
  const btn = n && n.children.find(k => k.tag === 'button');
  t.check('nudge offers Compare plans', btn && btn.textContent === 'Compare plans');
  if (btn) { await btn.onclick(); }
  t.check('Compare plans opens Subscriptions with the same reason lead', /Out of Grade credits\? Starter is your next step up from Free\./.test(
    (g.elements().find(x => x.tag === 'section' && x.className === 'membership-upgrade')?.textContent) || ''));
  const id = setup({ suppliedCatalogue: c, onAccount: acct('casual') }); await id.window.openShop('id', 'id_scan_402');
  t.check('ID moment names ID credits and the next plan', (nudgeOf(id)?.textContent || '').startsWith('Out of ID credits? Buy a pack below, or get credits every month with Pro.'));
  const plain = setup({ suppliedCatalogue: c, onAccount: acct('free') }); await plain.window.openShop('id', 'header');
  t.check('header Shop opens without a nudge', !nudgeOf(plain));
  const top = setup({ suppliedCatalogue: c, onAccount: acct('business') }); await top.window.openShop('grade', 'grade_scan_gate');
  t.check('Business gets no nudge', !nudgeOf(top));
  const off = setup({ suppliedCatalogue: { ...c, purchaseEnabled: false }, onAccount: acct('free') }); await off.window.openShop('grade', 'grade_scan_gate');
  t.check('no nudge when purchasing is not enabled for the account', !nudgeOf(off));
  const out = setup({ initial: null, suppliedCatalogue: c }); await out.window.openShop('grade', 'grade_scan_402');
  t.check('signed-out Shop gets no nudge', !nudgeOf(out));
});
t.done();
