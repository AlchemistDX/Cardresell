
// ── Auth Modal Controller ──
function openAuthModal(view) {
  view = view || 'signin';
  if (!window._fbAuth) { window._pendingAuthModal = view; return; }
  const overlay = document.getElementById('authModalOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    showAuthView(view);
    setTimeout(() => { const f = overlay.querySelector('.auth-input'); if (f) f.focus(); }, 100);
  }
}
function closeAuthModal() {
  const overlay = document.getElementById('authModalOverlay');
  if (overlay) overlay.style.display = 'none';
  ['authSignInEmail','authSignInPass','authSignUpEmail','authSignUpPass','authSignUpPass2','authForgotEmail'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['authSignInError','authSignUpError','authForgotError','authForgotSuccess'].forEach(id => { const el = document.getElementById(id); if (el) { el.style.display = 'none'; el.textContent = ''; } });
}
function showAuthView(view) {
  ['authViewSignIn','authViewSignUp','authViewForgot','authViewVerify'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  const map = { signin: 'authViewSignIn', signup: 'authViewSignUp', forgot: 'authViewForgot', verify: 'authViewVerify' };
  const t = document.getElementById(map[view]); if (t) t.style.display = '';
  // When landing on the verify view, render the Turnstile widget so the
  // token is ready by the time the user clicks "claim bonus". Safe no-op
  // when Turnstile isn't configured (empty site-key meta).
  if (view === 'verify') setTimeout(() => window._tsRenderInto?.('authVerifyTurnstile'), 0);
}
function _authError(elId, msg) { const el = document.getElementById(elId); if (!el) return; el.textContent = msg; el.style.display = ''; }
function _authClearError(elId) { const el = document.getElementById(elId); if (el) { el.style.display = 'none'; el.textContent = ''; } }

async function doEmailSignIn() {
  const email = document.getElementById('authSignInEmail')?.value?.trim();
  const pass  = document.getElementById('authSignInPass')?.value;
  _authClearError('authSignInError');
  if (!email || !pass) return _authError('authSignInError', 'Please enter your email and password.');
  const btn = document.getElementById('authSignInBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in...'; }
  try {
    await window._fbEmailSignIn(email, pass);
  } catch(e) {
    _authError('authSignInError', _fbErrMsg(e));
    if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
  }
}
async function doEmailSignUp() {
  const email = document.getElementById('authSignUpEmail')?.value?.trim();
  const pass  = document.getElementById('authSignUpPass')?.value;
  const pass2 = document.getElementById('authSignUpPass2')?.value;
  _authClearError('authSignUpError');
  if (!email || !pass) return _authError('authSignUpError', 'Please fill in all fields.');
  if (pass.length < 6) return _authError('authSignUpError', 'Password must be at least 6 characters.');
  if (pass !== pass2) return _authError('authSignUpError', "Passwords don't match.");
  const btn = document.getElementById('authSignUpBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating account...'; }
  try {
    // Flag BEFORE creating the user so onAuthStateChanged doesn't auto-close
    // the modal the moment Firebase notices we're signed in. We WANT the
    // modal to stay open on the verify screen until they either verify or
    // dismiss it manually.
    window._authJustSignedUp = true;
    await window._fbEmailSignUp(email, pass);
    // Fire the verification email. Non-fatal if it fails — they can use the
    // "Resend verification email" button on the verify view.
    try { await window._fbSendVerification?.(); } catch(e) { /* non-fatal */ }
    // Populate + show the verify view.
    const tgt = document.getElementById('authVerifyEmail');
    if (tgt) tgt.textContent = email;
    showAuthView('verify');
  } catch(e) {
    // Signup itself failed — clear the flag so the modal behaves normally.
    window._authJustSignedUp = false;
    _authError('authSignUpError', _fbErrMsg(e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
  }
}

// Called from the verify view's "Resend" button.
async function doAuthResendVerification() {
  const btn = document.getElementById('authVerifyResendBtn');
  const ok  = document.getElementById('authVerifySuccess');
  const err = document.getElementById('authVerifyError');
  if (ok)  { ok.style.display  = 'none'; ok.textContent  = ''; }
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    await window._fbSendVerification?.();
    if (ok) { ok.textContent = 'Verification email sent — check your inbox.'; ok.style.display = ''; }
    if (btn) { btn.textContent = 'Email sent ✓'; setTimeout(() => { btn.disabled = false; btn.textContent = 'Resend verification email'; }, 5000); }
  } catch(e) {
    if (err) { err.textContent = _fbErrMsg(e); err.style.display = ''; }
    if (btn) { btn.disabled = false; btn.textContent = 'Resend verification email'; }
  }
}

// Called from the verify view's "I've verified — claim bonus" button.
// Refreshes the Firebase token so email_verified is up-to-date, then hits
// the server to grant the signup bonus (server checks token.email_verified
// plus per-user + per-email dedupe).
async function doAuthCheckVerified() {
  const btn = document.getElementById('authVerifyCheckBtn');
  const err = document.getElementById('authVerifyError');
  const ok  = document.getElementById('authVerifySuccess');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  if (ok)  { ok.style.display  = 'none'; ok.textContent  = ''; }
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try {
    // Force-refresh the current user + ID token so Firebase picks up the
    // recently-flipped emailVerified claim.
    try { await window._fbReloadUser?.(); } catch(e) {}
    const user = window._fbAuth?.currentUser;
    if (!user) throw new Error('No signed-in user — please sign in again.');
    if (!user.emailVerified) {
      throw Object.assign(new Error("Not verified yet — click the link in your email, then try again."), { code: 'not_verified' });
    }
    const tok = await user.getIdToken(true);
    const turnstileToken = window._tsGetToken?.('authVerifyTurnstile') || '';
    const resp = await fetch('/api/verify-claim-firebase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify({ turnstileToken }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Verification failed. Please retry.');
    // Bonus granted (or already granted) — close the modal, migrate any anon
    // data, refresh scan-credit UI.
    window._authJustSignedUp = false;
    if (ok) { ok.textContent = data.bonusGranted ? 'Bonus unlocked! Enjoy your 10 free ID scans.' : 'Verified.'; ok.style.display = ''; }
    try { window._migrateAnonDataToUser?.(); } catch(e) {}
    setTimeout(() => { closeAuthModal(); }, 900);
  } catch(e) {
    if (err) { err.textContent = (e && e.message) || 'Verification check failed.'; err.style.display = ''; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'I\u2019ve verified \u2014 claim bonus'; }
    try { window._tsReset?.('authVerifyTurnstile'); } catch(e) {}
  }
}

// Sign the user out and return them to the sign-in view (used by the
// "Use a different account" link on the verify screen).
async function _authBackToSignIn() {
  try { await window._fbSignOut?.(); } catch(e) {}
  window._authJustSignedUp = false;
  showAuthView('signin');
}
async function doPasswordReset() {
  const email = document.getElementById('authForgotEmail')?.value?.trim();
  _authClearError('authForgotError');
  const s = document.getElementById('authForgotSuccess');
  if (s) { s.style.display = 'none'; s.textContent = ''; }
  if (!email) return _authError('authForgotError', 'Please enter your email address.');
  try {
    await window._fbResetPassword(email);
    if (s) { s.textContent = 'Reset email sent — check your inbox.'; s.style.display = ''; }
  } catch(e) { _authError('authForgotError', _fbErrMsg(e)); }
}
// ── Full-screen search results modal ──
function openSearchModal() {
  const q = searchInput.value.trim();
  if (!q) return;
  clearTimeout(searchTimeout);
  const modal = document.getElementById('searchResultsModal');
  const grid  = document.getElementById('searchModalGrid');
  const title = document.getElementById('searchModalTitle');
  if (!modal) return;

  title.textContent = `"${q}"`;
  document.getElementById('searchModalCount').textContent = '';
  grid.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;gap:.75rem;padding:3rem;color:#888;font-size:.88rem"><span class="spinner" style="border-color:rgba(255,255,255,.12);border-top-color:#4dd9ac"></span> Searching…</div>';
  modal.style.display = 'flex';

  // 2026-08-15: clear stale drop rows so the fallback path below can't
  // resurrect a previous search's results.
  dropList.innerHTML = '';
  delete dropList.dataset.lastQuery;

  // Fire fresh search; doSearch resolves after dropList is populated
  doSearch(q).then(items => {
    if (items && items.length) {
      _renderCatalogFromDrop(q, items);
    } else {
      // Fallback: check dropList one more time (edge case) but only
      // accept rows that match the current query.
      const dropQ = (dropList.dataset.lastQuery || '').toLowerCase();
      const fallback = dropList.querySelectorAll('.drop-item');
      if (fallback.length && dropQ === q.toLowerCase()) {
        _renderCatalogFromDrop(q, fallback);
      } else {
        grid.innerHTML = '<div style="padding:3rem;text-align:center;color:#666;font-size:.88rem">No results found</div>';
      }
    }
  });
}

function openCatalog(q) {
  if (q) searchInput.value = q;
  const term = (q || searchInput.value.trim() || '').toLowerCase();
  const cachedQ = (dropList.dataset.lastQuery || '').toLowerCase();
  const cachedGame = dropList.dataset.lastGame || '';
  const existing = dropList.querySelectorAll('.drop-item');
  // 2026-08-15: only reuse dropList results when they belong to THIS query.
  // Prevents cross-search contamination where typing "Pidove" shows stale
  // "Latias ex" rows because dropList still holds the previous search.
  const cacheValid = existing.length && cachedQ === term && cachedGame === activeGame;
  if (cacheValid) {
    // Results already in dropList — render directly, no extra fetch
    const modal = document.getElementById('searchResultsModal');
    const title = document.getElementById('searchModalTitle');
    document.getElementById('searchModalCount').textContent = '';
    if (modal) modal.style.display = 'flex';
    if (title) title.textContent = `"${q || searchInput.value.trim()}"`;
    _renderCatalogFromDrop(q || searchInput.value.trim(), existing);
  } else {
    const rawTerm = q || searchInput.value.trim();
    if (!rawTerm) return;
    const modal = document.getElementById('searchResultsModal');
    const grid  = document.getElementById('searchModalGrid');
    const titleEl = document.getElementById('searchModalTitle');
    document.getElementById('searchModalCount').textContent = '';
    if (modal) modal.style.display = 'flex';
    if (titleEl) titleEl.textContent = `"${rawTerm}"`;
    // 2026-08-15: clear stale rows immediately — don't paint old results
    // through the loading state.
    if (grid) grid.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;gap:.75rem;padding:3rem;color:#888;font-size:.88rem"><span class="spinner" style="border-color:rgba(255,255,255,.12);border-top-color:#4dd9ac"></span> Searching…</div>';
    // Also blank dropList so the fallback below can't reuse pre-search rows.
    dropList.innerHTML = '';
    delete dropList.dataset.lastQuery;
    doSearch(rawTerm).then(items => {
      if (items && items.length) {
        _renderCatalogFromDrop(rawTerm, items);
      } else {
        // Only use dropList as fallback if doSearch itself just populated
        // it (query match), otherwise no results.
        const dropQ = (dropList.dataset.lastQuery || '').toLowerCase();
        const fallback = dropList.querySelectorAll('.drop-item');
        if (fallback.length && dropQ === rawTerm.toLowerCase()) {
          _renderCatalogFromDrop(rawTerm, fallback);
        } else if (grid) {
          grid.innerHTML = '<div style="padding:3rem;text-align:center;color:#666;font-size:.88rem">No results found</div>';
        }
      }
    });
  }
}

function _renderCatalogFromDrop(q, items) {
  if (!items.length) {
    document.getElementById('searchModalGrid').innerHTML =
      '<div style="padding:3rem;text-align:center;color:#666;font-size:.88rem">No results found</div>';
    return;
  }
  _storeCatalogRows(items);
  _applyFilters();
  dropList.classList.remove('open');
}

function _openSearchResultsModal(q) { openSearchModal(); }


// ── Catalog filter state ──
window._catAllRows  = [];   // [{idx, name, setLine, subLine, price, img, priceNum, rarity}]
window._catFilter   = { set: '', rarity: '' };
window._catPriceDir = 0;    // 0=none 1=asc -1=desc
// View mode for search results: 'grid' (big card tiles, IMG_3855 style)
// or 'list' (dense row, IMG_3854 style). Default grid for collector feel.
window._catViewMode = (function(){ try { return localStorage.getItem('cr_catViewMode') || 'grid'; } catch(e) { return 'grid'; } })();
// Sync chip icon to loaded mode on next tick (element may not exist yet at parse time).
setTimeout(() => { const _ic = document.getElementById('chipViewIcon'); if (_ic) _ic.innerHTML = window._catViewMode === 'grid' ? '&#9638;' : '&#9776;'; }, 0);

function _storeCatalogRows(items) {
  window._catAllRows = Array.from(items).map(item => {
    const idx   = item.dataset.idx;
    const name  = (item.querySelector('.drop-name')?.textContent || '').trim();
    const meta  = (item.querySelector('.drop-meta')?.textContent || '').trim().replace(/\bTPL\b|\bJP\b|\[EN ref\]/gi, '').trim();
    const price = (item.querySelector('.drop-price')?.textContent || '').trim();
    const img   = window._searchCards?.[idx]?._imgSmall
                || item.querySelector('img')?.src
                || window._searchCards?.[idx]?._tpl?.image_url
                || '';
    const cardNum  = item.dataset.number || '';
    const cardSet  = item.dataset.set || '';
    const cardRarity = item.dataset.rarity || '';
    const metaParts = meta.split('·').map(s => s.trim()).filter(Boolean);
    const setLine   = cardSet || metaParts[0] || '';
    const subLine   = [cardNum ? '#'+cardNum : '', cardRarity].filter(Boolean).join(' · ');
    const priceNum  = parseFloat(price.replace(/[^0-9.]/g,'')) || 0;
    return { idx, name, setLine, subLine, price, img, priceNum, cardNum, cardSet, cardRarity };
  });
  // Reset filters on new search
  window._catFilter   = { set: '', rarity: '', number: '' };
  window._catPriceDir = 0;
  document.getElementById('chipSetVal').textContent    = '';
  document.getElementById('chipRarityVal').textContent = '';
  document.getElementById('chipNumberVal').textContent = '';
  document.getElementById('chipPriceVal').innerHTML    = '&#8597;';
  document.getElementById('chipSet').classList.remove('active');
  document.getElementById('chipRarity').classList.remove('active');
  document.getElementById('chipNumber').classList.remove('active');
  document.getElementById('chipPrice').classList.remove('active');
}

function _applyFilters() {
  let rows = [...window._catAllRows];
  const { set, rarity } = window._catFilter;
  if (set)    rows = rows.filter(r => r.cardSet.toLowerCase().includes(set.toLowerCase()));
  if (rarity) rows = rows.filter(r => r.cardRarity.toLowerCase().includes(rarity.toLowerCase()));
  if (window._catFilter.number) rows = rows.filter(r => r.cardNum.toLowerCase().includes(window._catFilter.number.toLowerCase()));
  if (window._catPriceDir === 1)  rows.sort((a,b) => a.priceNum - b.priceNum);
  if (window._catPriceDir === -1) rows.sort((a,b) => b.priceNum - a.priceNum);
  const grid  = document.getElementById('searchModalGrid');
  const count = document.getElementById('searchModalCount');
  count.textContent = rows.length + ' card' + (rows.length === 1 ? '' : 's');
  grid.innerHTML = '';
  const mode = window._catViewMode || 'grid';
  if (mode === 'grid') {
    // 2-column card-tile grid — IMG_3855 style. Big art, name + set + price
    // stacked underneath. Better for collectors who ID cards by art.
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
    grid.style.gap = '.65rem';
    grid.style.padding = '.7rem .7rem 5rem';
    rows.forEach(r => grid.appendChild(_makeCatalogGridCell(r)));
  } else {
    // Tight row list — IMG_3854 style. Denser, better for price scanning.
    grid.style.display = 'block';
    grid.style.gridTemplateColumns = '';
    grid.style.gap = '';
    grid.style.padding = '0 0 5rem';
    rows.forEach(r => grid.appendChild(_makeCatalogRow(r)));
  }
}

// Grid tile renderer — big card art (5/7 aspect), name + set + price under.
// Used when window._catViewMode === 'grid' (default). See _makeCatalogRow
// for the tight-list variant.
function _makeCatalogGridCell(r) {
  const cell = document.createElement('div');
  cell.dataset.idx = r.idx;
  cell.style.cssText = 'background:#0d0d0d;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:.6rem;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .15s,border-color .15s;display:flex;flex-direction:column';
  cell.innerHTML = `
    <div style="aspect-ratio:5/7;width:100%;background:#1a1a1a;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;margin-bottom:.55rem;position:relative">
      ${r.img
        ? `<img src="${r.img}" loading="lazy" style="width:100%;height:100%;object-fit:contain" onerror="this.style.display='none'">`
        : '<span style="font-size:2rem;opacity:.25">&#x1F0CF;</span>'}
    </div>
    <div style="font-size:.86rem;font-weight:700;color:#fff;line-height:1.25;margin-bottom:.15rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.15em">${r.name}</div>
    <div style="font-size:.7rem;color:#888;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.setLine}</div>
    ${r.subLine ? `<div style="font-size:.66rem;color:#555;line-height:1.3;margin-top:.05rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.subLine}</div>` : ''}
    <div style="font-size:.95rem;font-weight:800;color:#4dd9ac;margin-top:.4rem">${r.price || '<span style=\"color:#444;font-size:.75rem;font-weight:600\">&mdash;</span>'}</div>`;
  cell.addEventListener('click', () => {
    const orig = dropList.querySelector(`[data-idx="${r.idx}"]`);
    if (orig) orig.click();
    closeSearchModal();
  });
  cell.addEventListener('touchstart', () => { cell.style.background = '#151515'; cell.style.borderColor = 'rgba(77,217,172,.25)'; }, { passive: true });
  cell.addEventListener('touchend',   () => { cell.style.background = '#0d0d0d'; cell.style.borderColor = 'rgba(255,255,255,.06)'; }, { passive: true });
  return cell;
}

function _makeCatalogRow(r) {
  const row = document.createElement('div');
  row.dataset.idx = r.idx;
  row.style.cssText = 'display:flex;align-items:center;gap:.875rem;padding:.85rem 1rem;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.07);background:#000;-webkit-tap-highlight-color:transparent;transition:background .15s';
  row.innerHTML = `
    <div class="cat-img-area" style="flex-shrink:0;width:52px;height:72px;background:#1a1a1a;border-radius:5px;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative">
      ${r.img
        ? `<img src="${r.img}" loading="lazy" style="width:100%;height:100%;object-fit:contain" onerror="this.style.display='none'">`
        : '<span style="font-size:1.3rem;opacity:.3">&#x1F0CF;</span>'}
    </div>
    <div style="flex:1;min-width:0">
      <div style="font-size:.92rem;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.name}</div>
      <div style="font-size:.74rem;color:#888;margin-top:.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.setLine}</div>
      ${r.subLine ? `<div style="font-size:.7rem;color:#555;margin-top:.08rem">${r.subLine}</div>` : ''}
    </div>
    <div style="flex-shrink:0;text-align:right">
      <div style="font-size:.9rem;font-weight:700;color:#4dd9ac">${r.price || '<span style="color:#444;font-size:.75rem">&mdash;</span>'}</div>
    </div>`;
  row.addEventListener('click', () => {
    const orig = dropList.querySelector(`[data-idx="${r.idx}"]`);
    if (orig) orig.click();
    closeSearchModal();
  });
  row.addEventListener('touchstart', () => { row.style.background = '#111'; }, { passive: true });
  row.addEventListener('touchend',   () => { row.style.background = '#000'; }, { passive: true });
  return row;
}

function toggleCatalogChip(type) {
  const drop = document.getElementById('catalogChipDrop');
  // If same chip open, close it
  if (drop.dataset.open === type && drop.style.display !== 'none') {
    drop.style.display = 'none';
    drop.dataset.open = '';
    return;
  }
  // Build options from all rows
  const rows = window._catAllRows;
  let options = [];
  if (type === 'set') {
    options = [...new Set(rows.map(r => r.cardSet).filter(Boolean))].sort();
  } else if (type === 'rarity') {
    options = [...new Set(rows.map(r => r.cardRarity).filter(Boolean))].sort();
  } else {
    options = [...new Set(rows.map(r => r.cardNum).filter(Boolean))].sort((a,b) => a.localeCompare(b, undefined, {numeric:true}));
  }
  if (!options.length) return;
  const current = window._catFilter[type];
  drop.innerHTML = `<div class="chip-drop-item${!current?' selected':''}" style="color:#888" onclick="selectCatalogFilter('${type}','')">All ${type === 'set' ? 'Sets' : 'Rarities'}</div>`
    + options.map(o => `<div class="chip-drop-item${current===o?' selected':''}" onclick="selectCatalogFilter('${type}','${o.replace(/'/g,"\\'")}')">${o}</div>`).join('');
  // Position below filter bar
  const bar = document.getElementById('catalogFilterBar');
  const barBottom = bar.getBoundingClientRect().bottom;
  drop.style.top = barBottom + 'px';
  drop.style.display = 'block';
  drop.dataset.open = type;
}

function selectCatalogFilter(type, value) {
  window._catFilter[type] = value;
  const chipValEl = document.getElementById(type === 'set' ? 'chipSetVal' : type === 'rarity' ? 'chipRarityVal' : 'chipNumberVal');
  const chipEl    = document.getElementById(type === 'set' ? 'chipSet'    : type === 'rarity' ? 'chipRarity'    : 'chipNumber');
  if (value) {
    const short = value.length > 14 ? value.slice(0,13) + '…' : value;
    chipValEl.textContent = ': ' + short;
    chipEl.classList.add('active');
  } else {
    chipValEl.textContent = '';
    chipEl.classList.remove('active');
  }
  document.getElementById('catalogChipDrop').style.display = 'none';
  document.getElementById('catalogChipDrop').dataset.open = '';
  _applyFilters();
}

// Toggle between grid (big card tiles) and list (dense row) view.
// Preference persists to localStorage so it sticks across sessions.
function toggleCatalogView() {
  const cur = window._catViewMode || 'grid';
  const next = cur === 'grid' ? 'list' : 'grid';
  window._catViewMode = next;
  try { localStorage.setItem('cr_catViewMode', next); } catch(e) {}
  const icon = document.getElementById('chipViewIcon');
  if (icon) icon.innerHTML = next === 'grid' ? '&#9638;' : '&#9776;';
  _applyFilters();
}

function cyclePriceSort() {
  window._catPriceDir = window._catPriceDir === 0 ? -1 : window._catPriceDir === -1 ? 1 : 0;
  const el = document.getElementById('chipPriceVal');
  const chip = document.getElementById('chipPrice');
  if (window._catPriceDir === -1) { el.innerHTML = '&#8595;'; chip.classList.add('active'); }
  else if (window._catPriceDir === 1) { el.innerHTML = '&#8593;'; chip.classList.add('active'); }
  else { el.innerHTML = '&#8597;'; chip.classList.remove('active'); }
  _applyFilters();
}

function closeSearchModal() {
  const modal = document.getElementById('searchResultsModal');
  if (modal) modal.style.display = 'none';
}

function _fbErrMsg(e) {
  const map = {
    'auth/invalid-email': 'Invalid email address.',
    'auth/user-not-found': 'No account found with that email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts — please try again later.',
    'auth/network-request-failed': 'Network error — check your connection.',
    'auth/popup-blocked': 'Pop-up blocked — please allow pop-ups and try again.',
  };
  return map[e.code] || e.message || 'Something went wrong. Please try again.';
}


/* =========================================================
   BULK GRADE MODE (Pro Max / Ultimate)
   Grades up to 25 cards via /api/scan?mode=grade with
   concurrency=2 (Ximilar sync grader is ~3-8s per call).
   Each card debits 1 grade credit; refunds happen server-side
   on failure (same as the single-grade path).
   ========================================================= */

window._bulkGradeQueue      = [];   // Quick: [{file, objectUrl}]; Deep: [{front:{file,objectUrl}, back:{file,objectUrl}}]
window._bulkGradeResults    = [];   // [{success, cardName, grades:{final,corners,edges,surface,centering}, rawPrice, gradedPrice, roi, error}]
window._bulkGradeProcessing = false;
window._bulkGradeMode       = 'quick'; // 'quick' | 'deep'
window._bulkGradeCap        = 25;   // hard cap per session (quick); deep is 10

/* Bulk mode picker — opens from the single "Bulk" sub-row button. */
function openBulkModePicker() {
  if (!window.googleUser) {
    showToast('Sign in with Google first for Bulk mode');
    triggerGoogleSignIn && triggerGoogleSignIn();
    return;
  }
  const ov = document.getElementById('bulkModePickerOverlay');
  if (ov) ov.style.display = 'flex';
  try { window.trackEvent && window.trackEvent('bulk_mode_picker_open', {}); } catch(_){}
}
function closeBulkModePicker() {
  const ov = document.getElementById('bulkModePickerOverlay');
  if (ov) ov.style.display = 'none';
}

/* ── Reusable Live Camera Capture ────────────────────────────────
   openLiveCameraCapture({ label, sublabel, onCapture, onCancel })

   One-shot live camera overlay for grade flows. Shows a viewfinder with
   the same dashed card guide + live QA hints as Rapid Scan, but instead
   of queueing multiple photos, it takes ONE, hands it to onCapture(file),
   and closes.

     label     — big slot label at top ("Front photo", "Right edge", etc.)
     sublabel  — optional smaller hint under it
     onCapture — required. Called with the captured File
     onCancel  — optional. Called if the user backs out.

   Uses the same _bulkRapidQATick analyzer (imported by DOM id reuse: we
   swap the video/frame/pill element ids for the shared ones by mounting
   into a distinct overlay but pointing the analyzer at the same DOM ids).

   Falls back to onCancel + native camera picker if getUserMedia fails.
   ==================================================================== */
window._liveCapState = { active: false, stream: null, onCapture: null, onCancel: null };

/* ── Shared camera-zoom helper ──────────────────────────────────────────
   2026-08-31: User asked for pinch-to-zoom on the camera flows. iOS
   Safari and Chromium expose MediaStreamTrack.getCapabilities().zoom on
   the back camera on most modern phones. We bind pinch-to-zoom on the
   video element AND drive a visible slider so users who don't discover
   pinch still have an obvious control.

     video         — the <video> element
     stream        — the active MediaStream
     sliderEl      — the <input type=range> element (optional)
     labelEl       — an element whose textContent shows "1.0x" (optional)
     wrapEl        — the container that shows/hides the slider (optional)

   Returns a teardown() that removes listeners. Safe no-op on browsers
   without zoom capability — wrapEl stays hidden, pinch just does nothing.
   ==================================================================== */
function _camZoomBind(video, stream, sliderEl, labelEl, wrapEl) {
  const noop = () => {};
  if (!stream || !video) return noop;
  const track = stream.getVideoTracks && stream.getVideoTracks()[0];
  if (!track || !track.getCapabilities) return noop;
  let caps = {};
  try { caps = track.getCapabilities() || {}; } catch(_) { caps = {}; }
  if (!('zoom' in caps)) {
    if (wrapEl) wrapEl.style.display = 'none';
    return noop;
  }
  const zMin = caps.zoom.min || 1;
  const zMax = Math.min(caps.zoom.max || 1, 5); // cap at 5x — anything higher is mush on phone glass
  const zStep = caps.zoom.step || 0.1;
  let cur = Math.max(zMin, Math.min(zMax, 1));
  if (zMax <= zMin + 0.01) { // camera exposes zoom but has zero range
    if (wrapEl) wrapEl.style.display = 'none';
    return noop;
  }
  if (wrapEl) wrapEl.style.display = 'flex';
  if (sliderEl) {
    sliderEl.min = String(zMin);
    sliderEl.max = String(zMax);
    sliderEl.step = String(zStep);
    sliderEl.value = String(cur);
  }
  const apply = (z) => {
    z = Math.max(zMin, Math.min(zMax, z));
    if (Math.abs(z - cur) < zStep / 2) return;
    cur = z;
    try { track.applyConstraints({ advanced: [{ zoom: z }] }); } catch(_) {}
    if (sliderEl) sliderEl.value = String(z);
    if (labelEl) labelEl.textContent = z.toFixed(1) + 'x';
  };
  const onSlider = () => apply(parseFloat(sliderEl.value));
  if (sliderEl) sliderEl.addEventListener('input', onSlider, { passive: true });
  // Pinch-to-zoom on the video element itself
  let baseDist = 0, baseZoom = cur;
  const dist = (t) => {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.hypot(dx, dy);
  };
  const onStart = (e) => {
    if (e.touches && e.touches.length === 2) {
      baseDist = dist(e.touches);
      baseZoom = cur;
    }
  };
  const onMove = (e) => {
    if (e.touches && e.touches.length === 2 && baseDist > 0) {
      e.preventDefault();
      const scale = dist(e.touches) / baseDist;
      apply(baseZoom * scale);
    }
  };
  const onEnd = () => { baseDist = 0; };
  video.addEventListener('touchstart', onStart, { passive: true });
  video.addEventListener('touchmove', onMove,  { passive: false });
  video.addEventListener('touchend',  onEnd,  { passive: true });
  video.addEventListener('touchcancel', onEnd, { passive: true });
  // Initialize label
  if (labelEl) labelEl.textContent = cur.toFixed(1) + 'x';
  return function teardown() {
    if (sliderEl) sliderEl.removeEventListener('input', onSlider);
    video.removeEventListener('touchstart', onStart);
    video.removeEventListener('touchmove',  onMove);
    video.removeEventListener('touchend',   onEnd);
    video.removeEventListener('touchcancel', onEnd);
  };
}

async function openLiveCameraCapture(opts) {
  const { label = 'Take photo', sublabel = '', onCapture, onCancel } = opts || {};
  if (!onCapture) { console.warn('[live-cap] onCapture required'); return; }

  // Native fallback if the browser has no getUserMedia at all
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (onCancel) onCancel('unsupported');
    return;
  }

  // Build overlay DOM lazily on first use
  let ov = document.getElementById('liveCapOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'liveCapOverlay';
    ov.style.cssText = 'display:none;position:fixed;inset:0;background:#000;z-index:320;flex-direction:column;overflow:hidden';
    ov.innerHTML =
      '<video id="liveCapVideo" playsinline autoplay muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000"></video>' +
      '<canvas id="liveCapCanvas" style="display:none"></canvas>' +
      '<div style="position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;justify-content:center">' +
        '<div id="liveCapFrame" style="width:min(72vw,320px);aspect-ratio:2.5/3.5;border:2.5px dashed rgba(196,122,0,.85);border-radius:14px;box-shadow:0 0 0 9999px rgba(0,0,0,.35);transition:border-color .18s,box-shadow .18s"></div>' +
      '</div>' +
      '<div id="liveCapQABar" style="position:absolute;bottom:120px;left:0;right:0;display:none;justify-content:center;padding:0 1rem;pointer-events:none">' +
        '<div id="liveCapQAPill" style="padding:.5rem .85rem;background:rgba(0,0,0,.75);border:1px solid rgba(255,255,255,.15);border-radius:99px;color:#fff;font-size:.72rem;font-weight:700;line-height:1.3;display:flex;align-items:center;gap:.4rem;box-shadow:0 4px 18px rgba(0,0,0,.45);max-width:88vw"><span id="liveCapQAIcon">\uD83D\uDCA1</span><span id="liveCapQAText">Looking good</span></div>' +
      '</div>' +
      '<div style="position:absolute;top:0;left:0;right:0;padding:.75rem 1rem 1rem;display:flex;justify-content:space-between;align-items:flex-start;background:linear-gradient(to bottom,rgba(0,0,0,.8),transparent);pointer-events:auto">' +
        '<button id="liveCapCancelBtn" style="padding:.4rem .75rem;background:rgba(0,0,0,.65);border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:99px;font-size:.75rem;font-weight:700;cursor:pointer">\u2715 Cancel</button>' +
        '<div style="text-align:right;color:#fff">' +
          '<div id="liveCapLabel" style="font-size:.95rem;font-weight:800;text-shadow:0 1px 4px rgba(0,0,0,.6)">Take photo</div>' +
          '<div id="liveCapSub" style="font-size:.7rem;color:rgba(255,255,255,.75);margin-top:.1rem"></div>' +
        '</div>' +
      '</div>' +
      '<div style="position:absolute;bottom:0;left:0;right:0;padding:1rem 1.25rem 1.5rem;display:flex;align-items:center;justify-content:center;gap:.75rem;background:linear-gradient(to top,rgba(0,0,0,.75),transparent);pointer-events:auto">' +
        '<button id="liveCapShutter" aria-label="Capture" style="width:78px;height:78px;border-radius:50%;background:#fff;border:5px solid rgba(255,255,255,.35);cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.5);transition:transform .1s" ontouchstart="this.style.transform=\'scale(.92)\'" ontouchend="this.style.transform=\'scale(1)\'"></button>' +
      '</div>' +
      '<div id="liveCapZoomWrap" style="display:none;position:absolute;right:16px;top:50%;transform:translateY(-50%);flex-direction:column;align-items:center;gap:.5rem;pointer-events:auto">' +
        '<span style="font-size:.65rem;font-weight:800;color:#fff;background:rgba(0,0,0,.55);padding:.2rem .5rem;border-radius:99px;min-width:36px;text-align:center" id="liveCapZoomLabel">1.0x</span>' +
        '<input id="liveCapZoomSlider" type="range" min="1" max="3" step="0.1" value="1" orient="vertical" style="writing-mode:vertical-lr;direction:rtl;width:8px;height:180px;background:rgba(255,255,255,.35);border-radius:99px;outline:none;accent-color:#c47a00" />' +
      '</div>' +
      '<div id="liveCapFlash" style="position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .12s"></div>';
    document.body.appendChild(ov);
    // Wire buttons once
    document.getElementById('liveCapCancelBtn').addEventListener('click', _liveCapCancel);
    document.getElementById('liveCapShutter').addEventListener('click', _liveCapSnap);
  }

  window._liveCapState = { active: true, stream: null, onCapture, onCancel };
  document.getElementById('liveCapLabel').textContent = label;
  document.getElementById('liveCapSub').textContent   = sublabel || '';
  ov.style.display = 'flex';

  const video = document.getElementById('liveCapVideo');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false
    });
    window._liveCapState.stream = stream;
    video.srcObject = stream;
    await video.play().catch(()=>{});
    // Wire zoom (pinch + slider) once video is playing
    try {
      if (window._liveCapZoomTeardown) window._liveCapZoomTeardown();
      window._liveCapZoomTeardown = _camZoomBind(
        video, stream,
        document.getElementById('liveCapZoomSlider'),
        document.getElementById('liveCapZoomLabel'),
        document.getElementById('liveCapZoomWrap')
      );
    } catch(_){}
    _liveCapStartQA();
  } catch(err) {
    console.warn('[live-cap] getUserMedia failed', err);
    _liveCapTeardown();
    if (onCancel) onCancel('permission-denied');
  }
}

