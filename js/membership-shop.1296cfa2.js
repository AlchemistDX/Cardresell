// Uses the site's existing sign-in. Prices are rendered from the server catalogue.
(() => {
  const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  let dialog, content, notice, opener, generation = 0, busy = false;
  const node = (tag, text, parent) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (parent) parent.append(el);
    return el;
  };
  const identity = () => ({ user: window.googleUser, sdk: window._fbCurrentUser,
    owner: window.googleUser?.uid || window.googleUser?.sub || null });
  function unchanged(bound) {
    const current = identity();
    if (current.user !== bound.user || current.owner !== bound.owner || current.sdk !== bound.sdk) {
      content?.querySelectorAll('button').forEach(b => { b.disabled = true; });
      throw new Error('Your account changed. Close and reopen the shop to refresh pricing.');
    }
  }
  async function token(bound) {
    unchanged(bound);
    if (!bound.user) return null;
    const provider = typeof bound.user.getIdToken === 'function' ? bound.user : bound.sdk;
    if (!provider || provider.uid !== bound.owner || typeof provider.getIdToken !== 'function') {
      throw new Error('Your account could not be verified. Sign in again.');
    }
    const value = await provider.getIdToken(true);
    unchanged(bound);
    return value;
  }
  async function accountRequest(bound, path, body, existingAuth) {
    unchanged(bound);
    const auth = existingAuth || await token(bound);
    if (!auth) throw new Error('Sign in to manage your membership.');
    const response = await fetch(path, { method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    unchanged(bound);
    if (!response.ok) throw new Error('Membership could not be confirmed. Existing credits are unchanged; retry the same operation.');
    return result;
  }
  function operation(bound, action, plan) {
    const saved = { ...history.state?.membershipCommands };
    const previous = saved[bound.owner];
    if (previous && (previous.action !== action || previous.plan !== plan)) {
      throw new Error('A membership change is pending. Refresh its status before requesting another.');
    }
    if (!previous) {
      const operationId = Array.from(crypto.getRandomValues(new Uint8Array(32)),
        x => x.toString(16).padStart(2, '0')).join('');
      saved[bound.owner] = { action, operationId, ...(plan ? { plan } : {}) };
      history.replaceState({ ...history.state, membershipCommands: saved }, '');
    }
    return saved[bound.owner];
  }
  function retireConfirmed(bound, state) {
    unchanged(bound);
    const saved = { ...history.state?.membershipCommands };
    const pending = saved[bound.owner];
    if (pending && state?.command?.phase === 'confirmed'
      && state.command.operationId === pending.operationId) {
      delete saved[bound.owner];
      history.replaceState({ ...history.state, membershipCommands: saved }, '');
    }
  }
  async function accountAction(bound, action, button, plan) {
    if (busy) return;
    busy = true; button.disabled = true;
    try {
      unchanged(bound);
      const body = action === 'associate' ? { action } : ['refresh', 'portal'].includes(action)
        ? { action, operationId: Array.from(crypto.getRandomValues(new Uint8Array(32)),
          x => x.toString(16).padStart(2, '0')).join('') } : operation(bound, action, plan);
      const result = await accountRequest(bound, '/api/membership-account', body);
      if (action === 'portal') {
        const destination = new URL(result.url);
        if (destination.origin !== 'https://billing.stripe.com' || destination.username || destination.password) {
          throw new Error('Billing portal could not be verified.');
        }
        unchanged(bound);
        location.assign(destination.href);
        return;
      }
      retireConfirmed(bound, result.state);
      if (result.status === 'confirmed') {
        const saved = { ...history.state?.membershipCommands }; delete saved[bound.owner];
        history.replaceState({ ...history.state, membershipCommands: saved }, '');
      }
      notice.textContent = result.status === 'confirmed' ? 'Change confirmed for the renewal boundary. Existing credits remain available.'
        : result.status === 'associated' ? 'Account associated. Reopen the shop to refresh purchase options.'
          : 'Status received. Pending changes are not confirmed until Stripe reconciliation succeeds.';
    } catch (e) { notice.textContent = e.message; }
    finally {
      busy = false;
      const current = identity();
      button.disabled = current.user !== bound.user || current.owner !== bound.owner || current.sdk !== bound.sdk;
    }
  }
  async function renderAccount(bound, catalogue, run, auth) {
    if (!bound.owner) return;
    const section = node('section', undefined, content);
    node('h3', 'Your membership', section);
    try {
      const result = await accountRequest(bound, '/api/membership-account', undefined, auth);
      if (run !== generation) return;
      const state = result.state;
      retireConfirmed(bound, state);
      if (result.creditsAvailable) {
        const c = result.credits;
        for (const [name, value] of [['Included', c.included], ['Verification bonus', c.welcome], ['Purchased', c.purchased]]) {
          node('p', `${name}: ${value.id} ID · ${value.grade} Grade`, section);
        }
        node('p', 'All issued credits remain available. Cancellation does not erase them.', section);
      } else node('p', 'Credit balances are not verified yet. No balance has been reset.', section);
      const button = (text, action, plan) => {
        const b = node('button', text, section); b.type = 'button';
        b.onclick = () => accountAction(bound, action, b, plan);
      };
      if (state.status === 'not_associated') button('Set up test billing association', 'associate');
      else if (state.subscriptionId) {
        node('p', `Subscription: ${state.snapshot?.status || 'Awaiting reconciliation'}`, section);
        if (state.snapshot?.periodEnd) node('p', 'Renewal boundary: ' +
          new Date(state.snapshot.periodEnd * 1000).toLocaleString(), section);
        if (state.command) node('p', `${state.command.kind === 'cancel' ? 'Cancellation' : 'Plan change to ' + state.command.plan}: ${state.command.phase}`, section);
        button('Refresh subscription status', 'refresh');
        if (result.management?.scheduleChanges === true && (!state.command || (state.command.phase === 'confirmed'
          && state.snapshot?.periodStart >= state.command.effectiveAt)) && state.snapshot?.status === 'active') {
          for (const p of catalogue.plans.filter(p => p.id !== 'free' && p.id !== state.snapshot.plan)) {
            button('Change to ' + p.name + ' at renewal', 'change', p.id);
          }
          button('Cancel at renewal; keep issued credits', 'cancel');
        }
      } else node('p', state.status === 'customer_pending' ? 'Customer association is awaiting recovery.' : 'No subscription is currently associated.', section);
      if (result.management?.portal === true) button('Manage billing in Stripe', 'portal');
      const sessionId = new URL(location.href).searchParams.get('session_id');
      if (/^cs_[A-Za-z0-9_]+$/.test(sessionId || '')) {
        const b = node('button', 'Verify returned checkout', section); b.type = 'button';
        b.onclick = async () => {
          if (busy) return;
          busy = true; b.disabled = true;
          try {
            const verified = await accountRequest(bound, '/api/membership-return', { sessionId });
            if (['fulfilled', 'expired'].includes(verified.status)) {
              const saved = { ...history.state?.membershipPurchases };
              if (saved[bound.owner]?.sessionId === sessionId) {
                delete saved[bound.owner];
                history.replaceState({ ...history.state, membershipPurchases: saved }, '');
              }
            }
            notice.textContent = verified.status === 'fulfilled' ? 'Payment verified and credits fulfilled. Reopen to refresh balances.'
              : 'Checkout is still awaiting verification. No payment success is assumed.';
          } catch (e) { notice.textContent = e.message; }
          finally {
            busy = false;
            const current = identity();
            b.disabled = current.user !== bound.user || current.owner !== bound.owner || current.sdk !== bound.sdk;
          }
        };
      }
    } catch {
      if (run === generation) node('p', 'Account management is not enabled or cannot be verified. Existing billing is unchanged.', section);
    }
  }
  function create() {
    if (dialog) return;
    dialog = node('dialog'); dialog.className = 'membership-shop';
    dialog.setAttribute('aria-labelledby', 'membership-shop-title');
    const header = node('header', undefined, dialog);
    node('h2', 'Plans & credits', header).id = 'membership-shop-title';
    const close = node('button', 'Close', header);
    close.type = 'button'; close.onclick = () => dialog.close();
    notice = node('p', '', dialog); notice.setAttribute('role', 'status');
    content = node('div', undefined, dialog);
    dialog.addEventListener('close', () => { generation++; opener?.focus(); });
    document.body.append(dialog);
  }
  async function purchase(kind, selection, button, bound) {
    if (busy) return;
    busy = true; button.disabled = true;
    try {
      unchanged(bound);
      const auth = await token(bound);
      if (!auth) throw new Error('Sign in with your existing CardResell account to continue.');
      const owner = bound.owner;
      if (!owner) throw new Error('Your account could not be verified. Sign in again.');
      const saved = { ...history.state?.membershipPurchases };
      const legacy = history.state?.membershipPurchase;
      if (legacy?.owner && !saved[legacy.owner]) saved[legacy.owner] = legacy;
      const previous = saved[owner];
      let request = previous?.owner === owner && previous.request?.kind === kind
        && previous.request?.selection === selection ? previous.request : null;
      if (!request) {
        if (previous?.owner === owner) throw new Error('A purchase is awaiting confirmation. Recover that purchase before starting another.');
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        request = { requestId: Array.from(bytes, x => x.toString(16).padStart(2, '0')).join(''), kind, selection };
        unchanged(bound);
        saved[owner] = { owner, request };
        history.replaceState({ ...history.state, membershipPurchases: saved }, '');
      }
      notice.textContent = 'Preparing secure checkout…';
      unchanged(bound);
      const response = await fetch('/api/membership-checkout', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth },
        body: JSON.stringify(request) });
      const result = await response.json();
      unchanged(bound);
      if (/^cs_[A-Za-z0-9_]+$/.test(result.sessionId || '') && saved[owner]?.request === request) {
        saved[owner] = { ...saved[owner], sessionId: result.sessionId };
        history.replaceState({ ...history.state, membershipPurchases: saved }, '');
      }
      if (response.status === 202) {
        notice.textContent = 'Checkout is awaiting confirmation. Select the same item to check again; no new purchase will be created.';
        return;
      }
      if (!response.ok) throw new Error(response.status === 503
        ? 'Purchases are not enabled yet. Your existing credits and subscription are unchanged.'
        : 'Checkout could not proceed. Your purchase reference is retained for recovery.');
      if (!result.url) throw new Error('This checkout needs reconciliation before another purchase. No credits have been issued by this page.');
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com'
        || url.username || url.password || url.port) throw new Error('Checkout address could not be verified.');
      unchanged(bound);
      location.assign(url.href);
    } catch (e) { notice.textContent = e.message || 'Unable to reach checkout. Retry the same item.'; }
    finally {
      busy = false;
      const current = identity();
      button.disabled = current.user !== bound.user || current.owner !== bound.owner || current.sdk !== bound.sdk;
    }
  }
  function render(catalogue, enabled, bound) {
    content.replaceChildren();
    node('p', 'USD per month. ID and Grade credits stay separate and never expire.', content);
    node('p', 'Free verification bonus: 10 ID + 1 Grade once, in addition to the monthly allowance.', content);
    const scroll = node('div', undefined, content); scroll.className = 'membership-table-scroll';
    scroll.setAttribute('aria-label', 'Membership comparison. Scroll horizontally on small screens.');
    scroll.tabIndex = 0;
    const table = node('table', undefined, scroll);
    const head = node('tr', undefined, node('thead', undefined, table));
    ['Plan', 'Monthly', 'ID credits', 'Grade credits', 'Pack discount', ''].forEach(label => {
      const th = node('th', label, head); th.scope = 'col';
    });
    const body = node('tbody', undefined, table);
    for (const plan of catalogue.plans) {
      const row = node('tr', undefined, body);
      node('th', plan.name, row).scope = 'row';
      [money(plan.monthlyPriceCents), String(plan.idCredits), String(plan.gradeCredits),
        plan.packDiscountPercent ? plan.packDiscountPercent + '%' : 'None'].forEach(v => node('td', v, row));
      const cell = node('td', undefined, row);
      if (plan.id === 'free') node('span', 'Free', cell);
      else {
        const b = node('button', 'Choose ' + plan.name, cell); b.type = 'button';
        b.disabled = !enabled || catalogue.newSubscriptionAllowed !== true;
        b.onclick = () => purchase('subscription', plan.id, b, bound);
      }
    }
    node('h3', 'Credit packs', content);
    node('p', enabled ? 'Your eligible membership discount is included in these prices.' : 'Base prices shown. Sign in to check eligible pricing.', content);
    const packs = node('div', undefined, content); packs.className = 'membership-packs';
    for (const pack of catalogue.packs) {
      const b = node('button', `${pack.credits.toLocaleString()} ${pack.kind === 'id' ? 'ID' : 'Grade'} credits · ${money(pack.amountCents)}`, packs);
      b.type = 'button'; b.disabled = !enabled;
      b.onclick = () => purchase('pack', pack.packId, b, bound);
    }
    node('p', 'One ID scan uses 1 ID credit. Grade uses 1 Grade credit; Deep Grade uses 2.', content);
    node('p', 'Existing subscriptions are not replaced by a new checkout. Plan changes take effect at renewal; no immediate charge.', content);
  }
  window.openMembershipShop = async () => {
    create(); opener = document.activeElement;
    if (!dialog.open) dialog.showModal();
    const run = ++generation;
    notice.textContent = 'Loading plans and credits…'; content.replaceChildren();
    try {
      await window._waitForAuth?.();
      const bound = identity();
      const auth = await token(bound);
      let response = await fetch('/api/membership-catalogue', { headers: auth ? { Authorization: 'Bearer ' + auth } : {} });
      let enabled = response.ok && !!auth;
      if (!response.ok && auth) response = await fetch('/api/membership-catalogue');
      if (!response.ok) throw new Error('The shop is unavailable. Close and reopen to try again.');
      const catalogue = await response.json();
      if (run !== generation) return;
      unchanged(bound);
      enabled = enabled && catalogue.purchaseEnabled === true;
      render(catalogue, enabled, bound);
      notice.textContent = enabled ? 'Membership pricing verified for your account.' : 'New catalogue preview. Purchases are not enabled; existing billing is unchanged.';
      await renderAccount(bound, catalogue, run, auth);
    } catch (e) { if (run === generation) notice.textContent = e.message; }
  };
  // The existing classic-script globals are the normal site's entry points.
  // Leave the fingerprinted legacy bundle intact while retiring its purchase UI.
  for (const name of ['openPricingModal', 'startTierCheckout', 'startProCheckout',
    'startAnnualCheckout', 'startGradeScanCheckout', 'startIdScanCheckout']) {
    window[name] = () => window.openMembershipShop();
  }
  if (new URL(location.href).searchParams.get('shop') === '1'
    || new URL(location.href).searchParams.get('membership_return') === '1') window.openMembershipShop();
})();
