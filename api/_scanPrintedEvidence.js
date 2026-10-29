// Read printed evidence only when visual matching needs help. OCR is never a
// catalogue identity: an exact, unique catalogue printing must corroborate it.
import { observeProviderAttempt } from './_providerUsage.js';

const paths = {
  pokemon: 'https://www.cardresell.org/data/catalog/pokemon.1b2a5316ec4a.json',
  lorcana: 'https://www.cardresell.org/data/catalog/lorcana.7b3e3281f96f.json',
  yugioh: 'https://www.cardresell.org/data/catalog/yugioh.88b8cbb13943.json',
  onepiece: 'https://www.cardresell.org/data/catalog/onepiece.740c7853cd03.json',
};
const indexes = new Map();
const normalized = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const num = s => String(s || '').replace(/^0+(?=\d)/, '');
const escape = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const token = (text, value) => new RegExp('(?:^|[^a-z0-9])' + escape(value) + '(?=$|[^a-z0-9])','i').test(text);

// Preserve region boundaries lost in the provider's concatenated full_text.
// Only actual OCR text is evidence; structured AI identification is not.
export function printedText(ocr) {
  const full = typeof ocr?.full_text === 'string' ? ocr.full_text : '';
  if (full.length > 12000) return '';
  const regions = Array.isArray(ocr?.texts) ? ocr.texts.slice(0,256)
    .filter(r => typeof r?.text === 'string' && r.text.length <= 512 &&
      Number.isFinite(r.prob) && r.prob >= .9).map(r => r.text) : [];
  const text = [full,...regions].join('\n').normalize('NFKC')
    .replace(/[⁄∕／]/g,'/').replace(/[‐‑–—−]/g,'-');
  return text.length <= 24000 ? text : '';
}

async function index(game) {
  if (!paths[game]) return null;
  if (!indexes.has(game)) indexes.set(game, fetch(paths[game], {signal:AbortSignal.timeout(5000),redirect:'error'}).then(response => { if (!response.ok) throw new Error('Catalogue unavailable'); return response.json(); }).catch(e => { indexes.delete(game); throw e; }));
  return indexes.get(game);
}

export async function readPrintedEvidence(image, tokenValue, { fetchFn = fetch, timeoutMs = 15000, slab = false } = {}) {
  if (!image || !tokenValue) return null;
  const operation = slab ? 'slab_id' : 'card_ocr_id';
  return observeProviderAttempt({provider:'ximilar',operation,mode:'identify',inputImages:1}, async observe => {
    try {
      const response = await fetchFn('https://api.ximilar.com/collectibles/v2/' + operation, {
        method:'POST', redirect:'error', signal:AbortSignal.timeout(timeoutMs),
        headers:{'Content-Type':'application/json',Authorization:`Token ${tokenValue}`},
        body:JSON.stringify({records:[{_base64:image}]}),
      });
      observe({status:response.status});
      if (!response.ok) { await response.body?.cancel(); return {ok:false,reason:'http'}; }
      const body = await response.json(), record = body?.records?.[0];
      if (!record || record._status?.code !== 200 || !Array.isArray(record._objects)) return {ok:false,reason:'invalid_response'};
      const cards = record._objects.filter(o => o?.name === 'Card');
      const labels = record._objects.filter(o => o?.name === 'Slab Label');
      if (slab) console.info('[scan-evidence]',JSON.stringify({stage:'slab_objects',cards:cards.length,labels:labels.length,classification:record['Graded Slab']}));
      if (cards.length > 1 || (!slab && cards.length !== 1) || (slab && labels.length !== 1)) return {ok:false,reason:'invalid_objects'};
      const card = cards[0], text = printedText(card?._ocr);
      if (!text.trim() && !labels.length) return {ok:false,reason:'no_match'};
      if (!slab) console.info('[scan-evidence]',JSON.stringify({stage:'ocr_regions',count:card?._ocr?.texts?.length || 0,
        // Bounded collector-like fragments only, never full OCR or images.
        identifiers:(text.match(/[^\s]{0,8}(?:\/|[-]EN)[^\s]{0,12}/gi)||[]).slice(0,6)}));
      return {ok:true,text,card,labels};
    } catch (error) { return {ok:false,reason:['AbortError','TimeoutError'].includes(error?.name)?'timeout':'network'}; }
  });
}

// Correct only the three numeric positions of a printed English YGO set code.
// Prefixes and names are never fuzzed; conflicting codes remain ambiguous.
export function yugiohPrintedCodes(text) {
  return [...new Set([...String(text).matchAll(/\b([A-Z0-9]{3,6})\s*-\s*EN\s*([0-9OSI]{3})\b/gi)]
    .map(m => m[1].toUpperCase() + '-EN' + m[2].toUpperCase().replace(/O/g,'0').replace(/S/g,'5').replace(/I/g,'1')))];
}