function _liveCapCancel() {
  const s = window._liveCapState;
  _liveCapTeardown();
  if (s && s.onCancel) s.onCancel('user-cancel');
}

function _liveCapTeardown() {
  _liveCapStopQA();
  try { if (window._liveCapZoomTeardown) window._liveCapZoomTeardown(); } catch(_){}
  window._liveCapZoomTeardown = null;
  const s = window._liveCapState;
  if (s && s.stream) { try { s.stream.getTracks().forEach(t => t.stop()); } catch(_){} }
  const ov = document.getElementById('liveCapOverlay');
  if (ov) ov.style.display = 'none';
  window._liveCapState = { active: false, stream: null, onCapture: null, onCancel: null };
}

function _liveCapSnap() {
  const video  = document.getElementById('liveCapVideo');
  const canvas = document.getElementById('liveCapCanvas');
  if (!video || !video.videoWidth) { showToast('Camera still loading\u2026'); return; }
  const flash = document.getElementById('liveCapFlash');
  if (flash) { flash.style.opacity = '.85'; setTimeout(() => { flash.style.opacity = '0'; }, 120); }
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  canvas.toBlob(blob => {
    if (!blob) { showToast('Capture failed \u2014 try again'); return; }
    const file = new File([blob], 'livecap_' + Date.now() + '.jpg', { type: 'image/jpeg' });
    const cb = window._liveCapState && window._liveCapState.onCapture;
    _liveCapTeardown();
    if (cb) cb(file);
  }, 'image/jpeg', 0.92);
}

/* ── Live QA analyzer for live-capture overlay ───────────────────────────
   Mirrors _bulkRapidQATick but points at liveCap* DOM ids. Same thresholds
   so users see identical hints across Rapid Scan and Grade capture.
   ==================================================================== */
window._liveCapQATimer  = null;
window._liveCapQACanvas = null;
window._liveCapQAState  = null;
window._liveCapQAStreak = 0;
window._liveCapQACand   = null;

function _liveCapStopQA() {
  if (window._liveCapQATimer) { clearInterval(window._liveCapQATimer); window._liveCapQATimer = null; }
  window._liveCapQAState  = null;
  window._liveCapQAStreak = 0;
  window._liveCapQACand   = null;
  _liveCapRenderQA(null);
}

function _liveCapStartQA() {
  _liveCapStopQA();
  if (!window._liveCapQACanvas) {
    const c = document.createElement('canvas');
    c.width = 96; c.height = 134;
    window._liveCapQACanvas = c;
  }
  window._liveCapQATimer = setInterval(_liveCapQATick, 250);
}

function _liveCapQATick() {
  const video = document.getElementById('liveCapVideo');
  if (!video || !video.videoWidth) return;
  const ov = document.getElementById('liveCapOverlay');
  if (!ov || ov.style.display === 'none') { _liveCapStopQA(); return; }

  const c = window._liveCapQACanvas;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const vw = video.videoWidth, vh = video.videoHeight;
  const cw = c.width, ch = c.height;
  const vAspect = vw/vh, cAspect = cw/ch;
  let sx, sy, sw, sh;
  if (vAspect > cAspect) { sh = vh; sw = vh * cAspect; sx = (vw - sw)/2; sy = 0; }
  else                   { sw = vw; sh = vw / cAspect; sx = 0;           sy = (vh - sh)/2; }
  try { ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch); } catch(_) { return; }

  let data;
  try { data = ctx.getImageData(0, 0, cw, ch).data; } catch(_) { return; }

  const N = cw * ch;
  let sumLuma = 0, hotCount = 0;
  const luma = new Float32Array(N);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i], g = data[i+1], b = data[i+2];
    const y = 0.299*r + 0.587*g + 0.114*b;
    luma[p] = y; sumLuma += y;
    if (y > 245) {
      const maxC = Math.max(r,g,b), minC = Math.min(r,g,b);
      if (maxC - minC < 22) hotCount++;
    }
  }
  const meanLuma = sumLuma / N;

  let borderSum = 0, borderN = 0, centerSum = 0, centerN = 0;
  const bx0 = Math.round(cw*0.10), bx1 = Math.round(cw*0.90);
  const by0 = Math.round(ch*0.10), by1 = Math.round(ch*0.90);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const v = luma[y*cw + x];
    if (x < bx0 || x > bx1 || y < by0 || y > by1) { borderSum += v; borderN++; }
    else                                          { centerSum += v; centerN++; }
  }
  const borderMean = borderSum / Math.max(1, borderN);
  const centerMean = centerSum / Math.max(1, centerN);

  let lapSum = 0, lapSqSum = 0, lapN = 0;
  for (let y = by0+1; y < by1-1; y++) for (let x = bx0+1; x < bx1-1; x++) {
    const i = y*cw + x;
    const lap = -4*luma[i] + luma[i-1] + luma[i+1] + luma[i-cw] + luma[i+cw];
    lapSum += lap; lapSqSum += lap*lap; lapN++;
  }
  const lapMean = lapSum / Math.max(1, lapN);
  const lapVar  = (lapSqSum / Math.max(1, lapN)) - lapMean*lapMean;

  // 2026-08-31: readable-not-perfect — see the matching comment above the
  // Rapid-Scan variant of this block. The old frame check fired on any
  // bright surface behind the card. Grade capture needs the card readable,
  // not pixel-aligned; the pipeline handles minor crop and rotation fine.
  let hint = null;
  if (meanLuma < 42) {
    hint = { id: 'dark',   icon: '\uD83C\uDF19', text: 'Too dark \u2014 more light please' };
  } else if (meanLuma > 220) {
    hint = { id: 'bright', icon: '\u2600\uFE0F', text: 'Too bright \u2014 ease off the light' };
  } else if (hotCount > N * 0.020) {
    hint = { id: 'glare',  icon: '\u2728', text: 'Glare on the card \u2014 tilt slightly' };
  } else if (lapVar < 40) {
    hint = { id: 'blur',   icon: '\uD83D\uDCA8', text: 'Blurry \u2014 hold steady' };
  } else if (lapVar < 25 && (centerMean < 18 || Math.abs(centerMean - borderMean) < 3)) {
    hint = { id: 'empty',  icon: '\uD83D\uDCF7', text: 'Point the camera at your card' };
  }

  const candId = hint ? hint.id : null;
  if (candId === window._liveCapQACand) { window._liveCapQAStreak++; }
  else { window._liveCapQACand = candId; window._liveCapQAStreak = 1; }
  if (window._liveCapQAStreak >= 2 && window._liveCapQAState !== candId) {
    window._liveCapQAState = candId;
    _liveCapRenderQA(hint);
  }
}

function _liveCapRenderQA(hint) {
  const bar   = document.getElementById('liveCapQABar');
  const icon  = document.getElementById('liveCapQAIcon');
  const text  = document.getElementById('liveCapQAText');
  const pill  = document.getElementById('liveCapQAPill');
  const frame = document.getElementById('liveCapFrame');
  if (!bar) return;
  if (!hint) {
    bar.style.display = 'none';
    if (frame) {
      frame.style.borderColor = 'rgba(74,222,128,.85)';
      frame.style.boxShadow   = '0 0 0 9999px rgba(0,0,0,.35), 0 0 22px rgba(74,222,128,.35)';
    }
    return;
  }
  if (icon) icon.textContent = hint.icon;
  if (text) text.textContent = hint.text;
  bar.style.display = 'flex';
  if (pill) {
    pill.style.background  = 'rgba(196,122,0,.92)';
    pill.style.borderColor = 'rgba(255,224,120,.55)';
    pill.style.color       = '#111';
  }
  if (frame) {
    frame.style.borderColor = 'rgba(255,196,80,.9)';
    frame.style.boxShadow   = '0 0 0 9999px rgba(0,0,0,.35)';
  }
}

// Public entry point used by the sub-row buttons under the search bar.
// Opens the tabbed scan menu with a specific tab pre-selected. Respects
// the same sign-in gate as openBulkModePicker so we don't flash the sheet
// only to demand auth on the next tap.
function openScanMenuOnTab(which) {
  if (!window.googleUser) {
    showToast('Sign in with Google first to scan');
    triggerGoogleSignIn && triggerGoogleSignIn();
    return;
  }
  const ov = document.getElementById('bulkModePickerOverlay');
  if (!ov) return;
  ov.style.display = 'flex';
  // Pre-select the requested tab. switchScanMenuTab is defensive against
  // missing DOM — safe to call before the panels have been styled.
  switchScanMenuTab(which === 'grade' ? 'grade' : 'id');
  try { window.trackEvent && window.trackEvent('scan_menu_open', { tab: which === 'grade' ? 'grade' : 'id' }); } catch(_){}
}

// Switch between ID and Grade tabs inside the scan menu.
function switchScanMenuTab(which) {
  const tabId    = document.getElementById('scanMenuTabId');
  const tabGrade = document.getElementById('scanMenuTabGrade');
  const panelId    = document.getElementById('scanMenuPanelId');
  const panelGrade = document.getElementById('scanMenuPanelGrade');
  if (!tabId || !tabGrade || !panelId || !panelGrade) return;
  const active   = { background: 'var(--gold)', color: '#000' };
  const inactive = { background: 'transparent',  color: 'rgba(255,255,255,.6)' };
  if (which === 'grade') {
    Object.assign(tabGrade.style, active);
    Object.assign(tabId.style, inactive);
    panelGrade.style.display = 'flex';
    panelId.style.display    = 'none';
  } else {
    Object.assign(tabId.style, active);
    Object.assign(tabGrade.style, inactive);
    panelId.style.display    = 'flex';
    panelGrade.style.display = 'none';
  }
  try { window.trackEvent && window.trackEvent('scan_menu_tab', { tab: which === 'grade' ? 'grade' : 'id' }); } catch(_){}
}

// Open the Bulk Scan overlay and jump straight into Rapid Scan (live camera).
function openRapidScanDirect() {
  try { openBulkScan(); } catch(_){}
  // Wait a frame so the overlay is on-screen before requesting camera perms.
  setTimeout(function(){ try { startBulkRapid(); } catch(_){ } }, 30);
  try { window.trackEvent && window.trackEvent('rapid_scan_direct_open', {}); } catch(_){}
}

// Bulk Grade batch picker (Quick vs Deep) — opened from the Grade tab.
function openBulkGradeBatchPicker() {
  if (!window.googleUser) {
    showToast('Sign in with Google first for Bulk Grade');
    triggerGoogleSignIn && triggerGoogleSignIn();
    return;
  }
  const ov = document.getElementById('bulkGradeBatchPickerOverlay');
  if (ov) ov.style.display = 'flex';
  try { window.trackEvent && window.trackEvent('bulk_grade_batch_picker_open', {}); } catch(_){}
}
function closeBulkGradeBatchPicker() {
  const ov = document.getElementById('bulkGradeBatchPickerOverlay');
  if (ov) ov.style.display = 'none';
}

// Single-card grade dispatcher. Reuses openGradeScanGate() for auth + ROI
// warning + pricing routing, then routes credit-holders straight into the
// requested mode instead of showing the Quick/Deep tier picker again.
function startSingleGradeFlow(mode) {
  mode = (mode === 'deep') ? 'deep' : 'quick';
  if (!window.googleUser) {
    showToast('Sign in with Google first to use the grader');
    triggerGoogleSignIn && triggerGoogleSignIn();
    return;
  }
  // ROI credit-saver warning (same copy as openGradeScanGate).
  const gOpp = window._lastGradeOpportunity;
  if (gOpp && gOpp.recommendation === 'sell_raw' && gOpp.rawPrice != null) {
    const rawStr = gOpp.rawPrice < 2 ? 'under $2' : ('~$' + Number(gOpp.rawPrice).toFixed(2));
    const est = gOpp.expectedProfit != null ? Number(gOpp.expectedProfit).toFixed(0) : '?';
    const msg = est !== '?' && Number(est) < 0
      ? 'Heads up — this raw card is ' + rawStr + '. Even at PSA 10 the math shows about $' + est + ' profit after grading fees. Grade anyway?'
      : 'Heads up — this raw card is ' + rawStr + '. Grading may not be profitable here. Grade anyway?';
    if (!confirm(msg)) return;
  }
  const credits = (window._scanCredits || 0) + (window._freeScansLeft || 0);
  const needed = (mode === 'deep') ? 2 : 1;
  if (credits < needed) {
    openShop('grade', 'grade_scan_gate_tier'); // CR-021: was the plan chooser
    return;
  }
  if (mode === 'deep') {
    try { startDeepGrade(); } catch(e) { openGradeTierPicker(); }
  } else {
    try { startQuickGrade(); } catch(e) { openGradeTierPicker(); }
  }
  try { window.trackEvent && window.trackEvent('single_grade_direct', { mode: mode }); } catch(_){}
}

