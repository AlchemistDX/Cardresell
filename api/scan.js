import { verifyTokenFlexible } from './_verifyToken.js';
import { identifyWithXimilar } from './_ximilar.js';
import { gradeWithXimilar } from './_ximilar_grade.js';
import { getUserTier, TIER_BENEFITS, isPaidTier } from './_tier.js';

// ── YGOProDeck grounding (extracted helper) ──
// Mutates cardInfo in place. Returns nothing.
// Called for Ximilar identification results and picker candidates so every
// YGO ID is enriched with canonical name, set, rarity, image, and authoritative
// YGOProDeck id.
//
// Four tiers, most specific first:
//   Tier 0 (NEW 2026-08-19): numeric card_number → ?id=<passcode>
//     Konami passcodes (8-9 digits) uniquely identify a card. Ximilar returns
//     these as card_number for YGO cards (e.g. Invoked Baybarron scan returned
//     101305031 as card_number, and YGOProDeck ?id=101305031 resolves it
//     correctly even though Ximilar had the name as "Invoked Babalon" and
//     set_code as "UNKNOWN").
//   Tier 1: printed set_code (PHRA-EN012, CORI-EN031) → cardsetsinfo.php
//   Tier 2: exact name → cardinfo.php?name=<name>
//   Tier 3: fuzzy name → cardinfo.php?fname=<name>
async function groundYugiohCardInfo(cardInfo) {
  if (!cardInfo || cardInfo.card_type !== 'yugioh') return;
  let ygoHit = null;
  const setCodeStrict = cardInfo.set_code &&
    /^[A-Z0-9]{2,6}-(EN|DE|FR|IT|PT|SP|JP|KR|TC|AE)[A-Z0-9]{2,4}$/.test(cardInfo.set_code);

  // Tier 0: numeric passcode lookup (Ximilar's card_number is often the passcode)
  const rawNum = String(cardInfo.card_number || '').trim();
  const isPurelyNumeric = /^\d{5,10}$/.test(rawNum);
  if (isPurelyNumeric) {
    try {
      const ac = new AbortController();
      const tt = setTimeout(() => ac.abort(), 4000);
      const r = await fetch(
        `https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${encodeURIComponent(rawNum)}`,
        { signal: ac.signal, headers: { 'user-agent': 'CardResell/1.0' } }
      ).catch(() => null);
      clearTimeout(tt);
      if (r && r.ok) {
        const j = await r.json().catch(() => null);
        const card = j?.data?.[0];
        if (card && card.name) {
          const printing = (card.card_sets || [])[0] || {};
          ygoHit = {
            source: 'passcode',
            id: card.id,
            name: card.name,
            set_name: printing.set_name || '',
            set_code: printing.set_code || '',
            set_rarity: printing.set_rarity || '',
            image_url: card.card_images?.[0]?.image_url || null,
            image_small: card.card_images?.[0]?.image_url_small || null,
            tcgplayer_price: parseFloat(card.card_prices?.[0]?.tcgplayer_price) || null,
            type: card.type || '', archetype: card.archetype || '',
          };
        }
      }
    } catch (e) { console.warn('YGO passcode grounding failed:', e?.message || e); }
  }

  // Tier 1: set_code lookup
  if (!ygoHit && setCodeStrict) {
    try {
      const ac = new AbortController();
      const tt = setTimeout(() => ac.abort(), 4000);
      const r = await fetch(
        `https://db.ygoprodeck.com/api/v7/cardsetsinfo.php?setcode=${encodeURIComponent(cardInfo.set_code)}`,
        { signal: ac.signal, headers: { 'user-agent': 'CardResell/1.0' } }
      ).catch(() => null);
      clearTimeout(tt);
      if (r && r.ok) {
        const j = await r.json().catch(() => null);
        if (j && j.name && j.set_name) {
          ygoHit = {
            source: 'set_code',
            id: j.id, name: j.name, set_name: j.set_name,
            set_code: j.set_code || cardInfo.set_code,
            set_rarity: j.set_rarity,
          };
        }
      }
    } catch (e) { console.warn('YGO set_code grounding failed:', e?.message || e); }
  }

  // Tier 2 & 3: name lookup (also runs after Tier 0/1 to fill image_url,
  // since cardsetsinfo.php doesn't include images)
  const nameForLookup = ygoHit?.name || cardInfo.card_name;
  const needsImage = !ygoHit?.image_url;
  if (nameForLookup && needsImage) {
    try {
      const ac = new AbortController();
      const tt = setTimeout(() => ac.abort(), 4000);
      const exactUrl = `https://db.ygoprodeck.com/api/v7/cardinfo.php?name=${encodeURIComponent(nameForLookup)}`;
      let r = await fetch(exactUrl, { signal: ac.signal, headers: { 'user-agent': 'CardResell/1.0' } }).catch(() => null);
      let j = (r && r.ok) ? await r.json().catch(() => null) : null;
      if (!j?.data?.length && !ygoHit) {
        const fuzzyUrl = `https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(nameForLookup)}&num=5&offset=0`;
        r = await fetch(fuzzyUrl, { signal: ac.signal, headers: { 'user-agent': 'CardResell/1.0' } }).catch(() => null);
        j = (r && r.ok) ? await r.json().catch(() => null) : null;
      }
      clearTimeout(tt);
      if (j?.data?.length) {
        let card = ygoHit?.name
          ? j.data.find(c => c.name === ygoHit.name) || j.data[0]
          : j.data[0];
        let printing = null;
        if (card.card_sets && card.card_sets.length) {
          if (cardInfo.set_code) {
            printing = card.card_sets.find(s =>
              String(s.set_code || '').toUpperCase() === String(cardInfo.set_code).toUpperCase()
            );
          }
          printing = printing || card.card_sets[0];
        }
        if (!ygoHit) ygoHit = { source: 'name' };
        ygoHit.id       = ygoHit.id       || card.id;
        ygoHit.name     = ygoHit.name     || card.name;
        ygoHit.set_name = ygoHit.set_name || printing?.set_name || '';
        ygoHit.set_code = ygoHit.set_code || printing?.set_code || cardInfo.set_code || '';
        ygoHit.set_rarity = ygoHit.set_rarity || printing?.set_rarity || '';
        ygoHit.image_url  = ygoHit.image_url || card.card_images?.[0]?.image_url || null;
        ygoHit.image_small= ygoHit.image_small || card.card_images?.[0]?.image_url_small || null;
        ygoHit.tcgplayer_price = ygoHit.tcgplayer_price != null ? ygoHit.tcgplayer_price : (parseFloat(card.card_prices?.[0]?.tcgplayer_price) || null);
        ygoHit.type       = ygoHit.type       || card.type || '';
        ygoHit.archetype  = ygoHit.archetype  || card.archetype || '';
      }
    } catch (e) {
      console.warn('YGO name grounding failed:', e?.message || e);
    }
  }

  // Apply the override
  if (ygoHit) {
    const before = { name: cardInfo.card_name, set: cardInfo.set_name };
    if (ygoHit.name)        cardInfo.card_name = ygoHit.name;
    if (ygoHit.set_name)    cardInfo.set_name  = ygoHit.set_name;
    if (ygoHit.set_code)    cardInfo.set_code  = ygoHit.set_code;
    if (ygoHit.set_rarity && !cardInfo.rarity) cardInfo.rarity = ygoHit.set_rarity;
    if (ygoHit.image_url)   cardInfo.image_url = ygoHit.image_url;
    if (ygoHit.image_small) cardInfo.image_small = ygoHit.image_small;
    if (ygoHit.tcgplayer_price != null) cardInfo._ygoprodeck_tcgplayer_price = ygoHit.tcgplayer_price;
    cardInfo.grounded = true;
    cardInfo.grounded_id = ygoHit.id ? String(ygoHit.id) : null;
    cardInfo._ygo_grounded_by = ygoHit.source;
    // Restore confidence — grounding via passcode/set_code is high-confidence
    if ((ygoHit.source === 'passcode' || ygoHit.source === 'set_code') && cardInfo.confidence === 'low') {
      cardInfo.confidence = 'high';
    }
    console.log(`[scan] YGO grounded (${ygoHit.source}): "${before.name}" → "${cardInfo.card_name}" set=${cardInfo.set_name} img=${!!ygoHit.image_url}`);
  } else if (cardInfo.card_name) {
    console.log(`[scan] YGO grounding: no match for "${cardInfo.card_name}" set_code="${cardInfo.set_code || ''}" number="${cardInfo.card_number || ''}"`);
  }
}
// ── Scryfall grounding (MTG) — added 2026-08-19 ──
// Free API, 10 req/sec, no key. Mutates cardInfo in place.
// Called for Ximilar identification results and picker candidates so every MTG
// scan gets canonical name, set_code, set_name, collector_number, image, and prices.
//
// Tiers, most specific first:
//   Tier 1: /cards/<set>/<number>          (perfect precision if Ximilar gave both)
//   Tier 2: /cards/named?exact=<name>&set=<set>
//   Tier 3: /cards/named?exact=<name>
//   Tier 4: /cards/named?fuzzy=<name>
async function groundMagicCardInfo(cardInfo) {
  if (!cardInfo || (cardInfo.card_type !== 'mtg' && cardInfo.card_type !== 'magic')) return;

  const cleanName = String(cardInfo.card_name || '').trim();
  const rawSet    = String(cardInfo.set_code || '').trim().toLowerCase();
  const setCode   = /^[a-z0-9]{3,6}$/.test(rawSet) ? rawSet : '';
  const rawNum    = String(cardInfo.card_number || '').trim();
  // Scryfall collector numbers are digits, sometimes with a suffix like '10a' or '★'
  const collNum   = rawNum.replace(/[^A-Za-z0-9\-\/]/g, '').replace(/\/.*$/, '');

  const fetchScry = async (url) => {
    try {
      const ac = new AbortController();
      const tt = setTimeout(() => ac.abort(), 4000);
      const r  = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'CardResell/1.0' } }).catch(() => null);
      clearTimeout(tt);
      if (!r || !r.ok) return null;
      return await r.json().catch(() => null);
    } catch (_) { return null; }
  };

  let hit = null;
  let source = '';

  // Tier 1: set + collector number
  if (!hit && setCode && collNum) {
    const j = await fetchScry(`https://api.scryfall.com/cards/${encodeURIComponent(setCode)}/${encodeURIComponent(collNum)}`);
    if (j && j.name) { hit = j; source = 'set_number'; }
  }
  // Tier 2: exact name + set
  if (!hit && cleanName && setCode) {
    const j = await fetchScry(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cleanName)}&set=${encodeURIComponent(setCode)}`);
    if (j && j.name) { hit = j; source = 'exact_set'; }
  }
  // Tier 3: exact name only
  if (!hit && cleanName) {
    const j = await fetchScry(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cleanName)}`);
    if (j && j.name) { hit = j; source = 'exact'; }
  }
  // Tier 4: fuzzy name
  if (!hit && cleanName) {
    const j = await fetchScry(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cleanName)}`);
    if (j && j.name) { hit = j; source = 'fuzzy'; }
  }

  if (!hit) {
    if (cleanName) console.log(`[scan] MTG grounding: no Scryfall match for "${cleanName}" set="${setCode}" num="${collNum}"`);
    return;
  }

  const before = { name: cardInfo.card_name, set: cardInfo.set_name };
  const imgFront = hit.image_uris?.normal || hit.card_faces?.[0]?.image_uris?.normal || null;
  const imgSmall = hit.image_uris?.small  || hit.card_faces?.[0]?.image_uris?.small  || null;
  cardInfo.card_name    = hit.name || cardInfo.card_name;
  cardInfo.set_code     = (hit.set || cardInfo.set_code || '').toUpperCase();
  cardInfo.set_name     = hit.set_name || cardInfo.set_name;
  cardInfo.card_number  = hit.collector_number || cardInfo.card_number;
  if (hit.rarity && !cardInfo.rarity) cardInfo.rarity = hit.rarity;
  if (imgFront) cardInfo.image_url   = imgFront;
  if (imgSmall) cardInfo.image_small = imgSmall;

  // Prices (bundled for free) — stash for /api/tcg-price fallback path.
  const p = hit.prices || {};
  cardInfo._scryfall_prices = {
    usd:      parseFloat(p.usd)      || null,
    usd_foil: parseFloat(p.usd_foil) || null,
    usd_etched: parseFloat(p.usd_etched) || null,
    eur:      parseFloat(p.eur)      || null,
    eur_foil: parseFloat(p.eur_foil) || null,
    tix:      parseFloat(p.tix)      || null,
  };

  cardInfo.grounded = true;
  cardInfo.grounded_id = hit.id ? String(hit.id) : cardInfo.grounded_id || null;
  cardInfo._mtg_grounded_by = source;
  if ((source === 'set_number' || source === 'exact_set') && cardInfo.confidence === 'low') {
    cardInfo.confidence = 'high';
  }
  console.log(`[scan] MTG grounded (${source}): "${before.name}" \u2192 "${cardInfo.card_name}" set=${cardInfo.set_code} img=${!!imgFront} usd=${cardInfo._scryfall_prices.usd}`);
}

// ── Lorcana grounding (lorcana-api.com) — added 2026-08-19 ──
// Free API, 100 req/day, no key. Mutates cardInfo in place.
//
// Tiers:
//   Tier 1: search by exact Name + Set_ID
//   Tier 2: search by exact Name
//   Tier 3: fuzzy name (contains)
async function groundLorcanaCardInfo(cardInfo) {
  if (!cardInfo || cardInfo.card_type !== 'lorcana') return;

  const cleanName = String(cardInfo.card_name || '').trim();
  if (!cleanName) return;
  const rawSet = String(cardInfo.set_code || cardInfo.set_name || '').trim();

  const fetchLor = async (url) => {
    try {
      const ac = new AbortController();
      const tt = setTimeout(() => ac.abort(), 4000);
      const r  = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'CardResell/1.0' } }).catch(() => null);
      clearTimeout(tt);
      if (!r || !r.ok) return null;
      return await r.json().catch(() => null);
    } catch (_) { return null; }
  };

  let hits = null;
  let source = '';

  // Tier 1: exact name + set
  if (rawSet) {
    const url = `https://api.lorcana-api.com/cards/fetch?search=Name%3D${encodeURIComponent(cleanName)}%3BSet_ID%3D${encodeURIComponent(rawSet)}`;
    const j = await fetchLor(url);
    if (Array.isArray(j) && j.length) { hits = j; source = 'exact_set'; }
  }
  // Tier 2: exact name only
  if (!hits) {
    const url = `https://api.lorcana-api.com/cards/fetch?search=Name%3D${encodeURIComponent(cleanName)}`;
    const j = await fetchLor(url);
    if (Array.isArray(j) && j.length) { hits = j; source = 'exact'; }
  }
  // Tier 3: fuzzy (Name~)
  if (!hits) {
    const url = `https://api.lorcana-api.com/cards/fetch?search=Name~${encodeURIComponent(cleanName)}`;
    const j = await fetchLor(url);
    if (Array.isArray(j) && j.length) { hits = j; source = 'fuzzy'; }
  }

  if (!hits || !hits.length) {
    console.log(`[scan] Lorcana grounding: no match for "${cleanName}" set="${rawSet}"`);
    return;
  }

  const card = hits[0];
  const before = { name: cardInfo.card_name, set: cardInfo.set_name };
  cardInfo.card_name   = card.Name        || cardInfo.card_name;
  cardInfo.set_code    = card.Set_ID      || cardInfo.set_code;
  cardInfo.set_name    = card.Set_Name    || cardInfo.set_name;
  cardInfo.card_number = card.Card_Num    || cardInfo.card_number;
  if (card.Rarity && !cardInfo.rarity) cardInfo.rarity = card.Rarity;
  if (card.Image)    cardInfo.image_url = card.Image;
  if (card.Image)    cardInfo.image_small = card.Image;

  cardInfo.grounded = true;
  cardInfo.grounded_id = card.Unique_ID || card.Card_Num || cardInfo.grounded_id || null;
  cardInfo._lorcana_grounded_by = source;
  if (source === 'exact_set' && cardInfo.confidence === 'low') cardInfo.confidence = 'high';
  console.log(`[scan] Lorcana grounded (${source}): "${before.name}" \u2192 "${cardInfo.card_name}" set=${cardInfo.set_code} img=${!!card.Image}`);
}

