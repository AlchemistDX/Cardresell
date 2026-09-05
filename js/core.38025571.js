
/* ═══════════════════════════════════════════
   CARDSELL v2 — Card Lookup + Platform Calculator
   ═══════════════════════════════════════════ */

// ── TCGPriceLookup API Key (JS variable only, resets on reload) ──
window.tplApiKey = window.CARDSELL_TPL_KEY || ''; // Key is baked in — no UI needed

// 2026-09-04 (SOL-PLAT-013) — user-supplied API keys no longer persist to disk.
// They used to live in localStorage, which survives indefinitely and is
// readable by any same-origin XSS. They now live in sessionStorage, so a key is
// scoped to the tab and dropped when that tab closes. A key already saved by an
// earlier build is migrated across once and then erased from localStorage, so
// existing users are not silently logged out of their own key mid-session.
window._openAiKey = (() => {
  try {
    const legacy = localStorage.getItem('cardsell_openai_key');
    if (legacy) {
      try { sessionStorage.setItem('cardsell_openai_key', legacy); } catch(e) {}
      try { localStorage.removeItem('cardsell_openai_key'); } catch(e) {}
    }
    return sessionStorage.getItem('cardsell_openai_key') || '';
  } catch(e) { return ''; }
})();
// The TPL key is baked in at build time and no code path ever read the
// persisted copy back, so writing it to disk was risk with no benefit. Clear
// anything an earlier build left behind.
try { localStorage.removeItem('cardsell_tpl_key'); } catch(e) {}

function saveOpenAiKey() {
  const val = (document.getElementById('openAiKeyInput')?.value || '').trim();
  const status = document.getElementById('openAiKeyStatus');
  if (val && !val.startsWith('sk-')) {
    if (status) status.textContent = '⚠️ OpenAI keys start with sk-';
    return;
  }
  window._openAiKey = val;
  // sessionStorage, not localStorage — see SOL-PLAT-013 note above.
  try {
    if (val) sessionStorage.setItem('cardsell_openai_key', val);
    else sessionStorage.removeItem('cardsell_openai_key');
  } catch(e) {}
  if (status) status.textContent = val ? '✅ AI scanning enabled — costs ~$0.001 per scan.' : 'Key cleared. Using basic text reading.';
}

// ── Settings panel toggle ──
(function() {
  const btn = document.querySelector('[data-settings-toggle]');
  const panel = document.getElementById('settingsPanel');
  if (btn && panel) {
    btn.addEventListener('click', () => {
      const open = panel.classList.toggle('open');
      btn.classList.toggle('active', open);
      // Pre-fill saved values whenever panel opens
      if (open) {
        const gcInput = document.getElementById('googleClientIdInput');
        if (gcInput) gcInput.value = _SAVED_CLIENT_ID || '';
        const tplInput = document.getElementById('tplKeyInput');
        // TPL key is now server-side only. The UI is retained (display:none) for
        // legacy element refs but never shows the real key.
        if (tplInput) {
          tplInput.type = 'password';
          tplInput.value = '';
        }
        const revealBtn = document.getElementById('tplRevealBtn');
        if (revealBtn) revealBtn.textContent = '\uD83D\uDC41';
        // Load scan credits — pass current email/sub
        loadSettingsScanCredits();
      }
    });
  }
})();

// ── Toggle TPL key visibility ──
function toggleTplKeyVisibility() {
  const input = document.getElementById('tplKeyInput');
  const btn   = document.getElementById('tplRevealBtn');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btn) btn.textContent = '\uD83D\uDE48'; // see-no-evil = hide
  } else {
    input.type = 'password';
    if (btn) btn.textContent = '\uD83D\uDC41'; // eye = show
  }
}

// ── Load scan credits into settings panel ──
async function loadSettingsScanCredits() {
  const countEl   = document.getElementById('settingsScanCount');
  const subEl     = document.getElementById('settingsScanSub');
  const idCountEl = document.getElementById('idScanCount');
  const idSubEl   = document.getElementById('idScanSub');
  if (!countEl) return;

  // Wait for Firebase auth to resolve before checking email
  if (!window._userEmail) await window._waitForAuth();

  const email     = window._userEmail || window.googleUser?.email || '';
  const googleSub = window.googleUser?.sub || window.googleUser?.id || window._googleSub || '';

  if (!email) {
    countEl.textContent = '—';
    if (subEl)     subEl.textContent = 'Sign in to check';
    if (idCountEl) idCountEl.textContent = '—';
    if (idSubEl)   idSubEl.textContent = 'Sign in to check';
    return;
  }

  countEl.textContent = '…';
  if (idCountEl) idCountEl.textContent = '…';

  try {
    const params = new URLSearchParams({ email });
    if (googleSub) params.set('sub', googleSub);
    const res  = await fetch('/api/scan-credits?' + params.toString());
    const data = await res.json();
    const credits   = typeof data.credits   === 'number' ? data.credits   : 0;
    const idCredits = typeof data.idCredits === 'number' ? data.idCredits : 0;
    const isPro     = data.isPro || false;

    window._idScanCredits = idCredits;
    window._scanCredits = credits;
    if (typeof updateScanBtnCredits === 'function') updateScanBtnCredits();

    // — Grader Credits —
    countEl.textContent = credits.toString();
    countEl.style.color = credits === 0 ? 'var(--red, #f87171)' : 'var(--text)';
    if (subEl) {
      if (isPro && credits > 0) {
        subEl.textContent = 'Pro monthly included';
        subEl.style.color = '';
      } else if (credits === 0) {
        subEl.textContent = 'None left — buy below';
        subEl.style.color = 'var(--red, #f87171)';
      } else {
        subEl.textContent = 'Buy Grade Pack';
        subEl.style.color = '';
      }
    }

    // — ID Scanner Credits —
    if (idCountEl) {
      idCountEl.textContent = idCredits.toString();
      idCountEl.style.color = idCredits === 0 ? 'var(--red, #f87171)' : 'var(--gold)';
    }
    if (idSubEl) {
      idSubEl.textContent  = idCredits === 0 ? 'None left — buy below' : 'Never expire';
      idSubEl.style.color  = idCredits === 0 ? 'var(--red, #f87171)' : '';
    }
  } catch(e) {
    countEl.textContent = '—';
    if (subEl)     subEl.textContent = 'Could not load';
    if (idCountEl) idCountEl.textContent = '—';
    if (idSubEl)   idSubEl.textContent = 'Could not load';
  }
}

// ── Save TPL key ──
function saveTPLKey() {
  const val = (document.getElementById('tplKeyInput')?.value || '').trim();
  window.tplApiKey = val;
  // Deliberately not persisted: nothing ever read this value back, so storing
  // a user API key on disk bought nothing. Held in memory for this page only.
  updateKeyStatus();
  // Close panel after save
  document.getElementById('settingsPanel')?.classList.remove('open');
  document.querySelector('[data-settings-toggle]')?.classList.remove('active');
}

// ── Update key status indicator ──
function updateKeyStatus() {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const badge = document.getElementById('badgeFulldb');
  const lockEl = document.getElementById('tplLockIndicator');
  const hasKey = !!window.tplApiKey;
  if (dot)  { dot.className  = 'status-dot ' + (hasKey ? 'active' : 'inactive'); }
  if (text) { text.textContent = hasKey
    ? 'Key active — full database unlocked (300K+ cards, JP sets, graded prices)'
    : 'No key — using free sources. Get a free key at tcgpricelookup.com'; }
  if (badge)  { badge.classList.toggle('visible', hasKey); }
  if (lockEl) { lockEl.classList.toggle('visible', hasKey); }
}

// ── TCGPriceLookup search ──
// After TPL renders results (no images), fetch images from pokemontcg.io and inject them
async function injectPokemonImages(cards, gameSlug) {
  // TPL already provides per-card image_url — use it directly, no extra fetch needed
  cards.forEach((c, i) => {
    const img = c.image_url || '';
    if (!img) return;
    if (window._searchCards[i]) window._searchCards[i]._imgSmall = img;
    // Update dropList thumb
    const item = dropList.querySelector(`[data-idx="${i}"]`);
    if (item) {
      const ph = item.querySelector('.drop-thumb-ph');
      if (ph) {
        const el = document.createElement('img');
        el.className = 'drop-thumb';
        el.src = img; el.alt = c.name;
        ph.replaceWith(el);
      }
    }
    // Update catalog row if open — always inject real image (replaces placeholder)
    const catCard = document.querySelector(`#searchModalGrid [data-idx="${String(i)}"]`);
    if (catCard) {
      const area = catCard.querySelector('.cat-img-area');
      if (area) {
        const existing = area.querySelector('img');
        if (existing) {
          // Update src if it's a placeholder or empty
          if (!existing.src || existing.src.includes('1F0CF')) existing.src = img;
          else existing.src = img; // always update to best image
        } else {
          area.innerHTML = `<img src="${img}" loading="lazy" style="width:100%;height:100%;object-fit:contain">`;
        }
      }
    }
  });
}

// 2026-09-03: the upstream search does not honour a set name in the query.
// "Charizard Base Set" came back with Base Set 2 (#004/130) ranked ABOVE Base
// Set (#004/102), so the first dropdown row -- and anything that auto-picks
// row 0 -- silently loaded the wrong Charizard. Every downstream price was
// then correct for a card the user had not asked for, which is the worst kind
// of wrong: nothing on screen looks broken.
//
// Re-rank locally on the set hint. This ONLY reorders; it never drops a row,
// so a set hint we fail to parse can at worst leave the upstream order alone.
// 2026-09-03: TPL nests the set as c.set.name -- there is NO c.set_name on a
// TPL row. Every dropdown that read c.set_name therefore printed an EMPTY set
// label, which is how "Charizard Base Set" could quietly load Base Set 2: the
// one field that would have shown the user the difference was blank. Scryfall
// and the scan API DO return a flat set_name, so this helper is applied only
// on TPL rows and those call sites are left alone.
function _tplSetName(c) {
  if (!c) return '';
  return c.set_name || (c.set && c.set.name) || '';
}

function _setHintScore(queryHint, setName) {
  const norm = (s) => String(s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const hint = norm(queryHint);
  const set  = norm(setName);
  if (!hint || !set) return 0;

  if (set === hint) return 100;              // "base set" -> Base Set

  // Whole-token prefix. "base set" prefixes "base set 2", but must score
  // BELOW an exact hit or Base Set 2 keeps winning. Longer tail = weaker.
  if (set.startsWith(hint + ' ')) {
    const extra = set.slice(hint.length).trim().split(' ').length;
    return Math.max(50, 70 - extra * 5);
  }
  // Hint carries the longer name ("base set 2" typed, set is "Base Set") --
  // a real but weaker signal than the two above.
  if (hint.startsWith(set + ' ')) return 45;
  if (set.includes(hint)) return 40;

  // Fall back to token overlap so "team rocket" still beats an unrelated set.
  const hv = hint.split(' '), sv = new Set(set.split(' '));
  const hits = hv.filter(t => sv.has(t)).length;
  return hits ? Math.round((hits / hv.length) * 30) : 0;
}

function _rankTplBySetHint(rows, q) {
  if (!Array.isArray(rows) || rows.length < 2) return rows;
  const norm = (s) => String(s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const nq = norm(q);
  if (!nq) return rows;

  // The set hint is whatever the query says beyond the matched card name. Use
  // the LONGEST card name that the query actually contains, so "Charizard ex"
  // is not mistaken for "Charizard" and its " ex" treated as a set.
  let name = '';
  for (const c of rows) {
    const n = norm(c && c.name);
    if (n && nq.includes(n) && n.length > name.length) name = n;
  }
  const hint = (name ? nq.replace(name, ' ') : nq).replace(/\s+/g, ' ').trim();
  // No hint means the user typed a bare card name -- upstream relevance order
  // is as good as anything we could invent, so leave it untouched.
  if (!hint) return rows;

  // Decorate-sort-undecorate keeps ties in upstream order (Array#sort is only
  // guaranteed stable in modern engines; the index tiebreak makes it explicit).
  return rows
    .map((c, i) => ({ c, i, s: _setHintScore(hint, c && (c.set_name || (c.set && c.set.name))) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map(x => x.c);
}

async function searchWithTPL(q, gameSlug) {
  if (!window.tplApiKey) return null;
  try {
    // Proxied server-side so the paid TPL key never ships to the browser.
    const url = `/api/tpl-proxy?path=/v1/cards/search&q=${encodeURIComponent(q)}&game=${encodeURIComponent(gameSlug)}&limit=100`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const json = await r.json();
    if (!(json.data && json.data.length)) return null;
    return _rankTplBySetHint(json.data, q);
  } catch(e) {
    console.warn('TPL search error:', e);
    return null;
  }
}

// ── Convert TPL card to normalized format ──
function tplCardToNormalized(c, gameSlug, fallbackImage) {
  const raw = c.prices?.raw || {};
  const COND_MAP = [
    { key: 'near_mint',        label: 'Near Mint (NM)' },
    { key: 'lightly_played',   label: 'Lightly Played (LP)' },
    { key: 'moderately_played',label: 'Moderately Played (MP)' },
    { key: 'heavily_played',   label: 'Heavily Played (HP)' },
    { key: 'damaged',          label: 'Damaged (DM)' },
  ];
  const priceVariants = [];
  COND_MAP.forEach(({ key, label }) => {
    const condData = raw[key] || {};
    // Try tcgplayer.market first, then ebay avg, then direct market field
    const mkt = condData?.tcgplayer?.market
             ?? condData?.ebay?.avg_7d
             ?? condData?.ebay?.avg_1d
             ?? condData?.market
             ?? null;
    const low  = condData?.tcgplayer?.low   ?? condData?.ebay?.avg_30d ?? null;
    const high = condData?.tcgplayer?.high  ?? condData?.ebay?.avg_1d  ?? null;
    if (mkt !== null) {
      priceVariants.push({ key, label, market: mkt, low, mid: mkt, high });
    }
  });
  // Graded prices
  const graded = c.prices?.graded || {};
  const GRADERS = ['psa', 'bgs', 'cgc', 'ace', 'tag', 'sgc'];
  GRADERS.forEach(grader => {
    const g = graded[grader] || {};
    Object.keys(g).forEach(grade => {
      // API returns ebay.avg_1d / avg_7d / avg_30d — use 7d as market price
      const ebay = g[grade]?.ebay || {};
      const mkt = ebay.avg_7d ?? ebay.avg_1d ?? ebay.avg_30d ?? g[grade]?.market ?? null;
      if (mkt !== null) {
        const key = `${grader}_${grade}`.replace('.', '_');
        const label = `${grader.toUpperCase()} ${grade}`;
        const low  = ebay.avg_30d ?? mkt;
        const high = ebay.avg_1d  ?? mkt;
        priceVariants.push({ key, label, market: mkt, low, mid: mkt, high });
      }
    });
  });
  if (!priceVariants.length) {
    priceVariants.push({ key: 'manual', label: 'Manual', market: null, low: null, mid: null, high: null });
  }
  // Use TPL's own image_url as the base image — fallbackImage (pokemontcg.io) overrides if injected later
  const baseImg = fallbackImage || c.image_url || '';
  return {
    name:  c.name,
    game:  gameSlug,
    images: { small: baseImg, large: baseImg },
    setName: c.set_name || c.set?.name || '',
    number:  c.number || c.card_number || '',
    rarity:  c.rarity || '',
    priceVariants,
    source: 'TCGPriceLookup',
    updatedAt: 'daily',
    tplId: c.id || null,          // preserve exact card ID for graded re-fetch
    tplGameSlug: gameSlug,
  };
}

// ── Fetch full card by ID (includes complete graded data) ──
async function fetchTPLCardById(id, gameSlug) {
  if (!window.tplApiKey || !id) return null;
  try {
    const url = `/api/tpl-proxy?path=/v1/cards/${encodeURIComponent(id)}`;
    const r = await fetch(url);
    if (!r.ok) { console.warn('TPL fetch by ID failed:', r.status); return null; }
    const json = await r.json();
    const c = json.data || json;
    if (!c) return null;
    const img = selectedCard?.images?.small || '';
    return tplCardToNormalized(c, gameSlug || selectedCard?.tplGameSlug || 'pokemon', img);
  } catch(e) {
    console.warn('TPL fetchById error:', e);
    return null;
  }
}

// ── Fetch graded data from TPL by card name + number (for cards loaded from pokemontcg.io) ──
async function fetchTPLGradedByNameNumber(name, number, gameSlug) {
  if (!window.tplApiKey || !name) return null;
  try {
    const url = `/api/tpl-proxy?path=/v1/cards/search&q=${encodeURIComponent(name)}&game=${encodeURIComponent(gameSlug || 'pokemon')}&limit=20`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const json = await r.json();
    const cards = json.data || [];
    if (!cards.length) return null;

    // Try to find exact number match first
    // pokemontcg.io gives "232" but TPL gives "232/091" — normalize by stripping the /set-size part
    const normalizeNum = n => (n || '').replace(/\s/g,'').split('/')[0].replace(/^0+/, '') || n;
    let match = null;
    if (number) {
      const normTarget = normalizeNum(number);
      // Exact normalized match (e.g. "232" matches "232/091")
      match = cards.find(c => normalizeNum(c.number) === normTarget);
      // Full string fallback (e.g. both have "172/142")
      if (!match) match = cards.find(c => (c.number || '').replace(/\s/g,'') === number.replace(/\s/g,''));
    }
    // TPL's search is fuzzy, so a query for one name can return others.
    // Anything we fall back to below is chosen WITHOUT a number match, so
    // restrict the pool to cards that actually share the requested name --
    // otherwise the graded ladder can be filled in from a different card.
    const _wantName = (name || '').toLowerCase().trim();
    const sameName = cards.filter(c => (c.name || '').toLowerCase().trim() === _wantName);
    const pool = sameName.length ? sameName : [];
    // Fallback: pick the rarest card with graded data
    if (!match) {
      const withGraded = pool.filter(c => {
        const g = c.prices?.graded || {};
        return Object.keys(g).some(grader => Object.keys(g[grader] || {}).length > 0);
      });
      if (withGraded.length) {
        // Sort rarest first
        const rarityScore = r => {
          const t = (r || '').toLowerCase();
          if (t.includes('special illustration')) return 0;
          if (t.includes('ultra rare')) return 1;
          if (t.includes('rare')) return 2;
          return 3;
        };
        withGraded.sort((a,b) => rarityScore(a.rarity) - rarityScore(b.rarity));
        match = withGraded[0];
      }
    }
    // Last resort stays inside the same-name pool. Previously this was
    // cards[0] over the raw fuzzy results, which could hand back a different
    // card's graded prices; with no same-name candidate we return nothing and
    // the graded rows simply stay empty.
    if (!match) match = pool[0] || null;

    // Store the tplId on selectedCard for future lookups
    if (match && selectedCard) {
      selectedCard.tplId = match.id;
      selectedCard.tplGameSlug = gameSlug || 'pokemon';
    }

    // Extract graded variants
    const graded = match?.prices?.graded || {};
    const GRADERS = ['psa', 'bgs', 'cgc', 'ace', 'tag', 'sgc'];
    const gradedVariants = [];
    GRADERS.forEach(grader => {
      const g = graded[grader] || {};
      Object.keys(g).forEach(grade => {
        const ebay = g[grade]?.ebay || {};
        const mkt = ebay.avg_7d ?? ebay.avg_1d ?? ebay.avg_30d ?? g[grade]?.market ?? null;
        if (mkt !== null) {
          const key = `${grader}_${grade}`.replace(/\./, '_');
          const label = `${grader.toUpperCase()} ${grade}`;
          gradedVariants.push({ key, label, market: mkt, low: ebay.avg_30d ?? mkt, mid: mkt, high: ebay.avg_1d ?? mkt });
        }
      });
    });
    return gradedVariants;
  } catch(e) {
    console.warn('TPL graded by name error:', e);
    return null;
  }
}

// ── State ──
let selectedCard = null;
let currentPrices = {};      // { variantKey: { market, low, mid, high } }
let activeGame = 'pokemon';
try { window.activeGame = 'pokemon'; } catch(_) {} // 2026-08-22: expose for FastPath IIFE
let sortMode = 'payout';
let searchTimeout = null;

// ── Last-card persistence (2026-08-20) ──
// Two bugs this fixes:
//   1) Deep Grade "View Card" was flaky because it relied on
//      window._pendingIdScanCard, which gets consumed and null'd by the
//      identify auto-load. Solution: mirror every identify into a stable
//      window._lastIdentifiedCard that's never null'd, only overwritten.
//   2) Refreshing the page nuked the card the user was viewing. Solution:
//      persist the last loaded card to localStorage on every loadCardUI,
//      then restore it on window 'load' after auth resolves.
window._lastIdentifiedCard = window._lastIdentifiedCard || null;
const _CR_LAST_CARD_KEY = 'cr:lastCard:v1';

function _persistLastIdentified(pending) {
  if (!pending || !pending.name) return;
  try {
    window._lastIdentifiedCard = JSON.parse(JSON.stringify(pending));
    localStorage.setItem(_CR_LAST_CARD_KEY + ':ident', JSON.stringify(pending));
  } catch(e) { /* localStorage may be full or disabled */ }
}

function _persistLastLoadedCard(card) {
  if (!card) return;
  try {
    // pokemontcg.io cards have card.set as an object; unwrap it.
    const setName = (card.set && typeof card.set === 'object' && card.set.name)
      ? card.set.name
      : (typeof card.set === 'string' ? card.set : (card.setName || card.set_name || ''));
    const snapshot = {
      name:     card.name || '',
      number:   card.number || card.card_number || '',
      setName:  setName,
      setCode:  card.setCode || card.set_code || (card.set && card.set.id) || '',
      id:       card.id || card.groundedId || '',
      game:     card.game || activeGame || 'pokemon',
      images:   card.images || null,
      rarity:   card.rarity || '',
      hp:       card.hp || '',
      _fullCard: card,       // stash the whole thing for exact re-render
      _savedAt: Date.now(),
    };
    const json = JSON.stringify(snapshot);
    localStorage.setItem(_CR_LAST_CARD_KEY, json);
    console.log('[persistLastCard] saved', snapshot.name, snapshot.number, '(' + json.length + 'B)');
  } catch(e) { console.warn('[persistLastCard] failed:', e); }
}

function _clearLastLoadedCard() {
  try {
    localStorage.removeItem(_CR_LAST_CARD_KEY);
    localStorage.removeItem(_CR_LAST_CARD_KEY + ':ident');
  } catch(e) {}
}

// Set to true while restore is running so other code paths know not to
// clobber the just-restored card (defense in depth).
window._crRestoreInFlight = false;

function _restoreLastLoadedCard() {
  try {
    const raw = localStorage.getItem(_CR_LAST_CARD_KEY);
    console.log('[restoreLastCard] key=' + _CR_LAST_CARD_KEY + ' raw=' + (raw ? (raw.length + 'B') : 'null'));
    if (!raw) return false;
    const snap = JSON.parse(raw);
    if (!snap || !snap.name) { console.log('[restoreLastCard] no name in snap'); return false; }
    // Only auto-restore cards saved in the last 7 days.
    if (snap._savedAt && (Date.now() - snap._savedAt) > 7*24*3600*1000) {
      _clearLastLoadedCard();
      return false;
    }
    console.log('[restoreLastCard] restoring', snap.name, snap.number, 'game=' + snap.game);
    window._crRestoreInFlight = true;

    // Also restore ident snapshot if present so Deep Grade View Card works
    // for the restored card on the very first tap after refresh.
    try {
      const identRaw = localStorage.getItem(_CR_LAST_CARD_KEY + ':ident');
      if (identRaw) {
        const ident = JSON.parse(identRaw);
        if (ident && ident.name) {
          window._lastIdentifiedCard = ident;
          window._pendingIdScanCard = ident;
        }
      }
    } catch(_) {}

    // Switch game selector FIRST (this internally calls resetCardPanel()),
    // THEN load the card. If we already match the active game, skip the
    // switchGame call entirely so we don't reset our own panel.
    try {
      if (snap.game && snap.game !== activeGame && typeof switchGame === 'function') {
        switchGame(snap.game);
      }
    } catch(_) {}
    try { if (typeof switchView === 'function') switchView('lookup'); } catch(_) {}

    // Fast path: if we saved the full card object, re-hydrate directly.
    const doHydrate = () => {
      if (snap._fullCard && typeof loadCardUI === 'function') {
        try {
          selectedCard = snap._fullCard;
          loadCardUI(snap._fullCard);
          console.log('[restoreLastCard] hydrated via _fullCard');
          window._crRestoreInFlight = false;
          return true;
        } catch(e) { console.warn('[restoreLastCard] _fullCard hydrate failed', e); }
      }
      // Fallback: use exact-load routers if available.
      if (snap.name && typeof _loadScannedCardExact === 'function') {
        const pending = {
          name: snap.name, number: snap.number, setName: snap.setName,
          setCode: snap.setCode, groundedId: snap.id, rarity: snap.rarity,
          hp: snap.hp, cardType: snap.game === 'sports' ? 'sports' : (snap.game || 'pokemon'),
          isJapanese: snap.game === 'pokemonjp',
        };
        try {
          _loadScannedCardExact(pending);
          console.log('[restoreLastCard] hydrated via _loadScannedCardExact');
          window._crRestoreInFlight = false;
          return true;
        } catch(e) { console.warn('[restoreLastCard] exact-load fallback failed', e); }
      }
      window._crRestoreInFlight = false;
      return false;
    };

    // Hydrate now, and again after a beat in case switchGame or other
    // init code resets the panel just after we do.
    const ok = doHydrate();
    setTimeout(() => {
      // If something reset the panel (e.g. auth handler ran resetCardPanel),
      // re-hydrate. Detect reset by checking the placeholder label.
      const lab = document.getElementById('cardImgPhLabel');
      const ph  = document.getElementById('cardImgPh');
      const phVisible = ph && getComputedStyle(ph).display !== 'none';
      if (phVisible || (lab && /No card selected/i.test(lab.textContent || ''))) {
        console.log('[restoreLastCard] panel was cleared after restore; re-hydrating');
        doHydrate();
      }
    }, 1200);
    return ok;
  } catch(e) { console.warn('[_restoreLastLoadedCard] failed', e); window._crRestoreInFlight = false; }
  return false;
}

// ── DOM refs ──
const searchInput   = document.getElementById('searchInput');
const searchRow     = document.getElementById('searchRow');
const dropList      = document.getElementById('dropList');
const priceMain     = document.getElementById('priceMain');
const priceRange    = document.getElementById('priceRange');
const priceSource   = document.getElementById('priceSource');
const jpLinksPanel  = document.getElementById('jpLinksPanel');
const jpEbayLink    = document.getElementById('jpEbayLink');
const jpPCLink      = document.getElementById('jpPCLink');
const priceOverride = document.getElementById('priceOverride');
const printSelect   = document.getElementById('printingSelect');
const gradeRow      = document.getElementById('gradeRow');
const gradeLabel    = document.getElementById('gradeLabel');
const cardImg       = document.getElementById('cardImg');
const cardImgWrap   = document.getElementById('cardImgWrap');
const cardImgPh     = document.getElementById('cardImgPh');
const sportsCardPh  = document.getElementById('sportsCardPh');
const cardNameEl    = document.getElementById('cardNameEl');
const cardMetaEl    = document.getElementById('cardMetaEl');
const cardNameBlock = document.getElementById('cardNameBlock');
const resultsArea   = document.getElementById('resultsArea');
const sportsForm    = document.getElementById('sportsForm');
const otherTcgNote  = document.getElementById('otherTcgNote');

// ── Sport emojis ──
const SPORT_EMOJI = {
  Baseball: '⚾', Basketball: '🏀', Football: '🏈',
  Hockey: '🏒', Soccer: '⚽', Other: '🏆'
};
// Strip any emoji/pictograph before it can end up in a search URL. Also strips
// zero-width joiners and variation selectors that can otherwise sneak into eBay
// queries. Safe for all Latin text.
function _stripEmoji(s) {
  if (!s) return '';
  try {
    return String(s)
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}]/gu, '')
      .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')  // flags
      .replace(/[\u{FE00}-\u{FE0F}\u{200D}]/gu, '') // variation selectors + ZWJ
      .replace(/\s+/g, ' ')
      .trim();
  } catch(_) {
    // Fallback for engines without Unicode property escapes
    return String(s).replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
  }
}

// ── Category pills ──
// 2026-08-22: "Try an example" CTA on the landing/social-proof bar.
// Previously the inline onclick referenced an undefined function and threw
// ReferenceError on tap. Now: switch to Pokemon, populate the search input
// with an iconic name, kick off the same doSearch() the user would run.
function loadExampleCard() {
  try {
    // Ensure Pokemon is the active game (default anyway, but be explicit)
    if (activeGame !== 'pokemon') {
      try { onGameSelectChange('pokemon'); } catch(_) {}
    }
    const si = document.getElementById('searchInput');
    if (si) {
      si.value = 'Charizard';
      si.focus();
      // Scroll the search row into view so the dropdown lands on screen
      try { si.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(_){}
    }
    // Trigger the normal search flow so the user sees the real dropdown
    // of printings they'd get after typing themselves.
    if (typeof doSearch === 'function') doSearch('Charizard');
    try { window.trackEvent?.('example_card_tap', { name: 'Charizard' }); } catch(_){}
  } catch(err) {
    console.warn('[loadExampleCard] failed:', err);
  }
}
try { window.loadExampleCard = loadExampleCard; } catch(_){}

// 2026-09-01 (launch gate): a first-time visitor must land on a FINISHED
// payout, not on "No card selected" and not on a dropdown they still have to
// tap. This runs the real user path — doSearch() then a click on the first
// printing — rather than hydrating a hardcoded card object, so the example can
// never drift out of sync with the live catalog or the ranker.
//
// Deliberately does NOT focus the search input the way loadExampleCard() does:
// focusing pops the soft keyboard on mobile over the very result we want them
// to read.
async function autoRunExampleCard() {
  try {
    if (activeGame !== 'pokemon') { try { onGameSelectChange('pokemon'); } catch(_){} }
    const si = document.getElementById('searchInput');
    if (si) si.value = 'Charizard';
    try { window.trackEvent?.('example_card_auto', { name: 'Charizard' }); } catch(_){}
    if (typeof doSearch !== 'function') return false;
    doSearch('Charizard');

    // Wait for the dropdown to populate, then take the top printing. Poll
    // rather than use a fixed delay — search latency varies with cold caches.
    const dl = document.getElementById('dropList');
    if (!dl) return false;
    for (let waited = 0; waited < 9000; waited += 150) {
      const first = dl.querySelector('.drop-item');
      if (first) {
        // A real click so the existing handler runs: it builds the card via
        // cardFactory, calls loadCardUI, and auto-fills the price override.
        first.click();
        try { dl.classList.remove('open'); } catch(_){}
        return true;
      }
      await new Promise(r => setTimeout(r, 150));
    }
    // Search never returned usable rows (API hiccup). Leave the hero and the
    // "Try Charizard" CTA in place so the visitor still has a way forward.
    return false;
  } catch (err) {
    console.warn('[autoRunExampleCard] failed:', err);
    return false;
  }
}
try { window.autoRunExampleCard = autoRunExampleCard; } catch(_){}

function onGameSelectChange(game) {
  activeGame = game;
  try { window.activeGame = game; } catch(_) {} // 2026-08-22: expose for FastPath
  try { document.body.setAttribute('data-game-theme', game); } catch(_) {}

  // Sync select
  const sel = document.getElementById('gameSelect');
  if (sel && sel.value !== game) sel.value = game;

  // Clear search state
  dropList.classList.remove('open');
  dropList.innerHTML = '';
  selectedCard = null;
  resetCardPanel();
  // Sports hides the Condition / Graded Slab pills. Switching game does not
  // load a card, so without this the pills stayed hidden on the way back to
  // Pokemon until the user happened to load one.
  try { _applySportsPriceControls({ game }); } catch(_) {}

  const isSports = game === 'sports';
  const isOther  = game === 'other';

  searchRow.style.display = isSports ? 'none' : 'flex';
  sportsForm.style.display = isSports ? 'block' : 'none';
  otherTcgNote.style.display = isOther ? 'block' : 'none';

  const placeholders = {
    pokemon:   'Search card name (e.g. Charizard, Pikachu VMAX…)',
    pokemonjp: 'Search JP card name (e.g. Vileplume, Charizard, Mew…)',
    mtg:       'Search card name (e.g. Black Lotus, Jace…)',
    yugioh:    'Search card name (e.g. Dark Magician, Blue-Eyes…)',
    lorcana:   'Search card name (e.g. Elsa, Mickey Mouse…)',
    onepiece:  'Search card name (e.g. Luffy, Zoro…)',
    other:     'Enter card name to search (manual price only)',
  };
  if (!isSports && searchInput) {
    searchInput.placeholder = placeholders[game] || 'Search card name…';
    searchInput.value = '';
  }

  // Sync hidden pills if they exist
  document.querySelectorAll('#catRow .cat-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.game === game);
  });
}

// Keep hidden pills in DOM for JS compatibility — sync select when pill changes
document.querySelectorAll('#catRow .cat-pill').forEach(p => {
  p.addEventListener('click', () => {
    document.querySelectorAll('#catRow .cat-pill').forEach(x => x.classList.remove('active'));
    p.classList.add('active');
    // Sync dropdown
    const selEl = document.getElementById('gameSelect');
    if (selEl) selEl.value = p.dataset.game;
    activeGame = p.dataset.game;
    try { document.body.setAttribute('data-game-theme', p.dataset.game); } catch(_) {}
    dropList.classList.remove('open');
    dropList.innerHTML = '';

    // Show/hide sports form and other-tcg note
    const isSports = activeGame === 'sports';
    const isOther  = activeGame === 'other';
    const isJP    = activeGame === 'pokemonjp';

    // Show the main search row for all non-sports tabs
    // Sports has its own search bar inside the sportsForm
    searchRow.style.display = isSports ? 'none' : 'flex';
    sportsForm.style.display = isSports ? 'block' : 'none';
    otherTcgNote.style.display = isOther ? 'block' : 'none';

    // Update search placeholder
    const placeholders = {
      pokemon:   'Search card name (e.g. Charizard, Pikachu VMAX…)',
      pokemonjp: 'Search JP card name (e.g. Vileplume, Charizard, Mew…)',
      mtg:       'Search card name (e.g. Black Lotus, Jace…)',
      yugioh:    'Search card name (e.g. Dark Magician, Blue-Eyes…)',
      other:     'Enter card name to search (manual price only)',
    };
    if (!isSports) {
      searchInput.placeholder = placeholders[activeGame] || 'Search card name…';
      searchInput.value = '';
      dropList.innerHTML = '';
    } else {
      // Clear sports search bar on re-entering sports tab
      const ssi = document.getElementById('sportsSearchInput');
      if (ssi) ssi.value = '';
      const sdl = document.getElementById('sportsDropList');
      if (sdl) { sdl.innerHTML = ''; sdl.classList.remove('open'); }
    }

    // Clear selected card state for non-sports
    if (!isSports) {
      selectedCard = null;
      resetCardPanel();
    } else {
      // Show sports placeholder in card panel
      resetCardPanel();
      cardImgPh.style.display = 'none';
      sportsCardPh.style.display = 'flex';
    }
  });
});

// ── Search debounce ──
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim();
  if (q.length < 2) { dropList.classList.remove('open'); return; }
  searchTimeout = setTimeout(() => doSearch(q), 180);
});

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    clearTimeout(searchTimeout);
    const q = searchInput.value.trim();
    if (!q) return;
    // Enter key → open full-screen search modal
    openSearchModal();
  }
  if (e.key === 'Escape') dropList.classList.remove('open');
});

document.getElementById('searchBtn').addEventListener('click', () => {
  clearTimeout(searchTimeout);
  if (!window._pendingScanBannerCard) hideGradingCtaBanner();
});

document.addEventListener('click', e => {
  if (!e.target.closest('.search-area')) dropList.classList.remove('open');
});

// ── Main search dispatcher ──
// 2026-08-22 [F4]: monotonic search request ID guards against out-of-order
// dropdown responses. Each doSearch() bumps the ID; game-specific search
// functions capture their snapshot and check window._searchReqId before
// writing to dropList.innerHTML. Late responses from an earlier query no
// longer overwrite the newer query's results.
window._searchReqId = 0;
// 2026-08-22 [F4]: helper for search functions to guard innerHTML writes.
// Call at entry: const reqSnap = _snapSearchReq();  Then before writing:
// if (!_searchReqStillCurrent(reqSnap)) return;
function _snapSearchReq() { return window._searchReqId; }
function _searchReqStillCurrent(snap) { return snap === window._searchReqId; }
async function doSearch(q) {
  if (!q) return;
  if (activeGame === 'sports') return;

  const myReqId = ++window._searchReqId;

  // 2026-08-15: track the query that populated dropList so openCatalog can
  // detect stale results from a previous search (e.g. user types Pidove but
  // the old Latias ex drops are still cached in the list).
  dropList.dataset.lastQuery = (q || '').toLowerCase().trim();
  dropList.dataset.lastGame  = activeGame || '';
  dropList.dataset.reqId     = String(myReqId);
  dropList.innerHTML = '<div class="drop-loading"><span class="spinner" style="border-color:rgba(0,0,0,.2);border-top-color:var(--gold)"></span> Searching…</div>';
  dropList.classList.add('open');

  try {
    if (activeGame === 'pokemon') {
      await searchPokemon(q);
    } else if (activeGame === 'pokemonjp') {
      await searchPokemonJP(q);
    } else if (activeGame === 'mtg') {
      await searchMTG(q);
    } else if (activeGame === 'yugioh') {
      await searchYugioh(q);
    } else if (activeGame === 'lorcana') {
      await searchLorcana(q);
    } else if (activeGame === 'onepiece') {
      await searchOnePiece(q);
    } else if (activeGame === 'other') {
      if (myReqId === window._searchReqId) {
        dropList.innerHTML = '<div class="drop-empty">No live API for "Other TCG". Enter your price manually in the Override field.</div>';
      }
    }
  } catch(err) {
    console.error(err);
    if (myReqId === window._searchReqId) {
      dropList.innerHTML = '<div class="drop-empty">Search failed — check your connection and try again.</div>';
    }
  }
  // Return drop items so callers can render directly without polling
  return dropList.querySelectorAll('.drop-item');
}

/* ── Pokémon API (PokemonTCG.io) ── */
async function searchPokemon(q) {
  const _reqSnap = _snapSearchReq(); // 2026-08-22 [F4] stale-write guard
  // Try TCGPriceLookup first if key is set
  const tplData = await searchWithTPL(q, 'pokemon');
  if (!_searchReqStillCurrent(_reqSnap)) return;
  if (tplData) {
    // Sort by name relevance: exact → starts-with → word-starts-with → contains
    const ql = q.toLowerCase().trim();
    const nameScore = n => {
      const nl = n.toLowerCase();
      if (nl === ql)                         return 0;
      if (nl.startsWith(ql + ' ') || nl === ql) return 1;
      if (nl.startsWith(ql))                 return 2;
      if (nl.split(' ').some(w => w.startsWith(ql))) return 3;
      return 4;
    };
    tplData.sort((a, b) => nameScore(a.name) - nameScore(b.name));
    window._searchCards = {};
    dropList.innerHTML = tplData.map((c, i) => {
      window._searchCards[i] = { _tpl: c, game: 'pokemon' };
      const nmPrice = c.prices?.raw?.near_mint?.tcgplayer?.market ?? null;
      return `<div class="drop-item" data-idx="${i}" data-number="${esc(c.number||'')}" data-set="${esc(c.set?.name||c.set_name||'')}" data-rarity="${esc(c.rarity||'')}" role="option">
        <div class="drop-thumb-ph">🃏</div>
        <div class="drop-info">
          <div class="drop-name">${esc(c.name)}</div>
          <div class="drop-meta">${esc(c.set?.name||c.set_name||'')}${c.number ? ' · #'+esc(c.number) : ''}${c.rarity ? ' · ' + esc(c.rarity) : ''} <span style="font-size:.68rem;color:var(--gold-text)">TPL</span></div>
        </div>
        ${nmPrice !== null ? `<span class="drop-price">$${nmPrice.toFixed(2)}</span>` : `<span class="drop-no-price">No price</span>`}
      </div>`;
    }).join('');
    attachDropHandlers(i => {
      const entry = window._searchCards[i];
      return tplCardToNormalized(entry._tpl, 'pokemon', entry._imgSmall || '');
    });
    // Fetch images in background without blocking the dropdown
    injectPokemonImages(tplData, 'pokemon');
    return;
  }

  // Fallback: PokemonTCG.io
  const url = `https://api.pokemontcg.io/v2/cards?q=name:${encodeURIComponent(q)}*&pageSize=250&orderBy=set.releaseDate&select=id,name,set,number,rarity,images,tcgplayer,supertype,subtypes`;
  const r = await fetch(url);
  const data = await r.json();
  if (!_searchReqStillCurrent(_reqSnap)) return; // 2026-08-22 [F4]
  let cards = data.data || [];

  // Sort: exact match first, then by rarity (rarest first), then by set date desc
  const ql = q.toLowerCase().trim();
  const rarityScore = r => {
    const t = (r || '').toLowerCase();
    if (t.includes('special illustration')) return 0;
    if (t.includes('hyper rare'))           return 1;
    if (t.includes('illustration rare'))    return 2;
    if (t.includes('secret rare'))          return 3;
    if (t.includes('ultra rare'))           return 4;
    if (t.includes('rainbow rare'))         return 5;
    if (t.includes('full art'))             return 6;
    if (t.includes('rare holo') || t.includes('holo rare')) return 7;
    if (t.includes('rare') && !t.includes('ultra')) return 8;
    if (t.includes('promo'))                return 9;
    if (t.includes('uncommon'))             return 10;
    if (t.includes('common'))              return 11;
    return 7;
  };
  cards = cards.slice().sort((a, b) => {
    const nameScore = c => {
      const nl = c.name.toLowerCase();
      if (nl === ql) return 0;
      if (nl.startsWith(ql + ' ') || nl === ql) return 1;
      if (nl.startsWith(ql)) return 2;
      if (nl.split(' ').some(w => w.startsWith(ql))) return 3;
      return 4;
    };
    const na = nameScore(a), nb = nameScore(b);
    if (na !== nb) return na - nb;
    // Within same name-match tier: rarest first
    const ra = rarityScore(a.rarity), rb = rarityScore(b.rarity);
    if (ra !== rb) return ra - rb;
    // Then newest set first
    const da = a.set?.releaseDate || '0000-00-00';
    const db = b.set?.releaseDate || '0000-00-00';
    return db.localeCompare(da);
  });

  if (!cards.length) { dropList.innerHTML = '<div class="drop-empty">No Pokémon cards found. Try a different name.</div>'; return; }

  window._searchCards = {};
  dropList.innerHTML = cards.map((c, i) => {
    window._searchCards[i] = { _raw: c, game: 'pokemon' };
    const prices = c.tcgplayer?.prices || {};
    let bestPrice = null;
    for (const v of Object.keys(prices)) {
      const p = prices[v]?.market || prices[v]?.mid;
      if (p && (!bestPrice || p > bestPrice)) bestPrice = p;
    }
    const img = c.images?.small;
    const setName = c.set?.name || '';
    const num = c.number ? `#${c.number}` : '';
    const rarity = c.rarity || '';
    return `<div class="drop-item" data-idx="${i}" role="option">
      ${img ? `<img class="drop-thumb" src="${img}" loading="lazy" decoding="async" alt="${esc(c.name)}"/>` : `<div class="drop-thumb-ph">🃏</div>`}
      <div class="drop-info">
        <div class="drop-name">${esc(c.name)}</div>
        <div class="drop-meta">${esc(setName)}${num ? ' · ' + num : ''}${rarity ? ' · ' + esc(rarity) : ''}</div>
      </div>
      ${bestPrice ? `<span class="drop-price">$${bestPrice.toFixed(2)}</span>` : `<span class="drop-no-price">No price</span>`}
    </div>`;
  }).join('');

  attachDropHandlers(i => {
    const entry = window._searchCards[i];
    const c = entry._raw;
    const prices = c.tcgplayer?.prices || {};
    const priceVariants = Object.keys(prices).map(key => ({
      key,
      label: formatVariantName(key),
      market: prices[key]?.market ?? null,
      low:    prices[key]?.low ?? null,
      mid:    prices[key]?.mid ?? null,
      high:   prices[key]?.high ?? null,
    }));
    return {
      name: c.name,
      game: 'pokemon',
      images: { small: c.images?.small || '', large: c.images?.large || '' },
      setName: c.set?.name || '',
      number: c.number || '',
      rarity: c.rarity || '',
      priceVariants,
      source: 'TCGPlayer',
      updatedAt: c.tcgplayer?.updatedAt || '',
    };
  });
}

/* ── Pokémon JP (TCGdex + eBay fallback) ── */
async function searchPokemonJP(q) {
  const _reqSnap = _snapSearchReq(); // 2026-08-22 [F4] stale-write guard
  // Strategy 0: Try TCGPriceLookup (pokemon-jp) if key is set
  const tplData = await searchWithTPL(q, 'pokemon-jp');
  if (!_searchReqStillCurrent(_reqSnap)) return;

  // Strategy 1: Try TCGdex for JP cards (has some JP sets)
  // Strategy 2: For any card, always show eBay JP comps as the primary resource
  // We use PokemonTCG.io with a JP-friendly search (returns EN results) + eBay deep-link

  // First, try PokemonTCG.io for EN art reference / image (with 5s timeout)
  let enCards = [];
  try {
    const enUrl = `https://api.pokemontcg.io/v2/cards?q=name:${encodeURIComponent(q)}*&pageSize=20&orderBy=set.releaseDate&select=id,name,set,number,rarity,images,tcgplayer,supertype,subtypes`;
    const enCtrl = new AbortController();
    const enTimeout = setTimeout(() => enCtrl.abort(), 5000);
    const enR = await fetch(enUrl, { signal: enCtrl.signal });
    clearTimeout(enTimeout);
    if (!_searchReqStillCurrent(_reqSnap)) return; // 2026-08-25 [P1-2]
    const enData = await enR.json();
    if (!_searchReqStillCurrent(_reqSnap)) return; // 2026-08-25 [P1-2]
    enCards = (enData.data || []).slice(0, 5); // just for images
  } catch(e) { /* silently ignore timeout or network errors */ }
  if (!_searchReqStillCurrent(_reqSnap)) return; // 2026-08-25 [P1-2]

  // Build JP search results — always show an eBay JP search card first
  window._searchCards = {};
  const items = [];

  // Always add an eBay JP comps card at top
  const ebayIdx = 0;
  window._searchCards[ebayIdx] = {
    _jpCard: true,
    name: q,
    jpQuery: q,
    game: 'pokemonjp',
  };
  items.push(`<div class="drop-item" data-idx="${ebayIdx}" role="option" style="border-left:3px solid var(--gold)">
    <div class="drop-thumb-ph" style="font-size:1.3rem">JP</div>
    <div class="drop-info">
      <div class="drop-name">${esc(q)} <span style="font-size:.75rem;color:var(--gold-text);font-weight:700">ジャパニーズ</span></div>
      <div class="drop-meta">Click to view eBay JP sold comps + PSA grade prices</div>
    </div>
    <span class="drop-price" style="background:var(--gold);color:#fff;font-size:.7rem;padding:.2rem .5rem;border-radius:.4rem">JP COMPS</span>
  </div>`);

  // If TPL returned real JP data, show those cards (real JP database)
  if (tplData && tplData.length) {
    let offset = 1;
    tplData.forEach((c, i) => {
      const idx = offset + i;
      window._searchCards[idx] = { _tpl: c, game: 'pokemonjp' };
      const nmPrice = c.prices?.raw?.near_mint?.tcgplayer?.market ?? null;
      items.push(`<div class="drop-item" data-idx="${idx}" role="option">
        <div class="drop-thumb-ph">🃏</div>
        <div class="drop-info">
          <div class="drop-name">${esc(c.name)}</div>
          <div class="drop-meta">${esc(_tplSetName(c))}${c.rarity ? ' · ' + esc(c.rarity) : ''} <span style="font-size:.68rem;color:var(--gold-text)">TPL JP</span></div>
        </div>
        ${nmPrice !== null ? `<span class="drop-price">$${nmPrice.toFixed(2)}</span>` : `<span class="drop-no-price">No price</span>`}
      </div>`);
    });
  } else {
    // Add EN cards as reference (art/image only, note they are English)
    let offset = 1;
    enCards.forEach((c, i) => {
      const idx = offset + i;
      window._searchCards[idx] = { _raw: c, game: 'pokemonjp', _isEnRef: true };
      const prices = c.tcgplayer?.prices || {};
      let bestPrice = null;
      for (const v of Object.keys(prices)) {
        const p = prices[v]?.market || prices[v]?.mid;
        if (p && (!bestPrice || p > bestPrice)) bestPrice = p;
      }
      const img = c.images?.small;
      const setName = c.set?.name || '';
      const num = c.number ? `#${c.number}` : '';
      items.push(`<div class="drop-item" data-idx="${idx}" role="option">
        ${img ? `<img class="drop-thumb" src="${img}" loading="lazy" decoding="async" alt="${esc(c.name)}"/>` : `<div class="drop-thumb-ph">🏃</div>`}
        <div class="drop-info">
          <div class="drop-name">${esc(c.name)} <span style="font-size:.7rem;color:var(--text-muted)">[EN ref]</span></div>
          <div class="drop-meta">${esc(setName)}${num ? ' · ' + num : ''} · <em>English version — use JP COMPS for JP pricing</em></div>
        </div>
        ${bestPrice ? `<span class="drop-price">$${bestPrice.toFixed(2)} EN</span>` : `<span class="drop-no-price">EN only</span>`}
      </div>`);
    });
  }

  if (!items.length) {
    // Zero-result telemetry: this is one of the most valuable signals we can
    // collect at launch. If a set/card keeps showing up as "no results", it
    // tells us exactly which newer sets to seed manually vs. relying on
    // PokemonTCG.io ingestion. Also tells us whether users are searching for
    // things we simply don't cover (foreign, sports, custom).
    window.trackEvent?.('search_zero_results', { game: activeGame || 'pokemon', q: (q || '').slice(0, 60) });
    if (!_searchReqStillCurrent(_reqSnap)) return; // 2026-08-25 [P1-2]
    dropList.innerHTML = '<div class="drop-empty">No results found. Try clicking the JP COMPS button above.</div>';
    return;
  }

  window.trackEvent?.('search_results', { game: activeGame || 'pokemon', count: items.length });
  if (!_searchReqStillCurrent(_reqSnap)) return; // 2026-08-25 [P1-2]
  dropList.innerHTML = items.join('');

  attachDropHandlers(i => {
    const entry = window._searchCards[i];
    if (entry._jpCard) {
      // JP card — open eBay comps immediately + load a panel with JP pricing info
      const jpName = entry.jpQuery;
      const ebayJPUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(jpName + ' japanese pokemon card')}&_sacat=183454&LH_Sold=1&LH_Complete=1`;
      const pcUrl = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(jpName + ' japanese')}&type=prices`;
      // Open eBay in new tab automatically (wrapped for EPN commission)
      window.open(buildEbayUrl(ebayJPUrl), '_blank');
      return {
        name: jpName + ' (Japanese)',
        game: 'pokemonjp',
        images: { small: '', large: '' },
        setName: 'Japanese Set',
        number: '',
        rarity: '',
        priceVariants: [
          { key: 'raw_nm', label: 'Raw NM (est.)', market: null, low: null, mid: null, high: null },
          { key: 'psa9',   label: 'PSA 9 (est.)',  market: null, low: null, mid: null, high: null },
          { key: 'psa10',  label: 'PSA 10 (est.)', market: null, low: null, mid: null, high: null },
        ],
        source: 'eBay JP Comps',
        updatedAt: 'See eBay sold listings',
        _jpEbayUrl: ebayJPUrl,
        _jpPCUrl: pcUrl,
      };
    } else if (entry._tpl) {
      // Real JP card from TPL
      return tplCardToNormalized(entry._tpl, 'pokemonjp', '');
    } else {
      // EN reference card
      const c = entry._raw;
      const prices = c.tcgplayer?.prices || {};
      const priceVariants = Object.keys(prices).map(key => ({
        key,
        label: formatVariantName(key) + ' (EN)',
        market: prices[key]?.market ?? null,
        low:    prices[key]?.low ?? null,
        mid:    prices[key]?.mid ?? null,
        high:   prices[key]?.high ?? null,
      }));
      if (!priceVariants.length) priceVariants.push({ key: 'manual', label: 'Manual', market: null, low: null, mid: null, high: null });
      return {
        name: c.name + ' (JP — use Override for JP price)',
        game: 'pokemonjp',
        images: { small: c.images?.small || '', large: c.images?.large || '' },
        setName: (c.set?.name || '') + ' [English ref]',
        number: c.number || '',
        rarity: c.rarity || '',
        priceVariants,
        source: 'TCGPlayer (EN)',
        updatedAt: c.tcgplayer?.updatedAt || '',
      };
    }
  });
}

/* ── Magic: The Gathering (Scryfall) ── */
async function searchMTG(q) {
  const _reqSnap = _snapSearchReq(); // 2026-08-22 [F4]
  // Try TCGPriceLookup first if key is set
  const tplData = await searchWithTPL(q, 'mtg');
  if (!_searchReqStillCurrent(_reqSnap)) return;
  if (tplData) {
    window._searchCards = {};
    dropList.innerHTML = tplData.map((c, i) => {
      window._searchCards[i] = { _tpl: c, game: 'mtg' };
      const nmPrice = c.prices?.raw?.near_mint?.tcgplayer?.market ?? null;
      return `<div class="drop-item" data-idx="${i}" role="option">
        <div class="drop-thumb-ph">✨</div>
        <div class="drop-info">
          <div class="drop-name">${esc(c.name)}</div>
          <div class="drop-meta">${esc(_tplSetName(c))}${c.rarity ? ' · ' + esc(c.rarity) : ''} <span style="font-size:.68rem;color:var(--gold-text)">TPL</span></div>
        </div>
        ${nmPrice !== null ? `<span class="drop-price">$${nmPrice.toFixed(2)}</span>` : `<span class="drop-no-price">No price</span>`}
      </div>`;
    }).join('');
    attachDropHandlers(i => {
      const entry = window._searchCards[i];
      return tplCardToNormalized(entry._tpl, 'mtg', '');
    });
    return;
  }

  // Fallback: Scryfall
  const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=usd&dir=desc`;
  const r = await fetch(url);
  if (!_searchReqStillCurrent(_reqSnap)) return; // 2026-08-25 [P1-2]
  if (!r.ok) {
    if (r.status === 404) { dropList.innerHTML = '<div class="drop-empty">No Magic cards found. Try a different name.</div>'; return; }
    throw new Error(`Scryfall ${r.status}`);
  }
  const data = await r.json();
  if (!_searchReqStillCurrent(_reqSnap)) return; // 2026-08-25 [P1-2]
  const cards = (data.data || []).slice(0, 20);

  if (!cards.length) { dropList.innerHTML = '<div class="drop-empty">No Magic cards found. Try a different name.</div>'; return; }

  window._searchCards = {};
  dropList.innerHTML = cards.map((c, i) => {
    window._searchCards[i] = { _raw: c, game: 'mtg' };
    const imgSrc = c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small || '';
    const usd = c.prices?.usd ? parseFloat(c.prices.usd) : null;
    const usdFoil = c.prices?.usd_foil ? parseFloat(c.prices.usd_foil) : null;
    const bestPrice = usd || usdFoil;
    const rarity = c.rarity ? c.rarity.charAt(0).toUpperCase() + c.rarity.slice(1) : '';
    return `<div class="drop-item" data-idx="${i}" role="option">
      ${imgSrc ? `<img class="drop-thumb" src="${imgSrc}" loading="lazy" decoding="async" alt="${esc(c.name)}"/>` : `<div class="drop-thumb-ph">🧙</div>`}
      <div class="drop-info">
        <div class="drop-name">${esc(c.name)}</div>
        <div class="drop-meta">${esc(c.set_name || '')} · ${esc(rarity)}</div>
      </div>
      ${bestPrice ? `<span class="drop-price">$${bestPrice.toFixed(2)}</span>` : `<span class="drop-no-price">No price</span>`}
    </div>`;
  }).join('');

  attachDropHandlers(i => {
    const c = window._searchCards[i]._raw;
    const imgNormal = c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || '';
    const imgSmall  = c.image_uris?.small  || c.card_faces?.[0]?.image_uris?.small  || '';
    const priceVariants = [];
    if (c.prices?.usd)        priceVariants.push({ key:'usd',        label:'Normal',     market: parseFloat(c.prices.usd),        low: null, mid: null, high: null });
    if (c.prices?.usd_foil)   priceVariants.push({ key:'usd_foil',   label:'Foil',        market: parseFloat(c.prices.usd_foil),   low: null, mid: null, high: null });
    if (c.prices?.usd_etched) priceVariants.push({ key:'usd_etched', label:'Etched Foil', market: parseFloat(c.prices.usd_etched), low: null, mid: null, high: null });
    if (!priceVariants.length) priceVariants.push({ key:'manual', label:'Manual', market: null, low: null, mid: null, high: null });
    const rarity = c.rarity ? c.rarity.charAt(0).toUpperCase() + c.rarity.slice(1) : '';
    return {
      name: c.name,
      game: 'mtg',
      images: { small: imgSmall, large: imgNormal },
      setName: c.set_name || '',
      number: c.collector_number || '',
      rarity,
      priceVariants,
      source: 'Scryfall',
      updatedAt: 'daily',
    };
  });
}

/* ── Disney Lorcana (lorcana-api.com — free, no key required) ── */
let _lorcanaCache = null; // session cache for the full card list
let _lorcanaCachePending = null; // deduplicate in-flight fetch

async function _getLorcanaCards() {
  if (_lorcanaCache) return _lorcanaCache;
  if (_lorcanaCachePending) return _lorcanaCachePending;
  _lorcanaCachePending = fetch('https://api.lorcana-api.com/cards/all')
    .then(r => r.json())
    .then(data => {
      _lorcanaCache = Array.isArray(data) ? data : [];
      _lorcanaCachePending = null;
      return _lorcanaCache;
    })
    .catch(() => { _lorcanaCachePending = null; return []; });
  return _lorcanaCachePending;
}

async function searchLorcana(q) {
  const _reqSnap = _snapSearchReq(); // 2026-08-22 [F4]
  // Try TPL first if key available
  const tplData = await searchWithTPL(q, 'lorcana');
  if (!_searchReqStillCurrent(_reqSnap)) return;
  if (tplData && tplData.length) {
    window._searchCards = {};
    dropList.innerHTML = tplData.map((c, i) => {
      window._searchCards[i] = { _tpl: c, game: 'lorcana' };
      const nmPrice = c.prices?.raw?.near_mint?.tcgplayer?.market ?? null;
      return `<div class="drop-item" data-idx="${i}" role="option">
        ${c.image_url ? `<img class="drop-thumb" src="${c.image_url}" loading="lazy" decoding="async" alt="${esc(c.name)}"/>` : `<div class="drop-thumb-ph">🌟</div>`}
        <div class="drop-info">
          <div class="drop-name">${esc(c.name)}</div>
          <div class="drop-meta">${esc(_tplSetName(c))}${c.rarity?' · '+esc(c.rarity):''} <span style="font-size:.68rem;color:var(--gold-text)">TPL</span></div>
        </div>
        ${nmPrice!==null?`<span class="drop-price">$${nmPrice.toFixed(2)}</span>`:`<span class="drop-no-price">No price</span>`}
      </div>`;
    }).join('');
    attachDropHandlers(i => tplCardToNormalized(window._searchCards[i]._tpl, 'lorcana', ''));
    return;
  }

  // Fallback: lorcana-api.com (free, no key)
  dropList.innerHTML = '<div class="drop-loading"><span class="spinner" style="border-color:rgba(0,0,0,.2);border-top-color:var(--gold)"></span> Searching Lorcana…</div>';
  dropList.classList.add('open');

  const allCards = await _getLorcanaCards();
  if (!_searchReqStillCurrent(_reqSnap)) return; // 2026-08-25 [P1-2]
  if (!allCards.length) {
    dropList.innerHTML = '<div class="drop-empty">Lorcana card database unavailable. Try again later.</div>';
    return;
  }

  const ql = q.toLowerCase().trim();
  const nameScore = n => {
    const nl = n.toLowerCase();
    if (nl === ql) return 0;
    if (nl.startsWith(ql)) return 1;
    if (nl.split(/[\s-]+/).some(w => w.startsWith(ql))) return 2;
    if (nl.includes(ql)) return 3;
    return 99;
  };
  const filtered = allCards
    .filter(c => (c.Name||'').toLowerCase().includes(ql))
    .sort((a, b) => nameScore(a.Name||'') - nameScore(b.Name||''))
    .slice(0, 30);

  if (!filtered.length) {
    dropList.innerHTML = '<div class="drop-empty">No Lorcana cards found. Try a different name.</div>';
    return;
  }

  window._searchCards = {};
  dropList.innerHTML = filtered.map((c, i) => {
    window._searchCards[i] = { _raw: c, game: 'lorcana' };
    const img = c.Image || '';
    return `<div class="drop-item" data-idx="${i}" role="option">
      ${img ? `<img class="drop-thumb" src="${img}" loading="lazy" decoding="async" alt="${esc(c.Name||'')}"/>` : `<div class="drop-thumb-ph">🌟</div>`}
      <div class="drop-info">
        <div class="drop-name">${esc(c.Name||'')}</div>
        <div class="drop-meta">${esc(c.Set_Name||'')}${c.Rarity?' · '+esc(c.Rarity):''}</div>
      </div>
      <span class="drop-no-price">Set price</span>
    </div>`;
  }).join('');

  attachDropHandlers(i => {
    const c = window._searchCards[i]._raw;
    return {
      name:    c.Name || '',
      game:    'lorcana',
      images:  { small: c.Image || '', large: c.Image || '' },
      setName: c.Set_Name || '',
      number:  c.Card_Num ? String(c.Card_Num) : '',
      rarity:  c.Rarity || '',
      priceVariants: [{ key: 'manual', label: 'Manual', market: null, low: null, mid: null, high: null }],
      source:  'Lorcana-API',
      updatedAt: 'daily',
    };
  });
}

/* ── One Piece TCG (no free public API — manual entry) ── */
async function searchOnePiece(q) {
  const _reqSnap = _snapSearchReq(); // 2026-08-22 [F4]
  // Try TPL if key available
  const tplData = await searchWithTPL(q, 'onepiece');
  if (!_searchReqStillCurrent(_reqSnap)) return;
  if (tplData && tplData.length) {
    window._searchCards = {};
    dropList.innerHTML = tplData.map((c, i) => {
      window._searchCards[i] = { _tpl: c, game: 'onepiece' };
      const nmPrice = c.prices?.raw?.near_mint?.tcgplayer?.market ?? null;
      return `<div class="drop-item" data-idx="${i}" role="option">
        ${c.image_url ? `<img class="drop-thumb" src="${c.image_url}" loading="lazy" decoding="async" alt="${esc(c.name)}"/>` : `<div class="drop-thumb-ph">⚓</div>`}
        <div class="drop-info">
          <div class="drop-name">${esc(c.name)}</div>
          <div class="drop-meta">${esc(_tplSetName(c))}${c.rarity?' · '+esc(c.rarity):''} <span style="font-size:.68rem;color:var(--gold-text)">TPL</span></div>
        </div>
        ${nmPrice!==null?`<span class="drop-price">$${nmPrice.toFixed(2)}</span>`:`<span class="drop-no-price">No price</span>`}
      </div>`;
    }).join('');
    attachDropHandlers(i => tplCardToNormalized(window._searchCards[i]._tpl, 'onepiece', ''));
    return;
  }
  // No free API available — guide user to manual entry
  if (!_searchReqStillCurrent(_reqSnap)) return; // 2026-08-25 [P1-2]
  dropList.innerHTML = `<div style="padding:.9rem 1rem">
    <div style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:.35rem">⚓ One Piece TCG</div>
    <div style="font-size:.75rem;color:var(--text-muted);line-height:1.6;margin-bottom:.6rem">No free card database is available yet. Enter your card name above, then use the <strong>Override price</strong> field to set the market value manually.</div>
    <div style="font-size:.7rem;color:var(--text-faint)">Full database coming soon 🏴‍☠️</div>
  </div>`;
  dropList.classList.add('open');
}

/* ── Generic TPL game search (Lorcana, One Piece, etc.) ── */
async function searchTPLGame(q, gameSlug, emoji, emptyMsg) {
  const dropList = document.getElementById('dropList');
  if (!dropList) return;

  if (!window.tplApiKey) {
    dropList.innerHTML = `<div class="drop-empty">A TCG Price Lookup API key is required for ${gameSlug}. Add yours in Settings.</div>`;
    return;
  }

  const data = await searchWithTPL(q, gameSlug);
  if (!data || !data.length) {
    dropList.innerHTML = `<div class="drop-empty">${emptyMsg} Try a different name.</div>`;
    return;
  }

  window._searchCards = {};
  dropList.innerHTML = data.map((c, i) => {
    window._searchCards[i] = { _tpl: c, game: gameSlug };
    const nmPrice = c.prices?.raw?.near_mint?.tcgplayer?.market ?? null;
    return `<div class="drop-item" data-idx="${i}" role="option">
      ${c.image_url ? `<img class="drop-thumb" src="${c.image_url}" loading="lazy" decoding="async" alt="${esc(c.name)}"/>` : `<div class="drop-thumb-ph">${emoji}</div>`}
      <div class="drop-info">
        <div class="drop-name">${esc(c.name)}</div>
        <div class="drop-meta">${esc(_tplSetName(c))}${c.rarity ? ' · ' + esc(c.rarity) : ''} <span style="font-size:.68rem;color:var(--gold-text)">TPL</span></div>
      </div>
      ${nmPrice !== null ? `<span class="drop-price">$${nmPrice.toFixed(2)}</span>` : `<span class="drop-no-price">No price</span>`}
    </div>`;
  }).join('');

  attachDropHandlers(i => {
    const entry = window._searchCards[i];
    return tplCardToNormalized(entry._tpl, gameSlug, '');
  });
}

/* ── Yu-Gi-Oh! (YGOProDeck) ── */
async function searchYugioh(q) {
  const _reqSnap = _snapSearchReq(); // 2026-08-22 [F4]
  // Try TCGPriceLookup first if key is set
  const tplData = await searchWithTPL(q, 'yugioh');
  if (!_searchReqStillCurrent(_reqSnap)) return;
  if (tplData) {
    window._searchCards = {};
    dropList.innerHTML = tplData.map((c, i) => {
      window._searchCards[i] = { _tpl: c, game: 'yugioh' };
      const nmPrice = c.prices?.raw?.near_mint?.tcgplayer?.market ?? null;
      return `<div class="drop-item" data-idx="${i}" role="option">
        <div class="drop-thumb-ph">🐉</div>
        <div class="drop-info">
          <div class="drop-name">${esc(c.name)}</div>
          <div class="drop-meta">${esc(_tplSetName(c))}${c.rarity ? ' · ' + esc(c.rarity) : ''} <span style="font-size:.68rem;color:var(--gold-text)">TPL</span></div>
        </div>
        ${nmPrice !== null ? `<span class="drop-price">$${nmPrice.toFixed(2)}</span>` : `<span class="drop-no-price">No price</span>`}
      </div>`;
    }).join('');
    attachDropHandlers(i => {
      const entry = window._searchCards[i];
      // 2026-08-19: TPL frequently returns empty image_url for YGO cards.
      // If we just came from an ID scan, we already grounded the exact
      // image via YGOProDeck server-side and stashed it on
      // window._scanTargetImageUrl. Pass it as the fallback image so the
      // detail panel doesn't collapse to "Image unavailable" after the
      // auto-select click overwrites the pre-loaded grounded card.
      const fallbackImg = window._scanTargetImageUrl || '';
      return tplCardToNormalized(entry._tpl, 'yugioh', fallbackImg);
    });
    return;
  }

  // Fallback: YGOProDeck
  const url = `https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(q)}&num=20&offset=0`;
  const r = await fetch(url);
  if (!_searchReqStillCurrent(_reqSnap)) return; // 2026-08-25 [P1-2]
  if (!r.ok) {
    dropList.innerHTML = '<div class="drop-empty">No Yu-Gi-Oh! cards found. Try a different name.</div>';
    return;
  }
  const data = await r.json();
  if (!_searchReqStillCurrent(_reqSnap)) return; // 2026-08-25 [P1-2]
  const cards = (data.data || []).slice(0, 20);

  if (!cards.length) { dropList.innerHTML = '<div class="drop-empty">No Yu-Gi-Oh! cards found. Try a different name.</div>'; return; }

  window._searchCards = {};
  dropList.innerHTML = cards.map((c, i) => {
    window._searchCards[i] = { _raw: c, game: 'yugioh' };
    const imgSrc = c.card_images?.[0]?.image_url_small || '';
    const tcgPrice = c.card_prices?.[0]?.tcgplayer_price ? parseFloat(c.card_prices[0].tcgplayer_price) : null;
    return `<div class="drop-item" data-idx="${i}" role="option">
      ${imgSrc ? `<img class="drop-thumb" src="${imgSrc}" loading="lazy" decoding="async" alt="${esc(c.name)}"/>` : `<div class="drop-thumb-ph">🐉</div>`}
      <div class="drop-info">
        <div class="drop-name">${esc(c.name)}</div>
        <div class="drop-meta">${esc(c.card_sets?.[0]?.set_name || c.type || '')}${c.card_sets?.[0]?.set_rarity ? ' · ' + esc(c.card_sets[0].set_rarity) : (c.race ? ' · ' + esc(c.race) : '')}</div>
      </div>
      ${tcgPrice ? `<span class="drop-price">$${tcgPrice.toFixed(2)}</span>` : `<span class="drop-no-price">No price</span>`}
    </div>`;
  }).join('');

  attachDropHandlers(i => {
    const c = window._searchCards[i]._raw;
    const imgLarge = c.card_images?.[0]?.image_url || '';
    const imgSmall = c.card_images?.[0]?.image_url_small || '';
    const priceVariants = [];
    const tcgP  = c.card_prices?.[0]?.tcgplayer_price  ? parseFloat(c.card_prices[0].tcgplayer_price)  : null;
    const ebayP = c.card_prices?.[0]?.ebay_price        ? parseFloat(c.card_prices[0].ebay_price)        : null;
    const cmP   = c.card_prices?.[0]?.cardmarket_price  ? parseFloat(c.card_prices[0].cardmarket_price)  : null;
    if (tcgP  !== null) priceVariants.push({ key:'tcgplayer',    label:'TCGPlayer',    market: tcgP,  low: null, mid: null, high: null });
    if (ebayP !== null) priceVariants.push({ key:'ebay',         label:'eBay',          market: ebayP, low: null, mid: null, high: null });
    if (cmP   !== null) priceVariants.push({ key:'cardmarket',   label:'Cardmarket',   market: cmP,   low: null, mid: null, high: null });
    if (!priceVariants.length) priceVariants.push({ key:'manual', label:'Manual', market: null, low: null, mid: null, high: null });
    const ygoSet = c.card_sets?.[0];
    return {
      name: c.name,
      game: 'yugioh',
      images: { small: imgSmall, large: imgLarge },
      setName: ygoSet?.set_name || c.type || '',
      number:  ygoSet?.set_code || '',
      rarity:  ygoSet?.set_rarity || c.race || '',
      priceVariants,
      source: 'YGOProDeck',
      updatedAt: 'TCGPlayer data',
    };
  });
}

// ── Attach click handlers after rendering drop ──
function attachDropHandlers(cardFactory) {
  // Add "See all results" footer to jump to the portrait grid
  const existingFooter = dropList.querySelector('.drop-see-all');
  if (!existingFooter && dropList.querySelectorAll('.drop-item').length > 0 && activeGame === 'pokemon') {
    const footer = document.createElement('div');
    footer.className = 'drop-see-all';
    footer.setAttribute('role', 'button');
    footer.setAttribute('tabindex', '0');
    footer.innerHTML = `<span>See all results as cards</span><span style="font-size:.8rem">&#8594;</span>`;
    footer.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:.5rem;padding:.75rem 1rem;border-top:1px solid var(--border);font-size:.82rem;font-weight:700;color:var(--gold-text);cursor:pointer;';
    footer.addEventListener('click', () => {
      dropList.classList.remove('open');
      openCatalog(searchInput.value.trim());
    });
    footer.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        footer.click();
      }
    });
    dropList.appendChild(footer);
  }

  dropList.querySelectorAll('.drop-item').forEach(el => {
    el.setAttribute('tabindex', '0');
    el.addEventListener('click', () => {
      const card = cardFactory(parseInt(el.dataset.idx));
      selectedCard = card;
      dropList.classList.remove('open');
      searchInput.value = card.name;
      // 2026-09-01 (launch gate): do NOT prefill the override from this row.
      //
      // This used to read the price back out of the row's rendered DOM text and
      // write it into the override. Because the pipeline only fills the override
      // when it is empty, that prefill then BLOCKED the real price ladder, so the
      // click path and the reload/restore path anchored on different sources and
      // reported different payouts for the same card ($489.11 vs $272.56 on a
      // Base Set 2 Charizard, verified in a browser).
      //
      // The row price comes from the embedded per-variant feed (pokemontcg.io),
      // which is a STALER copy of the same metric /api/tcg-price serves from
      // tcgcsv ($489.11 vs $422.40 for that card on the same day). It is fine as
      // a browsing hint in the dropdown; it is not fit to anchor payout math.
      // fetchAndApplySoldComps' documented ladder is now the single source.
      loadCardUI(card);
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
    });
  });

  // ── Scanner auto-select: pick the result whose card number matches the scan ──
  if (window._scanTargetNumber) {
    // Normalize: "TG09/TG30" → "tg09", "TG09" → "tg09"
    const normNum = n => (n || '').toLowerCase().split('/')[0].replace(/^0+/,'').trim();
    const targetNum  = normNum(window._scanTargetNumber);
    const targetName = (window._scanTargetName || '').toLowerCase();
    const grader     = window._scanTargetGrader || '';
    const grade      = window._scanTargetGrade  || '';
    // Consume immediately so it only fires once
    window._scanTargetNumber = null;
    window._scanTargetName   = null;
    window._scanTargetGrader = null;
    window._scanTargetGrade  = null;

    // Find best matching drop item — exact number match wins
    let bestEl = null;
    let bestScore = -1;
    dropList.querySelectorAll('.drop-item').forEach(el => {
      const idx  = parseInt(el.dataset.idx);
      const card = cardFactory(idx);
      const num  = normNum(card.number);
      const name = (card.name || '').toLowerCase();
      let score = 0;
      if (num === targetNum) score += 10;
      else if (num.startsWith(targetNum) || targetNum.startsWith(num)) score += 4;
      if (name === targetName) score += 2;
      if (score > bestScore) { bestScore = score; bestEl = el; }
    });

    if (bestEl && bestScore > 0) {
      setTimeout(() => {
        bestEl.click();
        // Auto-switch grader pill + grade after card loads
        if (grader) {
          const graderMap = { 'PSA':'psa','BGS':'bgs','Beckett':'bgs','CGC':'cgc','ACE':'ace','SGC':'sgc','TAG':'tag' };
          const pillKey = graderMap[grader];
          setTimeout(() => {
            if (pillKey) {
              const pill = document.querySelector(`.grade-pill[data-grader="${pillKey}"]`);
              if (pill) pill.click();
            }
            // Auto-select the correct grade number
            if (grade) {
              setTimeout(() => {
                const gradeSelect = document.querySelector('#gradeSelect, [data-grade-select], select[name="grade"]');
                if (gradeSelect) {
                  // Try setting select value directly
                  gradeSelect.value = grade;
                  gradeSelect.dispatchEvent(new Event('change'));
                } else {
                  // Try clicking grade pill/button if it exists
                  const gradeBtn = document.querySelector(`[data-grade="${grade}"], .grade-option[value="${grade}"]`);
                  if (gradeBtn) gradeBtn.click();
                }
              }, 300);
            }
          }, 400);
        }
      }, 150);
    }
  }
}

// ── eBay comps link for sports ──
// ── eBay sold comps: auto-fetch + populate override ──
let _compsAbortCard = null; // track which card we're fetching for

// ── Trust bundle: TCG primary + eBay overlay ─────────────────────────
// Composes a two-row status readout:
//   Row 1 (always shows if TCG resolved): TCGplayer market · range · updated
//   Row 2 (only if eBay has ≥2 comps):    eBay sold count + median + confidence pill
// eBay currently 403s a lot from datacenter IPs; TCG is our source of truth.
// 2026-08-30: client-side belt-and-suspenders High-price clamp. Server
// clamps High to 3x Market before returning, but cached KV entries from
// before this shipped are still un-clamped for 4h. Also protects against
// any other source (eBay, PC) that might return an outlandish high.
function _clampHigh(row) {
  if (!row) return row;
  const anchor = row.market != null ? row.market : row.mid;
  if (anchor && row.high && row.high > anchor * 3) {
    return { ...row, high: Math.round(anchor * 3 * 100) / 100, highClamped: true };
  }
  return row;
}

// ── Freshness contract ──────────────────────────────────────────────────
// Every price this app shows names its source and says how old it is. Two
// distinct facts get conflated if you are not careful, so they are kept apart:
//
//   RETRIEVED  when WE fetched the number. We always know this.
//   AS OF      when the SOURCE determined the number. We rarely know this.
//
// TCGplayer market is computed from completed sales and moves continuously, so
// "retrieved 5 min ago" is a fair proxy for freshness. PriceCharting's API
// publishes a current blended guide value with NO timestamp and no sales
// history (verified against their API docs), so a PC number retrieved one
// minute ago may reflect sales from last week or last year and we cannot tell
// which. Labelling that "5 min ago" full stop would imply a currency we have
// not established, so PC rows say "retrieved" and carry an explicit note.
function _ageStr(cacheAgeSec) {
  const a = Number(cacheAgeSec) || 0;
  if (a < 60)   return 'just now';
  if (a < 3600) return `${Math.round(a / 60)} min ago`;
  if (a < 86400) return `${Math.round(a / 3600)} hr ago`;
  return `${Math.round(a / 86400)} d ago`;
}

// PriceCharting publishes no as-of date. Say so once, where the number is,
// rather than letting a retrieval timestamp pass for a price date.
const _PC_NO_ASOF_TIP = 'PriceCharting publishes a current blended guide value with no as-of date and no sales history, so we can date when we retrieved it but not when the price was set.';

// ── Cross-source disagreement (Sol audit rec #3, 2026-09-03) ────────────
// The audit measured a median 75.9% TCGplayer-vs-PriceCharting spread on
// vintage cards against 7.8% on modern ones, with identity confirmed on 30/30
// sampled cards -- so the spread is real disagreement about value, not the app
// pricing the wrong printing. Three things follow, and all three are honesty
// constraints rather than preferences:
//
//   1. Do NOT average them. The mean of two numbers that disagree by 4x is a
//      third number that no source will stand behind, and it reads as more
//      certain than either input.
//   2. Do NOT relabel. The audit could not decompose condition, shipping,
//      currency, or finish from these feeds -- TCGCSV has no condition-level
//      SKUs and PC's raw figure is an ungraded/loose blend, not a wear grade.
//      So the app cannot honestly call its TCGCSV basis "Near Mint."
//   3. DO show both, named. A seller looking at a $500 card where one source
//      says $500 and the other says $2,000 needs to know that before they
//      list, and which number the payout used.
//
// Thresholds. Modern noise sits near 7.8%, vintage disagreement near 75.9%, so
// a gate at +/-50% (ratio outside [1/1.5, 1.5]) clears routine feed jitter and
// still surfaces the vintage cases the audit was about. The dollar floor keeps
// penny commons -- where a 3x ratio is two cents against six -- from firing a
// scary-looking disclosure over nothing actionable.
const _DISAGREE_RATIO = 1.5;
const _DISAGREE_MIN_USD = 20;

function _sourceDisagreement({ tcg, pc }) {
  const t = tcg && Number(tcg.market) > 0 ? Number(tcg.market) : null;
  const p = (pc && pc.source === 'pricecharting' && Number(pc.median) > 0)
    ? Number(pc.median) : null;
  if (t == null || p == null) return null;
  if (Math.max(t, p) < _DISAGREE_MIN_USD) return null;
  const ratio = t / p;
  if (ratio <= _DISAGREE_RATIO && ratio >= 1 / _DISAGREE_RATIO) return null;
  const spreadPct = Math.round(Math.abs(t - p) / Math.min(t, p) * 100);
  return {
    tcg: t, pc: p, ratio: Math.round(ratio * 100) / 100, spreadPct,
    higher: t > p ? 'tcg' : 'pc',
    tcgUrl: _tcgpCondUrl(tcg.url) || null,
    pcUrl: pc.url || null,
  };
}

function _renderSourceDisagreement(d, basisLabel) {
  if (!d) return '';
  const hi = d.higher === 'tcg' ? 'TCGplayer' : 'PriceCharting';
  const tcgLink = d.tcgUrl
    ? `<a href="${d.tcgUrl}" target="_blank" rel="noopener" style="color:var(--gold-text);text-decoration:none">TCGplayer ↗</a>`
    : 'TCGplayer';
  const pcLink = d.pcUrl
    ? `<a href="${d.pcUrl}" target="_blank" rel="noopener" style="color:var(--gold-text);text-decoration:none">PriceCharting ↗</a>`
    : 'PriceCharting';
  // Name the basis so the seller knows which of the two numbers the payout
  // rows below were computed from. Silence here is what makes a disclosure
  // feel like a warning with no action attached.
  const usedNote = basisLabel
    ? `<div style="opacity:.75;font-size:.68rem;width:100%;margin-top:.2rem">Payout below uses <strong style="color:var(--text)">${basisLabel}</strong>. Check both before you list.</div>`
    : '';
  return (
    `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:.35rem .5rem;margin-top:.35rem;font-size:.78rem;line-height:1.45;` +
      `background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.4);border-radius:8px;padding:.4rem .55rem">` +
      `<span class="trust-pill" style="background:rgba(245,158,11,.18);border:1px solid rgba(245,158,11,.6);color:#fbbf24;font-weight:800;font-size:.66rem;padding:.1rem .45rem;border-radius:99px;letter-spacing:.02em">Sources disagree</span>` +
      `<span style="opacity:.9">${hi} is <strong style="color:var(--text)">${d.spreadPct}%</strong> higher</span>` +
      `<span style="width:100%;margin-top:.15rem">` +
        `${tcgLink} <strong style="color:var(--text)">$${d.tcg.toFixed(2)}</strong>` +
        `<span style="opacity:.5"> vs </span>` +
        `${pcLink} <strong style="color:var(--text)">$${d.pc.toFixed(2)}</strong>` +
      `</span>` +
      `<span style="opacity:.72;font-size:.68rem;width:100%">` +
        `Not averaged — these are two different measurements. TCGplayer market comes from completed sales on one marketplace; PriceCharting publishes a blended ungraded guide value across marketplaces. ` +
        `Neither is condition-graded, so neither is a Near Mint quote.` +
      `</span>` +
      usedNote +
    `</div>`
  );
}

// ── The one price caption ───────────────────────────────────────────────
// Every headline price gets its caption from here. Three separate formatters
// used to write this element and they made different claims about the same
// number -- one appended "Updated daily" to anything without an explicit date,
// including PriceCharting graded guide values whose refresh cadence we have
// never established. That is a fabricated freshness claim on the most
// expensive numbers in the app (a PSA 10 slab), so it is gone.
//
// What may be claimed, and on whose authority:
//   source name   we know which rung produced the number
//   link          we know the page it came from, so cite it
//   retrieved Xm  we know when WE fetched it
//   no price date shown when the source publishes no as-of date (PriceCharting)
//   Updated <d>   ONLY when the feed handed us a real date string
function _renderPriceCaption(el, { label, url, cacheAgeSec, datedBySource, updatedAt }) {
  if (!el) return;
  if (!label) { el.textContent = ''; return; }
  const bits = [];
  bits.push(url
    ? `<a href="${url}" target="_blank" rel="noopener" style="color:var(--gold-text);text-decoration:none">${label} \u2197</a>`
    : label);
  // A real date from the feed beats a retrieval age -- it is the stronger
  // claim and the one the user actually wants. Only one of the two renders.
  if (updatedAt && updatedAt !== 'Enter via override') {
    bits.push(`<span style="opacity:.65">Updated ${updatedAt}</span>`);
  } else if (cacheAgeSec != null) {
    bits.push(`<span style="opacity:.65">retrieved ${_ageStr(cacheAgeSec)}</span>`);
  }
  if (datedBySource === false) {
    bits.push(`<span class="trust-info" title="${_PC_NO_ASOF_TIP}" style="opacity:.65;cursor:help">no price date \u24d8</span>`);
  }
  el.innerHTML = bits.join('<span style="opacity:.35"> \u00b7 </span>');
}

function renderPriceStatus({ tcg, ebay, pc, fallbackEbayUrl }) {
  tcg = _clampHigh(tcg);
  const parts = [];

  if (tcg && tcg.market != null && tcg.market > 0) {
    const src = tcg.source === 'tcgplayer-live' ? 'TCGplayer Live' : 'TCGplayer';
    const ageStr = _ageStr(tcg.cacheAgeSec);
    const rangeStr = (tcg.low != null && tcg.high != null && tcg.low !== tcg.high)
      ? ` · range <strong style="color:var(--text)">$${Number(tcg.low).toFixed(2)}–$${Number(tcg.high).toFixed(2)}</strong>`
      : '';
    const _tu = _tcgpCondUrl(tcg.url);
    const tcgUrl = _tu ? `<a href="${_tu}" target="_blank" rel="noopener" style="color:var(--gold-text);text-decoration:none">${src} ↗</a>` : src;
    parts.push(
      `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:.35rem .55rem;line-height:1.4">` +
        `<span class="trust-pill" style="background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.55);color:#4ade80;font-weight:800;font-size:.68rem;padding:.1rem .45rem;border-radius:99px;letter-spacing:.02em">Market price</span>` +
        `<strong style="color:var(--gold-text)">$${Number(tcg.market).toFixed(2)}</strong>` +
        ` · ${tcgUrl}` +
        rangeStr +
        ` <span style="opacity:.6;font-size:.68rem">· retrieved ${ageStr}</span>` +
      `</div>`
    );
  }

  // Row 2: PriceCharting guide value — the reliable graded-price source.
  // Renders only when PC returned a real price for the requested grade.
  // 2026-08-19: eBay is 100% 403'd from Vercel IPs; PC is the primary source.
  if (pc && pc.median != null && pc.source === 'pricecharting') {
    const conf = pc.confidence || 'medium';
    const pillMap = {
      high:   { bg: 'rgba(34,197,94,.15)',  border: 'rgba(34,197,94,.55)',  color: '#4ade80', label: 'High' },
      medium: { bg: 'rgba(245,158,11,.15)', border: 'rgba(245,158,11,.55)', color: '#fbbf24', label: 'Medium' },
      low:    { bg: 'rgba(239,68,68,.15)',  border: 'rgba(239,68,68,.55)',  color: '#f87171', label: 'Low' },
    };
    const pill = pillMap[conf] || pillMap.medium;
    const pcUrl = pc.url
      ? `<a href="${pc.url}" target="_blank" rel="noopener" style="color:var(--gold-text);text-decoration:none">PriceCharting ↗</a>`
      : 'PriceCharting';
    const matched = pc.productName
      ? ` <span style="opacity:.6;font-size:.68rem">· ${pc.productName}</span>`
      : '';
    // Freshness contract: PriceCharting is retrieved-dated, never as-of dated.
    // Their API returns a current blended guide value with no timestamp, so
    // "retrieved" is the only honest verb available for this row.
    const pcAge = ` <span style="opacity:.6;font-size:.68rem">· retrieved ${_ageStr(pc.cacheAgeSec)}</span>`;
    const pcNoAsOf = ` <span class="trust-info" title="${_PC_NO_ASOF_TIP}" style="opacity:.6;font-size:.68rem;cursor:help">no price date ⓘ</span>`;
    parts.push(
      `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:.35rem .5rem;margin-top:.3rem;font-size:.78rem;line-height:1.4">` +
        `<span class="trust-pill" style="background:${pill.bg};border:1px solid ${pill.border};color:${pill.color};font-weight:800;font-size:.68rem;padding:.1rem .45rem;border-radius:99px;letter-spacing:.02em">${pill.label}</span>` +
        `<span style="opacity:.85">Guide value</span>` +
        ` <strong style="color:var(--gold-text)">$${Number(pc.median).toFixed(2)}</strong>` +
        ` · ${pcUrl}` +
        matched +
        pcAge +
        pcNoAsOf +
      `</div>`
    );
  }

  // Row 2b: cross-source disagreement (Sol rec #3). Placed directly under the
  // two rows it names, so the seller reads TCG, then PC, then the fact that
  // they disagree -- rather than discovering it after the payout math.
  // Withdrawn 2026-09-04 at the owner's direction: the disclosure fired on
  // homepage cards and read as a defect in the app rather than a fact about
  // the feeds. Detection (_sourceDisagreement) is deliberately KEPT and still
  // exercised by tests -- only the render is withdrawn, so the signal can be
  // put back or routed somewhere quieter without rebuilding it.
  //
  // What this costs, recorded on purpose: when the two feeds disagree by more
  // than 50% the seller now sees only the basis we picked, with no hint that
  // the other source says something very different. The two numbers are still
  // both rendered above, and neither is averaged into the other.

  // Row 3: eBay sold comps overlay (only when we actually got comps)
  if (ebay && ebay.count >= 2 && ebay.median != null) {
    const conf = ebay.confidence || 'insufficient';
    const reasons = (ebay.confidenceReasons || []).join(' · ');
    const outliersRemoved = ebay.outliersRemoved || 0;
    const cacheAgeSec = ebay.cacheAgeSec || 0;
    const pillMap = {
      high:         { bg: 'rgba(34,197,94,.15)',  border: 'rgba(34,197,94,.55)',  color: '#4ade80', label: 'High' },
      medium:       { bg: 'rgba(245,158,11,.15)', border: 'rgba(245,158,11,.55)', color: '#fbbf24', label: 'Medium' },
      low:          { bg: 'rgba(239,68,68,.15)',  border: 'rgba(239,68,68,.55)',  color: '#f87171', label: 'Low' },
      insufficient: { bg: 'rgba(148,163,184,.15)',border: 'rgba(148,163,184,.55)',color: '#94a3b8', label: 'Sparse' },
    };
    const pill = pillMap[conf] || pillMap.insufficient;
    const ageStr = _ageStr(cacheAgeSec);
    const rangeStr = (ebay.low != null && ebay.high != null && ebay.low !== ebay.high)
      ? ` · range <strong style="color:var(--text)">$${Number(ebay.low).toFixed(2)}–$${Number(ebay.high).toFixed(2)}</strong>`
      : '';
    const outlierTip = outliersRemoved > 0
      ? ` <span class="trust-info" title="${outliersRemoved} outlier${outliersRemoved === 1 ? '' : 's'} filtered from ${ebay.rawCount || ebay.count} raw comps. Prices outside 1.5× IQR or 30%–300% of median were removed.">ⓘ</span>`
      : '';
    const ebayUrl = ebay.searchUrl
      ? `<a href="${ebay.searchUrl}" target="_blank" rel="noopener" style="color:var(--gold-text);text-decoration:none">eBay ↗</a>`
      : 'eBay';
    parts.push(
      `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:.35rem .5rem;margin-top:.3rem;font-size:.78rem;line-height:1.4">` +
        `<span class="trust-pill" style="background:${pill.bg};border:1px solid ${pill.border};color:${pill.color};font-weight:800;font-size:.68rem;padding:.1rem .45rem;border-radius:99px;letter-spacing:.02em">${pill.label}</span>` +
        `<strong style="color:var(--text)">${ebay.count} sold</strong>` +
        ` · median <strong style="color:var(--text)">$${Number(ebay.median).toFixed(2)}</strong>` +
        rangeStr +
        ` · ${ebayUrl}` +
        ` <span style="opacity:.55;font-size:.68rem">· retrieved ${ageStr}</span>` +
        outlierTip +
        (reasons ? `<span style="opacity:.6;font-size:.68rem;width:100%;margin-top:.15rem">${reasons}</span>` : '') +
      `</div>`
    );
  } else if (fallbackEbayUrl && !(pc && pc.median != null)) {
    // Discreet eBay link when neither eBay comps nor PC price are available.
    // If PC returned a price, we don't need the fallback — the user already
    // has a reliable number above.
    parts.push(
      `<div style="margin-top:.3rem;font-size:.72rem">` +
        `<a href="${fallbackEbayUrl}" target="_blank" rel="noopener" style="color:var(--text-muted);text-decoration:none;opacity:.75">View sold comps on eBay ↗</a>` +
      `</div>`
    );
  }

  return parts.join('');
}

// ── Grade opportunity trigger ───────────────────────────────────
// Silent by default. Only fires the pill when grading actually pencils out.
// Keeps users from burning AI grade scan credits on losing bets.
// 2026-08-18: Cross-TCG auto-switch after AI vision scan.
// The vision API returns card_type in {pokemon, mtg, yugioh, lorcana,
// onepiece, sports}. If the scanned card belongs to a different TCG than
// what's currently selected in the game picker, silently switch so
// pricing + image lookups actually work. Silent on sports/other because
// those live in different UI panels.
function _mapCardTypeToGame(cardType, isJapanese) {
  const t = (cardType || '').toLowerCase();
  if (t === 'pokemon') return isJapanese ? 'pokemonjp' : 'pokemon';
  if (t === 'mtg' || t === 'yugioh' || t === 'lorcana' || t === 'onepiece') return t;
  return null; // sports/unknown -> don't auto-switch
}
function _gameLabel(g) {
  return ({
    pokemon:   'Pok\u00e9mon EN',
    pokemonjp: 'Pok\u00e9mon JP',
    mtg:       'Magic: The Gathering',
    yugioh:    'Yu-Gi-Oh!',
    lorcana:   'Disney Lorcana',
    onepiece:  'One Piece',
  })[g] || g;
}
function maybeAutoSwitchGameFromScan(cardType, isJapanese) {
  const detected = _mapCardTypeToGame(cardType, isJapanese);
  if (!detected) return false;
  // activeGame is the module-scope variable set by onGameSelectChange.
  if (typeof activeGame === 'undefined' || activeGame === detected) return false;
  const prev = activeGame;

  // 2026-08-19: Do NOT silently swap the user's chosen game. Ximilar occasionally
  // mis-tags a card's TCG (e.g. tagged real YGO "Invoked Baybarron / CORE-EN031"
  // as Pokemon), and auto-switching under a user who explicitly picked YGO is
  // both confusing and wrong. Server-side reconciliation from card_number handles
  // the unambiguous cases (YGO/OnePiece formats); for the ambiguous rest we ASK.
  //
  // Exception: if the user was in Sports/Other (generic panels with no set list)
  // and we detected a real TCG, swap silently — there's no user intent to override.
  const isGenericPrev = prev === 'sports' || prev === 'other';
  const doSwitch = () => {
    if (typeof onGameSelectChange === 'function') {
      onGameSelectChange(detected);
    } else {
      activeGame = detected;
      const sel = document.getElementById('gameSelect');
      if (sel) sel.value = detected;
    }
    try { window.trackEvent && window.trackEvent('cross_tcg_auto_switch', { from: prev, to: detected, confirmed: !isGenericPrev }); } catch(e) {}
  };

  if (isGenericPrev) {
    doSwitch();
    try {
      if (typeof showToast === 'function') {
        showToast('Detected ' + _gameLabel(detected) + ' \u2014 switched from ' + _gameLabel(prev), 'gold');
      }
    } catch(e) {}
    return true;
  }

  // User explicitly chose a game. Confirm before switching.
  try {
    const msg = 'This looks like a ' + _gameLabel(detected) + ' card, but you\u2019re in ' + _gameLabel(prev) + ' mode. Switch to ' + _gameLabel(detected) + '?';
    // Use native confirm as a lightweight prompt — non-blocking modal would be nicer
    // but we don't have one wired up here. confirm() at least respects the user.
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const ok = window.confirm(msg);
      if (ok) {
        doSwitch();
        return true;
      } else {
        // Stay in user's chosen game. Show a hint so they know the scan may be
        // wrong.
        try {
          if (typeof showToast === 'function') {
            showToast('Kept ' + _gameLabel(prev) + '. Rescan or search by name if the ID looks off.', 'gold');
          }
        } catch(e) {}
        try { window.trackEvent && window.trackEvent('cross_tcg_auto_switch_declined', { from: prev, to: detected }); } catch(e) {}
        return false;
      }
    }
  } catch(e) {}
  // Fallback if confirm() unavailable: keep old silent-switch behavior
  doSwitch();
  try {
    if (typeof showToast === 'function') {
      showToast('Detected ' + _gameLabel(detected) + ' \u2014 switched from ' + _gameLabel(prev), 'gold');
    }
  } catch(e) {}
  return true;
}

// WITHDRAWN 2026-09-03 -- see the gradeOppP comment in the fetch path for the
// full reasoning. Kept as a no-op rather than deleted so that every existing
// call site stays valid while the feature is off the air. The guard is
// unconditional and first: nothing below it can render.
// ── Grade upside: WITHDRAWN, and the conditions to bring it back ────────
// Withdrawn because it showed a best-case number (raw price vs PSA 10 guide
// value) as if it were an expected outcome. P0-C was to re-weight it by gem
// rate so it became an EV rather than a best case. Research on 2026-09-03
// concluded that no honest version of that number is available today, and
// that even with paid data an EV would be the wrong shape. Full findings:
// audit/GEM_RATE_RESEARCH_2026-09-03.md
//
// Why not just multiply by a gem rate:
//   Within the SINGLE 1999 Pokemon Game set, PSA 10 rates run 0.6% for
//   Charizard-Holo (679 of 107,255) up to 14.7% -- a 24x intra-set spread.
//   The set-level rate is 11%; the published PSA Pokemon-wide rate is ~50%,
//   inflated by 2020s cards that are ~77% of submissions. Applying an era or
//   set baseline to a vintage Charizard overstates its gem probability by
//   roughly 18x. An era rate is legitimate ONLY as labelled set-level
//   context, never as the multiplier inside a dollar figure.
//   https://www.gemrate.com/item-details-advanced?grader=psa&year=1999&category=tcg-cards&set_name=Pokemon+Game
//
// Why not an EV even once pop data is licensed:
//   1. Population counts past SUBMISSIONS, so they are survivorship-biased
//      toward cards people already believed would grade well. GemRate shows
//      1999 Charizard-Holo at 0.6% all-time against 0.1% over the trailing
//      30 days -- the historical rate is not a stable forward probability.
//   2. Per-grade price samples are thin. A representative PSA 10 series
//      carries count 84 with confidence reported as "low".
//   3. An EV collapses a 0.3%-probability $12k branch and a 17.6%-probability
//      $670 branch into a single number that is true of no actual outcome.
//      Show the branches; let the seller weigh them.
//
// Re-enable ONLY when BOTH exist, and then as a per-grade table (grade /
// population / share / dated price) with NO single headline figure:
//   (a) a real per-card grade distribution we are licensed to display.
//       PSA's /pop/GetPSASpecPopulation returns Grade1..Grade10 but is keyed
//       on specID with no card search, capped at 100 calls/day, and its end
//       user agreement is login-gated so display rights are unconfirmed.
//       GemRate documents /v1/cards/{id}/population with gem_rate and real
//       card search, but keys are sales-gated. CGC, BGS and SGC publish no
//       first-party API at all.
//   (b) a per-grade price carrying a real sale DATE. PriceCharting explicitly
//       does not support historic sales, and its graded guide values are
//       undated -- which is why they render a "no price date" marker. eBay
//       Marketplace Insights exposes lastSoldDate over 90 days but is Limited
//       Release with no approval guarantee.
//
// Until then this renders nothing. An empty section is honest; a confident
// wrong dollar figure on a slab decision is not. The previous implementation
// is preserved verbatim in the withdrawn helper directly below, so the markup
// is not lost -- it is intentionally never called. (Not named here: a
// regression asserts that identifier appears exactly once in this file, so
// only its definition may mention it.)
function renderGradeOpportunity(g) {
  return '';
}

function _renderGradeOpportunity_withdrawn(g) {
  if (!g || g.recommendation === 'sell_raw') return '';

  const isGreen = g.recommendation === 'worth_grading';
  const tooltip = (g.reasoning || []).join(' — ').replace(/"/g, '&quot;');

  // 2026-08-18: Signed-in users see the compact pill (they know what it means
  // and don't need the CTA). Cold ad traffic (signed-out) sees the loud
  // callout with sign-in CTA — the one moment that converts a first-time
  // visitor is realizing their card is worth grading.
  const isSignedIn = !!(window.googleUser || window._googleIdToken);

  // ---- Compact pill (signed-in daily users) ----
  if (isSignedIn) {
    const bg  = isGreen ? 'rgba(34,197,94,.12)'  : 'rgba(245,158,11,.12)';
    const bd  = isGreen ? 'rgba(34,197,94,.5)'   : 'rgba(245,158,11,.5)';
    const clr = isGreen ? '#4ade80'              : '#fbbf24';
    const icon = isGreen ? '⚡' : '📋';
    const label = isGreen
      ? `Worth grading · <strong>${g.targetGrade} est. $${Number(g.gradedEst).toFixed(0)}</strong> · <span style="color:${clr}">+$${Number(g.expectedProfit).toFixed(0)} profit (+${g.edgePct}%)</span>`
      : `Borderline · <strong>${g.targetGrade} est. $${Number(g.gradedEst).toFixed(0)}</strong> · <span style="color:${clr}">+$${Number(g.expectedProfit).toFixed(0)}</span>`;
    return (
      `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:.35rem .5rem;margin-top:.4rem;padding:.4rem .55rem;background:${bg};border:1px solid ${bd};border-radius:8px;font-size:.78rem;line-height:1.4" title="${tooltip}">` +
        `<span style="font-size:.95rem">${icon}</span>` +
        `<span style="color:var(--text)">${label}</span>` +
        ` <span style="opacity:.55;font-size:.68rem">· assumes ${g.targetGrade}, not guaranteed</span>` +
      `</div>`
    );
  }

  // ---- Loud callout (signed-out / cold ad traffic) ----
  const gradedEst    = Number(g.gradedEst).toFixed(0);
  const profit       = Number(g.expectedProfit).toFixed(0);
  const rawPrice     = Number(g.rawPrice || 0).toFixed(0);
  const gradingCost  = Number(g.gradingCost || 0).toFixed(0);
  const badgeText    = isGreen ? 'GRADE OPP' : 'MAYBE';
  const badgeBg      = isGreen ? '#22c55e' : '#f59e0b';
  const badgeColor   = isGreen ? '#00110a' : '#1a0f00';
  const accentColor  = isGreen ? '#4ade80' : '#fbbf24';
  const headerText   = isGreen ? 'Worth grading' : 'Borderline grade';
  const gradientBg   = isGreen
    ? 'linear-gradient(135deg, rgba(34,197,94,.16), rgba(34,197,94,.06))'
    : 'linear-gradient(135deg, rgba(245,158,11,.16), rgba(245,158,11,.06))';
  const borderClr    = isGreen ? 'rgba(34,197,94,.45)' : 'rgba(245,158,11,.45)';
  const headline     = isGreen
    ? `This card could be worth $${gradedEst} graded`
    : `Grading this card might pay off`;
  const subExplain   = isGreen
    ? `Raw $${rawPrice} → ${g.targetGrade} comp $${gradedEst}. Strong grade candidate at this raw price.`
    : `Raw $${rawPrice} → ${g.targetGrade} comp $${gradedEst}. Numbers are on the edge — grade only if condition is excellent.`;

  return (
    `<div style="margin-top:.6rem;padding:.85rem;background:${gradientBg};border:1.5px solid ${borderClr};border-radius:12px;position:relative;overflow:hidden" title="${tooltip}">` +
      `<div style="display:flex;align-items:center;gap:.4rem;font-size:.68rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${accentColor}">` +
        `<span style="padding:.1rem .35rem;background:${badgeBg};color:${badgeColor};border-radius:5px;font-size:.6rem;font-weight:900;letter-spacing:.06em">${badgeText}</span>` +
        `<span>${headerText}</span>` +
      `</div>` +
      `<div style="font-size:1.05rem;font-weight:800;line-height:1.25;margin-top:.35rem;color:var(--text)">${headline}</div>` +
      `<div style="display:flex;align-items:baseline;flex-wrap:wrap;gap:.4rem;margin-top:.35rem">` +
        `<span style="font-size:1.25rem;font-weight:800;color:${accentColor};line-height:1">+$${profit}</span>` +
        `<span style="font-size:.72rem;color:var(--text-muted);line-height:1.3">est. profit after $${gradingCost} grading + eBay fees (${g.edgePct}% edge)</span>` +
      `</div>` +
      `<div style="font-size:.72rem;color:var(--text-muted);margin-top:.5rem;line-height:1.45">${subExplain}</div>` +
      `<div style="font-size:.62rem;color:var(--text-muted);opacity:.7;margin-top:.2rem">Estimate assumes a ${g.targetGrade}; actual grade not guaranteed.</div>` +
      `<button onclick="event.stopPropagation();typeof handleGradeCalloutCta==='function'&&handleGradeCalloutCta();" style="display:flex;align-items:center;justify-content:center;gap:.4rem;width:100%;margin-top:.7rem;padding:.65rem .9rem;background:${badgeBg};color:${badgeColor};border:none;border-radius:9px;font-weight:800;font-size:.85rem;cursor:pointer;font-family:inherit">Grade this card — Sign in for 1 free scan →</button>` +
      `<div style="text-align:center;font-size:.6rem;color:var(--text-muted);opacity:.7;margin-top:.35rem">No card required · Never expires</div>` +
    `</div>`
  );
}

// Called by the signed-out grade opportunity callout CTA.
// Triggers the existing Google sign-in prompt if the Google widget is
// available; otherwise falls back to opening the pricing modal.
function handleGradeCalloutCta() {
  try { window.trackEvent && window.trackEvent('grade_callout_cta_click'); } catch(e) {}
  const gbtn = document.getElementById('googleSignInBtn');
  if (gbtn && typeof gbtn.click === 'function') {
    gbtn.click();
    return;
  }
  if (typeof openPricingModal === 'function') openPricingModal('grade_callout_cta');
}

// Legacy renderer (kept for any callers still using it)
function renderTrustLine(data) {
  const med = data.median;
  const cnt = data.count;
  const raw = data.rawCount || cnt;
  const low = data.low, high = data.high;
  const conf = data.confidence || 'insufficient';
  const reasons = (data.confidenceReasons || []).join(' · ');
  const outliersRemoved = data.outliersRemoved || 0;
  const cacheAgeSec = data.cacheAgeSec || 0;

  // Confidence pill colors
  const pillMap = {
    high:         { bg: 'rgba(34,197,94,.15)',  border: 'rgba(34,197,94,.55)',  color: '#4ade80', label: 'High confidence' },
    medium:       { bg: 'rgba(245,158,11,.15)', border: 'rgba(245,158,11,.55)', color: '#fbbf24', label: 'Medium confidence' },
    low:          { bg: 'rgba(239,68,68,.15)',  border: 'rgba(239,68,68,.55)',  color: '#f87171', label: 'Low confidence' },
    insufficient: { bg: 'rgba(148,163,184,.15)',border: 'rgba(148,163,184,.55)',color: '#94a3b8', label: 'Insufficient data' },
  };
  const pill = pillMap[conf] || pillMap.insufficient;

  const ageStr = cacheAgeSec < 60
    ? 'just now'
    : cacheAgeSec < 3600
      ? `${Math.round(cacheAgeSec / 60)} min ago`
      : `${Math.round(cacheAgeSec / 3600)} hr ago`;

  const rangeStr = (low != null && high != null && low !== high)
    ? ` · range <strong style="color:var(--text)">$${low.toFixed(2)}–$${high.toFixed(2)}</strong>`
    : '';

  const outlierTip = outliersRemoved > 0
    ? ` <span class="trust-info" title="${outliersRemoved} outlier${outliersRemoved === 1 ? '' : 's'} filtered from ${raw} raw comps. Prices outside 1.5× IQR or hard 30%–300% guardrails were removed.">ⓘ</span>`
    : '';

  return (
    `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .55rem;line-height:1.4">` +
      `<span style="color:var(--text)">eBay sold</span>` +
      ` · <strong style="color:var(--gold-text)">${cnt} comp${cnt === 1 ? '' : 's'}</strong>` +
      ` · median <strong style="color:var(--text)">$${med.toFixed(2)}</strong>` +
      rangeStr +
    `</div>` +
    `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:.35rem .5rem;margin-top:.25rem;font-size:.72rem;color:var(--text-muted)">` +
      `<span class="trust-pill" style="background:${pill.bg};border:1px solid ${pill.border};color:${pill.color};font-weight:800;font-size:.68rem;padding:.1rem .45rem;border-radius:99px;letter-spacing:.02em">${pill.label}</span>` +
      `<span>Updated ${ageStr}</span>` +
      (reasons ? `<span style="opacity:.75">· ${reasons}</span>` : '') +
      outlierTip +
    `</div>`
  );
}

async function fetchAndApplySoldComps(forceRefresh) {
  if (!selectedCard) return;

  const card    = selectedCard;
  const cardKey = (card.name || '') + '|' + (card.setName || '') + '|' + (card.number || '') + '|' + (card.game || '');

  // Skip sports (they use manual override) and JP (different market)
  if (card.game === 'sports' || card.game === 'pokemonjp') return;

  // Don't re-fetch same card unless forced
  if (!forceRefresh && _compsAbortCard === cardKey) return;
  _compsAbortCard = cardKey;

  const statusEl = document.getElementById('ebayCompsStatus');
  const statusTxt = document.getElementById('ebayCompsStatusText');
  if (!statusEl || !statusTxt) return;

  // Show loading state — use flex display
  statusEl.style.display = 'flex';
  statusTxt.textContent = '⏳ Fetching eBay sold comps…';

  // Build search query: card name + set name + card number for precision
  // e.g. "Lacey Stellar Crown 172" instead of just "Lacey Stellar Crown"
  const cardNum = card.number ? card.number.replace(/^0+/, '') : ''; // strip leading zeros
  // For YGO: append "yugioh" for eBay precision; for MTG: append "mtg"
  const gameTag = card.game === 'yugioh' ? 'yugioh' : (card.game === 'mtg' ? 'mtg' : '');
  const q = [card.name, card.setName, cardNum, gameTag].filter(Boolean).join(' ');

  // Check if a graded pill is selected
  const selGradePill = document.querySelector('#gradedPills .pill.sel');
  const gradeVal = selGradePill?.dataset?.val;
  const grade = (gradeVal && gradeVal !== 'no') ? gradeVal : '';

  // Build fallback eBay URL regardless of what the API returns
  const _num = card.number ? card.number.replace(/^0+/, '') : '';
  const _fbQ = encodeURIComponent([card.name, card.setName, _num, grade].filter(Boolean).join(' '));
  const _sacat = (card.game === 'yugioh' || card.game === 'mtg') ? '183454' : '2536';
  const fallbackEbayUrl = buildEbayUrl(`https://www.ebay.com/sch/i.html?_nkw=${_fbQ}&_sacat=${_sacat}&LH_Sold=1&LH_Complete=1&_sop=12`);

  // Fire TCG + eBay in parallel. TCG is source of truth, eBay is bonus.
  //
  // 2026-08-19: FIX — was previously missing &game=, so every single-card
  // scan comps fetch was hitting the Pokemon catalog regardless of what the
  // user actually scanned. Magic and Lorcana pricing were coming back empty
  // because their card names don't exist in the Pokemon TCG database.
  // card.game is populated by the scanner (see typeToGame at line 8649)
  // and takes values: pokemon, pokemonjp, mtg, yugioh, lorcana, onepiece.
  const tcgParams = new URLSearchParams({ name: card.name });
  if (card.setName) tcgParams.set('set', card.setName);
  if (card.number)  tcgParams.set('number', card.number);
  if (card.rarity)  tcgParams.set('rarity', card.rarity);
  if (card.game)    tcgParams.set('game', card.game);

  const ebayParams = new URLSearchParams({ q, limit: '15' });
  if (grade) ebayParams.set('grade', grade);

  // 2026-08-19: PriceCharting fetch — reliable graded/raw guide value.
  // Runs in parallel with TCG + eBay. PC replaces the fallback "View sold
  // comps on eBay ↗" link the moment it returns a real number, and its
  // price is what feeds the priceOverride when the user hasn't typed one.
  // Query construction: name + set + number gives PC the best fuzzy-match
  // signal. Card number is critical for sports cards where "Michael Jordan"
  // alone can match a Funko POP.
  const pcParams = new URLSearchParams({ name: card.name });
  if (card.number)  pcParams.set('number', card.number);
  if (card.setName) pcParams.set('set', card.setName);
  if (card.game)    pcParams.set('game', card.game);
  if (grade)        pcParams.set('grade', grade);
  // Sports needs year + sport + brand to disambiguate — without these,
  // PriceCharting matches "Tom Brady" to Funko POP NFL etc. See
  // scan_full_audit_2026-08-21.md § "Sports" for the failure mode.
  if (card.year)  pcParams.set('year', card.year);
  if (card.sport) pcParams.set('sport', card.sport);
  if (card.brand) pcParams.set('brand', card.brand);

  const clientTimeoutMs = 10000;
  const _clientController = new AbortController();
  const _clientTimeoutId  = setTimeout(() => _clientController.abort(), clientTimeoutMs);

  const tcgP  = fetch('/api/tcg-price?'      + tcgParams.toString(),  { signal: _clientController.signal })
    .then(r => r.ok ? r.json() : null).catch(() => null);
  const ebayP = fetch('/api/ebay-sold?'      + ebayParams.toString(), { signal: _clientController.signal })
    .then(r => r.ok ? r.json() : null).catch(() => null);
  // 2026-08-30: retry once if PC returns pricecharting-error. Our server
  // already does upstream retries, but if the whole burst fails and gets
  // cached (60s), a client retry ~1.5s later will still hit the cache.
  // Instead, wait 1.2s and try again — by then the server’s error cache is
  // expiring or the upstream has recovered. This eliminates the last ~5%
  // of transient failures the user sees on-screen.
  const _pcFetch = () => fetch('/api/pricecharting?' + pcParams.toString(),
                               { signal: _clientController.signal })
    .then(r => r.ok ? r.json() : null).catch(() => null);
  const pcP = _pcFetch().then(async (d) => {
    if (d && d.source === 'pricecharting-error') {
      await new Promise(r => setTimeout(r, 1200));
      if (_compsAbortCard !== cardKey) return d; // scan changed — don’t retry
      const d2 = await _pcFetch();
      // Only replace if the retry actually succeeded
      if (d2 && d2.source === 'pricecharting' && d2.prices) return d2;
    }
    return d;
  });

  // Grade opportunity: WITHDRAWN 2026-09-03. Do not re-enable without a real
  // graded price source AND a grade distribution.
  //
  // Why it was pulled: /api/grade-opportunity never looked up a graded price.
  // It returned rawPrice * a hardcoded tier multiplier (4.0x in the $100-500
  // band) and the UI labelled that invented number a "PSA 10 comp". On Base
  // Set 2 Charizard that printed "PSA 10 comp $1700" while the real PSA 10
  // market was $18-30k -- wrong by an order of magnitude, and wrong in the
  // direction that talks a seller out of grading.
  //
  // Two things must land before any version of this ships again:
  //   1. A graded price we can date. PriceCharting's API publishes only a
  //      current blended guide value with no timestamp and no sales history,
  //      so we cannot tell a fresh number from a two-year-old one. eBay sold
  //      comps 403 from production, so api/ebay-sold.js cannot fill the gap.
  //   2. A grade distribution. Assuming a PSA 10 is not conservative, it is
  //      the ~1% branch -- pop 70 at PSA 10 against 1400 at PSA 9 and 3974 at
  //      PSA 8 for this card. Any payoff figure has to be expected value
  //      across grades, not the top of the ladder.
  //
  // Fixing only (1) makes this MORE dangerous, not less: a real PSA 10 price
  // turns "$1700" into "$11695" and reads as a promise.
  const gradeOppP = Promise.resolve(null);

  let tcg, ebay, pc, gradeOpp;
  try {
    [tcg, ebay, pc, gradeOpp] = await Promise.all([tcgP, ebayP, pcP, gradeOppP]);
  } finally {
    clearTimeout(_clientTimeoutId);
  }

  // If card changed while fetching, abort
  if (_compsAbortCard !== cardKey) return;

  // Feed eBay tcgMarket after the fact if TCG resolved and eBay didn't get it
  // (eBay endpoint already got the query; we're just retrieving results here).

  // Cache raw eBay median for Raw↔Graded toggle memory
  if (!grade && ebay && ebay.median != null) {
    window._rawMedianCache = window._rawMedianCache || {};
    window._rawMedianCache[cardKey] = ebay.median;
  }

  // Populate priceOverride with best available price when user hasn't typed one.
  // 2026-08-19: Priority reordered because eBay is unreliable (403s) and PC is
  // now our primary graded/guide source.
  //   For a GRADED request (grade param set):
  //     PC (has this grade tier) > eBay comps (≥2) > TCG market
  //   For a RAW request:
  //     eBay comps (≥2) > PC (raw/loose) > TCG market
  //   TCG stays as the always-there floor for raw — it's live market data.
  const ovField = document.getElementById('priceOverride');
  const currentGraderPill = document.querySelector('#gradedPills .pill.sel')?.dataset.val || 'no';
  const gradedRequest     = !!grade;
  const isRawContext      = currentGraderPill === 'no' && !gradedRequest;
  if (ovField && (isRawContext || gradedRequest) && (!ovField.value || forceRefresh)) {
    let bestPrice = null;
    let _basisMeta = null;
    if (gradedRequest) {
      if (pc && pc.median != null && pc.source === 'pricecharting') {
        bestPrice = pc.median;
        // 2026-09-03: this rung set no _basisMeta, so a graded headline filled
        // from PriceCharting inherited whatever label the previous render left
        // behind. Name the source that produced the number.
        _basisMeta = { label: 'PriceCharting guide value',
                       cacheAgeSec: pc.cacheAgeSec ?? null,
                       sourceUrl: pc.url || null,
                       datedBySource: false };
      } else if (ebay && ebay.count >= 2 && ebay.median != null) {
        bestPrice = ebay.median;
        _basisMeta = { label: `eBay sold median · ${ebay.count} comps`,
                       cacheAgeSec: ebay.cacheAgeSec ?? null,
                       sourceUrl: ebay.searchUrl || null,
                       datedBySource: true };
      }
    } else {
      // Raw context — 2026-09-01: TCGplayer market now leads, ahead of both eBay
      // comps and PriceCharting. Three reasons, all checked against live data:
      //   1. eBay sold comps are 403ing sitewide right now (verified across five
      //      different cards: count 0, confidence 'insufficient'), so the old
      //      first rung effectively never fires and the anchor silently became
      //      PriceCharting for every raw card.
      //   2. PriceCharting's raw figure is a LOOSE value, which folds in played
      //      copies. This panel defaults to Near Mint, so anchoring NM math on a
      //      loose average understates it — $272.56 loose vs $422.40 TCG market
      //      on the same Base Set 2 Charizard.
      //   3. TCGplayer market is the number behind the venue the winner tile
      //      actually names, it is present for essentially every card, and it is
      //      stable across reloads. That last property is the whole point: the
      //      anchor must not change when a stranger hits refresh.
      // eBay median is kept as the second rung so it takes over automatically if
      // comps ever come back, and PriceCharting remains the backstop.
      if (tcg && tcg.market != null) {
        bestPrice = tcg.market;
        // Run the basis row through the same High clamp the price caption uses,
        // so the basis can't carry an un-clamped High while the visible Low/Mid/
        // High line shows a clamped one. `highClamped` is surfaced under the
        // winner tile to explain that payout prices off Market, never High.
        const _tcgC = (typeof _clampHigh === 'function') ? _clampHigh(tcg) : tcg;
        _basisMeta = { label: 'TCGPlayer market', low: _tcgC.low, mid: _tcgC.mid, high: _tcgC.high,
                       highClamped: !!_tcgC.highClamped,
                       cacheAgeSec: tcg.cacheAgeSec ?? null,
                       sourceUrl: tcg.url || null,
                       // TCGplayer market is derived from completed sales, so a
                       // retrieval age is a fair freshness signal for it.
                       datedBySource: true };
      } else if (ebay && ebay.count >= 2 && ebay.median != null) {
        bestPrice = ebay.median;
        _basisMeta = { label: `eBay sold median · ${ebay.count} comps`,
                       cacheAgeSec: ebay.cacheAgeSec ?? null,
                       sourceUrl: ebay.searchUrl || null,
                       datedBySource: true };
      } else if (pc && pc.median != null && pc.source === 'pricecharting') {
        bestPrice = pc.median;
        _basisMeta = { label: 'PriceCharting guide value',
                       cacheAgeSec: pc.cacheAgeSec ?? null,
                       sourceUrl: pc.url || null,
                       datedBySource: false };
      }
    }
    if (bestPrice != null) {
      ovField.value = Number(bestPrice).toFixed(2);
      // The single basis. updatePriceFromPrinting() renders the headline from
      // THIS, so "Market Value" and every payout row are guaranteed to be the
      // same number times the same condition multiplier — no second feed.
      window._crBasis = {
        value: Number(bestPrice),
        label: (_basisMeta && _basisMeta.label) || '',
        low:  _basisMeta ? _basisMeta.low  : null,
        mid:  _basisMeta ? _basisMeta.mid  : null,
        high: _basisMeta ? _basisMeta.high : null,
        highClamped: !!(_basisMeta && _basisMeta.highClamped),
        // Freshness contract: the caption under the headline names the source
        // AND how old it is. Carrying these on the basis means the caption can
        // never disagree with the row it was derived from.
        cacheAgeSec: _basisMeta ? (_basisMeta.cacheAgeSec ?? null) : null,
        sourceUrl:   _basisMeta ? (_basisMeta.sourceUrl   || null) : null,
        // PriceCharting publishes no as-of date; TCGplayer market is computed
        // from completed sales. The caption needs to know which it is holding.
        datedBySource: _basisMeta ? !!_basisMeta.datedBySource : false,
      };
      // Remember that WE filled this, not the user. A user-typed number is the
      // price they expect to actually sell at, so it must be used verbatim; a
      // system-filled number is a Near-Mint basis and has to be condition
      // adjusted like any other basis. See getEffectivePrice().
      window._ovAutoFilled = true;
      // A fresh system basis just landed in the field, so any earlier tier
      // choice is void -- it was picked against the previous basis.
      window._qpChosenTier = null;
      // 2026-09-01 (launch gate): name the rung that actually produced this
      // number. Before this, the caption under the price kept whatever
      // updatePriceFromPrinting() had written from selectedCard.source — so a
      // price filled from PriceCharting still read "TCGPlayer market". Browser
      // QA caught the same Charizard showing $489.11 (printing feed) on first
      // load and $272.56 (PriceCharting) after a reload, both captioned
      // "TCGPlayer market". The number moving is a data question; the caption
      // naming a source that did not produce it is just untrue, so fix that.
      try {
        // Was: guess the rung by float-comparing bestPrice against each source.
        // Two feeds agreeing to the cent would mislabel it. The ladder now
        // records which rung it took, so just read that.
        const _srcLabel = (window._crBasis && window._crBasis.label) || '';
        if (_srcLabel && priceSource) {
          // Freshness contract (P0-D): the caption states the source, links to
          // it, and says how old the number is. Previously it printed the
          // source name alone, so a figure retrieved four hours ago was
          // indistinguishable from one retrieved four seconds ago.
          //
          // "retrieved" not "as of": for PriceCharting we genuinely do not
          // know when the price was set (no timestamp in their API), and for
          // TCGplayer we know when we fetched their computed market price, not
          // the date of the last sale behind it. Either way the verb we can
          // defend is the one about our own fetch.
          const _b = window._crBasis || {};
          _renderPriceCaption(priceSource, {
            label: _srcLabel,
            url: _b.sourceUrl,
            cacheAgeSec: _b.cacheAgeSec,
            datedBySource: _b.datedBySource,
          });
          window._ovFilledBy = _srcLabel;
        }
        // Repaint the headline off the basis we just recorded. Without this the
        // basis is stored but nothing re-renders, so "Market Value" keeps
        // showing the embedded per-card figure while the payouts use the
        // ladder - verified live as a $152.16 headline over a $123.28 basis.
        if (window._crBasis && window._ovAutoFilled
            && typeof updatePriceFromPrinting === 'function') {
          updatePriceFromPrinting();
        }
      } catch(e) {
        // Was `catch(_) {}`. A swallowed throw here is exactly how the headline
        // silently kept disagreeing with the payouts.
        console.warn('[price-basis] headline repaint failed', e);
      }
      calc();
    }
  }

  // Stash grade opportunity for the scan-gate warning
  window._lastGradeOpportunity = gradeOpp;
  window._lastGradeOpportunityCard = cardKey;

  // 2026-08-30 fix: inject PriceCharting's per-grade prices into currentPrices.
  // Previously the client only used pc.median to fill priceOverride — but the
  // full pc.prices { raw, grade_7, grade_8, grade_9, grade_95, psa_10, bgs_10,
  // cgc_10, sgc_10 } object was thrown away. When TPL later populated psa_10
  // with its ebay avg_7d (~$120 for Mew GG10 vs PriceCharting's guide value
  // $557), the wrong TPL number won. PriceCharting is the authoritative
  // guide-value source — use it for graded prices and only fall back to TPL
  // for grades PC doesn't publish (BGS 9-, CGC 9-, SGC 9-, ACE, TAG, etc.).
  if (pc && pc.source === 'pricecharting' && pc.prices && typeof pc.prices === 'object') {
    try {
      const PC_TO_KEY = {
        // PC field key -> currentPrices/priceVariants key + label
        // Grader-agnostic, per PriceCharting's own API docs: "Graded 7 or 7.5
        // / 8 or 8.5 / 9 by a grading company". So 7 and 8 each BLEND two
        // grades into one number, and none of the three is PSA-specific --
        // only manual-only-price ("Graded 10 by PSA") is. The internal keys
        // stay psa_* because syncKey/_QP_KEY_TO_PC are wired to them; only the
        // user-visible label changes.
        grade_7:  { key: 'psa_7',  label: 'Grade 7 — any grader (PriceCharting)' },
        grade_8:  { key: 'psa_8',  label: 'Grade 8 — any grader (PriceCharting)' },
        grade_9:  { key: 'psa_9',  label: 'Grade 9 — any grader (PriceCharting)' },
        // PriceCharting's "Grade 9.5" column is grader-agnostic. PSA does not
        // issue a 9.5 (its half grades stop at 8.5), so labelling this "PSA
        // 9.5" invents a grade that cannot exist on a slab. BGS and CGC both
        // issue 9.5, so the rung is real -- just not PSA's.
        grade_95: { key: 'psa_9_5',label: 'Grade 9.5 — BGS/CGC (PriceCharting)'},
        psa_10:   { key: 'psa_10', label: 'PSA 10 (PriceCharting)' },
        bgs_10:   { key: 'bgs_10', label: 'BGS 10 (PriceCharting)' },
        cgc_10:   { key: 'cgc_10', label: 'CGC 10 (PriceCharting)' },
        sgc_10:   { key: 'sgc_10', label: 'SGC 10 (PriceCharting)' },
      };
      window.currentPrices = window.currentPrices || {};

      // Stash the WHOLE PriceCharting price object, not just the grades we
      // mirror into variants. The grade-ladder bar needs PC's own raw value as
      // the floor of the ladder even when a TCGplayer raw price already won
      // the raw pill (the `hasRaw` branch below then skips injecting PC raw as
      // a variant, so it would otherwise be unreachable). Building the ladder
      // from one source end-to-end is the point: PC raw -> PC PSA 10 is a
      // like-for-like comparison, whereas TCG raw -> PC PSA 10 silently mixes
      // a completed-sales price with a blended guide value and would overstate
      // or understate the step depending on which way the two feeds disagree.
      //
      // Tagged with the card identity so a stale ladder can never paint onto
      // the next card: async PC responses can land after the user has moved on.
      window._crPCLadder = {
        prices: pc.prices,
        url: pc.url || null,
        cacheAgeSec: pc.cacheAgeSec ?? null,
        productName: pc.productName || null,
        forName: (selectedCard && selectedCard.name) || null,
        forSet:  (selectedCard && selectedCard.setName) || null,
      };

      Object.entries(PC_TO_KEY).forEach(([pcKey, m]) => {
        const v = pc.prices[pcKey];
        if (v == null || !isFinite(v) || v <= 0) return;
        // Overwrite whatever was there — PriceCharting wins over TPL for the
        // grades PC actually publishes. Uses same {market, low, mid, high}
        // row shape as everything else so updatePriceFromPrinting reads it.
        currentPrices[m.key] = {
          key:    m.key,
          label:  m.label,
          market: v,
          low:    v,
          mid:    v,
          high:   v,
          source: 'pricecharting',
          // Citation travels with the price. Every PriceCharting-sourced
          // number in this app must be clickable back to the page it came
          // from, so a seller can check the guide value themselves.
          url:    pc.url || null,
          cacheAgeSec: pc.cacheAgeSec ?? null,
          datedBySource: false,
        };
        // Also mirror into selectedCard.priceVariants so any downstream code
        // that iterates variants (fee audit, portfolio, etc.) sees it.
        if (selectedCard && Array.isArray(selectedCard.priceVariants)) {
          const idx = selectedCard.priceVariants.findIndex(x => x.key === m.key);
          const row = {
            key: m.key,
            label: m.label,
            market: v,
            low: v, mid: v, high: v,
            source: 'pricecharting',
            url: pc.url || null,
            cacheAgeSec: pc.cacheAgeSec ?? null,
            datedBySource: false,
          };
          if (idx >= 0) selectedCard.priceVariants[idx] = row;
          else selectedCard.priceVariants.push(row);
        }
      });
      // Also inject raw if we don't have a raw variant with a price yet — keeps
      // the raw pill showing a real number instead of —.
      const rawKey = pc.prices.raw;
      if (rawKey != null && rawKey > 0) {
        const hasRaw = selectedCard && (selectedCard.priceVariants || []).some(v =>
          !/^(psa|bgs|cgc|ace|tag|sgc)_/.test(v.key) && v.market != null && v.market > 0
        );
        if (!hasRaw && selectedCard && Array.isArray(selectedCard.priceVariants)) {
          selectedCard.priceVariants.unshift({
            key: 'holofoil',
            label: 'PriceCharting raw',
            market: rawKey, low: rawKey, mid: rawKey, high: rawKey,
            source: 'pricecharting',
            url: pc.url || null,
            cacheAgeSec: pc.cacheAgeSec ?? null,
            datedBySource: false,
          });
          currentPrices['holofoil'] = selectedCard.priceVariants[0];
        }
      }
      // If the user is currently viewing a graded slab, repaint the price now
      // that the accurate PC number landed — don't wait for a manual toggle.
      const _curKey = (typeof printSelect !== 'undefined' && printSelect) ? printSelect.value : '';
      if (_curKey && /^(psa|bgs|cgc|sgc)_/.test(_curKey) && typeof updatePriceFromPrinting === 'function') {
        updatePriceFromPrinting();
      }
    } catch(e) {
      console.warn('[pc-graded-inject] failed', e);
    }
  }

  // Render composed price status (TCG line always, PC + eBay overlays when available)
  // + grade opportunity pill (silent if not worth grading)
  statusTxt.innerHTML = renderPriceStatus({ tcg, ebay, pc, fallbackEbayUrl }) + renderGradeOpportunity(gradeOpp);
  statusEl.style.display = 'flex';

  // If NO source resolved anything usable, show a graceful fallback link.
  // (PC counts as "resolved" when median is present and source is pricecharting;
  // an "unconfigured" or "insufficient" PC response is treated as no data.)
  const pcHasPrice   = pc && pc.median != null && pc.source === 'pricecharting';
  const ebayHasComps = ebay && ebay.count >= 2 && ebay.median != null;
  const tcgHasMarket = tcg && tcg.market != null && tcg.market > 0;
  if (!tcgHasMarket && !ebayHasComps && !pcHasPrice) {
    statusTxt.innerHTML =
      `<a href="${fallbackEbayUrl}" target="_blank" rel="noopener" style="color:var(--gold-text);font-weight:700;text-decoration:none">View sold comps on eBay →</a>` +
      renderGradeOpportunity(gradeOpp);
  }
}

function openEbayComps() {
  const player  = _stripEmoji(document.getElementById('sp_player').value).trim();
  const year    = document.getElementById('sp_year').value.trim();
  const brand   = document.getElementById('sp_brand').value.trim();
  const cardnum = document.getElementById('sp_cardnum').value.trim();
  const grade   = document.getElementById('sp_grade').value;
  const sport   = document.getElementById('sp_sport').value;

  const parts = [player, year, brand, cardnum, grade !== 'Raw/Ungraded' ? grade : ''].filter(Boolean);
  if (!parts.length) { showToast('Enter at least a player name first.'); return; }

  const query = encodeURIComponent(parts.join(' '));
  window.open(buildEbayUrl(`https://www.ebay.com/sch/i.html?_nkw=${query}&_sacat=212&LH_Sold=1&LH_Complete=1`), '_blank');

  // Sync search input so it shows what was searched
  const ssi = document.getElementById('sportsSearchInput');
  if (ssi && player) ssi.value = player;

  // Also load a sports card into the card panel. Third copy of this literal
  // until 2026-09-03; this one additionally passed a blank image instead of
  // the scan photo the other two used, so opening comps wiped the card art.
  const sportCard = _buildSportsCard(player || 'Sports Card');
  selectedCard = sportCard;
  loadCardUI(sportCard);
  _loadSportsVariants(sportCard);
}

// ── Sports search (eBay sold comps) ──
let _sportsSearchTimeout = null;

// Wire up sports search input via event delegation
(function initSportsSearch() {
  document.addEventListener('input', function(e) {
    if (e.target.id !== 'sportsSearchInput') return;
    clearTimeout(_sportsSearchTimeout);
    const q = e.target.value.trim();
    const sdl = document.getElementById('sportsDropList');
    if (q.length < 2) { if (sdl) { sdl.innerHTML = ''; sdl.classList.remove('open'); } return; }
    _sportsSearchTimeout = setTimeout(() => doSportsSearchLive(q), 350);
  });
  document.addEventListener('keydown', function(e) {
    if (e.target.id !== 'sportsSearchInput') return;
    if (e.key === 'Enter') { clearTimeout(_sportsSearchTimeout); doSportsSearch(); }
    if (e.key === 'Escape') {
      const sdl = document.getElementById('sportsDropList');
      if (sdl) { sdl.innerHTML = ''; sdl.classList.remove('open'); }
    }
  });
  document.addEventListener('click', function(e) {
    // Keep dropdown open if clicking the search box OR the search button
    if (!e.target.closest('.sports-search-box') && !e.target.closest('#sportsSearchBtn')) {
      const sdl = document.getElementById('sportsDropList');
      if (sdl) { sdl.classList.remove('open'); }
    }
  });
})();

async function doSportsSearchLive(q) {
  const sdl = document.getElementById('sportsDropList');
  if (!sdl) return;
  sdl.innerHTML = '<div class="drop-loading"><span class="spinner" style="border-color:rgba(0,0,0,.2);border-top-color:var(--gold)"></span> Searching eBay sold&hellip;</div>';
  sdl.classList.add('open');

  const sport  = document.getElementById('sp_sport')?.value || 'Baseball';
  const year   = document.getElementById('sp_year')?.value?.trim() || '';
  const brand  = document.getElementById('sp_brand')?.value?.trim() || '';
  const cardnum= document.getElementById('sp_cardnum')?.value?.trim() || '';
  const grade  = document.getElementById('sp_grade')?.value || 'Raw/Ungraded';
  const gradeLabel = grade !== 'Raw/Ungraded' ? grade : '';
  // ALWAYS strip emoji from the free-text query — the sports card display uses
  // "🏀 Player Name" which was leaking into eBay _nkw.
  q = _stripEmoji(q);
  // Build full-context query: player + year + brand + card# + grade + "sport card".
  // Passing card# is critical for rookie/insert cards where "Ja Morant" alone
  // returns 6,800+ results; "Ja Morant 2019 Panini Select 42 basketball card"
  // returns the actual card.
  const queryParts = [q, year, brand, cardnum, gradeLabel, sport + ' card'].filter(Boolean);
  const ebayQuery  = queryParts.join(' ');
  const ebayUrl    = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(ebayQuery)}&_sacat=212&LH_Sold=1&LH_Complete=1`;

  let html = '';

  // Direct eBay search row
  html += `<div class="drop-item" data-sports-idx="ebay-direct" style="border-left:3px solid var(--gold);cursor:pointer">
    <div class="drop-thumb-ph" style="font-size:1.1rem">🛒</div>
    <div class="drop-info">
      <div class="drop-name">${esc(q)} <span style="font-size:.72rem;color:var(--gold-text);font-weight:700">SEARCH EBAY SOLD</span></div>
      <div class="drop-meta">Open eBay sold listings for: ${esc(queryParts.slice(0,3).join(' '))}</div>
    </div>
    <span style="background:var(--gold);color:#fff;font-size:.68rem;font-weight:700;padding:.2rem .5rem;border-radius:.4rem;white-space:nowrap">Sold Comps</span>
  </div>`;

  // Grade-specific eBay searches
  const gradeOpts = ['Raw/Ungraded','PSA 10','PSA 9','PSA 8','BGS 9.5','CGC 9.5'];
  gradeOpts.forEach((g, i) => {
    const gq = g !== 'Raw/Ungraded' ? g : '';
    // Include card# in per-grade queries too — same reason.
    const gParts = [q, year, brand, cardnum, gq, sport + ' card'].filter(Boolean);
    const gUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(gParts.join(' '))}&_sacat=212&LH_Sold=1&LH_Complete=1`;
    const glabel = g === 'Raw/Ungraded' ? 'Raw / Ungraded' : g;
    html += `<div class="drop-item" data-sports-idx="ebay-grade-${i}" data-ebay-url="${esc(gUrl)}" data-grade-val="${esc(g)}" style="cursor:pointer">
      <div class="drop-thumb-ph" style="font-size:.95rem">🏷️</div>
      <div class="drop-info">
        <div class="drop-name">${esc(q)} — <span style="font-weight:600">${esc(glabel)}</span></div>
        <div class="drop-meta">eBay sold comps for this grade</div>
      </div>
      <span style="font-size:.68rem;color:var(--text-muted)">eBay →</span>
    </div>`;
  });

  // PriceCharting search link — include year/brand for tighter matches.
  const pcParts = [q, year, brand, sport].filter(Boolean);
  const pcUrl = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(pcParts.join(' '))}&type=prices`;
  html += `<div class="drop-item" data-sports-idx="pricecharting" data-pc-url="${esc(pcUrl)}" style="cursor:pointer">
    <div class="drop-thumb-ph" style="font-size:.95rem">📊</div>
    <div class="drop-info">
      <div class="drop-name">${esc(q)} on PriceCharting</div>
      <div class="drop-meta">Cross-reference prices (especially graded)</div>
    </div>
    <span style="font-size:.68rem;color:var(--text-muted)">PC →</span>
  </div>`;

  // 130point — aggregator of sports card sold sales across eBay + PWCC + Goldin + etc.
  const p130Query = [q, year, brand, cardnum, gradeLabel].filter(Boolean).join(' ');
  const p130Url   = `https://130point.com/sales/?search=${encodeURIComponent(p130Query)}&searchButton=&sortBy=date`;
  html += `<div class="drop-item" data-sports-idx="p130" data-p130-url="${esc(p130Url)}" style="cursor:pointer">
    <div class="drop-thumb-ph" style="font-size:.95rem">💰</div>
    <div class="drop-info">
      <div class="drop-name">${esc(q)} on 130point</div>
      <div class="drop-meta">Aggregated sold sales — eBay + Fanatics Collect + Goldin + more</div>
    </div>
    <span style="font-size:.68rem;color:var(--text-muted)">130pt →</span>
  </div>`;

  // Fanatics Collect (formerly PWCC — rebranded Jul 15, 2024).
  // Major sports auction house / fixed-price listings. Include card# so
  // "Ja Morant 2019 Panini Select 42" hits the exact print.
  // The /search route 404s — Fanatics Collect search lives under /marketplace (verified 2026-09-02)
  const fanaticsCompUrl = `https://www.fanaticscollect.com/marketplace?q=${encodeURIComponent([q, year, brand, cardnum].filter(Boolean).join(' '))}`;
  html += `<div class="drop-item" data-sports-idx="fanatics" data-fanatics-url="${esc(fanaticsCompUrl)}" style="cursor:pointer">
    <div class="drop-thumb-ph" style="font-size:.95rem">💎</div>
    <div class="drop-info">
      <div class="drop-name">${esc(q)} on Fanatics Collect</div>
      <div class="drop-meta">Auction house comps + fixed-price listings (formerly PWCC)</div>
    </div>
    <span style="font-size:.68rem;color:var(--text-muted)">Fanatics →</span>
  </div>`;

  sdl.innerHTML = html;
  sdl.classList.add('open');

  // Attach click handlers
  sdl.querySelectorAll('.drop-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = el.dataset.sportsIdx;
      if (idx === 'ebay-direct') {
        window.open(buildEbayUrl(ebayUrl), '_blank');
        const spPlayer = document.getElementById('sp_player');
        if (spPlayer && !spPlayer.value) spPlayer.value = q;
        loadSportsCardFromSearch(q);
      } else if (idx === 'pricecharting') {
        window.open(el.dataset.pcUrl, '_blank');
        const spPlayer = document.getElementById('sp_player');
        if (spPlayer && !spPlayer.value) spPlayer.value = q;
        loadSportsCardFromSearch(q);
      } else if (idx === 'p130') {
        window.open(el.dataset.p130Url, '_blank');
        const spPlayer = document.getElementById('sp_player');
        if (spPlayer && !spPlayer.value) spPlayer.value = q;
        loadSportsCardFromSearch(q);
      } else if (idx === 'fanatics') {
        window.open(el.dataset.fanaticsUrl, '_blank');
        const spPlayer = document.getElementById('sp_player');
        if (spPlayer && !spPlayer.value) spPlayer.value = q;
        loadSportsCardFromSearch(q);
      } else if (el.dataset.ebayUrl) {
        window.open(buildEbayUrl(el.dataset.ebayUrl), '_blank');
        const spPlayer = document.getElementById('sp_player');
        if (spPlayer && !spPlayer.value) spPlayer.value = q;
        // Set grade dropdown
        const gradeVal = el.dataset.gradeVal;
        if (gradeVal) {
          const spGrade = document.getElementById('sp_grade');
          if (spGrade) {
            const opt = Array.from(spGrade.options).find(o => o.value === gradeVal);
            if (opt) spGrade.value = opt.value;
          }
        }
        loadSportsCardFromSearch(q);
      }
      sdl.classList.remove('open');
    });
  });
}

function doSportsSearch() {
  const ssi = document.getElementById('sportsSearchInput');
  const q = (ssi?.value || '').trim();
  if (!q) {
    if (ssi) {
      ssi.focus();
      ssi.style.boxShadow = '0 0 0 3px var(--gold-border)';
      setTimeout(() => { ssi.style.boxShadow = ''; }, 1500);
    }
    return;
  }
  doSportsSearchLive(q);
}

// Sports cards have no image CDN behind them — PriceCharting and eBay don't
// expose one the way Limitless does for Pokémon — so the sports tile always
// rendered a permanent grey placeholder. When the card arrived via a scan we
// already hold the best possible picture of it: the user's own photo.
// _routeScannedSportsCard records both the photo and the player it belongs to,
// and we hand it back ONLY for that player, so a photo can never leak onto a
// different card the user types in afterwards.
function _sportsScanImageFor(playerName) {
  try {
    const want = _stripEmoji(String(playerName || '')).trim().toLowerCase();
    const own  = String(window._sportsScanPlayer || '').trim().toLowerCase();
    if (!want || !own || want !== own) return '';
    return window._sportsScanImageUrl || '';
  } catch (_) { return ''; }
}

// 2026-09-03: ONE sports card builder.
//
// This existed as two byte-identical object literals (here and in the
// ['sp_player',...] change handler), and both were missing fields the pricing
// call actually reads: the fetch at the PriceCharting call site reads
// card.year, card.sport and card.brand, but the literals only ever set
// setName and rarity. So the price lookup for a form-built sports card went
// out with year/sport/brand undefined -- the three facets that keep "Michael
// Jordan" from matching a Funko POP. Consolidating removes the drift risk
// that let one copy be fixed and the other not.
function _buildSportsCard(playerName) {
  const year    = document.getElementById('sp_year')?.value?.trim() || '';
  const brand   = document.getElementById('sp_brand')?.value?.trim() || '';
  const cardnum = document.getElementById('sp_cardnum')?.value?.trim() || '';
  const sport   = document.getElementById('sp_sport')?.value || 'Baseball';
  const emoji   = SPORT_EMOJI[sport] || '🏆';
  const img     = _sportsScanImageFor(playerName);
  return {
    name: `${emoji} ${playerName}`,
    game: 'sports',
    images: { small: img, large: img },
    setName: [year, brand].filter(Boolean).join(' '),
    number: cardnum,
    rarity: sport,
    // Facets the pricing call needs. Previously absent.
    year, sport, brand,
    playerName,
    priceVariants: [],   // filled from PriceCharting's real parallel list
    source: 'PriceCharting',
    updatedAt: 'Pick a variant',
  };
}

// ── Sports parallels: ask PriceCharting what this card actually is ────────
//
// Why a picker and not a text field: 2023 Prizm Wembanyama #136 has 71 listed
// parallels, including [Silver], [Silver Pandora] and [Silver Prizm Fast
// Break]. Typing "Silver" cannot identify one of those, and the values are not
// close -- PSA 10 runs $3,075 / $3,081 / $1,953. The matcher refuses ambiguity
// rather than guessing, so the honest fix is to show the real list and let the
// user point at their card.
//
// One request per card. No prices in the list: PriceCharting's plural endpoint
// returns none, and pricing 71 rows at 1 req/sec would take over a minute. We
// price exactly the row the user picks, by product id.
// Sports has ONE grade control: the Grade / Condition select in the sports
// form. The card panel's Condition pills and Graded Slab pills are the Pokemon
// controls, and leaving them visible for sports created two live lies:
//
//   * the Graded Slab row read "Raw / Ungraded" while the headline showed a
//     PSA 10 guide value, because sp_grade and the pills are separate state
//   * the Condition pills are not reset on card load and multiply the basis,
//     so a stale "Mod. Play" would take 35% off a PriceCharting value that
//     already priced the exact grade asked for -- and sp_grade encodes
//     condition itself ("Raw - Excellent"), so it double-discounts
//
// So for sports we hide both and pin condition to Near Mint (multiplier 1.0).
function _applySportsPriceControls(card) {
  const c = card || selectedCard;
  const isSports = c && c.game === 'sports';
  const ids = ['condLabel', 'condPills', 'gradedLabel', 'gradedPills'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isSports ? 'none' : '';
  });
  const pl = document.getElementById('printingLabel');
  if (pl) {
    pl.innerHTML = isSports
      ? `Parallel / Variant <span style="font-weight:400;color:var(--text-faint);font-size:.72rem">— priced at the grade you selected above</span>`
      : `Printing / Variant <span style="font-weight:400;color:var(--text-faint);font-size:.72rem">— raw prices; graded prices set below</span>`;
  }
  if (isSports) {
    // Pin the multiplier to 1.0 so a stale pill cannot scale a guide value.
    document.querySelectorAll('#condPills .pill').forEach(x => x.classList.remove('sel'));
    document.querySelector('#condPills .pill[data-cond="nm"]')?.classList.add('sel');
    document.querySelectorAll('#gradedPills .pill').forEach(x => x.classList.remove('sel'));
    document.querySelector('#gradedPills .pill[data-val="no"]')?.classList.add('sel');
  }
}

async function _loadSportsVariants(card) {
  const gen = ++window._spVarGen;
  const sel = printSelect;
  if (!sel) return;
  _applySportsPriceControls();
  if (!card.playerName) return;
  sel.innerHTML = '<option value="">Loading variants…</option>';
  _setSportsConfirm(null);
  try {
    const qp = new URLSearchParams({ game: 'sports', variants: '1', name: card.playerName });
    if (card.year)   qp.set('year', card.year);
    if (card.brand)  qp.set('brand', card.brand);
    if (card.number) qp.set('number', card.number);
    if (card.sport)  qp.set('sport', card.sport);
    const r = await fetch('/api/pricecharting?' + qp.toString());
    const d = await r.json();
    // Stale-guard: the user may have edited a field while this was in flight.
    if (gen !== window._spVarGen) return;
    if (selectedCard !== card) return;
    const vars = Array.isArray(d.variants) ? d.variants : [];
    if (!vars.length) {
      sel.innerHTML = '<option value="">No PriceCharting match — use Override</option>';
      _setSportsConfirm({ none: true, card });
      return;
    }
    window._spVariants = {};
    sel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = vars.length === 1
      ? 'Select the variant…'
      : `Select the variant… (${vars.length} on PriceCharting)`;
    sel.appendChild(ph);
    vars.forEach(v => {
      const key = 'sports_pc:' + v.id;
      window._spVariants[key] = v;
      const opt = document.createElement('option');
      opt.value = key;
      // Deliberately no price here -- we have not fetched one, and inventing a
      // placeholder is how a wrong number gets believed.
      opt.textContent = v.label;
      sel.appendChild(opt);
    });
    sel.value = '';
    // Nothing is priced until a variant is chosen, so show no dollars.
    _setSportsConfirm({ pending: true, count: vars.length, card });
  } catch (e) {
    if (gen !== window._spVarGen) return;
    sel.innerHTML = '<option value="">Couldn\'t load variants — use Override</option>';
    _setSportsConfirm({ error: true, card });
  }
}
window._spVarGen = 0;
window._spVariants = {};

// Price the exact product the user selected. pcid means no re-resolution, so
// the card they picked is the card that gets priced.
async function _priceSportsVariant(key) {
  const v = window._spVariants[key];
  if (!v) return;
  const card = selectedCard;
  const gen = ++window._spPriceGen;
  const grade = document.getElementById('sp_grade')?.value || 'Raw/Ungraded';
  const gradeParam = /^Raw/.test(grade) ? 'raw' : grade;
  _setSportsConfirm({ loading: true, variant: v, card });
  try {
    const qp = new URLSearchParams({ game: 'sports', pcid: v.id, name: card.playerName || 'x', grade: gradeParam });
    const r = await fetch('/api/pricecharting?' + qp.toString());
    const d = await r.json();
    if (gen !== window._spPriceGen || selectedCard !== card) return;
    if (d.median == null) {
      // Comps-or-silence: no value for this grade means no number, not a guess.
      _setSportsConfirm({ noPrice: true, variant: v, card, reason: (d.confidenceReasons || [])[0] });
      currentPrices[key] = { key, label: v.label, market: null, low: null, mid: null, high: null };
      updatePriceFromPrinting();
      return;
    }
    // PriceCharting publishes ONE guide value per grade, so low == mid == high.
    // Rendering that as "Low $3075 · Mid $3075 · High $3075" dresses a single
    // number up as a measured range -- the same fabricated spread that was
    // removed from Quick Pricing for graded slabs. Leave the tiers null and
    // the headline shows the value alone.
    currentPrices[key] = {
      key, label: v.label,
      market: d.median, low: null, mid: null, high: null,
    };
    window._crBasis = {
      value: d.median, low: null, mid: null, high: null,
      label: `SportsCardsPro guide · ${v.productName}`,
    };
    window._ovAutoFilled = true;
    window._qpChosenTier = null;   // new basis -> previous tier choice is void
    if (priceOverride) priceOverride.value = d.median.toFixed(2);
    _setSportsConfirm({ variant: v, card, data: d, grade });
    updatePriceFromPrinting();
    calc();
  } catch (e) {
    if (gen !== window._spPriceGen) return;
    _setSportsConfirm({ error: true, variant: v, card });
  }
}
window._spPriceGen = 0;

// The confirm strip: names the exact card the number belongs to, and appears
// BEFORE any dollar figure does. A sports value is only meaningful next to the
// product it came from -- "$3,075" alone cannot be checked by the user.
function _setSportsConfirm(state) {
  const el = document.getElementById('sportsConfirm');
  if (!el) return;
  if (!state) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const wrap = (inner, tone) => {
    el.style.display = 'block';
    el.className = 'sports-confirm' + (tone ? ' ' + tone : '');
    el.innerHTML = inner;
  };
  if (state.pending) {
    wrap(`<div class="sc-head">Pick your exact variant</div>
      <div class="sc-body">PriceCharting lists <strong>${state.count}</strong> version${state.count === 1 ? '' : 's'} of this card. Parallels can differ by many multiples, so choose the one you own — no price is shown until you do.</div>`);
    return;
  }
  if (state.loading) {
    wrap(`<div class="sc-head">Checking ${esc(state.variant.label)}…</div>`);
    return;
  }
  if (state.none) {
    wrap(`<div class="sc-head">No PriceCharting match</div>
      <div class="sc-body">We couldn't find this card on the sports guide. Open a comp source below and type the price you see into <strong>Override</strong>.</div>`, 'warn');
    return;
  }
  if (state.noPrice) {
    wrap(`<div class="sc-head">No guide value at this grade</div>
      <div class="sc-body">${esc(state.variant.productName)} — PriceCharting has no published value for ${esc(document.getElementById('sp_grade')?.value || '')}. Use a comp source below and <strong>Override</strong>.</div>`, 'warn');
    return;
  }
  if (state.error) {
    wrap(`<div class="sc-head">Lookup failed</div>
      <div class="sc-body">Couldn't reach the price guide. Use a comp source below and <strong>Override</strong>.</div>`, 'warn');
    return;
  }
  const d = state.data, v = state.variant;
  const age = d.cacheAgeSec != null ? _spAgeLabel(d.cacheAgeSec) : 'just now';
  wrap(`<div class="sc-head">Pricing this exact card</div>
    <div class="sc-rows">
      <div><span>Card</span><strong>${esc(v.productName)}</strong></div>
      <div><span>Set</span><strong>${esc(v.consoleName || '—')}</strong></div>
      <div><span>Variant</span><strong>${esc(v.label)}</strong></div>
      <div><span>Grade</span><strong>${esc(state.grade)}</strong></div>
      <div><span>Source</span><strong>SportsCardsPro guide · ${esc(age)}</strong></div>
    </div>
    <div class="sc-foot">Not your card? Change the variant above. <a href="${esc(d.url || '#')}" target="_blank" rel="noopener">Verify on PriceCharting →</a></div>`, 'ok');
}

function _spAgeLabel(sec) {
  if (sec < 90) return 'fetched just now';
  if (sec < 3600) return `fetched ${Math.round(sec / 60)}m ago`;
  return `fetched ${Math.round(sec / 3600)}h ago`;
}

function loadSportsCardFromSearch(playerName) {
  const sportCard = _buildSportsCard(playerName);
  selectedCard = sportCard;
  loadCardUI(sportCard);
  _loadSportsVariants(sportCard);
}


// ── Auto-load sports card on form field changes ──
['sp_player','sp_year','sp_brand','sp_cardnum','sp_sport','sp_grade'].forEach(id => {
  // Also sync player name → sports search input so they stay in sync
  if (id === 'sp_player') {
    document.getElementById(id)?.addEventListener('input', () => {
      const val = document.getElementById('sp_player')?.value || '';
      const ssi = document.getElementById('sportsSearchInput');
      if (ssi) ssi.value = val;
    });
  }
  document.getElementById(id)?.addEventListener('change', () => {
    // A pending change event from the sports form can land AFTER the user has
    // switched to another game (switching focus blurs the field, which fires
    // the deferred change). That rebuilt a sports card into the panel and
    // re-hid the Pokemon condition/slab pills, so leaving sports left the
    // grade controls missing until a card was loaded. The sports form only
    // gets to drive the panel while sports is the active game.
    if (activeGame !== 'sports') return;
    const player  = document.getElementById('sp_player').value.trim();
    if (!player) return;
    // Changing the GRADE does not change which card this is -- the parallel
    // list is identical. Rebuilding the card here threw away the variant the
    // user had already picked and sent them back to "Select the variant…",
    // so pick Silver then switch PSA 10 -> PSA 9 and the price vanished.
    // Re-price the same product instead.
    if (id === 'sp_grade' && selectedCard && selectedCard.game === 'sports') {
      const cur = printSelect && printSelect.value;
      if (cur && cur.startsWith('sports_pc:')) {
        delete currentPrices[cur];   // force a fetch at the new grade
        _priceSportsVariant(cur);
        return;
      }
    }
    const sportCard = _buildSportsCard(player);
    selectedCard = sportCard;
    loadCardUI(sportCard);
    _loadSportsVariants(sportCard);
  });
});

// ── Load card into UI (normalized format) ──
// ── Social proof counter (real numbers) ──
// Backed by /api/stats → Upstash KV. Every successful /api/tcg-price and
// /api/scan call increments the total server-side, so this counter reflects
// actual searches, not a formula. The client also bumps a local session
// counter so the number visibly ticks up while the user is on the page,
// which feels alive without misleading anyone about the true total.
(function() {
  window._spBase    = null; // set from /api/stats on first fetch
  window._spSession = 0;    // this browser session only (visual freshness)

  function _formatCount() {
    const base = window._spBase == null ? 0 : window._spBase;
    return (base + window._spSession).toLocaleString();
  }

  function _updateSocialProof() {
    const bar   = document.getElementById('socialProofBar');
    const count = document.getElementById('socialProofCount');
    const label = document.getElementById('socialProofLabel');
    if (!bar || !count || !label) return;
    // Hide the badge entirely until we have a real number — no fake "0" flash.
    if (window._spBase == null) { bar.style.display = 'none'; return; }
    count.textContent = _formatCount();
    label.textContent = 'searches so far — find out the value of your card';
    bar.style.display = 'inline';
  }

  async function _fetchRealCount() {
    try {
      const r = await fetch('/api/stats');
      if (!r.ok) return;
      const d = await r.json();
      if (typeof d.totalSearches === 'number' && d.totalSearches > 0) {
        window._spBase = d.totalSearches;
        _updateSocialProof();
      }
      // Also update the intro-state "cards searched today" badge with today's real count.
      // Hide the badge entirely when the count is 0 so we never advertise a fake number.
      const introBadge = document.getElementById('introTodayBadge');
      const introCount = document.getElementById('introTodayCount');
      if (introBadge && introCount) {
        const today = typeof d.todaySearches === 'number' ? d.todaySearches : 0;
        if (today > 0) {
          introCount.textContent = today.toLocaleString();
          introBadge.style.display = '';
        } else {
          introBadge.style.display = 'none';
        }
      }
    } catch (e) { /* silent — counter is optional */ }
  }

  window._triggerSocialProof = function() {
    window._spSession = (window._spSession || 0) + 1;
    _updateSocialProof();
  };

  // First fetch shortly after page load; refresh every 60s so long-lived tabs
  // stay in sync with the real total instead of drifting off session bumps.
  setTimeout(_fetchRealCount, 800);
  setInterval(_fetchRealCount, 60000);
})();

function loadCardUI(card) {
  // A real card is rendering now, so lift the swap placeholder.
  try { _endCardSwap(true); } catch(_) {}
  // Show the Add to My Collection button whenever a card is loaded
  const _colBtn = document.getElementById('addCollectionBtn');
  if (_colBtn) _colBtn.style.display = '';
  // 2026-08-30: hide the landing hero once a card is loaded — the payout
  // ranking becomes the visual hero. Persists across the session.
  const _hero = document.getElementById('landingHero');
  if (_hero) _hero.style.display = 'none';
  // 2026-08-31: restore the game-icon background pattern to full opacity now
  // that the results panel is the visual anchor, and drop the first-visit flag
  // (they engaged — no need to re-pulse next time).
  try { document.body.classList.remove('landing-active', 'first-visit'); } catch(_){}
  try { localStorage.setItem('cs_landing_seen', '1'); } catch(_){}
  // Persist the loaded card so a page refresh restores the user's spot.
  try { _persistLastLoadedCard(card); } catch(_) {}
  // Increment social proof counter on each card load
  if (window._triggerSocialProof) window._triggerSocialProof();
  const isSports  = card.game === 'sports';
  const isJPCard  = card.game === 'pokemonjp';
  // Show the right grade controls for this game (and restore them on the way
  // back from sports, which hides the Pokemon condition/slab pills).
  try { _applySportsPriceControls(card); } catch(_) {}

  // If this card was loaded via a scan, show grading CTA banner
  if (window._pendingScanBannerCard) {
    const pending = window._pendingScanBannerCard;
    window._pendingScanBannerCard = null;
    showGradingCtaBanner(card.name || pending);
  }

  // Clear price override on new card load
  if (priceOverride) priceOverride.value = '';
  const _qpHost = document.getElementById('quickPricing');
  if (_qpHost) _qpHost.style.display = 'none';
  window._ovAutoFilled = false;  // new card: no system basis in the field yet
  window._qpChosenTier = null;   // and no tier chosen for it yet
  window._crBasis = null;        // and no basis to render the headline from
  window._crPCLadder = null;     // and no grade ladder until PC answers for THIS card

  // Reset comps status
  _compsAbortCard = null;
  const _compsStatusEl = document.getElementById('ebayCompsStatus');
  if (_compsStatusEl) _compsStatusEl.style.display = 'none';

  // Reset graded pills to Raw/Ungraded on every new card load
  document.querySelectorAll('#gradedPills .pill').forEach(p => p.classList.remove('sel'));
  const rawPill = document.querySelector('#gradedPills .pill[data-val="no"]');
  if (rawPill) rawPill.classList.add('sel');
  gradeRow.style.display = 'none';
  if (gradeLabel) gradeLabel.style.display = 'none';
  const gcb = document.getElementById('gradedCompsBanner');
  if (gcb) gcb.style.display = 'none';

  // Show/hide JP links panel
  const jpEbaySellLink = document.getElementById('jpEbaySellLink');
  if (isJPCard && card._jpEbayUrl) {
    jpLinksPanel.style.display = 'block';
    // 2026-08-22: route JP eBay link through affiliate builder so the panel
    // CTA earns EPN credit like the auto-open link and companion sell link.
    try { jpEbayLink.href = (typeof buildEbayUrl === 'function') ? buildEbayUrl(card._jpEbayUrl) : card._jpEbayUrl; }
    catch(_) { jpEbayLink.href = card._jpEbayUrl; }
    jpPCLink.href   = card._jpPCUrl || '#';
    // Companion sell link — route to a buyer's-eye JP search so users see
    // active + sold comps for the exact card before listing (2026-08-14).
    if (jpEbaySellLink) {
      const jpNameForSell = card.name.replace(' (JP — use Override for JP price)', '').trim();
      jpEbaySellLink.href = buildEbaySearchUrl(jpNameForSell, card.number, {
        extra: 'japanese pokemon card', category: '183454'
      });
    }
  } else if (isJPCard) {
    // EN ref card in JP tab — still show JP links for the card name
    const rawName = card.name.replace(' (JP — use Override for JP price)', '').trim();
    const jpRefNum = card.number ? ' ' + card.number : '';
    jpLinksPanel.style.display = 'block';
    jpEbayLink.href = buildEbayUrl(`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(rawName + jpRefNum + ' japanese pokemon card')}&_sacat=183454&LH_Sold=1&LH_Complete=1`);
    jpPCLink.href   = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(rawName + jpRefNum + ' japanese')}&type=prices`;
    if (jpEbaySellLink) {
      // 2026-08-14: buyer's-eye JP search instead of sell wizard
      jpEbaySellLink.href = buildEbaySearchUrl(rawName, jpRefNum, {
        extra: 'japanese pokemon card', category: '183454'
      });
    }
  } else {
    jpLinksPanel.style.display = 'none';
  }

  // Image — progressive loading: show small (~30KB) immediately, then upgrade
  // to large (~200KB) in the background. Users see the card in ~200ms on 4G
  // instead of waiting 2s+ for the large image to download.
  //
  // 2026-08-18: BUGFIX — stale-image race across game switches.
  // Symptom: user searches a Pokémon card, then switches to Disney Lorcana and
  // searches a new card. Metadata updates correctly but the old Pokémon image
  // stays visible. Root cause: (1) cardImg.src was never cleared before the
  // next card began loading, so if the new card had a slow/missing image the
  // old one stayed on screen; and (2) the async upgrade closure captured
  // `card` and would swap in a stale largeUrl if it resolved after a game
  // switch. Fix: bump _imgGen on every load and gate all async writes on it;
  // explicitly blank the image before setting the new src so nothing stale
  // ever survives a game switch.
  const smallUrl = card.images?.small || '';
  const largeUrl = card.images?.large || '';
  const primaryUrl = smallUrl || largeUrl; // small first if available
  const _myImgGen = (window._imgGen = (window._imgGen || 0) + 1);
  // Blank first — never let the previous card's image bleed through to a new card
  cardImg.src = '';
  cardImgWrap.style.display = 'none';
  // 2026-08-22: reset one-attempt refresh guard so every new card gets its own
  // /api/tcg-price recovery chance (previously the flag stuck to the shared
  // <img> element and disabled recovery for EVERY later card).
  try { if (cardImg.dataset && 'crRefreshed' in cardImg.dataset) delete cardImg.dataset.crRefreshed; } catch(_){}
  if (primaryUrl) {
    // Give the browser a hint to prioritize this image
    try { cardImg.fetchPriority = 'high'; cardImg.loading = 'eager'; cardImg.decoding = 'async'; } catch(e) {}
    cardImg.src = primaryUrl;
    cardImg.onload = () => {
      if (_myImgGen !== window._imgGen) return; // stale — a newer card is loading
      cardImgPh.style.display = 'none';
      sportsCardPh.style.display = 'none';
      cardImgWrap.style.display = 'block';
      // Upgrade to large in the background once small is showing
      if (largeUrl && largeUrl !== primaryUrl) {
        const upgrade = new Image();
        upgrade.onload = () => {
          if (_myImgGen !== window._imgGen) return; // stale — user moved on
          cardImg.src = largeUrl;
        };
        upgrade.src = largeUrl;
      }
    };
    cardImg.onerror = () => {
      if (_myImgGen !== window._imgGen) return; // stale — user moved on
      // 2026-08-21: BEFORE showing "Image unavailable", try one silent
      // refresh from /api/tcg-price. Stale pokemontcg.io URLs (esp. for
      // restored cards from prior sessions) can 404 while tcgcsv still
      // returns a fresh TCGplayer CDN URL for the same card. Only for
      // Pokemon/YGO/MTG — sports cards use their own placeholder.
      const g = String(card && card.game || '').toLowerCase();
      const supportsRefresh = (g === 'pokemon' || g === 'pokemonjp' || g === 'ygo' || g === 'mtg' || g === 'yugioh');
      const alreadyRefreshed = cardImg.dataset && cardImg.dataset.crRefreshed === '1';
      if (supportsRefresh && !alreadyRefreshed && card && card.name) {
        try { if (cardImg.dataset) cardImg.dataset.crRefreshed = '1'; } catch(_){}
        (async () => {
          try {
            const params = new URLSearchParams({ name: card.name || '', game: g === 'yugioh' ? 'ygo' : g });
            if (card.number)  params.set('number', card.number);
            if (card.setName) params.set('set', card.setName);
            const r = await fetch('/api/tcg-price?' + params.toString(), { headers: { 'x-cardresell-source': 'img-refresh' } });
            if (!r.ok) throw new Error('tcg-price ' + r.status);
            const j = await r.json();
            if (_myImgGen !== window._imgGen) return;
            if (j && j.imageUrl && j.imageUrl !== cardImg.src) {
              cardImg.src = j.imageUrl;
              return; // onload/onerror will re-fire; on load we succeed silently
            }
          } catch(refreshErr) {
            try { console.warn('[card-img refresh] failed:', refreshErr && refreshErr.message); } catch(_){}
          }
          // Fallthrough: refresh didn't help — show placeholder.
          _showImgUnavailable();
        })();
        return;
      }
      _showImgUnavailable();
      function _showImgUnavailable() {
        cardImgWrap.style.display = 'none';
        if (isSports) {
          sportsCardPh.style.display = 'flex';
          cardImgPh.style.display = 'none';
        } else {
          // 2026-08-15: card IS loaded (name/meta populated below) but the
          // image URL failed — don't say "No card selected", say the truth.
          const _lab = document.getElementById('cardImgPhLabel');
          if (_lab) _lab.textContent = 'Image unavailable';
          cardImgPh.style.display = 'flex';
          sportsCardPh.style.display = 'none';
        }
      }
    };
    if (cardImg.complete && cardImg.naturalWidth > 0) {
      cardImgPh.style.display = 'none';
      sportsCardPh.style.display = 'none';
      cardImgWrap.style.display = 'block';
    }
  } else {
    cardImgWrap.style.display = 'none';
    if (isSports) {
      sportsCardPh.style.display = 'flex';
      cardImgPh.style.display = 'none';
    } else {
      // 2026-08-15: no image URL from the catalog for this card — same
      // fix as onerror path above so we don't say "No card selected"
      // while a card IS actually selected.
      const _lab = document.getElementById('cardImgPhLabel');
      if (_lab) _lab.textContent = 'Image unavailable';
      cardImgPh.style.display = 'flex';
      sportsCardPh.style.display = 'none';
    }
  }

  // Name & meta
  // 2026-08-16: strip emoji from the DISPLAY name too (was stripped for URLs
  // only). Sports cards prepend sport emojis like 🏀/⚾ that shouldn't appear
  // in the card panel title.
  cardNameEl.textContent = (typeof _stripEmoji === 'function' ? _stripEmoji(card.name || '') : (card.name || '')).trim();
  const metaParts = [card.setName, card.number ? `#${card.number}` : '', card.rarity].filter(Boolean);
  cardMetaEl.textContent = metaParts.join(' · ');
  cardNameBlock.style.display = 'block';

  // eBay Sell button — 2026-08-14: send to a searched view of THIS card
  // (sold comps + active listings) rather than eBay's blank sell wizard, so
  // sellers can price against real-time market before listing. Now paired
  // with a TCGplayer Sell button in a 2-col grid (#cardSellBtnRow).
  const ebayListBtn = document.getElementById('ebayListBtn');
  const tcgpListBtn = document.getElementById('tcgpListBtn');
  const cardSellBtnRow = document.getElementById('cardSellBtnRow');
  const cardSellTip = document.getElementById('cardSellTip');
  // 2026-08-15: TCGplayer doesn't sell sports cards — sending sports users
  // there returned unrelated Grand Archive results (see IMG_3717). For sports,
  // hide TCGplayer button, widen eBay button to full width, and swap the tip.
  const isSportsCard = card && card.game === 'sports';
  // _clearCardDerivedSurfaces() disables both list buttons on every card swap
  // so a stale href cannot list the wrong card. This card is real and about to
  // get correct hrefs, so undo that neutralisation here -- otherwise the
  // buttons stay dimmed and unclickable for the rest of the session.
  for (const _b of [ebayListBtn, tcgpListBtn]) {
    if (_b) { _b.removeAttribute('aria-disabled'); _b.style.pointerEvents = ''; _b.style.opacity = ''; }
  }
  if (ebayListBtn) {
    ebayListBtn.href = buildEbaySearchUrl(card.name, card.number);
    // resetCardPanel() sets this to display:none. Clear the inline style so the
    // button is visible again when the next card loads — without this fix, the
    // Sell on eBay button disappears for every card after the first one you
    // clear/return to (reported 2026-08-15 on MTG cards from bulk-scan flow).
    ebayListBtn.style.display = '';
  }
  if (tcgpListBtn) {
    if (isSportsCard) {
      // Hide TCGplayer for sports — they don't have the inventory.
      tcgpListBtn.style.display = 'none';
    } else {
      tcgpListBtn.style.display = '';
      // Set a search-based URL immediately so the button never lands anywhere
      // broken; then upgrade to the exact product page (where the 'Sell Yours'
      // CTA is one tap away) if buildTcgpSmart can resolve a product ID.
      tcgpListBtn.href = (typeof buildTcgpUrl === 'function')
        ? buildTcgpUrl(card.name || '', card.setName || '', card.number || '')
        : `https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(card.name || '')}&view=grid`;
      if (typeof buildTcgpSmart === 'function') {
        try {
          // 2026-08-22 [F3]: capture the card generation this async lookup is
          // for; if the user switches cards before it resolves, discard the
          // result instead of overwriting the newer card's button.
          const _tcgpGenSnap = _myImgGen;
          Promise.resolve(buildTcgpSmart(card)).then(function(u) {
            if (_tcgpGenSnap !== window._imgGen) return; // stale — user moved on
            if (u && typeof u === 'string') tcgpListBtn.href = u;
          }).catch(function(){});
        } catch(e) {}
      }
    }
  }
  if (cardSellBtnRow) {
    cardSellBtnRow.style.display = 'grid';
    // Widen eBay to full width when TCG is hidden for sports.
    cardSellBtnRow.style.gridTemplateColumns = isSportsCard ? '1fr' : '1fr 1fr';
  }
  if (cardSellTip) {
    cardSellTip.style.display = 'block';
    cardSellTip.innerHTML = isSportsCard
      ? '\ud83d\udca1 On eBay tap any sold listing \u2192 <strong>\u201cSell one like this\u201d</strong> to auto-fill your listing'
      : '\ud83d\udca1 On eBay tap any sold listing \u2192 <strong>\u201cSell one like this\u201d</strong> \u00b7 On TCGplayer tap <strong>\u201cSell Yours\u201d</strong>';
  }

  // Update platform sell/buy links (skip auto-recalc — loadCardUI handles calc below)
  updateSellLinks._skipRecalc = true;
  updateSellLinks(card);
  updateSellLinks._skipRecalc = false;

  // Build printing dropdown from priceVariants
  currentPrices = {};
  printSelect.innerHTML = '';

  const variants = card.priceVariants || [];
  if (!variants.length) {
    printSelect.innerHTML = '<option value="">Loading price…</option>';
    // Live TCGPlayer price fetch for new sets with no embedded price data
    if (card.game === 'pokemon' && card.name && card.setName) {
      const _liveCard = card;
      (async () => {
        try {
          const p = new URLSearchParams({ name: _liveCard.name, set: _liveCard.setName });
          if (_liveCard.number) p.set('number', _liveCard.number);
          const r = await fetch('/api/tcg-price?' + p.toString());
          if (!r.ok) throw new Error('status ' + r.status);
          const d = await r.json();
          // Only apply if this card is still selected
          if (selectedCard?.name !== _liveCard.name || selectedCard?.setName !== _liveCard.setName) return;
          printSelect.innerHTML = '';
          currentPrices = {};
          if (d.market && d.market > 0) {
            const liveVariant = { key: 'tcgplayer_live', label: 'TCGPlayer Live', market: d.market, low: d.low || null, mid: d.market, high: null };
            currentPrices['tcgplayer_live'] = liveVariant;
            const opt = document.createElement('option');
            opt.value = 'tcgplayer_live';
            opt.textContent = `TCGPlayer Live — $${d.market.toFixed(2)}`;
            printSelect.appendChild(opt);
            printSelect.value = 'tcgplayer_live';
            updatePriceFromPrinting();
            calc();
          } else {
            printSelect.innerHTML = '<option value="">No price data</option>';
          }
        } catch(e) {
          printSelect.innerHTML = '<option value="">No price data</option>';
        }
      })();
    } else {
      printSelect.innerHTML = '<option value="">No price data</option>';
    }
  } else {
    // Keep ALL variants in currentPrices (graded lookup still uses them via
    // syncGradeToPrintSelect), but ONLY render raw/printing entries in the
    // dropdown UI. Graded slabs live in the grade dropdown below the grader
    // pills — mixing them here was confusing (PSA 7, CGC 8.5 next to
    // Holofoil, Reverse Holo, etc.).
    variants.forEach(v => {
      currentPrices[v.key] = v;
      if (isGradedVariant(v.key)) return; // hide graded from Printing/Variant dropdown
      const opt = document.createElement('option');
      opt.value = v.key;
      opt.textContent = v.market != null ? `${v.label} — $${v.market.toFixed(2)}` : v.label;
      printSelect.appendChild(opt);
    });
    // Auto-select preferred variant
    const pref = ['holofoil','reverseHolofoil','normal','usd','tcgplayer'];
    let chosen = variants[0].key;
    for (const p of pref) { if (variants.find(v => v.key === p)) { chosen = p; break; } }
    printSelect.value = chosen;
  }

  updatePriceFromPrinting();
  calc();

  // Auto-fetch eBay sold comps (non-blocking, skip sports/JP)
  setTimeout(() => fetchAndApplySoldComps(false), 300);

  // 2026-08-22 [B1]: centralized "open grader after scan" consumption.
  // Previously only two of the five post-scan card-load paths cleared this
  // one-shot flag (fuzzy Pokemon match + TPL fallback), so AI Grading
  // Estimate silently failed after grounded-ID / JP / non-Pokemon / sports
  // routes and could later fire on an unrelated scan. Consume once here
  // regardless of which loader ran.
  try {
    if (window._openGradeAfterScan) {
      window._openGradeAfterScan = false;
      setTimeout(() => {
        try {
          const cardHero = document.getElementById('cardHero');
          if (cardHero) cardHero.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch(_){}
        if (typeof openGradeScanGate === 'function') {
          try { openGradeScanGate(); } catch(e) { console.warn('[openGradeAfterScan]', e); }
        }
      }, 500);
    }
  } catch(_){}
}

function resetCardPanel() {
  const _colBtn2 = document.getElementById('addCollectionBtn');
  if (_colBtn2) _colBtn2.style.display = 'none';
  cardImg.src = '';
  cardImgWrap.style.display = 'none';
  cardImgPh.style.display = 'flex';
  // 2026-08-15: reset placeholder label back to empty-state copy.
  const _lab = document.getElementById('cardImgPhLabel');
  if (_lab) _lab.textContent = 'No card selected';
  sportsCardPh.style.display = 'none';
  cardNameBlock.style.display = 'none';
  const ebayListBtn = document.getElementById('ebayListBtn');
  if (ebayListBtn) ebayListBtn.style.display = 'none';
  const cardSellBtnRow = document.getElementById('cardSellBtnRow');
  if (cardSellBtnRow) cardSellBtnRow.style.display = 'none';
  const cardSellTip = document.getElementById('cardSellTip');
  if (cardSellTip) cardSellTip.style.display = 'none';
  const sellLinksBlock = document.getElementById('sellLinksBlock');
  if (sellLinksBlock) sellLinksBlock.style.display = 'none';
  window._platSellUrls = null; // Clear sell URLs so cards won't be clickable until a card is loaded
  priceMain.textContent = '—';
  priceMain.style.color = 'var(--text-faint)';
  priceRange.textContent = '';
  priceSource.textContent = '';
  jpLinksPanel.style.display = 'none';
  const gcb = document.getElementById('gradedCompsBanner');
  if (gcb) gcb.style.display = 'none';
  window._crPCLadder = null;
  currentPrices = {};
  printSelect.innerHTML = '<option value="">— select —</option>';
  showIntro();
}

// ── Variant name formatter ──
function formatVariantName(v) {
  return v
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

// ── Update price display from current printing selection ──
// ── Quick Pricing ────────────────────────────────────────────────────────
//
// Three anchor prices derived from the TCGplayer ask book, plus the last-sale
// figure, plus the cheapest active listing. The point of the widget is that a
// seller picks a NUMBER and immediately sees the payout it produces, without
// doing the fee arithmetic in their head.
//
// The honest-labelling problem this had to solve:
//
// StockX can say "Sell Faster" because it holds the order book and knows the
// bid side. We do not have a bid side, and no marketplace we price against
// publishes time-to-sell. So a tier called "Sell Faster" would be a promise we
// cannot keep. Each tier here is named for WHERE THE PRICE SITS in the ask
// book, which is a fact we can point at:
//
//   Sell Now     lowest active ask - $0.01   (your copy becomes the cheapest)
//   Market       TCGplayer market price      (from completed sales)
//   Top of Book  median active ask           (you queue behind cheaper copies)
//
// A tier is only rendered when its underlying number exists. Three tiers on a
// card with one data point would be three restatements of the same figure
// wearing different hats.
window._qpSelected = null;   // which tier the user picked, so re-renders keep it

function _qpBasis() {
  // 2026-09-03: graded slabs FIRST, before the _crBasis shortcut below.
  //
  // Bug this fixes (reported with a screenshot): select PSA 10 on a card and
  // the headline correctly repaints to the graded guide value ($161.25 on
  // Cresselia #71), but Quick Pricing underneath kept showing $23.44 / $26.49
  // / $29.14 and the position bar stayed pinned to the raw book. Those are the
  // RAW TCGplayer numbers. `window._crBasis` holds the raw ladder basis, and
  // this function returned it unconditionally, so every graded selection
  // rendered a raw strategy widget under a graded headline -- two different
  // cards' economics stacked in one panel.
  //
  // renderQuickPricing() was firing correctly the whole time (calc() calls it,
  // and the graded tail of updatePriceFromPrinting() calls calc()). The render
  // was never the problem; the basis it read was.
  const _gk = (typeof printSelect !== 'undefined' && printSelect) ? printSelect.value : '';
  if (typeof isGradedVariant === 'function' && isGradedVariant(_gk)) {
    const gp = (typeof currentPrices !== 'undefined' && currentPrices) ? currentPrices[_gk] : null;
    if (!gp || !(Number(gp.market) > 0)) return null;
    // A slab is a single guide value: PriceCharting publishes one number per
    // grade, so low == mid == market. _qpTiers() will therefore emit exactly
    // one tier and renderQuickPricing() hides the panel -- which is the honest
    // outcome. "Sell Now" and "Top of Book" describe positions in an active
    // listing book; there is no such book behind a graded guide value, and
    // inventing a spread around it would be a fabricated strategy.
    return {
      market: Number(gp.market),
      low:  Number(gp.low) > 0 ? Number(gp.low) : null,
      mid:  Number(gp.mid) > 0 ? Number(gp.mid) : null,
      label: gp.label || '',
      graded: true,
    };
  }

  // Prefer the basis the payout ladder is actually computed from, so the
  // widget can never disagree with the rows underneath it.
  const b = window._crBasis;
  if (b && Number.isFinite(Number(b.value)) && Number(b.value) > 0) {
    return {
      market: Number(b.value),
      low:  Number.isFinite(Number(b.low))  && Number(b.low)  > 0 ? Number(b.low)  : null,
      mid:  Number.isFinite(Number(b.mid))  && Number(b.mid)  > 0 ? Number(b.mid)  : null,
      label: b.label || '',
    };
  }
  // Fall back to the selected printing's own numbers.
  const p = (typeof currentPrices !== 'undefined' && currentPrices)
    ? currentPrices[document.getElementById('printingSelect')?.value] : null;
  if (p && Number.isFinite(Number(p.market)) && Number(p.market) > 0) {
    return {
      market: Number(p.market),
      low:  Number.isFinite(Number(p.low)) && Number(p.low) > 0 ? Number(p.low) : null,
      mid:  Number.isFinite(Number(p.mid)) && Number(p.mid) > 0 ? Number(p.mid) : null,
      label: (selectedCard && selectedCard.source) || '',
    };
  }
  return null;
}

// Derived strategy band for a slab.
//
// A graded card has no listing book we can read: PriceCharting publishes ONE
// guide value per grade, and api/ebay-sold.js -- which would give a genuine
// measured spread -- returns 403 from production. So there is no observed low
// or high to position an ask between.
//
// Rather than show nothing, we derive a band from the comp: -15% is what you
// give up to sell immediately, +15% is what patience is worth. These are NOT
// measured market values and must never be presented as if they were. The
// caption says so, the ids are prefixed `d`, and the payout rows stay hidden
// because those imply a real book. If a measured spread ever becomes
// available, this function should be deleted, not tuned.
const _QP_DERIVED_SPREAD = 0.15;
function _qpDerivedBand(basis) {
  if (!basis) return null;
  // Condition scales the SOURCE basis, always. The old gate here was
  // `_ovAutoFilled !== false ? getCondMultiplier() : 1`, which dropped the
  // multiplier to 1 the moment the user clicked a tile -- so on a Moderately
  // Played card the whole band snapped back to Near-Mint values underneath the
  // price they had just chosen. _crBasis.value is a feed number (bestPrice),
  // never the user's typed price, so there is nothing here to double-apply.
  // _ovAutoFilled belongs only in getEffectivePrice(), which is what protects
  // a user-typed price from being re-multiplied. getCondMultiplier() already
  // returns 1.0 for graded slabs, so slabs stay unscaled.
  const condMult = (typeof getCondMultiplier === 'function') ? getCondMultiplier() : 1;
  const comp = (basis.market != null && isFinite(basis.market) && basis.market > 0)
    ? basis.market * condMult : null;
  if (comp == null) return null;
  // Applies to raw cards too, as of 2026-09-04. The measured alternative was
  // NOT a better spread: basis.low/mid are ACTIVE LISTING asks across ALL
  // conditions, so "Sell Now" undercut the cheapest ask on the page -- which
  // on a Base Set Charizard was a $125 heavily-played copy. That produced
  // huge, wrong-direction gaps: a fast-sale price anchored to a beat-up card
  // while the comp described a Near Mint one. A symmetric band around the
  // comp is an estimate and says so, but it never quotes a different card's
  // condition back at the seller.
  const r = (v) => Math.round(v * 100) / 100;
  const s = _QP_DERIVED_SPREAD;
  return [
    { id:'dnow',    amt: r(comp * (1 - s)), label:'Sell Now',
      hint:`estimated — ${Math.round(s*100)}% under comp for a fast sale`, derived:true },
    { id:'dmarket', amt: r(comp),           label:'Comp',
      hint: basis.graded ? 'PriceCharting guide value for this grade'
                         : 'recent completed sales', derived:true },
    { id:'dpatient',amt: r(comp * (1 + s)), label:'Patient',
      hint:`estimated — +${Math.round(s*100)}% if you can wait`, derived:true },
  ];
}

// Restrict the Grading Monitor's "Final Grade Received" list to grades the
// SELECTED grader actually issues. The markup ships one static option list, so
// before this you could record a PSA 9.5 -- a slab that cannot exist, since
// PSA's half grades stop at 8.5 and the 9 -> 10 jump is undivided. Recording
// one poisons the ROI math, because the payout it gets compared against is
// PriceCharting's generic "Grade 9.5" column, which is a BGS/CGC number.
//
// Options are HIDDEN, never deleted, and `keepVal` pins a legacy value so
// reopening an old record cannot silently blank a grade the user really typed.
function _gmSyncGrades(keepVal) {
  const grader = (document.getElementById('gmGradeGrader')?.value || 'PSA').toLowerCase();
  const sel    = document.getElementById('gmGrade');
  if (!sel) return;
  const scale = (typeof GRADE_SCALES !== 'undefined') ? GRADE_SCALES[grader] : null;
  if (!scale) return;
  const allowed = new Set(scale.map(g => String(g.v)));
  [...sel.options].forEach(o => {
    if (!o.value) return;                       // the "— select —" placeholder
    const ok = allowed.has(o.value) || (keepVal && o.value === keepVal);
    o.hidden = !ok;
    o.disabled = !ok;
  });
  // If the grader change just invalidated the current selection, clear it
  // rather than leaving a hidden-but-selected impossible grade in place.
  const cur = sel.selectedOptions[0];
  if (cur && cur.value && cur.hidden) sel.value = '';
}

function _qpTiers(basis) {
  // Condition scales the SOURCE basis, always. The old gate here was
  // `_ovAutoFilled !== false ? getCondMultiplier() : 1`, which dropped the
  // multiplier to 1 the moment the user clicked a tile -- so on a Moderately
  // Played card the whole band snapped back to Near-Mint values underneath the
  // price they had just chosen. _crBasis.value is a feed number (bestPrice),
  // never the user's typed price, so there is nothing here to double-apply.
  // _ovAutoFilled belongs only in getEffectivePrice(), which is what protects
  // a user-typed price from being re-multiplied. getCondMultiplier() already
  // returns 1.0 for graded slabs, so slabs stay unscaled.
  const condMult = (typeof getCondMultiplier === 'function') ? getCondMultiplier() : 1;
  const adj = (v) => v == null ? null : Math.round(v * condMult * 100) / 100;

  const market = adj(basis.market);
  const low    = adj(basis.low);
  const mid    = adj(basis.mid);

  // Owner directive 2026-09-04: use the derived band for EVERY card, not just
  // slabs. See _qpDerivedBand for why the "measured" path below was worse than
  // an honest estimate. The old logic stays as a fallback for the case the band
  // cannot cover at all -- no comp to build a band around.
  const _band = _qpDerivedBand(basis);
  if (_band) return _band;

  const tiers = [];
  // Undercut the cheapest ask. Only meaningful when the low ask is actually
  // below market -- if low >= market the book is thin and "undercut" would
  // mean asking MORE than the last sale, which is not a fast sale.
  //
  // The undercut has to be visible at the precision we DISPLAY, or the tier
  // lies by rounding. Caught in QA on Umbreon VMAX: low ask $2450.00, a $0.01
  // undercut is $2449.99, and since we drop cents above $100 the button read
  // "Sell Now $2,450" directly above a "Lowest listing $2,450" row -- two
  // different numbers rendered identically. So the step scales with the
  // displayed precision: cents under $100 (where cents are shown), whole
  // dollars above it (where they are not).
  if (low != null && market != null && low < market) {
    const step = low < 100 ? 0.01 : 1;
    tiers.push({ id:'now', amt: Math.max(0.01, Math.round((low - step) * 100) / 100),
                 label:'Sell Now', hint:'undercuts the cheapest listing' });
  }
  if (market != null) {
    tiers.push({ id:'market', amt: market, label:'Market', hint:'recent completed sales' });
  }
  // Top of book only earns a slot when it is meaningfully above market.
  if (mid != null && market != null && mid > market * 1.02) {
    tiers.push({ id:'book', amt: mid, label:'Top of Book', hint:'median active listing' });
  }
  return tiers;
}

// ── Grade ladder ───────────────────────────────────────────────────────────
// The position bar above answers "where does my ask sit in the active listing
// book". A graded slab has no listing book -- PriceCharting publishes one
// guide value per grade -- so that bar genuinely cannot be drawn, and the old
// behaviour was to hide it. But the bar vanishing on every PSA selection reads
// as a broken widget, and there IS a real spread to show: the grade ladder
// itself. Raw $366 -> PSA 9 $3,137 -> PSA 10 $13,156 on a Base Set Charizard
// are all published, all for the same card, all from the same source.
//
// Rules this obeys, so the bar never implies more than the data supports:
//   * One source. Every point comes from the SAME PriceCharting response.
//     No TCGplayer raw price is spliced in as the floor, because a
//     completed-sales price and a blended guide value are different
//     measurements and the step between them would not be a grading step.
//   * One grader. Selecting BGS 10 builds raw -> BGS 10, not the PSA ladder,
//     so we never imply a BGS 9 value PriceCharting does not publish.
//   * Published points only. Grades absent from the feed are absent from the
//     bar; nothing is interpolated between them.
//   * It is a VALUE axis, not a probability. It shows what each grade is
//     worth, and says nothing about the odds of achieving that grade -- that
//     is the grade-upside question that stays withdrawn for want of licensed
//     population data.
const _QP_LADDER_PSA = [
  { pc: 'raw',      label: 'Raw'      },
  // NOT "PSA 7/8/9". PriceCharting documents these fields as "Graded 7 or 7.5
  // / 8 or 8.5 / 9 by a grading company" -- grader-agnostic, and 7 and 8 are
  // each two grades blended into one number. Only manual-only-price is
  // PSA-specific ("Graded 10 by PSA grading service"). Same mislabel class as
  // the 9.5: we were stamping one grader's name on every grader's data.
  { pc: 'grade_7',  label: 'Grade 7'  },
  { pc: 'grade_8',  label: 'Grade 8'  },
  { pc: 'grade_9',  label: 'Grade 9'  },
  // No 9.5 rung. PSA does not issue one, so PriceCharting's generic "Grade
  // 9.5" column is a BGS/CGC number -- putting it between PSA 9 and PSA 10
  // mixes two graders' scales on one axis and invents an intermediate step
  // that a PSA submission can never land on. Renaming it "Grade 9.5" was not
  // enough: the row still read as a rung on the PSA ladder.
  { pc: 'psa_10',   label: 'PSA 10'   },
];
// The 9.5 rung, for the graders that actually issue one.
const _QP_LADDER_95 = { pc: 'grade_95', label: 'Grade 9.5' };
// Graders PriceCharting publishes only a single 10 for. The ladder is then
// raw -> that 10, which is a two-point axis but still a real one.
const _QP_LADDER_SOLO = {
  bgs_10: { pc: 'bgs_10', label: 'BGS 10' },
  cgc_10: { pc: 'cgc_10', label: 'CGC 10' },
  sgc_10: { pc: 'sgc_10', label: 'SGC 10' },
};
// variant key -> the PriceCharting field it was sourced from.
const _QP_KEY_TO_PC = {
  psa_7: 'grade_7', psa_8: 'grade_8', psa_9: 'grade_9',
  psa_9_5: 'grade_95', psa_10: 'psa_10',
  bgs_10: 'bgs_10', cgc_10: 'cgc_10', sgc_10: 'sgc_10',
};
// The inverse: PriceCharting field -> internal variant key.
const _QP_PC_TO_KEY = Object.fromEntries(
  Object.entries(_QP_KEY_TO_PC).map(([k, v]) => [v, k])
);

// CANONICAL grader+grade -> PriceCharting field mapping. Single source of
// truth: _pcKeyForGrade (portfolio refresh) and _pcVariantKeyForGrade (card
// page) both delegate here so the two surfaces can never drift apart.
//
// PriceCharting publishes ONE grader-agnostic column for 7/8/9/9.5 and
// separate columns only for the 10s. Returning null means "PriceCharting
// publishes nothing for this pair" — callers must then keep the saved value
// or say so, and must NEVER substitute a neighbouring grade.
function _pcGradeFieldFor(grader, grade) {
  const g = String(grader || '').toLowerCase().trim();
  const n = String(grade   || '').trim();
  if (!g || !n) return null;
  if (n === '10') {
    // ACE and TAG 10s have no PriceCharting field at all.
    return ({ psa: 'psa_10', bgs: 'bgs_10', cgc: 'cgc_10', sgc: 'sgc_10' })[g] || null;
  }
  if (n === '9.5') {
    // One grader-agnostic 9.5 column. PSA does not issue a 9.5.
    return /^(bgs|cgc|sgc)$/.test(g) ? 'grade_95' : null;
  }
  if (n === '9')                 return 'grade_9';
  if (n === '8' || n === '8.5')  return 'grade_8';
  if (n === '7' || n === '7.5')  return 'grade_7';
  return null; // 6.5 and below: PriceCharting publishes nothing.
}

// Card-page form: the internal currentPrices/printSelect variant key.
// 2026-09-04: replaces a same-grader `startsWith(grader + '_')` fallback that
// silently resolved e.g. BGS 9 -> bgs_10, rendering Base Set Charizard's
// $17,103.00 ten in place of the $3,136.61 grade-9 guide value.
function _pcVariantKeyForGrade(grader, grade) {
  const field = _pcGradeFieldFor(grader, grade);
  return field ? (_QP_PC_TO_KEY[field] || null) : null;
}

function _qpGradeLadder(selKey) {
  const L = window._crPCLadder;
  if (!L || !L.prices) return null;
  // Identity guard: an in-flight PriceCharting response for the previous card
  // must never paint a ladder onto the card now on screen.
  if (selectedCard && L.forName && L.forName !== selectedCard.name) return null;
  if (selectedCard && L.forSet  && L.forSet  !== selectedCard.setName) return null;

  const selPc = _QP_KEY_TO_PC[selKey];
  if (!selPc) return null;

  // BGS/CGC/SGC issue a 9.5, so their ladder gets the rung PSA's cannot have.
  // Selecting the 9.5 variant itself yields a raw -> 9.5 axis rather than
  // splicing it into the PSA scale.
  const scale = _QP_LADDER_SOLO[selKey]
    ? [_QP_LADDER_PSA[0], _QP_LADDER_95, _QP_LADDER_SOLO[selKey]]
    : (selKey === 'psa_9_5'
        ? [_QP_LADDER_PSA[0], _QP_LADDER_95]
        : _QP_LADDER_PSA);

  const num = (v) => (v != null && isFinite(v) && Number(v) > 0) ? Number(v) : null;
  const points = scale
    .map(s => ({ label: s.label, amt: num(L.prices[s.pc]), pc: s.pc }))
    .filter(p => p.amt != null);

  // A single point cannot be positioned against anything.
  if (points.length < 2) return null;
  if (!points.some(p => p.pc === selPc)) return null;

  return {
    points,
    selPc,
    url: L.url,
    cacheAgeSec: L.cacheAgeSec,
    // Ladders normally rise with grade, but the feed is the authority: if a
    // published value breaks monotonicity we show it as published rather than
    // reordering or hiding it. Sorting would misrepresent which grade is which.
    monotonic: points.every((p, i) => i === 0 || p.amt >= points[i - 1].amt),
  };
}

function _qpRenderLadder(ladder, hostEl) {
  const fmt = (n) => '$' + Number(n).toLocaleString('en-US',
    { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 });
  const pts = ladder.points;
  const lo = pts[0].amt;
  const hi = pts[pts.length - 1].amt;
  const span = Math.max(hi - lo, 1e-9);
  // Linear on value. A log axis would space the grades more evenly and look
  // tidier, but it would visually shrink exactly the jump that matters most
  // (PSA 9 -> PSA 10 is often the majority of the whole range) and overstate
  // the small ones. The bunching at the low end is the honest shape of the
  // data: on vintage cards most of the value really is in the top grade.
  // Inset the usable track so the first and last tick sit fully inside the bar
  // instead of being sliced in half by the rounded ends. PAD is in percent and
  // must clear half the marker width (13px / ~340px track) at phone widths.
  const PAD = 3.2;
  const pct = (v) => PAD + (Math.max(0, Math.min(1, (v - lo) / span)) * (100 - 2 * PAD));

  const ticks = pts.map(p => {
    const on = p.pc === ladder.selPc;
    return `<div class="qp-lad-tick${on ? ' is-sel' : ''}" style="left:${pct(p.amt)}%"
      title="${_qpEsc(p.label)} — ${_qpEsc(fmt(p.amt))}"></div>`;
  }).join('');

  const sel = pts.find(p => p.pc === ladder.selPc);
  const marker = `<div class="qp-lad-marker" style="left:${pct(sel.amt)}%"
    title="${_qpEsc(sel.label)} — ${_qpEsc(fmt(sel.amt))}"></div>`;

  // Endpoint labels only. Labelling all six collides badly on a phone, and the
  // per-grade values are listed in the rows underneath anyway.
  const ends = `<div class="qp-lad-ends">
      <span>${_qpEsc(pts[0].label)} ${_qpEsc(fmt(lo))}</span>
      <span>${_qpEsc(pts[pts.length - 1].label)} ${_qpEsc(fmt(hi))}</span>
    </div>`;

  const rows = pts.map(p => {
    const on = p.pc === ladder.selPc;
    return `<div class="qp-row${on ? ' is-sel' : ''}">
      <span class="qp-row-k">${_qpEsc(p.label)}${on ? ' <em>selected</em>' : ''}</span>
      <span class="qp-row-dots"></span>
      <span class="qp-row-v">${_qpEsc(fmt(p.amt))}</span>
    </div>`;
  }).join('');

  const src = ladder.url
    ? `<a href="${_qpEsc(ladder.url)}" target="_blank" rel="noopener noreferrer" class="qp-lad-src">PriceCharting guide values ↗</a>`
    : 'PriceCharting guide values';

  // 2026-09-04: the ladder carried a source link but no retrieval age, so the
  // grade values were the one place on the page you could not tell how old a
  // number was. Same freshness contract as the main price row -- when we
  // fetched it, plus the explicit marker that PriceCharting publishes no
  // as-of date. Reuses _ageStr / _PC_NO_ASOF_TIP rather than a second format.
  const age = (typeof ladder.cacheAgeSec === 'number' && isFinite(ladder.cacheAgeSec))
    ? ` <span class="qp-lad-age">· retrieved ${_qpEsc(_ageStr(ladder.cacheAgeSec))}</span>`
    : '';
  const noAsOf = ` <span class="qp-lad-age trust-info" title="${_PC_NO_ASOF_TIP}" style="cursor:help">no price date \u24d8</span>`;

  const warn = ladder.monotonic ? '' :
    `<p class="qp-lad-warn">One published value is lower than the grade below it. Shown as published — not reordered.</p>`;

  hostEl.innerHTML =
    `<div class="qp-lad-wrap">
       <div class="qp-lad-title">Value by grade</div>
       <div class="qp-lad-bar">${ticks}${marker}</div>
       ${ends}
     </div>
     <div class="qp-rows qp-lad-rows">${rows}</div>
     <p class="qp-lad-foot">${src}${age}${noAsOf}. These are what each grade is worth — not the
       odds of receiving it. Grading outcome is not predicted here.</p>
     ${warn}`;
}

function renderQuickPricing() {
  const host = document.getElementById('quickPricing');
  if (!host) return;
  const basis = _qpBasis();
  let tiers = basis ? _qpTiers(basis) : [];
  // Set when the graded branch substitutes a derived band. The shared renderer
  // below then must NOT tear down the grade ladder or re-hide the caption that
  // discloses the band is estimated.
  let _bandActive = false;

  const note    = document.getElementById('qpGradedNote');
  const barWrap = document.getElementById('qpBarWrap');
  const tiersEl = document.getElementById('qpTiers');
  const rowsEl  = document.getElementById('qpRows');
  const showStrategy = (on) => {
    if (barWrap) barWrap.style.display = on ? '' : 'none';
    if (tiersEl) tiersEl.style.display = on ? '' : 'none';
    if (rowsEl)  rowsEl.style.display  = on ? '' : 'none';
    if (note)    note.style.display    = on ? 'none' : '';
    // The Info panel defines Sell Now / Market / Top of Book. With the tiers
    // hidden there is nothing for it to define, so hide the button too and
    // collapse the panel if the user had left it open.
    const infoBtn = host.querySelector('.qp-info');
    const infoPnl = document.getElementById('qpInfo');
    if (infoBtn) infoBtn.style.display = on ? '' : 'none';
    if (!on && infoPnl) {
      infoPnl.style.display = 'none';
      if (infoBtn) infoBtn.setAttribute('aria-expanded', 'false');
    }
  };

  // 2026-09-03: a graded slab has ONE number per grade -- PriceCharting
  // publishes a single guide value, so low == mid == market and there is no
  // active listing book to position against. Previously this function read
  // the raw ladder basis regardless of the grade selector, so selecting PSA 10
  // left the raw Sell Now / Market / Top of Book tiers and the raw position
  // bar sitting under a graded headline. Now _qpBasis() returns the graded
  // row, which collapses to a single tier -- and rather than making the whole
  // panel vanish (which reads as a glitch), we keep the heading and say why
  // there is no strategy to choose from.
  // Graded selections always take this branch. It used to be gated on the
  // tiers collapsing to fewer than two, which was true only while a slab had
  // no band to show; now _qpTiers returns three derived tiers for a slab too,
  // so that gate would skip the branch and the grade ladder would never draw.
  if (basis && basis.graded) {
    host.style.display = '';
    showStrategy(false);

    // 2026-09-03: the strategy bar still cannot be drawn for a slab -- there is
    // no listing book to position an ask inside. But hiding everything made the
    // whole widget disappear the moment a user checked a PSA grade, which reads
    // as a bug. Replace it with the one real spread a slab does have: the grade
    // ladder. Same card, same source, published values only.
    const _selKey = (typeof printSelect !== 'undefined' && printSelect) ? printSelect.value : '';
    const _ladder = _qpGradeLadder(_selKey);
    const _ladHost = document.getElementById('qpLadder');
    let _drewLadder = false;
    if (_ladder && _ladHost) {
      _qpRenderLadder(_ladder, _ladHost);
      _ladHost.style.display = '';
      _drewLadder = true;
    } else if (_ladHost) {
      _ladHost.style.display = 'none'; _ladHost.innerHTML = '';
    }

    // A slab has no listing book, but the seller still has to pick a number.
    // Derive a band off the comp and label it as derived. The payout rows stay
    // hidden: they describe undercutting a real book, which does not exist here.
    const _band = _qpDerivedBand(basis);
    if (_band) {
      tiers = _band;
      _bandActive = true;
      showStrategy(true);
      if (rowsEl) rowsEl.style.display = 'none';
      if (note) {
        note.style.display = '';
        note.textContent = 'Estimated band. A slab has one published guide value per '
          + 'grade and no listing book, so Sell Now and Patient are calculated as '
          + String(Math.round(_QP_DERIVED_SPREAD * 100)) + '% either side of the comp — '
          + 'not observed sales. Check recent completed sales before you list.';
      }
    } else {
      if (note) note.style.display = _drewLadder ? 'none' : '';
      if (_drewLadder) return;
    }
    if (!_band) {
      // No ladder and no comp to derive from. Fall back to saying why.
      if (note) {
        note.textContent = 'Graded slabs price off a single guide value per grade, '
          + 'so there is no cheapest-listing spread to undercut. The payout rows below '
          + 'are calculated from that value.';
      }
      return;
    }
    // Band is active -- fall through to the shared tier renderer below.
  }

  // Leaving the graded branch: tear the ladder down so it cannot linger over a
  // raw selection, where its grade axis would be describing a different thing
  // from the strategy bar directly above it. When a derived band is active we
  // are still ON a slab, so the ladder stays.
  // Raw cards now run on the same derived band. Flag it so the disclosure
  // caption stays up and the payout rows stay down -- those rows read
  // "Lowest listing", and Sell Now is no longer derived from that listing, so
  // showing them side by side would imply a link that no longer exists.
  if (basis && !basis.graded && tiers.some(t => t && t.derived)) {
    _bandActive = true;
    if (note) {
      note.style.display = '';
      note.textContent = 'Estimated band. Comp is the displayed source value; Sell Now and '
        + 'Patient are calculated as '
        + String(Math.round(_QP_DERIVED_SPREAD * 100)) + '% either side of it — not '
        + 'observed sales. Active listings are skipped on purpose: they mix every '
        + 'condition, so the cheapest ask is often a beat-up copy of your card.';
    }
  }

  // Tear the ladder down unless we are on a slab. A derived band alone is no
  // longer a reason to keep it -- raw cards get a band too, and a grade axis
  // over a raw selection describes a different thing from the bar above it.
  if (!(_bandActive && basis && basis.graded)) {
    const _ladHost = document.getElementById('qpLadder');
    if (_ladHost) { _ladHost.style.display = 'none'; _ladHost.innerHTML = ''; }
  }

  // One tier is not a choice -- hide rather than dress up a single number as
  // a pricing strategy.
  if (!basis || tiers.length < 2) { host.style.display = 'none'; return; }
  host.style.display = '';
  showStrategy(true);
  // showStrategy(true) hides the caption, but a derived band REQUIRES its
  // disclosure to stay on screen -- the whole point is that these numbers are
  // estimated. Restore it.
  if (_bandActive && note) note.style.display = '';
  // Same for the payout rows: showStrategy(true) turns them back on, but they
  // read "Lowest listing" / "Market price" off a listing book that does not
  // exist for a slab. Keep them down.
  if (_bandActive && rowsEl) rowsEl.style.display = 'none';

  // Marker uses the same condition-adjusted value the headline and band use.
  // Previously read priceOverride directly, so switching NM->MP left the
  // marker at 100% while the tiles moved to the MP band -- a visible
  // contradiction. When the user typed an explicit price, _ovAutoFilled=false
  // and getEffectivePrice() returns that verbatim, so this stays honest.
  // getEffectivePrice() returns 0 -- not NaN -- when there is no usable price
  // (no override, and currentPrices[printSelect.value].market == null). Zero is
  // finite, so a bare Number() pinned the marker to 0% and deselected every
  // tier, where the old parseFloat produced NaN and correctly fell back to the
  // comp tick. Treat a non-positive price as absent.
  const _eff = (typeof getEffectivePrice === 'function') ? Number(getEffectivePrice()) : NaN;
  const cur = (Number.isFinite(_eff) && _eff > 0)
    ? _eff
    : parseFloat(document.getElementById('priceOverride')?.value);
  const fmt = (n) => '$' + Number(n).toLocaleString('en-US',
    { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 });

  // Tier buttons. Selected = whichever tier matches the current price field.
  document.getElementById('qpTiers').innerHTML = tiers.map(t => {
    const on = Number.isFinite(cur) && Math.abs(cur - t.amt) < 0.015;
    return `<button type="button" class="qp-tier" aria-pressed="${on}"
      title="${_qpEsc(t.hint)}" onclick="qpApply(${t.amt}, '${_qpEsc(t.id)}')">
      <span class="qp-tier-amt">${fmt(t.amt)}</span>
      <span class="qp-tier-label">${_qpEsc(t.label)}</span>
    </button>`;
  }).join('');

  // Gradient bar. Scale runs from the cheapest tier to 1.08x the dearest so
  // the dear end still has red to sit in.
  const amts = tiers.map(t => t.amt);
  const lo = Math.min(...amts), hi = Math.max(...amts) * 1.08;
  const pct = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const mk = document.getElementById('qpBarMarker');
  const tick = document.getElementById('qpBarTick');
  // 'dmarket' is the derived band's comp tier. Matching only 'market' left the
  // comp tick undrawn on every card once the band became universal.
  const mktTier = tiers.find(t => t.id === 'market' || t.id === 'dmarket');
  if (tick) {
    if (mktTier) { tick.style.display=''; tick.style.left = pct(mktTier.amt) + '%'; }
    else tick.style.display='none';
  }
  if (mk) {
    const at = Number.isFinite(cur) ? cur : (mktTier ? mktTier.amt : amts[0]);
    mk.style.left = pct(at) + '%';
    mk.setAttribute('title', fmt(at));
  }

  // Reference rows. Both are real, and both are labelled for what they are.
  // Condition scales the SOURCE basis, always. The old gate here was
  // `_ovAutoFilled !== false ? getCondMultiplier() : 1`, which dropped the
  // multiplier to 1 the moment the user clicked a tile -- so on a Moderately
  // Played card the whole band snapped back to Near-Mint values underneath the
  // price they had just chosen. _crBasis.value is a feed number (bestPrice),
  // never the user's typed price, so there is nothing here to double-apply.
  // _ovAutoFilled belongs only in getEffectivePrice(), which is what protects
  // a user-typed price from being re-multiplied. getCondMultiplier() already
  // returns 1.0 for graded slabs, so slabs stay unscaled.
  const condMult = (typeof getCondMultiplier === 'function') ? getCondMultiplier() : 1;
  const rows = [];
  if (basis.low != null) {
    rows.push(['Lowest listing', fmt(Math.round(basis.low * condMult * 100) / 100), '']);
  }
  if (basis.market != null) {
    rows.push(['Market price', fmt(Math.round(basis.market * condMult * 100) / 100),
               basis.label ? _qpEsc(basis.label) : '']);
  }
  document.getElementById('qpRows').innerHTML = rows.map(([k, v, age]) =>
    `<div class="qp-row"><span class="qp-row-k">${_qpEsc(k)}</span>
     <span class="qp-row-dots"></span>
     <span class="qp-row-v">${v}</span>${age ? `<span class="qp-row-age">${age}</span>` : ''}</div>`
  ).join('');
}

// Applying a tier means the user has chosen a price deliberately, so it is
// treated as a user-typed price (used verbatim, not condition-adjusted again).
function qpApply(amt, tierId) {
  const f = document.getElementById('priceOverride');
  if (!f) return;
  f.value = Number(amt).toFixed(2);
  window._ovAutoFilled = false;
  // Remember WHICH tier was chosen, not just the number it happened to be.
  // A tile click is a choice of strategy ("sell fast", "hold out") and that
  // strategy still means something after the condition changes -- but the
  // dollar amount does not. Without this, picking Comp on a Mod. Played card
  // and then switching to Heavy Play left the $583 MP price sitting in the
  // box while the tiles repainted to the HP band ($343/$404/$464), so the
  // marker pinned to 100% and no tile read as selected. Set BEFORE calc()
  // because the input listener that clears it fires on user typing only.
  window._qpChosenTier = tierId || null;
  calc();
  renderQuickPricing();
}

// Re-apply the user's chosen tier after the condition changes, so a strategy
// choice survives a condition change but a hand-typed price never gets moved.
function _qpReapplyChosenTier() {
  const id = window._qpChosenTier;
  if (!id) return;                       // nothing chosen, or user typed over it
  const f = document.getElementById('priceOverride');
  if (!f) return;
  const basis = (typeof _qpBasis === 'function') ? _qpBasis() : null;
  if (!basis) return;
  const tiers = (typeof _qpTiers === 'function') ? _qpTiers(basis) : null;
  if (!tiers || !tiers.length) return;
  const t = tiers.find(x => x.id === id);
  if (!t || !(Number(t.amt) > 0)) return;
  f.value = Number(t.amt).toFixed(2);
  window._ovAutoFilled = false;
}

function toggleQpInfo() {
  const el = document.getElementById('qpInfo');
  const btn = document.querySelector('.qp-info');
  if (!el) return;
  const open = el.style.display === 'none';
  el.style.display = open ? '' : 'none';
  if (btn) btn.setAttribute('aria-expanded', String(open));
}

function _qpEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// A sports variant option carries a PriceCharting product id but no price yet
// (we deliberately do not price all 71 parallels). Selecting one fetches that
// exact product; everything else keeps the original synchronous path.
function _onPrintingChange() {
  const key = printSelect.value;
  if (key && key.startsWith('sports_pc:')) {
    if (currentPrices[key] && currentPrices[key].market != null) {
      const v = window._spVariants[key];
      window._crBasis = {
        value: currentPrices[key].market, low: null, mid: null, high: null,
        label: `SportsCardsPro guide · ${v ? v.productName : key}`,
      };
      updatePriceFromPrinting(); calc();
      return;
    }
    _priceSportsVariant(key);
    return;
  }
  if (!key && selectedCard && selectedCard.game === 'sports') {
    // Back to the placeholder: retract the number rather than leaving a stale
    // price sitting under "Select the variant…".
    window._crBasis = null; window._ovAutoFilled = false; window._qpChosenTier = null;
    if (priceOverride) priceOverride.value = '';
    _setSportsConfirm({ pending: true, count: Object.keys(window._spVariants || {}).length, card: selectedCard });
    priceMain.textContent = '—';
    priceRange.textContent = '';
    calc();
    return;
  }
  updatePriceFromPrinting(); calc();
}

function updatePriceFromPrinting() {
  const key = printSelect.value;
  // 2026-09-01 (launch gate): when the price ladder produced the number that
  // the payouts are computed from, the headline MUST render from that same
  // number. Otherwise "Market Value" shows one feed (the embedded per-card
  // price) while every payout row is computed from another — verified live as
  // a $489.11 headline sitting above payouts derived from $272.56.
  //
  // This also fixes a second, sneakier bug: the tail of this function rewrote
  // priceSource from selectedCard.source, so merely clicking a condition pill
  // relabelled a PriceCharting-derived number as "TCGPriceLookup · Updated
  // daily". The caption used to drift away from the truth on an unrelated click.
  if (window._crBasis && window._ovAutoFilled && !isGradedVariant(key)) {
    const b = window._crBasis;
    const m = getCondMultiplier();
    priceMain.textContent = `$${(b.value * m).toFixed(2)}`;
    priceMain.style.color = 'var(--text)';
    priceRange.textContent = _rangeParts(b.low, b.mid, b.high, m).join(' · ');
    _renderPriceCaption(priceSource, {
      label: b.label, url: b.sourceUrl,
      cacheAgeSec: b.cacheAgeSec, datedBySource: b.datedBySource,
    });
    calc();
    try { renderQuickPricing(); } catch(_) {}
    return;
  }
  const p = currentPrices[key];

  if (!p || p.market == null) {
    priceMain.textContent = '—';
    priceMain.style.color = 'var(--text-faint)';
    priceRange.textContent = p ? 'No price data for this variant' : '';
    priceSource.textContent = '';
    try { renderQuickPricing(); } catch(_) {}
    return;
  }

  const condMult = isGradedVariant(key) ? 1.0 : getCondMultiplier();
  const adjusted = p.market * condMult;
  priceMain.textContent = `$${adjusted.toFixed(2)}`;
  priceMain.style.color = 'var(--text)';

  // 2026-08-30: clamp outlandish high before display (see _clampHigh comment)
  const clamped = (typeof _clampHigh === 'function') ? _clampHigh(p) : p;
  priceRange.textContent =
    _rangeParts(clamped.low, clamped.mid, clamped.high, condMult).join(' · ');

  // Scryfall's "Updated daily" is a verified claim, not a guess: their FAQ
  // states "Scryfall syncs prices from each of our affiliates every 24 hours."
  // https://scryfall.com/docs/faqs/where-do-scryfall-prices-come-from-7
  // Every other cadence claim in this map was removed 2026-09-03 because no
  // equivalent published statement backs it.
  const srcMap = { TCGPlayer: 'TCGPlayer market', Scryfall: 'Scryfall · Updated daily', YGOProDeck: 'YGOProDeck · TCGPlayer data', Manual: 'Manual entry', 'eBay JP Comps': 'eBay JP sold listings', 'TCGPlayer (EN)': 'TCGPlayer market (EN version)', TCGPriceLookup: 'TCGPriceLookup', pricecharting: 'PriceCharting guide value', sportscardspro: 'PriceCharting guide value' };
  // 2026-09-03: caption the row we actually rendered, not the card's search
  // feed. Screenshot showed a PSA 10 headline of $161.25 -- a PriceCharting
  // graded guide value -- stamped "TCGPlayer market · Updated 2026/09/03".
  // The number was right and the attribution was wrong, which is the one
  // combination a pricing tool cannot ship: it tells the user to go verify
  // $161.25 on TCGplayer, where it does not exist.
  const srcLabel = srcMap[p?.source] || srcMap[selectedCard?.source] || p?.source || selectedCard?.source || '';
  const updatedAt = selectedCard?.updatedAt || '';
  // 2026-08-16: prior version could render "TCGPriceLookup · Updated daily ·
  // Updated daily" when both the label AND updatedAt contained 'daily'. We
  // now strip any trailing 'Updated ...' from the label and only append
  // updatedAt once here.
  const cleanLabel = srcLabel.replace(/\s*·\s*Updated [^·]*$/i, '');
  // 2026-09-03 (P0-D): the old else-branch appended "Updated daily" to any
  // label that did not already mention a date. Nothing verified that cadence.
  // PriceCharting-sourced graded rows -- the PSA 10 numbers, the most
  // consequential figures in the app -- were carrying a daily-refresh promise
  // we have no basis for, on a feed that publishes no as-of date at all.
  // Now: cite the source, date our own retrieval, and say plainly when the
  // source does not date its price.
  _renderPriceCaption(priceSource, {
    label: cleanLabel || srcLabel,
    url: p?.url || null,
    cacheAgeSec: p?.cacheAgeSec ?? null,
    // Only PriceCharting-derived rows are known to be undated. Leave others
    // undefined so they render no claim either way.
    datedBySource: (p?.source === 'pricecharting' || p?.source === 'sportscardspro')
      ? false : (p?.datedBySource === false ? false : undefined),
    updatedAt,
  });

  calc();
  // Belt-and-suspenders: the printing/grade selector is the one control that
  // changes the BASIS rather than a fee input, so guarantee the widget follows
  // it regardless of which branch calc() took.
  try { renderQuickPricing(); } catch(_) {}
}

// ── Condition multipliers ──
function isGradedVariant(key) {
  // All 6 graders — keep in sync with #gradedPills
  return /^(psa|bgs|cgc|sgc|ace|tag)_/.test(key || printSelect.value);
}

function getCondMultiplier() {
  if (isGradedVariant()) return 1.0;  // graded slabs: fixed price, no condition adjustment
  const c = document.querySelector('#condPills .pill.sel')?.dataset.cond || 'nm';
  return { nm: 1.0, lp: 0.85, mp: 0.65, hp: 0.45, dmg: 0.25 }[c] ?? 1.0;
}

function getEffectivePrice() {
  const ov = parseFloat(priceOverride.value);
  if (!isNaN(ov) && ov > 0) {
    // 2026-09-01: a system-filled override is a Near-Mint basis (an eBay sold
    // median or a PriceCharting guide value), so the condition multiplier still
    // applies. Previously this returned early and unadjusted, which meant that
    // once the ladder auto-filled the field, selecting Moderately Played moved
    // the "Market Value" headline but left every payout row unchanged.
    // A price the USER typed is their expected sale price — never adjust it.
    if (window._ovAutoFilled && !isGradedVariant()) return ov * getCondMultiplier();
    return ov;
  }

  const key = printSelect.value;
  const p = currentPrices[key];
  if (!p || p.market == null) return 0;
  // graded slabs: return fixed market price, no condition multiplier
  if (isGradedVariant(key)) return p.market;
  return p.market * getCondMultiplier();
}

// ── Grade UI ──
// Rebuild the printing/variant dropdown from an updated priceVariants array
// Called after a by-ID re-fetch brings in graded data that wasn't in the search result
function rebuildPrintSelect(variants) {
  currentPrices = {};
  printSelect.innerHTML = '';
  if (!variants || !variants.length) {
    printSelect.innerHTML = '<option value="">No price data</option>';
    return;
  }
  variants.forEach(v => {
    currentPrices[v.key] = v;
    if (isGradedVariant(v.key)) return; // hide graded from Printing/Variant dropdown; grader pill + grade dropdown drive graded pricing
    const opt = document.createElement('option');
    opt.value = v.key;
    opt.textContent = v.market != null ? `${v.label} — $${v.market.toFixed(2)}` : v.label;
    printSelect.appendChild(opt);
  });
}

// 2026-08-30: purge hidden graded <option> pollution from the print select.
// Bug report: user sees 'Holofoil' dropdown fill with 'the most recent grades
// you click' — that's because ensureGradedOptionInSelect() has been appending
// hidden graded options as the user browses grades, and on some browsers
// (Safari iOS, older Android WebViews) `option.hidden` DOES NOT hide options
// from the native <select> dropdown UI. Belt-and-suspenders: also remove
// them from the DOM entirely when we no longer need them. We only keep the
// ONE hidden option that matches the currently selected graded key.
function pruneStaleGradedOptions(keepKey) {
  if (!printSelect) return;
  const opts = Array.from(printSelect.options);
  opts.forEach(o => {
    if (o.dataset.gradedHidden === '1' && o.value !== keepKey) {
      o.remove();
    }
  });
}

// Generation counter guards against stale async syncGradeToPrintSelect calls.
// Scenario the counter fixes: user clicks PSA → async TPL fetch starts → user
// clicks Raw before fetch finishes → Raw path completes synchronously → stale
// PSA fetch resumes and overwrites printSelect back to a graded key, so the
// Raw pill visually stays selected but the price section keeps showing PSA.
// Every call bumps _syncGen; after each await we bail if a newer call started.
window._syncGen = 0;

async function syncGradeToPrintSelect() {
  const myGen = ++window._syncGen;
  const grader = document.querySelector('#gradedPills .pill.sel')?.dataset.val || 'no';
  const grade  = document.getElementById('gradeSelect').value;
  const banner = document.getElementById('gradedCompsBanner');
  const graderNames = { psa: 'PSA', bgs: 'BGS/Beckett', cgc: 'CGC', ace: 'ACE', tag: 'TAG', sgc: 'SGC' };

  if (grader === 'no') {
    // 2026-08-30: stale-gen guard on the fast path. Previously only the async
    // TPL branch checked _syncGen; the fast Raw and Graded paths raced when
    // the user tapped multiple grades quickly (grade 8 -> 9 -> 10), letting
    // an older run's synchronous printSelect.value=... overwrite the newer
    // one AFTER the newer run had finished. This gate ensures only the LAST
    // clicked grade actually writes to the DOM.
    if (myGen !== window._syncGen) return;
    // Remove all hidden graded options — we're on Raw now, keep none.
    pruneStaleGradedOptions(null);
    // Raw / Ungraded — switch printSelect back to first non-graded variant.
    // IMPORTANT: exclude ALL graders (added sgc|ace|tag after this regex was
    // written) — otherwise 'sgc_10' passed the old !(psa|bgs|cgc) filter and
    // got selected as "first raw", forcing SGC 10 price on the Raw toggle.
    const opts = Array.from(printSelect.options);
    // Skip any hidden graded options we injected via ensureGradedOptionInSelect
    const firstRaw = opts.find(o => !o.hidden && !/^(psa|bgs|cgc|sgc|ace|tag)_/.test(o.value));
    if (firstRaw) {
      printSelect.value = firstRaw.value;
      // Fire change event so any onchange listeners (updatePriceFromPrinting)
      // are notified. Setting .value programmatically does NOT trigger change.
      // Belt-and-suspenders: we also explicitly call updatePriceFromPrinting()
      // at end of syncGradeToPrintSelect, but the dispatch also refreshes any
      // other listeners that may exist (e.g. dashboard/roi mirrors).
      try { printSelect.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
    }
    if (banner) banner.style.display = 'none';
    // Reset override field styling AND value — otherwise a graded override
    // typed earlier still wins in getEffectivePrice() and calc() keeps
    // showing the graded profit against the raw price.
    const ovField = document.getElementById('priceOverride');
    if (ovField) { ovField.style.borderColor = ''; ovField.title = ''; ovField.value = ''; }
    // Explicitly refresh the hero price BEFORE the trailing updatePriceFromPrinting()
    // fires. Some layouts (mobile hero-first) read priceMain synchronously after
    // this branch returns, before the tail call gets a chance to run.
    updatePriceFromPrinting();
    // Restore the eBay raw median we cached in fetchAndApplySoldComps so the
    // Raw view matches what the user saw before they browsed graded prices.
    // Without this, going Raw → PSA → Raw shows only the TCGplayer market number,
    // which reads as "wrong price".
    if (selectedCard && window._rawMedianCache) {
      const cardKey = (selectedCard.name || '') + '|' + (selectedCard.setName || '') + '|' + (selectedCard.number || '') + '|' + (selectedCard.game || '');
      const cachedMedian = window._rawMedianCache[cardKey];
      if (cachedMedian != null && ovField && !ovField.value) {
        ovField.value = cachedMedian.toFixed(2);
        if (typeof calc === 'function') calc();
      }
    }
  } else {
    // Graded — auto-clear override so it doesn’t block the graded price
    const ovField = document.getElementById('priceOverride');
    if (ovField) { ovField.value = ''; ovField.style.borderColor = ''; }

    // Build the variant key (replace dots with underscores, e.g. 9.5 -> 9_5).
    // PriceCharting publishes ONE grader-agnostic 9.5 row (box-only-price).
    // The historical internal key is psa_9_5 (kept, because _QP_KEY_TO_PC and
    // the whole graded pipeline are wired to it) even though PSA itself does
    // not issue 9.5. So graders that DO issue 9.5 (BGS/CGC/SGC) must route
    // there rather than to a nonexistent bgs_9_5/cgc_9_5/sgc_9_5.
    // Prefer a native grader-specific key if one genuinely exists (TPL can
    // supply e.g. a real bgs_9), otherwise use the canonical PriceCharting
    // column for this grader+grade. Never a neighbouring grade.
    const nativeKey = `${grader}_${grade}`.replace(/\./g, '_');
    const pcVariantKey = _pcVariantKeyForGrade(grader, grade);
    const targetKey = currentPrices[nativeKey]
      ? nativeKey
      : (pcVariantKey || nativeKey);
    // Graded variants no longer appear in the visible printSelect dropdown
    // (see rebuildPrintSelect / initial variants.forEach). Ensure a hidden
    // option exists in the DOM for the current graded key so
    // printSelect.value=<gradedKey> sticks and updatePriceFromPrinting()
    // reads from currentPrices[<gradedKey>] correctly.
    function ensureGradedOptionInSelect(key, label) {
      let opt = Array.from(printSelect.options).find(o => o.value === key);
      if (!opt) {
        opt = document.createElement('option');
        opt.value = key;
        opt.textContent = label || key;
        opt.dataset.gradedHidden = '1';
        opt.hidden = true; // don't render in the dropdown UI
        printSelect.appendChild(opt);
      }
      return opt;
    }
    const graded = currentPrices[targetKey];
    // 2026-09-04: NO same-grader fallback. Falling back to any key starting
    // with `${grader}_` resolved BGS 9 -> bgs_10 (Charizard $17,103 instead of
    // $3,136.61), CGC 8.5 -> cgc_10, SGC 7.5 -> sgc_10. Substituting a
    // different GRADE is not a source fallback, it is a wrong number.
    if (graded) {
      // 2026-08-30 stale-gen guard on the graded fast path (see note above).
      if (myGen !== window._syncGen) return;
      const useKey = targetKey;
      const useLabel = graded.label;
      // Purge ALL other hidden graded options before adding this one — the
      // dropdown should only ever have zero or one hidden graded entry so
      // it never accumulates 'PSA 8', 'PSA 9', 'BGS 10' as the user browses.
      pruneStaleGradedOptions(useKey);
      ensureGradedOptionInSelect(useKey, useLabel);
      // Has graded data in API — use it
      printSelect.value = useKey;
      if (banner) banner.style.display = 'none';
    } else if (window.tplApiKey && (selectedCard?.tplId || selectedCard?.name)) {
      // No graded variant cached — fetch graded data from TPL
      if (banner) {
        banner.style.display = 'block';
        const note = document.getElementById('gradedCompsNote');
        if (note) note.textContent = 'Fetching graded prices…';
        const upsellBtn = document.getElementById('gradedUpsellBtn');
        if (upsellBtn) upsellBtn.style.display = 'none';
      }

      let gradedVariants = null;

      if (selectedCard?.tplId) {
        // Has TPL ID — fetch by ID for most accurate result
        const fullCard = await fetchTPLCardById(selectedCard.tplId, selectedCard.tplGameSlug);
        // Bail if a newer sync started (e.g. user clicked Raw) — we don't want
        // to overwrite the current UI state with our stale graded data.
        if (myGen !== window._syncGen) return;
        if (fullCard) {
          gradedVariants = fullCard.priceVariants.filter(v => /^(psa|bgs|cgc|ace|tag|sgc)_/.test(v.key));
        }
      } else if (selectedCard?.name) {
        // Loaded from pokemontcg.io — search TPL by name + card number
        gradedVariants = await fetchTPLGradedByNameNumber(
          selectedCard.name,
          selectedCard.number,
          selectedCard.game === 'pokemon' ? 'pokemon' : selectedCard.tplGameSlug || 'pokemon'
        );
        if (myGen !== window._syncGen) return; // stale — bail
      }

      if (gradedVariants && gradedVariants.length) {
        // Merge into selectedCard. rebuildPrintSelect filters graded out of the
        // visible dropdown but keeps them in currentPrices; we then inject a
        // hidden option for the exact grader+grade key so printSelect.value can
        // point at it and updatePriceFromPrinting reads the correct price row.
        //
        // 2026-08-30 fix: PRESERVE PriceCharting-sourced graded variants. TPL
        // returns raw eBay 7d averages which are wildly wrong for low-volume
        // grades (Mew GG10 PSA 10: TPL $120 vs PriceCharting guide $557). Keep
        // PC's authoritative numbers, let TPL only fill in grades PC has NO
        // data for (BGS 8/9/9.5, CGC 8/9/9.5, ACE, TAG, etc).
        const pcGradedKept = selectedCard.priceVariants.filter(v =>
          /^(psa|bgs|cgc|ace|tag|sgc)_/.test(v.key) && v.source === 'pricecharting'
        );
        const pcKeySet = new Set(pcGradedKept.map(v => v.key));
        const tplFiltered = gradedVariants.filter(v => !pcKeySet.has(v.key));
        selectedCard.priceVariants = [
          ...selectedCard.priceVariants.filter(v => !/^(psa|bgs|cgc|ace|tag|sgc)_/.test(v.key)),
          ...pcGradedKept,
          ...tplFiltered,
        ];
        rebuildPrintSelect(selectedCard.priceVariants);
        const nativeKey2 = `${grader}_${grade}`.replace(/\./g, '_');
        const pcVariantKey2 = _pcVariantKeyForGrade(grader, grade);
        const targetKey2 = currentPrices[nativeKey2]
          ? nativeKey2
          : (pcVariantKey2 || nativeKey2);
        const g2 = currentPrices[targetKey2];
        // 2026-09-04: no same-grader fallback here either (see note above).
        if (g2) {
          // 2026-08-30 stale-gen guard — async TPL fetch may have raced
          if (myGen !== window._syncGen) return;
          const useKey2 = targetKey2;
          const useLbl2 = g2.label;
          // Purge ALL other hidden graded options first (see pruneStaleGradedOptions note)
          pruneStaleGradedOptions(useKey2);
          if (!Array.from(printSelect.options).find(o => o.value === useKey2)) {
            const opt = document.createElement('option');
            opt.value = useKey2;
            opt.textContent = useLbl2 || useKey2;
            opt.dataset.gradedHidden = '1';
            opt.hidden = true;
            printSelect.appendChild(opt);
          }
          printSelect.value = useKey2;
          if (banner) banner.style.display = 'none';
          updatePriceFromPrinting();
          return;
        }
      }
      // Still no data after fetch — show banner
      // No graded variant in API — show eBay comps banner
      const cardName = selectedCard?.name?.replace(/ \(JP.*?\)/,'').replace(/ \(EN.*?\)/,'') || '';
      const cardNum  = selectedCard?.number ? ' ' + selectedCard.number : '';
      const graderLabel = graderNames[grader] || grader.toUpperCase();
      const ebayQuery = encodeURIComponent(`${cardName}${cardNum} ${graderLabel} ${grade} pokemon card`);
      const ebayUrl = buildEbayUrl(`https://www.ebay.com/sch/i.html?_nkw=${ebayQuery}&LH_Sold=1&LH_Complete=1&_sacat=183454`);

      if (banner) {
        const note    = document.getElementById('gradedCompsNote');
        const link    = document.getElementById('gradedCompsLink');
        const tplLink = document.getElementById('gradedTplLink');

        // Honest no-data message — no fake multiplier estimates
        const cardName2 = selectedCard?.name?.replace(/ \(JP.*?\)/,'').replace(/ \(EN.*?\)/,'') || 'this card';
        const graderLabel2 = graderNames[grader] || grader.toUpperCase();
        const bannerTitle = document.getElementById('gradedBannerTitle');
        if (window.tplApiKey) {
          // Has key — data just not available for this specific card/grade
          if (bannerTitle) bannerTitle.textContent = 'No graded sales data for this printing';
          if (note) note.textContent = `No ${graderLabel2} ${grade} sales tracked for ${cardName2}. This card may not have graded comps yet — try eBay sold listings below.`;
        } else {
          // No key
          if (bannerTitle) bannerTitle.textContent = 'Add API key for graded prices';
          if (note) note.textContent = `No ${graderLabel2} ${grade} data for ${cardName2}. Add your TCGPriceLookup Starter key in ⚙ settings for real sold prices.`;
        }
        if (link) link.href = ebayUrl;

        // Companion "List on eBay" affiliate link — name+number+grade, no set
        // (see 2026-08-12 fixes: sellers don't type set names). Uses the graded
        // sell-flow so sellers land directly in eBay's listing template with
        // the card pre-filled.
        const sellLink = document.getElementById('gradedSellLink');
        if (sellLink) {
          // 2026-08-14: search view for graded copy so sellers see current
          // market price for this exact grade before listing.
          const graderGrade = `${graderLabel2} ${grade}`.trim();
          sellLink.href = buildEbaySearchUrl(cardName2, selectedCard && selectedCard.number, {
            graded: graderGrade
          });
        }

        // TCGPriceLookup card page deep link
        const tplCardUrl = `https://tcgpricelookup.com/cards/pokemon/${selectedCard?.id || encodeURIComponent(cardName.toLowerCase().replace(/ /g,'-'))}#graded`;
        if (tplLink) tplLink.href = tplCardUrl;

        banner.style.display = 'block';
        // Hide upsell CTA if user already has a key
        const upsellBtn = document.getElementById('gradedUpsellBtn');
        if (upsellBtn) upsellBtn.style.display = window.tplApiKey ? 'none' : 'flex';
      }
      // 2026-08-29 fix: if the previous sync stashed a stale graded key on
      // printSelect (e.g. user went PSA 10 -> BGS 10 and BGS has no data),
      // the tail updatePriceFromPrinting below would keep showing the stale
      // PSA 10 price. Reset printSelect to the first RAW variant so the
      // banner text and the priceMain display agree: 'no comp, showing raw'.
      const rawKey = Object.keys(currentPrices).find(k => !isGradedVariant(k));
      if (rawKey && printSelect.value !== rawKey) {
        printSelect.value = rawKey;
      }
    }
  }
  // Final stale-check guard: don't touch the price display if a newer
  // syncGradeToPrintSelect has already run to completion.
  if (myGen !== window._syncGen) return;
  updatePriceFromPrinting();
}

// ─── AFFILIATE LINK HELPERS ───
// All helpers are SAFE when the merchant is not yet approved:
// they return the raw URL so nothing breaks. When enabled=true is flipped
// in window.AFFILIATE, they start returning the tracked/commissionable URL.

function _aff() { return (window.AFFILIATE || {}); }

// Canonical eBay search-URL builder — every card-attached eBay link should
// route through this so users land on a buyer's-eye search view (see what's
// currently listed + recent sold comps) instead of eBay's Sell wizard. That
// way "Sell on eBay" answers the real question the user has when they click:
// "what price is this card actually moving at right now?"
//
// 2026-08-14: reviewer feedback — every card-associated eBay link should
// deep-link into a searched view of THAT card, not the generic sell flow.
//
// @param cardName {string} — e.g. "Charizard ex"
// @param number   {string} — e.g. "223/197" or "223" (optional)
// @param opts     {object} — { sold: bool (default true), category: string,
//                              extra: string (e.g. 'japanese pokemon card'),
//                              graded: string (e.g. 'PSA 10') }
function buildEbaySearchUrl(cardName, number, opts) {
  opts = opts || {};
  const parts = [];
  // Strip emoji from name FIRST so 🏀/⚾/etc never end up in the eBay _nkw param.
  const cleanName = _stripEmoji(cardName || '').replace(/\s+\d+\s*\/\s*\d+\s*$/, '').trim();
  if (cleanName) parts.push(cleanName);
  if (number) {
    // 2026-08-15 fix: keep the /total fraction. eBay listings title cards as
    // "Kyurem ex 165/086" or "Gardevoir ex 233/091", so dropping the /total
    // was cutting our sold-comps recall (see IMG_3703, IMG_3708). Still strip
    // leading zeros on the numerator so "023/197" → "23/197".
    const raw = String(number).trim();
    const m = raw.match(/^0*(\d+)(\/\d+)?$/);
    const cleanNum = m ? (m[1] + (m[2] || '')) : raw.replace(/^0+/, '');
    if (cleanNum) parts.push(cleanNum);
  }
  if (opts.graded) parts.push(_stripEmoji(opts.graded));
  if (opts.extra) parts.push(_stripEmoji(opts.extra));
  const query = encodeURIComponent(parts.filter(Boolean).join(' '));
  const cat = opts.category || '212'; // 212 = Trading Card Games
  // Sold-comps view by default (better for pricing decisions); pass sold:false
  // for the rare case we want active listings only.
  const soldFilter = opts.sold === false ? '' : '&LH_Sold=1&LH_Complete=1';
  const raw = `https://www.ebay.com/sch/i.html?_nkw=${query}&_sacat=${cat}${soldFilter}&_sop=13`;
  return (typeof buildEbayUrl === 'function') ? buildEbayUrl(raw) : raw;
}

// Builds an eBay URL with EPN campaign parameters appended.
// Handles both search URLs and any other ebay.com URL.
function buildEbayUrl(url) {
  const cfg = _aff().ebay || {};
  const campId = cfg.enabled ? cfg.campid : (window.CARDSELL_EPN_CAMPID || '');
  if (!campId) return url;
  const sep = url.includes('?') ? '&' : '?';
  const tool = cfg.toolid   || '10001';
  const cust = cfg.customid || 'cardsell';
  // Modern eBay Partner Network format — mkcid=1 required for commission tracking
  return `${url}${sep}mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=${encodeURIComponent(campId)}&toolid=${encodeURIComponent(tool)}&mkevt=1&customid=${encodeURIComponent(cust)}`;
}

// 2026-09-04: a "range" whose ends are the same number is not a range.
//
// PriceCharting publishes ONE guide value per grade. updatePriceFromPrinting
// already nulls low/mid/high on the graded branch, but a user screenshot at
// PSA 10 still showed "Low $11690.84 . Mid $11690.84 . High $11690.84", so a
// second path is populating them. Rather than hunt every writer, refuse to
// RENDER a degenerate range: a single number repeated three times reads as a
// measured spread and invites a seller to believe there is room to move.
//
// Only collapses when the values are indistinguishable at the precision we
// print -- a real $0.01 spread still renders. Hoisted, so the render paths
// above this definition can call it.
function _rangeParts(low, mid, high, mult) {
  const m = Number(mult) || 1;
  const px = (v) => (v == null || !(Number(v) > 0)) ? null : (Number(v) * m).toFixed(2);
  const lo = px(low), md = px(mid), hi = px(high);
  const seen = [lo, md, hi].filter(v => v != null);
  if (!seen.length) return [];
  if (seen.every(v => v === seen[0])) return [];
  const out = [];
  if (lo != null) out.push(`Low $${lo}`);
  if (md != null) out.push(`Mid $${md}`);
  if (hi != null) out.push(`High $${hi}`);
  return out;
}

// 2026-09-04: condition-pin every outbound TCGplayer link.
//
// Bug this fixes (user-reported): the headline price is a Near Mint basis --
// TCGCSV's marketPrice is the completed-sale price for a NM copy -- but the
// link under it opened an UNFILTERED product page, which TCGplayer sorts by
// price ascending. On Base Set 2 Charizard that put a $125 Heavily Played
// copy at the top of a page reached from a $500.12 headline. The number was
// not wrong; the link was pointing at a different condition than the number
// described, so the two read as a contradiction.
//
// Pinning Condition=Near Mint makes the destination match the basis we quote.
// Language=English pins the other axis that silently changes price -- a
// Japanese printing is a different market, not a cheaper copy of this one.
//
// This is a DISPLAY-side fix only. It does not touch low/mid/high, which come
// from TCGCSV and still span conditions -- see _renderPriceCaption for how
// that is disclosed. Do not read this as making the range NM-only.
//
// Applied as a URL normalizer rather than a suffix on our own builders,
// because the link the user actually clicked is NOT built here: it arrives as
// `tcg.url` from api/_tcgcsv.js / api/tcg-price.js. Patching only the client
// builders would have left the reported bug live. Every tcgplayer.com URL we
// render goes through this, whatever built it.
//
// Declared as a hoisted function, not a const, so it is safe to call from
// render paths that appear earlier in the file than this definition.
function _tcgpCondUrl(url) {
  if (!url) return url;
  const s = String(url);
  // Only touch first-party TCGplayer destinations. An affiliate-wrapped link
  // carries its real target percent-encoded in ?u=, so appending here would
  // land outside that payload and be dropped -- wrap AFTER pinning, never
  // before. Callers that wrap must pass the bare URL in.
  if (!/^https?:\/\/(www\.)?tcgplayer\.com\//i.test(s)) return s;
  if (/[?&]Condition=/i.test(s)) return s;
  return s + (s.includes('?') ? '&' : '?') + 'Condition=Near+Mint&Language=English';
}

// Wraps a TCGPlayer target URL through Impact's affiliate redirect (when approved).
// Impact.com deep-link format:
//   https://partner.tcgplayer.com/c/<partner_id>/<campaign_id>/<ad_id>?subId1=<subid>&u=<encoded_target>
// When TCGPlayer approval is not yet in, returns the raw target URL.
function wrapTcgpAffiliate(targetUrl) {
  const cfg = _aff().tcgplayer || {};
  if (!cfg.enabled || !cfg.partner_id || !cfg.campaign_id || !cfg.ad_id) return targetUrl;
  const u  = encodeURIComponent(targetUrl);
  const s  = encodeURIComponent(cfg.subid || 'cardresell');
  return `https://partner.tcgplayer.com/c/${cfg.partner_id}/${cfg.campaign_id}/${cfg.ad_id}?subId1=${s}&u=${u}`;
}

// Builds a TCGPlayer search URL for a card, wrapped through the affiliate
// redirect if TCGPlayer is enabled. Same signature as before — safe to call
// from every existing site.
// cardNumber is optional — when provided we prepend it (e.g. "179 Mega Lucario ex Mega Evolution")
// which TCGplayer treats as a phrase-ish search and returns exact printing first.
// We strip trailing /setsize ("179/188" → "179") so the query stays tight.
function buildTcgpUrl(cardName, setName, cardNumber) {
  const num = cardNumber ? String(cardNumber).replace(/\/.*$/, '').trim() : '';
  const parts = [_stripEmoji(cardName || ''), _stripEmoji(setName || ''), num].filter(Boolean);
  const q = encodeURIComponent(parts.join(' '));
  const base = `https://www.tcgplayer.com/search/all/product?q=${q}&view=grid`;
  return wrapTcgpAffiliate(_tcgpCondUrl(base));
}

// Wraps ANY TCGPlayer URL (product page, seller page, etc.) through the
// affiliate redirect. Use this for buy-side links on card detail pages.
function buildTcgpProductUrl(productId) {
  return wrapTcgpAffiliate(
    _tcgpCondUrl(`https://www.tcgplayer.com/product/${encodeURIComponent(productId)}`));
}

// Extracts the TCGplayer product ID from PokemonTCG.io's `card.tcgplayer.url`
// field. That URL is a redirect (prices.pokemontcg.io/tcgplayer/<setId>-<num>)
// that lands on tcgplayer.com/product/<id>, so we can't use it directly —
// it routes through Scrydex's affiliate ID, not ours. We resolve to product ID
// at build time via a lightweight redirect probe cache.
// Result: `{productId}` or empty string.
async function _tcgpProductIdFromUrl(pricesUrl) {
  if (!pricesUrl || !pricesUrl.includes('prices.pokemontcg.io/tcgplayer/')) return '';
  const cacheKey = 'tcgpProductId:' + pricesUrl;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return cached;
  } catch(e) {}
  try {
    // Fetch with redirect=manual would be ideal, but browsers won't expose
    // the Location header on CORS. Instead we HEAD the URL and read from
    // response.url which is the final resolved URL after redirects.
    const res = await fetch(pricesUrl, { method: 'HEAD', mode: 'no-cors' }).catch(() => null);
    // With mode:'no-cors' we can't read anything. Fall through to server proxy.
  } catch(e) {}
  // Best-effort: fire a lightweight server-side resolver. Non-blocking
  // fallback — UI stays functional even if this returns nothing.
  try {
    const r = await fetch(`/api/tcgp-resolve?url=${encodeURIComponent(pricesUrl)}`, { cache: 'force-cache' });
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      const id = String(j.productId || '');
      if (id) {
        try { sessionStorage.setItem(cacheKey, id); } catch(e) {}
        return id;
      }
    }
  } catch(e) {}
  return '';
}

// Preferred TCGplayer link builder — lands users on the exact product page
// (one tap from "Sell Yours") when we have a product ID, otherwise falls
// back to a name+set search. Product ID is discovered from the
// PokemonTCG.io tcgplayer.url field via `/api/tcgp-resolve`.
// Returns a Promise<string> because product-ID resolution may need a network
// round-trip on first look (cached in sessionStorage after that).
async function buildTcgpSmart(cardOrName, setName) {
  // Accept either (card object) or (name, setName) for backward compatibility
  if (typeof cardOrName === 'string') {
    return buildTcgpUrl(cardOrName, setName);
  }
  const card = cardOrName || {};
  const tcgpUrl = card.tcgplayer?.url || '';
  if (tcgpUrl) {
    const pid = await _tcgpProductIdFromUrl(tcgpUrl);
    if (pid) return buildTcgpProductUrl(pid);
  }
  // Fallback: name+set+number search (number is the strongest disambiguator for
  // printings that share a name across sets — e.g. Mega Lucario ex #179 vs #77).
  return buildTcgpUrl(card.name || '', card.setName || card.set?.name || '', card.number || '');
}

// Wraps a BCW Supplies URL. When approved, cfg.link_url is expected to be
// a full BCW-tracked base URL (e.g. https://www.bcwsupplies.com/?aff=XXXX).
// If a specific product path is supplied, we merge it with the tracked base.
function buildBcwUrl(pathOrEmpty) {
  const cfg = _aff().bcw || {};
  const raw = pathOrEmpty || 'https://www.bcwsupplies.com';
  if (!cfg.enabled || !cfg.link_url) return raw;
  // If cfg.link_url already contains a full URL, append tracking
  // params style. Best-effort: assume link_url is the tracked base.
  try {
    const base = new URL(cfg.link_url);
    // If caller passed a path, use that path on BCW domain
    if (pathOrEmpty && pathOrEmpty.startsWith('http')) {
      const target = new URL(pathOrEmpty);
      target.searchParams.set('aff', base.searchParams.get('aff') || '');
      return target.toString();
    }
    return cfg.link_url;
  } catch(e) { return cfg.link_url || raw; }
}

// Returns the BCW coupon code (or empty string) for display in the UI.
// When set, callers can show a "Use code XXXX for 5% off" banner — that
// coupon usage is what pays out the 5% commission per BCW's terms.
function bcwCouponCode() {
  const cfg = _aff().bcw || {};
  return (cfg.enabled && cfg.coupon_code) ? String(cfg.coupon_code) : '';
}

// Generic merchant URL builder — useful for future networks (Awin, etc).
// Usage: getAffiliateLink('psa') → returns tracked link if enabled, else plain link.
function getAffiliateLink(merchantKey) {
  const cfg = (_aff()[merchantKey] || {});
  return cfg.link_url || '';
}

// 2026-09-02: Whole-tile tap target for venue cards.
// The sell CTA used to be the only clickable element, so tapping the large
// tile — the natural target on a phone — did nothing at all. One delegated
// listener opens the tile's venue link, while deferring to any real control
// (link, button, input) the user actually pressed so the details toggle,
// the sell pill, and the venue switches keep their own behavior.
if (!window._platTileTapBound) {
  window._platTileTapBound = true;
  document.addEventListener('click', function (ev) {
    const tile = ev.target.closest ? ev.target.closest('.plat-card[data-sell-url]') : null;
    if (!tile) return;
    // Let genuine interactive children handle their own click.
    if (ev.target.closest('a,button,input,select,textarea,label,[role="button"]')) return;
    // Never hijack a text selection drag.
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel).length > 0) return;
    const url = tile.getAttribute('data-sell-url');
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  });
}

// Updates all the "Where to Sell" platform buttons for the currently loaded card
function updateSellLinks(card) {
  if (!card) return;

  // Hide old pill block — sell links now live on the platform cards themselves
  const block = document.getElementById('sellLinksBlock');
  if (block) block.style.display = 'none';

  // Strip number suffix TPL appends (e.g. "Lacey - 172/142" → "Lacey")
  const rawName = (card.name || '').replace(/\s*-\s*\d+\/\d+\s*$/, '').trim();
  const setName = card.setName || '';
  const number  = card.number || '';
  const game    = card.game || 'pokemon';
  const isPokemon = game === 'pokemon' || game === 'pokemon_jp';
  const isMagic   = game === 'mtg';
  const isYugioh  = game === 'yugioh';

  // Strip trailing card-number patterns aggressively — TPL sometimes glues
  // number onto the name in formats the top regex doesn't catch (e.g.
  // "Charizard 4/175", "Pikachu 172/165", "Mew 025/165"). Without this,
  // appending `number` below double-pastes the number in the sell URL.
  const searchName = rawName.replace(/\s+\d+\s*\/\s*\d+\s*$/, '').trim();
  const gameTag = isPokemon ? 'pokemon card' : isMagic ? 'mtg card' : isYugioh ? 'yugioh card' : 'trading card';
  const ebaycat = (isPokemon || isMagic || isYugioh) ? '183454' : '212';

  // Build per-platform sell URLs
  //
  // eBay sell/listing: drop setName from the seed query. Same reason we
  // dropped it from the scan-miss search — "Kyurem EX 165/086 BW Black Star
  // Promos" returned 0 matches on eBay because our set metadata (Black Bolt)
  // doesn't match how sellers spell it (BW Black Star Promos, or just
  // 2025 Pokemon Black Bolt). Name + number lets eBay's presetNameSearchQuery
  // match to the correct pre-canned listing template every time.
  // 2026-08-14: reviewer feedback — route the "Where to Sell" panel's eBay
  // link to a buyer's-eye search view (sold comps for this exact card) rather
  // than the generic sell wizard, so users can price competitively at a glance.
  const ebaySellRaw = buildEbaySearchUrl(searchName, number);
  // All platform search queries now include the card number for precise
  // printing match (e.g. 'Mega Lucario EX 179/188'). Empty number is
  // silently omitted so behavior for graded/singles-only sites like PWCC
  // stays sane when scan metadata is missing.
  const numTail    = number ? ' ' + number : '';
  // COMC does NOT use a querystring. Its own search box emits
  //   /Cards,=Charizard+4~2f102
  // Spaces become '+' and a literal '/' becomes '~2f' (verified against the
  // live search box 2026-09-02: 653 hits for Charizard, 1 exact hit for
  // "Charizard 4/102"). The previous wildcard-path buy route returned HTTP 500
  // "Runtime Error" because a literal asterisk is an invalid path segment.
  // The bare Search endpoint is worse: it silently drops the query and dumps
  // the user on the unfiltered 8.3M-listing catalog.
  const comcPath = `${searchName}${numTail}`.trim()
    .replace(/[^\w\s/.-]/g, ' ')      // drop punctuation COMC chokes on
    .replace(/\//g, '~2f')            // slash has its own escape
    .replace(/\s+/g, '+');            // spaces are literal plus signs
  const comcUrl = comcPath
    ? `https://www.comc.com/Cards,=${comcPath}`
    : 'https://www.comc.com/Sell';
  const poshQ      = encodeURIComponent(`${searchName}${setName ? ' ' + setName : ''}${numTail} ${gameTag}`);
  const fanaticsQ  = encodeURIComponent(`${searchName}${setName ? ' ' + setName : ''}${numTail}${isPokemon ? ' pokemon' : ''}`);
  // Whatnot: /search?query=<term> — verified 2026-08-21 in-browser. Path-
  // style /search/<term> returns 404. Keep query terse (name+number+game)
  // — Whatnot search is TCG-focused so gameTag ('pokemon' etc) helps.
  const whatnotQ   = encodeURIComponent(`${searchName}${numTail} ${gameTag}`.trim());
  // Mercari: /search/?keyword=<term> — verified 2026-08-21. Note trailing
  // slash and 'keyword' param. Do NOT prefix with /us/ (returns 404).
  const mercariQ   = encodeURIComponent(`${searchName}${numTail} ${gameTag}`.trim());
  const isTCGGame   = isPokemon || isMagic || isYugioh || game === 'lorcana' || game === 'onepiece';
  const tcgpUrl     = isTCGGame ? buildTcgpUrl(searchName, setName, number) : '';

  // Cardmarket search: /<Game>/Products/Search?searchString=<name>. Game path
  // segment is TitleCased (Magic / Pokemon / YuGiOh / Lorcana / OnePiece).
  // For non-TCG scans we fall back to the top-level Products search.
  const cardmarketGame = isMagic ? 'Magic' : isPokemon ? 'Pokemon' : isYugioh ? 'YuGiOh' : game === 'lorcana' ? 'Lorcana' : game === 'onepiece' ? 'OnePiece' : '';
  const cardmarketQ    = encodeURIComponent(`${searchName}${numTail}`.trim());
  const cardmarketUrl  = cardmarketGame
    ? `https://www.cardmarket.com/en/${cardmarketGame}/Products/Search?searchString=${cardmarketQ}`
    : `https://www.cardmarket.com/en`;
  // Card Kingdom buylist deep link. MTG has a proper search route:
  //   /purchasing/mtg_singles?filter[search]=<name>
  // Non-MTG games route to the generic "How to Sell" landing since CK's
  // Pokemon/Lorcana buylists aren't publicly searchable by URL.
  const ckSearchQ = encodeURIComponent(searchName);
  const cardkingdomUrl = isMagic
    ? `https://www.cardkingdom.com/purchasing/mtg_singles?filter%5Bsearch%5D=${ckSearchQ}`
    : `https://www.cardkingdom.com/purchasing/how_to_sell`;
  // CoolStuffInc has no per-card buylist deep link — route to the main
  // full-service sell list landing.
  const coolstuffincUrl = `https://www.coolstuffinc.com/main_fullservice_selllist.php`;
  // Cardsphere — MTG-only offer marketplace. No searchable buylist URL
  // pattern; route to the marketplace home so users land on active offers.
  const cardsphereUrl = `https://www.cardsphere.com/`;
  // Star City Games — Sell Your Cards landing (Sell List + Ship + Sell).
  const scgUrl = `https://sellyourcards.starcitygames.com/`;
  // CardNexus — /en/search?q= is a real card search (verified 200, 2026-09-02),
  // so send TCG scans straight to the card instead of the generic explainer.
  // Non-TCG scans have nothing to match, so they get the walkthrough.
  const cardnexusUrl = isTCGGame
    ? `https://cardnexus.com/en/search?q=${encodeURIComponent(`${searchName}${numTail}`.trim())}`
    : `https://cardnexus.com/en/how-it-works`;
  // TCG Bulk — aggregator app; sellers browse buyer offers in-app.
  const tcgbulkUrl = `https://tcgbulk.com/`;
  // Mana Pool — MTG-only marketplace, so non-MTG scans still land on the
  // seller page but get a "View on" label rather than a "Sell on" CTA.
  // The bare /sell route 404s; real seller onboarding is /seller-info (verified 2026-09-02)
  const manapoolUrl = `https://manapool.com/seller-info`;

  // Store URLs globally — calc() reads these to make cards clickable
  window._platSellUrls = {
    // ebaySellRaw already carries the EPN params (buildEbaySearchUrl wraps internally) —
    // re-wrapping here duplicated the whole campid block. Do NOT re-wrap.
    ebay:         ebaySellRaw,
    // Every venue resolves to a live page for EVERY game. Previously a
    // wrong-game scan (e.g. a sports card) left 8 of 15 tiles with an empty
    // string, so those tiles rendered no link at all and read as dead
    // artwork. Venues that cannot take this particular card still get a real
    // landing page, and renderTile labels those "View on X" instead of
    // "Sell on X" so the CTA never implies an impossible sale.
    tcgplayer:    isTCGGame ? tcgpUrl : 'https://www.tcgplayer.com/',
    comc:         comcUrl,
    poshmark:     `https://poshmark.com/search?query=${poshQ}&type=listings`,
    fanatics:     `https://www.fanaticscollect.com/marketplace?q=${fanaticsQ}`,
    whatnot:      `https://www.whatnot.com/search?query=${whatnotQ}`,
    mercari:      `https://www.mercari.com/search/?keyword=${mercariQ}`,
    manapool:     manapoolUrl,
    cardsphere:   cardsphereUrl,
    cardmarket:   cardmarketUrl,
    cardkingdom:  cardkingdomUrl,
    coolstuffinc: coolstuffincUrl,
    scg:          scgUrl,
    cardnexus:    cardnexusUrl,
    tcgbulk:      tcgbulkUrl
  };
  // Upgrade TCGplayer URL to product-page deeplink if we have a card object.
  // This routes users to the EXACT product page where they tap "Sell Yours"
  // — much better UX than dumping them on a search-results grid.
  if (isTCGGame && card && card.tcgplayer?.url && typeof buildTcgpSmart === 'function') {
    buildTcgpSmart(card).then(url => {
      if (url) {
        window._platSellUrls.tcgplayer = url;
        const slEl = document.getElementById('slTcgpSell');
        if (slEl && slEl.style.display !== 'none') slEl.href = url;
      }
    }).catch(() => {});
  }
  // Show TCGPlayer sell button for card games (MTG + YGO primarily)
  const slTcgpSellEl = document.getElementById('slTcgpSell');
  if (slTcgpSellEl) {
    if (isTCGGame && tcgpUrl) {
      slTcgpSellEl.href = tcgpUrl;
      slTcgpSellEl.style.display = '';
    } else {
      slTcgpSellEl.style.display = 'none';
    }
  }
  // Show Mana Pool + Cardsphere sell buttons only for MTG cards — both are
  // Magic-only marketplaces so surfacing them for Pokemon/YGO would be a lie.
  const slManaPoolSellEl   = document.getElementById('slManaPoolSell');
  const slCardsphereSellEl = document.getElementById('slCardsphereSell');
  if (slManaPoolSellEl)   slManaPoolSellEl.style.display   = isMagic ? '' : 'none';
  if (slCardsphereSellEl) slCardsphereSellEl.style.display = isMagic ? '' : 'none';

  // Also keep eBay buy/comps link alive for the graded comps banner.
  // Drop setName here too — sellers rarely spell the set the way our
  // metadata does, and adding it drives result counts to 0.
  const ebaySoldQ = encodeURIComponent(`${searchName}${number ? ' ' + number : ''} ${gameTag}`);
  const ebayBuyRaw = `https://www.ebay.com/sch/i.html?_nkw=${ebaySoldQ}&_sacat=${ebaycat}&LH_Sold=1&LH_Complete=1`;
  const slEbayBuy = document.getElementById('slEbayBuy');
  if (slEbayBuy) slEbayBuy.href = buildEbayUrl(ebayBuyRaw);

  // Recalc only if called outside of loadCardUI (i.e. price already set) so cards refresh with new sell URLs
  // loadCardUI handles its own calc() call, so we guard against double-recalc
  if (updateSellLinks._skipRecalc) return;
  const price = getEffectivePrice();
  if (price > 0) calc();
}

function toggleGrade() {
  // Show grading ROI panel only when Raw is selected
  const selPill = document.querySelector('#gradedPills .pill.sel');
  if (selPill?.dataset?.val === 'no') {
    showGradingRoi();
  } else {
    hideGradingRoi();
  }
  const grader = document.querySelector('#gradedPills .pill.sel')?.dataset.val || 'no';
  const isGraded = grader !== 'no';
  gradeRow.style.display = isGraded ? 'block' : 'none';
  if (gradeLabel) gradeLabel.style.display = isGraded ? 'block' : 'none';
  // Rebuild grade dropdown so options match the selected grader (fixes
  // 'PSA grades in CGC dropdown' + adds CGC/BGS Pristine 10 options).
  if (isGraded) rebuildGradeSelect(grader);
  updateGradeLabel();        // update label text only
  syncGradeToPrintSelect();  // then sync price (calls updatePriceFromPrinting internally)
}

function updateGradeLabel() {
  // Only updates the label text — does NOT trigger price sync (avoid recursion)
  const grader = document.querySelector('#gradedPills .pill.sel')?.dataset.val || 'no';
  const grade = document.getElementById('gradeSelect').value;
  if (gradeLabel) {
    const names = { psa: 'PSA', bgs: 'BGS', cgc: 'CGC', ace: 'ACE', tag: 'TAG', sgc: 'SGC' };
    gradeLabel.textContent = `${names[grader] || grader.toUpperCase()} ${grade}`;
  }
}

// Grade scales per grader. CGC/BGS have a Pristine 10 (perfect subgrades)
// which commands a HUGE premium over regular 10 — that's the difference the
// user flagged. Keys are the option value used in variant keys (e.g. cgc_10p).
// Order: top grades first so the dropdown defaults to the most valuable.
const GRADE_SCALES = {
  psa: [
    { v: '10',  label: 'PSA 10 — Gem Mint' },
    { v: '9',   label: 'PSA 9 — Mint' },
    { v: '8',   label: 'PSA 8 — NM-Mint' },
    { v: '7',   label: 'PSA 7 — Near Mint' },
    { v: '6',   label: 'PSA 6 — EX-MT' },
    { v: '5',   label: 'PSA 5 — Excellent' },
    { v: '4',   label: 'PSA 4 — VG-EX' },
    { v: '3',   label: 'PSA 3 — VG' },
    { v: '2',   label: 'PSA 2 — Good' },
    { v: '1.5', label: 'PSA 1.5 — Fair' },
    { v: '1',   label: 'PSA 1 — Poor' },
    // PSA issues half grades from 1.5 through 8.5 and NO 9.5 -- the jump from
    // 9 to 10 is deliberately undivided. Do not add a PSA 9.5 rung: that is
    // the single most common way to misprice a slab, because the generic
    // "Grade 9.5" figure published by price guides is a BGS/CGC number.
    { v: '8.5', label: 'PSA 8.5 — NM-Mint+' },
    { v: '7.5', label: 'PSA 7.5 — NM+' },
    { v: '6.5', label: 'PSA 6.5 — EX-MT+' },
    { v: '5.5', label: 'PSA 5.5 — EX+' },
    { v: '4.5', label: 'PSA 4.5 — VG-EX+' },
    { v: '3.5', label: 'PSA 3.5 — VG+' },
    { v: '2.5', label: 'PSA 2.5 — Good+' },
  ],
  bgs: [
    { v: '10p', label: 'BGS 10 Pristine — Black Label' },
    { v: '10',  label: 'BGS 10 — Pristine' },
    { v: '9.5', label: 'BGS 9.5 — Gem Mint' },
    { v: '9',   label: 'BGS 9 — Mint' },
    { v: '8.5', label: 'BGS 8.5 — NM-Mint+' },
    { v: '8',   label: 'BGS 8 — NM-Mint' },
    { v: '7.5', label: 'BGS 7.5' },
    { v: '7',   label: 'BGS 7 — Near Mint' },
    { v: '6',   label: 'BGS 6 — EX-MT' },
    { v: '5',   label: 'BGS 5 — Excellent' },
    { v: '4',   label: 'BGS 4 — VG-EX' },
    { v: '3',   label: 'BGS 3 — VG' },
    { v: '2',   label: 'BGS 2 — Good' },
    { v: '1',   label: 'BGS 1 — Poor' },
  ],
  cgc: [
    { v: '10p', label: 'CGC 10 Pristine — Perfect' },
    { v: '10',  label: 'CGC 10 — Gem Mint' },
    { v: '9.5', label: 'CGC 9.5 — Mint+' },
    { v: '9',   label: 'CGC 9 — Mint' },
    { v: '8.5', label: 'CGC 8.5 — NM-Mint+' },
    { v: '8',   label: 'CGC 8 — NM-Mint' },
    { v: '7.5', label: 'CGC 7.5' },
    { v: '7',   label: 'CGC 7 — Near Mint' },
    { v: '6',   label: 'CGC 6 — EX-MT' },
    { v: '5',   label: 'CGC 5 — Excellent' },
    { v: '4',   label: 'CGC 4 — VG-EX' },
    { v: '3',   label: 'CGC 3 — VG' },
    { v: '2',   label: 'CGC 2 — Good' },
    { v: '1',   label: 'CGC 1 — Poor' },
  ],
  sgc: [
    { v: '10p', label: 'SGC 10 Pristine — Gold Label' },
    { v: '10',  label: 'SGC 10 — Gem Mint' },
    { v: '9.5', label: 'SGC 9.5 — Mint+' },
    { v: '9',   label: 'SGC 9 — Mint' },
    { v: '8.5', label: 'SGC 8.5' },
    { v: '8',   label: 'SGC 8 — NM-Mint' },
    // SGC grades in half-point increments the whole way down, so the scale
    // was missing seven real grades a user could genuinely receive back.
    { v: '7.5', label: 'SGC 7.5' },
    { v: '7',   label: 'SGC 7 — NM' },
    { v: '6.5', label: 'SGC 6.5' },
    { v: '6',   label: 'SGC 6' },
    { v: '5.5', label: 'SGC 5.5' },
    { v: '5',   label: 'SGC 5' },
    { v: '4.5', label: 'SGC 4.5' },
    { v: '4',   label: 'SGC 4' },
    { v: '3.5', label: 'SGC 3.5' },
    { v: '3',   label: 'SGC 3' },
    { v: '2.5', label: 'SGC 2.5' },
    { v: '2',   label: 'SGC 2' },
    { v: '1.5', label: 'SGC 1.5' },
    { v: '1',   label: 'SGC 1' },
  ],
  ace: [
    { v: '10',  label: 'ACE 10 — Gem Mint' },
    { v: '9',   label: 'ACE 9 — Mint' },
    { v: '8',   label: 'ACE 8' },
    { v: '7',   label: 'ACE 7' },
    { v: '6',   label: 'ACE 6' },
    { v: '5',   label: 'ACE 5' },
    { v: '4',   label: 'ACE 4' },
    { v: '3',   label: 'ACE 3' },
    { v: '2',   label: 'ACE 2' },
    { v: '1',   label: 'ACE 1' },
  ],
  tag: [
    { v: '10',  label: 'TAG 10 — Pristine' },
    { v: '9',   label: 'TAG 9 — Mint' },
    { v: '8',   label: 'TAG 8' },
    { v: '7',   label: 'TAG 7' },
    { v: '6',   label: 'TAG 6' },
    { v: '5',   label: 'TAG 5' },
    { v: '4',   label: 'TAG 4' },
    { v: '3',   label: 'TAG 3' },
    { v: '2',   label: 'TAG 2' },
    { v: '1',   label: 'TAG 1' },
  ],
};

// Rebuild the gradeSelect dropdown based on the selected grader. Called
// from toggleGrade() whenever the grader pill changes. Preserves the
// selected value if the new grader's scale contains that value; otherwise
// falls back to the top (highest-grade) option.
function rebuildGradeSelect(grader) {
  const sel = document.getElementById('gradeSelect');
  if (!sel) return;
  const scale = GRADE_SCALES[grader];
  if (!scale) return; // 'no' grader — skip
  const prev = sel.value;
  sel.innerHTML = scale.map(g => `<option value="${g.v}">${g.label}</option>`).join('');
  // Preserve previous grade if valid in new scale, else default to top option
  const keep = scale.find(g => g.v === prev);
  sel.value = keep ? prev : scale[0].v;
}

function setPill(el, groupId) {
  document.querySelectorAll(`#${groupId} .pill`).forEach(p => p.classList.remove('sel'));
  el.classList.add('sel');
}

function toggleAdv() {
  document.getElementById('advBtn').classList.toggle('open');
  document.getElementById('advBody').classList.toggle('open');
}

/* ── Seller profile persistence ──
   These four selects describe WHO the seller is, not what they are pricing,
   so they should outlive a single scan. Persisted to localStorage and
   restored on load. Wrapped in try/catch because the /computer/a preview
   iframe runs on an opaque origin where localStorage access throws. */
const SELLER_PROFILE_KEYS = ['tcgLevel', 'ebayStore', 'ebayTopRated', 'ebayPromo'];
const SELLER_PROFILE_LS   = 'cr_seller_profile_v1';

function saveSellerProfile() {
  try {
    const out = {};
    SELLER_PROFILE_KEYS.forEach(k => {
      const el = document.getElementById(k);
      if (el) out[k] = el.value;
    });
    localStorage.setItem(SELLER_PROFILE_LS, JSON.stringify(out));
  } catch (e) { /* opaque origin or storage disabled - profile just won't persist */ }
}

function loadSellerProfile() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SELLER_PROFILE_LS) || 'null');
  } catch (e) { return; }
  if (!saved || typeof saved !== 'object') return;
  SELLER_PROFILE_KEYS.forEach(k => {
    const el = document.getElementById(k);
    if (!el || !(k in saved)) return;
    // Only accept a value the select actually offers, so a stale or tampered
    // localStorage entry can never put the fee engine into an unknown tier.
    const ok = Array.from(el.options).some(o => o.value === saved[k]);
    if (ok) el.value = saved[k];
  });
}

function initSellerProfile() {
  loadSellerProfile();
  SELLER_PROFILE_KEYS.forEach(k => {
    const el = document.getElementById(k);
    if (el) el.addEventListener('change', saveSellerProfile);
  });
}

// ── Utility ──
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ═══ FEE ENGINE (2026) ═══ */

// Difficulty & Rules of Sale (2026-08-19 deep-dive):
// After user pushback ("Fanatics is more than just sports skew — you have to
// physically ship the card in, that's a big deal"), we now expose the real
// friction on every platform via four fields, not one Easy/Medium/Hard chip:
//
//   effort       tier badge (easy | medium | hard) — headline only
//   workflow    'list'         you list, you ship the card to the buyer yourself
//                'shipIn'       you mail cards TO the platform first, then they list
//                'consignment' you sign the card over; they auction and remit weeks later
//                'liveAuction' you need an audience/livestream to actually clear cards
//   payoutTime   plain-english time-to-cash after the card sells
//   redFlags     array of the 1–4 things a first-time seller genuinely gets
//                burned by — rendered as pill warnings on the platform card.
//
// The old `effort`/`effortLabel`/`hassle` fields are still emitted so nothing
// downstream breaks, but the meat has moved to workflow/payoutTime/redFlags.
const PLATFORMS = {
  ebay:      { name: 'eBay',              color: '#e53238', emoji: '🛒', verified: 'Sep 2026',
    effort: 'easy',   effortLabel: 'Easy · you list, you ship, you get paid',
    workflow: 'list', payoutTime: '2–5 days after buyer clears',
    hassle: 'Biggest audience + buyer protection. Timeline depends on price — cheap cards move fast, high-ask cards can sit.',
    redFlags: ['📬 You ship the card yourself', '⚖️ Buyer-protection disputes possible', '💸 Ship + Sell route charges a 10% service fee (5% at $10,000+) — payout above models the fee-free Sell List'] },
  tcgplayer: { name: 'TCGPlayer',         color: '#0070f3', emoji: '🔵', verified: 'Sep 2026',
    effort: 'easy',   effortLabel: 'Easy · you list, you ship, you get paid',
    workflow: 'list', payoutTime: 'Payouts twice a month',
    hassle: 'TCG-singles hub with built-in buyers. TCGplayer fields customer service on your behalf, so most sales need no follow-up from you.',
    redFlags: ['📬 You ship the card yourself', '📅 Payouts twice a month, not per-sale', '🃏 TCG cards only (no sports, no collectibles)'] },
  poshmark:  { name: 'Poshmark',          color: '#c02b50', emoji: '👗', verified: 'Sep 2026',
    effort: 'easy',   effortLabel: 'Easy · you list, you ship, you get paid',
    workflow: 'list', payoutTime: '3–5 days after buyer confirms',
    hassle: 'Cards are not a supported Poshmark category — there is no Trading Cards browse path, so card buyers are not shopping here.',
    bestFor: '💵 Best for cards under $15 — flat $2.95 fee (jumps to 20% at $15+)',
    redFlags: ['👗 Clothing-first — tiny card audience', '📦 $5 packaging fee if the buyer picks Priority Mail (since Oct 2025)', '🇺🇸 US domestic only — no cross-border selling', '📬 You ship the card yourself', '🚫 Listing risk — Poshmark policy says items outside its supported categories may not be sold'] },
  comc:      { name: 'COMC',              color: '#1a5276', emoji: '🃏', verified: 'Sep 2026',
    effort: 'hard',   effortLabel: 'Hard · ship-in service, they process and list it',
    workflow: 'shipIn', payoutTime: '2–6 weeks after cards clear intake',
    hassle: 'You mail cards to their warehouse first — not a same-day flip.',
    bestFor: '💵 Best for cards $150+ — consignment overhead pays off at higher prices',
    redFlags: ['📦 Ship-in required (you mail cards to them first)', '⏳ 2–6 wk intake + processing before listing', '💰 Cash-out fee to withdraw funds', '🧾 Per-card sub fee even before sale', '⏱️ Enhanced Security Fee: 1¢ per $1,000 of list price per day on items over $50'] },
  fanatics:  { name: 'Fanatics Collect',  color: '#0a2540', emoji: '💎', verified: 'Sep 2026',
    // 2026-08-19: user feedback — old label undersold the real friction.
    // Fanatics Collect requires you to physically ship the card in to their
    // vault before it can be listed via Buy Now / Weekly Auction. That's
    // a big flag; it's not just "medium because sports-heavy".
    effort: 'hard',   effortLabel: 'Hard · ship-in to Fanatics vault first',
    workflow: 'shipIn', payoutTime: '1–4 weeks after sale settles',
    hassle: 'You mail the card to Fanatics’ vault BEFORE it can list. Sports-heavy audience, weekly auction + Buy Now cycle.',
    bestFor: '💵 Best for cards $75+ — ship-in overhead not worth it below this',
    redFlags: ['📦 Ship-in to vault required (Fanatics holds the card)', '⚾ Sports-first audience — slower for raw TCG', '📅 Weekly auction cycle', '🔒 Card locked in vault once accepted', '⚠️ 12% seller fee (not 6%) if you list at or above 120% of Card Ladder market value', '🧾 $3 one-time fee on sub-$50 vault items still unsold after 30 days'] },
  whatnot:   { name: 'Whatnot',           color: '#fbbf24', emoji: '📡', verified: 'Sep 2026',
    effort: 'medium', effortLabel: 'Medium · live auction, you host',
    workflow: 'list', payoutTime: '1–3 days after sale ships',
    hassle: 'Live-auction TCG juggernaut — fastest way to move volume if you can host a stream. Fixed-price listings work too.',
    bestFor: '💵 Best for cards $5,000+ — 8% commission caps at $1,500 (or any price via live shows)',
    redFlags: ['🎙️ Best results require hosting live shows', '📦 You ship the card yourself', '📉 Slower for solo sellers without an audience'] },
  mercari:   { name: 'Mercari',           color: '#dc2626', emoji: '🛍️', verified: 'Sep 2026',
    effort: 'medium', effortLabel: 'Medium · cross-category, high volume',
    workflow: 'list', payoutTime: '2–5 days after buyer confirms',
    hassle: 'High-volume general resale. Card buyers exist but ad spend is where TCG-focused platforms win.',
    bestFor: '💵 Best for cards $5–$100 — flat 10% beats most competitors at this range',
    redFlags: ['📦 You ship the card yourself', '🔹 Non-TCG audience — slower for high-end singles', '💰 Payout on demand carries a 2% instant transfer fee'] },
  // Mana Pool — MTG-only marketplace. Verified fees from support.manapool.com:
  //   5% marketplace fee (on merchandise only, NOT shipping)
  //   + Stripe processing 2.9% + $0.30 per seller/order
  //   Effective total ~7.9% + $0.30, versus TCGplayer's 12.75%+.
  //   Sources:
  //     https://support.manapool.com/hc/en-us/articles/21779686206615-Fees-Mana-Pool-and-Credit-Card-Fees
  //     https://manapool.com/affiliates (referral program open, 5% first sale)
  manapool:  { name: 'Mana Pool',         color: '#5b21b6', emoji: '🔮', verified: 'Sep 2026',
    effort: 'easy',   effortLabel: 'Easy · you list, you ship, you get paid',
    workflow: 'list', payoutTime: 'Fast payouts (per-order)',
    hassle: 'MTG-only marketplace with the lowest fees of any listing platform. You ship directly to buyers.',
    bestFor: '🔮 Best for MTG cards $20+ — ~8% fees, cheapest listing marketplace anywhere',
    redFlags: ['🔮 Magic: The Gathering only', '📬 You ship the card yourself', '📉 Smaller audience than TCGplayer (but growing fast)'] },
  // Cardsphere — MTG-only offer-driven marketplace (buyers post wants, sellers fulfill).
  //   3% seller fee + 10% (or $10, whichever higher) PayPal cashout.
  //   Sources:
  //     https://trademagic.gg/compare
  //     https://www.reddit.com/r/mtgfinance/comments/1kzab2o/
  cardsphere:{ name: 'Cardsphere',        color: '#0891b2', emoji: '🎯', verified: 'Sep 2026',
    effort: 'medium', effortLabel: 'Medium · buyer-offer model, low fees',
    workflow: 'list', payoutTime: 'Instant credit; 10% fee to cash out to PayPal',
    hassle: 'Buyers post offers for cards they want; you decide whether to sell at their price. Lowest per-sale fee anywhere but 10% cashout hurts.',
    bestFor: '💵 Best for MTG cards under $10 — flat ~12.7% beats TCGplayer / eBay on low-price MTG',
    redFlags: ['🔮 Magic: The Gathering only', '🎯 Offer-driven — you sell into buyer wants, not list', '💰 10% PayPal cashout ($10 min — batch sales to amortize)', '📬 You ship the card yourself'] },
  // Cardmarket — massive EU listing marketplace, ALL TCGs (Pokemon, MTG, YGO,
  // Lorcana, One Piece, and more). 5% commission on the article price only,
  // capped at €100/article. USD sellers pay a 3% currency conversion when
  // withdrawing to a non-EUR account. The audience is enormous but you’re
  // competing against European sellers whose baseline prices skew lower;
  // shipping from US is the real gotcha.
  //   Sources:
  //     https://www.cardmarket.com/en/Policies/Fees (official fee table)
  //     https://tcg-pricetracker.com/en/blog/cardmarket-fees (analysis)
  cardmarket:{ name: 'Cardmarket',        color: '#0369a1', emoji: '🌐', verified: 'Sep 2026',
    // 2026-09-01: region flag. Cardmarket's 5% commission is the LOWEST of all
    // 15 venues, so it ranks near the top on raw net payout — but a US seller
    // can't realistically capture that number. International postage, ~3% FX
    // on USD withdrawal, and EU-baseline pricing all eat it. We surface the
    // region inline so the ranking isn't quietly misleading for US sellers.
    // 2026-09-02: upgraded from a hedge to a fact. The registration form's
    // country <select> was read directly: 32 options, every one European
    // (EU + UK/CH/NO/IS/LI), no United States. Cardmarket's own FAQ says "if
    // you cannot find your country in the list, you cannot open a user
    // account." So the earlier "may not be able to register" was understating
    // it — for a US seller this venue is not merely expensive, it is closed.
    // Kept in the picker (non-US users exist and the fee model stays correct)
    // but the tile now says so plainly instead of implying postage is the
    // only obstacle. Source: https://www.cardmarket.com/en/Magic/Signup/Pro
    region: 'EU', regionNote: 'EU-based marketplace. Payout shown is before international shipping from the US and ~3% currency conversion on USD withdrawal.',
    effort: 'medium', effortLabel: 'Medium · EU-focused, all TCGs',
    workflow: 'list', payoutTime: '3–5 days after buyer confirms',
    hassle: 'Europe’s biggest TCG marketplace — huge audience but you’re competing against EU sellers with lower baselines. International shipping from US matters.',
    bestFor: '💵 Best for scarce EU-demand cards — low 5% fee + massive audience',
    redFlags: ['🚫 US sellers cannot register — the signup country list is 32 European countries only', '🌐 EU-based — international shipping from US', '💱 3% currency conversion (USD withdrawals)', '📬 You ship the card yourself', '💬 Some communication in German/French common'] },
  // Card Kingdom — buylist model, all TCGs. NO fees; instead the buylist offer
  // itself is 40–65% of retail comp price (they eat margin on resale). The
  // 30% store credit bonus is huge if you’re also a buyer.
  //   Sources:
  //     https://cardkingdom.freshdesk.com/support/solutions/articles/3000093663 (30% store credit bonus)
  //     https://www.cardkingdom.com/purchasing/how_to_sell
  //     https://cardrouter.com/buylists/cardkingdom (CSV bulk upload workflow)
  // Modeled with a buylistRatio field: cash ≈ 50% of retail, credit ≈ 65%.
  // These are estimates — the tile discloses this clearly and pushes the user
  // to verify against the live quote before shipping.
  cardkingdom:{ name: 'Card Kingdom',     color: '#dc2626', emoji: '👑', verified: 'Sep 2026',
    effort: 'medium', effortLabel: 'Medium · buylist — instant offer, lower payout',
    workflow: 'buylist', payoutTime: 'Fast — check, PayPal, or +30% store credit',
    hassle: 'Buylist model — they quote you a fixed offer, no fees but ~50% of retail for cash (or ~65% for store credit). CSV bulk upload supported.',
    bestFor: '💵 Best for bulk / instant-cash sales — no listing hassle',
    buylistRatio: { cash: 0.50, credit: 0.65 },
    redFlags: ['💰 Buylist offer ~50% of retail (cash) / ~65% (store credit)', '🔄 30% store credit bonus if you’re also a buyer', '📦 You ship cards to them; they inspect on arrival', '⚠️ Estimated payout — verify live quote before shipping'] },
  // CoolStuffInc — buylist, all TCGs including strong Yu-Gi-Oh! presence.
  // No seller fees. 25% store credit bonus. Payment 1–2 business days after
  // approval. Cards under $1 processed at bulk rates.
  //   Sources:
  //     https://www.coolstuffinc.com/main_fullservice_selllist.php (verified)
  //     https://www.reddit.com/r/yugioh/comments/ngtcqa/ (community confirmation of 25% bonus)
  coolstuffinc:{ name: 'CoolStuffInc',    color: '#7c3aed', emoji: '💪', verified: 'Sep 2026',
    effort: 'medium', effortLabel: 'Medium · buylist — strong for YGO + MTG',
    workflow: 'buylist', payoutTime: '1–2 business days after approval',
    hassle: 'Buylist — fixed offer, no fees. Strong Yu-Gi-Oh! + MTG buylist rates. 25% store credit bonus.',
    bestFor: '💵 Best for Yu-Gi-Oh! bulk — strong rates + no fees',
    buylistRatio: { cash: 0.48, credit: 0.60 },
    redFlags: ['💰 Buylist offer ~48% of retail (cash) / ~60% (store credit)', '🔄 25% store credit bonus if you’re also a buyer', '📦 You ship cards to them; cards under $1 = bulk rates', '⚠️ Estimated payout — verify live quote before shipping'] },
  // Star City Games — largest US MTG retailer; expanding buylist to Pokemon, Lorcana,
  // FAB, Riftbound. Sell List (sorted) has ZERO service fee — paid by check/PayPal/credit.
  // Ship + Sell (unsorted) is 10% flat (5% over $10K). +30% store credit bonus.
  // We default to the sorted Sell List rate as the honest baseline for a scanner user
  // who knows what they have — Ship + Sell is a fallback for bulk collections.
  //   Sources:
  //     https://sellyourcards.starcitygames.com/  (fee tiers verified 2026-08-29)
  //     https://help.starcitygames.com/en-US/articles/sell-to-us-229858
  scg:{ name: 'Star City Games',       color: '#003366', emoji: '⭐', verified: 'Sep 2026',
    effort: 'medium', effortLabel: 'Medium · buylist — 0% fee on sorted lists',
    workflow: 'buylist', payoutTime: 'Fast — check, PayPal, or +30% store credit',
    hassle: 'Sell List (sorted): NO service fee, ~55% of retail cash / ~72% store credit. Ship + Sell (unsorted): 10% service fee (5% over $10K). MTG + Pokemon + Lorcana + FAB + Riftbound.',
    bestFor: '💵 Best for MTG collections — biggest US buylist, 0% fee on sorted lists',
    buylistRatio: { cash: 0.55, credit: 0.72 },
    redFlags: ['💰 Buylist offer ~55% of retail (cash) / ~72% (store credit)', '🔄 30% store credit bonus if you’re also a buyer', '📦 You ship cards to them; Sell List = sorted, Ship + Sell = unsorted (10% fee)', '⚠️ Estimated payout — verify live quote before shipping'] },
  // CardNexus — new multi-TCG peer-to-peer marketplace (launched Mar 2026).
  // Clean 8% flat NA seller commission on order total (items + shipping), NO per-order
  // fixed fee, NO payment surcharge. 10+ games: MTG, Pokemon, Lorcana, One Piece,
  // FAB, Sorcery, Riftbound, YGO, and more. Payouts via Stripe Connect.
  // US PRO seller onboarding opened Aug 2026.
  //   Sources:
  //     https://help.cardnexus.com/articles/9938652-fee-structure-overview
  //     https://help.cardnexus.com/articles/1754380-selling-faq
  //     https://cardnexus.com/en/blog/cardnexus-marketplace-is-live
  cardnexus:{ name: 'CardNexus',        color: '#4f46e5', emoji: '🌌', verified: 'Sep 2026',
    effort: 'easy',   effortLabel: 'Easy · you list, you ship, you get paid',
    workflow: 'list', payoutTime: 'Fast — Stripe Connect payouts',
    hassle: 'Multi-TCG peer-to-peer marketplace with a flat 8% commission (NA). 10+ games. New in 2026 — audience is smaller than TCGplayer but growing fast.',
    bestFor: '💵 Best for multi-TCG sellers — flat 8% total, no per-order fees',
    redFlags: ['🌱 New platform (launched Mar 2026) — smaller audience than TCGplayer / eBay', '📬 You ship the card yourself', '🪪 Identity verification required before first payout (Stripe)'] },
  // TCG Bulk — buylist aggregator. Sellers browse verified buyers and their current
  // rates, submit cards to a chosen buyer, ship, and get paid via PayPal after the
  // buyer confirms receipt. Games: Pokemon, MTG, One Piece, Riftbound, YGO, Lorcana, FAB.
  // Exact seller fee not publicly published — deducted from PayPal payout on completion.
  // We estimate 10% aggregator fee as an honest baseline; the tile flags this.
  //   Sources:
  //     https://tcgbulk.com/  (workflow + games verified 2026-08-29)
  tcgbulk:{ name: 'TCG Bulk',           color: '#059669', emoji: '📊', verified: 'Sep 2026',
    effort: 'medium', effortLabel: 'Medium · aggregator — compare buylist offers',
    workflow: 'buylist', payoutTime: 'PayPal after buyer confirms receipt',
    hassle: 'Aggregator — compare offers from multiple verified US buylist buyers, ship to the buyer you pick. Pokemon, MTG, One Piece, YGO, Lorcana, FAB, Riftbound.',
    bestFor: '💵 Best for bulk that needs shopping around — one place to compare buyers',
    buylistRatio: { cash: 0.50, credit: 0.50 },
    redFlags: ['💰 Buylist offer varies by buyer (~50% of retail typical)', '💳 Aggregator fee deducted from PayPal payout at completion', '💸 10% TCG Bulk service fee comes out of your proceeds — included above', '📦 You ship cards to the buyer you pick', '⚠️ Estimated payout — verify live quote before shipping'] }
};

/* ═══ CROSS-BORDER / FOREIGN-VENUE DISCLOSURE ═══════════════════════════════
 * Added 2026-09-01 after a full 15-venue seller-fee audit read against each
 * venue's own published fee schedule, terms and help center.
 *
 * WHY THIS EXISTS: our payout math models a US seller shipping to a US buyer.
 * Two of the fifteen venues are operated by foreign companies, and several US
 * venues charge real money the moment the buyer is outside the country. Nobody
 * reading a single net-payout number should be left assuming that selling
 * across a border is free. Every venue below carries a plain-English line
 * stating operator country, payout currency, and what cross-border actually
 * costs — including the venues where the honest answer is "nothing, because
 * they don't let you sell abroad at all".
 *
 * `foreign: true` means the OPERATOR is not a US company. It is not a quality
 * judgement — it means the seller is contracting with a non-US entity, may be
 * paid in a non-USD currency, and may not even be eligible to register.
 *
 * These strings are disclosure copy, not inputs to the payout math. The only
 * cross-border cost baked into netPayout is Cardmarket's 3% currency
 * conversion (see feeCardmarket), because that venue is EUR-denominated for a
 * US seller by definition. Every other cross-border cost is buyer-dependent,
 * so we disclose it rather than silently charging it.
 */
const CROSS_BORDER = {
  ebay: { flag: '🇺🇸', country: 'US-operated', ccy: 'USD',
    text: 'Sells worldwide. If the buyer or the delivery address is outside the US, eBay adds a 1.65% international fee charged on the item + shipping + tax — waived if you use eBay International Shipping. Converting a foreign currency costs a further 3%. Neither is included in the payout above.',
    src: 'https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822' },
  tcgplayer: { flag: '🇺🇸', country: 'US-operated', ccy: 'USD',
    text: 'Sells internationally. Payment processing rises from 2.5% + $0.30 to 3.5% + $0.30 on international orders — a full point more than the payout above assumes.',
    src: 'https://help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees' },
  poshmark: { flag: '🇺🇸', country: 'US-operated', ccy: 'USD',
    text: 'Domestic only — Poshmark does not offer shipping between countries, so there is no cross-border fee because there is no cross-border sale. A Canadian buyer can only buy from you if they ship to a US address.',
    src: 'https://blog.poshmark.com/poshmark-canada-faq/' },
  comc: { flag: '🇺🇸', country: 'US-operated', ccy: 'USD store credit',
    text: 'US consignment warehouse ships to the buyer, so you carry no cross-border shipping exposure. Cashing out does carry it: COMC states the 10% rate may be slightly higher for international users, and a check mailed outside the US costs $15 instead of $5.',
    src: 'https://www.comc.com/cashout' },
  fanatics: { flag: '🇺🇸', country: 'US-operated', ccy: 'USD',
    text: 'The US vault ships both domestically and internationally and the buyer pays any duties, so no extra cross-border fee lands on you. Middle East shipments are capped under $10,000.',
    src: 'https://support.fanaticscollect.com/en_us/shipping-fulfillment-overview-By46QAQ6gx' },
  whatnot: { flag: '🇺🇸', country: 'US-operated', ccy: 'USD',
    text: 'Cross-border is actively disrupted, not merely taxed. Since the US removed the de minimis exemption on Aug 29, 2025, Whatnot has temporarily paused US buyers purchasing from Europe, the UK and Australia, and Canada→US now moves via UPS with tariffs billed to the buyer. No extra seller fee, but your international reach is smaller than it looks.',
    src: 'https://help.whatnot.com/hc/en-us/articles/10626950552845-International-Shipping-Customs-and-Imports' },
  mercari: { flag: '🇺🇸', country: 'US-operated', ccy: 'USD',
    text: 'US marketplace with no cross-border selling program and no international or currency-conversion fee published for sellers.',
    src: 'https://www.mercari.com/us/help_center/article/169/' },
  manapool: { flag: '🇺🇸', country: 'US-operated', ccy: 'USD',
    text: 'North America only — published rates cover US domestic, Canada domestic and US↔Canada. No cross-border fee, but letter shipments outside the US travel at the buyer\u2019s risk, so a card lost in transit is not on you.',
    src: 'https://support.manapool.com/hc/en-us/articles/20931944865559-Shipping-Rates-and-Methods' },
  cardsphere: { flag: '🇺🇸', country: 'Settles in USD', ccy: 'USD',
    text: 'Stored value is denominated in USD and Cardsphere charges no cross-border fee. Shipping abroad is entirely on you: you bear all shipping cost and all loss risk, and any currency conversion is borne by the card holder rather than the platform.',
    src: 'https://www.cardsphere.com/terms' },
  cardmarket: { flag: '🇩🇪', country: 'Germany', ccy: 'EUR', foreign: true,
    text: 'Foreign venue. Operated by Sammelkartenmarkt GmbH & Co. KG, a German company. You are paid in EUR, and its 3% currency conversion fee is already deducted in the payout above. A US seller cannot register: the signup form’s country list offers 32 European countries (EU plus the UK, Switzerland, Norway, Iceland and Liechtenstein) and has no United States option, and Cardmarket states that if your country is not in the list you cannot open an account. Treat this payout as unreachable from the US unless you already hold an EU-registered account. Selling in from outside the EU also carries VAT duties: Cardmarket collects VAT below €150 (EU) and £135 (UK) and requires their IOSS number on the package; above those thresholds the VAT is yours to handle.',
    src: 'https://www.cardmarket.com/en/Magic/Signup/Pro' },
  cardkingdom: { flag: '🇺🇸', country: 'US-operated', ccy: 'USD',
    text: 'US buyer in Monroe, WA — you ship to them, so there is no buyer-side border to cross. If you are shipping in from outside the US, the order must go Delivery Duties Paid; DDU packages are refused on arrival.',
    src: 'https://www.cardkingdom.com/purchasing/how_to_sell' },
  coolstuffinc: { flag: '🇺🇸', country: 'US-operated', ccy: 'USD',
    text: 'US buyer in Maitland, FL. No cross-border fee, but they buy only specific non-English printings — anything else sent in is rejected and returned at your expense, and return shipping outside the US varies by weight and location.',
    src: 'https://www.coolstuffinc.com/main_selllist.php' },
  scg: { flag: '🇺🇸', country: 'US-operated', ccy: 'USD',
    text: 'US buyer in Roanoke, VA, and all charges are made in US dollars. No cross-border fee. If a collection has to be returned to you outside the continental US, Star City Games covers only 25% of the return shipping and you pay the rest.',
    src: 'https://help.starcitygames.com/en-US/payment-options-1056900' },
  cardnexus: { flag: '🇫🇷', country: 'France', ccy: 'USD (North America)', foreign: true,
    text: 'Foreign venue. Operated by Cardnexus SAS, a French company in Le Bouscat. US sellers are supported: you onboard into the North America region and both list and get paid in USD at the 8% commission used above, so no FX or cross-border fee hits you. Two catches — the region and currency you choose at signup are permanent, and carts are region-locked, so a North American seller cannot reach EU buyers without a second account.',
    src: 'https://help.cardnexus.com/articles/1754380-selling-faq' },
  tcgbulk: { flag: '🇺🇸', country: 'US-operated', ccy: 'USD via PayPal',
    text: 'US operator, CCGCastle LLC of East Windsor, CT. No platform cross-border fee, but each buyer sets their own accepted territory and you must respect it, and TCG Bulk warns that payout providers may impose their own currency conversions and fees on top.',
    src: 'https://tcgbulk.com/page/terms-of-service' }
};

// Renders the cross-border line for a venue tile. Shown on EVERY venue, locked
// or unlocked, so a seller comparing a blurred row still knows the venue is
// foreign-operated before they pay to unlock it.
function crossBorderHtml(pid) {
  const cb = CROSS_BORDER[pid];
  if (!cb) return '';
  const cls = cb.foreign ? 'plat-xborder foreign' : 'plat-xborder';
  const head = cb.foreign
    ? `${cb.flag} Foreign venue · ${esc(cb.country)} · paid in ${esc(cb.ccy)}`
    : `${cb.flag} ${esc(cb.country)} · paid in ${esc(cb.ccy)}`;
  return `<div class="${cls}">
    <div class="xb-head">${head}</div>
    <div class="xb-body">${esc(cb.text)} <a href="${esc(cb.src)}" target="_blank" rel="noopener nofollow" onclick="event.stopPropagation()">Source</a></div>
  </div>`;
}

// TIER-BASED PLATFORM GATING — by effort level, ladder is unambiguous:
//   Free      → easy listing platforms (eBay, TCGPlayer) — 2
//   Pro       → + medium listing (Poshmark, Whatnot, Mercari, Cardmarket, CardNexus) + MTG (Mana Pool, Cardsphere) — 9
//   Pro Max   → + hard listing (COMC, Fanatics) + buylists (Card Kingdom, CoolStuffInc, Star City Games, TCG Bulk) — 15 (all)
//   Ultimate  → all 15 (same platforms; extras are volume/support perks)
// Note: PWCC was retired Jul 15, 2024 and is fully part of Fanatics Collect.
// Note: Mana Pool + Cardsphere are MTG-only — they'll only render when the
// active card game is Magic. Eligibility is enforced in the results loop.
// Note: Cardmarket, Card Kingdom, and CoolStuffInc are ALL-TCG (Pokemon, MTG,
// YGO, Lorcana, One Piece). They render for any TCG scan, hidden for sports.
// 2026-09-01: Stale-fee guardrail. Parses a venue's `verified: 'Mon YYYY'` stamp and
// returns an age in days (integer). Undefined / unparseable stamps return Infinity so
// they never become #1. Anchor is the LAST day of the stamped month, because 'Aug 2026'
// means "sometime in August" and we should measure from the fairest read of that stamp.
// This still makes the >60d ceiling fire correctly (a Jun 2026 stamp is 63d on Sep 1)
// while avoiding noisy Day-1 amber pills for a venue verified in the previous month.
const _MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
function verifiedAgeDays(stamp) {
  if (!stamp || typeof stamp !== 'string') return Infinity;
  const m = stamp.trim().toLowerCase().match(/^([a-z]{3})[a-z]*\s+(\d{4})$/);
  if (!m) return Infinity;
  const mo = _MONTHS[m[1]]; const yr = parseInt(m[2], 10);
  if (mo === undefined || !Number.isFinite(yr)) return Infinity;
  // Last day of the stamped month at 00:00 UTC.
  const anchor = Date.UTC(yr, mo + 1, 0);
  const ms = Date.now() - anchor;
  return ms < 0 ? 0 : Math.floor(ms / 86400000);
}
function isFeeStale(pid)  { return verifiedAgeDays(PLATFORMS[pid]?.verified) > 45; }
function isFeeAmber(pid)  { return verifiedAgeDays(PLATFORMS[pid]?.verified) > 30; }

const FREE_PLATFORMS     = new Set(['ebay', 'tcgplayer']);
const PRO_PLATFORMS      = new Set(['ebay', 'tcgplayer', 'poshmark', 'whatnot', 'mercari', 'manapool', 'cardsphere', 'cardmarket', 'cardnexus']);
const PRO_MAX_PLATFORMS  = new Set(['ebay', 'tcgplayer', 'poshmark', 'whatnot', 'mercari', 'comc', 'fanatics', 'manapool', 'cardsphere', 'cardmarket', 'cardnexus', 'cardkingdom', 'coolstuffinc', 'scg', 'tcgbulk']);

function platformsForTier(tier) {
  if (tier === 'ultimate' || tier === 'pro_max') return PRO_MAX_PLATFORMS;
  if (tier === 'pro')                            return PRO_PLATFORMS;
  return FREE_PLATFORMS;
}

/* ─────────────────────────────────────────────────────────────────────────────
   VENUE SYSTEM (2026-09-02) — job groups, opt-in state, and the eligibility rule

   Why this exists: "15 venues" is not 15 of the same thing. Before this, paying
   for Pro switched every unlocked venue on at once, and the ranking sorted them
   all on one axis — raw net payout. Measured at the $422.40 Charizard anchor,
   that produced a banner reading "Best Pro Payout — Cardmarket — $388.61",
   with TCGplayer at $366.13 and eBay at $366.03. Cardmarket's 5% commission is
   genuinely the lowest of the 15, so the arithmetic was right and the advice was
   wrong: the number is before postage from the US to Europe, so a seller in
   Florida who followed it would mail a card across an ocean to chase $22 that
   postage then eats.

   Three words, kept deliberately distinct:
     unlocked — the user's PLAN allows this venue        (platformsForTier)
     enabled  — the user TURNED IT ON in the picker      (venueEnabled)
     eligible — enabled + unlocked + required inputs met (venueEligible)

   Only an eligible venue may be crowned best payout. A venue can be on and
   still be barred from winning; it shows an "Add shipping to rank" badge and
   sits in the ranking for reference. This mirrors the existing stale-fee
   guardrail, which already keeps a >45-day fee stamp out of the #1 slot.
   ───────────────────────────────────────────────────────────────────────────── */

// The four jobs. A venue does exactly one of them.
const VENUE_GROUPS = [
  { key: 'list',    label: 'List now',  icon: '🛠️',
    sub: 'You photograph, list, and mail the card to a US buyer.' },
  { key: 'foreign', label: 'Foreign',   icon: '🌐',
    sub: 'Overseas marketplaces. Needs international postage to rank.' },
  { key: 'consign', label: 'Consign',   icon: '📦',
    sub: 'Mail a batch to a company that lists it for you. Slow cash.' },
  { key: 'cash',    label: 'Cash now',  icon: '💰',
    sub: 'Sell to a store outright — instant, usually ~50¢ on the dollar.' },
];

// Group assignment. Mana Pool and Cardsphere are MTG-focused but US-operated
// and seller-shipped, so they are 'list', not 'foreign'.
const VENUE_GROUP_OF = {
  ebay: 'list', tcgplayer: 'list', whatnot: 'list', mercari: 'list',
  poshmark: 'list', manapool: 'list', cardsphere: 'list',
  cardmarket: 'foreign', cardnexus: 'foreign',
  comc: 'consign', fanatics: 'consign',
  cardkingdom: 'cash', coolstuffinc: 'cash', scg: 'cash', tcgbulk: 'cash',
};
function venueGroup(pid) { return VENUE_GROUP_OF[pid] || 'list'; }

/* Venues that cannot rank until the user supplies a required input.
   Cardmarket only. Its payout is EUR-denominated for a US seller and the card
   physically crosses the Atlantic, so the number is meaningless until postage
   is known.
   CardNexus is deliberately NOT gated here even though it is French-domiciled
   and grouped under Foreign. Per its own fee documentation (see CROSS_BORDER),
   a US seller onboards into the North America region, lists and is paid in USD
   at the 8% commission already modeled, and ships to North American buyers —
   carts are region-locked, so there is no transatlantic leg to price. Gating it
   on EU postage would invent a cost the source says a US seller does not pay.
   It is off by default like everything else in Foreign, which is the real
   protection. */
/* 2026-09-03: postage alone was not enough. With $18.50 entered, Cardmarket was
   crowned BEST PAYOUT at $370.11 over TCGplayer's $366.13 — on the same tile
   that says, from our own check of their registration form, that a US seller
   cannot open an account. A winner the seller cannot actually sell on is not a
   winner. So Cardmarket now needs BOTH the postage AND an explicit confirmation
   that the user holds an EU-registered account. Both default to unmet, so the
   crown can only land there if the seller has said they can ship and can sell. */
const VENUE_REQUIRES = { cardmarket: ['intlShip', 'cmAccount'] };

// Normalized to an array so a venue can carry more than one prerequisite.
function venueRequirements(pid) {
  const r = VENUE_REQUIRES[pid];
  return !r ? [] : (Array.isArray(r) ? r : [r]);
}

/* Groups that are DELIBERATELY not ranked on payout. Both trade money for
   something the payout number cannot express, so putting them on the same axis
   as a retail listing misleads in opposite directions:

     cash    — a store pays ~50c on the dollar today. Ranked against listings it
               always looks like a loss, so fast cash reads as a mistake.
     consign — COMC/Fanatics list it FOR you at retail with thinner fees, so the
               raw payout can top every listing venue (COMC won at $395.63 vs
               TCGplayer $366.13 at a $422.40 anchor). What that number hides is
               weeks-to-months before the card sells and the cash lands. Crowning
               it "Best Payout" tells a seller who wants money this week to pick
               the slowest option on the page.

   They still render, in their own sections, with their own framing — they are
   excluded from `winner`, from the banner, and from ordinal rank badges. */
const UNRANKED_VENUE_GROUPS = new Set(['cash', 'consign']);
function venueRanked(pid) { return !UNRANKED_VENUE_GROUPS.has(venueGroup(pid)); }

const VENUE_DEFAULT_ENABLED = ['ebay', 'tcgplayer'];
const _VENUE_LS_KEY = 'cr_venues_enabled';
const _VENUE_SHIP_KEY = 'cr_intl_ship';

function _allVenueIds() { return Object.keys(VENUE_GROUP_OF); }

// Enabled set. Persisted per-device. Unknown ids are dropped so a renamed or
// retired venue in storage cannot resurrect itself.
function venuesEnabled() {
  if (window._venuesEnabled instanceof Set) return window._venuesEnabled;
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(_VENUE_LS_KEY) || 'null'); } catch (_) {}
  const valid = _allVenueIds();
  const list = Array.isArray(stored) ? stored.filter(v => valid.includes(v)) : null;
  window._venuesEnabled = new Set(list && list.length ? list : VENUE_DEFAULT_ENABLED);
  return window._venuesEnabled;
}
function venueEnabled(pid) { return venuesEnabled().has(pid); }

function setVenueEnabled(pid, on) {
  const s = venuesEnabled();
  if (on) s.add(pid); else s.delete(pid);
  // Never let the user end up with nothing to compare.
  if (s.size === 0) VENUE_DEFAULT_ENABLED.forEach(v => s.add(v));
  _persistVenues();
}
function resetVenuesToRecommended() {
  window._venuesEnabled = new Set(VENUE_DEFAULT_ENABLED);
  _persistVenues();
}
function _syncVenueChipsSafe() { try { syncVenueChips(); } catch (_) {} }

function _persistVenues() {
  try { localStorage.setItem(_VENUE_LS_KEY, JSON.stringify([...venuesEnabled()])); } catch (_) {}
  // Sync here, at the single write point, so the chips can never disagree with
  // persisted state no matter which caller changed it.
  _syncVenueChipsSafe();
}

/* Does the seller hold an EU-registered Cardmarket account? Cardmarket's own
   signup form lists 32 European countries and no United States, so for most US
   sellers this is false and the venue stays reference-only. Opt-in, per-device,
   defaults to false — we never assume access we cannot verify. */
const _VENUE_CM_ACCT_KEY = 'cr_cm_account';
function cmAccountConfirmed() {
  if (typeof window._cmAccount === 'boolean') return window._cmAccount;
  let v = false;
  try { v = localStorage.getItem(_VENUE_CM_ACCT_KEY) === '1'; } catch (_) {}
  window._cmAccount = v;
  return v;
}
function setCmAccountConfirmed(on) {
  window._cmAccount = !!on;
  try { localStorage.setItem(_VENUE_CM_ACCT_KEY, on ? '1' : '0'); } catch (_) {}
  _syncVenueChipsSafe();
}

// International postage the seller expects to pay, in USD. 0 / blank = unknown.
function intlShipCost() {
  if (typeof window._intlShip === 'number') return window._intlShip;
  let v = 0;
  try { v = parseFloat(localStorage.getItem(_VENUE_SHIP_KEY) || '0') || 0; } catch (_) {}
  window._intlShip = v > 0 ? v : 0;
  return window._intlShip;
}
function setIntlShipCost(v) {
  const n = parseFloat(v);
  window._intlShip = Number.isFinite(n) && n > 0 ? n : 0;
  try { localStorage.setItem(_VENUE_SHIP_KEY, String(window._intlShip)); } catch (_) {}
  // Postage changes whether Cardmarket may rank, so the chip's warning state
  // depends on it.
  _syncVenueChipsSafe();
}

function venueUnlocked(pid, tier) {
  return platformsForTier(tier || window._userTier || (window._isPro ? 'pro' : 'free')).has(pid);
}

/* Has this venue's required input been supplied? Venues with no `requires` are
   trivially satisfied. */
function venueRequirementMet(pid) {
  return venueRequirements(pid).every(req => {
    if (req === 'intlShip')  return intlShipCost() > 0;
    if (req === 'cmAccount') return cmAccountConfirmed();
    return true;
  });
}

/* The single gate the ranking asks. `applicable` is the pre-existing per-card
   check (right game, price available) that the results loop already computes —
   we layer opt-in and required inputs on top of it rather than replacing it. */
function venueEligible(pid, applicable, tier) {
  return !!applicable && venueUnlocked(pid, tier) && venueEnabled(pid) && venueRequirementMet(pid);
}

/* Why a venue that is switched on still cannot win. Returns null when it can.
   Used for the tile badge so the user sees a reason, not a silent demotion. */
function venueBlockReason(pid) {
  if (!venueEnabled(pid)) return null;
  const reqs = venueRequirements(pid);
  // Postage first: it is the cheaper thing to fix and the one most users hit.
  if (reqs.includes('intlShip')  && intlShipCost() <= 0)   return 'Add shipping to rank';
  if (reqs.includes('cmAccount') && !cmAccountConfirmed()) return 'Needs an EU account to rank';
  return null;
}

/* Are all of a venue's prerequisites met EXCEPT the named one? Used to tell
   "we cannot compute this number yet" (missing postage) apart from "we computed
   it, you just told us you cannot sell there" (missing account). */
function venueRequirementsMetExcept(pid, skip) {
  return venueRequirements(pid).every(req => {
    if (req === skip)        return true;
    if (req === 'intlShip')  return intlShipCost() > 0;
    if (req === 'cmAccount') return cmAccountConfirmed();
    return true;
  });
}

/* Short form of the same reason, sized for the tile's rank-badge slot. The tile
   previously showed a bare "N/A", which reads as "we have no number for this"
   when the truth is "we have a number and you told us not to trust it yet".
   Kept to two words so it cannot overflow the badge. */
function venueBlockBadge(pid) {
  const why = venueBlockReason(pid);
  if (why === 'Add shipping to rank')        return 'Needs postage';
  if (why === 'Needs an EU account to rank') return 'Needs EU acct';
  return null;
}

/* ─── Venue picker UI ─────────────────────────────────────────────────────────
   Renders VENUE_GROUPS as grouped checkboxes. Locked rows stay visible so the
   user can see what a plan buys, but clicking one opens Upgrade instead of
   switching it on. ─────────────────────────────────────────────────────────── */

function _venueTier() { return window._userTier || (window._isPro ? 'pro' : 'free'); }

// Which plan first unlocks a venue — drives the "PRO" / "PRO MAX" row badge.
function venuePlanLabel(pid) {
  if (FREE_PLATFORMS.has(pid))    return null;
  if (PRO_PLATFORMS.has(pid))     return 'PRO';
  if (PRO_MAX_PLATFORMS.has(pid)) return 'PRO MAX';
  return null;
}

function renderVenuePicker() {
  const body = document.getElementById('vpBody');
  if (!body) return;
  const tier = _venueTier();
  let html = '';

  VENUE_GROUPS.forEach(g => {
    const pids = _allVenueIds().filter(pid => venueGroup(pid) === g.key);
    if (!pids.length) return;
    // Cheapest plan that unlocks anything in this group, for the header hint.
    const allLocked = pids.every(pid => !venueUnlocked(pid, tier));
    html += `<div class="vp-group">
      <div class="vp-group-hdr">
        <span aria-hidden="true">${g.icon}</span>
        <span class="vg-label">${g.label}</span>
        ${allLocked ? `<span class="vg-lock">Upgrade to unlock</span>` : ''}
      </div>
      <div class="vp-group-sub">${g.sub}</div>`;

    pids.forEach(pid => {
      const info     = PLATFORMS[pid] || {};
      const unlocked = venueUnlocked(pid, tier);
      const on       = venueEnabled(pid);
      const plan     = venuePlanLabel(pid);
      const needs    = venueRequirements(pid).includes('intlShip');
      const note     = needs
        ? 'Needs postage and an EU-registered account below before it can rank.'
        : (info.effortLabel || '');
      if (!unlocked) {
        html += `<div class="vp-row locked" role="button" tabindex="0"
             onclick="closeVenuePicker();openTierModal&&openTierModal()"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">
          <input type="checkbox" disabled aria-hidden="true">
          <div class="vr-main">
            <div class="vr-name">${info.emoji || ''} ${info.name || pid}
              ${plan ? `<span class="vr-badge">${plan}</span>` : ''}</div>
            <div class="vr-note">${note}</div>
          </div>
        </div>`;
      } else {
        html += `<label class="vp-row">
          <input type="checkbox" ${on ? 'checked' : ''}
                 onchange="onVenueToggle('${pid}', this.checked)">
          <div class="vr-main">
            <div class="vr-name">${info.emoji || ''} ${info.name || pid}</div>
            <div class="vr-note">${note}</div>
          </div>
        </label>`;
      }
    });

    // The postage field belongs to Foreign, right under the venues it unblocks.
    if (g.key === 'foreign') {
      const v = intlShipCost();
      html += `<div class="vp-ship">
        <label for="vpIntlShip">International postage you&rsquo;ll pay (USD)</label>
        <input id="vpIntlShip" type="number" min="0" step="0.01" inputmode="decimal"
               placeholder="e.g. 18.50" value="${v > 0 ? v.toFixed(2) : ''}"
               oninput="onIntlShipInput(this.value)">
        <div class="vs-help">Tracked international from the US usually runs $15&ndash;$30 for one card.
          Cardmarket can&rsquo;t be ranked best payout until this is filled in.</div>
      </div>
      <div class="vp-ship">
        <label class="vp-row" style="padding-left:0">
          <input type="checkbox" id="vpCmAccount" ${cmAccountConfirmed() ? 'checked' : ''}
                 onchange="onCmAccountToggle(this.checked)">
          <div class="vr-main">
            <div class="vr-name">I have an EU-registered Cardmarket account</div>
            <div class="vr-note">Cardmarket&rsquo;s signup form lists 32 European countries and no United States,
              so most US sellers cannot open one. Leave this off and Cardmarket still shows its payout
              for reference &mdash; it just can&rsquo;t be crowned best payout.</div>
          </div>
        </label>
      </div>`;
    }
    html += `</div>`;
  });

  body.innerHTML = html;
}

function onVenueToggle(pid, on) {
  setVenueEnabled(pid, on);
  syncVenueChips();
  _rerenderVenueResults();
}

function onIntlShipInput(v) {
  setIntlShipCost(v);
  syncVenueChips();
  _rerenderVenueResults();
}

function onCmAccountToggle(on) {
  setCmAccountConfirmed(on);
  syncVenueChips();
  _rerenderVenueResults();
}

function resetVenuesFromPicker() {
  resetVenuesToRecommended();
  renderVenuePicker();
  syncVenueChips();
  _rerenderVenueResults();
  showToast && showToast('Back to US defaults — eBay + TCGplayer 🇺🇸');
}

function openVenuePicker() {
  renderVenuePicker();
  const m = document.getElementById('venueModal');
  if (m) m.classList.add('open');
  try { window.trackEvent && window.trackEvent('venue_picker_open', { tier: _venueTier() }); } catch (_) {}
}
function closeVenuePicker() {
  const m = document.getElementById('venueModal');
  if (m) m.classList.remove('open');
}

/* Chips under the search bar: the standing answer to "what am I comparing?".
   A venue that is on but barred from ranking shows in gold with its reason, so
   the user is never silently missing a venue they switched on. */
function syncVenueChips() {
  const wrap = document.getElementById('venueChips');
  const btn  = document.getElementById('venuesCount');
  const tier = _venueTier();
  const on   = _allVenueIds().filter(pid => venueEnabled(pid) && venueUnlocked(pid, tier));
  if (btn) btn.textContent = String(on.length);
  if (!wrap) return;
  if (!on.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = on.map(pid => {
    const info = PLATFORMS[pid] || {};
    const why  = venueBlockReason(pid);
    return `<span class="venue-chip ${why ? 'warn' : ''}"${why ? ` title="${why}"` : ''}>${info.emoji || ''} ${info.name || pid}${why ? ` · ${why}` : ''}</span>`;
  }).join('') + `<button type="button" class="vc-edit" onclick="openVenuePicker()">Edit</button>`;
}

// Re-run the comparison after a venue change. calc() is the same entry point
// the price input uses, so a venue toggle costs no price re-fetch.
function _rerenderVenueResults() {
  try { if (typeof calc === 'function') calc(); }
  catch (e) { console.warn('venue rerender failed', e); }
}
/* ─── Pro welcome ────────────────────────────────────────────────────────────
   Fires once, after Stripe confirms a Pro/Pro Max upgrade. Every exit path —
   including the X and Escape — marks the flag done, because the default venue
   set is already the safe one. A modal that must be "completed" to leave would
   be a trap with no upside. ───────────────────────────────────────────────── */

const PRO_WELCOME_KEY = 'cr_pro_venues_onboarded';

function proVenuesOnboarded() {
  try { return localStorage.getItem(PRO_WELCOME_KEY) === '1'; } catch (_) { return false; }
}
function setProVenuesOnboarded() {
  try { localStorage.setItem(PRO_WELCOME_KEY, '1'); } catch (_) {}
}

// Only paying venue tiers see this. Buying scan credits alone is not an upgrade
// to venues, so it must not trigger the venue talk.
function maybeShowProWelcome() {
  const tier = _venueTier();
  if (tier !== 'pro' && tier !== 'pro_max' && tier !== 'ultimate') return false;
  if (proVenuesOnboarded()) return false;
  const m = document.getElementById('proWelcomeModal');
  if (!m) return false;
  const maxLine = document.getElementById('pwMaxLine');
  if (maxLine) maxLine.style.display = (tier === 'pro_max' || tier === 'ultimate') ? '' : 'none';
  m.classList.add('open');
  try { window.trackEvent && window.trackEvent('pro_welcome_shown', { tier }); } catch (_) {}
  return true;
}

function _closeProWelcome() {
  setProVenuesOnboarded();
  const m = document.getElementById('proWelcomeModal');
  if (m) m.classList.remove('open');
}

// 1. Primary. Explicitly re-assert the US default in case anything else touched
//    the set, then confirm with a toast so the choice feels registered.
function proWelcomeUseRecommended() {
  resetVenuesToRecommended();
  syncVenueChips();
  _closeProWelcome();
  _rerenderVenueResults();
  showToast && showToast('Comparing eBay + TCGplayer. Add more under Venues anytime.');
  try { window.trackEvent && window.trackEvent('pro_welcome_choice', { choice: 'recommended' }); } catch (_) {}
}

// 2. Secondary. Opens the picker with NOTHING pre-checked for them — they opt
//    in. Turning on Cardmarket here still cannot make it best payout at $0
//    postage; the engine enforces that independently of this modal.
function proWelcomeChooseVenues() {
  _closeProWelcome();
  openVenuePicker();
  try { window.trackEvent && window.trackEvent('pro_welcome_choice', { choice: 'choose' }); } catch (_) {}
}

// 3. Dismiss. Same safety as (1), minus the toast. Venues stay as they were.
function proWelcomeLater() {
  _closeProWelcome();
  try { window.trackEvent && window.trackEvent('pro_welcome_choice', { choice: 'later' }); } catch (_) {}
}

/* Post-render hook. This was CALLED at the end of the results renderer but
   never defined anywhere in the file, so every single card render threw an
   uncaught ReferenceError. It is the last statement of that function, so
   nothing downstream broke — which is exactly why it went unnoticed. Defining
   it here both silences that and gives the venue tip its natural home. */
const VENUE_TIP_KEY = 'cr_venue_tip_seen';

function _onCardResultShown() {
  try { syncVenueChips(); } catch (_) {}
  try { _maybeShowVenueTip(); } catch (_) {}
}

/* One-time nudge toward the Venues button, per spec. Deliberately names
   Whatnot and Mercari and NOT Cardmarket: pointing a new Pro user at a
   foreign venue is how they end up with a payout that omits postage. */
function _maybeShowVenueTip() {
  const tier = _venueTier();
  if (tier === 'free') return;
  if (!proVenuesOnboarded()) return;          // welcome modal covers them first
  try { if (localStorage.getItem(VENUE_TIP_KEY) === '1') return; } catch (_) { return; }
  const btn = document.getElementById('venuesBtn');
  if (!btn) return;
  try { localStorage.setItem(VENUE_TIP_KEY, '1'); } catch (_) {}
  if (typeof showToast === 'function') {
    showToast('Sell on Whatnot or Mercari too? Turn them on under Venues.', 6000);
  }
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const pw = document.getElementById('proWelcomeModal');
  if (pw && pw.classList.contains('open')) { proWelcomeLater(); return; }
  const vm = document.getElementById('venueModal');
  if (vm && vm.classList.contains('open')) closeVenuePicker();
});


// eBay Trading Cards fees — verified Aug 2026 from ebay.com/help/selling and
// multiple 2026 secondary sources including pages.ebay.com/promo/2025/tc-singles/:
//
//   No Store / Starter Store: 13.25% up to $7,500, then 2.35% above.
//   Basic Store and above:    12.35% up to $2,500, then 2.35% above.
//
// The threshold for the drop to 2.35% is DIFFERENT by store tier ($7,500 vs
// $2,500). This function models both accurately.
//
// Per-order fee: $0.30 for orders ≤ $10 total, $0.40 above.
// Top Rated Seller (TRS) discount: 10% off the FVF only (not per-order).
function feeEbay(price, shipCharge, ebayStore, ebayPromo, ebayTopRated) {
  const total = price + shipCharge;
  const items = [];
  // Basic Store and above uses 12.35% with $2,500 tier boundary.
  // No store / Starter uses 13.25% with $7,500 boundary.
  const isBasicPlus = ebayStore === 'basic';
  const baseRate    = isBasicPlus ? 0.1235 : 0.1325;
  const tierBoundary = isBasicPlus ? 2500 : 7500;
  let fvf = 0;
  if (total <= tierBoundary) fvf = total * baseRate;
  else                       fvf = tierBoundary * baseRate + (total - tierBoundary) * 0.0235;
  const trs = ebayTopRated === 'yes';
  if (trs) fvf *= 0.9;
  const rateLabel = (baseRate * 100).toFixed(2).replace(/\.?0+$/,'');
  // 2026-09-02: the rate signature must describe the rate ACTUALLY charged.
  // Two things can move it off the headline rate: the Top Rated Seller 10%
  // FVF discount, and the tier break where everything above the boundary
  // drops to 2.35%. Previously `f` always printed baseRate, so a Top Rated
  // seller saw "13.25%" on the recipe line while paying 11.93% -- the
  // headline claimed a rate the math did not apply. Now, whenever either
  // adjustment fires we publish the blended effective rate instead.
  // For the Top Rated case we publish "13.25% \u221210% Top Rated" rather than a
  // rounded effective rate: 13.25% less 10% is exactly 11.925%, which does not
  // survive 2dp rounding (11.92% rebuilds two cents light on a $422 card).
  // Stating the two exact operations keeps the row hand-rebuildable. Above the
  // tier boundary the rate genuinely is a blend, so there we show the blend.
  const tiered   = total > tierBoundary;
  const effRate  = total > 0 ? fvf / total : baseRate;
  const effLabel = (effRate * 100).toFixed(2).replace(/\.?0+$/,'');
  // `f` is the short rate signature used to build the visible fee formula
  // ("13.25% + $0.40"). It is attached HERE, next to the arithmetic it
  // describes, so the headline recipe can never drift from the math: the
  // one-liner is assembled from these strings rather than hand-written copy.
  items.push({
    l: `Final Value Fee (${rateLabel}% trading cards`
       + (trs ? ', \u221210% Top Rated' : '')
       + (tiered ? `, 2.35% above $${tierBoundary.toLocaleString()}` : '') + ')',
    a: fvf,
    f: tiered ? `${effLabel}% effective`
              : (trs ? `${rateLabel}% \u221210% Top Rated` : `${rateLabel}%`) });
  const perOrder = total <= 10 ? 0.30 : 0.40;
  items.push({ l: 'Per-order fee', a: perOrder, f: `$${perOrder.toFixed(2)}` });
  if (ebayPromo > 0) items.push({ l: `Promoted Listings (${ebayPromo}%)`, a: total * ebayPromo / 100, f: `${ebayPromo}%` });
  // Fee base disclosure: eBay bills the whole order. Tax is not modeled.
  items.feeBase      = total;
  items.feeBaseLabel = shipCharge > 0 ? 'item + shipping' : 'item';
  items.taxNote      = true;
  return items;
}

// TCGPlayer — dominant TCG singles marketplace (Pokémon, MTG, Yu-Gi-Oh!, Lorcana, etc.)
// Level 1–4 Marketplace Seller (the default tier for new sellers):
//   • 10.75% commission, capped at $75/item
//     (rate raised from 10.25% on Feb 10, 2026; cap raised from $50 to $75 same day)
//   • 2.5% + $0.30 payment processing
// 2026-09-01 fee-truth pass: TCGplayer charges fees on the ORDER SUBTOTAL, which
// is item amount + shipping (taxes are additionally included for credit-card and
// PayPal orders; we do not model tax). We previously billed both the commission
// and the processing fee against the item price alone, which understated fees on
// any sale where the buyer paid shipping.
// Note: help.tcgplayer.com still publishes the pre-Feb-2026 10.25%/$50 numbers;
// the seller blog announcement below is the current authority. Re-verified Sep 2, 2026.
//
// 2026-09-02 SELLER PROFILE: seller level is now modeled, because the level
// changes the rate, the per-order fee AND who pays postage. Official tier table:
//
//   Marketplace Seller (Level 1-4)      10.75%   no Pro fee   2.5% + $0.30
//   Marketplace Seller (Pro, non-Direct) 9.25%   + 2.5% Pro   2.5% + $0.30
//   Direct Seller (non-Pro)              8.95%   no Pro fee   2.5%  (no $0.30)
//   Direct Seller (Pro)                  8.95%   + 2.5% Pro   2.5%  (no $0.30)
//
// Two Direct-only rules that a flat 10.75% model got badly wrong:
//   1. The $0.30 transaction fee was REMOVED from all Direct orders on
//      Jun 18, 2026. Only the 2.5% remains.
//   2. Direct sellers do not ship to the buyer -- TCGplayer fulfills from its
//      facility. Per-order postage is replaced by a per-item Direct fee:
//      $1.12 flat above $2.49, or 50% of sale price at $2.49 and below.
// So a Direct seller pays neither our ~$10.86 processing line nor the ~$5
// postage line. Modeling everyone as Level 1-4 understated Direct net payout.
//
// The $75 cap applies to commission AND Pro fee COMBINED ("the commission and
// Pro fee total is capped"), not to the commission alone -- so for Pro levels we
// scale both lines down proportionally rather than capping only the commission.
//
// Sources:
//   https://help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees
//   https://help.tcgplayer.com/hc/en-us/articles/360047732673-Fee-Calculation-Examples
//   Feb 2026 rate/cap change: https://seller.tcgplayer.com/blog/important-changes-to-tcgplayer-direct-minimum-pricing-and-marketplace-fees
//   Jun 2026 Direct change:   https://seller.tcgplayer.com/blog/simpler-and-more-predictable-fees-coming-for-tcgplayer-direct-june-18
const TCG_LEVELS = {
  l14:       { rate: 0.1075, pro: 0,     direct: false, label: 'Level 1\u20134' },
  pro:       { rate: 0.0925, pro: 0.025, direct: false, label: 'Pro (non-Direct)' },
  direct:    { rate: 0.0895, pro: 0,     direct: true,  label: 'Direct' },
  directpro: { rate: 0.0895, pro: 0.025, direct: true,  label: 'Direct + Pro' }
};

function feeTCGPlayer(price, shipCharge, tcgLevel) {
  const L    = TCG_LEVELS[tcgLevel] || TCG_LEVELS.l14;
  const base = price + (shipCharge || 0);        // fees bill on item + shipping
  const pct  = (L.rate * 100).toFixed(2).replace(/\.?0+$/,'');
  // $75 cap covers commission + Pro fee together.
  const rawCommission = base * L.rate;
  const rawPro        = base * L.pro;
  const rawCombined   = rawCommission + rawPro;
  const capped        = rawCombined > 75;
  const scale         = capped ? 75 / rawCombined : 1;
  const commission    = rawCommission * scale;
  const proFee        = rawPro * scale;
  // Direct orders dropped the $0.30 transaction fee on Jun 18, 2026.
  const processing    = base * 0.025 + (L.direct ? 0 : 0.30);

  const capSuffix = L.pro > 0 ? `${pct}% + 2.5% Pro capped $75` : `${pct}% capped $75`;
  const out = [
    { l: `Marketplace commission (${pct}%${capped ? ', $75 cap' : ''})`,
      a: commission,
      f: capped ? capSuffix : `${pct}%` }
  ];
  if (L.pro > 0) {
    out.push({ l: 'Pro fee (2.5%)', a: proFee, f: capped ? null : '2.5% Pro' });
  }
  out.push({ l: `Payment processing (2.5%${L.direct ? '' : ' + $0.30'})`,
             a: processing,
             f: L.direct ? '2.5%' : '2.5% + $0.30' });
  if (L.direct) {
    const lowValue = price <= 2.49;
    out.push({
      l: lowValue ? 'Direct per-item fee (50% at $2.49 and below)' : 'Direct per-item fee (flat)',
      a: lowValue ? price * 0.50 : 1.12,
      f: lowValue ? '50% item fee' : '$1.12' });
  }
  out.feeBase      = base;
  out.feeBaseLabel = (shipCharge || 0) > 0 ? 'item + shipping' : 'item';
  out.capFired     = capped;
  out.tcgLevel     = (TCG_LEVELS[tcgLevel] ? tcgLevel : 'l14');
  out.tcgDirect    = L.direct;
  out.tcgLevelLabel = L.label;
  return out;
}

// Poshmark — single-tier 2026 fee model (verified Aug 2026).
// $2.95 flat on sales under $15; 20% on sales at $15+. No listing fee,
// no separate processing fee. The old "P+ Badge 15%" tier does not exist.
// Source: https://feefigure.com/poshmark-fees/
function feePoshmark(price) {
  if (price < 15) return [{ l: 'Flat commission (under $15)', a: 2.95 }];
  return [{ l: 'Commission (20%)', a: price * 0.20 }];
}



// Fanatics Collect (formerly PWCC — merger complete Jul 15, 2024).
// Default: Buy Now marketplace at 6% for cards priced ≤120% of Card Ladder
// market value. Overprice tier is 12%. Auction alternative: 0% seller fee
// + 20% buyer premium. Requires shipping card in to Fanatics vault before
// listing — we surface a $5 inbound-ship line item.
// Sources:
//   https://support.fanaticscollect.com/en_us/buy-now-fees-ry33QCXaxe
//   https://www.fanaticscollect.com/newsroom/pwcc-is-now-fanatics-collect
function feeFanatics(price) {
  return [
    { l: 'Buy Now seller fee (6%)', a: price * 0.06 },
    { l: 'Ship-in to vault (est.)', a: 5 }
  ];
}

// COMC — consignment: per-card intake fee + 5% transaction + optional 10% cashout.
// Per Oct 2025 ingestion update: Standard $0.65 raw / $1.25 graded (min $65
// submission = 100 cards on Standard tier); Select $1.00/$1.50; Elite $2.00/$2.50.
// Seller must also mail cards INBOUND to COMC before listing — we surface a
// $5 tracked-ship line as "Ship-in to COMC".
// Sources:
//   https://blog.comc.com/2025/10/01/ingestion-service-level-update-october-1-2025/
//   https://comc.zendesk.com/hc/en-us/articles/360053737993
function feeCOMC(price, service, isGraded, cashout) {
  const subFees = { standard:{raw:.65,graded:1.25}, select:{raw:1.00,graded:1.50}, elite:{raw:2.00,graded:2.50} };
  const subFee = subFees[service]?.[isGraded ? 'graded' : 'raw'] ?? 0.65;
  const txFee  = price * 0.05;
  const items  = [
    { l: `Submission fee (${service})`, a: subFee },
    { l: 'Transaction fee (5%)', a: txFee },
    { l: 'Ship-in to COMC (est.)', a: 5 }
  ];
  if (cashout === 'yes') {
    // 2026-09-01 fee-truth pass: COMC's cash-out is 10% PLUS fixed add-ons that
    // we were omitting. "There is a $1 store credit fee when converting less
    // than $250" — which is most single-card conversions. ($5 for a mailed US
    // check and $15 for a check outside the US are payout-method choices we do
    // not model; the international one is surfaced in the cross-border note.)
    // Source: https://www.comc.com/cashout
    const convertible = Math.max(0, price - txFee - 5);
    items.push({ l: 'Cash-out fee (10%)', a: convertible * 0.10 });
    if (convertible < 250) {
      items.push({ l: 'Cash-out surcharge (under $250)', a: 1 });
    }
  }
  return items;
}

// Whatnot — TCG live-auction leader. Fees per Whatnot's public help center.
// Seller pays:
//   • 8% marketplace commission on sale price, BUT 0% on the portion above
//     $1,500 for TCG / sports / comics / toys categories (single-item cap)
//   • 2.9% + $0.30 payment processing (Stripe pass-through)
// No listing fees, no monthly cost. Seller ships from home.
//
// 2026-09-01 fee-truth pass: Whatnot uses a SPLIT BASIS and we were charging
// processing on the item price alone. Whatnot's schedule is explicit —
// commission uses "the price the item sold for to the buyer, which does not
// include shipping or taxes", while payment processing is "a percentage of the
// total order value ... the final price of the item sold plus shipping and
// buyer-paid tax". We now bill commission on price and processing on
// price + shipping. (We do not model buyer-paid tax anywhere in this engine.)
// Source: https://help.whatnot.com/hc/en-us/articles/4847069165965-Whatnot-Seller-Fees-and-Commissions-Schedule
function feeWhatnot(price, shipCharge) {
  // 8% up to $1,500, 0% commission above that (TCG/sports category cap)
  const commissionable = Math.min(price, 1500);
  const commission = commissionable * 0.08;
  const processing = (price + (shipCharge || 0)) * 0.029 + 0.30;   // total order value
  const commissionLabel = price > 1500
    ? 'Commission (8% up to $1,500, 0% above)'
    : 'Marketplace commission (8%)';
  return [
    { l: commissionLabel, a: commission },
    { l: 'Payment processing (2.9% + $0.30 of item + shipping)', a: processing }
  ];
}

// Mercari — Cross-category resale.
// As of Jan 6, 2025 Mercari eliminated the seller payment processing fee.
// Sellers now pay a FLAT 10% selling fee only. (Buyer pays a separate 3.6%
// Buyer Protection fee; that does not come out of the seller's payout.)
// 2026-09-01 fee-truth pass: the 10% is charged on the completed item price
// AND buyer-paid shipping, not the item price alone. Re-verified Sep 1, 2026.
// Sources:
//   https://www.mercari.com/us/help_center/article/2518/
//   https://www.mercari.com/us/help_center/article/2517/
function feeMercari(price, shipCharge) {
  const base = price + (shipCharge || 0);
  return [
    { l: 'Selling fee (10% of item + shipping)', a: base * 0.10 }
  ];
}

// Mana Pool — MTG-only marketplace.
//   5% marketplace fee on merchandise (NOT shipping)
//   + Stripe processing 2.9% + $0.30 per seller/order
//
// 2026-09-01 fee-truth pass: the 5% genuinely excludes shipping ("the fee is
// not applied to shipping charges, only the price of the product"), but the
// card processing fee does NOT — Mana Pool states "the seller receives the
// entire shipping fee, minus a credit card processing fee". We were billing
// processing on the item price alone, understating fees on any shipped order.
// Sources:
//   https://support.manapool.com/hc/en-us/articles/21779686206615-Fees-Mana-Pool-and-Credit-Card-Fees
//   https://support.manapool.com/hc/en-us/articles/20931944865559-Shipping-Rates-and-Methods
function feeManaPool(price, shipCharge) {
  const marketplace = price * 0.05;                                 // merchandise only
  const processing  = (price + (shipCharge || 0)) * 0.029 + 0.30;   // incl. shipping
  return [
    { l: 'Marketplace fee (5% of item)', a: marketplace },
    { l: 'Payment processing (2.9% + $0.30 of item + shipping)', a: processing }
  ];
}

// Cardsphere — MTG-only offer-driven marketplace.
//   3% seller fee per trade
//   10% (or $10 min) cashout fee to PayPal — amortized across ALL sales
//   in a batch, so per-card we surface the 10% marginal rate. The $10 min
//   floor bites only if you cash out very small balances, which savvy
//   sellers avoid; the red-flag pill on the tile calls this out.
// Sources: https://trademagic.gg/compare · https://www.reddit.com/r/mtgfinance/comments/1kzab2o/
function feeCardsphere(price) {
  const seller    = price * 0.03;
  const netBefore = price - seller;
  // Per-card marginal cashout (10%). The $10 floor is a batch-level cost
  // called out in the tile’s red-flags rather than baked into per-card
  // fees — otherwise a $5 card looks like -200% take-home which is not
  // how anyone actually uses the platform.
  const cashout = netBefore * 0.10;
  return [
    { l: 'Seller fee (3%)', a: seller },
    { l: 'PayPal cashout (10%)', a: cashout }
  ];
}

// Cardmarket — EU listing marketplace. 5% commission on article price only
// (capped at €100/article ≈ $110). USD sellers pay 3% currency conversion
// when withdrawing. International shipping from US typically adds $10-15
// but we don't bake that in — the user's shipCost input handles it.
//   Source: https://www.cardmarket.com/en/Policies/Fees
function feeCardmarket(price, shipCharge) {
  // Cap the commission at ~$110 to match the €100/article ceiling.
  const rawCommission = price * 0.05;
  const commission    = Math.min(rawCommission, 110);
  const currencyConv  = (price + (shipCharge || 0)) * 0.03;
  return [
    { l: 'Sales commission (5%, cap ~$110)', a: commission },
    { l: 'Currency conversion (3%)',         a: currencyConv }
  ];
}

// Buylist "fee" model — the platform pays a fixed offer that's a fraction of
// retail comp price. There's no percentage fee to subtract; instead the
// take-home IS the buylist offer. We surface this as a single "buylist offer
// haircut" line so the fee-breakdown UI still works, and the tile note tells
// the user this is an ESTIMATE and to verify the live quote.
//
// The `mode` param picks cash vs store credit. Default cash (worst-case);
// users planning to also buy from the same shop get the boosted credit rate.
function feeBuylist(price, ratio, serviceFeePct) {
  // How much of retail the seller actually pockets
  const offer   = price * ratio;
  const haircut = price - offer;
  const items = [
    { l: `Buylist offer (~${Math.round(ratio*100)}% of retail)`, a: haircut }
  ];
  // 2026-09-01 fee-truth pass: aggregators skim a service fee off the offer on
  // top of the buylist haircut. TCG Bulk takes 10% of seller proceeds. Direct
  // buylists (Card Kingdom, CoolStuffInc, SCG Sell List) charge nothing, so
  // this stays undefined for them and the row never renders.
  if (serviceFeePct) {
    items.push({
      l: `Aggregator service fee (${Math.round(serviceFeePct*100)}% of offer)`,
      a: offer * serviceFeePct
    });
  }
  return items;
}

// CardNexus — flat 8% North America seller commission. No per-order fixed fee
// for the seller (the 2.5% + $0.30 service fee is a BUYER-side charge).
// No payment surcharge; payouts settle via Stripe Connect.
//
// 2026-09-01 fee-truth pass: the 8% bills on the ORDER TOTAL, not the item.
// CardNexus is explicit — "The fee is calculated on the order total (items +
// shipping)", with a worked example of €55 of cards + €5 shipping → fee on €60.
// We were billing the item price alone.
//
// CardNexus is a FRENCH company (Cardnexus SAS, Le Bouscat) operating a
// region-locked marketplace; a US seller onboards into the North America
// region at 8% and is paid in USD. Region choice is permanent at signup.
// Sources:
//   https://help.cardnexus.com/articles/9938652-fee-structure-overview
//   https://help.cardnexus.com/articles/1754380-selling-faq
//   https://help.cardnexus.com/articles/1539844-legal-notice
function feeCardNexus(price, shipCharge) {
  const base = price + (shipCharge || 0);
  return [
    { l: 'Seller commission (8% of item + shipping)', a: base * 0.08 }
  ];
}

/* ═══ MAIN CALC ═══ */
// 2026-09-01 (Issue 2): "Days to cash" is per-venue, not per-listing. These
// are conservative ranges after the sale closes: shipping/vault dwell for
// consignment, PayPal batching for buylists/offer venues, next-day payouts
// where the venue clears fast. Wide ranges are honest here - the point of
// the row is that COMC is not eBay.
/* ── Time-to-SELL (demand depth), 2026-09-02 ────────────────────────────────
   Separate axis from DAYS_TO_CASH below, which is the POST-SALE settlement
   clock and only starts once a buyer exists. Reading DAYS_TO_CASH alone made
   Poshmark [3,7] look exactly as fast as eBay [3,7]; the difference is that on
   eBay the card sells, and Poshmark does not have a trading-card category.

   Deliberately CATEGORICAL, not day-counts. Research across all 15 venues
   found that NONE publishes an average days-to-sell or sell-through rate for
   cards. The only numbers that exist anywhere are one seller's self-tracked
   51-day COMC average (YouTube, anecdotal) and Whatnot's in-show auction
   durations. Inventing "30-60 days" per venue would be stamping a lie, so each
   tier states a STRUCTURAL fact that is sourced, and no tier claims a duration
   it cannot support.

     instant  — no listing-to-sale wait exists at all (buylists: they are the
                buyer; sale is guaranteed on acceptance/receipt).
     fast     — card-native or card-major demand, documented at scale.
     cadence  — sells on the venue's schedule, not the market's.
     narrow   — real card demand, but scoped: one game only, or unproven.
     blocked  — the venue does not support cards as a category at all.

   `why` must stay a sourced structural claim, never a guessed duration. */
const SELL_SPEED = {
  ebay:       { tier: 'fast',    label: 'Sells fast · deepest card demand',
                why: '$2.62B of card singles sold here in 2025 — the largest card audience anywhere.' },
  tcgplayer:  { tier: 'fast',    label: 'Sells fast · card-native buyers',
                why: 'Purpose-built TCG singles marketplace; every visitor is already shopping for cards.' },
  whatnot:    { tier: 'fast',    label: 'Sells fast · in-show, seconds to minutes',
                why: 'Cards were the top two US categories of $8B+ 2025 sales; in-show auctions close in seconds to minutes. You must be in a live show.' },
  mercari:    { tier: 'fast',    label: 'Card category supported',
                why: 'Full Trading Cards subcategory tree plus card-only envelope shipping labels. Smaller card audience than eBay, but cards are a real category here.' },
  poshmark:   { tier: 'blocked', label: 'Cards are not a Poshmark category',
                why: 'Poshmark supports fashion, personal care, select home goods, pet items and electronics. Its policy says items outside those categories “may not be offered for sale.” Cards have no category, so listings get filed under buckets like “Electronics Other.”' },
  comc:       { tier: 'cadence', label: 'Months on the shelf by design',
                why: 'COMC waives storage fees for the first 90 days and charges monthly after — the fee schedule assumes a long sit. Add intake processing before it even lists.' },
  fanatics:   { tier: 'cadence', label: 'Weekly auction cadence',
                why: 'Submit by Wednesday 11:59pm PT for a Sunday close about 10 days out. Raw cards must be paid-graded first, and an unsold lot burns another cycle.' },
  cardmarket: { tier: 'narrow',  label: 'EU marketplace · US signup limited',
                why: 'Deepest card demand in Europe (500M+ offers, 2M+ buyers), but the signup country list is 32 European countries with no US option — verified on the registration form, so a US seller cannot open an account.' },
  cardnexus:  { tier: 'narrow',  label: 'New · liquidity unproven',
                why: 'Marketplace launched March 2026. Every published figure is supply-side (30M+ cards inventoried); no buyer count, order count, or sales volume has been released.' },
  manapool:   { tier: 'narrow',  label: 'Magic only · smaller pool',
                why: 'Built 100% for Magic — unusable for Pokemon or sports. Real volume ($4M+ gross, 1.2M cards) but orders of magnitude under eBay.' },
  cardsphere: { tier: 'narrow',  label: 'Magic only · needs a standing offer',
                why: 'Magic only. Instant if a buyer already has an offer on your card; open-ended if none exists. Payment releases when the receiver confirms, not when you ship.' },
  cardkingdom:  { tier: 'instant', label: 'No wait · they are the buyer',
                why: 'Buylist — price locked at submission, no listing and no waiting for a buyer. Magic only, and they may not be buying your card at all.' },
  coolstuffinc: { tier: 'instant', label: 'No wait · they are the buyer',
                why: 'Buylist — approved before you ship, so there is no listing-to-sale wait. They reserve the right to refuse a cart; played cards pay 75% of NM.' },
  scg:          { tier: 'instant', label: 'No wait · they are the buyer',
                why: 'Buylist — no listing step. Ship + Sell quotes after receipt and deducts a processing fee; no reply within 30 days is auto-processed.' },
  tcgbulk:      { tier: 'instant', label: 'No wait · dealer buyers',
                why: 'Directory of dealers buying outright, so no listing-to-sale wait. Each buyer sets minimum submissions and a monthly budget that can run out.' },
};
function sellSpeed(pid) { return SELL_SPEED[pid] || null; }

const DAYS_TO_CASH = {
  ebay:        [3, 7],    tcgplayer:  [3, 7],     poshmark:   [3, 7],
  whatnot:     [1, 5],    mercari:    [3, 7],     comc:       [14, 45],
  fanatics:    [7, 30],   manapool:   [7, 14],    cardsphere: [1, 3],
  cardmarket:  [7, 21],   cardnexus:  [7, 21],    cardkingdom:[7, 14],
  coolstuffinc:[7, 14],   scg:        [7, 14],    tcgbulk:    [7, 14],
};
function daysToCashText(pid) {
  const d = DAYS_TO_CASH[pid]; if (!d) return '';
  return d[0] === d[1] ? `${d[0]} days` : `${d[0]}–${d[1]} days`;
}

function calc() {
  const price = getEffectivePrice();
  if (price <= 0) {
    showIntro();
    // No usable price means no basis. Leaving the previous card's tiers up
    // would attribute them to whatever is on screen now.
    try { renderQuickPricing(); } catch(_) {}
    return;
  }

  const shipCharge    = parseFloat(document.getElementById('shipCharge').value) || 0;
  const shipCost      = parseFloat(document.getElementById('shipCost').value) || 0;
  const itemCost      = parseFloat(document.getElementById('itemCost').value) || 0;
  const ebayStore     = document.getElementById('ebayStore').value;
  const ebayPromo     = parseInt(document.getElementById('ebayPromo').value) || 0;
  const ebayTopRated  = document.getElementById('ebayTopRated').value;
  const tcgLevel      = document.getElementById('tcgLevel')?.value || 'l14';
  const tcgIsDirect   = !!(TCG_LEVELS[tcgLevel] && TCG_LEVELS[tcgLevel].direct);
  const comcService   = document.getElementById('comcService').value;
  const comcCashout   = document.getElementById('comcCashout').value;
  const graderVal     = document.querySelector('#gradedPills .pill.sel')?.dataset.val || 'no';
  const isGraded      = graderVal !== 'no';
  const isSports      = activeGame === 'sports';
  const isYugioh      = selectedCard?.game === 'yugioh';
  const isMagic       = selectedCard?.game === 'mtg';

  const platforms = [
    {
      pid: 'ebay',
      eligible: true,
      feeItems: feeEbay(price, shipCharge, ebayStore, ebayPromo, ebayTopRated),
      sellerShip: shipCost,
      note: ''
    },
    {
      pid: 'tcgplayer',
      eligible: !isSports,   // TCGPlayer doesn’t carry sports cards
      feeItems: feeTCGPlayer(price, shipCharge, tcgLevel),
      // 2026-09-01: Standard Level 1–4 marketplace sellers ship to the buyer
      // themselves; TCGplayer collects buyer-paid shipping and reimburses it,
      // but the seller still pays the real postage. Previously hardcoded to 0,
      // which overstated TCGplayer's net payout against every self-ship venue.
      // 2026-09-02: Direct sellers genuinely do NOT pay per-order postage --
      // TCGplayer fulfills from its own facility and charges the per-item
      // Direct fee instead. Charging them the self-ship postage on top of that
      // would double-bill fulfillment, so postage drops to 0 on Direct levels.
      sellerShip: tcgIsDirect ? 0 : shipCost,
      // Surfaced so the renderer can swap the workflow badges to the Direct
      // (ship-in) story instead of the default "you ship it yourself".
      tcgDirect: tcgIsDirect,
      note: isSports
        ? 'TCGPlayer is for TCG singles only — not sports cards.'
        : tcgIsDirect
          ? 'TCGplayer Direct: they fulfill from their facility, so you pay the per-item Direct fee instead of postage and the $0.30 per-order fee.'
          : (isYugioh || isMagic)
            ? 'Largest TCG marketplace for MTG & Yu-Gi-Oh! singles. You ship the card yourself.'
            : 'Largest TCG marketplace for Pokémon singles. You ship the card yourself.'
    },
    {
      pid: 'poshmark',
      eligible: true,
      feeItems: feePoshmark(price),
      buyerShippingRevenue: false,
      sellerShip: 0,
      note: 'Primarily clothing — lower card demand.'
    },
    {
      pid: 'comc',
      eligible: true,
      feeItems: feeCOMC(price, comcService, isGraded, comcCashout),
      buyerShippingRevenue: false,
      sellerShip: 0,
      note: isSports ? 'COMC accepts sports cards.' : (isYugioh || isMagic) ? 'COMC accepts MTG and Yu-Gi-Oh! cards alongside Pokémon.' : ''
    },
    {
      pid: 'fanatics',
      eligible: true,
      feeItems: feeFanatics(price),
      buyerShippingRevenue: false,
      // 2026-09-01: Fanatics is a ship-in venue — the seller mails the card to
      // the vault, which feeFanatics() already bills as a $5 inbound-ship line.
      // Also deducting shipCost (postage to a buyer) double-charged shipping on
      // a sale where the seller never ships to the buyer. Matches the COMC model.
      sellerShip: 0,
      note: isSports
        ? 'Buy Now default. Auction: 0% seller, 20% buyer premium. Listings >120% market: 12% fee.'
        : 'Buy Now default. Listings priced >120% of market pay 12%; auction has 0% seller fee + 20% buyer premium.'
    },
    {
      pid: 'whatnot',
      eligible: true,
      feeItems: feeWhatnot(price, shipCharge),
      sellerShip: shipCost,
      note: (isYugioh || isMagic)
        ? 'Live-auction TCG marketplace. Great for MTG/YGO breakers if you can host or clip fixed-price listings.'
        : isSports
          ? 'Sports breakers use Whatnot heavily. Best if you host or run box breaks.'
          : 'Live-auction TCG hub — huge Pokémon breaker community if you can host shows.'
    },
    {
      pid: 'mercari',
      eligible: true,
      feeItems: feeMercari(price, shipCharge),
      sellerShip: shipCost,
      note: 'General resale — lower fees than eBay but smaller card-buyer audience. Best for mid/low tier cards.'
    },
    {
      pid: 'manapool',
      // MTG-only — hidden entirely for Pokemon/Yu-Gi-Oh!/sports. If you scan
      // a Magic card, this is the strongest listing marketplace we surface
      // (lowest fees anywhere for pure list-and-ship).
      eligible: isMagic,
      feeItems: feeManaPool(price, shipCharge),
      sellerShip: shipCost,
      note: isMagic
        ? 'MTG-only marketplace with the lowest total fees anywhere (~7.9%). Growing fast, CSV import supported.'
        : 'Mana Pool is Magic: The Gathering only.'
    },
    {
      pid: 'cardsphere',
      // MTG-only, buyer-offer model. Best fee at low-end but 10% cashout hurts.
      eligible: isMagic,
      feeItems: feeCardsphere(price),
      buyerShippingRevenue: false,
      sellerShip: shipCost,
      note: isMagic
        ? 'MTG offer-driven marketplace — buyers post wants, you decide whether to fulfill. 3% + 10% cashout to PayPal.'
        : 'Cardsphere is Magic: The Gathering only.'
    },
    {
      pid: 'cardmarket',
      // All-TCG EU listing marketplace. Hidden for sports since it’s TCG-focused.
      // International shipping cost from US isn’t baked in — relies on user’s
      // sellerShip. Best for scarce cards with EU demand.
      eligible: !isSports,
      feeItems: feeCardmarket(price, shipCharge),
      // 2026-09-02: was `shipCost` — US DOMESTIC postage on a card being mailed
      // to Europe. That understated the real cost and is what let Cardmarket
      // rank #1 at $388.61 against TCGplayer's $366.13. When the seller supplies
      // international postage in the Venues picker we charge that instead; until
      // they do, venueRequirementMet() bars this venue from winning.
      sellerShip: intlShipCost() || shipCost,
      note: isSports
        ? 'Cardmarket is TCG-only — not sports cards.'
        : 'Europe’s biggest TCG marketplace. Great audience for scarce cards; international shipping from US is the tradeoff.'
    },
    {
      pid: 'cardkingdom',
      // Buylist model — estimated payout. All TCGs, hidden for sports.
      // We use the cash rate (0.50) as the honest default. If users want
      // the 30% store credit bonus, they can eyeball buylistRatio.credit
      // (0.65) themselves — called out in the tile note + red flags.
      eligible: !isSports,
      feeItems: feeBuylist(price, PLATFORMS.cardkingdom.buylistRatio.cash),
      buyerShippingRevenue: false,
      sellerShip: shipCost,
      note: isSports
        ? 'Card Kingdom buys TCG singles only, not sports cards.'
        : 'Buylist — instant offer (~50% of retail cash / ~65% store credit). CSV bulk upload. Estimated payout — verify live quote.'
    },
    {
      pid: 'coolstuffinc',
      eligible: !isSports,
      feeItems: feeBuylist(price, PLATFORMS.coolstuffinc.buylistRatio.cash),
      buyerShippingRevenue: false,
      sellerShip: shipCost,
      note: isSports
        ? 'CoolStuffInc buys TCG singles only, not sports cards.'
        : isYugioh
          ? 'Strong Yu-Gi-Oh! buylist rates. Instant offer (~48% cash / ~60% store credit). Estimated — verify live quote.'
          : 'Buylist — instant offer (~48% cash / ~60% store credit). Strong for MTG + YGO. Estimated — verify live quote.'
    },
    {
      pid: 'scg',
      // Star City Games buylist. All 5 TCGs (MTG + Pokemon + Lorcana + FAB +
      // Riftbound). Uses cash ratio (0.55) as honest default; store credit
      // adds +30% (0.72) called out in tile notes.
      eligible: !isSports,
      feeItems: feeBuylist(price, PLATFORMS.scg.buylistRatio.cash),
      buyerShippingRevenue: false,
      sellerShip: shipCost,
      note: isSports
        ? 'Star City Games buys TCG singles only, not sports cards.'
        : isMagic
          ? 'Biggest US MTG buylist. Sell List (sorted): 0% fee. Ship + Sell (unsorted): 10% fee. ~55% cash / ~72% store credit. Estimated — verify live quote.'
          : 'Buylist — sorted Sell List has 0% service fee. ~55% cash / ~72% store credit. Estimated — verify live quote.'
    },
    {
      pid: 'cardnexus',
      // CardNexus — multi-TCG peer-to-peer marketplace, flat 8% NA commission.
      // Hidden for sports (TCG-only).
      eligible: !isSports,
      feeItems: feeCardNexus(price, shipCharge),
      sellerShip: shipCost,
      note: isSports
        ? 'CardNexus is a multi-TCG marketplace, not sports cards.'
        : 'Multi-TCG marketplace with a flat 8% seller commission (NA). 10+ games. Newer platform — growing audience.'
    },
    {
      pid: 'tcgbulk',
      // TCG Bulk buylist aggregator. Compare offers from multiple US buyers.
      // Uses conservative 50% ratio as honest baseline; actual varies by buyer.
      eligible: !isSports,
      // 10% TCG Bulk service fee comes out of the seller's proceeds on top of
      // the buyer's buylist haircut. https://tcgbulk.com/page/terms-of-service
      feeItems: feeBuylist(price, PLATFORMS.tcgbulk.buylistRatio.cash, 0.10),
      buyerShippingRevenue: false,
      sellerShip: shipCost,
      note: isSports
        ? 'TCG Bulk is a TCG buylist aggregator, not sports cards.'
        : 'Aggregator — compare offers from multiple verified US buylist buyers. Ship to the buyer you pick, PayPal payout. ~50% typical. Verify live offers.'
    }
  ];

  // The raw-price basis label - what the "Price used" line will read. Reads the
  // same window._crBasis the headline uses, so the recipe cannot disagree with
  // Market Value. When the user typed the number, we say so.
  const _basis = window._crBasis || null;
  const _priceLabel =
    (window._ovAutoFilled === false && document.getElementById('priceOverride')?.value)
      ? 'Your price'
      : (_basis && _basis.label) || 'Price entered';

  const results = platforms.map(p => {
    // `p.eligible` here is CARD APPLICABILITY only (right game, sellable). It is
    // preserved as `applicable` because the Pro upsell needs payouts for venues
    // the user has not unlocked or enabled. Opt-in gating is layered on below.
    if (!p.eligible) return { ...p, applicable: false, totalFees: null, netPayout: null, grossProfit: null, margin: null };
    const effectiveShipCharge = p.buyerShippingRevenue === false ? 0 : shipCharge;
    const totalFees  = p.feeItems.reduce((s, f) => s + f.a, 0);
    const netPayout  = price + effectiveShipCharge - totalFees - p.sellerShip;
    const grossProfit = netPayout - itemCost;
    const margin     = price > 0 ? (grossProfit / price) * 100 : 0;
    // Per-row recipe fields so the tile is auditable end-to-end.
    // Cash-out haircut = any fee row whose label matches a cash-out pattern.
    // We surface it separately in the recipe even though it's already in
    // feeItems, so the row reads Price used -> Fees -> Ship -> Cash-out -> Net
    // in the same order every time.
    const _cashLabels = /(cashout|cash-out|PayPal cashout|Store credit|Store-credit haircut|Check by mail)/i;
    const cashoutRow = p.feeItems.find(f => _cashLabels.test(f.l));
    const cashoutAmt = cashoutRow ? cashoutRow.a : 0;
    // Visible fee formula, assembled from the `f` rate signatures the fee
    // functions attach to their own line items. Because it is derived rather
    // than written, the headline ("After 10.75% + 2.5% + $0.30") cannot state
    // a rate the arithmetic below doesn't actually apply.
    const feeFormula = p.feeItems.map(f => f.f).filter(Boolean).join(' + ');
    return { ...p, applicable: true, totalFees, netPayout, grossProfit, margin,
             priceUsed: price, priceLabel: _priceLabel,
             shipCharge: effectiveShipCharge, sellerShip: p.sellerShip,
             feeFormula,
             feeBase: p.feeItems.feeBase,
             feeBaseLabel: p.feeItems.feeBaseLabel,
             taxNote: !!p.feeItems.taxNote,
             capFired: !!p.feeItems.capFired,
             cashoutAmt, daysToCash: daysToCashText(p.pid) };
  });

  /* 2026-09-02 venue system. `results[].applicable` says the venue can carry
     this card; `eligible` now additionally requires the user's plan to unlock
     it, the user to have switched it on, and any required input to be present.
     Only eligible venues reach `winner` / `bannerResult`, so a venue the seller
     never opted into can no longer be crowned best payout.

     Cash-now and consignment venues are held out of the payout ranking
     entirely — see UNRANKED_VENUE_GROUPS for why each one distorts. They render
     in their own sections with their own framing. */
  results.forEach(r => { r.eligible = venueEligible(r.pid, r.applicable); });
  const _rankable  = results.filter(r => r.eligible && venueRanked(r.pid));
  const eligible   = _rankable.slice();
  eligible.sort((a, b) => sortMode === 'margin' ? b.margin - a.margin : b.netPayout - a.netPayout);
  // 2026-09-01: Stale-fee guardrail. After the payout sort, partition venues whose fee
  // stamp is > 45 days old to the bottom of the eligible list, preserving relative order
  // within each partition. This means a stale venue can never become the #1 winner,
  // downstream `winner`, `bannerResult`, and `unlockedRank[0]` all pick from fresh venues
  // first. Stale venues still appear in the ranking, just never as the top recommendation.
  // The rule is documented on /accuracy#changelog so users can see why a venue got moved.
  const _freshElig = eligible.filter(r => !isFeeStale(r.pid));
  const _staleElig = eligible.filter(r =>  isFeeStale(r.pid));
  eligible.length = 0;
  eligible.push(..._freshElig, ..._staleElig);
  const ineligible = results.filter(r => !r.eligible);
  /* Unranked venues are eligible but intentionally absent from `eligible`, so
     they are in neither list. They must still be rendered — dropping them here
     made every store buylist disappear from the page for Pro Max users. Sort
     them among themselves by payout and append; the section renderer picks them
     up by pid, and because they never enter `eligible` they can't win. */
  const _unranked  = results.filter(r => r.eligible && !venueRanked(r.pid))
                            .sort((a, b) => b.netPayout - a.netPayout);
  const sorted     = [...eligible, ..._unranked, ...ineligible];
  const winner     = eligible[0];
  const worst      = eligible[eligible.length - 1];
  const maxPay     = winner?.netPayout ?? 1;

  let html = '';
  if (_freshElig.length === 0 && eligible.length > 0) {
    html += '<div class="warning-banner" role="status">All marketplace fee schedules are past the 45-day verification window. Rankings are shown for reference only until the next fee audit.</div>';
  }

  // Winner banner
  // Free users see the best of their FREE platforms; Pro sees the true best across all.
  // Tier-aware winner banner — show the best platform *the user can actually see*.
  const _tierPlatforms = platformsForTier(window._userTier || (window._isPro ? 'pro' : 'free'));
  const tierWinner = eligible.find(r => _tierPlatforms.has(r.pid));
  const bannerResult = tierWinner || winner;
  if (bannerResult) {
    const hasCost = itemCost > 0;
    const _bTier = window._userTier || (window._isPro ? 'pro' : 'free');
    const bannerLabel = _bTier === 'free' ? 'Best Free Payout'
                       : _bTier === 'pro' ? 'Best Pro Payout'
                       : 'Best Net Payout';
    html += `<div class="winner">
      <div class="winner-icon">${PLATFORMS[bannerResult.pid].emoji}</div>
      <div class="winner-info">
        <div class="winner-label">${bannerLabel}</div>
        <div class="winner-name">${PLATFORMS[bannerResult.pid].name}</div>
        ${hasCost
          ? `<div class="winner-sub">Profit: <strong style="color:${bannerResult.grossProfit >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(bannerResult.grossProfit)}</strong> · Margin: ${bannerResult.margin.toFixed(1)}%</div>`
          : `<div class="winner-sub">${
              // Show the actual fee recipe instead of the vague "After all 2026
              // platform fees". feeFormula is derived from the fee line items,
              // so this states the rates that were really applied.
              bannerResult.feeFormula
                ? `After ${esc(bannerResult.feeFormula)}${bannerResult.sellerShip > 0 ? ` · ship ${fmt(bannerResult.sellerShip)}` : ''}`
                : 'After all 2026 platform fees'
            }</div>`}
      </div>
      <div class="winner-payout">${fmt(bannerResult.netPayout)}</div>
    </div>`;

    // B5 / clamp disclosure. The High figure is clamped for display when a
    // source returns an outlandish value. Payout is NEVER computed from High -
    // it uses Market (or a price you typed) - so we say exactly that rather
    // than implying the clamp changed the payout number above.
    if (window._crBasis && window._crBasis.highClamped && !itemCost) {
      html += `<div class="clamp-note" role="note">Payout uses ${esc(bannerResult.priceLabel || 'Market')} ${fmt(bannerResult.priceUsed)}, not the raw High — that source's High looked inflated, so we clamp it for display and never price off it. <a href="/accuracy#changelog">How the clamp works</a></div>`;
    }

    // 2026-08-30: NEW — sorted net-payout ranking strip. Delivers the deck's
    // core positioning move: instead of one "winner" tile plus 12 detailed
    // tiles below, users see a scannable ranking bar right up top that
    // answers "where do I sell this?" in one glance. Restricted to venues
    // the user's tier can actually see, sorted highest-net-first.
    //
    // Each row: emoji + venue name + horizontal bar (width = payout/best) +
    // net dollar amount + delta vs #1. Free/locked venues are dimmed.
    // 2026-08-30 revision: unlocked venues render fully; up to 3 locked venues
    // render as teaser rows (name + blurred $ + Upgrade link) so Free users
    // see the shape of the full ranking, not a wall of 2 rows. This honors
    // the hero promise ("across 15 venues") without giving away Pro's value.
    const unlockedRank = eligible.filter(r => _tierPlatforms.has(r.pid)).slice(0, 8);
    const lockedRank   = eligible.filter(r => !_tierPlatforms.has(r.pid)).slice(0, 3);
    const rankBest     = unlockedRank[0]?.netPayout ?? 1;
    if (unlockedRank.length >= 2) {
      html += `<div class="payout-rank" role="list" aria-label="Net payout ranking">
        <div class="payout-rank-header">
          <span class="payout-rank-title">Ranked by net payout</span>
          <span class="payout-rank-sub">after fees${itemCost > 0 ? ' + cost basis' : ''}</span>
        </div>`;
      unlockedRank.forEach((r, i) => {
        const p = PLATFORMS[r.pid];
        const pct = Math.max(6, (r.netPayout / rankBest) * 100);
        const delta = i === 0 ? '' : `−${fmt(rankBest - r.netPayout)}`;
        const barColor = i === 0 ? 'var(--green)' : (i === 1 ? 'var(--gold)' : 'var(--text-muted)');
        html += `<div class="payout-rank-row" role="listitem">
          <div class="payout-rank-rank">${i + 1}</div>
          <div class="payout-rank-emoji">${p.emoji}</div>
          <div class="payout-rank-name">${p.name}</div>
          <div class="payout-rank-bar-wrap"><div class="payout-rank-bar" style="width:${pct}%;background:${barColor}"></div></div>
          <div class="payout-rank-amt">${fmt(r.netPayout)}</div>
          <div class="payout-rank-delta">${delta}</div>
        </div>`;
      });
      // Locked teaser rows: name visible, $ blurred, one-click upgrade CTA.
      lockedRank.forEach((r, idx) => {
        const p = PLATFORMS[r.pid];
        const rowIdx = unlockedRank.length + idx + 1;
        const pct = Math.max(6, (r.netPayout / rankBest) * 100);
        html += `<div class="payout-rank-row payout-rank-locked" role="listitem" onclick="(function(){ try{ window.trackEvent && window.trackEvent('ranking_locked_row_clicked', { source: 'ranking_strip' }); }catch(_){}; window.startVenueUnlock && window.startVenueUnlock('ranking_strip'); })()">
          <div class="payout-rank-rank">${rowIdx}</div>
          <div class="payout-rank-emoji">${p.emoji}</div>
          <div class="payout-rank-name">${p.name}</div>
          <div class="payout-rank-bar-wrap"><div class="payout-rank-bar" style="width:${pct}%;background:var(--text-muted);opacity:.4"></div></div>
          <div class="payout-rank-amt payout-rank-blur">$•••.••</div>
          <div class="payout-rank-delta" style="color:var(--gold-text);font-weight:700">Unlock</div>
        </div>`;
      });
      // 2026-09-01: region disclaimer. If any venue in the visible ranking is
      // non-US, footnote it. Cardmarket has the lowest fee of all 15 venues so
      // it lands high on raw net payout, but a US seller eats international
      // postage + ~3% FX to actually realize it. Showing the number without
      // the caveat is the kind of quiet lie the accuracy page exists to avoid.
      try {
        var _regionPids = unlockedRank.concat(lockedRank)
          .map(function(r){ return r.pid; })
          .filter(function(pid){ return PLATFORMS[pid] && PLATFORMS[pid].region; });
        var _seenR = {}, _regionNotes = [];
        _regionPids.forEach(function(pid){
          var pf = PLATFORMS[pid];
          if (_seenR[pf.name]) return;
          _seenR[pf.name] = 1;
          _regionNotes.push('<b>' + esc(pf.name) + ' (' + esc(pf.region) + ')</b> \u2014 ' + esc(pf.regionNote || ''));
        });
        if (_regionNotes.length) {
          html += '<div class="payout-rank-note"><span>\u{1F310}</span><span>' + _regionNotes.join('<br>') + '</span></div>';
        }
      } catch(_) {}
      // Cache the ranking data on window so shareRanking() can build the OG URL.
      try {
        window._lastRanking = {
          card: (selectedCard?.name || 'Your card') + (selectedCard?.number ? ' #' + selectedCard.number : ''),
          price: price,
          venues: unlockedRank.map(r => ({ name: PLATFORMS[r.pid].name, pay: r.netPayout }))
        };
      } catch(_) {}
      // 2026-08-30: instrument the ranking strip. Deduped per card render so
      // a user scrolling doesn't fire dozens of view events. tier: free / pro.
      try {
        var _tierName = window._isPro ? (window._proTier || 'pro') : 'free';
        window.trackEvent && window.trackEvent('payout_ranking_viewed', {
          tier: _tierName,
          game: (selectedCard && selectedCard.game) || 'pokemon',
        });
      } catch(_) {}
      html += `<button class="payout-share-btn" type="button" onclick="shareRanking()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:.35rem"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>Share this ranking
      </button>`;
      html += `</div>`;
    }
  }

  // Sort bar — only meaningful for Pro (multiple platforms)
  if (window._isPro) {
    html += `<div class="sort-row">
      <span class="sort-label">Sort by:</span>
      <div class="sort-btns">
        <button class="sort-btn ${sortMode==='payout'?'active':''}" onclick="setSort('payout')">Net Payout</button>
        <button class="sort-btn ${sortMode==='margin'?'active':''}" onclick="setSort('margin')">Profit %</button>
      </div>
    </div>`;
  }
  // 2026-08-29: Density toggle (compact vs detailed). Persisted in localStorage.
  // Default compact on mobile (≤600px), detailed on desktop, so 12 tiles are
  // scannable on phones without hiding value on wide screens.
  const _isMobile = window.matchMedia && window.matchMedia('(max-width:600px)').matches;
  const _densityStored = (function(){ try { return localStorage.getItem('cr_density'); } catch(_) { return null; } })();
  const density = _densityStored || (_isMobile ? 'compact' : 'detailed');
  window._crDensity = density;
  html += `<div class="density-row">
    <span class="dens-label">View:</span>
    <div class="density-btns">
      <button class="density-btn ${density==='detailed'?'active':''}" onclick="setDensity('detailed')">Detailed</button>
      <button class="density-btn ${density==='compact'?'active':''}" onclick="setDensity('compact')">Compact</button>
    </div>
  </div>`;

  // Venue counts per tier live in FREE_PLATFORMS / PRO_PLATFORMS /
  // PRO_MAX_PLATFORMS above: Free = 2, Pro = 9, Pro Max and Ultimate = 15.
  // Change the sets, not this comment.
  // (PWCC merged into Fanatics Collect Jul 2024 — no longer a separate row.)
  const _displayTierPlatforms = platformsForTier(window._userTier || (window._isPro ? 'pro' : 'free'));
  // 2026-09-02: also require the venue to be switched on. Rendering an unlocked
  // but disabled venue produced a tile with a blank payout, which read as a
  // pricing failure rather than an off switch. Off venues live in the picker.
  const displaySorted = sorted.filter(r => _displayTierPlatforms.has(r.pid) && venueEnabled(r.pid));

  // 2026-08-29: Partition tiles into 3 workflow sections so buylists
  // (flat 45-52% haircut, instant offer) don't rank next to listings
  // (10-14% + wait for a buyer). Cardsphere is routed to the buylist
  // section — its "instant credit / 10% cashout" model is buylist-like
  // even though its `workflow` field is 'list'.
  /* 2026-09-02: cardsphere override REMOVED. It used to render under the
     buylist section, which now reads "Cash now — sell to a store outright,
     usually ~50c on the dollar". That is false for Cardsphere: it is a
     buyer-offer MTG marketplace at 3% + 10% cashout, it pays near market, and
     the venue engine ranks it. Leaving it there would have put a ranked venue
     under a header claiming a 50% haircut. It sits in `list` with its group. */
  const SECTION_OVERRIDES = {};
  const sectionOf = (pid) => SECTION_OVERRIDES[pid] || PLATFORMS[pid].workflow || 'list';
  const sectionDefs = [
    { key: 'list',    label: 'List & ship yourself',       icon: '🛠️',
      sub: 'Photograph, list, and mail the card yourself' },
    /* 2026-09-02: consignment is out of the payout ranking too, so the sub has
       to carry the reason the payout can look better here. Thin fees minus the
       weeks of float is the whole trade, and the payout figure alone hides the
       second half of it. */
    { key: 'shipIn',  label: 'Ship-in / consignment',      icon: '📦',
      sub: 'Send cards to their warehouse; they list or auction — often pays more than listing yourself, but weeks to months before the cash lands' },
    /* 2026-09-02: renamed from "Instant buylists" to "Cash now" — the plain
       name for what these are. Held out of the payout ranking: a
       ~50c-on-the-dollar quote is not comparable to a retail listing, and
       ranking them together made fast cash look like a loss. */
    { key: 'buylist', label: 'Cash now',                    icon: '💰',
      sub: 'Sell to a store outright — instant offer, usually ~50¢ on the dollar' }
  ];

  // Compute rank among the venues this tier can actually see. The previous
  // implementation used the all-tier list, so a Free user's two visible cards
  // were labeled "7th" and "8th" while the banner called one the best free
  // payout. Keep locked upside in the ranking strip, but make tile badges
  // truthful within the visible comparison.
  /* Unranked venues are excluded here too. They are `eligible` (unlocked, on,
     applicable) but must not receive an ordinal rank badge or Best/Worst label,
     because that ranks them against retail listings — Star City Games rendered
     as "10th", framing instant cash as a failure rather than a different
     product. Their sections stand alone. */
  const _eligibleDisplay = displaySorted.filter(r => r.eligible && venueRanked(r.pid));
  const _displayWinner = _eligibleDisplay[0] || null;
  const _displayWorst = _eligibleDisplay.length > 1 ? _eligibleDisplay[_eligibleDisplay.length - 1] : null;

  const renderTile = (r) => {
    // TCGplayer Direct inverts the fulfillment story: TCGplayer ships from
    // their facility, so the static "you ship the card yourself" workflow
    // badges would contradict the Direct fee model rendered right below them.
    // Shallow-override the display metadata for Direct only; PLATFORMS stays
    // the untouched Level 1-4 baseline.
    let info     = PLATFORMS[r.pid];
    if (r.pid === 'tcgplayer' && r.tcgDirect) {
      info = Object.assign({}, info, {
        effortLabel: 'Easy \u00b7 you send inventory in, they ship and support it',
        workflow: 'shipIn',
        hassle: 'TCG-singles hub with built-in buyers. On Direct, TCGplayer '
              + 'stores and ships the card and handles customer service, so you '
              + 'pay the per-item Direct fee instead of postage.',
        redFlags: ['\ud83d\udce6 You ship inventory in to TCGplayer first',
                   '\ud83d\udcc5 Payouts twice a month, not per-sale',
                   '\ud83c\udccf TCG cards only (no sports, no collectibles)',
                   '\ud83d\udcb5 $0.40 minimum price on Direct listings']
      });
    }
    const isWin  = r.eligible && _displayWinner && r.pid === _displayWinner.pid;
    const isWrst = r.eligible && _displayWorst  && r.pid === _displayWorst.pid;

    let badgeHtml = '';
    if (!r.eligible) {
      // Say WHY it cannot rank when we know. A bare N/A looks like missing data.
      const blockBadge = venueEnabled(r.pid) ? venueBlockBadge(r.pid) : null;
      badgeHtml = blockBadge
        ? `<span class="badge-na" title="${esc(venueBlockReason(r.pid) || '')}">${blockBadge}</span>`
        : `<span class="badge-na">N/A</span>`;
    }
    else if (isWin)  badgeHtml = `<span class="badge-best">Best</span>`;
    else if (isWrst) badgeHtml = `<span class="badge-worst">Lowest</span>`;
    else {
      // 2026-08-29: Extend rank badges past 5th so all 15 tiles show their place.
      // Ranks 1-5 keep the gold badge; 6-12 use a muted grey badge.
      const rankIdx = _eligibleDisplay.indexOf(r);
      const rankMap = ['1st','2nd','3rd','4th','5th','6th','7th','8th','9th','10th','11th','12th'];
      const rank = rankMap[rankIdx];
      if (rank) {
        const rankCls = rankIdx < 5 ? 'badge-rank' : 'badge-rank-muted';
        badgeHtml = `<span class="${rankCls}">${rank}</span>`;
      }
    }

    // 2026-08-29: Bad-value visual state — effective take-rate > 30% of price.
    // Applies to buylists on low-value cards (Card Kingdom 50% flat on a $10 card)
    // and to listings where flat per-order fees dominate a cheap sale (eBay on $1).
    // Skips the winner tile so "Best" always looks best even if take is high.
    const _effTake = r.eligible && price > 0 ? (r.totalFees + (r.sellerShip||0)) / price * 100 : 0;
    const isBadValue = r.eligible && !isWin && _effTake > 30;

    const cls = ['plat-card', isWin ? 'best' : '', isWrst ? 'worst' : '', !r.eligible ? 'worst' : '', isBadValue ? 'bad-value' : ''].filter(Boolean).join(' ');

    // Keep the tile as a div. It contains source/methodology links and a
    // Details button, so wrapping the entire tile in <a> creates invalid
    // nested anchors. Browsers auto-close that outer anchor, ejecting the fee
    // recipe and breaking the mobile Details control.
    const sellUrl = window._platSellUrls ? (window._platSellUrls[r.pid] || '') : '';
    // A venue that cannot take THIS card (wrong game, US sellers barred) still
    // gets a live link, but calling it "Sell on X" would promise a sale that
    // cannot happen. Ineligible venues say "View on X" instead.
    const sellVerb  = r.eligible ? 'Sell on' : 'View on';
    const sellAria  = r.eligible
      ? `Open ${info.name} to sell this card`
      : `Open ${info.name} (this card cannot be sold there)`;
    const sellBadge = sellUrl
      ? `<a class="plat-sell-badge" href="${esc(sellUrl)}" target="_blank" rel="noopener" aria-label="${esc(sellAria)}">${sellVerb} ${esc(info.name)} <span class="plat-sell-arrow">→</span></a>`
      : '';

    // 2026-08-15: effort/hassle transparency — shown as a colored badge under
    // the platform name + a 1-line reality-check note. This lets sellers see
    // the tradeoff (fee % vs time-to-sale vs buyer protection) BEFORE they
    // pick a platform by payout alone. Design principle: don't push, don't hide.
    const effortCls  = 'eff-' + (info.effort || 'easy');
    const effortText = info.effortLabel || '';
    const effortHtml = effortText
      ? `<div class="plat-effort ${effortCls}"><span class="dot"></span>${effortText}</div>`
      : '';
    const hassleHtml = info.hassle
      ? `<div class="plat-hassle">${info.hassle}</div>`
      : '';
    /* Time-to-sell tag. The `why` line is always rendered with it — the tier
       alone ("Sells fast") is an assertion, and the seller is entitled to the
       reason before they trust it against a dollar figure. */
    const _sp = sellSpeed(r.pid);
    const speedHtml = _sp
      ? `<div class="plat-speed sp-${_sp.tier}"><span class="sdot"></span><span>${esc(_sp.label)}</span></div>
         <div class="plat-speed-why">${esc(_sp.why)}</div>`
      : '';
    // 2026-08-19: Rules of Sale panel — payout time + red-flag pills for
    // ship-in, consignment, live-auction, and other things that a seller
    // needs to know BEFORE picking this platform.
    const workflowLabelMap = {
      list:        '🛠️ Workflow: List &amp; ship yourself',
      shipIn:      '📦 Workflow: Ship-in required (they hold the card)',
      consignment: '🤝 Workflow: Consignment (they auction it for you)',
      liveAuction: '🎥 Workflow: Live auction / audience required',
      buylist:     '💰 Workflow: Buylist — instant offer, no listing'
    };
    const workflowText = info.workflow ? (workflowLabelMap[info.workflow] || '') : '';
    const payoutText   = info.payoutTime ? `💰 Payout schedule: ${esc(info.payoutTime)}` : '';
    // Positive framing pill — "here's where this platform shines" — rendered
    // just above the amber red-flag row so users see the sweet spot first.
    const bestForHtml  = info.bestFor ? `<div class="plat-bestfor">${esc(info.bestFor)}</div>` : '';
    const redFlagsHtml = Array.isArray(info.redFlags) && info.redFlags.length
      ? `<div class="plat-rules">
           ${workflowText ? `<div class="plat-rule-line">${workflowText}</div>` : ''}
           ${payoutText   ? `<div class="plat-rule-line">${payoutText}</div>` : ''}
           <div class="plat-flags">${info.redFlags.map(f => `<span class="plat-flag">${esc(f)}</span>`).join('')}</div>
         </div>`
      : '';

    if (!r.eligible) {
      /* A blocked venue shows — for its payout, because for most of them (wrong
         game, card not carried) there is genuinely no number to show.

         One exception: when the venue is blocked ONLY because the seller has not
         confirmed account access, and the fee inputs are all present, the payout
         is fully computed and true. Hiding it there would hide the very number
         the seller needs to decide whether the account is worth opening —
         $370.11 on Cardmarket against $366.13 on TCGplayer. So we show it,
         greyed, explicitly labelled reference, and still barred from the crown.
         Postage-blocked stays —, since without postage the net is not knowable. */
      const _refOk  = r.applicable && venueBlockReason(r.pid) &&
                      venueRequirementsMetExcept(r.pid, 'cmAccount') &&
                      Number.isFinite(r.netPayout) && r.netPayout > 0;
      const payoutHtml = _refOk
        ? `<div class="plat-payout" style="color:var(--text-muted)">${fmt(r.netPayout)}
             <span style="display:block;font-size:.62rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-faint)">For reference · not ranked</span>
           </div>`
        : `<div class="plat-payout" style="color:var(--text-faint)">—</div>`;
      html += `<div class="${cls}" style="opacity:.4"${sellUrl ? ` data-sell-url="${esc(sellUrl)}"` : ''}>
        <div class="plat-accent" style="background:${info.color}"></div>
        <div class="plat-hdr"><span class="plat-name">${info.emoji} ${info.name}${info.region ? `<span class="plat-region" title="${esc(info.regionNote||'')}">${esc(info.region)}</span>` : ''}</span>${badgeHtml}</div>
        ${effortHtml}
        ${speedHtml}
        ${payoutHtml}
        <div class="plat-sub">${r.note}</div>
        ${sellBadge}
        ${crossBorderHtml(r.pid)}
      </div>`;
      return;
    }

    html += `<div class="${cls}"${sellUrl ? ` data-sell-url="${esc(sellUrl)}"` : ''}>
      <div class="plat-accent" style="background:${info.color}"></div>
      <div class="plat-hdr">
        <span class="plat-name">${info.emoji} ${info.name}${info.region ? `<span class="plat-region" title="${esc(info.regionNote||'')}">${esc(info.region)}</span>` : ''}</span>
        ${badgeHtml}
      </div>
      ${effortHtml}
      ${speedHtml}
      <div class="plat-payout ${r.netPayout >= 0 ? 'pos' : 'neg'}">${fmt(r.netPayout)}</div>
      ${sellBadge}
      ${itemCost > 0
        ? `<div class="plat-sub">Profit: <span style="color:${r.grossProfit>=0?'var(--green)':'var(--red)'};font-weight:600">${fmt(r.grossProfit)}</span> · <span style="${r.margin>=0?'color:var(--green)':'color:var(--red)'}">${r.margin.toFixed(1)}%</span></div>`
        : `<div class="plat-sub">After all fees &amp; shipping</div>`}
      ${hassleHtml}
      ${bestForHtml}
      ${redFlagsHtml}
      ${crossBorderHtml(r.pid)}
      ${r.note ? `<div class="note-italic">${r.note}</div>` : ''}
      <div class="fee-block">
        <!-- 2026-09-01 (Issue 2): the row is auditable end-to-end. A stranger
             should be able to rebuild the net from Price used + Fees + Ship +
             Cash-out on a phone calculator and land within a cent. -->
        <div class="fee-recipe">
          <div class="fee-row fee-recipe-row"><span>Price used <span class="fee-basis">(${esc(r.priceLabel)})</span></span><span class="fee-val">${fmt(r.priceUsed)}</span></div>
          ${r.shipCharge > 0 ? `<div class="fee-row fee-recipe-row"><span>Buyer-paid shipping</span><span class="fee-val">${fmt(r.shipCharge)}</span></div>` : ''}
          ${r.feeBase != null ? `<div class="fee-row fee-recipe-row"><span>Fee base <span class="fee-basis">(${esc(r.feeBaseLabel || 'item')})</span></span><span class="fee-val">${fmt(r.feeBase)}</span></div>` : ''}
          ${r.taxNote ? `<div class="fee-row fee-recipe-row"><span>Buyer sales tax <span class="fee-basis">(not modeled)</span></span><span class="fee-val">${fmt(0)}</span></div>` : ''}
          ${r.feeFormula ? `<div class="fee-row fee-recipe-row"><span>Fee formula</span><span class="fee-val">${esc(r.feeFormula)}</span></div>` : ''}
        </div>
        ${r.feeItems.map(f => `<div class="fee-row"><span>${f.l}</span><span class="fee-val">−${fmt(f.a)}</span></div>`).join('')}
        ${r.sellerShip > 0 ? `<div class="fee-row"><span>Your ship-out cost</span><span class="fee-val">−${fmt(r.sellerShip)}</span></div>` : ''}
        <div class="fee-row fee-total"><span>Net after all deductions</span><span class="fee-val">${fmt(r.netPayout)}</span></div>
        ${r.daysToCash ? `<div class="fee-row fee-days-row"><span>Payout time after it sells</span><span class="fee-val">${esc(r.daysToCash)}</span></div>` : ''}
        ${info.verified ? (() => {
          // 2026-09-01: pill color reflects staleness. >45d = amber + "Stale" text (venue also
          // demoted from #1 by the payout ranker); 31-45d = amber pill but still "Verified";
          // ≤30d = green. All three link to /accuracy#fees for the methodology.
          const _stale = isFeeStale(r.pid);
          const _amber = isFeeAmber(r.pid);
          const _cls   = _stale || _amber ? 'fee-verified-pill stale' : 'fee-verified-pill';
          const _label = _stale ? 'Stale' : 'Verified';
          const _title = _stale
            ? 'This venue\'s fees haven\'t been re-verified in over 45 days, so we won\'t rank it #1. Click for methodology.'
            : 'View methodology + full fee sources';
          return `<div class="fee-verified-row"><a href="/accuracy#fees" class="${_cls}" title="${_title}"><span class="fee-verified-dot">•</span>${_label} ${info.verified}</a></div>`;
        })() : ''}
      </div>
      <button class="plat-details-toggle" type="button" onclick="event.preventDefault();event.stopPropagation();this.closest('.plat-card').classList.toggle('expanded');">
        <span class="toggle-text">Details</span>
        <span class="caret">▾</span>
      </button>
    </div>`;
  };

  // Emit each section as its own .plat-grid with a section header above it.
  // Empty sections are omitted so users don't see "Ship-in / consignment (0)"
  // when their tier doesn't include those platforms.
  sectionDefs.forEach(secDef => {
    const secTiles = displaySorted.filter(r => sectionOf(r.pid) === secDef.key);
    if (!secTiles.length) return;
    const eligibleCount = secTiles.filter(r => r.eligible).length;
    html += `<div class="plat-section">
      <div class="plat-section-hdr">
        <span class="sec-icon">${secDef.icon}</span>
        <span>${secDef.label}</span>
        <span class="sec-count">${eligibleCount} available</span>
      </div>
      ${secDef.sub ? `<div class="plat-section-sub">${secDef.sub}</div>` : ''}
      <div class="plat-grid ${density === 'compact' ? 'compact' : ''}">`;
    secTiles.forEach(renderTile);
    html += `</div></div>`;
  });

  // Pro gate — Pro-only platforms blurred to entice upgrade
  if (!window._isPro || (window._userTier && window._userTier !== 'pro_max' && window._userTier !== 'ultimate')) {
    const _uTier = window._userTier || (window._isPro ? 'pro' : 'free');
    const _visible = platformsForTier(_uTier);
    // `applicable`, not `eligible`: a locked venue is by definition not eligible
    // (the plan does not unlock it), so filtering on eligible emptied this list
    // and the upsell rendered "0 More Platforms".
    const proOnlyResults = results.filter(r => !_visible.has(r.pid) && r.applicable);
    proOnlyResults.sort((a, b) => b.netPayout - a.netPayout);
    // Compare Pro platforms against the best of the free tier (not just eBay),
    const bestFreePayout = Math.max(
      ...results.filter(r => _visible.has(r.pid) && r.applicable && venueEnabled(r.pid)).map(r => r.netPayout),
      0
    );
    const mightEarnMore = proOnlyResults[0] && proOnlyResults[0].netPayout > bestFreePayout;
    const bestAlt = proOnlyResults[0];
    const diff = bestAlt ? (bestAlt.netPayout - bestFreePayout) : 0;

    const blurRows = proOnlyResults.map(r => {
      const info = PLATFORMS[r.pid];
      const isBetter = r.netPayout > bestFreePayout;
      // Mini effort dot so users see the tradeoff without needing to unlock.
      const eColor = info.effort === 'easy' ? '#4ade80' : info.effort === 'medium' ? '#fbbf24' : '#f87171';
      const eTag   = info.effort ? `<span title="${info.hassle || ''}" style="display:inline-flex;align-items:center;gap:.25rem;font-size:.62rem;font-weight:700;color:${eColor};text-transform:uppercase;letter-spacing:.03em"><span style="width:.35rem;height:.35rem;border-radius:50%;background:${eColor};display:inline-block"></span>${info.effort}</span>` : '';
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:.45rem 0;border-bottom:1px solid rgba(255,255,255,.06)">
        <span style="font-size:.78rem;font-weight:600;color:var(--text-muted);display:flex;align-items:center;gap:.35rem">${info.emoji} ${info.name} ${eTag}</span>
        <span style="font-family:var(--mono);font-size:.88rem;font-weight:700;filter:blur(5px);user-select:none;color:${isBetter?'var(--green)':'var(--text)'}">${fmt(r.netPayout)}</span>
      </div>`;
    }).join('');

    // Dynamic count — free users on Pokemon see 3 locked (Poshmark/Whatnot/
    // Mercari), free MTG users see 5 (adds Mana Pool + Cardsphere), Pro users
    // see whatever their tier hasn’t unlocked yet. Header + CTA both mirror
    // the actual locked count so the pitch never lies.
    const _lockedCount = proOnlyResults.length;
    const _lockedLabel = _lockedCount === 1 ? '1 More Platform' : `${_lockedCount} More Platforms`;
    // What the user is upgrading TO. If they're on free, Pro is the entry step.
    // If they're already Pro, the remaining locked (COMC/Fanatics) is Pro Max.
    const _upgradeTarget = _uTier === 'free' ? 'Pro' : 'Pro Max';
    const _upgradePrice  = _uTier === 'free' ? '$9.99/mo' : '$19.99/mo';
    // Ordered list of what's actually locked, for the sub-caption.
    // Foreign-operated venues keep their flag even in the locked teaser list,
    // so a seller knows before paying that some of what they're unlocking is
    // a non-US company with its own currency and eligibility rules.
    // 2026-09-01 (launch gate): the CTA must promise what the TARGET tier
    // actually unlocks, not how many venues happen to be locked.
    //
    // proOnlyResults is every locked eligible venue — 13 of them for a Free
    // user. But Pro only adds 7 (Free 2 -> Pro 9); the other 6 need Pro Max. So
    // a button reading "See 13 more venues — $9.99/mo" was a straightforward
    // false claim, and exactly the kind /accuracy exists to rule out.
    const _targetVisible     = platformsForTier(_uTier === 'free' ? 'pro' : 'pro_max');
    const _targetUnlocks     = proOnlyResults.filter(r => _targetVisible.has(r.pid));
    const _targetUnlockCount = _targetUnlocks.length;
    const _beyondCount       = proOnlyResults.length - _targetUnlockCount;
    // Name the venues the money being asked for actually buys, and disclose the
    // remainder as a higher tier rather than letting them read as included.
    const _lockedNames = (_targetUnlocks.length ? _targetUnlocks : proOnlyResults)
      .map(r => PLATFORMS[r.pid].name + (CROSS_BORDER[r.pid]?.foreign ? ` ${CROSS_BORDER[r.pid].flag}` : ''))
      .join(', ') + (_beyondCount > 0 ? ` · +${_beyondCount} more on Pro Max` : '');
    html += `
    <div class="plat-card" style="background:linear-gradient(135deg,rgba(196,122,0,.10),rgba(196,122,0,.05));border:1.5px solid rgba(196,122,0,.4);cursor:pointer;position:relative;overflow:hidden" onclick="startVenueUnlock('calc_gate_card')">
      <div class="plat-accent" style="background:linear-gradient(135deg,#b8860b,#f5c518)"></div>
      <div class="plat-hdr" style="margin-bottom:.3rem">
        <span class="plat-name">&#11088; ${_lockedLabel}</span>
        <span style="font-size:.65rem;font-weight:800;background:linear-gradient(135deg,#b8860b,#f5c518);color:#000;padding:.15rem .45rem;border-radius:99px;letter-spacing:.04em">${esc(_upgradeTarget.toUpperCase())}</span>
      </div>
      ${mightEarnMore && diff > 0.5
          ? `<div style="font-size:.76rem;font-weight:700;color:var(--gold-text);margin-bottom:.5rem">&#9650; You could net <strong>$${diff.toFixed(2)} more</strong> on ${esc(PLATFORMS[bestAlt.pid].name)}</div>`
          : mightEarnMore
            ? `<div style="font-size:.72rem;font-weight:700;color:var(--gold-text);margin-bottom:.5rem">&#9650; A ${esc(_upgradeTarget)} platform pays more than any free one</div>`
            : `<div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.5rem">See exact payouts across all platforms</div>`}
      <div style="opacity:.85">${blurRows}</div>
      <div style="text-align:center;margin-top:.75rem">
        <button class="pro-gate-btn" style="font-size:.78rem;padding:.45rem 1.2rem;width:100%" onclick="event.stopPropagation();startVenueUnlock('calc_gate_btn')">See ${_targetUnlockCount} more venue${_targetUnlockCount === 1 ? '' : 's'} — ${esc(_upgradePrice)}</button>
        <div style="font-size:.66rem;color:var(--text-faint);margin-top:.35rem">${esc(_lockedNames)}</div>
        <button type="button" style="background:none;border:0;padding:.3rem;margin-top:.15rem;font-size:.66rem;color:var(--text-faint);text-decoration:underline;cursor:pointer" onclick="event.stopPropagation();openPricingModal('calc_gate_compare')">Compare all plans</button>
      </div>
    </div>`;

  // ── Deal Score (free + Pro path; Pro Max / Ultimate fall through to the
  //    dedicated blocks after this branch's early return at the bottom) ──────
  if (itemCost > 0) {
    const _dsRef   = tierWinner || winner;
    if (_dsRef) {
      const _bestNet   = _dsRef.netPayout;
      const _profit    = _bestNet - itemCost;
      const _margin    = price > 0 ? (_profit / price) * 100 : 0;
      const _roi       = itemCost > 0 ? (_profit / itemCost) * 100 : 0;
      const _roiScore  = Math.min(100, Math.max(0, (_roi / 50) * 50 + 50));
      const _margScore = Math.min(100, Math.max(0, _margin * 2.5));
      const _absScore  = Math.min(100, Math.max(0, _profit * 5));
      const _dealScore = Math.round((_roiScore * 0.35) + (_margScore * 0.40) + (_absScore * 0.25));
      const _verdict   = _dealScore >= 70 ? 'Buy'  : _dealScore >= 40 ? 'Maybe' : 'Pass';
      const _vColor    = _dealScore >= 70 ? '#4ade80' : _dealScore >= 40 ? '#facc15' : '#f87171';
      const _vEmoji    = _dealScore >= 70 ? '🟢' : _dealScore >= 40 ? '🟡' : '🔴';
      const _vTip      = _dealScore >= 70
        ? `Strong ROI — good margins on ${PLATFORMS[_dsRef.pid].name}`
        : _dealScore >= 40
          ? 'Decent margins — consider fees &amp; time carefully'
          : 'Thin margins after fees — look for a lower buy price';
      html += `<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:.7rem .9rem;margin-top:.75rem;display:flex;align-items:center;gap:.75rem">
        <div style="flex:0 0 auto;text-align:center">
          <div style="font-size:1.35rem;font-weight:900;color:${_vColor};line-height:1">${_dealScore}</div>
          <div style="font-size:.58rem;color:rgba(255,255,255,.38);margin-top:.1rem">DEAL SCORE</div>
        </div>
        <div style="width:1px;height:2.2rem;background:rgba(255,255,255,.1)"></div>
        <div style="flex:1">
          <div style="font-size:.9rem;font-weight:800;color:${_vColor}">${_vEmoji} ${_verdict}</div>
          <div style="font-size:.68rem;color:rgba(255,255,255,.5);margin-top:.1rem">${_vTip}</div>
        </div>
      </div>`;
      // For free "Buy" verdicts: show Pro platform nudge
      if (!window._isPro && _verdict === 'Buy') {
        // Count what Pro actually adds for THIS card (game-aware). Pokemon
        // free → Pro adds 3 (Poshmark, Whatnot, Mercari). MTG free → Pro adds 5
        // (adds Mana Pool + Cardsphere). Never claim more than we deliver.
        const _proAddCount = results.filter(r => r.eligible && PRO_PLATFORMS.has(r.pid) && !FREE_PLATFORMS.has(r.pid)).length;
        const _nudgeCopy = _proAddCount > 0
          ? `Pro unlocks ${_proAddCount} more marketplace${_proAddCount === 1 ? '' : 's'} — maximize this deal`
          : 'Pro Max unlocks COMC + Fanatics Collect — maximize this deal';
        html += `<div style="margin-top:.35rem;padding:.45rem .9rem;background:rgba(196,122,0,.08);border:1px solid rgba(196,122,0,.2);border-radius:8px;display:flex;align-items:center;justify-content:space-between;gap:.5rem;cursor:pointer" onclick="openPricingModal('deal_score_nudge')">
          <span style="font-size:.7rem;color:rgba(196,122,0,.9)">${esc(_nudgeCopy)}</span>
          <span style="font-size:.68rem;font-weight:800;color:var(--gold-text);white-space:nowrap">Upgrade →</span>
        </div>`;
      }
    }
  }

  // ── Max Buy Price (shared: free + pro) ────────────────────────────
  {
    const _mbpRef = tierWinner || winner;
    if (_mbpRef && price > 0) {
      const _bestNetMBP = _mbpRef.netPayout;
      const _targetMargins = [20, 30, 40];
      const _maxBuyRows = _targetMargins.map(t => {
        const maxCost = _bestNetMBP - (price * t / 100);
        return maxCost > 0
          ? `<span style="margin-right:.75rem"><span style="color:rgba(255,255,255,.45);font-size:.68rem">${t}%&rarr;</span> <strong style="color:var(--text);font-size:.82rem">${fmt(maxCost)}</strong></span>`
          : '';
      }).filter(Boolean).join('');
      if (_maxBuyRows) {
        html += `<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:.6rem .9rem;margin-top:.5rem">
          <div style="font-size:.68rem;font-weight:800;letter-spacing:.05em;color:rgba(255,255,255,.4);margin-bottom:.35rem">MAX BUY PRICE (via ${PLATFORMS[_mbpRef.pid].name})</div>
          <div style="display:flex;flex-wrap:wrap;gap:.2rem">${_maxBuyRows}</div>
          <div style="font-size:.6rem;color:rgba(255,255,255,.28);margin-top:.3rem">Don't pay more than these to hit your target margin</div>
        </div>`;
      }
    }
  }

    resultsArea.innerHTML = html;
    _onCardResultShown();
    // 2026-09-03: this branch (free + Pro) used to return here while the ONLY
    // renderQuickPricing() call in calc() sat past the Pro Max / Ultimate
    // blocks below. So on the tiers most people are on, Quick Pricing never
    // re-rendered after a price change -- which is why switching grades left
    // the raw Sell Now / Market / Top of Book tiles and the raw position bar
    // frozen under a graded headline. Every exit path from calc() must
    // refresh the widget, or the widget silently describes a stale price.
    try { renderQuickPricing(); } catch(_) {}
    return;
  }

  // ── Deal Score (Pro path) ─────────────────────────────────────────
  if (itemCost > 0 && winner) {
    const _bestNet2   = winner.netPayout;
    const _profit2    = _bestNet2 - itemCost;
    const _margin2    = price > 0 ? (_profit2 / price) * 100 : 0;
    const _roi2       = itemCost > 0 ? (_profit2 / itemCost) * 100 : 0;
    const _roiScore2  = Math.min(100, Math.max(0, (_roi2 / 50) * 50 + 50));
    const _margScore2 = Math.min(100, Math.max(0, _margin2 * 2.5));
    const _absScore2  = Math.min(100, Math.max(0, _profit2 * 5));
    const _dealScore2 = Math.round((_roiScore2 * 0.35) + (_margScore2 * 0.40) + (_absScore2 * 0.25));
    const _verdict2   = _dealScore2 >= 70 ? 'Buy'  : _dealScore2 >= 40 ? 'Maybe' : 'Pass';
    const _vColor2    = _dealScore2 >= 70 ? '#4ade80' : _dealScore2 >= 40 ? '#facc15' : '#f87171';
    const _vEmoji2    = _dealScore2 >= 70 ? '🟢' : _dealScore2 >= 40 ? '🟡' : '🔴';
    const _vTip2      = _dealScore2 >= 70
      ? `Strong ROI — good margins on ${PLATFORMS[winner.pid].name}`
      : _dealScore2 >= 40
        ? 'Decent margins — consider fees &amp; time carefully'
        : 'Thin margins after fees — look for a lower buy price';
    html += `<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:.7rem .9rem;margin-top:.75rem;display:flex;align-items:center;gap:.75rem">
      <div style="flex:0 0 auto;text-align:center">
        <div style="font-size:1.35rem;font-weight:900;color:${_vColor2};line-height:1">${_dealScore2}</div>
        <div style="font-size:.58rem;color:rgba(255,255,255,.38);margin-top:.1rem">DEAL SCORE</div>
      </div>
      <div style="width:1px;height:2.2rem;background:rgba(255,255,255,.1)"></div>
      <div style="flex:1">
        <div style="font-size:.9rem;font-weight:800;color:${_vColor2}">${_vEmoji2} ${_verdict2}</div>
        <div style="font-size:.68rem;color:rgba(255,255,255,.5);margin-top:.1rem">${_vTip2}</div>
      </div>
    </div>`;
  }
  if (winner && price > 0) {
    const _bestNetMBP2 = winner.netPayout;
    const _maxBuyRows2 = [20, 30, 40].map(t => {
      const maxCost = _bestNetMBP2 - (price * t / 100);
      return maxCost > 0
        ? `<span style="margin-right:.75rem"><span style="color:rgba(255,255,255,.45);font-size:.68rem">${t}%&rarr;</span> <strong style="color:var(--text);font-size:.82rem">${fmt(maxCost)}</strong></span>`
        : '';
    }).filter(Boolean).join('');
    if (_maxBuyRows2) {
      html += `<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:.6rem .9rem;margin-top:.5rem">
        <div style="font-size:.68rem;font-weight:800;letter-spacing:.05em;color:rgba(255,255,255,.4);margin-bottom:.35rem">MAX BUY PRICE (via ${PLATFORMS[winner.pid].name})</div>
        <div style="display:flex;flex-wrap:wrap;gap:.2rem">${_maxBuyRows2}</div>
        <div style="font-size:.6rem;color:rgba(255,255,255,.28);margin-top:.3rem">Don't pay more than these to hit your target margin</div>
      </div>`;
    }
  }

  // Bar chart
  if (eligible.length > 1) {
    html += `<div class="bar-chart"><div class="bar-hdr">Payout Comparison</div>`;
    eligible.forEach(r => {
      const pct      = maxPay > 0 ? Math.max(0, (r.netPayout / maxPay) * 100).toFixed(1) : 0;
      const barColor = r.pid === winner.pid ? 'var(--green)' : PLATFORMS[r.pid].color;
      html += `<div class="bar-row">
        <span class="bar-lbl">${PLATFORMS[r.pid].name}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
        <span class="bar-val" style="color:${r.netPayout>=0?'var(--text)':'var(--red)'}">${fmt(r.netPayout)}</span>
      </div>`;
    });
    html += `</div>`;
  }

  resultsArea.innerHTML = html;
  _onCardResultShown();
  try { renderQuickPricing(); } catch(_) {}
}

function setSort(m) {
  sortMode = m;
  // Only recalc if there's a price to work with
  const price = getEffectivePrice();
  if (price > 0) {
    calc();
  } else {
    // Just update the button active state visually
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase().includes(m === 'payout' ? 'payout' : '%')));
  }
}

// 2026-08-29: Density toggle (compact vs detailed marketplace tiles).
// Persists to localStorage so the user's preference survives reloads.
function setDensity(mode) {
  if (mode !== 'compact' && mode !== 'detailed') return;
  try { localStorage.setItem('cr_density', mode); } catch(_) {}
  window._crDensity = mode;
  // Toggle grid class directly to avoid full recalc — also update button states.
  document.querySelectorAll('.plat-grid').forEach(g => g.classList.toggle('compact', mode === 'compact'));
  document.querySelectorAll('.density-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.trim().toLowerCase() === mode);
  });
  // When switching to compact, collapse any previously expanded cards.
  if (mode === 'compact') {
    document.querySelectorAll('.plat-card.expanded').forEach(c => c.classList.remove('expanded'));
  }
}

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return (n < 0 ? '−' : '') + '$' + Math.abs(n).toFixed(2);
}

function showIntro() {
  if (activeGame === 'sports') {
    resultsArea.innerHTML = `<div class="intro-state">
      <div class="intro-icon">⚾</div>
      <div class="intro-h">Search eBay comps, then enter your price</div>
      <p class="intro-p">Use the <strong>Search eBay</strong> bar above to find sold comps for your card, then type a price in the <strong>Override field</strong> to see platform payouts.</p>
    </div>`;
    if (selectedCard && !priceOverride.value) {
      priceOverride.style.boxShadow = '0 0 0 2px var(--gold)';
      setTimeout(() => { priceOverride.style.boxShadow = ''; }, 2000);
    }
    return;
  }
  if (activeGame === 'pokemonjp' && !priceOverride.value) {
    resultsArea.innerHTML = `<div class="intro-state">
      <div class="intro-icon">🇯🇵</div>
      <div class="intro-h">Search a JP card, click JP COMPS</div>
      <p class="intro-p">Type a card name, then click the gold JP COMPS row to open eBay Japanese sold listings. Use the <strong>Override field</strong> to enter the JP price you find.</p>
    </div>`;
    if (selectedCard) {
      priceOverride.style.boxShadow = '0 0 0 2px var(--gold)';
      setTimeout(() => { priceOverride.style.boxShadow = ''; }, 2000);
    }
    return;
  }
  if (!selectedCard && !priceOverride.value) {
    resultsArea.innerHTML = `<div class="intro-state">
      <div class="intro-icon">🃏</div>
      <div class="intro-h">Search for a card to get started</div>
      <p class="intro-p">Find any Pokémon, Magic, Yu-Gi-Oh!, Lorcana or One Piece card and see exactly where to sell it for maximum profit.</p>
    </div>`;
    return;
  }
  resultsArea.innerHTML = `<div class="intro-state">
    <div class="intro-icon">💰</div>
    <div class="intro-h">Enter a sale price to calculate</div>
    <p class="intro-p">Type a price in the <strong>Override field above</strong>, or select a variant to auto-fill — then hit <strong>⚡ Calculate</strong>.</p>
  </div>`;
  if (!priceOverride.value) {
    priceOverride.style.boxShadow = '0 0 0 2px var(--gold)';
    setTimeout(() => { priceOverride.style.boxShadow = ''; }, 2000);
  }
}

/* ─── THEME TOGGLE ─── */
(function(){
  const btn  = document.querySelector('[data-theme-toggle]');
  const root = document.documentElement;
  let d = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  root.setAttribute('data-theme', d);

  function setIcon() {
    if (!btn) return;
    btn.innerHTML = d === 'dark'
      ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`
      : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  }
  setIcon();
  btn && btn.addEventListener('click', () => {
    d = d === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', d);
    setIcon();
  });
})();

/* ═══════════════════════════════════════
   MY FLIPS — Flip Log + Portfolio + P&L
   ═══════════════════════════════════════ */

// ── Storage helpers (user-scoped; fall back to global key when not signed in) ──
// NOTE: definitive versions are declared below in the Google Sign-In section.
// Temporary stubs here are replaced at runtime by the user-scoped versions.

// ── View switching ──
function _updateFlipsSignInWall() {
  const wall = document.getElementById('flipsSignInWall');
  const pnl  = document.getElementById('pnlGrid');
  const flipLog = document.getElementById('flipLogWrap');
  const portfolio = document.getElementById('portfolioSection');
  const flHeader = document.querySelector('.fl-header');
  if (!wall) return;
  if (!window.googleUser) {
    wall.style.display = 'block';
    if (pnl) pnl.style.display = 'none';
    if (flipLog) flipLog.style.display = 'none';
    if (portfolio) portfolio.style.display = 'none';
    if (flHeader) flHeader.style.display = 'none';
  } else {
    wall.style.display = 'none';
    if (pnl) pnl.style.display = '';
    if (flipLog) flipLog.style.display = '';
    if (portfolio) portfolio.style.display = '';
    if (flHeader) flHeader.style.display = '';
  }
}

function switchView(view) {
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  try { document.body.setAttribute('data-view', view); } catch(_) {}
  const lookup     = document.getElementById('lookupView');
  const flips      = document.getElementById('flipsView');
  const collection = document.getElementById('collectionView');

  // Hide all
  if (lookup)     lookup.classList.remove('hidden');
  if (flips)      flips.classList.remove('active');
  if (collection) collection.style.display = 'none';
  const adminViewEl = document.getElementById('adminView');
  if (adminViewEl) adminViewEl.style.display = 'none';

  if (view === 'flips') {
    if (lookup) lookup.classList.add('hidden');
    if (flips)  flips.classList.add('active');
    _updateFlipsSignInWall();
    renderFlipsView();
  } else if (view === 'collection') {
    if (lookup)     lookup.classList.add('hidden');
    // MUST use display:block (not '') — CSS rule `.flips-view{display:none}` would
    // otherwise re-hide the view. That single rule caused the Collection tab to
    // render as a completely blank area (wall hidden, content hidden by CSS default).
    if (collection) collection.style.display = 'block';
    renderCollectionView();
  } else if (view === 'admin') {
    // Extra guard: only inject & show admin UI after confirming owner sub server-side.
    if (window._userSub !== window._OWNER_SUB) { switchView('lookup'); return; }
    if (lookup) lookup.classList.add('hidden');
    const adminView = document.getElementById('adminView');
    if (!adminView) return;
    // Inject admin HTML on first open (keeps it out of the public source bundle)
    if (!adminView.dataset.loaded) {
      adminView.dataset.loaded = '1';
      adminView.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem">
          <div style="font-size:.88rem;font-weight:800;color:var(--text);letter-spacing:-.01em">⚙️ Admin Dashboard</div>
          <div style="display:flex;gap:.4rem">
            <button onclick="exportSubscriberCSV()" style="padding:.35rem .75rem;background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.3);color:#4ade80;border-radius:var(--radius-md);font-size:.72rem;font-weight:700;cursor:pointer">⬇ Export Emails</button>
            <button onclick="loadAdminData()" id="adminRefreshBtn" style="padding:.35rem .75rem;background:var(--surface-2);border:1px solid var(--border);color:var(--gold-text);border-radius:var(--radius-md);font-size:.72rem;font-weight:700;cursor:pointer">↻ Refresh</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-bottom:1rem">
          <div class="pnl-card" style="border-color:rgba(74,222,128,.25)"><div class="pnl-label">Pro Users</div><div class="pnl-value pos" id="adminProUsers">—</div><div class="pnl-sub" id="adminProSub"></div></div>
          <div class="pnl-card" style="border-color:rgba(196,122,0,.25)"><div class="pnl-label">Est. MRR</div><div class="pnl-value" id="adminMRR" style="color:var(--gold-text)">—</div><div class="pnl-sub" id="adminMRRSub">active subscriptions</div></div>
          <div class="pnl-card"><div class="pnl-label">Newsletter</div><div class="pnl-value" id="adminNewsletter">—</div><div class="pnl-sub">subscribers</div></div>
          <div class="pnl-card"><div class="pnl-label">Total Signups</div><div class="pnl-value" id="adminSignups">—</div><div class="pnl-sub" id="adminReferralSub"></div></div>
        </div>
        <div class="section-panel" style="margin-top:.5rem">
          <div class="section-hdr"><div class="section-title">📥 Recent Subscribers</div></div>
          <div id="adminEmailList" style="font-size:.72rem;color:var(--text-muted);line-height:2">Loading…</div>
        </div>
        <div style="font-size:.62rem;color:var(--text-muted);margin-top:.75rem;text-align:center" id="adminGeneratedAt"></div>`;
    }
    adminView.style.display = '';
    loadAdminData();
  }
  // else: lookup (default) — already shown above
}

// ── Modal state ──
let _modalMode = 'flip'; // 'flip' or 'hold'

function addCurrentCardToCollection() {
  // 2026-08-14 fix: previously anonymous users were bounced straight to sign-in
  // which lost their card-lookup context and made the button look broken.
  // Now we let signed-out users save to the unscoped `cardsell_portfolio`
  // key (getUserKey falls back to it when window.googleUser is null); on
  // sign-in, _migrateAnonDataToUser() merges those entries into the user's
  // scoped key so nothing is lost. The #anonSyncBanner reminds them to sign
  // in later to unlock scan-credit features + cross-device sync.
  if (!selectedCard || !selectedCard.name) {
    showToast('Search for a card first, then tap Add to My Collection.');
    return;
  }
  // Pre-fill the hold modal with current card data
  _modalMode = 'hold';
  const modal = document.getElementById('flipModal');
  const title = document.getElementById('modalTitle');
  const sellField = document.getElementById('mSellPriceField');
  const platField = document.getElementById('mPlatformField');
  if (title) title.textContent = 'Add Card to Collection';
  if (sellField) sellField.style.display = 'none';
  if (platField) platField.style.display = 'none';
  const costField = document.getElementById('mCostsField');
  if (costField) costField.style.display = 'none';
  // Set today's date
  document.getElementById('mDate').value = new Date().toISOString().slice(0,10);
  // Pre-fill card info
  document.getElementById('mCardName').value = selectedCard.name || '';
  document.getElementById('mSetName').value = [selectedCard.setName, selectedCard.number].filter(Boolean).join(' · ');
  const price = getEffectivePrice();
  if (price) document.getElementById('mCurrentValue').value = price.toFixed(2);
  // Capture the current grader + grade selection so saveFlipEntry() can
  // persist them on the portfolio entry. Also show the banner so the user
  // sees they're saving a graded card (not a raw one) BEFORE hitting save.
  _syncFlipModalGradeBanner();
  modal.classList.add('open');
  // Show a brief toast hint. Anonymous users get a friendlier nudge so they
  // understand their card IS being saved (locally) and sign-in is optional.
  if (window._userSub || window.googleUser) {
    showToast('Fill in your purchase cost and tap Save to track this card 📦');
  } else {
    showToast('Saving to this device — verify email later for 10 free ID scans + 1 AI Grade 🎁');
  }
}

// Read the currently-selected grader pill + grade on the lookup page and
// (a) stash them on the modal for saveFlipEntry to persist, (b) toggle the
// gold "Saving as PSA 10" banner inside the modal.
function _syncFlipModalGradeBanner() {
  const banner    = document.getElementById('mGradeBanner');
  const labelEl   = document.getElementById('mGradeBannerLabel');
  const modalBox  = document.querySelector('#flipModal .modal-box');
  const graderKey = document.querySelector('#gradedPills .pill.sel')?.dataset?.val || 'no';
  const gradeVal  = document.getElementById('gradeSelect')?.value || '';
  if (graderKey && graderKey !== 'no' && gradeVal) {
    const names = { psa: 'PSA', bgs: 'BGS', cgc: 'CGC', ace: 'ACE', tag: 'TAG', sgc: 'SGC' };
    const label = `${names[graderKey] || graderKey.toUpperCase()} ${gradeVal}`;
    if (labelEl) labelEl.textContent = label;
    if (banner) banner.style.display = 'flex';
    if (modalBox) {
      modalBox.dataset.grader = graderKey;
      modalBox.dataset.grade  = gradeVal;
    }
  } else {
    if (banner) banner.style.display = 'none';
    if (modalBox) {
      delete modalBox.dataset.grader;
      delete modalBox.dataset.grade;
    }
  }
}

function openAddFlip(mode) {
  _modalMode = mode || 'flip';
  const modal = document.getElementById('flipModal');
  const title = document.getElementById('modalTitle');
  const sellField = document.getElementById('mSellPriceField');
  const platField = document.getElementById('mPlatformField');
  title.textContent = mode === 'hold' ? 'Add Card to Portfolio' : 'Log a Flip';
  if (sellField) sellField.style.display = mode === 'hold' ? 'none' : '';
  if (platField) platField.style.display = mode === 'hold' ? 'none' : '';
  // Fees/shipping/grading only apply to a completed sale, so they follow the
  // same show/hide rule as sell price and platform.
  const costField = document.getElementById('mCostsField');
  if (costField) costField.style.display = mode === 'hold' ? 'none' : '';
  // Set today's date
  document.getElementById('mDate').value = new Date().toISOString().slice(0,10);
  // Pre-fill from selected card if available
  if (selectedCard && selectedCard.name) {
    document.getElementById('mCardName').value = selectedCard.name;
    // If we have a pending grade scan result, tag set/notes with "PSA X Est."
    const baseSet = [selectedCard.setName, selectedCard.number].filter(Boolean).join(' · ');
    if (mode === 'hold' && window._lastScanEstGrade && window._lastScanCardName &&
        selectedCard.name.toLowerCase().includes(window._lastScanCardName.toLowerCase().split(' ')[0])) {
      document.getElementById('mSetName').value = `PSA ${window._lastScanEstGrade} Est. · ${baseSet}`;
    } else {
      document.getElementById('mSetName').value = baseSet;
    }
    const price = getEffectivePrice();
    if (price) document.getElementById('mCurrentValue').value = price.toFixed(2);
  }
  // Capture grader/grade on this entry path too (Portfolio 'Add' button).
  if (mode === 'hold') _syncFlipModalGradeBanner();
  modal.classList.add('open');
}

function closeFlipModal(e) {
  // Only close when clicking the dark backdrop itself, not children
  if (e && !e.target.classList.contains('modal-overlay')) return;
  // Reset the graded banner / dataset so a stale grade never leaks into the
  // next open of the modal for a different (raw) card.
  const banner   = document.getElementById('mGradeBanner');
  const modalBox = document.querySelector('#flipModal .modal-box');
  if (banner) banner.style.display = 'none';
  if (modalBox) { delete modalBox.dataset.grader; delete modalBox.dataset.grade; }
  document.getElementById('flipModal').classList.remove('open');
  clearModal();
}

function clearModal() {
  ['mCardName','mSetName','mBuyPrice','mSellPrice','mCurrentValue',
   'mFees','mShipCost','mGradingCost'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('mDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('mPlatform').value = 'eBay';
}

function saveFlipEntry() {
  const cardName = document.getElementById('mCardName').value.trim();
  const setName  = document.getElementById('mSetName').value.trim();
  const buyPrice = parseFloat(document.getElementById('mBuyPrice').value) || 0;
  const date     = document.getElementById('mDate').value || new Date().toISOString().slice(0,10);
  const curVal   = parseFloat(document.getElementById('mCurrentValue').value) || null;

  if (!cardName) { document.getElementById('mCardName').focus(); return; }

  if (_modalMode === 'hold') {
    // Add to portfolio
    const port = loadPortData();
    // Carry estimated grade if set/notes contains "Est." pattern
    const estGradeMatch = setName.match(/PSA\s*(\d+)\s*Est/i);
    const estGrade = estGradeMatch ? parseInt(estGradeMatch[1]) : null;
    // Persist the confirmed grader + grade the user had selected when they
    // hit "Add to Collection" — without this, the collection view shows the
    // graded price ($405 PSA 10 Lucario) with no indication it's graded, so
    // it's indistinguishable from a raw entry at the same price.
    const modalBox   = document.querySelector('#flipModal .modal-box');
    const savedGrader = modalBox?.dataset?.grader || '';
    const savedGrade  = modalBox?.dataset?.grade || '';
    // Capture card image + number + tcgplayer.url from selectedCard so the
    // Collection view can render a thumbnail and route users straight to the
    // exact TCGplayer product page (via our Impact affiliate) later.
    const cardImg = (selectedCard && (selectedCard.images?.small || selectedCard.images?.large)) || '';
    const cardNum = (selectedCard && selectedCard.number) || '';
    const cardTcgpUrl = (selectedCard && selectedCard.tcgplayer?.url) || '';
    // 2026-08-21: persist game/set/rarity/groundedId so "View full card"
    // from the Collection modal can route straight through the scan-load
    // pipeline (same as if we'd just identified the card) instead of
    // dumping the user into a text-search that loses game context and
    // matches e.g. Pokemon Inkay for a Lorcana "Hades 74".
    const cardGame = (selectedCard && (selectedCard.game))
                   || (typeof activeGame === 'string' ? activeGame : '')
                   || '';
    const cardSetCode = (selectedCard && (selectedCard.setCode || selectedCard.set_code || (selectedCard.set && selectedCard.set.id))) || '';
    const cardGroundedId = (selectedCard && (selectedCard.id || selectedCard.groundedId)) || '';
    const cardRarity = (selectedCard && selectedCard.rarity) || '';
    const cardIsJP = cardGame === 'pokemonjp';
    port.push({
      id: Date.now(),
      updatedAt: Date.now(), // beats any older tombstone for a re-added id
      card: cardName,
      set: setName,
      buyPrice,
      currentValue: curVal,
      addedDate: date,
      estGrade,
      img: cardImg,
      number: cardNum,
      tcgplayerUrl: cardTcgpUrl,
      grader: savedGrader || null,
      grade: savedGrade || null,
      // Identity fields for lossless "View full card" replay:
      game:       cardGame,
      cardType:   cardGame === 'pokemonjp' ? 'pokemon' : cardGame,
      setCode:    cardSetCode,
      groundedId: cardGroundedId,
      rarity:     cardRarity,
      isJapanese: cardIsJP,
    });
    // Keep the modal open if the browser refused the write, so the user can
    // retry or export instead of losing the card silently.
    if (!savePortData(port)) { _reportStorageFailure(); return; }
    window.trackEvent?.('collection_add', {
      source: 'single',
      graded: !!(savedGrader && savedGrade),
      hasPrice: curVal > 0,
    });
  } else {
    // Log flip
    const sellPrice = parseFloat(document.getElementById('mSellPrice').value) || 0;
    const platform  = document.getElementById('mPlatform').value;
    // 2026-09-04: net of fees/shipping/grading, matching the Mark-as-sold path.
    const _gc = (id) => Math.max(0, parseFloat((document.getElementById(id)||{}).value) || 0);
    const fees         = _gc('mFees');
    const shippingCost = _gc('mShipCost');
    const gradingCost  = _gc('mGradingCost');
    const profit    = _flipNetOf({ sellPrice, buyPrice, fees, shippingCost, gradingCost }).net;
    const flips = loadFlipsData();
    // Free users capped at 10 flips (bumped from 5, 2026-08-20)
    if (!window._isPro && flips.length >= 10) {
      document.getElementById('flipModal').classList.remove('open');
      setTimeout(() => openPricingModal('flips_cap'), 200);
      return;
    }
    flips.push({ id: Date.now(), updatedAt: Date.now(), card: cardName, set: setName, buyPrice, sellPrice, fees, shippingCost, gradingCost, profit, platform, date });
    if (!saveFlipsData(flips)) { _reportStorageFailure(); return; }
    // Warn free users when they're 1 flip away from the cap
    if (!window._isPro && flips.length === 9) {
      setTimeout(() => showToast('1 flip slot left on the free plan — Pro unlocks unlimited tracking 📊', 'gold'), 400);
    }
  }

  document.getElementById('flipModal').classList.remove('open');
  clearModal();
  renderFlipsView();
  // Force-rerender the Collection view regardless of whether it's visible — covers
  // the case where the user added from the Collection tab itself but the tab was
  // display:'' rather than display:'block' (falsy check would still skip).
  _maybeRerenderCollection(true);
}

/* ═══════════════════════════════════════
   GRADING LOG MODULE
   Data shape per entry:
   { id, card, set, cost, rawVal, dateSent, grader, fees,
     hasGrade, gradeGrader, grade, salePrice, dateGraded }
   ═══════════════════════════════════════ */

function loadGradingData() {
  try { return JSON.parse(localStorage.getItem(getUserKey('grading_log')) || '[]'); } catch(e) { return []; }
}
function saveGradingData(d) {
  return _lsWrite(getUserKey('grading_log'), JSON.stringify(d));
}

let _gradingEditId = null; // null = new entry, number = editing existing

function openGradingModal(editId) {
  _gradingEditId = editId ?? null;
  const modal = document.getElementById('gradingModal');
  const title = document.getElementById('gradingModalTitle');

  // Reset form
  ['gmCard','gmSet','gmCost','gmRawVal','gmFees','gmSalePrice'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('gmDateSent').value = new Date().toISOString().slice(0,10);
  document.getElementById('gmGrader').value = 'PSA';
  document.getElementById('gmGrade').value = '';
  _gmSyncGrades();
  document.getElementById('gmHasGrade').checked = false;
  document.getElementById('gmGradeReceivedRow').style.display = 'none';

  if (editId != null) {
    title.textContent = 'Edit Grading Entry';
    const entry = loadGradingData().find(e => e.id === editId);
    if (entry) {
      document.getElementById('gmCard').value     = entry.card || '';
      document.getElementById('gmSet').value      = entry.set  || '';
      document.getElementById('gmCost').value     = entry.cost || '';
      document.getElementById('gmRawVal').value   = entry.rawVal || '';
      document.getElementById('gmDateSent').value = entry.dateSent || '';
      document.getElementById('gmGrader').value   = entry.grader || 'PSA';
      document.getElementById('gmFees').value     = entry.fees || '';
      if (entry.hasGrade) {
        document.getElementById('gmHasGrade').checked = true;
        document.getElementById('gmGradeReceivedRow').style.display = '';
        document.getElementById('gmGradeGrader').value = entry.gradeGrader || entry.grader || 'PSA';
        // Filter BEFORE assigning, and pass the stored grade through as
        // keepVal: a record saved before this filter existed may hold a
        // combination we now consider impossible (e.g. PSA 9.5). Hiding the
        // option would silently blank a real saved grade, so a legacy value
        // stays selectable on the record that already has it.
        _gmSyncGrades(String(entry.grade || ''));
        document.getElementById('gmGrade').value       = entry.grade || '';
        document.getElementById('gmSalePrice').value   = entry.salePrice || '';
      }
    }
  } else {
    title.textContent = 'Log Card for Grading';
    // Pre-fill card name from currently selected card
    if (selectedCard && selectedCard.name) {
      document.getElementById('gmCard').value = selectedCard.name;
      document.getElementById('gmSet').value  = [selectedCard.setName, selectedCard.number].filter(Boolean).join(' · ');
      const p = getEffectivePrice();
      if (p) document.getElementById('gmRawVal').value = p.toFixed(2);
    }
  }
  modal.classList.add('open');
}

function closeGradingModal(e) {
  if (e && !e.target.classList.contains('modal-overlay')) return;
  document.getElementById('gradingModal').classList.remove('open');
}

function saveGradingEntry() {
  const card     = document.getElementById('gmCard').value.trim();
  if (!card) { document.getElementById('gmCard').focus(); return; }
  const set      = document.getElementById('gmSet').value.trim();
  const cost     = parseFloat(document.getElementById('gmCost').value) || 0;
  const rawVal   = parseFloat(document.getElementById('gmRawVal').value) || 0;
  const dateSent = document.getElementById('gmDateSent').value || new Date().toISOString().slice(0,10);
  const grader   = document.getElementById('gmGrader').value;
  const fees     = parseFloat(document.getElementById('gmFees').value) || 0;
  const hasGrade = document.getElementById('gmHasGrade').checked;
  const gradeGrader = document.getElementById('gmGradeGrader').value;
  const grade    = hasGrade ? (parseFloat(document.getElementById('gmGrade').value) || null) : null;
  const salePrice= hasGrade ? (parseFloat(document.getElementById('gmSalePrice').value) || null) : null;

  const data = loadGradingData();
  if (_gradingEditId != null) {
    const idx = data.findIndex(e => e.id === _gradingEditId);
    if (idx !== -1) data[idx] = { ...data[idx], card, set, cost, rawVal, dateSent, grader, fees, hasGrade, gradeGrader, grade, salePrice };
  } else {
    data.push({ id: Date.now(), card, set, cost, rawVal, dateSent, grader, fees, hasGrade, gradeGrader, grade, salePrice });
  }
  if (!saveGradingData(data)) { _reportStorageFailure(); return; }
  document.getElementById('gradingModal').classList.remove('open');
  renderGradingLog();
}

function deleteGradingEntry(id) {
  if (!confirm('Remove this grading entry?')) return;
  saveGradingData(loadGradingData().filter(e => e.id !== id));
  renderGradingLog();
}

function renderGradingLog() {
  const data = loadGradingData();
  const wrap = document.getElementById('gradingLogWrap');
  const reportWrap = document.getElementById('gradingReportWrap');
  if (!wrap) return;

  if (!data.length) {
    wrap.innerHTML = '<div class="empty-flips"><div class="empty-flips-icon">🏅</div><div class="empty-flips-h">No grading submissions yet</div><div class="empty-flips-p">Tap "+ Log Card" when you send a card in for grading to start tracking your ROI.</div></div>';
    if (reportWrap) reportWrap.style.display = 'none';
    return;
  }

  const esc2 = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const gradeColor = g => g >= 9 ? '#4ade80' : g >= 7 ? '#facc15' : g >= 5 ? '#fb923c' : '#f87171';
  const statusBadge = e => {
    if (!e.hasGrade) return '<span style="font-size:.65rem;padding:.1rem .4rem;border-radius:4px;background:rgba(148,163,184,.12);color:#94a3b8;border:1px solid rgba(148,163,184,.2)">Pending</span>';
    if (e.salePrice) return '<span style="font-size:.65rem;padding:.1rem .4rem;border-radius:4px;background:rgba(74,222,128,.1);color:#4ade80;border:1px solid rgba(74,222,128,.25)">Sold</span>';
    return '<span style="font-size:.65rem;padding:.1rem .4rem;border-radius:4px;background:rgba(250,204,21,.1);color:#facc15;border:1px solid rgba(250,204,21,.25)">Graded</span>';
  };

  const sorted = [...data].sort((a,b) => b.dateSent.localeCompare(a.dateSent));

  wrap.innerHTML = `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
      <table class="flip-table" style="min-width:580px">
        <thead><tr>
          <th>Sent</th><th>Card</th><th>Cost</th><th>Raw Value</th>
          <th>Grader</th><th>Fees</th><th>Grade</th><th>Sale $</th><th>ROI</th><th></th>
        </tr></thead>
        <tbody>${sorted.map(e => {
          const totalIn   = e.cost + e.fees;
          const rawProfit = e.rawVal - e.cost;
          let roi = '—', roiClass = '';
          if (e.hasGrade && e.salePrice) {
            const gradedProfit = e.salePrice - totalIn;
            const roiPct = totalIn > 0 ? ((e.salePrice - totalIn) / totalIn * 100) : 0;
            const vsRaw  = gradedProfit - rawProfit;
            roi = `<div style="font-size:.72rem;font-weight:700;color:${gradedProfit>=0?'#4ade80':'#f87171'}">${gradedProfit>=0?'+':''}$${Math.abs(gradedProfit).toFixed(2)}</div>
                   <div style="font-size:.62rem;color:${vsRaw>=0?'#4ade80':'#f87171'}">${vsRaw>=0?'▲':'▼'}$${Math.abs(vsRaw).toFixed(2)} vs raw</div>
                   <div style="font-size:.6rem;color:var(--text-muted)">${roiPct.toFixed(0)}% ROI</div>`;
          } else if (e.rawVal) {
            roi = `<div style="font-size:.65rem;color:var(--text-muted)">Raw: ${rawProfit>=0?'+':''}$${rawProfit.toFixed(2)}</div>`;
          }
          return `<tr>
            <td class="ft-mono" style="font-size:.7rem">${esc2(e.dateSent)}</td>
            <td><div class="ft-card" title="${esc2(e.card)}">${esc2(e.card)}</div><div style="font-size:.62rem;color:var(--text-muted)">${esc2(e.set||'')}</div>${statusBadge(e)}</td>
            <td class="ft-mono">$${(e.cost||0).toFixed(2)}</td>
            <td class="ft-mono">$${(e.rawVal||0).toFixed(2)}</td>
            <td style="font-size:.78rem">${esc2(e.grader)}</td>
            <td class="ft-mono">$${(e.fees||0).toFixed(2)}</td>
            <td style="text-align:center">${e.hasGrade && e.grade ? `<span style="font-weight:800;color:${gradeColor(e.grade)}">${esc2(e.gradeGrader||e.grader)} ${e.grade}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
            <td class="ft-mono">${e.salePrice ? '$'+e.salePrice.toFixed(2) : '<span style="color:var(--text-muted)">—</span>'}</td>
            <td>${roi}</td>
            <td><div style="display:flex;gap:.3rem">
              <button class="ft-delete" onclick="openGradingModal(${e.id})" title="Edit" style="color:var(--gold-text)">✎</button>
              <button class="ft-delete" onclick="deleteGradingEntry(${e.id})" title="Delete">✕</button>
            </div></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;

  // ── Monthly ROI Report ──
  renderGradingReport(data, reportWrap);
}

function renderGradingReport(data, reportWrap) {
  if (!reportWrap) return;
  const completed = data.filter(e => e.hasGrade && e.salePrice);
  if (!completed.length) { reportWrap.style.display = 'none'; return; }

  // Group by month (YYYY-MM)
  const byMonth = {};
  completed.forEach(e => {
    const month = (e.dateSent || '').slice(0, 7);
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(e);
  });

  const months = Object.keys(byMonth).sort().reverse();
  const esc2 = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');

  const rows = months.map(m => {
    const entries = byMonth[m];
    const totalCost   = entries.reduce((s,e) => s + e.cost, 0);
    const totalFees   = entries.reduce((s,e) => s + e.fees, 0);
    const totalSale   = entries.reduce((s,e) => s + e.salePrice, 0);
    const totalIn     = totalCost + totalFees;
    const gradedProfit= totalSale - totalIn;
    const rawProfit   = entries.reduce((s,e) => s + (e.rawVal - e.cost), 0);
    const vsRaw       = gradedProfit - rawProfit;
    const roiPct      = totalIn > 0 ? (gradedProfit / totalIn * 100).toFixed(1) : '0.0';
    const avgGrade    = entries.filter(e=>e.grade).length
      ? (entries.filter(e=>e.grade).reduce((s,e)=>s+parseFloat(e.grade),0) / entries.filter(e=>e.grade).length).toFixed(1)
      : '—';
    const [yr, mo] = m.split('-');
    const label = new Date(+yr, +mo-1).toLocaleString('en-US', { month:'long', year:'numeric' });

    return `<tr>
      <td style="font-size:.78rem;font-weight:700;color:var(--text)">${esc2(label)}</td>
      <td class="ft-mono" style="text-align:center">${entries.length}</td>
      <td class="ft-mono">$${totalCost.toFixed(2)}</td>
      <td class="ft-mono">$${totalFees.toFixed(2)}</td>
      <td class="ft-mono">$${totalSale.toFixed(2)}</td>
      <td><span style="font-weight:800;color:${gradedProfit>=0?'#4ade80':'#f87171'}">${gradedProfit>=0?'+':''}$${Math.abs(gradedProfit).toFixed(2)}</span></td>
      <td><span style="font-size:.78rem;color:${vsRaw>=0?'#4ade80':'#f87171'}">${vsRaw>=0?'▲':'▼'}$${Math.abs(vsRaw).toFixed(2)}</span></td>
      <td><span style="font-weight:800;color:${+roiPct>=0?'#4ade80':'#f87171'}">${roiPct}%</span></td>
      <td style="font-size:.78rem;text-align:center">${avgGrade}</td>
    </tr>`;
  });

  reportWrap.style.display = '';
  reportWrap.innerHTML = `
    <div style="font-size:.7rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--text-muted);margin-bottom:.55rem">📊 Monthly Performance Report</div>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
      <table class="flip-table" style="min-width:520px">
        <thead><tr>
          <th>Month</th><th>Cards</th><th>Cost</th><th>Fees</th><th>Sale Total</th>
          <th>Graded P&L</th><th>vs Raw</th><th>ROI %</th><th>Avg Grade</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
    <div style="font-size:.67rem;color:var(--text-muted);margin-top:.5rem;line-height:1.5">
      <strong style="color:var(--text)">vs Raw</strong> = graded profit minus what you'd have made selling raw at submission price · 
      <strong style="color:var(--text)">ROI %</strong> = (sale − cost − fees) ÷ (cost + fees)
    </div>`;
}

// ── Delete helpers ──
function deleteFlip(id) {
  const flips = loadFlipsData().filter(f => f.id !== id);
  _addTombstones('flips', id); // before the save, so a failed write still records intent
  saveFlipsData(flips);
  renderFlipsView();
}

// ── Flip Detail modal (2026-08-19) ──
// Tapping a row in the Flip Log opens this. The Collection detail modal
// looks up its data from loadPortData(), which won't have this card
// anymore (it was sold), so we need our own read path from flips.
window._fdmCurrentId = null;
function openFlipDetail(flipId) {
  const flips = loadFlipsData();
  const f = flips.find(x => x.id === flipId);
  if (!f) return;
  window._fdmCurrentId = flipId;

  const graderNames = { psa: 'PSA', bgs: 'BGS', cgc: 'CGC', ace: 'ACE', tag: 'TAG', sgc: 'SGC' };
  const b = Number(f.buyPrice) || 0;
  const s = Number(f.sellPrice) || 0;
  const _fn = _flipNetOf(f);
  const pr = (f.profit != null) ? (Number(f.profit) || 0) : _fn.net;
  // When there's no cost basis, ROI is undefined — don't render a
  // misleading "+0.0%". Show “— no cost basis” instead.
  // 2026-09-04: basis is total cash deployed (buy + fees + shipping +
  // grading), matching the Flip Log row and _flipNetOf().
  const hasCost = _fn.basis > 0;
  const roi = hasCost ? (pr / _fn.basis) * 100 : 0;
  const roiColor = pr >= 0 ? '#4ade80' : '#f87171';

  // Image — same fallback ladder as the Collection modal.
  const wrap = document.getElementById('fdmImgWrap');
  const imgUrl = f.img || f.imageUrl || '';
  if (wrap) {
    if (imgUrl) {
      wrap.innerHTML = `<img src="${String(imgUrl).replace(/"/g,'&quot;')}" alt="" style="width:100%;height:100%;object-fit:cover">`;
    } else {
      wrap.textContent = '🃏';
    }
  }

  const setEl = (id, val, css) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    if (css) Object.assign(el.style, css);
  };
  setEl('fdmName',   f.card || 'Unknown card');
  setEl('fdmSet',    f.set || '—');
  setEl('fdmBought', `$${b.toFixed(2)}`);
  setEl('fdmSold',   `$${s.toFixed(2)}`);
  setEl('fdmPlatform', f.platform || '—');
  setEl('fdmDate',   f.date ? `Sold ${f.date}` : '—');
  setEl('fdmProfit', `${pr >= 0 ? '+' : '−'}$${Math.abs(pr).toFixed(2)}`, { color: roiColor });
  setEl(
    'fdmRoi',
    hasCost ? `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}% ROI` : 'ROI — no cost basis',
    { color: hasCost ? roiColor : 'var(--text-muted)' }
  );

  // Grade chip — only shown when the flip was of a graded card.
  const chipWrap = document.getElementById('fdmGradeChip');
  const chipText = document.getElementById('fdmGradeChipText');
  if (chipWrap && chipText) {
    if (f.grader && f.grade != null && f.grade !== '') {
      const gLabel = graderNames[String(f.grader).toLowerCase()] || String(f.grader).toUpperCase();
      chipText.textContent = `🏅 ${gLabel} ${f.grade}`;
      chipWrap.style.display = '';
    } else {
      chipWrap.style.display = 'none';
    }
  }

  // Research links — build search queries from card + number so the user
  // can quickly check current comps if they want to flip the same card again.
  const numMatch = (f.set || '').match(/#(\S+)/);
  const cardNum = numMatch ? numMatch[1] : (f.number || '');
  const q = [f.card, cardNum].filter(Boolean).join(' ');
  const ebayBtn = document.getElementById('fdmEbayBtn');
  const tcgBtn  = document.getElementById('fdmTcgBtn');
  // 2026-08-30: These two hrefs used to go out un-wrapped, so every click from
  // the Flip Detail Modal was an unattributed eBay/TCGplayer visit. Route them
  // through buildEbayUrl / buildTcgpUrl so EPN + Impact commissions actually
  // credit us. Falls back to the raw URL if the helpers aren't loaded yet.
  const _fdmEbayRaw = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&_sop=13&LH_Sold=1&LH_Complete=1`;
  if (ebayBtn) ebayBtn.href = (typeof buildEbayUrl === 'function') ? buildEbayUrl(_fdmEbayRaw) : _fdmEbayRaw;
  if (tcgBtn)  tcgBtn.href  = (typeof buildTcgpUrl === 'function')
    ? buildTcgpUrl(f.card || '', '', cardNum)
    : `https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(q)}&view=grid`;

  document.getElementById('flipDetailModal').classList.add('open');
}

function _fdmDeleteFlip() {
  const id = window._fdmCurrentId;
  if (!id) return;
  if (!confirm('Delete this flip? This can\u2019t be undone.')) return;
  deleteFlip(id);
  document.getElementById('flipDetailModal').classList.remove('open');
  window._fdmCurrentId = null;
}
function deletePort(id) {
  const port = loadPortData().filter(p => p.id !== id);
  _addTombstones('portfolio', id);
  savePortData(port);
  renderFlipsView();
}

// ── Export CSV ──
function exportFlips() {
  const flips = loadFlipsData();
  if (!flips.length) return;
  const rows = [['Date','Card','Set','Buy Price','Sell Price','Fees','Shipping','Grading','Net Profit','Platform']];
  flips.forEach(f => {
    // Export the cost components too — a bare net profit column cannot be
    // reconciled against a marketplace statement without them.
    const c = _flipNetOf(f);
    rows.push([f.date, f.card, f.set||'', c.buyPrice.toFixed(2), c.sellPrice.toFixed(2),
               c.fees.toFixed(2), c.shippingCost.toFixed(2), c.gradingCost.toFixed(2),
               (f.profit != null ? Number(f.profit) : c.net).toFixed(2), f.platform]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'cardsell_flips.csv';
  a.click();
}
// ── Export Grading Log as CSV (Pro feature) ──
function exportGradingLog() {
  if (!window._isPro) { showToast('Pro feature — upgrade to export your Grading Log.', 'gold'); return; }
  const data = loadGradingData();
  if (!data.length) { showToast('No grading entries to export yet.', 'info'); return; }
  const rows = [['Date Sent','Card','Set','Raw Cost','Raw Market Value','Grader','Grading Fees','Final Grade','Sale Price','ROI $','ROI %','Status']];
  data.forEach(e => {
    const totalIn   = (e.cost||0) + (e.fees||0);
    const roiDollar = (e.hasGrade && e.salePrice) ? (e.salePrice - totalIn).toFixed(2) : '';
    const roiPct    = (e.hasGrade && e.salePrice && totalIn > 0) ? ((e.salePrice - totalIn) / totalIn * 100).toFixed(1) + '%' : '';
    const status    = !e.hasGrade ? 'Pending' : (e.salePrice ? 'Sold' : 'Graded');
    rows.push([
      e.dateSent || '',
      e.card  || '',
      e.set   || '',
      (e.cost   || 0).toFixed(2),
      (e.rawVal || 0).toFixed(2),
      e.grader || '',
      (e.fees   || 0).toFixed(2),
      (e.hasGrade && e.grade) ? (e.gradeGrader || e.grader || '') + ' ' + e.grade : '',
      e.salePrice ? e.salePrice.toFixed(2) : '',
      roiDollar,
      roiPct,
      status
    ]);
  });
  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'cardsell_grading_log.csv';
  a.click();
  showToast('Grading log exported!', 'success');
}

// ── Export Collection as CSV ──
// 2026-08-14: Clear the entire Collection (portfolio + flips + grading log)
// with a two-step native confirm so users don't nuke their data by accident.
// Works for signed-in AND anonymous users — getUserKey() returns the correct
// scoped or unscoped keys automatically.
function clearCollection() {
  try {
    const port = loadPortData();
    const flips = (typeof loadFlipsData === 'function') ? loadFlipsData() : [];
    const totalRows = (port ? port.length : 0) + (flips ? flips.length : 0);
    if (!totalRows) {
      showToast('Your Collection is already empty.', 'info');
      return;
    }
    // Two-step confirm because this is irreversible.
    const msg1 = 'Clear your entire Collection?\n\n' +
      'This will permanently remove:\n' +
      '  • ' + (port.length || 0) + ' portfolio card(s)\n' +
      '  • ' + (flips.length || 0) + ' flip record(s)\n\n' +
      'This cannot be undone.';
    if (!confirm(msg1)) return;
    if (!confirm('Really clear everything? This cannot be undone. Tap OK to erase, Cancel to keep your data.')) return;
    // Clear the three user-scoped keys. localStorage.removeItem is safer than
    // setItem('[]') because it also cleans up if the key was orphaned.
    // Tombstone every id first. The empty POST below is authoritative only
    // while this device's clientUpdatedAt stays ahead of the server's clock;
    // tombstones make the deletion stick regardless of clock skew, and teach
    // any other signed-in device about it on its next pull.
    try {
      _addTombstones('portfolio', port.map(x => x && x.id));
      _addTombstones('flips',     flips.map(x => x && x.id));
    } catch(e) {}
    try { localStorage.removeItem(getUserKey('portfolio')); } catch(e) {}
    try { localStorage.removeItem(getUserKey('flips')); } catch(e) {}
    try { localStorage.removeItem(getUserKey('grading_log')); } catch(e) {}
    // Re-render the Collection view so counts reset immediately.
    try { if (typeof renderCollectionView === 'function') renderCollectionView(); } catch(e) {}
    try { if (typeof renderFlipTable === 'function') renderFlipTable(); } catch(e) {}
    // Push the empty state to the server IMMEDIATELY (no debounce). Prior
    // versions only removed local keys, so on reload _pullUserData() unioned
    // the still-cloud-persisted rows back into local storage and the cleared
    // cards reappeared. Bypass _scheduleUserDataSync's 1.5s debounce and any
    // in-flight sync flag so this write is authoritative.
    (async () => {
      try {
        if (!window.googleUser || !window._googleIdToken) return;
        await fetch('/api/user-data', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + window._googleIdToken,
          },
          body: JSON.stringify({ portfolio: [], flips: [], tombstones: loadTombstones(), clientUpdatedAt: Date.now() }),
        });
      } catch(e) { /* offline / network issue — next save attempt will retry */ }
    })();
    showToast('Collection cleared — ' + totalRows + ' entr' + (totalRows === 1 ? 'y' : 'ies') + ' removed.', 'success');
  } catch(e) {
    console.error('[clearCollection] failed:', e);
    showToast('Could not clear Collection. Try refreshing the page.', 'error');
  }
}
window.clearCollection = clearCollection;

function exportCollection() {
  const port = loadPortData();
  if (!port.length) { showToast('No cards in your collection to export.', 'info'); return; }
  const rows = [['Card','Set','Cost Basis','Current Value','Unrealized P/L','P/L %']];
  port.forEach(p => {
    const cur  = p.currentValue ?? p.buyPrice ?? 0;
    const gain = cur - (p.buyPrice || 0);
    const pct  = p.buyPrice > 0 ? (gain / p.buyPrice * 100).toFixed(1) + '%' : '';
    rows.push([p.card||'', p.set||'', (p.buyPrice||0).toFixed(2), cur.toFixed(2), gain.toFixed(2), pct]);
  });
  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'cardsell_collection.csv';
  a.click();
  showToast('Collection exported!', 'success');
}

// ── Newsletter subscribe ──
async function submitNewsletter() {
  const emailInput = document.getElementById('newsletterEmail');
  const msgEl      = document.getElementById('newsletterMsg');
  const formEl     = document.getElementById('newsletterForm');
  if (!emailInput || !msgEl || !formEl) return;
  const email = emailInput.value.trim();
  if (!email || !email.includes('@') || !email.includes('.')) {
    emailInput.style.borderColor = '#f87171';
    setTimeout(() => { emailInput.style.borderColor = 'var(--border)'; }, 1500);
    return;
  }
  const btn = formEl.querySelector('button');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    const res  = await fetch('/api/newsletter', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ email }) });
    const body = await res.json().catch(() => ({}));
    formEl.style.display = 'none';
    msgEl.style.display  = 'block';
    if (res.ok) {
      msgEl.style.color = '#4ade80';
      msgEl.textContent = 'You\'re subscribed! Thanks for joining.';
    } else if (res.status === 409) {
      msgEl.style.color = 'var(--text-muted)';
      msgEl.textContent = 'Already subscribed — you\'re all set!';
    } else {
      msgEl.style.color = '#f87171';
      msgEl.textContent = 'Something went wrong. Try again later.';
      formEl.style.display = 'flex';
      if (btn) { btn.disabled = false; btn.textContent = 'Subscribe'; }
    }
  } catch(err) {
    msgEl.style.color = '#f87171';
    msgEl.textContent = 'Network error — try again.';
    msgEl.style.display  = 'block';
    formEl.style.display = 'flex';
    if (btn) { btn.disabled = false; btn.textContent = 'Subscribe'; }
  }
}



async function exportSubscriberCSV() {
  if (window._userSub !== _OWNER_SUB) return;
  try {
    // Fetch all emails via admin endpoint with extended param
    const idTok = window._googleIdToken || '';
    const res  = await fetch('/api/admin?all=1', { headers: { 'Authorization': 'Bearer ' + idTok } });
    const data = await res.json();
    if (!res.ok) { showToast('Could not load subscriber list.', 'error'); return; }
    const emails = data.allEmails || data.recentEmails || [];
    if (!emails.length) { showToast('No subscribers to export.', 'info'); return; }
    const csv = ['Email', ...emails].join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'cardresell_subscribers.csv';
    a.click();
    showToast(emails.length + ' subscriber emails exported.', 'success');
  } catch(e) {
    showToast('Export failed — try again.', 'error');
  }
}

// ══════════════════════════════════════════════════════════
// MY COLLECTION VIEW
// ══════════════════════════════════════════════════════════

function _updateCollectionSignInWall() {
  // 2026-08-14: anon users are now allowed to use the Collection view (data
  // saved to unscoped localStorage keys; _migrateAnonDataToUser merges on
  // sign-in). So the hard sign-in wall is gone; we always show content and
  // instead toggle a soft sync banner when the user isn't signed in.
  const wall    = document.getElementById('collectionSignInWall');
  const content = document.getElementById('collectionContent');
  const banner  = document.getElementById('anonSyncBanner');
  const signedIn = !!(window.googleUser && window.googleUser.sub) || !!window._userSub;
  if (wall)    wall.style.display    = 'none';
  if (content) content.style.display = '';
  if (banner)  banner.style.display  = signedIn ? 'none' : 'flex';
}

function renderCollectionView() {
  _updateCollectionSignInWall();
  // 2026-08-14: anon users are allowed to render the Collection view. Their
  // data lives in the unscoped `cardsell_portfolio` key (getUserKey falls
  // back to it when window.googleUser is null), and _migrateAnonDataToUser
  // silently merges those entries into the user-scoped key on first sign-in
  // — so there's no data loss. This unblocks the top activation gate.
  const port = loadPortData(); // reuse existing portfolio data

  // ── Stats ──
  const totalCards  = port.length;
  const costBasis   = port.reduce((s, p) => s + (p.buyPrice || 0), 0);
  const curValue    = port.reduce((s, p) => s + (p.currentValue ?? p.buyPrice ?? 0), 0);
  const unrealized  = curValue - costBasis;

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setClass = (id, cls) => { const el = document.getElementById(id); if (el) el.className = 'pnl-value ' + cls; };

  setEl('colTotalCards', totalCards);
  setEl('colTotalCardsSub', totalCards === 1 ? '1 card tracked' : totalCards + ' cards tracked');
  setEl('colCostBasis', '$' + costBasis.toFixed(2));
  setEl('colCostSub', 'amount paid');
  setEl('colUnrealized', (unrealized >= 0 ? '+' : '') + '$' + unrealized.toFixed(2));
  setClass('colUnrealized', unrealized >= 0 ? 'pos' : 'neg');
  setEl('colUnrealizedSub', unrealized >= 0 ? 'unrealized gain' : 'unrealized loss');

  const wrap = document.getElementById('collectionWrap');
  if (!wrap) return;

  // Show Pro nudge banner for free users with a growing collection (5+ cards)
  const _colNudge = document.getElementById('colProNudge');
  if (_colNudge) {
    _colNudge.style.display = (!window._isPro && port.length >= 5) ? 'flex' : 'none';
  }

  if (!port.length) {
    wrap.innerHTML = '<div class="empty-flips"><div class="empty-flips-icon">📦</div><div class="empty-flips-h">No cards in your collection yet</div><div class="empty-flips-p">Tap "+ Add Card" to log a card you own and track its value.</div></div>';
    return;
  }

  const esc2 = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Sort by unrealized gain descending
  const sorted = [...port].sort((a, b) => {
    const aGain = (a.currentValue ?? a.buyPrice ?? 0) - (a.buyPrice || 0);
    const bGain = (b.currentValue ?? b.buyPrice ?? 0) - (b.buyPrice || 0);
    return bGain - aGain;
  });

  // Helper: build an eBay sold-listings URL for a collection entry.
  // Uses card name + card number when available; falls back to name-only.
  const _entryEbayUrl = (p) => {
    const numFromSet = ((p.set || '').match(/#(\S+)/) || [])[1] || '';
    const num = (p.number || numFromSet || '').replace(/^0+/, '');
    const parts = [p.card || '', num].filter(Boolean).join(' ');
    if (!parts) return '#';
    const raw = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(parts)}&_sacat=212&LH_Sold=1&LH_Complete=1`;
    try { return typeof buildEbayUrl === 'function' ? buildEbayUrl(raw) : raw; } catch(e) { return raw; }
  };

  wrap.innerHTML = `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
      <table class="flip-table" style="min-width:620px">
        <thead><tr>
          <th style="width:56px"></th><th>Card</th><th>Set</th><th>Cost</th><th>Current Value</th><th>P/L</th><th>P/L %</th><th></th><th></th>
        </tr></thead>
        <tbody>${sorted.map(p => {
          const cur     = p.currentValue ?? p.buyPrice ?? 0;
          const gain    = cur - (p.buyPrice || 0);
          const gainPct = p.buyPrice > 0 ? (gain / p.buyPrice * 100) : 0;
          const color   = gain >= 0 ? '#4ade80' : '#f87171';
          const refreshedAgo = p.lastRefreshed ? (() => {
            const mins = Math.round((Date.now() - new Date(p.lastRefreshed).getTime()) / 60000);
            if (mins < 1) return 'just now'; if (mins < 60) return mins + 'm ago';
            const hrs = Math.round(mins / 60); if (hrs < 24) return hrs + 'h ago';
            return Math.round(hrs / 24) + 'd ago';
          })() : null;
          // Thumbnail: prefer p.img (single-card save path) then p.imageUrl (bulk-scan path).
          const thumb = p.img || p.imageUrl || '';
          const thumbImg = thumb
            ? `<img src="${esc2(thumb)}" loading="lazy" alt="" style="width:40px;height:56px;object-fit:cover;border-radius:6px;background:#111;border:1px solid #1f1f1f;display:block">`
            : `<div style="width:40px;height:56px;border-radius:6px;background:#111;border:1px solid #1f1f1f;display:flex;align-items:center;justify-content:center;font-size:1.1rem;opacity:.5">🃏</div>`;
          // Grade indicator: two visual cues so the user can tell graded rows
          // apart from raw at a glance, especially when the same card is saved
          // at multiple grades (e.g. Mega Lucario ex — PSA 10 vs raw).
          //   1. Corner badge on the thumbnail: gold pill with grader + grade
          //      (e.g. "PSA 10"). Positioned absolute so it doesn't disturb
          //      the row's baseline alignment.
          //   2. Prefix chip on the card name column, same text, so users on
          //      a narrow screen see the grade without staring at the thumb.
          const _graderNames = { psa: 'PSA', bgs: 'BGS', cgc: 'CGC', ace: 'ACE', tag: 'TAG', sgc: 'SGC' };
          const _hasGrade = p.grader && p.grade != null && p.grade !== '';
          const _gradeLabel = _hasGrade
            ? `${_graderNames[String(p.grader).toLowerCase()] || String(p.grader).toUpperCase()} ${p.grade}`
            : '';
          const gradeBadge = _hasGrade
            ? `<div title="Saved at ${esc2(_gradeLabel)}" style="position:absolute;top:-4px;right:-4px;padding:1px 4px;background:linear-gradient(135deg,#f0b429,#d4af37);color:#000;font-size:.55rem;font-weight:900;border-radius:4px;line-height:1.1;letter-spacing:.02em;box-shadow:0 1px 3px rgba(0,0,0,.6);border:1px solid #000;white-space:nowrap">${esc2(_gradeLabel)}</div>`
            : '';
          const thumbCell = `<div style="position:relative;width:40px;height:56px">${thumbImg}${gradeBadge}</div>`;
          const cardNameHtml = _hasGrade
            ? `<span style="display:inline-block;padding:.05rem .3rem;margin-right:.35rem;background:rgba(212,175,55,.18);border:1px solid rgba(212,175,55,.4);border-radius:4px;font-size:.65rem;font-weight:800;color:var(--gold-text);vertical-align:middle;white-space:nowrap">${esc2(_gradeLabel)}</span>${esc2(p.card)}`
            : esc2(p.card);
          // 2026-08-19: The row button used to open eBay for marketplace
          // research. That duplicated the card-tap detail popup (which
          // still has all the outbound platform links), and "Sell" as an
          // outbound made users think the app listed FOR them. Now it's
          // "Sold" — a one-tap action that logs the sale to the Flips tab
          // and moves the card out of Collection. The full card-tap popup
          // is unchanged and still offers eBay/TCGplayer/PWCC/COMC links.
          const sellCell = `<button type="button" onclick="event.stopPropagation();openMarkSoldModal(${p.id})" title="Log sale of ${esc2(p.card)} and move to Flips" style="display:inline-flex;align-items:center;gap:.3rem;padding:.35rem .6rem;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:8px;font-size:.7rem;font-weight:800;cursor:pointer;white-space:nowrap">🎉 Sold</button>`;
          // The whole row (except the action buttons) is a tap target that
          // opens the card-detail modal — addresses "lack of at least a link
          // to the card saved in your collection". Buttons inside the row
          // stopPropagation so refresh/remove don't also fire the modal.
          return `<tr class="col-row" onclick="openCollectionCardDetail(${p.id})" style="cursor:pointer">
            <td>${thumbCell}</td>
            <td><div class="ft-card" title="${esc2(p.card)}${_hasGrade ? ' — ' + esc2(_gradeLabel) : ''}">${cardNameHtml}</div></td>
            <td class="ft-set">${esc2(p.set||'—')}</td>
            <td class="ft-mono">$${(p.buyPrice||0).toFixed(2)}</td>
            <td class="ft-mono" style="color:var(--gold-text)" id="colVal_${p.id}">$${cur.toFixed(2)}${refreshedAgo ? `<span style="display:block;font-size:.62rem;color:var(--text-faint);font-weight:400">${refreshedAgo}</span>` : ''}</td>
            <td class="ft-mono" style="color:${color};font-weight:700">${gain>=0?'+':''}$${Math.abs(gain).toFixed(2)}</td>
            <td style="font-size:.72rem;color:${color};font-weight:700">${gainPct>=0?'+':''}${gainPct.toFixed(1)}%</td>
            <td onclick="event.stopPropagation()">${sellCell}</td>
            <td onclick="event.stopPropagation()"><div style="display:flex;gap:.3rem;align-items:center">
              <button class="ft-delete" id="colRefreshRow_${p.id}" onclick="event.stopPropagation();refreshSingleCardPrice(${p.id})" title="Refresh price" style="color:var(--text-muted);font-size:.75rem">↻</button>
              <button class="ft-delete" onclick="event.stopPropagation();deletePortEntry(${p.id})" title="Remove">✕</button>
            </div></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
}

// ── Fetch best eBay median price for a single portfolio entry ──
// The server now returns a trimmed, sanity-filtered median directly — no need
// to re-compute client-side. Falls back to null if confidence is insufficient.
async function _fetchEbayPriceForEntry(p) {
  // Raw entries only. A generic eBay sold query is card + number -- no grader,
  // no grade -- so running a slab through it can replace a $13k PSA 10 guide
  // value with an $897 raw median. Slabs route to _fetchGradedPriceForEntry
  // via the _fetchPriceForEntry dispatcher below; this stays the raw path.
  if (p && p.grader && p.grade) return null;
  // Build query: card name + card number (stripped from set field like "Charizard · #4")
  const numMatch = (p.set || '').match(/#(\S+)/);
  const cardNum  = numMatch ? numMatch[1].replace(/^0+/, '') : '';
  const queryParts = [p.card, cardNum].filter(Boolean);
  const query    = queryParts.join(' ');
  const res      = await fetch('/api/ebay-sold?q=' + encodeURIComponent(query));
  if (!res.ok) return null;
  const data     = await res.json();
  // Skip insufficient-data comps for portfolio refresh (would poison portfolio totals)
  if (!data.median || data.confidence === 'insufficient') return null;
  return data.median;
}

// ── Grade-aware refresh for a saved slab ───────────────────────────────────
// A slab's value is a published guide value for ONE grader+grade, so refreshing
// it means re-reading that exact field -- not searching sold listings. Maps the
// persisted grader/grade onto PriceCharting's field names.
//
// PriceCharting only publishes 7 and up, and only breaks out a GRADER at the
// 10 (manual-only=PSA 10, bgs-10, condition-17=CGC 10, condition-18=SGC 10).
// Below that the columns are "graded N by a grading company" -- grader-agnostic
// and, at 7 and 8, each blending two grades. Return null rather than substitute
// a neighbouring grade: a stale-but-correct saved value beats a fresh wrong one.
// Portfolio refresh form: the PriceCharting response field to read.
// Delegates to _pcGradeFieldFor so this and the card page's
// _pcVariantKeyForGrade can never disagree about which grade a slab maps to.
function _pcKeyForGrade(grader, grade) {
  return _pcGradeFieldFor(grader, grade);
}

async function _fetchGradedPriceForEntry(p) {
  if (!p || !p.card) return null;
  const key = _pcKeyForGrade(p.grader, p.grade);
  if (!key) return null;
  const rawGame = String(p.game || 'pokemon').toLowerCase();
  // Sports routes to sportscardspro and needs sport/brand/year to resolve a
  // product. Those are not persisted on a portfolio entry, so a lookup here
  // would be a guess at the card's identity. Keep the saved value.
  if (rawGame === 'sports') return null;
  const num = String(
    p.number || (((p.set || '').match(/#(\S+)/) || [])[1]) || ''
  ).replace(/^0+/, '');
  const qs = new URLSearchParams({
    name: p.card,
    // Japanese cards live under the pokemon game on PriceCharting.
    game: rawGame === 'pokemonjp' ? 'pokemon' : (rawGame || 'pokemon'),
  });
  if (num) qs.set('number', num);
  // p.set is a display string that can carry a " · #4" suffix; strip it.
  const setName = String(p.set || '').replace(/\s*·.*$/, '').trim();
  if (setName) qs.set('set', setName);
  const res = await fetch('/api/pricecharting?' + qs.toString());
  if (!res.ok) return null;
  const d = await res.json();
  if (!d || d.source !== 'pricecharting' || !d.prices) return null;
  const v = Number(d.prices[key]);
  return (Number.isFinite(v) && v > 0) ? v : null;
}

// Single entry point for "what is this portfolio entry worth now". Routes a
// slab to its published guide value and a raw card to sold comps, so neither
// can ever be priced off the other's source.
async function _fetchPriceForEntry(p) {
  if (p && p.grader && p.grade) return await _fetchGradedPriceForEntry(p);
  return await _fetchEbayPriceForEntry(p);
}

/* ── Merge-at-commit for long price refreshes (2026-09-04) ──
   refreshCollectionPrices() loaded the whole portfolio, awaited network calls
   for up to minutes (slabs are paced at 1 req/s), then wrote that stale array
   back with savePortData(port). Anything the user did in another tab meanwhile
   was overwritten by the snapshot taken before the refresh began. The audit
   reproduced it with two tabs: tab B deleted id 1 and added id 3 while tab A
   refreshed; the final state was ids 1 and 2 -- the deleted row resurrected
   and the newly added row lost.

   Instead of writing the stale array, re-read the newest snapshot at commit
   time and graft ONLY the freshly fetched price fields onto rows that still
   exist. Rows added during the refresh survive because we start from the
   latest array; rows deleted during the refresh stay deleted because we never
   reinsert an id that is no longer there. */
const _PRICE_REFRESH_FIELDS = ['currentValue','lastRefreshed','img','imageUrl','tcgplayerUrl'];

function _commitPortfolioRefresh(refreshedRows) {
  const fresh = new Map();
  for (const r of (refreshedRows || [])) if (r && r.id != null) fresh.set(String(r.id), r);
  const latest = loadPortData();
  let grafted = 0;
  const merged = latest.map(row => {
    if (!row || row.id == null) return row;
    const f = fresh.get(String(row.id));
    if (!f) return row; // added in another tab during the refresh — leave alone
    const out = Object.assign({}, row);
    let touched = false;
    for (const field of _PRICE_REFRESH_FIELDS) {
      if (f[field] !== undefined && f[field] !== row[field]) { out[field] = f[field]; touched = true; }
    }
    if (touched) { out.updatedAt = Date.now(); grafted++; }
    return out;
  });
  // Rows we refreshed that no longer exist locally = deleted mid-refresh.
  // We deliberately do NOT reinsert them.
  const liveIds = new Set(latest.filter(r => r && r.id != null).map(r => String(r.id)));
  let dropped = 0;
  for (const id of fresh.keys()) if (!liveIds.has(id)) dropped++;
  const ok = savePortData(merged);
  return { ok, grafted, dropped };
}

async function refreshCollectionPrices() {
  const btn = document.getElementById('colRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Refreshing…'; }

  const port = loadPortData();
  if (!port.length) {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh Prices'; }
    return;
  }

  let updated = 0;
  // PriceCharting's API terms cap us at 1 request/second. Slab rows go through
  // that endpoint, so pace them. Raw rows hit our own eBay proxy and don't need
  // the wait -- only sleep after a call that actually went to PriceCharting.
  let pcCalls = 0;
  for (const p of port) {
    if (!p.card) continue;
    const isSlab = !!(p.grader && p.grade);
    if (isSlab && pcCalls > 0) await new Promise(r => setTimeout(r, 1100));
    // Show inline spinner on the row if visible
    const rowValEl = document.getElementById('colVal_' + p.id);
    if (rowValEl) rowValEl.innerHTML = '<span style="opacity:.4;font-size:.72rem">refreshing…</span>';
    try {
      const price = await _fetchPriceForEntry(p);
      if (isSlab) pcCalls++;
      if (price !== null) {
        p.currentValue   = price;
        p.lastRefreshed  = new Date().toISOString();
        updated++;
      }
    } catch(e) { /* skip */ }
  }

  // Merge onto the newest snapshot rather than writing our pre-refresh copy.
  const commit = _commitPortfolioRefresh(port);
  if (!commit.ok) _reportStorageFailure();
  const now = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  const lastEl = document.getElementById('colLastUpdated');
  if (lastEl) lastEl.textContent = 'Updated ' + now;
  renderCollectionView();

  if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh Prices'; }
  // Don't name a single source in the toast: slabs refresh from PriceCharting
  // guide values and raw cards from eBay sold comps, so "refreshed from eBay
  // sold data" was wrong for any collection holding a graded card.
  if (updated > 0) showToast(updated + ' card price' + (updated>1?'s':'') + ' refreshed.', 'success');
  else showToast('Could not fetch updated prices right now. Try again later.', 'info');
}

// ── Refresh a single card's price from the collection table ──
async function refreshSingleCardPrice(id) {
  const port = loadPortData();
  const p    = port.find(x => x.id === id);
  if (!p) return;
  const btn  = document.getElementById('colRefreshRow_' + id);
  if (btn) { btn.disabled = true; btn.textContent = '↻'; btn.style.opacity = '.4'; }
  const valEl = document.getElementById('colVal_' + id);
  if (valEl) valEl.innerHTML = '<span style="opacity:.4;font-size:.72rem">…</span>';
  try {
    const price = await _fetchPriceForEntry(p);
    if (price !== null) {
      p.currentValue  = price;
      p.lastRefreshed = new Date().toISOString();
      // Same race as the bulk refresh: this awaited a network call, so commit
      // against the latest snapshot instead of our stale `port` array.
      if (!_commitPortfolioRefresh([p]).ok) _reportStorageFailure();
      renderCollectionView();
      showToast('Price updated for ' + (p.card || 'card') + ' 📊', 'success');
    } else {
      // A slab that can't refresh has NO published value for its grader+grade
      // (e.g. a CGC 8.5, or an ACE/TAG 10) -- it is not an absence of sales.
      showToast(
        (p.grader && p.grade)
          ? 'No published guide value for ' + String(p.grader).toUpperCase() + ' ' + p.grade + ' on this card.'
          : 'No eBay sales found for this card.',
        'info'
      );
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }
  } catch(e) {
    showToast('Network error — try again.', 'info');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  }
}

// ── Collection card-detail modal ──
// Tapping any Collection row opens this modal. Shows the card the same way
// the just-scanned view does: image, name/set/number, current market price,
// Sell on eBay + TCGPlayer look-up buttons, Refresh price, Remove.

window._ccmCurrentId = null;

function openCollectionCardDetail(entryId) {
  const port = loadPortData();
  const p = port.find(x => x.id === entryId);
  if (!p) return;
  window._ccmCurrentId = entryId;

  const imgUrl = p.img || p.imageUrl || '';
  // 2026-08-17: badge scan photos with a subtle overlay so the user knows we
  // don't have the canonical card art yet AND kick off a background re-fetch
  // that auto-heals the entry (canonical image + market price) so the next
  // open renders the proper art. Zero user action required.
  const imgIsScan = imgUrl && (String(imgUrl).startsWith('data:') || String(imgUrl).startsWith('blob:'));
  const wrap = document.getElementById('ccmImgWrap');
  if (wrap) {
    if (imgUrl) {
      const overlay = imgIsScan
        ? `<div style="position:absolute;bottom:0;left:0;right:0;padding:.25rem .4rem;background:linear-gradient(180deg,transparent,rgba(0,0,0,.7));color:#fde68a;font-size:.55rem;font-weight:700;text-align:center;letter-spacing:.02em">YOUR PHOTO · fetching card art…</div>`
        : '';
      wrap.style.position = 'relative';
      wrap.innerHTML = `<img src="${imgUrl.replace(/"/g,'&quot;')}" alt="" style="width:100%;height:100%;object-fit:cover">${overlay}`;
    } else {
      wrap.textContent = '🃏';
    }
  }

  // Auto-heal: if this entry is missing a canonical image or a market price,
  // silently re-run the card-DB lookup in the background. If it recovers
  // anything, re-open the modal so the user sees the fixed data. Debounced
  // via a flag so rapid open/close doesn't spam the API.
  const needsHeal = imgIsScan || !(p.currentValue != null && p.currentValue > 0);
  if (needsHeal && !window._ccmHealing) {
    window._ccmHealing = true;
    (async () => {
      try {
        const changed = await _refetchCardMeta(entryId);
        if (changed && window._ccmCurrentId === entryId) {
          openCollectionCardDetail(entryId);
          try { if (typeof renderCollectionView === 'function') renderCollectionView(); } catch(_) {}
        }
      } catch(_) {}
      finally { window._ccmHealing = false; }
    })();
  }
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('ccmName', p.card || 'Unknown card');
  setEl('ccmSet', p.set || '—');

  // Grade chip — show ONLY when the user has explicitly saved this card at a
  // specific grader + grade (e.g. PSA 10). Estimated grades (estGrade) are
  // AI guesses and shown as "Est." so users don't confuse them with a real
  // slabbed grade.
  const chipWrap = document.getElementById('ccmGradeChip');
  const chipText = document.getElementById('ccmGradeChipText');
  if (chipWrap && chipText) {
    const graderNames = { psa: 'PSA', bgs: 'BGS', cgc: 'CGC', ace: 'ACE', tag: 'TAG', sgc: 'SGC' };
    if (p.grader && p.grade != null && p.grade !== '') {
      const gLabel = graderNames[String(p.grader).toLowerCase()] || String(p.grader).toUpperCase();
      chipText.textContent = `🏅 ${gLabel} ${p.grade}`;
      chipWrap.style.display = '';
    } else if (p.estGrade) {
      chipText.textContent = `Est. PSA ${p.estGrade}`;
      chipWrap.style.display = '';
    } else {
      chipWrap.style.display = 'none';
    }
  }

  // If we have no current price yet (bulk-scan couldn't resolve one), show a
  // muted placeholder instead of a misleading $0.00. Users can hit "Refresh
  // current price" or "View full card" to fetch one.
  const hasCurrent = p.currentValue != null && !isNaN(p.currentValue) && p.currentValue > 0;
  const cur = hasCurrent ? p.currentValue : (p.buyPrice || 0);
  const buy = p.buyPrice || 0;
  const gain = cur - buy;
  const gainPct = buy > 0 ? (gain / buy * 100) : 0;
  const valEl = document.getElementById('ccmValue');
  if (valEl) {
    if (hasCurrent) {
      valEl.textContent = '$' + cur.toFixed(2);
      valEl.style.color = '';
      valEl.title = '';
    } else {
      valEl.textContent = 'Price not fetched';
      valEl.style.color = '#888';
      valEl.title = 'Tap Refresh or View full card to fetch a current price';
    }
  }
  const pnl = document.getElementById('ccmPnL');
  if (pnl) {
    if (buy > 0) {
      const color = gain >= 0 ? '#4ade80' : '#f87171';
      pnl.innerHTML = `<span style="color:${color};font-weight:700">${gain>=0?'+':''}$${Math.abs(gain).toFixed(2)} (${gainPct>=0?'+':''}${gainPct.toFixed(1)}%)</span> <span style="opacity:.6">from $${buy.toFixed(2)} cost</span>`;
    } else {
      pnl.innerHTML = '<span style="opacity:.6">No cost basis logged</span>';
    }
  }

  // Build sell URLs identical to the ones on the card detail view.
  // Strip any trailing number the card name already contains (e.g.
  // "Charizard 4/175") so we don't double-paste the number.
  const numFromSet = ((p.set || '').match(/#(\S+)/) || [])[1] || '';
  const num = (p.number || numFromSet || '').replace(/^0+/, '');
  const cardNameNoNum = String(p.card || '').replace(/\s+\d+\s*\/\s*\d+\s*$/, '').trim();
  const sellQuery = [cardNameNoNum, num].filter(Boolean).join(' ');

  // eBay: 2026-08-14 reviewer feedback — route to a buyer's-eye search view
  // of THIS card (recent sold comps) instead of the generic sell/listing
  // wizard. Users clicking "Sell" from a saved card want to know what price
  // that card is moving at RIGHT NOW so they can list competitively.
  // buildEbaySearchUrl handles graded suffix + affiliate params.
  const ebayUrl = buildEbaySearchUrl(cardNameNoNum, num, {
    graded: (p.grade && p.grade !== 'raw' && p.grade !== 'Raw') ? p.grade : ''
  });
  const sellBtn = document.getElementById('ccmSellBtn');
  if (sellBtn) sellBtn.href = ebayUrl;

  // TCGplayer: send them to the exact product page via our Impact affiliate
  // link. TCGplayer has no public sell-flow deeplink, so we land users on
  // the product page where the "Sell Yours" CTA lives one tap away. If we
  // stored the PokemonTCG.io tcgplayer.url on the collection entry, we
  // resolve it to a product ID so users skip the search step entirely.
  const lookupBtn = document.getElementById('ccmLookupBtn');
  if (lookupBtn) {
    // Set a search-based URL immediately so the button is never blank/broken
    lookupBtn.href = (typeof buildTcgpUrl === 'function')
      ? buildTcgpUrl(p.card || '', p.set || '', p.number || '')
      : `https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(sellQuery)}&view=grid`;
    // Then upgrade to product-page deeplink if we can resolve the product ID
    if (p.tcgplayerUrl && typeof buildTcgpSmart === 'function') {
      buildTcgpSmart({ tcgplayer: { url: p.tcgplayerUrl }, name: p.card, setName: p.set })
        .then(url => { if (url && lookupBtn) lookupBtn.href = url; })
        .catch(() => {});
    }
  }

  document.getElementById('collectionCardModal').classList.add('open');
}

// Open the full Card Lookup view for the collection entry.
// Closes the modal, switches to the Lookup tab, prefills the search box
// with "<name> <number>", clicks the top result, and (if the entry was
// saved at a specific grader+grade) auto-selects that grader pill + grade
// so the user lands on the exact configuration they saved.
// 2026-08-21: For legacy Collection entries saved before we persisted
// game/cardType, try to infer the game from set-string keywords. Loose,
// but way better than defaulting every card to Pokemon (which pulled up
// an Inkay for a Lorcana "Hades 74").
function _ccmInferGameFromSet(setStr) {
  const s = String(setStr || '').toLowerCase();
  if (!s) return '';
  // Lorcana sets
  if (/lorcana|ursula|inklands|chapters|shimmering|azurite|reign|archazia|first chapter/.test(s)) return 'lorcana';
  // Magic: The Gathering sets (common keywords)
  if (/\bmtg\b|magic:|magic the gathering|commander|modern horizons|dominaria|innistrad|ravnica|zendikar|kaldheim|ikoria|throne of eldraine|foundations|murders at karlov|bloomburrow|duskmourn/.test(s)) return 'mtg';
  // Yu-Gi-Oh
  if (/yu-?gi-?oh|ygo|structure deck|starter deck|legendary duelists|dark magician|blue-eyes|red-eyes|maze of|phantom rage|rise of the duelist|dawn of majesty|burst of destiny/.test(s)) return 'yugioh';
  // One Piece
  if (/one piece|romance dawn|paramount war|pillars of strength|kingdoms of intrigue|awakening of the new era|wings of the captain|two legends/.test(s)) return 'onepiece';
  // Sports
  if (/topps|panini|bowman|donruss|prizm|upper deck|fleer|score|leaf|score baseball|score football|nba hoops|select|contenders|optic|mosaic/.test(s)) return 'sports';
  // Default: Pokemon (safest default — biggest catalog and the app's home game)
  return 'pokemon';
}

function _ccmViewFullCard() {
  if (!window._ccmCurrentId) return;
  const port = loadPortData();
  const p = port.find(x => x.id === window._ccmCurrentId);
  if (!p) return;

  // Close the collection modal so the lookup view is visible
  document.getElementById('collectionCardModal').classList.remove('open');

  // Switch to the Card Lookup tab
  if (typeof switchView === 'function') { try { switchView('lookup'); } catch(e) {} }

  // Clean the card name (strip trailing "100/086"-style number)
  const cardName = String(p.card || '').replace(/\s+\d+\s*\/\s*\d+\s*$/, '').trim();
  const numFromSet = ((p.set || '').match(/#(\S+)/) || [])[1] || '';
  const num = String(p.number || numFromSet || '').replace(/^0+/, '').trim();
  if (!cardName) return;

  const graderKey = p.grader ? String(p.grader).toLowerCase() : null;
  const grade     = (p.grade != null && p.grade !== '') ? String(p.grade) : null;

  // Post-route: apply the saved grader pill + grade select once results load.
  const applyGradeAfter = (delay) => {
    if (!graderKey || !grade) {
      setTimeout(() => {
        const results = document.getElementById('sellSection') || document.getElementById('platformCards');
        if (results) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, delay);
      return;
    }
    setTimeout(() => {
      try {
        const gradedToggle = document.getElementById('gradedToggle');
        if (gradedToggle && !gradedToggle.classList.contains('active')) {
          gradedToggle.click();
        }
        const pill = document.querySelector(`#gradedPills .pill[data-val="${graderKey}"]`);
        if (pill && typeof setPill === 'function') {
          setPill(pill, 'gradedPills');
          if (typeof toggleGrade === 'function') toggleGrade();
        }
        setTimeout(() => {
          const gradeSelect = document.getElementById('gradeSelect');
          if (gradeSelect) {
            gradeSelect.value = grade;
            gradeSelect.dispatchEvent(new Event('change'));
            if (typeof calc === 'function') calc();
          }
          const results = document.getElementById('sellSection') || document.getElementById('platformCards');
          if (results) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
      } catch(e) { console.warn('[_ccmViewFullCard] applyGrade failed', e); }
    }, delay);
  };

  // 2026-08-21 FIX: The old path stuffed the card name into #searchInput,
  // fired a search, then clicked the first .drop-item after 800ms. That
  // failed hard for non-Pokemon flips because the search ran against
  // whatever game tab happened to be active — for Hades (Lorcana), that
  // returned two Inkays from Pokemon XY. The user's ask: "pull up the
  // card as if we just scanned it — should be even easier since we have
  // it saved." Correct: route through the scan-load pipeline directly,
  // preserving game + set + number + groundedId. Falls back to name
  // search only if we have no way to infer the game.

  // Prefer the persisted game/cardType (new saves), fall back to a
  // heuristic on the set string (legacy saves).
  const savedGame = String(p.game || '').toLowerCase();
  const savedCardType = String(p.cardType || '').toLowerCase();
  const inferredGame = savedGame || savedCardType || _ccmInferGameFromSet(p.set);
  const isJP = (p.isJapanese === true) || (savedGame === 'pokemonjp');

  const pending = {
    name:       cardName,
    number:     num,
    setName:    String(p.set || '').replace(/\s*·?\s*#\S+\s*$/, '').trim(),
    setCode:    p.setCode || '',
    groundedId: p.groundedId || '',
    rarity:     p.rarity || '',
    cardType:   inferredGame === 'pokemonjp' ? 'pokemon' : (inferredGame || 'pokemon'),
    isJapanese: isJP,
    imageUrl:   p.img || p.imageUrl || '',
    marketPrice: (p.currentValue != null ? p.currentValue : null),
    tcgplayerUrl: p.tcgplayerUrl || '',
    sport:      '',
    year:       '',
  };

  // Switch the game selector to the right tab BEFORE routing. Otherwise
  // _loadScannedNonPokemonCard's internal doSearch runs against the
  // wrong DB and clobbers the panel to the empty state.
  try {
    const typeToGame = {
      pokemon:  isJP ? 'pokemonjp' : 'pokemon',
      yugioh:   'yugioh',
      mtg:      'mtg',
      magic:    'mtg',
      lorcana:  'lorcana',
      onepiece: 'onepiece',
      sports:   'sports',
      other:    'other',
    };
    const targetGame = typeToGame[pending.cardType.toLowerCase()] || 'pokemon';
    const gSel = document.getElementById('gameSelect');
    if (gSel && gSel.value !== targetGame) {
      gSel.value = targetGame;
      if (typeof onGameSelectChange === 'function') {
        try { onGameSelectChange(targetGame); } catch(_){}
      }
    }
  } catch(_){}

  // Refresh ambient identify state so downstream flows (share, refresh
  // price, grade routing) see the right card.
  try {
    window._pendingIdScanCard  = pending;
    window._lastIdentifiedCard = pending;
  } catch(_){}

  try { if (typeof resetCardPanel === 'function') resetCardPanel(); } catch(_){}
  try { selectedCard = null; } catch(_){}
  try {
    const si = document.getElementById('searchInput');
    if (si) si.value = pending.name;
  } catch(_){}

  try {
    if (pending.cardType === 'sports') {
      _routeScannedSportsCard(pending);
    } else if (pending.isJapanese === true) {
      try { _loadScannedJPCard(pending); }
      catch(e) { _loadScannedCardExact(pending); }
    } else if (pending.cardType && pending.cardType !== 'pokemon') {
      try { _loadScannedNonPokemonCard(pending); }
      catch(e) { _loadScannedCardExact(pending); }
    } else {
      _loadScannedCardExact(pending);
    }
    applyGradeAfter(1200); // exact-load pipelines settle in ~1s
    return;
  } catch(e) {
    console.warn('[_ccmViewFullCard] exact router failed, falling back to search', e);
  }

  // Last-resort legacy fallback: type name+number into search, click first
  // dropdown match after settling. Only reached if the exact-load pipeline
  // threw synchronously.
  const searchInput = document.getElementById('searchInput');
  if (!searchInput) return;
  searchInput.value = [pending.name, pending.number].filter(Boolean).join(' ');
  searchInput.dispatchEvent(new Event('input'));
  const searchBtn = document.getElementById('searchBtn');
  if (searchBtn) { try { searchBtn.click(); } catch(e) {} }
  setTimeout(() => {
    const best = document.querySelector('.drop-item');
    if (best) { try { best.click(); } catch(e) {} }
    applyGradeAfter(600);
  }, 800);
}

// 2026-08-17: some collection entries save without a proper card image or
// market price when the bulk-scan lookup misses (pokemontcg.io 5xx blip,
// slabbed card OCR skew, brand-new SIR/full-art not on tcgplayer yet). Rather
// than leaving the user staring at their own scan photo + "Price not fetched",
// this helper re-runs the price/image lookup by name+number and patches the
// stored entry. Safe to call multiple times — no-op if the entry already has
// a canonical image + price.
async function _refetchCardMeta(entryId) {
  const port = loadPortData();
  const p = port.find(x => x.id === entryId);
  if (!p || !p.card) return false;
  // Skip if we already have a canonical card image (not a data: URL / blob:
  // scan photo) AND a positive market price. Nothing to fix.
  const imgIsScan = !p.img || String(p.img).startsWith('data:') || String(p.img).startsWith('blob:');
  const needsImg  = imgIsScan;
  // A slab's value is a published guide value for one grader+grade. Every price
  // this function can reach (pokemontcg.io tcgplayer prices, /api/tcg-price)
  // is a RAW market price, so filling a slab's empty price from here labels a
  // raw number with a grade. That is exactly what happened to an ACE 10 Base
  // Set Charizard: it came out of this path holding raw $366.25 and kept its
  // ACE 10 badge. Slabs must only be priced by _fetchGradedPriceForEntry, which
  // reads the grade-specific field and returns null when the grade is not
  // published (ACE 10 among them). An absent value is correct there; a raw one
  // is not. Image + product-link backfill is still safe -- card art and the
  // product page are the same regardless of grade.
  const isSlab = !!(p.grader && p.grade);
  const needsPrice = !isSlab && !(p.currentValue != null && p.currentValue > 0);
  if (!needsImg && !needsPrice) return false;

  // Pull card number from either the persisted p.number or the "Set · #NUM"
  // string that older entries used.
  const numMatch = p.number || (p.set || '').match(/#\s*(\S+)/)?.[1] || '';
  const cleanNum = String(numMatch).replace(/^0+/, '').split('/')[0].trim();
  const cleanName = String(p.card || '').replace(/["\\]/g, '').trim();
  if (!cleanName) return false;

  let changed = false;
  // Try pokemontcg.io first — gives us both image + tcgplayer prices in one call.
  try {
    const queries = [];
    if (cleanNum) queries.push(`name:"${cleanName}" number:${cleanNum}`);
    queries.push(`name:"${cleanName}"`);
    let cards = null;
    for (const q of queries) {
      cards = await _bulkFetchPokemonCards(q, 7000);
      if (cards && cards.length) break;
    }
    if (cards && cards.length) {
      // Pick best by number match first, then rarity/set signal.
      let best = cards.find(c => (c.number || '').split('/')[0] === cleanNum) || cards[0];
      // Extract image
      const imgUrl = best.images?.small || best.images?.large || '';
      if (needsImg && imgUrl) {
        p.img = imgUrl;
        p.imageUrl = imgUrl;
        changed = true;
      }
      // Extract best price
      if (needsPrice) {
        const prices = best.tcgplayer?.prices || {};
        let bestMarket = null;
        for (const key of Object.keys(prices)) {
          const pp = prices[key];
          const val = (typeof pp?.market === 'number') ? pp.market : (typeof pp?.mid === 'number' ? pp.mid : null);
          if (val != null && (bestMarket == null || val > bestMarket)) bestMarket = val;
        }
        if (bestMarket != null && bestMarket > 0) {
          p.currentValue = bestMarket;
          p.lastRefreshed = new Date().toISOString();
          changed = true;
        }
      }
      if (!p.tcgplayerUrl && best.tcgplayer?.url) {
        p.tcgplayerUrl = best.tcgplayer.url;
        changed = true;
      }
    }
  } catch(e) { /* fall through to /api/tcg-price */ }

  // If still no price, try live TCGplayer via /api/tcg-price. Doesn't help
  // with the image but recovers the market value for SIR / full-art / secret
  // rares that pokemontcg.io indexes without prices.
  if (needsPrice && !(p.currentValue != null && p.currentValue > 0)) {
    try {
      const setName = (p.set || '').replace(/\s*[·•]\s*#\S+.*$/, '').trim();
      const url = `/api/tcg-price?name=${encodeURIComponent(cleanName)}` +
        (cleanNum ? `&number=${encodeURIComponent(cleanNum)}` : '') +
        (setName ? `&set=${encodeURIComponent(setName)}` : '');
      const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
      if (r.ok) {
        const d = await r.json();
        if (d && typeof d.market === 'number' && d.market > 0) {
          p.currentValue = d.market;
          p.lastRefreshed = new Date().toISOString();
          changed = true;
        }
        if (!p.tcgplayerUrl && d && d.url) { p.tcgplayerUrl = d.url; changed = true; }
      }
    } catch(_) {}
  }

  if (changed) {
    // Awaited image/price lookups above, so merge rather than clobber.
    if (!_commitPortfolioRefresh([p]).ok) _reportStorageFailure();
  }
  return changed;
}

async function _ccmRefreshPrice() {
  if (!window._ccmCurrentId) return;
  const btn = document.getElementById('ccmRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Refreshing\u2026'; }
  try {
    // Try to fix any missing image / market price via the card DB first —
    // this recovers entries that saved with the raw scan photo because the
    // bulk-scan lookup transiently failed.
    let metaChanged = false;
    try { metaChanged = await _refetchCardMeta(window._ccmCurrentId); } catch(_) {}
    // Also try the eBay-sold refresh for cards that already have a canonical
    // image but a stale/missing price — keeps parity with the row refresh button.
    if (typeof refreshSingleCardPrice === 'function') {
      await refreshSingleCardPrice(window._ccmCurrentId);
    }
    // Reopen with fresh data.
    openCollectionCardDetail(window._ccmCurrentId);
    if (metaChanged) showToast('Card image + price updated 🖼', 'success');
  } catch(e) {
    showToast('Could not refresh price', 'info');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '\u21bb Refresh current price'; }
  }
}

function _ccmRemoveCard() {
  if (!window._ccmCurrentId) return;
  if (!confirm('Remove this card from your collection?')) return;
  if (typeof deletePortEntry === 'function') {
    deletePortEntry(window._ccmCurrentId);
  } else {
    // Fallback if deletePortEntry isn't defined — handle inline.
    const port = loadPortData().filter(x => x.id !== window._ccmCurrentId);
    _addTombstones('portfolio', window._ccmCurrentId);
    savePortData(port);
    renderCollectionView();
  }
  window._ccmCurrentId = null;
  document.getElementById('collectionCardModal').classList.remove('open');
}

// Long-missing: the ✕ button in each collection row referenced this function
// but it was never defined — clicks were silent no-ops. Define it now.
function deletePortEntry(entryId) {
  const port = loadPortData();
  const next = port.filter(x => x.id !== entryId);
  if (next.length === port.length) return;
  _addTombstones('portfolio', entryId);
  savePortData(next);
  renderCollectionView();
  if (typeof showToast === 'function') showToast('Card removed from collection');
}

/* =========================================================
   MARK AS SOLD (2026-08-19)
   The row-level "🎉 Sold" button on the Collection tab opens the
   markSoldModal. On confirm we push a flip entry (buyPrice from
   the collection row, sellPrice captured in the modal, platform +
   date + profit computed), remove the card from Collection, and
   re-render both views. Free plan flip cap (5) is enforced so this
   button behaves the same as the manual "+ Log a Flip" path.

   Data shape written to flips localStorage (matches saveFlipEntry):
     { id, card, set, buyPrice, sellPrice, profit, platform, date }
   ========================================================= */
/* =========================================================
   _flipNetOf(f) — the ONE definition of what a flip earned.
   Added 2026-09-04. Before this, profit was computed inline in three
   places as `sellPrice - buyPrice`, the flip record had no fee/shipping/
   grading fields, and the Flip Log reported a gross spread while the
   product framed it as money made. A $100 buy sold for $150 that cost
   $20 in fees, $5 shipping and $25 grading — an exact break-even —
   rendered +$50.00 and +50.0%.

   Model:
     net   = sellPrice - buyPrice - fees - shippingCost - gradingCost
     basis = buyPrice + fees + shippingCost + gradingCost   (total cash out)
     roi   = net / basis                                    (null if basis = 0)

   Basis is total cash deployed, not just the purchase price, so ROI answers
   "what did every dollar I put into this flip return". When no extra costs
   are recorded, basis collapses to buyPrice and the result is byte-identical
   to the old arithmetic — which is what keeps legacy flips (written before
   these fields existed) honest instead of retroactively wrong. We do NOT
   invent fees for historical rows.

   Costs are clamped at >= 0: a negative fee would silently inflate profit.
   ========================================================= */
function _flipNetOf(f) {
  const n = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
  const pos = (v) => Math.max(0, n(v));
  const sellPrice    = n(f && f.sellPrice);
  const buyPrice     = n(f && f.buyPrice);
  const fees         = pos(f && f.fees);
  const shippingCost = pos(f && f.shippingCost);
  const gradingCost  = pos(f && f.gradingCost);
  const net   = sellPrice - buyPrice - fees - shippingCost - gradingCost;
  const basis = buyPrice + fees + shippingCost + gradingCost;
  return {
    sellPrice, buyPrice, fees, shippingCost, gradingCost,
    net,
    basis,
    // No cost basis -> ROI is undefined, not 0%. Callers render "-".
    roiPct: basis > 0 ? (net / basis) * 100 : null,
    hasCosts: (fees + shippingCost + gradingCost) > 0,
  };
}

window._markSoldEntryId = null; // the p.id we're marking as sold

function openMarkSoldModal(entryId) {
  const port = loadPortData();
  const p = port.find(x => x.id === entryId);
  if (!p) {
    if (typeof showToast === 'function') showToast('Card not found in collection');
    return;
  }
  window._markSoldEntryId = entryId;

  // Header — name + set line so the user is sure they're logging the right card.
  const nameEl = document.getElementById('msName');
  if (nameEl) {
    const setStr = p.set || '';
    nameEl.textContent = p.card + (setStr ? ' · ' + setStr : '');
  }

  // Buy price prefilled from the row; user can edit if they got a better deal
  // than what was originally logged (e.g. a top-off in a trade).
  const buyEl = document.getElementById('msBuyPrice');
  if (buyEl) buyEl.value = (p.buyPrice || 0) > 0 ? Number(p.buyPrice).toFixed(2) : '';

  // Sell price starts blank so the user is forced to enter what they actually
  // sold it for — auto-filling with market would bias data.
  const sellEl = document.getElementById('msSellPrice');
  if (sellEl) { sellEl.value = ''; setTimeout(() => sellEl.focus(), 50); }

  // Show a "current market: $X, use this" hint so the user can one-tap fill
  // sell price with the market value if that's what they actually sold at.
  const mkt = (typeof p.currentValue === 'number' && p.currentValue > 0) ? p.currentValue : null;
  const hint = document.getElementById('msMktHint');
  const mktVal = document.getElementById('msMktVal');
  if (hint && mktVal) {
    if (mkt) {
      hint.style.display = 'block';
      mktVal.textContent = '$' + mkt.toFixed(2);
    } else {
      hint.style.display = 'none';
    }
  }

  // Reset profit preview
  const prev = document.getElementById('msProfitPreview');
  if (prev) prev.innerHTML = 'Enter a sold price to see profit';
  // Clear the cost inputs too. These are per-flip, so carrying the previous
  // card's fees into the next sale would silently misprice it.
  for (const id of ['msFees','msShipCost','msGradingCost']) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  }

  document.getElementById('markSoldModal').classList.add('open');

  // Wire live profit preview — rebind each open so we don't stack listeners.
  ['msSellPrice','msBuyPrice','msFees','msShipCost','msGradingCost'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = _msUpdateProfitPreview;
  });
}

// Live preview for the Mark-as-sold modal. Promoted from an inline closure to a
// named global on 2026-09-04 so the fee/shipping/grading inputs can call it
// directly and so the preview cannot drift from what confirmMarkSold() stores —
// both now go through _flipNetOf().
function _msUpdateProfitPreview() {
  const pv = document.getElementById('msProfitPreview');
  if (!pv) return;
  const g = (id) => Math.max(0, parseFloat((document.getElementById(id)||{}).value) || 0);
  const sell = g('msSellPrice');
  if (sell <= 0) {
    pv.innerHTML = 'Enter a sold price to see profit';
    pv.style.color = 'var(--text-muted)';
    return;
  }
  const r = _flipNetOf({
    sellPrice: sell, buyPrice: g('msBuyPrice'),
    fees: g('msFees'), shippingCost: g('msShipCost'), gradingCost: g('msGradingCost'),
  });
  const color = r.net >= 0 ? '#4ade80' : '#f87171';
  const sign  = r.net >= 0 ? '+' : '\u2212';
  // Name the costs that were actually subtracted, so the number is auditable
  // rather than a figure the user has to trust.
  const parts = [];
  if (r.fees > 0)        parts.push(`$${r.fees.toFixed(2)} fees`);
  if (r.shippingCost > 0) parts.push(`$${r.shippingCost.toFixed(2)} shipping`);
  if (r.gradingCost > 0)  parts.push(`$${r.gradingCost.toFixed(2)} grading`);
  const breakdown = parts.length
    ? `after ${parts.join(' + ')}`
    : (r.net >= 0 ? 'Profit' : 'Loss') + ' on this flip';
  pv.innerHTML = `<span style="color:${color};font-weight:800">${sign}$${Math.abs(r.net).toFixed(2)}</span>` +
    (r.roiPct !== null ? `<span style="color:${color};opacity:.75;margin-left:.35rem;font-weight:700">(${r.roiPct >= 0 ? '+' : '\u2212'}${Math.abs(r.roiPct).toFixed(1)}%)</span>` : '') +
    `<span style="display:block;font-size:.65rem;color:var(--text-muted);margin-top:.15rem;font-weight:400">${breakdown}</span>`;
}

// One-tap fill from the "current market" hint.
function _msUseMarket() {
  const mktText = (document.getElementById('msMktVal')||{}).textContent || '';
  const v = parseFloat(mktText.replace(/[^0-9.]/g, '')) || 0;
  const sellEl = document.getElementById('msSellPrice');
  if (sellEl && v > 0) { sellEl.value = v.toFixed(2); sellEl.dispatchEvent(new Event('input')); }
}

function confirmMarkSold() {
  const entryId = window._markSoldEntryId;
  if (!entryId) return;
  const port = loadPortData();
  const p = port.find(x => x.id === entryId);
  if (!p) {
    if (typeof showToast === 'function') showToast('Card not found — refresh the page');
    document.getElementById('markSoldModal').classList.remove('open');
    return;
  }

  const sellPrice = parseFloat((document.getElementById('msSellPrice')||{}).value) || 0;
  const buyPrice  = parseFloat((document.getElementById('msBuyPrice')||{}).value)  || 0;
  const platform  = (document.getElementById('msPlatform')||{}).value || 'eBay';

  if (sellPrice <= 0) {
    if (typeof showToast === 'function') showToast('Enter a sold price first');
    const sellEl = document.getElementById('msSellPrice');
    if (sellEl) sellEl.focus();
    return;
  }

  // Free-plan cap — 10 flips max (bumped from 5, 2026-08-20). Matches saveFlipEntry above.
  const flips = loadFlipsData();
  if (!window._isPro && flips.length >= 10) {
    document.getElementById('markSoldModal').classList.remove('open');
    setTimeout(() => { if (typeof openPricingModal === 'function') openPricingModal('flips_cap'); }, 200);
    return;
  }

  // 2026-09-04: profit is now NET of fees, shipping and grading. We store the
  // components alongside it so the Flip Log can show its work and so `profit`
  // never has to be re-derived from fields a caller might forget to pass.
  const _g = (id) => Math.max(0, parseFloat((document.getElementById(id)||{}).value) || 0);
  const fees         = _g('msFees');
  const shippingCost = _g('msShipCost');
  const gradingCost  = _g('msGradingCost');
  const profit = _flipNetOf({ sellPrice, buyPrice, fees, shippingCost, gradingCost }).net;
  const date   = new Date().toISOString().slice(0,10);
  flips.push({
    id: Date.now(),
    updatedAt: Date.now(),
    card: p.card,
    set: p.set || '',
    buyPrice,
    sellPrice,
    fees,
    shippingCost,
    gradingCost,
    profit,
    platform,
    date,
    // 2026-08-19: carry the image + grade metadata from the portfolio row
    // into the flip so the Flip Log can render a proper card row (thumb +
    // name + set + prices) instead of a text-only table.
    img:      p.img || p.imageUrl || '',
    grader:   p.grader || '',
    grade:    (p.grade != null ? p.grade : ''),
    number:   p.number || '',
    source:   'collection_sold' // trace where this flip came from for future analytics
  });
  // If the flip did not persist, do NOT remove the card from the Collection --
  // that would destroy the row and record nothing in its place.
  if (!saveFlipsData(flips)) { _reportStorageFailure(); return; }

  // Remove from Collection.
  _addTombstones('portfolio', entryId); // sold cards must not sync back from another device
  if (!savePortData(port.filter(x => x.id !== entryId))) _reportStorageFailure();

  // Close modal + toast.
  document.getElementById('markSoldModal').classList.remove('open');
  window._markSoldEntryId = null;

  if (typeof showToast === 'function') {
    const sign = profit >= 0 ? '+' : '−';
    const emoji = profit >= 0 ? '🎉' : '📉';
    showToast(`${emoji} Logged ${sign}$${Math.abs(profit).toFixed(2)} flip — moved to Flips tab`, profit >= 0 ? 'gold' : undefined);
  }

  // Re-render both views so the change is immediately visible.
  if (typeof renderFlipsView === 'function') renderFlipsView();
  if (typeof _maybeRerenderCollection === 'function') _maybeRerenderCollection(true);

  // 1-flip-from-cap warning, same nudge as saveFlipEntry.
  if (!window._isPro && flips.length === 4) {
    setTimeout(() => {
      if (typeof showToast === 'function') showToast('1 flip slot left on the free plan — Pro unlocks unlimited tracking 📊', 'gold');
    }, 700);
  }
}

// ── Also re-render collection if active when port data changes ──
// force=true bypasses the visibility check — use after sign-in completes so the
// wall→content transition triggers a fresh render even if user is on another tab.
// Uses getComputedStyle so a CSS rule (e.g. .flips-view{display:none}) is respected,
// not just the inline style.
function _maybeRerenderCollection(force) {
  const colView = document.getElementById('collectionView');
  if (!colView) return;
  if (force) { renderCollectionView(); return; }
  const computed = window.getComputedStyle ? window.getComputedStyle(colView).display : colView.style.display;
  if (computed !== 'none') renderCollectionView();
}

// ══════════════════════════════════════════════════════════
// ADMIN DASHBOARD
// ══════════════════════════════════════════════════════════
const _OWNER_SUB = '111904685934190351595';
window._OWNER_SUB = _OWNER_SUB; // expose for switchView guard

function _maybeShowAdminTab() {
  if (window._userSub === _OWNER_SUB) {
    const tab = document.getElementById('adminTab');
    if (tab) tab.style.display = '';
  }
}

async function loadAdminData() {
  if (window._userSub !== _OWNER_SUB) return;
  const btn = document.getElementById('adminRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Loading…'; }

  try {
    const idTok = window._googleIdToken || '';
    const res  = await fetch('/api/admin', { headers: { 'Authorization': 'Bearer ' + idTok } });
    const data = await res.json();
    if (!res.ok) { showToast('Admin API error: ' + (data.error || res.status), 'error'); return; }

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    setEl('adminProUsers',   data.proUsers);
    setEl('adminProSub',     data.proMonthly + ' monthly · ' + data.proAnnual + ' annual');
    setEl('adminMRR',        '$' + data.revenueEstimate);
    setEl('adminNewsletter', data.newsletterCount);
    setEl('adminSignups',    data.totalSignups);
    setEl('adminReferralSub', data.totalReferrals + ' referrals made');
    setEl('adminGeneratedAt', 'Generated ' + new Date(data.generatedAt).toLocaleString());

    const emailList = document.getElementById('adminEmailList');
    if (emailList) {
      if (data.recentEmails && data.recentEmails.length) {
        emailList.innerHTML = data.recentEmails.map(e =>
          `<div style="padding:.25rem 0;border-bottom:1px solid var(--border)">${e}</div>`
        ).join('');
      } else {
        emailList.textContent = 'No subscribers yet.';
      }
    }
  } catch(err) {
    showToast('Could not load admin data.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
  }
}

// ── Main render ──
function renderFlipsView() {
  const flips = loadFlipsData();
  const port  = loadPortData();

  // ── P&L Stats ──
  // Coerce every numeric field so a legacy null/string value never turns a stat card
  // into "$NaN" or blows up the whole render with a TypeError.
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const totalProfit = flips.reduce((s, f) => s + num(f.profit), 0);
  const bestFlip    = flips.reduce((best, f) => (!best || num(f.profit) > num(best.profit)) ? f : best, null);
  const portCost    = port.reduce((s, p) => s + num(p.buyPrice), 0);
  const portCurVal  = port.reduce((s, p) => s + num(p.currentValue ?? p.buyPrice), 0);
  const unrealized  = portCurVal - portCost;

  const fmt = (n, forceSign) => {
    const sign = forceSign && n > 0 ? '+' : '';
    return sign + '$' + Math.abs(n).toFixed(2);
  };

  document.getElementById('pnlTotalProfit').textContent = fmt(totalProfit);
  document.getElementById('pnlTotalProfit').className = 'pnl-value ' + (totalProfit >= 0 ? 'pos' : 'neg');
  document.getElementById('pnlFlipCount').textContent = flips.length + ' completed flip' + (flips.length !== 1 ? 's' : '');

  document.getElementById('pnlBestFlip').textContent = bestFlip ? fmt(num(bestFlip.profit)) : '—';
  document.getElementById('pnlBestFlip').className = 'pnl-value ' + (bestFlip && num(bestFlip.profit) >= 0 ? 'pos' : 'neg');
  document.getElementById('pnlBestFlipName').textContent = bestFlip ? bestFlip.card : '—';

  document.getElementById('pnlPortValue').textContent = '$' + portCurVal.toFixed(2);
  document.getElementById('pnlPortCount').textContent = port.length + ' card' + (port.length !== 1 ? 's' : '') + ' held';

  document.getElementById('pnlUnrealized').textContent = (unrealized >= 0 ? '+' : '') + '$' + Math.abs(unrealized).toFixed(2);
  document.getElementById('pnlUnrealized').className = 'pnl-value ' + (unrealized >= 0 ? 'pos' : 'neg');

  // ── Flip Log table ──
  const flipWrap = document.getElementById('flipLogWrap');
  if (!flips.length) {
    const _emptyFlipHTML = window._isPro
      ? '<div class="section-panel"><div class="empty-flips"><div class="empty-flips-icon">🔄</div><div class="empty-flips-h">No flips logged yet</div><div class="empty-flips-p">Tap \"+ Log a Flip\" to record your first card sale and start tracking profit.</div></div></div>'
      : `<div class="section-panel"><div class="empty-flips">
          <div class="empty-flips-icon">🔄</div>
          <div class="empty-flips-h">Start tracking your flips</div>
          <div class="empty-flips-p" style="max-width:22ch">Log every card you sell — see your total profit, best flips, and platform breakdown.</div>
          <div style="margin-top:1.1rem;display:flex;flex-direction:column;gap:.5rem;max-width:260px;width:100%">
            <div style="display:flex;align-items:center;gap:.55rem;font-size:.78rem;color:var(--text-muted);text-align:left"><span style="font-size:1rem">✅</span> Free: 10 flips tracked</div>
            <div style="display:flex;align-items:center;gap:.55rem;font-size:.78rem;color:var(--text-muted);text-align:left"><span style="font-size:1rem">🚀</span> Pro: unlimited + all platforms</div>
          </div>
          <button onclick="openPricingModal('flips_empty')" style="margin-top:1.1rem;padding:.55rem 1.5rem;background:var(--gold);color:#000;border:none;border-radius:99px;font-weight:800;font-size:.82rem;cursor:pointer">Upgrade to Pro</button>
        </div></div>`;
    flipWrap.innerHTML = _emptyFlipHTML;
  } else {
    // 2026-08-19: Flip Log rebuilt to mirror the Collection row layout —
    // thumbnail + card name + set on the left, Bought → Sold + ±$ + ROI %
    // on the right. Previous text-only table left users with no visual
    // anchor for what card they'd sold or how much they'd made.
    const sorted = [...flips].sort((a,b) => (b.date || '').localeCompare(a.date || ''));
    const _graderNames = { psa: 'PSA', bgs: 'BGS', cgc: 'CGC', ace: 'ACE', tag: 'TAG', sgc: 'SGC' };
    flipWrap.innerHTML =
      '<div class="flip-table-wrap"><table class="flip-table flip-table-v2"><thead><tr>' +
        '<th style="width:56px"></th>' +   // thumbnail column
        '<th>Card</th>' +
        '<th>Set</th>' +
        '<th class="ft-mono-head">Bought</th>' +
        '<th class="ft-mono-head">Sold</th>' +
        '<th class="ft-mono-head">Profit</th>' +
        '<th class="ft-mono-head">ROI</th>' +
        '<th>Platform</th>' +
        '<th style="width:32px"></th>' +
      '</tr></thead><tbody>' +
      sorted.map(f => {
        const b = num(f.buyPrice), s = num(f.sellPrice);
        // 2026-09-04: ROI now divides by TOTAL cash deployed (buy + fees +
        // shipping + grading), not the purchase price alone, so a flip whose
        // costs exceeded its spread can no longer show a positive return.
        // `pr` still reads the stored profit, which is written net at save
        // time; legacy rows have no cost fields, so basis collapses to
        // buyPrice and they render exactly as they always did.
        const _fn = _flipNetOf(f);
        const pr = (f && f.profit != null) ? num(f.profit) : _fn.net;
        // No cost basis → ROI is undefined; render "—" instead of a
        // misleading "+0.0%". (E.g. cards added at $0 as gifts/finds.)
        const hasCost = _fn.basis > 0;
        const roi = hasCost ? (pr / _fn.basis) * 100 : 0;
        const roiColor = pr >= 0 ? '#4ade80' : '#f87171';
        // Thumbnail — mirror the Collection cell: 40x56, card-back placeholder
        // if no image was captured (e.g. legacy flips logged before this
        // migration, or manual "+ Log a Flip" without a portfolio row).
        const thumb = f.img || f.imageUrl || '';
        const thumbImg = thumb
          ? `<img src="${esc(thumb)}" loading="lazy" alt="" style="width:40px;height:56px;object-fit:cover;border-radius:6px;background:#111;border:1px solid #1f1f1f;display:block">`
          : `<div style="width:40px;height:56px;border-radius:6px;background:#111;border:1px solid #1f1f1f;display:flex;align-items:center;justify-content:center;font-size:1.1rem;opacity:.5">🃏</div>`;
        // Grade badge on the thumb (only if this flip was of a graded card).
        const _hasGrade = f.grader && f.grade != null && f.grade !== '';
        const _gradeLabel = _hasGrade
          ? `${_graderNames[String(f.grader).toLowerCase()] || String(f.grader).toUpperCase()} ${f.grade}`
          : '';
        const gradeBadge = _hasGrade
          ? `<div title="Sold at ${esc(_gradeLabel)}" style="position:absolute;top:-4px;right:-4px;padding:1px 4px;background:linear-gradient(135deg,#f0b429,#d4af37);color:#000;font-size:.55rem;font-weight:900;border-radius:4px;line-height:1.1;letter-spacing:.02em;box-shadow:0 1px 3px rgba(0,0,0,.6);border:1px solid #000;white-space:nowrap">${esc(_gradeLabel)}</div>`
          : '';
        const thumbCell = `<div style="position:relative;width:40px;height:56px">${thumbImg}${gradeBadge}</div>`;
        const cardNameHtml = _hasGrade
          ? `<span style="display:inline-block;padding:.05rem .3rem;margin-right:.35rem;background:rgba(212,175,55,.18);border:1px solid rgba(212,175,55,.4);border-radius:4px;font-size:.65rem;font-weight:800;color:var(--gold-text);vertical-align:middle;white-space:nowrap">${esc(_gradeLabel)}</span>${esc(f.card)}`
          : esc(f.card);
        // Date shown as small caption under the card name so we don't need
        // a dedicated column (saves horizontal space for the thumbnail).
        const dateCaption = f.date ? `<div style="font-size:.62rem;color:var(--text-faint);font-weight:400;margin-top:.1rem">Sold ${esc(f.date)}</div>` : '';
        // Whole row is tap-to-open (mirrors Collection). Delete button
         // stops propagation so it doesn't also open the detail modal.
        return `<tr class="col-row" onclick="openFlipDetail(${f.id})" style="cursor:pointer">
          <td>${thumbCell}</td>
          <td><div class="ft-card" title="${esc(f.card)}${_hasGrade ? ' — ' + esc(_gradeLabel) : ''}">${cardNameHtml}</div>${dateCaption}</td>
          <td style="font-size:.72rem;color:var(--text-muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.set||'—')}</td>
          <td class="ft-mono">$${b.toFixed(2)}</td>
          <td class="ft-mono" style="color:var(--gold-text)">$${s.toFixed(2)}</td>
          <td class="ft-mono" style="color:${roiColor};font-weight:700">${pr>=0?'+':''}$${Math.abs(pr).toFixed(2)}</td>
          <td style="font-size:.72rem;color:${hasCost?roiColor:'var(--text-faint)'};font-weight:700">${hasCost?`${roi>=0?'+':''}${roi.toFixed(1)}%`:'—'}</td>
          <td style="font-size:.72rem">${esc(f.platform || '—')}</td>
          <td onclick="event.stopPropagation()"><button class="ft-delete" onclick="deleteFlip(${f.id})" title="Delete flip">✕</button></td>
        </tr>`;
      }).join('') +
    '</tbody></table></div>';
  }

  // ── Grading Log ──
  renderGradingLog();

  // ── Portfolio table ──
  const portWrap = document.getElementById('portfolioWrap');
  if (!port.length) {
    portWrap.innerHTML = '<div class="empty-flips"><div class="empty-flips-icon">💼</div><div class="empty-flips-h">No cards in portfolio</div><div class="empty-flips-p">Tap "+ Add Card" to track cards you own and watch their value.</div></div>';
  } else {
    const sorted = [...port].sort((a,b) => (b.addedDate || '').localeCompare(a.addedDate || ''));
    portWrap.innerHTML = '<div class="port-table-wrap"><table class="port-table"><thead><tr><th>Added</th><th>Card</th><th>Set / Notes</th><th>Cost</th><th>Mkt Value</th><th>Gain</th><th></th></tr></thead><tbody>' +
      sorted.map(p => {
        // Guard every numeric field — legacy / partial entries can leave buyPrice or
        // currentValue as null, which used to crash .toFixed(2) and blank the whole table.
        const buy  = Number(p.buyPrice) || 0;
        const cur  = Number(p.currentValue ?? p.buyPrice) || 0;
        const gain = cur - buy;
        return `<tr>
          <td class="ft-mono" style="font-size:.72rem">${esc(p.addedDate || '—')}</td>
          <td><div class="ft-card" title="${esc(p.card)}">${esc(p.card)}${p.estGrade ? `<span style="margin-left:.35rem;font-size:.6rem;font-weight:800;padding:.1rem .35rem;border-radius:4px;background:${p.estGrade>=9?'rgba(74,222,128,.15)':p.estGrade>=7?'rgba(250,204,21,.15)':p.estGrade>=5?'rgba(251,146,60,.15)':'rgba(248,113,113,.15)'};color:${p.estGrade>=9?'#4ade80':p.estGrade>=7?'#facc15':p.estGrade>=5?'#fb923c':'#f87171'};border:1px solid ${p.estGrade>=9?'rgba(74,222,128,.3)':p.estGrade>=7?'rgba(250,204,21,.3)':p.estGrade>=5?'rgba(251,146,60,.3)':'rgba(248,113,113,.3)'};white-space:nowrap">PSA ${p.estGrade} Est.</span>` : ''}</div></td>
          <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.72rem">${esc(p.set||'—')}</td>
          <td class="ft-mono">$${buy.toFixed(2)}</td>
          <td class="ft-mono">$${cur.toFixed(2)}</td>
          <td><span class="pt-gain ${gain >= 0 ? 'pos' : 'neg'}">${gain >= 0 ? '+' : ''}$${Math.abs(gain).toFixed(2)}</span></td>
          <td><button class="ft-delete" onclick="deletePort(${p.id})" title="Remove">✕</button></td>
        </tr>`;
      }).join('') +
    '</tbody></table></div>';
  }
}


/* ═══════════════════════════════════════
   GOOGLE SIGN-IN
   ═══════════════════════════════════════ */

// window.googleUser is a global property — the Firebase module script writes window.googleUser
// and bare `window.googleUser` in non-module scripts reads the same window property.
window.googleUser = null; // set by Firebase onAuthStateChanged in module script
window._authResolved = false; // true only when a signed-in user is confirmed
window._authInitialized = false; // true after first onAuthStateChanged fires (any result)

// Waits up to 4s for a signed-in user. Resolves immediately if already signed in.
// If Firebase fires null (not signed in), resolves after _authInitialized is true.
window._waitForAuth = function() {
  return new Promise(resolve => {
    // Already have a confirmed signed-in user — resolve immediately
    // googleUser is now set synchronously in onAuthStateChanged, no need to wait for token
    if (window.googleUser) { resolve(window.googleUser); return; }
    // Poll for up to 6s — resolves as soon as googleUser is set
    const start = Date.now();
    const check = () => {
      if (window.googleUser) {
        resolve(window.googleUser);
      } else if (window._authInitialized && !window.googleUser && Date.now() - start > 500) {
        // Firebase fired with no user and 500ms grace passed — definitely signed out
        resolve(null);
      } else if (Date.now() - start > 6000) {
        resolve(null);
      } else {
        setTimeout(check, 80);
      }
    };
    setTimeout(check, 80);
  });
};

// ── Google OAuth Client ID — reads from config.js first, then localStorage fallback ──
const _HARDCODED_CLIENT_ID = window.CARDSELL_GOOGLE_CLIENT_ID || '458953497801-placeholder.apps.googleusercontent.com';
const _SAVED_CLIENT_ID = (() => { try { return localStorage.getItem('cardsell_google_client_id') || ''; } catch(e) { return ''; } })();
const GOOGLE_CLIENT_ID = (_SAVED_CLIENT_ID && !_SAVED_CLIENT_ID.includes('placeholder')) ? _SAVED_CLIENT_ID : _HARDCODED_CLIENT_ID;
const GOOGLE_AUTH_READY = !GOOGLE_CLIENT_ID.includes('placeholder') && GOOGLE_CLIENT_ID.includes('.apps.googleusercontent.com');

function saveGoogleClientId() {
  const input = document.getElementById('googleClientIdInput');
  const status = document.getElementById('googleIdStatus');
  const val = (input?.value || '').trim();
  if (!val || !val.includes('.apps.googleusercontent.com')) {
    if (status) status.textContent = '⚠️ That doesn\'t look like a valid Client ID. It should end in .apps.googleusercontent.com';
    return;
  }
  try { localStorage.setItem('cardsell_google_client_id', val); } catch(e) {}
  if (status) status.textContent = '✅ Saved! Reload the page to activate Google Sign-In.';
}

function initGoogleSignIn() {
  // Firebase auth handles everything — just wire up the header sign-in button
  const btn = document.getElementById('googleSignInBtn');
  if (btn && !btn.dataset.fbWired) {
    btn.dataset.fbWired = '1';
    btn.textContent = 'Sign In';
    btn.href = '/signin';
  }
}


// ── Reliable sign-in trigger — works from any button ──
function triggerGoogleSignIn() {
  window.location.href = '/signin';
}


function handleGoogleSignIn(response) {
  // Handled by Firebase onAuthStateChanged — this stub kept for compatibility
}


function applyGoogleUser() {
  if (!window.googleUser) return;
  const btn = document.getElementById('googleSignInBtn');
  if (btn) btn.style.display = 'none';
  const userBtn = document.getElementById('googleUserBtn');
  if (userBtn) userBtn.style.display = 'flex';
  const avatar = document.getElementById('googleAvatar');
  if (avatar) avatar.src = window.googleUser.avatar || '';
  const nameEl = document.getElementById('googleName');
  if (nameEl) nameEl.textContent = (window.googleUser.name || 'User').split(' ')[0];
  // ✓ Verified badge — shown only when email is verified
  const vBadge = document.getElementById('verifiedBadge');
  if (vBadge) vBadge.style.display = window.googleUser.emailVerified ? 'inline-flex' : 'none';
  // Unverified banner — nudge them to verify to unlock bonus
  _updateVerifyBanner();
  // Check pro status
  checkProStatus();
  _maybeShowAdminTab();
  _updateFlipsSignInWall?.();
  // Flip the collection sign-in wall too, and rerender if Collection is the active tab.
  // Without this, users who land directly on /collection see the wall stay up even after
  // Firebase restores their session because renderCollectionView already ran and bailed.
  _updateCollectionSignInWall?.();
  _maybeRerenderCollection?.(true);
  updateProUI?.();
  // Prefill newsletter email if settings open
  const nlInput = document.getElementById('newsletterEmail');
  if (nlInput && !nlInput.value && window.googleUser.email) nlInput.value = window.googleUser.email;
}

// Show a small banner at the top when the signed-in user hasn't verified their email yet.
// Applies to everyone — Google/Apple sign-in email must still be verified via the emailed link
// before the signup bonus is unlocked (prevents fake-account abuse).
function _updateVerifyBanner() {
  let banner = document.getElementById('emailVerifyBanner');
  const gu = window.googleUser;
  // Respect the user's session-scoped dismissal so we don't nag on every page load.
  let dismissed = false;
  try { dismissed = sessionStorage.getItem('verifyBannerDismissed') === '1'; } catch(e) {}
  const needBanner = gu && !gu.emailVerified && !dismissed;
  if (!needBanner) { if (banner) banner.remove(); return; }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'emailVerifyBanner';
    banner.style.cssText = 'position:sticky;top:0;z-index:1000;background:linear-gradient(90deg,#f59e0b,#f97316);color:#000;font-size:.82rem;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.25)';
    // Layout: dismiss button is its own flex child pinned right; content stays centered.
    // This is more reliable in iOS Safari than absolute positioning inside a sticky parent.
    banner.innerHTML =
      '<div style="display:flex;align-items:center;padding:.55rem .55rem .55rem .9rem;gap:.5rem">' +
        '<div style="flex:1;display:flex;align-items:center;justify-content:center;gap:.75rem;flex-wrap:wrap;text-align:center">' +
          '<span>⚠️ Verify any email to unlock <strong>10 ID scans + 1 AI Grade</strong> bonus</span>' +
          '<button id="btnResendVerifyMain" onclick="openVerifyModal()" style="background:#000;color:#fff;border:none;border-radius:6px;padding:.35rem .8rem;font-weight:700;font-size:.75rem;cursor:pointer">Verify email</button>' +
        '</div>' +
        '<button id="btnDismissVerifyBanner" onclick="dismissVerifyBanner()" title="Dismiss" aria-label="Dismiss" style="flex-shrink:0;align-self:flex-start;background:rgba(0,0,0,.15);color:#000;border:1.5px solid rgba(0,0,0,.35);border-radius:6px;width:1.6rem;height:1.6rem;font-size:1rem;font-weight:800;line-height:1;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center">×</button>' +
      '</div>';
    document.body.insertBefore(banner, document.body.firstChild);
  }
}

function dismissVerifyBanner() {
  try { sessionStorage.setItem('verifyBannerDismissed', '1'); } catch(e) {}
  const b = document.getElementById('emailVerifyBanner');
  if (b) b.remove();
}

// ── Universal verify flow ────────────────────────────────────────────────
// Works for every account, regardless of sign-in provider. User types any
// email address, we send a 6-digit code via Resend, they enter it back.
// Backend enforces one-per-account AND one-per-email bonus gates so the
// same email can't be reused across throwaway accounts.

function _updateVerifiedEmailPanel() {
  const sec = document.getElementById('verifiedEmailSection');
  const val = document.getElementById('verifiedEmailValue');
  if (!sec || !val) return;
  const verified = window._emailVerified || (window.googleUser && window.googleUser.emailVerified);
  const email = window._verifiedEmail || (window.googleUser && window.googleUser.email) || '';
  if (verified && email) {
    sec.style.display = '';
    val.textContent = email;
  } else {
    sec.style.display = 'none';
  }
}

function openVerifyModal(prefillEmail) {
  // Remove any existing modal first
  const existing = document.getElementById('verifyEmailModal');
  if (existing) existing.remove();

  const defaultEmail = prefillEmail
    || (window.googleUser && window.googleUser.email)
    || (window._verifiedEmail || '');

  const overlay = document.createElement('div');
  overlay.id = 'verifyEmailModal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:1rem';
  overlay.innerHTML =
    '<div style="background:#1a1a1a;border:1px solid #333;border-radius:14px;max-width:22rem;width:100%;padding:1.35rem;color:#fff;font-size:.9rem;line-height:1.45;box-shadow:0 20px 60px rgba(0,0,0,.5)">' +
      '<div style="font-weight:800;font-size:1.05rem;margin-bottom:.35rem">Verify your email</div>' +
      '<div id="verifyModalSubtitle" style="color:#bbb;font-size:.78rem;margin-bottom:.9rem">' +
        'Enter any email you own — we\u2019ll send a 6-digit code. Unlocks <strong style="color:#f59e0b">10 ID scans + 1 AI Grade</strong>.' +
      '</div>' +

      // Step 1 — email input
      '<div id="verifyStepEmail">' +
        '<input id="verifyEmailInput" type="email" autocomplete="email" inputmode="email" placeholder="your@email.com" value="' + (defaultEmail || '').replace(/"/g, '&quot;') + '" ' +
          'style="width:100%;padding:.6rem .7rem;background:#0f0f0f;border:1px solid #333;border-radius:8px;color:#fff;font-size:.95rem;outline:none;margin-bottom:.75rem" />' +
        '<div id="verifyEmailErr" style="display:none;color:#f87171;font-size:.72rem;margin-bottom:.55rem"></div>' +
        '<button id="verifySendBtn" onclick="_verifySendCode()" style="width:100%;background:#f59e0b;color:#000;border:none;border-radius:8px;padding:.65rem;font-weight:800;font-size:.9rem;cursor:pointer">Send code</button>' +
      '</div>' +

      // Step 2 — code entry (hidden until send succeeds)
      '<div id="verifyStepCode" style="display:none">' +
        '<div id="verifyCodeSentTo" style="font-size:.75rem;color:#9ae6b4;margin-bottom:.55rem"></div>' +
        '<input id="verifyCodeInput" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="123456" ' +
          'style="width:100%;padding:.65rem;background:#0f0f0f;border:1px solid #333;border-radius:8px;color:#fff;font-size:1.4rem;letter-spacing:.35em;text-align:center;font-weight:700;outline:none;margin-bottom:.6rem" />' +
        '<div id="verifyCodeErr" style="display:none;color:#f87171;font-size:.72rem;margin-bottom:.55rem"></div>' +
        '<button id="verifyConfirmBtn" onclick="_verifyConfirmCode()" style="width:100%;background:#f59e0b;color:#000;border:none;border-radius:8px;padding:.65rem;font-weight:800;font-size:.9rem;cursor:pointer;margin-bottom:.4rem">Verify</button>' +
        '<button id="verifyResendBtn" onclick="_verifyBackToEmail()" style="width:100%;background:transparent;color:#aaa;border:1px solid #333;border-radius:8px;padding:.5rem;font-weight:600;font-size:.78rem;cursor:pointer">Use a different email / resend</button>' +
      '</div>' +

      '<div style="margin-top:.75rem;text-align:right">' +
        '<button onclick="document.getElementById(\'verifyEmailModal\').remove()" style="background:transparent;color:#888;border:none;font-size:.75rem;cursor:pointer;padding:.3rem .5rem">Close</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  // Autofocus + Enter key handling
  setTimeout(() => {
    const inp = document.getElementById('verifyEmailInput');
    if (inp) {
      inp.focus();
      inp.select();
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); _verifySendCode(); } });
    }
  }, 50);
}

function _verifyBackToEmail() {
  document.getElementById('verifyStepCode').style.display = 'none';
  document.getElementById('verifyStepEmail').style.display = '';
  const inp = document.getElementById('verifyEmailInput');
  if (inp) { inp.focus(); inp.select(); }
}

async function _verifySendCode() {
  const inp = document.getElementById('verifyEmailInput');
  const err = document.getElementById('verifyEmailErr');
  const btn = document.getElementById('verifySendBtn');
  const email = (inp?.value || '').trim().toLowerCase();
  err.style.display = 'none';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    err.textContent = 'Enter a valid email address.';
    err.style.display = '';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending\u2026';

  // Always refresh the Firebase token first — stale tokens (>1h old)
  // cause "Invalid token" on the backend.
  let tok = window._googleIdToken;
  try {
    if (window._fbCurrentUser && typeof window._fbCurrentUser.getIdToken === 'function') {
      tok = await window._fbCurrentUser.getIdToken(true);
      window._googleIdToken = tok;
    }
  } catch(e) { /* fall back to cached tok */ }

  if (!tok) {
    err.textContent = 'Not signed in. Refresh the page and try again.';
    err.style.display = '';
    btn.disabled = false;
    btn.textContent = 'Send code';
    return;
  }

  try {
    const resp = await fetch('/api/verify-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify({ email }),
    });
    const data = await resp.json().catch(() => ({}));

    // Firebase-link fallback: Resend sandbox rejected the recipient.
    // Send a native Firebase verification link instead — works for any inbox.
    if (data && data.fallback === 'firebase_link') {
      try {
        if (typeof window._fbSendVerification === 'function') {
          await window._fbSendVerification();
          err.style.display = 'none';
          const subtitle = document.getElementById('verifyModalSubtitle');
          if (subtitle) {
            subtitle.innerHTML = '\u2709\ufe0f A verification link was sent to <strong>' +
              (window.googleUser?.email || 'your inbox') +
              '</strong>. Tap the link, then come back and tap <strong>I\u2019ve verified</strong> below to claim your bonus.' +
              '<div style="background:#3a2a10;border:1px solid #a97010;border-radius:8px;padding:.5rem .65rem;margin-top:.6rem;color:#fbbf24;font-size:.72rem;line-height:1.4">' +
              '\u26a0\ufe0f <strong>Don\u2019t see it?</strong> Check your <strong>Spam</strong> or <strong>Junk</strong> folder \u2014 sender is <strong>noreply@cardresell-e0329.firebaseapp.com</strong>. Mark it \u201cNot Spam\u201d so future emails hit your inbox.' +
              '</div>';
          }
          document.getElementById('verifyStepEmail').style.display = 'none';
          const codeStep = document.getElementById('verifyStepCode');
          if (codeStep) {
            codeStep.style.display = '';
            // Hide the code input row; show a single "I've verified" button.
            codeStep.innerHTML =
              '<button id="verifyLinkDoneBtn" onclick="_verifyFirebaseLinkDone()" ' +
              'style="width:100%;padding:.75rem;background:var(--gold);color:#000;border:none;border-radius:8px;font-weight:800;font-size:.9rem;cursor:pointer">' +
              'I\u2019ve verified \u2014 claim bonus</button>' +
              // Cloudflare Turnstile widget (2026-08-14). Renders invisibly for
              // real users, blocks automation. Site key injected by _tsRenderInto
              // right after the modal HTML mounts (needs the DOM present first).
              '<div id="verifyTurnstile" style="margin-top:.65rem;min-height:0;display:flex;justify-content:center"></div>' +
              '<div id="verifyLinkErr" style="color:#f87171;font-size:.75rem;margin-top:.5rem;display:none"></div>' +
              '<button onclick="_verifyBackToEmail()" style="margin-top:.6rem;background:transparent;border:none;color:#888;font-size:.75rem;cursor:pointer;text-decoration:underline">Use a different email</button>';
            // Mount the Turnstile widget once the DOM node exists. Grabs a
            // fresh token that _verifyFirebaseLinkDone() then sends to the API.
            setTimeout(() => _tsRenderInto('verifyTurnstile'), 0);
          }
        } else {
          err.textContent = 'Verification currently unavailable. Try again in a few minutes.';
          err.style.display = '';
        }
      } catch(fbErr) {
        console.error('Firebase verification send error:', fbErr);
        err.textContent = 'Could not send Firebase verification link. Try again.';
        err.style.display = '';
      }
      btn.disabled = false;
      btn.textContent = 'Send code';
      return;
    }

    if (!resp.ok || !data.ok) {
      err.textContent = data.error || ('Could not send code (' + resp.status + ')');
      err.style.display = '';
      btn.disabled = false;
      btn.textContent = 'Send code';
      return;
    }

    // Move to step 2
    window._verifyPendingEmail = email;
    document.getElementById('verifyStepEmail').style.display = 'none';
    document.getElementById('verifyStepCode').style.display = '';
    document.getElementById('verifyCodeSentTo').textContent = '\u2709\ufe0f Code sent to ' + email + '. Check your inbox (and spam).';
    const cInp = document.getElementById('verifyCodeInput');
    if (cInp) {
      cInp.value = '';
      setTimeout(() => cInp.focus(), 50);
      cInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); _verifyConfirmCode(); } });
    }
    btn.disabled = false;
    btn.textContent = 'Send code';
  } catch(e) {
    err.textContent = 'Network error. Try again.';
    err.style.display = '';
    btn.disabled = false;
    btn.textContent = 'Send code';
  }
}

async function _verifyConfirmCode() {
  const inp = document.getElementById('verifyCodeInput');
  const err = document.getElementById('verifyCodeErr');
  const btn = document.getElementById('verifyConfirmBtn');
  const code = (inp?.value || '').trim().replace(/\D/g, '');
  err.style.display = 'none';

  if (code.length !== 6) {
    err.textContent = 'Enter the 6-digit code from the email.';
    err.style.display = '';
    return;
  }
  const email = window._verifyPendingEmail;
  btn.disabled = true;
  btn.textContent = 'Verifying\u2026';

  // Refresh Firebase token before the confirm call too.
  let tok = window._googleIdToken;
  try {
    if (window._fbCurrentUser && typeof window._fbCurrentUser.getIdToken === 'function') {
      tok = await window._fbCurrentUser.getIdToken(true);
      window._googleIdToken = tok;
    }
  } catch(e) { /* fall back to cached tok */ }

  if (!email || !tok) {
    err.textContent = 'Session expired. Close and try again.';
    err.style.display = '';
    btn.disabled = false;
    btn.textContent = 'Verify';
    return;
  }

  try {
    const resp = await fetch('/api/verify-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify({ email, code }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      err.textContent = data.error || ('Could not verify code (' + resp.status + ')');
      err.style.display = '';
      btn.disabled = false;
      btn.textContent = 'Verify';
      return;
    }

    // Success — update client state and close modal
    if (window.googleUser) window.googleUser.emailVerified = true;
    window._emailVerified = true;
    window._verifiedEmail = email;
    try { const vBadge = document.getElementById('verifiedBadge'); if (vBadge) vBadge.style.display = 'inline-flex'; } catch(e) {}
    const modal = document.getElementById('verifyEmailModal');
    if (modal) modal.remove();
    _updateVerifyBanner?.();
    try { await checkProStatus?.(); } catch(e) {}
    // 2026-08-20: instrument signup bonus grant — top-of-funnel event.
    try {
      window.trackEvent && window.trackEvent('signup_bonus', {
        granted: !!data.bonusGranted,
        reason:  data.bonusReason || '',
      });
    } catch(e) {}
    if (data.bonusGranted) {
      showToast('\u2713 Verified — 10 ID scans + 1 AI Grade unlocked', 'gold');
    } else {
      const reason = data.bonusReason === 'email-already-claimed'
        ? 'This email was already used for a bonus on another account'
        : (data.bonusReason === 'already-granted-to-user'
            ? 'Bonus already claimed on this account'
            : (data.bonusReason === 'ip-throttle'
                ? 'Sign-up bonus limit reached on your network today'
                : 'Email verified'));
      showToast('\u2713 ' + reason, 'gold');
    }
  } catch(e) {
    err.textContent = 'Network error. Try again.';
    err.style.display = '';
    btn.disabled = false;
    btn.textContent = 'Verify';
  }
}

// Firebase-link fallback confirm: user tapped the link in their inbox, now claim bonus.
async function _verifyFirebaseLinkDone() {
  const btn = document.getElementById('verifyLinkDoneBtn');
  const err = document.getElementById('verifyLinkErr');
  if (err) err.style.display = 'none';
  if (btn) { btn.disabled = true; btn.textContent = 'Checking\u2026'; }

  // Force-refresh the Firebase token so email_verified claim is current.
  let tok = window._googleIdToken;
  try {
    if (window._fbCurrentUser && typeof window._fbCurrentUser.getIdToken === 'function') {
      // Reload user first so email_verified propagates.
      try { if (typeof window._fbCurrentUser.reload === 'function') await window._fbCurrentUser.reload(); } catch(e) {}
      tok = await window._fbCurrentUser.getIdToken(true);
      window._googleIdToken = tok;
    }
  } catch(e) { /* fall back to cached tok */ }

  if (!tok) {
    if (err) { err.textContent = 'Session expired. Close and try again.'; err.style.display = ''; }
    if (btn) { btn.disabled = false; btn.textContent = 'I\u2019ve verified \u2014 claim bonus'; }
    return;
  }

  // Pull the Turnstile response token if the widget rendered. If Turnstile
  // isn't configured (no site key), _tsGetToken returns '' and the API-side
  // check soft-skips too.
  const turnstileToken = _tsGetToken('verifyTurnstile');
  try {
    const resp = await fetch('/api/verify-claim-firebase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify({ turnstileToken }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      const msg = data.error === 'email-not-verified'
        ? 'Firebase says your email isn\u2019t verified yet. Tap the link in your inbox, then try again.'
        : (data.error || ('Could not confirm verification (' + resp.status + ')'));
      if (err) { err.textContent = msg; err.style.display = ''; }
      if (btn) { btn.disabled = false; btn.textContent = 'I\u2019ve verified \u2014 claim bonus'; }
      return;
    }

    // Success — update client state and close modal (mirrors _verifyConfirmCode).
    if (window.googleUser) window.googleUser.emailVerified = true;
    window._emailVerified = true;
    window._verifiedEmail = data.email || (window.googleUser && window.googleUser.email) || null;
    try { const vBadge = document.getElementById('verifiedBadge'); if (vBadge) vBadge.style.display = 'inline-flex'; } catch(e) {}
    const modal = document.getElementById('verifyEmailModal');
    if (modal) modal.remove();
    _updateVerifyBanner?.();
    try { await checkProStatus?.(); } catch(e) {}
    if (data.bonusGranted) {
      showToast('\u2713 Verified \u2014 10 ID scans + 1 AI Grade unlocked', 'gold');
    } else {
      const reason = data.bonusReason === 'email-already-claimed'
        ? 'This email was already used for a bonus on another account'
        : (data.bonusReason === 'already-granted-to-user'
            ? 'Bonus already claimed on this account'
            : 'Email verified');
      showToast('\u2713 ' + reason, 'gold');
    }
  } catch(e) {
    if (err) { err.textContent = 'Network error. Try again.'; err.style.display = ''; }
    if (btn) { btn.disabled = false; btn.textContent = 'I\u2019ve verified \u2014 claim bonus'; }
  }
}


// 2026-08-30: shareRanking — opens a native share sheet (or copies to clipboard)
// with a link to the site whose OG image is a dynamic /api/payout-og
// rendering of the ranking bar. This is how CardResell spreads to Reddit /
// Discord / Twitter without paid ads.
function shareRanking() {
  const r = window._lastRanking;
  if (!r || !r.venues || r.venues.length < 2) {
    showToast && showToast('Load a card first, then tap Share.');
    return;
  }
  // Build canonical share URL. Params round-trip through the OG endpoint
  // so the preview image reflects the exact ranking the user saw.
  const venuesParam = r.venues.slice(0, 5)
    .map(v => `${encodeURIComponent(v.name)}:${(Number(v.pay) || 0).toFixed(2)}`).join(',');
  const params = new URLSearchParams({
    card: r.card,
    venues: venuesParam,
  });
  if (typeof r.price === 'number' && !isNaN(r.price)) params.set('price', r.price.toFixed(2));
  const shareUrl = `${window.location.origin}/?share=1&${params.toString()}`;
  const best = r.venues[0];
  const msg = `${r.card} → ${best.name} pays $${best.pay.toFixed(2)} after fees. Full ranking on CardResell:`;
  const data = { title: 'CardResell payout ranking', text: msg, url: shareUrl };
  try { window.trackEvent && window.trackEvent('share_ranking_click'); } catch(_){}
  // Clipboard-first fallback so users ALWAYS get feedback, even on browsers
  // where navigator.share exists but the OS share sheet fails silently
  // (headless browsers, some webviews, certain iOS PWA contexts).
  const copyToClipboard = () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(shareUrl)
        .then(() => { showToast && showToast('🔗 Link copied — paste anywhere'); })
        .catch(() => { prompt('Copy this link:', shareUrl); });
    }
    prompt('Copy this link:', shareUrl);
    return Promise.resolve();
  };
  if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
    navigator.share(data).catch((err) => {
      // AbortError = user cancelled the share sheet on purpose; don't nag them
      if (err && err.name === 'AbortError') return;
      copyToClipboard();
    });
  } else {
    copyToClipboard();
  }
}

function shareReferralLink() {
  const code = window._userRefCode || '';
  if (!code) return;
  const link = window.location.origin + '/?ref=' + encodeURIComponent(code);
  const msg  = 'Check out CardResell — it tells you exactly where to sell your trading cards for the most profit. Sign up free and we both get 5 bonus ID scans: ' + link;
  if (navigator.share) {
    navigator.share({ title: 'CardResell — see where you\'ll pocket the most', text: msg, url: link })
      .catch(() => {});
  } else {
    navigator.clipboard.writeText(link).then(() => {
      const copied = document.getElementById('refCopiedMsg');
      if (copied) { copied.style.display = 'block'; setTimeout(() => copied.style.display = 'none', 3500); }
    }).catch(() => {
      // Fallback — prompt copy
      window.prompt('Copy your referral link:', link);
    });
  }
}

// Sign-out has to actually sign out. Two things were wrong before:
//   1. The null auth callback ignored every null once a uid was set, so nothing
//      was ever cleared -- window.googleUser survived and getUserKey() kept
//      resolving to the signed-out account's UID-scoped collection.
//   2. The failure was invisible: fbSignOut()'s rejection went to console only,
//      so a failed sign-out looked identical to a successful one.
async function signOut() {
  const name = window.googleUser?.name || 'your account';
  if (!window.confirm('Sign out of ' + name + '?')) return;
  // Announce intent BEFORE calling Firebase, so the null callback it triggers is
  // treated as authoritative rather than as a token-refresh artifact.
  window._signOutIntent = true;
  try {
    if (window._fbSignOut) await window._fbSignOut();
  } catch (e) {
    console.error('sign-out failed', e);
    window._signOutIntent = false;
    try { showToast('Could not sign out \u2014 check your connection and try again', 'error'); } catch(_) {}
    return;   // still signed in; do NOT clear local identity or we'd show a
              // signed-out UI over a live session.
  }
  // Clear immediately rather than waiting on the callback. Firebase normally
  // fires it, but a swallowed/late callback used to leave the previous user's
  // data on screen; clearing here makes sign-out synchronous from the user's
  // point of view. The callback is idempotent, so a later fire is harmless.
  try { window._clearAuthIdentityNow && window._clearAuthIdentityNow(); } catch(_) {}
}


/* ═══════════════════════════════════════
   CARD SCANNER — Photo + AI Vision
   ═══════════════════════════════════════ */

// ── Scanner gate — requires Google sign-in ──
function openScanner() {
  if (!window.googleUser) {
    // Show a friendly prompt instead of just doing nothing
    const overlay  = document.getElementById('scanOverlay');
    const statusEl = document.getElementById('scanStatus');
    const resultEl = document.getElementById('scanResult');
    const prevWrap = document.getElementById('scanPreviewWrap');
    prevWrap.style.display = 'none';
    resultEl.textContent = '';
    statusEl.innerHTML = `
      <div style="text-align:center;padding:1rem">
        <div style="font-size:2rem;margin-bottom:.75rem">📷</div>
        <div style="font-size:1rem;font-weight:700;color:#fff;margin-bottom:.5rem">Sign in to scan cards</div>
        <div style="font-size:.85rem;color:rgba(255,255,255,.65);margin-bottom:1.25rem">Google sign-in is required to use the card scanner.</div>
        <button onclick="cancelScan();triggerGoogleSignIn()" style="background:var(--gold);color:#000;border:none;border-radius:8px;padding:.6rem 1.4rem;font-weight:700;font-size:.9rem;cursor:pointer">Sign in with Google</button>
      </div>`;
    overlay.style.display = 'flex';
    return;
  }
  // 2026-09-01: Route the top-level Scan CTA through the live camera overlay
  // (dashed card frame + QA feedback + zoom) instead of the raw phone camera.
  _startSingleScanCapture();
}

// 2026-08-20: Deep Grade "Grading Upside" panel renderer.
// Takes the raw PriceCharting /api/pricecharting response and paints a compact
// price ladder: Raw → PSA 8 → PSA 9 → PSA 10 with $ delta and net-after-fees
// upside. The row matching the AI's estimated PSA grade is highlighted gold.
//
// pc is the raw response body — shape is { source, prices: { raw, grade_7,
// grade_8, grade_9, grade_95, psa_10, ... }, productName, consoleName, url,
// confidence, ... }. If pc.source === 'unconfigured' or prices are all null
// we render a compact fallback that pitches the manual price panel instead.
function renderGradingUpside(el, pc, psaEst, psaGradeBucket, cardData) {
  if (!el) return;

  const GRADING_FEE = 25;   // PSA value tier ~$25 all-in
  const FEES_PCT    = 13;   // eBay + shipping typical

  // Unconfigured / no match / all null — don't waste screen space, fall back.
  const p = pc && pc.prices ? pc.prices : {};
  const hasAny = ['raw','grade_7','grade_8','grade_9','grade_95','psa_10'].some(k => p[k] != null && p[k] > 0);
  if (!pc || pc.source === 'unconfigured' || !hasAny) {
    el.innerHTML =
      `<div style="font-size:.62rem;font-weight:800;letter-spacing:.06em;color:rgba(255,255,255,.55);margin-bottom:.35rem">💰 GRADING UPSIDE</div>` +
      `<div style="font-size:.72rem;color:rgba(255,255,255,.55);line-height:1.5">` +
        `We couldn't find comps for this exact printing on PriceCharting. ` +
        `Tap <strong style="color:rgba(255,255,255,.8)">View PSA ${psaGradeBucket} price</strong> below to check TCGplayer, eBay sold, and other sources.` +
      `</div>`;
    return;
  }

  const raw = p.raw || 0;

  // 2026-08-29: Grade ladder is now HORIZONTAL — grades across the top as
  // scrollable columns instead of a stack of vertical rows. Same 6 buckets
  // PriceCharting actually publishes (raw + 7 + 8 + 9 + 9.5 + 10 — there is
  // no data for grades 1-6, they don't publish those). Tapping a column
  // switches the pricing UI to that grader/grade combo.
  const grades = [
    { key: 'raw',      label: 'Raw',    sub: 'Ungraded',    price: raw,             isGrade: 0,   syncKey: 'raw'  },
    // Subtitles say which GRADER the number covers, and PriceCharting only
    // breaks out a grader at the 10. Below that the columns are "graded N by a
    // grading company", so stamping PSA on them claimed a precision the feed
    // does not have. syncKey still picks a concrete grader for the UI to
    // switch to -- that is a selection default, not a claim about the price.
    { key: 'grade_7',  label: '7',      sub: 'Any grader',  price: p.grade_7  || 0, isGrade: 7,   syncKey: 'psa:7'  },
    { key: 'grade_8',  label: '8',      sub: 'Any grader',  price: p.grade_8  || 0, isGrade: 8,   syncKey: 'psa:8'  },
    { key: 'grade_9',  label: '9',      sub: 'Any grader',  price: p.grade_9  || 0, isGrade: 9,   syncKey: 'psa:9'  },
    { key: 'grade_95', label: '9.5',    sub: 'BGS/CGC',     price: p.grade_95 || 0, isGrade: 9.5, syncKey: 'bgs:9.5' },
    { key: 'psa_10',   label: '10',     sub: 'PSA 10',      price: p.psa_10   || 0, isGrade: 10,  syncKey: 'psa:10' },
  ];

  // Compute per-column net upside vs raw sell:
  //   raw_net    = raw * (1 - fees)
  //   graded_net = graded * (1 - fees)
  //   upside     = graded_net - raw_net - grading_fee
  const rawNet = raw > 0 ? raw * (1 - FEES_PCT/100) : 0;
  grades.forEach(g => {
    if (g.isGrade === 0 || g.price <= 0) {
      g.upsideNet = 0;
      g.upsidePct = 0;
      return;
    }
    const gradedNet = g.price * (1 - FEES_PCT/100);
    g.upsideNet = gradedNet - rawNet - GRADING_FEE;
    g.upsidePct = raw > 0 ? (g.upsideNet / raw) * 100 : 0;
  });

  const fmt$ = n => (n == null || !isFinite(n)) ? '—' : (n < 0 ? '−$' + Math.abs(n).toFixed(0) : '$' + n.toFixed(0));
  const fmtPct = n => (n == null || !isFinite(n)) ? '' : (n >= 0 ? '+' + Math.round(n) + '%' : Math.round(n) + '%');

  const colHtml = grades.map(g => {
    const isEst = g.isGrade === psaGradeBucket && g.isGrade !== 0;
    const isRaw = g.isGrade === 0;
    const priceStr = g.price > 0 ? '$' + g.price.toFixed(g.price < 20 ? 2 : 0) : '—';
    let upsideStr = '';
    let upsideCol = 'rgba(255,255,255,.5)';
    if (isRaw) {
      upsideStr = '<span style="color:rgba(255,255,255,.35);font-size:.55rem;letter-spacing:.04em">baseline</span>';
    } else if (g.price <= 0 || raw <= 0) {
      upsideStr = '<span style="color:rgba(255,255,255,.3);font-size:.55rem">no comp</span>';
    } else if (g.upsideNet > 5) {
      upsideCol = '#4ade80';
      upsideStr = `<div style="color:${upsideCol};font-weight:700;font-size:.7rem">${fmt$(g.upsideNet)}</div><div style="color:${upsideCol};opacity:.7;font-size:.55rem;letter-spacing:.03em">${fmtPct(g.upsidePct)}</div>`;
    } else if (g.upsideNet > -5) {
      upsideCol = '#facc15';
      upsideStr = `<div style="color:${upsideCol};font-weight:700;font-size:.7rem">${fmt$(g.upsideNet)}</div><div style="color:${upsideCol};opacity:.7;font-size:.55rem;letter-spacing:.03em">${fmtPct(g.upsidePct)}</div>`;
    } else {
      upsideCol = '#f87171';
      upsideStr = `<div style="color:${upsideCol};font-weight:700;font-size:.7rem">${fmt$(g.upsideNet)}</div><div style="color:${upsideCol};opacity:.7;font-size:.55rem;letter-spacing:.03em">${fmtPct(g.upsidePct)}</div>`;
    }

    const bg      = isEst ? 'rgba(212,175,55,.14)' : (isRaw ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.02)');
    const border  = isEst ? '1.5px solid rgba(212,175,55,.55)' : '1px solid rgba(255,255,255,.06)';
    const labelC  = isEst ? 'var(--gold)' : (g.price > 0 ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.45)');
    const priceC  = isEst ? 'var(--gold)' : (g.price > 0 ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.35)');
    const badge   = isEst ? `<div style="position:absolute;top:-8px;left:50%;transform:translateX(-50%);font-size:.5rem;font-weight:800;color:#000;background:var(--gold);letter-spacing:.06em;padding:.12rem .3rem;border-radius:4px;white-space:nowrap">AI EST</div>` : '';
    // Encode syncKey for onclick without breaking quoting.
    const sk = g.syncKey.replace(/'/g, "\\'");
    // Only make tappable columns look interactive when they have real data.
    const clickable = (g.price > 0 || isRaw) ? `onclick="applyGradeFromLadder('${sk}')" style="cursor:pointer;"` : 'style="cursor:default;opacity:.55"';

    return (
      `<div ${clickable}` +
         ` data-syncgrade="${g.syncKey}"` +
         ` style="position:relative;min-width:74px;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:.3rem;padding:.65rem .3rem .55rem;background:${bg};border:${border};border-radius:10px;transition:transform .12s ease,background .15s ease">` +
        badge +
        `<div style="font-size:.95rem;font-weight:900;color:${labelC};line-height:1">${g.label}</div>` +
        `<div style="font-size:.5rem;font-weight:700;color:${labelC};opacity:.65;letter-spacing:.06em;text-transform:uppercase">${g.sub}</div>` +
        `<div style="width:100%;height:1px;background:rgba(255,255,255,.08);margin:.15rem 0"></div>` +
        `<div style="font-size:.78rem;font-weight:800;color:${priceC};line-height:1;margin-top:.05rem">${priceStr}</div>` +
        `<div style="text-align:center;line-height:1.15;margin-top:.15rem;min-height:1.6em">${upsideStr}</div>` +
      `</div>`
    );
  }).join('');

  // Pick the best PSA tier for the "headline" pitch — highest upside > 0
  const bestTier = grades.filter(g => g.isGrade > 0 && g.upsideNet > 5).sort((a,b) => b.upsideNet - a.upsideNet)[0];
  const headline = bestTier
    ? `📈 Best case: <strong style="color:#4ade80">${bestTier.sub} → ${fmt$(bestTier.upsideNet)} net upside</strong> vs raw sell`
    : (raw > 0
        ? `⚠️ Grading may not pencil out at current comps (raw $${raw.toFixed(0)}). Numbers assume $${GRADING_FEE} PSA fee + ${FEES_PCT}% sale fees.`
        : `Missing raw comp — upside ‘$’ assumes raw = PriceCharting median.`);

  const pcUrl = pc.url ? pc.url : '';
  const pcLink = pcUrl
    ? `<a href="${pcUrl}" target="_blank" rel="noopener" style="font-size:.7rem;color:#93c5fd;text-decoration:none;font-weight:700">See full price history on PriceCharting →</a>`
    : '';

  el.innerHTML =
    `<div style="font-size:.62rem;font-weight:800;letter-spacing:.06em;color:rgba(255,255,255,.55);margin-bottom:.5rem;display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap">` +
      `<span>💰 GRADING UPSIDE — tap a grade</span>` +
      `<span style="color:rgba(255,255,255,.35);font-weight:600;letter-spacing:.02em;text-transform:none;font-size:.55rem">net after $${GRADING_FEE} fee + ${FEES_PCT}% sale fees</span>` +
    `</div>` +
    // Horizontal scrollable grade columns
    `<div style="display:flex;flex-direction:row;gap:.4rem;overflow-x:auto;-webkit-overflow-scrolling:touch;padding:.5rem .1rem .4rem;margin:0 -.15rem;scrollbar-width:thin">` +
      colHtml +
    `</div>` +
    `<div style="font-size:.7rem;color:rgba(255,255,255,.75);margin-top:.35rem;line-height:1.45">${headline}</div>` +
    (pcLink ? `<div style="margin-top:.3rem">${pcLink}</div>` : '');

  // Stash prices + card metadata so applyGradeFromLadder can update the
  // pricing UI without re-fetching. Written every render so a re-scan
  // clobbers stale data.
  window._lastGradeLadder = { grades: grades, cardData: cardData || null };
}

// Called when the user taps a grade column in the upside ladder.
// syncKey format: 'raw' | '<grader>:<grade>' e.g. 'psa:10', 'bgs:9.5'.
// Applies the tap by activating the matching grader pill + grade select,
// then triggers the same sync path a manual dropdown change would.
function applyGradeFromLadder(syncKey) {
  try {
    if (!syncKey) return;
    // Raw / Ungraded — flip the first pill
    if (syncKey === 'raw') {
      const rawPill = document.querySelector('#gradedPills .pill[data-val="no"]');
      if (!rawPill) return;
      if (typeof setPill === 'function') setPill(rawPill, 'gradedPills');
      if (typeof toggleGrade === 'function') toggleGrade();
      if (typeof calc === 'function') calc();
    } else {
      const [grader, grade] = syncKey.split(':');
      const pill = document.querySelector(`#gradedPills .pill[data-val="${grader}"]`);
      const gradeSel = document.getElementById('gradeSelect');
      if (!pill || !gradeSel) return;
      if (typeof setPill === 'function') setPill(pill, 'gradedPills');
      if (typeof toggleGrade === 'function') toggleGrade();
      gradeSel.value = grade;
      if (typeof updateGradeLabel === 'function') updateGradeLabel();
      if (typeof syncGradeToPrintSelect === 'function') syncGradeToPrintSelect();
      if (typeof calc === 'function') calc();
    }
    // Visual feedback — highlight the tapped column briefly
    document.querySelectorAll('[data-syncgrade]').forEach(node => {
      node.style.transform = node.dataset.syncgrade === syncKey ? 'scale(1.04)' : 'scale(1)';
    });
    setTimeout(() => {
      document.querySelectorAll('[data-syncgrade]').forEach(n => { n.style.transform = 'scale(1)'; });
    }, 180);
  } catch(e) {
    console.warn('[grade-ladder] apply failed', e);
  }
}

// 2026-08-20: Historically we tried to re-identify via /api/scan on the
// stashed front photo, but the grade endpoint now returns the identify
// context directly — no re-scan needed. Keeping this helper as a
// last-resort escape hatch in case _deepGradeIdent is ever missing.
async function _reidentifyAndLoadGraded(frontBase64, psaGrade) {
  const idToken = window._googleIdToken || '';
  const statusHost = document.getElementById('cardPriceStatus') || document.getElementById('lookupView');
  // Visible progress — avoids the "tapped View Card but nothing happened" gap
  try {
    const el = document.getElementById('cardPrimary') || document.getElementById('cardPricePanel');
    if (el) {
      const busy = document.createElement('div');
      busy.id = '_reidBusy';
      busy.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);z-index:20;border-radius:14px;font-weight:800;font-size:.85rem;color:var(--gold-text)';
      busy.innerHTML = '<span class="spinner" style="width:14px;height:14px;border:2px solid rgba(255,255,255,.15);border-top-color:var(--gold);border-radius:50%;animation:spin .8s linear infinite;margin-right:.5rem"></span>Loading card\u2026';
      const host = el;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      const prev = document.getElementById('_reidBusy'); if (prev) prev.remove();
      host.appendChild(busy);
    }
  } catch(_){}

  const cleanup = () => {
    try { const b = document.getElementById('_reidBusy'); if (b) b.remove(); } catch(_){}
  };

  try {
    const response = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
      body: JSON.stringify({
        imageBase64: frontBase64,
        mimeType: 'image/jpeg',
        mode: 'identify',
        email: window.googleUser?.email || window._userEmail || '',
        googleSub: window.googleUser?.sub || window._googleSub || '',
        // Free re-ID after a paid grade — the server already debited /api/scan
        // for the Deep Grade; charging again for the same photo would be silly.
        skipDebit: true,
      })
    });
    if (!response.ok) throw new Error('/api/scan status ' + response.status);
    const data = await response.json();
    console.log('[_reidentifyAndLoadGraded] Ximilar returned', data);

    const cardName    = data.card_name || data.name || '';
    const setName     = data.set_name || data.setName || '';
    const cardNumber  = data.card_number || data.number || '';
    const setCode     = data.set_code || '';
    const groundedId  = data.grounded_id || '';
    const rarity      = data.rarity || '';
    const cardType    = data.card_type || 'pokemon';
    const isJapanese  = data.is_japanese === true;

    if (!cardName) throw new Error('Ximilar returned no card name');

    // Refresh identify context so downstream Deep Grade share, etc. still work.
    const pending = {
      name: cardName, number: cardNumber, setName, setCode, groundedId,
      rarity, cardType, isJapanese,
      sport: data.sport || '', year: data.year || '',
    };
    try { window._pendingIdScanCard = pending; window._lastIdentifiedCard = pending; } catch(_){}

    // Switch to lookup view + populate search box so the URL looks right.
    if (typeof switchView === 'function') switchView('lookup');
    try { const si = document.getElementById('searchInput'); if (si) si.value = cardName; } catch(_){}

    // Route to the exact-load pipeline based on card type.
    try { if (typeof resetCardPanel === 'function') resetCardPanel(); } catch(_){}
    try { selectedCard = null; } catch(_){}

    if (cardType === 'sports') {
      await _routeScannedSportsCard(pending);
    } else if (isJapanese === true) {
      try { await _loadScannedJPCard(pending); }
      catch(e) { await _loadScannedCardExact(pending); }
    } else if (cardType && cardType !== 'pokemon') {
      try { await _loadScannedNonPokemonCard(pending); }
      catch(e) { await _loadScannedCardExact(pending); }
    } else {
      await _loadScannedCardExact(pending);
    }

    cleanup();

    // 2026-08-22 [F7]: clear _pendingIdScanCard after grade-view direct routing
    // so a later cancelScan() doesn't treat this graded snapshot as an active
    // pending scan and reroute back to it. _lastIdentifiedCard remains set for
    // Deep Grade share/re-ID.
    try { window._pendingIdScanCard = null; } catch(_){}

    // Apply the PSA grade pill after the card panel is populated.
    const psaGradeNum = Number(psaGrade) || 0;
    if (psaGradeNum) {
      setTimeout(() => {
        try {
          const gradedToggle = document.getElementById('gradedToggle');
          if (gradedToggle && !gradedToggle.classList.contains('active')) gradedToggle.click();
          const psaPill = document.querySelector('#gradedPills .pill[data-val="psa"]');
          if (psaPill && typeof setPill === 'function') {
            setPill(psaPill, 'gradedPills');
            if (typeof toggleGrade === 'function') toggleGrade();
          }
          setTimeout(() => {
            const gs = document.getElementById('gradeSelect');
            if (gs) {
              gs.value = String(psaGradeNum);
              gs.dispatchEvent(new Event('change'));
              if (typeof calc === 'function') calc();
            }
            const rEl = document.getElementById('sellSection') || document.getElementById('platformCards');
            if (rEl) rEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 300);
        } catch(e) { console.warn('[_reidentifyAndLoadGraded] applyGrade failed', e); }
      }, 700);
    }
  } catch(e) {
    cleanup();
    console.warn('[_reidentifyAndLoadGraded] failed:', e);
    throw e;
  }
}

function viewGradedCard(cardName, psaGrade, cardType, isJapanese) {
  // Close the scan overlay and any CTAs
  const ov = document.getElementById('scanOverlay');
  if (ov) ov.style.display = 'none';
  const gradeCTA = document.getElementById('scanGradeCTA');
  if (gradeCTA) gradeCTA.classList.remove('show');
  const gradingBanner = document.getElementById('gradingCtaBanner');
  if (gradingBanner) gradingBanner.classList.remove('show');

  // Switch to Card Lookup tab so search is visible
  if (typeof switchView === 'function') switchView('lookup');

  const cleanName = (cardName || '').trim();
  if (!cleanName) return;

  try { console.log('[viewGradedCard] START', { cleanName, psaGrade, cardType, isJapanese, _pending: window._pendingIdScanCard, _lastIdent: window._lastIdentifiedCard }); } catch(_){}

  // 2026-08-20 FIX (v4): The grade endpoint now returns the full identify
  // context (card_number, set_name, set_code, grounded_id, rarity,
  // card_type, is_japanese) that Ximilar already resolved server-side.
  // We stash it as window._deepGradeIdent when Deep Grade completes. Use
  // it here to route straight through the exact-load pipeline — no
  // re-scan, no credit spend, no fuzzy pokemontcg.io lookup.
  const dg = window._deepGradeIdent;
  if (dg && dg.name) {
    try { console.log('[viewGradedCard] using _deepGradeIdent for exact load', dg); } catch(_){}
    const pending = {
      name:       dg.name       || cleanName,
      number:     dg.number     || '',
      setName:    dg.setName    || '',
      setCode:    dg.setCode    || '',
      groundedId: dg.groundedId || '',
      rarity:     dg.rarity     || '',
      cardType:   dg.cardType   || cardType || 'pokemon',
      isJapanese: (dg.isJapanese === true) || (isJapanese === true),
      imageUrl:   dg.imageUrl   || '',
      sport:      '',
      year:       '',
    };
    // Refresh ambient identify state so downstream flows (share, grade
    // history, etc.) still see the right card.
    try { window._pendingIdScanCard = pending; window._lastIdentifiedCard = pending; } catch(_){}

    // 2026-08-20 fix: switch the game selector to the RIGHT game FIRST.
    // Otherwise doSearch inside _loadScannedNonPokemonCard runs against
    // Pokemon TCG and returns "No Pokemon cards found", which clobbers
    // the panel to the empty state.
    try {
      const typeToGame = {
        pokemon:  pending.isJapanese ? 'pokemonjp' : 'pokemon',
        yugioh:   'yugioh',
        mtg:      'mtg',
        magic:    'mtg',
        lorcana:  'lorcana',
        onepiece: 'onepiece',
        sports:   'sports',
        other:    'other',
      };
      const targetGame = typeToGame[(pending.cardType || 'pokemon').toLowerCase()] || 'pokemon';
      const gSel = document.getElementById('gameSelect');
      if (gSel && gSel.value !== targetGame) {
        gSel.value = targetGame;
        if (typeof onGameSelectChange === 'function') {
          try { onGameSelectChange(targetGame); } catch(_){}
        }
      }
    } catch(_){}

    // Route to exact-load pipeline, then apply the PSA grade pill.
    try { if (typeof resetCardPanel === 'function') resetCardPanel(); } catch(_){}
    try { selectedCard = null; } catch(_){}
    try {
      const si = document.getElementById('searchInput'); if (si) si.value = pending.name;
    } catch(_){}

    try {
      if (pending.cardType === 'sports') {
        _routeScannedSportsCard(pending);
      } else if (pending.isJapanese === true) {
        try { _loadScannedJPCard(pending); }
        catch(e) { _loadScannedCardExact(pending); }
      } else if (pending.cardType && pending.cardType !== 'pokemon') {
        try { _loadScannedNonPokemonCard(pending); }
        catch(e) { _loadScannedCardExact(pending); }
      } else {
        _loadScannedCardExact(pending);
      }

      // Apply the PSA grade pill after routing.
      const psaN = Number(psaGrade) || 0;
      if (psaN) {
        setTimeout(() => {
          try {
            const gt = document.getElementById('gradedToggle');
            if (gt && !gt.classList.contains('active')) gt.click();
            const psaPill = document.querySelector('#gradedPills .pill[data-val="psa"]');
            if (psaPill && typeof setPill === 'function') {
              setPill(psaPill, 'gradedPills');
              if (typeof toggleGrade === 'function') toggleGrade();
            }
            setTimeout(() => {
              const gs = document.getElementById('gradeSelect');
              if (gs) { gs.value = String(psaN); gs.dispatchEvent(new Event('change')); if (typeof calc === 'function') calc(); }
              const rEl = document.getElementById('sellSection') || document.getElementById('platformCards');
              if (rEl) rEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 300);
          } catch(e) { console.warn('[viewGradedCard] applyGrade failed', e); }
        }, 1200);
      }
      // 2026-08-22 [F7]: clear pending after direct grade routing so a later
      // cancelScan() doesn't reroute back to this graded snapshot.
      try { setTimeout(() => { window._pendingIdScanCard = null; }, 1300); } catch(_){}
      // 2026-08-25 [S] Consume _deepGradeIdent so a subsequent scan doesn't
      // reuse a stale snapshot. Previously this global was set but never
      // cleared — View Card on the next graded card could route to the
      // previous card's exact-load pipeline.
      try { setTimeout(() => { window._deepGradeIdent = null; }, 1300); } catch(_){}
      return;
    } catch(e) {
      console.warn('[viewGradedCard] _deepGradeIdent exact-load failed, falling through:', e);
      // Even on failure, drop the snapshot so we don't loop on the same
      // broken card.
      try { window._deepGradeIdent = null; } catch(_){}
    }
  }

  // 2026-08-20 FIX: The old path here just typed the card name into the
  // search box and hoped the first dropdown match was the correct printing.
  // That routinely landed users on the WRONG card — e.g. "Charizard" grade
  // routed to a random Charizard SKU with no set/number match. Ximilar
  // already gave us set + number + grounded_id at ID time and stashed them
  // in window._pendingIdScanCard; we should reuse the same _loadScanned*
  // pipeline the ID-scan flow uses so the exact printing loads with real
  // comps, then apply the PSA grade on top.
  // Prefer the fresh pending record; fall back to the stable last-identified
  // snapshot so View Card still works after the identify auto-load has
  // already consumed _pendingIdScanCard (2026-08-20 fix).
  const ident = (window._pendingIdScanCard && window._pendingIdScanCard.name)
    ? window._pendingIdScanCard
    : (window._lastIdentifiedCard && window._lastIdentifiedCard.name
        ? window._lastIdentifiedCard
        : null);

  // If we have identify context AND it matches this graded card, use the
  // exact-load routers. Match on name (case-insensitive substring, since
  // Ximilar sometimes returns fuller variants like "Charizard ex").
  const identMatches = ident && (
    (ident.name || '').toLowerCase().includes(cleanName.toLowerCase()) ||
    cleanName.toLowerCase().includes((ident.name || '').toLowerCase())
  );

  try { console.log('[viewGradedCard] ident?', { hasIdent: !!ident, identName: ident?.name, cleanName, identMatches }); } catch(_){}

  const psaGradeNum = Number(psaGrade) || 0;

  // Post-route: apply the PSA grade pill/select once results are loaded.
  const applyGradeAfter = (delay) => {
    if (!psaGradeNum) return; // 0 = "View Card" only, no grade to apply
    setTimeout(() => {
      try {
        const gradedToggle = document.getElementById('gradedToggle');
        if (gradedToggle && !gradedToggle.classList.contains('active')) {
          gradedToggle.click();
        }
        const psaPill = document.querySelector('#gradedPills .pill[data-val="psa"]');
        if (psaPill && typeof setPill === 'function') {
          setPill(psaPill, 'gradedPills');
          if (typeof toggleGrade === 'function') toggleGrade();
        }
        setTimeout(() => {
          const gradeSelect = document.getElementById('gradeSelect');
          if (gradeSelect) {
            gradeSelect.value = String(psaGradeNum);
            gradeSelect.dispatchEvent(new Event('change'));
            if (typeof calc === 'function') calc();
          }
          const resultsEl = document.getElementById('sellSection') || document.getElementById('platformCards');
          if (resultsEl) resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
      } catch(e) { console.warn('[viewGradedCard] applyGrade failed', e); }
    }, delay);
  };

  // FAST PATH: reuse the identify router that already knows how to load the
  // exact card by set + number.
  if (identMatches) {
    try {
      console.log('[viewGradedCard] EXACT-LOAD path entered');
      // The ident routers each null out _pendingIdScanCard on entry, so
      // grab a snapshot before they consume it.
      const pending = {
        name:     ident.name     || cleanName,
        number:   ident.number   || '',
        setName:  ident.setName  || '',
        setCode:  ident.setCode  || '',
        groundedId: ident.groundedId || '',
        rarity:   ident.rarity   || '',
        hp:       ident.hp       || '',
        cardType: ident.cardType || cardType || 'pokemon',
        isJapanese: (ident.isJapanese === true) || (isJapanese === true),
        sport:    ident.sport    || '',
        year:     ident.year     || '',
      };

      try { if (typeof resetCardPanel === 'function') resetCardPanel(); } catch(e) {}
      try { selectedCard = null; } catch(e) {}

      console.log('[viewGradedCard] pending built', pending);
      if (pending.cardType === 'sports') {
        console.log('[viewGradedCard] → sports router');
        _routeScannedSportsCard(pending);
      } else if (pending.isJapanese === true) {
        console.log('[viewGradedCard] → JP router');
        try { _loadScannedJPCard(pending); }
        catch(e) { console.warn('[viewGradedCard] JP threw, exact fallback', e); _loadScannedCardExact(pending); }
      } else if (pending.cardType && pending.cardType !== 'pokemon') {
        console.log('[viewGradedCard] → non-pokemon router', pending.cardType);
        try { _loadScannedNonPokemonCard(pending); }
        catch(e) { console.warn('[viewGradedCard] non-poke threw, exact fallback', e); _loadScannedCardExact(pending); }
      } else {
        console.log('[viewGradedCard] → pokemon exact');
        _loadScannedCardExact(pending);
      }

      applyGradeAfter(1200); // exact-load pipelines take ~1s
      return;
    } catch(e) {
      console.warn('[viewGradedCard] exact router failed SYNCHRONOUSLY, falling back to search', e);
      // Fall through to legacy search path.
    }
  } else {
    console.log('[viewGradedCard] identMatches=false, taking FALLBACK path');
  }

  // FALLBACK PATH: no identify context (rare — shouldn't happen after Deep
  // Grade since Deep Grade requires an identified card), or router blew up.
  // Old behavior: type the name into search and click first dropdown match.
  const typeToGame = {
    pokemon:  isJapanese ? 'pokemonjp' : 'pokemon',
    yugioh:   'yugioh',
    mtg:      'mtg',
    lorcana:  'lorcana',
    onepiece: 'onepiece',
    sports:   'sports',
    other:    'other',
  };
  const targetGame = typeToGame[(cardType || 'pokemon').toLowerCase()] || 'pokemon';
  const gameSel = document.getElementById('gameSelect');
  if (gameSel && gameSel.value !== targetGame) {
    gameSel.value = targetGame;
    if (typeof onGameSelectChange === 'function') {
      try { onGameSelectChange(targetGame); } catch(_) {}
    }
  }

  const searchInput = document.getElementById('searchInput');
  if (!searchInput) return;

  // Build a more specific query if we have identify metadata (even if name
  // didn't match exactly — e.g. append the set/number to disambiguate).
  let query = cleanName;
  if (ident && ident.number) query = `${cleanName} ${ident.number}`;

  searchInput.value = query;
  searchInput.dispatchEvent(new Event('input'));
  const searchBtn = document.getElementById('searchBtn');
  if (searchBtn) { try { searchBtn.click(); } catch(e) {} }

  setTimeout(() => {
    const best = document.querySelector('.drop-item');
    if (best) {
      try { best.click(); } catch(e) {}
      applyGradeAfter(600);
    } else {
      try { searchInput.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch(e) {}
      applyGradeAfter(0);
    }
  }, 800);
}

function openAboutModal() {
  document.getElementById('aboutModal').classList.add('open');
}

// ── Scan overlay button state manager ──
function _setScanBtns(state) {
  // state: 'scanning' | 'success' | 'error'
  const cancelBtn   = document.getElementById('scanCancelBtn');
  const viewBtn     = document.getElementById('scanViewCardBtn');
  const anotherBtn  = document.getElementById('scanAnotherBtn');
  const retryBtn    = document.getElementById('scanRetryBtn');
  const wrongBtn    = document.getElementById('scanWrongCardBtn');
  if (!cancelBtn) return;
  if (state === 'scanning') {
    cancelBtn.style.display  = '';
    viewBtn.style.display    = 'none';
    anotherBtn.style.display = 'none';
    retryBtn.style.display   = 'none';
    if (wrongBtn) wrongBtn.style.display = 'none';
  } else if (state === 'success') {
    cancelBtn.style.display  = 'none';
    viewBtn.style.display    = '';
    anotherBtn.style.display = '';
    retryBtn.style.display   = 'none';
    // Only show "Wrong card?" when the reranker had ≥2 candidates to choose from
    if (wrongBtn) {
      const cands = window._lastScanCandidates || [];
      wrongBtn.style.display = (cands.length >= 2) ? '' : 'none';
    }
  } else if (state === 'error') {
    cancelBtn.style.display  = 'none';
    viewBtn.style.display    = 'none';
    anotherBtn.style.display = 'none';
    retryBtn.style.display   = '';
    if (wrongBtn) wrongBtn.style.display = 'none';
  }
}

// ========================================================================
// "Wrong card?" local picker — 2026-08-17
// ------------------------------------------------------------------------
// Zero-cost correction path. Reuses window._lastScanCandidates (populated
// by the reranker) so the user can pick the correct printing from the
// in-browser 20k-card index without re-running Ximilar. No API calls, no
// credit spend. Only shows when the reranker had ≥2 candidates matching
// name+number.
// ========================================================================
function openWrongCardPicker() {
  _clearScanAutoAdvance();
  const cands = window._lastScanCandidates || [];
  if (cands.length < 2) {
    showToast('No other matches for this card + number', 'gold');
    return;
  }
  // Build overlay if missing
  let ov = document.getElementById('wrongCardOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'wrongCardOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:10002;display:flex;flex-direction:column;padding:1.25rem;overflow-y:auto;';
    document.body.appendChild(ov);
  }
  const currentId = window._pendingIdScanCard?.groundedId || '';
  const rows = cands.map((c, i) => {
    const isCurrent = c.id === currentId;
    return '<div onclick="pickCorrectCard(' + i + ')" style="display:flex;gap:.75rem;padding:.7rem;background:' + (isCurrent ? 'rgba(255,215,0,.12)' : 'rgba(255,255,255,.05)') + ';border:1px solid ' + (isCurrent ? 'var(--gold)' : 'rgba(255,255,255,.1)') + ';border-radius:12px;cursor:pointer;align-items:center;">' +
      '<img src="' + esc(c.i || '') + '" style="width:64px;height:88px;object-fit:cover;border-radius:6px;background:#222" onerror="this.style.opacity=0" />' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:800;color:#fff;font-size:.95rem">' + esc(c.n || '') + '</div>' +
        '<div style="font-size:.78rem;color:rgba(255,255,255,.7);margin-top:.15rem">' + esc(c.s || '') + ' · #' + esc(String(c.nu || '')) + (c.r ? ' · ' + esc(c.r) : '') + '</div>' +
        (isCurrent ? '<div style="font-size:.7rem;color:var(--gold-text);margin-top:.2rem;font-weight:700">✓ Currently selected</div>' : '') +
      '</div>' +
      '<div style="color:rgba(255,255,255,.4);font-size:1.1rem">›</div>' +
    '</div>';
  }).join('');
  ov.innerHTML =
    '<div style="max-width:480px;margin:0 auto;width:100%">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.9rem">' +
        '<div>' +
          '<div style="font-size:1.15rem;font-weight:900;color:#fff">Pick the right card</div>' +
          '<div style="font-size:.75rem;color:rgba(255,255,255,.6);margin-top:.2rem">' + cands.length + ' printing' + (cands.length===1?'':'s') + ' found · free to switch, no scan credit used</div>' +
        '</div>' +
        '<button onclick="closeWrongCardPicker()" style="background:rgba(255,255,255,.1);border:none;color:#fff;width:36px;height:36px;border-radius:50%;font-size:1.1rem;cursor:pointer">×</button>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:.6rem">' + rows + '</div>' +
      '<div style="margin-top:1rem;font-size:.72rem;color:rgba(255,255,255,.4);text-align:center">Tap a card to correct the ID — doesn\'t re-scan or charge credits.</div>' +
    '</div>';
  ov.style.display = 'flex';
}

function closeWrongCardPicker() {
  const ov = document.getElementById('wrongCardOverlay');
  if (ov) ov.style.display = 'none';
}

function pickCorrectCard(idx) {
  const cands = window._lastScanCandidates || [];
  const c = cands[idx];
  if (!c) return;
  // Update the pending ID so "View Card Prices →" opens the right one
  if (!window._pendingIdScanCard) window._pendingIdScanCard = {};
  window._pendingIdScanCard.name       = c.n || window._pendingIdScanCard.name;
  window._pendingIdScanCard.number     = c.nu || window._pendingIdScanCard.number;
  window._pendingIdScanCard.setName    = c.s || window._pendingIdScanCard.setName;
  window._pendingIdScanCard.setCode    = c.sc || '';
  window._pendingIdScanCard.groundedId = c.id || '';
  window._pendingIdScanCard.rarity     = c.r || window._pendingIdScanCard.rarity;
  // Update the on-screen scan result line so the user sees the correction reflected
  const statusEl = document.getElementById('scanStatus');
  if (statusEl) {
    const detail = [c.s || '', c.r || ''].filter(Boolean).join(' · ');
    statusEl.innerHTML = '<span style="color:#4ade80">✓ ' + esc(c.n || '') + (c.nu ? ' #' + esc(String(c.nu)) : '') + '</span><br><span style="font-size:.8rem;opacity:.7">' + esc(detail) + '</span>';
  }
  // Swap the preview thumb so the user sees the corrected card art
  const prev = document.getElementById('scanPreviewImg');
  if (prev && c.i) { try { prev.src = c.i; } catch(_) {} }
  // Log for training signal analysis
  try {
    console.log('[wrongcard] user corrected pick:', c.id, c.n, c.s);
    fetch('/api/log-correction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chosen: c.id,
        chosenSet: c.s,
        candidates: cands.map(x => ({ id: x.id, set: x.s })),
      })
    }).catch(() => {});
  } catch(_) {}
  closeWrongCardPicker();
  showToast('Fixed — view card to see the correct pricing', 'gold');
}

// Retry — re-trigger camera without closing overlay
function retryIdScan() {
  _clearScanAutoAdvance();
  const statusEl = document.getElementById('scanStatus');
  const resultEl = document.getElementById('scanResult');
  if (statusEl) statusEl.textContent = 'Identifying card…';
  if (resultEl) resultEl.textContent = '';
  const gradeCTA = document.getElementById('scanGradeCTA');
  if (gradeCTA) gradeCTA.classList.remove('show');
  const badge = document.getElementById('scanSuccessBadge');
  if (badge) badge.style.display = 'none';
  _setScanBtns('scanning');
  // Re-trigger file input
  const fi = document.getElementById('scanFileInput');
  if (fi) {
    fi.value = '';
    const clone = fi.cloneNode(true);
    fi.parentNode.replaceChild(clone, fi);
    clone.addEventListener('change', function() { processScanImage(this); });
    clone.click();
  }
}

// User taps "Not my card — refund credit" on the scan result. Send scan_id to
// /api/scan-refund; if OK, restore the credit locally + close the overlay so
// they can rescan right away. Never blocks the UI — button just disables while
// in flight and re-enables on failure so they can retry.
async function _requestScanRefund(btn) {
  if (!btn || btn.disabled) return;
  const scanId = btn.dataset.scanId;
  if (!scanId) { showToast('Refund unavailable for this scan.'); return; }
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Refunding\u2026';
  btn.style.opacity = '0.6';
  try {
    let token = window._googleIdToken || '';
    try {
      if (window._fbCurrentUser && typeof window._fbCurrentUser.getIdToken === 'function') {
        token = await window._fbCurrentUser.getIdToken(true);
      }
    } catch(_) {}
    const email = window._userEmail || '';
    const sub   = window._googleSub || '';
    const res = await fetch('/api/scan-refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (token || '') },
      body: JSON.stringify({ scan_id: scanId, reason: 'wrong_card', email, googleSub: sub })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      btn.disabled = false;
      btn.textContent = originalText;
      btn.style.opacity = '';
      showToast(data.error || 'Refund failed \u2014 message will@cardresell.org.');
      return;
    }
    // Success — update local ID scan credit balance so the counter reflects it.
    if (typeof window._idScanCredits === 'number') {
      window._idScanCredits += (data.credits_refunded || 1);
      try { if (typeof updateScanBtnCredits === 'function') updateScanBtnCredits(); } catch(_) {}
    }
    btn.textContent = '\u2713 Credit refunded';
    btn.style.color = '#4ade80';
    btn.style.borderColor = 'rgba(74,222,128,.4)';
    btn.style.opacity = '';
    // Clear pending card so cancelScan doesn't navigate to a wrong-card page
    window._pendingIdScanCard = null;
    window._pendingScanBannerCard = null;
    showToast('Credit refunded. Try a clearer photo or a different angle.', 'gold');
    setTimeout(() => { try { cancelScan(); } catch(_) {} }, 900);
  } catch(err) {
    console.error('refund err', err);
    btn.disabled = false;
    btn.textContent = originalText;
    btn.style.opacity = '';
    showToast('Refund failed \u2014 check your connection and try again.');
  }
}

// Scan another — close result, immediately open camera again
function scanAnother() {
  // Clear pending card so cancelScan doesn't navigate away
  window._pendingIdScanCard = null;
  cancelScan();
  // Brief delay then reopen
  setTimeout(() => openGradedScanGate(), 150);
}

// 2026-08-21: Auto-advance timer. After a confident single-scan ID, we wait
// ~1s so the user reads the green checkmark, then call cancelScan() which
// (via its _pendingIdScanCard branch) routes to the card view with prices.
// Cancelled the moment the user manually taps View Card / Scan Another /
// Wrong Card so we never double-navigate.
window._scanAutoAdvanceTimer = null;
function _scheduleScanAutoAdvance(delayMs) {
  const d = typeof delayMs === 'number' ? delayMs : 900;
  _clearScanAutoAdvance();
  window._scanAutoAdvanceTimer = setTimeout(() => {
    window._scanAutoAdvanceTimer = null;
    // Only fire if the overlay is still open on a success state (user
    // hasn't already navigated or dismissed).
    const overlay = document.getElementById('scanOverlay');
    if (!overlay || overlay.style.display === 'none') return;
    const viewBtn = document.getElementById('scanViewCardBtn');
    if (viewBtn && viewBtn.style.display !== 'none') {
      cancelScan();
    }
  }, d);
}
function _clearScanAutoAdvance() {
  if (window._scanAutoAdvanceTimer) {
    clearTimeout(window._scanAutoAdvanceTimer);
    window._scanAutoAdvanceTimer = null;
  }
}

function cancelScan() {
  _clearScanAutoAdvance();
  document.getElementById('scanOverlay').style.display = 'none';
  _dialogClosed('scanOverlay');
  const spinner5 = document.getElementById('scanSpinner');
  if (spinner5) spinner5.style.display = 'none';
  _setScanBtns('scanning');
  const gradeCTA = document.getElementById('scanGradeCTA');
  if (gradeCTA) gradeCTA.classList.remove('show');
  // Clear grade front state
  window._gradeFrontBase64 = null;
  if (window._gradeFrontUrl) { try { URL.revokeObjectURL(window._gradeFrontUrl); } catch(e) {} window._gradeFrontUrl = null; }
  // Reset scan file input
  const fi = document.getElementById('scanFileInput');
  if (fi) {
    fi.value = '';
    const clone = fi.cloneNode(true);
    fi.parentNode.replaceChild(clone, fi);
    clone.addEventListener('change', function() { processScanImage(this); });
  }
  // Reset grade file inputs
  ['gradeFileInput','gradeBackFileInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; const c = el.cloneNode(true); el.parentNode.replaceChild(c, el); }
  });
  document.getElementById('gradeFileInput')?.addEventListener('change', function() { processGradeImage(this); });
  document.getElementById('gradeBackFileInput')?.addEventListener('change', function() { processGradeBack(this); });

  // If ID scan identified a card, switch to Lookup view and load the exact card
  if (window._pendingIdScanCard) {
    const pending = window._pendingIdScanCard;
    window._pendingIdScanCard = null;
    switchView('lookup'); // make sure we're on the lookup tab

    // 2026-08-15 fix: clear ANY previous card panel state before routing to
    // the new scan, otherwise the previous card's name/price/refund button
    // stays visible under the new one (reproduced in IMG_3716: LeBron scan
    // showed a stale Vileplume \u30e9\u30d5\u30ec\u30b7\u30a2 #045 panel below the sports card).
    try { if (typeof resetCardPanel === 'function') resetCardPanel(); } catch(e) {}
    // Also clear the shared card selection so any downstream reads (like the
    // add-to-collection button) don't grab the previous card.
    try { selectedCard = null; } catch(e) {}

    // Sports card path: switch to the Sports Cards tab, fill sp_* fields,
    // and auto-run doSportsSearchLive so the user lands on comp buttons.
    // Japanese scan path: PokemonTCG.io doesn't index most JP-only sets,
    // so route directly to the pokemonjp comps card (eBay JP sold + PC).
    // Non-sports non-JP falls through to PokemonTCG.io / TCGplayer exact-load.
    if (pending.cardType === 'sports') {
      try {
        _routeScannedSportsCard(pending);
      } catch(e) { console.warn('sports auto-fill failed', e); }
    } else if (pending.isJapanese === true) {
      try {
        _loadScannedJPCard(pending);
      } catch(e) { console.warn('JP auto-load failed', e); _loadScannedCardExact(pending); }
    } else if (pending.cardType && pending.cardType !== 'pokemon') {
      // 2026-08-18: Cross-TCG scan — non-Pokémon (Lorcana/MTG/YGO/OnePiece).
      // _loadScannedCardExact hard-codes pokemontcg.io + pokemon TPL slug,
      // so we can't route through it. maybeAutoSwitchGameFromScan already
      // flipped activeGame in the scan flow; here we populate the search
      // input with the scanned name+number and fire the game's own search
      // pipeline so the user lands on the right card with real prices.
      try {
        _loadScannedNonPokemonCard(pending);
      } catch(e) { console.warn('non-pokemon auto-load failed', e); _loadScannedCardExact(pending); }
    } else {
      _loadScannedCardExact(pending);
    }
  }
}

// After an ID scan detects a sports card, populate the Sports Cards form fields
// (player / year / brand / #) and auto-fire the search dropdown so the user gets
// eBay-sold + PriceCharting + 130point + PWCC comp buttons ready to click.
function _routeScannedSportsCard(pending) {
  const { name, number, setName, rarity, sport, year } = pending;

  // Switch the game selector to sports so the sports form UI is visible.
  try {
    const gs = document.getElementById('gameSelect');
    if (gs && gs.value !== 'sports') gs.value = 'sports';
    if (typeof onGameSelectChange === 'function') onGameSelectChange('sports');
  } catch(e) {}

  // Best-effort parse: if year wasn't returned, try to pull YYYY from set_name.
  let parsedYear = (year || '').toString().trim();
  if (!parsedYear && setName) {
    const m = String(setName).match(/(19|20)\d{2}/);
    if (m) parsedYear = m[0];
  }

  // Brand: if scan gave a set_name, use it; strip a leading year to keep just the brand.
  let brand = (setName || '').toString().trim();
  if (parsedYear) brand = brand.replace(new RegExp('^\\s*' + parsedYear + '\\s*'), '');

  // Sport: fall back to Baseball if we couldn't infer.
  const inferredSport = (sport || 'Baseball').toString().trim() || 'Baseball';

  // Fill the form fields.
  const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  setVal('sp_player',  name || '');
  setVal('sp_year',    parsedYear);
  setVal('sp_brand',   brand);
  setVal('sp_cardnum', number || '');

  const spSport = document.getElementById('sp_sport');
  if (spSport && inferredSport) {
    const opt = Array.from(spSport.options).find(o => o.value.toLowerCase() === inferredSport.toLowerCase());
    if (opt) spSport.value = opt.value;
  }

  // Fire the sports search so comp buttons render immediately.
  const cleanName = _stripEmoji(name || '');

  // Remember the scan photo alongside the player it depicts, so the sports card
  // shows the user's own image instead of a grey placeholder. Keyed by player
  // so it is dropped the moment they look up someone else.
  try {
    window._sportsScanImageUrl = window._lastScanImageDataUrl || '';
    window._sportsScanPlayer   = cleanName.trim();
  } catch (_) {}
  if (cleanName && typeof doSportsSearchLive === 'function') {
    // Mirror the player name into the sports search input — emoji-free so it
    // never gets typed into eBay's _nkw.
    const ssi = document.getElementById('sportsSearchInput');
    if (ssi) ssi.value = cleanName;
    setTimeout(() => { try { doSportsSearchLive(cleanName); } catch(e) {} }, 100);
    // 2026-09-03: load the card panel + parallel picker directly.
    // loadSportsCardFromSearch was only ever reached by clicking a comp source
    // in the dropdown, and every one of those handlers ALSO opens an external
    // tab. So a scanned sports card filled the form and then stopped: no card
    // panel, no parallel list, no price unless the seller happened to open eBay
    // first. Now a scan lands on "pick your exact parallel" like a typed lookup
    // does, which is what makes the price reachable at all.
    setTimeout(() => {
      try {
        if (activeGame === 'sports' && typeof loadSportsCardFromSearch === 'function') {
          loadSportsCardFromSearch(cleanName);
          // doSportsSearchLive leaves its comp-source dropdown open, which
          // renders directly over the confirm strip and the parallel picker --
          // the two things the seller now needs to see. Close it; the same
          // comp links stay one click away on the loaded card.
          try { document.getElementById('sportsDropList')?.classList.remove('open'); } catch (_) {}
        }
      } catch (e) { console.warn('[sports scan] panel load failed', e); }
    }, 160);
  }

  showToast('Sports card scanned — pick your exact parallel to price it.', 'gold');
}

// 2026-08-15: route a Japanese scan straight to the pokemonjp comps card
// (English name + "(Japanese)" tag + eBay JP sold + PriceCharting) instead
// of trying PokemonTCG.io, which doesn't index most Japanese-only sets.
// 2026-08-18: Load a scanned Lorcana/MTG/Yu-Gi-Oh!/One Piece card after
// maybeAutoSwitchGameFromScan flipped activeGame to the correct TCG.
// Strategy: populate the search input with the scanned card name, fire
// the game's autocomplete (doSearch dispatches by activeGame), and rely
// on the existing _scanTargetNumber / _scanTargetName auto-select logic
// (renderDrops in index.html ~line 4065) to pick the correct printing
// out of the dropdown so the user lands on a real card with real prices.
function _loadScannedNonPokemonCard(pending) {
  const name   = String(pending.name || '').trim();
  const number = String(pending.number || '').trim();
  if (!name) {
    // No name — fall back to _loadScannedCardExact so the synthetic-card
    // fallback surface still fires.
    _loadScannedCardExact(pending);
    return;
  }

  // 2026-08-19: Kill any stale scanMissPanel from an earlier failed scan.
  // The panel was written by _renderScanMissPanel and only removes itself
  // when the same function runs again — non-Pokemon paths don't hit it,
  // so a pre-fix Pokemon-mis-tagged scan miss panel would persist below
  // the correctly-loaded YGO card. Nuke it here.
  try {
    const stale = document.getElementById('scanMissPanel');
    if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
  } catch(e) {}

  // 2026-08-19: For YGO scans where the server already grounded via
  // YGOProDeck (passcode/set_code/name/fuzzy), the server returned
  // pending.imageUrl. Load the card directly so the detail panel shows
  // the correct image immediately, without waiting for the search-drop
  // auto-select to click a result (which sometimes doesn't fire when
  // scan_target_number is a Konami passcode that doesn't match the
  // set_code in the dropdown items).
  //
  // Also stash the grounded image on a global so the TPL happy-path
  // cardFactory (which normally passes '' as fallbackImage for YGO)
  // can pick it up when TPL returns empty image_url — otherwise the
  // subsequent auto-select click overwrites our grounded card with a
  // TPL card whose images.small is '', and the detail panel drops to
  // "Image unavailable".
  if (pending.cardType === 'yugioh' && pending.imageUrl) {
    window._scanTargetImageUrl = pending.imageUrl;
    // Clear it once the search completes so it doesn't leak into an
    // unrelated manual search later.
    setTimeout(() => { window._scanTargetImageUrl = null; }, 8000);
    const ygoCard = {
      name:    name,
      game:    'yugioh',
      images:  { small: pending.imageUrl, large: pending.imageUrl },
      setName: pending.setName || '',
      number:  pending.setCode || number,
      rarity:  pending.rarity || '',
      priceVariants: [{ key: 'manual', label: 'Manual', market: null, low: null, mid: null, high: null }],
      source:  'YGOProDeck',
      updatedAt: 'Grounded via scan',
    };
    try {
      selectedCard = ygoCard;
      if (typeof loadCardUI === 'function') loadCardUI(ygoCard);
    } catch(e) { console.warn('[_loadScannedNonPokemonCard] loadCardUI failed', e); }
  }

  // Set the auto-select breadcrumbs so renderDrops picks the exact match.
  window._scanTargetNumber = number;
  window._scanTargetName   = name;

  const si = document.getElementById('searchInput');
  if (si) {
    si.value = name;
    si.focus();
  }

  // Fire the game-appropriate search (searchLorcana / searchMTG / etc).
  // The search click will REPLACE the pre-loaded card above with the
  // fully-priced version (real priceVariants from YGOProDeck).
  if (typeof doSearch === 'function') {
    doSearch(name).catch(err => {
      console.warn('[_loadScannedNonPokemonCard] doSearch failed', err);
    });
  }

  // Scroll to the card area so the user sees the dropdown fill in.
  try {
    const heroEl = document.getElementById('cardHero');
    if (heroEl) heroEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch(e) {}
}

function _loadScannedJPCard(pending) {
  const englishBase = String(pending.name || '').replace(/\s*\(Japanese\)\s*$/i, '').trim();
  const displayName = englishBase + ' (Japanese)';
  const cardNumber  = pending.number || '';
  const setName     = pending.setName || 'Japanese Set';
  const rarity      = pending.rarity  || '';

  // 2026-08-22: Kill any stale scanMissPanel from a previous scan of a
  // different card. Without this, the header updates to the new (JP) card
  // but the miss-panel below still shows the previous card's info —
  // exactly what happened with Iduna (Lorcana) → Blaziken (JP) in prod.
  try {
    const stale = document.getElementById('scanMissPanel');
    if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
  } catch(_) {}

  // 2026-08-22: Image hydration. PokemonTCG.io doesn't index JP-only sets,
  // but the raw scan photo the user just took IS the card image. If the
  // scan path stored the photo as a data URL, use it so the detail card
  // shows the card the user is looking at instead of "Image unavailable".
  const scanImg = (typeof window !== 'undefined' && window._lastScanImageDataUrl) || '';

  // Build eBay JP + PriceCharting URLs the same way the JP search dropdown does.
  const numTail = cardNumber ? (' ' + cardNumber) : '';
  const ebayJPUrl = 'https://www.ebay.com/sch/i.html?_nkw='
    + encodeURIComponent(englishBase + numTail + ' japanese pokemon card')
    + '&_sacat=183454&LH_Sold=1&LH_Complete=1';
  const pcUrl = 'https://www.pricecharting.com/search-products?q='
    + encodeURIComponent(englishBase + ' japanese') + '&type=prices';

  const jpCard = {
    name: displayName,
    game: 'pokemonjp',
    images: { small: scanImg, large: scanImg },  // 2026-08-22: use scan photo
    setName: setName,
    number: cardNumber,
    rarity: rarity,
    priceVariants: [
      { key: 'raw_nm', label: 'Raw NM (check eBay JP sold)', market: null, low: null, mid: null, high: null },
      { key: 'psa9',   label: 'PSA 9 (check eBay JP sold)',  market: null, low: null, mid: null, high: null },
      { key: 'psa10',  label: 'PSA 10 (check eBay JP sold)', market: null, low: null, mid: null, high: null },
    ],
    source: 'eBay JP Comps',
    updatedAt: 'See eBay sold listings',
    _jpEbayUrl: ebayJPUrl,
    _jpPCUrl: pcUrl,
  };

  const si = document.getElementById('searchInput');
  if (si) si.value = displayName;

  try { selectedCard = jpCard; loadCardUI(jpCard); } catch(e) { console.warn('JP card load failed', e); }
  // Auto-open eBay JP sold listings so the user immediately sees comps.
  try {
    if (typeof buildEbayUrl === 'function') window.open(buildEbayUrl(ebayJPUrl), '_blank');
    else window.open(ebayJPUrl, '_blank');
  } catch(e) {}
  showToast('Japanese card \u2014 opened eBay JP sold comps.', 'gold');
}

// Fetch the exact scanned card from PokemonTCG.io by name + number and load it
// ── Card-swap loading state (CR-022, 2026-09-02) ──────────────────────────────
// _loadScannedCardExact sets #searchInput.value synchronously but only renders
// the card after an awaited network fetch. Between those two points the panel
// still showed the PREVIOUS card in full -- art, name, set, and market value --
// so tapping a second Bulk ID Scan row read as "the search box says Lacey but
// the app is showing me Single Strike Style Mustard at $1.57". Nothing was
// actually miscomputed; the stale frame just outlived the selection. These two
// helpers retire the outgoing card's visuals the instant a new one is chosen.
// 2026-09-04: every surface DOWNSTREAM of the card that _beginCardSwap was not
// clearing. The original fix retired the art, name, price and miss panel, which
// covered the two loudest lies but not the quiet ones. A real A -> Back -> B
// walk still showed Minun's venue payouts ($38.55 / $38.45) and Minun's Quick
// Pricing band ($38.06 / $44.78 / $51.50) sitting under "Loading Bulbasaur...",
// plus Minun's eBay/TCGplayer "list it" hrefs, which would have listed the
// wrong card. All of these are rendered from selectedCard by calc() /
// renderQuickPricing() and are only ever OVERWRITTEN on a successful render --
// so any path that fails, misses, or is merely slow leaves the previous card's
// numbers on screen attached to the new card's name.
//
// Teardown, not recomputation: we cannot compute B's payouts yet (no price for
// it), and showing nothing is the only honest state between two cards.
function _clearCardDerivedSurfaces() {
  try {
    // Venue payout ranking. Written by calc() at two exit points; neither runs
    // until a price exists for the incoming card.
    const ra = document.getElementById('resultsArea');
    if (ra) ra.innerHTML = '<div class="intro-state" style="padding:1.25rem">'
      + '<div class="intro-p" style="color:var(--text-muted)">Loading payouts\u2026</div></div>';

    // Quick Pricing: hide the whole block rather than blanking its children, so
    // a half-populated band can never flash. renderQuickPricing() re-shows it
    // when the incoming card has a real basis.
    const qp = document.getElementById('quickPricing');
    if (qp) qp.style.display = 'none';
    for (const id of ['qpTiers', 'qpRows', 'qpLadder']) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    }
    const qpNote = document.getElementById('qpGradedNote');
    if (qpNote) { qpNote.textContent = ''; qpNote.style.display = 'none'; }
    // A tier chosen for the outgoing card must not be re-applied to the
    // incoming one -- that is how a Heavy Play price lands on a NM card.
    window._qpChosenTier = null;

    // "List on eBay / TCGplayer" hrefs are built from the outgoing card's name
    // and number. Left in place they are a one-tap path to listing the WRONG
    // card, so neutralise them until the incoming card rebuilds them.
    for (const id of ['ebayListBtn', 'tcgpListBtn']) {
      const a = document.getElementById(id);
      if (a) {
        a.setAttribute('href', '#');
        a.setAttribute('aria-disabled', 'true');
        a.style.pointerEvents = 'none';
        a.style.opacity = '.45';
      }
    }

    // Graded-comps banner and eBay comp status both name the outgoing card.
    const gcb = document.getElementById('gradedCompsBanner');
    if (gcb) gcb.style.display = 'none';
    const ecs = document.getElementById('ebayCompsStatus');
    if (ecs) ecs.style.display = 'none';

    // The override box holds a price the user typed (or a tile wrote) for the
    // OUTGOING card. Carrying it over silently reprices the incoming card:
    // Minun's $38.06 became Bulbasaur's basis on the real swap path.
    const ov = document.getElementById('priceOverride');
    if (ov) ov.value = '';
    window._ovAutoFilled = false;
  } catch (e) { console.warn('[cardSwap] derived-surface clear failed', e); }
}

function _beginCardSwap(name) {
  try {
    window._cardSwapPending = true;
    _clearCardDerivedSurfaces();
    const panel = document.querySelector('.card-panel');
    if (panel) panel.classList.add('card-swapping');
    // Name follows the selection immediately so the header can never disagree
    // with the search box.
    const nameEl = document.getElementById('cardNameEl');
    if (nameEl && name) nameEl.textContent = name;
    const metaEl = document.getElementById('cardMetaEl');
    if (metaEl) metaEl.textContent = '';
    // Drop the outgoing art and price outright -- a wrong picture and a wrong
    // dollar figure are the two things a seller must never be shown.
    //
    // Bumping _imgGen is the load-bearing line. loadCardUI gates its async
    // image callbacks on this generation counter, so the OUTGOING card's
    // still-in-flight onload/onerror/large-upgrade closures all become stale
    // here and stop writing to the DOM. Without the bump, hiding the wrapper
    // does nothing: card A's onload lands ~200-400ms later and re-reveals the
    // old art under the new card's name, which is the glitch itself.
    window._imgGen = (window._imgGen || 0) + 1;
    // 2026-09-04: retire the "MARKET PRICE — RAW" (#scanMissPanel) block too.
    // It was only cleared at the top of a fresh single scan, so tapping card A
    // from a bulk sheet (A misses → panel renders A's price) and then tapping
    // card B (B resolves normally, so no NEW panel is built and the old one is
    // never displaced) left A's panel on screen underneath B's art and name:
    // Minun #194's photo/title above "Bulbasaur (Mega Evolution Stamped) #133
    // — Raw NM $20.28". Showing one card's picture over another card's dollar
    // figure is the worst thing this app can do to a seller, so the panel dies
    // in the same tick as the art and price, on EVERY swap path.
    const _stalePanel = document.getElementById('scanMissPanel');
    if (_stalePanel && _stalePanel.parentNode) _stalePanel.parentNode.removeChild(_stalePanel);
    // Deliberately do NOT blank cardImg.src here: assigning '' resolves to the
    // document URL, so the browser fires a bogus request for index.html as an
    // image and the resulting error state suppressed the incoming card's
    // reveal. Hiding the wrapper is enough, and loadCardUI blanks src itself.
    const wrap = document.getElementById('cardImgWrap');
    if (wrap) wrap.style.display = 'none';
    const sportsPh = document.getElementById('sportsCardPh');
    if (sportsPh) sportsPh.style.display = 'none';
    const ph = document.getElementById('cardImgPh');
    if (ph) ph.style.display = 'flex';
    const phLabel = document.getElementById('cardImgPhLabel');
    if (phLabel) phLabel.textContent = name ? `Loading ${name}\u2026` : 'Loading\u2026';
    const pm = document.getElementById('priceMain');
    if (pm) { pm.textContent = '\u2014'; pm.style.color = 'var(--text-faint)'; }
    const pr = document.getElementById('priceRange');
    if (pr) pr.textContent = '';
  } catch (e) { console.warn('[cardSwap] begin failed', e); }
}
// rendered=true means loadCardUI took over and painted a real card. rendered
// =false is the safety net for every lookup path that exits WITHOUT rendering
// (pokemontcg.io miss, network failure, early return): without this the panel
// would sit dimmed on "Loading Lacey..." forever.
function _endCardSwap(rendered) {
  try {
    const panel = document.querySelector('.card-panel');
    if (panel) panel.classList.remove('card-swapping');
    if (!rendered && window._cardSwapPending) {
      const phLabel = document.getElementById('cardImgPhLabel');
      if (phLabel) phLabel.textContent = 'No card selected';
      // _clearCardDerivedSurfaces() parked the payout ranking on "Loading
      // payouts...". Nothing rendered, so nothing will ever displace it; hand
      // the area back to the intro copy instead of a spinner that never ends.
      try { if (typeof showIntro === 'function') showIntro(); } catch (e) {}
    }
    window._cardSwapPending = false;
  } catch (e) {}
}

// Thin wrapper: the implementation below has ~6 exit points (fast path, TPL
// fallback, synthetic card, miss panel, early returns). Rather than patch each
// one, the finally here guarantees the swap placeholder is always retired.
async function _loadScannedCardExact(pending) {
  try {
    return await _loadScannedCardExactImpl(pending);
  } finally {
    _endCardSwap(false);
  }
}

async function _loadScannedCardExactImpl(pending) {
  const { name, number, setName, rarity, groundedId } = pending;
  const si = document.getElementById('searchInput');
  if (si) si.value = name;
  // Retire the previous card's art/price in the same tick as the search box,
  // so no frame ever pairs a new name with the old card. See _beginCardSwap.
  _beginCardSwap(name);
  // 2026-08-21: track whether the synth-card fallback already rendered a
  // real price so we can skip the miss panel and avoid double-panels.
  let _synthCardLoadedWithPrice = false;

  // 2026-08-16 FAST PATH: if the server-side scan endpoint already resolved
  // this card in pokemontcg.io via set_code + number, hit /v2/cards/<id>
  // directly — no fuzzy matching, no risk of picking the wrong card.
  if (groundedId) {
    try {
      const res = await fetch(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(groundedId)}`);
      if (res.ok) {
        const j = await res.json();
        const c = j.data;
        if (c) {
          const prices = c.tcgplayer?.prices || {};
          const priceKeys = Object.keys(prices);
          const priceVariants = priceKeys.map(key => ({
            key,
            label: (typeof formatVariantName === 'function' ? formatVariantName(key) : key),
            market: prices[key]?.market ?? null,
            low:    prices[key]?.low ?? null,
            mid:    prices[key]?.mid ?? null,
            high:   prices[key]?.high ?? null,
          }));
          const card = {
            name: c.name,
            game: 'pokemon',
            images: { small: c.images?.small || '', large: c.images?.large || '' },
            setName: c.set?.name || '',
            number: c.number || '',
            rarity: c.rarity || '',
            priceVariants,
            source: 'TCGPlayer',
            updatedAt: c.tcgplayer?.updatedAt || '',
            _grounded: true,
          };
          try { selectedCard = card; } catch(_) {}
          if (typeof loadCardUI === 'function') { loadCardUI(card); return; }
        }
      }
    } catch(e) { console.warn('[grounded-id fast path] failed, falling back:', e); }
  }

  try {
    // Strategy: search by name only (wildcard), then filter client-side by number.
    // DO NOT encodeURIComponent the field values — PokemonTCG.io query syntax uses raw text.
    // The whole URL param is encoded once by the URL constructor.
    const cleanName = name.replace(/["\\]/g, ''); // strip quotes/backslashes only
    const cleanNumber = number ? number.replace(/\/.*$/, '').trim() : ''; // strip /setsize e.g. "173/236" → "173"

    // Try multiple query strategies in order, stop at first that returns results.
    // PokemonTCG.io query syntax: field:value — NO encodeURIComponent on the value itself.
    // The whole q= param gets encodeURIComponent once below.
    //
    // PokemonTCG.io reliably returns 500 on quoted multi-word names (e.g.
    // name:"Mega Lucario EX") AND on `firstWord* number:N` when firstWord
    // is a generic prefix like "Mega". Workaround: extract the "identifying"
    // word (skip Mega/Dark/Radiant/Shining/etc.) and use IT as the wildcard,
    // paired with the number when we have one. This is far more selective
    // ("Lucario* number:179" returns exactly 1 card).
    const words = cleanName.split(/\s+/).filter(Boolean);
    const PREFIXES = new Set(['mega','dark','radiant','shining','team','light','ex','gx','v','vmax','vstar']);
    // Pick the first "identifying" word: the first non-prefix word, else fall back to word[0]
    const identifyingWord = words.find(w => !PREFIXES.has(w.toLowerCase())) || words[0] || '';
    const firstWord = words[0] || '';
    const queries = [
      // Best signal: identifying-word wildcard + number filter — very selective
      cleanNumber && identifyingWord ? `name:${identifyingWord}* number:${cleanNumber}` : '',
      // Same but with first word (fallback if identifyingWord === firstWord)
      cleanNumber && firstWord && firstWord !== identifyingWord ? `name:${firstWord}* number:${cleanNumber}` : '',
      // Number-only when name queries fail — safe because we filter client-side
      cleanNumber ? `number:${cleanNumber}` : '',
      // Broad identifying-word wildcard (client-side filter picks best)
      identifyingWord ? `name:${identifyingWord}*` : '',
      // Original quoted-name query LAST (most likely to 500 on multi-word names)
      `name:"${cleanName}"`,
    ].filter(q => q.trim());

    let cards = [];
    for (const q of queries) {
      // 2026-08-18: bump pageSize 20 → 60 so newer sets on page-2 of common
      // Pokemon names (like Metang me4-94 Chaos Rising IR) aren't cut off.
      // pokemontcg.io returns Metang in 27 printings — page 1 of 20 stops at
      // Vivid Voltage, missing Chaos Rising entirely. That truncation was the
      // root cause of the wrong-set match reported 2026-08-18.
      const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=60&select=id,name,set,number,rarity,images,tcgplayer,supertype,subtypes`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        cards = json.data || [];
        if (cards.length > 0) break; // got results, stop trying
      }
    }

    // Pick the best match: prefer exact number+name match, then rarity+setName match.
    // We track HOW we matched so we can enforce a confidence threshold — a raw
    // cards[0] fallthrough with no number/rarity/set signal is almost always
    // wrong (e.g. "Charizard" returns 250 candidates from Base Set to today).
    //
    // IMPORTANT: when our fallback query was `number:N` alone, `cards` contains
    // many DIFFERENT cards that share the number. `c.number === cleanNumber`
    // would return the first one (usually wrong). So we also check that the
    // card's name contains the identifying word from the scanned name.
    const idWordLower = (identifyingWord || '').toLowerCase();
    const nameMatches = (c) => {
      if (!idWordLower) return true;
      return (c.name || '').toLowerCase().includes(idWordLower);
    };
    // 2026-08-18: strip leading zeros for comparison. pokemontcg.io stores
    // numbers as "94", not "094", so `"094" === "94"` was always failing when
    // the OCR read the printed "094/086" format.
    const stripZeros = (s) => String(s || '').replace(/^0+/, '') || '0';
    const numEq = (a, b) => stripZeros(a) === stripZeros(b);
    // 2026-08-18: rarity + set matching is STRONGER than loose number-only.
    // When we have both signals from the scan, prefer them over a same-number
    // wrong-set match (the exact bug from the Metang 094/086 report).
    // 2026-09-03: rank candidates by how well their set matches the scanned
    // set BEFORE any .find() runs.
    //
    // Every set test below is `.includes(scannedSet)`, a substring compare. So
    // a scan reading set "Base" matched "Base Set 2" just as happily as "Base
    // Set" -- and whichever the API happened to list first is what .find()
    // returned. Right Pokemon, right number, wrong set, and for Charizard the
    // gap between Base Set and Base Set 2 is most of the card's value.
    //
    // Substring matching stays (OCR rarely reads a full set name, and tightening
    // it to equality would turn working scans into misses). Instead the array is
    // pre-sorted so the closest set is the first thing .find() sees:
    //   3 = set names are identical after normalising
    //   2 = scanned set appears as a whole word ("Base" in "Base Set")
    //   1 = substring only ("ase" in "Base")
    // ties break toward the set with the fewest extra words, so "Base" prefers
    // "Base Set" over "Base Set 2". Stable within a tier, so an equal-ranked
    // group keeps the API's own ordering and nothing that matched before stops
    // matching now -- it can only match something closer.
    const setNorm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const wantSet = setNorm(setName);
    const wantSetWords = wantSet ? wantSet.split(' ').filter(Boolean).length : 0;
    const setScore = (c) => {
      if (!wantSet) return 0;
      const cs = setNorm(c.set?.name);
      if (!cs) return 0;
      if (cs === wantSet) return 3;
      const esc = wantSet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp('(^| )' + esc + '( |$)').test(cs)) return 2;
      return cs.includes(wantSet) ? 1 : 0;
    };
    if (wantSet && cards.length > 1) {
      cards = cards
        .map((c, i) => ({ c, i, s: setScore(c),
                          d: Math.abs(setNorm(c.set?.name).split(' ').filter(Boolean).length - wantSetWords) }))
        .sort((a, b) => (b.s - a.s) || (a.d - b.d) || (a.i - b.i))
        .map(x => x.c);
    }

    let match = null;
    let matchReason = null;
    // 1. Grounded by rarity + set + number — highest confidence
    if (rarity && setName && cleanNumber) {
      const rl = rarity.toLowerCase();
      const sl = setName.toLowerCase();
      match = cards.find(c =>
        (c.rarity || '').toLowerCase() === rl &&
        (c.set?.name || '').toLowerCase().includes(sl) &&
        (numEq(c.number, cleanNumber) || numEq((c.number || '').split('/')[0], cleanNumber)) &&
        nameMatches(c)
      );
      if (match) matchReason = 'rarity+set+number+name';
    }
    // 2. Rarity + set (any number)
    if (!match && rarity && setName) {
      const rl = rarity.toLowerCase();
      const sl = setName.toLowerCase();
      match = cards.find(c =>
        (c.rarity || '').toLowerCase() === rl &&
        (c.set?.name || '').toLowerCase().includes(sl) &&
        nameMatches(c)
      );
      if (match) matchReason = 'rarity+set+name';
    }
    // 3. Set + number + name (rarity might mismatch on legacy OCR)
    if (!match && setName && cleanNumber) {
      const sl = setName.toLowerCase();
      match = cards.find(c =>
        (c.set?.name || '').toLowerCase().includes(sl) &&
        (numEq(c.number, cleanNumber) || numEq((c.number || '').split('/')[0], cleanNumber)) &&
        nameMatches(c)
      );
      if (match) matchReason = 'set+number+name';
    }
    // 4. Number + name — legacy path with leading-zero fix
    if (!match && cleanNumber) {
      match = cards.find(c => numEq(c.number, cleanNumber) && nameMatches(c));
      if (match) matchReason = 'number+name';
    }
    if (!match && cleanNumber) {
      match = cards.find(c => numEq((c.number || '').split('/')[0], cleanNumber) && nameMatches(c));
      if (match) matchReason = 'number-before-slash+name';
    }
    // 5. REMOVED 2026-09-03: number-only, name-blind match.
    //
    // This is the bug behind the Fennekin -> Snorlax report. The scanner did
    // its job: it read "Fennekin" and number "080", and the panel even said
    // "Loading Fennekin - 080". But no Fennekin printing has number 80, so
    // every name-checked path above missed and this fallback matched purely on
    // the number -- loading Snorlax (Flashfire #80), Snorlax's artwork, and a
    // $4.72 price. A seller reading that screen has been told a different
    // Pokemon is theirs, at a price that was never about their card.
    //
    // It also contradicted the note directly below, which claimed the
    // silent-wrong-card path had been removed. It had not: this WAS that path.
    //
    // 6. Rarity + set with no number (weakest -- e.g. "Illustration Rare" in
    // "Chaos Rising"). This ignored the scanned name too, so it could pick a
    // same-rarity card from the same set with an unrelated name. It now
    // requires nameMatches like every other path.
    //
    // If nothing confirms the scanned NAME, we render the scan-miss panel and
    // refund the credit. A miss the seller can retry beats a confident wrong
    // card.
    if (!match && rarity && setName) {
      const rl = rarity.toLowerCase();
      const sl = setName.toLowerCase();
      match = cards.find(c =>
        (c.rarity || '').toLowerCase() === rl &&
        (c.set?.name || '').toLowerCase().includes(sl) &&
        nameMatches(c)
      );
      if (match) matchReason = 'rarity+set+name';
    }
    // NOTE: intentionally NOT falling back to cards[0]. That silent-wrong-card
    // path was the whole point of this fix. If we can't identify a confident
    // match, we render the scan-miss panel below.

    if (match && window._SCAN_MISS_V2 !== false) {
      // Confident match — log which strategy won for observability
      try { console.info('[scan] match via', matchReason, match.name, match.number); } catch(e) {}
    }

    if (match) {
      const prices = match.tcgplayer?.prices || {};
      const priceVariants = Object.keys(prices).map(key => ({
        key,
        label: formatVariantName(key),
        market: prices[key]?.market ?? null,
        low:    prices[key]?.low    ?? null,
        mid:    prices[key]?.mid    ?? null,
        high:   prices[key]?.high   ?? null,
      }));

      // 2026-08-15: if pokemontcg.io returned this card but with no
      // tcgplayer.prices (common for full-art / secret rares like Watchog
      // Crown Zenith #096/086), fall back to /api/tcg-price live lookup
      // so we still show a market value on the card panel.
      const _anyPriced = priceVariants.some(v => (v.market != null && v.market > 0) || (v.mid != null && v.mid > 0));
      if (!_anyPriced) {
        try {
          const _tplName = match.name || cleanName;
          const _tplNum  = match.number || cleanNumber || '';
          const _tplSet  = match.set?.name || setName || '';
          const r = await fetch(`/api/tcg-price?name=${encodeURIComponent(_tplName)}${_tplNum ? '&number=' + encodeURIComponent(_tplNum) : ''}${_tplSet ? '&set=' + encodeURIComponent(_tplSet) : ''}`, { signal: AbortSignal.timeout(7000) });
          if (r.ok) {
            const d = await r.json();
            if (d && d.market > 0) {
              priceVariants.push({
                key: 'holofoil',
                label: 'Holofoil',
                market: d.market,
                low:    d.low   ?? null,
                mid:    d.mid   ?? d.market,
                high:   d.high  ?? null,
              });
            }
          }
        } catch(e) { /* best-effort fallback */ }

        // 2026-08-19: if /api/tcg-price also missed AND we still have no live
        // price BUT the bulk row already resolved one, use it. This covers
        // the exact case from the video (Mega Greninja Chaos Rising #22
        // showing $1.27 Tcgplayer_live in the bulk row, then "LIVE PRICING
        // UNAVAILABLE" after tap because the same fallback missed twice).
        const _stillMissing = !priceVariants.some(v => (v.market != null && v.market > 0) || (v.mid != null && v.mid > 0));
        if (_stillMissing && pending && pending.marketPrice != null && Number(pending.marketPrice) > 0) {
          priceVariants.push({
            key: 'holofoil',
            label: 'Holofoil',
            market: Number(pending.marketPrice),
            low:    null,
            mid:    Number(pending.marketPrice),
            high:   null,
          });
        }
      }
      const card = {
        name:   match.name,
        game:   'pokemon',
        images: { small: match.images?.small || '', large: match.images?.large || '' },
        setName: match.set?.name || setName || '',
        number:  match.number || number || '',
        rarity:  match.rarity || rarity || '',
        priceVariants,
        source: 'TCGPlayer',
        updatedAt: match.tcgplayer?.updatedAt || '',
      };
      selectedCard = card;
      if (si) si.value = card.name;
      dropList.classList.remove('open');
      loadCardUI(card);
      // If AI grading was requested, open the grade gate now
      if (window._openGradeAfterScan) {
        window._openGradeAfterScan = false;
        setTimeout(() => {
          // Scroll card into view first, then open the grade scan flow
          typeof openGradeScanGate === 'function' && openGradeScanGate();
        }, 600);
      }
      // Scroll card into view
      const mainCard = document.getElementById('cardHero');
      if (mainCard) mainCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    // ---- SECONDARY SOURCE: TCGPriceLookup ----
    // PokemonTCG.io often lags on newer sets (Scarlet & Violet-era). TPL
    // covers those. Try TPL only when we have a key and PokemonTCG.io
    // didn't produce a confident match.
    if (window.tplApiKey) {
      try {
        const tplHits = await searchWithTPL(cleanName, 'pokemon');
        if (tplHits && tplHits.length) {
          // Same match strategy: exact number → partial number → rarity+set
          const normalizeNum = n => (n || '').replace(/\s/g,'').split('/')[0].replace(/^0+/, '') || n;
          let tplMatch = null;
          let tplReason = null;
          if (cleanNumber) {
            const nt = normalizeNum(cleanNumber);
            tplMatch = tplHits.find(c => normalizeNum(c.number) === nt);
            if (tplMatch) tplReason = 'tpl-exact-number';
          }
          if (!tplMatch && rarity && setName) {
            const rl = rarity.toLowerCase();
            const sl = setName.toLowerCase();
            tplMatch = tplHits.find(c => (c.rarity || '').toLowerCase() === rl && (c.set_name || c.set?.name || '').toLowerCase().includes(sl));
            if (tplMatch) tplReason = 'tpl-rarity+set';
          }
          if (tplMatch) {
            try { console.info('[scan] TPL match via', tplReason, tplMatch.name, tplMatch.number); } catch(e) {}
            const card = tplCardToNormalized(tplMatch, 'pokemon', tplMatch.image_url || '');
            selectedCard = card;
            if (si) si.value = card.name;
            dropList.classList.remove('open');
            loadCardUI(card);
            if (window._openGradeAfterScan) {
              window._openGradeAfterScan = false;
              setTimeout(() => { typeof openGradeScanGate === 'function' && openGradeScanGate(); }, 600);
            }
            const mainCard = document.getElementById('cardHero');
            if (mainCard) mainCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
          }
        }
      } catch(tplErr) {
        console.warn('[_loadScannedCardExact] TPL fallback error:', tplErr);
        /* continue to synthetic-card fallback */
      }
    }
  } catch(e) {
    console.warn('[_loadScannedCardExact] error:', e);
    /* fall through to synthetic-card + scan-miss panel */
  }

  // ---- SYNTHETIC CARD FALLBACK ----
  // Neither PokemonTCG.io nor TPL found a confident match, but we still have
  // scan metadata (name, number, set, rarity, sometimes an image from OCR).
  // Populate the main card view with this data so the user sees THEIR card
  // in place of "No card selected". Price data is empty (they set Override).
  // The scan-miss panel + auto-search still render above/below so they can
  // fix a wrong name or pick a different printing.
  try {
    if (pending && (pending.name || pending.number)) {
      // Reuse the image we resolved earlier for the scan-miss thumbnail.
      // 2026-08-19: also accept pending.imageDataUrl (base64 thumbnail of the
      // user's scanned photo) as a final fallback so we NEVER show "Image
      // unavailable" when the bulk row already had a picture.
      let synthImg = pending.imageUrl || '';
      if (!synthImg && typeof cards !== 'undefined' && Array.isArray(cards) && cards.length) {
        // 2026-08-18: match with leading-zero normalization + prefer
        // rarity/set-matching card as thumbnail, so an unmatched scan still
        // shows the RIGHT printing's art (not the oldest-set same-number).
        const cnClean = (pending.number || '').split('/')[0];
        const cnStripped = String(cnClean || '').replace(/^0+/, '') || cnClean;
        const rl = (pending.rarity || '').toLowerCase();
        const sl = (pending.setName || '').toLowerCase();
        const numMatches = (c) => {
          const cn = String(c.number || '').split('/')[0].replace(/^0+/, '');
          return cn === cnStripped;
        };
        let preferred = null;
        // Best: number + rarity + set
        if (cnClean && rl && sl) preferred = cards.find(c => numMatches(c) && (c.rarity || '').toLowerCase() === rl && (c.set?.name || '').toLowerCase().includes(sl));
        // Next: number + rarity
        if (!preferred && cnClean && rl) preferred = cards.find(c => numMatches(c) && (c.rarity || '').toLowerCase() === rl);
        // Next: number + set
        if (!preferred && cnClean && sl) preferred = cards.find(c => numMatches(c) && (c.set?.name || '').toLowerCase().includes(sl));
        // Next: number only
        if (!preferred && cnClean) preferred = cards.find(c => numMatches(c));
        // Last: rarity + set (no number)
        if (!preferred && rl && sl) preferred = cards.find(c => (c.rarity || '').toLowerCase() === rl && (c.set?.name || '').toLowerCase().includes(sl));
        preferred = preferred || cards[0];
        synthImg = preferred?.images?.small || preferred?.images?.large || '';
      }
      // 2026-08-19: last-resort fallback — use the user's scanned photo as
      // the card image. Not the ideal art (it's their photo, not the DB
      // print), but massively better than "Image unavailable" — they scanned
      // it, they know what it looks like, and the price panel below can
      // still show live data from the bulk row.
      if (!synthImg && pending.imageDataUrl) synthImg = pending.imageDataUrl;

      // 2026-08-19: reuse the marketPrice from the bulk row so the detail
      // view doesn't say "LIVE PRICING UNAVAILABLE" when the bulk scanner
      // already got a live price (via /api/tcg-price fallback). Synthesize a
      // single-variant price entry that loadCardUI + the price panel
      // rendering path already understand.
      const synthPriceVariants = [];
      if (pending.marketPrice != null && Number(pending.marketPrice) > 0) {
        synthPriceVariants.push({
          key: 'holofoil',
          label: 'Holofoil',
          market: Number(pending.marketPrice),
          low:    null,
          mid:    Number(pending.marketPrice),
          high:   null,
        });
      } else {
        // 2026-08-19 (post bulk-scan test): last-ditch price fetch — when
        // PokemonTCG.io misses AND the bulk row didn't pass a marketPrice
        // through (e.g. Mega Greninja ex from Chaos Rising: brand-new set,
        // not yet indexed by pokemontcg.io, and the bulk row's price fetch
        // returned late or was skipped), hit /api/tcg-price directly with
        // the scanned metadata. This is the same endpoint the bulk row uses
        // so if TCGcsv has the card we'll get a price here too.
        try {
          const params = new URLSearchParams({
            name: pending.name || '',
            game: 'pokemon',
          });
          if (pending.number)  params.set('number', pending.number);
          if (pending.setName) params.set('set', pending.setName);
          const pRes = await fetch(`/api/tcg-price?${params.toString()}`, {
            headers: { 'x-cardresell-source': 'synth-fallback' },
          });
          if (pRes.ok) {
            const pJson = await pRes.json();
            if (pJson && pJson.market != null && Number(pJson.market) > 0) {
              synthPriceVariants.push({
                key: 'holofoil',
                label: pJson.variant === 'foil' ? 'Foil' : (pJson.variant || 'Market'),
                market: Number(pJson.market),
                low:    pJson.low  != null ? Number(pJson.low)  : null,
                mid:    pJson.mid  != null ? Number(pJson.mid)  : Number(pJson.market),
                high:   pJson.high != null ? Number(pJson.high) : null,
              });
              // 2026-08-21: ALWAYS prefer the tcgcsv image over the
              // pokemontcg.io fallback. The tcgcsv image is the exact
              // scanned card's TCGplayer product photo. The earlier
              // `cards` array may only contain same-number Fennekins
              // from a DIFFERENT set (e.g. sm6-14 Forbidden Light) whose
              // pokemontcg.io CDN URL sometimes 404s on mobile Safari,
              // producing the "Image unavailable" state on Fennekin MEP.
              if (pJson.imageUrl) synthImg = pJson.imageUrl;
              if (!pending.tcgplayerUrl && pJson.url) pending = { ...pending, tcgplayerUrl: pJson.url };
            }
          }
        } catch(pxErr) {
          console.warn('[_loadScannedCardExact] synth price fetch failed:', pxErr);
        }
      }
      const synthCard = {
        name:   pending.name || 'Scanned card',
        game:   'pokemon',
        images: { small: synthImg, large: synthImg },
        setName: pending.setName || '',
        number:  pending.number || '',
        rarity:  pending.rarity || '',
        priceVariants: synthPriceVariants,
        source: synthPriceVariants.length ? (pending.priceSource || 'TCGPlayer') : 'Scan (unmatched)',
        updatedAt: '',
        _synthetic: true, // flag so downstream code knows this is a scan echo
      };
      selectedCard = synthCard;
      if (si) si.value = synthCard.name;
      try { loadCardUI(synthCard); } catch(uiErr) { console.warn('[synth loadCardUI]', uiErr); }
      const mainCard = document.getElementById('cardHero');
      if (mainCard) mainCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // 2026-08-21: if the synth card loaded with real tcgcsv pricing,
      // skip the miss panel entirely — otherwise we render two
      // competing prices (tcgcsv market vs PriceCharting median) for
      // the same card, which looks broken to the user.
      if (synthPriceVariants.length > 0) {
        _synthCardLoadedWithPrice = true;
      }
    }
  } catch(synthErr) {
    console.warn('[_loadScannedCardExact] synthetic-card error:', synthErr);
  }

  // 2026-08-21: skip the miss panel when the synth card already rendered
  // with a real tcgcsv price — the panel would just duplicate the info
  // with a different price source, confusing the user.
  if (_synthCardLoadedWithPrice) {
    return;
  }

  // Still render the scan-miss panel with affiliate search buttons on top
  // (and populate dropdown with candidates below via doSearch) so the user
  // has an obvious path to sold-comps + a fix-the-name affordance.
  // The old openCatalog() fallback is kept behind a feature flag for 7 days
  // so we can rollback with one line if the new panel misbehaves.
  if (window._SCAN_MISS_V2 === false) {
    // Legacy fallback (feature flag OFF)
    if (si) si.value = name;
    switchView('lookup');
    if (typeof openCatalog === 'function') openCatalog(name);
    return;
  }
  // New behavior (feature flag ON, default)
  // Enrich pending.number from any name-matched card we did fetch — the OCR
  // often reads only the visible portion (e.g. "165" instead of "165/086" on
  // Special Illustration Rares). Grabbing the full number from PokemonTCG.io
  // makes eBay/TCGplayer search 100% more precise.
  // ALSO: pull a real card image from the fetched candidates so the scan-miss
  // panel thumbnail shows a real card silhouette instead of the fallback
  // playing-card emoji (which looked like a joker face — wrong for Pokemon).
  try {
    if (typeof cards !== 'undefined' && Array.isArray(cards) && cards.length > 0) {
      const cn = pending?.number || '';
      if (cn && !cn.includes('/')) {
        const hit = cards.find(c => (c.number || '').split('/')[0] === cn);
        if (hit && hit.number) pending = { ...pending, number: hit.number };
      }
      // If we don't have an imageUrl yet, use the first candidate's image so
      // the scan-miss panel shows a real Pokemon card (even if we couldn't
      // confidently pick THE right one, an Audino search returns real Audino
      // images — close enough for a visual anchor).
      if (!pending.imageUrl) {
        // 2026-08-18: same leading-zero + rarity/set preference as above
        const cnClean = (pending?.number || '').split('/')[0];
        const cnStripped = String(cnClean || '').replace(/^0+/, '') || cnClean;
        const rl = (pending?.rarity || '').toLowerCase();
        const sl = (pending?.setName || '').toLowerCase();
        const numMatches = (c) => {
          const cn = String(c.number || '').split('/')[0].replace(/^0+/, '');
          return cn === cnStripped;
        };
        let preferred = null;
        if (cnClean && rl && sl) preferred = cards.find(c => numMatches(c) && (c.rarity || '').toLowerCase() === rl && (c.set?.name || '').toLowerCase().includes(sl));
        if (!preferred && cnClean && rl) preferred = cards.find(c => numMatches(c) && (c.rarity || '').toLowerCase() === rl);
        if (!preferred && cnClean && sl) preferred = cards.find(c => numMatches(c) && (c.set?.name || '').toLowerCase().includes(sl));
        if (!preferred && cnClean) preferred = cards.find(c => numMatches(c));
        preferred = preferred || cards[0];
        const img = preferred?.images?.small || preferred?.images?.large;
        if (img) pending = { ...pending, imageUrl: img };
      }
    }
  } catch(e) { /* enrichment is best-effort */ }
  _renderScanMissPanel(pending);
  _logScanMiss(pending);
  // Bug fix 2026-08-13: After a scan misses, the main card area still
  // showed "No card selected" until the user manually pressed Enter on the
  // search input. Fire the same doSearch() that Enter would trigger, so the
  // dropdown populates with candidate cards immediately — user can pick the
  // right one from the results grid without any extra keystroke.
  try {
    if (typeof doSearch === 'function' && name) {
      // Fire and forget — dropList populates asynchronously
      doSearch(name).catch(() => {});
    }
  } catch(e) { /* best-effort */ }
}

// Render a card-shaped "not found" panel for scans that PokemonTCG.io
// couldn't confidently identify. Shows the scanned card info + affiliate
// search buttons for eBay and TCGplayer + an "adjust name" affordance.
// Injects into the lookup view above the search input, replacing any
// previous scan-miss panel so repeated scans don't stack.
function _renderScanMissPanel(pending) {
  const { name, number, setName, rarity, imageUrl } = pending || {};
  const displayName = name || 'Unknown card';
  const displayNumber = number ? `#${number}` : '';
  const displaySet = setName || '';
  const displayRarity = rarity || '';

  // Build affiliate-tagged search URLs. Reuse existing builders so we
  // inherit EPN + Impact tracking without duplicating URL construction.
  //
  // eBay: name + number only. Including set name over-constrains the query
  // and Chaos Rising / Japanese-set names return zero sold listings.
  // Also strip any trailing number the OCR/scanner already glued onto name
  // (e.g. "Charizard 4/175") so we don't double-paste the number.
  const nameNoNum = String(name || '').replace(/\s+\d+\s*\/\s*\d+\s*$/, '').trim();
  const ebayQ = encodeURIComponent([nameNoNum, number].filter(Boolean).join(' '));
  const ebaySearchUrl = (typeof buildEbayUrl === 'function')
    ? buildEbayUrl(`https://www.ebay.com/sch/i.html?_nkw=${ebayQ}&_sacat=183454&LH_Sold=1&LH_Complete=1`)
    : `https://www.ebay.com/sch/i.html?_nkw=${ebayQ}`;
  // Companion sell-flow link — user landed here because we couldn't ID the
  // card. If they've researched and want to list anyway, one tap into eBay's
  // sell template with the query pre-filled.
  const ebaySellUrl = (typeof buildEbayUrl === 'function')
    ? buildEbayUrl(`https://www.ebay.com/sell/listing?flow=startSell&presetNameSearchQuery=${ebayQ}`)
    : `https://www.ebay.com/sell/listing?flow=startSell&presetNameSearchQuery=${ebayQ}`;
  const tcgSearchUrl = (typeof buildTcgpUrl === 'function')
    ? buildTcgpUrl(name || '', setName || '', number || '')
    : `https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent([name, setName, number].filter(Boolean).join(' '))}`;

  // Remove any previous scan-miss panel
  const prev = document.getElementById('scanMissPanel');
  if (prev && prev.parentNode) prev.parentNode.removeChild(prev);

  // Insert into #lookupView, above the search input if possible
  const host = document.getElementById('lookupView') || document.body;
  const panel = document.createElement('div');
  panel.id = 'scanMissPanel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Card scanned but not found');
  panel.style.cssText = 'max-width:520px;margin:1rem auto;padding:1.1rem 1.15rem;background:var(--surface,#111);border:1.5px solid var(--gold-border,#4a3a15);border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.35)';

  const esc = (typeof _esc === 'function') ? _esc : (s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

  // No thumbnail here — the big hero image (cardHero) already shows the
  // scanned card at the top of the page. A second mini-image in the notice
  // panel would be redundant and often "doesn't display" for cards missing
  // from PokemonTCG.io.

  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:.5rem;font-size:.7rem;font-weight:700;color:var(--gold,#f2c14e);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.7rem">
      <span>Live pricing unavailable</span>
    </div>
    <div style="margin-bottom:.9rem">
      <div style="font-size:1rem;font-weight:800;color:var(--text,#fff);line-height:1.25;letter-spacing:-.01em">${esc(displayName)} ${esc(displayNumber)}</div>
      ${displaySet ? `<div style="font-size:.78rem;color:var(--text-muted,#9a9a9a);margin-top:.2rem">${esc(displaySet)}</div>` : ''}
      ${displayRarity ? `<div style="font-size:.72rem;color:var(--text-muted,#9a9a9a);margin-top:.15rem">${esc(displayRarity)}</div>` : ''}
      <div style="font-size:.72rem;color:rgba(255,255,255,.55);margin-top:.5rem;line-height:1.4">This card loaded but we don't have live market prices yet — you can still track it in your Collection and check sold comps on eBay/TCGplayer below.</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:.5rem">
      <button type="button" onclick="_scanMissAddToCollection()" style="display:flex;align-items:center;justify-content:center;gap:.5rem;padding:.75rem 1rem;background:var(--gold,#f2c14e);color:#000;border:none;border-radius:10px;font-size:.88rem;font-weight:800;cursor:pointer">➕ Add to My Collection</button>
      <a href="${esc(ebaySearchUrl)}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:.5rem;padding:.65rem 1rem;background:#e53935;color:#fff;border-radius:10px;font-size:.82rem;font-weight:700;text-decoration:none">Search sold on eBay →</a>
      <a href="${esc(ebaySellUrl)}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:.4rem;padding:.55rem 1rem;background:transparent;color:var(--gold,#f2c14e);border:1px solid var(--gold-border,#4a3a15);border-radius:10px;font-size:.78rem;font-weight:700;text-decoration:none">List on eBay →</a>
      <a href="${esc(tcgSearchUrl)}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:.5rem;padding:.65rem 1rem;background:transparent;color:var(--text,#fff);border:1px solid var(--gold-border,#4a3a15);border-radius:10px;font-size:.82rem;font-weight:600;text-decoration:none">Search on TCGplayer →</a>
      <button type="button" onclick="_scanMissAdjustName()" style="display:flex;align-items:center;justify-content:center;gap:.5rem;padding:.55rem 1rem;background:transparent;color:var(--text-muted,#9a9a9a);border:none;border-radius:10px;font-size:.78rem;font-weight:600;cursor:pointer;text-decoration:underline">Wrong card? Adjust name</button>
    </div>
    <div style="text-align:center;margin-top:.7rem">
      <button type="button" onclick="_scanMissDismiss()" style="background:none;border:none;color:rgba(255,255,255,.4);font-size:.72rem;cursor:pointer;padding:.3rem;text-decoration:underline">Dismiss</button>
    </div>
  `;

  // Insert AFTER cardHero (big card image stays at top) so users see their
  // scanned card first, then this notice + CTAs as a section below. Falls
  // back to prepending #lookupView if cardHero isn't in the DOM.
  const cardHero = document.getElementById('cardHero');
  if (cardHero && cardHero.parentNode) {
    // Insert as the next sibling of cardHero
    if (cardHero.nextSibling) cardHero.parentNode.insertBefore(panel, cardHero.nextSibling);
    else cardHero.parentNode.appendChild(panel);
  } else if (host.firstChild) {
    host.insertBefore(panel, host.firstChild);
  } else {
    host.appendChild(panel);
  }

  // Scroll to the BIG card image at the top, not the notice panel. The user
  // wants to see their scanned card first — the notice is a section below.
  try {
    const target = cardHero || panel;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch(e) {}

  // 2026-08-21: PriceCharting fallback — when pokemontcg.io hasn't
  // indexed the set yet (e.g. new Mega Evolution promos, JP-only sets),
  // PC often has the raw + graded price and a canonical product URL.
  // We enrich the miss panel in-place when the fetch resolves so the
  // user goes from "LIVE PRICING UNAVAILABLE" to a real market value
  // without another tap.
  _enrichMissPanelWithPriceCharting(panel, {
    name, number, setName, cardType: pending?.cardType || 'pokemon',
  }).catch(err => console.warn('[scan-miss] PC enrichment failed:', err));
}

// 2026-08-21: Background fetch PriceCharting for the scanned card and,
// if a match returns, replace the miss panel's "unavailable" header with
// a real market price row. Silent-fail so a PC 4xx/5xx just leaves the
// original panel in place.
async function _enrichMissPanelWithPriceCharting(panel, info) {
  if (!panel || !info || !info.name) return;
  // 2026-09-04: snapshot the card generation this enrichment belongs to.
  // isConnected alone is not enough: it only catches the case where a NEWER
  // panel displaced this one. If the next card resolves normally no new panel
  // is built, so a still-in-flight PriceCharting call for the PREVIOUS card
  // stayed "connected" and wrote that card's price beside the new card's art.
  // _beginCardSwap bumps _imgGen on every swap, so comparing against it after
  // the await is what actually makes this write card-scoped.
  const _pcGenSnap = window._imgGen || 0;
  // Only enrich for TCG cards — sports has its own PC path elsewhere and
  // we don't want two overlapping renders.
  const game = (info.cardType || 'pokemon').toLowerCase();
  if (game === 'sports') return;
  const pcGame = ({
    pokemon: 'pokemon', mtg: 'magic', magic: 'magic',
    yugioh: 'yugioh', lorcana: 'lorcana', onepiece: 'onepiece',
  })[game] || 'pokemon';

  const params = new URLSearchParams();
  params.set('game', pcGame);
  params.set('name', String(info.name).replace(/["\\]/g, '').trim());
  if (info.setName) params.set('set', String(info.setName));
  if (info.number)  params.set('number', String(info.number).replace(/^#/, '').split('/')[0].trim());

  let pc;
  try {
    const r = await fetch('/api/pricecharting?' + params.toString());
    if (!r.ok) return;
    pc = await r.json();
  } catch(e) { return; }

  if (!pc || pc.median == null || pc.source !== 'pricecharting') return;

  // Panel may have been dismissed while we were fetching — check both
  // that our reference is still in the DOM and that its id is intact.
  if (!panel.isConnected || panel.id !== 'scanMissPanel') return;
  // The user may have moved to a different card while we were fetching.
  if ((window._imgGen || 0) !== _pcGenSnap) return;   // stale — belongs to a retired card

  const price = Number(pc.median);
  const priceStr = price >= 100 ? '$' + price.toFixed(0) : '$' + price.toFixed(2);
  const psa10   = (pc.prices && pc.prices.psa_10 != null) ? Number(pc.prices.psa_10) : null;
  const psa10Str = psa10 != null && isFinite(psa10) ? '$' + (psa10 >= 100 ? psa10.toFixed(0) : psa10.toFixed(2)) : '';
  const pcUrl   = pc.url || '';

  // Find the "LIVE PRICING UNAVAILABLE" header block and swap it for a
  // real price row. We identify it by the gold-uppercase span text; if
  // the panel layout changed and we can't find it, no-op instead of
  // corrupting the DOM.
  const headerRow = panel.querySelector('div[style*="letter-spacing:.05em"]');
  if (!headerRow) return;
  headerRow.innerHTML = '<span style="color:#4ade80">Market price — raw</span>';

  // Find the copy paragraph (starts with "This card loaded but") and
  // replace it with a compact price row.
  const paras = panel.querySelectorAll('div');
  for (const d of paras) {
    if (d.textContent && d.textContent.startsWith("This card loaded but")) {
      d.style.color = '#e5e5e5';
      d.style.fontSize = '.78rem';
      d.style.marginTop = '.5rem';
      d.style.lineHeight = '1.45';
      d.innerHTML = 'Raw NM <b style="color:#4ade80;font-size:1.05rem">' + priceStr + '</b>'
        + (psa10Str ? ' · <span style="color:#a3a3a3">PSA 10 ≈ ' + psa10Str + '</span>' : '')
        + (pcUrl ? ' · <a href="' + pcUrl + '" target="_blank" rel="noopener" style="color:#f2c14e;text-decoration:underline">PriceCharting →</a>' : '');
      break;
    }
  }
}

// User tapped "Add to My Collection" from the scan-miss notice. Delegates
// to the main addCurrentCardToCollection() which uses selectedCard (already
// populated with the synthetic card from _loadScannedCardExact).
function _scanMissAddToCollection() {
  if (typeof addCurrentCardToCollection === 'function') {
    _scanMissDismiss();
    addCurrentCardToCollection();
  }
}

// User tapped "Adjust name and search again" — focus the search input with
// the current scanned name pre-selected so a keystroke replaces it, and
// dismiss the panel. Does NOT open the results grid.
function _scanMissAdjustName() {
  const si = document.getElementById('searchInput');
  if (si) {
    try { si.focus(); si.select(); } catch(e) {}
  }
  _scanMissDismiss();
}

function _scanMissDismiss() {
  const p = document.getElementById('scanMissPanel');
  if (p && p.parentNode) p.parentNode.removeChild(p);
}

// Fire-and-forget log of scan misses. Non-blocking, wrapped in try. Helps
// us see WHICH cards keep missing (Chaos Rising, other new sets, OCR
// misreads) so we can prioritize eBay Browse API integration for the
// sets that need it most.
// 2026-09-03: `extra` carries the total-recognition-failure case. Until now
// this function was called from exactly ONE site (the scan-miss panel, which
// requires a card we DID identify by name), so "Card not recognized" — the
// single most important failure to know about — logged nothing at all. Any
// new failure branch in the scan flow MUST call this.
function _logScanMiss(pending, extra) {
  try {
    const payload = {
      name:    pending?.name    || '',
      number:  pending?.number  || '',
      setName: pending?.setName || '',
      rarity:  pending?.rarity  || '',
      ua:      (navigator.userAgent || '').slice(0, 200),
      at:      Date.now(),
      ...(extra || {}),
    };
    fetch('/api/scan-miss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch(e) { /* never let logging break the UI */ }
}

// ── Affiliate grading CTA helpers ──
function _affiliateLinks() {
  return {
    psa: window.CARDSELL_AFFIL_PSA || '#',
    cgc: window.CARDSELL_AFFIL_CGC || '#',
    bgs: window.CARDSELL_AFFIL_BGS || '#',
    sgc: window.CARDSELL_AFFIL_SGC || '#'
  };
}

// Low-confidence scan picker: server gave us 2–3 candidates and refunded the credit.
// Show a chooser — user taps the correct card; we debit 1 ID credit and set it as the scan result.
function _renderScanCandidatesPicker(candidates, statusEl, resultEl, objectUrl) {
  if (!candidates || candidates.length < 2) return;
  const topGuess = candidates[0];
  statusEl.innerHTML = '<span style="color:#facc15;font-weight:800">\u26A0 Not 100% sure \u2014 pick the right card</span>' +
    '<br><span style="font-size:.72rem;opacity:.6">No credit charged until you pick. If none match, tap Cancel.</span>';

  const rows = candidates.map((c, i) => {
    const parts = [
      c.set_name || '',
      c.card_number ? '#' + c.card_number : '',
      c.rarity || '',
      c.hp ? c.hp + ' HP' : '',
    ].filter(Boolean).join(' \u00b7 ');
    const conf = (typeof c.confidence_pct === 'number' && c.confidence_pct > 0)
      ? '<span style="font-size:.65rem;color:rgba(255,255,255,.5);margin-left:.4rem">' + Math.round(c.confidence_pct) + '% match</span>'
      : '';
    return '<button type="button" onclick="_pickScanCandidate(' + i + ')" ' +
      'style="display:block;width:100%;text-align:left;padding:.7rem .8rem;margin-bottom:.4rem;background:#151515;border:1px solid #2a2a2a;border-radius:10px;color:#fff;cursor:pointer;font-size:.85rem">' +
      '<div style="font-weight:800">' + (c.card_name || 'Unknown') + conf + '</div>' +
      (parts ? '<div style="font-size:.72rem;opacity:.6;margin-top:.15rem">' + parts + '</div>' : '') +
      '</button>';
  }).join('');

  resultEl.innerHTML =
    '<div style="margin-top:.4rem">' + rows +
    '<button type="button" onclick="cancelScan()" ' +
    'style="display:block;width:100%;padding:.55rem;margin-top:.3rem;background:transparent;border:1px solid #333;border-radius:10px;color:#aaa;font-size:.78rem;cursor:pointer">None of these \u2014 cancel</button>' +
    '</div>';

  // Stash candidates + objectUrl for the picker handler.
  window._pendingScanCandidates = candidates;
  window._pendingScanObjectUrl  = objectUrl;
}

async function _pickScanCandidate(idx) {
  const list = window._pendingScanCandidates || [];
  const picked = list[idx];
  if (!picked) return;
  const statusEl = document.getElementById('scanStatus');
  const resultEl = document.getElementById('scanResult');
  if (statusEl) statusEl.innerHTML = '<span style="color:#4ade80">\u2713 ' + (picked.card_name || 'Card') + (picked.card_number ? ' #' + picked.card_number : '') + '</span>';
  if (resultEl) resultEl.innerHTML = '<span style="font-size:.72rem;opacity:.6">Debiting credit\u2026</span>';

  // Debit 1 ID scan credit now that the user has confirmed the answer.
  const idToken = window._googleIdToken || '';
  try {
    const r = await fetch('/api/scan-debit-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
      body: JSON.stringify({ pickedCard: picked }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 402) {
      // 2026-08-18: legacy scan-gate modal showed stale pricing.
      // 2026-09-02 (CR-021): a 402 means "out of credits", so send the user to
      // the shop (which can actually sell them credits) rather than the plan
      // chooser, which carries no packs. The shop links on to plans.
      cancelScan();
      openShop('id', 'id_scan_402');
      return;
    }
    if (!r.ok || !d.ok) {
      if (resultEl) resultEl.innerHTML = '<span style="color:#f87171">Could not debit credit. Try again.</span>';
      return;
    }
  } catch(e) {
    if (resultEl) resultEl.innerHTML = '<span style="color:#f87171">Network error. Try again.</span>';
    return;
  }

  // Refresh credit UI
  try { await checkProStatus?.(); } catch(e) {}

  const parts = [picked.set_name || '', picked.rarity || '', picked.hp ? picked.hp + ' HP' : ''].filter(Boolean).join(' \u00b7 ');
  if (statusEl) {
    statusEl.innerHTML = '<span style="color:#4ade80">\u2713 ' + (picked.card_name || 'Card') +
      (picked.card_number ? ' #' + picked.card_number : '') + '</span>' +
      (parts ? '<br><span style="font-size:.8rem;opacity:.7">' + parts + '</span>' : '');
  }
  if (resultEl) resultEl.textContent = '';

  showScanGradeCTA(picked.card_name || '', '', null);

  window._scanTargetNumber = picked.card_number || '';
  window._scanTargetName   = picked.card_name   || '';
  window._scanTargetGrader = '';
  window._scanTargetGrade  = null;
  window._pendingScanBannerCard = picked.card_name || '';
  window._pendingIdScanCard = {
    name:   picked.card_name   || '',
    number: picked.card_number || '',
    setName: picked.set_name   || '',
    rarity:  picked.rarity     || '',
    hp:      picked.hp         || '',
    cardType: picked.card_type || 'pokemon',
    sport:    picked.sport     || '',
    year:     picked.year      || '',
  };
  try { _persistLastIdentified(window._pendingIdScanCard); } catch(_) {}
  // Cross-TCG auto-switch: if user was on Pokemon but picked a Lorcana
  // candidate (etc.), silently swap the game selector before rendering.
  try {
    maybeAutoSwitchGameFromScan(picked.card_type, picked.is_japanese === true);
  } catch(e) { console.warn('[cross-tcg] picker auto-switch failed', e); }
  try { if (window._pendingScanObjectUrl) URL.revokeObjectURL(window._pendingScanObjectUrl); } catch(e) {}
  window._pendingScanCandidates = null;
  window._pendingScanObjectUrl  = null;

  // 2026-08-22: Reveal the View Card button + schedule auto-advance so the
  // overlay actually dismisses. Before this fix, the picker set all the
  // state but never revealed a View Card affordance or triggered
  // cancelScan(), leaving the user stuck on the grading-CTA overlay with
  // no visible way forward (IMG_3935). Auto-advance calls cancelScan(),
  // which reads _pendingIdScanCard and dispatches to the correct
  // exact-load router (_loadScannedCardExact / _loadScannedJPCard /
  // _loadScannedNonPokemonCard / _routeScannedSportsCard) so the card
  // panel loads with real prices and image the moment the overlay
  // dismisses.
  try { _setScanBtns('success'); } catch(_) {}
  const badgePk = document.getElementById('scanSuccessBadge');
  if (badgePk) badgePk.style.display = 'flex';
  try { _scheduleScanAutoAdvance(); } catch(_) {}
}

function showScanGradeCTA(cardName, grader, grade, opts) {
  const cta = document.getElementById('scanGradeCTA');
  if (!cta) return;
  // 2026-08-19: Never upsell a $-costing grade for a card we couldn't
  // confidently identify. If the caller passes opts.suppressed=true (or
  // omits both name and grader/grade signals), hide the CTA instead of
  // showing a generic "Get it officially graded" upsell that would
  // confuse the user on an unmatched scan.
  opts = opts || {};
  if (opts.suppressed === true || (!cardName && !grader && !grade)) {
    cta.classList.remove('show');
    return;
  }
  const links = _affiliateLinks();
  // Update headline based on whether we detected a grader already
  const headline = document.getElementById('scanGradeCTAHeadline');
  if (grader && grade) {
    if (headline) headline.textContent = `Detected ${grader} ${grade} — Get it officially certified!`;
  } else if (grader) {
    if (headline) headline.textContent = `Detected a ${grader} slab — Get it officially certified!`;
  } else {
    if (headline) headline.textContent = `${cardName ? cardName + ' — ' : ''}Get it officially graded!`;
  }
  // Wire affiliate links
  const p = document.getElementById('sgcPSABtn'); if (p) p.href = links.psa;
  const c = document.getElementById('sgcCGCBtn'); if (c) c.href = links.cgc;
  const b = document.getElementById('sgcBGSBtn'); if (b) b.href = links.bgs;
  cta.classList.add('show');
}

function showGradingCtaBanner(cardName) {
  const banner = document.getElementById('gradingCtaBanner');
  if (!banner) return;
  const links = _affiliateLinks();
  const headline = document.getElementById('gradingCtaHeadline');
  if (headline && cardName) headline.textContent = `Want an official grade on ${cardName}?`;
  // Wire affiliate links
  const p = document.getElementById('bannerPSABtn'); if (p) p.href = links.psa;
  const c = document.getElementById('bannerCGCBtn'); if (c) c.href = links.cgc;
  const b = document.getElementById('bannerBGSBtn'); if (b) b.href = links.bgs;
  const s = document.getElementById('bannerSGCBtn'); if (s) s.href = links.sgc;
  // Also wire inline banner buttons in gradedCompsBanner
  const ip = document.getElementById('inlinePSABtn'); if (ip) ip.href = links.psa;
  const ic = document.getElementById('inlineCGCBtn'); if (ic) ic.href = links.cgc;
  const ib = document.getElementById('inlineBGSBtn'); if (ib) ib.href = links.bgs;
  banner.classList.add('show');
}

function hideGradingCtaBanner() {
  const banner = document.getElementById('gradingCtaBanner');
  if (banner) banner.classList.remove('show');
}

function dismissGradingCta() {
  hideGradingCtaBanner();
}

/* ═══════════════════════════════════════════════════════════
   PHOTO INPUT VALIDATION (2026-09-04)
   accept="image/*" is a picker HINT, not a gate: HEIC sails straight
   through it on browsers that cannot decode HEIC, PDFs arrive via drag-drop
   and programmatic flows, and a 20MB photo is decoded at full size before
   downsampling. compressImage() leans on HTMLImageElement, so an
   undecodable file surfaced as a stuck "Identifying card…" with no honest
   recovery state. Gate the file BEFORE we spend a credit or a decode.
   ═══════════════════════════════════════════════════════════ */
const SCAN_MAX_BYTES  = 15 * 1024 * 1024;
const SCAN_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function _validateScanFile(file) {
  if (!file) return 'No photo selected.';
  if (file.size > SCAN_MAX_BYTES) {
    return 'That photo is ' + (file.size / 1048576).toFixed(1) + ' MB. Please use one under 15 MB.';
  }
  const type = String(file.type || '').toLowerCase();
  if (SCAN_MIME_TYPES.has(type)) return '';
  // Name-based fallback: some Android pickers hand us an empty file.type.
  const name = String(file.name || '').toLowerCase();
  if (!type && /\.(jpe?g|png|webp)$/.test(name)) return '';
  if (type === 'image/heic' || type === 'image/heif' || /\.hei[cf]$/.test(name)) {
    return 'HEIC photos cannot be read here. In iPhone Settings › Camera › Formats, pick "Most Compatible", or export the photo as JPEG.';
  }
  if (type === 'application/pdf' || /\.pdf$/.test(name)) {
    return 'That is a PDF, not a photo. Please choose a JPEG, PNG, or WebP image.';
  }
  return 'Unsupported photo format. Please use JPEG, PNG, or WebP.';
}

// Split a FileList into the files we can actually decode and a per-file
// reason for the rest, so multi-file flows can proceed with the good ones
// instead of failing the whole batch.
function _partitionScanFiles(files) {
  const okFiles = [], rejected = [];
  for (const f of (files || [])) {
    const err = _validateScanFile(f);
    if (err) rejected.push({ file: f, name: (f && f.name) || 'photo', error: err });
    else okFiles.push(f);
  }
  return { okFiles, rejected };
}

async function processScanImage(input) {
  const file = input.files[0];
  if (!file) return;

  const fileError = _validateScanFile(file);
  if (fileError) {
    if (typeof showToast === 'function') showToast(fileError, 'info');
    input.value = '';
    return;
  }

  if (!window.googleUser) { openScanner(); return; }

  if (!window._googleIdToken) {
    const overlay2 = document.getElementById('scanOverlay');
    overlay2.style.display = 'flex';
    document.getElementById('scanStatus').innerHTML = '<span style="color:#f87171">Sign-in expired. Please sign in again.</span>';
    document.getElementById('scanResult').innerHTML = '<button onclick="cancelScan();setTimeout(()=>document.getElementById(\'googleSignInBtn\')?.click(),100)" style="margin-top:.5rem;background:var(--gold);color:#000;border:none;border-radius:8px;padding:.55rem 1.4rem;font-weight:700;font-size:.88rem;cursor:pointer">Sign in with Google</button>';
    return;
  }

  const overlay  = document.getElementById('scanOverlay');
  const statusEl = document.getElementById('scanStatus');
  const resultEl = document.getElementById('scanResult');
  const prevWrap = document.getElementById('scanPreviewWrap');
  const prevImg  = document.getElementById('scanPreviewImg');

  overlay.style.display = 'flex';
  _dialogOpened('scanOverlay');
  resultEl.textContent = '';
  statusEl.textContent = 'Identifying card\u2026';

  // 2026-08-22: Nuke any stale scan-miss / cross-card panels from a
  // previous scan. Different code paths (JP, non-Pokemon, sports)
  // update the header/hero but historically didn't all clear the
  // "MARKET PRICE — RAW" panel from a prior card, so users saw the
  // new card's photo above the previous card's price. Clear it at
  // the top of every scan so the full page commits to the new card.
  try {
    const stale = document.getElementById('scanMissPanel');
    if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
  } catch(_) {}

  const objectUrl = URL.createObjectURL(file);
  prevImg.src = objectUrl;
  prevWrap.style.display = 'block';

  // 2026-08-22: Stash the scan photo so JP-Pokemon cards (which have no
  // PokemonTCG.io catalog image) can render the user's scanned photo in
  // the detail card instead of "Image unavailable". Object URL is
  // synchronous — valid immediately — and the async data-URL upgrade
  // (below) replaces it once available, so persistence survives across
  // URL.revokeObjectURL. Reads: _loadScannedJPCard in this file.
  try { window._lastScanImageDataUrl = objectUrl; } catch(_) {}
  try {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const url = String(reader.result || '');
        if (url && url.length < 2 * 1024 * 1024) window._lastScanImageDataUrl = url;
      } catch(_) {}
    };
    reader.readAsDataURL(file);
  } catch(_) {}

  // ── Photo QC gates (2026-08-20): reject bad photos BEFORE we spend a
  //    credit or hit /api/scan. Three gates: low-res, blur, dupe.
  //    Dupe can be bypassed by setting window._skipQCDupe = true (set by
  //    the "Scan again anyway" button below). Low-res + blur are always
  //    enforced. See js/photo-qc.js for the source.
  try {
    if (window.CardResellPhotoQC && typeof window.CardResellPhotoQC.check === 'function') {
      statusEl.textContent = 'Checking photo quality\u2026';
      const qc = await window.CardResellPhotoQC.check(file, {
        skipDupe: !!window._skipQCDupe,
      });
      window._skipQCDupe = false; // one-shot override
      if (!qc.ok) {
        const reason = qc.reasons[0];
        let title, msg, showRetry;
        if (reason === 'low_resolution') {
          title = 'Photo too small';
          msg = `Image is only ${qc.details.width}\u00d7${qc.details.height}px. Please retake with the card larger in the frame.`;
          showRetry = false;
        } else if (reason === 'blurry') {
          title = 'Photo is blurry';
          msg = `Sharpness score ${qc.details.blurScore} (needs \u2265120). Hold steady, tap to focus, then try again.`;
          showRetry = false;
        } else if (reason === 'duplicate') {
          title = 'Same card as last scan';
          msg = 'This looks like the card you just scanned. Scan a different card, or scan this one again anyway.';
          showRetry = true;
        } else if (reason === 'unreadable') {
          title = 'Photo unreadable';
          msg = 'We couldn\'t decode this image. Try a different photo.';
          showRetry = false;
        } else {
          title = 'Photo rejected';
          msg = 'Please retake the photo.';
          showRetry = false;
        }
        statusEl.innerHTML = `<span style="color:#f87171;font-weight:700">${title}</span>`;
        const retryHtml = showRetry
          ? `<button onclick="window._skipQCDupe=true;_startSingleScanCapture()" style="margin-right:.5rem;background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:.55rem 1rem;font-weight:700;font-size:.85rem;cursor:pointer">Scan again anyway</button>`
          : '';
        resultEl.innerHTML = `<div style="font-size:.85rem;color:rgba(255,255,255,.7);margin-bottom:.75rem">${msg}</div>${retryHtml}<button onclick="cancelScan();setTimeout(()=>_startSingleScanCapture(),100)" style="background:rgba(255,255,255,.1);color:#fff;border:none;border-radius:8px;padding:.55rem 1rem;font-weight:700;font-size:.85rem;cursor:pointer">Retake photo</button>`;
        try { if (window.va) va('track', 'photo_qc_reject', { reason, blur: qc.details.blurScore, w: qc.details.width, h: qc.details.height }); } catch(_) {}
        return;
      }
      window._lastPhotoQC = qc; // for debug
    }
  } catch (qcErr) {
    // 2026-09-04: this used to warn and fall through to /api/scan, which meant
    // a device where canvas/ImageBitmap/QC breaks could submit a photo we were
    // never able to validate — quietly voiding the "rejected before you're
    // charged" guarantee. Fail closed instead: no credit is spent on a photo
    // we could not read.
    console.warn('[processScanImage] photo QC failed:', qcErr);
    statusEl.innerHTML = '<span style="color:#f87171;font-weight:700">We could not read this photo</span>';
    resultEl.innerHTML = '<div style="font-size:.85rem;color:rgba(255,255,255,.7);margin-bottom:.75rem">Use a JPEG, PNG, or WebP photo and try again. No credit was used.</div>' +
      '<button onclick="cancelScan();setTimeout(()=>_startSingleScanCapture(),100)" style="background:rgba(255,255,255,.1);color:#fff;border:none;border-radius:8px;padding:.55rem 1rem;font-weight:700;font-size:.85rem;cursor:pointer">Retake photo</button>';
    try { _setScanBtns('error'); } catch(_) {}
    try { URL.revokeObjectURL(objectUrl); } catch(_) {}
    try { if (window.va) va('track', 'photo_qc_error'); } catch(_) {}
    return;
  }

  // ── FAST PATH: try client-side pHash against 20k-card index ──
  // ~200-500ms end-to-end for a match, no /api/scan credit spent.
  // 2026-09-03: the old claim here ("only fires for well-framed non-holo
  // cards") understated the problem — a crop/index preprocessing mismatch
  // meant it fired for essentially NOTHING. Now scores min(cropped, uncropped)
  // against the index. Still falls through on near-duplicate arts where the
  // gap rule refuses to guess, and on phone photos of full-art holos, which a
  // 64-bit global hash genuinely cannot resolve.
  try {
    if (window.CardResellFastPath && typeof window.CardResellFastPath.scanFile === 'function') {
      statusEl.textContent = 'Matching against catalog\u2026';
      const fp = await window.CardResellFastPath.scanFile(file);
      window._lastFastpathResult = fp; // reused by LLM-shortlist rerank
      if (fp && fp.hit && fp.card) {
        const c = fp.card;
        // 2026-08-22: FastPath now covers Pokemon + MTG. Route hydration by game.
        const fpGame = c.game || 'pokemon';
        console.log(`[scan] fastpath HIT (${fp.totalMs}ms, dist=${fp.distance}, game=${fpGame}): ${c.card_name} ${c.set_name} #${c.card_number}`);

        // Preload hires image so "View Card" opens instantly.
        try { const pre = new Image(); pre.src = c.image_large; } catch(_) {}

        // Warm the detail endpoint so downstream tap-through hits browser cache.
        try {
          if (fpGame === 'pokemon') {
            fetch('https://api.pokemontcg.io/v2/cards/' + encodeURIComponent(c.id)).catch(()=>{});
          } else if (fpGame === 'mtg') {
            fetch('https://api.scryfall.com/cards/' + encodeURIComponent(c.id)).catch(()=>{});
          }
        } catch(_) {}

        // Swap the preview thumb to the CLEAN catalog small image so the user
        // sees the correctly-identified card art, not their phone photo.
        try { prevImg.src = c.image_small; } catch(_) {}

        // Paint success state exactly like the LLM path does.
        const detailLine = [c.set_name, c.rarity].filter(Boolean).join(' \u00b7 ');
        statusEl.innerHTML = '<span style="color:#4ade80">\u2713 ' + c.card_name +
          (c.card_number ? ' #' + c.card_number : '') + '</span>' +
          '<br><span style="font-size:.8rem;opacity:.7">' + detailLine + '</span>' +
          '<br><span style="font-size:.65rem;opacity:.45">Matched instantly \u2022 no credit used</span>';
        resultEl.innerHTML = '';
        showScanGradeCTA(c.card_name, '', null);
        window._scanTargetNumber = c.card_number;
        window._scanTargetName   = c.card_name;
        window._scanTargetGrader = '';
        window._scanTargetGrade  = null;
        window._pendingScanBannerCard = c.card_name;
        window._pendingIdScanCard = {
          name: c.card_name, number: c.card_number, setName: c.set_name,
          setCode: c.set_code, groundedId: c.id, rarity: c.rarity, hp: '',
          cardType: fpGame, sport: '', year: '', isJapanese: false, jpName: '',
        };
        try { _persistLastIdentified(window._pendingIdScanCard); } catch(_) {}
        URL.revokeObjectURL(objectUrl);
        const spinnerFp = document.getElementById('scanSpinner');
        if (spinnerFp) spinnerFp.style.display = 'none';
        const badgeFp = document.getElementById('scanSuccessBadge');
        if (badgeFp) badgeFp.style.display = 'flex';
        _setScanBtns('success');
        // 2026-08-21: auto-advance to card view on confident fastpath hit.
        // User confirmed they want the manual "View Card Prices" click gone.
        _scheduleScanAutoAdvance();
        return;
      } else if (fp) {
        console.log(`[scan] fastpath MISS (${fp.totalMs}ms, ${fp.reason}) — using LLM`);
      }
    }
  } catch(fpErr) {
    console.warn('[scan] fastpath error, falling back to LLM:', fpErr);
  }

  statusEl.textContent = 'Identifying card\u2026';

  // Compress image before sending — resize to max 1200px to stay under payload limits
  // 2026-08-22: single/rapid scan now matches bulk — no client-crop, higher
  // quality, larger max edge. Client-crop was locking onto shadows/hand
  // highlights on ~25% of single-scan photos (esp. dark MTG cards held in
  // hand against busy backgrounds), sending misaligned/dark tiles to Ximilar
  // and causing 'Card not recognized' on clearly readable photos.
  // The photo-qc.js gates upstream already reject actually-bad photos.
  const imageBase64 = await compressImage(file, 1200, { skipCrop: true, quality: 0.90 });
  const idToken = window._googleIdToken || '';

  // 2026-08-20: stash the front-of-card image so View Card / View PSA X price
  // after Deep Grade can re-identify via Ximilar (SOLE source of ID truth)
  // and load the exact card by grounded_id — no pokemontcg.io fuzzy matching.
  try { window._lastScanFrontBase64 = imageBase64; } catch(_){}

  try {
    const response = await fetch('/api/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + idToken
      },
      body: JSON.stringify({
        imageBase64,
        mimeType: 'image/jpeg',
        email: window.googleUser?.email || window._userEmail || '',
        googleSub: window.googleUser?.sub || window._googleSub || '',
      })
    });

    if (response.status === 401) {
      window._googleIdToken = null;
      statusEl.innerHTML = '<span style="color:#f87171">Sign-in expired. Please sign in again.</span>';
      resultEl.innerHTML = '<button onclick="cancelScan();setTimeout(()=>document.getElementById(\'googleSignInBtn\')?.click(),100)" style="margin-top:.5rem;background:var(--gold);color:#000;border:none;border-radius:8px;padding:.55rem 1.4rem;font-weight:700;font-size:.88rem;cursor:pointer">Sign in with Google</button>';
      return;
    }

    if (response.status === 402) {
      // 2026-09-02 (CR-021): out of credits → shop, not the plan chooser.
      const spinner4 = document.getElementById('scanSpinner');
      if (spinner4) spinner4.style.display = 'none';
      cancelScan();
      openShop('id', 'id_scan_402');
      return;
    }

    if (!response.ok) {
      let errMsg = 'Scan failed. Try a clearer photo.';
      try { const e = await response.json(); errMsg = e.error || errMsg; } catch(e) {}
      throw new Error(errMsg);
    }

    const data = await response.json();

    // Low-confidence path: server returned top 2–3 candidates and refunded the credit.
    // Show a picker; on user selection, apply that card as the ID (no extra credit charge
    // since the debit already happened on the confirmed pick via the second scan? —
    // in this build we accept the picked candidate directly. The credit is refunded on
    // the low-confidence response, but selecting a candidate consumes the identification.
    // To keep credit math consistent with intent ("credits only debit after user selection"),
    // we re-deduct 1 ID credit locally via a lightweight decrement endpoint AFTER the user picks.
    if (data.needsPicker && Array.isArray(data.candidates) && data.candidates.length >= 2) {
      _renderScanCandidatesPicker(data.candidates, statusEl, resultEl, objectUrl);
      return;
    }

    const rawCardName = data.card_name   || '';
    const cardNumber  = data.card_number || '';
    const setName     = data.set_name    || '';
    const rarity      = data.rarity      || '';
    const hp          = data.hp          || '';
    const isJapanese  = data.is_japanese === true;
    const jpRawName   = (data.jp_name || '').trim();

    // 2026-08-20: instrument ID scan completion for the funnel.
    try {
      window.trackEvent && window.trackEvent('id_scan_completed', {
        identified:   !!rawCardName && data.identified !== false,
        card_type:    data.card_type || '',
        source:       data.source || '',
        tier:         window._userTier || 'free',
      });
    } catch(e) {}

    if (!rawCardName || data.identified === false) {
      // 2026-08-22: The next scan attempt should skip the dupe check.
      // A failed scan usually means the user will retry the same card
      // (better lighting, closer framing, different angle), and blocking
      // it as 'same card as last scan' turns a bad UX into a worse one.
      // Cleared implicitly by processScanImage() after one use.
      window._skipQCDupe = true;
      // 2026-08-19: Ximilar didn't recognize the card and we no longer
      // fall through to GPT vision (which used to hallucinate names).
      // 2026-08-21: BEFORE giving up, try OCR-then-catalog rescue.
      // If we get a name the game's authoritative catalog confirms,
      // hydrate the card view directly and skip the manual state.
      // Refund already happened server-side (identified=false) so this
      // rescue is free — either it works and the user is unblocked, or
      // we fall through to the same manual UI as before.
      // 2026-08-28: Generalized from MTG-only to all supported games via
      // _tryOCRRescue. Same pattern that saved Secrets of Strixhaven for
      // MTG now covers Pokémon, Yu-Gi-Oh!, Lorcana, and Pokémon JP too.
      const _rescueGame = (() => {
        // Prefer the explicit UI selection; fall back to Ximilar's card_type.
        const sel = (typeof activeGame !== 'undefined' && activeGame) ? String(activeGame).toLowerCase() : '';
        const xim = String(data.card_type || '').toLowerCase();
        const cand = sel || xim;
        // Normalize to the keys _tryOCRRescue expects.
        if (['mtg', 'magic'].includes(cand)) return 'mtg';
        if (['pokemon', 'pkmn'].includes(cand)) return 'pokemon';
        if (['pokemonjp', 'pokemon_jp', 'pokemon-jp', 'pkmnjp'].includes(cand)) return 'pokemonJP';
        if (['yugioh', 'yu-gi-oh', 'ygo'].includes(cand)) return 'yugioh';
        if (cand === 'lorcana') return 'lorcana';
        if (['onepiece', 'one-piece', 'one_piece'].includes(cand)) return 'onepiece';
        return null;
      })();
      if (_rescueGame && typeof _tryOCRRescue === 'function' && file) {
        statusEl.innerHTML = '<span style="color:#c4b5fd">Reading card name\u2026</span>';
        try {
          const rescued = await _tryOCRRescue(file, statusEl, _rescueGame);
          if (rescued && rescued.name) {
            statusEl.innerHTML = '<span style="color:#10b981">Recovered via text\u2026</span>';
            try {
              const _pending = {
                name: rescued.name,
                number: rescued.number || '',
                setName: rescued.setName || '',
                setCode: rescued.setCode || '',
                cardType: rescued.cardType || _rescueGame,
                imageUrl: rescued.imageUrl || '',
                pokemontcgId: rescued.pokemontcgId || '',
                _viaOCR: true,
              };
              // Route by game: Pokémon-family goes through the Pokémon exact
              // loader (queries pokemontcg.io by id); everything else uses
              // the non-Pokémon loader that auto-switches the game selector.
              const isPokemonFamily = (rescued.cardType === 'pokemon' || rescued.cardType === 'pokemonJP');
              if (isPokemonFamily && typeof _loadScannedCardExact === 'function') {
                _loadScannedCardExact(_pending);
              } else if (typeof _loadScannedNonPokemonCard === 'function') {
                _loadScannedNonPokemonCard(_pending);
              } else {
                _loadScannedCardExact(_pending);
              }
              const spinnerX2 = document.getElementById('scanSpinner');
              if (spinnerX2) spinnerX2.style.display = 'none';
              _setScanBtns('success');
              URL.revokeObjectURL(objectUrl);
              try { if (window.va) va('track', 'scan_ocr_rescue', { game: _rescueGame, name: rescued.name.slice(0, 40) }); } catch(_){}
              return;
            } catch(loadErr) {
              console.warn('[ocr-rescue] loadCard failed:', loadErr);
              // fall through to manual UI
            }
          }
        } catch(ocrErr) {
          console.warn('[ocr-rescue] failed:', ocrErr && ocrErr.message);
        }
      }
      // Show a proper "unidentified" state with a hint, refund badge,
      // and "Not my card" button so the user knows we tried and failed
      // honestly — not that we returned a wrong answer.
      // 2026-09-03: log the total miss. This branch was previously silent, so
      // repeated real-world failures (e.g. Mega Greninja ex full-art) left no
      // trace and could not be diagnosed. Record everything we know about WHY
      // so the next occurrence is actionable: the fastpath's best guess and
      // score, which model ran, and the server's own stated reason.
      try {
        const _fp = window._lastFastpathResult || null;
        _logScanMiss(null, {
          reason:      'unrecognized',
          scanReason:  String(data && (data.reason || data.error) || '').slice(0, 120),
          retakeHint:  String(data && data.retake_hint || '').slice(0, 160),
          modelUsed:   String(data && data.model_used || '').slice(0, 40),
          fpBestDist:  _fp && Number.isFinite(_fp.bestDist) ? _fp.bestDist : null,
          fpSecondDist: _fp && Number.isFinite(_fp.secondDist) ? _fp.secondDist : null,
          fpBestGuess: _fp && _fp.bestGuess
            ? String(_fp.bestGuess.card_name + ' | ' + _fp.bestGuess.set_name + ' #' + _fp.bestGuess.card_number).slice(0, 120)
            : '',
          fpBestId:    _fp && _fp.bestGuess ? String(_fp.bestGuess.id || '').slice(0, 40) : '',
          game:        String((typeof activeGame !== 'undefined' && activeGame) || '').slice(0, 20),
        });
      } catch(_) { /* logging must never break the failure UI */ }
      const hint = data.retake_hint || 'We couldn\u2019t identify this card. Try a sharper photo with the full card visible, no glare, on a plain background.';
      statusEl.innerHTML = '<span style="color:#fbbf24">\u26a0 Card not recognized</span>' +
        '<br><span style="font-size:.78rem;opacity:.75">' + esc(hint) + '</span>';
      resultEl.innerHTML = '<div style="font-size:.72rem;color:rgba(255,255,255,.55);margin-top:.4rem">Your ID credit was refunded automatically.</div>' +
        '<div style="display:flex;gap:.5rem;margin-top:.7rem;justify-content:center;flex-wrap:wrap">' +
          '<button onclick="cancelScan();openScanner()" style="background:var(--gold);color:#000;border:none;border-radius:8px;padding:.5rem 1.1rem;font-weight:700;font-size:.85rem;cursor:pointer">Try again</button>' +
          '<button onclick="cancelScan();document.getElementById(\'cardSearchInput\')?.focus()" style="background:transparent;border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:8px;padding:.5rem 1.1rem;font-weight:600;font-size:.85rem;cursor:pointer">Search by name</button>' +
        '</div>';
      // Suppress the graded upsell and hide the success badge on unidentified scans.
      showScanGradeCTA('', '', null, { suppressed: true });
      const spinnerX = document.getElementById('scanSpinner');
      if (spinnerX) spinnerX.style.display = 'none';
      const badgeX = document.getElementById('scanSuccessBadge');
      if (badgeX) badgeX.style.display = 'none';
      _setScanBtns('error');
      // 2026-08-25: The unidentified-state resultEl already renders its own
      // 'Try again' + 'Search by name' buttons above. Hide the generic
      // scanRetryBtn that _setScanBtns('error') would otherwise reveal so
      // we don't stack two 'Try again' buttons on top of each other.
      const _retryDup = document.getElementById('scanRetryBtn');
      if (_retryDup) _retryDup.style.display = 'none';
      URL.revokeObjectURL(objectUrl);
      return;
    }

    // 2026-08-18: Cross-TCG auto-switch.
    // If the scanned card belongs to a different TCG than what the user has
    // selected in the game picker, silently switch to the correct game so
    // the pricing pipeline can actually price it. Silent switch + toast so
    // the user isn't confused when the game selector changes on them.
    // Silent on sports (sports uses a different UI path).
    try {
      maybeAutoSwitchGameFromScan(data.card_type, isJapanese);
    } catch(e) { console.warn('[cross-tcg] auto-switch failed', e); }

    // ── LLM-shortlist rerank ──
    // LLM read the card name + number. Use that to narrow the 20k-card index
    // to ~5-30 candidates matching name+number, then rerank via pHash to pick
    // the exact printing/variant. This is what saves holo illustration rares:
    // pHash can't find them in 20k but easily distinguishes among 5.
    let rerankedGroundedId = data.grounded_id || '';
    let rerankedImageSmall = '';
    let rerankedImageLarge = '';
    let rerankedSetName    = '';
    let rerankedSetCode    = '';
    let rerankedNumber     = '';
    let rerankedRarity     = '';
    try {
      if (window.CardResellFastPath && rawCardName && !isJapanese && data.card_type !== 'sports') {
        const rerankStart = performance.now();
        // Load index (usually already cached from the fastpath attempt above)
        const idxAll = await window.CardResellFastPath.loadCardIndex().catch(() => null);
        if (idxAll && Array.isArray(idxAll)) {
          // Normalization helpers
          const norm       = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          // Number normalization: strip leading zeros AND alpha prefixes so
          // "SV199" == "199", "TG10/TG30" == "TG10" == "10". Ximilar and the
          // LLM sometimes return the raw printed number, sometimes the local
          // set-numeric part, and reprints/promos use letter prefixes
          // inconsistently across catalogs.
          const normNum    = s => {
            const clean = String(s || '').replace(/\/.*$/, '').trim();
            // strip leading zeros
            const noZeros = clean.replace(/^0+/, '') || clean;
            // strip leading alpha prefix (SV, TG, GG, SWSH, SM, etc.)
            const noPrefix = noZeros.replace(/^[a-z]+/i, '');
            return { full: noZeros.toLowerCase(), tail: noPrefix.toLowerCase() };
          };
          // Word-boundary name match: split into word tokens and require the
          // shorter side's tokens to be a subset of the longer side's tokens.
          // Prevents "Mew" matching "Mewtwo", "Zoroark" matching "Zoroark GX"
          // still works because tokens {zoroark} ⊆ {zoroark, gx}.
          const tokens = s => (s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
          const nameMatches = (a, b) => {
            const A = tokens(a), B = tokens(b);
            if (!A.length || !B.length) return false;
            const [small, big] = A.length <= B.length ? [A, B] : [B, A];
            const bigSet = new Set(big);
            return small.every(t => bigSet.has(t));
          };
          // Set-recency preference: newer set-id prefix wins reprint tiebreaks.
          // Rank (higher = newer): sv > swsh > sm > xy > bw > hgss > dp > ex > <legacy>.
          const setRank = sid => {
            const s = (sid || '').toLowerCase();
            if (s.startsWith('me'))   return 105; // Mega Evolution era (2025+)
            if (s.startsWith('zsv'))  return 102;
            if (s.startsWith('rsv'))  return 101;
            if (s.startsWith('sv'))   return 100;
            if (s.startsWith('swsh')) return 90;
            if (s.startsWith('sm'))   return 80;
            if (s.startsWith('xy'))   return 70;
            if (s.startsWith('bw'))   return 60;
            if (s.startsWith('hgss')) return 55;
            if (s.startsWith('col'))  return 52;
            if (s.startsWith('pl'))   return 50;
            if (s.startsWith('dp'))   return 48;
            if (s.startsWith('ex'))   return 40;
            return 10;
          };

          const llmName    = rawCardName || '';
          const llmNumRaw  = (cardNumber || '').replace(/\/.*$/, '').trim();
          const llmNum     = normNum(llmNumRaw);

          // Two-pass filter: strict (name + number) first, then name-only if
          // strict yields nothing (LLM sometimes hallucinates or drops the
          // number on holo art with intrusive backgrounds).
          const filterCands = requireNumber => idxAll.filter(c => {
            if (!nameMatches(c.n, llmName)) return false;
            if (requireNumber && llmNum.full) {
              const cnu = normNum(c.nu);
              if (cnu.full !== llmNum.full && cnu.tail !== llmNum.tail && cnu.full !== llmNum.tail && cnu.tail !== llmNum.full) return false;
            }
            return true;
          });

          let candidates = filterCands(true);
          let looseName = false;
          if (!candidates.length && llmNum.full) {
            // Number match failed — fall back to name-only. This catches
            // number OCR errors ("188" vs "166") and mis-boxed numbers.
            candidates = filterCands(false);
            looseName = true;
            console.log('[rerank] no strict match; retrying name-only:', candidates.length);
          }
          console.log('[rerank]', candidates.length, 'candidates match name="' + rawCardName + '" num="' + llmNumRaw + '"' + (looseName ? ' (name-only)' : ''));

          if (candidates.length === 1) {
            // Unambiguous — use it directly, no need to pHash
            const c = candidates[0];
            rerankedGroundedId = c.id;
            rerankedImageSmall = c.i;
            rerankedImageLarge = window.CardResellFastPath.deriveLargeUrl(c.i);
            rerankedSetName    = c.s;
            rerankedSetCode    = c.sc || '';
            rerankedNumber     = c.nu;
            rerankedRarity     = c.r || '';
            window._lastScanCandidates = [c];
            console.log('[rerank] EXACT match:', c.id, c.n, c.s);
          } else if (candidates.length >= 2) {
            // Cap for pHash cost — raised from 60 to 250 so common Pokemon
            // names (Pikachu, Charizard) still get reranked instead of
            // silently falling back to the LLM's guess.
            const RERANK_CAP = 250;
            if (candidates.length > RERANK_CAP) {
              // Deterministic trim: prefer newer sets so the picker still
              // shows relevant printings even when we can't hash them all.
              candidates.sort((a, b) => setRank(b.si) - setRank(a.si));
              candidates = candidates.slice(0, RERANK_CAP);
              console.log('[rerank] trimmed to', RERANK_CAP, 'newest candidates');
            }
            // Always stash all matching candidates for the local "Wrong card?" picker.
            window._lastScanCandidates = candidates.slice();
            // 2026-08-17: Ximilar-set trust pass BEFORE pHash rerank.
            // Prefer EXACT normalized-name match; fall back to bidirectional
            // includes only when no exact match exists. Prior version treated
            // "Base" as matching "Base Set", "Base Set 2", and "Legendary
            // Base" — causing wrong-reprint picks.
            let ximilarSetResolved = false;
            const normSet = s => norm(s);
            const ximilarSetNorm = normSet(setName);
            if (ximilarSetNorm) {
              // Pass 1: exact normalized-set match
              let setMatches = candidates.filter(c => normSet(c.s) === ximilarSetNorm);
              // Pass 2: strict bidirectional includes but require length ratio > 0.6
              // (so "base" matches "base set" but not "legendary base").
              if (!setMatches.length) {
                setMatches = candidates.filter(c => {
                  const cs = normSet(c.s);
                  if (!cs || !ximilarSetNorm) return false;
                  const short = cs.length < ximilarSetNorm.length ? cs : ximilarSetNorm;
                  const long  = cs.length < ximilarSetNorm.length ? ximilarSetNorm : cs;
                  if (!long.includes(short)) return false;
                  return (short.length / long.length) >= 0.6;
                });
              }
              if (setMatches.length === 1) {
                const c = setMatches[0];
                rerankedGroundedId = c.id;
                rerankedImageSmall = c.i;
                rerankedImageLarge = window.CardResellFastPath.deriveLargeUrl(c.i);
                rerankedSetName    = c.s;
                rerankedSetCode    = c.sc || '';
                rerankedNumber     = c.nu;
                rerankedRarity     = c.r || '';
                console.log('[rerank] Ximilar-set trust:', c.id, c.n, c.s, '(matched "' + setName + '")');
                ximilarSetResolved = true;
              } else if (setMatches.length > 1) {
                // Narrow candidates to Ximilar's set before pHash tiebreak.
                // This is the key fix for reprint collisions: even if pHash
                // ties Kyurem-EX across three sets, restricting to Ximilar's
                // set makes the tie moot.
                candidates = setMatches;
                console.log('[rerank] narrowed to', setMatches.length, 'candidates in set "' + setName + '"');
              }
            }
            // pHash tiebreak — only runs when Ximilar-set trust didn't resolve
            let ph, dh;
            const fpRes = window._lastFastpathResult;
            if (fpRes && fpRes.ph && fpRes.dh) {
              ph = fpRes.ph; dh = fpRes.dh;
            } else {
              // Rehash from the raw file — same crop pipeline
              try {
                const img = new Image();
                const urlR = URL.createObjectURL(file);
                await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = urlR; });
                URL.revokeObjectURL(urlR);
                const cnv = document.createElement('canvas');
                cnv.width = img.naturalWidth; cnv.height = img.naturalHeight;
                cnv.getContext('2d').drawImage(img, 0, 0);
                ph = window.CardResellFastPath.computePHash(cnv);
                dh = window.CardResellFastPath.computeDHash(cnv);
              } catch(_) {}
            }
            if (!ximilarSetResolved && ph && dh) {
              // Score every candidate; track top-2 for a tie-break and an
              // ambiguity signal we surface to the picker.
              const scored = candidates.map(c => ({
                c,
                d: window.CardResellFastPath.hamming(ph, c.p) * 2 +
                   window.CardResellFastPath.hamming(dh, c.d)
              }));
              scored.sort((a, b) => a.d - b.d || setRank(b.c.si) - setRank(a.c.si));
              const best = scored[0];
              const second = scored[1];
              const gap = second ? second.d - best.d : 999;
              // Ambiguous within 2 units → nudge toward newer set (reprint
              // collisions: same art shipped in swsh + bw sets both hash-tie).
              let picked = best;
              if (second && gap <= 2 && setRank(second.c.si) > setRank(best.c.si)) {
                picked = second;
                console.log('[rerank] reprint tiebreak: preferred newer set',
                            second.c.si, 'over', best.c.si, 'at gap=' + gap);
              }
              const b = picked.c;
              rerankedGroundedId = b.id;
              rerankedImageSmall = b.i;
              rerankedImageLarge = window.CardResellFastPath.deriveLargeUrl(b.i);
              rerankedSetName    = b.s;
              rerankedSetCode    = b.sc || '';
              rerankedNumber     = b.nu;
              rerankedRarity     = b.r || '';
              // Ambiguity signal — exposed so the picker can suggest
              // "Wrong card?" more prominently on close calls.
              window._lastScanAmbiguous = (gap < 4);
              console.log('[rerank] pHash pick (dist=' + picked.d + ' gap=' + gap + '):', b.id, b.n, b.s);
            }
          }
        }
        console.log('[rerank] took', (performance.now() - rerankStart).toFixed(0), 'ms');
      }
    } catch(rerankErr) {
      console.warn('[rerank] error, using LLM result as-is:', rerankErr);
    }

    // Preload the reranked hires image so "View Card" opens instantly.
    if (rerankedImageLarge) {
      try { const pre2 = new Image(); pre2.src = rerankedImageLarge; } catch(_) {}
      try { fetch('https://api.pokemontcg.io/v2/cards/' + encodeURIComponent(rerankedGroundedId)).catch(()=>{}); } catch(_) {}
      // Swap the preview thumb to the clean catalog small so the user sees the right art immediately.
      try { prevImg.src = rerankedImageSmall; } catch(_) {}
    }

    // 2026-08-15: for JP scans, the Vision model returns the English name in
    // card_name (e.g. "Vileplume") and the printed katakana in jp_name
    // (e.g. "\u30e9\u30d5\u30ec\u30b7\u30a2"). Cataloging + search uses the English
    // name plus a " (Japanese)" tag so eBay/TCGplayer/PokemonTCG.io queries
    // return real listings instead of zero-result katakana searches.
    const cardName = isJapanese
      ? (rawCardName.replace(/\s*\(Japanese\)\s*$/i, '').trim() + ' (Japanese)')
      : rawCardName;

    const displaySetName = rerankedSetName || setName;
    const displayRarity  = rerankedRarity  || rarity;
    const displayNumber  = rerankedNumber  || cardNumber;
    let detailLine = [displaySetName, displayRarity, hp ? hp + ' HP' : ''].filter(Boolean).join(' \u00b7 ');
    // Show the original katakana name in gray under the identified card so the
    // user knows we didn't lose that info.
    const jpSubline = (isJapanese && jpRawName && jpRawName !== rawCardName)
      ? '<br><span style="font-size:.7rem;opacity:.55">' + esc(jpRawName) + '</span>'
      : '';
    // 2026-08-19: If the ID is unreliable (low confidence, or missing
    // both set + card number, or blank card name), show an amber warning
    // header instead of the confident green checkmark. Prevents the
    // "\u2713 Power Patron Shadows of the End Times · Unknown set" flow that
    // reads as "we identified it" when we didn't.
    const _scanConfidence  = (data.confidence || '').toString().toLowerCase();
    const _hasSetSignal    = !!(displaySetName && !/^(unknown|n\/a|none)$/i.test(displaySetName));
    const _hasNumberSignal = !!(displayNumber && String(displayNumber).length <= 12);
    const _idIsReliable    = _scanConfidence !== 'low' && cardName && (_hasSetSignal || _hasNumberSignal);
    if (_idIsReliable) {
      // 2026-08-19: If grounding returned a canonical image (YGOProDeck),
      // show it inline as a small thumbnail so the user gets visual
      // confirmation of the ID instead of "trust us".
      const _groundImg = (data.image_url || '').trim();
      const _thumb = _groundImg
        ? '<img src="' + esc(_groundImg) + '" alt="" style="width:56px;height:auto;border-radius:4px;vertical-align:middle;margin-right:.5rem;box-shadow:0 2px 6px rgba(0,0,0,.4)" onerror="this.style.display=\'none\'">'
        : '';
      statusEl.innerHTML = _thumb + '<span style="color:#4ade80">\u2713 ' + cardName + (displayNumber ? ' #' + displayNumber : '') + '</span><br><span style="font-size:.8rem;opacity:.7">' + detailLine + '</span>' + jpSubline;
    } else {
      const _shownName = cardName || 'Card not recognized';
      const _detailAmber = displaySetName ? esc(displaySetName) : 'No confident match — try a clearer photo';
      statusEl.innerHTML = '<span style="color:#fbbf24">\u26a0 Low-confidence scan</span><br>' +
        '<span style="font-size:.85rem;opacity:.85">' + esc(_shownName) + '</span>' +
        '<br><span style="font-size:.75rem;opacity:.65">' + _detailAmber + '</span>' + jpSubline;
    }

    // Result area now hosts: (optional) glare/quality hint, plus "Not my card"
    // refund link. Rendered as HTML so we can style + wire the click handler.
    const scanId    = data.scan_id || '';
    const quality   = (data.image_quality || 'ok').toString();
    const glareHint = (data.retake_hint || '').toString();
    let resultHtml  = '';
    if (quality !== 'ok' && glareHint) {
      resultHtml += '<div style="margin-bottom:.5rem;padding:.5rem .7rem;background:rgba(250,204,21,.1);border:1px solid rgba(250,204,21,.35);border-radius:.5rem;color:#fde68a;font-size:.75rem;line-height:1.4;text-align:left">'
        + '<span style="font-weight:700">Photo tip:</span> ' + esc(glareHint)
        + '</div>';
    }
    if (scanId) {
      resultHtml += '<button id="scanRefundBtn" data-scan-id="' + esc(scanId) + '" '
        + 'style="background:transparent;border:1px solid rgba(255,255,255,.18);color:rgba(255,255,255,.55);font-size:.72rem;padding:.35rem .7rem;border-radius:.4rem;cursor:pointer;margin-top:.25rem">'
        + 'Not my card — refund credit</button>';
    }
    resultEl.innerHTML = resultHtml;

    // Wire the refund button (only rendered once per scan, so a per-element listener is fine).
    const refundBtn = document.getElementById('scanRefundBtn');
    if (refundBtn) refundBtn.addEventListener('click', () => _requestScanRefund(refundBtn));

    // 2026-08-19: Suppress the Get-It-Graded upsell when the ID is
    // unreliable — same reliability check the header uses. Prevents
    // the confusing "Unknown set — Get it officially graded!" flow.
    if (_idIsReliable) {
      showScanGradeCTA(cardName, '', null);
    } else {
      showScanGradeCTA('', '', null, { suppressed: true });
    }

    window._scanTargetNumber = cardNumber;
    window._scanTargetName   = cardName;
    window._scanTargetGrader = '';
    window._scanTargetGrade  = null;
    window._pendingScanBannerCard = cardName;

    // Silently load the card into the calculator in the background
    // so when the user closes the scan overlay it's already selected.
    // Do NOT auto-open catalog — let the user decide what to do next.
    // 2026-08-16: pass through the server-side grounded_id so the client
    // can shortcut its own pokemontcg.io fuzzy search and load the exact
    // card the server already resolved. Prevents "scan Greninja, load
    // Charizard" downstream mismatches when set/number are ambiguous.
    // Prefer reranked values (pHash-verified match) over the raw LLM output.
    // The LLM often reads the name right but picks a wrong set; rerank fixes that.
    window._pendingIdScanCard = {
      name:       cardName,
      number:     rerankedNumber   || cardNumber,
      setName:    rerankedSetName  || setName,
      setCode:    rerankedSetCode  || data.set_code || '',
      groundedId: rerankedGroundedId || data.grounded_id || '',
      rarity:     rerankedRarity   || rarity,
      hp,
      cardType: data.card_type || 'pokemon',
      sport: data.sport || '', year: data.year || '',
      isJapanese, jpName: jpRawName,
      // 2026-08-19: forward the YGO-grounded image URL so the YGO post-scan
      // loader can render the card image immediately, without waiting for
      // the search dropdown auto-select to pick a result whose set_code
      // matches the passcode we passed in.
      imageUrl: data.image_url || rerankedImageLarge || rerankedImageSmall || '',
    };
    try { _persistLastIdentified(window._pendingIdScanCard); } catch(_) {}
    URL.revokeObjectURL(objectUrl);

    // Show success state — hide spinner, show View Card + Scan Another
    const spinner2 = document.getElementById('scanSpinner');
    if (spinner2) spinner2.style.display = 'none';
    const badge = document.getElementById('scanSuccessBadge');
    if (badge) badge.style.display = 'flex';
    _setScanBtns('success');
    // 2026-08-21: auto-advance to card view on confident LLM/Ximilar ID.
    // Skipped when the header rendered the amber "low-confidence" state
    // — there we want the user to review before we swap the panel.
    if (_idIsReliable) _scheduleScanAutoAdvance();
    // Nudge when credits are running low (≤ 3 remaining)
    if (!window._isPro) {
      const remaining = (window._idScanCredits || 0);
      if (remaining <= 3 && remaining > 0) {
        // 2026-09-02 (CR-021): copy used to say "top up in Settings", but the
        // Settings gear is hidden below 480px. Point at the Shop button, which
        // is visible at every width.
        setTimeout(() => showToast(remaining + ' ID scan credit' + (remaining===1?'':'s') + ' left — tap 🛒 Shop to top up ⚡', 'gold'), 1200);
      } else if (remaining === 0) {
        setTimeout(() => showToast('Out of ID scan credits — tap 🛒 Shop to buy more', 'gold'), 1200);
      }
    }

  } catch(err) {
    console.error('Scan error:', err);
    const spinner3 = document.getElementById('scanSpinner');
    if (spinner3) spinner3.style.display = 'none';
    statusEl.innerHTML = '<span style="color:#f87171">' + (err.message || 'Could not identify the card.') + '</span>';
    resultEl.innerHTML = '<span style="font-size:.75rem;color:rgba(255,255,255,.4)">Try better lighting or a closer shot.</span>';
    _setScanBtns('error');
  }
}

// ── Grade scan gate — check credits first, show pack options if needed ──
function openGradeScanGate() {
  if (!window.googleUser) {
    showToast('Sign in with Google first to use the grader');
    return;
  }

  // Credit-saver warning: if the current card is silent-tier for grade
  // opportunity, tell the user grading probably doesn't pencil out before
  // they burn a credit.
  const gOpp = window._lastGradeOpportunity;
  if (gOpp && gOpp.recommendation === 'sell_raw' && gOpp.rawPrice != null) {
    const rawStr = gOpp.rawPrice < 2 ? 'under $2' : `~$${Number(gOpp.rawPrice).toFixed(2)}`;
    const est = gOpp.expectedProfit != null ? Number(gOpp.expectedProfit).toFixed(0) : '?';
    const msg = est !== '?' && Number(est) < 0
      ? `Heads up — this raw card is ${rawStr}. Even at PSA 10 the math shows about $${est} profit after grading fees. Grade anyway?`
      : `Heads up — this raw card is ${rawStr}. Grading may not be profitable here. Grade anyway?`;
    if (!confirm(msg)) return;
  }

  const credits = (window._scanCredits || 0) + (window._freeScansLeft || 0);
  if (credits > 0) {
    // Has credits — show tier picker (Quick vs Deep)
    openGradeTierPicker();
    return;
  }
  // No credits — send them somewhere they can actually buy grades.
  // 2026-09-02 (CR-021): was openPricingModal, which only sells subscriptions.
  openShop('grade', 'grade_scan_gate');
}

// ── Grade tier picker (Quick vs Deep) ──
function openGradeTierPicker() {
  const overlay = document.getElementById('gradeTierOverlay');
  const line    = document.getElementById('gradeTierCreditLine');
  const quickBtn= document.getElementById('tierQuickBtn');
  const deepBtn = document.getElementById('tierDeepBtn');
  const credits = (window._scanCredits || 0) + (window._freeScansLeft || 0);
  if (line) line.textContent = 'You have ' + credits + ' grade credit' + (credits === 1 ? '' : 's') + ' available.';
  // Grey out Deep Grade if fewer than 2 credits
  if (deepBtn) {
    if (credits < 2) {
      deepBtn.style.opacity = '.5';
      deepBtn.style.pointerEvents = 'none';
      deepBtn.title = 'Needs 2 credits';
    } else {
      deepBtn.style.opacity = '';
      deepBtn.style.pointerEvents = '';
      deepBtn.title = '';
    }
  }
  if (quickBtn) {
    if (credits < 1) {
      quickBtn.style.opacity = '.5';
      quickBtn.style.pointerEvents = 'none';
    } else {
      quickBtn.style.opacity = '';
      quickBtn.style.pointerEvents = '';
    }
  }
  overlay.classList.add('open');
}

function closeGradeTier(evt) {
  if (evt && evt.target !== document.getElementById('gradeTierOverlay')) return;
  document.getElementById('gradeTierOverlay').classList.remove('open');
}

// ── Photo Tips modal ─────────────────────────────────────────
// LocalStorage keys:
//   cr_photoTips_seen           — user has seen the tips at least once
//   cr_photoTips_alwaysShow     — user opted into seeing tips every Deep Grade
// Pending-action tracking so the modal can chain into the correct scan flow.
window._photoTipsPending = null; // 'quick' | 'deep' | null

function _photoTipsSeen()      { try { return localStorage.getItem('cr_photoTips_seen') === '1'; } catch(_) { return false; } }
function _photoTipsAlways()    { try { return localStorage.getItem('cr_photoTips_alwaysShow') === '1'; } catch(_) { return false; } }
function _markPhotoTipsSeen()  { try { localStorage.setItem('cr_photoTips_seen', '1'); } catch(_) {} }
function _setPhotoTipsAlways(v){ try { v ? localStorage.setItem('cr_photoTips_alwaysShow', '1') : localStorage.removeItem('cr_photoTips_alwaysShow'); } catch(_) {} }

// Show the tips modal. Pass a pending action ('quick'|'deep') to chain into
// the scan flow when the user taps "Got it — start scanning".
function openPhotoTipsModal(pending) {
  window._photoTipsPending = pending === 'quick' || pending === 'deep' ? pending : null;
  document.querySelectorAll('#photoTipsOverlay img[data-src]').forEach(img => {
    img.src = img.dataset.src;
    img.removeAttribute('data-src');
  });
  // Sync "always show" checkbox with saved pref
  const cb = document.getElementById('photoTipsAutoShow');
  if (cb) cb.checked = _photoTipsAlways();
  // Adjust CTA copy based on pending action
  const btn = document.getElementById('photoTipsContinueBtn');
  if (btn) {
    if (window._photoTipsPending === 'deep')  btn.textContent = 'Got it — start Deep Grade';
    else if (window._photoTipsPending === 'quick') btn.textContent = 'Got it — start Quick Grade';
    else                                       btn.textContent = 'Got it — thanks';
  }
  const ov = document.getElementById('photoTipsOverlay');
  if (ov) ov.classList.add('open');
}

function closePhotoTipsModal(evt) {
  if (evt && evt.target !== document.getElementById('photoTipsOverlay')) return;
  const ov = document.getElementById('photoTipsOverlay');
  if (ov) ov.classList.remove('open');
  // Persist the "always show" preference on close too (in case user didn't tap Got it)
  const cb = document.getElementById('photoTipsAutoShow');
  if (cb) _setPhotoTipsAlways(!!cb.checked);
  window._photoTipsPending = null;
}

// User acknowledged tips → mark seen, save preference, and chain into the
// pending scan flow if one was set.
function acknowledgePhotoTipsAndContinue() {
  _markPhotoTipsSeen();
  const cb = document.getElementById('photoTipsAutoShow');
  if (cb) _setPhotoTipsAlways(!!cb.checked);
  const ov = document.getElementById('photoTipsOverlay');
  if (ov) ov.classList.remove('open');
  const p = window._photoTipsPending;
  window._photoTipsPending = null;
  if (p === 'deep')  return _launchDeepGrade();
  if (p === 'quick') return _launchQuickGrade();
}

// Internal launchers — bypass the tips gate.
function _launchQuickGrade() {
  window._gradeIsDeep = false;
  window._gradeEdges = {}; // no edges for quick
  const overlay = document.getElementById('gradeTierOverlay');
  if (overlay) overlay.classList.remove('open');
  _startGradeFrontCapture();
}

function _launchDeepGrade() {
  window._gradeIsDeep = true;
  window._gradeEdges = {}; // reset edge collection
  const overlay = document.getElementById('gradeTierOverlay');
  if (overlay) overlay.classList.remove('open');
  _startGradeFrontCapture();
}

// 2026-08-30: Route Quick / Deep Grade front photo through the live camera
// overlay so users see the same dashed-frame guide + live QA hints (dark,
// bright, blur, glare, out-of-frame) as Rapid Scan. If getUserMedia fails
// or the user cancels, fall through to the native camera picker so no
// hardware combo is left without a path.
function _startGradeFrontCapture() {
  openLiveCameraCapture({
    label: 'Front photo',
    sublabel: window._gradeIsDeep ? 'Deep Grade \u2014 Step 1 of 3+' : 'Quick Grade \u2014 Step 1 of 2',
    onCapture: (file) => {
      // Feed the captured File straight into the existing pipeline so all
      // downstream logic (compress \u2192 stash \u2192 prompt for back photo) works unchanged.
      processGradeImage({ files: [file] });
    },
    onCancel: (reason) => {
      // On permission-denied or unsupported, silently fall back to the native
      // <input capture=environment> flow. On explicit user cancel, do nothing
      // \u2014 they backed out on purpose.
      if (reason === 'permission-denied' || reason === 'unsupported') {
        document.getElementById('gradeFileInput').click();
      }
    }
  });
}

// 2026-08-30: Same treatment for the BACK photo prompt \u2014 replaces the inline
// button's document.getElementById('gradeBackFileInput').click() with a live
// camera capture. Called from the "Take Back Photo" button in processGradeImage.
function _startGradeBackCapture() {
  openLiveCameraCapture({
    label: 'Back photo',
    sublabel: window._gradeIsDeep ? 'Deep Grade \u2014 Step 2 of 3+' : 'Quick Grade \u2014 Step 2 of 2',
    onCapture: (file) => { processGradeBack({ files: [file] }); },
    onCancel: (reason) => {
      if (reason === 'permission-denied' || reason === 'unsupported') {
        document.getElementById('gradeBackFileInput').click();
      }
    }
  });
}

// 2026-09-01: Single Scan (ID) now uses the same live-camera overlay as Rapid
// Scan and Grade capture, so users get the dashed card-aspect frame + zoom +
// real-time QA feedback instead of the raw phone camera. Falls back to the
// native <input capture=environment> flow on permission-denied or unsupported.
function _startSingleScanCapture() {
  openLiveCameraCapture({
    label: 'Scan a card',
    sublabel: 'Single Scan \u2014 1 ID credit',
    onCapture: (file) => { processScanImage({ files: [file] }); },
    onCancel: (reason) => {
      if (reason === 'permission-denied' || reason === 'unsupported') {
        document.getElementById('scanFileInput').click();
      }
    }
  });
}

// 2026-08-30: Deep Grade edge capture \u2014 four possible edges (top/bottom/left/right).
// Each edge button in showDeepGradeEdgeUI() calls this with its edgeKey. On success
// we route the File into the existing processGradeEdge(input, edgeKey) which stashes
// it in window._gradeEdges and re-renders the edge UI.
function _startGradeEdgeCapture(edgeKey) {
  const nice = { top: 'Top edge', bottom: 'Bottom edge', left: 'Left edge', right: 'Right edge' }[edgeKey] || 'Edge';
  openLiveCameraCapture({
    label: nice,
    sublabel: 'Deep Grade \u2014 edge close-up',
    onCapture: (file) => { processGradeEdge({ files: [file], value: '' }, edgeKey); },
    onCancel: (reason) => {
      if (reason === 'permission-denied' || reason === 'unsupported') {
        const inputId = 'gradeEdge' + edgeKey.charAt(0).toUpperCase() + edgeKey.slice(1) + 'Input';
        const el = document.getElementById(inputId);
        if (el) el.click();
      }
    }
  });
}

// Public entry points from the tier picker.
// Deep Grade: gate on first-ever use OR when the user opted into "always show".
// Quick Grade: no gate (fast path — it's the low-friction tier).
function startQuickGrade() {
  _launchQuickGrade();
}

function startDeepGrade() {
  // 2026-08-19: Removed forced first-time photo-tips gate. Users found it
  // paternalistic. Tips are still one tap away via:
  //   • The "📸 Photo tips" button on the tier picker itself
  //   • The "📸 Show photo tips" link on the edge-capture screen
  //   • The "Show these tips before every Deep Grade" opt-in checkbox
  //     (respected below — users who WANT the reminder every time still get it)
  if (_photoTipsAlways()) {
    const overlay = document.getElementById('gradeTierOverlay');
    if (overlay) overlay.classList.remove('open');
    openPhotoTipsModal('deep');
    return;
  }
  _launchDeepGrade();
}

function _setScanGateMode(mode) {
  // mode: 'identify' | 'grade'
  const icon    = document.getElementById('scanGateIcon');
  const title   = document.getElementById('scanGateTitle');
  const sub     = document.getElementById('scanGateSub');
  const packs   = document.getElementById('scanGatePacksSection');
  const identify= document.getElementById('scanGateIdentifySection');
  if (mode === 'grade') {
    if (icon)     icon.textContent = '🏅';
    if (title)    title.textContent = 'AI Grading Estimate';
    if (sub)      sub.innerHTML    = 'Front &amp; back photo — centering, corners, edges, surface + PSA/BGS/CGC grade estimate.';
    const hintG = document.getElementById('scanGateHint');
    if (hintG) hintG.style.display = 'none';
    if (packs)    packs.style.display    = '';
    if (identify) identify.style.display = 'none';
  } else {
    if (icon)     icon.innerHTML   = '&#128247;';
    if (title)    title.textContent = 'Card Identification Scanner';
    if (sub)      sub.innerHTML    = 'Take a photo of any card &mdash; our AI identifies it instantly and pulls live market prices for Pok\u00e9mon, Magic, Yu-Gi-Oh!, Lorcana &amp; One Piece. Sports cards too — scan one and pick your exact parallel for a graded guide price.';
    const hint = document.getElementById('scanGateHint');
    if (hint) hint.style.display = '';
    if (packs)    packs.style.display    = 'none';
    if (identify) identify.style.display = '';
  }
}

// ── Process grade image ──
// ── Grade scan — stored front image ──
window._gradeFrontBase64 = null;
window._gradeFrontUrl    = null;

// Step 1: Front photo captured
async function processGradeImage(input) {
  const file = input.files[0];
  if (!file) return;

  const fileError = _validateScanFile(file);
  if (fileError) {
    if (typeof showToast === 'function') showToast(fileError, 'info');
    input.value = '';
    return;
  }

  if (!window.googleUser) { openGradeScanGate(); return; }

  if (!window._googleIdToken) {
    const ov = document.getElementById('scanOverlay');
    ov.style.display = 'flex';
    document.getElementById('scanStatus').innerHTML = '<span style="color:#f87171">Sign-in expired. Please sign in again.</span>';
    document.getElementById('scanResult').innerHTML = '<button onclick="cancelScan();setTimeout(()=>document.getElementById(\'googleSignInBtn\')?.click(),100)" style="margin-top:.5rem;background:var(--gold);color:#000;border:none;border-radius:8px;padding:.55rem 1.4rem;font-weight:700;font-size:.88rem;cursor:pointer">Sign in with Google</button>';
    return;
  }

  const overlay  = document.getElementById('scanOverlay');
  const statusEl = document.getElementById('scanStatus');
  const resultEl = document.getElementById('scanResult');
  const prevWrap = document.getElementById('scanPreviewWrap');
  const prevImg  = document.getElementById('scanPreviewImg');

  overlay.style.display = 'flex';
  _dialogOpened('scanOverlay');
  resultEl.textContent = '';

  const frontUrl = URL.createObjectURL(file);
  prevImg.src = frontUrl;
  prevWrap.style.display = 'block';

  window._gradeFrontBase64 = await compressImage(file, 1000);
  window._gradeFrontUrl    = frontUrl;

  const stepLabel = window._gradeIsDeep ? ' <span style="font-size:.7rem;color:var(--gold-text)">(Step 1 of 3+)</span>' : ' <span style="font-size:.7rem;color:rgba(255,255,255,.5)">(Step 1 of 2)</span>';
  statusEl.innerHTML = '<span style="color:#4ade80">\u2713 Front captured</span>' + stepLabel + '<br><span style="font-size:.82rem;opacity:.8">Now flip it \u2014 take the BACK photo</span>';
  resultEl.innerHTML = '<button onclick="_startGradeBackCapture()" style="margin-top:.25rem;background:var(--gold);color:#000;border:none;border-radius:10px;padding:.6rem 1.5rem;font-weight:800;font-size:.9rem;cursor:pointer">\uD83D\uDCF7 Take Back Photo</button>';
}

// Step 2: Back photo captured
// - Quick mode: submit immediately (existing behavior)
// - Deep mode: store back, show edge-capture UI (user picks 2-4 edges)
async function processGradeBack(input) {
  const file = input.files[0];
  if (!file) return;

  const fileError = _validateScanFile(file);
  if (fileError) {
    if (typeof showToast === 'function') showToast(fileError, 'info');
    input.value = '';
    return;
  }

  const statusEl = document.getElementById('scanStatus');
  const resultEl = document.getElementById('scanResult');

  const frontBase64 = window._gradeFrontBase64;
  if (!frontBase64) {
    statusEl.textContent = 'Front photo missing. Please start over.';
    return;
  }

  const backBase64 = await compressImage(file, 1000);
  window._gradeBackBase64 = backBase64;

  // Fork based on tier selected
  if (window._gradeIsDeep) {
    // Deep Grade — show edge capture UI, don't submit yet
    showDeepGradeEdgeUI();
    return;
  }

  // Quick Grade — submit immediately
  await submitGradeScan(false);
}

// ── Deep Grade edge capture UI ──
function showDeepGradeEdgeUI() {
  const statusEl = document.getElementById('scanStatus');
  const resultEl = document.getElementById('scanResult');
  const edges = window._gradeEdges || {};
  const count = Object.keys(edges).length;
  const min = 2, max = 4;

  statusEl.innerHTML =
    '<span style="color:#4ade80">\u2713 Front + back captured</span> <span style="font-size:.7rem;color:var(--gold-text)">(Step 2 of 3)</span>' +
    '<br><span style="font-size:.85rem;color:#fff;font-weight:700;margin-top:.35rem;display:inline-block">Add edge photos — pick <strong>at least 2</strong>, up to 4</span>' +
    '<br><span style="font-size:.72rem;color:rgba(255,255,255,.55);line-height:1.45">Hold the card so the light hits one edge at a time. Fill the frame with just that edge — don\'t worry about the whole card.</span>' +
    '<br><a href="#" onclick="event.preventDefault();openPhotoTipsModal(null);return false;" style="display:inline-block;margin-top:.4rem;font-size:.7rem;color:var(--gold-text);text-decoration:underline;font-weight:600">📸 Show photo tips</a>';

  const edgeBtn = (key, label, emoji, tip) => {
    const done = !!(edges[key] || edges[key.toLowerCase()]);
    const bg = done ? 'rgba(74,222,128,.15)' : 'rgba(255,255,255,.06)';
    const bord = done ? '1px solid rgba(74,222,128,.5)' : '1px solid rgba(255,255,255,.15)';
    const check = done ? '<span style="color:#4ade80;font-weight:900">\u2713 </span>' : '';
    const doneLabel = done ? ' <span style="font-size:.65rem;color:#4ade80">CAPTURED — tap to retake</span>' : '';
    return '<button onclick="_startGradeEdgeCapture(\'' + key.toLowerCase() + '\')" ' +
      'style="padding:.65rem .7rem;background:' + bg + ';color:#fff;border:' + bord + ';border-radius:10px;font-size:.8rem;text-align:left;cursor:pointer;width:100%;line-height:1.35">' +
      check + emoji + ' <strong>' + label + '</strong>' + doneLabel +
      '<br><span style="font-size:.66rem;color:rgba(255,255,255,.5);font-weight:500">' + tip + '</span>' +
      '</button>';
  };

  const progressColor = count >= min ? '#4ade80' : count === 1 ? '#facc15' : 'rgba(255,255,255,.4)';
  const progressLabel = count === 0 ? 'Need 2 more' : count === 1 ? 'Need 1 more' : count + ' captured — ready to submit';

  resultEl.innerHTML =
    '<div style="display:flex;flex-direction:column;gap:.4rem;margin:.35rem 0 .5rem;text-align:left">' +
      edgeBtn('Top',    'Top edge',    '\u2B06\uFE0F', 'Rotate the card so the top edge faces the camera') +
      edgeBtn('Bottom', 'Bottom edge', '\u2B07\uFE0F', 'Flip to the bottom edge — look for dings or chips') +
      edgeBtn('Left',   'Left edge',   '\u2B05\uFE0F', 'Left side — check for nicks along the border') +
      edgeBtn('Right',  'Right edge',  '\u27A1\uFE0F', 'Right side — last edge, then submit') +
    '</div>' +
    '<div style="font-size:.75rem;color:' + progressColor + ';font-weight:700;text-align:center;margin:.3rem 0 .5rem">' + count + ' / ' + max + ' edges captured — ' + progressLabel + '</div>' +
    (count >= min
      ? '<button onclick="submitDeepGrade()" style="width:100%;padding:.75rem 1rem;background:var(--gold);color:#000;border:none;border-radius:10px;font-weight:900;font-size:.95rem;cursor:pointer">\u2605 Submit Deep Grade — 2 credits</button>'
      : '<button disabled style="width:100%;padding:.75rem 1rem;background:rgba(255,255,255,.08);color:rgba(255,255,255,.35);border:none;border-radius:10px;font-weight:800;font-size:.9rem;cursor:not-allowed">Add ' + (min - count) + ' more edge' + (min - count === 1 ? '' : 's') + ' to submit</button>') +
    '<button onclick="cancelDeepGrade()" style="margin-top:.5rem;width:100%;padding:.5rem;background:transparent;color:rgba(255,255,255,.5);border:none;font-size:.75rem;cursor:pointer;text-decoration:underline">Cancel — don\'t charge me</button>';
}

// Called when user taps an edge photo button
async function processGradeEdge(input, edgeKey) {
  const file = input.files[0];
  if (!file) return;

  const fileError = _validateScanFile(file);
  if (fileError) {
    if (typeof showToast === 'function') showToast(fileError, 'info');
    input.value = '';
    return;
  }
  window._gradeEdges = window._gradeEdges || {};
  const b64 = await compressImage(file, 1000);
  window._gradeEdges[edgeKey] = b64;
  // Reset input so re-picking the same edge works
  input.value = '';
  // Re-render the edge UI to show new checkmarks + progress
  showDeepGradeEdgeUI();
}

function cancelDeepGrade() {
  window._gradeFrontBase64 = null;
  window._gradeBackBase64 = null;
  window._gradeEdges = {};
  window._gradeIsDeep = false;
  if (window._gradeFrontUrl) { URL.revokeObjectURL(window._gradeFrontUrl); window._gradeFrontUrl = null; }
  cancelScan();
}

async function submitDeepGrade() {
  const edges = window._gradeEdges || {};
  const count = Object.keys(edges).length;
  if (count < 2) {
    showToast('Need at least 2 edge photos for Deep Grade');
    return;
  }
  await submitGradeScan(true);
}

// ── Shared submit path — handles both Quick and Deep Grade ──
async function submitGradeScan(deepGrade) {
  const statusEl = document.getElementById('scanStatus');
  const resultEl = document.getElementById('scanResult');
  const frontBase64 = window._gradeFrontBase64;
  const backBase64  = window._gradeBackBase64;

  if (!frontBase64 || !backBase64) {
    statusEl.textContent = 'Photos missing. Please start over.';
    return;
  }

  const analyzingCount = deepGrade
    ? 'front, back + ' + Object.keys(window._gradeEdges || {}).length + ' edges'
    : 'front + back';
  statusEl.innerHTML = '<span style="color:var(--gold-text);font-weight:800">' +
    (deepGrade ? '\uD83D\uDD0D Deep Grade Analysis' : '\u2605 Estimated Grade Scanner') +
    '</span><br><span style="font-size:.8rem;opacity:.7">Analyzing ' + analyzingCount + '\u2026 this may take 10\u201320s</span>';
  resultEl.innerHTML = '<div style="width:100%;height:4px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden"><div style="height:100%;width:35%;background:var(--gold);border-radius:99px;animation:pulse 1.5s ease-in-out infinite"></div></div>';

  const idToken = window._googleIdToken || '';
  const edges = window._gradeEdges || {};

  const body = {
    imageBase64: frontBase64,
    mimeType: 'image/jpeg',
    backBase64,
    backMimeType: 'image/jpeg',
    mode: 'grade',
    cardName: selectedCard?.name || window._lastScanCardName || '',
    cardNumber: selectedCard?.number || window._scanTargetNumber || '',
    setName: selectedCard?.setName || '',
    email: window.googleUser?.email || window._userEmail || '',
    googleSub: window.googleUser?.sub || window._googleSub || '',
  };

  if (deepGrade) {
    body.deepGrade = true;
    // processGradeEdge() stores keys lowercase ('top'/'bottom'/'left'/'right'),
    // but some code paths historically used capitalized keys — accept either.
    const top    = edges.top    || edges.Top;
    const bottom = edges.bottom || edges.Bottom;
    const left   = edges.left   || edges.Left;
    const right  = edges.right  || edges.Right;
    if (top)    { body.topEdgeBase64    = top;    body.topEdgeMimeType    = 'image/jpeg'; }
    if (bottom) { body.bottomEdgeBase64 = bottom; body.bottomEdgeMimeType = 'image/jpeg'; }
    if (left)   { body.leftEdgeBase64   = left;   body.leftEdgeMimeType   = 'image/jpeg'; }
    if (right)  { body.rightEdgeBase64  = right;  body.rightEdgeMimeType  = 'image/jpeg'; }
  }

  try {
    const response = await fetch('/api/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + idToken
      },
      body: JSON.stringify(body)
    });

    if (response.status === 401) {
      window._googleIdToken = null;
      statusEl.innerHTML = '<span style="color:#f87171">Sign-in expired. Please sign in again.</span>';
      resultEl.innerHTML = '<button onclick="cancelScan();setTimeout(()=>document.getElementById(\'googleSignInBtn\')?.click(),100)" style="margin-top:.5rem;background:var(--gold);color:#000;border:none;border-radius:8px;padding:.55rem 1.4rem;font-weight:700;font-size:.88rem;cursor:pointer">Sign in with Google</button>';
      return;
    }
    if (response.status === 402) {
      // 2026-09-02 (CR-021): out of grade credits → shop, not the plan chooser.
      cancelScan();
      openShop('grade', 'grade_scan_402');
      return;
    }
    if (!response.ok) {
      let errMsg = 'Could not grade card. Try clearer photos.';
      try { const e = await response.json(); errMsg = e.error || errMsg; } catch(e) {}
      throw new Error(errMsg);
    }

    const data = await response.json();
    const psa   = data.psa_estimate;
    const label = data.grade_label || '';
    const notes = data.grade_notes || '';
    const worth = data.worth_grading;
    const limitingFactor = data.limiting_factor || '';
    const psaDist = Array.isArray(data.psa_distribution) ? data.psa_distribution : [];

    // 2026-08-20: instrument grade completion for the funnel.
    // This is the highest-intent moment in the app — user just paid attention
    // to a real result. Every downstream event (view card, share, upgrade) is
    // measured against this baseline.
    try {
      window.trackEvent && window.trackEvent('grade_completed', {
        deep:         data.deepGrade === true,
        psa:          Number(psa) || 0,
        confidence:   data.confidence || '',
        card_type:    data.card_type || '',
        worth_grading: !!worth,
        credits_used: data.creditsUsed || 0,
        tier:         window._userTier || 'free',
      });
    } catch(e) {}

    const gradeColor = psa >= 9 ? '#4ade80' : psa >= 7 ? '#facc15' : psa >= 5 ? '#fb923c' : '#f87171';

    // Confidence label
    const confidenceLabel = data.confidence
      ? (data.confidence === 'high' ? 'High confidence' : data.confidence === 'low' ? 'Low confidence' : 'Moderate confidence')
      : (psa >= 8 ? 'High confidence' : psa >= 6 ? 'Moderate confidence' : 'Low confidence');
    // Single most-likely grade — no 3-grade spread. If backend gave us a
    // probability distribution, use the top bucket. Otherwise show psa_estimate.
    const primaryGrade = psaDist.length > 0 ? psaDist[0].grade : psa;
    const rangeStr = 'Most likely PSA ' + primaryGrade;

    const isDeep    = data.deepGrade === true;
    const photoCount= data.photoCount || (isDeep ? 6 : 2);

    // 2026-08-20: stash the full identify context returned by the grade
    // endpoint. viewGradedCard() uses this to load the EXACT card panel
    // (no re-scan, no fuzzy pokemontcg.io lookup, no credit spend).
    try {
      window._deepGradeIdent = {
        name:        data.card_name    || '',
        number:      data.card_number  || '',
        setName:     data.set_name     || '',
        setCode:     data.set_code     || '',
        groundedId:  data.grounded_id  || '',
        rarity:      data.rarity       || '',
        cardType:    data.card_type    || 'pokemon',
        isJapanese:  data.is_japanese === true,
        imageUrl:    data.image_url    || '',
      };
      console.log('[grade] stashed _deepGradeIdent', window._deepGradeIdent);
    } catch(_){}
    const creditsUsed = data.creditsUsed || (isDeep ? 2 : 1);
    const tierBadge = isDeep
      ? '<span style="font-size:.65rem;font-weight:800;padding:.15rem .5rem;border-radius:99px;background:linear-gradient(135deg,var(--gold),#f59e0b);color:#000;margin-right:.35rem;letter-spacing:.04em;vertical-align:middle">\uD83D\uDD0D DEEP GRADE · ' + photoCount + ' photos</span>'
      : '<span style="font-size:.65rem;font-weight:700;padding:.15rem .5rem;border-radius:99px;background:rgba(255,255,255,.12);color:rgba(255,255,255,.7);margin-right:.35rem;letter-spacing:.04em;vertical-align:middle">\u26A1 QUICK GRADE</span>';

    statusEl.innerHTML =
      '<div style="margin-bottom:.3rem">' + tierBadge + '</div>' +
      '<span style="color:' + gradeColor + ';font-size:1.3rem;font-weight:900">' + rangeStr + '</span>' +
      ' <span style="font-size:.7rem;font-weight:700;padding:.12rem .45rem;border-radius:99px;background:rgba(255,255,255,.1);color:rgba(255,255,255,.7);margin-left:.25rem;vertical-align:middle">' + confidenceLabel + '</span><br>' +
      '<span style="color:rgba(255,255,255,.6);font-size:.8rem;margin-top:.15rem;display:block">' + label + '</span>' +
      '<span style="font-size:.76rem;color:rgba(255,255,255,.5);margin-top:.1rem;display:block">' + (data.card_name || '') + '</span>' +
      '<span style="font-size:.68rem;color:rgba(255,255,255,.4);margin-top:.2rem;display:block">' + creditsUsed + ' credit' + (creditsUsed === 1 ? '' : 's') + ' used</span>';

    // Map text grades to numeric scores for bar width
    const gradeScore = g => {
      if (!g) return 50;
      const s = String(g).toLowerCase();
      if (s.includes('exc') || s.includes('10') || s.includes('perfect')) return 98;
      if (s.includes('9') || s.includes('mint') || s.includes('great'))   return 85;
      if (s.includes('8') || s.includes('near') || s.includes('good'))    return 70;
      if (s.includes('7') || s.includes('fine'))                          return 58;
      if (s.includes('6') || s.includes('mod') || s.includes('ok'))       return 46;
      if (s.includes('5') || s.includes('fair') || s.includes('avg'))     return 36;
      if (s.includes('poor') || s.includes('bad') || s.includes('1') || s.includes('2')) return 18;
      return 55;
    };
    const barCol = pct => pct >= 80 ? '#4ade80' : pct >= 60 ? '#facc15' : pct >= 40 ? '#fb923c' : '#f87171';

    // Plain-English tips per category — aligned to OFFICIAL PSA thresholds.
    // OFFICIAL: PSA 10 = 55/45, PSA 9 = 60/40, PSA 8 = 65/35, PSA 7 = 70/30.
    // The previous logic was inverted (called 55/45 "moderate off-center").
    const centeringTip = v => {
      if (!v) return '';
      const nums = (v.match(/(\d+)\/(\d+)/g) || []).map(n => { const [a,b]=n.split('/').map(Number); return Math.max(a,b); });
      const worst = nums.length ? Math.max(...nums) : 50;
      // Prefer backend's centering_ceiling when available (server-computed).
      if (data.centering_ceiling != null) {
        if (data.centering_ceiling >= 10) return 'Qualifies for PSA 10 centering (55/45 or better)';
        if (data.centering_ceiling === 9)  return 'Qualifies for PSA 9 centering (60/40 or better) — caps at PSA 9';
        if (data.centering_ceiling === 8)  return 'Qualifies for PSA 8 centering (65/35 or better) — caps at PSA 8';
        if (data.centering_ceiling === 7)  return 'PSA 7 centering (70/30 or better) — caps at PSA 7';
        if (data.centering_ceiling === 6)  return 'PSA 6 centering (75/25 or better) — caps at PSA 6';
        return 'Heavy centering issue — caps at PSA ' + data.centering_ceiling;
      }
      // Fallback when ceiling isn't returned (legacy path).
      if (worst <= 55) return 'Qualifies for PSA 10 centering (55/45 or better)';
      if (worst <= 60) return 'Qualifies for PSA 9 centering (60/40 or better) — caps at PSA 9';
      if (worst <= 65) return 'Qualifies for PSA 8 centering (65/35 or better) — caps at PSA 8';
      if (worst <= 70) return 'PSA 7 centering (70/30 or better) — caps at PSA 7';
      return 'Heavily off-center — major grade deduction';
    };
    const cornerTip = v => {
      if (!v) return '';
      const s = v.toLowerCase();
      if (s.includes('mint') && !s.includes('near')) return 'All 4 corners sharp — no whitening or fraying under light';
      if (s.includes('near mint')) return '1–2 corners with faint softness — barely visible';
      if (s.includes('light')) return 'Light whitening or fraying — visible up close under direct light';
      if (s.includes('moderate')) return 'Clear corner wear — significant grade deduction';
      if (s.includes('heavy')) return 'Heavy wear or bends — major impact on grade';
      return 'Check all 4 corners under direct light for whitening';
    };
    const edgeTip = v => {
      if (!v) return '';
      const s = v.toLowerCase();
      if (s.includes('mint') && !s.includes('near')) return 'Clean edges — no nicks, chips, or roughness';
      if (s.includes('near mint')) return 'Very minor edge wear — hard to see';
      if (s.includes('light')) return 'Small nicks or slight roughness — visible on close inspection';
      if (s.includes('moderate')) return 'Clear chips or roughness — noticeable deduction';
      if (s.includes('heavy')) return 'Significant edge damage — heavy grade impact';
      return 'Run a finger along all 4 edges to feel for nicks';
    };
    const surfaceTip = v => {
      if (!v) return '';
      const s = v.toLowerCase();
      if (s.includes('mint') && !s.includes('near')) return 'No scratches, print lines, or holo damage visible';
      if (s.includes('near mint')) return 'Extremely minor — near flawless surface';
      if (s.includes('light')) return 'Light scratches or print lines — may show under angled light';
      if (s.includes('moderate')) return 'Visible scratches or holo wear — notable deduction';
      if (s.includes('heavy')) return 'Heavy surface damage — severe impact on grade';
      return 'Tilt card under a light to check for hidden scratches';
    };

    // Numeric sub-grades from Deep Grade (1-10 scale)
    const sg = data.subgrades || {};
    const numericPct = n => Math.max(5, Math.min(100, n * 10));
    const numericCol = n => n >= 9 ? '#4ade80' : n >= 7 ? '#facc15' : n >= 5 ? '#fb923c' : '#f87171';

    const scoreBar = (label, val, tipFn, subKey) => {
      // PSA does NOT publish numeric sub-grades. We use the ceiling grade
      // (integer) internally for bar width, but the user-visible label is the
      // PSA-native description (val) — e.g. "four perfectly sharp corners".
      const numeric = subKey && typeof sg[subKey] === 'number' ? sg[subKey] : null;
      const pct = numeric != null ? numericPct(numeric) : gradeScore(val);
      const col = numeric != null ? numericCol(numeric) : barCol(pct);
      const tip = tipFn ? tipFn(val) : '';
      // For Centering, show the measured ratio as the right-hand label.
      // For Corners/Edges/Surface, show the PSA-native description.
      // Never show a fake "8.5/10" sub-score.
      const rightSide = '<span style="color:' + col + ';font-weight:700;font-size:.72rem;text-align:right;max-width:60%">' + (val || '\u2014') + '</span>';
      return '<div style="margin-bottom:.55rem">' +
        '<div style="display:flex;justify-content:space-between;gap:.5rem;font-size:.7rem;margin-bottom:.18rem">' +
          '<span style="color:rgba(255,255,255,.45);flex-shrink:0">' + label + '</span>' +
          rightSide +
        '</div>' +
        '<div style="height:5px;background:rgba(255,255,255,.1);border-radius:99px;overflow:hidden;margin-bottom:.2rem">' +
          '<div style="height:100%;width:' + pct + '%;background:' + col + ';border-radius:99px"></div>' +
        '</div>' +
        (tip ? '<div style="font-size:.65rem;color:rgba(255,255,255,.38);line-height:1.35">' + tip + '</div>' : '') +
      '</div>';
    };

    // ── Slab warning ── If the AI detected the card is already inside a
    // graded slab, show a friendly heads-up at the top. Also surface the
    // grader + grade from the label so it's clear we saw it.
    const slabWarn = data.slab_warning;
    const slabInfo = data.slab_info;
    const slabBanner = slabWarn
      ? '<div style="margin:.15rem 0 .55rem;padding:.6rem .7rem;background:linear-gradient(135deg,rgba(251,146,60,.15),rgba(239,68,68,.12));border:1px solid rgba(251,146,60,.4);border-radius:10px;text-align:left">' +
          '<div style="font-size:.78rem;font-weight:900;color:#fbbf24;margin-bottom:.18rem;letter-spacing:.01em">\uD83D\uDE0F ' + (slabWarn.title || 'Sneaky, sneaky.') + '</div>' +
          '<div style="font-size:.7rem;color:rgba(255,255,255,.75);line-height:1.4">' + (slabWarn.message || 'This card looks slabbed \u2014 grading results will be skewed.') + '</div>' +
          (slabInfo && (slabInfo.grader || slabInfo.grade)
            ? '<div style="margin-top:.35rem;font-size:.7rem;color:rgba(255,255,255,.9);font-weight:700">Label reads: ' +
                (slabInfo.grader ? '<span style="color:#fbbf24">' + slabInfo.grader + '</span>' : '') +
                (slabInfo.grade  ? ' <span style="color:#4ade80">' + slabInfo.grade + '</span>' : '') +
              '</div>'
            : '') +
        '</div>'
      : '';

    // ── CV-verified badge ── Deep Grade with Ximilar pixel-measured CV
    // deserves a special badge so users understand why it's more accurate.
    const cvBadge = data.cv_source === 'ximilar'
      ? '<div style="margin:.15rem 0 .5rem;display:flex;align-items:center;gap:.35rem;font-size:.65rem;font-weight:800;color:#60a5fa;letter-spacing:.06em">' +
          '<span style="width:6px;height:6px;background:#60a5fa;border-radius:99px;box-shadow:0 0 8px #60a5fa"></span>' +
          'CV-VERIFIED \u00B7 PIXEL-MEASURED GRADING' +
        '</div>'
      : '';

    // ── PSA probability distribution block (replaces the 3-grade spread) ──
    // Shows something like: 60% PSA 9 / 25% PSA 8 / 15% PSA 10
    const distBlock = psaDist.length > 0
      ? '<div style="margin:.15rem 0 .55rem;padding:.55rem .65rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px">' +
          '<div style="font-size:.62rem;font-weight:800;letter-spacing:.06em;color:rgba(255,255,255,.5);margin-bottom:.35rem">PROBABILITY DISTRIBUTION</div>' +
          '<div style="display:flex;gap:.35rem;align-items:stretch;height:26px">' +
            psaDist.map((d, i) => {
              const col = d.grade >= 9 ? '#4ade80' : d.grade >= 7 ? '#facc15' : d.grade >= 5 ? '#fb923c' : '#f87171';
              const flex = Math.max(0.4, d.pct / 100);
              return '<div style="flex:' + flex + ';display:flex;flex-direction:column;align-items:center;justify-content:center;background:' + col + (i === 0 ? '' : '80') + ';border-radius:5px;min-width:38px">' +
                       '<div style="font-size:.7rem;font-weight:900;color:#000;line-height:1">PSA ' + d.grade + '</div>' +
                       '<div style="font-size:.6rem;font-weight:700;color:rgba(0,0,0,.7);line-height:1;margin-top:.1rem">' + d.pct + '%</div>' +
                     '</div>';
            }).join('') +
          '</div>' +
        '</div>'
      : '';

    // ── Limiting factor block — explains why THIS grade and not the next one up ──
    const limitingBlock = limitingFactor
      ? '<div style="margin:.15rem 0 .55rem;padding:.55rem .65rem;background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.25);border-radius:10px">' +
          '<div style="font-size:.62rem;font-weight:800;letter-spacing:.06em;color:#7ea8e8;margin-bottom:.2rem">LIMITING FACTOR</div>' +
          '<div style="font-size:.75rem;color:rgba(255,255,255,.85);line-height:1.5">' + limitingFactor + '</div>' +
        '</div>'
      : '';

    // ── Eye appeal block (PSA discretion layer) ──
    const eyeAppeal = data.eye_appeal || '';
    const eyeAppealNotes = data.eye_appeal_notes || '';
    const eyeAppealCol = eyeAppeal === 'Strong' ? '#4ade80' : eyeAppeal === 'Weak' ? '#f87171' : '#facc15';
    const eyeAppealBlock = eyeAppeal
      ? '<div style="margin:.15rem 0 .55rem;padding:.5rem .65rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;display:flex;align-items:center;gap:.5rem">' +
          '<div style="font-size:.62rem;font-weight:800;letter-spacing:.06em;color:rgba(255,255,255,.5);flex-shrink:0">EYE APPEAL</div>' +
          '<div style="font-size:.78rem;font-weight:900;color:' + eyeAppealCol + '">' + eyeAppeal + '</div>' +
          (eyeAppealNotes ? '<div style="font-size:.68rem;color:rgba(255,255,255,.55);line-height:1.4;flex:1">' + eyeAppealNotes + '</div>' : '') +
        '</div>'
      : '';

    // ── Confidence drivers (why we're not fully confident) ──
    const cdrivers = Array.isArray(data.confidence_drivers) ? data.confidence_drivers.filter(x => x !== 'none') : [];
    const driverLabel = k => ({
      holder_glare: 'holder glare',
      limited_edge_visibility: 'limited edge visibility',
      blurry_photo: 'blurry photo',
      single_photo_only: 'single photo only',
      back_not_visible: 'back not visible',
      low_resolution: 'low resolution',
      reflective_sleeve: 'reflective sleeve',
    }[k] || k.replace(/_/g, ' '));
    const driversBlock = cdrivers.length > 0
      ? '<div style="margin:.15rem 0 .55rem;font-size:.65rem;color:rgba(255,255,255,.5);line-height:1.5">' +
          '<strong style="color:rgba(255,255,255,.7);font-weight:800;letter-spacing:.03em">Confidence reduced by:</strong> ' +
          cdrivers.map(driverLabel).join(', ') +
        '</div>'
      : '';

    // ── Visual centering meter ──
    // Shows a horizontal bar with the PSA threshold zones (10/9/8/7/6) as
    // colored bands and a marker line at the measured worst-axis ratio.
    // Way more intuitive than a plain "55/45" string — users see instantly
    // where their card lands on the PSA scale.
    const buildCenteringMeter = () => {
      const lrStr = data.centering_lr || '';
      const tbStr = data.centering_tb || '';
      const parsePair = (s) => {
        const m = String(s || '').match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
        if (!m) return null;
        const a = parseInt(m[1]), b = parseInt(m[2]);
        return isFinite(a) && isFinite(b) && (a + b > 0) ? Math.max(a, b) : null;
      };
      const lrWorst = parsePair(lrStr);
      const tbWorst = parsePair(tbStr);
      if (lrWorst == null && tbWorst == null) return '';
      // Zones: 50 (perfect) → 55 (PSA 10) → 60 (PSA 9) → 65 (PSA 8) → 70 (PSA 7) → 80 (PSA 5)
      // Meter range 50–80 spans 30 units. Pixel width mapped to 0–100%.
      const meterMin = 50, meterMax = 80;
      const pctOf = v => Math.max(0, Math.min(100, ((v - meterMin) / (meterMax - meterMin)) * 100));
      const axisRow = (label, worst, otherHalf) => {
        if (worst == null) return '';
        const markerPct = pctOf(worst);
        const ratioStr = worst + '/' + (100 - worst);
        const gradeAt = worst <= 55.5 ? 10 : worst <= 60.5 ? 9 : worst <= 65.5 ? 8 : worst <= 70.5 ? 7 : worst <= 75.5 ? 6 : 5;
        const markCol = gradeAt >= 9 ? '#4ade80' : gradeAt >= 7 ? '#facc15' : '#fb923c';
        return '<div style="margin-bottom:.4rem">' +
          '<div style="display:flex;justify-content:space-between;font-size:.62rem;color:rgba(255,255,255,.55);margin-bottom:.2rem;letter-spacing:.04em">' +
            '<span>' + label + '</span>' +
            '<span style="color:' + markCol + ';font-weight:800">' + ratioStr + ' \u2192 PSA ' + gradeAt + ' zone</span>' +
          '</div>' +
          '<div style="position:relative;height:14px;border-radius:4px;overflow:hidden;background:linear-gradient(to right,' +
            'rgba(74,222,128,.55) 0%,' +      // 50 (perfect)
            'rgba(74,222,128,.55) 16.6%,' +    // 55 (PSA 10 threshold)
            'rgba(250,204,21,.55) 16.6%,' +    // switch to PSA 9
            'rgba(250,204,21,.55) 33.3%,' +    // 60 (PSA 9 threshold)
            'rgba(251,146,60,.55) 33.3%,' +    // switch to PSA 8
            'rgba(251,146,60,.55) 50%,' +      // 65 (PSA 8 threshold)
            'rgba(248,113,113,.5) 50%,' +      // switch to PSA 7
            'rgba(248,113,113,.5) 66.6%,' +    // 70 (PSA 7 threshold)
            'rgba(153,27,27,.55) 66.6%,' +     // PSA 6-
            'rgba(153,27,27,.55) 100%)">' +
            // Threshold tick marks + labels
            '<div style="position:absolute;left:16.6%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.25)"></div>' +
            '<div style="position:absolute;left:33.3%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.25)"></div>' +
            '<div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.25)"></div>' +
            '<div style="position:absolute;left:66.6%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.25)"></div>' +
            // Marker for measured ratio
            '<div style="position:absolute;left:' + markerPct + '%;top:-2px;bottom:-2px;width:3px;background:#fff;border-radius:2px;box-shadow:0 0 4px rgba(0,0,0,.6);transform:translateX(-1.5px)"></div>' +
          '</div>' +
        '</div>';
      };
      return '<div style="margin:.15rem 0 .55rem;padding:.6rem .7rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;font-size:.62rem;font-weight:800;letter-spacing:.06em;color:rgba(255,255,255,.5);margin-bottom:.4rem">' +
          '<span>MEASURED CENTERING</span>' +
          '<span style="color:rgba(255,255,255,.4);font-weight:600;letter-spacing:.02em;text-transform:none">worst axis rules</span>' +
        '</div>' +
        axisRow('L / R', lrWorst) +
        axisRow('T / B', tbWorst) +
        // Legend under meter
        '<div style="display:flex;justify-content:space-between;font-size:.55rem;color:rgba(255,255,255,.4);margin-top:.35rem;letter-spacing:.02em">' +
          '<span>50/50</span><span>55/45<br><span style="color:#4ade80">PSA 10</span></span><span>60/40<br><span style="color:#facc15">PSA 9</span></span><span>65/35<br><span style="color:#fb923c">PSA 8</span></span><span>70/30<br><span style="color:#f87171">PSA 7</span></span><span>80/20</span>' +
        '</div>' +
      '</div>';
    };
    const centeringMeter = buildCenteringMeter();

    resultEl.innerHTML =
      slabBanner +
      cvBadge +
      distBlock +
      limitingBlock +
      centeringMeter +
      '<div style="margin:.3rem 0 .5rem">' +
        // Prefer explicit L/R + T/B ratios when the new backend returns them.
        scoreBar('Centering',
          (data.centering_lr || data.centering_tb)
            ? [data.centering_lr && ('L/R ' + data.centering_lr), data.centering_tb && ('T/B ' + data.centering_tb)].filter(Boolean).join(' \u00B7 ')
            : data.centering,
          centeringTip, 'centering') +
        scoreBar('Corners',   data.corners_desc || data.corners, cornerTip,   'corners')   +
        scoreBar('Edges',     data.edges_desc   || data.edges,   edgeTip,     'edges')     +
        scoreBar('Surface',   data.surface_desc || data.surface, surfaceTip,  'surface')   +
      '</div>' +
      eyeAppealBlock +
      driversBlock +
      (data.grading_standard
        ? '<div style="font-size:.62rem;color:rgba(255,255,255,.4);line-height:1.45;margin:-.15rem 0 .5rem;text-align:left;font-style:italic">' + data.grading_standard + '</div>'
        : '') +
      (notes ? '<div style="font-size:.72rem;color:rgba(255,255,255,.6);line-height:1.5;margin-bottom:.5rem;padding:.4rem .55rem;background:rgba(255,255,255,.05);border-radius:8px;text-align:left"><strong style="color:rgba(255,255,255,.8)">Grader notes: </strong>' + notes + '</div>' : '') +
      (worth
        ? '<div style="font-size:.74rem;color:#4ade80;font-weight:700;margin-bottom:.4rem">\u2713 Worth submitting for grading</div>' +
          // PSA submission CTA (no false promo — we don't have a PSA discount code)
          '<div style="margin:.35rem 0 .3rem;padding:.55rem .65rem;background:rgba(26,58,110,.25);border:1px solid rgba(42,82,152,.4);border-radius:10px">' +
            '<div style="font-size:.68rem;font-weight:800;letter-spacing:.06em;color:#7ea8e8;margin-bottom:.2rem">🏆 READY TO SUBMIT?</div>' +
            '<div style="font-size:.75rem;font-weight:700;color:#fff;margin-bottom:.15rem">Send it to PSA for the real grade</div>' +
            '<a href="' + (window.CARDSELL_AFFIL_PSA || 'https://www.psacard.com/submit') + '" target="_blank" rel="noopener" ' +
              'style="font-size:.7rem;font-weight:700;color:#7ea8e8;text-decoration:none">Start a PSA submission →</a>' +
          '</div>' +
          // BCW supplies CTA
          (window.CARDSELL_AFFIL_BCW
            ? '<div style="margin:.3rem 0 0;padding:.5rem .65rem;background:rgba(180,83,9,.12);border:1px solid rgba(180,83,9,.3);border-radius:10px">' +
                '<div style="font-size:.68rem;font-weight:800;letter-spacing:.06em;color:#f59e0b;margin-bottom:.2rem">🛡️ PROTECT YOUR CARD</div>' +
                '<div style="font-size:.73rem;color:rgba(255,255,255,.75);margin-bottom:.15rem">Grab toploaders &amp; sleeves before submitting</div>' +
                '<a href="' + window.CARDSELL_AFFIL_BCW + '" target="_blank" rel="noopener" ' +
                  'style="font-size:.7rem;font-weight:700;color:#f59e0b;text-decoration:none">' +
                  'Shop BCW Supplies' + (window.CARDSELL_AFFIL_BCW_CODE ? ' · Use code <strong>' + window.CARDSELL_AFFIL_BCW_CODE + '</strong> for 10% off' : '') + ' →</a>' +
              '</div>'
            : '') 
        : '<div style="font-size:.74rem;color:#fb923c;margin-bottom:.2rem">May not be worth grading costs</div>'
      );

    showScanGradeCTA(data.card_name, '', psa);

    // 2026-08-20: post-grade trigger prompt — the highest-intent moment.
    // Rules:
    //  • Free user on Quick Grade with a high result (≥8) → push Deep Grade upgrade.
    //  • Free user low on grade credits (≤1 left) → push credit pack / Pro.
    //  • Pro user on Quick Grade with a high result → push Deep Grade (Pro Max).
    // Runs after a short delay so the user reads the result first.
    try {
      setTimeout(() => {
        try {
          const tier          = window._userTier || 'free';
          const gradeCreds    = Number(window._scanCredits || 0);
          const isDeepResult  = data.deepGrade === true;
          const psaNum        = Number(psa) || 0;
          const highGrade     = psaNum >= 8;
          let trigger = null;
          let msg     = '';
          let cta     = 'See plans';
          let src     = '';
          if (tier === 'free' && !isDeepResult && highGrade) {
            trigger = 'quick_grade_high_free';
            msg = `PSA ${psaNum}+ estimate on a Quick Grade. A Deep Grade uses 6 photos for a much tighter estimate — recommended before you submit.`;
            cta = 'Upgrade for Deep Grade';
            src = 'post_grade_quick_high_free';
          } else if (tier === 'free' && gradeCreds <= 1) {
            trigger = 'low_grade_credits_free';
            msg = gradeCreds === 0
              ? 'You\u2019re out of grade credits. Grab a pack or unlock unlimited on Pro.'
              : 'Only 1 grade credit left. Pro unlocks unlimited grades.';
            cta = 'Get more grades';
            src = 'post_grade_low_credits_free';
          } else if (tier === 'pro' && !isDeepResult && highGrade) {
            trigger = 'quick_grade_high_pro';
            msg = `PSA ${psaNum}+ on Quick Grade. Pro Max unlocks unlimited Deep Grades (6-photo) for the tightest estimate before you submit.`;
            cta = 'Upgrade to Pro Max';
            src = 'post_grade_quick_high_pro';
          }
          if (!trigger) return;
          window.trackEvent && window.trackEvent('post_grade_prompt_shown', { trigger, psa: psaNum, tier });
          // Slot it under the grade result CTA panel — if that panel isn't
          // showing (unidentified), abort silently.
          const sgCta = document.getElementById('scanGradeCTA');
          if (!sgCta || !sgCta.classList.contains('show')) return;
          // Idempotent — replace any previous nudge.
          let nudge = document.getElementById('postGradeNudge');
          if (nudge) nudge.remove();
          nudge = document.createElement('div');
          nudge.id = 'postGradeNudge';
          nudge.style.cssText = 'margin-top:.6rem;padding:.7rem .85rem;background:linear-gradient(135deg,rgba(196,122,0,.14),rgba(196,122,0,.06));border:1px solid rgba(196,122,0,.35);border-radius:10px;display:flex;flex-direction:column;gap:.5rem;text-align:left';
          nudge.innerHTML =
            '<div style="font-size:.72rem;color:rgba(255,255,255,.85);line-height:1.4">' +
              msg.replace(/[<>]/g, c => c === '<' ? '&lt;' : '&gt;') +
            '</div>' +
            '<button type="button" style="align-self:flex-start;background:var(--gold);color:#000;border:none;border-radius:8px;padding:.4rem 1rem;font-weight:800;font-size:.75rem;cursor:pointer">' +
              cta.replace(/[<>]/g, c => c === '<' ? '&lt;' : '&gt;') +
            '</button>';
          nudge.querySelector('button').addEventListener('click', () => {
            try { window.trackEvent && window.trackEvent('post_grade_prompt_click', { trigger, psa: psaNum, tier }); } catch(e) {}
            if (typeof openPricingModal === 'function') openPricingModal(src);
          });
          sgCta.appendChild(nudge);
        } catch(inner) { console.warn('[post-grade nudge]', inner); }
      }, 1200);
    } catch(e) { /* nudge is optional */ }

    // Store grade info so card auto-selects to correct grader/grade
    window._pendingGradeResult = { cardName: data.card_name, psa };
    // Store estimated grade for portfolio auto-tag
    window._lastScanEstGrade = psa;
    window._lastScanCardName = data.card_name;
    // Stash grade data + front photo for the Share button (used before the
    // Deep Grade state reset at the bottom of this function).
    try {
      const frontImg = window._gradeFrontBase64
        ? ('data:image/jpeg;base64,' + window._gradeFrontBase64)
        : '';
      window._lastGradeShareData = { data: { ...data }, image: frontImg };
    } catch(e) { window._lastGradeShareData = null; }

    // Add "View graded price" tap button into the result
    const psaGrade = psa >= 10 ? 10 : psa >= 9 ? 9 : psa >= 8 ? 8 : psa >= 7 ? 7 : psa >= 6 ? 6 : psa >= 5 ? 5 : 1;
    const gradeColor2 = psa >= 9 ? '#4ade80' : psa >= 7 ? '#facc15' : psa >= 5 ? '#fb923c' : '#f87171';
    // 2026-08-18: Pass card_type + is_japanese so "View card" cross-links
    // to the correct TCG database (YGO grade result no longer goes to
    // Pokemon search returning "Image unavailable").
    const _ct = String(data.card_type || 'pokemon').replace(/'/g,"\\'");
    const _jp = data.is_japanese === true ? 'true' : 'false';
    const _cn = (data.card_name||'').replace(/'/g,"\\'");
    // 2026-08-20: Grading upside panel — pulls the full PriceCharting price
    // ladder (raw → PSA 7 → 8 → 9 → 10) so users see the *dollar difference*
    // between raw sell and each graded tier, minus grading fees. This is the
    // core Deep Grade value pitch — "is it worth $25 to send this in?"
    const upsideId = 'gradingUpside_' + Date.now();
    resultEl.innerHTML +=
      `<div id="${upsideId}" style="margin-top:.75rem;padding:.65rem .75rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px">` +
        `<div style="font-size:.62rem;font-weight:800;letter-spacing:.06em;color:rgba(255,255,255,.55);margin-bottom:.35rem;display:flex;align-items:center;gap:.3rem">` +
          `<span>💰 GRADING UPSIDE</span>` +
          `<span style="color:rgba(255,255,255,.35);font-weight:600;letter-spacing:.02em;text-transform:none;font-size:.6rem">loading comps…</span>` +
        `</div>` +
        `<div style="display:flex;align-items:center;gap:.5rem;font-size:.75rem;color:rgba(255,255,255,.5);padding:.4rem 0">` +
          `<div class="spinner" style="width:14px;height:14px;border:2px solid rgba(255,255,255,.15);border-top-color:var(--gold);border-radius:50%;animation:spin .8s linear infinite"></div>` +
          `Checking PriceCharting for raw + graded comps…` +
        `</div>` +
      `</div>` +
      `<button onclick="viewGradedCard('${_cn}', ${psaGrade}, '${_ct}', ${_jp})" ` +
      `style="margin-top:.65rem;width:100%;padding:.6rem 1rem;background:var(--gold);color:#000;border:none;border-radius:10px;font-weight:900;font-size:.88rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:.4rem">` +
      `📊 View PSA ${psaGrade} price →</button>` +
      `<button onclick="viewGradedCard('${_cn}', 0, '${_ct}', ${_jp})" ` +
      `style="margin-top:.4rem;width:100%;padding:.55rem 1rem;background:rgba(255,255,255,.08);color:rgba(255,255,255,.85);border:1px solid rgba(255,255,255,.15);border-radius:10px;font-weight:700;font-size:.84rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:.35rem">` +
      `🔍 View Card →</button>` +
      `<button id="shareGradeBtn" onclick="shareGrade(this)" ` +
      `style="margin-top:.4rem;width:100%;padding:.55rem 1rem;background:linear-gradient(135deg,rgba(96,165,250,.18),rgba(139,92,246,.18));color:#93c5fd;border:1px solid rgba(96,165,250,.35);border-radius:10px;font-weight:700;font-size:.84rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:.35rem">` +
      `🔗 Share this grade</button>`;

    // Fire the PriceCharting fetch — render the ladder when it returns.
    // Uses the identify metadata (set + number) if available for accuracy.
    (async () => {
      const upsideEl = document.getElementById(upsideId);
      if (!upsideEl) return;
      try {
        const ident = window._pendingIdScanCard || {};
        const params = new URLSearchParams();
        params.set('name', data.card_name || '');
        if (ident.setName)     params.set('set',    ident.setName);
        if (ident.number)      params.set('number', ident.number);
        const gameForPc = ({
          pokemon:  data.is_japanese ? 'pokemonjp' : 'pokemon',
          yugioh:   'yugioh',
          mtg:      'mtg',
          lorcana:  'lorcana',
          onepiece: 'onepiece',
          sports:   'sports',
        })[(data.card_type || 'pokemon').toLowerCase()] || 'pokemon';
        params.set('game', gameForPc);

        const r = await fetch('/api/pricecharting?' + params.toString());
        const pc = await r.json();
        renderGradingUpside(upsideEl, pc, psa, psaGrade, data);
      } catch(e) {
        console.warn('[grading-upside] fetch failed', e);
        upsideEl.innerHTML =
          `<div style="font-size:.62rem;font-weight:800;letter-spacing:.06em;color:rgba(255,255,255,.55);margin-bottom:.35rem">💰 GRADING UPSIDE</div>` +
          `<div style="font-size:.72rem;color:rgba(255,255,255,.5)">Comps unavailable right now. Tap <strong style="color:rgba(255,255,255,.75)">View PSA ${psaGrade} price</strong> below for live prices.</div>`;
      }
    })();

    window._pendingScanBannerCard = data.card_name;

    // Reset all Deep Grade state
    window._gradeFrontBase64 = null;
    window._gradeBackBase64  = null;
    window._gradeEdges       = {};
    window._gradeIsDeep      = false;
    if (window._gradeFrontUrl) { URL.revokeObjectURL(window._gradeFrontUrl); window._gradeFrontUrl = null; }

    // Clone-replace all grade file inputs so the same file can be picked again next scan
    ['gradeBackFileInput','gradeEdgeTopInput','gradeEdgeBottomInput','gradeEdgeLeftInput','gradeEdgeRightInput'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = '';
      const clone = el.cloneNode(true);
      el.parentNode.replaceChild(clone, el);
      if (id === 'gradeBackFileInput') {
        clone.addEventListener('change', function() { processGradeBack(this); });
      } else {
        const edgeKey = id.replace('gradeEdge','').replace('Input','');
        clone.addEventListener('change', function() { processGradeEdge(this, edgeKey); });
      }
    });

  } catch(err) {
    console.error('Grade error:', err);
    statusEl.textContent = err.message || 'Could not grade the card. Try clearer photos.';
  }
}

// ─── Share grade ─────────────────────────────────────────────────────
// Posts the current grade result to /api/grade-share, gets back a public
// URL, copies it to the clipboard, and (on mobile) triggers the native
// share sheet. Falls back gracefully if either fails.
async function shareGrade(btn) {
  const stash = window._lastGradeShareData;
  if (!stash || !stash.data) {
    if (btn) { btn.textContent = 'Nothing to share yet'; setTimeout(() => { btn.innerHTML = '🔗 Share this grade'; }, 1500); }
    return;
  }
  const originalHTML = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Creating link…'; }
  try {
    const res = await fetch('/api/grade-share', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(window._googleIdToken ? { 'Authorization': 'Bearer ' + window._googleIdToken } : {}),
      },
      body: JSON.stringify({ data: stash.data, image: stash.image || '' }),
    });
    if (!res.ok) throw new Error('share_failed_' + res.status);
    const { url } = await res.json();
    if (!url) throw new Error('no_url');

    // Try native share sheet first (mobile) — falls back to clipboard.
    // Text is dynamic-per-grade so shares feel personal instead of automated:
    //  PSA 9-10  → flex
    //  PSA 7-8   → curiosity / second opinion
    //  PSA 1-6   → self-deprecating
    //  no grade  → generic teaser
    const _cardName = stash.data.card_name || 'my card';
    const _psa      = Number(stash.data.psa_estimate);
    let _shareText;
    if (!isFinite(_psa) || _psa <= 0) {
      _shareText = `Check out my ${_cardName} grade — estimated by CardResell AI`;
    } else if (_psa >= 9) {
      const flex = [
        `🔥 My ${_cardName} just came back PSA ${_psa} from CardResell AI. Grade yours free:`,
        `PSA ${_psa} on my ${_cardName} 💯 CardResell AI called it. Grade yours free:`,
        `Just graded my ${_cardName} on CardResell AI → PSA ${_psa}. Try it on yours:`,
      ];
      _shareText = flex[Math.floor(Math.random() * flex.length)];
    } else if (_psa >= 7) {
      const mid = [
        `Got a PSA ${_psa} on my ${_cardName} from CardResell AI. Grade yours:`,
        `CardResell AI graded my ${_cardName} at PSA ${_psa}. Second opinion?`,
        `PSA ${_psa} on my ${_cardName} per CardResell AI — fair? Try yours:`,
      ];
      _shareText = mid[Math.floor(Math.random() * mid.length)];
    } else {
      const low = [
        `Rough one 😂 CardResell AI graded my ${_cardName} at PSA ${_psa}. Try yours:`,
        `Ouch. My ${_cardName} pulled a PSA ${_psa} from CardResell AI. See what yours grades:`,
        `PSA ${_psa} on my ${_cardName} — CardResell AI kept it real. Grade yours free:`,
      ];
      _shareText = low[Math.floor(Math.random() * low.length)];
    }
    const shareData = {
      title: _cardName + ' — PSA ' + (isFinite(_psa) && _psa > 0 ? _psa : '?'),
      text:  _shareText,
      url,
    };
    let shared = false;
    if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
      try { await navigator.share(shareData); shared = true; } catch(e) { /* user cancelled — treat as no-op, still copy */ }
    }
    // Always copy to clipboard so desktop users have it too.
    try {
      await navigator.clipboard.writeText(url);
      if (btn) btn.innerHTML = shared ? '✓ Shared' : '✓ Link copied';
    } catch(e) {
      // Fallback: show URL in a prompt if clipboard blocked.
      if (btn) btn.innerHTML = '✓ Link ready';
      window.prompt('Copy this link:', url);
    }
    setTimeout(() => { if (btn) { btn.innerHTML = originalHTML || '🔗 Share this grade'; btn.disabled = false; } }, 2200);
  } catch(err) {
    console.error('shareGrade error', err);
    if (btn) {
      btn.innerHTML = '✗ Share failed';
      setTimeout(() => { btn.innerHTML = originalHTML || '🔗 Share this grade'; btn.disabled = false; }, 1800);
    }
  }
}

// Compress image to max maxPx wide/tall, return base64 JPEG string.
// 2026-08-21: Now runs client-side auto-crop first. Uses detectCardBounds
// (already defined for fastpath) to isolate the card silhouette from the
// background before compression. Cropping happens ONLY when bounds look
// sensible (≥40% of image area, aspect ratio 0.5–0.9 for a portrait card).
// Falls back to the whole image if the crop looks wrong — never worse than
// the old behavior.
// 2026-08-21: compressImage(file, maxPx, opts?) — opts.skipCrop=true disables
// the client-side card-bounds crop (used by bulk-scan, where the user has
// already staged one card per photo and false crops caused ID failures).
// opts.quality overrides the JPEG quality (default 0.82).
function compressImage(file, maxPx, opts) {
  const _opts = opts || {};
  const skipCrop = !!_opts.skipCrop;
  const jpegQuality = typeof _opts.quality === 'number' ? _opts.quality : 0.82;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);

      // Step 1: try to detect and crop to card bounds on the FULL-res image
      // (bounds are computed on a 256px downsample internally so this is
      // fast — ~30-60ms even on a 4000×3000 iPhone photo). Skipped for
      // bulk mode: staged photos rarely benefit and false crops caused
      // ID misses on 4/14 MTG cards.
      let srcCanvas = null;
      if (skipCrop) {
        try { console.log('[scan] client-crop disabled (bulk mode)'); } catch(_){}
      } else try {
        const full = document.createElement('canvas');
        full.width = img.naturalWidth || img.width;
        full.height = img.naturalHeight || img.height;
        const fctx = full.getContext('2d');
        fctx.drawImage(img, 0, 0);
        const _detect = (window.CardResellFastPath && window.CardResellFastPath.detectCardBounds) || null;
        if (_detect) {
          const t0 = performance.now();
          const imgData = fctx.getImageData(0, 0, full.width, full.height).data;
          const bounds = _detect(imgData, full.width, full.height);
          const dt = (performance.now() - t0) | 0;
          if (bounds) {
            const area = bounds.w * bounds.h;
            const total = full.width * full.height;
            const ratio = area / total;
            const aspect = bounds.h > 0 ? bounds.w / bounds.h : 0;
            // Reject junk bounds:
            //  - < 25% of the frame (we probably picked up a shadow/hand)
            //  - aspect way off for a portrait TCG card (0.55–0.85 is normal)
            //  - aspect way off for a landscape card / bulk-scan layout too
            //    (accept 1.15–1.8 as landscape). Anything in between (0.85–1.15
            //    square-ish) is suspicious — skip.
            const goodPortrait  = ratio >= 0.25 && aspect >= 0.55 && aspect <= 0.85;
            const goodLandscape = ratio >= 0.25 && aspect >= 1.15 && aspect <= 1.80;
            if (goodPortrait || goodLandscape) {
              const cropped = document.createElement('canvas');
              cropped.width = bounds.w;
              cropped.height = bounds.h;
              cropped.getContext('2d').drawImage(
                full, bounds.x, bounds.y, bounds.w, bounds.h,
                0, 0, bounds.w, bounds.h
              );
              srcCanvas = cropped;
              try { console.log('[scan] client-crop OK: ' + bounds.w + '×' + bounds.h + ' (' + (ratio*100|0) + '% of frame, aspect ' + aspect.toFixed(2) + ') in ' + dt + 'ms'); } catch(_){}
            } else {
              try { console.log('[scan] client-crop skipped: ratio=' + (ratio*100|0) + '%, aspect=' + aspect.toFixed(2)); } catch(_){}
            }
          }
        }
      } catch(cropErr) {
        try { console.warn('[scan] client-crop failed, using full frame:', cropErr && cropErr.message); } catch(_){}
      }

      // Step 2: downscale (from either the cropped canvas or the original img).
      const srcW = srcCanvas ? srcCanvas.width  : (img.naturalWidth  || img.width);
      const srcH = srcCanvas ? srcCanvas.height : (img.naturalHeight || img.height);
      let w = srcW, h = srcH;
      if (w > maxPx || h > maxPx) {
        if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else       { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      if (srcCanvas) {
        canvas.getContext('2d').drawImage(srcCanvas, 0, 0, w, h);
      } else {
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      }
      // quality 0.82 gives good detail at ~200-400KB (default);
      // bulk mode uses 0.90 for text-heavy MTG cards.
      const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
      resolve(dataUrl.split(',')[1]);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// 2026-08-21: OCR + Scryfall rescue for MTG cards Ximilar can't ID.
// Runs Tesseract on the top strip of the card (where the name lives),
// then queries Scryfall for exact-name matches. Only returns a card if
// Scryfall confirms it's real — never invents names.
// Called from single-scan flow on identified=false; also usable from
// bulk-scan retry paths.
async function _tryOCRThenScryfall(file, statusEl) {
  try {
    if (!window.Tesseract) {
      if (statusEl) statusEl.textContent = 'Loading text reader\u2026';
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    if (statusEl) statusEl.textContent = 'Reading card name\u2026';

    // Crop to the top ~15% of the image — the MTG name is always at the
    // top-left inside a light banner. Tesseract on the full card produces
    // messy multi-line results (rules text + flavor text) that break the
    // fuzzy name search.
    const topStripUrl = await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          URL.revokeObjectURL(url);
          const c = document.createElement('canvas');
          const stripH = Math.round((img.naturalHeight || img.height) * 0.15);
          c.width = img.naturalWidth || img.width;
          c.height = stripH;
          c.getContext('2d').drawImage(img, 0, 0);
          resolve(c.toDataURL('image/jpeg', 0.92));
        } catch(e) { reject(e); }
      };
      img.onerror = reject;
      img.src = url;
    });

    const { data: { text } } = await window.Tesseract.recognize(topStripUrl, 'eng', {
      // No verbose logger for the rescue path.
    });
    // Take the first non-trivial line as the candidate name.
    const lines = String(text || '').split('\n').map(l => l.trim())
      // strip mana-cost gibberish characters Tesseract loves to invent
      .map(l => l.replace(/[|_\\\/\[\]{}<>=+*@#\$%^&`~]/g, '').replace(/\s+/g, ' ').trim())
      .filter(l => l.length >= 3 && /[a-zA-Z]/.test(l));
    const candidate = lines[0] || '';
    if (!candidate || candidate.length < 3) return null;

    if (statusEl) statusEl.textContent = 'Confirming with Scryfall\u2026';

    // Ask Scryfall for a fuzzy match — if it confirms a real card, use it.
    const r = await fetch('https://api.scryfall.com/cards/named?fuzzy=' + encodeURIComponent(candidate), {
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !j.name) return null;

    // 2026-08-22: Scryfall fuzzy is TOO permissive — for OCR gibberish it
    // still returns whatever's closest, which is often a completely
    // unrelated card (e.g. "Mindful Biomancer" OCR'd badly → fuzzy returned
    // "Spring-Loaded Sawblades"). Require a real similarity between the
    // OCR candidate and the returned name before trusting it.
    // Normalize both to lowercase alphanumerics-with-spaces, then require
    // at least ONE shared meaningful token (>=4 chars) OR a Dice bigram
    // coefficient >= 0.55. That still catches typical OCR noise (a couple
    // of letters wrong, spacing off) while rejecting semantic mismatches.
    const _norm = (s) => String(s || '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const nC = _norm(candidate);
    const nR = _norm(j.name);
    if (!nC || !nR) return null;

    const tokensC = new Set(nC.split(' ').filter(t => t.length >= 4));
    const tokensR = new Set(nR.split(' ').filter(t => t.length >= 4));
    let sharedToken = false;
    for (const t of tokensC) { if (tokensR.has(t)) { sharedToken = true; break; } }

    // Dice bigram coefficient — catches near-misses where no whole word
    // survived OCR intact.
    const bigrams = (s) => {
      const b = new Map();
      for (let i = 0; i < s.length - 1; i++) {
        const g = s.slice(i, i + 2);
        b.set(g, (b.get(g) || 0) + 1);
      }
      return b;
    };
    const bC = bigrams(nC.replace(/\s/g, ''));
    const bR = bigrams(nR.replace(/\s/g, ''));
    let overlap = 0, totalC = 0, totalR = 0;
    for (const [, v] of bC) totalC += v;
    for (const [, v] of bR) totalR += v;
    for (const [g, v] of bC) {
      if (bR.has(g)) overlap += Math.min(v, bR.get(g));
    }
    const dice = (totalC + totalR) > 0 ? (2 * overlap) / (totalC + totalR) : 0;

    if (!sharedToken && dice < 0.55) {
      try { console.warn('[_tryOCRThenScryfall] rejected fuzzy hit — OCR="' + candidate + '" → Scryfall="' + j.name + '" (dice=' + dice.toFixed(2) + ', no shared token)'); } catch(_){}
      return null;
    }

    return {
      name:    j.name,
      number:  j.collector_number || '',
      setName: j.set_name || '',
      setCode: j.set || '',
      imageUrl: (j.image_uris && (j.image_uris.small || j.image_uris.normal))
              || (j.card_faces && j.card_faces[0] && j.card_faces[0].image_uris && j.card_faces[0].image_uris.small)
              || '',
    };
  } catch(err) {
    try { console.warn('[_tryOCRThenScryfall]', err && err.message); } catch(_){}
    return null;
  }
}

// 2026-08-28: Universal OCR + catalog rescue.
// When Ximilar can't ID a card (usually a set it hasn't been trained on yet),
// OCR the card's name strip and confirm it against the game's authoritative
// free catalog. Same shape as _tryOCRThenScryfall (MTG) but generalized so
// we never leave the user stranded on a valid card regardless of game.
//
// Per-game crop tuning (top-of-card % height) and name-search endpoint:
//   mtg        → top 15%   → Scryfall /cards/named?fuzzy
//   pokemon    → top 12%   → pokemontcg.io ?q=name:X*
//   pokemonJP  → top 12%   → pokemontcg.io (romaji reference) then TCGdex
//   yugioh     → top 11%   → YGOProDeck ?fname=X
//   lorcana    → top 14%   → lorcana-api.com (cache filter)
//   onepiece   → top 13%   → TPL fallback (best-effort)
async function _ocrCropTopStrip(file, cropFraction) {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        URL.revokeObjectURL(url);
        const c = document.createElement('canvas');
        const stripH = Math.round((img.naturalHeight || img.height) * cropFraction);
        c.width = img.naturalWidth || img.width;
        c.height = stripH;
        c.getContext('2d').drawImage(img, 0, 0);
        resolve(c.toDataURL('image/jpeg', 0.92));
      } catch(e) { reject(e); }
    };
    img.onerror = reject;
    img.src = url;
  });
}

function _ocrCandidateFromText(text) {
  const lines = String(text || '').split('\n').map(l => l.trim())
    .map(l => l.replace(/[|_\\\/\[\]{}<>=+*@#\$%^&`~]/g, '').replace(/\s+/g, ' ').trim())
    .filter(l => l.length >= 3 && /[a-zA-Z]/.test(l));
  return lines[0] || '';
}

// Dice bigram + shared-token guard — rejects OCR gibberish that fuzzy-matches
// to an unrelated real card name.
function _nameMatchIsPlausible(candidate, matchedName) {
  const _norm = (s) => String(s || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const nC = _norm(candidate);
  const nR = _norm(matchedName);
  if (!nC || !nR) return false;
  const tokensC = new Set(nC.split(' ').filter(t => t.length >= 4));
  const tokensR = new Set(nR.split(' ').filter(t => t.length >= 4));
  let sharedToken = false;
  for (const t of tokensC) { if (tokensR.has(t)) { sharedToken = true; break; } }
  const bigrams = (s) => {
    const b = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      b.set(g, (b.get(g) || 0) + 1);
    }
    return b;
  };
  const bC = bigrams(nC.replace(/\s/g, ''));
  const bR = bigrams(nR.replace(/\s/g, ''));
  let overlap = 0, totalC = 0, totalR = 0;
  for (const [, v] of bC) totalC += v;
  for (const [, v] of bR) totalR += v;
  for (const [g, v] of bC) if (bR.has(g)) overlap += Math.min(v, bR.get(g));
  const dice = (totalC + totalR) > 0 ? (2 * overlap) / (totalC + totalR) : 0;
  return sharedToken || dice >= 0.55;
}

// Per-game catalog confirmation. Each branch returns a normalized card
// object { name, number, setName, setCode, imageUrl, cardType } or null.
async function _confirmCardByName(candidate, game) {
  if (!candidate || candidate.length < 3) return null;

  try {
    if (game === 'mtg') {
      const r = await fetch('https://api.scryfall.com/cards/named?fuzzy=' + encodeURIComponent(candidate), { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      const j = await r.json();
      if (!j || !j.name || !_nameMatchIsPlausible(candidate, j.name)) return null;
      return {
        name: j.name,
        number: j.collector_number || '',
        setName: j.set_name || '',
        setCode: j.set || '',
        imageUrl: (j.image_uris && (j.image_uris.small || j.image_uris.normal))
                || (j.card_faces && j.card_faces[0] && j.card_faces[0].image_uris && j.card_faces[0].image_uris.small)
                || '',
        cardType: 'mtg',
      };
    }

    if (game === 'pokemon' || game === 'pokemonJP') {
      // pokemontcg.io substring match, newest sets first. Works for both
      // EN and JP-with-EN-reference cards.
      const q = 'name:' + candidate.replace(/["\\]/g, '').split(' ')[0] + '*';
      const url = 'https://api.pokemontcg.io/v2/cards?q=' + encodeURIComponent(q)
                + '&pageSize=10&orderBy=-set.releaseDate'
                + '&select=id,name,set,number,rarity,images';
      const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
      if (!r.ok) return null;
      const j = await r.json();
      const hits = (j && j.data) || [];
      // Score hits by plausibility against the FULL OCR candidate.
      const scored = hits.filter(h => h && h.name && _nameMatchIsPlausible(candidate, h.name));
      if (!scored.length) return null;
      const pick = scored[0];
      return {
        name: pick.name,
        number: pick.number || '',
        setName: (pick.set && pick.set.name) || '',
        setCode: (pick.set && pick.set.id) || '',
        imageUrl: (pick.images && (pick.images.small || pick.images.large)) || '',
        cardType: game === 'pokemonJP' ? 'pokemonJP' : 'pokemon',
        pokemontcgId: pick.id || '',
      };
    }

    if (game === 'yugioh') {
      const url = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=' + encodeURIComponent(candidate) + '&num=5&offset=0';
      const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
      if (!r.ok) return null;
      const j = await r.json();
      const hits = (j && j.data) || [];
      const scored = hits.filter(h => h && h.name && _nameMatchIsPlausible(candidate, h.name));
      if (!scored.length) return null;
      const pick = scored[0];
      const firstSet = (pick.card_sets && pick.card_sets[0]) || {};
      return {
        name: pick.name,
        number: firstSet.set_code || '',
        setName: firstSet.set_name || '',
        setCode: firstSet.set_code || '',
        imageUrl: (pick.card_images && pick.card_images[0] && pick.card_images[0].image_url_small) || '',
        cardType: 'yugioh',
      };
    }

    if (game === 'lorcana') {
      // We already load the full Lorcana DB on demand — reuse it.
      let db = null;
      if (typeof _lorcanaCachePending !== 'undefined' && _lorcanaCachePending) {
        try { db = await _lorcanaCachePending; } catch(_){}
      }
      if (!db) {
        try {
          const r = await fetch('https://api.lorcana-api.com/cards/all', { signal: AbortSignal.timeout(7000) });
          if (r.ok) db = await r.json();
        } catch(_){}
      }
      if (!Array.isArray(db) || !db.length) return null;
      const cand = candidate.toLowerCase();
      // Prefer name-startswith, then any-substring, both filtered by plausibility.
      const starts = db.filter(c => c && c.Name && c.Name.toLowerCase().startsWith(cand.split(' ')[0]));
      const pool = starts.length ? starts : db.filter(c => c && c.Name && c.Name.toLowerCase().includes(cand.split(' ')[0]));
      const scored = pool.filter(c => _nameMatchIsPlausible(candidate, c.Name));
      if (!scored.length) return null;
      const pick = scored[0];
      return {
        name: pick.Name || '',
        number: pick.Card_Num || pick.Number || '',
        setName: pick.Set_Name || pick.Set || '',
        setCode: pick.Set_ID || '',
        imageUrl: pick.Image || '',
        cardType: 'lorcana',
      };
    }

    // One Piece: no free authoritative fuzzy catalog we can call from the
    // browser without a TPL key. Skip rescue and let the manual UI handle it.
    return null;
  } catch(err) {
    try { console.warn('[_confirmCardByName]', game, err && err.message); } catch(_){}
    return null;
  }
}

async function _tryOCRRescue(file, statusEl, game) {
  try {
    if (!file || !game) return null;
    if (!window.Tesseract) {
      if (statusEl) statusEl.textContent = 'Loading text reader\u2026';
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    // Per-game name-strip crop fractions — calibrated to where the printed
    // name banner sits on each game's card layout.
    const cropByGame = {
      mtg: 0.15, pokemon: 0.12, pokemonJP: 0.12,
      yugioh: 0.11, lorcana: 0.14, onepiece: 0.13,
    };
    const crop = cropByGame[game] || 0.15;
    if (statusEl) statusEl.textContent = 'Reading card name\u2026';
    const stripUrl = await _ocrCropTopStrip(file, crop);
    const { data: { text } } = await window.Tesseract.recognize(stripUrl, 'eng', {});
    const candidate = _ocrCandidateFromText(text);
    if (!candidate || candidate.length < 3) return null;
    if (statusEl) statusEl.textContent = 'Confirming with catalog\u2026';
    return await _confirmCardByName(candidate, game);
  } catch(err) {
    try { console.warn('[_tryOCRRescue]', game, err && err.message); } catch(_){}
    return null;
  }
}

async function fallbackOCR(file, statusEl, resultEl, objectUrl) {
  // 2026-08-25 [M] track whether we minted the object URL locally so we can
  // revoke it. Previously the file-only branch leaked a blob every time the
  // OCR path was taken.
  let _localObjUrl = null;
  try {
    if (!window.Tesseract) {
      statusEl.textContent = 'Loading text reader…';
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    statusEl.textContent = 'Reading card text…';
    let imgUrl = objectUrl;
    if (!imgUrl && file) {
      imgUrl = URL.createObjectURL(file);
      _localObjUrl = imgUrl;
    }
    if (!imgUrl) { statusEl.textContent = 'No image to process.'; return; }
    const { data: { text } } = await Tesseract.recognize(imgUrl, 'eng', {
      logger: m => { if (m.status === 'recognizing text') statusEl.textContent = 'Reading… ' + Math.round(m.progress * 100) + '%'; }
    });
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2);
    const cardName = lines[0] || '';
    if (!cardName) { statusEl.textContent = 'Could not read text. Try a clearer, well-lit photo.'; return; }
    statusEl.textContent = `Found: "${cardName}"`;
    setTimeout(() => {
      cancelScan();
      const searchInput = document.getElementById('searchInput');
      searchInput.value = cardName;
      searchInput.dispatchEvent(new Event('input'));
      setTimeout(() => document.getElementById('searchBtn').click(), 300);
    }, 900);
  } catch(err) {
    statusEl.textContent = 'Could not read card. Try a clearer, well-lit photo.';
  } finally {
    if (_localObjUrl) { try { URL.revokeObjectURL(_localObjUrl); } catch(_){} }
  }
}


// ── SCANNER FAST-PATH (client-side pHash) — added 2026-08-16 ──
// See /card-index.json (20k card fingerprints, ~4MB gzip-cached at edge).
// Hit rate targets ~30% of scans (non-holo raw cards); rest fall through
// to /api/scan LLM. Preloads hires image for instant View Card.
// Client-side card scanner fast-path.
// Runs entirely in the browser: image → card crop → pHash → nearest neighbor
// against a 20,392-card index (~4MB, loaded once & CDN-cached).
//
// Return values:
//   { hit: true,  card: {...}, distance: N, source: 'phash' }   ← use immediately
//   { hit: false, reason: '...' }                                ← fall back to /api/scan
//
// Scoring: hamming(pHash)*2 + hamming(dHash). pHash is weighted double because
// it survives resampling far better — measured 2026-09-03, a rehash of an index
// reference image reproduces its stored pHash near-exactly while dHash carries
// ~13 bits of error (PIL Lanczos 9x8 in the seeder vs canvas bilinear here).
//
// Accept iff score <= 20 AND gap to second-best >= 6. Calibrated 2026-09-03 by
// feeding the index its own reference images back through scanFile (n=30):
// 26/30 accepted, 26 correct, 0 wrong. Recall plateaus flat from T=20 to T=48
// with zero false accepts, so T=20 is the conservative end of the plateau.
//
// The 4 that fall through are near-duplicate arts (same illustration, different
// rarity) where the gap rule correctly refuses to guess — those go to the LLM.
//
// HISTORY: this threshold was 12, which produced a 0% hit rate on the index's
// OWN reference images. Cause: the 2026-08-21 detectCardBounds() auto-crop was
// applied before hashing, but the index is built from UNCROPPED images, so
// every stored hash was silently invalidated. Fixed by scoring min() over both
// the cropped and uncropped hashes. If you change hashing or cropping here,
// re-run tests/fastpath-calibration.mjs or this rots again the same way.

(function() {
  'use strict';

  // 2026-08-22: Multi-game index shards. Load only the shard(s) needed for
  // the current activeGame. Pokemon shard is legacy /card-index.json (~4MB);
  // MTG shard is /mtg-index.json (~3.5MB, Scryfall unique-artwork 2024+).
  //
  // When activeGame is unknown or 'auto', we merge both shards so a scan can
  // resolve across games. When it's a single game, we load only that shard.
  const _shards = {
    pokemon: { url: '/card-index.json', promise: null, data: null },
    mtg:     { url: '/mtg-index.json',  promise: null, data: null },
  };

  async function _loadShard(game) {
    const s = _shards[game];
    if (!s) return [];
    if (s.data) return s.data;
    if (s.promise) return s.promise;
    s.promise = (async () => {
      const t0 = performance.now();
      const r = await fetch(s.url);
      if (!r.ok) throw new Error(`shard ${game} fetch failed: ${r.status}`);
      const idx = await r.json();
      console.log(`[fastpath] shard ${game}: ${idx.length} cards in ${(performance.now()-t0).toFixed(0)}ms`);
      s.data = idx;
      return idx;
    })();
    return s.promise;
  }

  async function loadCardIndex(gameHint) {
    // gameHint: 'pokemon' | 'mtg' | 'both' | undefined
    //
    // Strategy: for scan calls, ALWAYS load both shards. Users may scan a
    // card that doesn't match their currently-selected game (game selector
    // is intent, not truth). The pHash NN across both shards is only ~32k
    // rows and takes <100ms; the extra 3.5MB download is worth it once per
    // session. Callers can still pass a specific hint to limit scope.
    const game = gameHint || (typeof window !== 'undefined' && window.activeGame) || null;
    // Explicit single-shard when called from a search-list rerank on Japanese
    // Pokemon (which has no MTG equivalent) or similar narrow paths.
    if (game === 'pokemonjp') return _loadShard('pokemon');
    // Everything else: both shards in parallel.
    const [pk, mtg] = await Promise.all([
      _loadShard('pokemon').catch(e => (console.warn('[fastpath] pokemon shard failed:', e), [])),
      _loadShard('mtg').catch(e => (console.warn('[fastpath] mtg shard failed:', e), [])),
    ]);
    return pk.concat(mtg);
  }

  // ── Card detection: find bounding box of high-gradient region ──
  // For a phone photo of a card on any background, the card edges create the
  // strongest gradient. Compute a simple gradient map, find bounding box of
  // top-percentile pixels.
  function detectCardBounds(imgData, w, h) {
    // Downsample to 256px max for speed
    const scale = 256 / Math.max(w, h);
    const dw = Math.floor(w * scale);
    const dh = Math.floor(h * scale);

    // Grayscale + downsample nearest-neighbor
    const gray = new Uint8Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      const sy = Math.floor(y / scale);
      for (let x = 0; x < dw; x++) {
        const sx = Math.floor(x / scale);
        const idx = (sy * w + sx) * 4;
        // luminance
        gray[y*dw + x] = (imgData[idx]*0.299 + imgData[idx+1]*0.587 + imgData[idx+2]*0.114) | 0;
      }
    }

    // Gradient (Sobel-lite: |dx| + |dy|)
    const grad = new Uint8Array(dw * dh);
    for (let y = 1; y < dh-1; y++) {
      for (let x = 1; x < dw-1; x++) {
        const i = y*dw + x;
        const dx = Math.abs(gray[i+1] - gray[i-1]);
        const dy = Math.abs(gray[i+dw] - gray[i-dw]);
        grad[i] = Math.min(255, dx + dy);
      }
    }

    // Threshold at 40, find bounding box of edge pixels
    let minX = dw, maxX = 0, minY = dh, maxY = 0, edgeCount = 0;
    const xs = [], ys = [];
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        if (grad[y*dw + x] > 40) {
          xs.push(x); ys.push(y);
          edgeCount++;
        }
      }
    }
    if (edgeCount < 100) return null;

    // Use 3rd-97th percentile bounds to reject outliers (glare specks, hand edge)
    xs.sort((a,b) => a - b);
    ys.sort((a,b) => a - b);
    const p3 = Math.floor(xs.length * 0.03);
    const p97 = Math.floor(xs.length * 0.97);
    minX = xs[p3]; maxX = xs[p97];
    minY = ys[p3]; maxY = ys[p97];

    // Scale back to original
    const margin = 4;
    return {
      x: Math.max(0, Math.floor(minX / scale) - margin),
      y: Math.max(0, Math.floor(minY / scale) - margin),
      w: Math.min(w, Math.ceil((maxX - minX) / scale) + 2*margin),
      h: Math.min(h, Math.ceil((maxY - minY) / scale) + 2*margin),
    };
  }

  // ── DCT-II (1D) ──
  function dct1d(vec) {
    const N = vec.length;
    const out = new Array(N);
    const factor = Math.PI / N;
    for (let k = 0; k < N; k++) {
      let sum = 0;
      const kf = k * factor;
      for (let n = 0; n < N; n++) sum += vec[n] * Math.cos((n + 0.5) * kf);
      out[k] = sum;
    }
    return out;
  }

  // ── pHash (matches Python imagehash.phash, hash_size=8) ──
  // Input: canvas with any-size RGBA image. Resize to 32x32 grayscale, DCT,
  // take top-left 8x8, threshold vs median.
  function computePHash(canvas) {
    const N = 32;
    // Downsample to 32x32 grayscale via a temp canvas
    const tmp = document.createElement('canvas');
    tmp.width = N; tmp.height = N;
    const ctx = tmp.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, N, N);
    const px = ctx.getImageData(0, 0, N, N).data;
    const mat = [];
    for (let i = 0; i < N; i++) {
      const row = new Array(N);
      for (let j = 0; j < N; j++) {
        const p = (i*N + j) * 4;
        row[j] = px[p]*0.299 + px[p+1]*0.587 + px[p+2]*0.114;
      }
      mat.push(row);
    }
    // DCT rows
    const rowT = mat.map(r => dct1d(r));
    // DCT cols
    const dct = Array.from({length: N}, () => new Array(N));
    for (let c = 0; c < N; c++) {
      const col = rowT.map(r => r[c]);
      const dc = dct1d(col);
      for (let r = 0; r < N; r++) dct[r][c] = dc[r];
    }
    // Top-left 8x8
    const low = [];
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 8; j++)
        low.push(dct[i][j]);
    // Median (including DC — matches Python imagehash)
    const sorted = low.slice().sort((a,b) => a - b);
    const median = (sorted[31] + sorted[32]) / 2;
    // Bits → hex
    let hex = '';
    let nibble = 0, bits = 0;
    for (const v of low) {
      nibble = (nibble << 1) | (v > median ? 1 : 0);
      bits++;
      if (bits === 4) {
        hex += nibble.toString(16);
        nibble = 0; bits = 0;
      }
    }
    return hex;
  }

  // ── dHash (gradient-based) ──
  // Downsample to 9x8, difference along rows → 64 bits
  function computeDHash(canvas) {
    const tmp = document.createElement('canvas');
    tmp.width = 9; tmp.height = 8;
    const ctx = tmp.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, 9, 8);
    const px = ctx.getImageData(0, 0, 9, 8).data;
    let hex = '';
    let nibble = 0, bits = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const a = (y*9 + x) * 4;
        const b = (y*9 + x + 1) * 4;
        const va = px[a]*0.299 + px[a+1]*0.587 + px[a+2]*0.114;
        const vb = px[b]*0.299 + px[b+1]*0.587 + px[b+2]*0.114;
        nibble = (nibble << 1) | (vb > va ? 1 : 0);
        bits++;
        if (bits === 4) {
          hex += nibble.toString(16);
          nibble = 0; bits = 0;
        }
      }
    }
    return hex;
  }

  // Hamming distance between two hex strings of equal length
  function hamming(a, b) {
    if (a.length !== b.length) return 999;
    let d = 0;
    for (let i = 0; i < a.length; i++) {
      let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
      // popcount 4 bits
      x = x - ((x >> 1) & 0x5);
      x = (x & 0x3) + ((x >> 2) & 0x3);
      d += x;
    }
    return d;
  }

  // Derive large-image URL from the small URL stored in the index.
  // pokemontcg.io: /{set}/{num}.png -> /{set}/{num}_hires.png
  // scrydex:      /pokemon/{id}/small -> /pokemon/{id}/large
  function deriveLargeUrl(smallUrl) {
    if (!smallUrl) return '';
    if (smallUrl.includes('scrydex.com')) return smallUrl.replace(/\/small$/, '/large');
    if (smallUrl.includes('pokemontcg.io')) return smallUrl.replace(/\.png$/, '_hires.png');
    // 2026-08-22: Scryfall URLs — the index stores /normal/, upgrade to /large/
    if (smallUrl.includes('cards.scryfall.io')) return smallUrl.replace('/normal/', '/large/');
    return smallUrl;
  }

  // Enrich a raw index record for use by the app UI: adds thumb + hires + a
  // display-friendly copy of the compact keys.
  function enrichCard(rec) {
    if (!rec) return null;
    return {
      id:          rec.id,
      card_name:   rec.n,
      set_name:    rec.s,
      set_id:      rec.si,
      set_code:    rec.sc || '',
      card_number: rec.nu,
      rarity:      rec.r || '',
      phash:       rec.p,
      dhash:       rec.d,
      image_small: rec.i,   // 245x342 - use as thumb for instant paint
      image_large: deriveLargeUrl(rec.i), // hires - use in detail modal
      game:        rec.g || 'pokemon',    // 2026-08-22: game marker
    };
  }

  // Main entry: given a File (from input), returns { hit, card, distance } or { hit: false }
  async function scanFile(file) {
    const t0 = performance.now();
    // Load index in parallel with image decoding
    const indexPromise = loadCardIndex().catch(e => {
      console.warn('[fastpath] Index load failed:', e);
      return null;
    });

    // Decode image to canvas
    const img = new Image();
    const url = URL.createObjectURL(file);
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });
    URL.revokeObjectURL(url);

    // Detect card bounds
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    let bounds = detectCardBounds(imgData, canvas.width, canvas.height);
    if (!bounds) {
      // Fallback: use whole image
      bounds = { x: 0, y: 0, w: canvas.width, h: canvas.height };
    }

    // Crop to card
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = bounds.w;
    cropCanvas.height = bounds.h;
    cropCanvas.getContext('2d').drawImage(canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);

    // Compute hashes for BOTH the auto-cropped canvas and the raw uncropped
    // canvas. tools/seed_set.py builds the index from raw uncropped card
    // images, so a tight scan/screenshot matches the UNCROPPED hash, while a
    // phone photo with table/hand background needs the CROPPED one. Scoring
    // min() over both means we never have to guess which kind of input we got.
    // Cost is one extra pair of hashes (~10ms) and one extra compare per
    // index record; the NN loop is ~68ms over 32k records.
    const t1 = performance.now();
    const ph = computePHash(cropCanvas);
    const dh = computeDHash(cropCanvas);
    const phRaw = computePHash(canvas);
    const dhRaw = computeDHash(canvas);
    console.log(`[fastpath] hashes computed in ${(performance.now()-t1).toFixed(0)}ms  crop p=${ph} d=${dh}  raw p=${phRaw} d=${dhRaw}`);

    // Wait for index
    const idx = await indexPromise;
    if (!idx) {
      return { hit: false, reason: 'index unavailable', ph, dh, cropCanvas };
    }

    // Nearest neighbor
    const t2 = performance.now();
    let bestDist = 999, bestCard = null;
    let secondDist = 999;
    let bestUsedRaw = false;
    for (const c of idx) {
      const dCrop = hamming(ph,    c.p) * 2 + hamming(dh,    c.d);
      const dRaw  = hamming(phRaw, c.p) * 2 + hamming(dhRaw, c.d);
      const d = dCrop < dRaw ? dCrop : dRaw;
      if (d < bestDist) {
        bestUsedRaw = dRaw <= dCrop;
        secondDist = bestDist;
        bestDist = d;
        bestCard = c;
      } else if (d < secondDist) {
        secondDist = d;
      }
    }
    console.log(`[fastpath] NN over ${idx.length} in ${(performance.now()-t2).toFixed(0)}ms — best=${bestDist} 2nd=${secondDist} → ${bestCard?.n} / ${bestCard?.s}`);

    // Confidence gate — see the calibration note at the top of this IIFE.
    // Do NOT raise CONFIDENCE_MAX without re-running the calibration harness:
    // a false accept shows the user a confidently WRONG card, which is worse
    // than an honest "not recognized".
    const CONFIDENCE_MAX = 20;
    const GAP_MIN = 6;
    const totalMs = (performance.now() - t0).toFixed(0);
    if (bestDist <= CONFIDENCE_MAX && (secondDist - bestDist) >= GAP_MIN) {
      console.log(`[fastpath] HIT in ${totalMs}ms`);
      return {
        hit: true,
        card: enrichCard(bestCard),
        distance: bestDist,
        secondDistance: secondDist,
        totalMs,
        source: 'phash',
        matchedOn: bestUsedRaw ? 'uncropped' : 'cropped',
        // 2026-09-03: expose hashes on the HIT path too, so the rerank and
        // telemetry paths can read them without re-hashing the image.
        ph, dh, phRaw, dhRaw,
      };
    }

    console.log(`[fastpath] MISS (best=${bestDist}, gap=${secondDist-bestDist}) — falling through to LLM`);
    return {
      hit: false,
      reason: `best=${bestDist} gap=${secondDist-bestDist}`,
      bestGuess: enrichCard(bestCard),
      bestDist,
      secondDist,
      ph, dh, phRaw, dhRaw,
      cropCanvas,
      totalMs,
    };
  }

  // Expose
  window.CardResellFastPath = {
    scanFile,
    loadCardIndex,
    computePHash,
    computeDHash,
    hamming,
    enrichCard,
    deriveLargeUrl,
    // 2026-08-21: expose detectCardBounds so compressImage() can reuse
    // it for client-side auto-crop before uploading to /api/scan.
    detectCardBounds,
  };
})();

// 2026-08-20: Photo QC (blur/dupe/low-res) gates. Rejects bad photos
// BEFORE they consume a Ximilar credit or hit /api/scan. See
// /home/user/workspace/cardresell/js/photo-qc.js for the source.
// NOTE: inlined directly into the parent <script> block — do NOT wrap in
// its own <script> tag, that would break the parent block and dump the
// rest of the page's inline JS into the DOM as text (root cause of the
// 2026-08-20 sign-in-return blank-page bug).
// photo-qc.js (2026-08-20)
// Client-side quality gates that reject bad photos BEFORE we spend a
// Ximilar / API credit. Three gates:
//
//  1. LOW-RES: reject images whose short edge is below 400px (a scanned
//     card is typically 600x825 at minimum; anything smaller is guaranteed
//     to fail identification).
//
//  2. BLUR: variance-of-Laplacian on a downsampled grayscale copy. The
//     standard cheap CV blur check. Threshold tuned empirically:
//       - crisp card:      variance >  600
//       - slightly blurry: variance ~  200-400  (still usable)
//       - motion blur:     variance <  100      (reject)
//     We use 120 as the reject threshold (aggressive on blur, lenient on
//     everything else).
//
//  3. DUPE: perceptual hash of the current image compared against the
//     last N scans in this session (in-memory only, per-tab). If the new
//     hash is within Hamming distance 6 of a recent one, flag as dupe.
//     User can override ("Yes, scan again" button in the UI).
//
// Public API: window.CardResellPhotoQC.check(file) -> Promise<QCResult>
//
//   QCResult = {
//     ok: boolean,
//     reasons: [string, ...],   // list of failure reasons, empty if ok
//     details: {
//       width, height,
//       blurScore,              // higher = sharper; null if not run
//       phash,                  // 64-bit dHash as hex string
//       dupOfHash,              // hash we matched against (if any)
//     }
//   }

(function () {
  'use strict';

  const MIN_SHORT_EDGE = 400;   // pixels
  const BLUR_THRESHOLD = 120;   // variance of Laplacian; below = blurry
  // 2026-08-21: DUPE_DISTANCE tightened from 6 to 4. Two DIFFERENT cards
  // shot on the same background (same keyboard, same hand pose) were
  // routinely landing within 6 Hamming bits on dHash alone — the frame's
  // large-scale luminance gradients dominated the 64-bit signal. Now
  // combined with cropped hashing (see below) we can afford a tighter
  // threshold on the card region itself.
  const DUPE_DISTANCE  = 4;     // Hamming on cropped card; <= is a dupe
  const RECENT_HASH_CAP = 8;    // keep last 8 scans

  const recentHashes = []; // ring buffer of hex strings

  // ── helpers ────────────────────────────────────────────────────────
  function loadBitmap(file) {
    return new Promise((resolve, reject) => {
      // Prefer createImageBitmap where available (Safari 15+, all modern)
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(file).then(resolve).catch(reject);
        return;
      }
      // Fallback: HTMLImageElement
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  function drawToCanvas(source, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    return { canvas: c, ctx };
  }

  // Variance of Laplacian on a downsampled grayscale copy.
  // Returns a positive number; higher = sharper.
  function blurScore(bitmap) {
    // Downsample to 256px on the short edge for consistent scoring.
    const sw = bitmap.width, sh = bitmap.height;
    const short = Math.min(sw, sh);
    const scale = short > 256 ? 256 / short : 1;
    const w = Math.max(64, Math.round(sw * scale));
    const h = Math.max(64, Math.round(sh * scale));
    const { ctx } = drawToCanvas(bitmap, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    // Grayscale luma.
    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      // Rec. 709 luma; alpha ignored
      gray[p] = 0.2126 * data[i] + 0.7152 * data[i+1] + 0.0722 * data[i+2];
    }
    // 3x3 Laplacian kernel:  0 -1  0
    //                       -1  4 -1
    //                        0 -1  0
    let sum = 0, sumSq = 0, n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const v = 4 * gray[i]
                - gray[i - 1] - gray[i + 1]
                - gray[i - w] - gray[i + w];
        sum   += v;
        sumSq += v * v;
        n++;
      }
    }
    if (n === 0) return 0;
    const mean = sum / n;
    return (sumSq / n) - (mean * mean); // variance
  }

  // Difference-hash: 8x9 -> 64 bits. Returns hex string.
  function dHash(bitmap) {
    const w = 9, h = 8;
    const { ctx } = drawToCanvas(bitmap, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] = (0.2126 * data[i] + 0.7152 * data[i+1] + 0.0722 * data[i+2]) | 0;
    }
    // Compare each pixel to the one to its right; bit = 1 if left > right.
    let bits = 0n;
    let shift = 63n;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w - 1; x++) {
        const i = y * w + x;
        if (gray[i] > gray[i + 1]) bits |= (1n << shift);
        shift--;
      }
    }
    // pad to 16 hex chars
    return bits.toString(16).padStart(16, '0');
  }

  function hamming(hexA, hexB) {
    if (!hexA || !hexB) return 64;
    const a = BigInt('0x' + hexA);
    const b = BigInt('0x' + hexB);
    let x = a ^ b;
    let count = 0;
    while (x) { count += Number(x & 1n); x >>= 1n; }
    return count;
  }

  function recordHash(hex) {
    recentHashes.push({ hex, ts: Date.now() });
    while (recentHashes.length > RECENT_HASH_CAP) recentHashes.shift();
  }

  function findDupe(hex) {
    for (let i = recentHashes.length - 1; i >= 0; i--) {
      const d = hamming(hex, recentHashes[i].hex);
      if (d <= DUPE_DISTANCE) return { hex: recentHashes[i].hex, distance: d };
    }
    return null;
  }

  // ── public API ─────────────────────────────────────────────────────
  async function check(file, opts = {}) {
    const skipDupe = !!opts.skipDupe;

    const details = {
      width: null, height: null,
      blurScore: null,
      phash: null,
      dupOfHash: null,
    };
    const reasons = [];

    let bitmap;
    try {
      bitmap = await loadBitmap(file);
    } catch (e) {
      return { ok: false, reasons: ['unreadable'], details };
    }
    details.width  = bitmap.width;
    details.height = bitmap.height;

    // Gate 1: low-res
    const shortEdge = Math.min(bitmap.width, bitmap.height);
    if (shortEdge < MIN_SHORT_EDGE) {
      reasons.push('low_resolution');
    }

    // Gate 2: blur (only if resolution is high enough to be worth measuring)
    if (shortEdge >= 200) {
      try {
        details.blurScore = Math.round(blurScore(bitmap));
        if (details.blurScore < BLUR_THRESHOLD) {
          reasons.push('blurry');
        }
      } catch (e) {
        // Blur check failure is non-fatal; just log and continue.
        console.warn('[photo-qc] blur check failed', e);
      }
    }

    // Gate 3: dupe (unless caller opted out — e.g. user pressed "scan again")
    // 2026-08-21: hash the CROPPED card region, not the whole frame. Two
    // different cards on the same background were false-positiving on
    // dHash of the raw photo because the frame's luminance layout was
    // near-identical (same keyboard, same hand). Cropping to the card
    // silhouette (via the fastpath's detectCardBounds) makes the hash
    // reflect the card art, not the desk.
    try {
      let hashSource = bitmap;
      try {
        const detect = window.CardResellFastPath && window.CardResellFastPath.detectCardBounds;
        if (detect && bitmap && bitmap.width && bitmap.height) {
          const fc = document.createElement('canvas');
          fc.width = bitmap.width; fc.height = bitmap.height;
          const fctx = fc.getContext('2d');
          fctx.drawImage(bitmap, 0, 0);
          const imgData = fctx.getImageData(0, 0, fc.width, fc.height).data;
          const bounds = detect(imgData, fc.width, fc.height);
          if (bounds) {
            const area  = bounds.w * bounds.h;
            const total = fc.width * fc.height;
            const ratio = area / total;
            const aspect = bounds.h > 0 ? bounds.w / bounds.h : 0;
            const goodPortrait  = ratio >= 0.25 && aspect >= 0.55 && aspect <= 0.85;
            const goodLandscape = ratio >= 0.25 && aspect >= 1.15 && aspect <= 1.80;
            if (goodPortrait || goodLandscape) {
              const cc = document.createElement('canvas');
              cc.width = bounds.w; cc.height = bounds.h;
              cc.getContext('2d').drawImage(fc, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
              hashSource = cc;
            }
          }
        }
      } catch(cropErr) {
        // fall through to full-frame hash if crop fails
        try { console.warn('[photo-qc] crop-for-dupe failed:', cropErr && cropErr.message); } catch(_){}
      }
      details.phash = dHash(hashSource);
      if (!skipDupe) {
        const dup = findDupe(details.phash);
        if (dup) {
          details.dupOfHash = dup.hex;
          reasons.push('duplicate');
        }
      }
      // Record AFTER dupe check so we don't dupe against ourselves.
      recordHash(details.phash);
    } catch (e) {
      console.warn('[photo-qc] phash failed', e);
    }

    // Release bitmap memory eagerly on browsers that support close()
    if (bitmap && typeof bitmap.close === 'function') {
      try { bitmap.close(); } catch(_) {}
    }

    return { ok: reasons.length === 0, reasons, details };
  }

  function reset() { recentHashes.length = 0; }

  window.CardResellPhotoQC = { check, reset, MIN_SHORT_EDGE, BLUR_THRESHOLD, DUPE_DISTANCE };
})();

// Restore Google session on page load
// Session restore handled by Firebase onAuthStateChanged


function getUserKey(suffix) {
  return window.googleUser ? 'cardsell_' + window.googleUser.sub + '_' + suffix : 'cardsell_' + suffix;
}

// Example card auto-load removed — app opens on clean homepage

// ── One-time migration of pre-auth (anonymous) localStorage data ──
// Prior to the auth/JWKS fix (Jul 2026), cards saved before sign-in landed in the
// unscoped keys `cardsell_portfolio` / `cardsell_flips`. Once sign-in works and
// `getUserKey` starts prefixing with the uid, those cards would vanish from the UI
// unless we merge them into the user-scoped keys. Runs once per uid.
function _migrateAnonDataToUser() {
  try {
    if (!window.googleUser || !window.googleUser.sub) return;
    const uid = window.googleUser.sub;
    const flagKey = 'cardsell_migrated_' + uid;
    if (localStorage.getItem(flagKey)) return;

    const pairs = [
      { anon: 'cardsell_portfolio', user: 'cardsell_' + uid + '_portfolio' },
      { anon: 'cardsell_flips',     user: 'cardsell_' + uid + '_flips'     }
    ];
    let migrated = 0;
    pairs.forEach(({ anon, user }) => {
      const anonRaw = localStorage.getItem(anon);
      if (!anonRaw) return;
      let anonArr = [];
      try { anonArr = JSON.parse(anonRaw) || []; } catch(e) { return; }
      if (!Array.isArray(anonArr) || !anonArr.length) return;

      let userArr = [];
      try { userArr = JSON.parse(localStorage.getItem(user) || '[]') || []; } catch(e) {}
      if (!Array.isArray(userArr)) userArr = [];

      // Merge, de-duping by id when possible
      const seen = new Set(userArr.map(x => x && x.id).filter(Boolean));
      anonArr.forEach(x => { if (x && (!x.id || !seen.has(x.id))) userArr.push(x); });

      try {
        localStorage.setItem(user, JSON.stringify(userArr));
        localStorage.removeItem(anon); // prevent leaking into a different account later
        migrated += anonArr.length;
      } catch(e) {}
    });

    try { localStorage.setItem(flagKey, '1'); } catch(e) {}
    if (migrated > 0) {
      try { showToast(migrated + ' saved card' + (migrated !== 1 ? 's' : '') + ' restored to your collection 📦', 'success'); } catch(e) {}
    }
  } catch(e) { /* non-fatal */ }
}

function loadUserData() {
  // Migrate any pre-sign-in data into the user-scoped keys first
  _migrateAnonDataToUser();
  // Reload flips view if it's active so it shows the signed-in user's data
  if (document.getElementById('flipsView')?.classList.contains('active')) renderFlipsView();
  // Force-render collection whether or not it's the active view — cards may have just
  // been migrated in, and if the user is on the Collection tab we need a fresh render
  // now that _userSub is set (an earlier attempt may have bailed on the sign-in check).
  _maybeRerenderCollection(true);
  // 2026-08-19: pull cross-device snapshot from the server so cards added
  // on another signed-in device show up here. Runs in background — UI is
  // already rendered from local, and the pull re-renders on merge.
  try { _pullUserData(); } catch(e) {}
}

// Override storage helpers to be user-scoped when signed in
// ── Durable localStorage writes (2026-09-04) ──
// savePortData / saveFlipsData / saveGradingData used to swallow every storage
// exception and return nothing, so a full-quota device silently discarded the
// write while the caller closed its modal and re-rendered as if the save had
// succeeded. The audit forced QuotaExceededError on the portfolio key, clicked
// Save, and observed: stored portfolio null, modal closed, no error shown --
// the card was simply gone. Every writer now goes through _lsWrite, which
// reports success so callers can keep the modal open and tell the truth.
window._lastStorageFailure = null;

function _lsWrite(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    // Safari private mode and Firefox use different names/codes for "full".
    const name = (e && e.name) || '';
    const code = e && e.code;
    const isQuota = name === 'QuotaExceededError'
      || name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || code === 22 || code === 1014;
    window._lastStorageFailure = { key, quota: isQuota, at: Date.now(), message: (e && e.message) || String(e) };
    try { console.error('[storage] write failed for', key, e); } catch(_) {}
    return false;
  }
}

// Human-readable reason for the most recent failed write. Callers surface this
// instead of pretending the save worked.
function storageFailureMessage() {
  const f = window._lastStorageFailure;
  if (f && f.quota) return 'Your browser storage is full, so this could not be saved. Export your Collection as CSV, then clear some space and try again.';
  return 'Your browser blocked this save, so it was not stored. If you are in private browsing, try a normal window.';
}

// Report a failed write once, consistently, from any save path.
function _reportStorageFailure() {
  try { showToast(storageFailureMessage(), 'error'); } catch(_) {}
  try { window.trackEvent?.('storage_write_failed', { quota: !!(window._lastStorageFailure||{}).quota }); } catch(_) {}
  return false;
}

/* ── Deletion tombstones (2026-09-04) ──
   _pullUserData() unions the remote snapshot with the local one by id. Set
   union is not a conflict-resolution strategy for deletion: a single-row
   delete only wrote the shorter local array, so the next pull unioned the
   still-remote row straight back in and the card returned from the dead. The
   server compounded it -- /api/user-data ran its own _mergeById on POST, so a
   shorter array never removed anything server-side either.

   Fix: record a tombstone {id -> deletedAt} per collection when a row is
   deleted, ship tombstones with every push, and apply them on both sides of
   the sync. A row survives a tombstone only if its own updatedAt is NEWER
   than the deletedAt, which is what makes delete-then-re-add work. Rows with
   no updatedAt at all (written before this change) lose to the tombstone: an
   explicit user deletion is better evidence than an unknown row age.

   Tombstones are compacted after the retention window so the blob cannot grow
   without bound. */
const _TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const _TOMBSTONE_MAX    = 500;                      // hard cap per collection

function loadTombstones() {
  try {
    const t = JSON.parse(localStorage.getItem(getUserKey('tombstones')) || '{}');
    return {
      portfolio: (t && typeof t.portfolio === 'object' && t.portfolio) || {},
      flips:     (t && typeof t.flips     === 'object' && t.flips)     || {},
    };
  } catch(e) { return { portfolio: {}, flips: {} }; }
}

function _saveTombstones(t) {
  return _lsWrite(getUserKey('tombstones'), JSON.stringify(_compactTombstones(t)));
}

// Drop tombstones past the retention window, then trim the oldest if we are
// still over the cap. Returns a new object; does not mutate the input.
function _compactTombstones(t, nowMs) {
  const now = nowMs || Date.now();
  const out = { portfolio: {}, flips: {} };
  for (const kind of ['portfolio','flips']) {
    const src = (t && t[kind]) || {};
    let entries = Object.keys(src)
      .map(id => [id, Number(src[id]) || 0])
      .filter(([, at]) => at > 0 && (now - at) < _TOMBSTONE_TTL_MS);
    if (entries.length > _TOMBSTONE_MAX) {
      entries.sort((a, b) => b[1] - a[1]);          // newest first
      entries = entries.slice(0, _TOMBSTONE_MAX);
    }
    for (const [id, at] of entries) out[kind][id] = at;
  }
  return out;
}

// Mark ids as deleted. `kind` is 'portfolio' or 'flips'.
function _addTombstones(kind, ids) {
  if (kind !== 'portfolio' && kind !== 'flips') return false;
  const list = (Array.isArray(ids) ? ids : [ids]).filter(id => id != null);
  if (!list.length) return true;
  const t = loadTombstones();
  const now = Date.now();
  for (const id of list) t[kind][String(id)] = now;
  return _saveTombstones(t);
}

// Filter rows the user has deleted. A row survives only when its own
// updatedAt beats the tombstone.
function _applyTombstones(rows, marks) {
  if (!Array.isArray(rows) || !marks) return Array.isArray(rows) ? rows : [];
  return rows.filter(row => {
    if (!row || row.id == null) return false;
    const deletedAt = Number(marks[String(row.id)]) || 0;
    if (!deletedAt) return true;
    const rowAt = Number(row.updatedAt) || 0;
    return rowAt > deletedAt;
  });
}

function loadFlipsData() {
  try { return JSON.parse(localStorage.getItem(getUserKey('flips')) || '[]'); } catch(e) { return []; }
}
function saveFlipsData(data) {
  const ok = _lsWrite(getUserKey('flips'), JSON.stringify(data));
  _scheduleUserDataSync(); // 2026-08-19: propagate to cloud so other devices see it
  return ok;
}
function loadPortData() {
  try { return JSON.parse(localStorage.getItem(getUserKey('portfolio')) || '[]'); } catch(e) { return []; }
}
function savePortData(data) {
  const ok = _lsWrite(getUserKey('portfolio'), JSON.stringify(data));
  _scheduleUserDataSync(); // 2026-08-19: propagate to cloud so other devices see it
  return ok;
}

// ── Cross-device sync (2026-08-19) ──
// User reported: "collection doesn’t save from mobile to desktop even
// signed into the same account". Root cause: portfolio + flips lived in
// localStorage only, which is per-device. Fix: mirror both to KV via
// /api/user-data on every save (debounced), and pull on sign-in.
//
// Design:
// * Every save writes localStorage first (instant, offline-safe), then
//   schedules a debounced push — UI stays fast, we don't spam the API.
// * On sign-in, we pull the server snapshot and merge with local by id,
//   using last-write-wins on client vs server timestamps. Then we push
//   the merged result back so both sides converge.
// * If the user is signed out we skip the network entirely.
// * All errors are silent — sync is best-effort, local always works.
let _userDataSyncTimer = null;
let _userDataSyncing   = false;
function _scheduleUserDataSync() {
  if (!window.googleUser || !window._googleIdToken) return;
  if (_userDataSyncTimer) clearTimeout(_userDataSyncTimer);
  // 1.5s debounce — covers rapid multi-save flows (bulk scan, refresh prices)
  _userDataSyncTimer = setTimeout(_pushUserData, 1500);
}
// Sign-out cancels any debounced push. _pushUserData also re-checks the token,
// so a fired-but-stale timer is harmless; this just avoids the pointless call.
window._cancelUserDataSync = function () {
  if (_userDataSyncTimer) { clearTimeout(_userDataSyncTimer); _userDataSyncTimer = null; }
};
async function _pushUserData() {
  if (_userDataSyncing) return;
  if (!window.googleUser || !window._googleIdToken) return;
  _userDataSyncing = true;
  try {
    const portfolio = loadPortDataRaw();
    const flips     = loadFlipsDataRaw();
    // Ship tombstones so the server can drop deleted rows too. Without them
    // /api/user-data's own _mergeById kept resurrecting anything the client
    // had removed, and the next pull handed it straight back.
    const tombstones = loadTombstones();
    await fetch('/api/user-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + window._googleIdToken,
      },
      body: JSON.stringify({ portfolio, flips, tombstones, clientUpdatedAt: Date.now() }),
    });
  } catch(e) { /* offline / network issue — next save will retry */ }
  finally { _userDataSyncing = false; }
}
// Non-syncing raw reads used by the sync loop itself, so pushing doesn't
// re-schedule another push in a loop.
function loadPortDataRaw() {
  try { return JSON.parse(localStorage.getItem(getUserKey('portfolio')) || '[]'); } catch(e) { return []; }
}
function loadFlipsDataRaw() {
  try { return JSON.parse(localStorage.getItem(getUserKey('flips')) || '[]'); } catch(e) { return []; }
}
// Pull server snapshot on sign-in, merge into local by id (union), and push
// merged result back so both device and server hold the same final state.
async function _pullUserData() {
  if (!window.googleUser || !window._googleIdToken) return;
  try {
    const r = await fetch('/api/user-data', {
      headers: { 'Authorization': 'Bearer ' + window._googleIdToken },
    });
    if (!r.ok) return;
    const remote = await r.json();
    const remotePort  = Array.isArray(remote.portfolio) ? remote.portfolio : [];
    const remoteFlips = Array.isArray(remote.flips)     ? remote.flips     : [];
    const localPort   = loadPortDataRaw();
    const localFlips  = loadFlipsDataRaw();
    // Merge the server's tombstones with ours first, so a delete performed on
    // another device is honoured here even though this device never saw it.
    const localMarks  = loadTombstones();
    const remoteMarks = (remote && typeof remote.tombstones === 'object' && remote.tombstones) || {};
    const marks = _mergeTombstones(localMarks, remoteMarks);
    try { _saveTombstones(marks); } catch(e) {}
    // Union by id — favours the local row if id collides (user just added
    // it on this device; the server copy may be older) — then subtract
    // anything either side has deleted. Union alone resurrected deleted rows.
    const mergedPort  = _applyTombstones(_unionById(remotePort,  localPort),  marks.portfolio);
    const mergedFlips = _applyTombstones(_unionById(remoteFlips, localFlips), marks.flips);
    _lsWrite(getUserKey('portfolio'), JSON.stringify(mergedPort));
    _lsWrite(getUserKey('flips'),     JSON.stringify(mergedFlips));
    // Push merged result back so the server also has the union.
    _scheduleUserDataSync();
    // Refresh visible views so newly-pulled cards render immediately.
    try { _maybeRerenderCollection(true); } catch(e) {}
    try { if (document.getElementById('flipsView')?.classList.contains('active')) renderFlipsView(); } catch(e) {}
    const pulled = (mergedPort.length - localPort.length) + (mergedFlips.length - localFlips.length);
    if (pulled > 0) {
      try { showToast(pulled + ' item' + (pulled !== 1 ? 's' : '') + ' synced from your other device 🔄', 'success'); } catch(e) {}
    }
  } catch(e) { /* silent — sync is best-effort */ }
}
function _unionById(a, b) {
  const map = new Map();
  for (const row of (a || [])) if (row && row.id != null) map.set(String(row.id), row);
  // b (local) overwrites a (remote) on id collision — local is more likely
  // to hold fresh price/refresh state.
  for (const row of (b || [])) if (row && row.id != null) map.set(String(row.id), row);
  return Array.from(map.values());
}

/* ── Cross-tab reconciliation (2026-09-04) ──
   The `storage` event fires in every OTHER tab of the same origin when one tab
   writes. Without it, a second tab kept rendering the pre-change snapshot and
   its next save wrote that stale view back. Merge-at-commit in
   _commitPortfolioRefresh is what actually makes concurrent edits safe; this
   listener is the UI half, so the other tab stops showing data it no longer
   has. Do not rely on the listener alone for conflict safety -- it is
   advisory, best-effort, and never fires in the tab that made the change. */
window.addEventListener('storage', (e) => {
  try {
    if (!e || !e.key) return;
    if (e.key === getUserKey('portfolio')) {
      try { _maybeRerenderCollection(true); } catch(_) {}
    } else if (e.key === getUserKey('flips')) {
      const v = document.getElementById('flipsView');
      if (v && v.classList.contains('active')) { try { renderFlipsView(); } catch(_) {} }
    } else if (e.key === getUserKey('tombstones')) {
      // Another tab deleted something. Re-apply marks locally so this tab
      // does not push a snapshot that reinstates the deleted rows.
      const marks = loadTombstones();
      const port  = _applyTombstones(loadPortData(),  marks.portfolio);
      const flips = _applyTombstones(loadFlipsData(), marks.flips);
      _lsWrite(getUserKey('portfolio'), JSON.stringify(port));
      _lsWrite(getUserKey('flips'),     JSON.stringify(flips));
      try { _maybeRerenderCollection(true); } catch(_) {}
    }
  } catch(_) { /* advisory only */ }
});

// Combine two tombstone sets, keeping the LATEST deletedAt per id. A delete is
// sticky: if either device recorded it, the row stays deleted unless the row
// itself was re-added afterwards (checked via updatedAt in _applyTombstones).
function _mergeTombstones(a, b) {
  const out = { portfolio: {}, flips: {} };
  for (const kind of ['portfolio','flips']) {
    const src = [((a||{})[kind])||{}, ((b||{})[kind])||{}];
    for (const m of src) {
      for (const id of Object.keys(m)) {
        const at = Number(m[id]) || 0;
        if (at > (out[kind][id] || 0)) out[kind][id] = at;
      }
    }
  }
  return _compactTombstones(out);
}



/* =========================================================
   PRO / PAYWALL — Shop, checkout, status
   ========================================================= */

window._isPro = false;
window._freeScansLeft = 0;
window._scanCredits = 0;   // paid grading scan credits
window._idScanCredits = 0; // paid ID scan credits
// 2026-09-02 (CR-021): pro-status has always returned idFreeLeft (the monthly
// tier ID-scan allowance) but the client never stored it, so any "how many ID
// scans do I have" surface could only see PAID credits and under-reported.
// The shop balance card needs free + paid to match what the scanner enforces.
window._freeIdLeft = 0;    // monthly tier ID scan allowance remaining

// ── Check Pro status from server ──
async function checkProStatus() {
  // If auth hasn't resolved yet, wait for it
  await window._waitForAuth();
  if (!window.googleUser || !window._googleIdToken) return;
  try {
    const refParam = window._pendingRefCode ? '?ref=' + encodeURIComponent(window._pendingRefCode) : '';
    const r = await fetch('/api/pro-status' + refParam, {
      headers: { 'Authorization': 'Bearer ' + window._googleIdToken }
    });
    if (r.status === 401) {
      // 2026-09-04: the endpoint now distinguishes "expired session" from
      // "free account". Don't overwrite tier or credit state with zeros --
      // that told paying users they had nothing. Drop the dead token and ask
      // for a fresh sign-in instead.
      window._googleIdToken = null;
      window._sessionExpired = true;
      try { showToast('Your session expired. Sign in again to see your plan and credits.', 'info'); } catch (_) {}
      return;
    }
    if (!r.ok) return;
    window._sessionExpired = false;
    const d = await r.json();
    window._isPro = d.isPro === true;
    window._userTier = d.tier || (d.isPro ? 'pro' : 'free');
    if (window._isPro) {
      const exportGLBtn = document.getElementById('exportGradingLogBtn');
      if (exportGLBtn) exportGLBtn.style.display = '';
    }
    window._freeScansLeft = d.freeScansLeft || 0;
    window._scanCredits = d.paidScansLeft || 0;
    window._idScanCredits = d.idPaidLeft || 0;
    window._freeIdLeft = d.idFreeLeft || 0;
    // Update tier-conditional UI (badge, etc.)
    if (typeof updateTierUI === 'function') { try { updateTierUI(window._userTier); } catch(e) {} }
    // Unlocked set just changed, so the chip count and the queued Pro welcome
    // both depend on this resolved tier.
    try { syncVenueChips(); } catch (_) {}
    if (window._proWelcomePending) {
      window._proWelcomePending = false;
      try { maybeShowProWelcome(); } catch (_) {}
    }
    // Refresh the ID Scan / AI Grade button badges now that we have fresh counts.
    // Without this the ID Scan button label stays credit-less on the home screen
    // even when the user has plenty of credits.
    if (typeof updateScanBtnCredits === 'function') { try { updateScanBtnCredits(); } catch(e) {} }
    // Sync client state if server sees verification differently (e.g. token refresh needed)
    if (typeof d.emailVerified === 'boolean' && window.googleUser) {
      const prev = window.googleUser.emailVerified;
      window.googleUser.emailVerified = d.emailVerified;
      window._emailVerified = d.emailVerified;
      if (prev !== d.emailVerified) {
        const vBadge = document.getElementById('verifiedBadge');
        if (vBadge) vBadge.style.display = d.emailVerified ? 'inline-flex' : 'none';
        _updateVerifyBanner?.();
      }
    }
    // Store which email is currently verified (for settings "Change email" UI)
    if (typeof d.verifiedEmail === 'string') {
      window._verifiedEmail = d.verifiedEmail;
    }
    try { _updateVerifiedEmailPanel?.(); } catch(e) {}
    // Store referral code and show reward toast if applicable
    if (d.refCode) {
      window._userRefCode = d.refCode;
      const refSec = document.getElementById('referSection');
      if (refSec) refSec.style.display = '';
    }
    if (d.isNewSignup) {
      setTimeout(() => {
        showToast('🎁 Welcome! Your 10 ID scans & 1 AI Grade are ready — tap Scan to try it.', 6000);
      }, 800);
    } else if (d.refRewarded) {
      setTimeout(() => showToast('🎉 Referral bonus! You and your friend both got 5 free ID scans.', 5000), 1200);
    }
    // Clear pending ref so it only fires once.
    // 2026-08-18: also clear localStorage — previously only wiped window state,
    // so a subsequent page reload would re-attempt the claim (harmless because
    // server-side ref_claimed:<sub>=1 prevents double-credit, but wastes a KV
    // read on every load and confuses debugging).
    window._pendingRefCode = null;
    try { localStorage.removeItem('_pendingRefCode'); } catch(e) {}
  } catch(e) { /* non-blocking */ }
  updateProUI();
  updateScanBtnCredits();
  // Always refresh credits panel (not just when settings is open)
  loadSettingsScanCredits();
  // Re-render collection view if it's active
  _maybeRerenderCollection();
  // Show admin tab for owner
  _maybeShowAdminTab();
  // Prefill newsletter email for signed-in users
  const nlInput = document.getElementById('newsletterEmail');
  if (nlInput && !nlInput.value && window._userEmail) nlInput.value = window._userEmail;
}

// ── Update all Pro-related UI elements ──
// Header now uses a SINGLE context-aware button:
//   Pro user  → clickable PRO badge (opens pricing modal to manage / buy credits)
//   Everyone else → "Upgrade" button (opens same pricing modal)
// The old standalone Shop button is gone — credit packs live inside the same modal.
function updateProUI() {
  const proBadge   = document.getElementById('proBadge');
  const getProBtn  = document.getElementById('getProBtn');
  const promoBanner= document.getElementById('promoBanner');

  if (!window.googleUser) {
    // Not signed in — show Upgrade (leads to sign-in on checkout) + no PRO badge
    proBadge?.classList.remove('visible');
    getProBtn?.classList.add('visible');
    promoBanner?.classList.remove('visible');
    // Show sign-in nudge unless dismissed
    try {
      if (!sessionStorage.getItem('cs_nudge_dismissed')) {
        const nudge = document.getElementById('signInNudge');
        if (nudge) nudge.style.display = 'flex';
      }
    } catch(e) {}
    return;
  }

  // Always hide nudge when signed in
  const signInNudge = document.getElementById('signInNudge');
  if (signInNudge) signInNudge.style.display = 'none';
  // Update flips wall now that sign-in state changed
  _updateFlipsSignInWall();

  // Show/hide Manage billing button
  const manageSub = document.getElementById('manageSubSection');
  if (manageSub) manageSub.style.display = window._isPro ? '' : 'none';

  if (window._isPro) {
    // Signed in + Pro — clickable PRO badge is the only header CTA.
    proBadge?.classList.add('visible');
    getProBtn?.classList.remove('visible');
    promoBanner?.classList.remove('visible');
  } else {
    // Signed in but free — Upgrade button + promo banner
    proBadge?.classList.remove('visible');
    getProBtn?.classList.add('visible');
    // Show banner unless dismissed this session
    const dismissed = sessionStorage.getItem('cs_banner_dismissed');
    if (!dismissed) {
      promoBanner?.classList.add('visible');
    }
    // Update pricing modal Pro button label
    const pricingProBtnText = document.getElementById('pricingProBtnText');
    if (pricingProBtnText) pricingProBtnText.textContent = 'Get Pro — $9.99/mo';
  }
}

function dismissPromoBanner() {
  document.getElementById('promoBanner')?.classList.remove('visible');
  try { sessionStorage.setItem('cs_banner_dismissed', '1'); } catch(e) {}
}

// ── Update scan button credit badges ──
function updateScanBtnCredits() {
  const idSpan    = document.getElementById('idScanSubCredits');
  const gradeSpan = document.getElementById('gradeScanSubCredits');
  if (idSpan) {
    const n = window._idScanCredits || 0;
    if (n > 0) {
      idSpan.textContent = `· ${n} credit${n !== 1 ? 's' : ''}`;
      idSpan.style.opacity = '1';
      idSpan.style.color   = 'var(--gold)';
    } else {
      idSpan.textContent = '';
    }
  }
  if (gradeSpan) {
    const n = (window._scanCredits || 0) + (window._freeScansLeft || 0);
    if (n > 0) {
      gradeSpan.textContent = `· ${n} credit${n !== 1 ? 's' : ''}`;
      gradeSpan.style.opacity = '1';
      gradeSpan.style.color   = 'var(--gold)';
    } else {
      gradeSpan.textContent = '';
    }
  }
}

// ── Open / close pricing modal ──
function openPricingModal(source) {
  const overlay = document.getElementById('pricingOverlay');
  if (overlay) overlay.classList.add('open');
  _dialogOpened('pricingOverlay');
  // 2026-08-20: instrument every pricing-modal open with its trigger source.
  // This is the primary conversion-funnel event — we track WHICH prompt got
  // the user to see pricing (grade_result_cta, id_scan_402, flips_cap, etc.).
  try {
    window.trackEvent && window.trackEvent('pricing_modal_open', {
      source: source || 'unknown',
      current_tier: window._userTier || (window._isPro ? 'pro' : 'free'),
      signed_in: !!(window._user && window._user.uid),
    });
  } catch(e) {}
  // Reset to Monthly view each open
  setPricingMode('monthly');
  // Disable the button for the user's current tier
  const currentTier = window._userTier || (window._isPro ? 'pro' : 'free');
  const tierBtnMap = { pro: 'pricingProBtn', pro_max: 'pricingMaxBtn', ultimate: 'pricingUltimateBtn' };
  // Re-enable all first (in case tier changed)
  Object.values(tierBtnMap).forEach(id => {
    const b = document.getElementById(id);
    if (b) { b.disabled = false; b.style.opacity = ''; b.style.cursor = ''; }
  });
  const currentBtnId = tierBtnMap[currentTier];
  if (currentBtnId) {
    const btn = document.getElementById(currentBtnId);
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '.55';
      btn.style.cursor = 'default';
      const span = btn.querySelector('span');
      if (span) span.textContent = '✓ Current Plan';
    }
  }
  // 2026-08-20: Sign-up bonus banner — only for unverified free users.
  //   Signed out → hide (they'll see the sign-in prompt instead).
  //   Signed in + verified → hide (already claimed).
  //   Signed in + unverified free → SHOW.
  const bonusBanner = document.getElementById('pricingSignupBonusBanner');
  const signedIn = !!(window._user && window._user.uid);
  const verified = !!window._emailVerified;
  const isFree   = currentTier === 'free';
  if (bonusBanner) {
    bonusBanner.style.display = (signedIn && !verified && isFree) ? 'block' : 'none';
  }
  // 2026-08-31: Free-tier CTA is context-aware:
  //   Signed out           → 'Get Started — Free' (kicks off Google sign-in)
  //   Signed in + free     → '✓ Current Plan' (disabled, just closes modal)
  //   Signed in + paid     → 'Free' (dimmed — you can't downgrade to free from here)
  const freeBtn = document.getElementById('pricingFreeBtn');
  if (freeBtn) {
    freeBtn.disabled = false;
    freeBtn.style.opacity = '';
    freeBtn.style.cursor = '';
    if (!signedIn) {
      freeBtn.textContent = 'Get Started — Free';
      freeBtn.style.background = 'var(--gold)';
      freeBtn.style.color = '#000';
      freeBtn.style.fontWeight = '800';
    } else if (isFree) {
      freeBtn.textContent = '✓ Current Plan';
      freeBtn.disabled = true;
      freeBtn.style.opacity = '.55';
      freeBtn.style.cursor = 'default';
      freeBtn.style.background = '';
      freeBtn.style.color = '';
    } else {
      freeBtn.textContent = 'Free';
      freeBtn.disabled = true;
      freeBtn.style.opacity = '.4';
      freeBtn.style.cursor = 'default';
      freeBtn.style.background = '';
      freeBtn.style.color = '';
    }
  }
}

// 2026-08-31: Free-tier CTA behavior. Signed-out visitors clicking the Free
// card's button should be treated as sign-up intent — close the modal and
// pop the Google sign-in dialog. Everyone else just closes the modal.
function _freeTierCTA() {
  const signedIn = !!(window._user && window._user.uid);
  try { window.trackEvent && window.trackEvent('free_tier_cta_click', { signed_in: signedIn }); } catch(_){}
  closePricingModal();
  if (!signedIn) {
    setTimeout(() => { try { triggerGoogleSignIn(); } catch(_){} }, 200);
  }
}

function closePricingModal(evt) {
  if (evt && evt.target !== document.getElementById('pricingOverlay')) return;
  document.getElementById('pricingOverlay')?.classList.remove('open');
  _dialogClosed('pricingOverlay');
}

// ── Stripe checkout — fetch URL then navigate current tab (iOS Safari safe) ──
// window.location.href assigned directly to external URL after fetch is
// allowed by Safari because the original tap handler is still on the stack.
async function _stripeCheckout(endpoint, payload, btnId, txtId, defaultTxt) {
  const btn = btnId ? document.getElementById(btnId) : null;
  const txt = txtId ? document.getElementById(txtId) : null;
  if (btn) btn.disabled = true;
  if (txt) txt.textContent = 'Loading...';
  // DEBUG: update the debug panel to show what we're sending
  const _payloadEmail = payload?.email || '(none)';
  const _tokenState   = window._googleIdToken ? 'YES(' + window._googleIdToken.length + ')' : 'NO';
  window._updateAuthDebug?.('POST ' + endpoint.split('/').pop() + '\nemail=' + _payloadEmail.slice(0,25) + '\ntoken=' + _tokenState);
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (window._googleIdToken || '') },
      body: JSON.stringify(payload)
    });
    const d = await r.json();
    if (d.url) {
      window.location.href = d.url;
    } else {
      window._updateAuthDebug?.('ERR ' + r.status + ': ' + (d.error || 'unknown') + '\nsent email=' + _payloadEmail.slice(0,25));
      showToast('⚠️ ' + (d.error || 'Could not start checkout. Try again.'));
      if (btn) btn.disabled = false;
      if (txt) txt.textContent = defaultTxt || 'Try again';
    }
  } catch(e) {
    window._updateAuthDebug?.('NET ERR: ' + (e.message || e));
    showToast('⚠️ Network error. Try again.');
    if (btn) btn.disabled = false;
    if (txt) txt.textContent = defaultTxt || 'Try again';
  }
}

// ── Start Pro subscription checkout ──
async function startProCheckout() {
  await window._waitForAuth();
  if (!window.googleUser) { closePricingModal(); setTimeout(() => triggerGoogleSignIn(), 200); return; }
  window.trackEvent?.('checkout_attempt', { plan: 'pro_monthly' });
  _stripeCheckout('/api/stripe-checkout',
    { email: window.googleUser.email, userId: window.googleUser.sub },
    'pricingProBtn', 'pricingProBtnText', 'Get Pro — $9.99/mo');
}

// ── Start annual Pro checkout ──
async function startAnnualCheckout() {
  await window._waitForAuth();
  if (!window.googleUser) { closePricingModal(); setTimeout(() => triggerGoogleSignIn(), 200); return; }
  window.trackEvent?.('checkout_attempt', { plan: 'pro_annual' });
  _stripeCheckout('/api/stripe-annual-checkout',
    { googleSub: window.googleUser.sub, email: window.googleUser.email },
    'pricingAnnualBtn', 'pricingAnnualBtnText', 'Get Annual — $89.99/yr');
}

// ── Update header badge + tier-conditional UI when tier changes ──
function updateTierUI(tier) {
  const badge = document.getElementById('proBadge');
  if (!badge) return;
  badge.classList.remove('tier-pro', 'tier-pro_max', 'tier-ultimate');
  const label = badge.childNodes[badge.childNodes.length - 1]; // text node after SVG
  if (tier === 'pro_max') {
    badge.classList.add('tier-pro_max');
    if (label && label.nodeType === Node.TEXT_NODE) label.textContent = ' PRO MAX';
    badge.title = 'Pro Max — manage subscription & buy credits';
  } else if (tier === 'ultimate') {
    badge.classList.add('tier-ultimate');
    if (label && label.nodeType === Node.TEXT_NODE) label.textContent = ' ULTIMATE';
    badge.title = 'Ultimate — manage subscription & buy credits';
  } else {
    // pro or free
    if (label && label.nodeType === Node.TEXT_NODE) label.textContent = ' PRO';
    badge.title = 'Manage subscription & buy credits';
  }
}

// ── Pricing modal: Monthly / Annual toggle ──
function setPricingMode(mode) {
  const box = document.getElementById('pricingBox');
  if (!box) return;
  const isAnnual = mode === 'annual';
  box.classList.toggle('pricing-mode-annual', isAnnual);
  document.getElementById('pricingToggleMonthly')?.classList.toggle('active', !isAnnual);
  document.getElementById('pricingToggleAnnual')?.classList.toggle('active', isAnnual);
  // 2026-08-20: show/hide the annual value banner.
  const banner = document.getElementById('pricingAnnualBanner');
  if (banner) banner.style.display = isAnnual ? 'block' : 'none';
  // Swap price digits
  box.querySelectorAll('[data-price-monthly]').forEach(el => {
    el.textContent = isAnnual ? el.dataset.priceAnnual : el.dataset.priceMonthly;
  });
  // Swap /mo vs /yr
  box.querySelectorAll('[data-interval-monthly]').forEach(el => {
    el.textContent = isAnnual ? el.dataset.intervalAnnual : el.dataset.intervalMonthly;
  });
  // Swap CTA labels
  box.querySelectorAll('[data-cta-monthly]').forEach(el => {
    el.innerHTML = isAnnual ? el.dataset.ctaAnnual : el.dataset.ctaMonthly;
  });
  // 2026-08-20: instrument mode toggle so we can measure Monthly vs Annual
  // interest and pair it with checkout_attempt for a conversion rate.
  if (window._pricingMode !== mode) {
    try { window.trackEvent && window.trackEvent('pricing_mode_toggle', { mode }); } catch(e) {}
  }
  window._pricingMode = mode;
}

// ── Unified tier checkout ──
// 2026-09-01 [SECURITY]: identity is proven via Firebase ID token in the
// Authorization header. Body no longer sends email/userId — the server
// derives them from the verified token.
// 2026-09-01 (launch gate): single-decision venue unlock.
//
// Every locked-venue affordance — the teaser card, its button, and each blurred
// ranking row — used to open the 4-plan pricing wall. At that exact moment the
// visitor wants ONE thing: to see the payouts that are blurred in front of them.
// Presenting four tiers, two billing intervals and a feature matrix instead is a
// decision they did not ask to make, on the highest-intent click in the product.
//
// This sends them straight to checkout for the tier that actually unlocks what
// they are looking at: Free -> Pro, Pro -> Pro Max. startTierCheckout() already
// handles the not-signed-in case by stashing the intent and resuming after
// sign-in, so anonymous visitors are not dropped.
//
// A quiet "compare all plans" link stays underneath, so this narrows the choice
// without trapping anyone in a single option.
function startVenueUnlock(source) {
  const tier = (window._userTier || (window._isPro ? 'pro' : 'free'));
  const target = tier === 'free' ? 'pro' : 'pro_max';
  // Monthly is the honest default for an impulse unlock — do not commit someone
  // to a year on the strength of one blurred row.
  window._pricingMode = 'monthly';
  try { window.trackEvent && window.trackEvent('venue_unlock_click', { source: source || 'unknown', target }); } catch(_) {}
  startTierCheckout(target);
}
window.startVenueUnlock = startVenueUnlock;

async function startTierCheckout(tier) {
  // Ultimate was retired on 2026-09-01: it sold 3x quota and a badge for $39.99
  // with the same 15 venues as Pro Max. The Stripe prices are deactivated, so
  // any stale link would fail at Checkout anyway - fail here with an honest
  // message instead of a Stripe error page.
  if (tier === 'ultimate') {
    try { showToast('Ultimate was retired. Pro Max ($19.99/mo) now includes all 15 venues.', 'info'); } catch(_){}
    tier = 'pro_max';
  }
  await window._waitForAuth();
  if (!window.googleUser) {
    // 2026-09-01 (CR-013): re-stash the tier and interval so the deferred-open
    // handler in onAuthStateChanged reopens this modal on the same plan and
    // the same billing interval after sign-in, instead of dropping the intent.
    try {
      sessionStorage.setItem('_pendingUpgradeTier', tier);
      sessionStorage.setItem('_pendingUpgradeInterval', window._pricingMode === 'annual' ? 'annual' : 'monthly');
    } catch(_){}
    closePricingModal();
    setTimeout(() => triggerGoogleSignIn(), 200);
    return;
  }
  const interval = window._pricingMode === 'annual' ? 'annual' : 'monthly';
  window.trackEvent?.('checkout_attempt', { plan: `${tier}_${interval}` });
  const btnMap = { pro: 'pricingProBtn', pro_max: 'pricingMaxBtn', ultimate: 'pricingUltimateBtn' };
  const btnId = btnMap[tier];
  const btn = btnId ? document.getElementById(btnId) : null;
  const span = btn?.querySelector('span');
  const originalHTML = span?.innerHTML;
  if (btn) btn.disabled = true;
  if (span) span.textContent = 'Loading…';
  try {
    // Force-refresh the Firebase ID token so we send a fresh one to the
    // server. Matches the openBillingPortal() pattern already in this file.
    let idToken = window._googleIdToken || '';
    try {
      if (window.googleUser && typeof window.googleUser.getIdToken === 'function') {
        idToken = await window.googleUser.getIdToken(true);
        window._googleIdToken = idToken;
      } else if (window._fbCurrentUser && typeof window._fbCurrentUser.getIdToken === 'function') {
        idToken = await window._fbCurrentUser.getIdToken(true);
        window._googleIdToken = idToken;
      }
    } catch(_) {}
    if (!idToken || idToken.length < 20) {
      closePricingModal();
      setTimeout(() => triggerGoogleSignIn(), 200);
      throw new Error('Not signed in');
    }
    const res = await fetch('/api/stripe-subscription-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify({ tier, interval })
    });
    const data = await res.json();
    if (data.url) { window.location.href = data.url; return; }
    throw new Error(data.error || 'Checkout failed');
  } catch (e) {
    console.error('Tier checkout error:', e);
    // 2026-09-02 (CR-023): this used to replace every failure with a generic
    // "try again", which hid the server's actual reason -- a real user sat on
    // a broken checkout while the API was plainly reporting why. Show the
    // server's message when we have one; "try again" is the last resort.
    // 'Not signed in' is the one case we stay quiet on: it has already
    // triggered the sign-in flow, so a toast would just be noise.
    const msg = (e && e.message && e.message !== 'Not signed in') ? e.message : '';
    if (e && e.message === 'Not signed in') {
      /* sign-in already triggered above */
    } else {
      showToast?.(msg || 'Could not start checkout. Please try again.');
    }
    if (btn) btn.disabled = false;
    if (span && originalHTML) span.innerHTML = originalHTML;
  }
}

/* ── SHOP MODAL ─────────────────────────────────────────────────────────
   2026-09-02 (CR-021): the only discoverable storefront. Before this, credit
   packs lived exclusively inside the gear settings panel, which is hidden
   below 480px — so on a phone in portrait there was no way to buy credits at
   all. openShop() is now the single entry point used by the header button,
   the ?packs= deep link, and every out-of-credits gate. */
window._shopTab = 'id';
function openShop(tab, source) {
  const ov = document.getElementById('shopOverlay');
  if (!ov) return;
  shopSetTab(tab === 'grade' ? 'grade' : 'id');
  ov.classList.add('open');
  document.body.style.overflow = 'hidden';
  try { window.trackEvent?.('shop_open', { tab: window._shopTab, source: source || 'unknown' }); } catch(_){}
  shopRefreshBalances();
  // Focus the close control so keyboard and screen-reader users land inside.
  setTimeout(() => { try { ov.querySelector('.shop-x')?.focus(); } catch(_){} }, 60);
}
function closeShop(evt) {
  if (evt && evt.target && evt.target.id !== 'shopOverlay') return;
  const ov = document.getElementById('shopOverlay');
  if (!ov) return;
  ov.classList.remove('open');
  document.body.style.overflow = '';
}
function shopSetTab(tab) {
  window._shopTab = (tab === 'grade') ? 'grade' : 'id';
  const isGrade = window._shopTab === 'grade';
  const tId = document.getElementById('shopTabId');
  const tGr = document.getElementById('shopTabGrade');
  const pId = document.getElementById('shopPanelId');
  const pGr = document.getElementById('shopPanelGrade');
  if (tId) { tId.classList.toggle('active', !isGrade); tId.setAttribute('aria-selected', String(!isGrade)); }
  if (tGr) { tGr.classList.toggle('active', isGrade); tGr.setAttribute('aria-selected', String(isGrade)); }
  if (pId) pId.classList.toggle('active', !isGrade);
  if (pGr) pGr.classList.toggle('active', isGrade);
}
// Reuses the existing, already-hardened Stripe checkout starters so the shop
// can never drift from the gear-panel prices or the server SKU map.
function shopBuy(kind, qty) {
  if (kind === 'grade') startGradeScanCheckout(qty);
  else startIdScanCheckout(qty);
}
function shopOpenPlans() { closeShop(); openPricingModal('shop_compare_plans'); }
function shopRefreshBalances() {
  const signedIn = !!window.googleUser;
  const note = document.getElementById('shopSignInNote');
  if (note) note.style.display = signedIn ? 'none' : '';
  const bill = document.getElementById('shopBillingBtn');
  if (bill) bill.style.display = (signedIn && window._isPro) ? '' : 'none';
  const idBal = document.getElementById('shopIdBal');
  const grBal = document.getElementById('shopGradeBal');
  const idSub = document.getElementById('shopIdSub');
  const grSub = document.getElementById('shopGradeSub');
  if (!signedIn) {
    if (idBal) idBal.textContent = '—';
    if (grBal) grBal.textContent = '—';
    if (idSub) idSub.textContent = 'Sign in to check';
    if (grSub) grSub.textContent = 'Sign in to check';
    return;
  }
  const idc = Number(window._idScanCredits || 0) + Number(window._freeIdLeft || 0);
  const grc = Number(window._scanCredits || 0) + Number(window._freeScansLeft || 0);
  if (idBal) idBal.textContent = String(idc);
  if (grBal) grBal.textContent = String(grc);
  const tierLbl = window._userTier === 'pro_max' ? 'Pro Max' : (window._isPro ? 'Pro' : 'Free');
  if (idSub) idSub.textContent = tierLbl + ' plan';
  if (grSub) grSub.textContent = tierLbl + ' plan';
  // Pull authoritative counts from the server, then repaint.
  try {
    if (typeof checkProStatus === 'function') {
      Promise.resolve(checkProStatus()).then(() => {
        const i = Number(window._idScanCredits || 0) + Number(window._freeIdLeft || 0);
        const g = Number(window._scanCredits || 0) + Number(window._freeScansLeft || 0);
        if (idBal) idBal.textContent = String(i);
        if (grBal) grBal.textContent = String(g);
        const t = window._userTier === 'pro_max' ? 'Pro Max' : (window._isPro ? 'Pro' : 'Free');
        if (idSub) idSub.textContent = t + ' plan';
        if (grSub) grSub.textContent = t + ' plan';
        const b = document.getElementById('shopBillingBtn');
        if (b) b.style.display = window._isPro ? '' : 'none';
      }).catch(() => {});
    }
  } catch(_){}
}
// Esc closes the shop, matching the other overlays.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const ov = document.getElementById('shopOverlay');
  if (ov && ov.classList.contains('open')) closeShop();
});


/* =========================================================
   DIALOG A11Y — 2026-09-04 (audit SOL-PLAT-006)
   The overlays were visual-only containers: no role, no label, Escape did
   nothing, and Tab walked straight through the page behind the modal (a live
   keyboard pass found 10 of 14 focus stops sitting behind the visible
   pricing modal). One shared lifecycle covers all four.
   ========================================================= */
const _DIALOGS = {
  pricingOverlay:  () => closePricingModal(),
  scanOverlay:     () => cancelScan(),
  bulkScanOverlay: () => closeBulkScan(),
  bulkGradeOverlay:() => closeBulkGrade(),
};
// Remembers which element opened each dialog so focus can go back there.
window._dialogOpener = window._dialogOpener || {};

function _dialogIsOpen(el) {
  if (!el) return false;
  // pricing uses a class; the scan/bulk overlays use inline display.
  if (el.classList && el.classList.contains('pricing-overlay')) return el.classList.contains('open');
  return el.style.display !== 'none' && el.style.display !== '';
}

// The topmost open dialog wins Escape, so Bulk Grade opened over pricing
// closes itself first rather than closing the thing underneath it.
function _topOpenDialog() {
  let best = null, bestZ = -1;
  for (const id of Object.keys(_DIALOGS)) {
    const el = document.getElementById(id);
    if (!_dialogIsOpen(el)) continue;
    const z = parseInt(getComputedStyle(el).zIndex, 10) || 0;
    if (z >= bestZ) { best = el; bestZ = z; }
  }
  return best;
}

const _FOCUSABLE = 'a[href],area[href],input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),button:not([disabled]),iframe,object,embed,' +
  '[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

function _dialogFocusables(el) {
  if (!el) return [];
  return Array.from(el.querySelectorAll(_FOCUSABLE)).filter(n => {
    if (n.disabled || n.getAttribute('aria-hidden') === 'true') return false;
    // Skip anything inside a hidden section — the overlays keep several
    // display:none panels mounted at once.
    if (n.closest('[style*="display:none"],[style*="display: none"]')) return false;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

// Call when a dialog opens: records the opener and moves focus inside.
function _dialogOpened(id) {
  try {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = document.activeElement;
    if (prev && prev !== document.body && !el.contains(prev)) window._dialogOpener[id] = prev;
    const targets = _dialogFocusables(el);
    (targets[0] || el).focus({ preventScroll: true });
  } catch (_) {}
}

// Call when a dialog closes: returns focus to whatever opened it, so a
// keyboard user does not get dumped at the top of the document.
function _dialogClosed(id) {
  try {
    const prev = window._dialogOpener[id];
    delete window._dialogOpener[id];
    if (prev && document.body.contains(prev) && typeof prev.focus === 'function') {
      prev.focus({ preventScroll: true });
    }
  } catch (_) {}
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' && e.key !== 'Tab') return;
  const el = _topOpenDialog();
  if (!el) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    try { _DIALOGS[el.id](); } catch (_) {}
    return;
  }
  // Tab: cycle within the dialog instead of escaping to the page behind it.
  const f = _dialogFocusables(el);
  if (!f.length) { e.preventDefault(); el.focus({ preventScroll: true }); return; }
  const first = f[0], last = f[f.length - 1];
  const active = document.activeElement;
  if (!el.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first).focus({ preventScroll: true }); return; }
  if (e.shiftKey && active === first) { e.preventDefault(); last.focus({ preventScroll: true }); }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus({ preventScroll: true }); }
}, true);

// ── Start per-scan checkout (legacy — now opens grade scan modal) ──
function startScanCheckout() { openGradeScanModal(); }

// ── Start grade scan pack checkout ──
async function startGradeScanCheckout(tier) {
  // Wait for Firebase auth to resolve (handles tap-before-auth-ready case)
  await window._waitForAuth();
  if (!window.googleUser) { setTimeout(() => triggerGoogleSignIn(), 600); return; }
  window.trackEvent?.('checkout_attempt', { plan: 'grade_pack', tier });
  const tierBtns = document.querySelectorAll('[onclick^="startGradeScanCheckout"]');
  tierBtns.forEach(b => { b.disabled = true; });
  const clickedBtn = document.querySelector(`[onclick="startGradeScanCheckout('${tier}')"]`);
  if (clickedBtn) { const el = clickedBtn.querySelector('div:last-child'); if (el) el.textContent = 'Loading…'; }
  _stripeCheckout('/api/stripe-grade-checkout',
    { tier, email: window.googleUser.email, userId: window.googleUser.sub, name: window.googleUser.name },
    null, null, null).catch(() => tierBtns.forEach(b => { b.disabled = false; }));
  // Re-enable on failure
  const resetBtns = () => tierBtns.forEach(b => { b.disabled = false; });
  setTimeout(resetBtns, 8000); // safety reset if navigation doesn't happen
}

// ── Open grade scan pricing modal ──
function openGradeScanModal() { switchScanMode('grade'); openPricingModal('grade_scan'); }

// ── Start ID scan tier checkout ──
async function startIdScanCheckout(tier) {
  // Wait for Firebase auth to resolve (handles tap-before-auth-ready case)
  await window._waitForAuth();
  if (!window.googleUser) { showToast('Sign in with Google first to buy ID Scanner Credits.'); setTimeout(() => triggerGoogleSignIn(), 600); return; }
  const tierBtns = document.querySelectorAll('[onclick^="startIdScanCheckout"]');
  tierBtns.forEach(b => { b.disabled = true; });
  const clickedBtn = document.querySelector(`[onclick="startIdScanCheckout('${tier}')"]`);
  if (clickedBtn) { const el = clickedBtn.querySelector('div:last-child'); if (el) el.textContent = 'Loading…'; }
  _stripeCheckout('/api/stripe-id-checkout',
    { tier, email: window.googleUser.email, userId: window.googleUser.sub },
    null, null, null);
  const priceMap = { '10': '$1.99', '50': '$7.99', '100': '$12.99' };
  const resetBtns = () => {
    tierBtns.forEach(b => { b.disabled = false; });
    if (clickedBtn) { const el = clickedBtn.querySelector('div:last-child'); if (el) el.textContent = priceMap[tier] || '$1'; }
  };
  setTimeout(resetBtns, 8000); // safety reset
}

// ── Open Stripe billing portal (manage / cancel subscription) ──
async function openBillingPortal() {
  await window._waitForAuth();
  if (!window.googleUser) { showToast('Sign in first to manage your subscription.'); return; }
  const btn = document.querySelector('[onclick="openBillingPortal()"]');
  const origText = btn?.innerHTML;
  if (btn) btn.innerHTML = '<span style="opacity:.6">Opening…</span>';
  // Force-refresh the Firebase ID token before hitting the server. Cached
  // tokens can be stale (expired, missing email claim after email change,
  // etc.) — a fresh token includes the latest email and full 60min TTL.
  let idTok = window._googleIdToken || '';
  try {
    if (window.googleUser && typeof window.googleUser.getIdToken === 'function') {
      idTok = await window.googleUser.getIdToken(true);
      window._googleIdToken = idTok;
    }
  } catch(e) { /* fall through with whatever token we have */ }
  try {
    const r = await fetch('/api/stripe-portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idTok },
      body: JSON.stringify({ email: window.googleUser.email, userId: window.googleUser.sub })
    });
    const d = await r.json();
    if (d.url) {
      window.location.href = d.url;
    } else {
      showToast('\u26a0\ufe0f ' + (d.error || 'Could not open billing portal.'));
      if (btn && origText) btn.innerHTML = origText;
    }
  } catch(e) {
    showToast('\u26a0\ufe0f Network error. Try again.');
    if (btn && origText) btn.innerHTML = origText;
  }
}

// ── Toast helper ──
function showToast(msg, arg) {
  const t = document.getElementById('csToast');
  if (!t) return;
  // Accept either a duration (ms) or a type name ('info'|'success'|'warning'|'error'|'gold').
  // Historically the second arg was duration, but many call sites pass a type string;
  // when a string arrives we fall back to the default duration so the toast doesn't
  // disappear instantly (bug: setTimeout(_, 'info') coerces to NaN → fires immediately).
  let duration = 3500;
  if (typeof arg === 'number' && isFinite(arg) && arg > 0) duration = arg;
  else if (typeof arg === 'string') {
    // Longer default for error/warning so the user has time to read.
    if (arg === 'error' || arg === 'warning') duration = 5000;
    // Reset any prior type class, then apply the new one so callers can style via CSS.
    ['toast-info','toast-success','toast-warning','toast-error','toast-gold'].forEach(c => t.classList.remove(c));
    t.classList.add('toast-' + arg);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

// ── Mobile-friendly promise-based prompt replacement for window.prompt().
// Renders an overlay with an input; resolves to the entered string or null on cancel.
function promptInline(label, defaultValue) {
  return new Promise((resolve) => {
    let overlay = document.getElementById('_promptInlineOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = '_promptInlineOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:99999;padding:1rem;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)';
      overlay.innerHTML = '<div style="background:var(--surface,#fff);color:var(--text,#111);border-radius:14px;padding:1.25rem 1.1rem;width:100%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,.35);border:1px solid var(--border,#333)"><div id="_promptInlineLabel" style="font-size:.85rem;font-weight:700;margin-bottom:.6rem"></div><input id="_promptInlineInput" type="text" autocomplete="off" spellcheck="false" style="width:100%;padding:.6rem .7rem;border:1px solid var(--border,#444);background:var(--surface-2,#111);color:var(--text,#fff);border-radius:8px;font-size:1rem;box-sizing:border-box" /><div style="display:flex;gap:.5rem;margin-top:.85rem;justify-content:flex-end"><button id="_promptInlineCancel" style="padding:.5rem 1rem;background:var(--surface-2,#222);color:var(--text,#fff);border:1px solid var(--border,#444);border-radius:8px;font-weight:600;font-size:.82rem;cursor:pointer">Cancel</button><button id="_promptInlineOk" style="padding:.5rem 1.1rem;background:var(--gold,#d4af37);color:#000;border:none;border-radius:8px;font-weight:800;font-size:.82rem;cursor:pointer">OK</button></div></div>';
      document.body.appendChild(overlay);
    }
    const lbl = document.getElementById('_promptInlineLabel');
    const inp = document.getElementById('_promptInlineInput');
    const okB = document.getElementById('_promptInlineOk');
    const cxB = document.getElementById('_promptInlineCancel');
    lbl.textContent = label || '';
    inp.value = defaultValue == null ? '' : String(defaultValue);
    overlay.style.display = 'flex';
    setTimeout(() => { inp.focus(); inp.select(); }, 20);
    const done = (val) => {
      overlay.style.display = 'none';
      okB.onclick = null; cxB.onclick = null; inp.onkeydown = null;
      overlay.onclick = null;
      resolve(val);
    };
    okB.onclick = () => done(inp.value);
    cxB.onclick = () => done(null);
    overlay.onclick = (e) => { if (e.target === overlay) done(null); };
    inp.onkeydown = (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); done(inp.value); }
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
    };
  });
}

// ── Handle return from Stripe ──
(function handleStripeReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('pro') === '1') {
    window._isPro = true;
    window._freeScansLeft = 5;
    updateProUI();
    showToast('⭐ Welcome to CardResell Pro! 10 Estimated Grade Scans added.', 5000);
    // Clean URL
    history.replaceState({}, '', window.location.pathname);
    /* 2026-09-02: queue the venue welcome rather than showing it here. At this
       point we only know "is pro" — the pro_max distinction arrives with
       /api/pro-status, and Pro Max gets an extra paragraph about the Cash now
       tab. Firing now would show a Pro Max buyer the Pro copy. The fallback
       timer covers pro-status never resolving, so the modal can't be lost. */
    if (window._userTier) {
      // Tier already resolved (cached pro-status) — show it now, no delay.
      try { maybeShowProWelcome(); } catch (_) {}
    } else {
      window._proWelcomePending = true;
      // Fallback if /api/pro-status never answers. Kept short: a thank-you that
      // arrives six seconds late reads as a bug.
      setTimeout(() => {
        if (window._proWelcomePending) {
          window._proWelcomePending = false;
          try { maybeShowProWelcome(); } catch (_) {}
        }
      }, 2500);
    }
  }
  if (params.get('scan_paid') === '1') {
    const sessionId = params.get('session_id') || '';
    history.replaceState({}, '', window.location.pathname);
    // Verify payment with Stripe and grant the credit
    (async () => {
      const email     = window._userEmail || '';
      const googleSub = window.googleUser?.sub || window.googleUser?.id || '';
      if (!sessionId || !email) {
        // No session ID — can't verify, show generic message and refresh credits
        showToast('\u2714 Payment received! Verifying your credit…', 4000);
        return;
      }
      try {
        showToast('\u231b Confirming your credit…', 3000);
        const idTok = window._googleIdToken || '';
        const r = await fetch('/api/scan-credits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idTok },
          body: JSON.stringify({ action: 'verify_payment', sessionId })
        });
        const data = await r.json();
        if (data.success) {
          window._scanCredits = (window._scanCredits || 0) + (data.alreadyCredited ? 0 : 1);
          showToast('\u2705 Scan credit confirmed! Tap Scan to use it.', 5000);
          // Refresh credit display in settings if open
          loadSettingsScanCredits?.();
        } else {
          showToast('\u26a0\ufe0f Payment received but credit verification failed. Contact support.', 6000);
          console.error('Credit verify failed:', data);
        }
      } catch(e) {
        showToast('\u2714 Payment received — your Card Grader Credit is being processed.', 5000);
        console.error('Credit verify error:', e);
      }
    })();
  }
})();

// ── Handle return from Stripe — ID scan purchase ──
(function handleIdScanReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('id_scan_paid') === '1') {
    const sessionId = params.get('session_id') || '';
    history.replaceState({}, '', window.location.pathname);
    (async () => {
      const email     = window._userEmail || '';
      const googleSub = window.googleUser?.sub || window.googleUser?.id || '';
      if (!sessionId || !email) {
        showToast('\u2705 ID Scanner Credits purchased! Loading balance\u2026', 4000);
        setTimeout(() => loadSettingsScanCredits?.(), 1500);
        return;
      }
      try {
        showToast('\u23f3 Confirming your ID Scanner Credits\u2026', 3000);
        const idTok = window._googleIdToken || '';
        const r = await fetch('/api/scan-credits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idTok },
          body: JSON.stringify({ action: 'verify_id_payment', sessionId })
        });
        const data = await r.json();
        if (data.success) {
          const added = data.added || 0;
          window._idScanCredits = data.credits || 0;
          if (typeof updateScanBtnCredits === 'function') { try { updateScanBtnCredits(); } catch(e) {} }
          const msg = data.alreadyCredited
            ? '\u2705 ID Scanner Credits already applied to your account.'
            : `\u2705 ${added} ID Scanner Credits added! Ready to use.`;
          showToast(msg, 5000);
          loadSettingsScanCredits?.();
        } else {
          showToast('\u26a0\ufe0f Payment received but credit verification failed. Contact support.', 6000);
          console.error('ID credit verify failed:', data);
        }
      } catch(e) {
        showToast('\u2705 ID Scanner Credits purchased \u2014 balance updating shortly.', 5000);
        console.error('ID credit verify error:', e);
      }
    })();
  }
})();

// ── Handle return from Stripe — grade scan pack purchase ──
(function handleGradeScanReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('grade_scan_paid') === '1') {
    const sessionId = params.get('session_id') || '';
    history.replaceState({}, '', window.location.pathname);
    (async () => {
      const email     = window._userEmail || '';
      const googleSub = window.googleUser?.sub || window.googleUser?.id || '';
      if (!sessionId || !email) {
        showToast('✅ Grade Scan Credits purchased! Loading balance…', 4000);
        setTimeout(() => loadSettingsScanCredits?.(), 1500);
        return;
      }
      try {
        showToast('⏳ Confirming your Grade Scan Credits…', 3000);
        const idTok = window._googleIdToken || '';
        const r = await fetch('/api/scan-credits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idTok },
          body: JSON.stringify({ action: 'verify_grade_payment', sessionId })
        });
        const data = await r.json();
        if (data.success) {
          const added = data.added || 0;
          window._scanCredits = data.credits || 0;
          const msg = data.alreadyCredited
            ? '✅ Grade Scan Credits already applied to your account.'
            : `✅ ${added} Grade Scan Credits added! Ready to scan.`;
          showToast(msg, 5000);
          loadSettingsScanCredits?.();
          updateScanBtnCredits?.();
        } else {
          showToast('⚠️ Payment received but credit verification failed. Contact support.', 6000);
          console.error('Grade scan credit verify failed:', data);
        }
      } catch(e) {
        showToast('✅ Grade Scan Credits purchased — balance updating shortly.', 5000);
        console.error('Grade scan credit verify error:', e);
      }
    })();
  }
})();


/* =========================================================
   SCAN GATE — Pay-per-use Estimated Grade Scanner
   ========================="================================ */

function openGradedScanGate() {
  if (!window.googleUser) {
    showToast('Sign in with Google first to use the scanner');
    return;
  }
  // Always try to open the camera — server is the source of truth on credits.
  // If credits are actually 0, the server returns 402 and the gate modal opens then.
  // This avoids race conditions where _scanCredits hasn't loaded yet.
  // 2026-09-01: Route through the live camera overlay for consistency with
  // the other scan entry points.
  _startSingleScanCapture();
}

function closeScanGate(evt) {
  if (evt && evt.target !== document.getElementById('scanGateOverlay')) return;
  document.getElementById('scanGateOverlay').classList.remove('open');
}

function handleScanOption(choice) {
  document.getElementById('scanGateOverlay').classList.remove('open');
  if (choice === 'pay') {
    openIdScanModal ? openIdScanModal() : openGradeScanModal();
  } else if (choice === 'pro') {
    openPricingModal('scan_gate');
  } else if (choice === 'pack10' || choice === 'pack5') {
    startGradeScanCheckout('10');
  } else if (choice === 'pack25' || choice === 'pack15') {
    startGradeScanCheckout('25');
  } else if (choice === 'pack50' || choice === 'pack40') {
    startGradeScanCheckout('50');
  }
}


/* =========================================================
   GRADING ROI CALCULATOR
   ========================================================= */

function toggleRoiPanel() {
  const body    = document.getElementById('roiBody');
  const chevron = document.getElementById('roiChevron');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display    = open ? 'none' : '';
  chevron.style.transform = open ? 'rotate(-90deg)' : '';
}

function showGradingRoi() {
  const panel = document.getElementById('gradingRoiPanel');
  if (!panel) return;
  panel.style.display = '';
  // Pre-fill raw price from override field
  const ov = document.getElementById('priceOverride');
  const rawEl = document.getElementById('roiRawPrice');
  const raw = parseFloat(ov?.value);
  if (rawEl) rawEl.textContent = raw > 0 ? '$' + raw.toFixed(2) : '—';
  calcGradingRoi();
}

function hideGradingRoi() {
  const panel = document.getElementById('gradingRoiPanel');
  if (panel) panel.style.display = 'none';
}

function calcGradingRoi() {
  const ov          = document.getElementById('priceOverride');
  const gradedInput = document.getElementById('roiGradedPrice');
  const costInput   = document.getElementById('roiGradingCost');
  const feesInput   = document.getElementById('roiFeesPct');
  const rawEl       = document.getElementById('roiRawPrice');
  const verdict     = document.getElementById('roiVerdict');
  if (!verdict) return;

  const rawPrice    = parseFloat(ov?.value) || 0;
  const gradedPrice = parseFloat(gradedInput?.value) || 0;
  const gradingCost = parseFloat(costInput?.value) || 25;
  const feesPct     = parseFloat(feesInput?.value) || 13;

  // Update raw display in case override changed
  if (rawEl) rawEl.textContent = rawPrice > 0 ? '$' + rawPrice.toFixed(2) : '—';

  if (rawPrice <= 0 || gradedPrice <= 0) {
    verdict.style.display = 'none';
    return;
  }

  // Net after fees
  const rawNet    = rawPrice    * (1 - feesPct / 100);
  const gradedNet = gradedPrice * (1 - feesPct / 100);

  // ROI = (gradedNet - rawNet - gradingCost)
  const roi           = gradedNet - rawNet - gradingCost;
  const breakEvenGrade = rawNet + gradingCost; // minimum graded price needed to break even
  const breakEvenSell  = breakEvenGrade / (1 - feesPct / 100);
  const roiPct         = rawPrice > 0 ? (roi / rawPrice * 100) : 0;

  verdict.style.display = '';

  if (roi > 0) {
    verdict.style.background = 'rgba(34,197,94,.1)';
    verdict.style.border     = '1px solid rgba(34,197,94,.3)';
    verdict.style.color      = '#4ade80';
    verdict.innerHTML =
      `<strong>Worth grading</strong> — expected gain: <strong>$${roi.toFixed(2)}</strong> (+${roiPct.toFixed(0)}%)<br>` +
      `<span style="font-size:.72rem;font-weight:400;color:var(--text-muted)">` +
      `Raw net $${rawNet.toFixed(2)} → Graded net $${gradedNet.toFixed(2)} − $${gradingCost.toFixed(2)} grading = <strong style="color:#4ade80">+$${roi.toFixed(2)}</strong>` +
      `</span>`;
    // 2026-08-30: profitable ROI → highest-intent moment to upsell Free users.
    // Shows once per session, only if profit is meaningful ($20+), only for Free.
    try {
      var _tier = (window._userTier || 'free').toLowerCase();
      var _seen = sessionStorage.getItem('cr_roi_upsell_shown');
      if (_tier === 'free' && roi >= 20 && !_seen) {
        sessionStorage.setItem('cr_roi_upsell_shown', '1');
        setTimeout(function() {
          try {
            var host = document.getElementById('gradingRoiPanel');
            if (!host) return;
            var existing = document.getElementById('roiProfitUpsell');
            if (existing) existing.remove();
            var box = document.createElement('div');
            box.id = 'roiProfitUpsell';
            box.style.cssText = 'margin-top:.7rem;padding:.75rem .9rem;background:linear-gradient(135deg,rgba(196,122,0,.16),rgba(196,122,0,.06));border:1px solid rgba(196,122,0,.4);border-radius:10px;display:flex;flex-direction:column;gap:.55rem';
            box.innerHTML =
              '<div style="font-size:.74rem;color:rgba(255,255,255,.9);line-height:1.45">' +
                '💰 <strong>This one flip pays for CardResell Pro for ' + Math.max(1, Math.floor(roi / 9.99)) + ' months.</strong> Unlock more grade scans + all 15 marketplace payouts.' +
              '</div>' +
              '<button type="button" id="roiUpsellBtn" style="align-self:flex-start;background:var(--gold);color:#000;border:none;border-radius:8px;padding:.42rem 1.05rem;font-weight:800;font-size:.75rem;cursor:pointer">Upgrade to Pro — $9.99/mo</button>';
            host.appendChild(box);
            window.trackEvent && window.trackEvent('post_grade_prompt_shown', { trigger: 'roi_profit_free', tier: _tier });
            document.getElementById('roiUpsellBtn').addEventListener('click', function() {
              try { window.trackEvent && window.trackEvent('post_grade_prompt_click', { trigger: 'roi_profit_free', tier: _tier }); } catch(_){}
              if (typeof openPricingModal === 'function') openPricingModal('roi_profit_free');
            });
          } catch(_){}
        }, 900);
      }
    } catch(_){}
  } else if (roi > -5) {
    verdict.style.background = 'rgba(234,179,8,.08)';
    verdict.style.border     = '1px solid rgba(234,179,8,.3)';
    verdict.style.color      = 'var(--gold)';
    verdict.innerHTML =
      `<strong>Borderline</strong> — grading costs about break even<br>` +
      `<span style="font-size:.72rem;font-weight:400;color:var(--text-muted)">` +
      `Need to sell graded above <strong>$${breakEvenSell.toFixed(2)}</strong> to profit after ${feesPct}% fees + $${gradingCost} grading` +
      `</span>`;
  } else {
    verdict.style.background = 'rgba(239,68,68,.08)';
    verdict.style.border     = '1px solid rgba(239,68,68,.25)';
    verdict.style.color      = '#f87171';
    verdict.innerHTML =
      `<strong>Not worth grading</strong> — expected loss: <strong>$${Math.abs(roi).toFixed(2)}</strong><br>` +
      `<span style="font-size:.72rem;font-weight:400;color:var(--text-muted)">` +
      `Need PSA 10 to sell above <strong>$${breakEvenSell.toFixed(2)}</strong> just to break even` +
      `</span>`;
  }
}

// Keep ROI raw price in sync when override changes
document.getElementById('priceOverride')?.addEventListener('input', () => {
  // User typed: this is now their expected sale price, so drop the auto-fill
  // flag and stop applying the condition multiplier on top of it.
  window._ovAutoFilled = false;
  // Typing by hand abandons the tier choice: from here the number is theirs
  // and must not be re-derived when the condition changes.
  window._qpChosenTier = null;
  const rawEl = document.getElementById('roiRawPrice');
  const ov = parseFloat(document.getElementById('priceOverride')?.value);
  if (rawEl) rawEl.textContent = ov > 0 ? '$' + ov.toFixed(2) : '—';
  calcGradingRoi();
});

/* =========================================================
   FLIP CAP — show upsell when free user hits 5 flips
   ========================================================= */

function showFlipCapModal() {
  openPricingModal('flips_cap');
}

// Init on load
window.addEventListener('load', () => {
  initGoogleSignIn();  // sets up header button
  updateKeyStatus();
  updateProUI();
  // Venue chips reflect persisted opt-in state, so they must paint on first
  // load rather than waiting for the user to open the picker.
  try { syncVenueChips(); } catch (_) {}
  // Restore the saved seller profile BEFORE any calc() runs, so the first
  // render already uses this seller's real rate rather than the Level 1-4
  // default and then silently changing under them.
  initSellerProfile();
  // Pre-populate settings inputs with saved values

  const tplInput = document.getElementById('tplKeyInput');
  if (tplInput && window.tplApiKey) tplInput.value = window.tplApiKey;
  const oaiInput = document.getElementById('openAiKeyInput');
  if (oaiInput && window._openAiKey) oaiInput.value = window._openAiKey;
  const gcInput = document.getElementById('googleClientIdInput');
  if (gcInput && _SAVED_CLIENT_ID) gcInput.value = _SAVED_CLIENT_ID;

  // 2026-08-31: Mark landing-active so the game-icon background pattern fades
  // while the hero is visible. Cleared in loadCardUI() once a card renders.
  // Skip when we already have a deep-linked card queued (results come first).
  try {
    const q = new URLSearchParams(location.search);
    const _hasDeepLink = q.get('c') || q.get('card') || q.get('share') || location.pathname.startsWith('/grade/');
    if (!_hasDeepLink) {
      document.body.classList.add('landing-active');
    }
  } catch(_) {}

  // 2026-08-31: First-visit "Try Charizard" attention pulse. Only fires when
  // localStorage flag is unset (never seen the landing before). Once they've
  // clicked the button OR loaded any card by other means, the flag is set
  // and future visits show the neutral state.
  try {
    const _seen = localStorage.getItem('cs_landing_seen') === '1';
    // 2026-09-01 (launch gate): only auto-run when there is genuinely nothing
    // else to show — no deep link (it loads its own card) and no saved card
    // (_restoreLastLoadedCard fires at 400ms and would race us).
    let _hasSavedCard = false;
    try { _hasSavedCard = !!localStorage.getItem(_CR_LAST_CARD_KEY); } catch(_){}
    // Recompute the deep-link check locally. The _hasDeepLink above is a const
    // scoped to a DIFFERENT try block, so reading it here threw a silent
    // ReferenceError that the enclosing catch(_) swallowed — the auto-run never
    // fired in production even though the code shipped. Verified in a browser.
    let _deepLink = false;
    try {
      // Read the pre-strip snapshot, not location.search — by the time this
      // runs the deep-link handlers have already removed their own params.
      const _q = new URLSearchParams(window._crLandingSearch || location.search);
      _deepLink = !!(_q.get('c') || _q.get('card') || _q.get('share')
                     || _q.get('upgrade') || _q.get('packs') || _q.get('photo_tips')
                     || location.pathname.startsWith('/grade/'));
    } catch(_){}
    if (!_seen && !_deepLink && !_hasSavedCard && typeof autoRunExampleCard === 'function') {
      // Give the game selector and search wiring a beat to attach, then run.
      setTimeout(() => {
        autoRunExampleCard().then((ok) => {
          if (!ok) {
            // Fall back to the old attention pulse so a failed auto-run still
            // leaves an obvious next action instead of a dead landing page.
            document.body.classList.add('first-visit');
            const _b = document.getElementById('tryExampleBtn');
            if (_b) {
              _b.classList.add('first-visit');
              setTimeout(() => { _b.classList.remove('first-visit'); }, 6200);
            }
          }
        });
      }, 500);
    }
    if (!_seen) {
      document.body.classList.add('first-visit');
      const _btn = document.getElementById('tryExampleBtn');
      if (_btn) {
        // Kick off the pulse ~1s after load so the user's eye has time to
        // land on the hero copy first, then get drawn to the CTA.
        setTimeout(() => {
          _btn.classList.add('first-visit');
          // Drop the pulse class after animation completes (3 cycles × 1.9s + buffer)
          setTimeout(() => { _btn.classList.remove('first-visit'); }, 6200);
        }, 1000);
      }
      // Clear the first-visit marker as soon as they click the button OR
      // load any card via other paths (search, scan, restore).
      const _clearFirstVisit = () => {
        try { localStorage.setItem('cs_landing_seen', '1'); } catch(_){}
        document.body.classList.remove('first-visit');
      };
      if (_btn) _btn.addEventListener('click', _clearFirstVisit, { once: true });
      // Also clear after 20s of idle so the button label doesn't stay in
      // "Try Charizard" mode forever if they never click.
      setTimeout(_clearFirstVisit, 20000);
    }
  } catch(_) {}

  // 2026-08-20: restore the last-viewed card across page refresh.
  // Do it after a short delay so the game selector / view switch have time
  // to attach, and skip if the URL already has share/deep-link parameters
  // that will load their own card.
  try {
    const q = new URLSearchParams(location.search);
    const hasDeepLink = q.get('c') || q.get('card') || q.get('share') || location.pathname.startsWith('/grade/');
    if (!hasDeepLink) {
      setTimeout(() => { try { _restoreLastLoadedCard(); } catch(e) { console.warn('[restore] failed', e); } }, 400);
    }
  } catch(_) {}
});
