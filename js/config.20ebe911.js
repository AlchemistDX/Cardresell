
// CardResell API Configuration (inlined — no separate file needed)
// TPL API key is NEVER shipped to the client. All TPL calls go through /api/tpl-proxy.
window.CARDSELL_TPL_KEY = '__PROXIED__'; // sentinel — real key stays server-side
window.CARDSELL_EPN_CAMPID = '5339158497';
// Capture referral code from URL on page load
// 2026-08-18: BUGFIX — the sign-in redirect chain (/ → /signin → email
// verify link → /?verified=1) drops the ?ref=<code> query param. Result:
// zero referrals had ever been claimed in prod (ref_count:* was empty).
// Fix: persist the ref code to localStorage when a user lands on /?ref=X,
// then read from storage as fallback in checkProStatus() so the claim
// still fires after the full auth round-trip.
(function() {
  const p = new URLSearchParams(window.location.search);
  const ref = p.get('ref');
  if (ref) {
    const clean = ref.slice(0, 16);
    window._pendingRefCode = clean;
    try {
      // 30-day TTL. If user clicks ref link but doesn't sign up for weeks,
      // still credit the referrer.
      const payload = { code: clean, ts: Date.now() };
      localStorage.setItem('_pendingRefCode', JSON.stringify(payload));
    } catch(e) {}
  } else {
    // No ref in URL — restore from localStorage if we saved one earlier.
    // This is what fires after the /signin redirect chain drops the query.
    try {
      const raw = localStorage.getItem('_pendingRefCode');
      if (raw) {
        const parsed = JSON.parse(raw);
        const ageMs = Date.now() - (parsed.ts || 0);
        // Discard after 30 days
        if (parsed.code && ageMs < 30 * 24 * 60 * 60 * 1000) {
          window._pendingRefCode = String(parsed.code).slice(0, 16);
        } else {
          localStorage.removeItem('_pendingRefCode');
        }
      }
    } catch(e) {}
  }
  // Applies a handed-over billing interval right after the pricing modal opens.
  // Defined unconditionally (NOT inside the ?upgrade= branch) because
  // startTierCheckout() re-stashes an interval when a signed-out user clicks a
  // plan, and that round-trip has no upgrade param — scoping this inside the
  // branch would silently drop the interval on exactly that path. Reads
  // sessionStorage rather than a closure so every caller behaves identically.
  window._applyPendingUpgradeInterval = function () {
    let want = null;
    try { want = sessionStorage.getItem('_pendingUpgradeInterval'); } catch(_){}
    want = want || window._pendingUpgradeInterval;
    try { sessionStorage.removeItem('_pendingUpgradeInterval'); } catch(_){}
    window._pendingUpgradeInterval = null;
    if (want && typeof window.setPricingMode === 'function') {
      try { window.setPricingMode(want === 'annual' ? 'annual' : 'monthly'); } catch(_){}
    }
  };

  // If arriving from /pricing.html with ?upgrade=pro (or pro_max, ultimate),
  // stash the target tier and auto-open the pricing modal once auth resolves.
  //
  // 2026-09-01 (CR-013): the old comment here claimed "signed-out users get
  // the sign-in dialog first". They did not — nothing triggered that dialog,
  // and the poll below additionally required a signed-in uid, so a signed-out
  // visitor who clicked a plan on /pricing landed on the app and got NOTHING:
  // no modal, no sign-in prompt, params silently stripped. Confirmed in a live
  // browser. openPricingModal() needs no auth, and startTierCheckout() already
  // routes signed-out users into sign-in, so we now open the modal for
  // everyone once auth state has settled.
  const upgradeParam = (p.get('upgrade') || '').toLowerCase();
  if (['pro','pro_max','ultimate'].includes(upgradeParam)) {
    const supportedTier = upgradeParam === 'ultimate' ? 'pro_max' : upgradeParam;
    window._pendingUpgradeTier = supportedTier;
    try { sessionStorage.setItem('_pendingUpgradeTier', supportedTier); } catch(_){}
    if (upgradeParam === 'ultimate') {
      setTimeout(() => {
        try { showToast('Ultimate was retired. Pro Max now includes all 15 venues.', 'info'); } catch(_){}
      }, 0);
    }
    // 2026-09-01 (CR-013): /pricing appends &p=annual when the visitor picked
    // Annual. Carry it through the same deferred round-trip as the tier so the
    // modal opens on the interval they were actually quoted.
    const wantAnnual = (p.get('p') || '').toLowerCase() === 'annual';
    window._pendingUpgradeInterval = wantAnnual ? 'annual' : 'monthly';
    try { sessionStorage.setItem('_pendingUpgradeInterval', wantAnnual ? 'annual' : 'monthly'); } catch(_){}
    try {
      p.delete('p');
      p.delete('upgrade');
      const clean = window.location.pathname + (p.toString() ? '?' + p.toString() : '') + window.location.hash;
      window.history.replaceState({}, '', clean);
    } catch(_){}
    // Fallback: even if auth resolves before openPricingModal is defined, poll
    // briefly for the fn and fire once. Auth-triggered path (in onAuthStateChanged)
    // clears sessionStorage first, so this is a no-op when that path wins.
    (function pollForModal(tries) {
      if (!sessionStorage.getItem('_pendingUpgradeTier')) return;
      if (tries > 40) return; // 20s max
      // Gate on _authInitialized only (set on the signed-out branch too), NOT
      // on a uid — requiring a uid is what made this silently no-op.
      if (typeof window.openPricingModal === 'function' && window._authInitialized) {
        const t = sessionStorage.getItem('_pendingUpgradeTier');
        sessionStorage.removeItem('_pendingUpgradeTier');
        window._pendingUpgradeTier = null;
        try { window.openPricingModal('pricing_page_' + t); } catch(_){}
        try { window._applyPendingUpgradeInterval && window._applyPendingUpgradeInterval(); } catch(_){}
        return;
      }
      setTimeout(() => pollForModal(tries + 1), 500);
    })(0);
  }

  // 2026-09-01 (CR-008): /pricing.html lists the six one-time credit packs and
  // links each card here with ?packs=id or ?packs=grade. The packs live inside
  // the pricing modal, so this reuses the same deferred-open machinery as
  // ?upgrade= above: stash the intent, strip the param, then poll for both
  // openPricingModal and a resolved auth state before firing once. Buying a
  // pack requires a signed-in user, so waiting on auth is deliberate rather
  // than opening a modal whose buttons would immediately bounce them.
  const packsParam = (p.get('packs') || '').toLowerCase();
  if (['id', 'grade'].includes(packsParam)) {
    try { sessionStorage.setItem('_pendingPacksFocus', packsParam); } catch(_){}
    try {
      p.delete('packs');
      const clean = window.location.pathname + (p.toString() ? '?' + p.toString() : '') + window.location.hash;
      window.history.replaceState({}, '', clean);
    } catch(_){}
    (function pollForPacks(tries) {
      let want; try { want = sessionStorage.getItem('_pendingPacksFocus'); } catch(_){ want = packsParam; }
      if (!want) return;
      if (tries > 40) return; // 20s ceiling, same as the upgrade path
      // 2026-09-02 (CR-021): this used to open the PLAN modal and then scroll to
      // #gradeCreditsBuy / #idCreditsBuy — elements that live inside the closed
      // gear settings panel. So /pricing's "buy packs" links dumped users on a
      // subscription chooser with no packs on it, and the scroll target was
      // never visible. Route straight to the shop modal on the right tab.
      if (typeof window.openShop === 'function' && window._authInitialized) {
        try { sessionStorage.removeItem('_pendingPacksFocus'); } catch(_){}
        try { window.openShop(want, 'pricing_page_packs'); } catch(_){}
        return;
      }
      setTimeout(() => pollForPacks(tries + 1), 500);
    })(0);
  }

  // 2026-09-01 (CR-015): /photo-tips/ used to soft-fall-through to this page,
  // so the link on /accuracy quietly returned the homepage. The photo-tips
  // content only ever existed as an in-app overlay, so vercel.json now 308s
  // /photo-tips/ to ?photo_tips=1 and we open that overlay here. No auth or
  // scan state is required to read the tips, so this fires as soon as the
  // opener is defined.
  if (p.get('photo_tips') === '1') {
    try {
      p.delete('photo_tips');
      const clean = window.location.pathname + (p.toString() ? '?' + p.toString() : '') + window.location.hash;
      window.history.replaceState({}, '', clean);
    } catch(_){}
    (function pollForTips(tries) {
      if (tries > 40) return; // 20s ceiling
      if (typeof window.openPhotoTipsModal === 'function') {
        try { window.openPhotoTipsModal(); } catch(_){}
        return;
      }
      setTimeout(() => pollForTips(tries + 1), 500);
    })(0);
  }

  // If arriving from the Firebase verification link (?verified=1), strip the
  // param so it doesn't stick in the URL bar, and set a flag so the auth-init
  // handler knows to reload the user token and claim the bonus.
  if (p.get('verified') === '1') {
    window._pendingVerifiedReturn = true;
    try {
      p.delete('verified');
      const clean = window.location.pathname + (p.toString() ? '?' + p.toString() : '') + window.location.hash;
      window.history.replaceState({}, '', clean);
    } catch(e) {}
  }

  // SAFETY NET: if signin.html redirected us here right after a successful
  // sign-in, Firebase's IDB write may still be committing. Hide the "Sign In"
  // button in the header for up to 2.5s while onAuthStateChanged catches up.
  // Without this, the header flashes as signed-out and confuses the user even
  // though the account is authenticated (or is about to be).
  try {
    const ts = parseInt(sessionStorage.getItem('_fbJustSignedIn') || '0', 10);
    if (ts && (Date.now() - ts) < 15000) {
      window._pendingAuthGrace = true;
      // Clear so a manual refresh a minute later doesn't re-hide the button.
      sessionStorage.removeItem('_fbJustSignedIn');
      // Inject an early CSS rule so the sign-in button is hidden from first paint.
      const style = document.createElement('style');
      style.id = '_authGraceStyle';
      style.textContent = '#googleSignInBtn{visibility:hidden!important}';
      (document.head || document.documentElement).appendChild(style);
      // Fallback timeout: after 2.5s, drop the style regardless so we never
      // permanently hide the button if onAuthStateChanged fails to fire.
      setTimeout(() => {
        const s = document.getElementById('_authGraceStyle');
        if (s) s.remove();
        window._pendingAuthGrace = false;
      }, 2500);
      // Also expose a resolver so the auth handler can drop the style as soon
      // as it knows the answer (either signed-in or truly signed-out).
      window._resolveAuthGrace = () => {
        const s = document.getElementById('_authGraceStyle');
        if (s) s.remove();
        window._pendingAuthGrace = false;
      };
    }
  } catch(e) {}
})();
window.CARDSELL_TCGP_AFFID = '';
window.CARDSELL_SCANNER_KEY = '';
window.CARDSELL_GOOGLE_CLIENT_ID = '971593505703-6feq3nn7p9580krori6r157rfm5tp88l.apps.googleusercontent.com';
// PokemonTCG.io API key — free at dev.pokemontcg.io (raises limit from 1k to 20k/day)
window.CARDSELL_PTCG_KEY = ''; // <-- paste your key here
// ─── AFFILIATE CONFIG — single source of truth ───
// Every affiliate merchant is declared here. Each merchant has:
//   enabled: false until we have a real tracking ID (buildXxxUrl returns raw URL when disabled)
//   ...credentials specific to that network
// When an approval email comes in, flip enabled=true and paste the ID. Done.
window.AFFILIATE = {

  // eBay Partner Network — LIVE
  ebay: {
    enabled: true,
    campid:  '5339158497',
    toolid:  '10001',
    customid:'cardsell'
  },

  // TCGPlayer via Impact.com — APPROVED Jul 11, 2026 · 3.5% Order Received
  // Deep-link format: https://partner.tcgplayer.com/c/<PARTNER_ID>/<CAMPAIGN_ID>/<AD_ID>?u=<encodeURIComponent(target_url)>
  tcgplayer: {
    enabled:     true,
    partner_id:  '7445683',
    campaign_id: '1780961',
    ad_id:       '21018',
    subid:       'cardresell'  // for reporting — safe to leave as-is
  },

  // BCW Supplies direct affiliate — application PENDING (Jul 2, 2026)
  // BCW has two paths: pay-per-click ($0.02/unique click) via a tracked link,
  // AND 5% commission via a coupon code shown to users.
  bcw: {
    enabled:      false,
    link_url:     '',   // e.g. https://www.bcwsupplies.com/?aff=xxxxx — paste when approved
    coupon_code:  '',   // e.g. CARDRESELL10 — shown to users to trigger the 5% path
    coupon_pct:   5     // percent off / commission per sale
  },

  // Grading services — plain links today, will become referral links if programs approve
  psa: { enabled: false, link_url: 'https://www.psacard.com/submit' },
  cgc: { enabled: false, link_url: 'https://www.cgccards.com/submit/' },
  bgs: { enabled: false, link_url: 'https://www.beckett.com/grading/submit' },
  sgc: { enabled: false, link_url: 'https://www.gosgc.com/submit-cards' }
};

// ── Legacy globals for backward-compatibility with older call-sites ──
// (New code should read from window.AFFILIATE directly.)
window.CARDSELL_EPN_CAMPID     = window.AFFILIATE.ebay.campid;
window.CARDSELL_TCGP_AFFID     = '';  // legacy — Impact uses a different scheme
window.CARDSELL_AFFIL_PSA      = window.AFFILIATE.psa.link_url;
window.CARDSELL_AFFIL_BCW      = window.AFFILIATE.bcw.link_url;
window.CARDSELL_AFFIL_BCW_CODE = window.AFFILIATE.bcw.coupon_code;
window.CARDSELL_AFFIL_CGC      = window.AFFILIATE.cgc.link_url;
window.CARDSELL_AFFIL_BGS      = window.AFFILIATE.bgs.link_url;
window.CARDSELL_AFFIL_SGC      = window.AFFILIATE.sgc.link_url;