// A small collector line can disappear in whole-card OCR. Read one enlarged
// lower-image crop, only after a valid single-card read missed the fraction.
export async function readCollectorEvidence(image, tokenValue, evidence, {fetchFn=fetch, cropFn=collectorCrop, timeoutMs=12000}={}) {
  if (!evidence?.ok || evidence.labels?.length || /\b\d{1,4}\s*\/\s*\d{1,4}\b/.test(evidence.text)) return evidence;
  try {
    const crop = await cropFn(image);
    if (!crop) return evidence;
    return await observeProviderAttempt({provider:'ximilar',operation:'ocr_read',mode:'identify',inputImages:1},async observe=>{
      const response=await fetchFn('https://api.ximilar.com/ocr/v2/read',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),
        headers:{'Content-Type':'application/json',Authorization:`Token ${tokenValue}`},
        body:JSON.stringify({lang:'en',records:[{_base64:crop}]}),
      });
      observe({status:response.status});
      if (!response.ok) {await response.body?.cancel();return evidence;}
      const record=(await response.json())?.records?.[0];
      if (record?._status?.code!==200) return evidence;
      const extra=printedText(record._ocr);
      console.info('[scan-evidence]',JSON.stringify({stage:'collector_crop',collectorFragments:extra.split('\n').filter(t=>/[0-9/]/.test(t)).slice(0,5).map(t=>t.slice(0,90)),fractions:(extra.match(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g)||[]).slice(0,4)}));
      return {...evidence,text:evidence.text+'\n'+extra};
    });
  } catch {return evidence;}
}

export async function collectorCrop(image) {
  if (typeof image!=='string' || image.length>14000000) return null;
  const {default:sharp}=await import('sharp');
  const {data,info}=await sharp(Buffer.from(image,'base64'),{limitInputPixels:16000000})
    .rotate().resize({width:1800,withoutEnlargement:true}).toBuffer({resolveWithObject:true});
  if (info.height<200 || info.width<150) return null;
  const top=Math.floor(info.height*.75);
  return (await sharp(data).extract({left:0,top,width:Math.ceil(info.width*.65),height:info.height-top})
    .resize({width:2200}).jpeg({quality:95}).toBuffer()).toString('base64');
}