// ── PokemonTCG.io grounding (Pokemon EN) — added 2026-08-21 ──
// Root cause of the ~25% "wrong card + shows my photo" bug: on the Ximilar
// happy path, Pokemon cards were returned with `image_url=null`,
// `grounded_id=null`, and a set_code Ximilar invented ("B2") that doesn't
// resolve on pokemontcg.io (whose Base Set 2 prefix is "base4"). The client
// then had to fuzzy-search on `name + number` alone; Pikachu #1 has dozens
// of promo printings so the wrong match rate was enormous, and when the
// client picked nothing, the synth-card fallback (`imageDataUrl`) rendered
// the user's own photo as the card image.
//
// This grounder runs on the Ximilar identification path so response.image_url
// is populated for every English Pokemon card that pokemontcg.io knows about.
//
// Tiers, most specific first:
//   Tier 1: name:<name> number:<num>              (exact name + exact number)
//   Tier 2: name:<nameNoSuffix> number:<num>      (strip ex/EX/VMAX/etc)
//   Tier 3: name:<identifier> number:<num>        (last identifying word)
//   Tier 4: name:<identifier>*                    (wildcard, filter by number+set)
async function groundPokemonCardInfo(cardInfo) {
  if (!cardInfo || cardInfo.card_type !== 'pokemon') return;
  // Note: pokemontcg.io DOES carry many recent JP sets (sv1a Triplet Beat, sv2a
  // 151, sv5k Wild Force, sv6a Night Wanderer, etc). We used to skip JP here
  // because the API was long thought to be EN-only, but they've been indexing
  // JP releases since 2023. Try the lookup for JP too — if the tiered query
  // finds nothing (older/JP-only sets like s10a, sm1a), we silently fall
  // through and the client-side JP path can still populate images later.

  const rawName = String(cardInfo.card_name || '').trim();
  const rawNum  = String(cardInfo.card_number || '').trim();
  const rawSet  = String(cardInfo.set_name  || '').trim();
  if (!rawName) return;

  const cleanName = rawName.replace(/["\\]/g, '');
  const cleanNum  = rawNum.replace(/\/.*$/, '').replace(/^0+/, '') || rawNum;

  // KV cache lookup — same card gets scanned by many users. 30-day TTL,
  // ID + image lookups are effectively immutable per printing. Cuts
  // pokemontcg.io traffic massively and gives us instant enrichment when
  // the community API is 502'ing.
  const kvUrl2   = process.env.KV_REST_API_URL;
  const kvToken2 = process.env.KV_REST_API_TOKEN;
  const cacheKey = `ptcg:${cleanName.toLowerCase()}|${cleanNum}|${rawSet.toLowerCase()}`;
  let cached = null;
  if (kvUrl2 && kvToken2) {
    try {
      const cr = await fetch(`${kvUrl2}/get/${encodeURIComponent(cacheKey)}`,
        { headers: { Authorization: `Bearer ${kvToken2}` }, signal: AbortSignal.timeout(1200) });
      const cd = await cr.json();
      if (cd?.result) cached = JSON.parse(cd.result);
    } catch(_) { /* KV best-effort */ }
  }
  if (cached && cached.id) {
    cardInfo.card_name = cached.name || cardInfo.card_name;
    if (cached.number)   cardInfo.card_number = String(cached.number);
    if (cached.set_name) cardInfo.set_name    = cached.set_name;
    if (cached.set_code) cardInfo.set_code    = cached.set_code;
    if (cached.rarity && !cardInfo.rarity) cardInfo.rarity = cached.rarity;
    if (cached.hp     && !cardInfo.hp)     cardInfo.hp     = String(cached.hp);
    if (cached.year   && !cardInfo.year)   cardInfo.year   = cached.year;
    cardInfo._grounded_id = cached.id;
    cardInfo.grounded_id  = cached.id;
    if (cached.image_url)   cardInfo.image_url   = cached.image_url;
    if (cached.image_small) cardInfo.image_small = cached.image_small;
    cardInfo._grounded = true;
    cardInfo._pokemon_grounded_by = 'kv-cache';
    return;
  }

  const queries = [];
  if (cleanName && cleanNum) {
    queries.push(`name:"${cleanName}" number:${cleanNum}`);

    const nameNoSuffix = cleanName
      .replace(/\s+(ex|EX|VMAX|VSTAR|V|GX|Star|\u2605)$/i, '')
      .trim();
    if (nameNoSuffix && nameNoSuffix !== cleanName) {
      queries.push(`name:"${nameNoSuffix}" number:${cleanNum}`);
    }

    const words = cleanName.split(/\s+/).filter(w => w && !/^(mega|dark|radiant|shining|team|light|ex|EX|VMAX|VSTAR|V|GX|Star|\u2605)$/i.test(w));
    const identifier = words[words.length - 1] || words[0];
    if (identifier && identifier !== cleanName && !queries.some(q => q.includes(`"${identifier}"`))) {
      queries.push(`name:"${identifier}" number:${cleanNum}`);
    }
  }
  if (cleanName && queries.length === 0) {
    queries.push(`name:"${cleanName}"`);
  }

  let best = null;
  const wantNum = cleanNum ? cleanNum.replace(/^0+/, '') || '0' : '';

  // Small helper: fetch with retries on 5xx / network error. pokemontcg.io
  // is a Cloudflare-fronted community API that returns intermittent 502s
  // (~10-20% of the time under any load). 3 attempts with exponential
  // backoff (250ms, 750ms) covers the vast majority of transient failures
  // and keeps total worst-case latency under ~8s.
  const fetchWithRetry = async (url) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(3500) });
        if (r.ok) return r;
        if (r.status < 500) return r; // 4xx — no point retrying
      } catch(_) { /* fall through to retry */ }
      if (attempt < 2) await new Promise(res => setTimeout(res, 250 * (attempt + 1)));
    }
    return null;
  };

  for (const q of queries) {
    try {
      const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=25&select=id,name,set,number,rarity,hp,images`;
      const r = await fetchWithRetry(url);
      if (!r || !r.ok) continue;
      const j = await r.json();
      let cards = (j.data || []);

      // Hard number filter when we have a number.
      if (wantNum) {
        cards = cards.filter(c => {
          const cn = String(c.number || '').replace(/^0+/, '') || '0';
          return cn === wantNum;
        });
      }
      if (cards.length === 0) continue;

      // Prefer cards whose set name shares tokens with Ximilar's set_name.
      const modelSetLo = rawSet.toLowerCase();
      let ranked = cards;
      if (modelSetLo && cards.length > 1) {
        ranked = cards.map(c => {
          const setLo = (c.set?.name || '').toLowerCase();
          const setTokens = new Set(modelSetLo.split(/\W+/).filter(t => t.length >= 3));
          let hit = 0;
          for (const t of setTokens) if (setLo.includes(t)) hit++;
          return { c, score: hit };
        }).sort((a,b) => b.score - a.score).map(x => x.c);
      }
      best = ranked[0];
      if (best) break;
    } catch(_) { /* try next query */ }
  }

  if (!best) return;

  // Write to KV cache for future scans of this card (30d TTL).
  if (kvUrl2 && kvToken2) {
    try {
      const payload = {
        id:          best.id,
        name:        best.name,
        number:      best.number,
        set_name:    best.set?.name || '',
        set_code:    best.set?.ptcgoCode || best.set?.id || '',
        rarity:      best.rarity || '',
        hp:          best.hp || '',
        year:        (best.set?.releaseDate && /^\d{4}/.test(best.set.releaseDate)) ? best.set.releaseDate.slice(0,4) : '',
        image_url:   best.images?.large || best.images?.small || '',
        image_small: best.images?.small || best.images?.large || '',
      };
      // 30 days = 2_592_000s
      await fetch(`${kvUrl2}/setex/${encodeURIComponent(cacheKey)}/2592000/${encodeURIComponent(JSON.stringify(payload))}`,
        { method: 'POST', headers: { Authorization: `Bearer ${kvToken2}` }, signal: AbortSignal.timeout(1500) });
    } catch(_) { /* best-effort */ }
  }

  cardInfo.card_name   = best.name || cardInfo.card_name;
  if (best.number)     cardInfo.card_number = String(best.number);
  if (best.set?.name)  cardInfo.set_name    = best.set.name;
  if (best.set?.ptcgoCode) cardInfo.set_code = best.set.ptcgoCode;
  else if (best.set?.id)   cardInfo.set_code = best.set.id;
  if (best.rarity && !cardInfo.rarity) cardInfo.rarity = best.rarity;
  if (best.hp && !cardInfo.hp)         cardInfo.hp     = String(best.hp);
  if (best.set?.releaseDate && !cardInfo.year) {
    const yr = String(best.set.releaseDate).slice(0, 4);
    if (/^\d{4}$/.test(yr)) cardInfo.year = yr;
  }

  // CRITICAL: overwrite grounded_id with a REAL pokemontcg.io id
  // (was previously Ximilar's `<set_series_code>-<num>` which rarely matched).
  cardInfo._grounded_id = best.id || null;
  cardInfo.grounded_id  = best.id || cardInfo.grounded_id || null;

  // CRITICAL: populate image_url so the client never falls back to imageDataUrl.
  if (best.images?.large || best.images?.small) {
    cardInfo.image_url   = best.images.large || best.images.small;
    cardInfo.image_small = best.images.small || best.images.large;
  }

  cardInfo._grounded = true;
  cardInfo._pokemon_grounded_by = 'pokemontcg.io';
  console.log(`[scan] Pokemon grounded: "${rawName}" #${rawNum} \u2192 id=${best.id} img=${!!(best.images?.large || best.images?.small)}`);
}

// ============================================================================
// One Piece grounding via Limitless One Piece CDN (deterministic URL pattern).
// Set prefix is uppercase (OP01, OP02, ST01, EB01, P-001 etc), number is
// zero-padded to 3 digits, English cards use _EN.webp, parallel/alt-art use
// _p1_EN.webp / _p2_EN.webp variants.
//
// This is a HEAD-only grounder — we probe HEAD to check the image exists at
// the deterministic URL, and only assign image_url when confirmed. No API call
// needed; Limitless serves the set+number scheme uniformly.
// ============================================================================
async function groundOnePieceCardInfo(cardInfo) {
  if (!cardInfo || cardInfo.card_type !== 'onepiece') return;

  const rawName = String(cardInfo.card_name || '').trim();
  const rawNum  = String(cardInfo.card_number || '').trim();
  const rawGid  = String(cardInfo.grounded_id || cardInfo._grounded_id || '').trim();
  if (!rawName || !rawNum) return;

  // Extract set prefix from grounded_id (Ximilar sets it as "op01-1") or from
  // card_number if it already includes it ("OP01-001").
  let setPrefix = '';
  let cardNumRaw = rawNum.replace(/^#/, '');
  const gidMatch = rawGid.match(/^([a-z]+\d+|st\d+|eb\d+|p)-(\d+)$/i);
  const numMatch = cardNumRaw.match(/^([a-z]+\d+|st\d+|eb\d+|p)-?(\d+)$/i);
  if (gidMatch) {
    setPrefix = gidMatch[1].toUpperCase();
    cardNumRaw = gidMatch[2];
  } else if (numMatch) {
    setPrefix = numMatch[1].toUpperCase();
    cardNumRaw = numMatch[2];
  } else if (cardInfo.set_code) {
    setPrefix = String(cardInfo.set_code).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  }
  if (!setPrefix) return;

  // Zero-pad to 3 digits
  const paddedNum = cardNumRaw.padStart(3, '0');
  const cardCode = `${setPrefix}-${paddedNum}`;

  // Try standard, then parallel variants. Limitless serves *_EN.webp for base,
  // *_p1_EN.webp for first parallel/alt-art, etc.
  const base = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/one-piece';
  const candidates = [
    `${base}/${setPrefix}/${cardCode}_EN.webp`,
    `${base}/${setPrefix}/${cardCode}_p1_EN.webp`,
    `${base}/${setPrefix}/${cardCode}_p2_EN.webp`,
  ];

  for (const url of candidates) {
    try {
      const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(2500) });
      if (r.ok) {
        cardInfo.image_url   = url;
        cardInfo.image_small = url;
        cardInfo._grounded_id = cardCode.toLowerCase();
        cardInfo.grounded_id  = cardCode.toLowerCase();
        cardInfo.card_number  = paddedNum;
        cardInfo.set_code     = setPrefix;
        cardInfo._grounded    = true;
        cardInfo._onepiece_grounded_by = 'limitless-cdn';
        console.log(`[scan] One Piece grounded: "${rawName}" ${cardCode} \u2192 ${url}`);
        return;
      }
    } catch (_) { /* try next variant */ }
  }
  console.log(`[scan] One Piece grounding miss: "${rawName}" ${cardCode}`);
}

// ============================================================================
// Sports grounding — minimal enrichment. Ximilar returns name+number+year but
// often empty set_name. We can't cheaply fetch card images for sports (no
// public CDN pattern like Limitless), so this function focuses on:
//   1. Ensuring `year` is populated and consistent
//   2. Detecting brand from Ximilar tags/name (Fleer/Topps/Bowman/Panini/etc)
//      so downstream PriceCharting can query with brand+year, avoiding the
//      Tom Brady → Funko POP NFL failure mode
//   3. Detecting sport (basketball/football/baseball/hockey) from card fields
// ============================================================================
function groundSportsCardInfo(cardInfo) {
  if (!cardInfo || cardInfo.card_type !== 'sports') return;

  const name = String(cardInfo.card_name || '');
  const set  = String(cardInfo.set_name || '');
  const combined = (name + ' ' + set).toLowerCase();

  // Brand detection — the most common vintage/modern sports card manufacturers.
  // We attach as cardInfo.brand for the client to pass to /api/pricecharting.
  const brandPatterns = [
    'fleer', 'topps', 'bowman', 'panini', 'donruss', 'upper deck',
    'score', 'leaf', 'pro set', 'stadium club', 'skybox', 'prizm',
    'select', 'optic', 'chrome', 'mosaic', 'contenders', 'hoops',
    'absolute', 'certified', 'immaculate', 'national treasures',
    'flair', 'metal universe', 'e-x', 'ultra',
  ];
  for (const b of brandPatterns) {
    if (combined.includes(b)) {
      cardInfo.brand = b.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
      break;
    }
  }

  // Sport detection — either from cardInfo.sport (Ximilar may set it) or
  // guessed from set name / famous player names.
  if (!cardInfo.sport) {
    if (/basketball|nba|hoops|prizm bk/.test(combined)) cardInfo.sport = 'basketball';
    else if (/football|nfl|nfl draft/.test(combined))  cardInfo.sport = 'football';
    else if (/baseball|mlb|topps baseball/.test(combined)) cardInfo.sport = 'baseball';
    else if (/hockey|nhl/.test(combined))              cardInfo.sport = 'hockey';
    else if (/soccer|fifa|mls|premier league/.test(combined)) cardInfo.sport = 'soccer';
  }

  cardInfo._grounded = true;
  cardInfo._sports_grounded_by = 'field-enrichment';
  console.log(`[scan] Sports enriched: "${name}" year=${cardInfo.year} brand=${cardInfo.brand||'?'} sport=${cardInfo.sport||'?'}`);
}

// Dispatcher — call the right per-game grounder
async function groundCardInfoByGame(cardInfo) {
  if (!cardInfo) return;
  const t = cardInfo.card_type;
  if (t === 'yugioh')                  return groundYugiohCardInfo(cardInfo);
  if (t === 'mtg' || t === 'magic')    return groundMagicCardInfo(cardInfo);
  if (t === 'lorcana')                 return groundLorcanaCardInfo(cardInfo);
  if (t === 'pokemon')                 return groundPokemonCardInfo(cardInfo);
  if (t === 'onepiece' || t === 'one_piece' || t === 'one piece') return groundOnePieceCardInfo(cardInfo);
  if (t === 'sports')                  return groundSportsCardInfo(cardInfo);
}

