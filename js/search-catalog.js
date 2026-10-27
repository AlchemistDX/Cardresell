/* Identity-only catalog snapshots. Prices and finishes are resolved separately.
   Run tools/build-search-catalogs.py, then tools/version-search-catalog.mjs. */
(function(root) {
  'use strict';
  const MANIFEST = '/data/catalog/manifest.083369bdc979.json';
  const pending = new Map();
  const names = new WeakMap();
  function fold(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim(); }
  async function read(url) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const res = await fetch(url, {signal:abort.signal});
      if (!res.ok) throw Error('Catalog unavailable');
      return await res.json();
    } finally { clearTimeout(timer); }
  }
  function once(key, fn) {
    if (!pending.has(key)) pending.set(key, Promise.resolve().then(fn).catch(e => {pending.delete(key); throw e;}));
    return pending.get(key);
  }
  async function load(game) {
    return once(game, async () => {
      const manifest = await once('manifest', () => read(MANIFEST));
      const meta = manifest?.games?.[game];
      if (manifest?.schema !== 1 || !meta || !new RegExp('^/data/catalog/'+game+'\\.[a-f0-9]{12}\\.json$').test(meta.url)) throw Error('Catalog not available for this game');
      const data = await read(meta.url);
      if (data?.schema !== 1 || data.game !== game || !Array.isArray(data.cards) || data.cards.length !== meta.count || !data.cards.length || !data.sets) throw Error('Incomplete catalog');
      if ((data.nativeCards?.length || 0) !== (meta.nativeCount || 0)) throw Error('Incomplete native catalog');
      const ids = new Set();
      for (const c of [...data.cards,...(data.nativeCards || [])]) {
        if (!Array.isArray(c) || c.length < 7 || typeof c[0] !== 'string' || !c[0] || typeof c[1] !== 'string' || !c[1] || ids.has(c[0]) || typeof data.sets[c[2]] !== 'string' || c[6] !== (game === 'pokemonjp' ? 'ja' : 'en')) throw Error('Invalid catalog identity');
        ids.add(c[0]);
      }
      return data;
    });
  }
  async function search(game, query) {
    const data = await load(game), q = fold(query), tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.length) return {data, rows:[]};
    const nativeQuery = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(q);
    const candidates = nativeQuery && data.nativeCards?.length ? data.nativeCards : data.cards;
    const rows = candidates.filter(c => {
      const text = fold([c[1],data.sets[c[2]],c[3]].join(' '));
      return tokens.every(t => text.includes(t));
    });
    rows.sort((a,b) => Number(fold(b[1]) === q) - Number(fold(a[1]) === q));
    return {data,rows};
  }
  // OCR may establish a plausible name, never a printing or a price. Match
  // only names (not set metadata), and leave ambiguous corrections for review.
  async function suggest(game, query) {
    const data = await load(game), q = fold(query);
    if (q.length < 3 || q.length > 120) return null;
    if (!names.has(data)) {
      const index = new Map();
      for (const c of [...data.cards,...(data.nativeCards || [])]) {
        if (c[8] !== true) index.set(fold(c[1]),c[1]);
      }
      names.set(data,index);
    }
    const index = names.get(data);
    const hit = value => ({name:index.get(value),cardType:game});
    if (index.has(q)) return hit(q);
    // A short sleeve-noise token before an otherwise exact title is common.
    const clean = q.replace(/^[a-z]{1,2} /,'');
    if (clean !== q && index.has(clean)) return hit(clean);
    if (/[^\x00-\x7f]/.test(q)) return null; // Native names require an exact read.
    const limit = Math.min(2,Math.floor(q.replace(/\s/g,'').length * .15));
    if (!limit) return null;
    let best = limit + 1, matches = [];
    for (const name of index.keys()) {
      if (Math.abs(name.length-q.length)>limit || /[^\x00-\x7f]/.test(name)) continue;
      let previous = Array.from({length:name.length+1},(_,i)=>i), distance = limit+1;
      for (let i=1;i<=q.length;i++) {
        const row=[i];
        for(let j=1;j<=name.length;j++) row[j]=Math.min(row[j-1]+1,previous[j]+1,previous[j-1]+Number(q[i-1]!==name[j-1]));
        if(Math.min(...row)>limit) {distance=limit+1;break;}
        previous=row;distance=row[name.length];
      }
      if(distance<best){best=distance;matches=[name];}
      else if(distance===best)matches.push(name);
    }
    return best<=limit && matches.length===1 ? hit(matches[0]) : null;
  }
  function normalized(data,c) {
    const provider = c[0].startsWith('tcgdex:') ? 'TCGdex' : data.provider;
    const id = c[0].startsWith('tcgdex:') ? c[0] : provider === 'TCGCSV / TCGplayer' ? 'tcgplayer:'+c[0] : provider === 'TCGdex' ? 'tcgdex:'+c[0] : 'ygoprodeck:'+c[0];
    const image = /^https:\/\//i.test(c[5]) ? c[5] : '';
    return {id, name:c[1],game:data.game,setName:data.sets[c[2]],setCode:c[2],number:c[3],rarity:c[4],language:c[6],
      images:{small:image,large:image.replace(/\/low\.webp$/, '/high.webp')},priceVariants:[],
      source:provider+' catalog — price not checked',updatedAt:'',catalogAsOf:data.asOf,catalogPresale:c[8]===true,releaseDate:c[7] || '',_localCatalogFallback:true};
  }
  root.CardResellCatalog = Object.freeze({load,search,suggest,normalized});
})(typeof window === 'undefined' ? globalThis : window);