function openBulkGrade(mode) {
  mode = (mode === 'deep') ? 'deep' : 'quick';
  window._bulkGradeMode = mode;
  // Both modes require front+back per card. Deep additionally uses 4 edge
  // photos per card. Cap stays at 10 cards per session either way — that
  // matches the server-side rate + credit floor and keeps memory reasonable.
  window._bulkGradeCap = 10;

  if (!window.googleUser) {
    showToast('Sign in with Google first to use Bulk Grade');
    triggerGoogleSignIn && triggerGoogleSignIn();
    return;
  }
  // Reset state (revoke previous objectURLs).
  _bulkGradeRevokeAllUrls();
  window._bulkGradeQueue      = [];
  window._bulkGradeResults    = [];
  window._bulkGradeProcessing = false;

  const ov = document.getElementById('bulkGradeOverlay');
  if (!ov) return;
  ov.style.display = 'flex';
  _dialogOpened('bulkGradeOverlay');

  // Update header subtitle to reflect chosen mode.
  const subtitle = document.getElementById('bulkGradeSubtitle');
  if (subtitle) {
    subtitle.textContent = (mode === 'deep')
      ? '2 credits per card · front + back + 4 edges · up to 10 per session'
      : '1 credit per card · front + back · up to 10 per session';
  }
  // Update the header title to include the mode.
  const titleWrap = ov.querySelector('div[style*="font-size:1rem"]');
  if (titleWrap) {
    titleWrap.innerHTML = '<span style="color:var(--gold-text)">' + (mode === 'deep' ? '🔍' : '⚡') + '</span> ' +
      (mode === 'deep' ? 'Bulk Deep Grade' : 'Bulk Quick Grade') +
      ' <span style="font-size:.6rem;font-weight:800;letter-spacing:.06em;background:linear-gradient(135deg,#1e40af,#3b82f6);color:#fff;padding:.15rem .4rem;border-radius:99px">PRO MAX</span>';
  }

  // Tier gate: Pro Max + Ultimate only. Owner emails override for testing.
  const tier = (window._userTier || (window._isPro ? 'pro' : 'free')).toLowerCase();
  const isEligible = tier === 'pro_max' || tier === 'ultimate';
  const isOwner = (window._user && window._user.email && (window._user.email === 'willsep200@gmail.com' || window._user.email === 'willsep202@gmail.com'));

  try { window.trackEvent && window.trackEvent('bulk_grade_open', { tier, mode, eligible: isEligible || isOwner ? 'yes' : 'no' }); } catch(_) {}

  if (!isEligible && !isOwner) {
    _bulkGradeShowSection('tierGate');
    return;
  }

  // Update intro copy for the chosen mode.
  const intro = document.getElementById('bulkGradeIntro');
  const introTitle = intro?.querySelector('div[style*="font-size:1.05rem"]');
  const introDesc  = intro?.querySelector('div[style*="font-size:.82rem"]');
  if (introTitle) introTitle.textContent = (mode === 'deep') ? 'Deep grade a stack (full accuracy)' : 'Quick-grade a stack (ballpark)';
  if (introDesc) {
    introDesc.innerHTML = (mode === 'deep')
      ? 'Take or upload <strong style="color:#fff">front + back + 4 edge close-ups</strong> per card, up to 10 cards. Highest accuracy — the AI grader sees every angle. <strong style="color:#fff">6 photos = 1 card.</strong>'
      : 'Take or upload <strong style="color:#fff">front + back photos</strong> per card, up to 10 cards. Ballpark grade for a quick sort. <strong style="color:#fff">2 photos = 1 card.</strong>';
  }
  // Tip block — different content per mode.
  const tip = ov.querySelector('#bulkGradeIntro div[style*="background:rgba(255,255,255,.04)"]');
  if (tip) {
    tip.innerHTML = (mode === 'deep')
      ? '💡 Order: <strong style="color:#fff">front, back, top edge, bottom edge, left edge, right edge</strong> — repeat for each card.'
      : '💡 Order: <strong style="color:#fff">front, back, front, back</strong> — repeat for each card.';
  }
  // File input: for Quick we take any set of files; for Deep we pair them front/back.
  const fileInput = document.getElementById('bulkGradeInput');
  if (fileInput) fileInput.setAttribute('data-mode', mode);

  // Show credit balance.
  const credits = (window._scanCredits || 0);
  const info = document.getElementById('bulkGradeCreditsInfo');
  if (info) {
    info.innerHTML = 'You have <strong style="color:var(--gold-text)">' + credits + '</strong> grade credit' +
      (credits !== 1 ? 's' : '') + ' available';
  }
  _bulkGradeShowSection('intro');
}

// Every slot on a Bulk Grade queue item that can hold an object URL.
// Deep Grade adds four edge photos per card; the old cleanup only knew about
// front and back, so a 10-card deep session leaked 40 blobs — enough to
// matter on mobile Safari, which holds the full decoded image alive.
const _BULK_GRADE_URL_SLOTS = ['front', 'back', 'topEdge', 'bottomEdge', 'leftEdge', 'rightEdge'];

function _bulkGradeRevokeItem(item) {
  if (!item) return;
  if (item.objectUrl) { try { URL.revokeObjectURL(item.objectUrl); } catch(_){} }
  for (const k of _BULK_GRADE_URL_SLOTS) {
    const slot = item[k];
    if (slot && slot.objectUrl) { try { URL.revokeObjectURL(slot.objectUrl); } catch(_){} }
  }
}

function _bulkGradeRevokeAllUrls() {
  try {
    (window._bulkGradeQueue || []).forEach(_bulkGradeRevokeItem);
    (window._bulkGradeResults || []).forEach(_bulkGradeRevokeItem);
  } catch(_){}
}

function closeBulkGrade() {
  const ov = document.getElementById('bulkGradeOverlay');
  if (ov) ov.style.display = 'none';
  _dialogClosed('bulkGradeOverlay');
  const detail = document.getElementById('bulkGradeDetail');
  if (detail) { detail.style.display = 'none'; detail.innerHTML = ''; }
  window._bulkGradeProcessing = false;
  _bulkGradeRevokeAllUrls();
  window._bulkGradeQueue   = [];
  window._bulkGradeResults = [];
}

function _bulkGradeShowSection(section) {
  // section: 'tierGate' | 'intro' | 'creditConfirm' | 'processing'
  document.getElementById('bulkGradeTierGate').style.display      = section === 'tierGate'      ? 'flex' : 'none';
  document.getElementById('bulkGradeIntro').style.display         = section === 'intro'         ? 'flex' : 'none';
  document.getElementById('bulkGradeCreditConfirm').style.display = section === 'creditConfirm' ? 'flex' : 'none';
  document.getElementById('bulkGradeProcessing').style.display    = section === 'processing'    ? 'flex' : 'none';
}

/* ================================================================
   Photo Quality Assistant
   Runs client-side, entirely local. Returns advisory warnings only
   — never blocks a grade. False positives kill trust so thresholds
   are set to fire only on obvious failures.

   Checks:
     - blur:       Laplacian variance on a 128px thumbnail. <30 = blurry.
     - brightness: mean pixel luma on a 64px thumbnail. <40 too dark, >220 too bright.
     - cardInFrame: rough contour check via edge density near frame edges vs middle.
                    If the edges are as busy as the middle the card is likely off-frame.
   ================================================================ */
async function analyzePhotoQuality(file) {
  const warnings = [];
  const stats = { blur: null, brightness: null, cardInFrame: null };
  try {
    const bmp = await createImageBitmap(file);
    // Downsample to 128x128 for blur, 64x64 for brightness / frame.
    const size = 128;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    // Fit-into-square, preserve aspect.
    const scale = Math.min(size / bmp.width, size / bmp.height);
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(bmp, (size - w) / 2, (size - h) / 2, w, h);
    const img = ctx.getImageData(0, 0, size, size).data;

    // Build luma buffer.
    const luma = new Float32Array(size * size);
    let brightSum = 0, brightCount = 0;
    for (let i = 0, j = 0; i < img.length; i += 4, j++) {
      // Only count pixels that aren't pure-black padding.
      const r = img[i], g = img[i+1], b = img[i+2];
      const y = 0.299*r + 0.587*g + 0.114*b;
      luma[j] = y;
      if (r + g + b > 6) { brightSum += y; brightCount++; }
    }
    stats.brightness = brightCount ? brightSum / brightCount : 128;
    if (stats.brightness < 45) warnings.push({ type: 'dark',   msg: 'Photo looks dark — try more light' });
    else if (stats.brightness > 215) warnings.push({ type: 'bright', msg: 'Photo looks overexposed — avoid direct glare' });

    // Laplacian variance for blur. Kernel: [0,1,0; 1,-4,1; 0,1,0].
    let sum = 0, sumSq = 0, n = 0;
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        const v = -4 * luma[i] + luma[i-1] + luma[i+1] + luma[i-size] + luma[i+size];
        sum += v; sumSq += v * v; n++;
      }
    }
    const mean = sum / n;
    stats.blur = (sumSq / n) - (mean * mean); // variance
    if (stats.blur < 25) warnings.push({ type: 'blur', msg: 'Photo looks blurry — hold steady or focus on the card' });

    // Card-in-frame: compare mean gradient magnitude in a 12-px border band
    // vs the center. If the border has strong edges the card is likely cropped.
    let borderGrad = 0, borderN = 0, centerGrad = 0, centerN = 0;
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        const gx = luma[i+1] - luma[i-1];
        const gy = luma[i+size] - luma[i-size];
        const mag = Math.abs(gx) + Math.abs(gy);
        const inBorder = x < 12 || x >= size - 12 || y < 12 || y >= size - 12;
        if (inBorder) { borderGrad += mag; borderN++; }
        else if (x > 24 && x < size - 24 && y > 24 && y < size - 24) { centerGrad += mag; centerN++; }
      }
    }
    const borderMean = borderN ? borderGrad / borderN : 0;
    const centerMean = centerN ? centerGrad / centerN : 1;
    stats.cardInFrame = 1 - Math.min(1, borderMean / (centerMean + 1e-6));
    // 2026-08-31: removed the speculative "Card may be cropped" warning.
    // The heuristic (border edge activity vs center) fires on bright-
    // background photos of perfectly-framed cards. False positives eroded
    // trust more than the rare real crop was worth. Grade pipeline handles
    // small crops fine; if the card is actually gone the recognizer will
    // low-confidence and refund the credit automatically.
    bmp.close && bmp.close();
  } catch(err) {
    // Never fail-fast on QA errors — just return no warnings.
    return { ok: true, warnings: [], stats, error: err.message };
  }
  return { ok: warnings.length === 0, warnings, stats };
}

/* Runs QA analysis over every photo in the current bulk queue in parallel
   and returns a per-card summary. Non-blocking — the user can still hit
   'Grade All' even with warnings. */
async function _bulkGradeQAScan() {
  const queue = window._bulkGradeQueue || [];
  const mode = window._bulkGradeMode || 'quick';
  const results = [];
  await Promise.all(queue.map(async (card, idx) => {
    const slots = mode === 'deep'
      ? [['front', card.front], ['back', card.back], ['top edge', card.topEdge], ['bottom edge', card.bottomEdge], ['left edge', card.leftEdge], ['right edge', card.rightEdge]]
      : [['front', card.front], ['back', card.back]];
    const perSlot = await Promise.all(slots.map(async ([name, slot]) => {
      if (!slot?.file) return { slot: name, warnings: [] };
      const qa = await analyzePhotoQuality(slot.file);
      return { slot: name, warnings: qa.warnings, stats: qa.stats };
    }));
    const allWarns = perSlot.flatMap(s => s.warnings.map(w => ({ ...w, slot: s.slot })));
    results[idx] = { cardIdx: idx, perSlot, warnings: allWarns };
  }));
  return results;
}

function startBulkGradeUpload() {
  document.getElementById('bulkGradeInput').click();
}

/* Take photos with the phone camera. Native camera returns a batch of photos
   which we process identically to the upload path. For Deep mode the user is
   reminded to alternate front/back; for Quick mode just fronts.
   TODO 2026-09-01: wrap in a Rapid-Scan-style live loop so Bulk Grade users
   get the dashed frame + QA feedback + zoom. Currently uses the raw phone
   camera because native multi-photo pickers do the batching for us; a live
   loop would need to queue photos client-side and paint a running counter. */
function startBulkGradeCamera() {
  const mode = window._bulkGradeMode || 'quick';
  if (mode === 'deep') {
    showToast('Order per card: front, back, top edge, bottom edge, left edge, right edge. 6 photos = 1 card.');
  } else {
    showToast('Order per card: front, back. 2 photos = 1 card. Up to 10 cards.');
  }
  document.getElementById('bulkGradeCameraInput').click();
}

function processBulkGradeFiles(input) {
  const allFiles = Array.from(input.files || []);
  input.value = '';
  if (!allFiles.length) return;

  const { okFiles: files, rejected } = _partitionScanFiles(allFiles);
  if (rejected.length) {
    const extra = rejected.length > 1 ? ' (' + rejected.length + ' photos skipped)' : '';
    if (typeof showToast === 'function') showToast(rejected[0].error + extra, 'info');
  }
  if (!files.length) return;

  const mode = window._bulkGradeMode || 'quick';
  const cap = window._bulkGradeCap || 10;
  // photos-per-card: quick = 2 (front, back), deep = 6 (front, back, 4 edges).
  const perCard = (mode === 'deep') ? 6 : 2;

  let count, credits, hasEnough, needCredits, truncated = false;

  if (files.length < perCard) {
    showToast(mode === 'deep'
      ? 'Deep Grade needs 6 photos per card (front, back, 4 edges).'
      : 'Quick Grade needs 2 photos per card (front + back).');
    return;
  }
  // Trim to a multiple of perCard.
  const usable = files.length - (files.length % perCard);
  const cards = [];
  for (let i = 0; i < usable; i += perCard) {
    const item = {
      front: { file: files[i],     objectUrl: URL.createObjectURL(files[i]) },
      back:  { file: files[i + 1], objectUrl: URL.createObjectURL(files[i + 1]) },
    };
    if (mode === 'deep') {
      item.topEdge    = { file: files[i + 2], objectUrl: URL.createObjectURL(files[i + 2]) };
      item.bottomEdge = { file: files[i + 3], objectUrl: URL.createObjectURL(files[i + 3]) };
      item.leftEdge   = { file: files[i + 4], objectUrl: URL.createObjectURL(files[i + 4]) };
      item.rightEdge  = { file: files[i + 5], objectUrl: URL.createObjectURL(files[i + 5]) };
    }
    cards.push(item);
  }
  let selected = cards;
  if (cards.length > cap) {
    // Release the blobs for the cards we are dropping — they were created in
    // the loop above and would otherwise never be revoked.
    cards.slice(cap).forEach(_bulkGradeRevokeItem);
    selected = cards.slice(0, cap);
    truncated = true;
  }
  // A second pick replaces the queue outright; free the previous one first.
  (window._bulkGradeQueue || []).forEach(_bulkGradeRevokeItem);
  window._bulkGradeQueue = selected;
  count = selected.length;
  needCredits = (mode === 'deep') ? count * 2 : count;
  credits = (window._scanCredits || 0);
  hasEnough = credits >= needCredits;

  const icon = document.getElementById('bulkGradeCreditIcon');
  const msg  = document.getElementById('bulkGradeCreditMsg');
  const bud  = document.getElementById('bulkGradeCreditBudget');
  const btn  = document.getElementById('bulkGradeStartBtn');

  if (icon) icon.textContent = hasEnough ? (mode === 'deep' ? '🔍' : '🎯') : '⚠️';
  if (msg) {
    const totalPhotos = count * perCard;
    const photoLabel = (mode === 'deep')
      ? totalPhotos + ' photos (front + back + 4 edges each)'
      : totalPhotos + ' photos (front + back each)';
    msg.innerHTML = '<strong style="color:#fff">' + count + ' card' + (count !== 1 ? 's' : '') + ' ready</strong>' +
      '<br><span style="font-size:.72rem;color:var(--text-muted)">' + photoLabel + '</span>' +
      (truncated ? '<br><span style="color:var(--gold-text);font-size:.72rem">(capped at ' + cap + ' cards this session)</span>' : '');
  }
  if (bud) {
    if (hasEnough) {
      const perCard = (mode === 'deep') ? 2 : 1;
      bud.innerHTML = 'Uses <strong style="color:var(--gold-text)">' + needCredits + ' grade credit' + (needCredits !== 1 ? 's' : '') +
        '</strong> (' + perCard + '/card) · you have ' + credits;
      if (btn) {
        btn.disabled = false; btn.style.opacity = '1';
        btn.textContent = (mode === 'deep' ? 'Deep Grade All 🔍' : 'Grade All ⚡');
      }
    } else {
      const short = needCredits - credits;
      bud.innerHTML = '<strong style="color:#f87171">Need ' + needCredits + ' grade credits, you have ' + credits + '.</strong><br>' +
        '<button onclick="closeBulkGrade();openPricingModal(\'bulk_grade_low_credits\')" style="margin-top:.5rem;background:var(--gold);color:#000;border:none;border-radius:8px;padding:.5rem 1rem;font-weight:800;font-size:.78rem;cursor:pointer">Buy ' + short + '+ more credits</button>';
      if (btn) { btn.disabled = true; btn.style.opacity = '.5'; btn.textContent = 'Not enough credits'; }
    }
  }

  try { window.trackEvent && window.trackEvent('bulk_grade_files_selected', { count: String(count), mode, enough: hasEnough ? 'yes' : 'no' }); } catch(_) {}

  _bulkGradeShowSection('creditConfirm');

  // Kick off async photo QA scan — renders warnings into #bulkGradeQABox
  // when done. Never blocks the confirm button.
  _bulkGradeRenderQALoading();
  _bulkGradeQAScan().then(_bulkGradeRenderQAResults).catch(() => _bulkGradeRenderQAClear());
}

function _bulkGradeRenderQALoading() {
  const box = document.getElementById('bulkGradeQABox');
  if (!box) return;
  box.style.display = 'block';
  box.innerHTML = '<div style="font-size:.72rem;color:rgba(255,255,255,.5);text-align:center;padding:.4rem 0">🔍 Checking photo quality…</div>';
}
function _bulkGradeRenderQAClear() {
  const box = document.getElementById('bulkGradeQABox');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}
function _bulkGradeRenderQAResults(results) {
  const box = document.getElementById('bulkGradeQABox');
  if (!box) return;
  const flagged = results.filter(r => r.warnings.length > 0);
  if (!flagged.length) {
    box.style.display = 'block';
    box.innerHTML = '<div style="font-size:.72rem;color:#4ade80;text-align:center;padding:.4rem 0">✓ Photos look good — ready to grade</div>';
    return;
  }
  const rows = flagged.slice(0, 5).map(f => {
    const bullets = f.warnings.slice(0, 3).map(w =>
      '<li style="margin:.15rem 0"><span style="color:#fbbf24;font-weight:700">' + _bgEsc(w.slot) + ':</span> ' + _bgEsc(w.msg) + '</li>'
    ).join('');
    return '<div style="padding:.35rem .5rem;background:rgba(251,191,36,.06);border-left:2px solid #fbbf24;border-radius:4px;margin-bottom:.35rem">' +
      '<div style="font-size:.72rem;font-weight:700;color:#fff">Card ' + (f.cardIdx + 1) + '</div>' +
      '<ul style="margin:.2rem 0 0;padding-left:1rem;font-size:.68rem;color:rgba(255,255,255,.75);line-height:1.5">' + bullets + '</ul>' +
    '</div>';
  }).join('');
  const extra = flagged.length > 5 ? '<div style="font-size:.65rem;color:rgba(255,255,255,.4);text-align:center;margin-top:.2rem">+' + (flagged.length - 5) + ' more cards with warnings</div>' : '';
  box.style.display = 'block';
  box.innerHTML =
    '<div style="font-size:.72rem;font-weight:800;color:#fbbf24;margin-bottom:.3rem;display:flex;align-items:center;gap:.35rem">⚠️ Photo QA — ' + flagged.length + ' card' + (flagged.length !== 1 ? 's' : '') + ' with warnings</div>' +
    rows + extra +
    '<div style="font-size:.62rem;color:rgba(255,255,255,.4);margin-top:.35rem;line-height:1.45">These are advisory only. Grading will still run but accuracy improves a lot with clearer photos. Cancel and retake for the best results.</div>';
}

function cancelBulkGradeConfirm() {
  _bulkGradeRevokeAllUrls();
  window._bulkGradeQueue = [];
  _bulkGradeRenderQAClear();
  _bulkGradeShowSection('intro');
}

/* Runs the queued Bulk Grade session against /api/scan?mode=grade.
   Concurrency = 2 (Ximilar's sync grader ~3-8s per call; 3+ tends to 429).
   Deep mode makes 2 sequential grader calls per card (front, then back)
   and averages the sub-grades before rendering the row. */
async function runBulkGrade() {
  const queue = window._bulkGradeQueue || [];
  if (!queue.length) return;

  const mode = window._bulkGradeMode || 'quick';
  const perCard = (mode === 'deep') ? 2 : 1;
  const need = queue.length * perCard;
  const credits = (window._scanCredits || 0);
  if (credits < need) {
    showToast('Not enough grade credits for ' + queue.length + ' cards (' + mode + ' mode).');
    return;
  }

  window._bulkGradeProcessing = true;
  window._bulkGradeResults    = new Array(queue.length);
  _bulkGradeShowSection('processing');

  try { window.trackEvent && window.trackEvent('bulk_grade_started', { count: String(queue.length), mode }); } catch(_) {}

  // Pre-render placeholder rows so completion order matches queue order.
  const listEl = document.getElementById('bulkGradeResultsList');
  listEl.innerHTML = '';
  document.getElementById('bulkGradeBottomBar').style.display = 'none';
  for (let i = 0; i < queue.length; i++) {
    const rowId = 'bulk-grade-row-' + i;
    const thumb = queue[i].front.objectUrl;
    listEl.insertAdjacentHTML('beforeend',
      '<div id="' + rowId + '" style="display:flex;align-items:center;gap:.75rem;padding:.6rem .75rem;background:#111;border-radius:10px;border:1px solid #1e1e1e">' +
        '<img src="' + thumb + '" style="width:44px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0;opacity:.6" />' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:.78rem;color:rgba(255,255,255,.35)">Queued…</div>' +
        '</div>' +
        '<div style="width:20px;height:20px;border:2px solid rgba(196,122,0,.3);border-top-color:var(--gold);border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0"></div>' +
      '</div>');
  }

  const total = queue.length;
  const CONCURRENCY = 2;
  let nextIdx = 0;
  let completed = 0;
  let hardStop = false;

  async function worker() {
    while (true) {
      if (hardStop || !window._bulkGradeProcessing) return;
      const i = nextIdx++;
      if (i >= total) return;
      const item  = queue[i];
      const rowId = 'bulk-grade-row-' + i;

      try {
        const row = document.getElementById(rowId);
        const label = row?.querySelector('div[style*="flex:1"] div');
        if (label) label.textContent = (mode === 'deep') ? 'Analyzing front…' : 'Grading…';
      } catch(_) {}

      const result = await _bulkGradeOne(item, rowId, mode);

      if (result === 'STOP') { hardStop = true; return; }

      window._bulkGradeResults[i] = result;
      completed++;
      _bulkGradeUpdateRow(rowId, result);

      const pct = Math.round((completed / total) * 100);
      document.getElementById('bulkGradeProgressLabel').textContent =
        (mode === 'deep' ? 'Deep grading ' : 'Grading ') + completed + ' of ' + total + '…';
      document.getElementById('bulkGradeProgressBar').style.width = pct + '%';
      const credLeft = (window._scanCredits || 0);
      document.getElementById('bulkGradeProgressCredits').textContent =
        credLeft + ' credit' + (credLeft !== 1 ? 's' : '') + ' remaining';
    }
  }

  const workerCount = Math.min(CONCURRENCY, total);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  window._bulkGradeResults = window._bulkGradeResults.filter(r => r);
  _bulkGradeFinish();
}

/* Grades a single queued card via /api/scan?mode=grade, sending front+back
   (and 4 edges for Deep) in a SINGLE server call so Ximilar's native grader
   applies its tuned 70/30 front-back weighting. Never grades front and back
   separately client-side — the server always sees both together.

   Accuracy loop: if the first attempt returns no grades, retry once with a
   larger/less-compressed image before giving up. Server refunds credits on
   grade-not-produced, so retries don't double-charge. */
