// Read printed evidence only when visual matching needs help. OCR is never a
// catalogue identity: an exact, unique catalogue printing must corroborate it.
import { readFile } from 'node:fs/promises';
import { observeProviderAttempt } from './_providerUsage.js';

const paths = {
  pokemon: new URL('../data/catalog/pokemon.1b2a5316ec4a.json', import.meta.url),
  lorcana: new URL('../data/catalog/lorcana.7b3e3281f96f.json', import.meta.url),
  yugioh: new URL('../data/catalog/yugioh.88b8cbb13943.json', import.meta.url),
  onepiece: new URL('../data/catalog/onepiece.740c7853cd03.json', import.meta.url),
};
const indexes = new Map();
const normalized = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const num = s => String(s || '').replace(/^0+(?=\d)/, '');
const escape = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const token = (text, value) => new RegExp('(?:^|[^a-z0-9])' + escape(value) + '(?=$|[^a-z0-9])','i').test(text);

async function index(game) {
  if (!paths[game]) return null;
  if (!indexes.has(game)) indexes.set(game, readFile(paths[game], 'utf8').then(JSON.parse).catch(e => { indexes.delete(game); throw e; }));
  return indexes.get(game);
}

export async function readPrintedEvidence(image, tokenValue, { fetchFn = fetch, timeoutMs = 15000 } = {}) {
  if (!image || !tokenValue) return null;
  return observeProviderAttempt({provider:'ximilar',operation:'card_ocr_id',mode:'identify',inputImages:1}, async observe => {
    try {
      const response = await fetchFn('https://api.ximilar.com/collectibles/v2/card_ocr_id', {
        method:'POST', redirect:'error', signal:AbortSignal.timeout(timeoutMs),
        headers:{'Content-Type':'application/json',Authorization:`Token ${tokenValue}`},
        body:JSON.stringify({records:[{_base64:image}]}),
      });
      observe({status:response.status});
      if (!response.ok) { await response.body?.cancel(); return {ok:false,reason:'http'}; }
      const body = await response.json(), record = body?.records?.[0];
      if (!record || record._status?.code !== 200 || !Array.isArray(record._objects)) return {ok:false,reason:'invalid_response'};
      const cards = record._objects.filter(o => o?.name === 'Card');
      if (cards.length !== 1) return {ok:false,reason:cards.length ? 'multiple_cards' : 'no_card_detected'};
      const card = cards[0], text = card._ocr?.full_text || '';
      const labels = record._objects.filter(o => o?.name === 'Slab Label');
      if (typeof text !== 'string' || (!text.trim() && !labels.length) || text.length > 12000) return {ok:false,reason:'no_match'};
      return {ok:true,text,card,labels};
    } catch (error) { return {ok:false,reason:['AbortError','TimeoutError'].includes(error?.name)?'timeout':'network'}; }
  });
}

// Pure first-stage filter, independently tested against conflicting printings.
export function printedCandidates(catalog, game, text) {
  if (!catalog || !Array.isArray(catalog.cards) || typeof text !== 'string') return [];
  const flat = normalized(text);
  const ratios = [...text.matchAll(/\b(\d{1,4})\s*\/\s*(\d{1,4})\b/g)].map(m => [num(m[1]),num(m[2])]);
  if (['pokemon','lorcana'].includes(game) && new Set(ratios.map(r=>r.join('/'))).size !== 1) return [];
  return catalog.cards.filter(row => {
    if (!Array.isArray(row) || row[6] !== 'en' || row[8] === true || !row[0] || !row[1] || !row[3]) return false;
    const baseName = row[1].replace(/\s*\([^)]*\)/g,'').replace(/\s*-\s*\d+\/\d+$/,'').trim();
    if (normalized(baseName).length < 4 || !flat.includes(normalized(baseName))) return false;
    if (game === 'pokemon' || game === 'lorcana') {
      const parts = String(row[3]).split('/').map(num);
      return ratios.some(([n,total]) => n === parts[0] && (!parts[1] || total === parts[1]));
    }
    if (!token(text.replace(/[‐‑–—]/g,'-'), row[3])) return false;
    if (game === 'onepiece' && /^P-/i.test(row[3])) {
      // A promo code is reused across events. Only a named printed event can
      // distinguish it; a base promo or unspecified artwork is never enough.
      const event = row[1].match(/\((\d+(?:st|nd|rd|th) Anniversary)(?: Stamped)? Promo\)/i)?.[1];
      return !!event && flat.includes(normalized(event));
    }
    return true;
  });
}

