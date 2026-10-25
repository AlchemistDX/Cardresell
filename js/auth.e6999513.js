
    import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
    import {
      initializeAuth, onAuthStateChanged, signOut as fbSignOut,
      GoogleAuthProvider, signInWithPopup,
      createUserWithEmailAndPassword, signInWithEmailAndPassword,
      sendPasswordResetEmail, sendEmailVerification,
      indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence,
      browserPopupRedirectResolver
    } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

    const firebaseConfig = {
      apiKey: "AIzaSyByHlvesKEFGqOTPPx35b1gAG-4zgrPt-c",
      authDomain: "cardresell-e0329.firebaseapp.com",
      projectId: "cardresell-e0329",
      storageBucket: "cardresell-e0329.firebasestorage.app",
      messagingSenderId: "107816299392",
      appId: "1:107816299392:web:247dd67177459923866f65"
    };

    const app = initializeApp(firebaseConfig);
    // CRITICAL: use initializeAuth() with persistence array — NOT getAuth() +
    // setPersistence(). In Firebase v10.12.2, calling setPersistence() after
    // getAuth() resolves cleanly but silently fails to attach the persistence
    // manager, leaving auth in memory-only mode. Result: sign-ins from
    // /signin vanish the moment index.html loads. Verified in Playwright:
    // getAuth+setPersistence writes 0 records to firebaseLocalStorageDb;
    // initializeAuth writes 1. Array = ordered fallback: IDB, then
    // localStorage (cross-tab), then sessionStorage (in-tab only).
    // MUST include popupRedirectResolver — initializeAuth() does NOT auto-attach it
    // (only getAuth() does). Without it, signInWithPopup throws auth/argument-error.
    // See: https://github.com/firebase/firebase-js-sdk/issues/7882
    const auth = initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
      popupRedirectResolver: browserPopupRedirectResolver
    });

    // Expose to global scope for use in non-module scripts
    window._fbAuth = auth;
    // Pass actionCodeSettings so Firebase's verification email includes a
    // clickable link that redirects back to cardresell.org after the user
    // taps it. Without this, the default action URL is a long
    // firebaseapp.com/__/auth/action URL that lands on spam and looks sketchy.
    // NOTE: cardresell.org (and www.cardresell.org) must be on Firebase Auth's
    // Authorized Domains list for the redirect to work; if not, Firebase throws
    // auth/unauthorized-continue-uri and we fall back to the default link.
    window._fbSendVerification = async () => {
      const user = auth.currentUser;
      const current = () => auth.currentUser === user;
      const changed = () => Object.assign(new Error('Your account changed. Request a new verification email.'), { code: 'auth/user-changed' });
      // Reject on failure: both callers use await/catch to decide whether to
      // show "sent". A resolved {ok:false} falsely reported successful delivery.
      const showFailure = (error) => {
        if (!current()) throw changed();
        const messages = {
          'auth/too-many-requests': 'Email requests are temporarily limited. Wait before trying again.',
          'auth/network-request-failed': 'Could not request the email. Check your connection and try again.',
          'auth/user-not-found': 'Sign in again before requesting a verification email.',
        };
        const message = messages[error?.code] || 'Could not send the verification email. Please try again later.';
        const err = document.getElementById('authVerifyError');
        if (err) { err.textContent = message; err.style.display = ''; }
        const ok = document.getElementById('authVerifySuccess');
        if (ok) { ok.textContent = ''; ok.style.display = 'none'; }
        console.warn('Verification email request failed:', error?.code || 'send-failed');
        throw error;
      };
      if (!user) {
        return showFailure(Object.assign(new Error('Sign in again before requesting a verification email.'), { code: 'auth/user-not-found' }));
      }
      const actionCodeSettings = {
        url: 'https://www.cardresell.org/?verified=1',
        handleCodeInApp: false,
      };
      try {
        await sendEmailVerification(user, actionCodeSettings);
        if (!current()) throw changed();
        return { ok: true, withReturn: true };
      } catch (e) {
        if (!current()) throw changed();
        // Only retry without the return URL when that URL is the problem.
        // Retrying throttling/network failures can compound the original error.
        if (!['auth/unauthorized-continue-uri', 'auth/invalid-continue-uri'].includes(e?.code)) {
          return showFailure(e);
        }
        try {
          await sendEmailVerification(user);
          if (!current()) throw changed();
          return { ok: true, withReturn: false, warning: e.code };
        } catch (e2) {
          return showFailure(e2);
        }
      }
    };
    window._fbReloadUser = () => auth.currentUser && auth.currentUser.reload();
    // If openAuthModal was called before Firebase was ready, open it now
    if (window._pendingAuthModal) {
      const pending = window._pendingAuthModal;
      window._pendingAuthModal = null;
      setTimeout(() => openAuthModal(pending), 100);
    }
    window._fbSignOut = () => fbSignOut(auth);
    async function completeGoogleSignIn() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      const user = result?.user;
      const current = () => user && auth.currentUser?.uid === user.uid;
      const incomplete = () => Object.assign(new Error('Google sign-in did not finish. Please try again.'), { code: 'auth/google-sign-in-incomplete' });
      if (!current() || result.providerId !== 'google.com') throw incomplete();
      // A successful OAuth popup can update an existing UID without another
      // auth-state callback. Reload the profile and refresh the signed token.
      await user.reload();
      if (!current()) throw incomplete();
      const fresh = await user.getIdTokenResult(true);
      if (!current() || fresh.signInProvider !== 'google.com') throw incomplete();
      return result;
    }
    window._fbGoogleSignIn = async () => {
      try {
        const oldError = document.getElementById('googleSignInError');
        if (oldError) oldError.remove();
        const result = await completeGoogleSignIn();
        // Re-enter the normal auth/setup path even when the UID did not change.
        location.reload();
        return result;
      } catch (error) {
        const messages = {
          'auth/popup-closed-by-user': 'Google sign-in was closed before completion. Please try again.',
          'auth/cancelled-popup-request': 'Another Google sign-in is in progress. Finish that window first.',
          'auth/popup-blocked': 'Google sign-in was blocked. Allow pop-ups for CardResell, then try again.',
          'auth/network-request-failed': 'Google sign-in could not connect. Check your connection and try again.',
          'auth/account-exists-with-different-credential': 'This account uses another sign-in method. Sign in with that method to continue.',
        };
        const message = messages[error?.code] || 'Google sign-in did not finish. Please try again.';
        for (const id of ['authSignInError', 'authSignUpError']) {
          const el = document.getElementById(id);
          if (el) { el.textContent = message; el.style.display = ''; }
        }
        const host = document.getElementById('membershipAccountStatus');
        if (host) {
          const el = document.createElement('p'); el.id = 'googleSignInError';
          el.setAttribute('role', 'alert'); el.textContent = message;
          host.append(el); host.hidden = false;
        }
        // The result is deliberately unsuccessful; never navigate after cancel.
        return { ok: false };
      }
    };
    window._fbEmailSignIn = async (email, pass) => {
      return signInWithEmailAndPassword(auth, email, pass);
    };
    window._fbEmailSignUp = async (email, pass) => {
      return createUserWithEmailAndPassword(auth, email, pass);
    };
    window._fbResetPassword = async (email) => {
      return sendPasswordResetEmail(auth, email);
    };

    // Signal that auth has resolved — sets window._authResolved = true
    // Checkout functions poll window._waitForAuth() instead of a one-shot promise

    // Central auth state handler — fires on sign-in, sign-out, and page load
    // Track current auth UID to prevent null callbacks from overwriting a valid session
    let _currentAuthUid = null;
    let _authGeneration = 0;
    window._captureAuthSession = () => {
      const generation = _authGeneration;
      const facade = window.googleUser;
      const user = auth.currentUser;
      return { user, current: () => !!user && !!facade && generation === _authGeneration
        && auth.currentUser === user && window._fbCurrentUser === user
        && window.googleUser === facade && facade.uid === user.uid && facade.sub === user.uid };
    };
    window._beginVerificationAction = button => {
      const session = window._captureAuthSession();
      const attempt = {};
      if (button) button._crVerificationAttempt = attempt;
      return { user: session.user, current: () => session.current()
        && (!button || button._crVerificationAttempt === attempt) };
    };

    // Auth debug indicator — hidden by default. Enable by visiting /?debug=1 (or ?authdebug=1)
    // or by running window._enableAuthDebug() in the console.
    const _authDebugEnabled = (() => {
      try {
        const q = new URLSearchParams(location.search);
        if (q.get('debug') === '1' || q.get('authdebug') === '1') {
          try { sessionStorage.setItem('_authDebug', '1'); } catch(e) {}
          return true;
        }
        return sessionStorage.getItem('_authDebug') === '1';
      } catch(e) { return false; }
    })();
    function _updateAuthDebug(state) {
      if (!_authDebugEnabled) return;
      try {
        let el = document.getElementById('_authDebugPanel');
        if (!el) {
          el = document.createElement('div');
          el.id = '_authDebugPanel';
          el.style.cssText = 'position:fixed;top:8px;left:8px;z-index:99999;background:rgba(0,0,0,.85);color:#fff;font:11px/1.3 monospace;padding:6px 8px;border-radius:6px;border:1px solid #444;max-width:250px;word-break:break-all;pointer-events:auto;cursor:pointer';
          el.title = 'Tap to hide';
          el.onclick = () => el.remove();
          document.body.appendChild(el);
        }
        el.textContent = state;
      } catch(e) {}
    }
    window._updateAuthDebug = _updateAuthDebug;
    window._enableAuthDebug = () => { try { sessionStorage.setItem('_authDebug','1'); location.reload(); } catch(e) {} };
    window._disableAuthDebug = () => { try { sessionStorage.removeItem('_authDebug'); document.getElementById('_authDebugPanel')?.remove(); } catch(e) {} };

    // Everything that identifies the signed-in user, cleared in one place.
    // Previously the sign-out path and the "no user was ever set" path each had
    // their own partial copy of this list, and the sign-out path was never
    // reached at all (see the null branch below), so a signed-out browser kept
    // window.googleUser -- and therefore kept getUserKey() resolving to the
    // previous account's UID-scoped collection. (Privacy, 2026-09-04.)
    function _resetVerificationActions() {
      for (const [id, label] of Object.entries({authVerifyResendBtn:'Resend verification email',
        authVerifyCheckBtn:'I’ve verified — claim bonus', verifySendBtn:'Send code',
        verifyConfirmBtn:'Verify', verifyLinkDoneBtn:'I’ve verified — claim bonus'})) {
        const node = document.getElementById(id);
        if (node) { node._crVerificationAttempt = null; node.disabled = false; node.textContent = label; }
      }
      for (const id of ['authVerifyError', 'authVerifySuccess']) {
        const node = document.getElementById(id); if (node) { node.textContent = ''; node.style.display = 'none'; }
      }
    }
    function _resetAuthAccountState() {
      window.resetMembershipAccountSetup?.();
      window._emailVerified = false;
      window._verificationStatusPending = false;
      window._verifiedEmail = '';
      window._verifyPendingEmail = null;
      window._isPro = false;
      window._userTier = null;
      window._membershipVenueAccess = null;
      window._freeScansLeft = 0;
      window._scanCredits = 0;
      window._idScanCredits = 0;
      window._freeIdLeft = 0;
      window._userRefCode = '';
      window._sessionExpired = false;
      window._proWelcomePending = false;
      try { window._cancelUserDataSync && window._cancelUserDataSync(); } catch(e) {}
      try { updateScanBtnCredits?.(); } catch(e) {}
      for (const id of ['settingsScanCount', 'idScanCount']) {
        const node = document.getElementById(id); if (node) node.textContent = '—';
      }
      for (const id of ['settingsScanSub', 'idScanSub']) {
        const node = document.getElementById(id); if (node) node.textContent = 'Sign in to check';
      }
      for (const id of ['referSection', 'exportGradingLogBtn', 'manageSubSection']) {
        const node = document.getElementById(id); if (node) node.style.display = 'none';
      }
      _resetVerificationActions();
      document.getElementById('verifyEmailModal')?.remove();
    }
    function _clearAuthIdentity() {
      _authGeneration++;
      _currentAuthUid = null;
      window.googleUser = null;
      window._fbCurrentUser = null;
      window._googleIdToken = null;
      _resetAuthAccountState();
      try { window._syncDraftWorkflowSession?.(); } catch (_) {}
      window._userEmail = '';
      window._googleSub = '';
      window._userSub = '';
      clearInterval(window._tokenRefreshInterval);
      clearInterval(window._verifyPollInterval);
      // A debounced push scheduled while signed in must not fire against the
      // old account after we've dropped the token.
      try { window._cancelUserDataSync && window._cancelUserDataSync(); } catch(e) {}
      try {
        localStorage.removeItem('lastAuthUid');
        sessionStorage.removeItem('verifyBannerDismissed');
      } catch(e) {}
      try { const b = document.getElementById('emailVerifyBanner'); if (b) b.remove(); } catch(e) {}
      try { document.getElementById('googleSignInBtn').style.display = 'flex'; } catch(e) {}
      try { document.getElementById('googleUserBtn').style.display = 'none'; } catch(e) {}
      try { window._resolveAuthGrace && window._resolveAuthGrace(); } catch(e) {}
      // Re-render so the previous account's cards leave the screen. getUserKey()
      // now resolves to the anonymous scope, so this shows anon data (or empty),
      // never the signed-out user's.
      try { window._maybeRerenderCollection && window._maybeRerenderCollection(true); } catch(e) {}
      try { if (document.getElementById('flipsView')?.classList.contains('active')) window.renderFlipsView?.(); } catch(e) {}
      try { _updateCollectionSignInWall?.(); } catch(e) {}
      try { _updateFlipsSignInWall?.(); } catch(e) {}
      try { updateProUI?.(); } catch(e) {}
      window._authInitialized = true;
    }
    // signOut() sets this so the null callback below is treated as authoritative
    // instead of being written off as a token-refresh artifact.
    window._signOutIntent = false;
    // signOut() calls this directly so clearing does not depend on Firebase
    // firing the null callback. Idempotent -- safe if the callback also runs.
    window._clearAuthIdentityNow = _clearAuthIdentity;

    onAuthStateChanged(auth, async (user) => {
      if (user) {
        // The SDK may deliver an older callback after a newer account change.
        if (auth.currentUser !== user) return;
        const ownerChanged = _currentAuthUid !== user.uid;
        _authGeneration++;
        clearInterval(window._tokenRefreshInterval);
        clearInterval(window._verifyPollInterval);
        if (ownerChanged) _resetAuthAccountState();
        else _resetVerificationActions();
        // applyGoogleUser can start status requests. Never pair a new facade
        // with the previous account's bearer while this token is loading.
        window._googleIdToken = null;
        _currentAuthUid = user.uid;
        window._signOutIntent = false;
        // Firebase's top-level user.email can be empty when the account was linked oddly
        // or the Google provider didn't return an email claim. Fall back to providerData.
        let effectiveEmail = user.email || '';
        if (!effectiveEmail && Array.isArray(user.providerData)) {
          for (const p of user.providerData) {
            if (p?.email) { effectiveEmail = p.email; break; }
          }
        }
        let effectiveName = user.displayName || '';
        if (!effectiveName && Array.isArray(user.providerData)) {
          for (const p of user.providerData) {
            if (p?.displayName) { effectiveName = p.displayName; break; }
          }
        }
        let effectivePhoto = user.photoURL || '';
        if (!effectivePhoto && Array.isArray(user.providerData)) {
          for (const p of user.providerData) {
            if (p?.photoURL) { effectivePhoto = p.photoURL; break; }
          }
        }

        // Track providers for UI + trust logic.
        const providerIds = (user.providerData || []).map(p => p?.providerId || '');
        // Apple-only auto-verify: Apple OAuth is strong enough that we trust it, and
        // Apple's private-relay email is often unreachable in practice. Google is NOT
        // auto-trusted (fake Gmails are trivial to create).
        const isApple = providerIds.includes('apple.com');
        let effectiveVerified = !!user.emailVerified || isApple;

        // Fresh sign-in — clear a prior session's banner dismissal so unverified users
        // are re-prompted on every new sign-in until they verify. localStorage keyed by uid
        // so we can tell "different user signed in" apart from "same tab, same session".
        try {
          const lastUid = localStorage.getItem('lastAuthUid');
          if (lastUid !== user.uid) {
            sessionStorage.removeItem('verifyBannerDismissed');
            localStorage.setItem('lastAuthUid', user.uid);
          }
        } catch(e) {}

        // Set user object immediately (synchronously) so checkout functions can read it right away
        window.googleUser = {
          name: effectiveName || effectiveEmail.split('@')[0] || 'User',
          email: effectiveEmail,
          avatar: effectivePhoto,
          sub: user.uid,
          uid: user.uid,
          emailVerified: effectiveVerified,
          providers: providerIds
        };
        window._userEmail = effectiveEmail;
        window._googleSub = user.uid;
        window._userSub = user.uid;
        window._emailVerified = effectiveVerified;
        window._verificationStatusPending = true;
        window._fbCurrentUser = user; // keep a handle for reload() / resend
        try { window._syncDraftWorkflowSession?.(); } catch (_) {}
        window._authResolved = true;
        window._authInitialized = true;
        try { window.trackAuthenticatedVisit?.(); } catch (_) {}

        const { current } = window._captureAuthSession();
        let verificationBusy = false;
        let verificationTimer;
        // Verification and its bonus belong to this session, including every
        // asynchronous continuation. Slow reloads must not overlap each other.
        async function checkVerification() {
          if (!current() || verificationBusy) return;
          verificationBusy = true;
          try {
            await user.reload();
            if (!current() || !user.emailVerified) return;
            effectiveVerified = true;
            clearInterval(verificationTimer);
            window._emailVerified = true;
            window.googleUser.emailVerified = true;
            let freshTok = null;
            try { freshTok = await user.getIdToken(true); } catch(e) {}
            if (!current()) return;
            if (typeof freshTok === 'string' && freshTok.trim()) {
              window._googleIdToken = freshTok;
              try {
                const r = await fetch('/api/verify-claim-firebase', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + freshTok },
                  body: JSON.stringify({}),
                });
                if (!current()) return;
                const d = await r.json().catch(() => ({}));
                if (!current()) return;
                if (r.ok && d.ok && d.bonusGranted && typeof showToast === 'function') {
                  showToast('\u2713 Verified \u2014 10 ID scans + 1 AI Grade unlocked', 'gold');
                }
              } catch(e) { /* the seller can retry claiming the bonus */ }
            }
            if (!current()) return;
            try { document.getElementById('verifyEmailModal')?.remove(); } catch(e) {}
            try { _updateVerifyBanner?.(); } catch(e) {}
            await window.ensureMembershipAccount?.();
            if (!current()) return;
            try { checkProStatus?.(); } catch(e) {}
            try { applyGoogleUser?.(); } catch(e) {}
          } catch(e) { /* ignore transient errors; the next tick can retry */ }
          finally { verificationBusy = false; }
        }
        if (!effectiveVerified) {
          let attempts = 0;
          verificationTimer = setInterval(() => {
            if (!current() || ++attempts > 60) { clearInterval(verificationTimer); return; }
            void checkVerification();
          }, 5000);
          window._verifyPollInterval = verificationTimer;
          // A returned email link starts the check immediately, without holding
          // up the signed-in workspace while Firebase reloads the profile.
          if (window._pendingVerifiedReturn) {
            window._pendingVerifiedReturn = false;
            void checkVerification();
          }
        }

        const _providers = (user.providerData || []).map(p => p?.providerId || '?').join(',');
        _updateAuthDebug('AUTH OK: ' + (effectiveEmail || '(no email)').slice(0,30) + '\nuid=' + user.uid.slice(0,8) + ' | providers=' + _providers);
        // Apply UI immediately — don't wait for token
        applyGoogleUser();
        // Drop the post-signin grace period (see safety net near top of file).
        try { window._resolveAuthGrace && window._resolveAuthGrace(); } catch(e) {}
        // Fetch token async — doesn't block UI or checkout
        user.getIdToken().then(async token => {
          if (!current()) return;
          if (typeof token !== 'string' || !token.trim()) return;
          // Verification or a user action may already have supplied a newer
          // token while this initial request was waiting.
          if (!window._googleIdToken) window._googleIdToken = token;
          // Refresh token every 55 min
          clearInterval(window._tokenRefreshInterval);
          window._tokenRefreshInterval = setInterval(() => {
            if (!current()) return;
            const before = window._googleIdToken;
            user.getIdToken(true).then(fresh => {
              if (current() && window._googleIdToken === before && typeof fresh === 'string' && fresh.trim()) window._googleIdToken = fresh;
            }).catch(() => {});
          }, 55 * 60 * 1000);
          loadUserData();
          await window.ensureMembershipAccount?.();
          if (!current()) return;
          checkProStatus();
          if (document.getElementById('settingsPanel')?.classList.contains('open')) {
            loadSettingsScanCredits();
          }
        }).catch(() => {});
        // Close auth modal if open — UNLESS we're mid-signup and showing the
        // "Check your inbox" view. Otherwise a fresh unverified signup silently
        // closes the modal and looks like a blank/broken flow.
        if (!window._authJustSignedUp) {
          closeAuthModal();
        }
        // Handle ?next= redirect from sign-in page
        // The app consumes the allowlisted destination once and preserves
        // unrelated return/campaign parameters. Check ownership after the
        // delay so an intervening sign-out cannot reopen a private task.
        setTimeout(() => {
          if (current()) window._crResumeSignInTask?.();
        }, 300);
        // Handle deferred pricing-page upgrade intent. If the visitor arrived
        // from /pricing.html?upgrade=pro and completed sign-in, pop the
        // pricing modal so the CTA doesn't get lost.
        try {
          const pendingTier = window._pendingUpgradeTier || sessionStorage.getItem('_pendingUpgradeTier');
          if (pendingTier) {
            sessionStorage.removeItem('_pendingUpgradeTier');
            window._pendingUpgradeTier = null;
            setTimeout(() => {
              if (!current()) return;
              try { window.openPricingModal && window.openPricingModal('pricing_page_' + pendingTier); } catch(_){}
              try { window._applyPendingUpgradeInterval && window._applyPendingUpgradeInterval(); } catch(_){}
            }, 500);
          }
        } catch(_){}
      } else {
        // A real SDK sign-out (including another tab) clears the workspace.
        // Ignore only a stale callback while the SDK still has a signed-in user.
        if (auth.currentUser && !window._signOutIntent) {
          window._authInitialized = true;
          _updateAuthDebug('AUTH NULL (stale callback ignored)');
          return;
        }
        _updateAuthDebug(window._signOutIntent ? 'AUTH NULL (sign-out)' : 'AUTH NULL (no user)');
        window._signOutIntent = false;
        _clearAuthIdentity();
      }
    });
