// Uses the site's existing sign-in. Prices are rendered from the server catalogue.
(() => {
  const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  let dialog, content, notice, heading, opener, generation = 0, busy = false, view = 'shop';
  let planControls = [];
  const signIn = () => location.assign('/signin?next=' + encodeURIComponent(view === 'subscriptions' ? '/?subscriptions=1' : '/?shop=1'));
  const node = (tag, text, parent) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (parent) parent.append(el);
    return el;
  };
  // Best-effort funnel signals only. No identity, Stripe IDs, tokens or error text.
  // Revenue must be reconciled against Stripe, never inferred from these counts.
  const track = (name, props = {}) => {
    try { window.trackEvent?.(name, props); } catch (_) {}
  };
  const identity = () => ({ user: window.googleUser, sdk: window._fbCurrentUser,
    owner: window.googleUser?.uid || window.googleUser?.sub || null });
  const verificationError = () => Object.assign(new Error('You are signed in, but email verification is required before billing can open. Verify your email, then reopen Shop. Existing credits and pending operations are preserved.'), { code: 'email_verification_required' });
  const requiresVerification = (response, body) => response.status === 401
    && body?.error === 'authentication_required' && body?.action === 'verify_email';
  function showFailure(error, parent = notice, bound = identity()) {
    parent.textContent = error.message || 'Unable to reach checkout. Retry the same item.';
    if (error.code !== 'email_verification_required') return;
    const button = node('button', 'Verify email', parent);
    button.type = 'button';
    button.onclick = () => {
      try {
        unchanged(bound);
        if (typeof window.openVerifyModal !== 'function') throw new Error('Close Shop and use Verify email in your account. Then reopen Shop.');
        // Keep the same tab, URL and pending-operation history.
        dialog.close();
        window.openVerifyModal();
      } catch (e) { parent.textContent = e.message; }
    };
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
      throw new Error('Your account could not be verified. Sign in again.');
    }
    const value = await provider.getIdToken(true);
    unchanged(bound);
    return value;
  }
  async function accountRequest(bound, path, body, existingAuth, signal) {
    unchanged(bound);
    const auth = existingAuth || await token(bound);
    if (!auth) throw new Error('Sign in to manage your membership.');
    const response = await fetch(path, { method: body ? 'POST' : 'GET', ...(signal ? { signal } : {}),
      headers: { Authorization: 'Bearer ' + auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    unchanged(bound);
    if (requiresVerification(response, result)) throw verificationError();
    if (!response.ok) throw Object.assign(new Error('Membership could not be confirmed. Existing credits are unchanged; retry the same operation.'), { code: result.error });
    return result;
  }
  // One setup per authenticated identity at a time. The server verifies access,
  // owns all grants, and replays association safely after an interrupted request.
  let setupAttempt = null, setupState = null;
  const sameIdentity = bound => {
    const current = identity();
    return current.user === bound.user && current.sdk === bound.sdk && current.owner === bound.owner;
  };
  function setupNotice(bound, message, retry = false) {
    if (!sameIdentity(bound)) return;
    const banner = document.getElementById('membershipAccountStatus');
    if (!banner) return;
    banner.textContent = message;
    banner.hidden = !message;
    if (retry) {
      const button = node('button', 'Retry account setup', banner);
      button.type = 'button';
      button.onclick = () => {
        if (sameIdentity(bound)) window.ensureMembershipAccount();
      };
    }
  }
  window.resetMembershipAccountSetup = () => {
    setupAttempt?.controller.abort();
    setupAttempt = null;
    setupState = null;
    const banner = document.getElementById('membershipAccountStatus');
    if (banner) { banner.textContent = ''; banner.hidden = true; }
  };
  window.ensureMembershipAccount = () => {
    const bound = identity();
    if (!bound.owner) {
      window.resetMembershipAccountSetup();
      return Promise.resolve({ status: 'verification_required' });
    }
    if (setupAttempt && sameIdentity(setupAttempt.bound)) return setupAttempt.promise;
    window.resetMembershipAccountSetup();
    const attempt = { bound, controller: new AbortController() };
    setupAttempt = attempt;
    setupState = { bound, status: 'pending' };
    setupNotice(bound, 'Getting your account and credits ready…');
    attempt.promise = (async () => {
      const timeout = setTimeout(() => attempt.controller.abort(), 25000);
      try {
        const auth = await token(bound);
        const request = body => accountRequest(bound, '/api/membership-account', body, auth, attempt.controller.signal);
        let result = await request();
        if (['not_associated', 'customer_pending'].includes(result.state?.status)) {
          const created = await request({ action: 'associate' });
          if (created.status !== 'associated') throw new Error('setup_pending');
          result = await request();
        }
        if (!result.creditsAvailable || !result.state
          || ['not_associated', 'customer_pending'].includes(result.state.status)) throw new Error('setup_pending');
        unchanged(bound);
        setupState = { bound, status: 'ready' };
        setupNotice(bound, '');
        // Refresh credits after enrollment, including a retry from the home page.
        try { window.checkProStatus?.(); } catch (_) {}
        try {
          if (document.getElementById('settingsPanel')?.classList.contains('open')) window.loadSettingsScanCredits?.();
        } catch (_) {}
        return { status: 'ready' };
      } catch (error) {
        if (sameIdentity(bound) && setupAttempt === attempt) {
          const restricted = error.code === 'membership_access_restricted';
          const verificationRequired = error.code === 'email_verification_required';
          setupState = { bound, status: verificationRequired ? 'verification_required' : restricted ? 'restricted' : 'pending' };
          setupNotice(bound, restricted
            ? 'Billing access is not enabled for this account yet. Contact support.'
            : error.code === 'email_verification_required'
              ? 'Verify your email or sign in with Google to finish setting up your account and credits.'
              : 'Your account setup could not finish. Retry here to load your credits and billing. Existing credits are safe.', !restricted && !verificationRequired);
          if (verificationRequired) {
            const banner = document.getElementById('membershipAccountStatus');
            if (banner) {
              const verify = node('button', 'Verify email', banner);
              verify.type = 'button';
              verify.onclick = () => { if (sameIdentity(bound)) window.openVerifyModal?.(); };
              const google = node('button', 'Sign in with Google', banner);
              google.type = 'button';
              google.onclick = () => { if (sameIdentity(bound)) window._fbGoogleSignIn?.(); };
            }
          }
          setupAttempt = null;
        }
        return { status: 'pending' };
      } finally { clearTimeout(timeout); }
    })();
    return attempt.promise;
  };
  // Keep the legacy balance renderer, but replace its obsolete Shop directions.
  // Never change a number returned by the balance endpoint.
  const loadCredits = window.loadSettingsScanCredits;
  if (typeof loadCredits === 'function') window.loadSettingsScanCredits = async (...args) => {
    const bound = identity();
    await loadCredits(...args);
    if (!sameIdentity(bound)) return;
    if (setupState?.status === 'verification_required' && sameIdentity(setupState.bound)
      && bound.user?.emailVerified === true) {
      // Also resume after the site's server-owned email verification flow.
      await window.ensureMembershipAccount();
      if (!sameIdentity(bound)) return;
    }
    const state = setupState && sameIdentity(setupState.bound) ? setupState.status : 'pending';
    for (const [countId, subId] of [['settingsScanCount', 'settingsScanSub'], ['idScanCount', 'idScanSub']]) {
      const count = document.getElementById(countId), sub = document.getElementById(subId);
      if (!count || !sub || count.textContent !== 'Unavailable') continue;
      count.textContent = state === 'verification_required' ? 'Verify email' : 'Unavailable';
      sub.textContent = state === 'verification_required' ? 'Use the verification options above'
        : state === 'restricted' ? 'Billing access is not enabled for this account yet'
          : state === 'ready' ? 'Could not load credits. Reopen Settings to retry'
            : 'Account setup is pending. Use the message above to retry';
    }
  };
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
            // A query string or Stripe redirect alone never means payment success.
            if (verified.status === 'fulfilled') {
              const seen = history.state?.membershipReturnEvents || [];
              const key = bound.owner + ':' + sessionId;
              if (!seen.includes(key)) {
                history.replaceState({ ...history.state, membershipReturnEvents: [...seen.slice(-19), key] }, '');
                track('membership_return_verified');
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
      if (run === generation) {
        if (e.code === 'email_verification_required') showFailure(e, node('p', '', section), bound);
        else node('p', 'Account management is not enabled or cannot be verified. Existing billing is unchanged.', section);
      }
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
      track('membership_checkout_attempt', { plan: selection, trigger: kind });
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
      const response = await fetch('/api/membership-checkout', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth },
        body: JSON.stringify(request) });
      const result = await response.json();
      unchanged(bound);
      if (requiresVerification(response, result)) throw verificationError();
      if (/^cs_[A-Za-z0-9_]+$/.test(result.sessionId || '') && saved[owner]?.request === request) {
        saved[owner] = { ...saved[owner], sessionId: result.sessionId };
        history.replaceState({ ...history.state, membershipPurchases: saved }, '');
      }
      if (response.status === 202) {
        track('membership_checkout_pending', { plan: selection, trigger: kind });
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
      track('membership_checkout_redirect', { plan: selection, trigger: kind });
      location.assign(url.href);
    } catch (e) {
      track('membership_checkout_failed', { plan: selection, trigger: kind });
      showFailure(e, notice, bound);
    }
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
        const uses = { free: 'Try card identification and grading.', starter: 'For occasional scans and grading checks.', casual: 'Compare more places to sell your cards.', pro: 'Compare the full supported venue set for regular selling.', business: 'For higher-volume scanning with the largest pack discount.' };
        node('p', uses[plan.id] || 'Compare the included benefits below.', card);
        const benefits = node('ul', undefined, card);
        const count = plan.marketplaceCount;
        node('li', count > 2 ? 'Compare estimated payouts after fees across up to ' + count + ' supported venues.' : 'Compare estimated payouts after fees on eBay and TCGplayer.', benefits);
        if (plan.packDiscountPercent) node('li', 'Save ' + plan.packDiscountPercent + '% on additional ID and Grade credit packs.', benefits);
        if (plan.id === 'starter') node('li', 'Same comparison tools as Free, with more monthly scans and grades.', benefits);
        if (plan.id === 'business') node('li', 'Same marketplace tools as Pro, with higher allowances and a larger pack discount.', benefits);
        const allowances = node('dl', undefined, card);
        for (const [label, value] of [['ID credits / month', plan.idCredits.toLocaleString()],
          ['Grade credits / month', plan.gradeCredits.toLocaleString()],
          ['Credit-pack discount', plan.packDiscountPercent ? plan.packDiscountPercent + '%' : 'None'],
          ['Marketplace comparisons', plan.marketplaceCount === 2 ? 'eBay + TCGplayer' : 'Up to ' + plan.marketplaceCount]]) {
          const row = node('div', undefined, allowances); node('dt', label, row); node('dd', value, row);
        }
        const b = node('button', !bound.owner ? 'Sign in to ' + (plan.id === 'free' ? 'get started' : 'choose ' + plan.name)
          : plan.id === 'free' ? 'Included with your account' : 'Choose ' + plan.name, card);
        b.type = 'button';
        b.disabled = !!bound.owner && (plan.id === 'free' || !enabled || catalogue.newSubscriptionAllowed !== true);
        b.onclick = () => !bound.owner ? signIn() : purchase('subscription', plan.id, b, bound);
        planControls.push({ id: plan.id, card, badge, button: b });
      }
      node('h3', 'Included across plans', content);
      node('p', 'Single-card ID scans, Quick and Deep Grade, camera or photo uploads, and listing-draft creation. Scans and grading use the displayed credits; drafting remains subject to account limits. A paid plan does not make the AI grader more accurate.', content);
      node('p', 'Marketplace availability varies by card game. Compare estimated payouts, not guaranteed sale prices. Casual adds venues such as Mercari, Whatnot, Cardmarket and Cardsphere; Pro and Business also include supported buylist and consignment comparisons. Choose your selling venues before comparing payouts.', content);
      node('p', 'Verified Free accounts also receive 10 ID + 1 Grade once, separately from the monthly allowance.', content);
      node('p', 'Paid plans renew monthly in USD until canceled. Cancel at period end in Billing; paid-through benefits and all issued credits remain yours. Self-service plan switching is not available yet.', content);
    } else {
      node('p', 'One-time credit packs. Credits never expire.', content);
      node('p', enabled ? 'Your eligible membership discount is included in these prices.'
        : bound.owner ? 'Base prices shown. Verify your account to check eligible pricing.'
          : 'Base prices shown. Sign in to check eligible pricing.', content);
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
    notice.textContent = 'Loading plans and credits…'; content.replaceChildren();
    try {
      await window._waitForAuth?.();
      const bound = identity();
      if (bound.user?.emailVerified === true) await window.ensureMembershipAccount();
      unchanged(bound);
      const auth = await token(bound);
      let response = await fetch('/api/membership-catalogue', { headers: auth ? { Authorization: 'Bearer ' + auth } : {} });
      let verificationRequired = false;
      if (auth && response.status === 401) {
        try { verificationRequired = requiresVerification(response, await response.json()); } catch (_) {}
        unchanged(bound);
      }
      const accessRestricted = !!auth && response.status === 403;
      const signInRejected = !!auth && response.status === 401 && !verificationRequired;
      let enabled = response.ok && !!auth;
      if (!response.ok && auth) response = await fetch('/api/membership-catalogue');
      if (!response.ok) throw new Error('The shop is unavailable. Close and reopen to try again.');
      const catalogue = await response.json();
      if (run !== generation) return;
      unchanged(bound);
      enabled = enabled && catalogue.purchaseEnabled === true;
      render(catalogue, enabled, bound);
      track('membership_shop_open', { source: view });
      notice.textContent = enabled ? 'Membership pricing verified for your account.'
        : verificationRequired ? verificationError().message
        : accessRestricted ? 'You are signed in, but billing access is not enabled for this account. Contact support; no payment was started.'
        : signInRejected ? 'Your sign-in was not accepted for billing. Sign in again to refresh your session; no payment was started.'
        : bound.owner ? 'Account setup or billing verification is required before purchasing. Check Your membership below.'
          : 'Sign in to verify your account and check purchase availability.';
      if (verificationRequired) {
        showFailure(verificationError(), notice, bound);
      } else if (!bound.owner || signInRejected) {
        const signIn = node('a', signInRejected ? 'Sign in again to verify billing' : 'Sign in to continue', node('p', undefined, content));
        signIn.href = '/signin?next=' + encodeURIComponent(view === 'subscriptions' ? '/?subscriptions=1' : '/?shop=1');
      } else if (!enabled && !accessRestricted) {
        const retry = node('button', 'Refresh account and pricing', content);
        retry.type = 'button'; retry.onclick = () => window.openMembershipShop(view);
      }
      if (!verificationRequired && !signInRejected && !accessRestricted) await renderAccount(bound, catalogue, run, auth);
    } catch (e) { if (run === generation) notice.textContent = e.message; }
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
  // Explicit navigation opens once. Refreshing or revisiting the resulting home
  // URL must not reopen a modal. Retain session_id for normal checkout recovery.
  const entry = new URL(location.href);
  const returned = entry.searchParams.get('membership_return') === '1'
    || entry.searchParams.get('membership_cancel') === '1';
  const destination = returned ? 'shop' : entry.searchParams.get('subscriptions') === '1' ? 'subscriptions'
    : entry.searchParams.get('shop') === '1' ? 'shop' : null;
  if (destination) {
    for (const key of ['shop', 'subscriptions', 'membership_return', 'membership_cancel']) entry.searchParams.delete(key);
    history.replaceState(history.state, '', entry.pathname + entry.search + entry.hash);
    window.openMembershipShop(destination);
  }
})();