// /api/scan — Ximilar-only card identification; AI-assisted grading
// POST { imageBase64, mimeType, email, googleSub }
// Authorization: Bearer <google_id_token>
// Returns: { card_name, card_number, set_name, hp, card_type, rarity, success: true }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Auth ──
  // 2026-08-25: Require a verified Google/Firebase ID token. The previous
  // flexible-auth accepted body-supplied email/googleSub, which let an
  // unauthenticated attacker call this endpoint against a victim's uid and
  // drain their ID/paid credits (the DECR is atomic per key). Identity now
  // comes ONLY from a cryptographically verified token — body identity is
  // ignored.
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken || idToken.length < 20) {
    return res.status(401).json({ error: 'Sign in with Google to use the scanner.' });
  }

  let userEmail = '';
  let googleSub = '';
  try {
    const tokenInfo = await verifyTokenFlexible(idToken);
    googleSub = tokenInfo.uid   || '';
    userEmail = tokenInfo.email || '';
  } catch(e) {
    return res.status(401).json({ error: 'Session expired. Sign in again to use the scanner.' });
  }

  if (!userEmail && !googleSub) {
    return res.status(401).json({ error: 'Sign in with Google to use the scanner.' });
  }

  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  const hasKV   = !!(kvUrl && kvToken);
  const key     = googleSub || userEmail;

  // ── 3. Get image + mode (read early so credit logic can branch) ──
  const { imageBase64, mimeType, mode, deepGrade } = req.body || {};

  // 2026-08-25 [P0-3]: Validate presence of imageBase64 BEFORE any credit
  // debit. Previously the check lived at ~line 883 — AFTER the atomic DECR —
  // so a client bug or truncated request would burn a paid credit and return
  // 400 without refunding. Fail cleanly here.
  if (!imageBase64) {
    return res.status(400).json({ error: 'No image provided.' });
  }
  const isGradeMode    = mode === 'grade';
  const isIdentifyMode = !isGradeMode; // identify is the default
  // Deep Grade = 6-photo PSA-style inspection (front + back + 4 edges), costs 2 credits.
  // Only applies to grade mode; ignored otherwise.
  const isDeepGrade    = isGradeMode && deepGrade === true;
  const gradeCost      = isDeepGrade ? 2 : 1;

  // Pull edge photos early so we can validate BEFORE deducting any credits
  const { backBase64, backMimeType,
          topEdgeBase64, topEdgeMimeType,
          bottomEdgeBase64, bottomEdgeMimeType,
          leftEdgeBase64, leftEdgeMimeType,
          rightEdgeBase64, rightEdgeMimeType } = req.body || {};

  // Photo count validation — enforce per-tier minimums BEFORE deducting any credits or
  // spending money on OpenAI. "More photos = better grade" but we set a floor so tier
  // pricing reflects real work being done.
  const edgeCount = [topEdgeBase64, bottomEdgeBase64, leftEdgeBase64, rightEdgeBase64].filter(Boolean).length;
  const totalPhotos = (imageBase64 ? 1 : 0) + (backBase64 ? 1 : 0) + edgeCount;

  if (isDeepGrade) {
    // Deep Grade: 4–6 photos required. Must include front + back at minimum,
    // plus at least 2 edge photos (any combination).
    if (!imageBase64 || !backBase64) {
      return res.status(400).json({
        error: 'Deep Grade requires at least a front and back photo of the card.',
        missingPhotos: [!imageBase64 && 'front', !backBase64 && 'back'].filter(Boolean),
      });
    }
    if (edgeCount < 2) {
      return res.status(400).json({
        error: `Deep Grade needs 4–6 photos total (front, back, plus 2–4 edge close-ups). You provided ${totalPhotos}.`,
        needsMoreEdges: 2 - edgeCount,
        edgeCount,
      });
    }

    // ── PHOTO QC GATE ──
    // Reject if the user uploaded the same photo multiple times (gaming the
    // photo-count requirement). We hash the first 4KB of each base64 payload
    // — near-identical uploads will collide, distinct photos won't.
    // Also reject if any photo is suspiciously small (< 4KB) which usually
    // means a thumbnail or corrupted upload.
    const photoSlots = [
      { name: 'front',        b64: imageBase64 },
      { name: 'back',         b64: backBase64 },
      { name: 'top edge',     b64: topEdgeBase64 },
      { name: 'bottom edge',  b64: bottomEdgeBase64 },
      { name: 'left edge',    b64: leftEdgeBase64 },
      { name: 'right edge',   b64: rightEdgeBase64 },
    ].filter(p => p.b64);

    const seen = new Map(); // signature → first slot name
    const dupePairs = [];
    for (const p of photoSlots) {
      // Use a middle-slice signature (not just prefix) to avoid header
      // collisions when the client re-encodes. 512 chars from the middle is
      // plenty to distinguish real photos while staying fast.
      const s = p.b64.length;
      const sig = s < 1024 ? p.b64 : p.b64.substring(Math.floor(s / 2) - 256, Math.floor(s / 2) + 256);
      if (seen.has(sig)) {
        dupePairs.push([seen.get(sig), p.name]);
      } else {
        seen.set(sig, p.name);
      }
    }
    if (dupePairs.length > 0) {
      return res.status(400).json({
        error: `Deep Grade needs distinct photos of each side/edge. Detected duplicate uploads: ${dupePairs.map(pair => `${pair[0]} = ${pair[1]}`).join(', ')}. Retake each photo showing that specific side of the card.`,
        code: 'DUPLICATE_PHOTOS',
        duplicates: dupePairs,
      });
    }

    // Reject any photo that's smaller than ~8KB — real phone photos of a card
    // are 100KB+. Anything smaller is a thumbnail, screenshot, or icon.
    const tinyPhotos = photoSlots.filter(p => p.b64.length < 8000);
    if (tinyPhotos.length > 0) {
      return res.status(400).json({
        error: `Some photos are too small to grade accurately: ${tinyPhotos.map(p => p.name).join(', ')}. Please upload full-resolution phone photos, not thumbnails.`,
        code: 'PHOTOS_TOO_SMALL',
        tooSmall: tinyPhotos.map(p => p.name),
      });
    }
  } else if (isGradeMode) {
    // Quick Grade: front + back required.
    if (!imageBase64 || !backBase64) {
      return res.status(400).json({
        error: 'Grading requires both a front and back photo of the card.',
        missingPhotos: [!imageBase64 && 'front', !backBase64 && 'back'].filter(Boolean),
      });
    }
  }

  // ── 2. Check & consume scan credit(s) ──
  // Track what was consumed so we can refund on downstream failure.
  let consumedFrom   = null; // 'id_paid_left' | 'paid_left' | 'free'
  let consumedAmount = 0;
  // Every scan gets a short opaque id so the user can request a refund from the
  // "not my card" button. We ONLY log successful identify responses so the id
  // is never claimable if the credit was already refunded on the server side.
  const scanId = _shortId();
  if (hasKV) {
    const tier       = await getUserTier(process.env.STRIPE_SECRET_KEY, kvUrl, kvToken, googleSub, userEmail);
    const isPro      = isPaidTier(tier); // any paid tier gets monthly grants

    // 2026-08-20: Recurring monthly free grant for VERIFIED free users only.
    // Bots that skip email verification get 0 credits. Verified free users
    // get 5 ID / 1 Grade per month (auto-resets via monthStamp keying).
    // Stacks on all existing defenses: Google OAuth + Turnstile + IP throttle
    // + one-time-per-email verify gate in verify-confirm.js.
    let emailVerified = false;
    if (tier === 'free' && googleSub) {
      try {
        const vr = await fetch(`${kvUrl}/get/${encodeURIComponent(`email_verified:${googleSub}`)}`, {
          headers: { Authorization: `Bearer ${kvToken}` }
        });
        if (vr.ok) {
          const vj = await vr.json().catch(() => null);
          emailVerified = !!(vj && vj.result);
        }
      } catch (_) { /* fail closed */ }
    }
    const grantEligible = isPro || emailVerified;

    const benefits   = TIER_BENEFITS[tier] || TIER_BENEFITS.free;
    const gradeGrant = benefits.gradeGrant; // 0 / 1(verified) / 10 / 25 / 60
    const idGrant    = benefits.idGrant;    // 0 / 5(verified) / 20 / 50 / 150

    if (isIdentifyMode) {
      // ID scans: grant-eligible users (paid tiers + verified free) draw from
      // monthly free bucket first, then fall back to paid ID credits.
      // Unverified free users go straight to paid (0 free bucket).
      const stamp      = getMonthStamp();
      const idFreeUsed = grantEligible ? await getKVInt(kvUrl, kvToken, `scans:${key}:id_free_used_${stamp}`) : idGrant;
      const idFreeLeft = grantEligible ? Math.max(0, idGrant - idFreeUsed) : 0;

      if (idFreeLeft > 0) {
        // Free bucket usage is capped by monthly grant — an over-INCR here is
        // bounded and reconciled by the refund path; keep the simple flow.
        await incrKV(kvUrl, kvToken, `scans:${key}:id_free_used_${stamp}`);
        consumedFrom = 'id_free';
        consumedAmount = 1;
      } else {
        // 2026-08-22 [F6]: atomic DECR guards against concurrent bulk workers
        // racing read → setKV(cur-1). If the new value is negative, refund and
        // return 402 — the credits ran out during this batch.
        const newLeft = await decrKV(kvUrl, kvToken, `scans:${key}:id_paid_left`);
        if (newLeft === null) {
          // KV DECR failed — fall back to old read-then-write to avoid hard-blocking users on transient errors.
          const idPaidFallback = await getKVInt(kvUrl, kvToken, `scans:${key}:id_paid_left`);
          if (idPaidFallback <= 0) {
            return res.status(402).json({ error: 'No ID scan credits remaining.', needsPayment: true, mode: 'identify' });
          }
          await setKV(kvUrl, kvToken, `scans:${key}:id_paid_left`, idPaidFallback - 1);
        } else if (newLeft < 0) {
          // Over-drawn by a concurrent worker — refund the debit atomically.
          await incrKV(kvUrl, kvToken, `scans:${key}:id_paid_left`);
          return res.status(402).json({ error: 'No ID scan credits remaining.', needsPayment: true, mode: 'identify' });
        }
        consumedFrom = 'id_paid_left';
        consumedAmount = 1;
      }
    } else {
      // Graded scans: grant-eligible users (paid tiers + verified free) draw
      // from monthly grant bucket first, then paid_left.
      // Deep Grade costs 2 credits — must come from the SAME bucket (no mixing).
      const paid     = await getKVInt(kvUrl, kvToken, `scans:${key}:paid_left`);
      const stamp    = getMonthStamp();
      const freeUsed = grantEligible ? await getKVInt(kvUrl, kvToken, `scans:${key}:free_used_${stamp}`) : gradeGrant;
      const freeLeft = grantEligible ? Math.max(0, gradeGrant - freeUsed) : 0;

      if (freeLeft >= gradeCost) {
        // Deduct from free bucket by incrementing free_used by gradeCost
        for (let i = 0; i < gradeCost; i++) {
          await incrKV(kvUrl, kvToken, `scans:${key}:free_used_${stamp}`);
        }
        consumedFrom = 'free';
        consumedAmount = gradeCost;
      } else {
        // 2026-08-22 [F6]: atomic DECRBY protects paid credit accounting across
        // concurrent scans (Deep Grade costs 2 — must be one atomic op).
        const newPaid = await decrByKV(kvUrl, kvToken, `scans:${key}:paid_left`, gradeCost);
        if (newPaid === null) {
          // KV DECRBY failed — fall back to read-then-write.
          const paidFallback = await getKVInt(kvUrl, kvToken, `scans:${key}:paid_left`);
          if (paidFallback < gradeCost) {
            return res.status(402).json({
              error: gradeCost > 1
                ? `Deep Grade needs ${gradeCost} grading credits. You have ${Math.max(freeLeft, paidFallback)}.`
                : 'No grading credits remaining.',
              needsPayment: true, mode: 'grade', deepGrade: isDeepGrade, cost: gradeCost,
            });
          }
          await setKV(kvUrl, kvToken, `scans:${key}:paid_left`, paidFallback - gradeCost);
        } else if (newPaid < 0) {
          // Over-drawn — refund and 402. Restore whatever we took (up to `gradeCost`).
          await incrByKV(kvUrl, kvToken, `scans:${key}:paid_left`, gradeCost);
          return res.status(402).json({
            error: gradeCost > 1
              ? `Deep Grade needs ${gradeCost} grading credits. You have ${Math.max(freeLeft, 0)}.`
              : 'No grading credits remaining.',
            needsPayment: true, mode: 'grade', deepGrade: isDeepGrade, cost: gradeCost,
          });
        }
        consumedFrom = 'paid_left';
        consumedAmount = gradeCost;
      }
    }
  }
  // (imageBase64 presence was already validated near line 684 before any
  // credit was debited — unreachable here, kept intentionally omitted.)

  // Refund helper — called on any downstream failure so the user isn't charged for a broken scan.
  async function refundCredits() {
    if (!hasKV || !consumedFrom || !consumedAmount) return;
    try {
      if (consumedFrom === 'id_free') {
        const stamp = getMonthStamp();
        const cur   = await getKVInt(kvUrl, kvToken, `scans:${key}:id_free_used_${stamp}`);
        await setKV(kvUrl, kvToken, `scans:${key}:id_free_used_${stamp}`, Math.max(0, cur - consumedAmount));
      } else if (consumedFrom === 'id_paid_left') {
        const cur = await getKVInt(kvUrl, kvToken, `scans:${key}:id_paid_left`);
        await setKV(kvUrl, kvToken, `scans:${key}:id_paid_left`, cur + consumedAmount);
      } else if (consumedFrom === 'paid_left') {
        const cur = await getKVInt(kvUrl, kvToken, `scans:${key}:paid_left`);
        await setKV(kvUrl, kvToken, `scans:${key}:paid_left`, cur + consumedAmount);
      } else if (consumedFrom === 'free') {
        const stamp = getMonthStamp();
        const cur   = await getKVInt(kvUrl, kvToken, `scans:${key}:free_used_${stamp}`);
        await setKV(kvUrl, kvToken, `scans:${key}:free_used_${stamp}`, Math.max(0, cur - consumedAmount));
      }
    } catch(e) { console.error('Refund error:', e); }
  }

  const openaiKey    = process.env.OPENAI_API_KEY;
  const ximilarToken = process.env.XIMILAR_API_TOKEN;

  // Identification and grading have separate providers. Ximilar is the sole
  // identity authority, so identify mode must never require or fall back to
  // OpenAI. Grade mode still requires OpenAI for its grading analysis.
  if (isIdentifyMode && !ximilarToken) {
    await refundCredits();
    return res.status(503).json({
      error: 'Card identification is temporarily unavailable. Please try again.',
      code: 'IDENTIFY_PROVIDER_UNAVAILABLE',
    });
  }
  if (isGradeMode && !openaiKey) {
    await refundCredits();
    return res.status(503).json({ error: 'AI grading is temporarily unavailable. Please try again.' });
  }

  // ── 4a. Try Ximilar FIRST for identify mode ──
  // Ximilar's purpose-built collectibles model returns in ~1s and covers
  // Pokemon/MTG/YGO/Lorcana/OnePiece/Sports. GPT-5 was taking 30-60s per
  // scan; Ximilar cuts that to ~1s with better accuracy on holos.
  //
  // 2026-08-19 policy: Ximilar is the SOLE source of truth for card ID.
  //   - If Ximilar identifies the card → return its answer.
  //   - If Ximilar says no_match / no_card_detected / low_confidence →
  //     return a clean "couldn't identify" response, refund the credit,
  //     and let the client show the scan-miss panel. Do NOT fall through
  //     to GPT vision for ID (GPT hallucinates card names on fakes,
  //     off-frame shots, and cards outside Ximilar's DB).
  //   - If Ximilar has a hard provider error (network, HTTP, parse, missing
  //     configuration), refund the credit and return a temporary-unavailable
  //     response. Never substitute a different model's identity guess.
  //
  // Grade mode is unchanged — Deep Grade still uses Ximilar CV grader,
  // Quick Grade still uses GPT for centering/edges/surface.
  const XIMILAR_MISS_REASONS = new Set(['no_match', 'no_card_detected', 'low_confidence', 'no_records']);
  if (isIdentifyMode && imageBase64) {
    // Detect "maybe sports" heuristically: user hasn't told us, and Ximilar's
    // TCG endpoint would return no_match for real sports cards. Try TCG first;
    // fall back to sport_id if the first attempt returns no_match/no_card.
    const t0 = Date.now();
    let xim = await identifyWithXimilar(imageBase64, mimeType || 'image/jpeg', ximilarToken, 'tcg');
    if (!xim.ok && (xim.reason === 'no_match' || xim.reason === 'no_card_detected')) {
      // Retry as sports card (cheap: still 10 credits, same as TCG)
      const ximSport = await identifyWithXimilar(imageBase64, mimeType || 'image/jpeg', ximilarToken, 'sport');
      if (ximSport.ok) xim = ximSport;
      else if (ximSport.reason) xim = ximSport; // keep the most recent reason for logging
    }
    const tMs = Date.now() - t0;
    console.log('[scan] ximilar took', tMs, 'ms ok=', xim.ok, 'reason=', xim.reason, 'dist=', xim.cardInfo?._ximilar_dist);

    // Every Ximilar failure terminates identify mode. Expected misses return
    // an unidentified result; provider/configuration failures return 503.
    // Both paths refund the consumed credit and neither can reach GPT.
    if (!xim.ok) {
      await refundCredits();
      if (!XIMILAR_MISS_REASONS.has(xim.reason)) {
        console.error('[scan] ximilar provider failure (' + (xim.reason || 'unknown') + ') — identify unavailable; no GPT fallback');
        return res.status(503).json({
          error: 'Card identification is temporarily unavailable. Please try again.',
          code: 'IDENTIFY_PROVIDER_UNAVAILABLE',
          provider_reason: xim.reason || 'unknown',
        });
      }
      console.log('[scan] ximilar miss (' + xim.reason + ') — returning unidentified; no GPT fallback');
      return res.status(200).json({
        success: true,
        mode: 'identify',
        scan_id: scanId,
        identified: false,
        confidence: 'low',
        image_quality: 'ok',
        glare_regions: [],
        retake_hint: 'We couldn\u2019t identify this card. It may be a custom/proxy card, out-of-focus, or a very new release. Try a sharper photo with the full card visible.',
        card_name: '',
        card_number: '',
        set_name: '',
        set_code: '',
        grounded: false,
        grounded_id: null,
        hp: '',
        card_type: '',
        is_japanese: false,
        jp_name: '',
        rarity: '',
        sport: '',
        year: '',
        source: 'ximilar',
        ximilar_reason: xim.reason,
        ximilar_distance: xim.distance || null,
      });
    }

    if (xim.ok) {
      const cardInfo = xim.cardInfo;
      const idConfNorm = cardInfo.confidence || 'high';

      // 2026-08-19: Ximilar's Subcategory tag occasionally mislabels a card's
      // TCG (e.g. tagged a real Yu-Gi-Oh "Invoked Baybarron / CORE-EN031" as
      // Pokemon, which cascaded into wrong pricing + a bogus cross-TCG game
      // switch on the client). Reconcile using the OCR'd card_number Ximilar
      // itself returned — card_number formats are unambiguous across TCGs.
      //   yugioh:   3-5 letters + hyphen + region (EN/DE/FR/IT/PT/SP/JP/KR/TC/AE) + 3-4 alnum
      //             (e.g. LOB-EN001, CORE-EN031, MP24-EN123, RA02-EN050)
      //   onepiece: OP##-### / ST##-### / EB##-###
      //   lorcana:  \d+/\d+ with 3-letter set code somewhere (not detectable from number alone)
      // Pokemon and MTG use short numeric card_numbers, so we can't disambiguate
      // *into* those from the number alone — but we CAN detect that a card_number
      // matching YGO/OP format means the Subcategory tag is wrong.
      const reconcileTypeFromNumber = (info) => {
        const num = String(info.card_number || '').trim().toUpperCase();
        if (!num) return info.card_type;
        // Strong YGO signal: <SET>-<REGION><###> where region is a real 2-letter locale
        if (/^[A-Z0-9]{2,6}-(EN|DE|FR|IT|PT|SP|JP|KR|TC|AE|EU)[A-Z0-9]{2,4}$/.test(num)) {
          return 'yugioh';
        }
        // Strong One Piece signal: OP01-001, ST05-012, EB01-042, PRB01-##
        if (/^(OP|ST|EB|PRB)\d{2}-\d{2,3}$/.test(num)) {
          return 'onepiece';
        }
        // Strong YGO signal: purely-numeric 5\u201310 digit card_number is a
        // Konami passcode. No other TCG uses this format:
        //   Pokemon uses "057" / "057/162" / "SWSH123" / "TG12"
        //   MTG uses "147a" / "212" (short) + always in a printed set with letters
        //   Lorcana uses "1/204"
        //   Sports uses year+brand+number strings
        // 2026-08-19: This fires when Ximilar mis-tags subcategory=Pokemon on a
        // YGO card but still returns the passcode (e.g. Invoked Baybarron =>
        // '101305031'). YGOProDeck accepts both 8- and 9-digit passcodes.
        if (/^\d{5,10}$/.test(num)) {
          return 'yugioh';
        }
        return info.card_type;
      };
      const reconciledType = reconcileTypeFromNumber(cardInfo);
      if (reconciledType && reconciledType !== cardInfo.card_type) {
        console.warn(`[scan] reconciled card_type: ${cardInfo.card_type} \u2192 ${reconciledType} based on card_number "${cardInfo.card_number}"`);
        cardInfo.card_type = reconciledType;
        // If the number was clearly YGO, the Pokemon Subcategory tag was wrong;
        // set_name / set_code that Ximilar returned came from its Pokemon DB
        // and are almost certainly nonsense in this case. Blank them so the
        // downstream YGO grounding step below can populate the right values.
        if (reconciledType === 'yugioh' || reconciledType === 'onepiece') {
          cardInfo.set_name = '';
          cardInfo.set_code = '';
          cardInfo.rarity   = '';
          cardInfo.is_japanese = false; // Ximilar's alphabet tag was for pokemon path
        }
        // Reconcile candidates too — same logic
        if (Array.isArray(xim.candidates)) {
          xim.candidates.forEach(c => {
            if (!c) return;
            const t = reconcileTypeFromNumber(c);
            if (t && t !== c.card_type) {
              c.card_type = t;
              if (t === 'yugioh' || t === 'onepiece') {
                c.set_name = ''; c.set_code = ''; c.rarity = '';
              }
            }
          });
        }
      }

      // Run YGO grounding on the Ximilar path. Ximilar's YGO data is often incomplete/wrong:
      //   - card_name occasionally misspelled ("Invoked Babalon" vs "Baybarron")
      //   - card_number returned as Konami passcode (101305031) not printed set code
      //   - set_code/set_name frequently "UNKNOWN"
      // YGOProDeck grounding (passcode → set_code → name → fuzzy) fixes all of these.
      // 2026-08-19: now dispatches to per-game grounder (yugioh/mtg/lorcana).
      // Pokemon has its own grounding via pokemontcg.io later in the flow.
      // 2026-08-21: ground top + all candidates in parallel. Previously the
      // top ran alone first, so a pokemontcg.io 502 flake disproportionately
      // failed the top while candidates (which ran later) succeeded. Parallel
      // + shared retry logic evens this out.
      {
        const allInfos = [cardInfo, ...(Array.isArray(xim.candidates) ? xim.candidates : [])];
        await Promise.all(allInfos.map(info => groundCardInfoByGame(info).catch(() => {})));
      }

      // Belt-and-suspenders: if the top still has no image_url but a candidate
      // representing the same card (name + number + set_name match) did get
      // grounded, copy its enrichment onto the top. Same-card because Ximilar
      // uses `cardInfo = candidates[0]` semantically — they came from the
      // same best_match, but as independent object copies.
      if (cardInfo && !cardInfo.image_url && Array.isArray(xim.candidates)) {
        const sameCard = xim.candidates.find(c =>
          c && c.image_url &&
          (c.card_name  || '').toLowerCase() === (cardInfo.card_name  || '').toLowerCase() &&
          String(c.card_number || '') === String(cardInfo.card_number || '') &&
          (c.set_name   || '').toLowerCase() === (cardInfo.set_name   || '').toLowerCase()
        );
        if (sameCard) {
          if (sameCard.image_url)   cardInfo.image_url   = sameCard.image_url;
          if (sameCard.image_small) cardInfo.image_small = sameCard.image_small;
          if (sameCard._grounded_id && !cardInfo._grounded_id) cardInfo._grounded_id = sameCard._grounded_id;
          if (sameCard.grounded_id  && !cardInfo.grounded_id)  cardInfo.grounded_id  = sameCard.grounded_id;
          if (sameCard.set_code     && !cardInfo.set_code)     cardInfo.set_code     = sameCard.set_code;
          if (sameCard.rarity       && !cardInfo.rarity)       cardInfo.rarity       = sameCard.rarity;
          if (sameCard.hp           && !cardInfo.hp)           cardInfo.hp           = sameCard.hp;
          if (sameCard.year         && !cardInfo.year)         cardInfo.year         = sameCard.year;
          console.log(`[scan] copied grounding from candidate onto top: ${sameCard.grounded_id || sameCard._grounded_id}`);
        }
      }

      // Multi-candidate picker path
      if (xim.needsPicker && Array.isArray(xim.candidates) && xim.candidates.length >= 2) {
        await refundCredits();
        const cleanCandidates = xim.candidates.map(c => ({
          card_name: c.card_name, card_number: c.card_number, set_name: c.set_name,
          set_code: c.set_code || '', hp: c.hp || '', card_type: c.card_type || 'pokemon',
          is_japanese: c.is_japanese === true, rarity: c.rarity || '',
          sport: c.sport || '', year: c.year || '',
          confidence_pct: c.confidence_pct || 50,
          grounded_id: c._grounded_id || null,
        }));
        return res.status(200).json({
          success: true, mode: 'identify', needsPicker: true,
          confidence: 'medium', candidates: cleanCandidates,
          image_quality: 'ok', glare_regions: [], retake_hint: '',
          card_name: cardInfo.card_name, card_number: cardInfo.card_number,
          set_name: cardInfo.set_name, set_code: cardInfo.set_code,
          grounded: true, grounded_id: cardInfo.grounded_id || cardInfo._grounded_id,
          hp: cardInfo.hp, card_type: cardInfo.card_type,
          is_japanese: cardInfo.is_japanese, jp_name: cardInfo.jp_name,
          rarity: cardInfo.rarity, sport: cardInfo.sport, year: cardInfo.year,
          image_url: cardInfo.image_url || null,
          image_small: cardInfo.image_small || null,
          source: 'ximilar',
          ygo_grounded_by: cardInfo._ygo_grounded_by || null,
        });
      }

      // Single confident answer — log + return, skip GPT entirely
      _incrSearchStats(kvUrl, kvToken);
      if (hasKV && consumedFrom) {
        try {
          const record = {
            uid: key, consumed_from: consumedFrom, consumed_amount: consumedAmount,
            card_name: cardInfo.card_name, card_number: cardInfo.card_number,
            set_name: cardInfo.set_name, confidence: idConfNorm,
            image_quality: 'ok', created_at: Date.now(), source: 'ximilar',
          };
          await setKVWithTTL(kvUrl, kvToken, `scan:${scanId}`, JSON.stringify(record), 3600);
        } catch(e) { /* non-fatal */ }
      }
      // Recompute confidence norm in case grounding restored it from 'low' → 'high'
      const finalConfNorm = cardInfo.confidence || idConfNorm;
      return res.status(200).json({
        success: true, mode: 'identify', scan_id: scanId,
        confidence: finalConfNorm, image_quality: 'ok',
        glare_regions: [], retake_hint: '',
        card_name: cardInfo.card_name, card_number: cardInfo.card_number,
        set_name: cardInfo.set_name, set_code: cardInfo.set_code,
        grounded: true, grounded_id: cardInfo.grounded_id || cardInfo._grounded_id,
        hp: cardInfo.hp, card_type: cardInfo.card_type,
        is_japanese: cardInfo.is_japanese, jp_name: cardInfo.jp_name,
        rarity: cardInfo.rarity, sport: cardInfo.sport, year: cardInfo.year,
        image_url: cardInfo.image_url || null,
        image_small: cardInfo.image_small || null,
        source: 'ximilar',
        ygo_grounded_by: cardInfo._ygo_grounded_by || null,
      });
    }
  }

  // Grade-mode Ximilar ident is called AFTER GPT succeeds (see below),
  // so we don't burn Ximilar credits if GPT vision fails/refunds.
  let gradeXimResult = null;

  // ── 4. Call GPT vision for grade mode only ──
  // Identify mode always returns from the Ximilar block above.
  try {
    const mime   = mimeType || 'image/jpeg';
    const dataUrl = `data:${mime};base64,${imageBase64}`;
    const backDataUrl = backBase64 ? `data:${backMimeType || 'image/jpeg'};base64,${backBase64}` : null;

    // Deep Grade edge images (only include ones actually provided — could be 2, 3, or 4)
    const edgeImages = isDeepGrade ? [
      topEdgeBase64    && { label: 'TOP edge',    dataUrl: `data:${topEdgeMimeType    || 'image/jpeg'};base64,${topEdgeBase64}`    },
      bottomEdgeBase64 && { label: 'BOTTOM edge', dataUrl: `data:${bottomEdgeMimeType || 'image/jpeg'};base64,${bottomEdgeBase64}` },
      leftEdgeBase64   && { label: 'LEFT edge',   dataUrl: `data:${leftEdgeMimeType   || 'image/jpeg'};base64,${leftEdgeBase64}`   },
      rightEdgeBase64  && { label: 'RIGHT edge',  dataUrl: `data:${rightEdgeMimeType  || 'image/jpeg'};base64,${rightEdgeBase64}`  },
    ].filter(Boolean) : [];

    // Build ordered image list with human-readable labels for the prompt
    const orderedImages = [
      { label: 'FRONT of card',        dataUrl: dataUrl },
      { label: 'BACK of card',         dataUrl: backDataUrl },
      ...edgeImages, // already labeled TOP/BOTTOM/LEFT/RIGHT if present
    ].filter(x => x.dataUrl);

    const imageDescription = orderedImages.length > 1
      ? `${orderedImages.length} images in order: ${orderedImages.map((img, i) => `(${i+1}) ${img.label}`).join(', ')}.`
      : 'ONE image: the FRONT of a card only';

    const deepGradeInstructions = isDeepGrade ? `

DEEP GRADE MODE — You have ${orderedImages.length} photos including ${edgeImages.length} dedicated edge close-up${edgeImages.length === 1 ? '' : 's'}. This is a professional-tier inspection. Be MORE precise on the per-pillar sub-grades because you can actually see corner and edge detail. Use the edge close-ups to catch flaws that would be invisible in a whole-card shot.${edgeImages.length < 4 ? ` (Note: fewer than 4 edge shots — use "medium" confidence unless the shots you have are very clear.)` : ''}` : '';

    const prompt = isGradeMode
      ? `You are a strict, professional trading card grader trained to PSA's OFFICIAL published standards. You are analyzing ${imageDescription}.${deepGradeInstructions}

═══ WHY THIS MATTERS ═══
The user is a reseller or collector deciding whether to spend $25–$100 in
grading fees + shipping + weeks of turnaround on this specific card,
based on YOUR estimate. If you overgrade, they lose real money — grading
fees on a card that comes back a 7 instead of a 9 is a $50–$400 hit per
card. If you undergrade, they miss a real PSA 10 payday. Either error
costs them money. They do not want to be flattered. They want the truth.

Brutal honesty > polite hedging. If you cannot see the corners because
of holder glare, say so and CAP the grade — do NOT hand out a Gem Mint
verdict on a card whose corners you cannot inspect. If the photos are
blurry, sleeved, glared, or otherwise compromised, your confidence MUST
be "low" and your psa_estimate MUST reflect the WORST-case reasonable
interpretation of what you can see, not the best-case.

BEFORE grading, understand these realities:
- PSA 10 (Gem Mint) is rare (~5–10% of modern submissions) but NOT impossible. Do not artificially demote a card that meets the published thresholds AND you can fully inspect.
- Be STRICT but ACCURATE. Under-grading a card that meets PSA 10 criteria under clear photos is just as wrong as over-grading a damaged one.
- Use the OFFICIAL PSA centering thresholds below. Do NOT invent stricter thresholds. 55/45 front is the PSA 10 threshold — not a defect.
- Modern cards are graded MORE strictly than vintage (pre-1980). Vintage tolerates print defects, factory miscuts, and wax staining that would sink a modern card.
- If the image quality is poor or you cannot clearly see the card, lower confidence AND lower the grade — do not just add a note.

═══ THROUGH-PLASTIC PENALTY (mandatory) ═══
If the card is in a sleeve, toploader, top-loader, one-touch, magnetic
holder, screwdown, semi-rigid, penny sleeve, or graded slab (CGC/PSA/
BGS/SGC/TAG) — in other words, if you can see plastic between the
camera and the card:
  • confidence MUST be "low" (never "medium", never "high")
  • "holder_glare" OR "reflective_sleeve" MUST appear in confidence_drivers
  • psa_estimate is CAPPED at 8 unless the card is in a fresh raw pack pull
    quality state clearly visible through the plastic AND you can rule out
    corner whitening / edge chipping / surface scratches
  • If it's a SLAB (rigid case with printed label): psa_estimate reflects
    what YOU can see raw — do NOT trust the printed grade on the label;
    it's not what the user is asking about
  • limiting_factor MUST start with "Card is scanned through [sleeve/
    holder/slab] — " and explain what you cannot verify
  • grade_label CANNOT be "Gem Mint" through plastic — use "Near Mint" or
    lower and let the user re-scan raw for a real estimate
  • worth_grading MUST be false when scanned through plastic (the user
    should raw-scan first before spending grading fees)

═══ HONESTY RULES (mandatory) ═══
• If confidence is "low", psa_distribution MUST spread across at least 3
  grades with no bucket > 55%. High-confidence-looking distributions
  (80/15/5) on low-confidence scans are dishonest.
• If confidence_drivers contains any VISUAL IMPAIRMENT (holder_glare,
  blurry_photo, reflective_sleeve, low_resolution, finger_covering_card),
  you MAY NOT return psa_estimate=10 — you cannot verify Gem Mint through
  a defect that blocks inspection. Drivers that just reflect product
  scope (single_photo_only, back_not_visible, limited_edge_visibility)
  are NOT impairments — a textbook-clean pack-fresh front photo CAN and
  SHOULD be graded PSA 10 even with only one photo, as long as no visual
  impairment is present. Do NOT self-cap at 9 for "only one photo".
• If confidence_drivers contains a VISUAL IMPAIRMENT (as listed above),
  eye_appeal cannot be "Strong" — eye appeal requires being able to see
  the card cleanly. Product-scope drivers alone do not block "Strong".
• If you notice ANY visible defect (whitening, chipping, scratches,
  print lines, off-centering worse than 55/45), it MUST be named
  specifically in the relevant *_desc field AND counted in flaw_count.
  Do not soften language ("very slight" is fine; "basically none" is not).
• worth_grading = true ONLY when you would personally bet $30 that this
  card comes back a PSA 9 or 10 from a real grader. If you have ANY
  meaningful doubt, worth_grading = false.
• Never write "Card meets all PSA 10 criteria" unless you also emit
  psa_estimate=10. Those two must always agree.

═══ PSA 10 CALIBRATION (do not swing to the other extreme) ═══
Being brutally honest ≠ defaulting to 8. PSA 10 is rare but real —
approximately 5–10% of modern submissions grade a 10, higher on
popular pack-fresh chase cards. A raw card that passes ALL of the
following SHOULD be a PSA 10 candidate:
  • 55/45 or better on BOTH axes
  • four perfectly sharp corners under close inspection
  • smooth edges with no chipping / whitening / roughness
  • no visible surface scratches, print lines, or gloss breaks
  • no VISUAL IMPAIRMENT drivers (glare / blur / sleeve / low-res)
    — product-scope drivers like single_photo_only are FINE
When those conditions are met, the correct output is psa_estimate=10
with a probability distribution like {10: 55–75, 9: 20–35, 8: 5–10}.
Refusing to name a real PSA 10 candidate because "PSA 10 is rare" is
JUST AS DISHONEST as overgrading a slabbed card — you cost the user
a real payday.

USE THE FULL RANGE of psa_distribution to express certainty:
  • Textbook clean pack-fresh raw with clear photos: {10: 65, 9: 30, 8: 5}
  • Looks 10 but one axis is 56/44: {10: 40, 9: 50, 8: 10}
  • One faint corner flaw under magnification: {9: 65, 10: 15, 8: 20}
  • Multiple minor flaws: {8: 55, 9: 25, 7: 20}
  • Through plastic: {8: 40, 7: 35, 9: 15, 6: 10} — spread is honest
The percentages ARE the answer — they let the user weigh a $25 grading
fee against a 65% shot at PSA 10. Don't round to (100, 0, 0) OR to
(33, 33, 34). Pick numbers that reflect what the photos actually show.

═══ OFFICIAL PSA CENTERING THRESHOLDS (memorize these) ═══
FRONT centering (worst axis rules — check BOTH L/R and T/B):
  • PSA 10: 55/45 or better on BOTH axes
  • PSA 9:  60/40 or better on BOTH axes
  • PSA 8:  65/35 or better on BOTH axes
  • PSA 7:  70/30 or better
  • PSA 6:  75/25 or better
BACK centering is SIGNIFICANTLY more lenient:
  • PSA 10 back: 75/25 or better
  • PSA 9 back:  90/10 or better
  • PSA 8 back:  90/10 or better
Critical: 55/45 front IS the PSA 10 threshold. Never call 55/45 "moderate off-center" or use it to cap the grade below 10.

═══ OFFICIAL PSA CORNER STANDARDS ═══
  • PSA 10: "Four perfectly sharp corners" (no whitening, no softening, no fraying under magnification)
  • PSA 9:  ONE minor flaw total across corners/edges/surface/centering (most commonly very slight corner wear on 1 corner)
  • PSA 8:  "Slightest fraying at one or two corners" OR moderate defects in one other pillar
  • PSA 7:  Fuzzy corners, one or more corners with visible wear to the naked eye
  • PSA 6:  Obvious wear at multiple corners

═══ OFFICIAL PSA EDGE STANDARDS ═══
  • PSA 10: Smooth edges, no chipping, no roughness even under loupe
  • PSA 9:  Very slight edge wear on one edge at most
  • PSA 8:  Minor rough edges or one small chip
  • PSA 7:  Visible chipping or roughness on multiple edges

═══ OFFICIAL PSA SURFACE STANDARDS ═══
  • PSA 10: No scratches, no print lines that impair eye appeal, no gloss breaks, no stains. A "slight printing imperfection" is allowed on a 10 ONLY if it does not impair overall appeal.
  • PSA 9:  One tiny print line or a barely-visible scratch
  • PSA 8:  Light surface scratches or a visible print line
  • PSA 7:  Multiple scratches or a noticeable print defect

═══ ONE-FLAW RULE FOR PSA 9 ═══
PSA 9 allows exactly ONE minor flaw across all four pillars. Two or more minor flaws = PSA 8, not PSA 9.
Example: very slight whitening on 1 corner AND 60/40 centering = PSA 8 (two flaws), not PSA 9.

═══ HOW TO GRADE (in this order) ═══
1. Measure centering on BOTH axes front. Determine the CENTERING CEILING using thresholds above (worst axis rules). If a back photo is present, ALSO measure back centering and populate centering_back — do not leave it empty.
2. Inspect all 4 corners. Note any whitening "visible to naked eye" vs "only under magnification."
3. Inspect all 4 edges (use dedicated edge close-ups if provided).
4. Inspect front surface for scratches, print lines, gloss breaks, stains.
5. Apply the one-flaw rule: count minor flaws across all 4 pillars. Overall grade is the LOWER of (centering ceiling) and (grade allowed by flaw count).
6. Eye appeal judgment: for borderline cards (e.g. 9 vs 10), consider overall eye appeal. Note if defects are in focal areas (center of card, subject's face).

═══ WRITING QUALITY RULES ═══
• limiting_factor MUST name a specific pillar (centering / corners / edges / surface / eye appeal) AND a specific defect. Vague statements like "minor issues" or "multiple factors" are forbidden.
• limiting_factor MUST reconcile with psa_estimate: if psa_estimate is at the centering ceiling, say "Card meets all PSA {N} criteria and no defects prevent a higher grade."; otherwise name the exact defect blocking the next grade up.
• If a photo IS provided for a side (front, back, or an edge), do NOT write "cannot be assessed from provided photos." Grade what you can see. Only use that language for pillars where NO photo shows that side.
• Do NOT hedge in corners_desc / edges_desc / surface_desc when clear photos are available — commit to a description.
• psa_distribution's TOP bucket MUST equal psa_estimate. If you're 90% sure it's a PSA 9, the top bucket is grade=9 with pct=90.
• flaw_count must match the actual defects described. Zero flaws → PSA 10 candidate. One flaw → PSA 9 candidate. Two flaws → PSA 8 candidate.
• Never mention "AI", "model", "vision system", or "algorithm" in any field. Write like a professional human grader.

Evaluate and return:
1. card_name: The card name
2. centering_lr: Left/right ratio as "NN/NN" ONLY, e.g. "55/45". No units, no extra text.
3. centering_tb: Top/bottom ratio as "NN/NN" ONLY, e.g. "52/48". No units, no extra text.
4. centering_back: OPTIONAL. If the back is visible, worst-axis back ratio "NN/NN". Otherwise empty string.
5. centering_ceiling: Integer 1-10. The MAX PSA grade allowed by front centering alone using the official thresholds above.
6. corners_desc: Plain-language PSA-native description. Use phrases like: "four perfectly sharp corners", "very slight whitening on 1 corner (visible only under magnification)", "slight fraying at 2 corners visible to naked eye", "obvious wear at 3+ corners". Never use fake sub-scores.
7. edges_desc: PSA-native description of all 4 edges. Note if edges cannot be fully assessed from provided photos.
8. surface_desc: PSA-native description of the front surface. Explicitly call out print lines, scratches, gloss breaks, holder glare.
9. flaw_count: Integer 0-4. Count of PILLARS with any visible flaw (centering worse than 55/45 counts as 1, any visible corner wear counts as 1, etc.).
10. psa_estimate: Integer 1-10. Single most-likely PSA grade. This is the LOWER of centering_ceiling and (grade allowed by flaw_count using the one-flaw rule).
11. psa_distribution: Object with probability weights for the top 3 grades, summing to ~100. Example: {"10": 15, "9": 60, "8": 25}. Base this on how borderline the defects are and photo confidence. If highly confident in a single grade, weight it heavily (e.g. 90/8/2).
12. limiting_factor: 1-sentence explanation of why this grade and not the next one up. Example: "Centering qualifies for PSA 10; very slight whitening on 1 top corner is the primary reason this projects as a 9 rather than a 10."
13. grade_label: ("Gem Mint", "Mint", "Near Mint-Mint", "Near Mint", "Excellent-Mint", "Excellent", "Very Good", "Good", "Poor")
14. eye_appeal: "Strong" | "Average" | "Weak" — overall visual impression. Note in eye_appeal_notes if defects are in focal areas (center of card art, subject's face) which hurt eye appeal more than defects in blank border areas.
15. eye_appeal_notes: 1 sentence on eye appeal.
16. worth_grading: true only if psa_estimate >= 9 AND the card has meaningful value raw. Grading fees + shipping typically require a PSA 9 outcome to break even on modern cards.
17. confidence: "high" | "medium" | "low" — how confident you are given photo quality, angles, holder glare, and edge visibility.
18. confidence_drivers: Array of strings explaining what limits your confidence. Options: "holder_glare", "limited_edge_visibility", "blurry_photo", "single_photo_only", "back_not_visible", "low_resolution", "reflective_sleeve", "finger_covering_card", "none". Return ["none"] if photos are all clear and you have HIGH confidence — do NOT invent drivers just to seem cautious.
19. is_slabbed: true if the card is inside a graded slab (CGC, PSA, BGS, SGC, TAG). Signals: rigid clear plastic outer shell with printed label header, visible grade text like "GEM MINT 10", serial/cert number, or barcode. If slabbed, add "holder_glare" to confidence_drivers and note the estimate will be skewed. Recommend a raw re-scan in limiting_factor.
20. slab_grader: If is_slabbed=true, the company ("PSA", "CGC", "BGS", "SGC", "TAG", or "Other"). Empty string otherwise.
21. slab_grade: If is_slabbed=true, the printed grade (e.g. "10", "9.5", "8"). Empty string otherwise.
22. is_vintage: true if the card is pre-1980 (older Topps sports, WOTC-era Pokémon Base Set through Neo). Apply lenient vintage standards if true.

DO NOT emit numeric sub-grades like 8.5/10. PSA does not publish numeric sub-grades. Report PSA-native language only.

Respond ONLY with valid JSON:
{"card_name":"...","centering_lr":"55/45","centering_tb":"52/48","centering_back":"","centering_ceiling":10,"corners_desc":"...","edges_desc":"...","surface_desc":"...","flaw_count":1,"psa_estimate":9,"psa_distribution":{"10":15,"9":60,"8":25},"limiting_factor":"...","grade_label":"Mint","eye_appeal":"Strong","eye_appeal_notes":"...","worth_grading":true,"confidence":"medium","confidence_drivers":["limited_edge_visibility"],"is_slabbed":false,"slab_grader":"","slab_grade":"","is_vintage":false}`
      : `You are a trading card expert. Look at this card image and identify it.

BE HONEST about uncertainty. If the card art, number, or set name isn't perfectly clear (blurry photo, glare, similar-looking cards from different sets, unclear card number), you MUST return your top 2–3 candidate matches with a confidence score for each, INSTEAD of guessing one wrong answer. Only return a single answer when you are highly confident it's correct.

═══ ANTI-HALLUCINATION RULES ═══ (violations = wrong answer, worse than empty)
• NEVER invent a card name. If you cannot read the printed name clearly, return card_name="" and image_quality="glare_blocked"/"blurry"/"cropped". A blank field is FAR better than a plausible-sounding wrong guess.
• NEVER invent a set code. Set codes have strict formats:
    – Pokémon: 2–4 uppercase letters/digits like SVI, MEW, PGO, 151, OBF, SV1, SV3PT5.
    – Yu-Gi-Oh: 3–4 letters + hyphen + region + 3 digits like PHRA-EN012, CORE-EN080, LOB-EN001, MP24-EN123.
    – MTG: 3-letter code like MH3, LCI, WOE, MOM.
    – One Piece: OP01–OP12, ST01–ST25, EB01, PRB01.
    – Lorcana: 3-letter code like TFC, ROF, INK, URR.
  If you cannot read a set code matching one of these formats, return set_code="". Do NOT invent 9-digit numeric IDs, do NOT make up codes like "COG-EN082" that don't exist.
• For Yu-Gi-Oh cards specifically: card names are printed in a clean font at the top. If you cannot read the name letter-for-letter, return card_name="" — do NOT combine words to invent names like "Skyfire of the Sacred Beast", "Blitzclique - Breakaway", "Distrust Paranoia", or "Elfnotes: Quatrain of Succession". Made-up names are the #1 failure mode; refusing to guess is the correct behavior.
• If you're returning candidates[], EACH candidate name must also be a real card you're actually confident exists. Do not fill the array with made-up alternatives.
• confidence="high" requires: readable name + readable card number + a set code matching the formats above. If any of those three is unreadable, confidence must be "medium" or "low".
• When confidence is "low" AND you cannot read the name, prefer empty card_name over any guess.

GLARE + SLEEVE HANDLING: Reflective toploaders and holographic sleeves often create glare that blocks key details (card number, set symbol, or HP). If glare is blocking a critical detail:
  - Set confidence to "low" and set image_quality to "glare_blocked"
  - Populate glare_regions with which detail is blocked: "card_number", "set_symbol", "card_name", or "art"
  - Still return your best-guess candidates from what IS visible, but DO NOT pretend to read details you can't see
  - Suggest a retake angle in retake_hint (e.g. "Tilt the card 15° away from the light source and remove any reflective sleeve.")

Other low-quality photo signals: blur, cropped edges, dark shadow, upside-down. Set image_quality to "blurry", "cropped", "dark", or "rotated" accordingly.

Extract for the best match:
1. card_name: The Pokémon or character or player name IN ENGLISH (e.g. "Mewtwo VSTAR", "Charizard ex", "Ampharos", "LeBron James"). Populate ONLY when you can clearly read the printed name letter-for-letter. If the name area is blurry, glared, cropped, cut off, or otherwise unreadable, return "" — do NOT guess plausible-sounding combinations of words. If the card is Japanese and only shows katakana/hiragana (e.g. "ラフレシア") AND you can clearly read the katakana, TRANSLATE to the English name ("Vileplume") and put that in card_name. Never return raw Japanese text in card_name.
2. card_number: The card number (e.g. "079/078", "025/165", or for sports the printed # like "175" or "RA-LJ")
3. set_name: The exact printed set name (e.g. "Pokémon GO", "Crown Zenith", "Topps Chrome", "Panini Prizm"). CRITICAL: You MUST return either a real set name OR an empty string "". NEVER return editorial commentary like "Not an official set", "counterfeit", "custom card", "unknown", or "fake" — our database will look up the set from the card number if you don't know it. If you can't read the set symbol clearly, return "".
3b. set_code: The SET CODE printed on the card. Format depends on TCG:
    – Pokémon: 2–4 uppercase chars in BOTTOM-LEFT/RIGHT near the card number (e.g. "SVI", "MEW", "PGO", "151", "SV1", "OBF").
    – Yu-Gi-Oh: Left/right of the artwork or bottom-left, format "XXX(X)-EN###" or region equivalent ("PHRA-EN012", "CORE-EN080").
    – MTG: 3-letter code in bottom-left near the set symbol.
    – One Piece: "OP##", "ST##" format near collector number.
    – Lorcana: 3-letter code near collector number.
  MUST match one of these formats. If unreadable OR you cannot match a real format, return "". NEVER invent 9-digit numeric IDs or make up codes.
4. hp: HP number if Pokémon card (e.g. "280")
5. card_type: One of "pokemon", "mtg", "yugioh", "lorcana", "onepiece", or "sports". Look at the frame/back/logo to decide — Magic cards have a mana cost circle in the top right; Yu-Gi-Oh cards have a diamond attribute icon and level stars; Lorcana cards have an ink cost in the top left and Disney characters; One Piece cards have a colored border with cost in a circle; Pokémon cards show HP and energy symbols. Sports cards show a photo of a real athlete, a team logo/jersey, brand marks like Topps/Panini/Bowman/Upper Deck/Fleer/Donruss/Score/Select/Prizm/Optic/Mosaic/Chronicles, and often a copyright year.

HARD RULES for card_type — apply these BEFORE any other reasoning:
  – If the card shows the words "TRAP CARD", "SPELL CARD", or "MONSTER" (usually top of the artwork or below the name), OR a diamond-shaped attribute icon in the top-right (DARK, LIGHT, EARTH, WATER, FIRE, WIND, DIVINE), OR the exact text "[Yu-Gi-Oh!]" or "Konami" in the copyright line → card_type MUST be "yugioh". Do not classify as pokemon just because the art contains a monster.
  – If the card shows HP in the top-right (e.g. "280 HP") AND energy-type symbols → "pokemon".
  – If none of those signals are visible clearly, but the card looks like an unofficial custom card or proxy → return your best guess for card_type, set confidence="low", card_name="", set_name="", set_code="", card_number="". Do NOT invent a Pokémon name for a card that has no Pokémon signals.
6. is_japanese: true if the card text is primarily Japanese (hiragana/katakana/kanji) OR the card number uses JP set codes like "SV5K", "s10a", "sv4a". Otherwise false. STRONG SIGNALS for is_japanese=true: any katakana on the name line (ラフレシア, リザードン), the word ポケモン or たね anywhere on the card, or JP-specific rarity markers (RR, SR, SAR, UR). If is_japanese=true, set_name should be the English name of the JP set (e.g. "Jungle" not 「ジャングル」, "151" not 「ポケモンカード151」).
7. rarity: e.g. "Rainbow Rare", "Secret Rare", "Holo Rare", or for sports: "Refractor", "Rookie", "Auto", "Numbered /99", "Base", etc.
8. sport: ONLY for sports cards — one of "Baseball", "Basketball", "Football", "Hockey", "Soccer", "Other". Determine by team logo, jersey style, or ball visible.
9. year: ONLY for sports cards — the copyright / season year printed on the card (e.g. "2023", "2011", "1997").
10. confidence: "high" | "medium" | "low" — be strict. "high" means you can clearly read the card number AND the set symbol AND the art matches. Any doubt → "medium" or "low". If image_quality is anything other than "ok", confidence must be "low".
11. candidates: OPTIONAL array of top 2–3 matches when confidence is medium or low. Each element: {card_name, card_number, set_name, hp, card_type, is_japanese, rarity, sport, year, confidence_pct}. Rank most likely first. If confidence is "high", omit or return an empty array.
12. image_quality: "ok" | "glare_blocked" | "blurry" | "cropped" | "dark" | "rotated" — a single tag describing the photo. Use "ok" only when you can clearly see all key details.
13. glare_regions: OPTIONAL array of strings when image_quality="glare_blocked". Elements: "card_number", "set_symbol", "card_name", "art", "hp".
14. retake_hint: OPTIONAL 1-sentence advice for the user on how to retake the photo. Only include when image_quality != "ok".
15. jp_name: OPTIONAL. If is_japanese=true, the raw Japanese card name as printed on the card (e.g. "ラフレシア", "リザードン"). Omit for English cards.

Respond ONLY with valid JSON, no explanation:
{"card_name":"...","card_number":"...","set_name":"...","set_code":"...","hp":"...","card_type":"...","is_japanese":false,"jp_name":"","rarity":"...","sport":"...","year":"...","confidence":"high|medium|low","image_quality":"ok","glare_regions":[],"retake_hint":"","candidates":[{"card_name":"...","card_number":"...","set_name":"...","set_code":"...","hp":"...","card_type":"...","is_japanese":false,"rarity":"...","sport":"...","year":"...","confidence_pct":75}]}`;

    // Build the vision content once so we can retry with a different model if needed.
    const visionContent = [
      { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
      ...(isGradeMode && backDataUrl ? [{ type: 'image_url', image_url: { url: backDataUrl, detail: 'high' } }] : []),
      ...edgeImages.map(e => ({ type: 'image_url', image_url: { url: e.dataUrl, detail: 'high' } })),
      { type: 'text', text: prompt }
    ];

    // 2026-08-16: try gpt-5 first (native multimodal, 84.2% MMMU vs
    // gpt-4o's 72.2% — huge win on card ID / OCR-through-glare). If
    // it errors (org tier not enabled, unknown-param rejection, etc.)
    // fall back to gpt-4o so identify never hard-fails on a model change.
    async function callModel(modelId) {
      const isGpt5 = modelId.startsWith('gpt-5');
      const body = {
        model: modelId,
        messages: [{ role: 'user', content: visionContent }],
      };
      if (isGpt5) {
        // Identify mode uses 'medium' reasoning — the tighter anti-hallucination
        // rules need real reasoning budget to decide "can I actually read this?"
        // vs. "is this a plausible guess?". Grade mode stays at 'low' because the
        // grading prompt is more mechanical (measure ratios, apply thresholds).
        body.reasoning_effort = isGradeMode ? 'low' : 'medium';
        // GPT-5 reasoning tokens count toward max_completion_tokens.
        // Medium reasoning can eat 2000-4000 tokens before visible output.
        // Give a generous budget so real output isn't truncated / empty.
        body.max_completion_tokens = isDeepGrade ? 5000 : (isGradeMode ? 4000 : 5000);
      } else {
        body.max_tokens = isDeepGrade ? 700 : (isGradeMode ? 500 : 300);
      }
      return fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    }

    // Try gpt-5 first, then gpt-4o. Fall through on 3 conditions:
    //   (1) HTTP error on the response
    //   (2) empty message content (gpt-5 can burn all tokens on reasoning)
    //   (3) JSON parse failure (model returned prose instead of JSON)
    async function tryModel(modelId) {
      const r = await callModel(modelId);
      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        return { ok: false, reason: 'http', status: r.status, errText: errText.slice(0, 300) };
      }
      const j = await r.json();
      const content = j.choices?.[0]?.message?.content || '';
      const finishReason = j.choices?.[0]?.finish_reason || '';
      if (!content.trim()) {
        return { ok: false, reason: 'empty', finish_reason: finishReason, usage: j.usage };
      }
      try {
        const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        // Handle cases where model wrapped JSON in extra text: find first {...} block.
        const jsonStart = cleaned.indexOf('{');
        const jsonEnd = cleaned.lastIndexOf('}');
        const jsonStr = (jsonStart >= 0 && jsonEnd > jsonStart) ? cleaned.slice(jsonStart, jsonEnd + 1) : cleaned;
        return { ok: true, cardInfo: JSON.parse(jsonStr), raw: content };
      } catch(e) {
        return { ok: false, reason: 'parse', raw: content.slice(0, 500) };
      }
    }

    let modelUsed = 'gpt-5';
    let attempt = await tryModel('gpt-5');
    if (!attempt.ok) {
      console.warn('gpt-5 attempt failed, falling back to gpt-4o:', attempt.reason,
                   attempt.reason === 'http' ? `${attempt.status} ${attempt.errText}` :
                   attempt.reason === 'empty' ? `finish=${attempt.finish_reason} usage=${JSON.stringify(attempt.usage)}` :
                   attempt.raw);
      modelUsed = 'gpt-4o';
      attempt = await tryModel('gpt-4o');
    }

    if (!attempt.ok) {
      console.error('Both models failed:', attempt);
      await refundCredits();
      if (attempt.reason === 'parse') {
        return res.status(502).json({ error: 'Could not identify this card. Try a clearer photo. Credits refunded.' });
      }
      return res.status(502).json({ error: 'Scanner temporarily unavailable. Credits refunded.' });
    }

    const cardInfo = attempt.cardInfo;

    // If the model returned empty card_name but populated candidates,
    // promote the top candidate — some models zero out the top-level
    // fields when they want to defer to the candidates array.
    if (!cardInfo.card_name && Array.isArray(cardInfo.candidates) && cardInfo.candidates[0]?.card_name) {
      const c0 = cardInfo.candidates[0];
      cardInfo.card_name   = c0.card_name   || cardInfo.card_name;
      cardInfo.card_number = c0.card_number || cardInfo.card_number;
      cardInfo.set_name    = c0.set_name    || cardInfo.set_name;
      cardInfo.set_code    = c0.set_code    || cardInfo.set_code;
      cardInfo.hp          = c0.hp          || cardInfo.hp;
      cardInfo.card_type   = c0.card_type   || cardInfo.card_type;
      cardInfo.is_japanese = c0.is_japanese === true || cardInfo.is_japanese === true;
      cardInfo.rarity      = c0.rarity      || cardInfo.rarity;
      cardInfo.sport       = c0.sport       || cardInfo.sport;
      cardInfo.year        = c0.year        || cardInfo.year;
    }

    // 2026-08-20: In grade mode, NOW call Ximilar to identify the card.
    // We do this AFTER GPT succeeded so we don't burn Ximilar credits
    // (~10 credits/call) on scans that fail GPT and get refunded.
    // Ximilar's collectibles model is far more accurate than GPT vision at
    // reading card names — GPT hallucinates "Special Red Card" for slabbed
    // cards it can't read; Ximilar returns the actual card.
    if (isGradeMode && ximilarToken && imageBase64) {
      const t0 = Date.now();
      let xim = await identifyWithXimilar(imageBase64, mimeType || 'image/jpeg', ximilarToken, 'tcg');
      if (!xim.ok && (xim.reason === 'no_match' || xim.reason === 'no_card_detected')) {
        const ximSport = await identifyWithXimilar(imageBase64, mimeType || 'image/jpeg', ximilarToken, 'sport');
        if (ximSport.ok) xim = ximSport;
      }
      console.log('[scan] ximilar (grade-mode ident) took', Date.now() - t0, 'ms ok=', xim.ok, 'reason=', xim.reason);
      if (xim.ok && xim.cardInfo) gradeXimResult = xim.cardInfo;
    }

    // If Ximilar identified the card, its answer WINS on identity fields.
    // GPT keeps all grade fields (psa_estimate, centering, corners, etc.).
    if (isGradeMode && gradeXimResult && gradeXimResult.card_name) {
      console.log('[scan] grade-mode: overriding GPT ident with Ximilar:',
        'gpt=', cardInfo.card_name, '→ xim=', gradeXimResult.card_name,
        'type:', cardInfo.card_type, '→', gradeXimResult.card_type);
      cardInfo.card_name   = gradeXimResult.card_name   || cardInfo.card_name;
      cardInfo.card_number = gradeXimResult.card_number || cardInfo.card_number;
      cardInfo.set_name    = gradeXimResult.set_name    || cardInfo.set_name;
      cardInfo.set_code    = gradeXimResult.set_code    || cardInfo.set_code;
      cardInfo.card_type   = gradeXimResult.card_type   || cardInfo.card_type;
      cardInfo.is_japanese = gradeXimResult.is_japanese === true || cardInfo.is_japanese === true;
      cardInfo.rarity      = gradeXimResult.rarity      || cardInfo.rarity;
      cardInfo.sport       = gradeXimResult.sport       || cardInfo.sport;
      cardInfo.year        = gradeXimResult.year        || cardInfo.year;
      cardInfo.image_url   = gradeXimResult.image_url   || gradeXimResult.image_small || cardInfo.image_url;
      cardInfo.image_small = gradeXimResult.image_small || cardInfo.image_small;
      cardInfo.grounded_id = gradeXimResult.grounded_id || gradeXimResult._grounded_id || cardInfo.grounded_id;
    }

    if (!cardInfo.card_name) {
      await refundCredits();
      return res.status(422).json({ error: 'Could not identify the card. Try a clearer photo with better lighting. Credits refunded.' });
    }

    // Sanitize set_name if the model returned editorial commentary
    // instead of a real set ("Not an official set", "counterfeit", etc).
    // Clear it and let the grounding pass below fill in the real set.
    if (cardInfo.set_name) {
      const s = String(cardInfo.set_name).toLowerCase();
      const badPatterns = [
        'not an official', 'not official', 'counterfeit', 'custom card',
        'custom / fake', 'not a real', 'unknown set', 'no set', 'fake',
        'unofficial', 'proxy', 'reprint (unofficial)'
      ];
      if (badPatterns.some(p => s.includes(p))) {
        console.warn(`Model returned editorial set_name, clearing: "${cardInfo.set_name}"`);
        cardInfo.set_name = '';
      }
    }

    // ── SET-CODE FORMAT VALIDATION ──
    // Vision models sometimes invent set codes when they can't read the real
    // one (e.g. 9-digit numeric IDs like "101305049", or made-up codes like
    // "COG-EN082" for Yu-Gi-Oh where COG isn't a real set). Validate against
    // known formats per TCG and clear invalid ones. Better to have no set_code
    // than a wrong one (which would poison the grounding lookup).
    const validateSetCode = (code, cardType) => {
      if (!code || typeof code !== 'string') return '';
      const c = code.trim().toUpperCase();
      if (!c) return '';
      // Reject pure numeric IDs longer than 3 chars — e.g. "101305049" invented.
      // Note: Pokémon "151" and "165" ARE real set codes so we allow 3-char digits.
      if (/^\d+$/.test(c) && c.length > 3) return '';
      // Reject anything too long to be a real set code.
      if (c.length > 12) return '';
      const t = (cardType || 'pokemon').toLowerCase();
      if (t === 'yugioh') {
        // Real YGO codes: 3-5 letters + hyphen + region (EN/DE/FR/IT/PT/SP/JP/KR/TC/AE) + 3 digits
        // OR promo codes like MP24-EN123, RA02-EN050, YGLD-ENA01.
        return /^[A-Z0-9]{2,6}-(EN|DE|FR|IT|PT|SP|JP|KR|TC|AE)[A-Z0-9]{2,4}$/.test(c) ? c : '';
      }
      if (t === 'pokemon') {
        // 2–5 uppercase alphanumeric, no hyphens. SVI, MEW, PGO, 151, SV3PT5.
        return /^[A-Z0-9]{2,6}$/.test(c) ? c : '';
      }
      if (t === 'mtg') {
        return /^[A-Z0-9]{3}$/.test(c) ? c : '';
      }
      if (t === 'onepiece') {
        return /^(OP|ST|EB|PRB)\d{2}$/.test(c) ? c : '';
      }
      if (t === 'lorcana') {
        return /^[A-Z]{3}$/.test(c) ? c : '';
      }
      // Sports and other — loose validation, just no pure numerics.
      return /^[A-Z0-9-]{2,10}$/.test(c) ? c : '';
    };
    const beforeCode = cardInfo.set_code;
    cardInfo.set_code = validateSetCode(cardInfo.set_code, cardInfo.card_type);
    if (beforeCode && !cardInfo.set_code) {
      console.warn(`[scan] rejected invalid set_code "${beforeCode}" for ${cardInfo.card_type}`);
    }
    if (Array.isArray(cardInfo.candidates)) {
      cardInfo.candidates.forEach(c => {
        if (c) c.set_code = validateSetCode(c.set_code, c.card_type || cardInfo.card_type);
      });
    }

    // 2026-08-18: Validate card_number too — the "#101305049" hallucination
    // from the YGO Baybarron report was the model inventing a 9-digit ID and
    // stuffing it in card_number (not set_code, which is what validateSetCode
    // caught). Real card_numbers per TCG:
    //   pokemon: 1-4 digits, sometimes with "/total" or "TG01", "SV31"
    //   yugioh:  <SET>-<REG><NUM> like PHRA-EN012, OR plain 8-digit passcode
    //            (real YGO card passcodes are exactly 8 digits like 12571621)
    //   mtg:     1-4 digits
    //   lorcana: N/total or plain number
    //   onepiece: <SET>-###
    const validateCardNumber = (num, cardType) => {
      if (!num || typeof num !== 'string') return '';
      const n = num.trim().toUpperCase();
      if (!n) return '';
      // Universal: reject 5-12 digit numbers that aren't YGO passcodes (real
      // YGO passcodes are exactly 8 digits; anything else all-numeric with 5-12
      // chars is likely hallucinated).
      if (/^\d+$/.test(n)) {
        const t = (cardType || '').toLowerCase();
        if (t === 'yugioh') {
          // Accept 8-digit YGO passcodes only. Anything else (5, 6, 7, 9+ digits) is fake.
          if (n.length === 8) return num;
          if (n.length <= 4) return num; // short position numbers OK
          return '';
        }
        // Non-YGO: purely numeric > 4 digits is suspicious. Real card_numbers
        // are 1-4 digit set positions, or contain a slash / letters.
        if (n.length > 4) return '';
      }
      // Reject anything absurdly long.
      if (n.length > 20) return '';
      return num;
    };
    const beforeNum = cardInfo.card_number;
    cardInfo.card_number = validateCardNumber(cardInfo.card_number, cardInfo.card_type);
    if (beforeNum && !cardInfo.card_number) {
      console.warn(`[scan] rejected invalid card_number "${beforeNum}" for ${cardInfo.card_type}`);
      // 2026-08-19: If card_number was garbage the whole ID is suspect.
      // Previously we only blanked set_code for YGO; now we treat ANY
      // TCG the same. Rationale: a 9-digit hallucinated "card_number"
      // (like 101305071 on a fake YGO card scanned in Pokémon mode)
      // means the model didn't actually read the card — it made
      // something up. Blank set_code and downgrade to low confidence
      // so the client renders the unmatched scan panel instead of a
      // confident wrong result with a Get-It-Graded upsell.
      cardInfo.set_code = '';
      cardInfo.set_name = '';
      cardInfo.confidence = 'low';
    }

    // 2026-08-19: Sanitize editorial junk strings in top-level ID (we
    // already did this for candidates below). GPT sometimes returns
    // literal 'Unknown', 'UNKNOWN', 'N/A', 'Fake', etc. in set_name /
    // rarity when it doesn't know — those propagate to the client and
    // render as "Unknown set · UNKNOWN". Blank them.
    const _junkStrings = /^(unknown|n\/?a|none|null|fake|proxy|custom|counterfeit|unofficial)$/i;
    if (cardInfo.set_name && _junkStrings.test(String(cardInfo.set_name).trim())) {
      cardInfo.set_name = '';
    }
    if (cardInfo.rarity && _junkStrings.test(String(cardInfo.rarity).trim())) {
      cardInfo.rarity = '';
    }
    if (Array.isArray(cardInfo.candidates)) {
      cardInfo.candidates.forEach(c => {
        if (c) c.card_number = validateCardNumber(c.card_number, c.card_type || cardInfo.card_type);
      });
    }
    // Same sanitization for candidates — the picker UI shouldn't show garbage sets either.
    if (Array.isArray(cardInfo.candidates)) {
      const badPatterns = [
        'not an official', 'not official', 'counterfeit', 'custom card',
        'custom / fake', 'not a real', 'unknown set', 'no set', 'fake',
        'unofficial', 'proxy'
      ];
      cardInfo.candidates.forEach(c => {
        if (c && c.set_name) {
          const s = String(c.set_name).toLowerCase();
          if (badPatterns.some(p => s.includes(p))) c.set_name = '';
        }
      });
    }

    // ── 2026-08-16: pokemontcg.io grounding pass ──
    // Vision models don't know sets released after their training cutoff
    // and sometimes label real recent cards as "Not an official set /
    // custom / counterfeit". Fix: after the model returns a name + number,
    // look the card up in pokemontcg.io and OVERRIDE set_name/rarity from
    // the authoritative source. Only runs for pokemon cards (skipped for
    // sports/mtg/yugioh/lorcana/onepiece which use different data sources).
    if (
      !isGradeMode &&
      (cardInfo.card_type || 'pokemon') === 'pokemon' &&
      !cardInfo.is_japanese &&
      cardInfo.card_name &&
      cardInfo.card_number
    ) {
      try {
        const rawName = String(cardInfo.card_name).trim();
        const rawNum  = String(cardInfo.card_number).trim();
        const rawSet  = String(cardInfo.set_name || '').trim();
        const rawSetCode = String(cardInfo.set_code || '').trim().replace(/[^A-Za-z0-9]/g, '');
        const cleanNum  = rawNum.replace(/\/.*$/, '').trim(); // "100/086" → "100"
        const cleanName = rawName.replace(/["\\]/g, '').trim();

        // Build a series of pokemontcg.io queries from most specific to
        // least specific. We stop at the first that returns a match with
        // matching CARD NUMBER (server-side re-check to defeat fuzzy
        // wildcards) so we never override with a completely different card.
        const queries = [];
        // 0. Best signal: printed set code + number — unambiguous, no name needed.
        //    pokemontcg.io indexes set.ptcgoCode (SVI, MEW, etc.) and set.id.
        //    Try both fields since some sets use ptcgoCode, others use id.
        if (rawSetCode && cleanNum) {
          queries.push(`set.ptcgoCode:${rawSetCode} number:${cleanNum}`);
          queries.push(`set.id:${rawSetCode.toLowerCase()} number:${cleanNum}`);
        }
        if (cleanName && cleanNum) {
          // 1. Exact quoted name + number
          queries.push(`name:"${cleanName}" number:${cleanNum}`);
          // 2. Some cards store name without "ex"/"EX" or with ★ glyph.
          //    Strip common suffixes and retry.
          const nameNoSuffix = cleanName
            .replace(/\s+(ex|EX|VMAX|VSTAR|V|GX|Star|\u2605)$/i, '')
            .trim();
          if (nameNoSuffix && nameNoSuffix !== cleanName) {
            queries.push(`name:"${nameNoSuffix}" number:${cleanNum}`);
          }
          // 3. Last identifier word only, e.g. "Mega Greninja ex" → "Greninja".
          const words = cleanName.split(/\s+/).filter(w => w && !/^(mega|ex|EX|VMAX|VSTAR|V|GX|Star|\u2605)$/i.test(w));
          const identifier = words[words.length - 1] || words[0];
          if (identifier && identifier !== cleanName && !queries.some(q => q.includes(`"${identifier}"`))) {
            queries.push(`name:"${identifier}" number:${cleanNum}`);
          }
        }

        let best = null;
        for (const q of queries) {
          try {
            const ptcgUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=15&select=id,name,set,number,rarity,hp`;
            const ptcgRes = await fetch(ptcgUrl, { signal: AbortSignal.timeout(4500) });
            if (!ptcgRes.ok) continue;
            const j = await ptcgRes.json();
            const cards = (j.data || []).filter(c => {
              // HARD requirement: card number must match. pokemontcg.io
              // sometimes returns fuzzy matches; we need an exact number match.
              if (!c.number) return false;
              const cnNum = String(c.number).replace(/^0+/, '');
              const wantNum = cleanNum.replace(/^0+/, '');
              return cnNum === wantNum;
            });
            if (cards.length === 0) continue;

            // If we have >1 hit for the same card number, prefer the one
            // whose set name shares tokens with what the model reported
            // (helps with the Mega Evolution / new-set case where the
            // model may have gotten close but not exact).
            const modelSetLo = rawSet.toLowerCase();
            let ranked = cards;
            if (modelSetLo && cards.length > 1) {
              ranked = cards.map(c => {
                const setLo = (c.set?.name || '').toLowerCase();
                const setTokens = new Set(modelSetLo.split(/\W+/).filter(t => t.length >= 3));
                let hit = 0;
                for (const t of setTokens) if (setLo.includes(t)) hit++;
                return { c, score: hit };
              }).sort((a,b) => b.score - a.score).map(x => x.c);
            }
            // Also prefer newer sets when tied (releaseDate desc)
            best = ranked[0];
            if (best) break;
          } catch(_) { /* try next query */ }
        }

        if (best) {
          cardInfo.set_name = best.set?.name || cardInfo.set_name || '';
          if (!cardInfo.rarity && best.rarity) cardInfo.rarity = best.rarity;
          if (!cardInfo.hp && best.hp)         cardInfo.hp     = String(best.hp);
          if (best.name) cardInfo.card_name = best.name;
          if (best.number) cardInfo.card_number = String(best.number);
          cardInfo._grounded = true;
          cardInfo._grounded_id = best.id || null;
          cardInfo._grounded_set_code = best.set?.ptcgoCode || best.set?.id || '';
        }
      } catch(e) {
        // Grounding is best-effort. If pokemontcg.io times out or 500s,
        // fall through to the model's original set_name.
        console.warn('pokemontcg.io grounding failed:', e?.message || e);
      }
    }

    if (isGradeMode) {
      // Coerce sub-grades to numbers (GPT sometimes returns strings) and clamp 1-10.
      const clampSub = (v) => {
        const n = typeof v === 'number' ? v : parseFloat(v);
        if (!isFinite(n)) return null;
        return Math.max(1, Math.min(10, n));
      };

      // ── OFFICIAL PSA CENTERING CEILING (server-side safety net) ────────
      // The model is now prompted with the correct thresholds, but we also
      // enforce them server-side in case the model makes an arithmetic
      // mistake or ignores the prompt. "NN/NN" → worse pct of the pair.
      const parseRatio = (s) => {
        if (!s || typeof s !== 'string') return null;
        const m = s.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
        if (!m) return null;
        const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (!isFinite(a) || !isFinite(b) || a + b === 0) return null;
        return Math.max(a, b) / (a + b); // 0.5..1.0 — higher means MORE off-center
      };
      const centeringCeilingFromRatio = (worstRatio) => {
        if (worstRatio == null) return null;
        // OFFICIAL PSA front-centering thresholds:
        //   PSA 10: 55/45 or better → worstRatio <= 0.55
        //   PSA 9:  60/40 or better → worstRatio <= 0.60
        //   PSA 8:  65/35 or better → worstRatio <= 0.65
        //   PSA 7:  70/30 or better → worstRatio <= 0.70
        //   PSA 6:  75/25 or better → worstRatio <= 0.75
        //   PSA 5:  80/20 or better → worstRatio <= 0.80
        // Small tolerance for measurement noise.
        const t = 0.005;
        if (worstRatio <= 0.55 + t) return 10;
        if (worstRatio <= 0.60 + t) return 9;
        if (worstRatio <= 0.65 + t) return 8;
        if (worstRatio <= 0.70 + t) return 7;
        if (worstRatio <= 0.75 + t) return 6;
        if (worstRatio <= 0.80 + t) return 5;
        return 4;
      };

      // Read the new response fields (with legacy fallback so a mid-deploy
      // window doesn't break output).
      const centeringLR = cardInfo.centering_lr || (typeof cardInfo.centering === 'string' ? (cardInfo.centering.match(/(\d{1,2}\/\d{1,2})\s*L\/R/i)?.[1] || '') : '');
      const centeringTB = cardInfo.centering_tb || (typeof cardInfo.centering === 'string' ? (cardInfo.centering.match(/(\d{1,2}\/\d{1,2})\s*T\/B/i)?.[1] || '') : '');
      const centeringBack = cardInfo.centering_back || '';

      const rLR = parseRatio(centeringLR);
      const rTB = parseRatio(centeringTB);
      const worstFront = (rLR != null && rTB != null) ? Math.max(rLR, rTB) : (rLR ?? rTB);
      const computedCeiling = centeringCeilingFromRatio(worstFront);
      const modelCeiling = clampSub(cardInfo.centering_ceiling);
      // Trust the server computation over the model's self-reported ceiling.
      const centeringCeiling = computedCeiling ?? (modelCeiling != null ? Math.round(modelCeiling) : null);

      // Enforce the centering ceiling on the reported PSA estimate.
      let psaEstimate = clampSub(cardInfo.psa_estimate);
      if (psaEstimate != null) psaEstimate = Math.round(psaEstimate);
      if (centeringCeiling != null && psaEstimate != null && psaEstimate > centeringCeiling) {
        psaEstimate = centeringCeiling;
      }

      // Legacy subgrades object — keep populated for older frontend paths.
      // Centering sub-score derived from the ceiling (10 → 10, 9 → 9, etc.).
      const sg = cardInfo.subgrades || {};
      let subgrades = {
        centering: centeringCeiling ?? clampSub(sg.centering),
        corners:   clampSub(sg.corners),
        edges:     clampSub(sg.edges),
        surface:   clampSub(sg.surface),
      };

      // ── CV-grade overlay: replace GPT eyeball estimates with Ximilar's ──
      // pixel-measured pillar scores. Ximilar's grader measures centering
      // to the pixel, evaluates each corner/edge polygon independently, and
      // detects surface defects with a purpose-built model. GPT-5's prose
      // (grade_notes, centering description) is kept for the human-readable
      // summary; the numeric sub-grades come from Ximilar.
      //
      // ── Slab detection ──
      // If the card appears to be in a graded slab (CGC/PSA/BGS holder),
      // the CV grader is trained on RAW cards and will give bad results
      // (plastic glare, holder corners, label crop). We combine three signals:
      //   1) GPT-5's own slab flag (from the grading prompt)
      //   2) cardInfo._ximilar_graded (present if identify was run)
      //   3) Ximilar grader's slab hint on the card object (populated below)
      // If any signal fires, we STILL return the grade (user paid for it) but
      // attach slab_warning so the UI can show a friendly "sneaky, sneaky".
      let looksSlabbed =
        !!(cardInfo?._ximilar_graded) ||
        !!(cardInfo?.is_slabbed === true) ||
        !!(cardInfo?.slabbed    === true);

      // ── COST GATE ──
      // Ximilar /card-grader/v2/grade = 100 credits ≈ $0.109 per call on the
      // 100k plan. At $0.10/credit user pricing:
      //   Quick Grade (1 credit) → -9% margin (LOSES money)
      //   Deep Grade  (2 credits) → +46% margin
      // So we only enable Ximilar grader for Deep Grade. Quick Grade keeps
      // the GPT-5-only path (~$0.01 cost, 89% margin).
      //
      // The ENABLE_XIMILAR_GRADER env var is the master feature flag:
      //   'off' | unset → GPT-5 only for all grade modes (safe default)
      //   'deep_only'   → Ximilar CV pillars on Deep Grade only
      //   'all'         → Ximilar CV pillars on Quick + Deep (WARNING: unprofitable Quick Grade)
      const graderFlag = (process.env.ENABLE_XIMILAR_GRADER || 'off').toLowerCase();
      const useXimilarGrader =
        (graderFlag === 'deep_only' && isDeepGrade) ||
        (graderFlag === 'all');

      let cvSource = 'gpt';
      let cvCentering = null;
      let cvGrader   = null;
      if (useXimilarGrader && ximilarToken && imageBase64) {
        try {
          const t0 = Date.now();
          const imgs = backBase64 ? [imageBase64, backBase64] : [imageBase64];
          const xg = await gradeWithXimilar(imgs, mimeType || 'image/jpeg', ximilarToken);
          console.log('[scan] ximilar-grader took', Date.now() - t0, 'ms ok=', xg.ok, 'reason=', xg.reason);
          // Ximilar's grader returns holder detection on the card object.
          // Some responses expose it as record.card[0].holder or record.holder.
          if (xg.raw?.records?.[0]) {
            const rec0 = xg.raw.records[0];
            const holder =
              rec0.card?.[0]?.holder ||
              rec0.holder ||
              rec0.card?.[0]?.slab   ||
              null;
            if (holder && typeof holder === 'object' && (holder.present === true || holder.detected === true || holder.grade)) {
              looksSlabbed = true;
            }
          }
          if (xg.ok && xg.grades) {
            const xs = {
              centering: clampSub(xg.grades.centering),
              corners:   clampSub(xg.grades.corners),
              edges:     clampSub(xg.grades.edges),
              surface:   clampSub(xg.grades.surface),
            };
            // Only overwrite each pillar if Ximilar returned a valid number.
            subgrades = {
              centering: xs.centering ?? subgrades.centering,
              corners:   xs.corners   ?? subgrades.corners,
              edges:     xs.edges     ?? subgrades.edges,
              surface:   xs.surface   ?? subgrades.surface,
            };
            cvSource   = 'ximilar';
            cvCentering = xg.cv?.centering || null;
            cvGrader   = {
              condition: xg.grades.condition,
              final:     clampSub(xg.grades.final),
              corners:   xg.cv?.corners || [],
              edges:     xg.cv?.edges || [],
            };
          }
        } catch(e) {
          console.warn('[scan] ximilar-grader threw, keeping GPT sub-grades:', e?.message || e);
        }
      }
      // Compute a server-side confidence floor based on how many photos we actually had.
      // GPT can't over-claim: if it says "high" but we only had 2 photos, we downgrade to medium.
      const gptConf = (typeof cardInfo.confidence === 'string')
        ? cardInfo.confidence.toLowerCase()
        : null;
      const gptConfNorm = ['high','medium','low'].includes(gptConf) ? gptConf : null;
      // Photo-count-based ceiling for confidence:
      //   Deep Grade 6 photos = up to high
      //   Deep Grade 4–5 photos = up to medium
      //   Quick Grade 2 photos = up to medium
      const photoCap = totalPhotos >= 6 ? 'high' : (totalPhotos >= 4 ? 'medium' : 'medium');
      const capOrder = { low: 0, medium: 1, high: 2 };
      const defaultConf = isDeepGrade ? (totalPhotos >= 6 ? 'high' : 'medium') : 'medium';
      let confidence = gptConfNorm || defaultConf;
      if (capOrder[confidence] > capOrder[photoCap]) confidence = photoCap;

      // If Ximilar returned a pixel-measured centering string, expose it as
      // the canonical `centering` field ("55/45 L/R, 52/48 T/B") so the UI
      // shows the real measurement instead of GPT's eyeball estimate.
      // Also re-compute the ceiling from Ximilar's more accurate numbers.
      //
      // CRITICAL: When Ximilar overrides, we must sync centering_lr /
      // centering_tb (the wire fields the UI reads for its meter) so the
      // meter bars, zone labels, ceiling caption, and psa_estimate all
      // reflect the SAME numbers. Previously the display string got updated
      // but the wire fields stayed as GPT's eyeball estimate — the UI would
      // render a meter showing 55/45 with a caption saying "caps at PSA 6",
      // which was mathematically impossible and shattered user trust.
      let finalCenteringLR = centeringLR;
      let finalCenteringTB = centeringTB;
      let centeringDisplay =
        (centeringLR || centeringTB)
          ? [centeringLR && `${centeringLR} L/R`, centeringTB && `${centeringTB} T/B`].filter(Boolean).join(', ')
          : (cardInfo.centering || 'Unknown');
      let finalCenteringCeiling = centeringCeiling;
      if (cvCentering?.leftRight || cvCentering?.topBottom) {
        const lr = cvCentering.leftRight;
        const tb = cvCentering.topBottom;
        centeringDisplay = [lr && `${lr} L/R`, tb && `${tb} T/B`].filter(Boolean).join(', ');
        // Sync wire fields so meter + caption stay in sync.
        if (lr) finalCenteringLR = lr;
        if (tb) finalCenteringTB = tb;
        // Re-run the ceiling calc with Ximilar's pixel-measured numbers.
        const rLRx = parseRatio(lr);
        const rTBx = parseRatio(tb);
        const worstX = (rLRx != null && rTBx != null) ? Math.max(rLRx, rTBx) : (rLRx ?? rTBx);
        const cvCeil = centeringCeilingFromRatio(worstX);
        if (cvCeil != null) {
          finalCenteringCeiling = cvCeil;
          subgrades.centering = cvCeil;
          if (psaEstimate != null && psaEstimate > cvCeil) psaEstimate = cvCeil;
        }
      }

      // ── FINAL COHERENCE PASS ──
      // Regardless of which source produced the ratios, the ceiling MUST
      // match what the ratios say. This catches the case where the model
      // returned inconsistent fields (e.g. centering_lr="55/45" but
      // centering_ceiling=6). Recompute from the numbers we're about to
      // display and let the numbers win.
      {
        const rLRf = parseRatio(finalCenteringLR);
        const rTBf = parseRatio(finalCenteringTB);
        const worstF = (rLRf != null && rTBf != null) ? Math.max(rLRf, rTBf) : (rLRf ?? rTBf);
        const truCeil = centeringCeilingFromRatio(worstF);
        if (truCeil != null) {
          if (truCeil !== finalCenteringCeiling) {
            console.warn('[scan] centering ceiling desync corrected:', {
              had: finalCenteringCeiling, computed: truCeil,
              lr: finalCenteringLR, tb: finalCenteringTB,
            });
          }
          finalCenteringCeiling = truCeil;
          subgrades.centering = truCeil;
          // psa_estimate can only be as high as the centering ceiling.
          if (psaEstimate != null && psaEstimate > truCeil) psaEstimate = truCeil;
        }
      }

      // Photo-based confidence gets a bump when Ximilar CV grades are available.
      if (cvSource === 'ximilar' && confidence !== 'high' && totalPhotos >= 2) {
        confidence = 'medium';
      }

      // Slab warning gets attached whenever we detected a slab, regardless
      // of which grader (Ximilar or GPT) produced the numbers. It's the
      // client's job to render it as a top-of-card banner.
      const slabWarning = looksSlabbed
        ? {
            slabbed: true,
            title: 'Sneaky, sneaky.',
            message: 'This card looks like it\'s already in a graded slab. Grading results will be skewed by the plastic and label — trust the number on the slab, not this estimate.',
          }
        : null;

      // Normalize psa_distribution: array of top 3 buckets summing to ~100.
      // ENFORCE: top bucket grade must equal psa_estimate (model sometimes
      // returns a distribution whose top bucket disagrees with its own
      // point estimate — that's incoherent and confusing to users).
      let distArray = [];
      const distObj = cardInfo.psa_distribution;
      if (distObj && typeof distObj === 'object') {
        const entries = Object.entries(distObj)
          .map(([g, p]) => ({ grade: parseInt(g, 10), pct: parseFloat(p) }))
          .filter(x => isFinite(x.grade) && isFinite(x.pct) && x.pct > 0)
          .sort((a, b) => b.pct - a.pct)
          .slice(0, 3);
        const total = entries.reduce((s, x) => s + x.pct, 0);
        if (total > 0) {
          distArray = entries.map(x => ({ grade: x.grade, pct: Math.round((x.pct / total) * 100) }));
        }
      }
      // If distribution missing, synthesize a conservative one around psaEstimate.
      if (distArray.length === 0 && psaEstimate != null) {
        if (confidence === 'high') {
          distArray = [{ grade: psaEstimate, pct: 80 }];
          if (psaEstimate < 10) distArray.push({ grade: psaEstimate + 1, pct: 10 });
          if (psaEstimate > 1)  distArray.push({ grade: psaEstimate - 1, pct: 10 });
        } else {
          distArray = [{ grade: psaEstimate, pct: 55 }];
          if (psaEstimate < 10) distArray.push({ grade: psaEstimate + 1, pct: 20 });
          if (psaEstimate > 1)  distArray.push({ grade: psaEstimate - 1, pct: 25 });
        }
      }
      // ── COHERENCE ENFORCEMENT ──
      // If the model's top bucket disagrees with psa_estimate (or if the server
      // just downgraded psa_estimate via the centering ceiling), rebuild the
      // distribution around the corrected psa_estimate. This keeps the UI's
      // "Most likely PSA X" and the top bar of the distribution in agreement.
      if (psaEstimate != null && distArray.length > 0 && distArray[0].grade !== psaEstimate) {
        // Preserve the model's uncertainty spread but shift the peak.
        const shift = psaEstimate - distArray[0].grade;
        distArray = distArray.map(x => ({ grade: Math.max(1, Math.min(10, x.grade + shift)), pct: x.pct }));
      }

      // ── THROUGH-PLASTIC HONESTY ENFORCEMENT ──
      // No matter what the model says, if we detected a slab/sleeve/holder,
      // hard-cap the outputs to reflect that we're grading through plastic.
      // The user cannot make a money decision on a grade estimate through a
      // reflective surface — they need to re-scan raw.
      const throughPlastic = looksSlabbed;
      if (throughPlastic) {
        // Force confidence down.
        confidence = 'low';
        // Force worth_grading to false — through plastic is not actionable.
        cardInfo.worth_grading = false;
        // Cap psa_estimate at 8 (Excellent-Mint) — anything higher is
        // dishonest when we can't see the card cleanly.
        if (psaEstimate != null && psaEstimate > 8) {
          console.warn('[scan] through-plastic cap applied to psa_estimate:', {
            was: psaEstimate, capped: 8,
          });
          psaEstimate = 8;
        }
        // Force grade_label consistency with the cap.
        if (psaEstimate != null && psaEstimate < 10 && cardInfo.grade_label === 'Gem Mint') {
          cardInfo.grade_label = psaEstimate >= 9 ? 'Mint' : 'Near Mint-Mint';
        }
        // Force eye_appeal down — you can't call eye appeal Strong when the
        // card is behind reflective plastic.
        if (cardInfo.eye_appeal === 'Strong') cardInfo.eye_appeal = 'Average';
        // Make sure the distribution reflects the uncertainty. If the top
        // bucket is > 55%, flatten it — low-confidence scans should show
        // spread, not false conviction.
        if (distArray.length > 0 && distArray[0].pct > 55) {
          const top = distArray[0];
          const rest = distArray.slice(1);
          const totalRest = rest.reduce((s, x) => s + x.pct, 0) || 1;
          top.pct = 50;
          const remain = 50;
          rest.forEach(x => { x.pct = Math.round((x.pct / totalRest) * remain); });
        }
      }

      // ── CONFIDENCE-VS-GRADE HONESTY ENFORCEMENT ──
      // A card with genuine visual IMPEDIMENTS cannot be a PSA 10. But drivers
      // that just reflect the product scope (Quick Grade = 1 photo by design)
      // are NOT impediments — they're product features. Previously any driver
      // other than 'none' capped psa_estimate at 9, which meant EVERY Quick
      // Grade of a perfect card capped at 9 because we auto-inject
      // 'single_photo_only' and 'back_not_visible' server-side (2026-08-22).
      //
      // Impairment drivers (block visual assessment): holder_glare,
      // blurry_photo, reflective_sleeve, low_resolution, finger_covering_card.
      // Product-scope drivers (fine on Quick Grade): single_photo_only,
      // back_not_visible, limited_edge_visibility.
      const IMPAIRMENT_DRIVERS = new Set([
        'holder_glare', 'blurry_photo', 'reflective_sleeve',
        'low_resolution', 'finger_covering_card',
      ]);
      const hasImpairment = Array.isArray(cardInfo.confidence_drivers)
        && cardInfo.confidence_drivers.some(d => d && IMPAIRMENT_DRIVERS.has(d));
      if (hasImpairment && psaEstimate === 10) {
        console.warn('[scan] visual impairment present but psa_estimate=10 — capping at 9');
        psaEstimate = 9;
      }
      // worth_grading backstop: if final psa_estimate < 9 or confidence is
      // low, worth_grading must be false. Grading fees on a PSA 8 modern
      // card are net-negative under any realistic scenario.
      if (cardInfo.worth_grading === true) {
        if (psaEstimate == null || psaEstimate < 9 || confidence === 'low') {
          console.warn('[scan] worth_grading=true but grade/confidence too low — forcing false:', {
            psaEstimate, confidence,
          });
          cardInfo.worth_grading = false;
        }
      }

      // Low confidence + narrow distribution is dishonest. Spread it out.
      if (confidence === 'low' && distArray.length > 0 && distArray[0].pct > 55) {
        const top = distArray[0];
        const rest = distArray.slice(1);
        const totalRest = rest.reduce((s, x) => s + x.pct, 0) || 1;
        top.pct = 50;
        rest.forEach(x => { x.pct = Math.round((x.pct / totalRest) * 50); });
      }

      // ── LIMITING FACTOR PROSE RECONCILIATION ──
      // The model writes limiting_factor as free text, but sometimes it
      // contradicts the (server-corrected) numbers we're about to show —
      // e.g. it says "caps at PSA 6" while the measured centering is 55/45.
      // Detect that mismatch and replace with a deterministic sentence
      // derived from the actual measured numbers. Better to say something
      // boring-but-true than something confidently wrong.
      let reconciledLimitingFactor = cardInfo.limiting_factor || '';
      {
        const lf = String(reconciledLimitingFactor).toLowerCase();
        // Look for a grade number the prose is claiming, in patterns like
        //   "caps at PSA 6" / "psa 6 centering" / "projects as a 7" / "a psa 8"
        const claim = lf.match(/caps at psa\s*(\d{1,2})/i)
                   || lf.match(/psa\s*(\d{1,2})\s*centering/i)
                   || lf.match(/projects?\s+as\s+(?:a\s+)?psa\s*(\d{1,2})/i)
                   || lf.match(/\ba\s+psa\s*(\d{1,2})\b/i);
        const claimedGrade = claim ? parseInt(claim[1], 10) : null;
        const worstAxis = (() => {
          const a = parseRatio(finalCenteringLR);
          const b = parseRatio(finalCenteringTB);
          return (a != null && b != null) ? Math.max(a, b) : (a ?? b);
        })();
        const truCeil = centeringCeilingFromRatio(worstAxis);
        // Prose is lying if:
        //  • It names a grade that's LOWER than what the numbers support, OR
        //  • It contradicts our final psa_estimate by more than 1 grade.
        const proseIsLying =
          (claimedGrade != null && truCeil != null && claimedGrade < truCeil) ||
          (claimedGrade != null && psaEstimate != null && Math.abs(claimedGrade - psaEstimate) >= 2);
        if (proseIsLying) {
          console.warn('[scan] limiting_factor prose contradicts measured centering — rewriting:', {
            model_said: reconciledLimitingFactor,
            claimed_grade: claimedGrade,
            measured_ceiling: truCeil,
            psa_estimate: psaEstimate,
            lr: finalCenteringLR, tb: finalCenteringTB,
          });
          if (psaEstimate === 10) {
            reconciledLimitingFactor = `Measured centering (${finalCenteringLR || '?'} L/R, ${finalCenteringTB || '?'} T/B) qualifies for PSA 10. Corners, edges, and surface show no observable defects in the photos provided.`;
          } else if (psaEstimate != null && truCeil != null && psaEstimate === truCeil) {
            reconciledLimitingFactor = `Measured centering (${finalCenteringLR || '?'} L/R, ${finalCenteringTB || '?'} T/B) caps the front-centering grade at PSA ${truCeil}. The next grade up would require tighter centering.`;
          } else if (psaEstimate != null) {
            reconciledLimitingFactor = `Measured centering (${finalCenteringLR || '?'} L/R, ${finalCenteringTB || '?'} T/B) allows up to PSA ${truCeil ?? psaEstimate}. Final estimate is PSA ${psaEstimate} — review the pillar notes for the specific defect blocking a higher grade.`;
          }
        }
      }

      // Confidence drivers — array of strings the UI can render as chips.
      let confidenceDrivers = Array.isArray(cardInfo.confidence_drivers)
        ? cardInfo.confidence_drivers.filter(x => typeof x === 'string' && x.length)
        : [];
      // Auto-inject drivers we know about server-side.
      if (looksSlabbed && !confidenceDrivers.includes('holder_glare')) confidenceDrivers.push('holder_glare');
      if (totalPhotos < 2 && !confidenceDrivers.includes('single_photo_only')) confidenceDrivers.push('single_photo_only');
      if (!backDataUrl && !confidenceDrivers.includes('back_not_visible')) confidenceDrivers.push('back_not_visible');
      if (edgeImages.length < 4 && isDeepGrade && !confidenceDrivers.includes('limited_edge_visibility')) confidenceDrivers.push('limited_edge_visibility');
      if (confidenceDrivers.length === 0) confidenceDrivers = ['none'];

      return res.status(200).json({
        success:       true,
        mode:          'grade',
        deepGrade:     isDeepGrade,
        creditsUsed:   gradeCost,
        photoCount:    totalPhotos,
        card_name:     cardInfo.card_name     || '',

        // 2026-08-20: expose the full identify context we already computed.
        // Client uses these to load the EXACT card panel after View Card /
        // View PSA X price without re-running Ximilar (no extra credit, no
        // extra API call, no fuzzy pokemontcg.io lookup).
        card_number:   cardInfo.card_number   || '',
        set_name:      cardInfo.set_name      || '',
        set_code:      cardInfo.set_code      || '',
        grounded_id:   cardInfo.grounded_id   || '',
        rarity:        cardInfo.rarity        || '',
        card_type:     cardInfo.card_type     || 'pokemon',
        is_japanese:   cardInfo.is_japanese === true,
        image_url:     cardInfo.image_url     || cardInfo.image_small || '',

        // Centering — measured ratios + official PSA thresholds
        centering:            centeringDisplay,
        centering_lr:         finalCenteringLR || '',
        centering_tb:         finalCenteringTB || '',
        centering_back:       centeringBack || '',
        centering_ceiling:    finalCenteringCeiling ?? centeringCeiling ?? null,
        centering_thresholds: {
          psa10: '55/45 or better',
          psa9:  '60/40 or better',
          psa8:  '65/35 or better',
          psa7:  '70/30 or better',
          back_note: 'Back centering is significantly more lenient (75/25 for PSA 10)',
        },

        // PSA-native descriptions (no fake sub-scores)
        corners_desc: cardInfo.corners_desc || cardInfo.corners || 'Unknown',
        edges_desc:   cardInfo.edges_desc   || cardInfo.edges   || 'Unknown',
        surface_desc: cardInfo.surface_desc || cardInfo.surface || 'Unknown',

        // Legacy fields for older UI — mirror the new *_desc values
        corners: cardInfo.corners_desc || cardInfo.corners || 'Unknown',
        edges:   cardInfo.edges_desc   || cardInfo.edges   || 'Unknown',
        surface: cardInfo.surface_desc || cardInfo.surface || 'Unknown',

        // Overall grade prediction
        psa_estimate:      psaEstimate ?? cardInfo.psa_estimate ?? null,
        psa_distribution:  distArray,
        limiting_factor:   reconciledLimitingFactor,
        grade_label:       cardInfo.grade_label   || '',
        grade_notes:       cardInfo.grade_notes   || reconciledLimitingFactor || '',

        // Eye appeal (new PSA-aligned judgment layer)
        eye_appeal:        cardInfo.eye_appeal || 'Average',
        eye_appeal_notes:  cardInfo.eye_appeal_notes || '',

        flaw_count:      clampSub(cardInfo.flaw_count) ?? null,
        worth_grading:   cardInfo.worth_grading ?? false,
        is_vintage:      cardInfo.is_vintage === true,

        // Legacy subgrades kept for backward-compat with the current UI.
        // Centering here = the ceiling grade (not a fake sub-score).
        subgrades,

        confidence,
        confidence_drivers: confidenceDrivers,
        cv_source:     cvSource,     // 'ximilar' or 'gpt'
        cv_grader:     cvGrader,     // { condition, final, corners[], edges[] } when ximilar succeeded
        // Grading standard disclosure — aligned to OFFICIAL PSA thresholds now.
        grading_standard: cvSource === 'ximilar'
          ? 'AI estimate using OFFICIAL PSA thresholds with pixel-measured centering. Final grade is at PSA\'s discretion.'
          : 'AI estimate using OFFICIAL PSA thresholds (55/45 = PSA 10, 60/40 = PSA 9, 65/35 = PSA 8). Final grade is at PSA\'s discretion.',
        slab_warning:  slabWarning,
        // If it's a slab, echo back what GPT read off the label so the UI
        // can say "CGC 10" instead of just "probably slabbed".
        slab_info:     looksSlabbed
          ? {
              grader: cardInfo.slab_grader || '',
              grade:  cardInfo.slab_grade  || '',
            }
          : null,
      });
    }

    // ── Low-confidence path: return top candidates and refund the credit.
    // Frontend shows a "Is it one of these?" picker; user selects the correct card;
    // then a second scan-confirm call debits the credit. This prevents charging
    // users when the AI wasn't sure and got it wrong.
    const idConf = (typeof cardInfo.confidence === 'string')
      ? cardInfo.confidence.toLowerCase()
      : null;
    const idConfNorm = ['high','medium','low'].includes(idConf) ? idConf : null;
    const rawCandidates = Array.isArray(cardInfo.candidates) ? cardInfo.candidates : [];
    const cleanCandidates = rawCandidates
      .filter(c => c && typeof c === 'object' && (c.card_name || c.card_number))
      .slice(0, 3)
      .map(c => ({
        card_name:      c.card_name      || '',
        card_number:    c.card_number    || '',
        set_name:       c.set_name       || '',
        hp:             c.hp             || '',
        card_type:      c.card_type      || 'pokemon',
        is_japanese:    c.is_japanese === true,
        rarity:         c.rarity         || '',
        sport:          c.sport          || '',
        year:           c.year           || '',
        confidence_pct: (typeof c.confidence_pct === 'number' ? c.confidence_pct : null),
      }));

    // Only trigger the picker when the model is actually uncertain AND we got
    // multiple candidates. High-confidence single answers pass straight through.
    if ((idConfNorm === 'low' || idConfNorm === 'medium') && cleanCandidates.length >= 2) {
      // Refund the ID credit — user hasn't gotten a final answer yet.
      await refundCredits();
      return res.status(200).json({
        success:      true,
        mode:         'identify',
        needsPicker:  true,
        confidence:   idConfNorm,
        candidates:   cleanCandidates,
        image_quality: cardInfo.image_quality || 'ok',
        glare_regions: Array.isArray(cardInfo.glare_regions) ? cardInfo.glare_regions : [],
        retake_hint:   cardInfo.retake_hint || '',
        // Also include the top guess for UI convenience.
        card_name:    cardInfo.card_name   || cleanCandidates[0].card_name   || '',
        card_number:  cardInfo.card_number || cleanCandidates[0].card_number || '',
        set_name:     cardInfo.set_name    || cleanCandidates[0].set_name    || '',
        set_code:     cardInfo.set_code    || cleanCandidates[0].set_code    || '',
        grounded:     cardInfo._grounded === true,
        grounded_id:  cardInfo._grounded_id || null,
        hp:           cardInfo.hp          || cleanCandidates[0].hp          || '',
        card_type:    cardInfo.card_type   || cleanCandidates[0].card_type   || 'pokemon',
        is_japanese:  cardInfo.is_japanese === true || cleanCandidates[0].is_japanese === true,
        jp_name:      cardInfo.jp_name     || cleanCandidates[0].jp_name     || '',
        rarity:       cardInfo.rarity      || cleanCandidates[0].rarity      || '',
        sport:        cardInfo.sport       || cleanCandidates[0].sport       || '',
        year:         cardInfo.year        || cleanCandidates[0].year        || '',
        brand:        cardInfo.brand       || cleanCandidates[0].brand       || '',
        image_url:    cardInfo.image_url   || cardInfo.image_small || '',
      });
    }

    // Real search — count it toward the public social-proof counter. Fire-and-forget.
    _incrSearchStats(kvUrl, kvToken);

    // Log the successful scan so the client can later request a refund via
    // POST /api/scan-refund { scan_id }. Server keeps the source-of-truth
    // record of what was scanned + which credit bucket was consumed.
    if (hasKV && consumedFrom) {
      try {
        const record = {
          uid:            key,
          consumed_from:  consumedFrom,
          consumed_amount: consumedAmount,
          card_name:      cardInfo.card_name   || '',
          card_number:    cardInfo.card_number || '',
          set_name:       cardInfo.set_name    || '',
          confidence:     idConfNorm || 'high',
          image_quality:  cardInfo.image_quality || 'ok',
          created_at:     Date.now(),
        };
        // 1-hour TTL: refunds must happen within the same session
        await setKVWithTTL(kvUrl, kvToken, `scan:${scanId}`, JSON.stringify(record), 3600);
      } catch(e) { /* non-fatal */ }
    }

    return res.status(200).json({
      success: true,
      mode:        'identify',
      scan_id:     scanId,
      confidence:  idConfNorm || 'high',
      image_quality: cardInfo.image_quality || 'ok',
      glare_regions: Array.isArray(cardInfo.glare_regions) ? cardInfo.glare_regions : [],
      retake_hint:   cardInfo.retake_hint || '',
      card_name:   cardInfo.card_name   || '',
      card_number: cardInfo.card_number || '',
      set_name:    cardInfo.set_name    || '',
      set_code:    cardInfo.set_code    || '',
      grounded:    cardInfo._grounded === true || cardInfo.grounded === true,
      grounded_id: cardInfo._grounded_id || cardInfo.grounded_id || null,
      hp:          cardInfo.hp          || '',
      card_type:   cardInfo.card_type   || 'pokemon',
      is_japanese: cardInfo.is_japanese === true,
      jp_name:     cardInfo.jp_name     || '',
      rarity:      cardInfo.rarity      || '',
      sport:       cardInfo.sport       || '',
      year:        cardInfo.year        || '',
      brand:       cardInfo.brand       || '',
      // 2026-08-19: image_url from grounding (YGOProDeck currently; can be
      // extended to pokemontcg.io images too). Client shows this in the
      // scan overlay so users get a visual confirmation of the ID.
      image_url:   cardInfo.image_url   || cardInfo.image_small || '',
    });

  } catch(err) {
    console.error('Scan error:', err);
    // Refund on any unexpected exception
    try { await refundCredits(); } catch(e) {}
    return res.status(500).json({ error: 'Scanner temporarily unavailable. Credits refunded. Please try again.' });
  }
}

// ── KV helpers ──
function getMonthStamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function getKVInt(kvUrl, kvToken, key) {
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const d = await r.json();
    const raw = d.result;
    if (raw === null || raw === undefined) return 0;
    if (typeof raw === 'string' && raw.startsWith('[')) {
      try { return parseInt(JSON.parse(raw)[0]) || 0; } catch(e) {}
    }
    return parseInt(raw) || 0;
  } catch(e) { return 0; }
}

async function setKV(kvUrl, kvToken, key, value) {
  try {
    await fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(value))}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` }
    });
  } catch(e) {}
}

async function incrKV(kvUrl, kvToken, key) {
  try {
    await fetch(`${kvUrl}/incr/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` }
    });
  } catch(e) {}
}