async function _bulkGradeOne(item, rowId, mode) {
  const isDeep = mode === 'deep';
  let result = {
    objectUrl: item.front.objectUrl, file: item.front.file, success: false,
    cardName: '', setName: '', cardNumber: '', imageDataUrl: null,
    grades: null, rawPrice: null, gradedPrice: null, roi: null,
    error: '', rowId, rawServer: null, deepMode: isDeep,
  };
  // Two attempts: (px, quality). Second pass is bigger + higher quality.
  const attempts = [
    { px: 1200, q: 0.90 },
    { px: 1600, q: 0.95 },
  ];
  try {
    // Thumbnail for the row (unchanged across attempts).
    try {
      const thumbBase64 = await compressImage(item.front.file, 350, { skipCrop: true });
      result.imageDataUrl = 'data:image/jpeg;base64,' + thumbBase64;
    } catch(_) {}

    for (let attempt = 0; attempt < attempts.length; attempt++) {
      const { px, q } = attempts[attempt];
      // Update spinner label on retry so the user sees we're being patient.
      if (attempt > 0) {
        try {
          const row = document.getElementById(rowId);
          const label = row?.querySelector('div[style*="flex:1"] div');
          if (label) label.textContent = 'Retrying at higher quality…';
        } catch(_){}
      }
      // Compress every photo in parallel — front + back (+ 4 edges for Deep).
      const encode = (f) => compressImage(f, px, { skipCrop: true, quality: q });
      const [imageBase64, backBase64, topEdgeBase64, bottomEdgeBase64, leftEdgeBase64, rightEdgeBase64] = await Promise.all([
        encode(item.front.file),
        encode(item.back.file),
        isDeep ? encode(item.topEdge.file)    : Promise.resolve(null),
        isDeep ? encode(item.bottomEdge.file) : Promise.resolve(null),
        isDeep ? encode(item.leftEdge.file)   : Promise.resolve(null),
        isDeep ? encode(item.rightEdge.file)  : Promise.resolve(null),
      ]);

      const idToken = window._googleIdToken || '';
      const body = {
        imageBase64, backBase64,
        mimeType: 'image/jpeg',
        mode: 'grade',
        deepGrade: isDeep,
        // Declares this as the Pro Max batch workflow so the server can verify
        // the entitlement rather than trusting the client-side gate.
        bulkGrade: true,
        email: window.googleUser?.email || window._userEmail || '',
        googleSub: window.googleUser?.sub || window._googleSub || '',
      };
      if (isDeep) {
        body.topEdgeBase64 = topEdgeBase64;
        body.bottomEdgeBase64 = bottomEdgeBase64;
        body.leftEdgeBase64 = leftEdgeBase64;
        body.rightEdgeBase64 = rightEdgeBase64;
      }
      const resp = await fetch('/api/scan?mode=grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
        body: JSON.stringify(body),
      });

      if (resp.status === 402) {
        result.error = 'Out of grade credits';
        showToast('Ran out of grade credits mid-batch. Completed cards saved.', 'info');
        return 'STOP';
      } else if (resp.status === 403) {
        // Server rejected the entitlement. Stop the batch rather than burning
        // through every remaining card on a request that cannot succeed.
        let em = 'Bulk Grade requires Pro Max.';
        try { const e = await resp.json(); em = e.error || em; } catch(_){}
        result.error = em;
        showToast(em, 'info');
        return 'STOP';
      } else if (resp.status === 401) {
        result.error = 'Auth expired';
        window._googleIdToken = null;
        return result;
      } else if (!resp.ok) {
        // On non-2xx, only retry if we have another attempt left.
        let em = 'Grade failed';
        try { const e = await resp.json(); em = e.error || em; } catch(_){}
        result.error = em;
        if (attempt < attempts.length - 1) continue;
        return result;
      }

      const data = await resp.json();
      // The server refunds on grader failure, so we only debit locally when we
      // got a successful grade back. Deep costs 2 credits, Quick costs 1.
      const gotGrade = data.grades && (data.grades.final != null || data.grades.corners != null);
      if (gotGrade) {
        try {
          const cost = isDeep ? 2 : 1;
          if (typeof window._scanCredits === 'number') window._scanCredits = Math.max(0, window._scanCredits - cost);
        } catch(_){}
        try { updateKeyStatus && updateKeyStatus(); } catch(_){}
      }

      if (gotGrade) {
        result.rawServer = data;
        result.success  = true;
        result.cardName = data.card_name || data.cardName || 'Unknown card';
        result.setName  = data.set_name  || data.setName  || '';
        result.cardNumber = data.card_number || data.cardNumber || '';
        result.grades = {
          final:     _bgNum(data.grades.final),
          corners:   _bgNum(data.grades.corners),
          edges:     _bgNum(data.grades.edges),
          surface:   _bgNum(data.grades.surface),
          centering: _bgNum(data.grades.centering),
          condition: data.grades.condition || null,
        };
        result.rawPrice    = _bgNum(data.market_price || data.marketPrice);
        result.gradedPrice = _bgNum(data.graded_price || data.gradedPrice);
        if (result.rawPrice > 0 && result.gradedPrice > 0) {
          const feesPct = 13, gradingCost = 25;
          const rawNet = result.rawPrice * (1 - feesPct / 100);
          const grdNet = result.gradedPrice * (1 - feesPct / 100);
          result.roi = grdNet - rawNet - gradingCost;
        }
        return result;
      }
      // No grades — keep the last error, retry with bigger image if possible.
      result.error = data.error || 'Could not grade card';
      if (attempt >= attempts.length - 1) return result;
    }
  } catch(err) {
    result.error = err.message || 'Grade error';
  }
  return result;
}

function _bgNum(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function _bulkGradeUpdateRow(rowId, result) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const img = row.querySelector('img');
  if (img) img.style.opacity = '1';
  const spinner = row.querySelector('div[style*="animation:spin"]');
  if (spinner && spinner.parentNode) spinner.parentNode.removeChild(spinner);

  const body = row.querySelector('div[style*="flex:1"]');
  if (!body) return;

  if (!result.success) {
    body.innerHTML =
      '<div style="font-size:.78rem;color:#f87171;font-weight:700">' + _bgEsc(result.cardName || 'Failed') + '</div>' +
      '<div style="font-size:.68rem;color:rgba(255,255,255,.5);margin-top:.15rem">' + _bgEsc(result.error || 'Unknown error') + '</div>';
    row.style.border = '1px solid rgba(239,68,68,.25)';
    return;
  }

  const g = result.grades || {};
  const finalGrade = g.final != null ? g.final.toFixed(1) : '—';
  const cornerG    = g.corners != null ? g.corners.toFixed(1) : '—';
  const edgeG      = g.edges != null ? g.edges.toFixed(1) : '—';
  const surfG      = g.surface != null ? g.surface.toFixed(1) : '—';
  const centG      = g.centering != null ? g.centering.toFixed(1) : '—';

  const gradeColor = (g.final || 0) >= 9 ? '#4ade80' : (g.final || 0) >= 7.5 ? 'var(--gold)' : '#f87171';

  let roiHtml = '';
  if (result.roi != null) {
    const roiColor = result.roi > 0 ? '#4ade80' : result.roi > -5 ? 'var(--gold)' : '#f87171';
    const roiVerdict = result.roi > 0 ? 'Worth grading' : result.roi > -5 ? 'Borderline' : 'Skip';
    roiHtml =
      '<div style="font-size:.68rem;color:' + roiColor + ';font-weight:700;margin-top:.2rem">' +
      roiVerdict + ': ' + (result.roi > 0 ? '+' : '') + '$' + result.roi.toFixed(2) +
      '</div>';
  }

  // Deep-grade badge + partial warning.
  const deepBadge = result.deepMode
    ? '<span style="font-size:.55rem;background:linear-gradient(135deg,#1e40af,#3b82f6);color:#fff;padding:.05rem .3rem;border-radius:3px;font-weight:900;margin-left:.25rem;vertical-align:middle">DEEP</span>'
    : '';
  const partialLine = result.partial
    ? '<div style="font-size:.62rem;color:#f59e0b;margin-top:.15rem">⚠️ ' + _bgEsc(result.error || 'Back unclear — front only') + '</div>'
    : '';

  body.innerHTML =
    '<div style="font-size:.78rem;color:#fff;font-weight:700;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
      _bgEsc(result.cardName) + deepBadge +
    '</div>' +
    '<div style="font-size:.66rem;color:rgba(255,255,255,.5);margin-top:.1rem">' +
      _bgEsc([result.setName, result.cardNumber].filter(Boolean).join(' · ')) +
    '</div>' +
    '<div style="display:flex;gap:.5rem;margin-top:.25rem;align-items:baseline;flex-wrap:wrap">' +
      '<span style="font-size:.95rem;font-weight:900;color:' + gradeColor + '">Grade ' + finalGrade + '</span>' +
      '<span style="font-size:.62rem;color:rgba(255,255,255,.45)">C ' + cornerG + ' · E ' + edgeG + ' · S ' + surfG + ' · Ctr ' + centG + '</span>' +
    '</div>' +
    partialLine +
    roiHtml;
  row.style.border = '1px solid rgba(196,122,0,.35)';
  // Make the row tappable to open the detail view (only successful grades).
  row.style.cursor = 'pointer';
  row.setAttribute('role', 'button');
  const idx = parseInt(rowId.replace('bulk-grade-row-',''), 10);
  row.onclick = function() { openBulkGradeDetail(idx); };
  // Add a small chevron on the right so it's clear the row is tappable.
  if (!row.querySelector('.bg-detail-chev')) {
    const chev = document.createElement('div');
    chev.className = 'bg-detail-chev';
    chev.style.cssText = 'flex-shrink:0;color:rgba(255,255,255,.35);font-size:1rem;padding-left:.25rem';
    chev.textContent = '›';
    row.appendChild(chev);
  }
}

/* Open the full grade detail for a completed bulk row.
   Renders into #bulkGradeDetail (a full-screen section inside the overlay)
   and hides the results list until the user hits ← Back. */
function openBulkGradeDetail(idx) {
  const r = (window._bulkGradeResults || [])[idx];
  if (!r || !r.success) return;
  const panel = document.getElementById('bulkGradeDetail');
  if (!panel) return;
  const g = r.grades || {};
  const finalGrade = g.final != null ? g.final.toFixed(1) : '—';
  const gradeColor = (g.final || 0) >= 9 ? '#4ade80' : (g.final || 0) >= 7.5 ? 'var(--gold)' : '#f87171';
  const subGrades = [
    { k: 'Centering', v: g.centering, note: 'How well the border is aligned front-to-back' },
    { k: 'Corners',   v: g.corners,   note: 'Sharpness of all four corners; whitening or nicks hurt this' },
    { k: 'Edges',     v: g.edges,     note: 'Edge whitening, dings, and print-line flaws' },
    { k: 'Surface',   v: g.surface,   note: 'Print lines, scratches, holo scuffs, and gloss' },
  ];
  const roiBlock = (r.rawPrice > 0 && r.gradedPrice > 0)
    ? '<div style="padding:.75rem;background:rgba(196,122,0,.06);border:1px solid rgba(196,122,0,.2);border-radius:10px;margin-top:.75rem">' +
        '<div style="font-size:.72rem;font-weight:800;color:var(--gold-text);margin-bottom:.4rem">Grading ROI</div>' +
        '<div style="display:flex;gap:.75rem;flex-wrap:wrap;font-size:.72rem;color:rgba(255,255,255,.75)">' +
          '<div>Raw: <strong style="color:#fff">$' + r.rawPrice.toFixed(2) + '</strong></div>' +
          '<div>PSA 10: <strong style="color:#fff">$' + r.gradedPrice.toFixed(2) + '</strong></div>' +
          '<div>Net after 13% fees + $25 grading: <strong style="color:' + (r.roi > 0 ? '#4ade80' : '#f87171') + '">' + (r.roi > 0 ? '+' : '') + '$' + r.roi.toFixed(2) + '</strong></div>' +
        '</div>' +
      '</div>'
    : '';
  const partialWarning = r.partial
    ? '<div style="padding:.6rem .75rem;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:8px;font-size:.72rem;color:#fbbf24;margin-top:.75rem">⚠️ Only the front photo produced a grade. Back-side sub-grades were skipped.</div>'
    : '';
  panel.innerHTML =
    '<div style="display:flex;align-items:center;gap:.5rem;padding:.7rem .75rem;border-bottom:1px solid rgba(255,255,255,.08);position:sticky;top:0;background:#0a0a0a;z-index:2">' +
      '<button onclick="closeBulkGradeDetail()" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:#fff;padding:.4rem .7rem;border-radius:8px;font-size:.75rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:.35rem">← Back to bulk</button>' +
      '<div style="flex:1"></div>' +
      (r.deepMode ? '<span style="font-size:.6rem;background:linear-gradient(135deg,#1e40af,#3b82f6);color:#fff;padding:.2rem .45rem;border-radius:4px;font-weight:900">DEEP</span>' : '') +
    '</div>' +
    '<div style="flex:1;overflow-y:auto;padding:1rem 1rem 2rem">' +
      '<div style="display:flex;gap:.85rem;align-items:flex-start">' +
        (r.imageDataUrl ? '<img src="' + r.imageDataUrl + '" style="width:90px;height:126px;object-fit:cover;border-radius:8px;flex-shrink:0" />' : '') +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:1rem;font-weight:800;color:#fff;line-height:1.25">' + _bgEsc(r.cardName) + '</div>' +
          '<div style="font-size:.72rem;color:rgba(255,255,255,.55);margin-top:.15rem">' + _bgEsc([r.setName, r.cardNumber].filter(Boolean).join(' · ')) + '</div>' +
          '<div style="display:flex;align-items:baseline;gap:.5rem;margin-top:.5rem">' +
            '<span style="font-size:2rem;font-weight:900;color:' + gradeColor + ';line-height:1">' + finalGrade + '</span>' +
            '<span style="font-size:.7rem;color:rgba(255,255,255,.5)">Est. PSA grade</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      partialWarning +
      roiBlock +
      '<div style="margin-top:1rem">' +
        '<div style="font-size:.75rem;font-weight:800;color:#fff;margin-bottom:.5rem">Sub-grades — why this score</div>' +
        subGrades.map(sg => {
          const val = sg.v != null ? sg.v.toFixed(1) : '—';
          const col = (sg.v || 0) >= 9 ? '#4ade80' : (sg.v || 0) >= 7.5 ? 'var(--gold)' : '#f87171';
          return '<div style="padding:.55rem .7rem;background:#111;border:1px solid #1e1e1e;border-radius:8px;margin-bottom:.4rem">' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
              '<span style="font-size:.78rem;font-weight:700;color:#fff">' + sg.k + '</span>' +
              '<span style="font-size:.95rem;font-weight:900;color:' + col + '">' + val + '</span>' +
            '</div>' +
            '<div style="font-size:.65rem;color:rgba(255,255,255,.5);margin-top:.15rem">' + sg.note + '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<div style="font-size:.65rem;color:rgba(255,255,255,.4);margin-top:.75rem;line-height:1.5">Final grade is the floor of the minimum sub-grade to the nearest 0.5 (PSA-style stricter weighting). Sub-grades come from Ximilar’s vision model.</div>' +
    '</div>';
  panel.style.display = 'flex';
}
function closeBulkGradeDetail() {
  const panel = document.getElementById('bulkGradeDetail');
  if (panel) panel.style.display = 'none';
}

function _bgEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

function _bulkGradeFinish() {
  window._bulkGradeProcessing = false;
  document.getElementById('bulkGradeProgressBar').style.width = '100%';
  document.getElementById('bulkGradeProgressLabel').textContent = 'Done!';

  const results = window._bulkGradeResults || [];
  const successCount = results.filter(r => r.success).length;
  const failCount    = results.filter(r => !r.success).length;
  const worthGrading = results.filter(r => r.success && r.roi != null && r.roi > 0).length;

  document.getElementById('bulkGradeSummaryLine').innerHTML =
    '<strong style="color:#fff">' + successCount + ' graded' + (failCount ? ' · ' + failCount + ' failed' : '') + '</strong>' +
    (worthGrading > 0 ? ' · <span style="color:#4ade80">' + worthGrading + ' worth submitting to PSA</span>' : '');

  document.getElementById('bulkGradeBottomBar').style.display = '';

  try {
    window.trackEvent && window.trackEvent('bulk_grade_complete', {
      count: String(results.length),
      success: String(successCount),
      worth_grading: String(worthGrading),
    });
  } catch(_) {}
}

/* Export current Bulk Grade results as CSV download. */
function exportBulkGradeCSV() {
  const results = (window._bulkGradeResults || []).filter(r => r.success);
  if (!results.length) { showToast('No graded cards to export.'); return; }
  const header = ['Card', 'Set', 'Number', 'Final Grade', 'Corners', 'Edges', 'Surface', 'Centering', 'Raw Price', 'Est Graded Price', 'Grading ROI'];
  const rows = results.map(r => [
    r.cardName, r.setName, r.cardNumber,
    r.grades?.final ?? '', r.grades?.corners ?? '', r.grades?.edges ?? '',
    r.grades?.surface ?? '', r.grades?.centering ?? '',
    r.rawPrice ?? '', r.gradedPrice ?? '', r.roi != null ? r.roi.toFixed(2) : '',
  ]);
  const csv = [header, ...rows].map(row =>
    row.map(v => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cardresell-bulk-grade-' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 500);
  try { window.trackEvent && window.trackEvent('bulk_grade_export_csv', { count: String(results.length) }); } catch(_){}
}

/* Save all successful Bulk Grade results into the Collection as graded flips. */
function saveBulkGradeToCollection() {
  const results = (window._bulkGradeResults || []).filter(r => r.success);
  if (!results.length) { showToast('No graded cards to save.'); return; }

  try {
    // Reuse existing flips storage. Each row becomes a graded flip entry.
    // 2026-09-04: this used to read/write localStorage['flips'] directly. Every
    // other data helper goes through getUserKey('flips') -> cardsell_<uid>_flips,
    // so a paid Bulk Grade batch reported "Saved N graded cards" and then wrote
    // to a key no renderer reads. Use the scoped helpers.
    const flips = loadFlipsData();
    const now = new Date().toISOString().slice(0, 10);
    let added = 0;
    for (const r of results) {
      const finalG = r.grades?.final;
      const gradeLabel = finalG != null ? 'PSA ' + finalG.toFixed(1) + ' (AI est)' : 'AI graded';
      flips.push({
        id: 'bulk_grade_' + Date.now() + '_' + added,
        updatedAt: Date.now(),
        cardName: r.cardName || 'Unknown card',
        setName: [r.setName, r.cardNumber, gradeLabel].filter(Boolean).join(' · '),
        buyPrice: 0,
        sellPrice: null,
        platform: '',
        date: now,
        currentValue: r.gradedPrice || r.rawPrice || 0,
        thumbnail: r.imageDataUrl || '',
        aiGrade: finalG,
        isGraded: true,
        _bulkGraded: true,
      });
      added++;
    }
    saveFlipsData(flips);
    showToast('✓ Saved ' + added + ' graded cards to Collection', 'gold');
    try { window.trackEvent && window.trackEvent('bulk_grade_saved', { count: String(added) }); } catch(_){}
    // Refresh collection UI. renderFlips has never existed under that name --
    // the real renderer is renderFlipsView -- so the saved rows only appeared
    // after a reload.
    try { if (typeof renderFlipsView === 'function') renderFlipsView(); } catch(_) {}
    try { _maybeRerenderCollection(true); } catch(_) {}
  } catch(err) {
    console.warn('[bulk-grade] save failed', err);
    showToast('⚠️ Could not save to Collection. Try again.');
  }
}

/* =========================================================
   BULK SCAN MODE
   ========================================================= */

window._bulkQueue       = [];   // array of {file, objectUrl} waiting to be processed
window._bulkResults     = [];   // array of scan result objects
window._bulkMode        = null; // 'camera' | 'upload'
window._bulkProcessing  = false;

function openBulkScan() {
  if (!window.googleUser) {
    showToast('Sign in with Google first to use Bulk Scan');
    return;
  }
  // Reset state
  window._bulkQueue         = [];
  window._bulkResults       = [];
  window._bulkMode          = null;
  window._bulkProcessing    = false;
  window._bulkSaved         = false;
  window._bulkStartPackCost = 0;

  // Reset the up-front pack-cost input each time the modal opens.
  const startCostEl = document.getElementById('bulkStartPackCost');
  if (startCostEl) startCostEl.value = '';
  const trackerEl = document.getElementById('bulkPackTracker');
  if (trackerEl) trackerEl.style.display = 'none';

  // Show overlay in mode-picker state
  const ov = document.getElementById('bulkScanOverlay');
  ov.style.display = 'flex';
  _dialogOpened('bulkScanOverlay');
  _bulkShowSection('modePicker');
  document.getElementById('bulkScanSubtitle').textContent = '1 credit per card';
}

// Update the live "Pack Recovery" tracker shown above the results list.
// Called after every card scan. Total value = sum of marketPrice across all
// successful scans so far. If no pack cost was entered, the tracker stays hidden.
function _bulkUpdatePackTracker() {
  const cost = parseFloat(window._bulkStartPackCost) || 0;
  const trackerEl = document.getElementById('bulkPackTracker');
  if (!trackerEl) return;
  if (cost <= 0) { trackerEl.style.display = 'none'; return; }
  trackerEl.style.display = '';

  const results = window._bulkResults || [];
  // 2026-09-04: qty was ignored here, so a row marked x3 contributed ONE card's
  // market price to "recovered so far". Every other surface in this flow
  // (cost split, the row pill, the save) multiplies by qty, so the tracker was
  // the only place three copies counted as one -- it under-reported recovery
  // and told users they were further from break-even than they actually were.
  const total = results.reduce((s, r) => {
    const p = (r && r.success && typeof r.marketPrice === 'number') ? r.marketPrice : 0;
    const qty = (r && r.qty && r.qty > 1) ? r.qty : 1;
    return s + (p > 0 ? p * qty : 0);
  }, 0);
  const pct = Math.min(100, (total / cost) * 100);
  const fmt = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2);

  const amtEl  = document.getElementById('bulkPackTrackerAmt');
  const goalEl = document.getElementById('bulkPackTrackerGoal');
  const pctEl  = document.getElementById('bulkPackTrackerPct');
  const barEl  = document.getElementById('bulkPackTrackerBar');
  const stEl   = document.getElementById('bulkPackTrackerStatus');
  if (amtEl)  amtEl.textContent  = fmt(total);
  if (goalEl) goalEl.textContent = 'of ' + fmt(cost);
  if (pctEl)  pctEl.textContent  = pct.toFixed(0) + '%';
  if (barEl)  barEl.style.width  = Math.min(100, pct) + '%';

  if (stEl) {
    if (total >= cost && cost > 0) {
      const profit = total - cost;
      stEl.innerHTML = '<span style="color:#4ade80;font-weight:700">\u2713 Broke even</span>' +
        (profit > 0 ? ' \u00b7 +' + fmt(profit) + ' profit so far' : '');
      if (pctEl) pctEl.style.color = '#4ade80';
      if (barEl) barEl.style.background = 'linear-gradient(90deg,#4ade80,#22c55e)';
    } else {
      const remaining = cost - total;
      stEl.textContent = fmt(remaining) + ' to break even';
      if (pctEl) pctEl.style.color = '#a78bfa';
      if (barEl) barEl.style.background = 'linear-gradient(90deg,#a78bfa,#4ade80)';
    }
  }
}

function closeBulkScan() {
  const ov = document.getElementById('bulkScanOverlay');
  ov.style.display = 'none';
  _dialogClosed('bulkScanOverlay');
  window._bulkProcessing = false;
  window._bulkPaused     = false;
  // Clean up object URLs
  (window._bulkQueue || []).forEach(q => { try { URL.revokeObjectURL(q.objectUrl); } catch(e){} });
  (window._bulkResults || []).forEach(r => { try { URL.revokeObjectURL(r.objectUrl); } catch(e){} });
  window._bulkQueue   = [];
  window._bulkResults = [];
  window._bulkSaved   = false;
  window._bulkMode    = null; // stops Rapid Scan loop
  // Hide the floating "Back to Bulk Scan" pill — session is fully over
  try { if (typeof _hideBackToBulkPill === 'function') _hideBackToBulkPill(); } catch(e) {}
}

function _bulkShowSection(section) {
  // section: 'modePicker' | 'rapidCam' | 'creditConfirm' | 'processing' | 'costSheet'
  document.getElementById('bulkModePicker').style.display     = section === 'modePicker'    ? 'flex' : 'none';
  const rapidEl = document.getElementById('bulkRapidCam');
  if (rapidEl) rapidEl.style.display                           = section === 'rapidCam'      ? 'flex' : 'none';
  document.getElementById('bulkCreditConfirm').style.display  = section === 'creditConfirm' ? 'flex' : 'none';
  document.getElementById('bulkProcessing').style.display     = section === 'processing'    ? 'flex' : 'none';
  document.getElementById('bulkCostSheet').style.display      = section === 'costSheet'     ? 'flex' : 'none';
  // Leaving rapidCam — stop the live camera to release the hardware.
  if (section !== 'rapidCam' && window._bulkRapidStream) {
    try { window._bulkRapidStream.getTracks().forEach(t => t.stop()); } catch(_) {}
    window._bulkRapidStream = null;
    try { _bulkRapidStopQA(); } catch(_) {}
  }
}

/* ── Rapid Scan mode: opens a live camera feed via getUserMedia. Each shutter
   tap grabs a still frame from the video element into a hidden canvas, no
   native camera picker involved, no gesture chain to lose. Filmstrip shows
   captured thumbs; Done routes into the normal credit-confirm → processing
   pipeline. If the browser lacks getUserMedia or the user denies permission,
   we send them to Upload photos instead. ── */
async function startBulkRapid() {
  window._bulkMode = 'rapid';
  // Feature-detect — iOS Safari needs 11+, Android Chrome always has it.
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Live camera not supported here — use Upload photos instead.');
    window._bulkMode = null;
    return;
  }
  // Reset queue for this rapid session
  (window._bulkQueue || []).forEach(q => { try { URL.revokeObjectURL(q.objectUrl); } catch(_){} });
  window._bulkQueue = [];
  _bulkRapidRenderStrip();
  _bulkRapidUpdateCounter();
  _bulkShowSection('rapidCam');

  const video = document.getElementById('bulkRapidVideo');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 1920 },
        height: { ideal: 1440 }
      },
      audio: false
    });
    window._bulkRapidStream = stream;
    video.srcObject = stream;
    await video.play().catch(()=>{});
    // Wire zoom (pinch + slider) once video is playing
    try {
      if (window._bulkRapidZoomTeardown) window._bulkRapidZoomTeardown();
      window._bulkRapidZoomTeardown = _camZoomBind(
        video, stream,
        document.getElementById('bulkRapidZoomSlider'),
        document.getElementById('bulkRapidZoomLabel'),
        document.getElementById('bulkRapidZoomWrap')
      );
    } catch(_){}
    // Kick off the live QA analyzer once video has real dimensions.
    _bulkRapidStartQA();
  } catch(err) {
    console.warn('[rapid] getUserMedia failed', err);
    showToast('⚠️ Camera permission needed for Rapid Scan.');
    _bulkShowSection('modePicker');
    window._bulkMode = null;
  }
}