export async function resolvePrintedEvidence(visual, evidence, { loadIndex = index, fetchFn = fetch } = {}) {
  const original = visual?.cardInfo;
  const game = original?.card_type || visual?.gameHint;
  if (!paths[game] || !evidence?.ok || evidence.labels?.length || original?._ximilar_graded) return null;
  const catalog = await loadIndex(game);
  let matches = printedCandidates(catalog, game, evidence.text);
  if (!matches.length || matches.length > 8) return null;
  if (game === 'pokemon') {
    const sets = [...new Set(matches.map(r => r[2]))];
    if (sets.length > 3) return null;
    const verified = new Set();
    await Promise.all(sets.map(async set => {
      try {
        const response = await fetchFn(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(set)}`, {signal:AbortSignal.timeout(5000),redirect:'error'});
        if (!response.ok) { await response.body?.cancel(); return; }
        const data = await response.json();
        if (data.id !== set || normalized(data.name) !== normalized(catalog.sets[set])) return;
        const abbreviation = data.abbreviation?.official;
        const total = String(data.cardCount?.official || '');
        if (!total || !new RegExp('/\\s*0*'+escape(total)+'\\b').test(evidence.text)) return;
        if (abbreviation) {
          if (!token(evidence.text, abbreviation)) return;
        } else {
          // Older cards have a symbol instead of a set abbreviation. Require
          // independent visual agreement as well as the printed name/ratio.
          const choices = [original,...(visual.candidates || [])].filter(Boolean);
          if (!choices.some(c => normalized(c.set_name) === normalized(data.name))) return;
        }
        verified.add(set);
      } catch { /* No evidence is not permission to pick a set. */ }
    }));
    matches = matches.filter(r => verified.has(r[2]));
  }
  const unique = new Map(matches.map(r => [String(r[0]),r]));
  if (unique.size !== 1) return null;
  const row = unique.values().next().value;
  return {
    card_name:game === 'onepiece' ? row[1] : row[1].replace(/\s*\([^)]*\)/g,'').trim(), card_number:row[3],
    set_name:catalog.sets[row[2]], set_code:game === 'yugioh' ? row[3] : row[2],
    card_type:game,is_japanese:false,rarity:row[4] || '',
    image_url:row[5] || null,image_small:row[5] || null,
    _grounded:true,_grounded_id:String(row[0]),grounded_id:String(row[0]),
    _ximilar:true,_ximilar_graded:false,_ximilar_foil:original?._ximilar_foil || '',
    _printed_evidence:true,_printed_promo:game === 'onepiece' && /^P-/i.test(row[3]),
    _ximilar_full_name:row[1],confidence:'high',image_quality:'unknown',
  };
}

export function resolveSlabEvidence(visual, evidence) {
  if (!visual?.ok || !evidence?.ok || evidence.labels?.length !== 1) return null;
  const label = evidence.labels[0], details = label._identification?.best_match;
  const text = label._ocr?.full_text;
  const company = label._tags?.Company?.[0] || label._tags?.Category?.[0];
  if (!details || typeof text !== 'string' || !['PSA','BECKETT','CGC','SGC','TAG','ACE'].includes(company?.name) || !Number.isFinite(company.prob) || company.prob < .95) return null;
  const grade = String(details.grade || ''), cert = String(details.certificate_number || '');
  if (!/^(?:[1-9](?:\.5)?|10)$/.test(grade) || !/^\d{6,14}$/.test(cert) || !token(text, cert) || !token(text, grade)) return null;
  if (company.name === 'PSA' && grade.includes('.')) return null;
  const choices = [visual.cardInfo,...(visual.candidates || [])].filter(Boolean);
  const matches = choices.filter(c => {
    if (!c._ximilar_graded || !c.card_name || !c.set_name || !c.card_number) return false;
    const flat = normalized(text);
    if (!flat.includes(normalized(c.card_name)) || !flat.includes(normalized(c.set_name))) return false;
    const n = String(c.card_number).split('/')[0].replace(/^0+(?=\d)/,'');
    if (!new RegExp('#\\s*0*'+escape(n)+'(?=$|[^a-z0-9])','i').test(text)) return false;
    if (c.year && !token(text, c.year)) return false;
    return true;
  });
  const unique = new Map(matches.map(c => [[c.card_type,normalized(c.card_name),normalized(c.set_name),c.card_number,c.variant || '',c.rarity || '',c._ximilar_card_id || '',c._ximilar_full_name || ''].join('|'),c]));
  if (unique.size !== 1) return null;
  const card = unique.values().next().value;
  return {...card,_slab_verified:true,grader:company.name === 'BECKETT' ? 'BGS' : company.name,grade,cert};
}