// 2026-08-22 [F6]: Atomic DECR with returned new value. Concurrent bulk scans
// used to race read → setKV(cur-1), letting N parallel workers debit only 1
// credit. DECR is atomic in Redis; if the returned new value is negative the
// caller MUST compensate with INCR and treat the request as insufficient funds.
// Returns Number (possibly negative) or null on error.
async function decrKV(kvUrl, kvToken, key) {
  try {
    const r = await fetch(`${kvUrl}/decr/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const d = await r.json();
    const raw = d && d.result;
    if (raw === null || raw === undefined) return null;
    const n = parseInt(raw);
    return Number.isFinite(n) ? n : null;
  } catch(e) { return null; }
}

// 2026-08-22 [F6]: Atomic DECRBY with returned new value. Same guarantees as
// decrKV but subtracts `amount` in one op — needed for Deep Grade (cost 2).
async function decrByKV(kvUrl, kvToken, key, amount) {
  try {
    const r = await fetch(`${kvUrl}/decrby/${encodeURIComponent(key)}/${amount}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const d = await r.json();
    const raw = d && d.result;
    if (raw === null || raw === undefined) return null;
    const n = parseInt(raw);
    return Number.isFinite(n) ? n : null;
  } catch(e) { return null; }
}

// 2026-08-22 [F6]: Atomic INCRBY — compensating counterpart to decrByKV, used
// to refund a failed atomic debit.
async function incrByKV(kvUrl, kvToken, key, amount) {
  try {
    await fetch(`${kvUrl}/incrby/${encodeURIComponent(key)}/${amount}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` }
    });
  } catch(e) {}
}