/* ── Live QA analyzer for Rapid Scan ─────────────────────────────────────
   Samples a downsampled frame (~96x134) every 250ms while the rapid camera
   is on. Runs four cheap checks:
     • brightness (mean luma)              → too dark / too bright
     • blur (Laplacian variance in centre) → blurry / hold steady
     • card-in-frame (border vs centre)    → card not in the guide
     • glare (bright-pixel clustering)     → hotspot on card face
   Renders one hint pill at the bottom (highest-priority active issue only
   — stacking them causes flicker). Advisory: the shutter is never
   disabled. Debounces on/off transitions so a wobbly middle-band value
   doesn't strobe the pill.
   ==================================================================== */
window._bulkRapidQATimer   = null;
window._bulkRapidQACanvas  = null;
window._bulkRapidQAState   = null; // last committed hint id
window._bulkRapidQAStreak  = 0;    // consecutive samples agreeing with candidate
window._bulkRapidQACand    = null; // candidate hint id we're building consensus for

function _bulkRapidStopQA() {
  if (window._bulkRapidQATimer) { clearInterval(window._bulkRapidQATimer); window._bulkRapidQATimer = null; }
  window._bulkRapidQAState  = null;
  window._bulkRapidQAStreak = 0;
  window._bulkRapidQACand   = null;
  _bulkRapidRenderQA(null);
}

function _bulkRapidStartQA() {
  _bulkRapidStopQA();
  if (!window._bulkRapidQACanvas) {
    const c = document.createElement('canvas');
    c.width = 96; c.height = 134; // ~card aspect at low res
    window._bulkRapidQACanvas = c;
  }
  window._bulkRapidQATimer = setInterval(_bulkRapidQATick, 250);
}

function _bulkRapidQATick() {
  const video = document.getElementById('bulkRapidVideo');
  if (!video || !video.videoWidth) return;
  // If the section is no longer rapidCam, stop
  const rapid = document.getElementById('bulkRapidCam');
  if (!rapid || rapid.style.display === 'none') { _bulkRapidStopQA(); return; }

  const c = window._bulkRapidQACanvas;
  const ctx = c.getContext('2d', { willReadFrequently: true });

  // Draw the video into the small canvas using object-fit:cover semantics so
  // the sampled region matches what the user sees inside the frame.
  const vw = video.videoWidth, vh = video.videoHeight;
  const cw = c.width, ch = c.height;
  const vAspect = vw / vh, cAspect = cw / ch;
  let sx, sy, sw, sh;
  if (vAspect > cAspect) { sh = vh; sw = vh * cAspect; sx = (vw - sw) / 2; sy = 0; }
  else                   { sw = vw; sh = vw / cAspect; sx = 0;             sy = (vh - sh) / 2; }
  try { ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch); }
  catch(_) { return; }

  let data;
  try { data = ctx.getImageData(0, 0, cw, ch).data; }
  catch(_) { return; }

  const N = cw * ch;
  let sumLuma = 0, hotCount = 0;
  const luma = new Float32Array(N);
  // Luma pass + glare count (very bright + low colour saturation ≈ spec highlight)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i], g = data[i+1], b = data[i+2];
    const y = 0.299*r + 0.587*g + 0.114*b;
    luma[p] = y; sumLuma += y;
    if (y > 245) {
      const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
      if (maxC - minC < 22) hotCount++;
    }
  }
  const meanLuma = sumLuma / N;

  // Border vs centre luma — if border activity approaches centre activity,
  // the card isn't filling the frame.
  let borderSum = 0, borderN = 0, centerSum = 0, centerN = 0;
  const bx0 = Math.round(cw * 0.10), bx1 = Math.round(cw * 0.90);
  const by0 = Math.round(ch * 0.10), by1 = Math.round(ch * 0.90);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const v = luma[y*cw + x];
      if (x < bx0 || x > bx1 || y < by0 || y > by1) { borderSum += v; borderN++; }
      else                                          { centerSum += v; centerN++; }
    }
  }
  const borderMean = borderSum / Math.max(1, borderN);
  const centerMean = centerSum / Math.max(1, centerN);

  // Blur: Laplacian variance over the centre region only (background clutter
  // in the border shouldn't rescue a soft card).
  let lapSum = 0, lapSqSum = 0, lapN = 0;
  for (let y = by0 + 1; y < by1 - 1; y++) {
    for (let x = bx0 + 1; x < bx1 - 1; x++) {
      const i = y*cw + x;
      const lap = -4*luma[i] + luma[i-1] + luma[i+1] + luma[i-cw] + luma[i+cw];
      lapSum   += lap;
      lapSqSum += lap*lap;
      lapN++;
    }
  }
  const lapMean = lapSum / Math.max(1, lapN);
  const lapVar  = (lapSqSum / Math.max(1, lapN)) - lapMean*lapMean;

  // 2026-08-31: readable-not-perfect rule.
  // Old rule fired "Card not in the frame" whenever border luma > 88% of
  // center luma. On a bright wood table the border luma is high whether
  // or not the card is centered, so it fired on perfectly readable cards
  // (user screenshots IMG_4046-4048). The ID pipeline handles rotated,
  // off-center, and cropped cards fine \u2014 so the assistant should not
  // demand pixel-perfect alignment. It only needs to warn when the photo
  // will actually be unreadable: too dark, too bright, blown-out glare,
  // heavy blur, or genuinely no card in the frame at all.
  //
  // "No card at all" = the frame is nearly uniform (very low Laplacian
  // variance and very low luma range) which means we're staring at a
  // blank surface, not a card.
  //
  // When none of those fire, we return null \u2192 the renderer shows a green
  // "Looks good \u2014 tap the shutter" confirmation instead of hiding the bar.
  let hint = null;
  if (meanLuma < 42) {
    hint = { id: 'dark',  icon: '🌙', text: 'Too dark \u2014 more light please' };
  } else if (meanLuma > 220) {
    hint = { id: 'bright',icon: '☀️', text: 'Too bright \u2014 ease off the light' };
  } else if (hotCount > N * 0.020) {
    // Raised from 1.2% to 2.0% \u2014 holo cards legitimately have small
    // shiny spots that are not user-fixable glare.
    hint = { id: 'glare', icon: '✨', text: 'Glare on the card \u2014 tilt slightly' };
  } else if (lapVar < 40) {
    // Lowered from 55 to 40 \u2014 tighter cameras produce lower Laplacian
    // variance even on sharp images; 55 was firing on in-focus phone shots.
    hint = { id: 'blur',  icon: '💨', text: 'Blurry \u2014 hold steady' };
  } else if (lapVar < 25 && (centerMean < 18 || Math.abs(centerMean - borderMean) < 3)) {
    // Genuine "no card visible" state: flat, low-detail frame.
    hint = { id: 'empty', icon: '📷', text: 'Point the camera at your card' };
  }

  // Debounce: require 2 consecutive samples (~500ms) agreeing before we
  // switch state on OR off. Prevents strobing between neighbouring hints.
  const candId = hint ? hint.id : null;
  if (candId === window._bulkRapidQACand) {
    window._bulkRapidQAStreak++;
  } else {
    window._bulkRapidQACand   = candId;
    window._bulkRapidQAStreak = 1;
  }
  if (window._bulkRapidQAStreak >= 2 && window._bulkRapidQAState !== candId) {
    window._bulkRapidQAState = candId;
    _bulkRapidRenderQA(hint);
  }
}

function _bulkRapidRenderQA(hint) {
  const bar   = document.getElementById('bulkRapidQABar');
  const icon  = document.getElementById('bulkRapidQAIcon');
  const text  = document.getElementById('bulkRapidQAText');
  const pill  = document.getElementById('bulkRapidQAPill');
  const frame = document.getElementById('bulkRapidFrame');
  if (!bar) return;
  // 2026-08-31: When no hint fires, actively confirm the frame is good
  // instead of hiding the bar. Users read silence as "the app isn't working"
  // or worse, "the app hates my card." Explicit green confirmation removes
  // that ambiguity and tells them the shutter is the next action.
  if (!hint) {
    if (icon) icon.textContent = '\u2713'; // check mark
    if (text) text.textContent = 'Looks good \u2014 tap the shutter';
    bar.style.display = 'flex';
    if (pill) {
      pill.style.background  = 'rgba(34,197,94,.92)';   // green
      pill.style.borderColor = 'rgba(134,239,172,.55)';
      pill.style.color       = '#062611';
    }
    if (frame) {
      frame.style.borderColor = 'rgba(74,222,128,.9)'; // green
      frame.style.boxShadow   = '0 0 0 9999px rgba(0,0,0,.35), 0 0 22px rgba(74,222,128,.4)';
    }
    return;
  }
  if (icon) icon.textContent = hint.icon;
  if (text) text.textContent = hint.text;
  bar.style.display = 'flex';
  // Colour cue on the pill and frame depending on severity.
  if (pill) {
    pill.style.background  = 'rgba(196,122,0,.92)';
    pill.style.borderColor = 'rgba(255,224,120,.55)';
    pill.style.color       = '#111';
  }
  if (frame) {
    frame.style.borderColor = 'rgba(255,196,80,.9)'; // amber
    frame.style.boxShadow   = '0 0 0 9999px rgba(0,0,0,.35)';
  }
}

function closeBulkRapid() {
  // Discard the rapid session and return to mode picker.
  try { _bulkRapidStopQA(); } catch(_) {}
  try { if (window._bulkRapidZoomTeardown) window._bulkRapidZoomTeardown(); } catch(_) {}
  window._bulkRapidZoomTeardown = null;
  // Stop the camera stream so the phone LED turns off.
  try {
    const s = window._bulkRapidStream;
    if (s) s.getTracks().forEach(t => t.stop());
  } catch(_){}
  window._bulkRapidStream = null;
  (window._bulkQueue || []).forEach(q => { try { URL.revokeObjectURL(q.objectUrl); } catch(_){} });
  window._bulkQueue = [];
  window._bulkMode  = null;
  _bulkShowSection('modePicker');
}

function bulkRapidSnap() {
  const video  = document.getElementById('bulkRapidVideo');
  const canvas = document.getElementById('bulkRapidCanvas');
  if (!video || !video.videoWidth) { showToast('Camera still loading…'); return; }

  // Flash animation
  const flash = document.getElementById('bulkRapidFlash');
  if (flash) {
    flash.style.opacity = '.85';
    setTimeout(() => { flash.style.opacity = '0'; }, 120);
  }

  // Draw current frame full-res into the offscreen canvas
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(blob => {
    if (!blob) { showToast('Capture failed — try again'); return; }
    const file = new File([blob], 'rapid_' + Date.now() + '.jpg', { type: 'image/jpeg' });
    const objectUrl = URL.createObjectURL(blob);
    window._bulkQueue.push({ file, objectUrl });
    _bulkRapidRenderStrip();
    _bulkRapidUpdateCounter();
  }, 'image/jpeg', 0.9);
}

function _bulkRapidUpdateCounter() {
  const n = (window._bulkQueue || []).length;
  const counter = document.getElementById('bulkRapidCounter');
  if (counter) counter.textContent = n + ' queued';
  const done = document.getElementById('bulkRapidDoneBtn');
  if (done) {
    done.disabled = n === 0;
    done.style.opacity = n === 0 ? '.5' : '1';
  }
}

function _bulkRapidRenderStrip() {
  const strip = document.getElementById('bulkRapidStrip');
  if (!strip) return;
  const queue = window._bulkQueue || [];
  strip.innerHTML = queue.slice(-8).map((q, i) => {
    const idx = queue.length - Math.min(8, queue.length) + i;
    return '<div style="position:relative;flex-shrink:0;width:44px;height:60px;border-radius:6px;overflow:hidden;border:1.5px solid rgba(139,92,246,.55);background:#111">' +
           '<img src="' + q.objectUrl + '" style="width:100%;height:100%;object-fit:cover" />' +
           '<button onclick="_bulkRapidRemove(' + idx + ')" style="position:absolute;top:-2px;right:-2px;width:18px;height:18px;padding:0;background:rgba(0,0,0,.85);border:1px solid #333;color:#fff;border-radius:50%;font-size:.65rem;font-weight:900;cursor:pointer;line-height:1">×</button>' +
           '</div>';
  }).join('');
}

function _bulkRapidRemove(idx) {
  const queue = window._bulkQueue || [];
  if (idx < 0 || idx >= queue.length) return;
  try { URL.revokeObjectURL(queue[idx].objectUrl); } catch(_){}
  queue.splice(idx, 1);
  _bulkRapidRenderStrip();
  _bulkRapidUpdateCounter();
}

function bulkRapidDone() {
  const queue = window._bulkQueue || [];
  if (!queue.length) { showToast('Snap at least one card first — no cards queued.'); return; }

  const credits = (window._idScanCredits || 0);
  const count   = queue.length;

  document.getElementById('bulkCreditConfirmIcon').textContent = '⚡';
  document.getElementById('bulkCreditConfirmMsg').innerHTML =
    '<strong style="color:#fff">' + count + ' card' + (count>1?'s':'') + ' captured</strong><br>' +
    'Ready to identify + price the whole stack. Each card uses 1 credit.';
  document.getElementById('bulkCreditConfirmCredit').textContent =
    'Uses ' + count + ' credit' + (count>1?'s':'') + ' · You have ' + credits + ' available';

  const startBtn = document.getElementById('bulkConfirmStartBtn');
  if (startBtn) startBtn.textContent = 'Scan All ⚡';

  // Remove the manual "Add Another" button if a previous camera session left one behind.
  const addAnother = document.getElementById('bulkAddAnotherBtn');
  if (addAnother) addAnother.remove();

  _bulkShowSection('creditConfirm'); // this call also stops the live stream
}

/* ── Upload mode: multi-file picker ── */
function startBulkUpload() {
  window._bulkMode = 'upload';
  document.getElementById('bulkUploadInput').click();
}

function processBulkUploadFiles(input) {
  const allFiles = Array.from(input.files || []);
  if (!allFiles.length) return;
  input.value = '';

  // Drop what we cannot decode BEFORE the credit-confirm screen quotes a
  // price, so the user is never asked to pay for photos we will fail on.
  const { okFiles: files, rejected } = _partitionScanFiles(allFiles);
  if (rejected.length) {
    const extra = rejected.length > 1 ? ' (' + rejected.length + ' photos skipped)' : '';
    if (typeof showToast === 'function') showToast(rejected[0].error + extra, 'info');
  }
  if (!files.length) return;

  window._bulkQueue = files.map(f => ({ file: f, objectUrl: URL.createObjectURL(f) }));

  const credits = (window._idScanCredits || 0);
  const count   = files.length;

  document.getElementById('bulkCreditConfirmIcon').textContent = '🖼️';
  document.getElementById('bulkCreditConfirmMsg').innerHTML =
    '<strong style="color:#fff">' + count + ' photo' + (count>1?'s':'') + ' selected</strong><br>' +
    'Ready to scan. Each card uses 1 credit.';
  document.getElementById('bulkCreditConfirmCredit').textContent =
    'Uses ' + count + ' credit' + (count>1?'s':'') + ' · You have ' + credits + ' available';

  // Remove "Add Another" if it exists (upload mode doesn't need it)
  const addAnother = document.getElementById('bulkAddAnotherBtn');
  if (addAnother) addAnother.remove();

  _bulkShowSection('creditConfirm');
}

function cancelBulkConfirm() {
  // Go back to mode picker, clear queue
  (window._bulkQueue || []).forEach(q => { try { URL.revokeObjectURL(q.objectUrl); } catch(e){} });
  window._bulkQueue = [];
  const addAnother = document.getElementById('bulkAddAnotherBtn');
  if (addAnother) addAnother.remove();
  _bulkShowSection('modePicker');
}

/* ── Price lookup: pokemontcg.io (replaces dead /api/ebay-sold Finding API) ── */
const BULK_CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'];
const BULK_CONDITION_LABELS = { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played', DMG: 'Damaged' };
const BULK_VARIANT_PRIORITY = ['holofoil', 'reverseHolofoil', 'normal', 'firstEditionHolofoil', 'firstEditionNormal', 'firstEdition'];

// 2026-09-04 (Bulbasaur #133): the scanner reported the name as
// "Bulbasaur (Mega Evolution Stamped)". pokemontcg.io returned ZERO rows for
// every query built from that string -- with the number, with the set, and
// name-only -- so the row rendered "Price unavailable" for a card the catalog
// holds and prices at ~$20.64. The parenthetical is a variant note the
// scanner adds; it is not part of the catalog name.
//
// Bracketed qualifiers ARE sometimes genuine ("Unown [A]" is a real, distinct
// card name), so the qualified name is still tried FIRST and the stripped
// form is only added as an extra, wider attempt. That is safe even for Unown,
// because the exact bracketed query returns zero rows anyway and the
// corroboration guard below still requires the number or set to agree before
// any price is shown.
function _bulkNameVariants(name) {
  const full = String(name || '').trim();
  const out = full ? [full] : [];
  const stripped = full
    .replace(/[\(\[][^)\]]*[\)\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Guard against a name that is ENTIRELY a qualifier, e.g. "(Promo)".
  if (stripped && stripped !== full) out.push(stripped);
  return out;
}

// Every /api/tcg-price fallback in the bulk path went out with the raw
// scanner name, so a parenthetical qualifier defeated the fallback for the
// same reason it defeated the primary lookup. Try each name spelling here
// too. Returns the priced payload or null; callers keep their own shapes.
async function _bulkTcgPriceFetch(name, number, setName, rarity) {
  for (const nm of _bulkNameVariants(name)) {
    try {
      const url = `/api/tcg-price?name=${encodeURIComponent(nm)}`
        + (number  ? '&number=' + encodeURIComponent(number)  : '')
        + (setName ? '&set='    + encodeURIComponent(setName) : '')
        + (rarity  ? '&rarity=' + encodeURIComponent(rarity)  : '');
      const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
      if (!r.ok) continue;
      const d = await r.json();
      if (d && d.market > 0) return d;
    } catch (_) {}
  }
  return null;
}

// A Response-shaped shim so the five existing fallback sites can adopt the
// helper without restructuring their parsing.
function _bulkTcgPriceShim(name, number, setName, rarity) {
  return {
    ok: true,
    json: async () => (await _bulkTcgPriceFetch(name, number, setName, rarity)) || {},
  };
}

// 2026-09-04 (Minun #194 misfire): a bulk row showed the scanner's identity
// ("Minun - Paradox Rift #194") next to a price and thumbnail belonging to a
// completely different card (POP Series 3 #4, $50.00, 2006 art). The match
// step took the top-scored candidate unconditionally, so when every candidate
// scored ZERO -- wrong number, wrong set, wrong rarity -- the sort was stable
// and the first arbitrary printing won. A row that corroborates nothing about
// the scanned card must not be shown as that card.
//
// Corroboration means the candidate agrees with the scanner on the number or
// on the set. Rarity alone is not enough: "Illustration Rare" is shared by
// hundreds of cards and would have re-admitted a wrong printing. When the
// scanner gave us neither a number nor a set there is nothing to contradict,
// so the candidate is allowed through.
function _bulkCandidateCorroborated(cand, targetSetName, targetNumber) {
  const wantNum = String(targetNumber || '').replace(/^0+/, '').toLowerCase().trim();
  const wantSet = String(targetSetName || '').trim();
  if (!wantNum && !wantSet) return true;
  if (wantNum) {
    const cn = String(cand?.number || '').replace(/^0+/, '').toLowerCase().trim();
    // "179a" vs "179" is the same card with a variant suffix; accept it.
    if (cn && (cn === wantNum || cn.replace(/[a-z]/g, '') === wantNum)) return true;
  }
  if (wantSet && _bulkSetMatchScore(cand?.set?.name, wantSet) >= 2) return true;
  return false;
}

function _bulkSetMatchScore(candidateSetName, targetSetName) {
  const a = (candidateSetName || '').toLowerCase().trim();
  const b = (targetSetName || '').toLowerCase().trim();
  if (!b) return 1; // no target to compare — treat as weak match, still usable
  if (!a) return 0;
  if (a === b) return 3;
  if (a.startsWith(b) || b.startsWith(a)) return 2;
  if (a.includes(b) || b.includes(a)) return 1.5;
  return 0;
}

// Fetch a card from pokemontcg.io with a fetch timeout. Returns the raw
// cards[] array or null on failure. Bumped from 4s→7s so slower networks
// don't produce false null returns (which is what caused bulk-scan cards
// to save with $0 + no thumbnail).
async function _bulkFetchPokemonCards(q, timeoutMs) {
  // 2026-08-17: pokemontcg.io intermittently 500s on multi-word / quoted
  // queries (e.g. `name:"Joltik" number:196` returned 500 during Rapid Scan
  // testing and blanked the image + price). Retry once on 5xx with a short
  // backoff — this recovers the vast majority of these transient failures
  // and keeps the scanned card's proper image + market price instead of
  // silently falling back to the user's raw photo.
  // 2026-09-04 (Minun #194): pageSize was 10. `name:"Minun"` returns 20
  // printings and Paradox Rift #194 is the LAST one, so the correct card was
  // truncated out of the candidate list before scoring ever ran and the row
  // rendered POP Series 3 #4 ($50.00, 2006 art) instead. Ask for the full set.
  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=250&select=id,name,set,number,rarity,images,tcgplayer`;
  const attempt = async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 7000);
    try {
      const resp = await fetch(url, { signal: ctrl.signal });
      if (!resp) return { ok: false, retriable: true };
      if (!resp.ok) return { ok: false, retriable: resp.status >= 500 };
      const json = await resp.json();
      return { ok: true, data: json.data || [] };
    } catch (e) {
      // Aborts / network errors are retriable
      return { ok: false, retriable: true };
    } finally {
      clearTimeout(t);
    }
  };
  let r = await attempt();
  if (!r.ok && r.retriable) {
    await new Promise(res => setTimeout(res, 400));
    r = await attempt();
  }
  return r.ok ? r.data : null;
}

// Route to the right DB per TCG. Bulk scanner used to always hit PokemonTCG.io,
// which broke Magic/Yu-Gi-Oh/Lorcana/JP-Pokemon results entirely (scan ID'd them
// but price fetch returned 0 matches → "Price unavailable" + no thumbnail).
async function _bulkFetchPriceMTG(cleanName, cleanNumber, setName) {
  // Scryfall search notes:
  // — Collector numbers are un-zero-padded ("87" not "087") — always strip.
  // — Query `name 087` returns 0 hits even when "87" would match; strip zeros.
  // — Diacritics in the scanned name ("Lüm-Dûl's") may mis-match Scryfall's
  //   ASCII stored forms; strip diacritics as a fallback query.
  //
  // 2026-08-21: STOP picking the most expensive printing. With `cn:175` on a
  // card that has both a base and Promos print (e.g. Berta, Wise Extrapolator
  // SOS #175 vs SOS Promos #175p), `order=usd desc` was returning the $1.01
  // promo when the user actually has the $0.32 base print. Now:
  //   1. Prefer an EXACT set-name match when setName is provided.
  //   2. Otherwise prefer the print whose collector number matches EXACTLY
  //      (no letter suffix like "175p").
  //   3. Sort `asc` so the cheapest (≈ base print) wins on final fallback.
  const stripDiacritics = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const numShort = cleanNumber ? String(cleanNumber).replace(/^0+/, '') : '';
  const cleanSet = setName ? String(setName).trim() : '';
  const queries = [
    numShort ? `${cleanName} cn:${numShort}` : '',
    `!"${cleanName}"`,      // exact-name match (unique per print)
    cleanName,              // fuzzy name only
    stripDiacritics(cleanName),
  ].filter(Boolean);

  const pickBest = (rows) => {
    if (!Array.isArray(rows) || !rows.length) return null;
    if (cleanSet) {
      const wantSet = cleanSet.toLowerCase();
      const setMatch = rows.filter(c => (c.set_name || '').toLowerCase() === wantSet);
      if (setMatch.length) {
        if (numShort) {
          const exact = setMatch.find(c => String(c.collector_number || '').replace(/^0+/, '') === numShort);
          if (exact) return exact;
        }
        return setMatch[0];
      }
    }
    if (numShort) {
      const exact = rows.find(c => String(c.collector_number || '').replace(/^0+/, '') === numShort);
      if (exact) return exact;
    }
    return rows[0];
  };

  for (const q of queries) {
    try {
      const r = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=usd&dir=asc`, { signal: AbortSignal.timeout(7000) });
      if (!r.ok) continue;
      const d = await r.json();
      const first = pickBest(d && d.data);
      if (!first) continue;
      const usd = parseFloat(first.prices?.usd) || parseFloat(first.prices?.usd_foil) || null;
      return {
        marketPrice: usd,
        variant: usd ? 'usd' : null,
        imageUrl: first.image_uris?.small || first.image_uris?.normal || first.card_faces?.[0]?.image_uris?.small || '',
        tcgplayerUrl: first.purchase_uris?.tcgplayer || '',
      };
    } catch(e) { /* try next */ }
  }
  return null;
}

