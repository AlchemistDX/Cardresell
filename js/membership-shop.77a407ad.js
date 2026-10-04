// Uses the site's existing sign-in. Prices are rendered from the server catalogue.
(() => {
  const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  let dialog, content, notice, heading, opener, generation = 0, busy = false, view = 'shop';
  let planControls = [];
  const signInPath = recovery => '/signin?' + (recovery ? 'reauth=1&' : '') +
    'next=' + encodeURIComponent(view === 'subscriptions' ? '/?subscriptions=1' : '/?shop=1');
  const signIn = () => location.assign(signInPath(false));
  const node = (tag, text, parent) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (parent) parent.append(el);
    return el;
  };
  const identity = () => ({ user: window.googleUser, sdk: window._fbCurrentUser,
    owner: window.googleUser?.uid || window.googleUser?.sub || null });
  const recoveryPrefix = 'cardresell.billingRecovery.';
  const recoveryMarker = () => new URL(location.href).searchParams.get('membership_recovery');
  const validRecoveryId = value => /^[a-f0-9]{64}$/.test(value || '');
  const recoveryStorageError = () => new Error('This browser could not preserve the pending billing reference. Keep this tab open and retry the same operation; do not start another purchase.');
  function readRecovery(id) {
    try {
      if (!validRecoveryId(id)) throw Error();
      const raw = window.sessionStorage.getItem(recoveryPrefix + id);
      if (!raw || raw.length > 16384) throw Error();
      const record = JSON.parse(raw);
      if (record.version !== 1 || typeof record.owner !== 'string' || !record.owner || record.owner.length > 128) throw Error();
      if (record.purchase && (record.purchase.owner !== record.owner ||
        !validRecoveryId(record.purchase.request?.requestId) ||
        !['pack', 'subscription'].includes(record.purchase.request.kind) ||
        typeof record.purchase.request.selection !== 'string')) throw Error();
      if (record.command && (!validRecoveryId(record.command.operationId) ||
        !['change', 'cancel'].includes(record.command.action))) throw Error();
      if (record.sessionId && !/^cs_[A-Za-z0-9_]+$/.test(record.sessionId)) throw Error();
      return record;
    } catch (_) { throw recoveryStorageError(); }
  }
  function bindRecoveryLink(link, bound) {
    link.href = signInPath(true);
    link.onclick = event => {
      try {
        unchanged(bound);
        let id = recoveryMarker(), record;
        if (id) {
          // A wrong-account sign-in must retain the original owner's handoff.
          record = readRecovery(id);
        } else {
          if (!bound.owner) return;
          const purchase = history.state?.membershipPurchases?.[bound.owner] ||
            (history.state?.membershipPurchase?.owner === bound.owner ? history.state.membershipPurchase : null);
          const command = history.state?.membershipCommands?.[bound.owner];
          const sessionId = new URL(location.href).searchParams.get('session_id');
          record = { version: 1, owner: bound.owner, ...(purchase ? { purchase } : {}),
            ...(command ? { command } : {}), ...(/^cs_[A-Za-z0-9_]+$/.test(sessionId || '') ? { sessionId } : {}) };
          id = Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
          const encoded = JSON.stringify(record);
          window.sessionStorage.setItem(recoveryPrefix + id, encoded);
          if (window.sessionStorage.getItem(recoveryPrefix + id) !== encoded) throw recoveryStorageError();
          readRecovery(id);
        }
        const destination = new URL(view === 'subscriptions' ? '/?subscriptions=1' : '/?shop=1', location.href);
        destination.searchParams.set('membership_recovery', id);
        if (record.sessionId) {
          destination.searchParams.set('membership_return', '1');
          destination.searchParams.set('session_id', record.sessionId);
        }
        link.href = '/signin?reauth=1&next=' + encodeURIComponent(destination.pathname + destination.search);
      } catch (_) {
        event.preventDefault();
        link.href = '#';
        notice.textContent = recoveryStorageError().message;
        node('span', ' ', notice);
        notice.append(link);
      }
    };
    // Prepare the href before interaction too, so keyboard/new-tab navigation
    // never receives an unbound bare sign-in URL. Missing storage fails closed.
    link.onclick({ preventDefault() {} });
  }
  function restoreRecovery(bound) {
    const id = recoveryMarker();
    if (!id) return;
    const record = readRecovery(id);
    if (bound.owner !== record.owner) {
      const error = billingError('authentication_required');
      error.message = 'This pending billing operation belongs to another account. Sign in again with the original account to recover it.';
      throw error;
    }
    unchanged(bound);
    const purchases = { ...history.state?.membershipPurchases }, commands = { ...history.state?.membershipCommands };
    const legacy = history.state?.membershipPurchase;
    const existingPurchase = purchases[bound.owner] || (legacy?.owner === bound.owner ? legacy : null);
    if ((existingPurchase && record.purchase && JSON.stringify(existingPurchase) !== JSON.stringify(record.purchase)) ||
      (commands[bound.owner] && record.command && JSON.stringify(commands[bound.owner]) !== JSON.stringify(record.command))) {
      throw recoveryStorageError();
    }
    if (record.purchase) purchases[bound.owner] = record.purchase;
    if (record.command) commands[bound.owner] = record.command;
    const url = new URL(location.href);
    url.searchParams.delete('membership_recovery');
    if (record.sessionId) {
      url.searchParams.set('membership_return', '1');
      url.searchParams.set('session_id', record.sessionId);
    }
    try {
      history.replaceState({ ...history.state, membershipPurchases: purchases, membershipCommands: commands }, '', url.pathname + url.search + url.hash);
    } catch (_) { throw recoveryStorageError(); }
    // Commit history before removing the handoff. Failed cleanup leaves a safe
    // identical replay; it must never erase the only saved operation identity.
    try { window.sessionStorage.removeItem(recoveryPrefix + id); } catch (_) {}
  }
  function billingError(code) {
    const messages = {
      authentication_required: 'Your sign-in was not accepted for billing. Sign in again to verify your account.',
      billing_network_error: 'The billing service could not be reached. Retry the same operation; its saved reference is retained.',
      billing_redirect: 'Billing returned an unexpected redirect. No payment result was verified.',
      billing_response_not_json: 'Billing returned a page instead of an API response. No payment result was verified.',
      billing_invalid_response: 'Billing returned an unreadable response. No payment result was verified.',
      billing_unavailable: 'Billing is temporarily unavailable. Retry the same operation; its saved reference is retained.',
      billing_not_allowed: 'This billing action is not allowed for the current account.',
      billing_pending: 'Billing could not confirm this operation. Retry the same operation; its saved reference is retained.',
    };
    return Object.assign(new Error(messages[code] || messages.billing_pending), { code });
  }
  function showFailure(error, parent = notice, bound = identity()) {
    parent.textContent = error.message;
    parent.setAttribute('data-billing-error', error.code || 'billing_client_validation');
    if (error.code === 'authentication_required') {
      node('span', ' ', parent);
      const link = node('a', 'Sign in again to verify billing', parent);
      bindRecoveryLink(link, bound);
    }
  }
  async function billingFetch(bound, path, options) {
    unchanged(bound);
    let response;
    try { response = await fetch(path, options); }
    catch (_) { unchanged(bound); throw billingError('billing_network_error'); }
    unchanged(bound);
    return response;
  }
  async function readBillingResponse(response, bound) {
    unchanged(bound);
    if (response.status === 401) throw billingError('authentication_required');
    if (response.redirected) throw billingError('billing_redirect');
    const type = (response.headers?.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^application\/(?:[a-z0-9.+-]+\+)?json$/.test(type)) throw billingError('billing_response_not_json');
    let result;
    try { result = await response.json(); }
    catch (_) { unchanged(bound); throw billingError('billing_invalid_response'); }
    unchanged(bound);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw billingError('billing_invalid_response');
    if (!response.ok) throw billingError(response.status === 503 ? 'billing_unavailable'
      : response.status === 403 ? 'billing_not_allowed' : 'billing_pending');
    return result;
  }
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
      throw billingError('authentication_required');
    }
    let value;
    try { value = await provider.getIdToken(true); }
    catch (_) { unchanged(bound); throw billingError('authentication_required'); }
    unchanged(bound);
    return value;
  }
  async function accountRequest(bound, path, body, existingAuth) {
    unchanged(bound);
    const auth = existingAuth || await token(bound);
    if (!auth) throw new Error('Sign in to manage your membership.');
    const response = await billingFetch(bound, path, { method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return readBillingResponse(response, bound);
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
      if (result.status === 'associated') await window.openMembershipShop(view);
    } catch (e) { showFailure(e, notice, bound); }
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
      if (view === 'subscriptions') {
        const current = state.subscriptionId ? (state.snapshot?.plan === 'legacy' ? 'legacy'
          : result.credits?.tier || state.snapshot?.plan) : result.credits?.tier === 'free' ? 'free' : null;
        for (const control of planControls) {
          if (control.id === current) {
            control.badge.textContent = 'Current plan';
            control.card.className += ' membership-plan-current';
            control.button.textContent = 'Current plan';
            control.button.disabled = true;
          } else if (state.subscriptionId) {
            control.button.textContent = control.id === 'free' ? 'Manage cancellation' : 'Manage existing subscription';
            control.button.disabled = result.management?.portal !== true;
            control.button.onclick = () => accountAction(bound, 'portal', control.button);
          }
        }
        if (current === 'legacy') node('p', 'Current plan: existing legacy membership. Your current benefits are preserved; none of these plans has replaced it.', section);
      }
      retireConfirmed(bound, state);
      if (result.creditsAvailable) {
        const c = result.credits;
        for (const [name, value] of [['Included', c.included], ['Verification bonus', c.welcome], ['Purchased / preserved standing credits', c.purchased]]) {
          node('p', `${name}: ${value.id} ID · ${value.grade} Grade`, section);
        }
        node('p', 'All issued credits remain available. Cancellation does not erase them.', section);
      } else node('p', 'Credit balances are not verified yet. No balance has been reset.', section);
      const button = (text, action, plan) => {
        const b = node('button', text, section); b.type = 'button';
        b.onclick = () => accountAction(bound, action, b, plan);
      };
      if (state.status === 'not_associated') button('Set up your billing account', 'associate');
      else if (state.subscriptionId) {
        const cancellationScheduled = state.snapshot?.cancelAtPeriodEnd === true;
        if (state.snapshot?.plan === 'legacy') node('p', 'Existing membership: your current allowance and paid-through period are preserved.', section);
        if (cancellationScheduled) node('p',
          'Cancellation scheduled. Paid-through benefits remain until the date below. All issued ID and Grade credits remain yours and never expire.', section);
        else if (state.migration && state.migration.phase !== 'confirmed') node('p',
          'Casual transition is not yet confirmed in Stripe. No new subscription or midperiod allowance has been created.', section);
        node('p', `Subscription: ${state.snapshot?.status || 'Awaiting reconciliation'}`, section);
        if (state.snapshot?.periodEnd) node('p', (cancellationScheduled ? 'Paid through; cancellation effective: ' : 'Renewal boundary: ') +
          new Date(state.snapshot.periodEnd * 1000).toLocaleString(), section);
        if (state.command) node('p', `${state.command.kind === 'cancel' ? 'Cancellation' : 'Plan change to ' + state.command.plan}: ${state.command.phase}`, section);
        button('Refresh subscription status', 'refresh');
        if (!cancellationScheduled && result.management?.scheduleChanges === true && (!state.command || (state.command.phase === 'confirmed'
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
          } catch (e) { showFailure(e, notice, bound); }
          finally {
            busy = false;
            const current = identity();
            b.disabled = current.user !== bound.user || current.owner !== bound.owner || current.sdk !== bound.sdk;
          }
        };
      }
    } catch (e) {
      if (run === generation) showFailure(e, node('p', undefined, section), bound);
    }
  }
  function create() {
    if (dialog) return;
    dialog = node('dialog'); dialog.className = 'membership-shop';
    dialog.setAttribute('aria-labelledby', 'membership-shop-title');
    const header = node('header', undefined, dialog);
    heading = node('h2', 'Shop', header); heading.id = 'membership-shop-title';
    const close = node('button', 'Close', header);
    close.type = 'button'; close.onclick = () => dialog.close();
    notice = node('p', '', dialog); notice.setAttribute('role', 'status');
    notice.className = 'membership-notice';
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
      notice.scrollIntoView?.({ block: 'nearest' });
      unchanged(bound);
      const response = await billingFetch(bound, '/api/membership-checkout', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth },
        body: JSON.stringify(request) });
      const result = await readBillingResponse(response, bound);
      if (/^cs_[A-Za-z0-9_]+$/.test(result.sessionId || '') && saved[owner]?.request === request) {
        saved[owner] = { ...saved[owner], sessionId: result.sessionId };
        history.replaceState({ ...history.state, membershipPurchases: saved }, '');
      }
      if (response.status === 202) {
        notice.textContent = 'Checkout is awaiting confirmation. Select the same item to check again; no new purchase will be created.';
        return;
      }
      if (!result.url) throw new Error('This checkout needs reconciliation before another purchase. No credits have been issued by this page.');
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com'
        || url.username || url.password || url.port) throw new Error('Checkout address could not be verified.');
      unchanged(bound);
      location.assign(url.href);
    } catch (e) { showFailure(e, notice, bound); }
    finally {
      busy = false;
      if (notice.textContent) notice.scrollIntoView?.({ block: 'nearest' });
      const current = identity();
      button.disabled = current.user !== bound.user || current.owner !== bound.owner || current.sdk !== bound.sdk;
    }
  }
  function render(catalogue, enabled, bound) {
    content.replaceChildren();
    planControls = [];
    if (view === 'subscriptions') {
      node('p', 'Monthly plans. Credits are added at each renewal and never expire.', content);
      const grid = node('div', undefined, content); grid.className = 'membership-plans';
      for (const plan of catalogue.plans) {
        const card = node('article', undefined, grid); card.className = 'membership-plan';
        const badge = node('span', '', card); badge.className = 'membership-plan-badge';
        node('h3', plan.name, card);
        const price = node('p', undefined, card); price.className = 'membership-plan-price';
        node('strong', money(plan.monthlyPriceCents), price); node('span', ' / month', price);
        const allowances = node('dl', undefined, card);
        for (const [label, value] of [['ID credits / month', plan.idCredits.toLocaleString()],
          ['Grade credits / month', plan.gradeCredits.toLocaleString()],
          ['Credit-pack discount', plan.packDiscountPercent ? plan.packDiscountPercent + '%' : 'None']]) {
          const row = node('div', undefined, allowances); node('dt', label, row); node('dd', value, row);
        }
        const b = node('button', !bound.owner ? 'Sign in to ' + (plan.id === 'free' ? 'get started' : 'choose ' + plan.name)
          : plan.id === 'free' ? 'Included with your account' : 'Choose ' + plan.name, card);
        b.type = 'button';
        b.disabled = !!bound.owner && (plan.id === 'free' || !enabled || catalogue.newSubscriptionAllowed !== true);
        b.onclick = () => !bound.owner ? signIn() : purchase('subscription', plan.id, b, bound);
        planControls.push({ id: plan.id, card, badge, button: b });
      }
      node('p', 'Verified Free accounts also receive 10 ID + 1 Grade once, separately from the monthly allowance.', content);
      node('p', 'Paid plans renew monthly in USD until canceled. Cancel at period end in Billing; paid-through benefits and all issued credits remain yours. Self-service plan switching is not available yet.', content);
    } else {
      node('p', 'One-time credit packs. Credits never expire.', content);
      node('p', enabled ? 'Your eligible membership discount is included in these prices.' : 'Base prices shown. Sign in to check eligible pricing.', content);
      for (const kind of ['id', 'grade']) {
        const section = node('section', undefined, content); section.className = 'membership-pack-section';
        node('h3', kind === 'id' ? 'ID / Scan Credits' : 'Grade Credits', section);
        const packs = node('div', undefined, section); packs.className = 'membership-packs';
        for (const pack of catalogue.packs.filter(p => p.kind === kind)) {
          const b = node('button', undefined, packs);
          b.type = 'button'; b.disabled = !!bound.owner && !enabled;
          b.setAttribute('data-pack-id', pack.packId);
          node('span', `${pack.credits.toLocaleString()} ${kind === 'id' ? 'ID' : 'Grade'} credits`, b).className = 'membership-pack-quantity';
          node('strong', money(pack.amountCents), b).className = 'membership-pack-price';
          b.onclick = () => !bound.owner ? signIn() : purchase('pack', pack.packId, b, bound);
        }
      }
      node('p', 'ID scans use 1 ID credit. Ordinary grading uses 1 Grade credit; Deep Grade uses 2. ID and Grade balances stay separate.', content);
    }
    const other = node('button', view === 'subscriptions' ? 'Open credit-pack shop' : 'Compare subscriptions', content);
    other.type = 'button'; other.className = 'membership-switch';
    other.onclick = () => window.openMembershipShop(view === 'subscriptions' ? 'shop' : 'subscriptions');
  }
  window.openMembershipShop = async (destination = 'shop') => {
    create(); if (!dialog.open) opener = document.activeElement;
    view = destination === 'subscriptions' ? 'subscriptions' : 'shop';
    heading.textContent = view === 'subscriptions' ? 'Subscriptions' : 'Shop';
    dialog.className = 'membership-shop' + (view === 'subscriptions' ? ' membership-subscriptions' : '');
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    const run = ++generation;
    content.setAttribute('aria-busy', 'true');
    notice.setAttribute('data-billing-error', '');
    notice.textContent = 'Loading plans and credits…'; content.replaceChildren();
    try {
      await window._waitForAuth?.();
      const bound = identity();
      restoreRecovery(bound);
      const auth = await token(bound);
      let catalogue, failure = null;
      try {
        catalogue = await readBillingResponse(await billingFetch(bound, '/api/membership-catalogue',
          { headers: auth ? { Authorization: 'Bearer ' + auth } : {} }), bound);
      } catch (e) {
        if (!auth) throw e;
        unchanged(bound);
        failure = e;
        catalogue = await readBillingResponse(await billingFetch(bound, '/api/membership-catalogue'), bound);
      }
      if (!Array.isArray(catalogue.plans) || !Array.isArray(catalogue.packs)) throw billingError('billing_invalid_response');
      const signInRejected = failure?.code === 'authentication_required';
      if (run !== generation) return;
      unchanged(bound);
      const enabled = !!auth && !failure && catalogue.purchaseEnabled === true;
      render(catalogue, enabled, bound);
      notice.setAttribute('data-billing-error', failure?.code || '');
      notice.textContent = enabled ? 'Membership pricing verified for your account.'
        : failure ? failure.message
        : bound.owner ? 'Account setup or billing verification is required before purchasing. Check Your membership below.'
          : 'Sign in to verify your account and check purchase availability.';
      if (!bound.owner || signInRejected) {
        const signIn = node('a', signInRejected ? 'Sign in again to verify billing' : 'Sign in to continue', node('p', undefined, content));
        signIn.href = signInPath(signInRejected);
        if (signInRejected) bindRecoveryLink(signIn, bound);
      } else if (!enabled) {
        const retry = node('button', 'Refresh account and pricing', content);
        retry.type = 'button'; retry.onclick = () => window.openMembershipShop(view);
      }
      if (!signInRejected) await renderAccount(bound, catalogue, run, auth);
    } catch (e) { if (run === generation) showFailure(e); }
    finally { if (run === generation) content.setAttribute('aria-busy', 'false'); }
  };
  // The existing classic-script globals are the normal site's entry points.
  // Leave the fingerprinted legacy bundle intact while retiring its purchase UI.
  for (const name of ['openShop', 'startGradeScanCheckout', 'startIdScanCheckout']) {
    window[name] = () => window.openMembershipShop();
  }
  for (const name of ['openSubscriptions', 'openPricingModal', 'startTierCheckout',
    'startProCheckout', 'startAnnualCheckout', 'openBillingPortal']) {
    window[name] = () => window.openMembershipShop('subscriptions');
  }
  if (new URL(location.href).searchParams.get('subscriptions') === '1') window.openSubscriptions();
  if (new URL(location.href).searchParams.get('shop') === '1'
    || new URL(location.href).searchParams.get('membership_return') === '1'
    || new URL(location.href).searchParams.get('membership_cancel') === '1') window.openMembershipShop();
})();