// Upstash Redis SET with EX (TTL in seconds). Used for scan_id → record.
async function setKVWithTTL(kvUrl, kvToken, key, value, ttlSeconds) {
  try {
    await fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(value))}?EX=${ttlSeconds}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` }
    });
  } catch(e) {}
}

// Short opaque id — 24 chars, url-safe, enough entropy that guessing another
// user's scan_id is not economical (~10^36 combinations).
function _shortId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 24; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// ── Public search-counter increment (fire-and-forget). Powers the landing-page
// social-proof counter. Same key namespace as api/tcg-price.js so both endpoints
// feed into a single lifetime total.
function _todayKeyUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function _incrSearchStats(kvUrl, kvToken) {
  if (!kvUrl || !kvToken) return;
  fetch(`${kvUrl}/incr/${encodeURIComponent('stats:searches:total')}`, {
    method: 'POST', headers: { Authorization: `Bearer ${kvToken}` }
  }).catch(() => {});
  fetch(`${kvUrl}/incr/${encodeURIComponent('stats:searches:' + _todayKeyUTC())}`, {
    method: 'POST', headers: { Authorization: `Bearer ${kvToken}` }
  }).catch(() => {});
}

async function checkProStatus(stripeKey, kvUrl, kvToken, googleSub, email) {
  if (kvUrl && kvToken && googleSub) {
    try {
      const r = await fetch(`${kvUrl}/get/${encodeURIComponent(`pro:${googleSub}`)}`, {
        headers: { Authorization: `Bearer ${kvToken}` }
      });
      const d = await r.json();
      if (d.result) {
        const rec = JSON.parse(d.result);
        if (rec.status === 'active') return true;
      }
    } catch(e) {}
  }
  if (!stripeKey || !email) return false;
  try {
    const r = await fetch(
      `https://api.stripe.com/v1/customers/search?query=email:"${email}"&limit=1`,
      { headers: { Authorization: `Bearer ${stripeKey}` } }
    );
    if (!r.ok) return false;
    const d = await r.json();
    const cust = d.data?.[0];
    if (!cust) return false;
    const subR = await fetch(
      `https://api.stripe.com/v1/subscriptions?customer=${cust.id}&status=active&limit=1`,
      { headers: { Authorization: `Bearer ${stripeKey}` } }
    );
    const subD = await subR.json();
    return (subD.data?.length || 0) > 0;
  } catch(e) { return false; }
}