async function _bulkFetchPriceYGO(cleanName) {
  // YGOProDeck's fname is fuzzy on name substring. Try full name first, then
  // fall back to first two words if the exact name misses (Yu-Gi-Oh names often
  // have long subtitles "Blue-Eyes White Dragon" that the AI trims).
  const tries = [cleanName];
  const words = cleanName.split(/\s+/).filter(Boolean);
  if (words.length > 2) tries.push(words.slice(0, 2).join(' '));
  for (const q of tries) {
    try {
      const r = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(q)}&num=5&offset=0`, { signal: AbortSignal.timeout(7000) });
      if (!r.ok) continue;
      const d = await r.json();
      const first = d?.data?.[0];
      if (!first) continue;
      const p = parseFloat(first.card_prices?.[0]?.tcgplayer_price) || null;
      return {
        marketPrice: p,
        variant: p ? 'tcgplayer' : null,
        imageUrl: first.card_images?.[0]?.image_url_small || first.card_images?.[0]?.image_url || '',
        tcgplayerUrl: '',
      };
    } catch(e) { /* try next */ }
  }
  return null;
}

// 2026-08-18: shared tcgcsv helper for non-Pokemon-EN bulk-scan price lookups.
// Used by Lorcana, One Piece, and Pokemon JP. Skipped for MTG (Scryfall
// is faster/richer) and YGO (existing YGOprodeck path works well).
async function _bulkFetchPriceViaTcgCsv(cleanName, cleanNumber, game, setName, rarity) {
  try {
    const params = new URLSearchParams({ name: cleanName, game });
    if (cleanNumber) params.set('number', cleanNumber);
    if (setName)     params.set('set', setName);
    if (rarity)      params.set('rarity', rarity);
    const r = await fetch(`/api/tcg-price?${params.toString()}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.market == null) return null;
    return {
      marketPrice: j.market,
      variant: j.variant || null,
      imageUrl: j.imageUrl || '',
      tcgplayerUrl: j.url || '',
    };
  } catch(e) { return null; }
}

async function _bulkFetchPriceLorcana(cleanName, cleanNumber, setName, rarity) {
  // Try tcgcsv first for real pricing; fall back to lorcana-api for image-only.
  const priced = await _bulkFetchPriceViaTcgCsv(cleanName, cleanNumber, 'lorcana', setName, rarity);
  if (priced) return priced;
  try {
    const r = await fetch(`https://api.lorcana-api.com/cards/fetch?search=Name~${encodeURIComponent(cleanName)}`, { signal: AbortSignal.timeout(7000) });
    if (!r.ok) return null;
    const arr = await r.json();
    const first = Array.isArray(arr) ? arr[0] : null;
    if (!first) return null;
    return {
      marketPrice: null,
      variant: null,
      imageUrl: first.Image || '',
      tcgplayerUrl: '',
    };
  } catch(e) { return null; }
}

async function _bulkFetchPriceOnePiece(cleanName, cleanNumber, setName, rarity) {
  return _bulkFetchPriceViaTcgCsv(cleanName, cleanNumber, 'onepiece', setName, rarity);
}

async function _bulkFetchPricePokemonJP(cleanName, cleanNumber, setName, rarity) {
  return _bulkFetchPriceViaTcgCsv(cleanName, cleanNumber, 'pokemonjp', setName, rarity);
}

async function _bulkFetchPrice(cardName, setName, cardNumber, cardType, isJapanese, groundedId, rarity) {
  if (!cardName) return null;
  const cleanName = String(cardName).replace(/["\\]/g, '').trim();
  if (!cleanName) return null;
  const cleanNumber = cardNumber ? String(cardNumber).replace(/\/.*$/, '').trim() : '';
  const type = (cardType || 'pokemon').toLowerCase();
  const cleanRarity = String(rarity || '').trim();

  // Route to the correct database. Falls back to Pokemon lookup for legacy
  // rows without cardType, but also as a last-ditch recovery when a non-Pokemon
  // DB returns nothing.
  if (type === 'mtg') return _bulkFetchPriceMTG(cleanName, cleanNumber, setName);
  if (type === 'yugioh' || type === 'ygo') return _bulkFetchPriceYGO(cleanName);
  if (type === 'lorcana') return _bulkFetchPriceLorcana(cleanName, cleanNumber, setName, cleanRarity);
  if (type === 'onepiece') return _bulkFetchPriceOnePiece(cleanName, cleanNumber, setName, cleanRarity);
  if (type === 'sports') {
    // 2026-09-04: this returned bare null, so the row rendered the generic
    // "Price unavailable" — indistinguishable from "we looked and found
    // nothing". No lookup runs at all here: sports has no card database, and
    // the priced route is the detail view's sportscardspro/eBay search. Say
    // that, instead of implying an empty result.
    return {
      marketPrice: null,
      variant: '',
      imageUrl: '',
      tcgplayerUrl: '',
      unavailableReason: 'Sports pricing lives in the card details — tap 🔍 for live comps.'
    };
  }
  // Pokemon Japan (isJapanese=true) goes through tcgcsv catalog 85 first.
  if (isJapanese) {
    const jp = await _bulkFetchPricePokemonJP(cleanName, cleanNumber, setName, cleanRarity);
    if (jp) return jp;
    // If PokemonJP misses, fall through to the standard Pokemon path below.
  }

  // 2026-08-17: grounded_id fast path. When Ximilar identifies the exact card
  // (e.g. "sv3pt5-181" for Ampharos IR), fetch that specific card from
  // pokemontcg.io by ID — skips the fuzzy name+number search that was picking
  // base Crobat #93 (Common $0.23) over IR Crobat #093 (Illustration Rare $8-25).
  if (groundedId && typeof groundedId === 'string' && groundedId.includes('-')) {
    // 2026-08-17: retry once on 5xx — pokemontcg.io direct-by-ID GETs also 500
    // intermittently, same class of flake as the name-search endpoint.
    let r = null;
    try { r = await fetch(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(groundedId)}`, { signal: AbortSignal.timeout(7000) }); } catch(_) {}
    if (r && !r.ok && r.status >= 500) {
      await new Promise(res => setTimeout(res, 400));
      try { r = await fetch(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(groundedId)}`, { signal: AbortSignal.timeout(7000) }); } catch(_) {}
    }
    try {
      if (r && r.ok) {
        const j = await r.json();
        const card = j?.data;
        if (card) {
          const prices = card.tcgplayer?.prices || {};
          const priceMap = {};
          let bestMarket = null, bestVariant = null;
          for (const variant of BULK_VARIANT_PRIORITY) {
            const p = prices[variant]; if (!p) continue;
            const market = typeof p.market === 'number' ? p.market : null;
            const mid = typeof p.mid === 'number' ? p.mid : null;
            const val = market != null ? market : mid;
            if (val != null) priceMap[variant] = val;
            if (val != null && (bestMarket == null || val > bestMarket)) { bestMarket = val; bestVariant = variant; }
          }
          for (const key of Object.keys(prices)) {
            if (BULK_VARIANT_PRIORITY.includes(key)) continue;
            const p = prices[key];
            const market = typeof p?.market === 'number' ? p.market : null;
            const mid = typeof p?.mid === 'number' ? p.mid : null;
            const val = market != null ? market : mid;
            if (val != null) priceMap[key] = val;
            if (val != null && (bestMarket == null || val > bestMarket)) { bestMarket = val; bestVariant = key; }
          }
          // If pokemontcg.io returned this card but no market price, fall through to /api/tcg-price live lookup
          if (bestMarket == null) {
            try {
              const r2 = _bulkTcgPriceShim(cleanName, cleanNumber, setName, '');
              if (r2.ok) {
                const d = await r2.json();
                if (d && d.market > 0) {
                  return { marketPrice: d.market, variant: 'tcgplayer_live',
                           imageUrl: card.images?.small || card.images?.large || d.imageUrl || d.image || null,
                           tcgplayerUrl: card.tcgplayer?.url || null,
                           matchedSet: card.set?.name || null, matchedNumber: card.number || null,
                           prices: priceMap };
                }
              }
            } catch(e) {}
          }
          return {
            marketPrice: bestMarket, variant: bestVariant,
            imageUrl: card.images?.small || card.images?.large || null,
            tcgplayerUrl: card.tcgplayer?.url || null,
            matchedSet: card.set?.name || null, matchedNumber: card.number || null,
            prices: priceMap,
          };
        }
      }
    } catch(e) { /* fall through to fuzzy search */ }
  }

  // Pokemon path (default). If the scanner marked this as Japanese, try the
  // /api/tcg-price live TCGplayer lookup FIRST — it queries TCGplayer directly
  // and works for many JP-only sets that pokemontcg.io doesn't index. If that
  // returns nothing, we still fall through to the pokemontcg.io name search
  // because many JP cards share the English character name.
  if (isJapanese) {
    try {
      const r = _bulkTcgPriceShim(cleanName, cleanNumber, setName, rarity);
      if (r.ok) {
        const d = await r.json();
        if (d && d.market > 0) {
          return { marketPrice: d.market, variant: 'tcgplayer_live', imageUrl: d.imageUrl || d.image || '', tcgplayerUrl: d.url || '' };
        }
      }
    } catch(e) {}
    // Fall through — many JP cards ALSO exist in English pokemontcg.io by name.
  }

  try {
    // Try three progressively broader queries. Bulk-scan cards that saved as
    // "$0 + no thumbnail" were mostly caused by a strict name+number query
    // returning zero matches (e.g. AI mis-read the number, or the card uses
    // an alphanumeric suffix like "179a"). Falling through to name-only
    // recovers the image + price for the vast majority of these.
    // 2026-09-04 (Minun #194): probing pokemontcg.io six times per form, every
    // form flaked about a third of the time, and the number query sometimes
    // returned an empty HTTP 200 -- indistinguishable from "no such card", so
    // the code fell through to the bare-name query and matched the wrong
    // printing. Add a set-scoped query in between: it is far more selective
    // than name-only, and it still answers when the number query comes back
    // empty. The bare-name query stays last as the widest net.
    // 2026-09-04: built over _bulkNameVariants so a scanner-added
    // parenthetical ("Bulbasaur (Mega Evolution Stamped)") cannot zero out
    // every query. Selective forms for BOTH name spellings come before either
    // bare-name query, so widening never costs precision.
    const _names = _bulkNameVariants(cleanName);
    const _setQ = setName ? String(setName).replace(/"/g, '') : '';
    const queries = [];
    for (const nm of _names) {
      if (cleanNumber) queries.push(`name:"${nm}" number:"${cleanNumber}"`);
      if (_setQ) queries.push(`name:"${nm}" set.name:"${_setQ}"`);
    }
    for (const nm of _names) queries.push(`name:"${nm}"`);

    let cards = null;
    for (const q of queries) {
      cards = await _bulkFetchPokemonCards(q, 7000);
      if (cards && cards.length) break;
    }
    // 2026-09-04: pokemontcg.io is the ONLY source consulted before this point,
    // and it is not reliable enough to be a single point of failure: a control
    // probe of 8 identical `name:"Mantyke"` queries returned HTTP 500 five
    // times (62%). When it flaked, this line returned null and the bulk row
    // rendered "Price unavailable" WITH NO THUMBNAIL — while /api/tcg-price
    // held both (Minun #194 $44.78, Cresselia #071 $26.49, Ivysaur #134
    // $19.64, Bulbasaur #133 $20.87, each with an imageUrl). Because the
    // failure is random per-request, the same 8-card batch produced a
    // DIFFERENT set of blank rows on every run, which is why this read as an
    // intermittent "misfire" rather than a missing-card bug.
    //
    // Fall back to /api/tcg-price (tcgcsv) before giving up. Only a real
    // no-data answer from BOTH sources may render "Price unavailable".
    if (!cards || !cards.length) {
      try {
        const rFb = _bulkTcgPriceShim(cleanName, cleanNumber, setName, cleanRarity);
        if (rFb.ok) {
          const d = await rFb.json();
          if (d && d.market > 0) {
            return {
              marketPrice: d.market,
              variant: d.variant || 'tcgplayer_live',
              imageUrl: d.imageUrl || d.image || null,
              tcgplayerUrl: d.url || null,
              matchedSet: d.setName || null,
              matchedNumber: d.cardNumber || null,
              prices: {},
            };
          }
        }
      } catch(_) {}
      return null;
    }

    // 2026-08-15: score by (number match × 10) + set match. When "Mega Lucario EX"
    // returns a regular #55, a full-art #113, and a secret rare #179 all from
    // Ancient Origins, set-name matching alone can't pick the right one — the
    // scanner-captured card number is the disambiguator. Weight number match
    // heavily so a number hit beats any set match tie.
    //
    // 2026-08-17: add rarity scoring × 15. When base Crobat #93 (Common, $0.23)
    // and IR Crobat #093 (Illustration Rare, $8-25) both match name+number,
    // the rarity from the scanner is the tie-breaker. Weight higher than number
    // so rarity match ALWAYS wins when both cards are named + numbered identically.
    const targetNumRaw = String(cleanNumber || '').replace(/^0+/, '').toLowerCase();
    const targetRarityLo = cleanRarity.toLowerCase();
    function _numScore(cand) {
      if (!targetNumRaw) return 0;
      const cn = String(cand.number || '').replace(/^0+/, '').toLowerCase();
      if (!cn) return 0;
      // 2026-09-04: these were 10 and 8, BELOW the rarity weight of 15. That
      // let a rarity guess beat the printed card number: scanning Okidogi ex
      // #90 (Special Illustration Rare, $22.63) while the scanner reported
      // "Double Rare" selected Shrouded Fable #36 ($0.89), because #36 scored
      // 0+3+15=18 against #90's 10+3+0=13. The number is printed on the card
      // in plain digits; the rarity is inferred from the art treatment, so the
      // number is the more trustworthy signal and must dominate. Rarity still
      // decides between candidates that share a number -- base Crobat #93 vs
      // Illustration Rare Crobat #093 both score 30 here and are separated by
      // rarity, which is the case the rarity weight was added for.
      if (cn === targetNumRaw) return 30;                // exact
      if (cn.replace(/[a-z]/g,'') === targetNumRaw) return 24; // "179a" vs "179"
      return 0;
    }
    function _rarityScore(cand) {
      if (!targetRarityLo) return 0;
      const cr = String(cand.rarity || '').toLowerCase();
      if (!cr) return 0;
      if (cr === targetRarityLo) return 15;                          // exact rarity match
      // Fuzzy match for the alt-art / illustration rare / secret rare family
      // — scanner might say "Illustration Rare" while pokemontcg.io says "Illustration Rare"
      // (matches exact) OR "Special Illustration Rare" (partial). Both should score.
      const targetKeywords = ['illustration', 'special', 'secret', 'hyper', 'rainbow', 'ultra', 'full art', 'alt art', 'gold', 'shiny'];
      for (const kw of targetKeywords) {
        if (targetRarityLo.includes(kw) && cr.includes(kw)) return 12;
      }
      // Both are "common/uncommon/rare" (base rarity) — scanner said base, DB says base
      if ((targetRarityLo === 'common' || targetRarityLo === 'uncommon' || targetRarityLo === 'rare')
          && (cr === 'common' || cr === 'uncommon' || cr === 'rare')) return 8;
      return 0;
    }
    cards = cards.map(c => ({ c, score: _numScore(c) + _bulkSetMatchScore(c.set?.name, setName) + _rarityScore(c) }))
                 .sort((x, y) => y.score - x.score);
    const best = cards[0].c;
    if (!best) return null;

    // Guard the winner. Before this check the top candidate was accepted even
    // when it agreed with nothing, which is exactly how a Paradox Rift scan
    // rendered a POP Series 3 price and image.
    if (!_bulkCandidateCorroborated(best, setName, cleanNumber)) {
      try {
        const rMis = _bulkTcgPriceShim(cleanName, cleanNumber, setName, cleanRarity);
        if (rMis.ok) {
          const dMis = await rMis.json();
          if (dMis && dMis.market > 0) {
            return {
              marketPrice: dMis.market,
              variant: dMis.variant || 'tcgplayer_live',
              imageUrl: dMis.imageUrl || null,
              tcgplayerUrl: dMis.url || null,
              matchedSet: dMis.setName || null,
              matchedNumber: dMis.cardNumber || null,
              prices: {},
            };
          }
        }
      } catch (_) {}
      // Deliberately no price and no image: showing another card's money and
      // artwork under this card's name is worse than showing neither.
      return {
        marketPrice: null,
        variant: '',
        imageUrl: '',
        tcgplayerUrl: '',
        unavailableReason: 'Couldn\u2019t confirm this exact printing \u2014 tap \uD83D\uDD0D for live comps.'
      };
    }

    const prices = best.tcgplayer?.prices || {};
    const priceMap = {};
    let bestMarket = null, bestVariant = null;
    for (const variant of BULK_VARIANT_PRIORITY) {
      const p = prices[variant];
      if (!p) continue;
      const market = typeof p.market === 'number' ? p.market : null;
      const mid = typeof p.mid === 'number' ? p.mid : null;
      const val = market != null ? market : mid;
      if (val != null) priceMap[variant] = val;
      if (val != null && (bestMarket == null || val > bestMarket)) {
        bestMarket = val;
        bestVariant = variant;
      }
    }
    // Also scan any other variant keys not in our priority list, in case of odd naming.
    for (const key of Object.keys(prices)) {
      if (BULK_VARIANT_PRIORITY.includes(key)) continue;
      const p = prices[key];
      const market = typeof p?.market === 'number' ? p.market : null;
      const mid = typeof p?.mid === 'number' ? p.mid : null;
      const val = market != null ? market : mid;
      if (val != null) priceMap[key] = val;
      if (val != null && (bestMarket == null || val > bestMarket)) {
        bestMarket = val;
        bestVariant = key;
      }
    }

    // 2026-08-15: if pokemontcg.io returned the card but with no market price
    // (common for some secret rares / illustration rares), fall through to
    // /api/tcg-price live lookup. Same fallback path JP cards use.
    if (bestMarket == null) {
      try {
        const r = _bulkTcgPriceShim(cleanName, cleanNumber, setName, rarity);
        if (r.ok) {
          const d = await r.json();
          if (d && d.market > 0) {
            return {
              marketPrice: d.market,
              variant: 'tcgplayer_live',
              imageUrl: best.images?.small || best.images?.large || d.imageUrl || d.image || null,
              tcgplayerUrl: best.tcgplayer?.url || null,
              matchedSet: best.set?.name || null,
              matchedNumber: best.number || null,
              prices: priceMap,
            };
          }
        }
      } catch(e) { /* best-effort fallback */ }
    }

    return {
      marketPrice: bestMarket,
      variant: bestVariant,
      imageUrl: best.images?.small || best.images?.large || null,
      tcgplayerUrl: best.tcgplayer?.url || null,
      matchedSet: best.set?.name || null,
      matchedNumber: best.number || null,
      prices: priceMap,
    };
  } catch (e) {
    // Fail silently — timeout, network error, or bad JSON. Bulk scan should never block on this.
    return null;
  }
}

/* ── Queue processor ── */
async function startBulkQueue() {
  const queue = window._bulkQueue || [];
  if (!queue.length) return;

  const credits = (window._idScanCredits || 0);
  if (credits < 1) {
    showToast('You need at least 1 ID Scan credit to use Bulk Scan.');
    return;
  }

  window._bulkProcessing = true;
  window._bulkResults    = [];
  window._bulkSaved      = false;
  // Break the Rapid Scan auto-loop (if active) once processing starts.
  window._bulkMode       = null;

  // Remove "Add Another" button if present
  const addAnother = document.getElementById('bulkAddAnotherBtn');
  if (addAnother) addAnother.remove();

  // Switch to processing view
  _bulkShowSection('processing');
  document.getElementById('bulkResultsList').innerHTML = '';
  document.getElementById('bulkBottomBar').style.display = 'none';
  _bulkClearDupBanner();
  try { _bulkUpdatePackTracker(); } catch(e) {}

  const total = queue.length;

  // 2026-08-21: Concurrent scan pipeline (was strictly sequential — 10
  // cards = 60s+). Runs up to CONCURRENCY scans in-flight at once while
  // preserving row order in the UI. Ximilar's TCG endpoint handles this
  // fine (~2-5s per card, well within rate limit), and pokemontcg.io
  // grounding is per-card so parallel requests don't collide.
  //
  // 402 (out of credits) stops the whole pipeline. 401 (auth expired)
  // clears the token so subsequent in-flight scans fail fast.
  const CONCURRENCY = 3;
  const listEl = document.getElementById('bulkResultsList');

  // Pre-render all placeholder rows in order so the UI matches queue order
  // even when scans complete out of order.
  for (let i = 0; i < total; i++) {
    const item  = queue[i];
    const rowId = 'bulk-row-' + i;
    listEl.insertAdjacentHTML('beforeend', `
      <div id="${rowId}" style="display:flex;align-items:center;gap:.75rem;padding:.6rem .75rem;background:#111;border-radius:10px;border:1px solid #1e1e1e">
        <img src="${item.objectUrl}" style="width:44px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0;opacity:.6" alt="Card" />
        <div style="flex:1;min-width:0">
          <div style="font-size:.78rem;color:rgba(255,255,255,.35)">Queued…</div>
        </div>
        <div style="width:20px;height:20px;border:2px solid rgba(139,92,246,.3);border-top-color:rgba(139,92,246,.7);border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0"></div>
      </div>`);
  }
  listEl.scrollTop = listEl.scrollHeight;

  window._bulkResults = new Array(total); // preserve order by index
  let nextIdx = 0;
  let completed = 0;
  let hardStop = false;

  async function worker() {
    while (true) {
      if (hardStop || !window._bulkProcessing) return;
      const i = nextIdx++;
      if (i >= total) return;
      const item  = queue[i];
      const rowId = 'bulk-row-' + i;
      // Flip the placeholder to "identifying" state now that a worker is on it.
      try {
        const row = document.getElementById(rowId);
        const label = row?.querySelector('div[style*="flex:1"] div');
        if (label) label.textContent = 'Identifying…';
      } catch(_) {}

      const result = await _bulkScanOne(item, rowId, false);

      if (result === 'STOP') {
        hardStop = true;
        return;
      }

      window._bulkResults[i] = result;
      completed++;
      _bulkUpdateRow(rowId, result);
      try { _bulkUpdatePackTracker(); } catch(e) {}

      const pct = Math.round((completed / total) * 100);
      document.getElementById('bulkProgressLabel').textContent =
        'Scanning ' + completed + ' of ' + total + '…';
      document.getElementById('bulkProgressBar').style.width = pct + '%';
      const credLeft = (window._idScanCredits || 0);
      document.getElementById('bulkProgressCredits').textContent =
        credLeft + ' credit' + (credLeft!==1?'s':'') + ' remaining';
    }
  }

  const workerCount = Math.min(CONCURRENCY, total);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  // Compact out any undefined slots (from STOP or skipped) so downstream
  // callers that iterate _bulkResults don't hit gaps.
  window._bulkResults = window._bulkResults.filter(r => r);

  _bulkFinishQueue(total);
}

/* Scans a single queued item through /api/scan, then does price lookup.
   isRetry=true means: do not treat 402 as a hard stop, and mark result.wasRetry. */
async function _bulkScanOne(item, rowId, isRetry) {
  const listEl = document.getElementById('bulkResultsList');
  let result = {
    objectUrl: item.objectUrl, file: item.file, success: false, cardName: '', setName: '', cardNumber: '',
    marketPrice: null, imageUrl: null, imageDataUrl: null, tcgplayerUrl: null, error: '', condition: 'NM',
    rowId, wasRetry: !!isRetry,
  };
  try {
    // 2026-08-21: bulk-mode compression — skip client-crop (staged photos
    // don't benefit, and false crops were breaking IDs on 4/14 MTG cards
    // where the bounds detector locked onto shadows against dark surfaces)
    // and raise JPEG quality to 0.90 so small MTG text stays legible.
    // Bumped maxPx 1000→1200 for the same reason — Ximilar handles it fine.
    const imageBase64 = await compressImage(item.file, 1200, { skipCrop: true, quality: 0.90 });
    // Set by bulkRetryRow from the row's previous scan id. The server validates
    // it (ownership, 1h TTL, not already refunded, one retry per scan) before
    // waiving the credit, so a forged value just gets charged normally.
    const retryOfId = (isRetry && item.retryOf) ? String(item.retryOf) : '';
    // Keep a tiny (~350px) compressed base64 as a persistent thumbnail
    // fallback if pokemontcg.io doesn't return an image (rare cards, API
    // timeouts, mis-identified sets). Stored as a data: URL so it survives
    // page reload (unlike the blob: objectUrl). Kept small to avoid
    // blowing out localStorage on large bulk scans. Thumb also skips crop
    // so the failed-scan tile shows the actual photo, not a bad crop.
    try {
      const thumbBase64 = await compressImage(item.file, 350, { skipCrop: true });
      result.imageDataUrl = 'data:image/jpeg;base64,' + thumbBase64;
    } catch(e) { /* thumbnail fallback is best-effort */ }
    const idToken     = window._googleIdToken || '';

    const resp = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
      body: JSON.stringify({
        imageBase64,
        mimeType: 'image/jpeg',
        email: window.googleUser?.email || window._userEmail || '',
        googleSub: window.googleUser?.sub || window._googleSub || '',
        ...(retryOfId ? { retry_of: retryOfId } : {}),
      })
    });

    if (resp.status === 402) {
      result.error = 'Out of ID scan credits';
      if (isRetry) {
        // Retry is free — a 402 here means the account is truly out of credits.
        // Still show the row instead of blocking the flow.
        return result;
      }
      _bulkUpdateRow(rowId, result);
      // 2026-08-22 [F5]: Update the PRE-RENDERED placeholder rows in place
      // instead of appending duplicate bulk-row-N elements. Previously the
      // 402 path inserted new rows with the same IDs as the placeholders,
      // producing colliding DOM IDs and two visible rows per index.
      const queue = window._bulkQueue || [];
      const total = queue.length;
      const i = queue.indexOf(item);
      for (let j = i+1; j < total; j++) {
        const skipRow = document.getElementById('bulk-row-' + j);
        if (!skipRow) continue;
        try {
          skipRow.style.opacity = '.4';
          skipRow.style.background = '#111';
          skipRow.style.border = '1px solid #1e1e1e';
          // Replace the label + drop the spinner
          const label = skipRow.querySelector('div[style*="flex:1"]');
          if (label) label.innerHTML = '<div style="font-size:.75rem;color:rgba(255,255,255,.3)">Skipped — out of credits</div>';
          const spinner = skipRow.querySelector('div[style*="animation:spin"]');
          if (spinner && spinner.parentNode) spinner.parentNode.removeChild(spinner);
        } catch(_){}
      }
      // 2026-08-25 [P1-3]: _bulkResults is preallocated with new Array(total)
      // and filled positionally by index. push() here landed the failure at
      // the wrong position (length-based, not queue-index based). Restore
      // positional insertion so the summary UI reflects the correct row.
      window._bulkResults[i] = result;
      showToast('Ran out of credits mid-scan. Results saved for cards that completed.', 'info');
      return 'STOP';
    } else if (resp.status === 401) {
      result.error = 'Auth expired';
      window._googleIdToken = null;
    } else if (!resp.ok) {
      let em = 'Scan failed';
      try { const e = await resp.json(); em = e.error || em; } catch(e) {}
      result.error = em;
    } else {
      const data = await resp.json();
      // Keep the server's scan id on the row. A retry of this row sends it as
      // `retry_of` so /api/scan can grant the free retry the button promises;
      // without it the retry was just another billed scan of the same photo.
      result.scanId = data.scan_id || '';
      if (data.card_name) {
        result.success    = true;
        result.cardName   = data.card_name   || '';
        result.setName    = data.set_name    || '';
        result.setCode    = data.set_code    || ''; // 2026-09-04: was dropped, so bulk-saved rows had no set identity
        result.cardNumber = data.card_number || '';
        result.rarity     = data.rarity      || '';
        result.cardType   = data.card_type   || 'pokemon'; // 'pokemon'|'mtg'|'yugioh'|'lorcana'|'onepiece'|'sports'
        result.isJapanese = data.is_japanese === true;
        result.sport      = data.sport       || ''; // sports cards only
        result.year       = data.year        || ''; // sports cards only (e.g. '2011')
        result.groundedId = data.grounded_id || ''; // 2026-08-17: exact-card ID from Ximilar for price fast-path
        result.condition  = 'NM';

        const priceInfo = await _bulkFetchPrice(result.cardName, result.setName, result.cardNumber, result.cardType, result.isJapanese, result.groundedId, result.rarity);
        if (priceInfo) {
          result.marketPrice  = priceInfo.marketPrice;
          result.priceVariant = priceInfo.variant;
          result.imageUrl     = priceInfo.imageUrl;
          result.tcgplayerUrl = priceInfo.tcgplayerUrl;
          // Why there is no price, when the fetcher knows (e.g. sports).
          result.unavailableReason = priceInfo.unavailableReason || '';
        }
      } else {
        result.error = 'Could not identify card';
      }
    }
  } catch(err) {
    result.error = err.message || 'Scan error';
  }
  return result;
}