// Pure first-stage filter, independently tested against conflicting printings.
export function printedCandidates(catalog, game, text) {
  if (!catalog || !Array.isArray(catalog.cards) || typeof text !== 'string') return [];
  const flat = normalized(text);
  const ygoCodes = game === 'yugioh' ? yugiohPrintedCodes(text) : [];
  if (game === 'yugioh' && ygoCodes.length !== 1) return [];
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
    if (game === 'yugioh') return ygoCodes[0] === String(row[3]).toUpperCase();
    if (!token(text.replace(/[‐‑–—]/g,'-').replace(/\s*-\s*/g,'-'), row[3])) return false;
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
  console.info('[scan-evidence]', JSON.stringify({stage:'catalogue',game,textLength:evidence.text.length,candidates:matches.length,ratios:(evidence.text.match(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g)||[]).slice(0,4),nameRows:catalog.cards.filter(r=>normalized(evidence.text).includes(normalized(r[1].replace(/\s*\([^)]*\)/g,'')))).length,printedCodes:(evidence.text.match(/\b[A-Z0-9]{3,6}\s*[-–]?\s*EN\s*\d{3}\b/gi)||[]).slice(0,4)}));
  if (!matches.length || matches.length > 8) return null;
  if (game === 'yugioh') {
    // A corrected suffix also requires the independent visual name. Exact
    // printed codes retain the existing name + catalogue verification path.
    const exact = token(evidence.text.replace(/\s*-\s*/g,'-'),matches[0][3]);
    if (!exact && ![original,...(visual.candidates||[])].filter(Boolean).some(c =>
      normalized(c.card_name)===normalized(matches[0][1].replace(/\s*\([^)]*\)/g,'')))) return null;
  }
  if (game === 'pokemon') {
    const sets = [...new Set(matches.map(r => r[2]))];
    if (sets.length > 3) return null;
    const verified = new Set();
    await Promise.all(sets.map(async set => {
      try {
        const response = await fetchFn(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(set)}`, {signal:AbortSignal.timeout(5000),redirect:'error'});
        if (!response.ok) { console.info('[scan-evidence]',JSON.stringify({stage:'set_metadata',set,status:response.status})); await response.body?.cancel(); return; }
        const data = await response.json();
        console.info('[scan-evidence]',JSON.stringify({stage:'set_metadata',set,idMatches:data.id===set,nameMatches:normalized(data.name)===normalized(catalog.sets[set]),total:data.cardCount?.official,abbreviation:data.abbreviation?.official,abbreviationRead:!!data.abbreviation?.official && (token(evidence.text,data.abbreviation.official)||token(evidence.text,data.abbreviation.official+'EN')),visualSetMatches:[original,...(visual.candidates||[])].filter(Boolean).some(c=>normalized(c.set_name)===normalized(data.name))}));
        if (data.id !== set || normalized(data.name) !== normalized(catalog.sets[set])) return;
        const abbreviation = data.abbreviation?.official;
        const total = String(data.cardCount?.official || '');
        if (!total || !new RegExp('/\\s*0*'+escape(total)+'\\b').test(evidence.text)) return;
        // Provider abbreviations exist even for older symbol-only sets. The
        // printed name + full fraction + official set total may instead be
        // corroborated by an exact visual candidate (name, set AND number).
        const choices = [original,...(visual.candidates || [])].filter(Boolean);
        const visualAgreement = matches.filter(r=>r[2]===set).some(row=>choices.some(c =>
          normalized(c.card_name)===normalized(row[1]) &&
          num(String(c.card_number).split('/')[0])===num(row[3]) &&
          normalized(c.set_name)===normalized(data.name)));
        const printedSet = abbreviation && (token(evidence.text,abbreviation) || token(evidence.text,abbreviation+'EN'));
        const explicitCodes = [...evidence.text.matchAll(/\b([A-Z0-9]{2,5})\s*[·•★*]?\s*EN\b/g)].map(m=>m[1]);
        if (abbreviation && explicitCodes.length && !explicitCodes.includes(abbreviation)) return;
        if (!printedSet && !visualAgreement) return;
        verified.add(set);
      } catch(error) { console.info('[scan-evidence]',JSON.stringify({stage:'set_metadata',set,error:error?.name})); }
    }));
    matches = matches.filter(r => verified.has(r[2]));
  }
  console.info('[scan-evidence]', JSON.stringify({stage:'verified_printing',game,candidates:matches.length}));
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
  console.info('[scan-evidence]', JSON.stringify({stage:'slab_label',hasDetails:!!details,hasText:typeof text === 'string',labelCount:evidence.labels.length,choices:1+(visual.candidates?.length || 0)}));
  const company = label._tags?.Company?.[0] || label._tags?.Category?.[0];
  console.info('[scan-evidence]',JSON.stringify({stage:'slab_company',company:company?.name,prob:company?.prob,tagKeys:Object.keys(label._tags||{})}));
  if (typeof text !== 'string' || !['PSA','BECKETT','CGC','SGC','TAG','ACE'].includes(company?.name) || !Number.isFinite(company.prob) || company.prob < .95) return null;
  // Some OCR responses omit structured identification. PSA's printed verbal
  // grade plus one unique eight-digit certificate can supply those two fields;
  // identity still has to agree with the visual catalogue match below.
  const printedGrades = company.name === 'PSA' ? [...text.matchAll(/(?:GEM\s*(?:MT|MINT)|MINT|NM\s*[-–]?\s*MT|NEAR\s*MINT|EX\s*[-–]?\s*MT|EXCELLENT|VERY\s*GOOD|GOOD|FAIR|POOR)\s*(10|[1-9])(?=$|[^0-9.])/gi)].map(m=>m[1]) : [];
  const printedCerts = company.name === 'PSA' ? [...text.matchAll(/(?:^|\D)(\d{8})(?=$|\D)/g)].map(m=>m[1]) : [];
  const uniqueGrade = new Set(printedGrades), uniqueCert = new Set(printedCerts);
  const grade = String(details?.grade || (uniqueGrade.size === 1 ? printedGrades[0] : '')), cert = String(details?.certificate_number || (uniqueCert.size === 1 ? printedCerts[0] : ''));
  console.info('[scan-evidence]',JSON.stringify({stage:'slab_fields',grade,certLength:cert.length,printedGrades:printedGrades.length,printedCerts:printedCerts.length,gradeToken:token(text,grade),certToken:token(text,cert)}));
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
  console.info('[scan-evidence]', JSON.stringify({stage:'slab_matches',matches:unique.size}));
  if (unique.size !== 1) return null;
  const card = unique.values().next().value;
  return {...card,_slab_verified:true,grader:company.name === 'BECKETT' ? 'BGS' : company.name,grade,cert};
}