function _bulkFinishQueue(total) {
  // 2026-08-22: clear processing flag on the normal finish path (previously
  // only close/open cleared it, so state falsely claimed "processing" after done).
  window._bulkProcessing = false;
  // Done — show bottom bar
  document.getElementById('bulkProgressBar').style.width = '100%';
  document.getElementById('bulkProgressLabel').textContent = 'Done!';

  const successCount = window._bulkResults.filter(r => r.success).length;
  const failCount    = window._bulkResults.filter(r => !r.success).length;
  document.getElementById('bulkSummaryLine').textContent =
    successCount + ' card' + (successCount!==1?'s':'') + ' identified' +
    (failCount > 0 ? ' · ' + failCount + ' failed' : '') +
    ' · Tap below to save to your Collection';

  document.getElementById('bulkBottomBar').style.display = '';
  _bulkResetBottomBarButtons();

  // Update subtitle
  document.getElementById('bulkScanSubtitle').textContent =
    successCount + '/' + total + ' cards identified';

  _bulkDetectDuplicates();
}

/* ── Duplicate detection ── */
function _bulkDupKey(r) {
  return [r.cardName || '', r.setName || '', r.cardNumber || ''].join('|').toLowerCase();
}

function _bulkClearDupBanner() {
  const el = document.getElementById('bulkDupBanner');
  if (el) el.remove();
}

function _bulkDetectDuplicates() {
  _bulkClearDupBanner();
  const successful = window._bulkResults.filter(r => r.success && !r.qty);
  const groups = {};
  successful.forEach(r => {
    const key = _bulkDupKey(r);
    (groups[key] = groups[key] || []).push(r);
  });
  const dupGroup = Object.values(groups).find(g => g.length > 1);
  if (!dupGroup) return;

  const name = dupGroup[0].cardName || 'this card';
  const n = dupGroup.length;
  const listEl = document.getElementById('bulkResultsList');
  const banner = document.createElement('div');
  banner.id = 'bulkDupBanner';
  banner.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:.6rem;padding:.6rem .75rem;background:rgba(212,175,55,.12);border:1px solid rgba(212,175,55,.35);border-radius:10px;margin-bottom:.5rem;font-size:.78rem;color:#fff';
  banner.innerHTML =
    `<span>You scanned <strong>${_esc(name)}</strong> ${n} times</span>` +
    `<button onclick="bulkMergeDuplicates()" style="background:rgba(212,175,55,.9);color:#000;border:none;border-radius:99px;padding:.35rem .8rem;font-weight:800;font-size:.72rem;cursor:pointer;flex-shrink:0">Tap to merge</button>`;
  listEl.parentNode.insertBefore(banner, listEl);
}

function bulkMergeDuplicates() {
  const groups = {};
  const order = [];
  (window._bulkResults || []).forEach(r => {
    if (!r.success) { order.push({ r, merged: r }); return; }
    const key = _bulkDupKey(r);
    if (!groups[key]) {
      const merged = Object.assign({}, r, { qty: r.qty || 1 });
      groups[key] = merged;
      order.push({ r, merged, isFirst: true });
    } else {
      groups[key].qty = (groups[key].qty || 1) + (r.qty || 1);
      order.push({ r, merged: groups[key], isFirst: false });
    }
  });

  const newResults = [];
  const seenKeys = new Set();
  order.forEach(({ r, merged, isFirst }) => {
    if (!r.success) { newResults.push(r); return; }
    const key = _bulkDupKey(r);
    if (seenKeys.has(key)) return; // drop duplicate rows, keep the merged one
    seenKeys.add(key);
    newResults.push(merged);
  });

  window._bulkResults = newResults;

  // Re-render the whole list from scratch since row count changed.
  const listEl = document.getElementById('bulkResultsList');
  listEl.innerHTML = '';
  newResults.forEach((r, idx) => {
    const rowId = 'bulk-row-' + idx;
    r.rowId = rowId;
    listEl.insertAdjacentHTML('beforeend', `<div id="${rowId}" style="display:flex;align-items:center;gap:.75rem;padding:.6rem .75rem;background:#111;border-radius:10px;border:1px solid #1e1e1e"></div>`);
    _bulkUpdateRow(rowId, r);
  });

  _bulkClearDupBanner();
  showToast('Duplicates merged');

  const successCount = window._bulkResults.filter(r => r.success).length;
  document.getElementById('bulkSummaryLine').textContent =
    successCount + ' card' + (successCount!==1?'s':'') + ' ready to add to Collection';
  try { _bulkUpdatePackTracker(); } catch(e) {}
}

/* ── Row rendering ── */
function _bulkFindResult(rowId) {
  return (window._bulkResults || []).find(r => r.rowId === rowId);
}

/* Map a row's failure to advice that is actually true for that failure.
   Every row used to read "Try a clearer photo", including rows that failed
   because the network dropped, the session expired, we were rate-limited, or
   the response was malformed — none of which the photo can fix. */
function _bulkErrorHint(error) {
  const e = String(error || '').toLowerCase();
  // Parse errors read "Unexpected token <", so match the parse shape first
  // rather than letting the bare word "token" claim it for auth.
  if (/json|parse|unexpected token|malformed/.test(e))  return 'We got a bad response — retry this row.';
  if (/auth|401|sign in|signin|id token|expired/.test(e)) return 'Sign in again to finish this batch.';
  if (/too many|429|rate/.test(e))                      return 'We hit a rate limit — retry in a moment.';
  if (/credit/.test(e))                                 return 'Out of credits — top up to scan the rest.';
  if (/network|offline|fetch|connection|dns/.test(e))    return 'Check your connection, then retry.';
  if (/timeout|timed out|abort/.test(e))                return 'The request timed out — retry this row.';
  if (/server|500|502|503|504/.test(e))                 return 'Our scanner is having trouble — retry shortly.';
  // The genuinely photo-shaped failures: no identification came back.
  return 'Try a clearer photo with the full card visible.';
}

function _bulkUpdateRow(rowId, result) {
  const row = document.getElementById(rowId);
  if (!row) return;

  if (result.success) {
    const thumbSrc = result.imageUrl || result.objectUrl || '';
    const qtyBadge = (result.qty && result.qty > 1)
      ? `<span style="position:absolute;top:-6px;right:-6px;background:rgba(139,92,246,1);color:#fff;font-size:.62rem;font-weight:800;border-radius:99px;padding:1px 5px;line-height:1.3;box-shadow:0 0 0 2px #111">×${result.qty}</span>`
      : '';
    const priceHtml = result.marketPrice != null
      ? `<span style="color:var(--gold-text);font-weight:700">$${result.marketPrice.toFixed(2)}</span>` +
        (result.priceVariant ? `<span style="color:rgba(255,255,255,.35);font-size:.68rem"> · ${_esc(formatVariantName(result.priceVariant))}</span>` : '') +
        ` <button onclick="bulkEditPrice('${rowId}')" title="Edit price" style="background:none;border:none;color:rgba(255,255,255,.35);cursor:pointer;font-size:.68rem;padding:0 2px">✎</button>`
      : `<span style="color:rgba(255,255,255,.3)">${_esc(result.unavailableReason || 'Price unavailable')}</span> <button onclick="bulkEditPrice('${rowId}')" title="Enter price" style="background:none;border:none;color:rgba(255,255,255,.35);cursor:pointer;font-size:.68rem;padding:0 2px">✎</button>`;
    const setStr = [result.setName, result.cardNumber ? '#' + result.cardNumber : ''].filter(Boolean).join(' ');
    const cond = result.condition || 'NM';

    row.innerHTML = `
      <div onclick="bulkOpenCardInLookup('${rowId}')" title="Tap to view details" style="position:relative;flex-shrink:0;cursor:pointer">
        <img src="${_esc(thumbSrc)}" onerror="this.src='${_esc(result.objectUrl || '')}'" style="width:44px;height:60px;object-fit:cover;border-radius:6px;background:#1a1a1a" alt="Card" />
        ${qtyBadge}
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:.4rem">
          <div onclick="bulkEditCardName('${rowId}')" title="Tap to correct name" style="font-size:.82rem;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;text-decoration:underline dotted rgba(255,255,255,.25);flex:1;min-width:0">${_esc(result.cardName)}</div>
          <button onclick="bulkOpenCardInLookup('${rowId}')" title="View details & eBay comps" style="background:rgba(139,92,246,.15);border:1px solid rgba(139,92,246,.4);color:rgba(196,181,253,1);border-radius:6px;padding:.15rem .4rem;font-size:.62rem;font-weight:700;cursor:pointer;flex-shrink:0;line-height:1">🔍</button>
        </div>
        <div style="font-size:.7rem;color:rgba(255,255,255,.4);margin-top:.1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(setStr)}</div>
        <div style="margin-top:.2rem;font-size:.78rem">${priceHtml}</div>
        <button onclick="bulkOpenConditionPicker('${rowId}')" style="margin-top:.3rem;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#fff;border-radius:99px;padding:.15rem .5rem;font-size:.65rem;font-weight:700;cursor:pointer">${_esc(cond)} ▾</button>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.3rem;flex-shrink:0">
        <span style="color:#4ade80;font-size:.9rem">✓</span>
        <button onclick="bulkRemoveResult('${rowId}')" style="font-size:.65rem;color:rgba(255,255,255,.3);background:none;border:none;cursor:pointer;padding:2px 4px" title="Remove from batch">✕</button>
      </div>`;
    row.style.borderColor = 'rgba(74,222,128,.2)';
    row.style.opacity = '';
  } else {
    const retryBtn = `<button onclick="bulkRetryRow('${rowId}')" style="background:rgba(139,92,246,.15);border:1px solid rgba(139,92,246,.4);color:rgba(196,181,253,1);border-radius:8px;padding:.25rem .6rem;font-size:.68rem;font-weight:700;cursor:pointer;margin-top:.3rem">↻ Retry (free)</button>`;
    row.innerHTML = `
      <img src="${_esc(result.objectUrl || '')}" style="width:44px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0;opacity:.4" alt="Card" />
      <div style="flex:1;min-width:0">
        <div style="font-size:.78rem;color:rgba(255,255,255,.35)">${_esc(result.error || 'Could not identify')}</div>
        <div style="font-size:.68rem;color:rgba(255,255,255,.2);margin-top:.1rem">${_esc(_bulkErrorHint(result.error))}</div>
        ${retryBtn}
      </div>
      <span style="color:#f87171;font-size:.9rem;flex-shrink:0">✗</span>`;
    row.style.opacity = '.55';
  }
  // 2026-09-04: the Pack Recovery tracker only refreshed while the batch was
  // still scanning, so every AFTER-THE-FACT edit left it stale: correcting a
  // price, fixing a misread name, changing condition or qty, or a successful
  // retry all changed the recovered total while the bar kept showing the old
  // one. Every one of those paths repaints through here, so this is the single
  // place that cannot be forgotten. Guarded because _bulkUpdateRow also runs
  // mid-scan before the tracker element exists.
  try { _bulkUpdatePackTracker(); } catch (e) {}
}

/* ── Condition picker ── */
function bulkOpenConditionPicker(rowId) {
  _bulkCloseConditionPicker();
  const row = document.getElementById(rowId);
  if (!row) return;
  const result = _bulkFindResult(rowId);
  const current = result ? (result.condition || 'NM') : 'NM';

  const picker = document.createElement('div');
  picker.id = 'bulkConditionPicker';
  picker.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:400;display:flex;align-items:flex-end;justify-content:center';
  picker.onclick = (e) => { if (e.target === picker) _bulkCloseConditionPicker(); };
  picker.innerHTML = `
    <div style="background:#151515;border:1px solid #2a2a2a;border-radius:16px 16px 0 0;padding:1rem 1.25rem 1.5rem;width:100%;max-width:420px">
      <div style="font-size:.85rem;font-weight:700;color:#fff;margin-bottom:.75rem">Set condition</div>
      <div style="display:flex;flex-direction:column;gap:.4rem">
        ${BULK_CONDITIONS.map(c => `
          <button onclick="bulkSetCondition('${rowId}','${c}')" style="display:flex;justify-content:space-between;align-items:center;padding:.6rem .8rem;background:${c===current ? 'rgba(139,92,246,.18)' : 'rgba(255,255,255,.05)'};border:1px solid ${c===current ? 'rgba(139,92,246,.5)' : 'rgba(255,255,255,.12)'};border-radius:10px;color:#fff;font-size:.82rem;font-weight:700;cursor:pointer;width:100%;text-align:left">
            <span>${c} — ${_esc(BULK_CONDITION_LABELS[c])}</span>
            ${c===current ? '<span style="color:#4ade80">✓</span>' : ''}
          </button>`).join('')}
      </div>
      <button onclick="_bulkCloseConditionPicker()" style="margin-top:.75rem;width:100%;padding:.55rem;background:transparent;color:rgba(255,255,255,.5);border:none;font-size:.78rem;cursor:pointer">Cancel</button>
    </div>`;
  document.body.appendChild(picker);
}

function _bulkCloseConditionPicker() {
  const el = document.getElementById('bulkConditionPicker');
  if (el) el.remove();
}

function bulkSetCondition(rowId, cond) {
  const result = _bulkFindResult(rowId);
  if (result) result.condition = cond;
  _bulkCloseConditionPicker();
  _bulkUpdateRow(rowId, result);
}

/* ── Manual name correction ── */
async function bulkEditCardName(rowId) {
  const result = _bulkFindResult(rowId);
  if (!result) return;
  const newName = await promptInline('Card name:', result.cardName || '');
  if (newName == null) return;
  const trimmed = newName.trim();
  if (!trimmed || trimmed === result.cardName) return;

  result.cardName = trimmed;
  _bulkUpdateRow(rowId, result);

  // Preserve cardType and isJapanese so re-priced MTG/YGO/Lorcana cards
  // don't silently fall back to the Pokemon lookup path.
  // Skip groundedId on re-price after edit — user changed the name so the
  // originally-scanned ID may no longer be correct. Keep rarity as a hint.
  const priceInfo = await _bulkFetchPrice(result.cardName, result.setName, result.cardNumber, result.cardType, result.isJapanese, '', result.rarity);
  if (priceInfo) {
    result.marketPrice  = priceInfo.marketPrice;
    result.priceVariant = priceInfo.variant;
    result.imageUrl     = priceInfo.imageUrl;
    result.tcgplayerUrl = priceInfo.tcgplayerUrl;
  } else {
    result.marketPrice  = null;
    result.priceVariant = null;
  }
  _bulkUpdateRow(rowId, result);
  showToast('Card name updated');
}

/* ── Inline price edit ── */
async function bulkEditPrice(rowId) {
  const result = _bulkFindResult(rowId);
  if (!result) return;
  const current = result.marketPrice != null ? result.marketPrice.toFixed(2) : '';
  const input = await promptInline('Market value ($):', current);
  if (input == null) return;
  const val = parseFloat(input);
  if (isNaN(val) || val < 0) return;
  result.marketPrice = val;
  result.priceVariant = null; // manually overridden — no longer tied to a TCGplayer variant
  _bulkUpdateRow(rowId, result);
}

/* ── Retry failed scan (free) ── */
async function bulkRetryRow(rowId) {
  const idx = (window._bulkResults || []).findIndex(r => r.rowId === rowId);
  if (idx === -1) return;
  const oldResult = window._bulkResults[idx];

  const row = document.getElementById(rowId);
  if (row) {
    row.innerHTML = `
      <img src="${_esc(oldResult.objectUrl || '')}" style="width:44px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0;opacity:.6" alt="Card" />
      <div style="flex:1;min-width:0">
        <div style="font-size:.78rem;color:rgba(255,255,255,.35)">Retrying…</div>
      </div>
      <div style="width:20px;height:20px;border:2px solid rgba(139,92,246,.5);border-top-color:rgba(139,92,246,1);border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0"></div>`;
    row.style.opacity = '';
  }

  // Carry the previous attempt's scan id so the server can waive the credit for
  // this retry. If the row never got one (e.g. an outright miss, which is
  // auto-refunded server-side anyway), retryOf is empty and the scan is billed
  // normally rather than silently claiming a free one.
  const item = { file: oldResult.file, objectUrl: oldResult.objectUrl, retryOf: oldResult.scanId || '' };

  if (!item.file) {
    showToast('Original photo unavailable — please rescan this card.', 'info');
    if (row) _bulkUpdateRow(rowId, oldResult);
    return;
  }

  const newResult = await _bulkScanOne(item, rowId, true);
  if (newResult === 'STOP') return; // shouldn't happen on retry, but guard anyway
  newResult.rowId = rowId;
  window._bulkResults[idx] = newResult;
  _bulkUpdateRow(rowId, newResult);

  const successCount = window._bulkResults.filter(r => r.success).length;
  const failCount    = window._bulkResults.filter(r => !r.success).length;
  const summaryEl = document.getElementById('bulkSummaryLine');
  if (summaryEl) {
    summaryEl.textContent =
      successCount + ' card' + (successCount!==1?'s':'') + ' identified' +
      (failCount > 0 ? ' · ' + failCount + ' failed' : '') +
      ' · Tap below to save to your Collection';
  }
}

function bulkRemoveResult(rowId) {
  window._bulkResults = (window._bulkResults || []).filter(r => r.rowId !== rowId);
  const row = document.getElementById(rowId);
  if (row) row.remove();
  // Update summary
  const successCount = window._bulkResults.filter(r => r.success).length;
  document.getElementById('bulkSummaryLine').textContent =
    successCount + ' card' + (successCount!==1?'s':'') + ' ready to add to Collection';
  // Removing a row drops its value out of the recovered total. This path does
  // not go through _bulkUpdateRow (the row is gone), so refresh explicitly.
  try { _bulkUpdatePackTracker(); } catch (e) {}
}

/* ── Save flow ── */
function bulkAddAllToCollection() {
  const successful = window._bulkResults.filter(r => r.success);
  if (!successful.length) {
    showToast('No successfully identified cards to add.');
    return;
  }
  const anyPriced = successful.some(r => r.marketPrice != null);
  if (!anyPriced) {
    // Nothing to price — just save immediately at $0 cost each rather than
    // showing an empty cost sheet.
    _bulkSaveToCollection(successful, {});
    return;
  }
  openBulkCostSheet(successful);
}

function setBulkCostMode(mode){
  // mode='pack' shows a single split-across-all input AND the card list below
  // with a live per-card split preview (read-only). mode='per' shows the
  // classic editable per-card list. Default 'pack' since ripping packs is the
  // far more common bulk-scan path.
  //
  // 2026-08-19: In pack mode we now render the card list too (read-only) so
  // users can SEE the total divide evenly — previously the list was hidden
  // and users worried each card was being saved at the full pack cost.
  window._bulkCostMode = mode;
  const pack = document.getElementById('bulkPackCostPanel');
  const list = document.getElementById('bulkCostList');
  const btnPack = document.getElementById('bulkCostModePack');
  const btnPer  = document.getElementById('bulkCostModePer');
  if (pack) pack.style.display = mode === 'pack' ? 'block' : 'none';
  if (list) list.style.display = 'block'; // list is visible in BOTH modes now
  if (btnPack && btnPer){
    const on  = 'rgba(139,92,246,.85)', onc  = '#fff';
    const off = 'transparent',           offc = 'rgba(255,255,255,.55)';
    btnPack.style.background = mode === 'pack' ? on : off;
    btnPack.style.color      = mode === 'pack' ? onc : offc;
    btnPer.style.background  = mode === 'per'  ? on : off;
    btnPer.style.color       = mode === 'per'  ? onc : offc;
  }
  // Toggle each row between read-only split-preview (pack) and editable input (per)
  _bulkToggleRowMode(mode);
  // Refresh the split values whenever we enter pack mode
  if (mode === 'pack') updateBulkPackCostHint();
}

// Show/hide the per-row cost input vs the read-only "split preview" tag.
// Every row in openBulkCostSheet renders both; this function flips which is
// visible based on the current cost mode.
function _bulkToggleRowMode(mode){
  document.querySelectorAll('.bulk-cost-row').forEach(row => {
    const inp = row.querySelector('.bulk-cost-input-wrap');
    const tag = row.querySelector('.bulk-cost-split-tag');
    if (inp) inp.style.display = mode === 'per'  ? 'flex' : 'none';
    if (tag) tag.style.display = mode === 'pack' ? 'flex' : 'none';
  });
}

function updateBulkPackCostHint(){
  const total = parseFloat((document.getElementById('bulkPackCostInput')||{}).value) || 0;
  const successful = (window._bulkResults || []).filter(r => r.success);
  const n = successful.reduce((s,r) => s + (r.qty && r.qty > 1 ? r.qty : 1), 0);
  const nSpan = document.getElementById('bulkPackCostN');
  if (nSpan) nSpan.textContent = n;
  const hint = document.getElementById('bulkPackCostHint');
  const perSlot = (total > 0 && n > 0) ? (total / n) : 0;
  if (hint && total > 0 && n > 0){
    hint.innerHTML = `$${total.toFixed(2)} ÷ ${n} cards = <span style="color:rgba(139,92,246,.95);font-weight:800">$${perSlot.toFixed(2)}</span> each. Preview below ↓`;
  } else if (hint){
    hint.innerHTML = `Split evenly across the <span id="bulkPackCostN">${n}</span> cards below.`;
  }
  // Live-update every row's split preview tag as the user types.
  successful.forEach((r, i) => {
    const tag = document.getElementById('bulkCostSplit_' + i);
    if (!tag) return;
    const qty = r.qty && r.qty > 1 ? r.qty : 1;
    const rowTotal = perSlot * qty;
    if (perSlot > 0) {
      // Show "$12.50" for qty=1; "$37.50 (3×$12.50)" for qty=3.
      tag.innerHTML = qty > 1
        ? `<span style="color:#fff;font-weight:800">$${rowTotal.toFixed(2)}</span><span style="color:rgba(255,255,255,.4);font-size:.62rem;margin-left:.25rem">(${qty}×$${perSlot.toFixed(2)})</span>`
        : `<span style="color:#fff;font-weight:800">$${rowTotal.toFixed(2)}</span>`;
    } else {
      tag.innerHTML = `<span style="color:rgba(255,255,255,.35);font-weight:600">$0.00</span>`;
    }
  });
}

function openBulkCostSheet(cards) {
  const list = document.getElementById('bulkCostList');
  if (!list) return;
  list.innerHTML = cards.map((r, i) => {
    const thumbSrc = r.imageUrl || r.objectUrl;
    const thumb = thumbSrc ? `<img src="${_esc(thumbSrc)}" style="width:38px;height:52px;object-fit:cover;border-radius:5px;flex-shrink:0">` : `<div style="width:38px;height:52px;background:#1a1a1a;border-radius:5px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.2rem">🃏</div>`;
    const name = r.cardName || 'Unknown card';
    const qtyStr = r.qty && r.qty > 1 ? ` ×${r.qty}` : '';
    const sub  = [r.setName, r.cardNumber ? '#' + r.cardNumber : ''].filter(Boolean).join(' · ');
    const val  = r.marketPrice ? r.marketPrice.toFixed(2) : '';
    // Each row has BOTH:
    //   • .bulk-cost-split-tag  — read-only "$12.50" pill, shown in pack mode
    //   • .bulk-cost-input-wrap — editable input,          shown in per-card mode
    // setBulkCostMode() toggles which is visible; updateBulkPackCostHint()
    // updates the split-tag text live as the user types the pack total.
    return `<div class="bulk-cost-row" style="display:flex;align-items:center;gap:.65rem;padding:.55rem .25rem;border-bottom:1px solid #1a1a1a">
      ${thumb}
      <div style="flex:1;min-width:0">
        <div style="font-size:.82rem;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(name)}${qtyStr}</div>
        <div style="font-size:.67rem;color:rgba(255,255,255,.4);margin-top:.1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(sub||'—')}</div>
        ${val ? `<div style="font-size:.67rem;color:rgba(212,175,55,.6);margin-top:.1rem">Market ~$${val}</div>` : ''}
      </div>
      <div id="bulkCostSplit_${i}" class="bulk-cost-split-tag" style="display:flex;align-items:center;justify-content:flex-end;background:rgba(139,92,246,.12);border:1px solid rgba(139,92,246,.35);border-radius:8px;flex-shrink:0;min-width:78px;padding:.36rem .5rem;font-size:.78rem">
        <span style="color:rgba(255,255,255,.35);font-weight:600">$0.00</span>
      </div>
      <div class="bulk-cost-input-wrap" style="display:none;align-items:center;background:#1a1a1a;border:1.5px solid #2a2a2a;border-radius:8px;overflow:hidden;flex-shrink:0;width:78px">
        <span style="padding:0 .3rem;font-size:.8rem;color:rgba(255,255,255,.35)">$</span>
        <input type="number" min="0" step="0.01" placeholder="0.00"
          id="bulkCost_${i}"
          style="background:transparent;border:none;color:#fff;font-size:.8rem;width:50px;padding:.38rem .2rem .38rem 0;outline:none;-moz-appearance:textfield"
          oninput="this.style.borderColor='rgba(139,92,246,.6)'"
          inputmode="decimal">
      </div>
    </div>`;
  }).join('');
  _bulkShowSection('costSheet');
  // Reset to pack mode each open + refresh hint. If the user entered a pack
  // cost up front on the mode picker, pre-fill it here so they don't retype.
  const packInp = document.getElementById('bulkPackCostInput');
  const startCost = parseFloat(window._bulkStartPackCost) || 0;
  if (packInp) packInp.value = startCost > 0 ? startCost.toFixed(2) : '';
  setBulkCostMode('pack');
  updateBulkPackCostHint();
}

function bulkSkipPricingAndSave() {
  const successful = window._bulkResults.filter(r => r.success);
  _bulkSaveToCollection(successful, {}, true);
}

function confirmBulkCostSave() {
  const successful = window._bulkResults.filter(r => r.success);
  const costs = {};
  if (window._bulkCostMode === 'pack') {
    // Pack/set total mode: split evenly across every card slot (respecting qty).
    const total = parseFloat((document.getElementById('bulkPackCostInput')||{}).value) || 0;
    const nSlots = successful.reduce((s,r) => s + (r.qty && r.qty > 1 ? r.qty : 1), 0);
    const perSlot = nSlots > 0 ? (total / nSlots) : 0;
    // 2026-09-04: this used to store perSlot × qty "because
    // _bulkSaveToCollection multiplies out qty internally". It does not -- it
    // pushes qty SEPARATE entries and assigns the full costs[i] to each one, so
    // a qty-3 row was booked at perSlot × qty per copy = perSlot × qty² total.
    // A $120 box split across 12 slots with one ×3 row recorded $90 of cost for
    // that row instead of $30, inflating basis and understating every downstream
    // profit number. Store the PER-COPY cost, which is what both the hint
    // ("= $10.00 each") and the row pill ("$30.00 (3×$10.00)") already promise.
    successful.forEach((r, i) => { costs[i] = perSlot; });
  } else {
    successful.forEach((r, i) => {
      const inp = document.getElementById('bulkCost_' + i);
      costs[i] = inp ? (parseFloat(inp.value) || 0) : 0;
    });
  }
  _bulkSaveToCollection(successful, costs);
}

function _bulkSaveToCollection(successful, costs, skipPricing) {
  const port = loadPortData();
  const today = new Date().toISOString().slice(0,10);
  let added = 0;
  successful.forEach((r, i) => {
    const buyPrice = skipPricing ? 0 : (costs[i] || 0);
    const setStr = [r.setName, r.cardNumber ? '#' + r.cardNumber : ''].filter(Boolean).join(' · ');
    const qty = r.qty && r.qty > 1 ? r.qty : 1;
    // Thumbnail fallback: if pokemontcg.io didn't return an image (rare card,
    // API timeout, mis-identified set), fall back to the user's own uploaded
    // photo. r.objectUrl is a blob: URL that goes stale on page reload, so we
    // use r.imageDataUrl (a base64 data: URL captured at scan time) when
    // available. That way the collection thumbnail persists forever, even for
    // cards we couldn't find in the API.
    const thumb = r.imageUrl || r.imageDataUrl || null;
    for (let q = 0; q < qty; q++) {
      port.push({
        id: Date.now() + added + Math.floor(Math.random() * 1000),
        updatedAt: Date.now(),
        card: r.cardName,
        set: setStr,
        buyPrice,
        // 2026-09-04: `r.marketPrice || null` turned a legitimate $0.00 comp
        // into "no price". Only null/undefined mean "not fetched".
        currentValue: (typeof r.marketPrice === 'number') ? r.marketPrice : null,
        condition: r.condition || 'NM',
        addedDate: today,
        source: 'bulk-scan',
        // Save under BOTH field names — openCollectionCardDetail reads
        // p.img || p.imageUrl, and older code paths only look at p.img.
        img: thumb,
        imageUrl: thumb,
        // Persist number + tcgplayer URL so "View full card" and
        // "List on TCGplayer" work as well as the single-add path.
        number: r.cardNumber || '',
        tcgplayerUrl: r.tcgplayerUrl || '',
        // 2026-09-04: bulk-save dropped every identity field the single-add
        // path persists, so a bulk-added card opened "View full card" with no
        // game context and re-priced through a wildcard text search -- the
        // exact failure that made a Lorcana "Hades 74" come back as a Pokemon
        // Inkay. Carry the same set the scanner already handed us.
        game:       r.cardType === 'pokemonjp' ? 'pokemonjp' : (r.cardType || ''),
        cardType:   r.cardType === 'pokemonjp' ? 'pokemon'   : (r.cardType || ''),
        setCode:    r.setCode || '',
        groundedId: r.groundedId || '',
        rarity:     r.rarity || '',
        isJapanese: r.isJapanese === true,
        // Bulk ID has no grade picker, so these are honestly empty rather than
        // absent -- the Collection renderer branches on presence.
        grader: null,
        grade:  null,
        // Sports-only identity, used by the detail view's comp search.
        sport: r.sport || '',
        year:  r.year || '',
        lastRefreshed: (typeof r.marketPrice === 'number') ? new Date().toISOString() : null
      });
      added++;
    }
  });
  const bulkSaveOk = savePortData(port);
  if (!bulkSaveOk) _reportStorageFailure();
  window.trackEvent?.('bulk_scan_save', {
    added,
    // If price fetch missed and we saved as "Price not fetched", capture that
    // rate — it's the single best signal for how well bulk-scan pricing works.
    withoutPrice: successful.filter(r => !r.marketPrice).length,
  });
  // Verify the write landed — if getUserKey returned an unscoped key (googleUser was
  // briefly null during the write), the data is orphaned and Collection won't show it.
  try {
    const verifyKey = getUserKey('portfolio');
    const verified  = JSON.parse(localStorage.getItem(verifyKey) || '[]');
    if (!Array.isArray(verified) || verified.length < port.length) {
      console.warn('Portfolio write verification failed:', verifyKey, 'expected', port.length, 'got', verified.length);
      // Name the actual cause when we know it. A quota rejection is not a
      // "tap Refresh" problem -- retrying writes the same oversized blob.
      if (!bulkSaveOk) showToast(storageFailureMessage(), 'error');
      else showToast('Save issue detected — tap Refresh to retry.', 'info');
    }
  } catch(e) { /* non-fatal */ }
  _maybeRerenderCollection(true);
  showToast(added + ' card' + (added!==1?'s':'') + ' added to your Collection 📦', 'success');

  window._bulkSaved = true;
  _bulkShowSection('processing');
  _bulkShowPostSaveBar(added);
}

// Tap a bulk-scan row to open that card in the main Card Lookup view.
// PAUSES the bulk overlay (state preserved) so the user can tap "Back to Bulk Scan" to return.
// Uses _loadScannedCardExact — same exact-lookup path as single-card scan (name+number+set)
// instead of stuffing text into the search box, because the search box uses a wildcard query
// that doesn't reliably match by card number.
async function bulkOpenCardInLookup(rowId) {
  const r = _bulkFindResult(rowId);
  if (!r || !r.success) { showToast('Card not identified yet.'); return; }

  // 2026-09-04: close the search results dropdown before switching cards.
  // _loadScannedCardExactImpl assigns si.value directly, which does NOT close
  // an already-open dropdown, so a list of sealed "ME01: Mega Evolution"
  // booster-box rows (each "No price") stayed floating over the Bulbasaur
  // detail view. Harmless-looking, but it makes a resolved single card read as
  // an unpriced product list.
  try { if (typeof closeSearchModal === 'function') closeSearchModal(); } catch(_) {}

  // ── PAUSE (don't destroy) so user can return ──
  const ov = document.getElementById('bulkScanOverlay');
  if (ov) ov.style.display = 'none';
  window._bulkPaused = true;                // marker for the return button
  // Do NOT clear _bulkResults / _bulkQueue — we need them to resume

  try { switchView('lookup'); } catch(e) {}

  // Route to the correct game tab based on what the scanner detected.
  // OLD BUG: this hard-coded 'pokemon' for every card, so scanning a Magic /
  // Yu-Gi-Oh / Lorcana card ID'd correctly but then landed in the Pokemon tab
  // with an empty search result — which the user saw as "drops you right back
  // into English pokemon".
  const GAME_MAP = { pokemon: 'pokemon', mtg: 'mtg', yugioh: 'yugioh', lorcana: 'lorcana', onepiece: 'onepiece', sports: 'sports' };
  const targetGame = GAME_MAP[(r.cardType || 'pokemon').toLowerCase()] || 'pokemon';
  try {
    if (typeof onGameSelectChange === 'function' && activeGame !== targetGame) {
      onGameSelectChange(targetGame);
    }
  } catch(e) {}

  // Show the floating "Back to Bulk Scan" pill immediately (before await)
  _showBackToBulkPill();

  // For non-Pokemon TCGs, _loadScannedCardExact hits PokemonTCG.io only and
  // returns nothing. Use the game-specific search function so the dropdown
  // populates with the correct DB (Scryfall / YGOProDeck / Lorcana / etc.).
  try {
    if (targetGame === 'sports') {
      // Sports card: use the sports form auto-fill helper instead of the
      // Pokemon-only #searchInput path. Fills sp_player/year/brand/#/sport
      // and fires doSportsSearchLive so comp buttons render immediately.
      _routeScannedSportsCard({
        name:     r.cardName    || '',
        number:   r.cardNumber  || '',
        setName:  r.setName     || '',
        rarity:   r.rarity      || '',
        sport:    r.sport       || '',
        year:     r.year        || '',
      });
      _showBackToBulkPill();
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch(e) {}
      return;
    }
    if (targetGame === 'pokemon' && typeof _loadScannedCardExact === 'function') {
      await _loadScannedCardExact({
        name:    r.cardName    || '',
        number:  r.cardNumber  || '',
        setName: r.setName     || '',
        rarity:  r.rarity      || '',
        isJapanese: r.isJapanese === true,
        // 2026-08-18: pass through the grounded_id from bulk scan so the fast
        // path fetches the exact pokemontcg.io card (e.g. me4-94 Chaos Rising
        // Metang IR) instead of falling to fuzzy search that grabs the older
        // same-number card (sm7-94 Celestial Storm Metang Uncommon).
        groundedId: r.groundedId || '',
        // 2026-08-19: pass through the image + price we already resolved for
        // the bulk row. When pokemontcg.io misses (rare / new set / OCR mismatch),
        // the detail view fell to synthetic-card w/ empty image + empty price
        // even though the bulk row was showing both. Wire them through so the
        // detail view can reuse them as a fallback.
        imageUrl:      r.imageUrl     || '',
        imageDataUrl:  r.imageDataUrl || '', // base64 thumb of the scanned photo
        marketPrice:   (r.marketPrice != null ? r.marketPrice : null),
        priceSource:   r.priceSource  || '', // e.g. 'Tcgplayer_live'
        tcgplayerUrl:  r.tcgplayerUrl || '',
      });
    } else {
      // Non-Pokemon: prefill search, trigger the tab's own search, then wait
      // for the dropdown to populate and auto-click the row that best matches
      // the scanned set/number. Without this auto-pick, the user lands on
      // the search dropdown with 3-10 variants and has to guess which one
      // matches their scanned card (reported 2026-08-15).
      const si = document.getElementById('searchInput');
      if (si) {
        si.value = r.cardName || '';
        si.dispatchEvent(new Event('input', { bubbles: true }));

        // Poll for the dropdown to fill — search fns are async, and different
        // TCG APIs take different amounts of time (Scryfall ~200-500ms, YGO ~1s,
        // Lorcana can hit the huge in-memory cache and be instant).
        const wantNum  = String(r.cardNumber || '').replace(/\/.*$/, '').trim().toLowerCase();
        const wantSet  = String(r.setName    || '').trim().toLowerCase();
        const wantName = String(r.cardName   || '').trim().toLowerCase();
        const start = Date.now();
        const poll = () => {
          const items = document.querySelectorAll('#dropList .drop-item');
          if (items.length === 0) {
            if (Date.now() - start < 4000) return setTimeout(poll, 150);
            return; // timeout — leave user on dropdown
          }
          // Score each row: exact number+name > name match > first row
          let best = items[0];
          let bestScore = -1;
          items.forEach(el => {
            const num  = String(el.dataset.number || '').replace(/\/.*$/, '').trim().toLowerCase();
            const setAttr = String(el.dataset.set || '').trim().toLowerCase();
            const name = String((el.querySelector('.drop-name') || {}).textContent || '').trim().toLowerCase();
            // MTG/YGO/Lorcana rows don't set data-set/data-number — fall back to
            // reading the visible meta line, which includes set name and number.
            const meta = String((el.querySelector('.drop-meta') || {}).textContent || '').trim().toLowerCase();
            let s = 0;
            if (wantNum  && num  === wantNum)                s += 10;
            if (wantNum  && !num && meta.includes(wantNum))  s += 6;
            if (wantSet  && setAttr && setAttr.includes(wantSet)) s += 4;
            if (wantSet  && setAttr && wantSet.includes(setAttr)) s += 3;
            if (wantSet  && !setAttr && meta.includes(wantSet))   s += 3;
            if (wantName && name === wantName)               s += 2;
            if (wantName && name.includes(wantName))         s += 1;
            if (s > bestScore) { bestScore = s; best = el; }
          });
          try { best.click(); } catch(e) {}
        };
        setTimeout(poll, 200);
      }
    }
  } catch(e) {
    console.warn('bulkOpenCardInLookup: exact load failed', e);
    showToast('Could not open that card. Tap the pill to return to bulk scan.', 'info');
  }

  // Scroll to top so the card panel is visible on mobile
  try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch(e) {}
}

// Small floating button that lets the user return to their paused bulk scan.
// Only visible while _bulkPaused is truthy and bulkResults has items.
function _showBackToBulkPill() {
  let pill = document.getElementById('backToBulkPill');
  if (!pill) {
    pill = document.createElement('button');
    pill.id = 'backToBulkPill';
    pill.onclick = resumeBulkScan;
    // Corner-anchored (not middle-centered) so it doesn't overlap search
    // dropdown results or scan-miss panel content. Bottom-right on mobile,
    // stays out of the way of the primary content flow.
    pill.style.cssText = 'position:fixed;bottom:1rem;right:1rem;z-index:250;padding:.55rem .9rem;background:rgba(139,92,246,.95);color:#fff;border:none;border-radius:99px;font-size:.78rem;font-weight:800;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.5);display:flex;align-items:center;gap:.35rem;max-width:calc(100vw - 2rem)';
    document.body.appendChild(pill);
  }
  const n = (window._bulkResults || []).length;
  pill.innerHTML = `↩ Back to Bulk Scan${n ? ` (${n})` : ''}`;
  pill.style.display = 'flex';
}

function _hideBackToBulkPill() {
  const pill = document.getElementById('backToBulkPill');
  if (pill) pill.style.display = 'none';
}

// Return to the paused bulk overlay with all results intact.
function resumeBulkScan() {
  const ov = document.getElementById('bulkScanOverlay');
  if (!ov) return;
  // If somehow the state was cleared (e.g. page reload), fall back gracefully
  if (!(window._bulkResults || []).length) {
    _hideBackToBulkPill();
    window._bulkPaused = false;
    showToast('Bulk scan session ended.');
    return;
  }
  ov.style.display = 'flex';
  window._bulkPaused = false;
  _hideBackToBulkPill();
}

function _bulkResetBottomBarButtons() {
  const bar = document.getElementById('bulkBottomBar');
  if (!bar) return;
  bar.innerHTML = `
    <div id="bulkSummaryLine" style="font-size:.78rem;color:rgba(255,255,255,.45);text-align:center;margin-bottom:.65rem"></div>
    <div style="display:flex;gap:.75rem">
      <button onclick="closeBulkScan()" style="flex:1;padding:.65rem;background:rgba(255,255,255,.08);border:none;color:#fff;border-radius:10px;font-weight:700;font-size:.85rem;cursor:pointer">Close</button>
      <button id="bulkAddAllBtn" onclick="bulkAddAllToCollection()" style="flex:2;padding:.65rem;background:rgba(139,92,246,1);border:none;color:#fff;border-radius:10px;font-weight:800;font-size:.85rem;cursor:pointer">📦 Add All to Collection</button>
    </div>
    <div style="margin-top:.5rem">
      <button id="bulkScanMoreBtn" onclick="bulkScanMore()" style="width:100%;padding:.55rem;background:transparent;border:1px solid rgba(139,92,246,.4);color:rgba(139,92,246,1);border-radius:10px;font-weight:700;font-size:.8rem;cursor:pointer">+ Scan More Cards</button>
    </div>`;
}

function _bulkShowPostSaveBar(added) {
  const bar = document.getElementById('bulkBottomBar');
  if (!bar) return;
  bar.style.display = '';
  bar.innerHTML = `
    <div style="font-size:.78rem;color:rgba(255,255,255,.6);text-align:center;margin-bottom:.65rem">${added} card${added!==1?'s':''} added to your Collection 📦</div>
    <div style="display:flex;gap:.75rem">
      <button onclick="switchView('collection');closeBulkScan();" style="flex:1;padding:.65rem;background:rgba(255,255,255,.08);border:none;color:#fff;border-radius:10px;font-weight:800;font-size:.85rem;cursor:pointer">View Collection</button>
      <button onclick="bulkScanMore()" style="flex:1;padding:.65rem;background:rgba(139,92,246,1);border:none;color:#fff;border-radius:10px;font-weight:800;font-size:.85rem;cursor:pointer">Scan More</button>
    </div>`;
}

function bulkScanMore() {
  // Preserve existing results, go back to mode picker to add more
  window._bulkSaved = false;
  _bulkShowSection('modePicker');
}

function _esc(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Ensure spin animation is defined ── */
(function() {
  if (!document.getElementById('bulkSpinStyle')) {
    const st = document.createElement('style');
    st.id = 'bulkSpinStyle';
    st.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
  }
})();

